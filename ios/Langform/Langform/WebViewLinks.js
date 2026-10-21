// Langform keeps feed tabs and the player in separate web views. Videos go to
// the player; the bottom tabs activate their retained feed without reloading.
// Other pages return to the feed while the video keeps playing in its card.
(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformPlayablesBlocked ||
      !/^(?:m\.|www\.)?youtube\.com$/.test(win.location.hostname)) return;
  var bridges = win.webkit && win.webkit.messageHandlers;
  if (!bridges || !(bridges.langformOpenWatch || bridges.langformPlayerRoute || bridges.langformOpenFeed)) return;
  win.__langformPlayablesBlocked = true;
  var doc = win.document, alive = true, redirecting = false;
  function pageInactive() {
    try { var visibility=win.__langformRealVisibility; if (visibility && typeof visibility.inactive==='function') return !!visibility.inactive(); } catch (_) {}
    return !!doc.hidden;
  }
  var container = 'mini-app-container-view-model';
  var gameFrame = 'iframe.ytMiniAppContainerViewModelIframe';
  var card = 'mini-game-card-view-model';
  function gameURL(raw) {
    try {
      var url = new URL(raw, win.location.href);
      return /^(?:m\.|www\.)?youtube\.com$/.test(url.hostname) && /^\/playables?(?:\/|$)/.test(url.pathname);
    } catch (_) { return false; }
  }
  function gameResource(raw) {
    try {
      var host = new URL(raw, win.location.href).hostname;
      return host === 'playables.usercontent.goog' || /\.playables\.usercontent\.goog$/.test(host);
    } catch (_) { return false; }
  }
  function destroyFrame(frame) {
    // Discard the browsing context, including its WebAudio, timers and WebGL.
    // Muting HTMLMediaElement cannot stop a game engine in another origin.
    frame.removeAttribute('srcdoc');
    frame.setAttribute('src', 'about:blank');
    frame.remove();
  }
  function inspect(root) {
    if (!root || !root.querySelectorAll) return;
    var frames = root.matches && root.matches('iframe') ? [root] : [];
    frames = frames.concat(Array.prototype.slice.call(root.querySelectorAll('iframe')));
    frames.forEach(function (frame) {
      if (frame.matches(gameFrame) || frame.closest(container) || gameResource(frame.getAttribute('src'))) destroyFrame(frame);
    });
  }
  var style = doc.createElement('style');
  style.id = 'langform-playables-policy';
  style.textContent = card + ', ' + container + ' { display:none!important; }\n' +
    'ytm-rich-item-renderer:has(> ' + card + '):not(:has(ytm-continuation-item-renderer, ytd-continuation-item-renderer)), ' +
    'ytd-rich-item-renderer:has(' + card + '):not(:has(a[href*="/watch?"], ytm-continuation-item-renderer, ytd-continuation-item-renderer)) { display:none!important; }';
  function installStyle() { if (doc.head && !style.isConnected) doc.head.appendChild(style); }
  function leaveGamePage() {
    if (!alive || redirecting || !gameURL(win.location.href)) return;
    redirecting = true;
    // A fresh top-level document also destroys a game retained outside the
    // visible page renderer. History/BFCache would keep its engine alive.
    win.location.replace(new URL('/', win.location.href).href);
  }
  win.__langformDiscardPlayables = function () { inspect(doc); leaveGamePage(); };
  var observer = new win.MutationObserver(function (records) {
    if (!alive) return;
    installStyle();
    records.forEach(function (record) {
      if (record.type === 'attributes') {
        if (record.target.tagName === 'IFRAME') inspect(record.target);
        return;
      }
      for (var i = 0; i < record.addedNodes.length; i++) inspect(record.addedNodes[i]);
    });
  });
  function wake() {
    alive = true; redirecting = false;
    installStyle(); inspect(doc); leaveGamePage();
    observer.observe(doc, { childList:true, subtree:true, attributes:true, attributeFilter:['src','class'] });
  }
  // Game cards use command handlers without anchors. Stop the capture event
  // before YouTube handles either kind, including a keyboard-generated click.
  win.addEventListener('click', function (event) {
    var path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    for (var i = 0; i < path.length; i++) {
      var node = path[i];
      if (!node || node.nodeType !== 1) continue;
      if (node.matches(card) || node.closest(card) || (node.tagName === 'A' && gameURL(node.getAttribute('href')))) {
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
    }
  }, true);
  ['yt-navigate-finish','state-navigateend','popstate','langform-feed-visibility'].forEach(function (name) {
    win.addEventListener(name, function () { if (alive) win.__langformDiscardPlayables(); });
  });
  ['visibilitychange','langform-real-visibilitychange'].forEach(function(name){doc.addEventListener(name, function () { if (alive && pageInactive()) win.__langformDiscardPlayables(); });});
  win.addEventListener('pagehide', function () { alive = false; observer.disconnect(); inspect(doc); });
  win.addEventListener('pageshow', wake);
  wake();
})(typeof window !== 'undefined' ? window : this);

