// Browser-only companion to ads.js: keep YouTube's own Skip control working
// when it becomes available without inserting a new button or media source.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else if (root && root.document) api.install(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var FLAG = "__langformAdSkip";
  var SKIP = ".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern," +
    " .ytp-ad-skip-button-slot, .ytp-ad-skip-button-container, .ytp-skip-ad-button-container," +
    " .ytm-skip-ad-button, ytm-ad-skip-button-renderer, ytm-skip-ad-button-renderer," +
    " button[class*=\"skip-ad-button\"], button[class*=\"ad-skip-button\"]";
  var AD_UI = ".video-ads, .ytp-ad-module, .ytp-ad-player-overlay," +
    " .ytp-ad-player-overlay-layout, .ytp-ad-preview-container, .ytm-ad-overlay, ytm-ad-player-overlay-renderer";
  var BADGE = ".ytp-ad-player-overlay, .ytp-ad-player-overlay-layout," +
    " .ytp-ad-preview-container, .ytp-ad-simple-ad-badge, .ytp-ad-text," +
    " .ytm-ad-overlay, ytm-ad-player-overlay-renderer";
  var LABEL = /^(?:überspringen|werbung überspringen|anzeigen? überspringen|skip(?: ads?)?)$/i;

  function playerRoot(doc) {
    return doc.getElementById("movie_player") || doc.querySelector(".html5-video-player, ytm-player, ytd-player");
  }

  function visible(node) {
    if (!node || !node.isConnected) return false;
    var win = node.ownerDocument.defaultView;
    var own = win.getComputedStyle(node);
    if (own.visibility === "hidden" || own.visibility === "collapse") return false;
    for (var el = node; el && el.nodeType === 1; el = el.parentElement) {
      if (el.hidden) return false;
      var css = win.getComputedStyle(el);
      if (css.display === "none" || css.opacity === "0") return false;
    }
    return true;
  }

  function eligible(node) {
    if (!visible(node) || node.ownerDocument.defaultView.getComputedStyle(node).pointerEvents === "none") return false;
    for (var el = node; el && el.nodeType === 1; el = el.parentElement) {
      if (el.disabled || el.hasAttribute("inert") || el.getAttribute("aria-disabled") === "true") return false;
    }
    return true;
  }

  function isAdShowing(player) {
    if (!player || !player.isConnected) return false;
    if (player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting")) return true;
    var badges = player.querySelectorAll(BADGE);
    for (var i = 0; i < badges.length; i++) {
      if ((badges[i].childElementCount || String(badges[i].textContent || "").trim()) && visible(badges[i])) return true;
    }
    return false;
  }

  function control(node) {
    if (node.matches("button, [role=button], input[type=button]")) return node;
    var buttons = node.querySelectorAll("button, [role=button], input[type=button]");
    for (var i = 0; i < buttons.length; i++) if (eligible(buttons[i])) return buttons[i];
    return buttons[0] || node;
  }

  function skipControl(player) {
    var known = player.querySelectorAll(SKIP);
    for (var i = 0; i < known.length; i++) {
      var button = control(known[i]);
      if (eligible(button)) return button;
    }
    // Labels are a fallback only inside the ad's own UI, never elsewhere in
    // the player or in a video title that happens to mention skipping ads.
    var scopes = player.querySelectorAll(AD_UI);
    for (var s = 0; s < scopes.length; s++) {
      var buttons = scopes[s].querySelectorAll("button, [role=button]");
      for (var b = 0; b < buttons.length; b++) {
        var label = buttons[b].getAttribute("aria-label") || buttons[b].textContent || "";
        if (LABEL.test(label.trim()) && eligible(buttons[b])) return buttons[b];
      }
    }
    return null;
  }

  function install(win) {
    if (!win || !win.document || win[FLAG] || win.location.protocol !== "https:" ||
        !/^(?:www\.|m\.)?youtube\.com$/.test(win.location.hostname)) return;
    win[FLAG] = true;
    var doc = win.document;
    var active = true;
    var watched = null;
    var observer = null;
    var bootstrap = null;
    var clicks = new WeakMap();

    function source(player) {
      var video = player.querySelector("video");
      return { video: video, src: video && String(video.currentSrc || video.getAttribute("src") || "") };
    }

    function recent(button, player) {
      var last = clicks.get(button);
      var current = source(player);
      return last && last.player === player && last.video === current.video && last.src === current.src &&
        win.performance.now() - last.time < 600;
    }

    function captureClick(event) {
      var player = playerRoot(doc);
      if (!isAdShowing(player)) return;
      var target = event.target;
      if (target && target.nodeType !== 1) target = target.parentElement;
      if (!target || !player.contains(target)) return;
      var known = target.closest(SKIP);
      var button = target.closest("button, [role=button], input[type=button]") || (known && control(known));
      if (!button || !player.contains(button) || (!known &&
          (!button.closest(AD_UI) || !LABEL.test((button.getAttribute("aria-label") || button.textContent || "").trim())))) return;
      // The older ads.js can see the same mutation. Suppress only duplicate
      // synthetic clicks, preserving a person's explicit fallback click.
      if (!event.isTrusted && (!active || !eligible(button) || recent(button, player))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!active) return;
      var current = source(player);
      clicks.set(button, { player: player, video: current.video, src: current.src, time: win.performance.now() });
    }

    function watchPlayer() {
      var player = playerRoot(doc);
      if (player === watched) return player;
      if (observer) observer.disconnect();
      observer = null;
      watched = player;
      if (player && win.MutationObserver) {
        observer = new win.MutationObserver(check);
        observer.observe(player, { childList: true, subtree: true, characterData: true, attributes: true,
          attributeFilter: ["class", "style", "hidden", "disabled", "aria-disabled", "inert", "aria-label"] });
      }
      if (player && bootstrap) { bootstrap.disconnect(); bootstrap = null; }
      return player;
    }

    function check() {
      if (!active) return;
      try {
        var player = watchPlayer();
        if (!isAdShowing(player)) { clicks = new WeakMap(); return; }
        var button = skipControl(player);
        if (button && !recent(button, player)) button.click();
      } catch (err) { /* a detached player must not interrupt page playback */ }
    }

    function start() {
      active = true;
      check();
      if (!watched && !bootstrap && win.MutationObserver && doc.documentElement) {
        bootstrap = new win.MutationObserver(check);
        bootstrap.observe(doc.documentElement, { childList: true, subtree: true });
      }
    }

    doc.addEventListener("click", captureClick, true);
    ["loadedmetadata", "durationchange", "playing", "timeupdate", "transitionend"].forEach(function (name) {
      doc.addEventListener(name, check, true);
    });
    doc.addEventListener("DOMContentLoaded", start);
    win.addEventListener("yt-navigate-finish", start);
    win.addEventListener("pageshow", start);
    win.addEventListener("pagehide", function () {
      active = false;
      if (observer) observer.disconnect();
      if (bootstrap) bootstrap.disconnect();
      observer = bootstrap = watched = null;
      clicks = new WeakMap();
    });
    start();
  }

  return { install: install, skipControl: skipControl, isAdShowing: isAdShowing };
});
