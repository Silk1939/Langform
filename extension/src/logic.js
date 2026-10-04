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
    readFastFlag: readFastFlag,
    writeFastFlag: writeFastFlag,
    initialPlan: initialPlan,
    enabledFromStorage: enabledFromStorage,
    extractNavUrl: extractNavUrl,
  };
});
