const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { ns, delay } = require("./helpers");
const summary = ns.summary;
const pageCaptions = require("../extension/src/page-captions.js");

const DE_TRACK = {
  languageCode: "de",
  baseUrl: "https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=de&pot=1",
};
const DE_ASR = {
  languageCode: "de",
  kind: "asr",
  baseUrl: "https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=de&kind=asr",
};
const EN_TRACK = {
  languageCode: "en",
  baseUrl: "https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&signature=abc",
};

function modelSummary() {
  return {
    summary: {
      about: "Es geht um den Inhalt des Videos, nicht um einzelne gesprochene Sätze.",
      points: [
        "Ein echter Punkt zum Inhalt.",
        "Ein zweiter Punkt, den man behalten kann.",
        "Ein dritter Punkt ohne Zitat.",
      ],
      ending: "Am Ende ist die Sache geklärt.",
    },
  };
}

function sentences(count) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    lines.push("Satz Nummer " + (i + 1) + " beschreibt einen eigenen Schritt im Rezept.");
  }
  return lines.join(" ");
}

test("Safari-Content-Script erreicht das Modell über den Background, ohne ein globales root", async function () {
  const fs = require("fs");
  const src = fs.readFileSync(require.resolve("../extension/src/summary.js"), "utf8");
  const factoryAt = src.indexOf("function () {");
  assert.equal(/\broot\b/.test(src.slice(factoryAt)), false);
  const seen = [];
  const previous = global.browser;
  global.browser = {
    runtime: {
      sendMessage(body) {
        assert.equal(arguments.length, 1, "browser.runtime.sendMessage nutzt die Promise-API");
        if (String(body && body.text).indexOf("MARKER_SEITENWELT") === -1) {
          return Promise.resolve(null);
        }
        seen.push({ type: body.type, text: body.text });
        return Promise.resolve({
          summary: {
            points: [
              "Der Markt wird aufgebaut.",
              "Die Stadt lebt vom Handel.",
              "Ohne Markt bleibt der Platz ungenutzt.",
            ],
          },
        });
      },
    },
  };
  try {
    const result = await summary.loadSummary("abcdefghijk", {
      player: {
        videoDetails: { videoId: "abcdefghijk" },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [DE_TRACK] } },
      },
      fetchText() {
        return Promise.resolve(
          JSON.stringify({ events: [{ segs: [{ utf8: "MARKER_SEITENWELT gesprochen, nicht als Zitat zeigen." }] }] })
        );
      },
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].type, "langform:summarize");
    assert.match(seen[0].text, /MARKER_SEITENWELT/);
    assert.equal(result.message, undefined);
    assert.equal(result.summary.points.length, 3);
    assert.equal(result.summary.points.join(" ").includes("MARKER_SEITENWELT"), false);
  } finally {
    if (previous === undefined) delete global.browser;
    else global.browser = previous;
  }
});

test("XML-Untertitel erhalten Vergleiche, literale Tags und Unicode-Zeichen nach dem Decoding", function () {
  assert.equal(
    summary.textFromCaptions('<transcript><text>x &lt; 5 und y &gt; 2. &lt;script&gt; ist hier Text.</text></transcript>'),
    "x < 5 und y > 2. <script> ist hier Text."
  );
  assert.equal(
    summary.textFromCaptions('<timedtext><body><p><s>Ein </s><s>Zeichen: &#x1F9EC; und &#129516;.</s></p></body></timedtext>'),
    "Ein Zeichen: 🧬 und 🧬."
  );
  assert.equal(
    summary.textFromCaptions('<transcript><text>&amp;lt; 5 und &amp;gt; 2. &#x110000; bleibt lesbar.</text></transcript>'),
    "< 5 und > 2. &#x110000; bleibt lesbar."
  );
});

test("deutsche Spur gewinnt, sonst Übersetzung nach Deutsch", function () {
  const manual = summary.chooseTrack([DE_ASR, DE_TRACK, EN_TRACK], [{ languageCode: "de" }]);
  assert.equal(manual.track, DE_TRACK);
  assert.equal(manual.translate, false);

  const asr = summary.chooseTrack([DE_ASR, EN_TRACK], []);
  assert.equal(asr.track, DE_ASR);
  assert.equal(asr.translate, false);

  const translated = summary.chooseTrack([EN_TRACK], [{ languageCode: "de" }]);
  assert.equal(translated.track, EN_TRACK);
  assert.equal(translated.translate, true);

  const url = summary.captionUrl(EN_TRACK, true);
  assert.match(url, /^https:\/\/www\.youtube\.com\/api\/timedtext/);
  assert.doesNotMatch(url, /[?&]fmt=/);
  assert.match(url, /tlang=de/);
  assert.match(url, /signature=abc/);
  const json3 = summary.captionUrl(EN_TRACK, true, "json3");
  assert.match(json3, /fmt=json3/);
  assert.match(json3, /tlang=de/);
  assert.match(json3, /signature=abc/);
  assert.equal(
    summary.captionUrl({ baseUrl: "https://rr1---sn.googlevideo.com/videoplayback?id=1" }),
    null
  );
  assert.equal(url.includes("googlevideo"), false);

  const regional = summary.chooseTrack(
    [{ languageCode: "de-DE", baseUrl: DE_TRACK.baseUrl }, EN_TRACK],
    [{ languageCode: "de" }]
  );
  assert.equal(regional.track.languageCode, "de-DE");
  assert.equal(regional.translate, false);
  assert.doesNotMatch(summary.captionUrl(regional.track, regional.translate), /tlang=/);
});

test("Kurzfassung ist das Modell, kein Transkript", async function () {
  const spoken = "Bro [musik] " + sentences(4) + " Das war wörtlich so gesagt.";
  let handed = "";
  const result = await summary.loadSummary("abcdefghijk", {
    player: {
      videoDetails: { videoId: "abcdefghijk" },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [DE_TRACK] } },
    },
    fetchText() {
      return Promise.resolve(JSON.stringify({ events: [{ segs: [{ utf8: spoken }] }] }));
    },
    summarize(text) {
      handed = text;
      return {
        summary: {
          about: "Es geht um ein Rezept mit mehreren Schritten. [musik]",
          points: [
            "Bro das Gemüse wird vorbereitet.",
            "Der Ofen übernimmt den Rest.",
            "Die Form kommt erst in den Ofen, wenn das Gemüse drin ist.",
          ],
          ending: "Am Ende ist das Essen fertig.",
        },
      };
    },
  });
  assert.match(handed, /Satz Nummer 1/);
  const parts = summary.blocks(result.summary);
  assert.equal(parts.length, 3);
  assert.equal(result.summary.about, undefined);
  assert.equal(result.summary.ending, undefined);
  const joined = parts.join(" ");
  assert.equal(/\[musik\]/i.test(joined), false);
  assert.equal(/\b[Bb]ro\b/.test(joined), false);
  assert.equal(joined.includes("Satz Nummer"), false);
  assert.equal(joined.includes("wörtlich so gesagt"), false);
  assert.equal(joined.includes("Am Ende ist das Essen fertig"), false);
  assert.equal(joined.includes("Es geht um ein Rezept"), false);
  const brief = await summary.loadSummary("abcdefghijk", {
    player: {
      videoDetails: { videoId: "abcdefghijk" },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [DE_TRACK] } },
    },
    fetchText() {
      return Promise.resolve(JSON.stringify({ events: [{ segs: [{ utf8: spoken }] }] }));
    },
    summarize() {
      return { summary: { about: "Nur ein Überblick.", points: ["Ein einzelner Punkt."] } };
    },
  });
  assert.deepEqual(brief.summary.points, ["Ein einzelner Punkt."]);
  assert.equal(brief.message, undefined);
  assert.equal(JSON.stringify(brief).includes("Satz Nummer"), false);
  const tooMany = await summary.loadSummary("abcdefghijk", {
    player: {
      videoDetails: { videoId: "abcdefghijk" },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [DE_TRACK] } },
    },
    fetchText() {
      return Promise.resolve(JSON.stringify({ events: [{ segs: [{ utf8: spoken }] }] }));
    },
    summarize() {
      return {
        summary: {
          points: ["Eins.", "Zwei.", "Drei.", "Vier.", "Fünf.", "Sechs.", "Sieben.", "Acht.", "Neun."],
        },
      };
    },
  });
  assert.deepEqual(tooMany.summary.points, ["Eins.", "Zwei.", "Drei.", "Vier.", "Fünf.", "Sechs.", "Sieben.", "Acht."]);
  const missed = await summary.loadSummary("abcdefghijk", {
    player: {
      videoDetails: { videoId: "abcdefghijk" },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [DE_TRACK] } },
    },
    fetchText() {
      return Promise.resolve(JSON.stringify({ events: [{ segs: [{ utf8: spoken }] }] }));
    },
  });
  assert.equal(missed.code, "NATIVE_CONNECTION_UNAVAILABLE");
  assert.equal(missed.message, "Die Verbindung zur Kurzfassung-App ist gerade nicht verfügbar.");
  assert.equal(JSON.stringify(missed).includes("Satz Nummer"), false);
  assert.equal(summary.textFromJson3({ events: [] }), "");
  assert.equal(
    summary.textFromCaptions(
      '<?xml version="1.0" encoding="utf-8" ?><transcript><text start="18.64" dur="3.24">Uns beiden ist die Liebe nicht fremd</text><text start="22.64" dur="4.32">Du kennst die Regeln genau.</text></transcript>'
    ),
    "Uns beiden ist die Liebe nicht fremd Du kennst die Regeln genau."
  );
  assert.equal(
    summary.textFromCaptions(
      '<timedtext format="3"><body><p t="18640" d="3240"><s>Zuerst </s><s>schneidet man das Gemüse klein.</s></p><p t="22000" d="2000">Zum Schluss ruht er zehn Minuten.</p></body></timedtext>'
    ),
    "Zuerst schneidet man das Gemüse klein. Zum Schluss ruht er zehn Minuten."
  );
  assert.match(
    summary.textFromCaptions('<transcript><text start="0" dur="1">O&amp;apos;Brien&#39;s Laden bleibt offen.</text></transcript>'),
    /O'Brien's Laden/
  );
  assert.equal(summary.textFromCaptions(""), "");
  assert.equal(summary.textFromCaptions("   "), "");
});

