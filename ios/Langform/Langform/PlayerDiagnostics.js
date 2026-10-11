// Opt-in observer, installed before player scripts only for a diagnostic launch.
// No playback calls, layout reads, touch coordinates, URLs, titles or media IDs.
(function (win) {
  var bridge = win.webkit && win.webkit.messageHandlers.langformPlayerDiagnostics;
  if (!bridge || win.__langformPlayerDiagnostics) return;
  if (win.location.protocol !== "https:" || !/^(m\.|www\.)?youtube\.com$/.test(win.location.hostname)) return;
  win.__langformPlayerDiagnostics = true;
  var doc = win.document, active = true, rows = [], count = 0, flushTimer = 0, afterTimer = 0;
  var route = 0, previousID = "", lastProgress = -Infinity;
  var mediaEvents = ["loadstart", "loadedmetadata", "loadeddata", "play", "playing", "pause", "waiting", "stalled", "canplay", "seeking", "seeked", "emptied", "ended", "error", "webkitbeginfullscreen", "webkitendfullscreen", "progress", "timeupdate"];
  var touchEvents = ["pointerdown", "pointerup", "touchstart", "touchend", "click"];

  function context() {
    if (win.location.pathname !== "/watch") return null;
    var id = new URL(win.location.href).searchParams.get("v");
    if (!id) return null;
    if (id !== previousID) { previousID = id; route++; lastProgress = -Infinity; }
    var root = doc.getElementById("movie_player");
    var container = root || doc.querySelector("ytm-player") || doc.querySelector("ytd-player");
    return { id:id, root:root, video:container && (container.querySelector("video.html5-main-video") || container.querySelector("video")) };
  }
  function number(value) { return typeof value === "number" && isFinite(value) ? value : -1; }
  function quality(value) { return /^(auto|tiny|small|medium|large|hd720|hd1080|hd1440|hd2160|highres)$/.test(value || "") ? value : "unknown"; }
  function snapshot(ctx) {
    var video = ctx.video, root = ctx.root, ahead = 0, state = -2, matches = false, actual = "unknown", cap = "unknown", manual = false;
    try {
      if (root && typeof root.getVideoData === "function") matches = root.getVideoData().video_id === ctx.id;
      if (root && typeof root.getPlayerState === "function") state = number(root.getPlayerState());
      if (typeof win.__langformGetQualityStatus === "function") {
        var status = win.__langformGetQualityStatus();
        actual = quality(status.actual); cap = quality(status.requestedCap); manual = status.mode === "manual";
      }
      if (video) for (var i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime)
          ahead = Math.max(ahead, video.buffered.end(i) - video.currentTime);
      }
    } catch (err) { /* A player being replaced must not disrupt the page. */ }
    var toggle = doc.getElementById("player-controls-a11y-toggle");
    return {
      route: route, hasVideo: !!video, playerMatches: matches, playerState: state,
      paused: video ? video.paused : false, seeking: video ? video.seeking : false,
      readyState: video ? video.readyState : -1, networkState: video ? video.networkState : -1,
      currentTime: video ? number(video.currentTime) : -1, bufferAhead: number(ahead),
      errorCode: video && video.error ? number(video.error.code) : 0,
      actualQuality: actual, requestedCap: cap, manualQuality: manual,
      controlsToggle: !!(toggle && toggle.tagName === "BUTTON" && !toggle.disabled && toggle.getAttribute("aria-disabled") !== "true"),
      hidden: doc.hidden,
      pageInert: !!(root && root.closest("[inert]")) || !!(doc.body && doc.body.hasAttribute("inert")),
      nativeVideoFullscreen: !!(video && (video.webkitDisplayingFullscreen || video.webkitPresentationMode === "fullscreen")),
      documentFullscreen: !!(doc.fullscreenElement || doc.webkitFullscreenElement),
      fullscreenUI: !!doc.getElementById("langform-fullscreen-ui"),
      fullscreenMarked: doc.documentElement.hasAttribute("data-langform-fullscreen")
    };
  }
  function flush() {
    win.clearTimeout(flushTimer); flushTimer = 0;
    if (!rows.length) return;
    var batch = rows; rows = [];
    try { bridge.postMessage(batch); } catch (err) { stop(); }
  }
  function record(event, target, trusted, prevented, details) {
    if (!active) return;
    var ctx = context();
    if (!ctx) return;
    var row = snapshot(ctx);
    row.event = event; row.target = target; row.trusted = trusted; row.prevented = prevented;
    if (details) {
      row.fullscreenAPI = details.name;
      row.apiIntercepted = details.intercepted;
      row.nativeDragging = !!(win.__langformIsNativeDragging && win.__langformIsNativeDragging());
      row.nativeMini = !!(win.__langformStageInsets && win.__langformStageInsets.nativeMini);
    }
    row.sequence = ++count; row.documentEpoch = number(win.performance.timeOrigin);
    row.documentMilliseconds = win.performance.now(); row.unixMilliseconds = Date.now();
    rows.push(row);
    if (count >= 240) stop();
    else if (rows.length >= 16) flush();
    else if (!flushTimer) flushTimer = win.setTimeout(flush, 160);
  }
  function recordFullscreenAPI(name, intercepted) {
    if (!/^(requestFullscreen|webkitRequestFullscreen|webkitRequestFullScreen|webkitEnterFullscreen|webkitEnterFullScreen)$/.test(name)) return;
    record("fullscreen-api", "media", false, false, {name:name,intercepted:intercepted === true});
  }
  win.__langformRecordFullscreenAPI = recordFullscreenAPI;
  function onMedia(event) {
    var ctx = context();
    if (!ctx || event.target !== ctx.video) return;
    if (event.type === "timeupdate" || event.type === "progress") {
      var now = win.performance.now();
      if (now - lastProgress < 1000) return;
      lastProgress = now;
    }
    record(event.type, "media", event.isTrusted, event.defaultPrevented);
  }
  function targetKind(event) {
    var path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    if (!path.some(function (node) { return node && (node.id === "movie_player" || node.id === "player-control-overlay" || /^(VIDEO|YTM-PLAYER|YTD-PLAYER|YTM-CUSTOM-CONTROL)$/.test(node.tagName)); })) return null;
    if (path.some(function (node) { return node && node.nodeType === 1 && (/^(BUTTON|INPUT|A|SELECT)$/.test(node.tagName) || /^(button|slider|link|menuitem)$/.test(node.getAttribute("role") || "")); })) return "control";
    return event.target && event.target.tagName === "VIDEO" ? "video" : "surface";
  }
  function onTouch(event) {
    var kind = targetKind(event);
    var before = context();
    // An inert page retargets its touches outside the player. Keep those
    // inputs observable without recording content, coordinates or URLs.
    if (!kind && before && before.root && before.root.closest("[inert]")) kind = "surface";
    if (!kind || !before) return;
    record(event.type, kind, event.isTrusted, event.defaultPrevented);
    // PlayerRect can synchronously click YouTube's controls toggle. Keep the
    // original input's after-state instead of replacing it with that nested click.
    if (active && /^(click|touchend|pointerup)$/.test(event.type) && (event.isTrusted || !afterTimer)) {
      win.clearTimeout(afterTimer);
      afterTimer = win.setTimeout(function () {
        afterTimer = 0;
        var after = context();
        if (!after || after.id !== before.id || after.video !== before.video) return;
        record("after-input", kind, event.isTrusted, event.defaultPrevented);
      }, 0);
    }
  }
  function stop() {
    if (!active) return;
    active = false;
    if (win.__langformRecordFullscreenAPI === recordFullscreenAPI) delete win.__langformRecordFullscreenAPI;
    win.clearTimeout(deadline); win.clearTimeout(afterTimer);
    mediaEvents.forEach(function (name) { doc.removeEventListener(name, onMedia, true); });
    touchEvents.forEach(function (name) { win.removeEventListener(name, onTouch, true); });
    win.removeEventListener("pagehide", stop);
    flush();
  }
  mediaEvents.forEach(function (name) { doc.addEventListener(name, onMedia, { capture: true, passive: true }); });
  touchEvents.forEach(function (name) { win.addEventListener(name, onTouch, { capture: true, passive: true }); });
  win.addEventListener("pagehide", stop, { once: true });
  var deadline = win.setTimeout(stop, 90000);
})(window);
