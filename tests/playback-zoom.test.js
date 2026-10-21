const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(process.env.LANGFORM_ZOOM_TEST_SOURCE || path.join(__dirname,'../ios/Langform/Langform/PlaybackZoom.js'),'utf8');
const fullscreen=fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/FullscreenMotion.js'),'utf8');
const hold=fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/PlaybackHold.js'),'utf8');
const box=(x,y,width,height)=>({x,y,left:x,top:y,right:x+width,bottom:y+height,width,height});
function setup(t,options={}){
  const dom=new JSDOM('<!doctype html><html><head></head><body><main><div id="movie_player"><div class="html5-video-container"><video class="html5-main-video" src="https://example.test/a"></video></div><button class="ytp-fullscreen-button">Vollbild</button></div></main><p id="copy">Copy outside</p></body></html>',{url:'https://m.youtube.com/watch?v=abcdefghijk',runScripts:'outside-only',pretendToBeVisual:true});
  const win=dom.window,doc=win.document,root=doc.getElementById('movie_player'),video=root.querySelector('video'),container=video.parentElement;
  const errors=[];win.addEventListener('error',event=>{errors.push(event.message);event.preventDefault();});
  t.after(()=>{win.dispatchEvent(new win.Event('pagehide'));assert.deepEqual(errors,[]);win.close();});
  Object.defineProperties(win,{innerWidth:{value:874,writable:true},innerHeight:{value:402,writable:true}});
  if(!options.touch)win.PointerEvent=win.MouseEvent;
  win.scrollTo=()=>{};
  let actualID='abcdefghijk';root.getVideoData=()=>({video_id:actualID,title:'Video'});
  Object.defineProperties(video,{videoWidth:{value:options.iw || 1920,writable:true},videoHeight:{value:options.ih || 1080,writable:true},
    readyState:{value:4,writable:true},paused:{value:!!options.paused,writable:true},ended:{value:false,writable:true},duration:{value:120,writable:true},currentTime:{value:30,writable:true},playbackRate:{value:1,writable:true},error:{value:null,writable:true},currentSrc:{get:()=>video.src,configurable:true}});
  root.getBoundingClientRect=()=>root.hasAttribute('data-langform-fullscreen-player')?box(0,0,win.innerWidth,win.innerHeight):box(0,110,402,226.125);
  video.getBoundingClientRect=()=>root.getBoundingClientRect();
  const messages=[],calls=[],timers=new Map();let serial=0;
  win.setTimeout=(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;};win.clearTimeout=id=>timers.delete(id);
  win.webkit={messageHandlers:{langformFullscreen:{postMessage:value=>messages.push(value)}}};
  win.__langformTogglePlayback=id=>{calls.push(['toggle',id]);video.paused=!video.paused;video.dispatchEvent(new win.Event(video.paused?'pause':'play'));return true;};
  win.__langformPlay=id=>{calls.push(['play',id]);video.paused=false;video.dispatchEvent(new win.Event('play'));return true;};
  win.__langformFullscreenDiagnostics=options.diagnostics;
  win.eval(source);win.__langformFullscreenDiagnostics=false;if(options.hold)win.eval(hold);win.eval(fullscreen);
  const enter=()=>root.querySelector('.ytp-fullscreen-button').click();
  const ui=()=>doc.getElementById('langform-fullscreen-ui');
  const state=()=>win.__langformPlaybackZoom.getState();
  const pointer=(type,id,x,y,target=ui(),extra={})=>{const event=new win.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{pointerType:'touch',pointerId:id,button:0,clientX:x,clientY:y,isPrimary:id===1,...extra});target.dispatchEvent(event);return event;};
  const touch=(type,points,target=ui(),changed=[])=>{const event=new win.Event(type,{bubbles:true,cancelable:true});Object.defineProperties(event,{touches:{value:points.map(([id,x,y,node])=>({identifier:id,clientX:x,clientY:y,target:node || target}))},changedTouches:{value:changed.map(([id,x,y])=>({identifier:id,clientX:x,clientY:y,target}))}});target.dispatchEvent(event);return event;};
  const pinch=(scale=2,cx=437,cy=100)=>{pointer('pointerdown',1,cx-50,cy);pointer('pointerdown',2,cx+50,cy);pointer('pointermove',1,cx-50*scale,cy);pointer('pointermove',2,cx+50*scale,cy);pointer('pointerup',1,cx-50*scale,cy);pointer('pointerup',2,cx+50*scale,cy);};
  return{win,doc,root,video,container,enter,ui,state,pointer,touch,pinch,messages,calls,timers,actualID:id=>{actualID=id;}};
}
function closeTo(actual,expected,message){assert.ok(Math.abs(actual-expected)<.0001,`${message || ''}: ${actual} ≈ ${expected}`);}
function fields(state){return state && [state.scale,state.x,state.y];}

