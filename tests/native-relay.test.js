const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../extension/src/background.js"), "utf8");
const CACHE_KEY = source.match(/var CACHE_KEY = "([^"]+)"/)[1];
const EXTENSION_ID = "de.ipekkaya.shorts-ausblenden.Extension";
const NATIVE_HOST = "de.ipekkaya.shorts-ausblenden";
const UNAVAILABLE = "Die Kurzfassung geht nur mit dem Modell auf dem Gerät, und das ist gerade nicht verfügbar.";
const MESSAGE = { type: "langform:summarize", text: "Die Erde braucht ein Jahr für einen Umlauf um die Sonne." };
const SENDER = { id: EXTENSION_ID, url: "https://www.youtube.com/watch?v=abcdefghijk" };
const ANSWER = { summary: { points: ["Erster Fakt.", "Zweiter Fakt.", "Dritter Fakt."] } };

function setup(namespace, native, options = {}) {
  let listener;
  let connectListener;
  let timerCallback;
  let timerDelay;
  let timerCleared = false;
  const calls = [];
  const timers = new Set();
  const manualTimers = new Map();
  let nextTimerId = 1;
  const runtime = {
    id: EXTENSION_ID,
    onMessage: { addListener(fn) { listener = fn; } },
    onConnect: { addListener(fn) { connectListener = fn; } },
    sendNativeMessage(...args) {
      calls.push(args);
      return native.apply(runtime, args);
    },
  };
  const scope = {
    URL,
    TextEncoder,
    setTimeout(fn, delay) {
      if (options.manualTimers) {
        const id = nextTimerId++;
        manualTimers.set(id, { fn, delay });
        return id;
      }
      if (options.storage) { const timer = setTimeout(fn, delay); timers.add(timer); return timer; }
      timerCallback = fn; timerDelay = delay; return 1;
    },
    clearTimeout(id) {
      if (options.manualTimers) { manualTimers.delete(id); return; }
      if (options.storage) { clearTimeout(id); timers.delete(id); return; }
      assert.equal(id, 1); timerCleared = true;
    },
    crypto: options.storage ? require("node:crypto").webcrypto : undefined,
    [namespace]: { runtime, storage: options.storage },
  };
  vm.runInNewContext(source, scope);
  assert.equal(typeof listener, "function");
  return {
    runtime,
    calls,
    scope,
    connect(port) { connectListener(port); },
    close() { for (const timer of timers) clearTimeout(timer); },
    send(message = MESSAGE, sender = SENDER, respond) {
      const responses = [];
      let complete;
      const done = new Promise(function (resolve) { complete = resolve; });
      const keepOpen = listener(message, sender, function (response) {
        if (respond) respond(response);
        else responses.push(JSON.parse(JSON.stringify(response)));
        complete(response);
      });
      return { keepOpen, responses, done };
    },
    expire() { timerCallback(); },
    runTimer(delay) {
      const entry = [...manualTimers.entries()].find(([, timer]) => timer.delay === delay);
      if (!entry) return false;
      manualTimers.delete(entry[0]);
      entry[1].fn();
      return true;
    },
    get activeTimerCount() { return manualTimers.size; },
    get timerDelay() { return timerDelay; },
    get timerCleared() { return timerCleared; },
  };
}

function summaryPort(sender = SENDER, name = "langform:summary-keepalive") {
  const messages = new Set();
  const disconnections = new Set();
  const replies = [];
  let disconnected = false;
  return {
    sender,
    name,
    onMessage: { addListener(fn) { messages.add(fn); }, removeListener(fn) { messages.delete(fn); } },
    onDisconnect: { addListener(fn) { disconnections.add(fn); }, removeListener(fn) { disconnections.delete(fn); } },
    postMessage(message) { replies.push(JSON.parse(JSON.stringify(message))); },
    disconnect() { disconnected = true; for (const fn of [...disconnections]) fn(); },
    receive(message) {
      if (!arguments.length) message = { type: "langform:summary-heartbeat" };
      for (const fn of [...messages]) fn(message);
    },
    replies,
    get disconnected() { return disconnected; },
    get listeners() { return messages.size + disconnections.size; },
  };
}

function summaryStorage(namespace = "browser") {
  let data = {};
  let reads = 0;
  let writes = 0;
  const clone = function (value) { return JSON.parse(JSON.stringify(value)); };
  return {
    local: {
      get(_key, callback) {
        reads++;
        const value = clone(data);
        if (namespace === "browser") return Promise.resolve(value);
        callback(value);
      },
      set(value, callback) {
        writes++;
        // Extension storage.set updates the supplied keys; unrelated keys stay.
        data = Object.assign({}, data, clone(value));
        if (namespace === "browser") return Promise.resolve();
        callback();
      },
    },
    get data() { return data; },
    set data(value) { data = clone(value); },
    get reads() { return reads; },
    get writes() { return writes; },
  };
}

async function flushCache() {
  await new Promise(function (resolve) { setImmediate(resolve); });
}

const PROGRESS_SENDER = { ...SENDER, tab: { id: 7 }, frameId: 0 };
const PROGRESS_ID = "summary_request_0001";
const PROGRESS = { phase: "reading", processedSections: 2, totalSections: 6,
  sourceIncomplete: false, coverageIncomplete: false };
function status(env, requestId = PROGRESS_ID, sender = PROGRESS_SENDER) {
  return env.send({ type: "langform:summary-status", requestId }, sender);
}

