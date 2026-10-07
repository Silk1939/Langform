const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const appDir = path.join(__dirname, "..", "ios/Langform/Langform");
const LINKS = fs.readFileSync(path.join(appDir, "WebViewLinks.js"), "utf8");
const RECT = fs.readFileSync(path.join(appDir, "PlayerRect.js"), "utf8");

function page(html, url, handlers) {
  const dom = new JSDOM(html, { url: url, runScripts: "outside-only" });
  const posts = [];
  const messageHandlers = {};
  handlers.forEach(function (name) {
    messageHandlers[name] = {
      postMessage: function (body) {
        posts.push({ name: name, body: JSON.parse(JSON.stringify(body)) });
      },
    };
  });
  dom.window.webkit = { messageHandlers: messageHandlers };
  return { dom: dom, posts: posts };
}

function tap(dom, el) {
  const event = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
  el.dispatchEvent(event);
  return event;
}

test("ein Tipp auf ein Video im Feed geht an die Player-Ansicht, der Feed bleibt stehen", function () {
  const { dom, posts } = page(
    `<!DOCTYPE html><body>
      <ytm-video-with-context-renderer>
        <a id="thumb" href="/watch?v=abcdefghijk"><img id="img"></a>
        <button data-langform-kurz="abcdefghijk" id="kurz">Kurzfassung</button>
        <a id="channel" href="/@kanal">Kanal</a>
      </ytm-video-with-context-renderer>
    </body>`,
    "https://m.youtube.com/",
    ["langformOpenWatch"]
  );
  dom.window.eval(LINKS);
  let youtubeSaw = 0;
  dom.window.document.addEventListener("click", function () { youtubeSaw += 1; });

  const event = tap(dom, dom.window.document.getElementById("img"));
  assert.equal(event.defaultPrevented, true);
  assert.equal(youtubeSaw, 0);
  assert.deepEqual(posts, [{ name: "langformOpenWatch", body: { href: "https://m.youtube.com/watch?v=abcdefghijk" } }]);
  assert.equal(dom.window.location.href, "https://m.youtube.com/");

  // Kurzfassung and channels stay in the feed.
  assert.equal(tap(dom, dom.window.document.getElementById("kurz")).defaultPrevented, false);
  assert.equal(tap(dom, dom.window.document.getElementById("channel")).defaultPrevented, false);
  assert.equal(posts.length, 1);
});

test("im Player bleiben Videos und Zeitstempel dort, Kanal und Startseite gehen an den Feed", function () {
  const { dom, posts } = page(
    `<!DOCTYPE html><body>
      <a id="next" href="/watch?v=zyxwvutsrqp">Nächstes Video</a>
      <a id="stamp" href="/watch?v=abcdefghijk&amp;t=83s">1:23</a>
      <a id="channel" href="/@kanal">Kanal</a>
      <a id="home" href="/">YouTube</a>
      <a id="hash" href="#comments">Kommentare</a>
    </body>`,
    "https://m.youtube.com/watch?v=abcdefghijk",
    ["langformOpenFeed"]
  );
  dom.window.eval(LINKS);
  const doc = dom.window.document;
  assert.equal(tap(dom, doc.getElementById("next")).defaultPrevented, false);
  assert.equal(tap(dom, doc.getElementById("stamp")).defaultPrevented, false);
  assert.equal(tap(dom, doc.getElementById("hash")).defaultPrevented, false);
  assert.equal(posts.length, 0);
  assert.equal(tap(dom, doc.getElementById("channel")).defaultPrevented, true);
  assert.equal(tap(dom, doc.getElementById("home")).defaultPrevented, true);
  assert.deepEqual(
    posts.map(function (p) { return p.body.href; }),
    ["https://m.youtube.com/@kanal", "https://m.youtube.com/"]
  );
});

test("ohne Nachrichtenkanal fängt das Skript nichts ab", function () {
  const { dom } = page(
    `<!DOCTYPE html><body><a id="thumb" href="/watch?v=abcdefghijk">Video</a></body>`,
    "https://m.youtube.com/",
    []
  );
  dom.window.eval(LINKS);
  assert.equal(tap(dom, dom.window.document.getElementById("thumb")).defaultPrevented, false);
});

test("der Player meldet die Videofläche und ob es läuft, ohne das Video anzufassen", async function (t) {
  const { dom, posts } = page(
    `<!DOCTYPE html><body><div id="movie_player"><video id="v"></video></div></body>`,
    "https://m.youtube.com/watch?v=abcdefghijk",
    ["langformPlayer"]
  );
  t.after(function () { dom.window.close(); });
  const video = dom.window.document.getElementById("v");
  video.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: 390, height: 219.375, right: 390, bottom: 219.375 };
  };
  Object.defineProperty(video, "paused", { configurable: true, get: function () { return false; } });
  let paused = 0;
  video.pause = function () { paused += 1; };
  dom.window.eval(RECT);
  video.dispatchEvent(new dom.window.Event("playing"));
  await new Promise(function (resolve) { setTimeout(resolve, 200); });
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, {
    x: 0,
    y: 0,
    width: 390,
    height: 219.375,
    playing: true,
    hasVideo: true,
    painted: false,
    href: "https://m.youtube.com/watch?v=abcdefghijk",
  });

  // Same box, nothing new to say.
  video.dispatchEvent(new dom.window.Event("resize"));
  await new Promise(function (resolve) { setTimeout(resolve, 200); });
  assert.equal(posts.length, 1);

  const measured = dom.window.__langformMeasureVideo();
  assert.equal(measured.width, 390);
  assert.equal(measured.playing, true);
  assert.equal(paused, 0);
  assert.equal(video.getAttribute("style"), null);
});

test("ohne Watch-Seite meldet der Player eine leere Fläche, die keine Karte ergibt", function () {
  const { dom } = page(
    `<!DOCTYPE html><body><video id="v"></video></body>`,
    "https://m.youtube.com/@kanal",
    ["langformPlayer"]
  );
  dom.window.eval(RECT);
  const measured = dom.window.__langformMeasureVideo();
  assert.equal(measured.width, 0);
  assert.equal(measured.height, 0);
  assert.equal(measured.playing, false);
  dom.window.close();
});

test("der Player meldet den ersten gezeichneten Inhalt, damit die App ihn erst dann zeigt", async function (t) {
  const { dom, posts } = page(
    `<!DOCTYPE html><body><div id="movie_player"></div></body>`,
    "https://m.youtube.com/watch?v=abcdefghijk",
    ["langformPlayer"]
  );
  t.after(function () { dom.window.close(); });
  let fire = null;
  dom.window.PerformanceObserver = function (callback) {
    this.observe = function (options) {
      assert.equal(options.type, "paint");
      assert.equal(options.buffered, true);
      fire = function () { callback({ getEntries: function () { return [{ name: "first-contentful-paint" }]; } }); };
    };
  };
  dom.window.eval(RECT);
  assert.equal(dom.window.__langformMeasureVideo().painted, false);
  assert.equal(dom.window.__langformMeasureVideo().hasVideo, false);
  fire();
  await new Promise(function (resolve) { setTimeout(resolve, 200); });
  const last = posts[posts.length - 1].body;
  assert.equal(last.painted, true);
  assert.equal(last.hasVideo, false);
  assert.equal(last.href, "https://m.youtube.com/watch?v=abcdefghijk");
});
