const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const appDir = path.join(__dirname, "../ios/Langform/Langform");
const rectScript = fs.readFileSync(path.join(appDir, "PlayerRect.js"), "utf8");
const linkScript = fs.readFileSync(path.join(appDir, "WebViewLinks.js"), "utf8");

function playerPage(t, withFrames = true, withLinks = false) {
  const dom = new JSDOM('<div id="movie_player"><video></video></div>', {
    url: "https://m.youtube.com/watch?v=abcdefghijk", runScripts: "outside-only",
  });
  t.after(function () { dom.window.close(); });
  const win = dom.window;
  const video = win.document.querySelector("video");
  const frames = new Map();
  const timers = new Map();
  const posts = [];
  const paintObservers = [];
  let serial = 0;
  let reads = 0;
  let top = 0;
  let playing = true;
  win.setTimeout = function (callback, delay) { const id = ++serial; timers.set(id, { callback, delay }); return id; };
  win.clearTimeout = function (id) { timers.delete(id); };
  win.visualViewport = new win.EventTarget();
  if (withFrames) {
    win.requestAnimationFrame = function (callback) { const id = ++serial; frames.set(id, callback); return id; };
    win.cancelAnimationFrame = function (id) { frames.delete(id); };
  }
  win.PerformanceObserver = function (callback) {
    const observer = { callback, disconnected: false };
    paintObservers.push(observer);
    this.observe = function () {};
    this.disconnect = function () { observer.disconnected = true; };
  };
  win.webkit = { messageHandlers: { langformPlayer: { postMessage: function (body) { posts.push(body); } } } };
  Object.defineProperty(video, "paused", { get: function () { return !playing; } });
  video.getBoundingClientRect = function () {
    reads += 1;
    return { left: 0, top, width: 390, height: 219 };
  };
  if (withLinks) win.eval(linkScript);
  win.eval(rectScript);
  return {
    win, video, frames, timers, posts, paintObservers,
    reads: function () { return reads; },
    setTop: function (value) { top = value; },
    setPlaying: function (value) { playing = value; },
    frame: function () {
      const callbacks = Array.from(frames.values());
      frames.clear();
      callbacks.forEach(function (callback) { callback(); });
    },
    timer: function () {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
    },
    emit: function (name) { video.dispatchEvent(new win.Event(name)); },
    paint: function (name) {
      paintObservers[paintObservers.length - 1].callback({ getEntries: function () { return [{ name }]; } });
    },
  };
}

test("der Player meldet Medienzustand im nächsten Bild und bündelt unveränderte Ereignisse", function (t) {
  const page = playerPage(t);
  ["loadedmetadata", "playing", "resize"].forEach(page.emit);
  assert.equal(page.frames.size, 1);
  assert.equal(page.timers.size, 0, "die erste Rückmeldung hat keine feste Wartezeit");
  assert.equal(page.reads(), 0, "Ereignisse messen nicht mehrfach synchron");
  page.frame();
  assert.equal(page.reads(), 1);
  assert.equal(page.posts.length, 1);
  assert.equal(page.posts[0].playing, true);

  page.win.__langformMeasureVideo();
  page.emit("resize");
  page.frame();
  assert.equal(page.posts.length, 1, "eine native Messung hebt die Deduplizierung nicht auf");
  page.setPlaying(false);
  page.emit("pause");
  page.frame();
  assert.equal(page.posts.length, 2);
  assert.equal(page.posts[1].playing, false);
});

test("Start und Medienereignisse bleiben beim Hauptplayer trotz früherer Videovorschau", function (t) {
  const page = interactivePlayer(t);
  const preview = page.doc.createElement("video");
  page.doc.body.insertBefore(preview, page.root);
  let previewPlays = 0;
  preview.play = function () { previewPlays++; return Promise.resolve(); };
  page.setPlaying(false);
  assert.equal(page.win.__langformPlay("abcdefghijk"), true);
  assert.equal(page.counts().plays, 1, "die explizite Anfrage startet das sichtbare Hauptmedium");
  assert.equal(previewPlays, 0, "eine frühere Vorschau ist nie das Startziel");
  page.emit("playing");
  page.frame();
  assert.equal(page.posts.at(-1).playing, true);
  const posts = page.posts.length;
  preview.dispatchEvent(new page.win.Event("pause"));
  page.frame();
  assert.equal(page.posts.length, posts, "Vorschauereignisse ändern den Hauptplayerstatus nicht");
});

test("ein verschwundener Hauptplayer lässt Start keine fremde Vorschau abspielen", function (t) {
  const page = interactivePlayer(t);
  const preview = page.doc.createElement("video");
  page.doc.body.appendChild(preview);
  let previewPlays = 0;
  preview.play = function () { previewPlays++; return Promise.resolve(); };
  page.win.__langformMeasureVideo();
  page.root.remove();
  assert.equal(page.win.__langformPlay("abcdefghijk"), false);
  assert.equal(page.win.__langformMeasureVideo().hasVideo, false);
  assert.equal(previewPlays, 0);
});

test("ein im DOM behaltenes altes Video verliert nach Reparenting die native Wiedergabesteuerung", function (t) {
  const page = interactivePlayer(t);
  page.setPlaying(false);
  page.win.__langformMeasureVideo();
  page.doc.body.appendChild(page.video);
  assert.equal(page.video.isConnected, true, "Hydration darf das alte Medium für den Übergang behalten");
  assert.equal(page.win.__langformPlay("abcdefghijk"), false, "ein Medium außerhalb des Hauptplayers ist kein Startziel");
  assert.equal(page.win.__langformMeasureVideo().hasVideo, false);
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });

  const replacement = page.doc.createElement("video");
  let playing = false, plays = 0, pauses = 0;
  Object.defineProperty(replacement, "paused", { get: () => !playing });
  replacement.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 219 });
  replacement.play = () => { plays++; playing = true; return Promise.resolve(); };
  replacement.pause = () => { pauses++; playing = false; };
  page.root.prepend(replacement);
  assert.equal(page.win.__langformPlay("abcdefghijk"), true);
  assert.equal(plays, 1, "ein nachgerücktes Hauptmedium wird erneut gefunden");
  assert.equal(page.win.__langformTogglePlayback("abcdefghijk"), true);
  assert.equal(pauses, 1);
  page.frame();
  const posts = page.posts.length, reads = page.reads();
  for (const name of ["playing", "pause", "waiting", "loadedmetadata"]) page.emit(name);
  page.frame();
  assert.equal(page.posts.length, posts, "verspätete Ereignisse des alten Videos bleiben ohne Wirkung");
  assert.equal(page.reads(), reads, "der alte Knoten wird nicht mehr vermessen");
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
});

test("Medienereignisse anderer Videoknoten planen keine Messung des Hauptplayers", function (t) {
  const page = playerPage(t);
  page.emit("playing");
  page.frame();
  const reads = page.reads();
  const posts = page.posts.length;
  const preview = page.win.document.createElement("video");
  page.win.document.body.appendChild(preview);
  for (let index = 0; index < 100; index += 1) {
    ["playing", "pause", "waiting", "loadeddata", "resize", "error"].forEach(function (name) {
      preview.dispatchEvent(new page.win.Event(name));
    });
    page.frame();
  }
  assert.equal(page.reads(), reads, "Vorschauen und abgelöste Medien sind keine Quelle für den Hauptplayer");
  assert.equal(page.frames.size, 0);
  assert.equal(page.timers.size, 0);
  page.frame();
  assert.equal(page.posts.length, posts);
  page.setPlaying(false);
  page.emit("pause");
  page.frame();
  assert.equal(page.posts.at(-1).playing, false, "echte Player-Ereignisse bleiben erreichbar");
});

function interactivePlayer(t, withToggle = true, withLinks = false) {
  const page = playerPage(t, true, withLinks);
  const doc = page.win.document;
  const root = doc.getElementById("movie_player");
  root.insertAdjacentHTML("beforeend", '<div id="player-control-overlay"><div class="player-controls-background" id="surface"></div>' +
    '<button id="play"><span id="play-icon">Play</span></button><div role="slider" id="scrubber"><span id="knob"></span></div>' +
    '<button id="langform-airplay"><span id="airplay-icon"></span></button><button id="chapter"><span id="chapter-title"></span></button>' +
    '<a href="/feed/subscriptions" id="player-link">Abos</a><div id="unknown-widget">Other control</div></div>' +
    (withToggle ? '<button id="player-controls-a11y-toggle"></button>' : ""));
  let controls = 0;
  let plays = 0;
  let pauses = 0;
  page.video.play = function () { plays += 1; page.setPlaying(true); return Promise.resolve(); };
  page.video.pause = function () { pauses += 1; page.setPlaying(false); };
  if (withToggle) doc.getElementById("player-controls-a11y-toggle").addEventListener("click", function (event) {
    controls += 1;
    event.stopPropagation();
  });
  doc.getElementById("play").addEventListener("click", function (event) {
    page.video.play();
    event.stopPropagation();
  });
  // Model the observed mobile YouTube mouse-like click path, so a leaked
  // surface click would demonstrably change playback in either state.
  doc.getElementById("player-control-overlay").addEventListener("click", function (event) {
    if (event.target.id !== "surface") return;
    if (page.video.paused) page.video.play(); else page.video.pause();
  });
  return Object.assign(page, {
    root, doc,
    counts: function () { return { controls, plays, pauses }; },
    click: function (id) {
      const event = new page.win.MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
      doc.getElementById(id).dispatchEvent(event);
      return event;
    },
  });
}

