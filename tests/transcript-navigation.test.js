const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const summary = require("../extension/src/summary.js");
const controller = require("../extension/src/controller.js");
const logic = require("../extension/src/logic.js");
const hide = require("../extension/src/hide.js");
const pageCaptions = require("../extension/src/page-captions.js");

const ID = "abcdefghijk", OTHER = "videoone111";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function player(id) {
  return { videoDetails: { videoId: id }, captions: { playerCaptionsTracklistRenderer: {
    captionTracks: [{ languageCode: "de", baseUrl: "https://www.youtube.com/api/timedtext?v=" + id }],
  } } };
}
function setup(t, enabled, history, nativePopstateListeners) {
  const dom = new JSDOM('<!doctype html><div id="movie_player"><video></video></div><ytd-watch-metadata><h1>Video</h1></ytd-watch-metadata>', {
    url: "https://www.youtube.com/watch?v=" + history[0],
  });
  const win = dom.window;
  t.after(() => win.close());
  for (const entry of history.slice(1)) win.history.pushState({}, "", "/watch?v=" + entry);
  if (nativePopstateListeners) {
    const addEventListener = win.addEventListener.bind(win);
    win.addEventListener = function (type, listener, options) {
      if (type === "popstate") nativePopstateListeners.push(listener);
      else addEventListener(type, listener, options);
    };
  }
  win.localStorage.setItem(logic.STORAGE_FLAG, "0");
  win.chrome = { runtime: { id: "test-extension", sendMessage() { assert.fail("Transkript must not request a model"); } } };
  const video = win.document.querySelector("video");
  Object.defineProperty(video, "paused", { get: () => false });
  video.play = video.pause = () => assert.fail("Navigation repair must not change playback");
  let scans = 0;
  win.ShortsAusblenden = { summary, logic, hide: { ...hide, scan(...args) { scans++; return hide.scan(...args); } } };
  controller.start(win, {
    local: { get(key, callback) { win.setTimeout(() => callback({ enabled }), 0); } },
    onChanged: { addListener() {} },
  });
  const actions = () => win.document.querySelectorAll("[data-langform-transcript]");
  return { win, actions, scans: () => scans };
}
async function back(win) {
  const navigated = new Promise(resolve => win.addEventListener("popstate", resolve, { once: true }));
  win.history.back();
  await navigated;
  await sleep(30);
}

for (const enabled of [true, false]) {
  test("Transkript bleibt bei wiederholtem Zeitmarken-Zurück während Wiedergabe erreichbar, Shortsfilter " + enabled, async t => {
    const ui = setup(t, enabled, [ID + "&t=0", ID + "&t=10", ID + "&t=20"]);
    await sleep(30);
    assert.equal(ui.actions().length, 1);
    const scans = ui.scans();
    for (const time of ["10", "0"]) {
      await back(ui.win);
      assert.equal(new URL(ui.win.location.href).searchParams.get("t"), time);
      assert.equal(ui.actions().length, 1, "The popstate cleanup must precede watch-action rebinding");
      assert.equal(ui.actions()[0].getAttribute("data-langform-transcript"), ID);
    }
    assert.equal(ui.scans(), scans, "Playing history navigation must not trigger a whole-feed scan");
  });
}

test("Browser-Microtask-Checkpoints zwischen Popstate-Listenern können die Wiederherstellung nicht vorziehen", async t => {
  const listeners = [];
  const ui = setup(t, false, [ID], listeners);
  await sleep(30);
  assert.equal(ui.actions().length, 1);
  // Real WKWebView history.back() checkpoints microtasks after each native
  // listener callback; jsdom dispatches its listeners on one JS stack.
  const event = new ui.win.PopStateEvent("popstate");
  for (const listener of listeners) {
    listener.call(ui.win, event);
    await Promise.resolve();
  }
  await sleep(30);
  assert.equal(ui.actions().length, 1);
});

test("Popstate zu anderem Video schließt altes Transkript und verwirft dessen verspätete Antwort", async t => {
  const ui = setup(t, false, [OTHER, ID]);
  let releaseOld, fetches = 0;
  const oldBody = new Promise(resolve => { releaseOld = resolve; });
  ui.win.ytInitialPlayerResponse = player(ID);
  ui.win.fetch = async () => ({ ok: true, text() {
    fetches++;
    return oldBody;
  } });
  pageCaptions.install(ui.win);
  await sleep(30);
  ui.actions()[0].querySelector("button").click();
  for (let i = 0; i < 100 && !fetches; i++) await sleep(5);
  assert.equal(fetches, 1);
  const oldSheet = ui.win.document.getElementById("langform-transcript");
  assert.ok(oldSheet);
  ui.win.ytInitialPlayerResponse = player(OTHER);
  await back(ui.win);
  assert.equal(oldSheet.isConnected, false);
  assert.equal(ui.win.document.getElementById("langform-transcript"), null);
  assert.equal(ui.actions().length, 1);
  assert.equal(ui.actions()[0].getAttribute("data-langform-transcript"), OTHER);
  releaseOld(JSON.stringify({ events: [{ segs: [{ utf8: "Veralteter Text" }] }] }));
  await sleep(30);
  assert.equal(ui.win.document.getElementById("langform-transcript"), null);
  assert.equal(ui.actions()[0].querySelector("button").getAttribute("aria-expanded"), "false");
});
