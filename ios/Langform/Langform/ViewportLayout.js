// The native stage has one full-screen viewport in inline and fullscreen modes.
// YouTube already handles lateral/bottom safe areas; add the top area to its
// known mobile header, page flow and inline player in the same coordinate space.
(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformViewportLayout) return;
  if (!/^(m\.|www\.)?youtube\.com$/.test(win.location.hostname)) return;
  win.__langformViewportLayout = true;
  var doc = win.document, style = doc.createElement('style'), watching = null;
  style.id = 'langform-viewport-layout';
  style.textContent = `
html[data-langform-edge-to-edge] { --lf-safe-top:var(--lf-native-safe-top,env(safe-area-inset-top,0px)); }
/* The native 44pt collapse button occupies the leading Watch-header slot.
   Retain the original slot width so search/menu controls do not move, while
   removing the overlapping wordmark and its underlying Home hit target. */
html[data-langform-watch-header]:not([data-langform-fullscreen]):not([data-langform-mini-video]) ytm-mobile-topbar-renderer .mobile-topbar-logo,
html[data-langform-watch-header]:not([data-langform-fullscreen]):not([data-langform-mini-video]) ytm-mobile-topbar-renderer a:has(.mobile-topbar-logo) { visibility:hidden!important;pointer-events:none!important; }
html[data-langform-edge-to-edge]:not([data-langform-fullscreen]) ytm-header:not(.out),
html[data-langform-edge-to-edge]:not([data-langform-fullscreen]) ytm-header-bar:not(.out),
html[data-langform-edge-to-edge]:not([data-langform-fullscreen]) ytm-mobile-topbar-renderer:not(.out),
html[data-langform-edge-to-edge]:not([data-langform-fullscreen]) .ytTopBarViewModelHost:not(.out) { top:var(--lf-safe-top)!important; }
/* Feed navigation stays available while its rows scroll. Keep the existing
   48px content row below the native inset and paint black through the status
   area separately, so no feed thumbnail can reappear above the logo. */
html[data-langform-feed-header]:not([data-langform-fullscreen]) ytm-header,
html[data-langform-feed-header]:not([data-langform-fullscreen]) ytm-header-bar,
html[data-langform-feed-header]:not([data-langform-fullscreen]) ytm-mobile-topbar-renderer,
html[data-langform-feed-header]:not([data-langform-fullscreen]) .ytTopBarViewModelHost {
  position:fixed!important; top:var(--lf-safe-top)!important; left:0!important; right:0!important;
  transform:none!important; background-color:#000!important; z-index:50!important;
  color:#fff!important;
  --yt-spec-text-primary:#fff; --yt-spec-text-secondary:#aaa;
  --yt-spec-icon-active-other:#fff; --yt-spec-icon-inactive:#fff; --yt-spec-wordmark-text:#fff;
  /* Current mweb aliases for primary/icon, title/wordmark, field and surface.
     Limit the dark contrast tokens to the black header, preserving feed theme. */
  --tffc2fd3a644f6275:#fff; --t7f9b7e1603e20b94:#fff;
  --t7f4f2c6d54836ce0:#272727; --t518e925f61bdcb91:#000;
}
html[data-langform-feed-header]:not([data-langform-fullscreen]) header.mobile-topbar-header { background-color:#000!important; }
html[data-langform-feed-header]:not([data-langform-fullscreen]) :is(ytm-header,ytm-header-bar,ytm-mobile-topbar-renderer,.ytTopBarViewModelHost) :is(button,[role="button"],.mobile-topbar-title) { color:#fff!important; }
html[data-langform-feed-header]:not([data-langform-fullscreen]) :is(ytm-header,ytm-header-bar,ytm-mobile-topbar-renderer,.ytTopBarViewModelHost) :is(input[name="search_query"],textarea[name="search_query"]) { color:#fff!important;-webkit-text-fill-color:#fff!important;caret-color:#fff; }
html[data-langform-feed-header]:not([data-langform-fullscreen]) :is(.mobile-topbar-title,.ytTopBarViewModelSearchboxWrapper) { min-width:0; }
#langform-feed-search[data-langform-feed-search] {
  display:inline-flex!important; align-items:center!important; justify-content:center!important;
  flex:0 0 44px!important; width:44px!important; height:44px!important; min-width:44px!important;
  padding:10px!important; margin:0!important; border:0!important; background:transparent!important;
  color:#fff!important; box-sizing:border-box!important; cursor:pointer;
}
#langform-feed-safe-top-cover[data-langform-feed-safe-top-cover] { display:none!important; }
html[data-langform-feed-header]:not([data-langform-fullscreen]) #langform-feed-safe-top-cover[data-langform-feed-safe-top-cover] {
  display:block!important; position:fixed!important; top:0!important; left:0!important; right:0!important;
  height:var(--lf-safe-top)!important; background:#000!important; pointer-events:none!important;
  z-index:2147483640!important; opacity:1!important; transform:none!important;
}
/* Mweb suggestions are fixed to the viewport, rather than to their search
   field. Keep their original 48px header offset in the same safe-area space
   as both mobile header variants, or the list covers the input itself. */
html[data-langform-edge-to-edge]:not([data-langform-fullscreen]) .ytSearchboxComponentMweb .ytSearchboxComponentSuggestionsContainer {
  top:calc(48px + var(--lf-safe-top))!important;
  max-height:calc(100svh - 48px - var(--lf-safe-top))!important;
}
html[data-langform-edge-to-edge]:not([data-langform-fullscreen]) ytm-app { padding-top:calc(48px + var(--lf-safe-top))!important; }
html[data-langform-edge-to-edge]:not([data-langform-fullscreen]) ytm-app.header-in-player { padding-top:var(--lf-safe-top)!important; }
html[data-langform-edge-to-edge]:not([data-langform-fullscreen]) .player-container { top:calc(48px + var(--lf-safe-top))!important; }
html[data-langform-edge-to-edge]:not([data-langform-fullscreen]) .player-container.header-in-player { top:var(--lf-safe-top)!important; }
/* YouTube owns the static/in/out scroll states. Only visible fixed chip bars
   need the native top inset; relative bars already inherit it from page flow.
   Hashtag headers use their own relative layout. An out persistent bar remains
   visible at the viewport edge after the topbar scrolls away. */
html[data-langform-edge-to-edge]:not([data-langform-fullscreen]) ytm-rich-grid-renderer:not(.is-hashtag) .rich-grid-sticky-header ytm-feed-filter-chip-bar-renderer:not(.filter-chip-bar-static):not(.filter-chip-bar-out) { top:calc(48px + var(--lf-safe-top))!important; }
html[data-langform-edge-to-edge]:not([data-langform-fullscreen]) ytm-rich-grid-renderer:not(.is-hashtag) .rich-grid-sticky-header.persistent-header ytm-feed-filter-chip-bar-renderer.filter-chip-bar-out:not(.filter-chip-bar-static) { top:var(--lf-safe-top)!important; }
html[data-langform-feed-header]:not([data-langform-fullscreen]) ytm-rich-grid-renderer:not(.is-hashtag) .rich-grid-sticky-header.persistent-header ytm-feed-filter-chip-bar-renderer.filter-chip-bar-out:not(.filter-chip-bar-static) { top:calc(48px + var(--lf-safe-top))!important; }
/* The native card owns its 44pt controls. Keep YouTube's video surface and
   caption layers intact; only its known control chrome disappears in mini. */
html[data-langform-mini-video]:not([data-langform-fullscreen]) #player-control-overlay,
html[data-langform-mini-video]:not([data-langform-fullscreen]) .player-controls-content,
html[data-langform-mini-video]:not([data-langform-fullscreen]) .player-controls-middle,
html[data-langform-mini-video]:not([data-langform-fullscreen]) .player-controls-bottom,
html[data-langform-mini-video]:not([data-langform-fullscreen]) .ytp-chrome-top,
html[data-langform-mini-video]:not([data-langform-fullscreen]) .ytp-chrome-bottom,
html[data-langform-mini-video]:not([data-langform-fullscreen]) .ytp-gradient-top,
html[data-langform-mini-video]:not([data-langform-fullscreen]) .ytp-gradient-bottom,
html[data-langform-mini-video]:not([data-langform-fullscreen]) .ytp-large-play-button { visibility:hidden!important;pointer-events:none!important; }
/* A scrolled Watch can paint its related filter chips above the correctly
   cropped video. Hide only this observed chrome branch, retaining its layout
   and author styles for expand. Opacity also covers visible descendants and
   the branch background; a media/caption descendant protects the whole branch. */
html[data-langform-mini-video]:not([data-langform-fullscreen]) ytm-watch ytm-related-chip-cloud-renderer:not(:has(video,audio,.html5-video-container,.ytp-caption-window-container,.caption-window)),
html[data-langform-mini-video]:not([data-langform-fullscreen]) ytm-watch ytm-related-chip-cloud-renderer:not(:has(video,audio,.html5-video-container,.ytp-caption-window-container,.caption-window)) ytm-chip-cloud-renderer { opacity:0!important;visibility:hidden!important;pointer-events:none!important; }
/* Only our child of the measured mobile HEADER extends its current paint
   into the native safe top. Inherit follows transparent/scroll/theme states
   without inventing a page colour or changing the header/player geometry. */
#langform-safe-top-cover[data-langform-safe-top-cover] { display:none!important; }
html[data-langform-edge-to-edge]:not([data-langform-mini-video]):not([data-langform-fullscreen]) #langform-safe-top-cover[data-langform-safe-top-cover] {
  display:block!important; position:fixed!important; top:0!important; left:0!important;
  width:100%!important; height:var(--lf-safe-top)!important; margin:0!important; padding:0!important;
  border:0!important; box-sizing:border-box!important; background-color:inherit!important;
  pointer-events:none!important; opacity:1!important; z-index:0!important; transform:none!important;
  transition:none!important; animation:none!important;
}
`;
  var feedCover = null, feedSearch = null, feedSearchHeader = null, feedSearchTimer = 0;
  var feedHeaderSelector = 'ytm-mobile-topbar-renderer .mobile-topbar-header,.ytTopBarViewModelHost,ytm-header,ytm-header-bar';
  var feedSearchSelector = '.topbar-button-search-button,.ytTopBarViewModelSearchButton,button[aria-label="Search"],button[aria-label="Suchen"],button[aria-label="In YouTube suchen"],button[aria-label="Bei YouTube suchen"]';
  var feedSearchDiscovery = new win.MutationObserver(function (records) {
    if (feedSearchHeader && !feedSearchHeader.isConnected) { scheduleFeedSearch(); return; }
    if (records.some(function (record) {
      if (record.target.closest && record.target.closest(feedHeaderSelector)) return true;
      return Array.from(record.addedNodes).some(function (node) {
        if (node.nodeType !== 1) return false;
        return node.matches(feedHeaderSelector) || ((!feedSearchHeader || record.target === doc.body || record.target.localName === 'ytm-app') && node.querySelector(feedHeaderSelector));
      });
    })) scheduleFeedSearch();
  });
  var feedSearchOwner = new win.MutationObserver(scheduleFeedSearch);
  function searchBridge() {
    var handlers = win.webkit && win.webkit.messageHandlers;
    return handlers && handlers.langformOpenWatch && !handlers.langformPlayer && handlers.langformNativeSearch;
  }
  function feedHeaderVisible(node) {
    if (!node || !node.isConnected || node.getBoundingClientRect().width <= 0 || node.getBoundingClientRect().height <= 0) return false;
    for (var parent = node; parent; parent = parent.parentElement) {
      var css = win.getComputedStyle(parent);
      if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || css.display === 'none' || css.visibility === 'hidden' || css.opacity === '0') return false;
    }
    return true;
  }
  function removeFeedSearch() { if (feedSearch) feedSearch.remove(); feedSearch = null; }
  function stopFeedSearch() {
    feedSearchDiscovery.disconnect(); feedSearchOwner.disconnect(); feedSearchHeader = null;
    if (feedSearchTimer) win.clearTimeout(feedSearchTimer); feedSearchTimer = 0;
    removeFeedSearch();
  }
  function scheduleFeedSearch() {
    if (!feedSearchTimer && coverAlive) feedSearchTimer = win.setTimeout(function () { feedSearchTimer = 0; updateFeedSearch(); },0);
  }
  function updateFeedSearch() {
    var root = doc.documentElement;
    if (!coverAlive || coverNavigating || !feedHeaderRoute() || !root || root.hasAttribute('data-langform-fullscreen') ||
        win.__langformFeedActive === false || !searchBridge()) { stopFeedSearch(); return; }
    feedSearchDiscovery.observe(doc,{childList:true,subtree:true});
    var headers = Array.from(doc.querySelectorAll(feedHeaderSelector)).filter(function (header) {
      return !header.querySelector(feedHeaderSelector) && feedHeaderVisible(header) &&
        !header.querySelector('video,audio,.html5-video-container,.ytp-caption-window-container,.caption-window');
    });
    feedSearchOwner.disconnect();
    var observed = new Set();
    headers.forEach(function (header) {
      feedSearchOwner.observe(header,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden','disabled','aria-disabled']});
      for (var parent = header.parentElement; parent; parent = parent.parentElement) {
        if (!observed.has(parent)) { observed.add(parent); feedSearchOwner.observe(parent,{attributes:true,attributeFilter:['class','style','hidden','aria-hidden']}); }
      }
    });
    if (headers.length !== 1) { feedSearchHeader = null; removeFeedSearch(); return; }
    var header = headers[0]; feedSearchHeader = header;
    if (Array.from(header.querySelectorAll(feedSearchSelector)).some(function (node) {
      var button = node.matches('button,[role="button"]') ? node : node.querySelector('button,[role="button"]') || node;
      return button !== feedSearch && button.disabled !== true && button.getAttribute('aria-disabled') !== 'true' && feedHeaderVisible(button);
    })) { removeFeedSearch(); return; }
    var slot = header.querySelector('.ytTopBarViewModelTrailingButtons,.mobile-topbar-header-content');
    if (!feedHeaderVisible(slot)) slot = header;
    if (feedSearch && feedSearch.isConnected && feedSearch.parentElement === slot) return;
    removeFeedSearch();
    if (doc.getElementById('langform-feed-search')) return;
    var button = doc.createElement('button'); button.id = 'langform-feed-search'; button.type = 'button';
    button.setAttribute('data-langform-feed-search',''); button.setAttribute('aria-label','In YouTube suchen');
    var svg = doc.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('width','24'); svg.setAttribute('height','24'); svg.setAttribute('aria-hidden','true');
    var path = doc.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d','M10.5 3a7.5 7.5 0 1 0 4.65 13.38L20.77 22 22 20.77l-5.62-5.62A7.5 7.5 0 0 0 10.5 3Zm0 1.75a5.75 5.75 0 1 1 0 11.5 5.75 5.75 0 0 1 0-11.5Z');
    path.setAttribute('fill','currentColor'); svg.appendChild(path); button.appendChild(svg);
    button.addEventListener('click',function (event) {
      var bridge = searchBridge();
      if (button !== feedSearch || !button.isConnected || !feedHeaderVisible(header) || !bridge ||
          !coverAlive || coverNavigating || !feedHeaderRoute() || win.__langformFeedActive === false || root.hasAttribute('data-langform-fullscreen')) return;
      try { bridge.postMessage({action:'open',href:win.location.href}); } catch (_) { return; }
      event.preventDefault(); event.stopImmediatePropagation();
    });
    feedSearch = button; slot.appendChild(button);
  }
  function feedHeaderRoute() {
    var path = win.location.pathname;
    return path === '/' || path === '' || path === '/results' || /^\/feed\/(?:subscriptions|you|library|history|playlists)\/?$/.test(path);
  }
  function updateFeedHeader() {
    var root = doc.documentElement, insets = win.__langformStageInsets;
    if (!root) return;
    var active = coverAlive && !coverNavigating && feedHeaderRoute();
    root.toggleAttribute('data-langform-feed-header', active);
    root.toggleAttribute('data-langform-watch-header', !!(coverAlive && !coverNavigating && watchCoverRoute() &&
      win.webkit && win.webkit.messageHandlers && win.webkit.messageHandlers.langformPlayer));
    updateFeedSearch();
    if (!active || !insets || !Number.isFinite(insets.top) || insets.top <= 0 || root.hasAttribute('data-langform-fullscreen')) {
      if (feedCover) feedCover.remove(); feedCover = null; return;
    }
    if (feedCover && feedCover.isConnected) return;
    // A direct document child has no transformed YouTube header ancestor.
    // It covers only the inset, never the logo, search button or touch surface.
    if (doc.getElementById('langform-feed-safe-top-cover')) return;
    feedCover = doc.createElement('span'); feedCover.id = 'langform-feed-safe-top-cover';
    feedCover.setAttribute('data-langform-feed-safe-top-cover','');
    feedCover.setAttribute('aria-hidden','true'); root.appendChild(feedCover);
  }
  var cover = null, coverAlive = true, coverNavigating = false, coverExpired = false, coverTimer = 0, coverRearm = 0, coverRearmSerial = 0;
  var coverObserver = new win.MutationObserver(function (records) {
    updateSafeTopCover();
    if (records.some(function (record) { return record.attributeName === 'data-langform-fullscreen-exit-context' &&
        record.oldValue !== null && !record.target.hasAttribute('data-langform-fullscreen-exit-context'); })) rearmAfterFullscreenReveal();
  });
  var coverDiscovery = new win.MutationObserver(updateSafeTopCover);
  var coverState = new win.MutationObserver(updateSafeTopCover);
  function stopCoverRearm() {
    if (coverRearm) win.clearTimeout(coverRearm);
    coverRearm = 0; coverRearmSerial++;
  }
  function rearmAfterFullscreenReveal() {
    stopCoverRearm();
    var insets = win.__langformStageInsets;
    if (cover || !coverAlive || coverNavigating || !watchCoverRoute() || !style.isConnected || !doc.documentElement ||
        !insets || insets.nativeMini === true || doc.documentElement.hasAttribute('data-langform-mini-video') ||
        doc.documentElement.hasAttribute('data-langform-fullscreen') ||
        !doc.querySelector('ytm-mobile-topbar-renderer header.mobile-topbar-header')) return;
    // Shipping fullscreen reveals its exit context with a 140ms WAAPI fade.
    // Its completion changes computed opacity without a DOM mutation. Recheck
    // once after that known reveal; never relax the visible-owner guards.
    var token = coverRearmSerial;
    coverRearm = win.setTimeout(function () {
      if (token !== coverRearmSerial) return;
      coverRearm = 0; updateSafeTopCover();
    },200);
  }
  function stopCoverDiscovery() {
    coverDiscovery.disconnect();
    if (coverTimer) win.clearTimeout(coverTimer);
    coverTimer = 0;
  }
  function removeCover() { if (cover) cover.remove(); cover = null; }
  function stopCover() { coverObserver.disconnect(); stopCoverDiscovery(); stopCoverRearm(); removeCover(); }
  function watchCoverRoute() {
    try { var url = new URL(win.location.href); return url.pathname === '/watch' && /^[\w-]{11}$/.test(url.searchParams.get('v') || ''); }
    catch (_) { return false; }
  }
  function coverHeaderEligible(header) {
    var renderer = header.closest('ytm-mobile-topbar-renderer');
    if (!renderer || !header.isConnected || header.querySelector('video,audio,.html5-video-container,.ytp-caption-window-container,.caption-window')) return false;
    if (win.getComputedStyle(renderer).position !== 'fixed') return false;
    // A transform/filter/containment would make a fixed child use the author's
    // local box instead of the viewport. Leave that unknown layout untouched.
    for (var node = header; node; node = node.parentElement) {
      var css = win.getComputedStyle(node);
      if (css.display === 'none' || css.visibility === 'hidden' || css.opacity === '0' ||
          (css.transform && css.transform !== 'none') || (css.filter && css.filter !== 'none') ||
          (css.backdropFilter && css.backdropFilter !== 'none') || (css.perspective && css.perspective !== 'none') ||
          /(?:layout|paint|strict|content)/.test(css.contain || '') || /(?:transform|filter|perspective)/.test(css.willChange || '')) return false;
    }
    return true;
  }
  function updateSafeTopCover() {
    updateFeedHeader();
    coverState.disconnect();
    if (coverAlive && !coverNavigating && feedHeaderRoute() && doc.documentElement)
      coverState.observe(doc.documentElement,{attributes:true,attributeFilter:['data-langform-fullscreen']});
    var insets = win.__langformStageInsets;
    if (!coverAlive || coverNavigating || !watchCoverRoute() || !doc.documentElement || !style.isConnected ||
        !insets || !Number.isFinite(insets.top) || insets.top <= 0 || insets.nativeMini === true ||
        doc.documentElement.hasAttribute('data-langform-mini-video')) { stopCover(); return; }
    coverState.observe(doc.documentElement,{attributes:true,attributeFilter:['data-langform-fullscreen']});
    if (doc.documentElement.hasAttribute('data-langform-fullscreen')) { stopCover(); return; }
    var headers = Array.from(doc.querySelectorAll('ytm-mobile-topbar-renderer header.mobile-topbar-header'));
    coverObserver.disconnect();
    var observed = new Set();
    headers.forEach(function (header) {
      for (var node = header; node; node = node.parentElement) {
        if (observed.has(node)) continue;
        observed.add(node);
        coverObserver.observe(node,{childList:true,attributes:true,attributeOldValue:true,
          attributeFilter:['class','style','hidden','data-langform-fullscreen-exit-context']});
      }
    });
    var eligible = headers.filter(coverHeaderEligible);
    if (eligible.length !== 1) {
      removeCover();
      // Only initial header discovery needs a broad parser/hydration observer.
      // Once the branch exists, direct ancestor/attribute observations suffice.
      if (!headers.length && !coverExpired && !coverTimer) {
        coverDiscovery.observe(doc,{childList:true,subtree:true});
        coverTimer = win.setTimeout(function () { coverExpired = true; stopCoverDiscovery(); },10000);
      } else if (headers.length) stopCoverDiscovery();
      return;
    }
    stopCoverDiscovery();
    stopCoverRearm();
    var header = eligible[0], occupied = doc.getElementById('langform-safe-top-cover');
    if (occupied && occupied !== cover) { removeCover(); return; }
    if (cover && cover.parentElement === header && cover.isConnected) return;
    removeCover();
    cover = doc.createElement('span'); cover.id = 'langform-safe-top-cover';
    cover.setAttribute('data-langform-safe-top-cover',''); cover.setAttribute('aria-hidden','true');
    header.appendChild(cover);
  }
  function retryCover() { coverNavigating = false; coverExpired = false; updateSafeTopCover(); }
  function setStageInsets(insets) {
    if (!insets || typeof insets !== 'object') return false;
    var next = {};
    for (var key of ['top', 'right', 'bottom', 'left']) {
      if (typeof insets[key] !== 'number' || !Number.isFinite(insets[key]) || insets[key] < 0) return false;
      next[key] = insets[key];
    }
    if (insets.nativeMini !== undefined && typeof insets.nativeMini !== 'boolean') return false;
    next.nativeMini = insets.nativeMini === true;
    var previous = win.__langformStageInsets;
    if (!previous || previous.top !== next.top || previous.nativeMini !== next.nativeMini) coverExpired = false;
    win.__langformStageInsets = next;
    if (doc.documentElement) {
      doc.documentElement.style.setProperty('--lf-native-safe-top', next.top + 'px');
      doc.documentElement.toggleAttribute('data-langform-mini-video', next.nativeMini);
    }
    updateSafeTopCover();
    return true;
  }
  win.__langformSetStageInsets = setStageInsets;
  function viewport(meta) {
    var content = meta.getAttribute('content') || 'width=device-width,initial-scale=1';
    var parts = content.split(',').filter(function (part) { return !/^\s*viewport-fit\s*=/i.test(part); });
    var next = parts.join(',') + ',viewport-fit=cover';
    if (content !== next) meta.setAttribute('content', next);
  }
  var metaObserver = new win.MutationObserver(function () { if (watching) viewport(watching); });
  // Hydration may replace the meta element. Only observe direct head children
  // once the parser has created it; feed/comment mutations are irrelevant.
  var headObserver = new win.MutationObserver(configure);
  var discovery = new win.MutationObserver(configure);
  function configure() {
    setStageInsets(win.__langformStageInsets);
    if (doc.documentElement) doc.documentElement.setAttribute('data-langform-edge-to-edge', '');
    if (doc.head) {
      if (!style.isConnected) doc.head.appendChild(style);
      headObserver.disconnect();
      headObserver.observe(doc.head, { childList:true });
      discovery.disconnect();
    }
    updateSafeTopCover();
    var meta = doc.querySelector('meta[name="viewport"]');
    if (!meta) return;
    viewport(meta);
    metaObserver.disconnect(); watching = meta;
    metaObserver.observe(meta, { attributes:true, attributeFilter:['content'] });
  }
  discovery.observe(doc, { childList:true, subtree:true });
  configure();
  doc.addEventListener('DOMContentLoaded', function () {
    if (!doc.querySelector('meta[name="viewport"]') && doc.head) {
      var meta = doc.createElement('meta'); meta.name = 'viewport'; doc.head.appendChild(meta);
    }
    configure(); retryCover();
  }, { once:true });
  win.addEventListener('yt-navigate-start',function () { coverNavigating = true; updateFeedHeader(); coverState.disconnect(); stopCover(); });
  win.addEventListener('yt-navigate-finish',retryCover); win.addEventListener('popstate',retryCover);
  win.addEventListener('langform-feed-visibility',updateFeedSearch);
  win.addEventListener('resize',scheduleFeedSearch);
  win.addEventListener('player-fullscreen-change',function () { updateSafeTopCover(); rearmAfterFullscreenReveal(); });
  win.addEventListener('pagehide', function () { coverAlive = false; updateFeedHeader(); coverState.disconnect(); stopCover(); discovery.disconnect(); headObserver.disconnect(); metaObserver.disconnect(); });
  win.addEventListener('pageshow',function () { coverAlive = true; coverNavigating = false; coverExpired = false; configure(); });
})(typeof window !== 'undefined' ? window : this);
