const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/PlayerRect.js"), "utf8");

function setup(t) {
  const dom = new JSDOM('<div id="movie_player"><video></video></div>', {
    url: "https://m.youtube.com/watch?v=abcdefghijk", runScripts: "outside-only",
  });
  const win = dom.window, root = win.document.getElementById("movie_player"), video = root.querySelector("video");
  const observers = [], timers = new Map(), frames = new Map(), posts = [];
  let serial = 0, reads = 0;
  t.after(() => { win.dispatchEvent(new win.Event("pagehide")); win.close(); });
  Object.defineProperties(video, {
    paused: { value: false }, ended: { value: false }, readyState: { value: 4, writable: true },
    videoWidth: { value: 1280 }, videoHeight: { value: 720 },
  });
  root.getVideoData = () => ({ video_id: "abcdefghijk" });
  root.getPlayerState = () => video.readyState >= 3 ? 1 : 3;
  video.getBoundingClientRect = () => { reads++; return { left: 0, top: 0, width: 390, height: 219 }; };
  win.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); }
    observe(node) { assert.equal(node, video); this.connected = true; }
    disconnect() { this.connected = false; }
  };
  win.requestAnimationFrame = callback => { const id = ++serial; frames.set(id, callback); return id; };
  win.cancelAnimationFrame = id => frames.delete(id);
  win.setTimeout = (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; };
  win.clearTimeout = id => timers.delete(id);
  win.webkit = { messageHandlers: { langformPlayer: { postMessage(value) { posts.push(value); } } } };
  win.eval(source);
  function frame() { const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback()); }
  function emit(name) { video.dispatchEvent(new win.Event(name)); }
  emit("playing"); frame();
  return { win, video, observers, timers, frames, posts, frame, emit, reads: () => reads,
    event(name) { win.dispatchEvent(new win.Event(name)); },
    deadline() {
      const queued = [...timers].find(([, value]) => value.delay === 3000);
      assert.ok(queued, "a current buffering episode needs its bounded recovery deadline");
      timers.delete(queued[0]); queued[1].callback();
    },
  };
}

test("late media events cannot resurrect player observers, timers or layout work after pagehide", t => {
  const s = setup(t), reports = s.posts.length, reads = s.reads(), observers = s.observers.length;
  s.event("pagehide");
  assert.ok(s.observers.every(observer => !observer.connected));
  s.video.readyState = 2;
  for (let i = 0; i < 100; i++) {
    for (const name of ["waiting", "stalled", "resize", "timeupdate"]) s.emit(name);
  }
  t.diagnostic(JSON.stringify({ lateEvents: 400, recreatedObservers: s.observers.length - observers,
    pendingTimers: s.timers.size, queuedFrames: s.frames.size, addedLayoutReads: s.reads() - reads }));
  assert.equal(s.observers.length, observers, "retired page must not re-observe a retained media node");
  assert.equal(s.timers.size, 0, "late buffering cannot start a deadline in an inactive page");
  assert.equal(s.frames.size, 0);
  assert.equal(s.posts.length, reports);
  assert.equal(s.reads(), reads);
  assert.equal(s.win.__langformMeasureVideo().hasVideo, false, "stale native measurements cannot reacquire inactive media");
  assert.equal(s.reads(), reads, "inactive native measurement reads no video layout");
});

test("pageshow restores one current observer and a fresh recovery deadline after late inactive buffering", t => {
  const s = setup(t);
  s.event("pagehide");
  s.video.readyState = 2;
  s.emit("waiting");
  // Run any accidentally recreated deadline while the page is still hidden.
  // Before the fix this leaves a stale playAttempt with no timer; subsequent
  // real buffering cannot schedule Retry even when the page becomes active.
  for (const [id, timer] of [...s.timers]) { s.timers.delete(id); timer.callback(); }
  s.event("pageshow"); s.frame();
  assert.equal(s.observers.filter(observer => observer.connected).length, 1);
  s.emit("waiting"); s.frame();
  assert.equal(s.posts.at(-1).playbackState, "buffering");
  s.deadline(); s.frame();
  assert.equal(s.posts.at(-1).playbackState, "buffering", "timeout offers Retry without inventing a media pause");
  assert.equal(s.posts.at(-1).playing, true);
  assert.equal(s.posts.at(-1).playbackIssue, "timeout", "fresh foreground buffering can still offer explicit Retry");
  assert.equal(s.timers.size, 0);
  s.video.readyState = 4; s.emit("playing"); s.frame();
  assert.equal(s.posts.at(-1).playbackState, "playing", "actual media recovery still supersedes timeout");
  assert.equal(s.posts.at(-1).playbackIssue, "");
  s.event("pagehide"); s.emit("waiting");
  assert.ok(s.observers.every(observer => !observer.connected));
  assert.equal(s.timers.size, 0, "a second lifecycle remains clean");
});