for (const namespace of ["browser", "chrome"]) {
  test(namespace + " teilt Fortschritt mit berechtigten Abonnenten und räumt nach der Schlussantwort auf", async function () {
    let finalReply;
    let progressReply;
    const env = setup(namespace, function (_host, body, callback) {
      function receive(resolve) {
        if (body.operation === "summaryStatus") progressReply = resolve;
        else finalReply = resolve;
      }
      if (namespace === "browser") return new Promise(receive);
      receive(callback);
    }, { manualTimers: true });
    const first = env.send({ ...MESSAGE, requestId: PROGRESS_ID }, PROGRESS_SENDER);
    assert.deepEqual(JSON.parse(JSON.stringify(env.calls[0][1])), { text: MESSAGE.text, requestId: PROGRESS_ID });
    assert.deepEqual(status(env).responses, [{ progress: null }]);
    assert.equal(env.runTimer(1000), true);
    assert.deepEqual(JSON.parse(JSON.stringify(env.calls[1][1])), { operation: "summaryStatus", requestId: PROGRESS_ID });
    assert.equal(env.runTimer(1000), false, "kein zweiter Poll während einer laufenden Statusanfrage");
    progressReply({ progress: { ...PROGRESS, secret: "nicht weiterreichen", tldr: "Noch keine Gesamtaussage." } });
    await Promise.resolve();
    assert.deepEqual(status(env).responses, [{ progress: PROGRESS }]);
    assert.deepEqual(first.responses, [], "Fortschritt schließt die Zusammenfassung nicht ab");
    const secondId = "summary_request_0002";
    const secondSender = { ...PROGRESS_SENDER, tab: { id: 8 } };
    const second = env.send({ ...MESSAGE, requestId: secondId }, secondSender);
    assert.deepEqual(status(env, secondId, secondSender).responses, [{ progress: PROGRESS }], "erneutes Öffnen sieht den bestehenden Stand");
    assert.equal(env.calls.length, 2, "ein Modellaufruf und ein Poll für beide Abonnenten");
    finalReply(ANSWER);
    await Promise.all([first.done, second.done]);
    assert.deepEqual(first.responses, [ANSWER]);
    assert.deepEqual(second.responses, [ANSWER]);
    assert.deepEqual(status(env).responses, [{ progress: null }]);
    assert.deepEqual(status(env, secondId, secondSender).responses, [{ progress: null }]);
    assert.equal(env.activeTimerCount, 0);
    assert.equal(env.runTimer(1000), false);
  });

  test(namespace + " lässt fehlerhafte und verspätete Fortschrittsantworten die Hauptanfrage nicht beeinflussen", async function () {
    let finalReply;
    let lateReply;
    let polling = 0;
    const env = setup(namespace, function (_host, body, callback) {
      if (body.operation !== "summaryStatus") {
        if (namespace === "browser") return new Promise(function (resolve) { finalReply = resolve; });
        finalReply = callback;
        return;
      }
      polling++;
      if (polling === 1) throw new Error("status temporarily unavailable");
      if (polling === 2) {
        if (namespace === "browser") return Promise.reject(new Error("status rejected"));
        this.lastError = { message: "status rejected" };
        callback({ progress: PROGRESS });
        delete this.lastError;
        return;
      }
      if (namespace === "browser") return new Promise(function (resolve) { lateReply = resolve; });
      lateReply = callback;
    }, { manualTimers: true });
    const pending = env.send({ ...MESSAGE, requestId: PROGRESS_ID }, PROGRESS_SENDER);
    for (let poll = 0; poll < 3; poll++) {
      assert.equal(env.runTimer(1000), true);
      await Promise.resolve();
      assert.deepEqual(pending.responses, []);
      assert.deepEqual(status(env).responses, [{ progress: null }]);
    }
    assert.equal(env.runTimer(1000), false);
    assert.equal(env.runTimer(10 * 60 * 1000), true);
    assert.equal(pending.responses[0].code, "NATIVE_TIMEOUT");
    lateReply({ progress: PROGRESS });
    finalReply(ANSWER);
    await Promise.resolve();
    assert.equal(pending.responses.length, 1);
    assert.equal(env.activeTimerCount, 0);
    assert.deepEqual(status(env).responses, [{ progress: null }]);
    assert.equal(env.calls.filter((call) => !call[1].operation).length, 1, "Statusfehler starten keinen Ersatzauftrag");
  });
}

test("Fortschrittsabfragen sind an Tab, Frame, URL und Privatmodus gebunden und lösen keine Hostabfrage aus", async function () {
  let finalReply;
  const env = setup("browser", function (_host, body) {
    if (body.operation) return Promise.resolve({ progress: PROGRESS });
    return new Promise(function (resolve) { finalReply = resolve; });
  }, { manualTimers: true });
  const pending = env.send({ ...MESSAGE, requestId: PROGRESS_ID }, PROGRESS_SENDER);
  env.runTimer(1000);
  await Promise.resolve();
  assert.deepEqual(status(env).responses, [{ progress: PROGRESS }]);
  for (const sender of [
    null, {}, SENDER,
    { ...PROGRESS_SENDER, id: "another-extension" },
    { ...PROGRESS_SENDER, tab: { id: 8 } },
    { ...PROGRESS_SENDER, frameId: 1 },
    { ...PROGRESS_SENDER, url: SENDER.url + "&t=5" },
    { ...PROGRESS_SENDER, url: "https://evil.example/" },
    { ...PROGRESS_SENDER, incognito: true },
    { ...PROGRESS_SENDER, tab: { id: 7, incognito: true } },
    { ...PROGRESS_SENDER, tab: { id: "7" } },
    { ...PROGRESS_SENDER, frameId: -1 },
  ]) assert.deepEqual(status(env, PROGRESS_ID, sender).responses, [{ progress: null }]);
  for (const id of [undefined, "invalid", PROGRESS_ID + "other", {}, "x".repeat(97)]) {
    const queried = env.send({ type: "langform:summary-status", requestId: id }, PROGRESS_SENDER);
    assert.deepEqual(queried.responses, [{ progress: null }]);
  }
  assert.equal(env.calls.length, 2, "Abfragen lesen ausschließlich den zuletzt gecachten Stand");
  finalReply(ANSWER);
  await pending.done;
});