test("freie Videotaps ändern laufend und pausiert nur YouTubes eigene Controls", function (t) {
  const page = interactivePlayer(t);
  [true, false].forEach(function (playing) {
    page.setPlaying(playing);
    assert.equal(page.click("surface").defaultPrevented, true);
    assert.equal(page.video.paused, !playing);
    assert.equal(page.click("player-control-overlay").defaultPrevented, true);
    assert.equal(page.video.paused, !playing);
  });
  assert.deepEqual(page.counts(), { controls: 4, plays: 0, pauses: 0 });
  assert.equal(page.doc.querySelectorAll("video").length, 1);
  assert.equal(page.video.getAttribute("style"), null);
});

test("Play-Button, Scrubber, Kapitel, AirPlay, Links und unbekannte Controls behalten ihre Klicks", function (t) {
  const page = interactivePlayer(t);
  page.setPlaying(false);
  assert.equal(page.click("play-icon").defaultPrevented, false);
  assert.equal(page.video.paused, false);
  ["knob", "chapter-title", "airplay-icon", "player-link", "unknown-widget"].forEach(function (id) {
    let reached = false;
    page.doc.getElementById(id).addEventListener("click", function (event) {
      reached = !event.defaultPrevented;
      event.preventDefault();
    });
    page.click(id);
    assert.equal(reached, true, id);
  });
  assert.deepEqual(page.counts(), { controls: 0, plays: 1, pauses: 0 });
});

test("freie Videotaps pausieren auch während der Hydration ohne Controls-Toggle nicht", function (t) {
  const page = interactivePlayer(t, false);
  for (const playing of [true, false]) {
    page.setPlaying(playing);
    assert.equal(page.click("surface").defaultPrevented, true);
    assert.equal(page.click("player-control-overlay").defaultPrevented, true);
    assert.equal(page.video.paused, !playing);
  }
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
  assert.equal(page.doc.getElementById("player-controls-a11y-toggle"), null);
  page.click("play-icon");
  assert.equal(page.video.paused, false, "der tatsächliche Play-Button funktioniert auch ohne Controls-Toggle");
  assert.deepEqual(page.counts(), { controls: 0, plays: 1, pauses: 0 });
});

test("ein nicht bedienbarer Controls-Toggle lässt freie Taps nicht zu Play/Pause durchfallen", function (t) {
  const page = interactivePlayer(t);
  const button = page.doc.getElementById("player-controls-a11y-toggle");
  button.disabled = true;
  assert.equal(page.click("surface").defaultPrevented, true);
  button.disabled = false;
  button.click = function () { throw new Error("detached control"); };
  assert.equal(page.click("surface").defaultPrevented, true);
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
});

test("nur der explizite native Button toggelt das aktuelle Video; veraltete Seiten und Drag sind geschützt", function (t) {
  const page = interactivePlayer(t);
  const toggle = page.win.__langformTogglePlayback;
  assert.equal(toggle("other-video"), false);
  assert.equal(toggle("abcdefghijk"), true);
  assert.equal(page.video.paused, true);
  assert.equal(toggle("abcdefghijk"), true);
  assert.equal(page.video.paused, false);
  assert.deepEqual(page.counts(), { controls: 0, plays: 1, pauses: 1 });

  const playerCalls = [];
  page.root.getVideoData = function () { return { video_id: "old-video" }; };
  page.root.pauseVideo = function () { playerCalls.push("pause"); };
  page.root.playVideo = function () { playerCalls.push("play"); };
  assert.equal(toggle("abcdefghijk"), false, "alte Medien nach SPA-URL-Wechsel bleiben unberührt");
  page.root.getVideoData = function () { return { video_id: "abcdefghijk" }; };
  assert.equal(toggle("abcdefghijk"), true);
  page.setPlaying(false);
  assert.equal(toggle("abcdefghijk"), true);
  assert.deepEqual(playerCalls, ["pause", "play"], "bevorzugt vorhandene YouTube-Player-API");
  assert.deepEqual(page.counts(), { controls: 0, plays: 1, pauses: 1 }, "kein zusätzlicher direkter Videoaufruf");

  assert.equal(page.win.__langformSetNativeDragging(true, "abcdefghijk"), true);
  assert.equal(toggle("abcdefghijk"), false);
  page.emit("pause");
  page.frame();
  page.win.__langformSetNativeDragging(false, "abcdefghijk");
  assert.deepEqual(playerCalls, ["pause", "play"], "kein automatisches Wiederanlaufen nach Drag oder Medienereignis");
  page.win.dispatchEvent(new page.win.Event("pagehide"));
  assert.equal(toggle("abcdefghijk"), false);
});

test("native Drags blockieren nur Restklicks, lassen Touch-Cleanup und den nächsten echten Tap durch", function (t) {
  const page = interactivePlayer(t);
  let now = 1000;
  page.win.Date.now = function () { return now; };
  const setDragging = page.win.__langformSetNativeDragging;
  assert.equal(setDragging(true, "old-video"), false);
  assert.equal(page.click("surface").defaultPrevented, true);
  assert.equal(page.counts().controls, 1);
  setDragging(true, "abcdefghijk");
  assert.equal(page.click("surface").defaultPrevented, true);
  let cancelled = 0;
  ["touchend", "touchcancel"].forEach(function (name) {
    page.doc.getElementById("surface").addEventListener(name, function () { cancelled += 1; });
    page.doc.getElementById("surface").dispatchEvent(new page.win.Event(name, { bubbles: true, cancelable: true }));
  });
  assert.equal(cancelled, 2, "YouTube muss seinen Long-Press-Timer aufräumen können");
  setDragging(false, "old-video");
  assert.equal(page.win.__langformTogglePlayback("abcdefghijk"), false, "altes Drag-Ende beendet keinen aktuellen Drag");
  setDragging(false, "abcdefghijk");
  page.click("surface");
  assert.deepEqual(page.counts(), { controls: 1, plays: 0, pauses: 0 });
  now += 451;
  setDragging(false, "abcdefghijk");
  page.click("surface");
  assert.equal(page.counts().controls, 2, "wiederholtes Drag-Ende verlängert die Sperre nicht");
  ["pointerdown", "touchstart"].forEach(function (name) {
    setDragging(true, "abcdefghijk");
    setDragging(false, "abcdefghijk");
    page.doc.getElementById("surface").dispatchEvent(new page.win.Event(name, { bubbles: true }));
    page.click("surface");
  });
  assert.deepEqual(page.counts(), { controls: 4, plays: 0, pauses: 0 }, "ein neuer Finger muss nicht 450ms warten");
  setDragging(true, "abcdefghijk");
  page.win.history.replaceState({}, "", "/watch?v=lmnopqrstuv");
  page.win.dispatchEvent(new page.win.Event("state-navigateend"));
  assert.equal(setDragging(false, "abcdefghijk"), false);
  assert.equal(page.win.__langformTogglePlayback("lmnopqrstuv"), true, "mweb-Navigation löst den Drag der vorherigen Seite");
});

test("eine abgelehnte explizite Play-Anfrage ändert keinen gemeldeten Wiedergabestatus", async function (t) {
  const page = interactivePlayer(t);
  page.setPlaying(false);
  page.video.play = function () { return Promise.reject(new Error("NotAllowedError")); };
  assert.equal(page.win.__langformTogglePlayback("abcdefghijk"), true);
  await Promise.resolve();
  assert.equal(page.video.paused, true);
  assert.equal(page.win.__langformMeasureVideo().playing, false);
  assert.deepEqual(page.posts, [], "keine optimistische playing-Meldung");
});

test("die früher installierte Link-Brücke lässt nach Drag keine versehentliche Player-Navigation durch", function (t) {
  const page = interactivePlayer(t, true, true);
  const navigations = [];
  page.win.webkit.messageHandlers.langformOpenFeed = { postMessage: function (body) { navigations.push(body); } };
  page.win.__langformSetNativeDragging(true, "abcdefghijk");
  page.win.__langformSetNativeDragging(false, "abcdefghijk");
  assert.equal(page.click("player-link").defaultPrevented, true);
  assert.deepEqual(navigations, []);
  page.doc.getElementById("player-link").dispatchEvent(new page.win.Event("pointerdown", { bubbles: true }));
  assert.equal(page.click("player-link").defaultPrevented, true);
  assert.equal(navigations.length, 1);
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
});

test("bei offenem Menü bleibt das Schließen per Hintergrundtap bei YouTube", function (t) {
  const page = interactivePlayer(t, true, true);
  page.win.__langformSetOverlayState("page", true);
  assert.equal(page.click("player-control-overlay").defaultPrevented, false);
  assert.equal(page.counts().controls, 0);
  page.win.__langformSetOverlayState("page", false);
  assert.equal(page.click("player-control-overlay").defaultPrevented, true);
  assert.equal(page.counts().controls, 1);
});

test("Scrollen verschiebt geplante Geometriemessungen bis zur Ruhe; der Medienstatus bleibt erreichbar", function (t) {
  const page = playerPage(t);
  page.emit("playing");
  for (let index = 0; index < 5; index += 1) {
    page.win.document.dispatchEvent(new page.win.Event("scroll"));
    page.emit("resize");
  }
  assert.equal(page.frames.size, 1, "nur der layoutfreie Status bleibt geplant");
  assert.equal(page.timers.size, 1);
  assert.equal(page.reads(), 0);
  assert.equal(Array.from(page.timers.values())[0].delay, 160);
  page.frame();
  assert.equal(page.posts.length, 1);
  assertPlaybackPacket(page.posts[0]);
  assert.equal(page.reads(), 0);
  page.setTop(-100);
  page.timer();
  assert.equal(page.timers.size, 0, "nach Scrollende folgt kein zweiter Debounce");
  assert.equal(page.frames.size, 1);
  page.frame();
  assert.equal(page.posts.length, 2);
  assert.equal(page.posts[1].y, -100);
});

