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
    // Safari also exposes browser.runtime to web pages, without an extension
    // ID. Checking only for `browser` disables the MAIN-world caption bridge.
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
  var CHIP_ID = "langform-chapter-chip";
  var SHEET_ID = "langform-chapter-sheet";
  var LABEL_ATTR = "data-langform-chapter-label";
  var ROW_ATTR = "data-langform-chapter-row";
  var AIRPLAY_ID = "langform-airplay";
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

  function bestThumb(node) {
    var thumbs = node && node.thumbnail && node.thumbnail.thumbnails;
    if (!thumbs || !thumbs.length) return "";
    var best = "";
    var bestArea = -1;
    for (var i = 0; i < thumbs.length; i++) {
      var item = thumbs[i];
      if (!item || !item.url || String(item.url).indexOf("googlevideo") !== -1) continue;
      var w = Number(item.width) || 0;
      if (w > 640) continue;
      var h = Number(item.height) || 0;
      var area = (w || 160) * (h || 90);
      if (area >= bestArea) {
        bestArea = area;
        best = String(item.url);
      }
    }
    return best;
  }

  function addChapter(list, title, start, thumb) {
    start = Number(start);
    if (!isFinite(start) || start < 0) return;
    title = String(title || "").replace(/\s+/g, " ").trim();
    if (!title) {
      var mins = Math.floor(start / 60);
      var secs = Math.floor(start % 60);
      title = mins + ":" + (secs < 10 ? "0" : "") + secs;
    }
    if (thumb && String(thumb).indexOf("googlevideo") !== -1) thumb = "";
    thumb = thumb ? String(thumb) : "";
    for (var i = 0; i < list.length; i++) {
      if (Math.abs(list[i].start - start) < 0.4) {
        if (!list[i].thumbnail && thumb) list[i].thumbnail = thumb;
        return;
      }
    }
    list.push({ title: title, start: start, thumbnail: thumb });
  }

  function addChapterRenderer(renderer, list) {
    if (!renderer) return;
    var millis = renderer.timeRangeStartMillis;
    if (millis == null && renderer.timeRangeStartMillis === 0) millis = 0;
    var start = Number(millis);
    if (!isFinite(start)) return;
    addChapter(list, textOf(renderer.title), start / 1000, bestThumb(renderer));
  }

  function addMacro(renderer, list, expectedID) {
    if (!renderer) return;
    var endpoint = renderer.onTap && renderer.onTap.watchEndpoint;
    if (expectedID && endpoint && endpoint.videoId && endpoint.videoId !== expectedID) return;
    var start = endpoint && endpoint.startTimeSeconds;
    if (start == null) start = parseClock(textOf(renderer.timeDescription));
    addChapter(list, textOf(renderer.title), start, bestThumb(renderer));
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

  function collectKnownChapters(player, renderers, macros, expectedID) {
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
      for (var c = 0; c < list.length; c++) addMacro(list[c] && list[c].macroMarkersListItemRenderer, macros, expectedID);
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

  function readInitialData(win) {
    var source = win.ytInitialData;
    if (typeof source !== "string") {
      win.__langformChapterDataCache = null;
      return source && typeof source === "object" && !Array.isArray(source) ? source : null;
    }
    // Mobile YouTube can leave the watch response serialized. Bound parsing
    // and memoize its exact value; never evaluate code or replace its global.
    if (source.length > 2 * 1024 * 1024) { win.__langformChapterDataCache = null; return null; }
    var cache = win.__langformChapterDataCache;
    if (cache && cache.source === source) return cache.data;
    var parsed = null;
    try {
      parsed = JSON.parse(source);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = null;
    } catch (err) { /* an incomplete watch response can hydrate later */ }
    win.__langformChapterDataCache = { source: source, data: parsed };
    return parsed;
  }

  function initialDataVideoID(data) {
    var endpoint = data && data.currentVideoEndpoint && data.currentVideoEndpoint.watchEndpoint;
    return endpoint && typeof endpoint.videoId === "string" ? endpoint.videoId : "";
  }

  function chaptersFromInitialData(data, expectedID) {
    if (!expectedID || initialDataVideoID(data) !== expectedID) return [];
    var renderers = [], macros = [];
    // Only current watch-player overlays and chapter engagement panels belong
    // to this response. Never recursively walk recommendation results here.
    collectKnownChapters(data, renderers, macros, expectedID);
    renderers.sort(function (a, b) { return a.start - b.start; });
    macros.sort(function (a, b) { return a.start - b.start; });
    return renderers.length >= 2 ? renderers : macros.length >= 2 ? macros : [];
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
        thumbnail: chapters[i].thumbnail || "",
      });
    }
    return out.length >= 2 ? out : [];
  }

  function chapterAtTime(fractions, seconds) {
    var found = null;
    for (var i = 0; i < fractions.length; i++) {
      if (fractions[i].start <= Number(seconds) + 0.001) found = fractions[i];
      else break;
    }
    return found;
  }

  function chapterMark(chapters, seconds) {
    var current = chapterAtTime(chapters || [], seconds);
    if (!current || !chapters) return -1;
    for (var i = 0; i < chapters.length; i++) {
      if (Math.abs(Number(chapters[i].start) - Number(current.start)) < 0.001) return i;
    }
    return -1;
  }

  function classText(el) {
    if (!el || !el.getAttribute) return "";
    return String(el.getAttribute("class") || "");
  }

  function boxOf(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return null;
    var rect;
    try {
      rect = el.getBoundingClientRect();
    } catch (err) {
      return null;
    }
    if (!rect) return null;
    var top = Number(rect.top) || 0;
    var left = Number(rect.left) || 0;
    var width = Number(rect.width) || 0;
    var height = Number(rect.height) || 0;
    return {
      top: top,
      left: left,
      width: width,
      height: height,
      bottom: Number(rect.bottom) || top + height,
      right: Number(rect.right) || left + width,
    };
  }

  function elementHidden(el) {
    if (!el || el.nodeType !== 1 || el.hidden) return true;
    var view = el.ownerDocument && el.ownerDocument.defaultView;
    if (!view || typeof view.getComputedStyle !== "function") return false;
    try {
      var css = view.getComputedStyle(el);
      if (css && (css.display === "none" || css.visibility === "hidden")) return true;
    } catch (err) {
      /* a detached node */
    }
    return false;
  }

  function visiblyShown(el) {
    var node = el;
    var guard = 0;
    while (node && node.nodeType === 1 && guard++ < 14) {
      if (elementHidden(node)) return false;
      node = node.parentElement;
    }
    return true;
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
    var time = timePill(doc);
    var player = playerRoot(doc);
    var scope = player && (!time || player.contains(time)) ? player : null;
    var timeBox = time && boxOf(time);
    var live = !!(timeBox && timeBox.width > 8 && timeBox.height > 4);
    if (live) {
      var best = null;
      var bestDist = Infinity;
      var bestWidth = -1;
      var bestHeight = Infinity;
      queryDeep(doc, function (el) {
        if (el.getAttribute && el.getAttribute(CHAPTER_LAYER)) return false;
        var box = boxOf(el);
        if (!box || box.width < 80 || box.height < 1 || box.height > 14) return false;
        if (box.top < timeBox.bottom - 8) return false;
        if (box.top > timeBox.bottom + 36) return false;
        if (box.width < timeBox.width + 24) return false;
        // Resolve ancestor styles only for geometry that can actually win.
        // Caption/recommendation nodes otherwise trigger thousands of redundant
        // style reads during watch hydration and controls/caption changes.
        if (!visiblyShown(el)) return false;
        var dist = Math.abs(box.top - timeBox.bottom);
        var nearer = dist + 0.5 < bestDist;
        var sameBand = Math.abs(dist - bestDist) <= 0.5;
        if (nearer || (sameBand && (box.width > bestWidth || (box.width === bestWidth && box.height < bestHeight)))) {
          best = el;
          bestDist = dist;
          bestWidth = box.width;
          bestHeight = box.height;
        }
        return false;
      }, scope);
      if (best) return best;
    }
    var picked = null;
    var pickedScore = 99;
    queryDeep(doc, function (el) {
      var score = seekBarScore(el);
      if (score && score < pickedScore && visiblyShown(el)) {
        picked = el;
        pickedScore = score;
      }
      return false;
    }, scope);
    return picked;
  }

  function playbackJustOpened(doc) {
    if (!doc || !doc.getElementsByTagName) return true;
    var videos = doc.getElementsByTagName("video");
    if (!videos.length) return true;
    for (var i = 0; i < videos.length; i++) {
      var time = Number(videos[i].currentTime);
      if (isFinite(time) && time >= 1) return false;
    }
    return true;
  }

  function seekTo(win, seconds) {
    var doc = win && win.document;
    if (!doc || seconds == null || !isFinite(seconds) || seconds < 0) return false;
    if (seconds <= 1 && playbackJustOpened(doc)) return false;
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

  function formatClock(seconds) {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    if (h > 0) return h + ":" + pad(m) + ":" + pad(s);
    return m + ":" + pad(s);
  }

  function rememberChapters(doc, chapters, videoID) {
    if (!doc || !doc.documentElement) return;
    var root = doc.documentElement, list = chapters || [];
    if (typeof videoID === "string") root.__langformChapterVideoID = videoID;
    else if (root.__langformChapterList !== list) root.__langformChapterVideoID = "";
    root.__langformChapterList = list;
  }

  function clearChapterBar(bar) {
    if (!bar || !bar.querySelectorAll) return;
    var layers = bar.querySelectorAll("[" + CHAPTER_LAYER + "]");
    for (var i = 0; i < layers.length; i++) layers[i].remove();
    bar.removeAttribute("data-langform-chapter-sig");
    bar.__langformFractions = [];
    bar.__langformOnPreview = null;
  }

  function barTooTall(bar) {
    if (!bar || typeof bar.getBoundingClientRect !== "function") return false;
    try {
      var rect = bar.getBoundingClientRect();
      return !!(rect && rect.height > 24);
    } catch (err) {
      return false;
    }
  }

  function drawChapterBar(bar, fractions, seek) {
    if (!bar || bar.tagName === "VIDEO") return null;
    var doc = bar.ownerDocument;
    clearChapterBar(bar);
    if (!fractions || fractions.length < 2 || barHasNativeGaps(bar) || barTooTall(bar)) return null;
    var view = doc.defaultView;
    try {
      if (view && view.getComputedStyle(bar).position === "static") bar.style.position = "relative";
    } catch (err) {
      bar.style.position = "relative";
    }
    var layer = doc.createElement("div");
    layer.setAttribute(CHAPTER_LAYER, "1");
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;z-index:8;";
    for (var i = 0; i < fractions.length; i++) {
      if (!(fractions[i].fraction > 0.004)) continue;
      var gap = doc.createElement("div");
      gap.setAttribute(CHAPTER_MARK, String(i));
      gap.setAttribute("data-start", String(fractions[i].start));
      gap.setAttribute("data-title", fractions[i].title);
      var left = (fractions[i].fraction * 100).toFixed(4) + "%";
      var previous = i > 0 ? fractions[i - 1].fraction : 0;
      var next = i + 1 < fractions.length ? fractions[i + 1].fraction : 1;
      var gapLimit = Math.min(fractions[i].fraction - previous, next - fractions[i].fraction) * 35;
      // Visual chapter gaps never steal a native scrub gesture. Named chapter
      // jumps remain on the 44px chip and the chapter sheet's full-width rows.
      gap.style.cssText = "position:absolute;top:0;bottom:0;width:min(3px," + gapLimit + "%);transform:translateX(-50%);left:" + left + ";pointer-events:none;background:#000;border-radius:1px;";
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

  function barHasNativeGaps(bar) {
    if (!bar || !bar.querySelector) return false;
    return !!bar.querySelector(".ytp-chapter-hover-container, .ytp-chapters-container");
  }

  function bindScrub(bar, doc) {
    if (!bar || bar.getAttribute("data-langform-scrub") === "1" || barTooTall(bar)) return;
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
      if (!chapter || typeof bar.__langformOnPreview !== "function") return;
      bar.__langformOnPreview(chapter.start);
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
    });
    bar.addEventListener("pointercancel", function () {
      bar.__langformScrubbing = false;
    });
    bar.addEventListener("touchmove", function (event) {
      bar.__langformScrubbing = true;
      reveal(event);
    }, { passive: true });
  }

  function queryDeep(doc, match, start) {
    var root = start || (doc && (doc.body || doc.documentElement)) || null;
    if (!root) return null;
    var stack = [root];
    var seen = new Set();
    while (stack.length) {
      var node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      if (node.nodeType !== 1) {
        var fragmentKids = node.children;
        if (fragmentKids) {
          for (var f = fragmentKids.length - 1; f >= 0; f--) stack.push(fragmentKids[f]);
        }
        continue;
      }
      if (node.tagName === "VIDEO" || node.tagName === "SCRIPT" || node.tagName === "STYLE") continue;
      if (node.id === CHIP_ID || node.id === SHEET_ID) continue;
      if (match(node)) return node;
      if (node.shadowRoot) stack.push(node.shadowRoot);
      var kids = node.children;
      if (kids) {
        for (var i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      }
    }
    return null;
  }

  function hiddenByUs(el) {
    var node = el;
    var guard = 0;
    while (node && guard++ < 10) {
      if (node.classList && node.classList.contains("shorts-ausblenden-hidden")) return true;
      node = node.parentElement;
    }
    return false;
  }

  function unhide(el) {
    var node = el;
    var guard = 0;
    while (node && guard++ < 10) {
      if (node.classList && node.classList.contains("shorts-ausblenden-hidden")) {
        node.classList.remove("shorts-ausblenden-hidden");
      }
      node = node.parentElement;
    }
  }

  function textWithoutOurs(el) {
    var text = String((el && el.textContent) || "");
    var ours = el && el.querySelector && el.querySelector("#" + CHIP_ID);
    if (ours) text = text.replace(ours.textContent || "", " ");
    return text;
  }

  function nativeChipShowsTitle(chip) {
    var text = textWithoutOurs(chip)
      .replace(/\d{1,2}:\d{2}(?::\d{2})?\s*\/\s*\d{1,2}:\d{2}(?::\d{2})?/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return false;
    return !/^(view chapters|chapters|kapitel|kapitel ansehen|kapitel anzeigen)$/i.test(text);
  }

  function findNativeChip(doc, scope) {
    var found = queryDeep(doc, function (el) {
      var cls = classText(el);
      if (cls.indexOf("ytwPlayerTimeDisplayPlayerBarActionContainer") !== -1) return true;
      if (cls.indexOf("ytp-chapter-container") !== -1 || cls.indexOf("ytp-chapter-title") !== -1) return true;
      return el.tagName === "YTM-CHAPTER-TITLE-RENDERER" || el.tagName === "YTD-CHAPTER-TITLE-RENDERER";
    }, scope);
    if (found && found.tagName !== "BUTTON" && found.querySelectorAll) {
      var buttons = found.querySelectorAll("button");
      for (var b = 0; b < buttons.length; b++) {
        if (buttons[b].id !== CHIP_ID) {
          found = buttons[b];
          break;
        }
      }
    }
    if (!found) {
      found = queryDeep(doc, function (el) {
        if (el.tagName !== "BUTTON") return false;
        return /view chapters|kapitel ansehen|kapitel anzeigen/i.test(el.getAttribute("aria-label") || "");
      }, scope);
    }
    return found;
  }

  // The few levels around the time display: YouTube's chapter chip sits there.
  function timeRowScope(doc) {
    var node = timePill(doc);
    if (!node) return null;
    for (var i = 0; i < 4; i++) {
      var up = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
      if (!up || up === doc.body || up === doc.documentElement) break;
      node = up;
    }
    return node;
  }

  function findNativeSheet(doc) {
    return queryDeep(doc, function (el) {
      var tag = el.tagName || "";
      if (tag === "YTM-MACRO-MARKERS-LIST-RENDERER" || tag === "YTD-MACRO-MARKERS-LIST-RENDERER") return true;
      if (classText(el).indexOf("engagement-panel-macro-markers-description-chapters") !== -1) return true;
      var target = (el.getAttribute && el.getAttribute("target-id")) || "";
      return target.indexOf("macro-markers") !== -1;
    });
  }

  // YouTube's own chip opens its own sheet, which it often builds only on tap,
  // so the chip alone is enough to leave the time row to YouTube.
  // Scoped, it only looks around the time display and never walks the page.
  function nativeChapterChrome(doc, scoped, owner) {
    var scope = owner || (scoped ? timeRowScope(doc) : null);
    if (scoped && !scope) return null;
    var chip = findNativeChip(doc, scope);
    if (!chip) return null;
    var sheet = scoped ? null : findNativeSheet(doc);
    if (hiddenByUs(chip)) unhide(chip);
    if (sheet && hiddenByUs(sheet)) unhide(sheet);
    if (!nativeChipShowsTitle(chip) || !visiblyShown(chip)) return null;
    var time = timePill(doc);
    if (owner && (!time || !owner.contains(time))) return null;
    var timeBox = time && boxOf(time);
    if (timeBox && timeBox.width > 8 && timeBox.height > 4) {
      var chipBox = boxOf(chip);
      if (!chipBox || chipBox.width < 8 || chipBox.height < 8) return null;
      var midTime = timeBox.top + timeBox.height / 2;
      var midChip = chipBox.top + chipBox.height / 2;
      if (Math.abs(midTime - midChip) > 40) return null;
    }
    return { chip: chip, sheet: sheet };
  }

  function removeOurChrome(doc) {
    if (!doc) return;
    [CHIP_ID, SHEET_ID].forEach(function (id) {
      var el = doc.getElementById(id);
      if (el && el.__langformSheetAnimation) {
        el.__langformSheetAnimation.onfinish = null;
        el.__langformSheetAnimation.cancel();
        el.__langformSheetAnimation = null;
      }
      if (el && el.__langformSheetDispose) el.__langformSheetDispose();
      if (el) el.__langformSheetOpen = false;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    if (doc.documentElement) doc.documentElement.removeAttribute("data-langform-chapter-ui");
  }

  // Found once while it is laid out, then reused as long as it stays in the page.
  function timePill(doc) {
    var cached = doc.__langformTimePill;
    if (cached && cached.isConnected && visiblyShown(cached)) return cached;
    doc.__langformTimePill = null;
    var found = findTimePill(doc);
    var box = found && boxOf(found);
    if (box && box.width > 8 && box.height > 4) doc.__langformTimePill = found;
    return found;
  }

  function findTimePill(doc) {
    var best = null;
    var bestRank = Infinity;
    queryDeep(doc, function (el) {
      var text = String(el.textContent || "").replace(/\s+/g, " ").trim();
      if (!/^\d{1,2}:\d{2}(?::\d{2})?\s*\/\s*\d{1,2}:\d{2}/.test(text) || text.length > 40) return false;
      if (!visiblyShown(el)) return false;
      var kids = el.children ? el.children.length : 0;
      var box = boxOf(el);
      var shown = box && box.width > 8 && box.height > 4;
      var rank = (shown ? 0 : 1000) + kids * 10 + text.length;
      if (rank < bestRank) {
        best = el;
        bestRank = rank;
      }
      return false;
    });
    if (best) return best;
    return queryDeep(doc, function (el) {
      var cls = classText(el);
      return cls.indexOf("ytp-time-display") !== -1 || cls.indexOf("ytwPlayerTimeDisplay") !== -1 || cls.indexOf("time-display") !== -1;
    });
  }

  // The first control right of the time in the same row (fullscreen, AirPlay, …).
  function rowRightLimit(doc, timeBox, width) {
    var middle = timeBox.top + timeBox.height / 2;
    var reach = Math.max(22, timeBox.height);
    var limit = width - 8;
    var player = playerRoot(doc);
    var time = doc.__langformTimePill;
    var scope = player && time && player.contains(time) ? player : null;
    queryDeep(doc, function (el) {
      if (el.tagName !== "BUTTON" && el.getAttribute("role") !== "button") return false;
      var box = boxOf(el);
      if (!box || box.width < 4 || box.height < 4 || box.left < timeBox.right) return false;
      if (Math.abs(box.top + box.height / 2 - middle) > reach) return false;
      if (!visiblyShown(el)) return false;
      if (box.left < limit) limit = box.left;
      return false;
    }, scope);
    // Our AirPlay picker is a body overlay, outside the reactive player row.
    // Reserve its space too when it shares the chapter chip's time row.
    var airplay = doc.getElementById(AIRPLAY_ID);
    var airplayBox = airplay && boxOf(airplay);
    if (airplayBox && airplayBox.width >= 4 && airplayBox.height >= 4 && airplayBox.left >= timeBox.right &&
        Math.abs(airplayBox.top + airplayBox.height / 2 - middle) <= reach && visiblyShown(airplay)) {
      limit = Math.min(limit, airplayBox.left);
    }
    return limit;
  }

  function timeRowInUpperHalf(doc, timeBox) {
    var player = playerRoot(doc);
    var box = player && boxOf(player);
    if (!box || box.height < 40) return false;
    return timeBox.top + timeBox.height / 2 < box.top + box.height / 2;
  }

  function parkChip(chip) {
    if (chip.hasAttribute("data-langform-chip-placed")) chip.removeAttribute("data-langform-chip-placed");
    styleIfChanged(chip, "visibility", "hidden");
    styleIfChanged(chip, "pointerEvents", "none");
  }

  function styleIfChanged(el, name, value) {
    if (el.style[name] !== value) el.style[name] = value;
  }

  // The chip lives only in the time row: one line, cut with an ellipsis before
  // the first control to its right. Without a time row it is not shown at all.
  function placeChip(doc, chip) {
    styleIfChanged(chip, "minHeight", "44px");
    styleIfChanged(chip, "minWidth", "44px");
    var time = timePill(doc);
    if (!time || !time.parentNode) {
      if (chip.parentNode) chip.parentNode.removeChild(chip);
      chip.removeAttribute("data-langform-chip-placed");
      return;
    }
    if (chip.previousElementSibling !== time) time.insertAdjacentElement("afterend", chip);
    var timeBox = boxOf(time);
    if (!timeBox || timeBox.width <= 8 || timeBox.height <= 4) return;
    if (timeRowInUpperHalf(doc, timeBox)) {
      parkChip(chip);
      return;
    }
    var width = (doc.documentElement && doc.documentElement.clientWidth) || 390;
    var left = Math.round(timeBox.right + 8);
    var room = Math.floor(rowRightLimit(doc, timeBox, width) - 8 - left);
    if (room < 44) {
      parkChip(chip);
      return;
    }
    styleIfChanged(chip, "position", "fixed");
    styleIfChanged(chip, "left", left + "px");
    styleIfChanged(chip, "top", Math.round(timeBox.top + timeBox.height / 2) + "px");
    styleIfChanged(chip, "maxWidth", room + "px");
    styleIfChanged(chip, "transform", "translateY(-50%)");
    styleIfChanged(chip, "margin", "0px");
    styleIfChanged(chip, "zIndex", "6");
    styleIfChanged(chip, "visibility", "");
    styleIfChanged(chip, "pointerEvents", "");
    if (chip.getAttribute("data-langform-chip-placed") !== "1") chip.setAttribute("data-langform-chip-placed", "1");
  }

  function placeSheet(doc, sheet) {
    var player = doc.querySelector("ytm-player, #movie_player, ytd-player, #player");
    var height = (doc.documentElement && doc.documentElement.clientHeight) || 0;
    var top = height ? Math.round(height * 0.34) : 220;
    if (player && player.getBoundingClientRect) {
      var rect = player.getBoundingClientRect();
      if (rect && rect.bottom > 80 && (!height || rect.bottom < height - 80)) top = Math.round(rect.bottom);
    }
    styleIfChanged(sheet, "top", top + "px");
  }

  function setSheetOpen(doc, open) {
    var sheet = doc.getElementById(SHEET_ID);
    if (!sheet) return;
    open = !!open;
    if (sheet.__langformSheetOpen === open) return;
    sheet.__langformSheetOpen = open;
    var chip = doc.getElementById(CHIP_ID);
    if (chip) chip.setAttribute("aria-expanded", open ? "true" : "false");
    var view = doc.defaultView;
    var appMotion = view && view.__langformMotion;
    var reduced = view && view.matchMedia && view.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var fadeOnly = !!appMotion && (appMotion.reduceSpatialMotion || reduced);
    var previous = sheet.__langformSheetAnimation;
    var from = null;
    if (previous && view) {
      // Rapidly close/reopen from the visible frame, without jumping back to
      // the first keyframe. No layout property is animated.
      var visible = view.getComputedStyle(sheet);
      from = { transform: visible.transform || "translateY(0)" };
      if (fadeOnly) from.opacity = visible.opacity || "1";
      previous.onfinish = null;
      previous.cancel();
      sheet.__langformSheetAnimation = null;
    }
    var wasVisible = sheet.style.display !== "none";
    function finishClose() {
      var restoreFocus = sheet.contains(doc.activeElement);
      sheet.style.display = "none";
      sheet.setAttribute("aria-hidden", "true");
      sheet.style.pointerEvents = "";
      sheet.__langformSheetAnimation = null;
      if (restoreFocus && chip && chip.isConnected) chip.focus({ preventScroll: true });
    }
    if (open) {
      placeSheet(doc, sheet);
      sheet.style.display = "flex";
      sheet.style.pointerEvents = "";
      sheet.setAttribute("aria-hidden", "false");
      revealCurrentChapter(sheet);
    } else {
      // A selected row cannot seek twice while the closing sheet is visible.
      sheet.style.pointerEvents = "none";
    }
    if (reduced && !fadeOnly || typeof sheet.animate !== "function" || (!open && !wasVisible)) {
      if (!open) finishClose();
      return;
    }
    var rest = { transform: "translateY(0)" };
    var edge = { transform: "translateY(100%)" };
    var frames = fadeOnly
      ? [from || { transform: rest.transform, opacity: open ? 0 : 1 }, { transform: from ? from.transform : rest.transform, opacity: open ? 1 : 0 }]
      : [from || (open ? edge : rest), open ? rest : edge];
    var animation = sheet.animate(frames, {
      duration: appMotion ? (fadeOnly ? appMotion.durations.fade : open ? appMotion.durations.sheetEnter : appMotion.durations.sheetExit) : open ? 280 : 180,
      easing: appMotion ? (fadeOnly ? appMotion.easings.fade : open ? appMotion.easings.enter : appMotion.easings.exit) : open ? "cubic-bezier(0.16,1,0.3,1)" : "cubic-bezier(0.7,0,0.84,0)",
      fill: "both",
    });
    sheet.__langformSheetAnimation = animation;
    animation.onfinish = function () {
      if (sheet.__langformSheetAnimation !== animation) return;
      sheet.__langformSheetAnimation = null;
      if (!sheet.__langformSheetOpen) finishClose();
      animation.onfinish = null;
      animation.cancel();
    };
  }

  function bindSheetMotion(sheet) {
    var doc = sheet.ownerDocument, win = doc.defaultView;
    if (!win) return;
    var preference = win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)");
    function settle(restore) {
      var animation = sheet.__langformSheetAnimation;
      if (!animation) return;
      animation.onfinish = null;
      animation.cancel();
      sheet.__langformSheetAnimation = null;
      sheet.style.pointerEvents = "";
      if (!sheet.__langformSheetOpen) {
        var restoreFocus = restore !== false && sheet.contains(doc.activeElement);
        sheet.style.display = "none";
        sheet.setAttribute("aria-hidden", "true");
        var chip = doc.getElementById(CHIP_ID);
        if (restoreFocus && chip) chip.focus({ preventScroll: true });
      }
    }
    function reduce() { if (preference.matches) settle(); }
    function leave() {
      sheet.__langformSheetOpen = false;
      settle(false);
      sheet.style.display = "none";
      sheet.setAttribute("aria-hidden", "true");
      var chip = doc.getElementById(CHIP_ID);
      if (chip) chip.setAttribute("aria-expanded", "false");
    }
    win.addEventListener("resize", settle);
    win.addEventListener("orientationchange", settle);
    win.addEventListener("pagehide", leave);
    if (win.visualViewport) win.visualViewport.addEventListener("resize", settle);
    if (preference && preference.addEventListener) preference.addEventListener("change", reduce);
    if (win.__langformMotion) win.addEventListener("langform-motion-change", settle);
    sheet.__langformSheetDispose = function () {
      win.removeEventListener("resize", settle);
      win.removeEventListener("orientationchange", settle);
      win.removeEventListener("pagehide", leave);
      if (win.visualViewport) win.visualViewport.removeEventListener("resize", settle);
      if (preference && preference.removeEventListener) preference.removeEventListener("change", reduce);
      win.removeEventListener("langform-motion-change", settle);
      sheet.__langformSheetDispose = null;
    };
  }

  function chapterSheetOpen(sheet) {
    return !!(sheet && (typeof sheet.__langformSheetOpen === "boolean" ? sheet.__langformSheetOpen : sheet.style.display !== "none"));
  }

  function revealCurrentChapter(sheet) {
    var list = sheet.querySelector("[data-langform-chapter-list]");
    var row = list && list.querySelector("[aria-current='true']");
    if (!row) return;
    row.focus({ preventScroll: true });
    if (!list.clientHeight) return;
    var rowBox = row.getBoundingClientRect();
    var listBox = list.getBoundingClientRect();
    var top = list.scrollTop + rowBox.top - listBox.top - (list.clientHeight - rowBox.height) / 2;
    // Scroll only our list. scrollIntoView could also move YouTube's page and
    // the playing video underneath the sheet.
    list.scrollTop = Math.max(0, Math.min(top, list.scrollHeight - list.clientHeight));
  }

  function ensureChapterStyle(doc) {
    if (doc.getElementById("langform-chapter-style")) return;
    var style = doc.createElement("style");
    style.id = "langform-chapter-style";
    style.textContent = "#" + SHEET_ID + " [" + ROW_ATTR + "]{background:transparent;touch-action:manipulation}" +
      "#" + SHEET_ID + " [" + ROW_ATTR + "][aria-current=true]{background:rgba(255,255,255,.12)}" +
      "#" + SHEET_ID + " [" + ROW_ATTR + "]:active{background:rgba(255,255,255,.2)}" +
      "#" + CHIP_ID + " > span,#" + SHEET_ID + " header button{transition:transform var(--lf-duration-pressOut,100ms) ease-out}" +
      "#" + CHIP_ID + ":active > span,#" + SHEET_ID + " header button:active{transition-duration:var(--lf-duration-pressIn,100ms);transform:scale(calc(1 - (1 - var(--lf-scale-icon,.97)) * (1 - var(--lf-reduce-spatial-motion,0))))}" +
      "@media(prefers-reduced-motion:reduce){#" + CHIP_ID + " > span,#" + SHEET_ID + " header button{transition:none}#" + CHIP_ID + ":active > span,#" + SHEET_ID + " header button:active{transform:none}}" +
      "#" + SHEET_ID + " button:focus-visible{outline:2px solid #3ea6ff;outline-offset:-3px}";
    (doc.head || doc.documentElement).appendChild(style);
  }

  function syncChapterUi(doc, chapters, seconds) {
    if (!doc) return null;
    var list = chapters || [];
    var current = chapterAtTime(list, seconds);
    var mark = chapterMark(list, seconds);
    var root = doc.documentElement;
    if (root && root.__langformChapterShown === mark && root.__langformChapterListShown === list) {
      return current;
    }
    if (root) {
      root.__langformChapterShown = mark;
      root.__langformChapterListShown = list;
    }
    var chip = doc.getElementById(CHIP_ID);
    if (chip) {
      var label = chip.querySelector("[" + LABEL_ATTR + "]");
      var title = current ? current.title : "";
      if (label && label.textContent !== title) label.textContent = title;
      var aria = title ? title + ", Kapitel" : "Kapitel";
      if (chip.getAttribute("aria-label") !== aria) chip.setAttribute("aria-label", aria);
    }
    var rows = doc.querySelectorAll("[" + ROW_ATTR + "]");
    var currentStart = current ? Number(current.start) : NaN;
    for (var i = 0; i < rows.length; i++) {
      var start = Number(rows[i].getAttribute("data-start"));
      var on = isFinite(currentStart) && Math.abs(start - currentStart) < 0.4;
      if (on) {
        if (rows[i].getAttribute("aria-current") !== "true") rows[i].setAttribute("aria-current", "true");
      } else if (rows[i].hasAttribute("aria-current")) {
        rows[i].removeAttribute("aria-current");
      }
      var shadow = on ? "inset 3px 0 0 #ff2a2a" : "none";
      if (rows[i].style.boxShadow !== shadow) rows[i].style.boxShadow = shadow;
    }
    return current;
  }

  function chapterSig(chapters) {
    if (!chapters || chapters.length < 2) return "";
    return chapters.map(function (item) {
      return item.start + "\t" + item.title + "\t" + (item.thumbnail || "");
    }).join("\n");
  }

  function renderChapterUi(doc, chapters, seek) {
    if (!doc || !doc.documentElement) return { native: false, drawn: false };
    rememberChapters(doc, chapters || []);
    if (!chapters || chapters.length < 2) {
      removeOurChrome(doc);
      return { native: false, drawn: false };
    }
    if (nativeChapterChrome(doc)) {
      removeOurChrome(doc);
      doc.documentElement.setAttribute("data-langform-chapter-ui", "native");
      return { native: true, drawn: false };
    }
    removeOurChrome(doc);
    ensureChapterStyle(doc);
    var chip = doc.createElement("button");
    chip.id = CHIP_ID;
    chip.type = "button";
    chip.setAttribute("lang", "de");
    chip.setAttribute("aria-haspopup", "dialog");
    chip.setAttribute("aria-controls", SHEET_ID);
    chip.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "box-sizing:border-box",
      "max-width:40vw",
      "min-height:44px",
      "min-width:44px",
      "margin:0 0 0 8px",
      "padding:0",
      "border:0",
      "background:transparent",
      "color:#fff",
      "overflow:hidden",
      "white-space:nowrap",
      "vertical-align:middle",
      "z-index:6",
    ].join(";");
    var pill = doc.createElement("span");
    pill.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "gap:6px",
      "box-sizing:border-box",
      "max-width:100%",
      "min-width:0",
      "height:28px",
      "padding:0 4px",
      "border-radius:6px",
      "background:transparent",
      "font:600 13px/1 system-ui,sans-serif",
      "overflow:hidden",
      "white-space:nowrap",
    ].join(";");
    var label = doc.createElement("span");
    label.setAttribute(LABEL_ATTR, "1");
    label.style.cssText = "flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    label.textContent = chapters[0].title;
    var chevron = doc.createElement("span");
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "›";
    chevron.style.cssText = "flex:none;font-size:20px;line-height:1;";
    pill.appendChild(label);
    pill.appendChild(chevron);
    chip.appendChild(pill);
    chip.addEventListener("click", function (event) {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      if (!chip.isConnected) return;
      var sheet = doc.getElementById(SHEET_ID);
      var open = chapterSheetOpen(sheet);
      if (!open) {
        var video = doc.querySelector("video");
        syncChapterUi(doc, doc.documentElement.__langformChapterList || chapters, video ? video.currentTime : 0);
      }
      setSheetOpen(doc, !open);
    });

    var sheet = doc.createElement("section");
    sheet.id = SHEET_ID;
    sheet.setAttribute("lang", "de");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-labelledby", "langform-chapter-heading");
    sheet.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !sheet.isConnected) return;
      event.preventDefault();
      event.stopPropagation();
      setSheetOpen(doc, false);
      chip.focus({ preventScroll: true });
    });
    sheet.style.cssText = [
      "position:fixed",
      "left:0",
      "right:0",
      "bottom:0",
      "z-index:80",
      "display:none",
      "flex-direction:column",
      "background:#0f0f0f",
      "color:#fff",
      "border-radius:12px 12px 0 0",
      "box-shadow:0 -8px 24px rgba(0,0,0,.45)",
      "font:16px/1.3 system-ui,sans-serif",
      "overflow:hidden",
    ].join(";");
    var header = doc.createElement("header");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 8px 8px 16px;flex:none;";
    var heading = doc.createElement("h2");
    heading.id = "langform-chapter-heading";
    heading.textContent = "Kapitel";
    heading.style.cssText = "margin:0;font:700 18px/1.2 system-ui,sans-serif;";
    var close = doc.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Schließen");
    close.textContent = "×";
    close.style.cssText = "width:44px;height:44px;border:0;background:transparent;color:#fff;font:400 28px/1 system-ui,sans-serif;";
    close.addEventListener("click", function (event) {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      if (!sheet.isConnected) return;
      setSheetOpen(doc, false);
    });
    header.appendChild(heading);
    header.appendChild(close);
    var list = doc.createElement("div");
    list.setAttribute("data-langform-chapter-list", "1");
    list.style.cssText = "flex:1 1 auto;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:0 0 calc(20px + env(safe-area-inset-bottom, 0px));";
    for (var i = 0; i < chapters.length; i++) {
      var row = doc.createElement("button");
      row.type = "button";
      row.setAttribute(ROW_ATTR, String(i));
      row.setAttribute("data-start", String(chapters[i].start));
      row.style.cssText = "display:flex;align-items:center;box-sizing:border-box;gap:12px;width:100%;min-height:72px;margin:0;padding:10px 16px;border:0;color:#fff;text-align:left;font:inherit;";
      if (chapters[i].thumbnail) {
        var img = doc.createElement("img");
        img.alt = "";
        img.setAttribute("loading", "lazy");
        img.setAttribute("decoding", "async");
        img.src = chapters[i].thumbnail;
        img.style.cssText = "width:80px;height:45px;max-width:80px;max-height:45px;object-fit:cover;border-radius:6px;background:#222;flex:none;";
        row.appendChild(img);
      } else {
        var blank = doc.createElement("span");
        blank.style.cssText = "width:80px;height:45px;border-radius:6px;background:#222;flex:none;";
        row.appendChild(blank);
      }
      var text = doc.createElement("span");
      text.style.cssText = "display:flex;flex:1 1 auto;flex-direction:column;gap:4px;min-width:0;";
      var name = doc.createElement("span");
      name.textContent = chapters[i].title;
      name.style.cssText = "font:600 15px/1.25 system-ui,sans-serif;white-space:normal;overflow-wrap:anywhere;";
      var time = doc.createElement("span");
      time.textContent = formatClock(chapters[i].start);
      time.style.cssText = "color:#aaa;font:400 13px/1.2 system-ui,sans-serif;";
      text.appendChild(name);
      text.appendChild(time);
      row.appendChild(text);
      row.addEventListener("click", function (event) {
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        if (!sheet.isConnected || !chapterSheetOpen(sheet)) return;
        var seconds = Number(event.currentTarget.getAttribute("data-start"));
        if (seek) seek(seconds);
        syncChapterUi(doc, doc.documentElement.__langformChapterList || chapters, seconds);
        setSheetOpen(doc, false);
      });
      list.appendChild(row);
    }
    sheet.appendChild(header);
    sheet.appendChild(list);
    placeChip(doc, chip);
    (doc.body || doc.documentElement).appendChild(sheet);
    bindSheetMotion(sheet);
    setSheetOpen(doc, false);
    syncChapterUi(doc, chapters, 0);
    doc.documentElement.setAttribute("data-langform-chapter-ui", chapterSig(chapters));
    return {
      native: false,
      drawn: true,
      open: function () { setSheetOpen(doc, true); },
      close: function () { setSheetOpen(doc, false); },
    };
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

  function bindChapterPlayback(win, doc) {
    var video = doc.querySelector("#movie_player video, ytm-player video, ytd-player video, video");
    if (!video || video.__langformChapterBound) return;
    video.__langformChapterBound = true;
    function onMove() {
      if (win.__langformChapterScrolling) return;
      var root = doc.documentElement;
      var list = (root && root.__langformChapterList) || [];
      if (list.length < 2) return;
      if (root.getAttribute("data-langform-chapter-ui") === "native") return;
      var mark = chapterMark(list, video.currentTime || 0);
      if (mark === root.__langformChapterShown && root.__langformChapterListShown === list) return;
      syncChapterUi(doc, list, video.currentTime || 0);
    }
    video.addEventListener("timeupdate", onMove);
    video.addEventListener("seeked", onMove);
  }

  function videoPlaying(doc) {
    var videos = doc.getElementsByTagName("video");
    for (var i = 0; i < videos.length; i++) {
      if (!videos[i].paused && !videos[i].ended) return true;
    }
    return false;
  }

  // Our chip sits in the time row, or YouTube shows its own. Nothing left to do
  // until the chapter index changes.
  function chapterUiSettled(doc) {
    var root = doc.documentElement;
    var shown = root && root.getAttribute("data-langform-chapter-ui");
    if (!shown) return false;
    if (shown === "native") return true;
    var chip = doc.getElementById(CHIP_ID);
    return !!(chip && chip.isConnected && chip.getAttribute("data-langform-chip-placed") === "1");
  }

  function stopChapterRetry(win) {
    if (!win.__langformChapterRetry) return;
    win.clearInterval(win.__langformChapterRetry);
    win.__langformChapterRetry = 0;
  }

  function playerRoot(doc) {
    return doc.querySelector("#movie_player, ytm-player, ytd-player, .html5-video-player");
  }

  function controlText(el) {
    var parts = [
      el.getAttribute("aria-label") || "",
      el.getAttribute("title") || "",
      el.getAttribute("data-tooltip-target-id") || "",
      classText(el),
    ];
    return parts.join(" ");
  }

  function isCastControl(el) {
    var tag = String(el.tagName || "").toLowerCase();
    if (tag.indexOf("cast") !== -1) return true;
    return /(^|[^a-z])cast|chromecast|übertragen|auf (dem )?fernseher|streamen/i.test(controlText(el));
  }

  function isCaptionControl(el) {
    return /untertitel|caption|subtitle/i.test(controlText(el));
  }

  function isSettingsControl(el) {
    return /einstellungen|settings/i.test(controlText(el));
  }

  // A tap follows YouTube's chrome for a few seconds. The buttons are found once
  // and reused while they stay in the page, so that does not walk the player again.
  function cachedControls(root) {
    var known = root.__langformControls;
    var anchor = known && (known.caption || known.settings);
    if (anchor && anchor.isConnected && (!known.airplay || known.airplay.isConnected)) return known;
    var found = playerControls(root);
    root.__langformControls = found.caption || found.settings ? found : null;
    return found;
  }

  // Buttons of YouTube's own player chrome, light and shadow DOM, never the video.
  function playerControls(root) {
    var out = { caption: null, settings: null, airplay: null };
    var stack = [root];
    var seen = 0;
    while (stack.length && seen++ < 1500) {
      var node = stack.pop();
      if (!node) continue;
      if (node.nodeType === 1) {
        if (node.tagName === "VIDEO" || node.id === AIRPLAY_ID || node.id === CHIP_ID || node.id === SHEET_ID) continue;
        var button = node.tagName === "BUTTON" || node.getAttribute("role") === "button";
        if (button && !isCastControl(node) && visiblyShown(node)) {
          if (/airplay/i.test(controlText(node))) out.airplay = out.airplay || node;
          else if (!out.settings && isSettingsControl(node)) out.settings = node;
          else if (!out.caption && isCaptionControl(node)) out.caption = node;
        }
        if (node.shadowRoot) stack.push(node.shadowRoot);
      }
      var kids = node.children;
      if (kids) {
        for (var i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      }
    }
    return out;
  }

  function ancestorsOf(node) {
    var list = [];
    var guard = 0;
    while (node && guard++ < 30) {
      list.push(node);
      var rootNode = node.getRootNode && node.getRootNode();
      node = node.parentNode && node.parentNode.nodeType === 1 ? node.parentNode : (rootNode && rootNode.host) || null;
    }
    return list;
  }

  /** The element that holds both CC and the gear. Only read, never written. */
  function controlRow(controls) {
    var gear = controls.settings;
    var cc = controls.caption;
    if (gear && cc) {
      var gearChain = ancestorsOf(gear);
      var ccChain = ancestorsOf(cc);
      for (var i = 1; i < gearChain.length; i++) {
        if (ccChain.indexOf(gearChain[i]) !== -1) return gearChain[i];
      }
    }
    var one = cc || gear;
    return one ? ancestorsOf(one)[1] || null : null;
  }

  // YouTube fades its chrome with opacity on an ancestor, not on the button.
  function chromeShown(el) {
    var node = el;
    var guard = 0;
    while (node && guard++ < 30) {
      if (node.nodeType === 1) {
        if (elementHidden(node)) return false;
        var view = node.ownerDocument && node.ownerDocument.defaultView;
        try {
          var opacity = parseFloat(view.getComputedStyle(node).opacity);
          if (isFinite(opacity) && opacity < 0.35) return false;
        } catch (err) {
          /* a detached node */
        }
      }
      var rootNode = node.getRootNode && node.getRootNode();
      node = node.parentNode && node.parentNode.nodeType === 1 ? node.parentNode : (rootNode && rootNode.host) || null;
    }
    return true;
  }

  /** Left edge and line of the control group around CC, measured from YouTube's buttons. */
  function controlLine(controls) {
    var anchor = controls.caption || controls.settings;
    var box = anchor && boxOf(anchor);
    if (!box || box.width < 8 || box.height < 8 || !chromeShown(anchor)) return null;
    var left = box.left;
    var middle = box.top + box.height / 2;
    var row = controlRow(controls);
    var stack = row ? [row] : [];
    var seen = 0;
    while (stack.length && seen++ < 400) {
      var node = stack.pop();
      if (!node) continue;
      if (node.nodeType === 1) {
        if (node.tagName === "VIDEO" || node.id === AIRPLAY_ID || node.id === CHIP_ID || node.id === SHEET_ID) continue;
        if (node.tagName === "BUTTON" || node.getAttribute("role") === "button") {
          var other = boxOf(node);
          if (other && other.width > 4 && other.height > 4 && Math.abs(other.top + other.height / 2 - middle) < box.height / 2) {
            left = Math.min(left, other.left);
          }
        }
        if (node.shadowRoot) stack.push(node.shadowRoot);
      }
      var kids = node.children;
      if (kids) {
        for (var i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      }
    }
    return { left: left, middle: middle, side: box.height >= 24 && box.height <= 64 ? Math.round(box.height) : 48 };
  }

  function hideAirPlay(button) {
    if (!button) return;
    if (button.style.visibility !== "hidden") button.style.visibility = "hidden";
    if (button.style.pointerEvents !== "none") button.style.pointerEvents = "none";
  }

  function openRoutePicker(doc) {
    var movie = doc.getElementById("movie_player");
    if (movie && typeof movie.showAirplayPicker === "function") {
      try {
        movie.showAirplayPicker();
        return;
      } catch (err) {
        /* fall back to the element */
      }
    }
    var current = playerRoot(doc);
    var target = (current && current.querySelector("video")) || doc.querySelector("video");
    if (target && typeof target.webkitShowPlaybackTargetPicker === "function") {
      try {
        target.webkitShowPlaybackTargetPicker();
      } catch (err2) {
        /* WebKit refuses the picker outside a user gesture */
      }
    }
  }

  var AIRPLAY_ICON =
    '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" style="pointer-events:none">' +
    '<path fill="currentColor" d="M6 22h12l-6-6-6 6zM21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4v-2H3V5h18v12h-4v2h4c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/>' +
    "</svg>";

  function canPickRoute(win, video) {
    if (video && typeof video.webkitShowPlaybackTargetPicker === "function") return true;
    return !!(win && win.WebKitPlaybackTargetAvailabilityEvent);
  }

  function ensureAirPlay(win) {
    var doc = win && win.document;
    if (!doc) return null;
    if (!onWatchPath(win)) {
      var stale = doc.getElementById(AIRPLAY_ID);
      if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
      return null;
    }
    var root = playerRoot(doc);
    var video = root && (root.querySelector("video") || doc.querySelector("video"));
    var existing = doc.getElementById(AIRPLAY_ID);
    if (!root || !video || !canPickRoute(win, video)) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return null;
    }
    var controls = cachedControls(root);
    if (controls.airplay) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return null;
    }
    // YouTube's control row is rendered reactively. A foreign node inside it
    // broke the row and took the Cast button with it, so AirPlay is a layer
    // of its own in body, lined up with the row and only shown with it.
    var line = controlLine(controls);
    if (!line) {
      hideAirPlay(existing);
      return existing || null;
    }
    var side = line.side;
    var left = Math.round(line.left - side - 4);
    if (left < 8) {
      hideAirPlay(existing);
      return existing || null;
    }
    var button = existing;
    if (!button) {
      button = doc.createElement("button");
      button.id = AIRPLAY_ID;
      button.type = "button";
      button.setAttribute("lang", "de");
      button.setAttribute("aria-label", "AirPlay");
      button.setAttribute("title", "AirPlay");
      button.innerHTML = AIRPLAY_ICON;
      button.addEventListener("click", function (event) {
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        openRoutePicker(doc);
      });
    }
    var top = Math.round(line.middle - side / 2);
    var place = side + "|" + left + "|" + top;
    var changed = button.getAttribute("data-langform-place") !== place;
    if (changed) {
      button.style.cssText =
        "position:fixed;left:" + left + "px;top:" + top + "px;width:" + side + "px;height:" + side +
        "px;display:flex;align-items:center;justify-content:center;margin:0;padding:0;border:0;" +
        "background:transparent;color:#fff;cursor:pointer;z-index:2147483000;";
      button.setAttribute("data-langform-place", place);
    } else {
      if (button.style.visibility === "hidden") { button.style.visibility = ""; changed = true; }
      if (button.style.pointerEvents === "none") button.style.pointerEvents = "";
    }
    var host = doc.body || doc.documentElement;
    if (button.parentNode !== host) { host.appendChild(button); changed = true; }
    // Chrome can first reveal its AirPlay layer after the chapter was laid out.
    // Reclaim the shared row immediately on that change, not on every follow tick.
    if (changed) {
      var chip = doc.getElementById(CHIP_ID);
      if (chip) placeChip(doc, chip);
    }
    return button;
  }

  function playerMatchesPage(win, player) {
    var id = player && player.videoDetails && player.videoDetails.videoId;
    if (!id) return false;
    try {
      return new URL(win.location.href).searchParams.get("v") === id;
    } catch (err) {
      return false;
    }
  }

  function pageVideoKey(win, player) {
    if (player && playerMatchesPage(win, player)) return player.videoDetails.videoId;
    try {
      return new URL(win.location.href).searchParams.get("v") || "";
    } catch (err) {
      return "";
    }
  }

  function dropChipForNative(doc) {
    removeOurChrome(doc);
    if (doc.documentElement) doc.documentElement.setAttribute("data-langform-chapter-ui", "native");
  }

  function clearChapterState(win) {
    var doc = win.document;
    if (!doc || !doc.documentElement) return;
    doc.documentElement.__langformChapterGeneration = (doc.documentElement.__langformChapterGeneration || 0) + 1;
    var bar = win.__langformSeekBar;
    if (bar) clearChapterBar(bar);
    win.__langformSeekBar = null;
    if (doc.getElementById(CHIP_ID) || doc.getElementById(SHEET_ID) || doc.documentElement.hasAttribute("data-langform-chapter-ui")) {
      removeOurChrome(doc);
    }
    win.__langformChapterCache = null;
    win.__langformChapterDataCache = null;
    doc.__langformTimePill = null;
    rememberChapters(doc, []);
  }

  function leaveWatchChrome(win) {
    var doc = win.document;
    stopChapterRetry(win);
    clearChapterState(win);
    var airplay = doc.getElementById(AIRPLAY_ID);
    if (airplay && airplay.parentNode) airplay.parentNode.removeChild(airplay);
  }

  function refreshChapters(win) {
    var doc = win.document;
    if (!doc || !doc.documentElement) return;
    if (win.__langformChapterScrolling) return;
    if (!onWatchPath(win)) {
      leaveWatchChrome(win);
      return;
    }
    // Nothing to measure until YouTube has built the player.
    if (!playerRoot(doc)) return;
    ensureAirPlay(win);
    var bar = win.__langformSeekBar;
    var player = win.ytInitialPlayerResponse;
    // SPA navigation updates the URL before it replaces the response. Never
    // put the previous video's chapter titles and seek positions on the new one.
    if (!playerMatchesPage(win, player)) {
      clearChapterState(win);
      return;
    }
    var video = doc.querySelector("#movie_player video, ytm-player video, ytd-player video, video");
    var duration = Number(player && player.videoDetails && player.videoDetails.lengthSeconds);
    if ((!duration || !isFinite(duration)) && video && isFinite(video.duration) && video.duration > 0) {
      duration = video.duration;
    }
    var initialData = readInitialData(win);
    var videoID = pageVideoKey(win, player);
    var cache = win.__langformChapterCache;
    var fractions;
    if (cache && cache.player === player && cache.initialData === initialData && cache.duration === duration && duration > 0 &&
        cache.fractions.length >= 2 && (!cache.fromInitialData || initialDataVideoID(initialData) === videoID)) {
      fractions = cache.fractions;
    } else {
      var list = chaptersFromPlayer(player);
      var fromInitialData = list.length < 2;
      if (fromInitialData) list = chaptersFromInitialData(initialData, videoID);
      fractions = barFractions(list, duration);
      // An empty response can still hydrate in place. Do not memoize absence
      // or stop the existing bounded retry before watch data has arrived.
      win.__langformChapterCache = fractions.length >= 2 ?
        { player: player, initialData: initialData, fromInitialData: fromInitialData, duration: duration, fractions: fractions } : null;
    }
    if (!fractions || fractions.length < 2) {
      if (bar && bar.isConnected) clearChapterBar(bar);
      if (doc.getElementById(CHIP_ID) || doc.getElementById(SHEET_ID) || doc.documentElement.hasAttribute("data-langform-chapter-ui")) {
        removeOurChrome(doc);
      }
      rememberChapters(doc, []);
      return;
    }
    var uiSig = chapterSig(fractions);
    var chip = doc.getElementById(CHIP_ID);
    var marked = doc.documentElement.getAttribute("data-langform-chapter-ui") || "";
    var barSig = fractions.map(function (item) { return item.start + ":" + item.title; }).join("|");
    var placed = !!(chip && chip.isConnected && chip.getAttribute("data-langform-chip-placed") === "1");
    var barReady = !!(bar && bar.isConnected && bar.getAttribute("data-langform-chapter-sig") === barSig);
    var videoKey = pageVideoKey(win, player);
    // Keep normalized chapters available to fullscreen even when YouTube owns
    // the inline chapter chrome. The owner prevents reuse across navigation.
    rememberChapters(doc, fractions, videoKey);
    if (marked !== "native" && chip && nativeChapterChrome(doc, true)) {
      dropChipForNative(doc);
      marked = "native";
    }
    if (marked === "native" && nativeChapterChrome(doc, true)) {
      win.__langformNativeVideo = videoKey;
      win.__langformNativeHit = true;
      bindChapterPlayback(win, doc);
      stopChapterRetry(win);
      return;
    }
    if (marked === uiSig && placed && barReady) {
      bindChapterPlayback(win, doc);
      stopChapterRetry(win);
      return;
    }
    var found = findSeekBar(doc);
    if (!bar || !bar.isConnected || (found && found !== bar)) bar = found || bar;
    win.__langformSeekBar = bar;
    var chapterGeneration = doc.documentElement.__langformChapterGeneration || 0;
    function currentChapters() {
      return (doc.documentElement.__langformChapterGeneration || 0) === chapterGeneration &&
        (doc.documentElement.__langformChapterList || []).length > 1 &&
        pageVideoKey(win, null) === videoKey && playerMatchesPage(win, win.ytInitialPlayerResponse);
    }
    function seekChapter(seconds) {
      return currentChapters() && seekTo(win, seconds);
    }
    if (bar) {
      var drawn = bar.getAttribute("data-langform-chapter-sig") === barSig && (bar.querySelector("[" + CHAPTER_LAYER + "]") || barHasNativeGaps(bar));
      if (!drawn) drawChapterBar(bar, fractions, seekChapter);
      bar.__langformOnPreview = function (seconds) {
        if (currentChapters()) syncChapterUi(doc, fractions, seconds);
      };
    }
    if (marked === uiSig && chip && chip.isConnected) {
      if (chip.getAttribute("data-langform-chip-placed") !== "1") placeChip(doc, chip);
    } else if (videoKey && win.__langformNativeVideo === videoKey) {
      // YouTube already showed its own chip for this video. While its row is
      // faded out we do not slip a second one in.
      dropChipForNative(doc);
    } else {
      var sheet = doc.getElementById(SHEET_ID);
      var wasOpen = chapterSheetOpen(sheet);
      if (!(win.__langformNativeChecked === player && player)) {
        win.__langformNativeChecked = player || null;
        win.__langformNativeHit = player ? nativeChapterChrome(doc) : null;
      }
      var ui = renderChapterUi(doc, fractions, seekChapter);
      if (ui && ui.native) {
        win.__langformNativeHit = nativeChapterChrome(doc);
        if (videoKey) win.__langformNativeVideo = videoKey;
      }
      if (wasOpen && ui && ui.open) ui.open();
      if (video && ui && !ui.native) syncChapterUi(doc, fractions, video.currentTime || 0);
    }
    bindChapterPlayback(win, doc);
    chip = doc.getElementById(CHIP_ID);
    if ((marked === "native" && nativeChapterChrome(doc, true)) || (chip && chip.getAttribute("data-langform-chip-placed") === "1" && bar && bar.getAttribute("data-langform-chapter-sig") === barSig)) {
      stopChapterRetry(win);
    }
  }

  function innerSheetInteraction(event) {
    if (!event) return false;
    var path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (!path.length) {
      var node = event.target;
      while (node && path.length < 40) {
        path.push(node);
        var root = node.getRootNode && node.getRootNode();
        node = node.parentElement || (root && root.host) || null;
      }
    }
    for (var i = 0; i < path.length; i++) {
      var el = path[i];
      if (!el || el.nodeType !== 1) continue;
      var tag = el.tagName || "";
      if (tag === "BOTTOM-SHEET-CONTAINER" || tag === "YTM-ENGAGEMENT-PANEL" || tag === "DIALOG" ||
          tag.indexOf("YTM-COMMENT") === 0 || tag.indexOf("YTD-COMMENT") === 0 ||
          el.id === "dialog-container" || el.id === SHEET_ID || el.id === "langform-kurzfassung" ||
          el.getAttribute("role") === "dialog") return true;
    }
    return false;
  }

  function armChapters(win) {
    if (!win || !win.document || win.__langformChapters) return;
    win.__langformChapters = true;
    var timer = 0;
    var scrollTimer = 0;
    var placementTimer = 0;
    var followTimer = 0;
    var followTicks = 0;
    var followBinding = null;
    var followSerial = 0;
    var generation = 0;
    var dragPlacementDeferred = false;
    var dragChaptersDeferred = false;
    function nativeDragging() {
      return typeof win.__langformIsNativeDragging === "function" && win.__langformIsNativeDragging();
    }
    // Mobile start fires before the URL changes. Until its matching end,
    // old media and geometry events must not put the previous chapters back.
    var pendingVideoKey = null;
    var videoKey = pageVideoKey(win, null);
    function run() {
      if (pendingVideoKey !== null) return;
      if (nativeDragging()) { dragChaptersDeferred = true; return; }
      try {
        refreshChapters(win);
      } catch (err) {
        /* the player can swap the bar while we measure it */
      }
    }
    function schedule() {
      if (pendingVideoKey !== null || !onWatchPath(win) || win.__langformChapterScrolling) return;
      if (timer) win.clearTimeout(timer);
      var ticket = generation;
      timer = win.setTimeout(function () {
        if (ticket !== generation) return;
        timer = 0;
        run();
      }, 240);
    }
    // The retry only exists on a watch page. The feed never runs it.
    function watchRetry() {
      stopChapterRetry(win);
      if (pendingVideoKey !== null || !onWatchPath(win)) return;
      var tries = 0;
      var ticket = generation;
      win.__langformChapterRetry = win.setInterval(function () {
        if (ticket !== generation) return;
        tries += 1;
        // Without a player after a few seconds, a tap or the next navigation starts it again.
        if (tries > 24 || !onWatchPath(win) || (tries > 6 && !playerRoot(win.document))) stopChapterRetry(win);
        // While the video plays the page is not walked on a timer; its own events
        // and a tap finish the chapter chrome instead.
        else if (!videoPlaying(win.document)) schedule();
      }, 500);
    }
    function scheduleUnlessSettled() {
      if (pendingVideoKey !== null || !onWatchPath(win) || chapterUiSettled(win.document)) return;
      schedule();
    }
    // Geometry can change without chapter data changing (scroll or rotation).
    // Update only our existing overlays once the viewport has come to rest.
    function refreshPlacement() {
      placementTimer = 0;
      if (pendingVideoKey !== null || !onWatchPath(win) || win.__langformChapterScrolling) return;
      if (nativeDragging()) { dragPlacementDeferred = true; return; }
      var doc = win.document;
      try {
        ensureAirPlay(win);
        var chip = doc.getElementById(CHIP_ID);
        if (chip) placeChip(doc, chip);
        var sheet = doc.getElementById(SHEET_ID);
        if (chapterSheetOpen(sheet)) placeSheet(doc, sheet);
      } catch (err) {
        /* the player controls can be replaced during rotation */
      }
    }
    function schedulePlacement() {
      if (pendingVideoKey !== null || !onWatchPath(win)) return;
      if (placementTimer) win.clearTimeout(placementTimer);
      var ticket = generation;
      placementTimer = win.setTimeout(function () {
        if (ticket === generation) refreshPlacement();
      }, 160);
    }
    ["loadedmetadata", "durationchange", "playing"].forEach(function (name) {
      win.document.addEventListener(name, scheduleUnlessSettled, true);
    });
    function cancelNavigationWork() {
      generation += 1;
      if (timer) win.clearTimeout(timer);
      if (scrollTimer) win.clearTimeout(scrollTimer);
      if (placementTimer) win.clearTimeout(placementTimer);
      if (followTimer) win.clearInterval(followTimer);
      timer = scrollTimer = placementTimer = followTimer = followTicks = 0;
      followBinding = null;
      followSerial += 1;
      dragPlacementDeferred = dragChaptersDeferred = false;
      win.__langformChapterScrolling = false;
      stopChapterRetry(win);
    }
    function mobileEventKey(event) {
      var href = event && event.detail && event.detail.href;
      if (typeof href !== "string" || !href) return null;
      try {
        var url = new URL(href, win.location.href);
        if (url.origin !== win.location.origin) return null;
        return url.pathname === "/watch" || url.pathname.indexOf("/watch/") === 0 ? url.searchParams.get("v") || "" : "";
      } catch (err) {
        return null;
      }
    }
    function onMobileStart(event) {
      var nextKey = mobileEventKey(event);
      if (nextKey === null || nextKey === (pendingVideoKey !== null ? pendingVideoKey : videoKey)) return;
      cancelNavigationWork();
      pendingVideoKey = nextKey;
      clearChapterState(win);
    }
    function onPageChange(mobile) {
      var nextKey = onWatchPath(win) ? pageVideoKey(win, null) : "";
      var changed = nextKey !== videoKey || pendingVideoKey !== null;
      if (changed) {
        cancelNavigationWork();
        videoKey = nextKey;
        pendingVideoKey = null;
        clearChapterState(win);
      }
      if (!onWatchPath(win)) {
        if (!changed) cancelNavigationWork();
        leaveWatchChrome(win);
        return;
      }
      if (mobile && !changed) {
        if (!timer) scheduleUnlessSettled();
        return;
      }
      schedule();
      if (!mobile) watchRetry();
    }
    function onMobileEnd(event) {
      var nextKey = onWatchPath(win) ? pageVideoKey(win, null) : "";
      var eventKey = mobileEventKey(event);
      if (eventKey !== nextKey || (pendingVideoKey !== null && pendingVideoKey !== nextKey)) return;
      onPageChange(true);
    }
    if (onWatchPath(win)) {
      watchRetry();
      run();
    }
    win.addEventListener("yt-navigate-finish", function () { onPageChange(false); });
    win.addEventListener("popstate", function () { onPageChange(false); });
    win.addEventListener("state-navigatestart", onMobileStart);
    win.addEventListener("state-navigateend", onMobileEnd);
    win.addEventListener("video-data-change", scheduleUnlessSettled);
    win.document.addEventListener("scroll", function (event) {
      // Scrolling comments or a chapter list does not move the player. Keep
      // their touch stream free of unrelated geometry reads and AirPlay writes.
      if (pendingVideoKey !== null || !onWatchPath(win) || innerSheetInteraction(event)) return;
      if (!win.__langformChapterScrolling) hideAirPlay(win.document.getElementById(AIRPLAY_ID));
      win.__langformChapterScrolling = true;
      if (scrollTimer) win.clearTimeout(scrollTimer);
      var ticket = generation;
      scrollTimer = win.setTimeout(function () {
        if (ticket !== generation) return;
        scrollTimer = 0;
        win.__langformChapterScrolling = false;
        refreshPlacement();
        scheduleUnlessSettled();
      }, 180);
    }, { capture: true, passive: true });
    // Mobile controls are a sibling of #movie_player. Bind only their active
    // watch owner; a settled fallback still needs to yield when originals show.
    function siblingControlsBinding(player, event, path) {
      var doc = win.document;
      if (!player || player !== doc.getElementById("movie_player")) return null;
      var owner = player.closest("#player-container-id");
      var overlay = owner && owner.querySelector("#player-control-overlay");
      var chip = doc.getElementById(CHIP_ID);
      var video = player.querySelector("video");
      if (!owner || !overlay || !chip || !video || !owner.contains(chip) || player.contains(overlay) ||
          !(overlay.contains(event.target) || path.indexOf(overlay) !== -1)) return null;
      var binding = { player: player, owner: owner, overlay: overlay, chip: chip, video: video,
        key: videoKey, source: video.currentSrc || video.src || "" };
      return siblingControlsCurrent(binding) ? binding : null;
    }
    function siblingControlsCurrent(binding) {
      var doc = win.document;
      return pendingVideoKey === null && onWatchPath(win) && binding.key === videoKey &&
        pageVideoKey(win, null) === binding.key && playerMatchesPage(win, win.ytInitialPlayerResponse) &&
        doc.documentElement.__langformChapterVideoID === binding.key &&
        doc.getElementById("movie_player") === binding.player && binding.player.isConnected &&
        doc.getElementById("player-container-id") === binding.owner && binding.owner.contains(binding.player) &&
        doc.getElementById("player-control-overlay") === binding.overlay && binding.owner.contains(binding.overlay) &&
        binding.player.querySelector("video") === binding.video &&
        (binding.video.currentSrc || binding.video.src || "") === binding.source &&
        (binding.chip
          ? doc.getElementById(CHIP_ID) === binding.chip && binding.owner.contains(binding.chip)
          : binding.nativeChapter === true && !doc.getElementById(CHIP_ID) &&
            win.__langformNativeVideo === binding.key && doc.documentElement.getAttribute("data-langform-chapter-ui") === "native");
    }
    function stopFollowingControls() {
      if (followTimer) win.clearInterval(followTimer);
      followTimer = followTicks = 0;
      followBinding = null;
      followSerial += 1;
    }
    win.document.addEventListener("pointerdown", function (event) {
      if (pendingVideoKey !== null || !onWatchPath(win)) return;
      var sheet = win.document.getElementById(SHEET_ID);
      if (chapterSheetOpen(sheet) && event.target && !sheet.contains(event.target)) {
        var chip = win.document.getElementById(CHIP_ID);
        if (!chip || (event.target !== chip && !chip.contains(event.target))) setSheetOpen(win.document, false);
      }
      if (innerSheetInteraction(event)) return;
      var player = playerRoot(win.document);
      var path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (player && (player.contains(event.target) || path.indexOf(player) !== -1)) followControls();
      else {
        var binding = siblingControlsBinding(player, event, path);
        if (binding) followControls(binding);
      }
      scheduleUnlessSettled();
    }, { capture: true, passive: true });
    // A tap shows YouTube's chrome and it fades out a few seconds later.
    // AirPlay follows it for that long, reading the row and writing only our button.
    function followControls(binding) {
      if (pendingVideoKey !== null) return;
      if (followTimer && ((binding && !followBinding) || (followBinding && !siblingControlsCurrent(followBinding)))) stopFollowingControls();
      followTicks = 0;
      if (followTimer) return;
      followBinding = binding || null;
      var ticket = generation, serial = ++followSerial;
      followTimer = win.setInterval(function () {
        if (ticket !== generation || serial !== followSerial) return;
        followTicks += 1;
        if (followTicks > 16 || !onWatchPath(win) || (binding && !siblingControlsCurrent(binding))) {
          stopFollowingControls();
          return;
        }
        if (win.__langformChapterScrolling || chapterSheetOpen(win.document.getElementById(SHEET_ID)) ||
            (typeof win.__langformHasOpenOverlay === "function" && win.__langformHasOpenOverlay())) return;
        if (nativeDragging()) { dragPlacementDeferred = true; return; }
        try {
          ensureAirPlay(win);
          // A tap can bring up YouTube's own chapter chip next to ours.
          if ((followTicks === 1 || followTicks === 4) && win.document.getElementById(CHIP_ID) && nativeChapterChrome(win.document, true, binding && binding.owner) && (!binding || siblingControlsCurrent(binding))) {
            win.__langformNativeVideo = pageVideoKey(win, win.ytInitialPlayerResponse);
            dropChipForNative(win.document);
            // This exact takeover retires our chip, not the shared controls
            // lease. AirPlay must still follow the original chrome's fade;
            // all source/player/overlay guards and the 16-tick limit remain.
            if (binding) { binding.chip = null; binding.nativeChapter = true; }
          }
        } catch (err) {
          /* the row can be rebuilt while we read it */
        }
      }, 350);
    }
    ["playing", "pause", "ended"].forEach(function (name) {
      win.document.addEventListener(name, function (event) {
        if (onWatchPath(win) && event.target && event.target.tagName === "VIDEO") followControls();
      }, true);
    });
    win.addEventListener("resize", schedulePlacement);
    if (win.visualViewport) win.visualViewport.addEventListener("resize", schedulePlacement);
    // Native moves a retained WebView without changing its page layout. Leave
    // the gesture free of control-row measurements, then use
    // the existing coalesced timers for any work that actually became due.
    win.addEventListener("langform-native-drag-end", function () {
      if (dragPlacementDeferred) { dragPlacementDeferred = false; schedulePlacement(); }
      if (dragChaptersDeferred) { dragChaptersDeferred = false; schedule(); }
    });
  }

  function install(win) {
    if (!win || win.__langformPageCaptions) return;
    win.__langformPageCaptions = true;
    var nativeFetch = typeof win.fetch === "function" ? win.fetch.bind(win) : null;

    // Called by the iPhone shell only for a link the user tapped. History
    // updates never use this hook: YouTube writes t= while playback starts.
    win.__langformSeekFromLink = function (href) {
      var logic = win.ShortsAusblenden && win.ShortsAusblenden.logic;
      if (!logic || !onWatchPath(win)) return false;
      try {
        var url = new URL(String(href || ""), win.location.href);
        if (url.protocol !== "https:" && url.protocol !== "http:") return false;
        var currentId = logic.watchVideoId(win.location.href, win.location.href);
        if (!currentId || logic.watchVideoId(url.href, win.location.href) !== currentId) return false;
        var player = win.ytInitialPlayerResponse;
        if (player && player.videoDetails && !playerMatchesPage(win, player)) return false;
        var seconds = logic.timestampSeconds(url.href, win.location.href);
        return seconds != null && seekTo(win, seconds);
      } catch (err) {
        return false;
      }
    };

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
    renderChapterUi: renderChapterUi,
    syncChapterUi: syncChapterUi,
    refreshChapters: refreshChapters,
    ensureAirPlay: ensureAirPlay,
    armChapters: armChapters,
  };
});