test("Fehlende oder unbrauchbare Fortschrittskennung lässt die bisherige Kurzfassung vollständig funktionieren", async function () {
  for (const [requestId, sender] of [
    [PROGRESS_ID, SENDER], [PROGRESS_ID, { ...SENDER, tab: { id: -1 } }],
    [undefined, PROGRESS_SENDER], ["short", PROGRESS_SENDER], ["x".repeat(97), PROGRESS_SENDER],
    ["invalid.request.id", PROGRESS_SENDER], [{}, PROGRESS_SENDER],
  ]) {
    const env = setup("browser", function (_host, body) {
      assert.deepEqual(JSON.parse(JSON.stringify(body)), { text: MESSAGE.text });
      return Promise.resolve(ANSWER);
    }, { manualTimers: true });
    const pending = env.send({ ...MESSAGE, requestId }, sender);
    await pending.done;
    assert.deepEqual(pending.responses, [ANSWER]);
    assert.equal(env.calls.length, 1);
    assert.equal(env.activeTimerCount, 0);
  }
});

test("Wiederverwendete IDs in verschiedenen Aufträgen überschreiben keine fremde Fortschrittszuordnung", async function () {
  const finals = [];
  const env = setup("browser", function (_host, body) {
    if (body.operation) return Promise.resolve({ progress: PROGRESS });
    return new Promise(function (resolve) { finals.push(resolve); });
  }, { manualTimers: true });
  const first = env.send({ ...MESSAGE, requestId: PROGRESS_ID }, PROGRESS_SENDER);
  const otherSender = { ...PROGRESS_SENDER, tab: { id: 8 } };
  const other = env.send({ ...MESSAGE, text: "Eine andere Quelle.", requestId: PROGRESS_ID }, otherSender);
  assert.equal(env.calls[1][1].requestId, undefined, "derselbe native Schlüssel wird nicht für eine andere Quelle verwendet");
  env.runTimer(1000);
  await Promise.resolve();
  assert.deepEqual(status(env).responses, [{ progress: PROGRESS }]);
  assert.deepEqual(status(env, PROGRESS_ID, otherSender).responses, [{ progress: null }]);
  finals[1](ANSWER);
  await other.done;
  assert.deepEqual(status(env).responses, [{ progress: PROGRESS }], "Abschluss des zweiten Auftrags löscht den ersten nicht");
  finals[0](ANSWER);
  await first.done;
  assert.equal(env.activeTimerCount, 0);
});

test("Fortschritt übernimmt nur gültige Zähler und begrenzten TLDR-Text aus der Schlussphase", async function () {
  let next = { progress: PROGRESS };
  let finalReply;
  const env = setup("browser", function (_host, body) {
    if (body.operation) return Promise.resolve(next);
    return new Promise(function (resolve) { finalReply = resolve; });
  }, { manualTimers: true });
  const pending = env.send({ ...MESSAGE, requestId: PROGRESS_ID }, PROGRESS_SENDER);
  env.runTimer(1000);
  await Promise.resolve();
  for (const malformed of [null, {}, { progress: [] }, { progress: { ...PROGRESS, phase: "done" } },
    { progress: { ...PROGRESS, processedSections: -1 } }, { progress: { ...PROGRESS, processedSections: 7 } },
    { progress: { ...PROGRESS, totalSections: Infinity } }, { progress: { ...PROGRESS, totalSections: 10001 } },
    { progress: { ...PROGRESS, coverageIncomplete: "false" } }, { progress: { ...PROGRESS, sourceIncomplete: null } },
  ]) {
    next = malformed;
    env.runTimer(1000);
    await Promise.resolve();
    assert.deepEqual(status(env).responses, [{ progress: PROGRESS }], "ungültige Antworten ersetzen den letzten gültigen Stand nicht");
  }
  next = { progress: { ...PROGRESS, phase: "writing", tldr: "x".repeat(2001) } };
  env.runTimer(1000);
  await Promise.resolve();
  assert.deepEqual(status(env).responses, [{ progress: { ...PROGRESS, phase: "writing" } }]);
  const partialWriting = { ...PROGRESS, phase: "writing", coverageIncomplete: true };
  next = { progress: { ...partialWriting, tldr: "Keine belastbare Gesamtaussage." } };
  env.runTimer(1000);
  await Promise.resolve();
  assert.deepEqual(status(env).responses, [{ progress: partialWriting }], "unvollständige Abdeckung behält Phase und Warnhinweis ohne TLDR");
  const fragmentWriting = { ...PROGRESS, phase: "writing", processedSections: PROGRESS.totalSections, sourceIncomplete: true };
  next = { progress: { ...fragmentWriting, tldr: "Die vorhandene Teilquelle ist keine belastbare Gesamtaussage." } };
  env.runTimer(1000);
  await Promise.resolve();
  assert.deepEqual(status(env).responses, [{ progress: fragmentWriting }], "eine Teilquelle behält ihren Warnhinweis ohne TLDR-Vorschau");
  next = { progress: { ...PROGRESS, phase: "writing", tldr: "Die Abschnitte sind noch nicht vollständig gelesen." } };
  env.runTimer(1000);
  await Promise.resolve();
  assert.deepEqual(status(env).responses, [{ progress: { ...PROGRESS, phase: "writing" } }]);
  const writing = { ...PROGRESS, phase: "writing", processedSections: PROGRESS.totalSections, tldr: "Ein vorläufiger Überblick." };
  next = { progress: { ...writing, tldr: " " + writing.tldr + " ", secret: "kein erlaubtes Feld" }, summary: ANSWER.summary };
  env.runTimer(1000);
  await Promise.resolve();
  assert.deepEqual(status(env).responses, [{ progress: writing }]);
  assert.deepEqual(pending.responses, []);
  finalReply(ANSWER);
  await pending.done;
});