test("innere Kommentar- und Kapitellisten messen keinen Player und verzögern keine Pause-Rückmeldung", function (t) {
  const page = playerPage(t);
  const list = page.win.document.createElement("div");
  list.id = "comments-list";
  page.win.document.body.appendChild(list);
  list.dispatchEvent(new page.win.Event("scroll", { bubbles: true }));
  assert.equal(page.reads(), 0);
  assert.equal(page.timers.size, 0);
  assert.equal(page.frames.size, 0);
  page.setPlaying(false);
  page.emit("pause");
  list.dispatchEvent(new page.win.Event("scroll", { bubbles: true }));
  assert.equal(page.timers.size, 0);
  assert.equal(page.frames.size, 1, "Scroll in einer Liste verschiebt keinen Medienbericht");
  page.frame();
  assert.equal(page.posts.at(-1).playing, false);
  assert.equal(page.reads(), 1, "nur der Medienbericht selbst misst");
  page.win.document.getElementById("movie_player").dispatchEvent(new page.win.Event("scroll", { bubbles: true }));
  assert.equal(page.timers.size, 1, "ein innerer Scroll-Vorfahre des Videos bleibt relevant");
});

function firePlayerTimer(page, delay) {
  const entry = Array.from(page.timers.entries()).find(function ([, value]) { return value.delay === delay; });
  assert.ok(entry, "Timer mit " + delay + "ms fehlt");
  page.timers.delete(entry[0]);
  entry[1].callback();
}

function assertPlaybackPacket(packet) {
  assert.equal(packet.kind, "playback");
  assert.equal(packet.hasVideo, true);
  for (const key of ["x", "y", "width", "height", "viewportWidth", "viewportHeight", "painted", "mediaReady", "navigationComplete", "fullscreen"]) {
    assert.equal(Object.hasOwn(packet, key), false, "Statuspaket darf " + key + " nicht erfinden");
  }
}

test("während Hauptseiten-Scroll melden waiting, playing, pause und ended nur den aktuellen Playbackstatus", function (t) {
  for (const name of ["waiting", "playing", "pause", "ended"]) {
    const page = playerPage(t);
    let ended = false;
    Object.defineProperty(page.video, "ended", { get: function () { return ended; } });
    if (name === "playing") { page.setPlaying(false); page.emit("pause"); }
    else page.emit("playing");
    page.frame();
    const reads = page.reads();
    const reports = page.posts.length;
    for (let index = 0; index < 100; index++) page.win.document.dispatchEvent(new page.win.Event("scroll"));
    if (name === "playing") page.setPlaying(true);
    if (name === "pause") page.setPlaying(false);
    if (name === "ended") ended = true;
    page.emit(name); page.frame();
    assert.equal(page.posts.length, reports + 1, name + " darf nicht auf Scrollruhe warten");
    const packet = page.posts.at(-1);
    assertPlaybackPacket(packet);
    assert.equal(packet.playbackState, { waiting: "buffering", playing: "playing", pause: "paused", ended: "ended" }[name]);
    assert.equal(packet.playing, name === "waiting" || name === "playing", "Buffering ist keine falsche Audio-Deaktivierung");
    assert.equal(packet.href, page.win.location.href);
    assert.equal(page.reads(), reads, "100 Scrollereignisse und Playbackstatus benötigen keine Layoutmessung");
  }
});

test("ein Scroll vor der ersten Geometrie verwirft keine bereits geplante Playbackmeldung", function (t) {
  const page = playerPage(t);
  page.setPlaying(false); page.emit("pause");
  page.win.document.dispatchEvent(new page.win.Event("scroll"));
  page.frame();
  assert.equal(page.posts.length, 1);
  assertPlaybackPacket(page.posts[0]);
  assert.equal(page.posts[0].playing, false);
  assert.equal(page.reads(), 0, "Status braucht keinen früheren Rect und löst keinen schwarzen Dummy-Rect aus");
  page.setTop(-100);
  firePlayerTimer(page, 160); page.frame();
  assert.equal(page.posts.length, 2);
  assert.equal(page.posts[1].y, -100);
  assert.equal(page.reads(), 1, "die vollständige neue Geometrie folgt erst nach Scrollruhe");
});

test("100 weitere Scrollereignisse canceln kein Statusframe; gleiche Statuspakete bleiben dedupliziert", function (t) {
  const page = playerPage(t);
  page.emit("playing"); page.frame();
  const reads = page.reads();
  page.win.document.dispatchEvent(new page.win.Event("scroll"));
  page.emit("waiting");
  for (let index = 0; index < 100; index++) page.win.document.dispatchEvent(new page.win.Event("scroll"));
  page.frame();
  assert.equal(page.posts.length, 2);
  assertPlaybackPacket(page.posts.at(-1));
  for (let index = 0; index < 100; index++) {
    page.emit("waiting");
    page.win.document.dispatchEvent(new page.win.Event("scroll"));
    page.frame();
  }
  assert.equal(page.posts.length, 2);
  assert.equal(page.reads(), reads);
  assert.equal(page.frames.size, 0);
  assert.deepEqual(Array.from(page.timers.values()).map(function (value) { return value.delay; }).sort((a, b) => a - b), [160, 3000], "nur Scrollruhe und der bestehende einzelne Recoverytimer");
});

test("Partialmeldungen ignorieren fremde Videos, falsche Identität, verschwundene Knoten und pagehide", function (t) {
  const page = playerPage(t);
  const root = page.win.document.getElementById("movie_player");
  let id = "abcdefghijk";
  root.getVideoData = function () { return { video_id: id }; };
  page.emit("playing"); page.frame();
  page.win.document.dispatchEvent(new page.win.Event("scroll"));
  const other = page.win.document.createElement("video"); page.win.document.body.appendChild(other);
  other.dispatchEvent(new page.win.Event("pause")); page.frame();
  assert.equal(page.posts.length, 1);
  id = "mnopqrstuvw";
  page.setPlaying(false); page.emit("pause"); page.frame();
  assert.equal(page.posts.length, 1, "falsche Player-ID darf die aktuelle Audio-Session nicht deaktivieren");
  id = "abcdefghijk";
  page.emit("pause");
  page.video.remove(); page.frame();
  assert.equal(page.posts.length, 1, "ein fehlender Hauptknoten ist keine playing=false-Meldung");
  root.remove();
  other.dispatchEvent(new page.win.Event("pause")); page.frame();
  assert.equal(page.posts.length, 1, "auch ein entfernter ganzer Player macht den fremden Fallback-Knoten nicht zum Hauptvideo");
  other.remove();
  page.win.document.body.appendChild(root);
  root.appendChild(page.video);
  page.emit("pause");
  const late = Array.from(page.frames.values());
  page.win.dispatchEvent(new page.win.Event("pagehide"));
  late.forEach(function (callback) { callback(); });
  assert.equal(page.posts.length, 1);
  assert.equal(page.frames.size, 0);
  assert.equal(page.timers.size, 0);
});

test("ein neuer Fullbericht überholt ein altes Partialframe ohne Zustand zurückzusetzen oder doppelt zu senden", function (t) {
  const page = playerPage(t);
  page.emit("playing"); page.frame();
  page.win.document.dispatchEvent(new page.win.Event("scroll"));
  page.setPlaying(false); page.emit("pause");
  page.win.dispatchEvent(new page.win.Event("resize"));
  const callbacks = Array.from(page.frames.values());
  assert.equal(callbacks.length, 2, "Status und Geometrie haben unabhängige Frames");
  page.frames.clear();
  callbacks.reverse().forEach(function (callback) { callback(); });
  assert.equal(page.posts.length, 2, "Full- und Partialstatus teilen ihre Deduplizierung");
  assert.equal(page.posts.at(-1).playing, false);
  assert.equal(page.posts.at(-1).playbackState, "paused");
  assert.equal(Object.hasOwn(page.posts.at(-1), "width"), true);
  page.win.document.dispatchEvent(new page.win.Event("scroll"));
  page.setPlaying(true); page.emit("playing"); page.frame();
  assert.equal(page.posts.at(-1).playing, true);
  const reports = page.posts.length;
  page.setPlaying(false); page.emit("pause");
  page.win.dispatchEvent(new page.win.Event("resize"));
  const returning = Array.from(page.frames.values()); page.frames.clear();
  returning.reverse().forEach(function (callback) { callback(); });
  assert.equal(page.posts.length, reports + 1, "Rückkehr zum letzten Fullzustand muss einen inzwischen geänderten Partialzustand korrigieren");
  assert.equal(page.posts.at(-1).playing, false);
  assert.equal(page.posts.at(-1).playbackState, "paused");
});

test("Partialstatus nutzt ohne AnimationFrame einen einzelnen 16ms-Fallback vor Scrollruhe", function (t) {
  const page = playerPage(t, false);
  page.emit("playing"); firePlayerTimer(page, 16);
  const reads = page.reads();
  page.win.document.dispatchEvent(new page.win.Event("scroll"));
  page.setPlaying(false); page.emit("pause");
  for (let index = 0; index < 100; index++) page.win.document.dispatchEvent(new page.win.Event("scroll"));
  firePlayerTimer(page, 16);
  assert.equal(page.posts.length, 2);
  assertPlaybackPacket(page.posts.at(-1));
  assert.equal(page.posts.at(-1).playing, false);
  assert.equal(page.reads(), reads);
  assert.deepEqual(Array.from(page.timers.values()).map(function (value) { return value.delay; }), [160]);
});

