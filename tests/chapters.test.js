const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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

test("Kapitelliste segmentiert die Seek-Leiste ohne native Scrub-Eingaben zu übernehmen", function () {
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
  assert.deepEqual(sought, [], "visuelle Grenzen übernehmen keinen nativen Seek");
  assert.equal(layer.getAttribute("aria-hidden"), "true");
  assert.ok(marks.every(mark => mark.style.pointerEvents === "none" && !mark.hasAttribute("role")));
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
  assert.match(chip.textContent, /›/);
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

function setRect(el, box) {
  const rect = {
    x: box.left,
    y: box.top,
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    right: box.left + box.width,
    bottom: box.top + box.height,
  };
  el.getBoundingClientRect = function () { return rect; };
}

test("die sichtbare mobile Leiste gewinnt gegen die versteckte Desktop-Leiste", function () {
  const dom = new JSDOM(
    `<!DOCTYPE html><body>
      <div class="html5-video-player">
        <div class="ytp-progress-bar progress-bar-line" id="desktop" style="display:none"></div>
      </div>
      <div id="time">17:26 / 24:20</div>
      <div id="mobile"></div>
      <video id="v"></video>
    </body>`,
    { url: "https://m.youtube.com/watch?v=abcdefghijk" }
  );
  const doc = dom.window.document;
  const time = doc.getElementById("time");
  const mobile = doc.getElementById("mobile");
  const desktop = doc.getElementById("desktop");
  const video = doc.getElementById("v");
  setRect(time, { left: 12, top: 180, width: 108, height: 22 });
  setRect(mobile, { left: 0, top: 210, width: 390, height: 3 });
  setRect(desktop, { left: 0, top: 210, width: 390, height: 3 });
  assert.equal(chapters.findSeekBar(doc), mobile);

  const list = chapters.chaptersFromPlayer(playerWithChapters());
  const ui = chapters.renderChapterUi(doc, list, function () {});
  assert.equal(ui.drawn, true);
  const chip = doc.getElementById("langform-chapter-chip");
  assert.equal(chip.previousElementSibling, time);
  assert.equal(chip.style.minHeight, "44px");
  assert.equal(chip.style.position, "fixed");
  assert.equal(chip.style.left, "128px");
  ui.open();
  assert.equal(doc.getElementById("langform-chapter-sheet").style.display, "flex");
  assert.equal(doc.getElementById("langform-chapter-sheet").querySelector("h2").textContent, "Kapitel");
  const layer = chapters.drawChapterBar(mobile, chapters.barFractions(list, DURATION), function () {});
  assert.ok(layer);
  assert.equal(mobile.querySelector("[data-langform-chapters]"), layer);
  assert.equal(desktop.querySelector("[data-langform-chapters]"), null);
  assert.equal(video.style.width, "");
  assert.equal(video.style.height, "");
  assert.equal(video.style.objectFit, "");
  assert.equal(video.style.display, "");
  assert.equal(video.getAttribute("style"), null);
});

test("Kapitellabel wechselt nur mit dem Kapitelindex", function () {
  const list = chapters.chaptersFromPlayer(playerWithChapters());
  const dom = new JSDOM(
    `<!DOCTYPE html><body>
      <div class="ytp-time-display" id="time">1:40 / 24:20</div>
      <video id="v"></video>
    </body>`,
    { url: "https://m.youtube.com/watch?v=abcdefghijk" }
  );
  const doc = dom.window.document;
  chapters.renderChapterUi(doc, list, function () {});
  chapters.syncChapterUi(doc, list, 100);
  const label = doc.querySelector("[data-langform-chapter-label]");
  assert.equal(label.textContent, "Gespräch");
  label.textContent = "verändert";
  chapters.syncChapterUi(doc, list, 110);
  assert.equal(label.textContent, "verändert");
  chapters.syncChapterUi(doc, list, 800);
  assert.equal(label.textContent, "Schluss");
});

function placeBox(el, left, top, width, height) {
  el.getBoundingClientRect = function () {
    return { left: left, top: top, width: width, height: height, right: left + width, bottom: top + height };
  };
}

function controlRowDom() {
  const dom = new JSDOM(
    `<!DOCTYPE html><body>
      <ytm-player id="player">
        <div class="player-controls-top" id="row">
          <div class="slot" id="cast-slot"><button id="cast" class="ytm-cast-button" aria-label="Auf Fernseher wiedergeben"></button></div>
          <div class="slot" id="cc-slot"><button id="cc" aria-label="Untertitel"></button></div>
          <div class="slot" id="gear-slot"><button id="gear" aria-label="Einstellungen"></button></div>
        </div>
        <video id="v"></video>
      </ytm-player>
    </body>`,
    { url: "https://m.youtube.com/watch?v=abcdefghijk" }
  );
  const doc = dom.window.document;
  placeBox(doc.getElementById("cast"), 246, 8, 48, 48);
  placeBox(doc.getElementById("cc"), 294, 8, 48, 48);
  placeBox(doc.getElementById("gear"), 342, 8, 48, 48);
  return dom;
}

test("AirPlay liegt auf YouTubes Steuerzeile, ohne einen Knoten in die Zeile zu setzen", function () {
  const dom = controlRowDom();
  const doc = dom.window.document;
  const video = doc.getElementById("v");
  let picked = 0;
  video.webkitShowPlaybackTargetPicker = function () { picked += 1; };
  const rowBefore = doc.getElementById("row").outerHTML;
  const button = chapters.ensureAirPlay(dom.window);
  assert.ok(button);
  assert.equal(button.getAttribute("aria-label"), "AirPlay");
  assert.equal(button.parentNode, doc.body);
  assert.equal(doc.getElementById("row").outerHTML, rowBefore);
  assert.equal(doc.getElementById("player").contains(button), false);
  // Same line as CC, left of the group that starts with Cast.
  assert.equal(button.style.position, "fixed");
  assert.equal(button.style.top, "8px");
  assert.equal(button.style.left, 246 - 48 - 4 + "px");
  assert.equal(chapters.ensureAirPlay(dom.window), button);
  assert.equal(doc.querySelectorAll("#langform-airplay").length, 1);
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(picked, 1);
  assert.equal(video.getAttribute("style"), null);
  assert.equal(doc.getElementById("row").outerHTML, rowBefore);

  dom.reconfigure({ url: "https://m.youtube.com/" });
  assert.equal(chapters.ensureAirPlay(dom.window), null);
  assert.equal(doc.getElementById("langform-airplay"), null);
});

test("AirPlay nimmt den Picker des Players und verschwindet mit YouTubes Leiste", function () {
  const dom = controlRowDom();
  const doc = dom.window.document;
  const player = doc.getElementById("player");
  player.id = "movie_player";
  let fromPlayer = 0;
  let fromVideo = 0;
  player.showAirplayPicker = function () { fromPlayer += 1; };
  doc.getElementById("v").webkitShowPlaybackTargetPicker = function () { fromVideo += 1; };
  const button = chapters.ensureAirPlay(dom.window);
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(fromPlayer, 1);
  assert.equal(fromVideo, 0);

  doc.getElementById("row").style.opacity = "0";
  assert.equal(chapters.ensureAirPlay(dom.window), button);
  assert.equal(button.style.visibility, "hidden");
  assert.equal(button.style.pointerEvents, "none");
  doc.getElementById("row").style.opacity = "1";
  chapters.ensureAirPlay(dom.window);
  assert.equal(button.style.visibility, "");
  assert.equal(doc.getElementById("cast").isConnected, true);
});

test("YouTubes Cast-Knopf im Player wird weder versteckt noch entfernt", function () {
  const hide = require("./helpers").ns.hide;
  const dom = controlRowDom();
  const doc = dom.window.document;
  doc.body.insertAdjacentHTML(
    "beforeend",
    '<ytm-rich-item-renderer id="short"><a href="/shorts/abc">Kurz</a></ytm-rich-item-renderer>'
  );
  hide.scan(doc, "https://m.youtube.com/watch?v=abcdefghijk", { remove: true });
  assert.equal(doc.getElementById("short"), null);
  const cast = doc.getElementById("cast");
  assert.equal(cast.isConnected, true);
  assert.equal(cast.hasAttribute(hide.MARK), false);
  assert.equal(cast.closest(".shorts-ausblenden-hidden"), null);
  assert.doesNotMatch(hide.cssText(), /cast|mdx|Fernseher|Übertragen/i);
});

test("ein Shorts-Eintrag, der den Player enthält, bleibt im DOM", function () {
  const hide = require("./helpers").ns.hide;
  const dom = new JSDOM(
    `<!DOCTYPE html><body><ytm-rich-item-renderer id="item"><a href="/shorts/abc">Kurz</a><ytm-player><video></video></ytm-player></ytm-rich-item-renderer></body>`,
    { url: "https://m.youtube.com/watch?v=abcdefghijk" }
  );
  const doc = dom.window.document;
  hide.scan(doc, "https://m.youtube.com/watch?v=abcdefghijk", { remove: true });
  assert.ok(doc.getElementById("item"));
  assert.equal(doc.querySelectorAll("video").length, 1);
});

test("ohne Steuerzeile liegt kein loser AirPlay-Knopf auf der Seite", function () {
  const dom = new JSDOM(
    `<!DOCTYPE html><body><ytm-player><video id="v"></video></ytm-player></body>`,
    { url: "https://m.youtube.com/watch?v=abcdefghijk" }
  );
  const doc = dom.window.document;
  doc.getElementById("v").webkitShowPlaybackTargetPicker = function () {};
  assert.equal(chapters.ensureAirPlay(dom.window), null);
  assert.equal(doc.getElementById("langform-airplay"), null);
});

test("die Startseite startet keine Kapitelarbeit", async function () {
  const dom = new JSDOM(
    `<!DOCTYPE html><body><ytm-rich-item-renderer><a href="/watch?v=abcdefghijk">Video</a></ytm-rich-item-renderer></body>`,
    { url: "https://m.youtube.com/" }
  );
  const win = dom.window;
  let intervals = 0;
  const nativeInterval = win.setInterval.bind(win);
  win.setInterval = function () {
    intervals += 1;
    return nativeInterval.apply(null, arguments);
  };
  let walked = 0;
  const nativeQuery = win.document.querySelector.bind(win.document);
  win.document.querySelector = function () {
    walked += 1;
    return nativeQuery.apply(null, arguments);
  };
  chapters.armChapters(win);
  win.document.dispatchEvent(new win.Event("scroll"));
  win.document.dispatchEvent(new win.Event("pointerdown"));
  win.dispatchEvent(new win.Event("yt-navigate-finish"));
  await new Promise(function (resolve) { setTimeout(resolve, 300); });
  assert.equal(intervals, 0);
  assert.equal(walked, 0);
  assert.equal(win.__langformChapterRetry || 0, 0);
  win.close();
});

function screenshotPlayerDom(extra) {
  const dom = new JSDOM(
    `<!DOCTYPE html><body>
      <ytm-player id="player">
        <div class="player-controls-top">
          <button id="cc" aria-label="Untertitel"></button>
          <button id="gear" aria-label="Einstellungen"></button>
        </div>
        <div class="player-controls-bottom" id="row">
          <div class="ytp-time-display" id="time">0:02 / 17:02</div>
          ${extra || ""}
          <button id="fullscreen" aria-label="Vollbild"></button>
        </div>
        <div class="progress-bar-line" id="bar"></div>
        <video id="v"></video>
      </ytm-player>
    </body>`,
    { url: "https://m.youtube.com/watch?v=abcdefghijk" }
  );
  const doc = dom.window.document;
  Object.defineProperty(doc.documentElement, "clientWidth", { value: 471 });
  placeBox(doc.getElementById("player"), 0, 128, 471, 265);
  placeBox(doc.getElementById("cc"), 340, 140, 36, 36);
  placeBox(doc.getElementById("gear"), 396, 140, 36, 36);
  placeBox(doc.getElementById("time"), 36, 320, 104, 24);
  placeBox(doc.getElementById("fullscreen"), 396, 314, 36, 36);
  placeBox(doc.getElementById("bar"), 0, 364, 471, 4);
  return dom;
}

test("ein Kapitelchip, einzeilig, endet vor dem Vollbild-Knopf, nichts oben rechts", function () {
  const dom = screenshotPlayerDom();
  const doc = dom.window.document;
  const list = chapters.chaptersFromPlayer(playerWithChapters());
  list[0].title = "AI ads that feel real and a much longer title that would never fit";
  list[1].thumbnail = "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg";
  const ui = chapters.renderChapterUi(doc, list, function () {});
  assert.equal(ui.drawn, true);
  const chips = doc.querySelectorAll("#langform-chapter-chip");
  assert.equal(chips.length, 1);
  const chip = chips[0];
  assert.equal(chip.previousElementSibling, doc.getElementById("time"));
  assert.equal(chip.getAttribute("data-langform-chip-placed"), "1");
  assert.equal(chip.style.position, "fixed");
  assert.equal(chip.style.left, "148px");
  assert.equal(chip.style.top, "332px");
  // 396 (Vollbild) - 8 Abstand - 148 links = 240
  assert.equal(chip.style.maxWidth, "240px");
  assert.equal(chip.style.whiteSpace, "nowrap");
  assert.equal(chip.style.overflow, "hidden");
  const label = chip.querySelector("[data-langform-chapter-label]");
  assert.equal(label.style.whiteSpace, "nowrap");
  assert.equal(label.style.textOverflow, "ellipsis");
  assert.equal(chip.querySelectorAll("img").length, 0);
  assert.equal(chip.textContent.split(list[0].title).length - 1, 1);
  // Nichts von uns sitzt in der oberen Hälfte des Players (CC, Zahnrad, Cast, AirPlay).
  const sheet = doc.getElementById("langform-chapter-sheet");
  assert.equal(sheet.style.display, "none");
  assert.equal(sheet.style.bottom, "0px");
  ui.open();
  const thumb = sheet.querySelector("img");
  assert.equal(thumb.style.width, "80px");
  assert.equal(thumb.style.height, "45px");
  assert.ok(thumb.closest("[data-langform-chapter-row]"));
  assert.ok(Number.parseInt(sheet.style.top, 10) >= 393);
  const video = doc.getElementById("v");
  assert.equal(video.getAttribute("style"), null);
  dom.window.close();
});

test("liegt die Zeitzeile oben im Player, bleibt der Chip unsichtbar", function () {
  const dom = screenshotPlayerDom();
  const doc = dom.window.document;
  placeBox(doc.getElementById("time"), 36, 150, 104, 24);
  placeBox(doc.getElementById("fullscreen"), 396, 144, 36, 36);
  chapters.renderChapterUi(doc, chapters.chaptersFromPlayer(playerWithChapters()), function () {});
  const chip = doc.getElementById("langform-chapter-chip");
  assert.equal(chip.getAttribute("data-langform-chip-placed"), null);
  assert.equal(chip.style.visibility, "hidden");
  assert.equal(chip.style.pointerEvents, "none");
  assert.notEqual(chip.style.position, "fixed");
  dom.window.close();
});

test("zeigt YouTube schon seinen Kapitelchip, kommt kein zweiter dazu, auch ohne YouTubes Blatt", function () {
  const dom = screenshotPlayerDom(
    `<div class="ytwPlayerTimeDisplayPlayerBarActionContainer" id="native-wrap"><button id="native-chip">AI ads that feel real</button></div>`
  );
  const doc = dom.window.document;
  placeBox(doc.getElementById("native-chip"), 148, 318, 200, 28);
  const ui = chapters.renderChapterUi(doc, chapters.chaptersFromPlayer(playerWithChapters()), function () {});
  assert.equal(ui.native, true);
  assert.equal(doc.getElementById("langform-chapter-chip"), null);
  assert.equal(doc.getElementById("langform-chapter-sheet"), null);
  dom.window.close();
});

test("taucht YouTubes Chip später auf, verschwindet unserer", function () {
  const dom = screenshotPlayerDom(
    `<div class="ytwPlayerTimeDisplayPlayerBarActionContainer" id="native-wrap" style="display:none"><button id="native-chip">AI ads that feel real</button></div>`
  );
  const win = dom.window;
  const doc = win.document;
  placeBox(doc.getElementById("native-chip"), 148, 318, 200, 28);
  win.ytInitialPlayerResponse = playerWithChapters();
  chapters.refreshChapters(win);
  assert.ok(doc.getElementById("langform-chapter-chip"));
  doc.getElementById("native-wrap").style.display = "";
  chapters.refreshChapters(win);
  assert.equal(doc.getElementById("langform-chapter-chip"), null);
  assert.equal(doc.documentElement.getAttribute("data-langform-chapter-ui"), "native");
  assert.equal(doc.documentElement.__langformChapterVideoID, "abcdefghijk");
  assert.deepEqual(doc.documentElement.__langformChapterList.map(item => item.start), [0, 83, 724]);
  doc.documentElement.__langformChapterList = [];
  doc.documentElement.__langformChapterVideoID = "";
  chapters.refreshChapters(win);
  assert.equal(doc.documentElement.__langformChapterVideoID, "abcdefghijk", "auch native Chrome hält die Vollbild-Kapitel aktuell");
  assert.deepEqual(doc.documentElement.__langformChapterList.map(item => item.start), [0, 83, 724]);
  doc.getElementById("native-wrap").style.display = "none";
  chapters.refreshChapters(win);
  assert.equal(doc.getElementById("langform-chapter-chip"), null);
  assert.ok(doc.getElementById("bar").querySelector("[data-langform-chapters]"));
  assert.equal(doc.getElementById("v").getAttribute("style"), null);
  win.close();
});

test("beim Scrollen und Abspielen ändert sich das DOM nur, wenn das Kapitel wechselt", async function () {
  const dom = screenshotPlayerDom();
  const win = dom.window;
  const doc = win.document;
  const video = doc.getElementById("v");
  let time = 5;
  Object.defineProperty(video, "paused", { configurable: true, get: function () { return false; } });
  Object.defineProperty(video, "currentTime", { configurable: true, get: function () { return time; }, set: function (v) { time = v; } });
  const player = playerWithChapters();
  let reads = 0;
  Object.defineProperty(win, "ytInitialPlayerResponse", { configurable: true, get: function () { reads += 1; return player; } });
  const intervals = [];
  const realInterval = win.setInterval.bind(win);
  win.setInterval = function (fn, ms) {
    if (ms === 500) {
      intervals.push(fn);
      return 9999;
    }
    return realInterval(fn, ms);
  };
  chapters.armChapters(win);
  const chip = doc.getElementById("langform-chapter-chip");
  assert.ok(chip);
  assert.equal(chip.getAttribute("data-langform-chip-placed"), "1");
  assert.equal(chip.querySelector("[data-langform-chapter-label]").textContent, "Intro");

  const changes = [];
  const watcher = new win.MutationObserver(function (records) {
    records.forEach(function (r) { changes.push(r); });
  });
  watcher.observe(doc, { subtree: true, childList: true, attributes: true, characterData: true });

  // The retry tick does not walk the page while the video plays.
  const before = reads;
  intervals.forEach(function (fn) { fn(); fn(); fn(); });
  await new Promise(function (resolve) { setTimeout(resolve, 300); });
  assert.equal(reads, before);

  for (let i = 0; i < 5; i++) {
    doc.dispatchEvent(new win.Event("scroll"));
    time += 1;
    video.dispatchEvent(new win.Event("timeupdate"));
    await new Promise(function (resolve) { setTimeout(resolve, 40); });
  }
  await new Promise(function (resolve) { setTimeout(resolve, 500); });
  for (let i = 0; i < 5; i++) {
    time += 1;
    video.dispatchEvent(new win.Event("timeupdate"));
  }
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  assert.equal(changes.length, 0, "kein Umschreiben im selben Kapitel");
  assert.equal(reads, before, "nach dem Scrollen kein neuer Durchlauf, die Kapitel stehen");

  time = 100;
  video.dispatchEvent(new win.Event("timeupdate"));
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  assert.ok(changes.length > 0);
  assert.equal(chip.querySelector("[data-langform-chapter-label]").textContent, "Gespräch");
  changes.forEach(function (r) {
    assert.ok(chip.contains(r.target) || r.target.closest("#langform-chapter-sheet"), "nur unsere Kapitelanzeige ändert sich");
  });
  assert.equal(video.getAttribute("style"), null);
  watcher.disconnect();
  win.close();
});

test("das erste Kapitel sucht zurück zu 0:00, ohne die Wiedergabe zu pausieren", function () {
  const dom = new JSDOM('<div id="movie_player"><video></video></div>', { url: "https://m.youtube.com/watch?v=abcdefghijk" });
  const win = dom.window;
  const video = win.document.querySelector("video");
  video.currentTime = 90;
  const sought = [];
  win.document.getElementById("movie_player").seekTo = function (seconds) { sought.push(seconds); };
  video.pause = function () { assert.fail("Kapitelwahl pausiert den Film nicht"); };
  assert.equal(chapters.seekTo(win, 0), true);
  assert.equal(chapters.seekTo(win, -1), false);
  assert.deepEqual(sought, [0]);
  video.currentTime = 0;
  assert.equal(chapters.seekTo(win, 0), false, "kein unnötiger Sprung beim frischen Start");
  win.close();
});

test("ein Videowechsel zeigt keine Kapitel aus der vorherigen Player-Antwort", function () {
  const dom = screenshotPlayerDom();
  const win = dom.window;
  const doc = win.document;
  win.ytInitialPlayerResponse = playerWithChapters();
  chapters.refreshChapters(win);
  assert.ok(doc.getElementById("langform-chapter-chip"));
  dom.reconfigure({ url: "https://m.youtube.com/watch?v=zyxwvutsrqp" });
  chapters.refreshChapters(win);
  assert.equal(doc.getElementById("langform-chapter-chip"), null);
  assert.equal(doc.querySelector("[data-langform-chapters]"), null);
  assert.equal(doc.documentElement.__langformChapterList.length, 0);
  assert.equal(doc.documentElement.__langformChapterVideoID, "");
  const next = playerWithChapters();
  next.videoDetails.videoId = "zyxwvutsrqp";
  win.ytInitialPlayerResponse = next;
  chapters.refreshChapters(win);
  assert.ok(doc.getElementById("langform-chapter-chip"));
  assert.equal(doc.documentElement.__langformChapterVideoID, "zyxwvutsrqp");
  win.close();
});

function mobileChapterPage(t) {
  const dom = screenshotPlayerDom();
  const win = dom.window, doc = win.document;
  t.after(() => win.close());
  const timers = new Map(), intervals = new Map();
  let serial = 0;
  win.setTimeout = (callback, delay) => { timers.set(++serial, { callback, delay }); return serial; };
  win.clearTimeout = id => timers.delete(id);
  win.setInterval = (callback, delay) => { intervals.set(++serial, { callback, delay }); return serial; };
  win.clearInterval = id => intervals.delete(id);
  const video = doc.getElementById("v"), sought = [];
  Object.defineProperty(video, "paused", { get: () => false });
  video.currentTime = 5;
  video.play = video.pause = () => assert.fail("Kapitelwechsel darf die Wiedergabe nicht steuern");
  doc.getElementById("player").seekTo = seconds => sought.push(seconds);
  win.ytInitialPlayerResponse = playerWithChapters();
  chapters.armChapters(win);
  function response(id, prefix) {
    const next = playerWithChapters();
    next.videoDetails.videoId = id;
    const rows = next.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer.decoratedPlayerBarRenderer
      .playerBar.multiMarkersPlayerBarRenderer.markersMap[0].value.chapters;
    rows.forEach((row, index) => {
      row.chapterRenderer.title.simpleText = prefix + " " + index;
      row.chapterRenderer.timeRangeStartMillis = [0, 123000, 764000][index];
    });
    return next;
  }
  function start(id) {
    win.dispatchEvent(new win.CustomEvent("state-navigatestart", { detail: { href: "/watch?v=" + id } }));
  }
  function end(id) {
    win.dispatchEvent(new win.CustomEvent("state-navigateend", { detail: { href: "/watch?v=" + id } }));
  }
  function flush() {
    // Execute one turn; a callback may schedule a later independent turn.
    for (const [id, item] of [...timers]) { timers.delete(id); item.callback(); }
  }
  const chip = () => doc.getElementById("langform-chapter-chip");
  return { dom, win, doc, video, sought, timers, intervals, response, start, end, flush, chip };
}

test("mobiler Videostart entfernt alte Kapitel, offene Sheets und Seek-Aktionen schon vor dem URL-Wechsel", function (t) {
  const page = mobileChapterPage(t);
  const { win, doc, video } = page;
  const oldChip = page.chip(), sheet = doc.getElementById("langform-chapter-sheet");
  const animations = fakeSheetAnimations(sheet);
  doc.getElementById("player").dispatchEvent(new win.Event("pointerdown", { bubbles: true }));
  oldChip.click();
  const row = sheet.querySelector('[data-start="83"]');
  const gap = doc.querySelector('[data-langform-chapter][data-start="83"]');
  const bar = doc.getElementById("bar"), preview = bar.__langformOnPreview;
  const staleFinish = animations[0].onfinish;
  win.dispatchEvent(new win.Event("resize"));
  win.dispatchEvent(new win.Event("yt-navigate-finish"));
  doc.dispatchEvent(new win.Event("scroll"));
  const callbacks = [...page.timers.values(), ...page.intervals.values()].map(item => item.callback);
  const mediaMarkup = video.outerHTML, mediaTime = video.currentTime;
  page.start("lmnopqrstuv");
  assert.equal(page.chip(), null, "Start meldet die neue Ziel-ID, bevor location.href wechselt");
  assert.equal(doc.getElementById("langform-chapter-sheet"), null);
  assert.equal(doc.querySelector("[data-langform-chapters]"), null);
  assert.equal(doc.documentElement.__langformChapterList.length, 0);
  assert.equal(animations[0].cancelled, true);
  assert.equal(page.timers.size, 0, "alte Scroll-, Refresh- und Placement-Timer werden abgeräumt");
  assert.equal(page.intervals.size, 0, "alter Bootstrap-/Controls-Follow wird beendet");
  assert.deepEqual(bar.__langformFractions, []);
  assert.equal(bar.__langformOnPreview, null);
  for (const callback of callbacks) callback();
  for (const name of ["loadedmetadata", "playing"]) video.dispatchEvent(new win.Event(name));
  page.flush();
  assert.equal(page.chip(), null, "alte Medien dürfen A nicht während der Navigation neu aufbauen");
  assert.equal(page.intervals.size, 0, "alte playing-Events starten keine neuen Follow-Timer");
  row.click(); gap.click(); oldChip.click(); staleFinish(); preview(83);
  assert.deepEqual(page.sought, [], "auch gehaltene alte Event-/Preview-Closures bleiben wirkungslos");
  assert.equal(doc.documentElement.__langformChapterList.length, 0);
  assert.equal(video.outerHTML, mediaMarkup);
  assert.equal(video.currentTime, mediaTime);
  assert.equal(win.location.search, "?v=abcdefghijk", "Kapitelinvalidierung navigiert selbst nicht");
  win.history.replaceState({}, "", "/watch?v=lmnopqrstuv");
  win.ytInitialPlayerResponse = page.response("lmnopqrstuv", "B");
  page.end("lmnopqrstuv"); page.flush();
  assert.equal(page.chip().querySelector("[data-langform-chapter-label]").textContent, "B 0");
  assert.equal(page.intervals.size, 0, "der mobile Wechsel arbeitet über Ereignisse, ohne neues Polling");
  page.chip().click();
  doc.querySelector('#langform-chapter-sheet [data-start="123"]').click();
  assert.deepEqual(page.sought, [123]);
});

test("mobiles Ende wartet auf passende verspätete Metadaten und verwirft alte Ziele bei schnellem Wechsel", function (t) {
  const page = mobileChapterPage(t);
  page.win.dispatchEvent(new page.win.Event("resize"));
  const stalePlacement = [...page.timers.values()][0].callback;
  page.start("lmnopqrstuv");
  page.win.history.replaceState({}, "", "/watch?v=lmnopqrstuv");
  page.end("lmnopqrstuv");
  const staleRefresh = [...page.timers.values()][0].callback;
  page.start("zyxwvutsrqp");
  page.win.history.replaceState({}, "", "/watch?v=zyxwvutsrqp");
  page.win.ytInitialPlayerResponse = page.response("lmnopqrstuv", "B");
  staleRefresh();
  page.end("lmnopqrstuv"); page.flush();
  assert.equal(page.chip(), null, "verspätetes Ende von B beendet nicht den laufenden Wechsel nach C");
  page.end("zyxwvutsrqp"); page.flush();
  assert.equal(page.chip(), null, "B-Metadaten werden unter der C-Adresse nicht verwendet");
  assert.equal(page.intervals.size, 0);
  page.win.ytInitialPlayerResponse = page.response("zyxwvutsrqp", "C");
  page.win.dispatchEvent(new page.win.CustomEvent("video-data-change", { detail: { type: "dataloaded" } }));
  page.flush();
  assert.equal(page.chip().querySelector("[data-langform-chapter-label]").textContent, "C 0");
  const chip = page.chip();
  stalePlacement(); page.end("lmnopqrstuv"); page.flush();
  assert.equal(page.chip(), chip, "alte Platzierungs-/Endcallbacks greifen nicht in C ein");
  assert.equal(page.video.currentTime, 5);
  assert.equal(page.video.getAttribute("style"), null);
});

test("mobiles Ende ohne beobachteten Start aktualisiert Kapitel und lässt fremde Ziele unberührt", function (t) {
  const page = mobileChapterPage(t);
  const chip = page.chip();
  for (const name of ["state-navigatestart", "state-navigateend"]) {
    page.win.dispatchEvent(new page.win.CustomEvent(name, { detail: { href: "https://example.com/watch?v=lmnopqrstuv" } }));
  }
  page.flush();
  assert.equal(page.chip(), chip);
  assert.equal(page.timers.size, 0);
  page.win.history.replaceState({}, "", "/watch?v=lmnopqrstuv");
  page.win.ytInitialPlayerResponse = page.response("lmnopqrstuv", "B");
  page.end("lmnopqrstuv"); page.flush();
  assert.equal(page.chip().querySelector("[data-langform-chapter-label]").textContent, "B 0");
  assert.equal(page.intervals.size, 0);
});

test("mobiler Wechsel zur Startseite räumt Kapitelarbeit ab und ein späteres Video startet ereignisgesteuert", function (t) {
  const page = mobileChapterPage(t);
  page.doc.getElementById("player").dispatchEvent(new page.win.Event("pointerdown", { bubbles: true }));
  page.win.dispatchEvent(new page.win.Event("resize"));
  page.win.dispatchEvent(new page.win.CustomEvent("state-navigatestart", { detail: { href: "/" } }));
  assert.equal(page.chip(), null);
  assert.equal(page.timers.size, 0);
  assert.equal(page.intervals.size, 0);
  page.win.history.replaceState({}, "", "/");
  page.win.dispatchEvent(new page.win.CustomEvent("state-navigateend", { detail: { href: "/" } }));
  page.video.dispatchEvent(new page.win.Event("playing"));
  page.flush();
  assert.equal(page.chip(), null);
  assert.equal(page.timers.size, 0);
  assert.equal(page.intervals.size, 0);
  page.start("lmnopqrstuv");
  page.win.history.replaceState({}, "", "/watch?v=lmnopqrstuv");
  page.win.ytInitialPlayerResponse = page.response("lmnopqrstuv", "B");
  page.end("lmnopqrstuv"); page.flush();
  assert.equal(page.chip().querySelector("[data-langform-chapter-label]").textContent, "B 0");
  assert.equal(page.intervals.size, 0);
  assert.equal(page.video.currentTime, 5);
});

test("mobile Ereignisse zum gleichen Video erhalten offenes Sheet und erzeugen keine neue Kapitelarbeit", function (t) {
  const page = mobileChapterPage(t);
  const chip = page.chip(), sheet = page.doc.getElementById("langform-chapter-sheet");
  chip.click();
  let reads = 0;
  const response = page.win.ytInitialPlayerResponse;
  Object.defineProperty(page.win, "ytInitialPlayerResponse", { get: () => { reads++; return response; } });
  page.win.dispatchEvent(new page.win.CustomEvent("state-navigatestart", { detail: { href: "/watch?v=abcdefghijk&t=12" } }));
  page.end("abcdefghijk"); page.end("abcdefghijk"); page.flush();
  assert.equal(page.chip(), chip);
  assert.equal(page.doc.getElementById("langform-chapter-sheet"), sheet);
  assert.equal(sheet.style.display, "flex");
  assert.equal(reads, 0);
  assert.equal(page.timers.size, 0);
  assert.equal(page.intervals.size, 0);
});

test("Desktop-Ende und Popstate behalten nach mobilen Wechseln ihre Kapitelinvalidierung", function (t) {
  const page = mobileChapterPage(t);
  for (const [id, event, title] of [["lmnopqrstuv", "yt-navigate-finish", "Desktop"], ["zyxwvutsrqp", "popstate", "Back"]]) {
    page.win.history.replaceState({}, "", "/watch?v=" + id);
    page.win.ytInitialPlayerResponse = page.response(id, title);
    page.win.dispatchEvent(new page.win.Event(event)); page.flush();
    assert.equal(page.chip().querySelector("[data-langform-chapter-label]").textContent, title + " 0");
  }
  assert.deepEqual(page.sought, []);
  assert.equal(page.video.currentTime, 5);
});

test("lange Kapitelnamen reservieren den AirPlay-Layer neben der normalen Zeitzeile", function (t) {
  const dom = screenshotPlayerDom();
  t.after(() => dom.window.close());
  const doc = dom.window.document, list = chapters.chaptersFromPlayer(playerWithChapters());
  list[0].title = "KapitelnameOhneLeerzeichen".repeat(20);
  const airplay = doc.createElement("button");
  airplay.id = "langform-airplay";
  airplay.setAttribute("aria-label", "AirPlay");
  doc.body.appendChild(airplay);
  placeBox(airplay, 352, 310, 44, 44);
  chapters.renderChapterUi(doc, list, () => {});
  let chip = doc.getElementById("langform-chapter-chip");
  assert.equal(chip.style.left, "148px");
  assert.equal(chip.style.maxWidth, "196px", "der eigene AirPlay-Button außerhalb des Players begrenzt den Titel");
  assert.equal(chip.getAttribute("aria-label"), list[0].title + ", Kapitel");
  assert.equal(doc.getElementById("fullscreen").getAttribute("style"), null);
  airplay.style.visibility = "hidden";
  chapters.renderChapterUi(doc, list, () => {});
  chip = doc.getElementById("langform-chapter-chip");
  assert.equal(chip.style.maxWidth, "240px", "ein verborgener Layer blockiert keinen Platz");
  airplay.style.visibility = "";
  placeBox(airplay, 352, 140, 44, 44);
  chapters.renderChapterUi(doc, list, () => {});
  assert.equal(doc.getElementById("langform-chapter-chip").style.maxWidth, "240px", "AirPlay in der oberen Zeile begrenzt den unteren Titel nicht");
});

test("der eigene Kapitelbutton verschiebt AirPlay bei gemeinsamer Steuerzeile nicht auf die Zeit", function (t) {
  const dom = screenshotPlayerDom();
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document, row = doc.getElementById("row");
  row.appendChild(doc.getElementById("cc"));
  row.appendChild(doc.getElementById("gear"));
  placeBox(doc.getElementById("cc"), 340, 314, 36, 36);
  placeBox(doc.getElementById("gear"), 396, 314, 36, 36);
  doc.getElementById("v").webkitShowPlaybackTargetPicker = () => {};
  const first = chapters.ensureAirPlay(win);
  assert.equal(first.style.left, "300px");
  chapters.renderChapterUi(doc, chapters.chaptersFromPlayer(playerWithChapters()), () => {});
  const chip = doc.getElementById("langform-chapter-chip");
  placeBox(chip, 148, 310, 144, 44);
  chapters.ensureAirPlay(win);
  assert.equal(first.style.left, "300px", "nur YouTubes echte Controls bestimmen den AirPlay-Anker");
  assert.equal(first.style.top, "314px");
  assert.equal(first.parentNode, doc.body);
  assert.equal(chip.previousElementSibling, doc.getElementById("time"));
});

test("nach spätem Chrome-Reveal reserviert der vorhandene Kapitelchip sofort AirPlay und bleibt danach idle", function (t) {
  const dom = screenshotPlayerDom();
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document, row = doc.getElementById("row");
  row.appendChild(doc.getElementById("cc"));
  row.appendChild(doc.getElementById("gear"));
  placeBox(doc.getElementById("cc"), 340, 314, 36, 36);
  placeBox(doc.getElementById("gear"), 396, 314, 36, 36);
  doc.getElementById("v").webkitShowPlaybackTargetPicker = () => {};
  row.style.opacity = "0";
  assert.equal(chapters.ensureAirPlay(win), null);
  const list = chapters.chaptersFromPlayer(playerWithChapters());
  list[0].title = "Ein viel zu langer Kapitelname ".repeat(20);
  chapters.renderChapterUi(doc, list, () => {});
  const chip = doc.getElementById("langform-chapter-chip");
  assert.equal(chip.style.maxWidth, "184px");
  const originalRect = win.HTMLElement.prototype.getBoundingClientRect;
  win.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.id !== "langform-airplay") return originalRect.call(this);
    const left = parseFloat(this.style.left), top = parseFloat(this.style.top), width = parseFloat(this.style.width), height = parseFloat(this.style.height);
    return { left, top, width, height, right:left + width, bottom:top + height };
  };
  row.style.opacity = "1";
  const airplay = chapters.ensureAirPlay(win);
  assert.equal(airplay.style.left, "300px");
  assert.equal(chip.style.maxWidth, "144px", "sichtbar werdendes AirPlay verkürzt den bestehenden Chip im selben Aufruf");
  const observer = new win.MutationObserver(() => {});
  observer.observe(chip, {subtree:true,attributes:true,childList:true});
  observer.observe(airplay, {subtree:true,attributes:true,childList:true});
  let timeReads = 0;
  const time = doc.getElementById("time"), timeRect = time.getBoundingClientRect;
  time.getBoundingClientRect = () => { timeReads++; return timeRect(); };
  for (let i = 0; i < 8; i++) chapters.ensureAirPlay(win);
  assert.equal(timeReads, 0, "unveränderte Follow-Ticks messen die Kapitelzeile nicht erneut");
  assert.equal(observer.takeRecords().length, 0, "unveränderte Follow-Ticks mutieren weder Picker noch Kapitel");
  observer.disconnect();
});