test("Vorläufiger TLDR bleibt aus dem dauerhaften Ergebnis-Cache heraus", async function () {
  const storage = summaryStorage();
  let finalReply;
  const env = setup("browser", function (_host, body) {
    if (body.operation) return Promise.resolve({ progress: { ...PROGRESS, phase: "writing", processedSections: PROGRESS.totalSections, tldr: "Vorläufige Aussage." }, summary: ANSWER.summary });
    return new Promise(function (resolve) { finalReply = resolve; });
  }, { storage, manualTimers: true });
  const pending = env.send({ ...MESSAGE, requestId: PROGRESS_ID }, PROGRESS_SENDER);
  while (!finalReply) await flushCache();
  env.runTimer(1000);
  await flushCache();
  assert.equal(storage.writes, 0);
  assert.equal(status(env).responses[0].progress.tldr, "Vorläufige Aussage.");
  finalReply({ code: "GENERATION_FAILED", message: "Die Schlussfassung konnte nicht erstellt werden." });
  await pending.done;
  await flushCache();
  assert.equal(storage.writes, 0);
  assert.deepEqual(status(env).responses, [{ progress: null }]);
  assert.equal(env.activeTimerCount, 0);
});

test("identische laufende Anfragen teilen sich einen nativen Auftrag, auch wenn ein Tab verschwindet", async function () {
  let reply;
  const env = setup("browser", function () { return new Promise(function (resolve) { reply = resolve; }); });
  env.send(MESSAGE, SENDER, function () { throw new Error("tab disappeared"); });
  const second = env.send(MESSAGE, { ...SENDER, tab: { id: 2 } });
  assert.equal(env.calls.length, 1);
  reply(ANSWER);
  await second.done;
  assert.deepEqual(second.responses, [ANSWER]);
});

for (const namespace of ["browser", "chrome"]) {
  test(namespace + " speichert vollständige Ergebnisse lokal nach Transkript-Fingerprint und nutzt sie nach Background-Neustart", async function (t) {
    const storage = summaryStorage(namespace);
    const response = { summary: { ...ANSWER.summary, tldr: "Die Kernaussage.", takeaway: "Der Merksatz.",
      caveat: "Die Einordnung.", coverage: { complete: true, processedSections: 3, totalSections: 3 } } };
    function native(_host, _message, callback) {
      if (namespace === "browser") return Promise.resolve(response);
      callback(response);
    }
    const first = setup(namespace, native, { storage });
    t.after(function () { first.close(); });
    const pending = first.send();
    const concurrent = first.send();
    assert.deepEqual(JSON.parse(JSON.stringify(await pending.done)), response);
    await concurrent.done;
    await flushCache();
    assert.equal(first.calls.length, 1);
    assert.equal(storage.data[CACHE_KEY].entries.length, 1);
    const serialized = JSON.stringify(storage.data);
    assert.equal(serialized.includes(MESSAGE.text), false, "keine Rohuntertitel gespeichert");
    assert.equal(serialized.includes("abcdefghijk"), false, "keine Video-ID gespeichert");
    assert.match(storage.data[CACHE_KEY].entries[0].key, /^[a-f0-9]{64}$/);

    const restarted = setup(namespace, native, { storage });
    t.after(function () { restarted.close(); });
    const cached = restarted.send();
    assert.deepEqual(JSON.parse(JSON.stringify(await cached.done)), response);
    assert.equal(restarted.calls.length, 0, "kein erneuter Modellaufruf nach Seiten-/Background-Neustart");
    await restarted.send({ ...MESSAGE, text: MESSAGE.text + " Die Erde dreht sich außerdem." }).done;
    assert.equal(restarted.calls.length, 1, "geänderte Untertitel bekommen eine neue Kurzfassung");
  });
}

test("Fehler und unvollständige Kurzfassungen werden nicht dauerhaft gespeichert und können erneut versucht werden", async function (t) {
  for (const response of [
    { code: "GENERATION_FAILED", message: "Bitte erneut versuchen." },
    { summary: { points: [] } },
    { summary: { points: ["Vorläufiger Punkt."], coverage: { complete: false, processedSections: 1, totalSections: 3 } } },
  ]) {
    const storage = summaryStorage();
    const env = setup("browser", function () { return Promise.resolve(response); }, { storage });
    t.after(function () { env.close(); });
    await env.send().done;
    await env.send().done;
    await flushCache();
    assert.equal(env.calls.length, 2);
    assert.equal(storage.writes, 0);
  }
});

test("private Tabs lesen und schreiben keinen dauerhaften Kurzfassungscache", async function (t) {
  const storage = summaryStorage();
  const env = setup("browser", function () { return Promise.resolve(ANSWER); }, { storage });
  t.after(function () { env.close(); });
  await env.send().done;
  await flushCache();
  const before = { reads: storage.reads, writes: storage.writes };
  for (const sender of [{ ...SENDER, tab: { incognito: true } }, { ...SENDER, incognito: true }]) {
    await env.send(MESSAGE, sender).done;
    await flushCache();
  }
  assert.equal(env.calls.length, 3);
  assert.deepEqual({ reads: storage.reads, writes: storage.writes }, before);
});

