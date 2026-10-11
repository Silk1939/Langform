# Langform: YouTube-UX und Motion, 9. Oktober 2026

**Detailplan zum [gemeinsamen Projektbacklog](VERBESSERUNGS_BACKLOG.md).** Aktuelle Aufgaben und ihr Status werden dort gepflegt; dieses Dokument enthält Ursachen, Umsetzung und Abnahmen der YouTube-UX. Nach jeder Feature-Arbeit beide Angaben abgleichen. Der aktuelle Fullscreen-Rückweg wird zentral als LF-33 geführt. Der dreistufige Vorschlag vom 11.10.2026 für Öffnen, Mini-Player und Dynamic Island steht bei LF-16/LF-19/LF-31 im Backlog: Schritt 1 ist freigegeben, umgesetzt und teilweise am Gerät geprüft; Schritt 2 und 3 benötigen weiterhin getrennte Freigaben nach der jeweiligen Abnahme. LF-31 war seit 10.10.2026 zurückgestellt und ist jetzt nur zur Planung wieder aufgenommen; sein automatischer Anschluss bleibt pausiert. Downloads (LF-32) bleiben zurückgestellt.

**Zusätzliche Nutzerbefunde vom 10.10.2026:** Nach gemischter Bedienung/Scrubbing und Fullscreen-/Inline-/Mini-Wechseln zeigen fünf Screenshots einen gezoomten Inline-Ausschnitt (LF-33), Seiteninhalt und Schwarzfläche im Mini (LF-16), verlorene Watch-Oberfläche (LF-42), kleines Landscape-Bild links (LF-43) sowie Fullscreen-Header/Bedienwünsche (LF-44). Zuordnung und konkrete Abnahme stehen im [zentralen Backlog](VERBESSERUNGS_BACKLOG.md) und der [Screenshot-Testmatrix](qa/player-edge-cases-2026-10-10/README.md). Der fotografierte Build ist unbekannt; Standardwechsel-Prüfungen gelten nicht als Abschluss dieser Edge-Cases.

## Historischer Stand: Build 40 auf SrTan, sechs Standard-Gerätewechsel geprüft

Build **1.0 (40)** ist installiert, Sequenz **3404**. **795 automatisierte Prüfungen** bestanden; zusätzlich 104 echte WebKit-Prüfungen über 24 wiederholte Wechsel mit dauerhaft veralteten normalen und wichtigen Autorgrößen, Portrait-Cover sowie Transform/Scroll. Alle vier Varianten verwenden denselben eingefrorenen Produktionscode wie die installierte App. Ein unabhängiger Review prüft Autorwerte, Pin-Priorität, synchrone Änderungen und Lifecycle-Cleanup. [WebKit-Nachweise](qa/motion-build40/fullscreen/result.json).

Video und Mediencontainer bleiben nach der bestätigten Rückkehr relativ zu ihrem Portrait-Rahmen; eigene Pins werden von echten Autoränderungen getrennt. Native Abbrüche planen zuverlässig Layout. Nach Nutzerfreigabe des Zeitlimits hat die zweite lautlose Produktionsfolge alle acht Player-Schritte und sechs Fullscreen-Wechsel mit 250 ms Pause beendet. 652 Bildschirmaufnahmen, 490 tatsächliche native Präsentationssamples und 445 Dokument-Geometriesamples wurden geprüft: alle sechs Rückgaben regulär bestätigt, keine Ablehnung oder Abbrüche, kein Überstand über den tatsächlichen Ausschnitt. Video und Container messen nach jeder Rückkehr 402 × 226,125; alle fünf folgenden Eintritte starten wieder von dieser Inline-Pose. Nach Freigabe bleibt das Bild unverändert. Die Zwischenbilder zeigen keine erneute breite Fläche oder zweiten Snap. [Gerätenachweis](qa/motion-build40/validation.json).

Der zuerst blockierte Zeitlimit-Versuch bleibt dokumentiert. Die erfolgreiche zweite Folge benutzt die tatsächlichen Produktionspfade programmatisch. Persönliche Fingerbedienung und neue gemischte Bedienfälle mit Spulen/Mini bleiben separat offen; die Standardfolge schließt die fünf zusätzlichen Nutzerbilder nicht ab. Aktueller Status: [LF-33 im gemeinsamen Backlog](VERBESSERUNGS_BACKLOG.md).

