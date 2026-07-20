# Roadmap

## Nu

1. Godkänn en separat, ägarstyrd k3s-installation på Lenovo.
2. Skapa en förberedd Forge-namnyta och minsta namespacade rättigheter för den
   fasta Kubernetes-adaptern. Lyra och Forge får aldrig `kubectl`, shell eller
   cluster-admin.
3. Koppla en build-jobbklient till exakt commit-SHA, immutable image-digest,
   health/rollout och rollback i en enda registrerad tjänst.

## Första verkliga testet

1. Registrera ett litet testprojekt med repo, branch, health route och
   resursgräns.
2. Låt Forge poll:a GitHub och deploya en exakt commit-SHA.
3. Kontrollera health check och rollback till föregående fungerande release.

När detta fungerar bygger vi vidare på Forge-API:t som Lyra använder för
projekt, status, deploy, paus, restart och rollback. Fler mini-PC:er kan då
anslutas som k3s-noder först när faktisk belastning motiverar det.

Inga punkter ovan är tillstånd att ändra Lenovo, GitHub, secrets, nätverk eller
driftmiljö utan ett separat ägargodkännande.
