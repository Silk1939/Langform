const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/DiscoveryMenu.js"), "utf8");
const html = '<ytm-app class="sticky-player"><ytm-header><button id="search" aria-label="Suchen">Suche</button>' +
  '<button id="cast" aria-label="Cast">Cast</button></ytm-header><ytm-pivot-bar-renderer></ytm-pivot-bar-renderer>' +
  '<ytm-browse><section id="cards"><a href="/watch?v=abcdefghijk">Video</a></section></ytm-browse></ytm-app>';

function page(t, options = {}) {
  const dom = new JSDOM(options.html === undefined ? html : options.html, {
    url: options.url || "https://m.youtube.com/", runScripts: "outside-only",
  });
  t.after(() => dom.window.close());
  const win = dom.window;
  const doc = win.document;
  const timers = new Map();
  let nextTimer = 0;
  let queries = 0;
  const posts = [];
  const overlays = [];
  const animations = [];
  let motionChange = null;
  const reducedMotion = {
    matches: options.reducedMotion === true,
    addEventListener(name, fn) { if (name === "change") motionChange = fn; },
  };
  win.matchMedia = () => reducedMotion;
  if (options.animate) {
    win.Element.prototype.animate = function (frames, timing) {
      const animation = {
        target: this, frames, timing, cancelled: false, onfinish: null,
        cancel() { this.cancelled = true; },
        finish() { if (this.onfinish) this.onfinish(); },
      };
      animations.push(animation);
      return animation;
    };
  }
  win.__langformFeedActive = options.active !== false;
  win.webkit = { messageHandlers: options.handlers || {
    langformOpenWatch: { postMessage() {} },
    langformNavigateFeed: { postMessage(body) { posts.push(JSON.parse(JSON.stringify(body))); } },
  } };
  win.__langformSetOverlayState = (name, open) => overlays.push({ name, open });
  win.setTimeout = (fn, delay) => { timers.set(++nextTimer, { fn, delay }); return nextTimer; };
  win.clearTimeout = id => timers.delete(id);
  win.MutationObserver = class { constructor() { assert.fail("Entdecken benötigt keine dauerhafte Mutationsbeobachtung"); } };
  if (options.dialog !== false) {
    win.HTMLDialogElement.prototype.showModal = function () { this.open = true; this.querySelector("button").focus(); };
    win.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new win.Event("close")); };
  }
  const querySelector = doc.querySelector.bind(doc);
  doc.querySelector = selector => { queries++; return querySelector(selector); };
  const env = {
    win, doc, posts, overlays, timers, animations,
    reduceMotion(value) { reducedMotion.matches = value; if (motionChange) motionChange(); },
    queryCount: () => queries,
    start() {
      win.eval(source);
      doc.dispatchEvent(new win.Event("DOMContentLoaded"));
    },
    flush() {
      let count = 0;
      while (timers.size) {
        assert.ok(++count <= 10, "Montageversuche müssen begrenzt bleiben");
        const [id, value] = timers.entries().next().value;
        timers.delete(id);
        value.fn();
      }
      return count;
    },
    visibility(active) {
      win.__langformFeedActive = active;
      win.dispatchEvent(new win.Event("langform-feed-visibility"));
    },
    open() {
      doc.getElementById("langform-discovery").querySelector("button").click();
      return doc.getElementById("langform-discovery-sheet");
    },
  };
  if (options.start !== false) env.start();
  return env;
}