### Historische Geräteprüfung – Build 39

Build **1.0 (39)** ist installiert, Sequenz **3380**; **784 automatisierte Prüfungen** bestanden. Die lautlose Folge beendet alle acht Player-Schritte und sechs Fullscreen-Wechsel. Die tatsächliche Card-Präsentation stimmt bei allen sechs Rückwegen mit der nativen Bühne überein. In akzeptierten Übergaben behalten WebView und Dokument den breiten Viewport bis zur bestätigten Inline-Pose. Der frühe native Schnitt ist damit behoben. [Build-39-Prüfstand und Bilder](qa/motion-build39/validation.json).

Die vollständige Bewegung ist weiterhin nicht abgenommen: YouTube hält nach dem späteren WebView-Resize mehrfach seine alte Video-/Container-Größe von 874 × 492, obwohl der Portrait-Rahmen bereits 402 × 226 misst. Drei akzeptierte Bildübergaben brechen am natürlichen Layout-Timeout ab und zeigen anschließend die alte große Videofläche. Dadurch ist beim folgenden Öffnen schon die Inline-Ausgangspose falsch; zwei weitere Übergaben werden deshalb korrekt abgelehnt. Build 40 macht die Inline-Mediafläche dauerhaft relativ zu ihrem tatsächlich bestätigten Rahmen und plant nach jedem abgebrochenen Viewport-Hold garantiert ein Layout. Diese Korrektur wird mit wiederholten echten Gerätewechseln geprüft.

### Historische Geräteprüfung – Build 38

Build **1.0 (38)** ist installiert, Sequenz **3372**; **751 automatisierte Prüfungen** bestanden. Der lautlose Geräteablauf hat alle acht Player-Schritte und sechs Fullscreen-Wechsel mit 250 ms Pause beendet. Die 577 Bildschirmaufnahmen und 469 echten nativen Präsentationssamples zeigen: Alle sechs Eintrittsziele bleiben korrekt; der echte Rotationskoordinator ist jetzt in 243 Samples verfügbar. Der sichtbare frühe Schnitt bei der Rückkehr bleibt jedoch bestehen. [Build-38-Prüfstand und Bilder](qa/motion-build38/validation.json).

Build 39 ändert deshalb die Reihenfolge: Die WebView behält beim Zurückdrehen zunächst ihren breiten Viewport. Derselbe laufende Video-Node bewegt sich innerhalb der tatsächlichen Rotation zur geprüften Inline-Pose. Erst eine zur aktuellen Transaktion passende Bestätigung erlaubt das Verkleinern der WebView. Der native Card-Ausschnitt läuft dabei mit der Rotation mit. Die natürlichen Inline-Größen werden anschließend weiterhin über zwei stabile Frames bestätigt. Die Geräteprüfung bestätigt die native Übergabe; der dabei nachgewiesene alte YouTube-Media-Stil benötigt Build 40.

### Nutzerbefund und Ursachen – Build 37

**Aktuelle Nutzerprüfung:** Der normale Videostart ist als gut und schneller bestätigt. Fullscreen bleibt abgelehnt: Beim wiederholten Wechseln bounct die Videofläche und springt in ihre Position. Build **1.0 (37)** ist installiert, Sequenz **3364**; **733 automatisierte Prüfungen** bestanden. Stabile Endpositionen und grüne Tests sind keine Abnahme der gesamten Bewegung. [Build-37-Prüfstand](qa/motion-build37/validation.json).

Der tatsächliche Sechs-Zyklen-Geräte-Log zeigt zwei getrennte Ursachen: Beim Eintritt wird mehrfach eine noch 874 × 874 große Fläche als Ziel akzeptiert. Das Bild wächst dadurch zunächst auf 874 × 491,625 bei Y 191,1875 und schrumpft danach auf 714,667 × 402 bei Y 0. Bei der Rückkehr springen Card und WebView früh auf 402 × 874, während die sichtbare UIKit-Bühne noch rund 360 ms weiterdreht. Der bisher abgefragte Rotationskoordinator ist in allen erfassten Samples nicht verfügbar.

