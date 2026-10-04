const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { ns, delay } = require("./helpers");
const summary = ns.summary;

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

function sentences(count) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    lines.push("Satz Nummer " + (i + 1) + " beschreibt einen eigenen Schritt im Rezept.");
  }
  return lines.join(" ");
}

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
  assert.match(url, /fmt=json3/);
  assert.match(url, /tlang=de/);
  assert.equal(
    summary.captionUrl({ baseUrl: "https://rr1---sn.googlevideo.com/videoplayback?id=1" }),
    null
  );
  assert.equal(url.includes("googlevideo"), false);
});

test("Kurzfassung ist ein kurzer Lesetext, kein Transkript", function () {
  const text = [
    "Hallo zusammen.",
    "Musik",
    sentences(12),
    "Vergesst nicht zu abonnieren.",
  ].join(" ");
  const result = summary.summarize(text);
  const parts = summary.blocks(result);
  assert.deepEqual(
    parts.map(function (block) {
      return block.heading;
    }),
    ["Worum es geht", "Punkte", "Schluss"]
  );
  const lines = parts.reduce(function (sum, block) {
    return sum + block.lines.length;
  }, 0);
  assert.ok(lines <= 8);
  assert.ok(lines < text.split(/(?<=[.!?])\s+/).length);
  const joined = parts
    .flatMap(function (block) {
      return block.lines;
    })
    .join(" ");
  assert.equal(/abonni/i.test(joined), false);
  assert.equal(summary.summarize(""), null);
  assert.equal(summary.textFromJson3({ events: [] }), "");
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
  assert.ok(loaded.summary.about.length > 0);
  assert.ok(calls.length >= 2);
  calls.forEach(function (url) {
    assert.equal(String(url).includes("googlevideo"), false);
    assert.match(String(url), /youtube\.com/);
  });
  assert.match(calls[1], /tlang=de/);
  assert.match(calls[0], /m\.youtube\.com\/watch\?v=abcdefghijk/);
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
  const panel = win.document.getElementById("langform-kurzfassung");
  const player = win.document.querySelector("ytd-player");
  const video = win.document.querySelector("video");
  assert.ok(panel);
  assert.equal(panel.getAttribute("lang"), "de");
  assert.match(panel.textContent, /Kurzfassung/);
  assert.equal(panel.className, "langform-kurz");
  assert.match(win.document.getElementById("langform-kurz-style").textContent, /position:\s*relative/);
  assert.doesNotMatch(win.document.getElementById("langform-kurz-style").textContent, /position:\s*fixed/);
  assert.ok(player.compareDocumentPosition(panel) & win.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(video.compareDocumentPosition(panel) & win.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(player.contains(panel), false);
  await delay(20);
  assert.match(panel.textContent, /Für dieses Video gibt es keine Untertitel/);
  assert.deepEqual(seen, []);
  panel.querySelector("button").click();
  assert.equal(win.document.getElementById("langform-kurzfassung"), null);
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
  const panel = win.document.getElementById("langform-kurzfassung");
  const card = win.document.getElementById("long");
  assert.equal(card.nextSibling, panel);
  assert.equal(card.contains(panel), false);
  await delay(20);
  assert.match(panel.textContent, /keine Untertitel/);
  assert.ok(fetched.length > 0);
  fetched.forEach(function (call) {
    assert.equal(call.credentials, "include");
    assert.equal(call.url.includes("googlevideo"), false);
  });
});
