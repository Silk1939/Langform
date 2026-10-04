(function () {
  var ns = globalThis.ShortsAusblenden;
  if (!ns || !ns.controller) return;
  var api = typeof chrome !== "undefined" && chrome.storage ? chrome : null;
  if (!api) return;
  ns.controller.start(globalThis, api.storage);
})();
