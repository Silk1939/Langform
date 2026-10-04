(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (!root.ShortsAusblenden) root.ShortsAusblenden = {};
  root.ShortsAusblenden.summary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var NO_CAPTIONS = "Für dieses Video gibt es keine Untertitel.";
  var EMPTY_CAPTIONS = "Die Untertitel sind leer.";
  var FAILED = "Die Untertitel sind gerade nicht zu lesen.";
  var UNAVAILABLE = "Die Kurzfassung geht nur mit dem Modell auf dem Gerät, und das ist gerade nicht verfügbar.";
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

  function decodeEntities(value) {
    var text = String(value || "");
    for (var pass = 0; pass < 2; pass++) {
      var next = text
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&apos;|&#39;/gi, "'")
        .replace(/&#(\d+);/g, function (_, n) {
          return String.fromCharCode(Number(n));
        })
        .replace(/&#x([0-9a-f]+);/gi, function (_, n) {
          return String.fromCharCode(parseInt(n, 16));
        });
      if (next === text) break;
      text = next;
    }
    return text;
  }

  function textFromTags(xml, tag) {
    var parts = [];
    var re = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + ">", "gi");
    var match;
    var found = false;
    while ((match = re.exec(xml))) {
      found = true;
      parts.push(decodeEntities(match[1]));
      parts.push(" ");
    }
    if (!found) return "";
    return parts.join("").replace(/\s+/g, " ").trim();
  }

  function textFromCaptions(raw) {
    var source = String(raw || "")
      .replace(/^\uFEFF/, "")
      .trim();
    if (!source) return "";
    if (source.indexOf(")]}'") === 0) source = source.replace(/^\)\]\}'\s*/, "");
    var fromJson = "";
    if (source.charAt(0) === "{" || source.charAt(0) === "[") {
      try {
        fromJson = textFromJson3(JSON.parse(source));
      } catch (err) {
        fromJson = "";
      }
      if (fromJson) return fromJson;
    }
    if (source.indexOf("<") !== -1) {
      var classic = textFromTags(source, "text");
      if (classic) return classic;
      var srv3 = textFromTags(source, "p");
      if (srv3) return srv3;
    }
    return fromJson || "";
  }

  function captionUrl(track, translate, fmt) {
    if (!track || !track.baseUrl) return null;
    var url;
    try {
      url = new URL(track.baseUrl, "https://www.youtube.com");
    } catch (err) {
      return null;
    }
    if (!hosts[url.hostname] || url.pathname.indexOf("/api/timedtext") !== 0) return null;
    if (url.hostname.indexOf("googlevideo") !== -1) return null;
    if (fmt) url.searchParams.set("fmt", fmt);
    if (translate) url.searchParams.set("tlang", "de");
    var href = url.toString();
    if (href.indexOf("googlevideo") !== -1) return null;
    return href;
  }

  function timedtextUrls(track, translate) {
    var first = captionUrl(track, translate);
    if (!first) return [];
    var second = captionUrl(track, translate, "json3");
    if (!second || second === first) return [first];
    return [first, second];
  }

  function isGerman(code) {
    var value = String(code || "").toLowerCase();
    return value === "de" || value.indexOf("de-") === 0;
  }

  function canTranslateToGerman(translations) {
    return (
      !translations ||
      !translations.length ||
      translations.some(function (item) {
        return item && isGerman(item.languageCode);
      })
    );
  }

  function rankTracks(tracks, translations) {
    var list = (tracks || []).filter(function (track) {
      return track && track.baseUrl;
    });
    var germanManual = [];
    var germanAsr = [];
    var otherManual = [];
    var otherAsr = [];
    list.forEach(function (track) {
      var german = isGerman(track.languageCode);
      var asr = track.kind === "asr";
      if (german && !asr) germanManual.push(track);
      else if (german) germanAsr.push(track);
      else if (!asr) otherManual.push(track);
      else otherAsr.push(track);
    });
    var translate = canTranslateToGerman(translations);
    var ordered = [];
    germanManual.concat(germanAsr).forEach(function (track) {
      ordered.push({ track: track, translate: false });
    });
    otherManual.concat(otherAsr).slice(0, 2).forEach(function (track) {
      ordered.push({ track: track, translate: !!translate });
    });
    return ordered;
  }

  function chooseTrack(tracks, translations) {
    var ranked = rankTracks(tracks, translations);
    return ranked.length ? ranked[0] : null;
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

  function cleanModelLine(line) {
    return String(line || "")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/[♪♫]/g, " ")
      .replace(/\b[Bb]ro\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function asParagraph(value) {
    if (Array.isArray(value)) return cleanModelLine(value.join(" "));
    return cleanModelLine(value);
  }

  function asPoints(value) {
    var list = Array.isArray(value) ? value : splitSentences(value);
    return list
      .map(cleanModelLine)
      .filter(Boolean)
      .slice(0, 6);
  }

  function normalizeModelSummary(payload) {
    var summary = payload && payload.summary ? payload.summary : null;
    if (!summary) return { message: (payload && payload.message) || UNAVAILABLE };
    var about = asParagraph(summary.about);
    var points = asPoints(summary.points);
    var ending = asParagraph(summary.ending);
    if (!about && !points.length && !ending) return { message: UNAVAILABLE };
    return {
      summary: {
        about: about ? [about] : [],
        points: points,
        ending: ending ? [ending] : [],
      },
    };
  }

  function askHost(text, host) {
    return new Promise(function (resolve) {
      var settled = false;
      function finish(payload) {
        if (settled) return;
        settled = true;
        resolve(normalizeModelSummary(payload));
      }
      var page = host || root;
      try {
        var handlers = page.webkit && page.webkit.messageHandlers;
        if (handlers && handlers.langformSummary && typeof handlers.langformSummary.postMessage === "function") {
          var id = String(Date.now()) + "-" + Math.random();
          page.__langformKurzWait = page.__langformKurzWait || {};
          page.__langformKurzWait[id] = finish;
          page.__langformKurzFinish = function (ticket, payload) {
            var wait = page.__langformKurzWait && page.__langformKurzWait[ticket];
            if (!wait) return;
            delete page.__langformKurzWait[ticket];
            wait(payload);
          };
          handlers.langformSummary.postMessage({ id: id, text: String(text || "") });
          return;
        }
      } catch (err) {
        /* the page bridge is optional */
      }
      var runtime = null;
      try {
        runtime =
          (root.browser && root.browser.runtime) ||
          (page.browser && page.browser.runtime) ||
          (root.chrome && root.chrome.runtime) ||
          (page.chrome && page.chrome.runtime) ||
          null;
      } catch (err2) {
        runtime = null;
      }
      if (runtime && typeof runtime.sendNativeMessage === "function") {
        var callback = function (response) {
          var failed = false;
          try {
            failed = !!runtime.lastError;
          } catch (err3) {
            failed = false;
          }
          if (failed || !response) finish({ message: UNAVAILABLE });
          else finish(response);
        };
        try {
          var pending = runtime.sendNativeMessage(
            "de.ipekkaya.shorts-ausblenden",
            { text: String(text || "") },
            callback
          );
          if (pending && typeof pending.then === "function") {
            pending.then(callback, function () {
              finish({ message: UNAVAILABLE });
            });
          }
          return;
        } catch (err4) {
          /* try the next path */
        }
      }
      finish({ message: UNAVAILABLE });
    });
  }

  async function askModel(text, env) {
    try {
      if (env && typeof env.summarize === "function") {
        return normalizeModelSummary(await env.summarize(text));
      }
      return await askHost(text, env && env.host);
    } catch (err) {
      return { message: UNAVAILABLE };
    }
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

  function pageHost(pageUrl) {
    var host = "www.youtube.com";
    try {
      host = new URL(pageUrl).hostname;
    } catch (err) {
      host = "www.youtube.com";
    }
    if (!hosts[host]) host = "www.youtube.com";
    return host;
  }

  function watchUrl(videoId, pageUrl) {
    return "https://" + pageHost(pageUrl) + "/watch?v=" + encodeURIComponent(videoId) + "&hl=de";
  }

  function playerEndpoint(pageUrl, apiKey) {
    return (
      "https://" +
      pageHost(pageUrl) +
      "/youtubei/v1/player?prettyPrint=false&key=" +
      encodeURIComponent(apiKey)
    );
  }

  function configValue(ytcfg, name) {
    if (!ytcfg) return null;
    if (typeof ytcfg.get === "function") {
      try {
        var viaGet = ytcfg.get(name);
        if (viaGet != null && viaGet !== "") return viaGet;
      } catch (err) {
        /* the page config can throw while it is still booting */
      }
    }
    if (ytcfg.data_ && ytcfg.data_[name] != null && ytcfg.data_[name] !== "") return ytcfg.data_[name];
    if (ytcfg[name] != null && ytcfg[name] !== "") return ytcfg[name];
    return null;
  }

  function readConfig(ytcfg) {
    var key = configValue(ytcfg, "INNERTUBE_API_KEY");
    var context = configValue(ytcfg, "INNERTUBE_CONTEXT");
    if (!key || !context || !context.client) return null;
    return { key: String(key), context: context, sts: configValue(ytcfg, "STS") };
  }

  function webClient(context) {
    var source = (context && context.client) || {};
    var client = {};
    for (var key in source) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      // This block makes YouTube sign the caption URL with exp=xpe, and that URL returns an empty body.
      if (key === "configInfo") continue;
      client[key] = source[key];
    }
    if (client.clientName !== "WEB" && client.clientName !== "MWEB") client.clientName = "WEB";
    return client;
  }

  function playerBody(videoId, config) {
    var client = webClient(config.context);
    var context = {};
    for (var key in config.context) {
      if (Object.prototype.hasOwnProperty.call(config.context, key)) context[key] = config.context[key];
    }
    context.client = client;
    var body = {
      context: context,
      videoId: videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    };
    var sts = Number(config.sts);
    if (sts) body.playbackContext = { contentPlaybackContext: { signatureTimestamp: sts } };
    return body;
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

  async function requestPlayer(videoId, env, config) {
    var client = webClient(config.context);
    var headers = { "Content-Type": "application/json" };
    headers["X-YouTube-Client-Name"] = client.clientName === "MWEB" ? "2" : "1";
    if (client.clientVersion) headers["X-YouTube-Client-Version"] = String(client.clientVersion);
    if (client.visitorData) headers["X-Goog-Visitor-Id"] = String(client.visitorData);
    var raw = await env.fetchText(playerEndpoint(env.pageUrl, config.key), {
      method: "POST",
      headers: headers,
      body: JSON.stringify(playerBody(videoId, config)),
    });
    var parsed = null;
    try {
      parsed = JSON.parse(String(raw || ""));
    } catch (err) {
      return null;
    }
    if (!parsed || !tracksOf(parsed).tracks.length) return null;
    var id = parsed.videoDetails && parsed.videoDetails.videoId;
    if (id && id !== videoId) return null;
    return parsed;
  }

  async function readTracks(player, fetchText) {
    var found = tracksOf(player);
    var attempts = rankTracks(found.tracks, found.translations);
    if (!attempts.length) return { kind: "none" };
    if (!fetchText) return { kind: "error" };
    var empty = false;
    var error = false;
    for (var i = 0; i < attempts.length; i++) {
      var urls = timedtextUrls(attempts[i].track, attempts[i].translate);
      for (var u = 0; u < urls.length; u++) {
        var raw;
        try {
          raw = await fetchText(urls[u]);
        } catch (err) {
          error = true;
          continue;
        }
        if (raw == null || String(raw).trim() === "") {
          empty = true;
          continue;
        }
        var text = textFromCaptions(raw);
        if (!text) {
          empty = true;
          continue;
        }
        return { kind: "text", text: text };
      }
    }
    if (empty) return { kind: "empty" };
    if (error) return { kind: "error" };
    return { kind: "empty" };
  }

  async function loadSummary(videoId, env) {
    env = env || {};
    var fetchText = env.fetchText;
    var sawTracks = false;
    var sawEmpty = false;
    var sawError = false;

    async function consider(player) {
      if (!player) return null;
      var read = await readTracks(player, fetchText);
      if (read.kind === "none") return null;
      sawTracks = true;
      if (read.kind === "text") return askModel(read.text, env);
      if (read.kind === "empty") sawEmpty = true;
      if (read.kind === "error") sawError = true;
      return null;
    }

    var config = readConfig(env.ytcfg);
    if (config && fetchText) {
      try {
        var fromApi = await consider(await requestPlayer(videoId, env, config));
        if (fromApi) return fromApi;
      } catch (err) {
        sawError = true;
      }
    }
    var embedded = playerMatches(env.player, videoId) ? env.player : null;
    if (!sawTracks && embedded) {
      var fromEmbedded = await consider(embedded);
      if (fromEmbedded) return fromEmbedded;
      // The open watch page already answered. An empty track list is not a
      // missing document, so do not fetch the watch HTML again.
      if (!tracksOf(embedded).tracks.length) return { message: NO_CAPTIONS };
    }
    if (!sawTracks && fetchText && !embedded) {
      try {
        var page = await fetchText(watchUrl(videoId, env.pageUrl));
        var fromWatch = await consider(extractPlayer(page, videoId));
        if (fromWatch) return fromWatch;
      } catch (err2) {
        sawError = true;
      }
    }
    if (!sawTracks) return { message: sawError ? FAILED : NO_CAPTIONS };
    if (sawEmpty) return { message: EMPTY_CAPTIONS };
    return { message: FAILED };
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
      "  display: flex;",
      "  flex-direction: column;",
      "  width: min(40rem, 100%);",
      "  max-height: min(78dvh, calc(100% - env(safe-area-inset-top, 0px)));",
      "  overflow: hidden;",
      "  margin: 0;",
      "  padding: 0;",
      "  border-radius: 18px 18px 0 0;",
      "  background: #161410;",
      "  color: #f4efe6;",
      "  font: 16px/1.45 system-ui, sans-serif;",
      "  box-shadow: 0 -12px 36px rgba(0, 0, 0, 0.45);",
      "}",
      ".langform-kurz h2 { margin: 0; font-size: 1.15rem; color: #f4efe6; }",
      ".langform-kurz header {",
      "  display: flex;",
      "  flex: 0 0 auto;",
      "  align-items: center;",
      "  justify-content: space-between;",
      "  gap: 12px;",
      "  padding: 16px 18px 0;",
      "}",
      ".langform-kurz-body {",
      "  flex: 1 1 auto;",
      "  overflow-y: auto;",
      "  -webkit-overflow-scrolling: touch;",
      "  padding: 0 18px calc(36px + env(safe-area-inset-bottom, 0px));",
      "}",
      ".langform-kurz h3 { scroll-margin-bottom: calc(24px + env(safe-area-inset-bottom, 0px)); }",
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
    return function (url, init) {
      var fetchImpl = (win && win.fetch) || root.fetch;
      var options = { credentials: "include" };
      if (init && init.method) options.method = init.method;
      if (init && init.body != null) options.body = init.body;
      if (init && init.headers) options.headers = init.headers;
      return Promise.resolve()
        .then(function () {
          return fetchImpl(url, options);
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
    waiting.textContent = "Die Kurzfassung wird geschrieben …";
    body.appendChild(waiting);
    var ticket = String(Date.now()) + "-" + Math.random();
    sheet.setAttribute("data-ticket", ticket);
    var player = win && win.ytInitialPlayerResponse;
    loadSummary(videoId, {
      player: playerMatches(player, videoId) ? player : null,
      pageUrl: win && win.location ? win.location.href : "https://www.youtube.com/",
      ytcfg: win && win.ytcfg,
      host: win,
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
    EMPTY_CAPTIONS: EMPTY_CAPTIONS,
    UNAVAILABLE: UNAVAILABLE,
    textFromJson3: textFromJson3,
    textFromCaptions: textFromCaptions,
    captionUrl: captionUrl,
    chooseTrack: chooseTrack,
    blocks: blocks,
    extractPlayer: extractPlayer,
    loadSummary: loadSummary,
    videoIdFromHref: videoIdFromHref,
    decorate: decorate,
    start: start,
    poke: schedule,
  };
});
