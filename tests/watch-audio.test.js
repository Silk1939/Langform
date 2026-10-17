const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const app = path.join(__dirname, "../ios/Langform/Langform");
const audioPath = path.join(app, "WatchAudio.js");
const audio = fs.existsSync(audioPath) ? fs.readFileSync(audioPath, "utf8") : "";
const rect = fs.readFileSync(path.join(app, "PlayerRect.js"), "utf8");
const id = "abcdefghijk";

function page(t, withRect = false, url = "https://m.youtube.com/watch?v=" + id) {
  const dom = new JSDOM('<!doctype html><body><video id="preview"></video><div id="movie_player"><video id="main" src="https://example.test/main.mp4"></video></div></body>',
    { url, runScripts: "outside-only", pretendToBeVisual: true });
  const win = dom.window, doc = win.document, root = doc.getElementById("movie_player"), video = doc.getElementById("main");
  t.after(() => { win.dispatchEvent(new win.Event("pagehide")); win.close(); });
  let state = { paused: true, ended: false, currentTime: 0, source: "https://example.test/main.mp4", volume: 70, muted: true, data: { video_id: id } };
  const calls = [];
  const report = { hasVideo: true, playerVideoID: id, playbackState: "unstarted", playbackIssue: "", navigationToken: "" };
  Object.defineProperties(video, {
    paused: { configurable: true, get: () => state.paused },
    ended: { configurable: true, get: () => state.ended },
    currentTime: { configurable: true, get: () => state.currentTime },
    currentSrc: { configurable: true, get: () => state.source },
    readyState: { configurable: true, get: () => 4 },
    duration: { configurable: true, get: () => 300 },
    videoWidth: { configurable: true, get: () => 1920 },
    videoHeight: { configurable: true, get: () => 1080 },
  });
  video.getBoundingClientRect = () => ({ left: 0, top: 0, width: 402, height: 226, right: 402, bottom: 226 });
  video.muted = true;
  video.volume = .7;
  video.play = () => { calls.push("play"); state.paused = false; return Promise.resolve(); };
  video.pause = () => { calls.push("pause"); state.paused = true; };
  root.playVideo = () => video.play();
  root.getVideoData = () => state.data;
  root.isMuted = () => state.muted;
  root.getVolume = () => state.volume;
  root.unMute = () => { calls.push("unMute"); state.muted = false; video.muted = false; };
  root.setVolume = value => { calls.push("volume:" + value); state.volume = value; video.volume = value / 100; };
  win.webkit = { messageHandlers: { langformPlayer: { postMessage() {} } } };
  win.requestAnimationFrame = () => 1;
  win.cancelAnimationFrame = () => {};
  if (withRect) win.eval(rect);
  else win.__langformMeasureVideo = () => report;
  win.eval(audio);
  return { win, doc, root, video, state, calls, report,
    apply: (token = 1, expected = id) => !!(win.__langformApplyWatchAudio && win.__langformApplyWatchAudio(expected, String(token))) };
}

for(const signal of ['hidden','native-inactive'])test('initial Watch sound intent respects real '+signal+' when website visibility is masked',t=>{
  const p=page(t);let inactive=true;
  p.win.__langformRealVisibility={hidden:()=>signal==='hidden'&&inactive,inactive:()=>inactive};
  Object.defineProperty(p.doc,'hidden',{value:false,configurable:true});
  assert.equal(p.apply(),false);assert.deepEqual(p.calls,[]);assert.equal(p.video.muted,true);
  inactive=false;p.doc.dispatchEvent(new p.win.Event('langform-real-visibilitychange'));
  assert.equal(p.apply(),true);assert.deepEqual(p.calls,['unMute']);
});

test('real inactivity permanently cancels a deferred initial sound request for the same open token',t=>{
  const p=page(t);p.report.playbackIssue='loading';assert.equal(p.apply(),false);
  let inactive=true;p.win.__langformRealVisibility={hidden:()=>false,inactive:()=>inactive};
  p.doc.dispatchEvent(new p.win.Event('langform-real-visibilitychange'));
  inactive=false;p.report.playbackIssue='';p.doc.dispatchEvent(new p.win.Event('langform-real-visibilitychange'));
  assert.equal(p.apply(),false);assert.deepEqual(p.calls,[]);assert.equal(p.video.muted,true,'foreground cannot revive the old native sound intent');
});

