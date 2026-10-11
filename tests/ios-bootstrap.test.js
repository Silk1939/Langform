const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const root = path.join(__dirname, "..");
const appDir = path.join(root, "ios/Langform/Langform");
const swift = fs.readFileSync(path.join(appDir, "YouTubeWebView.swift"), "utf8");

function scripts(player) {
  function names(property) {
    const match = swift.match(new RegExp("static let " + property + " = (\\[[^\\]]+\\])"));
    assert.ok(match, property + " muss aus der App gelesen werden");
    return JSON.parse(match[1]);
  }
  const order = player
    ? names("playerEarlyScriptNames").concat(names("scriptNames"), names("playerScriptNames"))
    : names("scriptNames").concat(names("feedOnlyScriptNames"));
  return order.map(function (name) {
    const shared = path.join(root, "extension/src", name + ".js");
    return fs.readFileSync(fs.existsSync(shared) ? shared : path.join(appDir, name + ".js"), "utf8");
  }).join("\n");
}

function page(t, html, url, channels) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", function (error) { errors.push(error.message); });
  const dom = new JSDOM(html, { url: url, runScripts: "outside-only", virtualConsole: virtualConsole });
  const win = dom.window;
  const posts = [];
  const messageHandlers = {};
  channels.forEach(function (name) {
    messageHandlers[name] = {
      postMessage(body) {
        posts.push({ name: name, body: JSON.parse(JSON.stringify(body)) });
      },
    };
  });
  win.webkit = { messageHandlers: messageHandlers };
  win.addEventListener("unhandledrejection", function (event) {
    errors.push(String(event.reason));
  });
  t.after(function () {
    win.dispatchEvent(new win.Event("pagehide"));
    win.close();
  });
  return { win: win, doc: win.document, posts: posts, errors: errors };
}

function tap(win, element) {
  const event = new win.MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
  element.dispatchEvent(event);
  return event;
}

