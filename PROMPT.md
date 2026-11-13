# Prompt: FoodiSpots – gemeinsame Restaurant-Wunschliste als PWA

> Diese Prompt beschreibt die App „FoodiSpots“. Sie ist aus der Prompt der **Pilzkarte** (Version 2.12.0) abgeleitet:
> gleiche Technik, gleiche Sicherheit, gleiche Arbeitsweise – fachlich aber auf Restaurants, Besuche und Bewertungen umgestellt.
> Sie ist dafür gedacht, die App mit einem KI-Assistenten (neu) aufzubauen, auf ein neues Konto umzuziehen oder als Referenz
> für Erweiterungen zu dienen. Einfach komplett in einen neuen Chat kopieren.

---

## 0. Deine Rolle

Du bist ein erfahrener Web-Entwickler und baust für mich eine **kostenlose, installierbare Web-App (PWA) auf Deutsch**,
mit der eine kleine Gruppe von Leuten Restaurants, Imbisse, Cafés und Bars, die sie **besuchen wollen**, auf einer Karte sammelt,
sie nach dem Besuch **jeder für sich bewertet** – inklusive der eigenen Gerichte mit Foto – und alles geräteunabhängig
(iPhone, Android, Computer) miteinander teilt. Ich bin kein Profi-Entwickler: Erkläre Schritte, die ich selbst machen muss,
kurz und klickgenau. Alles, was du selbst erledigen kannst (Code, Datenbank, Deploy, Tests), erledigst du selbst.

**Arbeite in dieser Reihenfolge:**
1. Stelle zuerst die Rückfragen aus Abschnitt 1 – gesammelt, als Auswahlfragen wo möglich. Baue erst, wenn die Antworten da sind.
2. Richte die Verbindungen ein (GitHub, Supabase, Netlify, ggf. Claude-API-Key) und prüfe jede einzeln.
3. Baue die App in Etappen (Abschnitt 9) und veröffentliche nach jeder Etappe. Ich will den aktuellen Stand immer live sehen.
4. Teste jede Etappe automatisch und prüfe die Live-Seite, bevor du „fertig“ meldest.

---

## 1. Rückfragen, bevor du anfängst

Frag mich das Folgende. Wo es eine sinnvolle Empfehlung gibt, schlag sie als erste Option vor.

### Allgemein
1. **Name der App und der ersten Gruppe?** (bisher: „FoodiSpots“, Gruppe z. B. „Foodies Koblenz“)
2. **Wer wird Super-Admin?** (Vorschlag: der Nutzername **„Moddi“**, nur dieser eine)
3. **Auf welchen Geräten wird hauptsächlich genutzt?** (iPhone/Safari, Android/Chrome, beides). Wichtig für Kamera, Push und Foto-Formate (HEIC).
4. **Startregion der Karte?** (z. B. Koblenz) – wird angezeigt, solange es noch keine Spots gibt.

### GitHub
5. **Gibt es schon ein Repository?** Wenn ja: welches (`besitzer/name`)? Wenn nein: soll ich es anlegen, oder legst du es an?
   (Hinweis: Ein KI-Assistent kann oft keine neuen Repositories anlegen – dann lege ich es leer an, ohne README.)
6. **Ist das Repository privat?** Es *muss* privat sein, weil die automatische Datensicherung Spots, Bewertungen und Fotos dort ablegt.
   Wenn öffentlich: Bitte unter *Settings → General → Danger Zone → Change visibility → Private* umstellen.
7. **Habe ich Schreibzugriff?** Prüfe selbst, ob du pushen kannst. Wenn nicht: Erkläre mir, wie ich dir Zugriff gebe
   (GitHub-App für das Repository freigeben: *github.com/apps/claude/installations/select_target → Konto → Repository access*).
   Rate keine Zugangsdaten und frag nicht nach meinem Passwort.
8. **Darf ich GitHub Actions nutzen?** (für Tests bei jedem Push und die Sicherung zweimal pro Woche)

### Supabase (Datenbank, Anmeldung, Foto-Speicher, Edge Functions)
9. **Gibt es schon ein Supabase-Projekt?** Wenn ja: Projekt-Link bzw. Projekt-ID.
   Wenn nein: Lege es an bzw. erkläre mir das Anlegen (kostenloser Tarif, Region **EU (Frankfurt)**). Im Free-Plan sind zwei Projekte kostenlos.
10. **Kannst du direkt mit Supabase verbunden werden** (Supabase-Connector/MCP)? Dann richte ich Datenbank, Edge Functions
    und Secrets selbst ein. Sonst brauche ich nur **Project URL** und **Publishable Key** (`sb_publishable_…`).
    → **Niemals** nach dem `service_role`-/Secret-Key oder dem Datenbank-Passwort fragen und sie nirgends speichern.
11. **„Confirm email“ ausschalten?** Ist für die Anmeldung mit Name + Passwort nötig (*Authentication → Providers → Email*).
    Alternative ohne Dashboard-Klick: Registrierung über eine Edge Function, die den Nutzer bestätigt anlegt.

### Restaurant-Suche
12. **Automatische Anreicherung per KI?** Für Küchenrichtung, Kurzbeschreibung, Preisniveau und Spezialitäten nutzt die Suche
    die Claude-API mit Websuche. Dafür brauchst du einen **API-Key** (console.anthropic.com), den du selbst als Supabase-Secret
    `ANTHROPIC_API_KEY` einträgst (*Edge Functions → Secrets*). → Den Key **nie** in den Chat schreiben lassen.
    Ohne Key: nur Daten aus OpenStreetMap (Adresse, Küche, Öffnungszeiten, Webseite).

### Netlify (Hosting)
13. **Gibt es ein Netlify-Konto bzw. eine Seite?** Wenn ja: Seitenname (z. B. `foodispots.netlify.app`).
14. **Ist Netlify mit dem GitHub-Repository verbunden** (automatischer Deploy bei jedem Push auf `main`)?
    Wenn nicht: Schritt für Schritt erklären (*Add new site → Import from Git → GitHub → Repository wählen*).
    Hinweis: Wird das Repository nachträglich privat gestellt, muss die Verbindung in Netlify eventuell neu autorisiert werden.
