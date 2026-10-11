const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const summary = require(process.env.LANGFORM_SUMMARY_SCRIPT ? require("node:path").resolve(process.env.LANGFORM_SUMMARY_SCRIPT) : "../extension/src/summary.js");

const ID = "abcdefghijk";
const result = { summary: { points: ["Der Versuch ist noch nicht abgeschlossen."] } };
const player = "ytInitialPlayerResponse=" + JSON.stringify({
  videoDetails: { videoId: ID },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: [
    { languageCode: "de", baseUrl: "https://m.youtube.com/api/timedtext?v=" + ID },
  ] } },
}) + ";";
const captions = JSON.stringify({ events: [{ segs: [{ utf8: "Der Versuch ist noch nicht abgeschlossen." }] }] });
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

function ui(t) {
  const dom = new JSDOM('<!DOCTYPE html><body><ytm-video-with-context-renderer><a href="/watch?v=' + ID + '">Film</a></ytm-video-with-context-renderer></body>', { url: "https://m.youtube.com/" });
  const win = dom.window;
  t.after(() => win.close());
  const timers = new Map();
  const realSet = win.setTimeout.bind(win), realClear = win.clearTimeout.bind(win);
  let serial = 100000;
  win.setTimeout = (fn, delay) => {
    if (delay === 30000 || delay === 180000) { const id = ++serial; timers.set(id, { fn, delay }); return id; }
    return realSet(fn, delay);
  };
  win.clearTimeout = id => { if (!timers.delete(id)) realClear(id); };
  const hostRequests = [];
  win.webkit = { messageHandlers: { langformSummary: { postMessage(request) {
    hostRequests.push(request);
    win.__langformKurzFinish(request.id, result);
  } } } };
  win.fetch = async href => ({ ok: true, text: async () => new URL(href).pathname === "/watch" ? player : captions });
  summary.decorate(win.document, win.location.href, win);
  return {
    win, timers, hostRequests,
    open() { win.document.querySelector('[data-langform-kurz="' + ID + '"]').click(); },
    sheet() { return win.document.getElementById("langform-kurzfassung"); },
    expire(delay) { const timer = [...timers.values()].find(timer => timer.delay === delay); assert.ok(timer, "Eine eigene Frist muss existieren"); timer.fn(); },
  };
}

for (const target of ["watch", "captions"]) for (const stage of ["headers", "body"]) {
  test("iPhone Kurzfassung: ausbleibende " + target + "-" + stage + " enden mit Retry; nur Nutzertipp startet neu", async t => {
    const env = ui(t);
    let attempt = 0, oldSignal, lateReply;
    env.win.fetch = (href, options) => {
      attempt++;
      if (attempt === (target === "watch" ? 1 : 2)) {
        oldSignal = options.signal;
        const stalled = new Promise(resolve => { lateReply = resolve; });
        return stage === "headers" ? stalled : Promise.resolve({ ok: true, text: () => stalled });
      }
      return Promise.resolve({ ok: true, text: async () => new URL(href).pathname === "/watch" ? player : captions });
    };
    env.open(); await tick();
    assert.equal(env.sheet().getAttribute("data-summary-state"), "pending");
    env.expire(30000); await tick();
    assert.equal(oldSignal.aborted, true);
    assert.equal(attempt, target === "watch" ? 1 : 2, "Kein automatischer erneuter Abruf nach der Frist");
    assert.equal(env.hostRequests.length, 0);
    assert.equal(env.sheet().getAttribute("data-summary-state"), "error");
    assert.equal(Object.keys(env.win.__langformKurzRequests.pending).length, 0);
    const retry = env.sheet().querySelector(".langform-kurz-retry");
    assert.ok(retry);
    retry.click(); await tick();
    assert.equal(env.sheet().getAttribute("data-summary-state"), "ready");
    assert.equal(env.hostRequests.length, 1);
    lateReply(stage === "headers" ? { ok: true, text: async () => "veraltet" } : "veraltet");
    await tick();
    assert.equal(env.sheet().getAttribute("data-summary-state"), "ready");
    assert.deepEqual([...env.sheet().querySelectorAll("li")].map(item => item.textContent), result.summary.points);
    assert.equal(env.timers.size, 0, "Abgeschlossene Fristen werden entfernt");
  });
}

test("iPhone Host-Frist entfernt den Waiter, gibt Retry frei und ignoriert alte Antworten", async t => {
  const env = ui(t);
  env.win.webkit.messageHandlers.langformSummary.postMessage = request => env.hostRequests.push(request);
  env.open(); await tick();
  const oldId = env.hostRequests[0].id;
  env.expire(180000); await tick();
  assert.equal(env.sheet().getAttribute("data-summary-state"), "error");
  assert.equal(Object.keys(env.win.__langformKurzWait).length, 0);
  assert.equal(Object.keys(env.win.__langformKurzRequests.pending).length, 0);
  env.sheet().querySelector(".langform-kurz-retry").click(); await tick();
  assert.equal(env.hostRequests.length, 2);
  env.win.__langformKurzFinish(oldId, result); await tick();
  assert.equal(env.sheet().getAttribute("data-summary-state"), "pending");
  env.win.__langformKurzFinish(env.hostRequests[1].id, result); await tick();
  assert.equal(env.sheet().getAttribute("data-summary-state"), "ready");
  assert.equal(env.timers.size, 0);
});