Build 38 validiert Root, Video und tatsächliches Contain-Bild über zwei stabile Frames, bevor die Eintrittsbewegung startet. Ein eigener View-Controller erhält den tatsächlichen UIKit-Rotationskoordinator. Die Geräteprüfung bestätigt diese beiden Korrekturen; der frühe native/WebKit-Schnitt benötigt den weiteren Build-39-Schritt.

### Historische Geräteprüfung – Build 36

Build **1.0 (36)** ist als manuell signierter Release installiert, Sequenz **3356**. **717 automatisierte Prüfungen** bestanden. Die vollständige lautlose Acht-Schritt-Gerätefolge für Mini, Pause/Fortsetzen, Expanded, Schließen und Blank ist bestanden; zusätzlich echter Produktions-Fullscreen-Eintritt und -Austritt.

Mini ist auf dem iPhone spielend, pausiert und nach Fortsetzen fotografiert: nur Video und native Bedienung, kein Titel oder mitverkleinerter Seiteninhalt. Sieben aktuelle Crop-Berichte halten die obere Videokante bei 110 CSS-Pixeln. Fullscreen hat 105 erfasste Geometrieframes: erster Eintritt gibt ohne messbaren Positionssprung frei; Austritt pinnt die laufende Bildfläche bereits vor der Rückrotation und wartet auf tatsächliche passende YouTube-Video-/Container-Größen. Die bisherige breite Zwischenpose wird verworfen. Nach der Freigabe bleiben 31 Entry- und 29 Exit-Frames unverändert; der Build-35-Sprung von rund 473 CSS-Pixeln Breite und 191 CSS-Pixeln in der Höhe fehlt.

Der diagnostische Videostart zeigt ein erstes tatsächlich präsentiertes Bild nach **1,48 s**. Das ist eine einzelne Fixture mit einem expliziten Diagnose-Start, kein normaler Fingertipp und kein allgemeiner Vorher/Nachher-Ladezeitgewinn. Die einmalige Startabsicht nach normalen Watch-Tipps wurde bereits in vier Build-34-Requests beobachtet; die neue Discovery/Thumbnail-Ladung ist lokal geprüft. Tan bestätigt den aktuellen normalen Videotipp ausdrücklich als gut und schneller; das ist eine qualitative Abnahme.

Die App ist abschließend ohne Diagnoseflags oder automatische Testfolge normal auf der Startseite geöffnet; der Header ist sichtbar. [Build-36-Prüfstand und Gerätebilder](qa/motion-build36/validation.json). Das subjektive Motion-Gefühl, tatsächliches Pull-to-refresh, sehr lange personalisierte Feeds, Such-Tastatur und Kapitelgesten bleiben eigene Fingerprüfungen. Device Hub liefert Bilder, verweigert aber weiterhin Remote-Tipps.

### Historische Build-34-Befunde und Build-35-Korrekturen

Build **1.0 (34)** war auf SrTan installiert (Sequenz **3340**) und wurde lautlos geprüft. Tan lehnt die sichtbaren Übergänge weiter ab. Die acht automatischen nativen Handlungsschritte bestehen, belegen aber nicht, dass der tatsächliche Mini-Ausschnitt oder die Animation richtig aussieht. [Dokumentierter Build-34-Befund](qa/motion-build34/validation.json).

| Aktueller Fehler | Reproduzierte Ursache | Konkrete Korrektur / Abnahme |
| --- | --- | --- |
| Mini zeigt Titel und eingebettete Bedienelemente | Beim nativen Verkleinern fällt WebKits oberer CSS-Sicherheitsabstand von 62 auf 0 pt. Das Video verschiebt sich im weiterhin gleich großen Dokument. | Die App-Fläche gibt der Webseite stabile Insets vor; Mini blendet ausschließlich YouTubes Bedienelemente aus. Echter Videoausschnitt bei Pause und Wiedergabe muss fotografisch geprüft werden. |
| Erster Fullscreen-Eintritt verändert das Bildformat | Fullscreen-CSS verschiebt den tatsächlichen Bildkasten bereits im Portrait-Tap, bevor UIKit dreht; rund 274 CSS px in der kontrollierten alten Fixture. | Derselbe Live-Video-Node hält die Inline-Pose vor der CSS-Umschaltung und übernimmt die native Drehung. Erst nach bestätigtem Layout wird die Endpose freigegeben. |
| Video lädt weiter zu lange | Neu eingefügtes Hauptvideo wird teilweise erst durch spätere Medienereignisse entdeckt. Der Thumbnail-Snapshot kann bei GPU-Feedvorschau schwarz sein. | Begrenzte DOM-Entdeckung beim Einfügen des Hauptvideos; ID-geprüftes geladenes Standbild als Posterquelle. Präsentiertes erstes Bild zusätzlich messen; keine Ladezeitersparnis ohne Live-Vergleich behaupten. |

