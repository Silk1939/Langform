const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const summary = require("../extension/src/summary.js");
const pageCaptions = require("../extension/src/page-captions.js");

const ID = "abcdefghijk";
const OTHER = "videoone111";
const TRACK = { languageCode: "en", baseUrl: "https://www.youtube.com/api/timedtext?v=" + ID + "&lang=en" };
function player(id = ID, tracks = [TRACK]) {
  return { videoDetails: { videoId: id }, captions: { playerCaptionsTracklistRenderer: {
    captionTracks: tracks, translationLanguages: [{ languageCode: "de" }],
  } } };
}
function captions(text) { return JSON.stringify({ events: [{ segs: [{ utf8: text }] }] }); }
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise(r => setTimeout(r, 5));
  }
  assert.fail("Der erwartete Zustand wurde nicht erreicht.");
}
function setup(t, options = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="movie_player"><video></video></div><ytd-watch-metadata><div id="title"><h1>Gespräch</h1></div></ytd-watch-metadata><ytd-compact-video-renderer><a href="/watch?v=' + OTHER + '">Anderes Video</a></ytd-compact-video-renderer></body></html>', {
    url: "https://www.youtube.com/watch?v=" + ID,
  });
  const win = dom.window;
  t.after(() => win.close());
  if (options.isolated !== false) win.browser = { runtime: { id: "de.ipekkaya.shorts-ausblenden", sendMessage() { assert.fail("Copy ruft kein Modell auf"); } } };
  win.Blob = Blob;
  win.ClipboardItem = class {
    constructor(data) { this.data = data; }
    getType(type) { return this.data[type]; }
  };
  win.ytInitialPlayerResponse = options.player || player();
  const calls = [];
  win.fetch = async function (url, init) {
    calls.push({ url: String(url), credentials: init.credentials });
    return { ok: true, text: () => options.body ? options.body() : Promise.resolve(captions("Das vollständige Gespräch.")) };
  };
  const copied = [];
  let gesture = false;
  let writes = 0;
  Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: {
    write(items) {
      writes++;
      assert.equal(gesture, true, "Safari write() beginnt synchron im Klick");
      const done = items[0].getType("text/plain").then(blob => blob.text());
      return done.then(text => {
        if (options.deny && options.deny()) throw new Error("NotAllowedError");
        copied.push(text);
      });
    },
  } });
  pageCaptions.install(win);
  summary.decorate(win.document, win.location.href, win);
  function button() { return win.document.querySelector("[data-langform-transcript] button"); }
  function dialog() { return win.document.querySelector(".langform-transcript-dialog"); }
  function copyButton() { return win.document.querySelector(".langform-transcript-copy"); }
  function status() { return win.document.querySelector(".langform-transcript-status"); }
  function click(target) { gesture = true; (target || button()).click(); gesture = false; }
  function copy() { click(copyButton()); }
  return { dom, win, calls, copied, button, dialog, copyButton, status, click, copy, writes: () => writes, gesture: () => gesture };
}

test("Copy liest das vollständige Transkript ohne Modell, Kürzung, Bereinigung oder automatische Übersetzung", async () => {
  const spoken = "Bro [musik] Werbung und ein Rabattcode. " + "Ein weiterer gesprochener Satz. ".repeat(5000) + "Letzter Satz 🧬 < 5.";
  const urls = [];
  const result = await summary.loadTranscript(ID, {
    player: player(), watchPage: true, originalLanguage: true,
    fetchText(url) { urls.push(url); return Promise.resolve(captions(spoken)); },
    summarize() { assert.fail("Kein Modellaufruf"); },
  });
  assert.deepEqual(result, { text: spoken });
  assert.ok(result.text.length > 100000);
  assert.equal(urls.length, 1);
  assert.doesNotMatch(urls[0], /tlang=|googlevideo/);
});

