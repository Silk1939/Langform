# Langform

Langform besteht aus einer nativen iPhone-App, einer Safari-/Browser-Erweiterung und einer separaten Web-App für lange YouTube-Videos. Dieses Repository enthält den aktuellen Entwicklungsstand aller drei Bereiche, Tests und das gemeinsame Backlog.

## Einstieg für Entwickler

```bash
git clone https://github.com/Silk1939/Langform.git
cd Langform
npm ci
npm ci --prefix apps/langform
npm test
```

Node.js 22 und npm 10 sind lokal geprüft. Auf macOS umfasst `npm test` auch Swift-/WebKit-Regressionen und benötigt dafür Xcode; einige Medienprüfungen benötigen zusätzlich `ffmpeg`. Tests mit fehlenden Plattformvoraussetzungen können übersprungen werden. Bestandene lokale Tests ersetzen keine persönliche Geräteabnahme.

Die Web-App starten:

```bash
npm run dev --prefix apps/langform
```

Danach `http://127.0.0.1:43123` öffnen. Ein YouTube-API-Schlüssel ist optional; Vorlage: `apps/langform/.env.example`. Lokale Schlüssel gehören in `.env.local` und werden nicht hochgeladen. Produktionsprüfung: `npm run lint --prefix apps/langform` und `npm run build --prefix apps/langform`.

Für die iPhone-App `ios/Langform/Langform.xcodeproj` mit Xcode 27 öffnen. Ein Simulatorbuild benötigt keine Apple-Signierung:

```bash
xcodebuild -project ios/Langform/Langform.xcodeproj -scheme Langform \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
bash scripts/test-simulator.sh
```

Der UI-Runner benötigt eine installierte iOS-Simulatorlaufzeit. Für ein eigenes Gerät in einer separaten Arbeitskopie eigene Bundle-ID, Team, Zertifikat und Profile bewusst konfigurieren. Die bestehenden Geräte-/Safari-Skripte sind auf Tans Gerät und vorhandene manuelle Signierung festgelegt; `scripts/deploy-iphone.sh` ist kein allgemeiner Installationsweg für andere Entwickler. Bestehende Signierung erhalten, keine automatische Zertifikatsreparatur einschalten. Details stehen in `ios/Langform/README.md`, `ios/DeviceTests/README.md` und `AGENTS.md`.

- `ios/Langform/`: native App und eingebettete YouTube-Skripte.
- `extension/` und `native/`: Browser-Erweiterung und nativer Safari-Handler.
- `apps/langform/`: separate Next.js-Web-App; Änderungen dort wirken nicht automatisch auf die native App.
- `tests/`, `scripts/` und `ios/DeviceTests/`: Regressionen, Builds und Simulatorprüfung.

**Arbeitsstand und Astra-Bugcheck, 17.10.2026:** Aktueller iPhone-Quellstand **72**, nur im Simulator gebaut/geprüft; auf dem echten iPhone zuletzt **71 vom16.10.** bestätigt. In der zweiten Prüfung drei weitere Fehler korrigiert: Feed-Reaktivierung im Hintergrund, Web-Kurzvideo-Prüfung und Transkript bei History-Navigation. Finale Exportkopie: **2.270 Root-/108 Webtests**, Lint/Produktionsbuild sowie zwei separate Simulatorfälle37/32 bestanden. [Astra-Prüfstand](docs/ASTRA_BUGCHECK_2026-10-17.json). Persönliche Geräte-/Finger-/Motion-/Ton-/Bluetoothabnahmen und LF-74 bleiben offen. Zum Weiterarbeiten [Entwickleranleitung](docs/WEITERARBEITEN.md), [Backlog](docs/VERBESSERUNGS_BACKLOG.md) und [Übergabe](UEBERGABE.md) lesen.

Lokale QA-Aufnahmen, Rohlogs, Netzantworten und Buildprodukte bleiben außerhalb von GitHub. Historische Links nach `docs/qa/` beziehen sich deshalb überwiegend auf lokale Nachweise und sind im öffentlichen Repo nicht verfügbar. Die beiden öffentlichen JSON-Fixtures, die `npm test` benötigt, sind enthalten. Drittanbieterhinweise für den Downloadresolver: `ios/Langform/Langform/ThirdPartyLicensing.txt`.

Beiträge können über einen Fork und Pull Request vorgeschlagen werden. Direkter Schreibzugriff kann später gezielt eingerichtet werden.

## Browser-Erweiterung: Shorts ausblenden

Browser-Erweiterung für Tan Ipekkaya. Sie blendet YouTube Shorts aus, solange YouTube im Browser läuft — am Rechner und auf dem iPhone in Safari.

