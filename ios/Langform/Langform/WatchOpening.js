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
#langform-watch-opening .lf-opening-picture { position:absolute; left:0; top:0; transform-origin:0 0; overflow:hidden; will-change:transform; }
#langform-watch-opening .lf-opening-picture img { display:block!important; width:100%!important; height:100%!important; object-fit:cover!important; max-width:none!important; border-radius:0!important; opacity:1!important; transform:none!important; }
#langform-watch-opening .lf-opening-picture canvas { display:block; width:100%; height:100%; }
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
  // omega=24, damping=.94: rapid launch, almost no overshoot, settled ~.4 s.
  // A reversal carries its actual velocity into the same oscillator.
  function spring(t, initialVelocity) {
    var omega = 24, damping = .94, damped = omega * Math.sqrt(1 - damping * damping);
    var a = -1, b = (initialVelocity - damping * omega) / damped;
    return 1 + Math.exp(-damping * omega * t) * (a * Math.cos(damped * t) + b * Math.sin(damped * t));
  }
  function transform(rect, base) {
    return 'translate(' + rect.x + 'px,' + rect.y + 'px) scale(' + rect.width / base.width + ',' + rect.height / base.height + ')';
  }
  function pose(entry) {
    // One presentation read at takeover, never a DOM measurement per frame.
    var matrix = win.getComputedStyle(entry.picture).transform;
    var match = matrix && matrix.match(/^matrix\(([^)]+)\)$/);
    if (match) {
      var n = match[1].split(',').map(Number);
      if (n.length === 6 && n.every(Number.isFinite)) return { x:n[4], y:n[5], width:entry.base.width*n[0], height:entry.base.height*n[3] };
    }
    return entry.lastTarget || entry.base;
  }
  function motion(entry, from, to, duration, velocity, done) {
    var keyframes = [];
    for (var i = 0; i <= 60; i++) {
      var p = i === 60 ? 1 : spring(duration * i / 60, velocity || 0);
      keyframes.push({ offset:i/60, transform:transform({ x:from.x+(to.x-from.x)*p, y:from.y+(to.y-from.y)*p,
        width:from.width+(to.width-from.width)*p, height:from.height+(to.height-from.height)*p }, entry.base) });
    }
    entry.from = from; entry.lastTarget = to; entry.motionStarted = win.performance.now(); entry.duration = duration;
    entry.picture.style.transform = transform(from, entry.base);
    entry.animation = entry.picture.animate(keyframes, { duration:duration*1000, fill:'forwards', easing:'linear' });
    var animation = entry.animation;
    animation.onfinish = function () {
      if (current !== entry || entry.animation !== animation) return;
      entry.picture.style.transform = transform(to, entry.base); animation.cancel(); entry.animation = null; done();
    };
  }
  function fade(node, from, to, duration, delay) {
    return node.animate([{ opacity:from, transform:'translateY('+(from === 0 ? 12 : 0)+'px)' },
      { opacity:to, transform:'translateY(0)' }], { duration:duration, delay:delay||0, fill:'forwards', easing:'cubic-bezier(.16,1,.3,1)' });
  }
  function clean(entry, report) {
    if (!entry) return;
    if (entry.animation) entry.animation.cancel();
    entry.effects.forEach(function (a) { a.cancel(); });
    if (entry.image) entry.image.removeAttribute('data-lf-opening-origin');
    if (entry.root) entry.root.remove();
    doc.documentElement.removeAttribute('data-lf-opening-transparent');
    if (current === entry) current = null;
    if (report) post(entry, report);
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
        var factor=shown.objectFit==='cover'?Math.max(canvas.width/video.videoWidth,canvas.height/video.videoHeight)
          :Math.min(canvas.width/video.videoWidth,canvas.height/video.videoHeight);
        var width=video.videoWidth*factor,height=video.videoHeight*factor;
        context.drawImage(video,(canvas.width-width)/2,(canvas.height-height)/2,width,height);
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
    clean(current);
    mountStyle();
    var safe = win.__langformStageInsets || { top:0 };
    var entry = { id:url.searchParams.get('v'), token:'opening-'+(++serial)+'-'+Math.round(win.performance.now()*1000),
      started:win.performance.now(), image:image, effects:[], reduced:!!(reduced && reduced.matches),
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
      entry.effects.push(fade(block,0,1,entry.reduced ? 160 : 260,entry.reduced ? 0 : 60+entry.effects.length*45));
    }
    entry.picture = element('div','lf-opening-picture',root);
    entry.picture.style.width=rect.width+'px'; entry.picture.style.height=rect.height+'px';
    var preview=entry.watch?null:heldPreview(image,rect);entry.preview=!!preview;
    if(preview)entry.picture.appendChild(preview);
    else{
      var copy = image.cloneNode(false); copy.removeAttribute('id'); copy.removeAttribute('srcset'); copy.removeAttribute('sizes'); copy.removeAttribute('style');
      copy.removeAttribute('data-lf-opening-origin'); copy.src=image.currentSrc; copy.alt=''; entry.picture.appendChild(copy);
    }
    image.setAttribute('data-lf-opening-origin','');
    var app = doc.querySelector('ytm-app, ytd-app'); entry.app = app;
    if (app) { entry.appFade=app.animate([{opacity:1},{opacity:0}],{duration:entry.reduced?160:260,fill:'forwards',easing:'ease-out'}); entry.effects.push(entry.appFade); }
    var bar = doc.querySelector('ytm-pivot-bar-renderer, ytm-pivot-bar');
    entry.bar = bar;
    if (bar && !entry.reduced) entry.effects.push(bar.animate([{transform:'translateY(0)'},{transform:'translateY(90px)'}],{duration:300,fill:'forwards',easing:'cubic-bezier(.16,1,.3,1)'}));
    entry.effects.push(entry.wash.animate([{opacity:0},{opacity:1}],{duration:entry.reduced?160:260,fill:'forwards',easing:'ease-out'}));
    function landed() { if (current !== entry || entry.reversing) return; entry.landed=true; post(entry,'landed'); }
    if (entry.reduced) {
      entry.picture.style.transform=transform(entry.target,entry.base);
      var dissolve=entry.picture.animate([{opacity:0},{opacity:1}],{duration:160,fill:'forwards'});
      entry.effects.push(dissolve); dissolve.onfinish=landed;
    } else motion(entry,entry.base,entry.target,.4,0,landed);
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
      var shown=pose(entry);
      if (entry.animation) entry.animation.cancel();
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
        var dissolve=entry.picture.animate([{opacity:Number(win.getComputedStyle(entry.picture).opacity)},{opacity:0}],{duration:160,fill:'forwards'});
        entry.effects.push(dissolve);dissolve.onfinish=function(){if(current===entry)clean(entry,'cancelled');};
        return true;
      }
      var time=Math.max(0,(win.performance.now()-entry.motionStarted)/1000);
      var velocity=(spring(time+.001,0)-spring(time,0))/.001;
      var distance=entry.base.y-shown.y, total=entry.target.y-entry.base.y;
      var relative=Math.abs(distance)>1 ? Math.max(-12,Math.min(12,velocity*total/distance)) : 0;
      motion(entry,shown,entry.base,.32,relative,function(){clean(entry,'cancelled');});
      return true;
    }
    if (command === 'discard' || command === 'finish') { clean(entry); return true; }
    if (command === 'status') return { token:entry.token, id:entry.id, landed:entry.landed, reversing:entry.reversing, rect:pose(entry), target:entry.target };
    return false;
  };
  if (reduced && reduced.addEventListener) reduced.addEventListener('change',function(){
    var entry=current; if (!entry || !reduced.matches) return;
    if (entry.reversing) { clean(entry,'cancelled'); return; }
    if (entry.animation) entry.animation.cancel(); entry.animation=null;
    entry.picture.style.transform=transform(entry.target,entry.base); entry.landed=true; post(entry,'landed');
  });
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
