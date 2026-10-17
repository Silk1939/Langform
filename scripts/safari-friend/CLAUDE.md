# Hilfe bei der Installation von Langform Safari

Dieses Paket enthält eine fertige macOS-Test-App. Eine Installation benötigt
weder Xcode noch Claude, Entwickleraccount oder API-Schlüssel. Die App heißt
**Langform Safari.app**, die Erweiterung in Safari **Shorts ausblenden**.
`INSTALLIEREN.txt` ist die maßgebliche Anleitung.

Eine normale Claude-Unterhaltung kann die Anleitung erklären. Dateien lesen
oder den Helfer starten kann Claude nur, wenn die verwendete Variante Zugriff
auf diesen Ordner und ein Terminal hat, beispielsweise Claude Code. Fehlen
solche Werkzeuge, leite den Nutzer durch die manuellen Schritte.

## Auftrag für Claude mit Datei- und Terminalzugriff

Hilf mir, diese Langform-Safari-Testversion auf meinem eigenen Mac zu
installieren. Lies zuerst `INSTALLIEREN.txt` und `Installieren.command` im
entpackten Paket und überprüfe, dass `Langform Safari.app` daneben liegt.

1. Prüfe die macOS-Version und die Mac-Architektur, ohne Systemänderungen.
   Dieses Paket ist für Intel und Apple Silicon mit technischem Mindestziel
   macOS 12 vorgesehen. Versprich keine erfolgreiche Abnahme auf diesem Mac.
2. Prüfe die lokale Signatur der gelieferten App mit
   `codesign --verify --deep --strict`. Eine Ad-hoc-Signatur bestätigt nur die
   Unversehrtheit des Pakets; sie ist kein Apple-Developer-ID-Nachweis und
   keine Notarisierung. Bei fehlgeschlagener Prüfung stoppen.
3. Verwende den vorhandenen `Installieren.command`-Helfer, um die App nach
   `~/Applications` zu kopieren. Er sichert eine vorhandene App zuerst.
   Führe den Helfer nur aus dem tatsächlich entpackten Paket aus.
4. Erkläre mir die nötigen manuellen Freigaben: gegebenenfalls „Dennoch öffnen“
   für genau diese App in Datenschutz & Sicherheit, danach Safaris Entwickler-
   Funktionen und „Nicht signierte Erweiterungen erlauben“, Erweiterung
   aktivieren und Zugriff auf die beiden YouTube-Domains erlauben.
5. Weise darauf hin, dass Apple die Erlaubnis für nicht signierte Erweiterungen
   nach jedem vollständigen Safari-Beenden zurücksetzt. Bereits offene
   YouTube-Tabs müssen nach der Aktivierung neu geladen werden.
6. Lass mich Shorts-Ausblendung und /shorts/-Umleitung selbst prüfen. Bezeichne
   sie erst danach als erfolgreich getestet. Eine Kurzfassung benötigt macOS
   26 oder neuer sowie ein kompatibles und verfügbares lokales Apple-Modell;
   ein Intel-Mac hat keine Apple-Intelligence-Kurzfassung.

Verwende kein `sudo`, deaktiviere Gatekeeper nicht, entferne keine Quarantäne-
Attribute und ändere keine globalen Safari-Voreinstellungen. Melde mich nicht
bei Apple oder anderen Diensten an, verwalte keine Zertifikate und schalte
keine automatische Provisionierung ein. Starte keinen iPhone-Build. Lade
keine weitere Software herunter und sende keine Dateien oder Nachrichten.

Wenn macOS oder Safari manuelle Bestätigung benötigt, erkläre den konkreten
Schritt. Behaupte keine erfolgte Installation oder Aktivierung, die du nicht
beobachtet hast. Falls nur Chat-Zugriff vorhanden ist, verwende den manuellen
Weg in `INSTALLIEREN.txt`; führe keine erfundenen Terminalschritte an.
