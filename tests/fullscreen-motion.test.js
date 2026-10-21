const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(process.env.LANGFORM_FULLSCREEN_TEST_SOURCE || path.join(__dirname, '../ios/Langform/Langform/FullscreenMotion.js'), 'utf8').replace('  win.__langformFullscreen = {','  win.__qaInlineDestination=function(){var c=state&&state.inlineDestination;return c?{picture:c.picture,rect:c.rect,root:c.root,clip:c.clip,ratio:c.ratio,rejected:state.exitMotionRejectedReason||0}:null;};\n  win.__langformFullscreen = {');
function setup(t, options = {}) {
  const dom = new JSDOM('<!doctype html><html style="overflow:auto"><head><title>A title - YouTube</title></head><body><main style="transform:translateX(3px)"><div id="movie_player" style="width:390px;height:220px"><div class="html5-video-container"><video class="html5-main-video" src="https://example.test/media" style="object-fit:cover"></video></div><button class="ytp-fullscreen-button">Full</button></div></main></body></html>', { url:'https://m.youtube.com/watch?v=abcdefghijk',runScripts:'outside-only',pretendToBeVisual:true });
  t.after(() => { dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close(); });
  const win = dom.window, doc = win.document, root = doc.getElementById('movie_player'), video = root.querySelector('video');
  win.scrollTo = () => {}; // JSDOM has no scrolling implementation.
  const errors = []; win.addEventListener('error',event => { errors.push(event.message); event.preventDefault(); });
  t.after(() => assert.deepEqual(errors,[], 'shipping script produces no uncaught errors'));
  const messages = [], calls = [], timers = new Map(); let serial = 0;
  let paused = !!options.paused;
  Object.defineProperties(video,{ paused:{get:() => paused}, ended:{value:false,writable:true}, duration:{value:120,writable:true}, readyState:{value:4,writable:true}, currentTime:{value:40,writable:true,configurable:true} });
  video.play = () => { throw Error('Fullscreen must not directly call play'); };
  video.pause = () => { throw Error('Fullscreen must not directly call pause'); };
  root.getVideoData = () => ({ video_id:'abcdefghijk',title:'The actual video' });
  win.__langformPlay = id => { calls.push(['play',id]); if(video.ended){video.currentTime=0;video.ended=false;} paused = false; video.dispatchEvent(new win.Event('play')); if(options.confirmPlaying!==false)video.dispatchEvent(new win.Event('playing')); return true; };
  win.__langformTogglePlayback = id => { calls.push(['toggle',id]); paused = !paused; video.dispatchEvent(new win.Event(paused ? 'pause':'play')); return true; };
  win.webkit = {messageHandlers:{langformFullscreen:{postMessage:value => messages.push(value)}}};
  win.setTimeout = (fn,delay) => { const key = ++serial; timers.set(key,{fn,delay}); return key; };
  win.clearTimeout = key => timers.delete(key);
  if (options.nativeSetup) options.nativeSetup(video,root,win);
  win.eval(source);
  const enter = () => root.querySelector('button').click();
  const ui = () => doc.getElementById('langform-fullscreen-ui');
  const button = action => ui().querySelector(`[data-action="${action}"]`);
  return {win,doc,root,video,messages,calls,timers,enter,ui,button,paused:() => paused};
}

function painted(s, node) {
  for (let current = node; current; current = current.parentElement) {
    const css = s.win.getComputedStyle(current);
    if (css.display === 'none' || css.visibility === 'hidden' || css.opacity === '0') return false;
  }
  return true;
}
function addHeader(s, parent = s.root.parentElement) {
  const header = s.doc.createElement('ytm-header');
  // JSDOM does not resolve stylesheet !important over inline opacity. The real
  // WebKit fixture separately exercises an explicit author opacity:1 here.
  header.style.cssText = 'position:fixed;z-index:2147483647;visibility:visible!important;';
  header.innerHTML = '<a href="/" style="visibility:visible!important">YouTube</a><button aria-label="Suchen">Suche</button><button aria-label="Menü">Menü</button>';
  parent.insertBefore(header, parent.firstChild);
  return header;
}
test('fullscreen hides YouTube logo/search/menu branches even above the player and restores their exact inline styles', t => {
  const s = setup(t), header = addHeader(s), logo = header.querySelector('a');
  const details = s.doc.createElement('section'); details.textContent = 'Watch details'; s.root.parentElement.appendChild(details);
  const styles = [header,logo].map(node => node.getAttribute('style'));
  assert.equal(painted(s,logo),true);
  s.enter();
  assert.equal(painted(s,logo),false);
  assert.equal(painted(s,header.querySelector('button')),false);
  assert.equal(painted(s,details),false);
  assert.equal(painted(s,s.video),true);
  assert.equal(painted(s,s.button('exit')),true);
  assert.equal(s.video.currentTime,40); assert.deepEqual(s.calls,[]);
  s.button('exit').click();
  assert.equal(painted(s,logo),true); assert.equal(painted(s,details),true);
  assert.deepEqual([header,logo].map(node => node.getAttribute('style')),styles);
});
test('hydrated or replaced headers and body-level chrome stay hidden throughout fullscreen without hiding media or own controls', async t => {
  const s = setup(t); s.enter();
  const header = addHeader(s), bodyHeader = addHeader(s,s.doc.body);
  await Promise.resolve();
  assert.equal(painted(s,header),false); assert.equal(painted(s,bodyHeader),false);
  const replacement = header.cloneNode(true); header.replaceWith(replacement);
  await Promise.resolve();
  assert.equal(painted(s,replacement.querySelector('a')),false);
  assert.equal(s.win.__langformFullscreen.isOpen(),true);
  assert.equal(painted(s,s.video),true); assert.equal(painted(s,s.ui()),true);
  s.button('exit').click();
  assert.equal(painted(s,replacement),true); assert.equal(painted(s,bodyHeader),true);
});
test('route cancellation releases hidden YouTube chrome and fullscreen can reopen across repeated cycles', t => {
  const s = setup(t), header = addHeader(s);
  for (let cycle=0;cycle<3;cycle++) {
    s.enter(); assert.equal(painted(s,header),false);
    s.win.history.replaceState({},'', '/watch?v=zyxwvutsrqp');
    s.win.dispatchEvent(new s.win.Event('yt-navigate-finish'));
    assert.equal(s.ui(),null); assert.equal(painted(s,header),true);
    assert.equal(s.root.parentElement.hasAttribute('inert'),false);
    s.win.history.replaceState({},'', '/watch?v=abcdefghijk');
  }
  assert.equal(s.video.currentTime,40); assert.deepEqual(s.calls,[]);
});

