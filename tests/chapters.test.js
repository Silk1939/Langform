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
