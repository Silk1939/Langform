// A deliberate picture swipe seeks ±15 s; two short same-side taps seek ±10 s.
// Vertical card gestures, controls, hold speed and magnified pan retain their owner.
(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformPlaybackSwipe) return;
  var doc=win.document,alive=true,candidate=null,trailing=null,contacts=new Set(),marked=[],feedback=null,feedbackTimer=0,refresh=0,endedSeek=null,lastTap=null;
  function trace(phase,reason,event,details){
    if(typeof win.__langformPlaybackSwipeTrace!=='function')return;
    try{
      var value={phase:phase,reason:reason || '',event:event && event.type || '',at:Date.now(),candidate:!!candidate,lastTap:!!lastTap,
        secondTap:!!(candidate && candidate.secondTap),id:candidate ? candidate.id : lastTap ? lastTap.owner.id : '',
        primary:event && event.isPrimary,pointerType:event && event.pointerType || '',pointer:event && event.pointerId,
        prevented:!!(event && event.defaultPrevented),trusted:!!(event && event.isTrusted),detail:event && event.detail,
        x:event && event.clientX,y:event && event.clientY};
      Object.keys(details || {}).forEach(function(key){value[key]=details[key];});win.__langformPlaybackSwipeTrace(value);
    }catch(_){}
  }
  function pageInactive() {
    try { var visibility=win.__langformRealVisibility; if (visibility && typeof visibility.inactive==='function') return !!visibility.inactive(); } catch (_) {}
    return !!doc.hidden;
  }
  var controls='button,a,input,select,textarea,[role=button],[role=slider],[role=menuitem],[contenteditable],.ytp-progress-bar-container,.ytp-progress-bar,.ytp-scrubber-container,.lf-fs-speed-panel,.lf-fs-chapters';
  var style=doc.createElement('style');style.id='langform-playback-swipe-style';
  style.textContent='[data-langform-playback-swipe-surface]:not([data-langform-fullscreen-player]){touch-action:pan-y!important} #langform-playback-swipe-status{position:fixed;z-index:2147483647;pointer-events:none;background:#000b;color:#fff;border-radius:18px;padding:7px 14px;font:600 14px -apple-system,BlinkMacSystemFont,sans-serif;transform:translateX(-50%)}';
  (doc.head || doc.documentElement).appendChild(style);
  function id(){try{var u=new win.URL(win.location.href),value=u.searchParams.get('v') || '';return u.protocol==='https:' && /^(m\.|www\.)?youtube\.com$/.test(u.hostname) && u.pathname==='/watch' && /^[A-Za-z0-9_-]{11}$/.test(value) ? value : '';}catch(_){return '';}}
  function source(video){return video.currentSrc || video.src || '';}
  function box(rect){return {left:rect.left,top:rect.top,width:rect.width,height:rect.height,right:rect.left+rect.width,bottom:rect.top+rect.height};}
  function validRect(rect){return rect && ['left','top','width','height'].every(function(key){return Number.isFinite(rect[key]);}) && rect.width>=100 && rect.height>=100 && rect.left<win.innerWidth && rect.top<win.innerHeight && rect.right>0 && rect.bottom>0;}
  function overlap(a,b){return Math.min(a.right,b.right)>Math.max(a.left,b.left) && Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top);}
  function context(allowSeeking,endedSeekPose){
    var key=id(),root=doc.getElementById('movie_player'),video=root && root.querySelector('video'),data,fs=null,ui=null;
    if(!alive || pageInactive() || !key || !root || !root.isConnected || !video || !video.isConnected || video.controls || video.error || video.readyState<2 ||
       !(video.videoWidth>0) || !(video.videoHeight>0) || !source(video) || !Number.isFinite(video.currentTime) || !allowSeeking && video.seeking ||
       doc.fullscreenElement || doc.webkitFullscreenElement || video.webkitDisplayingFullscreen || video.webkitCurrentPlaybackTargetIsWireless || video.remote && video.remote.state==='connected' ||
       win.__langformStageInsets && win.__langformStageInsets.nativeMini || doc.documentElement.hasAttribute('data-langform-mini-video') ||
       typeof win.__langformIsNativeDragging==='function' && win.__langformIsNativeDragging() ||
       typeof win.__langformHasOpenOverlay==='function' && win.__langformHasOpenOverlay())return null;
    try{data=root.getVideoData && root.getVideoData();}catch(_){return null;}
    if(!data || data.video_id!==key || data.isAd || root.classList.contains('ad-showing') || root.classList.contains('ad-interrupting'))return null;
    if(!windowFor(video,video.currentTime))return null;
    var container=video.closest('.html5-video-container') || video.parentElement,shared=root.closest('ytm-player,ytd-player') || root.closest('#player-container-id') || root;
    if(!container || !container.isConnected || !root.contains(container))return null;
    if((video.ended || endedSeekPose ? [root,shared] : [video,container,root,shared]).some(function(node){var css=win.getComputedStyle(node);return node.closest('[hidden]') || css.display==='none' || css.visibility==='hidden' || css.visibility==='collapse' || Number(css.opacity)===0 && css.opacity!=='';}))return null;
    if(doc.documentElement.hasAttribute('data-langform-fullscreen') || root.hasAttribute('data-langform-fullscreen-player') || doc.getElementById('langform-fullscreen-ui')){
      try{fs=win.__langformFullscreen && win.__langformFullscreen.getZoomContext && win.__langformFullscreen.getZoomContext();}catch(_){return null;}
      if(!fs || fs.blocked || fs.id!==key || fs.root!==root || fs.video!==video || fs.container!==container || !fs.ui || !fs.ui.isConnected || fs.ui.inert || fs.ui.hasAttribute('data-entering') || fs.ui.hasAttribute('data-exiting'))return null;
      ui=fs.ui;
    }
    // Custom fullscreen deliberately makes the original player ancestor inert
    // while its separate UI owns contacts. Inline has no such alternate owner.
    if(!ui && root.closest('[inert]'))return null;
    var zoom;try{zoom=win.__langformPlaybackZoom && win.__langformPlaybackZoom.getState && win.__langformPlaybackZoom.getState();}catch(_){return null;}
    if(zoom && (zoom.scale>1.001 || zoom.gesturing))return null;
    var media=box(video.getBoundingClientRect()),rect=box(root.getBoundingClientRect());
    if(!validRect(rect) || !video.ended && !endedSeekPose && (!validRect(media) || !overlap(media,rect)))return null;
    rect=box({left:Math.max(0,rect.left),top:Math.max(0,rect.top),width:Math.min(win.innerWidth,rect.right)-Math.max(0,rect.left),height:Math.min(win.innerHeight,rect.bottom)-Math.max(0,rect.top)});
    if(!validRect(rect))return null;
    return {id:key,root:root,video:video,container:container,shared:shared,ui:ui,source:source(video),attribute:video.getAttribute('src'),rect:rect};
  }
  function owns(owner,allowSeeking,allowEndedPose){var current=context(allowSeeking,!!(allowEndedPose && owner && owner.completedEndedSeek));return !!(owner && current && current.id===owner.id && current.root===owner.root && current.video===owner.video && current.container===owner.container && current.shared===owner.shared && current.ui===owner.ui && current.source===owner.source && current.attribute===owner.attribute && ['left','top','width','height'].every(function(key){return Math.abs(current.rect[key]-owner.rect[key])<=2;}));}
  function cancelEndedSeekGuard(expectedID){
    if(expectedID && id()!==expectedID)return false;
    if(endedSeek && endedSeek.timer)win.clearTimeout(endedSeek.timer);
    endedSeek=null;return true;
  }
  function armEndedSeek(owner,target){
    cancelEndedSeekGuard();
    var record={owner:owner,target:target,until:Date.now()+1500,successful:false,seeked:false,queued:false,timer:0};
    endedSeek=record;record.timer=win.setTimeout(function(){if(endedSeek===record)cancelEndedSeekGuard();},1500);
    return record;
  }
  function endedSeekMatches(record){return endedSeek===record && Date.now()<=record.until && record.successful && owns(record.owner,true,true) && Math.abs(record.owner.video.currentTime-record.target)<=.35;}
  function settleEndedSeek(event){
    var record=endedSeek;if(!record || event.target!==record.owner.video)return;
    if(event.type==='seeked')record.seeked=true;
    if(!record.seeked || record.queued)return;
    record.queued=true;
    // Run after YouTube's seeked handlers. ENDED is not PAUSED in its model,
    // so those handlers can resume an element whose seek began paused.
    Promise.resolve().then(function(){
      record.queued=false;
      if(!endedSeekMatches(record)){if(endedSeek===record)cancelEndedSeekGuard();return;}
      var owner=record.owner;if(owner.video.paused)return;
      cancelEndedSeekGuard(); // Consume this intent once, before any callbacks.
      try{if(typeof owner.root.pauseVideo==='function')owner.root.pauseVideo();}catch(_){}
      if(owns(owner,true,true) && Math.abs(owner.video.currentTime-record.target)<=.35 && !owner.video.paused){
        try{owner.video.pause();}catch(_){}
      }
    });
  }
  function element(event){return event.target && (event.target.nodeType===1 ? event.target : event.target.parentElement);}
  function freeTarget(owner,target){return !!(target && target.closest && !target.closest(controls) && !target.closest('[inert],[hidden]') && (owner.shared.contains(target) || owner.ui && owner.ui.contains(target)));}
  function onPicture(owner,point){var r=owner.rect;return Number.isFinite(point.x) && Number.isFinite(point.y) && point.x>=r.left && point.x<=r.right && point.y>=r.top && point.y<=r.bottom;}
  function consume(event){
    if(/^(pointerdown|pointerup|pointercancel|touchstart|touchend|touchcancel)$/.test(event.type)){
      var fullscreen=win.__langformFullscreen;
      if(fullscreen && typeof fullscreen.observeContact==='function')fullscreen.observeContact(event);
    }
    if(event.cancelable)event.preventDefault();event.stopImmediatePropagation();
  }
  function clearFeedback(){if(feedbackTimer)win.clearTimeout(feedbackTimer);feedbackTimer=0;if(feedback)feedback.node.remove();feedback=null;}
  function unmark(){marked.forEach(function(entry){if(entry.node.getAttribute('data-langform-playback-swipe-surface')===''){if(entry.old===null)entry.node.removeAttribute('data-langform-playback-swipe-surface');else entry.node.setAttribute('data-langform-playback-swipe-surface',entry.old);}});marked=[];}
  function sync(){
    if(refresh)win.cancelAnimationFrame(refresh);refresh=0;
    if(candidate && !owns(candidate)){trace('revoke','sync-candidate');candidate=null;}
    if(lastTap && !owns(lastTap.owner,true)){trace('revoke','sync-last-tap');lastTap=null;}
    if(feedback && !owns(feedback.owner,true))clearFeedback();
    var current=context(true),nodes=current && !current.ui ? [current.root,current.shared].filter(function(node,index,list){return list.indexOf(node)===index;}) : [];
    if(nodes.length===marked.length && nodes.every(function(node,index){return node===marked[index].node;}))return;
    unmark();marked=nodes.map(function(node){var old=node.getAttribute('data-langform-playback-swipe-surface');node.setAttribute('data-langform-playback-swipe-surface','');return {node:node,old:old};});
  }
  function clear(reason,event){trace('clear',typeof reason==='string' ? reason : 'clear',event);cancelEndedSeekGuard();if(refresh)win.cancelAnimationFrame(refresh);refresh=0;candidate=null;trailing=null;lastTap=null;contacts.clear();clearFeedback();unmark();}
  function begin(event,point){
    var previous=lastTap;lastTap=null;
    if(event.defaultPrevented){trace('begin','prevented',event,{previous:!!previous});return;}
    var current=context();if(!current){trace('begin','context-null',event,{previous:!!previous});return;}
    if(!freeTarget(current,element(event))){trace('begin','target',event,{previous:!!previous});return;}
    if(!onPicture(current,point)){trace('begin','bounds',event,{previous:!!previous});return;}
    current.x=point.x;current.y=point.y;current.contact=point.id;current.started=Date.now();current.accepted=false;
    current.trustedTouch=event.isTrusted===true;
    var side=tapSide(current,point),gap=previous ? current.started-previous.finished : -1;
    if(previous && side && side===previous.side && gap>=0 && gap<=700 && owns(previous.owner,true) &&
       Math.hypot(point.x-previous.x,point.y-previous.y)<=44){
      if(gap<=350)current.secondTap=previous;
      // WebKit can delay delivery beyond our ordinary350ms tap window while
      // still reporting a genuine OS dblclick. Preserve only primitive proof
      // of the earlier admitted picture tap, never an unbounded owner chain.
      else if(previous.trusted && current.trustedTouch && previous.clickEvent)current.nativePreviousTap={finished:previous.finished};
    }
    candidate=current;
    trace('begin','accepted',event,{previous:!!previous,gap:gap,side:side,left:current.rect.left,top:current.rect.top,width:current.rect.width,height:current.rect.height});
  }
  function moved(event,point){
    var owner=candidate;if(!owner || owner.contact!==point.id)return;
    if(event.defaultPrevented || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !owns(owner)){candidate=null;return;}
    var dx=Math.abs(point.x-owner.x),dy=Math.abs(point.y-owner.y);
    if(dx>10 || dy>10)owner.tapCancelled=true;
    // Surrender a predominantly vertical contact before native Mini handling;
    // subsequent turns of that same finger do not arm a horizontal seek.
    if(!owner.accepted && dy>10 && dy>dx*1.2){candidate=null;return;}
    var elapsed=Date.now()-owner.started;
    if(!owner.accepted && dx>=28 && dx>=dy*1.7 && elapsed>=0 && (elapsed<=500 || dx>=56)){
      owner.accepted=true;
      if(win.__langformPlaybackHold && typeof win.__langformPlaybackHold.cancel==='function')win.__langformPlaybackHold.cancel();
    }
    if(owner.accepted)consume(event);
  }
  function windowFor(video,time){
    var duration=Number(video.duration),ranges=video.seekable;
    if(ranges && ranges.length){
      try{for(var n=0;n<ranges.length;n++){var low=ranges.start(n),high=ranges.end(n);if(Number.isFinite(duration))high=Math.min(high,duration);if(Number.isFinite(low) && Number.isFinite(high) && high>low && time>=low-.05 && time<=high+.05)return {low:Math.max(0,low),high:high};}}catch(_){return null;}
      return null;
    }
    return Number.isFinite(duration) && duration>0 ? {low:0,high:duration} : null;
  }
  function show(owner,delta){
    clearFeedback();var node=doc.createElement('div');node.id='langform-playback-swipe-status';node.setAttribute('role','status');node.setAttribute('aria-live','polite');node.setAttribute('aria-atomic','true');
    node.textContent=(Math.round(Math.abs(delta)*10)/10).toLocaleString('de-DE')+' s '+(delta>0 ? 'vor' : 'zurück');
    node.style.left=(owner.rect.left+owner.rect.width*(delta>0 ? .65 : .35))+'px';node.style.top=(owner.rect.top+12)+'px';
    (owner.ui || doc.body || doc.documentElement).appendChild(node);feedback={node:node,owner:owner};feedbackTimer=win.setTimeout(clearFeedback,900);
  }
  function tapSide(owner,point){
    if(!onPicture(owner,point))return 0;
    var fraction=(point.x-owner.rect.left)/owner.rect.width;
    return fraction<1/3 ? -1 : fraction>2/3 ? 1 : 0;
  }
  function shortTap(event,owner,point,cancelled){
    var elapsed=Date.now()-owner.started,side=tapSide(owner,point);
    trace('short-tap','evaluate',event,{elapsed:elapsed,side:side,cancelled:!!cancelled,moved:!!owner.tapCancelled,second:!!owner.secondTap,
      activeHold:!!(win.__langformPlaybackHold && typeof win.__langformPlaybackHold.isActive==='function' && win.__langformPlaybackHold.isActive())});
    if(cancelled || owner.tapCancelled || event.defaultPrevented || !side || elapsed<0 || elapsed>=350 || Math.hypot(point.x-owner.x,point.y-owner.y)>10 ||
       side!==tapSide(owner,{x:owner.x,y:owner.y}) || win.__langformPlaybackHold && typeof win.__langformPlaybackHold.isActive==='function' && win.__langformPlaybackHold.isActive())return;
    if(!owner.secondTap){lastTap={owner:owner,side:side,x:point.x,y:point.y,finished:Date.now(),trusted:owner.trustedTouch && event.isTrusted===true,clickEvent:null,nativePreviousTap:owner.nativePreviousTap};trace('short-tap','first',event);return;}
    commitDoubleTap(event,owner,side);
  }
  function commitDoubleTap(event,owner,side){
    // Release Hold's pending selection lease even though this owned end will
    // not reach its later window listener. Never manufacture Play or a rate.
    if(win.__langformPlaybackHold && typeof win.__langformPlaybackHold.cancel==='function')win.__langformPlaybackHold.cancel();
    consume(event);trailing={owner:owner,until:Date.now()+800,doubleTap:true};
    trace('short-tap','seek',event,{amount:side*10});
    seek(owner,side*10);
  }
  function nativeTapClick(event,target){
    var tap=lastTap;
    if(!tap || !tap.trusted || event.type!=='click' && event.type!=='dblclick' || event.isTrusted!==true || !(event.detail>0) || event.defaultPrevented || event.button ||
       event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || tap.clickEvent===event)return false;
    var elapsed=Date.now()-tap.finished,point={x:event.clientX,y:event.clientY};
    if(elapsed<0 || elapsed>350 || !owns(tap.owner) || !freeTarget(tap.owner,target) ||
       tapSide(tap.owner,point)!==tap.side || Math.hypot(point.x-tap.x,point.y-tap.y)>44){lastTap=null;return false;}
    if(event.type==='dblclick'){
      // A click count by itself can include a previous control tap. This path
      // additionally requires two completed, trusted, same-side picture
      // contacts, the second contact's real click, and a native confirmation.
      var prior=tap.nativePreviousTap;
      if(event.detail!==2 || !prior || !tap.clickEvent || tap.clickEvent.detail!==2 || Date.now()-prior.finished>1000)return false;
      lastTap=null;trace('native-tap-click','delayed-confirmation',event);commitDoubleTap(event,tap.owner,tap.side);return true;
    }
    // iOS can deliver one touch pair followed by two trusted picture clicks.
    // The first click may already have detail=2 from an earlier control tap;
    // only a distinct second click on this fresh physical lease counts. The
    // same event can visit our early PlayerRect hook and window listener.
    if(!tap.clickEvent){tap.clickEvent=event;trace('native-tap-click','first',event);return false;}
    lastTap=null;trace('native-tap-click','second',event);commitDoubleTap(event,tap.owner,tap.side);return true;
  }
  function shieldNativeDoubleTap(event){
    var owner=event.type==='touchstart' ? candidate && candidate.secondTap && candidate : trailing && trailing.doubleTap && trailing.owner;
    var points=event.type==='touchstart' ? event.touches : event.changedTouches;
    if(!owner || !points || points.length!==1 || !owns(owner,true,true) || !freeTarget(owner,element(event)) ||
       !onPicture(owner,{x:points[0].clientX,y:points[0].clientY}) || event.type==='touchend' && Date.now()>trailing.until)return;
    // WebKit still emits TouchEvents alongside PointerEvents. Stop only the
    // competing website recognizer; browser defaults and our same-window Hold,
    // Zoom and fullscreen contact observers remain available.
    event.stopPropagation();
  }
  function finish(event,point,cancelled){
    trace('finish','input',event,{cancelled:!!cancelled,contact:point.id});
    var owner=candidate;if(!owner || owner.contact!==point.id)return;
    if(!owns(owner)){trace('finish','ownership-lost',event);candidate=null;return;}
    // Public end coordinates also cover WebKit contacts with no final move.
    if(!cancelled)moved(event,point);
    if(candidate!==owner)return;
    candidate=null;
    if(!owner.accepted){shortTap(event,owner,point,cancelled);return;}
    consume(event);trailing={owner:owner,until:Date.now()+800};
    if(cancelled || !Number.isFinite(point.x) || !Number.isFinite(point.y))return;
    var dx=point.x-owner.x,dy=point.y-owner.y,elapsed=Date.now()-owner.started;
    if(Math.abs(dx)<28 || Math.abs(dx)<Math.abs(dy)*1.7 || elapsed<0 || elapsed>500 && Math.abs(dx)<56)return;
    seek(owner,dx>0 ? 15 : -15);
  }
  function seek(owner,amount){
    var before=owner.video.currentTime,bounds=windowFor(owner.video,before);if(!bounds)return;
    var target=Math.max(bounds.low,Math.min(bounds.high,before+amount));
    if(Math.abs(target-before)<.01)return;
    var endedPaused=owner.video.ended && owner.video.paused;
    if(endedPaused && typeof win.__langformCancelEndedAutonav==='function'){
      try{if(!win.__langformCancelEndedAutonav(owner.id,owner.video,owner.root))return;}catch(_){return;}
      // Original Cancel handlers can navigate or replace media synchronously.
      if(!owns(owner) || !owner.video.paused || Math.abs(owner.video.currentTime-before)>.01)return;
    }
    var record=endedPaused ? armEndedSeek(owner,target) : null;
    try{owner.video.currentTime=target;}catch(_){if(record && endedSeek===record)cancelEndedSeekGuard();return;}
    // A setter may be refused or may replace the media. Announce only the
    // owned, observed result; never request Play or change playback rate.
    // A completed ended seek retains its preceding pause intent while settling.
    var after=owner.video.currentTime,delta=after-before;
    if(record && endedSeek===record){
      record.successful=Number.isFinite(after) && Math.abs(after-target)<=.25 && (amount>0 ? delta>0 : delta<0) && !identityChanged(owner);
      owner.completedEndedSeek=record.successful;
      if(!record.successful)cancelEndedSeekGuard();
    }
    if(owns(owner,true) && Number.isFinite(after) && Math.abs(after-target)<=.25 && (amount>0 ? delta>0 : delta<0))show(owner,delta);
  }
  function pointerDown(event){
    trace('pointer-down','input',event);
    cancelEndedSeekGuard();
    if(event.pointerType!=='touch'){lastTap=null;return;}
    // Earlier capture owners (notably Zoom) may consume a second down and the
    // accepted ends. WebKit's new primary down starts a fresh touch sequence,
    // independently of pointer IDs we could no longer observe being released.
    if(event.isPrimary===true){candidate=null;contacts.clear();}
    if(!contacts.size)trailing=null;
    contacts.add(event.pointerId);
    if(contacts.size!==1 || event.isPrimary===false){candidate=null;lastTap=null;return;}
    if(event.button!==undefined && event.button!==0)return;
    begin(event,{id:event.pointerId,x:event.clientX,y:event.clientY});
  }
  function pointerMove(event){if(event.pointerType==='touch')moved(event,{id:event.pointerId,x:event.clientX,y:event.clientY});}
  function pointerEnd(event){trace('pointer-end','input',event);if(event.pointerType!=='touch' || !contacts.has(event.pointerId))return;finish(event,{id:event.pointerId,x:event.clientX,y:event.clientY},event.type!=='pointerup');contacts.delete(event.pointerId);}
  function touchStart(event){
    trace('touch-start','input',event);
    cancelEndedSeekGuard();
    if(!contacts.size)trailing=null;
    contacts.clear();Array.from(event.touches || []).forEach(function(touch){contacts.add(touch.identifier);});
    if(contacts.size!==1){candidate=null;lastTap=null;return;}
    var point=event.touches[0];begin(event,{id:point.identifier,x:point.clientX,y:point.clientY});shieldNativeDoubleTap(event);
  }
  function touchMove(event){
    var touches=Array.from(event.touches || []);
    if(touches.length!==1 || !candidate || touches[0].identifier!==candidate.contact){candidate=null;return;}
    var point=touches[0];moved(event,{id:point.identifier,x:point.clientX,y:point.clientY});
  }
  function touchEnd(event){var changed=Array.from(event.changedTouches || []);changed.forEach(function(point){if(contacts.has(point.identifier))finish(event,{id:point.identifier,x:point.clientX,y:point.clientY},event.type!=='touchend');contacts.delete(point.identifier);});}
  function click(event){
    var target=element(event),control=target && target.closest && target.closest(controls);
    trace('click','input',event,{control:!!control});
    if(control){cancelEndedSeekGuard();if(event.isTrusted || event.detail>0)lastTap=null;}
    var previous=trailing;if(!previous || Date.now()>previous.until || !owns(previous.owner,true,true)){trailing=null;return nativeTapClick(event,target);}
    if(!freeTarget(previous.owner,target))return false;
    // Click can be retargeted to the player's overlay. Keep the filter inside
    // its original picture as well as the same physical current media.
    if(!onPicture(previous.owner,{x:event.clientX,y:event.clientY}))return false;
    consume(event);if(event.type==='click' && !previous.doubleTap)trailing=null;return true;
  }
  var listeners=[];function listen(node,name,fn,options){node.addEventListener(name,fn,options);listeners.push([node,name,fn,options]);}
  listen(win,'click',click,true);listen(win,'tap',click,true);listen(win,'dblclick',click,true);
  listen(win,'keydown',function(){cancelEndedSeekGuard();lastTap=null;},true);
  listen(doc,'seeked',settleEndedSeek,true);listen(doc,'play',settleEndedSeek,true);
  if(typeof win.PointerEvent==='function'){
    listen(win,'touchstart',shieldNativeDoubleTap,{capture:true,passive:true});listen(win,'touchend',shieldNativeDoubleTap,{capture:true,passive:true});
    listen(win,'pointerdown',pointerDown,{capture:true,passive:true});listen(win,'pointermove',pointerMove,{capture:true,passive:false});
    ['pointerup','pointercancel','lostpointercapture'].forEach(function(name){listen(win,name,pointerEnd,{capture:true,passive:false});});
  }else{
    listen(win,'touchstart',touchStart,{capture:true,passive:true});listen(win,'touchmove',touchMove,{capture:true,passive:false});
    ['touchend','touchcancel'].forEach(function(name){listen(win,name,touchEnd,{capture:true,passive:false});});
  }
  function identityChanged(owner){
    var root=doc.getElementById('movie_player'),video=root && root.querySelector('video'),data;
    if(!owner || !alive || pageInactive() || id()!==owner.id || root!==owner.root || video!==owner.video || !root.isConnected || !video.isConnected ||
       video.closest('.html5-video-container')!==owner.container && video.parentElement!==owner.container || source(video)!==owner.source || video.getAttribute('src')!==owner.attribute ||
       doc.documentElement.hasAttribute('data-langform-mini-video') || win.__langformStageInsets && win.__langformStageInsets.nativeMini ||
       owner.ui && (!owner.ui.isConnected || owner.ui.hasAttribute('data-entering') || owner.ui.hasAttribute('data-exiting')) ||
       root.classList.contains('ad-showing') || root.classList.contains('ad-interrupting'))return true;
    try{data=root.getVideoData && root.getVideoData();}catch(_){return true;}
    return !data || data.video_id!==owner.id || !!data.isAd;
  }
  function relevant(record,root){
    if(record.type==='attributes')return !!(root && (record.target===root || record.target.contains(root) || root.contains(record.target) && /^(VIDEO|SOURCE)$/.test(record.target.tagName)) || record.target.id==='langform-fullscreen-ui');
    var selector='video,.html5-video-container,#movie_player,#langform-fullscreen-ui';
    return Array.from(record.addedNodes).concat(Array.from(record.removedNodes)).some(function(node){return node.nodeType===1 && (node===root || root && node.contains(root) || node.matches(selector) || node.querySelector(selector));});
  }
  var observation={subtree:true,childList:true,attributes:true,attributeFilter:['class','style','src','inert','hidden','data-langform-mini-video','data-langform-fullscreen','data-langform-fullscreen-player','data-entering','data-exiting']};
  var observer=new win.MutationObserver(function(records){
    // Identity revocation needs no layout. Unrelated comment/feed hydration
    // cannot force computed styles or a player measurement; relevant changes
    // coalesce to one upcoming frame. Actual contacts always recheck ownership.
    if(candidate && identityChanged(candidate)){trace('revoke','mutation-candidate');candidate=null;}
    if(lastTap && identityChanged(lastTap.owner)){trace('revoke','mutation-last-tap');lastTap=null;}
    if(feedback && identityChanged(feedback.owner))clearFeedback();
    var root=doc.getElementById('movie_player');
    if(marked.length && (!root || root!==marked[0].node || !root.isConnected || pageInactive() ||
        doc.documentElement.hasAttribute('data-langform-mini-video') || doc.documentElement.hasAttribute('data-langform-fullscreen') || root.hasAttribute('data-langform-fullscreen-player') ||
        win.__langformStageInsets && win.__langformStageInsets.nativeMini || records.some(function(record){return record.type==='attributes' && record.attributeName==='src' && root.contains(record.target);})))unmark();
    if(!records.some(function(record){return relevant(record,root);}) || refresh || !alive)return;
    refresh=win.requestAnimationFrame(function(){refresh=0;if(alive)sync();});
  });observer.observe(doc.documentElement,observation);
  ['loadedmetadata','loadeddata','canplay','emptied','loadstart','error','webkitbeginfullscreen'].forEach(function(name){listen(doc,name,function(event){if(candidate && event.target===candidate.video)candidate=null;if(lastTap && event.target===lastTap.owner.video)lastTap=null;sync();},true);});
  ['yt-navigate-start','yt-navigate-finish','state-navigateend','popstate','resize','orientationchange','blur','player-fullscreen-change','langform-native-drag-end'].forEach(function(name){listen(win,name,function(event){clear(name,event);sync();});});
  listen(doc,'yt-navigate-start',clear);
  ['visibilitychange','langform-real-visibilitychange'].forEach(function(name){listen(doc,name,function(){clear();if(!pageInactive())sync();});});
  listen(win,'pagehide',function(event){alive=false;clear();observer.disconnect();style.remove();if(!event.persisted)listeners.forEach(function(entry){entry[0].removeEventListener(entry[1],entry[2],entry[3]);});});
  listen(win,'pageshow',function(){if(!alive){alive=true;(doc.head || doc.documentElement).appendChild(style);observer.observe(doc.documentElement,observation);sync();}});
  win.__langformPlaybackSwipe={cancel:function(expectedID){if(expectedID && id()!==expectedID)return false;clear();return true;},cancelEndedSeekGuard:cancelEndedSeekGuard,getSeekRect:function(video,expectedID){var current=context();return current && current.video===video && current.id===expectedID ? {x:current.rect.left,y:current.rect.top,width:current.rect.width,height:current.rect.height,videoID:current.id} : null;}};win.__langformConsumePlaybackSwipeClick=click;sync();
})(typeof window!=='undefined' ? window : this);