15. **Eigene Domain/Subdomain gewünscht** (z. B. `essen.meinedomain.de`, Domain liegt bei einem anderen Anbieter)?
    Dann erklären: In Netlify *Domain management → Add domain*, beim DNS-Anbieter einen **CNAME** `essen` → `<seite>.netlify.app`
    anlegen, warten bis DNS durch ist, dann HTTPS-Zertifikat in Netlify bestätigen. Häufige Fehler nennen
    (falscher Hostname im CNAME, alter A-Record vorhanden, DNS-Caching, Zertifikat noch nicht ausgestellt).

### Funktionen und Daten
16. **Bewertung: nur Gesamtnote oder auch Unterpunkte?** (Empfohlen: Gesamtnote Pflicht, Essen / Service / Ambiente / Preis-Leistung optional)
17. **Markerfarbe nach Durchschnittsnote** (rot 1 → grün 5) und Küchen-Flagge im Marker? (Empfohlen: ja; Alternative: Farbe nach Küche)
18. **Öffentlicher Lese-Link pro Gruppe?** (z. B. „Unsere Top-Spots“ für Freunde ohne Konto – ohne Namen, ohne Kommentare.) (Empfohlen: aus, bei Bedarf an)
19. **Push-Benachrichtigungen** bei neuen Spots und neuen Bewertungen? (Auf dem iPhone nur, wenn die App über „Zum Home-Bildschirm“ installiert ist.)
20. **Sicherung ins Repository?** (Empfohlen: ja, Mo + Do nachts. Dafür braucht es ein gemeinsames Geheimnis `BACKUP_TOKEN`
    als Supabase-Secret *und* als GitHub-Repository-Secret.)
21. **Gibt es schon Daten, die übernommen werden sollen** (z. B. eine Liste mit Restaurants, ein JSON-Backup aus dem Branch `backup`)?

---

## 2. Technik (bitte so beibehalten)

- **Kein Build-Schritt, keine Frameworks:** Vanilla JavaScript als ES-Module, HTML, CSS.
  Netlify kopiert beim Deploy nur die App-Dateien nach `dist/` (siehe Abschnitt 7).
- **Karte:** Leaflet 1.9.4 (unpkg) mit einer gut lesbaren Stadtkarte (z. B. CARTO Voyager oder OpenStreetMap) und Satellitenbild als zweiter Ebene.
- **Backend:** Supabase: Postgres mit Row Level Security, Auth (Passwort), privater Storage-Bucket `food-photos`,
  Realtime, Edge Functions. Client: `@supabase/supabase-js` als UMD von jsDelivr,
  **auf eine exakte Version festgelegt** und mit **SRI-Prüfsumme**.
- **Restaurant-Suche (Edge Function `lookup-spot`):**
  - `search`: Freitext (z. B. „delphi koblenz“) → **Nominatim/OpenStreetMap** mit `extratags`, `addressdetails`, `namedetails`.
    Gastronomie-Treffer (`amenity=restaurant|fast_food|cafe|bar|pub|biergarten|ice_cream`, `shop=bakery|pastry`) zuerst,
    nach Nähe zum Kartenausschnitt bzw. eigenen Standort sortiert, max. 5. Nichts gefunden → zweiter Versuch mit „… restaurant“.
    Nominatim-Regeln einhalten: eigener User-Agent, max. 1 Anfrage pro Sekunde, Ergebnisse 7 Tage cachen (Tabelle `lookup_cache`).
  - OSM-Tags umrechnen: `cuisine` → Länderküche(n) + Schwerpunkt (z. B. `croatian` → Kroatisch, `tapas` → Spanisch + „Tapas“,
    `kebab` → Schwerpunkt „Döner/Kebab“), `amenity` → Art des Lokals, `diet:vegetarian/vegan`, `website`, `phone`, `opening_hours`.
  - `enrich`: für den gewählten Treffer (oder nur den Freitext, wenn OSM nichts hat) **Claude-API mit Websuche**.
    Ergebnis als festes JSON: Länderküche(n) **nur aus der eigenen Liste**, Art, Schwerpunkt, Preisniveau 1–4, Beschreibung (1–2 Sätze),
    Spezialitäten, Webseite, **Quellen-URLs**. Nichts erfinden, Unbekanntes leer lassen. 30 Tage cachen.
    Ohne OSM-Treffer: recherchierte Adresse per Nominatim in Koordinaten umwandeln.
  - Nur für angemeldete Nutzer; API-Key nur als Supabase-Secret.
- **Offline:** Service Worker (Shell-Cache mit Versionsnummer + Kachel-Cache, max. 3000 Kacheln),
  IndexedDB für die lokale Kopie der Daten, eine **Offline-Warteschlange** (Outbox) und die Foto-Blobs.
  Was offline eingetragen wird (Spot per Hand, Bewertung, Gerichte mit Fotos), wird automatisch hochgeladen, sobald wieder Netz da ist.
  Die Restaurant-Suche braucht Netz; offline eingetragene Spots werden beim Hochladen optional nachträglich angereichert.