test("die Fortschrittskorrektur eines stale Waiting bleibt während Hauptseiten-Scroll ohne Geometrielesen wirksam", function (t) {
  const page = progressingPlayer(t);
  const reads = page.reads();
  page.win.document.dispatchEvent(new page.win.Event("scroll"));
  page.emit("waiting"); page.frame();
  assert.equal(page.posts.at(-1).playbackState, "buffering");
  page.advance(1.25);
  assertPlaybackPacket(page.posts.at(-1));
  assert.equal(page.posts.at(-1).playbackState, "playing");
  assert.equal(page.posts.at(-1).playbackIssue, "");
  assert.equal(page.reads(), reads);
  assert.deepEqual(Array.from(page.timers.values()).map(function (value) { return value.delay; }), [160]);
});

test("ein reiner Hintergrund-Paint meldet den Player noch nicht als gezeichnet", function (t) {
  const page = playerPage(t);
  page.paint("first-paint");
  assert.equal(page.win.__langformMeasureVideo().painted, false);
  assert.equal(page.frames.size, 0);
  assert.equal(page.paintObservers[0].disconnected, false);
  page.paint("first-contentful-paint");
  assert.equal(page.frames.size, 1);
  page.frame();
  assert.equal(page.posts.length, 1);
  assert.equal(page.posts[0].painted, true);
  assert.equal(page.paintObservers[0].disconnected, true);
});

test("Seitenwechsel brechen Messungen ab und Wiederherstellen aktiviert die Beobachtung erneut", function (t) {
  const page = playerPage(t);
  page.emit("playing");
  const lateFrame = Array.from(page.frames.values())[0];
  page.win.dispatchEvent(new page.win.Event("pagehide"));
  lateFrame();
  page.paint("first-contentful-paint");
  page.emit("resize");
  assert.equal(page.frames.size, 0);
  assert.equal(page.timers.size, 0);
  assert.equal(page.reads(), 0);
  assert.equal(page.paintObservers[0].disconnected, true);
  page.win.dispatchEvent(new page.win.Event("pageshow"));
  assert.equal(page.paintObservers.length, 2);
  page.paint("first-contentful-paint");
  page.frame();
  assert.equal(page.posts.length, 1);
  assert.equal(page.posts[0].painted, true);

  page.win.document.dispatchEvent(new page.win.Event("scroll"));
  page.win.dispatchEvent(new page.win.Event("pagehide"));
  assert.equal(page.timers.size, 0, "auch die Scroll-Wartezeit wird abgebrochen");
});

test("ohne Frame-API nutzt der Player einen kurzen abbrechbaren Timer", function (t) {
  const page = playerPage(t, false);
  page.emit("playing");
  page.emit("resize");
  assert.equal(page.timers.size, 1);
  assert.equal(Array.from(page.timers.values())[0].delay, 16);
  page.timer();
  assert.equal(page.posts.length, 1);
  page.emit("pause");
  page.win.dispatchEvent(new page.win.Event("pagehide"));
  assert.equal(page.timers.size, 0);
});

test("der Player löst alte Größenbeobachter beim Video- und Seitenwechsel", function () {
  const dom = new JSDOM('<div id="movie_player"><video></video></div>', {
    url: "https://m.youtube.com/watch?v=abcdefghijk", runScripts: "outside-only",
  });
  const win = dom.window;
  const observed = [];
  const disconnected = [];
  win.ResizeObserver = function () {
    let target;
    this.observe = function (el) { target = el; observed.push(el); };
    this.disconnect = function () { disconnected.push(target); };
  };
  win.eval(rectScript);
  const original = win.document.querySelector("video");
  win.__langformMeasureVideo();
  assert.deepEqual(observed, [original]);
  const next = win.document.createElement("video");
  original.replaceWith(next);
  win.__langformMeasureVideo();
  assert.deepEqual(disconnected, [original]);
  assert.deepEqual(observed, [original, next]);
  win.dispatchEvent(new win.Event("pagehide"));
  assert.deepEqual(disconnected, [original, next]);
  assert.equal(next.getAttribute("style"), null);
  win.close();
});

test("Links innerhalb unserer Oberfläche werden nicht in den nativen Player umgeleitet", function () {
  const dom = new JSDOM('<div id="langform-summary"><a href="/watch?v=abcdefghijk"><span id="target">Video</span></a></div>', {
    url: "https://m.youtube.com/", runScripts: "outside-only",
  });
  const win = dom.window;
  const posts = [];
  win.webkit = { messageHandlers: { langformOpenWatch: { postMessage: function (body) { posts.push(body); } } } };
  win.eval(linkScript);
  const target = win.document.getElementById("target");
  // Observe the capture handler's result before preventing jsdom navigation.
  let intercepted;
  target.addEventListener("click", function (event) { intercepted = event.defaultPrevented; event.preventDefault(); });
  target.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
  assert.equal(intercepted, false);
  assert.equal(posts.length, 0);
  win.close();
});

function navigationPlayer(t, withRouter = true) {
  const page = playerPage(t, true, true);
  const root = page.win.document.getElementById("movie_player");
  let actualID = "abcdefghijk";
  let state = 4;
  let serial = 0;
  const decodedFrames = new Map();
  const routes = [];
  Object.defineProperty(page.win.document, "readyState", { get: function () { return "complete"; } });
  Object.defineProperties(page.video, {
    readyState: { get: function () { return state; } },
    videoWidth: { get: function () { return state >= 2 ? 1920 : 0; } },
    videoHeight: { get: function () { return state >= 2 ? 1080 : 0; } },
  });
  root.getVideoData = function () { return { video_id: actualID }; };
  page.video.requestVideoFrameCallback = function (callback) { const id = ++serial; decodedFrames.set(id, callback); return id; };
  page.video.cancelVideoFrameCallback = function (id) { decodedFrames.delete(id); };
  if (withRouter) page.win.addEventListener("click", function (event) {
    if (event.target.tagName !== "A") return;
    event.preventDefault();
    routes.push(event.target.href);
    page.win.dispatchEvent(new page.win.CustomEvent("state-navigatestart", { detail: { href: event.target.href } }));
  });
  return Object.assign(page, {
    root, routes, decodedFrames,
    actual: function (id) { actualID = id; },
    readiness: function (value) { state = value; },
    route: function (id) { page.win.history.replaceState({}, "", "/watch?v=" + id); },
    complete: function () { page.win.dispatchEvent(new page.win.Event("state-navigateend")); },
    presented: function () {
      const callbacks = Array.from(decodedFrames.values());
      decodedFrames.clear();
      callbacks.forEach(function (callback) { callback(10, { presentedFrames: 1, mediaTime: 0 }); });
    },
  });
}

test("ein frisches Dokument meldet decodierte Medien vor Gesamt-Load, ohne fremde Video-ID zu akzeptieren", function (t) {
  const page = navigationPlayer(t);
  assert.equal(page.win.__langformMeasureVideo().mediaReady, true);
  assert.equal(page.win.__langformMeasureVideo().painted, false, "kein Gesamtseiten-Paint als Voraussetzung");
  page.actual("lmnopqrstuv");
  assert.equal(page.win.__langformMeasureVideo().mediaReady, false);
  page.actual("abcdefghijk");
  page.readiness(1);
  assert.equal(page.win.__langformMeasureVideo().mediaReady, false, "Metadaten allein sind noch kein Bild");
  page.readiness(2);
  page.emit("loadeddata");
  page.frame();
  assert.equal(page.posts.at(-1).mediaReady, true);
  page.route("lmnopqrstuv");
  assert.equal(page.win.__langformMeasureVideo().mediaReady, false, "eine neue URL kann kein altes Cold-Ready erben");
});

test("SPA nutzt YouTubes echten Anchor-Router und wartet auf neue Medien-ID, Ladegrenze, Frame und Navigation-Ende", function (t) {
  const page = navigationPlayer(t);
  const target = "https://m.youtube.com/watch?v=lmnopqrstuv&t=12";
  page.paint("first-contentful-paint");
  assert.equal(page.win.__langformNavigateWatch(target, "abcdefghijk", "42"), true);
  assert.deepEqual(page.routes, [target]);
  assert.equal(page.win.document.getElementById("langform-native-watch-link"), null);
  let report = page.win.__langformMeasureVideo();
  assert.equal(report.navigationToken, "42");
  assert.equal(report.navigationTargetID, "lmnopqrstuv");
  assert.equal(report.navigationStarted, true);
  assert.match(report.href, /abcdefghijk/, "Start-ACK fälscht die noch alte Dokumentadresse nicht");
  assert.equal(report.painted, false);
  page.route("lmnopqrstuv");
  page.emit("loadeddata");
  assert.equal(page.decodedFrames.size, 0, "Ladeereignis des alten Players gilt nicht");
  page.actual("lmnopqrstuv");
  page.emit("playing");
  assert.equal(page.decodedFrames.size, 0, "neue Metadaten plus altes laufendes Bild gelten nicht");
  page.emit("loadedmetadata");
  assert.equal(page.decodedFrames.size, 1);
  page.presented();
  assert.equal(page.win.__langformMeasureVideo().mediaReady, false, "Seitendaten müssen ebenfalls angekommen sein");
  page.complete();
  report = page.win.__langformMeasureVideo();
  assert.equal(report.navigationComplete, true);
  assert.equal(report.playerVideoID, "lmnopqrstuv");
  assert.equal(report.mediaReady, true);
  assert.equal(report.painted, true);
  assert.equal(page.video.getAttribute("style"), null);
  assert.equal(page.win.document.querySelectorAll("video").length, 1);
});

