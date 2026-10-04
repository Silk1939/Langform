# Shorts ausblenden

Browser-Erweiterung für Tan Ipekkaya. Sie blendet YouTube Shorts aus, solange YouTube im Browser läuft — am Rechner und auf dem iPhone in Safari.

Daneben liegt **Langform** in `apps/langform`: eine eigene Web-App für lange Videos, ohne Shorts und ohne Konto. Bedienung und Start stehen in `apps/langform/README.md`.

Die iPhone-App liegt in `ios/Langform`. Sie zeigt die echte YouTube-Seite und blendet Shorts mit denselben Skripten aus. Öffnen und Anmeldung stehen in `ios/Langform/README.md`.

## Was sie tut

- Läuft auf `https://www.youtube.com/*` und `https://m.youtube.com/*`. Safari auf dem iPhone öffnet die mobile Seite.
- Versteckt Shorts auf der Startseite, in Abos, in der Suche, in der Seitenleiste, bei verwandten Videos und in mobilen Reels.
- Wer `/shorts`, `/shorts/…` oder `/feed/shorts` öffnet, landet sofort auf der YouTube-Startseite. Während die Umleitung läuft, steht dort: „Shorts sind blockiert. Weiter zur Startseite …“.
- Das Symbol in der Symbolleiste öffnet einen Schalter, **Shorts blockieren**. Standard ist an. Aus heißt: nichts verstecken und nicht umleiten. Die Wahl bleibt auf dem Gerät, ohne Konto.
- Kein Server, keine Auswertung, keine weiteren Dienste.

## Was sie nicht tut

Die Erweiterung kann die YouTube-App auf dem iPhone oder Android nicht verändern. Auf dem Telefon gilt sie nur, wenn YouTube in Safari geöffnet ist.

Mit einer kostenlosen Apple-ID muss die App etwa alle **7 Tage** neu signiert werden. Danach in Xcode erneut auf das iPhone spielen, sonst startet die Erweiterung nicht mehr.

## Kurz testen in Chrome

1. `chrome://extensions` öffnen.
2. Entwicklermodus einschalten.
3. „Entpackte Erweiterung laden“ und den Ordner `extension` dieses Projekts wählen.
4. YouTube öffnen. Shorts-Regale sollten fehlen. Ein Aufruf von `https://www.youtube.com/shorts` springt auf die Startseite.
5. Auf das Symbol klicken und **Shorts blockieren** ausstellen. Shorts sind danach wieder da, auch ohne die Seite neu zu laden.

## Kurz testen in Firefox

1. `about:debugging#/runtime/this-firefox` öffnen.
2. „Temporäres Add-on laden…“ und die Datei `extension/manifest.json` wählen.
3. Wie in Chrome prüfen. Temporäre Add-ons verschwinden, wenn Firefox schließt.

## Auf dem Mac in Safari

Voraussetzung: Xcode aus dem App Store, einmal geöffnet, damit die Kommandozeilenwerkzeuge da sind.

1. Im Terminal in diesen Projektordner wechseln und ausführen:

   ```bash
   bash scripts/convert-safari.sh
   ```

   Das Skript ruft `xcrun safari-web-extension-converter` auf und erzeugt ein Xcode-Projekt für macOS und iOS. Es liegt unter `safari/`. Die Projektdatei heißt `Shorts ausblenden.xcodeproj`.

2. Diese Projektdatei in Xcode öffnen.
3. Oben das Schema der macOS-App wählen.
4. Beim App-Target unter Signing & Capabilities das Team setzen: Xcode → Settings → Accounts, Apple-ID hinzufügen. Bei einer kostenlosen Apple-ID heißt das Team „Personal Team“.
5. Run (⌘R). Die kleine Mac-App startet und bietet an, die Safari-Einstellungen zu öffnen.
6. Safari → Einstellungen → Erweiterungen → „Shorts ausblenden“ aktivieren und den Zugriff auf `www.youtube.com` erlauben.
7. Lehnt Safari die Erweiterung als unsigniert ab: Safari → Einstellungen → Erweitert → „Funktionen für Webentwickler anzeigen“. Danach im Menü Entwickeln → „Nicht signierte Erweiterungen erlauben“. Safari neu starten und die Erweiterung erneut aktivieren.

Nach Änderungen an `extension/` das Konverter-Skript erneut ausführen, damit Xcode die neue Fassung kopiert.

## Auf dem iPhone

Dasselbe Xcode-Projekt. Safari-Erweiterungen laufen nicht im Simulator, deshalb ein echtes iPhone.

1. iPhone per Kabel verbinden. Ab iOS 16: Einstellungen → Datenschutz & Sicherheit → Entwicklermodus einschalten und das iPhone neu starten.
2. In Xcode das Schema der iOS-App wählen und als Ziel das eigene iPhone.
3. Signing: Team = Personal Team. Ist die Bundle-ID schon vergeben, unter Signing eine eigene setzen, zum Beispiel `de.ipekkaya.shorts-ausblenden.tan`.
4. Run (⌘R). Falls das iPhone dem Entwickler nicht vertraut: Einstellungen → Allgemein → VPN & Geräteverwaltung → der Apple-ID vertrauen.
5. Auf dem iPhone: **Einstellungen → Safari → Erweiterungen** → „Shorts ausblenden“ einschalten. Für Websites `youtube.com` erlauben, also `www.youtube.com` und `m.youtube.com`.
6. YouTube in Safari öffnen, nicht in der App. Die mobile Seite ist `m.youtube.com`.
7. Nach etwa 7 Tagen mit kostenloser Apple-ID das Profil erneuern: iPhone anschließen, in Xcode erneut Run.

## Tests

Die Tests bauen Desktop- und Mobil-Markup nach. Sie rufen nicht die echte YouTube-Website auf.

```bash
npm install
npm install --prefix apps/langform
npm test
```

`npm test` prüft die Erweiterung und danach Langform. Der Produktionsbau der App:

```bash
npm run build --prefix apps/langform
```

## Aufbau

```
extension/                 die Erweiterung (in Chrome/Firefox diesen Ordner laden)
extension/manifest.json
extension/src/             Inhaltsskript, ab document_start
extension/popup/           Schalter, deutsch
scripts/convert-safari.sh  Xcode-Projekt für Mac und iPhone
tests/fixtures/            nachgebautes YouTube-Markup
apps/langform/             Web-App für lange Videos
ios/Langform/              iPhone-App, Vollbild auf youtube.com
```