- **Leistung:**
  - **App startet immer sofort aus dem Speicher** (Service Worker „Speicher zuerst“), auch offline.
    Updates kommen über einen neuen Service Worker: Netlify setzt bei jedem Deploy eine Build-Kennung in `sw.js`
    (`__BUILD__` → Commit + Zeit), der Browser lädt die neue Version im Hintergrund vollständig vor und die App zeigt
    „Neue Version von FoodiSpots ist da – Neu laden“. Eigene Dateien sind beim Vorabladen Pflicht, CDN-Bibliotheken optional.
  - **Echtzeit ohne Neuladen:** Änderungen anderer (Supabase Realtime) werden direkt eingearbeitet; nur Mitglieder-Änderungen
    laden komplett neu. Beim Zurückkehren in die App nur dann komplett neu laden, wenn sie länger als 30 s im Hintergrund war,
    die Echtzeit-Verbindung weg ist oder der letzte Abgleich über 10 Minuten her ist.
  - **Verzeichnisse statt Durchsuchen:** Bewertungen, Gerichte, „Will ich auch“ und Titelbild je Spot werden einmal pro Datenstand aufgebaut.
  - **Karte:** Marker werden wiederverwendet und nur im sichtbaren Ausschnitt (+ Rand) gezeichnet. Liegen mehr als
    250 Spots auf dem Bildschirm, werden sie zu runden Gruppen mit Zahl zusammengefasst; ein farbiger Ring zeigt die Anteile
    (Wunschliste grau / besucht nach Note), Antippen zoomt hinein.
  - **Liste** baut sich schrittweise auf (60 Einträge, beim Scrollen die nächsten), ein Klick-Handler für alle Einträge.
  - Messlatte (Computer): 3.000 Spots → Start ~0,6 s, Liste öffnen ~0,05 s, Filter ~0,03 s.
  - Datenbank: Indizes auf allen Fremdschlüsseln.
- **Code-Aufteilung** (`js/`): `core` (Hilfsfunktionen, Supabase-Client, IndexedDB, Zustand), `ui` (Sheet, Formular-Bausteine, Sterne),
  `auth`, `start`, `push`, `groups`, `sync` (Laden, Echtzeit, Warteschlange), `photos`, `map`, `list`, `lookup` (Suche + Anreicherung),
  `spots`, `ratings` (Bewertung + Gerichte), `cuisines` (Länderküchen-Übersicht), `settings`, `admin`, `invites`, `conflicts`, `trash`, `main`.
  Dazu im Hauptordner `config.js` (URL + Publishable Key), `cuisines.js` (Flaggen/Emojis als Ersatz, falls offline), `exif.js`, `sw.js`.
- **Sprache:** Oberfläche komplett Deutsch, du-Form, kurze verständliche Texte. Datumsformat und Preise deutsch (`14,50 €`).
- **Design:** warme Food-Farben (Creme, Tomatenrot als Hauptfarbe, Senfgelb als Akzent, dunkles Braun für Text),
  Serifen-Überschrift (z. B. Fraunces) + gut lesbare Sans (z. B. Source Sans 3), **automatischer Dunkelmodus**,
  große Bedienelemente für Handys, Bottom-Sheet für Details, oben Reiter „Karte“ / „Liste“ / „Länderküchen“,
  unten die runden Knöpfe **„＋ Spot eintragen“** und **„🎲 Wohin heute?“**.

---

## 3. Datenmodell (Supabase / Postgres)

Alle Tabellen mit RLS. Hilfsfunktionen `is_member(gid)`, `is_admin(gid)`, `is_super_admin()` als SECURITY DEFINER.
Super-Admins gelten in jeder Gruppe als Admin.

| Tabelle | Wichtige Spalten |
|---|---|
| `profiles` | `id` (= auth user), `username` (eindeutig), `display_name` |
| `super_admins` | `user_id` – RLS ohne Policies, nur über Funktionen erreichbar |
| `groups` | `name`, `invite_code` (8 Zeichen), `share_token` (Lese-Link), `created_by` |
| `group_members` | `group_id`, `user_id`, `role` (`admin`/`member`), `joined_at` |
| `signup_invites` | Einladungen ohne Gruppe (siehe Abschnitt 4) – RLS ohne Policies |
| `cuisines` | `key` (z. B. `croatian`), `name_de` („Kroatisch“), `emoji` (🇭🇷), `region` („Balkan“), `sort` – vorbefüllt mit ~55 Länderküchen, für alle lesbar |
| `spots` | `name`, `lat`, `lng`, `address`, `city`, `osm_type`, `osm_id`, `cuisines` (text[] → `cuisines.key`), `cuisine_guessed` (bool), `category` (`restaurant`/`imbiss`/`cafe`/`bar`/`foodtruck`/`eis`/`baeckerei`/`sonstiges`), `focus` (text[], z. B. „Tapas“), `price_level` (1–4), `description`, `specialties` (text[]), `website`, `phone`, `opening_hours`, `diet_veg`, `diet_vegan`, `source_urls` (text[]), `notes`, `created_by`, `updated_at`, `updated_by`, `deleted_at`, `deleted_by` |
| `spot_wants` | `spot_id`, `user_id` – „Will ich auch!“ (PK aus beiden) |
| `visits` | `spot_id`, `visited_on`, `participants` (uuid[]) – gemeinsamer Besuch |
| `ratings` | `spot_id`, `user_id` (**eindeutig pro Spot und Person**), `visit_id`, `overall` (1–5), `food`, `service`, `ambience`, `value` (1–5, optional), `would_return` (bool), `comment`, `visited_on` |
| `dishes` (Gerichte) | `rating_id`, `spot_id`, `user_id`, `name`, `stars` (1–5, optional), `price_cents`, `note`, `photo_path` = `<group_id>/<spot_id>/<dish_id>-<zeit>.webp`, `thumb_path` = `…_t.webp` (beide müssen im Ordner derselben Gruppe/desselben Spots liegen) |
| `photos` | weitere Fotos (Ambiente, Speisekarte): `spot_id`, `visit_id`, `path`, `thumb_path` |
| `comments` | `spot_id`, `body` |
| `lookup_cache` | `key`, `result` (jsonb) – nur für die Edge Function, RLS ohne Policies |
| `push_config` | VAPID-Schlüssel + Webhook-Geheimnis – RLS ohne Policies |
| `push_subscriptions` | `user_id`, `endpoint`, `p256dh`, `auth`, Auswahl (neue Spots / neue Bewertungen) |