test("Cacheversion, Ablaufdatum und Vollständigkeit verhindern alte oder falsche Treffer", async function (t) {
  const storage = summaryStorage();
  const first = setup("browser", function () { return Promise.resolve(ANSWER); }, { storage });
  t.after(function () { first.close(); });
  await first.send().done;
  await flushCache();
  const original = JSON.parse(JSON.stringify(storage.data));
  for (const change of [
    function (cache) { cache.version = "clear-tldr-1"; },
    function (cache) { cache.entries[0].createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000; },
    function (cache) { cache.entries[0].createdAt = Date.now() + 24 * 60 * 60 * 1000; },
    function (cache) { cache.entries[0].result = { summary: { points: [] } }; },
    function (cache) { cache.entries[0].result.summary.coverage = { complete: false }; },
  ]) {
    storage.data = original;
    change(storage.data[CACHE_KEY]);
    const env = setup("browser", function () { return Promise.resolve(ANSWER); }, { storage });
    t.after(function () { env.close(); });
    await env.send().done;
    await flushCache();
    assert.equal(env.calls.length, 1);
  }
  storage.data = original;
  const partial = setup("browser", function () { return Promise.resolve(ANSWER); }, { storage });
  t.after(function () { partial.close(); });
  await partial.send({ ...MESSAGE, sourceIncomplete: true }).done;
  assert.equal(partial.calls.length, 1, "unvollständige Quelle übernimmt keine vollständige Antwort");
  const writes = storage.writes;
  await partial.send({ ...MESSAGE, sourceIncomplete: true }).done;
  await flushCache();
  assert.equal(partial.calls.length, 2, "unvollständige Quelle bleibt erneut versuchbar");
  assert.equal(storage.writes, writes);
});

test("neue Quellenaufbereitung verwendet alte Resultate nicht und erhält vorhandenen V2-Speicher", async function (t) {
  const storage = summaryStorage();
  const key = require("node:crypto").createHash("sha256").update("structured-tldr-2\nfull\n" + MESSAGE.text).digest("hex");
  const legacy = { version: "structured-tldr-2", entries: [{ key, createdAt: Date.now(), result: { summary: { points: ["Ein altes ungefiltertes Werbeangebot."] } } }] };
  storage.data = { langformSummaryCache: JSON.parse(JSON.stringify(legacy)) };
  const env = setup("browser", function () { return Promise.resolve(ANSWER); }, { storage });
  t.after(() => env.close());
  const answer = await env.send().done;
  await flushCache();
  assert.equal(env.calls.length, 1, "alte Modellresultate passen nicht zur geänderten Quellenaufbereitung");
  assert.deepEqual(JSON.parse(JSON.stringify(answer)), ANSWER);
  assert.deepEqual(storage.data.langformSummaryCache, legacy, "vorhandene alte Einträge werden weder gelöscht noch überschrieben");
  assert.equal(storage.data[CACHE_KEY].version, "structured-tldr-3");
  const reloaded = setup("browser", function () { throw new Error("Das neue Ergebnis liegt bereits im persistenten Cache"); }, { storage });
  t.after(() => reloaded.close());
  assert.deepEqual(JSON.parse(JSON.stringify(await reloaded.send().done)), ANSWER);
  assert.equal(reloaded.calls.length, 0, "neuer Background verwendet das neu gespeicherte Ergebnis");
  assert.deepEqual(storage.data.langformSummaryCache, legacy);
});

test("dauerhafter Kurzfassungscache bleibt auf zwölf Einträge begrenzt", async function (t) {
  const storage = summaryStorage();
  const env = setup("browser", function () { return Promise.resolve(ANSWER); }, { storage });
  t.after(function () { env.close(); });
  for (let index = 0; index < 14; index++) {
    await env.send({ ...MESSAGE, text: MESSAGE.text + " Abschnitt " + index }).done;
  }
  await flushCache();
  assert.equal(storage.data[CACHE_KEY].entries.length, 12);
  const calls = env.calls.length;
  await env.send({ ...MESSAGE, text: MESSAGE.text + " Abschnitt 13" }).done;
  assert.equal(env.calls.length, calls);
  await env.send({ ...MESSAGE, text: MESSAGE.text + " Abschnitt 0" }).done;
  assert.equal(env.calls.length, calls + 1, "ältestes Ergebnis wurde entfernt");
});

test("blockierter lokaler Speicher verzögert den Modellstart höchstens um den kurzen Cache-Timeout", async function (t) {
  const storage = summaryStorage();
  storage.local.get = function () { return new Promise(function () {}); };
  storage.local.set = function () { return Promise.reject(new Error("storage disabled")); };
  const env = setup("browser", function () { return Promise.resolve(ANSWER); }, { storage });
  t.after(function () { env.close(); });
  const start = Date.now();
  const result = await env.send().done;
  assert.deepEqual(JSON.parse(JSON.stringify(result)), ANSWER);
  assert.equal(env.calls.length, 1);
  assert.ok(Date.now() - start < 1500, "Speicherprobleme warten nicht bis zum zehnminütigen Modell-Timeout");
});

