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