**Ansicht `spot_summary`** (`security_invoker = true`): je Spot Durchschnittsnote, Anzahl Bewertungen, Anzahl „Will ich auch“,
ob ich selbst will, meine Note, letzter Besuch, besucht ja/nein, Titelbild (Vorschaubild des bestbewerteten Gerichts).

**Wichtig:**
- Ein Spot ist **„Wunschliste“ (grau)**, solange es keine Bewertung gibt. Ab der ersten Bewertung ist er **besucht (farbig)**.
- Wer einen Spot einträgt, steht automatisch auf „Will ich auch“.
- `group_id` von Wünschen, Besuchen, Bewertungen und Gerichten wird per Trigger vom Spot übernommen (nie vom Client).
- Ein Gericht darf nur an der **eigenen** Bewertung desselben Spots hängen (Trigger prüft das).

Alle `spots`, `visits`, `ratings`, `dishes`, `photos` und `comments` tragen `group_id` und `created_by` bzw. `user_id`.

---

## 4. Funktionen (alle umsetzen)

### Anmeldeseite
- Bewusst **nur die Anmeldung**, keine werbende Startseite. Die App ist ein privates Werkzeug für die eigenen Gruppen; so lässt sich ein öffentliches Angebot samt Impressumspflicht vermeiden.
- **Privates Angebot:** Auf der Anmeldeseite steht „Privates, nicht-kommerzielles Angebot für Freunde und Familie – kein öffentlicher Dienst. Ein Konto gibt es nur mit Einladung.“
- **Registrieren nur mit Einladungscode** einer Gruppe. Die Datenbank prüft das selbst (`handle_new_user`); die App fragt vorher `check_invite(code)` ab (`ok` / `invalid` / `open`), um klare Fehlermeldungen zu zeigen. Mit Code ist man sofort Mitglied dieser Gruppe. Ausnahme: das allererste Konto einer neuen Installation.
- Wer per Einladungslink kommt (`?join=CODE`), sieht einen Hinweis, hat „Neu registrieren“ schon ausgewählt und den Code bereits im Feld. Ist man schon angemeldet, tritt man der Gruppe nach Rückfrage bei.
- **Einladung zu FoodiSpots ohne Gruppe:** Jeder Nutzer erstellt unter Einstellungen → „Zu FoodiSpots einladen“ persönliche Links (`?invite=CODE`, 10 Zeichen, ohne verwechselbare Zeichen). Ein Link gilt für **ein** neues Konto und **30 Tage**, höchstens **10 offene** pro Person, mit optionaler Notiz „für wen“. Man sieht, wer ihn eingelöst hat, und kann offene widerrufen. Wer sich damit registriert, ist in keiner Gruppe und landet bei „Gruppe gründen oder beitreten“. Funktionen `create_signup_invite`, `my_signup_invites`, `revoke_signup_invite`.
- Links in Messengern zeigen ein Vorschaubild (Open-Graph-Tags, `img/og.jpg`).
- Lese-, Einladungs- und Direktlinks (`?view=`, `?join=`, `?invite=`, `?group=`, `?spot=`) sind per `robots.txt` und `noindex` von Suchmaschinen ausgeschlossen.

### Anmeldung & Konten
- **Nur Name + Passwort, keine E-Mail-Adressen.** Intern wird daraus `<name-slug>@nutzer.foodispots.invalid`
  (Kleinbuchstaben, ä→ae, ö→oe, ü→ue, ß→ss). Die Endung `.invalid` kann nie eine echte Adresse sein.
  Echte E-Mail-Adressen werden nirgends gespeichert, auch nicht in den Metadaten.
- Nutzername: 3–30 Zeichen, Buchstaben inkl. Umlaute, Ziffern, `.` `_` `-`, keine Leerzeichen.
  Anmeldung unabhängig von Groß-/Kleinschreibung.
- **Verwechselbare Namen sperren:** „Möddi“, „M0ddi“, „Mo.ddi“ gelten als gleich wie „Moddi“.
- Registrieren mit Passwort-Wiederholung. Verständliche Fehlermeldungen („Name oder Passwort falsch“, „schon vergeben“, „gesperrt“).
- Name in den Einstellungen änderbar (`rename_me`). Danach meldet man sich mit dem neuen Namen an.
- Datenbank-Trigger lehnt Registrierungen mit anderer Adress-Endung ab.

### Gruppen
- Gruppe erstellen, per **Einladungslink** oder **8-stelligem Code** beitreten, Gruppen wechseln, verlassen.
- Admins: Mitglieder entfernen, Admin-Rechte vergeben, neuen Einladungscode erzeugen, Gruppe für alle löschen.
  Zum Löschen muss man den Gruppennamen eintippen.
- Verlässt der letzte Admin die Gruppe, wird automatisch das am längsten dabei befindliche Mitglied Admin.
- Einladen über „Link teilen“ (Teilen-Menü des Handys) oder „Kopieren“.

### Spot eintragen (Kernfunktion)
- „＋ Spot eintragen“ öffnet **ein einziges Eingabefeld**: „Was wollt ihr ausprobieren?“ – z. B. `delphi koblenz`.
- **Suche** (`lookup-spot` → `search`): bis zu 5 Treffer mit Name, Adresse, Art und Küche. Nicht-Gastronomie-Treffer
  sind als „kein Lokal – nur Adresse“ gekennzeichnet. Darunter „🔎 Im Web recherchieren lassen“ und „Ohne Suche manuell eintragen“.
- Treffer wählen → **Formular ist sofort mit den OSM-Daten gefüllt**, die **Anreicherung** (`enrich`) läuft im Hintergrund
  („Suche Infos zu Küche, Preis & Beschreibung …“) und ergänzt nur leere Felder. Danach: „✓ Infos ergänzt – bitte kurz prüfen.“