test('zoom is limited to a committed custom fullscreen; original page and single short tap retain their behavior',t=>{
  const s=setup(t);assert.equal(s.state(),null);
  s.pointer('pointerdown',1,100,150,s.video);assert.equal(s.win.__langformPlaybackZoom.getLayoutRect(s.video),null);
  s.enter();assert.deepEqual(fields(s.state()),[1,0,0]);
  const down=s.pointer('pointerdown',1,350,100),up=s.pointer('pointerup',1,350,100);assert.equal(down.defaultPrevented,false);assert.equal(up.defaultPrevented,false);
  s.ui().click();assert.equal(s.ui().hasAttribute('data-hidden'),true);assert.deepEqual(s.calls,[]);
});
test('spread fingers zoom around their midpoint, release preserves crop and layout API keeps the native viewport',t=>{
  const s=setup(t);s.enter();s.pinch(2,437,201);
  assert.deepEqual(fields(s.state()),[2,0,0]);assert.equal(s.state().gesturing,false);
  assert.deepEqual({...s.win.__langformPlaybackZoom.getLayoutRect(s.video)},box(0,0,874,402));
  assert.equal(s.win.__langformPlaybackZoom.getLayoutRect(s.doc.createElement('video')),null);
  assert.equal(s.video.currentTime,30);assert.equal(s.video.playbackRate,1);assert.deepEqual(s.calls,[]);
});
test('off-center pinch keeps the touched content under the fingers instead of snapping to center',t=>{
  const s=setup(t);s.enter();s.pinch(2,350,201);closeTo(s.state().x,87);closeTo(s.state().y,0);
  const originalContentX=(350-437);const shownX=437+2*originalContentX+s.state().x;closeTo(shownX,350,'content anchor');
});
test('one remaining finger continues panning without jump; limits prevent revealing empty areas',t=>{
  const s=setup(t);s.enter();s.pointer('pointerdown',1,387,201);s.pointer('pointerdown',2,487,201);
  s.pointer('pointermove',1,337,201);s.pointer('pointermove',2,537,201);s.pointer('pointerup',2,537,201);
  const before=fields(s.state());assert.deepEqual(before,[2,0,0]);
  s.pointer('pointermove',1,2000,3000);closeTo(s.state().x,(1920*(402/1080)*2-874)/2);closeTo(s.state().y,201);
  s.pointer('pointerup',1,2000,3000);assert.equal(s.state().scale,2);
});
test('pan begins only after movement; a zoomed short tap still reveals/hides real controls',t=>{
  const s=setup(t);s.enter();s.pinch(2,437,201);s.ui().dispatchEvent(new s.win.Event('click',{bubbles:true,cancelable:true}));
  const first=s.pointer('pointerdown',1,437,100);assert.equal(first.defaultPrevented,false);
  assert.equal(s.pointer('pointermove',1,439,101).defaultPrevented,false);
  assert.equal(s.pointer('pointerup',1,439,101).defaultPrevented,false);
  s.ui().click();assert.equal(s.ui().hasAttribute('data-hidden'),true);
  s.pointer('pointerdown',1,437,100);assert.equal(s.pointer('pointermove',1,460,110).defaultPrevented,true);s.pointer('pointerup',1,460,110);
  assert.ok(s.state().x>0);assert.ok(s.state().y>0);
});
test('zoom-out clamps to original picture and removes reset UI and native layout override',t=>{
  const s=setup(t);s.enter();s.pinch(4,437,201);assert.equal(s.state().scale,4);s.pinch(.1,437,201);
  assert.deepEqual(fields(s.state()),[1,0,0]);assert.equal(s.doc.querySelector('.lf-playback-zoom-reset'),null);assert.equal(s.win.__langformPlaybackZoom.getLayoutRect(s.video),null);
});
test('maximum8 is our bounded product choice; extreme spreads stay finite and can reverse immediately',t=>{
  const s=setup(t);s.enter();s.pinch(100,437,201);assert.equal(s.state().scale,8);
  s.pinch(.5,437,201);assert.equal(s.state().scale,4);assert.ok(Number.isFinite(s.state().x));
});
test('portrait source in landscape has true letterboxing: no pan in an axis until its magnified picture fills it',t=>{
  const s=setup(t,{iw:1080,ih:1920});s.enter();s.pinch(2,437,201);
  s.pointer('pointerdown',1,437,201);s.pointer('pointermove',1,700,300);s.pointer('pointerup',1,700,300);
  assert.equal(s.state().x,0);assert.equal(s.state().y,99);
});
test('reset is a named44px action in existing top control flow and changes no media time/rate',t=>{
  const s=setup(t);s.enter();s.pinch(2,437,201);const button=s.doc.querySelector('.lf-playback-zoom-reset');
  assert.equal(button.parentElement,s.ui().querySelector('.lf-fs-top'));assert.match(button.getAttribute('aria-label'),/^Zoom 2× zurücksetzen$/);
  assert.equal(s.win.getComputedStyle(button).minWidth,'44px');assert.equal(s.win.getComputedStyle(button).minHeight,'44px');button.click();
  assert.deepEqual(fields(s.state()),[1,0,0]);assert.equal(s.doc.getElementById('langform-playback-zoom-status'),null);assert.equal(s.video.currentTime,30);assert.equal(s.video.playbackRate,1);
});
test('accepted pinch consumes its follow-up surface click but leaves Pause/seek/Exit controls available',t=>{
  const s=setup(t);s.enter();s.pinch(2,437,201);const click=new s.win.Event('click',{bubbles:true,cancelable:true});s.ui().dispatchEvent(click);
  assert.equal(click.defaultPrevented,true);assert.equal(s.ui().hasAttribute('data-hidden'),false);
  s.ui().querySelector('[data-action=play]').click();assert.equal(s.video.paused,true);assert.equal(s.state().scale,2);
  s.ui().querySelector('[data-action=forward]').click();assert.equal(s.video.currentTime,40);assert.equal(s.state().scale,2);
});
for(const selector of ['[data-action=play]','[data-action=exit]','input','.lf-fs-speed-button','.lf-fs-top','.lf-fs-bottom'])test(`pinch cannot start on actual control surface ${selector}`,t=>{
  const s=setup(t);s.enter();const target=s.ui().querySelector(selector);
  s.pointer('pointerdown',1,400,100,target);s.pointer('pointerdown',2,500,100,target);const move=s.pointer('pointermove',2,600,100,target);
  assert.equal(move.defaultPrevented,false);assert.deepEqual(fields(s.state()),[1,0,0]);
});
test('a second contact starting on a control cancels background candidates without stealing the control click',t=>{
  const s=setup(t);s.enter();s.pointer('pointerdown',1,387,100);const play=s.ui().querySelector('[data-action=play]');
  assert.equal(s.pointer('pointerdown',2,487,100,play).defaultPrevented,false);s.pointer('pointermove',1,200,100);assert.equal(s.state().scale,1);play.click();assert.equal(s.video.paused,true);
});
test('third finger and unrelated pointer IDs cannot rebase or move a two-finger zoom',t=>{
  const s=setup(t);s.enter();s.pointer('pointerdown',1,387,100);s.pointer('pointerdown',2,487,100);
  const unrelated=s.pointer('pointermove',99,300,100);assert.equal(unrelated.defaultPrevented,false);
  s.pointer('pointermove',2,587,100);const before=fields(s.state());s.pointer('pointerdown',3,500,100);
  s.pointer('pointermove',1,100,100);assert.deepEqual(fields(s.state()),before);assert.equal(s.state().gesturing,false);
});
for(const name of ['pointercancel','lostpointercapture'])test(`${name} ends ownership and preserves the last visible crop`,t=>{
  const s=setup(t);s.enter();s.pointer('pointerdown',1,387,100);s.pointer('pointerdown',2,487,100);s.pointer('pointermove',2,587,100);
  const before=fields(s.state());s.pointer(name,2,587,100);assert.deepEqual(fields(s.state()),before);assert.equal(s.state().gesturing,false);
  assert.equal(s.ui().hasAttribute('data-langform-playback-zoom-gesture'),false);assert.equal(s.doc.getElementById('langform-playback-zoom-status'),null);
});
test('second finger cancels an active2× hold and pinch/pan never changes playbackRate',t=>{
  const s=setup(t,{hold:true});s.enter();s.pointer('pointerdown',1,150,100);
  const holdTimer=[...s.timers.entries()].find(([,item])=>item.delay===350);assert.ok(holdTimer);s.timers.delete(holdTimer[0]);holdTimer[1].fn();assert.equal(s.video.playbackRate,2);
  s.pointer('pointerdown',2,500,100);assert.equal(s.video.playbackRate,1);s.pointer('pointermove',2,600,100);assert.ok(s.state().scale>1);
  s.pointer('pointerup',1,150,100);s.pointer('pointerup',2,600,100);
  s.pointer('pointerdown',1,150,100);const secondTimer=[...s.timers.entries()].find(([,item])=>item.delay===350);assert.ok(secondTimer,'stationary zoomed side still arms hold');s.timers.delete(secondTimer[0]);secondTimer[1].fn();assert.equal(s.video.playbackRate,2);s.pointer('pointermove',1,170,110);assert.equal(s.video.playbackRate,1,'accepted pan restores rate');s.pointer('pointerup',1,170,110);assert.equal(s.video.playbackRate,1);
});
test('speed panel and scrub preview keep committed zoom but block a competing picture gesture',t=>{
  const s=setup(t);s.enter();s.pinch(2,437,201);s.ui().querySelector('.lf-fs-speed-button').click();
  s.pointer('pointerdown',1,387,100);s.pointer('pointerdown',2,487,100);s.pointer('pointermove',2,650,100);assert.equal(s.state().scale,2);
  assert.ok(s.win.__langformPlaybackZoom.getLayoutRect(s.video));
});
for(const mutate of ['src','currentSrc','media-id','route','ad','video','root','container','emptied','error'])test(`owner release after ${mutate} preserves author styles and cannot affect replacements`,async t=>{
  const s=setup(t);s.enter();s.pinch(2,437,201);s.video.style.setProperty('transform','translateX(17px)','important');
  if(mutate==='src')s.video.src='https://example.test/b';
  if(mutate==='currentSrc'){Object.defineProperty(s.video,'currentSrc',{value:'https://example.test/b'});s.video.dispatchEvent(new s.win.Event('loadedmetadata'));}
  if(mutate==='media-id')s.actualID('zyxwvutsrqp');
  if(mutate==='route'){s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');s.win.dispatchEvent(new s.win.Event('yt-navigate-finish'));}
  if(mutate==='ad')s.root.classList.add('ad-showing');
  if(mutate==='video')s.video.replaceWith(s.video.cloneNode());
  if(mutate==='root')s.root.replaceWith(s.root.cloneNode(true));
  if(mutate==='container')s.container.replaceWith(s.container.cloneNode(true));
  if(mutate==='emptied')s.video.dispatchEvent(new s.win.Event('emptied'));
  if(mutate==='error'){s.video.error={code:3};s.video.dispatchEvent(new s.win.Event('error'));}
  await Promise.resolve();await Promise.resolve();
  assert.equal(s.state(),null);assert.equal(s.win.__langformPlaybackZoom.getLayoutRect(s.video),null);
  assert.equal(s.video.style.getPropertyValue('transform'),'translateX(17px)');assert.equal(s.video.style.getPropertyPriority('transform'),'important');
  assert.equal(s.video.hasAttribute('data-langform-playback-zoom-video'),false);assert.equal(s.doc.querySelector('.lf-playback-zoom-reset'),null);
});
for(const name of ['blur','resize','orientationchange','visibilitychange'])test(`${name} clears the committed crop; a later valid gesture may start fresh`,t=>{
  const s=setup(t);s.enter();s.pinch(2,437,201);
  if(name==='visibilitychange')Object.defineProperty(s.doc,'hidden',{value:true,configurable:true});
  (name==='visibilitychange'?s.doc:s.win).dispatchEvent(new s.win.Event(name));
  assert.equal(s.win.__langformPlaybackZoom.getLayoutRect(s.video),null);assert.ok(!s.state() || s.state().scale===1);
});
test('exit clears zoom synchronously before fullscreen geometry sampling and a new cycle starts at1×',t=>{
  const s=setup(t);s.enter();s.pinch(2,437,201);let zoomDuringGeometry;
  const actualRect=s.video.getBoundingClientRect;s.video.getBoundingClientRect=()=>{zoomDuringGeometry=s.video.hasAttribute('data-langform-playback-zoom-video');return actualRect();};
  s.win.__langformFullscreenExitProtocol=1;s.ui().querySelector('[data-action=exit]').click();
  assert.equal(zoomDuringGeometry,false);assert.equal(s.state(),null);assert.equal(s.win.__langformPlaybackZoom.getLayoutRect(s.video),null);
  s.win.__langformFullscreen.exit('abcdefghijk','test-cancel');s.enter();assert.deepEqual(fields(s.state()),[1,0,0]);
});
test('close/reset and wrong-ID reset preserve exact preexisting attributes and original inline media styles',t=>{
  const s=setup(t);s.video.setAttribute('data-langform-playback-zoom-video','author');const before=s.video.getAttribute('style');s.enter();s.pinch(2,437,201);
  assert.equal(s.win.__langformPlaybackZoom.reset('wrong'),false);assert.equal(s.state().scale,2);s.ui().querySelector('[data-action=exit]').click();
  assert.equal(s.video.getAttribute('data-langform-playback-zoom-video'),'author');assert.equal(s.video.getAttribute('style'),before);
});
test('previous gesture click suppression is bound to its media source and route',t=>{
  const s=setup(t);s.enter();s.pinch(2,437,201);s.video.src='https://example.test/b';const event=new s.win.Event('click',{bubbles:true,cancelable:true});s.video.dispatchEvent(event);assert.equal(event.defaultPrevented,false);
});
test('normal copy/contextmenu outside and without a gesture stays available; only accepted gesture selection is suppressed',t=>{
  const s=setup(t);s.enter();s.pinch(2,437,201);const outside=s.doc.getElementById('copy');
  const event=new s.win.Event('contextmenu',{bubbles:true,cancelable:true});outside.dispatchEvent(event);assert.equal(event.defaultPrevented,false);
  assert.equal(s.win.getComputedStyle(outside).userSelect,'');assert.equal(s.ui().hasAttribute('data-langform-playback-zoom-gesture'),false);
});
test('BFCache pagehide removes ownership/styles and pageshow reattaches once without restoring old zoom',t=>{
  const s=setup(t);s.enter();s.pinch(2,437,201);const hide=new s.win.Event('pagehide');Object.defineProperty(hide,'persisted',{value:true});s.win.dispatchEvent(hide);
  assert.equal(s.state(),null);assert.equal(s.doc.getElementById('langform-playback-zoom-style'),null);s.win.dispatchEvent(new s.win.Event('pageshow'));s.win.dispatchEvent(new s.win.Event('pageshow'));
  assert.equal(s.doc.querySelectorAll('#langform-playback-zoom-style').length,1);s.enter();assert.deepEqual(fields(s.state()),[1,0,0]);
});
test('fallback touch pinch/release/pan/zoom-out follow the same actual contact identities',t=>{
  const s=setup(t,{touch:true});s.enter();s.touch('touchstart',[[10,387,201]]);s.touch('touchstart',[[10,387,201],[20,487,201]]);
  assert.equal(s.touch('touchmove',[[10,337,201],[20,537,201]]).defaultPrevented,true);assert.equal(s.state().scale,2);
  s.touch('touchend',[[10,337,201]],s.ui(),[[20,537,201]]);s.touch('touchmove',[[10,360,210]]);s.touch('touchend',[],s.ui(),[[10,360,210]]);
  assert.deepEqual(fields(s.state()),[2,23,9]);assert.equal(s.state().gesturing,false);
  s.touch('touchstart',[[10,387,201],[20,487,201]]);s.touch('touchmove',[[10,432,201],[20,442,201]]);s.touch('touchend',[],s.ui(),[[10,432,201],[20,442,201]]);assert.deepEqual(fields(s.state()),[1,0,0]);
});
test('fallback touch ignores unrelated end IDs and touchcancel cleans accepted selection state',t=>{
  const s=setup(t,{touch:true});s.enter();s.touch('touchstart',[[10,387,100],[20,487,100]]);s.touch('touchmove',[[10,337,100],[20,537,100]]);
  const before=fields(s.state());s.touch('touchend',[[10,337,100],[20,537,100]],s.ui(),[[99,0,0]]);assert.equal(s.state().gesturing,true);
  s.touch('touchcancel',[],s.ui(),[[10,337,100],[20,537,100]]);assert.deepEqual(fields(s.state()),before);assert.equal(s.state().gesturing,false);
});
for(const touchFallback of [false,true])test(`fresh ${touchFallback?'touch':'pointer'} tap after pinch is independent of its old synthetic click suppression`,t=>{
  const s=setup(t,{touch:touchFallback});s.enter();
  if(touchFallback){s.touch('touchstart',[[10,387,201],[20,487,201]]);s.touch('touchmove',[[10,337,201],[20,537,201]]);s.touch('touchend',[],s.ui(),[[10,337,201],[20,537,201]]);s.touch('touchstart',[[10,437,100]]);s.touch('touchend',[],s.ui(),[[10,437,100]]);}
  else{s.pinch(2,437,201);s.pointer('pointerdown',1,437,100);s.pointer('pointerup',1,437,100);}
  const click=new s.win.Event('click',{bubbles:true,cancelable:true});s.ui().dispatchEvent(click);assert.equal(click.defaultPrevented,false);assert.equal(s.ui().hasAttribute('data-hidden'),true);
});
for(const cancellation of ['exit','ad'])test(`${cancellation} cannot carry a previous pinching click lock into a new inline touch`,t=>{
  const s=setup(t);s.enter();s.pointer('pointerdown',1,387,201);s.pointer('pointerdown',2,487,201);s.pointer('pointermove',2,587,201);
  if(cancellation==='exit')s.win.__langformFullscreen.exit('abcdefghijk','test');else{s.root.classList.add('ad-showing');s.win.__langformPlaybackZoom.reset('abcdefghijk');}
  s.pointer('pointerdown',1,150,150,s.video);s.pointer('pointerup',1,150,150,s.video);const click=new s.win.Event('click',{bubbles:true,cancelable:true});s.video.dispatchEvent(click);assert.equal(click.defaultPrevented,false);
});
test('opening a speed panel during a pinch ends gesture ownership while retaining the committed crop',t=>{
  const s=setup(t);s.enter();s.pointer('pointerdown',1,387,201);s.pointer('pointerdown',2,487,201);s.pointer('pointermove',2,587,201);
  const before=fields(s.state());s.ui().querySelector('.lf-fs-speed-button').click();s.pointer('pointermove',2,650,201);
  assert.deepEqual(fields(s.state()),before);assert.equal(s.state().gesturing,false);assert.ok(s.win.__langformPlaybackZoom.getLayoutRect(s.video));
});
for(const fallback of [false,true])test(`malformed ${fallback?'touch':'pointer'} movement cannot apply a NaN/Infinity crop`,t=>{
  const s=setup(t,{touch:fallback});s.enter();
  if(fallback){s.touch('touchstart',[[10,387,201],[20,487,201]]);s.touch('touchmove',[[10,337,201],[20,537,201]]);}
  else{s.pointer('pointerdown',1,387,201);s.pointer('pointerdown',2,487,201);s.pointer('pointermove',2,587,201);}
  const before=fields(s.state());if(fallback)s.touch('touchmove',[[10,NaN,201],[20,Infinity,201]]);else s.pointer('pointermove',2,NaN,Infinity);
  assert.deepEqual(fields(s.state()),before);assert.equal(s.state().gesturing,false);
});
test('paused picture can zoom, transient buffering keeps its crop/native basis, fresh loading cannot enrol',t=>{
  const s=setup(t,{paused:true});s.enter();s.pinch(2,437,201);assert.equal(s.video.paused,true);s.video.readyState=1;
  assert.equal(s.state().scale,2);assert.ok(s.win.__langformPlaybackZoom.getLayoutRect(s.video));
  s.video.readyState=0;s.video.dispatchEvent(new s.win.Event('emptied'));assert.equal(s.state(),null);
  s.pointer('pointerdown',1,387,201);s.pointer('pointerdown',2,487,201);assert.equal(s.state(),null);
});
test('changing intrinsic aspect on the same source invalidates the old crop',t=>{
  const s=setup(t);s.enter();s.pinch(2,437,201);s.video.videoWidth=1080;s.video.videoHeight=1920;s.video.dispatchEvent(new s.win.Event('loadedmetadata'));
  assert.deepEqual(fields(s.state()),[1,0,0]);assert.equal(s.win.__langformPlaybackZoom.getLayoutRect(s.video),null);
});
test('same-aspect decoded quality changes preserve the crop, native viewport and a subsequent pan',t=>{
  const s=setup(t,{diagnostics:true});s.enter();s.pinch(2,350,201);const before=fields(s.state());
  for(const [width,height] of [[1280,720],[640,360],[3840,2160],[1920,1080]]){
    s.video.videoWidth=width;s.video.videoHeight=height;
    assert.deepEqual(fields(s.state()),before,'a quality change without media events retains the crop');
    assert.deepEqual({...s.win.__langformPlaybackZoom.getLayoutRect(s.video)},box(0,0,874,402));
    s.video.dispatchEvent(new s.win.Event('loadedmetadata'));
    assert.deepEqual(fields(s.state()),before,'same-aspect metadata retains the same owner');
  }
  s.pointer('pointerdown',1,437,150);s.pointer('pointermove',1,477,165);s.pointer('pointerup',1,477,165);
  assert.deepEqual(fields(s.state()),[2,before[1]+40,before[2]+15]);assert.equal(s.state().gesturing,false);
  assert.ok(!s.win.__langformPlaybackZoom.getDiagnostics().some(row=>row.event==='state-mismatch'||row.event.startsWith('reset-')));
  assert.equal(s.video.currentTime,30);assert.equal(s.video.playbackRate,1);assert.deepEqual(s.calls,[]);
});
test('same-aspect quality change during an accepted pinch preserves its content projection and release',t=>{
  const s=setup(t);s.enter();s.pointer('pointerdown',1,387,201);s.pointer('pointerdown',2,487,201);
  s.pointer('pointermove',1,337,201);s.pointer('pointermove',2,537,201);assert.deepEqual(fields(s.state()),[2,0,0]);
  s.video.videoWidth=1280;s.video.videoHeight=720;s.video.dispatchEvent(new s.win.Event('loadedmetadata'));
  s.pointer('pointermove',1,287,201);s.pointer('pointermove',2,587,201);
  assert.deepEqual(fields(s.state()),[3,0,0]);s.pointer('pointerup',1,287,201);s.pointer('pointerup',2,587,201);
  assert.deepEqual(fields(s.state()),[3,0,0]);assert.equal(s.state().gesturing,false);
});
test('even a one-pixel aspect change rejects a retained crop without a metadata event',t=>{
  const s=setup(t);s.enter();s.pinch(2);s.video.videoWidth=1280;s.video.videoHeight=721;
  assert.equal(s.state(),null);assert.equal(s.win.__langformPlaybackZoom.getLayoutRect(s.video),null);
  s.pointer('pointerdown',1,437,150);assert.deepEqual(fields(s.state()),[1,0,0]);
});
test('accepted touchpan cancels a real zoomed hold after movement and matching release restores the prior rate',t=>{
  const s=setup(t,{touch:true,hold:true});s.enter();s.touch('touchstart',[[10,387,201],[20,487,201]]);s.touch('touchmove',[[10,337,201],[20,537,201]]);s.touch('touchend',[],s.ui(),[[10,337,201],[20,537,201]]);
  s.touch('touchstart',[[10,150,100]]);const entry=[...s.timers.entries()].find(([,item])=>item.delay===350);assert.ok(entry);s.timers.delete(entry[0]);entry[1].fn();assert.equal(s.video.playbackRate,2);
  s.touch('touchmove',[[10,170,120]]);assert.equal(s.video.playbackRate,1);s.touch('touchcancel',[],s.ui(),[[10,170,120]]);assert.equal(s.video.playbackRate,1);
});
test('a new src attribute releases a crop even while currentSrc still exposes the old decoded stream',async t=>{
  const s=setup(t);s.enter();s.pinch(2,437,201);Object.defineProperty(s.video,'currentSrc',{value:'https://example.test/a',configurable:true});
  s.video.setAttribute('src','https://example.test/b');await Promise.resolve();assert.equal(s.state(),null);assert.equal(s.video.hasAttribute('data-langform-playback-zoom-video'),false);
});
test('a non-primary second finger after real control down cannot masquerade as a one-finger pan',t=>{
  const s=setup(t);s.enter();s.pinch(2,437,201);s.pointer('pointerdown',1,437,201,s.ui().querySelector('[data-action=play]'));
  s.pointer('pointerdown',2,600,130);s.pointer('pointermove',2,630,140);assert.deepEqual(fields(s.state()),[2,0,0]);assert.equal(s.state().gesturing,false);
});
test('a newly decoded same-element source rearms fullscreen touch ownership before another gesture begins',async t=>{
  const s=setup(t);s.enter();s.pinch(2,437,201);s.video.src='https://example.test/b';await Promise.resolve();assert.equal(s.state(),null);
  s.video.dispatchEvent(new s.win.Event('loadeddata'));assert.deepEqual(fields(s.state()),[1,0,0]);assert.equal(s.ui().hasAttribute('data-langform-playback-zoom-surface'),true);
});


test('zoom diagnosis requires the exact opt-in flag and never exposes a production getter',t=>{
  for(const diagnostics of [undefined,false,1,'true']){
    const s=setup(t,{diagnostics});s.enter();s.pinch(2);assert.equal(s.win.__langformPlaybackZoom.getDiagnostics,undefined);assert.equal(s.state().scale,2);
  }
});
test('zoom diagnosis retains at most16 finite source-free snapshots and returns detached rows',t=>{
  const s=setup(t,{diagnostics:true});s.enter();
  for(let i=0;i<12;i++){s.pinch(2);s.win.dispatchEvent(new s.win.Event('resize'));}
  const rows=s.win.__langformPlaybackZoom.getDiagnostics();assert.equal(rows.length,16);
  assert.ok(rows.some(row=>row.event==='gesture-accepted'));assert.ok(rows.some(row=>row.event==='reset-resize'));
  assert.ok(rows.every(row=>Object.values(row).every(value=>typeof value!=='number'||Number.isFinite(value))));
  assert.doesNotMatch(JSON.stringify(rows),/https:|example|abcdefghijk|"Video"|src=/);
  rows[0].event='foreign';rows.pop();assert.equal(s.win.__langformPlaybackZoom.getDiagnostics().length,16);assert.notEqual(s.win.__langformPlaybackZoom.getDiagnostics()[0].event,'foreign');
  s.root.getBoundingClientRect=s.video.getBoundingClientRect=()=>assert.fail('diagnostic getter must not read geometry');s.win.getComputedStyle=()=>assert.fail('diagnostic getter must not read styles');
  assert.equal(s.win.__langformPlaybackZoom.getDiagnostics().length,16);
});
test('getter-only intrinsic aspect mismatch is distinguished from subsequent move reset without inferring a source change',t=>{
  const s=setup(t,{diagnostics:true});s.enter();s.pointer('pointerdown',1,387,201);s.pointer('pointerdown',2,487,201);
  s.video.videoWidth=1280;s.video.videoHeight=721;assert.equal(s.state(),null);
  let rows=s.win.__langformPlaybackZoom.getDiagnostics(),last=rows.at(-1);
  assert.equal(last.event,'state-mismatch');assert.equal(last.owner,true);assert.equal(last.context,true);assert.equal(last.sourceSame,true);assert.equal(last.sourceAttributeSame,true);
  assert.equal(last.intrinsicWidth,1280);assert.equal(last.ownerIntrinsicWidth,1920);assert.equal(last.intrinsicHeight,721);assert.equal(last.ownerIntrinsicHeight,1080);
  assert.ok(!rows.some(row=>row.event==='reset-move'));
  s.pointer('pointermove',1,337,201);rows=s.win.__langformPlaybackZoom.getDiagnostics();assert.ok(rows.some(row=>row.event==='reset-move'&&row.context&&row.intrinsicWidth===1280));
  assert.equal(s.video.hasAttribute('data-langform-playback-zoom-video'),false);assert.equal(s.video.playbackRate,1);
});
test('zoom diagnosis uses the existing context read and hard media reset adds none',t=>{
  const s=setup(t,{diagnostics:true});s.enter();s.pinch(2);
  const get=s.win.__langformFullscreen.getZoomContext;let reads=0;s.win.__langformFullscreen.getZoomContext=function(){reads++;return get.apply(this,arguments);};
  s.video.videoWidth=1280;s.video.videoHeight=721;assert.equal(s.state(),null);assert.equal(reads,1);
  s.win.__langformPlaybackZoom.getDiagnostics();assert.equal(reads,1);
  reads=0;s.video.dispatchEvent(new s.win.Event('emptied'));assert.equal(reads,0);
  assert.ok(s.win.__langformPlaybackZoom.getDiagnostics().some(row=>row.event==='reset-emptied'));
});
test('missing fullscreen context and a local overlay rejection have separate diagnostic causes',t=>{
  const s=setup(t,{diagnostics:true});s.enter();s.pinch(2);const get=s.win.__langformFullscreen.getZoomContext;
  s.win.__langformFullscreen.getZoomContext=()=>null;assert.equal(s.state(),null);let row=s.win.__langformPlaybackZoom.getDiagnostics().at(-1);assert.equal(row.context,false);assert.equal(row.contextReason,1);
  s.win.__langformFullscreen.getZoomContext=get;s.win.__langformHasOpenOverlay=()=>true;assert.equal(s.state(),null);
  assert.ok(s.win.__langformPlaybackZoom.getDiagnostics().some(row=>row.event==='context-rejected'&&row.contextReason===10&&row.context));
});
test('diagnosis distinguishes an accepted pinch Hold cancel from a later pointer cancellation without losing crop',t=>{
  const s=setup(t,{diagnostics:true,hold:true});s.enter();s.pointer('pointerdown',1,387,201);s.pointer('pointerdown',2,487,201);s.pointer('pointermove',2,587,201);
  const before=fields(s.state());s.pointer('pointercancel',2,587,201);assert.deepEqual(fields(s.state()),before);
  const rows=s.win.__langformPlaybackZoom.getDiagnostics();assert.ok(rows.some(row=>row.event==='gesture-accepted'));assert.ok(rows.some(row=>row.event==='pointercancel'));
  assert.ok(!rows.some(row=>row.event.startsWith('reset-')));assert.equal(s.video.playbackRate,1);
});
