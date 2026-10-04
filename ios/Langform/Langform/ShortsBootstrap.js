(function () {
  var host = location.hostname;
  if (host !== "www.youtube.com" && host !== "m.youtube.com" && host !== "youtube.com") return;
  var ns = globalThis.ShortsAusblenden;
  if (!ns || !ns.controller || !ns.logic || !ns.hide) return;
  // The extension reads chrome.storage and defaults to on. This app has no
  // popup switch, so the same controller always gets enabled: true.
  var storage = {
    local: {
      get: function (_keys, callback) {
        if (typeof callback === "function") callback({ enabled: true });
      },
    },
  };
  ns.controller.start(globalThis, storage);
})();