test("Entdecken sitzt im natürlichen Feedfluss und lässt Suche, Cast und Karten unverändert", t => {
  const env = page(t, { start: false });
  const header = env.doc.querySelector("ytm-header");
  const cards = env.doc.getElementById("cards");
  const markup = header.outerHTML;
  env.start();
  env.flush();
  const bar = env.doc.getElementById("langform-discovery");
  assert.equal(bar.parentElement.tagName, "YTM-APP");
  assert.equal(bar.nextElementSibling.tagName, "YTM-BROWSE");
  assert.equal(env.doc.querySelector("ytm-header"), header);
  assert.equal(header.outerHTML, markup);
  assert.equal(env.doc.getElementById("cards"), cards);
  assert.equal(env.doc.getElementById("langform-discovery-sheet"), null, "Menü erst auf Wunsch erzeugen");
  const barCSS = env.doc.getElementById("langform-discovery-style").textContent.match(/#langform-discovery \{([^}]+)\}/)[1];
  assert.doesNotMatch(barCSS, /position\s*:\s*(?:fixed|absolute|sticky)/);
  env.win.eval(source);
  assert.equal(env.doc.querySelectorAll("#langform-discovery").length, 1);
});

test("Langforms eindeutig benannter Entdecken-Auslöser öffnet die native Linkeingabe statt YouTubes gleichnamiger Navigation", t => {
  const nativeRequests = [];
  const env = page(t, {
    html: html.replace('<button id="cast"', '<button id="youtube-discover">Entdecken</button><button id="cast"'),
    handlers: {
      langformOpenWatch: { postMessage() {} },
      langformOpenExternalLink: { postMessage(body) { nativeRequests.push(body); } },
    },
  });
  const original = env.doc.getElementById("youtube-discover");
  let originalClicks = 0;
  original.addEventListener("click", () => originalClicks++);
  original.click();
  assert.equal(originalClicks, 1);
  assert.equal(env.doc.getElementById("langform-discovery-sheet"), null);
  const trigger = env.doc.getElementById("langform-discovery-trigger");
  assert.ok(trigger);
  assert.equal(trigger.getAttribute("aria-label"), "Entdecken-Menü öffnen");
  assert.equal(trigger.textContent, "Entdecken", "der sichtbare Text bleibt kompakt");
  assert.equal(env.doc.querySelectorAll('[aria-label="Entdecken-Menü öffnen"]').length, 1);
  trigger.click();
  const sheet = env.doc.getElementById("langform-discovery-sheet");
  assert.equal(sheet.open, true);
  const action = [...sheet.querySelectorAll("button")].find(button => button.textContent === "YouTube-Link öffnen");
  assert.ok(action, "nur das Langform-Menü enthält die native Linkaktion");
  action.click();
  assert.equal(sheet.open, false);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(nativeRequests.length, 1);
  assert.deepEqual(env.overlays.at(-1), { name: "discovery", open: false });
  env.visibility(false);
  action.click();
  assert.equal(nativeRequests.length, 1, "inaktive Feeds dürfen die native Eingabe nicht erneut öffnen");
});

test("Downloads öffnen die native Bibliothek nur aus dem aktiven Feed und lassen YouTubes Ziele erhalten", t => {
  const downloads = [];
  const env = page(t, { handlers: {
    langformOpenWatch: { postMessage() {} },
    langformNavigateFeed: { postMessage() {} },
    langformDownloads: { postMessage(body) { downloads.push(body.kind); } },
  } });
  const button = env.doc.querySelector('#langform-discovery [aria-label="Downloads öffnen"]');
  assert.ok(button);
  button.click();
  assert.deepEqual(downloads, ['open']);
  env.visibility(false);
  button.click();
  assert.deepEqual(downloads, ['open']);
  assert.equal(env.win.location.pathname, '/');
  assert.ok(env.doc.querySelector('#search') && env.doc.querySelector('#cards a'));
});

test("Menü öffnet echte Themenziele und erfindet keine Download- oder Notification-URL", t => {
  const env = page(t);
  const sheet = env.open();
  assert.equal(sheet.open, true);
  assert.equal(sheet.getAttribute("aria-labelledby"), "langform-discovery-title");
  const links = Array.from(sheet.querySelectorAll("a"));
  assert.equal(links.length, 20);
  assert.deepEqual(links.slice(0, 8).map(link => [link.textContent, new URL(link.href).pathname]), [
    ["Musik", "/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ"], ["Filme & Shows", "/feed/storefront"],
    ["Live", "/live"], ["Gaming", "/gaming"], ["Nachrichten", "/channel/UCYfdidRxbB8Qhf0Nx7ioOYw"],
    ["Sport", "/channel/UCEgdi0XIXXZ-qJOFPf4JSKw"], ["Wissen", "/channel/UCtFRv9O2AHqOZjjynzrv-xg"], ["Podcasts", "/podcasts"],
  ]);
  links.forEach(link => assert.equal(new URL(link.href).protocol, "https:"));
  assert.ok(links.every(link => !/\/feed\/(?:explore|notifications|downloads|playlists)$/.test(new URL(link.href).pathname)));
  assert.equal(sheet.querySelector(".lf-discovery-notifications"), null);
  assert.match(sheet.textContent, /Benachrichtigungen bietet YouTube auf dieser Seite nicht an/);
});

test("Playlists öffnet den erhaltenen Mediathek-Tab und schließt das Sheet", t => {
  const env = page(t);
  const sheet = env.open();
  const link = sheet.querySelector('a[href="https://m.youtube.com/feed/library"]');
  const event = new env.win.MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(env.posts, [{ href: "https://m.youtube.com/feed/library" }]);
  assert.equal(sheet.open, false);
  assert.equal(env.doc.querySelector("#langform-discovery button").getAttribute("aria-expanded"), "false");
});

test("echte Benachrichtigungen werden nur über den sichtbaren YouTube-Headerknopf geöffnet", t => {
  const env = page(t);
  const bell = env.doc.createElement("button");
  bell.setAttribute("aria-label", "Benachrichtigungen (3 ungelesen)");
  bell.getClientRects = () => [{ width: 44, height: 44 }];
  let clicks = 0;
  bell.addEventListener("click", () => clicks++);
  env.doc.querySelector("ytm-header").appendChild(bell);
  const sheet = env.open();
  const shortcut = sheet.querySelector(".lf-discovery-notifications");
  assert.ok(shortcut);
  shortcut.click();
  assert.equal(clicks, 1);
  assert.equal(sheet.open, false);
  assert.equal(bell.isConnected, true);
  assert.deepEqual(env.posts, []);
});

test("unsichtbare Headerknöpfe und Kanal-Glocken werden nicht als Posteingang ausgegeben", t => {
  const env = page(t);
  env.doc.querySelector("ytm-header").insertAdjacentHTML("beforeend", '<button aria-label="Notifications" hidden>hidden</button>');
  env.doc.getElementById("cards").insertAdjacentHTML("beforeend", '<button aria-label="Benachrichtigungen">Kanal</button>');
  assert.equal(env.open().querySelector(".lf-discovery-notifications"), null);
});

test("Escape, Schließen und Ausblenden melden nur die eigene Overlay-Quelle", t => {
  const env = page(t);
  let sheet = env.open();
  assert.deepEqual(env.overlays.at(-1), { name: "discovery", open: true });
  sheet.close(); // Browser dispatches close for its native Escape handling.
  assert.deepEqual(env.overlays.at(-1), { name: "discovery", open: false });
  sheet = env.open();
  env.visibility(false);
  assert.equal(sheet.open, false);
  assert.deepEqual(env.overlays.at(-1), { name: "discovery", open: false });
  assert.ok(env.overlays.every(value => value.name === "discovery"));
  assert.equal(env.timers.size, 0);
});

test("versteckte Feeds scannen nicht; unverändertes Wiederanzeigen braucht weder Query noch Timer", t => {
  const env = page(t, { active: false });
  assert.equal(env.queryCount(), 0);
  assert.equal(env.timers.size, 0);
  assert.equal(env.doc.getElementById("langform-discovery"), null);
  env.visibility(true);
  assert.ok(env.doc.getElementById("langform-discovery"));
  assert.equal(env.flush(), 4);
  const queries = env.queryCount();
  env.visibility(false);
  env.visibility(true);
  env.win.dispatchEvent(new env.win.Event("scroll"));
  assert.equal(env.queryCount(), queries);
  assert.equal(env.timers.size, 0);
});

test("später DOM-Aufbau wird begrenzt nachgeholt und entfernte Zeile nach Hydration einmal ersetzt", t => {
  const env = page(t, { html: "<ytm-app></ytm-app>" });
  env.doc.querySelector("ytm-app").innerHTML = "<ytm-header></ytm-header><ytm-browse></ytm-browse>";
  const first = env.timers.entries().next().value;
  env.timers.delete(first[0]);
  first[1].fn();
  env.doc.getElementById("langform-discovery").remove();
  env.flush();
  assert.equal(env.doc.querySelectorAll("#langform-discovery").length, 1);
  assert.equal(env.timers.size, 0);
});

test("fixierte YouTube-Themenchips behalten ihren Platz vor der neuen Menüzeile", t => {
  const env = page(t, { html: '<ytm-app class="sticky-player"><ytm-header></ytm-header><ytm-browse>' +
    '<ytm-rich-grid-renderer><div class="ghost-ytm-rich-grid-renderer"></div></ytm-rich-grid-renderer></ytm-browse></ytm-app>' });
  assert.equal(env.doc.getElementById("langform-discovery"), null, "Ghost-Layout erst hydratisieren lassen");
  const grid = env.doc.querySelector("ytm-rich-grid-renderer");
  grid.innerHTML = '<div class="rich-grid-sticky-header"><ytm-feed-filter-chip-bar-renderer>Alle</ytm-feed-filter-chip-bar-renderer></div>' +
    '<div class="rich-grid-renderer-contents">Videos</div>';
  const spacer = grid.firstElementChild;
  const contents = grid.lastElementChild;
  const original = spacer.outerHTML;
  env.flush();
  const bar = env.doc.getElementById("langform-discovery");
  assert.equal(bar.previousElementSibling, spacer);
  assert.equal(bar.nextElementSibling, contents);
  assert.equal(spacer.outerHTML, original, "keine fremden Chip- oder Spacer-Regeln ändern");
  assert.equal(grid.lastElementChild, contents);
});

test("ohne passende mobile Struktur endet die Suche, ohne fremde DOM-Knoten umzubauen", t => {
  const env = page(t, { html: '<main><header><input id="search"></header><section>Feed</section></main>' });
  const before = env.doc.body.innerHTML;
  assert.equal(env.flush(), 4);
  assert.equal(env.doc.body.innerHTML, before);
  assert.equal(env.doc.getElementById("langform-discovery-style"), null);
  assert.equal(env.timers.size, 0);
});

test("bei Suche/Watch verschwindet die Zeile; Rückkehr repariert sie ohne Beobachter", t => {
  const env = page(t);
  const sheet = env.open();
  env.win.history.pushState({}, "", "/results?search_query=beispiel");
  env.win.dispatchEvent(new env.win.Event("yt-navigate-finish"));
  assert.equal(sheet.open, false);
  assert.equal(env.doc.getElementById("langform-discovery"), null);
  assert.equal(env.timers.size, 0);
  env.win.history.pushState({}, "", "/feed/subscriptions");
  env.win.dispatchEvent(new env.win.Event("yt-navigate-finish"));
  assert.ok(env.doc.getElementById("langform-discovery"));
});

test("Desktop, Player und Browser ohne modales Dialogelement bleiben unverändert", t => {
  for (const options of [
    { url: "https://www.youtube.com/" },
    { url: "https://m.youtube.com/watch?v=abcdefghijk" },
    { handlers: { langformOpenFeed: {}, langformPlayer: {} } },
    { handlers: {} },
    { dialog: false },
  ]) {
    const env = page(t, options);
    env.flush();
    assert.equal(env.doc.getElementById("langform-discovery"), null);
  }
});

test("Sheet und Hintergrund öffnen zusammen; Schließen hält das Modal bis zum Ende", t => {
  const env = page(t, { animate: true });
  env.flush();
  const sheet = env.open();
  assert.equal(env.animations.length, 2);
  const [panel, backdrop] = env.animations;
  assert.equal(panel.target.className, "lf-discovery-panel");
  assert.equal(backdrop.target.className, "lf-discovery-backdrop");
  assert.equal(panel.timing.duration, 300);
  assert.equal(panel.timing, backdrop.timing);
  assert.equal(panel.frames[0].transform, "translateY(calc(100% + 2px))");
  assert.ok(panel.frames.every(frame => !("opacity" in frame)), "die lesbare Fläche bleibt vollständig deckend");
  panel.finish();
  assert.ok(env.animations.every(animation => animation.cancelled), "keine bleibenden Compositor-Effekte nach Ankunft");
  sheet.querySelector(".lf-discovery-close").click();
  assert.equal(sheet.open, true);
  assert.deepEqual(env.overlays.at(-1), { name: "discovery", open: true });
  assert.equal(env.animations[2].timing.duration, 180);
  assert.ok(env.animations[2].frames.every(frame => !("opacity" in frame)), "auch beim Schließen wird Text nicht ausgeblendet");
  env.animations[2].finish();
  assert.equal(sheet.open, false);
  assert.deepEqual(env.overlays.at(-1), { name: "discovery", open: false });
  assert.equal(env.timers.size, 0, "keine verzögerten Klicks oder Animations-Timer");
});

test("schnelles Schließen und Wiederöffnen setzt die sichtbare Pose fort", t => {
  const env = page(t, { animate: true });
  const sheet = env.open();
  const firstCompletion = env.animations[0].onfinish;
  const getComputedStyle = env.win.getComputedStyle.bind(env.win);
  env.win.getComputedStyle = node => node.classList.contains("lf-discovery-panel")
    ? { transform: "matrix(1, 0, 0, 1, 14)", opacity: "0.6" }
    : node.classList.contains("lf-discovery-backdrop") ? { opacity: "0.6" } : getComputedStyle(node);
  sheet.querySelector(".lf-discovery-close").click();
  assert.equal(env.animations[2].frames[0].transform, "matrix(1, 0, 0, 1, 14)");
  assert.equal(env.animations[3].frames[0].opacity, "0.6");
  const oldCloseCompletion = env.animations[2].onfinish;
  sheet.querySelector(".lf-discovery-close").click();
  assert.equal(env.animations.length, 4, "wiederholtes Schließen startet den Ausstieg nicht neu");
  assert.equal(env.open(), sheet, "umkehren statt das noch offene Modal zu ersetzen");
  assert.equal(env.animations.length, 6);
  firstCompletion();
  oldCloseCompletion();
  assert.equal(sheet.open, true, "überholte Animationen dürfen nicht das neue Öffnen beenden");
  assert.equal(env.animations[4].cancelled, false);
  env.animations[4].finish();
  assert.equal(sheet.open, true);
});

test("Escape und Hintergrundklick schließen animiert, Klicks im Panel nicht", t => {
  const env = page(t, { animate: true });
  let sheet = env.open();
  env.animations[0].finish();
  sheet.querySelector("h2").click();
  assert.equal(env.animations.length, 2);
  const cancel = new env.win.Event("cancel", { cancelable: true });
  sheet.dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(sheet.open, true);
  env.animations[2].finish();
  sheet = env.open();
  env.animations[4].finish();
  sheet.querySelector(".lf-discovery-backdrop").click();
  assert.equal(sheet.open, true);
  env.animations[6].finish();
  assert.equal(sheet.open, false);
});

test("Navigation und versteckte Feeds warten auch während einer Animation nicht", t => {
  const env = page(t, { animate: true });
  let sheet = env.open();
  const link = sheet.querySelector('a[href="https://m.youtube.com/feed/library"]');
  link.dispatchEvent(new env.win.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(sheet.open, false);
  assert.deepEqual(env.posts, [{ href: "https://m.youtube.com/feed/library" }]);
  assert.ok(env.animations.every(animation => animation.cancelled));
  sheet = env.open();
  env.visibility(false);
  assert.equal(sheet.open, false);
  assert.ok(env.animations.every(animation => animation.cancelled));
  assert.equal(env.timers.size, 0);
});

test("reduzierte Bewegung überspringt die Animation und übernimmt laufende Übergänge sofort", t => {
  const env = page(t, { animate: true, reducedMotion: true });
  let sheet = env.open();
  sheet.querySelector(".lf-discovery-close").click();
  assert.equal(sheet.open, false);
  assert.equal(env.animations.length, 0);
  env.reduceMotion(false);
  sheet = env.open();
  env.reduceMotion(true);
  assert.equal(sheet.open, true);
  assert.ok(env.animations.every(animation => animation.cancelled));
  env.reduceMotion(false);
  sheet.querySelector(".lf-discovery-close").click();
  env.reduceMotion(true);
  assert.equal(sheet.open, false);
  assert.ok(env.animations.every(animation => animation.cancelled));
});

test("Rotation und Viewportänderung geben den Dialog am aktuellen Ziel frei", t => {
  for (const eventName of ["resize", "orientationchange"]) {
    const env = page(t, { animate: true });
    env.flush();
    const sheet = env.open();
    env.win.dispatchEvent(new env.win.Event(eventName));
    assert.equal(sheet.open, true);
    assert.ok(env.animations.every(animation => animation.cancelled));
    assert.deepEqual(env.overlays.at(-1), { name: "discovery", open: true });
    sheet.querySelector(".lf-discovery-close").click();
    env.win.dispatchEvent(new env.win.Event(eventName));
    assert.equal(sheet.open, false);
    assert.ok(env.animations.every(animation => animation.cancelled));
    assert.deepEqual(env.overlays.at(-1), { name: "discovery", open: false });
    assert.equal(env.timers.size, 0);
  }
});

test("Dokument im Hintergrund löst Modal und Bewegungen ohne spätes Wiederöffnen", t => {
  const env = page(t, { animate: true });
  const sheet = env.open();
  const staleFinish = env.animations[0].onfinish;
  Object.defineProperty(env.doc, "hidden", { configurable: true, value: true });
  env.doc.dispatchEvent(new env.win.Event("visibilitychange"));
  assert.equal(sheet.open, false);
  assert.equal(env.timers.size, 0);
  assert.ok(env.animations.every(animation => animation.cancelled));
  staleFinish();
  assert.equal(sheet.open, false);
  assert.deepEqual(env.overlays.at(-1), { name: "discovery", open: false });
});

test("eine teilweise fehlgeschlagene Animation lässt das Menü bedienbar und räumt den Effekt auf", t => {
  const env = page(t, { animate: true });
  env.flush();
  const animate = env.win.Element.prototype.animate;
  env.win.Element.prototype.animate = function (frames, timing) {
    if (this.classList.contains("lf-discovery-backdrop")) throw new Error("animation unavailable");
    return animate.call(this, frames, timing);
  };
  const sheet = env.open();
  assert.equal(sheet.open, true, "fehlgeschlagene Dekoration versteckt das geöffnete Menü nicht");
  assert.equal(env.animations.length, 1);
  assert.equal(env.animations[0].cancelled, true);
  sheet.querySelector(".lf-discovery-close").click();
  assert.equal(sheet.open, false, "auch bei einem Animationsfehler bleibt Schließen möglich");
  assert.ok(env.animations.every(animation => animation.cancelled));
  assert.deepEqual(env.overlays.at(-1), { name: "discovery", open: false });
  assert.equal(env.timers.size, 0);
});

test("nach dem Hintergrundsetzen wird eine noch ausstehende Montage begrenzt fortgesetzt", t => {
  const env = page(t, { html: "<ytm-app></ytm-app>" });
  Object.defineProperty(env.doc, "hidden", { configurable: true, value: true });
  env.doc.dispatchEvent(new env.win.Event("visibilitychange"));
  assert.equal(env.timers.size, 0);
  env.doc.querySelector("ytm-app").innerHTML = "<ytm-header></ytm-header><ytm-browse></ytm-browse>";
  Object.defineProperty(env.doc, "hidden", { configurable: true, value: false });
  env.doc.dispatchEvent(new env.win.Event("visibilitychange"));
  assert.ok(env.doc.getElementById("langform-discovery"));
  assert.equal(env.flush(), 4);
  const queries = env.queryCount();
  env.doc.dispatchEvent(new env.win.Event("visibilitychange"));
  assert.equal(env.queryCount(), queries, "ein fertiger Feed wird beim Wiederanzeigen nicht neu durchsucht");
  assert.equal(env.timers.size, 0);
});