Daneben liegt **Langform** in `apps/langform`: eine eigene Web-App für lange Videos, ohne Shorts und ohne Konto. Bedienung und Start stehen in `apps/langform/README.md`.

Die iPhone-App liegt in `ios/Langform`. Sie zeigt die echte YouTube-Seite und blendet Shorts mit denselben Skripten aus. Öffnen und Anmeldung stehen in `ios/Langform/README.md`.

Das [gemeinsame Projektbacklog](docs/VERBESSERUNGS_BACKLOG.md) führt Features, Bugfixes und offene Abnahmen für alle drei Bereiche. Nach jeder Feature-Arbeit wird der passende Eintrag aktualisiert; die Projektregel steht in [AGENTS.md](AGENTS.md).

**Signierung seit 8. Oktober 2026:** Safari und Langform-iPhone werden getrennt gebaut; alle lokalen Xcode-Projekte stehen auf manuelle Signierung. Normale Builds dürfen keine Apple-Zertifikate austauschen. Für die iPhone-App ausschließlich `bash scripts/deploy-iphone.sh` verwenden; das Skript prüft vorhandene lokale Signierungsmittel, baut ohne Xcodes automatische Signierung und signiert anschließend lokal. Bei fehlenden/abgelaufenen Profilen abbrechen und die Signierung gezielt warten. Automatische Signierung und `-allowProvisioningUpdates` nicht als Reparatur einschalten. Auch neu konvertierte Safari-Projekte werden durch `scripts/lock-safari-signing.py` auf manuelle, festgelegte Signierung gestellt. Beide verwenden momentan noch dieselbe vorhandene Apple-Development-Identität; der normale iPhone-Build verwaltet sie aber nicht mehr.

## Was sie tut

- Läuft auf `https://www.youtube.com/*` und `https://m.youtube.com/*`. Safari auf dem iPhone öffnet die mobile Seite.
- Nimmt Shorts aus der Seite: Tab, Regale, Chips und Links, auch die untere Leiste auf dem Handy. Bevor YouTube zeichnet, liegt ein Stylesheet, danach entfernen die Skripte die Knoten. Watch-Videos bleiben.
- Wer `/shorts`, `/shorts/…` oder `/feed/shorts` öffnet, landet auf der Startseite desselben Hosts. Während die Umleitung läuft, steht dort: „Shorts sind blockiert. Weiter zur Startseite …“.
- Das Symbol in der Symbolleiste öffnet einen Schalter, **Shorts blockieren**. Standard ist an. Aus heißt: nichts verstecken und nicht umleiten. Waren Shorts schon aus dem DOM entfernt, lädt die Seite neu, damit sie wiederkommen. Die Wahl bleibt auf dem Gerät, ohne Konto.
- Lange Videos bekommen eine **Kurzfassung** auf Deutsch nach der [Vorgabe für verständliche Zusammenfassungen](docs/kurzfassung-vorgabe.md). Das Blatt beginnt mit **TLDR**, erklärt danach die wichtigsten Punkte und endet mit **Das bleibt hängen**. Der Prompt fordert sofort erklärte Fachbegriffe und erhält nötige Einschränkungen bei der Aussage oder in einer kurzen Einordnung. Meist reichen vier bis sechs Punkte und ungefähr 180–300 Wörter; einfache Videos bleiben kürzer. Die verfügbaren Untertitel werden vollständig gelesen, lange Quellen abschnittsweise analysiert und zu einer gemeinsamen Erklärung verdichtet. Bekannte Teilverarbeitung wird sichtbar gekennzeichnet. Die Untertitel kommen von YouTube; das lokale Apple-Modell schreibt den Text, in der iPhone-App direkt und in Safari über die App „Shorts ausblenden“. Bis zu zwölf erfolgreiche Ergebnisse bleiben während der Sitzung gespeichert. Safari speichert vollständig verarbeitete Ergebnisse zusätzlich sieben Tage lokal in der Erweiterung. Ein Fingerabdruck der Untertitel verhindert, dass geänderte Untertitel ein altes Ergebnis erhalten; die Untertitel selbst werden nicht gespeichert. Private Tabs nutzen diesen dauerhaften Speicher nicht. Gleichzeitige identische Anfragen und erneutes Öffnen einer laufenden Kurzfassung teilen dieselbe Berechnung. Fehlende oder unbrauchbare Inhalte und ein nicht verfügbares Modell erhalten eigene Hinweise. Der Knopf sitzt unter dem Titel. Das Blatt lässt sich scrollen und schließen.

  Seit Safari-Version 1.0.4 entscheidet ab macOS 26.4 das tatsächliche Tokenbudget des lokalen Modells, ob die komplette Quelle in einem Durchlauf verarbeitet werden kann. Anweisungen, Antwort und Reserve werden mitgerechnet. Längere Quellen werden in zusammenhängende Abschnitte von höchstens 6.800 UTF-8-Bytes gepackt; Nachbarkontext und Originalbelege bleiben erhalten. Ältere Systeme nutzen die bisherige konservative Aufteilung.

  Seit Safari-Version 1.0.5 erzeugt das Modell direkt die benötigten Felder. Dadurch entfällt zusätzlicher Nachtext nach dem Merksatz, den die Oberfläche bislang verworfen hat. Der fertig formulierte TLDR kann bereits während der restlichen Generierung erscheinen und bleibt als laufende Vorschau markiert. Bei langen Quellen zeigt das Blatt den tatsächlichen Bearbeitungsschritt. Optionale Statusabfragen laufen neben der unverändert offenen Hauptanfrage; sie starten keine weitere Berechnung. Vorschauen werden nur im Arbeitsspeicher gehalten, nach Profil und Anfrage getrennt und niemals als fertige Kurzfassung gespeichert.

  Für längere Safari-Anfragen hält ein eigener Nachrichtenport den Hintergrund aktiv. Der Seitenkontext sendet alle 20 Sekunden einen Heartbeat, den der Hintergrund beantwortet, bis die Modellanfrage endet. Diese Nachrichten starten keine zusätzliche Zusammenfassung. Der Port akzeptiert nur die eigene Erweiterung auf den erlaubten HTTPS-YouTube-Ursprüngen.
