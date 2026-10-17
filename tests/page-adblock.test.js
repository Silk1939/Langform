const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const adblock = require("../extension/src/page-adblock.js");

const plain = value => JSON.parse(JSON.stringify(value));

function player() {
  return {
    adPlacements: [{ adPlacementRenderer: { adBreakServiceRenderer: {} } }],
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
    adSlots: [{ adSlotRenderer: {} }],
    videoDetails: { videoId: "abcdefghijk", title: "Main video", lengthSeconds: "500" },
    streamingData: { formats: [{ itag: 18, url: "https://media.example.test/main?adSlots=keep" }] },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: "/api/timedtext?v=abcdefghijk" }] } },
    playabilityStatus: { status: "OK", reason: "Original status" },
    attestation: { playerAttestationRenderer: { challenge: "original-challenge" } },
    drmFamilies: ["WIDEVINE"],
    playerConfig: { mediaCommonConfig: { dynamicReadaheadConfig: {} } },
  };
}

function withoutAds(value) {
  const result = plain(value);
  delete result.adPlacements;
  delete result.playerAds;
  delete result.adSlots;
  return result;
}

function fakeXHR(win) {
  return class FixtureXHR {
    constructor() {
      this.readyState = 0;
      this.status = 0;
      this.statusText = "";
      this.responseType = "";
      this.responseURL = "";
      this.calls = [];
      this._text = "";
      this._value = null;
    }
    open(...args) {
      if (args[1] === "invalid:fixture") throw new win.DOMException("Invalid fixture URL", "SyntaxError");
      this.calls.push(["open", ...args]);
      this.readyState = 1;
      this.responseURL = String(args[1]);
    }
    send(body) { this.calls.push(["send", body]); }
    setRequestHeader(...args) { this.calls.push(["header", ...args]); }
    get responseText() {
      if (this.responseType !== "" && this.responseType !== "text") {
        throw new win.DOMException("responseText requires a text response", "InvalidStateError");
      }
      return this._text;
    }
    get response() {
      return this.responseType === "" || this.responseType === "text" ? this._text : this._value;
    }
    complete(options = {}) {
      this.readyState = options.readyState ?? 4;
      this.status = options.status ?? 200;
      this.statusText = options.statusText ?? "OK";
      this.responseType = options.type ?? "";
      this._text = options.text ?? JSON.stringify(player());
      this._value = options.value ?? player();
    }
  };
}

function setup(t, options = {}) {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: options.url || "https://www.youtube.com/watch?v=abcdefghijk",
    runScripts: "outside-only",
  });
  const win = dom.window;
  // Real WHATWG responses exercise body consumption, clones and native errors.
  // A per-window subclass keeps prototype instrumentation out of other tests.
  win.Response = class WindowResponse extends Response {};
  win.Request = Request;
  win.Headers = Headers;
  win.XMLHttpRequest = fakeXHR(win);
  const calls = [];
  let respond = options.respond || (() => new win.Response(JSON.stringify(player()), {
    status: 200,
    headers: { "content-type": "application/json", "x-fixture": "original" },
  }));
  win.fetch = function (...args) {
    calls.push({ receiver: this, args });
    return Promise.resolve().then(() => respond(...args));
  };
  const nativeParse = win.JSON.parse;
  const nativeFetch = win.fetch;
  t.after(() => { win.dispatchEvent(new win.Event("pagehide")); win.close(); });
  if (options.install !== false) adblock.install(win);
  return { win, calls, nativeParse, nativeFetch, respond: value => { respond = value; } };
}

test("prune removes only the supported root ad keys and retains all ordinary player data", () => {
  const payload = player();
  const expected = withoutAds(payload);
  const streaming = payload.streamingData;
  const captions = payload.captions;
  const result = adblock.prune(payload);
  assert.equal(result, payload);
  assert.deepEqual(result, expected);
  assert.equal(result.streamingData, streaming);
  assert.equal(result.captions, captions);
});