test("ohne Spur ein Satz, Fetch bleibt auf YouTube-Untertiteln", async function () {
  const calls = [];
  const empty = await summary.loadSummary("abcdefghijk", {
    player: { videoDetails: { videoId: "abcdefghijk" }, streamingData: { formats: [{ url: "https://rr.googlevideo.com/videoplayback" }] } },
    pageUrl: "https://m.youtube.com/watch?v=abcdefghijk",
    fetchText(url) {
      calls.push(url);
      return Promise.resolve("");
    },
  });
  assert.equal(empty.message, summary.NO_CAPTIONS);
  assert.deepEqual(calls, []);

  const page =
    "var ytInitialPlayerResponse = " +
    JSON.stringify({
      videoDetails: { videoId: "abcdefghijk" },
      streamingData: { formats: [{ url: "https://rr.googlevideo.com/videoplayback?id=9" }] },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [EN_TRACK],
          translationLanguages: [{ languageCode: "de" }],
        },
      },
    }) +
    ";";
  const loaded = await summary.loadSummary("abcdefghijk", {
    pageUrl: "https://m.youtube.com/",
    summarize: modelSummary,
    fetchText(url) {
      calls.push(url);
      if (String(url).includes("/watch")) return Promise.resolve(page);
      return Promise.resolve(
        JSON.stringify({
          events: [
            { segs: [{ utf8: "Heute geht es um einen langen Auflauf aus dem Ofen." }] },
            { segs: [{ utf8: "Zuerst schneidet man das Gemüse klein." }] },
            { segs: [{ utf8: "Zum Schluss ruht er zehn Minuten." }] },
          ],
        })
      );
    },
  });
  assert.equal(loaded.summary.points.length, 3);
  assert.equal(loaded.summary.about, undefined);
  assert.ok(calls.length >= 2);
  calls.forEach(function (url) {
    assert.equal(String(url).includes("googlevideo"), false);
    assert.match(String(url), /youtube\.com/);
  });
  assert.match(calls[1], /tlang=de/);
  assert.match(calls[0], /m\.youtube\.com\/watch\?v=abcdefghijk/);
});

test("wenige belegte Punkte bleiben kurz; Dopplungen und fehlerhafte Modellwerte füllen sie nicht auf", async function () {
  async function resultFor(points) {
    return summary.loadSummary("abcdefghijk", {
      player: {
        videoDetails: { videoId: "abcdefghijk" },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [DE_TRACK] } },
      },
      fetchText() {
        return Promise.resolve(JSON.stringify({ events: [{ segs: [{ utf8: "Das Gemüse braucht 20 Minuten. Die Autorin hält Umluft für besser." }] }] }));
      },
      summarize() { return { summary: { points: points } }; },
    });
  }
  const compact = await resultFor([
    "  Das Gemüse braucht 20 Minuten.  ",
    "Das Gemüse braucht 20 Minuten.",
    "Die Autorin hält Umluft für besser.",
    "Das war die einzige neue Information.",
    "", null, 20, { text: "Kein gültiger Modellpunkt" },
  ]);
  assert.deepEqual(compact.summary.points, [
    "Das Gemüse braucht 20 Minuten.", "Die Autorin hält Umluft für besser.",
  ]);
  const empty = await resultFor([" ", null, {}]);
  assert.equal(empty.summary, undefined);
  assert.match(empty.message, /keine verlässliche Kurzfassung/);
  const limitations = await resultFor([
    "Das war die einzige neue Information.",
    "Die Studie umfasst nur 30 Haushalte.",
    "Die Langzeithaltbarkeit wurde nicht getestet.",
    "Die Ergebnisse gelten nur für den Winter.",
  ]);
  assert.deepEqual(limitations.summary.points, [
    "Die Studie umfasst nur 30 Haushalte.",
    "Die Langzeithaltbarkeit wurde nicht getestet.",
    "Die Ergebnisse gelten nur für den Winter.",
  ]);
});

function summaryEnvironment(extra) {
  return {
    player: { videoDetails: { videoId: "abcdefghijk" }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [DE_TRACK] } } },
    fetchText() { return Promise.resolve(JSON.stringify({ events: [{ segs: [{ utf8: "Ein Versuch ist geplant. Der Erfolg ist offen." }] }] })); },
    ...extra,
  };
}

test("fehlende und ungültige native Antworten begründen keine Diagnose zum lokalen Modell", async function () {
  for (const payload of [undefined, null, "", [], {}, { summary: [] }, { summary: "wrong" }, { summary: { points: {} } }]) {
    const result = await summary.loadSummary("abcdefghijk", summaryEnvironment({ summarize() { return payload; } }));
    assert.equal(result.code, "INVALID_NATIVE_RESPONSE");
    assert.equal(result.summary, undefined);
    assert.notEqual(result.message, summary.UNAVAILABLE);
  }
  const unknown = await summary.loadSummary("abcdefghijk", summaryEnvironment({ summarize() { return { code: "UNEXPECTED_NATIVE_ERROR" }; } }));
  assert.equal(unknown.code, "UNEXPECTED_NATIVE_ERROR");
  assert.notEqual(unknown.message, summary.UNAVAILABLE);
  const unavailable = await summary.loadSummary("abcdefghijk", summaryEnvironment({ summarize() { return { code: "MODEL_UNAVAILABLE" }; } }));
  assert.deepEqual(unavailable, { code: "MODEL_UNAVAILABLE", message: summary.UNAVAILABLE });
});

test("Safari-Relay-, WebView- und native Verbindungsfehler bleiben von Modellfehlern getrennt", async function () {
  const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
  for (const [method, native, code] of [
    ["sendMessage", function () { return Promise.reject(new Error("relay disconnected")); }, "RELAY_CONNECTION_FAILED"],
    ["sendMessage", function () { throw new Error("relay disconnected"); }, "RELAY_CONNECTION_FAILED"],
    ["sendMessage", function () { return undefined; }, "RELAY_CONNECTION_FAILED"],
    ["sendMessage", function () { return Promise.resolve(null); }, "INVALID_NATIVE_RESPONSE"],
    ["sendNativeMessage", function () { return Promise.reject(new Error("host disconnected")); }, "NATIVE_CONNECTION_FAILED"],
    ["sendMessage", function () { return Promise.reject(abort); }, "CANCELLED"],
  ]) {
    const host = { browser: { runtime: { [method]: native } } };
    const result = await summary.loadSummary("abcdefghijk", summaryEnvironment({ host }));
    assert.equal(result.code, code);
    assert.notEqual(result.message, summary.UNAVAILABLE);
  }
  const host = { webkit: { messageHandlers: { langformSummary: { postMessage() { throw new Error("WebView unavailable"); } } } } };
  const webView = await summary.loadSummary("abcdefghijk", summaryEnvironment({ host }));
  assert.equal(webView.code, "NATIVE_CONNECTION_FAILED");
  assert.deepEqual(Object.keys(host.__langformKurzWait), [], "abgewiesene WebView-Tickets bleiben nicht gespeichert");
  const generation = await summary.loadSummary("abcdefghijk", summaryEnvironment({ summarize() { throw new Error("generation failed"); } }));
  assert.equal(generation.code, "GENERATION_FAILED");
  assert.notEqual(generation.message, summary.UNAVAILABLE);
});

test("Chrome lastError und konkrete Background-Fehler bleiben als Verbindungsmeldung erhalten", async function () {
  let reads = 0;
  const runtime = {
    sendMessage(_body, callback) { callback(modelSummary()); },
    get lastError() { reads++; return { message: "response channel closed" }; },
  };
  const chrome = await summary.loadSummary("abcdefghijk", summaryEnvironment({ host: { chrome: { runtime } } }));
  assert.equal(reads, 1);
  assert.equal(chrome.code, "RELAY_CONNECTION_FAILED");
  assert.notEqual(chrome.message, summary.UNAVAILABLE);
  const nativeError = { code: "NATIVE_TIMEOUT", message: "Die Kurzfassung braucht zu lange. Bitte versuche es erneut." };
  const safari = await summary.loadSummary("abcdefghijk", summaryEnvironment({ host: { browser: { runtime: {
    sendMessage() { return Promise.resolve(nativeError); },
  } } } }));
  assert.deepEqual(safari, nativeError);
});

