# Übergabe Langform

## Entwicklerübergabe – 17.10.2026

Der Einstieg für einen neuen Entwickler steht in [docs/WEITERARBEITEN.md](docs/WEITERARBEITEN.md). Das Repository enthält die native iPhone-App, die Safari-/Browser-Erweiterung, die separate Web-App und die zugehörigen Tests. [AGENTS.md](AGENTS.md) und das [gemeinsame Backlog](docs/VERBESSERUNGS_BACKLOG.md) bleiben für Änderungen und Statuspflege maßgeblich.

Aktueller iPhone-Quellstand: **Build72, nur im Simulator gebaut und geprüft**; echtes iPhone zuletzt **71 vom16.10.2026** bestätigt. Zweite unabhängige Astra-Prüfung: drei weitere belegte Fehler unter LF-68/LF-48/LF-60 korrigiert. Finale Exportkopie **2.270 Root-/108 Webtests**, Lint/Produktionsbuild und separate Simulatorfälle37/32 bestanden; Transkript zusätzlich im echten WebKit geprüft. [Aktueller Astra-Prüfstand](docs/ASTRA_BUGCHECK_2026-10-17.json). Quellcommit `3f5c08469abe005fc9a014d0a0873a85af62b6d1` auf dem öffentlichen Main bestätigt und ohne Anmeldung geklont; alle401 Dateien samt ausführbaren Dateimodi bytegleich. Der [erste Prüfstand vom17.10.](docs/GITHUB_UEBERGABE_PRUEFUNG_2026-10-17.json) bleibt Historie. LF-74 und persönliche Abnahmen offen; keine neue Geräte-/Safari-Installation.

Vor der nächsten Änderung die bestehenden Einträge **LF-33** (früher Größenschritt bei Vollbildrückkehr), **LF-56** (Zoom/Reset), **LF-70** (unter anderem offener Caption-Befund) und **LF-67** (Audioverlust nach gemischten Gesten, Bluetoothursache offen) im Backlog lesen. Diese Hinweise sind ein Einstieg in die dort gepflegten Befunde. LF-31 und LF-32 bleiben zurückgestellt. Bestandene Simulatorfälle ersetzen keine Finger-, Motion-, Ton- oder Bluetoothabnahme auf dem Gerät.

Lokale QA-Aufnahmen, Rohlogs, Netzantworten, Schlüssel und Signierungsmaterial werden nicht öffentlich mitgeliefert. Deshalb sind viele historische `docs/qa/`-Links unten nur in der ursprünglichen lokalen Arbeitskopie auflösbar; die für Regressionen benötigten öffentlichen Fixtures sind enthalten. Die folgenden datierten Abschnitte bleiben als Historie erhalten. Frühere Angaben zu nicht ausgeführten Commits oder Deployments beschreiben jeweils den damaligen Auftrag.

## Aktueller Quell-/Prüfstand – 17.10.2026,72

Motionrollen, Sheets/Menüs/Thumbnail, sichtbare Vollbild-Fingerfolge, Controls-Fade sowie eng gebundene physische Quellpose/Cancel umgesetzt und automatisiert geprüft. Root2258/0/0, Web87/0/0. Gezielt positive Simulatorfälle stammen aus mehreren Bundles; die roten43-Zwischenläufe und der alte Caption40-Befund bleiben erhalten. Frühe Schrumpfstufe und Zoomreset bleiben offen. Die abschließende ruhige47-Gegenprobe bestätigt beide Ready; der vorangehende physische Grenzfall ohne Ready bleibt erhalten. Durchgehend verlässliche Bewegung und eine Hostlastursache sind nicht bewiesen.

