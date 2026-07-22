# ADR-0004: Begränsad Forge-översikt för Lyra

- Status: Accepterad för implementation, ej aktiverad på Nocco
- Datum: 2026-07-21

## Kontext

Den första Lyra-integrationen visar endast om Forge svarar och ett
projekttotal. Det räcker inte för att ge ägaren en begriplig bild av Forge som
helhet: dess fasta systemdelar, registrerade applikationer och övergripande
release-läge. Samtidigt får Lyra inte bli en Kubernetes-klient, en
administrativ Forge-principal eller en källa till läsningar som kan trigga
runtime-reconciliation.

## Beslut

Forge lägger till `GET /v1/overview`. Den accepterar enbart den separata
serverkonfigurerade `FORGE_LYRA_READ_TOKEN` och returnerar ett strikt
`forge.read-overview.v1`-dokument:

- tre kodägda systemdelar: control-plane, build-executor och runtime-executor;
- högst 64 deterministiskt sorterade applikationer med registrerat id,
  provisioning-läge, deploypaus och en abstrakt aktiv/kandidat-release-status;
- `total` och `truncated` när fler applikationer finns.

Översikten byggs enbart från Forge-processens projektregister och
release-state. Den anropar inte status-, historik-, build-, deploy-,
reconcile-, runtime- eller persistensmetoder och har därför ingen
skrivauktoritet. Den visar inte raw Kubernetes- eller hoststatus; `configured`
betyder att den fasta Forge-komponenten är konfigurerad, inte att en specifik
container eller podd är observerad som körande.

`GET /v1/status` och dess `forge.read_status`-kontrakt behålls oförändrat för
den redan driftsatta, äldre Lyra-klienten. Båda läsrutterna avvisar query
strings. Den separata lästoken måste vara exakt 64 hextecken, får inte vara
admin-tokenen och kan inte använda några andra routes.

## Avgränsning

Översikten exponerar inte repo, branch, commit-SHA, artifact/release-/build-/
deployment-id, fel, tidpunkter, paths, namespace, poddar, images, services,
portar, IP-adresser, capability-listor eller hemligheter. Den ger ingen
administration, deploy, omstart, paus eller rollback.

Inga Nocco-, k3s-, nätverks- eller secretändringar ingår. Att bygga och
driftsätta denna Forge-version är ett separat ägarbeslut.

## Konsekvenser

Lyra kan ge en användbar, generell Forge-vy med samma små läsidentitet. Vid
större inventarier visar den en tydlig avkortning snarare än att göra ett
obundet svar. Fördjupad rå runtime-telemetri är ett senare, separat beslut med
en explicit icke-muterande adaptergräns.