function keepaliveRelay(namespace = "browser") {
  const events = [];
  const posts = [];
  const intervals = new Map();
  const timeouts = new Map();
  const messages = new Set();
  const disconnects = new Set();
  const statusRequests = [];
  const nativeReplies = [];
  let sequence = 0;
  let reply;
  let nativeCalls = 0;
  let portCloses = 0;
  let requestArguments;
  function newPort() {
    const portMessages = new Set();
    const portDisconnects = new Set();
    return {
      onMessage: { addListener(fn) { messages.add(fn); portMessages.add(fn); }, removeListener(fn) { messages.delete(fn); portMessages.delete(fn); } },
      onDisconnect: { addListener(fn) { disconnects.add(fn); portDisconnects.add(fn); }, removeListener(fn) { disconnects.delete(fn); portDisconnects.delete(fn); } },
      postMessage(message) {
        events.push("heartbeat");
        posts.push(message);
        portMessages.forEach(function (fn) { fn({ type: "langform:summary-heartbeat-ack" }); });
      },
      disconnect() {
        portCloses++;
        portDisconnects.forEach(function (fn) { fn(); });
      },
    };
  }
  const runtime = {
    connect(options) {
      assert.equal(arguments.length, 1);
      assert.deepEqual(options, { name: "langform:summary-keepalive" });
      events.push("connect");
      return newPort();
    },
    sendMessage(...args) {
      if (args[0].type === "langform:summary-status") {
        const status = { args };
        statusRequests.push(status);
        if (namespace === "chrome") { status.reply = args[1]; return; }
        return new Promise(function (resolve, reject) { status.reply = resolve; status.reject = reject; });
      }
      events.push("native");
      nativeCalls++;
      requestArguments = args;
      if (namespace === "chrome") { reply = args[1]; nativeReplies.push(reply); return; }
      return new Promise(function (resolve) { reply = resolve; nativeReplies.push(reply); });
    },
  };
  const host = {
    [namespace]: { runtime },
    setInterval(fn, delay) { const id = ++sequence; intervals.set(id, { fn, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn, delay) { const id = ++sequence; timeouts.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
  };
  return {
    host, events, posts, intervals, timeouts, messages, disconnects, statusRequests, runtime,
    reply(response, index) { if (index === undefined) reply(response); else nativeReplies[index](response); },
    heartbeat() { [...intervals.values()][0].fn(); },
    poll() { [...intervals.values()].filter(function (interval) { return interval.delay === 1000; }).forEach(function (interval) { interval.fn(); }); },
    expire() { [...timeouts.values()][0].fn(); },
    drop() { [...disconnects].forEach(function (fn) { fn(); }); },
    get nativeCalls() { return nativeCalls; },
    get portCloses() { return portCloses; },
    get requestArguments() { return requestArguments; },
  };
}

test("Safari hält den Background vor dem nativen Auftrag und mit bestätigten Nachrichten alle20Sekunden aktiv", async function () {
  const relay = keepaliveRelay();
  let complete = false;
  const pending = summary.loadSummary("abcdefghijk", summaryEnvironment({ host: relay.host })).then(function (result) { complete = true; return result; });
  await delay(0);
  assert.deepEqual(relay.events, ["connect", "heartbeat", "native"]);
  assert.equal(relay.messages.size, 1, "ACK-Listener ist vor der ersten Nachricht installiert");
  assert.equal(relay.nativeCalls, 1);
  assert.equal([...relay.intervals.values()][0].delay, 20000);
  assert.equal([...relay.timeouts.values()][0].delay, 10 * 60 * 1000);
  relay.heartbeat();
  await Promise.resolve();
  assert.deepEqual(relay.posts, [
    { type: "langform:summary-heartbeat" }, { type: "langform:summary-heartbeat" },
  ]);
  assert.equal(complete, false, "Heartbeat-ACK wird nicht als native Antwort verstanden");
  assert.equal(relay.nativeCalls, 1, "Heartbeat erzeugt keinen zweiten Modellauftrag");
  relay.reply(modelSummary());
  const result = await pending;
  assert.deepEqual(result.summary.points, modelSummary().summary.points);
  assert.equal(relay.portCloses, 1);
  assert.equal(relay.intervals.size, 0);
  assert.equal(relay.timeouts.size, 0);
  assert.equal(relay.messages.size, 0);
  assert.equal(relay.disconnects.size, 0);
});

test("Portunterbrechung und Zeitüberschreitung beenden Heartbeat ohne einen weiteren nativen Auftrag", async function () {
  for (const [stop, code] of [["drop", "RELAY_DISCONNECTED"], ["expire", "NATIVE_TIMEOUT"]]) {
    const relay = keepaliveRelay();
    const pending = summary.loadSummary("abcdefghijk", summaryEnvironment({ host: relay.host }));
    await delay(0);
    relay[stop]();
    const result = await pending;
    assert.equal(result.code, code);
    assert.notEqual(result.message, summary.UNAVAILABLE);
    assert.equal(relay.nativeCalls, 1);
    assert.equal(relay.portCloses, 1);
    assert.equal(relay.intervals.size, 0);
    assert.equal(relay.timeouts.size, 0);
    assert.equal(relay.messages.size, 0);
    assert.equal(relay.disconnects.size, 0);
    relay.reply(modelSummary());
    await Promise.resolve();
    assert.equal(result.code, code, "die verspätete Antwort ersetzt den Fehler nicht");
    assert.equal(relay.nativeCalls, 1);
  }
});

test("Chromes Callback-Aufruf bleibt beim selben Auftrag und räumt seinen Keepalive-Port auf", async function () {
  const relay = keepaliveRelay("chrome");
  const pending = summary.loadSummary("abcdefghijk", summaryEnvironment({ host: relay.host }));
  await delay(0);
  assert.deepEqual(relay.events, ["connect", "heartbeat", "native"]);
  assert.equal(relay.requestArguments.length, 2);
  assert.equal(relay.requestArguments[0].type, "langform:summarize");
  assert.equal(typeof relay.requestArguments[1], "function");
  relay.reply(modelSummary());
  assert.deepEqual((await pending).summary.points, modelSummary().summary.points);
  assert.equal(relay.portCloses, 1);
  assert.equal(relay.intervals.size, 0);
  assert.equal(relay.timeouts.size, 0);
});

function progressResponse(extra) {
  return { progress: { phase: "writing", processedSections: 1, totalSections: 1, sourceIncomplete: false, coverageIncomplete: false, ...extra } };
}

test("Statusabfragen zeigen Fortschritt, laufen höchstens einmal parallel und können die Hauptanfrage nicht abschließen", async function () {
  for (const namespace of ["browser", "chrome"]) {
    const relay = keepaliveRelay(namespace);
    const progress = [];
    let complete = false;
    const pending = summary.loadSummary("abcdefghijk", summaryEnvironment({ host: relay.host, onProgress(value) { progress.push(value); } }))
      .then(function (result) { complete = true; return result; });
    await delay(0);
    const id = relay.requestArguments[0].requestId;
    assert.match(id, /^[A-Za-z0-9_-]{12,96}$/);
    relay.poll();
    relay.poll();
    assert.equal(relay.statusRequests.length, 1, "eine noch offene Statusabfrage wird nicht dupliziert");
    const first = relay.statusRequests[0];
    assert.deepEqual(first.args[0], { type: "langform:summary-status", requestId: id });
    assert.equal(first.args.length, namespace === "chrome" ? 2 : 1);
    first.reply(progressResponse({ tldr: "Der gesamte Versuch zeigt einen Unterschied." }));
    await delay(0);
    assert.equal(progress.length, 1);
    assert.equal(complete, false, "ein vollständiger TLDR ist noch kein Endergebnis");
    relay.poll();
    relay.statusRequests[1].reply(modelSummary());
    await delay(0);
    assert.equal(complete, false, "selbst eine Endantwort auf dem Statuskanal beendet den Auftrag nicht");
    assert.equal(progress.length, 1);
    relay.poll();
    const latePoll = relay.statusRequests[2];
    relay.reply(modelSummary());
    assert.deepEqual((await pending).summary.points, modelSummary().summary.points);
    latePoll.reply(progressResponse({ tldr: "Verspäteter Status." }));
    await delay(0);
    assert.equal(progress.length, 1, "Statusantwort nach dem Endergebnis wird ignoriert");
    assert.equal(relay.nativeCalls, 1);
    assert.equal(relay.intervals.size, 0);
    assert.equal(relay.timeouts.size, 0);
  }
});

test("fehlende, fehlerhafte und unbegrenzte Statusdaten verändern weder Vorschau noch Hauptantwort", async function () {
  const relay = keepaliveRelay();
  const progress = [];
  const pending = summary.loadSummary("abcdefghijk", summaryEnvironment({ host: relay.host, onProgress(value) { progress.push(value); } }));
  await delay(0);
  const invalid = [
    undefined, {}, { progress: [] }, progressResponse({ phase: "unknown" }),
    progressResponse({ processedSections: -1 }), progressResponse({ processedSections: 1.5 }),
    progressResponse({ processedSections: 2, totalSections: 1 }), progressResponse({ totalSections: 10001 }),
    progressResponse({ sourceIncomplete: "false" }), progressResponse({ coverageIncomplete: undefined }),
    progressResponse({ tldr: "a".repeat(2001) }), progressResponse({ tldr: {} }),
    progressResponse({ phase: "reading", tldr: "Zu früh." }),
    progressResponse({ processedSections: 0, tldr: "Nicht vollständig gelesen." }),
    progressResponse({ coverageIncomplete: true, tldr: "Unvollständige Auswahl." }),
    progressResponse({ sourceIncomplete: true, tldr: "Die verfügbare Teilquelle ist keine vollständige Vorschau." }),
  ];
  for (const response of invalid) {
    relay.poll();
    relay.statusRequests.at(-1).reply(response);
    await delay(0);
  }
  relay.poll();
  relay.statusRequests.at(-1).reject(new Error("status unavailable"));
  await delay(0);
  assert.deepEqual(progress, []);
  relay.poll();
  relay.statusRequests.at(-1).reply(progressResponse({ phase: "reading", processedSections: 2, totalSections: 4 }));
  await delay(0);
  assert.equal(progress.length, 1, "gültige spätere Fortschritte bleiben verfügbar");
  relay.reply(modelSummary());
  assert.deepEqual((await pending).summary.points, modelSummary().summary.points);
});

test("Portabbruch und Timeout stoppen Statusabfragen und ignorieren bereits ausstehende Statusantworten", async function () {
  for (const stop of ["drop", "expire"]) {
    const relay = keepaliveRelay();
    const progress = [];
    const pending = summary.loadSummary("abcdefghijk", summaryEnvironment({ host: relay.host, onProgress(value) { progress.push(value); } }));
    await delay(0);
    relay.poll();
    relay[stop]();
    assert.equal((await pending).code, stop === "drop" ? "RELAY_DISCONNECTED" : "NATIVE_TIMEOUT");
    relay.statusRequests[0].reply(progressResponse({ tldr: "Zu spät." }));
    await delay(0);
    relay.poll();
    assert.equal(relay.statusRequests.length, 1);
    assert.deepEqual(progress, []);
    assert.equal(relay.intervals.size, 0);
  }
});

test("WebView und direkter Native-Fallback starten keine Safari-Statusabfragen", async function () {
  for (const mode of ["webview", "native"]) {
    const relay = keepaliveRelay();
    let reply;
    if (mode === "webview") {
      relay.host.webkit = { messageHandlers: { langformSummary: { postMessage(request) { reply = function (response) { relay.host.__langformKurzFinish(request.id, response); }; } } } };
    } else {
      delete relay.runtime.sendMessage;
      relay.runtime.sendNativeMessage = function () { return new Promise(function (resolve) { reply = resolve; }); };
    }
    const pending = summary.loadSummary("abcdefghijk", summaryEnvironment({ host: relay.host, onProgress() { assert.fail("kein Fortschrittskanal"); } }));
    await delay(0);
    assert.equal(relay.intervals.size, 0);
    relay.poll();
    assert.equal(relay.statusRequests.length, 0);
    reply(modelSummary());
    assert.deepEqual((await pending).summary.points, modelSummary().summary.points);
  }
});

function summaryUi(t, ids, replies) {
  const dom = new JSDOM('<!DOCTYPE html><body>' + ids.map(function (id) {
    return '<ytm-video-with-context-renderer><a href="/watch?v=' + id + '">Film</a></ytm-video-with-context-renderer>';
  }).join("") + '</body>', { url: "https://m.youtube.com/" });
  const win = dom.window;
  const calls = { fetch: 0, model: 0 };
  win.fetch = function (href) {
    calls.fetch += 1;
    const url = new URL(href);
    const source = url.pathname === "/watch" ? "ytInitialPlayerResponse=" + JSON.stringify({
      videoDetails: { videoId: url.searchParams.get("v") },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [DE_TRACK] } },
    }) + ";" : JSON.stringify({ events: [{ segs: [{ utf8: "Das Gemüse braucht 20 Minuten. Danach ruht es kurz." }] }] });
    return Promise.resolve({ ok: true, text: async function () { return source; } });
  };
  win.webkit = { messageHandlers: { langformSummary: { postMessage(request) {
    const response = replies ? replies(calls.model) : { summary: { points: ["Das Gemüse braucht 20 Minuten."] } };
    calls.model += 1;
    win.__langformKurzFinish(request.id, response);
  } } } };
  summary.decorate(win.document, win.location.href, win);
  t.after(function () { win.close(); });
  return {
    win: win,
    calls: calls,
    open(id) { win.document.querySelector('[data-langform-kurz="' + id + '"]').click(); },
    close() { win.document.querySelector("#langform-kurzfassung header button").click(); },
    points() { return [...win.document.querySelectorAll("#langform-kurzfassung li")].map(function (el) { return el.textContent; }); },
  };
}

function progressUi(t, ids) {
  const ui = summaryUi(t, ids);
  const relay = keepaliveRelay();
  delete ui.win.webkit;
  Object.assign(ui.win, relay.host);
  return { ...ui, relay };
}

test("TLDR erscheint sicher als laufende Vorschau und bleibt beim Schließen und Zurückwechseln sofort verfügbar", async function (t) {
  const ui = progressUi(t, ["abcdefghijk", "zyxwvutsrqp"]);
  ui.open("abcdefghijk");
  await delay(0);
  const firstId = ui.relay.requestArguments[0].requestId;
  const firstRequest = ui.win.__langformKurzRequests.pending.abcdefghijk;
  ui.relay.poll();
  ui.relay.statusRequests.at(-1).reply(progressResponse({ phase: "reading", processedSections: 1, totalSections: 2 }));
  await delay(0);
  let sheet = ui.win.document.getElementById("langform-kurzfassung");
  assert.match(sheet.textContent, /1 von 2 Abschnitten/);
  ui.relay.poll();
  const draft = "Der gesamte Versuch zeigt <img src=x onerror=alert(1)> einen Unterschied.";
  ui.relay.statusRequests.at(-1).reply(progressResponse({ tldr: draft }));
  await delay(0);
  assert.equal(sheet.querySelector("h3").textContent, "TLDR");
  assert.match(sheet.textContent, /Wird noch ergänzt/);
  assert.equal(sheet.querySelector("img"), null, "Vorschau wird als Text eingesetzt");
  assert.ok(sheet.textContent.includes(draft));
  assert.equal(sheet.getAttribute("data-summary-state"), "pending");
  assert.equal(sheet.querySelector(".langform-kurz-body").getAttribute("aria-busy"), "true");
  assert.equal(ui.win.__langformKurzCache.entries.length, 0);
  ui.open("abcdefghijk");
  assert.equal(firstRequest.observers.size, 1, "erneuter Klick ersetzt den Beobachter");
  ui.close();
  assert.equal(firstRequest.observers.size, 0);
  ui.open("abcdefghijk");
  sheet = ui.win.document.getElementById("langform-kurzfassung");
  assert.ok(sheet.textContent.includes(draft), "neues Sheet übernimmt Vorschau synchron");
  assert.equal(ui.relay.nativeCalls, 1);
  ui.open("zyxwvutsrqp");
  await delay(0);
  const secondId = ui.relay.requestArguments[0].requestId;
  assert.notEqual(firstId, secondId);
  assert.equal(firstRequest.observers.size, 0, "Video-Wechsel entfernt vorherigen Beobachter");
  ui.relay.poll();
  const recent = ui.relay.statusRequests.slice(-2);
  recent.find(function (entry) { return entry.args[0].requestId === firstId; }).reply(progressResponse({ tldr: "Aktualisierter erster Film." }));
  recent.find(function (entry) { return entry.args[0].requestId === secondId; }).reply(progressResponse({ tldr: "Zweiter Film." }));
  await delay(0);
  assert.match(sheet.textContent, /Zweiter Film/);
  assert.doesNotMatch(sheet.textContent, /erster Film/);
  ui.open("abcdefghijk");
  assert.match(sheet.textContent, /Aktualisierter erster Film/);
  assert.doesNotMatch(sheet.textContent, /Zweiter Film/);
  assert.equal(ui.relay.nativeCalls, 2);
  ui.relay.reply({ summary: { points: ["Fertiger zweiter Film."] } }, 1);
  await delay(0);
  assert.doesNotMatch(sheet.textContent, /Fertiger zweiter Film/);
  ui.relay.reply({ summary: { tldr: "Fertiger erster Film.", points: ["Ein erklärter Punkt."] } }, 0);
  await delay(0);
  assert.match(sheet.textContent, /Fertiger erster Film/);
  assert.doesNotMatch(sheet.textContent, /Wird noch ergänzt|Aktualisierter/);
  assert.equal(sheet.getAttribute("data-summary-state"), "ready");
  assert.equal(firstRequest.observers.size, 0);
  assert.equal(firstRequest.progress, null);
  assert.equal(sheet.__langformKurzStopProgress, null);
  assert.equal(ui.win.__langformKurzCache.entries.length, 2);
});

test("später Fehler ersetzt den frühen TLDR vollständig und speichert keine Vorschau", async function (t) {
  const ui = progressUi(t, ["abcdefghijk"]);
  ui.open("abcdefghijk");
  await delay(0);
  const request = ui.win.__langformKurzRequests.pending.abcdefghijk;
  ui.relay.poll();
  ui.relay.statusRequests.at(-1).reply(progressResponse({ tldr: "Vorläufiger TLDR." }));
  await delay(0);
  const sheet = ui.win.document.getElementById("langform-kurzfassung");
  assert.match(sheet.textContent, /Vorläufiger TLDR/);
  ui.relay.reply({ code: "GENERATION_FAILED" });
  await delay(0);
  assert.doesNotMatch(sheet.textContent, /Vorläufiger TLDR|Wird noch ergänzt/);
  assert.equal(sheet.getAttribute("data-summary-state"), "error");
  assert.match(sheet.textContent, /Erneut versuchen/);
  assert.equal(sheet.querySelector(".langform-kurz-body").getAttribute("aria-busy"), "false");
  assert.equal(ui.win.__langformKurzCache.entries.length, 0);
  assert.equal(Object.keys(ui.win.__langformKurzRequests.pending).length, 0);
  assert.equal(request.observers.size, 0);
  assert.equal(request.progress, null);
  ui.close();
  ui.open("abcdefghijk");
  await delay(0);
  assert.equal(ui.relay.nativeCalls, 2);
  assert.doesNotMatch(ui.win.document.getElementById("langform-kurzfassung").textContent, /Vorläufiger TLDR/);
  ui.relay.reply(modelSummary());
  await delay(0);
});

test("erneutes Öffnen zeigt die Kurzfassung sofort ohne weitere Untertitel- oder Modellanfrage; alte Cacheversionen werden ignoriert", async function (t) {
  const ui = summaryUi(t, ["abcdefghijk"]);
  ui.win.localStorage.setItem("user-preference", "keep");
  ui.open("abcdefghijk");
  await delay(20);
  assert.deepEqual(ui.points(), ["Das Gemüse braucht 20 Minuten."]);
  const requests = { ...ui.calls };
  ui.close();
  ui.open("abcdefghijk");
  assert.deepEqual(ui.points(), ["Das Gemüse braucht 20 Minuten."], "Cache ist synchron sichtbar");
  await delay(20);
  assert.deepEqual(ui.calls, requests);
  ui.close();
  ui.win.__langformKurzCache.version = "key-points-2";
  ui.open("abcdefghijk");
  await delay(20);
  assert.equal(ui.calls.model, requests.model + 1);
  assert.equal(ui.win.localStorage.getItem("user-preference"), "keep");
});

test("TLDR, erklärte Punkte und Merksatz bleiben vollständig erhalten und werden gemeinsam zwischengespeichert", async function (t) {
  const explanation = "Das entstehende Produkt hilft bei der Herstellung weiterer Produkte derselben Variante. " +
    "Dadurch kann ein kleiner anfänglicher Vorsprung wachsen. " +
    "Die Forscher haben diesen Effekt im Labor untersucht. " +
    "Das beweist noch nicht, dass das Leben auf demselben Weg entstanden ist.";
  const supplied = {
    tldr: "Manche Moleküle gibt es als spiegelbildliche Varianten. Bestimmte Reaktionen können einen kleinen Vorsprung verstärken.",
    points: [explanation, "Wenn beide Varianten gleich schnell wachsen, bleibt ihr Verhältnis gleich."],
    takeaway: "Entscheidend ist, ob ein Prozess den Vorsprung immer weiter verstärkt.",
    caveat: "Die Ergebnisse stammen aus einem Laborversuch.",
    coverage: { processedSections: 3, totalSections: 3, complete: true },
  };
  const ui = summaryUi(t, ["abcdefghijk"], function () { return { summary: supplied }; });
  ui.open("abcdefghijk");
  await delay(20);
  const doc = ui.win.document;
  const body = doc.querySelector(".langform-kurz-body");
  assert.deepEqual([...body.querySelectorAll("h3")].map(function (h) { return h.textContent; }), [
    "TLDR", "Die wichtigsten Punkte", "Das bleibt hängen", "Wichtige Einordnung",
  ]);
  assert.deepEqual([...body.querySelectorAll("p")].map(function (p) { return p.textContent; }), [
    supplied.tldr, supplied.takeaway, supplied.caveat,
  ]);
  assert.deepEqual(ui.points(), supplied.points, "Erklärungen werden nicht auf einen Satz gekürzt");
  assert.deepEqual(ui.win.__langformKurzCache.entries[0].result.summary, supplied);
  assert.equal(body.getAttribute("aria-busy"), "false");
  assert.equal(body.getAttribute("aria-live"), "polite");
  const dialog = doc.querySelector('[role="dialog"]');
  assert.equal(doc.getElementById(dialog.getAttribute("aria-labelledby")).textContent, "Das Wichtigste");
  const calls = { ...ui.calls };
  ui.close();
  ui.open("abcdefghijk");
  assert.match(doc.querySelector(".langform-kurz-body").textContent, /Entscheidend ist/);
  assert.deepEqual(ui.points(), supplied.points);
  await delay(20);
  assert.deepEqual(ui.calls, calls, "alle Teile erscheinen aus dem Sitzungscache");
});

test("neue Kurzfassungen bleiben reiner Text, fehlende Einordnungen und alte Antwortteile werden nicht erfunden", async function (t) {
  const ui = summaryUi(t, ["abcdefghijk", "zyxwvutsrqp"], function (index) {
    return index === 0 ? { summary: {
      tldr: "**Ein Ergebnis** wird im Labor gezeigt. <img src=x onerror=alert(1)>",
      points: ["Die Proben liegen im Bereich [0,1]. Das ist eine gemessene Spanne."],
      takeaway: "Die Messung gilt für diese Proben.",
      caveat: "  ",
    } } : { summary: { about: "Nicht als neuer TLDR verwenden.", points: ["Eine belastbare Erkenntnis."], ending: "Nicht als neuer Merksatz verwenden." } };
  });
  ui.open("abcdefghijk");
  await delay(20);
  let body = ui.win.document.querySelector(".langform-kurz-body");
  assert.equal(body.querySelector("img, script, strong, b"), null);
  assert.match(body.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(body.textContent, /\*\*/);
  assert.match(body.textContent, /\[0,1\]/, "fachlich relevante Klammern bleiben erhalten");
  assert.deepEqual([...body.querySelectorAll("h3")].map(function (h) { return h.textContent; }), [
    "TLDR", "Die wichtigsten Punkte", "Das bleibt hängen",
  ]);
  ui.close();
  ui.open("zyxwvutsrqp");
  await delay(20);
  body = ui.win.document.querySelector(".langform-kurz-body");
  assert.equal(body.querySelector("h3"), null, "alte Antwort enthält nur vorhandene Punkte");
  assert.deepEqual(ui.points(), ["Eine belastbare Erkenntnis."]);
  assert.doesNotMatch(body.textContent, /Nicht als neuer/);
});

test("bekannte unvollständige Untertitel und genaue native Fehler bleiben erkennbar", async function (t) {
  const ui = summaryUi(t, ["abcdefghijk", "zyxwvutsrqp"], function (index) {
    return index === 0 ? { summary: {
      tldr: "Der verfügbare Versuch zeigt einen Unterschied.", points: ["Es wurden zwei Proben verglichen."],
      takeaway: "Der Vergleich betrifft diese beiden Proben.",
      caveat: "Das Ergebnis wurde nur im Labor gezeigt.",
      coverage: { processedSections: 1, totalSections: 2, complete: false },
    } } : { code: "UNUSABLE_CAPTIONS", message: "Die Untertitel sind unverständlich." };
  });
  ui.open("abcdefghijk");
  await delay(20);
  const partialText = ui.win.document.querySelector(".langform-kurz-body").textContent;
  assert.match(partialText, /Das Ergebnis wurde nur im Labor gezeigt/);
  assert.match(partialText, /beruht auf einem Teil der verfügbaren Untertitel/);
  assert.equal(partialText.split("Die Kurzfassung beruht").length - 1, 1);
  assert.equal(ui.win.__langformKurzCache.entries.length, 0, "unvollständige Antworten bleiben erneut versuchbar");
  ui.close();
  ui.open("zyxwvutsrqp");
  await delay(20);
  assert.match(ui.win.document.querySelector(".langform-kurz-body").textContent, /Die Untertitel sind unverständlich/);
  assert.equal(ui.win.__langformKurzCache.entries.length, 0, "Fehler werden nicht als Kurzfassung gespeichert");
  const failed = await summary.loadSummary("abcdefghijk", {
    player: { videoDetails: { videoId: "abcdefghijk" }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [DE_TRACK] } } },
    fetchText() { return Promise.resolve(JSON.stringify({ events: [{ segs: [{ utf8: "Unverständlicher Inhalt." }] }] })); },
    summarize() { return { code: "UNUSABLE_CAPTIONS", message: "Die Untertitel sind unverständlich." }; },
  });
  assert.deepEqual(failed, { code: "UNUSABLE_CAPTIONS", message: "Die Untertitel sind unverständlich." });
});

