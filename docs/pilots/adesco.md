# Adesco — föreslaget Forge-pilotkontrakt

- Status: **Godkänt mål: pending/manual-registrering och build-executor**
- Källa: lokal inspektion uppdaterad 2026-07-21
- Ingen runtime-deploy eller publik exponering ingår

## Verifierade förutsättningar

| Fält | Värde | Underlag |
| --- | --- | --- |
| `projectId` | `adesco-webb` | `package.json` |
| Repository | `https://github.com/mkjellma/adesco.git` | lokal Git-remote |
| Tillåten branch | `main` | lokal Git-status |
| Ramverk | Next.js 15 + React 19 + TypeScript | `package.json` |
| Låsfil | `package-lock.json` | arbetsyta |
| Node-runtime | `24.18.0` | `package.json`, `.node-version` |
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
  "buildProfile": "nextjs-npm",
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
| Gate | `npm run build` |
| Resultat | innehållsfri buildstatus för exakt SHA; ingen artifactkanal eller registry i detta steg |
| Start | ingen runtime start i detta build-only steg |
| Resurser | en instans, en build i taget; CPU/minne/tidsgräns beslutas före drift |

## Stoppvillkor före en verklig deploy

1. **`GET /healthz` finns och är testad.** Den behövs först vid en senare
   runtime-deploy; build-only executor använder den inte.
2. **Node-runtime är deklarerad.** Adesco binder `24.18.0` i både
   `package.json` och `.node-version`.
3. **`NEXT_PUBLIC_SITE_URL` är en driftsinställning.** Koden har en reserv till
   `https://adesco.se`, men slutligt publikt värde, domän och eventuell ingress
   är ägarbeslut. Forge sätter inget värde och skapar ingen publik exponering.
4. **Kontaktleverans är medvetet avstängd.** Ingen mail-provider eller secret
   ska införas som del av Forge-piloten.
5. **Artifact, runtime och publicering saknas med avsikt.** Första
   executorsteget verifierar bara den typade `nextjs-npm`-profilen i Nocco
   k3s. Artifactkanal, registry, app-runtime, domän och ingress kräver ett
   senare uttryckligt beslut.

## Ägarbeslut för nästa mål

- `manual` är godkänd för första piloten.
- En riktig GitHub-pollning behöver ett separat credentialbeslut endast om
  repot inte är publikt.
- Första lyckade build och varje senare runtime-/publiceringssteg verifieras
  mot exakt commit-SHA innan någon deploy kan begäras.