test("fehlender Router und fehlende Frame-Capability liefern sofort Full-Load-Fallback, ohne Browser-Defaultnavigation", function (t) {
  const page = navigationPlayer(t, false);
  const href = page.win.location.href;
  assert.equal(page.win.__langformNavigateWatch("https://m.youtube.com/watch?v=lmnopqrstuv", "abcdefghijk", "1"), false);
  assert.equal(page.win.location.href, href);
  assert.equal(page.win.__langformMeasureVideo().navigationToken, "");
  assert.equal(page.win.document.getElementById("langform-native-watch-link"), null);
  page.video.requestVideoFrameCallback = undefined;
  assert.equal(page.win.__langformNavigateWatch("https://m.youtube.com/watch?v=lmnopqrstuv", "abcdefghijk", "2"), false);
  assert.deepEqual(page.routes, []);
});

test("ein gebundener erster SPA-Start wartet auf neue Medien, benötigt aber keine schon präsentierte Frame", function (t) {
  const page = navigationPlayer(t);
  page.setPlaying(false);
  let apiStarts = 0, mediaStarts = 0;
  page.root.playVideo = function () { apiStarts++; };
  page.video.play = function () { mediaStarts++; page.setPlaying(true); return Promise.resolve(); };
  assert.equal(page.win.__langformNavigateWatch("https://m.youtube.com/watch?v=lmnopqrstuv", "abcdefghijk", "87"), true);
  page.route("lmnopqrstuv"); page.actual("lmnopqrstuv"); page.complete(); page.frame();
  assert.equal(page.win.__langformMeasureVideo().navigationMediaLoaded, false);
  assert.equal(page.win.__langformPlay("lmnopqrstuv", true), false);
  assert.equal(apiStarts, 0, "the reused old media cannot receive even the player API request");
  const oldReports = page.posts.length;
  page.emit("loadedmetadata"); page.frame();
  const report = page.posts.at(-1);
  assert.ok(page.posts.length > oldReports, "loaded-media lifecycle is reported even when geometry and readiness are unchanged");
  assert.equal(report.navigationMediaLoaded, true);
  assert.equal(report.mediaReady, false);
  assert.equal(report.mediaPresented, false);
  assert.equal(page.win.__langformPlay("lmnopqrstuv", true), true);
  assert.equal(apiStarts, 1);
  assert.equal(mediaStarts, 1, "the same Start finishes once on the matching loaded media, breaking the first-frame/start dependency");
});

test("SPA lehnt alte IDs, fremde Hosts, gleiche Videos und zweite noch laufende Anforderungen ab", function (t) {
  const page = navigationPlayer(t);
  const target = "https://m.youtube.com/watch?v=lmnopqrstuv";
  assert.equal(page.win.__langformNavigateWatch(target, "old-video", "1"), false);
  assert.equal(page.win.__langformNavigateWatch("https://www.youtube.com/watch?v=lmnopqrstuv", "abcdefghijk", "1"), false);
  assert.equal(page.win.__langformNavigateWatch(page.win.location.href, "abcdefghijk", "1"), false);
  page.actual("old-video");
  assert.equal(page.win.__langformNavigateWatch(target, "abcdefghijk", "1"), false);
  page.actual("abcdefghijk");
  assert.equal(page.win.__langformNavigateWatch(target, "abcdefghijk", "1"), true);
  assert.equal(page.win.__langformNavigateWatch("https://m.youtube.com/watch?v=12345678901", "abcdefghijk", "2"), false);
  assert.equal(page.routes.length, 1);
});

test("alte Frame-Callbacks und erneutes Laden können SPA-Ready nicht vorzeitig setzen", function (t) {
  const page = navigationPlayer(t);
  page.win.__langformNavigateWatch("https://m.youtube.com/watch?v=lmnopqrstuv", "abcdefghijk", "1");
  page.route("lmnopqrstuv");
  page.actual("lmnopqrstuv");
  page.complete();
  page.emit("loadeddata");
  const lateFrame = Array.from(page.decodedFrames.values())[0];
  page.emit("emptied");
  assert.equal(page.decodedFrames.size, 0);
  lateFrame();
  assert.equal(page.win.__langformMeasureVideo().mediaReady, false);
  page.emit("loadeddata");
  lateFrame();
  assert.equal(page.win.__langformMeasureVideo().mediaReady, false, "ein alter Callback gilt auch nach einer neuen Ladegrenze nicht");
  assert.equal(page.decodedFrames.size, 1, "alter Callback löscht keinen neuen Frame-Auftrag");
  const afterHide = Array.from(page.decodedFrames.values())[0];
  page.win.dispatchEvent(new page.win.Event("pagehide"));
  assert.equal(page.decodedFrames.size, 0);
  afterHide();
  assert.equal(page.win.__langformMeasureVideo().mediaReady, false);
  assert.equal(page.win.__langformNavigateWatch("https://m.youtube.com/watch?v=12345678901", "lmnopqrstuv", "2"), false);
});