test("Kapitel namens Settings werden bei fehlendem Zahnrad nicht als Systemsteuerung entdeckt", function (t) {
  const dom = screenshotPlayerDom();
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document;
  doc.getElementById("gear").remove();
  doc.getElementById("cc").remove();
  doc.getElementById("v").webkitShowPlaybackTargetPicker = () => {};
  const list = chapters.chaptersFromPlayer(playerWithChapters());
  list[0].title = "Settings für dieses Kapitel";
  chapters.renderChapterUi(doc, list, () => {});
  placeBox(doc.getElementById("langform-chapter-chip"), 148, 310, 144, 44);
  assert.equal(chapters.ensureAirPlay(win), null, "ein Kapitelname erzeugt keinen falschen AirPlay-Anker");
});

test("nach Scrollen und Drehen folgen Kapitel und AirPlay der neuen Steuerzeile", async function (t) {
  const dom = screenshotPlayerDom();
  const win = dom.window;
  t.after(function () { win.close(); });
  const doc = win.document;
  doc.getElementById("v").webkitShowPlaybackTargetPicker = function () {};
  win.ytInitialPlayerResponse = playerWithChapters();
  chapters.armChapters(win);
  const chip = doc.getElementById("langform-chapter-chip");
  const airplay = doc.getElementById("langform-airplay");
  assert.ok(airplay);
  doc.dispatchEvent(new win.Event("scroll"));
  assert.equal(airplay.style.visibility, "hidden");
  placeBox(doc.getElementById("player"), 0, 88, 471, 265);
  placeBox(doc.getElementById("time"), 36, 280, 104, 24);
  placeBox(doc.getElementById("fullscreen"), 396, 274, 36, 36);
  placeBox(doc.getElementById("cc"), 340, 100, 36, 36);
  placeBox(doc.getElementById("gear"), 396, 100, 36, 36);
  await new Promise(function (resolve) { setTimeout(resolve, 260); });
  assert.equal(airplay.style.visibility, "");
  assert.equal(airplay.style.top, "100px");
  assert.equal(chip.style.top, "292px");
  placeBox(doc.getElementById("time"), 36, 280, 144, 24);
  win.dispatchEvent(new win.Event("resize"));
  await new Promise(function (resolve) { setTimeout(resolve, 240); });
  assert.equal(chip.style.left, "188px");
  assert.equal(chip.style.maxWidth, "200px");
  assert.equal(doc.getElementById("v").getAttribute("style"), null);
});

