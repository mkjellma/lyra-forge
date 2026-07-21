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

Först införs en build-only executor för den registrerade profilen
`nextjs-npm` och explicit ägarinventerade projekt, med `adesco-webb` som första
post:

- Forge skickar endast `projectId` och exakt commit-SHA över en privat lokal
  Unix-socket till en sidecar i samma pod.
- Executor hämtar endast den registrerade repo-/branch-kombinationen och kör
  den fasta recepten `npm ci` och `npm run build` i en kortlivad, begränsad
  Node-jobbmiljö.
- Builder-image, namespace, CPU/minne/tidsgräns och tillåtna projekt ligger i
  ägarinstallerad konfiguration — aldrig i Lyra-anrop eller repositorykod.
- En build i taget gäller fortsatt. Första steget returnerar endast
  normaliserad, innehållsfri buildstatus. Ett deploybart immutable artifact-id
  införs först tillsammans med en uttryckligt godkänd artifactkanal.
- Forge-kontrollplanet får ingen shell-, `kubectl`-, Docker-socket-, hostPath-
  eller cluster-admin-åtkomst. En Kubernetes-token monteras endast där den
  behövs i executor-komponenten, aldrig i Forge-processen.
- För labbpiloten används en minimal executoridentitet med endast `create` och
  `get` för Jobs, plus en fast, pinnad template: inga fria images/kommandon,
  ingen privileged-/host-åtkomst, ingen service-account-token i buildjobbet
  och fasta resurs-/deadlinegränser. När det privata Adesco-repot läses med
  deploy key ligger den bara i checkout-initcontainern; buildcontainern,
  Forge-processen och Lyra får aldrig nyckeln. RBAC kan inte själv begränsa
  Job-fält, vilket är en medveten, dokumenterad labbtrade-off i v0. Admission
  återinförs först när fler projekt eller noder ger tydlig nytta.

Checkout-initcontainern kör som root inne i den kortlivade `alpine/git`-
containern eftersom den pinnade imagen saknar en användarpost för UID `10001`
och OpenSSH då vägrar starta. Den får fortfarande inga capabilities,
service-account-token, hostmount eller skrivbart rootfilsystem; själva
repositorybuilden körs fortsatt som UID `10001` utan nyckelmount.

Källträdet innehåller en ren owner-side factory för detta fasta Job-template,
en buildinventering och dess minimala RBAC-kontrakt. Inventeringen mappar ett
registrerat projekt till canonical repo, tillåten branch, fast checkout-URL och
separat deploy-key-referens. Att lägga till ett nytt repo är fortfarande ett
ägargodkännande, men kräver ingen kodändring i Forge. Den körs i en sidecar med en projicerad
Kubernetes-token; Forge-processen har varken token eller Kubernetes-klient.
Första buildern är pinnad till Node 24.18.0 för `linux/amd64` och checkouten
till en verifierad `alpine/git`-digest. Båda importeras lokalt till Nocco före
aktivering; buildjobbet pullar inte fritt från nätet.

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
automatisk deploy, andra buildprofiler och publik ingress ligger utanför detta
beslut och kräver separata ägarbeslut. Adescos läsnyckel är ett separat,
repo-bundet ägarbeslut: privatnyckeln finns bara i ett Secret i `forge-build`,
mountas läsbart endast av checkout-initcontainern och blir aldrig Forge-state,
miljövariabel eller buildcontainer-data. GitHubs verifierade host key ligger
separat i en ConfigMap och SSH kör utan interaktiv eller HTTPS-fallback.

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
