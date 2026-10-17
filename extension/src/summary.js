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
  var INSUFFICIENT_CONTENT = "Aus diesen Untertiteln lässt sich gerade keine verlässliche Kurzfassung erstellen.";
  var ERROR_MESSAGES = {
    MISSING_CAPTIONS: EMPTY_CAPTIONS,
    UNUSABLE_CAPTIONS: INSUFFICIENT_CONTENT,
    INSUFFICIENT_CONTENT: INSUFFICIENT_CONTENT,
    MODEL_UNAVAILABLE: UNAVAILABLE,
    UNTRUSTED_SENDER: "Die Kurzfassung konnte auf dieser Seite nicht angefordert werden.",
    INVALID_CAPTIONS: "Die Untertitel konnten nicht an die Kurzfassung übergeben werden.",
    CAPTIONS_TOO_LARGE: "Die Untertitel sind für die lokale Kurzfassung gerade zu groß.",
    NATIVE_CONNECTION_UNAVAILABLE: "Die Verbindung zur Kurzfassung-App ist gerade nicht verfügbar.",
    NATIVE_CONNECTION_FAILED: "Die Kurzfassung-App konnte nicht erreicht werden. Bitte versuche es erneut.",
    RELAY_CONNECTION_FAILED: "Die Browser-Erweiterung konnte die Kurzfassung nicht anfordern. Bitte versuche es erneut.",
    RELAY_DISCONNECTED: "Die Verbindung zur Browser-Erweiterung wurde während der Kurzfassung unterbrochen. Bitte versuche es erneut.",
    INVALID_NATIVE_RESPONSE: "Die Kurzfassung-App hat keine gültige Antwort zurückgegeben. Bitte versuche es erneut.",
    NATIVE_TIMEOUT: "Die Kurzfassung braucht zu lange. Bitte versuche es erneut.",
    CANCELLED: "Die Kurzfassung wurde abgebrochen.",
    GENERATION_FAILED: "Die Kurzfassung konnte gerade nicht erstellt werden. Bitte versuche es erneut.",
    CAPTIONS_TIMEOUT: "Die Untertitel konnten nicht rechtzeitig geladen werden. Bitte versuche es erneut.",
  };
  var MAX_POINTS = 8;
  var CACHE_VERSION = "structured-tldr-3";
  var CACHE_LIMIT = 12;
  var HOST_TIMEOUT_MS = 10 * 60 * 1000;
  var WEBVIEW_HOST_TIMEOUT_MS = 3 * 60 * 1000;
  var CAPTIONS_TIMEOUT_MS = 30 * 1000;
  var HEARTBEAT_MS = 20 * 1000;
  var PROGRESS_POLL_MS = 1000;
  var PANEL_ID = "langform-kurzfassung";
  var STYLE_ID = "langform-kurz-style";
  var BUTTON_ATTR = "data-langform-kurz";
  var TRANSCRIPT_ATTR = "data-langform-transcript";
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
    // Strip actual caption markup before decoding. Decoded angle brackets are
    // source text (for example a comparison), never another layer of markup.
    var text = String(value || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "");
    function codePoint(entity, number) {
      if (!Number.isInteger(number) || number <= 0 || number > 0x10ffff || (number >= 0xd800 && number <= 0xdfff)) return entity;
      return String.fromCodePoint(number);
    }
    for (var pass = 0; pass < 2; pass++) {
      var next = text
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&apos;|&#39;/gi, "'")
        .replace(/&#(\d+);/g, function (entity, n) {
          return codePoint(entity, Number(n));
        })
        .replace(/&#x([0-9a-f]+);/gi, function (entity, n) {
          return codePoint(entity, parseInt(n, 16));
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
      .replace(/\[(?:musik|music|applaus|applause|lachen|laughter)\]/gi, " ")
      .replace(/[♪♫]/g, " ")
      .replace(/\b[Bb]ro\b/g, " ")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\s+[—–]\s+/g, ", ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function modelText(value) {
    return typeof value === "string" ? cleanModelLine(value) : "";
  }

  function asPoints(value) {
    var list = Array.isArray(value) ? value : typeof value === "string" ? splitSentences(value) : [];
    var seen = new Set();
    return list
      .filter(function (line) { return typeof line === "string"; })
      .map(cleanModelLine)
      .filter(function (line) {
        var key = line.toLowerCase();
        if (!line || seen.has(key)) return false;
        // The local model can copy this source meta remark even when asked
        // for one factual point. Do not filter concrete study limitations.
        if (/^(?:das|dies) (?:ist|war) (?:die )?einzige (?:neue )?information[.!]?$/i.test(line)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_POINTS);
  }

  function normalizeModelSummary(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return summaryFailure("INVALID_NATIVE_RESPONSE");
    var summary = payload.summary;
    if (!summary) {
      var code = typeof payload.code === "string" && payload.code.trim() ? payload.code : null;
      var message = modelText(payload.message);
      if (code) return { code: code, message: message || ERROR_MESSAGES[code] || ERROR_MESSAGES.GENERATION_FAILED };
      if (message) return { message: message };
      return summaryFailure("INVALID_NATIVE_RESPONSE");
    }
    if (typeof summary !== "object" || Array.isArray(summary) || (!Array.isArray(summary.points) && typeof summary.points !== "string")) {
      return summaryFailure("INVALID_NATIVE_RESPONSE");
    }
    var points = asPoints(summary.points);
    if (!points.length) return summaryFailure("INSUFFICIENT_CONTENT");
    var normalized = { points: points };
    ["tldr", "takeaway", "caveat"].forEach(function (key) {
      var text = modelText(summary[key]);
      if (text) normalized[key] = text;
    });
    var coverage = summary.coverage;
    if (coverage && typeof coverage.complete === "boolean") {
      normalized.coverage = { complete: coverage.complete };
      ["processedSections", "totalSections"].forEach(function (key) {
        if (Number.isInteger(coverage[key]) && coverage[key] >= 0) normalized.coverage[key] = coverage[key];
      });
      var incompleteNotice = "Die Kurzfassung beruht auf einem Teil der verfügbaren Untertitel.";
      if (!coverage.complete && (!normalized.caveat || normalized.caveat.indexOf(incompleteNotice) === -1)) {
        normalized.caveat = (normalized.caveat ? normalized.caveat + " " : "") + incompleteNotice;
      }
    }
    return { summary: normalized };
  }

  function summaryFailure(code) {
    return { code: code, message: ERROR_MESSAGES[code] || ERROR_MESSAGES.GENERATION_FAILED };
  }

  function transportFailure(error, code) {
    return summaryFailure(error && error.name === "AbortError" ? "CANCELLED" : code);
  }

  function validSummaryResult(result) {
    var points = result && !result.message && result.summary && result.summary.points;
    return Array.isArray(points) && points.length > 0 && points.every(function (point) {
      return typeof point === "string" && point.trim().length > 0;
    });
  }

  function reusableSummaryResult(result) {
    return validSummaryResult(result) && !(result.summary.coverage && result.summary.coverage.complete === false);
  }

  function ownGlobal() {
    if (typeof globalThis !== "undefined") return globalThis;
    return null;
  }

  function nativeRuntime(page) {
    function take(runtime, promiseApi) {
      if (!runtime || (typeof runtime.sendMessage !== "function" && typeof runtime.sendNativeMessage !== "function")) return null;
      return { api: runtime, promiseApi: promiseApi };
    }
    try {
      if (typeof browser !== "undefined") {
        var fromBrowser = take(browser && browser.runtime, true);
        if (fromBrowser) return fromBrowser;
      }
    } catch (err) {
      /* the page world has no extension binding */
    }
    try {
      if (typeof chrome !== "undefined") {
        var fromChrome = take(chrome && chrome.runtime, false);
        if (fromChrome) return fromChrome;
      }
    } catch (err2) {
      /* chrome is optional */
    }
    var scopes = [page, ownGlobal()];
    for (var i = 0; i < scopes.length; i++) {
      var scope = scopes[i];
      if (!scope) continue;
      try {
        var found = take(scope.browser && scope.browser.runtime, true) || take(scope.chrome && scope.chrome.runtime, false);
        if (found) return found;
      } catch (err3) {
        /* this scope is not the extension */
      }
    }
    return null;
  }

  function normalizeProgress(payload) {
    var progress = payload && payload.progress;
    if (!progress || typeof progress !== "object" || Array.isArray(progress)) return null;
    if (["preparing", "reading", "reducing", "writing"].indexOf(progress.phase) === -1) return null;
    var processed = progress.processedSections;
    var total = progress.totalSections;
    if (!Number.isInteger(processed) || !Number.isInteger(total) || processed < 0 || total < processed || total > 10000) return null;
    if (typeof progress.sourceIncomplete !== "boolean" || typeof progress.coverageIncomplete !== "boolean") return null;
    var normalized = {
      phase: progress.phase, processedSections: processed, totalSections: total,
      sourceIncomplete: progress.sourceIncomplete, coverageIncomplete: progress.coverageIncomplete,
    };
    if (progress.tldr !== undefined) {
      if (typeof progress.tldr !== "string" || progress.tldr.length > 2000) return null;
      // A preview can only represent the whole available source after reading
      // is finished. A partial-source summary is left to the final response.
      if (progress.phase !== "writing" || total === 0 || processed !== total || progress.sourceIncomplete || progress.coverageIncomplete) return null;
      normalized.tldr = modelText(progress.tldr);
    }
    return normalized;
  }

  function askHost(text, host, onProgress) {
    return new Promise(function (resolve) {
      var settled = false;
      var port = null;
      var heartbeatTimer = 0;
      var progressTimer = 0;
      var hostTimer = 0;
      var timers = null;
      var hostTicket = null;
      function onHeartbeatAck(message) {
        // The background's reply refreshes Safari's background activity.
        // It is never a summary and must not complete the native request.
        if (!message || message.type !== "langform:summary-heartbeat-ack") return;
      }
      function onPortDisconnect() {
        try { void runtime.lastError; } catch (error) { /* inspect optional runtime error */ }
        finish(summaryFailure("RELAY_DISCONNECTED"));
      }
      function cleanup() {
        if (heartbeatTimer) timers.clearInterval(heartbeatTimer);
        if (progressTimer) timers.clearInterval(progressTimer);
        if (hostTimer) timers.clearTimeout(hostTimer);
        heartbeatTimer = progressTimer = hostTimer = 0;
        if (hostTicket && page && page.__langformKurzWait) delete page.__langformKurzWait[hostTicket];
        hostTicket = null;
        if (!port) return;
        try {
          if (port.onMessage && typeof port.onMessage.removeListener === "function") port.onMessage.removeListener(onHeartbeatAck);
          if (port.onDisconnect && typeof port.onDisconnect.removeListener === "function") port.onDisconnect.removeListener(onPortDisconnect);
          port.disconnect();
        } catch (error) { /* the background may already have disconnected */ }
        port = null;
      }
      function finish(payload) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(normalizeModelSummary(payload));
      }
      var bridgeError = null;
      var page = host || ownGlobal();
      try {
        var handlers = page && page.webkit && page.webkit.messageHandlers;
        if (handlers && handlers.langformSummary && typeof handlers.langformSummary.postMessage === "function") {
          var id = String(Date.now()) + "-" + Math.random();
          hostTicket = id;
          timers = page && typeof page.setTimeout === "function" ? page : ownGlobal();
          hostTimer = timers.setTimeout(function () { finish(summaryFailure("NATIVE_TIMEOUT")); }, WEBVIEW_HOST_TIMEOUT_MS);
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
        if (id && page && page.__langformKurzWait) delete page.__langformKurzWait[id];
        bridgeError = err;
      }
      var binding = nativeRuntime(page);
      if (binding) {
        var runtime = binding.api;
        var relay = typeof runtime.sendMessage === "function";
        var failureCode = relay ? "RELAY_CONNECTION_FAILED" : "NATIVE_CONNECTION_FAILED";
        var callback = function (response) {
          try {
            var error = runtime.lastError;
            if (error) finish(transportFailure(error, failureCode));
            else finish(response);
          } catch (err3) {
            finish(transportFailure(err3, failureCode));
          }
        };
        try {
          timers = page && typeof page.setInterval === "function" && typeof page.setTimeout === "function" ? page : ownGlobal();
          hostTimer = timers.setTimeout(function () { finish(summaryFailure("NATIVE_TIMEOUT")); }, HOST_TIMEOUT_MS);
          if (relay && typeof runtime.connect === "function") {
            // A pending native Promise does not keep Safari's background
            // alive. Exchanging port messages does, even for long videos.
            port = runtime.connect({ name: "langform:summary-keepalive" });
            if (!port || typeof port.postMessage !== "function" || !port.onMessage || !port.onDisconnect) {
              throw new Error("Summary relay port unavailable");
            }
            port.onMessage.addListener(onHeartbeatAck);
            port.onDisconnect.addListener(onPortDisconnect);
            var heartbeat = function () {
              try { port.postMessage({ type: "langform:summary-heartbeat" }); }
              catch (error) { finish(transportFailure(error, "RELAY_DISCONNECTED")); }
            };
            heartbeat();
            if (settled) return;
            heartbeatTimer = timers.setInterval(heartbeat, HEARTBEAT_MS);
          }
          // Safari only permits native messaging in the extension background,
          // not in an isolated content script. Keep captions off the DOM bus.
          var method = relay ? "sendMessage" : "sendNativeMessage";
          var requestId = "summary-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
          var args = relay
            ? [{ type: "langform:summarize", text: String(text || ""), requestId: requestId }]
            : ["de.ipekkaya.shorts-ausblenden", { text: String(text || "") }];
          if (!binding.promiseApi) args.push(callback);
          var pending = runtime[method].apply(runtime, args);
          if (pending && typeof pending.then === "function") {
            pending.then(callback, function (error) {
              finish(transportFailure(error, failureCode));
            });
          } else if (binding.promiseApi) {
            finish(summaryFailure(failureCode));
          }
          if (relay && !settled) {
            var pollPending = false;
            progressTimer = timers.setInterval(function () {
              if (settled || pollPending) return;
              pollPending = true;
              var pollFinished = false;
              function receiveProgress(response) {
                if (pollFinished) return;
                pollFinished = true;
                pollPending = false;
                if (settled) return;
                try {
                  if (runtime.lastError) return;
                  var progress = normalizeProgress(response);
                  if (progress && typeof onProgress === "function") onProgress(progress);
                } catch (error) { /* optional progress cannot affect the final response */ }
              }
              try {
                var pollArgs = [{ type: "langform:summary-status", requestId: requestId }];
                if (!binding.promiseApi) pollArgs.push(receiveProgress);
                var poll = runtime.sendMessage.apply(runtime, pollArgs);
                if (poll && typeof poll.then === "function") poll.then(receiveProgress, function () { receiveProgress(null); });
                else if (binding.promiseApi) receiveProgress(null);
              } catch (error) { receiveProgress(null); }
            }, PROGRESS_POLL_MS);
          }
          return;
        } catch (err4) {
          finish(transportFailure(err4, failureCode));
          return;
        }
      }
      finish(bridgeError ? transportFailure(bridgeError, "NATIVE_CONNECTION_FAILED") : summaryFailure("NATIVE_CONNECTION_UNAVAILABLE"));
    });
  }

  async function askModel(text, env) {
    try {
      if (env && typeof env.summarize === "function") {
        return normalizeModelSummary(await env.summarize(text));
      }
      return await askHost(text, env && env.host, env && env.onProgress);
    } catch (err) {
      return transportFailure(err, "GENERATION_FAILED");
    }
  }

  function blocks(summary) {
    if (!summary || !summary.points) return [];
    return summary.points.slice();
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

  function livePlayer(win, videoId) {
    var player = win && win.ytInitialPlayerResponse;
    if (!player || typeof player !== "object") return null;
    return playerMatches(player, videoId) ? player : null;
  }

  function isWatchPageUrl(pageUrl, videoId) {
    try {
      var page = new URL(pageUrl || "");
      if (!hosts[page.hostname]) return false;
      if (page.pathname !== "/watch" && page.pathname !== "/watch/") return false;
      return page.searchParams.get("v") === videoId;
    } catch (err) {
      return false;
    }
  }

  function isolatedFromPage(win) {
    try {
      if (win.chrome && win.chrome.runtime && win.chrome.runtime.id) return true;
      if (win.browser && win.browser.runtime && win.browser.runtime.id) return true;
    } catch (err) {
      return false;
    }
    return false;
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

  async function readTracks(player, fetchText, originalLanguage) {
    var found = tracksOf(player);
    var attempts = rankTracks(found.tracks, found.translations);
    if (!attempts.length) return { kind: "none" };
    if (!fetchText) return { kind: "error" };
    var empty = false;
    var error = false;
    for (var i = 0; i < attempts.length; i++) {
      var urls = timedtextUrls(attempts[i].track, !originalLanguage && attempts[i].translate);
      for (var u = 0; u < urls.length; u++) {
        var raw;
        try {
          raw = await fetchText(urls[u]);
        } catch (err) {
          if (err && err.code === "CAPTIONS_TIMEOUT") return { kind: "timeout" };
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

  async function loadTranscript(videoId, env) {
    env = env || {};
    var fetchText = env.fetchText;
    var sawTracks = false;
    var sawEmpty = false;
    var sawError = false;

    async function consider(player) {
      if (!player) return null;
      var read = await readTracks(player, fetchText, env.originalLanguage);
      if (read.kind === "none") return null;
      sawTracks = true;
      if (read.kind === "text") return { text: read.text };
      if (read.kind === "timeout") return summaryFailure("CAPTIONS_TIMEOUT");
      if (read.kind === "empty") sawEmpty = true;
      if (read.kind === "error") sawError = true;
      return null;
    }

    if (env.watchPage && playerMatches(env.player, videoId)) {
      var fromWatchPlayer = await consider(env.player);
      if (fromWatchPlayer) return fromWatchPlayer;
      // A filled player with no tracks will not grow captions later.
      // An empty body can still be an unreadable signature; the player endpoint below may sign another.
      if (!tracksOf(env.player).tracks.length) return { message: NO_CAPTIONS };
    }
    var config = readConfig(env.ytcfg);
    if (config && fetchText) {
      try {
        var fromApi = await consider(await requestPlayer(videoId, env, config));
        if (fromApi) return fromApi;
      } catch (err) {
        if (err && err.code === "CAPTIONS_TIMEOUT") return summaryFailure("CAPTIONS_TIMEOUT");
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
        if (err2 && err2.code === "CAPTIONS_TIMEOUT") return summaryFailure("CAPTIONS_TIMEOUT");
        sawError = true;
      }
    }
    if (!sawTracks) return { message: sawError ? FAILED : NO_CAPTIONS };
    if (sawEmpty) return { message: EMPTY_CAPTIONS };
    return { message: FAILED };
  }

  async function loadSummary(videoId, env) {
    var transcript = await loadTranscript(videoId, env);
    return transcript.text ? askModel(transcript.text, env || {}) : transcript;
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
      "  overflow: clip;",
      "}",
      ".langform-kurz-backdrop { position: absolute; inset: 0; background: rgba(8, 7, 6, 0.66); }",
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
      "  min-height: 0;",
      "  overflow-y: auto;",
      "  -webkit-overflow-scrolling: touch;",
      "  padding: 12px 18px calc(36px + env(safe-area-inset-bottom, 0px));",
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
      "  min-height: 44px;",
      "  padding: 0 2px;",
      "  border: 0;",
      "  background: transparent;",
      "  color: var(--yt-spec-text-primary, inherit);",
      "  font: 600 13px/1.2 system-ui, sans-serif;",
      "  white-space: nowrap;",
      "  text-decoration: underline;",
      "  text-underline-offset: 3px;",
      "  position: static;",
      "  flex: 0 0 auto;",
      "}",
      ".langform-kurz h3 { margin: 20px 0 8px; font-size: 1rem; font-weight: 500; }",
      ".langform-kurz-body h3:first-child { margin-top: 0; }",
      ".langform-kurz p, .langform-kurz li { margin: 0 0 12px; line-height: 1.5; }",
      ".langform-kurz ul { margin: 0; padding-left: 1.1rem; }",
      ".langform-kurz button, .langform-kurz-open { transition: transform var(--lf-duration-pressOut,100ms) ease-out, background-color 100ms ease-out; -webkit-tap-highlight-color: transparent; }",
      ".langform-kurz button:active, .langform-kurz-open:active { transition-duration:var(--lf-duration-pressIn,100ms); transform: scale(calc(1 - (1 - var(--lf-scale-icon,.97)) * (1 - var(--lf-reduce-spatial-motion,0)))); }",
      "@media (prefers-reduced-motion: reduce) { .langform-kurz button, .langform-kurz-open { transition: none; } .langform-kurz button:active, .langform-kurz-open:active { transform: none; } }",
    ].join("\n");
    (doc.documentElement || doc.head || doc.body).appendChild(style);
  }

  function fillPanel(panel, doc, result) {
    var body = panel.querySelector(".langform-kurz-body");
    if (!body) return;
    body.setAttribute("aria-busy", "false");
    panel.setAttribute("data-summary-state", "error");
    while (body.firstChild) body.removeChild(body.firstChild);
    var points = result && result.summary && result.summary.points;
    if (!validSummaryResult(result)) {
      var note = doc.createElement("p");
      note.textContent = (result && result.message) || ERROR_MESSAGES.INVALID_NATIVE_RESPONSE;
      body.appendChild(note);
      if (typeof panel.__langformKurzRetry === "function") {
        var retry = doc.createElement("button");
        retry.type = "button";
        retry.className = "langform-kurz-retry";
        retry.textContent = "Erneut versuchen";
        retry.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          panel.__langformKurzRetry();
        });
        body.appendChild(retry);
      }
      return;
    }
    var summary = result.summary;
    function paragraphSection(title, text) {
      if (!text) return;
      var heading = doc.createElement("h3");
      heading.textContent = title;
      var paragraph = doc.createElement("p");
      paragraph.textContent = text;
      body.appendChild(heading);
      body.appendChild(paragraph);
    }
    paragraphSection("TLDR", summary.tldr);
    // Older native apps return only points. Show what they supplied without
    // inventing an introduction or a takeaway during an app update.
    if (summary.tldr || summary.takeaway) {
      var heading = doc.createElement("h3");
      heading.textContent = "Die wichtigsten Punkte";
      body.appendChild(heading);
    }
    var list = doc.createElement("ul");
    points.forEach(function (line) {
      var item = doc.createElement("li");
      item.textContent = line;
      list.appendChild(item);
    });
    body.appendChild(list);
    paragraphSection("Das bleibt hängen", summary.takeaway);
    paragraphSection("Wichtige Einordnung", summary.caveat);
    panel.setAttribute("data-summary-state", "ready");
    panel.__langformKurzResult = result;
  }

  function fillProgress(panel, doc, progress) {
    var body = panel.querySelector(".langform-kurz-body");
    if (!body) return;
    var label = "Die Untertitel werden vorbereitet …";
    if (progress.phase === "reading") {
      label = progress.totalSections > 0
        ? "Die Untertitel werden gelesen: " + progress.processedSections + " von " + progress.totalSections + " Abschnitten …"
        : "Die Untertitel werden gelesen …";
    } else if (progress.phase === "reducing") {
      label = "Die Inhalte werden zusammengeführt …";
    } else if (progress.phase === "writing") {
      label = progress.tldr ? "Wird noch ergänzt … Die wichtigsten Punkte werden geschrieben." : "Die Kurzfassung wird geschrieben …";
    }
    // Most polls repeat the same status. Preserve the existing text and scroll
    // position instead of repeatedly announcing it to assistive technology.
    var signature = JSON.stringify(progress);
    if (panel.__langformKurzProgressSignature === signature) return;
    panel.__langformKurzProgressSignature = signature;
    while (body.firstChild) body.removeChild(body.firstChild);
    if (progress.tldr) {
      var heading = doc.createElement("h3");
      heading.textContent = "TLDR";
      var tldr = doc.createElement("p");
      tldr.textContent = progress.tldr;
      body.appendChild(heading);
      body.appendChild(tldr);
    }
    var status = doc.createElement("p");
    status.className = "langform-kurz-progress";
    status.textContent = label;
    body.appendChild(status);
    if (progress.sourceIncomplete || progress.coverageIncomplete) {
      var caveat = doc.createElement("p");
      caveat.textContent = progress.coverageIncomplete
        ? "Bisher konnte nur ein Teil der Untertitel berücksichtigt werden."
        : "Die verfügbaren Untertitel sind unvollständig.";
      body.appendChild(caveat);
    }
    body.setAttribute("aria-busy", "true");
    panel.setAttribute("data-summary-state", "pending");
  }

  function stopObservingProgress(sheet) {
    if (sheet && typeof sheet.__langformKurzStopProgress === "function") sheet.__langformKurzStopProgress();
  }

  function stopSheetMotion(sheet) {
    var motion = sheet.__langformKurzMotion;
    sheet.__langformKurzMotion = null;
    if (motion) motion.animations.forEach(function (animation) {
      animation.onfinish = null;
      animation.cancel();
    });
  }

  function finishSheetClose(sheet, restoreFocus) {
    stopObservingProgress(sheet);
    stopSheetMotion(sheet);
    if (sheet.__langformKurzDispose) sheet.__langformKurzDispose();
    var doc = sheet.ownerDocument;
    var focusedHere = sheet.contains(doc.activeElement);
    if (sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet);
    var opener = sheet.__langformKurzOpener;
    if (restoreFocus && focusedHere && opener && opener.isConnected) opener.focus({ preventScroll: true });
  }

  function moveSummarySheet(sheet, opening) {
    var win = sheet.ownerDocument.defaultView;
    var panel = sheet.querySelector(".langform-kurz");
    var backdrop = sheet.querySelector(".langform-kurz-backdrop");
    var preference = sheet.__langformKurzReduced;
    var appMotion = win && win.__langformMotion;
    var fadeOnly = !!appMotion && (appMotion.reduceSpatialMotion || preference && preference.matches);
    if (!win || (preference && preference.matches && !fadeOnly) || typeof panel.animate !== "function") {
      stopSheetMotion(sheet);
      if (!opening) finishSheetClose(sheet, true);
      return;
    }
    var from = opening ? "translateY(100%)" : "translateY(0)";
    var shade = opening ? "0" : "1";
    var opacity = opening ? 0 : 1;
    if (sheet.__langformKurzMotion) {
      var pose = win.getComputedStyle(panel);
      from = pose.transform;
      if (fadeOnly) opacity = pose.opacity || "1";
      shade = win.getComputedStyle(backdrop).opacity;
    } else if (fadeOnly) from = "translateY(0)";
    stopSheetMotion(sheet);
    var timing = { duration: appMotion ? (fadeOnly ? appMotion.durations.fade : opening ? appMotion.durations.sheetEnter : appMotion.durations.sheetExit) : opening ? 280 : 180,
      easing: appMotion ? (fadeOnly ? appMotion.easings.fade : opening ? appMotion.easings.enter : appMotion.easings.exit) : opening ? "cubic-bezier(.16,1,.3,1)" : "cubic-bezier(.7,0,.84,0)", fill: "both" };
    var frames = fadeOnly ? [{ transform: from, opacity: opacity }, { transform: from, opacity: opening ? 1 : 0 }]
      : [{ transform: from }, { transform: opening ? "translateY(0)" : "translateY(100%)" }];
    var motion = { opening: opening, animations: [
      panel.animate(frames, timing),
      backdrop.animate([{ opacity: shade }, { opacity: opening ? "1" : "0" }], timing),
    ] };
    sheet.__langformKurzMotion = motion;
    motion.animations[0].onfinish = function () {
      if (sheet.__langformKurzMotion !== motion) return;
      if (opening) stopSheetMotion(sheet);
      else finishSheetClose(sheet, true);
    };
  }

  function closeSheet(sheet, immediate) {
    if (!sheet) return;
    if (immediate) { finishSheetClose(sheet, false); return; }
    if (sheet.__langformKurzClosing) return;
    sheet.__langformKurzClosing = true;
    stopObservingProgress(sheet);
    sheet.querySelector(".langform-kurz").style.pointerEvents = "none";
    moveSummarySheet(sheet, false);
  }

  function openSheetMotion(sheet, opener) {
    var fresh = !sheet.__langformKurzOpened;
    if (opener) sheet.__langformKurzOpener = opener;
    if (!fresh && !sheet.__langformKurzClosing) return;
    sheet.__langformKurzOpened = true;
    sheet.__langformKurzClosing = false;
    sheet.querySelector(".langform-kurz").style.pointerEvents = "";
    if (fresh) sheet.querySelector("header button").focus({ preventScroll: true });
    moveSummarySheet(sheet, true);
  }

  function ensureSheet(doc) {
    var sheet = doc.getElementById(PANEL_ID);
    if (sheet) return sheet;
    sheet = doc.createElement("div");
    sheet.id = PANEL_ID;
    sheet.className = "langform-kurz-sheet";
    sheet.setAttribute("lang", "de");
    var backdrop = doc.createElement("div");
    backdrop.className = "langform-kurz-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    sheet.appendChild(backdrop);
    var panel = doc.createElement("section");
    panel.className = "langform-kurz";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    var header = doc.createElement("header");
    var title = doc.createElement("h2");
    title.id = "langform-kurz-title";
    title.textContent = "Das Wichtigste";
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
    body.setAttribute("aria-live", "polite");
    panel.appendChild(header);
    panel.appendChild(body);
    panel.setAttribute("aria-labelledby", title.id);
    sheet.appendChild(panel);
    sheet.addEventListener("click", function (event) {
      if (event.target === sheet || event.target === backdrop) closeSheet(sheet);
    });
    sheet.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); closeSheet(sheet);
      } else if (event.key === "Tab") {
        var buttons = panel.querySelectorAll("button:not([disabled])");
        var first = buttons[0], last = buttons[buttons.length - 1];
        if (first && ((event.shiftKey && doc.activeElement === first) || (!event.shiftKey && doc.activeElement === last))) {
          event.preventDefault(); (event.shiftKey ? last : first).focus({ preventScroll: true });
        }
      }
    });
    var win = doc.defaultView;
    if (win) {
      var preference = win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)");
      sheet.__langformKurzReduced = preference;
      function settle() {
        if (sheet.__langformKurzClosing) finishSheetClose(sheet, true);
        else stopSheetMotion(sheet);
      }
      function reduce() { if (preference.matches) settle(); }
      function leave() { closeSheet(sheet, true); }
      function visibility() { if (win.__langformFeedActive === false) leave(); }
      var lifecycle = ["pagehide", "yt-navigate-start", "state-navigatestart", "popstate"];
      lifecycle.forEach(function (name) { win.addEventListener(name, leave); });
      win.addEventListener("resize", settle);
      win.addEventListener("orientationchange", settle);
      win.addEventListener("langform-feed-visibility", visibility);
      if (win.visualViewport) win.visualViewport.addEventListener("resize", settle);
      if (preference && preference.addEventListener) preference.addEventListener("change", reduce);
      if (win.__langformMotion) win.addEventListener("langform-motion-change", settle);
      sheet.__langformKurzDispose = function () {
        lifecycle.forEach(function (name) { win.removeEventListener(name, leave); });
        win.removeEventListener("resize", settle);
        win.removeEventListener("orientationchange", settle);
        win.removeEventListener("langform-feed-visibility", visibility);
        if (win.visualViewport) win.visualViewport.removeEventListener("resize", settle);
        if (preference && preference.removeEventListener) preference.removeEventListener("change", reduce);
        win.removeEventListener("langform-motion-change", settle);
        sheet.__langformKurzDispose = null;
      };
    }
    return sheet;
  }

  function mountSheet(doc, sheet) {
    var parent = doc.body || doc.documentElement;
    if (!parent || sheet.parentNode === parent) return;
    parent.appendChild(sheet);
  }

  function fetchTextFactory(win) {
    return function (url, init) {
      var fetchImpl = (win && win.fetch) || (ownGlobal() && ownGlobal().fetch);
      var timers = win && typeof win.setTimeout === "function" ? win : ownGlobal();
      var Controller = (win && win.AbortController) || (ownGlobal() && ownGlobal().AbortController);
      var controller = Controller ? new Controller() : null;
      var options = { credentials: "include" };
      if (controller) options.signal = controller.signal;
      if (init && init.method) options.method = init.method;
      if (init && init.body != null) options.body = init.body;
      if (init && init.headers) options.headers = init.headers;
      // Include response-body reading in the deadline: headers alone do not
      // make the captions usable. Ignore late replies and leave retry explicit.
      return new Promise(function (resolve, reject) {
        var settled = false;
        var timer = timers.setTimeout(function () {
          var error = new Error(ERROR_MESSAGES.CAPTIONS_TIMEOUT);
          error.code = "CAPTIONS_TIMEOUT";
          finish(null, error);
          if (controller) controller.abort();
        }, CAPTIONS_TIMEOUT_MS);
        function finish(text, error) {
          if (settled) return;
          settled = true;
          timers.clearTimeout(timer);
          if (error) reject(error);
          else resolve(text);
        }
        Promise.resolve().then(function () { return fetchImpl(url, options); }).then(function (response) {
          if (settled) return null;
          if (!response || !response.ok) throw new Error("Antwort fehlt");
          return response.text();
        }).then(function (text) { finish(text); }, function (error) { finish(null, error); });
      });
    };
  }

  function askPage(win, request, timeoutMs) {
    return new Promise(function (resolve) {
      var id = String(Date.now()) + "-" + Math.random();
      var timer = win.setTimeout(function () {
        win.removeEventListener("message", onMessage);
        resolve(null);
      }, timeoutMs || 1500);
      function onMessage(event) {
        var data = event && event.data;
        if (!data || data.source !== "langform-page-res" || data.id !== id) return;
        win.clearTimeout(timer);
        win.removeEventListener("message", onMessage);
        resolve(data.payload || null);
      }
      win.addEventListener("message", onMessage);
      try {
        win.postMessage(
          {
            source: "langform-page-req",
            id: id,
            op: request.op,
            videoId: request.videoId,
            watch: request.watch,
            url: request.url,
            method: request.method,
            headers: request.headers,
            body: request.body,
          },
          "*"
        );
      } catch (err) {
        win.clearTimeout(timer);
        win.removeEventListener("message", onMessage);
        resolve(null);
      }
    });
  }

  function injectPageHook(win) {
    var doc = win && win.document;
    if (!doc || doc.getElementById("langform-page-captions")) return Promise.resolve();
    var runtime = null;
    try {
      runtime = (win.chrome && win.chrome.runtime) || (win.browser && win.browser.runtime) || null;
    } catch (err) {
      runtime = null;
    }
    if (!runtime || typeof runtime.getURL !== "function") return Promise.resolve();
    return new Promise(function (resolve) {
      var script = doc.createElement("script");
      script.id = "langform-page-captions";
      var nonceNode = doc.querySelector && doc.querySelector("script[nonce]");
      if (nonceNode) {
        try {
          if (nonceNode.nonce) script.nonce = nonceNode.nonce;
        } catch (err2) {
          /* the nonce stays on the page */
        }
      }
      var finished = false;
      function finish() {
        if (finished) return;
        finished = true;
        resolve();
      }
      var timer = win.setTimeout(finish, 400);
      script.onload = script.onerror = function () {
        win.clearTimeout(timer);
        finish();
      };
      try {
        script.src = runtime.getURL("src/page-captions.js");
        (doc.documentElement || doc.head || doc.body).appendChild(script);
      } catch (err3) {
        win.clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
        finish();
      }
    });
  }

  function pageFetch(win) {
    return function (url, init) {
      return askPage(
        win,
        {
          op: "fetch",
          url: String(url),
          method: init && init.method,
          headers: init && init.headers,
          body: init && init.body != null ? String(init.body) : undefined,
        },
        8000
      ).then(function (payload) {
        if (!payload || payload.error) throw new Error("Antwort fehlt");
        return payload.text;
      });
    };
  }

  function waitForLivePlayer(win, videoId) {
    var found = livePlayer(win, videoId);
    if (found) return Promise.resolve(found);
    return new Promise(function (resolve) {
      var tries = 0;
      (function tick() {
        var player = livePlayer(win, videoId);
        if (player || tries++ >= 80) {
          resolve(player);
          return;
        }
        win.setTimeout(tick, 50);
      })();
    });
  }

  function bridgeFor(win, videoId, pageUrl) {
    var watch = isWatchPageUrl(pageUrl, videoId);
    if (!isolatedFromPage(win)) {
      if (!watch) {
        return Promise.resolve({
          player: livePlayer(win, videoId),
          ytcfg: win && win.ytcfg,
          fetchText: fetchTextFactory(win),
          watchPage: false,
        });
      }
      return waitForLivePlayer(win, videoId).then(function (player) {
        return {
          player: player,
          ytcfg: win && win.ytcfg,
          fetchText: fetchTextFactory(win),
          watchPage: true,
        };
      });
    }
    return injectPageHook(win)
      .then(function () {
        return askPage(win, { op: "ping" }, 700);
      })
      .then(function (pong) {
        if (!pong || !pong.ok) return null;
        return askPage(win, { op: "context", videoId: videoId, watch: watch }, watch ? 7000 : 2000);
      })
      .then(function (payload) {
        if (!payload) return null;
        return {
          player: payload.player,
          ytcfg: payload.ytcfg,
          fetchText: pageFetch(win),
          watchPage: watch,
        };
      });
  }

  function cachedSummaries(win) {
    var cache = win.__langformKurzCache;
    if (!cache || cache.version !== CACHE_VERSION || !Array.isArray(cache.entries)) {
      cache = { version: CACHE_VERSION, entries: [] };
      win.__langformKurzCache = cache;
    }
    return cache.entries;
  }

  function cachedSummary(win, videoId) {
    var entries = cachedSummaries(win);
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].videoId !== videoId) continue;
      var entry = entries.splice(i, 1)[0];
      if (!reusableSummaryResult(entry.result)) return null;
      entries.push(entry);
      return entry.result;
    }
    return null;
  }

  function rememberSummary(win, videoId, result) {
    if (!reusableSummaryResult(result)) return;
    var entries = cachedSummaries(win);
    for (var i = entries.length - 1; i >= 0; i--) {
      if (entries[i].videoId === videoId) entries.splice(i, 1);
    }
    entries.push({ videoId: videoId, result: result });
    if (entries.length > CACHE_LIMIT) entries.splice(0, entries.length - CACHE_LIMIT);
  }

  function summaryRequests(win) {
    var requests = win.__langformKurzRequests;
    if (!requests || requests.version !== CACHE_VERSION) {
      requests = { version: CACHE_VERSION, pending: Object.create(null) };
      win.__langformKurzRequests = requests;
    }
    return requests.pending;
  }

  function showSummary(doc, win, videoId, opener) {
    ensureStyle(doc);
    var sheet = ensureSheet(doc);
    mountSheet(doc, sheet);
    sheet.__langformKurzRetry = function () { showSummary(doc, win, videoId); };
    if (sheet.getAttribute("data-video") === videoId && sheet.getAttribute("data-summary-state") === "ready" && reusableSummaryResult(sheet.__langformKurzResult)) {
      openSheetMotion(sheet, opener);
      return;
    }
    stopObservingProgress(sheet);
    sheet.__langformKurzProgressSignature = null;
    sheet.__langformKurzResult = null;
    sheet.setAttribute("data-video", videoId);
    var body = sheet.querySelector(".langform-kurz-body");
    while (body.firstChild) body.removeChild(body.firstChild);
    var ticket = String(Date.now()) + "-" + Math.random();
    sheet.setAttribute("data-ticket", ticket);
    // The window cache skips caption retrieval. Safari's background also keeps
    // successful model results locally by transcript fingerprint across loads.
    var cached = cachedSummary(win, videoId);
    if (cached) {
      fillPanel(sheet, doc, cached);
      openSheetMotion(sheet, opener);
      return;
    }
    var waiting = doc.createElement("p");
    waiting.textContent = "Die Untertitel werden gelesen und verständlich zusammengefasst …";
    body.setAttribute("aria-busy", "true");
    sheet.setAttribute("data-summary-state", "pending");
    body.appendChild(waiting);
    openSheetMotion(sheet, opener);
    var pageUrl = win && win.location ? win.location.href : "https://www.youtube.com/";
    var requests = summaryRequests(win);
    var request = requests[videoId];
    if (!request) {
      request = { progress: null, observers: new Set(), promise: null };
      // Pending work belongs to the window, not the temporary sheet. Closing
      // or switching the sheet keeps both the request and its latest status.
      requests[videoId] = request;
      request.promise = bridgeFor(win, videoId, pageUrl).then(function (bridge) {
        if (!bridge) return { message: FAILED };
        return loadSummary(videoId, {
          player: bridge.player,
          pageUrl: pageUrl,
          ytcfg: bridge.ytcfg,
          host: win,
          fetchText: bridge.fetchText,
          watchPage: bridge.watchPage,
          onProgress: function (progress) {
            if (requests[videoId] !== request) return;
            request.progress = progress;
            request.observers.forEach(function (observer) { observer(progress); });
          },
        });
      }).catch(function () { return { message: FAILED }; }).then(function (result) {
        if (requests[videoId] === request) delete requests[videoId];
        request.progress = null;
        request.observers.clear();
        rememberSummary(win, videoId, result);
        return result;
      });
    }
    function stillVisible() {
      return sheet.isConnected && !sheet.__langformKurzClosing && sheet.getAttribute("data-ticket") === ticket && sheet.getAttribute("data-video") === videoId;
    }
    function observeProgress(progress) {
      if (!stillVisible()) { unsubscribe(); return; }
      fillProgress(sheet, doc, progress);
    }
    function unsubscribe() {
      request.observers.delete(observeProgress);
      if (sheet.__langformKurzStopProgress === unsubscribe) sheet.__langformKurzStopProgress = null;
    }
    sheet.__langformKurzStopProgress = unsubscribe;
    request.observers.add(observeProgress);
    if (request.progress) observeProgress(request.progress);
    request.promise.then(function (result) {
      unsubscribe();
      if (!result) return;
      if (!stillVisible()) return;
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

  function ensureTranscriptStyle(doc) {
    if (doc.getElementById("langform-transcript-style")) return;
    var style = doc.createElement("style");
    style.id = "langform-transcript-style";
    style.textContent = [
      ".langform-watch-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 0 16px; width: fit-content; max-width: 100%; margin: 6px 0 0; }",
      ".langform-watch-actions > .langform-kurz-open, .langform-watch-actions .langform-transcript-actions > button { margin: 0; align-self: center; min-height: 44px; }",
      ".langform-transcript-actions { display: inline-flex; align-items: center; margin: 0; }",
      ".langform-transcript-sheet { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; z-index: 2147483100; font: 15px/1.5 system-ui, sans-serif; }",
      ".langform-transcript-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); }",
      ".langform-transcript-dialog { position: relative; display: flex; flex-direction: column; box-sizing: border-box; width: min(520px,100%); max-height: min(540px,calc(100dvh - 48px)); min-height: 180px; overflow: hidden; border: 1px solid var(--yt-spec-10-percent-layer,#ffffff26); border-radius: 16px; background: var(--yt-spec-menu-background,#202020); color: var(--yt-spec-text-primary,#f1f1f1); box-shadow: 0 16px 60px #0008; }",
      ".langform-transcript-dialog header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px 4px; flex: 0 0 auto; }",
      ".langform-transcript-dialog h2 { margin: 0; color: inherit; font: 600 18px/1.3 system-ui,sans-serif; }",
      ".langform-transcript-dialog button { min-height: 40px; border: 0; border-radius: 20px; padding: 0 16px; font: 600 13px/1.3 system-ui,sans-serif; color: inherit; background: var(--yt-spec-badge-chip-background,#ffffff18); cursor: pointer; }",
      ".langform-transcript-dialog button:hover { background: var(--yt-spec-button-chip-background-hover,#ffffff29); }",
      ".langform-transcript-dialog button:focus-visible, .langform-transcript-body:focus-visible { outline: 2px solid #8ab4f8; outline-offset: -2px; }",
      ".langform-transcript-dialog button:disabled { opacity: .6; cursor: wait; }",
      ".langform-transcript-dialog .langform-transcript-close { width: 40px; flex: 0 0 40px; padding: 0; font-size: 24px; background: transparent; }",
      ".langform-transcript-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px 20px 20px; white-space: pre-wrap; overflow-wrap: anywhere; -webkit-overflow-scrolling: touch; }",
      ".langform-transcript-body p { margin: 0 0 12px; }",
      ".langform-transcript-text { user-select: text; }",
      ".langform-transcript-dialog footer { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 16px; border-top: 1px solid var(--yt-spec-10-percent-layer,#ffffff1a); flex: 0 0 auto; }",
      ".langform-transcript-status { flex: 1; font: 13px/1.4 system-ui,sans-serif; color: inherit; opacity: .85; }",
      "@media (max-width: 600px) { .langform-transcript-sheet { padding: 16px; } .langform-transcript-dialog { max-height: min(540px,calc(100dvh - 32px)); } }",
    ].join("\n");
    (doc.documentElement || doc.head || doc.body).appendChild(style);
  }

  function closeTranscript(doc, restoreFocus) {
    var sheet = doc.getElementById("langform-transcript");
    if (!sheet) return;
    var opener = sheet.__langformTranscriptOpener;
    if (sheet.__langformTranscriptDispose) sheet.__langformTranscriptDispose();
    sheet.remove();
    if (restoreFocus && opener && opener.isConnected) opener.focus({ preventScroll: true });
  }

  function bindTranscriptButton(doc, win, card, videoId, summaryButton) {
    // This UI is installed only in the browser extension's isolated context.
    if (!isolatedFromPage(win) || watchIdOf(win) !== videoId) return;
    ensureTranscriptStyle(doc);
    if (!win.__langformTranscriptLifecycle) {
      win.__langformTranscriptLifecycle = true;
      ["yt-navigate-start", "state-navigatestart", "popstate", "pagehide"].forEach(function (name) {
        win.addEventListener(name, function () {
          win.__langformTranscriptGeneration = (win.__langformTranscriptGeneration || 0) + 1;
          win.__langformKurzWatchButton = null;
          closeTranscript(doc, false);
          doc.querySelectorAll("[" + TRANSCRIPT_ATTR + "]").forEach(function (node) { node.remove(); });
        });
      });
    }
    var generation = win.__langformTranscriptGeneration || 0;
    var existing = card.querySelectorAll("[" + TRANSCRIPT_ATTR + "]");
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].getAttribute(TRANSCRIPT_ATTR) === videoId) return;
      existing[i].remove();
    }
    card.querySelectorAll(".langform-watch-actions:empty").forEach(function (node) { node.remove(); });
    var actions = doc.createElement("span");
    actions.className = "langform-transcript-actions";
    actions.setAttribute(TRANSCRIPT_ATTR, videoId);
    var button = doc.createElement("button");
    button.type = "button";
    button.className = "langform-kurz-open";
    button.textContent = "Transkript";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", "langform-transcript");
    button.setAttribute("aria-expanded", "false");
    actions.appendChild(button);
    var row = summaryButton.parentNode;
    if (!row.classList.contains("langform-watch-actions")) {
      row = doc.createElement("div");
      row.className = "langform-watch-actions";
      summaryButton.parentNode.insertBefore(row, summaryButton);
      row.appendChild(summaryButton);
    }
    row.appendChild(actions);
    var readyText = "", readyOwner = null;
    function owner() {
      var mediaRoot = doc.querySelector("#movie_player, ytd-player, ytm-player");
      var video = mediaRoot && mediaRoot.querySelector("video");
      return { mediaRoot: mediaRoot, video: video, source: video && (video.currentSrc || video.src || "") };
    }
    function sameOwner(first, second) {
      return first && second && first.mediaRoot === second.mediaRoot && first.video === second.video && first.source === second.source;
    }
    function current(media) {
      return actions.isConnected && watchIdOf(win) === videoId &&
        (win.__langformTranscriptGeneration || 0) === generation && (!media || sameOwner(media, owner()));
    }
    ["pointerdown", "mousedown"].forEach(function (type) { button.addEventListener(type, stopClick, true); });
    button.addEventListener("click", function (event) {
      stopClick(event);
      if (!current()) return;
      closeTranscript(doc, false);
      var summarySheet = doc.getElementById(PANEL_ID);
      if (summarySheet) closeSheet(summarySheet, true);
      var media = owner();
      if (!sameOwner(readyOwner, media)) readyText = "";
      var sheet = doc.createElement("div");
      sheet.id = "langform-transcript";
      sheet.className = "langform-transcript-sheet";
      sheet.setAttribute("lang", "de");
      sheet.__langformTranscriptOpener = button;
      var backdrop = doc.createElement("div");
      backdrop.className = "langform-transcript-backdrop";
      backdrop.setAttribute("aria-hidden", "true");
      var panel = doc.createElement("section");
      panel.className = "langform-transcript-dialog";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-labelledby", "langform-transcript-title");
      var header = doc.createElement("header");
      var title = doc.createElement("h2");
      title.id = "langform-transcript-title";
      title.textContent = "Transkript";
      var close = doc.createElement("button");
      close.type = "button";
      close.className = "langform-transcript-close";
      close.setAttribute("aria-label", "Transkript schließen");
      close.textContent = "×";
      header.appendChild(title);
      header.appendChild(close);
      var body = doc.createElement("div");
      body.className = "langform-transcript-body";
      body.tabIndex = 0;
      body.setAttribute("aria-label", "Vollständiges Transkript");
      var footer = doc.createElement("footer");
      var copy = doc.createElement("button");
      copy.type = "button";
      copy.className = "langform-transcript-copy";
      copy.textContent = "Kopieren";
      var status = doc.createElement("span");
      status.className = "langform-transcript-status";
      status.setAttribute("role", "status");
      footer.appendChild(copy);
      footer.appendChild(status);
      panel.appendChild(header);
      panel.appendChild(body);
      panel.appendChild(footer);
      sheet.appendChild(backdrop);
      sheet.appendChild(panel);
      (doc.body || doc.documentElement).appendChild(sheet);
      button.setAttribute("aria-expanded", "true");
      close.focus({ preventScroll: true });
      var textPromise = null, loadTicket = 0;
      function visible() { return sheet.isConnected && current(media); }
      function finishClose(restore) { if (sheet.isConnected) closeTranscript(doc, restore); }
      function expire() {
        if (!visible()) { readyText = ""; readyOwner = null; finishClose(false); }
      }
      function fetchTranscript() {
        var pageUrl = win.location.href;
        return bridgeFor(win, videoId, pageUrl).then(function (bridge) {
          if (!visible()) throw new Error("Videowechsel");
          if (!bridge) return { message: FAILED };
          return loadTranscript(videoId, {
            player: bridge.player, pageUrl: pageUrl, ytcfg: bridge.ytcfg,
            fetchText: bridge.fetchText, watchPage: bridge.watchPage, originalLanguage: true,
          });
        }).then(function (result) {
          if (!visible()) throw new Error("Videowechsel");
          if (!result || !result.text) throw new Error((result && result.message) || FAILED);
          readyText = result.text;
          readyOwner = media;
          return result.text;
        });
      }
      function load() {
        var ticket = ++loadTicket;
        body.textContent = "Untertitel werden geladen …";
        body.setAttribute("aria-busy", "true");
        panel.setAttribute("data-transcript-state", "loading");
        status.textContent = "";
        copy.disabled = false;
        textPromise = readyText ? Promise.resolve(readyText) : fetchTranscript();
        textPromise.then(function (value) {
          if (!visible() || ticket !== loadTicket) return;
          body.textContent = "";
          var content = doc.createElement("p");
          content.className = "langform-transcript-text";
          content.textContent = value;
          body.appendChild(content);
          body.setAttribute("aria-busy", "false");
          panel.setAttribute("data-transcript-state", "ready");
        }, function (error) {
          if (!visible() || ticket !== loadTicket) return;
          body.textContent = "";
          var note = doc.createElement("p");
          note.textContent = error.message;
          var retry = doc.createElement("button");
          retry.type = "button";
          retry.className = "langform-transcript-retry";
          retry.textContent = "Erneut versuchen";
          retry.addEventListener("click", function (event) { stopClick(event); if (visible()) load(); });
          body.appendChild(note);
          body.appendChild(retry);
          body.setAttribute("aria-busy", "false");
          panel.setAttribute("data-transcript-state", "error");
          copy.disabled = true;
        });
      }
      copy.addEventListener("click", function (event) {
        stopClick(event);
        if (copy.disabled || !visible()) return;
        copy.disabled = true;
        copy.setAttribute("aria-busy", "true");
        status.textContent = "Wird kopiert …";
        var text = textPromise.then(function (value) {
          if (!visible()) throw new Error("Videowechsel");
          return value;
        });
        var written;
        try {
          var clipboard = win.navigator && win.navigator.clipboard;
          if (clipboard && clipboard.write && win.ClipboardItem && win.Blob) {
            // Safari needs write() synchronously inside this explicit Copy click.
            var blob = text.then(function (value) { return new win.Blob([value], { type: "text/plain" }); });
            blob.catch(function () {});
            written = clipboard.write([new win.ClipboardItem({ "text/plain": blob })]);
          } else if (clipboard && clipboard.writeText) {
            written = readyText ? clipboard.writeText(readyText) : text.then(function (value) {
              if (!visible()) throw new Error("Videowechsel");
              return clipboard.writeText(value);
            });
          } else written = Promise.reject(new Error("Clipboard unavailable"));
        } catch (error) { written = Promise.reject(error); }
        Promise.all([
          text.then(function () { return null; }, function (error) { return error; }),
          Promise.resolve(written).then(function () { return null; }, function (error) { return error; }),
        ]).then(function (errors) {
          if (!visible()) return;
          copy.disabled = panel.getAttribute("data-transcript-state") === "error";
          copy.setAttribute("aria-busy", "false");
          status.textContent = errors[0] ? errors[0].message : errors[1]
            ? "Kopieren nicht möglich. Bitte erneut versuchen." : "Transkript kopiert.";
        });
      }, true);
      close.addEventListener("click", function (event) { stopClick(event); finishClose(true); });
      sheet.addEventListener("click", function (event) {
        event.stopPropagation();
        if (event.target === backdrop || event.target === sheet) finishClose(true);
      });
      sheet.addEventListener("keydown", function (event) {
        if (event.key === "Escape") { stopClick(event); finishClose(true); return; }
        // Playback shortcuts belong to the page; an open dialog owns its keys.
        event.stopPropagation();
        if (event.key !== "Tab") return;
        var focusable = panel.querySelectorAll("button:not([disabled]), [tabindex='0']");
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (first && ((event.shiftKey && doc.activeElement === first) || (!event.shiftKey && doc.activeElement === last))) {
          event.preventDefault(); (event.shiftKey ? last : first).focus({ preventScroll: true });
        }
      });
      function keepFocus(event) { if (visible() && !sheet.contains(event.target)) close.focus({ preventScroll: true }); }
      doc.addEventListener("focusin", keepFocus);
      doc.addEventListener("loadstart", expire, true);
      doc.addEventListener("emptied", expire, true);
      var observer = typeof win.MutationObserver === "function" ? new win.MutationObserver(expire) : null;
      if (observer) observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
      sheet.__langformTranscriptDispose = function () {
        button.setAttribute("aria-expanded", "false");
        doc.removeEventListener("focusin", keepFocus);
        doc.removeEventListener("loadstart", expire, true);
        doc.removeEventListener("emptied", expire, true);
        if (observer) observer.disconnect();
      };
      load();
    }, true);
  }

  function bindButton(doc, win, card, videoId) {
    if (!card) return null;
    var existing = null;
    var buttons = card.querySelectorAll("[" + BUTTON_ATTR + "]");
    for (var i = 0; i < buttons.length; i++) {
      if (!existing && buttons[i].getAttribute(BUTTON_ATTR) === videoId) existing = buttons[i];
      else buttons[i].remove();
    }
    if (existing) {
      bindTranscriptButton(doc, win, card, videoId, existing);
      return existing;
    }
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
        showSummary(doc, win, videoId, button);
      },
      true
    );
    placeInColumn(card, button);
    bindTranscriptButton(doc, win, card, videoId, button);
    return button;
  }

  function forEachElement(rootNode, visit) {
    var stack = [rootNode];
    var seen = new Set();
    while (stack.length) {
      var node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      if (node.nodeType === 1 && skipDecorationBranch(node)) continue;
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

  function decorate(doc, pageUrl, win, roots) {
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
      if (meta) bindButton(doc, win || ownGlobal(), meta, watchId);
    }
    var seenCards = new Set();
    function decorateLink(el) {
      if (el.tagName !== "A" || !el.getAttribute("href")) return;
      var card = videoRowOf(el);
      if (!card || seenCards.has(card)) return;
      seenCards.add(card);
      var rowId = videoIdFromHref(rowWatchHref(card, base), base);
      if (!rowId || rowId === watchId) return;
      var seconds = durationSecondsFromCard(card);
      if (seconds != null && seconds < 60) return;
      bindButton(doc, win || ownGlobal(), card, rowId);
    }
    (roots || [doc]).forEach(function (rootNode) {
      if (rootNode && rootNode.isConnected) forEachElement(rootNode, decorateLink);
    });
  }

  // Coalesce changed cards while the feed streams in. Only startup and
  // navigation need to revisit the links that were already decorated.
  var DECORATE_GAP = 300;

  function watchIdOf(win) {
    try {
      var page = new URL(win.location.href);
      if (!hosts[page.hostname] || (page.pathname !== "/watch" && page.pathname !== "/watch/")) return "";
      var id = page.searchParams.get("v") || "";
      return VIDEO_ID.test(id) ? id : "";
    } catch (err) {
      return "";
    }
  }

  function watchPlaying(win) {
    if (!watchIdOf(win)) return false;
    var videos = win.document.getElementsByTagName("video");
    for (var i = 0; i < videos.length; i++) {
      if (!videos[i].paused && !videos[i].ended) return true;
    }
    return false;
  }

  // While the video plays only the button under it is placed, once per video.
  // The walk over every link waits until playback pauses or ends.
  function holdForPlayback(win) {
    if (!watchPlaying(win)) return false;
    win.__langformKurzDeferred = true;
    var id = watchIdOf(win);
    var bound = win.__langformKurzWatchButton;
    if (!bound || !bound.isConnected || bound.getAttribute(BUTTON_ATTR) !== id) {
      var meta = watchAnchor(win.document);
      if (meta) {
        win.__langformKurzWatchButton = bindButton(win.document, win, meta, id);
      }
    }
    return true;
  }

  function schedule(win, incremental) {
    if (!win) return;
    if (!incremental) {
      win.__langformKurzFull = true;
      win.__langformKurzRoots = [];
    }
    if (win.__langformFeedActive === false) {
      suspendFeed(win, true);
      return;
    }
    if (win.__langformKurzTimer) return;
    if (win.__langformKurzScrolling) {
      win.__langformKurzPending = true;
      return;
    }
    win.__langformKurzPending = false;
    if (holdForPlayback(win)) return;
    var last = win.__langformKurzLast || 0;
    var wait = Math.max(0, last + DECORATE_GAP - Date.now());
    win.__langformKurzTimer = setTimeout(function () {
      win.__langformKurzTimer = 0;
      if (!win.document) return;
      if (win.__langformFeedActive === false) {
        suspendFeed(win, true);
        return;
      }
      if (win.__langformKurzScrolling) {
        win.__langformKurzPending = true;
        return;
      }
      if (holdForPlayback(win)) return;
      win.__langformKurzLast = Date.now();
      var roots = win.__langformKurzFull ? null : win.__langformKurzRoots || [];
      win.__langformKurzFull = false;
      win.__langformKurzRoots = [];
      try {
        decorate(win.document, win.location.href, win, roots);
      } catch (err) {
        /* the page can tear the DOM down mid-walk */
      }
    }, wait);
  }

  function skipDecorationBranch(node) {
    var tag = node.tagName;
    return tag === "VIDEO" || tag === "YTD-PLAYER" || tag === "YTM-PLAYER" || node.id === "movie_player" ||
      /^YT[DM]-COMMENTS?(?:-|$)/.test(tag) || tag === "YT-COMMENT-THREAD-VIEW-MODEL" ||
      tag === "YT-COMMENT-VIEW-MODEL" ||
      node.id === PANEL_ID || node.id === "langform-chapter-chip" || node.id === "langform-chapter-sheet" ||
      node.id === "langform-transcript" || node.id === "langform-transcript-style" ||
      node.classList.contains("langform-watch-actions") || node.classList.contains("langform-transcript-actions") ||
      node.hasAttribute(BUTTON_ATTR) || node.id === STYLE_ID;
  }

  function insidePlayerOrOurs(node) {
    var guard = 0;
    while (node && guard++ < 25) {
      if (node.nodeType === 1 && skipDecorationBranch(node)) return true;
      var rootNode = node.getRootNode && node.getRootNode();
      node = node.parentElement || (rootNode && rootNode.host) || null;
    }
    return false;
  }

  function queueDecoration(win, node) {
    if (!node || node.nodeType !== 1 || insidePlayerOrOurs(node)) return false;
    if (win.__langformKurzFull) return true;
    // A changed title or thumbnail may have lost its button, while a changed
    // href may now represent a different video. Refresh its complete card.
    node = videoRowOf(node) || node;
    var roots = win.__langformKurzRoots || (win.__langformKurzRoots = []);
    for (var i = roots.length - 1; i >= 0; i--) {
      if (roots[i] === node || roots[i].contains(node)) return true;
      if (node.contains(roots[i])) roots.splice(i, 1);
    }
    roots.push(node);
    if (roots.length > 40) {
      win.__langformKurzFull = true;
      win.__langformKurzRoots = [];
    }
    return true;
  }

  function queueMutations(win, records) {
    var relevant = false;
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (insidePlayerOrOurs(record.target)) continue;
      if (record.type === "attributes") {
        if (queueDecoration(win, record.target)) relevant = true;
        continue;
      }
      var added = record.addedNodes || [];
      for (var j = 0; j < added.length; j++) {
        if (queueDecoration(win, added[j])) relevant = true;
      }
    }
    return relevant;
  }

  function noteScroll(win) {
    if (win.__langformFeedActive === false) return;
    win.__langformKurzScrolling = true;
    if (win.__langformKurzScrollTimer) clearTimeout(win.__langformKurzScrollTimer);
    win.__langformKurzScrollTimer = setTimeout(function () {
      win.__langformKurzScrolling = false;
      win.__langformKurzScrollTimer = 0;
      if (win.__langformKurzPending) schedule(win, true);
    }, 140);
  }

  function suspendFeed(win, dirty) {
    if (dirty) {
      win.__langformKurzFeedDeferred = true;
      win.__langformKurzFull = true;
    }
    if (win.__langformKurzTimer) clearTimeout(win.__langformKurzTimer);
    if (win.__langformKurzScrollTimer) clearTimeout(win.__langformKurzScrollTimer);
    win.__langformKurzTimer = win.__langformKurzScrollTimer = 0;
    win.__langformKurzScrolling = win.__langformKurzPending = false;
    // Retained inactive tabs need one dirty bit, not references to every
    // changing card. Their existing DOM, buttons and scroll position stay.
    win.__langformKurzRoots = [];
  }

  function feedVisibilityChanged(win) {
    if (win.__langformFeedActive === false) {
      suspendFeed(win, !!(win.__langformKurzTimer || win.__langformKurzPending ||
        win.__langformKurzFull || win.__langformKurzDeferred ||
        (win.__langformKurzRoots && win.__langformKurzRoots.length)));
    } else if (win.__langformKurzFeedDeferred) {
      win.__langformKurzFeedDeferred = false;
      schedule(win);
    }
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
    win.addEventListener("langform-feed-visibility", function () {
      feedVisibilityChanged(win);
    });
    if (isolatedFromPage(win)) injectPageHook(win);
    win.addEventListener("yt-navigate-finish", function () {
      schedule(win);
    });
    win.addEventListener("popstate", function () {
      schedule(win);
    });
    function afterPlayback() {
      if (!win.__langformKurzDeferred) return;
      win.__langformKurzDeferred = false;
      schedule(win, true);
    }
    win.document.addEventListener("pause", afterPlayback, true);
    win.document.addEventListener("ended", afterPlayback, true);
    win.document.addEventListener(
      "scroll",
      function (event) {
        // A comment list or our own sheet scrolls independently of the feed.
        // Its links are text content, not video cards awaiting decoration.
        if (event.target && insidePlayerOrOurs(event.target)) return;
        noteScroll(win);
      },
      { passive: true, capture: true }
    );
    if (win.MutationObserver && win.document.documentElement) {
      var observer = new win.MutationObserver(function (records) {
        if (win.__langformFeedActive === false) {
          if (records.length) suspendFeed(win, true);
          return;
        }
        if (queueMutations(win, records)) schedule(win, true);
      });
      observer.observe(win.document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
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
    loadTranscript: loadTranscript,
    videoIdFromHref: videoIdFromHref,
    decorate: decorate,
    start: start,
    poke: schedule,
  };
});
