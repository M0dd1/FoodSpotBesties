# FoodiSpots – Anleitung

## Loslegen
1. Link öffnen, **„Neu registrieren“** antippen. Name + Passwort wählen (keine E-Mail nötig).
   Den **Einladungscode** bekommst du von jemandem aus der Gruppe – über den Einladungslink ist er schon eingetragen.
2. Ohne Gruppe: Gruppe **gründen** oder mit Code **beitreten**.
3. Aufs Handy holen: iPhone → Safari → Teilen (□↑) → **„Zum Home-Bildschirm“**. Android → Menü (⋮) → **„App installieren“**.

## Spot eintragen
- Unten **„＋ Spot eintragen“** antippen und Name + Ort eingeben, z. B. `delphi koblenz`.
- Den richtigen Treffer antippen. Adresse, Küche, Öffnungszeiten und mehr werden eingetragen – kurz prüfen, dann **„Auf die Wunschliste“**.
- Steht bei der Küche **„vermutet“**, wurde sie im Web ermittelt. Stimmt sie, auf **„Stimmt“** tippen; sonst ändern.
- Nichts gefunden? **„Im Web recherchieren lassen“** oder **„Ohne Suche eintragen“**. Auf der Karte geht auch: **lange drücken**.

## Hingehen und bewerten
- **„🙋 Will ich auch!“** zeigt den anderen, dass du mit willst.
- Wart ihr da: **„Waren wir! Bewerten“**. Jede Person bewertet für sich. Beim ersten Mal kannst du angeben, wer dabei war – die anderen werden dann ans Bewerten erinnert.
- Unter **„Was hattest du?“** trägst du deine Gerichte ein, mit **Foto** (Kamera oder Galerie), Sternen, Preis und Notiz.
- Graue Marker = Wunschliste, farbige = besucht (rot schlecht → grün gut).

## Finden
- **Liste**: Suche nach Name, Ort, Küche oder Gericht; sortieren nach Note, Entfernung, „Will ich auch“ …
- **Filter** (Trichter oben): Wunschliste/besucht, Länderküche, Preis, Mindestnote, „Jetzt geöffnet“, vegetarisch/vegan …
- **Länderküchen**: welche Küchen ihr schon probiert habt. Antippen zeigt die Spots dieser Küche.
- **🎲 Wohin heute?** schlägt einen Spot von der Wunschliste vor.

## Gruppe
- Oben auf den **Gruppennamen** tippen: einladen, Mitglieder, Papierkorb, Lese-Link, Gruppe wechseln.
- **Lese-Link**: Freunde ohne Konto sehen eure Spots mit Durchschnittsnoten und Gerichtfotos – ohne Namen und Kommentare.

## Ohne Netz
Alles, was du offline einträgst oder bewertest, wird automatisch hochgeladen, sobald wieder Netz da ist (Anzeige oben rechts).
Die Restaurant-Suche braucht Internet.

## Für den Betreiber
- Passwort vergessen: Super-Admin (**Marcel**) setzt es unter Einstellungen → 🛡 Admin-Bereich neu.
- Web-Recherche einschalten: In Supabase unter *Edge Functions → Secrets* `ANTHROPIC_API_KEY` eintragen.
- Sicherung: Ein langes Zufallswort (mind. 32 Zeichen) als `BACKUP_TOKEN` in Supabase (*Edge Functions → Secrets*) **und** in GitHub (*Settings → Secrets and variables → Actions → New repository secret*) eintragen.
