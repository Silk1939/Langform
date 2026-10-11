# Langform – Projektregeln

Diese Regeln gelten für das gesamte Projekt: iPhone-App, Safari-/Browser-Erweiterung und Web-App.

## Backlogpflege nach jeder Feature-Arbeit

- `docs/VERBESSERUNGS_BACKLOG.md` ist das einzige gemeinsame Projektbacklog. Vor Feature- oder Bugfix-Arbeit den passenden Eintrag lesen; fehlt er, die nächste freie `LF-`-ID vergeben. Vorhandene IDs erhalten und doppelte Aufgaben vermeiden.
- Nach jeder Bearbeitung den Eintrag im selben Arbeitsgang aktualisieren oder aufnehmen – auch bei Teilfortschritt, Abbruch oder neu entdeckten offenen Punkten. Datum, konkrete Änderung, tatsächlicher Status, relevante Dateien/Nachweise, ausgeführte Prüfung und nächster Schritt gehören dazu.
- Aktuellen Überblick und Detailnachweis gemeinsam pflegen. Andere Pläne/README-Dateien verweisen auf das Backlog; sie bilden keine unabhängig gepflegte Aufgabenliste.
- „Umgesetzt“, „automatisiert geprüft“, „installiert“ und „vom Nutzer abgenommen“ auseinanderhalten. Offene Geräte-/Fingerabnahme explizit offen lassen; „Erledigt“ nur bei erfüllten dokumentierten Kriterien. Historische Nachweise erhalten und datieren.
- Ein Backlogeintrag autorisiert keine Umsetzung. Zurückgestellte Features erst auf erneuten Nutzerauftrag aufnehmen. Dynamic Island (LF-31) und Downloads (LF-32) sind seit 10.10.2026 zurückgestellt; der automatische Dynamic-Island-Anschluss bleibt pausiert.
- Bei parallelen Chats vorhandene Änderungen erhalten und aktuelle Einträge erneut lesen, bevor der Status geändert wird. Die Backlogpflege muss vor dem Abschlussbericht erfolgt sein.

## Simulatorprüfung nach iPhone-Arbeit

- Auf Nutzerauftrag vom 11.10.2026 ist die iOS-27-Simulatorlaufzeit installiert. Bei iPhone-Änderungen die passenden lokalen Regressionen und `scripts/test-simulator.sh` selbst ausführen, bevor erneut ein echtes iPhone angefordert wird. Für wiederholte UI-Prüfungen unterstützt der Runner `--iterations N`; Nachweise liegen unter `docs/qa/simulator-runs/` oder dem mit `--output` angegebenen Pfad.
- Der Runner baut ausschließlich für `iphonesimulator` mit `CODE_SIGNING_ALLOWED=NO`. Bestehende manuelle Geräte-/Safari-Signierung erhalten; keine automatische Provisionierung oder Zertifikatserneuerung aktivieren.
- Bestanden, fehlgeschlagen und übersprungen getrennt dokumentieren. Der Testvideo-Einstieg über die vorhandene Diagnoseprobe belegt die normale Watch-Route und anschließende UI-Bedienung, keinen Feed-Fingertap oder erfolgreichen Videoton. Physische Gestenabnahme, Hintergrundton, Sperrbildschirm/Systemmedien und gerätespezifische Modellverfügbarkeit bleiben eigenständige Prüfungen.