test("der native Zeitstempel-Hook sucht nur das aktuelle Video und fasst History nicht an", function () {
  const dom = new JSDOM('<div id="movie_player"><video></video></div>', { url: "https://m.youtube.com/watch?v=abcdefghijk" });
  const win = dom.window;
  win.ShortsAusblenden = { logic: require("../extension/src/logic.js") };
  win.document.querySelector("video").currentTime = 100;
  const sought = [];
  win.document.getElementById("movie_player").seekTo = function (seconds) { sought.push(seconds); };
  chapters.install(win);
  assert.equal(win.__langformSeekFromLink("/watch?v=abcdefghijk&t=1m23s"), true);
  assert.equal(win.__langformSeekFromLink("/watch?v=abcdefghijk&t=0"), true);
  assert.equal(win.__langformSeekFromLink("/watch?v=zyxwvutsrqp&t=83"), false);
  assert.equal(win.__langformSeekFromLink("/watch?v=abcdefghijk"), false);
  assert.equal(win.__langformSeekFromLink("https://example.com/watch?v=abcdefghijk&t=83"), false);
  assert.equal(win.__langformSeekFromLink("/watch?v=abcdefghijk#t=%invalid"), false);
  assert.deepEqual(sought, [83, 0]);
  assert.equal(win.location.href, "https://m.youtube.com/watch?v=abcdefghijk");
  win.history.replaceState(null, "", "/watch?v=abcdefghijk&t=95");
  assert.deepEqual(sought, [83, 0], "History-Änderungen lösen keinen Seek aus");
  win.ytInitialPlayerResponse = { videoDetails: { videoId: "zyxwvutsrqp" } };
  assert.equal(win.__langformSeekFromLink("/watch?v=abcdefghijk&t=10"), false);
  win.close();
});

