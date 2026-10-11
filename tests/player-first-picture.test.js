const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/PlayerRect.js"), "utf8");

function setup(t, capability = true) {
  const dom = new JSDOM('<div id="movie_player"><video></video></div>', {
    url: "https://m.youtube.com/watch?v=abcdefghijk", runScripts: "outside-only",
  });
  const win = dom.window, root = win.document.getElementById("movie_player");
  const frames = new Map(), pictures = new Map(), cancelled = [], posts = [];
  let serial = 0, actualID = "abcdefghijk", reads = 0, registrations = 0;
  t.after(() => { win.dispatchEvent(new win.Event("pagehide")); win.close(); });
  win.requestAnimationFrame = callback => { const id = ++serial; frames.set(id, callback); return id; };
  win.cancelAnimationFrame = id => frames.delete(id);
  win.webkit = { messageHandlers: { langformPlayer: { postMessage(value) { posts.push(value); } } } };
  root.getVideoData = () => ({ video_id: actualID });
  function configure(video) {
    Object.defineProperties(video, {
      readyState: { value: 2, writable: true }, videoWidth: { value: 1280 }, videoHeight: { value: 720 },
    });
    video.getBoundingClientRect = () => { reads++; return { left: 0, top: 0, width: 390, height: 219 }; };
    if (capability) {
      video.requestVideoFrameCallback = callback => {
        registrations++;
        if (capability === "throws") throw new Error("unsupported media element");
        const id = ++serial; pictures.set(id, callback); return id;
      };
      video.cancelVideoFrameCallback = id => { cancelled.push(id); pictures.delete(id); };
    }
    return video;
  }
  let video = configure(root.querySelector("video"));
  win.eval(source);
  return {
    win, root, frames, pictures, cancelled, posts,
    measure: () => win.__langformMeasureVideo(),
    get video() { return video; }, get registrations() { return registrations; }, get reads() { return reads; },
    actual: id => { actualID = id; },
    emit: name => video.dispatchEvent(new win.Event(name)),
    frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
    present() { const pending = [...pictures.values()]; pictures.clear(); pending.forEach(callback => callback(1, { presentedFrames: 1 })); },
    replace() { const replacement = configure(win.document.createElement("video")); video.replaceWith(replacement); video = replacement; },
  };
}

test("decoded cold media keeps its poster until one compositor frame and does not observe continuously", t => {
  const s = setup(t);
  let report = s.measure();
  assert.equal(report.mediaReady, true, "decoded metadata/data remain available for the early page reveal");
  assert.equal(report.mediaPresented, false, "readyState is no evidence of a presented video frame");
  assert.equal(report.frameObservationSupported, true);
  assert.equal(s.registrations, 1);
  s.present(); s.frame();
  report = s.posts.at(-1);
  assert.equal(report.mediaPresented, true);
  assert.equal(report.mediaReady, true);
  assert.equal(s.pictures.size, 0);
  const reports = s.posts.length;
  for (let index = 0; index < 100; index++) { s.emit("loadeddata"); s.frame(); }
  assert.equal(s.registrations, 1, "the acknowledgement is one-shot for this source");
  assert.equal(s.posts.length, reports, "unchanged readiness remains deduplicated");
  assert.equal(s.video.getAttribute("style"), null, "reporting never rewrites the media layout");
});

test("a retained old media node or stale callback cannot present its replacement", t => {
  const s = setup(t);
  s.measure();
  const oldCallback = [...s.pictures.values()][0];
  s.replace();
  assert.equal(s.measure().mediaPresented, false);
  assert.equal(s.cancelled.length, 1);
  assert.equal(s.pictures.size, 1, "replacement receives its own first-frame observation");
  oldCallback(1, { presentedFrames: 1 }); s.frame();
  assert.equal(s.measure().mediaPresented, false);
  s.present(); s.frame();
  assert.equal(s.measure().mediaPresented, true);
});

test("new source events on the same element invalidate former decoded frames", t => {
  const s = setup(t);
  s.measure();
  const oldCallback = [...s.pictures.values()][0];
  s.video.readyState = 0; s.emit("loadstart"); s.frame();
  assert.equal(s.measure().mediaReady, false);
  assert.equal(s.cancelled.length, 1);
  s.video.readyState = 2; s.emit("loadeddata"); s.frame();
  oldCallback(1, { presentedFrames: 1 }); s.frame();
  assert.equal(s.measure().mediaPresented, false);
  s.present(); s.frame();
  assert.equal(s.measure().mediaPresented, true);
  s.emit("loadedmetadata"); s.frame();
  assert.equal(s.measure().mediaPresented, false, "fresh source metadata cannot inherit the former picture");
});

test("mismatched route/player identities and foreign previews never dismiss the requested poster", t => {
  const s = setup(t);
  s.measure();
  const preview = s.win.document.createElement("video"); s.root.before(preview);
  preview.dispatchEvent(new s.win.Event("loadeddata"));
  assert.equal(s.registrations, 1);
  s.actual("lmnopqrstuv"); s.present(); s.frame();
  assert.equal(s.measure().mediaPresented, false);
  assert.equal(s.measure().mediaReady, false);
  s.actual("abcdefghijk"); s.measure();
  s.win.history.replaceState({}, "", "/watch?v=lmnopqrstuv");
  s.present(); s.frame();
  assert.equal(s.measure().mediaPresented, false, "a changed URL cannot use the cold document's frame");
});

test("pagehide cancels the observer and late callbacks cannot schedule native reports or layout", t => {
  const s = setup(t);
  s.measure();
  const callback = [...s.pictures.values()][0], reads = s.reads;
  s.win.dispatchEvent(new s.win.Event("pagehide"));
  callback(1, { presentedFrames: 1 });
  assert.equal(s.pictures.size, 0);
  assert.equal(s.frames.size, 0);
  assert.equal(s.posts.length, 0);
  assert.equal(s.reads, reads);
  assert.equal(s.measure().mediaPresented, false);
  s.win.dispatchEvent(new s.win.Event("pageshow")); s.frame();
  assert.equal(s.pictures.size, 1, "restored page observes its current surface once");
  s.present(); s.frame();
  assert.equal(s.posts.at(-1).mediaPresented, true);
});

for (const capability of [false, "throws"]) {
  test("missing/failed frame capability exposes a bounded decoded-picture fallback: " + capability, t => {
    const s = setup(t, capability);
    for (let index = 0; index < 20; index++) {
      const report = s.measure();
      assert.equal(report.mediaReady, true);
      assert.equal(report.mediaPresented, false);
      assert.equal(report.frameObservationSupported, false);
    }
    assert.equal(s.registrations, capability ? 1 : 0, "a failing capability is attempted once, never polled");
  });
}
