# Lokale iPhone-Bildschirmaufnahme

Entwicklerwerkzeuge für den ausdrücklich angeforderten Langform-Test. Kein Bestandteil der iPhone-App. Benötigt Xcode auf dem Mac, SrTan per USB, entsperrt und dem Mac vertrauend. Keine Kameraquelle auswählen. Der Recorder verlangt gleichzeitig den Namen **SrTan**, die angegebene Quell-ID und den Medientyp `muxed`; Audioverbindungen am Ausgang sind ausgeschaltet.

Aus dem Repository bauen (Ausgaben außerhalb des iCloud-Ordners):

```sh
xcrun swiftc scripts/diagnostics/ScreenSources.swift -o /tmp/langform-screen-sources
xcrun swiftc scripts/diagnostics/RecordScreen.swift -o /tmp/langform-record-screen -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker scripts/diagnostics/CaptureInfo.plist
xcrun swiftc scripts/diagnostics/VideoFrames.swift -o /tmp/langform-video-frames
/tmp/langform-screen-sources
```

Aus der Geräteliste die ID von **SrTan mit `muxed=true`** übernehmen. Nicht „Kamera von SrTan“ oder ein Mikrofon verwenden. Die Capture-ID ist eine andere ID als die UDID für `devicectl` und kann auf dem Laptop abweichen.

```sh
/tmp/langform-record-screen SCREEN_SOURCE_UID "$PWD/docs/qa/player/local-recordings/neuer-test.mov" 60
```

Erst **`RECORDING_STARTED`** bedeutet, dass tatsächlich ein Segment schreibt. Vorhandene Dateien werden nicht überschrieben. Maximal 180 Sekunden plus kurze Abschlussfrist. Vorzeitiges Ende über `touch docs/qa/player/local-recordings/neuer-test.mov.stop`; für einen weiteren Lauf einen neuen Namen verwenden. Keine automatische Aufnahme beim Appstart, keine Hintergrundüberwachung.

USB-Screen-Capture lieferte beim Test Zeitstempelsprünge und vorzeitig beendete MOV-Dateien (`-11813`, teilweise `-11809`, mit erfolgreich gespeicherten Samples). Deshalb beginnt der Recorder anschließend `-part2.mov` usw. **Zwischen Segmenten können Bilder fehlen; kein lückenloser Zeit- oder FPS-Nachweis.** Aufnahme selbst kann die Geräteleistung beeinflussen. Zur Überprüfung des Playerfehlers anschließend auch ohne Aufnahme testen. Der erste alternative `AVCaptureVideoDataOutput`-Versuch lieferte keine Frames und ist hier nicht als funktionierende Lösung enthalten.

Einzelbilder aus einer lokalen Aufnahme:

```sh
/tmp/langform-video-frames docs/qa/player/local-recordings/neuer-test-part1.mov 0 1 2
```

Das Tool schreibt PNGs neben den Clip. Zeitpunkte müssen innerhalb der Clipdauer liegen. Die Dateien unter `local-recordings` bleiben im Projektordner für die iCloud-Weitergabe, sind aber von Git ausgeschlossen. Aufnahme vor Appwechseln beenden; der Recorder sieht den gesamten iPhone-Bildschirm, keine Finger und keine Touchmarkierungen.

# Lokale WebKit-Prüfungen

## Wiedergabesperre nach Schließen und Vorladen

```sh
python3 scripts/diagnostics/playback-suspension-webkit.py --output /tmp/langform-playback-suspension.jsonl
```

Der eigenständige macOS-WebKit-Test verwendet eine lokale stille WAV-Datei und die aktuellen `suspendPreparedPlayer`-/`resumePreparedPlayer`-Methoden aus der App. Er reproduziert die doppelte Sperre über einen Dokumentwechsel und prüft drei korrigierte Zyklen anhand des nativen Medienzustands, des `play()`-Ergebnisses und tatsächlichen Zeitfortschritts. Kein Netzwerk, keine Anmeldung und keine iPhone-Steuerung. Das temporäre Fenster schließt nach dem Test. Exitcode 0 und die letzte JSONL-Zeile mit `passed: true` bestätigen den Erfolg.

## Kommentar-Fixture

`comments-motion-fixture.py` baut eine eigenständige Offline-HTML-Datei aus den **aktuellen** iPhone-Skripten `WebViewLinks.js` und `CommentsMotion.js`. Der Repository-Pfad wird vom Skriptpfad abgeleitet. `CommentsMotionWebKit.swift` öffnet die Fixture in einer macOS-`WKWebView` und schreibt ausschließlich JSONL-Ergebnisse auf stdout. Benötigt Python 3, Xcode Command Line Tools und eine angemeldete grafische macOS-Sitzung; kein iPhone und keine Netzwerkverbindung.