test("die Suche nach der Kapitelleiste misst keine Empfehlungen außerhalb des Players", function () {
  const dom = screenshotPlayerDom();
  const doc = dom.window.document;
  let measured = 0;
  for (let i = 0; i < 200; i++) {
    const card = doc.createElement("div");
    card.textContent = "Empfohlenes Video " + i;
    card.getBoundingClientRect = function () { measured += 1; return { left: 0, top: 500, width: 471, height: 200 }; };
    doc.body.appendChild(card);
  }
  assert.equal(chapters.findSeekBar(doc), doc.getElementById("bar"));
  assert.equal(measured, 0);
  dom.window.close();
});

test("Scrollen und Tippen in Kommentar- und Kapitellisten erzeugt keine Player-Messung", async function (t) {
  const dom = screenshotPlayerDom();
  const win = dom.window;
  const doc = win.document;
  t.after(function () { win.close(); });
  doc.getElementById("v").webkitShowPlaybackTargetPicker = function () {};
  win.ytInitialPlayerResponse = playerWithChapters();
  chapters.armChapters(win);
  const airplay = doc.getElementById("langform-airplay");
  const originalVisibility = airplay.style.visibility;
  doc.body.insertAdjacentHTML("beforeend", '<bottom-sheet-container><div id="comments-list"><button>Antworten</button></div></bottom-sheet-container>' +
    '<div id="dialog-container"><div id="native-chapters">YouTube-Kapitel</div></div>' +
    '<ytm-comments-section-renderer><div id="inline-comments">Kommentare</div></ytm-comments-section-renderer>' +
    '<panel-container><ytm-engagement-panel><ytm-engagement-panel-section-list-renderer class="comment-item-section">' +
    '<div class="engagement-panel-container"><div class="engagement-panel-content-wrapper" id="engagement-comments">' +
    '<ytm-comments-header-renderer></ytm-comments-header-renderer><button>Antworten</button>' +
    '</div></div></ytm-engagement-panel-section-list-renderer></ytm-engagement-panel>' +
    '<ytm-engagement-panel><div class="engagement-panel-content-wrapper" id="engagement-loading">Lädt …</div></ytm-engagement-panel></panel-container>');
  const nativeMarkup = doc.querySelector("bottom-sheet-container").outerHTML;
  const engagementMarkup = doc.querySelector("panel-container").outerHTML;
  const targets = ["comments-list", "native-chapters", "inline-comments", "engagement-comments", "engagement-loading"].map(id => doc.getElementById(id));
  targets.push(doc.querySelector("#langform-chapter-sheet [data-langform-chapter-list]"));
  let measured = 0;
  for (const element of doc.getElementById("player").querySelectorAll("*")) {
    const original = element.getBoundingClientRect.bind(element);
    element.getBoundingClientRect = function () { measured++; return original(); };
  }
  let styled = 0, queried = 0;
  const getStyle = win.getComputedStyle.bind(win);
  win.getComputedStyle = function (element) { styled++; return getStyle(element); };
  const query = doc.querySelector.bind(doc);
  doc.querySelector = function (selector) { queried++; return query(selector); };
  let followIntervals = 0;
  const originalInterval = win.setInterval.bind(win);
  win.setInterval = function (fn, ms) {
    if (ms === 350) followIntervals++;
    return originalInterval(fn, ms);
  };
  for (const target of targets) {
    target.dispatchEvent(new win.Event("pointerdown", { bubbles: true, composed: true }));
    for (let i = 0; i < 5; i++) target.dispatchEvent(new win.Event("scroll"));
  }
  assert.notEqual(win.__langformChapterScrolling, true);
  assert.equal(airplay.style.visibility, originalVisibility);
  await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(measured, 0, "vorher acht Player-Messungen nach einem einzigen Kommentar-Scroll");
  assert.deepEqual({ styled, queried }, { styled: 0, queried: 0 }, "reale Engagement-Panels brauchen auch keine Stil- oder Dokumentsuche");
  assert.equal(followIntervals, 0);
  assert.equal(doc.querySelector("bottom-sheet-container").outerHTML, nativeMarkup);
  assert.equal(doc.querySelector("panel-container").outerHTML, engagementMarkup);
  assert.equal(airplay.style.visibility, originalVisibility);
});