for (const namespace of ["browser", "chrome"]) {
  for (const failure of ["error", "throw", "timeout"]) {
    test(namespace + " erholt sich nach Cache-Lesefehler " + failure + " ohne gespeicherte Ergebnisse zu überschreiben", async function (t) {
      const storage = summaryStorage(namespace);
      const saved = { summary: { points: ["Die bereits gespeicherte Kurzfassung."] } };
      function nativeAnswer(answer) {
        return function (_host, _body, callback) {
          if (namespace === "browser") return Promise.resolve(answer);
          callback(answer);
        };
      }
      const seed = setup(namespace, nativeAnswer(saved), { storage });
      t.after(() => seed.close());
      await seed.send().done;
      await flushCache();
      const original = JSON.parse(JSON.stringify(storage.data));
      const writes = storage.writes;
      const get = storage.local.get;
      let attempts = 0, lateRead;
      storage.local.get = function (key, callback) {
        if (++attempts > 1) return get.call(this, key, callback);
        if (failure === "throw") throw new Error("temporary read failure");
        if (failure === "timeout") {
          if (namespace === "browser") return new Promise(resolve => { lateRead = resolve; });
          lateRead = callback;
          return;
        }
        if (namespace === "browser") return Promise.reject(new Error("temporary read failure"));
        env.runtime.lastError = new Error("temporary read failure");
        callback();
        delete env.runtime.lastError;
      };
      const env = setup(namespace, nativeAnswer(ANSWER), { storage, manualTimers: true });
      t.after(() => env.close());
      const first = env.send();
      if (failure === "timeout") {
        while (!lateRead) await flushCache();
        assert.equal(env.calls.length, 0);
        assert.equal(env.runTimer(500), true);
      }
      assert.deepEqual(JSON.parse(JSON.stringify(await first.done)), ANSWER, "Modell bleibt bei Lesefehler verfügbar");
      await flushCache();
      assert.equal(storage.writes, writes, "Unbekannter Speicherinhalt darf nicht durch einen leeren Snapshot ersetzt werden");
      assert.deepEqual(storage.data, original);

      const retry = env.send();
      assert.deepEqual(JSON.parse(JSON.stringify(await retry.done)), saved, "Nächste Anfrage liest den erhaltenen Cache erneut");
      assert.equal(attempts, 2);
      assert.equal(env.calls.length, 1, "Wiederholung verwendet gespeichertes Ergebnis ohne zweiten Modellaufruf");
      if (lateRead) { lateRead({}); await flushCache(); }
      await env.send().done;
      assert.equal(env.calls.length, 1, "Verspätete leere Antwort darf den wiederhergestellten Cache nicht ändern");
      await env.send({ ...MESSAGE, text: MESSAGE.text + " Neuer Quelleninhalt." }).done;
      await flushCache();
      assert.equal(storage.data[CACHE_KEY].entries.length, 2, "Nach Erholung funktioniert Speichern und erhält alte Einträge");
      assert.equal(env.calls.length, 2);
      assert.equal(env.activeTimerCount, 0);
    });
  }
}

test("Safari und Chrome beantworten jeden erlaubten Port-Heartbeat ohne einen nativen Aufruf", function () {
  for (const namespace of ["browser", "chrome"]) {
    for (const host of ["www.youtube.com", "m.youtube.com", "youtube.com"]) {
      const env = setup(namespace, function () { throw new Error("Heartbeat darf kein Modell starten"); });
      const port = summaryPort({ ...SENDER, url: "https://" + host + "/watch?v=abcdefghijk" });
      env.connect(port);
      port.receive();
      port.receive();
      assert.deepEqual(port.replies, [
        { type: "langform:summary-heartbeat-ack" },
        { type: "langform:summary-heartbeat-ack" },
      ]);
      assert.equal(env.calls.length, 0);
      assert.equal(port.disconnected, false);
    }
  }
});

test("Keepalive-Ports akzeptieren ausschließlich eigene Extension-Sender auf den erlaubten HTTPS-Ursprüngen", function () {
  for (const sender of [
    null,
    {},
    { ...SENDER, id: "another-extension" },
    { ...SENDER, url: "http://www.youtube.com/" },
    { ...SENDER, url: "https://www.youtube.com.evil.example/" },
    { ...SENDER, url: "https://evil.example/?next=https://www.youtube.com" },
    { ...SENDER, url: "https://www.youtube.com:444/" },
    { ...SENDER, url: "blob:https://www.youtube.com/1234" },
    { ...SENDER, url: "safari-web-extension://extension/popup.html" },
  ]) {
    const env = setup("browser", function () { throw new Error("must not run"); });
    const port = summaryPort(sender);
    env.connect(port);
    port.receive();
    assert.equal(port.disconnected, true);
    assert.equal(port.listeners, 0);
    assert.deepEqual(port.replies, []);
    assert.equal(env.calls.length, 0);
  }
  for (const name of ["unrelated", "", undefined]) {
    const env = setup("browser", function () { throw new Error("must not run"); });
    const port = summaryPort();
    port.name = name;
    env.connect(port);
    assert.equal(port.disconnected, true);
    assert.equal(port.listeners, 0);
  }
  const env = setup("browser", function () { throw new Error("must not run"); });
  delete env.runtime.id;
  const port = summaryPort({ ...SENDER, id: undefined });
  env.connect(port);
  assert.equal(port.disconnected, true);
});

test("Keepalive ignoriert unbekannte und mit Daten angereicherte Nachrichten", function () {
  const env = setup("browser", function () { throw new Error("must not run"); });
  const port = summaryPort();
  env.connect(port);
  for (const message of [null, undefined, 12, "ping", [], {}, { type: "unrelated" }, MESSAGE,
    { type: "langform:summary-heartbeat", text: MESSAGE.text }]) {
    port.receive(message);
  }
  assert.deepEqual(port.replies, []);
  assert.equal(env.calls.length, 0);
  port.receive();
  assert.deepEqual(port.replies, [{ type: "langform:summary-heartbeat-ack" }]);
});

