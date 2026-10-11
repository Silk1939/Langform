const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/PlayerRect.js"), "utf8");

async function setup(t, { observe = true, url = "https://m.youtube.com/watch?v=abcdefghijk" } = {}) {
  const dom = new JSDOM('<!doctype html><div id="movie_player"></div>', { url, runScripts: "outside-only" });
  const win = dom.window, root = win.document.getElementById("movie_player");
  await new Promise(resolve => win.addEventListener("load", resolve, { once: true }));
  t.after(() => { win.dispatchEvent(new win.Event("pagehide")); win.close(); });
  const posts = [], frames = new Map(), timers = new Map(), observers = [];
  let serial = 0, reads = 0, paint;
  win.requestAnimationFrame = callback => { const id = ++serial; frames.set(id, callback); return id; };
  win.cancelAnimationFrame = id => frames.delete(id);
  win.setTimeout = (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; };
  win.clearTimeout = id => timers.delete(id);
  const BaseObserver = win.MutationObserver;
  win.MutationObserver = observe ? class extends BaseObserver {
    constructor(callback) { super(callback); this.connected = false; observers.push(this); this.callback = callback; }
    observe(...args) { this.connected = true; super.observe(...args); }
    disconnect() { this.connected = false; super.disconnect(); }
  } : undefined;
  win.ResizeObserver = class { observe() {} disconnect() {} };
  win.PerformanceObserver = class { constructor(callback) { paint = callback; } observe() {} disconnect() {} };
  root.getVideoData = () => ({ video_id: "abcdefghijk" });
  root.getPlayerState = () => -1;
  win.webkit = { messageHandlers: { langformPlayer: { postMessage: body => posts.push(body) } } };
  win.eval(source);
  return { win, root, posts, frames, timers, observers, reads: () => reads,
    frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); },
    paint() { paint({ getEntries: () => [{ name: "first-contentful-paint" }] }); },
    video(container = root) {
      const video = win.document.createElement("video");
      video.getBoundingClientRect = () => { reads++; return { left: 0, top: 110, width: 402, height: 226 }; };
      container.appendChild(video);
      return video;
    },
  };
}

test("ein nach First Paint eingefügtes unstarted-Hauptvideo meldet sich vor Dokumentende ohne Medienevent", async t => {
  const p = await setup(t);
  p.paint(); p.frame();
  assert.equal(p.posts.at(-1).hasVideo, false);
  p.video(p.win.document.body); // An unrelated feed/preview video is not the player.
  await Promise.resolve();
  assert.equal(p.frames.size, 0);
  const video = p.video();
  await Promise.resolve();
  assert.equal(p.frames.size, 1);
  assert.equal(p.reads(), 0, "DOM discovery does not force layout synchronously");
  p.frame();
  assert.equal(p.posts.at(-1).hasVideo, true);
  assert.equal(p.posts.at(-1).playbackState, "unstarted");
  assert.equal(p.posts.at(-1).y, 110);
  assert.equal(video.paused, true, "discovery never calls Play");
  assert.equal(p.observers.filter(observer => observer.connected).length, 0);
  assert.equal(p.timers.size, 0, "the discovery deadline ends with the first main video");
  for (let i = 0; i < 100; i++) p.root.appendChild(p.win.document.createElement("span"));
  await Promise.resolve();
  assert.equal(p.frames.size, 0, "normal player DOM changes create no permanent observer work");
});

test("DOMContentLoaded entdeckt ein unstarted-Video auch ohne MutationObserver", async t => {
  const p = await setup(t, { observe: false });
  p.video();
  p.win.document.dispatchEvent(new p.win.Event("DOMContentLoaded"));
  p.frame();
  assert.equal(p.posts.at(-1).hasVideo, true);
  assert.equal(p.posts.at(-1).playbackState, "unstarted");
  assert.equal(p.timers.size, 0);
});

