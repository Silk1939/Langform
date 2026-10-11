const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const summary = require("../extension/src/summary.js");

function setup(t, options = {}) {
  const dom = new JSDOM('<ytm-video-with-context-renderer><a href="/watch?v=abcdefghijk">Film</a></ytm-video-with-context-renderer>', {
    url: "https://m.youtube.com/",
  });
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document, animations = [], modelCalls = [], focusCalls = [];
  win.visualViewport = new win.EventTarget();
  const changes = new Set();
  const preference = { matches: !!options.reduced,
    addEventListener(name, callback) { changes.add(callback); },
    removeEventListener(name, callback) { changes.delete(callback); },
  };
  win.matchMedia = () => preference;
  const focus = win.HTMLElement.prototype.focus;
  win.HTMLElement.prototype.focus = function (settings) { focusCalls.push({ node: this, settings }); focus.call(this); };
  if (!options.noAnimation) win.Element.prototype.animate = function (frames, timing) {
    const animation = { node: this, frames, timing, cancelled: false, onfinish: null,
      cancel() { this.cancelled = true; }, finish() { if (this.onfinish) this.onfinish(); } };
    animations.push(animation); return animation;
  };
  win.fetch = async href => ({ ok: true, text: async () => new URL(href).pathname === "/watch"
    ? "ytInitialPlayerResponse=" + JSON.stringify({ videoDetails: { videoId: "abcdefghijk" },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: "de", baseUrl: "https://m.youtube.com/api/timedtext?v=abcdefghijk&lang=de" }] } } }) + ";"
    : JSON.stringify({ events: [{ segs: [{ utf8: "Das Gemüse braucht 20 Minuten. Danach ruht es kurz." }] }] }) });
  win.webkit = { messageHandlers: { langformSummary: { postMessage(request) {
    modelCalls.push(request);
    win.__langformKurzFinish(request.id, { summary: { points: ["Das Gemüse braucht 20 Minuten."] } });
  } } } };
  summary.decorate(doc, win.location.href, win);
  const opener = doc.querySelector("[data-langform-kurz]");
  return { win, doc, animations, opener, preference, changes, modelCalls, focusCalls,
    open() { opener.click(); return doc.getElementById("langform-kurzfassung"); },
    async flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); },
    reduce() { preference.matches = true; changes.forEach(callback => callback()); },
  };
}

test("Kurzfassung bewegt nur Panel und eigenen Scrim; Ergebnisse und Lesescroll starten keinen neuen Effekt", async t => {
  const env = setup(t), sheet = env.open();
  assert.equal(env.animations.length, 2);
  assert.equal(env.animations[0].node, sheet.querySelector(".langform-kurz"));
  assert.deepEqual(env.animations[0].frames.map(frame => Object.keys(frame)), [["transform"], ["transform"]]);
  assert.equal(env.animations[1].node, sheet.querySelector(".langform-kurz-backdrop"));
  assert.equal(env.animations[0].timing.duration, 280);
  assert.equal(env.animations[0].timing, env.animations[1].timing);
  await env.flush();
  assert.equal(env.modelCalls.length, 1);
  assert.equal(sheet.getAttribute("data-summary-state"), "ready");
  const body = sheet.querySelector(".langform-kurz-body"); body.scrollTop = 123;
  body.dispatchEvent(new env.win.Event("scroll", { bubbles: true }));
  env.open();
  assert.equal(env.animations.length, 2, "Lesen und bereits geöffnete Ergebnisse animieren nicht neu");
  assert.equal(body.scrollTop, 123);
  env.animations[0].finish();
  assert.ok(env.animations.every(animation => animation.cancelled));
});