test("native Player-Geste setzt Kapitel- und AirPlay-Messungen aus und holt sie einmal nach", function (t) {
  const page = mobileChapterPage(t);
  const { win, doc, video, timers, intervals } = page;
  video.webkitShowPlaybackTargetPicker = function () {};
  chapters.ensureAirPlay(win);
  win.webkit = { messageHandlers: { langformPlayer: { postMessage() {} } } };
  new Function("window", fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/PlayerRect.js"), "utf8"))(win);
  const player = doc.getElementById("player");
  video.dispatchEvent(new win.Event("pointerdown", { bubbles: true }));
  const follow = [...intervals.values()].find(item => item.delay === 350);
  assert.ok(follow);
  assert.equal(win.__langformSetNativeDragging(true, "abcdefghijk"), true);
  assert.equal(win.__langformIsNativeDragging(), true);
  let measured = 0, styled = 0, queried = 0;
  for (const element of [player, ...player.querySelectorAll("*")]) {
    const original = element.getBoundingClientRect.bind(element);
    element.getBoundingClientRect = function () { measured++; return original(); };
  }
  const getStyle = win.getComputedStyle.bind(win);
  win.getComputedStyle = function (element) { styled++; return getStyle(element); };
  const query = doc.querySelector.bind(doc);
  doc.querySelector = function (selector) { queried++; return query(selector); };
  function runTimers(delay) {
    for (const [id, item] of [...timers]) {
      if (item.delay !== delay) continue;
      timers.delete(id);
      item.callback();
    }
  }
  // A pending viewport update and replaced chapter control both become due
  // while native owns the same retained WebView.
  page.chip().remove();
  win.dispatchEvent(new win.Event("video-data-change"));
  win.dispatchEvent(new win.Event("resize"));
  runTimers(240);
  runTimers(160);
  for (let i = 0; i < 8; i++) follow.callback();
  assert.deepEqual({ measured, styled, queried }, { measured: 0, styled: 0, queried: 0 });
  assert.equal(page.chip(), null);
  assert.equal(win.__langformSetNativeDragging(false, "wrong-video"), false);
  assert.equal(win.__langformIsNativeDragging(), true);
  assert.equal([...timers.values()].filter(item => item.delay === 160 || item.delay === 240).length, 0);
  assert.equal(win.__langformSetNativeDragging(false, "abcdefghijk"), true);
  assert.equal(win.__langformIsNativeDragging(), false);
  assert.equal([...timers.values()].filter(item => item.delay === 160).length, 1);
  assert.equal([...timers.values()].filter(item => item.delay === 240).length, 1);
  win.__langformSetNativeDragging(false, "abcdefghijk");
  assert.equal([...timers.values()].filter(item => item.delay === 160 || item.delay === 240).length, 2);
  runTimers(160);
  runTimers(240);
  assert.ok(measured > 0);
  assert.ok(page.chip(), "nach der Geste werden ersetzte Kapitel wieder gebunden");
  assert.ok(doc.getElementById("langform-airplay"));
  assert.equal([...timers.values()].filter(item => item.delay === 160 || item.delay === 240).length, 0);
  win.__langformSetNativeDragging(true, "abcdefghijk");
  win.dispatchEvent(new win.Event("pagehide"));
  assert.equal(win.__langformIsNativeDragging(), false);
});

test("Kapitelliste zeigt den aktiven Eintrag und scrollt ausschließlich ihre eigene Liste", function (t) {
  const dom = screenshotPlayerDom();
  t.after(function () { dom.window.close(); });
  const win = dom.window;
  const doc = win.document;
  const items = chapters.chaptersFromPlayer(playerWithChapters());
  items[1].thumbnail = "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg";
  const ui = chapters.renderChapterUi(doc, items, function () {});
  chapters.syncChapterUi(doc, items, 100);
  const sheet = doc.getElementById("langform-chapter-sheet");
  const list = sheet.querySelector("[data-langform-chapter-list]");
  const row = list.querySelector("[aria-current=true]");
  Object.defineProperties(list, { clientHeight: { value: 160 }, scrollHeight: { value: 600 } });
  list.scrollTop = 200;
  placeBox(list, 0, 400, 471, 160);
  placeBox(row, 0, 500, 471, 72);
  win.scrollTo = function () { assert.fail("YouTube-Seite darf sich nicht verschieben"); };
  row.scrollIntoView = function () { assert.fail("scrollIntoView kann die ganze Seite verschieben"); };
  ui.open();
  assert.equal(list.scrollTop, 256);
  assert.equal(row.style.minHeight, "72px");
  assert.equal(doc.activeElement, row);
  row.blur(); // JSDOM also treats the focused element as :active.
  assert.equal(win.getComputedStyle(row).backgroundColor, "rgba(255, 255, 255, 0.12)");
  assert.equal(row.querySelector("img").getAttribute("loading"), "lazy");
  assert.equal(row.querySelector("img").getAttribute("decoding"), "async");
  assert.equal(doc.getElementById("langform-chapter-chip").getAttribute("aria-expanded"), "true");
  assert.equal(doc.getElementById("v").getAttribute("style"), null);
});

function fakeSheetAnimations(sheet) {
  const animations = [];
  sheet.animate = function (frames, options) {
    const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } };
    animations.push(animation);
    return animation;
  };
  return animations;
}

