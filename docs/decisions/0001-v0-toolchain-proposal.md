# Förslag 0001: verktygskedja för Forge v0

- Status: **Ersatt av ADR-0002 — ingen implementation**
- Datum: 2026-07-19
- Omfattning: lokalt Forge v0; inga installationer eller externa ändringar

## Historik

Detta förslag rekommenderade en tunn Forge med en egen Podman/Quadlet-executor.
Det är ersatt av beslutet att återanvända den redan ägarstyrda k3s-motorn på
Nocco för ett enda fast buildjobb. Se
[`ADR-0002`](../adr/0002-nocco-k3s-build-executor.md).

## Krav som styr urvalet

- Endast explicit registrerade GitHub-repos och brancher får övervakas.
- Pollning ska vara utgående; ingen GitHub-webhook eller publik ingress.
- Forge och Lyra får inte direktåtkomst till shell, Docker-/Podman-socket eller
  hostadministration.
- Bygg ska knytas till exakt commit-SHA; release ska health-checkas och kunna
  rollbackas.
- V0 ska återanvända etablerade verktyg, inte bygga Kubernetes eller en egen
  containerplattform.
- V0 ska vara lättviktigt för en Lenovo mini-PC och kunna växa med fler
  mini-PC:er utan att kräva ett kluster från start.

## Alternativ

| Alternativ | Styrkor | Konflikt med Forge-gränsen | Bedömning |
| --- | --- | --- | --- |
| Coolify som deployplattform | Moget, Vercel-liknande PaaS med API, builds, hälsokontroller och rollback | Har generell server-/terminalfunktion, SSH-baserad serverhantering och dess normala GitHub-auto-deploy bygger på GitHub App, Actions eller webhook | Avvisa för v0 |
| Portainer med Git-stack-pollning | Har inbyggd Git-pollning för stackar | Är en bred Docker-administrationsyta; exact-SHA-artifact och Forge-capabilities blir inte den primära modellen | Avvisa för v0 |
| Forge + GitHub REST + rootless Podman/Quadlet bakom en smal executor | Minst ny plattform; utgående pollning, deklarativa systemd-enheter och rootless drift; Forge behåller sina egna capabilities och audit | Kräver en liten ägarinstallerad executor-adapter och tydlig användar-/filisolering | **Rekommenderas** |

## Rekommenderad v0-kedja

```text
Lyra
  │ begränsat Forge-API
  ▼
Forge control-plane
  ├── lokal state + content-free audit
  ├── begränsad buildkö (en build i taget initialt)
  ├── GitHub REST-pollare (endast registrerade repo/branch)
  └── typed executor-klient ── Unix-socket med snäva filrättigheter ──┐
                                                                     ▼
                                           forge-executor (egen, rootless användare)
                                             ├── Podman build / image digest
                                             └── Quadlet + systemd user units
```

Fler mini-PC:er läggs senare till som separata executor-noder med en egen
dedikerad användare och samma snäva executor-kontrakt. Forge förblir den enda
platsen för projektplacering och release-state; noder upptäcks inte automatiskt
och får inte skapa nya projekt eller nätverksrelationer själva.

### GitHub-pollning

Forge anropar GitHubs REST-endpoint för commits med den registrerade branchen
som `sha` och lagrar endast den returnerade commit-SHA:n. GitHub dokumenterar
att listning av commits för privata repo kan göras med en fine-grained token
med läsbehörigheten `Contents`; den ska begränsas till enbart registrerade repo
och lagras utanför Git. Forge tar aldrig emot GitHub-anrop.

### Build och runtime

Podman väljs som möjlig runtime eftersom den stöder rootless drift och Quadlet
hanterar container-, image-, nätverks- och build-enheter deklarativt via
systemd, utan Kubernetes. En specifik build arbetar med ett projekt och en
pinnad SHA, lämnar en OCI-image identifierad av digest och avslutas. Runtime
startar en registrerad, deklarativ unit först efter health check.

På den första noden är resursprofilen medvetet liten: en control-plane-process,
en lokal statefil och en build i taget. Varje projektprofil ska senare ange
CPU-, minnes- och tidsgränser. En andra nod ändrar inte denna modell; den blir
en ytterligare executor med explicit placering, inte en Kubernetes-nod.

Forge får **inte** montera eller ansluta till Podmans API-socket. Podmans egen
dokumentation beskriver API:t som fullständig åtkomst till Podman utan möjlighet
att begränsa eller auditera individuella anrop. Därför äger en separat
`forge-executor` den rootless socketen och exponeras endast via ett litet,
typat protokoll.

### Executor-kontrakt

Executorn får endast ta emot dessa operationer för ett existerande `projectId`:

- `buildRegisteredCommit(projectId, commitSha)`
- `healthCheck(releaseId)`
- `activateRelease(releaseId)`
- `restartActive(projectId)`
- `rollbackToRelease(projectId, releaseId)`
- `getRuntimeStatus(projectId)`

Den accepterar inte shell, hostvägar, portnummer, fria images, miljövärden,
Compose-/Quadlet-text eller nya projekt. Den läser sin allowlist från
ägarinstallerad konfiguration; Forge kan bara välja bland dessa registrerade
värden. Executorens socket stannar lokalt och får ägas/läsas endast av dess
dedikerade konto och Forge-processen.

## Säkerhetskonsekvenser

- Rootless Podman minskar värdprivilegier jämfört med en rootfull daemon men
  ersätter inte sandboxning av opålitlig buildkod. V0:s säkerhet bygger också
  på repoallowlist, SHA-pin, separata build-/runtimekonton, resursgränser och
  inga hostmounts.
- Ingen Docker-/Podman-socket exponeras för Lyra, Forge eller nätverket.
- Den framtida GitHub-identiteten ska vara en separat, tidsbegränsad,
  fine-grained läsidentitet. Ingen Codex OAuth, Mac-Keychain eller delad token
  används.
- Rootless användare, systemd linger, cgroup v2, filägarskap och själva
  Podman-installationen är hoständringar och kräver separat ägargodkännande.
- Varje ny mini-PC är en separat host-, nätverks- och trust-boundary-ändring
  och kräver ägargodkännande. Först då avgörs om artifact behöver delas mellan
  noder eller kan byggas på den valda noden.

## Varför inte Coolify eller Portainer i v0

Coolify är ett starkt self-hosted PaaS-alternativ med API och Docker-baserade
deploys, men dess dokumentation inkluderar SSH-serverhantering, realtidsterminal
och webhook-baserad automation. Det är avsevärt bredare än Forges avsiktliga
capability-yta. Portainer kan polla Git för stackuppdateringar, men är också en
generell Docker-administrationsyta; Forge skulle då behöva medla framför ett
bredare system än v0 behöver.

## Källor

- [GitHub REST: commits och minsta `Contents: read`-behörighet](https://docs.github.com/en/rest/commits/commits)
- [GitHubs riktlinjer för minsta tokenbehörighet och säker lagring](https://docs.github.com/en/rest/authentication/keeping-your-api-credentials-secure)
- [Podman Quadlet](https://docs.podman.io/en/latest/markdown/podman-quadlet.1.html)
- [Podmans systemservice och socketens fulla åtkomst](https://docs.podman.io/en/stable/markdown/podman-system-service.1.html)
- [Coolifys GitHub-integrering](https://coolify.io/docs/applications/ci-cd/github/overview)
- [Portainers Git-pollning för stackar](https://docs.portainer.io/faqs/troubleshooting/stacks-deployments-and-updates/how-do-automatic-updates-for-stacks-applications-work)
