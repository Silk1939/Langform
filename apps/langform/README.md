# Langform

Features, Bugfixes und offene Abnahmen stehen im [gemeinsamen Projektbacklog](../../docs/VERBESSERUNGS_BACKLOG.md). Nach jeder Feature-Arbeit den zugehörigen Eintrag gemäß [Projektregel](../../AGENTS.md) aktualisieren.

Persönliche Web-App für Tan Ipekkaya. Sie zeigt lange Videos und lässt Kurzvideos weg. Die Oberfläche ist deutsch und fühlt sich auf dem Telefon wie eine App an: Leiste mit Start, Suche und Verlauf, Suche direkt auf der Seite, ein Player, der beim Verlassen klein weiterläuft. Die Wiedergabe bleibt der offizielle Player von `youtube.com/embed`.

## Starten

```bash
cd apps/langform
npm install
npm run dev
```

Die Entwicklung läuft auf [http://127.0.0.1:43123](http://127.0.0.1:43123). Produktion:

```bash
npm test
npm run build
npm start
```

Vom Projektroot aus prüft `npm test` zuerst die Browser-Erweiterung und danach Langform. Dafür muss `apps/langform` einmal mit `npm install` versorgt sein.

## Optionaler Schlüssel

Liegt `YOUTUBE_API_KEY` in der Umgebung, holt die App Metadaten über die YouTube Data API v3. Ohne Schlüssel bleiben die öffentlichen Invidious- und Piped-Instanzen. Der Schlüssel ist nicht nötig.

## Grenzen

Kein Konto, keine Datenbank, keine Auswertung. Shorts (Pfad `/shorts/`, Hashtag `#shorts`, unter 60 Sekunden) werden nicht verlinkt und nicht abgespielt. Es gibt keinen eigenen Player und keine Stream-Adressen.
