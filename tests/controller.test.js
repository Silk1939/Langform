const test = require("node:test");
const assert = require("node:assert/strict");
const { ns, fixture, boot, delay, marked } = require("./helpers");
const hide = ns.hide;

test("Shorts-Adresse leitet nach dem Speicherzugriff auf die Startseite", async function () {
  const ctx = boot({
    url: "https://www.youtube.com/shorts/abc",
    enabled: true,
  });
  assert.equal(ctx.win.document.documentElement.classList.contains(hide.VEIL_CLASS), true);
  assert.deepEqual(ctx.redirects, []);
  await delay(20);
  assert.deepEqual(ctx.redirects, ["https://www.youtube.com/"]);
  assert.equal(ctx.win.localStorage.getItem(ns.logic.STORAGE_FLAG), "1");
});

test("/feed/shorts und die mobile Seite haben eigene Ziele", async function () {
  const feed = boot({ url: "https://www.youtube.com/feed/shorts", enabled: true });
  await delay(20);
  assert.deepEqual(feed.redirects, ["https://www.youtube.com/"]);

  const mobile = boot({ url: "https://m.youtube.com/shorts/handy1", enabled: true });
  await delay(20);
  assert.deepEqual(mobile.redirects, ["https://m.youtube.com/"]);
});

test("normale Watch-URL bleibt stehen", async function () {
  const ctx = boot({ url: "https://www.youtube.com/watch?v=abc", enabled: true });
  await delay(20);
  assert.deepEqual(ctx.redirects, []);
});

test("aus: keine Umleitung und kein Verstecken", async function () {
  const ctx = boot({
    url: "https://www.youtube.com/shorts/abc",
    html: fixture("desktop-home.html"),
    enabled: false,
    flag: "0",
  });
  assert.equal(ctx.win.document.documentElement.classList.contains(hide.VEIL_CLASS), false);
  await delay(20);
  assert.deepEqual(ctx.redirects, []);
  assert.equal(marked(ctx.win.document.querySelector("ytd-rich-shelf-renderer")), false);
  assert.equal(ctx.win.document.getElementById(hide.STYLE_ID), null);
});

test("veraltetes An-Flag verliert gegen den ausgeschalteten Speicher", async function () {
  const ctx = boot({
    url: "https://www.youtube.com/shorts/abc",
    html: fixture("desktop-home.html"),
    enabled: false,
    flag: "1",
  });
  const shelf = ctx.win.document.querySelector("ytd-rich-shelf-renderer");
  assert.equal(marked(shelf), true);
  assert.equal(shelf.isConnected, true);
  await delay(20);
  assert.deepEqual(ctx.redirects, []);
  assert.deepEqual(ctx.reloads, []);
  assert.equal(shelf.isConnected, true);
  assert.equal(marked(shelf), false);
  assert.equal(ctx.win.document.documentElement.classList.contains(hide.VEIL_CLASS), false);
  assert.equal(ctx.win.localStorage.getItem(ns.logic.STORAGE_FLAG), "0");
});

test("Schalter nimmt ein Regal aus dem DOM und lädt beim Ausschalten neu", async function () {
  const ctx = boot({
    url: "https://www.youtube.com/",
    html: fixture("desktop-home.html"),
    enabled: true,
  });
  const shelf = ctx.win.document.querySelector("ytd-rich-shelf-renderer");
  const normal = ctx.win.document.querySelector('a[href="/watch?v=longhome"]').closest("ytd-rich-item-renderer");
  await delay(20);
  assert.equal(shelf.isConnected, false);
  assert.equal(marked(shelf), true);
  assert.equal(normal.isConnected, true);
  assert.equal(marked(normal), false);
  ctx.storage.setEnabled(false);
  assert.deepEqual(ctx.reloads, ["https://www.youtube.com/"]);
  assert.equal(ctx.win.document.getElementById(hide.STYLE_ID), null);
  ctx.storage.setEnabled(true);
  assert.ok(ctx.win.document.getElementById(hide.STYLE_ID));
  assert.equal(normal.isConnected, true);
  assert.equal(marked(normal), false);
});

test("SPA-Navigation auf /shorts leitet um, solange der Schalter an ist", async function () {
  const ctx = boot({ url: "https://www.youtube.com/feed/subscriptions", enabled: true });
  await delay(20);
  ctx.win.history.pushState({}, "", "/shorts/neu");
  await delay(20);
  assert.deepEqual(ctx.redirects, ["https://www.youtube.com/"]);
});

