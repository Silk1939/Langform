// The already decoded feed image owns the opening before any native/network
// callback. Web Animations runs a sampled physical spring on the compositor.
(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformWatchOpeningInstalled) return;
  win.__langformWatchOpeningInstalled = true;
  var doc = win.document, current = null, serial = 0;
  var reduced = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)');
  var style = doc.createElement('style');
  style.id = 'langform-watch-opening-style';
  style.textContent = `
#langform-watch-opening { position:fixed; inset:0; z-index:2147483646; pointer-events:none; overflow:hidden; color:var(--yt-spec-text-primary,#111); }
#langform-watch-opening .lf-opening-wash { position:absolute; inset:0; opacity:0; }
#langform-watch-opening .lf-opening-picture { position:absolute; left:0; top:0; transform-origin:0 0; overflow:hidden; contain:layout paint; will-change:transform; }
#langform-watch-opening .lf-opening-visual { position:absolute!important; left:0!important; top:0!important; display:block!important; object-fit:fill!important; max-width:none!important; max-height:none!important; border-radius:0!important; opacity:1!important; transform-origin:0 0!important; }
#langform-watch-opening .lf-opening-details { position:absolute; left:0; right:0; padding:14px 12px; box-sizing:border-box; }
#langform-watch-opening .lf-opening-block { opacity:0; }
#langform-watch-opening .lf-opening-line { height:14px; margin:0 0 10px; border-radius:6px; background:currentColor; opacity:.10; }
#langform-watch-opening .lf-opening-channel { display:flex; gap:12px; align-items:center; height:54px; }
#langform-watch-opening .lf-opening-avatar { width:36px; height:36px; flex:none; border-radius:50%; background:currentColor; opacity:.10; }
#langform-watch-opening .lf-opening-buttons { display:flex; gap:8px; height:50px; }
#langform-watch-opening .lf-opening-pill { width:86px; height:32px; border-radius:18px; background:currentColor; opacity:.08; }
#langform-watch-opening .lf-opening-comments { height:70px; padding:12px; box-sizing:border-box; border-radius:12px; background:#8881; }
#langform-watch-opening .lf-opening-recommendation { height:calc((100vw - 24px) * .5625); margin-top:16px; border-radius:10px; background:currentColor; opacity:.08; }
html[data-lf-opening-transparent], html[data-lf-opening-transparent] body { background:transparent!important; }
[data-lf-opening-origin] { opacity:0!important; }
html[data-lf-watch-content] { overflow-anchor:none; }
`;
  function mountStyle() { if (doc.head && !style.isConnected) doc.head.appendChild(style); }
  mountStyle(); doc.addEventListener('DOMContentLoaded', mountStyle, { once:true });
  function post(entry, kind) {
    var handler = win.webkit && win.webkit.messageHandlers && win.webkit.messageHandlers.langformOpening;
    if (handler) handler.postMessage({ kind:kind, token:entry.token, videoID:entry.id,
      elapsed:win.performance.now() - entry.started, target:entry.target, reduced:entry.reduced });
  }
  function element(tag, cls, parent) {
    var node = doc.createElement(tag); node.className = cls;
    if (parent) parent.appendChild(node); return node;
  }
  function motionRole() { return win.__langformMotion || {}; }
  function spatialReduced() { var role=motionRole(); return !!(role.reduceSpatialMotion || reduced && reduced.matches); }
  function fadeDuration() { var value=Number((motionRole().durations||{}).fade); return Number.isFinite(value)&&value>=0&&value<=1000?value:160; }
  function fadeEasing() { return (motionRole().easings||{}).fade || 'ease-out'; }
  function springRole() {
    var role=(motionRole().springs||{}).hero || {},omega=Number(role.omega),damping=Number(role.damping);
    return {omega:Number.isFinite(omega)&&omega>=12&&omega<=60?omega:24,damping:Number.isFinite(damping)&&damping>=.6&&damping<1?damping:.94};
  }
  function oscillator(from,to,velocity,role) {
    var alpha=role.omega*role.damping,beta=role.omega*Math.sqrt(1-role.damping*role.damping),a=from-to,b=(velocity+alpha*a)/beta;
    return {sample:function(t){var c=Math.cos(beta*t),s=Math.sin(beta*t),e=Math.exp(-alpha*t);return {value:to+e*(a*c+b*s),velocity:e*((-alpha*a+beta*b)*c+(-alpha*b-beta*a)*s)};}};
  }
  function matrix(node,css) {
    var value=(css||win.getComputedStyle(node)).transform,match=value&&value.match(/^matrix\(([^)]+)\)$/),n=match&&match[1].split(',').map(Number);
    if(n&&n.length===6&&n.every(Number.isFinite))return n;
    return null;
  }
  function flightPose(entry,rect,source) {
    var scale=source?entry.sourceScale:Math.max(rect.width/entry.bitmapWidth,rect.height/entry.bitmapHeight),position=entry.objectPosition;
    var value={x:rect.x,y:rect.y,width:rect.width,height:rect.height,visualX:(rect.width-entry.bitmapWidth*scale)*position[0]+position[2],visualY:(rect.height-entry.bitmapHeight*scale)*position[1]+position[3],scale:scale};
    entry.sourceRadii.forEach(function(radius,i){value['radius'+i]=source?radius:0;});return value;
  }
  function clipFrame(value) {
    function corners(offset){return [0,1,2,3].map(function(i){return Math.max(0,value['radius'+(i+offset)])+'px';}).join(' ');}
    return {transform:'translate('+value.x+'px,'+value.y+'px)',width:value.width+'px',height:value.height+'px',borderRadius:corners(0)+' / '+corners(4)};
  }
  function visualFrame(value) { return {transform:'translate('+value.visualX+'px,'+value.visualY+'px) scale('+value.scale+')'}; }
  function writePose(entry,value) {
    var frame=clipFrame(value);Object.keys(frame).forEach(function(key){entry.picture.style[key]=frame[key];});entry.visual.style.transform=visualFrame(value).transform;
  }
  function presentation(entry) {
    // Only takeover/status reads presentation. No layout read runs per frame.
    var rect=entry.picture.getBoundingClientRect(),css=win.getComputedStyle(entry.picture),outer=matrix(entry.picture,css),inner=matrix(entry.visual),value=Object.assign({},entry.lastPose||flightPose(entry,entry.base,true));
    if(rect.width>0&&rect.height>0){value.x=rect.left;value.y=rect.top;value.width=rect.width;value.height=rect.height;}
    else if(outer){value.x=outer[4];value.y=outer[5];value.width=parseFloat(css.width);value.height=parseFloat(css.height);}
    if(inner){value.visualX=inner[4];value.visualY=inner[5];value.scale=inner[0];}
    ['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'].forEach(function(key,i){var parts=String(css[key]||'').split(/\s+/),x=parseFloat(parts[0]),y=parseFloat(parts[1]||parts[0]);if(Number.isFinite(x))value['radius'+i]=x;if(Number.isFinite(y))value['radius'+(i+4)]=y;});
    return value;
  }
  function pose(entry) { var value=presentation(entry);return {x:value.x,y:value.y,width:value.width,height:value.height}; }
  function cancelFlight(entry) {
    if(entry.animation)entry.animation.cancel();if(entry.visualAnimation)entry.visualAnimation.cancel();entry.animation=null;entry.visualAnimation=null;
  }
  function flightVelocity(entry) {
    if(!entry.animation)return {};
    var velocity={},at=entry.animation&&Number.isFinite(entry.animation.currentTime)?entry.animation.currentTime/1000:Math.max(0,(win.performance.now()-entry.motionStarted)/1000);
    if(entry.models)Object.keys(entry.models).forEach(function(key){velocity[key]=entry.models[key].sample(at).velocity;});return velocity;
  }
  function motion(entry,from,to,initialVelocity,done) {
    var clipFrames=[],visualFrames=[],role=springRole(),models={},duration=entry.reversing?.32:.4;
    Object.keys(from).forEach(function(key){models[key]=oscillator(from[key],to[key],initialVelocity&&initialVelocity[key]||0,role);});
    // Keep the existing 400ms landing and separate 320ms return budget.
    // Neither duration follows an adaptive settlement estimate. The trajectory
    // owns the middle frames; the final target and landed callback retain the
    // established fixed-time contract. No new timeout or adaptive extension.
    for(var i=0;i<=120;i++){
      var at=duration*i/120,value={};Object.keys(models).forEach(function(key){value[key]=i===120?to[key]:models[key].sample(at).value;});
      clipFrames.push(Object.assign({offset:i/120},clipFrame(value)));visualFrames.push(Object.assign({offset:i/120},visualFrame(value)));
    }
    entry.models=models;entry.lastPose=from;entry.lastTarget=to;entry.motionStarted=win.performance.now();entry.duration=duration;
    writePose(entry,from);
    var timing={duration:duration*1000,fill:'forwards',easing:'linear'};
    // The single isolated clip changes width/height. Its bitmap only ever
    // receives a UNIFORM scale; no inverse-interpolation approximation or XY
    // stretching can occur between keyframes. These are seek-safe animations.
    entry.animation=entry.picture.animate(clipFrames,timing);entry.visualAnimation=entry.visual.animate(visualFrames,timing);
    var animation = entry.animation;
    animation.onfinish = function () {
      if (current !== entry || entry.animation !== animation) return;
      writePose(entry,to);entry.lastPose=to;cancelFlight(entry);done();
    };
  }
  function fade(node, from, to, duration, delay) {
    return node.animate([{opacity:from},{opacity:to}], {duration:duration,delay:delay||0,fill:'forwards',easing:fadeEasing()});
  }
  function clean(entry, report) {
    if (!entry) return;
    cancelFlight(entry);
    entry.effects.forEach(function (a) { a.cancel(); });
    if (entry.image) entry.image.removeAttribute('data-lf-opening-origin');
    if (entry.root) entry.root.remove();
    if(entry.barFrozen&&entry.bar){if(entry.barTransform[0])entry.bar.style.setProperty('transform',entry.barTransform[0],entry.barTransform[1]);else entry.bar.style.removeProperty('transform');}
    doc.documentElement.removeAttribute('data-lf-opening-transparent');
    if (current === entry) current = null;
    if (report) post(entry, report);
  }
  function objectPosition(value) {
    var parts=String(value||'50% 50%').trim().split(/\s+/);if(parts.length===1)parts.push('50%');if(parts.length!==2)return null;
    var fractions=[],pixels=[];
    for(var i=0;i<2;i++){
      var token=parts[i],keyword={left:'0%',top:'0%',center:'50%',right:'100%',bottom:'100%'};token=keyword[token]||token;
      if(/^-?[\d.]+%$/.test(token)){fractions[i]=parseFloat(token)/100;pixels[i]=0;}
      else if(/^-?[\d.]+(?:px)?$/.test(token)){fractions[i]=0;pixels[i]=parseFloat(token);}
      else return null;
    }
    return [fractions[0],fractions[1],pixels[0],pixels[1]];
  }
  function sourceRadii(image,rect) {
    var node=image,css=win.getComputedStyle(node),constraints=[css];
    for(var i=0;i<4&&node.parentElement;i++){
      var parent=node.parentElement,box=parent.getBoundingClientRect(),parentCSS=win.getComputedStyle(parent);
      if(Math.abs(box.left-rect.left)>1||Math.abs(box.top-rect.top)>1||Math.abs(box.width-rect.width)>1||Math.abs(box.height-rect.height)>1)break;
      if(/hidden|clip/.test(parentCSS.overflow+' '+parentCSS.overflowX+' '+parentCSS.overflowY))constraints.push(parentCSS);
      node=parent;
    }
    var values=[0,0,0,0,0,0,0,0];
    constraints.forEach(function(css){var shorthand=String(css.borderRadius||'0').split('/').map(function(axis){var v=axis.trim().split(/\s+/);if(v.length===1)v=[v[0],v[0],v[0],v[0]];else if(v.length===2)v=[v[0],v[1],v[0],v[1]];else if(v.length===3)v=[v[0],v[1],v[2],v[1]];return v;});
      ['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'].forEach(function(key,i){var parts=css[key]?String(css[key]).split(/\s+/):null;[0,1].forEach(function(axis){var token=parts?(parts[axis]||parts[0]):(shorthand[axis]||shorthand[0])[i],number=parseFloat(token)||0;values[i+axis*4]=Math.max(values[i+axis*4],number*(/%$/.test(token)?(axis?rect.height:rect.width)/100:1));});});
    });
    return values;
  }
  function bitmap(entry,image,preview,rect) {
    var css=win.getComputedStyle(image),position=objectPosition(css.objectPosition);if(!position)return null;
    var visual=preview;
    if(!visual){
      visual=image.cloneNode(false);visual.removeAttribute('id');visual.removeAttribute('srcset');visual.removeAttribute('sizes');visual.removeAttribute('style');visual.removeAttribute('data-lf-opening-origin');visual.src=image.currentSrc;visual.alt='';
    }
    var width=preview?preview.width:image.naturalWidth,height=preview?preview.height:image.naturalHeight,fit=preview?'cover':css.objectFit||'fill',scale;
    // An existing object-fit:fill can itself be anisotropic. Freeze exactly
    // those already visible source pixels once; never introduce new stretch.
    if(!preview&&fit==='fill'&&Math.abs(width/height-rect.width/rect.height)>.0001){
      var canvas=doc.createElement('canvas'),ratio=Math.min(2,win.devicePixelRatio||1);canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);
      try{var context=canvas.getContext('2d');if(!context)return null;context.drawImage(image,0,0,canvas.width,canvas.height);}catch(_){return null;}
      visual=canvas;width=canvas.width;height=canvas.height;fit='cover';position=[.5,.5,0,0];
    }
    var contain=Math.min(rect.width/width,rect.height/height);
    scale=fit==='contain'?contain:fit==='none'?1:fit==='scale-down'?Math.min(1,contain):Math.max(rect.width/width,rect.height/height);
    entry.bitmapWidth=width;entry.bitmapHeight=height;entry.sourceScale=scale;entry.objectPosition=position;entry.sourceRadii=sourceRadii(image,rect);
    visual.className='lf-opening-visual';visual.style.width=width+'px';visual.style.height=height+'px';return visual;
  }
  function heldPreview(image, rect) {
    // A playing inline preview can cover the still img. Preserve the frame the
    // user actually sees, without moving YouTube's video/player DOM or reading
    // pixels out of the canvas. Cross-origin media may taint it; no export is used.
    var videos=doc.querySelectorAll('video');
    for(var i=0;i<Math.min(videos.length,4);i++){
      var video=videos[i];
      if(video.readyState<2||video.videoWidth<=0||video.videoHeight<=0)continue;
      var v=video.getBoundingClientRect();
      if(Math.abs(v.left-rect.left)>2||Math.abs(v.top-rect.top)>2||Math.abs(v.width-rect.width)>2||Math.abs(v.height-rect.height)>2)continue;
      var shown=win.getComputedStyle(video);
      if(shown.display==='none'||shown.visibility==='hidden'||shown.opacity==='0')continue;
      var canvas=doc.createElement('canvas'), scale=Math.min(2,win.devicePixelRatio||1);
      canvas.width=Math.round(rect.width*scale);canvas.height=Math.round(rect.height*scale);
      try{
        var context=canvas.getContext('2d');if(!context)continue;
        context.fillStyle='#000';context.fillRect(0,0,canvas.width,canvas.height);
        var contain=Math.min(canvas.width/video.videoWidth,canvas.height/video.videoHeight),factor=shown.objectFit==='cover'?Math.max(canvas.width/video.videoWidth,canvas.height/video.videoHeight):shown.objectFit==='none'?scale:shown.objectFit==='scale-down'?Math.min(scale,contain):contain;
        var width=shown.objectFit==='fill'?canvas.width:video.videoWidth*factor,height=shown.objectFit==='fill'?canvas.height:video.videoHeight*factor,position=objectPosition(shown.objectPosition)||[.5,.5,0,0];
        context.drawImage(video,(canvas.width-width)*position[0]+position[2]*scale,(canvas.height-height)*position[1]+position[3]*scale,width,height);
        canvas.setAttribute('data-lf-held-preview','');return canvas;
      }catch(_){/* An unavailable preview keeps the validated still fallback. */}
    }
    return null;
  }
  win.__langformBeginWatchOpening = function (image, href) {
    var url; try { url = new URL(href, win.location.href); } catch (_) { return null; }
    if (!image || !image.isConnected || !image.complete || image.naturalWidth <= 0 || !image.currentSrc ||
        !doc.body || !/^(m\.|www\.)?youtube\.com$/.test(url.hostname) || url.pathname !== '/watch' ||
        !/^[A-Za-z0-9_-]{11}$/.test(url.searchParams.get('v') || '')) return null;
    var rect = image.getBoundingClientRect();
    if (rect.width < 64 || rect.height < 36 || !image.animate) return null;
    // No fetch, decoding, snapshot, timeout, or native acknowledgement precedes
    // this point. The clone uses the same decoded currentSrc as the visible img.
    var interrupted=current&&current.image===image&&current.id===url.searchParams.get('v')&&!current.reduced
      ? {pose:presentation(current),velocity:flightVelocity(current)}:null;
    clean(current);
    mountStyle();
    var safe = win.__langformStageInsets || { top:0 };
    var entry = { id:url.searchParams.get('v'), token:'opening-'+(++serial)+'-'+Math.round(win.performance.now()*1000),
      started:win.performance.now(), image:image, effects:[], reduced:spatialReduced(),
      watch:win.location.pathname === '/watch', base:{ x:rect.left, y:rect.top, width:rect.width, height:rect.height },
      target:{ x:0, y:(safe.top||0)+48, width:win.innerWidth, height:win.innerWidth*9/16 }, landed:false, reversing:false };
    current = entry;
    var root = element('div','',doc.documentElement); root.id = 'langform-watch-opening'; entry.root = root;
    root.setAttribute('aria-hidden','true');
    var color = win.getComputedStyle(doc.body).backgroundColor;
    if (!color || color === 'rgba(0, 0, 0, 0)' || color === 'transparent') color = win.matchMedia('(prefers-color-scheme: dark)').matches ? '#0f0f0f' : '#fff';
    // The overlay is outside YouTube's app/theme subtree. Give its loading
    // shapes contrast even when that subtree owns the text-color variable.
    var channels=color.match(/[\d.]+/g), dark=channels&&channels.length>=3
      ? (Number(channels[0])+Number(channels[1])+Number(channels[2]))/3<128 : color!=='#fff';
    root.style.color=dark?'#f1f1f1':'#0f0f0f';
    entry.wash = element('div','lf-opening-wash',root); entry.wash.style.backgroundColor = color;
    var details = element('div','lf-opening-details',root); details.style.top = (entry.target.y+entry.target.height)+'px'; entry.details = details;
    for (var section of ['title','channel','buttons','comments','recommendation']) {
      var block = element('div','lf-opening-block lf-opening-'+section,details);
      if (section === 'channel') element('div','lf-opening-avatar',block);
      if (section === 'buttons') for (var j=0;j<3;j++) element('div','lf-opening-pill',block);
      if (section === 'title' || section === 'comments' || section === 'channel') {
        var line = element('div','lf-opening-line',block); line.style.width = section === 'title' ? '84%' : '68%';
        if (section === 'title') { var second = element('div','lf-opening-line',block); second.style.width='58%'; }
      }
      entry.effects.push(fade(block,0,1,fadeDuration(),entry.reduced ? 0 : 60+entry.effects.length*45));
    }
    entry.picture = element('div','lf-opening-picture',root);
    var preview=entry.watch?null:heldPreview(image,rect);entry.preview=!!preview;
    entry.visual=bitmap(entry,image,preview,rect);if(!entry.visual){clean(entry);return null;}entry.picture.appendChild(entry.visual);
    entry.picture.style.backgroundColor=win.getComputedStyle(image).backgroundColor;
    if(!entry.reduced)image.setAttribute('data-lf-opening-origin','');
    var app = doc.querySelector('ytm-app, ytd-app'); entry.app = app;
    if (app) { entry.appFade=app.animate([{opacity:1},{opacity:0}],{duration:entry.reduced?160:260,fill:'forwards',easing:'ease-out'}); entry.effects.push(entry.appFade); }
    var bar = doc.querySelector('ytm-pivot-bar-renderer, ytm-pivot-bar');
    entry.bar = bar;
    if(bar)entry.barTransform=[bar.style.getPropertyValue('transform'),bar.style.getPropertyPriority('transform')];
    if (bar && !entry.reduced) {entry.barAnimation=bar.animate([{transform:'translateY(0)'},{transform:'translateY(90px)'}],{duration:300,fill:'forwards',easing:'cubic-bezier(.16,1,.3,1)'});entry.effects.push(entry.barAnimation);}
    entry.effects.push(entry.wash.animate([{opacity:0},{opacity:1}],{duration:entry.reduced?160:260,fill:'forwards',easing:'ease-out'}));
    function landed() { if (current !== entry || entry.reversing) return; entry.landed=true; post(entry,'landed'); }
    if (entry.reduced) {
      entry.lastPose=flightPose(entry,entry.target,false);writePose(entry,entry.lastPose);
      var dissolve=entry.picture.animate([{opacity:0},{opacity:1}],{duration:fadeDuration(),fill:'forwards',easing:fadeEasing()});
      entry.effects.push(dissolve); dissolve.onfinish=landed;
    } else motion(entry,interrupted?interrupted.pose:flightPose(entry,entry.base,true),flightPose(entry,entry.target,false),interrupted&&interrupted.velocity,landed);
    post(entry,'started');
    return entry.token;
  };
  win.__langformWatchOpeningUsesPreview=function(token){return !!(current&&current.token===token&&current.preview);};
  win.__langformWatchOpeningControl = function (command, token) {
    var entry=current; if (!entry || entry.token !== token) return false;
    if (command === 'ready') {
      doc.documentElement.setAttribute('data-lf-opening-transparent','');
      if (entry.watch && entry.appFade) entry.appFade.cancel();
      entry.effects.push(entry.wash.animate([{opacity:1},{opacity:0}],{duration:160,fill:'forwards'}));
      entry.effects.push(entry.details.animate([{opacity:1},{opacity:0}],{duration:160,fill:'forwards'}));
      return true;
    }
    if (command === 'reverse') {
      if (entry.reversing) return true;
      entry.reversing=true;
      var shown=presentation(entry),velocity=flightVelocity(entry);
      cancelFlight(entry);
      // New effects override the running effects from their presentation
      // values. Keep the old effects until cleanup: cancelling them here
      // would snap the feed, wash and tab bar to their initial styles.
      function unfade(node,to,duration){
        if(!node)return;
        var opacity=Number(win.getComputedStyle(node).opacity);
        entry.effects.push(node.animate([{opacity:opacity},{opacity:to}],{duration:duration,fill:'forwards',easing:'ease-out'}));
      }
      unfade(entry.wash,0,entry.reduced?160:240);
      unfade(entry.details,0,entry.reduced?160:180);
      unfade(entry.app,1,entry.reduced?160:240);
      if(entry.bar&&!entry.reduced){
        var barPose=win.getComputedStyle(entry.bar).transform;
        entry.effects.push(entry.bar.animate([{transform:barPose},{transform:'translateY(0)'}],{duration:240,fill:'forwards',easing:'cubic-bezier(.16,1,.3,1)'}));
      }
      if (entry.reduced) {
        if(entry.image)entry.image.removeAttribute('data-lf-opening-origin');
        var dissolve=entry.picture.animate([{opacity:Number(win.getComputedStyle(entry.picture).opacity)},{opacity:0}],{duration:fadeDuration(),fill:'forwards',easing:fadeEasing()});
        entry.effects.push(dissolve);dissolve.onfinish=function(){if(current===entry)clean(entry,'cancelled');};
        return true;
      }
      motion(entry,shown,flightPose(entry,entry.base,true),velocity,function(){clean(entry,'cancelled');});
      return true;
    }
    if (command === 'discard' || command === 'finish') { clean(entry); return true; }
    if (command === 'status') return { token:entry.token, id:entry.id, landed:entry.landed, reversing:entry.reversing, rect:pose(entry), target:entry.target };
    return false;
  };
  function reduceRunningFlight(){
    var entry=current; if (!entry || !spatialReduced() || entry.reduced) return;
    entry.reduced=true;
    if(entry.barAnimation&&entry.bar){var barPose=win.getComputedStyle(entry.bar).transform;entry.barAnimation.cancel();entry.bar.style.transform=barPose;entry.barFrozen=true;}
    if (entry.reversing) { clean(entry,'cancelled'); return; }
    if(entry.landed)return;
    var shown=presentation(entry);cancelFlight(entry);writePose(entry,shown);
    var oldPicture=entry.picture,oldVisual=entry.visual,newVisual;
    if(oldVisual.tagName==='CANVAS'){
      newVisual=doc.createElement('canvas');newVisual.width=oldVisual.width;newVisual.height=oldVisual.height;
      try{newVisual.getContext('2d').drawImage(oldVisual,0,0);}catch(_){clean(entry,'discarded');return;}
      newVisual.className='lf-opening-visual';newVisual.style.width=entry.bitmapWidth+'px';newVisual.style.height=entry.bitmapHeight+'px';
    }else newVisual=oldVisual.cloneNode(false);
    entry.picture=element('div','lf-opening-picture',entry.root);entry.visual=newVisual;entry.picture.appendChild(newVisual);
    entry.lastPose=flightPose(entry,entry.target,false);writePose(entry,entry.lastPose);
    entry.effects.push(fade(oldPicture,Number(win.getComputedStyle(oldPicture).opacity),0,fadeDuration()));
    var dissolve=fade(entry.picture,0,1,fadeDuration());entry.effects.push(dissolve);
    dissolve.onfinish=function(){if(current!==entry||entry.reversing)return;oldPicture.remove();entry.landed=true;post(entry,'landed');};
  }
  if(reduced&&reduced.addEventListener)reduced.addEventListener('change',reduceRunningFlight);
  win.addEventListener('langform-motion-change',reduceRunningFlight);
  win.addEventListener('pagehide',function(){clean(current,'discarded');});
  // Existing Watch renderers retain their dimensions; only transform/opacity
  // changes. Newly hydrated groups get one entrance, never a second reset.
  var contentID=null, contentObserver=null, contentSeen=new WeakSet(), contentEffects=[], contentGeneration=0;
  win.__langformRevealWatchContent=function(id){
    if (win.location.pathname !== '/watch' || new URL(win.location.href).searchParams.get('v') !== id) return false;
    if (contentID===id) return true;
    if (contentObserver) contentObserver.disconnect(); contentEffects.forEach(function(a){a.cancel();});
    contentEffects=[]; contentSeen=new WeakSet(); contentID=id; var generation=++contentGeneration;
    doc.documentElement.setAttribute('data-lf-watch-content','');
    var groups=['ytm-slim-video-information-renderer, ytm-video-primary-info-renderer',
      'ytm-slim-owner-renderer, ytm-video-owner-renderer',
      'ytm-slim-video-action-bar-renderer, ytm-menu-renderer',
      'ytm-comments-entry-point-header-renderer, ytm-item-section-renderer:has(.ytCommentsEntryPointTeaserViewModelHost)',
      'ytm-video-with-context-renderer'];
    function scan(){
      if(new URL(win.location.href).searchParams.get('v')!==contentID)return;
      groups.forEach(function(selector,index){
        var nodes=doc.querySelectorAll(selector);
        for(var i=0;i<Math.min(nodes.length,3);i++){
          var node=nodes[i];if(contentSeen.has(node)||!node.animate||node.closest('#langform-watch-opening'))continue;
          contentSeen.add(node);
          if(!(reduced&&reduced.matches))contentEffects.push(node.animate([{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{duration:240,delay:index*45,fill:'backwards',easing:'cubic-bezier(.16,1,.3,1)'}));
        }
      });
    }
    scan(); contentObserver=new win.MutationObserver(scan); contentObserver.observe(doc.body,{childList:true,subtree:true});
    // Hydration watching is bounded and does not run throughout playback.
    win.setTimeout(function(){if(contentGeneration===generation&&contentObserver){contentObserver.disconnect();contentObserver=null;}},4000);
    return true;
  };
  // YouTube returns the first comment teaser and recommendations in the
  // Watch response. Native starts that ordinary request at the tap, behind
  // the moving image. Keep its account, sorting and lazy comment-panel path.
  // No duplicate next request or authentication/fetch wrapper is necessary.
  win.addEventListener('pagehide',function(){if(contentObserver)contentObserver.disconnect();});
})(typeof window !== 'undefined' ? window : this);
