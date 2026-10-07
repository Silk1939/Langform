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
  assert.equal(doc.getElementById("langform-chapter-title").textContent, "Gespräch");
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