test("a newly opened muted main video starts with sound through the real playback bridge", t => {
  const p = page(t, true);
  p.apply();
  assert.equal(p.win.__langformPlay(id, true), true);
  assert.equal(p.state.paused, false);
  assert.equal(p.video.muted, false, "the current Start path leaves persisted YouTube mute on its main media");
  assert.equal(p.state.muted, false);
  assert.equal(p.video.volume, .7, "positive current volume is retained");
  assert.equal(p.state.volume, 70);
  assert.deepEqual(p.calls, ["unMute", "play"]);
  assert.equal(p.doc.getElementById("preview").muted, false);
});

test("a muted stream already started by YouTube also receives the one open intent", t => {
  const p = page(t);
  p.state.paused = false;
  p.state.currentTime = 1.4;
  p.report.playbackState = "playing";
  assert.equal(p.apply(), true);
  assert.equal(p.video.muted, false);
  assert.equal(p.calls.includes("play"), false, "audio does not request another play");
});

test("zero player and media volume are restored once; positive volume is preserved", t => {
  const p = page(t);
  p.state.volume = 0;
  p.video.volume = 0;
  assert.equal(p.apply(), true);
  assert.equal(p.state.volume, 100);
  assert.equal(p.video.volume, 1);
  assert.deepEqual(p.calls, ["unMute", "volume:100"]);
  assert.equal(p.apply(), true);
  assert.deepEqual(p.calls, ["unMute", "volume:100"]);
});

test("media fallback works when YouTube audio methods are absent or throw", async t => {
  for (const scenario of ["absent", "throws"]) await t.test(scenario, t => {
    const p = page(t);
    p.video.volume = 0;
    if (scenario === "absent") { delete p.root.unMute; delete p.root.getVolume; delete p.root.setVolume; }
    else { p.root.isMuted = () => { throw Error("removed"); }; p.root.unMute = () => { throw Error("removed"); }; p.root.getVolume = () => { throw Error("removed"); }; p.root.setVolume = () => { throw Error("removed"); }; }
    assert.equal(p.apply(), true);
    assert.equal(p.video.muted, false);
    assert.equal(p.video.volume, 1);
  });
});

test("user mute survives pause, replay, fullscreen, buffering and resume after initial sound", t => {
  const p = page(t);
  assert.equal(p.apply(), true);
  p.video.muted = true;
  p.video.volume = 0;
  p.state.muted = true;
  p.state.volume = 0;
  const calls = p.calls.length;
  for (const name of ["pause", "ended", "playing", "waiting", "resize", "volumechange", "pageshow"]) {
    p.video.dispatchEvent(new p.win.Event(name, { bubbles: true }));
    assert.equal(p.apply(), true);
    assert.equal(p.video.muted, true, name);
    assert.equal(p.video.volume, 0, name);
  }
  assert.equal(p.calls.length, calls, "a native status report must not undo a later user choice");
});

test("same-video reopening retains mute; a new explicit open token can start with sound", t => {
  const p = page(t);
  assert.equal(p.apply(), true);
  p.video.muted = true;
  p.state.muted = true;
  assert.equal(p.apply(), true);
  assert.equal(p.video.muted, true);
  assert.equal(p.apply(2), true);
  assert.equal(p.video.muted, false);
  p.video.muted = true;
  assert.equal(p.apply(1), false, "late callbacks from an older open cannot reset a newer mute choice");
  assert.equal(p.video.muted, true);
});

test("deliberate pause before first sound claim preserves mute on subsequent resume", t => {
  const p = page(t);
  p.report.playbackState = "paused";
  assert.equal(p.apply(), true);
  assert.equal(p.video.muted, true);
  p.state.paused = false;
  p.report.playbackState = "playing";
  assert.equal(p.apply(), true);
  assert.equal(p.video.muted, true);
  assert.deepEqual(p.calls, []);
});

