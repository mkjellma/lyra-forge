# Lyra Forge — arbetsavtal

## Projektgräns

Lyra Forge är ett separat privat system. Importera inte Lyra Core-kod och
koppla inte Forge till Lyra Cores runtime, Caddy, certifikat, secrets eller
nätverk utan uttryckligt ägargodkännande.

## Säker leverans

- Gör inga ändringar på Lenovo, GitHub, secrets, nätverk, brandvägg,
  containrar eller virtuella maskiner utan uttryckligt ägargodkännande.
- Stanna före stage, commit, push och deployment tills ägaren ber om just den
  releaseåtgärden i den aktuella konversationen.
- Hemligheter får inte skrivas till Git, loggar, klientkod eller exempel.
  Kopiera aldrig Codex OAuth eller Macens Keychain till Lenovo.
- Bygg aldrig in generell root/shell-access, Docker-socket-access för agent,
  delad supercredential, publik ingress, port-forward eller generell webhook.
- Nya repo, ändrad publik exponering, radering, host-/VM-ändringar och
  secrets kräver alltid ägargodkännande.

## Forge-principer

- Kontrollplanet får endast utföra registrerade, typade capability-åtgärder.
- En deploy identifieras av en exakt commit-SHA och publiceras först efter
  godkänd health check.
- Byggkod körs endast från registrerade repo-/branch-par och exakt pinnad
  commit i en kortlivad, isolerad build-container.
- Lyra är det avsedda gränssnittet mot Forge-API:t; Forge erbjuder ingen
  generell administrativ konsol eller shell-yta.
- Auditdata är content-free: registrera metadata och resultat, aldrig
  payloads, source code, miljövärden eller hemligheter.
- Föredra den minsta implementeringen som bevarar isolering, rollback och
  spårbarhet.
- Återanvänd etablerade verktyg för build, artifact, containerdrift och
  observability när de täcker behovet. Bygg inte ett eget Kubernetes-,
  scheduler-, container-runtime- eller nätverkssystem.

## Lokal validering

När kod tillkommer: läs projektets relevanta instruktioner och kör hela den
lokala gate som projektet då definierar. Dokumentändringar ska minst granskas
med Git-diff och kontroll av interna Markdown-länkar.
