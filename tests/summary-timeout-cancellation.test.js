const test = require("node:test");
const assert = require("node:assert/strict");
const { ns, fixture } = require("./helpers");

const summary = ns.summary;
const VIDEO_ID = "aqz-KE-bpKQ";
const CAPTIONS = fixture("summary/heidepark.de.txt");
const PROGRESS = { progress: {
  phase: "reading", processedSections: 0, totalSections: 8,
  sourceIncomplete: false, coverageIncomplete: false,
} };
const SUCCESS = { summary: { points: ["Die Bewertung bleibt an die Beobachtungen im Video gebunden."] } };

// Keep every callback, including cleared ones, so a timer already queued by
// WebKit can be delivered after the request settles. The actual loadSummary
// entry reads a real caption fixture and installs the shipping bridge handlers.
function webView(options = {}) {
  let nextTimer = 0;
  const timers = new Map();
  const callbacks = new Map();
  const cleared = [];
  const messages = [];
  const requests = [];
  const arrivals = [];
  const host = {
    setTimeout(callback, milliseconds) {
      const timer = ++nextTimer;
      timers.set(timer, { callback, milliseconds });
      callbacks.set(timer, callback);
      return timer;
    },
    clearTimeout(timer) {
      cleared.push(timer);
      timers.delete(timer);
    },
    webkit: { messageHandlers: { langformSummary: {
      postMessage(message) {
        messages.push(message);
        if (message.cancel === true) {
          if (options.onCancel) options.onCancel(message, host);
          if (options.throwOnCancel) throw new Error("WebView is no longer available");
        } else {
          requests.push(message);
          arrivals.shift()(message);
        }
      },
    } } },
  };
  return {
    host, timers, cleared, messages, requests,
    async start(onProgress) {
      const arrival = new Promise(resolve => arrivals.push(resolve));
      const pending = summary.loadSummary(VIDEO_ID, {
        host, watchPage: true, sourceIncomplete: false, onProgress,
        player: { videoDetails: { videoId: VIDEO_ID }, captions: {
          playerCaptionsTracklistRenderer: { captionTracks: [{
            baseUrl: "https://www.youtube.com/api/timedtext?v=" + VIDEO_ID,
            languageCode: "de",
          }] },
        } },
        fetchText: async () => JSON.stringify({ events: [{ segs: [{ utf8: CAPTIONS }] }] }),
      });
      const request = await arrival;
      assert.equal(request.text, summary.textFromCaptions(JSON.stringify({ events: [{ segs: [{ utf8: CAPTIONS }] }] })),
        "Die tatsächliche Untertitelroute muss die gesamte Fixture an den Host übergeben");
      assert.equal(request.sourceIncomplete, false);
      assert.equal(typeof request.id, "string");
      const timer = nextTimer;
      assert.equal(timers.get(timer).milliseconds, 240000, "Vollständige lokale Analyse und ein begrenzter Korrekturschritt teilen eine Vier-Minuten-Frist");
      return { request, timer, pending };
    },
    expire(timer) {
      assert.equal(typeof callbacks.get(timer), "function");
      callbacks.get(timer)();
    },
    cancellations() { return messages.filter(message => message.cancel === true); },
  };
}

function assertClean(bridge, ticket) {
  assert.equal(bridge.host.__langformKurzWait[ticket.request.id], undefined);
  assert.equal(bridge.host.__langformKurzProgressWait[ticket.request.id], undefined);
  assert.equal(bridge.timers.has(ticket.timer), false);
  assert.ok(bridge.cleared.includes(ticket.timer), "Der zugehörige Hosttimer muss entfernt werden");
}

test("WebView-Timeout widerruft genau sein Ticket vor dem Aufräumen und ignoriert späte Antworten", async () => {
  let openAtCancellation = false;
  const bridge = webView({ onCancel(message, host) {
    openAtCancellation = typeof host.__langformKurzWait[message.id] === "function" &&
      typeof host.__langformKurzProgressWait[message.id] === "function";
  } });
  const progress = [];
  const ticket = await bridge.start(value => progress.push(value));
  bridge.host.__langformKurzUpdate(ticket.request.id, PROGRESS);
  assert.equal(progress.length, 1, "Der echte Fortschrittskanal muss vor Ablauf aktiv sein");
  bridge.expire(ticket.timer);
  const result = await ticket.pending;
  assert.deepEqual(bridge.cancellations(), [{ id: ticket.request.id, cancel: true }]);
  assert.equal(openAtCancellation, true, "Native Arbeit muss vor dem Entfernen der Antwortkanäle widerrufen werden");
  assert.equal(result.code, "NATIVE_TIMEOUT");
  assert.match(result.message, /braucht zu lange/);
  assertClean(bridge, ticket);
  bridge.host.__langformKurzUpdate(ticket.request.id, PROGRESS);
  bridge.host.__langformKurzFinish(ticket.request.id, SUCCESS);
  bridge.expire(ticket.timer);
  assert.equal(progress.length, 1);
  assert.equal((await ticket.pending).code, "NATIVE_TIMEOUT");
  assert.equal(bridge.cancellations().length, 1, "Ein bereits erledigter Timeout darf keinen zweiten Abbruch senden");
});

