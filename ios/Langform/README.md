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

Die App startet mit der normalen WebView-Kennung. Erscheint die Ablehnung (`disallowed_useragent`, „möglicherweise nicht sicher“, „may not be secure“, „Couldn't sign you in“, „Anmeldung nicht möglich“, „secure browsers policy“ und die verwandten Sätze, und zwar auf `accounts.google.com` oder `accounts.youtube.com`), setzt sie die Safari-Kennung von oben, merkt sich das auf dem Gerät und öffnet die YouTube-Anmeldung erneut. Eine zweite Ablehnung bleibt stehen, damit man sie sieht. Spätere Starts nutzen die Safari-Kennung sofort und öffnen wieder `https://m.youtube.com/`.

## Shorts

Beim Dokumentstart, bevor YouTube zeichnet, hängt die App dieselben Skripte wie die Safari-Erweiterung in die Seite: zuerst `early.js` mit dem Stylesheet, dann `logic.js`, `hide.js`, `controller.js`, `summary.js` und `ShortsBootstrap.js`. Die Erweiterung liest `chrome.storage`. Den Schalter gibt es in der App nicht, deshalb setzt `ShortsBootstrap.js` die Sperre fest auf an.

Das Stylesheet blendet Shorts aus, bevor sie sichtbar werden. Die Skripte nehmen danach Tab, Regale, Chips und Links aus dem DOM, auch den Eintrag in der unteren Leiste auf `m.youtube.com`. Das gilt für `www.youtube.com` und `m.youtube.com`. Der Beobachter merkt sich neue Knoten nur und arbeitet sie nach dem Scrollen ab, damit die Liste nicht ruckelt.

`/shorts`, `/shorts/…` und `/feed/shorts` gehen auf die Startseite desselben Hosts. Während der Umleitung steht dort: „Shorts sind blockiert. Weiter zur Startseite …“. Ein normales `/watch`-Video bleibt.

## Kurzfassung

Auf der Watch-Seite steht unter den Videodaten eine Kurzfassung auf Deutsch. Auf Startseite und in Feeds hat jedes lange Video einen Knopf **Kurzfassung**, der die Wiedergabe nicht startet. Der Text kommt aus den Untertiteln von YouTube. Ist die Spur schon Deutsch, wird sie genommen, eine von Hand geschriebene vor der automatischen. Sonst bittet die Seite YouTube um die Übersetzung nach Deutsch. Das Video wird nicht heruntergeladen. Ohne Untertitel steht: „Für dieses Video gibt es keine Untertitel.“ Die Kurzfassung sagt, worum es geht, nennt ein paar Punkte und das Ende. Sie liegt im Seitenfluss, mit hellem Grund, und bleibt nicht über dem Player liegen.

## Was die App nicht tut

Kein eigener Player, kein Download, kein Auslesen von Stream-Adressen, kein Werbeblocker, keine Umgehung einer Altersabfrage. Die Wiedergabe ist der Player der YouTube-Seite.
