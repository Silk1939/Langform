const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const shortcuts = require("../extension/src/playback-shortcuts.js");

const rect = (left = 0, top = 100, width = 640, height = 360) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});

function media(win, video, options = {}) {
  let time = options.time ?? 30;
  let source = options.source || "https://media.example.test/main.mp4";
  const calls = { play: 0, pause: 0, seek: [] };
  Object.defineProperties(video, {
    currentSrc: { configurable: true, get: () => source },
    readyState: { configurable: true, writable: true, value: 4 },
    paused: { configurable: true, writable: true, value: options.paused ?? true },
    ended: { configurable: true, writable: true, value: false },
    duration: { configurable: true, writable: true, value: 120 },
    videoWidth: { configurable: true, value: 1920 },
    videoHeight: { configurable: true, value: 1080 },
    playbackRate: { configurable: true, writable: true, value: options.rate ?? 1 },
    currentTime: {
      configurable: true,
      get: () => time,
      set: value => { calls.seek.push(value); time = value; },
    },
    seekable: {
      configurable: true,
      writable: true,
      value: { length: 0, start: () => 0, end: () => 120 },
    },
  });
  video.getBoundingClientRect = () => rect();
  video.play = () => {
    calls.play += 1;
    video.paused = false;
    video.dispatchEvent(new win.Event("play", { bubbles: true }));
    return Promise.resolve();
  };
  video.pause = () => {
    calls.pause += 1;
    video.paused = true;
    video.dispatchEvent(new win.Event("pause", { bubbles: true }));
  };
  return { video, calls, setSource: value => { source = value; } };
}