test("known player-response wrappers and batches are pruned without walking media or application data", () => {
  const protectedData = { adSlots: ["keep"], adPlacements: ["keep"], playerAds: ["keep"] };
  const payload = {
    response: { playerResponse: player() },
    playerResponse: { ...player(), captions: protectedData, streamingData: protectedData },
    unrelated: { nested: protectedData },
  };
  const batch = [payload, { playerResponse: player() }];
  assert.equal(adblock.prune(batch), batch);
  assert.equal("adSlots" in payload.response.playerResponse, false);
  assert.equal("playerAds" in payload.playerResponse, false);
  assert.equal("adPlacements" in batch[1].playerResponse, false);
  assert.deepEqual(protectedData, { adSlots: ["keep"], adPlacements: ["keep"], playerAds: ["keep"] });
  assert.equal(payload.unrelated.nested, protectedData);
});

test("frozen fields, nonconfigurable ad properties and cyclic wrappers never break callers", () => {
  const frozen = Object.freeze(player());
  assert.equal(adblock.prune(frozen), frozen);
  assert.ok(frozen.adSlots);
  const payload = player();
  Object.defineProperty(payload, "adSlots", { value: ["locked"], configurable: false });
  payload.playerResponse = payload;
  assert.equal(adblock.prune(payload), payload);
  assert.deepEqual(payload.adSlots, ["locked"]);
  assert.equal("adPlacements" in payload, false);
  assert.equal("playerAds" in payload, false);
  assert.equal(payload.playerResponse, payload);
});

test("pruneText changes valid ad JSON while malformed and untouched text retain their exact bytes", () => {
  const raw = JSON.stringify(player());
  assert.deepEqual(JSON.parse(adblock.pruneText(raw)), withoutAds(player()));
  for (const text of ["{invalid", ")]}\n{\"adSlots\":[]}", "", "  { \"videoDetails\" : { \"videoId\" : \"abcdefghijk\" } }  ", "plain adSlots text"]) {
    assert.equal(adblock.pruneText(text), text);
  }
});

test("the JSON.parse hook preserves native failures and reviver receiver, traversal and return semantics", t => {
  const s = setup(t);
  for (const value of ["{", "undefined", "", "[1,]"]) {
    let nativeError;
    try { s.nativeParse(value); } catch (error) { nativeError = error; }
    assert.throws(() => s.win.JSON.parse(value), error => error.name === nativeError.name && error.message === nativeError.message);
  }
  const trace = [];
  const result = s.win.JSON.parse('{"count":2,"nested":{"count":3}}', function (key, value) {
    trace.push({ key, owns: Object.prototype.hasOwnProperty.call(this, key), value: plain(value) });
    return key === "count" ? value * 10 : value;
  });
  assert.deepEqual(plain(result), { count: 20, nested: { count: 30 } });
  assert.deepEqual(trace.map(item => item.key), ["count", "count", "nested", ""]);
  assert.ok(trace.every(item => item.owns));
  assert.equal(trace[2].value.count, 30);
});

test("JSON.parse runs the caller's reviver once and then removes supported ad keys", t => {
  const s = setup(t);
  const seen = [];
  let root;
  const result = s.win.JSON.parse(JSON.stringify(player()), function (key, value) {
    seen.push(key);
    if (key === "") root = value;
    return value;
  });
  assert.equal(root, result);
  assert.equal(seen.filter(key => key === "adSlots").length, 1);
  assert.equal(seen.filter(key => key === "").length, 1);
  assert.deepEqual(plain(result), withoutAds(player()));
});

test("generic JSON fields named like ad slots remain unchanged outside a recognized player context", async t => {
  const s = setup(t);
  const ordinary = { foo: "application-data", adSlots: [{ id: "keep" }], adPlacements: ["keep"], playerAds: ["keep"] };
  const raw = JSON.stringify(ordinary);
  assert.deepEqual(plain(s.win.JSON.parse(raw)), ordinary);
  assert.equal(adblock.pruneText(raw), raw);
  const direct = plain(ordinary);
  assert.equal(adblock.prune(direct), direct);
  assert.deepEqual(direct, ordinary);
  s.respond(() => new s.win.Response(raw));
  const unrelated = await s.win.fetch("https://other.example/application-data");
  assert.deepEqual(plain(await unrelated.json()), ordinary);
  const target = await s.win.fetch("/youtubei/v1/player");
  assert.deepEqual(plain(await target.json()), { foo: "application-data" }, "an explicitly matched player response supplies the missing context");
});

