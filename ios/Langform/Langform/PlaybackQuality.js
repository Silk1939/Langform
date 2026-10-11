// Player-only policy. Leave YouTube's initial rendition alone until a frame is
// actually presented, then keep adaptive bitrate selection inside a network cap.
// This is the website's feature-detected range API, NOT the obsolete iframe
// setPlaybackQuality API (which is a no-op in the inspected player source).
(function (win) {
  if (!win || !win.document || win.__langformQuality) return;
  if (!/^(m\.|www\.)?youtube\.com$/.test(win.location.hostname)) return;
  win.__langformQuality = true;
  var doc = win.document;
  var network = { online: null, expensive: false, constrained: false, interface: "other" };
  var levels = ["small", "medium", "large", "hd720", "hd1080"];
  var active = true;
  var id = "";
  var root = null;
  var applied = "";
  var acknowledged = false;
  var manual = false;
  var ceiling = 3;
  var stableSince = 0;
  var lastSample = 0;
  var waitingTimer = 0;
  var discoveryTimer = 0;
  var discoveries = 0;
  var applying = false;
  var hookedRoot = null;
  var originalRange = null;
  var rangeHook = null;
  var pictureVideo = null;
  var pictureID = "";
  var pictureSource = "";
  var pictureGeneration = 0;
  var pictureRequest = null;
  var pictureReady = false;
  var pictureObservationFailed = false;
  var preferenceReset = false;

  function unhook() {
    if (hookedRoot && hookedRoot.setPlaybackQualityRange === rangeHook) {
      try { hookedRoot.setPlaybackQualityRange = originalRange; } catch (err) {}
    }
    hookedRoot = null; originalRange = null; rangeHook = null;
  }
  function observeSelection(candidate) {
    if (hookedRoot === candidate && candidate.setPlaybackQualityRange === rangeHook) return;
    unhook();
    var original = candidate.setPlaybackQualityRange;
    // The inspected mweb playerSettingsMenu (Nxd3uf) chooses a rendition with
    // setPlaybackQualityRange(c, c), even when c already equals our upper cap.
    // Observe that exact intent transparently; ABR current-quality events are
    // not manual choices and must not disable automatic adaptation.
    var wrapped = function (minimum, maximum) {
      if (!applying && active && candidate === root && videoID() === id &&
          typeof minimum === "string" && minimum === maximum) {
        manual = true;
        clearWaiting();
      }
      return original.apply(this, arguments);
    };
    try {
      candidate.setPlaybackQualityRange = wrapped;
      if (candidate.setPlaybackQualityRange === wrapped) {
        hookedRoot = candidate; originalRange = original; rangeHook = wrapped;
      }
    } catch (err) { /* read-only future APIs retain preference-based detection */ }
  }

  function videoID() {
    try { return win.location.pathname === "/watch" ? new URL(win.location.href).searchParams.get("v") || "" : ""; }
    catch (err) { return ""; }
  }
  function startCeiling() {
    return network.constrained ? 1 : network.expensive || network.interface === "cellular" ? 2 : 3;
  }
  function maxCeiling() {
    return network.constrained ? 1 : network.expensive || network.interface === "cellular" ? 3 :
      /^(wifi|wired)$/.test(network.interface) ? 4 : 3;
  }
  function clearWaiting() {
    if (waitingTimer) win.clearTimeout(waitingTimer);
    waitingTimer = 0;
  }
  function forgetPicture() {
    pictureGeneration += 1;
    if (pictureRequest !== null && pictureVideo && typeof pictureVideo.cancelVideoFrameCallback === "function") {
      try { pictureVideo.cancelVideoFrameCallback(pictureRequest); } catch (err) {}
    }
    pictureRequest = null; pictureVideo = null; pictureID = ""; pictureSource = ""; pictureReady = false;
    pictureObservationFailed = false;
    clearWaiting(); stableSince = 0;
  }
  function reset() {
    forgetPicture();
    id = videoID(); root = null; applied = ""; acknowledged = false; manual = false;
    ceiling = startCeiling(); stableSince = 0; lastSample = 0; discoveries = 0;
    preferenceReset = false;
    clearWaiting();
  }
  function player() {
    if (!active || !id || videoID() !== id) return null;
    var candidate = doc.getElementById("movie_player");
    if (!candidate || typeof candidate.setPlaybackQualityRange !== "function" ||
        typeof candidate.getVideoData !== "function") return null;
    try { if (candidate.getVideoData().video_id !== id) return null; } catch (err) { return null; }
    if (root !== candidate) { forgetPicture(); root = candidate; applied = ""; acknowledged = false; }
    observeSelection(candidate);
    return candidate;
  }
  function media() { return root && root.querySelector("video"); }
  function isAd() {
    if (!root) return false;
    if (root.classList.contains("ad-showing") || root.classList.contains("ad-interrupting")) return true;
    try { return root.getVideoData().isAd === true; } catch (err) { return false; }
  }
  function remote(video) {
    return !!(video && (video.webkitCurrentPlaybackTargetIsWireless || video.remote && video.remote.state === "connected"));
  }
  function preferred() {
    try { return typeof root.getPreferredQuality === "function" ? root.getPreferredQuality() : ""; }
    catch (err) { return ""; }
  }
  function observePicture() {
    var video = media();
    var source = video && (video.currentSrc || video.src || "") || "";
    if (pictureVideo !== video || pictureID !== id || pictureSource !== source) {
      forgetPicture(); pictureVideo = video; pictureID = id; pictureSource = source;
    }
    if (!video || pictureReady || pictureObservationFailed || pictureRequest !== null || manual || isAd() || remote(video) ||
        video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0 ||
        typeof video.requestVideoFrameCallback !== "function") return;
    var expectedID = id, expectedRoot = root, expectedSource = source;
    var token = pictureGeneration;
    try {
      pictureRequest = video.requestVideoFrameCallback(function () {
        if (token !== pictureGeneration) return;
        pictureRequest = null;
        // The same element may be reused for another source. Load boundaries,
        // root replacement and navigation each invalidate this callback.
        if (!active || id !== expectedID || videoID() !== expectedID || !player() || root !== expectedRoot ||
            token !== pictureGeneration || video !== media() || video !== pictureVideo ||
            (video.currentSrc || video.src || "") !== expectedSource ||
            video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0 ||
            video.seeking || video.error || isAd() || remote(video)) return;
        pictureReady = true;
        stableSince = Date.now();
        apply();
      });
    } catch (err) {
      // Future/unsupported players retain YouTube's original quality policy.
      pictureRequest = null;
      pictureObservationFailed = true;
    }
  }
  function apply() {
    if (!player() || manual || network.online === false || isAd() || remote(media())) return false;
    observePicture();
    if (!pictureReady || pictureVideo !== media() || pictureID !== id) return false;
    var preference = preferred();
    if (applied && preference === applied) acknowledged = true;
    // The preferred quality is a selection, unlike the actual quality, which
    // the ABR engine changes all the time. Never fight a later manual choice.
    if (applied && acknowledged && preference && preference !== applied) {
      manual = true; clearWaiting(); return false;
    }
    var next = levels[ceiling];
    if (applied === next) return true;
    try {
      // Do not reset the current startup target while its first frame is still
      // pending. Only this watch's later adaptive policy clears the old choice;
      // cookies, bandwidth history and a current manual choice stay untouched.
      if (!preferenceReset) {
        try { win.localStorage.removeItem("yt-player-quality"); } catch (err) {}
        try { win.sessionStorage.removeItem("yt-player-quality"); } catch (err) {}
        preferenceReset = true;
      }
      // A zero/auto minimum keeps lower renditions available on a slow link.
      applying = true;
      try { root.setPlaybackQualityRange("auto", next); } finally { applying = false; }
      applied = next; acknowledged = preferred() === next;
      return true;
    } catch (err) { return false; }
  }
  function discover() {
    discoveryTimer = 0;
    if (!active || !id) return;
    // Finding a player is enough: its one-shot frame acknowledgement and media
    // events own readiness. Do not poll or repeatedly alter its startup target.
    if (player()) { apply(); return; }
    // Bounded bootstrap only; media events handle late players after this.
    if (!manual && ++discoveries < 20) discoveryTimer = win.setTimeout(discover, 250);
  }
  function bufferAhead(video) {
    try {
      for (var i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) >= video.currentTime)
          return video.buffered.end(i) - video.currentTime;
      }
    } catch (err) {}
    return 0;
  }
  function relevant(event) {
    return player() && event.target === media() && !isAd() && !remote(event.target);
  }
  function sample(event) {
    if (!relevant(event)) return;
    apply();
    if (!pictureReady) return;
    var now = Date.now();
    if (now - lastSample < 2000) return;
    lastSample = now;
    var video = event.target;
    if (manual || network.online === false || video.paused || video.seeking || video.readyState < 3) { stableSince = 0; return; }
    if (!stableSince) stableSince = now;
    if (now - stableSince >= 20000 && bufferAhead(video) >= 12 && ceiling < maxCeiling()) {
      ceiling += 1; stableSince = now; apply();
    }
  }
  function waiting(event) {
    if (!relevant(event) || !pictureReady || pictureVideo !== event.target || manual ||
        network.online === false || event.target.paused || event.target.seeking) return;
    stableSince = 0;
    if (waitingTimer) return;
    var video = event.target;
    var expectedID = id;
    waitingTimer = win.setTimeout(function () {
      waitingTimer = 0;
      if (!active || id !== expectedID || !player() || video !== media() || video.paused || video.seeking ||
          video.readyState >= 3 || manual || network.online === false || isAd() || remote(video)) return;
      ceiling = Math.max(0, ceiling - 1); apply();
    }, 1500);
  }
  function ready(event) {
    if (!relevant(event)) return;
    clearWaiting();
    apply();
    if (pictureReady) stableSince = Date.now();
  }
  win.__langformSetNetworkPolicy = function (value) {
    if (!value || typeof value !== "object") return;
    var oldStart = startCeiling();
    network = {
      online: typeof value.online === "boolean" ? value.online : null,
      expensive: value.expensive === true, constrained: value.constrained === true,
      interface: /^(wifi|cellular|wired|other)$/.test(value.interface) ? value.interface : "other"
    };
    // A better path earns a higher resolution only after actual buffered
    // playback. A more restricted path lowers the ceiling immediately.
    ceiling = applied ? Math.min(ceiling, startCeiling() < oldStart ? startCeiling() : maxCeiling()) : startCeiling();
    stableSince = 0;
    if (network.online === false) clearWaiting();
    apply();
  };
  win.__langformGetQualityStatus = function () {
    var actual = "";
    try { actual = root && typeof root.getPlaybackQuality === "function" ? root.getPlaybackQuality() : ""; } catch (err) {}
    return { mode: manual ? "manual" : "adaptive", requestedCap: applied, confirmedCap: acknowledged ? applied : "", actual: actual || "", network: network };
  };
  ["loadstart", "loadedmetadata", "emptied"].forEach(function (name) {
    doc.addEventListener(name, function (event) {
      // Invalidate even while an ad or remote source owns this same element.
      if (player() && event.target === media()) { forgetPicture(); apply(); }
    }, true);
  });
  doc.addEventListener("loadeddata", function (event) { if (relevant(event)) apply(); }, true);
  ["timeupdate", "progress"].forEach(function (name) { doc.addEventListener(name, sample, true); });
  ["waiting", "stalled"].forEach(function (name) { doc.addEventListener(name, waiting, true); });
  ["playing", "canplay"].forEach(function (name) { doc.addEventListener(name, ready, true); });
  ["pause", "ended", "seeking"].forEach(function (name) {
    doc.addEventListener(name, function (event) { if (relevant(event)) { clearWaiting(); stableSince = 0; } }, true);
  });
  function navigate() {
    if (videoID() !== id) reset();
    if (discoveryTimer) win.clearTimeout(discoveryTimer);
    discover();
  }
  win.addEventListener("yt-navigate-finish", navigate);
  win.addEventListener("state-navigateend", navigate);
  doc.addEventListener("DOMContentLoaded", navigate, { once: true });
  win.addEventListener("pagehide", function () {
    active = false; clearWaiting();
    forgetPicture();
    unhook();
    if (discoveryTimer) win.clearTimeout(discoveryTimer);
    discoveryTimer = 0;
  });
  win.addEventListener("pageshow", function () { active = true; navigate(); });
  reset();
  discover();
})(window);
