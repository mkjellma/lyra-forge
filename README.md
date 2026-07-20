# Lyra Forge

Lyra Forge är en privat deployplattform för ett litet, uttryckligen registrerat
urval av Codex/Lyra-projekt. Den körs separat från Lyra Core på Mac och är
avsedd för en Lenovo mini-PC i det privata nätet.

Forge v0 använder utgående GitHub-pollning för att upptäcka nya commits på
tillåtna brancher. När ett registrerat projekt ska deployas bygger Forge exakt
commit i en kortlivad build-container, testar resultatet, växlar endast till en
frisk version och behåller föregående version för rollback. Lyra är v0:s
avsedda gränssnitt mot Forge-API:t.

## Status

Detta repository innehåller en lokal, testad Forge-kärna. Den installerar
ingenting, kontaktar inte GitHub och ändrar inte Lenovo, nätverk, secrets eller
containrar av sig själv.

## Dokument

- [Arkitektur](ARCHITECTURE.md)
- [Roadmap](ROADMAP.md)
- [Arbetssätt för agenter](AGENTS.md)
- [ADR-0001: privat deploy-control-plane](docs/adr/0001-private-deploy-control-plane.md)
- [Förslag 0001: verktygskedja för v0](docs/decisions/0001-v0-toolchain-proposal.md)
- [Förslag 0002: historiskt Coolify-förslag](docs/decisions/0002-deploy-engine-proposal.md)

## Forge v0 i korthet

- Projektregister med explicit repo, branch, build/start-konfiguration och
  intern health check.
- Utgående pollning av GitHub för registrerade repo-/branch-par.
- Kortlivade, isolerade build-containrar samt immutable deploymetadata och
  artifact knutna till en exakt commit-SHA.
- Kandidatstart, health check, atomisk publicering och rollback till senaste
  fungerande release.
- Content-free auditlogg och en begränsad, typad API-yta som Lyra använder för
  status, deploy, restart, paus och rollback.

V0 är inte en generell CI/CD-tjänst och exponerar varken shell, Docker-socket
eller fri repositorykod som kontrollplan.

Forge återanvänder etablerade bygg- och containerverktyg där de passar.
Projektet bygger inte ett eget Kubernetes-, container-runtime-, scheduler- eller
nätverkssystem.

Forge ska vara lättviktigt nog för en mini-PC: få långlivade processer, inga
alltid körande klusterkomponenter och begränsad samtidighet för builds. När fler
mini-PC:er tillkommer ska de kunna adderas som isolerade executor-noder bakom
samma begränsade Forge-API, inte genom att Lyra får bredare värdåtkomst.

## Lokal utvecklingsgrund

Den första körbara kärnan använder enbart Node.js standardbibliotek. Den
innehåller ett Lyra-skyddat API för att lista och registrera projekt via
`GET`/`POST /v1/projects`. En registrering sparas lokalt med status `pending`;
den skapar ännu ingen GitHub-, Kubernetes- eller värdresurs. Den smala interna
provisioneringsgränsen är avsedd för den senare, godkända k3s-motorn.

`GET /v1/status` är det stabila, bearer-skyddade ingångskontraktet för Lyra.
När den valfria serverkonfigurerade `FORGE_LYRA_READ_TOKEN` används får den
endast läsa denna route och får ett begränsat kontrakt med schema, tjänstenamn,
projekttotal och `forge.read_status`. Den ger varken åtkomst till övriga
`GET`-rutter eller någon `POST`-route. Den befintliga `FORGE_API_TOKEN` är
fortsatt adminidentiteten och behåller sitt detaljerade statuskontrakt. Inga
tokenvärden tas från query/body eller loggas.

Kärnan innehåller också projektregister, release-state-machine,
content-free auditlogg, atomiskt sparad lokal state med filrättighet `0600` och
ett loopback-bundet, bearer-skyddat API. Buildflödet är serialiserat till en
build i taget för att skydda den första mini-PC:n.

GitHub-adaptern är medvetet avvisande i den körbara processen tills en separat,
registrerad GitHub-integration har godkänts. En typad Kubernetes-adapter finns
för k3s, men ingen Kubernetes-klient eller installation är ansluten. Tester
använder explicita fake-adaptrar för att verifiera deploy, health-check-fel,
paus och rollback utan att kontakta GitHub eller skapa containrar.

Den adapterklara grunden innehåller också en GitHub REST-pollare som kräver en
injekterad HTTP-klient och en executor-adapter som kräver en injekterad
transport. De kan därför testas med lokala fixtures men öppnar aldrig själva
nätverk, socket eller processer. Pollstatus är content-free och sparas i lokal
Forge-state när en riktig pollningsadapter ansluts.

Kör den lokala gate:n med:

```sh
npm run check
```

`npm start` kräver en lokal `FORGE_API_TOKEN`-miljövariabel och lyssnar som
standard på `127.0.0.1:3000`. `FORGE_LYRA_READ_TOKEN` är valfri, måste vara
skild från admin-tokenen och läses endast från serverkonfigurationen.
Containern använder samma `/healthz`-endpoint internt; den skapar ingen publik
exponering. Lägg aldrig tokenvärden i Git.
