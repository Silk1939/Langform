// Native grants one sound intent only when the user opens a new Watch video.
// This never starts playback and does not run from media events or a timer.
(function (win) {
  "use strict";
  if (!win || !win.document || win.__langformWatchAudio) return;
  win.__langformWatchAudio = true;
  var doc = win.document, active = true, latestToken = 0, intent = null;
  function pageInactive() {
    try { var visibility=win.__langformRealVisibility; if (visibility && typeof visibility.inactive==='function') return !!visibility.inactive(); } catch (_) {}
    return !!doc.hidden;
  }

  function currentID() {
    try {
      var url = new URL(win.location.href);
      return /^(m\.|www\.)?youtube\.com$/.test(url.hostname) && url.pathname === "/watch"
        ? url.searchParams.get("v") || "" : "";
    } catch (_) { return ""; }
  }
  function source(video) { return String(video.currentSrc || video.getAttribute("src") || ""); }
  function available(id, root, video, mediaSource) {
    if (!active || pageInactive() || currentID() !== id || win.__langformSilentDiagnostics ||
        root !== doc.getElementById("movie_player") || !root.isConnected ||
        root.querySelector("video") !== video || !video.isConnected || video.error || video.ended ||
        !mediaSource || source(video) !== mediaSource ||
        (win.__langformAdMute && win.__langformAdMute.video === video) ||
        root.classList.contains("ad-showing") || root.classList.contains("ad-interrupting")) return false;
    try {
      var data = typeof root.getVideoData === "function" && root.getVideoData();
      return !!(data && data.video_id === id && !data.isAd &&
        !(win.__langformIsNativeDragging && win.__langformIsNativeDragging()) &&
        !(win.__langformHasOpenOverlay && win.__langformHasOpenOverlay()));
    } catch (_) { return false; }
  }

  // false is a deferred/rejected request; true consumes the native open intent.
  // A monotonic native load ticket prevents older callbacks from muting choices
  // in a more recently opened video. Repeated handled tickets have no writes.
  win.__langformApplyWatchAudio = function (expectedID, openToken) {
    var token = Number(openToken);
    if (!active || typeof expectedID !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(expectedID) ||
        (typeof openToken !== "string" && typeof openToken !== "number") ||
        !Number.isSafeInteger(token) || token <= 0 || token < latestToken) return false;
    if (token > latestToken) {
      latestToken = token;
      intent = { id: expectedID, token: token, handled: false };
    }
    if (!intent || intent.id !== expectedID) return false;
    if (intent.handled) return true;
    var root = doc.getElementById("movie_player"), video = root && root.querySelector("video");
    if (!root || !video) return false;
    var mediaSource = source(video);
    if (!available(expectedID, root, video, mediaSource)) return false;
    var report;
    try { report = win.__langformMeasureVideo && win.__langformMeasureVideo(); } catch (_) { return false; }
    if (!report || report.hasVideo !== true || report.playerVideoID !== expectedID || report.playbackIssue ||
        (report.navigationToken && (String(report.navigationToken) !== String(token) ||
          report.navigationTargetID !== expectedID || !report.navigationStarted ||
          !report.navigationComplete || !report.navigationMediaLoaded)) ||
        !available(expectedID, root, video, mediaSource)) return false;
    // A deliberate pause while the initial media was loading also cancels this
    // intent. A subsequent Resume must retain that video's chosen sound state.
    if (video.paused && (Number(video.currentTime) > 0 || report.playbackState === "paused")) {
      intent.handled = true;
      return true;
    }
    // Claim before any website callback. A reentrant status or later volume
    // selection cannot run another initial sound request for this same open.
    intent.handled = true;
    try {
      var apiMuted = video.muted;
      try { if (typeof root.isMuted === "function") apiMuted = root.isMuted(); } catch (_) {}
      if (!available(expectedID, root, video, mediaSource)) return false;
      if ((apiMuted || video.muted) && typeof root.unMute === "function") {
        try { root.unMute(); } catch (_) { /* exact media is the fallback */ }
      }
      if (!available(expectedID, root, video, mediaSource)) return false;
      if (video.muted) video.muted = false;
      if (!available(expectedID, root, video, mediaSource)) return false;
      var volume = null;
      try { if (typeof root.getVolume === "function") volume = root.getVolume(); } catch (_) {}
      if (!available(expectedID, root, video, mediaSource)) return false;
      // Positive website/media volume remains the user's current level. Only
      // a zero player level inherited at opening needs a nonzero default.
      if (typeof volume === "number" && volume === 0 && typeof root.setVolume === "function") {
        try { root.setVolume(100); } catch (_) { /* exact media is the fallback */ }
      }
      if (!available(expectedID, root, video, mediaSource)) return false;
      if (video.volume === 0) video.volume = 1;
      return true;
    } catch (_) { return false; }
  };
  win.addEventListener("pagehide", function () { active = false; intent = null; });
  ['visibilitychange','langform-real-visibilitychange'].forEach(function(name){doc.addEventListener(name,function () { if (pageInactive()) intent = null; });});
})(typeof window !== "undefined" ? window : null);