test("Die Watch-Aktion steht einmal in derselben Zeile neben Kurzfassung und lädt vor dem Klick nichts", t => {
  const ui = setup(t);
  summary.decorate(ui.win.document, ui.win.location.href, ui.win);
  assert.equal(ui.win.document.querySelectorAll("[data-langform-transcript]").length, 1);
  assert.equal(ui.button().textContent, "Transkript");
  const actions = ui.button().closest("[data-langform-transcript]");
  assert.equal(actions.previousSibling.textContent, "Kurzfassung");
  assert.equal(actions.parentElement.className, "langform-watch-actions");
  assert.equal(ui.button().getAttribute("aria-haspopup"), "dialog");
  assert.equal(ui.win.document.querySelector("ytd-compact-video-renderer [data-langform-transcript]"), null);
  assert.equal(ui.win.document.querySelector("#movie_player [data-langform-transcript]"), null);
  assert.deepEqual(ui.calls, []);
  assert.equal(ui.dialog(), null);
});

test("Transkriptfenster und Ausrichtung bleiben aus dem iPhone-/Seitenkontext und dem Feed ausgeschlossen", t => {
  const native = setup(t, { isolated: false });
  assert.equal(native.button(), null);
  assert.equal(native.dialog(), null);
  assert.equal(native.win.document.querySelector(".langform-watch-actions"), null);
  assert.equal(native.win.document.getElementById("langform-transcript-style"), null);
  assert.deepEqual(native.calls, []);
  const ui = setup(t);
  ui.win.document.querySelector("[data-langform-transcript]").remove();
  ui.win.document.getElementById("langform-transcript-style").remove();
  ui.dom.reconfigure({ url: "https://www.youtube.com/" });
  summary.decorate(ui.win.document, ui.win.location.href, ui.win);
  assert.equal(ui.button(), null);
  assert.equal(ui.win.document.getElementById("langform-transcript-style"), null);
  assert.deepEqual(ui.calls, []);
});

test("Das kleine zugängliche Fenster zeigt vollständige Untertitel ohne Schreiben und verändert die Wiedergabe nicht", async t => {
  const spoken = "Anfang <script> 🧬 " + "Gespräch mit Werbung. ".repeat(5000) + "ENDE";
  const ui = setup(t, { body: async () => captions(spoken) });
  let parentClicks = 0;
  ui.win.document.body.addEventListener("click", () => parentClicks++);
  const video = ui.win.document.querySelector("video");
  video.play = video.pause = () => assert.fail("Transkript verändert die Wiedergabe nicht");
  ui.click();
  assert.equal(parentClicks, 0);
  assert.equal(ui.dialog().getAttribute("role"), "dialog");
  assert.equal(ui.dialog().getAttribute("aria-modal"), "true");
  assert.equal(ui.win.document.activeElement.className, "langform-transcript-close");
  assert.equal(ui.button().getAttribute("aria-expanded"), "true");
  assert.equal(ui.dialog().getAttribute("data-transcript-state"), "loading");
  assert.equal(ui.writes(), 0);
  await until(() => ui.dialog().getAttribute("data-transcript-state") === "ready");
  assert.equal(ui.win.document.querySelector(".langform-transcript-text").textContent, spoken);
  assert.equal(ui.win.document.querySelector(".langform-transcript-text script"), null);
  assert.deepEqual(ui.copied, []);
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0].credentials, "include");
  assert.doesNotMatch(ui.calls[0].url, /tlang=|googlevideo/);
});

test("Safari beginnt Kopieren synchron im eigenen Klick und bestätigt erst die verzögerte vollständige Nutzlast", async t => {
  const body = deferred();
  const spoken = "Anfang [musik] Bro. " + "Gespräch mit Werbung. ".repeat(5000) + "ENDE 🧬";
  const ui = setup(t, { body: () => body.promise });
  ui.click();
  ui.copy();
  assert.equal(ui.writes(), 1);
  assert.equal(ui.copyButton().disabled, true);
  assert.deepEqual(ui.copied, []);
  assert.equal(ui.status().textContent, "Wird kopiert …");
  await until(() => ui.calls.length > 0);
  body.resolve(captions(spoken));
  await until(() => !ui.copyButton().disabled);
  assert.deepEqual(ui.copied, [spoken]);
  assert.equal(ui.status().textContent, "Transkript kopiert.");
  assert.equal(ui.calls.length, 1);
});

