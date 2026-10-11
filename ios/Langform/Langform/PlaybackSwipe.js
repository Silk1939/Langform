// A deliberate single-finger picture swipe seeks once on release. Vertical
// card gestures, real controls and a magnified picture retain their owner.
(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformPlaybackSwipe) return;
  var doc=win.document,alive=true,candidate=null,trailing=null,contacts=new Set(),marked=[],feedback=null,feedbackTimer=0,refresh=0;
  var controls='button,a,input,select,textarea,[role=button],[role=slider],[role=menuitem],[contenteditable],.ytp-chrome-top,.ytp-chrome-bottom,.lf-fs-controls,.lf-fs-speed-panel,.lf-fs-chapters';
  var style=doc.createElement('style');style.id='langform-playback-swipe-style';
  style.textContent='[data-langform-playback-swipe-surface]:not([data-langform-fullscreen-player]){touch-action:pan-y!important} #langform-playback-swipe-status{position:fixed;z-index:2147483647;pointer-events:none;background:#000b;color:#fff;border-radius:18px;padding:7px 14px;font:600 14px -apple-system,BlinkMacSystemFont,sans-serif;transform:translateX(-50%)}';
  (doc.head || doc.documentElement).appendChild(style);
  function id(){try{var u=new win.URL(win.location.href),value=u.searchParams.get('v') || '';return u.protocol==='https:' && /^(m\.|www\.)?youtube\.com$/.test(u.hostname) && u.pathname==='/watch' && /^[A-Za-z0-9_-]{11}$/.test(value) ? value : '';}catch(_){return '';}}
  function source(video){return video.currentSrc || video.src || '';}
  function box(rect){return {left:rect.left,top:rect.top,width:rect.width,height:rect.height,right:rect.left+rect.width,bottom:rect.top+rect.height};}
  function validRect(rect){return rect && ['left','top','width','height'].every(function(key){return Number.isFinite(rect[key]);}) && rect.width>=100 && rect.height>=100 && rect.left<win.innerWidth && rect.top<win.innerHeight && rect.right>0 && rect.bottom>0;}
  function context(allowSeeking){
    var key=id(),root=doc.getElementById('movie_player'),video=root && root.querySelector('video'),data,fs=null,ui=null;
    if(!alive || doc.hidden || !key || !root || !root.isConnected || !video || !video.isConnected || video.controls || video.error || video.readyState<2 ||
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
    if([video,container,root,shared].some(function(node){var css=win.getComputedStyle(node);return node.closest('[hidden]') || css.display==='none' || css.visibility==='hidden' || css.visibility==='collapse' || Number(css.opacity)===0 && css.opacity!=='';}))return null;
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
    var rect=box(video.getBoundingClientRect());if(!validRect(rect))return null;
    return {id:key,root:root,video:video,container:container,shared:shared,ui:ui,source:source(video),attribute:video.getAttribute('src'),rect:rect};
  }
  function owns(owner,allowSeeking){var current=context(allowSeeking);return !!(owner && current && current.id===owner.id && current.root===owner.root && current.video===owner.video && current.container===owner.container && current.shared===owner.shared && current.ui===owner.ui && current.source===owner.source && current.attribute===owner.attribute && ['left','top','width','height'].every(function(key){return Math.abs(current.rect[key]-owner.rect[key])<=2;}));}
  function element(event){return event.target && (event.target.nodeType===1 ? event.target : event.target.parentElement);}
  function freeTarget(owner,target){return !!(target && target.closest && !target.closest(controls) && !target.closest('[inert],[hidden]') && (owner.shared.contains(target) || owner.ui && owner.ui.contains(target)));}
  function onPicture(owner,point){var r=owner.rect;return Number.isFinite(point.x) && Number.isFinite(point.y) && point.x>=r.left && point.x<=r.right && point.y>=r.top && point.y<=r.bottom;}
  function consume(event){if(event.cancelable)event.preventDefault();event.stopImmediatePropagation();}
  function clearFeedback(){if(feedbackTimer)win.clearTimeout(feedbackTimer);feedbackTimer=0;if(feedback)feedback.node.remove();feedback=null;}
  function unmark(){marked.forEach(function(entry){if(entry.node.getAttribute('data-langform-playback-swipe-surface')===''){if(entry.old===null)entry.node.removeAttribute('data-langform-playback-swipe-surface');else entry.node.setAttribute('data-langform-playback-swipe-surface',entry.old);}});marked=[];}
  function sync(){
    if(refresh)win.cancelAnimationFrame(refresh);refresh=0;
    if(candidate && !owns(candidate))candidate=null;
    if(feedback && !owns(feedback.owner,true))clearFeedback();
    var current=context(true),nodes=current && !current.ui ? [current.root,current.shared].filter(function(node,index,list){return list.indexOf(node)===index;}) : [];
    if(nodes.length===marked.length && nodes.every(function(node,index){return node===marked[index].node;}))return;
    unmark();marked=nodes.map(function(node){var old=node.getAttribute('data-langform-playback-swipe-surface');node.setAttribute('data-langform-playback-swipe-surface','');return {node:node,old:old};});
  }
  function clear(){if(refresh)win.cancelAnimationFrame(refresh);refresh=0;candidate=null;trailing=null;contacts.clear();clearFeedback();unmark();}
  function begin(event,point){
    if(event.defaultPrevented)return;
    var current=context();if(!current || !freeTarget(current,element(event)) || !onPicture(current,point))return;
    current.x=point.x;current.y=point.y;current.contact=point.id;current.started=Date.now();current.accepted=false;candidate=current;
  }
  function moved(event,point){
    var owner=candidate;if(!owner || owner.contact!==point.id)return;
    if(event.defaultPrevented || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !owns(owner)){candidate=null;return;}
    var dx=Math.abs(point.x-owner.x),dy=Math.abs(point.y-owner.y);
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
  function finish(event,point,cancelled){
    var owner=candidate;if(!owner || owner.contact!==point.id)return;
    if(!owns(owner)){candidate=null;return;}
    // Public end coordinates also cover WebKit contacts with no final move.
    if(!cancelled)moved(event,point);
    if(candidate!==owner)return;
    candidate=null;
    if(!owner.accepted)return;
    consume(event);trailing={owner:owner,until:Date.now()+800};
    if(cancelled || !Number.isFinite(point.x) || !Number.isFinite(point.y))return;
    var dx=point.x-owner.x,dy=point.y-owner.y,elapsed=Date.now()-owner.started;
    if(Math.abs(dx)<28 || Math.abs(dx)<Math.abs(dy)*1.7 || elapsed<0 || elapsed>500 && Math.abs(dx)<56)return;
    var before=owner.video.currentTime,bounds=windowFor(owner.video,before);if(!bounds)return;
    var target=Math.max(bounds.low,Math.min(bounds.high,before+(dx>0 ? 15 : -15)));
    if(Math.abs(target-before)<.01)return;
    try{owner.video.currentTime=target;}catch(_){return;}
    // A setter may be refused or may replace the media. Announce only the
    // owned, observed result; never play/pause or change the playback rate.
    var after=owner.video.currentTime,delta=after-before;
    if(owns(owner,true) && Number.isFinite(after) && Math.abs(after-target)<=.25 && (dx>0 ? delta>0 : delta<0))show(owner,delta);
  }
  function pointerDown(event){
    if(event.pointerType!=='touch')return;
    // Earlier capture owners (notably Zoom) may consume a second down and the
    // accepted ends. WebKit's new primary down starts a fresh touch sequence,
    // independently of pointer IDs we could no longer observe being released.
    if(event.isPrimary===true){candidate=null;contacts.clear();}
    if(!contacts.size)trailing=null;
    contacts.add(event.pointerId);
    if(contacts.size!==1 || event.isPrimary===false){candidate=null;return;}
    if(event.button!==undefined && event.button!==0)return;
    begin(event,{id:event.pointerId,x:event.clientX,y:event.clientY});
  }
  function pointerMove(event){if(event.pointerType==='touch')moved(event,{id:event.pointerId,x:event.clientX,y:event.clientY});}
  function pointerEnd(event){if(event.pointerType!=='touch' || !contacts.has(event.pointerId))return;finish(event,{id:event.pointerId,x:event.clientX,y:event.clientY},event.type!=='pointerup');contacts.delete(event.pointerId);}
  function touchStart(event){
    if(!contacts.size)trailing=null;
    contacts.clear();Array.from(event.touches || []).forEach(function(touch){contacts.add(touch.identifier);});
    if(contacts.size!==1){candidate=null;return;}
    var point=event.touches[0];begin(event,{id:point.identifier,x:point.clientX,y:point.clientY});
  }
  function touchMove(event){
    var touches=Array.from(event.touches || []);
    if(touches.length!==1 || !candidate || touches[0].identifier!==candidate.contact){candidate=null;return;}
    var point=touches[0];moved(event,{id:point.identifier,x:point.clientX,y:point.clientY});
  }
  function touchEnd(event){var changed=Array.from(event.changedTouches || []);changed.forEach(function(point){if(contacts.has(point.identifier))finish(event,{id:point.identifier,x:point.clientX,y:point.clientY},event.type!=='touchend');contacts.delete(point.identifier);});}
  function click(event){
    var previous=trailing;if(!previous || Date.now()>previous.until || !owns(previous.owner,true)){trailing=null;return false;}
    var target=element(event);if(!freeTarget(previous.owner,target))return false;
    // Click can be retargeted to the player's overlay. Keep the filter inside
    // its original picture as well as the same physical current media.
    if(!onPicture(previous.owner,{x:event.clientX,y:event.clientY}))return false;
    consume(event);trailing=null;return true;
  }
  var listeners=[];function listen(node,name,fn,options){node.addEventListener(name,fn,options);listeners.push([node,name,fn,options]);}
  listen(win,'click',click,true);listen(win,'tap',click,true);
  if(typeof win.PointerEvent==='function'){
    listen(win,'pointerdown',pointerDown,{capture:true,passive:true});listen(win,'pointermove',pointerMove,{capture:true,passive:false});
    ['pointerup','pointercancel','lostpointercapture'].forEach(function(name){listen(win,name,pointerEnd,{capture:true,passive:false});});
  }else{
    listen(win,'touchstart',touchStart,{capture:true,passive:true});listen(win,'touchmove',touchMove,{capture:true,passive:false});
    ['touchend','touchcancel'].forEach(function(name){listen(win,name,touchEnd,{capture:true,passive:false});});
  }
  function identityChanged(owner){
    var root=doc.getElementById('movie_player'),video=root && root.querySelector('video'),data;
    if(!owner || !alive || doc.hidden || id()!==owner.id || root!==owner.root || video!==owner.video || !root.isConnected || !video.isConnected ||
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
    if(candidate && identityChanged(candidate))candidate=null;
    if(feedback && identityChanged(feedback.owner))clearFeedback();
    var root=doc.getElementById('movie_player');
    if(marked.length && (!root || root!==marked[0].node || !root.isConnected || doc.hidden ||
        doc.documentElement.hasAttribute('data-langform-mini-video') || doc.documentElement.hasAttribute('data-langform-fullscreen') || root.hasAttribute('data-langform-fullscreen-player') ||
        win.__langformStageInsets && win.__langformStageInsets.nativeMini || records.some(function(record){return record.type==='attributes' && record.attributeName==='src' && root.contains(record.target);})))unmark();
    if(!records.some(function(record){return relevant(record,root);}) || refresh || !alive)return;
    refresh=win.requestAnimationFrame(function(){refresh=0;if(alive)sync();});
  });observer.observe(doc.documentElement,observation);
  ['loadedmetadata','loadeddata','canplay','emptied','loadstart','error','webkitbeginfullscreen'].forEach(function(name){listen(doc,name,function(event){if(candidate && event.target===candidate.video)candidate=null;sync();},true);});
  ['yt-navigate-start','yt-navigate-finish','state-navigateend','popstate','resize','orientationchange','blur','player-fullscreen-change','langform-native-drag-end'].forEach(function(name){listen(win,name,function(){clear();sync();});});
  listen(doc,'yt-navigate-start',clear);
  listen(doc,'visibilitychange',function(){clear();if(!doc.hidden)sync();});
  listen(win,'pagehide',function(event){alive=false;clear();observer.disconnect();style.remove();if(!event.persisted)listeners.forEach(function(entry){entry[0].removeEventListener(entry[1],entry[2],entry[3]);});});
  listen(win,'pageshow',function(){if(!alive){alive=true;(doc.head || doc.documentElement).appendChild(style);observer.observe(doc.documentElement,observation);sync();}});
  win.__langformPlaybackSwipe={cancel:function(expectedID){if(expectedID && id()!==expectedID)return false;clear();return true;}};win.__langformConsumePlaybackSwipeClick=click;sync();
})(typeof window!=='undefined' ? window : this);
