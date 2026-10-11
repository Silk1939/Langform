(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformPlaybackZoom) return;
  var doc=win.document,owner=null,contacts=new Map(),gesture=null,trailing=null,alive=true;
  var maximum=8,style=doc.createElement('style');
  style.id='langform-playback-zoom-style';
  style.textContent=`
#langform-fullscreen-ui[data-langform-playback-zoom-surface] { touch-action:none!important; }
#langform-fullscreen-ui[data-langform-playback-zoom-gesture],#langform-fullscreen-ui[data-langform-playback-zoom-gesture] * { -webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important; }
#langform-fullscreen-ui .lf-playback-zoom-reset { font-size:11px;line-height:14px;white-space:pre-line;font-weight:600;min-width:44px;min-height:44px; }
#langform-playback-zoom-status { position:absolute;top:calc(12px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);padding:7px 14px;border-radius:18px;background:#000b;color:#fff;font-weight:600;pointer-events:none; }
html[data-langform-fullscreen] #movie_player[data-langform-fullscreen-player] video[data-langform-playback-zoom-video]:not([data-langform-fullscreen-enter-video]):not([data-langform-fullscreen-exit-video]) { transform:none!important;transform-origin:50% 50%!important; }
`;
  (doc.head || doc.documentElement).appendChild(style);
  var rule=style.sheet && style.sheet.cssRules[style.sheet.cssRules.length-1];
  function source(video) { return video.currentSrc || video.src || ''; }
  function rectCopy(rect) { return {x:rect.left,y:rect.top,left:rect.left,top:rect.top,right:rect.left+rect.width,bottom:rect.top+rect.height,width:rect.width,height:rect.height}; }
  function context() {
    var fullscreen=win.__langformFullscreen,current;
    try { current=fullscreen && fullscreen.getZoomContext && fullscreen.getZoomContext(); } catch (_) { return null; }
    if (!alive || !current || !style.isConnected || !rule || !current.video.isConnected || current.video.error ||
        current.video.readyState<1 || !(current.video.videoWidth>0) || !(current.video.videoHeight>0) ||
        typeof win.__langformHasOpenOverlay==='function' && win.__langformHasOpenOverlay() ||
        typeof win.__langformIsNativeDragging==='function' && win.__langformIsNativeDragging()) return null;
    return current;
  }
  function same(current) {
    return !!(owner && current && owner.id===current.id && owner.root===current.root && owner.video===current.video &&
      owner.container===current.container && owner.ui===current.ui && owner.source===source(current.video) && owner.sourceAttribute===current.video.getAttribute('src') &&
      owner.intrinsicWidth===current.video.videoWidth && owner.intrinsicHeight===current.video.videoHeight &&
      Math.abs(owner.rect.left-current.rect.left)<=1 && Math.abs(owner.rect.top-current.rect.top)<=1 &&
      Math.abs(owner.rect.width-current.rect.width)<=1 && Math.abs(owner.rect.height-current.rect.height)<=1);
  }
  function rememberAttribute(node,name) { var old=node.getAttribute(name);node.setAttribute(name,'');return [node,name,old]; }
  function restoreAttribute(entry) { if (entry[2]===null) entry[0].removeAttribute(entry[1]);else entry[0].setAttribute(entry[1],entry[2]); }
  function label(scale) { return (Math.round(scale*10)/10).toLocaleString('de-DE')+'×'; }
  function endGesture() {
    if (!owner) { contacts.clear();gesture=null;return; }
    if (gesture && gesture.accepted) trailing={id:owner.id,ui:owner.ui,root:owner.root,video:owner.video,source:owner.source,until:Date.now()+800};
    contacts.clear();gesture=null;owner.ui.removeAttribute('data-langform-playback-zoom-gesture');
    if (owner.status) owner.status.remove();owner.status=null;
  }
  function reset(expectedID) {
    if (!owner || expectedID && owner.id!==expectedID) return false;
    endGesture();trailing=null;
    var previous=owner;owner=null;
    previous.observer.disconnect();previous.events.forEach(function(entry){entry[0].removeEventListener(entry[1],entry[2]);});
    if (previous.button) previous.button.remove();
    previous.attributes.reverse().forEach(restoreAttribute);
    rule.style.setProperty('transform','none','important');
    return true;
  }
  function sync() {
    var current=context();
    if (owner && !same(current)) reset();
    if (owner || !current) return owner;
    if (current.blocked || current.video.readyState<2) return null;
    var rect=rectCopy(current.video.getBoundingClientRect());
    // A new gesture starts only on the committed, untransformed media viewport.
    if (Math.abs(rect.left-current.rect.left)>1 || Math.abs(rect.top-current.rect.top)>1 ||
        Math.abs(rect.width-current.rect.width)>1 || Math.abs(rect.height-current.rect.height)>1) return null;
    var css=win.getComputedStyle(current.video);
    if (css.transform && css.transform!=='none' || css.objectFit!=='contain') return null;
    var fit=Math.min(rect.width/current.video.videoWidth,rect.height/current.video.videoHeight);
    owner={id:current.id,root:current.root,video:current.video,container:current.container,ui:current.ui,source:source(current.video),sourceAttribute:current.video.getAttribute('src'),
      intrinsicWidth:current.video.videoWidth,intrinsicHeight:current.video.videoHeight,rect:rect,
      pictureWidth:current.video.videoWidth*fit,pictureHeight:current.video.videoHeight*fit,scale:1,x:0,y:0,attributes:[],events:[]};
    owner.attributes.push(rememberAttribute(owner.ui,'data-langform-playback-zoom-surface'));
    owner.attributes.push(rememberAttribute(owner.video,'data-langform-playback-zoom-video'));
    var observed=owner;
    owner.observer=new win.MutationObserver(function(){if(owner===observed && !same(context()))reset();});
    owner.observer.observe(owner.root,{subtree:true,childList:true,attributes:true,attributeFilter:['class','src']});
    owner.observer.observe(owner.ui,{attributes:true,attributeFilter:['inert','data-entering','data-exiting']});
    ['loadstart','loadedmetadata','emptied','error','webkitbeginfullscreen'].forEach(function(name){var fn=function(){if(owner===observed && (name==='emptied'||name==='error'||name==='webkitbeginfullscreen'||!same(context())))reset();};
      owner.video.addEventListener(name,fn);owner.events.push([owner.video,name,fn]);});
    return owner;
  }
  function consume(event) { if(event.cancelable)event.preventDefault();event.stopImmediatePropagation(); }
  function targetElement(event) { return event.target && (event.target.nodeType===1 ? event.target : event.target.parentElement); }
  function freeTarget(target) {
    return !!(owner && target && (owner.ui===target || owner.ui.contains(target) || owner.root===target || owner.root.contains(target)) &&
      !target.closest('button,a,input,select,textarea,[role=button],[role=slider],[role=menuitem],[contenteditable],.lf-fs-controls,.lf-fs-speed-panel,.lf-fs-chapters'));
  }
  function onPicture(point) {
    if (!owner || !Number.isFinite(point.x) || !Number.isFinite(point.y))return false;
    var r=owner.rect,cx=r.left+r.width/2+owner.x,cy=r.top+r.height/2+owner.y,w=owner.pictureWidth*owner.scale,h=owner.pictureHeight*owner.scale;
    return point.x>=Math.max(r.left,cx-w/2) && point.x<=Math.min(r.right,cx+w/2) && point.y>=Math.max(r.top,cy-h/2) && point.y<=Math.min(r.bottom,cy+h/2);
  }
  function pose() { return {scale:owner.scale,x:owner.x,y:owner.y}; }
  function geometry(points) {
    if(points.length===1)return {x:points[0].x,y:points[0].y,distance:0};
    var dx=points[1].x-points[0].x,dy=points[1].y-points[0].y;
    return {x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2,distance:Math.sqrt(dx*dx+dy*dy)};
  }
  function startGesture(accepted) {
    var points=Array.from(contacts.values());
    gesture={start:geometry(points),pose:pose(),count:points.length,accepted:!!accepted};
    if(points.length===2)accept();
  }
  function accept() {
    if(!owner || !gesture)return;
    gesture.accepted=true;
    if(win.__langformPlaybackHold && typeof win.__langformPlaybackHold.cancel==='function')win.__langformPlaybackHold.cancel();
    owner.ui.setAttribute('data-langform-playback-zoom-gesture','');
    if(!owner.status){owner.status=doc.createElement('div');owner.status.id='langform-playback-zoom-status';owner.status.setAttribute('aria-hidden','true');owner.ui.appendChild(owner.status);}
    owner.status.textContent='Zoom '+label(owner.scale);
  }
  function updateButton() {
    if(owner.scale<=1.001){if(owner.button)owner.button.remove();owner.button=null;return;}
    if(!owner.button){var top=owner.ui.querySelector('.lf-fs-top');if(!top)return;
      owner.button=doc.createElement('button');owner.button.type='button';owner.button.className='lf-playback-zoom-reset';
      owner.button.setAttribute('data-action','zoom-reset');top.appendChild(owner.button);}
    owner.button.textContent='Zoom\n'+label(owner.scale);owner.button.setAttribute('aria-label','Zoom '+label(owner.scale)+' zurücksetzen');
    owner.button.tabIndex=owner.ui.hasAttribute('data-hidden')?-1:0;
  }
  function apply(scale,x,y) {
    var r=owner.rect;
    owner.scale=Math.max(1,Math.min(maximum,scale));
    var limitX=Math.max(0,(owner.pictureWidth*owner.scale-r.width)/2),limitY=Math.max(0,(owner.pictureHeight*owner.scale-r.height)/2);
    owner.x=Math.max(-limitX,Math.min(limitX,x));owner.y=Math.max(-limitY,Math.min(limitY,y));
    if(owner.scale<1.001){owner.scale=1;owner.x=0;owner.y=0;}
    rule.style.setProperty('transform','matrix('+owner.scale+',0,0,'+owner.scale+','+owner.x+','+owner.y+')','important');
    updateButton();if(owner.status)owner.status.textContent='Zoom '+label(owner.scale);
  }
  function move(event) {
    var current=context();
    if(!owner || !same(current)){reset();return;}
    if(current.blocked){endGesture();return;}
    if(!gesture || !contacts.size)return;
    var now=geometry(Array.from(contacts.values())),start=gesture.start,original=gesture.pose;
    if(!gesture.accepted && Math.hypot(now.x-start.x,now.y-start.y)<4)return;
    if(!gesture.accepted)accept();
    var scale=gesture.count===2 && start.distance>0 ? Math.max(1,Math.min(maximum,original.scale*now.distance/start.distance)) : original.scale;
    var cx=owner.rect.left+owner.rect.width/2,cy=owner.rect.top+owner.rect.height/2,ratio=scale/original.scale;
    apply(scale,now.x-cx-(start.x-cx-original.x)*ratio,now.y-cy-(start.y-cy-original.y)*ratio);
    consume(event);
  }
  function pointerDown(event) {
    if(!contacts.size)trailing=null;
    // A second finger whose first contact belongs to a real control is not a
    // new one-finger picture pan. Touch fallback checks the complete touchlist.
    if(!contacts.size && event.isPrimary===false)return;
    if(event.pointerType!=='touch' || event.button>0 || event.defaultPrevented || !sync())return;
    var current=context();if(!same(current)||current.blocked)return;
    var point={x:event.clientX,y:event.clientY},target=targetElement(event);
    if(!freeTarget(target)||!onPicture(point)){if(contacts.size)endGesture();return;}
    if(contacts.size>=2){endGesture();consume(event);return;}
    contacts.set(event.pointerId,point);
    if(contacts.size===2){startGesture(true);consume(event);}
    else if(owner.scale>1)startGesture(false);
  }
  function pointerMove(event) {
    if(!contacts.has(event.pointerId))return;
    if(!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY)){endGesture();return;}
    contacts.set(event.pointerId,{x:event.clientX,y:event.clientY});move(event);
  }
  function pointerEnd(event) {
    if(!contacts.has(event.pointerId))return;
    var accepted=!!(gesture && gesture.accepted);
    contacts.delete(event.pointerId);
    if(/cancel|lostpointercapture/.test(event.type) || !contacts.size)endGesture();
    else if(gesture)startGesture(accepted);
    if(accepted)consume(event);
  }
  function touchStart(event) {
    if(!contacts.size)trailing=null;
    if(event.defaultPrevented || !sync())return;
    var current=context();if(!same(current)||current.blocked)return;
    var touches=Array.from(event.touches || []);
    if(!touches.length || touches.length>2){if(gesture && gesture.accepted){endGesture();consume(event);}return;}
    if(!touches.every(function(touch){return freeTarget(touch.target || targetElement(event)) && onPicture({x:touch.clientX,y:touch.clientY});})){if(contacts.size)endGesture();return;}
    contacts.clear();touches.forEach(function(touch){contacts.set(touch.identifier,{x:touch.clientX,y:touch.clientY});});
    if(touches.length===2){startGesture(true);consume(event);}
    else if(owner.scale>1)startGesture(false);
  }
  function touchMove(event) {
    if(!contacts.size)return;
    var touches=Array.from(event.touches || []);
    if(touches.length!==contacts.size || !touches.every(function(touch){return contacts.has(touch.identifier)&&Number.isFinite(touch.clientX)&&Number.isFinite(touch.clientY);})){endGesture();return;}
    touches.forEach(function(touch){contacts.set(touch.identifier,{x:touch.clientX,y:touch.clientY});});move(event);
  }
  function touchEnd(event) {
    var changed=Array.from(event.changedTouches || []);
    if(!changed.some(function(touch){return contacts.has(touch.identifier);} ))return;
    var accepted=!!(gesture && gesture.accepted);
    changed.forEach(function(touch){contacts.delete(touch.identifier);});
    if(event.type==='touchcancel' || !contacts.size)endGesture();else if(gesture)startGesture(accepted);
    if(accepted)consume(event);
  }
  function click(event) {
    var target=targetElement(event);
    if(owner && owner.button && target && owner.button.contains(target)){
      if(!same(context())){reset();return;}
      consume(event);endGesture();apply(1,0,0);return;
    }
    var currentID;try{currentID=new win.URL(win.location.href).searchParams.get('v');}catch(_){}
    if(trailing && trailing.id===currentID && trailing.root===doc.getElementById('movie_player') && trailing.video===trailing.root.querySelector('video') &&
      trailing.source===source(trailing.video) && Date.now()<trailing.until && target && (trailing.ui.contains(target)||trailing.root.contains(target)) &&
      !target.closest('button,a,input,[role=button],[role=slider]')){consume(event);trailing=null;}
  }
  var listeners=[];
  function listen(node,name,fn,options){node.addEventListener(name,fn,options);listeners.push([node,name,fn,options]);}
  if(typeof win.PointerEvent==='function'){
    listen(win,'pointerdown',pointerDown,{capture:true,passive:false});listen(win,'pointermove',pointerMove,{capture:true,passive:false});
    ['pointerup','pointercancel','lostpointercapture'].forEach(function(name){listen(win,name,pointerEnd,{capture:true,passive:false});});
  }else{
    listen(win,'touchstart',touchStart,{capture:true,passive:false});listen(win,'touchmove',touchMove,{capture:true,passive:false});
    ['touchend','touchcancel'].forEach(function(name){listen(win,name,touchEnd,{capture:true,passive:false});});
  }
  listen(win,'click',click,true);listen(win,'tap',click,true);
  ['loadedmetadata','loadeddata','canplay'].forEach(function(name){listen(doc,name,function(event){var current=context();if(current && event.target===current.video)sync();},true);});
  ['player-fullscreen-change','yt-navigate-finish','state-navigateend','popstate'].forEach(function(name){listen(win,name,sync);});
  ['yt-navigate-start','pagehide'].forEach(function(name){listen(win,name,function(){reset();});});
  ['resize','orientationchange','blur'].forEach(function(name){listen(win,name,function(){reset();sync();});});
  listen(doc,'visibilitychange',function(){if(doc.hidden)reset();else sync();});
  listen(win,'pagehide',function(event){alive=false;reset();style.remove();if(!event.persisted){listeners.forEach(function(entry){entry[0].removeEventListener(entry[1],entry[2],entry[3]);});}});
  listen(win,'pageshow',function(){if(!alive){alive=true;(doc.head || doc.documentElement).appendChild(style);rule=style.sheet && style.sheet.cssRules[style.sheet.cssRules.length-1];sync();}});
  // Layout measurements must remain independent of the visible crop: native
  // owns the fullscreen viewport and must never scale its WKWebView again.
  win.__langformPlaybackZoom={reset:reset,getLayoutRect:function(video){return owner && owner.scale>1 && owner.video===video && same(context()) ? rectCopy(owner.rect) : null;},
    getState:function(){return owner && same(context()) ? {scale:owner.scale,x:owner.x,y:owner.y,gesturing:!!(gesture&&gesture.accepted),videoID:owner.id} : null;}};
  sync();
})(typeof window!=='undefined'?window:this);
