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
  }

  return { install: install };
});