test("already present and later assigned initial player globals are pruned", t => {
  const s = setup(t, { install: false });
  const initial = player();
  s.win.ytInitialPlayerResponse = initial;
  adblock.install(s.win);
  assert.equal(s.win.ytInitialPlayerResponse, initial);
  assert.deepEqual(plain(initial), withoutAds(player()));
  for (const name of ["ytInitialPlayerResponse", "playerResponse"]) {
    const replacement = player();
    s.win[name] = replacement;
    assert.equal(s.win[name], replacement);
    assert.deepEqual(plain(s.win[name]), withoutAds(player()));
  }
  s.win.ytplayer = { config: { args: { player_response: JSON.stringify(player()), raw_player_response: player() } } };
  assert.deepEqual(JSON.parse(s.win.ytplayer.config.args.player_response), withoutAds(player()));
  assert.deepEqual(plain(s.win.ytplayer.config.args.raw_player_response), withoutAds(player()));
  s.win.ytplayer.config.args = { player_response: JSON.stringify(player()) };
  assert.deepEqual(JSON.parse(s.win.ytplayer.config.args.player_response), withoutAds(player()));
});

test("an existing configurable initial-response accessor retains its getter and setter effects", t => {
  const s = setup(t, { install: false });
  let stored = player();
  let reads = 0;
  let writes = 0;
  Object.defineProperty(s.win, "ytInitialPlayerResponse", {
    configurable: true,
    enumerable: true,
    get() { reads += 1; return stored; },
    set(value) { writes += 1; stored = value; },
  });
  adblock.install(s.win);
  const before = reads;
  assert.deepEqual(plain(s.win.ytInitialPlayerResponse), withoutAds(player()));
  assert.ok(reads > before);
  s.win.ytInitialPlayerResponse = player();
  assert.equal(writes, 1);
  assert.deepEqual(plain(s.win.ytInitialPlayerResponse), withoutAds(player()));
});

test("nonconfigurable and frozen initial globals do not prevent the remaining hooks from installing", t => {
  const s = setup(t, { install: false });
  const locked = Object.freeze(player());
  Object.defineProperty(s.win, "ytInitialPlayerResponse", { configurable: false, writable: false, value: locked });
  assert.doesNotThrow(() => adblock.install(s.win));
  assert.equal(s.win.ytInitialPlayerResponse, locked);
  assert.ok(locked.adSlots);
  assert.deepEqual(plain(s.win.JSON.parse(JSON.stringify(player()))), withoutAds(player()));
});

test("installation is confined to supported YouTube origins", t => {
  for (const url of ["https://example.test/", "https://www.youtube.com.example.test/watch", "http://www.youtube.com/watch"]) {
    const s = setup(t, { url });
    assert.equal(s.win.JSON.parse, s.nativeParse, url);
    assert.equal(s.win.fetch, s.nativeFetch, url);
    assert.ok(s.win.JSON.parse(JSON.stringify(player())).adSlots, url);
  }
});

test("matching fetch endpoints prune actual response JSON and text while consuming the body normally", async t => {
  const s = setup(t);
  for (const endpoint of [
    "/youtubei/v1/player?prettyPrint=false", "/youtubei/v1/get_watch", "/youtubei/v1/next", "/youtubei/v2/player/", "/playlist?list=fixture",
    "https://m.youtube.com/youtubei/v1/player",
  ]) {
    const jsonResponse = await s.win.fetch(endpoint);
    assert.equal(jsonResponse.bodyUsed, false);
    assert.deepEqual(plain(await jsonResponse.json()), withoutAds(player()), endpoint);
    assert.equal(jsonResponse.bodyUsed, true);
    await assert.rejects(jsonResponse.json(), TypeError);
    const textResponse = await s.win.fetch(endpoint);
    assert.deepEqual(JSON.parse(await textResponse.text()), withoutAds(player()), endpoint);
    assert.equal(textResponse.bodyUsed, true);
    await assert.rejects(textResponse.text(), TypeError);
  }
});

test("fetch receives the original request, options, body, headers and receiver exactly once", async t => {
  const s = setup(t);
  const request = new s.win.Request("https://www.youtube.com/youtubei/v1/player", {
    method: "POST", body: '{"videoId":"abcdefghijk"}', headers: { "x-fixture": "request" }, credentials: "include",
  });
  const options = { signal: new AbortController().signal, cache: "no-store" };
  const receiver = { fixture: true };
  const response = await s.win.fetch.call(receiver, request, options);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].receiver, receiver);
  assert.equal(s.calls[0].args[0], request);
  assert.equal(s.calls[0].args[1], options);
  assert.equal(request.bodyUsed, false);
  assert.equal(request.headers.get("x-fixture"), "request");
  assert.deepEqual(plain(await response.json()), withoutAds(player()));
});

