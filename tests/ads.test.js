const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const ads = require("../extension/src/ads.js");

const SOURCE = fs.readFileSync(path.join(__dirname, "../extension/src/ads.js"), "utf8");

function watchPage(playerClass, inner) {
  const dom = new JSDOM(
    `<!DOCTYPE html><body>
      <div id="movie_player" class="${playerClass}">
        <video id="v"></video>
        <div class="video-ads ytp-ad-module">${inner || ""}</div>
      </div>
    </body>`,
    { url: "https://m.youtube.com/watch?v=abcdefghijk" }
  );
  const win = dom.window;
  const doc = win.document;
  const video = doc.getElementById("v");
  const player = doc.getElementById("movie_player");
  const log = { seekTo: [], pause: 0, times: [] };
  player.seekTo = function (seconds) { log.seekTo.push(seconds); };
  player.pauseVideo = function () { log.pause += 1; };
  video.pause = function () { log.pause += 1; };
  let time = 0;
  let duration = NaN;
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: function () { return time; },
    set: function (value) { log.times.push(value); time = value; },
  });
  Object.defineProperty(video, "duration", { configurable: true, get: function () { return duration; } });
  return {
    dom: dom,
    win: win,
    doc: doc,
    video: video,
    player: player,
    log: log,
    setDuration: function (value) { duration = value; },
    setTime: function (value) { time = value; },
  };
}

test("ein Player mit ad-showing ist Werbung, ein normaler Watch-Player nicht", function () {
  const ad = watchPage("html5-video-player ad-showing playing-mode");
  assert.equal(ads.isAdShowing(ad.player), true);
  const interrupting = watchPage("html5-video-player ad-interrupting");
  assert.equal(ads.isAdShowing(interrupting.player), true);
  const overlay = watchPage("html5-video-player", '<div class="ytp-ad-player-overlay"><span class="ytp-ad-simple-ad-badge">Anzeige</span></div>');
  assert.equal(ads.isAdShowing(overlay.player), true);

  // The first seconds of the main video, with ads planned in the response, are not an ad.
  const main = watchPage("html5-video-player playing-mode ytp-autohide");
  main.win.ytInitialPlayerResponse = { adPlacements: [{ adPlacementRenderer: {} }], videoDetails: { videoId: "abcdefghijk" } };
  main.setTime(0.2);
  main.setDuration(1022);
  assert.equal(ads.isAdShowing(main.player), false);
  assert.equal(ads.handle(main.win), "none");
  assert.equal(main.video.muted, false);
  assert.deepEqual(main.log.times, []);
  assert.deepEqual(main.log.seekTo, []);
  assert.equal(main.log.pause, 0);
  // The empty ad module of every player is not an ad either.
  assert.equal(ads.isAdShowing(watchPage("html5-video-player", "<div></div>").player), false);
});

test("Überspringen ist YouTubes Knopf, kein Sprung im Hauptvideo", function () {
  const page = watchPage(
    "html5-video-player ad-showing",
    '<div class="ytp-ad-player-overlay"><button class="ytp-skip-ad-button">Überspringen</button></div>'
  );
  let clicks = 0;
  page.doc.querySelector(".ytp-skip-ad-button").addEventListener("click", function () { clicks += 1; });
  page.setDuration(15);
  page.setTime(2);
  assert.equal(ads.handle(page.win), "skip");
  assert.equal(clicks, 1);
  assert.deepEqual(page.log.seekTo, [], "movie_player.seekTo wird nie aufgerufen");
  assert.deepEqual(page.log.times, [], "die Zeit des Videos bleibt");
  assert.equal(page.log.pause, 0);
  assert.equal(page.video.muted, false);
  assert.equal(page.video.getAttribute("style"), null);
});

test("ohne Knopf: Werbung stumm und an ihr Ende, danach kommt der Ton zurück", function () {
  const page = watchPage("html5-video-player ad-showing", '<div class="ytp-ad-preview-container">Werbung endet in 5</div>');
  page.doc.querySelector(".ytp-ad-preview-container").insertAdjacentHTML(
    "afterend",
    '<button class="ytp-ad-skip-button-modern" style="display:none">Überspringen</button>'
  );
  // Duration unknown: nothing is touched yet.
  assert.equal(ads.handle(page.win), "wait");
  assert.equal(page.video.muted, false);
  assert.deepEqual(page.log.times, []);
  page.setDuration(14.8);
  page.setTime(0.4);
  assert.equal(ads.handle(page.win), "jump");
  assert.equal(page.video.muted, true);
  assert.deepEqual(page.log.times, [14.8]);
  assert.deepEqual(page.log.seekTo, []);
  assert.equal(page.log.pause, 0);

  // The ad ends: the main video gets its sound back and is not moved.
  page.player.className = "html5-video-player playing-mode";
  page.doc.querySelector(".video-ads").innerHTML = "";
  page.setDuration(1022);
  page.setTime(0);
  assert.equal(ads.handle(page.win), "restore");
  assert.equal(page.video.muted, false);
  assert.equal(ads.handle(page.win), "none");
  assert.deepEqual(page.log.times, [14.8]);
  assert.deepEqual(page.log.seekTo, []);
  assert.equal(page.video.getAttribute("style"), null);
});