**72 nur im Simulator; auf SrTan weiterhin bestätigter71 vom16.10.** Keine neue persönliche Finger-/Haptik-/Motion-/Tonabnahme. Manuelle Signierung unverändert. Verbindlicher Status und nächste Schritte im [gemeinsamen Backlog](docs/VERBESSERUNGS_BACKLOG.md#motion-review--17102026), Belege im [QA-Bericht](docs/qa/motion-review-2026-10-17/README.md). Neue Motion.swift und uncommittete/ungetrackte Quellen sowie Git-ignorierte QA beim Macwechsel mitnehmen. Kein Commit, Push, PR oder Safari-Deployment in diesem Motionauftrag.

## Aktueller Installationsstand – 16.10.2026

**Aktueller Installationsstand, 16.10.2026, 12:40 Uhr Berlin:** Langform **1.0 (71) auf SrTan installiert und normal gestartet**, Geräteinventar und laufender Prozess PID 69760 bestätigt. Neues Profil auf ausdrückliche Nutzerfreigabe mit unverändertem Zertifikat E94…F560 erstellt, gültig bis **23.10.2026 um 12:37:27 Uhr Berlin**. Zertifikatsbestand, manuelle Projekteinstellungen und Safari-Signierung unverändert. 44/44 Release-Ressourcen bytegleich, 74 Produkt-/UI-Dateien und 116 Tests unverändert; keine neue Simulatorserie. Gestriger Funktionsprüfstand 13/1 sowie Untertitel-/Motion-/Zoom-/Bluetoothbefunde und persönliche Abnahmen bleiben offen. [Installation und Nachweise](docs/qa/device-install-build71-2026-10-16/validation.json).

Neues Profil b8c8fe50-1c5b-40eb-9da9-ab384c9b6eb8 liegt in den Standardprofilen und im Downloads-Ordner `Langform-Signierung-2026-10-16`. Der bestehende Deploypfad kann es mit der unveränderten festen Identität verwenden. Kein privater Schlüssel exportiert. Erster StartLocked bleibt historisch; nach Nutzerentsperren Start und PID bestätigt. Kein erneuter Funktions-/Bluetooth-/Finger-Test. QA-Rohdaten beim Transfer mitnehmen. Das gemeinsame Backlog bleibt verbindlich.

## Historischer Arbeitsstand15.10. – Build71, lokaler Teilstand22:47Uhr

**Aktueller tatsächlicher Teilstand,15.10.2026,22:47Uhr,Build71 – nicht vollständig grün:** Korrekturen an Kommentar-Feder/Kontaktbesitz, Mini-/Settings-Trefferflächen, Captionabständen, Kapitelbesitz, Range-Release, Mini-Replay und nativer Vollbildübergabe integriert. Root **2195 bestanden/0 Fehler/3 bestehende FFmpeg-Skips**. Gemeinsame tatsächliche14-Fall-Serie **13 bestanden/1 fehlgeschlagen/0 übersprungen**, Fehler40: Untertitel sind An, aber bei0:28–0:32 fehlen Cues/Rendererinhalt; Cuepause durch gleichenVideozeit-Vergleich nicht bestätigt, Provider-/Originalplayer-/Appursache offen. Separate Pflichtläufe am identischen74-Dateien-Stand:35dreimal,40zweimal und46einmalmitzwei normalen Such-/Vollbildzyklen bestanden; kein Ersatz für den roten gemeinsamen Lauf.116 Root-Testdateien stabil,44/44 Ressourcen je Release/gebautem und installiertem Simulator,49Syntaxprüfungen grün, bestehende manuelle Signierung streng bestätigt. **71 nicht installiert/gestartet:** autorisierter DeployExit70 vor Installation, SrTan unavailable/physisches Ziel inXcode fehlt. Sichtbarer früher Größenschritt LF-33, frühere Zoomursache LF-56, Bluetoothursache LF-67 und Finger-/Lupe-/Konto-/Livecommunityabnahme offen. Macstumm, Automationpausiert, LF-31/LF-32zurückgestellt. [Aktuelle Belege](docs/qa/motion-polish-2026-10-15/README.md), [Tatsächliche Ergebnisse](docs/qa/motion-polish-2026-10-15/validation.json).

[Gemeinsames Backlog](docs/VERBESSERUNGS_BACKLOG.md) ist verbindlich. Der letzte gemeinsame Lauf ist13/1/0; niemals14grünbehaupten. Alle74 Produkt-/UI-Dateien und116Roottests unverändert, aktueller Release undSimulator enthalten44/44 identischeRessourcen. NeuerCaptionfehlerLF-70 ist bildlichbelegt und ursächlichungeklärt. VollständigeMotion-/Finger-/Lupe-/Bluetooth-/Kontoabnahmeoffen. ManuellesProfilendet15.10.23:35:45Berlin; keineErneuerung/automatischeProvisionierung. QA-GitignoredRohdatenbeimTransfermitnehmen; keineProduktquellenrücksetzen, paralleleSafariLF-71erhalten.

## Historischer Neustartcheckpoint15.10.2026,17:55Uhr

Nutzer muss Mac neu starten. **Auftrag unterbrochen, nicht abgeschlossen;71 nicht auf SrTan installiert.** Laufende Tests/Recorder sauber beendet; eigene Simulatorinstanz heruntergefahren, Daten erhalten, Runnerlock frei; andere Simulatorzustände unverändert. Root2037bestanden/0Fehler/3bestehendeFFmpeg-Skips; Release71 mit bestehender manueller Signierung gebaut. Nach Rootlauf nur frischerFailureDump im UI-Harness, Produktunverändert.

AutoplayOwner-/Deadline-/Capabilityfix umgesetzt; tatsächliche45 und positiver12X-41 bestanden. Bisherige19-s- und55-s-Quelle liefern im Simulator keineAutoplayfähigkeit; natürlicheEnde-/Aus-/Replayfälle38/39 undgemeinsame abschließende14er-Serie noch offen. **Vor Installation weiterprüfen**, keinenalten13/13PassalsaktuellenAbschluss ausgeben.

SrTan zuletztverbunden. Vor spätererInstallation Erreichbarkeit undvorhandeneSignierung erneutprüfen; Profilfrist15.10.2026,23:35:45Berlin, keineautomatischeProvisionierung/Erneuerung. PersönlicheFinger-/Lupe-/Bluetooth-/Kontoabnahme undLF-67-Ursacheoffen; LF-31/LF-32zurückgestellt. AutomationameinmaligenStartpausiert.

VerbindlicherStatus im [gemeinsamenBacklog](docs/VERBESSERUNGS_BACKLOG.md). [CheckpointundnächsteSchritte](docs/qa/motion-polish-2026-10-15/restart-checkpoint/checkpoint.json), [aktuellerPrüfbericht](docs/qa/motion-polish-2026-10-15/README.md). QA-Rohdaten/GitignorierteAufnahmen beimTransfermitnehmen.




## Erhaltene frühere Vorphase – 15. Oktober 2026, Motion-Nachlauf Build71

Build 1.0/71 enthält korrigierte Mini-Tasten/Crop-Regrab, freigestellten Watchheader, kontinuierliches Kommentarblatt samt Hydration, unterbrechbare Einstellungsmenüs und kollisionsfreie Untertitel/Gestenhinweise einschließlich Fade. **Root 2015/0/3 bestehende FFmpeg-Skips; gemeinsame 13-Fall-Serie 13/0/0 und mandatory 44 dreimal grün**, keine Runtimewarnungen. 74 Produkt-/UI-Dateien und 114 Tests final stabil; 44/44 Ressourcen je signiertem Release/gebautem und installiertem Simulatorbundle bytegleich. **Build 71 noch nicht installiert:** SrTan auch nach den lokalen Prüfungen nicht erreichbar. Bestehende manuelle Signierung und Profil unverändert gültig; letzter bestätigter Gerätebuild 67.

Verbindlicher Status und nächster Schritt im [gemeinsamen Backlog](docs/VERBESSERUNGS_BACKLOG.md), [aktueller Prüfbericht](docs/qa/motion-polish-2026-10-15/README.md) und [Gesamtnachweis](docs/qa/motion-polish-2026-10-15/validation.json). Einmalige Automation am Beginn pausiert. Tatsächliche Aufnahmen von kontrollierten WK-/UIKit-Geometrieprüfungen getrennt; keine absolute Fehlerfreiheit oder FPS behauptet. Persönliche Finger-/Lupe-/Motion-/Konto-/Bluetoothabnahme und LF-67-Ursache offen. LF-31/LF-32 zurückgestellt. Bestehende manuelle Signierung unverändert, Profilfrist 15.10.2026 23:35:45 Berlin. QA ist Git-ignoriert und bei Übergabe mitzunehmen; kein Commit, Push, PR oder Safari-Deployment dieses Nachlaufs.

## Vorheriger Arbeitsstand – 15. Oktober 2026, geprüfter Build70

**Build1.0/70 umgesetzt, gründlich nachgeprüft, mit bestehender manueller Signierung gebaut; noch nicht installiert: SrTan nicht erreichbar; letzter bestätigter Gerätebuild67.** Nachprüfung korrigiert verspätete Doppeltipps, Settings-Hydration/-Eingabe, Autoqualität, verzögerte Original-Autoplaycontrols sowie native Suchfokus-, Filterkontakt- und kanonisierten Ungesehenzustand. Finale Rootregression **1.884 bestanden /0 Fehler /3 bestehende FFmpeg-Skips**; **eine gemeinsame tatsächliche Elf-Fall-Serie11/0/0**, 0 Runtimewarnungen. Finaler Runner41 zusätzlich dreimal grün,47Syntaxprüfungen und18 echte WebKit-DOM-/CSS-/Hit-Tests grün. Alle75 Produkt-/UI-Dateien und111 Root-Tests vor/nach stabil,44/44 JS-Ressourcen im signierten Release und gebautem/installiertem Simulatorbundle bytegleich. Alte roten, abgebrochenen und nur transient grünen Suchbefunde erhalten.

Zentraler Status und nächster Schritt ausschließlich im [gemeinsamen Backlog](docs/VERBESSERUNGS_BACKLOG.md). [Aktueller Prüfbericht](docs/qa/native-ux-2026-10-14/review/README.md), [Gesamtnachweis](docs/qa/native-ux-2026-10-14/review/validation.json). Persönliche Finger-/Lupe-/Motion-, angemeldete Cache-/Livecommunity- und Bluetoothabnahme offen, LF-67-Ursache weiterhin unbelegt. Keine automatische Provisionierung oder neue/erneuerte Signierung. Profilfrist15.10.2026 23:35:45Berlin unverändert. LF-31/LF-32 bleiben zurückgestellt. Eigene Simulatorinstanz nach Abschluss heruntergefahren, Daten erhalten; ursprüngliche Simulatoren und bestehende Arbeitskopie/QA-Historie erhalten. `docs/qa/` ist Git-ignoriert und muss bei Übergabe ausdrücklich mitgenommen werden. Kein Commit/Push/PR und keine Safari-Installation für diese Nachprüfung.

## Vorheriger Arbeitsstand – 14. Oktober 2026, 6,1-Zoll-Update69

**Build 1.0/69 umgesetzt, geprüft und mit bestehender manueller Signierung gebaut; noch nicht installiert.** Alle acht Punkte des 6,1-Zoll-Auftrags enthalten. Root: 1.817 bestanden / 0 Fehler / 3 bestehende FFmpeg-Skips. Acht unterschiedliche letzte Simulatorfallnachweise 11/33–39 grün, keine gemeinsame Achter-Passserie. Natürliches Autoplay an/aus/nach Replay bis zum fortschreitenden Hauptvideo sowie persönlicher Tab bereits vor erster Auswahl aus Cache belegt. Pointermove-Holdabbruch und MSE-Werbeendseek korrigiert. 44/44 Ressourcen bytegleich, 75 Produkt-/UI-Dateien und 111 Tests stabil. SrTan gepaart, Verbindung/DDI nicht verfügbar; letzter bestätigter Gerätebuild 67. Installation und persönliche Finger-/Lupe-/angemeldete Cache-/Bluetoothabnahme offen. Bestehende Signierung erhalten; Profilfrist 15.10.2026, 23:35:45 Uhr Berlin. Eigene neue Simulatorinstanz heruntergefahren, Daten erhalten, Runnerlock frei. Zentraler Status und nächster Schritt ausschließlich im [gemeinsamen Backlog](docs/VERBESSERUNGS_BACKLOG.md); [QA-Bericht](docs/qa/native-ux-2026-10-14/README.md), [Gesamtnachweis](docs/qa/native-ux-2026-10-14/validation.json). LF-67 Bluetoothursache offen; LF-31/LF-32 zurückgestellt.

## Vorheriger Quellstand – 14. Oktober 2026, Release 68 vorbereitet

Seit dem installierten67 sind Doppeltipps auf freie Videoseiten (links−10s/rechts+10s) und Schutz vor YouTubes konkurrierendem Hold umgesetzt. Root1.667 bestanden/0Fehler/3bestehende FFmpeg-Skips; finale echte iOS27-Simulatorserie33×2 und07×2 viermal grün, Quellen68Dateien/Testdateien103 unverändert,39/39 Ressourcen bytegleich. Nach dem ersten grünen Stand Buildnummer67→68 erhöht und eine nicht mehr unterstützte optionale Diagnoseabfrage entfernt; finale Prüfungen direkt auf68, Quellen unverändert. Release1.0/68 mit derselben bestehenden Identität/Profil gebaut und streng geprüft. **Noch nicht installiert:** SrTan gepaart, Tunnel/DDI nicht erreichbar; Verbindung/Entsperren beim Nutzer angefragt. Letzter bestätigter Gerätebuild bleibt67. [Prüfbericht](docs/qa/audio-doubletap-2026-10-14/README.md), [Gerätekandidat](docs/qa/audio-doubletap-2026-10-14/device-build68/signed-bundle-verification.json).

Der neue Nutzerbefund betrifft Kopfhörer/Bluetooth bei weiterlaufendem Bild in normaler Ansicht und Vollbild. **Audioverlustursache und persönliche Finger-/Bluetoothabnahme bleiben offen.** REA wurde gezielt ausgeführt, konkurrierende Originalgesten statisch belegt, keine Audioausfallkausalität bewiesen. Neue begrenzte Route-/Unterbrechungsprobe ist ausschließlich opt-in und verändert Audio nicht;39 finale Simulatorzeilen sind kein gehörter/physischer Bluetoothton; Unterbrechungsgrund ohne unterstützten Kontext bleibt unbekannt. Zentraler tatsächlicher Status, nächste Schritte und historische Fehlversuche unter [LF-66/LF-67 im einzigen Backlog](docs/VERBESSERUNGS_BACKLOG.md). QA-Dateien beim Macwechsel ausdrücklich mitnehmen. Simulator wieder heruntergefahren, Daten erhalten; manuelle Signierung unverändert, Profilfrist15.10.2026 23:35:45Berlin bleibt bestehen.

## Aktueller Gerätebuild – 14. Oktober 2026, Build 67 installiert

Auf weiteren Nutzerauftrag ist **1.0 (67)** mit dem früheren Auswahlschutz gegen die gemeldete Lupe beim2×-Hold auf SrTan installiert (Sequenz4032), Geräteinventar bestätigt. Getestete Produktquellen unverändert, ausschließlich Buildnummer66→67;39/39 Release-Ressourcen entsprechen den Testhashes. Bestehende manuelle Signierung und Profil erhalten. **Normaler Appstart wegen gesperrtem iPhone (`Locked`) abgewiesen; persönliche Lupenabnahme offen.** Zentraler aktueller Stand unter [LF-52 im Backlog](docs/VERBESSERUNGS_BACKLOG.md); [Installation/Prüfung](docs/qa/hold-selection-2026-10-14/device-build67/validation.json).

## Historischer Abschluss vor dem Lupenfix – 14. Oktober 2026, Build 66 installiert

**Installation am 14.10.2026, 16:55 Uhr Europe/Berlin erfolgreich:** Nutzer hat den Signierungsordner unter `/Users/tan/Downloads/Langform-Signierung-2026-10-14/` bereitgestellt. Die vorhandene passwortgeschützte `.p12` wurde über die Schlüsselbundverwaltung in den Anmeldeschlüsselbund importiert; kein Passwort oder privater Schlüssel in Projekt/QA übernommen. Vorprüfung mit dem mitgebrachten Profil erfolgreich, anschließend `scripts/deploy-iphone.sh` Exit0: Release66 gebaut, lokal signiert, streng geprüft, auf ausschließlich SrTan installiert (Sequenz4024) und normal ohne Diagnoseflags gestartet. Gezielte Geräteinventur bestätigt **Langform1.0/66**. Testquellen unverändert,39/39 JS-Ressourcen bytegleich. Die zuvor fehlende Signierung ist damit übernommen; der frühere blockierte Versuch bleibt als [Historie](docs/qa/device-install-build66-2026-10-14/validation-blocked-before-transfer.json) erhalten. [Aktueller Nachweis](docs/qa/device-install-build66-2026-10-14/validation.json).

**Projekt und bestätigter Gerätebuild: 1.0 (66).** Kapitel- und Gestenkorrekturen sowie der normale Hintergrundpfad sind gespeichert, automatisch geprüft und auf SrTan installiert. Simulatorbuild und manuell signierter iPhone-Release enthalten jeweils **39/39 bytegleiche JavaScript-Ressourcen**. Persönliche Finger-/Ton-/Sensorabnahme bleibt offen. Verbindlicher Status: [gemeinsames Backlog](docs/VERBESSERUNGS_BACKLOG.md).

Lange Kapitel in der normalen Videoansicht reservieren den tatsächlich daneben liegenden AirPlay-Picker, auch wenn er später sichtbar wird; ungetrennte Blattnamen umbrechen. Eigene Kapitel beeinflussen die native Zeilenankererkennung nicht mehr. Konsumierte Zoom-/Swipekontakte bleiben bis zum Release nachvollziehbar; Hochformat-Exit darf bei aktuellem Seek zurückführen, Eintritt bleibt während Seeking geschützt. Verlassene Kontakte und Scrubvorschau werden bei echter Inaktivität entfernt. Eigene Lifecyclemodule lesen weiterhin die echte Sichtbarkeit und starten beim Vordergrund keine Wiedergabe.

Hintergrundteil von LF-31 erneut vom Nutzer autorisiert: Home-Geste/Appwechsel und Sperren, laufend bleibt laufend, bewusst pausiert bleibt pausiert. `WatchBackgroundAudio.js` erhält genau den aktuellen Root-/Video-/Quellbesitz. Eine öffentliche `.playback`-Kategorie ohne `setActive` und höchstens eine Original-Playfortsetzung gelten nur für vorher laufendes ungemutetes Medium im echten Hintergrund; Pause, Unterbrechung, Quelle/Route/Ad/Offline und alte Zyklen bleiben geschützt. Kein Retry, Seek, Rate/Mute, Vordergrund-Play oder blindes Unsuspend. Dynamic-Island-Feature/automatischer Anschluss und Downloads bleiben zurückgestellt.

**Finale Prüfung:** Root **1.525 bestanden / 0 Fehler / 3 übersprungen**, Web **87/87**. Die drei Rootskips sind bestehende FFmpeg-abhängige AVFoundation-/Store-Fixtures. **11 finale tatsächliche Simulatorfälle bestanden / 0 Fehler / 0 Skips / 0 Runtimewarnungen:** Gesten-/Endefälle13–18 sowie normale Homefälle32/29/30/29/30. Quellen-/UI-Fingerprint über78 Dateien stabil;100 Root-Testdateien separat vor/nach Rootlauf bytegleich. Kapitel67/67 lokal und61/61 tatsächliche isolierte WebKitfälle grün. [Gesamtnachweis](docs/qa/chapters-fluidity-2026-10-14/validation.json), [lesbarer Bericht](docs/qa/chapters-fluidity-2026-10-14/README.md), [Releasebundle](docs/qa/chapters-fluidity-2026-10-14/bundle-device-unsigned-final.json), [Home-Hauptmedienbelege](docs/qa/background-audio-2026-10-14/normal-actual-validation.json).

**Offen:** Ein früher einzelner normaler Homeversuch verlor seine Quelle. Gated/gewöhnliche/sofortige Wiederholungen und die finalen fünf normalen Fälle bestanden; der ursprüngliche Widerrufsgrund wurde erst danach instrumentiert und nicht erneut reproduziert. Logging wird nicht als funktionaler Fix behauptet. Dieser Einzelfehler bleibt im Backlog offen. Stille mit kodierter Audiospur hält weitere Simulatorprüfungen leise; logischer Unmute-/Zeitstatus ist kein gehörtes Audio. Home ist kein physischer Lock. Hintergrund-/Sperrton, echte Systemmedien und Finger-/Sensorabnahme bleiben eigenständig am iPhone offen.

Die feste bestehende Signierungsidentität `E94E8C9CC2FF184832B68E4C02A332867D66F560` samt privatem Schlüssel ist jetzt lokal nutzbar. Das unveränderte Profil `8c01d0de-5bba-4c1a-8eae-c9e2e9ceb2b5` wurde über `LANGFORM_SIGNING_PROFILES_DIRECTORY` aus dem Transferordner verwendet und ist bis **15.10.2026, 23:35:45 Uhr Europe/Berlin** gültig. Der Import verlängert diese Frist nicht; danach ist die Profilversorgung gezielt zu klären. Manuelle Projekteinstellungen erhalten, keine neue/erneuerte/widerrufene Identität, Ersatzsignierung oder automatische Provisionierung. Kein erneuter Simulatorlauf für die reine Installation nötig: getesteter78-Dateien-Fingerprint unverändert. Eigene Simulator-App beendet, ursprünglich heruntergefahrener Simulator wieder heruntergefahren, Daten erhalten, Runnerlock frei. Keine Safari-Installation, kein Commit/Push; parallele vorhandene Änderungen erhalten.

Nachweise unter `docs/qa/` sind von Git ausgeschlossen und müssen bei einer erneuten Übergabe ausdrücklich mitgenommen werden. Aktuelle sechs Hintergrundquellenhashes: [Freeze](docs/qa/background-audio-2026-10-14/lease-reason-source-freeze.json); vollständiger aktueller Ressourcenabgleich im Releasebundle oben. Die folgenden Abschnitte sind **datierte Historie vor diesem Abschluss**.

## Fortsetzung auf dem Ziel-Mac – 14. Oktober 2026

Auf Nutzerauftrag hier weitergearbeitet. Tatsächlicher Projektpfad: `/Users/tan/Desktop/Langform`, Branch `main`, Ausgangscommit weiterhin `6223839df850ae828325d6acfab120a6f698509c`. Die vollständige Arbeitskopie samt neuen Dateien und QA-Historie ist angekommen; alle acht unten dokumentierten Übergabehashes waren beim Einstieg identisch. Verbindlicher Status und offene Abnahmen bleiben im [gemeinsamen Backlog](docs/VERBESSERUNGS_BACKLOG.md).

**Projekt und neuer Kandidat sind jetzt 1.0 (64).** Simulatorbuild und unsignierter Release für iPhone erfolgreich gebaut. Der endgültige Release enthält 38/38 bytegleiche JS-Ressourcen. SrTan wurde beim Einstieg als 1.0 (63) bestätigt; keine neue physische Installation. Die anschließende Geräte-Inventarabfrage lief in ein Timeout, daher keinen neueren Gerätestand ableiten.

Die Fortsetzung hat einen weiteren echten LF-57/LF-61-Fehler gefunden und korrigiert: Nach dem pausierten Ende-Seek blieb YouTubes alter Next-Countdown aktiv und wechselte später die Quelle. `PlayerRect.js` stellt für diesen bewussten Seek den bereits verifizierten, eng gebundenen Original-Cancel bereit. `PlaybackSwipe.js` ruft ihn vor dem Seek auf und prüft anschließend die aktuelle Bindung erneut. Kein eigener Playaufruf und keine Änderung des globalen Autoplayschalters. Neuer Quellenhash für `PlaybackSwipe.js`: `94c69842ca9f6ca682ef1367867320e3e53ab9fc282878a5a5827e4b7bbc9824`; für `PlayerRect.js`: `46900821d069ac406c297628ddf45a6d1281639029428b2fb9cf455d2344c279`. Die übrigen sechs Playerdateien aus dem Übergabehashblock sind unverändert.

**Prüfung:** 463 gezielte Regressionen bestanden. Vollständiger Rootlauf **1.297 bestanden / 0 Fehler / 3 übersprungen**; die drei bestehenden AVFoundation-/Store-Fixtures benötigen hier fehlendes FFmpeg. **Alle fünf tatsächlichen finalen Simulatorfälle 13–17 bestanden, 0 Fehler/Skips/Runtimewarnungen.** Fall 15 auf eigener frischer Instanz hat Cookie-Ablehnung und den anschließenden Relaunch mit normaler Watchprobe tatsächlich ausgeführt. Quellen-/Testfingerprint über 75 Dateien vor/nach identisch; beide Simulatorbundles 38/38 bytegleich. XCTest-Harness an frische Cookiezustände und die ausgeloggte Home-/Mein-YouTube-Oberfläche angepasst; alte Catalystvergleichsfixture berücksichtigt ihren tatsächlich gelieferten CSS-env-Ausgangswert, alle produktiven 62px/y110-Assertions erhalten. Historische rote Nachweise bleiben erhalten. Eigene Apps beendet, ursprünglicher Simulator wieder heruntergefahren, ausschließlich die neu angelegte temporäre Cookieinstanz entfernt; bestehende Daten/Laufzeit erhalten und Runnerlock frei. [Gesamtnachweis](docs/qa/mac-continuation-2026-10-14/validation.json). [Root](docs/qa/mac-continuation-2026-10-14/root-final-result.json), [Ende-Countdown Rot/Grün](docs/qa/mac-continuation-2026-10-14/ended-autonav-validation.json), [Releasebundle](docs/qa/mac-continuation-2026-10-14/bundle-device-unsigned-final.json).

**Konkrete Installationsgrenze:** `bash scripts/deploy-iphone.sh --check-signing` scheitert, weil die festgelegte Identität `E94E8C9CC2FF184832B68E4C02A332867D66F560` samt privatem Schlüssel lokal fehlt. Das einzige lokale Profil `24d39e34-49b8-4fb6-945f-a36ce28f7064` enthält dieses Zertifikat nicht. Keine passenden `.p12`-/`.pfx`-/`.developerprofile`-Exporte in den begrenzt geprüften üblichen Exportordnern; Nutzer kennt keinen Export. Die vorhandene manuelle Signierung, feste Identität und Profilwahl wurden erhalten. Keine automatische Provisionierung, Erneuerung oder Ersatzidentität.

Zur Installation die **bestehende** Signierung vom alten Mac exportieren und hier importieren: Zertifikat einschließlich privatem Schlüssel als `.p12` sowie passendes `.mobileprovision`, alternativ vorhandenes `.developerprofile` mit den Signierungsmitteln. [Apple: Signierung auf anderen Mac übertragen](https://help.apple.com/xcode/mac/current/en.lproj/dev8a2822e0b.html), [Apple: Zertifikat exportieren](https://help.apple.com/xcode/mac/current/en.lproj/dev154b28f09.html). Danach erst `bash scripts/deploy-iphone.sh --check-signing` erfolgreich prüfen und den normalen manuellen Deploymentweg verwenden. Zertifikat-/Profilgültigkeit dabei neu prüfen. Der vorbereitete unsignierte Release ist kein installierbares signiertes Paket. Physische Gesten-/Ton-/Sensorabnahmen bleiben im Backlog offen.

Keine Safari-Installation, kein Commit/Push. LF-31 Dynamic Island und LF-32 Downloads bleiben zurückgestellt; automatischer Anschluss bleibt pausiert. Die folgenden Abschnitte dokumentieren den Stand **vor** dieser Fortsetzung und bleiben als Historie erhalten.

## Übergabestand vor dem Macwechsel – 14. Oktober 2026

Stand 14. Oktober 2026. Die angefragten Playerkorrekturen sind umgesetzt und lokal sowie im Simulator geprüft. **Projektversion und Simulator-Arbeitsbuild sind weiterhin 1.0 (63). Die neuen Fixes sind noch nicht auf dem physischen iPhone installiert.** Der nächste Agent soll von den gespeicherten Quellen weiterarbeiten und die persönliche Geräteprüfung vorbereiten.

[AGENTS.md](AGENTS.md) und [docs/VERBESSERUNGS_BACKLOG.md](docs/VERBESSERUNGS_BACKLOG.md) gelten für die Fortsetzung. Das Backlog bleibt die einzige Aufgaben- und Statusliste. Diese Übergabe erklärt den Arbeitsstand und den Wechsel auf den anderen Mac.

### Build und Arbeitskopie

Der zuletzt dokumentierte Gerätebuild auf SrTan ist ebenfalls 1.0 (63), installiert am 12.10.2026. Dieser Gerätebuild enthält die nachfolgenden neuen Korrekturen noch nicht. Die Buildnummer wurde während der Reparatur nicht erhöht; der neue Stand wurde ausschließlich als Simulatorbuild ohne Signierung geprüft. Ein neuer Release-/Gerätebuild mit diesen Änderungen steht aus. Vor dem nächsten Gerätebuild die dann nächste freie Buildnummer wählen; auf dieser Arbeitskopie wäre 64 der nächste Kandidat.

Die Änderungen sind **nicht eingecheckt oder gepusht**. Branch: `main`. Ausgangscommit: `6223839df850ae828325d6acfab120a6f698509c`.

Auf dem Ziel-Mac muss die vollständige aktuelle Arbeitskopie ankommen, einschließlich geänderter und neuer Dateien. Ein frischer GitHub-Klon enthält diese Reparaturen nicht automatisch. Die neuen Dateien `ios/Langform/Langform/WatchAudio.js` und `PlayerRotationIntentPolicy.swift` sowie die neuen Tests gehören dazu. `docs/qa/player-start-2026-10-14/` ist von Git ausgeschlossen: Für die vollständigen lokalen Prüfnachweise diesen Ordner ausdrücklich mitnehmen. Ein bloßer Git-Push würde die QA-Rohdaten nicht übertragen. Die tatsächliche Synchronisierung auf den anderen Mac wurde hier nicht geprüft.

Der bisherige Projektpfad auf diesem Mac ist `/Users/tanipekkaya/Desktop/Langform`. Auf dem Ziel-Mac den tatsächlich vorhandenen Pfad verwenden. Buildprodukte, `node_modules` und DerivedData können dort neu aufgebaut werden; bestehende Signierungsdateien und Schlüsselbundzugänge werden durch eine Ordnerkopie nicht eingerichtet.

### Signierung für den anderen Mac

Aktualisierung vom 14.10.2026: `bash scripts/deploy-iphone.sh --check-signing` auf dem alten Mac erneut erfolgreich. Vorhandene nutzbare Identität `E94E8C9CC2FF184832B68E4C02A332867D66F560`, Team `RFN59MUTQ3`; ausgewähltes vorhandenes Profil `8c01d0de-5bba-4c1a-8eae-c9e2e9ceb2b5` ist bis **15.10.2026, 23:35:45 Uhr Europe/Berlin** gültig. Ein Transfer verlängert diese Frist nicht.

In der installierten Xcode-27-Oberfläche wurde kein Exportmenü für `.developerprofile` gefunden. Apples aktueller dokumentierter Weg über Konto → Team → Manage Certificates → Export Certificate bietet die Signing Identity als passwortgeschützte `.p12`; das passende `.mobileprovision` wird separat mitgegeben. [Apple-Anleitung](https://developer.apple.com/documentation/Xcode/sharing-your-teams-signing-certificates). Dateiendungen nicht umbenennen.

Vorbereitet auf dem alten Mac: `/Users/tanipekkaya/Downloads/Langform-Signierung-2026-10-14/`. Der Ordner enthält bereits das unveränderte gültige `.mobileprovision` und `IMPORT_AUF_DEM_ANDEREN_MAC.txt`. Xcodes Export wurde in demselben Ordner als `Langform-Signierung-2026-10-14.p12` gespeichert. **Export inzwischen gespeichert und lokal vorhanden: `Langform-Signierung-2026-10-14.p12` (3.314 Bytes), Passwort vom Nutzer selbst gesetzt. Nutzer meldet die AirDrop-Übertragung selbst als erledigt („habs gemacht“); der AirDrop-Dialog auf dem alten Mac ist anschließend geschlossen. Empfang, Import und erfolgreicher Signierungscheck auf dem Ziel-Mac sind hier noch nicht unabhängig bestätigt.** Die Signierung wurde weder neu erzeugt noch erneuert oder widerrufen. Äußerer PKCS#12-Container read-only geprüft: PFX-Version3, gültige DER-Gesamtlänge und MacData vorhanden; ohne Passwort/Entschlüsselung. Der endgültige Nachweis der enthaltenen nutzbaren Identität erfolgt nach Import durch `--check-signing` auf dem Ziel-Mac.

Nach dem vollständigen Transfer die `.p12` auf dem Ziel-Mac per Doppelklick in den Anmeldeschlüsselbund importieren. Danach im aktuellen Projekt prüfen, bei abweichendem Speicherort den Profilordner anpassen:

```bash
LANGFORM_SIGNING_PROFILES_DIRECTORY="$HOME/Downloads/Langform-Signierung-2026-10-14" bash scripts/deploy-iphone.sh --check-signing
```

Erst bei erfolgreichem Check weiterbauen; `--build-only` erzeugt noch keine Geräteinstallation. Der Transferordner mit privaten Signierungsmitteln bleibt außerhalb des Projekt-/Gitordners. Das Exportpasswort gehört ausschließlich in den Systemdialog.

### Umgesetzte Playerkorrekturen

- **Ton beim Öffnen, LF-62:** `WatchAudio.js` und eine an den neuen Watchauftrag gebundene native Audioabsicht in `YouTubeWebView.swift` entstummen genau das aktuelle Hauptvideo einmalig. Eine später bewusst gewählte Stummschaltung bleibt bei Pause, Wiedergabefortsetzung, Replay und Vollbild erhalten. Die Hilfsfunktion startet keine eigene Wiedergabe und entstummt nicht fortlaufend.
- **Blockierter Startbereich, LF-29:** `PlayerRect.js` berücksichtigt den sichtbaren ungeladenen YouTube-Poster, auch wenn das eigentliche Video noch außerhalb der sichtbaren Fläche liegt. Der native Startkontakt kann dadurch greifen; ein gebundener Mediafallback ergänzt eine wirkungslose ausdrückliche Player-Startanforderung. Kein vorgetäuschtes erstes Videobild.
- **Videoende und Vollbild, LF-61/LF-33:** `FullscreenMotion.js` begrenzt eigene Enter-/Exittransaktionen auf vier Sekunden und nimmt ausschließlich die eigenen markierten Sperren/Stile zurück. Ursprüngliche 4:3-Inlinepose und erneute volle Eintrittspose werden getrennt wiederhergestellt. Beim ausdrücklichen Replay bricht `PlayerRect.js` einen vorhandenen Next-Countdown über den live belegten Original-Cancel im selben Endscreen ab.
- **Ganze freie Wischfläche, LF-57:** `PlaybackSwipe.js` verwendet die aktuelle sichtbare Rootfläche; `PlayerRect.js` meldet sie getrennt als `seekRect`, `YouTubeWebView.swift` priorisiert damit native Randkontakte. Freie Leisten und 4:3-Seitenflächen gehören dazu. Buttons, Zeitleiste, Werbung, Zoom/Pan, Mini und aktive Übergänge behalten ihre Zuständigkeit; die eigentliche Mediendarstellung bleibt getrennt.
- **Pause nach Zurückwischen am Videoende, LF-57:** Der echte Ereignisring zeigte `seeked` bei 4,013 Sekunden in Pause und fünf Millisekunden später YouTubes eigenes `play`. Ein erfolgreich beobachteter Ende-Seek erhält seinen Pauseintent höchstens 1,5 Sekunden; `seeked`/`play` korrigieren einmalig und nur bei identischem Hauptmedium, Quelle, Root, Zielzeit und Geometrie. Der Timer räumt nur auf. Frische Eingaben, Controls, Tasten und der Native-Playaufruf widerrufen den alten Intent. Zusätzlich zwei eng begrenzte Nachklicklücken geschlossen; diese sind nicht als Ursache des beobachteten Autoresume behauptet.
- **Drehen, LF-63:** `PlayerRotationIntentPolicy.swift`, UIDevice-Beobachtung in `YouTubeWebView.swift` und geschützte Schnittstellen in `FullscreenMotion.js` öffnen bei Querhaltung eigenes Vollbild und führen bei Hochhaltung zurück. Ein manueller Exit im Querformat bleibt bis zu einer neuen Hoch→Querbewegung erhalten.

`PlaybackHoldDiagnostics.js` enthält ausschließlich ausdrücklich aktivierte Beobachtungsproben für Geometrie, echte Medienzustände und einen begrenzten Ereignisring. Die Diagnoseanzeige ist auf 1 px geclippt, damit sie die Vollbildbedienung nicht verdeckt.

### Bestandene Prüfungen

**1.294/1.294 lokale Rootprüfungen bestanden, 0 Fehler/Skips.** Ausgeführt: `node --test --test-concurrency=2 tests/*.test.js`. Dazu gehören JavaScriptverhalten, tatsächliche Swift-/UIKit-Typechecks und native Policy-/Callbackfixtures. Dies ist kein neuer vollständiger Web-App-Testlauf.

**Fünf tatsächliche Simulatorfälle bestanden, 0 Fehler/Skips/Runtimewarnungen:** iPhone 18 Pro, iOS 27.0 (24A434), ausschließlich `CODE_SIGNING_ALLOWED=NO`, exklusive Bedienung.

- Fall 13: ±15 Sekunden in Pause/Wiedergabe, Inline/Vollbild, nach echtem Pinch/Reset und nach Mini-Rückkehr.
- Fall 14: natürliches Ende in beiden Ansichten, Replay/Pause, Mini/Expand, wiederholtes Vollbild und erreichbarer Feed.
- Fall 15: normaler ausdrücklicher Watchstart mit fortschreitendem, ungemutetem Hauptmedium; Pause/Resume/Vollbild erhalten Tonzustand.
- Fall 16: Querlinks, manueller Exit, Hoch, Querrechts und Hoch-Rückkehr.
- Fall 17: beide freien 4:3-Seitenflächen; nach natürlichem Ende auf 4,013 Sekunden zurückspulen und elf Sekunden unverändert pausiert bleiben.

**38/38 gebündelte JS-Ressourcen bytegleich.** Acht festgehaltene Playerquellen sind gegenüber dem Quellenreview unverändert. Eigene Simulator-App nach Abschluss beendet; Runnerlock freigegeben. Die damalige Simulator-UUID `F789C6F7-3D3B-487C-B5E6-13082418E583` gehört zu diesem Mac und darf auf dem Ziel-Mac nicht als vorhanden vorausgesetzt werden.

[Lesbarer Gesamtnachweis](docs/qa/player-start-2026-10-14/README.md), [Prüfergebnisse](docs/qa/player-start-2026-10-14/validation.json), [Bundleabgleich](docs/qa/player-start-2026-10-14/bundle-final-verification.json), [Ende-Seek Rot/Grün](docs/qa/player-start-2026-10-14/ended-seek-pause/validation.json). Historische rote Läufe bleiben erhalten. Der erste finale Rootlauf hatte eine veraltete exakte Packetfixture ohne `seekRect:null`; nach Anpassung 1.294/1.294 grün. Der erste lange Fall 13 verlor beim Ablesen eine verschwindende AX-Statusmeldung; nur die Uhrabfrage im Test wurde präzisiert, Produkt und Zeit-/Playback-/Geometriekriterien blieben unverändert.

### Fortsetzung auf dem Ziel Mac

1. Den vollständigen Arbeitsordner und die neuen Dateien prüfen; die untenstehenden Quellhashes mit dem Zielstand vergleichen. Fremde oder parallel vorhandene Änderungen erhalten. Vor neuer Featurearbeit den jeweiligen aktuellen Backlogeintrag lesen.
2. Xcode, Node und Abhängigkeiten lokal prüfen. Auf diesem Mac liefen Xcode 27.0 (27A266a), Node 22.16.0 und npm 10.9.2. Bei fehlenden Rootabhängigkeiten `npm ci`; anschließend die passende lokale Regression ausführen. Für Simulatorarbeit mindestens 5 GB frei halten und keine parallele Bedienung derselben Instanz zulassen.
3. Nach weiteren iPhone-Codeänderungen `scripts/test-simulator.sh` auf der verfügbaren iOS-27-Instanz des Ziel-Macs ausführen. Die fünf relevanten Testmethoden stehen unten; der Runner unterstützt `--only-testing`, `--device`, `--output` und `--iterations`.
4. Für einen neuen Gerätebuild zuerst die dort vorhandene manuelle Signierung mit `bash scripts/deploy-iphone.sh --check-signing` prüfen. `--build-only` baut/signiert ohne Geräteinstallation. Signierung/Profil erhalten: keine automatische Provisionierung, Zertifikatserneuerung, `CODE_SIGN_STYLE=Automatic` oder `-allowProvisioningUpdates`. Die historischen Zertifikat-/Profilangaben weiter unten vor Nutzung lokal neu prüfen. Fehlende Mittel auf dem anderen Mac sind kein Anlass für automatischen Ersatz.
5. Der nächste Produktprüfumfang ist die persönliche iPhonebedienung auf einem neuen Gerätestand: tatsächlicher Feed-Fingertap, hörbarer Ton und späteres Mute, Ende/Replay/Zurückspulen in beiden Ansichten, freie ±15-s-Fläche und echtes Drehen. Neuer Gerätebuild, Installation und persönliche Abnahme jeweils getrennt im zentralen Backlog dokumentieren.

Die bestehenden Diagnoseproben belegen normale Watchroute und anschließende UI-Eingaben, keinen Feed-Fingertap oder gehörten Lautsprecherton. Simulatorausrichtung ersetzt keine physische Sensor-/Orientierungssperren- und Fingerprüfung. Hintergrundton, Sperrbildschirm und Systemmedien bleiben eigenständig offen. **LF-31 Dynamic Island und LF-32 Downloads bleiben zurückgestellt; deren automatischer Anschluss bleibt pausiert.**

### Quellhashes zum Abgleich

Auf macOS lässt sich eine Datei mit `shasum -a 256 PFAD` prüfen. Diese Hashes bezeichnen den erfolgreich geprüften Playerstand vom 14.10.2026, unabhängig von der weiterhin gleichen Buildnummer.

```text
c9337ed6937880b8ea98cf06bdfe2ec9a1c61422f8d44674de147959d0991811  ios/Langform/Langform/PlaybackSwipe.js
603e66296be71f84cda72e7cbe04b5be962049460f30c70aa913fceab9cdcbd7  ios/Langform/Langform/PlayerRect.js
1d122b7c760a3848b7e6871c56d59b172a1df1296fb672ffb8f7094368323332  ios/Langform/Langform/FullscreenMotion.js
ec90e49a600ff466f72a8a5325cc7e11578a019f69efa9714b85707e26b66432  ios/Langform/Langform/WatchAudio.js
76097520d22c09fe284e6b04dcfe2b24651b5bd57c110ee3b6fcbcdbfd53cbd7  ios/Langform/Langform/YouTubeWebView.swift
68d66b1027364bdc567308cccc8b9cab4022bc82887379e5ab1b5cb1fa969e3d  ios/Langform/Langform/PlayerRotationIntentPolicy.swift
c1eed58db5f6733a41a904ff4c7d56a72bb5f4605e9e4163e5d9f08f91112940  ios/Langform/Langform/VideoLoadProbe.swift
4c1bba185168dc774544bc77272cff86098defc4aa78bd7cb6e4390911079970  ios/Langform/Langform/PlaybackHoldDiagnostics.js
```

Die tatsächlichen UI-Testmethoden für `--only-testing`:

```text
LangformDeviceTests/DeviceAccessibilityTests/test13ActualHorizontalSwipesSeekFifteenSeconds
LangformDeviceTests/DeviceAccessibilityTests/test14NaturalVideoEndKeepsInlineAndFullscreenTouchOperable
LangformDeviceTests/DeviceAccessibilityTests/test15ExplicitWatchStartsUnmutedAndKeepsPlaybackOnResume
LangformDeviceTests/DeviceAccessibilityTests/test16PhysicalRotationOpensFullscreenAndHonorsManualExit
LangformDeviceTests/DeviceAccessibilityTests/test17FourThreeSidebarsAndEndedSurfaceSeekWithoutChangingPlayback
```

### Weitere vorhandene Änderungen

README, Safari-Manifest/Summary und die Safari-Freundpaket-/Transkriptdateien enthalten bereits vor dieser Reparatur vorhandene Änderungen. Sie wurden erhalten und sind kein neuer, separat abgeschlossener Safari-Auftrag dieser Runde. Den vollständigen Arbeitsstand übernehmen und vor Bearbeitung deren eigenen Kontext lesen. Aktueller Status vor dem Speichern dieser Übergabe:

```text
 M README.md
 M docs/VERBESSERUNGS_BACKLOG.md
 M extension/manifest.json
 M extension/src/summary.js
 M ios/DeviceTests/LangformDeviceTests/DeviceAccessibilityTests.swift
 M ios/Langform/Langform/FullscreenMotion.js
 M ios/Langform/Langform/PlaybackHoldDiagnostics.js
 M ios/Langform/Langform/PlaybackSwipe.js
 M ios/Langform/Langform/PlayerRect.js
 M ios/Langform/Langform/VideoLoadProbe.swift
 M ios/Langform/Langform/YouTubeWebView.swift
 M scripts/diagnostics/staged-fullscreen-native-fixture.py
 M tests/app-views.test.js
 M tests/fullscreen-motion.test.js
 M tests/native-close-motion.test.js
 M tests/native-fullscreen.test.js
 M tests/native-initial-play.test.js
 M tests/native-motion-geometry.test.js
 M tests/native-playables-policy.test.js
 M tests/native-player-priority.test.js
 M tests/native-preload.test.js
 M tests/native-stage-controller.test.js
 M tests/native-staged-fullscreen.test.js
 M tests/native-startup-identity.test.js
 M tests/package.test.js
 M tests/playback-audio-session.test.js
 M tests/playback-swipe.test.js
 M tests/player-media-discovery.test.js
 M tests/player-scripts.test.js
 M tests/silent-diagnostics.test.js
 M tests/video-load-probe.test.js
?? ios/Langform/Langform/PlayerRotationIntentPolicy.swift
?? ios/Langform/Langform/WatchAudio.js
?? scripts/build-safari-friend.py
?? scripts/safari-friend/
?? tests/native-rotation-intent.test.js
?? tests/native-watch-audio.test.js
?? tests/transcript.test.js
?? tests/watch-audio.test.js
```

### Speicher und laufende Arbeit

Zusätzliche ausdrücklich freigegebene unbenutzte Caches wurden bereinigt; zuletzt nach Abschluss etwa10,4 GiB frei. [Bereinigungspfad und Ergebnis](docs/qa/player-start-2026-10-14/inactive-cache-cleanup-result.json). Projekte, Daten, Signierung und Simulator sind erhalten. Frühere Cachefreigaben nicht als dauerhafte Löschfreigabe behandeln. Es laufen keine eigenen Playerprüfungen mehr; keine neue physische Installation, kein Commit/Push oder Threadtransfer durch diese Übergabe.

## Historische Übergaben

Die folgenden Abschnitte bleiben als datierte Historie erhalten. Angaben wie „Aktuell“, installierte ältere Builds, Testzahlen, Prozessnummern und Signierung beschreiben ihren damaligen Stand. Für die Fortsetzung gilt der Einstieg vom14.10.2026 oben und das aktuelle zentrale Backlog.

## Historischer Einstieg vom 12. Oktober 2026

Für die GitHub-Entwicklerübergabe gelten der [Einstieg im README](README.md#einstieg-für-entwickler), [AGENTS.md](AGENTS.md) und das [gemeinsame Backlog](docs/VERBESSERUNGS_BACKLOG.md). Der dort dokumentierte aktuelle Gerätebuild ist **1.0 (63)**; persönliche Gesten-/Ton-/Systemmedienabnahme und breite Simulatorwiederholung sind weiterhin offen. Der GitHub-Upload ist keine neue Installation oder Funktionsabnahme.

Die folgenden Build-29-/25-/17-Abschnitte sind **historische Prüfstände**, auch wenn ihre ursprünglichen Überschriften „Aktuell“ enthalten. Lokale QA-Rohdaten, Aufnahmen und Buildprodukte werden nicht öffentlich hochgeladen; viele ältere `docs/qa/`-Links sind daher nur in Tans Arbeitskopie verfügbar. Eigene Apple-Signierung für neue Entwickler ausdrücklich separat konfigurieren; bestehende manuelle Signierung erhalten.

## Aktuell: Build 29 installiert – Tempo und begrenzte Hintergrundarbeit

Stand 9. Oktober 2026: **1.0 (29)** auf SrTan installiert, Sequenz **3284**, App-Inventar bestätigt; abschließend normal gestartet. Neue Vollbild-Tempo-Auswahl 0,75×–2×, weniger Layout-Arbeit bei Feed-Hydration, ruhende fokussierte Karten und keine wiederbelebten Player-Timer nach `pagehide`. Die Motion aus Build 27/28 bleibt erhalten. **559 Tests, 84 Offline-WebKit-Durchläufe, signierter Release und 18 bytegleiche JS-Ressourcen bestanden.** [Build-29-Prüfstand](docs/qa/build29/validation.json).

Die Geräteprobe war nach Entsperren möglich, erhielt aber vor ihrer Frist keinen Playing-Zustand (`unstarted`/Mediendaten vorhanden, dann `video-probe-timeout`). Keine erfolgreiche Steuerungsfolge behaupten; tatsächliche Touch-/FPS-/Haptikabnahme offen. Die normale App läuft wieder ohne Diagnoseflags. Buildweg weiterhin ausschließlich bestehende manuelle Signierung unten.

## Historisch: Build 25 installiert – automatische Kapitel und Einrasten

Stand 9. Oktober 2026: **1.0 (25)** auf ausschließlich SrTan installiert, Sequenz **3196**, Version über die Geräte-App-Liste bestätigt. Normaler Appstart ohne Diagnoseflags erfolgreich; Startseite sichtbar. Die feste manuelle Signierung unten bleibt der aktuelle Buildweg. **451 Node-/Shipping-Swift-Tests plus 46 Webtests bestanden; 17 JS-Ressourcen im Bundle bytegleich; 18 macOS-WebKit-Fixture-Szenarien bestanden.**

Der Nutzer meint mit „Snap“ ausdrücklich das **Spulen an Kapitelmarkern**. Beim Ziehen rastet die Vollbild-Zeitleiste innerhalb von acht CSS-Pixeln ein und gibt den Marker jenseits von zwölf Pixeln wieder frei. Auch vier Pixel auseinanderliegende Kapitel bleiben gezielt erreichbar; eine kleine Hysterese verhindert Flattern am Mittelpunkt. Zeit und aktueller Kapitelname folgen der Vorschau; das Video springt erst beim Loslassen. Die native Bridge löst beim Einrasten einen begrenzten `UISelectionFeedbackGenerator`-Impuls aus. Tastaturbedienung bleibt frei, Werbung/Live/alte Kapitel werden ausgeschlossen. Keine zusätzliche Änderung der Vollbild- oder Panel-Timings.

**Build-23-Geräteabnahme:** Der Nutzer öffnete auf SrTan das eigene Vollbild und spulte zu 527,2 / 968 / 828 Sekunden; Pause blieb erhalten. Die lokale Diagnose bestätigt akzeptierten Vollbild-Einstieg, aktive Regler und Freigabe aller eigenen `inert`-Sperren beim Schließen. Eigene Kapitelanzeige, Marker und Regler waren sichtbar. Die Rekonstruktion von UI-/Style-Verlust und einer vor `.began` gesetzten Gestensperre ist durch Regressionen abgesichert; die genaue Ursache des ursprünglichen Build-22-Gerätefehlers bleibt unbelegt. [Build 23](docs/qa/motion-build23/validation.json).

**Build-24-Gerätebefund:** Beim Eckhart-Tolle-Video waren Zeit und rote Leiste sichtbar, aber Kapitel fehlten. Die öffentliche mobile Watch-Antwort liefert drei automatische Kapitel in `ytInitialData`, während Playerantwort/Beschreibung keine liefern. Build 25 ergänzt nur zur aktuellen primären Video-ID passende Overlays/Kapitelpanels. Mobiles serialisiertes JSON wird begrenzt und einmal je Inhalt geparst; leere Listen werden nicht festgehalten, bestehende begrenzte Hydration-Retries bleiben aktiv. Ein exakter Seek-Zielwert verhindert, dass `step=0.1` den Kapitelbeginn 95,88 auf 95,9 rundet. [Quellenbefund](docs/qa/motion-build25/chapter-source.json), [historischer Build 24](docs/qa/motion-build24/validation.json).

Für Build 25 sind Installation, normaler Start und Producer-/Vollbildintegration in echtem macOS-WebKit bestätigt. **Nutzerabnahme auf SrTan bestätigt:** Nach der Bitte, das gleiche Video im Vollbild zu öffnen und über einen Marker zu ziehen, antwortete der Nutzer „geht alles danke.“ Kapitelanzeige und Einrasten gelten damit für diesen Gerätefall als bestätigt; die Haptik wurde nicht gesondert beschrieben. Weitere Kommentar-, Pull-, Tastatur- und Langzeitfälle gelten nicht pauschal als abgenommen. Keine neue große Profilaufnahme; zuletzt etwa 16 GiB frei. [Aktuelle Nachweise und Grenzen](docs/qa/motion-build25/validation.json). Historische Prüfstände unten nicht als aktuellen Gerätestand ausgeben.

## Aktuelle Signierung: normale Builds dürfen keine Zertifikate austauschen

Am 8. Oktober 2026 hat Xcodes interne `IDEProvisioningRepair(Langform)` das kurz zuvor auch für Safari verwendete Entwicklerzertifikat widerrufen. Der Nutzer hat ausdrücklich verlangt, dass neue iPhone-Builds die Safari-Signierung nicht mehr verändern. Deshalb stehen **Langform, DeviceTests und das generierte Safari-Projekt auf manuell**, einschließlich `ProvisioningStyle`. Live in Xcode geprüft: **Automatically manage signing ist aus**. Der Safari-Konverter stellt auch neue Projekte über `scripts/lock-safari-signing.py` auf manuell.

**Aktueller Buildweg:** `bash scripts/deploy-iphone.sh`. Keine Overrides mit `CODE_SIGN_STYLE=Automatic`, keine automatische Zertifikatsreparatur und kein `-allowProvisioningUpdates`. Das Skript prüft das festgelegte vorhandene Zertifikat und ein passendes lokales Profil, baut mit `CODE_SIGNING_ALLOWED=NO` und signiert danach lokal. Xcode lehnt das Personal-Team-Profil im direkten manuellen Signing ab; diese erwartete Meldung in Xcode ist kein Anlass, die automatische Signierung wieder einzuschalten. `--check-signing` prüft nur, `--build-only` baut/signiert ohne Gerät, `--no-launch` installiert ohne Appstart.

Festgelegte Identität aktuell `E94E8C9CC2FF184832B68E4C02A332867D66F560`, Team `RFN59MUTQ3`, iPhone-Profil `8c01d0de-5bba-4c1a-8eae-c9e2e9ceb2b5` bis **15.10.2026 23:35 Europe/Berlin**. Fehlende/abgelaufene/widerrufene Mittel müssen bewusst gewartet werden; keine automatische Ersatzidentität. Safari und iPhone haben getrennte feste Auswahl und Buildabläufe, benutzen derzeit aber weiterhin dieselbe vorhandene Identität. Das schützt normale Builds vor Zertifikatswechseln, nicht vor bewusstem Widerruf durch andere Projekte oder vor Ablauf. Für echte Zertifikatstrennung wäre ein separater Developer-ID-/Notarisierungsweg für Safari erforderlich.

**Verifikation:** 11 gezielte Signierungstests bestanden. Vollständiger `--build-only`-Release mit lokaler Signierung erfolgreich, exakte bisherigen drei App-Entitlements und Zertifikat-Hash geprüft; strenge Signaturprüfung erfolgreich. Zertifikatsinventar vor/nach dem Build identisch, beide installierten Safari-Binaries bytegleich und Signatur gültig. Vier Safari-Konverterfälle inklusive SDK-Override und wiederholter Anwendung geprüft. Die iPhone-App wurde dafür nicht neu installiert oder gestartet; der abgenommene Build 17 bleibt auf SrTan. [Prüfprotokoll](docs/qa/signing-isolation-2026-10-08.json). Nachfolgende frühere Angaben zur automatischen Signierung sind historisch und keine aktuellen Handlungsanweisungen.

## Aktuell: Build 17 installiert; Nutzer bestätigt funktionierende Wiedergabe

Langform **1.0 (17)** ist ausschließlich auf **SrTan** installiert, Sequenz **3108**, durch App-Inventar bestätigt. Abschließende Rückmeldung nach dem direkten iPhone-Test: **„danke klappt alles“**. Angefragt waren anderes Video von Home, mehrere Tipps auf die Videofläche, Pause → Play, Timeline-Sprung und Ton. [Build-17-Prüfstand einschließlich Source-/Binary-Hashes](docs/qa/player/build17-validation.json).

Die native `PlaybackAudioSession`-Hilfsklasse und ihre Aufrufe sind entfernt. WebKit/YouTube verwaltet seine Medienwiedergabe, native Statusmeldungen aktualisieren weiter die Oberfläche. Der Build-16-Vergleich hatte den Fehler mit eigener nativer Audio-Verwaltung reproduziert und ohne sie weiterlaufende Bedienung gezeigt. **Build 17 enthält die Korrektur dauerhaft und benötigt keinen Audio-Abschaltflag.** Die Prüfstarts verwendeten nur `LANGFORM_DIAGNOSTICS=1` und `LANGFORM_PLAYER_TRACE=1` zur Beobachtung.

Vor der Nutzerabnahme bestand die reale Bedienfolge über Device Hub am Mac auf „Die Schönheitsklinik“: Home → Video, Entstummen, Controls ein-/ausblenden, Pause bei **18,840 s**, Play bei **18,864 s**, laufend bis **50,641 s**, Seek auf **121,913 s** mit **748 ms** bis `seeked`, danach weiterhin Wiedergabe bis **149,762 s**. Keine weitere Pause nach dem Fortsetzen in dieser Trace; Schlussbild **2:29 mit Pause-Symbol**. Nutzertrace im selben Prozess **35464**, Run-ID `492CED1C-F43B-499C-BA5F-3254C598BD21`, enthält zwei zusätzliche Watch-Dokumente mit Eingabe-/Seek-Ereignissen und zuletzt `paused=false`, `readyState=4`. Die Nutzerbestätigung gilt der angefragten Bedienfolge, nicht einer vollständigen Produktabnahme.

**64 gezielte Tests bestanden**, Release regulär automatisch durch Xcode signiert, `codesign --verify --deep --strict` und `security verify-cert -p codeSign -R ocsp -R require` erfolgreich. Neue Zertifikatsseriennummer `0454693BF8C13D59D768AE058F91B7AD`; 15 gebündelte JS-Dateien bytegleich. Build-16-Revocation-Meldung ist historisch und trifft diese bestandene Prüfung nicht. App zuletzt weiter als PID **35464** geöffnet, kein schwerer Recorder oder Debugger aktiv. Keine weitere Geräteaktion für die Dokumentation.

Offene Grenzen: Hintergrundton/Sperrbildschirm, Vollbild, breite Videoabdeckung, vollständige UX und FPS nicht separat geprüft; Ton war Teil der Nutzerfrage, aber nicht unabhängig durch den Agenten gehört oder gemessen. Kein neuer vollständiger Testlauf behaupten: diese Änderung wurde mit den 64 gezielten Tests geprüft. Historische Diagnoseabschnitte folgen unten.

## Historischer Diagnosevergleich – Build 16, vor Installation von Build 17

Diagnosebuild **1.0 (16)** ist ausschließlich auf SrTan installiert, Sequenz **3100**, App-Inventar bestätigt. Zwei frische Prozesse desselben Binary und dasselbe Video „Der internationale Tag der Verzweiflung“ wurden mit unveränderten übrigen Diagnoseflags verglichen: `LANGFORM_NATIVE_AUDIO_DISABLED=1` deaktiviert die eigene native Audio-Session-Verwaltung, `=0` aktiviert sie. [A/B-Nachweis mit Rohdateien und SHA256](docs/qa/player/build16-validation.json).

**Audio-Verwaltung aus:** echte Bedienung über Device Hub am Mac; Pause bei etwa 0:34 → Play → beobachtet 0:35 und 0:48, drei Tipps auf die Videofläche → weiter bei 1:11, Timeline auf etwa 2:26 → nach kurzem Puffern weiter bei 2:34. Späteres gesichertes Bild: **2:46 mit Pause-Symbol**. Die Ereignistrace endet bereits bei der bewussten Pause bei 34,654 s; spätere Ergebnisse stammen aus Live-Beobachtung und Schlussbild. **Audio-Verwaltung an:** zunächst etwa 60 s Wiedergabe, dann bewusste Pause; erneuter Play-Klick bei Dokumentzeit 66775 ms, `playing` 66788 ms und ohne weitere Eingabe `pause` 67862 ms. Nach **1074 ms** wieder pausiert bei **62,054 s**, obwohl **22,946 s** gepuffert sind und `readyState=4`. Schlussbild **1:02 mit Play-Symbol**. Die Controls waren vorhanden.

Dieser Vergleich grenzt die eigene Audio-Session-Verwaltung als beitragenden Fehlerpfad ein. Es ist ein einzelnes sequenzielles OFF/ON-Paar mit unkontrolliertem Netz/Cache; keine allgemeine Abnahme für weitere Videos, Hintergrundton, Sperrbildschirm, Vollbild oder FPS. **Build 17 mit dauerhafter Korrektur wird implementiert; Installation und Geräteprüfung sind noch nicht dokumentiert.** Build 16 bleibt ein Diagnosebuild, dessen Ergebnis von Startoptionen abhängt.

Signierung Build 16: macOS meldete bei `codesign`/Zertifikatsprüfung `CSSMERR_TP_CERT_REVOKED`; reguläre `devicectl`-Installation und beide Starts wurden angenommen, ohne Sicherheitsumgehung. Nicht als bestandene macOS-Vertrauensprüfung ausgeben. Nach erneuter Apple-Anmeldung steht laut paralleler Safari-Reparatur eine neue gültige Identität bereit; **Build 17 soll regulär automatisch durch Xcode signiert werden**, Erfolg anschließend prüfen.

Build 15 ist weiterhin als fehlgeschlagen dokumentiert: PID **35257**, Run-ID `0E709B49-8C61-4508-9B5B-8F4392AB15A9`, 236 Tracezeilen/179 Playerereignisse. Ein späterer zehnzeiliger Stack-Probe zeigte YouTubes MediaSession-`pause`-Handler, während das Medium schon pausiert war; der ursprüngliche Auslöser war damit allein noch nicht bekannt. Früher fehlender Controls-Toggle, später vollständiger DOM: kein Nachweis dauerhaft fehlender Controls. 32 Einzelbilder bleiben unter `/tmp/langform-build15-live-frames/`. Instruments ab etwa 23:02 Uhr scheiterte an vollem Datenträger; unbrauchbare Rohtrace/Ktrace entfernt, danach rund 15 GB frei gemeldet. Keine kontinuierliche Videoaufnahme oder verwertbare Performance-Aufnahme dieses Laufs. [Build-15-QA](docs/qa/player/build15-validation.json). Die historischen Stände darunter bleiben erhalten.

## Aktuell am Laptop: Build 14 installiert, 8. Oktober 2026, 22:03 Uhr

Langform **1.0 (14)** ist jetzt ausschließlich auf **SrTan** installiert, Sequenz **3084**, und durch die Geräte-App-Liste unabhängig bestätigt. **302 Node-/Shipping-Swift-Tests und 46 Webtests** bestanden. Lokaler optimierter iOS-Release gebaut, alle 15 JavaScript-Ressourcen bytegleich, Signatur mit `codesign --verify --deep --strict` geprüft. Appstart noch nicht erfolgt: Das Gerät meldete `passcodeRequired=true`. Keine neue physische Tipp-/Wiedergabeprüfung.

Xcodes automatische Signierung scheiterte hier an fehlendem Apple-Konto und einer als ungültig gemeldeten Signierungsidentität. Die direkte Zertifikatsprüfung mit erforderlicher OCSP-Antwort bestätigte die vorhandene Identität `E3E44E968D09266F6D8F8FC911A8EF48DEAC8C36` als gültig und nicht widerrufen. Daher wurde der Release ohne Xcode-Signierung gebaut und anschließend mit dieser Identität und dem vorhandenen passenden Geräteprofil `15427cc7-def0-426a-bcc9-1a72e06c26eb` signiert. Installation erfolgreich; keine dauerhaften Signierungseinstellungen geändert. Signiertes Paket: `/Users/tanipekkaya/Library/Developer/Xcode/DerivedData/Langform-build14-laptop/Build/Products/Release-iphoneos/Langform.app`.

Das vorherige Geräteprotokoll wurde vor der Installation unter `docs/qa/player/build14/build13-preinstall.jsonl` gesichert. Aktuelle Belege: [Laptop-Deployment](docs/qa/player/build14/laptop-deployment.json). Der jüngste Abschluss des anderen Macs war laut Chatzeitstempel **20:15 Uhr Europe/Berlin**; er hatte Build 14 vorbereitet, aber nicht installiert. Der 360p-/0:01-Ladehänger bleibt offen. Nächster Schritt nach Entsperren: manuelle Reproduktion ohne Bildschirmaufnahme mit **beiden** Flags `LANGFORM_DIAGNOSTICS=1` und `LANGFORM_PLAYER_TRACE=1`; Trace vor einem weiteren Normalstart kopieren. Kein automatischer Probeplan.

## Vorheriger Stand des anderen Macs: Fortsetzung am Laptop, 8. Oktober 2026 abends

Historische Übergabe vor der oben dokumentierten Laptop-Installation. Nutzer hat sein iPhone mitgenommen und die Weiterarbeit im iCloud-Desktop-Ordner gewünscht. Projekt auf diesem Mac: `/Users/tan/Desktop/Langform`; auf dem Laptop den synchronisierten Ordner öffnen. Keine neue Installation auf dem anderen Mac nach dem Weggehen. iCloud-Synchronisationsabschluss damals nicht geprüft.

- **iPhone:** Langform **1.0 (13)**, signiert installiert, Sequenz 3076. Letzter beobachteter Normalprozess 34134. Binary SHA256 `d141a2d945dc15b99768fbd56d44cd00993f9c0ac9d4fa0c4974b6a098db0dfa`. Bekannte leere Videoflächen pausieren beim noch fehlenden/defekten Controls-Toggle nicht mehr durch einen weitergereichten Click. 298 Tests bestanden. Der gemeldete 360p-/0:01-Ladehänger ist trotzdem **nicht als behoben abgenommen**.
- **Aktueller Quellstand:** **Build 14**, 302 Tests bestanden, generischer iOS-Release erfolgreich mit `CODE_SIGNING_ALLOWED=NO`, noch **nicht signiert/installiert**. Zusätzliche Eingabe-/Medienereignisdiagnose nur bei `LANGFORM_DIAGNOSTICS=1` und `LANGFORM_PLAYER_TRACE=1`. Sie steuert nichts, misst kein Layout und läuft begrenzt. Normalstart entfernt die alte Trace-Datei; vorher kopieren. Keine neue Beschleunigung aus diesem Diagnosebuild behaupten.
- **Sichtbarer Fehler:** Video kommt zunächst schwarz hoch, anschließend Bild bei ungefähr 0:01 mit Ladekreis. Qualitätsmenü zeigte 360p. Taps sind in der Aufnahme nicht als Finger sichtbar. Pause-Steuerung während des Stillstands kann auch auf Puffern bei angeforderter Wiedergabe hinweisen. Bisherige erste Playbackmarker erfassen nicht die ganze Ereignisfolge.
- **Beweisgrenze:** Der Nutzer startete Build 13 während der Aufnahme neu. JSONL aus PID 34074 ist danach veraltet und passt nicht zum aufgenommenen PID 34134. USB-MOV-Ausgabe unterbrach sich mehrfach; gesicherte Clips sind Segmente mit möglichen Lücken. Aufnahmen und Profiling können selbst Last verursachen.
- **Nächster Schritt:** Auf dem Laptop Build 14 signieren/installieren; den konkreten manuellen Ablauf zuerst ohne Screenaufnahme mit obigen zwei Diagnoseflags wiederholen. Mit übereinstimmender PID/Run-ID die echte Folge aus Eingabe, Pause, Waiting und Puffer auswerten. Danach vergleichbarer Lauf mit Aufnahme. Keine weiteren hypothetischen Qualitäts-/Autoplay-/Reveal-Umbauten vor dieser Trennung.

Ausführliche Befunde, exakte Befehle und Prüfnachweise: [Player-QA](docs/qa/player/README.md), [Build 13](docs/qa/player/build13-validation.json), [Build 14](docs/qa/player/build14-validation.json). Relevante Clips und Context-Switch-XML liegen unter `docs/qa/player/local-recordings/` (in diesem Projektordner, absichtlich Git-ignoriert). Portable Swift-Aufnahmequellen: [scripts/diagnostics](scripts/diagnostics/README.md). Keine laufende Bildschirmaufnahme und kein laufender Instruments-Recorder zurückgelassen. Keine Commits, keine Safari-Installation, vorhandene andere Änderungen erhalten.

## Historischer Projektüberblick

Stand: Commit `0a46955` (README: Werbung), Branch `main`.
Ordner auf dem Mac: `/Users/tanipekkaya/Desktop/Langform`
Für Tan Ipekkaya. Weiterarbeit kann in diesem Ordner passieren.

## Was das ist

Eine eigene App und eine Safari-Erweiterung. YouTube bleibt die Seite. Shorts werden ausgeblendet. Lange Videos bekommen eine Kurzfassung auf Deutsch.

Die iPhone-App heißt **Langform**. Sie ist kein Nachbau des nativen YouTube-Players. Es sind zwei Webansichten von YouTube:

- Der Feed bleibt auf der Seite, von der man kommt.
- Ein Tipp auf ein Video lädt die Watch-Seite in einer zweiten Ansicht darüber.
- Wisch nach unten auf dem Bild: die Player-Ansicht wird zur kleinen Karte, der Feed darunter bleibt scrollbar, die Wiedergabe läuft weiter.
- Tipp auf die Karte macht sie wieder groß. Das Kreuz schließt sie.
- Oben links: Chevron nach unten, solange ein Video läuft (wird zur Karte). Sonst Zurück.

Bundle-ID der App: `de.ipekkaya.langform`. Team in Xcode: `RFN59MUTQ3`. Nur das iPhone **SrTan** (iPhone 18 Pro). „iPhone von Romy“ nicht anfassen.

Die Safari-Erweiterung heißt **Shorts ausblenden**. Auf dem Mac darf es davon genau eine geben, unter `~/Applications/Shorts ausblenden.app`. Weitere Kopien aus DerivedData machen in Safari mehrere Einträge. Derived-Data-Apps nach dem Ersetzen in `….not-registered` umbenennen und nicht starten.

## Was funktioniert

- Shorts werden auf `www.youtube.com` und `m.youtube.com` per CSS versteckt. `/shorts` geht auf die Startseite.
- Kurzfassung: Untertitel werden in der Seitenwelt gelesen. Das Modell auf dem Gerät (Apple Foundation Models, kostenlos, kein Extra-Abo) schreibt **Das Wichtigste**. Auf dem iPhone über die App. In Safari sendet das isolierte Content-Script per `runtime.sendMessage` an `src/background.js`; nur dort läuft `sendNativeMessage`. Im Manifest sind `nativeMessaging` und das Background-Skript erforderlich.
- Kapitel, nur wenn das Video mindestens zwei hat: ein einzeiliger Name neben der Zeit, Tipp öffnet das Blatt **Kapitel**, Striche auf der roten Leiste. Kein zweiter Chip, wenn YouTube selbst einen zeigt. Nichts oben rechts über Cast, CC oder Zahnrad.
- Werbung: Skip-Knopf wird geklickt. Ohne Knopf wird die Werbung stumm ans Ende gesetzt. Das Hauptvideo wird nicht pausiert und nicht als Werbung gelesen. Werbeplätze per CSS aus.
- AirPlay sitzt als eigener Knopf neben YouTubes Steuerzeile, die Zeile selbst wird nicht verändert. Cast von YouTube nicht verstecken.
- Suche, Startseite und Zeitstempel-Tipp auf dasselbe Video sollen den Player suchen, nicht die History umschreiben.

## Bekannte Grenzen

- Es ist die YouTube-Webseite, nicht die native App. Animationen der echten App (geteilte Elemente, eigenes Gesten-System) gibt es so nicht.
- Chromecast über ein eigenes Cast-SDK geht nicht ohne den Stream abzuziehen. Das wird nicht gemacht. Sichtbar bleiben YouTubes Cast-Knopf und AirPlay.
- Ein Video ohne Kapitel hat keine Kapitelachse. Das ist gewollt.
- Die Kurzfassung auf dem Mac hing an zwei Brücken und am Main-Actor. Safari stellt `browser.runtime` auch in der Seitenwelt bereit; nur `runtime.id` unterscheidet hier den isolierten Kontext. Die native Anfrage läuft über den Background. `beginRequest` muss sofort zurückkehren: Ein `Task { @MainActor [context] in ... }` hält den Kontext bis `completeRequest` fest. Keine Semaphore und keine verschachtelte RunLoop-Warteschleife verwenden; die alte Schleife blockierte den Task bei 100 % CPU. Regressionstests und einen echten Safari-Klick beim nächsten Update prüfen.
- Installationen auf SrTan liefen über `devicectl`. Einmal gekoppelt, danach auch per WLAN (`localNetwork`), solange Entwicklermodus an ist und das iPhone entsperrt ist. Gesperrter Bildschirm: installieren geht, starten nicht.
- Dieser Ordner hat kein `node_modules` und kein DerivedData. Vor Tests im App-Teil von Langform (Next.js unter `apps/langform`) `npm install` im jeweiligen Ordner.

## Wo was liegt

- `ios/Langform/` — Xcode-Projekt. Schema **Langform**. Wichtig: `YouTubeWebView.swift`, `LangformApp.swift`, `PlayerRect.js`, `WebViewLinks.js`.
- `extension/` — Manifest V3, Safari und die Skripte, die die App mitlädt. `src/ads.js`, `src/page-captions.js`, `src/summary.js`, `src/controller.js`, `src/hide.js`, `src/early.js`.
- `native/SafariWebExtensionHandler.swift` — wird vom Konverter in die Mac-App kopiert. `scripts/convert-safari.sh` nur auf dem Mac.
- `apps/langform/` — ältere Web-App, nicht die iPhone-App. Nicht mit der iPhone-App verwechseln.
- `tests/` — Node-Tests. `node --test` im Repo-Root für die Erweiterung. `summary.live.test.js` braucht Netz.

## Bauen auf SrTan

Auf dem Mac, im Ordner:

```bash
bash scripts/deploy-iphone.sh
```

Das Skript signiert lokal, installiert und startet ausschließlich auf SrTan. Mit `--build-only` nur bauen/signieren; mit `--no-launch` nach der Installation nicht starten. Keine automatische Provisionierung als Fallback verwenden.

Safari, nur wenn die Erweiterung sich ändern soll:

```bash
bash scripts/convert-safari.sh
```

Danach nur `~/Applications/Shorts ausblenden.app` ersetzen. Die gebaute App unter DerivedData nicht öffnen.

## Nicht tun

- Kein zweites Video-Element, keine `googlevideo`-URL, kein Download.
- Am `<video>` keine `width`, `height`, `object-fit` oder `display` setzen. Das hat den Player schwarz gemacht.
- `seekTo` nicht aus `pushState` oder `replaceState`. YouTube schreibt `t=` beim Start, ein Seek dort hält den Film an.
- Shorts-Knoten nicht aus dem DOM reißen, wenn sie den Player oder ein `video` enthalten.
- Kein Apple-Events-JavaScript in Safari. Das fragt nach Touch ID und wirkt nach einem Angriff. Nicht machen.
- `~/Projects/speicherfresser`, life-cal und `~/Projects/langform` nicht anfassen. `~/Projects/langform` ist ein laufender Webserver, nicht diese App.

## Offen, wenn weitergebaut wird

- Ob der Wisch nach unten auf dem Gerät zuverlässig die Karte trifft. Die Geste hängt an der Karte über der Player-WebView und soll den Scroll-Pan der WebView schlagen.
- Ob der Kapitelname auf einem echten Film mit Kapiteln klein neben der Zeit steht und nicht oben rechts.
- Ob die Startseite und einzelne Videos noch langsam sind. Die schweren Scans sollen während der Wiedergabe aus sein.
- Safari-Kurzfassung gegen den Commit prüfen, siehe oben.

## Weiterarbeit am 7. Oktober 2026 auf diesem Mac

Aktueller Ordner: `/Users/tan/Desktop/Langform`. Die folgenden Änderungen liegen im Arbeitsverzeichnis und sind noch nicht committet:

- Shorts-Scans bündeln wiederholte Mutationen desselben Teilbaums. Auch beim Aktivieren während der Wiedergabe bleibt es beim CSS. Ein inzwischen zum Player gewordener Container wird nicht entfernt.
- Kurzfassungs-Knöpfe aktualisieren sich bei wiederverwendeten Videokarten und ersetzten Metadaten. Eigene UI-Mutationen und bloßes Scrollen lösen keine weiteren Feed-Scans aus.
- Kapitel und AirPlay werden nach Scrollen/Drehen richtig neu platziert. Kapitel des vorherigen Videos werden entfernt. Ein ausdrücklich getippter Zeitstempel kann auch zurück auf 0:00 springen; der native Player hat dafür eine eigene Brücke. Keine Suche über die ganze Seite, wenn die Steuerung innerhalb des bekannten Players liegt.
- Ton nach Werbung wird auch dann wiederhergestellt, wenn nur das Werbe-Overlay verschwindet.
- Neue Videos laden auch aus dem Miniplayer heraus hinter dem Feed. Es gibt eine abbrechbare Ladeanzeige und bei Fehler oder nach 30 Sekunden eine Wiederholungsmöglichkeit. WebKit-Prozessabbrüche sind abgedeckt; verspätete Meldungen und Messungen alter Videos werden verworfen. Der Feed behält beim erneuten Laden seine Adresse.
- Native Touchflächen sind mindestens 44 Punkte groß; VoiceOver kann die Miniplayer-Karte vergrößern/schließen. „Bewegung reduzieren“ wird berücksichtigt. Alte Video-Beobachter und native Zusammenfassungsaufträge werden beim Seitenwechsel beendet.
- Das Greifen der Karte mitten in der Verkleinerungsanimation ist weiterhin nicht durchgehend unterstützt. Die Dokumentation behauptet diese Funktion nicht mehr. Änderungen am nativen Gestensystem benötigen einen echten Gerätetest.

Prüfung: **109 Node-Tests bestanden**, einschließlich Live-Untertiteltests und Integrationstest der tatsächlich verketteten iPhone-Skripte. Optimierter iOS-Release-Build ohne Signierung erfolgreich. Tests: `/Users/tan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/*.test.js`.

Der signierte Build hat das Provisioning-Profil erhalten und wartet auf die macOS-Schlüsselbundfreigabe für `codesign`. Vor der Installation nochmals das Deployment-Skript ausführen, damit auch die letzte Änderung am Verkleinern nach einem Kanalwechsel enthalten ist. Build-Log: `/tmp/langform-signed-build.log`. Keine Installation als erfolgreich melden, bevor `devicectl` sie bestätigt.

Deployment: `bash scripts/deploy-iphone.sh` baut Release, installiert und startet ausschließlich auf der oben angegebenen SrTan-UDID. DerivedData liegt außerhalb des mit iCloud synchronisierten Schreibtischs unter `~/Library/Developer/Xcode/DerivedData/Langform-device`, da Finder-Metadaten dort sonst die Signierung verhindern können. Xcode 27 ist vorhanden, Erststart/Lizenz sind erledigt und ein gültiges Apple-Development-Zertifikat ist vorhanden. Das echte iPhone war beim bisherigen Versuch noch nicht verbunden; Installation und Gerätetest sind noch offen. Keinen Simulator und kein anderes iPhone verwenden.

Nach Installation auf SrTan prüfen: schneller Wechsel A → B, großer Player → Karte → groß ohne Wiedergabeunterbrechung, Scrollen und Suche im Feed unter der Karte, Zeitstempel/erstes Kapitel, AirPlay/Cast nach Scrollen/Drehen, Kurzfassung in wiederverwendeten Listen und Flugmodus → Fehler → Erneut.

## Flüssige Tabs und Gerätetest, Nacht 7./8. Oktober 2026

Weiterarbeit wieder in `/Users/tanipekkaya/Desktop/Langform`, weiterhin auf dem vorhandenen uncommitteten Arbeitsstand. Die Updates des anderen Macs blieben erhalten.

- Startseite, Abos und Mein YouTube haben jetzt jeweils eine erhaltene `WKWebView`. Nach dem ersten Besuch wechseln die Haupttabs ohne erneutes Laden; DOM und Scrollposition bleiben erhalten. Unterseiten können über vorhandene History zur Tabwurzel zurückkehren. Bei Speicherdruck werden nur inaktive Tabs verworfen.
- Der Fehler „Abos → Startseite zeigt weiter Abos“ wurde vor der Änderung auf SrTan nachgestellt. Haupttab-Tipps werden jetzt vor YouTubes SPA-Navigation an die native Tab-Verwaltung gegeben. Platzhalter `href="#"` werden anhand des getippten Tabs erkannt. Mobile Mediathek: `/feed/library`; `/feed/you` hatte im Gerätetest nur eine leere Hülle gezeigt. Echte Links behalten ihre Adresse.
- Inaktive Feeds und der verdeckte Feed unter dem großen Player stellen Zusatzscans zurück. Ein unveränderter Tab erzeugt beim Wiederanzeigen keine neuen Scans. Sobald der separate Player lädt oder geöffnet ist (auch mini), suspendiert WebKit alle Feed-Vorschauen. Das laufende Hauptvideo bleibt davon unberührt.
- Kurzfassung aktualisiert nur veränderte Karten/Teilbäume. Regressionstest: Eine neue Karte in einer Liste mit 100 bestehenden Karten verursachte vorher 400 Abfragen an den alten Karten, jetzt 0. Verborgene Feeds merken sich nur, dass später ein Refresh nötig ist.
- Player-Meldungen laufen gebündelt im nächsten Animationsframe statt nach festen 120 ms. Nur First Contentful Paint wird als gezeichneter Inhalt gewertet. Die native Feder rastet in 0,22–0,36 Sekunden ein; Öffnen dauert 0,34 Sekunden. Re-Grabs berücksichtigen die sichtbare Position; Close-Button und Kartentipp konkurrieren nicht mit der Pan-Geste.
- ProMotion-Freigabe liegt in `ios/Langform/Info.plist` und wurde im tatsächlich gebauten App-Bundle als Boolean `true` geprüft. Ein bloßes freies `INFOPLIST_KEY_…`-Buildsetting wurde nicht ins Bundle übernommen. Buildnummer: 2.

Prüfung: **132 Node-Tests bestanden**, inklusive tatsächlich verketteter iPhone-Skripte, Tab-Brücke, versteckter Feeds und verzögerter Kartenupdates. Signierter optimierter Release-Build erfolgreich, mehrfach per `devicectl` auf **ausschließlich SrTan** installiert und gestartet. Auf dem echten Gerät geprüft: Home ↔ Abos zeigt richtige unterschiedliche Inhalte ohne neues Laden nach dem Erstbesuch; Abos behält die gescrollte Position; Mein YouTube zeigt Profil/Mediathek und kehrt ohne Neuladen zurück; Wisch zum Miniplayer und Tipp zurück zum großen Player; Video läuft beim Tabwechsel weiter; Feed-Vorschau bleibt bei 10:27 stehen, während der Miniplayer sichtbar weiterläuft. Zurück-Knopf wird auf allen drei Tabwurzeln ausgeblendet. Der Start-Hintergrund von WebView und ScrollView ist schwarz, um das weiße Aufblitzen beim ersten Seitenaufbau zu vermeiden.

Offen bleibt ein präziser FPS-/Hitch-Nachweis und gezieltes sehr schnelles Wiederanfassen mitten in der Feder. Keine Behauptung, dass alles identisch mit der nativen YouTube-App oder konstant mit 120 fps läuft. Erstbesuch, Videoladen und nach Speicherdruck verworfene Tabs hängen weiterhin von YouTube/Netzwerk ab. Die ältere vollständige Checkliste oben (AirPlay, Offline-Fehler, Zeitstempel etc.) wurde in dieser Runde nicht vollständig erneut durchgespielt.

Deployment weiterhin `bash scripts/deploy-iphone.sh`; neu optional `--no-launch`, wenn nur installiert werden soll, ohne die App nach vorn zu holen.

Abschluss: Auch die letzte Hintergrund-Farbkorrektur wurde signiert gebaut und auf SrTan installiert (`devicectl`: Version 1.0, Build 2, Installationssequenz 2760). Auf Wunsch des Nutzers wurde die Bildschirm-/Audioübertragung im Device Hub beendet, damit er YouTube auf dem Mac mit normalem Ton sehen kann. Danach die App nicht nochmals automatisch gestartet.

## Zweiter Performance-Pass und einfache Key Points, 8. Oktober 2026

Build **1.0 (3)** ist signiert als Release auf SrTan installiert (`devicectl`, Installationssequenz 2776). Der letzte Build enthält auch den Tastatur-Guard und den Filter für den im Modelltest beobachteten Füllsatz. Das gebaute `summary.js` wurde bytegleich mit dem aktuellen Quelltext geprüft. `CADisableMinimumFrameDurationOnPhone` ist im App-Bundle weiterhin `true`.

- Native Skriptquellen werden pro Appstart einmal zusammengesetzt, statt bei jedem neuen Tab erneut synchron von Dateien gelesen zu werden.
- Gleiche Videorechtecke erzeugen nach einer Playerbewegung keine zusätzliche leere Crop-Animation.
- Ein einzelner Abos-Vorladeversuch beginnt frühestens 1,5 Sekunden nach fertig geladener Home-Seite. Nur foreground, ruhender Feed, geschlossener Player, keine Tastatur, normale Thermik und kein Stromsparmodus. Scrollbeginn, Tab-/Player-/native Kurzfassungsanfrage, Reload oder Background brechen die wartende bzw. laufende Vorladung ab; ein expliziter Abos-Tipp übernimmt sie. Eine Speicherwarnung verhindert weiteres Vorladen. Medien und Zusatzscans bleiben im vorgeladenen Tab aus.
- Die iPhone-Kurzfassung priorisiert wichtige, interessante Fakten in einfacher Sprache: meist 3–4, höchstens 5 kurze Punkte; bei wenig belegtem Inhalt auch 1–2. Keine Auffüllung, Titel-/Ablauf-Nacherzählung oder erfundene Ergänzungen; Einschränkungen und Meinungen bleiben erkennbar. Lange Untertitel liefern fünf gleichmäßig verteilte Ausschnitte mit insgesamt weniger als 6000 Zeichen. Es ist weiterhin keine vollständige Analyse aller Sätze eines langen Videos.
- Zwölf erfolgreiche Kurzfassungen werden pro WebView für die Sitzung gespeichert (`key-points-2`), Fehler nicht. Erneutes Öffnen benötigt für diese Videos keine zweite Modellanfrage. Doppelte Punkte und die konkret beobachtete Meta-Schablone „Das war die einzige neue Information“ werden verworfen; inhaltliche Studiengrenzen bleiben erhalten.

Prüfung: **148/148 Tests bestanden**, darunter tatsächlich ausgeführter Swift-Code für die Untertitelvorbereitung und Integration der iPhone-Skripte. Signierter Release-Build erfolgreich, `git diff --check` sauber. Zwei synthetische Quellen wurden mit dem echten lokalen Foundation Model und dem iPhone-Prompt auf dem Mac geprüft: Zahlen/Fakten korrekt; bei Ein-Fakt-Quelle erzeugte das Modell trotz Prompt einen Meta-Füllsatz, weshalb der enge getestete Filter hinzugefügt wurde. Kein Qualitäts- oder Geschwindigkeitsnachweis für alle Videos.

Die vorhandene 31,09-s-Aufzeichnung `/tmp/langform-final-animation.trace` aus dem ersten Durchlauf wurde ausgewertet: zwei Langform-Hitches à 8,33 ms und zwei >33-ms-Verzögerungen (58,37/39,15 ms), letztere überwiegend WebKit-/iOS-Tastatur und First-Responder-Stacks. Sie enthält auch einen externen 60-Hz-Displaypfad neben dem iPhone-Display mit maximal 120 Hz und keine CPU-Stichproben des WebContent-Prozesses. Daher kein sauberer Vorher/Nachher- oder konstanter-FPS-Nachweis. Die neue Performancewirkung wurde noch nicht vergleichend gemessen.

Die Mac-Bildschirm-/Tonübertragung bleibt beendet (Device Hub zeigt „View Screen“). Der Prozessstart des neuen Builds wurde durch `devicectl` bestätigt; der anschließende direkte Gerätescreenshot zeigte jedoch den Sperrbildschirm. Die Bitte um Entsperren blieb unbeantwortet, deshalb wurden in diesem zweiten Durchlauf keine neuen Wisch-/Tab-Gesten auf dem Gerät verifiziert. Die früheren Gerätetests oben gelten nur für den vorherigen Stand.

Während dieses Durchlaufs wurden Safari-Handler, Safari-Bridge, Manifest und dazugehörige Tests parallel außerhalb unserer drei Subagents geändert. Diese fremde Arbeit wurde erhalten, nicht zurückgesetzt. Kein Safari-Build oder Safari-Deployment durch diesen Durchlauf. Für neuen Build immer den aktuellen vollständigen Testsatz nutzen.

Ein lokaler Speichermangel blockierte kurz das Schreiben. Ausschließlich die nicht mehr geöffnete rohe Instruments-Zwischendatei dieses Tasks (`instrumentsUGPAlX.ktrace`, 4,1 GiB, Aufnahme 00:05:39–00:06:13) wurde nach bestätigtem Speichern des vollständigen Trace entfernt; Nutzerdateien und der fertige Trace blieben erhalten.


## Safari-Reparatur und native Kurzfassung, 8. Oktober 2026

Safari-Erweiterung **1.0.1 (5)** signiert gebaut und unter `/Users/tanipekkaya/Applications/Shorts ausblenden.app` installiert. `codesign --verify --deep --strict` erfolgreich; `pluginkit` bestätigt genau eine Registrierung aus diesem Pfad. Das vorherige Zertifikat war widerrufen (`CSSMERR_TP_CERT_REVOKED`), nicht abgelaufen; der Verursacher des Widerrufs ist nicht bekannt. Das vorhandene gültige Apple-Development-Zertifikat wurde verwendet. Backups liegen unter `~/Library/Application Support/Langform/backups/`.

- Der MAIN-World-Guard erkennt Safari nicht mehr allein an einem vorhandenen `browser`-Objekt. Die Seitenbrücke wurde live als aktiv geprüft.
- Content-Script-Anfragen laufen über `background.js` und die Berechtigung `nativeMessaging` zum nativen Handler. Sender und YouTube-Ursprung werden geprüft.
- Der native Handler hält den Anfragekontext in einem asynchronen Task; die alte wartende RunLoop blockierte den MainActor und verursachte hohe CPU-Last. Der neue Lifecycle-Test reproduziert den Fehler mit dem alten Handler und besteht mit dem neuen.
- Das Modell ist Apples lokales `SystemLanguageModel.default` über Foundation Models. Der Safari-Prompt fordert 3–5 konkrete Punkte in einfacher deutscher Sprache. Lange Untertitel werden auf sechs verteilte Ausschnitte innerhalb von 6000 Zeichen begrenzt. Dies ist keine vollständige Verarbeitung jedes Satzes langer Videos.

Live in Safari geprüft: Shorts-Navigation wird abgefangen; beim Video `Q2LbLSwb8ns` erscheinen fünf generierte Punkte statt des Untertitelfehlers. Der native Prozess kehrt nach der Antwort auf 0 % CPU zurück. Die Fahrzeitangabe 39 → 23 Minuten ist durch die gelesenen Untertitel belegt. Die Finanzierungsaussage zur Magnetschwebebahn konnte noch nicht vollständig gegen den Quelltext geprüft werden; deshalb keine pauschale Genauigkeitszusage. Ein zweites Video wurde in dieser Runde noch nicht live geprüft. Weitere UI-Eingriffe wurden beendet, als der Nutzer im anderen Tab im Vollbild schaute. Der Web-Inspector im Testtab kann noch offen sein.

Prüfung: gesamter Testsatz zum Prüfzeitpunkt 148/148 bestanden; anschließend 17 gezielte Paket-/Relay-/Bridge-/native-Lifecycle-Tests bestanden, einschließlich des neu hinzugekommenen Swift-Lifecycle-Tests. Das funktionierende generierte macOS-Projekt liegt unter dem ignorierten `safari/`; der fehlgeschlagene Konverterlauf wurde separat unter `/tmp` erhalten. Parallel entstandene iPhone- und Summary-Änderungen anderer Arbeit wurden erhalten. Kein Commit erstellt.

## Player-Bedienung, Entdecken und Audio, 8. Oktober 2026

Build **1.0 (4)** ist signiert als Release auf **SrTan** installiert (`devicectl`, abschließende Installationssequenz 2792 nach Audio-Fix); die Geräte-App-Liste bestätigt Version und Build. `DiscoveryMenu.js`, `PlayerRect.js` und `WebViewLinks.js` im installierten Build waren bytegleich mit den geprüften Quellen. `UIBackgroundModes` enthält `audio`. Bildschirm-/Audioübertragung zum Mac bleibt aus. Die App wurde nach dieser Installation nicht automatisch in den Vordergrund geholt.

- Freie, bekannte Videoflächen schalten nur YouTubes vorhandene Steuerung über dessen `player-controls-a11y-toggle` um. Echte Buttons und Regler bleiben eigene Ziele. Fehlt der entsprechende YouTube-Schalter, wird die unbekannte Oberfläche nicht abgefangen. Grundlage war die aktuelle mobile YouTube-Implementierung, deren Oberflächen-Klickpfad Play/Pause auslösen kann.
- Miniplayer: eigener sichtbarer Play/Pause-Knopf mit 44-Punkt-Touchfläche und VoiceOver-Aktion. Die Anzeige folgt gemeldeter Wiedergabe. Explizite Play/Pause-Aufträge sind auf die aktuelle Video-ID begrenzt. Der Pfeil verkleinert jetzt auch pausierte Videos; nur X schließt.
- Native Drags deaktivieren nicht mehr die ganze WebView-ScrollView und erkennen sich nicht gleichzeitig mit WebKit-Tipps. Reglerbereiche/Miniknöpfe sind geschützt. Rest-Klicks am Ende eines nativen Drags werden kurz abgefangen; ein neuer bewusster Touch hebt diese Sperre auf. Touch-Ende/-Abbruch bleibt für YouTubes eigene Timer durchlässig. Kein automatisches Wiederstarten pausierter Videos.
- Interaktives Wischen vom linken Bildschirmrand verkleinert den sichtbaren Player unter dem Finger; Abbrechen federt zurück. Bei außerhalb des sichtbaren Bereichs liegendem Video bleibt der sichere Scroll-zum-Player-Pfad. Feed-Historie nutzt weiterhin WebKits interaktives Zurückwischen. Offene YouTube- und Entdecken-Blätter sperren konkurrierende Gesten.
- `DiscoveryMenu.js` läuft nur in Feeds. Kompass im Seitenfluss unter der Themenleiste, Themen/Medien, Mediathek, Mitgliedschaften, offizielle Dienste sowie Hilfe/Impressum/Info/Datenschutz. Keine dauernden DOM-Scans. Benachrichtigungen nutzen ausschließlich einen tatsächlich vorhandenen sichtbaren YouTube-Knopf; sonst zeigt das Menü einen Hinweis. Kein eigener Push-Dienst.
- `PlaybackAudioSession.swift`: `.playback`/`.moviePlayback` bei tatsächlicher gemeldeter Hauptvideo-Wiedergabe, Freigabe bei Pause/Ende/Schließen. Audio-Unterbrechungen setzen nur den internen Aktivstatus zurück; sie starten keine Wiedergabe. Zusammen mit Background-Mode sind die iOS-Voraussetzungen gesetzt. YouTube/WebKit kann die Wiedergabe weiterhin selbst stoppen.

Prüfung: **172/172 Tests bestanden** (`/tmp/langform-player-final-tests.log`), signierter optimierter Release-Build erfolgreich (`/tmp/langform-player-final-build.log`). Der zusätzliche Audio-Regressionstest führt den Versand-Swift-Code mit einer simulierten Plattform-Session aus: `isBusy` beim Deaktivieren bedeutet laut Apple trotzdem inaktiv und darf die spätere Reaktivierung nicht überspringen. Vor dem Fix rot, danach grün; andere Fehlerzustände bleiben korrekt retrybar. Das Entdecken-Menü wurde zusätzlich in einer synthetischen 402×874-Browser-Testansicht geöffnet/geschlossen und visuell geprüft; das ist kein Nachweis seiner Darstellung auf dem echten YouTube-Feed des iPhones. Lokale Testansicht und Server wurden danach beendet. Die Frage, ob das iPhone für Bedienungstests frei ist, blieb unbeantwortet. Deshalb sind Tap/Drag/Edge-Gesten und Sperrbildschirmton dieses Builds noch **nicht am Gerät verifiziert**; frühere Gerätetests betreffen ältere Builds.

Offen, in dieser Reihenfolge:

1. Am entsperrten freien SrTan freie Videotipps vs. Play-Knopf, Mini-Play/Pause, mehrfaches Ziehen, Edge-Swipe/Abbruch, Menüs und Sperrbildschirmton prüfen. Tonübertragung zum Mac dabei aus lassen. Falls Device Hub beim Öffnen automatisch teilt, Übertragung sofort wieder beenden.
2. Neue Videoaufrufe sind weiterhin echte WKWebView-Navigationen. Ein schnellerer YouTube-interner SPA-Wechsel wurde recherchiert, aber nicht eingebaut: Vorher braucht es einen zuverlässigen Bereitschafts-/Video-ID-Abgleich, damit nicht das vorherige Video unter der neuen Adresse sichtbar wird. Keine neue Ladezeitmessung und keine Gleichheit mit der nativen YouTube-App behaupten.
3. Offline-Videodownloads sind in der bisherigen WebView-Architektur **nicht implementiert**. `WKDownload` für eine Datei ist noch keine Offline-YouTube-Wiedergabe. Keine Stream-Extraktion oder Schein-Download-Oberfläche hinzugefügt. Eine belastbare Lösung benötigt einen gesonderten Architektur- und Geräteversuch.
4. Benachrichtigungen hängen weiter von der Oberfläche des eingeloggten YouTube-Kontos ab; keine eigene Nachrichten-Inbox oder Push-Integration vorhanden.

Parallel entstandene Safari-Änderungen wurden erhalten. Kein Commit und kein erneutes Safari-Deployment in diesem Durchlauf.

## Ladebeginn, Ziehgesten und Kapitel, 8. Oktober 2026 – Build 5

Neuer Nutzerbericht nach Build 4: Videoaufrufe bleiben langsam, Ziehen wird teilweise ignoriert/stockt, Wiedergabe pausiert unerwartet; Kommentare und Kapitel sollen sich stärker an der Original-YouTube-App orientieren.

**1.0 (5)** signiert als Release gebaut und ausschließlich auf **SrTan** installiert (`devicectl`, abschließende Sequenz **2808** nach Overlay-Korrektur). Geräte-App-Liste bestätigt Build 5. Prozessstart erfolgreich; direkter Gerätescreenshot `/tmp/langform-build5-device.png` zeigt die geladene Langform-Startseite mit Kurzfassungsbuttons und den drei Haupttabs. Die eingebetteten `PlayerRect.js`, `WebViewLinks.js`, `page-captions.js` und `summary.js` wurden bytegleich mit dem geprüften Quellstand verglichen. ProMotion-Freigabe und Audio-Backgroundmode bleiben im Bundle.

Umgesetzt:

- Ein frisches, bestätigtes Dokument mit dekodiertem Video kann den Player vor dem vollständigen WK-Ladeende freigeben. Die zusätzliche feste 1,5-s-Wartezeit des Body-Fallbacks entfällt. Alte Navigationen dürfen den neuen Commit-/Readinesszustand nicht überschreiben. Kein gemessener realer Sekunden-/FPS-Vergleich zur YouTube-App.
- `PlayerGesturePolicy.swift` ist die tatsächlich verwendete Richtungs-/Abschlusslogik: natürliche diagonale Abwärtsbewegung, Aufwärtsziehen aus dem ruhenden Miniplayer, Greifen während einer Federbewegung und Abbruch zur Ausgangsposition. Der Touchbeginn während einer Feder bleibt gültig, auch wenn die Feder vor Pan-Erkennung endet. Ein vorher geöffnetes Kommentar-/Kapitelblatt blockiert die native Aufwärtsgeste im Mini nicht mehr; im großen interaktiven Player bleibt die Overlay-Sperre erhalten, auch bei verspäteten Overlaymeldungen. Der 44-Punkt-Scrubberbereich wird nur am ruhenden großen Player geschützt; Mini-Knöpfe bleiben eigene Ziele.
- Freie Videoflächen verfolgen Touchbewegung/-Abbruch direkt in JS. Der Restklick eines Drags kann deshalb bereits vor einer verspäteten nativen Bridge-Meldung verworfen werden. Echte Controls sind ausgenommen; Touch-Ende/-Abbruch bleibt für YouTube selbst erhalten. Keine automatische Wiederaufnahme der Wiedergabe.
- Eine Geometriemeldung ohne Videoknoten ist kein Pausebeleg mehr: Sie setzt weder den Play/Pause-Zustand noch die Audiositzung auf inaktiv. Schließen/Stop und tatsächliche Playbackmeldungen behalten ihre Wirkung.
- Innere Kommentar-/Kapitel-/Menüscrolls, die das Video nicht bewegen, lösen keine PlayerRect-Messung und keine 160-ms-Sperre der Playbackmeldungen aus. Kapitel-/AirPlay-Geometrie bleibt beim inneren Scrollen ebenfalls unberührt (Regressionstest: vorher 8, jetzt 0 zusätzliche Player-Messungen).
- Overlay-Erkennung durchsucht bei Klicks in bekannten Sheets nicht mehr das ganze Dokument; nachgeladene Kommentar-Unterbäume werden übersprungen. Die Kurzfassungslogik überspringt Kommentarzweige und deren innere Scrolls, erfasst aber weiter echte Videokarten in anderen Sheets.
- Eigenes Kapitelblatt: Öffnen 240 ms, Schließen 200 ms, nur Transform/Opacity; Reduce Motion unmittelbar. Mindestens 72px hohe Zeilen, deutliche aktive Markierung, gezielte Positionierung nur innerhalb der eigenen Liste, lazy/async Thumbnails, Schutz vor doppeltem Seek und schnellem Wiederöffnen. Die von YouTube selbst bereitgestellten Kapitel-/Kommentar-Sheets werden nicht ersetzt.

Ein experimenteller vollständiger SPA-Watch-Wechsel ist implementiert, aber **standardmäßig AUS**. Nur Prozess-Environment `LANGFORM_PLAYER_SPA=1` aktiviert den Versuch für einen gezielten Gerätetest. Er braucht Request-Token, Ziel-ID, Router-Start/-Ende, echte Player-Video-ID, neue Mediengeneration und neuen Frame; ohne Start nach 0,35 s bzw. Readiness nach 1,8 s einmaliger vollständiger Ladefallback. Nicht als ausgelieferte Ladebeschleunigung verkaufen. Erst nach einem echten Geräteversuch aktivieren; normale Starts benutzen weiterhin den vollständigen Dokumentwechsel.

Verifikation: **187/187 Node-Tests bestanden**, einschließlich 32 Erwartungen im ausgeführten Produktions-Swift für Gesten. `/tmp/langform-fluid-tests.log`; signierter Release-Build `/tmp/langform-fluid-build.log`, keine Compilerfehler, nur die bekannte AppIntents-Metadatenwarnung. Ein alter Exact-Payload-Test wurde an die zusätzlichen Readiness-Felder angepasst; danach gesamter Testsatz grün. `git diff --check` sauber. Lokale 402×874-Kapitelvorschau mit echtem UI-Skript und fiktiven Inhalten geprüft: Auswahl bei 4:09 und 11:04, Wiederöffnen zeigt das aktuelle Kapitel, Video darüber bleibt stehen. Kein Audio/Netzwerk in der Vorschau; Tab und lokaler Server danach geschlossen.

Gerätegrenze: Original-YouTube-App mit pausiertem Miniplayer wurde direkt auf SrTan gesehen. Der Nutzer bestätigte ausdrücklich, dass Mac **und** iPhone entsperrt sind. Trotzdem scheiterten alle Koordinatentipps/Drags von Computer Use mit `noWindowsAvailable`; AX-Menüaktionen und Screenshots funktionierten. Neue Bindung, Fenster-Raise, kompakte Ansicht, Runtime-Reset und erneuter Versuch nach Nutzerbestätigung änderten dies nicht. Deshalb kein vollständiger Vergleich von Original-Kommentar-/Kapitelgesten, keine neue Wischprüfung in Langform und kein Nachweis, dass alle zufälligen Pausen verschwunden sind. Nicht mehr als durchgeführten Gerätetest ausgeben. Device-Hub-Übertragung wurde nach jedem Versuch beendet; abschließend zeigt sie wieder „View Screen“, kein weitergeleiteter Mac-Ton. Kein Simulator gestartet, keine globale Mac-Lautstärke geändert.

Nächster sinnvoller Schritt bleibt die reale Bedienungs- und Ladezeitprüfung, sobald die Koordinatensteuerung wieder funktioniert. Downloads und eigenständige Nachrichten/Push-Funktionen sind durch diesen Durchlauf nicht implementiert. Parallel vorhandene Safari-Arbeit bleibt erhalten; kein Safari-Deployment und kein Commit durch diesen Durchlauf.

## Build 6 – Übergabe an Sol und Abschluss (8. Oktober 2026)

Der Nutzer hat während der laufenden Arbeit zusätzlich gemeldet, dass Drehen des iPhones den Player kaputt macht, und danach ausdrücklich um Weiterarbeit mit **Sol** gebeten. Sol hat den Stand übernommen und **1.0 (6)** nach dem Rotationsnachtrag erfolgreich auf SrTan installiert; die endgültige Verifikation folgt unten. Ein neuer Chat ist für diese Reparatur nicht nötig.

Bereits implementiert und vor dem Rotationsnachtrag mit **220/220 Tests** sowie signiertem Release-Build geprüft (`/tmp/langform-build6-tests.log`, `/tmp/langform-build6-build.log`):

- `PlaybackQuality.js`: vor allen anderen Player-Skripten. Löscht nur die alte lokale/session `yt-player-quality`-Wahl für neue Watch-Dokumente. Adaptive Range mit Start-Cap 720p, Mobilfunk/teuer 480p, Datensparmodus 360p; Minimum auto. Nach 20 Sekunden stabiler Wiedergabe und mindestens 12 Sekunden Puffer schrittweise bis1080p auf WLAN/Kabel bzw720p mobil. Anhaltendes Buffering über1500ms senkt eineStufe; keine Play/Pause/Seek/Reload-Aufrufe. Manueller aktuellerVideo-Wert wird respektiert, einschließlich derselben Cap: transparenter Wrapper erkennt externe Range(c,c)-Aufrufe, eigene Range(auto,cap) ausgenommen. Dies ist im echten offiziellen Mweb-Menümodul Nxd3uf belegt (`/tmp/langform-public-quality-menu.js:1953`). Die alte IFrame-setPlaybackQuality-Funktion ist dagegen tatsächlich noop. Feature-detected Range-Funktion im aktuellen `/tmp/langform-public-player-base.js` ist wirksam; tatsächliche iPhone-Auflösung noch nicht verifiziert. 11 gezielte Quality-Tests grün.
- `NetworkQualityMonitor.swift`: native NWPathMonitor-Hinweise online/expensive/constrained/interface, keine erfundene Bandbreite. Snapshot bei DocumentStart und Commit, deduplizierte Änderungen. Native Script-Registrierung: `playerEarlyScriptNames=[PlaybackQuality]`, gemeinsame Skripte, `[PlayerRect,CommentsMotion]`.
- `PlayerRect.js`: playbackState + playbackIssue, explizites __langformPlay (kein Toggle), abgelehnte Promises und3sStart-/Bufferingdeadline sichtbar. Kein Auto-Retry. `stalled` allein erzeugt bei vorhandenem Puffer keinen falschen Ladezustand. Tatsächliches video.error wird auch ohne error-Event als media-error gemeldet.
- `PlayerStartupStatus.swift` + native UI: separater44pt Start/Retry-Knopf im großen Player für unstarted/failed, Spinner fürBuffering. Fataler Medienfehler bietet ausdrücklich Neu laden. FehlendesMedium nach10s sichtbarem Expanded imVordergrund ebenfalls expliziterReload; Timerstop beiBackground, Ticket/VideoID-gebunden. Keine Play-/Reload-Schleife. KeineControls über offenenSheets/Mini/Drag.
- `CommentsMotion.js` + WebViewLinks-Hook: echte Mweb-Kommentare sind `ytm-engagement-panel`, nicht nur bottom-sheet-container. Nachgewiesen aus öffentlichem Modul `/tmp/langform-public-comments-module.js`, Kommentar-Renderer via comment-item-section/continuationUrl/ytm-comments-header-renderer. Eintritt280ms, X-Austritt200ms transform/opacity; Original-X-Befehl wird danach genaueinmal ausgeführt. BestehendeYT-Headerdrags bleiben. ReduceMotion, schnelleReopens, verspätete tiefeHydration, Rendererwechsel getestet. NeuePanels sperren nativeGesten korrekt.
- QA der Kommentare in lokaler402×874-Browserfixture erfolgreich (Öffnen/X/raschesWiederöffnen/ReduceMotion); Screenshot `/tmp/langform-build6-comments-preview.png`, Fixture `/tmp/langform-comments-visual/index.html`. **Keine echte iPhone-UI-Verifikation.** Vorschautab geschlossen, Viewportreset, HTTP-Server beendet.

**Rotation ergänzt und im abschließenden Gesamtlauf/Release-Build enthalten:**
- Agent `/root/player_bridge_review` ist fertig/frozen: PlayerRect meldet viewportWidth/viewportHeight, Dedup enthältMaße; resize/orientationchange/visualViewport/fullscreenchange/webkitfullscreenchange/player-fullscreen-change messen gebündelt im nächstenrAF trotzScroll-Deferral. Keine Wiedergabe-/Zeit-/DOM-Änderung. 39/39 gezielteTests grün (`/tmp/langform-rotation-player-tests.log`). Tests/app-views und player-scripts angepasst.
- Agent `/root/native_motion` fertig/frozen; 9 fokussierte Tests grün. Implementiert in YouTubeWebView.swift + neuer PlayerViewportPolicy.swift: Boundswechsel stoppt alte Animator-/Gestenzustände, erhält den gewählten großen oder kleinen Modus, verwirft alte videoRect/pendingRect und misst neu. Viewportgeneration verhindert veraltete Callbacks; Breite/Höhe verwerfen verspätete alte Orientierungsgeometrie. Status/Audio bleiben unabhängig. Erste frische Mini-Geometrie ohne zweite Crop-Feder. 16:9-Fallback passt auch ins Querformat. Sol hat die native und JS-Rotationslogik sowie Quality/PlaybackStatus quergelesen; daraus ergaben sich keine weiteren konkreten Codekorrekturen.
- Agent `/root/web_performance` fertig/frozen. Keine weiterenEdits erwartet.

Gesamttests und signierter Release-Build wurden nach allen Rotationsänderungen erneut abgeschlossen; Installation und autorisierter Launch per `devicectl` sind bestätigt. AppID `de.ipekkaya.langform`; Buildbefehl siehe `scripts/deploy-iphone.sh`, Release in DerivedData außerhalb des Desktops. Ausschließlich SrTan `00008160-001234D11440000A` wurde verwendet.

CUA-Blocker weiterbestehend: Mac undiPhone bestätigtentsperrt, devicectl lockState bestätigt. AX-Aktionen undScreenshots funktionieren, jederKoordinatenklick liefert `Computer Use server error -10005: noWindowsAvailable`, auchnachRecovery. Eingezielter neuerVersuch bliebgleich. NichterneutEntsperrenfragen, keineblindendutzendVersuche. DeviceHub aktuell **View Screen**, Bildschirm-/Audioübertragung aus; Maclautstärke unverändert, keinSimulatorton. DirektesScreenshot vomNutzergerät klappt. `/tmp/langform-rotation-reported.png` zeigt aktuelleLandscape-Suchansicht (keinbewiesenerCrash); keineBildermitprivaterSuchhistorieungefragtveröffentlichen.

`ios/Langform/README.md` enthält jetzt auch Rotation sowie den abschließenden Installations-/Prüfstand. Fremde Safari-Änderungen wurden erhalten, keine Safari-Installation, kein Commit/Push.

### Endgültige Verifikation durch Sol

- **224/224 Node-Tests bestanden**, keine Fehler, keine ausgelassenen Tests: `/tmp/langform-build6-sol-tests.log`. Dieser Lauf enthält den Rotationsnachtrag und die ausführbaren Swift-Tests.
- **Signierter optimierter Release-Build erfolgreich**: `/tmp/langform-build6-sol-build.log`. Keine Compilerfehler; einzig die bekannte AppIntents-Metadatenwarnung ohne Framework-Abhängigkeit. `codesign --verify --deep --strict` erfolgreich, `git diff --check` sauber.
- Bundle bestätigt **1.0 (6)**, `CADisableMinimumFrameDurationOnPhone=true`, `UIBackgroundModes=[audio]`. `PlaybackQuality.js`, `PlayerRect.js`, `CommentsMotion.js`, `WebViewLinks.js`, `DiscoveryMenu.js`, `ShortsBootstrap.js` und alle sieben geladenen Extension-Skripte wurden im anschließend installierten Bundle bytegleich mit den Quellen verglichen.
- Installation **erfolgreich**, Sequenz **2840**: `/tmp/langform-build6-sol-install.json`. Geräte-App-Liste bestätigt Version **1.0**, Bundle-Version **6**: `/tmp/langform-build6-sol-app.json`. Launch erfolgreich: `/tmp/langform-build6-sol-launch.json`, PID **29957**; derselbe Prozess war nach den Orientierungswechseln weiter aktiv.
- `/tmp/langform-build6-sol-running.png` zeigt die geladene echte Langform-Startseite, Kurzfassungsbuttons, Kompass und drei Haupttabs. `devicectl device orientation set` ermöglichte ohne Koordinatentipps einen Hoch-/Quer-/Hochformatwechsel. `/tmp/langform-build6-sol-landscape.png` und `/tmp/langform-build6-sol-portrait.png` zeigen den passend angeordneten Feed. Danach wurde die zuvor gelesene Orientierung **faceUp / landscapeLeft** wiederhergestellt. Dies belegt **keine Rotation eines geöffneten Watch-/Miniplayers**.
- Device Hub wurde für diesen Abschluss nicht geöffnet und die Bildschirm-/Audioübertragung nicht aktiviert; die zuvor beendete Übertragung bleibt aus. Keine globale Mac-Lautstärke geändert, kein Simulator verwendet.

Offene echte Gerätetests: Watch-/Miniplayer beim Drehen, freie Videotipps und Play/Pause, mehrfaches Greifen/Edge-Wischen, Kommentar-/Kapitelgesten, Start/Retry und Offline-Fehler, tatsächlich gelieferte Auflösung sowie Sperrbildschirmton. Die dokumentierte Koordinatensteuerung bleibt der Blocker dafür; keine weiteren blinden Klickversuche oder neue Entsperrfrage wurden gestellt. Keine Aussage, dass alle gelegentlichen Pausen verschwunden sind oder die App konstant 120 fps erreicht. Experimentelles SPA weiterhin standardmäßig aus.


## Priorisierter Audit und Verbesserungen – Build 7, 8. Oktober 2026

Neue Arbeit in `docs/VERBESSERUNGS_BACKLOG.md` mit Ausgangswerten, Ursachen, Abnahmen und Status. Bestehende Änderungen erhalten; kein Commit/Veröffentlichung. Signierter Release **1.0 (7)** auf ausschließlich SrTan installiert, Geräte-App-Liste bestätigt. **231/231 Node + 46/46 Web-Tests**, Web-Lint/Produktion, iOS Debug/Release, Signatur und diff-check erfolgreich.

Native Änderungen dieser Runde: lazy Player-Erzeugung erst beim `openWatch`, Feedlayout/Chrome nil-sicher; opt-in StartupDiagnostics lokal ohne private URLs/Konto-/Suchdaten. Kommentarübergang wird bei Viewport-/Keyboardresize beendet, X genau einmal; Sheet-Wrapper-Detach/Reparenting gibt Gestensperre und Observer frei. Fremdmedien: 100→0 zusätzliche Hauptvideo-Messungen. Controller/Summary: 200→100 echte Kartenabfragen bei überlappender Navigation. Beides synthetischer Shipping-Script-Nachweis, kein FPS-Versprechen. Web-App separat: Query-/ID-Races, blockierter Storage, Retry, parallele Requests, optionale Vorschläge im Hauptpfad und Refresh/Abbruch behoben, reale Produktionsbrowserflüsse geprüft.

Messungen unter `docs/qa/startup`: 3 Release-Kaltstarts pro Stand, Median Feedinhalt 1,515 → 1,469 s ab Swift-Appinitialisierung, überlappende Streuung; **keine belastbare deutlich schnellere reale Nutzbarkeit**. Native Player-Erzeugung vorher 3–4 ms, keine große Blockade; Hauptzeit im WebKit-/YouTube-Pfad. Debug Einzelproben variieren stark. Kein Cache-/Datenreset. Warm-Baseline zu früh kopiert und deshalb kein Zeitbeleg.

Geräteblocker neu geprüft: Screenshots und native Home-Aktion funktionieren, Koordinatentipps nicht zuverlässig. Übertragung danach beendet. Separater XCTest-Runner baut, Installation scheitert am Maximum von drei kostenlos signierten Apps. Keine vorhandene App entfernt, keine XCTest-Tests ausgeführt. Wiederverwendbarer separater Runner unter `ios/DeviceTests`, Haupt-App-Projekt nicht mit Testtarget umgebaut. Echte erste Watch-/Mini-/Kommentar-/Keyboard-/Rotation-/Offlineabnahme bleibt offen; Nutzer um kurzen manuellen Gerätetest gebeten.

## Zweiter Verbesserungsauftrag – Build 8

Build **1.0 (8)** ist auf **SrTan** installiert. Erster Kommentar-Eintritt beginnt an der äußeren Ladehülle und wird bei Hydration nicht erneut zurückgesetzt; in echtem lokalen Mac-WebKit geprüft. Native Playergesten greifen laufende Reveal-/Federbewegungen an ihrer sichtbaren Pose, priorisieren den Player-View-Unterbaum und verlassen bestätigtes Vollbild vor Mini. Rotation und Abbruch sind gezielt abgesichert. **297 Regressionstests**, signierte Debug-/Release-Builds und Codesign bestanden.

Drei Release-Kaltstarts pro Fassung und je eine Geräte-Profilingaufnahme durchgeführt. Keine verlässliche iPhone-Toucheingabe; deshalb Wisch-/Kommentar-/Playbackgefühl und Vergleich zur originalen App **weiter offen**, keine FPS-/Latenzbehauptung. Einzelheiten, Rohwerte und nächste Pflichtabnahme im bestehenden [Verbesserungsbacklog](docs/VERBESSERUNGS_BACKLOG.md).

## Videostart-Nachprüfung – Build 9

Zusätzliche native Ladeleiste und Ladekreis oben rechts auf ausdrücklichen Nutzerwunsch entfernt; echte Fehler behalten Erneut/Schließen. PlayerRect korrigiert veraltetes Waiting/Buffering anhand tatsächlich fortschreitender Hauptmedien, ohne Polling oder Wiedergabeänderung. Opt-in Videodiagnose trennt neue native Anfrage, Dokumentübernahme, Medium, Reveal und gemeldete Wiedergabe; diese Zeit ist kein physischer Tip-to-first-frame-Wert.

**305 Tests**, signierte Debug-/Release-Builds, Codesign und 14 gebündelte JS-Quellen geprüft. Finaler Release 1.0 (9) auf SrTan installiert (Sequenz 2932), lokale Diagnose für die ausstehende manuelle Videoreproduktion aktiv. Bisher echte Feedansicht, keine neue gemessene Videoladezeitverbesserung. Lange Wartezeit ist ausdrücklich beim Videotipp berichtet; alte Feedstartwerte beantworten sie nicht. LF-19/20/21 und offener mobiler Kapitelwechsel LF-22 im bestehenden Verbesserungsbacklog; QA unter `docs/qa/video-load-validation.json`. Keine persönlichen Daten/Apps gelöscht, kein experimentelles SPA ungeprüft aktiviert.


## Verständliche Kurzfassung nach TLDR-Vorgabe, 8. Oktober 2026

Nutzervorgabe `/Users/tanipekkaya/Downloads/tldr_vorgabe.md` gelesen und unverändert als `docs/kurzfassung-vorgabe.md` ins Projekt übernommen. Die Kurzfassung zeigt jetzt TLDR, Die wichtigsten Punkte und Das bleibt hängen; eine nötige Einordnung ist optional. Strukturierte interne Antwort: `summary {tldr, points, takeaway, caveat?, coverage?}`. Bis zu acht Punkte, keine künstliche Mindestzahl; Erklärungen werden im JavaScript nicht abgeschnitten. Alte Antworten bleiben während eines Übergangs sicher lesbar. Cacheversion `clear-tldr-1` verwirft das vorherige Punkteformat.

Safari **1.0.2 (6)** signiert gebaut und unter `~/Applications/Shorts ausblenden.app` installiert, Signatur geprüft und genau eine Plug-in-Registrierung bestätigt. iPhone **1.0 (10)** signiert gebaut und ausschließlich auf SrTan installiert; `devicectl` bestätigt Installationssequenz 2940. Die danach sofort abgefragte App-Liste war leer, deshalb kein unabhängiger Nachweis durch die App-Inventarliste. Beide gebauten `summary.js`-Ressourcen stimmen bytegleich mit der Quelle überein. App und Safari wurden nach der Installation nicht für einen neuen UI-Test gestartet/neu geladen; Nutzer muss den YouTube-Tab neu laden bzw. die iPhone-App erneut öffnen. Keine automatische Störung der laufenden Mac-Wiedergabe. Backups des vorherigen Standes: `~/Library/Application Support/Langform/backups/tldr-update-2026-10-08/`.

Das Modell bleibt Apple Foundation Models lokal. Kurze Quellen gehen vollständig ein. Lange verfügbare Untertitel werden in vollständige, geordnete Abschnitte mit Nachbarkontext zerlegt, zentrale Aussagen samt tatsächlichen Originalzitaten erfasst und gemeinsam verdichtet. Originalzitate werden gegen den Quelltext geprüft; das beweist nicht die semantische Richtigkeit aller erzeugten Aussagen. Bekannte Teilverarbeitung wird auch neben einer anderen Einordnung sichtbar gemacht. Die Caption-API liefert keine zuverlässig geprüfte Vollständigkeit des gesamten Videos; `coverage.complete` gilt nur für die Verarbeitung der verfügbaren Quelle. Optionales `sourceIncomplete` wird von Safari-Background und iOS-Bridge zum Modell durchgereicht. Fehler für fehlende, unbrauchbare, unzureichende Quelle und Modellprobleme sind getrennt. Anfangslesen bis sieben Minuten, Pipelinebudget neun Minuten, Safari-Relay bis zehn Minuten.

Die finalen drei Abschnitte werden als freier Text erzeugt und nativ in die sicheren UI-Felder geparst. Geführte Vier-Feld-Generierung, zusätzliche Review-Pässe und reine Zitatsynthese für kurze Quellen wurden mit echten Modellproben verworfen, da sie Aussagen verstärkten, doppelte Punkte erzeugten oder Kontext verloren. Der veröffentlichte Prompt entspricht `/tmp/langform-tldr-model-probe-stable.log`; die zusätzliche TLDR-Alltagswörter-Klarstellung war eine Regression und wurde zurückgenommen. Die Merksatz-Ausgabe wird auf den ersten vollständigen Satz begrenzt; bei einer späteren notwendigen Einschränkung kann dies ungünstig sein und sollte gezielt verbessert werden.

Prüfung: **263/263 Node-Tests bestanden**, einschließlich tatsächlicher Swift-Parser-/Unicode-/Quellen-/Lifecycle-Ausführung. Beide finalen Release-Builds erfolgreich, `git diff --check` sauber. Echte lokale Modellproben: kurze Busquelle rund vier Sekunden, Bedingungen und nicht zugesagte Finanzierung korrekt; Wissenschaft rund sechs Sekunden, Zahlenbasis und Labor-Einschränkung erhalten, TLDR weiterhin grob und mit Fachwort. Lange synthetische Quelle 5.878 UTF-8-Bytes, zwei von zwei Abschnitten, rund 15 Sekunden; Schlussvorbehalte erhalten, aber einzelne Aussagen wurden trotzdem stärker als die Quelle. Deshalb keine pauschale Genauigkeitszusage oder behauptete externe Faktenprüfung.

Die optionale Nutzerfrage, ob ein stärkeres Cloudmodell ergänzt werden soll oder alles lokal bleiben soll, ist bisher unbeantwortet. Kein Cloudmodell, API-Zugang oder zusätzliche Modellsoftware eingerichtet. Parallel vorhandene App-/Web-/Playeränderungen erhalten. Kein Commit erstellt.


## Safari verliert lange Kurzfassungen – behoben, 8. Oktober 2026

Die vom Nutzer gemeldete Modellmeldung wurde tatsächlich in Safari auf dem Mac gesehen. Das Apple-Modell ist verfügbar: beide aktuellen Swift-Implementierungen haben in einer echten Standalone-Probe vollständige Antworten geliefert (`/tmp/langform-summary-availability-probe.log`). Die installierte Extension war gültig signiert, Sandbox-Entitlements entsprachen dem funktionierenden Vorgänger. Kein neuer Zertifikatsfehler. Die Geräte-App-Liste bestätigt inzwischen unabhängig iPhone **1.0 (10)** auf SrTan; die unmittelbar nach dessen Installation leere Liste war kein fehlgeschlagener Installationsnachweis.

Eigentliche Safari-Ursache reproduziert: Der nicht persistente MV3-Hintergrund wird nach etwa 30 Sekunden ohne relevante Aktivität entladen. Ein ausstehendes `sendNativeMessage` und `return true` im Message-Listener verhindern das nicht. Im echten alten Video-Test begann der native Auftrag um 10:35:31 und antwortete erst um 10:37:02, während das Frontend bereits die irreführende Modellmeldung anzeigte. WebKit-Prüfung und Port-Aktivität als Primärquellen: https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Extensions/Cocoa/WebExtensionContextCocoa.mm#L2832 und https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Extensions/Cocoa/API/WebExtensionContextAPIPortCocoa.mm#L44.

Fix: Vor dem Modellauftrag öffnet das Content-Script `runtime.connect` mit `langform:summary-keepalive`. Es sendet sofort und alle 20 Sekunden einen datenlosen Heartbeat; der Hintergrund antwortet auf jeden erlaubten Ping. Gerade die ausgehende Hintergrundantwort erneuert WebKits Aktivität, ein reiner eingehender Ping genügt nicht. Absender bleiben auf die eigene Extension-ID und exakte HTTPS-YouTube-Ursprünge beschränkt. Heartbeats übertragen keine Untertitel und starten keine weiteren Modelljobs. Erfolg, Abbruch, Exception und der Zehn-Minuten-Watchdog entfernen Port, Listener und Timer. WK/iOS überspringt diesen Browser-Port.

Verbindungs-, Antwort- und native Modellfehler haben jetzt getrennte Codes und verständliche Meldungen. Native Modellunverfügbarkeit nennt konkret ausgeschaltete Apple Intelligence, noch nicht bereites Modell, ungeeignetes Gerät oder zu altes System. Das Fehlerpanel bietet „Erneut versuchen“; ein vorhandener Fehler wird nicht als erfolgreiche Antwort wiederverwendet, laufende gleiche Panelanfragen werden nicht dupliziert. Prompt und Zusammenfassungspipeline wurden in dieser Reparatur nicht geändert.

Safari **1.0.3 (7)** signiert gebaut und installiert unter `/Users/tanipekkaya/Applications/Shorts ausblenden.app`. Codesign, bytegleiche Summary-/Background-Ressourcen und genau eine Plug-in-Registrierung geprüft. Vorheriges Build6 als ZIP und `.not-registered`-Verzeichnis unter `~/Library/Application Support/Langform/backups/summary-availability-2026-10-08/` erhalten. Helper-App einmal gestartet/beendet, eigener YouTube-Testtab neu geladen. Neuer nativer Auftrag 10:43:09–10:43:42 (**33,1 Sekunden**, über der früheren Abbruchgrenze) liefert sichtbar TLDR, wichtigste Punkte und Merksatz für `Q2LbLSwb8ns`. Kein vollständiger Inhalts-Faktencheck dieser erzeugten Antwort: lokale Modellformulierungen können weiter ungenau sein. Bestehende andere YouTube-Tabs brauchen einmaliges Neuladen für den neuen Content-Code.

**294/294 Node-Tests bestanden**, darunter Swift-Verfügbarkeits-/Quellen-/Lifecycle-Tests sowie Port-/Transport-/Retry-Prüfungen. Signierter Mac-Release-Build erfolgreich, `git diff --check` sauber. Zwei Live-Caption-Tests erwarteten fälschlich die alte Modellmeldung ohne native Bridge und prüfen jetzt den richtigen Verbindungs-Code. Ein bestehender History-Test wartete nur 20 ms und war unter paralleler Last flüchtig; er wartet jetzt auf echtes `popstate` mit Testdeadline. Produktionsnavigation unverändert. Native/UI-Port-Review ohne blockierenden Befund.

Die konkreten iOS-Verfügbarkeitsmeldungen sind im Quellcode vorbereitet, **in dieser Runde nicht neu auf das iPhone installiert**; dessen aktueller installierter Stand bleibt Build10. Keine Cloud-API eingerichtet, keine Apple-Intelligence-Einstellung verändert, keine Nutzerdaten zurückgesetzt und kein Commit erstellt.


## Backlogfortsetzung – Playback/Scroll und Kapitel auf SrTan

LF-14 und LF-22 im bestehenden Backlog umgesetzt: Statusmeldungen ohne Geometrielesen während Hauptscroll, Mobile-SPA-Kapitel und alte Seek-Rückrufe identitäts-/generationsgebunden. Vorhandene TLDR-/Summary- und Xcode-Änderungen bewahrt. **340 Tests**, aktuelle signierte Debug/Release-Builds, Codesign und 14 bytegleiche JS-Dateien grün. Aktueller **1.0 (10)** auf SrTan, Sequenz **3028**, normaler Prozess **31474**, Binary SHA256 `1daf35eea4c321537718943ca3770f074a736dfa8eeda01623231c020146bb68`; Versionsnummer allein unterscheidet diesen Stand nicht von der oben historisch ebenfalls als 10 dokumentierten TLDR-Installation.

Sechs vergleichbare Release-Neustarts mit je zwei echten nativen Videoanforderungen, sieben vollständige native Play/Pause-/Mini-/Schließen-/Blank-Folgen verifiziert. Eigener Methodenplan ist kein physischer Finger-/Gestentest. Wiedergabestatus beim normalen ersten/zweiten Video im neuen Vergleichsmedian 1,984/1,669 s ab openWatch; n3, Cache-/Netz-/Übertragungsbedingungen nicht kontrolliert, kein kausaler Speedup. Tatsächlicher fortschreitender Watch-Inhalt im Gerätescreenshot. Experimenteller SPA früherer Status, aber spätere neue Bildbereitschaft; bleibt aus.

Profiler: PID-Anbindung/zu spätes Aufnahmefenster/Speicherfehler schränken die Belege ein. Keine neue echte Interaktions-FPS oder Rucklerfreiheit. Letzte Recorderdatei konnte bei vollem Mac nicht gespeichert werden; nur eigene fehlgeschlagene Ausgaben und identifizierte inaktive Kernel-Scratch-Dateien entfernt, wieder ca. 5,7 GiB frei. Kein persönliches Projekt-/Gerätedatum gelöscht. Die extern aktivierte Device-Hub-Ansicht beibehalten, App zuletzt ohne Diagnoseoption gestartet. Offene reale Abnahmen LF-19/14/15/16/17/22/06; aktualisierter [Backlog](docs/VERBESSERUNGS_BACKLOG.md), [QA und Rohmarker](docs/qa/player/README.md).


## Flüssigkeit – Build 11, 8. Oktober 2026

Auf SrTan war bei Übernahme bereits Build 10 installiert. Build **1.0 (11)** jetzt signiert installiert (Sequenz **3044**) und normal gestartet (PID **33550**, ohne Diagnoseplan). Audio-Aufrufe auf serielle Hintergrundqueue mit Unterbrechungs-Generation verlegt; alte wartende Plays dürfen nach Anruf/Reset nicht aktivieren. Feedscans pausieren durch Drag/Feder/Crop, echtes Engagement-Panel-Scroll misst den Player nicht mehr, Kapitel/AirPlay warten native Ziehgesten ab. Bestehende Feder etwas kürzer: Reveal 0,30 s, Settle 0,20–0,32 s. 296 Tests, Release, Codesign und 14 bytegleiche JS-Dateien erfolgreich.

Neue Instruments-Aufnahmen umfassen erstmals die hier ausgeführte native Acht-Schritt-Folge: beide vollständig bestätigt. Vorher zwei Main-Thread-Hänger 511/465 ms, Stacks belegen 493/462 ms synchrones Audio-Warten. Nachher nur ein potenzieller Interaktionsverzug 33,48 ms, weiterhin drei kleine 8,33–16,67-ms-Hitches. Keine globale FPS-/Rucklerfreiheitsbehauptung, keine echte Finger-/Kommentar-/Keyboardabnahme. Device-Hub-/Mirroring-Aufrufe liefen in Computer-Use-Timeouts; vorhandene Entwickler-Apps erhalten. Aktuelle QA: `docs/qa/player/build11-validation.json`, Belege im Unterordner `build11`.

Altes DerivedData verwendete einen nicht vorhandenen Signing-Fingerprint; frisches `~/Library/Developer/Xcode/DerivedData/Langform-build11` mit Automatic/Apple Development baute erfolgreich. Dort liegt der installierte Release; Binary SHA256 `152b4368ee7680a0b2a69aaf14f78da56d645729801af65e0a07f2f01d03d802`. Keine Zertifikate gelöscht, kein persistentes Signing geändert, keine Safari-Installation, kein Commit. Bestehende Änderungen und Appdaten erhalten.


## Ladezeiten und Hintergrundvorbereitung – Build 12, 8. Oktober 2026

Auf SrTan installierter finaler Release **1.0 (12)**, Sequenz **3068**, App-Inventar bestätigt, abschließend **Normalprozess33820 ohne Diagnose/Automatik/Routeroverride** gestartet. Binary SHA256 `9d1a86504d600b1682490c131560c873215c520511bbfc78f13ba1f7b3b114ea`. **298/298 Tests**, signierter Release, strenge Signatur und 14 bytegleiche JS-Ressourcen geprüft. CodeSign erforderte Freigabe am Mac durch den Nutzer; geschützte Oberfläche nicht fernbedient.

Einmalige Abo-Vorbereitung verlor beim Scrollen ihren Auftrag und konnte laufende Downloads wegwerfen. Jetzt 0,6 Sekunden Ruhe, erneutes Einplanen nach Interaktion, laufende Abos bleiben erhalten; Hintergrundinhalte werden verdeckt aufgebaut. Player-WebKit wird anschließend ohne ausgewähltes Video und mit gesperrten Medien vorbereitet. Weitere Watch-Seiten verwenden standardmäßig den bereits vorhandenen, identitäts-/framegeprüften Router. Erster Watch-Aufruf bleibt Vollnavigation. Home-SPA wurde auf dem Gerät verworfen: fünf Sekunden Stillstand vor Fallback; einmal auch erster Playbacktimeout. Die zusätzliche automatische Play-Anweisung wurde vollständig zurückgenommen.

Finaler Gerätevergleich: vier abwechselnde Starts, Standard/Vollnavigation/Standard/Vollnavigation, gleiches Binary, acht Sekunden Vorlauf, bestehende Daten/Caches, unkontrolliertes Netz. Zweites Video: Playbackbericht Median **1,611 →0,550 s**, Medien-/Frame-Bereitschaft **1,358 →0,986 s**. Vollnavigation zeigt ihre Seitenschale früher (**0,352 gegenüber0,986 s**); keine pauschale Beschleunigung jeder sichtbaren Phase behauptet. Erstes Video beim Standard weiterhin **2,71–2,84 s** bis Wiedergabebericht. Abos verdeckt aufgebaut nach **3,24–4,82 s** ab Appinitialisierung; kein gemessener physischer Abo-Tipp. Acht native Mini/Pause/Fortsetzen/Schließen-Schritte im finalen Binary bestätigt, ohne Fallback/Timeout. DeviceHub-Computer-Use erneut Timeout; keine neue Finger-/FPS-/Offline-Abnahme. Rohmarker inklusive separat ausgeschlossener Experimente und Prüfstand: `docs/qa/player/build12-validation.json`, `docs/qa/player/build12/`. Bestehende Arbeit, Anmeldung, Cache und andere Apps erhalten; kein Commit/Upload.