test("Kurzfassung kehrt schnellen Close/Reopen von der sichtbaren Pose um und verwirft alte Abschlüsse", async t => {
  const env = setup(t), sheet = env.open(); await env.flush();
  const getStyle = env.win.getComputedStyle.bind(env.win);
  env.win.getComputedStyle = node => node.className === "langform-kurz"
    ? { transform: "matrix(1,0,0,1,45)" }
    : node.className === "langform-kurz-backdrop" ? { opacity: ".6" } : getStyle(node);
  sheet.querySelector("header button").click();
  const closing = env.animations[2], staleFinish = closing.onfinish;
  sheet.querySelector("header button").click();
  assert.equal(env.animations.length, 4, "Doppel-X beginnt keinen zweiten Abschluss");
  assert.equal(closing.timing.duration, 180);
  assert.equal(env.open(), sheet);
  assert.equal(closing.cancelled, true);
  assert.equal(env.animations[4].frames[0].transform, "matrix(1,0,0,1,45)");
  assert.equal(env.animations[5].frames[0].opacity, ".6");
  staleFinish();
  assert.equal(sheet.isConnected, true);
  assert.equal(env.animations[4].cancelled, false);
  assert.equal(env.modelCalls.length, 1, "Umkehren startet die fertige Zusammenfassung nicht erneut");
});

test("Ergebnislieferung während Close läuft weiter und steht beim Umkehren ohne zweiten Modellauftrag bereit", async t => {
  const env = setup(t), sheet = env.open();
  sheet.querySelector("header button").click();
  const staleClose = env.animations[2].onfinish;
  await env.flush();
  assert.equal(env.modelCalls.length, 1, "die laufende Berechnung wartet nicht auf das Ende der Bewegung");
  assert.equal(sheet.getAttribute("data-summary-state"), "pending", "ausfahrende Inhalte werden nicht mehr ausgetauscht");
  env.open();
  assert.equal(sheet.getAttribute("data-summary-state"), "ready");
  assert.equal(sheet.querySelectorAll("li").length, 1);
  staleClose();
  assert.equal(sheet.isConnected, true);
  assert.equal(env.modelCalls.length, 1);
});

test("Escape und Tastaturfokus bleiben im Sheet; Close gibt Fokus ohne Seitenscroll zurück", async t => {
  const env = setup(t), sheet = env.open();
  const close = sheet.querySelector("header button");
  assert.equal(env.doc.activeElement, close);
  const tab = new env.win.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  close.dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, true);
  assert.equal(env.doc.activeElement, close);
  close.dispatchEvent(new env.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  env.animations[2].finish();
  assert.equal(sheet.isConnected, false);
  assert.equal(env.doc.activeElement, env.opener);
  assert.ok(env.focusCalls.every(call => call.settings.preventScroll), "Fokus verschiebt weder Seite noch Player");
  assert.equal(env.changes.size, 0, "keine Preference-Listener geschlossener Sheets");
});

test("Navigation und versteckte Feeds räumen ein laufendes Sheet sofort auf", async t => {
  for (const event of ["pagehide", "yt-navigate-start", "state-navigatestart", "popstate", "langform-feed-visibility"]) {
    const env = setup(t), sheet = env.open();
    const staleFinish = env.animations[0].onfinish;
    if (event === "langform-feed-visibility") env.win.__langformFeedActive = false;
    env.win.dispatchEvent(new env.win.Event(event));
    staleFinish(); await env.flush();
    assert.equal(sheet.isConnected, false, event);
    assert.ok(env.animations.every(animation => animation.cancelled));
    assert.equal(env.changes.size, 0);
    assert.equal(env.doc.getElementById("langform-kurzfassung"), null, "verspätete Resultate montieren keinen alten Dialog");
  }
});

test("Reduce Motion und fehlende WAAPI bleiben unmittelbar, ein laufender Viewportwechsel setzt nur die Bewegung zurück", async t => {
  for (const options of [{ reduced: true }, { noAnimation: true }]) {
    const env = setup(t, options), sheet = env.open();
    sheet.querySelector("header button").click();
    assert.equal(sheet.isConnected, false);
    assert.equal(env.animations.length, 0);
  }
  for (const reason of ["reduce", "viewport"]) {
    const env = setup(t), sheet = env.open();
    const body = sheet.querySelector(".langform-kurz-body"); body.scrollTop = 40;
    if (reason === "reduce") env.reduce();
    else env.win.visualViewport.dispatchEvent(new env.win.Event("resize"));
    assert.equal(sheet.isConnected, true);
    assert.equal(body.scrollTop, 40);
    assert.ok(env.animations.every(animation => animation.cancelled));
    sheet.querySelector("header button").click();
    if (reason === "viewport") env.win.visualViewport.dispatchEvent(new env.win.Event("resize"));
    assert.equal(sheet.isConnected, false);
  }
});
