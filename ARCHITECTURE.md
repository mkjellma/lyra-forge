# Arkitektur

## Syfte och gräns

Forge är ett privat deploy-control-plane, inte en generell serveradministratör
eller exponerad CI-tjänst. Det kör separat från Lyra Core och framtida Lyra
integration begränsas till en liten, typad API-yta. I v0 är Lyra det avsedda
gränssnittet som använder API:t; Forge behöver ingen egen generell UI-yta.

Den rekommenderade värdstrukturen är:

```text
Linux/hypervisor
└── isolerat Forge-tjänst/containerområde
    ├── Forge control-plane
    ├── registrerade build-/release-jobb
    └── registrerade privata tjänster
```

Forge styr inte hypervisorn, virtuella maskiner eller hostens nätverk.

Forge är ett tunt policy- och integrationslager framför en etablerad
deploymotor. Motorn äger containerbuild, artifact, runtime, health check och
rollback; Forge äger registreringspolicy, Lyra-capabilities och content-free
audit. Forge implementerar inte en egen container-runtime, scheduler, PaaS,
service mesh eller Kubernetes-distribution.

## Lättvikt och utbyggnad

V0 optimeras för en intern mini-PC-labbmiljö, inte för ett kluster:

- ett litet control-plane, en lokal statefil och en begränsad buildkö
- ingen alltid körande databas, meddelandebuss, service mesh eller scheduler
- en build i taget som utgångspunkt; samtidighet höjs endast efter mätning och
  ägargodkännande i den valda deploymotorn
- enkla CPU-, minnes- och tidsgränser när en app faktiskt behöver dem

V0 har en control-plane-instans och återanvänder den redan ägarstyrda,
enkel-nods k3s-motorn på Nocco för kortlivade, registrerade jobb. Forge
installerar, uppgraderar eller administrerar inte k3s. Den första executorn
läser en ägarstyrd buildinventering över projekt och buildprofiler; varken
Lyra eller Forge får generell fjärrshell, `kubectl` eller container-socket till
noden.

Distribuerad state, automatisk nodupptäckt, korsnods-nätverk och delad
artifactlagring introduceras först när ett faktiskt behov och nytt
ägargodkännande finns.

## V0-flöde

1. Ett projekt registreras i ett ägargranskat register med repo, tillåten
   branch, build/start-instruktion och health-check-kontrakt.
2. En Forge-schemaläggare pollar GitHub utgående och läser den senaste commit
   på den registrerade branchen.
3. En deploypolicy eller en API-begäran från Lyra väljer en kandidat bland
   dessa commits. Forge låser valet till en exakt SHA.
4. Forge skickar SHA:n till en kortlivad, isolerad build-jobbprofil. Den
   publicerar en immutable OCI-artifact i en intern registry och sparar
   registry:ns manifest-digest som release-metadata. Profilen är
   ägarinstallerad, inte repository-supplied kod eller kommando.
5. Forge startar kandidaten isolerat och kör dess fördefinierade interna health
   check.
6. Vid godkänd check blir kandidaten aktiv. Föregående friska release behålls.
7. Vid fel lämnas den aktiva releasen orörd. En registrerad rollback kan växla
   tillbaka till föregående friska release.

En deploy i v0 avser en begränsad capability-begäran eller registrerad policy
för exakt `projectId` och commit-SHA, inte autonom körning av godtycklig
repositorykod.

## Build-isolering

Forge får skapa buildjobb för registrerade deployer. Ett buildjobb
är kortlivat, kopplat till ett enda projekt och commit-SHA och används bara för
det projektets deklarerade buildprofil. Den får inte bli en agentens generella
shell- eller Docker-socket-yta. Forge bevarar artifact och content-free
metadata, men inte den körande build-containern efter avslutad build.

## Minimal datamodell

### Projektregister

Varje projekt har minst:

- stabilt `projectId`
- canonical `repository` och `allowedBranch`
- godkänd build- och runtimeprofil
- deklarerad `deployPolicy` och build-containerprofil
- intern `healthCheck` med timeout
- önskad pollfrekvens
- status för deploypaus

Registerändringar, inklusive nya repositories eller brancher, är
ägargodkända förändringar och ingår inte i framtida Lyra-capabilities.

### Releasepost

Varje releasepost har minst:

- `projectId`, commit-SHA och artifact-id
- tidpunkter och utfall för build och health check
- aktiv/föregående/avbruten status
- länkning till föregående friska release

Artifacts och metadata är immutable efter att releasen har byggts. Retention och
eventuell radering bestäms senare av ägaren.

V0:s lokala state lagrar releasehändelser, aktiv release, deploypaus och
content-free audit atomiskt. Statefilen är lokal driftdata, inte Git-data, och
ska ha ägarbegränsade filrättigheter.

### Auditlogg

Auditloggen registrerar endast innehållsfri metadata: tid, projekt-id,
åtgärdstyp, commit-SHA eller release-id, initierande aktörstyp, resultat och
normaliserad felkategori. Den registrerar aldrig secrets, source code,
miljövärden, tokens, HTTP-body eller buildloggars fria innehåll.

## Lyra API-yta

API-ytan är typad och begränsad till registrerade projekt. Lyra är dess
förväntade klient och användargränssnitt:

- `getProjectStatus(projectId)`
- `listDeployHistory(projectId)`
- `requestDeploy(projectId, commitSha)`
- `restartService(projectId)`
- `setDeployPaused(projectId, paused)`
- `rollbackProject(projectId, targetReleaseId)`

Varje muterande operation validerar projektets register, tillåtna tillstånd och
identitet. Ytan ger inte filsystem, shell, Docker-socket, godtyckliga images
eller nya repositories.

## Adaptergränser

GitHub-pollaren får endast läsa HEAD-commit för ett registrerat repo och dess
registrerade branch. Den returnerar content-free pollstatus och verifierar på
nytt att en begärd SHA fortfarande är branchens HEAD före deploy.

Deploymotor-adaptern tar endast emot typade operationer för `projectId`,
commit-SHA eller release-id. Den får aldrig ta emot fria shellkommandon,
hostvägar, portnummer, images, miljövärden eller Compose-text. Den valda
motorns bredare administrationsyta exponeras aldrig för Lyra.

## Icke-mål för v0

- publik ingress, port-forward eller inkommande GitHub-webhooks
- generaliserad CI/CD, multi-tenant drift eller marketplace
- egen Kubernetes-distribution, scheduler, container-runtime eller
  nätverksplattform
- hostuppgraderingar, brandväggs- och nätverksadministration
- VM-livscykel eller hostadministration
- klusteradministration, automatisk nodupptäckt eller autoskalning
- secretshantering, secretsrotation eller migrering av Mac-identiteter
