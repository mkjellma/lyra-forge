# ADR-0001: Forge är ett separat privat deploy-control-plane

- Status: Accepterad för designgrund
- Datum: 2026-07-19

## Kontext

Lyra Forge ska göra privat deployment av ett begränsat antal registrerade
projekt på en Lenovo mini-PC. Lyra Core på Mac är ett separat system. Forge
behöver ge Lyra en säker och begränsad framtida administrationsyta utan att
överföra generell värd- eller shell-kontroll.

Lenovo ska polla GitHub utgående; den ska inte behöva ta emot GitHub-webhooks
eller annan publik inkommande trafik.

## Beslut

Forge definieras som ett separat privat control-plane med ett explicit
projektregister och capability-baserade operationer. V0 pollar registrerade
repo-/branch-par utgående från GitHub och bygger endast en identifierad
commit-SHA i en kortlivad, isolerad build-container. Publicering sker först
efter konfigurerad health check. Föregående fungerande release bevaras för
rollback. Lyra använder Forge-API:t som v0:s avsedda gränssnitt.

Forge ska återanvända etablerade komponenter för build och containerdrift.
Det ska inte ersätta Kubernetes eller implementera egen scheduler,
container-runtime, service mesh eller nätverksplattform.

Tillåtna Forge-operationer för ett registrerat projekt är:

- läs status och deployhistorik
- begär deploy av exakt commit-SHA enligt projektregistret
- restart av registrerad tjänst
- pausa eller återuppta nya deployer
- rollback till en bevarad, verifierad release

Följande kräver alltid uttryckligt ägargodkännande och ligger utanför
capability-ytan:

- nytt eller ändrat repo, branch eller projektregister
- hostuppgradering, OS-, hypervisor-, VM-, nätverks- eller brandväggsändring
- secrets, identiteter, credentialrotation eller åtkomstmodell
- radering, retentionändring eller publik exponering/port-forward
- containerplattform, Docker-socket-policy och VM-ändringar

## Konsekvenser

Forge kan inte fungera som en allmän driftagent. Det minskar funktionell
frihet men begränsar blast radius och gör senare Lyra-integration granskningsbar.
Ägargranskning behövs innan den första verkliga registrationen eller
driftsättningen på Lenovo.

V0 är avsiktligt lättviktigt för en mini-PC. Fler mini-PC:er kan senare läggas
till som isolerade executor-noder via samma capability-gräns, men v0 inför inte
kluster, automatisk nodupptäckt eller autoskalning.

Det innebär också att v0 väljer den minsta befintliga verktygskedjan som kan
bygga och köra pilotprojektet säkert, i stället för att införa en ny
orkestreringsplattform.

## Avvisade alternativ

- Inkommande GitHub-webhooks: kräver ny ingress och breddar attackytan.
- Generell root-SSH eller shell för Lyra/agent: bryter capability-gränsen.
- Autonom deploy av godtycklig repositorykod: saknar explicit register- och
  commitgräns.
