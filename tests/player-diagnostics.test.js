const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const script = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/PlayerDiagnostics.js"), "utf8");

function page(t, enabled = true) {
  const dom = new JSDOM('<div id="movie_player"><video></video><button id="player-controls-a11y-toggle">Private title</button></div><video id="preview"></video>', {
    url: "https://m.youtube.com/watch?v=private_id", runScripts: "outside-only",
  });
  const win = dom.window, doc = win.document, video = doc.querySelector("video"), rows = [], timers = new Map();
  let serial = 0, paused = false, now = 10;
  win.setTimeout = (fn, delay) => { const id = ++serial; timers.set(id, { fn, delay }); return id; };
  win.clearTimeout = (id) => timers.delete(id);
  win.setInterval = () => assert.fail("no polling");
  win.performance.now = () => now;
  win.HTMLElement.prototype.getBoundingClientRect = () => assert.fail("no layout reads");
  video.play = video.pause = () => assert.fail("diagnostics must never control playback");
  Object.defineProperties(video, {
    paused: { get: () => paused }, readyState: { value: 2 }, networkState: { value: 2 },
    buffered: { value: { length: 1, start: () => 0, end: () => 4 } },
  });
  video.currentTime = 1;
  doc.getElementById("movie_player").getVideoData = () => ({ video_id: "private_id", title: "Private title" });
  doc.getElementById("movie_player").getPlayerState = () => paused ? 2 : 3;
  win.__langformGetQualityStatus = () => ({ actual: "medium", requestedCap: "large", mode: "manual", secret: "never emit" });
  if (enabled) win.webkit = { messageHandlers: { langformPlayerDiagnostics: { postMessage: (batch) => rows.push(...JSON.parse(JSON.stringify(batch))) } } };
  win.eval(script);
  t.after(() => win.close());
  return {
    win, doc, video, rows, timers, pause: () => { paused = true; },
    emit: (type, target = video) => target.dispatchEvent(new win.Event(type, { bubbles: true, cancelable: true })),
    advance: (ms) => { now += ms; },
    run: (delay) => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); } },
  };
}

test("Playerdiagnose unterscheidet Pufferzustand und Pause vor/nach einem Tipp ohne ihn zu verändern", (t) => {
  const p = page(t);
  p.emit("waiting");
  p.video.addEventListener("click", (event) => { p.pause(); event.preventDefault(); p.emit("pause"); });
  assert.equal(p.emit("click"), false, "website handler still runs normally");
  p.run(0); p.run(160);
  assert.deepEqual(p.rows.map((r) => r.event), ["waiting", "click", "pause", "after-input"]);
  assert.equal(p.rows[0].paused, false);
  assert.equal(p.rows[0].bufferAhead, 3);
  assert.equal(p.rows[0].readyState, 2);
  assert.equal(p.rows[1].target, "video");
  assert.equal(p.rows[1].paused, false);
  assert.equal(p.rows[3].paused, true);
  assert.equal(p.rows[3].prevented, true);
  assert.equal(p.rows[3].trusted, false, "synthetic test input cannot be presented as a finger tap");
  assert.equal(p.rows[3].playerMatches, true);
  assert.equal(p.rows[3].actualQuality, "medium");
  assert.equal(p.rows[3].manualQuality, true);
  assert.doesNotMatch(JSON.stringify(p.rows), /private_id|Private title|never emit|youtube\.com|clientX/);
});

test("Playerdiagnose erkennt gesperrte Seiteninputs und fehlende Vollbild-UI ohne ihre Eingaben zu verändern", t => {
  const p = page(t);
  const root = p.doc.getElementById("movie_player");
  root.setAttribute("inert", "");
  p.doc.documentElement.setAttribute("data-langform-fullscreen", "");
  assert.equal(p.emit("click", p.doc.body), true);
  p.run(0); p.run(160);
  assert.equal(p.rows[0].pageInert, true);
  assert.equal(p.rows[0].fullscreenUI, false);
  assert.equal(p.rows[0].fullscreenMarked, true);
  assert.equal(p.rows[0].target, "surface");
  assert.equal(p.rows[0].prevented, false);
  assert.equal(root.hasAttribute("inert"), true, "Diagnose greift nicht in die Sperre ein");
  assert.doesNotMatch(JSON.stringify(p.rows), /private_id|Private title|youtube\.com|clientX/);
});

