// Editing-style transport keys for the browser extension. Native iPhone
// playback has its own controls and does not load this script.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else if (root && root.document) api.install(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var FLAG = "__langformPlaybackShortcuts";

  function editable(node) {
    while (node && node.nodeType === 1) {
      var tag = node.tagName;
      var role = node.getAttribute("role");
      var content = node.getAttribute("contenteditable");
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
          node.isContentEditable || (content != null && content !== "false") ||
          role === "textbox" || role === "combobox" ||
          node.getAttribute("aria-modal") === "true" || tag === "DIALOG") return true;
      var root = node.getRootNode && node.getRootNode();
      node = node.parentElement || (root && root.host);
    }
    return false;
  }

  function typing(win, event) {
    var path = event.composedPath ? event.composedPath() : [event.target];
    for (var i = 0; i < path.length; i++) if (editable(path[i])) return true;
    var active = win.document.activeElement;
    while (active) {
      if (editable(active)) return true;
      active = active.shadowRoot && active.shadowRoot.activeElement;
    }
    var dialogs = win.document.querySelectorAll('dialog[open], [aria-modal="true"]');
    for (var d = 0; d < dialogs.length; d++) if (shown(win, dialogs[d])) return true;
    return false;
  }

  function shown(win, node) {
    while (node && node.nodeType === 1) {
      if (node.hidden) return false;
      var css = win.getComputedStyle(node);
      if (css.display === "none" || css.visibility === "hidden" || css.visibility === "collapse") return false;
      node = node.parentElement;
    }
    return true;
  }

  function mainMedia(win) {
    var roots = win.document.querySelectorAll("#movie_player, ytd-player, ytm-player, #player-container-id, .html5-video-player");
    for (var i = 0; i < roots.length; i++) {
      var player = roots[i];
      if (!shown(win, player) || player.classList.contains("ad-showing") ||
          player.classList.contains("ad-interrupting") ||
          player.querySelector(".ad-showing, .ad-interrupting")) continue;
      var videos = player.querySelectorAll("video.html5-main-video, video");
      for (var v = 0; v < videos.length; v++) {
        var video = videos[v];
        if (!video.isConnected || !shown(win, video) || video.error || Number(video.readyState) < 1) continue;
        var rect = video.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) continue;
        return { video: video };
      }
    }
    return null;
  }

  function backTarget(video) {
    var time = Number(video.currentTime);
    if (!isFinite(time)) return null;
    var target = Math.max(0, time - 5);
    var ranges = video.seekable;
    if (ranges && ranges.length) {
      for (var i = ranges.length - 1; i >= 0; i--) {
        if (target >= ranges.start(i)) return Math.min(target, ranges.end(i));
      }
      return ranges.start(0);
    }
    return target;
  }

  function install(win) {
    if (!win || !win.document || win[FLAG]) return;
    if (win.location.protocol !== "https:" || !/^(www|m)\.youtube\.com$/.test(win.location.hostname)) return;
    win[FLAG] = true;
    var navigating = false;

    function normalSpeed(video) {
      if (video.playbackRate !== 1) video.playbackRate = 1;
    }

    function keydown(event) {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 ||
          event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || typing(win, event)) return;
      var key = String(event.key || "").toLowerCase();
      if (key !== "a" && key !== "s" && key !== "d") return;
      if (navigating || win.location.pathname.replace(/\/$/, "") !== "/watch" ||
          !new URL(win.location.href).searchParams.get("v")) return;
      var media = mainMedia(win);
      if (!media) return;
      var video = media.video;
      try {
        if (key === "d") {
          // Use the real transport state so mouse/space playback and an A
          // slowdown immediately determine the next D speed as well.
          var start = video.paused || video.ended;
          var rate = start ? 1 : Math.min(Number(video.playbackRate) * 2, 8);
          if (!isFinite(rate) || rate <= 0) rate = 1;
          video.playbackRate = rate;
          if (start) {
            var promise = video.play();
            if (promise && typeof promise.catch === "function") promise.catch(function () {});
          }
        } else if (key === "s") {
          // pause is queued by real media elements. Set the rate now as well
          // so an immediate space/click resume cannot inherit fast-forward.
          video.pause();
          normalSpeed(video);
        } else if (!video.paused && !video.ended && video.playbackRate > 1) {
          video.playbackRate = Math.max(1, video.playbackRate / 2);
        } else {
          var target = backTarget(video);
          if (target == null) return;
          video.currentTime = target;
        }
      } catch (err) { return; }
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    win.addEventListener("keydown", keydown, true);
    win.addEventListener("yt-navigate-start", function () { navigating = true; });
    win.addEventListener("yt-navigate-finish", function () { navigating = false; });
    win.document.addEventListener("pause", function (event) {
      if (navigating || win.location.pathname.replace(/\/$/, "") !== "/watch" ||
          !new URL(win.location.href).searchParams.get("v")) return;
      try {
        var media = mainMedia(win);
        // Space, clicking the picture and native player controls all produce
        // this event. Ignore an old queued event after playback has resumed.
        if (media && event.target === media.video && media.video.paused) normalSpeed(media.video);
      } catch (err) { /* a detaching player or rejected rate must not break page input */ }
    }, true);
  }

  return { install: install };
});
