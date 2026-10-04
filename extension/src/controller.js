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
    var removedInSession = 0;
    var observer = null;
    var queued = [];
    var flushScheduled = false;
    var scrolling = false;
    var scrollTimer = 0;
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
      remember(hide.scan(doc, pageBase(), { remove: confirmed }));
    }

    function remember(count) {
      if (typeof count === "number" && count > 0) removedInSession += count;
    }

    function pokeSummary() {
      var summary = win.ShortsAusblenden && win.ShortsAusblenden.summary;
      if (summary && summary.poke) summary.poke(win);
    }

    function flushQueue() {
      flushScheduled = false;
      if (scrolling) return;
      if (!enabled) {
        queued = [];
        return;
      }
      // SPA navigations mutate the DOM even when pushState stays in the page world.
      if (logic.isShortsPath(win.location.pathname)) {
        queued = [];
        if (confirmed) goHome(win.location.pathname);
        else hide.setVeil(doc, true);
        pokeSummary();
        return;
      }
      var start = Date.now();
      while (queued.length && Date.now() - start < 8) {
        var node = queued.shift();
        if (!node || node.nodeType !== 1 || !node.isConnected) continue;
        if (node.tagName === "VIDEO" || node.tagName === "YTD-PLAYER" || node.tagName === "YTM-PLAYER") continue;
        if (node.id === "movie_player") continue;
        remember(hide.scan(node, pageBase(), { remove: confirmed }));
      }
      if (queued.length) scheduleFlush();
      else pokeSummary();
    }

    function scheduleFlush() {
      if (flushScheduled || scrolling) return;
      flushScheduled = true;
      setTimeout(flushQueue, 0);
    }

    function noteScroll() {
      scrolling = true;
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function () {
        scrolling = false;
        scrollTimer = 0;
        scheduleFlush();
      }, 140);
    }

    function queue(node) {
      if (!node || node.nodeType !== 1) return;
      if (node.tagName === "VIDEO" || node.id === "movie_player") return;
      queued.push(node);
      if (queued.length > 40) queued = [doc.documentElement];
      scheduleFlush();
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
      doc.addEventListener("scroll", noteScroll, { passive: true, capture: true });
    }

    function stopObserver() {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = 0;
      scrolling = false;
      doc.removeEventListener("scroll", noteScroll, true);
      if (!observer) return;
      observer.disconnect();
      observer = null;
      queued = [];
    }

    function onWatchPage() {
      return logic.normalizePath(win.location.pathname) === "/watch";
    }

    function isWatchUrl(url) {
      return logic.classifyHref(url, win.location.href) === "watch";
    }

    // Shorts handling waits until the history call has returned. Doing it
    // inside pushState/replaceState makes WebKit drop the new entry, so
    // canGoBack stays false and the feed position is gone.
    function scheduleNavigate() {
      setTimeout(function () {
        onNavigate(null);
      }, 0);
    }

    var historyHooked = false;
    function ensureHistory() {
      if (historyHooked || !win.history) return;
      historyHooked = true;
      var nativePush = win.history.pushState;
      var nativeReplace = win.history.replaceState;

      if (typeof nativePush === "function") {
        win.history.pushState = function () {
          var result = nativePush.apply(win.history, arguments);
          scheduleNavigate();
          return result;
        };
      }
      if (typeof nativeReplace === "function") {
        win.history.replaceState = function (state, title, url) {
          // Opening a watch page must be its own entry. YouTube often
          // replaceState's that URL over the feed, which leaves canGoBack false.
          var openingWatch =
            arguments.length >= 3 &&
            url != null &&
            url !== "" &&
            !onWatchPage() &&
            isWatchUrl(url) &&
            typeof nativePush === "function";
          var write = openingWatch ? nativePush : nativeReplace;
          var result = write.apply(win.history, arguments);
          scheduleNavigate();
          return result;
        };
      }
      win.addEventListener("popstate", function () {
        scheduleNavigate();
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
      remember(hide.applyEnabled(doc, true, pageBase(), confirmed));
      pokeSummary();
    }

    function disarm() {
      var removed = removedInSession;
      removedInSession = 0;
      enabled = false;
      confirmed = false;
      lastRedirectKey = "";
      stopObserver();
      hide.applyEnabled(doc, false, pageBase());
      if (removed > 0) {
        try {
          if (deps && deps.reload) deps.reload();
          else win.location.reload();
        } catch (err) {
          /* reload is optional in tests */
        }
      }
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

    var summary = win.ShortsAusblenden && win.ShortsAusblenden.summary;
    if (summary && summary.start) summary.start(win);
  }

  return { start: start };
});