test("Discovery endet nach zehn Sekunden und pagehide; BFCache reaktiviert nur das aktuelle Hauptmedium", async t => {
  const p = await setup(t);
  const observer = p.observers.at(-1);
  const [id, deadline] = [...p.timers].find(([, timer]) => timer.delay === 10000);
  p.timers.delete(id); deadline.callback();
  assert.equal(observer.connected, false);
  p.video(); await Promise.resolve();
  assert.equal(p.frames.size, 0, "the bounded observer does not continue after its deadline");
  p.win.dispatchEvent(new p.win.Event("pageshow")); p.frame();
  assert.equal(p.posts.at(-1).hasVideo, true);
  p.win.dispatchEvent(new p.win.Event("pagehide"));
  const before = p.reads(), count = p.posts.length;
  observer.callback([{ addedNodes: [p.root] }]);
  p.win.document.dispatchEvent(new p.win.Event("DOMContentLoaded"));
  assert.equal(p.frames.size, 0);
  assert.equal(p.reads(), before);
  assert.equal(p.posts.length, count);
  assert.equal(p.timers.size, 0);
});

test("Feed-Dokumente erhalten keine Hauptmedia-Discovery", async t => {
  const p = await setup(t, { url: "https://m.youtube.com/" });
  p.video(); await Promise.resolve();
  assert.equal(p.observers.length, 0);
  assert.equal(p.timers.size, 0);
  assert.equal(p.frames.size, 0);
});

test("Zoom meldet den unvergrößerten Medienviewport an den nativen Player und gibt nach Reset die normale Messung frei", async t => {
  const p = await setup(t);
  const video = p.video(), received = [];
  video.getBoundingClientRect = () => ({ left: -201, top: -113, width: 804, height: 452 });
  p.win.__langformPlaybackZoom = {
    getLayoutRect(media) {
      received.push(media);
      return { left: 0, top: 0, width: 402, height: 226 };
    },
  };
  let report = p.win.__langformMeasureVideo();
  assert.equal(received.at(-1), video, "der Hook erhält den tatsächlichen Hauptmedienknoten");
  assert.deepEqual([report.x, report.y, report.width, report.height], [0, 0, 402, 226]);
  p.win.__langformPlaybackZoom.getLayoutRect = () => null;
  video.getBoundingClientRect = () => ({ left: 0, top: 110, width: 402, height: 226 });
  report = p.win.__langformMeasureVideo();
  assert.deepEqual([report.x, report.y, report.width, report.height], [0, 110, 402, 226]);
});

test("fehlende, defekte und nicht endliche Zoomgeometrie verhindern die normale Medienmessung nicht", async t => {
  const p = await setup(t);
  p.video();
  const hooks = [undefined, {}, { getLayoutRect: () => null },
    { getLayoutRect() { throw new Error("stale owner"); } },
    ...[NaN, Infinity, -1, 0, 8, "402"].map(width => ({ getLayoutRect: () => ({ left: 0, top: 0, width, height: 226 }) })),
    { getLayoutRect: () => ({ left: NaN, top: 0, width: 402, height: 226 }) },
    { getLayoutRect: () => ({ left: 0, top: Infinity, width: 402, height: 226 }) },
  ];
  for (const hook of hooks) {
    p.win.__langformPlaybackZoom = hook;
    const report = p.win.__langformMeasureVideo();
    assert.deepEqual([report.x, report.y, report.width, report.height], [0, 110, 402, 226]);
  }
  p.root.replaceChildren();
  p.win.__langformPlaybackZoom = { getLayoutRect() { assert.fail("kein Hook ohne aktuelles Hauptmedium"); } };
  assert.equal(p.win.__langformMeasureVideo().hasVideo, false);
});

test("SPA nach einem leeren Hauptplayer armiert die Discovery neu; ein vorhandenes Video braucht keinen weiteren DOM-Observer", async t => {
  const p = await setup(t);
  p.video(); await Promise.resolve(); p.frame();
  const discovered = p.observers.length;
  p.win.dispatchEvent(new p.win.Event("pageshow")); p.frame();
  assert.equal(p.observers.length, discovered, "a current media node needs only its own ResizeObserver");
  p.root.replaceChildren();
  p.win.dispatchEvent(new p.win.Event("yt-navigate-finish")); p.frame();
  assert.equal(p.posts.at(-1).hasVideo, false);
  assert.equal(p.observers.filter(observer => observer.connected).length, 1);
  p.video(); await Promise.resolve(); p.frame();
  assert.equal(p.posts.at(-1).hasVideo, true);
  assert.equal(p.observers.filter(observer => observer.connected).length, 0);
  assert.equal(p.timers.size, 0);
});
