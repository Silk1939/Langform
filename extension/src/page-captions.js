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
  var CHIP_ID = "langform-chapter-chip";
  var SHEET_ID = "langform-chapter-sheet";
  var LABEL_ATTR = "data-langform-chapter-label";
  var ROW_ATTR = "data-langform-chapter-row";
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

  function addMacro(renderer, list) {
    if (!renderer) return;
    var endpoint = renderer.onTap && renderer.onTap.watchEndpoint;
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
    var time = findTimePill(doc);
    var timeBox = time && boxOf(time);
    var live = !!(timeBox && timeBox.width > 8 && timeBox.height > 4);
    if (live) {
      var best = null;
      var bestDist = Infinity;
      var bestWidth = -1;
      var bestHeight = Infinity;
      queryDeep(doc, function (el) {
        if (el.getAttribute && el.getAttribute(CHAPTER_LAYER)) return false;
        if (!visiblyShown(el)) return false;
        var box = boxOf(el);
        if (!box || box.width < 80 || box.height < 1 || box.height > 14) return false;
        if (box.top < timeBox.bottom - 8) return false;
        if (box.top > timeBox.bottom + 36) return false;
        if (box.width < timeBox.width + 24) return false;
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
      });
      if (best) return best;
    }
    var picked = null;
    var pickedScore = 99;
    queryDeep(doc, function (el) {
      if (!visiblyShown(el)) return false;
      var score = seekBarScore(el);
      if (score && score < pickedScore) {
        picked = el;
        pickedScore = score;
      }
      return false;
    });
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
    if (!doc || seconds == null || !isFinite(seconds) || seconds <= 0) return false;
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

  function rememberChapters(doc, chapters) {
    if (doc && doc.documentElement) doc.documentElement.__langformChapterList = chapters || [];
  }

  function clearChapterBar(bar) {
    if (!bar || !bar.querySelectorAll) return;
    var layers = bar.querySelectorAll("[" + CHAPTER_LAYER + "]");
    for (var i = 0; i < layers.length; i++) layers[i].remove();
    bar.removeAttribute("data-langform-chapter-sig");
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
    layer.style.cssText = "position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;z-index:8;";
    for (var i = 0; i < fractions.length; i++) {
      if (!(fractions[i].fraction > 0.004)) continue;
      var gap = doc.createElement("div");
      gap.setAttribute(CHAPTER_MARK, String(i));
      gap.setAttribute("data-start", String(fractions[i].start));
      gap.setAttribute("data-title", fractions[i].title);
      gap.setAttribute("role", "button");
      gap.setAttribute("aria-label", fractions[i].title);
      var left = (fractions[i].fraction * 100).toFixed(4) + "%";
      gap.style.cssText = "position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;left:" + left + ";pointer-events:auto;background:#000;";
      gap.addEventListener("click", function (event) {
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        var seconds = Number(event.currentTarget.getAttribute("data-start"));
        if (seek) seek(seconds);
        if (typeof bar.__langformOnPreview === "function") bar.__langformOnPreview(seconds);
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

  function queryDeep(doc, match) {
    var root = (doc && (doc.body || doc.documentElement)) || null;
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

  function nativeChipShowsTitle(chip) {
    var text = String((chip && chip.textContent) || "").replace(/\s+/g, " ").trim();
    if (!text) return false;
    return !/^(view chapters|chapters|kapitel|kapitel ansehen|kapitel anzeigen)$/i.test(text);
  }

  function findNativeChip(doc) {
    var found = queryDeep(doc, function (el) {
      var cls = classText(el);
      if (cls.indexOf("ytwPlayerTimeDisplayPlayerBarActionContainer") !== -1) return true;
      if (cls.indexOf("ytp-chapter-container") !== -1 || cls.indexOf("ytp-chapter-title") !== -1) return true;
      return el.tagName === "YTM-CHAPTER-TITLE-RENDERER" || el.tagName === "YTD-CHAPTER-TITLE-RENDERER";
    });
    if (found && found.tagName !== "BUTTON" && found.querySelector) {
      var button = found.querySelector("button");
      if (button) found = button;
    }
    if (!found) {
      found = queryDeep(doc, function (el) {
        if (el.tagName !== "BUTTON") return false;
        return /view chapters|kapitel ansehen|kapitel anzeigen/i.test(el.getAttribute("aria-label") || "");
      });
    }
    return found;
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

  function nativeChapterChrome(doc) {
    var chip = findNativeChip(doc);
    var sheet = findNativeSheet(doc);
    if (!chip || !sheet) return null;
    if (hiddenByUs(chip)) unhide(chip);
    if (hiddenByUs(sheet)) unhide(sheet);
    if (!nativeChipShowsTitle(chip) || !visiblyShown(chip)) return null;
    var time = findTimePill(doc);
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
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    if (doc.documentElement) doc.documentElement.removeAttribute("data-langform-chapter-ui");
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

  function placeChip(doc, chip) {
    chip.style.minHeight = "44px";
    chip.style.minWidth = "44px";
    var time = findTimePill(doc);
    if (time && time.parentNode) {
      if (chip.previousElementSibling !== time) time.insertAdjacentElement("afterend", chip);
      var timeBox = boxOf(time);
      if (timeBox && timeBox.width > 8 && timeBox.height > 4) {
        var width = (doc.documentElement && doc.documentElement.clientWidth) || 390;
        var left = Math.round(timeBox.right + 8);
        if (left > width - 48) left = Math.max(8, width - 48);
        chip.style.position = "fixed";
        chip.style.left = left + "px";
        chip.style.top = Math.round(timeBox.top + timeBox.height / 2) + "px";
        chip.style.transform = "translateY(-50%)";
        chip.style.margin = "0";
        chip.style.zIndex = "6";
        chip.setAttribute("data-langform-chip-placed", "1");
      }
      return;
    }
    var bar = findSeekBar(doc);
    if (bar && bar.parentNode) {
      if (chip.nextSibling !== bar) bar.parentNode.insertBefore(chip, bar);
      return;
    }
    var parent = doc.body || doc.documentElement;
    if (parent && chip.parentNode !== parent) parent.appendChild(chip);
  }

  function placeSheet(doc, sheet) {
    var player = doc.querySelector("ytm-player, #movie_player, ytd-player, #player");
    var height = (doc.documentElement && doc.documentElement.clientHeight) || 0;
    var top = height ? Math.round(height * 0.34) : 220;
    if (player && player.getBoundingClientRect) {
      var rect = player.getBoundingClientRect();
      if (rect && rect.bottom > 80 && (!height || rect.bottom < height - 80)) top = Math.round(rect.bottom);
    }
    sheet.style.top = top + "px";
  }

  function setSheetOpen(doc, open) {
    var sheet = doc.getElementById(SHEET_ID);
    if (!sheet) return;
    if (open) placeSheet(doc, sheet);
    sheet.style.display = open ? "flex" : "none";
    sheet.setAttribute("aria-hidden", open ? "false" : "true");
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
    var chip = doc.createElement("button");
    chip.id = CHIP_ID;
    chip.type = "button";
    chip.setAttribute("lang", "de");
    chip.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "gap:6px",
      "max-width:48vw",
      "margin:0 0 0 8px",
      "padding:5px 8px 5px 10px",
      "border:0",
      "border-radius:8px",
      "background:rgba(20,20,20,.72)",
      "color:#fff",
      "font:600 13px/1.2 system-ui,sans-serif",
      "vertical-align:middle",
      "min-height:44px",
      "min-width:44px",
      "z-index:6",
    ].join(";");
    var label = doc.createElement("span");
    label.setAttribute(LABEL_ATTR, "1");
    label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;";
    label.textContent = chapters[0].title;
    var chevron = doc.createElement("span");
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = ">";
    chevron.style.cssText = "flex:none;";
    chip.appendChild(label);
    chip.appendChild(chevron);
    chip.addEventListener("click", function (event) {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      var sheet = doc.getElementById(SHEET_ID);
      var open = sheet && sheet.style.display !== "none";
      setSheetOpen(doc, !open);
      if (!open) {
        var video = doc.querySelector("video");
        syncChapterUi(doc, doc.documentElement.__langformChapterList || chapters, video ? video.currentTime : 0);
      }
    });

    var sheet = doc.createElement("section");
    sheet.id = SHEET_ID;
    sheet.setAttribute("lang", "de");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-labelledby", "langform-chapter-heading");
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
      setSheetOpen(doc, false);
    });
    header.appendChild(heading);
    header.appendChild(close);
    var list = doc.createElement("div");
    list.style.cssText = "overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:0 0 calc(20px + env(safe-area-inset-bottom, 0px));";
    for (var i = 0; i < chapters.length; i++) {
      var row = doc.createElement("button");
      row.type = "button";
      row.setAttribute(ROW_ATTR, String(i));
      row.setAttribute("data-start", String(chapters[i].start));
      row.style.cssText = "display:flex;align-items:center;gap:12px;width:100%;margin:0;padding:8px 16px;border:0;background:transparent;color:#fff;text-align:left;font:inherit;";
      if (chapters[i].thumbnail) {
        var img = doc.createElement("img");
        img.src = chapters[i].thumbnail;
        img.alt = "";
        img.setAttribute("decoding", "async");
        img.style.cssText = "width:112px;height:63px;object-fit:cover;border-radius:8px;background:#222;flex:none;";
        row.appendChild(img);
      } else {
        var blank = doc.createElement("span");
        blank.style.cssText = "width:112px;height:63px;border-radius:8px;background:#222;flex:none;";
        row.appendChild(blank);
      }
      var text = doc.createElement("span");
      text.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:0;";
      var name = doc.createElement("span");
      name.textContent = chapters[i].title;
      name.style.cssText = "font:600 15px/1.25 system-ui,sans-serif;";
      var time = doc.createElement("span");
      time.textContent = formatClock(chapters[i].start);
      time.style.cssText = "color:#aaa;font:400 13px/1.2 system-ui,sans-serif;";
      text.appendChild(name);
      text.appendChild(time);
      row.appendChild(text);
      row.addEventListener("click", function (event) {
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
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

  function stopChapterRetry(win) {
    if (!win.__langformChapterRetry) return;
    win.clearInterval(win.__langformChapterRetry);
    win.__langformChapterRetry = 0;
  }

  function refreshChapters(win) {
    var doc = win.document;
    if (!doc || !doc.documentElement) return;
    if (win.__langformChapterScrolling) return;
    var bar = win.__langformSeekBar;
    if (!onWatchPath(win)) {
      removeOurChrome(doc);
      if (bar && bar.isConnected) clearChapterBar(bar);
      rememberChapters(doc, []);
      stopChapterRetry(win);
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
    if (!fractions || fractions.length < 2) {
      var foundEmpty = findSeekBar(doc);
      if (!bar || !bar.isConnected || (foundEmpty && foundEmpty !== bar)) bar = foundEmpty || bar;
      win.__langformSeekBar = bar;
      removeOurChrome(doc);
      if (bar) clearChapterBar(bar);
      rememberChapters(doc, []);
      stopChapterRetry(win);
      return;
    }
    var uiSig = chapterSig(fractions);
    var chip = doc.getElementById(CHIP_ID);
    var marked = doc.documentElement.getAttribute("data-langform-chapter-ui") || "";
    var barSig = fractions.map(function (item) { return item.start + ":" + item.title; }).join("|");
    var placed = !!(chip && chip.isConnected && chip.getAttribute("data-langform-chip-placed") === "1");
    var barReady = !!(bar && bar.isConnected && bar.getAttribute("data-langform-chapter-sig") === barSig);
    if (marked === "native" && nativeChapterChrome(doc)) {
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
    rememberChapters(doc, fractions);
    if (bar) {
      bar.__langformOnPreview = function (seconds) { syncChapterUi(doc, fractions, seconds); };
      var drawn = bar.getAttribute("data-langform-chapter-sig") === barSig && (bar.querySelector("[" + CHAPTER_LAYER + "]") || barHasNativeGaps(bar));
      if (!drawn) drawChapterBar(bar, fractions, function (seconds) { seekTo(win, seconds); });
    }
    if (marked === uiSig && chip && chip.isConnected) {
      if (chip.getAttribute("data-langform-chip-placed") !== "1") placeChip(doc, chip);
    } else {
      var sheet = doc.getElementById(SHEET_ID);
      var wasOpen = !!(sheet && sheet.style.display !== "none");
      if (!(win.__langformNativeChecked === player && player)) {
        win.__langformNativeChecked = player || null;
        win.__langformNativeHit = player ? nativeChapterChrome(doc) : null;
      }
      var ui = renderChapterUi(doc, fractions, function (seconds) { seekTo(win, seconds); });
      if (ui && ui.native) win.__langformNativeHit = nativeChapterChrome(doc);
      if (wasOpen && ui && ui.open) ui.open();
      if (video && ui && !ui.native) syncChapterUi(doc, fractions, video.currentTime || 0);
    }
    bindChapterPlayback(win, doc);
    chip = doc.getElementById(CHIP_ID);
    if ((marked === "native" && nativeChapterChrome(doc)) || (chip && chip.getAttribute("data-langform-chip-placed") === "1" && bar && bar.getAttribute("data-langform-chapter-sig") === barSig)) {
      stopChapterRetry(win);
    }
  }

  function armChapters(win) {
    if (!win || !win.document || win.__langformChapters) return;
    win.__langformChapters = true;
    var timer = 0;
    var scrollTimer = 0;
    function schedule() {
      if (win.__langformChapterScrolling) return;
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
    win.document.addEventListener("scroll", function () {
      win.__langformChapterScrolling = true;
      if (scrollTimer) win.clearTimeout(scrollTimer);
      scrollTimer = win.setTimeout(function () {
        scrollTimer = 0;
        win.__langformChapterScrolling = false;
        schedule();
      }, 180);
    }, { capture: true, passive: true });
    win.document.addEventListener("pointerdown", function (event) {
      var sheet = win.document.getElementById(SHEET_ID);
      if (sheet && sheet.style.display !== "none" && event.target && !sheet.contains(event.target)) {
        var chip = win.document.getElementById(CHIP_ID);
        if (!chip || (event.target !== chip && !chip.contains(event.target))) setSheetOpen(win.document, false);
      }
      if (!onWatchPath(win)) return;
      var root = win.document.documentElement;
      var shown = root && root.getAttribute("data-langform-chapter-ui");
      var placedChip = win.document.getElementById(CHIP_ID);
      var placed = shown === "native" || (placedChip && placedChip.getAttribute("data-langform-chip-placed") === "1");
      if (!shown || !placed) schedule();
    }, { capture: true, passive: true });
    var tries = 0;
    win.__langformChapterRetry = win.setInterval(function () {
      tries += 1;
      if (tries > 24) stopChapterRetry(win);
      else schedule();
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
    renderChapterUi: renderChapterUi,
    syncChapterUi: syncChapterUi,
  };
});
