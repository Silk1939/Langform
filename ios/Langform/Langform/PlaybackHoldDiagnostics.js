// Loaded only for the explicit local Simulator hold probe. No normal UI work.
(function (win) {
  'use strict';
  var doc = win.document, held = 0, released = 0, heldRate = 0, releasedRate = 0, output, timer, samples = 0, pointers = 0, touches = 0, target = '';
  var latest = null, history = [], candidates = 0, rejected = 0, cancelled = 0;
  var reportedRect = null, reportedCount = 0;
  var autonavButtons = '', autonavPaths = '';
  var settingsTrace=[];
  win.__langformPlayerSettingsTrace=function(value){
    if(!value || !/^[a-z-]{1,32}$/.test(value.phase || ''))return;
    var row={phase:value.phase,view:/^(root|quality|speed|captions|none)$/.test(value.view || '')?value.view:'none',
      key:/^(quality|speed|captions|auto|tiny|small|medium|large|hd720|hd1080|hd1440|hd2160|highres|none|true|false|[0-9.]{1,5})$/.test(value.key || '')?value.key:'none',
      opened:value.opened===true,valid:value.valid===true,sourceChanged:value.sourceChanged===true};
    settingsTrace.push(JSON.stringify(row));if(settingsTrace.length>12)settingsTrace.shift();
  };
  function settingsState(root) {
    var result = { qualityActual:'unknown', qualityMode:'unknown', captionState:'unknown', captionAvailable:'unknown' };
    try { var quality = root && root.getPlaybackQuality && root.getPlaybackQuality(); if (/^(tiny|small|medium|large|hd720|hd1080|hd1440|hd2160|highres|auto)$/.test(quality || '')) result.qualityActual = quality; } catch (_) {}
    try { var status = win.__langformGetQualityStatus && win.__langformGetQualityStatus(); if (status && /^(manual|adaptive)$/.test(status.mode)) result.qualityMode = status.mode; } catch (_) {}
    try { var captions = root && root.isSubtitlesOn && root.isSubtitlesOn(); if (typeof captions === 'boolean') result.captionState = captions; } catch (_) {}
    try { var options = root && root.getOptions && root.getOptions('captions'); if (Array.isArray(options)) result.captionAvailable = options.indexOf('track') >= 0; } catch (_) {}
    return result;
  }
  function settingsOriginalSnapshot(root) {
    var owner = root && (root.closest('ytm-player,ytd-player') || root.closest('#player-container-id') || root);
    function tag(node) { return node && /^[A-Z0-9-]{1,64}$/.test(node.tagName || '') ? node.tagName : 'none'; }
    function classes(node) {
      var value = node && node.className;
      if (value && typeof value.baseVal === 'string') value = value.baseVal;
      return String(value || '').split(/\s+/).filter(function (part) { return /^[A-Za-z0-9_-]{1,64}$/.test(part); }).slice(0,4).join('.');
    }
    function rect(node) {
      try { var box = node.getBoundingClientRect(); return [box.left,box.top,box.width,box.height].map(function (v) { return Number.isFinite(v) && Math.abs(v)<100000 ? Math.round(v) : 0; }); }
      catch (_) { return null; }
    }
    return Array.from(doc.querySelectorAll('player-autonav-toggle,.ytp-autonav-toggle-button')).slice(0,8).map(function (node) {
      var button = node.matches('button,.ytp-autonav-toggle-button') ? node : node.querySelector('button');
      var pressed = button && (button.getAttribute('aria-pressed') || button.getAttribute('aria-checked'));
      var path = [], current = node;
      for (var i=0; current && i<7; i++,current=current.parentElement) path.push({tag:tag(current),classes:classes(current)});
      return {tag:tag(node),classes:classes(node),buttonTag:tag(button),pressed:/^(true|false)$/.test(pressed || '') ? pressed : 'unknown',
        disabled:!!(button && (button.disabled || button.getAttribute('aria-disabled')==='true')),rect:rect(node),buttonRect:button ? rect(button) : null,
        ownerContains:!!(owner && owner.contains(node)),currentRoot:!!(root && root.contains(node)),hostTag:tag(owner),ancestors:path};
    });
  }
  function settingsRevealSnapshot(root) {
    var owner = root && (root.closest('ytm-player,ytd-player') || root.closest('#player-container-id') || root);
    function tag(node) { return node && /^[A-Z0-9-]{1,64}$/.test(node.tagName || '') ? node.tagName : 'none'; }
    function classes(node) {
      var value=node && node.className;
      if(value && typeof value.baseVal==='string')value=value.baseVal;
      return String(value || '').split(/\s+/).filter(function(part){return /^[A-Za-z0-9_-]{1,64}$/.test(part);}).slice(0,4).join('.');
    }
    function booleanAttribute(node,name) { var value=node && node.getAttribute(name);return /^(true|false)$/.test(value || '')?value:'unknown'; }
    function revealIntent(node) {
      var value=node.getAttribute('aria-label');
      if(value==='Show player controls' || value==='Steuerelemente des Videoplayers anzeigen')return 'show';
      if(value==='Hide player controls' || value==='Steuerelemente des Videoplayers ausblenden')return 'hide';
      return 'other';
    }
    var watchNext={available:!!(root && typeof root.getWatchNextResponse==='function'),matchingVideo:false,complete:false,togglePresent:false,overlayAutoplay:false,nextAutoplay:false,enabled:'unknown'};
    try {
      var expected=new URL(win.location.href).searchParams.get('v'),info=root && root.getVideoData && root.getVideoData();
      // Inspect only this current player's direct public response fields.
      // Never serialize the response or fall back to stale initial page data.
      if(watchNext.available && win.location.pathname==='/watch' && expected && info && info.video_id===expected){
        var response=root.getWatchNextResponse(),endpoint=response && response.currentVideoEndpoint;
        watchNext.matchingVideo=!!(endpoint && endpoint.watchEndpoint && endpoint.watchEndpoint.videoId===expected);
        if(watchNext.matchingVideo){
          var next=response.contents && response.contents.singleColumnWatchNextResults,overlay=response.playerOverlays && response.playerOverlays.playerOverlayRenderer;
          var results=next && next.results && next.results.results,toggle=overlay && overlay.autonavToggle && overlay.autonavToggle.autoplaySwitchButtonRenderer;
          watchNext.complete=!!(results && Array.isArray(results.contents) && overlay && typeof overlay==='object' && !Array.isArray(overlay));
          watchNext.togglePresent=!!(toggle && typeof toggle==='object' && !Array.isArray(toggle));
          watchNext.overlayAutoplay=!!(overlay && overlay.autoplay && typeof overlay.autoplay==='object');
          watchNext.nextAutoplay=!!(next && next.autoplay && typeof next.autoplay==='object');
          if(watchNext.togglePresent && typeof toggle.enabled==='boolean')watchNext.enabled=toggle.enabled;
        }
      }
    } catch (_) {}
    var overlay=owner && owner.querySelector('#player-control-overlay');
    var candidates=owner ? Array.from(owner.querySelectorAll('button,[role="switch"]')).filter(function(node){return !node.closest('.lf-player-settings') && /autoplay|automatische wiedergabe/i.test(node.getAttribute('aria-label') || '');}).slice(0,4) : [];
    var states={'Autoplay wird eingeschaltet':'pending','Autoplay einschalten':'enable','Autoplay an':'on','Autoplay aus':'off','Autoplay aktuell nicht verfügbar':'unavailable'};
    return {hostTag:tag(owner),watchNext:watchNext,overlay:overlay?{tag:tag(overlay),classes:classes(overlay),ariaHidden:booleanAttribute(overlay,'aria-hidden')}:null,
      toggleCounts:{owner:owner?Math.min(4,owner.querySelectorAll('player-autonav-toggle').length):0,document:Math.min(4,doc.querySelectorAll('player-autonav-toggle').length)},
      candidates:candidates.map(function(node){var role=node.getAttribute('role');return {tag:tag(node),classes:classes(node),role:/^(button|switch)$/.test(role || '')?role:'none',pressed:booleanAttribute(node,'aria-pressed'),checked:booleanAttribute(node,'aria-checked'),disabled:!!(node.disabled || node.getAttribute('aria-disabled')==='true'),labelMatched:true};}),
      controls:Array.from(doc.querySelectorAll('#player-controls-a11y-toggle')).slice(0,4).map(function(node){
      var path=[],current=node.parentElement;
      for(var i=0;current && i<4;i++,current=current.parentElement)path.push({tag:tag(current),classes:classes(current)});
      return {tag:tag(node),intent:revealIntent(node),disabled:!!(node.disabled || node.getAttribute('aria-disabled')==='true'),
        ownerContains:!!(owner && owner.contains(node)),currentRoot:!!(root && root.contains(node)),ancestors:path};
    }),own:Array.from(doc.querySelectorAll('.lf-player-settings .lf-autoplay-switch')).slice(0,2).map(function(node){
      var label=node.getAttribute('aria-label'),checked=node.getAttribute('aria-checked');
      return {state:Object.prototype.hasOwnProperty.call(states,label)?states[label]:'unknown',
        checked:/^(true|false)$/.test(checked || '')?checked:'unknown',disabled:!!(node.disabled || node.getAttribute('aria-disabled')==='true')};
    })};
  }
  var mediaEvents = [];
  var verboseInputs = win.__langformGestureInputProbe === true, gestureInputs = [], swipeTrace = [], replayTrace = [];
  if (verboseInputs) win.__langformReplayDiagnostic = function (value) {
    if (!value || typeof value!=='object') return;
    // Copy only known own primitive values. Never inspect DOM, serialize a
    // provider payload, invoke an accessor, or retain private labels/URLs.
    function field(key) { var item=Object.getOwnPropertyDescriptor(value,key);return item && Object.prototype.hasOwnProperty.call(item,'value') ? item.value : undefined; }
    var phase=field('phase');
    if (typeof phase!=='string' || !/^(start|target|control|candidates|cancel)$/.test(phase)) return;
    var row={phase:phase},result=field('result'),tag=field('tag'),nodeRole=field('nodeRole');
    if (typeof result==='string' && /^(initial|running|target|disabled|hidden|inert|display|visibility|opacity|available|clicked)$/.test(result)) row.result=result;
    if (typeof tag==='string' && /^(A|BUTTON|DIV|SPAN|VIDEO|INPUT|YTM-PLAYER|YTD-PLAYER|YTM-CUSTOM-CONTROL)$/.test(tag)) row.tag=tag;
    if (typeof nodeRole==='string' && /^(control|player|controls-content|control-overlay|endscreen-container|endscreen-body|endscreen-buttons|other)$/.test(nodeRole)) row.nodeRole=nodeRole;
    ['matched','ended','initial','nativeMini','miniMarker','navComplete','navPresented','navMatches','sourceMatches','owner','beforeMini','afterMini','controlVisible','rootBranch'].forEach(function (key) { var item=field(key);if(typeof item==='boolean')row[key]=item; });
    ['count','rawCount'].forEach(function (key) { var item=field(key);if(Number.isInteger(item) && item>=0 && item<=8)row[key]=item; });
    replayTrace.push(JSON.stringify(row));if(replayTrace.length>12)replayTrace.shift();
  };
  if (verboseInputs) win.__langformPlaybackSwipeTrace = function (value) {
    if (!value || typeof value.phase !== 'string') return;
    // A navigation CustomEvent.detail may be the complete YouTube response.
    // Never walk/serialize that object, call its toJSON, or copy unknown keys.
    // Keep only bounded primitive gesture facts so AX labels stay responsive.
    var row = {};
    ['phase','reason','event','pointerType'].forEach(function (key) {
      if (typeof value[key] !== 'string') return;
      var token = value[key].slice(0,80);
      row[key] = /^[A-Za-z0-9_.:-]*$/.test(token) ? token : 'invalid';
    });
    ['at','pointer','detail','x','y','elapsed','gap','side','left','top','width','height','amount','contact'].forEach(function (key) {
      if (Number.isFinite(value[key])) row[key] = value[key];
    });
    ['candidate','lastTap','secondTap','primary','prevented','trusted','previous','cancelled','moved','second','activeHold','control'].forEach(function (key) {
      if (typeof value[key] === 'boolean') row[key] = value[key];
    });
    var serialized = JSON.stringify(row), keys = Object.keys(row);
    // Prune optional tail facts instead of truncating JSON mid-record. Twelve
    // 480-character rows plus separators stay strictly below the 6k budget.
    while (serialized.length > 480 && keys.length > 4) { delete row[keys.pop()]; serialized = JSON.stringify(row); }
    swipeTrace.push(serialized);
    if (swipeTrace.length > 12) swipeTrace.shift();
  };
  if (verboseInputs) ['pointerdown','pointerup','pointercancel','lostpointercapture','touchstart','touchend','touchcancel','click','dblclick','tap'].forEach(function (name) {
    win.addEventListener(name,function (event) {
      var root = doc.getElementById('movie_player'), ui = doc.getElementById('langform-fullscreen-ui'), target = event.target;
      var host = root && (root.closest('ytm-player,ytd-player') || root.closest('#player-container-id') || root);
      if (!host || !target || !(host.contains(target) || ui && ui.contains(target))) return;
      gestureInputs.push([Math.round(win.performance.now()),name,event.pointerType || '',event.isPrimary,event.button,event.detail,event.isTrusted,event.defaultPrevented,
        event.touches ? event.touches.length : '',event.sourceCapabilities ? event.sourceCapabilities.firesTouchEvents : '',target.tagName,
        Math.round(event.clientX || event.changedTouches && event.changedTouches[0] && event.changedTouches[0].clientX || 0),
        Math.round(event.clientY || event.changedTouches && event.changedTouches[0] && event.changedTouches[0].clientY || 0)].join(':'));
      if (gestureInputs.length > 16) gestureInputs.shift();
    },{capture:true,passive:true});
  });
  var audioEvents = [], audioOwner = null, audioMedia = 0, audioSource = 0;
  function audioState(root, video) {
    var value = {apiMuted:'unknown',apiVolume:-1,audioDecoded:-1,audioTracks:-1,audioEnabled:-1,audioSession:'unknown',audioSessionType:'unknown'};
    if (!video) return value;
    try { if (typeof root.isMuted === 'function') { var muted = root.isMuted(); if (typeof muted === 'boolean') value.apiMuted = muted; } } catch (_) {}
    try { if (typeof root.getVolume === 'function') { var volume = root.getVolume(); if (Number.isFinite(volume) && volume >= 0 && volume <= 100) value.apiVolume = volume; } } catch (_) {}
    try { var decoded = video.webkitAudioDecodedByteCount; if (Number.isFinite(decoded) && decoded >= 0) value.audioDecoded = decoded; } catch (_) {}
    try {
      var tracks = video.audioTracks;
      if (tracks && Number.isInteger(tracks.length) && tracks.length >= 0 && tracks.length <= 32) {
        value.audioTracks = tracks.length; value.audioEnabled = 0;
        for (var i = 0; i < tracks.length; i++) if (tracks[i].enabled) value.audioEnabled++;
      }
    } catch (_) {}
    try {
      var session = win.navigator.audioSession;
      if (session && ['inactive','active','interrupted'].indexOf(session.state) >= 0) value.audioSession = session.state;
      if (session && ['auto','playback','ambient','transient','transient-solo','play-and-record'].indexOf(session.type) >= 0) value.audioSessionType = session.type;
    } catch (_) {}
    return value;
  }
  function noteAudioEvent(event) {
    var root = doc.getElementById('movie_player'), video = root && root.querySelector('video');
    if (!video || event.target !== video) return;
    var state = audioState(root,video);
    audioEvents.push([Math.round(win.performance.now()),event.type,Number(video.currentTime).toFixed(3),video.paused,video.muted,
      video.volume,video.playbackRate,state.apiMuted,state.apiVolume,state.audioDecoded,state.audioSession].join(':'));
    if (audioEvents.length > 20) audioEvents.shift();
  }
  if (verboseInputs) ['play','playing','pause','volumechange','ratechange','seeking','seeked','waiting','stalled','canplay','emptied','error'].forEach(function (name) {
    doc.addEventListener(name,noteAudioEvent,{capture:true,passive:true});
  });
  function noteMediaEvent(event) {
    var root = doc.getElementById('movie_player'), video = root && root.querySelector('video');
    if (!video || !event.target) return;
    var host = root.closest('ytm-player,ytd-player') || root.closest('#player-container-id') || root;
    var ui = doc.getElementById('langform-fullscreen-ui');
    if (event.type === 'click' ? !host.contains(event.target) && !(ui && ui.contains(event.target)) : event.target !== video) return;
    mediaEvents.push([Math.round(win.performance.now()),event.type,Number(video.currentTime).toFixed(3),video.paused,video.ended,
      event.defaultPrevented,event.isTrusted,compact(event.target.tagName + ':' + event.target.className)].join(':'));
    if (mediaEvents.length > 14) mediaEvents.shift();
  }
  ['click','play','playing','pause','seeking','seeked','ended'].forEach(function (name) {
    doc.addEventListener(name,noteMediaEvent,{capture:true,passive:true});
  });
  win.__langformPlayerRectDiagnostic = function (value) {
    reportedRect = value; reportedCount++;
  };
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
      // Keep AX diagnostics readable without covering real Fullscreen controls.
      // A long status label otherwise occupies most of the landscape AX surface.
      output.style.cssText = 'position:fixed;bottom:20px;left:12px;width:1px;height:1px;overflow:hidden;white-space:nowrap;z-index:2147483647;pointer-events:none;color:transparent;font:1px monospace;margin:0';
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
      var ownUI = doc.getElementById('langform-fullscreen-ui');
      var data; try { data = root && root.getVideoData && root.getVideoData(); } catch (_) {}
      var settings = settingsState(root);
      var audio = audioState(root,video), source = video && String(video.currentSrc || video.src || '');
      if (video && (!audioOwner || audioOwner.root !== root || audioOwner.video !== video || audioOwner.source !== source)) {
        if (!audioOwner || audioOwner.root !== root || audioOwner.video !== video) audioMedia++;
        audioSource++; audioOwner = {root:root,video:video,source:source};
      }
      var zoomState = null, zoomLayout = null, zoomDiagnostics = [];
      try {
        var zoom = win.__langformPlaybackZoom;
        if (zoom && typeof zoom.getState === 'function') zoomState = zoom.getState();
        if (zoom && video && typeof zoom.getLayoutRect === 'function') zoomLayout = zoom.getLayoutRect(video);
        if (win.__langformFullscreenDiagnostics === true && zoom && typeof zoom.getDiagnostics === 'function') zoomDiagnostics = zoom.getDiagnostics().slice(-16);
      } catch (_) {}
      if (video && root) {
        var nextButtons = Array.from(doc.querySelectorAll('button,[role="button"]')).filter(function (node) {
          return /cancel|abbrechen/i.test(String(node.getAttribute('aria-label') || '') + ' ' + String(node.textContent || ''));
        });
        if (nextButtons.length) autonavButtons = nextButtons.map(function (node) {
          return compact(node.tagName + ':' + (node.getAttribute('aria-label') || node.textContent) + ':' + node.className);
        }).join('|');
        if (nextButtons.length) autonavPaths = nextButtons.map(function (node) {
          var parts = [], current = node;
          for (var i = 0; current && i < 7; i++, current = current.parentElement) {
            parts.push(current.tagName + '.' + String(current.className || '').trim().replace(/\s+/g, '.'));
          }
          return parts.join('>') + ':insideRoot=' + root.contains(node);
        }).join('|');
      }
      output.textContent = 'Holdprobe ready=' + !!(video && !video.paused && video.readyState >= 2)
        + ' ad=' + !!(root && (data && data.isAd || root.classList.contains('ad-showing') || root.classList.contains('ad-interrupting')))
        + ' paused=' + (video ? video.paused : 'none') + ' seeking=' + (video ? video.seeking : 'none') + ' sample=' + samples
        + ' ended=' + (video ? video.ended : 'none') + ' duration=' + (video ? Number(video.duration).toFixed(3) : 0)
        + ' mediaReady=' + (video ? video.readyState : 0) + ' mediaError=' + (video && video.error ? video.error.code : 0)
        + ' muted=' + (video ? video.muted : 'none') + ' volume=' + (video ? video.volume : 'none')
        + ' apiMuted=' + audio.apiMuted + ' apiVolume=' + audio.apiVolume
        + ' audioDecoded=' + audio.audioDecoded + ' audioTracks=' + audio.audioTracks + ' audioEnabled=' + audio.audioEnabled
        + ' audioSession=' + audio.audioSession + ' audioSessionType=' + audio.audioSessionType
        + ' audioMedia=' + audioMedia + ' audioSource=' + audioSource + ' audioEvents=' + audioEvents.join('>')
        + ' sourceKind=' + (!source ? 'none' : /^blob:/i.test(source) ? 'blob' : /^https:/i.test(source) ? 'https' : 'other')
        + ' autonavState=' + (data && Number.isInteger(data.autonavState) && data.autonavState >= 0 && data.autonavState <= 3 ? data.autonavState : 'unknown')
        + ' autonavPreference=' + (data && data.autoplaySwitchButtonRenderer && typeof data.autoplaySwitchButtonRenderer.enabled === 'boolean' ? data.autoplaySwitchButtonRenderer.enabled : 'unknown')
        + ' autonavSetter=' + !!(root && typeof root.setAutonavState === 'function')
        + ' qualityActual=' + settings.qualityActual + ' qualityMode=' + settings.qualityMode
        + ' captionState=' + settings.captionState + ' captionAvailable=' + settings.captionAvailable
        + ' settingsTrace=' + settingsTrace.join('>')
        + ' gestureInputs=' + gestureInputs.join('>') + ' swipeTrace=' + swipeTrace.join('>') + ' replayTrace=' + replayTrace.join('>')
        + ' reportedCount=' + reportedCount + ' reportedID=' + (reportedRect ? reportedRect.playerVideoID : 'none')
        + ' reportedState=' + (reportedRect ? reportedRect.playbackState : 'none')
        + ' reportedX=' + (reportedRect ? reportedRect.x : 'none') + ' reportedY=' + (reportedRect ? reportedRect.y : 'none')
        + ' reportedW=' + (reportedRect ? reportedRect.width : 'none') + ' reportedH=' + (reportedRect ? reportedRect.height : 'none')
        + ' autonavButtons=' + (autonavButtons || 'none')
        + ' autonavPaths=' + (autonavPaths || 'none')
        + ' settingsOriginals=' + JSON.stringify(settingsOriginalSnapshot(root))
        + ' settingsReveal=' + JSON.stringify(settingsRevealSnapshot(root))
        + ' mediaEvents=' + mediaEvents.join('>')
        + ' windowW=' + win.innerWidth + ' windowH=' + win.innerHeight
        + ' visualW=' + (win.visualViewport ? win.visualViewport.width : 'none') + ' visualH=' + (win.visualViewport ? win.visualViewport.height : 'none')
        + ' fsUI=' + geometry(ownUI) + ' fsCenter=' + geometry(ownUI && ownUI.querySelector('.lf-fs-center'))
        + ' fsStage=' + (!ownUI ? 'none' : ownUI.hasAttribute('data-exiting') ? 'exiting' : ownUI.hasAttribute('data-entering') ? 'entering' : 'open')
        + ' fsInert=' + (ownUI ? !!(ownUI.inert || ownUI.hasAttribute('inert')) : 'none')
        + ' bodyBox=' + geometry(doc.body)
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
        + ' zoomTrace=' + JSON.stringify(zoomDiagnostics)
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
    // Explicit diagnostics only. Natural autoplay can include ads longer than
    // three minutes; keep the evidence fresh through the bounded450s UI run.
    // Periodic sampling and every retained event history remain bounded.
    if (++samples < 2400) timer = win.setTimeout(report, 250);
  }
  function deferReport() {
    if (timer) win.clearTimeout(timer);
    timer = win.setTimeout(function () { timer = 0; report(); },0);
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
    // Candidate/input snapshots must not force page layout ahead of the real
    // Hold timer. Capture actual held/released evidence after that transition.
    if (value.phase === 'held' || value.phase === 'released') {
      if (timer) win.clearTimeout(timer);
      report();
    } else deferReport();
  };
  ['pointerdown', 'touchstart'].forEach(function (name) {
    win.addEventListener(name, function (event) {
      if (name === 'pointerdown') pointers++; else touches++;
      var role = event.target.closest && event.target.closest('[role]');
      target = event.target.tagName + ':' + String(event.target.className || '').replace(/\s/g, '_').slice(0, 100) + ':' + (role && role.getAttribute('role') || 'none');
      deferReport();
    }, { capture: true, passive: true });
  });
  doc.addEventListener('DOMContentLoaded', report, { once: true });
  win.addEventListener('pagehide', function () { if (timer) win.clearTimeout(timer); });
})(window);