function setup(t, options = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="movie_player"><video></video></div><div id="preview"><video></video></div><div id="outside" tabindex="0"></div></body></html>',
    {
      url: options.url || "https://www.youtube.com/watch?v=abcdefghijk",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    },
  );
  const win = dom.window;
  const doc = win.document;
  const root = doc.getElementById("movie_player");
  root.getBoundingClientRect = () => rect();
  const main = media(win, root.querySelector("video"), options);
  const preview = media(win, doc.querySelector("#preview video"), {
    paused: false, source: "https://media.example.test/preview.mp4",
  });
  const errors = [];
  win.addEventListener("error", event => { errors.push(event.message); event.preventDefault(); });
  t.after(() => { assert.deepEqual(errors, []); win.close(); });
  if (options.install !== false) shortcuts.install(win);
  function key(type, keyValue, extra = {}, target = doc.body) {
    const event = new win.KeyboardEvent(type, {
      key: keyValue,
      code: `Key${keyValue.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
      composed: true,
      ...extra,
    });
    target.dispatchEvent(event);
    return event;
  }
  function press(keyValue, extra = {}, target = doc.body) {
    const event = key("keydown", keyValue, extra, target);
    key("keyup", keyValue, extra, target);
    return event;
  }
  return { win, doc, root, ...main, preview, key, press };
}

test("D starts paused media at 1x and doubles subsequent playback up to an 8x cap", t => {
  const s = setup(t, { rate: 1.75 });
  for (const rate of [1, 2, 4, 8, 8, 8]) {
    assert.equal(s.press("d").defaultPrevented, true);
    assert.equal(s.video.paused, false);
    assert.equal(s.video.playbackRate, rate);
  }
  assert.equal(s.calls.play, 1, "only the initial paused D needs a play request");
  assert.equal(s.preview.video.playbackRate, 1);
  assert.equal(s.preview.calls.play, 0);
});

test("the first D on already playing media doubles its actual rate without an earlier D sequence", t => {
  for (const [before, after] of [[0.25, 0.5], [0.75, 1.5], [1, 2], [1.5, 3], [3, 6], [4, 8], [8, 8], [16, 8]]) {
    const s = setup(t, { paused: false, rate: before });
    assert.equal(s.press("d").defaultPrevented, true);
    assert.equal(s.video.paused, false);
    assert.equal(s.video.playbackRate, after, `playing at ${before}x`);
    assert.equal(s.calls.play, 0);
    assert.deepEqual(s.calls.seek, []);
  }
});

test("D on ended media restores normal speed and issues a play request", t => {
  const s = setup(t, { paused: true, rate: 8 });
  s.video.ended = true;
  assert.equal(s.press("d").defaultPrevented, true);
  assert.equal(s.video.playbackRate, 1);
  assert.equal(s.video.paused, false);
  assert.equal(s.calls.play, 1);
  assert.deepEqual(s.calls.seek, []);
});

test("holding D never advances speed and unfinished play requests remain at 1x while still paused", t => {
  const s = setup(t);
  s.key("keydown", "d");
  assert.equal(s.key("keydown", "d", { repeat: true }).defaultPrevented, false);
  assert.equal(s.video.playbackRate, 1);
  s.key("keyup", "d");
  s.press("d");
  assert.equal(s.video.playbackRate, 2);
  const pending = setup(t);
  pending.video.play = () => { pending.calls.play += 1; return Promise.resolve(); };
  for (let count = 0; count < 4; count += 1) {
    pending.press("d");
    assert.equal(pending.video.paused, true);
    assert.equal(pending.video.playbackRate, 1, "actual paused state controls D even while a play request is outstanding");
    assert.equal(pending.key("keydown", "d", { repeat: true }).defaultPrevented, false);
    assert.equal(pending.video.playbackRate, 1);
  }
  assert.equal(pending.calls.play, 4);
  pending.press("s");
  pending.press("d");
  assert.equal(pending.video.playbackRate, 1);
});

test("S immediately pauses and restores 1x even when media was already paused", t => {
  for (const paused of [false, true]) {
    const s = setup(t, { paused, rate: 8 });
    s.video.pause = () => { s.calls.pause += 1; s.video.paused = true; };
    assert.equal(s.press("s").defaultPrevented, true);
    assert.equal(s.video.paused, true);
    assert.equal(s.video.playbackRate, 1, "S resets speed before any asynchronous native pause event");
    assert.equal(s.calls.pause, 1);
    s.press("d");
    assert.equal(s.video.paused, false);
    assert.equal(s.video.playbackRate, 1);
  }
});

test("A halves playing speeds down to 1x without seeking, pausing or requesting playback", t => {
  for (const [before, after] of [[8, 4], [4, 2], [2, 1], [1.5, 1], [1.1, 1]]) {
    const s = setup(t, { paused: false, rate: before });
    assert.equal(s.press("a").defaultPrevented, true);
    assert.equal(s.video.playbackRate, after);
    assert.equal(s.video.paused, false);
    assert.deepEqual(s.calls.seek, []);
    assert.equal(s.calls.play, 0);
    assert.equal(s.calls.pause, 0);
  }
});

test("A at 1x or while paused seeks five seconds back and preserves media state", t => {
  for (const paused of [false, true]) {
    for (const rate of paused ? [1, 4] : [1]) {
      const s = setup(t, { paused, rate });
      assert.equal(s.press("a").defaultPrevented, true);
      assert.deepEqual(s.calls.seek, [25]);
      assert.equal(s.video.paused, paused);
      assert.equal(s.video.playbackRate, rate);
      assert.equal(s.calls.play, 0);
      assert.equal(s.calls.pause, 0);
    }
  }
});

test("A clamps at zero or the currently available seekable boundary", t => {
  const zero = setup(t, { time: 3 });
  zero.press("a");
  assert.equal(zero.video.currentTime, 0);
  const live = setup(t, { time: 12 });
  live.video.seekable = { length: 1, start: () => 10, end: () => 100 };
  live.press("a");
  assert.equal(live.video.currentTime, 10);
});

test("D after A follows the actual playing speed instead of restarting a stale sequence", t => {
  const s = setup(t, { paused: false, rate: 8 });
  s.press("a");
  assert.equal(s.video.playbackRate, 4);
  s.press("d");
  assert.equal(s.video.playbackRate, 8);
  for (const expected of [4, 2, 1]) {
    s.press("a");
    assert.equal(s.video.playbackRate, expected);
    assert.deepEqual(s.calls.seek, []);
  }
  s.press("a");
  assert.deepEqual(s.calls.seek, [25]);
  assert.equal(s.video.playbackRate, 1);
  s.press("d");
  assert.equal(s.video.playbackRate, 2);
});

test("a main media pause through Space, click or external controls restores 1x without a prior D", t => {
  for (const cause of ["space", "click", "external", "already-paused-event"]) {
    const s = setup(t, { paused: false, rate: 8 });
    if (cause === "space") {
      s.doc.body.addEventListener("keydown", event => {
        if (event.key === " ") s.video.pause();
      });
      assert.equal(s.press(" ").defaultPrevented, false);
    } else if (cause === "click") {
      const control = s.doc.createElement("button");
      control.onclick = () => s.video.pause();
      s.root.append(control);
      control.click();
    } else if (cause === "external") {
      s.video.pause();
    } else {
      s.video.paused = true;
      s.video.dispatchEvent(new s.win.Event("pause"));
    }
    assert.equal(s.video.paused, true, cause);
    assert.equal(s.video.playbackRate, 1, cause);
    assert.equal(s.calls.play, 0, cause);
    assert.deepEqual(s.calls.seek, [], cause);
    s.press("d");
    assert.equal(s.video.paused, false, cause);
    assert.equal(s.video.playbackRate, 1, cause);
  }
});

test("preview, ad, unavailable and navigating media pause events cannot change playback speed", t => {
  for (const condition of ["preview", "ad", "hidden", "unloaded", "zero-size", "missing-player", "not-watch", "navigating"]) {
    const s = setup(t, { paused: false, rate: 4 });
    let video = s.video;
    if (condition === "preview") { video = s.preview.video; video.playbackRate = 4; }
    if (condition === "ad") s.root.classList.add("ad-showing");
    if (condition === "hidden") s.root.hidden = true;
    if (condition === "unloaded") s.video.readyState = 0;
    if (condition === "zero-size") s.video.getBoundingClientRect = () => rect(0, 100, 0, 0);
    if (condition === "missing-player") s.root.removeAttribute("id");
    if (condition === "not-watch") s.win.history.replaceState({}, "", "/");
    if (condition === "navigating") s.win.dispatchEvent(new s.win.Event("yt-navigate-start"));
    video.pause();
    assert.equal(video.paused, true, condition);
    assert.equal(video.playbackRate, 4, condition);
    assert.equal(s.video.playbackRate, 4, condition);
    assert.deepEqual(s.calls.seek, [], condition);
  }
});

test("an asynchronously queued pause event cannot reset playback resumed by quick D presses", async t => {
  const s = setup(t, { paused: false, rate: 8 });
  let delivered;
  const pausedEvent = new Promise(resolve => { delivered = resolve; });
  s.video.pause = () => {
    s.calls.pause += 1;
    s.video.paused = true;
    setImmediate(() => {
      s.video.dispatchEvent(new s.win.Event("pause"));
      delivered();
    });
  };
  s.press("s");
  assert.equal(s.video.playbackRate, 1);
  s.press("d");
  s.press("d");
  assert.equal(s.video.paused, false);
  assert.equal(s.video.playbackRate, 2);
  await pausedEvent;
  assert.equal(s.video.paused, false);
  assert.equal(s.video.playbackRate, 2);
  s.press("d");
  assert.equal(s.video.playbackRate, 4);
});

test("a queued old-source pause event cannot reset a new running source", async t => {
  const s = setup(t, { paused: false, rate: 8 });
  s.video.paused = true;
  const pausedEvent = new Promise(resolve => setImmediate(() => {
    s.video.dispatchEvent(new s.win.Event("pause"));
    resolve();
  }));
  s.setSource("https://media.example.test/replacement.mp4");
  s.video.dispatchEvent(new s.win.Event("loadstart"));
  s.video.playbackRate = 4;
  s.video.paused = false;
  s.video.dispatchEvent(new s.win.Event("play"));
  await pausedEvent;
  assert.equal(s.video.playbackRate, 4);
  assert.equal(s.video.paused, false);
  assert.equal(s.calls.pause, 0);
  assert.equal(s.calls.play, 0);
  assert.deepEqual(s.calls.seek, []);
  s.press("d");
  assert.equal(s.video.playbackRate, 8);
});

test("a formerly active video pause cannot reset its replacement player", t => {
  const s = setup(t, { paused: false, rate: 8 });
  const replacement = s.doc.createElement("video");
  const next = media(s.win, replacement, { paused: true, rate: 4 });
  s.doc.getElementById("outside").append(s.video);
  s.root.append(replacement);
  s.video.pause();
  assert.equal(s.video.playbackRate, 8);
  assert.equal(next.video.playbackRate, 4);
  assert.equal(next.calls.pause, 0);
  assert.equal(next.calls.play, 0);
  assert.deepEqual(next.calls.seek, []);
});

test("the shortcut is limited to YouTube watch routes on desktop and mobile", t => {
  for (const url of [
    "https://www.youtube.com/",
    "https://www.youtube.com/shorts/abcdefghijk",
    "https://www.youtube.com/results?search_query=test",
    "https://example.test/watch?v=abcdefghijk",
    "https://www.youtube.com.example.test/watch?v=abcdefghijk",
  ]) {
    const s = setup(t, { url });
    for (const key of ["d", "s", "a"]) assert.equal(s.press(key).defaultPrevented, false, url);
    assert.equal(s.calls.play, 0, url);
    assert.equal(s.calls.pause, 0, url);
    assert.deepEqual(s.calls.seek, [], url);
  }
  const mobile = setup(t, { url: "https://m.youtube.com/watch?v=abcdefghijk" });
  mobile.root.removeAttribute("id");
  const player = mobile.doc.createElement("ytm-player");
  player.getBoundingClientRect = () => rect();
  mobile.root.replaceWith(player);
  player.append(mobile.root);
  mobile.press("d");
  assert.equal(mobile.video.paused, false);
});

test("an unavailable or hidden main player cannot fall back to a preview video", t => {
  for (const condition of ["unloaded", "hidden", "hidden-ancestor", "zero-size", "missing-player"]) {
    const s = setup(t);
    if (condition === "unloaded") s.video.readyState = 0;
    if (condition === "hidden") s.root.style.display = "none";
    if (condition === "hidden-ancestor") s.doc.body.style.visibility = "hidden";
    if (condition === "zero-size") s.video.getBoundingClientRect = () => rect(0, 100, 0, 0);
    if (condition === "missing-player") s.root.removeAttribute("id");
    for (const key of ["d", "s", "a"]) assert.equal(s.press(key).defaultPrevented, false, condition);
    assert.equal(s.calls.play, 0, condition);
    assert.equal(s.calls.pause, 0, condition);
    assert.deepEqual(s.calls.seek, [], condition);
    assert.deepEqual(s.preview.calls.seek, [], condition);
  }
});

test("ad playback ignores D, S and A", t => {
  const s = setup(t);
  s.root.classList.add("ad-showing");
  for (const key of ["d", "s", "a"]) assert.equal(s.press(key).defaultPrevented, false);
  assert.equal(s.calls.play, 0);
  assert.equal(s.calls.pause, 0);
  assert.deepEqual(s.calls.seek, []);
});

test("modifiers, composition, repeats, prevented events and active modals retain normal input", t => {
  const s = setup(t);
  for (const extra of [
    { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true },
    { isComposing: true }, { keyCode: 229 }, { repeat: true },
  ]) {
    for (const key of ["d", "s", "a"]) assert.equal(s.press(key, extra).defaultPrevented, false);
  }
  const prevented = new s.win.KeyboardEvent("keydown", { key: "d", bubbles: true, cancelable: true });
  prevented.preventDefault();
  s.doc.body.dispatchEvent(prevented);
  s.key("keyup", "d");
  assert.equal(s.press("x").defaultPrevented, false);
  assert.equal(s.calls.play, 0);
  assert.equal(s.calls.pause, 0);
  assert.deepEqual(s.calls.seek, []);
  for (const markup of ['<dialog open></dialog>', '<div role="dialog" aria-modal="true"></div>']) {
    const holder = s.doc.createElement("div");
    holder.innerHTML = markup;
    s.doc.body.append(holder);
    for (const key of ["d", "s", "a"]) assert.equal(s.press(key).defaultPrevented, false, markup);
    holder.remove();
  }
  const hidden = s.doc.createElement("div");
  hidden.setAttribute("aria-modal", "true");
  hidden.style.display = "none";
  s.doc.body.append(hidden);
  assert.equal(s.press("d").defaultPrevented, true, "an inactive hidden modal does not own keyboard input");
  assert.equal(s.calls.play, 1);
});

test("typing targets including custom textboxes and their children never control playback", t => {
  const s = setup(t);
  for (const markup of [
    '<input type="search">', '<textarea></textarea>', '<select><option>D</option></select>',
    '<div contenteditable="true"><span>Editable</span></div>',
    '<div role="textbox"><span>Search</span></div>',
    '<div role="combobox"><span>Search</span></div>',
  ]) {
    const host = s.doc.createElement("div");
    host.innerHTML = markup;
    s.doc.body.append(host);
    const target = host.querySelector("span") || host.firstElementChild;
    for (const key of ["d", "s", "a"]) assert.equal(s.press(key, {}, target).defaultPrevented, false, markup);
    host.remove();
  }
  assert.equal(s.calls.play, 0);
  assert.equal(s.calls.pause, 0);
  assert.deepEqual(s.calls.seek, []);
});

test("focused search fields and shadow-root typing are guarded even when events target the body", t => {
  const s = setup(t);
  const input = s.doc.createElement("input");
  s.doc.body.append(input);
  input.focus();
  assert.equal(s.press("d").defaultPrevented, false);
  input.blur();
  const host = s.doc.createElement("div");
  s.doc.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const shadowInput = s.doc.createElement("input");
  shadow.append(shadowInput);
  shadowInput.focus();
  for (const key of ["d", "s", "a"]) {
    assert.equal(s.press(key).defaultPrevented, false);
    assert.equal(s.press(key, {}, shadowInput).defaultPrevented, false);
  }
  assert.equal(s.calls.play, 0);
  assert.equal(s.calls.pause, 0);
  assert.deepEqual(s.calls.seek, []);
});

test("source, SPA route and player replacement use the new media state without old sequence memory", t => {
  for (const condition of ["source", "route", "player"]) {
    const s = setup(t, { paused: false, rate: 4 });
    s.press("d");
    assert.equal(s.video.playbackRate, 8);
    if (condition === "source") s.setSource("https://media.example.test/replacement.mp4");
    if (condition === "route") s.win.history.replaceState({}, "", "/watch?v=lmnopqrstuv");
    if (condition === "player") {
      const root = s.doc.createElement("div");
      root.id = "movie_player";
      root.getBoundingClientRect = () => rect();
      s.root.replaceWith(root);
      root.append(s.video);
    }
    s.video.playbackRate = 1.5;
    s.press("d");
    assert.equal(s.video.playbackRate, 3, condition);
    s.video.paused = true;
    s.video.playbackRate = 8;
    s.press("d");
    assert.equal(s.video.playbackRate, 1, condition);
    assert.equal(s.video.paused, false, condition);
  }
});

test("a rejected speed setter preserves the actual state and a later D uses that rate", t => {
  const s = setup(t);
  let rate = 1;
  let rejectHighRates = true;
  Object.defineProperty(s.video, "playbackRate", {
    configurable: true,
    get: () => rate,
    set: value => {
      if (rejectHighRates && value > 4) throw new s.win.DOMException("Unsupported playback rate", "NotSupportedError");
      rate = value;
    },
  });
  for (const expected of [1, 2, 4]) {
    s.press("d");
    assert.equal(s.video.playbackRate, expected);
  }
  assert.equal(s.press("d").defaultPrevented, false);
  assert.equal(s.video.playbackRate, 4);
  assert.equal(s.video.paused, false);
  const callsBeforeRetry = s.calls.play;
  assert.equal(s.press("d").defaultPrevented, false);
  assert.equal(s.calls.play, callsBeforeRetry, "failed speed assignment must not issue another play request");
  assert.deepEqual(s.calls.seek, []);
  rejectHighRates = false;
  for (const expected of [8, 8]) {
    s.press("d");
    assert.equal(s.video.playbackRate, expected);
  }
});

test("repeated installation and repeated browser script evaluation cannot double-seek", t => {
  const s = setup(t);
  shortcuts.install(s.win);
  shortcuts.install(s.win);
  s.press("a");
  assert.deepEqual(s.calls.seek, [25]);
  const source = fs.readFileSync(path.join(__dirname, "../extension/src/playback-shortcuts.js"), "utf8");
  const browser = setup(t, { install: false });
  browser.win.eval(source);
  browser.win.eval(source);
  browser.press("a");
  assert.deepEqual(browser.calls.seek, [25]);
  browser.press("a");
  assert.deepEqual(browser.calls.seek, [25, 20]);
});

test("a rejected play request is handled and a later D retries at normal speed", async t => {
  const s = setup(t);
  s.video.play = () => { s.calls.play += 1; return Promise.reject(new Error("Playback denied")); };
  s.press("d");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.video.paused, true);
  assert.equal(s.video.playbackRate, 1);
  s.video.play = () => { s.calls.play += 1; s.video.paused = false; return Promise.resolve(); };
  s.press("d");
  assert.equal(s.calls.play, 2);
  assert.equal(s.video.playbackRate, 1);
  assert.equal(s.video.paused, false);
});
