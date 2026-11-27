# RIVIERA Mitgliederportal

Dunkles Schwarz-/Hellgold-Frontend für Mitglieder, Anwesenheit, drei Lager und Berechtigungen.

## Enthalten
- Login und Registrierung mit Supabase Auth
- Erste erfolgreiche Registrierung wird atomar als Gründer-Admin markiert
- Registrierung startet offen und kann über die Admin-Funktion gesperrt/geöffnet werden
- Mitgliederliste mit Rängen 1–12
- 28-Tage-Anwesenheitsansicht; historische Einträge bleiben in der Datenbank
- Dauerhafte Statuszählung je Mitglied
- Hauptlager, Leaderlager und Waffenlager mit Item-Stamm, Bestand und Protokollen
- Individuelle Berechtigungen pro Mitglied

## Einrichtung
1. Neues Supabase-Projekt anlegen.
2. `supabase/schema.sql` vollständig im Supabase SQL Editor ausführen.
3. `config.example.js` in `config.js` umbenennen.
4. Supabase Project URL und den `anon`/`publishable` Key in `config.js` eintragen. Niemals den `service_role`-Key in den Browser legen.
5. Optional das originale Logo als `assets/riviera-logo.png` ablegen.
6. `index.html`, `styles.css`, `app.js`, `config.js` und `assets/` in ein GitHub-Repository hochladen.
7. GitHub Pages für den Branch/Ordner aktivieren.

## Wichtige Hinweise vor Live-Betrieb
- In Supabase Auth E-Mail-Bestätigung nach gewünschtem Ablauf konfigurieren.
- Der erste Nutzer muss sich registrieren, solange das Projekt frisch ist; dieser wird Gründer-Admin.
- Die Ernennung des zweiten Admins ist als nächster sicherer Backend-Schritt zu ergänzen. Sie wird absichtlich nicht durch einen unsicheren Browser-Schalter umgesetzt.
- Die Oberfläche ist ein funktionsfähiges Grundgerüst, aber vor öffentlichem Einsatz müssen die SQL-Richtlinien und alle Rollenabläufe in einem Testprojekt geprüft werden.
- Die Berechtigungen sind serverseitig über Supabase-Funktionen zu prüfen; niemals nur Schaltflächen im Browser verstecken.