test("cloned target responses read independently and preserve native consumed-body errors", async t => {
  const s = setup(t);
  const response = await s.win.fetch("/youtubei/v1/player");
  const clone = response.clone();
  assert.deepEqual(JSON.parse(await clone.text()), withoutAds(player()));
  assert.equal(clone.bodyUsed, true);
  assert.equal(response.bodyUsed, false);
  assert.deepEqual(plain(await response.json()), withoutAds(player()));
  assert.throws(() => response.clone(), TypeError);
  await assert.rejects(clone.json(), TypeError);
});

test("Response.prototype.json.call accepts a filtered fetch response and retains native body errors", async t => {
  const s = setup(t);
  const response = await s.win.fetch("/youtubei/v1/player");
  assert.equal(response.bodyUsed, false);
  const value = await s.win.Response.prototype.json.call(response);
  assert.deepEqual(plain(value), withoutAds(player()));
  assert.equal(response.bodyUsed, true);
  await assert.rejects(async () => s.win.Response.prototype.json.call(response), TypeError);
  s.respond(() => new s.win.Response("{invalid"));
  const malformed = await s.win.fetch("/youtubei/v1/player");
  await assert.rejects(async () => s.win.Response.prototype.json.call(malformed), SyntaxError);
  assert.equal(malformed.bodyUsed, true);
});

test("Response.prototype.text.call accepts filtered responses without changing unrelated reads", async t => {
  const s = setup(t);
  const response = await s.win.fetch("/youtubei/v1/player");
  assert.deepEqual(JSON.parse(await s.win.Response.prototype.text.call(response)), withoutAds(player()));
  assert.equal(response.bodyUsed, true);
  await assert.rejects(async () => s.win.Response.prototype.text.call(response), TypeError);
  const unrelated = await s.win.fetch("https://other.example/application-data");
  assert.equal(await s.win.Response.prototype.text.call(unrelated), JSON.stringify(player()));
  assert.equal(unrelated.bodyUsed, true);
});

test("Response.prototype.clone.call preserves independently readable filtered bodies", async t => {
  const s = setup(t);
  const response = await s.win.fetch("/youtubei/v1/player");
  const clone = s.win.Response.prototype.clone.call(response);
  assert.equal(response.bodyUsed, false);
  assert.equal(clone.bodyUsed, false);
  assert.deepEqual(JSON.parse(await s.win.Response.prototype.text.call(clone)), withoutAds(player()));
  assert.equal(clone.bodyUsed, true);
  assert.equal(response.bodyUsed, false);
  assert.deepEqual(plain(await s.win.Response.prototype.json.call(response)), withoutAds(player()));
  assert.throws(() => s.win.Response.prototype.clone.call(response), TypeError);
});

test("borrowed response methods preserve invalid-receiver failures and become inactive on pagehide", async t => {
  const s = setup(t);
  for (const method of ["json", "text"]) {
    await assert.rejects(async () => s.win.Response.prototype[method].call({}), TypeError);
  }
  assert.throws(() => s.win.Response.prototype.clone.call({}), TypeError);
  const normal = new s.win.Response(JSON.stringify(player()));
  assert.deepEqual(plain(await s.win.Response.prototype.json.call(normal)), player());
  const pending = await s.win.fetch("/youtubei/v1/player");
  s.win.dispatchEvent(new s.win.Event("pagehide"));
  assert.deepEqual(plain(await s.win.Response.prototype.json.call(pending)), player());
  s.win.dispatchEvent(new s.win.Event("pageshow"));
  const resumed = await s.win.fetch("/youtubei/v1/player");
  assert.deepEqual(JSON.parse(await s.win.Response.prototype.text.call(resumed)), withoutAds(player()));
});