test("trägt das Medium noch das Hauptvideo, wird nur stummgeschaltet, nie gesprungen", function () {
  // Stitched into the main stream: the media is as long as the main video.
  const stitched = watchPage("html5-video-player ad-showing");
  stitched.win.ytInitialPlayerResponse = { videoDetails: { videoId: "abcdefghijk", lengthSeconds: "1022" } };
  stitched.setDuration(1022.4);
  stitched.setTime(311);
  assert.equal(ads.handle(stitched.win), "mute");
  assert.equal(stitched.video.muted, true);
  assert.deepEqual(stitched.log.times, []);

  // The class switched before the source: still the source seen during the main video.
  const early = watchPage("html5-video-player playing-mode");
  early.video.setAttribute("src", "blob:https://m.youtube.com/haupt");
  early.setDuration(95);
  assert.equal(ads.handle(early.win), "none");
  early.player.classList.add("ad-showing");
  early.setTime(40);
  assert.equal(ads.handle(early.win), "mute");
  assert.deepEqual(early.log.times, []);
  // Now the ad's own source is loaded: it runs to its end.
  early.video.setAttribute("src", "blob:https://m.youtube.com/werbung");
  early.setDuration(12);
  early.setTime(0);
  assert.equal(ads.handle(early.win), "jump");
  assert.deepEqual(early.log.times, [12]);
  early.player.classList.remove("ad-showing");
  assert.equal(ads.handle(early.win), "restore");
  assert.equal(early.video.muted, false);
  assert.deepEqual(early.log.seekTo, []);
  assert.equal(early.log.pause, 0);
});

test("die Werbeplätze verschwinden per CSS, Player, Kapitelchip, Cast, AirPlay und Suche nicht", function () {
  const css = ads.cssText();
  assert.match(css, /display: none !important/);
  ["#masthead-ad", "ytd-ad-slot-renderer", "ytd-banner-promo-renderer", "ytd-companion-slot-renderer", "ad-slot-renderer", "ytm-promoted-sparkles-web-renderer", "ytm-companion-ad-renderer"].forEach(function (selector) {
    assert.ok(css.indexOf(selector) !== -1, selector);
  });
  css.split(",\n").forEach(function (selector) {
    const subject = selector.split(":not(")[0];
    assert.doesNotMatch(subject, /movie_player|ytm-player(?![\w-])|ytd-player(?![\w-])|html5-video-player|^video|langform-|cast|airplay|searchbox|search_query|ytp-ad-module|video-ads/i, selector);
  });

  const dom = new JSDOM(
    `<!DOCTYPE html><body>
      <div id="masthead-ad">Banner</div>
      <ytm-promoted-sparkles-web-renderer id="feed-ad">Anzeige</ytm-promoted-sparkles-web-renderer>
      <ytm-companion-slot id="companion">Anzeige</ytm-companion-slot>
      <div id="movie_player" class="html5-video-player ad-showing"><video id="v"></video>
        <button class="ytp-cast-button" id="cast">Cast</button>
        <div class="video-ads ytp-ad-module"><div class="ytp-ad-player-overlay"></div></div>
      </div>
      <button id="langform-chapter-chip">Intro</button>
      <button id="langform-airplay">AirPlay</button>
      <ytm-searchbox id="search"><input name="search_query"></ytm-searchbox>
    </body>`,
    { url: "https://m.youtube.com/watch?v=abcdefghijk" }
  );
  const doc = dom.window.document;
  const plain = css.split(",\n").map(function (s) { return s.replace(/ \{[\s\S]*$/, "").trim(); }).filter(function (s) { return s.indexOf(":has(") === -1; });
  function hidden(el) {
    return plain.some(function (selector) { return el.matches(selector); });
  }
  assert.equal(hidden(doc.getElementById("masthead-ad")), true);
  assert.equal(hidden(doc.getElementById("feed-ad")), true);
  assert.equal(hidden(doc.getElementById("companion")), true);
  ["movie_player", "v", "cast", "langform-chapter-chip", "langform-airplay", "search"].forEach(function (id) {
    assert.equal(hidden(doc.getElementById(id)), false, id);
  });
  assert.equal(hidden(doc.querySelector(".ytp-ad-module")), false, "der Werbebereich mit dem Überspringen-Knopf bleibt");
});

test("ohne Timer: das Skript prüft bei einer neuen Werbung, nicht im Takt", async function () {
  assert.doesNotMatch(SOURCE, /setInterval|setTimeout|requestAnimationFrame/);
  assert.doesNotMatch(SOURCE, /\.pause\(\)|pauseVideo|seekTo|googlevideo/);
  assert.doesNotMatch(SOURCE, /\.style\.(width|height|objectFit|display)/);

  const page = watchPage("html5-video-player playing-mode");
  const win = page.win;
  let intervals = 0;
  win.setInterval = function () { intervals += 1; return 0; };
  ads.install(win);
  assert.ok(page.doc.getElementById(ads.STYLE_ID));
  page.setDuration(1022);
  page.video.dispatchEvent(new win.Event("playing"));
  assert.deepEqual(page.log.times, []);

  // YouTube switches the player to an ad: one check, and the ad runs to its end.
  page.setDuration(20);
  page.setTime(0);
  page.player.classList.add("ad-showing");
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  assert.equal(page.video.muted, true);
  assert.deepEqual(page.log.times, [20]);
  page.player.classList.remove("ad-showing");
  await new Promise(function (resolve) { setTimeout(resolve, 10); });
  assert.equal(page.video.muted, false);
  assert.equal(intervals, 0);
  assert.deepEqual(page.log.seekTo, []);
  assert.equal(page.log.pause, 0);
  win.close();
});
