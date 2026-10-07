(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (!root.ShortsAusblenden) root.ShortsAusblenden = {};
  root.ShortsAusblenden.logic = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var STORAGE_FLAG = "shorts-ausblenden-enabled";

  var YOUTUBE_HOSTS = {
    "www.youtube.com": 1,
    "m.youtube.com": 1,
    "youtube.com": 1,
  };

  function isYoutubeHost(hostname) {
    return !!YOUTUBE_HOSTS[hostname];
  }

  function homeUrl(hostname) {
    if (hostname === "m.youtube.com") return "https://m.youtube.com/";
    return "https://www.youtube.com/";
  }

  function normalizePath(pathname) {
    if (!pathname) return "/";
    var path = String(pathname);
    if (path.length > 1 && path.charAt(path.length - 1) === "/") path = path.slice(0, -1);
    return path;
  }

  function parseUrl(href, base) {
    try {
      return new URL(String(href), base || "https://www.youtube.com/");
    } catch (err) {
      return null;
    }
  }

  function isShortsPath(pathname) {
    var path = normalizePath(pathname);
    return path === "/shorts" || path.indexOf("/shorts/") === 0 || path === "/feed/shorts";
  }

  function classifyHref(href, base) {
    if (href == null) return "other";
    var raw = String(href).trim();
    if (!raw || raw.charAt(0) === "#" || raw.indexOf("javascript:") === 0) return "other";
    var url = parseUrl(raw, base);
    if (!url || !isYoutubeHost(url.hostname)) return "other";
    var path = normalizePath(url.pathname);
    if (path === "/shorts" || path.indexOf("/shorts/") === 0 || path === "/feed/shorts") return "shorts";
    if (path === "/watch") return "watch";
    return "other";
  }

  function isShortsHref(href, base) {
    return classifyHref(href, base) === "shorts";
  }

  function isHomeHref(href, base) {
    if (href == null || href === "") return false;
    var url = parseUrl(href, base);
    if (!url || !isYoutubeHost(url.hostname)) return false;
    return normalizePath(url.pathname) === "/";
  }

  function watchVideoId(href, base) {
    var url = parseUrl(href, base);
    if (!url || !isYoutubeHost(url.hostname)) return "";
    if (normalizePath(url.pathname) !== "/watch") return "";
    return url.searchParams.get("v") || "";
  }

  // 83, 83s, 1m23s, 1h2m3s, 1:23, 12:04, 1:02:03.
  function parseTimeToken(raw) {
    var text = String(raw == null ? "" : raw).trim().toLowerCase();
    if (!text) return null;
    var clock = text.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
    if (clock) {
      var hours = clock[1] ? Number(clock[1]) : 0;
      var mins = Number(clock[2]);
      var secs = Number(clock[3]);
      if (secs > 59 || (clock[1] && mins > 59)) return null;
      return hours * 3600 + mins * 60 + secs;
    }
    if (!/^\d/.test(text)) return null;
    if (/[hms]$/.test(text)) {
      var named = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
      if (named && (named[1] != null || named[2] != null || named[3] != null)) {
        return Number(named[1] || 0) * 3600 + Number(named[2] || 0) * 60 + Number(named[3] || 0);
      }
      return null;
    }
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      var plain = Number(text);
      return isFinite(plain) ? plain : null;
    }
    return null;
  }

  function timestampSeconds(href, base) {
    var url = parseUrl(href, base);
    if (!url || !isYoutubeHost(url.hostname)) return null;
    if (normalizePath(url.pathname) !== "/watch") return null;
    var token = url.searchParams.get("t");
    if (token == null || token === "") token = url.searchParams.get("start");
    if (token == null || token === "") {
      var hash = url.hash ? url.hash.replace(/^#/, "") : "";
      if (hash.indexOf("t=") === 0) token = decodeURIComponent(hash.slice(2));
      else if (hash.indexOf("start=") === 0) token = decodeURIComponent(hash.slice(6));
    }
    if (token == null || token === "") return null;
    return parseTimeToken(token);
  }

  function readFastFlag(storage) {
    try {
      var value = storage.getItem(STORAGE_FLAG);
      if (value === "0" || value === "1") return value;
    } catch (err) {
      /* private mode or denied storage */
    }
    return null;
  }

  function writeFastFlag(storage, enabled) {
    try {
      storage.setItem(STORAGE_FLAG, enabled ? "1" : "0");
    } catch (err) {
      /* ignore */
    }
  }

  // flag is the synchronous per-origin cache: "1", "0", or null.
  // Redirect waits for extension storage so a stale cache cannot send
  // someone away after they turned the blocker off.
  function initialPlan(flag, pathname) {
    var onShorts = isShortsPath(pathname);
    if (flag === "0") return { arm: false, veil: false };
    if (flag === "1") return { arm: true, veil: onShorts };
    return { arm: false, veil: onShorts };
  }

  function enabledFromStorage(result) {
    if (!result || !Object.prototype.hasOwnProperty.call(result, "enabled")) return true;
    return result.enabled !== false;
  }

  function extractNavUrl(detail) {
    if (!detail || typeof detail !== "object") return null;
    if (typeof detail.url === "string") return detail.url;
    if (typeof detail.href === "string") return detail.href;
    var endpoint = detail.endpoint || detail.navigationEndpoint;
    if (typeof endpoint === "string") return endpoint;
    if (!endpoint || typeof endpoint !== "object") return null;
    if (typeof endpoint.url === "string") return endpoint.url;
    var command = endpoint.commandMetadata;
    var web = command && command.webCommandMetadata;
    if (web && typeof web.url === "string") return web.url;
    return null;
  }

  return {
    STORAGE_FLAG: STORAGE_FLAG,
    isYoutubeHost: isYoutubeHost,
    homeUrl: homeUrl,
    normalizePath: normalizePath,
    isShortsPath: isShortsPath,
    classifyHref: classifyHref,
    isShortsHref: isShortsHref,
    isHomeHref: isHomeHref,
    watchVideoId: watchVideoId,
    parseTimeToken: parseTimeToken,
    timestampSeconds: timestampSeconds,
    readFastFlag: readFastFlag,
    writeFastFlag: writeFastFlag,
    initialPlan: initialPlan,
    enabledFromStorage: enabledFromStorage,
    extractNavUrl: extractNavUrl,
  };
});