- **Dubletten-Prüfung:** gleiche OSM-ID oder < 30 m Abstand + ähnlicher Name → Hinweis „steht schon auf eurer Liste“ mit Link zum Spot.
- Formular:
  - Name, Adresse
  - **Länderküche** (siehe unten) als Chips, max. 3, mit Auswahl nach Region; von der KI ermittelte Küche mit Hinweis **„vermutet“** und Knopf „Stimmt“
  - Art des Lokals, Schwerpunkt (z. B. „Tapas, Grill“)
  - Preisniveau € bis €€€€
  - Beschreibung, Spezialitäten
  - vegetarische / vegane Auswahl
  - Webseite, Telefon, Öffnungszeiten
  - Notiz („Von wem empfohlen? Was sollte man bestellen?“)
  - **Mini-Karte mit verschiebbarem Marker** (Antippen setzt ihn um)
  - Quellen der Recherche als Links
- Manuell eintragen: gleiches Formular, Marker auf Kartenmitte bzw. eigenem Standort. Außerdem öffnet **langes Drücken auf die Karte** den Dialog an dieser Stelle.
- Spot bearbeiten, löschen (→ Papierkorb).
- **Gleichzeitiges Bearbeiten:** Spots haben `updated_at` + `updated_by` (Trigger). Jede Änderung an einem bestehenden Spot wird nur gespeichert, wenn er seit dem Öffnen unverändert ist (`update … where updated_at = <Stand beim Öffnen>`). Sonst: Hinweis „Eine deiner Änderungen überschneidet sich …“ → Gegenüberstellung nur der betroffenen Felder („Deine Version / Jetzt gespeichert“, wer hat geändert) → „Meine Version speichern“ oder „Andere Version behalten“. Ändert jemand den Spot, während das Formular offen ist, erscheint dort sofort ein Hinweis. Eigene nacheinander gespeicherte (auch offline gesammelte) Änderungen sind kein Konflikt.

### Länderküche
- Gemeint ist die **Herkunft der Küche**: Kroatisch, Spanisch, Griechisch, Italienisch, Türkisch, Vietnamesisch, Japanisch, Indisch, Mexikanisch, Libanesisch, Deutsch usw.
- Feste, erweiterbare Liste in der Tabelle `cuisines` (deutsch, Flagge/Emoji, Region: Europa, Osteuropa, Mittelmeer, Balkan, Orient, Afrika, Asien, Amerika, Sonstige).
- Getrennt davon: **Art des Lokals** und **Schwerpunkt** (Pizza, Burger, Tapas, Grill …) – „Pizza“ ist keine Länderküche.
- Reiter **„Länderküchen“**: „X von Y probiert“ mit Fortschrittsbalken, eure Top-Spots, und je Region ein Raster aller Küchen:
  probiert (farbig, „✓ 2 besucht“), nur auf der Wunschliste (gestrichelt), noch offen (grau). Antippen filtert die Liste nach dieser Küche.

### Wunschliste & Besuch
- **„🙋 Will ich auch!“** am Spot (an/aus, Zähler). So sieht man, worauf die meisten Lust haben.
- **„Waren wir!“** legt einen gemeinsamen Besuch an (Datum, wer war dabei) und öffnet direkt die eigene Bewertung.
  Die anderen Teilnehmer sehen beim nächsten Öffnen „Du warst am … dabei – jetzt bewerten?“.

### Bewertung (jeder für sich)
- **Jede Person hat genau eine aktuelle Bewertung pro Spot** und kann sie später ändern; Besuche bleiben als Verlauf.
- Felder: Besuchsdatum, **Gesamtnote 1–5 Sterne (Pflicht)**, optional Essen / Service / Ambiente / Preis-Leistung
  (erneutes Antippen löscht), „Würdest du wieder hingehen?“ (Ja / Eher nicht / Weiß nicht), Kommentar.
- **Eigene Gerichte mit Bild** – beliebig viele pro Bewertung:
  - Name (mit Vorschlägen aus Gerichten, die die Gruppe dort schon eingetragen hat)
  - **Foto** (Kamera oder Galerie)
  - optional eigene Sterne, Preis, Notiz („zu salzig“, „unbedingt wieder“)
  - Hinweis beim Tippen: „Hatte auch: Anna – Ø 4,5 ★“
  - Gericht entfernen, Foto austauschen (alte Dateien werden gelöscht)
- **Fotos:** auf max. 1600 px verkleinert und als **WebP** gespeichert (kann der Browser kein WebP erzeugen, als JPEG), dazu ein
  **kleines Vorschaubild** (~400 px). Listen und Raster laden nur das kleine Bild, das große erst beim Antippen (Großansicht zeigt sofort
  das kleine und tauscht dann). Standortdaten werden beim Verkleinern entfernt. Das **Aufnahmedatum aus dem Foto** wird als Besuchsdatum
  vorgeschlagen, wenn noch keins gewählt ist. HEIC vom iPhone muss funktionieren. Beim Löschen immer beide Dateien entfernen.
- Eigene Bewertung samt Gerichten löschen (mit Rückfrage).

### Karte
- **Marker = Tropfenform mit Küchen-Flagge** in der Mitte.
  - **Grau**, solange noch niemand bewertet hat (Flagge leicht entsättigt), mit kleiner Zahl, wenn mehrere „Will ich auch“ gesagt haben.
  - **Farbig nach Durchschnittsnote**: fließender Verlauf rot (1) → orange → gelb → hellgrün → dunkelgrün (5).
  - Legende auf der Karte („wollen wir hin“ / „besucht: 1 → 5 ★“).
- **Stapeln:** Liegen Marker übereinander, liegen die **bestbewerteten oben**, Wunschliste darunter.
- **Auffächern:** Antippen eines Stapels fächert alle Marker kreisförmig auf, mit Linien zum Ursprung. Antippen der Karte oder Zoomen klappt wieder zu.
- Tooltip mit Name und Note. Eigener Standort als blauer Punkt, Knopf „auf mich zentrieren“, Ebenenwechsel Karte/Satellit.
- Beim ersten Laden passt sich der Ausschnitt an alle Spots an.

