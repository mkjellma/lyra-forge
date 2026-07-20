# Förslag 0002: Coolify som Forge-motor (ersatt)

- Status: **Ersatt 2026-07-20 av Forge ovanpå k3s.** Dokumentet bevaras endast
  som beslutshistorik; Coolify är inte Forge-motor.
- Datum: 2026-07-19
- Ersätter: förslag 0001:s rekommendation om egen Podman/Quadlet-executor

## Beslut som behövs

Godkänn eller avvisa Coolify som den färdiga deploymotorn under Forge. Detta är
ett arkitekturval, inte tillstånd att installera något på Lenovo.

## Slutsats

**Rekommendation: använd self-hosted Coolify som Forge v0:s deploymotor.**

Forge ska inte bygga en egen PaaS, scheduler eller container-executor. Forge
blir den tunna policy- och Lyra-integrationsytan framför Coolifys API:

```text
Lyra
  │ status, projektregistrering, deploy, paus, restart, rollback
  ▼
Forge policy-/API-lager
  ├── ägargodkännande för nya repo, secrets, exponerings- och hoständringar
  ├── utgående GitHub-pollning av registrerade repo/brancher
  └── begränsad Coolify-adapter
       ▼
Coolify (bygg, containers, health check, deployhistorik, rollback)
```

Lyra får Forge-capabilities, men aldrig Coolifys generella admin-UI, terminal,
rootbehörighet eller API-token.

## Varför Coolify

Coolify har ett dokumenterat API med team-scopade bearer-tokens och separata
`read`, `write` och `deploy`-behörigheter. Det har API-stöd för att skapa
applikationer med git-repo, branch, `git_commit_sha`, health-check-parametrar
och CPU-/minnesgränser. Det bygger och kör applikationer som containrar, har
deployhistorik och kan rollbacka till lokalt tillgängliga images.

Det täcker den vanliga deploymekaniken som Forge annars skulle ha byggt själv.
Lenovons i5/32 GB räcker bättre när v0 består av en etablerad motor och en tunn
integrationsyta än när den även ska bära ett egenbyggt orkestreringslager.

## Kontrakt för Lyra och Forge

| Lyra-/Forge-operation | Coolify-funktion | Policy |
| --- | --- | --- |
| Läs status och historik | `read` mot applikation/deployment | tillåten för registrerade projekt |
| Skapa registrerat projekt | `write` mot ett enda Forge-team | kräver ägargodkännande av repo, branch och profil |
| Deploy av kandidat-SHA | skapa/uppdatera resurs med pinnad SHA, sedan deploy | endast efter Forge verifierat registrerad branch och SHA |
| Restart | deploy/restartoperation | tillåten för registrerat projekt |
| Pausa deploy | Forge stoppar nya deploybegäran; Coolify auto-deploy är av | tillåten för registrerat projekt |
| Rollback | Coolifys lokala image-rollback | endast till bevarad verifierad release |

Forge behåller sin egen allowlist, audit och ägargodkännande. Coolify är inte
exponerad direkt för Lyra och dess API-token lämnar aldrig Forge-motorn.

## Enkel labbprofil för v0

Det här är en intern labbmiljö, inte en flerregional plattform. V0 behöver
bara följande enkla ramar:

1. En Coolify-instans på Lenovo och ett enda team för Forge-hanterade projekt.
2. Lyra använder Forge-API:t; Forge använder ett Coolify-token med `read`,
   `write` och `deploy`, men aldrig `root`.
3. Forge pollar GitHub utgående. Coolifys auto-deploy och GitHub-webhooks är
   avstängda.
4. Nya appar startar utan publik domän eller host-portmappning. Exponering är
   ett separat beslut när den faktiskt behövs.
5. En build i taget och enkla CPU-/minnesgränser per app räcker tills verklig
   belastning visar något annat.

Det räcker för att Lyra ska kunna skapa projekt, visa status och styra deployer
utan att vi bygger ett separat säkerhetssystem runt plattformen.

## Kritisk acceptansgrind: exakt commit

Coolifys dokumenterade API kan skapa en applikation med `git_commit_sha`, och
deploymentposter innehåller commitfält. Dokumentationen som granskats här visar
inte tillräckligt tydligt hur en **befintlig** app senare redeployas till en
annan vald SHA via API.

Innan Coolify godtas som Forge-motor måste en isolerad, ägargodkänd
acceptanspilot bevisa följande utan publik exponering:

1. Forge kan skapa ett privat testprojekt med exakt SHA.
2. Forge kan välja en senare specifik SHA för samma projekt, och Coolify visar
   den SHA:n i deployhistoriken.
3. Misslyckad health check lämnar föregående release aktiv.
4. Rollback återställer föregående image/release.

Om punkt 2 inte går att bevisa med stödd API-yta avvisas Coolify för Forge v0
och nästa alternativ utvärderas; vi bygger inte en egen PaaS som genväg.

## Jämförda alternativ

| Motor | Styrkor | Avgörande nackdel för Forge v0 | Beslut |
| --- | --- | --- | --- |
| **Coolify** | API, team-scopade tokenbehörigheter, appregistrering med SHA, health, rollback, resursgränser | Bred admin-/terminalprodukt och exact-SHA-redeploy måste bevisas | **Rekommenderas villkorligt** |
| Dokploy | API, health checks och rollback | Dokumenterad API-yta använder generell API-nyckel; exakt SHA för deploy verifierades inte | Reservalternativ |
| Portainer | Git-pollning för stackar | Generell Docker-administration, fel abstraktionsnivå och sämre app-/releasekontrakt | Avvisa |
| CapRover | Mogen PaaS med multi-node-stöd | Bygger på Docker Swarm och mer ingress-/plattformsmekanik än v0 behöver | Avvisa |

## Skalning utan Kubernetes

Coolify kan senare hantera fler servrar, men v0 använder en Lenovo och en
seriell buildpolicy. Varje extra mini-PC är ett separat ägarbeslut om host,
nätverk, resursbudget och projektplacering. Vi inför varken Kubernetes eller
Swarm för att "förbereda" skala.

## Källor

- [Coolify API: behörigheter och team-scope](https://coolify.io/docs/api-reference/authorization)
- [Coolify API: skapa applikation med `git_commit_sha`, health och resursgränser](https://next.coolify.io/docs/api-reference/api/applications/create-public-application)
- [Coolify: applikationer, health checks, rollback och buildpacks](https://next.coolify.io/docs/applications/)
- [Coolify API: deploymentstatus med commit](https://next.coolify.io/docs/api-reference/api/deployments/get-deployment-by-uuid)
- [Dokploy: API för applikationer](https://docs.dokploy.com/docs/api/reference-application)
- [Dokploy: health checks och rollback](https://docs.dokploy.com/docs/core/applications/rollbacks)
- [Portainer: Git-pollning](https://docs.portainer.io/faqs/troubleshooting/stacks-deployments-and-updates/how-do-automatic-updates-for-stacks-applications-work)
- [CapRover: Docker Swarm-baserad plattform](https://caprover.com/)