test("Getrennte oder verschwundene Keepalive-Ports antworten nicht weiter und entfernen ihre Listener", function () {
  const env = setup("browser", function () { throw new Error("must not run"); });
  for (const vanished of [false, true]) {
    const port = summaryPort();
    env.connect(port);
    if (vanished) {
      port.postMessage = function () { throw new Error("tab disappeared"); };
      port.receive();
    } else {
      port.disconnect();
    }
    port.receive();
    assert.equal(port.disconnected, true);
    assert.equal(port.listeners, 0);
    assert.deepEqual(port.replies, []);
  }
  assert.equal(env.calls.length, 0);
});

test("Safari leitet Text einmal per Promise vom Background zum festen nativen Host weiter", async function () {
  const env = setup("browser", function (host, body) {
    assert.equal(host, NATIVE_HOST);
    assert.deepEqual(JSON.parse(JSON.stringify(body)), { text: MESSAGE.text });
    return Promise.resolve(ANSWER);
  });
  const result = env.send();
  assert.equal(result.keepOpen, true);
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].length, 2);
  await Promise.resolve();
  assert.deepEqual(result.responses, [ANSWER]);
  assert.equal(env.timerCleared, true);
});

test("Chrome leitet per Callback weiter und hält den Antwortkanal offen", function () {
  let callback;
  const env = setup("chrome", function (_host, _body, done) { callback = done; });
  const result = env.send();
  assert.equal(result.keepOpen, true);
  assert.equal(env.calls[0].length, 3);
  assert.deepEqual(result.responses, []);
  callback(ANSWER);
  callback(ANSWER);
  assert.deepEqual(result.responses, [ANSWER]);
  assert.equal(env.calls.length, 1);
  assert.equal(env.timerCleared, true);
});

test("Bekannte unvollständige Untertitel bleiben auf dem Weg zum nativen Modell gekennzeichnet", async function () {
  const env = setup("browser", function (_host, body) {
    assert.deepEqual(JSON.parse(JSON.stringify(body)), { text: MESSAGE.text, sourceIncomplete: true });
    return Promise.resolve(ANSWER);
  });
  const result = env.send({ ...MESSAGE, sourceIncomplete: true });
  await Promise.resolve();
  assert.deepEqual(result.responses, [ANSWER]);
});

test("Relay akzeptiert nur eigene Extension-Sender auf HTTPS-YouTube", function () {
  for (const sender of [
    undefined,
    {},
    { ...SENDER, id: "another-extension" },
    { ...SENDER, url: "http://www.youtube.com/watch?v=abcdefghijk" },
    { ...SENDER, url: "blob:https://www.youtube.com/1234" },
    { ...SENDER, url: "https://www.youtube.com.evil.example/" },
    { ...SENDER, url: "https://evil.example/?next=https://www.youtube.com" },
    { ...SENDER, url: "https://www.youtube.com:444/" },
    { ...SENDER, url: "safari-web-extension://extension/popup.html" },
    { ...SENDER, url: "broken URL" },
  ]) {
    const env = setup("browser", function () { throw new Error("must not run"); });
    const result = env.send(MESSAGE, sender === undefined ? null : sender);
    assert.equal(result.keepOpen, false);
    assert.equal(env.calls.length, 0);
    assert.deepEqual(result.responses, [{ code: "UNTRUSTED_SENDER", message: "Die Kurzfassung konnte auf dieser Seite nicht angefordert werden." }]);
  }
  const env = setup("browser", function () { throw new Error("must not run"); });
  delete env.runtime.id;
  assert.equal(env.send(MESSAGE, { ...SENDER, id: undefined }).keepOpen, false);
  assert.equal(env.calls.length, 0);
});

test("Alle drei erlaubten YouTube-Hosts können die Kurzfassung anfordern", async function () {
  for (const host of ["www.youtube.com", "m.youtube.com", "youtube.com"]) {
    const env = setup("browser", function () { return Promise.resolve(ANSWER); });
    const result = env.send(MESSAGE, { ...SENDER, url: "https://" + host + "/" });
    await Promise.resolve();
    assert.equal(result.keepOpen, true);
    assert.deepEqual(result.responses, [ANSWER]);
  }
});

test("Relay unterscheidet fehlerhafte, fehlende und zu große Untertitel ohne eine Modelldiagnose", function () {
  for (const [text, code] of [
    [undefined, "INVALID_CAPTIONS"], [null, "INVALID_CAPTIONS"], [12, "INVALID_CAPTIONS"], [{}, "INVALID_CAPTIONS"],
    ["", "MISSING_CAPTIONS"], [" \n\t ", "MISSING_CAPTIONS"],
    ["a".repeat(1024 * 1024 + 1), "CAPTIONS_TOO_LARGE"], ["ü".repeat(524289), "CAPTIONS_TOO_LARGE"],
  ]) {
    const env = setup("browser", function () { throw new Error("must not run"); });
    const result = env.send({ ...MESSAGE, text });
    assert.equal(result.keepOpen, false);
    assert.equal(env.calls.length, 0);
    assert.equal(result.responses.length, 1);
    assert.equal(result.responses[0].code, code);
    assert.notEqual(result.responses[0].message, UNAVAILABLE);
  }
});