test("Feed-Start und überlappende Navigation dekorieren vorhandene Karten nur einmal; neue Karten bleiben erreichbar", async function (t) {
  const rows = Array.from({ length: 100 }, function (_, index) {
    return '<ytm-video-with-context-renderer id="row-' + index + '"><a href="/watch?v=abcdefghij' + (index % 10) + '">Film</a>' +
      '<span class="compact-media-item-headline">Titel</span><span class="ytd-thumbnail-overlay-time-status-renderer">12:00</span></ytm-video-with-context-renderer>';
  });
  const feed = page(t, '<!DOCTYPE html><body><div id="feed-list">' + rows.join("") + '</div></body>',
    "https://m.youtube.com/", ["langformSummary", "langformOpenWatch", "langformNavigateFeed", "langformOverlayState"]);
  const win = feed.win, doc = feed.doc;
  let now = 10000, serial = 0, oldCardReads = 0, wholeScans = 0;
  const timers = new Map();
  win.Date.now = function () { return now; };
  win.setTimeout = function (fn, delay) {
    const id = ++serial;
    timers.set(id, { fn: fn, at: now + (delay || 0) });
    return id;
  };
  win.clearTimeout = function (id) { timers.delete(id); };
  win.setInterval = function () { assert.fail("Der Startseiten-Bundle darf keine Kapitel-Pollingintervalle starten"); };
  async function flush() { for (let i = 0; i < 6; i++) await Promise.resolve(); }
  async function advance(until) {
    await flush();
    let callbacks = 0;
    while (true) {
      const next = Array.from(timers).filter(function (entry) { return entry[1].at <= until; })
        .sort(function (a, b) { return a[1].at - b[1].at; })[0];
      if (!next) break;
      assert.ok(++callbacks < 1000, "Timerwarteschlange läuft aus");
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await flush();
    }
    now = until;
  }
  for (let i = 0; i < 100; i++) {
    const card = doc.getElementById("row-" + i), query = card.querySelectorAll.bind(card);
    card.querySelectorAll = function (selector) {
      // Count rowWatchHref's real shipping query, not a mocked decoration API.
      if (selector === "a[href]") oldCardReads++;
      return query(selector);
    };
  }
  // Same inactive prefix and complete script order used by makeWebView.
  win.eval("window.__langformFeedActive = false;\n" + scripts(false));
  const hide = win.ShortsAusblenden.hide, scan = hide.scan;
  hide.scan = function (rootNode) {
    if (rootNode === doc) wholeScans++;
    return scan.apply(this, arguments);
  };
  await advance(10000);
  assert.equal(oldCardReads, 0, "DocumentStart bleibt bis zur nativen Aktivierung ruhig");
  assert.equal(wholeScans, 0);
  win.__langformFeedActive = true;
  win.dispatchEvent(new win.Event("langform-feed-visibility"));
  await advance(10000);
  assert.equal(oldCardReads, 100);
  assert.equal(wholeScans, 1);
  assert.equal(doc.querySelectorAll("[data-langform-kurz]").length, 100);

  oldCardReads = wholeScans = 0;
  now = 10010;
  win.history.replaceState({}, "", "/");
  win.dispatchEvent(new win.Event("yt-navigate-finish"));
  await advance(10700);
  assert.equal(wholeScans, 1, "die Shorts-Prüfung behält ihre eigene Drosselung");
  assert.equal(oldCardReads, 100, "History und Navigation teilen dieselbe Kurzfassungsdekoration");

  oldCardReads = wholeScans = 0;
  now = 10710;
  win.history.replaceState({}, "", "/feed/subscriptions");
  await advance(11100);
  assert.equal(oldCardReads, 100, "History ohne YouTube-Ereignis behält seine notwendige Dekoration");
  assert.equal(wholeScans, 1);

  oldCardReads = 0;
  const card = doc.createElement("ytm-video-with-context-renderer");
  card.innerHTML = '<a href="/watch?v=zyxwvutsrqp">Neuer Film</a>';
  doc.getElementById("feed-list").appendChild(card);
  await advance(11150);
  assert.ok(card.querySelector('[data-langform-kurz="zyxwvutsrqp"]'));
  assert.equal(oldCardReads, 0, "inkrementelle neue Karten revisiten keinen unveränderten Feed");

  win.__langformFeedActive = false;
  win.dispatchEvent(new win.Event("langform-feed-visibility"));
  const hiddenCard = doc.createElement("ytm-video-with-context-renderer");
  hiddenCard.innerHTML = '<a href="/watch?v=qwertyuiopa">Während Tab verborgen</a>';
  doc.getElementById("feed-list").appendChild(hiddenCard);
  await advance(11300);
  assert.equal(hiddenCard.querySelector("[data-langform-kurz]"), null);
  assert.equal(oldCardReads, 0);
  win.__langformFeedActive = true;
  win.dispatchEvent(new win.Event("langform-feed-visibility"));
  await advance(12000);
  assert.ok(hiddenCard.querySelector('[data-langform-kurz="qwertyuiopa"]'));
  assert.equal(oldCardReads, 100, "dirty Wiederanzeigen dekoriert genau einmal");
  assert.equal(feed.posts.some(function (post) { return post.name === "langformSummary"; }), false,
    "Start und Navigation laden keine Untertitel oder Modellantworten");
  assert.deepEqual(feed.errors, []);
});

