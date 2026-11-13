# FoodiSpots

Gemeinsame Restaurant-Wunschliste auf einer Karte: Spots eintragen, die man besuchen will (grau), nach dem Besuch einzeln bewerten – inklusive eigener Gerichte mit Foto (Marker wird farbig nach Durchschnittsnote).

Basiert technisch auf der Pilzkarte (Supabase + statische PWA auf Netlify).

## Aufbau

```
web/                       statische PWA (Netlify-Publish-Ordner)
  index.html, app.js, styles.css, sw.js, manifest.webmanifest, config.js, Icons
supabase/
  01_schema.sql            Benutzer, Gruppen, Einladungen, RLS
  02_food.sql              Länderküchen, Spots, Wünsche, Besuche, Bewertungen, Gerichte, Storage, Realtime
  functions/signup         Registrierung mit Name + Passwort + Einladungscode
  functions/lookup-spot    Restaurant-Suche (OpenStreetMap) + Anreicherung (Claude-Websuche)
```

Weitere, bereits angewendete Migrationen im Supabase-Projekt:
- `03_allow_photo_replace` – Fotos eines Gerichts austauschbar, Pfade auf Gruppen-/Spot-Ordner beschränkt
- `04_tighten_function_grants` – keine Funktionsaufrufe für nicht angemeldete Nutzer, interne Trigger-Funktionen gesperrt

## Supabase

- Projekt: `bnhagdnfaekhyjbokggp` (eu-central-1)
- Secrets für `lookup-spot`: `ANTHROPIC_API_KEY` (optional `ANTHROPIC_MODEL`, Standard `claude-sonnet-5-5`). Ohne Key nur OpenStreetMap-Daten.
- Der erste registrierte Nutzer braucht keinen Code und wird Super-Admin.

## Deployment (Netlify)

Publish-Ordner: `web/` – kein Build nötig.

## Noch offen

- Push-Benachrichtigungen
- Offline eintragen (offline ansehen funktioniert)
- Filter „jetzt geöffnet“
- Super-Admin-Oberfläche
- Separate Besuche mit Teilnehmerliste (aktuell zählt eine Bewertung als Besuch)