test("lokale Touch-Bewegung und Cancel blockieren Restklicks auch vor verspäteter nativer Drag-Brücke", function (t) {
  const page = interactivePlayer(t);
  const target = page.doc.getElementById("surface");
  function pointer(name, x, y) {
    target.dispatchEvent(new page.win.MouseEvent(name, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  }
  pointer("pointerdown", 40, 40);
  pointer("pointermove", 40, 65);
  pointer("pointerup", 40, 65);
  page.click("surface");
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
  pointer("pointerdown", 40, 40);
  pointer("pointercancel", 40, 40);
  page.click("surface");
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
  pointer("pointerdown", 40, 40);
  pointer("pointerup", 40, 40);
  page.click("surface");
  assert.deepEqual(page.counts(), { controls: 1, plays: 0, pauses: 0 }, "nächster echter Tap bleibt sofort bedienbar");
});

test("ein ungestartetes Video bleibt für natives Play erreichbar, wenn ein Flächentap YouTubes Controls ausblendet", function (t) {
  const page = interactivePlayer(t);
  page.setPlaying(false);
  assert.equal(page.win.__langformMeasureVideo().playbackState, "unstarted");
  page.click("surface");
  assert.equal(page.win.__langformMeasureVideo().playbackState, "unstarted");
  assert.deepEqual(page.counts(), { controls: 1, plays: 0, pauses: 0 });
  assert.equal(page.win.__langformPlay("other-video"), false);
  assert.equal(page.win.__langformPlay("abcdefghijk"), true);
  assert.deepEqual(page.counts(), { controls: 1, plays: 1, pauses: 0 });
  assert.equal(page.video.getAttribute("style"), null);
});

test("abgelehntes Play meldet einen deduplizierten Fehler und nur ein erneuter bewusster Versuch startet", async function (t) {
  const page = interactivePlayer(t);
  page.setPlaying(false);
  Object.defineProperty(page.video, "readyState", { get: function () { return 3; } });
  let attempts = 0;
  page.video.play = function () { attempts++; return Promise.reject(new Error("NotAllowedError")); };
  page.emit("loadedmetadata");
  page.frame();
  const beforePlay = page.posts.length;
  assert.equal(page.win.__langformPlay("abcdefghijk"), true);
  await Promise.resolve();
  page.frame();
  assert.equal(attempts, 1);
  assert.equal(page.timers.size, 0, "Ablehnung beendet den Start-Timer");
  assert.equal(page.posts.length, beforePlay + 1, "Fehler wird auch bei unveränderten Medienflags gemeldet");
  assert.equal(page.posts.at(-1).playbackState, "failed");
  assert.equal(page.posts.at(-1).playbackIssue, "rejected");
  assert.equal(page.posts.at(-1).playing, false);
  page.emit("resize");
  page.frame();
  assert.equal(page.posts.length, beforePlay + 1);
  page.click("surface");
  assert.equal(attempts, 1, "Controls-Tap darf keinen automatischen Retry auslösen");
  page.video.play = function () {
    attempts++;
    page.setPlaying(true);
    page.emit("playing");
    return Promise.resolve();
  };
  page.win.__langformPlay("abcdefghijk");
  page.frame();
  assert.equal(attempts, 2);
  assert.equal(page.posts.at(-1).playbackState, "playing");
  assert.equal(page.posts.at(-1).playbackIssue, "");
  assert.equal(page.timers.size, 0);
});

test("Buffering behält das Audioflag und bietet nach einem einzelnen Timeout nur eine explizite Wiederholung", function (t) {
  const page = interactivePlayer(t);
  let readiness = 2;
  Object.defineProperty(page.video, "readyState", { get: function () { return readiness; } });
  page.emit("waiting");
  page.frame();
  assert.equal(page.posts.at(-1).playing, true, "Buffering ist kein Pause-Befehl für AudioSession");
  assert.equal(page.posts.at(-1).playbackState, "buffering");
  assert.equal(page.timers.size, 1);
  assert.equal(Array.from(page.timers.values())[0].delay, 3000);
  page.timer();
  page.frame();
  assert.equal(page.posts.at(-1).playbackIssue, "timeout");
  assert.equal(page.posts.at(-1).playbackState, "buffering");
  ["waiting", "stalled", "resize"].forEach(page.emit);
  page.frame();
  assert.equal(page.timers.size, 0, "kein Timeout-Polling oder automatischer Neustart");
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
  page.win.__langformPlay("abcdefghijk");
  assert.deepEqual(page.counts(), { controls: 0, plays: 1, pauses: 0 }, "Retry ist trotz paused=false kein Toggle/Pause");
  readiness = 3;
  page.emit("playing");
  page.frame();
  assert.equal(page.posts.at(-1).playbackIssue, "");
  assert.equal(page.posts.at(-1).playbackState, "playing");
  assert.equal(page.timers.size, 0);
});

test("wirkungslose Player- und Medienanfrage bekommt Retry und späte Promise-Fehler überschreiben keine neue Aktion", async function (t) {
  const page = interactivePlayer(t);
  page.setPlaying(false);
  let requests = 0;
  let mediaRequests = 0;
  page.root.playVideo = function () { requests++; };
  page.video.play = function () { mediaRequests++; return Promise.resolve(); };
  page.win.__langformPlay("abcdefghijk");
  page.timer();
  page.frame();
  assert.equal(requests, 1);
  assert.equal(mediaRequests, 1, "dieselbe bewusste Startanfrage darf genau einmal zum Medienknoten durchfallen");
  assert.equal(page.posts.at(-1).playbackState, "failed");
  assert.equal(page.posts.at(-1).playbackIssue, "timeout");
  delete page.root.playVideo;
  let rejectFirst;
  page.video.play = function () {
    page.setPlaying(true);
    return new Promise(function (_resolve, reject) { rejectFirst = reject; });
  };
  page.win.__langformPlay("abcdefghijk");
  page.win.__langformTogglePlayback("abcdefghijk");
  rejectFirst(new Error("AbortError"));
  await Promise.resolve();
  assert.equal(page.win.__langformMeasureVideo().playbackIssue, "", "bewusstes Pause wird nicht durch einen alten Fehler ersetzt");
  assert.equal(page.timers.size, 0);
  page.win.__langformPlay("abcdefghijk");
  page.win.dispatchEvent(new page.win.Event("pagehide"));
  rejectFirst(new Error("AbortError"));
  await Promise.resolve();
  assert.equal(page.timers.size, 0);
  assert.equal(page.win.__langformMeasureVideo().playbackState, "unavailable");
});

test("natives Start führt ein wirkungsloses playVideo einmal am selben pausierten Hauptmedium zu Ende", function (t) {
  const page = interactivePlayer(t);
  page.setPlaying(false);
  Object.defineProperty(page.video, "readyState", { get: function () { return 3; } });
  page.root.getVideoData = function () { return { video_id: "abcdefghijk" }; };
  let requests = 0;
  page.root.playVideo = function () { requests++; };
  page.video.play = function () { page.setPlaying(true); page.emit("playing"); return Promise.resolve(); };
  assert.equal(page.win.__langformPlay("abcdefghijk"), true);
  page.frame();
  assert.equal(requests, 1);
  assert.equal(page.posts.at(-1).playbackState, "playing");
  assert.equal(page.posts.at(-1).playbackIssue, "");
  assert.equal(page.timers.size, 0, "bestätigte Wiedergabe beendet das einzelne Startdeadline");
  page.emit("waiting"); page.frame();
  assert.equal(requests, 1, "Medienereignisse starten keinen neuen Auftrag");
});

test("Start-Fallback greift weder laufendes Medium noch Werbung oder einen synchronen Playerwechsel an", function (t) {
  for (const condition of ["already-running", "api-started", "ad", "ad-class", "route", "player-id", "media", "root", "native-drag"]) {
    const page = interactivePlayer(t);
    page.setPlaying(condition === "already-running");
    let data = { video_id: "abcdefghijk" };
    page.root.getVideoData = function () { return data; };
    page.root.playVideo = function () {
      if (condition === "api-started") page.setPlaying(true);
      if (condition === "ad") data = { video_id: "abcdefghijk", isAd: true };
      if (condition === "ad-class") page.root.classList.add("ad-showing");
      if (condition === "route") page.win.history.replaceState({}, "", "/watch?v=lmnopqrstuv");
      if (condition === "player-id") data = { video_id: "lmnopqrstuv" };
      if (condition === "media") page.video.replaceWith(page.doc.createElement("video"));
      if (condition === "root") page.root.id = "removed-player";
      if (condition === "native-drag") page.win.__langformSetNativeDragging(true, "abcdefghijk");
    };
    assert.equal(page.win.__langformPlay("abcdefghijk"), true, condition);
    assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 }, condition);
  }
});

test("abgelehntes direktes Start-Fallback meldet Retry und wiederholt sich ohne neue Aktion nicht", async function (t) {
  const page = interactivePlayer(t);
  page.setPlaying(false);
  page.root.playVideo = function () {};
  let requests = 0;
  page.video.play = function () { requests++; return Promise.reject(new Error("NotAllowedError")); };
  page.win.__langformPlay("abcdefghijk");
  await Promise.resolve(); page.frame();
  assert.equal(page.posts.at(-1).playbackState, "failed");
  assert.equal(page.posts.at(-1).playbackIssue, "rejected");
  assert.equal(page.timers.size, 0);
  ["waiting", "canplay", "resize"].forEach(page.emit); page.frame();
  assert.equal(requests, 1, "Ablehnung und Medienereignisse wiederholen den bewussten Start nicht");
});

test("ein stockender Download zeigt bei weiter spielendem Puffer oder Seeking keinen falschen Retry", function (t) {
  const page = interactivePlayer(t);
  let readiness = 4;
  let seeking = false;
  Object.defineProperty(page.video, "readyState", { get: function () { return readiness; } });
  Object.defineProperty(page.video, "seeking", { get: function () { return seeking; } });
  page.emit("playing");
  page.frame();
  page.emit("stalled");
  page.frame();
  assert.equal(page.posts.length, 1, "Downloadstillstand ändert laufendes Playback nicht");
  assert.equal(page.win.__langformMeasureVideo().playbackState, "playing");
  assert.equal(page.timers.size, 0);
  readiness = 2;
  seeking = true;
  page.emit("stalled");
  assert.equal(page.timers.size, 0, "Seeking ist kein Anlass für einen neuen Recovery-Timeout");
  seeking = false;
  page.emit("stalled");
  page.frame();
  assert.equal(page.posts.at(-1).playbackState, "buffering");
  assert.equal(page.timers.size, 1, "fehlende Mediendaten starten weiterhin einen begrenzten Recovery-Timeout");
});

test("ein bereits bestehender Medienfehler verlangt Reload, auch ohne neues error-Ereignis", function (t) {
  const page = interactivePlayer(t);
  page.setPlaying(false);
  Object.defineProperty(page.video, "error", { get: function () { return { code: 3 }; } });
  const status = page.win.__langformMeasureVideo();
  assert.equal(status.playbackState, "failed");
  assert.equal(status.playbackIssue, "media-error");
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
  assert.equal(page.timers.size, 0);
});

function progressingPlayer(t) {
  const page = interactivePlayer(t);
  const state = { ready: 4, seeking: false, ended: false, error: null, player: 3, id: "abcdefghijk", ad: false };
  Object.defineProperties(page.video, {
    readyState: { get: function () { return state.ready; } },
    seeking: { get: function () { return state.seeking; } },
    ended: { get: function () { return state.ended; } },
    error: { get: function () { return state.error; } },
  });
  page.root.getVideoData = function () { return { video_id: state.id, isAd: state.ad }; };
  page.root.getPlayerState = function () { return state.player; };
  page.video.currentTime = 1;
  page.emit("playing");
  page.frame();
  page.advance = function (time) { page.video.currentTime = time; page.emit("timeupdate"); page.frame(); };
  return Object.assign(page, { state });
}

test("echter Medienfortschritt korrigiert einen alten Waiting-Status und seinen Retry ohne Playback-Eingriff", function (t) {
  const page = progressingPlayer(t);
  page.emit("waiting"); page.frame();
  page.timer(); page.frame();
  assert.equal(page.posts.at(-1).playbackIssue, "timeout");
  page.advance(1);
  assert.equal(page.posts.at(-1).playbackState, "buffering", "timeupdate ohne Zeitfortschritt reicht nicht");
  page.advance(1.25);
  assert.equal(page.posts.at(-1).playbackState, "playing");
  assert.equal(page.posts.at(-1).playbackIssue, "");
  assert.equal(page.timers.size, 0);
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
});

test("Medienfortschritt korrigiert einen beim playing-Event noch alten YouTube-Bufferingstatus einmalig", function (t) {
  const page = progressingPlayer(t);
  assert.equal(page.posts.at(-1).playbackState, "buffering");
  page.advance(1.25);
  assert.equal(page.posts.at(-1).playbackState, "playing", "der weiterlaufende Hauptstream ist stärkere Evidenz als state=3");
  page.state.player = 1;
  const reports = page.posts.length;
  const reads = page.reads();
  for (let index = 1; index <= 100; index++) page.advance(1.25 + index / 4);
  assert.equal(page.posts.length, reports, "laufende timeupdates erzeugen keine Berichtsschleife");
  assert.equal(page.reads(), reads, "laufende timeupdates erzwingen keine neuen Layoutmessungen");
  assert.equal(page.timers.size, 0, "kein Polling oder periodischer Kontrolltimer");
});