test("die vollständigen iPhone-Skripte filtern den Feed und reichen Links weiter, ohne die laufende Wiedergabe zu verändern", async function (t) {
  const feed = page(t,
    '<!DOCTYPE html><body><ytm-searchbox><input id="search" name="search_query" type="search"></ytm-searchbox>' +
      '<ytm-rich-item-renderer><a id="watch" href="/watch?v=abcdefghijk">Langes Video</a></ytm-rich-item-renderer>' +
      '<ytm-reel-shelf-renderer id="shorts"><a href="/shorts/shortvideo">Shorts</a></ytm-reel-shelf-renderer></body>',
    "https://m.youtube.com/", ["langformSummary", "langformOpenWatch"]
  );
  const feedSearch = feed.doc.getElementById("search");
  assert.doesNotThrow(function () { feed.win.eval(scripts(false)); });
  assert.equal(feed.doc.getElementById("shorts"), null);
  assert.equal(feed.doc.getElementById("search"), feedSearch);
  assert.ok(feed.doc.getElementById("shorts-ausblenden-style"));
  const feedHref = feed.win.location.href;
  const feedHistory = feed.win.history.length;
  assert.equal(tap(feed.win, feed.doc.getElementById("watch")).defaultPrevented, true);
  assert.deepEqual(feed.posts, [{
    name: "langformOpenWatch",
    body: { href: "https://m.youtube.com/watch?v=abcdefghijk" },
  }]);

  const player = page(t,
    '<!DOCTYPE html><body><ytm-searchbox><input id="search" name="search_query" type="search"></ytm-searchbox>' +
      '<div id="movie_player" class="html5-video-player"><video id="video"></video>' +
      '<div class="ytp-right-controls"><button id="cast" class="ytp-cast-button">Cast</button>' +
      '<button id="cc" class="ytp-subtitles-button">CC</button><button id="settings" class="ytp-settings-button">Einstellungen</button></div></div>' +
      '<ytm-slim-video-metadata-section-renderer><h1>Langes Video</h1></ytm-slim-video-metadata-section-renderer>' +
      '<ytm-reel-shelf-renderer id="shorts"><a href="/shorts/related">Shorts</a></ytm-reel-shelf-renderer></body>',
    feed.posts[0].body.href, ["langformSummary", "langformOpenFeed", "langformPlayer"]
  );
  const video = player.doc.getElementById("video");
  const originalControls = ["cast", "cc", "settings", "search"].map(function (id) { return player.doc.getElementById(id); });
  const controlMarkup = originalControls.map(function (element) { return element.outerHTML; });
  let currentTime = 37;
  const timeWrites = [];
  const seeks = [];
  let pauses = 0;
  Object.defineProperties(video, {
    paused: { get: function () { return false; } },
    ended: { get: function () { return false; } },
    duration: { get: function () { return 900; } },
    currentTime: {
      get: function () { return currentTime; },
      set: function (seconds) { timeWrites.push(seconds); currentTime = seconds; },
    },
  });
  video.pause = function () { pauses += 1; };
  video.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: 390, height: 219, right: 390, bottom: 219 };
  };
  player.doc.getElementById("movie_player").seekTo = function (seconds) { seeks.push(seconds); };
  player.win.ytInitialPlayerResponse = { videoDetails: { videoId: "abcdefghijk", lengthSeconds: "900" } };
  assert.doesNotThrow(function () { player.win.eval(scripts(true)); });
  video.dispatchEvent(new player.win.Event("playing"));
  player.win.history.pushState({}, "", "/watch?v=abcdefghijk&t=1");
  player.win.history.replaceState({}, "", "/watch?v=abcdefghijk&t=2");
  await new Promise(function (resolve) { setTimeout(resolve, 400); });

  assert.equal(video.currentTime, 37);
  assert.deepEqual(timeWrites, []);
  assert.deepEqual(seeks, []);
  assert.equal(pauses, 0);
  assert.equal(video.paused, false);
  assert.equal(video.muted, false);
  assert.equal(video.getAttribute("style"), null);
  assert.equal(player.doc.querySelectorAll("video").length, 1);
  assert.equal(player.doc.getElementById("video"), video);
  assert.equal(player.win.getComputedStyle(player.doc.getElementById("shorts")).display, "none");
  assert.ok(player.doc.querySelector('ytm-slim-video-metadata-section-renderer [data-langform-kurz="abcdefghijk"]'));
  assert.ok(player.posts.some(function (post) {
    return post.name === "langformPlayer" && post.body.playing && post.body.hasVideo && post.body.width === 390;
  }));

  // A second feed tap targets the existing player through the same hook used
  // by the native shell. Unlike YouTube's history writes, this is a user seek.
  feed.doc.getElementById("watch").setAttribute("href", "/watch?v=abcdefghijk&t=1m23s");
  assert.equal(tap(feed.win, feed.doc.getElementById("watch")).defaultPrevented, true);
  const timestamp = feed.posts[1];
  assert.equal(timestamp.name, "langformOpenWatch");
  const playerHref = player.win.location.href;
  const playerHistory = player.win.history.length;
  assert.equal(player.win.__langformSeekFromLink(timestamp.body.href), true);
  assert.deepEqual(seeks, [83]);
  assert.equal(player.win.location.href, playerHref);
  assert.equal(player.win.history.length, playerHistory);
  assert.equal(feed.win.location.href, feedHref);
  assert.equal(feed.win.history.length, feedHistory);
  assert.equal(pauses, 0);
  originalControls.forEach(function (element, index) {
    assert.equal(element.isConnected, true);
    assert.equal(element.outerHTML, controlMarkup[index]);
  });
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  assert.deepEqual(feed.errors, []);
  assert.deepEqual(player.errors, []);
});