- **Transkript** neben „Kurzfassung“ öffnet ein kleines Fenster direkt in YouTube. Dort lassen sich die vollständigen verfügbaren Untertitel lesen und mit **Kopieren** übernehmen. Das Fenster lässt sich über ×, Escape oder den Hintergrund schließen. Status und Abnahme stehen im [Backlog unter LF-60](docs/VERBESSERUNGS_BACKLOG.md#lf-60--copy-transcript-in-der-safari-erweiterung--13102026).
- **A/S/D auf der Videoseite:** D startet ein pausiertes Video mit **1×**. Läuft das Video bereits, verdoppelt jeder Druck das tatsächliche Tempo bis **8×** (1× → 2× → 4× → 8×). S pausiert und setzt die Geschwindigkeit sofort auf **1×**. Auch jede Pause per Leertaste oder Mausklick setzt auf 1× zurück, sodass die nächste Wiedergabe normal beginnt. A halbiert bei laufendem Schnellvorlauf das Tempo (8× → 4× → 2× → 1×); bei 1× oder Pause springt A **5 Sekunden zurück**. Gedrückthalten erhöht das Tempo nicht; Suchfelder, Kommentare und offene Dialoge behalten ihre normale Tastaturbedienung. [Status unter LF-64](docs/VERBESSERUNGS_BACKLOG.md#lf-64--safari-wiedergabe-über-asd--14102026).
- **Werbung automatisch entfernen:** Die Safari-Erweiterung filtert Werbeplätze schon aus den Playerantworten, bevor YouTube sie abspielt. Banner, Begleitanzeigen, Masthead und Feedanzeigen werden ausgeblendet. Verbleibende Videowerbung wird über YouTubes eigenen Knopf **Überspringen** beendet, sobald er freigegeben wird – auch wenn er zunächst gesperrt war. Ohne verfügbaren Knopf bleibt die Werbung stumm; bei gepufferten Streams übernimmt YouTube den Übergang zum Hauptvideo. Das Hauptvideo wird dabei nie angehalten oder verschoben. Wechselnde oder direkt in den Videostream eingebaute Werbeformen können weiterhin durchkommen. [Stand und Prüfung unter LF-71](docs/VERBESSERUNGS_BACKLOG.md#lf-71--safari-werbung-verhindern-und-überspringen--15102026).
- Kein Server, keine Auswertung, keine weiteren Dienste. Kein Download, kein Auslesen von Stream-Adressen.

## Was sie nicht tut

Die Erweiterung kann die YouTube-App auf dem iPhone oder Android nicht verändern. Auf dem Telefon gilt sie nur, wenn YouTube in Safari geöffnet ist.

Mit einer kostenlosen Apple-ID muss die App etwa alle **7 Tage** neu signiert werden. Danach in Xcode erneut auf das iPhone spielen, sonst startet die Erweiterung nicht mehr.

## Kurz testen in Chrome

1. `chrome://extensions` öffnen.
2. Entwicklermodus einschalten.
3. „Entpackte Erweiterung laden“ und den Ordner `extension` dieses Projekts wählen.
4. YouTube öffnen. Shorts-Regale sollten fehlen. Ein Aufruf von `https://www.youtube.com/shorts` springt auf die Startseite.
5. Auf das Symbol klicken und **Shorts blockieren** ausstellen. Die Seite lädt neu, danach sind Shorts wieder da.

## Kurz testen in Firefox

1. `about:debugging#/runtime/this-firefox` öffnen.
2. „Temporäres Add-on laden…“ und die Datei `extension/manifest.json` wählen.
3. Wie in Chrome prüfen. Temporäre Add-ons verschwinden, wenn Firefox schließt.

## Auf dem Mac in Safari

Für die Weitergabe einer fertigen Test-App gibt es [eine Installationsanleitung](scripts/safari-friend/INSTALLIEREN.txt), einen optionalen lokalen Kopierhelfer und [Hilfe für Claude](scripts/safari-friend/CLAUDE.md). Der Empfänger braucht für die fertige App kein Xcode. Sie ist eine Ad-hoc-signierte Beta ohne Notarisierung; Safari verlangt nach jedem vollständigen Beenden erneut „Nicht signierte Erweiterungen erlauben“. Empfängerinstallation und Live-Funktion bleiben im gemeinsamen [Backlog unter LF-59](docs/VERBESSERUNGS_BACKLOG.md#lf-59--safari-testpaket-für-einen-freund--13102026) dokumentiert.

Ein separater Universal-Build für Intel und Apple Silicon mit macOS-Mindestziel 12 lässt sich mit vollständigem Xcode ohne Apple-Account oder Zertifikatsverwaltung erzeugen. Einen neuen, noch nicht vorhandenen Ausgabeordner wählen:

```bash
python3 scripts/build-safari-friend.py --output "$HOME/Downloads/Langform-Safari-Neubau"
```

Die erzeugte `Langform Safari.app` wird danach gemäß der Installationsanleitung abgelegt. Lokale Apple-Kurzfassungen benötigen weiterhin ein verfügbares Apple-Intelligence-Modell auf einem kompatiblen Mac mit macOS 26 oder neuer; das Mindestziel des Bundles ist keine Geräteabnahme. Der nachfolgende historische Entwicklerweg verwendet dagegen Tans festgelegte lokale Signierung.

Voraussetzung: Xcode aus dem App Store, einmal geöffnet, damit die Kommandozeilenwerkzeuge da sind.

1. Im Terminal in diesen Projektordner wechseln und ausführen:

   ```bash
   bash scripts/convert-safari.sh
   ```

   Das Skript ruft `xcrun safari-web-extension-converter` auf und erzeugt ein Xcode-Projekt für macOS und iOS. Es liegt unter `safari/`. Die Projektdatei heißt `Shorts ausblenden.xcodeproj`.

2. Diese Projektdatei in Xcode öffnen.
3. Oben das Schema der macOS-App wählen.
4. App und Extension sind bereits auf manuelle Signierung mit der festgelegten vorhandenen Identität eingestellt. Diese muss im Schlüsselbund vorhanden und gültig sein. Fehlende Signierungsmittel bewusst bereitstellen; **Automatically manage signing** ausgeschaltet lassen.
5. Run (⌘R). Die kleine Mac-App startet und bietet an, die Safari-Einstellungen zu öffnen.
6. Safari → Einstellungen → Erweiterungen → „Shorts ausblenden“ aktivieren und den Zugriff auf `www.youtube.com` erlauben.
7. Lehnt Safari die Erweiterung als unsigniert ab: Safari → Einstellungen → Erweitert → „Funktionen für Webentwickler anzeigen“. In Safari 17 oder neuer danach Einstellungen → Entwickler → „Nicht signierte Erweiterungen erlauben“; bei älteren Versionen steht die Option im Menü Entwickeln. Anschließend die Erweiterung aktivieren. Die Erlaubnis wird beim vollständigen Beenden von Safari zurückgesetzt.

Nach Änderungen an `extension/` das Konverter-Skript erneut ausführen, damit Xcode die neue Fassung kopiert.

## Auf dem iPhone

Dasselbe Xcode-Projekt. Safari-Erweiterungen laufen nicht im Simulator, deshalb ein echtes iPhone.

1. iPhone per Kabel verbinden. Ab iOS 16: Einstellungen → Datenschutz & Sicherheit → Entwicklermodus einschalten und das iPhone neu starten.
2. In Xcode das Schema der iOS-App wählen und als Ziel das eigene iPhone.
3. Die iPhone-Safari-Erweiterung benötigt eigene passende lokale Profile. Das Konverterprojekt verwaltet keine Zertifikate automatisch. Fehlende Profile separat bereitstellen; die automatische Signierung nicht als Reparatur einschalten. Für die eigenständige Langform-App gilt stattdessen `ios/Langform/README.md`.
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