test("Diagnose erfasst weder Feed-Vorschauen noch alte Nach-Tipp-Zustände nach Navigation", (t) => {
  const p = page(t);
  p.emit("playing", p.doc.getElementById("preview"));
  p.emit("click");
  p.win.history.replaceState({}, "", "/watch?v=another_private_id");
  p.run(0); p.run(160);
  assert.deepEqual(p.rows.map((r) => r.event), ["click"]);
  p.emit("playing"); p.run(160);
  assert.equal(p.rows[1].route, 2);
  assert.equal(p.rows[1].playerMatches, false);
  p.win.history.replaceState({}, "", "/");
  p.emit("playing"); p.run(160);
  assert.equal(p.rows.length, 2);
});

test("Ein synthetischer Controls-Klick ersetzt nicht die Nachmessung des ursprünglichen Videotipps", (t) => {
  const p = page(t);
  p.video.addEventListener("click", (event) => {
    p.doc.getElementById("player-controls-a11y-toggle").click();
    event.preventDefault();
  });
  p.emit("click"); p.run(0); p.run(160);
  assert.deepEqual(p.rows.map((r) => [r.event, r.target]), [["click", "video"], ["click", "control"], ["after-input", "video"]]);
  assert.equal(p.rows[2].prevented, true);
});

test("Diagnose ist ohne Bridge inaktiv und begrenzt Daten, Laufzeit und Listener", (t) => {
  const off = page(t, false);
  off.emit("waiting");
  assert.equal(off.timers.size, 0);
  const p = page(t);
  for (let i = 0; i < 100; i++) p.emit("timeupdate");
  p.run(160);
  assert.equal(p.rows.length, 1, "continuous progress is sampled at most once a second");
  p.advance(1000); p.emit("progress"); p.run(160);
  assert.equal(p.rows.length, 2);
  for (let i = 0; i < 500; i++) p.emit("pause");
  assert.equal(p.rows.length, 240);
  assert.equal(p.timers.size, 0);
  const timed = page(t);
  timed.emit("waiting"); timed.run(90000);
  timed.emit("pause"); timed.run(160);
  assert.equal(timed.rows.length, 1);
  assert.equal(timed.timers.size, 0);
  const hidden = page(t);
  hidden.emit("waiting"); hidden.win.dispatchEvent(new hidden.win.Event("pagehide"));
  hidden.emit("pause"); hidden.run(160);
  assert.equal(hidden.rows.length, 1);
  assert.equal(hidden.timers.size, 0);
});

test("Diagnose trennt natives Video- und Dokumentvollbild vom eigenen Vollbild und ignoriert fremdes Video", t => {
  const p = page(t);
  Object.defineProperty(p.video, 'webkitDisplayingFullscreen', { configurable:true, value:true });
  p.emit('webkitbeginfullscreen', p.doc.getElementById('preview'));
  p.emit('webkitbeginfullscreen'); p.run(160);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].nativeVideoFullscreen, true);
  assert.equal(p.rows[0].documentFullscreen, false);
  assert.equal(p.rows[0].fullscreenUI, false);
  Object.defineProperty(p.video, 'webkitDisplayingFullscreen', { value:false });
  Object.defineProperty(p.doc, 'fullscreenElement', { value:p.doc.getElementById('movie_player') });
  p.emit('webkitendfullscreen'); p.run(160);
  assert.equal(p.rows[1].nativeVideoFullscreen, false);
  assert.equal(p.rows[1].documentFullscreen, true);
  p.run(90000); p.emit('webkitbeginfullscreen'); p.run(160);
  assert.equal(p.rows.length, 2, 'native media observer stops at the same deadline');
  assert.doesNotMatch(JSON.stringify(p.rows), /private_id|Private title|youtube\.com|clientX/);
});

test("Opt-in APItrace erfasst nur feste Methodennamen und endet mit der Diagnose", t => {
  const p = page(t);
  p.win.__langformIsNativeDragging = () => true;
  p.win.__langformStageInsets = {nativeMini:true};
  const record = p.win.__langformRecordFullscreenAPI;
  record('private title', false); record('webkitEnterFullscreen', false); p.run(160);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].fullscreenAPI, 'webkitEnterFullscreen');
  assert.equal(p.rows[0].apiIntercepted, false);
  assert.equal(p.rows[0].nativeDragging, true);
  assert.equal(p.rows[0].nativeMini, true);
  assert.doesNotMatch(JSON.stringify(p.rows), /private_id|private title/);
  p.run(90000);
  assert.equal(p.win.__langformRecordFullscreenAPI, undefined);
  record('webkitEnterFullscreen', true); p.run(160);
  assert.equal(p.rows.length, 1);
});
