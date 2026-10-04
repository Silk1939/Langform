(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (!root.ShortsAusblenden) root.ShortsAusblenden = {};
  root.ShortsAusblenden.summary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var NO_CAPTIONS = "Für dieses Video gibt es keine Untertitel.";
  var EMPTY_CAPTIONS = "Die Untertitel sind leer.";
  var FAILED = "Die Untertitel sind gerade nicht zu lesen.";
  var PANEL_ID = "langform-kurzfassung";
  var STYLE_ID = "langform-kurz-style";
  var BUTTON_ATTR = "data-langform-kurz";
  var VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

  var ITEM_TAGS = {
    "ytd-rich-item-renderer": 1,
    "ytd-video-renderer": 1,
    "ytd-grid-video-renderer": 1,
    "ytd-compact-video-renderer": 1,
    "ytd-rich-grid-media": 1,
    "yt-lockup-view-model": 1,
    "ytm-video-with-context-renderer": 1,
    "ytm-compact-video-renderer": 1,
    "ytm-rich-item-renderer": 1,
    "ytm-playlist-video-renderer": 1,
    "ytd-playlist-video-renderer": 1,
    "ytd-playlist-panel-video-renderer": 1,
  };

  var HEADER_LABELS = {
    "alle abspielen": 1,
    "zufallsmix": 1,
    "play all": 1,
    "shuffle": 1,
  };

  var hosts = { "www.youtube.com": 1, "m.youtube.com": 1, "youtube.com": 1 };

  function textFromJson3(payload) {
    var events = payload && payload.events;
    if (!events || !events.length) return "";
    var parts = [];
    for (var i = 0; i < events.length; i++) {
      var segs = events[i].segs || [];
      for (var j = 0; j < segs.length; j++) {
        if (segs[j] && segs[j].utf8) parts.push(segs[j].utf8);
      }
      parts.push(" ");
    }
    return parts.join("").replace(/\s+/g, " ").trim();
  }

  function captionUrl(track, translate) {
    if (!track || !track.baseUrl) return null;
    var url;
    try {
      url = new URL(track.baseUrl, "https://www.youtube.com");
    } catch (err) {
      return null;
    }
    if (!hosts[url.hostname] || url.pathname.indexOf("/api/timedtext") !== 0) return null;
    if (url.hostname.indexOf("googlevideo") !== -1) return null;
    url.searchParams.set("fmt", "json3");
    if (translate) url.searchParams.set("tlang", "de");
    var href = url.toString();
    if (href.indexOf("googlevideo") !== -1) return null;
    return href;
  }

  function chooseTrack(tracks, translations) {
    var list = tracks || [];
    var german = list.filter(function (track) {
      return track && track.languageCode === "de";
    });
    var manualGerman = german.filter(function (track) {
      return track.kind !== "asr";
    });
    if (manualGerman.length) return { track: manualGerman[0], translate: false };
    if (german.length) return { track: german[0], translate: false };
    var manual = list.filter(function (track) {
      return track && track.kind !== "asr";
    });
    var base = manual[0] || list[0];
    if (!base) return null;
    var canTranslate =
      !translations ||
      !translations.length ||
      translations.some(function (item) {
        return item && item.languageCode === "de";
      });
    return { track: base, translate: !!canTranslate };
  }

  function splitSentences(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .split(/(?<=[.!?…])\s+/)
      .map(function (sentence) {
        return sentence.trim();
      })
      .filter(Boolean);
  }

  function isNoise(sentence) {
    if (sentence.length < 12) return true;
    return /^[\s\[(]?(musik|applaus|gelächter|lachen|untertitel(?: im Auftrag| der amara)?|subtitle)[\])]?\.?$/i.test(
      sentence
    );
  }

  function isIntro(sentence) {
    return /^(hallo|hi |hey |moin|servus|willkommen|was geht|leute[, ])/i.test(sentence);
  }

  function isOutro(sentence) {
    return /abonni|like and subscribe|daumen|bis zum nächsten|tschüss|link in der beschreibung|glocke aktiv/i.test(
      sentence
    );
  }

  function clip(sentence) {
    if (sentence.length <= 280) return sentence;
    return sentence.slice(0, 277).replace(/\s+\S*$/, "") + "…";
  }

  function spread(list, count) {
    if (list.length <= count) return list.slice();
    var out = [];
    for (var i = 0; i < count; i++) {
      var idx = Math.round((i * (list.length - 1)) / (count - 1));
      if (!out.length || out[out.length - 1] !== list[idx]) out.push(list[idx]);
    }
    return out;
  }

  function summarize(text) {
    var sentences = splitSentences(text)
      .map(clip)
      .filter(function (sentence) {
        return !isNoise(sentence);
      });
    var index = 0;
    var skipped = 0;
    while (index < sentences.length && skipped < 2 && isIntro(sentences[index])) {
      index += 1;
      skipped += 1;
    }
    var body = sentences.slice(index);
    if (!body.length) body = sentences;
    if (!body.length) return null;
    var core = body.slice();
    while (core.length > 1 && isOutro(core[core.length - 1])) core.pop();
    var aboutCount = Math.min(2, core.length);
    var ending = [];
    if (core.length > aboutCount) ending = core.slice(core.length > 4 ? -2 : -1);
    var about = core.slice(0, aboutCount);
    if (ending.length && about[about.length - 1] === ending[0] && core.length <= aboutCount + ending.length) {
      ending = core.length > aboutCount ? ending : [];
    }
    var middle = core.slice(about.length, core.length - ending.length);
    var points = spread(middle, 4).filter(function (sentence) {
      return about.indexOf(sentence) === -1 && ending.indexOf(sentence) === -1;
    });
    return { about: about, points: points, ending: ending };
  }

  function blocks(summary) {
    if (!summary) return [];
    var out = [];
    if (summary.about && summary.about.length) out.push({ heading: "Worum es geht", lines: summary.about });
    if (summary.points && summary.points.length) out.push({ heading: "Punkte", lines: summary.points });
    if (summary.ending && summary.ending.length) out.push({ heading: "Schluss", lines: summary.ending });
    return out;
  }

  function parseObjectAt(html, start) {
    var depth = 0;
    var inString = false;
    var escaped = false;
    for (var i = start; i < html.length; i++) {
      var ch = html.charAt(i);
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(start, i + 1));
          } catch (err) {
            return null;
          }
        }
      }
    }
    return null;
  }

  function extractPlayer(html, videoId) {
    var source = String(html || "");
    var key = "ytInitialPlayerResponse";
    var at = source.indexOf(key);
    var found = null;
    while (at >= 0) {
      var cursor = at + key.length;
      while (cursor < source.length && " \t\r\n=".indexOf(source.charAt(cursor)) !== -1) cursor += 1;
      if (source.charAt(cursor) === "{") {
        var player = parseObjectAt(source, cursor);
        var id = player && player.videoDetails && player.videoDetails.videoId;
        if (player && (!videoId || id === videoId)) {
          var tracks = tracksOf(player).tracks;
          if (videoId && id === videoId && tracks.length) return player;
          if (!found) found = player;
          else if (tracks.length && !tracksOf(found).tracks.length) found = player;
        }
      }
      at = source.indexOf(key, at + key.length);
    }
    return found;
  }

  function tracksOf(player) {
    var renderer = player && player.captions && player.captions.playerCaptionsTracklistRenderer;
    if (!renderer) return { tracks: [], translations: [] };
    return {
      tracks: renderer.captionTracks || [],
      translations: renderer.translationLanguages || [],
    };
  }

  function playerMatches(player, videoId) {
    return !!(player && player.videoDetails && player.videoDetails.videoId === videoId);
  }

  function watchUrl(videoId, pageUrl) {
    var host = "www.youtube.com";
    try {
      host = new URL(pageUrl).hostname;
    } catch (err) {
      host = "www.youtube.com";
    }
    if (!hosts[host]) host = "www.youtube.com";
    return "https://" + host + "/watch?v=" + encodeURIComponent(videoId) + "&hl=de";
  }

  function rowWatchHref(card, base) {
    if (!card || !card.querySelectorAll) return "";
    var anchors = card.querySelectorAll("a[href]");
    for (var i = 0; i < anchors.length; i++) {
      var href = anchors[i].getAttribute("href");
      if (videoIdFromHref(href, base)) return href;
    }
    return "";
  }

  function videoIdFromHref(href, base) {
    var url;
    try {
      url = new URL(String(href || ""), base || "https://www.youtube.com/");
    } catch (err) {
      return "";
    }
    if (!hosts[url.hostname]) return "";
    var path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/shorts" || path.indexOf("/shorts/") === 0 || path === "/feed/shorts") return "";
    if (path !== "/watch") return "";
    var id = url.searchParams.get("v") || "";
    return VIDEO_ID.test(id) ? id : "";
  }

  function clockSeconds(text) {
    var match = String(text || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    if (match[3] != null) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function durationSecondsFromCard(card) {
    if (!card || !card.querySelector) return null;
    var badge = card.querySelector(
      "ytd-thumbnail-overlay-time-status-renderer, .ytd-thumbnail-overlay-time-status-renderer, ytm-thumbnail-overlay-time-status-renderer, .ytm-thumbnail-overlay-time-status-renderer"
    );
    if (!badge) return null;
    return clockSeconds(badge.textContent || "");
  }

  async function loadSummary(videoId, env) {
    var player = env && env.player;
    var fetchText = env && env.fetchText;
    if (!playerMatches(player, videoId)) {
      if (!fetchText) return { message: FAILED };
      var page;
      try {
        page = await fetchText(watchUrl(videoId, env.pageUrl));
      } catch (err) {
        return { message: FAILED };
      }
      player = extractPlayer(page, videoId);
    }
    var found = tracksOf(player);
    var chosen = chooseTrack(found.tracks, found.translations);
    if (!chosen) return { message: NO_CAPTIONS };
    var url = captionUrl(chosen.track, chosen.translate);
    if (!url) return { message: NO_CAPTIONS };
    if (!fetchText) return { message: FAILED };
    var raw;
    try {
      raw = await fetchText(url);
    } catch (err2) {
      return { message: FAILED };
    }
    var payload = null;
    try {
      payload = JSON.parse(raw);
    } catch (err3) {
      payload = null;
    }
    var text = textFromJson3(payload);
    if (!text) return { message: EMPTY_CAPTIONS };
    var summary = summarize(text);
    if (!summary) return { message: EMPTY_CAPTIONS };
    return { summary: summary };
  }

  function parentAcross(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    var rootNode = typeof node.getRootNode === "function" ? node.getRootNode() : null;
    if (rootNode && rootNode.host) return rootNode.host;
    return null;
  }

  function videoRowOf(node) {
    var guard = 0;
    while (node && guard++ < 14) {
      if (node.nodeType === 1 && ITEM_TAGS[(node.tagName || "").toLowerCase()]) return node;
      var next = parentAcross(node);
      if (!next || next === node) break;
      var tag = next.tagName;
      if (tag === "YTD-APP" || tag === "YTM-APP" || tag === "BODY" || tag === "HTML") break;
      node = next;
    }
    return null;
  }

  function shortLabel(el) {
    if (!el || el.nodeType !== 1) return "";
    var label = el.getAttribute("aria-label") || el.getAttribute("title") || "";
    label = String(label).replace(/\s+/g, " ").trim().toLowerCase();
    if (!label) {
      var text = String(el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (text.length <= 24) label = text;
    }
    return label;
  }

  function isHeaderControl(el) {
    if (videoRowOf(el)) return false;
    var node = el;
    var guard = 0;
    while (node && guard++ < 6) {
      if (node.nodeType === 1) {
        var tag = (node.tagName || "").toLowerCase();
        if (tag.indexOf("page-header") !== -1 || tag.indexOf("playlist-header") !== -1) return true;
        if (HEADER_LABELS[shortLabel(node)]) return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function ensureStyle(doc) {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".langform-kurz-sheet {",
      "  position: fixed;",
      "  inset: 0;",
      "  z-index: 2147483000;",
      "  display: flex;",
      "  align-items: flex-end;",
      "  justify-content: center;",
      "  box-sizing: border-box;",
      "  margin: 0;",
      "  padding: 0;",
      "  background: rgba(8, 7, 6, 0.66);",
      "}",
      ".langform-kurz {",
      "  position: relative;",
      "  box-sizing: border-box;",
      "  width: min(40rem, 100%);",
      "  max-height: min(78vh, 100%);",
      "  overflow: auto;",
      "  margin: 0;",
      "  padding: 16px 18px 28px;",
      "  border-radius: 18px 18px 0 0;",
      "  background: #161410;",
      "  color: #f4efe6;",
      "  font: 16px/1.45 system-ui, sans-serif;",
      "  box-shadow: 0 -12px 36px rgba(0, 0, 0, 0.45);",
      "}",
      ".langform-kurz h2 { margin: 0; font-size: 1.15rem; color: #f4efe6; }",
      ".langform-kurz header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }",
      ".langform-kurz button {",
      "  font: inherit;",
      "  border: 0;",
      "  background: transparent;",
      "  color: #f4efe6;",
      "  min-height: 44px;",
      "  padding: 0 4px;",
      "}",
      ".langform-kurz-open {",
      "  display: inline-flex;",
      "  align-items: center;",
      "  align-self: flex-start;",
      "  width: fit-content;",
      "  max-width: 100%;",
      "  margin: 6px 0 0;",
      "  min-height: 32px;",
      "  padding: 0 2px;",
      "  border: 0;",
      "  background: transparent;",
      "  color: #e6d3b1;",
      "  font: 600 13px/1.2 system-ui, sans-serif;",
      "  white-space: nowrap;",
      "  text-decoration: underline;",
      "  text-underline-offset: 3px;",
      "  position: static;",
      "  flex: 0 0 auto;",
      "}",
      ".langform-kurz h3 { margin: 14px 0 4px; font-size: 0.95rem; }",
      ".langform-kurz p, .langform-kurz li { margin: 0 0 6px; }",
      ".langform-kurz ul { margin: 0; padding-left: 1.1rem; }",
    ].join("\n");
    (doc.documentElement || doc.head || doc.body).appendChild(style);
  }

  function fillPanel(panel, doc, result) {
    var body = panel.querySelector(".langform-kurz-body");
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);
    if (!result || result.message) {
      var note = doc.createElement("p");
      note.textContent = (result && result.message) || FAILED;
      body.appendChild(note);
      return;
    }
    blocks(result.summary).forEach(function (block) {
      var heading = doc.createElement("h3");
      heading.textContent = block.heading;
      body.appendChild(heading);
      if (block.heading === "Punkte") {
        var list = doc.createElement("ul");
        block.lines.forEach(function (line) {
          var item = doc.createElement("li");
          item.textContent = line;
          list.appendChild(item);
        });
        body.appendChild(list);
        return;
      }
      block.lines.forEach(function (line) {
        var paragraph = doc.createElement("p");
        paragraph.textContent = line;
        body.appendChild(paragraph);
      });
    });
  }

  function closeSheet(sheet) {
    if (sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet);
  }

  function ensureSheet(doc) {
    var sheet = doc.getElementById(PANEL_ID);
    if (sheet) return sheet;
    sheet = doc.createElement("div");
    sheet.id = PANEL_ID;
    sheet.className = "langform-kurz-sheet";
    sheet.setAttribute("lang", "de");
    var panel = doc.createElement("section");
    panel.className = "langform-kurz";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    var header = doc.createElement("header");
    var title = doc.createElement("h2");
    title.id = "langform-kurz-title";
    title.textContent = "Kurzfassung";
    var close = doc.createElement("button");
    close.type = "button";
    close.textContent = "Schließen";
    close.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      closeSheet(sheet);
    });
    header.appendChild(title);
    header.appendChild(close);
    var body = doc.createElement("div");
    body.className = "langform-kurz-body";
    panel.appendChild(header);
    panel.appendChild(body);
    panel.setAttribute("aria-labelledby", title.id);
    sheet.appendChild(panel);
    sheet.addEventListener("click", function (event) {
      if (event.target === sheet) closeSheet(sheet);
    });
    return sheet;
  }

  function mountSheet(doc, sheet) {
    var parent = doc.body || doc.documentElement;
    if (!parent || sheet.parentNode === parent) return;
    parent.appendChild(sheet);
  }

  function fetchTextFactory(win) {
    return function (url) {
      var fetchImpl = (win && win.fetch) || root.fetch;
      return Promise.resolve()
        .then(function () {
          return fetchImpl(url, { credentials: "include" });
        })
        .then(function (response) {
          if (!response || !response.ok) throw new Error("Antwort fehlt");
          return response.text();
        });
    };
  }

  function showSummary(doc, win, videoId) {
    ensureStyle(doc);
    var sheet = ensureSheet(doc);
    mountSheet(doc, sheet);
    if (sheet.getAttribute("data-video") === videoId && sheet.querySelector(".langform-kurz-body").childNodes.length) {
      return;
    }
    sheet.setAttribute("data-video", videoId);
    var body = sheet.querySelector(".langform-kurz-body");
    while (body.firstChild) body.removeChild(body.firstChild);
    var waiting = doc.createElement("p");
    waiting.textContent = "Die Untertitel werden gelesen …";
    body.appendChild(waiting);
    var ticket = String(Date.now()) + "-" + Math.random();
    sheet.setAttribute("data-ticket", ticket);
    var player = win && win.ytInitialPlayerResponse;
    loadSummary(videoId, {
      player: playerMatches(player, videoId) ? player : null,
      pageUrl: win && win.location ? win.location.href : "https://www.youtube.com/",
      fetchText: fetchTextFactory(win),
    }).then(function (result) {
      if (!sheet.isConnected) return;
      if (sheet.getAttribute("data-ticket") !== ticket) return;
      if (sheet.getAttribute("data-video") !== videoId) return;
      fillPanel(sheet, doc, result);
    });
  }

  function stopClick(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function placeInColumn(card, button) {
    var column = card.querySelector(
      "yt-lockup-metadata-view-model, .yt-lockup-view-model__metadata, .yt-lockup-view-model-wiz__metadata, .yt-lockup-metadata-view-model-wiz__text-container, .compact-media-item-metadata, #meta, .metadata"
    );
    var scope = column && column !== card ? column : card;
    var title = scope.querySelector(
      "#video-title, h1, h3, h4, .yt-lockup-metadata-view-model__title, .yt-lockup-metadata-view-model-wiz__title, .compact-media-item-headline"
    );
    if (title && title.parentElement && title.parentElement !== card) {
      title.parentElement.insertBefore(button, title.nextSibling);
      return;
    }
    if (column && column !== card) {
      column.appendChild(button);
      return;
    }
    if (title && title !== card) {
      title.appendChild(button);
      return;
    }
    card.appendChild(button);
  }

  function bindButton(doc, win, card, videoId) {
    if (!card || card.querySelector("[" + BUTTON_ATTR + '="' + videoId + '"]')) return;
    ensureStyle(doc);
    var button = doc.createElement("button");
    button.type = "button";
    button.className = "langform-kurz-open";
    button.setAttribute(BUTTON_ATTR, videoId);
    button.textContent = "Kurzfassung";
    ["pointerdown", "mousedown"].forEach(function (type) {
      button.addEventListener(type, stopClick, true);
    });
    button.addEventListener(
      "click",
      function (event) {
        event.preventDefault();
        event.stopPropagation();
        showSummary(doc, win, videoId);
      },
      true
    );
    placeInColumn(card, button);
  }

  function forEachElement(rootNode, visit) {
    var stack = [rootNode];
    var seen = new Set();
    while (stack.length) {
      var node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      if (node.nodeType === 1) visit(node);
      if (node.shadowRoot) stack.push(node.shadowRoot);
      var children = node.children;
      if (!children || !children.length) continue;
      for (var i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  }

  function watchAnchor(doc) {
    var selectors = ["ytd-watch-metadata", "ytm-slim-video-metadata-section-renderer", "#above-the-fold"];
    for (var i = 0; i < selectors.length; i++) {
      var found = doc.querySelector(selectors[i]);
      if (!found) continue;
      var node = found;
      var insidePlayer = false;
      while (node) {
        if (node.id === "movie_player" || node.tagName === "YTD-PLAYER" || node.tagName === "YTM-PLAYER") {
          insidePlayer = true;
          break;
        }
        node = node.parentElement;
      }
      if (!insidePlayer) return found;
    }
    return null;
  }

  function decorate(doc, pageUrl, win) {
    if (!doc) return;
    var base = pageUrl || (win && win.location && win.location.href) || "https://www.youtube.com/";
    var watchId = "";
    try {
      var page = new URL(base);
      if (hosts[page.hostname] && (page.pathname === "/watch" || page.pathname === "/watch/")) {
        watchId = page.searchParams.get("v") || "";
        if (!VIDEO_ID.test(watchId)) watchId = "";
      }
    } catch (err) {
      watchId = "";
    }
    if (watchId) {
      var meta = watchAnchor(doc);
      if (meta) bindButton(doc, win || root, meta, watchId);
    }
    forEachElement(doc, function (el) {
      if (el.tagName !== "A" || !el.getAttribute("href")) return;
      if (el.closest && el.closest("#" + PANEL_ID)) return;
      if (isHeaderControl(el)) return;
      var id = videoIdFromHref(el.getAttribute("href"), base);
      if (!id || id === watchId) return;
      var card = videoRowOf(el);
      if (!card || (card.closest && card.closest("#" + PANEL_ID))) return;
      var rowId = videoIdFromHref(rowWatchHref(card, base), base);
      if (!rowId) return;
      var seconds = durationSecondsFromCard(card);
      if (seconds != null && seconds < 60) return;
      bindButton(doc, win || root, card, rowId);
    });
  }

  function schedule(win) {
    if (!win || win.__langformKurzTimer) return;
    if (win.__langformKurzScrolling) return;
    win.__langformKurzTimer = setTimeout(function () {
      win.__langformKurzTimer = 0;
      if (win.__langformKurzScrolling || !win.document) return;
      try {
        decorate(win.document, win.location.href, win);
      } catch (err) {
        /* the page can tear the DOM down mid-walk */
      }
    }, 0);
  }

  function noteScroll(win) {
    win.__langformKurzScrolling = true;
    if (win.__langformKurzScrollTimer) clearTimeout(win.__langformKurzScrollTimer);
    win.__langformKurzScrollTimer = setTimeout(function () {
      win.__langformKurzScrolling = false;
      win.__langformKurzScrollTimer = 0;
      schedule(win);
    }, 140);
  }

  function start(win) {
    if (!win || !win.document || win.__langformKurzStarted) return;
    var host = "";
    try {
      host = win.location.hostname;
    } catch (err) {
      return;
    }
    if (!hosts[host]) return;
    win.__langformKurzStarted = true;
    win.addEventListener("yt-navigate-finish", function () {
      schedule(win);
    });
    win.addEventListener("popstate", function () {
      schedule(win);
    });
    win.document.addEventListener(
      "scroll",
      function () {
        noteScroll(win);
      },
      { passive: true, capture: true }
    );
    if (win.MutationObserver && win.document.documentElement) {
      var observer = new win.MutationObserver(function () {
        schedule(win);
      });
      observer.observe(win.document.documentElement, { childList: true, subtree: true });
    }
    schedule(win);
  }

  return {
    NO_CAPTIONS: NO_CAPTIONS,
    textFromJson3: textFromJson3,
    captionUrl: captionUrl,
    chooseTrack: chooseTrack,
    summarize: summarize,
    blocks: blocks,
    extractPlayer: extractPlayer,
    loadSummary: loadSummary,
    videoIdFromHref: videoIdFromHref,
    decorate: decorate,
    start: start,
    poke: schedule,
  };
});