### Historischer Build-33-Stand

## Nachprüfung nach Build 32: grundlegende Übergänge

Tans Geräteprüfung meldet weiterhin sichtbare Sprünge und lange Videostarts. Die grünen Build-32-Tests waren keine Abnahme der tatsächlichen Übergänge. Diese Runde prüft deshalb die Zwischenzustände und die Zuordnung der Ansichten:

| Rückmeldung | Ursache / nächster Schritt | Stand |
| --- | --- | --- |
| Fullscreen → Normalmodus springt | Fullscreen-CSS wurde vor der Rückrotation entfernt. Tokengebundene Übergabe hält Fullscreen bis UIKit-Abschluss und zwei passenden WebKit-Frames; Seitenfluss und Scrollposition bleiben erhalten. | Umgesetzt; falsche Zwischengeometrie vorher/nachher in WebKit geprüft. Physische Rotation offen. |
| Startseite/Abos springen beim Refresh | Snapshot wurde noch während des Rückfederns aufgenommen. Capture/Reload warten jetzt auf zwei ruhende native Frames. Neue Inhalte werden erst mit Thumbnail-Montage/Decode und stabiler Zeilengeometrie freigegeben. | Umgesetzt; Capture bei Offset 0 und 0 pt Rasterdifferenz bei Freigabe geprüft. Konkreter iPhone-Sprung offen. |
| Abo-Thumbnail wird groß und rutscht danach nach unten | Das alte Poster erschien bei y=0 und wurde danach in die Watch-Fläche verschoben. Es erscheint jetzt ausschließlich auf dem tatsächlich bestätigten Videorechteck, ohne eigene Eintrittsbewegung. | Umgesetzt; tatsächliche Playergeometrie und native Übergabe geprüft. Geräteabnahme offen. |
| Videoladen dauert weiterhin zu lange | Qualitätswahl/Storage-Bereinigung werden erst nach einem echten Video-Frame ausgeführt. Verzögertes Home-KVO darf einen neuen Watch-Load nicht mehr abbrechen. | Umgesetzt; erster Frame vor Qualitätsänderung mit realem H.264 geprüft. Live-Ladezeitgewinn nicht gemessen. |
| Suche kann im Mini-Player landen | Nur die aktuelle Watch-ID besitzt Mini-Gesten. Header-Suche, Formulare, SPA-Abgänge und Vollnavigation gehen in den Feed; überholte Suchaktivierung wird widerrufen. | Umgesetzt; Routing/Identität/Abbruch lokal geprüft. Echte Tastatur-/Suchbedienung offen. |
| **8. App nutzt die iPhone-Fläche nicht vollständig** | Stage nutzt jetzt dauerhaft den ganzen Bildschirm; YouTube-Metaviewport erhält viewport-fit=cover. Nur Header/Bedienelemente verwenden die Safe Areas. | Umgesetzt; Meta-Lifecycle und konstante Viewport-Ebene geprüft. Dynamic Island/Home-Indikator auf SrTan offen. |

Build **1.0 (33)** ist lokal gebaut und mit dem vorhandenen Zertifikat signiert. **644/644 automatisierte Prüfungen**, **141 Offline-WebKit-Prüfungen**, der native Catalyst-Refresh-Harness, strenge Signaturprüfung und **20 bytegleiche JavaScript-Ressourcen** sind bestanden. SrTan ist wieder angeschlossen. Build 33 wurde installiert, Sequenz **3332**, und lautlos im Diagnosemodus gestartet. Die Geräteprüfung läuft: Die automatische Probe blieb vor Playback am YouTube-Play-Knopf stehen; die Startseite zeigt eine falsch versetzte Filterleiste. Diese Befunde werden vor Abnahme nachgearbeitet. [Gesamter Build-33-Prüfstand](qa/motion-build33/validation.json).

