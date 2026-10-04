(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (!root.ShortsAusblenden) root.ShortsAusblenden = {};
  root.ShortsAusblenden.controller = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var START_FLAG = "__shortsAusblendenStarted";

  function start(win, storage, deps) {
    if (!win || win[START_FLAG]) return;
    win[START_FLAG] = true;

    var ns = win.ShortsAusblenden;
    if (!ns || !ns.logic || !ns.hide) return;
    var logic = ns.logic;
    var hide = ns.hide;
    var doc = win.document;
    var redirect = deps && deps.redirect ? deps.redirect : function (url) {
      win.location.replace(url);
    };

    var enabled = false;
    // Redirect only after extension storage answers. A stale on-flag in
    // page storage must not send someone away after the switch is off.
    var confirmed = false;
    var observer = null;
    var queued = [];
    var flushScheduled = false;
    var lastRedirectKey = "";

    function pageBase() {
      return win.location.href;
    }

    function goHome(key) {
      if (!confirmed) return;
      var token = key || win.location.pathname || "";
      if (lastRedirectKey === token) return;
      lastRedirectKey = token;
      hide.setVeil(doc, true);
      try {
        if (typeof win.stop === "function") win.stop();
      } catch (err) {
        /* optional */
      }
      try {
        redirect(logic.homeUrl(win.location.hostname));
      } catch (err2) {
        lastRedirectKey = "";
      }
    }

    function destinationKey(detail) {
      var url = logic.extractNavUrl(detail);
      if (url && logic.isShortsHref(url, pageBase())) return url;
      if (logic.isShortsPath(win.location.pathname)) return win.location.pathname;
      return "";
    }

    function onNavigate(detail) {
      if (!enabled) return;
      var key = destinationKey(detail);
      if (key) {
        if (confirmed) goHome(key);
        else hide.setVeil(doc, true);
        return;
      }
      hide.scan(doc, pageBase());
    }

    function flushQueue() {
      flushScheduled = false;
      if (!enabled) {
        queued = [];
        return;
      }
      // SPA navigations mutate the DOM even when pushState stays in the page world.
      if (logic.isShortsPath(win.location.pathname)) {
        queued = [];
        if (confirmed) goHome(win.location.pathname);
        else hide.setVeil(doc, true);
        return;
      }
      var batch = queued;
      queued = [];
      for (var i = 0; i < batch.length; i++) hide.scan(batch[i], pageBase());
    }

    function queue(node) {
      if (!node || node.nodeType !== 1) return;
      queued.push(node);
      if (flushScheduled) return;
      flushScheduled = true;
      Promise.resolve().then(flushQueue);
    }

    function ensureObserver() {
      if (observer || !win.MutationObserver || !doc.documentElement) return;
      observer = new win.MutationObserver(function (records) {
        if (!enabled) return;
        for (var i = 0; i < records.length; i++) {
          var record = records[i];
          if (record.type === "childList") {
            var added = record.addedNodes;
            for (var j = 0; j < added.length; j++) queue(added[j]);
          } else if (record.target) {
            queue(record.target);
          }
        }
      });
      observer.observe(doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["href", "is-shorts", "overlay-style"],
      });
    }

    function stopObserver() {
      if (!observer) return;
      observer.disconnect();
      observer = null;
      queued = [];
    }

    var historyHooked = false;
    function ensureHistory() {
      if (historyHooked || !win.history) return;
      historyHooked = true;
      ["pushState", "replaceState"].forEach(function (name) {
        var original = win.history[name];
        if (typeof original !== "function") return;
        win.history[name] = function () {
          var result = original.apply(this, arguments);
          onNavigate(null);
          return result;
        };
      });
      win.addEventListener("popstate", function () {
        onNavigate(null);
      });
      win.addEventListener("yt-navigate-start", function (event) {
        onNavigate(event && event.detail);
      });
      win.addEventListener("yt-navigate-finish", function () {
        onNavigate(null);
      });
    }

    function arm(allowRedirect) {
      enabled = true;
      if (allowRedirect) confirmed = true;
      ensureHistory();
      ensureObserver();
      hide.applyEnabled(doc, true, pageBase());
    }

    function disarm() {
      enabled = false;
      confirmed = false;
      lastRedirectKey = "";
      stopObserver();
      hide.applyEnabled(doc, false, pageBase());
    }

    function applyStored(isOn) {
      logic.writeFastFlag(win.localStorage, isOn);
      if (isOn) {
        arm(true);
        if (logic.isShortsPath(win.location.pathname)) goHome(win.location.pathname);
        else hide.setVeil(doc, false);
        return;
      }
      disarm();
    }

    ensureHistory();
    var flag = logic.readFastFlag(win.localStorage);
    var plan = logic.initialPlan(flag, win.location.pathname);
    if (plan.veil) hide.setVeil(doc, true);
    if (plan.arm) arm(false);

    if (storage && storage.onChanged && storage.onChanged.addListener) {
      storage.onChanged.addListener(function (changes, area) {
        if (area !== "local" || !changes || !changes.enabled) return;
        applyStored(changes.enabled.newValue !== false);
      });
    }

    if (storage && storage.local && storage.local.get) {
      try {
        storage.local.get("enabled", function (result) {
          var runtime = win.chrome && win.chrome.runtime;
          if (runtime && runtime.lastError) {
            applyStored(flag !== "0");
            return;
          }
          applyStored(logic.enabledFromStorage(result));
        });
      } catch (err) {
        applyStored(flag !== "0");
      }
    }
  }

  return { start: start };
});
