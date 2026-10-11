const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");
const source = fs.readFileSync(require("node:path").join(__dirname, "../ios/Langform/Langform/PlaybackQuality.js"), "utf8");

function page(t, options = {}) {
  const dom = new JSDOM('<div id="movie_player"><video></video></div>', {
    url: "https://m.youtube.com/watch?v=abcdefghijk", runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  const win = dom.window, root = win.document.getElementById("movie_player"), video = root.querySelector("video");
  let now = 10000, serial = 0, preference = "hd2160", playerID = options.mismatch ? "other-video" : "abcdefghijk";
  const timers = new Map(), frames = new Map(), cancelledFrames = [], calls = [], resets = [], frameRequests = [];
  const state = { paused: false, seeking: false, readyState: 4, currentTime: 10, ahead: 20, videoWidth: 1280, videoHeight: 720, currentSrc: "first-source.mp4" };
  function configureMedia(element) {
    Object.keys(state).filter(k => k !== "ahead").forEach(k => Object.defineProperty(element, k, { get: () => state[k] }));
    Object.defineProperty(element, "buffered", { get: () => ({ length: 1, start: () => 0, end: () => state.currentTime + state.ahead }) });
    element.play = element.pause = () => { throw new Error("quality must never change playback intent"); };
    if (!options.noFrames) {
      element.requestVideoFrameCallback = fn => {
        frameRequests.push(element);
        if (options.throwFrames) throw new Error("unsupported frame observer");
        const key = ++serial; frames.set(key, { fn, element }); return key;
      };
      element.cancelVideoFrameCallback = key => { cancelledFrames.push(key); frames.delete(key); };
    }
    return element;
  }
  configureMedia(video);
  root.getVideoData = () => ({ video_id: playerID });
  root.getPreferredQuality = () => preference;
  root.getPlaybackQuality = () => "large";
  if (!options.unsupported) root.setPlaybackQualityRange = (min, max) => { calls.push([min, max]); preference = max; };
  win.localStorage.setItem("yt-player-quality", "old4K");
  win.sessionStorage.setItem("yt-player-quality", "old4K");
  win.localStorage.setItem("yt-player-bandwidth", "unchanged");
  const removeItem = win.Storage.prototype.removeItem;
  win.Storage.prototype.removeItem = function (key) { resets.push(key); return removeItem.call(this, key); };
  win.Date.now = () => now;
  win.setTimeout = (fn, delay) => { const key = ++serial; timers.set(key, { fn, at: now + delay }); return key; };
  win.clearTimeout = key => timers.delete(key);
  win.eval(source);
  function picture() {
    for (const [key, frame] of [...frames]) {
      frames.delete(key); frame.fn(now, { mediaTime: state.currentTime });
    }
  }
  if (!options.deferPicture) picture();
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = end;
  }
  return { win, root, video, state, calls, timers, frames, frameRequests, cancelledFrames, resets, advance, picture, configureMedia,
    emit: type => video.dispatchEvent(new win.Event(type)),
    network: value => win.__langformSetNetworkPolicy(value),
    preference: value => { preference = value; },
    playerID: value => { playerID = value; },
    status: () => JSON.parse(JSON.stringify(win.__langformGetQualityStatus())) };
}

test("Start erhält die aktuelle Qualität bis zum ersten tatsächlich dargestellten Bild", t => {
  const p = page(t, { deferPicture: true });
  assert.equal(p.win.localStorage.getItem("yt-player-quality"), "old4K");
  assert.equal(p.win.sessionStorage.getItem("yt-player-quality"), "old4K");
  assert.deepEqual(p.calls, []);
  assert.deepEqual(p.resets, []);
  assert.equal(p.status().confirmedCap, "");
  p.emit("playing"); p.emit("canplay"); p.emit("loadeddata");
  p.state.readyState = 2; p.emit("waiting"); p.emit("stalled");
  p.advance(10000); p.emit("progress");
  assert.deepEqual(p.calls, [], "Playing, decodierte Daten und lange Startwartezeit sind kein dargestelltes Bild");
  assert.deepEqual(p.resets, [], "auch keine vorzeitigen Preference-Reset-Schreibzugriffe");
  assert.equal(p.frames.size, 1, "ein Frame-Observer, kein Polling pro Media-Event");
  p.state.readyState = 4; p.picture();
  assert.equal(p.win.localStorage.getItem("yt-player-quality"), null);
  assert.equal(p.win.sessionStorage.getItem("yt-player-quality"), null);
  assert.deepEqual(p.resets, ["yt-player-quality", "yt-player-quality"]);
  assert.equal(p.win.localStorage.getItem("yt-player-bandwidth"), "unchanged");
  assert.deepEqual(p.calls, [["auto", "hd720"]]);
  assert.equal(p.status().confirmedCap, "hd720");
  assert.equal(p.status().actual, "large", "Ist-Auflösung wird nicht aus gewünschter Obergrenze erfunden");
  assert.equal(p.video.getAttribute("style"), null);
});

test("Netzwerkhinweise planen den späteren Cap und lassen das initiale HD-Ziel unangetastet", t => {
  const p = page(t, { deferPicture: true });
  p.network({ online: true, interface: "wifi" });
  p.network({ online: true, expensive: true, interface: "cellular" });
  p.emit("playing"); p.advance(25000); p.emit("timeupdate");
  assert.deepEqual(p.calls, []);
  assert.deepEqual(p.resets, []);
  p.picture();
  assert.deepEqual(p.calls, [["auto", "large"]]);
  p.network({ online: true, interface: "wifi" });
  p.emit("playing"); p.advance(20001); p.emit("progress");
  assert.deepEqual(p.calls.at(-1), ["auto", "hd720"], "HD-Aufstieg nach stabilem Puffer bleibt erhalten");
});

test("Eine manuelle Wahl vor dem ersten Bild wird weder zurückgesetzt noch durch einen Cap ersetzt", t => {
  const p = page(t, { deferPicture: true });
  p.root.setPlaybackQualityRange("hd1080", "hd1080");
  p.picture();
  p.network({ online: true, constrained: true, interface: "cellular" });
  p.emit("playing"); p.advance(30000); p.emit("progress");
  assert.equal(p.status().mode, "manual");
  assert.deepEqual(p.calls, [["hd1080", "hd1080"]], "nur der unveränderte Website-Aufruf findet statt");
  assert.deepEqual(p.resets, []);
  assert.equal(p.win.localStorage.getItem("yt-player-quality"), "old4K");
});

test("Wiederverwendete Quellen und ersetzte Media-Nodes verwerfen alte Frame-Rückgaben", t => {
  const p = page(t, { deferPicture: true });
  const staleSource = [...p.frames.values()][0].fn;
  p.state.currentSrc = "second-source.mp4";
  p.emit("loadstart"); p.emit("loadedmetadata");
  assert.equal(p.frames.size, 1);
  assert.ok(p.cancelledFrames.length >= 1);
  staleSource();
  assert.deepEqual(p.calls, []);
  assert.deepEqual(p.resets, []);
  const staleNode = [...p.frames.values()][0].fn;
  const replacement = p.configureMedia(p.win.document.createElement("video"));
  p.video.replaceWith(replacement);
  replacement.dispatchEvent(new p.win.Event("loadeddata"));
  staleNode();
  assert.deepEqual(p.calls, []);
  assert.deepEqual(p.resets, []);
  p.picture();
  assert.deepEqual(p.calls, [["auto", "hd720"]]);
});

test("Auch eine bereits dargestellte Media-Node braucht nach Quellenwechsel ihren eigenen neuen Frame", t => {
  const p = page(t);
  p.state.currentSrc = "new-source-without-load-event.mp4";
  p.network({ online: true, constrained: true, interface: "cellular" });
  p.emit("playing");
  assert.deepEqual(p.calls, [["auto", "hd720"]], "das alte dargestellte Bild bestätigt keine neue Quelle");
  assert.equal(p.frames.size, 1);
  p.picture();
  assert.deepEqual(p.calls.at(-1), ["auto", "medium"]);
});

test("Quelle ohne Load-Event, falsche Video-ID, Ad und Pagehide bestätigen keine alte First-Picture-Anfrage", t => {
  for (const mutation of ["source", "id", "ad", "hide"]) {
    const p = page(t, { deferPicture: true });
    const callback = [...p.frames.values()][0].fn;
    if (mutation === "source") p.state.currentSrc = "silently-replaced.mp4";
    if (mutation === "id") p.playerID("different-video");
    if (mutation === "ad") p.root.classList.add("ad-showing");
    if (mutation === "hide") p.win.dispatchEvent(new p.win.Event("pagehide"));
    callback();
    p.network({ online: true, interface: "wifi" });
    assert.deepEqual(p.calls, [], mutation);
    assert.deepEqual(p.resets, [], mutation);
  }
});

test("Ohne funktionierenden First-Frame-Observer bleibt YouTubes aktuelle Qualitätswahl unverändert", t => {
  for (const options of [{ noFrames: true }, { throwFrames: true }]) {
    const p = page(t, options);
    p.emit("playing"); p.network({ online: true, interface: "wifi" });
    p.advance(30000); p.emit("progress");
    assert.deepEqual(p.calls, []);
    assert.deepEqual(p.resets, []);
    assert.equal(p.win.localStorage.getItem("yt-player-quality"), "old4K");
    assert.equal(p.timers.size, 0);
    assert.equal(p.frameRequests.length, options.throwFrames ? 1 : 0, "fehlende Fähigkeit wird nicht laufend erneut versucht");
  }
});

test("Mobilfunk und Datensparmodus senken sofort, WLAN steigt erst nach stabilem Puffer", t => {
  const p = page(t);
  p.network({ online: true, expensive: true, constrained: false, interface: "cellular" });
  assert.equal(p.status().confirmedCap, "large");
  p.network({ online: true, expensive: false, constrained: false, interface: "wifi" });
  assert.equal(p.calls.length, 2, "WLAN allein beweist kein schnelles Internet");
  p.emit("playing"); p.advance(20001); p.emit("timeupdate");
  assert.equal(p.status().confirmedCap, "hd720");
  p.advance(20001); p.emit("timeupdate");
  assert.equal(p.status().confirmedCap, "hd1080");
  p.network({ online: true, constrained: true, interface: "wifi" });
  assert.equal(p.status().confirmedCap, "medium");
  p.emit("playing"); p.advance(60000); p.emit("timeupdate");
  assert.equal(p.status().confirmedCap, "medium");
});

test("Zu wenig Puffer oder unbekannte Verbindung erlaubt kein spekulatives 1080p/4K", t => {
  const p = page(t);
  p.emit("playing"); p.advance(60000); p.emit("timeupdate");
  assert.equal(p.calls.length, 1);
  p.network({ online: true, interface: "wifi" });
  p.state.ahead = 2; p.emit("playing"); p.advance(60000); p.emit("progress");
  assert.equal(p.calls.length, 1);
});

test("Anhaltendes echtes Buffering senkt einmal; kurze Wartezeit und Seeking nicht", t => {
  const p = page(t);
  p.state.readyState = 2; p.emit("waiting"); p.advance(400); p.emit("playing"); p.advance(2000);
  assert.equal(p.calls.length, 1);
  p.state.seeking = true; p.emit("waiting"); p.advance(2000);
  assert.equal(p.calls.length, 1);
  p.state.seeking = false; p.emit("waiting"); p.emit("stalled"); p.advance(1600);
  assert.deepEqual(p.calls.at(-1), ["auto", "large"]);
  assert.equal(p.calls.length, 2);
  p.advance(60000);
  assert.equal(p.calls.length, 2, "kein permanenter Timer oder Reload/Play-Loop");
});

test("Offline, Pause, Werbung, AirPlay und veraltete Video-IDs lösen keine Umstellung aus", t => {
  const p = page(t);
  p.state.readyState = 2;
  p.network({ online: false, interface: "wifi" }); p.emit("waiting"); p.advance(2000);
  p.network({ online: true, interface: "wifi" });
  p.state.paused = true; p.emit("waiting"); p.advance(2000);
  p.state.paused = false; p.root.classList.add("ad-showing"); p.emit("waiting"); p.advance(2000);
  p.root.classList.remove("ad-showing"); p.video.webkitCurrentPlaybackTargetIsWireless = true; p.emit("waiting"); p.advance(2000);
  p.video.webkitCurrentPlaybackTargetIsWireless = false; p.playerID("other-video"); p.emit("waiting"); p.advance(2000);
  assert.equal(p.calls.length, 1);
});

test("Manuelle Wahl im aktuellen Video bleibt auch bei Netzwechsel erhalten", t => {
  const p = page(t);
  p.advance(1100); p.preference("hd2160"); p.emit("progress");
  assert.equal(p.status().mode, "manual");
  p.network({ online: true, constrained: true, interface: "cellular" });
  p.state.readyState = 2; p.emit("waiting"); p.advance(5000);
  assert.equal(p.calls.length, 1);
});

test("Sofortige manuelle Wahl wird nicht vom nächsten Netzwerkhinweis überschrieben", t => {
  const p = page(t);
  p.advance(100); p.preference("hd2160");
  p.network({ online: true, expensive: true, interface: "cellular" });
  assert.equal(p.status().mode, "manual");
  assert.equal(p.calls.length, 1);
});

test("Manuell dieselbe aktuelle Obergrenze zu wählen bleibt eine feste Nutzerwahl", t => {
  const p = page(t);
  p.network({ online: true, interface: "wifi" });
  p.root.setPlaybackQualityRange("hd720", "hd720");
  assert.equal(p.status().mode, "manual");
  p.emit("playing"); p.advance(20001); p.emit("timeupdate");
  p.network({ online: true, constrained: true, interface: "cellular" });
  assert.deepEqual(p.calls, [["auto", "hd720"], ["hd720", "hd720"]]);
});

test("Manueller Auto-Aufruf und Wrapper-Lifecycle behalten den Website-Aufruf unverändert", t => {
  const p = page(t);
  const wrapped = p.root.setPlaybackQualityRange;
  p.root.setPlaybackQualityRange("auto", "auto");
  assert.equal(p.status().mode, "manual");
  assert.deepEqual(p.calls.at(-1), ["auto", "auto"]);
  p.win.dispatchEvent(new p.win.Event("pagehide"));
  assert.notEqual(p.root.setPlaybackQualityRange, wrapped);
  p.win.dispatchEvent(new p.win.Event("pageshow"));
  assert.equal(p.status().mode, "manual", "BFCache bleibt im selben Video bei der Auswahl");
});

test("Fehlende Website-API und falsches Video bleiben sicher und Bootstrap ist begrenzt", t => {
  for (const options of [{ unsupported: true }, { mismatch: true }]) {
    const p = page(t, options);
    p.advance(10000);
    assert.equal(p.timers.size, 0);
    assert.equal(p.calls.length, 0);
    assert.equal(p.status().confirmedCap, "");
  }
});

test("Seitenschließen beendet ausstehendes Buffering und Navigation startet neue Policy", t => {
  const p = page(t);
  p.state.readyState = 2; p.emit("waiting");
  p.win.dispatchEvent(new p.win.Event("pagehide")); p.advance(10000);
  assert.equal(p.calls.length, 1);
  p.win.history.replaceState({}, "", "/watch?v=mnopqrstuvw"); p.playerID("mnopqrstuvw");
  p.win.dispatchEvent(new p.win.Event("pageshow"));
  p.picture();
  assert.deepEqual(p.calls.at(-1), ["auto", "hd720"]);
  assert.equal(p.calls.length, 2);
});