test('explicit fullscreen entry preserves media identity, source, playing position and inline layout; exit restores attributes', t => {
  const s = setup(t), parent = s.video.parentElement;
  const styles = [s.doc.documentElement,s.root,s.video,s.root.parentElement].map(n => n.getAttribute('style'));
  s.root.setAttribute('data-langform-fullscreen-player','old');
  s.enter();
  assert.equal(s.win.__langformFullscreen.isOpen(),true);
  assert.equal(s.video.parentElement,parent);
  assert.equal(s.video.getAttribute('src'),'https://example.test/media');
  assert.equal(s.video.currentTime,40); assert.equal(s.paused(),false); assert.deepEqual(s.calls,[]);
  assert.equal(s.ui().querySelector('.lf-fs-title').textContent,'The actual video');
  assert.equal(s.messages[0].open,true);
  assert.equal(s.root.parentElement.hasAttribute('inert'),true);
  assert.equal(s.win.__langformFullscreen.exit('different'),false);
  s.button('exit').click();
  assert.equal(s.win.__langformFullscreen.isOpen(),false);
  assert.equal(s.root.getAttribute('data-langform-fullscreen-player'),'old');
  assert.equal(s.doc.documentElement.hasAttribute('data-langform-fullscreen'),false);
  assert.equal(s.root.parentElement.hasAttribute('data-langform-fullscreen-ancestor'),false);
  assert.equal(s.root.parentElement.hasAttribute('inert'),false);
  assert.deepEqual([s.doc.documentElement,s.root,s.video,s.root.parentElement].map(n => n.getAttribute('style')),styles);
  assert.equal(s.messages[1].open,false); assert.equal(s.video.currentTime,40);
});
test('completed video keeps fullscreen controls reachable and explicit replay and exit preserve the media owner',t=>{
  const s=setup(t),video=s.video,parent=video.parentElement,source=video.getAttribute('src');s.enter();
  s.button('play').click();assert.equal(s.paused(),true);s.button('play').click();assert.equal(s.paused(),false);
  video.currentTime=video.duration;video.ended=true;video.dispatchEvent(new s.win.Event('ended'));
  assert.ok(s.ui());assert.equal(s.ui().hasAttribute('data-hidden'),false);assert.notEqual(s.ui().inert,true);
  assert.equal(s.button('play').getAttribute('aria-label'),'Wiedergabe');s.button('play').click();
  assert.equal(video.ended,false);assert.equal(video.currentTime,0);assert.equal(s.paused(),false);
  s.button('exit').click();assert.equal(s.ui(),null);assert.equal(s.root.parentElement.hasAttribute('inert'),false);
  assert.equal(video,parent.querySelector('video'));assert.equal(video.getAttribute('src'),source);assert.equal(s.calls.filter(row=>row[0]==='play').length,2);
});
test('replacing the completed player branch with a DOM clone releases copied fullscreen leases',async t=>{
  const s=setup(t);s.enter();s.video.ended=true;s.video.dispatchEvent(new s.win.Event('ended'));
  const original=s.root.parentElement,clone=original.cloneNode(true);original.replaceWith(clone);await Promise.resolve();await Promise.resolve();
  assert.equal(s.ui(),null);assert.equal(s.win.__langformFullscreen.isOpen(),false);
  assert.equal(clone.hasAttribute('inert'),false,'copied interaction lease belongs to the retired transaction');
  assert.equal(clone.hasAttribute('data-langform-fullscreen-ancestor'),false);
  assert.equal(clone.querySelector('#movie_player').hasAttribute('data-langform-fullscreen-player'),false,'cloned player cannot retain the fixed fullscreen CSS');
  assert.equal(s.messages.at(-1).open,false);assert.deepEqual(s.calls,[]);
});
test('clone cleanup preserves original and foreign inert state',async t=>{
  const s=setup(t);s.root.parentElement.setAttribute('inert','');s.enter();
  const clone=s.root.parentElement.cloneNode(true),foreign=s.doc.createElement('section');foreign.setAttribute('inert','');s.doc.body.appendChild(foreign);s.root.parentElement.replaceWith(clone);
  await Promise.resolve();await Promise.resolve();assert.equal(s.ui(),null);assert.equal(clone.hasAttribute('inert'),true);
  assert.equal(foreign.hasAttribute('inert'),true,'a branch outside our original lease is never enabled');
  assert.equal(clone.querySelector('#movie_player').hasAttribute('data-langform-fullscreen-player'),false);
});
test('staged cloned exit releases copied context and only owned media style properties',async t=>{
  const s=exitHandoffPage(t,{cached:true}),original=s.root.parentElement,clone=original.cloneNode(true),video=clone.querySelector('video'),source=video.getAttribute('src');
  // JSDOM 26's cloned style parser drops the last property's !important.
  // Preserve the original CSSOM pairs so the fixture reflects browser cloning.
  ['width','height','transform'].forEach(key=>video.style.setProperty(key,s.video.style.getPropertyValue(key),s.video.style.getPropertyPriority(key)));
  video.style.backgroundColor='purple';original.replaceWith(clone);await Promise.resolve();await Promise.resolve();
  assert.equal(s.ui(),null);assert.equal(clone.hasAttribute('inert'),false);assert.equal(clone.querySelectorAll('[data-langform-fullscreen-exit-context]').length,0);
  assert.equal(video.style.width,'');assert.equal(video.style.height,'');assert.equal(video.style.getPropertyValue('transform'),'translateX(7px)');
  assert.equal(video.style.backgroundColor,'purple');assert.equal(video.getAttribute('src'),source);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
test('staged clone cleanup retains page modifications to copied media properties',async t=>{
  const s=exitHandoffPage(t,{cached:true}),original=s.root.parentElement,clone=original.cloneNode(true),video=clone.querySelector('video');
  ['width','height','transform'].forEach(key=>video.style.setProperty(key,s.video.style.getPropertyValue(key),s.video.style.getPropertyPriority(key)));
  video.style.setProperty('width','123px','important');video.style.setProperty('transform','scale(1.2)','important');
  original.replaceWith(clone);await Promise.resolve();await Promise.resolve();
  assert.equal(s.ui(),null);assert.equal(video.style.getPropertyValue('width'),'123px');assert.equal(video.style.getPropertyPriority('width'),'important');
  assert.equal(video.style.getPropertyValue('transform'),'scale(1.2)');assert.equal(video.style.getPropertyPriority('transform'),'important');assert.equal(video.style.height,'');
});
test('lost native exit confirmation times out its own transaction without playback or successful commit',t=>{
  const s=handshakePage(t);s.enter();s.resize(844,390);s.video.ended=true;s.video.dispatchEvent(new s.win.Event('ended'));s.button('exit').click();
  const request=s.messages.find(row=>row.kind==='exit-request'),deadline=[...s.timers.values()].find(row=>row.delay===4000);
  assert.ok(deadline,'every exiting transaction owns a bounded confirmation deadline');deadline.fn();
  assert.equal(s.ui(),null);assert.equal(s.root.parentElement.hasAttribute('inert'),false);assert.equal(s.frames.size,0);
  assert.equal(s.messages.at(-1).reason,'exit-confirmation-timeout');assert.equal(s.messages.some(row=>row.kind==='exit-commit'),false);
  assert.equal(s.win.__langformFullscreen.finishExit('abcdefghijk',request.token,390,844),false);assert.equal(s.video.ended,true);assert.deepEqual(s.calls,[]);
  s.enter();const replacement=s.ui();deadline.fn();assert.equal(s.ui(),replacement,'an obsolete deadline cannot retire a later fullscreen owner');
});
test('successful and cancelled exits remove their deadline while late callbacks cannot close another session',t=>{
  const s=handshakePage(t);s.enter();s.resize(844,390);s.button('exit').click();
  const deadline=[...s.timers.values()].find(row=>row.delay===4000),request=s.messages.find(row=>row.kind==='exit-request');assert.ok(deadline);
  s.win.__langformFullscreen.finishExit('abcdefghijk',request.token,390,844);s.resize(390,844);for(let i=0;i<6;i++)s.frame();
  assert.equal(s.ui(),null);assert.equal([...s.timers.values()].some(row=>row.delay===4000),false);
  s.enter();const replacement=s.ui();deadline.fn();assert.equal(s.ui(),replacement);
  s.resize(844,390);s.button('exit').click();s.win.dispatchEvent(new s.win.Event('yt-navigate-start'));
  assert.equal([...s.timers.values()].some(row=>row.delay===4000),false);assert.deepEqual(s.calls,[]);
});
test('lost native entry confirmation restores the watch page and does not commit or seek',t=>{
  const s=setup(t,{nativeSetup(video,root,win){win.__langformFullscreenEnterProtocol=1;Object.defineProperties(video,{videoWidth:{value:1920},videoHeight:{value:1080}});root.getBoundingClientRect=()=>({x:0,y:110,left:0,top:110,width:390,height:219.375});video.getBoundingClientRect=root.getBoundingClientRect;}});
  s.enter();assert.ok(s.ui());assert.equal(s.ui().inert,true);
  const request=s.messages.find(row=>row.kind==='enter-request'),deadline=[...s.timers.values()].find(row=>row.delay===4000);assert.ok(deadline);deadline.fn();
  assert.equal(s.ui(),null);assert.equal(s.root.parentElement.hasAttribute('inert'),false);assert.equal(s.doc.documentElement.hasAttribute('data-langform-fullscreen'),false);
  assert.equal(s.messages.at(-1).reason,'enter-confirmation-timeout');assert.equal(s.messages.some(row=>row.kind==='enter-commit'),false);
  assert.equal(s.win.__langformFullscreen.finishEnter('abcdefghijk',request.token,844,390),false);assert.equal(s.video.currentTime,40);assert.deepEqual(s.calls,[]);
});
test('fullscreen button consumes original handler only when custom entry is safe; native fullscreen stays native', t => {
  const s = setup(t); let original = 0;
  s.root.querySelector('button').addEventListener('click',() => original++);
  Object.defineProperty(s.video,'webkitDisplayingFullscreen',{value:true,writable:true});
  s.enter(); assert.equal(s.ui(),null); assert.equal(original,1);
  s.video.webkitDisplayingFullscreen = false; s.enter(); assert.ok(s.ui()); assert.equal(original,1);
});
test('pause/play use guarded shipping bridges and explicit ready ad-free seeking clamps', t => {
  const s = setup(t); s.enter();
  s.button('play').click(); assert.deepEqual(s.calls,[['toggle','abcdefghijk']]); assert.equal(s.paused(),true);
  s.button('play').click(); assert.deepEqual(s.calls[1],['play','abcdefghijk']);
  s.button('back').click(); assert.equal(s.video.currentTime,30);
  s.video.currentTime = 117; s.button('forward').click(); assert.equal(s.video.currentTime,120);
  const range = s.ui().querySelector('input'); range.value = '63';
  range.dispatchEvent(new s.win.Event('input',{bubbles:true}));
  assert.equal(s.video.currentTime,120,'scrub preview does not seek before commit');
  range.dispatchEvent(new s.win.Event('change',{bubbles:true})); assert.equal(s.video.currentTime,63);
  s.root.classList.add('ad-showing'); s.button('back').click(); assert.equal(s.video.currentTime,63);
  assert.equal(s.ui(),null,'ad appearance closes custom controls');
  s.root.classList.remove('ad-showing'); s.enter(); s.video.readyState = 1; s.button('forward').click(); assert.equal(s.video.currentTime,63);
});
test('changed route or hydrated media cancels fullscreen before any stale control acts', async t => {
  const s = setup(t); s.enter(); const old = s.button('play');
  s.win.history.replaceState({},'', '/watch?v=zyxwvutsrqp'); old.click();
  assert.equal(s.ui(),null); assert.deepEqual(s.calls,[]); assert.equal(s.video.currentTime,40);
  s.win.history.replaceState({},'', '/watch?v=abcdefghijk'); s.enter();
  s.video.remove(); await Promise.resolve();
  assert.equal(s.win.__langformFullscreen.isOpen(),false);
});
test('controls auto-hide while playing, keep paused and focused actions visible, and allow keyboard exit', t => {
  const s = setup(t); s.enter();
  const idle = [...s.timers.entries()].find(([,value]) => value.delay === 3000); assert.ok(idle);
  s.timers.delete(idle[0]); idle[1].fn();
  assert.equal(s.ui().hasAttribute('data-hidden'),true);
  assert.equal(s.button('play').tabIndex,-1);
  s.ui().click(); assert.equal(s.ui().hasAttribute('data-hidden'),false);
  s.button('play').focus(); assert.equal([...s.timers.values()].some(value => value.delay === 3000),false);
  s.button('play').click(); assert.equal(s.paused(),true); assert.equal(s.ui().hasAttribute('data-hidden'),false);
  s.doc.dispatchEvent(new s.win.KeyboardEvent('keydown',{key:'Escape',bubbles:true})); assert.equal(s.ui(),null);
});

function timedControlSetup(t, options = {}) {
  let now = 0, serial = 0;
  const timers = new Map();
  const s = setup(t,{...options,nativeSetup(video,root,win) {
    options.nativeSetup?.(video,root,win);
    Object.defineProperty(win.performance,'now',{value:() => now});
    win.setTimeout = (fn,delay) => { const key = ++serial; timers.set(key,{fn,at:now + delay,delay}); return key; };
    win.clearTimeout = key => timers.delete(key);
  }});
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([,value]) => value.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = end;
  }
  function pointer(target,name,extra = {}) {
    const event = new s.win.MouseEvent(name,{bubbles:true,cancelable:true,button:0,...extra});
    Object.defineProperty(event,'pointerId',{value:extra.pointerId ?? 1});
    target.dispatchEvent(event); return event;
  }
  return {...s,timers,advance,pointer};
}

for (const kind of ['pointer','touch']) test(`visible Pause ${kind} contact survives the idle deadline and still pauses actual media`,t => {
  const s = timedControlSetup(t); s.enter();
  const pause = s.button('play'), glyph = pause.querySelector('svg');
  s.advance(2900);
  assert.equal(painted(s,pause),true,'contact begins on the actually visible Pause button');
  if (kind === 'pointer') s.pointer(glyph,'pointerdown'); else touchEvent(s,glyph,'touchstart');
  s.advance(250);
  assert.equal(painted(s,pause),true,'pressed Pause must remain hittable while the old idle deadline passes');
  if (kind === 'pointer') s.pointer(glyph,'pointerup'); else touchEvent(s,glyph,'touchend',[],[{identifier:1,clientX:20,clientY:20}]);
  pause.dispatchEvent(new s.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
  assert.equal(s.paused(),true,'the normal released click pauses through the shipping media bridge');
  assert.deepEqual(s.calls,[['toggle','abcdefghijk']]);
  assert.equal(s.button('play').getAttribute('aria-label'),'Wiedergabe');
  s.advance(4000);
  assert.equal(painted(s,s.button('play')),true,'paused media retains its playback control');
  s.button('play').click();
  assert.equal(s.paused(),false);
  assert.deepEqual(s.calls,[['toggle','abcdefghijk'],['play','abcdefghijk']]);
  s.advance(2999);
  assert.equal(painted(s,s.button('play')),true,'resume starts a fresh idle period');
  s.advance(1);
  assert.equal(painted(s,s.button('play')),false,'the ended contact cannot suspend the next idle deadline');
});

function controlContact(s,kind,node,name) {
  if (kind === 'pointer') return s.pointer(node,'pointer'+name);
  return touchEvent(s,node,'touch'+name,name === 'start' ? undefined : [],[{identifier:1,clientX:20,clientY:20}]);
}
for (const kind of ['pointer','touch']) {
  test(`a long ${kind} contact on visible Seek stays hittable, then the normal click and idle timer still work`,t => {
    const s = timedControlSetup(t); s.enter();
    const seek = s.button('forward');
    s.advance(2900); controlContact(s,kind,seek,kind === 'pointer' ? 'down' : 'start');
    s.advance(4000);
    assert.equal(painted(s,seek),true,'contact outlasts both the old and a renewed three-second deadline');
    assert.equal(s.video.currentTime,40,'holding a control never performs its action early');
    controlContact(s,kind,seek,kind === 'pointer' ? 'up' : 'end');
    seek.dispatchEvent(new s.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
    assert.equal(s.video.currentTime,50);
    assert.deepEqual(s.calls,[]);
    s.advance(2999); assert.equal(painted(s,seek),true);
    s.advance(1); assert.equal(painted(s,seek),false);
  });
  for (const reason of ['cancel','blur','background']) test(`visible control ${kind} contact releases on ${reason} without an action or stuck idle timer`,t => {
    const s = timedControlSetup(t); s.enter();
    const pause = s.button('play');
    s.advance(2900); controlContact(s,kind,pause,kind === 'pointer' ? 'down' : 'start'); s.advance(4000);
    assert.equal(painted(s,pause),true);
    if (reason === 'cancel') controlContact(s,kind,pause,'cancel');
    else if (reason === 'blur') s.win.dispatchEvent(new s.win.Event('blur'));
    else {
      Object.defineProperty(s.doc,'hidden',{value:true,configurable:true});
      s.doc.dispatchEvent(new s.win.Event('visibilitychange'));
      Object.defineProperty(s.doc,'hidden',{value:false,configurable:true});
      s.doc.dispatchEvent(new s.win.Event('visibilitychange'));
    }
    assert.equal(s.paused(),false); assert.deepEqual(s.calls,[]);
    s.advance(2999); assert.equal(painted(s,pause),true);
    s.advance(1); assert.equal(painted(s,pause),false);
  });
  test(`visible Exit ${kind} contact survives the old deadline and restores an independent next fullscreen session`,t => {
    const s = timedControlSetup(t); s.enter();
    const exit = s.button('exit');
    s.advance(2900); controlContact(s,kind,exit,kind === 'pointer' ? 'down' : 'start'); s.advance(4000);
    assert.equal(painted(s,exit),true);
    controlContact(s,kind,exit,kind === 'pointer' ? 'up' : 'end');
    exit.dispatchEvent(new s.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
    assert.equal(s.ui(),null); assert.equal(s.video.currentTime,40); assert.deepEqual(s.calls,[]);
    assert.equal(s.timers.size,0,'closing disposes the contact and idle callbacks');
    s.enter(); s.advance(3000);
    assert.equal(painted(s,s.button('play')),false,'old Exit contact cannot own the reopened controls');
  });
  test(`media replacement during a ${kind} control contact rejects the stale Pause click and releases fullscreen`,async t => {
    const s = timedControlSetup(t); s.enter();
    const pause = s.button('play');
    s.advance(2900); controlContact(s,kind,pause,kind === 'pointer' ? 'down' : 'start');
    const replacement = s.video.cloneNode(true);
    Object.defineProperty(replacement,'currentTime',{value:85,writable:true});
    s.video.replaceWith(replacement); await Promise.resolve();
    controlContact(s,kind,pause,kind === 'pointer' ? 'up' : 'end');
    pause.dispatchEvent(new s.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
    s.advance(4000);
    assert.equal(s.ui(),null); assert.equal(replacement.currentTime,85);
    assert.equal(s.video.currentTime,40); assert.equal(s.paused(),false); assert.deepEqual(s.calls,[]);
    assert.equal(s.timers.size,0);
  });
  test(`a ${kind} contact on free fullscreen background preserves the existing short-tap visibility toggle`,t => {
    const s = timedControlSetup(t); s.enter();
    s.advance(2900); controlContact(s,kind,s.ui(),kind === 'pointer' ? 'down' : 'start');
    s.advance(250);
    assert.equal(painted(s,s.button('play')),false,'background does not suspend the own-control idle timer');
    controlContact(s,kind,s.ui(),kind === 'pointer' ? 'up' : 'end');
    s.ui().dispatchEvent(new s.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
    assert.equal(painted(s,s.button('play')),true);
    assert.equal(s.paused(),false); assert.equal(s.video.currentTime,40); assert.deepEqual(s.calls,[]);
    s.advance(3000); assert.equal(painted(s,s.button('play')),false);
  });
}

test('an unrelated pointer release cannot end a visible own-control contact, but its owner cancel can',t => {
  const s = timedControlSetup(t); s.enter();
  const pause = s.button('play');
  s.advance(2900); s.pointer(pause,'pointerdown',{pointerId:7});
  s.pointer(s.win,'pointerup',{pointerId:8}); s.advance(4000);
  assert.equal(painted(s,pause),true); assert.deepEqual(s.calls,[]);
  s.pointer(s.win,'pointercancel',{pointerId:7}); s.advance(3000);
  assert.equal(painted(s,pause),false); assert.deepEqual(s.calls,[]);
});

test('an unrelated touch ending cannot release a touch-owned control and an added touch cancels that ownership',t => {
  const s = timedControlSetup(t); s.enter();
  const pause = s.button('play');
  s.advance(2900); touchEvent(s,pause,'touchstart');
  touchEvent(s,s.win,'touchend',[],[{identifier:9,clientX:10,clientY:10}]); s.advance(4000);
  assert.equal(painted(s,pause),true);
  touchEvent(s,pause,'touchstart',[{identifier:1,clientX:20,clientY:20},{identifier:9,clientX:10,clientY:10}]);
  s.advance(3000); assert.equal(painted(s,pause),false); assert.deepEqual(s.calls,[]);
});

test('pagehide cleans up state and stylesheet; motion is optional through the reduce-motion media query', t => {
  const s = setup(t); s.enter();
  const css = s.doc.getElementById('langform-fullscreen-style').textContent;
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)[\s\S]*transition:none/);
  s.win.dispatchEvent(new s.win.Event('pagehide'));
  assert.equal(s.win.__langformFullscreen.isOpen(),false);
  assert.equal(s.ui(),null); assert.equal(s.doc.getElementById('langform-fullscreen-style'),null);
  assert.equal(s.timers.size,0); assert.equal(s.doc.documentElement.hasAttribute('data-langform-fullscreen'),false);
  s.enter(); assert.equal(s.ui(),null);
});

test('a restored back-forward cache page can enter fullscreen again without duplicating listeners or API patches', async t => {
  let nativeCalls = 0;
  const nativeEnter = () => { nativeCalls++; };
  const s = setup(t, { nativeSetup(video, root, win) {
    video.webkitEnterFullscreen = nativeEnter;
    Object.defineProperty(win.navigator, 'userActivation', { value: { isActive: true } });
  } });
  for (let cycle = 0; cycle < 2; cycle++) {
    s.enter();
    assert.ok(s.ui());
    s.win.dispatchEvent(new s.win.PageTransitionEvent('pagehide', { persisted: true }));
    assert.equal(s.ui(), null);
    assert.equal(s.doc.getElementById('langform-fullscreen-style'), null);
    assert.equal(s.video.webkitEnterFullscreen, nativeEnter, 'cached pages release native API wrappers');
    assert.equal(s.root.parentElement.hasAttribute('inert'), false);
    assert.equal(s.timers.size, 0);
    s.enter();
    assert.equal(s.ui(), null, 'a suspended page cannot open fullscreen');

    s.win.dispatchEvent(new s.win.PageTransitionEvent('pageshow', { persisted: true }));
    s.win.dispatchEvent(new s.win.PageTransitionEvent('pageshow', { persisted: true }));
    assert.equal(s.doc.querySelectorAll('#langform-fullscreen-style').length, 1);
    assert.notEqual(s.video.webkitEnterFullscreen, nativeEnter);
    const reports = s.messages.filter(message => message.open).length;
    s.video.webkitEnterFullscreen();
    assert.ok(s.ui(), 'fullscreen API interception resumes with the restored document');
    assert.equal(s.messages.filter(message => message.open).length, reports + 1);
    s.button('play').click();
    assert.equal(s.calls.length, cycle + 1, 'one restored click triggers one playback action');
    s.win.__langformFullscreen.exit('abcdefghijk');
  }
  assert.equal(nativeCalls, 0);
  s.enter();
  s.video.remove();
  await Promise.resolve();
  assert.equal(s.ui(), null, 'the resumed observer still detects removal of the owned media');
});

test('keyboard focus remains inside fullscreen and mismatched player identity cannot enter or seek', t => {
  const s = setup(t);
  s.root.getVideoData = () => ({video_id:'zyxwvutsrqp'}); s.enter(); assert.equal(s.ui(),null);
  s.root.getVideoData = () => ({video_id:'abcdefghijk'}); s.enter();
  s.doc.dispatchEvent(new s.win.KeyboardEvent('keydown',{key:'Tab',bubbles:true}));
  assert.equal(s.doc.activeElement,s.button('exit'));
  s.doc.dispatchEvent(new s.win.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true}));
  assert.equal(s.doc.activeElement,s.ui().querySelector('input'));
  const stale = s.button('forward'); s.root.getVideoData = () => ({video_id:'zyxwvutsrqp'}); stale.click();
  assert.equal(s.video.currentTime,40); assert.equal(s.ui(),null);
});

test('ads retain original fullscreen and starting an ad restores background interaction without touching media', async t => {
  const s = setup(t); let original = 0;
  s.root.querySelector('button').addEventListener('click',() => original++);
  for (const name of ['ad-showing','ad-interrupting']) {
    s.root.classList.add(name); s.enter(); assert.equal(s.ui(),null); s.root.classList.remove(name);
  }
  s.root.getVideoData = () => ({video_id:'abcdefghijk',isAd:true}); s.enter(); assert.equal(s.ui(),null);
  assert.equal(original,3); assert.deepEqual(s.calls,[]);
  s.root.getVideoData = () => ({video_id:'abcdefghijk'}); s.enter();
  assert.equal(s.root.parentElement.hasAttribute('inert'),true);
  s.root.classList.add('ad-showing'); await Promise.resolve();
  assert.equal(s.ui(),null); assert.equal(s.root.parentElement.hasAttribute('inert'),false);
  assert.equal(s.video.currentTime,40); assert.equal(s.paused(),false); assert.deepEqual(s.calls,[]);
  s.root.classList.remove('ad-showing'); s.enter();
  s.root.getVideoData = () => ({video_id:'abcdefghijk',isAd:true});
  s.win.dispatchEvent(new s.win.Event('video-data-change')); assert.equal(s.ui(),null);
});
test('SVG controls and timeline progress reflect pause and explicit scrub, with motion restricted to UI', t => {
  const s = setup(t); s.enter(); const range = s.ui().querySelector('input');
  assert.equal(s.ui().querySelectorAll('button svg').length,5);
  assert.match(s.button('play').innerHTML,/M6 5h4/,'playing shows pause SVG');
  assert.ok(Math.abs(parseFloat(range.parentElement.style.getPropertyValue('--progress')) - 100 / 3) < .001);
  range.value = '90'; range.dispatchEvent(new s.win.Event('input',{bubbles:true}));
  assert.equal(range.parentElement.style.getPropertyValue('--progress'),'75%');
  assert.equal(s.video.currentTime,40,'timeline preview does not move media');
  range.dispatchEvent(new s.win.Event('change',{bubbles:true}));
  s.button('play').click(); assert.match(s.button('play').innerHTML,/M8 5v14/,'paused shows play SVG');
  const css = s.doc.getElementById('langform-fullscreen-style').textContent;
  assert.match(css,/height:3px/); assert.match(css,/width:14px; height:14px/); assert.match(css,/height:44px/);
  assert.match(css,/lf-fs-enter 200ms cubic-bezier\(\.16,1,\.3,1\)/); assert.match(css,/@media \(prefers-reduced-motion:reduce\)[\s\S]*animation:none/);
});

test('unchanged playback events keep fullscreen controls untouched while progress and accessibility update at their own pace', t => {
  const s = setup(t); s.enter();
  const observer = new s.win.MutationObserver(() => {});
  observer.observe(s.ui(),{subtree:true,attributes:true,childList:true,characterData:true});
  const icon = s.button('play').firstChild;
  for (let i=0;i<12;i++) s.video.dispatchEvent(new s.win.Event('timeupdate'));
  assert.equal(observer.takeRecords().length,0,'a repeated media event does not invalidate identical DOM');
  s.video.currentTime=40.25; s.video.dispatchEvent(new s.win.Event('timeupdate'));
  const changes=observer.takeRecords();
  assert.equal(changes.length,1,'subsecond playback only changes visible timeline progress');
  assert.equal(changes[0].attributeName,'style');
  assert.equal(s.ui().querySelector('[data-clock]').textContent,'0:40 / 2:00');
  assert.equal(s.button('play').firstChild,icon,'no glyph animation restarts on timeupdate');
  s.video.currentTime=41; s.video.dispatchEvent(new s.win.Event('timeupdate'));
  assert.equal(s.ui().querySelector('[data-clock]').textContent,'0:41 / 2:00');
  assert.equal(s.ui().querySelector('input').getAttribute('aria-valuetext'),'0:41');
  observer.takeRecords();
  s.button('play').click();
  assert.equal(s.button('play').getAttribute('aria-label'),'Wiedergabe');
  observer.takeRecords();
  for (let i=0;i<12;i++) s.video.dispatchEvent(new s.win.Event('timeupdate'));
  assert.equal(observer.takeRecords().length,0,'paused playback does not keep rewriting focus or visibility state');
  observer.disconnect();
});

test('fullscreen viewport-fit covers safe areas and restores original or removes created viewport metadata', t => {
  const s = setup(t); s.enter();
  let meta = s.doc.querySelector('meta[name="viewport"]'); assert.match(meta.content,/viewport-fit=cover/);
  s.win.__langformFullscreen.exit('abcdefghijk'); assert.equal(s.doc.querySelector('meta[name="viewport"]'),null);
  meta = s.doc.createElement('meta'); meta.name = 'viewport'; meta.content = 'width=device-width, initial-scale=1, viewport-fit=contain'; s.doc.head.appendChild(meta);
  const original = meta.content; s.enter(); assert.match(meta.content,/viewport-fit=cover/); assert.doesNotMatch(meta.content,/viewport-fit=contain/);
  s.win.__langformFullscreen.exit('abcdefghijk'); assert.equal(meta.content,original);
  meta.removeAttribute('content'); s.enter(); assert.match(meta.content,/viewport-fit=cover/);
  s.win.__langformFullscreen.exit('abcdefghijk'); assert.equal(meta.hasAttribute('content'),false);
});

function touchEvent(s, target, name, points = [{identifier:1,clientX:20,clientY:20}], ended) {
  const event = new s.win.Event(name,{bubbles:true,cancelable:true});
  Object.defineProperties(event,{touches:{value:points},changedTouches:{value:ended || points}});
  target.dispatchEvent(event); return event;
}
test('mobile fullscreen touchend is captured before native handler and trailing click cannot duplicate entry', t => {
  const s = setup(t), control = s.root.querySelector('button'); let native = 0;
  Object.defineProperty(s.video,'webkitDisplayingFullscreen',{value:false,writable:true});
  s.video.webkitEnterFullscreen = () => { native++; s.video.webkitDisplayingFullscreen = true; };
  control.addEventListener('touchend',() => s.video.webkitEnterFullscreen());
  control.addEventListener('click',() => s.video.webkitEnterFullscreen());
  touchEvent(s,control,'touchstart');
  const ended = touchEvent(s,control,'touchend',[],[{identifier:1,clientX:20,clientY:20}]);
  assert.equal(native,0,'native touch handler must not run before HTML fullscreen');
  assert.equal(ended.defaultPrevented,true); assert.ok(s.ui());
  control.click(); assert.equal(native,0,'trailing synthesized click cannot request native fullscreen');
  assert.equal(s.messages.filter(message => message.open).length,1);
  assert.equal(s.video.currentTime,40); assert.equal(s.paused(),false); assert.deepEqual(s.calls,[]);
});

test('mobile moves, cancellation, multiple touches, prevented events and unrelated controls remain untouched', t => {
  const s = setup(t), control = s.root.querySelector('button'); let delivered = 0;
  control.addEventListener('touchend',() => delivered++);
  touchEvent(s,control,'touchstart');
  touchEvent(s,control,'touchmove',[{identifier:1,clientX:40,clientY:20}]);
  const moved = touchEvent(s,control,'touchend',[],[{identifier:1,clientX:20,clientY:20}]);
  assert.equal(moved.defaultPrevented,false); assert.equal(s.ui(),null);
  control.dispatchEvent(new s.win.Event('tap',{bubbles:true,cancelable:true})); assert.equal(s.ui(),null,'moved gesture cannot become fullscreen through a synthesized tap');
  touchEvent(s,control,'touchstart'); touchEvent(s,control,'touchcancel',[]);
  touchEvent(s,control,'touchend',[],[{identifier:1,clientX:20,clientY:20}]); assert.equal(s.ui(),null);
  touchEvent(s,control,'touchstart');
  touchEvent(s,control,'touchmove',[{identifier:1,clientX:20,clientY:20},{identifier:2,clientX:30,clientY:20}]);
  touchEvent(s,control,'touchend',[],[{identifier:1,clientX:20,clientY:20}]); assert.equal(s.ui(),null);
  const unrelated = s.doc.createElement('button'); unrelated.textContent = 'Untertitel'; s.root.appendChild(unrelated);
  touchEvent(s,unrelated,'touchstart'); const plain = touchEvent(s,unrelated,'touchend',[],[{identifier:1,clientX:20,clientY:20}]);
  assert.equal(plain.defaultPrevented,false); assert.equal(s.ui(),null); assert.equal(delivered,3);
  touchEvent(s,control,'touchstart');
  const prevented = new s.win.Event('touchend',{bubbles:true,cancelable:true});
  Object.defineProperties(prevented,{touches:{value:[]},changedTouches:{value:[{identifier:1,clientX:20,clientY:20}]}});
  prevented.preventDefault(); control.dispatchEvent(prevented); assert.equal(s.ui(),null);
});
test('mobile native fullscreen and ads keep original touch flow, while known icon tap uses custom UI', t => {
  const s = setup(t), control = s.root.querySelector('button'); let original = 0;
  control.className = ''; control.innerHTML = '<svg class="fullscreen-icon"><path d="M0 0h5"></path></svg>';
  const icon = control.querySelector('path'); control.addEventListener('touchend',() => original++);
  s.root.classList.add('ad-showing'); touchEvent(s,icon,'touchstart');
  const ad = touchEvent(s,icon,'touchend',[],[{identifier:1,clientX:20,clientY:20}]); assert.equal(ad.defaultPrevented,false); assert.equal(s.ui(),null);
  s.root.classList.remove('ad-showing'); Object.defineProperty(s.video,'webkitDisplayingFullscreen',{value:true,writable:true});
  touchEvent(s,icon,'touchstart'); touchEvent(s,icon,'touchend',[],[{identifier:1,clientX:20,clientY:20}]); assert.equal(s.ui(),null); assert.equal(original,2);
  s.video.webkitDisplayingFullscreen = false; touchEvent(s,icon,'touchstart');
  touchEvent(s,icon,'touchend',[],[{identifier:1,clientX:20,clientY:20}]); assert.ok(s.ui()); assert.equal(original,2);
  let clicks = 0; control.addEventListener('click',() => clicks++); control.click(); assert.equal(clicks,0,'trailing click on the icon button is also suppressed');
  s.win.__langformFullscreen.exit('abcdefghijk');
  const tapped = new s.win.Event('tap',{bubbles:true,cancelable:true}); icon.dispatchEvent(tapped); assert.equal(tapped.defaultPrevented,true); assert.ok(s.ui());
});

test('owned native fullscreen API requested in touchstart enters custom UI before native flow', t => {
  let native = 0;
  const s = setup(t,{nativeSetup(video) { video.webkitEnterFullscreen = () => { native++; }; }});
  const control = s.root.querySelector('button'); control.addEventListener('touchstart',() => s.video.webkitEnterFullscreen());
  touchEvent(s,control,'touchstart');
  assert.equal(native,0,'owned native API must route an explicit fullscreen touch to custom UI'); assert.ok(s.ui());
  touchEvent(s,control,'touchend',[],[{identifier:1,clientX:20,clientY:20}]); control.click();
  assert.equal(s.messages.filter(message => message.open).length,1); assert.equal(native,0);
});

test('owned API fallback preserves original calls without activation, ads, borrowed receivers and teardown', async t => {
  let calls = [], active = false, original;
  const s = setup(t,{nativeSetup(video,root,win) {
    Object.defineProperty(win.navigator,'userActivation',{value:{get isActive(){return active;}}});
    original = function(...args) { calls.push({receiver:this,args}); return Promise.resolve('native'); };
    video.webkitEnterFullscreen = original; root.requestFullscreen = original;
  }});
  assert.equal(await s.root.requestFullscreen('options'),'native'); assert.equal(calls.length,1); assert.deepEqual(calls[0].args,['options']);
  const unowned = s.doc.createElement('video'); unowned.webkitEnterFullscreen = original; s.doc.body.appendChild(unowned);
  active = true; assert.equal(await s.root.requestFullscreen.call(unowned,'borrowed'),'native'); assert.equal(calls[1].receiver,unowned); assert.equal(s.ui(),null);
  s.root.classList.add('ad-showing'); assert.equal(await s.video.webkitEnterFullscreen('ad'),'native'); assert.equal(s.ui(),null);
  s.root.classList.remove('ad-showing'); const promise = s.root.requestFullscreen();
  assert.equal(typeof promise.then,'function'); await promise; assert.ok(s.ui()); assert.equal(calls.length,3);
  assert.equal(unowned.webkitEnterFullscreen,original,'unowned media API remains untouched');
  s.win.dispatchEvent(new s.win.Event('pagehide'));
  assert.equal(s.video.webkitEnterFullscreen,original); assert.equal(s.root.requestFullscreen,original);
});
test('owned API patches follow hydrated main video and restore replaced media API', async t => {
  let oldOriginal,newOriginal;
  const s = setup(t,{nativeSetup(video) { oldOriginal = () => 'old'; video.webkitEnterFullscreen = oldOriginal; }});
  const replacement = s.video.cloneNode(); newOriginal = () => 'new'; replacement.webkitEnterFullscreen = newOriginal;
  s.video.replaceWith(replacement); await Promise.resolve();
  assert.equal(s.video.webkitEnterFullscreen,oldOriginal);
  assert.notEqual(replacement.webkitEnterFullscreen,newOriginal);
  s.win.dispatchEvent(new s.win.Event('pagehide')); assert.equal(replacement.webkitEnterFullscreen,newOriginal);
});
test('fullscreen chapter helper mounts with guarded media access, ignores nested action buttons and tears down', t => {
  const s = setup(t); let mounted, updates = 0, closed = 0, panelOpen = false;
  s.win.__langformFullscreenChapters = {mount(options) {
    mounted = options;
    const row = s.doc.createElement('button'); row.textContent = 'Kapitel'; row.setAttribute('data-action','unknown'); options.host.appendChild(row);
    return {update(){updates++;},close(){closed++;},isOpen(){return panelOpen;}};
  }};
  s.enter(); assert.equal(mounted.videoID,'abcdefghijk'); assert.equal(mounted.getTime(),40); assert.equal(mounted.getDuration(),120);
  assert.equal(mounted.markerHost,s.ui().querySelector('.lf-fs-range-wrap')); assert.equal(mounted.canSeek(),true); assert.ok(updates>0);
  mounted.host.querySelector('button').click(); assert.equal(s.video.currentTime,40,'chapter panel click must not fall through to +10s');
  assert.equal(mounted.seek(65),true); assert.equal(s.video.currentTime,65);
  assert.equal(mounted.seek(Infinity),false); panelOpen = true; mounted.onActivity();
  assert.equal([...s.timers.values()].some(value => value.delay === 3000),false,'open chapter panel keeps controls visible');
  s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp'); assert.equal(mounted.canSeek(),false); assert.equal(mounted.seek(100),false);
  s.win.__langformFullscreen.isOpen(); assert.equal(closed,1); assert.equal(s.ui(),null);
});

test('shipping fullscreen and chapters display current chapter, named rows, timestamps and guarded seeks together', t => {
  const s = setup(t);
  s.win.ytInitialPlayerResponse = {videoDetails:{videoId:'abcdefghijk'}};
  s.win.__langformChapterCache = {player:s.win.ytInitialPlayerResponse,fractions:[{start:0,title:'Einleitung'},{start:30,title:'Das Thema'},{start:75,title:'Fazit'}]};
  s.doc.documentElement.__langformChapterVideoID = 'abcdefghijk';
  s.doc.documentElement.__langformChapterList = s.win.__langformChapterCache.fractions;
  s.win.eval(fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/FullscreenChapters.js'),'utf8'));
  s.enter(); const label = s.ui().querySelector('.lf-fs-chapter-label');
  assert.match(label.textContent,/Das Thema/); assert.equal(s.ui().querySelector('[data-clock]').textContent,'0:40 / 2:00');
  s.doc.dispatchEvent(new s.win.KeyboardEvent('keydown',{key:'Tab',bubbles:true})); assert.equal(s.doc.activeElement,s.button('exit'));
  label.click(); assert.equal(s.video.currentTime,40,'opening chapter UI does not seek');
  const panel = s.ui().querySelector('.lf-fs-chapter-panel'); assert.equal(panel.hidden,false);
  const row = panel.querySelector('[data-lf-fs-chapter-start="75"]'); assert.match(row.textContent,/1:15Fazit/);
  row.click(); assert.equal(s.video.currentTime,75); assert.match(label.textContent,/Fazit/); assert.equal(panel.hidden,true);
  assert.equal(s.ui().querySelector('[data-clock]').textContent,'1:15 / 2:00');
  assert.equal(s.paused(),false); assert.deepEqual(s.calls,[]);
  s.win.__langformFullscreen.exit('abcdefghijk'); assert.equal(s.ui(),null);
});

test('missing native fullscreen bridge must preserve the original explicit native API instead of swallowing entry', t => {
  let native = 0;
  const s = setup(t,{nativeSetup(video,root,win) {
    Object.defineProperty(win.navigator,'userActivation',{value:{isActive:true}});
    video.webkitEnterFullscreen = () => { native++; };
  }});
  delete s.win.webkit.messageHandlers.langformFullscreen;
  s.video.webkitEnterFullscreen();
  assert.equal(native,1,'custom entry cannot replace native fullscreen without its native bridge');
  assert.equal(s.ui(),null);
});
test('synchronous rejection during fullscreen notification must not consume the original native API', t => {
  let native = 0;
  const s = setup(t,{nativeSetup(video,root,win) {
    Object.defineProperty(win.navigator,'userActivation',{value:{isActive:true}});
    video.webkitEnterFullscreen = () => { native++; };
  }});
  s.win.addEventListener('player-fullscreen-change',event => { if (event.detail.open) s.win.__langformFullscreen.exit('abcdefghijk'); });
  s.video.webkitEnterFullscreen();
  assert.equal(s.ui(),null); assert.equal(native,1,'open then close cannot leave the user without either fullscreen');
});

test('throwing native fullscreen bridge restores custom layout and passes through explicit native entry', t => {
  let native = 0;
  const s = setup(t,{nativeSetup(video,root,win) {
    Object.defineProperty(win.navigator,'userActivation',{value:{isActive:true}});
    video.webkitEnterFullscreen = () => { native++; };
  }});
  const originalStyle = s.root.getAttribute('style');
  s.win.webkit.messageHandlers.langformFullscreen.postMessage = () => { throw Error('bridge unavailable'); };
  s.video.webkitEnterFullscreen();
  assert.equal(native,1); assert.equal(s.ui(),null); assert.equal(s.win.__langformFullscreen.isOpen(),false);
  assert.equal(s.root.getAttribute('style'),originalStyle); assert.equal(s.root.hasAttribute('data-langform-fullscreen-player'),false);
  assert.equal(s.doc.documentElement.hasAttribute('data-langform-fullscreen'),false); assert.equal(s.root.parentElement.hasAttribute('inert'),false);
  assert.equal(s.doc.querySelector('meta[name=viewport]'),null); assert.equal(s.video.currentTime,40); assert.equal(s.paused(),false);
});

test('a fullscreen DOM construction exception rolls back viewport and allows exactly one original API call', t => {
  let native = 0;
  const s = setup(t,{nativeSetup(video,root,win) {
    Object.defineProperty(win.navigator,'userActivation',{value:{isActive:true}});
    video.webkitEnterFullscreen = () => { native++; };
  }});
  const create = s.doc.createElement.bind(s.doc); let injected = false;
  s.doc.createElement = function(tag,...args) { if (tag === 'div' && !injected) { injected = true; throw Error('fixture DOM failure'); } return create(tag,...args); };
  assert.doesNotThrow(() => s.video.webkitEnterFullscreen());
  assert.equal(native,1); assert.equal(s.ui(),null); assert.equal(s.doc.querySelector('meta[name=viewport]'),null);
  assert.equal(s.doc.documentElement.hasAttribute('data-langform-fullscreen'),false); assert.equal(s.root.hasAttribute('data-langform-fullscreen-player'),false);
});
test('a failing chapter mount or initial update rolls back fullscreen and calls original API once', t => {
  for (const failure of ['mount','update']) {
    let native = 0;
    const s = setup(t,{nativeSetup(video,root,win) {
      Object.defineProperty(win.navigator,'userActivation',{value:{isActive:true}});
      video.webkitEnterFullscreen = () => { native++; };
    }});
    s.win.__langformFullscreenChapters = {mount() { if (failure === 'mount') throw Error('mount failed'); return {update(){throw Error('initial update failed');},close(){},isOpen(){return false;}}; }};
    assert.doesNotThrow(() => s.video.webkitEnterFullscreen());
    assert.equal(native,1); assert.equal(s.ui(),null); assert.equal(s.root.parentElement.hasAttribute('inert'),false);
    assert.equal(s.messages.filter(message => message.open).length,0,'failed setup never requests native fullscreen ID acceptance');
    assert.equal(s.messages.at(-1).reason,'setup-error');
    assert.equal(s.doc.documentElement.hasAttribute('data-langform-fullscreen'),false); assert.equal(s.root.hasAttribute('data-langform-fullscreen-player'),false);
    assert.equal(s.doc.querySelector('meta[name=viewport]'),null); assert.equal(s.video.currentTime,40); assert.equal(s.paused(),false);
  }
});

test('fullscreen DOM and SVG construction works when page HTML sinks reject string assignments', t => {
  const s = setup(t), descriptor = Object.getOwnPropertyDescriptor(s.win.Element.prototype,'innerHTML');
  Object.defineProperty(s.win.Element.prototype,'innerHTML',{configurable:true,get:descriptor.get,set(){throw Error('HTML string sink rejected');}});
  assert.doesNotThrow(() => s.enter()); assert.ok(s.ui()); assert.equal(s.ui().querySelectorAll('button svg').length,5);
  assert.doesNotThrow(() => s.button('play').click()); assert.equal(s.paused(),true);
  assert.doesNotThrow(() => s.win.__langformFullscreen.exit('abcdefghijk')); assert.equal(s.ui(),null);
  Object.defineProperty(s.win.Element.prototype,'innerHTML',descriptor);
});

test('external fullscreen UI removal must release background inert and close the obsolete UI state', async t => {
  const s = setup(t); s.enter(); assert.equal(s.root.parentElement.hasAttribute('inert'),true);
  s.ui().remove(); await Promise.resolve();
  assert.equal(s.root.parentElement.hasAttribute('inert'),false,'DOM observer restores interaction before any isOpen probe');
  assert.equal(s.win.__langformFullscreen.isOpen(),false,'missing fullscreen UI cannot keep a live fullscreen state');
  assert.equal(s.root.parentElement.hasAttribute('inert'),false,'video and page controls must regain interaction after the UI disappears');
  assert.equal(s.doc.documentElement.hasAttribute('data-langform-fullscreen'),false);
});

test('external fullscreen stylesheet removal releases inert and preserves subsequent native fullscreen fallback', async t => {
  const s = setup(t); s.enter(); s.doc.getElementById('langform-fullscreen-style').remove(); await Promise.resolve();
  assert.equal(s.ui(),null,'stylesheet DOM removal is cleaned up by the observer');
  assert.equal(s.win.__langformFullscreen.isOpen(),false); assert.equal(s.ui(),null); assert.equal(s.root.parentElement.hasAttribute('inert'),false);
  assert.equal(s.doc.documentElement.hasAttribute('data-langform-fullscreen'),false); assert.equal(s.doc.querySelector('meta[name=viewport]'),null);
  let original = 0; s.root.querySelector('button').addEventListener('click',() => original++); s.enter();
  assert.equal(s.ui(),null); assert.equal(original,1,'missing owned CSS cannot swallow a subsequent native request');
});
test('loss of owned fullscreen attributes closes UI and restores original ancestor interaction', async t => {
  for (const owner of ['html','player','ancestor']) {
    const s = setup(t); s.enter();
    const node = owner === 'html' ? s.doc.documentElement : owner === 'player' ? s.root : s.root.parentElement;
    const name = owner === 'html' ? 'data-langform-fullscreen' : owner === 'player' ? 'data-langform-fullscreen-player' : 'data-langform-fullscreen-ancestor';
    node.removeAttribute(name); await Promise.resolve();
    assert.equal(s.ui(),null,'targeted owned-attribute observer restores the obsolete UI');
    assert.equal(s.win.__langformFullscreen.isOpen(),false,owner); assert.equal(s.ui(),null); assert.equal(s.root.parentElement.hasAttribute('inert'),false);
    assert.equal(s.doc.documentElement.hasAttribute('data-langform-fullscreen'),false); assert.equal(s.doc.querySelector('meta[name=viewport]'),null);
  }
});
function snapPage(t) {
  const s=setup(t);
  s.win.ytInitialPlayerResponse={videoDetails:{videoId:'abcdefghijk'}};
  s.doc.documentElement.__langformChapterVideoID='abcdefghijk';
  s.doc.documentElement.__langformChapterList=[{start:0,title:'Einleitung'},{start:30,title:'Das Thema'},{start:75,title:'Fazit'}];
  s.win.eval(fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/FullscreenChapters.js'),'utf8'));
  s.enter();s.range=s.ui().querySelector('input');s.range.getBoundingClientRect=()=>({width:314});
  s.input=value=>{s.range.value=String(value);s.range.dispatchEvent(new s.win.Event('input',{bubbles:true}));};
  s.pointer=()=>s.range.dispatchEvent(new s.win.Event('pointerdown',{bubbles:true}));
  s.snaps=()=>s.messages.filter(value=>value.kind==='chapter-snap');
  return s;
}
for (const boundary of ['pointercancel','lostpointercapture','blur','second-contact']) test(`abandoned fullscreen range cannot seek on a delayed input/change (${boundary})`, t => {
  const s=snapPage(t);
  const fire=(target,type,id=7,primary=true)=>{const event=new s.win.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{pointerId:id,isPrimary:primary,button:0});target.dispatchEvent(event);};
  fire(s.range,'pointerdown');s.input(28);
  if(boundary==='blur')s.win.dispatchEvent(new s.win.Event('blur'));
  else if(boundary==='second-contact')fire(s.ui(),'pointerdown',8,false);
  else fire(s.range,boundary);
  s.input(82);s.range.dispatchEvent(new s.win.Event('change',{bubbles:true}));
  fire(s.win,'pointerup');
  assert.equal(s.video.currentTime,40,'a cancelled browser slider must not commit a late native change');
  fire(s.range,'pointerdown',9);s.input(52);fire(s.win,'pointerup',9);
  assert.equal(s.video.currentTime,52,'the next real range contact immediately recovers');
  s.range.dispatchEvent(new s.win.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  s.input(54);s.range.dispatchEvent(new s.win.Event('change',{bubbles:true}));
  assert.equal(s.video.currentTime,54,'keyboard range adjustment retains its own intent');
});
test('new actual range focus admits accessibility changes after cancel, forged focus cannot revive a stale scrub', t => {
  const s=snapPage(t);s.range.focus();s.pointer();s.input(28);
  s.win.dispatchEvent(new s.win.Event('pointercancel'));
  s.range.dispatchEvent(new s.win.FocusEvent('focus'));
  s.input(82);s.range.dispatchEvent(new s.win.Event('change',{bubbles:true}));
  assert.equal(s.video.currentTime,40,'a synthetic focus event is not a fresh accessibility intent');
  s.button('play').focus();s.range.focus();
  s.input(52);s.range.dispatchEvent(new s.win.Event('change',{bubbles:true}));
  assert.equal(s.video.currentTime,52,'fresh focus permits native nonpointer/AX slider adjustment');
});
for (const boundary of ['release','cancel','foreign-release','second-contact']) test(`touch-only fullscreen range preserves its actual contact (${boundary})`, t => {
  const s=snapPage(t);
  touchEvent(s,s.range,'touchstart',[{identifier:7,clientX:80,clientY:200}]);s.input(52);
  if(boundary==='second-contact')touchEvent(s,s.ui(),'touchstart',[{identifier:7,clientX:80,clientY:200},{identifier:8,clientX:120,clientY:200}]);
  if(boundary==='foreign-release'){
    touchEvent(s,s.range,'touchend',[{identifier:7,clientX:120,clientY:200}],[{identifier:8,clientX:150,clientY:200}]);
    assert.equal(s.video.currentTime,40,'another finger does not release the range');
  }
  touchEvent(s,s.range,boundary==='cancel'?'touchcancel':'touchend',[],[{identifier:7,clientX:150,clientY:200}]);
  const expected=boundary==='cancel'||boundary==='second-contact'?40:52;
  assert.equal(s.video.currentTime,expected,'the matching touch release commits without depending on change');
  if(expected===40){s.input(86);s.range.dispatchEvent(new s.win.Event('change',{bubbles:true}));assert.equal(s.video.currentTime,40,'cancelled touch cannot reappear as a stray change');}
  assert.ok(s.ui(),'timeline gestures never exit fullscreen');assert.deepEqual(s.calls,[]);
});
test('pointer scrubbing detents preview clock and chapter without seeking, and notify once per entry',t=>{
  const s=snapPage(t);s.pointer();s.input(27);
  assert.equal(Number(s.range.value),30);assert.equal(s.video.currentTime,40);
  assert.equal(s.ui().querySelector('[data-clock]').textContent,'0:30 / 2:00');
  assert.match(s.ui().querySelector('.lf-fs-chapter-label').textContent,/Das Thema/);
  assert.equal(s.snaps().length,1);assert.equal(s.snaps()[0].videoID,'abcdefghijk');
  s.input(29);s.input(34.5);assert.equal(Number(s.range.value),30);assert.equal(s.snaps().length,1);
  s.input(35);assert.equal(Number(s.range.value),35,'past twelve pixels remains continuous');
  s.input(73);assert.equal(Number(s.range.value),75);assert.equal(s.snaps().length,2);
  assert.equal(s.ui().querySelector('[data-clock]').textContent,'1:15 / 2:00');
  assert.match(s.ui().querySelector('.lf-fs-chapter-label').textContent,/Fazit/);
  assert.equal(s.video.currentTime,40,'drag previews never invoke a real seek');
  s.range.dispatchEvent(new s.win.Event('change',{bubbles:true}));assert.equal(s.video.currentTime,75);
});
test('keyboard/nonpointer scrubs and pointercancel retain continuous values without snap feedback',t=>{
  const s=snapPage(t);s.input(28);assert.equal(Number(s.range.value),28);assert.equal(s.snaps().length,0);
  s.pointer();s.range.dispatchEvent(new s.win.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  s.input(29);assert.equal(Number(s.range.value),29);assert.equal(s.snaps().length,0);
  s.pointer();s.input(28);assert.equal(s.snaps().length,1);
  s.win.dispatchEvent(new s.win.Event('pointercancel'));assert.equal(s.video.currentTime,40);assert.equal(Number(s.range.value),40);
  s.range.dispatchEvent(new s.win.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  s.input(28);assert.equal(Number(s.range.value),28);assert.equal(s.snaps().length,1);
});
test('chapter snapping never reports feedback for stale ownership, Live, ads or unavailable bridge',t=>{
  for(const condition of ['owner','live','ad','bridge','route']) {
    const s=snapPage(t);s.pointer();
    if(condition==='owner')s.doc.documentElement.__langformChapterVideoID='other';
    if(condition==='live')s.video.duration=Infinity;
    if(condition==='ad')s.root.classList.add('ad-showing');
    if(condition==='bridge')delete s.win.webkit.messageHandlers.langformFullscreen;
    if(condition==='route')s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');
    s.input(28);assert.equal(s.snaps().length,0,condition);assert.equal(s.video.currentTime,40,condition);
    if(s.ui() && condition!=='bridge')assert.equal(Number(s.range.value),28,condition);
  }
});
test('dense chapter detents hand off directly and emit once for each entered marker',t=>{
  const s=snapPage(t);
  s.doc.documentElement.__langformChapterList=[{start:0,title:'Einleitung'},{start:30,title:'A'},{start:31.6,title:'B'}];
  s.video.dispatchEvent(new s.win.Event('timeupdate'));
  s.pointer();s.input(30);assert.equal(Number(s.range.value),30);assert.equal(s.snaps().length,1);
  s.input(31.6);assert.equal(Number(s.range.value),31.6);assert.equal(s.snaps().length,2,'vier Pixel entfernter neuer Marker meldet genau einmal');
  s.input(31.6);s.input(30.8);s.input(30.9);assert.equal(Number(s.range.value),31.6);assert.equal(s.snaps().length,2);
  assert.equal(s.video.currentTime,40,'auch direkte Markerübergabe bleibt Vorschau');
  s.range.dispatchEvent(new s.win.Event('change',{bubbles:true}));assert.equal(s.video.currentTime,31.6);
});

test('fractional chapter detent commits its exact timestamp after range step rounding and pointerup', t => {
  const s = snapPage(t);
  s.doc.documentElement.__langformChapterList = [{start:0,title:'Start'},{start:95.88,title:'Exact chapter'}];
  const descriptor = Object.getOwnPropertyDescriptor(s.win.HTMLInputElement.prototype,'value');
  Object.defineProperty(s.range,'value',{get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,String(Math.round(Number(value)*10)/10));}});
  s.pointer(); s.input(95);
  assert.equal(Number(s.range.value),95.9,'emulate iPhone range step sanitization');
  assert.equal(s.video.currentTime,40,'preview must not seek');
  assert.match(s.ui().querySelector('.lf-fs-chapter-label').textContent,/Exact chapter/);
  s.win.dispatchEvent(new s.win.Event('pointerup'));
  s.video.dispatchEvent(new s.win.Event('timeupdate'));
  s.range.dispatchEvent(new s.win.Event('change',{bubbles:true}));
  assert.equal(s.video.currentTime,95.88,'commit raw chapter timestamp rather than rounded range value');
  s.pointer(); s.input(95); s.win.dispatchEvent(new s.win.Event('pointercancel'));
  s.range.dispatchEvent(new s.win.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
  s.input(90); s.range.dispatchEvent(new s.win.Event('change',{bubbles:true}));
  assert.equal(s.video.currentTime,90,'cancel cannot leak the earlier exact target');
  s.pointer(); s.input(95); s.range.dispatchEvent(new s.win.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
  s.input(94); s.range.dispatchEvent(new s.win.Event('change',{bubbles:true}));
  assert.equal(s.video.currentTime,94,'keyboard clears the pointer target');
});

test('native snapped range release commits once even when WebKit omits change', t => {
  const s=snapPage(t);s.button('play').click();
  s.doc.documentElement.__langformChapterList=[{start:0,title:'Start'},{start:95.88,title:'Exact chapter'}];
  const descriptor=Object.getOwnPropertyDescriptor(s.win.HTMLInputElement.prototype,'value');
  Object.defineProperty(s.range,'value',{get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,String(Math.round(Number(value)*10)/10));}});
  let value=s.video.currentTime,commits=0;
  Object.defineProperty(s.video,'currentTime',{get:()=>value,set:next=>{value=next;commits++;},configurable:true});
  s.pointer();s.input(95);assert.equal(value,40,'a moving thumb is only a preview');
  s.win.dispatchEvent(new s.win.Event('pointerup'));
  assert.equal(value,95.88,'owned release must commit the exact chapter without relying on change');
  assert.equal(commits,1);assert.equal(s.video.paused,true);assert.equal(s.calls.length,1,'seek must not resume a paused video');
  s.range.dispatchEvent(new s.win.Event('change',{bubbles:true}));
  assert.equal(value,95.88);assert.equal(commits,1,'a subsequent native change cannot round or duplicate the seek');
  s.pointer();s.input(45);s.range.dispatchEvent(new s.win.Event('change',{bubbles:true}));
  s.win.dispatchEvent(new s.win.Event('pointerup'));assert.equal(value,45);assert.equal(commits,2,'change-before-release commits only once as well');
});
for(const boundary of ['foreign-pointer','cancel','blur','route','ad','no-input'])test(`range release preserves contact ownership and cancellation (${boundary})`,t=>{
  const s=snapPage(t);
  const fire=(target,type,id=7)=>{const e=new s.win.Event(type,{bubbles:true});Object.assign(e,{pointerId:id,isPrimary:true,button:0});target.dispatchEvent(e);};
  fire(s.range,'pointerdown');if(boundary!=='no-input')s.input(28);
  if(boundary==='foreign-pointer') {fire(s.win,'pointerup',8);assert.equal(s.video.currentTime,40);fire(s.win,'pointerup');assert.equal(s.video.currentTime,30);return;}
  if(boundary==='cancel')fire(s.win,'pointercancel');
  if(boundary==='blur')s.win.dispatchEvent(new s.win.Event('blur'));
  if(boundary==='route')s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');
  if(boundary==='ad')s.root.classList.add('ad-showing');
  fire(s.win,'pointerup');assert.equal(s.video.currentTime,40,'abandoned, stale or unchanged contacts do not seek');
});

for(const boundary of ['same-node-source','hidden','second-contact'])test(`range release abandons a changed media/contact lifecycle (${boundary})`,t=>{
  const s=snapPage(t);
  const fire=(target,type,id=7,primary=true)=>{const e=new s.win.Event(type,{bubbles:true});Object.assign(e,{pointerId:id,isPrimary:primary,button:0});target.dispatchEvent(e);};
  fire(s.range,'pointerdown');s.input(28);assert.equal(s.video.currentTime,40);
  if(boundary==='same-node-source')s.video.setAttribute('src','https://example.test/new-source');
  if(boundary==='hidden'){Object.defineProperty(s.doc,'hidden',{value:true,configurable:true});s.doc.dispatchEvent(new s.win.Event('visibilitychange'));}
  if(boundary==='second-contact')fire(s.ui(),'pointerdown',8,false);
  fire(s.win,'pointerup');assert.equal(s.video.currentTime,40,'the abandoned contact must never seek the media');
});

test('touch chapter selection releases focus for auto-hide while keyboard and paused playback retain visible controls', t => {
  for (const mode of ['touch','keyboard','paused','cancelled']) {
    const s = snapPage(t), label = s.ui().querySelector('.lf-fs-chapter-label');
    const touchClick = node => {
      node.dispatchEvent(new s.win.Event('pointerdown',{bubbles:true})); node.focus();
      node.dispatchEvent(new s.win.Event('pointerup',{bubbles:true}));
      node.dispatchEvent(new s.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
    };
    if (mode === 'paused') s.button('play').click();
    if (mode === 'touch' || mode === 'paused') touchClick(label); else label.click();
    const row = s.ui().querySelector('[data-lf-fs-chapter-start="75"]');
    if (mode === 'cancelled') { row.dispatchEvent(new s.win.Event('pointerdown',{bubbles:true})); s.win.dispatchEvent(new s.win.Event('pointercancel')); }
    if (mode === 'touch' || mode === 'paused') touchClick(row); else row.click();
    assert.equal(s.video.currentTime,75,mode);
    assert.equal(s.ui().querySelector('.lf-fs-chapter-panel').hidden,true,mode);
    assert.equal(s.ui().contains(s.doc.activeElement),mode === 'keyboard' || mode === 'cancelled',mode);
    assert.equal([...s.timers.values()].some(value => value.delay === 3000),mode === 'touch',mode);
    assert.equal(s.paused(),mode === 'paused',mode);
  }
});

test('keyboard focus skips chapter rows during the closing animation', t => {
  const s = snapPage(t), label = s.ui().querySelector('.lf-fs-chapter-label'), panel = s.ui().querySelector('.lf-fs-chapter-panel');
  // JSDOM 26 treats inert as an expando. WebKit reflects this property to the
  // inert attribute, which is also checked by the production focus selector.
  Object.defineProperty(panel,'inert',{get(){return this.hasAttribute('inert');},set(value){this.toggleAttribute('inert',!!value);}});
  panel.animate = () => ({finished:new Promise(()=>{}),cancel(){}});
  label.click(); s.ui().querySelector('[data-lf-fs-chapter-start="75"]').click();
  assert.equal(panel.hidden,false,'closing animation remains visible');
  assert.equal(panel.inert,true,'closing controls already reject input');
  assert.equal(s.doc.activeElement,label);
  s.doc.dispatchEvent(new s.win.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
  assert.equal(s.doc.activeElement,s.ui().querySelector('[data-action=speed]'));
  assert.equal(s.video.currentTime,75);
});

function handshakePage(t) {
  const viewport = {width:390,height:844}, scroll = {x:0,y:240}, frames = new Map(); let frameID = 0;
  const s = setup(t,{nativeSetup(video,root,win) {
    win.__langformFullscreenExitProtocol = 1;
    Object.defineProperties(win,{innerWidth:{get:()=>viewport.width},innerHeight:{get:()=>viewport.height},scrollX:{get:()=>scroll.x},scrollY:{get:()=>scroll.y}});
    win.scrollTo = value => { scroll.x = value.left; scroll.y = value.top; };
    win.requestAnimationFrame = fn => { frames.set(++frameID,fn); return frameID; };
    win.cancelAnimationFrame = id => frames.delete(id);
    const rect=box=>({...box,left:box.x,top:box.y,right:box.x+box.width,bottom:box.y+box.height});
    root.getBoundingClientRect = () => rect({x:0,y:0,width:viewport.width,height:root.hasAttribute('data-langform-fullscreen-player') ? viewport.height : viewport.width * 9/16});
    video.getBoundingClientRect=()=>{
      if(video.hasAttribute('data-langform-fullscreen-exit-video')) {
        const css=win.document.getElementById('langform-fullscreen-exit-style').textContent,value=key=>Number(css.match(new RegExp('(?:[;{])'+key+':([-\\d.]+)px'))[1]);
        return rect({x:value('left'),y:value('top'),width:value('width'),height:value('height')});
      }
      return root.getBoundingClientRect();
    };
  }});
  const frame = () => { const queued = [...frames]; frames.clear(); queued.forEach(([,fn])=>fn()); };
  const resize = (width,height) => { Object.assign(viewport,{width,height}); s.win.dispatchEvent(new s.win.Event('resize')); };
  return {...s,viewport,scroll,frames,frame,resize};
}
test('fullscreen search uses its native exit transaction and retains the video and saved Watch scroll', t => {
  const s = handshakePage(t), media = s.video, parent = media.parentElement, src = media.getAttribute('src');
  s.enter(); s.resize(844,390);
  const search = s.button('search');
  assert.equal(search.getAttribute('aria-label'),'Suchen (Vollbild verlassen)');
  assert.equal(painted(s,search),true);
  search.click(); search.click();
  const requests = s.messages.filter(value=>value.kind==='exit-request');
  assert.equal(requests.length,1); assert.equal(requests[0].action,'search');
  assert.ok(s.ui()); assert.equal(s.messages.some(value=>value.kind==='exit-commit'),false);
  assert.equal(s.win.__langformFullscreen.finishExit('abcdefghijk','stale',390,844),false);
  assert.equal(s.win.__langformFullscreen.finishExit('abcdefghijk',requests[0].token,390,844),true);
  s.scroll.y = 80; s.resize(390,844); for(let i=0;i<4;i++)s.frame();
  assert.equal(s.ui(),null); assert.equal(s.scroll.y,240);
  assert.equal(s.messages.filter(value=>value.kind==='exit-commit').length,1);
  assert.equal(s.root.querySelector('video'),media); assert.equal(media.parentElement,parent);
  assert.equal(media.getAttribute('src'),src); assert.equal(media.currentTime,40); assert.equal(s.paused(),false); assert.deepEqual(s.calls,[]);
});
test('fullscreen search abort produces no geometry commit and late confirmation cannot open search', t => {
  const s = handshakePage(t); s.enter(); s.resize(844,390); s.button('search').click();
  const request = s.messages.find(value=>value.kind==='exit-request');
  s.win.dispatchEvent(new s.win.Event('yt-navigate-start'));
  assert.equal(s.ui(),null); assert.equal(s.messages.at(-1).reason,'navigation');
  assert.equal(s.messages.some(value=>value.kind==='exit-commit'),false);
  assert.equal(s.win.__langformFullscreen.finishExit('abcdefghijk',request.token,390,844),false);
  assert.equal(s.video.currentTime,40); assert.deepEqual(s.calls,[]);
});
test('fullscreen omits search when the native exit protocol is unavailable', t => {
  const s = setup(t); s.enter(); assert.equal(s.ui().querySelector('[data-action=search]'),null);
});
test('fullscreen exit keeps the live picture until native destination and two WebKit layout frames agree', t => {
  const s = handshakePage(t); s.enter();
  assert.ok(s.doc.querySelector('[data-langform-fullscreen-placeholder]'));
  s.resize(844,390); s.button('exit').click();
  const request = s.messages.find(value=>value.kind==='exit-request'); assert.ok(request);
  assert.equal(s.win.__langformFullscreen.isOpen(),true);
  assert.equal(s.ui().hasAttribute('data-exiting'),true);
  assert.equal(s.win.__langformFullscreen.finishExit('abcdefghijk','stale',390,844),false);
  assert.equal(s.win.__langformFullscreen.finishExit('abcdefghijk',request.token,390,844),true);
  assert.equal(s.frames.size,0,'native portrait bounds cannot restore inline CSS inside a landscape WebKit viewport');
  s.resize(390,844); s.frame();
  assert.ok(s.video.hasAttribute('data-langform-fullscreen-exit-video'),'one candidate frame cannot release the live pin');
  s.resize(390,830); s.frame();
  assert.ok(s.video.hasAttribute('data-langform-fullscreen-exit-video'),'a changing viewport cancels its stale commit');
  s.scroll.y=80; s.resize(390,844); s.frame(); s.frame(); s.frame(); s.frame();
  assert.equal(s.ui(),null);
  assert.equal(s.win.__langformFullscreen.isOpen(),false);
  assert.equal(s.doc.querySelector('[data-langform-fullscreen-placeholder]'),null);
  assert.equal(s.scroll.y,240,'the watch document returns to its saved scroll position');
  assert.deepEqual({...s.messages.at(-1)},{kind:'exit-commit',open:false,href:'https://m.youtube.com/watch?v=abcdefghijk',videoID:'abcdefghijk',token:request.token});
  assert.equal(s.video.currentTime,40); assert.equal(s.paused(),false); assert.deepEqual(s.calls,[]);
});
test('navigation cancels an unfinished exit and late viewport confirmations cannot recreate ownership', t => {
  const s=handshakePage(t); s.enter(); s.resize(844,390); s.button('exit').click();
  const request=s.messages.find(value=>value.kind==='exit-request');
  s.win.__langformFullscreen.finishExit('abcdefghijk',request.token,844,390);
  assert.equal(s.frames.size,1);
  s.win.dispatchEvent(new s.win.Event('yt-navigate-start'));
  assert.equal(s.ui(),null); assert.equal(s.frames.size,0);
  assert.equal(s.root.hasAttribute('data-langform-fullscreen-player'),false);
  assert.equal(s.root.parentElement.hasAttribute('inert'),false);
  assert.equal(s.messages.at(-1).reason,'navigation');
  assert.equal(s.messages.at(-1).kind,undefined,'an aborted transition is not a confirmed geometry commit');
  assert.equal(s.win.__langformFullscreen.finishExit('abcdefghijk',request.token,390,844),false);
  s.frame(); assert.equal(s.ui(),null); assert.equal(s.video.currentTime,40);
});

function exitHandoffPage(t,options={}) {
  const frames=new Map(),animations=[],timers=new Map(),viewport={width:options.contained?402:390,height:844},natural=options.contained?{x:0,y:110,width:402,height:226}:{x:7,y:100,width:390,height:390*9/16},videoNatural=options.contained?{x:50,y:110,width:301,height:226}:{},fullscreenRoot={},fullscreenVideo={};
  let frameID=0,elapsed=0,active=null,mediaTime=40,timeWrites=0;
  const s=setup(t,{paused:options.paused,nativeSetup(video,root,win) {
    win.__langformFullscreenExitProtocol=1;win.__langformFullscreenDiagnostics=!!options.diagnostics;
    win.__langformStageInsets={top:0,right:0,bottom:0,left:0};
    if(options.preview){root.requestFullscreen=()=>Promise.resolve();Object.defineProperty(win.navigator,'userActivation',{value:{isActive:true}});}
    if(options.entry)win.__langformFullscreenEnterProtocol=1;
    if(options.probe) {
      win.__langformFullscreenProbeEnabled=true;
      win.setTimeout=(fn,delay)=>{timers.set(++frameID,{fn,delay});return frameID;};win.clearTimeout=id=>timers.delete(id);
    }
    Object.defineProperties(win,{innerWidth:{get:()=>viewport.width},innerHeight:{get:()=>viewport.height}});
    Object.defineProperty(win.document,'hidden',{value:false,writable:true,configurable:true});
    Object.defineProperties(video,{videoWidth:{value:options.contained?640:options.unknownMetadata ? 0 : options.portrait ? 1080 : 1920,configurable:true},videoHeight:{value:options.contained?480:options.unknownMetadata ? 0 : options.portrait ? 1920 : 1080,configurable:true},currentTime:{get:()=>mediaTime,set:value=>{mediaTime=value;timeWrites++;}}});
    if(options.live)video.duration=Infinity;
    video.style.setProperty('transform',options.placement||options.contained?'none':'translateX(7px)','important');
    if(options.placement){video.style.position='absolute';video.style.top='0px';video.style.left='0px';}
    if(options.contained){video.style.position='absolute';video.style.top='0px';video.style.left='50px';video.style.width='301px';video.style.height='226px';}
    if(options.ancestorStyles) {
      root.parentElement.style.cssText+=';will-change:transform;perspective:700px;filter:grayscale(.3);backdrop-filter:blur(2px);contain:layout;content-visibility:auto';
      root.style.cssText+=';will-change:transform;perspective:500px;filter:contrast(.8)';
      video.parentElement.style.cssText+=';will-change:transform;filter:brightness(.9)';
    }
    win.performance.now=()=>elapsed;
    win.Date.now=()=>1700000000000+elapsed;
    win.requestAnimationFrame=fn=>{frames.set(++frameID,fn);return frameID;};win.cancelAnimationFrame=id=>frames.delete(id);
    const preference=new win.EventTarget();preference.matches=!!options.reduced;win.matchMedia=()=>preference;
    win.__testPreference=preference;
    const originalStyle=win.getComputedStyle.bind(win);
    const pinStyle=()=>win.document.getElementById(video.hasAttribute('data-langform-fullscreen-enter-video') ? 'langform-fullscreen-enter-style' : 'langform-fullscreen-exit-style')?.textContent;
    const interpolated=(field,fallback)=>{
      if(!active||active.cancelled)return fallback;
      const frames=active.keyframes,index=Math.min(frames.length-2,Math.floor(active.fraction*(frames.length-1))),a=frames[index],b=frames[index+1],fraction=active.fraction*(frames.length-1)-index;
      if(field==='transform') {
        const parse=value=>value==='none' ? [0,0,1,1] : value.match(/translate\(([-\d.]+)px,([-\d.]+)px\) scale\(([-\d.]+)(?:,([-\d.]+))?\)/).slice(1).map(Number);
        const from=parse(a.transform),to=parse(b.transform);from[3]||=from[2];to[3]||=to[2];return from.map((n,i)=>n+(to[i]-n)*fraction);
      }
      const parse=value=>{const vals=value.match(/inset\(([^)]+)\)/)[1].trim().split(/\s+/);if(vals.length===1)while(vals.length<4)vals.push(vals[0]);return vals.map(Number.parseFloat);};
      const from=parse(a.clipPath),to=parse(b.clipPath),percent=b.clipPath.includes('%');return 'inset('+from.map((n,i)=>(n+(to[i]-n)*fraction)+(percent?'%':'px')).join(' ')+')';
    };
    win.getComputedStyle=node=>node===video ? {position:options.placement||options.contained?'absolute':undefined,top:options.placement||options.contained?video.style.top:undefined,left:options.placement||options.contained?video.style.left:undefined,transform:options.placement||options.contained?'none':undefined,objectFit:video.hasAttribute('data-langform-fullscreen-exit-video') || video.hasAttribute('data-langform-fullscreen-enter-video') ? 'fill' : root.hasAttribute('data-langform-fullscreen-player') ? 'contain' : options.inlineFit || 'contain',objectPosition:'50% 50%',clipPath:interpolated('clip',pinStyle()?.match(/clip-path:([^;]+);/)?.[1] || 'inset(0)')} : originalStyle(node);
    const rect=box=>({...box,left:box.x,top:box.y,right:box.x+box.width,bottom:box.y+box.height});
    const previewBox=box=>{if(!options.preview||root.hasAttribute('data-langform-fullscreen-exit-layout'))return box;const match=root.style.transform.match(/^scale\(([\d.]+)(?:,\s*([\d.]+))?\)$/),sx=Number(match?.[1]||1),sy=Number(match?.[2]||sx),bottom=root.style.transformOrigin!=='top center'?natural.height:0;return {x:natural.x+natural.width/2+(box.x-natural.x-natural.width/2)*sx,y:natural.y+bottom+(box.y-natural.y-bottom)*sy,width:box.width*sx,height:box.height*sy};};
    root.getBoundingClientRect=()=>rect(root.hasAttribute('data-langform-fullscreen-player') ? {x:0,y:0,...viewport,...fullscreenRoot} : previewBox(natural));
    video.getBoundingClientRect=()=>{
      if(video.hasAttribute('data-langform-fullscreen-exit-video') || video.hasAttribute('data-langform-fullscreen-enter-video')) {
        const css=pinStyle();
        const value=key=>Number(css.match(new RegExp('(?:[;{])'+key+':([-\\d.]+)px'))[1]);
        const box={x:value('left'),y:value('top'),width:value('width'),height:value('height')};
        if(active&&!active.cancelled) {
          const transform=interpolated('transform');
          box.x+=transform[0];box.y+=transform[1];box.width*=transform[2];box.height*=transform[3];
        }
        return rect(box);
      }
      if(root.hasAttribute('data-langform-fullscreen-player')){
        const box={x:0,y:0,...viewport,...fullscreenVideo};
        if(options.contained){
          for(const key of ['width','height'])if(video.style.getPropertyPriority(key)==='important'&&video.style.getPropertyValue(key)!=='100%')box[key]=parseFloat(video.style.getPropertyValue(key));
          for(const [key,axis] of [['top','y'],['left','x']])if(video.style.getPropertyPriority(key)==='important')box[axis]=parseFloat(video.style.getPropertyValue(key));
        }
        return rect(box);
      }
      assert.equal(video.style.getPropertyValue('transform'),options.placement||options.contained?'none':'translateX(7px)','destination reads the actual inline author transform');
      const box={...natural,...videoNatural};
      if(options.placement){
        if(video.style.width==='100%'&&video.style.getPropertyPriority('width')==='important')box.width=natural.width;
        if(video.style.height==='100%'&&video.style.getPropertyPriority('height')==='important')box.height=natural.height;
        if(video.style.top==='0px'&&video.style.getPropertyPriority('top')==='important')box.y=natural.y;
        if(video.style.left==='0px'&&video.style.getPropertyPriority('left')==='important')box.x=natural.x;
      }
      if(options.contained){
        if(video.style.getPropertyPriority('width')==='important')box.width=parseFloat(video.style.width);
        if(video.style.getPropertyPriority('height')==='important')box.height=parseFloat(video.style.height);
        if(video.style.getPropertyPriority('top')==='important')box.y=natural.y+parseFloat(video.style.top);
        if(video.style.getPropertyPriority('left')==='important')box.x=natural.x+parseFloat(video.style.left);
      }
      return rect(previewBox(box));
    };
    video.animate=(keyframes,timing)=>{
      if(options.animationThrows)throw Error('No compositor');
      const animation={keyframes,timing,fraction:0,cancelled:false,onfinish:null,cancel(){this.cancelled=true;if(active===this)active=null;}};
      animations.push(animation);active=animation;return animation;
    };
  }});
  const frame=(count=1)=>{while(count--){elapsed+=1000/60;const queued=[...frames.values()];frames.clear();queued.forEach(fn=>fn(elapsed));}};
  const resize=(width,height)=>{Object.assign(viewport,{width,height});s.win.dispatchEvent(new s.win.Event('resize'));};
  if(!options.probe)s.enter();if(!options.entry){
    // Existing handoff tests exercise the uncached continuation path: a changed
    // Stage inset makes the saved pre-fullscreen destination ineligible.
    if(!options.cached)s.win.__langformStageInsets.top=1;
    resize(844,390);s.win.__langformFullscreen.exit('abcdefghijk');
  }
  const request=s.messages.find(row=>row.kind===(options.entry ? 'enter-request' : 'exit-request'));
  const prepare=()=>{const width=options.entry ? 844 : options.contained?402:390,height=options.entry ? 390 : 844;assert.equal(s.win.__langformFullscreen[options.entry ? 'prepareEnter' : 'prepareExit']('abcdefghijk',request.token,width,height),true);resize(width,height);frame(2);};
  const confirm=()=>s.win.__langformFullscreen[options.entry ? 'finishEnter' : 'finishExit']('abcdefghijk',request.token,viewport.width,viewport.height);
  const finish=()=>{const animation=animations.at(-1);animation.fraction=1;animation.onfinish();frame(2);};
  return {...s,frames,animations,timers,frame,resize,prepare,confirm,finish,natural,videoNatural,fullscreenRoot,fullscreenVideo,viewport,request,timeWrites:()=>timeWrites};
}

function stagedExit(s,ticket=12,duration=300) {
  return s.win.__langformFullscreen.prepareExitMotion('abcdefghijk',s.request.token,390,844,s.win.Date.now()+duration,ticket);
}
for(const curve of ['cubic-bezier(.42,0,.58,1)','cubic-bezier(.42,0,1,1)','cubic-bezier(0,0,.58,1)','linear'])test('physical exit accepts only the system timing role '+curve,t=>{
  const s=exitHandoffPage(t,{cached:true}),node=s.video,parent=node.parentElement;
  assert.equal(s.win.__langformFullscreen.prepareExitMotion('abcdefghijk',s.request.token,390,844,s.win.Date.now()+300,12,curve),true);
  assert.equal(s.animations[0].timing.easing,curve);
  s.finish();assert.equal(s.messages.filter(row=>row.kind==='exit-motion-ready').length,1);
  s.prepare();s.confirm();s.frame(8);
  assert.equal(s.ui(),null);assert.equal(s.video,node);assert.equal(node.parentElement,parent);
  assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
for(const curve of ['ease',null,{},'cubic-bezier(.42,0,.58,1);opacity:0'])test('unrecognized exit curve cannot acquire or mutate a video pose '+String(curve),t=>{
  const s=exitHandoffPage(t,{cached:true}),before=s.video.getBoundingClientRect();
  assert.equal(s.win.__langformFullscreen.prepareExitMotion('abcdefghijk',s.request.token,390,844,s.win.Date.now()+300,12,curve),false);
  assert.equal(s.animations.length,0);assert.deepEqual(s.video.getBoundingClientRect(),before);
  assert.equal(s.messages.some(row=>row.kind==='exit-motion-ready'),false);assert.deepEqual(s.calls,[]);
});
function previewContactPage(t){
  const s=exitHandoffPage(t,{entry:true,probe:true,preview:true,cached:true,placement:true,diagnostics:true});
  Object.assign(s.natural,{x:0,y:107});s.root.parentElement.style.transform='none';
  const fire=(type,target=s.video,points=[{identifier:1,clientX:195,clientY:180}])=>{const e=new s.win.Event(type,{bubbles:true,cancelable:true});Object.defineProperties(e,{touches:{value:/end|cancel/.test(type)?[]:points},changedTouches:{value:points}});target.dispatchEvent(e);return e;};
  const preview=(scale=1.25)=>{s.root.style.transform=`scale(${scale})`;s.root.style.transformOrigin='bottom center';};
  const enterAtTerminal=(type='touchend',target=s.video)=>{let started;s.root.addEventListener(type,()=>{s.root.requestFullscreen();started=s.video.getBoundingClientRect();s.root.style.transform='scale(1)';s.root.style.transition='0.2s ease';},{once:true});fire(type,target,[{identifier:1,clientX:195,clientY:60}]);return started;};
  const exit=()=>{const req=s.messages.find(r=>r.kind==='enter-request');assert.ok(req,'existing fullscreen API performs entry');s.resize(844,390);s.win.__langformFullscreen.prepareEnter('abcdefghijk',req.token,844,390);s.frame(2);s.win.__langformFullscreen.finishEnter('abcdefghijk',req.token,844,390);if(s.animations.at(-1)?.onfinish)s.finish();s.frame(2);assert.equal(s.ui().hasAttribute('data-entering'),false);s.win.__langformFullscreen.exit('abcdefghijk');const out=s.messages.find(r=>r.kind==='exit-request');return s.win.__langformFullscreen.prepareExitMotion('abcdefghijk',out.token,390,844,s.win.Date.now()+300,12);};
  return {...s,fire,preview,enterAtTerminal,exit};
}
for(const terminal of ['touchend','touchcancel'])test('original swipe '+terminal+' keeps its visible preview entry but stages back to the pre-contact inline picture',t=>{
  const s=previewContactPage(t);s.fire('touchstart');s.preview();const current=s.video.getBoundingClientRect(),entry=s.enterAtTerminal(terminal);
  assert.deepEqual([entry.x,entry.y,entry.width,entry.height],[current.x,current.y,current.width,current.height],'entry must start at the visible 1.25 preview');
  assert.equal(s.exit(),true,'known original preview must not poison the stable exit destination');
  s.finish();const final=s.video.getBoundingClientRect();assert.deepEqual([final.x,final.y,final.width,final.height],[0,107,390,219.375]);
  assert.equal(s.video.currentTime,40);assert.deepEqual(s.calls,[]);
});
test('paired Pointer cancellation cannot discard the still-active original Touch preview destination',async t=>{
  const s=previewContactPage(t),down=new s.win.Event('pointerdown',{bubbles:true});Object.assign(down,{pointerType:'touch',pointerId:4,isPrimary:true,clientX:195,clientY:180});s.video.dispatchEvent(down);
  s.win.__langformFullscreen.observeContact(down); // Earlier gesture observers can forward the same physical event.
  s.fire('touchstart');s.preview();const cancel=new s.win.Event('pointercancel',{bubbles:true});Object.assign(cancel,{pointerType:'touch',pointerId:4,isPrimary:true,clientX:195,clientY:60});s.video.dispatchEvent(cancel);
  await Promise.resolve();s.enterAtTerminal('touchcancel');assert.equal(s.exit(),true);s.finish();assert.equal(s.video.getBoundingClientRect().width,390);
});
for(const kind of ['late-terminal','second-finger','control','scrubber-band','blur','hidden','route','resize','scroll','insets','source','root-layout','video-layout','wrong-origin','nonuniform','too-large','preexisting-scale','horizontal','downward','overlay','mini'])test('pre-contact destination rejects '+kind+' without granting a new fullscreen request',async t=>{
  const s=previewContactPage(t),button=s.doc.createElement('button');s.root.appendChild(button);
  if(kind==='preexisting-scale')s.preview(1.05);
  if(kind==='control')s.fire('touchstart',button);
  else s.fire('touchstart',s.video,[{identifier:1,clientX:195,clientY:kind==='scrubber-band'?310:180}]);
  if(kind==='second-finger')s.fire('touchstart',s.video,[{identifier:1,clientX:195,clientY:180},{identifier:2,clientX:200,clientY:180}]);
  if(kind==='blur')s.win.dispatchEvent(new s.win.Event('blur'));
  if(kind==='hidden'){s.doc.hidden=true;s.doc.dispatchEvent(new s.win.Event('visibilitychange'));s.doc.hidden=false;}
  if(kind==='route')s.win.dispatchEvent(new s.win.Event('yt-navigate-start'));
  if(kind==='resize'||kind==='scroll')s.win.dispatchEvent(new s.win.Event(kind));
  if(kind==='insets')s.win.__langformStageInsets.top=1;
  if(kind==='source')s.video.src='https://example.test/new-source';
  if(kind==='root-layout')s.natural.y+=12;
  if(kind==='video-layout')s.videoNatural.width=370;
  s.preview(kind==='too-large'?1.3:1.25);
  if(kind==='wrong-origin')s.root.style.transformOrigin='top center';
  if(kind==='nonuniform')s.root.style.transform='scale(1.25, 1.2)';
  if(kind==='overlay')s.win.__langformHasOpenOverlay=()=>true;
  if(kind==='mini')s.win.__langformStageInsets.nativeMini=true;
  if(kind==='late-terminal'||kind==='horizontal'||kind==='downward'){
    s.fire('touchend',s.video,[{identifier:1,clientX:kind==='horizontal'?320:195,clientY:kind==='downward'?300:kind==='horizontal'?180:60}]);
    if(kind==='late-terminal')await Promise.resolve();
    assert.equal(s.ui(),null,'saved geometry never opens anything');s.root.requestFullscreen();s.root.style.transform='scale(1)';
  }else s.enterAtTerminal();
  if(kind==='mini'){assert.equal(s.ui(),null,'existing native Mini request guard owns this action');return;}
  const accepted=s.exit();
  assert.equal(accepted,false,'an invalid contact must leave the existing exit cache rejection intact');
  assert.deepEqual(s.calls,[]);
});
function visibleVideo(s) {
  const box=s.video.getBoundingClientRect(),values=s.win.getComputedStyle(s.video).clipPath.match(/inset\(([^)]+)\)/)[1].split(/\s+/).map(Number.parseFloat);
  if(values.length===1)while(values.length<4)values.push(values[0]);
  return {x:box.x+box.width*values[3]/100,y:box.y+box.height*values[0]/100,width:box.width*(1-(values[1]+values[3])/100),height:box.height*(1-(values[0]+values[2])/100)};
}
for(const motion of ['fallback','staged'])test('confirmed centered 4:3 inline pose recovers the real oversized landscape author box after '+motion+' exit',t=>{
  const s=exitHandoffPage(t,{contained:true,cached:true}),node=s.video,source=node.getAttribute('src');
  if(motion==='staged'){assert.equal(s.win.__langformFullscreen.prepareExitMotion('abcdefghijk',s.request.token,402,844,s.win.Date.now()+300,12),true);s.finish();}
  Object.assign(s.videoNatural,{x:109,y:110,width:656,height:492});node.style.width='656px';node.style.height='492px';node.style.left='109px';
  s.prepare();s.confirm();s.frame(30);
  assert.equal(s.ui(),null);assert.equal(s.messages.filter(row=>row.kind==='exit-commit').length,1,'source-bound original pose produces a real geometry commit');
  const rect=node.getBoundingClientRect();assert.deepEqual([rect.x,rect.y,rect.width,rect.height],[50,110,301,226]);
  assert.equal(node.getAttribute('src'),source);assert.equal(node,s.root.querySelector('video'));assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
test('a claimed centered 4:3 lease suspends inline size and offset through repeated fullscreen entry and resumes only on exit',async t=>{
  const s=exitHandoffPage(t,{contained:true,cached:true});Object.assign(s.videoNatural,{x:109,y:110,width:656,height:492});
  s.video.style.width='656px';s.video.style.height='492px';s.video.style.left='109px';s.prepare();s.confirm();s.frame(30);assert.equal(s.ui(),null);
  s.win.__langformFullscreenEnterProtocol=1;
  for(let cycle=0;cycle<3;cycle++){
    s.enter();const request=s.messages.findLast(row=>row.kind==='enter-request');assert.ok(request);
    s.resize(874,402);assert.equal(s.win.__langformFullscreen.finishEnter('abcdefghijk',request.token,874,402),true);s.frame(4);
    const animation=s.animations.at(-1);if(animation&&!animation.cancelled){animation.fraction=1;animation.onfinish();}s.frame(8);
    await Promise.resolve();await Promise.resolve();
    assert.equal(s.ui().inert,false,'real fullscreen entry must release its interaction latch');
    assert.equal(s.messages.filter(row=>row.kind==='enter-commit').length,cycle+1);
    const full=s.video.getBoundingClientRect();assert.deepEqual([full.x,full.y,full.width,full.height],[0,0,874,402]);
    s.button('exit').click();const exit=s.messages.findLast(row=>row.kind==='exit-request');s.resize(402,844);
    assert.equal(s.win.__langformFullscreen.finishExit('abcdefghijk',exit.token,402,844),true);s.frame(30);
    assert.equal(s.ui(),null);const inline=s.video.getBoundingClientRect();assert.deepEqual([inline.x,inline.y,inline.width,inline.height],[50,110,301,226]);
  }
  assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
test('staged exit animates the same live video before WK shrink and ACKs only its measured final pin',t=>{
  const s=exitHandoffPage(t,{cached:true}),node=s.video,parent=node.parentElement,source=node.getBoundingClientRect();
  assert.equal(stagedExit(s),true);assert.equal(s.animations.length,1);assert.equal(s.animations[0].keyframes.length,33);
  s.win.__langformFullscreen.prepareExit('abcdefghijk',s.request.token,390,844);s.win.__langformFullscreen.finishExit('abcdefghijk',s.request.token,390,844);s.frame(10);
  assert.equal(s.animations[0].cancelled,false);assert.equal(s.messages.some(row=>row.kind==='exit-motion-ready'),false);assert.ok(s.root.hasAttribute('data-langform-fullscreen-player'));
  for(let i=0;i<=100;i++){s.animations[0].fraction=i/100;const box=node.getBoundingClientRect(),visible=visibleVideo(s);assert.ok(Math.abs(box.width/box.height-source.width/source.height)<.00001);assert.ok(visible.x>=-.01&&visible.y>=-.01&&visible.x+visible.width<=844.01&&visible.y+visible.height<=390.01);}
  s.finish();const ready=s.messages.filter(row=>row.kind==='exit-motion-ready');assert.equal(ready.length,1);assert.equal(ready[0].requestTicket,12);assert.equal(s.viewport.width,844);assert.ok(s.root.hasAttribute('data-langform-fullscreen-player'));const held=node.getBoundingClientRect();
  s.resize(390,844);s.frame(6);assert.equal(s.ui(),null);assert.deepEqual(node.getBoundingClientRect(),held);assert.equal(s.animations.length,1,'no second returning tween');
  assert.equal(node.parentElement,parent);assert.equal(s.video,node);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
test('staged exit accepts saved portrait inset metadata while fullscreen source insets differ',t=>{
  const s=exitHandoffPage(t,{cached:true});s.win.__langformStageInsets.top=62;assert.equal(stagedExit(s),true);s.finish();assert.equal(s.messages.filter(row=>row.kind==='exit-motion-ready').length,1);
});
for(const options of [{portrait:true,inlineFit:'cover'},{portrait:true,inlineFit:'contain'}])test(`staged uniform visible clipping fits source viewport (${options.inlineFit})`,t=>{
  const s=exitHandoffPage(t,{cached:true,...options});assert.equal(stagedExit(s),true);
  for(let i=0;i<=200;i++){s.animations[0].fraction=i/200;const box=s.video.getBoundingClientRect(),visible=visibleVideo(s);assert.ok(Math.abs(box.width/box.height-9/16)<.00001);assert.ok(visible.x>=-.01&&visible.y>=-.01&&visible.x+visible.width<=844.01&&visible.y+visible.height<=390.01);}
  s.finish();assert.equal(s.messages.filter(row=>row.kind==='exit-motion-ready').length,1);s.prepare();s.confirm();s.frame(6);assert.equal(s.ui(),null);assert.equal(s.animations.length,1);
});
test('portrait fill refuses a staged nonuniform aspect change without guessing an ACK',t=>{
  const s=exitHandoffPage(t,{cached:true,portrait:true,inlineFit:'fill'});assert.equal(stagedExit(s),false);assert.equal(s.animations.length,0);assert.equal(s.messages.some(row=>row.kind==='exit-motion-ready'),false);
});
for(const mutate of [s=>s.resize(900,390),s=>Object.defineProperty(s.video,'videoWidth',{value:0}),s=>s.video.style.setProperty('transform','rotate(5deg)','important')])test('staged exit rejects a changed source, unknown media ratio or changed transform authority',t=>{
  const s=exitHandoffPage(t,{cached:true});mutate(s);
  // A larger source is harmless; the target cache itself remains authoritative.
  if(s.viewport.width===900){assert.equal(stagedExit(s),true);s.resize(844,390);s.frame();assert.equal(s.messages.some(row=>row.kind==='exit-motion-ready'),false);}
  else {assert.equal(stagedExit(s),false);assert.equal(s.animations.length,0);}
});
for(const ticket of [NaN,-1,1.5,Number.MAX_SAFE_INTEGER+1])test(`staged exit rejects invalid native load ticket (${ticket})`,t=>{const s=exitHandoffPage(t,{cached:true});assert.equal(stagedExit(s,ticket),false);assert.equal(s.animations.length,0);});
for(const duration of [-1,2100])test(`staged exit rejects an unavailable rotation deadline (${duration})`,t=>{const s=exitHandoffPage(t,{cached:true});assert.equal(stagedExit(s,12,duration),false);assert.equal(s.animations.length,0);});
test('staged exit duplicate scheduling retains one motion and a new deadline resumes the actual picture',t=>{
  const s=exitHandoffPage(t,{cached:true});assert.equal(stagedExit(s),true);assert.equal(stagedExit(s),true);assert.equal(s.animations.length,1);
  const old=s.animations[0];old.fraction=.4;const before=s.video.getBoundingClientRect();assert.equal(stagedExit(s,12,400),true);assert.deepEqual(s.video.getBoundingClientRect(),before);assert.equal(old.cancelled,true);old.onfinish();assert.equal(s.messages.some(row=>row.kind==='exit-motion-ready'),false);s.finish();assert.equal(s.messages.filter(row=>row.kind==='exit-motion-ready').length,1);
});
test('native staged cancellation freezes actual pose and invalidates the old completion',t=>{
  const s=exitHandoffPage(t,{cached:true});stagedExit(s);const old=s.animations[0];old.fraction=.4;const before=s.video.getBoundingClientRect();
  assert.equal(s.win.__langformFullscreen.cancelExitMotion('abcdefghijk','stale'),false);assert.equal(s.win.__langformFullscreen.cancelExitMotion('abcdefghijk',s.request.token),true);assert.deepEqual(s.video.getBoundingClientRect(),before);old.onfinish();assert.equal(s.messages.some(row=>row.kind==='exit-motion-ready'),false);
});
for(const reason of ['navigation','ad','inactive','pagehide'])test(`staged exit lifecycle cancellation cannot ACK stale media (${reason})`,async t=>{
  const s=exitHandoffPage(t,{cached:true});stagedExit(s);const old=s.animations[0];old.fraction=.4;
  if(reason==='navigation')s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');if(reason==='ad')s.root.classList.add('ad-showing');if(reason==='inactive'){s.doc.hidden=true;s.doc.dispatchEvent(new s.win.Event('visibilitychange'));}if(reason==='pagehide')s.win.dispatchEvent(new s.win.Event('pagehide'));
  await Promise.resolve();s.frame(2);old.onfinish();assert.equal(s.messages.some(row=>row.kind==='exit-motion-ready'),false);assert.equal(s.ui(),null);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
for(const initial of [true,false])test(`reduced motion pins before staged ACK (${initial?'initial':'during animation'})`,t=>{
  const s=exitHandoffPage(t,{cached:true,reduced:initial});assert.equal(stagedExit(s),true);if(!initial){s.animations[0].fraction=.3;s.win.__testPreference.matches=true;s.win.__testPreference.dispatchEvent(new s.win.Event('change'));}
  assert.equal(s.messages.filter(row=>row.kind==='exit-motion-ready').length,1);assert.ok(Math.abs(s.video.getBoundingClientRect().y-s.natural.y)<.01);assert.ok(s.root.hasAttribute('data-langform-fullscreen-player'));
});
test('staged final release waits for delayed natural hydration without starting a second motion',t=>{
  const s=exitHandoffPage(t,{cached:true});stagedExit(s);s.finish();Object.assign(s.videoNatural,{width:844,height:844*9/16});s.resize(390,844);s.confirm();s.frame(25);
  assert.ok(s.ui());assert.equal(s.animations.length,1);assert.ok(Math.abs(s.video.getBoundingClientRect().width-390)<.01);
  Object.keys(s.videoNatural).forEach(key=>delete s.videoNatural[key]);s.frame(6);assert.equal(s.ui(),null);assert.equal(s.animations.length,1);
});
test('six staged fullscreen round trips retain the same live node and reject previous-cycle completion',t=>{
  const s=exitHandoffPage(t,{cached:true}),node=s.video,parent=node.parentElement;let previous;
  for(let cycle=0;cycle<6;cycle++){
    if(cycle){s.enter();s.resize(844,390);s.win.__langformFullscreen.exit('abcdefghijk');s.request=s.messages.findLast(row=>row.kind==='exit-request');}
    if(previous){assert.equal(s.win.__langformFullscreen.cancelExitMotion('abcdefghijk',previous.token),false);previous.animation.onfinish();assert.ok(s.ui());}
    const readyCount=s.messages.filter(row=>row.kind==='exit-motion-ready').length;assert.equal(stagedExit(s,20+cycle),true);const animation=s.animations.at(-1);s.finish();assert.equal(s.messages.filter(row=>row.kind==='exit-motion-ready').length,readyCount+1);
    const held=s.video.getBoundingClientRect();s.resize(390,844);assert.equal(s.win.__langformFullscreen.finishExit('abcdefghijk',s.request.token,390,844),true);s.frame(6);assert.equal(s.ui(),null);assert.deepEqual(s.video.getBoundingClientRect(),held);assert.equal(s.video,node);assert.equal(node.parentElement,parent);previous={token:s.request.token,animation};
  }
  assert.equal(s.animations.length,6);assert.equal(s.messages.filter(row=>row.kind==='exit-commit').length,6);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
test('staged exit aborts a changed confirmed natural layout without a second tween or false commit',t=>{
  const s=exitHandoffPage(t,{cached:true,diagnostics:true});stagedExit(s);s.finish();s.natural.y+=28;s.resize(390,844);s.confirm();s.frame(6);
  assert.equal(s.ui(),null);assert.equal(s.messages.some(row=>row.kind==='exit-commit'),false);assert.equal(s.messages.filter(row=>row.reason==='exit-layout-changed').length,1);assert.equal(s.animations.length,1);assert.equal(s.video.hasAttribute('data-langform-fullscreen-exit-video'),false);
});
test('staged exit bounds never-ready natural layout only after real native finish and matching viewport',t=>{
  const s=exitHandoffPage(t,{cached:true});stagedExit(s);s.finish();Object.assign(s.videoNatural,{width:844,height:844*9/16});s.win.__langformFullscreen.finishExit('abcdefghijk',s.request.token,390,844);s.frame(180);
  assert.ok(s.ui(),'old source viewport alone cannot start natural-layout abort');s.resize(390,844);s.frame(100);assert.ok(s.ui());s.frame(20);
  assert.equal(s.ui(),null);assert.equal(s.messages.filter(row=>row.reason==='exit-layout-timeout').length,1);assert.equal(s.messages.some(row=>row.kind==='exit-commit'),false);assert.equal(s.animations.length,1);
});
for(const cached of [false,true])test(`fallback exit releases hidden watch context when natural media never recovers (${cached?'cached':'uncached'})`,async t=>{
  const s=exitHandoffPage(t,{cached}),context=s.doc.createElement('section'),parent=s.video.parentElement,source=s.video.getAttribute('src');
  context.innerHTML='<button>Kommentare</button>';s.doc.body.appendChild(context);await Promise.resolve();
  Object.assign(s.videoNatural,{width:844,height:475,y:301});
  s.prepare();s.frame(180);
  assert.ok(s.ui(),'prepare alone does not authorize abandoning the rotation');
  assert.ok(context.hasAttribute('data-langform-fullscreen-exit-context'));
  s.confirm();s.frame(100);assert.ok(s.ui(),'brief hydration delay keeps the live picture held');s.frame(20);
  assert.equal(s.ui(),null,'a failed fallback must not hide the watch page indefinitely');
  assert.equal(context.hasAttribute('data-langform-fullscreen-exit-context'),false);
  assert.notEqual(s.win.getComputedStyle(context).opacity,'0');
  assert.equal(s.doc.body.hasAttribute('inert'),false);assert.equal(s.root.parentElement.hasAttribute('inert'),false);
  assert.equal(s.video.hasAttribute('data-langform-fullscreen-exit-video'),false);
  assert.equal(s.doc.documentElement.hasAttribute('data-langform-fullscreen'),false);
  assert.equal(s.doc.getElementById('langform-fullscreen-exit-style'),null);
  assert.equal(s.frames.size,0);assert.equal(s.messages.filter(row=>row.reason==='exit-layout-timeout').length,1);
  assert.equal(s.messages.some(row=>row.kind==='exit-commit'),false,'abort is not a successful layout commit');
  assert.equal(s.video.parentElement,parent);assert.equal(s.video.getAttribute('src'),source);assert.equal(s.video.currentTime,40);assert.equal(s.paused(),false);
  assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
  assert.equal(s.confirm(),false,'late native confirmation cannot recreate the aborted transaction');
  Object.keys(s.videoNatural).forEach(key=>delete s.videoNatural[key]);s.enter();assert.ok(s.ui(),'the next explicit fullscreen entry remains available');
});
test('fallback layout timeout starts only once the confirmed document viewport matches',t=>{
  const s=exitHandoffPage(t);Object.assign(s.videoNatural,{width:844,height:475,y:301});
  s.win.__langformFullscreen.finishExit('abcdefghijk',s.request.token,390,844);s.frame(180);
  assert.ok(s.ui());assert.equal(s.messages.some(row=>row.reason==='exit-layout-timeout'),false);
  s.resize(390,844);s.frame(100);assert.ok(s.ui());s.frame(20);
  assert.equal(s.ui(),null);assert.equal(s.messages.filter(row=>row.reason==='exit-layout-timeout').length,1);
});
test('cancelled staged motion uses the bounded fallback when natural media never recovers',t=>{
  const s=exitHandoffPage(t,{cached:true});assert.equal(stagedExit(s),true);const old=s.animations[0];old.fraction=.3;
  assert.equal(s.win.__langformFullscreen.cancelExitMotion('abcdefghijk',s.request.token),true);
  Object.assign(s.videoNatural,{width:844,height:475,y:301});s.prepare();s.confirm();s.frame(120);
  assert.equal(s.ui(),null);old.onfinish();
  assert.equal(s.messages.some(row=>row.kind==='exit-motion-ready'||row.kind==='exit-commit'),false);
  assert.equal(s.messages.filter(row=>row.reason==='exit-layout-timeout').length,1);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
for(const motion of ['absent','cancelled'])test(`qualified original inline media recovers stale geometry after ${motion} staged motion`,t=>{
  const s=exitHandoffPage(t,{cached:true,placement:true}),node=s.video,parent=node.parentElement,source=node.getAttribute('src');
  if(motion==='cancelled'){assert.equal(stagedExit(s),true);s.animations[0].fraction=.3;assert.equal(s.win.__langformFullscreen.cancelExitMotion('abcdefghijk',s.request.token),true);}
  node.style.top='191px';node.style.width='844px';Object.assign(s.videoNatural,{width:844,height:475,y:301});
  s.prepare();s.frame(6);assert.ok(s.ui(),'prepare alone does not authorize lease acquisition');
  assert.notEqual(node.style.width,'100%','the existing fixed pin is not persistent inline lease ownership');
  assert.equal(s.confirm(),true);s.frame(12);
  assert.equal(s.ui(),null);assert.equal(s.messages.some(row=>row.reason==='exit-layout-timeout'),false);
  assert.equal(s.messages.filter(row=>row.kind==='exit-commit').length,1);assert.equal(s.messages.some(row=>row.kind==='exit-motion-ready'),false);
  assert.equal(node.style.top,'0px');assert.equal(node.style.width,'100%');
  assert.equal(node,parent.querySelector('video'));assert.equal(node.getAttribute('src'),source);assert.equal(node.currentTime,40);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
for(const boundary of ['source','root','stage-inset'])test(`fallback stale-geometry correction cannot acquire across a changed saved ${boundary}`,t=>{
  const s=exitHandoffPage(t,{cached:true,placement:true});
  if(boundary==='source')s.video.setAttribute('src','https://example.test/replacement-source');
  if(boundary==='root')s.natural.y+=28;
  if(boundary==='stage-inset')s.win.__langformStageInsets.top=1;
  s.video.style.top='191px';s.video.style.width='844px';Object.assign(s.videoNatural,{width:844,height:475,y:301});
  s.prepare();s.confirm();s.frame(120);
  assert.equal(s.ui(),null);assert.equal(s.messages.some(row=>row.kind==='exit-commit'),false);assert.equal(s.messages.filter(row=>row.reason==='exit-layout-timeout').length,1);
  assert.notEqual(s.video.style.width,'100%');assert.equal(s.video.style.top,'191px');assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
test('entry motion consumes the remaining native deadline and exact known coordinator curve',t=>{
  const s=exitHandoffPage(t,{entry:true});assert.equal(s.win.__langformFullscreen.prepareEnter('abcdefghijk',s.request.token,844,390,s.win.Date.now()+350,'cubic-bezier(.42,0,.58,1)'),true);s.resize(844,390);s.frame(2);
  assert.ok(Math.abs(s.animations[0].timing.duration-(350-1000/30))<.01);assert.equal(s.animations[0].timing.easing,'cubic-bezier(.42,0,.58,1)');
});
test('late entry natural readiness cannot append a second post-rotation tween',t=>{
  const s=exitHandoffPage(t,{entry:true});assert.equal(s.win.__langformFullscreen.prepareEnter('abcdefghijk',s.request.token,844,390,s.win.Date.now()+20,'linear'),true);s.resize(844,390);s.frame(2);assert.equal(s.animations.length,0);s.confirm();s.frame(3);assert.equal(s.messages.filter(row=>row.kind==='enter-commit').length,1);
});
test('entry finish arriving without prepare still consumes its expired actual rotation deadline',t=>{
  const s=exitHandoffPage(t,{entry:true});s.resize(844,390);assert.equal(s.win.__langformFullscreen.finishEnter('abcdefghijk',s.request.token,844,390,s.win.Date.now()-20,'linear'),true);s.frame(4);assert.equal(s.animations.length,0);assert.equal(s.messages.filter(row=>row.kind==='enter-commit').length,1);
});
test('a busy WebContent process can finish its owned entry after an old rotation deadline without an extra tween',t=>{
  const s=exitHandoffPage(t,{entry:true});s.resize(844,390);assert.equal(s.win.__langformFullscreen.finishEnter('abcdefghijk',s.request.token,844,390,s.win.Date.now()-10000,'linear'),true);s.frame(4);assert.equal(s.animations.length,0);assert.equal(s.messages.filter(row=>row.kind==='enter-commit').length,1);
});

test('uncached exit keeps its live source when the portrait viewport arrives before native readiness',t=>{
  const s=exitHandoffPage(t),source=s.video.getBoundingClientRect();
  assert.ok(s.video.hasAttribute('data-langform-fullscreen-exit-video'));
  s.resize(390,844);s.frame(4);assert.deepEqual(s.video.getBoundingClientRect(),source);
  assert.equal(s.animations.length,0);assert.equal(s.root.hasAttribute('data-langform-fullscreen-player'),false);assert.equal(s.timeWrites(),0);
});

test('uncached native exit cannot move or release a landscape-sized YouTube video inside an already portrait-sized root',t=>{
  const s=exitHandoffPage(t),source=s.video.getBoundingClientRect();
  Object.assign(s.videoNatural,{x:7,y:301,width:844,height:475});s.prepare();s.confirm();s.frame(40);
  assert.equal(s.root.hasAttribute('data-langform-fullscreen-player'),false,'inline root can rehydrate under the held live node');
  assert.deepEqual(s.video.getBoundingClientRect(),source);assert.equal(s.animations.length,0);assert.equal(s.messages.some(row=>row.kind==='exit-commit'),false);
  Object.keys(s.videoNatural).forEach(key=>delete s.videoNatural[key]);s.frame();assert.equal(s.animations.length,0,'one matching frame is insufficient');
  s.frame(3);assert.equal(s.animations.length,1);s.finish();assert.equal(s.ui(),null);
  assert.equal(s.animations.length,1,'stale landscape target never creates a second returning animation');assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});

test('cached exit adopts the saved inline content in the first matching resize turn while natural YouTube media is stale',t=>{
  const s=exitHandoffPage(t,{cached:true,diagnostics:true}),node=s.video,parent=s.video.parentElement,source=s.video.getAttribute('src');
  Object.assign(s.videoNatural,{x:7,y:301,width:844,height:475});
  s.resize(390,844);
  const pose=s.video.getBoundingClientRect();
  assert.equal(pose.x,7);assert.equal(pose.y,100);assert.equal(pose.width,390);assert.equal(pose.height,219.375);
  assert.equal(s.animations.length,0,'UIKit owns rotation; no later second video tween');
  assert.equal(s.messages.some(row=>row.kind==='exit-commit'),false,'an early cached picture cannot authorize release');
  s.prepare();s.confirm();s.frame(35);
  assert.deepEqual(s.video.getBoundingClientRect(),pose);assert.ok(s.ui());assert.equal(s.messages.some(row=>row.kind==='exit-commit'),false);
  const rows=s.messages.filter(row=>row.kind==='geometry-trace').flatMap(row=>row.rows);
  assert.ok(rows.some(row=>row.exitUsingCachedDestination&&row.exitContextHidden));
  Object.keys(s.videoNatural).forEach(key=>delete s.videoNatural[key]);
  s.frame();assert.ok(s.ui(),'one matching natural frame cannot release');s.frame(3);
  assert.equal(s.ui(),null);assert.deepEqual(s.video.getBoundingClientRect(),pose);assert.equal(s.animations.length,0);
  assert.equal(s.video,node);assert.equal(s.video.parentElement,parent);assert.equal(s.video.getAttribute('src'),source);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});

for(const kind of ['root','stage-inset','viewport','fit','position','ratio','unknown-ratio','infinite-ratio','zero-ratio'])test(`cached exit rejects a changed or unavailable saved inline destination (${kind})`,t=>{
  const s=exitHandoffPage(t,{cached:true,unknownMetadata:kind==='unknown-ratio'});
  if(kind==='root')s.natural.y=128;
  if(kind==='stage-inset')s.win.__langformStageInsets.top=62;
  if(kind==='ratio')Object.defineProperty(s.video,'videoWidth',{value:1000});
  if(kind==='infinite-ratio')Object.defineProperty(s.video,'videoHeight',{value:0});
  if(kind==='zero-ratio')Object.defineProperty(s.video,'videoWidth',{value:0});
  if(kind==='fit'||kind==='position') {
    const original=s.win.getComputedStyle;
    s.win.getComputedStyle=node=>{
      const css=original(node);
      return node===s.video&&!s.video.hasAttribute('data-langform-fullscreen-exit-video')&&!s.root.hasAttribute('data-langform-fullscreen-player')
        ? {...css,...(kind==='fit'?{objectFit:'fill'}:{objectPosition:'0% 0%'})} : css;
    };
  }
  const before=s.video.getBoundingClientRect();s.resize(390,kind==='viewport'?900:844);
  assert.deepEqual(s.video.getBoundingClientRect(),before,'ineligible cache cannot mutate the live pose in resize');
  assert.equal(s.animations.length,0);
  s.confirm();s.frame(2);assert.equal(s.animations.length,1,'real stable natural geometry provides the uncached continuation');
  s.finish();assert.equal(s.ui(),null);assert.equal(s.timeWrites(),0);
});

test('a synchronous resize cannot apply cached layout to a changed identity before the route observer runs',t=>{
  const s=exitHandoffPage(t,{cached:true}),before=s.video.getBoundingClientRect();
  s.root.getVideoData=()=>({video_id:'zyxwvutsrqp'});s.resize(390,844);
  assert.deepEqual(s.video.getBoundingClientRect(),before);assert.ok(s.root.hasAttribute('data-langform-fullscreen-player'));
  assert.equal(s.animations.length,0);assert.equal(s.win.__langformFullscreen.isOpen(),false);assert.equal(s.ui(),null);assert.equal(s.timeWrites(),0);
});

test('cached exit hides only watch context branches and reveals them after matching natural layout without fading media',async t=>{
  const s=exitHandoffPage(t,{cached:true}),header=s.doc.createElement('header'),child=s.doc.createElement('span'),reveals=[];
  child.style.setProperty('visibility','visible','important');header.appendChild(child);s.doc.body.appendChild(header);
  await Promise.resolve();
  assert.ok(header.hasAttribute('data-langform-fullscreen-exit-context'));
  assert.equal(s.win.getComputedStyle(header).opacity,'0','branch opacity also suppresses descendants with an author visibility:visible!important');
  assert.match(s.doc.getElementById('langform-fullscreen-style').textContent,/\[data-langform-fullscreen-exit-context\] \* \{ visibility:hidden!important/);
  for(let node=s.video;node&&node!==s.doc.documentElement;node=node.parentElement)assert.equal(node.hasAttribute('data-langform-fullscreen-exit-context'),false,'media ancestor never hidden');
  s.win.Element.prototype.animate=function(frames,timing){const animation={node:this,frames,timing,cancel(){},onfinish:null};reveals.push(animation);return animation;};
  Object.assign(s.videoNatural,{width:844,height:475,y:301});s.prepare();s.confirm();s.frame(4);
  assert.ok(header.hasAttribute('data-langform-fullscreen-exit-context'));assert.equal(reveals.length,0);
  Object.keys(s.videoNatural).forEach(key=>delete s.videoNatural[key]);s.frame(4);
  assert.equal(s.ui(),null);assert.equal(header.hasAttribute('data-langform-fullscreen-exit-context'),false);
  assert.equal(reveals.some(row=>row.node===header),false,'cached watch context also returns without an empty opacity-zero canvas');assert.ok(reveals.every(row=>!row.node.contains(s.video)));
  assert.equal(s.animations.length,0);assert.equal(s.timeWrites(),0);
});

test('YouTube can move the same live node into a previously hidden sibling without hiding its new ancestor path',async t=>{
  const s=exitHandoffPage(t,{cached:true}),container=s.doc.createElement('div');container.className='html5-video-container';s.root.appendChild(container);
  await Promise.resolve();assert.ok(container.hasAttribute('data-langform-fullscreen-exit-context'));
  container.appendChild(s.video);await Promise.resolve();
  assert.equal(s.win.__langformFullscreen.isOpen(),true);assert.equal(container.hasAttribute('data-langform-fullscreen-exit-context'),false);
  assert.notEqual(s.win.getComputedStyle(container).opacity,'0');assert.ok(s.video.hasAttribute('data-langform-fullscreen-exit-video'));
  s.prepare();s.confirm();s.frame(4);assert.equal(s.ui(),null);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});

for(const reason of ['pagehide','navigation','newID','hydratedVideo','inactive'])test(`cached exit cancellation restores context and media ownership (${reason})`,async t=>{
  const s=exitHandoffPage(t,{cached:true}),context=s.doc.createElement('section'),reveals=[];
  s.win.Element.prototype.animate=function(){const a={cancelled:false,cancel(){this.cancelled=true;},onfinish:null};reveals.push(a);return a;};
  s.doc.body.appendChild(context);await Promise.resolve();assert.ok(context.hasAttribute('data-langform-fullscreen-exit-context'));s.prepare();
  assert.equal(context.hasAttribute('data-langform-fullscreen-exit-context'),false,'stable watch context is visible before native commit');assert.ok(context.closest('[inert]'));
  if(reason==='pagehide')s.win.dispatchEvent(new s.win.Event('pagehide'));
  if(reason==='navigation')s.win.dispatchEvent(new s.win.Event('yt-navigate-start'));
  if(reason==='newID'){s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');s.win.dispatchEvent(new s.win.Event('video-data-change'));}
  if(reason==='hydratedVideo'){s.video.remove();await Promise.resolve();}
  if(reason==='inactive'){s.doc.hidden=true;s.doc.dispatchEvent(new s.win.Event('visibilitychange'));}
  assert.equal(s.ui(),null);assert.equal(context.hasAttribute('data-langform-fullscreen-exit-context'),false);assert.equal(context.hasAttribute('inert'),false);assert.ok(reveals.every(a=>a.cancelled),'cancelled exit leaves no running context fade');
  assert.equal(s.video.hasAttribute('data-langform-fullscreen-exit-video'),false);assert.equal(s.doc.getElementById('langform-fullscreen-exit-style'),null);
  assert.equal(s.confirm(),false);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});

test('exit requires two stable natural frames again at commit and ignores late layout changes until a real inline target is ready',t=>{
  const s=exitHandoffPage(t);s.prepare();s.confirm();const animation=s.animations[0];animation.fraction=1;animation.onfinish();
  assert.ok(s.ui());Object.assign(s.videoNatural,{width:844,height:475,y:301});s.frame(8);
  assert.equal(s.messages.some(row=>row.kind==='exit-commit'),false);assert.equal(s.animations.length,1);assert.ok(s.video.hasAttribute('data-langform-fullscreen-exit-video'));
  Object.keys(s.videoNatural).forEach(key=>delete s.videoNatural[key]);s.frame(4);
  assert.equal(s.ui(),null);assert.equal(s.animations.length,1,'ready target matches the held end pose and releases without another animation');
});

test('diagnostic fullscreen probe uses the real first-entry/exit handshakes and holds each committed live pose before the ordinary Close',t=>{
  const s=exitHandoffPage(t,{entry:true,probe:true,diagnostics:true}),api=s.win.__langformFullscreenDiagnosticProbe;
  const marks=()=>s.messages.filter(row=>row.kind==='diagnostic-probe').map(row=>row.phase);
  const timer=delay=>{const entry=[...s.timers].find(([,value])=>value.delay===delay);assert.ok(entry,'bounded timer '+delay);s.timers.delete(entry[0]);entry[1].fn();};
  assert.equal(api.run('wrong','native-probe',1,3000),false);assert.equal(api.run('abcdefghijk','native-probe',1,3000),true);
  assert.equal(api.run('abcdefghijk','duplicate',1,3000),false);assert.equal(api.cancel('stale'),false);
  const entry=s.messages.find(row=>row.kind==='enter-request');assert.ok(entry);assert.deepEqual(marks(),[]);
  s.win.__langformFullscreen.prepareEnter('abcdefghijk',entry.token,844,390);s.resize(844,390);s.frame(2);s.finish();
  assert.deepEqual(marks(),[],'prepared pose cannot start the screenshot hold');
  s.win.__langformFullscreen.finishEnter('abcdefghijk',entry.token,844,390);s.frame(2);assert.deepEqual(marks(),['opened']);assert.ok(s.ui());
  timer(3000);const exit=s.messages.find(row=>row.kind==='exit-request');assert.ok(exit);
  s.win.__langformFullscreen.prepareExit('abcdefghijk',exit.token,390,844);s.resize(390,844);s.frame(2);s.finish();assert.deepEqual(marks(),['opened']);
  s.win.__langformFullscreen.finishExit('abcdefghijk',exit.token,390,844);s.frame(2);assert.deepEqual(marks(),['opened','inline']);assert.equal(s.ui(),null);
  timer(3000);assert.deepEqual(marks(),['opened','inline','finished']);assert.equal([...s.timers.values()].some(value=>value.delay===12000),false);
  assert.equal(s.video.currentTime,40);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});

for(const reason of ['timeout','native-cancel','inactive','pagehide','newID'])test(`opt-in fullscreen diagnostic aborts owned work and restores media ownership (${reason})`,t=>{
  const s=exitHandoffPage(t,{entry:true,probe:true,diagnostics:true}),api=s.win.__langformFullscreenDiagnosticProbe;
  assert.equal(api.run('abcdefghijk','native-probe',1,3000),true);
  if(reason==='timeout'){const value=[...s.timers.values()].find(value=>value.delay===12000);value.fn();}
  if(reason==='native-cancel')assert.equal(api.cancel('native-probe'),true);
  if(reason==='inactive'){s.doc.hidden=true;s.doc.dispatchEvent(new s.win.Event('visibilitychange'));}
  if(reason==='pagehide')s.win.dispatchEvent(new s.win.Event('pagehide'));
  if(reason==='newID'){s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');s.win.dispatchEvent(new s.win.Event('video-data-change'));}
  assert.equal(s.ui(),null);assert.equal(s.video.hasAttribute('data-langform-fullscreen-enter-video'),false);
  assert.equal(s.messages.filter(row=>row.kind==='diagnostic-probe').at(-1).phase,reason==='timeout'?'timeout':'cancelled');
  assert.equal(api.cancel('native-probe'),false);assert.equal([...s.timers.values()].some(value=>value.delay===3000||value.delay===12000),false);
  assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});

test('diagnostic fullscreen API is absent without both explicit bootstrap flags',t=>{
  const ordinary=exitHandoffPage(t,{entry:true});assert.equal(ordinary.win.__langformFullscreenDiagnosticProbe,undefined);
  const noDiagnostics=exitHandoffPage(t,{entry:true,probe:true});assert.equal(noDiagnostics.win.__langformFullscreenDiagnosticProbe,undefined);
});

test('diagnostic repeat probe performs six committed production roundtrips with one final marker and a bounded budget',t=>{
  const s=exitHandoffPage(t,{entry:true,probe:true,diagnostics:true}),api=s.win.__langformFullscreenDiagnosticProbe;
  const timer=delay=>{const entry=[...s.timers].find(([,value])=>value.delay===delay);assert.ok(entry,'timer '+delay);s.timers.delete(entry[0]);entry[1].fn();};
  const marks=()=>s.messages.filter(row=>row.kind==='diagnostic-probe').map(row=>row.phase);
  assert.equal(api.run('abcdefghijk','repeat',6,250),true);assert.ok([...s.timers.values()].some(row=>row.delay===29000));
  for(let cycle=1;cycle<=6;cycle++) {
    const enter=s.messages.filter(row=>row.kind==='enter-request').at(-1);
    s.win.__langformFullscreen.prepareEnter('abcdefghijk',enter.token,844,390);s.resize(844,390);s.frame(2);s.win.__langformFullscreen.finishEnter('abcdefghijk',enter.token,844,390);s.finish();
    assert.equal(marks().filter(row=>row==='opened').length,cycle);timer(250);
    const exit=s.messages.filter(row=>row.kind==='exit-request').at(-1);
    s.win.__langformFullscreen.prepareExit('abcdefghijk',exit.token,390,844);s.resize(390,844);s.win.__langformFullscreen.finishExit('abcdefghijk',exit.token,390,844);s.frame(4);
    assert.equal(marks().filter(row=>row==='inline').length,cycle);assert.equal(marks().includes('finished'),false);timer(250);
  }
  assert.deepEqual(marks(),[...Array(6)].flatMap(()=>['opened','inline']).concat('finished'));assert.equal(s.ui(),null);
  assert.equal(s.messages.filter(row=>row.kind==='enter-request').length,6);assert.equal(s.messages.filter(row=>row.kind==='exit-commit').length,6);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
  assert.equal([...s.timers.values()].some(row=>row.delay===29000),false);
});

test('repeat probe rejects unsafe cycle/hold budgets and defaults to one normal committed cycle',t=>{
  const s=exitHandoffPage(t,{entry:true,probe:true,diagnostics:true}),api=s.win.__langformFullscreenDiagnosticProbe;
  for(const [cycles,hold] of [[0,250],[7,250],[1.5,250],[NaN,250],[1,199],[1,3001],[1,Infinity]])assert.equal(api.run('abcdefghijk','invalid',cycles,hold),false);
  assert.equal(api.run('abcdefghijk','default'),true);assert.ok([...s.timers.values()].some(row=>row.delay===12000));assert.equal(api.cancel('default'),true);
});

test('entry rejects a stale square root/outer target until two matching actual fullscreen frames exist',t=>{
  const s=exitHandoffPage(t,{entry:true}),before=s.video.getBoundingClientRect();
  Object.assign(s.fullscreenRoot,{height:844});Object.assign(s.fullscreenVideo,{height:844});s.prepare();s.confirm();s.frame(16);
  assert.equal(s.animations.length,0);assert.deepEqual(s.video.getBoundingClientRect(),before);assert.equal(s.messages.some(row=>row.kind==='enter-commit'),false);
  delete s.fullscreenRoot.height;delete s.fullscreenVideo.height;s.frame();s.fullscreenVideo.height=400;s.frame();
  assert.equal(s.animations.length,0,'one good frame followed by stale outer geometry cannot start a tween');
  delete s.fullscreenVideo.height;s.frame(4);assert.equal(s.animations.length,1);s.finish();
  assert.equal(s.video.hasAttribute('data-langform-fullscreen-enter-video'),false);assert.equal(s.animations.length,1);assert.equal(s.timeWrites(),0);
});

test('entry completion retains the final live pin through late wrong root/outer hydration and releases without retargeting',t=>{
  const s=exitHandoffPage(t,{entry:true});s.prepare();s.confirm();const animation=s.animations[0];animation.fraction=1;
  s.fullscreenRoot.height=844;s.fullscreenVideo.height=844;animation.onfinish();s.frame(10);
  assert.ok(s.video.hasAttribute('data-langform-fullscreen-enter-video'));assert.equal(s.animations.length,1);assert.equal(s.messages.some(row=>row.kind==='enter-commit'),false);
  delete s.fullscreenRoot.height;delete s.fullscreenVideo.height;s.frame(4);
  assert.equal(s.video.hasAttribute('data-langform-fullscreen-enter-video'),false);assert.equal(s.animations.length,1,'late natural readiness releases the same expected end pose');
});

for(const reason of ['normal','pagehide','navigation','newID','ad','inactive'])test(`fullscreen containing-block CSS ownership restores all author ancestor styles and media on completion/cancel (${reason})`,t=>{
  const s=exitHandoffPage(t,{entry:true,ancestorStyles:true}),nodes=[s.root.parentElement,s.root,s.video.parentElement],styles=nodes.map(node=>node.getAttribute('style'));
  const parent=s.video.parentElement,source=s.video.getAttribute('src');s.prepare();s.confirm();s.finish();
  assert.equal(s.video.style.getPropertyValue('transform'),'none','fullscreen keeps its own video transform after the entry pin is released');
  if(reason==='normal') {s.win.__langformFullscreen.exit('abcdefghijk');const exit=s.messages.find(row=>row.kind==='exit-request');s.win.__langformFullscreen.prepareExit('abcdefghijk',exit.token,390,844);s.resize(390,844);s.win.__langformFullscreen.finishExit('abcdefghijk',exit.token,390,844);s.frame(4);}
  if(reason==='pagehide')s.win.dispatchEvent(new s.win.Event('pagehide'));
  if(reason==='navigation')s.win.dispatchEvent(new s.win.Event('yt-navigate-start'));
  if(reason==='newID'){s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');s.win.dispatchEvent(new s.win.Event('video-data-change'));}
  if(reason==='ad'){s.root.classList.add('ad-showing');s.win.__langformFullscreen.isOpen();}
  if(reason==='inactive'){s.win.__langformFullscreen.exit('abcdefghijk');s.doc.hidden=true;s.doc.dispatchEvent(new s.win.Event('visibilitychange'));}
  assert.equal(s.ui(),null);assert.deepEqual(nodes.map(node=>node.getAttribute('style')),styles);
  assert.ok(nodes.every(node=>!node.hasAttribute('data-langform-fullscreen-ancestor')&&!node.hasAttribute('data-langform-fullscreen-player')&&!node.hasAttribute('data-langform-fullscreen-exit-ancestor')));
  assert.equal(s.video.style.getPropertyValue('transform'),'translateX(7px)');assert.equal(s.video.style.getPropertyPriority('transform'),'important');
  assert.equal(s.video.parentElement,parent);assert.equal(s.video.getAttribute('src'),source);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});

for(const kind of ['click','touch'])test(`a real repeated Fullscreen control toggles pending entry into exit and consumes further exiting gestures (${kind})`,t=>{
  const s=exitHandoffPage(t,{entry:true}),control=s.root.querySelector('button');let original=0;control.addEventListener(kind==='touch'?'touchend':'click',()=>original++);
  const activate=()=>{if(kind==='touch'){touchEvent(s,control,'touchstart');touchEvent(s,control,'touchend',[],[{identifier:1,clientX:20,clientY:20}]);control.click();}else control.click();};
  const before=s.video.getBoundingClientRect();activate();assert.ok(s.video.hasAttribute('data-langform-fullscreen-exit-video'));assert.deepEqual(s.video.getBoundingClientRect(),before);
  assert.equal(s.messages.filter(row=>row.kind==='exit-request').length,1);activate();assert.equal(s.messages.filter(row=>row.kind==='exit-request').length,1);assert.equal(original,0);
  const exit=s.messages.find(row=>row.kind==='exit-request');s.win.__langformFullscreen.prepareExit('abcdefghijk',exit.token,390,844);s.win.__langformFullscreen.finishExit('abcdefghijk',exit.token,390,844);s.frame(4);
  assert.equal(s.ui(),null);assert.equal(s.messages.some(row=>row.kind==='enter-commit'),false);assert.equal(s.timeWrites(),0);
});

for(const options of [{paused:false},{paused:true,live:true},{paused:true,portrait:true,inlineFit:'cover'},{paused:true,portrait:true,inlineFit:'fill'}])test(`first entry holds exact inline pixels before rotation and finishes without media or secondary pose changes (${JSON.stringify(options)})`,t=>{
  const s=exitHandoffPage(t,{...options,entry:true}),parent=s.video.parentElement,source=s.video.getAttribute('src');
  const before=s.video.getBoundingClientRect();s.natural.y-=62;s.frame(4);
  assert.deepEqual(s.video.getBoundingClientRect(),before,'status-bar/safe-area changes cannot move the held source picture');assert.equal(s.animations.length,0);assert.ok(s.ui().inert);
  s.prepare();assert.equal(s.animations.length,1);s.finish();assert.ok(s.video.hasAttribute('data-langform-fullscreen-enter-video'));
  assert.equal(s.messages.some(row=>row.kind==='enter-commit'),false,'prepared compositor pose still waits for UIKit completion');
  s.confirm();s.frame(2);assert.equal(s.video.hasAttribute('data-langform-fullscreen-enter-video'),false);assert.equal(s.animations.length,1);
  assert.equal(s.messages.filter(row=>row.kind==='enter-commit').length,1);assert.ok(s.win.__langformFullscreen.isOpen());assert.equal(s.ui().inert,false);
  assert.equal(s.video.parentElement,parent);assert.equal(s.video.getAttribute('src'),source);assert.equal(s.video.currentTime,40);assert.equal(s.timeWrites(),0);assert.equal(s.paused(),options.paused);assert.deepEqual(s.calls,[]);
});

test('entry rejects stale token/viewport and holds its current live pose through mid-rotation resizing',t=>{
  const s=exitHandoffPage(t,{entry:true});assert.equal(s.win.__langformFullscreen.prepareEnter('abcdefghijk','old',844,390),false);
  assert.equal(s.win.__langformFullscreen.prepareEnter('abcdefghijk',s.request.token,844,390),true);s.frame(3);assert.equal(s.animations.length,0,'late WebKit resize cannot use native landscape bounds early');
  s.resize(844,390);s.frame(2);const old=s.animations[0];old.fraction=.5;const before=s.video.getBoundingClientRect();
  s.resize(900,390);assert.equal(old.cancelled,true);assert.deepEqual(s.video.getBoundingClientRect(),before);
  old.onfinish();assert.equal(s.messages.some(row=>row.kind==='enter-commit'),false);
  s.confirm();s.frame(2);assert.equal(s.animations.length,2);assert.deepEqual(s.video.getBoundingClientRect(),before);s.finish();assert.equal(s.video.hasAttribute('data-langform-fullscreen-enter-video'),false);
});

test('entry native completion during animation releases only after the displayed live node reaches its fullscreen target',t=>{
  const s=exitHandoffPage(t,{entry:true});s.prepare();s.confirm();s.frame(2);assert.ok(s.video.hasAttribute('data-langform-fullscreen-enter-video'));
  s.finish();assert.equal(s.video.hasAttribute('data-langform-fullscreen-enter-video'),false);assert.equal(s.animations.length,1);assert.equal(s.timeWrites(),0);
});

for(const reason of ['pagehide','navigation','newID','hydratedVideo','inactive'])test(`first entry cancellation restores inline ownership and ignores stale UIKit/animation completion (${reason})`,async t=>{
  const s=exitHandoffPage(t,{entry:true});s.prepare();const old=s.animations[0];old.fraction=.4;
  if(reason==='pagehide')s.win.dispatchEvent(new s.win.Event('pagehide'));
  if(reason==='navigation')s.win.dispatchEvent(new s.win.Event('yt-navigate-start'));
  if(reason==='newID'){s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');s.win.dispatchEvent(new s.win.Event('video-data-change'));}
  if(reason==='hydratedVideo'){s.video.remove();await Promise.resolve();}
  if(reason==='inactive'){s.doc.hidden=true;s.doc.dispatchEvent(new s.win.Event('visibilitychange'));}
  assert.equal(s.ui(),null);assert.equal(old.cancelled,true);assert.equal(s.video.hasAttribute('data-langform-fullscreen-enter-video'),false);
  assert.equal(s.doc.getElementById('langform-fullscreen-enter-style'),null);assert.equal(s.video.style.getPropertyValue('transform'),'translateX(7px)');
  old.onfinish();assert.equal(s.confirm(),false);s.frame(3);assert.equal(s.messages.some(row=>row.kind==='enter-commit'),false);assert.equal(s.timeWrites(),0);
});

test('exit requested halfway through first entry transfers the same displayed node to the portrait handoff',t=>{
  const s=exitHandoffPage(t,{entry:true});s.prepare();const entry=s.animations[0];entry.fraction=.5;const before=s.video.getBoundingClientRect();
  s.win.__langformStageInsets.top=1;
  s.win.__langformFullscreen.exit('abcdefghijk');assert.equal(entry.cancelled,true);assert.deepEqual(s.video.getBoundingClientRect(),before,'reversal holds the presented node through native portrait request');
  entry.onfinish();assert.equal(s.confirm(),false,'stale entry finish cannot overwrite current exit');
  const exit=s.messages.find(row=>row.kind==='exit-request');s.win.__langformFullscreen.prepareExit('abcdefghijk',exit.token,390,844);s.resize(390,844);s.frame(2);
  assert.equal(s.doc.getElementById('langform-fullscreen-enter-style'),null);assert.ok(s.video.hasAttribute('data-langform-fullscreen-exit-video'));
  assert.equal(s.animations.length,2);s.win.__langformFullscreen.finishExit('abcdefghijk',exit.token,390,844);s.finish();assert.equal(s.ui(),null);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});

for(const options of [{reduced:true},{animationThrows:true}])test(`first entry supports optional compositor motion and still waits for native viewport authorization (${JSON.stringify(options)})`,t=>{
  const s=exitHandoffPage(t,{entry:true,...options});s.prepare();assert.equal(s.animations.length,0);assert.ok(s.video.hasAttribute('data-langform-fullscreen-enter-video'));
  s.confirm();s.frame(2);assert.equal(s.video.hasAttribute('data-langform-fullscreen-enter-video'),false);assert.equal(s.timeWrites(),0);
});

test('first entry emits opt-in bounded content geometry before native statusbar/rotation and after commit',t=>{
  const s=exitHandoffPage(t,{entry:true,diagnostics:true});s.frame(3);s.prepare();s.finish();s.confirm();s.frame(40);
  const rows=s.messages.filter(row=>row.kind==='geometry-trace').flatMap(row=>row.rows);
  assert.ok(rows.some(row=>row.phase==='waiting'&&row.pictureY===100));assert.ok(rows.some(row=>row.phase==='handoff'));assert.ok(rows.some(row=>row.phase==='committed'));
  assert.equal(s.frames.size,0);assert.equal(s.timeWrites(),0);
});

for(const options of [{paused:false},{paused:true},{paused:true,live:true}])test(`live-node exit moves within rotation and releases only after native completion (paused=${options.paused}, live=${!!options.live})`,t=>{
  const s=exitHandoffPage(t,options),parent=s.video.parentElement,source=s.video.getAttribute('src');
  s.prepare();assert.equal(s.animations.length,1);assert.ok(s.video.hasAttribute('data-langform-fullscreen-exit-video'));
  assert.equal(s.root.hasAttribute('data-langform-fullscreen-player'),false,'the target uses real inline layout during the handoff');
  s.finish();assert.equal(s.win.__langformFullscreen.isOpen(),true,'early completed motion remains owned until UIKit completes');
  assert.equal(s.messages.some(row=>row.kind==='exit-commit'),false);
  s.confirm();s.frame(2);
  assert.equal(s.ui(),null);assert.equal(s.animations.length,1,'final release adds no second motion');
  assert.equal(s.video.parentElement,parent);assert.equal(s.video.getAttribute('src'),source);
  assert.equal(s.video.currentTime,40);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);assert.equal(s.paused(),options.paused);
  assert.equal(s.video.style.getPropertyValue('transform'),'translateX(7px)');assert.equal(s.video.style.getPropertyPriority('transform'),'important');
  assert.equal(s.doc.getElementById('langform-fullscreen-exit-style'),null);
  assert.equal(s.messages.filter(row=>row.kind==='exit-commit').length,1);
});

test('native completion during the live handoff keeps ownership until the displayed node reaches its target',t=>{
  const s=exitHandoffPage(t);s.prepare();s.animations[0].fraction=.5;
  s.confirm();s.frame(2);assert.ok(s.ui());assert.equal(s.messages.some(row=>row.kind==='exit-commit'),false);
  s.finish();assert.equal(s.ui(),null);assert.equal(s.animations.length,1);assert.equal(s.timeWrites(),0);
});

test('inline object-fit fill with portrait media releases the exact displayed picture without repeated fitting',t=>{
  const s=exitHandoffPage(t,{portrait:true,inlineFit:'fill',paused:true});s.prepare();s.confirm();
  assert.match(s.doc.getElementById('langform-fullscreen-exit-style').textContent,/object-fit:fill!important/);
  s.finish();assert.equal(s.ui(),null);assert.equal(s.animations.length,1);assert.equal(s.video.currentTime,40);assert.equal(s.timeWrites(),0);
});

test('viewport changes mid-exit pin the current displayed picture, reject stale completion and continue in confirmed bounds',t=>{
  const s=exitHandoffPage(t);s.prepare();const old=s.animations[0];old.fraction=.5;const before=s.video.getBoundingClientRect();
  s.resize(390,900);assert.equal(old.cancelled,true);assert.deepEqual(s.video.getBoundingClientRect(),before,'resize freezes the live node at its presented pose');
  old.onfinish();assert.ok(s.ui(),'stale animation cannot release ownership');
  s.confirm();s.frame(2);assert.equal(s.animations.length,2);assert.deepEqual(s.video.getBoundingClientRect(),before,'new handoff starts at the frozen content box');
  s.finish();assert.equal(s.ui(),null);assert.equal(s.video.currentTime,40);assert.equal(s.timeWrites(),0);
});

test('late inline header geometry continues from the current live pose before final release',t=>{
  const s=exitHandoffPage(t);s.prepare();s.confirm();s.natural.y=128;
  s.finish();assert.equal(s.animations.length,2);assert.ok(s.ui());
  s.finish();assert.equal(s.ui(),null);assert.equal(s.video.getBoundingClientRect().y,128);
});

for(const options of [{reduced:true},{animationThrows:true}])test(`optional motion keeps the early handoff owned and restores inline media exactly (${JSON.stringify(options)})`,t=>{
  const s=exitHandoffPage(t,options);s.prepare();assert.ok(s.ui());assert.equal(s.animations.length,0);
  s.confirm();s.frame(2);assert.equal(s.ui(),null);assert.equal(s.timeWrites(),0);assert.equal(s.video.currentTime,40);assert.deepEqual(s.calls,[]);
});

test('turning on reduced motion during handoff cancels the compositor and respects the native release gate',t=>{
  const s=exitHandoffPage(t);s.prepare();s.animations[0].fraction=.25;
  s.win.__testPreference.matches=true;s.win.__testPreference.dispatchEvent(new s.win.Event('change'));s.frame(2);
  assert.equal(s.animations[0].cancelled,true);assert.ok(s.ui());
  s.confirm();s.frame(2);assert.equal(s.ui(),null);assert.equal(s.timeWrites(),0);
});

for(const reason of ['pagehide','navigation','newID','hydratedVideo','inactive'])test(`interrupted handoff fully restores document/media ownership (${reason})`,async t=>{
  const s=exitHandoffPage(t);s.prepare();const old=s.animations[0];old.fraction=.4;
  if(reason==='pagehide')s.win.dispatchEvent(new s.win.Event('pagehide'));
  if(reason==='navigation')s.win.dispatchEvent(new s.win.Event('yt-navigate-start'));
  if(reason==='newID'){s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');s.win.dispatchEvent(new s.win.Event('video-data-change'));}
  if(reason==='hydratedVideo'){s.video.remove();await Promise.resolve();}
  if(reason==='inactive'){s.doc.hidden=true;s.doc.dispatchEvent(new s.win.Event('visibilitychange'));}
  assert.equal(s.ui(),null);assert.equal(old.cancelled,true);assert.equal(s.doc.getElementById('langform-fullscreen-exit-style'),null);
  assert.equal(s.video.hasAttribute('data-langform-fullscreen-exit-video'),false);assert.equal(s.root.hasAttribute('data-langform-fullscreen-exit-layout'),false);
  assert.equal(s.root.parentElement.hasAttribute('inert'),false);assert.equal(s.video.style.getPropertyValue('transform'),'translateX(7px)');
  old.onfinish();s.frame(3);assert.equal(s.messages.some(row=>row.kind==='exit-commit'),false);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});

test('prepare/finish require the current exit token and never revive an interrupted or replaced document',t=>{
  const s=exitHandoffPage(t);assert.equal(s.win.__langformFullscreen.prepareExit('abcdefghijk','old',390,844),false);
  assert.equal(s.win.__langformFullscreen.prepareExit('zyxwvutsrqp',s.messages[1].token,390,844),false);
  s.prepare();s.win.dispatchEvent(new s.win.Event('yt-navigate-start'));
  assert.equal(s.win.__langformFullscreen.prepareExit('abcdefghijk',s.messages[1].token,390,844),false);
  assert.equal(s.confirm(),false);s.frame(3);assert.equal(s.ui(),null);
});

test('geometry diagnostics are opt-in, bounded and observe handoff plus post-commit frames',t=>{
  const s=exitHandoffPage(t,{diagnostics:true});s.prepare();s.finish();s.confirm();s.frame(50);
  const rows=s.messages.filter(row=>row.kind==='geometry-trace').flatMap(row=>row.rows);
  assert.ok(rows.some(row=>row.phase==='handoff'));assert.ok(rows.some(row=>row.phase==='committed'));
  assert.ok(rows.length>5&&rows.length<=240);assert.equal(s.frames.size,0);
  assert.ok(rows.every(row=>!('href'in row)&&!('videoID'in row)&&!('title'in row)));
  assert.equal(s.timeWrites(),0);
});

function feedbackSetup(t,options={}) {
  const animations=[];let preference;
  const env=setup(t,{paused:options.paused,confirmPlaying:options.confirmPlaying,nativeSetup(video,root,win) {
    Object.defineProperty(win.document,'hidden',{value:!!options.hidden,writable:true,configurable:true});
    preference=new win.EventTarget();preference.matches=!!options.reduced;win.matchMedia=()=>preference;
    if(!options.noAnimation)win.Element.prototype.animate=function(frames,timing) {
      if(options.throws)throw Error('Decoration unavailable');
      const animation={node:this,frames:JSON.parse(JSON.stringify(frames)),timing,cancelled:false,onfinish:null,
        cancel(){this.cancelled=true;},finish(){if(this.onfinish)this.onfinish();}};
      animations.push(animation);return animation;
    };
  }});
  env.enter();
  return {...env,animations,preference,feedback:()=>env.ui()?.querySelector('.lf-fs-feedback')};
}
test('skip feedback accumulates real seeks, switches direction, clamps at the media edge and never delays playback',t=>{
  const s=feedbackSetup(t);
  s.ui().getBoundingClientRect=()=>{throw Error('feedback must not measure layout');};
  s.button('forward').click();
  assert.equal(s.video.currentTime,50);assert.equal(s.feedback().textContent,'+10 s');
  assert.equal(s.feedback().getAttribute('aria-hidden'),'true');
  assert.equal(s.feedback().querySelector('button,input,[tabindex]'),null);
  const first=[...s.animations],stale=first[1].onfinish;
  s.button('forward').click();
  assert.equal(s.video.currentTime,60);assert.equal(s.feedback().textContent,'+20 s');
  assert.ok(first.every(a=>a.cancelled));assert.equal(s.ui().querySelectorAll('.lf-fs-feedback').length,1);
  stale();assert.equal(s.feedback().textContent,'+20 s','a cancelled completion cannot remove the newer feedback');
  s.button('back').click();assert.equal(s.video.currentTime,50);assert.equal(s.feedback().textContent,'−10 s');
  assert.equal(s.feedback().getAttribute('data-kind'),'back');
  s.video.currentTime=117;s.button('forward').click();
  assert.equal(s.video.currentTime,120);assert.equal(s.feedback().textContent,'+3 s','show only the actual clamped seek');
  s.button('forward').click();assert.equal(s.feedback(),null,'no false confirmation at the boundary');
  assert.deepEqual(s.calls,[]);assert.equal(s.paused(),false);
});
test('finished feedback releases every effect and a new action starts again at ten seconds',t=>{
  const s=feedbackSetup(t);s.button('forward').click();s.button('forward').click();
  const finish=s.animations.at(-1).onfinish;s.animations.at(-1).finish();
  assert.equal(s.feedback(),null);assert.ok(s.animations.every(a=>a.cancelled));
  s.button('forward').click();assert.equal(s.feedback().textContent,'+10 s');
  finish();assert.equal(s.feedback().textContent,'+10 s');
  const range=s.ui().querySelector('input');range.value=45;range.dispatchEvent(new s.win.Event('input',{bubbles:true}));
  assert.equal(s.feedback(),null,'timeline interaction cancels the preceding skip group');
  range.dispatchEvent(new s.win.Event('change',{bubbles:true}));s.button('forward').click();
  assert.equal(s.feedback().textContent,'+10 s');assert.equal(s.video.currentTime,55);
});
test('play and pause confirm only a changed media state and retain immediate guarded bridge calls',t=>{
  const s=feedbackSetup(t);s.button('play').click();
  assert.equal(s.paused(),true);assert.equal(s.button('play').getAttribute('aria-label'),'Wiedergabe');
  assert.equal(s.feedback().getAttribute('data-kind'),'pause');assert.equal(s.feedback().textContent,'Pause');
  s.button('play').click();assert.equal(s.paused(),false);assert.equal(s.feedback().getAttribute('data-kind'),'play');
  assert.deepEqual(s.calls,[['toggle','abcdefghijk'],['play','abcdefghijk']]);
  assert.equal(s.video.currentTime,40);
  s.win.__langformTogglePlayback=()=>false;s.button('play').click();
  assert.equal(s.paused(),false);assert.equal(s.feedback(),null,'a rejected action never confirms pause');
});
test('feedback is cancelled on exit, route change, ad, background, reduce motion and pagehide; stale completions stay inert',async t=>{
  for(const reason of ['exit','route','ad','background','reduce','pagehide']){
    const s=feedbackSetup(t);s.button('forward').click();
    const oldNode=s.feedback(),stale=s.animations.at(-1).onfinish;
    if(reason==='exit')s.win.__langformFullscreen.exit('abcdefghijk');
    else if(reason==='route'){s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');s.win.dispatchEvent(new s.win.Event('popstate'));}
    else if(reason==='ad'){s.root.classList.add('ad-showing');await Promise.resolve();}
    else if(reason==='background'){s.doc.hidden=true;s.doc.dispatchEvent(new s.win.Event('visibilitychange'));}
    else if(reason==='reduce'){s.preference.matches=true;s.preference.dispatchEvent(new s.win.Event('change'));}
    else s.win.dispatchEvent(new s.win.Event('pagehide'));
    assert.equal(oldNode.isConnected,false,reason);assert.ok(s.animations.every(a=>a.cancelled),reason);
    stale();assert.equal(s.doc.querySelector('.lf-fs-feedback'),null,reason);
    assert.equal(s.video.currentTime,50);assert.equal(s.paused(),false);
    if(reason==='background'||reason==='reduce'){
      s.button('forward').click();assert.equal(s.video.currentTime,60);assert.equal(s.feedback(),null);
    }
  }
});
test('unsupported animation, hidden documents and reduce motion preserve actions without creating feedback or fallback timers',t=>{
  for(const options of [{noAnimation:true},{reduced:true},{hidden:true},{throws:true}]){
    const s=feedbackSetup(t,options);s.button('forward').click();s.button('play').click();
    assert.equal(s.video.currentTime,50);assert.equal(s.paused(),true);assert.equal(s.feedback(),null);
    assert.equal(s.animations.length,0);assert.equal(s.timers.size,0,'no decoration or pause timer remains');
  }
});

test('a play request confirms only running media, while a rejected, paused or superseded request stays silent',t=>{
  for(const outcome of ['playing','error','pause','new-seek','rejected']){
    const s=feedbackSetup(t,{paused:true,confirmPlaying:false});
    if(outcome==='rejected'){
      const play=s.win.__langformPlay;s.win.__langformPlay=id=>{play(id);return false;};
    }
    s.button('play').click();assert.equal(s.feedback(),null,'paused=false alone is not accepted playback');
    if(outcome==='error'||outcome==='pause')s.video.dispatchEvent(new s.win.Event(outcome));
    else if(outcome==='new-seek')s.button('forward').click();
    s.video.dispatchEvent(new s.win.Event('playing'));
    if(outcome==='playing')assert.equal(s.feedback().getAttribute('data-kind'),'play');
    else if(outcome==='new-seek')assert.equal(s.feedback().textContent,'+10 s');
    else assert.equal(s.feedback(),null,outcome+' cannot produce a later optimistic confirmation');
    assert.equal(s.video.currentTime,outcome==='new-seek'?50:40);
  }
});

test('real media state and buffering remove contradictory confirmations without cancelling an intentional pause',t=>{
  const s=feedbackSetup(t);s.button('play').click();
  assert.equal(s.feedback().getAttribute('data-kind'),'pause','the intentional pause confirms after its pause event');
  s.win.__langformPlay('abcdefghijk');
  assert.equal(s.feedback(),null,'external playback clears the preceding pause confirmation');
  s.button('play').click();s.button('play').click();
  assert.equal(s.feedback().getAttribute('data-kind'),'play');
  s.win.__langformTogglePlayback('abcdefghijk');
  assert.equal(s.paused(),true);assert.equal(s.feedback(),null,'a real pause cannot leave Wiedergabe on screen');
  s.button('play').click();assert.equal(s.feedback().getAttribute('data-kind'),'play');
  s.video.dispatchEvent(new s.win.Event('waiting'));
  assert.equal(s.feedback(),null,'a buffering stream cannot retain a running confirmation');
  s.button('forward').click();s.video.dispatchEvent(new s.win.Event('waiting'));
  assert.equal(s.feedback().textContent,'+10 s','buffering after a seek does not contradict the completed time jump');
});

function speedSetup(t,options={}) {
  const s=setup(t,options);s.enter();
  return {...s,speed:()=>s.ui()?.querySelector('.lf-fs-speed-button'),panel:()=>s.ui()?.querySelector('.lf-fs-speed-panel'),
    rateButton:rate=>s.ui()?.querySelector('[data-rate="'+rate+'"]'),
    key(node,key,extra={}){const event=new s.win.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra});node.dispatchEvent(event);return event;},
    pointerClick(node,type='touch'){const event=new s.win.Event('pointerdown',{bubbles:true});event.pointerType=type;node.dispatchEvent(event);node.dispatchEvent(new s.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));}};
}
test('speed picker shows actual rate and applies one explicit media-rate change without altering playback, pitch or defaults',t=>{
  for(const paused of [false,true]){
    const s=speedSetup(t,{paused,nativeSetup(video){video.preservesPitch=false;}});
    assert.equal(s.speed().textContent,'1×');assert.equal(s.speed().getAttribute('aria-haspopup'),'menu');
    assert.equal(s.panel().hidden,true);s.speed().click();
    assert.equal(s.panel().getAttribute('role'),'menu');assert.equal(s.panel().hidden,false);
    assert.equal(s.doc.activeElement,s.rateButton(1));assert.equal(s.rateButton(1).getAttribute('aria-checked'),'true');
    s.rateButton(1.5).click();
    assert.equal(s.video.playbackRate,1.5);assert.equal(s.speed().textContent,'1,5×');
    assert.equal(s.rateButton(1.5).getAttribute('aria-checked'),'true');assert.equal(s.panel().hidden,true);
    assert.equal(s.doc.activeElement,s.speed());assert.equal(s.video.defaultPlaybackRate,1);assert.equal(s.video.preservesPitch,false);
    assert.equal(s.video.currentTime,40);assert.equal(s.paused(),paused);assert.deepEqual(s.calls,[]);
  }
});
test('external ratechange stays authoritative including nonpreset values and does not move keyboard focus',t=>{
  const s=speedSetup(t);s.speed().click();const selected=s.doc.activeElement;
  s.video.playbackRate=1.75;s.video.dispatchEvent(new s.win.Event('ratechange'));
  assert.equal(s.speed().textContent,'1,75×');assert.equal(s.rateButton(1.75).getAttribute('aria-checked'),'true');
  assert.equal(s.rateButton(1).getAttribute('aria-checked'),'false');assert.equal(s.doc.activeElement,selected);
  s.video.playbackRate=1.33;s.video.dispatchEvent(new s.win.Event('ratechange'));
  assert.equal(s.speed().textContent,'1,33×');assert.equal(s.panel().querySelector('[aria-checked=true]'),null);
  const observer=new s.win.MutationObserver(()=>{});observer.observe(s.panel(),{subtree:true,attributes:true,childList:true});
  s.video.dispatchEvent(new s.win.Event('timeupdate'));assert.equal(observer.takeRecords().length,0);observer.disconnect();
  assert.equal(s.video.currentTime,40);assert.deepEqual(s.calls,[]);
});
test('keyboard menu navigation restores focus, Escape preserves fullscreen and Tab resumes the existing control order',t=>{
  const s=speedSetup(t);s.speed().focus();s.key(s.speed(),'ArrowDown');
  assert.equal(s.doc.activeElement,s.rateButton(1));s.key(s.doc.activeElement,'ArrowDown');
  assert.equal(s.doc.activeElement,s.rateButton(1.5));s.key(s.doc.activeElement,'ArrowLeft');assert.equal(s.doc.activeElement,s.rateButton(1.25));
  s.key(s.doc.activeElement,'End');assert.equal(s.doc.activeElement,s.rateButton(2));s.key(s.doc.activeElement,'Home');assert.equal(s.doc.activeElement,s.rateButton(.75));
  const escape=s.key(s.doc.activeElement,'Escape');assert.equal(escape.defaultPrevented,true);
  assert.equal(s.panel().hidden,true);assert.equal(s.doc.activeElement,s.speed());assert.equal(s.win.__langformFullscreen.isOpen(),true);
  s.speed().click();s.key(s.doc.activeElement,'Tab');assert.equal(s.panel().hidden,true);
  assert.equal(s.doc.activeElement,s.ui().querySelector('.lf-fs-time [data-action=exit]'));
  assert.equal(s.video.playbackRate,1,'navigation alone never changes tempo');
});
test('touch and mouse speed selection allow normal auto-hide while keyboard selection retains visible focus',t=>{
  for(const mode of ['touch','mouse','keyboard']){
    const s=speedSetup(t);s.speed().focus();
    if(mode==='keyboard'){s.key(s.speed(),'ArrowDown');s.rateButton(1.25).click();}
    else{s.pointerClick(s.speed(),mode);assert.equal([...s.timers.values()].some(t=>t.delay===3000),false,'open menu holds controls');s.pointerClick(s.rateButton(1.25),mode);}
    assert.equal(s.video.playbackRate,1.25);assert.equal(s.panel().hidden,true);
    const idle=[...s.timers.values()].find(t=>t.delay===3000);
    if(mode==='keyboard'){assert.equal(idle,undefined);assert.equal(s.doc.activeElement,s.speed());}
    else{assert.ok(idle,mode+' release schedules normal controls timeout');idle.fn();assert.equal(s.ui().hasAttribute('data-hidden'),true);}
  }
});
test('unsupported rate setters retain the actual value and announce a bounded error without seeking or starting media',t=>{
  for(const behavior of ['throws','ignored','clamped']){
    let actual=1;
    const s=speedSetup(t,{nativeSetup(video){Object.defineProperty(video,'playbackRate',{get:()=>actual,set:value=>{if(behavior==='throws')throw Error('NotSupported');if(behavior==='clamped')actual=1.25;}});}});
    s.speed().click();s.rateButton(2).click();
    assert.equal(s.video.playbackRate,actual);assert.equal(s.speed().textContent,actual===1?'1×':'1,25×');assert.equal(s.panel().hidden,false);
    assert.equal(s.rateButton(2).getAttribute('aria-checked'),'false');
    const message=s.panel().querySelector('[role=status]');assert.equal(message.hidden,false);assert.match(message.textContent,/nicht unterstützt|weiterhin/);
    assert.equal(s.video.currentTime,40);assert.deepEqual(s.calls,[]);
  }
});
test('live, unready, invalid-rate and failed media cannot present usable tempo choices',t=>{
  for(const kind of ['live','unready','rate','error']){
    const s=speedSetup(t);s.speed().click();
    if(kind==='live')s.video.duration=Infinity;
    else if(kind==='unready')s.video.readyState=0;
    else if(kind==='rate')Object.defineProperty(s.video,'playbackRate',{value:NaN});
    else Object.defineProperty(s.video,'error',{value:{code:3}});
    s.video.dispatchEvent(new s.win.Event(kind==='error'?'error':'loadedmetadata'));
    assert.equal(s.speed().disabled,true);assert.equal(s.panel().hidden,true);assert.equal(s.doc.activeElement,s.button('play'));
    s.speed().click();s.rateButton(2).click();assert.equal(s.panel().hidden,true);assert.deepEqual(s.calls,[]);
  }
});
test('speed popup and chapters dismiss each other, outside taps dismiss once, and stale menu nodes cannot affect another video',async t=>{
  const s=speedSetup(t,{nativeSetup(video,root,win){
    const entries=[{start:0,title:'Intro'},{start:60,title:'Kapitel'}];
    win.ytInitialPlayerResponse={videoDetails:{videoId:'abcdefghijk'}};
    win.document.documentElement.__langformChapterList=entries;win.document.documentElement.__langformChapterVideoID='abcdefghijk';
    win.eval(fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/FullscreenChapters.js'),'utf8'));
  }});
  const chapter=s.ui().querySelector('.lf-fs-chapter-label'),chapterPanel=s.ui().querySelector('.lf-fs-chapter-panel');
  chapter.click();assert.equal(chapterPanel.hidden,false);s.speed().click();assert.equal(chapterPanel.hidden,true);assert.equal(s.panel().hidden,false);
  chapter.click();assert.equal(s.panel().hidden,true);assert.equal(chapterPanel.hidden,false);
  s.speed().click();s.pointerClick(s.ui());assert.equal(s.panel().hidden,true);assert.equal(s.ui().hasAttribute('data-hidden'),false,'outside tap only dismisses the popup');
  s.speed().click();const stale=s.rateButton(2);s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');stale.click();
  assert.equal(s.ui(),null);assert.equal(s.video.playbackRate,1);assert.equal(s.video.currentTime,40);
  s.win.history.replaceState({},'','/watch?v=abcdefghijk');s.enter();s.video.playbackRate=.75;s.video.dispatchEvent(new s.win.Event('ratechange'));
  stale.click();assert.equal(s.video.playbackRate,.75);assert.equal(s.ui().querySelector('.lf-fs-speed-button').textContent,'0,75×');
  s.win.dispatchEvent(new s.win.Event('pagehide'));assert.equal(s.doc.querySelector('.lf-fs-speed-panel'),null);assert.equal(s.video.playbackRate,.75,'teardown never writes a stored preference');
});

test('speed keyboard handlers close stale or ad-owned fullscreen before handling arrows or Escape',t=>{
  for(const target of ['trigger','menu'])for(const invalid of ['identity','ad'])for(const key of ['ArrowDown','Escape']){
    const s=speedSetup(t);if(target==='menu')s.speed().click();const node=target==='menu'?s.rateButton(1):s.speed();
    if(invalid==='identity')s.root.getVideoData=()=>({video_id:'zyxwvutsrqp'});else s.root.classList.add('ad-showing');
    s.key(node,key);assert.equal(s.ui(),null,target+'/'+invalid+'/'+key);
    assert.equal(s.video.playbackRate,1);assert.equal(s.video.currentTime,40);assert.deepEqual(s.calls,[]);
  }
});
test('steady playback does not reread speed-control attributes or add redundant player-identity checks',t=>{
  const s=speedSetup(t),getData=s.root.getVideoData;let dataReads=0,attributeReads=0;
  s.root.getVideoData=()=>{dataReads++;return getData();};
  for(const node of [s.speed(),...s.panel().querySelectorAll('[data-rate]')]){
    const get=node.getAttribute;node.getAttribute=function(name){attributeReads++;return get.call(this,name);};
  }
  for(let i=0;i<60;i++)s.video.dispatchEvent(new s.win.Event('timeupdate'));
  assert.equal(attributeReads,0,'unchanged rate and availability need no speed DOM reads');
  assert.equal(dataReads,240,'existing fullscreen and seek ownership guards remain, speed reuses their validated update');
  s.video.playbackRate=1.75;s.video.dispatchEvent(new s.win.Event('ratechange'));
  assert.equal(s.speed().textContent,'1,75×');assert.equal(s.rateButton(1.75).getAttribute('aria-checked'),'true');
});

test('cancelled or unrelated pointer gestures cannot downgrade a later assistive speed-menu activation',t=>{
  for(const ending of ['cancel','other-target','chapters']){
    const s=speedSetup(t);s.speed().focus();
    s.speed().dispatchEvent(new s.win.Event('pointerdown',{bubbles:true}));
    if(ending==='cancel')s.win.dispatchEvent(new s.win.Event('pointercancel'));
    else if(ending==='other-target')s.ui().dispatchEvent(new s.win.Event('pointerdown',{bubbles:true}));
    else{
      const chapterButton=s.doc.createElement('button');s.ui().querySelector('.lf-fs-chapters').appendChild(chapterButton);chapterButton.click();
    }
    s.speed().click();assert.equal(s.panel().hidden,false);assert.equal(s.doc.activeElement,s.rateButton(1),ending);
    assert.equal(s.video.playbackRate,1);
  }
});

test('native drag and Mini ownership reject a second native fullscreen presentation without changing media', t => {
  for (const mode of ['drag','mini']) {
    let calls=0, own=true;
    const s=setup(t,{nativeSetup(video,root,win) {
      video.webkitEnterFullscreen=()=>{calls++;}; root.requestFullscreen=()=>{calls++;return Promise.resolve('native');};
      win.__langformIsNativeDragging=()=>mode==='drag'&&own;
      win.__langformStageInsets={nativeMini:mode==='mini'};
    }});
    const before=[s.root.getAttribute('style'),s.video.getAttribute('style'),s.video.currentTime];
    s.video.webkitEnterFullscreen();s.root.requestFullscreen();
    assert.equal(calls,0,mode+' must not open native AV fullscreen over its card');
    assert.equal(s.ui(),null);assert.deepEqual([s.root.getAttribute('style'),s.video.getAttribute('style'),s.video.currentTime],before);
    own=false;s.win.__langformStageInsets.nativeMini=false;
    s.video.webkitEnterFullscreen();assert.equal(calls,1,'released ownership preserves original API fallback');
  }
});

test('native stage fullscreen guard leaves ads, foreign receivers and unconfirmed ownership with the original API',t=>{
  const cases=['ad','mismatched-id','detached-video','replaced-video','wrong-receiver','no-bridge','non-watch','already-native'];
  for(const kind of cases){
    let calls=0;
    const s=setup(t,{nativeSetup(video,root,win){video.webkitEnterFullscreen=()=>{calls++;return 'native';};win.__langformIsNativeDragging=()=>true;win.__langformStageInsets={nativeMini:true};}});
    const wrapped=s.video.webkitEnterFullscreen;let receiver=s.video;
    if(kind==='ad')s.root.classList.add('ad-showing');
    if(kind==='mismatched-id')s.root.getVideoData=()=>({video_id:'another-id'});
    if(kind==='detached-video')s.video.remove();
    if(kind==='replaced-video')s.video.replaceWith(s.video.cloneNode());
    if(kind==='wrong-receiver')receiver=s.doc.createElement('video');
    if(kind==='no-bridge')delete s.win.webkit.messageHandlers.langformFullscreen;
    if(kind==='non-watch')s.win.history.replaceState({},'', '/');
    if(kind==='already-native')s.video.webkitDisplayingFullscreen=true;
    assert.equal(wrapped.call(receiver),'native',kind+' retains native fallback');
    assert.equal(calls,1);assert.equal(s.ui(),null);
  }
});


test('after releasing native drag and Mini ownership explicit fullscreen enters the custom player again',t=>{
  let native=0,drag=true,activation=true;
  const s=setup(t,{nativeSetup(video,root,win){
    video.webkitEnterFullscreen=()=>{native++;};
    win.__langformIsNativeDragging=()=>drag;win.__langformStageInsets={nativeMini:true};
    Object.defineProperty(win.navigator,'userActivation',{value:{get isActive(){return activation;}}});
  }});
  s.video.webkitEnterFullscreen();assert.equal(native,0);assert.equal(s.ui(),null,'active user token cannot open a second player during native ownership');
  drag=false;s.win.__langformStageInsets.nativeMini=false;
  s.video.webkitEnterFullscreen();assert.ok(s.ui());assert.equal(native,0);
  assert.equal(s.win.__langformFullscreen.isOpen(),true);
});

function rotationSetup(t, options = {}) {
  const s = setup(t,options);
  Object.defineProperty(s.doc,'hidden',{value:false,configurable:true});
  Object.defineProperties(s.video,{videoWidth:{value:640,configurable:true},videoHeight:{value:360,configurable:true}});
  const box = {x:0,y:110,left:0,top:110,right:390,bottom:330,width:390,height:220};
  s.root.getBoundingClientRect = () => box;
  s.video.getBoundingClientRect = () => box;
  s.win.__langformMeasureVideo = () => ({playerVideoID:'abcdefghijk',hasVideo:true,mediaReady:true,navigationToken:''});
  return s;
}
test('physical fullscreen entry uses the current transaction without touch activation or playback changes',t=>{
  const s=rotationSetup(t),parent=s.video.parentElement,source=s.video.src;
  Object.defineProperty(s.win.navigator,'userActivation',{value:{isActive:false}});
  assert.equal(s.win.__langformFullscreen.enter('abcdefghijk',true,{contact:{}}),true);
  assert.ok(s.ui());assert.equal(s.win.__langformFullscreen.isOpen(),true);
  assert.equal(s.video.parentElement,parent);assert.equal(s.video.src,source);
  assert.equal(s.video.currentTime,40);assert.deepEqual(s.calls,[]);
  assert.equal(s.win.__langformFullscreen.enter('abcdefghijk'),false,'a duplicate never toggles fullscreen off');
  assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),true);
  assert.equal(s.ui(),null);assert.equal(s.video.currentTime,40);assert.deepEqual(s.calls,[]);
});
test('physical entry and exit preserve a deliberately paused video',t=>{
  const s=rotationSetup(t,{paused:true});
  assert.equal(s.win.__langformFullscreen.enter('abcdefghijk',true,{contact:{}}),true);
  assert.equal(s.paused(),true);
  assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),true);
  assert.equal(s.paused(),true);assert.deepEqual(s.calls,[]);
});
test('physical fullscreen entry rejects absent, foreign, stale, hidden, ad and busy owners',t=>{
  const variants=['wrong-id','no-id','no-bridge','hidden-document','non-watch','missing-root','detached-video','foreign-data','missing-data','ad-data','ad-class','native-fullscreen','not-ready','no-dimensions','media-error','seeking','mini','native-drag','overlay','hidden-root','inert-root','transparent-ancestor','offscreen','missing-report','stale-report','not-ready-report','incomplete-navigation'];
  for(const kind of variants){
    const s=rotationSetup(t);let id='abcdefghijk';
    if(kind==='wrong-id')id='zyxwvutsrqp';
    if(kind==='no-id')id='';
    if(kind==='no-bridge')delete s.win.webkit.messageHandlers.langformFullscreen;
    if(kind==='hidden-document')Object.defineProperty(s.doc,'hidden',{value:true});
    if(kind==='non-watch')s.win.history.replaceState({},'', '/');
    if(kind==='missing-root')s.root.remove();
    if(kind==='detached-video')s.video.remove();
    if(kind==='foreign-data')s.root.getVideoData=()=>({video_id:'zyxwvutsrqp'});
    if(kind==='missing-data')s.root.getVideoData=()=>null;
    if(kind==='ad-data')s.root.getVideoData=()=>({video_id:id,isAd:'ad'});
    if(kind==='ad-class')s.root.classList.add('ad-showing');
    if(kind==='native-fullscreen')s.video.webkitDisplayingFullscreen=true;
    if(kind==='not-ready')s.video.readyState=1;
    if(kind==='no-dimensions')Object.defineProperty(s.video,'videoWidth',{value:0});
    if(kind==='media-error')Object.defineProperty(s.video,'error',{value:{code:3}});
    if(kind==='seeking')Object.defineProperty(s.video,'seeking',{value:true});
    if(kind==='mini')s.win.__langformStageInsets={nativeMini:true};
    if(kind==='native-drag')s.win.__langformIsNativeDragging=()=>true;
    if(kind==='overlay')s.win.__langformHasOpenOverlay=()=>true;
    if(kind==='hidden-root')s.root.hidden=true;
    if(kind==='inert-root')s.root.setAttribute('inert','');
    if(kind==='transparent-ancestor')s.root.parentElement.style.opacity='0';
    if(kind==='offscreen')s.video.getBoundingClientRect=()=>({x:0,y:-400,left:0,top:-400,right:390,bottom:-180,width:390,height:220});
    if(kind==='missing-report')delete s.win.__langformMeasureVideo;
    if(kind==='stale-report')s.win.__langformMeasureVideo=()=>({playerVideoID:'zyxwvutsrqp',hasVideo:true,mediaReady:true});
    if(kind==='not-ready-report')s.win.__langformMeasureVideo=()=>({playerVideoID:id,hasVideo:true,mediaReady:false});
    if(kind==='incomplete-navigation')s.win.__langformMeasureVideo=()=>({playerVideoID:id,hasVideo:true,mediaReady:true,navigationToken:'4',navigationComplete:false,navigationMediaLoaded:true});
    assert.equal(s.win.__langformFullscreen.enter(id),false,kind);assert.equal(s.ui(),null,kind);assert.deepEqual(s.calls,[],kind);
  }
});
test('physical entry revalidates media source, main node, ads and navigation after synchronous readiness reads',t=>{
  for(const kind of ['source','video','root','route','ad','hidden','media-error']){
    const s=rotationSetup(t),report=s.win.__langformMeasureVideo;
    s.win.__langformMeasureVideo=()=>{
      if(kind==='source')s.video.src='https://example.test/foreign-source';
      if(kind==='video')s.video.replaceWith(s.video.cloneNode());
      if(kind==='root')s.root.replaceWith(s.root.cloneNode(true));
      if(kind==='route')s.win.history.replaceState({},'', '/watch?v=zyxwvutsrqp');
      if(kind==='ad')s.root.classList.add('ad-interrupting');
      if(kind==='hidden')Object.defineProperty(s.doc,'hidden',{value:true});
      if(kind==='media-error')Object.defineProperty(s.video,'error',{value:{code:3}});
      return report();
    };
    assert.equal(s.win.__langformFullscreen.enter('abcdefghijk'),false,kind);assert.equal(s.ui(),null,kind);assert.deepEqual(s.calls,[],kind);
  }
});
test('physical fullscreen movement waits for real contact release including multi-touch and pointer cancellation',t=>{
  for(const family of ['pointer','touch']){
    const s=rotationSetup(t);
    function contact(name, contacts){const event=new s.win.Event(name,{bubbles:true});if(family==='pointer')Object.defineProperty(event,'pointerId',{value:7});else Object.defineProperty(event,'touches',{value:contacts.map(identifier=>({identifier}))});s.video.dispatchEvent(event);}
    contact(family==='pointer'?'pointerdown':'touchstart',[7,8]);
    assert.equal(s.win.__langformFullscreen.enter('abcdefghijk'),false,family+' retains its initial contact');
    if(family==='touch'){contact('touchend',[8]);assert.equal(s.win.__langformFullscreen.enter('abcdefghijk'),false,'second finger still owns contact');}
    contact(family==='pointer'?'pointercancel':'touchcancel',[]);
    assert.equal(s.win.__langformFullscreen.enter('abcdefghijk'),true,family+' releases on cancellation');
    contact(family==='pointer'?'pointerdown':'touchstart',[7]);
    assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),false,family+' keeps active fullscreen contact');
    contact(family==='pointer'?'pointerup':'touchend',[]);
    assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),true,family+' permits portrait exit after release');
  }
});
test('physical portrait exit keeps open speed, chapter and zoom gestures and current media ownership',t=>{
  for(const kind of ['speed','chapters','zoom','foreign-id','ad','source-after-read']){
    const s=rotationSetup(t);
    if(kind==='chapters')s.win.__langformFullscreenChapters={mount:()=>({isOpen:()=>true,update:()=>{},close:()=>{},destroy:()=>{}})};
    assert.equal(s.win.__langformFullscreen.enter('abcdefghijk',true,{contact:{}}),true);
    Object.defineProperty(s.video,'seeking',{value:true});
    if(kind==='speed')s.ui().querySelector('.lf-fs-speed-button').click();
    if(kind==='zoom')s.win.__langformPlaybackZoom={getState:()=>({gesturing:true})};
    if(kind==='foreign-id')s.root.getVideoData=()=>({video_id:'zyxwvutsrqp'});
    if(kind==='ad')s.root.classList.add('ad-showing');
    if(kind==='source-after-read'){const report=s.win.__langformMeasureVideo;s.win.__langformMeasureVideo=()=>{s.video.src='https://example.test/new';return report();};}
    assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),false,kind);
    assert.deepEqual(s.calls,[],kind);
  }
});
test('physical portrait exit permits current media seeking while subsequent entry still waits for it',t=>{
  for(const paused of [false,true]){
    const s=rotationSetup(t,{paused});
    assert.equal(s.win.__langformFullscreen.enter('abcdefghijk',true,{contact:{}}),true);
    Object.defineProperty(s.video,'seeking',{value:true,writable:true});
    const time=s.video.currentTime;
    assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),true,'same current fullscreen exit does not require seeked');
    assert.equal(s.ui(),null);
    assert.equal(s.video.currentTime,time);assert.equal(s.video.paused,paused);assert.deepEqual(s.calls,[]);
    assert.equal(s.win.__langformFullscreen.enter('abcdefghijk'),false,'seeking still guards a new entry');
    s.video.seeking=false;
    assert.equal(s.win.__langformFullscreen.enter('abcdefghijk'),true,'entry is available after the actual seek ends');
  }
});
test('physical portrait exit does not reverse an uncommitted fullscreen entry or exit',t=>{
  const s=rotationSetup(t);s.win.__langformFullscreenEnterProtocol=1;s.win.__langformFullscreenExitProtocol=1;
  assert.equal(s.win.__langformFullscreen.enter('abcdefghijk',true,{contact:{}}),true);
  assert.equal(s.ui().hasAttribute('data-entering'),true);
  assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),false);
  assert.equal(s.ui().hasAttribute('data-entering'),true);assert.deepEqual(s.calls,[]);
});

test('native portrait-up entry allows the released pan contact queue but keeps all live owner guards',t=>{
  const s=rotationSetup(t);
  const event=new s.win.Event('touchstart',{bubbles:true});Object.defineProperty(event,'touches',{value:[{identifier:5}]});s.video.dispatchEvent(event);
  assert.equal(s.win.__langformFullscreen.enter('abcdefghijk'),false,'physical rotation still waits for contact');
  s.win.__langformIsNativeDragging=()=>true;
  assert.equal(s.win.__langformFullscreen.enterForGesture('abcdefghijk'),false,'native input lock must release first');
  s.win.__langformIsNativeDragging=()=>false;
  assert.equal(s.win.__langformFullscreen.enterForGesture('abcdefghijk'),true);
  assert.equal(s.video.currentTime,40);assert.deepEqual(s.calls,[]);
});
for(const family of ['pointer','touch'])test(`free fullscreen ${family} downward swipe exits once at release and never toggles playback`,t=>{
  const s=setup(t,{nativeSetup:(v,r,w)=>{if(family==='pointer')w.PointerEvent=w.MouseEvent;}});s.enter();const ui=s.ui();
  function fire(type,x,y,target=ui,id=1){const e=new s.win.Event(type,{bubbles:true,cancelable:true});if(family==='pointer')Object.assign(e,{pointerType:'touch',pointerId:id,isPrimary:id===1,clientX:x,clientY:y});else{const ended=/end|cancel/.test(type);Object.defineProperties(e,{touches:{value:ended?[]:[{identifier:id,clientX:x,clientY:y}]},changedTouches:{value:[{identifier:id,clientX:x,clientY:y}]}});}target.dispatchEvent(e);return e;}
  const names=family==='pointer'?['pointerdown','pointermove','pointerup']:['touchstart','touchmove','touchend'];
  fire(names[0],150,120);assert.ok(s.ui());fire(names[1],155,215);assert.ok(s.ui(),'wait until real release');
  assert.equal(fire(names[2],155,215).defaultPrevented,true);assert.equal(s.ui(),null);assert.equal(s.video.currentTime,40);assert.deepEqual(s.calls,[]);
  const click=new s.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1,clientX:155,clientY:215});
  Object.defineProperty(click,'target',{value:s.root});
  assert.equal(s.win.__langformConsumeFullscreenGestureClick(click),true);assert.equal(click.defaultPrevented,true);assert.equal(s.win.__langformConsumeFullscreenGestureClick(click),false,'one click only');
});
for(const family of ['pointer','touch'])test(`hidden fullscreen timeline cannot become a downward exit after browser retargeting (${family})`,t=>{
  const s=setup(t,{nativeSetup:(v,r,w)=>{if(family==='pointer')w.PointerEvent=w.MouseEvent;}});s.enter();const ui=s.ui();
  ui.setAttribute('data-hidden','');ui.querySelector('input').getBoundingClientRect=()=>({left:20,top:700,width:900,height:44,right:920,bottom:744});
  function fire(type,y){const e=new s.win.Event(type,{bubbles:true,cancelable:true});if(family==='pointer')Object.assign(e,{pointerType:'touch',pointerId:1,isPrimary:true,clientX:150,clientY:y});else{const ended=/end/.test(type);Object.defineProperties(e,{touches:{value:ended?[]:[{identifier:1,clientX:150,clientY:y}]},changedTouches:{value:[{identifier:1,clientX:150,clientY:y}]}});}ui.dispatchEvent(e);}
  const names=family==='pointer'?['pointerdown','pointermove','pointerup']:['touchstart','touchmove','touchend'];
  fire(names[0],720);fire(names[1],815);fire(names[2],815);
  assert.ok(s.ui(),'the strip keeps its owner even with invisible controls and an empty picture target');
  assert.equal(s.video.currentTime,40);assert.deepEqual(s.calls,[]);
});
for(const kind of ['cancel','up','horizontal','reversed','control','zoom','overlay','foreign-source'])test(`fullscreen downward swipe preserves ${kind} ownership`,t=>{
  const s=setup(t,{nativeSetup:(v,r,w)=>{w.PointerEvent=w.MouseEvent;}});s.enter();const ui=s.ui();
  function fire(type,x,y,target=ui,id=1){const e=new s.win.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{pointerType:'touch',pointerId:id,isPrimary:id===1,clientX:x,clientY:y});target.dispatchEvent(e);}
  if(kind==='zoom')s.win.__langformPlaybackZoom={getState:()=>({scale:1.8,gesturing:false})};
  if(kind==='overlay')s.win.__langformHasOpenOverlay=()=>true;
  const target=kind==='control'?s.button('play'):ui;
  fire('pointerdown',150,120,target);fire('pointermove',kind==='horizontal'?250:150,kind==='up'?20:220,target);
  if(kind==='foreign-source')s.video.src='https://example.test/new';
  fire(kind==='cancel'?'pointercancel':'pointerup',kind==='horizontal'?250:150,kind==='up'?20:kind==='reversed'?100:220,target);
  assert.ok(s.ui(),kind);assert.equal(s.video.currentTime,40);assert.deepEqual(s.calls,[]);
});

test('uncached exit reveals stable inline watch context alongside live handoff while player controls stay hidden and inert',async t=>{
  const s=exitHandoffPage(t),parent=s.video.parentElement,source=s.video.getAttribute('src');
  const host=s.doc.createElement('ytm-player');s.root.before(host);host.appendChild(s.root);
  const original=s.doc.createElement('button');original.className='player-settings-icon';host.appendChild(original);
  const header=addHeader(s,s.root.closest('main')),details=s.doc.createElement('section');details.textContent='Watch metadata';s.root.closest('main').appendChild(details);
  const reveals=[];s.win.Element.prototype.animate=function(frames,timing){const a={node:this,frames,timing,cancel(){},onfinish:null};reveals.push(a);return a;};
  await Promise.resolve();assert.ok(header.hasAttribute('data-langform-fullscreen-exit-context'));
  s.prepare();
  assert.equal(s.animations.length,1,'natural inline geometry starts the live handoff');
  assert.ok(s.ui(),'reveal is earlier than commit');assert.equal(s.messages.some(x=>x.kind==='exit-commit'),false);
  assert.equal(header.hasAttribute('data-langform-fullscreen-exit-context'),false,'stable watch chrome should not wait for media completion');
  assert.equal(details.hasAttribute('data-langform-fullscreen-exit-context'),false);
  assert.equal(reveals.length,0,'watch text must be present with its restored canvas, without a new opacity-zero interval');
  assert.ok(original.hasAttribute('data-langform-fullscreen-exit-context'),'original sibling controls remain suppressed');
  assert.ok(s.ui().inert);assert.ok(header.closest('[inert]'));assert.ok(details.closest('[inert]'));assert.ok(original.closest('[inert]'));
  s.confirm();s.finish();assert.equal(s.ui(),null);assert.equal(original.hasAttribute('data-langform-fullscreen-exit-context'),false);
  assert.ok(reveals.some(x=>x.node===original),'the original-player control fade still belongs to final commit');
  assert.ok(reveals.every(x=>!x.node.contains(s.video)&&x.node!==header&&x.node!==details));
  assert.equal(s.root.closest('main').hasAttribute('inert'),false);assert.equal(header.hasAttribute('inert'),false);
  assert.equal(s.video.parentElement,parent);assert.equal(s.video.getAttribute('src'),source);assert.equal(s.video.currentTime,40);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});

test('early exit watch reveal keeps hydrated siblings inert and re-hides on a mismatching viewport',async t=>{
  const s=exitHandoffPage(t),header=addHeader(s);await Promise.resolve();
  s.prepare();assert.equal(header.hasAttribute('data-langform-fullscreen-exit-context'),false);
  const hydrated=s.doc.createElement('header');hydrated.innerHTML='<button>Neue Suche</button>';s.doc.body.appendChild(hydrated);await Promise.resolve();
  assert.equal(hydrated.hasAttribute('data-langform-fullscreen-exit-context'),false,'hydrated watch context joins the already safe inline view');
  assert.ok(hydrated.hasAttribute('inert'),'new body branch is blocked until commit');
  s.resize(844,390);assert.ok(header.hasAttribute('data-langform-fullscreen-exit-context'));assert.ok(hydrated.hasAttribute('data-langform-fullscreen-exit-context'));
  s.resize(390,844);s.frame(2);assert.equal(header.hasAttribute('data-langform-fullscreen-exit-context'),false);assert.equal(hydrated.hasAttribute('data-langform-fullscreen-exit-context'),false);
  s.win.dispatchEvent(new s.win.Event('pagehide'));assert.equal(s.ui(),null);assert.equal(hydrated.hasAttribute('inert'),false);assert.equal(hydrated.hasAttribute('data-langform-fullscreen-exit-context'),false);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});

test('Reduce Motion preserves an early watch reveal without introducing a fade or releasing player input',async t=>{
  const s=exitHandoffPage(t),header=addHeader(s),reveals=[];
  s.win.Element.prototype.animate=function(){const a={cancelled:false,cancel(){this.cancelled=true;},onfinish:null};reveals.push(a);return a;};
  await Promise.resolve();s.prepare();assert.equal(reveals.length,0);assert.ok(s.ui());
  s.win.__testPreference.matches=true;s.win.__testPreference.dispatchEvent(new s.win.Event('change'));
  assert.ok(reveals.every(a=>a.cancelled));assert.equal(header.hasAttribute('data-langform-fullscreen-exit-context'),false);
  assert.ok(header.closest('[inert]'));assert.ok(s.ui().inert);s.frame(4);s.confirm();s.frame(4);
  assert.equal(s.ui(),null);assert.equal(header.hasAttribute('inert'),false);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});

function backdropExitPage(t, colors=true) {
  const s=handshakePage(t),nodes=[s.doc.documentElement,s.doc.body];
  if(colors){nodes[0].style.setProperty('background-color','rgb(248, 249, 250)','important');nodes[1].style.setProperty('background-color','white','');}
  const before=nodes.map(node=>[node.style.getPropertyValue('background-color'),node.style.getPropertyPriority('background-color'),node.hasAttribute('style')]);
  s.enter();s.resize(844,390);s.button('exit').click();
  const request=s.messages.find(row=>row.kind==='exit-request');
  const prepare=()=>{s.win.__langformFullscreen.prepareExit('abcdefghijk',request.token,390,844);s.resize(390,844);};
  const finish=()=>{s.win.__langformFullscreen.finishExit('abcdefghijk',request.token,390,844);for(let i=0;i<6;i++)s.frame();};
  const colorsNow=()=>nodes.map(node=>[node.style.getPropertyValue('background-color'),node.style.getPropertyPriority('background-color'),node.hasAttribute('style')]);
  const dark=()=>nodes.forEach(node=>{assert.equal(node.style.getPropertyValue('background-color'),'rgb(0, 0, 0)');assert.equal(node.style.getPropertyPriority('background-color'),'important');});
  return {...s,nodes,before,prepare,finish,colorsNow,dark};
}
for(const colors of [true,false])test('exit backdrop holds through native inline preparation and restores exact author colors and priorities; inline='+colors,t=>{
  const s=backdropExitPage(t,colors),parent=s.video.parentElement,src=s.video.getAttribute('src');
  s.dark();s.prepare();s.dark();s.frame();s.dark();s.frame();assert.deepEqual(s.colorsNow(),s.before,'author canvas returns with safe early context');assert.ok(s.ui());
  s.resize(844,390);s.dark();s.resize(390,844);s.frame();s.frame();assert.deepEqual(s.colorsNow(),s.before);
  s.finish();assert.equal(s.ui(),null);assert.deepEqual(s.colorsNow(),s.before);assert.equal(s.video.parentElement,parent);assert.equal(s.video.getAttribute('src'),src);assert.equal(s.video.currentTime,40);assert.deepEqual(s.calls,[]);
});
for(const cancel of ['pagehide','yt-navigate-start','explicit','timeout'])test('exit backdrop restores author paint after '+cancel,t=>{
  const s=backdropExitPage(t);s.prepare();s.dark();
  if(cancel==='explicit')s.win.__langformFullscreen.exit('abcdefghijk','cancelled');
  else if(cancel==='timeout')[...s.timers.values()].find(row=>row.delay===4000).fn();
  else s.win.dispatchEvent(new s.win.Event(cancel));
  assert.equal(s.ui(),null);assert.deepEqual(s.colorsNow(),s.before);s.frame();assert.deepEqual(s.colorsNow(),s.before);assert.equal(s.video.currentTime,40);assert.deepEqual(s.calls,[]);
});
test('exit backdrop preserves an intervening author color, priority and unrelated style on cancellation',t=>{
  const s=backdropExitPage(t);s.prepare();s.dark();
  s.nodes[0].style.setProperty('background-color','purple','important');s.nodes[1].style.setProperty('background-color','black','');s.nodes[1].style.setProperty('color','red','important');
  s.win.dispatchEvent(new s.win.Event('pagehide'));
  assert.equal(s.nodes[0].style.getPropertyValue('background-color'),'purple');assert.equal(s.nodes[0].style.getPropertyPriority('background-color'),'important');
  assert.equal(s.nodes[1].style.getPropertyValue('background-color'),'black');assert.equal(s.nodes[1].style.getPropertyPriority('background-color'),'');assert.equal(s.nodes[1].style.getPropertyValue('color'),'red');assert.equal(s.nodes[1].style.getPropertyPriority('color'),'important');
});
test('exit backdrop follows viewport reversal until reduced-motion completion and then restores paint',t=>{
  const s=exitHandoffPage(t),nodes=[s.doc.documentElement,s.doc.body];
  s.prepare();s.resize(844,390);nodes.forEach(n=>assert.equal(n.style.backgroundColor,'rgb(0, 0, 0)'));
  s.win.__testPreference.matches=true;s.win.__testPreference.dispatchEvent(new s.win.Event('change'));
  s.resize(390,844);s.frame(4);s.confirm();s.frame(4);
  assert.equal(s.ui(),null);nodes.forEach(n=>assert.equal(n.style.getPropertyValue('background-color'),''));assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
test('exit backdrop restores only its copied body lease after author subtree replacement',async t=>{
  const s=backdropExitPage(t);s.prepare();s.dark();const clone=s.doc.body.cloneNode(false);
  // JSDOM's clone parser drops the last !important; preserve the real CSSOM pair.
  clone.style.setProperty('background-color',s.doc.body.style.getPropertyValue('background-color'),s.doc.body.style.getPropertyPriority('background-color'));clone.appendChild(s.doc.createElement('main'));s.doc.body.replaceWith(clone);await Promise.resolve();await Promise.resolve();
  assert.equal(s.ui(),null);assert.equal(clone.style.getPropertyValue('background-color'),s.before[1][0]);assert.equal(clone.style.getPropertyPriority('background-color'),s.before[1][1]);assert.equal(clone.hasAttribute('data-langform-fullscreen-lease'),false);assert.deepEqual(s.colorsNow(),s.before);
});

test('exit backdrop releases author canvas before transparent black watch metadata becomes visible',async t=>{
  const s=exitHandoffPage(t),style=s.doc.createElement('style');style.textContent='html,body{background-color:white} .watch-details{color:black;background:transparent}';s.doc.head.appendChild(style);
  const details=s.doc.createElement('section');details.className='watch-details';details.textContent='Watch title';s.root.closest('main').appendChild(details);await Promise.resolve();
  assert.equal(painted(s,details),false);assert.equal(s.win.getComputedStyle(s.doc.body).backgroundColor,'rgb(0, 0, 0)');
  s.prepare();assert.ok(s.ui());assert.equal(painted(s,details),true);assert.equal(s.win.getComputedStyle(s.doc.body).backgroundColor,'rgb(255, 255, 255)');assert.equal(s.win.getComputedStyle(details).color,'rgb(0, 0, 0)');assert.equal(s.win.getComputedStyle(details).backgroundColor,'rgba(0, 0, 0, 0)');
  s.resize(844,390);assert.equal(painted(s,details),false);assert.equal(s.win.getComputedStyle(s.doc.body).backgroundColor,'rgb(0, 0, 0)');s.win.dispatchEvent(new s.win.Event('pagehide'));assert.equal(s.win.getComputedStyle(s.doc.body).backgroundColor,'rgb(255, 255, 255)');
});

test('opt-in exit paint trace separates a white covering ancestor from leased black document paint',t=>{
  const s=exitHandoffPage(t,{diagnostics:true}),main=s.root.closest('main');
  main.style.backgroundColor='white';main.getBoundingClientRect=()=>({left:0,top:0,right:844,bottom:844});
  const transparent=s.doc.createElement('div');transparent.style.backgroundColor='transparent';
  let hitReads=0;s.doc.elementsFromPoint=(x,y)=>{hitReads++;assert.equal(x,8);assert.equal(y,s.win.innerHeight*.75);return [transparent,main,s.doc.body,s.doc.documentElement];};
  Object.assign(s.videoNatural,{width:844,height:390});s.prepare();s.frame(10);
  const row=s.messages.filter(x=>x.kind==='geometry-trace').flatMap(x=>x.rows).at(-1);
  assert.equal(row.exitBackdropLeased,true);assert.equal(row.exitWatchContextVisible,false);assert.equal(row.exitRevealsActive,false);
  assert.equal(row.exitHTMLPaint,1);assert.equal(row.exitBodyPaint,1);assert.equal(row.exitHitPaint,2);assert.equal(row.exitAncestorPaint,2);
  assert.equal(row.exitHitDepth,2);assert.equal(row.exitHitRole,5);assert.equal(row.exitAncestorDepth,3);assert.equal(row.exitAncestorRole,5);
  assert.equal(hitReads,12);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
test('exit paint trace is disabled normally and bounds hit inspection to twelve fixed-enum rows',t=>{
  const normal=exitHandoffPage(t);normal.doc.elementsFromPoint=()=>{throw Error('normal runtime must not hit-test paint');};normal.prepare();normal.frame(20);
  assert.equal(normal.messages.some(row=>row.kind==='geometry-trace'),false);
  const s=exitHandoffPage(t,{diagnostics:true}),blank=s.doc.createElement('div');blank.style.backgroundColor='transparent';
  const hidden=s.doc.createElement('div');hidden.style.cssText='background:white;opacity:0';
  const white=s.doc.createElement('div');white.style.backgroundColor='white';
  const hits=[hidden,...Array(11).fill(blank),white];s.doc.elementsFromPoint=()=>hits;
  s.frame(12);const row=s.messages.filter(x=>x.kind==='geometry-trace').flatMap(x=>x.rows).at(-1);
  assert.equal(row.exitHitPaint,0);assert.equal(row.exitHitDepth,0);assert.equal(row.exitHitRole,0);
  const fields=Object.keys(row).filter(key=>/^exit(?:HTMLPaint|BodyPaint|Hit|Ancestor)/.test(key));
  assert.ok(fields.length>=8);assert.ok(fields.every(key=>Number.isInteger(row[key])&&row[key]>=0&&row[key]<=12));
  assert.equal(JSON.stringify(row).includes('background'),false);
});
test('exit paint trace records early watch reveal independently from still-hidden original controls',t=>{
  const s=exitHandoffPage(t,{diagnostics:true}),details=s.doc.createElement('section');s.root.closest('main').appendChild(details);
  details.animate=()=>({cancel(){},onfinish:null});
  s.prepare();s.frame(12);
  const row=s.messages.filter(x=>x.kind==='geometry-trace').flatMap(x=>x.rows).at(-1);
  assert.equal(row.exitContextHidden,true);assert.equal(row.exitWatchContextVisible,true);assert.equal(row.exitBackdropLeased,false);assert.equal(row.exitRevealsActive,false);
  assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});

test('opt-in trace distinguishes entered inline fallback from an accepted staged animation',t=>{
  const fallback=exitHandoffPage(t,{diagnostics:true});fallback.prepare();fallback.frame(12);
  const fallbackRows=fallback.messages.filter(row=>row.kind==='geometry-trace').flatMap(row=>row.rows);
  assert.ok(fallbackRows.some(row=>row.exitHandoffToInlineCalls>0),'the real fallback function entry is recorded');
  assert.ok(fallbackRows.every(row=>Number.isFinite(row.exitRequestEpochMilliseconds)&&row.exitRequestEpochMilliseconds>0));
  const staged=exitHandoffPage(t,{diagnostics:true,cached:true});assert.equal(stagedExit(staged),true);staged.frame(12);
  const stagedRows=staged.messages.filter(row=>row.kind==='geometry-trace').flatMap(row=>row.rows);
  assert.ok(stagedRows.every(row=>row.exitHandoffToInlineCalls===0),'accepted staged motion has an explicitly observed zero fallback entries');
  const motion=stagedRows.find(row=>Number.isFinite(row.exitAnimationCreatedEpochMilliseconds));
  assert.ok(motion);assert.ok(motion.exitAnimationCreatedEpochMilliseconds>=motion.exitRequestEpochMilliseconds);
  assert.equal(staged.timeWrites(),0);assert.deepEqual(staged.calls,[]);
});

test('exit geometry gets one bounded fresh diagnostic window at the actual delayed motion request',t=>{
  const s=exitHandoffPage(t,{diagnostics:true,cached:true});s.frame(170);
  const rows=()=>s.messages.filter(x=>x.kind==='geometry-trace').flatMap(x=>x.rows),before=rows().length;
  assert.ok(before>5&&before<=240);assert.equal(s.frames.size,0);
  assert.equal(stagedExit(s),true);s.frame(12);
  assert.ok(rows().length>before,'the expired request window must not miss the later real handoff');
  const motion=rows().filter(row=>row.traceMotionWindow===true);assert.equal(motion.length,12);
  assert.ok(motion.every(row=>row.documentMilliseconds<2600&&Number.isFinite(row.documentEpochMilliseconds)));
  s.frame(170);const after=rows().length;assert.ok(after<=480,'two finite windows, never an unbounded trace');
  assert.equal(stagedExit(s,13),true);s.frame(20);assert.equal(rows().length,after,'a repeated native motion request cannot extend diagnostics again');
  assert.equal(s.frames.size,0);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
for(const changed of ['token','source','route'])test('exit diagnostic window rejects a delayed mismatching '+changed,t=>{
  const s=exitHandoffPage(t,{diagnostics:true,cached:true});s.frame(170);
  const rows=()=>s.messages.filter(x=>x.kind==='geometry-trace').flatMap(x=>x.rows),before=rows().length;
  if(changed==='source')s.video.setAttribute('src','https://example.test/replacement');
  if(changed==='route')s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');
  const accepted=s.win.__langformFullscreen.prepareExitMotion('abcdefghijk',changed==='token'?'obsolete':s.request.token,390,844,s.win.Date.now()+300,12);
  if(changed!=='source')assert.equal(accepted,false); // The probe must not alter the existing media-motion decision.
  s.frame(20);assert.equal(rows().length,before);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});

function captionRefreshPage(t,options={}){
 const s=exitHandoffPage(t,options),container=s.doc.createElement('div'),caption=s.doc.createElement('div');container.className='ytp-caption-window-container';caption.className='caption-window';caption.style.fontSize='20px';container.appendChild(caption);s.root.appendChild(container);
 return {...s,container,caption};
}
test('inline caption refresh asks the original renderer once after stable layout and before reveal',t=>{
 const s=captionRefreshPage(t),calls=[];
 s.root.setSize=function(...args){calls.push({args,hidden:!painted(s,s.caption),rootFixed:s.root.hasAttribute('data-langform-fullscreen-player'),heldWidth:s.video.getBoundingClientRect().width});s.caption.style.fontSize='8px';};
 s.prepare();assert.equal(calls.length,1);assert.deepEqual(calls[0].args,[]);assert.equal(calls[0].hidden,true);assert.equal(calls[0].rootFixed,false);assert.ok(calls[0].heldWidth>600,'the held picture is not the sizing argument');assert.equal(s.caption.style.fontSize,'8px');assert.equal(painted(s,s.caption),false);assert.equal(s.animations.length,0,'post-resize layout must be reconfirmed');
 s.frame(2);assert.equal(s.animations.length,1);s.confirm();s.finish();assert.equal(s.ui(),null);assert.equal(s.caption.style.fontSize,'8px');assert.equal(calls.length,1);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
test('caption refresh reconfirms original resize geometry and never repeatedly calls setSize',t=>{
 const s=captionRefreshPage(t),calls=[];s.root.setSize=()=>{calls.push(1);Object.assign(s.videoNatural,{width:844,height:390});};s.prepare();assert.equal(calls.length,1);s.frame(6);assert.equal(s.animations.length,0);assert.equal(painted(s,s.caption),false);
 Object.keys(s.videoNatural).forEach(k=>delete s.videoNatural[k]);s.frame(4);assert.equal(s.animations.length,1);assert.equal(calls.length,1);
});
for(const kind of ['source','root','video','route','ad','hidden','cancel'])test('caption resize reentry rejects '+kind+' before revealing or committing old geometry',t=>{
 const s=captionRefreshPage(t);let calls=0;s.root.setSize=()=>{calls++;if(kind==='source')s.video.src='https://example.test/new';if(kind==='root')s.root.replaceWith(s.root.cloneNode(true));if(kind==='video')s.video.replaceWith(s.video.cloneNode());if(kind==='route')s.win.history.replaceState({},'', '/watch?v=zyxwvutsrqp');if(kind==='ad')s.root.classList.add('ad-showing');if(kind==='hidden')s.doc.hidden=true;if(kind==='cancel')s.win.__langformFullscreen.exit('abcdefghijk','cancelled');};
 s.prepare();assert.equal(calls,1);assert.equal(s.ui(),null);assert.equal(s.messages.some(m=>m.kind==='exit-commit'),false);assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
for(const kind of ['no-captions','no-api','foreign-source','unready','wrong-viewport'])test('caption refresh keeps '+kind+' outside its one-shot action',t=>{
 const s=captionRefreshPage(t);let calls=0;s.root.setSize=()=>{calls++;};if(kind==='no-captions')s.container.remove();if(kind==='no-api')delete s.root.setSize;if(kind==='foreign-source')s.video.src='https://example.test/new';if(kind==='unready')Object.assign(s.videoNatural,{width:844,height:390});
 if(kind==='wrong-viewport'){s.frame(3);}else s.prepare();assert.equal(calls,0);assert.deepEqual(s.calls,[]);
});
test('throwing original caption resize is attempted once and keeps exit available',t=>{
 const s=captionRefreshPage(t);let calls=0;s.root.setSize=()=>{calls++;throw Error('original resize unavailable')};s.prepare();s.frame(2);s.confirm();s.finish();assert.equal(s.ui(),null);assert.equal(calls,1);assert.deepEqual(s.calls,[]);
});
test('caption resize viewport reversal hides context until the current target settles',t=>{
 const s=captionRefreshPage(t);let calls=0;s.root.setSize=()=>{calls++;s.resize(844,390);};s.prepare();assert.equal(calls,1);assert.equal(painted(s,s.caption),false);assert.equal(s.animations.length,0);s.resize(390,844);s.frame(2);assert.equal(s.animations.length,1);s.confirm();s.finish();assert.equal(s.ui(),null);assert.equal(calls,1);
});

function nativePreviewLease(t,terminal='touchcancel',point={identifier:1,clientX:195,clientY:60}) {
 const s=previewContactPage(t);
 s.win.__langformMeasureVideo=()=>({playerVideoID:'abcdefghijk',hasVideo:true,mediaReady:true});
 s.fire('touchstart');s.preview();s.fire(terminal,s.video,[point]);
 // Native evaluateJavaScript also outlives the original dispatch's queued
 // contact cleanup. The separate lease must survive that zero-delay task.
 for(const [key,timer] of [...s.timers])if(timer.delay===0){s.timers.delete(key);timer.fn();}
 return s;
}
const stableNativePicture={x:0,y:107,width:390,height:219.375};
function nativeLeaseSnapshot(s) {return JSON.parse(JSON.stringify(s.win.__qaInlineDestination()));}
for(const frames of [0,18,240,299])test('Native geometry lease retains stable target after '+frames+' frames',t=>{
 const s=nativePreviewLease(t),visible=s.video.getBoundingClientRect();s.frame(frames);
 assert.equal(s.win.__langformFullscreen.enterForGesture('abcdefghijk'),true);
 assert.deepEqual(nativeLeaseSnapshot(s).picture,stableNativePicture,'native handoff must use the matching stable precontact target');
 assert.deepEqual(s.video.getBoundingClientRect(),visible,'live entry still starts from the actually visible1.25 preview');
 s.root.style.transform='scale(1)';assert.equal(s.exit(),true);s.finish();
 assert.deepEqual([s.video.getBoundingClientRect().x,s.video.getBoundingClientRect().y,s.video.getBoundingClientRect().width,s.video.getBoundingClientRect().height],[0,107,390,219.375]);
 assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
for(const invalid of ['expired','timer','new-contact','second-finger','route','resize','scroll','blur','hidden','real-hidden','pagehide','cleanup','source','ratio','root-replaced','video-replaced','insets','offset','wrong-origin','nonuniform','overscale','owner','native-fullscreen','overlay','mini','reentrant-measure','reentrant-style'])test('Native geometry lease rejects '+invalid,t=>{
 const s=nativePreviewLease(t);
 if(invalid==='expired')s.frame(301);
 if(invalid==='timer'){const timer=[...s.timers.values()].find(x=>x.delay===5000);assert.ok(timer);timer.fn();}
 if(invalid==='new-contact')s.fire('touchstart');
 if(invalid==='second-finger')s.fire('touchstart',s.video,[{identifier:1,clientX:195,clientY:180},{identifier:2,clientX:200,clientY:180}]);
 if(['route','resize','scroll','blur'].includes(invalid))s.win.dispatchEvent(new s.win.Event(invalid==='route'?'yt-navigate-start':invalid));
 if(invalid==='hidden'){s.doc.hidden=true;s.doc.dispatchEvent(new s.win.Event('visibilitychange'));s.doc.hidden=false;}
 if(invalid==='real-hidden'){s.win.__langformRealVisibility={inactive:()=>true};s.doc.dispatchEvent(new s.win.Event('langform-real-visibilitychange'));s.win.__langformRealVisibility.inactive=()=>false;}
 if(invalid==='pagehide')s.win.dispatchEvent(new s.win.Event('pagehide'));
 if(invalid==='cleanup')s.win.__langformFullscreen.exit('abcdefghijk');
 if(invalid==='source')s.video.src='https://example.test/replacement';
 if(invalid==='ratio')Object.defineProperty(s.video,'videoHeight',{value:1440,configurable:true});
 if(invalid==='root-replaced'){const root=s.root.cloneNode(true);s.root.replaceWith(root);}
 if(invalid==='video-replaced')s.video.replaceWith(s.video.cloneNode(true));
 if(invalid==='insets')s.win.__langformStageInsets.top=1;
 if(invalid==='offset')Object.defineProperty(s.win,'scrollY',{value:1,configurable:true});
 if(invalid==='wrong-origin')s.root.style.transformOrigin='top center';
 if(invalid==='nonuniform')s.root.style.transform='scale(1.25,1.2)';
 if(invalid==='overscale')s.preview(1.3);
 if(invalid==='owner')s.root.getVideoData=()=>({video_id:'zyxwvutsrqp'});
 if(invalid==='native-fullscreen')s.video.webkitDisplayingFullscreen=true;
 if(invalid==='overlay')s.win.__langformHasOpenOverlay=()=>true;
 if(invalid==='mini')s.win.__langformStageInsets.nativeMini=true;
 if(invalid==='reentrant-measure')s.win.__langformMeasureVideo=()=>{s.win.dispatchEvent(new s.win.Event('blur'));return {playerVideoID:'abcdefghijk',hasVideo:true,mediaReady:true};};
 if(invalid==='reentrant-style'){const original=s.win.getComputedStyle;let ran=false;s.win.getComputedStyle=node=>{const css=original(node);if(node===s.video&&!ran){ran=true;s.win.dispatchEvent(new s.win.Event('scroll'));}return css;};}
 const entered=s.win.__langformFullscreen.enterForGesture('abcdefghijk');
 if(entered)assert.notDeepEqual(nativeLeaseSnapshot(s).picture,stableNativePicture,'invalid geometry lease must not contribute the old target');
 else assert.equal(s.ui(),null);
 assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
for(const terminal of ['touchend','pointercancel','downward-cancel','horizontal-cancel'])test('Native geometry lease requires upward touchcancel '+terminal,t=>{
 let s;
 if(terminal==='pointercancel'){
   s=previewContactPage(t);s.win.__langformMeasureVideo=()=>({playerVideoID:'abcdefghijk',hasVideo:true,mediaReady:true});
   const fire=(type,y)=>{const e=new s.win.Event(type,{bubbles:true});Object.assign(e,{pointerType:'touch',pointerId:4,isPrimary:true,clientX:195,clientY:y});s.video.dispatchEvent(e);};
   fire('pointerdown',180);s.preview();fire('pointercancel',60);
 }else s=nativePreviewLease(t,terminal==='touchend'?'touchend':'touchcancel',{identifier:1,clientX:terminal==='horizontal-cancel'?320:195,clientY:terminal==='downward-cancel'?300:60});
 assert.equal(s.win.__langformFullscreen.enterForGesture('abcdefghijk'),true);
 assert.notDeepEqual(nativeLeaseSnapshot(s).picture,stableNativePicture);
});
test('Native geometry lease is one shot even when the first owner check rejects',t=>{
 const s=nativePreviewLease(t);s.win.__langformHasOpenOverlay=()=>true;
 assert.equal(s.win.__langformFullscreen.enterForGesture('abcdefghijk'),false);
 s.win.__langformHasOpenOverlay=()=>false;
 assert.equal(s.win.__langformFullscreen.enterForGesture('abcdefghijk'),true);
 assert.notDeepEqual(nativeLeaseSnapshot(s).picture,stableNativePicture);
});
test('Native geometry lease cannot authorize ordinary rotation after terminal dispatch',t=>{
 const s=nativePreviewLease(t);assert.equal(s.win.__langformFullscreen.enter('abcdefghijk',true,{contact:{}}),true);
 assert.notDeepEqual(nativeLeaseSnapshot(s).picture,stableNativePicture);
});
test('Native geometry lease leaves original synchronous touchcancel intact',t=>{
 const s=previewContactPage(t);s.fire('touchstart');s.preview();s.enterAtTerminal('touchcancel');
 assert.deepEqual(nativeLeaseSnapshot(s).picture,stableNativePicture);assert.equal(s.exit(),true);
});

for(const invalid of ['last-owner-blur','last-owner-expiry'])test('Native geometry lease rejects final owner reentry '+invalid,t=>{
 const s=nativePreviewLease(t);let ownedReads=0,invalidated=false;
 s.root.getVideoData=()=>{
   const stack=new Error().stack||'';
   if(stack.includes('nativeInlineContactMatches')){
     ownedReads++;
     if(ownedReads===4){invalidated=true;if(invalid==='last-owner-blur')s.win.dispatchEvent(new s.win.Event('blur'));
       else Object.defineProperty(s.win.performance,'now',{configurable:true,value:()=>10000});}
   }
   return {video_id:'abcdefghijk'};
 };
 const entered=s.win.__langformFullscreen.enterForGesture('abcdefghijk');
 assert.equal(invalidated,true,'final owner callback actually invalidated generation/age');
 if(entered)assert.notDeepEqual(nativeLeaseSnapshot(s).picture,stableNativePicture,'a lease invalidated in the final owner callback must not contribute its stable target');
 assert.equal(s.timeWrites(),0);assert.deepEqual(s.calls,[]);
});