**Lautlose Tests:** Künftige iPhone-Tests starten mit `LANGFORM_DIAGNOSTICS=1`. Ein vor den Seitenskripten in alle Frames injizierter Diagnosemodus hält Video/Audio bereits vor `play()` stumm. Normale Starts injizieren ihn nicht. Reale Audioausgabe ist ohne angeschlossenes Gerät nicht geprüft.

**Grenzen des Refresh-Nachweises:** Der Catalyst-Harness zeigt den bisherigen unsicheren Capture bei −80 pt und den neuen Capture bei 0 pt. Er reproduziert den sichtbaren iPhone-Sprung der alten Fassung nicht zuverlässig; 0 pt Cover-Freigabe im neuen Rastertest ist keine globale Geräteabnahme.

## Ergänzungen während der Geräteprüfung

- **9. YouTube-Spiel läuft nach Schließen im Hintergrund:** Playables sind WebGL/JavaScript-/WebAudio-Frames; die bisherige HTML-Mediensperre stoppt ihre Laufzeit nicht. Erkanntes Spiel wird vollständig aus der Ansicht entfernt; Playables-Karten/-Navigation werden vor ihrem Start abgefangen. Umgesetzt; 49 lokale Policy-/Lifecycle-Prüfungen und 7 echte WebKit-Runtime-Prüfungen bestanden. Alte Fixture läuft nach Verlassen weiter; neue Fixture zeigt gestoppte Timer und geschlossenen WebAudio-Kontext. Reales altes Spiel auf SrTan durch Prozessneustart beendet; neue Geräteprüfung folgt mit Build 34.
- **10. Videotipp muss automatisch starten:** Ein Watch-Tipp erhält einen an Request und Video-ID gebundenen initialen Play-Auftrag. Keine separate Play-Eingabe im normalen Ablauf; Pause, Anzeigen, alte Medien und neue Requests dürfen dadurch nicht wieder starten. Umgesetzt und lokal geprüft; Diagnose-Probe und echter Fingertipp werden getrennt geprüft.
- **11. Mini-Player verkleinert die ganze Watch-Seite:** Die native Interpolation begann an der gesamten Bildschirmfläche. Der Übergang wird jetzt von Beginn an auf das Video beschnitten; die unvergrößerte übrige Seite blendet kurz aus. Kommentare/Header dürfen während des gesamten Übergangs nicht mitfliegen. Umgesetzt; die tatsächliche native Crop-Geometrie ist über Zwischenzustände und Unterbrechungen geprüft. Geräteprüfung folgt mit Build 34.

- **12. Header fehlt / Filterleiste liegt falsch:** Bei der Startseite ist die Filterleiste über den sichtbaren Header versetzt. Der Safe-Area-Abstand gilt jetzt nur für sichtbare feste Leisten; ausgeblendete und statische YouTube-Zustände behalten ihre eigene Scrolllogik. 11 CSS-/Lifecycle-Fälle plus 11 echte WebKit-Geometriefälle bestanden, darunter ausgeblendeter Header und Fullscreen. Reale Headerdarstellung in Build 34 noch zu prüfen.

**Neue Fullscreen-Evidenz:** Tan bestätigt beim tatsächlich installierten Build 33 weiterhin einen sichtbaren Bildsprung. Die bisherigen fünf Offline-Exit-Checks bestehen auch in der fehlerhaften Fassung. Die neue Messung des tatsächlichen `object-fit:contain`-Bildkastens zeigt den übersehenen Sprung von der Portrait-Mitte zum Inline-Player (rund 274 CSS-Pixel in der kontrollierten Fixture). Ein durchgehender Übergang desselben Video-Nodes wird mit der nativen Rückrotation abgestimmt; erst danach erfolgt die endgültige Inline-Freigabe.

