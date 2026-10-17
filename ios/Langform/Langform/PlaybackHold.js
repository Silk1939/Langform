// Hold an empty side of the picture for temporary 2x. Short taps, controls,
// scrubbing, native card gestures and playback intent remain with their owner.
(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformPlaybackHold) return;
  var doc = win.document, active = true, pending = null, held = null, timer = 0, badge = null, suppress = null;
  function pageInactive() {
    try { var visibility=win.__langformRealVisibility; if (visibility && typeof visibility.inactive==='function') return !!visibility.inactive(); } catch (_) {}
    return !!doc.hidden;
  }
  function realHidden() {
    try { var visibility=win.__langformRealVisibility; if (visibility && typeof visibility.hidden==='function') return !!visibility.hidden(); } catch (_) {}
    return !!doc.hidden;
  }
  var hasPointers = typeof win.PointerEvent === 'function';
  var mediaReason = '', pointReason = '', surfaceReason = '', ownerReason = '';
  var observer = new win.MutationObserver(function () { var owner = held || pending; if (owner && !owns(owner)) end(true,true,'mutation:' + ownerReason); });
  function pageID() {
    try {
      var url = new URL(win.location.href), value = url.searchParams.get('v') || '';
      return url.protocol === 'https:' && /^(m\.|www\.)?youtube\.com$/.test(url.hostname) && url.pathname === '/watch' && /^[A-Za-z0-9_-]{11}$/.test(value) ? value : '';
    } catch (_) { return ''; }
  }
  function media() {
    var id = pageID(), root = doc.getElementById('movie_player'), video = root && root.querySelector('video'), data;
    mediaReason = !active ? 'inactive' : pageInactive() ? 'hidden' : !id ? 'page-id' : !root ? 'missing-root' : !video ? 'missing-video' :
      !video.isConnected ? 'disconnected' : video.controls ? 'native-controls' : video.paused ? 'paused' : video.ended ? 'ended' : video.seeking ? 'seeking' :
      video.error ? 'error' : video.readyState < 2 ? 'not-ready' :
      win.__langformStageInsets && win.__langformStageInsets.nativeMini ? 'native-mini' :
      typeof win.__langformIsNativeDragging === 'function' && win.__langformIsNativeDragging() ? 'native-dragging' :
      typeof win.__langformHasOpenOverlay === 'function' && win.__langformHasOpenOverlay() ? 'open-overlay' :
      video.webkitDisplayingFullscreen || doc.fullscreenElement === video || doc.webkitFullscreenElement === video ? 'native-fullscreen' :
      video.webkitCurrentPlaybackTargetIsWireless || video.remote && video.remote.state === 'connected' ? 'wireless' : '';
    if (mediaReason) return null;
    try { data = root.getVideoData && root.getVideoData(); } catch (_) { mediaReason = 'video-data-error'; return null; }
    mediaReason = !data ? 'missing-data' : data.video_id !== id ? 'video-id' : data.isAd ? 'ad-data' :
      root.classList.contains('ad-showing') || root.classList.contains('ad-interrupting') ? 'ad-class' : '';
    if (mediaReason) return null;
    return { id:id, root:root, video:video, source:video.currentSrc || video.src || '' };
  }
  function owns(owner) {
    var current = media();
    ownerReason = !current ? 'media-' + mediaReason : current.id !== owner.id ? 'id-changed' : current.root !== owner.root ? 'root-changed' :
      current.video !== owner.video ? 'video-changed' : current.source !== owner.source ? 'source-changed' : '';
    return !ownerReason;
  }
  function point(event,owner) {
    pointReason = '';
    if (event.touches) {
      if (event.touches.length !== 1) { pointReason = 'touch-count'; return null; }
      var touch = event.touches[0]; return { x:touch.clientX, y:touch.clientY, pointer:touch.identifier };
    }
    // PointerEvent.button=-1 means no button changed during a move. It is
    // normal for an already admitted contact, not a right-button press. Only
    // its current primary touch/pen with the contact button still down may use
    // this sentinel; starts, hover, chords and foreign pointers stay rejected.
    var unchangedContact = event.type === 'pointermove' && owner && event.button === -1 && event.buttons === 1 &&
      event.pointerId === owner.pointer && event.pointerType === owner.pointerType && /^(touch|pen)$/.test(owner.pointerType);
    if (event.isPrimary === false || event.button && event.button !== 0 && !unchangedContact) { pointReason = event.isPrimary === false ? 'non-primary' : 'button'; return null; }
    return { x:event.clientX, y:event.clientY, pointer:event.pointerId };
  }
  function pictureOwners(current) {
    var shared = current.root.closest('ytm-player,ytd-player') || current.root.closest('#player-container-id');
    return [current.root,shared,doc.getElementById('langform-fullscreen-ui')].filter(function (node,index,list) { return node && list.indexOf(node) === index; });
  }
  function pictureContains(current,target) {
    return !!target && pictureOwners(current).some(function (owner) { return owner.contains(target); });
  }
  function layoutRect(video) {
    try {
      var zoom = win.__langformPlaybackZoom;
      var rect = zoom && typeof zoom.getLayoutRect === 'function' ? zoom.getLayoutRect(video) : null;
      if (rect && Number.isFinite(rect.left) && Number.isFinite(rect.top) &&
          Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 8 && rect.height > 8) {
        return {left:rect.left,top:rect.top,width:rect.width,height:rect.height,
          right:rect.left+rect.width,bottom:rect.top+rect.height};
      }
    } catch (_) {}
    return video.getBoundingClientRect();
  }
  function surface(event,current,p) {
    var target = event.target;
    surfaceReason = '';
    if (!target || !target.closest || target.closest('button,a,input,select,textarea,[role=button],[role=slider],[contenteditable=true],.ytp-chrome-top,.ytp-chrome-bottom,.lf-fs-controls,.lf-fs-speed-panel,.lf-fs-chapter-panel')) { surfaceReason = 'control-target'; return false; }
    // mweb custom controls are a sibling of movie_player, inside the same
    // current ytm-player. Do not mistake its empty overlay for another player.
    if (!pictureContains(current,target)) { surfaceReason = 'target-owner'; return false; }
    var rect = layoutRect(current.video);
    if (rect.width < 100 || rect.height < 100 || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
        p.x < rect.left + 12 || p.x > rect.right - 12 || p.y < rect.top + 44 || p.y > rect.bottom - 44) { surfaceReason = 'picture-bounds'; return false; }
    var fraction = (p.x - rect.left) / rect.width;
    if (!(fraction < 0.4 || fraction > 0.6)) { surfaceReason = 'picture-middle'; return false; }
    return true;
  }
  function clearTimer() { if (timer) win.clearTimeout(timer); timer = 0; }
  function trace(phase,owner,reason,event) {
    // No snapshots, logging or extra DOM work in the normal app. The optional
    // local probe receives bounded state only, never media URLs or account data.
    if (typeof win.__langformPlaybackHoldTrace !== 'function') return;
    try {
      var root = doc.getElementById('movie_player'), video = owner && owner.video || root && root.querySelector('video');
      var data = root && root.getVideoData && root.getVideoData();
      var target = event && event.target && event.target.nodeType ? event.target : owner && owner.target;
      var playerOwner = root && root.closest('ytm-player,ytd-player'), containerOwner = root && root.closest('#player-container-id');
      var container = playerOwner || containerOwner;
      win.__langformPlaybackHoldTrace({ phase:phase, reason:reason || '', event:event && event.type || '', rate:video ? video.playbackRate : 0,
        paused:!!(video && video.paused), seeking:!!(video && video.seeking), ready:video ? video.readyState : 0,
        ended:!!(video && video.ended), controls:!!(video && video.controls), error:!!(video && video.error), hidden:realHidden(),
        data:data && data.video_id || 'none', rootClass:root ? String(root.className).slice(0,100) : 'none',
        targetOwner:!target ? 'none' : root && root.contains(target) ? 'root' : container && container.contains(target) ? 'shared' : 'outside',
        playerContains:!!(target && playerOwner && playerOwner.contains(target)), containerContains:!!(target && containerOwner && containerOwner.contains(target)),
        sourceChanged:!!(owner && video && (video.currentSrc || video.src || '') !== owner.source),
        rootChanged:!!(owner && root !== owner.root), videoChanged:!!(owner && root && root.querySelector('video') !== owner.video) });
    } catch (_) {}
  }
  function hideBadge() { if (badge) badge.remove(); badge = null; }
  function protectSelection(owner) {
    // iOS can start native text selection without dispatching contextmenu,
    // choosing a nearby SVG label instead of the original empty touch target.
    // Protect the accepted contact immediately: waiting for the 350-ms rate
    // change lets WebKit begin its loupe before our hold owns playback speed.
    owner.selectionNodes = pictureOwners(owner);
    owner.selectionNodes.forEach(function (node) { node.setAttribute('data-langform-playback-held',''); });
    owner.selectionStyle = doc.createElement('style'); owner.selectionStyle.id = 'langform-playback-hold-selection-style';
    owner.selectionStyle.textContent = '[data-langform-playback-held],[data-langform-playback-held] *{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}';
    (doc.head || doc.documentElement).appendChild(owner.selectionStyle);
  }
  function unprotectSelection(owner) {
    if (owner.selectionNodes) owner.selectionNodes.forEach(function (node) { node.removeAttribute('data-langform-playback-held'); });
    if (owner.selectionStyle) owner.selectionStyle.remove();
  }
  function showBadge(owner) {
    hideBadge(); badge = doc.createElement('div'); badge.id = 'langform-playback-hold';
    badge.textContent = '2×'; badge.setAttribute('role','status'); badge.setAttribute('aria-live','polite');
    var rect = layoutRect(owner.video);
    badge.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#000b;color:white;border-radius:18px;padding:7px 14px;font:600 14px -apple-system,BlinkMacSystemFont,sans-serif;transform:translateX(-50%)';
    badge.style.left = (rect.left + rect.width / 2) + 'px'; badge.style.top = (rect.top + 12) + 'px';
    (doc.getElementById('langform-fullscreen-ui') || doc.body || doc.documentElement).appendChild(badge);
  }
  function restore(owner,normalRelease) {
    // playbackRate belongs to the physical HTMLMediaElement and survives a
    // src change. Roll back our still-present 2x on that element even if its
    // URL/source already moved; otherwise the next video inherits the hold.
    // A replaced element or intervening manual speed choice owns its own rate.
    if (owner.video.playbackRate === 2) {
      // A deliberate completed hold returns to Normal, as requested for the
      // app gesture. Cancellation/source/lifecycle cleanup preserves the prior
      // intent instead; an intervening manual rate is never overwritten.
      try { owner.video.playbackRate = normalRelease ? 1 : owner.rate; } catch (_) {}
    }
  }
  function end(restoreRate,rememberClick,reason,event) {
    var candidate = pending;
    clearTimer(); observer.disconnect(); pending = null;
    var previous = held; held = null; hideBadge();
    if (candidate) {
      unprotectSelection(candidate);
      trace('cancelled',candidate,reason || 'cancel',event);
    }
    if (previous) {
      unprotectSelection(previous);
      if (restoreRate !== false) restore(previous,!!event && (event.type==='pointerup' || event.type==='touchend'));
      trace('released',previous,reason || 'cancel',event);
      if (rememberClick !== false) suppress = { id:previous.id, until:Date.now() + 700 };
    }
  }
  function begin(event) {
    end(true,false,'new-contact',event); suppress = null;
    if (event.defaultPrevented) { trace('rejected',null,'defaultprevented',event); return; }
    var p = point(event), current = media();
    if (!p) { trace('rejected',current,'point-' + pointReason,event); return; }
    if (!current) { trace('rejected',null,'media-' + mediaReason,event); return; }
    if (!surface(event,current,p)) { trace('rejected',current,'surface-' + surfaceReason,event); return; }
    var rate = Number(current.video.playbackRate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 4) { trace('rejected',current,'rate-rejected',event); return; }
    pending = { id:current.id, root:current.root, video:current.video, source:current.source, rate:rate, x:p.x, y:p.y, pointer:p.pointer, pointerType:event.pointerType || '', target:event.target };
    protectSelection(pending);
    observer.observe(doc.documentElement,{ childList:true, subtree:true, attributes:true, attributeFilter:['class','src','data-langform-mini-video'] });
    var owner = pending;
    trace('candidate',owner,'accepted-pending',event);
    timer = win.setTimeout(function () {
      timer = 0;
      if (pending !== owner || !owns(owner)) { end(true,false,'timer:' + (pending !== owner ? 'candidate-changed' : ownerReason)); return; }
      try { owner.video.playbackRate = 2; } catch (_) { end(true,false,'rate-setter-error'); return; }
      if (owner.video.playbackRate !== 2) { end(true,false,'rate-rejected'); return; }
      pending = null; held = owner; showBadge(owner);
      trace('held',owner,'held');
    }, 350);
    if (!hasPointers) shieldNativeTouchStart(event);
  }
  function shieldNativeTouchStart(event) {
    var owner = held || pending, touches = event.touches;
    if (!owner || event.defaultPrevented || !touches || touches.length !== 1 || !owns(owner) || !pictureContains(owner,event.target) ||
        Math.hypot(touches[0].clientX-owner.x,touches[0].clientY-owner.y) > 10) return;
    // YouTube starts its own 500-ms speedmaster timer on touchstart. Our
    // accepted side contact already owns the 350-ms hold: a second timer may
    // request Play and restore a competing rate after our release. Keep this
    // exact start away from the site's recognizer, while browser scrolling,
    // click synthesis and all same-window gesture/contact observers continue.
    event.stopPropagation();
  }
  function move(event) {
    var owner = held || pending;
    if (!owner) return;
    var p = point(event,owner);
    if (!p) end(true,true,'movement-point-' + pointReason,event);
    else if (p.pointer !== owner.pointer) end(true,true,'movement-pointer-changed',event);
    else if (Math.hypot(p.x - owner.x,p.y - owner.y) > 10) end(true,true,'movement',event);
    else if (!owns(owner)) end(true,true,'movement:' + ownerReason,event);
    // Suppress selection only after the hold owns the gesture, never on tap.
    else if (held && event.cancelable) event.preventDefault();
  }
  function release(event) {
    var owner = held || pending;
    if (!owner) return;
    if (event.pointerId !== undefined && event.pointerId !== owner.pointer) return;
    if (held && event.cancelable) event.preventDefault();
    end(true,true,(held ? 'release:' : 'release-before-hold:') + event.type,event);
  }
  function consumeClick(event) {
    if (!suppress || Date.now() > suppress.until || pageID() !== suppress.id) { suppress = null; return false; }
    var current = media(), p = point(event);
    if (!current || !p || !surface(event,current,p)) return false;
    suppress = null; event.preventDefault(); event.stopImmediatePropagation(); return true;
  }
  win.__langformPlaybackHold = { cancel:function () { end(true,true,'native-cancel'); }, isActive:function () { return !!held; } };
  win.__langformConsumePlaybackHoldClick = consumeClick;
  // Installed before PlayerRect, so a hold's synthetic click cannot toggle its
  // normal player controls. Its explicit hook also protects reinjected pages.
  win.addEventListener('click',consumeClick,true);
  if (hasPointers) {
    win.addEventListener('touchstart',shieldNativeTouchStart,{ capture:true, passive:true });
    win.addEventListener('pointerdown',begin,{ capture:true, passive:true });
    win.addEventListener('pointermove',move,{ capture:true, passive:false });
    ['pointerup','pointercancel','lostpointercapture'].forEach(function (name) { win.addEventListener(name,release,true); });
  } else {
    win.addEventListener('touchstart',begin,{ capture:true, passive:true });
    win.addEventListener('touchmove',move,{ capture:true, passive:false });
    ['touchend','touchcancel'].forEach(function (name) { win.addEventListener(name,release,true); });
  }
  ['contextmenu','selectstart'].forEach(function (name) {
    win.addEventListener(name,function (event) {
      var owner = held || pending;
      if (!owner) return;
      if (!owns(owner)) { end(true,false,'selection:' + ownerReason,event); return; }
      // Do not re-run admission's control-target filter: native selection may
      // target a control inside the same player after a valid empty-side start.
      if (pictureContains(owner,event.target)) { trace('input',owner,name + '-suppressed',event); event.preventDefault(); event.stopImmediatePropagation(); }
      else trace('input',owner,name + '-passed',event);
    },true);
  });
  ['loadstart','emptied','pause','ended','seeking','error'].forEach(function (name) {
    doc.addEventListener(name,function (event) { var owner = held || pending; if (owner && event.target === owner.video) end(true,true,'media-event:' + name,event); },true);
  });
  doc.addEventListener('ratechange',function (event) { if (held && event.target === held.video && held.video.playbackRate !== 2) end(false,true,'media-event:ratechange',event); },true);
  doc.addEventListener('yt-navigate-start',function (event) { end(true,false,'lifecycle:yt-navigate-start',event); suppress = null; });
  ['yt-navigate-finish','state-navigateend','popstate','resize','orientationchange','player-fullscreen-change','blur'].forEach(function (name) { win.addEventListener(name,function (event) { end(true,false,'lifecycle:' + name,event); }); });
  ['visibilitychange','langform-real-visibilitychange'].forEach(function(name){doc.addEventListener(name,function (event) { if (pageInactive()) end(true,false,'lifecycle:hidden',event); });});
  win.addEventListener('pagehide',function (event) { end(true,false,'lifecycle:pagehide',event); suppress = null; active = false; });
  win.addEventListener('pageshow',function () { active = true; });
  // Root replacement/ad state and native Mini updates can arrive without a
  // pointercancel; the observer runs only while a finger owns a candidate.
})(window);
