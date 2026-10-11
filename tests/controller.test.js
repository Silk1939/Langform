const test = require("node:test");
const assert = require("node:assert/strict");
const { ns, fixture, boot, delay, marked } = require("./helpers");
const hide = ns.hide;

test("blockierter Zugriff auf den localStorage-Getter verhindert den Extension-Start nicht", function (t) {
  const { JSDOM } = require("jsdom");
  const win = new JSDOM("<!DOCTYPE html><body></body>", { url: "https://www.youtube.com/shorts/blocked" }).window;
  t.after(function () { win.close(); });
  win.ShortsAusblenden = ns;
  Object.defineProperty(win, "localStorage", { get() { throw new win.DOMException("Storage denied", "SecurityError"); } });
  const redirects = [];
  assert.doesNotThrow(function () {
    ns.controller.start(win, { local: { get(_key, callback) { callback({ enabled: true }); } } }, {
      redirect(url) { redirects.push(url); },
    });
  });
  assert.deepEqual(redirects, ["https://www.youtube.com/"]);
});

test("ein später initialer Speicherstand überschreibt keine neuere Schalteränderung", function (t) {
  const { JSDOM } = require("jsdom");
  const win = new JSDOM("<!DOCTYPE html><body></body>", { url: "https://www.youtube.com/shorts/pending" }).window;
  t.after(function () { win.close(); });
  win.ShortsAusblenden = ns;
  let initialReply;
  let changed;
  const redirects = [];
  ns.controller.start(win, {
    local: { get(_key, callback) { initialReply = callback; } },
    onChanged: { addListener(listener) { changed = listener; } },
  }, { redirect(url) { redirects.push(url); } });
  changed({ enabled: { oldValue: true, newValue: false } }, "local");
  initialReply({ enabled: true });
  assert.deepEqual(redirects, []);
  assert.equal(win.localStorage.getItem(ns.logic.STORAGE_FLAG), "0");
  assert.equal(win.document.getElementById(hide.STYLE_ID), null);
});

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

test("Startseite lädt nicht neu, wenn YouTube schon selbst navigiert", async function () {
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
  const click = new ctx.win.MouseEvent("click", { bubbles: true, cancelable: true });
  ctx.win.document.getElementById("home-label").dispatchEvent(click);
  assert.equal(click.defaultPrevented, false);
  ctx.win.dispatchEvent(new ctx.win.CustomEvent("yt-navigate-start", { detail: { url: "/" } }));
  await delay(400);
  assert.deepEqual(ctx.redirects, []);
});

test("Zurück auf der Watch-Seite ist ein echtes history.back, auch in der App", { timeout: 3000 }, async function () {
  const ctx = boot({ url: "https://m.youtube.com/", enabled: true });
  await delay(20);
  ctx.win.webkit = { messageHandlers: { langformMini: { postMessage() { throw new Error("kein Miniplayer"); } } } };
  ctx.win.history.pushState({}, "", "/watch?v=abcdefghijk");
  assert.equal(ctx.win.location.pathname, "/watch");
  const navigated = new Promise(function (resolve) {
    ctx.win.addEventListener("popstate", resolve, { once: true });
  });
  ctx.win.history.back();
  await navigated;
  assert.equal(ctx.win.location.pathname, "/");
  assert.deepEqual(ctx.redirects, []);
});

test("viele neue Knoten beim ersten Laden ergeben einen gebündelten Scan", async function () {
  const ctx = boot({ url: "https://m.youtube.com/", enabled: true });
  await delay(20);
  const doc = ctx.win.document;
  const original = hide.scan;
  let wholeDocument = 0;
  hide.scan = function (rootNode) {
    if (rootNode === doc || rootNode === doc.documentElement) wholeDocument += 1;
    return original.apply(this, arguments);
  };
  try {
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 60; i++) {
        const item = doc.createElement("ytm-rich-item-renderer");
        const link = doc.createElement("a");
        link.setAttribute("href", i === 7 ? "/shorts/viele" + round : "/watch?v=aaaaaaaaa" + (i % 10) + round);
        item.appendChild(link);
        doc.body.appendChild(item);
      }
      ctx.win.history.replaceState({ round: round }, "", "/");
      await delay(5);
    }
    await delay(500);
    assert.ok(wholeDocument >= 1);
    assert.ok(wholeDocument <= 2, "ganzes Dokument " + wholeDocument + " mal");
    assert.equal(doc.querySelectorAll('a[href^="/shorts/"]').length, 0);
  } finally {
    hide.scan = original;
  }
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