// Optional comment-structure probe. Only the explicit native hold-diagnostic
// bundle can load this file; this additional flag avoids scans in normal hold
// runs. Never export text, aria labels, links, source IDs or account data.
(function (win) {
  'use strict';
  if (!win || win.__langformCommentsStructureProbe !== true || !win.document) return;
  var doc = win.document, output = null, timers = [], samples = 0, alive = true, reason = 'startup', releasePoint = null, gestureTrace = [];
  var match = /comment|engagement|sheet|panel-container/i;
  function classes(node) {
    return String(node.className && (node.className.baseVal || node.className) || '').split(/\s+/).filter(function (value) { return /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(value); }).slice(0,8);
  }
  win.__langformCommentsGestureTrace = function(value) {
    if (!alive || !value || !/^[a-z-]{1,24}$/.test(value.phase || '') || !/^[a-z-]{1,24}$/.test(value.reason || '')) return;
    function path(node) {
      var result=[];
      for (var depth=0;node && node.nodeType===1 && depth<7;node=node.parentElement,depth++) {
        var role=node.getAttribute('role');result.push({tag:node.tagName,classes:classes(node),role:/^(button|link|textbox|dialog|heading)$/.test(role || '')?role:'none',editable:node.hasAttribute('contenteditable')?(node.getAttribute('contenteditable')==='false'?'false':'true'):'none'});
      }
      return result;
    }
    function number(value){return Number.isFinite(value) && Math.abs(value)<100000?Math.round(value*10)/10:0;}
    gestureTrace.push({phase:value.phase,reason:value.reason,event:/^(pointerdown|touchstart|pointermove|touchmove|pointerup|touchend|pointercancel|touchcancel)$/.test(value.event || '')?value.event:'none',
      time:Math.round(win.performance.now()),target:path(value.target),active:path(value.active),prevented:value.prevented===true,shown:value.shown===true,closing:value.closing===true,
      header:value.header===true,claimed:value.claimed===true,kind:/^(pointer|touch)$/.test(value.kind || '')?value.kind:'none',offset:number(value.offset),rest:number(value.rest)});
    if(value.motion && value.phase==='surface-swap') {
      var motion={};
      ['oldTop','baseTop','oldTime','recoveredTime','oldStart','rate','timeline','elapsed','progress','newRestTop','newTop','newTime','newStart'].forEach(function(key){
        motion[key]=Number.isFinite(value.motion[key]) && Math.abs(value.motion[key])<1000000 ? Math.round(value.motion[key]*1000)/1000 : null;
      });
      motion.oldConnected=value.motion.oldConnected===true;
      motion.state=/^(idle|running|paused|finished)$/.test(value.motion.state || '')?value.motion.state:'none';
      gestureTrace[gestureTrace.length-1].motion=motion;
    }
    if(gestureTrace.length>32)gestureTrace.shift();
  };
  function describe(node) {
    var rect = node.getBoundingClientRect(), css = win.getComputedStyle(node);
    return { tag: node.tagName, classes: classes(node), rect: [rect.x,rect.y,rect.width,rect.height].map(function (value) { return Math.round(value * 10) / 10; }),
      display: css.display, visibility: css.visibility, position: css.position, overflowY: css.overflowY, touchAction: css.touchAction,
      translate: css.translate, transform: css.transform, hidden: !!node.hidden || node.getAttribute('aria-hidden') === 'true',
      scroll: [Math.round(node.scrollTop),node.clientHeight,node.scrollHeight], sheet: node.hasAttribute('data-langform-comments-sheet'), handle: node.hasAttribute('data-langform-comments-handle'),
      moving: node.hasAttribute('data-langform-comments-moving'), interactive: node.hasAttribute('data-langform-comments-interactive'), dragging: node.hasAttribute('data-langform-comments-dragging') };
  }
  function playerButtons() {
    var root = doc.getElementById('movie_player');
    if (!root || !root.querySelector('video')) return [];
    var owner = root.closest('ytm-player,ytd-player') || root.closest('#player-container-id') || root;
    function shape(node) {
      var rect = node.getBoundingClientRect();
      return { tag: node.tagName, classes: classes(node), rect: [rect.x,rect.y,rect.width,rect.height].map(function(value){return Math.round(value*10)/10;}) };
    }
    return Array.from(owner.querySelectorAll('button,[role="button"]')).filter(function(node){return !node.closest('.lf-player-settings,.lf-player-settings-layer');}).slice(0,12).map(function(node){
      var value = shape(node); value.ancestors = [];
      for (var parent=node.parentElement,depth=0;parent && depth<3;parent=parent.parentElement,depth++) value.ancestors.push(shape(parent));
      return value;
    });
  }
  function captionLayout() {
    var root=doc.getElementById('movie_player');
    if(!root || !root.querySelector('video'))return {windows:[],controls:[]};
    var owner=root.closest('ytm-player,ytd-player') || root.closest('#player-container-id') || root;
    function shown(node,rect) {
      if(!(rect.width>0 && rect.height>0))return false;
      for(var parent=node;parent;parent=parent.parentElement){
        var css=win.getComputedStyle(parent);
        if(css.display==='none' || css.visibility==='hidden' || Number(css.opacity || 1)===0)return false;
      }
      return true;
    }
    function shape(node) {
      var rect=node.getBoundingClientRect(),css=win.getComputedStyle(node),inline={};
      ['top','bottom','left','right','width','height','transform','translate'].forEach(function(key){
        var value=node.style.getPropertyValue(key),numeric=value.replace(/\b(?:none|auto|calc|translate|translateX|translateY|translate3d|matrix|matrix3d|scale|scaleX|scaleY|rotate|px|em|rem|vh|vw|deg)\b/g,'');
        if(value.length<=120 && /^[0-9\s+.,%()-]*$/.test(numeric))inline[key]=value;
      });
      return {tag:node.tagName,classes:classes(node),rect:[rect.x,rect.y,rect.width,rect.height].map(function(v){return Math.round(v*10)/10;}),visible:shown(node,rect),inline:inline};
    }
    var windows=Array.from(owner.querySelectorAll('.caption-window,.ytp-caption-window-container')).slice(0,4).map(function(node){
      var value=shape(node);value.ancestors=[];
      for(var parent=node.parentElement,depth=0;parent && depth<3;parent=parent.parentElement,depth++)value.ancestors.push(shape(parent));
      return value;
    });
    var controls=[];
    [['inline-bottom','.player-controls-bottom'],['inline-middle','.player-controls-middle'],['inline-top-button','.player-controls-top button'],['inline-settings','.lf-player-settings[data-inline]'],['fullscreen-title','#langform-fullscreen-ui .lf-fs-title'],['fullscreen-top-button','#langform-fullscreen-ui .lf-fs-top button'],['fullscreen-center-button','#langform-fullscreen-ui .lf-fs-center button'],['fullscreen-chapters','#langform-fullscreen-ui .lf-fs-chapters'],['fullscreen-time','#langform-fullscreen-ui .lf-fs-time'],['fullscreen-range','#langform-fullscreen-ui .lf-fs-range-wrap'],['fullscreen-status','#langform-fullscreen-ui #langform-playback-hold,#langform-fullscreen-ui #langform-playback-swipe-status,#langform-fullscreen-ui #langform-playback-zoom-status']].forEach(function(pair){
      var scope=pair[0].indexOf('inline-')===0?owner:doc;
      Array.from(scope.querySelectorAll(pair[1])).slice(0,pair[0]==='fullscreen-status'?3:20).forEach(function(node){
        if(controls.length>=20)return;
        var value=shape(node);if(value.visible){value.name=pair[0];controls.push(value);}
      });
    });
    return {windows:windows,controls:controls};
  }
  // Inspect only chapter controls in the active player owner. Keep effective
  // target visibility separate from ancestor visibility: an original child
  // can explicitly paint beneath a visibility:hidden control overlay.
  function chapterLayout() {
    var root=doc.getElementById('movie_player'),ui=doc.getElementById('langform-fullscreen-ui');
    if(!root || !root.querySelector('video'))return {originals:[],own:null};
    var owner=root.closest('ytm-player,ytd-player') || root.closest('#player-container-id') || root,seen=new Set(),originals=[];
    function number(value){return Number.isFinite(value) && Math.abs(value)<=100000 ? Math.round(value*10)/10 : null;}
    function state(node){
      var css=win.getComputedStyle(node),opacity=css.opacity===''?NaN:Number(css.opacity);
      return {visibility:/^(visible|hidden|collapse)$/.test(css.visibility)?css.visibility:'other',displayNone:css.display==='none',
        opacity:Number.isFinite(opacity)&&opacity>=0&&opacity<=1?opacity:null,hidden:!!node.hidden || node.hasAttribute('hidden'),
        inert:!!node.inert || node.hasAttribute('inert'),ariaHidden:node.getAttribute('aria-hidden')==='true'};
    }
    function shape(node,kind){
      var rect=node.getBoundingClientRect(),value=state(node);value.kind=kind;value.rect=[rect.x,rect.y,rect.width,rect.height].map(number);
      value.rootOwned=root.contains(node);value.watchOwned=owner.contains(node);value.uiOwned=!!(ui&&ui.contains(node));value.ancestors=[];
      var parent=node.parentElement;
      for(var depth=0;parent && depth<14;parent=parent.parentElement,depth++){
        var entry=state(parent);entry.role=parent===root?'player-root':parent===owner?'watch-owner':parent===ui?'fullscreen-ui':parent.id==='player-control-overlay'?'control-overlay':parent===doc.body?'body':parent===doc.documentElement?'html':'other';
        value.ancestors.push(entry);
      }
      value.ancestorsTruncated=!!parent;
      [['ancestorVisibilityHidden',function(a){return a.visibility==='hidden'||a.visibility==='collapse';}],['ancestorDisplayNone',function(a){return a.displayNone;}],['ancestorOpacityZero',function(a){return a.opacity===0;}],['ancestorHidden',function(a){return a.hidden;}],['ancestorInert',function(a){return a.inert;}]].forEach(function(pair){value[pair[0]]=value.ancestors.some(pair[1]);});
      return value;
    }
    function add(node,kind){
      if(!node || node.id==='langform-chapter-chip' || seen.has(node) || originals.length>=4)return;
      seen.add(node);originals.push(shape(node,kind));
    }
    var selectors='.ytwPlayerTimeDisplayPlayerBarActionContainer,.ytp-chapter-container,.ytp-chapter-title,ytm-chapter-title-renderer,ytd-chapter-title-renderer';
    Array.from(owner.querySelectorAll(selectors)).slice(0,8).forEach(function(node){
      var kind=node.classList.contains('ytwPlayerTimeDisplayPlayerBarActionContainer')?'time-action':node.classList.contains('ytp-chapter-container')?'chapter-container':node.classList.contains('ytp-chapter-title')?'chapter-title':'chapter-renderer';
      var button=node.tagName==='BUTTON'?node:Array.from(node.querySelectorAll('button')).slice(0,4).find(function(item){return item.id!=='langform-chapter-chip';});
      add(button || node,kind);
    });
    // Labels are matched locally against the same fixed native action names;
    // neither a label, title, URL nor arbitrary attribute value is exported.
    Array.from(owner.querySelectorAll('button')).slice(0,80).forEach(function(node){
      if(originals.length<4 && /view chapters|kapitel ansehen|kapitel anzeigen/i.test(node.getAttribute('aria-label') || ''))add(node,'label-fallback');
    });
    var own=doc.getElementById('langform-chapter-chip');
    return {originals:originals,own:own?shape(own,'own'):null};
  }
  function snapshot() {
    if (!alive || !doc.body || samples >= 96) return;
    var rows = [], visited = 0, seen = new Set();
    function inspectTree(start) {
      var nodes = doc.createTreeWalker(start, 1), node = nodes.currentNode;
      while (node && visited++ < 4000 && rows.length < 28) {
        if (!seen.has(node) && node.id !== 'langform-comments-structure-probe' && match.test(node.tagName + ' ' + classes(node).join(' '))) {
          seen.add(node);
          var row = describe(node);
          if (rows.length < 10) {
            row.ancestors = [];
            for (var parent = node.parentElement, depth = 0; parent && depth < 4; parent = parent.parentElement, depth++) row.ancestors.push(describe(parent));
          }
          rows.push(row);
        }
        node = nodes.nextNode();
      }
    }
    // Feed/menu shells can fill the row limit before the live scroll body.
    // Prioritize the recognized sheet, retaining the same global row/visit cap.
    Array.from(doc.querySelectorAll('ytm-engagement-panel[data-langform-comments-sheet]')).slice(0,3).forEach(inspectTree);
    if (rows.length < 28 && visited < 4000) inspectTree(doc.body);
    if (!output) {
      output = doc.createElement('p'); output.id = 'langform-comments-structure-probe'; output.setAttribute('role','status');
      output.style.cssText = 'position:fixed;left:12px;bottom:1px;width:1px;height:1px;overflow:hidden;white-space:nowrap;pointer-events:none;z-index:2147483647;color:transparent;font:1px monospace;margin:0';
      doc.body.appendChild(output);
    }
    // Fullscreen makes unrelated body children inert. As with Holdprobe,
    // keep this explicitly enabled read-only output inside its active AX owner.
    var outputHost=doc.getElementById('langform-fullscreen-ui') || doc.body;
    if(output.parentNode!==outputHost)outputHost.appendChild(output);
    if(outputHost.id==='langform-fullscreen-ui')output.removeAttribute('inert');
    output.textContent = 'Commentsprobe ' + JSON.stringify({ sample: ++samples, visited: visited, reason: reason, sampledAt: Math.round(win.performance.now()), releasePoint: releasePoint,
      panels: doc.querySelectorAll('ytm-engagement-panel').length, ownSheets: doc.querySelectorAll('[data-langform-comments-sheet]').length,
      handles: doc.querySelectorAll('[data-langform-comments-handle]').length, scrollY: Math.round(win.scrollY), viewport: [win.innerWidth,win.innerHeight],
      safeTop: win.__langformStageInsets && win.__langformStageInsets.top || 0, playerButtons: playerButtons(), captionLayout:captionLayout(), chapterLayout:chapterLayout(), gestureTrace: gestureTrace, rows: rows });
  }
  function clear() { timers.forEach(function (id) { win.clearTimeout(id); }); timers = []; }
  function schedule(event) {
    clear();
    if (!alive || samples >= 96) return;
    reason = event && /^(click|touchstart|touchend|pointerdown|pointerup|engagement-panel-opened|yt-navigate-finish|state-navigateend|DOMContentLoaded|pageshow)$/.test(event.type) ? event.type : 'startup';
    var point = event && (event.changedTouches && event.changedTouches[0] || event.touches && event.touches[0] || event);
    releasePoint = point && Number.isFinite(point.clientX) && Number.isFinite(point.clientY) ? [point.clientX,point.clientY].map(function(value){return Math.round(value*10)/10;}) : null;
    [150,1000,3000].forEach(function (delay) { timers.push(win.setTimeout(snapshot,delay)); });
  }
  // Installed at document start, before per-sheet input listeners. The owned
  // drag ends at window capture; document listeners never see that release.
  // Schedule only here and measure asynchronously after the finger/spring.
  ['click','pointerdown','touchstart','touchend','pointerup'].forEach(function (name) { win.addEventListener(name,schedule,{capture:true,passive:true}); });
  ['engagement-panel-opened','yt-navigate-finish','state-navigateend'].forEach(function (name) { win.addEventListener(name,schedule); });
  doc.addEventListener('DOMContentLoaded',schedule,{once:true});
  win.addEventListener('pagehide',function () { alive = false; clear(); });
  win.addEventListener('pageshow',function () { alive = true; schedule(); });
  schedule();
})(window);