test("Abgewiesenes Clipboard-Schreiben meldet keinen Erfolg und lässt ohne erneuten Abruf wiederholen", async t => {
  let deny = true;
  const ui = setup(t, { deny: () => deny });
  ui.click();
  await until(() => ui.dialog().getAttribute("data-transcript-state") === "ready");
  ui.copy();
  await until(() => !ui.copyButton().disabled);
  assert.deepEqual(ui.copied, []);
  assert.match(ui.status().textContent, /Kopieren nicht möglich/);
  deny = false;
  ui.copy();
  await until(() => !ui.copyButton().disabled);
  assert.deepEqual(ui.copied, ["Das vollständige Gespräch."]);
  assert.equal(ui.calls.length, 1);
});

test("writeText-Fallback nutzt nach dem Laden synchron verfügbaren Text", async t => {
  const ui = setup(t);
  ui.win.ClipboardItem = undefined;
  Object.defineProperty(ui.win.navigator, "clipboard", { value: { writeText(text) {
    assert.equal(ui.gesture(), true);
    ui.copied.push(text);
    return Promise.resolve();
  } } });
  ui.click();
  await until(() => ui.dialog().getAttribute("data-transcript-state") === "ready");
  ui.copy();
  await until(() => !ui.copyButton().disabled);
  assert.deepEqual(ui.copied, ["Das vollständige Gespräch."]);
  assert.equal(ui.calls.length, 1);
});

test("Fehlende Untertitel zeigen im Fenster den Grund und eine Wiederholung ohne Clipboard-Schreiben", async t => {
  const ui = setup(t, { player: player(ID, []) });
  ui.click();
  await until(() => ui.dialog().getAttribute("data-transcript-state") === "error");
  assert.match(ui.win.document.querySelector(".langform-transcript-body").textContent, /keine Untertitel/);
  assert.ok(ui.win.document.querySelector(".langform-transcript-retry"));
  assert.equal(ui.copyButton().disabled, true);
  assert.deepEqual(ui.copied, []);
  assert.deepEqual(ui.calls, []);
});

test("Leere Untertitel bleiben wiederholbar und werden danach vollständig angezeigt und kopiert", async t => {
  let content = "";
  const ui = setup(t, { body: async () => content });
  ui.click();
  await until(() => ui.dialog().getAttribute("data-transcript-state") === "error");
  assert.match(ui.win.document.querySelector(".langform-transcript-body").textContent, /Untertitel sind leer/);
  content = captions("Beim zweiten Versuch ist das Transkript verfügbar.");
  ui.click(ui.win.document.querySelector(".langform-transcript-retry"));
  await until(() => ui.dialog().getAttribute("data-transcript-state") === "ready");
  ui.copy();
  await until(() => !ui.copyButton().disabled);
  assert.deepEqual(ui.copied, ["Beim zweiten Versuch ist das Transkript verfügbar."]);
});

