// YouTube ads on www.youtube.com and m.youtube.com. Ad slots are hidden by a
// stylesheet. A video ad is skipped with YouTube's own skip button, or muted and
// run to its end on a directly seekable ad element. Buffered/blob ads finish
// naturally: an exact-end seek can strand WebKit's MSE pipeline before frames.
// The main video is never sought,
// paused or styled, and nothing here runs on a timer.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }
  if (root && root.document) api.install(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var STYLE_ID = "langform-ads-style";

  // Only elements that are ads by their own tag or id. Nothing here can be the
  // player, the chapter chip, Cast, AirPlay or the search box.
  var AD_SLOTS = [
    "#masthead-ad",
    "#player-ads",
    "ytd-ad-slot-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytd-banner-promo-renderer",
    "ytd-statement-banner-renderer",
    "ytd-video-masthead-ad-v3-renderer",
    "ytd-primetime-promo-renderer",
    "ytd-display-ad-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-promoted-sparkles-text-search-renderer",
    "ytd-promoted-video-renderer",
    "ytd-search-pyv-renderer",
    "ytd-companion-slot-renderer",
    "ytd-action-companion-ad-renderer",
    "ytd-player-legacy-desktop-watch-ads-renderer",
    "ytd-engagement-panel-section-list-renderer[target-id=\"engagement-panel-ads\"]",
    "ad-slot-renderer",
    "ytm-ad-slot-renderer",
    "ytm-in-feed-ad-layout-renderer",
    "ytm-promoted-sparkles-web-renderer",
    "ytm-promoted-sparkles-text-search-renderer",
    "ytm-promoted-video-renderer",
    "ytm-companion-slot",
    "ytm-companion-ad-renderer",
    "ytm-banner-promo-renderer",
    "ytm-statement-banner-renderer",
    ".ytp-ad-overlay-container",
    ".ytp-ad-image-overlay",
  ];

  // Feed cells that only wrap an ad slot. The guard keeps any cell that holds a
  // player or a video out of it.
  var AD_CELLS = [
    "ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)",
    "ytd-rich-section-renderer:has(ytd-statement-banner-renderer)",
    "ytm-rich-item-renderer:has(ad-slot-renderer)",
    "ytm-rich-item-renderer:has(ytm-ad-slot-renderer)",
    "ytm-item-section-renderer:has(> ad-slot-renderer:only-child)",
  ].map(function (selector) {
    return selector + ":not(:has(video)):not(:has(#movie_player))";
  });

  function cssText() {
    return AD_SLOTS.concat(AD_CELLS).join(",\n") + " {\n  display: none !important;\n}\n";
  }

  function ensureStyle(doc) {
    if (!doc || !doc.documentElement || doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = cssText();
    doc.documentElement.appendChild(style);
  }

  function playerRoot(doc) {
    return doc.getElementById("movie_player") || doc.querySelector(".html5-video-player");
  }

  function shown(el) {
    var view = el.ownerDocument && el.ownerDocument.defaultView;
    var node = el;
    var guard = 0;
    while (node && node.nodeType === 1 && guard++ < 12) {
      if (node.hidden) return false;
      if (view && typeof view.getComputedStyle === "function") {
        var css = view.getComputedStyle(node);
        if (css && (css.display === "none" || css.visibility === "hidden")) return false;
      }
      node = node.parentElement;
    }
    return true;
  }

  // The ad's own UI inside the player. It only exists while an ad plays.
  var AD_UI =
    ".ytp-ad-player-overlay, .ytp-ad-player-overlay-layout, .ytp-ad-player-overlay-instream-info," +
    " .ytp-ad-preview-container, .ytp-ad-text, .ytp-ad-simple-ad-badge, .ytm-ad-overlay, ytm-ad-player-overlay-renderer";

  var SKIP =
    ".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot button," +
    " .ytm-skip-ad-button, button[class*=\"skip-ad-button\"], button[class*=\"ad-skip-button\"]";

  /**
   * An ad, and only an ad: the player says so with its ad-showing or
   * ad-interrupting class, or its ad overlay is on screen. Time, duration or
   * ad placements in the player response never count, so the first seconds
   * of the main video are never an ad.
   */
  function isAdShowing(player) {
    if (!player || !player.classList) return false;
    if (player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting")) return true;
    var overlays = player.querySelectorAll(AD_UI);
    for (var i = 0; i < overlays.length; i++) {
      var overlay = overlays[i];
      if (overlay.childElementCount + String(overlay.textContent || "").trim().length > 0 && shown(overlay)) return true;
    }
    return false;
  }

  function skipControl(player) {
    var buttons = player.querySelectorAll(SKIP);
    for (var i = 0; i < buttons.length; i++) {
      if (shown(buttons[i]) && !buttons[i].disabled) return buttons[i];
    }
    return null;
  }

  function adVideo(player) {
    return player.querySelector("video");
  }

  /**
   * One look at the player. Returns what was done: "skip", "jump", "mute",
   * "wait", "restore" or "none". Every write happens while the player shows an
   * ad, except putting the sound back once it ended.
   */
  function mainLength(win) {
    var response = win.ytInitialPlayerResponse;
    var length = Number(response && response.videoDetails && response.videoDetails.lengthSeconds);
    return isFinite(length) && length > 0 ? length : 0;
  }

  // The media might still be the main video: the class switched before the
  // source did, or YouTube stitched the ad into the main stream. Then the ad is
  // only muted, because a jump would land in the main video.
  function mayBeMainMedia(win, video, duration) {
    var main = mainLength(win);
    if (main && Math.abs(duration - main) < 2) return true;
    var src = String(video.currentSrc || video.getAttribute("src") || "");
    if (src && win.__langformMainSrc && src === win.__langformMainSrc) return true;
    return duration > 180;
  }

  function bufferedAdMedia(video) {
    // A blob URL is the MSE/MediaSource timeline, not a directly loaded file.
    // Leave its natural ended/segment handoff to the original player, including
    // after a replay or an ad-to-main transition on the same HTMLMediaElement.
    return /^blob:/i.test(String(video.currentSrc || "")) ||
      /^blob:/i.test(String(video.getAttribute("src") || "")) || !!video.srcObject;
  }

  function handle(win) {
    var doc = win && win.document;
    var player = doc && playerRoot(doc);
    var muted = win && win.__langformAdMute;
    if (!player || !isAdShowing(player)) {
      var main = player && adVideo(player);
      var mainSrc = main && String(main.currentSrc || main.getAttribute("src") || "");
      if (mainSrc) win.__langformMainSrc = mainSrc;
      if (muted && muted.video) {
        muted.video.muted = muted.was;
        win.__langformAdMute = null;
        return "restore";
      }
      return "none";
    }
    var skip = skipControl(player);
    if (skip) {
      skip.click();
      return "skip";
    }
    var video = adVideo(player);
    if (!video) return "wait";
    var duration = Number(video.duration);
    if (!isFinite(duration) || duration <= 0) return "wait";
    if (!win.__langformAdMute || win.__langformAdMute.video !== video) {
      win.__langformAdMute = { video: video, was: !!video.muted };
    }
    if (!video.muted) video.muted = true;
    if (mayBeMainMedia(win, video, duration) || bufferedAdMedia(video)) return "mute";
    if (Number(video.currentTime) < duration - 0.05) video.currentTime = duration;
    return "jump";
  }

  function install(win) {
    if (!win || !win.document || win.__langformAds) return;
    var host = "";
    try {
      host = String(win.location.hostname || "");
    } catch (err) {
      return;
    }
    if (host !== "www.youtube.com" && host !== "m.youtube.com" && host !== "youtube.com") return;
    win.__langformAds = true;
    var doc = win.document;
    ensureStyle(doc);

    function check() {
      try {
        handle(win);
      } catch (err) {
        /* the player can be rebuilt while we look at it */
      }
    }

    // The player toggles ad-showing on its own root; the ad module only changes
    // while an ad runs. Both are watched without a subtree walk of the page.
    var watchedPlayer = null;
    var watchedModule = null;
    var rootWatch = null;
    var moduleWatch = null;
    function watchPlayer() {
      var player = playerRoot(doc);
      if (!player || typeof win.MutationObserver !== "function") return;
      if (player !== watchedPlayer) {
        if (rootWatch) rootWatch.disconnect();
        watchedPlayer = player;
        rootWatch = new win.MutationObserver(function () {
          watchModule();
          check();
        });
        rootWatch.observe(player, { childList: true, attributes: true, attributeFilter: ["class"] });
      }
      watchModule();
    }
    function watchModule() {
      var module = watchedPlayer && watchedPlayer.querySelector(".video-ads, .ytp-ad-module");
      if (module === watchedModule) return;
      if (moduleWatch) moduleWatch.disconnect();
      watchedModule = module;
      moduleWatch = null;
      if (!module) return;
      moduleWatch = new win.MutationObserver(function () {
        // Overlay-only ads can end without changing the player's classes.
        // The final mutation must restore sound as well as detect new ads.
        check();
      });
      moduleWatch.observe(module, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    }

    // A new ad brings its own media: metadata, duration and playing fire on it.
    ["loadedmetadata", "durationchange", "playing"].forEach(function (name) {
      doc.addEventListener(name, function () {
        watchPlayer();
        check();
      }, true);
    });
    win.addEventListener("yt-navigate-finish", function () {
      watchPlayer();
      check();
    });
    watchPlayer();
    check();
  }

  return {
    STYLE_ID: STYLE_ID,
    cssText: cssText,
    isAdShowing: isAdShowing,
    skipControl: skipControl,
    handle: handle,
    install: install,
  };
});
