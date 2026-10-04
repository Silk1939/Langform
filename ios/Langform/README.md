# Langform auf dem iPhone

Eigene App für Tan Ipekkaya. Sie ist ein Vollbildfenster auf die echte YouTube-Seite, `https://m.youtube.com/` und, wenn YouTube dorthin wechselt, `https://www.youtube.com/`. Layout, Startseite, Suche, Abos und die Anmeldung kommen von YouTube. Langform zeichnet keinen eigenen Feed, keine eigenen Tabs und keine YouTube-Haut darüber.

Der Name auf dem Home-Bildschirm ist **Langform**. Das Symbol sind drei Balken, nicht das YouTube-Zeichen. Bundle-ID: `de.ipekkaya.langform`.

## Auf das iPhone

Voraussetzung: Xcode 27 auf dem Mac, das iPhone „SrTan“ per Kabel, Entwicklermodus an.

1. `ios/Langform/Langform.xcodeproj` öffnen.
2. Oben das Schema **Langform** und als Ziel das iPhone **SrTan** wählen.
3. Signing steht schon: Team `RFN59MUTQ3`, automatisch, nur iPhone, ab iOS 17.
4. Run (⌘R). Die App lädt `https://m.youtube.com/`.

## Anmeldung

Die Anmeldung ist die von YouTube, in derselben Ansicht. Es gibt kein Passwortfeld von Langform, keinen OAuth-Client, keine Data-API und keinen Import von Safari-Cookies.

Cookies legt WebKit im normalen `WKWebsiteDataStore` der App ab. Die Anmeldung bleibt nach dem nächsten Start erhalten. Sie gilt nur in Langform, nicht in Safari und nicht in der YouTube-App.

Tippt YouTube einen Link an, der ein neues Fenster will, lädt Langform ihn in derselben Ansicht. Andere Apps (zum Beispiel `youtube://`) werden nicht geöffnet.

### Was beim User-Agent passiert ist

Ein WKWebView meldet sich ohne `Version/` und ohne `Safari/`. Google lehnt die Anmeldung in solchen eingebetteten Ansichten oft ab, mit einem Satz wie „Dieser Browser oder diese App ist möglicherweise nicht sicher“ oder dem Kennzeichen `disallowed_useragent`.

Am 4. Oktober 2026 habe ich die YouTube-Anmeldung per HTTP abgefragt, einmal mit einer WebView-Kennung und einmal mit mobilem Safari. Ziel war `https://accounts.google.com/ServiceLogin?service=youtube&hl=de&passive=true&continue=https://m.youtube.com/`.