test("Kapitel öffnen und schließen ohne Layoutanimation und ignorieren doppelte Auswahl während des Schließens", function (t) {
  const dom = screenshotPlayerDom();
  t.after(function () { dom.window.close(); });
  const doc = dom.window.document;
  const sought = [];
  const ui = chapters.renderChapterUi(doc, chapters.chaptersFromPlayer(playerWithChapters()), seconds => sought.push(seconds));
  const sheet = doc.getElementById("langform-chapter-sheet");
  const animations = fakeSheetAnimations(sheet);
  ui.open();
  assert.equal(animations[0].options.duration, 280);
  assert.equal(animations[0].options.fill, "both", "kein Rücksprung zum ruhenden Frame vor dem Abschluss");
  animations[0].onfinish();
  assert.equal(animations[0].cancelled, true, "kein bleibender Effekt beim Lesen");
  const row = sheet.querySelector('[data-start="83"]');
  row.click();
  row.click();
  assert.deepEqual(sought, [83]);
  assert.equal(animations[1].options.duration, 180);
  assert.equal(sheet.style.display, "flex", "Sheet bleibt für die kurze Ausblendung sichtbar");
  assert.equal(sheet.style.pointerEvents, "none");
  assert.equal(sheet.getAttribute("aria-hidden"), "false", "native Gesten bleiben während der Ausblendung gesperrt");
  for (const animation of animations) {
    for (const frame of animation.frames) assert.deepEqual(Object.keys(frame).sort(), ["transform"]);
  }
  animations[1].onfinish();
  assert.equal(sheet.style.display, "none");
  assert.equal(sheet.getAttribute("aria-hidden"), "true");
  assert.equal(animations[1].cancelled, true);
});

