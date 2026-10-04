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
  assert.match(sheet.textContent, /Kurzfassung/);
  assert.match(sheet.textContent, /Schließen/);
  const css = win.document.getElementById("langform-kurz-style").textContent;
  assert.match(css, /\.langform-kurz-sheet \{[^}]*position:\s*fixed/);
  assert.match(css, /#161410/);
  assert.match(css, /white-space:\s*nowrap/);
  assert.equal(player.contains(sheet), false);
  assert.equal(video.parentElement, player);
  await delay(20);
  assert.match(sheet.textContent, /Für dieses Video gibt es keine Untertitel/);
  assert.deepEqual(seen, []);
  sheet.querySelector("button").click();
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
  row.querySelector("a.thumb").addEventListener("click", function () {
    followed = true;
  });
  button.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(followed, false);
  const sheet = doc.getElementById("langform-kurzfassung");
  assert.equal(sheet.parentElement, doc.body);
  assert.equal(doc.getElementById("list").contains(sheet), false);
  assert.equal(doc.getElementById("list").childElementCount, listCount);
  assert.equal(sheet.getAttribute("data-video"), "videoone111");
  await delay(20);
  assert.equal(/keine Untertitel/.test(sheet.textContent), false);
  assert.match(sheet.textContent, /Worum es geht/);
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