test("unrelated origins, media, captions, DRM and lookalike endpoints pass through byte-for-byte", async t => {
  const s = setup(t);
  const raw = JSON.stringify(player());
  for (const endpoint of [
    "https://other.example/youtubei/v1/player", "https://www.youtube.com.example.test/youtubei/v1/player",
    "http://www.youtube.com/youtubei/v1/player", "/youtubei/v1/player_extra", "/youtubei/v1/player/other",
    "/youtubei/v1/license", "/api/timedtext?v=abcdefghijk", "/videoplayback?id=fixture", "/playlist/other",
    "/youtubei/v1/player?get_drm_license=1", "https://www.youtube.com:8443/youtubei/v1/player",
  ]) {
    const textResponse = await s.win.fetch(endpoint);
    assert.equal(await textResponse.text(), raw, endpoint);
    const jsonResponse = await s.win.fetch(endpoint);
    assert.deepEqual(plain(await jsonResponse.json()), player(), endpoint);
  }
});

test("a target request redirected to an unrelated origin does not filter that response", async t => {
  const s = setup(t);
  s.respond(() => {
    const response = new s.win.Response(JSON.stringify(player()));
    Object.defineProperty(response, "url", { value: "https://other.example/redirected-player" });
    return response;
  });
  const response = await s.win.fetch("/youtubei/v1/player");
  assert.equal(response.url, "https://other.example/redirected-player");
  assert.deepEqual(plain(await response.json()), player());
  const xhr = new s.win.XMLHttpRequest();
  xhr.open("GET", "/youtubei/v1/player");
  xhr.complete();
  xhr.responseURL = "https://other.example/redirected-player";
  assert.equal(xhr.responseText, JSON.stringify(player()));
});

test("fetch metadata, malformed bodies and network rejections retain their native behavior", async t => {
  const s = setup(t);
  s.respond(() => new s.win.Response("{not-json", { status: 503, statusText: "Fixture failure", headers: { "x-fixture": "original" } }));
  const response = await s.win.fetch("/youtubei/v1/player");
  assert.equal(response.status, 503);
  assert.equal(response.statusText, "Fixture failure");
  assert.equal(response.ok, false);
  assert.equal(response.headers.get("x-fixture"), "original");
  assert.equal(await response.text(), "{not-json");
  const malformed = await s.win.fetch("/youtubei/v1/player");
  await assert.rejects(malformed.json(), SyntaxError);
  assert.equal(malformed.bodyUsed, true);
  const failure = new Error("Fixture network failure");
  s.respond(() => { throw failure; });
  const before = s.calls.length;
  await assert.rejects(s.win.fetch("/youtubei/v1/player"), error => error === failure);
  assert.equal(s.calls.length, before + 1);
});

test("empty target responses and unchanged player JSON keep ordinary body semantics", async t => {
  const s = setup(t);
  s.respond(() => new s.win.Response(null, { status: 204 }));
  const empty = await s.win.fetch("/youtubei/v1/player");
  assert.equal(empty.status, 204);
  assert.equal(await empty.text(), "");
  const raw = '  { "videoDetails" : { "videoId" : "abcdefghijk" }, "playabilityStatus" : { "status" : "LOGIN_REQUIRED" } }  ';
  s.respond(() => new s.win.Response(raw));
  const unchanged = await s.win.fetch("/youtubei/v1/player");
  assert.equal(await unchanged.text(), raw);
});

test("XHR prunes successful completed target text and JSON without changing request operations", t => {
  const s = setup(t);
  for (const type of ["", "text", "json"]) {
    const xhr = new s.win.XMLHttpRequest();
    xhr.open("POST", "/youtubei/v1/player", true, "fixture-user");
    xhr.setRequestHeader("x-fixture", "original");
    xhr.send("original-body");
    const value = player();
    xhr.complete({ type, value });
    assert.deepEqual(xhr.calls, [["open", "POST", "/youtubei/v1/player", true, "fixture-user"], ["header", "x-fixture", "original"], ["send", "original-body"]]);
    if (type === "json") {
      assert.equal(xhr.response, value);
      assert.deepEqual(plain(xhr.response), withoutAds(player()));
      assert.throws(() => xhr.responseText, error => error.name === "InvalidStateError");
    } else {
      assert.deepEqual(JSON.parse(xhr.responseText), withoutAds(player()));
      assert.deepEqual(JSON.parse(xhr.response), withoutAds(player()));
    }
    assert.equal(xhr.status, 200);
    assert.equal(xhr.readyState, 4);
  }
});

