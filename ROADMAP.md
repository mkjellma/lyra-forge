# Roadmap

## Nu

1. Återanvänd den redan ägarstyrda enkel-nods k3s-motorn på Nocco för en
   build-only executor enligt ADR-0002. Forge installerar eller administrerar
   inte k3s.
2. Skapa minsta namespacade Job-rättighet och fast Job-template för den fasta
   `nextjs-npm`-profilen. Lyra och Forge får aldrig `kubectl`, shell eller
   cluster-admin. I labb-v0 är den fasta templaten och den smala executor-API:t
   primära skydd. Admission utvärderas först när fler projekt eller noder gör
   dess driftkostnad motiverad.
3. Koppla build-jobbklienten till exakt commit-SHA och normaliserad buildstatus
   för en ägarinventerad projektpost. Adesco har verifierat första vägen.
   Detta är inte en runtime-deploy. Immutable artifact-id kommer först med en
   separat, godkänd artifactkanal.

## Första verkliga testet

1. Adesco har byggts från privat GitHub-repo på exakt SHA med en repo-bunden
   read-only deploy key.
2. Lägg till nästa projekt i både Forge-registret och den ägarstyrda
   buildinventeringen; det ska inte kräva någon kodändring.
3. Besluta separat om artifact-publicering, runtime-deploy, health check och
   rollback till föregående fungerande release.

När detta fungerar bygger vi vidare på Forge-API:t som Lyra använder för
projekt, status, deploy, paus, restart och rollback. Fler mini-PC:er kan då
anslutas som k3s-noder först när faktisk belastning motiverar det.

Inga punkter ovan är tillstånd att ändra Lenovo, GitHub, secrets, nätverk eller
driftmiljö utan ett separat ägargodkännande.
