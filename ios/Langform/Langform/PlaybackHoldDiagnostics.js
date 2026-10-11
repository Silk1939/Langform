// Loaded only for the explicit local Simulator hold probe. No normal UI work.
(function (win) {
  'use strict';
  var doc = win.document, held = 0, released = 0, heldRate = 0, releasedRate = 0, output, timer, samples = 0, pointers = 0, touches = 0, target = '';
  var latest = null, history = [], candidates = 0, rejected = 0, cancelled = 0;
  var heldAt = 0, heldForMs = 0, heldBadgeVisible = false, releaseReason = '', releaseEvent = '';
  function compact(value) { return String(value).replace(/\s/g, '_').slice(0,100); }
  function geometry(node) {
    if (!node) return 'none';
    var box = node.getBoundingClientRect(), css = win.getComputedStyle(node);
    return [box.x,box.y,box.width,box.height].map(function (value) { return Math.round(value); }).join(',')
      + ':' + [css.position,css.top,css.left,css.transform].map(compact).join(',')
      + ':inline=' + [node.style.top,node.style.left,node.style.transform].map(compact).join(',');
  }
  var scrollTopOutput, miniPaintHistory = [];
  function reportScrollTop() {
    if (!doc.documentElement || !doc.body) return;
    if (!scrollTopOutput) {
      scrollTopOutput = doc.createElement('p'); scrollTopOutput.id = 'langform-scroll-top-probe';
      scrollTopOutput.setAttribute('role', 'status');
      scrollTopOutput.style.cssText = 'position:fixed;left:12px;bottom:2px;width:1px;height:1px;overflow:hidden;white-space:nowrap;pointer-events:none;z-index:2147483647;color:transparent;font:1px monospace;margin:0';
      doc.body.appendChild(scrollTopOutput);
    }
    var host = doc.getElementById('langform-fullscreen-ui') || doc.body;
    if (host && scrollTopOutput.parentNode !== host) host.appendChild(scrollTopOutput);
    if (host && host.id === 'langform-fullscreen-ui') scrollTopOutput.removeAttribute('inert');
    var safe = win.__langformStageInsets && win.__langformStageInsets.top || 0;
    function describe(node) {
      var css = win.getComputedStyle(node), r = node.getBoundingClientRect();
      return {tag:node.tagName, cls:String(node.className || '').slice(0,120), rect:[r.x,r.y,r.width,r.height],
        bg:css.backgroundColor, bgImage:css.backgroundImage, pos:css.position, transform:css.transform, z:css.zIndex, opacity:css.opacity,
        visibility:css.visibility, pointerEvents:css.pointerEvents, display:css.display,
        filter:css.filter,backdropFilter:css.backdropFilter,perspective:css.perspective,contain:css.contain,willChange:css.willChange,
        exitContext:node.hasAttribute('data-langform-fullscreen-exit-context'),exitAncestor:node.hasAttribute('data-langform-fullscreen-exit-ancestor'),fullscreenAncestor:node.hasAttribute('data-langform-fullscreen-ancestor'),
        before:(function(){var p=win.getComputedStyle(node,'::before');return {content:p.content,bg:p.backgroundColor,pos:p.position,top:p.top,left:p.left,width:p.width,height:p.height,z:p.zIndex,transform:p.transform};})(),
        base:css.getPropertyValue('--yt-spec-base-background').trim(), general:css.getPropertyValue('--yt-spec-general-background-a').trim(), theme:Array.from(css).filter(function(k){return k.indexOf('--yt')===0;}).slice(0,30).map(function(k){return [k,css.getPropertyValue(k).trim()];})};
    }
    var selectors=['html','body','ytm-app','ytm-header','ytm-header-bar','ytm-mobile-topbar-renderer','.ytTopBarViewModelHost','ytm-watch','#langform-safe-top-cover'];
    var nodes=selectors.flatMap(function(selector){return Array.from(doc.querySelectorAll(selector)).slice(0,3).map(function(node){var row=describe(node);row.selector=selector;return row;});});
    Array.from(doc.querySelectorAll('ytm-mobile-topbar-renderer *,ytm-header *,ytm-header-bar *')).filter(function(n){var r=n.getBoundingClientRect();return r.width>32&&r.height>10&&r.top<=safe+48&&r.bottom>=safe;}).slice(0,18).forEach(function(n){var row=describe(n);row.selector='header-descendant';nodes.push(row);});
    var points=[];
    [Math.max(1,safe/2),safe+20].forEach(function(y){var x=win.innerWidth/2;points.push({x:x,y:y,nodes:doc.elementsFromPoint(x,y).slice(0,6).map(describe)});});
    var href=win.location.pathname+win.location.search;
    var mini=!!(win.__langformStageInsets&&win.__langformStageInsets.nativeMini);
    var fullscreen=doc.documentElement.hasAttribute('data-langform-fullscreen');
    // The native mini crops WebKit's AX tree. Preserve bounded actual DOM
    // observations for inspection after expansion, without assuming its state.
    if (mini) {
      miniPaintHistory.push({sample:samples,href:href,safe:safe,mini:mini,fullscreen:fullscreen,
        coverCount:doc.querySelectorAll('#langform-safe-top-cover').length});
      if (miniPaintHistory.length>8) miniPaintHistory.shift();
    }
    scrollTopOutput.textContent='ScrollTopprobe '+JSON.stringify({sample:samples,href:href,safe:safe,mini:mini,fullscreen:fullscreen,scroll:win.scrollY,dark:doc.documentElement.getAttribute('dark'),nodes:nodes,points:points,miniPaintHistory:miniPaintHistory});
  }
  function report() {
    var root = doc.getElementById('movie_player'), video = root && root.querySelector('video');
    if (!output && doc.body) {
      output = doc.createElement('p'); output.id = 'langform-hold-probe'; output.setAttribute('role', 'status');
      output.style.cssText = 'position:fixed;bottom:20px;left:12px;right:12px;z-index:2147483647;pointer-events:none;color:white;background:#000c;font:12px monospace;padding:6px';
      doc.body.appendChild(output);
    }
    if (output) {
      // Own fullscreen intentionally makes all other body children inert.
      // Keep this opt-in read-only status in the current accessible UI owner.
      var host = doc.getElementById('langform-fullscreen-ui') || doc.body;
      if (host && output.parentNode !== host) host.appendChild(output);
      if (host && host.id === 'langform-fullscreen-ui') output.removeAttribute('inert');
      var rect = video && video.getBoundingClientRect();
      var videoCSS = video && win.getComputedStyle(video);
      var data; try { data = root && root.getVideoData && root.getVideoData(); } catch (_) {}
      var zoomState = null, zoomLayout = null;
      try {
        var zoom = win.__langformPlaybackZoom;
        if (zoom && typeof zoom.getState === 'function') zoomState = zoom.getState();
        if (zoom && video && typeof zoom.getLayoutRect === 'function') zoomLayout = zoom.getLayoutRect(video);
      } catch (_) {}
      output.textContent = 'Holdprobe ready=' + !!(video && !video.paused && video.readyState >= 2)
        + ' paused=' + (video ? video.paused : 'none') + ' sample=' + samples
        + ' time=' + (video ? Number(video.currentTime).toFixed(3) : 0) + ' rate=' + (video ? video.playbackRate : 0) + ' held=' + held + ' heldRate=' + heldRate
        + ' released=' + released + ' releasedRate=' + releasedRate
        + ' heldForMs=' + heldForMs + ' heldBadgeVisible=' + heldBadgeVisible + ' releaseReason=' + compact(releaseReason) + ' releaseEvent=' + compact(releaseEvent)
        + ' x=' + (rect ? Math.round(rect.left) : 0) + ' y=' + (rect ? Math.round(rect.top) : 0)
        + ' w=' + (rect ? Math.round(rect.width) : 0) + ' h=' + (rect ? Math.round(rect.height) : 0)
        + ' videoCSS=' + (videoCSS ? [videoCSS.position,videoCSS.top,videoCSS.left,videoCSS.transform,videoCSS.objectFit,videoCSS.objectPosition].map(compact).join(',') : 'none')
        + ' videoInline=' + (video ? [video.style.top,video.style.left,video.style.transform].map(compact).join(',') : 'none')
        + ' zoom=' + (zoomState ? Number(zoomState.scale).toFixed(3) : 'none')
        + ' zoomX=' + (zoomState ? Number(zoomState.x).toFixed(1) : 0) + ' zoomY=' + (zoomState ? Number(zoomState.y).toFixed(1) : 0)
        + ' zoomGesturing=' + !!(zoomState && zoomState.gesturing)
        + ' zoomLayout=' + (zoomLayout ? [zoomLayout.left,zoomLayout.top,zoomLayout.width,zoomLayout.height].map(function (value) { return Math.round(value); }).join(',') : 'none')
        + ' mediaContainer=' + geometry(root && root.querySelector('.html5-video-container')) + ' playerRoot=' + geometry(root)
        + ' playerParent=' + geometry(root && root.parentElement)
        + ' pointers=' + pointers + ' touches=' + touches + ' target=' + target
        + ' data=' + (data && data.video_id || 'none') + ' mini=' + !!(win.__langformStageInsets && win.__langformStageInsets.nativeMini)
        + ' overlay=' + !!(win.__langformHasOpenOverlay && win.__langformHasOpenOverlay())
        + ' dragging=' + !!(win.__langformIsNativeDragging && win.__langformIsNativeDragging())
        + ' candidates=' + candidates + ' rejected=' + rejected + ' cancelled=' + cancelled
        + (latest ? ' last=' + compact(latest.phase) + ':' + compact(latest.reason) + ' event=' + compact(latest.event)
          + ' atPaused=' + latest.paused + ' atSeeking=' + latest.seeking + ' atReady=' + latest.ready + ' atEnded=' + latest.ended
          + ' atControls=' + latest.controls + ' atError=' + latest.error + ' atHidden=' + latest.hidden
          + ' atData=' + compact(latest.data) + ' atRoot=' + compact(latest.rootClass) + ' targetOwner=' + compact(latest.targetOwner)
          + ' playerContains=' + latest.playerContains + ' containerContains=' + latest.containerContains
          + ' sourceChanged=' + latest.sourceChanged + ' rootChanged=' + latest.rootChanged + ' videoChanged=' + latest.videoChanged
          + ' trace=' + history.join('>') : ' last=none');
    }
    reportScrollTop();
    if (++samples < 720) timer = win.setTimeout(report, 250);
  }
  win.__langformPlaybackHoldTrace = function (value) {
    if (!value || typeof value.phase !== 'string') return;
    latest = value;
    history.push(compact(value.phase) + ':' + compact(value.reason));
    if (history.length > 5) history.shift();
    if (value.phase === 'candidate') candidates++;
    if (value.phase === 'rejected') rejected++;
    if (value.phase === 'cancelled') cancelled++;
    if (value.phase === 'held') {
      held++; heldRate = value.rate; heldAt = Date.now();
      var badge = doc.getElementById('langform-playback-hold');
      var style = badge && win.getComputedStyle(badge), rect = badge && badge.getBoundingClientRect();
      heldBadgeVisible = !!(badge && style && style.visibility === 'visible' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0);
    }
    if (value.phase === 'released') { released++; releasedRate = value.rate; heldForMs = Math.max(0,Date.now() - heldAt); releaseReason = value.reason; releaseEvent = value.event; }
    if (timer) win.clearTimeout(timer);
    report();
  };
  ['pointerdown', 'touchstart'].forEach(function (name) {
    win.addEventListener(name, function (event) {
      if (name === 'pointerdown') pointers++; else touches++;
      var role = event.target.closest && event.target.closest('[role]');
      target = event.target.tagName + ':' + String(event.target.className || '').replace(/\s/g, '_').slice(0, 100) + ':' + (role && role.getAttribute('role') || 'none');
      if (timer) win.clearTimeout(timer);
      report();
    }, { capture: true, passive: true });
  });
  doc.addEventListener('DOMContentLoaded', report, { once: true });
  win.addEventListener('pagehide', function () { if (timer) win.clearTimeout(timer); });
})(window);