Aus dem Repository:

```sh
python3 scripts/diagnostics/comments-motion-fixture.py --output /tmp/langform-comments-motion/fixture.html
xcrun swiftc scripts/diagnostics/CommentsMotionWebKit.swift -o /tmp/langform-comments-motion/webkit
/tmp/langform-comments-motion/webkit /tmp/langform-comments-motion/fixture.html > /tmp/langform-comments-motion/results.jsonl
```

Nach jeder Änderung der Produktionsskripte die Fixture neu erzeugen. `--output` bezeichnet eine HTML-Datei; deren Ordner wird bei Bedarf erstellt. Ohne Option liegt die Datei im temporären Verzeichnis unter `langform-comments-motion/fixture.html`.

Der Lauf prüft acht Szenarien:

- Direktes Öffnen sowie Hydration nach 120 und 600 ms.
- Berührung während des Öffnens sowie Schließen während und nach dem Öffnen mit verzögerter Entfernung des Panels.
- Bereits gescrollter äußerer Wrapper: Das ursprüngliche Schließen läuft sofort genau einmal und behält den Scrollstand bis zum Original-Handler.
- CSS-Grenzen des temporären Clippings: nur `.at-top` im Panel; ursprünglicher Overflow beim Drag und außerhalb des Panels bleibt erhalten, ebenso YouTubes Drag-Transform.

Die ersten sechs Szenarien rufen tatsächlich `button.focus()` auf, bei Hydration auf dem neu erzeugten Button. Sie prüfen Fokus-Erhalt, keinen ungewollten äußeren Scrollsprung und nach dem Ende des Clippings die wiederhergestellte Scrollbarkeit. Die innere Kommentarliste und der feste Scrim bleiben separat.

Bewegung wird über aufeinanderfolgende `requestAnimationFrame`-Messungen bewertet. Synchrone Vorher-/Nachher-Werte an Hydration, Berührung und Schließen bleiben als Rohdaten erhalten: `getComputedStyle` kann unmittelbar nach dem Austausch einer Animation noch den vorherigen WebKit-Tick liefern. Diese Zwischenmessung zählt deshalb nicht als dargestellter Rückwärtssprung.

Die letzte JSONL-Zeile enthält `finished: true` und `passed`. Exitcodes: **0** bestanden, **1** fehlgeschlagene Prüfung, **2** Zeitüberschreitung, **64** falsche Argumentanzahl, **66** nicht lesbare Fixture. Ohne Fixture-Argument zeigt der Runner eine Usage-Meldung statt abzustürzen. Ein Lauf dauert ungefähr sieben Sekunden und schließt sein Fenster danach.

Das ist eine Prüfung der aktuellen Skripte mit echtem macOS-WebKit auf einer nachgebauten Kommentarseite. Sie belegt weder die aktuelle YouTube-DOM-Struktur noch reale Touchgesten, die iPhone-Bildrate oder visuell geprüfte Geräteframes.


Weitere Offline-Motion-Fixtures für denselben `CommentsMotionWebKit.swift`-Runner:

```sh
python3 scripts/diagnostics/discovery-motion-fixture.py --output /tmp/langform-discovery/fixture.html
python3 scripts/diagnostics/feed-press-fixture.py --output /tmp/langform-feed-press/fixture.html
python3 scripts/diagnostics/feed-surface-motion-fixture.py --output /tmp/langform-feed-surface/fixture.html
```

Entdecken prüft vier Öffnen-/Fokus-/Umkehrfolgen, Feed-Press prüft erneutes Drücken während der Rückkehr. Beide betten den aktuellen Produktionscode ein und melden JSONL über denselben Runner. Kurzfassung und Kapitel: [eigene Anleitung](overlays-motion-README.md). Alle Fixtures prüfen macOS-WebKit, keine physischen iPhone-Tipps oder garantierte Bildraten.

Feed-Surface prüft elf Abläufe mit dem aktuellen `FeedMotion.js`: sichtbare Karten, gestaffelte Ankunft, Touch-/Scroll-Unterbrechung, Suchsteuerung, native Sichtbarkeit und reduzierte Bewegung. Die Inhalte bleiben während der Dekoration lesbar; es wird keine echte YouTube-Navigation oder iPhone-Framerate simuliert.