test("laufende Kapitelbewegung gibt bei Viewport- oder Reduce-Motion-Wechsel sofort den ruhenden Zustand frei", function (t) {
  for (const phase of ["opening", "closing"]) {
    for (const reason of ["resize", "reduce", "pagehide"]) {
      const dom = screenshotPlayerDom(); t.after(() => dom.window.close());
      const win = dom.window, doc = win.document, listeners = new Set();
      const preference = { matches: false,
        addEventListener(name, callback) { listeners.add(callback); },
        removeEventListener(name, callback) { listeners.delete(callback); } };
      win.matchMedia = () => preference;
      const ui = chapters.renderChapterUi(doc, chapters.chaptersFromPlayer(playerWithChapters()), function () {});
      const sheet = doc.getElementById("langform-chapter-sheet"), animations = fakeSheetAnimations(sheet);
      ui.open();
      if (phase === "closing") { animations[0].onfinish(); ui.close(); }
      const animation = animations.at(-1), staleFinish = animation.onfinish;
      const list = sheet.querySelector("[data-langform-chapter-list]"); list.scrollTop = 180;
      if (reason === "reduce") { preference.matches = true; listeners.forEach(callback => callback()); }
      else win.dispatchEvent(new win.Event(reason));
      staleFinish();
      assert.equal(animation.cancelled, true);
      assert.equal(sheet.style.display, phase === "closing" || reason === "pagehide" ? "none" : "flex");
      assert.equal(sheet.style.pointerEvents, "");
      assert.equal(list.scrollTop, 180);
      chapters.renderChapterUi(doc, [], function () {});
      assert.equal(listeners.size, 0, "entfernte Kapitelblätter behalten keinen Preference-Listener");
    }
  }
});

test("schnelles Wiederöffnen verwirft das alte Animationsende", function (t) {
  const dom = screenshotPlayerDom();
  t.after(function () { dom.window.close(); });
  const doc = dom.window.document;
  const ui = chapters.renderChapterUi(doc, chapters.chaptersFromPlayer(playerWithChapters()), function () {});
  const sheet = doc.getElementById("langform-chapter-sheet");
  const animations = fakeSheetAnimations(sheet);
  ui.open();
  ui.close();
  const staleFinish = animations[1].onfinish;
  ui.open();
  assert.equal(animations[0].cancelled, true);
  assert.equal(animations[1].cancelled, true);
  staleFinish();
  assert.equal(sheet.style.display, "flex");
  assert.equal(sheet.style.pointerEvents, "");
  animations[2].onfinish();
  assert.equal(sheet.style.display, "flex");
  assert.equal(doc.getElementById("langform-chapter-chip").getAttribute("aria-expanded"), "true");
});