test("fehlgeschlagene Kurzfassungen bleiben erneut versuchbar und der Sitzungscache ist begrenzt", async function (t) {
  const ids = Array.from({ length: 14 }, function (_, i) { return "cached" + String(i).padStart(5, "0"); });
  const ui = summaryUi(t, ids, function (request) {
    return request === 0 ? { code: "MODEL_UNAVAILABLE", message: summary.UNAVAILABLE } : { summary: { points: ["Das Gemüse braucht 20 Minuten."] } };
  });
  ui.open(ids[0]);
  await delay(20);
  assert.equal(ui.win.__langformKurzCache.entries.length, 0);
  ui.close();
  for (const id of ids) {
    ui.open(id);
    await delay(10);
    assert.equal(ui.points().length, 1);
    ui.close();
  }
  assert.equal(ui.calls.model, ids.length + 1);
  assert.equal(ui.win.__langformKurzCache.entries.length, 12);
  ui.open(ids[ids.length - 1]);
  assert.equal(ui.points().length, 1);
  assert.equal(ui.calls.model, ids.length + 1);
  ui.close();
  ui.open(ids[0]);
  await delay(20);
  assert.equal(ui.calls.model, ids.length + 2, "ältester Eintrag wurde freigegeben");
});

test("unvollständige Kurzfassungen bleiben sichtbar, werden beim nächsten Öffnen aber neu erstellt", async function (t) {
  const ui = summaryUi(t, ["abcdefghijk"], function (index) {
    return index < 2 ? { summary: { points: ["Vorläufiger Punkt."], coverage: { complete: false } } } : modelSummary();
  });
  ui.open("abcdefghijk");
  await delay(20);
  assert.deepEqual(ui.points(), ["Vorläufiger Punkt."]);
  assert.equal(ui.win.__langformKurzCache.entries.length, 0);
  ui.open("abcdefghijk");
  await delay(20);
  assert.equal(ui.calls.model, 2, "offenes Sheet verhindert keinen erneuten Versuch");
  ui.close();
  ui.open("abcdefghijk");
  await delay(20);
  assert.equal(ui.calls.model, 3);
  assert.deepEqual(ui.points(), modelSummary().summary.points);
  assert.equal(ui.win.__langformKurzCache.entries.length, 1, "vollständige Antwort wird wiederverwendet");
});