**Gerätestart:** Die unbeeinflusste automatische Build-33-Probe blieb bei `unstarted` stehen. Tan tippt YouTubes Play-Knopf und bestätigt Wiedergabe; auch `mediaReady` und `playing` sind im Gerätelog vorhanden. Das zeigt funktionierende Medienwiedergabe nach Aktion, keinen automatischen Start oder allgemeinen Ladezeitgewinn.

## Bisheriger Build-32-Plan und Prüfstand

Ausgangspunkt ist die installierte Version 1.0 (31). Die sieben folgenden Punkte stammen aus Tans Rückmeldung. Vorhandene Änderungen und die manuelle Signierung bleiben erhalten.

## Arbeitsplan und Abnahme

| Punkt | Umsetzung | Abnahmekriterium | Stand |
| --- | --- | --- | --- |
| 1. Schwarzer Bildschirm und langsamer Videostart | Getipptes Vorschaubild früh zeigen und bis zum ersten tatsächlich präsentierten Videobild halten; optionale Feedarbeit während des Ladens zurückstellen. | Kein zeitgesteuertes Entfernen des Posters vor dem Videobild; neue Video-ID verwirft alte Frames. Ladezeitgewinne nur nach Messung behaupten. | Umgesetzt; Regression grün |
| 2. Zittriger Übergang ins 16:9-Fullscreen | YouTubes konkurrierende Größenanimationen während Fullscreen ausschalten; Root/Video übernehmen eine eindeutige Viewport-Geometrie. | Ein Übergang ohne zweiten Aspect-Ratio-Tween; Hoch-/Querformat, Rückkehr, Pause und Reduced Motion prüfen. | Umgesetzt; Regression grün |
| 3. Unruhiger Startseite/Abos-Wechsel | Kurze Überblendung an derselben Position, ohne seitlichen Flug und Skalierung beider Feedflächen. | Scrollstand bleibt erhalten; erneutes Tippen/rascher Wechsel bricht die dekorative Abbildung sofort ab. | Umgesetzt; Regression grün |
| 4. Refresh leert Startseite und Abos | Sichtbaren Feed beim Neuladen als Abbildung behalten; erst nach bestätigtem neuem Feedinhalt ablösen. | didFinish allein entfernt den alten Inhalt nicht; Fehler, Timeout, Tabwechsel und neue Interaktion geben die Fläche frei. | Umgesetzt; Regression grün |
| 5. Kapitel-Zeitleiste normal und Fullscreen | Ruhige segmentierte Leiste mit klaren Lücken, rotem Fortschritt und Kapitelkontext; Kapitelzeilen besser erreichbar machen. | Gaps verdecken den Thumb nicht; native Scrub-Geste, exakter Seek, Pausezustand und dichte Kapitel bleiben erhalten. | Umgesetzt; Regression grün |
| 6. Kein Nachladen weit unten auf Startseite | Nachlade-Auslöser in Shorts-Sektionen vor Entfernen/Verbergen schützen. | Shorts bleiben verborgen, Continuation-Container sichtbar und im DOM; gemischte und reine Shorts-Seiten testen. | Ursache behoben; Regression grün |
| 7. Suche wirkt fremd | Aktuelle und ältere Suchfeld-Strukturen unterstützen; neutrales Fokusfeedback und kurzer Results-Wechsel. | Tastatur/Fokus und YouTubes Suchlogik bleiben erhalten; kein seitlicher Kartenflug, blaues Halo oder Überschwingen. | Umgesetzt; Regression grün |

## Motion-Vorgaben

Ruhig, direkt, ohne dekoratives Überschwingen. Tabs: 180 ms Überblendung ohne Größenänderung. Kleine Fokusänderungen: etwa 160 ms. Karten: höchstens 8 px Bewegung, kurze Ankunft, sofortiges Ende bei Scroll/Touch/Fokus. Ab Build 33 hat der Video-Poster keine Eintrittsbewegung und liegt ausschließlich auf der bestätigten Watch-Fläche; nach Bildbestätigung folgt eine 180-ms-Überblendung. Fullscreen-Geometrie folgt der bestätigten Übergabe zwischen UIKit und WebKit und bekommt keine zusätzliche CSS-Größenanimation. Reduced Motion, Fokus und Unterbrechungen gehören zur Umsetzung.

