# ADR-0003: Privat OCI-artifactkanal för första runtime-vägen

- Status: Accepterad för implementation, ej aktiverad på Nocco
- Datum: 2026-07-21

## Beslut

Den första `private-http`-runtimen använder en liten intern OCI-registry med
egen lokal volym och enbart `ClusterIP`. En fast artifactbyggare publicerar en
Next.js-tar för exakt commit till registry:n. Forge sparar registry:ns
manifest-digest som release-artifact och startar en kandidat från
`repository@sha256:...`.

Detta ersätter inte k3s, containerd eller registry-protokollet. Registry:n är
en etablerad `registry:2`-tjänst; ORAS används bara för att publicera och
hämta artifacten. Vid senare Nocco-aktivering väljs och importeras pinnade
image-digests för registry och ORAS av ägaren.

## Flöde

1. En typad deploy för commit-SHA skapar en kortlivad artifactbyggare i
   `forge-build`.
2. Checkout och `npm ci`/`npm run build` använder den redan godkända,
   repo-bundna deploy keyn. Publishern har aldrig GitHub-nyckeln.
3. Publishern lägger `app.tar` i den interna registry:n under commit-taggen.
   Executorn läser sedan registry:ns faktiska manifest-digest.
4. En kandidat-Deployment i `forge-runtime` hämtar `repository@digest`,
   packar upp till `emptyDir` och kör den fasta profilen `npm start`.
5. Kandidatens readiness check använder projektets registrerade interna
   health-path. Först när just kandidaten är Ready växlar en privat ClusterIP
   Service till dess release-label.
6. Föregående artifact-digest och releasepost behålls. Rollback startar en ny
   kandidat från exakt föregående digest, aldrig från en muterbar tagg.

## Avgränsning

Ingen ingress, NodePort för applikationen, domän, publik registry eller
GitHub-token införs. Forge- och Lyra-processen får fortsatt ingen
Kubernetes-token. Endast den privata runtime-executorn har ett smalt,
namespacat Kubernetes-kontrakt.

För labb-v0 kan registry:n vara intern utan egen auth. Det är en medveten
trade-off inom k3s-nätet, inte en publik exponeringsmodell. Auth, retention,
flera noder och automatisk garbage collection kommer först när behov finns.
