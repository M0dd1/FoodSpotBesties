# Änderungen

## 2.0.1
- Spot-Suche: Nominatim sperrt Anfragen vom Supabase-Server (403). Die Suche weicht jetzt automatisch auf Photon + OpenStreetMap-API aus (gleiche Daten: Adresse, Länderküche, Öffnungszeiten, Webseite, Telefon).

## 2.0.0 – 13.11.2026

Kompletter Neuaufbau nach der FoodiSpots-Prompt (Architektur der Pilzkarte).

**Für Nutzer**
- Anmeldung nur mit Name + Passwort, Registrierung nur mit Einladungscode; Hinweis „privates Angebot“.
- Gruppen mit Einladungslink/-code, Admins, Gruppenwechsel; Einladungen zu FoodiSpots ohne Gruppe (1 Konto, 30 Tage, max. 10 offen).
- Spot eintragen über ein Suchfeld („delphi koblenz“): Treffer aus OpenStreetMap, Formular vorbefüllt, Anreicherung (Länderküche „vermutet“, Beschreibung, Preis, Spezialitäten, Quellen), Dubletten-Hinweis. Außerdem auf der Karte wählen, langes Drücken, ohne Suche.
- Länderküchen (Kroatisch, Spanisch …) als Liste mit Regionen; Flagge im Marker; Übersicht „X von Y probiert“.
- „Will ich auch!“, „Waren wir!“ mit gemeinsamem Besuch, Bewertung jeder Person für sich (Gesamt + Essen/Service/Ambiente/Preis-Leistung, „wieder hingehen?“).
- Eigene Gerichte mit Foto, Sternen, Preis, Notiz; Vorschläge und „Hatte auch …“; Reiter „Gerichte“; bestes Gerichtfoto als Titelbild.
- Marker grau (Wunschliste) bzw. farbig nach Durchschnittsnote; Stapeln, Auffächern, Zusammenfassen bei sehr vielen Spots.
- Liste mit Suche (auch nach Gerichten) und Sortierung; Filter inkl. „Jetzt geöffnet“; „Wohin heute?“.
- Kommentare, Papierkorb (30 Tage), gleichzeitiges Bearbeiten mit Auswahl der Version.
- Offline: Start aus dem Speicher, Bewerten und Eintragen ohne Netz, Hinweis „Neue Version“.
- Öffentlicher Lese-Link (ohne Namen, Kommentare und Einzelbewertungen), Export als CSV und JSON, Dunkelmodus.
- Admin-Bereich für Super-Admins inkl. Pflege der Länderküchen.

**Datenbank** (Migration `05_pilzkarte_standard`)
- `user_id` → `created_by` bei Bewertungen, Gerichten und Wünschen; Kommentare; Lese-Link; Admin-Funktionen; Super-Admin „Marcel“; Tageslimit der Suche (`lookup_usage`); Indizes auf allen Fremdschlüsseln; Funktionsrechte für `anon` entzogen.

## 1.0.0 – 13.11.2026

Erste Version (einzelne Seite, ohne Offline-Warteschlange und Tests).