## Referenzen und Grenzen

Die originale YouTube-App auf SrTan wurde im Device Hub angesehen: Startseite, Abos, Suchfeld/-ergebnisse, Videostart und Fullscreen. Beobachtet wurden graue Platzhalter in den Abos, ein neutrales graues Suchfeld, das Video-Thumbnail im oberen 16:9-Bereich während die Details darunter noch Platzhalter zeigen, sowie ein stabiles zentriertes Videobild mit seitlichen Rändern im Querformat. Daraus folgt unsere Gestaltung: Kontext halten, Layout unverändert lassen und nur kurze lokale Überblendungen verwenden.

Einzelne Remote-Tipps waren unzuverlässig; Tan öffnete Fullscreen deshalb selbst. Screenshots belegen Zustände, keine exakten Animationskurven, Dauern oder Bildraten. Das geöffnete Referenzvideo hatte keine sichtbaren Kapitelmarkierungen; eine aktuelle native Kapitel-Liste wurde damit nicht geprüft. Private Such-/Kontoinhalte werden nicht als Referenzmaterial gespeichert.

YouTubes eigene [Beschreibung der Kapitel- und Suchfunktionen](https://support.google.com/youtube/answer/12825599?co=GENIE.Platform%3DiOS&hl=de) und der [Kapitel-/Fullscreen-Bedienung](https://blog.youtube/news-and-events/tips-and-tricks-watching-your-favorite-videos/) dienen als funktionale Ergänzung. Exakte aktuelle iPhone-Animationen werden daraus nicht abgeleitet.

## Prüfung und Auslieferung

Build **1.0 (32)** ist auf SrTan installiert, Sequenz **3324**, und abschließend normal ohne Diagnoseflags gestartet. **608/608 automatisierte Tests** und die native Acht-Schritt-Gerätefolge für Wiedergabe, Mini-/Expanded, Pause/Fortsetzen und Schließen sind bestanden. Echte macOS-WebKit-Prüfungen umfassen 18 Feed-/Suchfälle, 9 Continuation-/Readiness-Fälle, 9 Fälle mit lokalem H.264 und bestätigten Video-Frame-Callbacks sowie je 37 Fullscreen-/Kapitelprüfungen in Hoch- und Querformat. Das sind 110 Offline-Prüfungen; sie ersetzen keine Fingerbedienung auf SrTan.

Build 32 wird ausschließlich über `scripts/deploy-iphone.sh` mit dem vorhandenen lokalen Zertifikat und Profil gebaut, signiert und installiert. Strenge Signaturprüfung und 18 bytegleiche JavaScript-Ressourcen sind Teil des Abschlusses. Gesamter Prüfstand: [Build-32-QA](qa/motion-build32/validation.json).

## Verbleibende Geräteabnahme

- Thumbnail-Erhalt bei langsamer Verbindung, einschließlich echter Feed-/Such-Tipps. Ohne eindeutig zugeordnetes Thumbnail (etwa bei einem externen Link) gibt es keinen nativen Poster-Ausschnitt. Ein allgemeiner Ladezeitgewinn ist nicht gemessen.
- Pull-to-refresh in Startseite und Abos: tatsächlichen erhaltenen Inhalt während WebKit neu lädt sowie Übergang zum frischen Feed beobachten. Die Remote-Ziehgeste ließ sich nicht eindeutig als ausgelöster Refresh bestätigen.
- Fullscreen hinein/heraus, Kapitel-Scrubbing, Kapitel-Liste und schnelle Tabwechsel mit dem Finger prüfen; kein gemessener 120-Hz-/FPS-Nachweis.
- Ganze Displayfläche, Header, Dynamic Island, Home-Indikator und Tastatur in Hoch-/Querformat prüfen. Suche aus dem Player und aus dem Feed darf ausschließlich die Feed-Ansicht bedienen.
- Weit hinunterscrollen über mehrere echte YouTube-Seiten hinweg. Die konkrete entfernte Nachladestruktur ist korrigiert und mit echtem IntersectionObserver geprüft; ein beliebig langer personalisierter Live-Feed ist nicht durch den Offline-Test abgenommen.
