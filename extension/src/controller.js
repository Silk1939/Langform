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
    var scanning = false;
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
      if (scrolling || scanning) return;
      if (!enabled) {
        queued = [];
        return;
      }
      scanning = true;
      try {
        // SPA navigations mutate the DOM even when pushState stays in the page world.
        if (logic.isShortsPath(win.location.pathname)) {
          queued = [];
          if (confirmed) goHome(win.location.pathname);
          else hide.setVeil(doc, true);
          return;
        }
        var start = Date.now();
        while (queued.length && Date.now() - start < 8) {
          var node = queued.shift();
          if (!node || node.nodeType !== 1 || !node.isConnected) continue;
          if (node.tagName === "VIDEO" || node.tagName === "YTD-PLAYER" || node.tagName === "YTM-PLAYER") continue;
          if (node.id === "movie_player") continue;
          if (hide.isSearchControl && hide.isSearchControl(node)) continue;
          remember(hide.scan(node, pageBase(), { remove: confirmed }));
        }
      } finally {
        scanning = false;
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

    function insidePlayer(node) {
      var guard = 0;
      while (node && guard++ < 25) {
        if (node.nodeType === 1) {
          var tag = node.tagName;
          if (tag === "VIDEO" || tag === "YTD-PLAYER" || tag === "YTM-PLAYER" || node.id === "movie_player") return true;
        }
        var rootNode = node.getRootNode && node.getRootNode();
        node = node.parentElement || (rootNode && rootNode.host) || null;
      }
      return false;
    }

    function queue(node) {
      if (!node || node.nodeType !== 1) return;
      if (insidePlayer(node)) return;
      if (node.tagName === "INPUT" || node.tagName === "TEXTAREA") return;
      if (hide.isSearchControl && hide.isSearchControl(node)) return;
      queued.push(node);
      if (queued.length > 40) queued = [doc.documentElement];
      scheduleFlush();
    }

    function ensureObserver() {
      if (observer || !win.MutationObserver || !doc.documentElement) return;
      observer = new win.MutationObserver(function (records) {
        if (!enabled || scanning) return;
        for (var i = 0; i < records.length; i++) {
          var record = records[i];
          if (record.target && insidePlayer(record.target)) continue;
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

    function currentVideoId() {
      return logic.watchVideoId(win.location.href, win.location.href);
    }

    function sameVideoTimestamp(url) {
      if (!onWatchPage() || url == null || url === "") return null;
      var seconds = logic.timestampSeconds(url, win.location.href);
      if (seconds == null) return null;
      var nextId = logic.watchVideoId(url, win.location.href);
      var currentId = currentVideoId();
      if (!nextId || nextId !== currentId) return null;
      return seconds;
    }

    function playbackJustOpened() {
      var videos = doc.getElementsByTagName("video");
      if (!videos.length) return true;
      for (var i = 0; i < videos.length; i++) {
        var time = Number(videos[i].currentTime);
        if (isFinite(time) && time >= 1) return false;
      }
      return true;
    }

    function seekPlayer(seconds) {
      if (seconds == null || !isFinite(seconds) || seconds <= 0) return false;
      // A t=0 or t=1 written as playback starts is not a chapter the user chose.
      if (seconds <= 1 && playbackJustOpened()) return false;
      var movie = doc.getElementById("movie_player");
      var players = [];
      if (movie) players.push(movie);
      var nodes = doc.querySelectorAll("ytd-player, ytm-player, .html5-video-player");
      for (var i = 0; i < nodes.length; i++) players.push(nodes[i]);
      for (var p = 0; p < players.length; p++) {
        if (typeof players[p].seekTo !== "function") continue;
        try {
          players[p].seekTo(seconds, true);
          return true;
        } catch (err) {
          /* the player can reject a seek while it is detaching */
        }
      }
      var videos = doc.getElementsByTagName("video");
      for (var v = 0; v < videos.length; v++) {
        try {
          videos[v].currentTime = seconds;
          return true;
        } catch (err2) {
          /* jsdom and a detached element throw */
        }
      }
      return false;
    }

    function anchorFromEvent(event) {
      var path = event.composedPath ? event.composedPath() : null;
      if (path) {
        for (var i = 0; i < path.length; i++) {
          var node = path[i];
          if (node && node.tagName === "A" && node.hasAttribute && node.hasAttribute("href")) return node;
        }
      }
      var target = event.target;
      if (target && target.nodeType !== 1) target = target.parentElement;
      if (target && target.closest) return target.closest("a[href]");
      return null;
    }

    function onTimestampClick(event) {
      if (!enabled || !event || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      var target = event.target;
      if (target && target.nodeType !== 1) target = target.parentElement;
      if (target && hide.isSearchControl && (hide.isSearchControl(target) || (target.closest && target.closest("form")))) {
        var form = target.closest ? target.closest("form") : null;
        if (form && hide.isSearchControl(form)) return;
        if (hide.isSearchControl(target)) return;
      }
      var link = anchorFromEvent(event);
      if (!link || (hide.isChapterUi && hide.isChapterUi(link) && logic.timestampSeconds(link.getAttribute("href"), win.location.href) == null)) {
        return;
      }
      if (link && hide.isSearchControl && link.closest && link.closest("form") && hide.isSearchControl(link.closest("form"))) {
        return;
      }
      var seconds = sameVideoTimestamp(link.getAttribute("href"));
      if (seconds == null) return;
      if (!seekPlayer(seconds)) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
    }

    function loadHome() {
      if (!enabled) return;
      if (logic.isHomeHref(win.location.href, win.location.href)) return;
      try {
        redirect(logic.homeUrl(win.location.hostname));
      } catch (err) {
        /* the test double records the call */
      }
    }

    function backOrHome(native, args) {
      if (win.history.length > 1 && typeof native === "function") {
        return native.apply(win.history, args);
      }
      loadHome();
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
      var nativeBack = win.history.back;
      var nativeGo = win.history.go;

      function homeNavigation(url) {
        return arguments.length >= 1 && logic.isHomeHref(url, win.location.href);
      }

      if (typeof nativePush === "function") {
        win.history.pushState = function (state, title, url) {
          // The Startseite stays a Startseite. Never rewrite it onto the watch URL.
          if (homeNavigation(url)) {
            var homePush = nativePush.apply(win.history, arguments);
            scheduleNavigate();
            return homePush;
          }
          var result = nativePush.apply(win.history, arguments);
          scheduleNavigate();
          return result;
        };
      }
      if (typeof nativeReplace === "function") {
        win.history.replaceState = function (state, title, url) {
          if (homeNavigation(url)) {
            var homeReplace = nativeReplace.apply(win.history, arguments);
            scheduleNavigate();
            return homeReplace;
          }
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
      if (typeof nativeBack === "function") {
        win.history.back = function () {
          return backOrHome(nativeBack, arguments);
        };
      }
      if (typeof nativeGo === "function") {
        win.history.go = function (delta) {
          if (typeof delta === "number" && delta < 0) return backOrHome(nativeGo, arguments);
          return nativeGo.apply(win.history, arguments);
        };
      }
      doc.addEventListener("click", onTimestampClick, true);
      doc.addEventListener("click", function (event) {
        if (!enabled) return;
        var target = event && event.target;
        if (target && target.nodeType !== 1) target = target.parentElement;
        if (!target || !isBottomHomeControl(target)) return;
        if (logic.isHomeHref(win.location.href, win.location.href)) return;
        var stamp = win.location.href;
        setTimeout(function () {
          if (!enabled) return;
          if (logic.isHomeHref(win.location.href, stamp)) return;
          if (win.location.href !== stamp && !onWatchPage()) return;
          loadHome();
        }, 350);
      }, true);

      function isBottomHomeControl(node) {
        var el = node;
        var guard = 0;
        while (el && guard++ < 8) {
          if (el.nodeType === 1) {
            var tag = String(el.tagName || "").toLowerCase();
            var label = String((el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("title"))) || "").trim();
            if (/^(startseite|home)$/i.test(label) && tag.indexOf("pivot") !== -1) return true;
          }
          el = el.parentElement;
        }
        return false;
      }
      win.addEventListener("popstate", function () {
        scheduleNavigate();
      });
      win.addEventListener("yt-navigate-start", function (event) {
        var detail = event && event.detail;
        var url = logic.extractNavUrl(detail);
        if (url && logic.isHomeHref(url, win.location.href)) return;
        var key = destinationKey(detail);
        if (key) {
          onNavigate(detail);
          return;
        }
        scheduleNavigate();
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
