const test = require("node:test");
const assert = require("node:assert/strict");
const summary = require("../extension/src/summary.js");

test("abgebrochene XML-Untertitel liefern keinen scheinbar vollständigen Anfang", () => {
  const malformed = [
    '<transcript><text>Vollständiger Anfang.</text><text>Entscheidende Einschränkung',
    '<transcript><text>Vollständiger Anfang.</text>',
    '<transcript><text>Vollständiger Anfang.</text><text start="5>Unvollständiges Attribut</text></transcript>',
    '<transcript><text>Vollständiger Anfang.</text></timedtext>',
    '<transcript><text>Vollständiger Anfang.</text></transcript>weiterer Text',
    '<transcript><text>Vollständiger Anfang.</text></transcript><transcript/>',
    '<timedtext><body><p>Vollständiger Anfang.</p><p><s>Späteres Ende</p></body></timedtext>',
    '<timedtext><body><p>Vollständiger Anfang.</p><!-- fehlendes Kommentarende</body></timedtext>',
    '<transcript><text>Vollständiger Anfang.</text><text><![CDATA[fehlendes Ende</text></transcript>',
    '<transcript><text start=0>Ungültiges Attribut.</text></transcript>',
    '<transcript><text start="0" start="1">Doppeltes Attribut.</text></transcript>',
    '<transcript><text>Anfang <text>Verschachtelte Untertitel</text>stilles Ende</text></transcript>',
    '<!DOCTYPE transcript SYSTEM "file:///private.txt"><transcript><text>Ungeprüfte Entität.</text></transcript>',
    '<text>Ein einzelnes Element ist keine vollständige Untertiteldatei.</text>',
  ];
  for (const source of malformed) assert.equal(summary.textFromCaptions(source), "", source);
});

test("vollständige klassische XML-Untertitel behalten Unicode, Entitäten und Schlussaussage", () => {
  const source = '\uFEFF<?xml version="1.0" encoding="utf-8"?>' +
    '<transcript><text start="0" dur="2">Äpfel &amp; Birnen, &#x1F9EC;, &#129516;.</text>' +
    '<text start="2" dur="2">x &lt; 5; &lt;script&gt; bleibt Text.</text>' +
    '<text start="4" dur="2">Das gilt nur unter dieser Bedingung.</text></transcript>';
  assert.equal(summary.textFromCaptions(source),
    'Äpfel & Birnen, 🧬, 🧬. x < 5; <script> bleibt Text. Das gilt nur unter dieser Bedingung.');
});

test("vollständiges srv3-XML unterstützt Kopf, verschachtelte Spannen und zitierte Winkelklammern", () => {
  const source = '<timedtext format="3"><head><pen id="1"/></head><body>' +
    '<p t="0" d="2" label="a > b"><s>Erster </s><s>vollständiger Satz.</s></p>' +
    '<p t="2" d="2">Die spätere Einschränkung bleibt erhalten.</p></body></timedtext>';
  assert.equal(summary.textFromCaptions(source), 'Erster vollständiger Satz. Die spätere Einschränkung bleibt erhalten.');
});

test("Kommentare und CDATA können keine zusätzlichen oder abgeschnittenen Untertitel vortäuschen", () => {
  const source = '<transcript><!-- <text>Falsche Aussage.</text></transcript> -->' +
    '<text>Hal<!-- Kommentar -->lo <![CDATA[<text>literales &lt; Ende</text>]]>.</text>' +
    '<text>Die letzte Aussage.</text></transcript>';
  assert.equal(summary.textFromCaptions(source), 'Hallo <text>literales &lt; Ende</text>. Die letzte Aussage.');
  assert.equal(summary.textFromCaptions('<transcript><text>Text</text><!-- falsch---></transcript>'), "");
  assert.equal(summary.textFromCaptions('<transcript><text>Text</text><??></transcript>'), "");
});

test("JSON3 und dessen Unicode- und Winkelklammern bleiben unverändert", () => {
  const expected = 'Ein 🧬 und <text> sind gesprochener Text. Die abschließende Grenze.';
  const payload = JSON.stringify({ events: [
    { segs: [{ utf8: 'Ein 🧬 und <text> sind gesprochener Text.' }] },
    { segs: [{ utf8: 'Die abschließende Grenze.' }] },
  ] });
  assert.equal(summary.textFromCaptions(payload), expected);
  assert.equal(summary.textFromCaptions(")]}'\n" + payload), expected);
  assert.equal(summary.textFromCaptions(payload.slice(0, -3)), "");
});

function player() {
  return { videoDetails: { videoId: "abcdefghijk" }, captions: { playerCaptionsTracklistRenderer: {
    captionTracks: [{ languageCode: "de", baseUrl: "https://www.youtube.com/api/timedtext?v=abcdefghijk" }],
  } } };
}

test("loadSummary übergibt keine abgeschnittene XML-Quelle an das Modell", async () => {
  let modelCalls = 0;
  const result = await summary.loadSummary("abcdefghijk", {
    player: player(), watchPage: true,
    fetchText: async () => '<transcript><text>Nur der Anfang.</text><text>Es sei denn',
    summarize: async () => { modelCalls++; throw new Error("Teilquelle darf das Modell nicht erreichen"); },
  });
  assert.equal(modelCalls, 0);
  assert.equal(result.summary, undefined);
  assert.equal(result.message, summary.EMPTY_CAPTIONS);
});

test("nach unvollständigem XML darf ein vollständiger JSON3-Abruf die ganze Quelle liefern", async () => {
  const seen = [];
  const result = await summary.loadSummary("abcdefghijk", {
    player: player(), watchPage: true,
    fetchText: async url => url.includes("fmt=json3")
      ? JSON.stringify({ events: [{ segs: [{ utf8: "Der Anfang. Die entscheidende spätere Einschränkung." }] }] })
      : '<transcript><text>Nur der Anfang.</text>',
    summarize: async text => {
      seen.push(text);
      return { summary: { tldr: "Kern.", points: ["Ein Punkt."], takeaway: "Merksatz." } };
    },
  });
  assert.deepEqual(seen, ["Der Anfang. Die entscheidende spätere Einschränkung."]);
  assert.equal(result.summary.tldr, "Kern.");
});