### Detailansicht (Bottom-Sheet)
- Titelbild (bestes Gerichtfoto), Flagge + Name, Küche · Art · Preisniveau, Schwerpunkt-Chips, „Küche vermutet“-Hinweis.
- Statusfeld: besucht → große Durchschnittsnote in Notenfarbe, Sterne, Anzahl Bewertungen, letzter Besuch;
  Wunschliste → „Wollen wir hin“ und wer hin will.
- Knöpfe „Will ich auch!“ und „Waren wir! Bewerten“ bzw. „Meine Bewertung“.
- Beschreibung, Spezialitäten, Adresse mit **Route** (Google Maps / Apple Karten), Öffnungszeiten, Webseite, Telefon (antippbar),
  vegetarisch/vegan, Notiz, Quellen, „eingetragen von … am …“, **Entfernung** vom eigenen Standort.
- Reiter **„Bewertungen“**: je Mitglied Name, Datum, Sterne, Unterpunkte, „würde wieder hingehen“, Kommentar und **die eigenen Gerichte als Bildkacheln**.
- Reiter **„Gerichte“**: alle Gerichte aller Mitglieder als Galerie, **gleichnamige zusammengefasst** mit Durchschnittssternen,
  Anzahl und wer sie hatte – sortiert nach Note. Antippen → Großansicht mit Name, Sternen, Preis, Notiz, Person, Datum.
- **Kommentare** pro Spot (z. B. „Mittwochs Ruhetag!“).

### Liste, Filter, Zufall
- **Liste** mit Vorschaubild bzw. Flagge, Name, Küche · Preis · Ort, Note bzw. „Wunschliste“ + „Will ich auch“-Zahl, Entfernung.
  Suchfeld (Name, Ort, Küche, Schwerpunkt, Spezialitäten). Sortierung: neueste / meiste „Will ich auch“ / beste Note / Entfernung / Name.
- **Filter** (Zähler am Filter-Knopf, „Zurücksetzen“, Knopf zeigt „12 Spots anzeigen“):
  - Status: Alle / Wunschliste / Besucht
  - Länderküche (Mehrfachauswahl) und Region
  - Preisniveau
  - Mindestnote (egal / 3+ / 4+ / 4,5+)
  - Art des Lokals
  - vegetarisch / vegan
  - „Noch nicht von mir bewertet“
  - **„Jetzt geöffnet“** (Öffnungszeiten im OSM-Format auswerten, z. B. mit der Bibliothek `opening_hours`)
  - Wer hat eingetragen (Alle / Meine / einzelne Mitglieder)
- **„🎲 Wohin heute?“** schlägt zufällig einen offenen Spot der Wunschliste vor (berücksichtigt die Filter; mehr „Will ich auch“ = höhere Chance),
  zentriert die Karte, öffnet die Detailansicht mit „Wie wär's damit?“ und „Nochmal“.

### Papierkorb
- Löschen von Spots ist **weiches Löschen** (`deleted_at`, `deleted_by`): Sie verschwinden sofort von Karte, Liste und Lese-Link.
- **Gruppe → 🗑 Papierkorb (Anzahl):** zeigt wer wann gelöscht hat und wie viele Tage noch bleiben.
  **Wiederherstellen** oder **endgültig löschen** (dann auch die Fotodateien). Erlaubt für den, der den Spot angelegt hat, oder einen Admin.
- Nach **30 Tagen** endgültig löschen. Das erledigt jedes berechtigte Gerät beim Laden der Gruppe.

### Teilen
- **Öffentlicher Lese-Link** pro Gruppe (an/aus, standardmäßig aus):
  - ohne Anmeldung, **nur lesend**
  - **keine Namen, keine Kommentare, keine Einzelbewertungen** – nur Spots, Durchschnittsnote und Gerichtfotos
  - Daten kommen über die Funktion `public_group_data(token)`.
  - **Fotos nur mit dem Link-Schlüssel:** Die App schickt den Schlüssel als Header `x-foodi-share` mit,
    und die Storage-Policy prüft ihn (`current_setting('request.headers')`).
- **Push-Benachrichtigungen** (Web Push mit VAPID, Edge Function `notify`): neuer Spot in der Gruppe, neue Bewertung –
  einzeln abschaltbar. Mit Test-Knopf in den Einstellungen.
- **Export:** JSON-Backup der Gruppe und CSV-Liste (Name, Adresse, Küche, Note, Besuche) zum Öffnen in Excel.

### Admin-Bereich (nur Super-Admins, Einstellungen → 🛡 Admin-Bereich)
- Übersicht: Anzahl Nutzer, Gruppen, Spots, Bewertungen, Fotos, Anfragen an die Restaurant-Suche (Cache-Treffer/neu).
- **Nutzer:** umbenennen, Passwort neu setzen (meldet alle Sitzungen ab), sperren/entsperren, Super-Admin geben/nehmen,
  Gruppenmitgliedschaften ändern, löschen mit Wahl (Inhalte behalten → gehen auf den Admin über, oder mitlöschen), Bestätigung durch Eintippen des Namens.
- **Gruppen:** öffnen/beitreten, Mitglieder, umbenennen, neuer Einladungscode, Lese-Link abschalten, löschen (mit Namens-Bestätigung).
- **Länderküchen-Liste pflegen** (neue Küche anlegen, Emoji/Region ändern).
- Alle Admin-Aktionen als SECURITY-DEFINER-Funktionen mit Super-Admin-Prüfung. Sich selbst kann man nicht sperren oder löschen.

---

## 5. Sicherheit (aus dem Pentest der Pilzkarte – unbedingt einhalten)

- **RLS überall:** Mitglieder sehen nur ihre Gruppen. Schreiben nur mit `created_by = auth.uid()` bzw. `user_id = auth.uid()`.
  Spots ändern dürfen alle Mitglieder (mit Konflikterkennung), löschen der Ersteller oder Admins.
  **Bewertungen und Gerichte ändern/löschen nur die Person selbst.**
  Anonyme Nutzer erreichen keine Tabelle und keine geschützte Funktion (`EXECUTE` für `anon` entziehen; Trigger-Funktionen auch für `authenticated`).