test("YouTube-Navigationsereignis leitet um, bevor die Adresse wechselt", async function () {
  const ctx = boot({ url: "https://www.youtube.com/", enabled: true });
  await delay(20);
  ctx.win.dispatchEvent(
    new ctx.win.CustomEvent("yt-navigate-start", {
      detail: {
        endpoint: { commandMetadata: { webCommandMetadata: { url: "/shorts/event1" } } },
      },
    })
  );
  assert.deepEqual(ctx.redirects, ["https://www.youtube.com/"]);
});

test("aus: SPA und Navigationsereignis bleiben folgenlos", async function () {
  const ctx = boot({ url: "https://www.youtube.com/", enabled: false });
  await delay(20);
  ctx.win.history.pushState({}, "", "/shorts/still");
  ctx.win.dispatchEvent(
    new ctx.win.CustomEvent("yt-navigate-start", { detail: { url: "/shorts/event2" } })
  );
  await delay(20);
  assert.deepEqual(ctx.redirects, []);
});

test("neue Shorts-Karte verschwindet über den MutationObserver", async function () {
  const ctx = boot({
    url: "https://www.youtube.com/",
    html: fixture("desktop-related.html"),
    enabled: true,
  });
  await delay(20);
  const doc = ctx.win.document;
  const item = doc.createElement("ytd-compact-video-renderer");
  const link = doc.createElement("a");
  link.setAttribute("href", "/shorts/spa-neu");
  link.textContent = "Neu";
  item.appendChild(link);
  doc.body.appendChild(item);
  await delay(20);
  assert.equal(item.isConnected, false);
  assert.equal(marked(item), true);
  const watch = doc.querySelector('a[href="/watch?v=rel3"]').closest("ytd-compact-video-renderer");
  assert.equal(watch.isConnected, true);
  assert.equal(marked(watch), false);
});

test("geänderter href auf einen Short blendet die Karte aus", async function () {
  const ctx = boot({
    url: "https://www.youtube.com/watch?v=rel3",
    html: fixture("desktop-related.html"),
    enabled: true,
  });
  await delay(20);
  const doc = ctx.win.document;
  const link = doc.querySelector('a[href="/watch?v=rel3"]');
  const card = link.closest("ytd-compact-video-renderer");
  assert.equal(marked(card), false);
  link.setAttribute("href", "/shorts/umbenannt");
  await delay(20);
  assert.equal(card.isConnected, false);
  assert.equal(marked(card), true);
});

test("eine Watch-Seite ist ein History-Eintrag, Zurück bleibt offen", async function () {
  const ctx = boot({ url: "https://m.youtube.com/", enabled: true });
  await delay(20);
  const before = ctx.win.history.length;
  ctx.win.history.replaceState({ scroll: 480 }, "", "/watch?v=abcdefghijk");
  assert.equal(ctx.win.location.pathname, "/watch");
  assert.equal(ctx.win.history.length, before + 1);
  const onWatch = ctx.win.history.length;
  ctx.win.history.replaceState({ t: 4 }, "", "/watch?v=abcdefghijk&t=4");
  assert.equal(ctx.win.history.length, onWatch);
  ctx.win.history.pushState({ next: 1 }, "", "/watch?v=bbcdefghijk");
  assert.equal(ctx.win.history.length, onWatch + 1);
  const redirects = ctx.redirects.length;
  ctx.win.dispatchEvent(new ctx.win.PopStateEvent("popstate", { state: { scroll: 480 } }));
  await delay(30);
  assert.equal(ctx.redirects.length, redirects);
});