test("ein offenes Fehlermodal versucht dasselbe Video erneut; gültige Kurzfassungen bleiben sofort verfügbar", async function (t) {
  const ui = summaryUi(t, ["abcdefghijk"], function (index) {
    return index < 2 ? { code: "NATIVE_CONNECTION_FAILED", message: "Die Kurzfassung-App konnte nicht erreicht werden." } : modelSummary();
  });
  ui.open("abcdefghijk");
  await delay(20);
  const sheet = ui.win.document.getElementById("langform-kurzfassung");
  assert.equal(sheet.getAttribute("data-summary-state"), "error");
  assert.equal(ui.calls.model, 1);
  ui.open("abcdefghijk");
  await delay(20);
  assert.equal(ui.calls.model, 2, "Fehler gilt beim erneuten Klick nicht als fertige Kurzfassung");
  assert.equal(ui.win.document.getElementById("langform-kurzfassung"), sheet);
  assert.equal(sheet.querySelector(".langform-kurz-retry").textContent, "Erneut versuchen");
  sheet.querySelector(".langform-kurz-retry").click();
  await delay(20);
  assert.equal(ui.calls.model, 3);
  assert.equal(sheet.getAttribute("data-summary-state"), "ready");
  assert.deepEqual(ui.points(), modelSummary().summary.points);
  assert.equal(sheet.querySelector(".langform-kurz-retry"), null);
  ui.open("abcdefghijk");
  await delay(20);
  assert.equal(ui.calls.model, 3, "die erfolgreiche Kurzfassung bleibt ohne weitere Anfrage sichtbar");
});

test("wiederholte Klicks während der lokalen Erstellung verwenden genau eine laufende Anfrage", async function (t) {
  const ui = summaryUi(t, ["abcdefghijk"]);
  let ticket;
  ui.win.webkit.messageHandlers.langformSummary.postMessage = function (request) {
    ui.calls.model++;
    ticket = request.id;
  };
  ui.open("abcdefghijk");
  await delay(20);
  const sheet = ui.win.document.getElementById("langform-kurzfassung");
  assert.equal(sheet.getAttribute("data-summary-state"), "pending");
  ui.open("abcdefghijk");
  ui.open("abcdefghijk");
  await delay(20);
  assert.equal(ui.calls.model, 1);
  ui.win.__langformKurzFinish(ticket, modelSummary());
  await delay(20);
  assert.equal(sheet.getAttribute("data-summary-state"), "ready");
  assert.deepEqual(ui.points(), modelSummary().summary.points);
  assert.equal(ui.calls.model, 1);
});

test("Schließen und Video-Wechsel verwenden weiterhin die laufende Kurzfassung ohne zweite Modellanfrage", async function (t) {
  const ui = summaryUi(t, ["abcdefghijk", "zyxwvutsrqp"]);
  const tickets = [];
  ui.win.webkit.messageHandlers.langformSummary.postMessage = function (request) {
    ui.calls.model++;
    tickets.push(request.id);
  };
  ui.open("abcdefghijk");
  await delay(20);
  const fetches = ui.calls.fetch;
  ui.close();
  ui.open("abcdefghijk");
  await delay(20);
  assert.equal(ui.calls.model, 1, "neu erstelltes Sheet hängt sich an dieselbe Anfrage");
  assert.equal(ui.calls.fetch, fetches, "auch die Untertitel werden nicht erneut abgerufen");
  ui.open("zyxwvutsrqp");
  await delay(20);
  ui.open("abcdefghijk");
  await delay(20);
  assert.equal(ui.calls.model, 2, "jedes Video hat genau einen laufenden Auftrag");
  ui.win.__langformKurzFinish(tickets[1], { summary: { points: ["Anderes Video."] } });
  await delay(0);
  assert.deepEqual(ui.points(), [], "das fremde Ergebnis überschreibt den gewählten Film nicht");
  ui.win.__langformKurzFinish(tickets[0], modelSummary());
  await delay(0);
  assert.deepEqual(ui.points(), modelSummary().summary.points);
  ui.open("zyxwvutsrqp");
  assert.deepEqual(ui.points(), ["Anderes Video."], "abgeschlossenes Ergebnis ist beim Wechsel sofort sichtbar");
  assert.equal(Object.keys(ui.win.__langformKurzRequests.pending).length, 0);
});

