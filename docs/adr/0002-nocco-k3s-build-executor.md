# ADR-0002: Nocco k3s används som privat buildmotor

- Status: Accepterad
- Datum: 2026-07-21
- Ersätter: ADR-0001 endast i frågan om den redan installerade privata
  k3s-motorn på Nocco

## Kontext

Forge kör redan privat på den ägarstyrda Nocco-värden. Den tidigare
arkitekturtexten förbjöd klustring, medan handoff och roadmap samtidigt utgick
från en existerande enkel-nods k3s-installation. Det gjorde ansvar, rättigheter
och rollback otydliga inför den första faktiska build-executorn.

Adesco är den första piloten. Det är en låsfilspinnad Next-app som bygger med
Node 24.18.0, `npm ci` och `npm run build`; ett projektägt Dockerfile är inte
ett krav.

## Beslut

Den redan installerade, ägarstyrda enkel-nods k3s-instansen på Nocco återanvänds
som privat exekveringsmotor. Forge installerar, uppgraderar, exponerar eller
administrerar inte k3s.

Först införs en enda build-only executor för den registrerade profilen
`nextjs-npm` och det explicit allowlistade projektet `adesco-webb`:

- Forge skickar endast `projectId` och exakt commit-SHA över en privat lokal
  transport.
- Executor hämtar endast den registrerade repo-/branch-kombinationen och kör
  den fasta recepten `npm ci` och `npm run build` i en kortlivad, begränsad
  Node-jobbmiljö.
- Builder-image, namespace, CPU/minne/tidsgräns och tillåtna
  projekt ligger i ägarinstallerad konfiguration — aldrig i Lyra-anrop,
  projektdata eller repositorykod.
- En build i taget gäller fortsatt. Första steget returnerar endast
  normaliserad, innehållsfri buildstatus. Ett deploybart immutable artifact-id
  införs först tillsammans med en uttryckligt godkänd artifactkanal.
- Forge-kontrollplanet får ingen shell-, `kubectl`-, Docker-socket-, hostPath-
  eller cluster-admin-åtkomst. En Kubernetes-token monteras endast där den
  behövs i executor-komponenten, aldrig i Forge-processen.
- För labbpiloten används en minimal executoridentitet med endast `create` och
  `get` för Jobs, plus en fast, pinnad template: inga fria images/kommandon,
  ingen privileged-/host-åtkomst, ingen service-account-token i buildjobbet
  och fasta resurs-/deadlinegränser. En admission-policy är senare härdning,
  inte ett krav för denna enda ägarstyrda pilot.

Källträdet innehåller en ren owner-side factory för just detta Job-template och
dess minimala RBAC-kontrakt. Den är inte ansluten till Forge-processen och kan
inte anropas via API.

`adesco-webb` kan registreras med `manual` policy och `runtimeBinding: null`.
En sådan registrering är uttryckligen oprovisionerad och blockerad från deploy:
den får inte polla eller deploya förrän en separat runtime- och
artifact-publiceringsväg är godkänd och klar. Den separata build-only-vägen får
senare verifiera en uttryckligt godkänd SHA utan att ge projektet runtime.
Första executoraktivering gör alltså ingen appdeploy, skapar
ingen publik ingress och ändrar ingen domän.

## Konsekvenser

Forge får en konkret och liten väg till verifierade builds utan att en
projektägd Dockerfile eller generell CI-motor införs. Adesco kan senare få en
egen runtime/publiceringsdesign. En intern registry, artifactkanal, runtime-Deployment,
GitHub-credential, automatisk deploy, andra buildprofiler och publik ingress
ligger utanför detta beslut och kräver separata ägarbeslut.

Före host-aktivering tas en state-/manifest-snapshot. Rollback återställer
föregående Forge-version och tar bort endast den nya executorbehörigheten;
registrering och artifacts raderas inte automatiskt.

## Avvisade alternativ

- Projektkrav på Dockerfile: onödig driftbörda för en vanlig Next-app.
- Generell `npm`/shell-executor: gör Forge till en obegränsad kodkörningsyta.
- Att låta RBAC ensamt begränsa Kubernetes Jobs: kan inte kontrollera
  podtemplaten.
- Publik registry eller ingress i första buildsteget: saknar behov och breddar
  exponeringsytan.