test("Zeitstempel desselben Videos sucht, statt zu navigieren", async function () {
  const ctx = boot({
    url: "https://m.youtube.com/watch?v=abcdefghijk",
    html: `<!DOCTYPE html><body>
      <div id="movie_player"></div>
      <div id="description">
        <a id="stamp" href="/watch?v=abcdefghijk&amp;t=83s">1:23</a>
      </div>
      <ytd-macro-markers-list-renderer id="chapters">
        <ytd-macro-markers-list-item-renderer>
          <a id="chapter" href="/watch?v=abcdefghijk&amp;t=12:04">12:04</a>
        </ytd-macro-markers-list-item-renderer>
      </ytd-macro-markers-list-renderer>
      <ytm-chip-cloud-chip-renderer id="chip" title="Intro">
        <a id="chip-link" href="/watch?v=abcdefghijk&amp;start=90">1:30</a>
      </ytm-chip-cloud-chip-renderer>
      <button id="plain" type="button">1:23</button>
      <a id="other" href="/watch?v=bbcdefghijk&amp;t=10">Anderes Video</a>
    </body>`,
    enabled: true,
  });
  await delay(20);
  const doc = ctx.win.document;
  const player = doc.getElementById("movie_player");
  const sought = [];
  player.seekTo = function (seconds) {
    sought.push(seconds);
  };
  assert.equal(doc.getElementById("chapters").isConnected, true);
  assert.equal(doc.getElementById("chip").isConnected, true);
  assert.equal(marked(doc.getElementById("chapters")), false);
  const before = ctx.win.history.length;
  const href = ctx.win.location.href;
  let heard = 0;
  doc.body.addEventListener("click", function () {
    heard += 1;
  });
  const click = new ctx.win.MouseEvent("click", { bubbles: true, cancelable: true });
  doc.getElementById("stamp").dispatchEvent(click);
  assert.equal(heard, 1);
  assert.deepEqual(sought, [83]);
  assert.equal(ctx.win.history.length, before);
  assert.equal(ctx.win.location.href, href);

  doc.getElementById("chapter").dispatchEvent(new ctx.win.MouseEvent("click", { bubbles: true, cancelable: true }));
  doc.getElementById("chip-link").dispatchEvent(new ctx.win.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.deepEqual(sought, [83, 724, 90]);
  assert.equal(ctx.win.location.href, href);

  const plain = new ctx.win.MouseEvent("click", { bubbles: true, cancelable: true });
  doc.getElementById("plain").dispatchEvent(plain);
  assert.equal(plain.defaultPrevented, false);

  ctx.win.history.pushState({}, "", "/watch?v=abcdefghijk&t=1m23s");
  assert.equal(ctx.win.history.length, before + 1);
  assert.equal(ctx.win.location.search.includes("t=1m23s"), true);
  assert.deepEqual(sought, [83, 724, 90]);

  ctx.win.history.replaceState({ t: 4 }, "", "/watch?v=abcdefghijk&start=4");
  assert.equal(ctx.win.history.length, before + 1);
  assert.equal(ctx.win.location.search.includes("start=4"), true);
  assert.deepEqual(sought, [83, 724, 90]);

  ctx.win.history.pushState({ next: 1 }, "", "/watch?v=bbcdefghijk&t=10");
  assert.equal(ctx.win.history.length, before + 2);
  assert.equal(ctx.win.location.search.includes("bbcdefghijk"), true);
  assert.deepEqual(sought, [83, 724, 90]);
});

test("replaceState derselben Watch-URL mit t=1 sucht nicht", async function () {
  const ctx = boot({
    url: "https://m.youtube.com/watch?v=abcdefghijk",
    html: `<!DOCTYPE html><body><div id="movie_player"></div><video id="v"></video></body>`,
    enabled: true,
  });
  await delay(20);
  const player = ctx.win.document.getElementById("movie_player");
  const sought = [];
  player.seekTo = function (seconds) { sought.push(seconds); };
  const before = ctx.win.history.length;
  ctx.win.history.replaceState({}, "", "/watch?v=abcdefghijk&t=1");
  assert.deepEqual(sought, []);
  assert.equal(ctx.win.history.length, before);
  assert.equal(ctx.win.location.pathname, "/watch");
  assert.equal(ctx.win.location.search.includes("t=1"), true);
});

test("Startseiten-Navigation wird nicht in ein Watch-replace umgeschrieben", async function () {
  const ctx = boot({ url: "https://m.youtube.com/", enabled: true });
  await delay(20);
  ctx.win.history.replaceState({ scroll: 20 }, "", "/watch?v=abcdefghijk");
  assert.equal(ctx.win.location.pathname, "/watch");
  const onWatch = ctx.win.history.length;
  ctx.win.history.replaceState({ page: "home" }, "", "/");
  assert.equal(ctx.win.location.pathname, "/");
  assert.equal(ctx.win.location.search, "");
  assert.equal(ctx.win.location.hostname, "m.youtube.com");
  assert.equal(ctx.win.history.length, onWatch);

  ctx.win.history.pushState({}, "", "/watch?v=abcdefghijk");
  ctx.win.history.pushState({ page: "home" }, "", "https://m.youtube.com/");
  assert.equal(ctx.win.location.pathname, "/");
  assert.equal(ctx.win.location.search, "");
  assert.equal(ctx.win.location.href, "https://m.youtube.com/");
});

test("ohne History-Eintrag geht Zurück auf die Startseite desselben Hosts", async function () {
  const mobile = boot({ url: "https://m.youtube.com/watch?v=abcdefghijk", enabled: true });
  await delay(20);
  assert.equal(mobile.win.history.length, 1);
  mobile.win.history.back();
  assert.deepEqual(mobile.redirects, ["https://m.youtube.com/"]);
  assert.equal(mobile.win.document.documentElement.classList.contains(hide.VEIL_CLASS), false);

  const desktop = boot({ url: "https://www.youtube.com/watch?v=abcdefghijk", enabled: true });
  await delay(20);
  desktop.win.history.go(-1);
  assert.deepEqual(desktop.redirects, ["https://www.youtube.com/"]);

  const home = boot({ url: "https://m.youtube.com/", enabled: true });
  await delay(20);
  home.win.history.pushState({}, "", "/watch?v=abcdefghijk");
  home.win.history.back();
  await delay(20);
  assert.equal(home.win.location.pathname, "/");
  assert.deepEqual(home.redirects, []);
});

test("Suchformular gilt nicht als Shorts-Steuerung", async function () {
  const ctx = boot({
    url: "https://m.youtube.com/",
    html: `<!DOCTYPE html><body>
      <ytm-pivot-bar-item-renderer id="suche-tab" aria-label="Suche">
        <form id="suche" action="/results" method="get" role="search">
          <input id="feld" name="search_query" type="search" value="teig" />
          <button id="los" type="submit" aria-label="Suche">Suche</button>
          <a id="im-feld" href="/shorts/suchkurz">Kurzvorschlag</a>
        </form>
      </ytm-pivot-bar-item-renderer>
      <ytm-pivot-bar-item-renderer id="shorts-tab" aria-label="Shorts">
        <a href="/shorts">Shorts</a>
      </ytm-pivot-bar-item-renderer>
    </body>`,
    enabled: true,
  });
  await delay(30);
  const doc = ctx.win.document;
  const form = doc.getElementById("suche");
  const input = doc.getElementById("feld");
  const button = doc.getElementById("los");
  assert.equal(form.isConnected, true);
  assert.equal(input.isConnected, true);
  assert.equal(button.isConnected, true);
  assert.equal(doc.getElementById("suche-tab").isConnected, true);
  assert.equal(marked(form), false);
  assert.equal(marked(input), false);
  assert.equal(marked(button), false);
  assert.equal(marked(doc.getElementById("suche-tab")), false);
  assert.equal(doc.getElementById("shorts-tab"), null);
  const heard = [];
  form.addEventListener("submit", function (event) {
    heard.push(event.defaultPrevented);
    event.preventDefault();
  });
  form.dispatchEvent(new ctx.win.Event("submit", { bubbles: true, cancelable: true }));
  assert.deepEqual(heard, [false]);
  const click = new ctx.win.MouseEvent("click", { bubbles: true, cancelable: true });
  button.dispatchEvent(click);
  assert.equal(click.defaultPrevented, false);
});

test("Startseite unten lädt die Home-URL, wenn der Knopf nichts tut", async function () {
  const ctx = boot({
    url: "https://m.youtube.com/watch?v=abcdefghijk",
    html: `<!DOCTYPE html><body>
      <ytm-pivot-bar-renderer>
        <ytm-pivot-bar-item-renderer id="home" aria-label="Startseite">
          <span id="home-label">Startseite</span>
        </ytm-pivot-bar-item-renderer>
      </ytm-pivot-bar-renderer>
    </body>`,
    enabled: true,
  });
  await delay(20);
  assert.deepEqual(ctx.redirects, []);
  ctx.win.document.getElementById("home-label").dispatchEvent(
    new ctx.win.MouseEvent("click", { bubbles: true, cancelable: true })
  );
  assert.deepEqual(ctx.redirects, []);
  await delay(400);
  assert.deepEqual(ctx.redirects, ["https://m.youtube.com/"]);
});

test("während des Scrollens bleibt die Karte, danach verschwindet sie", async function () {
  const ctx = boot({
    url: "https://www.youtube.com/",
    html: fixture("desktop-related.html"),
    enabled: true,
  });
  await delay(20);
  const doc = ctx.win.document;
  doc.dispatchEvent(new ctx.win.Event("scroll", { bubbles: true }));
  const item = doc.createElement("ytd-compact-video-renderer");
  const link = doc.createElement("a");
  link.setAttribute("href", "/shorts/scroll1");
  link.textContent = "Beim Scrollen";
  item.appendChild(link);
  doc.body.appendChild(item);
  assert.equal(item.isConnected, true);
  await delay(20);
  assert.equal(item.isConnected, true);
  await delay(200);
  assert.equal(item.isConnected, false);
  assert.equal(marked(item), true);
});