for (const [name, response] of [
  ["erfolgreicher", SUCCESS],
  ["fehlgeschlagener", { code: "GENERATION_FAILED", message: "Die Kurzfassung konnte gerade nicht erstellt werden." }],
]) {
  test("Normaler " + name + " Hostabschluss räumt auf und sendet auch nach spätem Timer keinen Abbruch", async () => {
    const bridge = webView();
    const ticket = await bridge.start();
    bridge.host.__langformKurzFinish(ticket.request.id, response);
    const result = await ticket.pending;
    if (response.summary) assert.deepEqual(result.summary.points, response.summary.points);
    else assert.equal(result.code, response.code);
    assertClean(bridge, ticket);
    bridge.expire(ticket.timer);
    assert.deepEqual(bridge.cancellations(), []);
  });
}

test("Alter bereits beendeter Timer darf eine neuere WebView-Anfrage nicht abbrechen", async () => {
  const bridge = webView();
  const old = await bridge.start();
  bridge.host.__langformKurzFinish(old.request.id, SUCCESS);
  await old.pending;
  const seen = [];
  const current = await bridge.start(value => seen.push(value));
  assert.notEqual(old.request.id, current.request.id);
  bridge.expire(old.timer);
  assert.deepEqual(bridge.cancellations(), []);
  assert.equal(typeof bridge.host.__langformKurzWait[current.request.id], "function");
  assert.equal(typeof bridge.host.__langformKurzProgressWait[current.request.id], "function");
  assert.equal(bridge.timers.has(current.timer), true);
  bridge.host.__langformKurzUpdate(current.request.id, PROGRESS);
  assert.equal(seen.length, 1);
  bridge.host.__langformKurzFinish(current.request.id, SUCCESS);
  assert.deepEqual((await current.pending).summary.points, SUCCESS.summary.points);
  assertClean(bridge, current);
});

test("Werfender nativer Timeout-Abbruch beendet den sichtbaren Auftrag trotzdem und räumt auf", async () => {
  const bridge = webView({ throwOnCancel: true });
  const ticket = await bridge.start();
  assert.doesNotThrow(() => bridge.expire(ticket.timer));
  assert.equal((await ticket.pending).code, "NATIVE_TIMEOUT");
  assert.deepEqual(bridge.cancellations(), [{ id: ticket.request.id, cancel: true }]);
  assertClean(bridge, ticket);
  bridge.expire(ticket.timer);
  assert.equal(bridge.cancellations().length, 1);
});

test("Timeout eines noch offenen Tickets erhält Antwort, Fortschritt und Timer eines anderen Tickets", async () => {
  const bridge = webView();
  const old = await bridge.start();
  const seen = [];
  const current = await bridge.start(value => seen.push(value));
  assert.notEqual(old.request.id, current.request.id);
  bridge.expire(old.timer);
  assert.equal((await old.pending).code, "NATIVE_TIMEOUT");
  assert.deepEqual(bridge.cancellations(), [{ id: old.request.id, cancel: true }]);
  assertClean(bridge, old);
  assert.equal(typeof bridge.host.__langformKurzWait[current.request.id], "function");
  assert.equal(typeof bridge.host.__langformKurzProgressWait[current.request.id], "function");
  assert.equal(bridge.timers.has(current.timer), true);
  bridge.host.__langformKurzUpdate(current.request.id, PROGRESS);
  assert.equal(seen.length, 1);
  bridge.host.__langformKurzFinish(current.request.id, SUCCESS);
  assert.deepEqual((await current.pending).summary.points, SUCCESS.summary.points);
  assertClean(bridge, current);
  assert.equal(bridge.cancellations().length, 1);
});