test("Watch-Seite zeigt die Kurzfassung unter dem Video", async function () {
  const dom = new JSDOM(
    "<!DOCTYPE html><html><body><ytd-player id=\"movie_player\"><video></video></ytd-player><ytd-watch-metadata><h1>Auflauf</h1></ytd-watch-metadata></body></html>",
    { url: "https://www.youtube.com/watch?v=abcdefghijk" }
  );
  const win = dom.window;
  const seen = [];
  win.ytInitialPlayerResponse = { videoDetails: { videoId: "abcdefghijk" } };
  win.fetch = function (url) {
    seen.push(String(url));
    return Promise.resolve({ ok: true, text: async function () { return ""; } });
  };
  summary.decorate(win.document, win.location.href, win);
  const player = win.document.querySelector("ytd-player");
  const video = win.document.querySelector("video");
  const button = win.document.querySelector("ytd-watch-metadata [data-langform-kurz]");
  assert.equal(button.textContent, "Kurzfassung");
  assert.equal(win.document.getElementById("langform-kurzfassung"), null);
  assert.equal(player.contains(button), false);
  button.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  const sheet = win.document.getElementById("langform-kurzfassung");
  assert.ok(sheet);
  assert.equal(sheet.parentElement, win.document.body);
  assert.equal(sheet.className, "langform-kurz-sheet");
  assert.equal(sheet.getAttribute("lang"), "de");
  assert.match(sheet.textContent, /Das Wichtigste/);
  assert.match(sheet.textContent, /Schließen/);
  const css = win.document.getElementById("langform-kurz-style").textContent;
  assert.match(css, /\.langform-kurz-sheet \{[^}]*position:\s*fixed/);
  assert.match(css, /#161410/);
  assert.match(css, /white-space:\s*nowrap/);
  assert.match(css, /overflow-y:\s*auto/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.equal(player.contains(sheet), false);
  assert.equal(video.parentElement, player);
  await delay(20);
  assert.match(sheet.textContent, /Für dieses Video gibt es keine Untertitel/);
  assert.deepEqual(seen, []);
  sheet.querySelector("button").click();
  assert.equal(win.document.getElementById("langform-kurzfassung"), null);
});

test("isolierte Safari-Welt liest den gefüllten Player in der Seite", async function () {
  const dom = new JSDOM(
    "<!DOCTYPE html><html><body><ytd-watch-metadata><h1>Gespräch</h1></ytd-watch-metadata></body></html>",
    { url: "https://www.youtube.com/watch?v=abcdefghijk" }
  );
  const win = dom.window;
  win.chrome = { runtime: { id: "de.ipekkaya.shorts-ausblenden" } };
  win.ytInitialPlayerResponse = null;
  let filled = false;
  const calls = [];
  win.fetch = function (url) {
    const href = String(url);
    assert.equal(filled, true);
    assert.equal(href.includes("googlevideo"), false);
    assert.equal(href.includes("/watch"), false);
    calls.push(href);
    if (href.includes("fmt=json3")) {
      return Promise.resolve({
        ok: true,
        text: async function () {
          return JSON.stringify({ events: [{ segs: [{ utf8: "Der Ofen übernimmt den Rest." }] }] });
        },
      });
    }
    return Promise.resolve({ ok: true, text: async function () { return "   "; } });
  };
  pageCaptions.install(win);
  win.setTimeout(function () {
    filled = true;
    win.ytInitialPlayerResponse = {
      videoDetails: { videoId: "abcdefghijk" },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [DE_TRACK],
          translationLanguages: [],
        },
      },
    };
  }, 40);
  summary.decorate(win.document, win.location.href, win);
  const button = win.document.querySelector("[data-langform-kurz]");
  button.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  await delay(400);
  const sheet = win.document.getElementById("langform-kurzfassung");
  assert.match(calls[0], /\/api\/timedtext/);
  assert.match(calls[1], /fmt=json3/);
  assert.match(sheet.textContent, /Das Wichtigste/);
  assert.match(sheet.textContent, /Die Verbindung zur Kurzfassung-App ist gerade nicht verfügbar/);
  assert.equal(/Untertitel sind leer/.test(sheet.textContent), false);
  assert.equal(sheet.textContent.includes("Der Ofen übernimmt den Rest"), false);
});

test("Watch-Seite wartet, das erste null ist kein Player", async function () {
  const dom = new JSDOM(
    "<!DOCTYPE html><html><body><ytd-watch-metadata><h1>Gespräch</h1></ytd-watch-metadata></body></html>",
    { url: "https://www.youtube.com/watch?v=abcdefghijk" }
  );
  const win = dom.window;
  win.ytInitialPlayerResponse = null;
  const calls = [];
  win.fetch = function (url) {
    const href = String(url);
    assert.equal(href.includes("googlevideo"), false);
    assert.equal(href.includes("/watch"), false);
    calls.push(href);
    return Promise.resolve({
      ok: true,
      text: async function () {
        return '<transcript><text start="0" dur="1">Der Ofen übernimmt den Rest.</text></transcript>';
      },
    });
  };
  win.setTimeout(function () {
    win.ytInitialPlayerResponse = {
      videoDetails: { videoId: "abcdefghijk" },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [DE_TRACK],
          translationLanguages: [],
        },
      },
    };
  }, 30);
  summary.decorate(win.document, win.location.href, win);
  win.document.querySelector("[data-langform-kurz]").dispatchEvent(
    new win.MouseEvent("click", { bubbles: true, cancelable: true })
  );
  await delay(300);
  const sheet = win.document.getElementById("langform-kurzfassung");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/timedtext/);
  assert.match(sheet.textContent, /Verbindung zur Kurzfassung-App/);
  assert.equal(/Untertitel sind leer/.test(sheet.textContent), false);
  assert.equal(/keine Untertitel/.test(sheet.textContent), false);
});

test("Startseite öffnet die Kurzfassung, ohne die Wiedergabe zu starten", async function () {
  const dom = new JSDOM(
    [
      "<!DOCTYPE html><html><body>",
      '<ytd-rich-item-renderer id="long"><a href="/watch?v=abcdefghijk">Auflauf</a><span class="ytd-thumbnail-overlay-time-status-renderer">10:00</span></ytd-rich-item-renderer>',
      '<ytd-rich-item-renderer id="short"><a href="/watch?v=shortvid123">Happen</a><ytd-thumbnail-overlay-time-status-renderer>0:30</ytd-thumbnail-overlay-time-status-renderer></ytd-rich-item-renderer>',
      '<ytd-rich-item-renderer id="open"><a href="/watch?v=unknownlen1">Ohne Länge</a></ytd-rich-item-renderer>',
      '<ytd-rich-item-renderer id="clip"><a href="/shorts/abcdefghijk">Short</a></ytd-rich-item-renderer>',
      "</body></html>",
    ].join(""),
    { url: "https://www.youtube.com/" }
  );
  const win = dom.window;
  let played = false;
  win.document.querySelector("#long a").addEventListener("click", function () {
    played = true;
  });
  const fetched = [];
  win.fetch = function (url, opts) {
    fetched.push({ url: String(url), credentials: opts && opts.credentials });
    return Promise.resolve({
      ok: true,
      text: async function () {
        return "ytInitialPlayerResponse = " + JSON.stringify({ videoDetails: { videoId: "abcdefghijk" } }) + ";";
      },
    });
  };
  summary.decorate(win.document, win.location.href, win);
  assert.equal(win.document.querySelector("#short [data-langform-kurz]"), null);
  assert.equal(win.document.querySelector("#clip [data-langform-kurz]"), null);
  assert.ok(win.document.querySelector("#open [data-langform-kurz]"));
  const button = win.document.querySelector("#long [data-langform-kurz]");
  assert.equal(button.textContent, "Kurzfassung");
  const before = win.location.href;
  button.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(played, false);
  assert.equal(win.location.href, before);
  const sheet = win.document.getElementById("langform-kurzfassung");
  const card = win.document.getElementById("long");
  assert.equal(sheet.parentElement, win.document.body);
  assert.equal(card.contains(sheet), false);
  assert.notEqual(card.nextSibling, sheet);
  const panel = sheet;
  await delay(20);
  assert.match(panel.textContent, /keine Untertitel/);
  assert.ok(fetched.length > 0);
  fetched.forEach(function (call) {
    assert.equal(call.credentials, "include");
    assert.equal(call.url.includes("googlevideo"), false);
  });
});

test("Playlist-Kopf ist keine Videozeile, jede Zeile hat genau einen Knopf", async function () {
  const dom = new JSDOM(
    [
      "<!DOCTYPE html><html><body>",
      '<yt-page-header-view-model id="header">',
      '<a href="/watch?v=headerid111&list=WL">Alle abspielen</a>',
      '<a href="/watch?v=headerid111&list=WL&shuffle=1">Zufallsmix</a>',
      "</yt-page-header-view-model>",
      '<div id="list">',
      '<yt-lockup-view-model id="row">',
      '<a class="thumb" href="/watch?v=videoone111&list=WL&index=2"><span class="ytd-thumbnail-overlay-time-status-renderer">47:42</span></a>',
      '<div class="yt-lockup-view-model__metadata"><yt-lockup-metadata-view-model>',
      '<h3 id="video-title"><a href="/watch?v=videoone111&list=WL&index=2">Langes Gespräch</a></h3>',
      "<div>Kanal</div></yt-lockup-metadata-view-model></div>",
      '<button class="menu" type="button">Mehr</button>',
      "</yt-lockup-view-model>",
      '<yt-lockup-view-model id="other">',
      '<div class="yt-lockup-view-model__metadata"><h3><a href="/watch?v=videotwo222&list=WL">Zweite Folge</a></h3></div>',
      '<span class="ytd-thumbnail-overlay-time-status-renderer">1:40:18</span>',
      "</yt-lockup-view-model>",
      "</div></body></html>",
    ].join(""),
    { url: "https://m.youtube.com/playlist?list=WL" }
  );
  const win = dom.window;
  const doc = win.document;
  const row = doc.getElementById("row");
  const listCount = doc.getElementById("list").childElementCount;
  const rowCount = row.childElementCount;
  const player = {
    videoDetails: { videoId: "videoone111" },
    streamingData: { formats: [{ url: "https://rr.googlevideo.com/videoplayback?id=1" }] },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            languageCode: "en",
            baseUrl:
              "https://www.youtube.com/api/timedtext?v=videoone111&lang=en&signature=ABC123&pot=99",
          },
        ],
        translationLanguages: [{ languageCode: "de" }],
      },
    },
  };
  const watchHtml =
    "ytInitialPlayerResponse = null;\nvar ytInitialPlayerResponse = " + JSON.stringify(player) + ";";
  assert.equal(summary.extractPlayer("ytInitialPlayerResponse = null;"), null);
  assert.equal(summary.extractPlayer(watchHtml, "videoone111").videoDetails.videoId, "videoone111");
  const fetched = [];
  win.fetch = function (url, opts) {
    fetched.push({ url: String(url), credentials: opts && opts.credentials });
    if (String(url).indexOf("/watch") !== -1) {
      return Promise.resolve({ ok: true, text: async function () { return watchHtml; } });
    }
    return Promise.resolve({
      ok: true,
      text: async function () {
        return JSON.stringify({
          events: [
            { segs: [{ utf8: "Heute geht es um ein langes Gespräch über die Stadt." }] },
            { segs: [{ utf8: "Zuerst erzählt sie, wie der Markt aufgebaut ist." }] },
            { segs: [{ utf8: "Zum Schluss bleibt der Platz leer." }] },
          ],
        });
      },
    });
  };
  summary.decorate(doc, win.location.href, win);
  assert.equal(doc.querySelectorAll("#header [data-langform-kurz]").length, 0);
  assert.equal(row.querySelectorAll("[data-langform-kurz]").length, 1);
  assert.equal(doc.querySelectorAll("#other [data-langform-kurz]").length, 1);
  const button = row.querySelector("[data-langform-kurz]");
  assert.equal(button.getAttribute("data-langform-kurz"), "videoone111");
  assert.equal(button.textContent, "Kurzfassung");
  assert.notEqual(button.parentElement, row);
  assert.ok(row.querySelector(".yt-lockup-view-model__metadata").contains(button));
  assert.equal(doc.getElementById("video-title").nextSibling, button);
  assert.equal(row.childElementCount, rowCount);
  assert.equal(row.querySelector(".menu").parentElement, row);
  assert.equal(doc.getElementById("list").childElementCount, listCount);
  let followed = false;
  let handed = "";
  row.querySelector("a.thumb").addEventListener("click", function () {
    followed = true;
  });
  win.webkit = {
    messageHandlers: {
      langformSummary: {
        postMessage(body) {
          handed = body.text;
          win.__langformKurzFinish(body.id, {
            summary: {
              about: "Ein Gespräch über den Markt in der Stadt.",
              points: [
                "Der Markt wird aufgebaut.",
                "Die Stadt lebt vom Handel auf dem Platz.",
                "Ohne den Markt bleibt der Platz ungenutzt.",
              ],
              ending: "Am Ende bleibt der Platz leer.",
            },
          });
        },
      },
    },
  };
  button.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(followed, false);
  const sheet = doc.getElementById("langform-kurzfassung");
  assert.equal(sheet.parentElement, doc.body);
  assert.equal(doc.getElementById("list").contains(sheet), false);
  assert.equal(doc.getElementById("list").childElementCount, listCount);
  assert.equal(sheet.getAttribute("data-video"), "videoone111");
  await delay(20);
  assert.equal(/keine Untertitel/.test(sheet.textContent), false);
  assert.match(handed, /langes Gespräch/);
  assert.match(sheet.textContent, /Das Wichtigste/);
  assert.match(sheet.textContent, /Der Markt wird aufgebaut/);
  assert.equal(sheet.querySelectorAll(".langform-kurz-body li").length, 3);
  assert.equal(sheet.querySelector(".langform-kurz-body h3"), null);
  assert.equal(/Worum es geht/.test(sheet.textContent), false);
  assert.equal(/Schluss/.test(sheet.textContent), false);
  assert.equal(sheet.textContent.includes("Ein Gespräch über den Markt"), false);
  assert.equal(sheet.textContent.includes("Platz leer"), false);
  assert.equal(sheet.textContent.includes("Zuerst erzählt sie"), false);
  assert.ok(fetched.length >= 2);
  assert.match(fetched[0].url, /m\.youtube\.com\/watch\?v=videoone111/);
  assert.equal(fetched[0].url.includes("headerid111"), false);
  assert.match(fetched[1].url, /\/api\/timedtext/);
  assert.match(fetched[1].url, /signature=ABC123/);
  assert.match(fetched[1].url, /pot=99/);
  assert.match(fetched[1].url, /tlang=de/);
  fetched.forEach(function (call) {
    assert.equal(call.url.includes("googlevideo"), false);
    assert.equal(call.credentials, "include");
  });
});