test("XHR ignores partial, unsuccessful, non-text and unrelated responses and preserves open failures", t => {
  const s = setup(t);
  const raw = JSON.stringify(player());
  for (const options of [{ readyState: 3 }, { status: 0 }, { status: 302 }, { status: 403 }, { status: 500 }]) {
    const xhr = new s.win.XMLHttpRequest();
    xhr.open("GET", "/youtubei/v1/player");
    xhr.complete({ text: raw, ...options });
    assert.equal(xhr.responseText, raw);
    assert.equal(xhr.response, raw);
  }
  for (const endpoint of ["https://other.example/youtubei/v1/player", "/api/timedtext", "/youtubei/v1/license", "/youtubei/v1/player_extra"]) {
    const xhr = new s.win.XMLHttpRequest();
    xhr.open("GET", endpoint);
    xhr.complete({ text: raw });
    assert.equal(xhr.responseText, raw, endpoint);
    assert.equal(xhr.response, raw, endpoint);
  }
  const binary = new s.win.XMLHttpRequest();
  binary.open("GET", "/youtubei/v1/player");
  const value = new ArrayBuffer(4);
  binary.complete({ type: "arraybuffer", value });
  assert.equal(binary.response, value);
  assert.throws(() => binary.responseText, error => error.name === "InvalidStateError");
  assert.throws(() => new s.win.XMLHttpRequest().open("GET", "invalid:fixture"), error => error.name === "SyntaxError");
});

test("pagehide suspends parsing, globals, pending response reads and XHR until pageshow", async t => {
  const s = setup(t);
  const pending = await s.win.fetch("/youtubei/v1/player");
  const xhr = new s.win.XMLHttpRequest();
  xhr.open("GET", "/youtubei/v1/player");
  s.win.dispatchEvent(new s.win.Event("pagehide"));
  assert.deepEqual(plain(s.win.JSON.parse(JSON.stringify(player()))), player());
  s.win.ytInitialPlayerResponse = player();
  assert.deepEqual(plain(s.win.ytInitialPlayerResponse), player());
  assert.equal(await pending.text(), JSON.stringify(player()));
  const inactiveResponse = await s.win.fetch("/youtubei/v1/player");
  assert.deepEqual(plain(await inactiveResponse.json()), player());
  xhr.complete({ type: "json" });
  assert.deepEqual(plain(xhr.response), player());
  s.win.dispatchEvent(new s.win.Event("pageshow"));
  assert.deepEqual(plain(s.win.JSON.parse(JSON.stringify(player()))), withoutAds(player()));
  assert.deepEqual(plain(xhr.response), withoutAds(player()));
  const activeResponse = await s.win.fetch("/youtubei/v1/player");
  assert.deepEqual(plain(await activeResponse.json()), withoutAds(player()));
});

test("repeated installation is idempotent and never duplicates network calls", async t => {
  const s = setup(t);
  const parse = s.win.JSON.parse;
  const fetch = s.win.fetch;
  const open = s.win.XMLHttpRequest.prototype.open;
  adblock.install(s.win);
  adblock.install(s.win);
  assert.equal(s.win.JSON.parse, parse);
  assert.equal(s.win.fetch, fetch);
  assert.equal(s.win.XMLHttpRequest.prototype.open, open);
  assert.deepEqual(plain(await (await s.win.fetch("/youtubei/v1/player")).json()), withoutAds(player()));
  assert.equal(s.calls.length, 1);
});

test("locked transport descriptors fail open while other supported hooks keep working", t => {
  const s = setup(t, { install: false });
  const descriptor = Object.getOwnPropertyDescriptor(s.win.XMLHttpRequest.prototype, "responseText");
  Object.defineProperty(s.win.XMLHttpRequest.prototype, "responseText", { ...descriptor, configurable: false });
  Object.freeze(s.win.Response.prototype);
  assert.doesNotThrow(() => adblock.install(s.win));
  assert.deepEqual(plain(s.win.JSON.parse(JSON.stringify(player()))), withoutAds(player()));
  const xhr = new s.win.XMLHttpRequest();
  xhr.open("GET", "/youtubei/v1/player");
  xhr.complete();
  assert.equal(typeof xhr.responseText, "string");
});