test("invalid tickets and non-YouTube hosts cannot grant audio intent", t => {
  const p = page(t);
  for (const token of [0, -1, "", "1x", true, null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(p.win.__langformApplyWatchAudio(id, token), false);
  }
  const other = page(t, false, "https://example.test/watch?v=" + id);
  assert.equal(other.apply(), false);
  assert.deepEqual(p.calls, []);
  assert.deepEqual(other.calls, []);
});

test("SPA audio waits for actual target media load, even when URL and API ID change early", t => {
  const p = page(t);
  Object.assign(p.report, { navigationToken: "8", navigationTargetID: id, navigationStarted: true, navigationComplete: true, navigationMediaLoaded: false });
  assert.equal(p.apply(8), false);
  assert.equal(p.video.muted, true);
  p.report.navigationMediaLoaded = true;
  assert.equal(p.apply(8), true);
  assert.equal(p.video.muted, false);
});

test("foreign or suspended media and ads never receive audible watch intent", async t => {
  const scenarios = {
    "feed route": p => p.win.history.replaceState({}, "", "/"),
    "URL ID mismatch": p => p.win.history.replaceState({}, "", "/watch?v=lmnopqrstuv"),
    "player ID mismatch": p => p.state.data.video_id = "lmnopqrstuv",
    "absent player ID": p => p.state.data = {},
    "truthy ad API": p => p.state.data.isAd = 1,
    "ad showing": p => p.root.classList.add("ad-showing"),
    "ad interrupting": p => p.root.classList.add("ad-interrupting"),
    "temporary ad mute": p => p.win.__langformAdMute = { video: p.video, was: false },
    "detached player": p => p.root.remove(),
    "main reparented outside root": p => p.doc.body.appendChild(p.video),
    "hidden document": p => Object.defineProperty(p.doc, "hidden", { value: true }),
    "native drag": p => p.win.__langformIsNativeDragging = () => true,
    "open overlay": p => p.win.__langformHasOpenOverlay = () => true,
    "silent diagnostic": p => p.win.__langformSilentDiagnostics = true,
    "missing source": p => { p.state.source = ""; p.video.removeAttribute("src"); },
    "media error": p => Object.defineProperty(p.video, "error", { value: { code: 3 } }),
    "ended replay": p => p.state.ended = true,
    "foreign reported ID": p => p.report.playerVideoID = "lmnopqrstuv",
    "missing report media": p => p.report.hasVideo = false,
    "failed playback": p => p.report.playbackIssue = "media-error",
    "stale SPA token": p => Object.assign(p.report, { navigationToken: "7", navigationTargetID: id, navigationStarted: true, navigationComplete: true, navigationMediaLoaded: true }),
    "incomplete SPA": p => Object.assign(p.report, { navigationToken: "1", navigationTargetID: id, navigationStarted: true, navigationComplete: false, navigationMediaLoaded: true }),
  };
  for (const [name, mutate] of Object.entries(scenarios)) await t.test(name, t => {
    const p = page(t); mutate(p);
    assert.equal(p.apply(), false);
    assert.equal(p.video.muted, true);
    assert.deepEqual(p.calls, []);
  });
});

test("an audio API callback changing source or owner cannot write to stale media", async t => {
  for (const [name, change] of Object.entries({
    "route": p => p.win.history.replaceState({}, "", "/watch?v=lmnopqrstuv"),
    "root": p => { const next = p.root.cloneNode(true); p.root.replaceWith(next); },
    "media source": p => p.state.source = "https://example.test/other.mp4",
    "ad": p => p.root.classList.add("ad-showing"),
  })) await t.test(name, t => {
    const p = page(t);
    p.root.unMute = () => { p.calls.push("unMute"); change(p); };
    p.video.volume = 0;
    p.state.volume = 0;
    assert.equal(p.apply(), false);
    assert.equal(p.video.muted, true);
    assert.equal(p.video.volume, 0);
    assert.deepEqual(p.calls, ["unMute"]);
  });
});

test("pagehide permanently ends audio access and installation adds no timers or auto-play", t => {
  const p = page(t);
  assert.deepEqual(p.calls, []);
  for (const name of ["loadeddata", "volumechange", "playing", "resize"]) p.video.dispatchEvent(new p.win.Event(name, { bubbles: true }));
  assert.deepEqual(p.calls, []);
  p.win.dispatchEvent(new p.win.Event("pagehide"));
  assert.equal(p.apply(), false);
  assert.deepEqual(p.calls, []);
});