test("echtes Buffering gewinnt nach einer Fortschrittskorrektur wieder Vorrang", function (t) {
  const page = progressingPlayer(t);
  page.advance(1.25);
  page.state.ready = 2;
  page.emit("waiting"); page.frame();
  assert.equal(page.posts.at(-1).playbackState, "buffering");
  page.advance(1.25);
  page.advance(1.5);
  assert.equal(page.posts.at(-1).playbackState, "buffering", "unzureichende Mediendaten sind keine Fortschrittsbestätigung");
  assert.equal(page.timers.size, 1);
  page.state.ready = 4;
  page.advance(1.75);
  assert.equal(page.posts.at(-1).playbackState, "playing");
  assert.equal(page.timers.size, 0, "echte Recovery beendet den einzelnen ausstehenden Retrytimer");
  page.state.ready = 2;
  page.emit("stalled"); page.frame();
  assert.equal(page.posts.at(-1).playbackState, "buffering", "ein neuer echter Stall wird nicht durch frühere Fortschritte verdeckt");
});

test("Zeitänderungen bei Seeking, Pause, Ende, Fehler oder Werbung bestätigen kein Playing", function (t) {
  for (const condition of ["seeking", "paused", "ended", "error", "ad", "ad-class"]) {
    const page = progressingPlayer(t);
    page.emit("waiting"); page.frame();
    if (condition === "paused") page.setPlaying(false);
    else if (condition === "error") page.state.error = { code: 3 };
    else if (condition === "ad-class") page.root.classList.add("ad-showing");
    else page.state[condition] = true;
    page.advance(2); page.advance(3);
    assert.notEqual(page.win.__langformMeasureVideo().playbackState, "playing", condition);
    assert.notEqual(page.posts.at(-1).playbackState, "playing", condition);
    assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
  }
});

test("ein Seek-Sprung allein ist keine Recovery; erst Fortschritt nach seeked zählt", function (t) {
  const page = progressingPlayer(t);
  page.emit("waiting"); page.frame();
  page.state.seeking = true;
  page.emit("seeking");
  page.advance(60);
  page.state.seeking = false;
  page.emit("seeked"); page.frame();
  page.advance(60);
  assert.equal(page.posts.at(-1).playbackState, "buffering");
  page.advance(60.25);
  assert.equal(page.posts.at(-1).playbackState, "playing");
});

test("eine frühere Fortschrittsbestätigung verdeckt keine späteren ungültigen Medienzustände", function (t) {
  for (const condition of ["ready", "seeking", "paused", "ended", "error", "ad", "ad-class", "id"]) {
    const page = progressingPlayer(t);
    page.advance(1.25);
    assert.equal(page.posts.at(-1).playbackState, "playing");
    if (condition === "ready") page.state.ready = 2;
    else if (condition === "paused") page.setPlaying(false);
    else if (condition === "error") page.state.error = { code: 3 };
    else if (condition === "ad-class") page.root.classList.add("ad-interrupting");
    else if (condition === "id") page.state.id = "mnopqrstuvw";
    else page.state[condition] = true;
    page.advance(2);
    assert.notEqual(page.win.__langformMeasureVideo().playbackState, "playing", condition);
    assert.notEqual(page.posts.at(-1).playbackState, "playing", condition);
    const reads = page.reads();
    page.advance(3);
    assert.equal(page.reads(), reads, "wiederholte ungültige Updates erzeugen keine Messschleife: " + condition);
  }
});

test("andere Medien, falsche Videoidentität und ein altes Dokument können Waiting nicht korrigieren", function (t) {
  const page = progressingPlayer(t);
  page.emit("waiting"); page.frame();
  const other = page.doc.createElement("video"); page.doc.body.appendChild(other);
  other.currentTime = 10;
  other.dispatchEvent(new page.win.Event("timeupdate")); page.frame();
  assert.equal(page.posts.at(-1).playbackState, "buffering");
  page.state.id = "mnopqrstuvw";
  page.advance(2); page.advance(3);
  assert.equal(page.posts.at(-1).playbackState, "buffering");
  delete page.root.getVideoData;
  page.win.history.replaceState({}, "", "/watch?v=mnopqrstuvw");
  page.advance(4); page.advance(5);
  assert.equal(page.win.__langformMeasureVideo().playbackState, "buffering");
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
});

test("Rotation meldet den aktuellen CSS-Viewport auch bei identischem Video-Rect und bündelt Größenereignisse", function (t) {
  const page = interactivePlayer(t);
  page.win.innerWidth = 390;
  page.win.innerHeight = 844;
  page.emit("playing");
  page.frame();
  assert.equal(page.posts.at(-1).viewportWidth, 390);
  assert.equal(page.posts.at(-1).viewportHeight, 844);
  const reads = page.reads();
  page.win.innerWidth = 844;
  page.win.innerHeight = 390;
  page.win.dispatchEvent(new page.win.Event("orientationchange"));
  page.win.dispatchEvent(new page.win.Event("resize"));
  page.win.visualViewport.dispatchEvent(new page.win.Event("resize"));
  assert.equal(page.reads(), reads, "kein synchrones Layout pro Rotationsereignis");
  assert.equal(page.frames.size, 1);
  assert.equal(page.timers.size, 0);
  page.frame();
  assert.equal(page.posts.length, 2, "identischer Crop im neuen Viewport wird nicht wegdedupliziert");
  assert.equal(page.posts.at(-1).viewportWidth, 844);
  assert.equal(page.posts.at(-1).viewportHeight, 390);
  page.win.dispatchEvent(new page.win.Event("resize"));
  page.frame();
  assert.equal(page.posts.length, 2, "wirklich unveränderte Berichte bleiben dedupliziert");
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
  assert.equal(page.video.getAttribute("style"), null);
});

test("Rotation und Fullscreen messen trotz auslaufendem Scroll, ohne Playback zu ändern oder nach Pagehide weiterzulaufen", function (t) {
  const page = interactivePlayer(t);
  page.setPlaying(false);
  page.video.currentTime = 42;
  const transitions = [
    [page.win, "orientationchange"], [page.win, "resize"], [page.win.visualViewport, "resize"],
    [page.win, "player-fullscreen-change"], [page.doc, "fullscreenchange"],
    [page.doc, "webkitfullscreenchange"], [page.video, "webkitbeginfullscreen"], [page.video, "webkitendfullscreen"],
  ];
  transitions.forEach(function ([target, event]) {
    page.doc.dispatchEvent(new page.win.Event("scroll"));
    assert.equal(page.frames.size, 0);
    assert.equal(page.timers.size, 1);
    target.dispatchEvent(new page.win.Event(event));
    assert.equal(page.timers.size, 0, event + " wartet nicht auf die Scrollruhe");
    assert.equal(page.frames.size, 1);
    page.frame();
  });
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
  assert.equal(page.video.currentTime, 42);
  assert.equal(page.video.paused, true);
  page.win.dispatchEvent(new page.win.Event("pagehide"));
  transitions.forEach(function ([target, event]) { target.dispatchEvent(new page.win.Event(event)); });
  assert.equal(page.frames.size, 0);
  assert.equal(page.timers.size, 0);
});

test("auch ohne Video enthält der Report den Viewport und ungültige Maße gelten nicht als frische Geometrie", function (t) {
  const page = playerPage(t);
  page.video.remove();
  page.win.innerWidth = 844;
  page.win.innerHeight = 390;
  let report = page.win.__langformMeasureVideo();
  assert.equal(report.hasVideo, false);
  assert.equal(report.viewportWidth, 844);
  assert.equal(report.viewportHeight, 390);
  page.win.innerWidth = Infinity;
  page.win.innerHeight = -1;
  report = page.win.__langformMeasureVideo();
  assert.equal(report.viewportWidth, 0);
  assert.equal(report.viewportHeight, 0);
});

test("Vollbildmeldungen folgen nur dem aktuellen Hauptvideo und werden auch bei gleicher Geometrie gesendet", function (t) {
  const page = interactivePlayer(t);
  let fullscreenElement = null;
  Object.defineProperty(page.doc, "fullscreenElement", { get: () => fullscreenElement });
  page.emit("playing");
  page.frame();
  assert.equal(page.posts.at(-1).fullscreen, false);
  fullscreenElement = page.root;
  page.doc.dispatchEvent(new page.win.Event("fullscreenchange"));
  page.frame();
  assert.equal(page.posts.at(-1).fullscreen, true);
  fullscreenElement = page.doc.createElement("section");
  page.doc.dispatchEvent(new page.win.Event("fullscreenchange"));
  page.frame();
  assert.equal(page.posts.at(-1).fullscreen, false, "Vollbild eines fremden Elements ist kein Video-Vollbild");
  page.root.isFullscreen = () => true;
  page.root.getVideoData = () => ({ video_id: "stale-video" });
  assert.equal(page.win.__langformMeasureVideo().fullscreen, false, "alte Playerdaten können kein aktuelles Video als Vollbild melden");
  page.video.remove();
  assert.equal(page.win.__langformMeasureVideo().fullscreen, false);
});

