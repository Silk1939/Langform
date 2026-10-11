# Separater Langform-Gerätetest

Separater XCTest-UI-Runner für die **bereits installierte** App `de.ipekkaya.langform`. Dieses Projekt enthält keinen App-Target und verändert das Originalprojekt nicht. Der Runner selbst muss für SrTan signiert/installiert werden; die App wird nicht überschrieben. Keine Abhängigkeiten außer Apples XCTest.

Zuerst nur Discovery ausführen. Accessibility-Baum wird als Text-Anlage im lokalen `.xcresult` gespeichert, keine privaten Screenshots im Chat. Zeit in der Anlage enthält Automationsaufwand und ist kein Produktions-Startup-Messwert. Launch startet die vorhandene App neu und aktiviert deren lokale Diagnosemessung. Kein Logout, keine Datensatzlöschung, keine Einstellungen am iPhone.

Root koordiniert den tatsächlichen Gerätezugriff. **Der Runner ist auf manuelle Signierung gestellt. Aktuell liegt für ihn kein gültiges Profil mit dem festgelegten Zertifikat vor; den folgenden Lauf erst nach bewusster Bereitstellung eines passenden Profils ausführen.** Automatische Signierungsreparatur ist kein zulässiger Fehler-Fallback: Sie kann das von Safari verwendete Zertifikat widerrufen. Für das derzeitige kostenlose Personal-Team-Profil ist zusätzlich ein ausdrücklich lokal signierter Test-Runner nötig; das App-Deployment-Skript unterstützt nur Langform, nicht diesen Runner.

Referenz für einen späteren Lauf mit separat bereitgestelltem, manuell nutzbarem Runner-Profil:

```sh
xcodebuild test \
  -project ios/DeviceTests/LangformDeviceTests.xcodeproj \
  -scheme LangformDeviceTests -configuration Debug \
  -destination 'platform=iOS,id=00008160-001234D11440000A' \
  -derivedDataPath /tmp/langform-uitest-harness/DerivedData \
  -resultBundlePath /tmp/langform-uitest-harness/discovery.xcresult \
  -parallel-testing-enabled NO \
  -maximum-concurrent-test-device-destinations 1 \
  -only-testing:LangformDeviceTests/DeviceAccessibilityTests/test01DiscoverHomeAccessibility \
  DEVELOPMENT_TEAM=RFN59MUTQ3 CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY=E94E8C9CC2FF184832B68E4C02A332867D66F560 \
  > /tmp/langform-uitest-harness/discovery.log 2>&1
```

Danach den lokalen Accessibility-Baum prüfen. `test02PublicNASASearch` nutzt eindeutig beschriftete Accessibility-Elemente und sucht ausschließlich nach der öffentlichen Anfrage **NASA**. `test03PublicWatchAndReadOnlyCommentsIfIdentifiable` ist optional und tippt nur einen Link mit expliziter Watch-URL als Accessibility-ID. Fehlen eindeutige Controls, wird der betreffende Test mit Erklärung übersprungen; dies ist kein positiver Funktionsnachweis. Fehlende/übersprungene Schritte anschließend konkret anhand der lokalen Discovery anpassen.

Für Folgetests einen neuen `-resultBundlePath` angeben; Xcode überschreibt bestehende Result-Bundles nicht. Keine andere UDID verwenden. Der erstellende Agent hat **keinen Build, keine Installation und keinen Gerätetest** ausgeführt.

## Tatsächlich ausgeführter Versuch (8. Oktober 2026)

Runner-Build erfolgreich. Auf SrTan wurde kein XCTest-Test gestartet: Installation am Maximum von drei Apps mit kostenlosem Entwicklerprofil gescheitert. Die übrigen installierten Apps wurden erhalten. Gerätetests hier deshalb **offen**, weder Discovery noch Suche/Watch/Kommentare als erfolgreich zählen. Log: `/tmp/langform-uitest-harness/discovery.log`. Kein Simulatorversuch.

Das App-Projekt bleibt getrennt; der Runner prüft die bereits installierte App. Das Verfahren überschreibt Langform nicht. Nur bei vorhandener Installationskapazität oder einem vom Nutzer selbst bereitgestellten zulässigen Signing-Team erneut versuchen. Keine vorhandenen Apps automatisch entfernen.