- WebView: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148`
- Safari: `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1`

Beide Antworten waren HTTP 200, Titel „YouTube“, ohne `disallowed_useragent` und ohne den Satz zur unsicheren App. Der Unterschied lag in den Kopfzeilen. Bei der WebView-Kennung war `object-src 'none'`, und die zusätzliche `script-src`-Liste für `apis.google.com`, `ssl.gstatic.com` und `www.google.com` fehlte. Bei der Safari-Kennung war `object-src 'self'`, und diese Liste war da. Die Ablehnungsseite entsteht oft erst im echten WKWebView, nachdem man auf Anmelden tippt. Dieser Rechner ist kein iPhone, die Ansicht selbst lief hier nicht.

Die App setzt von Anfang an die Safari-Kennung von oben, damit YouTube die mobile Seite zeichnet und nicht eine Desktop-Seite in die Handybreite quetscht. Erscheint die Ablehnung trotzdem (`disallowed_useragent`, „möglicherweise nicht sicher“, „may not be secure“, „Couldn't sign you in“, „Anmeldung nicht möglich“, „secure browsers policy“ und die verwandten Sätze, und zwar auf `accounts.google.com` oder `accounts.youtube.com`), bleibt die Safari-Kennung und die Anmeldung wird einmal neu geöffnet. Eine zweite Ablehnung bleibt stehen, damit man sie sieht.

## Zurück und der Player

Wischen vom linken Rand geht zurück, solange es einen History-Eintrag gibt. Auf einer Watch-Seite zeigt YouTube selbst den Zurück-Pfeil im Player, dort legt die App keinen eigenen Knopf darüber. Auf anderen Seiten, wenn die Wischgeste nicht reicht, sitzt ein kleiner Knopf **Zurück** unten links, über der Leiste. Ein normales `/watch` ist ein eigener Eintrag, auch wenn YouTube es mit `replaceState` über die Liste legt. Zurück landet wieder auf der vorherigen YouTube-Seite, an der alten Scrollposition.

Die Seite, auch der Player, beginnt unter der Statusleiste, wie in mobilem Safari. Die App zieht die Seite nicht mit `viewport-fit=cover` unter die Uhr. Sie setzt keine Breite, Höhe, Position oder `object-fit` auf das Video. Zeit, Untertitel und der Regler bleiben YouTubes eigene Anordnung.

## Shorts

Beim Dokumentstart, bevor YouTube zeichnet, hängt die App dieselben Skripte wie die Safari-Erweiterung in die Seite: zuerst `early.js` mit dem Stylesheet, dann `logic.js`, `hide.js`, `controller.js`, `summary.js` und `ShortsBootstrap.js`. Die Erweiterung liest `chrome.storage`. Den Schalter gibt es in der App nicht, deshalb setzt `ShortsBootstrap.js` die Sperre fest auf an.

Das Stylesheet blendet Shorts aus, bevor sie sichtbar werden. Die Skripte nehmen danach Tab, Regale, Chips und Links aus dem DOM, auch den Eintrag in der unteren Leiste auf `m.youtube.com`. Das gilt für `www.youtube.com` und `m.youtube.com`. Der Beobachter merkt sich neue Knoten nur und arbeitet sie nach dem Scrollen ab, damit die Liste nicht ruckelt.

`/shorts`, `/shorts/…` und `/feed/shorts` gehen auf die Startseite desselben Hosts. Während der Umleitung steht dort: „Shorts sind blockiert. Weiter zur Startseite …“. Ein normales `/watch`-Video bleibt.

## Kurzfassung

Auf der Watch-Seite, auf der Startseite und in Playlists hat jedes lange Video einen Knopf **Kurzfassung** unter dem Titel. Er startet die Wiedergabe nicht und sitzt nicht in der Kopfzeile neben „Alle abspielen“ oder „Zufallsmix“. Die Untertitel kommen von YouTube, über den Player-Endpunkt der Seite (`ytcfg`, auf dem Desktop der Client WEB), als json3, srv3 oder XML. Deutsch hat Vorrang, auch `de-DE`, eine von Hand geschriebene Spur vor der automatischen. Sonst bittet die Seite YouTube um die Übersetzung nach Deutsch. Ein leerer Body wird mit `fmt=json3` auf derselben URL noch einmal geholt. Das Video wird nicht heruntergeladen. Ohne Untertitel steht: „Für dieses Video gibt es keine Untertitel.“

Den Text schreibt das Modell auf dem Gerät, ohne Schlüssel und ohne Konto. Zwei oder drei Sätze, worum es geht, ein paar Punkte, dann wie es ausgeht. Keine wörtlichen Untertitel. Ist Apple Intelligence aus oder das Modell nicht da, steht ein Satz, dass es gerade nicht verfügbar ist. Dieselbe Anfrage geht in der Mac-Erweiterung über native messaging an die App „Shorts ausblenden“. Das Blatt lässt sich scrollen, die Überschrift **Schluss** bleibt lesbar. **Schließen** schließt es. Es wird nicht zu einer Zelle in der Liste.

## Was die App nicht tut

Kein eigener Player, kein Download, kein Auslesen von Stream-Adressen, kein Werbeblocker, keine Umgehung einer Altersabfrage. Die Wiedergabe ist der Player der YouTube-Seite.
