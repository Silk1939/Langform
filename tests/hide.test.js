const test = require("node:test");
const assert = require("node:assert/strict");
const { ns, loadDom, marked } = require("./helpers");
const hide = ns.hide;

function scan(name, url) {
  const dom = loadDom(name, url);
  hide.scan(dom.window.document, url || "https://www.youtube.com/");
  return dom;
}

test("Startseiten-Regal und normales Video", function () {
  const dom = scan("desktop-home.html");
  const doc = dom.window.document;
  assert.equal(marked(doc.querySelector("ytd-rich-section-renderer")), true);
  assert.equal(marked(doc.querySelector("ytd-rich-shelf-renderer")), true);
  const normal = doc.querySelector('a[href="/watch?v=longhome"]').closest("ytd-rich-item-renderer");
  assert.equal(marked(normal), false);
});

test("gemischtes Abo-Regal behält lange Videos", function () {
  const dom = scan("desktop-subscriptions.html");
  const doc = dom.window.document;
  assert.equal(marked(doc.querySelector("ytd-rich-shelf-renderer")), false);
  const shortItem = doc.querySelector('a[href="/shorts/abo1"]').closest("ytd-rich-item-renderer");
  const watchItem = doc.querySelector('a[href="/watch?v=abo2"]').closest("ytd-rich-item-renderer");
  assert.equal(marked(shortItem), true);
  assert.equal(marked(watchItem), false);
});

test("Seitenleiste, Mini-Guide und Shorts-Tab", function () {
  const dom = scan("desktop-sidebar.html");
  const doc = dom.window.document;
  const entries = [...doc.querySelectorAll("ytd-guide-entry-renderer")];
  assert.equal(marked(entries[0]), false);
  assert.equal(marked(entries[1]), true);
  assert.equal(marked(entries[2]), false);
  assert.equal(marked(entries[3]), true);
  const mini = [...doc.querySelectorAll("ytd-mini-guide-entry-renderer")];
  assert.equal(marked(mini[0]), false);
  assert.equal(marked(mini[1]), true);
  const chips = [...doc.querySelectorAll("yt-chip-cloud-chip-renderer")];
  assert.equal(marked(chips[0]), false);
  assert.equal(marked(chips[1]), true);
});

test("Suche: Shorts weg, Erwähnung in der Beschreibung bleibt", function () {
  const dom = scan("desktop-search.html");
  const doc = dom.window.document;
  const videos = [...doc.querySelectorAll("ytd-video-renderer")];
  assert.equal(marked(videos[0]), true);
  assert.equal(marked(videos[1]), false);
  assert.equal(marked(videos[2]), false);
  assert.equal(marked(doc.querySelector("ytd-item-section-renderer")), false);
});

test("verwandte Videos: Reel-Regal weg, langes Video bleibt", function () {
  const dom = scan("desktop-related.html");
  const doc = dom.window.document;
  assert.equal(marked(doc.querySelector("ytd-reel-shelf-renderer")), true);
  assert.equal(marked(doc.querySelector("ytd-item-section-renderer")), false);
  const shorts = doc.querySelector('a[href="/shorts/rel2?feature=share"]').closest("ytd-compact-video-renderer");
  const watch = doc.querySelector('a[href="/watch?v=rel3"]').closest("ytd-compact-video-renderer");
  assert.equal(marked(shorts), true);
  assert.equal(marked(watch), false);
});

test("mobile Startseite, Pivot und Reels", function () {
  const home = scan("mobile-home.html", "https://m.youtube.com/");
  const doc = home.window.document;
  assert.equal(marked(doc.querySelector("ytm-rich-section-renderer")), true);
  assert.equal(marked(doc.querySelector("ytm-reel-shelf-renderer")), true);
  const watch = doc.querySelector('a[href="/watch?v=mobil2"]').closest("ytm-video-with-context-renderer");
  assert.equal(marked(watch), false);
  const pivots = [...doc.querySelectorAll("ytm-pivot-bar-item-renderer")];
  assert.equal(marked(pivots[0]), false);
  assert.equal(marked(pivots[1]), true);
  assert.equal(marked(pivots[2]), false);

  const reels = scan("mobile-reels.html", "https://m.youtube.com/results?search_query=teig");
  const mobile = reels.window.document;
  assert.equal(marked(mobile.querySelector("ytm-video-with-context-renderer")), true);
  assert.equal(marked(mobile.querySelector("ytm-compact-video-renderer")), false);
  assert.equal(marked(mobile.querySelector("ytm-shorts-lockup-view-model")), true);
});

test("Links im Shadow DOM blenden die Karte aus", function () {
  const dom = loadDom("desktop-home.html");
  const doc = dom.window.document;
  const host = doc.createElement("ytd-compact-video-renderer");
  const shadow = host.attachShadow({ mode: "open" });
  const link = doc.createElement("a");
  link.setAttribute("href", "/shorts/shadow1");
  link.textContent = "Versteckt";
  shadow.appendChild(link);
  doc.body.appendChild(host);

  const watchHost = doc.createElement("ytd-compact-video-renderer");
  const watchShadow = watchHost.attachShadow({ mode: "open" });
  const watch = doc.createElement("a");
  watch.setAttribute("href", "/watch?v=shadow2");
  watchShadow.appendChild(watch);
  doc.body.appendChild(watchHost);

  hide.scan(doc, "https://www.youtube.com/");
  assert.equal(marked(host), true);
  assert.equal(marked(watchHost), false);
});

test("aus schaltet Markierungen und das Stylesheet ab", function () {
  const dom = loadDom("desktop-home.html");
  const doc = dom.window.document;
  hide.applyEnabled(doc, true, "https://www.youtube.com/");
  assert.ok(doc.getElementById(hide.STYLE_ID));
  assert.equal(marked(doc.querySelector("ytd-rich-shelf-renderer")), true);
  hide.applyEnabled(doc, false, "https://www.youtube.com/");
  assert.equal(doc.getElementById(hide.STYLE_ID), null);
  assert.equal(marked(doc.querySelector("ytd-rich-shelf-renderer")), false);
  assert.equal(doc.querySelector("ytd-rich-shelf-renderer").style.display, "");
});

test("Sperrseite nennt den blockierten Zustand auf Deutsch", function () {
  const dom = loadDom("desktop-home.html");
  const doc = dom.window.document;
  hide.setVeil(doc, true);
  assert.equal(doc.documentElement.classList.contains(hide.VEIL_CLASS), true);
  assert.match(doc.getElementById("shorts-ausblenden-veil").textContent, /Shorts sind blockiert/);
  hide.setVeil(doc, false);
  assert.equal(doc.documentElement.classList.contains(hide.VEIL_CLASS), false);
});

test("CSS trifft Desktop- und Mobil-Hooks", function () {
  const css = hide.cssText();
  assert.match(css, /ytd-reel-shelf-renderer/);
  assert.match(css, /ytm-reel-shelf-renderer/);
  assert.match(css, /ytd-rich-shelf-renderer\[is-shorts\]/);
  assert.match(css, /ytm-pivot-bar-item-renderer:has\(/);
  assert.match(css, /a\[href\^="\/shorts\/"\]/);
  assert.match(css, /m\.youtube\.com\/shorts/);
  assert.doesNotMatch(css, /a\[href\^="\/shorts"\]/);
});
