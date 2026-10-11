(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformFullscreen) return;
  var doc = win.document, state = null, idle = 0, alive = true, serial = 0, geometryTrace = null, fullscreenProbe = null, contextReveals = [],inlineSizeOwner=null;
  var reduced = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)');
  var initialID = id();
  var style = doc.createElement('style');
  style.id = 'langform-fullscreen-style';
  style.textContent = `
html[data-langform-fullscreen] { overflow:hidden!important; background:#000!important; }
html[data-langform-fullscreen] body { overflow:hidden!important; }
/* Keep only the live player's ancestor path and our controls visible. Inert
   prevents input but does not hide YouTube's fixed topbar; sibling branches
   can otherwise paint above the video. Opacity also covers descendants with
   their own visibility rule, and retaining layout preserves the inline pose.
   CSS applies to newly hydrated siblings without an extra observer. */
html[data-langform-fullscreen] [data-langform-fullscreen-ancestor] > :not([data-langform-fullscreen-ancestor]):not([data-langform-fullscreen-player]):not(#langform-fullscreen-ui):not(script):not(style):not(link):not(meta) { opacity:0!important; visibility:hidden!important; pointer-events:none!important; }
[data-langform-fullscreen-ancestor] { transform:none!important; contain:none!important; overflow:visible!important; transition:none!important; animation:none!important; }
[data-langform-fullscreen-ancestor], [data-langform-fullscreen-player], [data-langform-fullscreen-player] .html5-video-container { will-change:auto!important; perspective:none!important; filter:none!important; backdrop-filter:none!important; content-visibility:visible!important; contain:none!important; }
[data-langform-fullscreen-player] { position:fixed!important; inset:0!important; width:auto!important; height:auto!important; min-width:0!important; min-height:0!important; max-width:none!important; max-height:none!important; margin:0!important; padding:0!important; border:0!important; aspect-ratio:auto!important; transform:none!important; box-sizing:border-box!important; background:#000!important; z-index:2147483645!important; transition:none!important; animation:none!important; }
[data-langform-fullscreen-player] .html5-video-container { position:absolute!important; inset:0!important; width:100%!important; height:100%!important; min-width:0!important; min-height:0!important; max-width:none!important; max-height:none!important; margin:0!important; padding:0!important; border:0!important; aspect-ratio:auto!important; transform:none!important; transition:none!important; animation:none!important; }
[data-langform-fullscreen-player] video { position:absolute!important; inset:0!important; width:100%!important; height:100%!important; min-width:0!important; min-height:0!important; max-width:none!important; max-height:none!important; margin:0!important; padding:0!important; border:0!important; object-fit:contain!important; object-position:50% 50%!important; aspect-ratio:auto!important; transition:none!important; animation:none!important; }
[data-langform-fullscreen-player] video:not([data-langform-fullscreen-enter-video]):not([data-langform-fullscreen-exit-video]) { transform:none!important; }
[data-langform-fullscreen-exit-layout], [data-langform-fullscreen-exit-layout] .html5-video-container, [data-langform-fullscreen-exit-layout] video, [data-langform-fullscreen-exit-ancestor] { transition:none!important; animation:none!important; }
[data-langform-fullscreen-exit-layout], [data-langform-fullscreen-exit-layout] .html5-video-container, [data-langform-fullscreen-exit-ancestor] { transform:none!important; contain:none!important; overflow:visible!important; }
[data-langform-fullscreen-exit-context], [data-langform-fullscreen-exit-context] * { visibility:hidden!important; }
[data-langform-fullscreen-exit-context] { opacity:0!important; }
[data-langform-fullscreen-player] .ytp-chrome-top, [data-langform-fullscreen-player] .ytp-chrome-bottom, [data-langform-fullscreen-player] .player-controls-content { visibility:hidden!important; }
#langform-fullscreen-ui { position:fixed; inset:0; z-index:2147483646; color:#fff; font:14px -apple-system,BlinkMacSystemFont,sans-serif; touch-action:manipulation; }
#langform-fullscreen-ui[data-exiting] { pointer-events:none; }
#langform-fullscreen-ui[data-exiting] .lf-fs-controls { visibility:hidden; }
#langform-fullscreen-ui[data-entering] { pointer-events:none; }
#langform-fullscreen-ui[data-entering] .lf-fs-controls { visibility:hidden; }
#langform-fullscreen-ui .lf-fs-controls { opacity:1; transition:opacity 140ms ease-out,transform 200ms cubic-bezier(.16,1,.3,1); }
#langform-fullscreen-ui[data-hidden] .lf-fs-controls { opacity:0; pointer-events:none; }
#langform-fullscreen-ui[data-hidden] .lf-fs-top, #langform-fullscreen-ui[data-hidden] .lf-fs-bottom { transform:translateY(var(--lf-fs-offset)); }
#langform-fullscreen-ui[data-hidden] .lf-fs-center { transform:translate(-50%,-50%) scale(.96); }
#langform-fullscreen-ui button svg { display:block; width:24px; height:24px; margin:auto; fill:currentColor; transition:transform 180ms cubic-bezier(.16,1,.3,1); }
#langform-fullscreen-ui .lf-fs-center button svg { width:32px; height:32px; }
#langform-fullscreen-ui button { transition:transform 160ms cubic-bezier(.16,1,.3,1),background-color 120ms ease-out; width:44px; height:44px; padding:0; border:0; border-radius:50%; color:#fff; background:transparent; font:22px -apple-system,sans-serif; cursor:pointer; }
#langform-fullscreen-ui button:active { background:#ffffff25; transform:scale(.94); }
#langform-fullscreen-ui [data-action=back]:active svg { transform:translateX(-3px) rotate(-10deg); }
#langform-fullscreen-ui [data-action=forward]:active svg { transform:translateX(3px) rotate(10deg); }
#langform-fullscreen-ui [data-action=play] svg { animation:lf-fs-glyph 160ms cubic-bezier(.16,1,.3,1); }
#langform-fullscreen-ui :focus-visible { outline:2px solid white; outline-offset:3px; }
@keyframes lf-fs-enter { from { opacity:0; transform:translateY(var(--lf-fs-offset)); } to { opacity:1; transform:translateY(0); } }
@keyframes lf-fs-control-enter { from { opacity:0; transform:translateY(4px) scale(.86); } to { opacity:1; transform:none; } }
@keyframes lf-fs-glyph { from { transform:scale(.8) rotate(-8deg); } to { transform:none; } }
#langform-fullscreen-ui .lf-fs-top, #langform-fullscreen-ui .lf-fs-bottom { animation:lf-fs-enter 200ms cubic-bezier(.16,1,.3,1); }
#langform-fullscreen-ui .lf-fs-top { --lf-fs-offset:-8px; display:flex; align-items:center; gap:12px; padding:calc(10px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) 40px calc(12px + env(safe-area-inset-left)); background:linear-gradient(#000a,transparent); }
#langform-fullscreen-ui .lf-fs-top button { flex:0 0 44px; }
#langform-fullscreen-ui .lf-fs-title { flex:1; min-width:0; font-size:16px; font-weight:600; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
#langform-fullscreen-ui .lf-fs-center { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); display:flex; align-items:center; gap:clamp(24px,8vw,80px); }
#langform-fullscreen-ui .lf-fs-center button { width:56px; height:56px; background:#0006; font-size:18px; animation:lf-fs-control-enter 220ms cubic-bezier(.16,1,.3,1) backwards; }
#langform-fullscreen-ui .lf-fs-center [data-action=back] { animation-delay:24ms; }
#langform-fullscreen-ui .lf-fs-center [data-action=forward] { animation-delay:48ms; }
#langform-fullscreen-ui .lf-fs-center [data-action=play] { width:64px; height:64px; font-size:32px; }
#langform-fullscreen-ui .lf-fs-bottom { --lf-fs-offset:10px; position:absolute; bottom:0; left:0; right:0; padding:32px calc(20px + env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left)); background:linear-gradient(transparent,#000b); }
#langform-fullscreen-ui .lf-fs-chapters, #langform-fullscreen-ui .lf-fs-range-wrap { position:relative; }
#langform-fullscreen-ui .lf-fs-range-wrap { --progress:0%; }
#langform-fullscreen-ui .lf-fs-time { display:flex; align-items:center; justify-content:space-between; font-variant-numeric:tabular-nums; }
#langform-fullscreen-ui [data-clock] { flex:1; min-width:0; }
#langform-fullscreen-ui .lf-fs-speed-wrap { position:relative; margin-left:8px; }
#langform-fullscreen-ui .lf-fs-speed-button { width:64px; font-size:16px; font-weight:600; border-radius:12px; }
#langform-fullscreen-ui .lf-fs-speed-button:disabled { opacity:.5; cursor:default; }
#langform-fullscreen-ui .lf-fs-speed-panel { position:absolute; right:0; bottom:calc(100% + 8px); z-index:3; width:232px; max-width:calc(100vw - 100px); max-height:calc(100dvh - 128px); overflow:auto; overscroll-behavior:contain; border:1px solid #ffffff20; border-radius:16px; background:#181818fa; box-shadow:0 12px 36px #0008; transform-origin:bottom right; animation:lf-fs-speed-enter 180ms cubic-bezier(.16,1,.3,1); }
#langform-fullscreen-ui .lf-fs-speed-panel[hidden] { display:none!important; }
#langform-fullscreen-ui .lf-fs-speed-heading { margin:0; padding:12px 12px 6px; font-size:14px; font-weight:600; }
#langform-fullscreen-ui .lf-fs-speed-options { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:4px; padding:4px 6px 6px; }
#langform-fullscreen-ui .lf-fs-speed-option { display:flex; align-items:center; justify-content:space-between; gap:4px; width:100%; height:44px; padding:0 10px; border-radius:10px; font-size:14px; }
#langform-fullscreen-ui .lf-fs-speed-option[aria-checked=true] { background:#ffffff20; }
#langform-fullscreen-ui .lf-fs-speed-option[aria-checked=true]::after { content:'✓'; font-size:14px; }
#langform-fullscreen-ui .lf-fs-speed-status { margin:0; padding:4px 12px 12px; font-size:12px; line-height:1.4; color:#ddd; }
#langform-fullscreen-ui .lf-fs-speed-panel[data-reduced-motion] { animation:none; }
@keyframes lf-fs-speed-enter { from { opacity:0; transform:translateY(6px) scale(.98); } to { opacity:1; transform:none; } }
#langform-fullscreen-ui input { position:relative; z-index:1; display:block; -webkit-appearance:none; appearance:none; width:100%; margin:0; padding:0; border:0; height:44px; background:transparent; cursor:pointer; }
#langform-fullscreen-ui input::-webkit-slider-runnable-track { height:3px; border-radius:2px; background:linear-gradient(to right,#f03 var(--progress),#ffffff60 var(--progress)); }
#langform-fullscreen-ui input::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px; margin-top:-5.5px; border:0; border-radius:50%; background:#f03; transition:transform 140ms cubic-bezier(.16,1,.3,1); }
#langform-fullscreen-ui input:active::-webkit-slider-thumb { transform:scale(1.25); }
#langform-fullscreen-ui input::-moz-range-track { height:3px; border-radius:2px; background:#ffffff60; }
#langform-fullscreen-ui input::-moz-range-progress { height:3px; background:#f03; }
#langform-fullscreen-ui input::-moz-range-thumb { width:10px; height:10px; border:2px solid #fff; border-radius:50%; background:#f03; }
#langform-fullscreen-ui [data-lf-fs-segmented] input::-webkit-slider-runnable-track { background:transparent; }
#langform-fullscreen-ui [data-lf-fs-segmented] input::-moz-range-track, #langform-fullscreen-ui [data-lf-fs-segmented] input::-moz-range-progress { background:transparent; }
#langform-fullscreen-ui input:disabled { opacity:.5; cursor:default; }
#langform-fullscreen-ui .lf-fs-feedback { position:absolute; top:50%; left:50%; width:144px; height:144px; transform:translate(-50%,-50%); pointer-events:none; }
#langform-fullscreen-ui .lf-fs-feedback[data-kind=back] { margin-left:calc(-60px - clamp(24px,8vw,80px)); }
#langform-fullscreen-ui .lf-fs-feedback[data-kind=forward] { margin-left:calc(60px + clamp(24px,8vw,80px)); }
#langform-fullscreen-ui .lf-fs-feedback-ring { position:absolute; inset:0; border:1px solid #ffffff58; border-radius:50%; background:radial-gradient(circle,#ffffff12 35%,#ffffff04 68%,transparent 70%); }
#langform-fullscreen-ui .lf-fs-feedback-content { position:absolute; left:0; right:0; bottom:calc(100% - 20px); display:flex; flex-direction:column; align-items:center; gap:3px; font-size:18px; font-weight:650; font-variant-numeric:tabular-nums; text-shadow:0 1px 8px #000; }
#langform-fullscreen-ui .lf-fs-feedback svg { width:32px; height:32px; fill:currentColor; }
#langform-fullscreen-ui .lf-fs-feedback[data-kind=back] .lf-fs-feedback-content svg { transform:scaleX(-1); }
@media (prefers-reduced-motion:reduce) { #langform-fullscreen-ui .lf-fs-controls, #langform-fullscreen-ui button, #langform-fullscreen-ui button svg, #langform-fullscreen-ui .lf-fs-speed-panel { transition:none!important; animation:none!important; } #langform-fullscreen-ui button:active, #langform-fullscreen-ui button:active svg { transform:none!important; } #langform-fullscreen-ui input::-webkit-slider-thumb { transition:none; } #langform-fullscreen-ui input:active::-webkit-slider-thumb { transform:none; } #langform-fullscreen-ui .lf-fs-feedback { display:none!important; } }
`;
  (doc.head || doc.documentElement).appendChild(style);
  function id() { try { return win.location.pathname === '/watch' ? new URL(win.location.href).searchParams.get('v') || '' : ''; } catch (_) { return ''; } }
  function nativeFullscreen(video) { return !!(doc.fullscreenElement || doc.webkitFullscreenElement || (video && video.webkitDisplayingFullscreen)); }
  function data(root) { try { return typeof root.getVideoData === 'function' ? root.getVideoData() : null; } catch (_) { return null; } }
  function matching(s) {
    if (!s || id() !== s.id || !s.root.isConnected || !s.video.isConnected || !s.root.contains(s.video)) return false;
    if (s.enterHandoff && (!s.enterStyle || !s.enterStyle.isConnected || !s.video.hasAttribute('data-langform-fullscreen-enter-video'))) return false;
    if (s.presented && (!s.ui || !s.ui.isConnected || !style.isConnected || (s.handoff
      ? !s.exitStyle || !s.exitStyle.isConnected || s.attributes.some(function (entry) { return entry[1].indexOf('data-langform-fullscreen-exit-') === 0 && (!entry[0].isConnected || !entry[0].hasAttribute(entry[1])); })
      : s.attributes.some(function (entry) { return entry[1].indexOf('data-langform-fullscreen') === 0 && (!entry[0].isConnected || !entry[0].hasAttribute(entry[1])); })))) return false;
    var info = data(s.root);
    return info && info.video_id ? info.video_id === s.id : s.id === initialID;
  }
  function ad(s) { var info = s && data(s.root); return !!s && (s.root.classList.contains('ad-showing') || s.root.classList.contains('ad-interrupting') || !!(info && info.isAd)); }
  function seekable(s) { return matching(s) && !ad(s) && s.video.readyState >= 2 && Number.isFinite(s.video.duration) && s.video.duration > 0; }
  function icon(name) {
    var svg = doc.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true'); svg.setAttribute('focusable','false');
    var paths = {
      close:'m6 9 6 6 6-6', search:'M21 21l-5.2-5.2M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', play:'M8 5v14l11-7z', pause:'M6 5h4v14H6zm8 0h4v14h-4z',
      collapse:'M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5',
      back:'M6 7a8 8 0 1 1-2 8M2 7h5V2', forward:'M18 7a8 8 0 1 0 2 8M22 7h-5V2', chevrons:'m4 6 6 6-6 6m10-12 6 6-6 6'
    };
    var path = doc.createElementNS('http://www.w3.org/2000/svg','path'); path.setAttribute('d',paths[name]);
    if (name !== 'play' && name !== 'pause') {
      path.setAttribute('fill','none'); path.setAttribute('stroke','currentColor');
      path.setAttribute('stroke-width',name === 'back' || name === 'forward' ? '1.8' : '2');
      path.setAttribute('stroke-linecap','round'); path.setAttribute('stroke-linejoin','round');
    }
    svg.appendChild(path);
    if (name === 'back' || name === 'forward') {
      var text = doc.createElementNS('http://www.w3.org/2000/svg','text');
      [['x','12'],['y','15'],['text-anchor','middle'],['font-size','8'],['font-weight','600'],['stroke','none']].forEach(function (attribute) { text.setAttribute(attribute[0],attribute[1]); });
      text.textContent = '10'; svg.appendChild(text);
    }
    return svg;
  }
  function buildUI() {
    function node(tag,className,parent) { var result = doc.createElement(tag); if (className) result.className = className; if (parent) parent.appendChild(result); return result; }
    function button(parent,action,label,image) { var result = node('button','',parent); result.type = 'button'; result.setAttribute('data-action',action); result.setAttribute('aria-label',label); result.replaceChildren(icon(image)); return result; }
    var ui = node('div'); ui.id = 'langform-fullscreen-ui'; ui.setAttribute('role','region'); ui.setAttribute('aria-label','Vollbild-Videoplayer');
    var top = node('div','lf-fs-top lf-fs-controls',ui);
    button(top,'exit','Vollbild schließen','close'); node('span','lf-fs-title',top);
    if (win.__langformFullscreenExitProtocol === 1) button(top,'search','Suchen (Vollbild verlassen)','search');
    var center = node('div','lf-fs-center lf-fs-controls',ui);
    button(center,'back','10 Sekunden zurück','back'); button(center,'play','Wiedergabe','play'); button(center,'forward','10 Sekunden vor','forward');
    var bottom = node('div','lf-fs-bottom lf-fs-controls',ui); node('div','lf-fs-chapters',bottom);
    var clock = node('div','lf-fs-time',bottom); node('span','',clock).setAttribute('data-clock','');
    var speed = node('div','lf-fs-speed-wrap',clock), trigger = node('button','lf-fs-speed-button',speed);
    trigger.type = 'button'; trigger.setAttribute('data-action','speed'); trigger.setAttribute('aria-haspopup','menu'); trigger.setAttribute('aria-expanded','false'); trigger.setAttribute('aria-controls','langform-fullscreen-speed');
    var panel = node('div','lf-fs-speed-panel',speed); panel.id = 'langform-fullscreen-speed'; panel.hidden = true; panel.inert = true; panel.setAttribute('role','menu'); panel.setAttribute('aria-label','Wiedergabetempo'); panel.setAttribute('aria-hidden','true');
    node('p','lf-fs-speed-heading',panel).textContent = 'Wiedergabetempo';
    var options = node('div','lf-fs-speed-options',panel); options.setAttribute('role','none');
    [.75,1,1.25,1.5,1.75,2].forEach(function (rate) {
      var option = node('button','lf-fs-speed-option',options); option.type = 'button'; option.tabIndex = -1;
      option.setAttribute('role','menuitemradio'); option.setAttribute('aria-checked','false'); option.setAttribute('data-rate',String(rate));
      node('span','',option).textContent = rateLabel(rate); option.setAttribute('aria-label',rateLabel(rate) + (rate === 1 ? ', normales Tempo' : ''));
    });
    var status = node('p','lf-fs-speed-status',panel); status.hidden = true; status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
    button(clock,'exit','Vollbild verkleinern','collapse');
    var range = node('input','',node('div','lf-fs-range-wrap',bottom)); range.type = 'range'; range.min = '0'; range.step = '0.1'; range.setAttribute('aria-label','Videoposition');
    return ui;
  }
  function scrubTime(s) { return s.pendingScrubTime !== null ? s.pendingScrubTime : Number(s.range.value); }
  function progress(s) {
    var ratio = Number(s.range.max) > 0 ? scrubTime(s) / Number(s.range.max) : 0;
    var value = Math.min(100,Math.max(0,ratio * 100)) + '%';
    if (value !== s.progress) { s.progress = value; s.range.parentElement.style.setProperty('--progress',value); }
  }
  function attribute(node,name,value) { if (node.getAttribute(name) !== value) node.setAttribute(name,value); }
  function rateLabel(value) { return Number.isFinite(value) && value > 0 ? String(Math.round(value * 100) / 100).replace('.',',') + '×' : 'Tempo'; }
  function speedAvailable(s) { return !s.video.error && s.video.readyState >= 1 && Number.isFinite(s.video.duration) && s.video.duration > 0 && Number.isFinite(s.video.playbackRate) && s.video.playbackRate > 0; }
  function speedAllowed(s) { return matching(s) && !ad(s) && speedAvailable(s); }
  function speedStatus(s,text) {
    if (s.speedStatus.textContent !== text) s.speedStatus.textContent = text;
    if (s.speedStatus.hidden !== !text) s.speedStatus.hidden = !text;
  }
  function speedFocus(s,index,focus) {
    s.speedOptions.forEach(function (node,i) { if (node.tabIndex !== (i === index ? 0 : -1)) node.tabIndex = i === index ? 0 : -1; });
    if (focus !== false && s.speedOptions[index]) s.speedOptions[index].focus({preventScroll:true});
  }
  function setSpeedOpen(s,value,focus,pointer) {
    var open = !!value && state === s && speedAllowed(s);
    var heldFocus = s.speedPanel.contains(doc.activeElement);
    if (open && s.chapters && s.chapters.dismiss) s.chapters.dismiss();
    s.speedOpen = open;
    if (s.speedPanel.hidden !== !open) s.speedPanel.hidden = !open;
    if (s.speedPanel.inert !== !open) s.speedPanel.inert = !open;
    attribute(s.speedPanel,'aria-hidden',String(!open)); attribute(s.speedButton,'aria-expanded',String(open));
    if (open) {
      clearFeedback(s); speedStatus(s,'');
      var index = s.speedOptions.findIndex(function (node) { return node.getAttribute('aria-checked') === 'true'; });
      speedFocus(s,index >= 0 ? index : 1,focus);
    } else {
      s.speedOptions.forEach(function (node) { if (node.tabIndex !== -1) node.tabIndex = -1; });
      if (state === s) {
        if (pointer && s.ui.contains(doc.activeElement)) doc.activeElement.blur();
        else if (focus || heldFocus) (s.speedButton.disabled ? s.playButton : s.speedButton).focus({preventScroll:true});
      }
    }
    if (state === s) visible(true);
  }
  function updateSpeed(s,knownOwner) {
    var rate = s.video.playbackRate, allowed = knownOwner ? speedAvailable(s) : speedAllowed(s);
    if (Object.is(s.speedRate,rate) && s.speedAvailable === allowed) return;
    s.speedRate = rate; s.speedAvailable = allowed;
    var label = rateLabel(rate); speedStatus(s,'');
    if (s.speedButton.textContent !== label) s.speedButton.textContent = label;
    attribute(s.speedButton,'aria-label','Wiedergabetempo: ' + label + (allowed ? '' : '. Aktuell nicht verfügbar.'));
    if (s.speedButton.disabled !== !allowed) s.speedButton.disabled = !allowed;
    s.speedOptions.forEach(function (node) { attribute(node,'aria-checked',String(Number(node.getAttribute('data-rate')) === rate)); });
    if (s.speedOpen && !allowed) setSpeedOpen(s,false,true);
  }
  function selectSpeed(s,button,pointer) {
    if (!s.speedOpen || !s.speedPanel.contains(button) || state !== s || !speedAllowed(s)) { update(); return; }
    var rate = Number(button.getAttribute('data-rate'));
    if ([.75,1,1.25,1.5,1.75,2].indexOf(rate) < 0) return;
    clearFeedback(s);
    var rejected = false;
    // Change only the current owned media element. YouTube's ratechange event
    // remains authoritative; defaultPlaybackRate and pitch settings stay intact.
    try { s.video.playbackRate = rate; } catch (_) { rejected = true; }
    if (state !== s) return;
    if (!matching(s) || ad(s)) { close(s.id); return; }
    updateSpeed(s,true);
    if (!rejected && s.video.playbackRate === rate) setSpeedOpen(s,false,!pointer,pointer);
    else speedStatus(s,rejected ? 'Dieses Tempo wird vom Video nicht unterstützt.' : 'Das Video verwendet weiterhin ' + rateLabel(s.video.playbackRate) + '.');
  }
  function clearFeedback(s) {
    if (!s) return;
    s.playConfirmationUntil = 0;
    var previous = s.feedback;
    if (!previous) return;
    s.feedback = null;
    previous.animations.forEach(function (animation) { animation.onfinish = null; animation.cancel(); });
    previous.node.remove();
  }
  function feedback(s,kind,amount) {
    if (state !== s || !matching(s) || ad(s) || doc.hidden || (reduced && reduced.matches) || typeof s.ui.animate !== 'function') { clearFeedback(s); return; }
    var now = win.performance.now(), previous = s.feedback;
    if (amount && previous && previous.kind === kind && now < previous.until) amount += previous.amount;
    clearFeedback(s);
    var node = doc.createElement('div'); node.className = 'lf-fs-feedback';
    node.setAttribute('data-kind',kind); node.setAttribute('aria-hidden','true');
    var ring = doc.createElement('div'); ring.className = 'lf-fs-feedback-ring'; node.appendChild(ring);
    var content = doc.createElement('div'); content.className = 'lf-fs-feedback-content'; node.appendChild(content);
    content.appendChild(icon(amount ? 'chevrons' : kind));
    var label = doc.createElement('span');
    label.textContent = amount ? (amount > 0 ? '+' : '−') + String(Math.round(Math.abs(amount) * 10) / 10).replace('.',',') + ' s' : kind === 'play' ? 'Wiedergabe' : 'Pause';
    content.appendChild(label); s.ui.appendChild(node);
    var effect = { node:node,kind:kind,amount:amount,until:now + 360,animations:[] }; s.feedback = effect;
    var direction = kind === 'back' ? -1 : kind === 'forward' ? 1 : 0;
    var curve = 'cubic-bezier(.16,1,.3,1)';
    try {
      effect.animations.push(ring.animate([{opacity:0,transform:'scale(.55)',easing:curve},{opacity:1,transform:'scale(1.025)',offset:1/3,easing:curve},{opacity:0,transform:'scale(1)'}],{duration:360,fill:'both'}));
      // Three 120ms beats: enter, readable hold, exit. Ease each moving beat
      // separately so the confirmation does not fade before it can be read.
      var confirmation = content.animate([{opacity:0,transform:'translate('+ (-direction * 10) +'px,8px) scale(.92)',easing:curve},{opacity:1,transform:'translate(0,0) scale(1)',offset:1/3},{opacity:1,transform:'translate(0,0) scale(1)',offset:2/3,easing:curve},{opacity:0,transform:'translate('+ (direction * 8) +'px,-5px) scale(1)'}],{duration:360,fill:'both'});
      effect.animations.push(confirmation);
      confirmation.onfinish = function () { if (state === s && s.feedback === effect) clearFeedback(s); };
    } catch (_) { clearFeedback(s); }
  }
  function nativeBridge() {
    try { var bridge = win.webkit && win.webkit.messageHandlers && win.webkit.messageHandlers.langformFullscreen; return bridge && typeof bridge.postMessage === 'function' ? bridge : null; } catch (_) { return null; }
  }
  function emit(open, s, reason) {
    var value = { open:open, href:s.href, videoID:s.id }, posted = false;
    if (open && s.phase === 'entering') { value.kind = 'enter-request'; value.token = s.enterToken; }
    if (reason) value.reason = reason;
    try { var bridge = nativeBridge(); if (bridge) { bridge.postMessage(value); posted = true; } } catch (_) {}
    if (open && !posted) return false;
    win.dispatchEvent(new win.CustomEvent('player-fullscreen-change', { detail:value }));
    return posted;
  }
  function clearIdle() { if (idle) win.clearTimeout(idle); idle = 0; }
  function visible(show) {
    if (!state) return;
    if (state.phase === 'exiting' || state.phase === 'entering') { clearIdle(); return; }
    if (state.video.paused || state.video.ended || state.speedOpen || state.controlContact) show = true;
    if (!show) clearFeedback(state);
    if (state.ui.hasAttribute('data-hidden') === show) state.ui.toggleAttribute('data-hidden', !show);
    state.controls.forEach(function (node) { attribute(node,'aria-hidden',show ? 'false' : 'true'); });
    state.ui.querySelectorAll('button,input').forEach(function (node) { if (!node.closest('.lf-fs-speed-panel') && node.tabIndex !== (show ? 0 : -1)) node.tabIndex = show ? 0 : -1; });
    clearIdle();
    if (show && !state.video.paused && !state.video.ended && !state.dragging && !state.speedOpen && !state.controlContact && !(state.chapters && state.chapters.isOpen && state.chapters.isOpen()) && !state.ui.contains(doc.activeElement)) {
      idle = win.setTimeout(function () { idle = 0; if (state && !state.dragging && !state.speedOpen && !state.controlContact && !(state.chapters && state.chapters.isOpen && state.chapters.isOpen()) && !state.ui.contains(doc.activeElement)) visible(false); }, 3000);
    }
  }
  function time(value) { value = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; var hours = Math.floor(value / 3600), minutes = Math.floor(value / 60) % 60, seconds = value % 60; return (hours ? hours + ':' + String(minutes).padStart(2,'0') : String(minutes)) + ':' + String(seconds).padStart(2,'0'); }
  function update() {
    if (!state) return;
    if (!matching(state) || ad(state) || nativeFullscreen(state.video)) { close(); return; }
    var s = state, video = s.video;
    var playing = !video.paused && !video.ended;
    if (s.feedback && ((s.feedback.kind === 'play' && !playing) || (s.feedback.kind === 'pause' && playing))) clearFeedback(s);
    if (s.playing !== playing) { s.playing = playing; s.playButton.replaceChildren(icon(playing ? 'pause' : 'play')); attribute(s.playButton,'aria-label',playing ? 'Pause' : 'Wiedergabe'); }
    var clock = time(s.dragging || s.pendingScrubTime !== null ? scrubTime(s) : video.currentTime) + ' / ' + (Number.isFinite(video.duration) ? time(video.duration) : 'Live');
    if (s.clock.textContent !== clock) s.clock.textContent = clock;
    var disabled = !seekable(s), duration = String(Number.isFinite(video.duration) ? video.duration : 0);
    if (s.range.disabled !== disabled) s.range.disabled = disabled;
    if (s.range.max !== duration) s.range.max = duration;
    if (!s.dragging && s.pendingScrubTime === null) {
      var position = String(Number.isFinite(video.currentTime) ? video.currentTime : 0);
      if (s.range.value !== position) s.range.value = position;
    }
    attribute(s.range,'aria-valuetext', time(scrubTime(s))); progress(s);
    updateSpeed(s,true);
    if (s.chapters) s.chapters.update();
    if (video.paused || video.ended) visible(true);
  }
  function mark(s,node,name) {
    s.attributes.push([node,name,node.getAttribute(name)]); node.setAttribute(name,'');
    if (s.ownedObserver && (name.indexOf('data-langform-fullscreen-exit-') === 0 || name.indexOf('data-langform-fullscreen-enter-') === 0)) s.ownedObserver.observe(node,{attributes:true,attributeFilter:[name]});
  }
  function restoreScroll(s) {
    if (!s.scroll || id() !== s.id) return;
    try { win.scrollTo({left:s.scroll.x,top:s.scroll.y,behavior:'instant'}); } catch (_) { /* a detached window can no longer scroll */ }
  }
  function pictureBox(video) {
    var rect = video.getBoundingClientRect(), css = win.getComputedStyle(video);
    var iw = Number(video.videoWidth), ih = Number(video.videoHeight), width = rect.width, height = rect.height;
    if (iw > 0 && ih > 0 && width > 0 && height > 0 && css.objectFit !== 'fill') {
      var scale = css.objectFit === 'cover' ? Math.max(width / iw,height / ih) : Math.min(width / iw,height / ih);
      if (css.objectFit === 'none') scale = 1;
      if (css.objectFit === 'scale-down') scale = Math.min(1,scale);
      width = iw * scale; height = ih * scale;
    }
    var positions = String(css.objectPosition || '50% 50%').split(/\s+/);
    function offset(value,free) {
      if (value === 'left' || value === 'top') return 0;
      if (value === 'right' || value === 'bottom') return free;
      var n = parseFloat(value); return Number.isFinite(n) ? (/%$/.test(value) ? free * n / 100 : n) : free / 2;
    }
    return {x:rect.left + offset(positions[0],rect.width - width),y:rect.top + offset(positions[1] || positions[0],rect.height - height),width:width,height:height};
  }
  function validBox(box) { return box && [box.x,box.y,box.width,box.height].every(Number.isFinite) && box.width > 0 && box.height > 0; }
  function flushGeometryTrace(trace) {
    if (!trace.rows.length) return;
    try { var bridge = nativeBridge(); if (bridge) bridge.postMessage({kind:'geometry-trace',videoID:trace.s.id,href:trace.s.href,token:trace.token,rows:trace.rows.splice(0)}); } catch (_) { trace.rows = []; }
  }
  function stopGeometryTrace() {
    if (!geometryTrace) return;
    if (geometryTrace.frame) win.cancelAnimationFrame(geometryTrace.frame);
    flushGeometryTrace(geometryTrace); geometryTrace = null;
  }
  function beginGeometryTrace(s,direction) {
    if (win.__langformFullscreenDiagnostics !== true) return;
    stopGeometryTrace();
    var trace = {s:s,token:direction==='enter' ? s.enterToken : s.exitToken,direction:direction,rows:[],origin:win.performance.now(),end:win.performance.now()+2600,sequence:0,frame:0,phase:'waiting'};
    geometryTrace = trace;
    function sample() {
      if (geometryTrace !== trace) return;
      var now = win.performance.now();
      if (!alive || id() !== s.id || !s.video.isConnected || !s.root.isConnected || state && state !== s || now >= trace.end || trace.sequence >= 240) { stopGeometryTrace(); return; }
      var picture = pictureBox(s.video), outer = s.video.getBoundingClientRect(), root = s.root.getBoundingClientRect();
      var header = doc.querySelector('ytm-mobile-topbar-renderer,ytm-mobile-topbar-renderer-v2');
      var active = state===s && (direction==='enter' ? s.phase==='entering' : s.phase==='exiting');
      var held = direction==='enter' ? s.enterHandoff : s.handoff;
      var row = {sequence:++trace.sequence,documentMilliseconds:now-trace.origin,phase:active ? (held && (direction!=='enter' || s.enterPreparedTarget || s.enterTarget) ? 'handoff' : 'waiting') : trace.phase,
        viewportWidth:Number(win.innerWidth),viewportHeight:Number(win.innerHeight),scrollX:Number(win.scrollX),scrollY:Number(win.scrollY),
        pictureX:picture.x,pictureY:picture.y,pictureWidth:picture.width,pictureHeight:picture.height,
        videoX:outer.x,videoY:outer.y,videoWidth:outer.width,videoHeight:outer.height,
        rootX:root.x,rootY:root.y,rootWidth:root.width,rootHeight:root.height,
        intrinsicWidth:Number(s.video.videoWidth),intrinsicHeight:Number(s.video.videoHeight),currentTime:Number(s.video.currentTime),
        paused:!!s.video.paused,hidden:!!doc.hidden,held:!!held&&state===s,rootFixed:s.root.hasAttribute('data-langform-fullscreen-player'),
        exitContextHidden:direction==='exit' && !!s.exitContext && s.exitContext.length>0 && state===s,
        exitUsingCachedDestination:direction==='exit' && !!s.exitUsingCachedDestination,
        exitMotionBeforeResize:direction==='exit' && !!s.exitMotion && Math.abs(win.innerWidth-s.exitMotion.source.width)<=2 && Math.abs(win.innerHeight-s.exitMotion.source.height)<=2,
        exitMotionRejectedReason:direction==='exit' ? s.exitMotionRejectedReason || 0 : 0};
      row.inlineSizeOwned=!!inlineSizeOwner&&inlineSizeOwner.video===s.video;
      row.inlineSizeSuspended=row.inlineSizeOwned&&state===s;
      row.playerSetSizeAvailable=typeof s.root.setSize==='function';
      if(s.naturalInlineGeometry)Object.keys(s.naturalInlineGeometry).forEach(function(key){var value=s.naturalInlineGeometry[key];if(Number.isFinite(value))row[key]=value;});
      var epoch=Number(win.performance.timeOrigin)+now;
      if (Number.isFinite(epoch)) row.documentEpochMilliseconds=epoch;
      if (header) row.headerY = header.getBoundingClientRect().top;
      trace.rows.push(row);
      if (trace.rows.length >= 12) flushGeometryTrace(trace);
      trace.frame = win.requestAnimationFrame(sample);
    }
    trace.frame = win.requestAnimationFrame(sample);
  }
  function restoreAttribute(entry) { if (entry[2] === null) entry[0].removeAttribute(entry[1]); else entry[0].setAttribute(entry[1],entry[2]); }
  function pinPose(s,box,clip,enter) {
    rememberVideoDimensions(s);setVideoDimensions(s,[[box.width+'px','important'],[box.height+'px','important']]);
    if (ownsInlinePositions(s)) {
      rememberVideoPositions(s);setVideoPositions(s,[[box.y+'px','important'],[box.x+'px','important']]);
    }
    // The box already describes the rendered picture (including object-fit).
    // Filling that exact box preserves its pixels. Applying contain again
    // would fit it twice and mismeasure a nonuniform inline fill on completion.
    var selector = enter ? '[data-langform-fullscreen-player] video[data-langform-fullscreen-enter-video]' : 'video[data-langform-fullscreen-exit-video]';
    (enter ? s.enterStyle : s.exitStyle).textContent = selector + '{position:fixed!important;inset:auto!important;left:' + box.x + 'px!important;top:' + box.y + 'px!important;width:' + box.width + 'px!important;height:' + box.height + 'px!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border:0!important;object-fit:fill!important;object-position:50% 50%!important;aspect-ratio:auto!important;z-index:2147483645!important;transform:none;clip-path:' + (clip || 'inset(0)') + ';transition:none!important;animation:none!important;}';
    if (enter) s.enterPose = box; else s.exitPose = box;
  }
  function exitPose(s,box,clip) { pinPose(s,box,clip,false); }
  function enterPose(s,box,clip) { pinPose(s,box,clip,true); }
  function pictureClip(box,rect) {
    var top=rect.top===undefined?rect.y:rect.top,left=rect.left===undefined?rect.x:rect.left,
      right=rect.right===undefined?rect.x+rect.width:rect.right,bottom=rect.bottom===undefined?rect.y+rect.height:rect.bottom;
    return 'inset(' + [Math.max(0,(top-box.y)/box.height)*100,Math.max(0,(box.x+box.width-right)/box.width)*100,Math.max(0,(box.y+box.height-bottom)/box.height)*100,Math.max(0,(left-box.x)/box.width)*100].map(function (n) { return n + '%'; }).join(' ') + ')';
  }
  function restoreTransform(s,original) {
    if (!original || s.video.style.getPropertyValue('transform') !== 'none') return;
    if (original[0]) s.video.style.setProperty('transform',original[0],original[1]); else s.video.style.removeProperty('transform');
  }
  function rememberVideoDimensions(s) {
    if(!s.videoDimensionLatest)s.videoDimensionLatest=s.videoDimensions.map(function(value){return value.slice();});
    ['width','height'].forEach(function(key,index){var value=[s.video.style.getPropertyValue(key),s.video.style.getPropertyPriority(key)];
      if(!s.dimensionApplied || value[0]!==s.dimensionApplied[index][0] || value[1]!==s.dimensionApplied[index][1])s.videoDimensionLatest[index]=value;
    });
  }
  function setVideoDimensions(s,values) {
    values=values.map(function(value,index){return stylePair(index===0?'width':'height',value);});
    s.dimensionApplied=values.map(function(value){return value.slice();});
    ['width','height'].forEach(function(key,index){var value=values[index];if(s.video.style.getPropertyValue(key)===value[0]&&s.video.style.getPropertyPriority(key)===value[1])return;if(value[0])s.video.style.setProperty(key,value[0],value[1]);else s.video.style.removeProperty(key);});
  }
  function naturalVideoDimensions(s,fullscreen) {
    rememberVideoDimensions(s);
    setVideoDimensions(s,fullscreen || inlineSizeOwner && inlineSizeOwner.video===s.video ? [['100%','important'],['100%','important']] : s.videoDimensionLatest);
  }
  function rememberVideoPositions(s) {
    if (!s.videoPositionLatest) s.videoPositionLatest=s.videoPositions.map(function (value) { return value.slice(); });
    ['top','left'].forEach(function (key,index) {
      var value=[s.video.style.getPropertyValue(key),s.video.style.getPropertyPriority(key)];
      if (!s.positionApplied || value[0]!==s.positionApplied[index][0] || value[1]!==s.positionApplied[index][1]) s.videoPositionLatest[index]=value;
    });
  }
  var positionStyle=doc.createElement('div').style;
  function stylePair(key,value) {
    positionStyle.removeProperty(key);
    if (value[0]) positionStyle.setProperty(key,value[0],value[1]);
    return [positionStyle.getPropertyValue(key),positionStyle.getPropertyPriority(key)];
  }
  function positionPair(value) { return stylePair('top',value); }
  function setVideoPositions(s,values) {
    // CSSOM can serialize a floating point pin (109.99999999999999px) as
    // 110px. Compare the browser's own spelling to retain style ownership.
    values=values.map(positionPair);s.positionApplied=values.map(function (value) { return value.slice(); });
    ['top','left'].forEach(function (key,index) {
      var value=values[index];
      if (s.video.style.getPropertyValue(key)!==value[0] || s.video.style.getPropertyPriority(key)!==value[1]) s.video.style.setProperty(key,value[0],value[1]);
    });
  }
  function naturalVideoPositions(s) {
    if (!ownsInlinePositions(s)) return;
    rememberVideoPositions(s);setVideoPositions(s,[['0px','important'],['0px','important']]);
  }
  function ownerMatches(owner) {
    var info=owner&&data(owner.root);
    return owner && alive && id()===owner.id && doc.getElementById('movie_player')===owner.root && owner.video.isConnected &&
      owner.root.contains(owner.video) && owner.root.querySelector('video')===owner.video && owner.video.closest('.html5-video-container')===owner.container &&
      (info&&info.video_id?info.video_id===owner.id:owner.id===initialID) && !ad(owner);
  }
  function mediaSource(video) { return String(video.currentSrc || video.getAttribute('src') || ''); }
  function ownsInlinePositions(s) { return inlineSizeOwner && inlineSizeOwner.video===s.video && inlineSizeOwner.positions && inlineSizeOwner.positionSource===mediaSource(s.video); }
  function releaseInlinePositions(owner,source) {
    (owner.positions || []).forEach(function (entry,index) {
      var current=[owner.video.style.getPropertyValue(entry[0]),owner.video.style.getPropertyPriority(entry[0])],applied=entry[3],pin=source&&source.positionApplied&&source.positionApplied[index];
      if (source && source.videoPositionLatest) { entry[1]=source.videoPositionLatest[index][0];entry[2]=source.videoPositionLatest[index][1]; }
      if (applied && current[0]===applied[0] && current[1]===applied[1] || pin && current[0]===pin[0] && current[1]===pin[1]) {
        if (entry[1]) owner.video.style.setProperty(entry[0],entry[1],entry[2]);else owner.video.style.removeProperty(entry[0]);
      }
    });
    owner.positions=null;
  }
  function releaseInlineSizeOwner(previousState) {
    var owner=inlineSizeOwner;if(!owner)return;
    inlineSizeOwner=null;owner.observer.disconnect();
    if (owner.sourceChanged) { owner.video.removeEventListener('loadstart',owner.sourceChanged);owner.video.removeEventListener('loadedmetadata',owner.sourceChanged); }
    var source=state&&state.video===owner.video?state:previousState;
    owner.entries.forEach(function(entry){var node=entry[0],key=entry[1],applied=entry[4],index=key==='width'?0:1,current=[node.style.getPropertyValue(key),node.style.getPropertyPriority(key)],pin=source&&node===source.video&&source.dimensionApplied&&source.dimensionApplied[index];
      if(source&&node===source.video&&source.videoDimensionLatest){entry[2]=source.videoDimensionLatest[index][0];entry[3]=source.videoDimensionLatest[index][1];}
      if(applied&&current[0]===applied[0]&&current[1]===applied[1] || pin&&current[0]===pin[0]&&current[1]===pin[1]){
      if(entry[2])node.style.setProperty(key,entry[2],entry[3]);else node.style.removeProperty(key);
    }});
    releaseInlinePositions(owner,source);
  }
  function applyInlineSizeOwner(previousState) {
    var owner=inlineSizeOwner;if(!owner)return;
    if(!ownerMatches(owner)){releaseInlineSizeOwner();return;}
    var s=state&&state.video===owner.video?state:null,source=s || previousState&&previousState.video===owner.video&&previousState,pose=s&&(s.enterHandoff?s.enterPose:s.handoff?s.exitPose:null);
    if (owner.positions && owner.positionSource!==mediaSource(owner.video)) {
      // A held pose belongs to the old media source. Remove the transaction
      // before restoring author !important positioning on its replacement.
      if (s) { finishClose(s,'media-source-changed',true);return; }
      releaseInlinePositions(owner,source);
    }
    if(source)rememberVideoDimensions(source);
    owner.entries.forEach(function(entry){var node=entry[0],key=entry[1],wanted=stylePair(key,[node===owner.video&&pose?pose[key]+'px':'100%','important']),value=wanted[0],index=key==='width'?0:1,current=[node.style.getPropertyValue(key),node.style.getPropertyPriority(key)],applied=entry[4],pin=source&&node===source.video&&source.dimensionApplied&&source.dimensionApplied[index];
      if(source&&node===source.video&&source.videoDimensionLatest){entry[2]=source.videoDimensionLatest[index][0];entry[3]=source.videoDimensionLatest[index][1];}
      else if(!(applied&&current[0]===applied[0]&&current[1]===applied[1] || pin&&current[0]===pin[0]&&current[1]===pin[1])){entry[2]=current[0];entry[3]=current[1];}
      entry[4]=wanted;
      if(node.style.getPropertyValue(key)!==value || node.style.getPropertyPriority(key)!=='important')node.style.setProperty(key,value,'important');
    });
    if(source)source.dimensionApplied=['width','height'].map(function(key){return [source.video.style.getPropertyValue(key),source.video.style.getPropertyPriority(key)];});
    if (owner.positions) {
      if (source) rememberVideoPositions(source);
      owner.positions.forEach(function (entry,index) {
        var wanted=positionPair([pose ? (index===0?pose.y:pose.x)+'px' : '0px','important']),value=wanted[0],current=[owner.video.style.getPropertyValue(entry[0]),owner.video.style.getPropertyPriority(entry[0])],applied=entry[3],pin=source&&source.positionApplied&&source.positionApplied[index];
        if (source && source.videoPositionLatest) { entry[1]=source.videoPositionLatest[index][0];entry[2]=source.videoPositionLatest[index][1]; }
        else if (!(applied && current[0]===applied[0] && current[1]===applied[1] || pin && current[0]===pin[0] && current[1]===pin[1])) { entry[1]=current[0];entry[2]=current[1]; }
        entry[3]=wanted;
        if (current[0]!==value || current[1]!=='important') owner.video.style.setProperty(entry[0],value,'important');
      });
      if (source) source.positionApplied=owner.positions.map(function (entry) { return entry[3].slice(); });
    }
  }
  function claimInlinePositions(owner,s) {
    if (owner.positions || !s.inlinePlacementEligible || s.inlineDestination.source!==mediaSource(s.video)) return;
    rememberVideoPositions(s);
    owner.positions=['top','left'].map(function (key,index) { return [key,s.videoPositionLatest[index][0],s.videoPositionLatest[index][1],null]; });
    owner.positionSource=mediaSource(s.video);
  }
  function claimInlineSizeOwner(s) {
    var container=s.video.closest('.html5-video-container');
    if(!container || !s.root.contains(container))return false;
    if(inlineSizeOwner && inlineSizeOwner.video===s.video && ownerMatches(inlineSizeOwner)){claimInlinePositions(inlineSizeOwner,s);applyInlineSizeOwner();return true;}
    releaseInlineSizeOwner();
    var entries=[];[container,s.video].forEach(function(node){['width','height'].forEach(function(key,index){var original=node===s.video?(s.videoDimensionLatest || s.videoDimensions)[index]:null;
      entries.push([node,key,original?original[0]:node.style.getPropertyValue(key),original?original[1]:node.style.getPropertyPriority(key),null]);
    });});
    var owner={id:s.id,root:s.root,video:s.video,container:container,entries:entries};
    // A YouTube resize can leave landscape top/left values after width/height
    // have recovered. Own placement only for the saved, untransformed video
    // that originally filled its inline player at top/left zero.
    claimInlinePositions(owner,s);
    owner.observer=new win.MutationObserver(applyInlineSizeOwner);inlineSizeOwner=owner;
    owner.observer.observe(container,{attributes:true,attributeFilter:['style']});owner.observer.observe(s.video,{attributes:true,attributeFilter:['style','src']});
    owner.observer.observe(s.root,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    owner.sourceChanged=function () { applyInlineSizeOwner(); };
    s.video.addEventListener('loadstart',owner.sourceChanged);s.video.addEventListener('loadedmetadata',owner.sourceChanged);
    applyInlineSizeOwner();return true;
  }
  function clearEnterPose(s,keepTransform) {
    if (!s.enterHandoff && !s.enterStyle) return;
    if (s.enterFrame) { win.cancelAnimationFrame(s.enterFrame); s.enterFrame = 0; }
    if (s.enterAnimation) { s.enterAnimation.cancel(); s.enterAnimation = null; }
    s.enterHandoff = false;
    s.attributes = s.attributes.filter(function (entry) { if (entry[1] !== 'data-langform-fullscreen-enter-video') return true; restoreAttribute(entry); return false; });
    if (s.enterStyle) { s.enterStyle.remove(); s.enterStyle = null; }
    if(s.videoDimensions)setVideoDimensions(s,keepTransform?[['100%','important'],['100%','important']]:s.videoDimensionLatest || s.videoDimensions);
    if (keepTransform) naturalVideoPositions(s);
    if (keepTransform) s.fullscreenTransform=s.enterTransform;
    else restoreTransform(s,s.enterTransform);
  }
  function freezeEnterHandoff(s) {
    if (!s.enterHandoff) return;
    var box = pictureBox(s.video), clip = win.getComputedStyle(s.video).clipPath;
    if (s.enterAnimation) { s.enterAnimation.cancel(); s.enterAnimation = null; }
    if (validBox(box)) enterPose(s,box,clip);
  }
  function fullscreenDestination(s) {
    // The inline author transform belongs to the inline layout. An inline
    // !important transform would beat the fullscreen stylesheet on release.
    s.video.style.setProperty('transform','none');
    s.video.removeAttribute('data-langform-fullscreen-enter-video');
    naturalVideoDimensions(s,true);
    naturalVideoPositions(s);
    var target = {picture:pictureBox(s.video),rect:s.video.getBoundingClientRect(),root:s.root.getBoundingClientRect()};
    s.video.style.setProperty('transform','none');
    s.video.setAttribute('data-langform-fullscreen-enter-video','');
    if(s.enterPose)setVideoDimensions(s,[[s.enterPose.width+'px','important'],[s.enterPose.height+'px','important']]);
    if (s.enterPose && ownsInlinePositions(s)) setVideoPositions(s,[[s.enterPose.y+'px','important'],[s.enterPose.x+'px','important']]);
    return target;
  }
  function expectedFullscreenPicture(s,viewport) {
    var width=Number(s.video.videoWidth),height=Number(s.video.videoHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width<=0 || height<=0) return null;
    var scale=Math.min(viewport.width/width,viewport.height/height);
    return {x:(viewport.width-width*scale)/2,y:(viewport.height-height*scale)/2,width:width*scale,height:height*scale};
  }
  function fullscreenDestinationReady(s,destination) {
    var viewport=s.enterTarget || s.enterPreparedTarget,expected=viewport && expectedFullscreenPicture(s,viewport);
    if (!viewport || !expected || !destination || !validBox(destination.root) || !validBox(destination.rect) || !validBox(destination.picture) ||
        Math.abs(viewport.width-win.innerWidth)>2 || Math.abs(viewport.height-win.innerHeight)>2) return false;
    // innerWidth/Height can change before WebKit's fixed containing block does.
    // A stale 874x874 root produces a real, wrong 874x491.625 contain target.
    // Validate the root, outer video and actual picture before any movement.
    return [destination.root,destination.rect].every(function (box) {
      return Math.abs(box.x)<=1 && Math.abs(box.y)<=1 && Math.abs(box.width-viewport.width)<=1 && Math.abs(box.height-viewport.height)<=1;
    }) && ['x','y','width','height'].every(function (key) { return Math.abs(destination.picture[key]-expected[key])<=1; });
  }
  function completeEnterHandoff(s) {
    if (state !== s || s.phase !== 'entering' || !s.enterTarget ||
        Math.abs(s.enterTarget.width-win.innerWidth)>2 || Math.abs(s.enterTarget.height-win.innerHeight)>2) return;
    var destination=fullscreenDestination(s),current=pictureBox(s.video);
    if (!fullscreenDestinationReady(s,destination) || ['x','y','width','height'].some(function (key) { return Math.abs(destination.picture[key]-current[key])>1; })) { confirmEnterViewport(s); return; }
    clearEnterPose(s,true); s.phase = 'open'; s.ui.removeAttribute('data-entering'); s.ui.inert = false;
    if (geometryTrace && geometryTrace.s === s && geometryTrace.direction==='enter') { geometryTrace.phase='committed'; geometryTrace.end=Math.min(geometryTrace.end,win.performance.now()+500); }
    try { var bridge = nativeBridge(); if (bridge) bridge.postMessage({kind:'enter-commit',open:true,href:s.href,videoID:s.id,token:s.enterToken}); } catch (_) {}
    win.dispatchEvent(new win.Event('player-fullscreen-change')); visible(true);
  }
  function handoffToFullscreen(s,destination) {
    if (state !== s || s.phase !== 'entering' || !matching(s)) return;
    var from = pictureBox(s.video), sourceClip = win.getComputedStyle(s.video).clipPath;
    if (!validBox(from)) return;
    if (s.enterAnimation) { s.enterAnimation.cancel(); s.enterAnimation = null; }
    destination=destination || fullscreenDestination(s);
    var target = destination.picture;
    enterPose(s,from,sourceClip);
    if (!fullscreenDestinationReady(s,destination)) { confirmEnterViewport(s); return; }
    s.enterHandoffComplete=false;
    var distance = Math.max(Math.abs(target.x-from.x),Math.abs(target.y-from.y),Math.abs(target.width-from.width),Math.abs(target.height-from.height));
    var remaining=s.enterRotationDeadline===undefined ? 180 : Math.max(0,s.enterRotationDeadline-Date.now());
    if (reduced && reduced.matches || remaining<=0 || distance<.5 || typeof s.video.animate!=='function') { enterPose(s,target); s.enterHandoffComplete=true; confirmEnterViewport(s); return; }
    var scale = target.width/from.width, scaleY = target.height/from.height;
    var transform = 'translate('+(target.x-from.x)+'px,'+(target.y-from.y)+'px) scale('+scale+(Math.abs(scale-scaleY)>.0001 ? ','+scaleY : '')+')';
    var animation;
    try { animation = s.video.animate([{transform:'none',transformOrigin:'0 0',clipPath:sourceClip || 'inset(0)'},{transform:transform,transformOrigin:'0 0',clipPath:'inset(0)'}],{duration:remaining,easing:s.enterRotationCurve || 'cubic-bezier(.2,0,.25,1)',fill:'forwards'}); }
    catch (_) { enterPose(s,target); s.enterHandoffComplete=true; confirmEnterViewport(s); return; }
    s.enterAnimation = animation;
    animation.onfinish = function () {
      if (state!==s || s.phase!=='entering' || s.enterAnimation!==animation || !matching(s)) return;
      var current = pictureBox(s.video); animation.cancel(); s.enterAnimation = null; enterPose(s,current);
      s.enterHandoffComplete=true; confirmEnterViewport(s);
    };
  }
  function confirmEnterViewport(s) {
    if (state!==s || s.phase!=='entering' || s.enterFrame || !s.enterTarget && !s.enterPreparedTarget) return;
    var target = s.enterTarget || s.enterPreparedTarget;
    if (Math.abs(target.width-win.innerWidth)>2 || Math.abs(target.height-win.innerHeight)>2) { freezeEnterHandoff(s); return; }
    if (s.enterAnimation) return;
    s.enterFrame = win.requestAnimationFrame(function () {
      s.enterFrame = 0;
      if (state!==s || s.phase!=='entering' || (s.enterTarget || s.enterPreparedTarget)!==target || !matching(s)) return;
      if (Math.abs(target.width-win.innerWidth)>2 || Math.abs(target.height-win.innerHeight)>2) return;
      var first=fullscreenDestination(s);
      s.enterFrame = win.requestAnimationFrame(function () {
        s.enterFrame = 0;
        if (state!==s || s.phase!=='entering' || (s.enterTarget || s.enterPreparedTarget)!==target || !matching(s) || Math.abs(target.width-win.innerWidth)>2 || Math.abs(target.height-win.innerHeight)>2) return;
        var next=fullscreenDestination(s);
        if (!fullscreenDestinationReady(s,first) || !fullscreenDestinationReady(s,next) || destinationDistance(first,next)>.5) { confirmEnterViewport(s); return; }
        var current=pictureBox(s.video),distance=Math.max.apply(null,['x','y','width','height'].map(function (key) { return Math.abs(next.picture[key]-current[key]); }));
        if (s.enterHandoffComplete && distance<=1) { if(s.enterTarget)completeEnterHandoff(s); return; }
        handoffToFullscreen(s,next);
      });
    });
  }
  function enterViewport(expectedID,token,width,height,finish,deadline,curve) {
    var s = state;
    if (!s || s.phase!=='entering' || s.id!==expectedID || s.enterToken!==token || !matching(s) || !Number.isFinite(width) || !Number.isFinite(height) || width<=0 || height<=0 || !finish && s.enterTarget) return false;
    if(deadline!==undefined && (!Number.isFinite(deadline) || deadline-Date.now()>2000 || !finish&&deadline-Date.now()< -2000))return false;
    if(curve!==undefined && ['cubic-bezier(.42,0,.58,1)','cubic-bezier(.42,0,1,1)','cubic-bezier(0,0,.58,1)','linear'].indexOf(curve)<0)return false;
    if(deadline!==undefined)s.enterRotationDeadline=deadline;
    if(curve!==undefined)s.enterRotationCurve=curve;
    if (s.enterFrame) { win.cancelAnimationFrame(s.enterFrame); s.enterFrame = 0; }
    if (finish) s.enterTarget={width:width,height:height}; else s.enterPreparedTarget={width:width,height:height};
    confirmEnterViewport(s); return true;
  }
  function freezeExitHandoff(s) {
    if (!s.handoff) return;
    var box = pictureBox(s.video), clip = win.getComputedStyle(s.video).clipPath;
    if (s.exitAnimation) { s.exitAnimation.cancel(); s.exitAnimation = null; }
    if (validBox(box)) exitPose(s,box,clip);
  }
  function holdExitPicture(s,box,clip) {
    if (s.handoff) return;
    clearEnterPose(s);
    restoreTransform(s,s.fullscreenTransform); s.fullscreenTransform=null;
    s.exitStyle = doc.createElement('style'); s.exitStyle.id = 'langform-fullscreen-exit-style';
    (doc.head || doc.documentElement).appendChild(s.exitStyle);
    s.exitTransform = [s.video.style.getPropertyValue('transform'),s.video.style.getPropertyPriority('transform')];
    s.video.style.setProperty('transform','none');
    mark(s,s.video,'data-langform-fullscreen-exit-video');
    mark(s,s.root,'data-langform-fullscreen-exit-layout');
    s.fullscreenAttributes.forEach(function (entry) { if (entry[1] === 'data-langform-fullscreen-ancestor') mark(s,entry[0],'data-langform-fullscreen-exit-ancestor'); });
    s.handoff = true; exitPose(s,box,clip);
  }
  function prepareInlineLayout(s) {
    if (s.placeholder) s.placeholder.remove();
    s.fullscreenAttributes.forEach(restoreAttribute);
    restoreScroll(s);
  }
  function cancelContextReveal() {
    contextReveals.forEach(function (animation) { try { animation.cancel(); } catch (_) {} }); contextReveals=[];
  }
  function hideExitContext(s) {
    if (!s.exitContext) s.exitContext=[];
    s.exitContext=s.exitContext.filter(function (entry) {
      if (entry[0]!==s.video && !entry[0].contains(s.video)) return true;
      restoreAttribute(entry); return false;
    });
    // Only sibling branches of the live video's ancestor path are hidden.
    // Visibility/opacity on an ancestor would also fade the playing media.
    for (var branch=s.video;branch && branch!==doc.body;branch=branch.parentElement) {
      if (!branch.parentElement) break;
      Array.from(branch.parentElement.children).forEach(function (node) {
        if (node===branch || node===s.ui || /^(SCRIPT|STYLE|LINK|META)$/.test(node.tagName) ||
            s.exitContext.some(function (entry) { return entry[0]===node; })) return;
        s.exitContext.push([node,'data-langform-fullscreen-exit-context',node.getAttribute('data-langform-fullscreen-exit-context')]);
        node.setAttribute('data-langform-fullscreen-exit-context','');
      });
    }
  }
  function revealExitContext(s,animate) {
    (s.exitContext || []).forEach(function (entry) {
      var node=entry[0];
      restoreAttribute(entry);
      if (animate && node.isConnected && !(reduced && reduced.matches) && typeof node.animate==='function') {
        try {
          var opacity=Number(win.getComputedStyle(node).opacity),animation=node.animate([{opacity:0},{opacity:Number.isFinite(opacity)?opacity:1}],{duration:140,easing:'ease-out'});
          contextReveals.push(animation);
          animation.onfinish=function () { contextReveals=contextReveals.filter(function (value) { return value!==animation; }); animation.cancel(); };
        } catch (_) {}
      }
    });
    s.exitContext=[];
  }
  function plainBox(rect) { return {x:rect.x,y:rect.y,width:rect.width,height:rect.height}; }
  function stageInsets() {
    var insets=win.__langformStageInsets || {};
    return ['top','right','bottom','left'].map(function (key) { return Number(insets[key]) || 0; });
  }
  function cacheInlineDestination(s) {
    if(inlineSizeOwner&&inlineSizeOwner.video===s.video)applyInlineSizeOwner();
    var css=win.getComputedStyle(s.video);
    s.videoDimensions=['width','height'].map(function(key){var entry=inlineSizeOwner&&inlineSizeOwner.video===s.video&&inlineSizeOwner.entries.find(function(value){return value[0]===s.video&&value[1]===key;});return entry?[entry[2],entry[3]]:[s.video.style.getPropertyValue(key),s.video.style.getPropertyPriority(key)];});
    s.videoDimensionLatest=s.videoDimensions.map(function(value){return value.slice();});
    if(inlineSizeOwner&&inlineSizeOwner.video===s.video)s.dimensionApplied=['width','height'].map(function(key){return [s.video.style.getPropertyValue(key),s.video.style.getPropertyPriority(key)];});
    var container=s.video.closest('.html5-video-container');s.inlineContainerDimensions=container&&['width','height'].map(function(key){return [container.style.getPropertyValue(key),container.style.getPropertyPriority(key)];});
    s.videoPositions=['top','left'].map(function (key,index) {
      var entry=inlineSizeOwner && inlineSizeOwner.video===s.video && inlineSizeOwner.positions && inlineSizeOwner.positions[index];
      return entry ? [entry[1],entry[2]] : [s.video.style.getPropertyValue(key),s.video.style.getPropertyPriority(key)];
    });
    s.videoPositionLatest=s.videoPositions.map(function (value) { return value.slice(); });
    if (inlineSizeOwner && inlineSizeOwner.video===s.video && inlineSizeOwner.positions) s.positionApplied=['top','left'].map(function (key) { return [s.video.style.getPropertyValue(key),s.video.style.getPropertyPriority(key)]; });
    s.inlineDestination={picture:pictureBox(s.video),rect:plainBox(s.video.getBoundingClientRect()),root:plainBox(s.root.getBoundingClientRect()),
      viewport:{width:Number(win.innerWidth),height:Number(win.innerHeight)},scroll:{x:Number(win.scrollX)||0,y:Number(win.scrollY)||0},
      fit:css.objectFit,position:css.objectPosition,ratio:Number(s.video.videoWidth)/Number(s.video.videoHeight),insets:stageInsets(),
      video:s.video,rootNode:s.root,source:mediaSource(s.video),transform:[s.video.style.getPropertyValue('transform'),s.video.style.getPropertyPriority('transform')],clip:css.clipPath};
    s.inlinePlacementEligible=css.position==='absolute' && Math.abs(parseFloat(css.top))<=.5 && Math.abs(parseFloat(css.left))<=.5 &&
      (!css.transform || css.transform==='none') && ['x','y','width','height'].every(function (key) { return Math.abs(s.inlineDestination.rect[key]-s.inlineDestination.root[key])<=1; });
  }
  function cachedInlineDestination(s,destination,target) {
    var saved=s.inlineDestination,insets=stageInsets(),ratio=Number(s.video.videoWidth)/Number(s.video.videoHeight);
    if (!saved || !validBox(saved.picture) || !validBox(saved.rect) || !validBox(saved.root) ||
        !Number.isFinite(saved.ratio) || saved.ratio<=0 || !Number.isFinite(ratio) || ratio<=0 ||
        Math.abs(saved.viewport.width-target.width)>2 || Math.abs(saved.viewport.height-target.height)>2 ||
        Math.abs(saved.scroll.x-Number(win.scrollX))>.5 || Math.abs(saved.scroll.y-Number(win.scrollY))>.5 ||
        destination.fit!==saved.fit || destination.position!==saved.position ||
        Math.abs(saved.ratio-ratio)>.0001 ||
        insets.some(function (value,index) { return Math.abs(value-saved.insets[index])>.5; }) ||
        ['x','y','width','height'].some(function (key) { return Math.abs(destination.root[key]-saved.root[key])>1; })) return null;
    return saved;
  }
  function inlineDestination(s) {
    s.fullscreenAttributes.forEach(restoreAttribute);
    s.attributes.forEach(function (entry) { if (entry[1] === 'data-langform-fullscreen-exit-layout' || entry[1] === 'data-langform-fullscreen-exit-ancestor') restoreAttribute(entry); });
    s.video.removeAttribute('data-langform-fullscreen-exit-video');
    naturalVideoDimensions(s,false);
    naturalVideoPositions(s);
    if (s.exitTransform[0]) s.video.style.setProperty('transform',s.exitTransform[0],s.exitTransform[1]); else s.video.style.removeProperty('transform');
    var css=win.getComputedStyle(s.video);
    var container=s.video.closest('.html5-video-container'),target = {picture:pictureBox(s.video),rect:s.video.getBoundingClientRect(),root:s.root.getBoundingClientRect(),fit:css.objectFit,position:css.objectPosition};
    s.naturalInlineGeometry={naturalVideoWidth:target.rect.width,naturalVideoHeight:target.rect.height,
      naturalContainerWidth:container?container.getBoundingClientRect().width:0,naturalContainerHeight:container?container.getBoundingClientRect().height:0,
      videoInlineWidth:parseFloat(s.video.style.width),videoInlineHeight:parseFloat(s.video.style.height),containerInlineWidth:container?parseFloat(container.style.width):0,containerInlineHeight:container?parseFloat(container.style.height):0};
    s.video.style.setProperty('transform','none'); s.video.setAttribute('data-langform-fullscreen-exit-video','');
    if(s.exitPose)setVideoDimensions(s,[[s.exitPose.width+'px','important'],[s.exitPose.height+'px','important']]);
    if (s.exitPose && ownsInlinePositions(s)) setVideoPositions(s,[[s.exitPose.y+'px','important'],[s.exitPose.x+'px','important']]);
    s.attributes.forEach(function (entry) { if (entry[1] === 'data-langform-fullscreen-exit-layout' || entry[1] === 'data-langform-fullscreen-exit-ancestor') entry[0].setAttribute(entry[1],''); });
    return target;
  }
  function inlineDestinationReady(s,destination) {
    var root=destination.root,rect=destination.rect,overflow=s.inlineOverflow || [0,0,0,0];
    if (!validBox(root) || !validBox(rect) || !validBox(destination.picture) || root.width>Number(win.innerWidth)+2) return false;
    // A matching native/document viewport does not mean YouTube has resized
    // its media yet. Its old landscape video can outlive the correct inline
    // root by several frames. Check the element, not the cover content box;
    // preserve any author-transform overflow measured before fullscreen.
    return rect.width<=root.width+overflow[1]+overflow[3]+2 && rect.height<=root.height+overflow[0]+overflow[2]+2 &&
      rect.y>=root.y-overflow[0]-2 && rect.y+rect.height<=root.y+root.height+overflow[2]+2 &&
      rect.x>=root.x-overflow[3]-2 && rect.x+rect.width<=root.x+root.width+overflow[1]+2;
  }
  function destinationDistance(a,b) {
    if (!a || !b) return Infinity;
    return Math.max.apply(null,['picture','rect','root'].map(function (kind) {
      return Math.max.apply(null,['x','y','width','height'].map(function (key) { return Math.abs(a[kind][key]-b[kind][key]); }));
    }));
  }
  function completeExitHandoff(s) {
    s.handoffComplete = true;
    confirmExitViewport(s);
  }
  function intersectBoxes(a,b) {
    var x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);
    return {x:x,y:y,width:right-x,height:bottom-y};
  }
  function clipFractions(clip,box) {
    if (!clip || clip==='none') return [0,0,0,0];
    var match=/^inset\(([^()]*)\)$/.exec(clip);
    if (!match) return null;
    var values=match[1].trim().split(/\s+/);
    if (values.length<1 || values.length>4 || values.some(function (value) { return !/^(?:\d*\.)?\d+(?:%|px)?$/.test(value); })) return null;
    if(values.length===1)values=[values[0],values[0],values[0],values[0]];
    if(values.length===2)values=[values[0],values[1],values[0],values[1]];
    if(values.length===3)values=[values[0],values[1],values[2],values[1]];
    return values.map(function (value,index) { return parseFloat(value)/(/%$/.test(value)?100:index%2?box.width:box.height); });
  }
  function clippedBox(box,clip) {
    var inset=clipFractions(clip,box);
    if (!inset) return null;
    return {x:box.x+box.width*inset[3],y:box.y+box.height*inset[0],width:box.width*(1-inset[1]-inset[3]),height:box.height*(1-inset[0]-inset[2])};
  }
  function fitsViewport(box,viewport) {
    return validBox(box) && box.x>=-.01 && box.y>=-.01 && box.x+box.width<=viewport.width+.01 && box.y+box.height<=viewport.height+.01;
  }
  function motionFrames(from,target,visibleFrom,visibleTarget,source) {
    var frames=[],poses=[],clips=[];
    function interpolate(a,b,t) { return a+(b-a)*t; }
    for(var index=0;index<=32;index++) {
      var t=index/32,box={},visible={};
      ['x','y','width','height'].forEach(function (key) { box[key]=interpolate(from[key],target[key],t); visible[key]=interpolate(visibleFrom[key],visibleTarget[key],t); });
      var inset=[(visible.y-box.y)/box.height,(box.x+box.width-visible.x-visible.width)/box.width,(box.y+box.height-visible.y-visible.height)/box.height,(visible.x-box.x)/box.width];
      if (inset.some(function (value) { return !Number.isFinite(value) || value<-.0001 || value>1.0001; })) return null;
      inset=inset.map(function (value) { return Math.max(0,Math.min(1,value)); });
      poses.push(box);clips.push(inset);
      frames.push({offset:t,transform:'translate('+(box.x-from.x)+'px,'+(box.y-from.y)+'px) scale('+(box.width/from.width)+')',transformOrigin:'0 0',clipPath:'inset('+inset.map(function(value){return value*100+'%';}).join(' ')+')'});
    }
    // Percentage clipping and scaling together form quadratic visible edges
    // between keyframes. Check their extrema, not only sampled endpoints.
    function edgeRange(p0,p1,size0,size1,f0,f1,far) {
      var dp=p1-p0,ds=size1-size0,df=f1-f0,a=far?-ds*df:ds*df,
        b=far?dp+ds*(1-f0)-size0*df:dp+ds*f0+size0*df,c=far?p0+size0*(1-f0):p0+size0*f0;
      var values=[c,a+b+c],turn=a ? -b/(2*a) : -1;
      if(turn>0&&turn<1)values.push(a*turn*turn+b*turn+c);
      return {min:Math.min.apply(null,values),max:Math.max.apply(null,values)};
    }
    for(var j=1;j<poses.length;j++) {
      var a=poses[j-1],b=poses[j],c=clips[j-1],d=clips[j];
      if(edgeRange(a.x,b.x,a.width,b.width,c[3],d[3],false).min<-.01 ||
         edgeRange(a.x,b.x,a.width,b.width,c[1],d[1],true).max>source.width+.01 ||
         edgeRange(a.y,b.y,a.height,b.height,c[0],d[0],false).min<-.01 ||
         edgeRange(a.y,b.y,a.height,b.height,c[2],d[2],true).max>source.height+.01) return null;
    }
    return frames;
  }
  function exitMotionCache(s,width,height) {
    var saved=s.inlineDestination,ratio=Number(s.video.videoWidth)/Number(s.video.videoHeight);
    if (!saved || saved.video!==s.video || saved.rootNode!==s.root || doc.getElementById('movie_player')!==s.root ||
        !validBox(saved.picture) || !validBox(saved.rect) || !validBox(saved.root) ||
        !Number.isFinite(saved.ratio) || saved.ratio<=0 || !Number.isFinite(ratio) || ratio<=0 || Math.abs(saved.ratio-ratio)>.0001 ||
        Math.abs(saved.viewport.width-width)>2 || Math.abs(saved.viewport.height-height)>2 ||
        Math.abs(saved.scroll.x-Number(win.scrollX))>.5 || Math.abs(saved.scroll.y-Number(win.scrollY))>.5 ||
        !s.exitTransform || s.video.style.getPropertyValue('transform')!=='none' || saved.transform[0]!==s.exitTransform[0] || saved.transform[1]!==s.exitTransform[1] ||
        saved.insets.some(function (value) { return !Number.isFinite(value) || value<0; })) return null;
    return saved;
  }
  function emitExitMotionReady(s,motion) {
    var message={kind:'exit-motion-ready',href:s.href,videoID:s.id,token:s.exitToken,width:motion.width,height:motion.height};
    if(motion.requestTicket!==undefined)message.requestTicket=motion.requestTicket;
    try { var bridge=nativeBridge(); if(bridge)bridge.postMessage(message); } catch (_) {}
  }
  function finishExitMotion(s,motion) {
    if(state!==s || s.phase!=='exiting' || s.exitMotion!==motion || !matching(s) || ad(s) ||
        Math.abs(win.innerWidth-motion.source.width)>2 || Math.abs(win.innerHeight-motion.source.height)>2 || !exitMotionCache(s,motion.width,motion.height)) return false;
    if(s.exitAnimation){s.exitAnimation.cancel();s.exitAnimation=null;}
    exitPose(s,motion.target,pictureClip(motion.target,motion.visible));
    var actual=pictureBox(s.video),visible=clippedBox(actual,win.getComputedStyle(s.video).clipPath);
    if(!visible || !fitsViewport(visible,motion.source) || ['x','y','width','height'].some(function(key){return Math.abs(actual[key]-motion.target[key])>1 || Math.abs(visible[key]-motion.visible[key])>1;}))return false;
    s.exitUsingCachedDestination=true;s.exitDestination=motion.target;s.handoffComplete=true;motion.ready=true;
    emitExitMotionReady(s,motion);return true;
  }
  function cancelExitMotion(expectedID,token) {
    var s=state;
    if(!s || s.phase!=='exiting' || s.id!==expectedID || s.exitToken!==token || !s.exitMotion) return false;
    freezeExitHandoff(s);s.exitMotion=null;s.exitUsingCachedDestination=false;s.handoffComplete=false;return true;
  }
  function prepareExitMotion(expectedID,token,width,height,deadline,requestTicket) {
    var s=state;
    if(!s || s.phase!=='exiting' || s.id!==expectedID || s.exitToken!==token || !matching(s) || ad(s)) return false;
    function reject(reason){s.exitMotionRejectedReason=reason;return false;}
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||!Number.isFinite(deadline)||
        requestTicket!==undefined&&(!Number.isSafeInteger(requestTicket)||requestTicket<0))return reject(1);
    var saved=exitMotionCache(s,width,height);
    if(!saved)return reject(2);
    var from=pictureBox(s.video),source={width:Number(win.innerWidth),height:Number(win.innerHeight)},fromClip=win.getComputedStyle(s.video).clipPath,
      outer=clippedBox(saved.rect,saved.clip),visible=outer&&intersectBoxes(saved.picture,outer),clippedFrom=clippedBox(from,fromClip);
    if(!validBox(from)||!clippedFrom||!validBox(clippedFrom)||!validBox(visible)||!source.width||!source.height)return reject(3);
    if(Math.abs(from.width/from.height-saved.picture.width/saved.picture.height)>.0001)return reject(4);
    if(!fitsViewport(visible,source))return reject(5);
    var remaining=deadline-Date.now();
    if(remaining>2000||remaining< -250||remaining<=0&&!(reduced&&reduced.matches))return reject(6);
    var visibleFrom=intersectBoxes(clippedFrom,{x:0,y:0,width:source.width,height:source.height}),frames=motionFrames(from,saved.picture,visibleFrom,visible,source);
    if(!frames)return reject(7);
    if(s.exitMotion&&s.exitMotion.width===width&&s.exitMotion.height===height&&s.exitMotion.requestTicket===requestTicket&&Math.abs(s.exitMotion.deadline-deadline)<=5){
      if(s.exitMotion.ready)emitExitMotionReady(s,s.exitMotion);return true;
    }
    if(s.exitFrame){win.cancelAnimationFrame(s.exitFrame);s.exitFrame=0;}
    freezeExitHandoff(s);exitPose(s,from,fromClip);
    var motion={source:source,width:width,height:height,target:saved.picture,visible:visible,deadline:deadline,requestTicket:requestTicket,ready:false};
    s.exitMotion=motion;s.exitMotionRejectedReason=0;s.handoffComplete=false;
    if(reduced&&reduced.matches)return finishExitMotion(s,motion);
    if(typeof s.video.animate!=='function'){s.exitMotion=null;return reject(8);}
    var animation;
    try{animation=s.video.animate(frames,{duration:remaining,easing:'cubic-bezier(.2,0,.25,1)',fill:'forwards'});}catch(_){s.exitMotion=null;return reject(8);}
    s.exitAnimation=animation;
    animation.onfinish=function(){if(state===s&&s.exitMotion===motion&&s.exitAnimation===animation)finishExitMotion(s,motion);};
    return true;
  }
  function handoffToInline(s,destination) {
    if (state !== s || !matching(s)) return;
    var from = pictureBox(s.video);
    if (!validBox(from)) return;
    if (s.exitAnimation) { s.exitAnimation.cancel(); s.exitAnimation = null; }
    holdExitPicture(s,from);
    // Read the destination with the actual inline header, page flow and scroll.
    // The same live media node is pinned back to its last displayed content box
    // in this turn, before WebKit can paint the new inline position.
    prepareInlineLayout(s);
    destination = destination || inlineDestination(s);
    var target = destination.picture, rect = destination.rect;
    exitPose(s,from);
    if (!inlineDestinationReady(s,destination)) { confirmExitViewport(s); return; }
    s.handoffComplete = false;
    s.exitDestination = target;
    var scale = target.width / from.width, scaleY = target.height / from.height;
    var transform = 'translate(' + (target.x - from.x) + 'px,' + (target.y - from.y) + 'px) scale(' + scale + (Math.abs(scale-scaleY)>0.0001 ? ','+scaleY : '') + ')';
    var clip = pictureClip(target,rect);
    var distance = Math.max(Math.abs(target.x-from.x),Math.abs(target.y-from.y),Math.abs(target.width-from.width),Math.abs(target.height-from.height));
    if (reduced && reduced.matches || distance < 0.5 || typeof s.video.animate !== 'function') { exitPose(s,target,clip); completeExitHandoff(s); return; }
    var animation;
    try { animation = s.video.animate([{transform:'none',transformOrigin:'0 0',clipPath:'inset(0)'},{transform:transform,transformOrigin:'0 0',clipPath:clip}],{duration:180,easing:'cubic-bezier(.2,0,.25,1)',fill:'forwards'}); }
    catch (_) { exitPose(s,target,clip); completeExitHandoff(s); return; }
    s.exitAnimation = animation;
    animation.onfinish = function () {
      if (state !== s || s.exitAnimation !== animation || !matching(s)) return;
      // Recheck the real destination before releasing the fixed media box.
      // Late header/safe-area hydration continues from its displayed pose.
      var current = pictureBox(s.video);
      animation.cancel(); s.exitAnimation = null; exitPose(s,current,clip);
      var destination=inlineDestination(s),next=destination.picture;
      if (!inlineDestinationReady(s,destination) || Math.max(Math.abs(next.x-current.x),Math.abs(next.y-current.y),Math.abs(next.width-current.width),Math.abs(next.height-current.height)) > 1) {
        s.handoffComplete=false; confirmExitViewport(s); return;
      }
      completeExitHandoff(s);
    };
  }
  function finishClose(s,reason,reportBeforeRestore) {
    if (state !== s) return false;
    resetZoom(s,'fullscreen-close');
    var activeEnterTransform = s.enterHandoff ? s.enterTransform : s.fullscreenTransform;
    state = null; clearIdle(); clearFeedback(s);
    if (s.exitFrame) win.cancelAnimationFrame(s.exitFrame);
    if (s.enterFrame) win.cancelAnimationFrame(s.enterFrame);
    if (s.enterAnimation) { s.enterAnimation.cancel(); s.enterAnimation = null; }
    if (s.exitAnimation) { s.exitAnimation.cancel(); s.exitAnimation = null; }
    if (geometryTrace && geometryTrace.s === s) { geometryTrace.phase = reason ? 'cancelled' : 'committed'; geometryTrace.end = Math.min(geometryTrace.end,win.performance.now()+500); }
    if (reportBeforeRestore) emit(false,s,reason);
    try { if (s.chapters) s.chapters.close(); } catch (_) { /* still restore the fullscreen transaction */ }
    if (s.adObserver) s.adObserver.disconnect();
    if (s.dimensionObserver) s.dimensionObserver.disconnect();
    if (s.ownedObserver) s.ownedObserver.disconnect();
    s.events.forEach(function (entry) { entry[0].removeEventListener(entry[1],entry[2]); });
    revealExitContext(s,!reason && s.phase==='exiting');
    // Rejoin the document's flow in the same turn as removing its placeholder.
    // Native has already confirmed the destination viewport on a normal exit.
    s.attributes.reverse().forEach(function (entry) { try { if (entry[2] === null) entry[0].removeAttribute(entry[1]); else entry[0].setAttribute(entry[1],entry[2]); } catch (_) {} });
    if (s.exitStyle) s.exitStyle.remove();
    if (s.enterStyle) s.enterStyle.remove();
    var ownSize=inlineSizeOwner && inlineSizeOwner.video===s.video;
    if(!ownSize&&s.videoDimensions)setVideoDimensions(s,reason==='exit-layout-timeout'?s.videoDimensions:s.videoDimensionLatest || s.videoDimensions);
    restoreTransform(s,s.exitTransform || activeEnterTransform);
    if (s.placeholder) s.placeholder.remove();
    if (s.viewport) {
      if (s.viewportCreated) s.viewport.remove();
      else if (s.viewportContent === null) s.viewport.removeAttribute('content');
      else s.viewport.setAttribute('content',s.viewportContent);
    }
    restoreScroll(s);
    if (s.ui) s.ui.remove();
    if(ownSize){if(reason&&reason!=='exit-layout-changed')releaseInlineSizeOwner(s);else applyInlineSizeOwner(s);}
    if (s.focus && s.focus.isConnected && doc.activeElement === doc.body) { try { s.focus.focus({preventScroll:true}); } catch (_) {} }
    if (!reportBeforeRestore) {
      if (s.phase === 'exiting' && !reason) {
        try { var bridge = nativeBridge(); if (bridge) bridge.postMessage({kind:'exit-commit',open:false,href:s.href,videoID:s.id,token:s.exitToken}); } catch (_) {}
        try { win.dispatchEvent(new win.Event('player-fullscreen-change')); } catch (_) {}
      } else emit(false,s,reason);
    }
    return true;
  }
  function confirmExitViewport(s) {
    if (state !== s || s.phase !== 'exiting' || !matching(s) || ad(s)) return;
    if(s.exitMotion&&!s.exitMotion.ready){
      if(Math.abs(win.innerWidth-s.exitMotion.source.width)<=2&&Math.abs(win.innerHeight-s.exitMotion.source.height)<=2)return;
      cancelExitMotion(s.id,s.exitToken);
    }
    var target = s.exitTarget || s.exitPreparedTarget || s.inlineDestination && s.inlineDestination.viewport;
    if (!target) return;
    var viewport = {width:Number(win.innerWidth),height:Number(win.innerHeight)};
    if (Math.abs(target.width - viewport.width) > 2 || Math.abs(target.height - viewport.height) > 2) { freezeExitHandoff(s); return; }
    // Every confirmed exit needs bounded hydration, including rejected or
    // cancelled staged motion. Otherwise its hidden watch context and inert
    // controls can survive forever while YouTube keeps a stale media size.
    // Start only after native finish and the matching document viewport.
    if(s.exitTarget){
      if(s.exitNaturalDeadline===undefined)s.exitNaturalDeadline=win.performance.now()+1800;
      if(win.performance.now()>=s.exitNaturalDeadline){s.exitMotionRejectedReason=10;finishClose(s,'exit-layout-timeout');return;}
    }
    hideExitContext(s);
    prepareInlineLayout(s);
    var natural=inlineDestination(s),cached=cachedInlineDestination(s,natural,target);
    if (cached && !s.exitUsingCachedDestination) {
      // UIKit is already rotating this new viewport. Put the live node in its
      // matching coordinate space in this resize/prepare turn, before a paint.
      // Waiting for YouTube media hydration would clip the old landscape box,
      // then start a second video movement after the rotation has completed.
      if (s.exitAnimation) { s.exitAnimation.cancel(); s.exitAnimation=null; }
      exitPose(s,cached.picture,pictureClip(cached.picture,cached.rect));
      s.exitDestination=cached.picture; s.exitUsingCachedDestination=true; s.handoffComplete=true;
    }
    if (!s.exitTarget && !s.exitPreparedTarget) return;
    if (s.exitFrame) return;
    if (s.exitAnimation) return;
    // Native bounds and WebKit resize can arrive in different turns. Require
    // the same target through two layout frames before handing geometry back.
    s.exitFrame = win.requestAnimationFrame(function () {
      s.exitFrame = 0;
      if (state !== s || (s.exitTarget || s.exitPreparedTarget) !== target || !matching(s)) return;
      if (Math.abs(target.width - Number(win.innerWidth)) > 2 || Math.abs(target.height - Number(win.innerHeight)) > 2) return;
      prepareInlineLayout(s);
      var first=inlineDestination(s);
      s.exitFrame = win.requestAnimationFrame(function () {
        s.exitFrame = 0;
        if (state === s && (s.exitTarget || s.exitPreparedTarget) === target && matching(s) &&
            Math.abs(target.width - Number(win.innerWidth)) <= 2 && Math.abs(target.height - Number(win.innerHeight)) <= 2) {
          var next=inlineDestination(s);
          var fallbackInline=s.inlinePlacementEligible && s.inlineDestination && s.inlineDestination.source===mediaSource(s.video) &&
            cachedInlineDestination(s,first,target) && cachedInlineDestination(s,next,target);
          if((s.exitMotion&&s.exitMotion.ready || fallbackInline)&&s.exitTarget&&!s.inlineSizeApplied&&validBox(first.root)&&validBox(next.root)&&
              Math.abs(next.root.width-win.innerWidth)<=2 && Math.abs(next.root.width-s.inlineDestination.root.width)<=2 &&
              Math.abs(next.root.height-s.inlineDestination.root.height)<=2 && ['x','y','width','height'].every(function(key){return Math.abs(first.root[key]-next.root[key])<=.5;})){
            s.inlineSizeApplied=claimInlineSizeOwner(s);if(s.inlineSizeApplied){confirmExitViewport(s);return;}
          }
          if (!inlineDestinationReady(s,first) || !inlineDestinationReady(s,next) || destinationDistance(first,next)>0.5) { confirmExitViewport(s); return; }
          var current=pictureBox(s.video),distance=Math.max(Math.abs(next.picture.x-current.x),Math.abs(next.picture.y-current.y),Math.abs(next.picture.width-current.width),Math.abs(next.picture.height-current.height));
          if (s.handoffComplete && distance<=1) { if (s.exitTarget) finishClose(s); return; }
          if(s.exitMotion&&s.exitMotion.ready){
            if(s.exitTarget){s.exitMotionRejectedReason=9;finishClose(s,'exit-layout-changed');}
            return;
          }
          if (s.exitUsingCachedDestination) {
            // A changed natural target invalidates the cache. Continue from the
            // displayed live pose; never release it into mismatching geometry.
            s.exitUsingCachedDestination=false; s.inlineDestination=null;
          }
          handoffToInline(s,next);
        }
      });
    });
  }
  function prepareExit(expectedID,token,width,height) {
    var s = state;
    if (!s || s.phase !== 'exiting' || s.id !== expectedID || s.exitToken !== token || !matching(s) || s.exitTarget ||
        !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
    if (s.exitFrame) { win.cancelAnimationFrame(s.exitFrame); s.exitFrame = 0; }
    s.exitPreparedTarget = {width:width,height:height}; confirmExitViewport(s); return true;
  }
  function finishExit(expectedID,token,width,height) {
    var s = state;
    if (!s || s.phase !== 'exiting' || s.id !== expectedID || s.exitToken !== token || !matching(s) ||
        !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
    if (s.exitFrame) { win.cancelAnimationFrame(s.exitFrame); s.exitFrame = 0; }
    var same=s.exitTarget&&Math.abs(s.exitTarget.width-width)<=2&&Math.abs(s.exitTarget.height-height)<=2;
    if(!same)s.exitNaturalDeadline=undefined;
    s.exitTarget = {width:width,height:height}; confirmExitViewport(s); return true;
  }
  function beginExit(s,action) {
    if (state !== s || s.phase === 'exiting') return false;
    resetZoom(s,'fullscreen-exit');
    if (s.enterFrame) { win.cancelAnimationFrame(s.enterFrame); s.enterFrame = 0; }
    freezeEnterHandoff(s);
    var picture=pictureBox(s.video),outer=s.video.getBoundingClientRect();
    if (!validBox(picture)) return finishClose(s,'geometry-unavailable',true);
    s.phase = 'exiting'; s.exitToken = String(++serial); clearIdle(); clearFeedback(s);
    var currentClip=win.getComputedStyle(s.video).clipPath;
    holdExitPicture(s,picture,currentClip&&currentClip!=='none'?currentClip:pictureClip(picture,outer));
    hideExitContext(s);
    beginGeometryTrace(s,'exit');
    if (s.chapters) s.chapters.dismiss();
    if (s.speedOpen) setSpeedOpen(s,false,false);
    s.ui.setAttribute('data-exiting',''); s.ui.inert = true;
    listen(s,win,'resize',function () { confirmExitViewport(s); });
    listen(s,doc,'visibilitychange',function () { if (doc.hidden) finishClose(s,'inactive',true); });
    if (win.visualViewport) listen(s,win.visualViewport,'resize',function () { confirmExitViewport(s); });
    if (reduced && typeof reduced.addEventListener === 'function') listen(s,reduced,'change',function () { if (reduced.matches && s.handoff) { if(s.exitMotion&&!s.exitMotion.ready)finishExitMotion(s,s.exitMotion);else{freezeExitHandoff(s);confirmExitViewport(s);} } });
    try {
      var bridge = nativeBridge();
      if (!bridge) return finishClose(s,'bridge-unavailable',true);
      var request = {kind:'exit-request',open:false,href:s.href,videoID:s.id,token:s.exitToken};
      if (action === 'search') request.action = 'search';
      bridge.postMessage(request);
      return state === s;
    } catch (_) { return finishClose(s,'bridge-unavailable',true); }
  }
  function close(expectedID, reason, reportBeforeRestore, action) {
    if (!state || (expectedID && expectedID !== state.id)) return false;
    var s = state;
    if (!reason && !reportBeforeRestore && alive && matching(s) && !ad(s) && !nativeFullscreen(s.video) && win.__langformFullscreenExitProtocol === 1) return beginExit(s,action);
    if (s.phase === 'exiting' && !reason) reason = 'interrupted';
    return finishClose(s,reason,reportBeforeRestore);
  }
  function listen(s,node,event,fn) { node.addEventListener(event,fn); s.events.push([node,event,fn]); }
  function open() {
    if (state || !alive || !id() || !style.isConnected || !nativeBridge()) return false;
    stopGeometryTrace();
    cancelContextReveal();
    var root = doc.getElementById('movie_player'), video = root && root.querySelector('video.html5-main-video') || root && root.querySelector('video');
    var s = { root:root,video:video,id:id(),href:win.location.href,attributes:[],events:[],dragging:false,pointerScrub:false,pendingScrubTime:null,focus:doc.activeElement,
      scroll:{x:Number(win.scrollX) || 0,y:Number(win.scrollY) || 0},phase:'open',exitFrame:0 };
    if (!video || nativeFullscreen(video) || !matching(s) || ad(s)) return false;
    try {
    var enterProtocol = win.__langformFullscreenEnterProtocol === 1, inlinePicture, inlineOuter;
    var inlineRoot=root.getBoundingClientRect(),inlineVideo=video.getBoundingClientRect();
    cacheInlineDestination(s);
    s.dimensionObserver=new win.MutationObserver(function(){
      if(state!==s)return;rememberVideoDimensions(s);
      var pose=s.enterHandoff?s.enterPose:s.handoff?s.exitPose:null;
      if(pose)setVideoDimensions(s,[[pose.width+'px','important'],[pose.height+'px','important']]);
      else if(s.root.hasAttribute('data-langform-fullscreen-player'))setVideoDimensions(s,[['100%','important'],['100%','important']]);
    });
    s.inlineOverflow=[Math.max(0,inlineRoot.y-inlineVideo.y),Math.max(0,inlineVideo.x+inlineVideo.width-inlineRoot.x-inlineRoot.width),Math.max(0,inlineVideo.y+inlineVideo.height-inlineRoot.y-inlineRoot.height),Math.max(0,inlineRoot.x-inlineVideo.x)];
    if (enterProtocol) { inlinePicture = pictureBox(video); inlineOuter = video.getBoundingClientRect(); if (!validBox(inlinePicture)) return false; }
    state = s;
    s.dimensionObserver.observe(s.video,{attributes:true,attributeFilter:['style']});
    var original = win.getComputedStyle(root), inlineRect = root.getBoundingClientRect();
    if (root.parentElement && original.position !== 'absolute' && original.position !== 'fixed' && inlineRect.width > 0 && inlineRect.height > 0) {
      s.placeholder = doc.createElement('div'); s.placeholder.setAttribute('data-langform-fullscreen-placeholder',''); s.placeholder.setAttribute('aria-hidden','true');
      s.placeholder.style.cssText = 'visibility:hidden;pointer-events:none;box-sizing:border-box;';
      s.placeholder.style.width = inlineRect.width + 'px'; s.placeholder.style.height = inlineRect.height + 'px';
      s.placeholder.style.display = original.display === 'inline' ? 'inline-block' : original.display;
      s.placeholder.style.margin = original.margin; s.placeholder.style.flex = original.flex;
      root.parentElement.insertBefore(s.placeholder,root);
    }
    s.viewport = doc.querySelector('meta[name="viewport"]'); s.viewportCreated = !s.viewport;
    if (!s.viewport) { s.viewport = doc.createElement('meta'); s.viewport.name = 'viewport'; (doc.head || doc.documentElement).appendChild(s.viewport); }
    s.viewportContent = s.viewport.getAttribute('content');
    var viewportParts = (s.viewportContent || 'width=device-width,initial-scale=1').split(',').filter(function (part) { return !/^\s*viewport-fit\s*=/i.test(part); });
    viewportParts.push('viewport-fit=cover'); s.viewport.setAttribute('content',viewportParts.join(','));
    var ui = buildUI();
    s.ui = ui; s.clock = ui.querySelector('[data-clock]'); s.range = ui.querySelector('input');
    s.playButton = ui.querySelector('[data-action=play]'); s.controls = ui.querySelectorAll('.lf-fs-controls');
    s.speedButton = ui.querySelector('.lf-fs-speed-button'); s.speedPanel = ui.querySelector('.lf-fs-speed-panel'); s.speedStatus = ui.querySelector('.lf-fs-speed-status');
    s.speedOptions = Array.from(ui.querySelectorAll('.lf-fs-speed-option')); s.speedOpen = false;
    s.speedPanel.toggleAttribute('data-reduced-motion',!!(reduced && reduced.matches));
    var info = data(root); ui.querySelector('.lf-fs-title').textContent = info && info.title || doc.title.replace(/\s*[-–]\s*YouTube\s*$/,'');
    mark(s,doc.documentElement,'data-langform-fullscreen'); mark(s,root,'data-langform-fullscreen-player');
    for (var ancestor = root.parentElement; ancestor && ancestor !== doc.documentElement; ancestor = ancestor.parentElement) mark(s,ancestor,'data-langform-fullscreen-ancestor');
    s.fullscreenAttributes = s.attributes.slice();
    if (enterProtocol) {
      s.phase='entering'; s.enterToken=String(++serial); s.enterHandoff=true; s.enterFrame=0;
      s.enterTransform=[video.style.getPropertyValue('transform'),video.style.getPropertyPriority('transform')]; video.style.setProperty('transform','none');
      s.enterStyle=doc.createElement('style'); s.enterStyle.id='langform-fullscreen-enter-style'; (doc.head || doc.documentElement).appendChild(s.enterStyle);
      mark(s,video,'data-langform-fullscreen-enter-video'); enterPose(s,inlinePicture,pictureClip(inlinePicture,inlineOuter));
      ui.setAttribute('data-entering',''); ui.inert=true;
      listen(s,win,'resize',function () { confirmEnterViewport(s); });
      if (win.visualViewport) listen(s,win.visualViewport,'resize',function () { confirmEnterViewport(s); });
      beginGeometryTrace(s,'enter');
    }
    state = s; doc.body.appendChild(ui); s.presented = true;
    Array.from(doc.body.children).forEach(function (node) { if (node !== ui && node !== style) mark(s,node,'inert'); });
    // Observe only our CSS ownership attributes, never the page's full attribute stream.
    s.ownedObserver = new win.MutationObserver(route);
    s.attributes.forEach(function (entry) { if (entry[1].indexOf('data-langform-fullscreen') === 0) s.ownedObserver.observe(entry[0],{attributes:true,attributeFilter:[entry[1]]}); });
    if (win.__langformFullscreenChapters && typeof win.__langformFullscreenChapters.mount === 'function') {
      s.chapters = win.__langformFullscreenChapters.mount({
        host:ui.querySelector('.lf-fs-chapters'), markerHost:ui.querySelector('.lf-fs-range-wrap'), videoID:s.id,
        getTime:function () { return s.dragging || s.pendingScrubTime !== null ? scrubTime(s) : s.video.currentTime; }, getDuration:function () { return s.video.duration; },
        canSeek:function () { return state === s && seekable(s); },
        seek:function (seconds) { if (state !== s || !seekable(s) || !Number.isFinite(seconds)) return false; clearFeedback(s); s.video.currentTime = Math.min(s.video.duration,Math.max(0,seconds)); update(); visible(true); return true; },
        onActivity:function () { visible(true); },
        onOpen:function () { if (s.speedOpen) setSpeedOpen(s,false,false); }
      });
    }
    listen(s,ui,'click',function (event) {
      if (s.phase === 'exiting' || s.phase === 'entering') return;
      if (!matching(s) || ad(s)) { close(); return; }
      var button = event.target.closest('button');
      if (s.controlContact && s.controlContact.button === button) s.controlContact = null;
      var pointer = event.detail > 0 || !!(s.speedPointer && s.speedPointer.button === button && win.performance.now() < s.speedPointer.until); s.speedPointer = null;
      if (event.target.closest('.lf-fs-chapters')) return;
      if (event.target.closest('.lf-fs-speed-wrap')) {
        event.preventDefault(); event.stopPropagation();
        if (button === s.speedButton) { updateSpeed(s); setSpeedOpen(s,!s.speedOpen,!pointer,pointer); }
        else if (button && button.hasAttribute('data-rate')) selectSpeed(s,button,pointer);
        return;
      }
      if (s.speedOpen) { setSpeedOpen(s,false,false,pointer); if (!button) return; }
      if (!button) { if (!event.target.closest('input')) visible(ui.hasAttribute('data-hidden')); return; }
      event.preventDefault(); event.stopPropagation();
      var action = button.getAttribute('data-action');
      if (action === 'exit') { close(s.id); return; }
      if (action === 'search') { close(s.id,null,false,'search'); return; }
      if (action === 'play') {
        var wasPlaying = !s.video.paused && !s.video.ended;
        var fn = wasPlaying ? win.__langformTogglePlayback : win.__langformPlay;
        clearFeedback(s);
        if (!wasPlaying) s.playConfirmationUntil = win.performance.now() + 360;
        var accepted = typeof fn === 'function' && fn(s.id) !== false;
        if (!accepted) clearFeedback(s);
        else if (wasPlaying && s.video.paused) feedback(s,'pause',0);
      } else if ((action === 'back' || action === 'forward') && seekable(s)) {
        var before = s.video.currentTime;
        s.video.currentTime = Math.min(s.video.duration,Math.max(0,before + (action === 'back' ? -10 : 10)));
        var delta = s.video.currentTime - before;
        if (Number.isFinite(delta) && delta !== 0) feedback(s,action,delta); else clearFeedback(s);
      }
      update(); visible(true);
    });
    function beginControlContact(event,kind) {
      var button = event.target.closest && event.target.closest('button');
      if (state !== s || s.phase !== 'open' || ui.hasAttribute('data-hidden') || event.defaultPrevented ||
          !button || button.disabled || button.closest('[hidden],[inert]') || !matching(s) || ad(s)) return;
      var contact;
      if (kind === 'touch') {
        if (!event.touches || event.touches.length !== 1) { endControlContact(); return; }
        contact = event.touches[0].identifier;
      } else {
        if (event.isPrimary === false || event.button !== undefined && event.button !== 0) return;
        contact = event.pointerId;
      }
      // A visible button owns the contact before its click. Auto-hide must not
      // remove that hit target between pointer/touch down and release.
      s.controlContact = {button:button,kind:kind,contact:contact};
      visible(true);
    }
    function endControlContact(event) {
      var contact = s.controlContact;
      if (!contact) return;
      if (event && contact.kind === 'pointer' && (event.type.indexOf('pointer') === 0 || event.type === 'lostpointercapture') && event.pointerId !== contact.contact) return;
      if (event && contact.kind === 'touch' && event.type === 'touchend' &&
          !Array.from(event.changedTouches || []).some(function (touch) { return touch.identifier === contact.contact; })) return;
      s.controlContact = null;
      if (state === s) visible(true);
    }
    function resetSnap(preserveTarget) { if (!preserveTarget) s.pendingScrubTime = null; s.pointerScrub = false; if (s.chapters && s.chapters.resetSnap) s.chapters.resetSnap(); }
    listen(s,s.range,'input',function () {
      if (!matching(s) || ad(s)) { close(); return; }
      clearFeedback(s);
      if (s.speedOpen) setSpeedOpen(s,false,false);
      s.dragging = true; s.pendingScrubTime = null; clearIdle();
      if (s.pointerScrub && seekable(s) && s.chapters && s.chapters.snap) {
        var result = s.chapters.snap(Number(s.range.value),Math.max(0,s.range.getBoundingClientRect().width - 14),true);
        s.pendingScrubTime = result.value;
        s.range.value = String(result.value);
        if (result.entered) {
          try { var bridge = nativeBridge(); if (bridge) bridge.postMessage({kind:'chapter-snap',videoID:s.id,href:s.href}); } catch (_) { /* feedback is optional */ }
        }
      } else if (s.chapters && s.chapters.resetSnap) s.chapters.resetSnap();
      update();
    });
    listen(s,s.range,'change',function () {
      if (seekable(s)) s.video.currentTime = Math.min(s.video.duration,Math.max(0,scrubTime(s)));
      s.dragging = false; resetSnap(); update(); visible(true);
    });
    listen(s,ui,'pointerdown',function (event) {
      beginControlContact(event,'pointer');
      var button = event.target.closest && event.target.closest('button');
      s.speedPointer = button ? {button:button,until:win.performance.now() + 800} : null;
      if (event.target === s.range && seekable(s)) { resetSnap(); s.pointerScrub = true; s.dragging = true; clearIdle(); }
    });
    listen(s,win,'pointerup',function (event) { endControlContact(event); if (s.dragging) { s.dragging = false; resetSnap(true); visible(true); } });
    listen(s,win,'pointercancel',function (event) { endControlContact(event); s.speedPointer = null; if (s.dragging || s.pendingScrubTime !== null) { s.dragging = false; resetSnap(); update(); visible(true); } });
    listen(s,win,'lostpointercapture',endControlContact);
    listen(s,win,'blur',function () { endControlContact(); });
    if (typeof win.PointerEvent !== 'function') {
      listen(s,ui,'touchstart',function (event) { beginControlContact(event,'touch'); });
      listen(s,win,'touchend',endControlContact);
      listen(s,win,'touchcancel',endControlContact);
    }
    listen(s,s.range,'keydown',function () { resetSnap(); });
    listen(s,s.speedButton,'keydown',function (event) {
      if (state !== s) return;
      if (!matching(s) || ad(s)) { close(s.id); return; }
      s.speedPointer = false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); updateSpeed(s); setSpeedOpen(s,true,true); }
    });
    listen(s,s.speedPanel,'keydown',function (event) {
      if (state !== s) return;
      if (!matching(s) || ad(s)) { close(s.id); return; }
      s.speedPointer = false;
      if (!s.speedOpen) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setSpeedOpen(s,false,true); return; }
      if (event.key === 'Tab') { setSpeedOpen(s,false,true); return; }
      var index = s.speedOptions.indexOf(doc.activeElement), next = index;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = s.speedOptions.length - 1;
      else if (event.key === 'ArrowDown') next = (index + 2) % s.speedOptions.length;
      else if (event.key === 'ArrowUp') next = (index + s.speedOptions.length - 2) % s.speedOptions.length;
      else if (event.key === 'ArrowRight') next = (index + 1) % s.speedOptions.length;
      else if (event.key === 'ArrowLeft') next = (index + s.speedOptions.length - 1) % s.speedOptions.length;
      else return;
      event.preventDefault(); event.stopPropagation(); speedFocus(s,next);
    });
    listen(s,ui,'focusin',function () { visible(true); });
    listen(s,ui,'focusout',function () { win.setTimeout(function () { if (state === s) visible(true); },0); });
    ['timeupdate','durationchange','loadedmetadata','seeked','play','pause','ended','emptied','ratechange'].forEach(function (name) { listen(s,video,name,function () {
      if ((name === 'pause' && s.playConfirmationUntil) || name === 'ended' || name === 'emptied') clearFeedback(s);
      update(); if (name !== 'timeupdate') visible(true);
    }); });
    // play() can flip paused before its promise rejects. Confirm a start only
    // when the matching recent user request produces actual running media.
    listen(s,video,'playing',function () {
      var pending = s.playConfirmationUntil; s.playConfirmationUntil = 0;
      if (pending && win.performance.now() <= pending && !video.paused && !video.ended) feedback(s,'play',0);
    });
    listen(s,video,'error',function () { clearFeedback(s); updateSpeed(s); if (s.speedOpen) setSpeedOpen(s,false,true); });
    listen(s,video,'waiting',function () { if (s.feedback && s.feedback.kind === 'play') clearFeedback(s); });
    listen(s,video,'webkitbeginfullscreen',function () { close(); });
    listen(s,doc,'visibilitychange',function () { if (doc.hidden) { endControlContact(); clearFeedback(s); if (s.phase==='entering') { close(s.id,'inactive',true); return; } if (s.speedOpen) setSpeedOpen(s,false,false); } });
    if (reduced && reduced.addEventListener) listen(s,reduced,'change',function () { if (reduced.matches) { clearFeedback(s); if (s.phase==='entering') { freezeEnterHandoff(s); confirmEnterViewport(s); } } s.speedPanel.toggleAttribute('data-reduced-motion',!!reduced.matches); });
    s.adObserver = new win.MutationObserver(route); s.adObserver.observe(root,{attributes:true,attributeFilter:['class']});
    update(); if (state !== s) return false;
    visible(true);
    if (!emit(true,s)) { if (state === s) close(s.id); return false; }
    return state === s;
    } catch (_) {
      if (state === s) close(s.id,'setup-error',true);
      return false;
    }
  }
  var selector = '#movie_player .ytp-fullscreen-button, .fullscreen-icon, .player-controls-fullscreen-icon, button[aria-label="Vollbild"], button[aria-label="Full screen"]';
  var touch = null, trailing = null, rejected = null;
  function controlFor(event) {
    var node = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
    if (!node || !node.closest) return null;
    var known = node.closest(selector);
    return known && (known.closest('button,[role="button"]') || known);
  }
  function consume(event) { if (event.cancelable) event.preventDefault(); event.stopImmediatePropagation(); }
  function recent(record,control) { return !!record && record.control === control && record.id === id() && Date.now() < record.until; }
  function rejectedGesture(candidate) { if (candidate) rejected = {control:candidate.control,id:candidate.id,until:Date.now()+800}; }
  function ownsFullscreenControl() { return !!state && matching(state) && !ad(state) && !nativeFullscreen(state.video); }
  function handleFullscreenControl() {
    if (!ownsFullscreenControl()) return open();
    // A second real toggle can reverse a pending entry. During exit, retain
    // ownership and consume duplicates instead of invoking YouTube fullscreen.
    if (state.phase!=='exiting') close(state.id);
    return true;
  }
  function click(event) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var control = controlFor(event), node = event.target && event.target.closest && event.target.closest('button,[role="button"]');
    if (recent(trailing,control || node)) { consume(event); if (event.type === 'click') trailing = null; return; }
    if (event.defaultPrevented || !control || recent(rejected,control)) return;
    if (handleFullscreenControl()) { consume(event); if (event.type === 'tap') trailing = {control:control,id:id(),until:Date.now()+800}; }
  }
  function touchStart(event) {
    var control = controlFor(event);
    if (!event.touches || event.touches.length !== 1) { rejectedGesture(touch || (control && {control:control,id:id()})); touch = null; return; }
    if (!control || event.defaultPrevented) { touch = null; return; }
    var point = event.touches[0];
    rejected = null;
    touch = {control:control,id:id(),identifier:point.identifier,x:point.clientX,y:point.clientY,moved:false,ownedAtStart:ownsFullscreenControl()};
  }
  function touchMove(event) {
    if (!touch) return;
    if (!event.touches || event.touches.length !== 1 || event.touches[0].identifier !== touch.identifier) { rejectedGesture(touch); touch = null; return; }
    var point = event.touches[0], dx = point.clientX-touch.x, dy = point.clientY-touch.y;
    if (dx*dx+dy*dy > 100) touch.moved = true;
  }
  function touchEnd(event) {
    var candidate = touch; touch = null;
    if (!candidate) return;
    var point = event.changedTouches && Array.from(event.changedTouches).find(function (item) { return item.identifier === candidate.identifier; });
    var dx = point ? point.clientX-candidate.x : 11, dy = point ? point.clientY-candidate.y : 11;
    if (candidate.moved || !point || dx*dx+dy*dy > 100 || (event.touches && event.touches.length) || controlFor(event) !== candidate.control || candidate.id !== id()) { rejectedGesture(candidate); return; }
    if (!event.defaultPrevented && ((!candidate.ownedAtStart && ownsFullscreenControl()) || handleFullscreenControl())) { trailing = {control:candidate.control,id:candidate.id,until:Date.now()+800}; consume(event); }
  }
  function touchCancel() { rejectedGesture(touch); touch = null; }
  var apiPatches = [], apiRoot = null, apiVideo = null;
  function restoreAPIs() {
    apiPatches.forEach(function (patch) {
      if (patch.node[patch.name] !== patch.wrapper) return;
      if (patch.descriptor) Object.defineProperty(patch.node,patch.name,patch.descriptor);
      else delete patch.node[patch.name];
    });
    apiPatches = []; apiRoot = null; apiVideo = null;
  }
  function explicitActivation() {
    var activation = win.navigator && win.navigator.userActivation;
    if (rejected && rejected.id === id() && Date.now() < rejected.until) return false;
    return !!(activation && activation.isActive) || !!(touch && !touch.moved && touch.id === id());
  }
  function nativeStageOwnsFullscreenRequest(node) {
    try {
      var currentID=id(), info=apiRoot && data(apiRoot);
      if (!currentID || !nativeBridge() || !apiRoot || !apiVideo || nativeFullscreen(apiVideo) ||
          (node!==apiRoot && node!==apiVideo) || !apiRoot.isConnected || !apiVideo.isConnected ||
          doc.getElementById('movie_player')!==apiRoot ||
          (apiRoot.querySelector('video.html5-main-video') || apiRoot.querySelector('video'))!==apiVideo ||
          !info || info.video_id!==currentID || ad({root:apiRoot,video:apiVideo})) return false;
      return !!(win.__langformStageInsets && win.__langformStageInsets.nativeMini===true) ||
          !!(typeof win.__langformIsNativeDragging==='function' && win.__langformIsNativeDragging()===true);
    } catch (_) { return false; }
  }
  function wrapAPI(node,name) {
    var original = node[name]; if (typeof original !== 'function') return;
    var descriptor = Object.getOwnPropertyDescriptor(node,name);
    function wrapper() {
      // A native card gesture already owns this exact current player. YouTube
      // can still request AV fullscreen from touchend while that gesture ends.
      // Consume that second presentation; foreign/ad/native fallback stays intact.
      var intercepted = this === node && (nativeStageOwnsFullscreenRequest(node) ||
          (explicitActivation() && !nativeFullscreen(apiVideo) &&
          ((state && matching(state) && !ad(state) && (state.root === node || state.video === node)) || open())));
      try { if (typeof win.__langformRecordFullscreenAPI === 'function') win.__langformRecordFullscreenAPI(name,intercepted); } catch (_) { /* diagnostic only */ }
      if (intercepted) {
        if (touch) trailing = {control:touch.control,id:touch.id,until:Date.now()+800};
        return name === 'requestFullscreen' ? Promise.resolve() : undefined;
      }
      return original.apply(this,arguments);
    }
    try { Object.defineProperty(node,name,{configurable:true,writable:true,value:wrapper}); apiPatches.push({node:node,name:name,descriptor:descriptor,wrapper:wrapper}); } catch (_) { /* unmodifiable native property keeps its original behavior */ }
  }
  function syncAPIs() {
    if (!alive) return;
    var root = doc.getElementById('movie_player'), video = root && (root.querySelector('video.html5-main-video') || root.querySelector('video'));
    if (root === apiRoot && video === apiVideo) return;
    restoreAPIs(); apiRoot = root; apiVideo = video;
    if (root) ['requestFullscreen','webkitRequestFullscreen','webkitRequestFullScreen'].forEach(function (name) { wrapAPI(root,name); });
    if (video) ['webkitEnterFullscreen','webkitEnterFullScreen','requestFullscreen','webkitRequestFullscreen','webkitRequestFullScreen'].forEach(function (name) { wrapAPI(video,name); });
  }
  var globals = [];
  function global(node,name,fn,capture) { var options = typeof capture === 'object' ? capture : !!capture; node.addEventListener(name,fn,options); globals.push([node,name,fn,options]); }
  // YouTube mobile controls can enter AV fullscreen from touchend before any
  // synthesized click. Window capture runs before its document/target handlers.
  global(win,'touchstart',touchStart,{capture:true,passive:true});
  global(win,'touchmove',touchMove,{capture:true,passive:true});
  global(win,'touchend',touchEnd,{capture:true,passive:false});
  global(win,'touchcancel',touchCancel,{capture:true,passive:true});
  global(win,'tap',click,true);
  global(win,'click',click,true);
  function route() {
    if(inlineSizeOwner&&!ownerMatches(inlineSizeOwner))releaseInlineSizeOwner();
    if (fullscreenProbe && id() !== fullscreenProbe.id) stopFullscreenProbe('cancelled');
    if (state && (!matching(state) || ad(state))) close();
    else if (state && state.phase==='exiting') hideExitContext(state);
  }
  function probeMark(probe,phase) {
    try { var bridge=nativeBridge(); if (bridge) bridge.postMessage({kind:'diagnostic-probe',phase:phase,href:probe.href,videoID:probe.id,token:probe.token}); } catch (_) {}
  }
  function stopFullscreenProbe(phase) {
    var probe=fullscreenProbe;
    if (!probe) return false;
    fullscreenProbe=null;
    win.clearTimeout(probe.timeout); win.clearTimeout(probe.hold);
    win.removeEventListener('player-fullscreen-change',probe.changed);
    doc.removeEventListener('pointerdown',probe.input,true);
    doc.removeEventListener('touchstart',probe.input,true);
    doc.removeEventListener('visibilitychange',probe.hidden);
    if (phase!=='finished' && state && state.id===probe.id) close(probe.id,'diagnostic-cancelled',true);
    probeMark(probe,phase); return true;
  }
  function runFullscreenProbe(expectedID,token,cycles,holdMilliseconds) {
    if (cycles===undefined) cycles=1;
    if (holdMilliseconds===undefined) holdMilliseconds=3000;
    if (win.__langformFullscreenProbeEnabled!==true || win.__langformFullscreenDiagnostics!==true ||
        fullscreenProbe || state || !alive || doc.hidden || id()!==expectedID ||
        typeof token!=='string' || !token || !Number.isInteger(cycles) || cycles<1 || cycles>6 ||
        !Number.isFinite(holdMilliseconds) || holdMilliseconds<200 || holdMilliseconds>3000) return false;
    var probe={id:expectedID,token:token,href:String(win.location.href),phase:'entering',hold:0,timeout:0,cycles:cycles,completed:0};
    var hold=holdMilliseconds;
    function current() { return fullscreenProbe===probe && alive && !doc.hidden && id()===probe.id; }
    probe.changed=function () {
      if (!current()) { stopFullscreenProbe('cancelled'); return; }
      if (probe.phase==='entering' && state && state.phase==='open' && state.id===probe.id && matching(state)) {
        probe.phase='opened'; probeMark(probe,'opened');
        probe.hold=win.setTimeout(function () {
          if (!current() || !state || state.phase!=='open' || !matching(state)) { stopFullscreenProbe('cancelled'); return; }
          probe.phase='closing'; if (!close(probe.id)) stopFullscreenProbe('cancelled');
        },hold);
      } else if (probe.phase==='closing' && !state) {
        probe.phase='inline'; probe.completed++; probeMark(probe,'inline');
        probe.hold=win.setTimeout(function () {
          if (!current() || state) { stopFullscreenProbe('cancelled'); return; }
          if (probe.completed>=probe.cycles) { stopFullscreenProbe('finished'); return; }
          probe.phase='entering'; if (!open()) stopFullscreenProbe('cancelled');
        },hold);
      } else if (!state && probe.phase!=='inline') stopFullscreenProbe('cancelled');
    };
    probe.input=function (event) { if (event.isTrusted) stopFullscreenProbe('cancelled'); };
    probe.hidden=function () { if (doc.hidden) stopFullscreenProbe('cancelled'); };
    fullscreenProbe=probe;
    win.addEventListener('player-fullscreen-change',probe.changed);
    doc.addEventListener('pointerdown',probe.input,true); doc.addEventListener('touchstart',probe.input,true);
    doc.addEventListener('visibilitychange',probe.hidden);
    probe.timeout=win.setTimeout(function () { if (fullscreenProbe===probe) stopFullscreenProbe('timeout'); },Math.min(58000,2000+cycles*(4000+2*hold)));
    if (!open()) { stopFullscreenProbe('cancelled'); return false; }
    return true;
  }
  global(win,'yt-navigate-start',function () { touch = null; trailing = null; rejected = null; close(null,'navigation');releaseInlineSizeOwner(); });
  ['yt-navigate-finish','popstate','video-data-change'].forEach(function (name) { global(win,name,function () { syncAPIs(); route(); }); });
  global(doc,'keydown',function (event) {
    if (!state) return;
    if (state.phase === 'exiting') { event.preventDefault(); return; }
    if (state.phase === 'entering') { event.preventDefault(); if(event.key==='Escape') close(state.id); return; }
    if (!matching(state)) { close(); return; }
    if (event.key === 'Escape') { event.preventDefault(); if (state.speedOpen) setSpeedOpen(state,false,true); else close(); return; }
    if (event.key === 'Tab') {
      visible(true);
      var controls = Array.from(state.ui.querySelectorAll('button,input')).filter(function (node) { return !node.disabled && !node.closest('[hidden],[inert]'); });
      var index = controls.indexOf(doc.activeElement), next = event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length;
      event.preventDefault(); controls[next].focus();
    }
  });
  function nativeChanged() { if (state && nativeFullscreen(state.video)) close(); }
  global(doc,'fullscreenchange',nativeChanged); global(doc,'webkitfullscreenchange',nativeChanged);
  var observer = new win.MutationObserver(function () { syncAPIs(); route(); }); observer.observe(doc.documentElement,{childList:true,subtree:true});
  function pagehide(event) {
    stopFullscreenProbe('cancelled');
    cancelContextReveal();
    alive = false; touch = null; trailing = null; rejected = null; close(null,'pagehide');releaseInlineSizeOwner(); stopGeometryTrace(); observer.disconnect(); restoreAPIs();
    globals.forEach(function (entry) { entry[0].removeEventListener(entry[1],entry[2],entry[3]); });
    style.remove();
    if (!event.persisted) {
      globals = [];
      win.removeEventListener('pagehide',pagehide);
      win.removeEventListener('pageshow',pageshow);
    }
  }
  function pageshow() {
    if (alive) return;
    // WebKit restores the existing document from its back-forward cache;
    // injected scripts and their one-time guards are not rerun. Reattach the
    // suspended resources once, without restoring an obsolete fullscreen UI.
    alive = true;
    (doc.head || doc.documentElement).appendChild(style);
    globals.forEach(function (entry) { entry[0].addEventListener(entry[1],entry[2],entry[3]); });
    observer.observe(doc.documentElement,{childList:true,subtree:true});
    syncAPIs();
  }
  win.addEventListener('pagehide',pagehide);
  win.addEventListener('pageshow',pageshow);
  function resetZoom(s,reason) {
    var zoom=win.__langformPlaybackZoom;
    if (zoom && typeof zoom.reset==='function') { try { zoom.reset(s.id,reason); } catch (_) {} }
  }
  function getZoomContext() {
    var s=state;
    if (!alive || !s || s.phase!=='open' || !matching(s) || ad(s) || doc.hidden || nativeFullscreen(s.video) ||
        !s.ui.isConnected || s.ui.inert) return null;
    var container=s.video.closest('.html5-video-container'),rect=s.root.getBoundingClientRect();
    if (!container || !s.root.contains(container) || !validBox({x:rect.left,y:rect.top,width:rect.width,height:rect.height}) ||
        Math.abs(rect.left)>1 || Math.abs(rect.top)>1 || Math.abs(rect.width-win.innerWidth)>2 || Math.abs(rect.height-win.innerHeight)>2) return null;
    return {id:s.id,root:s.root,video:s.video,container:container,ui:s.ui,rect:rect,
      blocked:!!(s.speedOpen || s.dragging || s.pendingScrubTime!==null || s.chapters && s.chapters.isOpen && s.chapters.isOpen())};
  }
  win.__langformFullscreen = { isOpen:function () { route(); return !!state; }, exit:close,getZoomContext:getZoomContext,
    prepareEnter:function (id,token,width,height,deadline,curve) { return enterViewport(id,token,width,height,false,deadline,curve); },
    finishEnter:function (id,token,width,height,deadline,curve) { return enterViewport(id,token,width,height,true,deadline,curve); },
    prepareExit:prepareExit, finishExit:finishExit, prepareExitMotion:prepareExitMotion,cancelExitMotion:cancelExitMotion };
  if (win.__langformFullscreenProbeEnabled===true && win.__langformFullscreenDiagnostics===true) {
    win.__langformFullscreenDiagnosticProbe={run:runFullscreenProbe,cancel:function (token) {
      return !!fullscreenProbe && fullscreenProbe.token===token && stopFullscreenProbe('cancelled');
    }};
  }
  syncAPIs();
})(typeof window !== 'undefined' ? window : this);
