// Mobile YouTube renders the thumbs as decoration inside the comment's menu
// button. Independent sibling buttons cover those existing icons; the original
// menu executes the real reaction and remains the authority for state/counts.
(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformCommentReactions ||
      win.location.hostname !== 'm.youtube.com' ||
      typeof win.__langformObserveOverlayContainers !== 'function') return;
  win.__langformCommentReactions = true;
  var doc = win.document, panels = new Map(), entries = new Map(), frame = 0, pending = null, alive = true, noticeTimer = 0, traceCount = 0;
  var containerSelector = 'bottom-sheet-container, #dialog-container';
  var style = doc.createElement('style'); style.id = 'langform-comment-reactions-style';
  style.textContent = `
ytm-comment-renderer[data-langform-comment-reactions] { position:relative; }
[data-langform-comment-reaction-slot] { width:auto!important; min-width:44px; height:44px!important; padding:0 4px; box-sizing:border-box; }
button[data-langform-comment-reaction] { position:absolute; z-index:1; min-width:44px; min-height:44px; padding:0; margin:0; border:0; border-radius:8px; background:transparent; color:inherit; cursor:pointer; touch-action:manipulation; }
button[data-langform-comment-reaction]:active { background:#8883; }
button[data-langform-comment-reaction]:focus-visible { outline:2px solid currentColor; outline-offset:-2px; }
[data-langform-comment-direct-menu], [data-langform-comment-direct-menu] * { visibility:hidden!important; }
#langform-comment-reaction-notice { position:fixed; z-index:2147483646; bottom:calc(20px + env(safe-area-inset-bottom)); left:24px; right:24px; max-width:420px; margin:auto; padding:12px 16px; border-radius:12px; color:#fff; background:#252525; font:14px/1.4 -apple-system,sans-serif; pointer-events:none; }
#langform-comment-reaction-notice:empty { display:none; }
`;
  var notice = doc.createElement('div'); notice.id = 'langform-comment-reaction-notice';
  notice.setAttribute('role','status'); notice.setAttribute('aria-live','polite');
  function install() {
    if (!style.isConnected) (doc.head || doc.documentElement).appendChild(style);
    if (doc.body && !notice.isConnected) doc.body.appendChild(notice);
  }
  function message(text) {
    install(); notice.textContent = text;
    if (noticeTimer) win.clearTimeout(noticeTimer);
    noticeTimer = text ? win.setTimeout(function () { notice.textContent=''; noticeTimer=0; },3500) : 0;
  }
  function shown(node) { return node.isConnected && !node.hidden && node.getAttribute('aria-hidden') !== 'true'; }
  function signature(entry) {
    return ['.YtmCommentRendererHeader','.YtmCommentRendererText'].map(function (selector) {
      var node=entry.content.querySelector(selector); return node ? node.textContent : '';
    }).join('\n');
  }
  function owns(entry) {
    return alive && entry.root.isConnected && entry.panel.isConnected &&
      entry.root.closest('ytm-engagement-panel') === entry.panel &&
      entry.root.querySelector('.YtmCommentRendererContent') === entry.content &&
      entry.slots.every(function (slot) { return slot.isConnected && entry.content.contains(slot) && slot.closest('ytm-comment-renderer') === entry.root && slot.querySelector('.YtmCommentRendererActionIcon'); });
  }
  function selected(entry,index) { var icon=entry.slots[index].querySelector('.YtmCommentRendererActionIcon'); return !!icon && icon.getAttribute('data-selected') === 'true'; }
  function disabled(entry,index) {
    var icon=entry.slots[index].querySelector('.YtmCommentRendererActionIcon');
    return !icon || icon.getAttribute('data-disabled') === 'true' || entry.content.disabled;
  }
  function attribute(node,key,value) { if (node.getAttribute(key)!==value) node.setAttribute(key,value); }
  function schedule() { if (alive && !frame) frame=win.requestAnimationFrame(sync); }
  function syncEntry(entry) {
    if (!owns(entry)) { remove(entry); return; }
    var root=entry.root.getBoundingClientRect();
    entry.buttons.forEach(function (button,index) {
      var slot=entry.slots[index],rect=slot.getBoundingClientRect();
      button.hidden = !shown(entry.panel) || rect.width<=0 || rect.height<=0;
      // Both are descendants of the same comment. Scroll and sheet translation
      // move them together; no geometry reads on ordinary scrolling.
      var values={left:(rect.left-root.left+entry.root.scrollLeft-entry.root.clientLeft)+'px',top:(rect.top-root.top+entry.root.scrollTop-entry.root.clientTop)+'px',width:rect.width+'px',height:rect.height+'px'};
      Object.keys(values).forEach(function (key) { if (button.style[key]!==values[key]) button.style[key]=values[key]; });
      attribute(button,'aria-pressed',String(selected(entry,index)));
      button.disabled=disabled(entry,index) || !!pending;
      attribute(button,'aria-busy',String(!!pending && pending.entry===entry));
    });
  }
  function decorate(root,panel) {
    if (entries.has(root)) return;
    var content=root.querySelector('.YtmCommentRendererContent'),details=content && content.querySelector('.YtmCommentRendererDetails');
    if (!details) return;
    var slots=Array.from(details.children).filter(function (node) { return node.classList.contains('YtmCommentRendererIcons'); }).slice(0,2);
    if (slots.length!==2 || slots.some(function (slot) { return !slot.querySelector('.YtmCommentRendererActionIcon'); })) return;
    var entry={root:root,panel:panel,content:content,slots:slots,buttons:[],slotAttributes:slots.map(function (slot) { return slot.getAttribute('data-langform-comment-reaction-slot'); }),marker:root.getAttribute('data-langform-comment-reactions')};
    entries.set(root,entry); root.setAttribute('data-langform-comment-reactions','');
    slots.forEach(function (slot,index) {
      slot.setAttribute('data-langform-comment-reaction-slot','');
      var button=doc.createElement('button'); button.type='button';
      button.setAttribute('data-langform-comment-reaction',index ? 'dislike' : 'like');
      button.setAttribute('aria-label',index ? 'Kommentar mit Mag ich nicht bewerten' : 'Kommentar mit Mag ich bewerten');
      button.addEventListener('click',function (event) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.button || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.detail>0 && win.performance.now()<(entry.cancelUntil||0)) return;
        activate(entry,index,button);
      });
      button.addEventListener('pointerdown',function (event) { entry.pointer={id:event.pointerId,x:event.clientX,y:event.clientY}; });
      button.addEventListener('pointermove',function (event) {
        if (entry.pointer && entry.pointer.id===event.pointerId && Math.hypot(event.clientX-entry.pointer.x,event.clientY-entry.pointer.y)>10) entry.cancelUntil=win.performance.now()+800;
      });
      button.addEventListener('pointercancel',function () { entry.pointer=null; entry.cancelUntil=win.performance.now()+800; });
      button.addEventListener('pointerup',function () { entry.pointer=null; });
      root.appendChild(button); entry.buttons.push(button);
    });
    if (typeof win.ResizeObserver==='function') {
      entry.resize=new win.ResizeObserver(schedule); entry.resize.observe(root); slots.forEach(function (slot) { entry.resize.observe(slot); });
    }
  }
  function restore(node,name,value) { if (value===null) node.removeAttribute(name); else node.setAttribute(name,value); }
  function remove(entry) {
    if (pending && pending.entry===entry) finish();
    if (entry.resize) entry.resize.disconnect();
    entry.buttons.forEach(function (button) { button.remove(); });
    entry.slots.forEach(function (slot,index) { restore(slot,'data-langform-comment-reaction-slot',entry.slotAttributes[index]); });
    restore(entry.root,'data-langform-comment-reactions',entry.marker); entries.delete(entry.root);
  }
  function sync() {
    frame=0; if (!alive) return;
    entries.forEach(function (entry) { if (!owns(entry)) remove(entry); });
    panels.forEach(function (_,panel) {
      if (!panel.isConnected) { attach(panel,false); return; }
      if (shown(panel)) panel.querySelectorAll('ytm-comment-renderer').forEach(function (root) { decorate(root,panel); });
    });
    entries.forEach(syncEntry);
    if (pending) inspect();
  }
  function activeContainer(node) { return shown(node) && !!node.querySelector('button, .menu-item-button'); }
  function trace(phase,request) {
    if (!win.__langformFullscreenDiagnostics || traceCount>=30) return;
    var bridge=win.webkit && win.webkit.messageHandlers.langformFullscreen;
    if (!bridge) return;
    var menu=request && request.candidate;
    try { bridge.postMessage({kind:'comment-reaction-trace',phase:phase,sequence:++traceCount,
      containerCount:doc.querySelectorAll(containerSelector).length,
      activeCount:Array.from(doc.querySelectorAll(containerSelector)).filter(activeContainer).length,
      actionCount:menu ? menu.querySelectorAll('ytm-toggle-menu-service-item-renderer .menu-item-button, .bottom-sheet-comment-menu-item ytm-menu-service-item-renderer .menu-item-button').length : 0,
      candidate:!!menu,nativeSheet:!!(request && request.nativeSheet),executed:!!(request && request.executed),
      owned:!!(request && sameRequest(request)),sheetOpen:!!(doc.body && doc.body.hasAttribute('bottom-sheet-open')),
      sheetHash:win.location.hash==='#bottom-sheet',closePresent:!!(menu && menu.querySelector(':scope > button.close-button'))}); } catch (_) {}
  }
  // YouTube opens/closes the native action sheet through #bottom-sheet and
  // history.back(). That hash belongs to this command, not to a new video.
  function pageRoute() { try { var url=new URL(win.location.href); return url.origin+url.pathname+url.search; } catch (_) { return win.location.href; } }
  function sameRequest(request) {
    return pending===request && owns(request.entry) && request.opener.isConnected && request.entry.root.contains(request.opener) &&
      pageRoute()===request.href && signature(request.entry)===request.signature;
  }
  function finish(text) {
    var request=pending; if (!request) return;
    trace('finish',request);
    pending=null; request.observer.disconnect(); win.clearTimeout(request.timer);
    if (request.menu) restore(request.menu,'data-langform-comment-direct-menu',request.menuMarker);
    if (text) message(text);
    if (request.executed && owns(request.entry) && shown(request.entry.panel)) {
      syncEntry(request.entry);
      if (!request.button.disabled && !request.entry.root.closest('[inert]') && (doc.activeElement===request.entry.content || doc.activeElement===request.opener || doc.activeElement===doc.body)) {
        try { request.button.focus({preventScroll:true}); } catch (_) {}
      }
    }
    schedule();
  }
  function actionKind(button) {
    var text=(button.getAttribute('aria-label') || button.textContent || '').toLowerCase().replace(/[„“"'’]/g,'').replace(/\s+/g,' ').trim();
    if (['mag ich','mag ich nicht mehr','gefällt mir','gefällt mir nicht mehr','like','unlike','remove like','like this comment'].indexOf(text)>=0) return 0;
    if (['mag ich nicht','gefällt mir nicht','dislike','remove dislike','dislike entfernen','dislike this comment','mag ich nicht entfernen','bewertung mit mag ich nicht entfernen'].indexOf(text)>=0) return 1;
    return -1;
  }
  function inspect() {
    var request=pending; if (!request) return;
    if (!sameRequest(request)) { finish(); return; }
    if (request.executed) {
      if (selected(request.entry,request.index)!==request.selected && (!request.menu.isConnected || !shown(request.menu))) finish();
      return;
    }
    // The own three-dot action may lazy-load its sheet. Accept its native
    // marker transition briefly after the click, only without intervening
    // input/navigation and with the recognizable original comment menu.
    var menu=request.candidate;
    if (!menu && request.awaitNative && win.performance.now()<=request.openUntil &&
        doc.body && doc.body.hasAttribute('bottom-sheet-open') && win.location.hash==='#bottom-sheet') {
      var commentSheets=Array.from(doc.querySelectorAll('bottom-sheet-container')).filter(function (node) {
        return activeContainer(node) && node.querySelector('.bottom-sheet-comment-menu-item ytm-toggle-menu-service-item-renderer .menu-item-button');
      });
      if (commentSheets.length===1) { request.nativeSheet=true; menu=request.candidate=commentSheets[0]; }
    }
    if (!menu && request.nativeSheet) {
      var visibleSheets=Array.from(doc.querySelectorAll('bottom-sheet-container')).filter(activeContainer);
      if (visibleSheets.length===1) menu=request.candidate=visibleSheets[0];
    }
    trace('inspect',request);
    if (!menu || !activeContainer(menu)) return;
    var buttons=Array.from(menu.querySelectorAll('ytm-toggle-menu-service-item-renderer .menu-item-button, .bottom-sheet-comment-menu-item ytm-menu-service-item-renderer .menu-item-button'));
    var matches=buttons.filter(function (button) { return actionKind(button)===request.index; });
    if (matches.length!==1) return; // Keep login, unfamiliar/ambiguous menus and errors visible.
    var button=matches[0],close=menu.querySelector(':scope > button.close-button');
    if (button.disabled || button.getAttribute('aria-disabled')==='true' || !close || !sameRequest(request)) return;
    request.menu=menu; request.menuMarker=menu.getAttribute('data-langform-comment-direct-menu'); menu.setAttribute('data-langform-comment-direct-menu','');
    request.executed=true; // Set before the original action; reentrant observers cannot send it twice.
    try {
      button.click();
      if (sameRequest(request) && shown(menu)) close.click();
    } catch (_) { finish('Die Reaktion konnte nicht ausgeführt werden. Bitte erneut versuchen.'); return; }
    if (!sameRequest(request)) return;
    // finish() returns focus to the exact thumb after the original menu has
    // closed and the source state has changed; never focus a still-busy button.
    inspect();
  }
  function activate(entry,index,button) {
    if (pending || !owns(entry) || !shown(entry.panel) || disabled(entry,index) || entry.root.closest('[inert]')) return;
    // Signed-in comment variants expose their action menu on the dedicated
    // three-dot button. A content tap can instead expand the replies.
    var opener=entry.content.querySelector('button.YtmCommentRendererMenu') || entry.content;
    if (opener.disabled || opener.getAttribute('aria-disabled')==='true') return;
    var before=Array.from(doc.querySelectorAll(containerSelector)).filter(activeContainer);
    if (before.length) return;
    var sheetWasOpen=doc.body && doc.body.hasAttribute('bottom-sheet-open');
    message('');
    var request={entry:entry,index:index,button:button,opener:opener,selected:selected(entry,index),href:pageRoute(),signature:signature(entry),before:before,executed:false,awaitNative:opener!==entry.content && !sheetWasOpen,openUntil:win.performance.now()+500};
    request.observer=new win.MutationObserver(inspect); pending=request;
    // Full-document discovery is limited to this single explicit reaction.
    request.observer.observe(doc,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','aria-hidden','data-selected','data-disabled','bottom-sheet-open']});
    request.timer=win.setTimeout(function () {
      if (!sameRequest(request)) { finish(); return; }
      var nativeDialog=Array.from(doc.querySelectorAll(containerSelector)).some(activeContainer);
      finish(request.executed ? 'YouTube hat die Reaktion noch nicht bestätigt. Bitte den Auswahlzustand prüfen.' : nativeDialog ? '' : 'Die Reaktion ist gerade nicht verfügbar. Bitte erneut versuchen.');
    },2000);
    entries.forEach(syncEntry);
    try {
      trace('open',request);
      opener.click();
      var opened=Array.from(doc.querySelectorAll(containerSelector)).filter(function (node) { return activeContainer(node) && before.indexOf(node)<0; });
      request.candidate=opened.length===1 ? opened[0] : null;
      // Capture an immediate native transition when available; inspect() also
      // supports lazy loading after the dedicated original three-dot action.
      if (!request.candidate && !sheetWasOpen && doc.body && doc.body.hasAttribute('bottom-sheet-open') && win.location.hash==='#bottom-sheet') {
        request.nativeSheet=true;
        var sheets=doc.querySelectorAll('bottom-sheet-container');
        if (sheets.length===1) request.candidate=sheets[0];
      }
      trace('bind',request);
      inspect();
    }
    catch (_) { finish('Die Reaktion konnte nicht ausgeführt werden. Bitte erneut versuchen.'); }
  }
  function attach(panel,connected) {
    if (panel.tagName!=='YTM-ENGAGEMENT-PANEL') return;
    if (!connected) {
      var observer=panels.get(panel); if (observer) observer.disconnect(); panels.delete(panel);
      entries.forEach(function (entry) { if (entry.panel===panel) remove(entry); });
      return;
    }
    if (!alive || panels.has(panel)) return;
    var observer=new win.MutationObserver(schedule);
    observer.observe(panel,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden','aria-hidden','data-selected','data-disabled']});
    panels.set(panel,observer); schedule();
  }
  function cancel() { if (pending) finish(); }
  win.addEventListener('pointerdown',function (event) {
    if (pending && !(event.target.closest && event.target.closest('[data-langform-comment-reaction]'))) cancel();
  },true);
  win.addEventListener('keydown',function (event) { if (pending && (event.key==='Escape' || event.target!==pending.button)) cancel(); },true);
  ['yt-navigate-start','state-navigatestart','engagement-panel-pop'].forEach(function (name) { win.addEventListener(name,cancel); });
  win.addEventListener('popstate',function () { if (pending && !sameRequest(pending)) cancel(); });
  win.addEventListener('resize',schedule);
  doc.addEventListener('visibilitychange',function () { if (doc.hidden) cancel(); });
  win.addEventListener('pagehide',function () {
    cancel(); alive=false; if (frame) win.cancelAnimationFrame(frame); frame=0;
    panels.forEach(function (observer) { observer.disconnect(); }); panels.clear(); entries.forEach(remove);
    if (noticeTimer) win.clearTimeout(noticeTimer); noticeTimer=0; notice.textContent=''; style.remove(); notice.remove();
  });
  win.addEventListener('pageshow',function () { if (!alive) { alive=true; install(); doc.querySelectorAll('ytm-engagement-panel').forEach(function (panel) { attach(panel,true); }); } });
  install(); win.__langformObserveOverlayContainers(attach);
})(window);
