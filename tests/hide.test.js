const test = require("node:test");
const assert = require("node:assert/strict");
const { ns, loadDom, marked } = require("./helpers");
const hide = ns.hide;

function gone(el) {
  assert.equal(el.isConnected, false);
  assert.equal(marked(el), true);
}

function kept(el) {
  assert.equal(el.isConnected, true);
  assert.equal(marked(el), false);
}

test("Startseiten-Regal und normales Video", function () {
  const dom = loadDom("desktop-home.html");
  const doc = dom.window.document;
  const section = doc.querySelector("ytd-rich-section-renderer");
  const shelf = doc.querySelector("ytd-rich-shelf-renderer");
  const normal = doc.querySelector('a[href="/watch?v=longhome"]').closest("ytd-rich-item-renderer");
  hide.scan(doc, "https://www.youtube.com/");
  gone(section);
  gone(shelf);
  kept(normal);
});

test("gemischtes Abo-Regal behält lange Videos", function () {
  const dom = loadDom("desktop-subscriptions.html");
  const doc = dom.window.document;
  const shelf = doc.querySelector("ytd-rich-shelf-renderer");
  const shortItem = doc.querySelector('a[href="/shorts/abo1"]').closest("ytd-rich-item-renderer");
  const watchItem = doc.querySelector('a[href="/watch?v=abo2"]').closest("ytd-rich-item-renderer");
  hide.scan(doc, "https://www.youtube.com/");
  kept(shelf);
  gone(shortItem);
  kept(watchItem);
});

test("Seitenleiste, Mini-Guide und Shorts-Tab", function () {
  const dom = loadDom("desktop-sidebar.html");
  const doc = dom.window.document;
  const entries = [...doc.querySelectorAll("ytd-guide-entry-renderer")];
  const mini = [...doc.querySelectorAll("ytd-mini-guide-entry-renderer")];
  const chips = [...doc.querySelectorAll("yt-chip-cloud-chip-renderer")];
  hide.scan(doc, "https://www.youtube.com/");
  kept(entries[0]);
  gone(entries[1]);
  kept(entries[2]);
  gone(entries[3]);
  kept(mini[0]);
  gone(mini[1]);
  kept(chips[0]);
  gone(chips[1]);
});

test("Suche: Shorts weg, Erwähnung in der Beschreibung bleibt", function () {
  const dom = loadDom("desktop-search.html");
  const doc = dom.window.document;
  const videos = [...doc.querySelectorAll("ytd-video-renderer")];
  const section = doc.querySelector("ytd-item-section-renderer");
  hide.scan(doc, "https://www.youtube.com/");
  gone(videos[0]);
  kept(videos[1]);
  kept(videos[2]);
  kept(section);
});

test("verwandte Videos: Reel-Regal weg, langes Video bleibt", function () {
  const dom = loadDom("desktop-related.html");
  const doc = dom.window.document;
  const reel = doc.querySelector("ytd-reel-shelf-renderer");
  const section = doc.querySelector("ytd-item-section-renderer");
  const shorts = doc.querySelector('a[href="/shorts/rel2?feature=share"]').closest("ytd-compact-video-renderer");
  const watch = doc.querySelector('a[href="/watch?v=rel3"]').closest("ytd-compact-video-renderer");
  hide.scan(doc, "https://www.youtube.com/");
  gone(reel);
  kept(section);
  gone(shorts);
  kept(watch);
});

test("mobile Startseite, Pivot und Reels", function () {
  const home = loadDom("mobile-home.html", "https://m.youtube.com/");
  const doc = home.window.document;
  const section = doc.querySelector("ytm-rich-section-renderer");
  const reel = doc.querySelector("ytm-reel-shelf-renderer");
  const watch = doc.querySelector('a[href="/watch?v=mobil2"]').closest("ytm-video-with-context-renderer");
  const pivots = [...doc.querySelectorAll("ytm-pivot-bar-item-renderer")];
  hide.scan(doc, "https://m.youtube.com/");
  gone(section);
  gone(reel);
  kept(watch);
  kept(pivots[0]);
  gone(pivots[1]);
  kept(pivots[2]);

  const reels = loadDom("mobile-reels.html", "https://m.youtube.com/results?search_query=teig");
  const mobile = reels.window.document;
  const shortCard = mobile.querySelector("ytm-video-with-context-renderer");
  const compact = mobile.querySelector("ytm-compact-video-renderer");
  const lockup = mobile.querySelector("ytm-shorts-lockup-view-model");
  hide.scan(mobile, "https://m.youtube.com/results?search_query=teig");
  gone(shortCard);
  kept(compact);
  gone(lockup);
});

