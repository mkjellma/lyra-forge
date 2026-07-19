# Roadmap

## Nu

1. Godkänn Coolify som Forge-motor.
2. Ägaren godkänner en separat Lenovo-installation av Coolify. Det innebär
   Docker och en privat administrativ åtkomstväg; Forge och Lyra får fortfarande
   varken shell-, root- eller Docker-socket-access.
3. Sätt upp ett enda Forge-team och en begränsad API-token (`read`, `write`,
   `deploy`). Ingen publik domän, webhook eller auto-deploy.

## Första verkliga testet

1. Registrera ett litet testprojekt med repo, branch, health route och
   resursgräns.
2. Låt Forge poll:a GitHub och deploya en exakt commit-SHA.
3. Kontrollera health check och rollback till föregående fungerande release.

När detta fungerar bygger vi vidare på Forge-API:t som Lyra använder för
projekt, status, deploy, paus, restart och rollback. Vi tar inte in fler
mini-PC:er eller Kubernetes förrän en Lenovo faktiskt blivit en begränsning.

Inga punkter ovan är tillstånd att ändra Lenovo, GitHub, secrets, nätverk eller
driftmiljö utan ett separat ägargodkännande.
