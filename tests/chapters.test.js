const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const chapters = require("../extension/src/page-captions.js");

const DURATION = 24 * 60 + 20;

function playerWithChapters() {
  return {
    videoDetails: {
      videoId: "abcdefghijk",
      lengthSeconds: String(DURATION),
      shortDescription: "0:00 Intro\n1:23 Gespräch\n12:04 Schluss",
    },
    streamingData: { formats: [{ url: "https://rr.googlevideo.com/videoplayback?id=1" }] },
    playerOverlays: {
      playerOverlayRenderer: {
        decoratedPlayerBarRenderer: {
          decoratedPlayerBarRenderer: {
            playerBar: {
              multiMarkersPlayerBarRenderer: {
                markersMap: [
                  {
                    key: "DESCRIPTION_CHAPTERS",
                    value: {
                      chapters: [
                        { chapterRenderer: { title: { simpleText: "Intro" }, timeRangeStartMillis: 0 } },
                        { chapterRenderer: { title: { simpleText: "Gespräch" }, timeRangeStartMillis: 83000 } },
                        { chapterRenderer: { title: { simpleText: "Schluss" }, timeRangeStartMillis: 724000 } },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  };
}

test("Kapitelliste wird zu Anteilen auf der Seek-Leiste, ein Klick sucht", function () {
  const list = chapters.chaptersFromPlayer(playerWithChapters());
  assert.deepEqual(
    list.map(function (item) { return item.start; }),
    [0, 83, 724]
  );
  const fractions = chapters.barFractions(list, DURATION);
  assert.equal(fractions.length, 3);
  assert.ok(Math.abs(fractions[0].fraction) < 1e-9);
  assert.ok(Math.abs(fractions[1].fraction - 83 / DURATION) < 1e-9);
  assert.ok(Math.abs(fractions[2].fraction - 724 / DURATION) < 1e-9);
  assert.equal(fractions[1].title, "Gespräch");

  const dom = new JSDOM(
    `<!DOCTYPE html><body>
      <ytm-player>
        <div class="progress-bar-line" id="bar"></div>
        <video id="v"></video>
      </ytm-player>
      <div id="movie_player"></div>
    </body>`,
    { url: "https://m.youtube.com/watch?v=abcdefghijk" }
  );
  const doc = dom.window.document;
  const bar = doc.getElementById("bar");
  const video = doc.getElementById("v");
  const player = doc.getElementById("movie_player");
  const sought = [];
  player.seekTo = function (seconds) { sought.push(seconds); };
  assert.equal(chapters.findSeekBar(doc), bar);

  const layer = chapters.drawChapterBar(bar, fractions, function (seconds) {
    sought.push(seconds);
    chapters.seekTo(dom.window, seconds);
  });
  assert.ok(layer);
  const marks = [...bar.querySelectorAll("[data-langform-chapter]")];
  assert.equal(marks.length, 2);
  assert.equal(doc.querySelectorAll("video").length, 1);
  marks[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.deepEqual(sought, [83, 83]);
  assert.equal(doc.getElementById("langform-chapter-title"), null);
  assert.equal(video.style.width, "");
  assert.equal(video.style.height, "");
  assert.equal(video.style.objectFit, "");
  assert.equal(video.style.display, "");
  assert.equal(video.getAttribute("style"), null);
});

test("ohne Kapitel bleibt die Leiste, wie sie ist", function () {
  assert.deepEqual(chapters.barFractions([{ title: "Nur eins", start: 0 }], DURATION), []);
  const fromText = chapters.chaptersFromPlayer({
    videoDetails: { shortDescription: "0:00 Anfang\n0:10 Mitte\n1:00 Ende" },
  });
  assert.deepEqual(
    fromText.map(function (item) { return [item.title, item.start]; }),
    [["Anfang", 0], ["Mitte", 10], ["Ende", 60]]
  );
  const macros = chapters.chaptersFromPlayer({
    engagementPanels: [
      {
        engagementPanelSectionListRenderer: {
          content: {
            macroMarkersListRenderer: {
              contents: [
                { macroMarkersListItemRenderer: { title: { simpleText: "Hook" }, onTap: { watchEndpoint: { startTimeSeconds: 0 } } } },
                { macroMarkersListItemRenderer: { title: { simpleText: "Pointe" }, timeDescription: { simpleText: "1:23" }, onTap: { watchEndpoint: { startTimeSeconds: 83 } } } },
              ],
            },
          },
        },
      },
    ],
  });
  assert.equal(macros[1].start, 83);
  const dom = new JSDOM(`<div class="progress-bar-line" id="bar"></div>`, { url: "https://m.youtube.com/watch?v=abcdefghijk" });
  const bar = dom.window.document.getElementById("bar");
  bar.appendChild(dom.window.document.createElement("span"));
  assert.equal(chapters.drawChapterBar(bar, [], function () { throw new Error("kein Sprung"); }), null);
  assert.equal(bar.querySelector("[data-langform-chapters]"), null);
  assert.equal(bar.querySelector("span").isConnected, true);
});

test("aktuelles Kapitel ist das letzte mit Start <= Spielzeit, eine Zeile sucht", function () {
  const player = playerWithChapters();
  const gespraech = player.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer.decoratedPlayerBarRenderer.playerBar.multiMarkersPlayerBarRenderer.markersMap[0].value.chapters[1].chapterRenderer;
  gespraech.thumbnail = {
    thumbnails: [
      { url: "https://rr.googlevideo.com/videoplayback?id=thumb", width: 320, height: 180 },
      { url: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", width: 168, height: 94 },
    ],
  };
  const list = chapters.chaptersFromPlayer(player);
  assert.equal(chapters.chapterAtTime(list, 82).title, "Intro");
  assert.equal(chapters.chapterAtTime(list, 83).title, "Gespräch");
  assert.equal(chapters.chapterAtTime(list, 100).title, "Gespräch");
  assert.equal(chapters.chapterAtTime(list, 723).title, "Gespräch");
  assert.equal(chapters.chapterAtTime(list, 724).title, "Schluss");
  assert.equal(list[1].thumbnail, "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg");

  const dom = new JSDOM(
    `<!DOCTYPE html><body>
      <ytm-player id="player">
        <div class="ytp-time-display" id="time">2:40 / 9:10</div>
        <div class="progress-bar-line" id="bar"></div>
        <video id="v"></video>
      </ytm-player>
      <div id="movie_player"></div>
    </body>`,
    { url: "https://m.youtube.com/watch?v=abcdefghijk" }
  );
  const doc = dom.window.document;
  const video = doc.getElementById("v");
  const sought = [];
  doc.getElementById("movie_player").seekTo = function (seconds) { sought.push(seconds); };
  const ui = chapters.renderChapterUi(doc, list, function (seconds) {
    chapters.seekTo(dom.window, seconds);
  });
  assert.equal(ui.drawn, true);
  assert.equal(ui.native, false);
  chapters.syncChapterUi(doc, list, 100);
  const chip = doc.getElementById("langform-chapter-chip");
  assert.equal(chip.querySelector("[data-langform-chapter-label]").textContent, "Gespräch");
  assert.match(chip.textContent, />/);
  assert.equal(chip.previousElementSibling, doc.getElementById("time"));
  ui.open();
  const sheet = doc.getElementById("langform-chapter-sheet");
  assert.equal(sheet.style.display, "flex");
  assert.equal(sheet.querySelector("h2").textContent, "Kapitel");
  const rows = [...sheet.querySelectorAll("[data-langform-chapter-row]")];
  assert.equal(rows.length, 3);
  assert.equal(rows[1].getAttribute("aria-current"), "true");
  assert.equal(rows[1].querySelector("img").getAttribute("src"), list[1].thumbnail);
  assert.equal(rows[0].querySelector("img"), null);
  rows[2].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.deepEqual(sought, [724]);
  assert.equal(sheet.style.display, "none");
  assert.equal(chip.querySelector("[data-langform-chapter-label]").textContent, "Schluss");
  assert.equal(doc.querySelectorAll("video").length, 1);
  assert.equal(video.style.width, "");
  assert.equal(video.style.height, "");
  assert.equal(video.style.objectFit, "");
  assert.equal(video.style.display, "");
});

test("YouTubes eigenes Kapitelblatt bleibt, statt ein zweites zu zeichnen", function () {
  const list = chapters.chaptersFromPlayer(playerWithChapters());
  const dom = new JSDOM(
    `<!DOCTYPE html><body>
      <div class="ytp-time-display">2:40 / 9:10</div>
      <div class="ytwPlayerTimeDisplayPlayerBarActionContainer">
        <button id="native-chip" class="shorts-ausblenden-hidden" aria-label="View Chapters">Debunking movie tropes</button>
      </div>
      <ytm-macro-markers-list-renderer id="native-sheet"></ytm-macro-markers-list-renderer>
    </body>`,
    { url: "https://m.youtube.com/watch?v=abcdefghijk" }
  );
  const doc = dom.window.document;
  const ui = chapters.renderChapterUi(doc, list, function () { throw new Error("kein zweites Blatt"); });
  assert.equal(ui.native, true);
  assert.equal(ui.drawn, false);
  assert.equal(doc.getElementById("langform-chapter-chip"), null);
  assert.equal(doc.getElementById("langform-chapter-sheet"), null);
  assert.equal(doc.getElementById("native-chip").classList.contains("shorts-ausblenden-hidden"), false);
  assert.equal(doc.getElementById("native-sheet").isConnected, true);
});