- **Unveränderliche Felder:** Ein Trigger verhindert, dass Nutzer `created_by`, `user_id`, `group_id`, `spot_id` oder `rating_id`
  nachträglich ändern. Foto-Pfade müssen per CHECK im Ordner `<group_id>/<spot_id>/` liegen. Admin-Funktionen dürfen weiterhin übertragen.
- **Storage:** Bucket `food-photos` privat, max. 5 MB, nur JPEG/WebP/PNG. Lesen/Schreiben nur für Mitglieder (Pfad beginnt mit Gruppen-ID),
  Löschen nur eigene Dateien. Anonym nur mit gültigem Lese-Link-Schlüssel im Header.
- **Edge Functions** prüfen selbst: `lookup-spot` nur mit gültigem Nutzer-Token (Missbrauch des API-Keys verhindern, einfache Mengenbegrenzung pro Nutzer und Tag),
  `notify` mit eigenem Geheimnis-Header oder Nutzer-Token, `backup-export` mit `BACKUP_TOKEN`.
- **Keine Schadcode-Lücken (XSS):** Jede Ausgabe von Nutzertext **und von Daten aus OSM/KI-Recherche** mit `esc()` bzw. `textContent`.
  Links nur mit `http(s)` zulassen. Automatischer Test mit Schadcode in allen Eingabefeldern und in Suchergebnissen.
- **Netlify veröffentlicht nur die App-Dateien** (`dist/`). Tests, Skripte, SQL, Anleitungen, Prompt und Workflows dürfen nie
  über die Webseite abrufbar sein (live prüfen: 404).
- **Sicherheits-Header** für alle Seiten:
  - Content-Security-Policy, die nur die nötigen Quellen erlaubt (eigene Seite, unpkg, jsDelivr, Google Fonts, das Supabase-Projekt
    inkl. `wss:`, Kartenkacheln, `data:`/`blob:` für Bilder) und `frame-ancestors 'none'`
  - X-Frame-Options DENY, X-Content-Type-Options nosniff
  - Referrer-Policy strict-origin-when-cross-origin
  - Permissions-Policy (Standort und Kamera nur selbst)
  - Cross-Origin-Opener-Policy same-origin
- **Fremde Bibliotheken** mit fester Version und SRI-Prüfsumme.
- **Geheimnisse:** Nur der Publishable Key steht im Code. Kein Secret Key, kein DB-Passwort, kein Claude-API-Key, keine E-Mail-Adressen im Repository.
- **Empfehlungen an mich** (nur im Supabase-Dashboard machbar): Mindest-Passwortlänge erhöhen,
  „Leaked password protection“ einschalten (kostenpflichtige Tarife), Ausgabenlimit für den Claude-API-Key setzen.

---

## 6. Tests (im Repository unter `tests/`)

- Node `node:test` + **Playwright** (Chromium, Handy-Ansicht 390×844, deutsch, Standort simuliert).
- Statt des echten Supabase ein **Test-Backend im Browser** (`tests/support/mock-supabase.js`, Daten in `localStorage`),
  das die Server-Regeln nachbildet (z. B. fremde Bewertungen nicht änderbar, Fotos im Lese-Link nur mit Schlüssel).
  `lookup-spot` liefert feste Testdaten (u. a. „delphi koblenz“ mit OSM-Treffer und Anreicherung, ein Ort ohne OSM-Treffer, ein Fehlerfall).
  Leaflet aus `node_modules`, Kartenkacheln blockiert, Service Worker aus.
  Das Test-Backend sendet Echtzeit-Ereignisse mit neuem/altem Datensatz wie Supabase und zählt Abfragen (`window.__mock`).
- Der Test-Server liefert dieselbe **Content-Security-Policy** wie Netlify. CSP-Verstöße lassen Tests fehlschlagen.
- **Datenbank-Tests** (SQL in einer zurückgerollten Transaktion gegen das echte Projekt): Registrierung ohne/mit Code, fremde Gruppe unsichtbar,
  fremde Bewertung nicht änderbar, Gericht nicht an fremde Bewertung hängbar, Fotopfad außerhalb der Gruppe abgelehnt, anonym keine Funktionen.
- Abgedeckt:
  - Grundlagen (registrieren, Gruppe, beitreten, Einladungslinks)
  - Spot per Suche eintragen, Anreicherung, „vermutet“ bestätigen, Dubletten-Hinweis, manuell eintragen, Marker verschieben
  - Will ich auch, Waren wir, Bewertung mit Unterpunkten, mehrere Personen → Durchschnitt und Markerfarbe
  - Gerichte mit Foto (anlegen, ändern, Foto tauschen, entfernen), Vorschläge und „Hatte auch“
  - Reiter Gerichte (Zusammenfassen gleichnamiger), Großansicht
  - Filter (alle), „Jetzt geöffnet“, Liste/Sortierung, Wohin heute
  - Länderküchen-Übersicht
  - Papierkorb (löschen, wiederherstellen, endgültig, nach 30 Tagen automatisch)
  - Stapeln, Auffächern
  - offline bewerten mit Fotos und später synchronisieren
  - Lese-Link (keine Namen, keine Einzelbewertungen, deaktiviert)
  - Admin-Bereich
  - Sicherheit (XSS, auch über Suchergebnisse)
  - gleichzeitiges Bearbeiten (meine/andere Version, Hinweis im Formular, keine Selbst-Konflikte)
  - Leistung: 1.200 Spots werden zusammengefasst, Liste schrittweise, Echtzeit ohne Neuladen
  - Service Worker mit echtem Service Worker gegen eine Kopie wie auf Netlify: Start bei 6 s Verzögerung je Datei < 3 s,
    offline, Hinweis „Neue Version“ (braucht `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`, steht im `npm test`-Skript)
