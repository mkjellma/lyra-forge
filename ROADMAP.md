# Roadmap

## Nu

1. Återanvänd den redan ägarstyrda enkel-nods k3s-motorn på Nocco för en
   build-only executor enligt ADR-0002. Forge installerar eller administrerar
   inte k3s.
2. Skapa minsta namespacade Job-rättighet och fast Job-template för den fasta
   `nextjs-npm`-profilen. Lyra och Forge får aldrig `kubectl`, shell eller
   cluster-admin. Om en build får använda en credential måste en liten
   admission-policy låsa dess exakta Job-template.
3. Koppla build-jobbklienten till exakt commit-SHA och normaliserad buildstatus
   för Adesco. Detta är inte en runtime-deploy. Immutable artifact-id kommer
   först med en separat, godkänd artifactkanal.

## Första verkliga testet

1. Registrera ett litet testprojekt med repo, branch, health route och
   resursgräns.
2. Låt Forge poll:a GitHub och bygga en exakt commit-SHA efter separat
   credentialbeslut om repot inte är publikt.
3. Besluta separat om artifact-publicering, runtime-deploy, health check och
   rollback till föregående fungerande release.

När detta fungerar bygger vi vidare på Forge-API:t som Lyra använder för
projekt, status, deploy, paus, restart och rollback. Fler mini-PC:er kan då
anslutas som k3s-noder först när faktisk belastning motiverar det.

Inga punkter ovan är tillstånd att ändra Lenovo, GitHub, secrets, nätverk eller
driftmiljö utan ett separat ägargodkännande.