test("während ein Watch-Video läuft, fasst der Shorts-Scan das DOM nicht an, das Stylesheet bleibt", async function () {
  const ctx = boot({
    url: "https://m.youtube.com/watch?v=abcdefghijk",
    html: `<!DOCTYPE html><html><body><ytm-player><video id="v"></video></ytm-player><div id="related"></div></body></html>`,
    enabled: true,
  });
  await delay(20);
  const win = ctx.win;
  const doc = win.document;
  const video = doc.getElementById("v");
  let paused = true;
  Object.defineProperty(video, "paused", { configurable: true, get: function () { return paused; } });
  paused = false;
  const hide = ns.hide;
  const original = hide.scan;
  let scans = 0;
  hide.scan = function () {
    scans += 1;
    return original.apply(this, arguments);
  };
  try {
    const item = doc.createElement("ytm-compact-video-renderer");
    const link = doc.createElement("a");
    link.setAttribute("href", "/shorts/beim-abspielen");
    item.appendChild(link);
    doc.getElementById("related").appendChild(item);
    win.dispatchEvent(new win.Event("yt-navigate-finish"));
    await delay(600);
    assert.equal(scans, 0);
    assert.equal(item.isConnected, true);
    assert.equal(marked(item), false);
    assert.ok(doc.getElementById(hide.STYLE_ID), "das Stylesheet versteckt Shorts weiter");
    assert.match(doc.getElementById(hide.STYLE_ID).textContent, /ytm-compact-video-renderer:has\([^{]*a\[href\^="\/shorts\/"\]/);

    paused = true;
    video.dispatchEvent(new win.Event("pause"));
    await delay(600);
    assert.ok(scans >= 1);
    assert.equal(item.isConnected, false);
    assert.equal(video.isConnected, true);
    assert.equal(video.getAttribute("style"), null);
  } finally {
    hide.scan = original;
  }
});

test("auch beim Einschalten während der Wiedergabe wartet der Scan", async function () {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(
    '<!DOCTYPE html><body><ytm-player><video></video></ytm-player><ytm-rich-item-renderer><a href="/shorts/later">Kurz</a></ytm-rich-item-renderer></body>',
    { url: "https://m.youtube.com/watch?v=abcdefghijk" }
  );
  const win = dom.window;
  win.ShortsAusblenden = ns;
  win.localStorage.setItem(ns.logic.STORAGE_FLAG, "1");
  const video = win.document.querySelector("video");
  const card = win.document.querySelector("ytm-rich-item-renderer");
  let paused = false;
  Object.defineProperty(video, "paused", { get: function () { return paused; } });
  ns.controller.start(win, { local: { get(_key, cb) { cb({ enabled: true }); } } });
  assert.ok(win.document.getElementById(hide.STYLE_ID));
  assert.equal(card.isConnected, true);
  assert.equal(marked(card), false);
  paused = true;
  video.dispatchEvent(new win.Event("pause"));
  await delay(30);
  assert.equal(card.isConnected, false);
  assert.equal(video.isConnected, true);
  win.close();
});

test("viele href-Änderungen derselben Karte scannen nur den geänderten Teilbaum einmal", async function () {
  const ctx = boot({
    html: '<!DOCTYPE html><body><ytm-rich-item-renderer><a href="/watch?v=abcdefghijk">Film</a></ytm-rich-item-renderer></body>',
    enabled: true,
  });
  await delay(20);
  const doc = ctx.win.document;
  const link = doc.querySelector("a");
  const original = hide.scan;
  const scanned = [];
  hide.scan = function (node) {
    scanned.push(node);
    return original.apply(this, arguments);
  };
  try {
    for (let i = 0; i < 80; i++) link.setAttribute("href", "/watch?v=abcdefghijk&t=" + i);
    await delay(40);
    assert.deepEqual(scanned, [link]);
  } finally {
    hide.scan = original;
    ctx.win.close();
  }
});

test("ein bewusster Tipp auf 0:00 springt an den Anfang des laufenden Videos", async function () {
  const ctx = boot({
    url: "https://m.youtube.com/watch?v=abcdefghijk",
    html: '<!DOCTYPE html><body><div id="movie_player"><video></video></div><a id="start" href="/watch?v=abcdefghijk&t=0">0:00</a></body>',
    enabled: true,
  });
  await delay(20);
  const doc = ctx.win.document;
  doc.querySelector("video").currentTime = 90;
  const sought = [];
  doc.getElementById("movie_player").seekTo = function (seconds) { sought.push(seconds); };
  const click = new ctx.win.MouseEvent("click", { bubbles: true, cancelable: true });
  doc.getElementById("start").dispatchEvent(click);
  assert.deepEqual(sought, [0]);
  assert.equal(click.defaultPrevented, true);
  assert.equal(ctx.win.location.search, "?v=abcdefghijk");
  ctx.win.close();
});

test("eigene Kurzfassungsknöpfe und leeres Scrollen starten keine Controller-Scans", async function () {
  const ctx = boot({
    html: '<!DOCTYPE html><body><ytm-rich-item-renderer><a href="/watch?v=abcdefghijk">Film</a></ytm-rich-item-renderer></body>',
    enabled: true,
  });
  const original = hide.scan;
  const originalPoke = ns.summary.poke;
  let ownScans = 0;
  let pokes = 0;
  hide.scan = function (node) {
    if (node.hasAttribute && node.hasAttribute("data-langform-kurz")) ownScans += 1;
    return original.apply(this, arguments);
  };
  try {
    await delay(50);
    assert.ok(ctx.win.document.querySelector("[data-langform-kurz]"));
    assert.equal(ownScans, 0);
    ns.summary.poke = function () {
      pokes += 1;
      return originalPoke.apply(this, arguments);
    };
    ctx.win.document.dispatchEvent(new ctx.win.Event("scroll", { bubbles: true }));
    await delay(220);
    assert.equal(pokes, 0);
  } finally {
    hide.scan = original;
    ns.summary.poke = originalPoke;
    ctx.storage.setEnabled(false);
    ctx.win.close();
  }
});

test("eine neue Feed-Karte prüft keine Kurzfassungen in unveränderten Karten erneut", async function () {
  const ctx = boot({
    url: "https://m.youtube.com/",
    html: '<!DOCTYPE html><body><div id="feed">' +
      '<ytm-video-with-context-renderer><a href="/watch?v=abcdefghijk">Film</a></ytm-video-with-context-renderer>'.repeat(100) +
      '</div></body>',
    enabled: true,
  });
  const doc = ctx.win.document;
  try {
    await delay(400);
    const cards = [...doc.querySelectorAll("ytm-video-with-context-renderer")];
    let oldCardReads = 0;
    for (const card of cards) {
      const query = card.querySelectorAll.bind(card);
      card.querySelectorAll = function (selector) {
        oldCardReads += 1;
        return query(selector);
      };
    }
    const fresh = doc.createElement("ytm-video-with-context-renderer");
    fresh.innerHTML = '<a href="/watch?v=zyxwvutsrqp">Neuer Film</a>';
    doc.getElementById("feed").appendChild(fresh);
    await delay(400);
    assert.ok(fresh.querySelector('[data-langform-kurz="zyxwvutsrqp"]'));
    assert.equal(oldCardReads, 0, "eine neue Karte darf nicht den gesamten bisherigen Feed erneut prüfen");
  } finally {
    ctx.storage.setEnabled(false);
    ctx.win.close();
  }
});

test("ein anfangs inaktiver Feed behält Shorts-CSS und bündelt alle Änderungen bis zum Aktivieren", async function () {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM('<!DOCTYPE html><body><div id="feed"></div></body>', { url: "https://m.youtube.com/" });
  const win = dom.window;
  const doc = win.document;
  win.ShortsAusblenden = ns;
  win.__langformFeedActive = false;
  const original = hide.scan;
  let scans = 0;
  hide.scan = function (node) {
    if (node === doc || node.ownerDocument === doc) scans += 1;
    return original.apply(this, arguments);
  };
  try {
    ns.controller.start(win, { local: { get(_key, callback) { callback({ enabled: true }); } } });
    assert.ok(doc.getElementById(hide.STYLE_ID));
    const feed = doc.getElementById("feed");
    for (let round = 0; round < 3; round++) {
      feed.insertAdjacentHTML("beforeend", '<ytm-video-with-context-renderer><a href="/watch?v=abcdefghijk">Film</a></ytm-video-with-context-renderer>'.repeat(30));
      win.dispatchEvent(new win.Event("yt-navigate-finish"));
      await delay(20);
    }
    feed.insertAdjacentHTML("beforeend", '<ytm-reel-shelf-renderer id="hidden-shorts"><a href="/shorts/shortvideo">Shorts</a></ytm-reel-shelf-renderer>');
    await delay(450);
    assert.equal(scans, 0);
    assert.equal(doc.querySelectorAll("[data-langform-kurz]").length, 0);
    assert.equal(win.__langformKurzRoots.length, 0, "keine gesammelten Kartenreferenzen im inaktiven Feed");
    assert.equal(win.__langformKurzTimer, 0);
    assert.ok(doc.getElementById("hidden-shorts"), "inaktiv reicht das Shorts-Stylesheet");
    win.__langformFeedActive = true;
    win.dispatchEvent(new win.Event("langform-feed-visibility"));
    await delay(450);
    assert.equal(scans, 1, "genau ein nachgeholter Shorts-Scan");
    assert.equal(doc.getElementById("hidden-shorts"), null);
    assert.equal(doc.querySelectorAll("[data-langform-kurz]").length, 90);
  } finally {
    hide.scan = original;
    win.close();
  }
});

test("saubere Feed-Wechsel scannen nichts; Änderungen im Hintergrund werden einmal nachgeholt", async function () {
  const ctx = boot({
    url: "https://m.youtube.com/",
    html: '<!DOCTYPE html><body><ytm-video-with-context-renderer><a href="/watch?v=abcdefghijk">Film</a></ytm-video-with-context-renderer></body>',
    enabled: true,
  });
  const win = ctx.win;
  const doc = win.document;
  const original = hide.scan;
  try {
    await delay(450);
    const card = doc.querySelector("ytm-video-with-context-renderer");
    const query = card.querySelectorAll.bind(card);
    let rowReads = 0;
    card.querySelectorAll = function (selector) {
      if (selector === "a[href]") rowReads += 1;
      return query(selector);
    };
    let scans = 0;
    hide.scan = function (node) {
      if (node === doc || node.ownerDocument === doc) scans += 1;
      return original.apply(this, arguments);
    };
    function activate(active) {
      win.__langformFeedActive = active;
      win.dispatchEvent(new win.Event("langform-feed-visibility"));
    }
    activate(false);
    await delay(20);
    activate(true);
    await delay(450);
    assert.equal(scans, 0);
    assert.equal(rowReads, 0, "ein unveränderter Tab bleibt ohne neue Kurzfassungsprüfung");

    activate(false);
    for (let round = 0; round < 3; round++) {
      card.querySelector("a").setAttribute("href", "/watch?v=zyxwvutsrqp&t=" + round);
      win.dispatchEvent(new win.Event("yt-navigate-finish"));
      await delay(20);
    }
    await delay(450);
    assert.equal(scans, 0);
    assert.equal(rowReads, 0);
    assert.equal(win.__langformKurzRoots.length, 0);
    activate(true);
    await delay(450);
    assert.equal(scans, 1);
    assert.equal(rowReads, 1, "Controller und Kurzfassung erzeugen keine doppelten Wiederaufnahme-Scans");
    assert.ok(card.querySelector('[data-langform-kurz="zyxwvutsrqp"]'));
  } finally {
    hide.scan = original;
    ctx.storage.setEnabled(false);
    win.close();
  }
});