test("Links im Shadow DOM nehmen die Karte aus dem DOM", function () {
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
  gone(host);
  kept(watchHost);
});

test("aus schaltet Markierungen und das Stylesheet ab", function () {
  const dom = loadDom("desktop-home.html");
  const doc = dom.window.document;
  const shelf = doc.querySelector("ytd-rich-shelf-renderer");
  hide.applyEnabled(doc, true, "https://www.youtube.com/", false);
  assert.ok(doc.getElementById(hide.STYLE_ID));
  assert.equal(shelf.isConnected, true);
  assert.equal(marked(shelf), true);
  hide.applyEnabled(doc, false, "https://www.youtube.com/");
  assert.equal(doc.getElementById(hide.STYLE_ID), null);
  assert.equal(marked(shelf), false);
  assert.equal(shelf.style.display, "");
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

test("Kapitel bleiben stehen, der Shorts-Chip nicht", function () {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(
    `<!DOCTYPE html><body>
      <ytd-macro-markers-list-renderer id="chapters">
        <ytd-macro-markers-list-item-renderer id="row">
          <a href="/watch?v=abcdefghijk&amp;t=83s">1:23 Intro</a>
        </ytd-macro-markers-list-item-renderer>
      </ytd-macro-markers-list-renderer>
      <yt-chip-cloud-chip-renderer id="zeit" title="1:23 Intro">1:23 Intro</yt-chip-cloud-chip-renderer>
      <yt-chip-cloud-chip-renderer id="shorts" title="Shorts">Shorts</yt-chip-cloud-chip-renderer>
    </body>`,
    { url: "https://www.youtube.com/watch?v=abcdefghijk" }
  );
  const doc = dom.window.document;
  const chapters = doc.getElementById("chapters");
  const row = doc.getElementById("row");
  const zeit = doc.getElementById("zeit");
  const shorts = doc.getElementById("shorts");
  hide.scan(doc, "https://www.youtube.com/watch?v=abcdefghijk");
  kept(chapters);
  kept(row);
  kept(zeit);
  gone(shorts);
});

test("Suchformular ist keine Shorts-Steuerung", function () {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(
    `<!DOCTYPE html><body>
      <ytm-pivot-bar-item-renderer id="suche-tab" aria-label="Suche">
        <form id="suche" action="/results" method="get" role="search">
          <input id="feld" name="search_query" type="search" />
          <button id="los" type="submit" aria-label="Suche">Suche</button>
          <a href="/shorts/im-suchfeld">Kurz</a>
        </form>
      </ytm-pivot-bar-item-renderer>
    </body>`,
    { url: "https://m.youtube.com/" }
  );
  const doc = dom.window.document;
  hide.scan(doc, "https://m.youtube.com/");
  kept(doc.getElementById("suche"));
  kept(doc.getElementById("feld"));
  kept(doc.getElementById("los"));
  kept(doc.getElementById("suche-tab"));
  assert.equal(hide.isSearchControl(doc.getElementById("suche")), true);
  assert.equal(hide.isSearchControl(doc.getElementById("feld")), true);
  assert.equal(hide.isChapterUi(doc.getElementById("suche")), false);
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
  assert.match(css, /#description a/);
  assert.match(css, /macro-markers-list-renderer/);
  assert.match(css, /input\[name="search_query"\]/);
  assert.doesNotMatch(css, /movie_player|html5-video-player|player-container|object-fit/);
  assert.doesNotMatch(css, /progress-bar|ytp-chapter|video\s*\{/);
});