(function (win) {
  if (!win || !win.document || win.__langformLinks) return;
  var host = String((win.location && win.location.hostname) || "");
  if (host !== "m.youtube.com" && host !== "www.youtube.com" && host !== "youtube.com") return;
  win.__langformLinks = true;
  var doc = win.document;
  function pageInactive() {
    try { var visibility=win.__langformRealVisibility; if (visibility && typeof visibility.inactive==='function') return !!visibility.inactive(); } catch (_) {}
    return !!doc.hidden;
  }

  function handler(name) {
    var handlers = win.webkit && win.webkit.messageHandlers;
    var target = handlers && handlers[name];
    return target && typeof target.postMessage === "function" ? target : null;
  }

  // Native gestures must wait for an open sheet. Keep independent contributors
  // so closing YouTube's sheet cannot unlock a still-open Discovery menu.
  var overlaySources = Object.create(null);
  var overlayLast = "";
  var overlayActive = true;
  win.__langformHasOpenOverlay = function () {
    return Object.keys(overlaySources).some(function (key) { return overlaySources[key]; });
  };
  function reportOverlays() {
    if (!overlayActive || !win.location) return;
    var target = handler("langformOverlayState");
    if (!target) return;
    var open = win.__langformHasOpenOverlay();
    var href = String(win.location.href || "");
    var key = (open ? "1" : "0") + href;
    if (key === overlayLast) return;
    try { target.postMessage({ open: open, href: href }); overlayLast = key; }
    catch (err) { /* the document is going away */ }
  }
  win.__langformSetOverlayState = function (source, open) {
    if (!overlayActive || typeof source !== "string" || !source) return;
    overlaySources[source] = !!open;
    reportOverlays();
  };

  // Known mobile YouTube containers, plus Langform's existing sheets. Discover
  // them once and after interactions; then observe only these containers and
  // their parents. A short observer catches a menu mounted asynchronously.
  var overlaySelector = "bottom-sheet-container, ytm-engagement-panel, #dialog-container, ytm-voice-search-dialog-renderer, #langform-chapter-sheet, #langform-kurzfassung";
  var overlayEntries = [];
  var overlayListeners = [];
  // Optional player decorators share this bounded discovery instead of adding
  // another full-page observer. A false notification releases detached nodes.
  win.__langformObserveOverlayContainers = function (listener) {
    if (typeof listener !== "function") return;
    overlayListeners.push(listener);
    overlayEntries.forEach(function (entry) { listener(entry.node, true); });
  };
  function notifyOverlay(node, connected) {
    overlayListeners.forEach(function (listener) { listener(node, connected); });
  }
  var overlayDiscovery = null;
  var overlayDiscoveryTimer = 0;
  var overlayRefresh = 0;
  var overlayRefreshSerial = 0;
  var overlayVisibilityAttributes = ["hidden", "aria-hidden", "style", "class"];
  function overlayIsVisible(node, visibility) {
    if (!node.childElementCount) return false;
    // YouTube retains engagement panels when a wrapper is hidden. A child's
    // computed display stays "block" beneath display:none, so checking only
    // the panel itself leaves native Start and swipe disabled after it closes.
    for (var ancestor = node; ancestor && ancestor.nodeType === 1; ancestor = ancestor.parentElement) {
      if (ancestor.hidden || ancestor.getAttribute("aria-hidden") === "true") return false;
      if (!visibility.has(ancestor)) {
        var style = win.getComputedStyle(ancestor);
        visibility.set(ancestor, style.display !== "none" && style.visibility !== "hidden" &&
          style.visibility !== "collapse" && style.contentVisibility !== "hidden");
      }
      if (!visibility.get(ancestor)) return false;
    }
    return true;
  }
  function refreshOverlays() {
    overlayRefresh = 0;
    if (!overlayActive || !win.location) return;
    var open = false;
    // Retained panels share most ancestors. Only this synchronous pass reuses
    // their visibility; the next mutation always gets fresh computed styles.
    var visibility = new WeakMap();
    overlayEntries = overlayEntries.filter(function (entry) {
      var node = entry.node;
      if (!node.isConnected) { entry.observer.disconnect(); notifyOverlay(node, false); return false; }
      watchOverlayStructure(entry);
      if (overlayIsVisible(node, visibility)) open = true;
      return true;
    });
    win.__langformSetOverlayState("page", open);
  }
  function scheduleOverlayRefresh() {
    if (!overlayActive || overlayRefresh) return;
    var ticket = ++overlayRefreshSerial;
    overlayRefresh = ticket;
    // Every panel observes shared wrappers. Merge their observer callbacks in
    // this microtask checkpoint, before the next frame or user interaction.
    // No animation-frame delay may leave native gestures incorrectly enabled.
    Promise.resolve().then(function () {
      if (overlayRefresh !== ticket) return;
      refreshOverlays();
    });
  }
  function watchOverlayStructure(entry) {
    var ancestors = [];
    for (var ancestor = entry.node.parentNode; ancestor; ancestor = ancestor.parentNode) ancestors.push(ancestor);
    if (entry.ancestors && entry.ancestors.length === ancestors.length && ancestors.every(function (node, index) { return node === entry.ancestors[index]; })) return;
    entry.observer.disconnect();
    entry.observer.observe(entry.node, { attributes: true, attributeFilter: overlayVisibilityAttributes, childList: true });
    // A sheet can disappear together with its wrapper. These direct structural
    // observations catch removal without watching comment subtrees or scanning
    // the document. Reparented sheets release the old ancestry as well.
    ancestors.forEach(function (node) {
      // Direct ancestor attributes catch retained wrappers closing/reopening
      // after discovery ends, without observing their full comment subtrees.
      entry.observer.observe(node, node.nodeType === 1
        ? { attributes: true, attributeFilter: overlayVisibilityAttributes, childList: true }
        : { childList: true });
    });
    entry.ancestors = ancestors;
  }
  function rememberOverlay(node) {
    if (overlayEntries.some(function (entry) { return entry.node === node; })) return;
    var observer = new win.MutationObserver(function (records) {
      // Engagement panels form a stack of siblings in panel-container. A reply
      // panel can open from inside another panel without a discovery window.
      var changed = !node.isConnected;
      records.forEach(function (record) {
        if (record.target === node || record.type === "attributes") changed = true;
        for (var i = 0; i < record.removedNodes.length; i++) {
          var removed = record.removedNodes[i];
          if (removed === node || (removed.contains && removed.contains(node))) changed = true;
        }
        if (record.target !== node.parentNode) return;
        changed = true;
        for (var j = 0; j < record.addedNodes.length; j++) discoverOverlays(record.addedNodes[j]);
      });
      if (changed) scheduleOverlayRefresh();
    });
    var entry = { node: node, observer: observer, ancestors: null };
    watchOverlayStructure(entry);
    overlayEntries.push(entry);
    notifyOverlay(node, true);
  }
  function discoverOverlays(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches(overlaySelector)) rememberOverlay(root);
    var nodes = root.querySelectorAll(overlaySelector);
    for (var i = 0; i < nodes.length; i++) rememberOverlay(nodes[i]);
  }
  function stopOverlayDiscovery() {
    if (overlayDiscovery) overlayDiscovery.disconnect();
    overlayDiscovery = null;
    if (overlayDiscoveryTimer) win.clearTimeout(overlayDiscoveryTimer);
    overlayDiscoveryTimer = 0;
  }
  function watchNewOverlays() {
    if (!overlayActive || typeof win.MutationObserver !== "function" || !handler("langformOverlayState")) return;
    stopOverlayDiscovery();
    overlayDiscovery = new win.MutationObserver(function (records) {
      var count = overlayEntries.length;
      records.forEach(function (record) {
        // An already registered comments/settings sheet owns its descendants.
        // Appending comments there cannot create another top-level blocker.
        if (overlayEntries.some(function (entry) { return entry.node.contains(record.target); })) return;
        for (var i = 0; i < record.addedNodes.length; i++) discoverOverlays(record.addedNodes[i]);
      });
      if (overlayEntries.length !== count) scheduleOverlayRefresh();
    });
    overlayDiscovery.observe(win.document, { childList: true, subtree: true });
    overlayDiscoveryTimer = win.setTimeout(stopOverlayDiscovery, 2000);
  }
  function inspectOverlays() {
    if (!overlayActive || typeof win.MutationObserver !== "function" || !handler("langformOverlayState")) return;
    discoverOverlays(win.document);
    refreshOverlays();
    watchNewOverlays();
  }
  win.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest || target.id === "player-controls-a11y-toggle" || target.id === "langform-native-watch-link") return;
    // Existing sheets have direct observers. Their internal clicks and comments
    // need neither a document search nor a fresh global discovery window.
    if (target.closest(overlaySelector + ", #langform-discovery-sheet")) return;
    watchNewOverlays();
  }, true);
  win.addEventListener("yt-navigate-finish", inspectOverlays);
  win.addEventListener("state-navigateend", inspectOverlays);
  win.addEventListener("engagement-panel-opened", inspectOverlays);
  win.document.addEventListener("DOMContentLoaded", inspectOverlays, { once: true });
  win.addEventListener("pageshow", function () { overlayActive = true; inspectOverlays(); });
  win.addEventListener("pagehide", function () {
    overlayRefresh = 0;
    stopOverlayDiscovery();
    overlayEntries.forEach(function (entry) { entry.observer.disconnect(); notifyOverlay(entry.node, false); });
    overlayEntries = [];
    overlaySources = Object.create(null);
    reportOverlays();
    overlayActive = false;
  });
  inspectOverlays();

  function youtubeHost(name) {
    return name === "m.youtube.com" || name === "www.youtube.com" || name === "youtube.com";
  }

  function isWatch(url) {
    return url.pathname === "/watch" || url.pathname.indexOf("/watch/") === 0;
  }

  function onWatchPage() {
    try {
      return isWatch(new URL(win.location.href));
    } catch (err) {
      return false;
    }
  }

  function ours(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.hasAttribute && node.hasAttribute("data-langform-kurz")) return true;
    return String(node.id || "").indexOf("langform-") === 0;
  }

  function eventPath(event) {
    if (typeof event.composedPath === "function") {
      var path = event.composedPath();
      if (path && path.length) return path;
    }
    var list = [];
    var node = event.target;
    while (node) {
      list.push(node);
      node = node.parentNode || node.host || null;
    }
    return list;
  }

  function linkOf(event) {
    var path = eventPath(event);
    var link = null;
    for (var i = 0; i < path.length; i++) {
      var node = path[i];
      if (ours(node)) return null;
      if (!link && node && node.tagName === "A" && node.hasAttribute && node.hasAttribute("href")) link = node;
    }
    return link;
  }

  function hand(event, name, href, sourceRect, sourceVideoID, sourceThumbnail) {
    var target = handler(name);
    if (!target) return false;
    try {
      var body = { href: href };
      if (sourceRect) body.sourceRect = sourceRect;
      if (sourceVideoID) body.sourceVideoID = sourceVideoID;
      if (sourceThumbnail) body.sourceThumbnail = sourceThumbnail;
      target.postMessage(body);
    } catch (err) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    return true;
  }

  // Search belongs to the retained feed, never to the Watch surface. Intercept
  // the current mobile search control before YouTube opens its search overlay.
  var searchControl = '.topbar-button-search-button, .ytTopBarViewModelSearchButton, .ytSearchboxComponentSearchButton, ytm-header button[aria-label="Search"], ytm-mobile-topbar-renderer button[aria-label="Search"], ytm-header button[aria-label="Suchen"], ytm-mobile-topbar-renderer button[aria-label="Suchen"], :is(ytm-header,ytm-header-bar,ytm-mobile-topbar-renderer,.ytTopBarViewModelHost) [aria-label="In YouTube suchen"], :is(ytm-header,ytm-header-bar,ytm-mobile-topbar-renderer,.ytTopBarViewModelHost) [aria-label="YouTube durchsuchen"], :is(ytm-header,ytm-header-bar,ytm-mobile-topbar-renderer,.ytTopBarViewModelHost) [aria-label="Bei YouTube suchen"], :is(ytm-header,ytm-header-bar,ytm-mobile-topbar-renderer,.ytTopBarViewModelHost) [aria-label="YouTube-Suche"], [aria-label="Bei YouTube suchen"], [title="Bei YouTube suchen"], [aria-label="In YouTube suchen"]';
  var searchInput = 'yt-searchbox input[name="search_query"], yt-searchbox textarea[name="search_query"], ytm-searchbox input[name="search_query"]';
  function nativeSearch(event, ticket, focusOnly) {
    var bridge = handler('langformNativeSearch');
    if (!bridge || !handler('langformOpenWatch') || win.__langformFeedActive === false) return false;
    var body = {action:focusOnly?'focus':'open', href:win.location.href};
    try {
      var selected=typeof win.__langformSearchFilter==='function' ? win.__langformSearchFilter() : null;
      if(['all','videos','channels','unwatched'].indexOf(selected)>=0)body.filter=selected;
    } catch (_) {}
    if (Number.isSafeInteger(ticket) && ticket >= 0) body.ticket = ticket;
    try { bridge.postMessage(body); }
    catch (_) { return false; }
    if (event) { event.preventDefault(); event.stopImmediatePropagation(); }
    return true;
  }
  var nativeSearchContact = null, nativeSearchTrailing = null;
  function nativeSearchControl(target) { return target && target.closest && target.closest(searchControl + ',' + searchInput); }
  function nativeSearchStart(event, point, kind) {
    if (event.isPrimary === false) { nativeSearchContact = null; return; }
    if (!handler('langformNativeSearch') || !handler('langformOpenWatch') || onWatchPage() || win.__langformFeedActive === false ||
        !point || event.button > 0 || event.isPrimary === false) return;
    var control = nativeSearchControl(event.target); if (!control) return;
    nativeSearchTrailing = null;
    if (nativeSearchContact && nativeSearchContact.kind !== kind) { event.stopPropagation(); return; }
    nativeSearchContact = {control:control,kind:kind,id:kind==='touch'?point.identifier:event.pointerId,x:point.clientX,y:point.clientY,href:win.location.href};
    // Shield YouTube's early tap recognizer while preserving WebKit scrolling
    // and keyboard defaults. The accepted release, rather than press, opens UI.
    event.stopPropagation();
  }
  function nativeSearchMove(event, point, kind) {
    var contact = nativeSearchContact;
    if (!contact || contact.kind !== kind || !point) return;
    if (Math.abs(point.clientX-contact.x)>10 || Math.abs(point.clientY-contact.y)>10) {
      nativeSearchTrailing = {control:contact.control,until:Date.now()+800}; nativeSearchContact = null;
    }
  }
  function nativeSearchEnd(event, point, kind) {
    var contact = nativeSearchContact;
    if (!contact || contact.kind !== kind || !point) return;
    nativeSearchContact = null;
    if ((kind==='touch'?point.identifier:event.pointerId)!==contact.id || !contact.control.isConnected ||
        contact.href!==win.location.href || Math.abs(point.clientX-contact.x)>10 || Math.abs(point.clientY-contact.y)>10) return;
    if (nativeSearch(event)) nativeSearchTrailing = {control:contact.control,href:contact.href,opened:true,until:Date.now()+2500};
  }
  win.addEventListener('pointerdown',function(e){nativeSearchStart(e,e,'pointer');},true);
  win.addEventListener('pointermove',function(e){nativeSearchMove(e,e,'pointer');},true);
  win.addEventListener('pointerup',function(e){nativeSearchEnd(e,e,'pointer');},true);
  win.addEventListener('pointercancel',function(){nativeSearchContact=null;},true);
  win.addEventListener('touchstart',function(e){if(e.touches.length!==1){nativeSearchContact=null;return;}nativeSearchStart(e,e.touches[0],'touch');},{capture:true,passive:true});
  win.addEventListener('touchmove',function(e){if(e.touches.length!==1){nativeSearchContact=null;return;}nativeSearchMove(e,e.touches[0],'touch');},{capture:true,passive:true});
  win.addEventListener('touchend',function(e){nativeSearchEnd(e,e.changedTouches[0],'touch');},{capture:true,passive:false});
  ['touchcancel','blur'].forEach(function(name){win.addEventListener(name,function(){nativeSearchContact=null;},true);});
  ['pagehide','langform-feed-visibility'].forEach(function(name){win.addEventListener(name,function(){nativeSearchContact=null;nativeSearchTrailing=null;},true);});
  win.addEventListener('keydown',function(){nativeSearchTrailing=null;},true);
  function playerRoute(event, kind, href) {
    var bridge = handler('langformPlayerRoute');
    if (!bridge || handler('langformOpenWatch')) return false;
    try { bridge.postMessage({ kind:kind, href:href, sourceHref:win.location.href, videoID:routeWatchID }); }
    catch (_) { return false; }
    if (event) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
    return true;
  }
  var searchFrame = 0, searchGeneration = 0, searchRequest = null;
  function reportSearch(request, opened) {
    var bridge = handler('langformFeedSearch');
    if (!bridge || !request) return;
    try { bridge.postMessage({ ticket:request.ticket, opened:opened, href:win.location.href }); }
    catch (_) { /* a departing document cannot acknowledge its request */ }
  }
  win.__langformCancelSearch = function () {
    var request = searchRequest;
    searchRequest = null;
    searchGeneration++;
    if (searchFrame) win.cancelAnimationFrame(searchFrame);
    searchFrame = 0;
    reportSearch(request, false);
  };
  function searchTarget() {
    function visible(node) {
      return !node.disabled && node.getClientRects().length > 0 &&
        win.getComputedStyle(node).visibility !== 'hidden';
    }
    // Both header implementations can coexist while YouTube hydrates. The
    // first DOM match may belong to a hidden, obsolete searchbox or button.
    var inputs = doc.querySelectorAll('yt-searchbox input[name="search_query"], yt-searchbox textarea[name="search_query"], ytm-searchbox input[name="search_query"]');
    for (var input of inputs) if (visible(input)) return input;
    for (var control of doc.querySelectorAll(searchControl)) {
      var button = control.closest('button,[role="button"]') || control.querySelector('button,[role="button"]') || control;
      if (visible(button) && typeof button.click === 'function') return button;
    }
    return null;
  }
  win.__langformOpenSearch = function (ticket) {
    // Called only in the feed by the native coordinator. Preserve YouTube's
    // own search UI, focus, history and keyboard behavior.
    if (!Number.isSafeInteger(ticket) || ticket < 0 || !handler('langformFeedSearch') ||
        !handler('langformOpenWatch') || win.__langformFeedActive === false || (!handler('langformNativeSearch') && !searchTarget())) return false;
    win.__langformCancelSearch();
    var generation = searchGeneration;
    searchRequest = { ticket:ticket };
    // A native tab switch can overtake an already queued evaluateJavaScript.
    // Keep the pending UI action revocable until the next rendering frame.
    searchFrame = win.requestAnimationFrame(function () {
      if (generation !== searchGeneration) return;
      searchFrame = 0;
      var request = searchRequest;
      searchRequest = null;
      if (win.__langformFeedActive === false) { reportSearch(request, false); return; }
      if (nativeSearch(null, request.ticket)) { reportSearch(request, true); return; }
      var target = searchTarget();
      if (!target) { reportSearch(request, false); return; }
      var opened = false;
      try {
        if (target.matches('input,textarea')) { target.focus(); opened = doc.activeElement === target; }
        else { target.click(); opened = true; }
      } catch (_) { /* hydration can detach or replace the control */ }
      reportSearch(request, opened);
    });
    return true;
  };
  win.addEventListener('langform-feed-visibility', function () {
    if (win.__langformFeedActive === false) win.__langformCancelSearch();
  });
  win.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || form.nodeName !== 'FORM' || !handler('langformPlayerRoute') || handler('langformOpenWatch')) return;
    var input = form.querySelector('input[name="search_query"], textarea[name="search_query"]');
    if (!input) return;
    var url;
    try { url = new URL(form.getAttribute('action') || '/results', win.location.href); } catch (_) { return; }
    if (!youtubeHost(url.hostname) || url.pathname !== '/results') return;
    url.searchParams.set('search_query', input.value);
    playerRoute(event, 'navigate', url.href);
  }, true);
  var routeAlive = true, historyPatches = [], routeWatchID = '';
  function rememberWatchRoute() {
    if (onWatchPage()) routeWatchID = new URL(win.location.href).searchParams.get('v') || '';
  }
  rememberWatchRoute();
  function reportPlayerDeparture() {
    if (!routeAlive || !handler('langformPlayerRoute')) return;
    if (onWatchPage()) { rememberWatchRoute(); return; }
    playerRoute(null, 'departed', win.location.href);
  }
  function installHistoryRoute() {
    if (historyPatches.length || !handler('langformPlayerRoute')) return;
    ['pushState','replaceState'].forEach(function (name) {
      var original = win.history[name];
      function wrapper() {
        var result = original.apply(this, arguments);
        reportPlayerDeparture();
        return result;
      }
      win.history[name] = wrapper;
      historyPatches.push({name:name,original:original,wrapper:wrapper});
    });
  }
  ['yt-navigate-finish','state-navigateend','popstate'].forEach(function (name) { win.addEventListener(name,reportPlayerDeparture); });
  win.addEventListener('pagehide',function () {
    win.__langformCancelSearch();
    routeAlive = false;
    historyPatches.forEach(function (entry) { if (win.history[entry.name] === entry.wrapper) win.history[entry.name] = entry.original; });
    historyPatches = [];
  });
  win.addEventListener('pageshow',function () { routeAlive = true; installHistoryRoute(); reportPlayerDeparture(); });
  installHistoryRoute();

  function feedTabPath(path) {
    return path === "/" || path === "/feed/subscriptions" || path === "/feed/you" || path === "/feed/library";
  }

  function tabLabelPath(label) {
    label = String(label || "").replace(/\s+/g, " ").trim();
    if (/^(startseite|home)$/i.test(label)) return "/";
    if (/^(abos|subscriptions)$/i.test(label)) return "/feed/subscriptions";
    if (/^(mein youtube|you|mediathek|library)$/i.test(label)) {
      // The mobile site still serves this tab through FElibrary. /feed/you
      // produces only a shell there; an explicit anchor above always wins.
      return host === "m.youtube.com" ? "/feed/library" : "/feed/you";
    }
    return null;
  }

  // Only an explicit bottom-tab tap activates a cached native feed. Look within
  // the tapped item, never across the bar where another tab's label could win.
  function feedTabURL(event) {
    if (!handler("langformNavigateFeed")) return null;
    var path = eventPath(event);
    var pivot = null;
    var anchor = null;
    for (var i = 0; i < path.length; i++) {
      var node = path[i];
      if (ours(node)) return null;
      if (!pivot && !anchor && node && node.tagName === "A" && node.hasAttribute("href")) anchor = node;
      if (!pivot && node && node.tagName === "YTM-PIVOT-BAR-ITEM-RENDERER") pivot = node;
    }
    if (!pivot) return null;
    anchor = anchor || pivot.querySelector("a[href]");
    var raw = anchor && String(anchor.getAttribute("href") || "").trim();
    if (raw && raw.charAt(0) !== "#") {
      try {
        var url = new URL(raw, win.location.href);
        if (url.protocol === "https:" && youtubeHost(url.hostname) && feedTabPath(url.pathname)) return url.href;
      } catch (err) { /* Invalid explicit links remain YouTube's. */ }
      return null;
    }
    var destination = null;
    var labels = [pivot].concat(Array.prototype.slice.call(pivot.querySelectorAll("[aria-label], [title]")));
    for (var j = 0; j < labels.length && !destination; j++) {
      destination = tabLabelPath(labels[j].getAttribute("aria-label")) || tabLabelPath(labels[j].getAttribute("title"));
    }
    destination = destination || tabLabelPath(pivot.textContent);
    return destination ? new URL(destination, win.location.href).href : null;
  }

  function watchURL(link) {
    if (!link) return null;
    try {
      var url = new URL(link.getAttribute("href"), win.location.href);
      return (url.protocol === "https:" || url.protocol === "http:") && youtubeHost(url.hostname) &&
        isWatch(url) && url.searchParams.get("v") ? url : null;
    } catch (err) { return null; }
  }

  var videoCardSelector = "ytm-video-with-context-renderer, ytm-compact-video-renderer, ytm-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer";

  function matchingThumbnail(scope, id, card) {
    var images = scope.querySelectorAll("img");
    for (var i = 0; i < images.length; i++) {
      var image = images[i];
      if (card) {
        // Nested cards and a same-ID avatar/banner are still not this card's
        // video thumbnail. Require its own watch anchor as well as the image ID.
        if (image.closest(videoCardSelector) !== card) continue;
        var imageWatch = watchURL(image.closest("a[href]"));
        if (!imageWatch || imageWatch.searchParams.get("v") !== id) continue;
      }
      try {
        var imageURL = new URL(image.currentSrc || image.getAttribute("src") || image.getAttribute("data-src"), win.location.href);
        var match = imageURL.pathname.match(/^\/(?:vi|vi_webp|an_webp)\/([^/]+)\//);
        if ((imageURL.hostname === "ytimg.com" || /\.ytimg\.com$/.test(imageURL.hostname)) &&
            match && match[1] === id) return image;
      } catch (err) { /* A not-yet-loaded thumbnail simply uses the fallback opening. */ }
    }
    return null;
  }

  // Prefer the tapped link. A title may use its own card's thumbnail only when
  // all directly owned watch links identify this one video; never search a feed.
  function watchThumbnail(link, url) {
    if (!link || !url) return null;
    var id = url.searchParams.get("v");
    var direct = matchingThumbnail(link, id, null);
    if (direct) return direct;
    var card = link.closest(videoCardSelector);
    if (!card) return null;
    var links = card.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      if (links[i].closest(videoCardSelector) !== card) continue;
      var candidate = watchURL(links[i]);
      if (candidate && candidate.searchParams.get("v") !== id) return null;
    }
    return matchingThumbnail(card, id, card);
  }

  function thumbnailRect(image) {
    if (!image || !image.isConnected || typeof image.getBoundingClientRect !== "function") return null;
    var style = win.getComputedStyle(image);
    if (image.hidden || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return null;
    var rect = image.getBoundingClientRect();
    var viewportWidth = win.innerWidth;
    var viewportHeight = win.innerHeight;
    var values = [rect.left, rect.top, rect.width, rect.height, viewportWidth, viewportHeight];
    if (!values.every(function (value) { return typeof value === "number" && isFinite(value); }) ||
        rect.width <= 0 || rect.height <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return null;
    var x = Math.max(0, rect.left);
    var y = Math.max(0, rect.top);
    var width = Math.min(viewportWidth, rect.left + rect.width) - x;
    var height = Math.min(viewportHeight, rect.top + rect.height) - y;
    // A sliver clipped by scrolling is not a useful visual origin.
    if (width < 64 || height < 36 || width * height < rect.width * rect.height * 0.35) return null;
    return { x: x, y: y, width: width, height: height, viewportWidth: viewportWidth, viewportHeight: viewportHeight };
  }

  function stillThumbnail(image, url) {
    if (!image || image.tagName !== "IMG" || !image.complete || image.naturalWidth <= 0 || !image.currentSrc) return null;
    try {
      var id = url.searchParams.get("v");
      var asset = new URL(image.currentSrc);
      var match = asset.pathname.match(/^\/(vi|vi_webp)\/([A-Za-z0-9_-]{11})\/[A-Za-z0-9_-]+\.(jpg|jpeg|webp)$/);
      if (asset.protocol !== "https:" || asset.hostname !== "i.ytimg.com" || asset.username || asset.password ||
          (asset.port && asset.port !== "443") || !match || match[2] !== id ||
          (match[1] === "vi_webp" ? match[3] !== "webp" : match[3] === "webp")) return null;
      return { url: asset.href, videoID: id };
    } catch (_) { return null; }
  }

  // One delegated gesture and one compositor animation, with no feed observer
  // or frame loop. Individual scale leaves YouTube's transform/transition and
  // inline styles alone. The animation disappears completely on cancellation.
  var touchMotionActive = true;
  var touchMotion = null;
  var touchAnimation = null;
  var touchAnimationNode = null;
  var reducedMotion = typeof win.matchMedia === "function" ? win.matchMedia("(prefers-reduced-motion: reduce)") : null;

  function cancelTouchMotion() {
    touchMotion = null;
    if (touchAnimation) {
      touchAnimation.onfinish = null;
      touchAnimation.cancel();
    }
    touchAnimation = null;
    touchAnimationNode = null;
  }

  function canMove() {
    return touchMotionActive && win.__langformFeedActive !== false && !pageInactive() &&
      !(reducedMotion && reducedMotion.matches) && !onWatchPage() && !!handler("langformOpenWatch");
  }

  function motionTarget(event) {
    var node = event.target;
    if (!node || !node.closest || node.closest("input, textarea, select, [contenteditable], video")) return null;
    var link = linkOf(event);
    var image = watchThumbnail(link, watchURL(link));
    if (image && thumbnailRect(image)) return image;
    // Bottom tabs are small controls; never scale their containing bar or feed.
    return feedTabURL(event) ? node.closest("ytm-pivot-bar-item-renderer") : null;
  }

  function beginTouchMotion(event, point, identifier) {
    if (event.defaultPrevented || !canMove() || !point || !win.CSS || typeof win.CSS.supports !== "function" || !win.CSS.supports("scale", "1")) {
      cancelTouchMotion();
      return;
    }
    var node = motionTarget(event);
    // A second press can arrive during the return. Continue its visible scale
    // instead of briefly snapping the same thumbnail/control back to full size.
    var fromScale = touchAnimation && touchAnimationNode === node ? win.getComputedStyle(node).scale : "1";
    cancelTouchMotion();
    if (!node || typeof node.animate !== "function") return;
    var existingScale = win.getComputedStyle(node).scale;
    if (existingScale && existingScale !== "none" && existingScale !== "1" && existingScale !== "1 1") return;
    try {
      touchAnimation = node.animate([{ scale: fromScale && fromScale !== "none" ? fromScale : "1" }, { scale: ".985" }], {
        duration: 100, easing: "cubic-bezier(.2, 0, .2, 1)", fill: "forwards"
      });
      touchAnimationNode = node;
      touchMotion = { node: node, x: point.clientX, y: point.clientY, identifier: identifier };
    } catch (err) { cancelTouchMotion(); }
  }

  function moveTouchMotion(point, identifier) {
    if (!touchMotion || touchMotion.identifier !== identifier) return;
    var x = point.clientX - touchMotion.x;
    var y = point.clientY - touchMotion.y;
    if (x * x + y * y > 64) cancelTouchMotion();
  }

  function endTouchMotion(identifier) {
    if (!touchMotion || touchMotion.identifier !== identifier) return;
    var node = touchMotion.node;
    var scale = win.getComputedStyle(node).scale;
    cancelTouchMotion();
    if (!canMove() || !node.isConnected) return;
    try {
      var animation = node.animate([{ scale: scale && scale !== "none" ? scale : ".985" }, { scale: "1" }], {
        duration: 180, easing: "cubic-bezier(.16, 1, .3, 1)"
      });
      touchAnimation = animation;
      touchAnimationNode = node;
      animation.onfinish = function () {
        if (touchAnimation === animation) cancelTouchMotion();
      };
    } catch (err) { cancelTouchMotion(); }
  }

  var passiveCapture = { capture: true, passive: true };
  if (typeof win.PointerEvent === "function") {
    win.addEventListener("pointerdown", function (event) {
      if (event.isPrimary === false || event.button) { cancelTouchMotion(); return; }
      beginTouchMotion(event, event, event.pointerId);
    }, passiveCapture);
    win.addEventListener("pointermove", function (event) { moveTouchMotion(event, event.pointerId); }, passiveCapture);
    win.addEventListener("pointerup", function (event) { endTouchMotion(event.pointerId); }, passiveCapture);
    win.addEventListener("pointercancel", cancelTouchMotion, passiveCapture);
  } else {
    win.addEventListener("touchstart", function (event) {
      if (event.touches.length !== 1) { cancelTouchMotion(); return; }
      beginTouchMotion(event, event.touches[0], event.touches[0].identifier);
    }, passiveCapture);
    win.addEventListener("touchmove", function (event) {
      if (event.touches.length !== 1) { cancelTouchMotion(); return; }
      moveTouchMotion(event.touches[0], event.touches[0].identifier);
    }, passiveCapture);
    win.addEventListener("touchend", function (event) {
      for (var i = 0; i < event.changedTouches.length; i++) endTouchMotion(event.changedTouches[i].identifier);
    }, passiveCapture);
    win.addEventListener("touchcancel", cancelTouchMotion, passiveCapture);
  }
  win.addEventListener("scroll", cancelTouchMotion, passiveCapture);
  win.addEventListener("blur", cancelTouchMotion);
  win.addEventListener("pagehide", function () { touchMotionActive = false; cancelTouchMotion(); });
  win.addEventListener("pageshow", function () { touchMotionActive = true; });
  win.addEventListener("yt-navigate-start", cancelTouchMotion);
  win.addEventListener("langform-feed-visibility", function () {
    if (win.__langformFeedActive === false) cancelTouchMotion();
  });
  ['visibilitychange','langform-real-visibilitychange'].forEach(function(name){doc.addEventListener(name, function () {
    if (pageInactive()) cancelTouchMotion();
  });});
  if (reducedMotion && typeof reducedMotion.addEventListener === "function") {
    reducedMotion.addEventListener("change", function () { if (reducedMotion.matches) cancelTouchMotion(); });
  }

  function onClick(event) {
    if (!event || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (event.detail>0 && nativeSearchTrailing && Date.now()<nativeSearchTrailing.until && nativeSearchTrailing.control.contains(event.target)) {
      var trailing=nativeSearchTrailing;nativeSearchTrailing=null;
      // WebKit's late native click handoff can reclaim first-responder status
      // after the pointer release already opened UIKit. Restore focus only;
      // a closed overlay must never be reopened by this compatibility click.
      if(trailing.opened && trailing.href===win.location.href && !onWatchPage())nativeSearch(event,undefined,true);
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    // Closing a settings sheet can retarget WebKit's compatibility click onto
    // a recommendation below it. Settings is installed later; ask its contact
    // guard before this earlier handler can hand the link to the native router.
    if (typeof win.__langformConsumePlayerSettingsClick === "function" && win.__langformConsumePlayerSettingsClick(event)) return;
    // This script is installed before PlayerRect. Give its native-drag guard
    // first refusal before a trailing player click can navigate another page.
    if (typeof win.__langformHandlePlayerClick === "function" && win.__langformHandlePlayerClick(event)) return;
    // Community images can sit inside a /post/ anchor. Their image viewer owns
    // that tap before the generic feed router can turn it into a detail page.
    if (typeof win.__langformHandleCommunityClick === "function" && win.__langformHandleCommunityClick(event)) return;
    var search = event.target && event.target.closest && event.target.closest(searchControl);
    var nativeField = event.target && event.target.closest && event.target.closest(searchInput);
    if ((search || nativeField) && !onWatchPage() && nativeSearch(event)) return;
    if (search && onWatchPage() && playerRoute(event, 'search', win.location.origin + '/')) return;
    var tabURL = feedTabURL(event);
    if (tabURL) {
      hand(event, "langformNavigateFeed", tabURL);
      return;
    }
    var link = linkOf(event);
    if (!link) return;
    var raw = String(link.getAttribute("href") || "");
    if (!raw || raw.charAt(0) === "#" || /^javascript:/i.test(raw)) return;
    var url;
    try {
      url = new URL(raw, win.location.href);
    } catch (err) {
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    var video = youtubeHost(url.hostname) && isWatch(url) && !!url.searchParams.get("v");
    if (video && onWatchPage() && handler("langformWatchIntent")) {
      var sourceVideoID = new URL(win.location.href).searchParams.get("v");
      if (sourceVideoID) {
        var watchImage = watchThumbnail(link, url), watchRect = thumbnailRect(watchImage);
        var watchAsset = watchRect ? stillThumbnail(watchImage, url) : null;
        if (watchAsset && typeof win.__langformBeginWatchOpening === 'function') {
          watchAsset.openingToken = win.__langformBeginWatchOpening(watchImage, url.href);
        }
        if (!hand(event, "langformWatchIntent", url.href, watchRect, sourceVideoID, watchAsset) && watchAsset && watchAsset.openingToken) {
          win.__langformWatchOpeningControl('discard', watchAsset.openingToken);
        }
      }
      return;
    }
    if (handler("langformOpenWatch")) {
      if (video && !onWatchPage()) {
        var image = win.__langformFeedActive !== false ? watchThumbnail(link, url) : null;
        var sourceRect = thumbnailRect(image);
        var sourceThumbnail = sourceRect ? stillThumbnail(image, url) : null;
        if (sourceThumbnail && typeof win.__langformBeginWatchOpening === 'function') {
          sourceThumbnail.openingToken = win.__langformBeginWatchOpening(image, url.href);
          if (win.__langformWatchOpeningUsesPreview && win.__langformWatchOpeningUsesPreview(sourceThumbnail.openingToken)) sourceThumbnail.livePreview = true;
        }
        if (!hand(event, "langformOpenWatch", url.href, sourceRect, null, sourceThumbnail) && sourceThumbnail && sourceThumbnail.openingToken) {
          win.__langformWatchOpeningControl('discard', sourceThumbnail.openingToken);
        }
      }
      return;
    }
    if (handler("langformOpenFeed") && youtubeHost(url.hostname) && !isWatch(url)) {
      hand(event, "langformOpenFeed", url.href);
    }
  }

  win.addEventListener("click", onClick, true);
})(typeof window !== "undefined" ? window : this);
