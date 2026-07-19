# Adesco — föreslaget Forge-pilotkontrakt

- Status: **Förslag för ägarreview**
- Källa: lokal, skrivskyddad inspektion 2026-07-19
- Ingen GitHub- eller driftsättning har gjorts

## Verifierade förutsättningar

| Fält | Värde | Underlag |
| --- | --- | --- |
| `projectId` | `adesco-webb` | `package.json` |
| Repository | `https://github.com/mkjellma/adesco.git` | lokal Git-remote |
| Tillåten branch | `main` | lokal Git-status |
| Ramverk | Next.js 15 + React 19 + TypeScript | `package.json` |
| Låsfil | `package-lock.json` | arbetsyta |
| Typkontroll | `npm run lint` (`tsc --noEmit`) | `package.json` |
| Produktionsbuild | `npm run build` (`next build`) | `package.json` |
| Runtime | `npm run start` (`next start`) | `package.json` |
| Kontaktformulär | demo; ingen e-postleverans | `app/api/contact/route.ts` |

Den lokalt observerade branchen var `main` vid inspektionen. Detta är inte en
godkänd deploy-SHA och får inte användas som sådan i Forge.

## Föreslaget registervärde

```json
{
  "projectId": "adesco-webb",
  "repository": "https://github.com/mkjellma/adesco.git",
  "allowedBranch": "main",
  "buildProfile": "nextjs-production",
  "runtimeProfile": "private-http",
  "deployPolicy": "manual",
  "healthCheck": {
    "path": "/healthz",
    "timeoutMs": 3000
  },
  "pollIntervalSeconds": 300
}
```

`manual` rekommenderas för första piloten: Forge pollar `main` utgående och
Lyra visar kandidat-SHA, men deploy sker först via den begränsade Forge-API:t.
När hela flödet har verifierats kan ägaren välja `on-new-commit` för detta
enskilda projekt.

## Föreslaget build- och runtimekontrakt

| Fas | Kontrakt |
| --- | --- |
| Checkout | exakt SHA från registrerad `main` |
| Install | `npm ci` från versionslåst `package-lock.json` |
| Gate | `npm run lint` följt av `npm run build` |
| Artifact | OCI-image märkt med commit-SHA och identifierad av image digest |
| Start | `npm run start` inom registrerad private-HTTP-runtimeprofil |
| Resurser | en instans, en build i taget; CPU/minne/tidsgräns beslutas före drift |

## Stoppvillkor före en verklig deploy

1. **Health endpoint saknas.** Projektet har ingen verifierbar `GET /healthz`
   eller likvärdig intern health route. En sådan måste läggas till och testas i
   Adesco under ett separat Adesco-mål innan Forge kan publicera tjänsten.
2. **Node-runtime är inte deklarerad.** `package.json` saknar `engines`,
   `.nvmrc` och `.node-version`. Ägaren måste godkänna en pinnad Node-version
   eller Adesco måste deklarera den i repositoryt innan buildprofilen blir
   reproducerbar.
3. **`NEXT_PUBLIC_SITE_URL` är en driftsinställning.** Koden har en reserv till
   `https://adesco.se`, men slutligt publikt värde, domän och eventuell ingress
   är ägarbeslut. Forge sätter inget värde och skapar ingen publik exponering.
4. **Kontaktleverans är medvetet avstängd.** Ingen mail-provider eller secret
   ska införas som del av Forge-piloten.
5. **Ingen verklig executor finns ännu.** Forge har bara det testade,
   typade kontraktet; en ägarinstallerad rootless Podman/Quadlet-executor krävs
   först i ett senare driftmål.

## Ägarbeslut för nästa mål

- Godkänn `manual` eller välj `on-new-commit` som Adescos deploypolicy.
- Godkänn en pinnad Node-runtime för Adesco.
- Godkänn ett separat, litet Adesco-mål som adderar och testar `GET /healthz`.

Efter dessa beslut kan nästa Forge-mål implementera en lokal Adesco-fixture
mot den befintliga adaptergränsen. Det innebär fortfarande ingen Lenovo- eller
GitHub-ändring.

