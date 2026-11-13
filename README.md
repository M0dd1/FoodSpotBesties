# FoodiSpots

Gemeinsame Restaurant-Wunschliste auf einer Karte: Spots eintragen, die ihr besuchen wollt (grau), nach dem Besuch bewertet jede Person für sich – mit eigenen Gerichten und Fotos. Die Marker färben sich nach der Durchschnittsnote, die Flagge zeigt die Länderküche.

Aufgebaut nach der Prompt in [`PROMPT.md`](PROMPT.md), technisch wie die Pilzkarte: statische PWA ohne Build-Schritt, Supabase, Netlify.

## Aufbau

```
index.html, styles.css, config.js, cuisines.js, exif.js, sw.js, manifest.webmanifest, robots.txt, icons/, img/
js/                 App-Module (core, ui, auth, start, groups, sync, photos, map, list, views, lookup, spots, ratings, settings, admin, invites, conflicts, trash, main)
supabase/
  migrations/       Datenbank-Änderungen in Reihenfolge (01–05)
  functions/        Edge Functions: signup, lookup-spot, backup-export
schema.sql          alle Migrationen in einer Datei (Neuinstallation)
tests/              Browser-Tests mit Test-Backend (Playwright)
scripts/backup.mjs  Sicherung (wird vom Workflow „Sicherung“ aufgerufen)
.github/workflows/  tests.yml (bei jedem Push), backup.yml (Mo + Do nachts)
```

## Supabase

- Projekt `bnhagdnfaekhyjbokggp` (EU Frankfurt). Publishable Key steht in `config.js`.
- Edge Functions:
  - `signup` – Registrierung mit Name, Passwort und Einladungscode (legt das Konto bestätigt an, keine E-Mail).
  - `lookup-spot` – Restaurant-Suche über OpenStreetMap, Anreicherung per Claude-Websuche. Nur angemeldet, max. 200 Aufrufe pro Person und Tag.
  - `backup-export` – Export für die Sicherung, nur mit `BACKUP_TOKEN`.
- Secrets (Supabase → Edge Functions → Secrets):
  - `ANTHROPIC_API_KEY` (optional): ohne Key nur OpenStreetMap-Daten. Optional `ANTHROPIC_MODEL`, `LOOKUP_MAX_PER_DAY`.
  - `BACKUP_TOKEN` (mind. 32 Zeichen, gleicher Wert als GitHub-Repository-Secret).
- Super-Admin wird das Konto **„Marcel“**. Das allererste Konto braucht keinen Einladungscode.

## Netlify

Build-Befehl und Header stehen in `netlify.toml`. Veröffentlicht wird nur `dist/` (App-Dateien); Tests, SQL, Skripte und Anleitungen bleiben privat.

## Tests

```
cd tests && npm install && npx playwright install chromium && npm test
```

Ohne Internet (Leaflet nicht installiert) nutzen die Tests einen kleinen Leaflet-Ersatz; in GitHub Actions läuft das echte Leaflet.