test("X, Escape und Hintergrund schließen das Fenster und geben Fokus zurück; erneutes Öffnen nutzt geladene Untertitel", async t => {
  const ui = setup(t);
  for (const mode of ["close", "escape", "backdrop"]) {
    ui.button().focus();
    ui.click();
    await until(() => ui.dialog().getAttribute("data-transcript-state") === "ready");
    if (mode === "escape") ui.win.document.activeElement.dispatchEvent(new ui.win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    else ui.click(ui.win.document.querySelector(mode === "close" ? ".langform-transcript-close" : ".langform-transcript-backdrop"));
    assert.equal(ui.dialog(), null);
    assert.equal(ui.win.document.activeElement, ui.button());
    assert.equal(ui.button().getAttribute("aria-expanded"), "false");
  }
  assert.equal(ui.calls.length, 1);
});

test("Tab und Shift-Tab bleiben im Fenster; die Seite erhält keine Wiedergabetasten", async t => {
  const ui = setup(t);
  ui.click();
  await until(() => ui.dialog().getAttribute("data-transcript-state") === "ready");
  const close = ui.win.document.querySelector(".langform-transcript-close");
  ui.copyButton().focus();
  ui.copyButton().dispatchEvent(new ui.win.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  assert.equal(ui.win.document.activeElement, close);
  close.dispatchEvent(new ui.win.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(ui.win.document.activeElement, ui.copyButton());
  let pageKeys = 0;
  ui.win.document.body.addEventListener("keydown", () => pageKeys++);
  for (const key of ["a", "s", "d"]) close.dispatchEvent(new ui.win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  assert.equal(pageKeys, 0);
  ui.button().focus();
  assert.equal(ui.win.document.activeElement, close);
});

test("Ein Videowechsel verwirft Fenster und ausstehende Clipboard-Nutzlast auch bei A→B→A", async t => {
  const body = deferred();
  const ui = setup(t, { body: () => body.promise });
  ui.click();
  ui.copy();
  await until(() => ui.calls.length > 0);
  ui.win.dispatchEvent(new ui.win.Event("yt-navigate-start"));
  assert.equal(ui.dialog(), null);
  ui.dom.reconfigure({ url: "https://www.youtube.com/watch?v=" + OTHER });
  ui.win.ytInitialPlayerResponse = player(OTHER);
  summary.decorate(ui.win.document, ui.win.location.href, ui.win);
  assert.equal(ui.button().closest("[data-langform-transcript]").getAttribute("data-langform-transcript"), OTHER);
  ui.win.dispatchEvent(new ui.win.Event("yt-navigate-start"));
  ui.dom.reconfigure({ url: "https://www.youtube.com/watch?v=" + ID });
  ui.win.ytInitialPlayerResponse = player();
  summary.decorate(ui.win.document, ui.win.location.href, ui.win);
  body.resolve(captions("Veraltete Antwort aus dem ersten Videoaufruf."));
  await new Promise(r => setTimeout(r, 40));
  assert.deepEqual(ui.copied, []);
  assert.equal(ui.button().textContent, "Transkript");
  assert.equal(ui.win.document.querySelectorAll(".langform-watch-actions").length, 1);
  assert.equal(ui.dialog(), null);
});

test("Quellen- und Hauptvideoersatz entwerten ein geladenes Fenster", async t => {
  const ui = setup(t);
  ui.click();
  await until(() => ui.dialog().getAttribute("data-transcript-state") === "ready");
  const video = ui.win.document.querySelector("video");
  video.src = "https://www.youtube.com/replaced-media";
  await until(() => !ui.dialog());
  assert.equal(ui.button().getAttribute("aria-expanded"), "false");
  ui.click();
  await until(() => ui.dialog().getAttribute("data-transcript-state") === "ready");
  video.replaceWith(ui.win.document.createElement("video"));
  await until(() => !ui.dialog());
  assert.deepEqual(ui.copied, []);
});

test("Schließen während des Ladens verwirft verspätete Anzeige und noch ausstehendes Kopieren", async t => {
  const body = deferred();
  const ui = setup(t, { body: () => body.promise });
  ui.click();
  ui.copy();
  await until(() => ui.calls.length > 0);
  ui.click(ui.win.document.querySelector(".langform-transcript-close"));
  body.resolve(captions("Diese verspätete Antwort gehört zum geschlossenen Fenster."));
  await new Promise(r => setTimeout(r, 40));
  assert.equal(ui.dialog(), null);
  assert.deepEqual(ui.copied, []);
});
