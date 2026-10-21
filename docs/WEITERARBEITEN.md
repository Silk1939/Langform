# Langform weiterentwickeln

Stand: 22.10.2026. Zuerst [AGENTS.md](../AGENTS.md) und das [gemeinsame Backlog](VERBESSERUNGS_BACKLOG.md) lesen. Das Backlog ist die einzige Aufgaben- und Statusliste: vor einer Änderung den vorhandenen Eintrag suchen und danach Änderung, tatsächliche Prüfung, offene Abnahme und nächsten Schritt dort ergänzen. Diese Datei erklärt den Einstieg; die [Übergabe](../UEBERGABE.md) bewahrt historische Nachweise.

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

`npm test` führt zuerst die gemeinsamen Regressionen und danach die Web-App-Tests aus. Swift-/WebKit-Fälle benötigen macOS und vollständiges Xcode; bestimmte Medienfälle zusätzlich `ffmpeg`. Fehlgeschlagene und übersprungene Fälle getrennt festhalten. Die historische zweite, mit Astra geprüfte Exportkopie vom17.10. besteht2.270 Root-/108 Webtests, Web-Lint, Produktionsbuild und zwei separate Simulatorfälle37/32. [Aktueller Prüfstand](ASTRA_BUGCHECK_2026-10-17.json). Drei weitere bestätigte Fehler sind korrigiert; Transkript zusätzlich im echten WebKit geprüft. Der transitive Abhängigkeitsbefund LF-74 bleibt offen; Details und nächste Schritte stehen ausschließlich im Backlog. Historische Zahlen gelten nur für den jeweils dokumentierten Stand.

Für die iPhone-App Xcode 27 und eine installierte iOS-Simulatorlaufzeit verwenden. Ohne Geräte-/Apple-Signierung bauen und anschließend den passenden Simulatorlauf ausführen:

```bash
xcodebuild -project ios/Langform/Langform.xcodeproj -scheme Langform \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
bash scripts/test-simulator.sh --device SIMULATOR_UDID
```

`SIMULATOR_UDID` durch die Kennung einer eigenen verfügbaren Simulatorinstanz ersetzen. Der Runner installiert den gebauten Stand dort; bei paralleler Arbeit eine eigene Instanz verwenden. Ohne `--device` wählt er selbst einen verfügbaren iPhone-Simulator. Wiederholungen: `--iterations N`; gezielte Fälle: `--only-testing TEST_ID`. Ergebnisse liegen unter `docs/qa/simulator-runs/` oder dem mit `--output` gewählten lokalen Ordner. Ein positiver Watch-Diagnoseeinstieg belegt keinen Feed-Fingertap und keinen gehörten Videoton.

Die neue iPhone-Laufzeit kommt aus dem gepinnten Swift-Paket `https://github.com/google-ai-edge/LiteRT-LM.git`, Version0.18.0, Revision `b2f686e2ed4718fb84ec398a61dd59ca0f0aff27`; die zugehörige `Package.resolved` ist enthalten. Für einen frischen Paketcheckout Git LFS bereitstellen, falls Xcode die Artefakte damit auflöst. Ein vorhandener vollständiger Paketcache kann mit `LANGFORM_SOURCE_PACKAGES_DIRECTORY` an beide Runner übergeben werden. Einen Pfad auf dem eigenen Mac verwenden; keine fremden DerivedData-Verzeichnisse voraussetzen. Builds mit niedriger Priorität und höchstens zwei Xcode-Jobs ausführen; keine überlappenden Modell-, Simulator- und Buildläufe.

`GemmaModelStore.swift` enthält den gepinnten Download-/SHA-Vertrag. Modellgewichte, Laufzeitcaches und persönliche Daten gehören nicht zum Repository. Die normale native iPhone-Route verwendet Gemma; Simulator/macOS nutzen den getrennten Apple-Pfad. Ein Simulatorpass beweist deshalb keine echte Gemma-Inferenz. Historische alternative Modell-Evaluatoren unter `scripts/diagnostics/evaluate-*` benötigen teilweise bewusst ausgeschlossene lokale QA-Manifeste/-Quellen; sie gehören nicht zum standardmäßigen `npm test` und starten nicht automatisch.

Die vorhandene manuelle Signierung erhalten. `scripts/deploy-iphone.sh` ist auf das ursprüngliche Gerät und vorhandene lokale Signierungsmittel festgelegt. Für ein eigenes physisches Gerät Bundle-ID, Team, Zertifikat und Profile in einer separaten Arbeitskopie bewusst konfigurieren; keine automatische Signierungsreparatur einschalten. Details: [iPhone-README](../ios/Langform/README.md), [UI-Runner](../ios/DeviceTests/README.md).

## Welchen Stand übernimmt man?

Den aktuellen Quell-, Prüf-, Installations- und Abnahmestand ausschließlich aus dem [Backlog](VERBESSERUNGS_BACKLOG.md) übernehmen. Die veröffentlichte Übergabe und ihre tatsächlich wiederholten bzw. übernommenen Nachweise beschreibt [GITHUB_UPDATE_2026-10-22.json](GITHUB_UPDATE_2026-10-22.json). Historische Buildberichte gelten nur für ihren datierten Umfang; weder ein signierter Kandidat noch Simulatorerfolg bestätigt persönliche Finger-, Ton-, Bluetooth-, Offline- oder Modellqualität.

Lokale QA-Rohdaten, Aufnahmen, Netzantworten und Buildprodukte sind absichtlich nicht im öffentlichen Repository. Historische Links darauf können im Klon fehlen. Die zwei öffentlichen JSON-Fixtures unter `docs/qa/`, beide npm-Lockdateien und die Testfixtures werden für die Regressionen mitgeliefert. Schlüssel, Zertifikate und Provisionierungsprofile gehören nicht in GitHub.

## Beiträge über GitHub

Das öffentliche Repository ist [Silk1939/Langform](https://github.com/Silk1939/Langform). Zum Mitarbeiten einen Fork erstellen, diesen klonen, einen eigenen Arbeitsbranch anlegen und Änderungen als Pull Request an das Original senden. Ein öffentlicher Klon allein verleiht keinen Schreibzugriff auf das Original. Im Pull Request die konkrete Änderung, passende Prüfungen und offene Geräteabnahmen nennen; den bestehenden Backlogeintrag im selben Änderungssatz aktualisieren.
