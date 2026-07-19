# Roadmap

## Nu: designgrund

- Dokumentera systemgräns, driftprinciper och första ADR.
- Fastställ Forge v0:s data, flöde och capability-yta.
- Ändra inga externa system.

## Nästa: ägargranskad specifikation

- Välj ett enda pilotprojekt och dess precisa deploypolicy, build-container-,
  runtime- och health-check-kontrakt.
- Välj minsta etablerade verktygskedja för det kontraktet; undvik egenbyggd
  orkestrering när ett befintligt verktyg täcker behovet.
- Specificera projektregisterformat, release-state-machine och auditfält.
- Specificera nodidentitet, statisk projektplacering och resursgränser innan en
  andra executor-nod får införas.
- Specificera autentisering/auktorisering för den framtida Lyra-ytan utan
  delade supercredentials.
- Besluta artifact-retention, rollbackregler och vilka händelser som kräver
  manuellt ägargodkännande.

## Därefter: lokal implementation och verifiering

- Implementera API-styrt kontrollplan lokalt med testad state-machine och
  content-free auditlogg.
- Lägg till adapter för pollning av ett registrerat GitHub-repo.
- Verifiera exact-SHA-build i kortlivad container, misslyckad health check,
  lyckad publicering, paus och rollback genom lokala tester.

## Senare: ägarstyrd driftsättning

- Granska hostlayout och isolering för Linux/hypervisor och Forge.
- Prova en privat pilot på Lenovo först efter separat ägargodkännande.
- Lägg till den begränsade Lyra-integrationen först när dess kontrakt och
  autentiseringsgräns är granskade.

## Senare: utbyggnad med fler mini-PC:er

- Lägg till en executor-nod i taget efter särskilt ägargodkännande av host,
  nätverk, resurser och projektplacering.
- Inför delad artifactlagring eller mer tålig control-plane-state först när
  minst två noder behöver dela samma release; undvik klusterkomponenter före
  det faktiska behovet.

Ingen punkt ovan ger standing authorization för Lenovo-, GitHub-, nätverks-,
secret-, VM- eller deploymentåtgärder.

## Pilot: Adesco

Adesco är valt som första kandidatsystem. Dess Forge-kontrakt är dokumenterat
som ett förslag i `docs/pilots/adesco.md`. Första deploy kräver fortfarande en
explicit health route, deklarerad Node-runtime och ägarbeslut om deploypolicy.
