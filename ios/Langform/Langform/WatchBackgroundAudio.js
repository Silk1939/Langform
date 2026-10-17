// Exact leases for the current Watch document. Native lifecycle owns every
// source-retention/continuation cycle; the page never gets a general resume.
(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformWatchBackgroundAudio) return;
  var doc=win.document,active=true,lease=null,serial=0,nativeInactive=false,latestCapture=0,diagnosticRows=0;
  function descriptor(object,key){for(var next=object;next;next=Object.getPrototypeOf(next)){var value=Object.getOwnPropertyDescriptor(next,key);if(value)return value;}return null;}
  var originalHidden=descriptor(doc,'hidden'),originalVisibility=descriptor(doc,'visibilityState');
  function originalValue(value,key){try{return value && typeof value.get==='function' ? value.get.call(doc) : value && 'value' in value ? value.value : key==='hidden' ? false : 'visible';}catch(_){return key==='hidden' ? true : 'hidden';}}
  function realHidden(){return !!originalValue(originalHidden,'hidden');}
  function realVisibility(){return String(originalValue(originalVisibility,'visibilityState'));}
  function relay(){doc.dispatchEvent(new win.Event('langform-real-visibilitychange'));}
  win.__langformRealVisibility={hidden:realHidden,visibilityState:realVisibility,nativeInactive:function(){return nativeInactive;},inactive:function(){return nativeInactive || realHidden();}};
  function id(){try{var u=new URL(win.location.href);return u.protocol==='https:' && /^(m\.|www\.)?youtube\.com$/.test(u.hostname) && u.pathname==='/watch' ? u.searchParams.get('v') || '' : '';}catch(_){return '';}}
  function source(video){return String(video.currentSrc || video.src || '');}
  function audible(video){return !video.paused && !video.ended && !video.error && video.readyState>=3 && !video.muted && video.volume>0;}
  function remember(value,owner,reason){if(value && owner && win.__langformBackgroundAudioDiagnostics===true)owner.diagnosticReason=reason;return value;}
  function current(expectedID,retain,owner){
    var root=doc.getElementById('movie_player'),video=root && root.querySelector('video'),data;
    if(remember(!active,owner,'document-inactive') || remember(id()!==expectedID,owner,'route') ||
        remember(!root,owner,'root-missing') || remember(!video,owner,'video-missing') ||
        remember(!root.isConnected || !video.isConnected,owner,'disconnected') ||
        remember(video.ended,owner,'ended') || remember(video.error,owner,'media-error') ||
        remember(retain ? video.readyState<1 : !audible(video),owner,'not-ready') || remember(!source(video),owner,'source-empty') ||
        remember(typeof win.__langformIsNativeDragging==='function' && win.__langformIsNativeDragging(),owner,'native-drag'))return null;
    var mediaSource=source(video),attribute=video.getAttribute('src');
    try{data=root.getVideoData && root.getVideoData();}catch(_){remember(true,owner,'metadata-exception');return null;}
    if(remember(!data,owner,'metadata-missing') || remember(data.video_id!==expectedID,owner,'metadata-id') || remember(data.isAd,owner,'metadata-ad') ||
        remember(root.classList.contains('ad-showing') || root.classList.contains('ad-interrupting'),owner,'ad-class') ||
        remember(id()!==expectedID,owner,'route') || remember(root!==doc.getElementById('movie_player'),owner,'root-replaced') ||
        remember(video!==root.querySelector('video'),owner,'video-replaced') || remember(!root.isConnected || !video.isConnected,owner,'disconnected') ||
        remember(video.ended,owner,'ended') || remember(video.error,owner,'media-error') ||
        remember(retain ? video.readyState<1 : !audible(video),owner,'not-ready') ||
        remember(source(video)!==mediaSource,owner,'source-changed') || remember(video.getAttribute('src')!==attribute,owner,'attribute-changed'))return null;
    return {id:expectedID,root:root,video:video,source:mediaSource,attribute:attribute};
  }
  // Descriptor getters deliberately use only cheap DOM/source ownership. The
  // page's getVideoData can itself read visibility and must stay outside them.
  function ownsProtection(owner){return !owner.visibility || !owner.installed || owner.installed.every(function(item){
    var now=Object.getOwnPropertyDescriptor(item.object,item.key),matches=!!(now && (item.get ? now.get===item.get : now.value===item.value));
    if(!matches && win.__langformBackgroundAudioDiagnostics===true)owner.diagnosticField=(item.object===doc?'document.':item.object===owner.video?'video.':'root.')+item.key;
    return matches;
  });}
  function sameSource(owner){
    if(!owner)return false;
    return !(remember(!active,owner,'document-inactive') || remember(id()!==owner.id,owner,'route') ||
      remember(owner.root!==doc.getElementById('movie_player'),owner,'root-replaced') || remember(owner.video!==owner.root.querySelector('video'),owner,'video-replaced') ||
      remember(!owner.root.isConnected || !owner.video.isConnected,owner,'disconnected') || remember(source(owner.video)!==owner.source,owner,'source-changed') ||
      remember(owner.video.getAttribute('src')!==owner.attribute,owner,'attribute-changed') ||
      remember(owner.root.classList.contains('ad-showing') || owner.root.classList.contains('ad-interrupting'),owner,'ad-class') ||
      remember(!ownsProtection(owner),owner,'protected-field-replaced'));
  }
  function matching(owner){
    if(owner && owner.visibility && !sameSource(owner))return false;
    var next=owner && current(owner.id,owner.visibility,owner);
    return !!(next && !remember(next.root!==owner.root,owner,'root-replaced') && !remember(next.video!==owner.video,owner,'video-replaced') &&
      !remember(next.source!==owner.source,owner,'source-changed') && !remember(next.attribute!==owner.attribute,owner,'attribute-changed'));
  }
  // No additional page metadata calls, timers, URLs or stacks. This opt-in
  // trace records existing guard results and stops after32 lifecycle rows.
  function diagnose(owner,phase,reason,trigger){
    if(win.__langformBackgroundAudioDiagnostics!==true || !owner || diagnosticRows>=32)return;
    diagnosticRows++;
    try{var handler=win.webkit && win.webkit.messageHandlers && win.webkit.messageHandlers.langformBackgroundAudio;
      if(handler && typeof handler.postMessage==='function')handler.postMessage({kind:'diagnostic',videoID:owner.id,ticket:owner.ticket,request:owner.request,token:owner.token,
        phase:phase,reason:reason || 'none',trigger:trigger || 'none',field:owner.diagnosticField || 'none',row:diagnosticRows,
        milliseconds:win.performance.now(),nativeInactive:nativeInactive,
        mayContinue:!!owner.mayContinue,consumed:!!owner.consumed,background:!!owner.background,categoryReady:!!owner.categoryReady});
    }catch(_){}
  }
  function post(owner,kind){try{var handler=win.webkit && win.webkit.messageHandlers && win.webkit.messageHandlers.langformBackgroundAudio;
    if(handler && typeof handler.postMessage==='function')handler.postMessage({kind:kind,videoID:owner.id,ticket:owner.ticket,request:owner.request,token:owner.token});}catch(_){}}
  function restore(item){try{var now=Object.getOwnPropertyDescriptor(item.object,item.key);
    if(now && (item.get ? now.get===item.get : now.value===item.value)){if(item.previous)Object.defineProperty(item.object,item.key,item.previous);else delete item.object[item.key];}
  }catch(_){}}
  function cancel(expectedID,ticket,token,notify,request,trigger){
    var previous=lease;
    if(!previous || expectedID && previous.id!==expectedID || ticket!==undefined && previous.ticket!==ticket || token!==undefined && previous.token!==token || request!==undefined && previous.request!==request)return false;
    diagnose(previous,'cancel',previous.diagnosticReason || 'none',trigger);
    lease=null;previous.observer.disconnect();(previous.installed || []).forEach(restore);
    if(notify)post(previous,'cancel');return true;
  }
  function revoke(owner,notify,trigger){if(!owner || lease!==owner)return false;owner.epoch++;owner.mayContinue=false;diagnose(owner,'revoke','explicit-intent',trigger);if(notify)post(owner,'pause-intent');return true;}
  function installProperty(owner,object,key,value,getter){
    var previous=Object.getOwnPropertyDescriptor(object,key);
    if(previous && !previous.configurable)return false;
    var row={object:object,key:key,previous:previous};if(getter)row.get=value;else row.value=value;
    try{Object.defineProperty(object,key,getter?{get:value,configurable:true,enumerable:previous ? previous.enumerable : false}:{value:value,writable:true,configurable:true,enumerable:previous ? previous.enumerable : false});owner.installed.push(row);return true;}catch(_){return false;}
  }
  function protect(owner){
    function hidden(){if(lease===owner && sameSource(owner))return false;if(lease===owner)cancel(undefined,undefined,undefined,true,undefined,'hidden-getter');return realHidden();}
    function visibility(){if(lease===owner && sameSource(owner))return 'visible';if(lease===owner)cancel(undefined,undefined,undefined,true,undefined,'visibility-getter');return realVisibility();}
    if(!installProperty(owner,doc,'hidden',hidden,true) || !installProperty(owner,doc,'visibilityState',visibility,true))return false;
    var methods=[[owner.video,'pause'],[owner.video,'play'],[owner.root,'pauseVideo'],[owner.root,'playVideo']];
    for(var n=0;n<methods.length;n++){
      var object=methods[n][0],key=methods[n][1],original=object[key];if(typeof original!=='function')continue;
      var wrapper=(function(target,method,key){return function(){if(this===target && lease===owner)revoke(owner,true,key);return method.apply(this,arguments);};})(object,original,key);
      if(!installProperty(owner,object,key,wrapper,false))return false;
    }
    return true;
  }
  function owned(expectedID,ticket,request,token){return !!(lease && lease.id===expectedID && lease.ticket===ticket && lease.request===request && (token===undefined || lease.token===token));}
  function tryContinue(owner,trigger){
    if(win.__langformBackgroundAudioDiagnostics!==true){
      if(lease!==owner || !owner.visibility || !owner.background || !owner.categoryReady || !nativeInactive || !realHidden() || !owner.mayContinue || owner.consumed)return false;
    }else{
      var waiting=lease!==owner?'stale-lease':!owner.visibility?'category-only':!owner.background?'not-background':!owner.categoryReady?'category-not-ready':!nativeInactive?'native-active':!realHidden()?'real-visible':!owner.mayContinue?'privilege-revoked':owner.consumed?'consumed':'';
      if(waiting){diagnose(owner,'waiting',waiting,trigger);return false;}
    }
    owner.consumed=true;var epoch=owner.epoch,video=owner.video;
    if(!matching(owner)){cancel(undefined,undefined,undefined,true,undefined,trigger);return false;}
    if(lease!==owner || owner.epoch!==epoch || !owner.mayContinue || !realHidden() || video.ended || video.error || video.seeking ||
        video.readyState<3 || video.muted || !(video.volume>0) || video.playbackRate!==owner.rate || typeof owner.play!=='function'){
      revoke(owner,false,'continuation-check');diagnose(owner,'rejected','media-state',trigger);post(owner,'continuation-rejected');return false;
    }
    owner.mayContinue=false;
    if(!video.paused){diagnose(owner,'already-playing','none',trigger);post(owner,'already-playing');return true;}
    try{var promise=owner.play.call(video);diagnose(owner,'continued','none',trigger);post(owner,'continued');if(promise && typeof promise.catch==='function')promise.catch(function(){if(lease===owner)post(owner,'continuation-failed');});return true;}
    catch(_){post(owner,'continuation-failed');return false;}
  }
  function capture(expectedID,ticket,request,visibilityMode){
    if(typeof expectedID!=='string' || !/^[A-Za-z0-9_-]{11}$/.test(expectedID) || !Number.isSafeInteger(ticket) || ticket<=0 || !Number.isSafeInteger(request) || request<=0)return {accepted:false};
    if(request<=latestCapture)return {accepted:false};latestCapture=request;
    cancel(undefined,undefined,undefined,false,undefined,'capture-replaced');if(visibilityMode===true){nativeInactive=true;relay();}
    var owner=current(expectedID,visibilityMode===true);if(!owner || !matching(Object.assign(owner,{visibility:visibilityMode===true})) || request!==latestCapture || lease || visibilityMode===true && !nativeInactive)return {accepted:false};
    owner.ticket=ticket;owner.request=request;owner.token=++serial;owner.installed=[];owner.epoch=0;owner.consumed=false;
    try{owner.mayContinue=audible(owner.video);owner.rate=owner.video.playbackRate;owner.play=owner.video.play;}catch(_){return {accepted:false};}
    // Media accessors may run page code and promote a newer native cycle.
    // Do not replace its lease after reading rate or the original play method.
    if(request!==latestCapture || lease || owner.visibility && !nativeInactive)return {accepted:false};
    owner.background=false;owner.categoryReady=false;owner.categoryDecided=false;
    owner.observer=new win.MutationObserver(function(){if(lease===owner && !(matching(owner)))cancel(undefined,undefined,undefined,true,undefined,'mutation');});
    lease=owner;
    if(owner.visibility){
      var protectedSource=false;try{protectedSource=protect(owner);}catch(_){}
      if(!protectedSource){if(lease===owner)cancel();else owner.installed.forEach(restore);return {accepted:false};}
    }
    if(request!==latestCapture || lease!==owner || owner.visibility && !nativeInactive){
      if(lease===owner)cancel();else owner.installed.forEach(restore);return {accepted:false};
    }
    owner.observer.observe(owner.root,{subtree:true,childList:true,attributes:true,attributeFilter:['src','class']});
    owner.observer.observe(doc,{subtree:true,childList:true});
    var result={accepted:true,videoID:owner.id,ticket:owner.ticket,request:owner.request,token:owner.token};
    if(owner.visibility)result.mayContinue=owner.mayContinue;diagnose(owner,'captured','none','capture');return result;
  }
  win.addEventListener('visibilitychange',function(event){
    var owner=lease;if(!owner || !owner.visibility)return;
    if(!sameSource(owner)){cancel(undefined,undefined,undefined,true,undefined,'visibility');return;}
    if(realHidden()){diagnose(owner,'visibility','none','visibility');relay();event.stopImmediatePropagation();tryContinue(owner,'visibility');}
  },true);
  ['pause','play','playing','ended','emptied','loadstart','error','volumechange','ratechange','loadedmetadata'].forEach(function(name){doc.addEventListener(name,function(event){
    var owner=lease;if(!owner || event.target!==owner.video)return;
    if(!owner.visibility){if(['pause','ended','emptied','loadstart','error'].indexOf(name)>=0 || !matching(owner))cancel(undefined,undefined,undefined,true,undefined,name);return;}
    if(name==='ended' || name==='error' || name==='emptied' || name==='loadstart' || !matching(owner)){cancel(undefined,undefined,undefined,true,undefined,name);return;}
    diagnose(owner,'media-event','none',name);
    if(name==='volumechange' && (owner.video.muted || !(owner.video.volume>0)) || name==='ratechange' && owner.video.playbackRate!==owner.rate)revoke(owner,true,name);
  },true);});
  ['yt-navigate-start','yt-navigate-finish','state-navigateend','popstate'].forEach(function(name){win.addEventListener(name,function(){cancel(undefined,undefined,undefined,true,undefined,name);});});
  win.addEventListener('pagehide',function(){active=false;cancel(undefined,undefined,undefined,true,undefined,'pagehide');});
  win.addEventListener('pageshow',function(){active=true;});
  win.__langformWatchBackgroundAudio={capture:capture,
    matches:function(expectedID,ticket,token){return !!(lease && lease.id===expectedID && lease.ticket===ticket && lease.token===token && matching(lease));},
    cancel:function(expectedID,ticket,request,token){return cancel(expectedID,ticket,token,false,request,'native-cancel');},
    background:function(expectedID,ticket,request){if(!owned(expectedID,ticket,request))return false;if(!matching(lease)){cancel(undefined,undefined,undefined,true,undefined,'background');return false;}lease.background=true;diagnose(lease,'background','none','background');return tryContinue(lease,'background');},
    categoryReady:function(expectedID,ticket,request,token,applied){if(!owned(expectedID,ticket,request,token) || lease.categoryDecided)return false;if(!matching(lease)){cancel(undefined,undefined,undefined,true,undefined,'category');return false;}lease.categoryDecided=true;lease.categoryReady=applied===true;diagnose(lease,'category','none','category');return tryContinue(lease,'category');},
    explicitAction:function(expectedID){return !!(lease && lease.id===expectedID && revoke(lease,true,'explicit-action'));},
    interrupt:function(expectedID,ticket,request){return owned(expectedID,ticket,request) && revoke(lease,true,'native-interrupt');},
    foreground:function(request){
      if(request!==undefined){if(!Number.isSafeInteger(request) || request<0 || request<latestCapture)return false;latestCapture=request;}
      cancel(undefined,undefined,undefined,false,undefined,'foreground');nativeInactive=false;relay();return true;
    }
  };
})(typeof window!=='undefined'?window:this);