test("Startseite liest die signierte WEB-Spur, auch als XML", async function () {
  const calls = [];
  const ytcfg = {
    get(name) {
      if (name === "INNERTUBE_API_KEY") return "test-key";
      if (name === "STS") return 20725;
      if (name === "INNERTUBE_CONTEXT") {
        return {
          client: {
            clientName: "WEB",
            clientVersion: "2.20261002.01.00",
            hl: "de",
            visitorData: "visitortoken",
            configInfo: { appInstallData: "experiment" },
          },
        };
      }
      return null;
    },
  };
  let seen = "";
  const result = await summary.loadSummary("abcdefghijk", {
    pageUrl: "https://www.youtube.com/",
    ytcfg: ytcfg,
    summarize(text) {
      seen = text;
      return modelSummary();
    },
    player: {
      videoDetails: { videoId: "abcdefghijk" },
      streamingData: { formats: [{ url: "https://rr.googlevideo.com/videoplayback?id=1" }] },
    },
    fetchText(url, init) {
      calls.push({ url: String(url), init: init || null });
      if (String(url).includes("/youtubei/v1/player")) {
        return Promise.resolve(
          JSON.stringify({
            videoDetails: { videoId: "abcdefghijk" },
            streamingData: { formats: [{ url: "https://rr.googlevideo.com/videoplayback?id=2" }] },
            captions: {
              playerCaptionsTracklistRenderer: {
                captionTracks: [
                  {
                    languageCode: "de-DE",
                    baseUrl:
                      "https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=de-DE&signature=SIGNED&pot=1",
                  },
                ],
                translationLanguages: [{ languageCode: "de" }],
              },
            },
          })
        );
      }
      return Promise.resolve(
        '<?xml version="1.0" encoding="utf-8" ?><transcript><text start="1" dur="2">Heute geht es um einen Laden, der nachts offen bleibt.</text><text start="4" dur="2">Zuerst versteckt er sich zwischen den Regalen.</text><text start="8" dur="2">Zum Schluss geht das Licht aus.</text></transcript>'
      );
    },
  });
  assert.match(seen, /nachts offen bleibt/);
  assert.equal(result.summary.points.join(" ").includes("nachts offen bleibt"), false);
  assert.equal(result.summary.about, undefined);
  assert.equal(result.message, undefined);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^https:\/\/www\.youtube\.com\/youtubei\/v1\/player\?/);
  assert.match(calls[0].url, /key=test-key/);
  assert.equal(calls[0].init.method, "POST");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.videoId, "abcdefghijk");
  assert.equal(body.context.client.clientName, "WEB");
  assert.equal(body.context.client.visitorData, "visitortoken");
  assert.equal(body.context.client.configInfo, undefined);
  assert.equal(body.playbackContext.contentPlaybackContext.signatureTimestamp, 20725);
  assert.equal(calls[0].init.headers["X-YouTube-Client-Name"], "1");
  assert.match(calls[1].url, /signature=SIGNED/);
  assert.match(calls[1].url, /pot=1/);
  assert.doesNotMatch(calls[1].url, /tlang=/);
  assert.doesNotMatch(calls[1].url, /[?&]fmt=/);
  calls.forEach(function (call) {
    assert.equal(call.url.includes("googlevideo"), false);
    assert.equal(call.url.includes("/watch"), false);
  });
});

test("leerer Body, danach fmt=json3 auf derselben signierten URL", async function () {
  const calls = [];
  let seen = "";
  const result = await summary.loadSummary("abcdefghijk", {
    pageUrl: "https://www.youtube.com/",
    summarize(text) {
      seen = text;
      return modelSummary();
    },
    ytcfg: {
      INNERTUBE_API_KEY: "test-key",
      STS: 20725,
      INNERTUBE_CONTEXT: { client: { clientName: "WEB", clientVersion: "2.1" } },
    },
    fetchText(url) {
      calls.push(String(url));
      if (String(url).includes("/youtubei/v1/player")) {
        return Promise.resolve(
          JSON.stringify({
            videoDetails: { videoId: "abcdefghijk" },
            captions: {
              playerCaptionsTracklistRenderer: {
                captionTracks: [
                  {
                    languageCode: "en",
                    baseUrl: "https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&signature=SIGNED",
                  },
                  {
                    languageCode: "fr",
                    baseUrl: "https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=fr&signature=OTHER",
                  },
                ],
                translationLanguages: [{ languageCode: "de" }],
              },
            },
          })
        );
      }
      if (!String(url).includes("fmt=json3")) return Promise.resolve("");
      return Promise.resolve(
        JSON.stringify({
          events: [
            { segs: [{ utf8: "Heute geht es um einen langen Auflauf aus dem Ofen." }] },
            { segs: [{ utf8: "Zuerst schneidet man das Gemüse klein." }] },
            { segs: [{ utf8: "Zum Schluss ruht er zehn Minuten." }] },
          ],
        })
      );
    },
  });
  assert.match(seen, /langen Auflauf/);
  assert.equal(result.summary.points.join(" ").includes("langen Auflauf"), false);
  assert.equal(result.summary.about, undefined);
  assert.equal(calls.length, 3);
  assert.match(calls[1], /signature=SIGNED/);
  assert.match(calls[1], /tlang=de/);
  assert.doesNotMatch(calls[1], /fmt=/);
  assert.match(calls[2], /fmt=json3/);
  assert.match(calls[2], /signature=SIGNED/);
  assert.match(calls[2], /tlang=de/);
  assert.equal(calls.some(function (url) { return url.includes("signature=OTHER"); }), false);
});

test("srv3 bleibt Text, ein leerer Body danach ist leer", async function () {
  let seen = "";
  const srv = await summary.loadSummary("abcdefghijk", {
    summarize(text) {
      seen = text;
      return {
        summary: {
          about: "Es geht um einen Auflauf aus dem Ofen, wörtlich.",
          points: [
            "Der Auflauf kommt aus dem Ofen.",
            "Das Gemüse kommt in die Form.",
            "Er soll ruhen, bevor er auf den Tisch kommt.",
          ],
          ending: "Zum Schluss ruht er zehn Minuten.",
        },
      };
    },
    player: {
      videoDetails: { videoId: "abcdefghijk" },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [DE_TRACK],
        },
      },
    },
    fetchText() {
      return Promise.resolve(
        '<timedtext format="3"><body><p t="1" d="2">Heute geht es um einen langen Auflauf aus dem Ofen.</p><p t="3" d="2">Zum Schluss ruht er zehn Minuten.</p></body></timedtext>'
      );
    },
  });
  assert.match(seen, /langen Auflauf aus dem Ofen/);
  assert.equal(srv.summary.points.join(" ").includes("langen Auflauf aus dem Ofen"), false);
  assert.equal(srv.summary.points.join(" ").includes("Zum Schluss ruht"), false);
  assert.match(srv.summary.points.join(" "), /Auflauf/);
  assert.equal(srv.summary.about, undefined);
  assert.notEqual(srv.message, summary.EMPTY_CAPTIONS);

  const empty = await summary.loadSummary("abcdefghijk", {
    player: {
      videoDetails: { videoId: "abcdefghijk" },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [DE_TRACK],
        },
      },
    },
    fetchText() {
      return Promise.resolve("  ");
    },
  });
  assert.equal(empty.message, summary.EMPTY_CAPTIONS);
});

