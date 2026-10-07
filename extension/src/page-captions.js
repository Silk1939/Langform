// Runs in the page world, where ytInitialPlayerResponse and the page cookies live.
// The isolated Safari content script only talks to this file.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }
  if (root && !extensionIsolated(root)) api.install(root);

  function extensionIsolated(win) {
    try {
      if (win.chrome && win.chrome.runtime && win.chrome.runtime.id) return true;
      if (win.browser && win.browser.runtime && win.browser.runtime.id) return true;
    } catch (err) {
      return false;
    }
    return false;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var WAIT_TICKS = 80;
  var WAIT_MS = 50;
  var CHAPTER_LAYER = "data-langform-chapters";
  var CHAPTER_MARK = "data-langform-chapter";
  var TITLE_ID = "langform-chapter-title";
  var SKIP_PLAYER_KEYS = {
    streamingData: 1,
    captions: 1,
    playbackTracking: 1,
    heartbeatParams: 1,
    attestation: 1,
    adPlacements: 1,
    adSlots: 1,
    playerAds: 1,
  };

  function textOf(node) {
    if (!node) return "";
    if (typeof node === "string") return node;
    if (typeof node.simpleText === "string") return node.simpleText;
    if (node.runs && node.runs.length) {
      var parts = [];
      for (var i = 0; i < node.runs.length; i++) parts.push((node.runs[i] && node.runs[i].text) || "");
      return parts.join("");
    }
    if (typeof node.content === "string") return node.content;
    return "";
  }

  function parseClock(raw) {
    var text = String(raw || "").trim();
    var match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    if (match[3] != null) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function addChapter(list, title, start) {
    start = Number(start);
    if (!isFinite(start) || start < 0) return;
    title = String(title || "").replace(/\s+/g, " ").trim();
    if (!title) {
      var mins = Math.floor(start / 60);
      var secs = Math.floor(start % 60);
      title = mins + ":" + (secs < 10 ? "0" : "") + secs;
    }
    for (var i = 0; i < list.length; i++) {
      if (Math.abs(list[i].start - start) < 0.4) return;
    }
    list.push({ title: title, start: start });
  }

  function addChapterRenderer(renderer, list) {
    if (!renderer) return;
    var millis = renderer.timeRangeStartMillis;
    if (millis == null && renderer.timeRangeStartMillis === 0) millis = 0;
    var start = Number(millis);
    if (!isFinite(start)) return;
    addChapter(list, textOf(renderer.title), start / 1000);
  }

  function addMacro(renderer, list) {
    if (!renderer) return;
    var endpoint = renderer.onTap && renderer.onTap.watchEndpoint;
    var start = endpoint && endpoint.startTimeSeconds;
    if (start == null) start = parseClock(textOf(renderer.timeDescription));
    addChapter(list, textOf(renderer.title), start);
  }

  function walkPlayer(node, renderers, macros, depth) {
    if (!node || depth > 14 || typeof node !== "object") return;
    if (node.chapterRenderer) addChapterRenderer(node.chapterRenderer, renderers);
    if (node.macroMarkersListItemRenderer) addMacro(node.macroMarkersListItemRenderer, macros);
    var keys = Object.keys(node);
    for (var i = 0; i < keys.length; i++) {
      if (SKIP_PLAYER_KEYS[keys[i]]) continue;
      var child = node[keys[i]];
      if (!child || typeof child !== "object") continue;
      if (typeof child.length === "number" && child.length > 80 && !child.chapterRenderer) {
        for (var j = 0; j < child.length; j++) walkPlayer(child[j], renderers, macros, depth + 1);
        continue;
      }
      walkPlayer(child, renderers, macros, depth + 1);
    }
  }

  function chaptersFromDescription(text) {
    var list = [];
    var lines = String(text || "").split(/\n/);
    var leading = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—:]?\s+(\S.*?)\s*$/;
    for (var i = 0; i < lines.length; i++) {
      var match = lines[i].match(leading);
      if (!match) continue;
      var start = parseClock(match[1]);
      if (start == null) continue;
      addChapter(list, match[2], start);
    }
    list.sort(function (a, b) { return a.start - b.start; });
    return list.length >= 2 ? list : [];
  }

  function collectKnownChapters(player, renderers, macros) {
    var overlays = player && player.playerOverlays;
    var overlay = overlays && overlays.playerOverlayRenderer;
    var bar = overlay && overlay.decoratedPlayerBarRenderer;
    var inner = bar && (bar.decoratedPlayerBarRenderer || bar);
    var multi = inner && inner.playerBar && inner.playerBar.multiMarkersPlayerBarRenderer;
    var map = multi && multi.markersMap;
    if (map && map.length) {
      for (var i = 0; i < map.length; i++) {
        var chapters = map[i] && map[i].value && map[i].value.chapters;
        if (!chapters || !chapters.length) continue;
        for (var j = 0; j < chapters.length; j++) {
          addChapterRenderer(chapters[j] && chapters[j].chapterRenderer, renderers);
        }
      }
    }
    var panels = (player && player.engagementPanels) || [];
    for (var p = 0; p < panels.length; p++) {
      var section = panels[p] && panels[p].engagementPanelSectionListRenderer;
      var content = section && section.content;
      var list = content && content.macroMarkersListRenderer && content.macroMarkersListRenderer.contents;
      if (!list) continue;
      for (var c = 0; c < list.length; c++) addMacro(list[c] && list[c].macroMarkersListItemRenderer, macros);
    }
  }

  function chaptersFromPlayer(player) {
    var renderers = [];
    var macros = [];
    if (player && typeof player === "object") {
      collectKnownChapters(player, renderers, macros);
      if (renderers.length < 2 && macros.length < 2) walkPlayer(player, renderers, macros, 0);
    }
    renderers.sort(function (a, b) { return a.start - b.start; });
    macros.sort(function (a, b) { return a.start - b.start; });
    if (renderers.length >= 2) return renderers;
    if (macros.length >= 2) return macros;
    var description = player && player.videoDetails && player.videoDetails.shortDescription;
    return chaptersFromDescription(description);
  }

  function barFractions(chapters, durationSeconds) {
    var duration = Number(durationSeconds);
    if (!chapters || chapters.length < 2 || !isFinite(duration) || duration <= 0) return [];
    var out = [];
    for (var i = 0; i < chapters.length; i++) {
      var start = Number(chapters[i].start);
      if (!isFinite(start) || start < 0 || start >= duration) continue;
      out.push({
        title: chapters[i].title,
        start: start,
        fraction: start / duration,
      });
    }
    return out.length >= 2 ? out : [];
  }

  function chapterAtTime(fractions, seconds) {
    var found = null;
    for (var i = 0; i < fractions.length; i++) {
      if (fractions[i].start <= Number(seconds) + 0.05) found = fractions[i];
      else break;
    }
    return found;
  }

  function classText(el) {
    if (!el || !el.getAttribute) return "";
    return String(el.getAttribute("class") || "");
  }

  function seekBarScore(el) {
    if (!el || el.nodeType !== 1 || el.tagName === "VIDEO") return 0;
    var tag = el.tagName;
    var cls = classText(el);
    if (cls.indexOf("progress-bar-line") !== -1) return 1;
    if (cls.indexOf("ytp-progress-bar") !== -1 && cls.indexOf("container") === -1) return 2;
    if (tag === "YTM-PROGRESS-BAR") return 3;
    if (/(^|\s)progress-bar($|\s)/.test(cls)) return 4;
    return 0;
  }

  function findSeekBar(doc) {
    if (!doc) return null;
    var root = doc.querySelector("ytm-watch, ytd-watch-flexy, #movie_player, ytm-player, ytd-player, #player") || doc.body;
    if (!root) return null;
    var best = null;
    var bestScore = 99;
    var stack = [root];
    var seen = new Set();
    while (stack.length) {
      var node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      if (node.nodeType === 1 && node.tagName !== "VIDEO") {
        var score = seekBarScore(node);
        if (score && score < bestScore) {
          best = node;
          bestScore = score;
        }
        if (node.shadowRoot) stack.push(node.shadowRoot);
        var children = node.children;
        if (children) {
          for (var i = children.length - 1; i >= 0; i--) stack.push(children[i]);
        }
      }
    }
    return best;
  }

  function seekTo(win, seconds) {
    var doc = win && win.document;
    if (!doc || seconds == null || !isFinite(seconds) || seconds < 0) return false;
    var movie = doc.getElementById("movie_player");
    if (movie && movie.tagName !== "VIDEO" && typeof movie.seekTo === "function") {
      try {
        movie.seekTo(seconds, true);
        return true;
      } catch (err) {
        /* player detaches during navigation */
      }
    }
    var hosts = doc.querySelectorAll("ytd-player, ytm-player, .html5-video-player");
    for (var i = 0; i < hosts.length; i++) {
      if (!hosts[i] || hosts[i].tagName === "VIDEO" || typeof hosts[i].seekTo !== "function") continue;
      try {
        hosts[i].seekTo(seconds, true);
        return true;
      } catch (err2) {
        /* ignore */
      }
    }
    var videos = doc.getElementsByTagName("video");
    for (var v = 0; v < videos.length; v++) {
      try {
        videos[v].currentTime = seconds;
        return true;
      } catch (err3) {
        /* a detached element throws */
      }
    }
    return false;
  }

  function hideTitle(doc) {
    if (!doc) return;
    var title = doc.getElementById(TITLE_ID);
    if (title) title.style.display = "none";
  }

  function ensureTitle(doc) {
    var title = doc.getElementById(TITLE_ID);
    if (title) return title;
    title = doc.createElement("div");
    title.id = TITLE_ID;
    title.setAttribute("lang", "de");
    title.style.cssText = [
      "position:fixed",
      "z-index:30",
      "transform:translateX(-50%)",
      "max-width:70vw",
      "padding:4px 8px",
      "border-radius:8px",
      "background:rgba(0,0,0,.82)",
      "color:#fff",
      "font:600 12px/1.3 system-ui,sans-serif",
      "white-space:nowrap",
      "overflow:hidden",
      "text-overflow:ellipsis",
      "pointer-events:none",
      "display:none",
    ].join(";");
    (doc.body || doc.documentElement).appendChild(title);
    return title;
  }

  function showTitle(doc, bar, label, ratio) {
    if (!doc || !bar || !label) return;
    var title = ensureTitle(doc);
    title.textContent = label;
    var rect = bar.getBoundingClientRect();
    var width = doc.documentElement.clientWidth || 320;
    var x = rect.left + rect.width * (ratio == null ? 0.5 : ratio);
    if (x < 56) x = 56;
    if (x > width - 56) x = width - 56;
    title.style.left = x + "px";
    title.style.top = Math.max(8, rect.top - 34) + "px";
    title.style.display = "block";
  }

  function clearChapterBar(bar) {
    if (!bar || !bar.querySelectorAll) return;
    var layers = bar.querySelectorAll("[" + CHAPTER_LAYER + "]");
    for (var i = 0; i < layers.length; i++) layers[i].remove();
    bar.removeAttribute("data-langform-chapter-sig");
  }

  function drawChapterBar(bar, fractions, seek) {
    if (!bar || bar.tagName === "VIDEO") return null;
    var doc = bar.ownerDocument;
    clearChapterBar(bar);
    if (!fractions || fractions.length < 2) {
      hideTitle(doc);
      return null;
    }
    var view = doc.defaultView;
    try {
      if (view && view.getComputedStyle(bar).position === "static") bar.style.position = "relative";
    } catch (err) {
      bar.style.position = "relative";
    }
    var layer = doc.createElement("div");
    layer.setAttribute(CHAPTER_LAYER, "1");
    layer.style.cssText = "position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;z-index:4;";
    for (var i = 0; i < fractions.length; i++) {
      if (!(fractions[i].fraction > 0.004)) continue;
      var gap = doc.createElement("div");
      gap.setAttribute(CHAPTER_MARK, String(i));
      gap.setAttribute("data-start", String(fractions[i].start));
      gap.setAttribute("data-title", fractions[i].title);
      gap.setAttribute("role", "button");
      gap.setAttribute("aria-label", fractions[i].title);
      var left = (fractions[i].fraction * 100).toFixed(4) + "%";
      gap.style.cssText = "position:absolute;top:-6px;bottom:-6px;width:14px;margin-left:-7px;left:" + left + ";pointer-events:auto;background:transparent;";
      var tick = doc.createElement("div");
      tick.style.cssText = "position:absolute;top:0;bottom:0;left:6px;width:2px;background:#000;pointer-events:none;";
      gap.appendChild(tick);
      gap.addEventListener("click", function (event) {
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        var seconds = Number(event.currentTarget.getAttribute("data-start"));
        var name = event.currentTarget.getAttribute("data-title") || "";
        var ratio = Number(event.currentTarget.style.left.replace("%", "")) / 100;
        if (seek) seek(seconds);
        showTitle(doc, bar, name, isFinite(ratio) ? ratio : 0.5);
        armTitleHide(doc, bar);
      });
      layer.appendChild(gap);
    }
    bar.appendChild(layer);
    bar.__langformFractions = fractions;
    bindScrub(bar, doc);
    bar.setAttribute("data-langform-chapter-sig", fractions.map(function (item) {
      return item.start + ":" + item.title;
    }).join("|"));
    return layer;
  }

  function armTitleHide(doc, bar) {
    var win = doc.defaultView;
    if (!win) return;
    if (bar.__langformTitleTimer) win.clearTimeout(bar.__langformTitleTimer);
    bar.__langformTitleTimer = win.setTimeout(function () {
      bar.__langformTitleTimer = 0;
      if (!bar.__langformScrubbing) hideTitle(doc);
    }, 1600);
  }

  function bindScrub(bar, doc) {
    if (bar.getAttribute("data-langform-scrub") === "1") return;
    bar.setAttribute("data-langform-scrub", "1");
    function ratioFrom(event) {
      var rect = bar.getBoundingClientRect();
      if (!rect.width) return null;
      var point = event.touches && event.touches[0] ? event.touches[0] : event;
      if (!point || point.clientX == null) return null;
      var ratio = (point.clientX - rect.left) / rect.width;
      if (ratio < 0) ratio = 0;
      if (ratio > 1) ratio = 1;
      return ratio;
    }
    function reveal(event) {
      var fractions = bar.__langformFractions || [];
      var ratio = ratioFrom(event);
      if (ratio == null || fractions.length < 2) return;
      var duration = fractions[fractions.length - 1].start;
      var last = fractions[fractions.length - 1].fraction;
      var span = last > 0 ? duration / last : 0;
      var chapter = chapterAtTime(fractions, ratio * span);
      if (!chapter) return;
      showTitle(doc, bar, chapter.title, ratio);
    }
    bar.addEventListener("pointerdown", function () {
      bar.__langformScrubbing = true;
    });
    bar.addEventListener("pointermove", function (event) {
      if (!bar.__langformScrubbing) return;
      reveal(event);
    });
    bar.addEventListener("pointerup", function (event) {
      bar.__langformScrubbing = false;
      reveal(event);
      armTitleHide(doc, bar);
    });
    bar.addEventListener("pointercancel", function () {
      bar.__langformScrubbing = false;
      armTitleHide(doc, bar);
    });
    bar.addEventListener("touchmove", function (event) {
      bar.__langformScrubbing = true;
      reveal(event);
    }, { passive: true });
  }

  function onWatchPath(win) {
    var path = "";
    try {
      path = win.location.pathname || "";
    } catch (err) {
      return false;
    }
    return path === "/watch" || path.indexOf("/watch/") === 0;
  }

  function refreshChapters(win) {
    var doc = win.document;
    if (!doc) return;
    if (!onWatchPath(win)) {
      hideTitle(doc);
      return;
    }
    var player = win.ytInitialPlayerResponse;
    var video = doc.querySelector("#movie_player video, ytm-player video, ytd-player video, video");
    var duration = Number(player && player.videoDetails && player.videoDetails.lengthSeconds);
    if ((!duration || !isFinite(duration)) && video && isFinite(video.duration) && video.duration > 0) {
      duration = video.duration;
    }
    var cache = win.__langformChapterCache;
    var fractions;
    if (cache && cache.player === player && cache.duration === duration && duration > 0) {
      fractions = cache.fractions;
    } else {
      fractions = barFractions(chaptersFromPlayer(player), duration);
      if (duration > 0) win.__langformChapterCache = { player: player, duration: duration, fractions: fractions };
    }
    var bar = win.__langformSeekBar;
    if (!bar || !bar.isConnected) bar = findSeekBar(doc);
    win.__langformSeekBar = bar;
    if (!bar) return;
    var sig = fractions.map(function (item) { return item.start + ":" + item.title; }).join("|");
    if (bar.getAttribute("data-langform-chapter-sig") === sig && bar.querySelector("[" + CHAPTER_LAYER + "]")) return;
    drawChapterBar(bar, fractions, function (seconds) {
      seekTo(win, seconds);
    });
    if (video && !video.__langformChapterBound) {
      video.__langformChapterBound = true;
      video.addEventListener("seeked", function () {
        var liveBar = (win.__langformSeekBar && win.__langformSeekBar.isConnected && win.__langformSeekBar) || findSeekBar(doc);
        if (!liveBar) return;
        var live = liveBar.__langformFractions || [];
        var chapter = chapterAtTime(live, video.currentTime);
        if (!chapter) return;
        var span = live.length ? live[live.length - 1] : null;
        var full = span && span.fraction > 0 ? span.start / span.fraction : 0;
        var ratio = full ? video.currentTime / full : chapter.fraction;
        showTitle(doc, liveBar, chapter.title, ratio);
        armTitleHide(doc, liveBar);
      });
    }
  }

  function armChapters(win) {
    if (!win || !win.document || win.__langformChapters) return;
    win.__langformChapters = true;
    var timer = 0;
    function schedule() {
      if (timer) win.clearTimeout(timer);
      timer = win.setTimeout(function () {
        timer = 0;
        try {
          refreshChapters(win);
        } catch (err) {
          /* the player can swap the bar while we measure it */
        }
      }, 240);
    }
    try {
      refreshChapters(win);
    } catch (err2) {
      /* first paint */
    }
    win.addEventListener("yt-navigate-finish", schedule);
    win.addEventListener("popstate", schedule);
    win.document.addEventListener("pointerdown", function () {
      if (onWatchPath(win)) schedule();
    }, { capture: true, passive: true });
    var tries = 0;
    var retry = win.setInterval(function () {
      tries += 1;
      schedule();
      if (tries > 24) win.clearInterval(retry);
    }, 500);
  }

  function install(win) {
    if (!win || win.__langformPageCaptions) return;
    win.__langformPageCaptions = true;
    var nativeFetch = typeof win.fetch === "function" ? win.fetch.bind(win) : null;

    function filledPlayer(videoId) {
      var player = win.ytInitialPlayerResponse;
      if (!player || typeof player !== "object") return null;
      var id = player.videoDetails && player.videoDetails.videoId;
      if (!id || (videoId && id !== videoId)) return null;
      return player;
    }

    function slim(player) {
      var renderer = player.captions && player.captions.playerCaptionsTracklistRenderer;
      var tracks = (renderer && renderer.captionTracks) || [];
      var translations = (renderer && renderer.translationLanguages) || [];
      return {
        videoDetails: { videoId: player.videoDetails.videoId },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: tracks.map(function (track) {
              if (!track) return null;
              return {
                baseUrl: track.baseUrl,
                languageCode: track.languageCode,
                kind: track.kind,
              };
            }).filter(Boolean),
            translationLanguages: translations.map(function (item) {
              return { languageCode: item && item.languageCode };
            }),
          },
        },
      };
    }

    function readCfg() {
      var ytcfg = win.ytcfg;
      if (!ytcfg) return null;
      function val(name) {
        try {
          if (typeof ytcfg.get === "function") {
            var got = ytcfg.get(name);
            if (got != null && got !== "") return got;
          }
        } catch (err) {
          /* the page config can throw while it is still booting */
        }
        if (ytcfg.data_ && ytcfg.data_[name] != null && ytcfg.data_[name] !== "") return ytcfg.data_[name];
        if (ytcfg[name] != null && ytcfg[name] !== "") return ytcfg[name];
        return null;
      }
      var key = val("INNERTUBE_API_KEY");
      var context = val("INNERTUBE_CONTEXT");
      if (!key || !context || !context.client) return null;
      try {
        return JSON.parse(JSON.stringify({
          INNERTUBE_API_KEY: key,
          INNERTUBE_CONTEXT: context,
          STS: val("STS"),
        }));
      } catch (err2) {
        return null;
      }
    }

    function snapshot(videoId, watch) {
      return new Promise(function (resolve) {
        var tries = 0;
        (function tick() {
          var player = filledPlayer(videoId);
          if (player || !watch || tries++ >= WAIT_TICKS) {
            resolve({ player: player ? slim(player) : null, ytcfg: readCfg() });
            return;
          }
          win.setTimeout(tick, WAIT_MS);
        })();
      });
    }

    function allowed(url) {
      var parsed;
      try {
        parsed = new URL(String(url || ""), (win.location && win.location.href) || "https://www.youtube.com/");
      } catch (err) {
        return false;
      }
      var host = parsed.hostname;
      if (host.indexOf("googlevideo") !== -1) return false;
      if (host !== "www.youtube.com" && host !== "m.youtube.com" && host !== "youtube.com") return false;
      var path = parsed.pathname;
      return path.indexOf("/api/timedtext") === 0 || path.indexOf("/youtubei/v1/player") === 0;
    }

    win.addEventListener("message", function (event) {
      if (event.source && event.source !== win) return;
      var data = event.data;
      if (!data || data.source !== "langform-page-req") return;
      var id = data.id;
      function done(payload) {
        win.postMessage({ source: "langform-page-res", id: id, payload: payload }, "*");
      }
      if (data.op === "ping") {
        done({ ok: true });
        return;
      }
      if (data.op === "context") {
        snapshot(String(data.videoId || ""), !!data.watch).then(done);
        return;
      }
      if (data.op !== "fetch" || !nativeFetch || !allowed(data.url)) {
        done({ error: true });
        return;
      }
      var init = { credentials: "include" };
      if (data.method) init.method = data.method;
      if (data.body != null) init.body = data.body;
      if (data.headers) init.headers = data.headers;
      nativeFetch(data.url, init)
        .then(function (response) {
          if (!response || !response.ok) throw new Error("status");
          return response.text();
        })
        .then(function (text) {
          done({ text: String(text == null ? "" : text) });
        })
        .catch(function () {
          done({ error: true });
        });
    });
    armChapters(win);
  }

  return {
    install: install,
    chaptersFromPlayer: chaptersFromPlayer,
    barFractions: barFractions,
    chapterAtTime: chapterAtTime,
    drawChapterBar: drawChapterBar,
    findSeekBar: findSeekBar,
    seekTo: seekTo,
  };
});
