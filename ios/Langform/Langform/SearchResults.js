// Mobile result chips belong to the retained feed, never to a Watch document.
(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformSearchResults) return;
  var handlers = win.webkit && win.webkit.messageHandlers;
  if (!handlers || !handlers.langformNativeSearch || !handlers.langformOpenWatch || handlers.langformPlayer) return;
  win.__langformSearchResults = true;
  var doc = win.document, bar = null, style = null, frame = 0, alive = true;
  var ordered = [], hidden = [], ranked = [];
  var contact = null, trailing = null;
  var unwatchedQuery = null;
  try {
    var initial = new URL(win.location.href);
    if(initial.pathname==='/results' && initial.searchParams.get('lf_unwatched')==='1')unwatchedQuery=initial.searchParams.get('search_query');
  } catch (_) {}
  var filters = [['all','Alle'],['videos','Videos'],['channels','Kanäle'],['unwatched','Ungesehen']];
  var videos = 'ytm-video-with-context-renderer,ytm-compact-video-renderer,ytm-video-renderer,ytd-video-renderer';
  var channels = 'ytm-channel-renderer,ytm-compact-channel-renderer,ytd-channel-renderer';
  var watched = 'ytm-thumbnail-overlay-resume-playback-renderer,ytd-thumbnail-overlay-resume-playback-renderer,.thumbnail-overlay-resume-playback-progress,.ytThumbnailOverlayProgressBarHost,[aria-label="Bereits angesehen"],[aria-label="Watched"]';
  function route() {
    if (!alive || win.__langformFeedActive === false || !/^(?:m\.|www\.)?youtube\.com$/.test(win.location.hostname)) return null;
    var url = new URL(win.location.href);
    if (url.pathname !== '/results' || !url.searchParams.get('search_query')) return null;
    var params = url.searchParams.get('sp') || '';
    try { params = decodeURIComponent(params); } catch (_) {}
    var query=url.searchParams.get('search_query'),unwatched=url.searchParams.get('lf_unwatched')==='1';
    if(unwatched)unwatchedQuery=query;
    else if(query!==unwatchedQuery || params!=='EgIQAQ==')unwatchedQuery=null;
    // YouTube canonicalizes away unknown query parameters after hydration.
    // Retain only this document's explicit extra filter for this exact query.
    return {href:url.href,filter:unwatched || unwatchedQuery===query && params==='EgIQAQ==' ? 'unwatched' :
      params === 'EgIQAg==' ? 'channels' : params === 'EgIQAQ==' ? 'videos' : 'all'};
  }
  win.__langformSearchFilter=function(){var current=route();return current ? current.filter : null;};
  function resetRows() {
    ordered.forEach(function (node) { node.removeAttribute('data-langform-search-order'); }); ordered = [];
    ranked.forEach(function (node) { node.removeAttribute('data-langform-channel-section'); }); ranked = [];
    hidden.forEach(function (node) { node.removeAttribute('data-langform-watched-result'); }); hidden = [];
  }
  function remove() {
    contact = null; trailing = null;
    resetRows();
    if (bar) bar.remove(); bar = null;
    if (doc.documentElement) doc.documentElement.removeAttribute('data-langform-search-chips');
  }
  function chip(target) {
    var button = target && target.closest && target.closest('#langform-search-chips button[data-filter]');
    return button && bar && bar.contains(button) ? button : null;
  }
  function consume(event) { if (event.cancelable) event.preventDefault(); event.stopImmediatePropagation(); }
  function choose(button,event) {
    var current=route(),value=button && button.getAttribute('data-filter');
    if(!current || !button.isConnected || !filters.some(function(f){return f[0]===value;}))return false;
    try { handlers.langformNativeSearch.postMessage({action:'filter',filter:value,href:current.href}); }
    catch (_) { return false; }
    unwatchedQuery=value==='unwatched' ? new URL(current.href).searchParams.get('search_query') : null;
    schedule();
    consume(event);return true;
  }
  function startChipContact(event,point,kind) {
    if(event.isPrimary===false){abandon();return;}
    var button=chip(event.target),current=route();
    if(!button || !current || !point || event.isPrimary===false || event.button>0)return;
    if(contact && contact.kind!==kind)return;
    trailing=null;contact={button:button,kind:kind,id:kind==='touch'?point.identifier:event.pointerId,x:point.clientX,y:point.clientY,href:current.href};
  }
  function abandon() {
    if(contact)trailing={button:contact.button,until:Date.now()+800};
    contact=null;
  }
  function move(event,point,kind) {
    if(!contact || contact.kind!==kind || !point)return;
    if(Math.hypot(point.clientX-contact.x,point.clientY-contact.y)>10)abandon();
  }
  function end(event,point,kind) {
    if(!contact || contact.kind!==kind || !point)return;
    var current=route(),owner=contact;
    if((kind==='touch'?point.identifier:event.pointerId)!==owner.id)return;
    contact=null;
    if(!current || current.href!==owner.href || chip(event.target)!==owner.button || Math.hypot(point.clientX-owner.x,point.clientY-owner.y)>10)return;
    if(choose(owner.button,event))trailing={button:owner.button,until:Date.now()+800};
  }
  win.addEventListener('pointerdown',function(e){startChipContact(e,e,'pointer');},true);
  win.addEventListener('pointermove',function(e){move(e,e,'pointer');},true);
  win.addEventListener('pointerup',function(e){end(e,e,'pointer');},true);
  win.addEventListener('pointercancel',abandon,true);
  win.addEventListener('touchstart',function(e){if(e.touches.length!==1){abandon();return;}startChipContact(e,e.touches[0],'touch');},{capture:true,passive:true});
  win.addEventListener('touchmove',function(e){if(e.touches.length!==1){abandon();return;}move(e,e.touches[0],'touch');},{capture:true,passive:true});
  win.addEventListener('touchend',function(e){end(e,e.changedTouches[0],'touch');},{capture:true,passive:false});
  win.addEventListener('touchcancel',abandon,true);
  win.addEventListener('blur',abandon,true);
  win.addEventListener('click',function(event){
    var button=chip(event.target);if(!button || event.button || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)return;
    if(event.detail>0 && trailing && trailing.button===button && Date.now()<trailing.until){trailing=null;consume(event);return;}
    choose(button,event);
  },true);
  function ensureStyle() {
    if (style && style.isConnected) return;
    style = doc.createElement('style'); style.id = 'langform-search-result-style';
    style.textContent = `
#langform-search-chips {position:fixed;top:calc(48px + var(--lf-safe-top,0px));left:0;right:0;z-index:2000;display:flex;gap:8px;align-items:center;height:46px;box-sizing:border-box;padding:4px max(12px,env(safe-area-inset-right,0px)) 6px max(12px,env(safe-area-inset-left,0px));background:#000;overflow-x:auto;overscroll-behavior:contain;scrollbar-width:none;}
#langform-search-chips button {flex:none;min-height:34px;min-width:54px;border:0;border-radius:8px;padding:6px 12px;background:#272727;color:#fff;font:500 14px -apple-system,BlinkMacSystemFont,sans-serif;}
#langform-search-chips button[aria-pressed=true] {background:#fff;color:#000;}
html[data-langform-search-chips]:not([data-langform-fullscreen]) ytm-app {padding-top:calc(94px + var(--lf-safe-top,0px))!important;}
[data-langform-search-order] {display:flex!important;flex-direction:column!important;}
[data-langform-search-order] > :is(ytm-channel-renderer,ytm-compact-channel-renderer,ytd-channel-renderer) {order:2;}
[data-langform-search-order] > [data-langform-channel-section] {order:2;}
[data-langform-search-order] > :is(ytm-continuation-item-renderer,ytd-continuation-item-renderer) {order:3;}
[data-langform-watched-result] {display:none!important;}
`;
    (doc.head || doc.documentElement).appendChild(style);
  }
  function update() {
    frame = 0;
    var current = route();
    if (!current || !doc.documentElement || !doc.body) { remove(); return; }
    ensureStyle();
    if (!bar || !bar.isConnected) {
      bar = doc.createElement('nav'); bar.id = 'langform-search-chips'; bar.setAttribute('aria-label','Suchfilter');
      filters.forEach(function (filter) {
        var button = doc.createElement('button'); button.type = 'button'; button.textContent = filter[1];
        button.setAttribute('data-filter',filter[0]); button.setAttribute('aria-label',filter[1]);
        bar.appendChild(button);
      });
      doc.body.appendChild(bar);
    }
    doc.documentElement.setAttribute('data-langform-search-chips','');
    bar.querySelectorAll('button').forEach(function (button) {
      var value = String(button.getAttribute('data-filter') === current.filter);
      if (button.getAttribute('aria-pressed') !== value) button.setAttribute('aria-pressed',value);
    });
    resetRows();
    if (current.filter !== 'channels') {
      doc.querySelectorAll(channels).forEach(function (channel) {
        var parent = channel.parentElement;
        if (parent && Array.from(parent.children).some(function (node) { return node.matches(videos); }) && ordered.indexOf(parent) < 0) {
          parent.setAttribute('data-langform-search-order',''); ordered.push(parent);
        }
        var branch = channel;
        for (var depth = 0; branch && branch.parentElement && depth < 8; depth++, branch = branch.parentElement) {
          var group = branch.parentElement;
          if (group === doc.body || group === doc.documentElement) break;
          if (!group.matches('ytm-section-list-renderer,ytm-search-results-renderer,ytm-search,ytd-search,#contents,lazy-list')) continue;
          if (branch.matches(videos) || branch.querySelector(videos) || !group.querySelector(videos)) continue;
          if (ordered.indexOf(group) < 0) { group.setAttribute('data-langform-search-order',''); ordered.push(group); }
          branch.setAttribute('data-langform-channel-section',''); ranked.push(branch);
        }
      });
    }
    if (current.filter === 'unwatched') {
      // Respect YouTube's own watched/progress markers. Do not synthesize an
      // account history or claim knowledge of videos YouTube has not marked.
      doc.querySelectorAll(videos).forEach(function (video) {
        if (video.querySelector(watched)) { video.setAttribute('data-langform-watched-result',''); hidden.push(video); }
      });
    }
  }
  function schedule() { if (alive && !frame) frame = win.requestAnimationFrame(update); }
  var observer = new win.MutationObserver(function (records) {
    if (records.some(function (record) {
      return !record.target.closest || !record.target.closest('#langform-search-chips,#langform-search-result-style');
    })) schedule();
  });
  function start() {
    alive = true;
    observer.observe(doc,{childList:true,subtree:true}); schedule();
  }
  ['yt-navigate-finish','state-navigateend','popstate','langform-feed-visibility'].forEach(function (name) { win.addEventListener(name,schedule); });
  doc.addEventListener('DOMContentLoaded',schedule,{once:true});
  win.addEventListener('pagehide',function () { alive = false; observer.disconnect(); if (frame) win.cancelAnimationFrame(frame); frame = 0; remove(); });
  win.addEventListener('pageshow',start);
  start();
})(window);