test("während das Video läuft, kommt nur der Knopf unter dem Video, die Liste wartet bis zur Pause", async function () {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><ytm-player id="movie_player"><video id="v"></video></ytm-player>' +
      '<ytm-slim-video-metadata-section-renderer><h1>Auflauf</h1></ytm-slim-video-metadata-section-renderer>' +
      '<div id="related"></div></body></html>',
    { url: "https://m.youtube.com/watch?v=abcdefghijk" }
  );
  const win = dom.window;
  const doc = win.document;
  const video = doc.getElementById("v");
  let paused = false;
  Object.defineProperty(video, "paused", { configurable: true, get: function () { return paused; } });
  summary.start(win);
  await delay(400);
  const own = doc.querySelector("ytm-slim-video-metadata-section-renderer [data-langform-kurz]");
  assert.ok(own, "der Knopf unter dem Video ist da");
  doc.getElementById("related").innerHTML =
    '<ytm-video-with-context-renderer id="row"><a href="/watch?v=zyxwvutsrqp">Weiter</a>' +
    '<span class="ytd-thumbnail-overlay-time-status-renderer">12:00</span></ytm-video-with-context-renderer>';
  await delay(400);
  assert.equal(doc.querySelector("#row [data-langform-kurz]"), null);
  assert.equal(doc.querySelectorAll("[data-langform-kurz]").length, 1);
  paused = true;
  video.dispatchEvent(new win.Event("pause"));
  await delay(400);
  assert.ok(doc.querySelector('#row [data-langform-kurz="zyxwvutsrqp"]'));
  assert.equal(video.getAttribute("style"), null);
  win.close();
});

test("wiederverwendete Videokarten bekommen genau eine Kurzfassung für ihr aktuelles Video", async function () {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><ytm-video-with-context-renderer><a href="/watch?v=abcdefghijk">Film</a></ytm-video-with-context-renderer></body>',
    { url: "https://m.youtube.com/" }
  );
  const win = dom.window;
  const card = win.document.querySelector("ytm-video-with-context-renderer");
  summary.start(win);
  await delay(30);
  assert.equal(card.querySelector("[data-langform-kurz]").getAttribute("data-langform-kurz"), "abcdefghijk");
  card.querySelector("a").setAttribute("href", "/watch?v=zyxwvutsrqp");
  await delay(350);
  const buttons = card.querySelectorAll("[data-langform-kurz]");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].getAttribute("data-langform-kurz"), "zyxwvutsrqp");
  win.close();
});

test("der Kurzfassungsknopf bleibt nach einem Austausch der Metadaten während der Wiedergabe erreichbar", async function () {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><ytm-player><video></video></ytm-player><ytm-slim-video-metadata-section-renderer><h1>Film</h1></ytm-slim-video-metadata-section-renderer></body>',
    { url: "https://m.youtube.com/watch?v=abcdefghijk" }
  );
  const win = dom.window;
  const doc = win.document;
  Object.defineProperty(doc.querySelector("video"), "paused", { get: function () { return false; } });
  summary.start(win);
  const first = doc.querySelector("ytm-slim-video-metadata-section-renderer");
  assert.ok(first.querySelector("[data-langform-kurz]"));
  const replacement = doc.createElement("ytm-slim-video-metadata-section-renderer");
  replacement.innerHTML = "<h1>Film neu aufgebaut</h1>";
  first.replaceWith(replacement);
  await delay(30);
  assert.equal(doc.querySelectorAll("[data-langform-kurz]").length, 1);
  assert.ok(replacement.querySelector('[data-langform-kurz="abcdefghijk"]'));

  win.history.replaceState({}, "", "/watch?v=zyxwvutsrqp");
  win.dispatchEvent(new win.Event("yt-navigate-finish"));
  assert.equal(replacement.querySelectorAll("[data-langform-kurz]").length, 1);
  assert.ok(replacement.querySelector('[data-langform-kurz="zyxwvutsrqp"]'));
  win.close();
});

test("eigene Kurzfassungsknöpfe und bloßes Scrollen lösen keinen weiteren Feed-Durchlauf aus", async function () {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><ytm-video-with-context-renderer><a href="/watch?v=abcdefghijk">Film</a></ytm-video-with-context-renderer></body>',
    { url: "https://m.youtube.com/" }
  );
  const win = dom.window;
  const doc = win.document;
  const link = doc.querySelector("a");
  const readAttribute = link.getAttribute.bind(link);
  let hrefReads = 0;
  link.getAttribute = function (name) {
    if (name === "href") hrefReads += 1;
    return readAttribute(name);
  };
  summary.start(win);
  await delay(30);
  assert.ok(doc.querySelector("[data-langform-kurz]"));
  assert.ok(hrefReads > 0);
  hrefReads = 0;
  doc.dispatchEvent(new win.Event("scroll", { bubbles: true }));
  await delay(400);
  assert.equal(hrefReads, 0);
  // A real card change during scrolling is still processed once scrolling ends.
  doc.dispatchEvent(new win.Event("scroll", { bubbles: true }));
  link.setAttribute("href", "/watch?v=zyxwvutsrqp");
  await delay(220);
  assert.ok(hrefReads > 0);
  assert.ok(doc.querySelector('[data-langform-kurz="zyxwvutsrqp"]'));
  win.close();
});

test("mehrere Änderungen einer Karte werden zusammengefasst, auch wenn ihre Metadaten ersetzt werden", async function () {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><ytm-video-with-context-renderer><a href="/watch?v=abcdefghijk">Film</a>' +
      '<div class="metadata"><h3>Alter Titel</h3></div></ytm-video-with-context-renderer></body>',
    { url: "https://m.youtube.com/" }
  );
  const win = dom.window;
  const card = win.document.querySelector("ytm-video-with-context-renderer");
  try {
    summary.start(win);
    await delay(30);
    const query = card.querySelectorAll.bind(card);
    let rowReads = 0;
    card.querySelectorAll = function (selector) {
      if (selector === "a[href]") rowReads += 1;
      return query(selector);
    };
    for (let i = 0; i < 80; i++) card.querySelector("a").setAttribute("href", "/watch?v=zyxwvutsrqp&t=" + i);
    card.querySelector(".metadata").innerHTML = "<h3>Neuer Titel</h3>";
    await delay(350);
    assert.equal(rowReads, 1, "die vollständige Karte wird nur einmal gelesen");
    assert.equal(card.querySelectorAll("[data-langform-kurz]").length, 1);
    assert.ok(card.querySelector('.metadata [data-langform-kurz="zyxwvutsrqp"]'));
  } finally {
    win.close();
  }
});

test("eine Navigation aktualisiert alle Karten, auch während ein Teilbaum-Update wartet", async function () {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><ytm-video-with-context-renderer id="first"><a href="/watch?v=abcdefghijk">Film</a></ytm-video-with-context-renderer>' +
      '<ytm-video-with-context-renderer id="second"><a href="/watch?v=zyxwvutsrqp">Zweiter Film</a></ytm-video-with-context-renderer></body>',
    { url: "https://m.youtube.com/" }
  );
  const win = dom.window;
  const doc = win.document;
  try {
    summary.start(win);
    await delay(30);
    const second = doc.getElementById("second");
    const query = second.querySelectorAll.bind(second);
    let rowReads = 0;
    second.querySelectorAll = function (selector) {
      if (selector === "a[href]") rowReads += 1;
      return query(selector);
    };
    doc.querySelector("#first a").setAttribute("href", "/watch?v=abcdefghijk&t=10");
    await delay(10);
    win.dispatchEvent(new win.Event("yt-navigate-finish"));
    await delay(350);
    assert.equal(rowReads, 1, "Navigation überschreibt die eingeschränkte Teilbaum-Aktualisierung");
    assert.equal(doc.querySelectorAll("[data-langform-kurz]").length, 2);
  } finally {
    win.close();
  }
});

test("ein bereits geplanter Kurzfassungsdurchlauf wartet nach dem Tabwechsel bis zur Rückkehr", async function () {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><ytm-video-with-context-renderer><a href="/watch?v=abcdefghijk">Film</a></ytm-video-with-context-renderer></body>',
    { url: "https://m.youtube.com/" }
  );
  const win = dom.window;
  const card = win.document.querySelector("ytm-video-with-context-renderer");
  try {
    summary.start(win);
    await delay(30);
    card.querySelector("a").setAttribute("href", "/watch?v=zyxwvutsrqp");
    await delay(10);
    assert.ok(win.__langformKurzTimer);
    win.__langformFeedActive = false;
    win.dispatchEvent(new win.Event("langform-feed-visibility"));
    assert.equal(win.__langformKurzTimer, 0);
    assert.equal(win.__langformKurzRoots.length, 0);
    await delay(350);
    assert.ok(card.querySelector('[data-langform-kurz="abcdefghijk"]'));
    win.__langformFeedActive = true;
    win.dispatchEvent(new win.Event("langform-feed-visibility"));
    await delay(350);
    assert.ok(card.querySelector('[data-langform-kurz="zyxwvutsrqp"]'));
    assert.equal(card.querySelectorAll("[data-langform-kurz]").length, 1);
  } finally {
    win.close();
  }
});

test("Kommentarlisten werden weder als Videokarten durchsucht noch beim inneren Scrollen neu geplant", async function (t) {
  const dom = new JSDOM('<!DOCTYPE html><body><ytm-slim-video-metadata-section-renderer></ytm-slim-video-metadata-section-renderer>' +
    '<ytm-comment-section-renderer><div id="comments"></div></ytm-comment-section-renderer>' +
    '<bottom-sheet-container><ytm-video-with-context-renderer id="real-card"><a href="/watch?v=zyxwvutsrqp">Film</a></ytm-video-with-context-renderer></bottom-sheet-container></body>',
    { url: "https://m.youtube.com/watch?v=abcdefghijk" });
  t.after(() => dom.window.close());
  const win = dom.window;
  const doc = win.document;
  const comments = doc.getElementById("comments");
  let hrefReads = 0;
  function addComment() {
    const comment = doc.createElement("ytm-comment-thread-renderer");
    const link = doc.createElement("a");
    link.href = "/watch?v=abcdefghijk&t=50";
    link.textContent = "Mein Kommentar bei 0:50";
    const get = link.getAttribute.bind(link);
    link.getAttribute = function (name) {
      if (name === "href") hrefReads++;
      return get(name);
    };
    comment.appendChild(link);
    comments.appendChild(comment);
    return link;
  }
  addComment();
  summary.start(win);
  await delay(40);
  assert.equal(hrefReads, 0, "der erste Durchlauf überspringt Kommentare vollständig");
  assert.ok(doc.querySelector('#real-card [data-langform-kurz="zyxwvutsrqp"]'), "echte Videolisten in einem Sheet werden weiter ergänzt");
  const late = addComment();
  late.setAttribute("href", "/watch?v=abcdefghijk&t=51");
  comments.dispatchEvent(new win.Event("scroll", { bubbles: true }));
  await delay(350);
  assert.equal(hrefReads, 0, "neue und bearbeitete Kommentare erzeugen keinen Link-Durchlauf");
  assert.equal(win.__langformKurzScrolling, undefined, "inneres Kommentarscrollen hält den Feed nicht an");
  assert.equal(win.__langformKurzTimer, 0);
});
