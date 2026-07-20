# Lyra → Forge: läsintegration

## Aktuellt läge

- Forge kör privat på Lenovo (`nocco`) i k3s.
- Privat LAN-adress: `http://192.168.1.42:30080`.
- Körande Forge-release: Git-commit `769f894`.
- Projektregistret är tomt. GitHub-pollning, builds och appdeployer är inte
  anslutna.
- Forge har ingen Kubernetes-RBAC och kan inte skapa eller ändra workloads.

## Kontrakt för första Lyra-sprinten

Lyra är endast en läsande klient i första steget. Dess separata
serverkonfigurerade `FORGE_LYRA_READ_TOKEN` medger endast statusläsning; den
är inte en administrativ API-token.

| Endpoint | Syfte |
| --- | --- |
| `GET /v1/status` | Begränsat läskontrakt: schema, tjänstenamn, `forge.read_status` och projekttotal. |

`GET /v1/status` accepterar Lyra-lästoken eller Forge admin-token. Alla andra
`/v1/*`-endpoints kräver admin-token; Lyra-lästoken accepterar varken andra
`GET`-rutter eller `POST`. `/healthz` är endast en intern health-check och ska
inte vara Lyra-funktion.

## Hemligheter och nätverk

- Tokenvärden får aldrig skrivas i Git, klientkod, loggar eller denna handoff.
- Lyra ska läsa sin separata lästoken och bas-URL från sin befintliga säkra
  serverkonfiguration, inte från frontend eller miljövariabler som exponeras
  till klienten. Forge läser lästokenen från sin egen serverkonfiguration,
  aldrig från requestens query eller body.
- Trafiken är för närvarande privat LAN-HTTP. Ingen publik DNS, ingress,
  Caddy-ändring eller router-portforward finns. TLS och en snävare
  nätverksallowlist är uttryckligen senare härdning.

## Gränser för denna integration

Ändra inte Lyra Cores Caddy, certifikat, nätverk eller befintliga secrets.
Importera inte Forge-kod i Lyra Cores runtime. Använd en liten HTTP-klient med
typade, läsande metoder och normaliserade fel. Forge-registrering, deploy,
restart, paus och rollback är senare, separata beslut.