test("Relay ignoriert fremde Nachrichtentypen ohne Antwort", function () {
  const env = setup("browser", function () { throw new Error("must not run"); });
  const result = env.send({ type: "unrelated", text: MESSAGE.text });
  assert.equal(result.keepOpen, false);
  assert.deepEqual(result.responses, []);
  assert.equal(env.calls.length, 0);
});

test("Native Transportfehler und ungültige Antworten bleiben getrennt von der Modellverfügbarkeit", async function () {
  for (const [native, code] of [
    [function () { return Promise.reject(new Error("native unavailable")); }, "NATIVE_CONNECTION_FAILED"],
    [function () { return Promise.resolve(null); }, "INVALID_NATIVE_RESPONSE"],
    [function () { throw new Error("native unavailable"); }, "NATIVE_CONNECTION_FAILED"],
    [function () { return undefined; }, "NATIVE_CONNECTION_FAILED"],
    [function () { return Promise.resolve({}); }, "INVALID_NATIVE_RESPONSE"],
    [function () { return Promise.resolve([]); }, "INVALID_NATIVE_RESPONSE"],
    [function () { return Promise.resolve("reply"); }, "INVALID_NATIVE_RESPONSE"],
  ]) {
    const env = setup("browser", native);
    const result = env.send();
    await Promise.resolve();
    assert.equal(env.calls.length, 1);
    assert.equal(result.responses.length, 1);
    assert.equal(result.responses[0].code, code);
    assert.notEqual(result.responses[0].message, UNAVAILABLE);
    assert.equal(env.timerCleared, true);
  }
});

test("Chrome lastError wird einmal gelesen und als Verbindungsfehler beantwortet", function () {
  let callback;
  let lastErrorReads = 0;
  const env = setup("chrome", function (_host, _body, done) { callback = done; });
  const result = env.send();
  Object.defineProperty(env.runtime, "lastError", { get() { lastErrorReads++; return { message: "native unavailable" }; } });
  callback(ANSWER);
  assert.equal(lastErrorReads, 1);
  assert.deepEqual(result.responses, [{ code: "NATIVE_CONNECTION_FAILED", message: "Die Kurzfassung-App konnte nicht erreicht werden. Bitte versuche es erneut." }]);
});

test("Lange Abschnittsanalyse darf bis zehn Minuten antworten; verspätete Antworten werden ignoriert", async function () {
  let resolve;
  const env = setup("browser", function () { return new Promise(function (done) { resolve = done; }); });
  const result = env.send();
  assert.equal(env.timerDelay, 10 * 60 * 1000);
  env.expire();
  assert.deepEqual(result.responses, [{ code: "NATIVE_TIMEOUT", message: "Die Kurzfassung braucht zu lange. Bitte versuche es erneut." }]);
  resolve(ANSWER);
  await Promise.resolve();
  assert.deepEqual(result.responses, [{ code: "NATIVE_TIMEOUT", message: "Die Kurzfassung braucht zu lange. Bitte versuche es erneut." }]);
  assert.equal(env.calls.length, 1);
  assert.equal(env.timerCleared, true);
});

test("Eine fehlende native Schnittstelle meldet die Verbindung, ohne einen Modellzustand zu erfinden", function () {
  const env = setup("browser", function () { throw new Error("must not run"); });
  delete env.runtime.sendNativeMessage;
  const result = env.send();
  assert.equal(result.keepOpen, false);
  assert.equal(env.calls.length, 0);
  assert.deepEqual(result.responses, [{ code: "NATIVE_CONNECTION_UNAVAILABLE", message: "Die Verbindung zur Kurzfassung-App ist gerade nicht verfügbar." }]);
});

test("Explizite native Modell- und Inhaltsfehler bleiben unverändert beim tatsächlichen Ursprung", async function () {
  for (const reply of [
    { code: "MODEL_UNAVAILABLE", message: UNAVAILABLE },
    { code: "MODEL_UNAVAILABLE" },
    { code: "UNUSABLE_CAPTIONS", message: "Die verfügbaren Untertitel enthalten keinen verständlichen Text." },
    { code: "GENERATION_TIMEOUT", message: "Die lokale Modellanfrage dauert zu lange." },
  ]) {
    const env = setup("browser", function () { return Promise.resolve(reply); });
    const result = env.send();
    await Promise.resolve();
    assert.deepEqual(result.responses, [reply]);
    assert.equal(env.calls.length, 1);
    assert.equal(env.timerCleared, true);
  }
});

test("Abgebrochene native Anfragen erhalten eine Abbruchmeldung und keine Modelldiagnose", async function () {
  const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
  for (const native of [function () { throw abort; }, function () { return Promise.reject(abort); }]) {
    const env = setup("browser", native);
    const result = env.send();
    await Promise.resolve();
    assert.deepEqual(result.responses, [{ code: "CANCELLED", message: "Die Kurzfassung wurde abgebrochen." }]);
    assert.equal(env.calls.length, 1);
    assert.equal(env.timerCleared, true);
  }
});

test("Ein verschwundener Content-Script-Antwortkanal startet weder einen zweiten Hostaufruf noch einen verspäteten Fehler", async function () {
  const env = setup("browser", function () { return Promise.resolve(ANSWER); });
  // Real Safari can close this callback channel when the tab navigates.
  let responseAttempts = 0;
  const result = env.send(MESSAGE, SENDER, function () {
    responseAttempts++;
    throw new Error("tab response channel closed");
  });
  await Promise.resolve();
  env.expire();
  assert.equal(env.calls.length, 1);
  assert.equal(responseAttempts, 1);
  assert.equal(env.timerCleared, true);
  assert.deepEqual(result.responses, []);
});
