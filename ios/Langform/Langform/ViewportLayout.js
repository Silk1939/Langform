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
html[data-langform-edge-to-edge]:not([data-langform-fullscreen]) ytm-header:not(.out),
html[data-langform-edge-to-edge]:not([data-langform-fullscreen]) ytm-header-bar:not(.out),
html[data-langform-edge-to-edge]:not([data-langform-fullscreen]) ytm-mobile-topbar-renderer:not(.out),
html[data-langform-edge-to-edge]:not([data-langform-fullscreen]) .ytTopBarViewModelHost:not(.out) { top:var(--lf-safe-top)!important; }
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
    coverState.disconnect();
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
  win.addEventListener('yt-navigate-start',function () { coverNavigating = true; coverState.disconnect(); stopCover(); });
  win.addEventListener('yt-navigate-finish',retryCover); win.addEventListener('popstate',retryCover);
  win.addEventListener('player-fullscreen-change',function () { updateSafeTopCover(); rearmAfterFullscreenReveal(); });
  win.addEventListener('pagehide', function () { coverAlive = false; coverState.disconnect(); stopCover(); discovery.disconnect(); headObserver.disconnect(); metaObserver.disconnect(); });
  win.addEventListener('pageshow',function () { coverAlive = true; coverNavigating = false; coverExpired = false; configure(); });
})(typeof window !== 'undefined' ? window : this);