test("Bewegung reduzieren und Escape schließen die Kapitel sofort ohne Animation", function (t) {
  const dom = screenshotPlayerDom();
  t.after(function () { dom.window.close(); });
  const win = dom.window;
  const doc = win.document;
  win.matchMedia = query => ({ matches: query === "(prefers-reduced-motion: reduce)" });
  const ui = chapters.renderChapterUi(doc, chapters.chaptersFromPlayer(playerWithChapters()), function () {});
  const sheet = doc.getElementById("langform-chapter-sheet");
  sheet.animate = function () { assert.fail("Reduce Motion darf keine Sheet-Animation starten"); };
  ui.open();
  assert.equal(sheet.style.display, "flex");
  sheet.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(sheet.style.display, "none");
  assert.equal(doc.activeElement, doc.getElementById("langform-chapter-chip"));
  assert.equal(doc.getElementById("langform-chapter-chip").getAttribute("aria-expanded"), "false");
});
function initialDataChapters(owner = 'abcdefghijk') {
  return {
    currentVideoEndpoint: {watchEndpoint:{videoId:owner}},
    playerOverlays: playerWithChapters().playerOverlays,
  };
}
function emptyChapterPlayer() {
  return {videoDetails:{videoId:'abcdefghijk',lengthSeconds:String(DURATION),shortDescription:'No timestamps here'}};
}
test('Kapitel aus aktueller Watch-Datenantwort bleiben verfügbar ohne Kapitel im Playerresponse', t => {
  const dom=screenshotPlayerDom();t.after(()=>dom.window.close());
  const win=dom.window;win.ytInitialPlayerResponse=emptyChapterPlayer();win.ytInitialData=initialDataChapters();
  assert.deepEqual(chapters.chaptersFromPlayer(win.ytInitialPlayerResponse),[]);
  chapters.refreshChapters(win);
  assert.deepEqual(win.document.documentElement.__langformChapterList.map(item=>item.start),[0,83,724]);
  assert.equal(win.document.documentElement.__langformChapterVideoID,'abcdefghijk');
});
test('Leere Kapitel werden nicht festgehalten wenn derselbe Response später hydriert', t => {
  for(const source of ['player','initialData']) {
    const dom=screenshotPlayerDom();t.after(()=>dom.window.close());const win=dom.window;
    const player=emptyChapterPlayer();win.ytInitialPlayerResponse=player;
    const initial={currentVideoEndpoint:{watchEndpoint:{videoId:'abcdefghijk'}}};win.ytInitialData=initial;
    chapters.refreshChapters(win);assert.deepEqual(win.document.documentElement.__langformChapterList,[]);
    if(source==='player')player.videoDetails.shortDescription='0:00 Intro\n1:23 Gespräch';
    else initial.playerOverlays=playerWithChapters().playerOverlays;
    chapters.refreshChapters(win);
    assert.ok(win.document.documentElement.__langformChapterList.length>=2,source);
    assert.equal(win.document.documentElement.__langformChapterVideoID,'abcdefghijk');
  }
});
test('Watch-Fallback verlangt aktuellen primären Videobesitzer und übernimmt keine Empfehlungen', t => {
  const cases=[initialDataChapters('other'),initialDataChapters(''),{playerOverlays:playerWithChapters().playerOverlays},
    {currentVideoEndpoint:{watchEndpoint:{videoId:'abcdefghijk'}},contents:{secondaryResults:{related:playerWithChapters()}}}];
  for(const initial of cases) {
    const dom=screenshotPlayerDom();t.after(()=>dom.window.close());const win=dom.window;
    win.ytInitialPlayerResponse=emptyChapterPlayer();win.ytInitialData=initial;
    chapters.refreshChapters(win);
    assert.deepEqual(win.document.documentElement.__langformChapterList,[]);
    assert.equal(win.document.documentElement.__langformChapterVideoID,'');
    assert.equal(win.__langformChapterCache,null);
  }
  const dom=screenshotPlayerDom();t.after(()=>dom.window.close());const win=dom.window;
  win.ytInitialPlayerResponse=emptyChapterPlayer();win.ytInitialPlayerResponse.videoDetails.videoId='other';win.ytInitialData=initialDataChapters();
  chapters.refreshChapters(win);
  assert.deepEqual(win.document.documentElement.__langformChapterList,[],'auch gültige Watch-Daten umgehen keine fremde Playerantwort');
});
test('Watch-Makromarker prüfen ihre eigene Video-ID und publizieren echte Dezimalzeitstempel', t => {
  const dom=screenshotPlayerDom();t.after(()=>dom.window.close());const win=dom.window;
  win.ytInitialPlayerResponse=emptyChapterPlayer();
  function item(title,start,owner) { return {macroMarkersListItemRenderer:{title:{simpleText:title},onTap:{watchEndpoint:{videoId:owner,startTimeSeconds:start}}}}; }
  win.ytInitialData={currentVideoEndpoint:{watchEndpoint:{videoId:'abcdefghijk'}},engagementPanels:[{engagementPanelSectionListRenderer:{content:{macroMarkersListRenderer:{contents:[
    item('Present moment alignment',0,'abcdefghijk'),item('Empowering your vision',95.88,'abcdefghijk'),item('The journey over the goal',204,'abcdefghijk'),item('Foreign chapter',120,'other')
  ]}}}}]};
  chapters.refreshChapters(win);
  assert.deepEqual(win.document.documentElement.__langformChapterList.map(item=>[item.start,item.title]),[[0,'Present moment alignment'],[95.88,'Empowering your vision'],[204,'The journey over the goal']]);
  win.ytInitialData.engagementPanels[0].engagementPanelSectionListRenderer.content.macroMarkersListRenderer.contents.forEach(entry=>{entry.macroMarkersListItemRenderer.onTap.watchEndpoint.videoId='other';});
  // A replacement response represents a fresh hydrated data source.
  win.ytInitialData={...win.ytInitialData};chapters.refreshChapters(win);
  assert.deepEqual(win.document.documentElement.__langformChapterList,[]);
});
test('Erfolgreicher Watch-Fallbackcache wird bei neuer Datenantwort oder geänderter Besitzer-ID verworfen', t => {
  const dom=screenshotPlayerDom();t.after(()=>dom.window.close());const win=dom.window;
  win.ytInitialPlayerResponse=emptyChapterPlayer();win.ytInitialData=initialDataChapters();
  chapters.refreshChapters(win);assert.equal(win.document.documentElement.__langformChapterList.length,3);
  win.ytInitialData.currentVideoEndpoint.watchEndpoint.videoId='other';chapters.refreshChapters(win);
  assert.deepEqual(win.document.documentElement.__langformChapterList,[]);
  win.ytInitialData=initialDataChapters();chapters.refreshChapters(win);
  assert.equal(win.document.documentElement.__langformChapterList.length,3);
  win.ytInitialData={currentVideoEndpoint:{watchEndpoint:{videoId:'abcdefghijk'}}};chapters.refreshChapters(win);
  assert.deepEqual(win.document.documentElement.__langformChapterList,[]);
});
test('Fehlende frühe Watch-Kapitel beenden den bestehenden begrenzten Hydrationretry nicht sofort', t => {
  const dom=screenshotPlayerDom();t.after(()=>dom.window.close());const win=dom.window;
  win.ytInitialPlayerResponse=emptyChapterPlayer();win.ytInitialData={currentVideoEndpoint:{watchEndpoint:{videoId:'abcdefghijk'}}};
  let retry, cleared=0, serial=100;
  win.setInterval=fn=>{retry=fn;return 71;};win.clearInterval=()=>{cleared++;};
  win.setTimeout=()=>++serial;win.clearTimeout=()=>{};
  chapters.armChapters(win);
  assert.equal(cleared,0,'erste leere Antwort kann noch hydrieren');
  assert.equal(win.__langformChapterRetry,71);
  for(let i=0;i<25;i++)retry();
  assert.equal(win.__langformChapterRetry,0,'bestehende maximal24 Versuche bleiben begrenzt');
  assert.equal(cleared,1);
});
test('Mobile serialisierte Watch-Daten werden sicher gelesen ohne YouTubes Global zu verändern', t => {
  const dom=screenshotPlayerDom();t.after(()=>dom.window.close());const win=dom.window;
  win.ytInitialPlayerResponse=emptyChapterPlayer();const serialized=JSON.stringify(initialDataChapters());win.ytInitialData=serialized;
  chapters.refreshChapters(win);
  assert.deepEqual(win.document.documentElement.__langformChapterList.map(item=>item.start),[0,83,724]);
  assert.equal(win.ytInitialData,serialized);
});
test('Serialisierte Kapitel bleiben bei fremdem Besitzer, ungültigem JSON oder zu großer Antwort leer', t => {
  const sources=[JSON.stringify(initialDataChapters('other')),JSON.stringify({playerOverlays:playerWithChapters().playerOverlays}),'{incomplete',JSON.stringify(null),JSON.stringify([]),' '.repeat(2*1024*1024+1)];
  for(const source of sources) {
    const dom=screenshotPlayerDom();t.after(()=>dom.window.close());const win=dom.window;
    win.ytInitialPlayerResponse=emptyChapterPlayer();win.ytInitialData=source;
    chapters.refreshChapters(win);
    assert.deepEqual(win.document.documentElement.__langformChapterList,[]);
    assert.equal(win.document.documentElement.__langformChapterVideoID,'');
    assert.equal(win.ytInitialData,source);
  }
});
test('Identische serialisierte Watch-Antwort wird nur einmal geparst und Wechsel neu ausgewertet', t => {
  const dom=screenshotPlayerDom();t.after(()=>dom.window.close());const win=dom.window;
  win.ytInitialPlayerResponse=emptyChapterPlayer();
  win.ytInitialData=JSON.stringify(initialDataChapters());
  const parse=JSON.parse;let calls=0;
  JSON.parse=function(value) {calls++;return parse(value);};
  try {
    chapters.refreshChapters(win);const first=calls;assert.ok(first>=1);
    const parsed=win.__langformChapterDataCache.data;
    chapters.refreshChapters(win);assert.equal(calls,first);assert.equal(win.__langformChapterDataCache.data,parsed);
    win.ytInitialData=JSON.stringify(initialDataChapters('other'));
    chapters.refreshChapters(win);assert.ok(calls>first);assert.deepEqual(win.document.documentElement.__langformChapterList,[]);
    win.ytInitialData=initialDataChapters();chapters.refreshChapters(win);
    assert.equal(win.__langformChapterDataCache,null,'bereits normalisierte Antwort braucht keinen Stringcache');
    assert.equal(win.document.documentElement.__langformChapterList.length,3);
  } finally {JSON.parse=parse;}
});
