# Langform weiterentwickeln

Stand: 17.10.2026. Zuerst [AGENTS.md](../AGENTS.md) und das [gemeinsame Backlog](VERBESSERUNGS_BACKLOG.md) lesen. Das Backlog ist die einzige Aufgaben- und Statusliste: vor einer Änderung den vorhandenen Eintrag suchen und danach Änderung, tatsächliche Prüfung, offene Abnahme und nächsten Schritt dort ergänzen. Diese Datei erklärt den Einstieg; die [Übergabe](../UEBERGABE.md) bewahrt historische Nachweise.

## Projektteile und Startdateien

- **iPhone-App:** `ios/Langform/Langform.xcodeproj`; Einstieg `ios/Langform/Langform/LangformApp.swift`. `YouTubeWebView.swift` verbindet die echte YouTube-Seite, native Playeransichten und Gesten. Die benachbarten JS-Dateien steuern die eingebettete Seite; `Motion.swift`, `PlayerGesturePolicy.swift` und `PlayerViewportPolicy.swift` bündeln native Bewegungs- und Darstellungsregeln. Ein Teil der gemeinsamen JS-Ressourcen kommt aus `extension/src/`.
- **Browser-Erweiterung:** `extension/manifest.json` legt Ressourcen und Ausführungswelten fest. `extension/src/content.js` startet die Shorts-Steuerung; `summary.js` und `page-captions.js` verbinden Kurzfassung und Untertitel. Der native Safari-Handler liegt in `native/SafariWebExtensionHandler.swift`. Für einen separaten macOS-Testbuild ohne Apple-Account gibt es `scripts/build-safari-friend.py`; Anleitung im [README](../README.md#auf-dem-mac-in-safari).
- **Web-App:** eigenständige Next.js-App in `apps/langform/`; Einstieg `src/app/page.tsx`, gemeinsame Oberfläche `src/components/app-shell.tsx`, Metadaten-/Providerzugriff in `src/lib/metadata.ts`, Serverrouten in `src/app/api/`. Änderungen daran werden nicht automatisch Teil der nativen iPhone-App oder Safari-Erweiterung.
- **Prüfungen:** gemeinsame Regressionen in `tests/`, Web-App-Tests direkt bei den Quellen, UI-Runner in `ios/DeviceTests/`, Diagnosehelfer in `scripts/diagnostics/`.

## Lokaler Start

Node.js 22 und npm 10 sind lokal erprobt. Im Projektroot:

```bash
npm ci
npm ci --prefix apps/langform
npm run dev --prefix apps/langform
```

Die Web-App öffnet unter `http://127.0.0.1:43123`. Ein YouTube-API-Schlüssel ist optional: Vorlage `apps/langform/.env.example`, eigene Werte lokal in `apps/langform/.env.local`. Ohne Schlüssel nutzt die Web-App öffentliche Metadatenanbieter; deren Verfügbarkeit ist unabhängig vom lokalen Build.

## Änderungen prüfen

```bash
npm test
npm run lint --prefix apps/langform
npm run build --prefix apps/langform
```

`npm test` führt zuerst die gemeinsamen Regressionen und danach die Web-App-Tests aus. Swift-/WebKit-Fälle benötigen macOS und vollständiges Xcode; bestimmte Medienfälle zusätzlich `ffmpeg`. Fehlgeschlagene und übersprungene Fälle getrennt festhalten. Die frische Exportkopie vom17.10. besteht2.266 Root-/87 Webtests, Web-Lint, Produktionsbuild und den gezielten Simulatorfall35. [Prüfstand](GITHUB_UEBERGABE_PRUEFUNG_2026-10-17.json). Zwei bestätigte Fehler sind korrigiert. Der transitive Abhängigkeitsbefund LF-74 bleibt offen; Details und nächste Schritte stehen ausschließlich im Backlog. Historische Zahlen gelten nur für den jeweils dokumentierten Stand.

Für die iPhone-App Xcode 27 und eine installierte iOS-Simulatorlaufzeit verwenden. Ohne Geräte-/Apple-Signierung bauen und anschließend den passenden Simulatorlauf ausführen:

```bash
xcodebuild -project ios/Langform/Langform.xcodeproj -scheme Langform \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
bash scripts/test-simulator.sh --device SIMULATOR_UDID
```

`SIMULATOR_UDID` durch die Kennung einer eigenen verfügbaren Simulatorinstanz ersetzen. Der Runner installiert den gebauten Stand dort; bei paralleler Arbeit eine eigene Instanz verwenden. Ohne `--device` wählt er selbst einen verfügbaren iPhone-Simulator. Wiederholungen: `--iterations N`; gezielte Fälle: `--only-testing TEST_ID`. Ergebnisse liegen unter `docs/qa/simulator-runs/` oder dem mit `--output` gewählten lokalen Ordner. Ein positiver Watch-Diagnoseeinstieg belegt keinen Feed-Fingertap und keinen gehörten Videoton.

Die vorhandene manuelle Signierung erhalten. `scripts/deploy-iphone.sh` ist auf das ursprüngliche Gerät und vorhandene lokale Signierungsmittel festgelegt. Für ein eigenes physisches Gerät Bundle-ID, Team, Zertifikat und Profile in einer separaten Arbeitskopie bewusst konfigurieren; keine automatische Signierungsreparatur einschalten. Details: [iPhone-README](../ios/Langform/README.md), [UI-Runner](../ios/DeviceTests/README.md).

## Welchen Stand übernimmt man?

Build **72** ist der aktuelle native Quellstand und bisher nur im Simulator gebaut und gezielt geprüft. Auf dem ursprünglichen echten iPhone ist zuletzt Build **71 vom 16.10.2026** bestätigt. Die offenen Befunde stehen unter **LF-33** (sichtbarer früher Größenschritt beim Vollbildrückweg), **LF-56** (Zoom/Reset), **LF-70** (unter anderem Caption-Befund) und **LF-67** (Audioverlust nach Gestenmischung, Bluetoothursache offen) im [Backlog](VERBESSERUNGS_BACKLOG.md). Dort stehen die Details, Abnahmekriterien und nächsten Schritte; diese Datei führt keine eigene Aufgabenliste. Persönliche Finger-, Motion-, Ton-, Bluetooth- und Systemmedienabnahmen bleiben getrennt. **LF-31 und LF-32 bleiben zurückgestellt.**

Lokale QA-Rohdaten, Aufnahmen, Netzantworten und Buildprodukte sind absichtlich nicht im öffentlichen Repository. Historische Links darauf können im Klon fehlen. Die zwei öffentlichen JSON-Fixtures unter `docs/qa/`, beide npm-Lockdateien und die Testfixtures werden für die Regressionen mitgeliefert. Schlüssel, Zertifikate und Provisionierungsprofile gehören nicht in GitHub.

## Beiträge über GitHub

Das öffentliche Repository ist [Silk1939/Langform](https://github.com/Silk1939/Langform). Zum Mitarbeiten einen Fork erstellen, diesen klonen, einen eigenen Arbeitsbranch anlegen und Änderungen als Pull Request an das Original senden. Ein öffentlicher Klon allein verleiht keinen Schreibzugriff auf das Original. Im Pull Request die konkrete Änderung, passende Prüfungen und offene Geräteabnahmen nennen; den bestehenden Backlogeintrag im selben Änderungssatz aktualisieren.
