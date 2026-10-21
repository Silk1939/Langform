const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const summary = require("../extension/src/summary.js");

const VIDEO_ID = "aqz-KE-bpKQ";
const CAPTIONS = fs.readFileSync(path.join(__dirname, "fixtures/summary/heidepark.de.txt"), "utf8");
const SUCCESS = { summary: { points: ["Die Bewertung bleibt an die Beobachtungen im Video gebunden."] } };

function environment(withRelay = true) {
  let nextTimer = 0;
  const active = new Map();
  const callbacks = new Map();
  const nativeMessages = [];
  let reply;
  let arrived;
  const arrival = new Promise(resolve => { arrived = resolve; });
  const host = {
    setTimeout(callback, milliseconds) {
      const id = ++nextTimer;
      active.set(id, { callback, milliseconds });
      callbacks.set(id, callback);
      return id;
    },
    clearTimeout(id) { active.delete(id); },
    setInterval(callback, milliseconds) { return this.setTimeout(callback, milliseconds); },
    clearInterval(id) { active.delete(id); },
    webkit: { messageHandlers: { langformSummary: {
      postMessage(message) {
        nativeMessages.push(message);
        throw new Error("WebView bridge unavailable");
      },
    } } },
  };
  if (withRelay) host.browser = { runtime: {
    sendMessage(message) {
      assert.equal(message.type, "langform:summarize");
      assert.equal(message.text, summary.textFromCaptions(JSON.stringify({ events: [{ segs: [{ utf8: CAPTIONS }] }] })));
      return new Promise(resolve => { reply = resolve; arrived(); });
    },
  } };
  const pending = summary.loadSummary(VIDEO_ID, {
    host,
    watchPage: true,
    player: { videoDetails: { videoId: VIDEO_ID }, captions: {
      playerCaptionsTracklistRenderer: { captionTracks: [{
        baseUrl: "https://www.youtube.com/api/timedtext?v=" + VIDEO_ID,
        languageCode: "de",
      }] },
    } },
    fetchText: async () => JSON.stringify({ events: [{ segs: [{ utf8: CAPTIONS }] }] }),
  });
  return { host, active, callbacks, nativeMessages, pending, arrival, reply: payload => reply(payload) };
}

function assertWebViewReleased(env) {
  assert.deepEqual(Object.keys(env.host.__langformKurzWait), []);
  assert.deepEqual(Object.keys(env.host.__langformKurzProgressWait), []);
  assert.equal([...env.active.values()].some(timer => timer.milliseconds === 240000), false,
    "Die abgelehnte WebView-Anfrage darf keinen eigenen Timeout behalten");
}

test("Relay-Fallback entfernt den WebView-Timer und ignoriert seinen schon eingeplanten Callback", async () => {
  const env = environment();
  await env.arrival;
  assertWebViewReleased(env);
  // Even clearTimeout cannot revoke a callback already queued by the browser.
  env.callbacks.get(1)();
  assert.equal(env.nativeMessages.length, 1, "Der aufgegebene WebView-Pfad darf keinen Abbruch mehr senden");
  env.reply(SUCCESS);
  assert.deepEqual((await env.pending).summary.points, SUCCESS.summary.points);
  assert.equal(env.active.size, 0);
});

test("Relay-Fallback behält seine volle Frist und endet ohne fremden WebView-Abbruch", async () => {
  const env = environment();
  await env.arrival;
  assertWebViewReleased(env);
  const timeout = [...env.active.values()].find(timer => timer.milliseconds === 600000);
  assert.ok(timeout, "Der Browser-Relay behält seinen eigenen Zehn-Minuten-Timeout");
  timeout.callback();
  assert.equal((await env.pending).code, "NATIVE_TIMEOUT");
  assert.equal(env.active.size, 0);
  env.callbacks.get(1)();
  assert.equal(env.nativeMessages.length, 1);
});

test("Werfender WebView-Pfad ohne Fallback räumt seinen Timer und beide Antwortkanäle auf", async () => {
  const env = environment(false);
  assert.equal((await env.pending).code, "NATIVE_CONNECTION_FAILED");
  assertWebViewReleased(env);
  assert.equal(env.active.size, 0);
  env.callbacks.get(1)();
  assert.equal(env.nativeMessages.length, 1);
});