- **GitHub Action `tests.yml`** führt alles bei jedem Push aus.

---

## 7. Veröffentlichung & Sicherung

- **Netlify** (`netlify.toml`):
  - `publish = "dist"`, Build-Befehl kopiert nur die App-Dateien (`index.html styles.css config.js cuisines.js exif.js sw.js manifest.webmanifest robots.txt icons img js`)
    und setzt die Build-Kennung in `dist/sw.js` (`sed … __BUILD__ → ${COMMIT_REF}-Zeit`)
  - Kein Cache für `sw.js`/`index.html`, JS/CSS `must-revalidate`
  - Sicherheits-Header wie oben
  - `[context.backup] ignore = "exit 0"`, damit der Sicherungs-Branch **nie** veröffentlicht wird
- Bei jeder Änderung an App-Dateien die **Versionsnummer** in `APP_VERSION` und im Service Worker erhöhen
  und neue Module in die Shell-Liste (`SHELL_FILES` in `sw.js`) und in `MODULES` (`js/main.js`) aufnehmen.
  Neue Dateien außerhalb von `js/` zusätzlich in den Build-Befehl in `netlify.toml`.
- **Edge Functions** liegen unter `supabase/functions/` im Repository und werden nach Änderungen neu deployt.
- **Sicherung** (`.github/workflows/backup.yml`, Mo + Do 03:17 UTC, auch manuell startbar):
  - bricht ab, wenn das Repository öffentlich ist
  - Edge Function `backup-export` (Zugriff mit `BACKUP_TOKEN`) liefert alle Tabellen und signierte Foto-Links
  - `scripts/backup.mjs` schreibt alles in den Branch **`backup`** (JSON pro Tabelle + Fotos)
  - Hält nebenbei das kostenlose Supabase-Projekt wach

---

## 8. Arbeitsweise mit mir

- Nach jeder Änderung: Tests laufen lassen → committen → pushen → **live prüfen**
  (neue Version ausgeliefert, Seite lädt). Erst dann melden. Ich lade nichts selbst herunter. „Fertig“ heißt: **ist online**.
- Datenbank-Änderungen als **Migrationen** (`supabase/migrations/`). Wenn Befehle mit `DROP`/`DELETE`/`TRUNCATE` von der Umgebung abgelehnt werden:
  aufteilen, `ALTER POLICY` bzw. `CREATE OR REPLACE` nutzen, oder mir eine SQL-Datei unter `supabase/manuell/` geben,
  die ich im SQL-Editor ausführe. Danach prüfen, ob sie gewirkt hat.
- Sicherheitsprüfungen nur mit zurückgerollten Transaktionen bzw. ohne echte Daten zu verändern.
  Fragt die Umgebung vor einem SQL-Befehl nach, sag mir vorher kurz, dass gleich eine Bestätigung kommt und warum.
- `CHANGELOG.md` bei jeder Änderung mitpflegen (Version, Datum, was sich für Nutzer ändert; Datenbank-Änderungen kennzeichnen).
- `schema.sql` aktuell halten, damit eine Neuinstallation alles enthält. `ANLEITUNG.md` für Laien pflegen. Diese `PROMPT.md` bei neuen Funktionen ergänzen.
- Antworten kurz, auf Deutsch, mit klaren Klick-Anweisungen, wenn ich etwas tun muss.
  Bei Fehlern („Suche findet nichts“, „Foto lädt nicht“) selbst Logs/Datenbank prüfen, statt mich raten zu lassen.

---

## 9. Etappen

1. Grundgerüst: Anmeldung (Name + Passwort, Einladungscodes, privates Angebot), Gruppen, Karte, Spots manuell eintragen, Liste, PWA, Deploy auf Netlify über GitHub, Sicherheits-Header, Tests im Repository
2. Restaurant-Suche: OpenStreetMap-Treffer, Formular vorbefüllt, Dubletten-Prüfung
3. Länderküchen: Tabelle, Auswahl nach Region, Flagge im Marker, Filter, Länderküchen-Übersicht
4. KI-Anreicherung (Küche „vermutet“, Beschreibung, Preis, Spezialitäten, Quellen) – sobald der API-Key als Secret hinterlegt ist
5. Will ich auch, Waren wir, Bewertung jeder für sich, graue → farbige Marker nach Durchschnittsnote
6. Gerichte mit Fotos (WebP + Vorschaubild), Reiter „Gerichte“, Titelbild, „Hatte auch“
7. Filter komplett (inkl. „Jetzt geöffnet“), Sortierung, „Wohin heute?“, Kommentare
8. Offline: IndexedDB, Warteschlange, Fotos offline, Start sofort aus dem Speicher, Hinweis „Neue Version“
9. Papierkorb, gleichzeitiges Bearbeiten
10. Stapeln, Auffächern, Zusammenfassen vieler Marker, Echtzeit ohne Neuladen, Liste schrittweise
11. Push-Benachrichtigungen, Lese-Link, Export
12. Admin-Bereich, Einladungen ohne Gruppe
13. Sicherung in den Branch `backup`, Dunkelmodus, Pentest und Härtung (Abschnitt 5)

---

## 10. Werte des Projekts (nur zur Orientierung)

- Repository: `M0dd1/FoodSpotBesties` (privat), Branch `main` (App), später `backup` (Sicherung)
- Supabase-Projekt: „FoodiSpots“, `bnhagdnfaekhyjbokggp` (`https://bnhagdnfaekhyjbokggp.supabase.co`, eu-central-1, Free-Plan),
  Publishable Key steht in `config.js`
- Webseite: noch offen (Netlify, automatischer Deploy aus `main`)
- Super-Admin: `Moddi`
- Vorlage: Pilzkarte – `M0dd1/Pilzkarte`, `https://pilzkarte.netlify.app`, Supabase `tbqtyrjvdfsnlxajbbxp`

Bei einem Umzug auf neue Konten diese Werte durch die Antworten aus Abschnitt 1 ersetzen.