test("Custom-Vollbild meldet seinen Zustand und natives Exit ruft ausschließlich dessen Exit auf", function (t) {
  const page = interactivePlayer(t);
  let open = true, exits = 0, platformExits = 0;
  page.win.__langformFullscreen = {
    isOpen: function () { return open; },
    exit: function (id) { assert.equal(id, "abcdefghijk"); exits++; open = false; },
  };
  Object.defineProperty(page.doc, "fullscreenElement", { get: () => page.root });
  page.doc.exitFullscreen = function () { platformExits++; };
  page.root.isFullscreen = function () { return true; };
  page.root.toggleFullscreen = function () { platformExits++; };
  page.win.dispatchEvent(new page.win.Event("player-fullscreen-change"));
  page.frame();
  assert.equal(page.posts.at(-1).fullscreen, true);
  assert.equal(exits, 0, "ein Zustandsereignis ist kein Exitauftrag");
  assert.equal(page.win.__langformExitFullscreen("abcdefghijk"), true);
  assert.equal(exits, 1);
  assert.equal(platformExits, 0, "kein zusätzlicher WebKit- oder YouTube-Toggle");
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
});

test("Custom-Vollbild bleibt an aktuelle bekannte Videoidentität und expliziten Exit gebunden", function (t) {
  const page = interactivePlayer(t);
  let exits = 0;
  page.win.__langformFullscreen = { isOpen: () => true, exit: () => { exits++; } };
  assert.equal(page.win.__langformExitFullscreen("other-video"), false);
  page.root.getVideoData = () => ({ video_id: "stale-video" });
  assert.equal(page.win.__langformMeasureVideo().fullscreen, false);
  assert.equal(page.win.__langformExitFullscreen("abcdefghijk"), false);
  page.root.getVideoData = () => ({});
  page.win.history.replaceState({}, "", "/watch?v=lmnopqrstuv");
  assert.equal(page.win.__langformMeasureVideo().fullscreen, false, "geänderte Route ohne aktuelle Playeridentität ist unbestätigt");
  assert.equal(page.win.__langformExitFullscreen("lmnopqrstuv"), false);
  assert.equal(exits, 0);
  page.root.getVideoData = () => ({ video_id: "lmnopqrstuv" });
  assert.equal(page.win.__langformMeasureVideo().fullscreen, true);
  assert.equal(page.win.__langformExitFullscreen("lmnopqrstuv"), true);
  assert.equal(page.win.__langformExitFullscreen("lmnopqrstuv"), false, "wiederholter Exit während offenen Auftrags bleibt gesperrt");
  assert.equal(exits, 1);
});

test("nur ein expliziter ID-gebundener Exitauftrag verlässt Standard-Vollbild ohne Wiedergabeänderung", async function (t) {
  const page = interactivePlayer(t);
  let fullscreenElement = page.root;
  let requests = 0;
  let finish;
  Object.defineProperty(page.doc, "fullscreenElement", { get: () => fullscreenElement });
  page.doc.exitFullscreen = function () { requests++; return new Promise(resolve => { finish = resolve; }); };
  page.video.currentTime = 42;
  page.doc.dispatchEvent(new page.win.Event("fullscreenchange"));
  page.frame();
  assert.equal(requests, 0, "Beobachtung löst keinen Exit aus");
  assert.equal(page.win.__langformExitFullscreen("old-video"), false);
  assert.equal(page.win.__langformExitFullscreen(""), false);
  assert.equal(page.win.__langformExitFullscreen("abcdefghijk"), true);
  assert.equal(page.win.__langformExitFullscreen("abcdefghijk"), false, "schnelle wiederholte Gesten starten keinen zweiten Exit");
  assert.equal(page.win.__langformMeasureVideo().fullscreen, true, "kein optimistischer Zustand vor dem tatsächlichen Exit");
  fullscreenElement = null;
  finish();
  await Promise.resolve();
  page.doc.dispatchEvent(new page.win.Event("fullscreenchange"));
  page.frame();
  assert.equal(page.posts.at(-1).fullscreen, false);
  assert.equal(requests, 1);
  assert.equal(page.video.currentTime, 42);
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
  assert.equal(page.win.__langformExitFullscreen("abcdefghijk"), false, "außerhalb Vollbild wird kein Toggle zum Öffnen ausgeführt");
});

test("Vollbildexit verwendet bestehendes WebKit-Video oder bestätigte Player-API und weist alte Dokumente ab", function (t) {
  const page = interactivePlayer(t);
  let showing = true;
  let webkitExits = 0;
  let toggles = 0;
  Object.defineProperty(page.video, "webkitDisplayingFullscreen", { get: () => showing });
  page.video.webkitExitFullscreen = () => { webkitExits++; showing = false; page.video.dispatchEvent(new page.win.Event("webkitendfullscreen")); };
  assert.equal(page.win.__langformMeasureVideo().fullscreen, true);
  assert.equal(page.win.__langformExitFullscreen("abcdefghijk"), true);
  assert.equal(webkitExits, 1);
  page.root.isFullscreen = () => true;
  page.root.toggleFullscreen = () => { toggles++; };
  page.root.getVideoData = () => ({ video_id: "old-video" });
  assert.equal(page.win.__langformExitFullscreen("abcdefghijk"), false);
  page.root.getVideoData = () => ({ video_id: "abcdefghijk" });
  assert.equal(page.win.__langformExitFullscreen("abcdefghijk"), true);
  assert.equal(toggles, 1);
  page.win.dispatchEvent(new page.win.Event("pagehide"));
  assert.equal(page.timers.size, 0);
  assert.equal(page.win.__langformExitFullscreen("abcdefghijk"), false);
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });

  const stale = interactivePlayer(t);
  let exits = 0;
  stale.root.isFullscreen = () => true;
  stale.root.toggleFullscreen = () => { exits++; };
  stale.win.history.replaceState({}, "", "/watch?v=lmnopqrstuv");
  assert.equal(stale.win.__langformExitFullscreen("lmnopqrstuv"), false, "URL allein bestätigt keine Medien eines wiederverwendeten Dokuments");
  stale.video.remove();
  assert.equal(stale.win.__langformExitFullscreen("lmnopqrstuv"), false);
  assert.equal(exits, 0);
});

test("abgelehnter oder fehlender Vollbildexit startet keine automatische Wiederholung", async function (t) {
  const page = interactivePlayer(t);
  let requests = 0;
  Object.defineProperty(page.doc, "fullscreenElement", { get: () => page.root });
  assert.equal(page.win.__langformExitFullscreen("abcdefghijk"), false, "ohne Exit-Capability bleibt der bestehende Player unverändert");
  page.doc.exitFullscreen = () => { requests++; return Promise.reject(new Error("NotAllowed")); };
  assert.equal(page.win.__langformExitFullscreen("abcdefghijk"), true);
  await Promise.resolve();
  assert.equal(requests, 1);
  assert.equal(page.timers.size, 0);
  assert.equal(page.win.__langformMeasureVideo().fullscreen, true);
  assert.equal(page.win.__langformExitFullscreen("abcdefghijk"), true, "erst ein zweiter ausdrücklicher Auftrag versucht neu");
  await Promise.resolve();
  assert.equal(requests, 2);
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
});

test("ein WebKit-Exit ohne Endevent löst nur seine zeitliche Auftragssperre und versucht nie von selbst neu", function (t) {
  const page = interactivePlayer(t);
  let requests = 0;
  Object.defineProperty(page.doc, "webkitFullscreenElement", { get: () => page.root });
  page.doc.webkitExitFullscreen = () => { requests++; };
  assert.equal(page.win.__langformExitFullscreen("abcdefghijk"), true);
  assert.equal(page.win.__langformExitFullscreen("abcdefghijk"), false);
  const [id, deadline] = Array.from(page.timers.entries()).find(([, timer]) => timer.delay === 1000);
  page.timers.delete(id);
  deadline.callback();
  assert.equal(requests, 1, "keine automatische Exit-Schleife nach dem Timeout");
  assert.equal(page.win.__langformMeasureVideo().fullscreen, true);
  assert.equal(page.win.__langformExitFullscreen("abcdefghijk"), true);
  assert.equal(requests, 2, "ein neuer bewusster Nutzerauftrag darf erneut versuchen");
  page.win.dispatchEvent(new page.win.Event("pagehide"));
  assert.equal(page.timers.size, 0);
});

test("späte Exit-Promises des vorherigen Videos lösen keinen neuen Vollbildauftrag", async function (t) {
  const page = interactivePlayer(t);
  const completions = [];
  let id = "abcdefghijk";
  page.root.getVideoData = () => ({ video_id: id });
  Object.defineProperty(page.doc, "fullscreenElement", { get: () => page.root });
  page.doc.exitFullscreen = () => new Promise(resolve => { completions.push(resolve); });
  assert.equal(page.win.__langformExitFullscreen(id), true);
  id = "lmnopqrstuv";
  page.win.history.replaceState({}, "", "/watch?v=" + id);
  page.win.dispatchEvent(new page.win.Event("state-navigateend"));
  assert.equal(page.win.__langformExitFullscreen(id), true);
  completions[0]();
  await Promise.resolve();
  assert.equal(page.win.__langformExitFullscreen(id), false, "der alte Abschluss darf die aktuelle Auftragssperre nicht freigeben");
  completions[1]();
  await Promise.resolve();
  assert.equal(page.win.__langformExitFullscreen(id), true);
  assert.equal(completions.length, 3);
  assert.deepEqual(page.counts(), { controls: 0, plays: 0, pauses: 0 });
});

test("vorbereitete Startseite verwendet keinen Routerpfad aus einem suspendierten Home-Player", function (t) {
  const page = navigationPlayer(t);
  page.route("");
  page.win.history.replaceState({}, "", "/");
  assert.equal(page.win.__langformNavigateWatch("https://m.youtube.com/watch?v=lmnopqrstuv", "", "warm-1"), false);
  assert.deepEqual(page.routes, []);
});
