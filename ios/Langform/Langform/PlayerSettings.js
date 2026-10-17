// The app's compact player menu delegates choices to the live YouTube player.
// Autoplay uses its real control, so recommendations, preference and end logic
// stay in the original player; this module never navigates or plays a video.
(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformPlayerSettings) return;
  var doc=win.document, alive=true, mounts=[], inline=null, serial=0, explicitAutoplayOff=null, pendingAutoplay=null, autoplayTimer=0, deferredControlTimer=0,captionTimer=0;
  var appMotion=win.__langformMotion;
  function reduceSpatialMotion(){return !!(appMotion && appMotion.reduceSpatialMotion || win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);}
  var controlPress=null,controlTrailing=null,controlClickUntil=0,closedControl=null;
  var levels=['tiny','small','medium','large','hd720','hd1080','hd1440','hd2160','highres'];
  var qualityNames={tiny:'144p',small:'240p',medium:'360p',large:'480p',hd720:'720p',hd1080:'1080p',hd1440:'1440p',hd2160:'2160p',highres:'Höchste'};
  var rates=[.5,.75,1,1.25,1.5,1.75,2];
  var style=doc.createElement('style'); style.id='langform-player-settings-style';
  style.textContent=`
.lf-player-settings { display:flex;align-items:center;gap:4px;color:#fff;flex:0 0 auto; }
.lf-player-settings[data-inline] { position:absolute;right:8px;top:6px;z-index:2147483643;padding:0 2px;border-radius:24px;background:#0006; }
html[data-langform-fullscreen] .lf-player-settings[data-inline],html[data-langform-mini-video] .lf-player-settings[data-inline] { display:none!important; }
.lf-player-settings[hidden] { display:none!important; }
[data-langform-settings-replaced] { visibility:hidden!important;pointer-events:none!important; }
.lf-player-settings button { color:inherit;font:14px -apple-system,BlinkMacSystemFont,sans-serif;min-width:44px;min-height:44px;padding:0;border:0;background:transparent;cursor:pointer; }
.lf-player-settings button:disabled { opacity:.45;cursor:default; }
.lf-player-settings .lf-settings-gear { width:44px;height:44px;border-radius:50%;font-size:25px; }
.lf-player-settings .lf-settings-gear svg { display:block;width:24px;height:24px;margin:auto; }
.lf-player-settings .lf-autoplay-switch { width:52px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:22px; }
.lf-autoplay-track { display:block;position:relative;width:36px;height:20px;border-radius:12px;background:#666;box-shadow:inset 0 0 0 1px #ffffff30; }
.lf-autoplay-track::after { content:'Ⅱ';position:absolute;left:2px;top:2px;display:flex;align-items:center;justify-content:center;width:16px;height:16px;font-size:9px;font-weight:800;border-radius:50%;background:#eee;color:#222;transition:transform 160ms ease-out; }
[aria-checked=true] .lf-autoplay-track { background:#ddd; }
[aria-checked=true] .lf-autoplay-track::after { content:'▶';transform:translateX(16px);background:#222;color:white;font-size:8px; }
.lf-player-settings-layer { position:fixed;inset:0;z-index:2147483647;color:#fff;font:16px -apple-system,BlinkMacSystemFont,sans-serif; }
.lf-player-settings-layer[hidden] { display:none!important; }
.lf-settings-scrim { position:absolute;inset:0;background:#0006;border:0;width:100%;height:100%; }
.lf-settings-sheet { box-sizing:border-box;position:absolute;bottom:0;left:0;right:0;max-width:560px;margin:0 auto;padding:8px 12px calc(12px + env(safe-area-inset-bottom));max-height:calc(100dvh - 40px - env(safe-area-inset-top));overflow:auto;overscroll-behavior:contain;border-radius:22px 22px 0 0;background:#202020;box-shadow:0 -4px 32px #0008; }
.lf-settings-handle { width:36px;height:4px;margin:0 auto 6px;border-radius:4px;background:#777; }
.lf-settings-heading { display:flex;align-items:center;gap:8px;margin-bottom:4px; }
.lf-settings-heading h2 { flex:1;margin:0;font-size:16px;font-weight:650; }
.lf-settings-sheet button { display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;width:100%;border:0;padding:8px 12px;border-radius:12px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer; }
.lf-settings-sheet button:active { background:#ffffff20; }
.lf-settings-sheet button:disabled { opacity:.5;cursor:default; }
.lf-settings-sheet button[aria-checked=true] { background:#ffffff15; }
.lf-settings-sheet button[aria-checked=true]::after { content:'✓'; }
.lf-settings-sheet .lf-settings-back,.lf-settings-sheet .lf-settings-close { min-width:44px;width:44px;height:44px;min-height:44px;justify-content:center;padding:0;font-size:23px; }
#langform-fullscreen-ui .lf-settings-sheet button { width:100%;height:auto;min-height:48px;padding:8px 12px;border-radius:12px;font:16px -apple-system,BlinkMacSystemFont,sans-serif; }
#langform-fullscreen-ui .lf-settings-sheet .lf-settings-back,#langform-fullscreen-ui .lf-settings-sheet .lf-settings-close { width:44px;height:44px;min-height:44px;padding:0;font-size:23px; }
#langform-fullscreen-ui .lf-player-settings .lf-autoplay-switch { width:52px; }
#langform-fullscreen-ui .lf-player-settings-layer .lf-settings-scrim { width:100%;height:100%;min-width:0;min-height:0;border-radius:0;background:#0006; }
.lf-settings-detail { color:#bbb;font-size:14px; }
.lf-settings-status { padding:4px 12px;margin:0;color:#ccc;font-size:13px;line-height:1.4; }
.lf-settings-sheet [hidden] { display:none!important; }
@media(prefers-reduced-motion:reduce) { .lf-settings-sheet {animation:none} .lf-autoplay-track::after {transition:none} }
`;
  if(appMotion)style.textContent+=`
.lf-player-settings .lf-settings-gear svg,.lf-settings-heading button { transition:transform var(--lf-duration-pressOut,160ms) ease-out; }
.lf-player-settings .lf-settings-gear:active svg,.lf-settings-heading button:active { transition-duration:var(--lf-duration-pressIn,80ms);transform:scale(calc(1 - (1 - var(--lf-scale-icon,.94)) * (1 - var(--lf-reduce-spatial-motion,0)))); }
`;
  (doc.head || doc.documentElement).appendChild(style);
  function pageID(){try{return win.location.pathname==='/watch'?new URL(win.location.href).searchParams.get('v') || '':'';}catch(_){return '';}}
  function inactive(){try{var real=win.__langformRealVisibility;if(real&&typeof real.inactive==='function')return !!real.inactive();}catch(_){}return !!doc.hidden;}
  function matching(m){
    try { var info=m.root.getVideoData && m.root.getVideoData();
      return alive && !inactive() && pageID()===m.id && m.root.isConnected && m.video.isConnected &&
        doc.getElementById('movie_player')===m.root && m.root.querySelector('video')===m.video &&
        info && info.video_id===m.id && !info.isAd && !m.root.classList.contains('ad-showing') && !m.root.classList.contains('ad-interrupting') &&
        !m.video.error && !m.video.webkitDisplayingFullscreen && !(win.__langformStageInsets && win.__langformStageInsets.nativeMini);
    } catch(_){return false;}
  }
  function attr(node,name,value){value=String(value);if(node.getAttribute(name)!==value)node.setAttribute(name,value);}
  function node(tag,cls,parent){var result=doc.createElement(tag);if(cls)result.className=cls;if(parent)parent.appendChild(result);return result;}
  function button(parent,cls,label){var b=node('button',cls,parent);b.type='button';if(label)b.setAttribute('aria-label',label);return b;}
  function activity(m){try{if(m.onActivity)m.onActivity();}catch(_){}}
  function traceMenu(m,phase,b){
    if(typeof win.__langformPlayerSettingsTrace!=='function')return;
    try{win.__langformPlayerSettingsTrace({phase:phase,view:m.view || 'none',opened:!!m.opened,valid:matching(m),sourceChanged:!!m.openSource && mediaSource(m)!==m.openSource,
      key:b && (b.getAttribute('data-setting') || b.getAttribute('data-quality') || b.getAttribute('data-speed') || b.getAttribute('data-caption')) || 'none'});}catch(_){}
  }
  function report(){if(typeof win.__langformSetOverlayState==='function')win.__langformSetOverlayState('player-settings',mounts.some(function(m){return m.opened;}));}
  function consumeControl(event){
    if(event.cancelable)event.preventDefault();
    if(event.type==='click')event.stopImmediatePropagation();else event.stopPropagation();
  }
  function ownedControl(target){
    var b=target && target.closest && target.closest('button');if(!b)return null;
    var m=mounts.find(function(item){return !item.disposed && (item.wrap.contains(b) || item.opened && item.layer.contains(b));});
    return m ? {mount:m,button:b} : null;
  }
  function cancelControlPress(){
    if(controlPress){
      controlClickUntil=Date.now()+2500;
      controlTrailing={mount:controlPress.mount,button:controlPress.button,until:controlClickUntil};
    }
    controlPress=null;
  }
  function beginControl(event,point,kind){
    closedControl=null;
    if(event.isPrimary===false){cancelControlPress();return;}
    var owned=ownedControl(event.target);
    if(!owned){cancelControlPress();return;}
    // Keep other app listeners on this window available for contact cleanup;
    // the website's early document recognizer does not own these app buttons.
    event.stopPropagation();
    if(controlPress && controlPress.kind!==kind)return;
    if(!point || event.defaultPrevented || event.button>0 || owned.button.disabled || !matching(owned.mount))return;
    controlTrailing=null;controlPress={mount:owned.mount,button:owned.button,kind:kind,id:kind==='touch'?point.identifier:event.pointerId,
      x:point.clientX,y:point.clientY,started:Date.now(),href:win.location.href,source:mediaSource(owned.mount)};
  }
  function moveControl(event,point,kind){
    if(!controlPress || controlPress.kind!==kind || !point)return;
    if(Math.hypot(point.clientX-controlPress.x,point.clientY-controlPress.y)>10)cancelControlPress();
  }
  function endControl(event,point,kind){
    var owned=ownedControl(event.target),press=controlPress;
    if(!press || press.kind!==kind){
      if(owned && controlTrailing && owned.mount===controlTrailing.mount && owned.button===controlTrailing.button && Date.now()<controlTrailing.until)consumeControl(event);
      return;
    }
    if(!point || (kind==='touch'?point.identifier:event.pointerId)!==press.id)return;
    cancelControlPress();
    var elapsed=Date.now()-press.started;
    if(!owned || owned.mount!==press.mount || owned.button!==press.button || press.button.disabled || !press.button.isConnected ||
       !matching(press.mount) || win.location.href!==press.href || mediaSource(press.mount)!==press.source ||
       event.defaultPrevented || elapsed<0 || elapsed>600 || Math.hypot(point.clientX-press.x,point.clientY-press.y)>10)return;
    var sheetRelease=press.mount.opened && press.mount.layer.contains(press.button);
    press.mount.activateControl(event);
    if(sheetRelease && !press.mount.opened)closedControl={x:point.clientX,y:point.clientY,until:controlClickUntil,href:press.href};
  }
  // WebKit can retarget the compatibility click after a touch release made
  // its sheet inert. Consume only that contact's trailing click; a new contact,
  // another position, navigation or keyboard activation keeps its authority.
  function consumeClosedClick(e){
    if(!e || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)return false;
    var closed=closedControl;if(!closed)return false;
    if(!alive || inactive() || Date.now()>closed.until || win.location.href!==closed.href){closedControl=null;return false;}
    if(e.detail>0 && Math.hypot(e.clientX-closed.x,e.clientY-closed.y)<=24){consumeControl(e);return true;}
    return false;
  }
  win.__langformConsumePlayerSettingsClick=consumeClosedClick;
  win.addEventListener('click',consumeClosedClick,true);
  win.addEventListener('pointerdown',function(e){beginControl(e,e,'pointer');},true);
  win.addEventListener('pointermove',function(e){moveControl(e,e,'pointer');},true);
  win.addEventListener('pointerup',function(e){endControl(e,e,'pointer');},true);
  win.addEventListener('pointercancel',cancelControlPress,true);
  win.addEventListener('touchstart',function(e){if(e.touches.length!==1){cancelControlPress();return;}beginControl(e,e.touches[0],'touch');},{capture:true,passive:true});
  win.addEventListener('touchmove',function(e){if(e.touches.length!==1){cancelControlPress();return;}moveControl(e,e.touches[0],'touch');},{capture:true,passive:true});
  win.addEventListener('touchend',function(e){endControl(e,e.changedTouches[0],'touch');},{capture:true,passive:false});
  win.addEventListener('touchcancel',cancelControlPress,true);
  win.addEventListener('blur',cancelControlPress,true);
  function autoplayOwner(m){return m.root.closest('ytm-player,ytd-player') || m.root.closest('#player-container-id') || m.root;}
  function originalAutoplay(m){
    // Explicit Debug delay of control discovery only. Metadata, original
    // commands and the setting itself remain real; normal bootstrap is false.
    if(win.__langformSettingsDeferredControlProbe===true && !m.deferredControlReady)return null;
    // The inner #player-container-id may wrap only movie_player. Mobile
    // controls, including Autoplay, are siblings higher in the real player.
    var owner=autoplayOwner(m);
    var candidates=Array.from(owner.querySelectorAll('player-autonav-toggle button,.ytp-autonav-toggle-button'));
    return candidates.find(function(b){return !b.closest('.lf-player-settings') && !b.disabled && b.getAttribute('aria-disabled')!=='true' && /^(true|false)$/.test(b.getAttribute('aria-pressed') || b.getAttribute('aria-checked') || '');}) || null;
  }
  function originalAutoplayUnavailable(m){
    try{
      if(typeof m.root.getWatchNextResponse!=='function')return false;
      var source=mediaSource(m),response=m.root.getWatchNextResponse(),endpoint=response && response.currentVideoEndpoint;
      if(!endpoint || !endpoint.watchEndpoint || endpoint.watchEndpoint.videoId!==m.id)return false;
      var next=response.contents && response.contents.singleColumnWatchNextResults,
        overlay=response.playerOverlays && response.playerOverlays.playerOverlayRenderer,
        results=next && next.results && next.results.results;
      // A complete current response can deliberately omit Autoplay. Partial or
      // stale hydration remains unknown, and later real controls keep priority.
      return !!(results && Array.isArray(results.contents) && overlay && typeof overlay==='object' && !Array.isArray(overlay) &&
        !overlay.autonavToggle && !overlay.autoplay && !next.autoplay && matching(m) && mediaSource(m)===source);
    }catch(_){return false;}
  }
  function apiAutoplayState(m){
    try{
      var info=m.root.getVideoData();
      if(!info || info.video_id!==m.id || info.isAd || typeof m.root.setAutonavState!=='function')return null;
      if(info.autonavState===1 || info.autonavState===2)return {enabled:info.autonavState===2,api:true};
      // Some mobile responses omit both the preference and original control
      // until late hydration. Offer an explicit Enable action, without claiming
      // Off or writing a default. Only verified readback becomes a switch.
      return info.autonavState===undefined && !originalAutoplayUnavailable(m) && m.unavailableSource!==mediaSource(m) ? {enabled:null,deferred:true} : null;
    }catch(_){return null;}
  }
  function autoplayState(m){var b=originalAutoplay(m);return b ? {button:b,enabled:(b.getAttribute('aria-pressed') || b.getAttribute('aria-checked'))==='true'} : apiAutoplayState(m);}
  function cancelPendingAutoplay(){
    pendingAutoplay=null;if(autoplayTimer)win.clearTimeout(autoplayTimer);autoplayTimer=0;
    if(deferredControlTimer)win.clearTimeout(deferredControlTimer);deferredControlTimer=0;
  }
  function continuePendingAutoplay(){
    var request=pendingAutoplay;if(!request)return;
    var m=request.mount;
    if(m.disposed || !matching(m) || mediaSource(m)!==request.source){cancelPendingAutoplay();return;}
    // Timers can run just after their deadline. Retire the still-owned request
    // as unavailable as well as canceling it, instead of offering Enable again.
    if(Date.now()>request.until){m.unavailableSource=request.source;cancelPendingAutoplay();return;}
    var original=originalAutoplay(m);
    if(!original){
      if(originalAutoplayUnavailable(m)){cancelPendingAutoplay();return;}
      if(!request.revealed){
        var owner=autoplayOwner(m);
        var reveal=owner.querySelector('#player-controls-a11y-toggle');
        if(typeof win.__langformPlayerSettingsTrace==='function'){var phase=!reveal?'autonav-reveal-missing':reveal.disabled || reveal.getAttribute('aria-disabled')==='true'?'autonav-reveal-disabled':'autonav-reveal-ready';if(request.tracePhase!==phase){request.tracePhase=phase;traceMenu(m,phase);}}
        if(reveal && reveal.tagName==='BUTTON' && !reveal.disabled && reveal.getAttribute('aria-disabled')!=='true'){
          request.revealed=true;traceMenu(m,'autonav-reveal-click');try{reveal.click();}catch(_){traceMenu(m,'autonav-reveal-error');}
        }
      }
      return;
    }
    if((original.getAttribute('aria-pressed') || original.getAttribute('aria-checked'))==='true'){
      explicitAutoplayOff=null;traceMenu(m,'autonav-on');cancelPendingAutoplay();return;
    }
    if(!request.attempted){
      request.attempted=true;traceMenu(m,'autonav-original-click');try{original.click();}catch(_){traceMenu(m,'autonav-original-error');}
      // Read after the original command, including synchronously updated ARIA.
      if(pendingAutoplay===request && matching(m) && mediaSource(m)===request.source &&
          (original.getAttribute('aria-pressed') || original.getAttribute('aria-checked'))==='true'){
        explicitAutoplayOff=null;traceMenu(m,'autonav-on');cancelPendingAutoplay();
      }
    }
  }
  function enableDeferredAutoplay(m){
    var request={mount:m,source:mediaSource(m),until:Date.now()+8000,revealed:false,attempted:false};pendingAutoplay=request;traceMenu(m,'autonav-request');
    if(win.__langformSettingsDeferredControlProbe===true){
      deferredControlTimer=win.setTimeout(function(){deferredControlTimer=0;if(pendingAutoplay===request){m.deferredControlReady=true;sync();}},1200);
    }
    autoplayTimer=win.setTimeout(function(){
      autoplayTimer=0;if(pendingAutoplay!==request)return;
      continuePendingAutoplay();
      if(pendingAutoplay===request){m.unavailableSource=request.source;cancelPendingAutoplay();}update(m);
    },8000);
    continuePendingAutoplay();update(m);return true;
  }
  function toggleAutoplay(m){
    var source=mediaSource(m);
    cancelPendingAutoplay();
    if(!matching(m))return false;
    var before=autoplayState(m);
    if(!before || !matching(m) || mediaSource(m)!==source)return false;
    if(before.enabled===null)return enableDeferredAutoplay(m);
    try{
      if(before.button)before.button.click();
      else m.root.setAutonavState(before.enabled?1:2,true);
    }catch(_){update(m);return false;}
    if(!matching(m) || mediaSource(m)!==source){update(m);return false;}
    var after=autoplayState(m);update(m);
    // Read the live original state after the command. No optimistic local
    // default, own countdown, Play or recommendation navigation is installed.
    if(!after || typeof after.enabled!=='boolean' || after.enabled===before.enabled)return false;
    explicitAutoplayOff=after.enabled?null:{id:m.id,root:m.root,video:m.video,source:source,attempts:0,until:0};
    traceMenu(m,after.enabled?'autonav-on':'autonav-off');
    enforceAutoplayOff();return true;
  }
  function enforceAutoplayOff(){
    var choice=explicitAutoplayOff;
    if(!choice)return;
    if(!matching(choice) || mediaSource(choice)!==choice.source){explicitAutoplayOff=null;return;}
    if(!choice.video.ended){choice.until=0;choice.attempts=0;return;}
    if(!choice.video.ended || !choice.video.paused || choice.video.seeking || typeof win.__langformCancelEndedAutonav!=='function')return;
    if(!choice.until)choice.until=Date.now()+12000;
    if(Date.now()>choice.until || choice.attempts>=12)return;
    var owner=choice.root.closest('ytm-player,ytd-player') || choice.root.closest('#player-container-id');
    // Reuse the already verified original Cancel action. Its helper repeats
    // exact owner/source/ad/navigation checks; no global Autoplay default or
    // own Next navigation follows this explicitly confirmed Off choice.
    if(!owner || !owner.querySelector('player-endscreen .ytwPlayerEndscreenButtonContainer ytm-button-renderer.ytwPlayerEndscreenActionButton > button.ytSpecButtonShapeNextTonal'))return;
    choice.attempts++;
    try{win.__langformCancelEndedAutonav(choice.id,choice.video,choice.root);}catch(_){}
  }
  function qualityStatus(){try{return typeof win.__langformGetQualityStatus==='function' ? win.__langformGetQualityStatus() : null;}catch(_){return null;}}
  function availableQuality(m){try{return typeof m.root.setPlaybackQualityRange==='function' && typeof m.root.getAvailableQualityLevels==='function' ? m.root.getAvailableQualityLevels().filter(function(q,i,a){return levels.indexOf(q)>=0 && a.indexOf(q)===i;}).sort(function(a,b){return levels.indexOf(b)-levels.indexOf(a);}) : [];}catch(_){return [];}}
  function captions(m){try{return typeof m.root.isSubtitlesOn==='function' && typeof m.root.toggleSubtitles==='function' && typeof m.root.getOptions==='function' && m.root.getOptions('captions').indexOf('track')>=0 ? m.root.isSubtitlesOn() : null;}catch(_){return null;}}
  function remote(m){return !!(m.video.webkitCurrentPlaybackTargetIsWireless || m.video.remote && m.video.remote.state==='connected');}
  function mediaSource(m){return String(m.video.currentSrc || m.video.src || '');}
  function stopMotion(m){
    var motion=m.motion;m.motion=null;if(!motion)return;
    win.clearTimeout(motion.timer);motion.animations.forEach(function(a){try{a.cancel();}catch(_){}});
  }
  function motionPose(m){
    var sheet=win.getComputedStyle(m.sheet),scrim=win.getComputedStyle(m.scrim);
    return {transform:sheet.transform || 'none',opacity:sheet.opacity || '1',scrim:scrim.opacity || '1'};
  }
  function moveSheet(m,opening,from){
    stopMotion(m);
    var reduced=reduceSpatialMotion(),fadeOnly=!!appMotion && reduced;
    if(reduced && !fadeOnly || typeof m.sheet.animate!=='function' || typeof m.scrim.animate!=='function'){
      if(!opening)m.layer.hidden=true;return;
    }
    var motion={animations:[],timer:0};m.motion=motion;
    function finish(){if(m.motion!==motion)return;if(!m.opened)m.layer.hidden=true;stopMotion(m);}
    var duration=appMotion?(fadeOnly?appMotion.durations.fade:opening?appMotion.durations.sheetEnter:appMotion.durations.sheetExit):opening?260:180;
    try{
      motion.animations.push(m.sheet.animate([{transform:from.transform,opacity:from.opacity},{transform:fadeOnly?from.transform:opening?'none':'translateY(100%)',opacity:opening?1:fadeOnly?0:.4}],{duration:duration,easing:appMotion?(fadeOnly?appMotion.easings.fade:opening?appMotion.easings.enter:appMotion.easings.exit):opening?'cubic-bezier(.16,1,.3,1)':'cubic-bezier(.4,0,1,1)',fill:'both'}));
      motion.animations.push(m.scrim.animate([{opacity:from.scrim},{opacity:opening?1:0}],{duration:duration,easing:appMotion?appMotion.easings.fade:'ease-out',fill:'both'}));
      motion.animations[0].onfinish=finish;
      // WebKit can suspend a background document's animation clock. The lease
      // must still retire; route/ad/lifecycle dismissal skips motion entirely.
      motion.timer=win.setTimeout(finish,duration+100);
    }catch(_){finish();}
  }
  function dismiss(m,focus){
    stopSubmenu(m);
    if(!m.opened){if(!focus){stopMotion(m);m.layer.hidden=true;}return;}
    var from=focus?motionPose(m):null;
    m.opened=false;m.layer.inert=true;m.layer.style.pointerEvents='none';attr(m.gear,'aria-expanded',false);
    if(focus)moveSheet(m,false,from);else{stopMotion(m);m.layer.hidden=true;}
    report();if(focus && m.gear.isConnected && !m.gear.disabled)m.gear.focus({preventScroll:true});activity(m);
  }
  function status(m,text){m.status.textContent=text;m.status.hidden=!text;}
  function rateLabel(rate){return String(rate).replace('.',',')+'×';}
  function row(m,key,label,value){var b=button(m.items,'','');b.setAttribute('data-setting',key);node('span','',b).textContent=label;if(value)node('span','lf-settings-detail',b).textContent=value;return b;}
  function stopSubmenu(m){
    var motion=m.submenuMotion;m.submenuMotion=null;if(!motion)return;
    win.clearTimeout(motion.timer);motion.animation.onfinish=null;motion.animation.cancel();
  }
  function moveSubmenu(m,from,back){
    if(!appMotion || !m.opened || typeof m.items.animate!=='function')return;
    var reduced=reduceSpatialMotion(),start=from || {opacity:.35,transform:reduced?'none':'translateX('+(back?-8:8)+'px)'};
    var duration=reduced?appMotion.durations.fade:appMotion.durations.submenu;
    var motion={animation:null,timer:0};m.submenuMotion=motion;
    function finish(){if(m.submenuMotion===motion)stopSubmenu(m);}
    try{
      motion.animation=m.items.animate([{opacity:start.opacity,transform:reduced?'none':start.transform},{opacity:1,transform:'none'}],{duration:duration,easing:appMotion.easings.enter,fill:'both'});
      motion.animation.onfinish=finish;motion.timer=win.setTimeout(finish,duration+100);
    }catch(_){m.submenuMotion=null;}
  }
  function render(m,view){
    var previous=m.view,next=view || 'root',pose=m.submenuMotion?win.getComputedStyle(m.items):null;
    var from=pose?{opacity:pose.opacity || '1',transform:pose.transform || 'none'}:null;
    stopSubmenu(m);
    m.view=view || 'root';m.items.replaceChildren();status(m,'');m.back.hidden=m.view==='root';m.heading.textContent=m.view==='root'?'Einstellungen':m.view==='quality'?'Qualität':m.view==='speed'?'Wiedergabegeschwindigkeit':'Untertitel';
    traceMenu(m,'render');
    var allowed=matching(m),q=qualityStatus(),caption=captions(m),options=availableQuality(m);
    if(m.view==='root'){
      var quality=row(m,'quality','Qualität',q && q.mode==='adaptive' ? 'Automatisch' : qualityNames[q && q.actual] || '');quality.disabled=!allowed || remote(m) || !options.length;
      row(m,'speed','Wiedergabegeschwindigkeit',rateLabel(m.video.playbackRate)).disabled=!allowed || remote(m) || m.video.readyState<1;
      row(m,'captions','Untertitel',caption===true?'An':caption===false?'Aus':'Nicht verfügbar').disabled=!allowed || typeof caption!=='boolean';
    }else if(m.view==='quality'){
      var automatic=button(m.items,'','Automatische Qualität');automatic.textContent='Automatisch';automatic.setAttribute('data-quality','auto');automatic.setAttribute('role','menuitemradio');attr(automatic,'aria-checked',!!q && q.mode==='adaptive');automatic.disabled=!allowed || remote(m) || typeof win.__langformUseAdaptiveQuality!=='function';
      options.forEach(function(value){var b=button(m.items,'','Qualität '+qualityNames[value]);b.textContent=qualityNames[value];b.setAttribute('data-quality',value);b.setAttribute('role','menuitemradio');attr(b,'aria-checked',!!q && q.mode==='manual' && q.actual===value);b.disabled=!allowed || remote(m);});
    }else if(m.view==='speed')rates.forEach(function(value){var b=button(m.items,'','Tempo '+rateLabel(value));b.textContent=value===1?'Normal':rateLabel(value);b.setAttribute('data-speed',String(value));b.setAttribute('role','menuitemradio');attr(b,'aria-checked',m.video.playbackRate===value);b.disabled=!allowed || remote(m);});
    else [false,true].forEach(function(value){var b=button(m.items,'',value?'Untertitel einschalten':'Untertitel ausschalten');b.textContent=value?'An':'Aus';b.setAttribute('data-caption',String(value));b.setAttribute('role','menuitemradio');attr(b,'aria-checked',caption===value);b.disabled=!allowed || typeof caption!=='boolean';});
    if(previous && previous!==next)moveSubmenu(m,from,next==='root');
  }
  function refreshMenu(m,allowed){
    // Capabilities can hydrate while the sheet is already open. Update its
    // existing nodes so a focused/pressed control is never replaced by sync.
    var q=qualityStatus(),caption=captions(m),options=availableQuality(m),wireless=remote(m);
    function detail(b,value){
      if(!b)return;var span=b.querySelector('.lf-settings-detail');
      if(!span && value)span=node('span','lf-settings-detail',b);
      if(span && span.textContent!==value)span.textContent=value;
    }
    if(m.view==='root'){
      var quality=m.items.querySelector('[data-setting="quality"]'),speed=m.items.querySelector('[data-setting="speed"]'),subtitles=m.items.querySelector('[data-setting="captions"]');
      if(quality){quality.disabled=!allowed || wireless || !options.length;detail(quality,q && q.mode==='adaptive'?'Automatisch':qualityNames[q && q.actual] || '');}
      if(speed){speed.disabled=!allowed || wireless || m.video.readyState<1;detail(speed,rateLabel(m.video.playbackRate));}
      if(subtitles){subtitles.disabled=!allowed || typeof caption!=='boolean';detail(subtitles,caption===true?'An':caption===false?'Aus':'Nicht verfügbar');}
    }else{
      m.items.querySelectorAll('[data-speed]').forEach(function(b){b.disabled=!allowed || wireless || m.video.readyState<1;attr(b,'aria-checked',m.video.playbackRate===Number(b.getAttribute('data-speed')));});
      m.items.querySelectorAll('[data-caption]').forEach(function(b){b.disabled=!allowed || typeof caption!=='boolean';attr(b,'aria-checked',caption===(b.getAttribute('data-caption')==='true'));});
      m.items.querySelectorAll('[data-quality]').forEach(function(b){var value=b.getAttribute('data-quality');b.disabled=!allowed || wireless || (value==='auto'?typeof win.__langformUseAdaptiveQuality!=='function':options.indexOf(value)<0);attr(b,'aria-checked',!!q && (value==='auto'?q.mode==='adaptive':q.mode==='manual' && q.actual===value));});
    }
  }
  function captionShown(n){
    if(!n || !n.isConnected)return false;var r=n.getBoundingClientRect();if(r.width<1 || r.height<1)return false;
    for(var p=n;p&&p.nodeType===1;p=p.parentElement){var c=win.getComputedStyle(p);if(c.display==='none' || c.visibility==='hidden' || c.opacity!=='' && Number(c.opacity)===0)return false;}
    return true;
  }
  function captionControlShown(n,revealingUI){
    if(captionShown(n))return true;
    if(!revealingUI || revealingUI.hasAttribute('data-hidden') || !n.isConnected)return false;
    var r=n.getBoundingClientRect();if(r.width<1 || r.height<1)return false;
    // The first reveal frame still has opacity zero. Reserve the known own
    // controls now, before their fade paints over the restored bottom caption.
    for(var p=n;p&&p.nodeType===1;p=p.parentElement){var c=win.getComputedStyle(p);
      if(c.display==='none' || c.visibility==='hidden' || c.opacity!=='' && Number(c.opacity)===0 && !(p.classList.contains('lf-fs-controls') && revealingUI.contains(p)))return false;
    }return true;
  }
  function restoreCaption(e){if(e.node.style.getPropertyValue('translate')===e.written && e.node.style.getPropertyPriority('translate')==='important')e.node.style.removeProperty('translate');}
  function clearCaptionStatus(m){if(m.captionStatusUI)m.captionStatusUI.removeAttribute('data-caption-status-side');m.captionStatusUI=null;}
  function clearCaptions(m){(m.captionEntries || []).forEach(restoreCaption);m.captionEntries=[];clearCaptionStatus(m);}
  function placeCaptionStatus(m,ui,windows){
    var statuses=ui?Array.from(ui.querySelectorAll('#langform-playback-hold,#langform-playback-swipe-status,#langform-playback-zoom-status')).filter(captionShown):[],captions=windows.filter(captionShown);
    if(!statuses.length || !captions.length || m.captionStatusUI && m.captionStatusUI!==ui){clearCaptionStatus(m);if(!statuses.length || !captions.length)return;}
    if(m.captionStatusUI===ui)return;
    if(statuses.some(function(n){var a=n.getBoundingClientRect();return captions.some(function(c){var b=c.getBoundingClientRect();return a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;});})){
      m.captionStatusUI=ui;ui.setAttribute('data-caption-status-side','');
    }
  }
  function captionScale(n){
    // Individual translate is independent of the caption's own author transform.
    // Ancestor rotation/skew cannot use viewport deltas; leave those poses alone.
    for(var p=n.parentElement;p;p=p.parentElement){var css=win.getComputedStyle(p),t=css.transform;if(css.rotate && css.rotate!=='none' || css.scale && css.scale!=='none')return null;if(t&&t!=='none'){
      var a=/^matrix\(([^)]+)\)$/.exec(t),v=a&&a[1].split(',').map(Number);if(!v || v.length!==6 || Math.abs(v[1])>.0001 || Math.abs(v[2])>.0001 || v[0]<=0 || v[3]<=0)return null;
    }}
    var parent=n.parentElement,r=parent.getBoundingClientRect(),x=r.width/parent.offsetWidth,y=r.height/parent.offsetHeight;
    return Number.isFinite(x)&&Number.isFinite(y)&&x>0&&y>0?{x:x,y:y}:null;
  }
  function placeCaption(rect,bounds,blocks){
    var gap=8,pad=4,w=rect.width,h=rect.height;
    function fits(x,y){return x>=bounds.left+pad && y>=bounds.top+pad && x+w<=bounds.right-pad && y+h<=bounds.bottom-pad && !blocks.some(function(b){return x<b.right+gap && x+w>b.left-gap && y<b.bottom+gap && y+h>b.top-gap;});}
    if(!blocks.some(function(b){return rect.left<b.right+gap && rect.left+w>b.left-gap && rect.top<b.bottom+gap && rect.top+h>b.top-gap;}) || fits(rect.left,rect.top))return {x:0,y:0};
    var xs=[rect.left,bounds.left+pad,bounds.right-w-pad],ys=[rect.top,bounds.top+pad,bounds.bottom-h-pad];
    blocks.forEach(function(b){xs.push(b.left-w-gap,b.right+gap);ys.push(b.top-h-gap,b.bottom+gap);});
    var best=null,cost=Infinity;xs.forEach(function(x){ys.forEach(function(y){if(!fits(x,y))return;var dx=x-rect.left,dy=y-rect.top,c=dx*dx*1.2+dy*dy;if(c<cost){cost=c;best={x:dx,y:dy};}});});
    // Do not shrink text or change the viewer's font/position preference when
    // the viewport cannot fit the existing caption around visible controls.
    return best;
  }
  function updateCaptions(m,allowed){
    if(!m.inline)return;
    if(!allowed || doc.documentElement.hasAttribute('data-langform-mini-video')){clearCaptions(m);return;}
    if(m.captionSource && m.captionSource!==mediaSource(m))clearCaptions(m);
    m.captionSource=mediaSource(m);
    var fs=doc.getElementById('langform-fullscreen-ui'),isFS=m.root.hasAttribute('data-langform-fullscreen-player');
    if(isFS && (!fs || fs.hasAttribute('data-entering') || fs.hasAttribute('data-exiting'))){clearCaptions(m);return;}
    var windows=Array.from(m.root.querySelectorAll('.ytp-caption-window-container .caption-window')).slice(0,4);
    if(!windows.length){clearCaptions(m);return;}
    var owner=isFS?fs:m.host,selectors=isFS?'.lf-fs-title,.lf-fs-top button,.lf-fs-center button,.lf-fs-chapters,.lf-fs-time,.lf-fs-range-wrap':'.player-controls-middle,.player-controls-bottom,.player-controls-top button,.lf-player-settings[data-inline]';
    var controls=Array.from(owner.querySelectorAll(selectors)).filter(function(n){return captionControlShown(n,isFS?fs:null);}),blocks=controls.map(function(n){return n.getBoundingClientRect();});
    var entries=m.captionEntries || [],next=[],bounds=m.root.getBoundingClientRect();
    entries.forEach(function(e){if(windows.indexOf(e.node)<0)restoreCaption(e);});
    windows.forEach(function(n){var e=entries.find(function(x){return x.node===n;}),owned=e && n.style.getPropertyValue('translate')===e.written && n.style.getPropertyPriority('translate')==='important';
      if(!controls.length || !captionShown(n) || n.classList.contains('ytp-dragging') || !owned && (n.style.getPropertyValue('translate') || ['','none'].indexOf(win.getComputedStyle(n).translate || '')<0)){if(e)restoreCaption(e);return;}
      var scale=captionScale(n);if(!scale){if(e)restoreCaption(e);return;}
      var prior=owned?e.written.split(' ').map(parseFloat):[0,0],dx=prior[0]*scale.x,dy=prior[1]*scale.y;
      var r=n.getBoundingClientRect(),base={left:r.left-dx,top:r.top-dy,width:r.width,height:r.height};
      var move=placeCaption(base,bounds,blocks);if(!move || Math.abs(move.x)<.25 && Math.abs(move.y)<.25){if(e)restoreCaption(e);return;}
      if(owned && Math.abs(move.x-dx)<.1 && Math.abs(move.y-dy)<.1){next.push(e);return;}
      var value=(move.x/scale.x).toFixed(3)+'px '+(move.y/scale.y).toFixed(3)+'px';
      if(!owned || e.written!==value)n.style.setProperty('translate',value,'important');
      next.push({node:n,written:n.style.getPropertyValue('translate')});
    });m.captionEntries=next;placeCaptionStatus(m,isFS?fs:null,windows);
  }
  function refreshCaptions(){if(!alive)return;mounts.forEach(function(m){if(!m.disposed)updateCaptions(m,matching(m));});}
  function scheduleCaptions(delay){if(captionTimer || !alive)return;captionTimer=win.setTimeout(function(){captionTimer=0;refreshCaptions();},delay || 16);}
  function restoreOriginalControl(entry){
    if(entry.node.getAttribute('data-langform-settings-replaced')!=='')return;
    if(entry.value===null)entry.node.removeAttribute('data-langform-settings-replaced');else entry.node.setAttribute('data-langform-settings-replaced',entry.value);
  }
  function syncOriginalControls(m,allowed){
    if(!m.inline)return;
    // Hide only the exact original controls replaced by this valid mount.
    // Visibility preserves their layout, ARIA state and native click binding;
    // originalAutoplay keeps reading/delegating to the same real button.
    var originals=allowed?Array.from(m.host.querySelectorAll('button.player-settings-icon')).filter(function(b){return !m.wrap.contains(b);}):[];
    if(allowed && typeof captions(m)==='boolean')originals=originals.concat(Array.from(m.host.querySelectorAll('yt-closed-captions-toggle-button ytm-closed-captioning-button > button.ytmClosedCaptioningButtonButton')).filter(function(b){return !b.disabled && b.getAttribute('aria-disabled')!=='true';}));
    var autoplay=allowed && originalAutoplay(m);if(autoplay)originals.push(autoplay);
    m.originalControls=(m.originalControls || []).filter(function(entry){if(originals.indexOf(entry.node)>=0)return true;restoreOriginalControl(entry);return false;});
    originals.forEach(function(node){if(m.originalControls.some(function(entry){return entry.node===node;}))return;
      // Hydration may clone our empty marker from an old original control.
      // That is still our presentation, not an author value to preserve.
      m.originalControls.push({node:node,value:node.getAttribute('data-langform-settings-replaced') || null});node.setAttribute('data-langform-settings-replaced','');
    });
  }
  function update(m){
    if(m.disposed)return;var allowed=matching(m),a=allowed && autoplayState(m);
    var waiting=!!pendingAutoplay && pendingAutoplay.mount===m;
    m.gear.disabled=!allowed; m.autoplay.disabled=!a || waiting;m.wrap.hidden=!allowed;syncOriginalControls(m,allowed);updateCaptions(m,allowed);
    var unknown=!!a && a.enabled===null;
    attr(m.autoplay,'role',!a || unknown?'button':'switch');
    if(!a || unknown)m.autoplay.removeAttribute('aria-checked');else attr(m.autoplay,'aria-checked',a.enabled);
    attr(m.autoplay,'aria-label',waiting?'Autoplay wird eingeschaltet':unknown?'Autoplay einschalten':a ? 'Autoplay '+(a.enabled?'an':'aus') : 'Autoplay aktuell nicht verfügbar');
    if((m.opened || m.motion) && (!allowed || mediaSource(m)!==m.openSource))dismiss(m,false);
    else if(m.opened)refreshMenu(m,allowed);
  }
  function open(m){
    if(!matching(m))return false;
    mounts.forEach(function(other){if(other!==m)dismiss(other,false);});
    try{if(win.__langformPlaybackHold)win.__langformPlaybackHold.cancel();}catch(_){}
    var resuming=!!m.motion && !m.layer.hidden && m.openSource===mediaSource(m);
    var fadeOnly=!!appMotion && reduceSpatialMotion();
    var from=resuming?motionPose(m):{transform:fadeOnly?'none':'translateY(100%)',opacity:fadeOnly?0:.4,scrim:0};
    stopMotion(m);m.openSource=mediaSource(m);m.opened=true;m.layer.hidden=false;m.layer.inert=false;m.layer.style.pointerEvents='';attr(m.gear,'aria-expanded',true);if(!resuming)render(m,'root');else refreshMenu(m,true);moveSheet(m,true,from);report();activity(m);
    m.close.focus({preventScroll:true});return true;
  }
  function choose(m,b){
    traceMenu(m,'choose',b);
    if(!m.opened || !matching(m) || b.disabled)return;
    if(mediaSource(m)!==m.openSource){dismiss(m,false);return;}
    var next=b.getAttribute('data-setting');if(next){render(m,next);m.back.focus({preventScroll:true});return;}
    var rate=b.getAttribute('data-speed'),quality=b.getAttribute('data-quality'),caption=b.getAttribute('data-caption');
    try {
      if(rate!==null && rates.indexOf(Number(rate))>=0 && !remote(m)){
        m.video.playbackRate=Number(rate);if(!matching(m))return dismiss(m,false);
        if(m.video.playbackRate!==Number(rate))return status(m,'Dieses Tempo ist aktuell nicht verfügbar.');
      } else if(quality!==null && !remote(m)){
        if(quality==='auto'){if(typeof win.__langformUseAdaptiveQuality!=='function' || win.__langformUseAdaptiveQuality(m.id)!==true)return status(m,'Automatische Qualität ist noch nicht verfügbar.');}
        else if(availableQuality(m).indexOf(quality)>=0)m.root.setPlaybackQualityRange(quality,quality);else return;
      } else if(caption!==null){var before=captions(m),wanted=caption==='true';if(typeof before!=='boolean')return;if(before!==wanted)m.root.toggleSubtitles(true);if(!matching(m))return dismiss(m,false);if(captions(m)!==wanted)return status(m,'Untertitel sind aktuell nicht verfügbar.');}
      else return;
      dismiss(m,true);update(m);
    }catch(_){if(matching(m))status(m,'Diese Einstellung ist aktuell nicht verfügbar.');else dismiss(m,false);}
  }
  function mount(options){
    if(!options || !options.host || !options.root || !options.video || !options.videoID)return null;
    var m={id:options.videoID,root:options.root,video:options.video,host:options.host,onActivity:options.onActivity,inline:!!options.inline,originalControls:[],opened:false,disposed:false,events:[]};
    if(options.inline && win.getComputedStyle(m.host).position==='static'){
      m.hostPosition=[m.host.style.getPropertyValue('position'),m.host.style.getPropertyPriority('position')];m.host.style.setProperty('position','relative');
    }
    m.wrap=node('div','lf-player-settings',m.host);if(options.inline)m.wrap.setAttribute('data-inline','');
    m.autoplay=button(m.wrap,'lf-autoplay-switch','Autoplay');m.autoplay.setAttribute('role','switch');attr(m.autoplay,'aria-checked',false);node('span','lf-autoplay-track',m.autoplay).setAttribute('aria-hidden','true');
    m.gear=button(m.wrap,'lf-settings-gear','Einstellungen');
    var gear=doc.createElementNS('http://www.w3.org/2000/svg','svg');gear.setAttribute('viewBox','0 0 24 24');gear.setAttribute('aria-hidden','true');gear.setAttribute('focusable','false');gear.style.cssText='fill:none;stroke:currentColor;stroke-width:1.8;stroke-linejoin:round';
    var gearPath=doc.createElementNS('http://www.w3.org/2000/svg','path');gearPath.setAttribute('d','m9.5 3-.5 2-1.6.9-2-.5-2.5 4.2L4 11v2l-1.1 1.4 2.5 4.2 2-.5L9 19l.5 2h5l.5-2 1.6-.9 2 .5 2.5-4.2L20 13v-2l1.1-1.4-2.5-4.2-2 .5L15 5l-.5-2z');gear.appendChild(gearPath);
    var gearCircle=doc.createElementNS('http://www.w3.org/2000/svg','circle');gearCircle.setAttribute('cx','12');gearCircle.setAttribute('cy','12');gearCircle.setAttribute('r','3');gear.appendChild(gearCircle);m.gear.appendChild(gear);
    m.gear.setAttribute('aria-haspopup','dialog');attr(m.gear,'aria-expanded',false);
    m.layer=node('div','lf-player-settings-layer',options.inline ? doc.body : m.host.closest('#langform-fullscreen-ui') || m.host);m.layer.hidden=true;m.layer.inert=true;
    var layerID='langform-player-settings-'+(++serial);m.layer.id=layerID;m.gear.setAttribute('aria-controls',layerID);
    m.scrim=button(m.layer,'lf-settings-scrim','Einstellungen schließen');m.scrim.tabIndex=-1;
    m.sheet=node('section','lf-settings-sheet',m.layer);m.sheet.setAttribute('role','dialog');m.sheet.setAttribute('aria-modal','true');m.sheet.setAttribute('aria-label','Videoeinstellungen');
    node('div','lf-settings-handle',m.sheet).setAttribute('aria-hidden','true');var heading=node('div','lf-settings-heading',m.sheet);
    m.back=button(heading,'lf-settings-back','Zurück');m.back.textContent='‹';m.heading=node('h2','',heading);m.close=button(heading,'lf-settings-close','Einstellungen schließen');m.close.textContent='×';
    m.items=node('div','lf-settings-items',m.sheet);m.status=node('p','lf-settings-status',m.sheet);m.status.setAttribute('role','status');m.status.setAttribute('aria-live','polite');
    function listen(n,name,fn,options){n.addEventListener(name,fn,options);m.events.push([n,name,fn,options]);}
    // Inline controls are siblings of YouTube's transparent controls overlay,
    // outside movie_player's lower stacking context. Capture only these exact
    // app buttons before that player can consume their synthetic mouse click.
    m.activateControl=function(e){
      var target=e.target,b=target && target.closest && target.closest('button');
      if(m.disposed || !target)return;
      // A compatibility click from the preceding control can arrive after a
      // second physical tap already changed this menu. Every physical release
      // activates directly; suppress its delayed positive-detail clicks across
      // controls. Explicit keyboard/AX zero-detail activation remains separate.
      if(e.type==='click' && e.detail>0 && b && (m.wrap.contains(b) || m.opened && m.layer.contains(b)) && Date.now()<controlClickUntil){consumeControl(e);return;}
      if(b && m.wrap.contains(b)){
        traceMenu(m,e.type==='click'?'chrome-click':'chrome-release',b);
        if(b.disabled)return;consumeControl(e);
        if(b===m.gear){if(m.opened)dismiss(m,true);else open(m);}else if(b===m.autoplay)toggleAutoplay(m);
        activity(m);
      }else if(m.opened && m.layer.contains(target)){
        traceMenu(m,e.type==='click'?'sheet-click':'sheet-release',b);
        // The website can add document capture listeners after hydration.
        // Own sheet actions need the same early route as the gear, otherwise
        // a later quality/Auto/caption tap never reaches its bubble listener.
        consumeControl(e);
        if(b===m.scrim || b===m.close)dismiss(m,true);
        else if(b===m.back){render(m,'root');m.close.focus({preventScroll:true});}
        else if(b)choose(m,b);
      }else if(b && b===originalAutoplay(m)){
        var originalSource=mediaSource(m);
        // A later choice through YouTube's own control has the same authority
        // as our mirror. Verify its completed On state before retiring Off.
        Promise.resolve().then(function(){
          if(matching(m) && mediaSource(m)===originalSource && b===originalAutoplay(m) &&
              (b.getAttribute('aria-pressed') || b.getAttribute('aria-checked'))==='true')explicitAutoplayOff=null;
        });
      }
    };
    var reducedMotion=win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)');
    function settleDecoration(){stopSubmenu(m);stopMotion(m);if(!m.opened)m.layer.hidden=true;}
    if(reducedMotion && reducedMotion.addEventListener)listen(reducedMotion,'change',function(){if(reducedMotion.matches)settleDecoration();});
    if(appMotion)listen(win,'langform-motion-change',settleDecoration);
    listen(win,'click',m.activateControl,true);
    listen(m.layer,'keydown',function(e){if(!m.opened)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dismiss(m,true);}else if(e.key==='Tab'){var buttons=Array.from(m.sheet.querySelectorAll('button')).filter(function(b){return !b.disabled && !b.hidden;});var index=buttons.indexOf(doc.activeElement),next=e.shiftKey ? (index<=0?buttons.length-1:index-1) : (index+1)%buttons.length;e.preventDefault();e.stopPropagation();if(buttons[next])buttons[next].focus({preventScroll:true});}});
    ['loadedmetadata','ratechange','emptied','error','loadstart'].forEach(function(name){listen(m.video,name,function(){update(m);});});
    ['ended','pause','seeked','play','playing'].forEach(function(name){listen(m.video,name,enforceAutoplayOff);});
    listen(m.root,'autonavchange',function(){update(m);});
    mounts.push(m);update(m);
    return {open:function(){return open(m);},dismiss:function(){dismiss(m,false);},isOpen:function(){return m.opened;},update:function(){update(m);},dispose:function(){if(m.disposed)return;if(controlPress && controlPress.mount===m)controlPress=null;if(controlTrailing && controlTrailing.mount===m)controlTrailing=null;dismiss(m,false);syncOriginalControls(m,false);clearCaptions(m);m.disposed=true;m.events.forEach(function(e){e[0].removeEventListener(e[1],e[2],e[3]);});m.wrap.remove();m.layer.remove();if(m.hostPosition && m.host.style.getPropertyValue('position')==='relative' && !m.host.style.getPropertyPriority('position')){if(m.hostPosition[0])m.host.style.setProperty('position',m.hostPosition[0],m.hostPosition[1]);else m.host.style.removeProperty('position');}mounts=mounts.filter(function(item){return item!==m;});report();}};
  }
  function sync(){
    if(!alive)return;
    var root=doc.getElementById('movie_player'),video=root && root.querySelector('video'),id=pageID();
    if(inline && (!id || inline.id!==id || inline.root!==root || inline.video!==video)){inline.api.dispose();inline=null;}
    if(!inline && id && root && video && typeof root.getVideoData==='function'){
      var inlineHost=root.closest('ytm-player,ytd-player') || root.closest('#player-container-id') || root;
      var api=mount({host:inlineHost,root:root,video:video,videoID:id,inline:true});if(api)inline={root:root,video:video,id:id,api:api};
    }
    continuePendingAutoplay();mounts.forEach(update);
    enforceAutoplayOff();
  }
  var observer=new win.MutationObserver(sync);observer.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-pressed','aria-checked','class','src','data-langform-mini-video']});
  var captionObserver=new win.MutationObserver(function(records){
    if(!inline || !inline.root.querySelector('.ytp-caption-window-container .caption-window'))return;
    // Video/pinch transforms do not change caption geometry. Observe only text,
    // caption anchors and the actual control visibility/layout owners.
    if(records.some(function(r){var n=r.target.nodeType===1?r.target:r.target.parentElement;
      return n && n.matches && (n.closest('.ytp-caption-window-container') || r.type!=='characterData' && n.matches('#langform-fullscreen-ui,.lf-fs-controls,.player-controls-content,.player-controls-middle,.player-controls-bottom,.player-controls-top,.lf-player-settings[data-inline]'));
    }))scheduleCaptions();
  });
  captionObserver.observe(doc.documentElement,{subtree:true,attributes:true,attributeFilter:['style','data-hidden'],characterData:true});
  ['yt-navigate-start','popstate'].forEach(function(name){win.addEventListener(name,function(){controlPress=null;controlTrailing=null;controlClickUntil=0;closedControl=null;cancelPendingAutoplay();mounts.forEach(function(m){dismiss(m,false);});sync();});});
  ['yt-navigate-finish','video-data-change','player-fullscreen-change','state-navigateend','resize'].forEach(function(name){win.addEventListener(name,sync);});
  ['visibilitychange','langform-real-visibilitychange'].forEach(function(name){doc.addEventListener(name,function(){if(inactive()){controlPress=null;controlTrailing=null;controlClickUntil=0;closedControl=null;cancelPendingAutoplay();mounts.forEach(function(m){dismiss(m,false);syncOriginalControls(m,false);clearCaptions(m);m.wrap.hidden=true;});}else sync();});});
  win.addEventListener('pagehide',function(){alive=false;controlPress=null;controlTrailing=null;controlClickUntil=0;closedControl=null;cancelPendingAutoplay();observer.disconnect();captionObserver.disconnect();win.clearTimeout(captionTimer);captionTimer=0;mounts.slice().forEach(function(m){dismiss(m,false);syncOriginalControls(m,false);clearCaptions(m);});});
  win.addEventListener('pageshow',function(){alive=true;captionObserver.observe(doc.documentElement,{subtree:true,attributes:true,attributeFilter:['style','data-hidden'],characterData:true});observer.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-pressed','aria-checked','class','src','data-langform-mini-video']});sync();});
  win.__langformPlayerSettings={refreshCaptions:function(){refreshCaptions();scheduleCaptions(180);},mount:mount,isOpen:function(){return mounts.some(function(m){return m.opened;});},dismiss:function(){mounts.forEach(function(m){dismiss(m,false);});}};
  sync();
})(window);
