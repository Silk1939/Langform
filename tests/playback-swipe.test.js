const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(process.env.LANGFORM_SWIPE_TEST_SOURCE || path.join(__dirname,'../ios/Langform/Langform/PlaybackSwipe.js'),'utf8');
const hold=fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/PlaybackHold.js'),'utf8');
const zoom=fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/PlaybackZoom.js'),'utf8');
const fullscreen=fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/FullscreenMotion.js'),'utf8');
const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
function setup(t,options={}){
  const dom=new JSDOM('<!doctype html><html><head></head><body><ytm-player><div id="movie_player"><div class="html5-video-container"><video src="https://example.test/a"></video></div><button class="ytp-fullscreen-button">Fullscreen</button></div><div id="surface"><div id="nested"></div><button id="play">Play</button><input type="range"><a href="#">Link</a><span role="slider">Slider</span><span role="button">Button</span></div></ytm-player><p id="outside">Outside</p></body></html>',{url:'https://m.youtube.com/watch?v=abcdefghijk',runScripts:'outside-only',pretendToBeVisual:true});
  const win=dom.window,doc=win.document,root=doc.getElementById('movie_player'),video=root.querySelector('video'),shared=root.parentElement,container=video.parentElement,surface=doc.getElementById('surface');
  const errors=[];win.addEventListener('error',e=>{errors.push(e.message);e.preventDefault();});
  t.after(()=>{win.dispatchEvent(new win.Event('pagehide'));assert.deepEqual(errors,[]);win.close();});
  if(!options.touch)win.PointerEvent=win.MouseEvent;
  Object.defineProperties(win,{innerWidth:{value:874,writable:true},innerHeight:{value:874,writable:true}});
  let mediaID='abcdefghijk',ad=false,pose=rect(0,110,402,226),time=30,sets=[],now=1000;
  root.getVideoData=()=>({video_id:mediaID,isAd:ad,title:'Video'});
  Object.defineProperties(video,{currentSrc:{get:()=>video.src,configurable:true},videoWidth:{value:1920,writable:true},videoHeight:{value:1080,writable:true},readyState:{value:4,writable:true},error:{value:null,writable:true},seeking:{value:false,writable:true},duration:{value:120,writable:true},paused:{value:!!options.paused,writable:true},ended:{value:false,writable:true},currentTime:{get:()=>time,set:v=>{sets.push(v);time=v;},configurable:true},playbackRate:{value:1,writable:true},seekable:{value:{length:0},writable:true}});
  root.getBoundingClientRect=()=>root.hasAttribute('data-langform-fullscreen-player')?rect(0,0,win.innerWidth,win.innerHeight):pose;
  video.getBoundingClientRect=()=>root.getBoundingClientRect();
  const timers=new Map();let serial=0;win.Date.now=()=>now;
  win.setTimeout=(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;};win.clearTimeout=id=>timers.delete(id);win.scrollTo=()=>{};
  win.webkit={messageHandlers:{langformFullscreen:{postMessage:()=>{}}}};
  const calls=[];win.__langformTogglePlayback=id=>{calls.push(['toggle',id]);video.paused=!video.paused;video.dispatchEvent(new win.Event(video.paused?'pause':'play'));return true;};
  win.__langformPlay=id=>{calls.push(['play',id]);video.paused=false;video.dispatchEvent(new win.Event('play'));return true;};
  // Match shipping capture-listener precedence: Zoom precedes Swipe and Hold.
  win.eval(zoom);win.eval(source);if(options.hold)win.eval(hold);if(options.fullscreen){win.eval(fullscreen);root.querySelector('.ytp-fullscreen-button').click();}
  function pointer(type,id,x,y,target=surface,extra={}){const event=new win.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{pointerType:'touch',pointerId:id,isPrimary:id===1,button:0,clientX:x,clientY:y,...extra});target.dispatchEvent(event);return event;}
  function touch(type,points,target=surface,changed=[]){const event=new win.Event(type,{bubbles:true,cancelable:true});Object.defineProperties(event,{touches:{value:points.map(([identifier,clientX,clientY,node])=>({identifier,clientX,clientY,target:node || target}))},changedTouches:{value:changed.map(([identifier,clientX,clientY])=>({identifier,clientX,clientY,target}))}});target.dispatchEvent(event);return event;}
  function click(x=150,y=210,target=surface){const event=new win.MouseEvent('click',{bubbles:true,cancelable:true,clientX:x,clientY:y});target.dispatchEvent(event);return event;}
  function swipe(from=100,to=180,y=210,target=surface){pointer('pointerdown',1,from,y,target);now+=80;pointer('pointermove',1,to,y,target);now+=20;return pointer('pointerup',1,to,y,target);}
  return{win,doc,root,video,shared,container,surface,sets,timers,calls,pointer,touch,click,swipe,ui:()=>doc.getElementById('langform-fullscreen-ui'),setTime:v=>{time=v;},tick:ms=>{now+=ms;},id:v=>{mediaID=v;},ad:v=>{ad=v;},pose:v=>{pose=v;},feedback:()=>doc.getElementById('langform-playback-swipe-status')};
}
for(const paused of [false,true])test(`right/left seek once by15 and preserve paused=${paused}, rate and control intent`,t=>{
  const s=setup(t,{paused});const rate=s.video.playbackRate;s.pointer('pointerdown',1,10,120);s.pointer('pointermove',1,80,120);s.pointer('pointermove',1,160,120);assert.deepEqual(s.sets,[]);const end=s.pointer('pointerup',1,160,120);
  assert.equal(end.defaultPrevented,true);assert.deepEqual(s.sets,[45]);assert.equal(s.feedback().textContent,'15 s vor');assert.equal(s.feedback().getAttribute('role'),'status');
  s.swipe(350,200);assert.deepEqual(s.sets,[45,30]);assert.equal(s.feedback().textContent,'15 s zurück');assert.equal(s.video.paused,paused);assert.equal(s.video.playbackRate,rate);assert.deepEqual(s.calls,[]);
});
test('end coordinates alone recognize a deliberate swipe with no move callback',t=>{const s=setup(t);s.pointer('pointerdown',1,100,210);s.tick(120);assert.equal(s.pointer('pointerup',1,180,212).defaultPrevented,true);assert.deepEqual(s.sets,[45]);});
for(const [name,dx,dy] of [['tap',2,1],['small',20,0],['vertical',4,80],['diagonal',60,50]])test(`${name} retains normal input and never seeks`,t=>{const s=setup(t);assert.equal(s.pointer('pointerdown',1,100,210).defaultPrevented,false);assert.equal(s.pointer('pointermove',1,100+dx,210+dy).defaultPrevented,false);assert.equal(s.pointer('pointerup',1,100+dx,210+dy).defaultPrevented,false);assert.deepEqual(s.sets,[]);assert.equal(s.click().defaultPrevented,false);});
test('vertical-first then horizontal turn never reacquires the same contact',t=>{const s=setup(t);s.pointer('pointerdown',1,100,180);s.pointer('pointermove',1,103,210);s.pointer('pointermove',1,240,213);s.pointer('pointerup',1,240,213);assert.deepEqual(s.sets,[]);});
test('short slow drag is not a swipe; long deliberate drag is accepted',t=>{const s=setup(t);s.pointer('pointerdown',1,100,210);s.tick(700);s.pointer('pointermove',1,135,210);s.pointer('pointerup',1,135,210);assert.deepEqual(s.sets,[]);s.pointer('pointerdown',1,100,210);s.tick(1100);s.pointer('pointermove',1,180,210);s.pointer('pointerup',1,180,210);assert.deepEqual(s.sets,[45]);});
test('wild return-to-origin and predominantly vertical finish suppress only their own trailing click without a seek',t=>{const s=setup(t);s.pointer('pointerdown',1,100,210);s.pointer('pointermove',1,230,210);s.pointer('pointermove',1,100,210);s.pointer('pointerup',1,100,210);assert.deepEqual(s.sets,[]);assert.equal(s.click(100,210).defaultPrevented,true);s.pointer('pointerdown',1,100,170);s.pointer('pointermove',1,180,170);s.pointer('pointerup',1,180,310);assert.deepEqual(s.sets,[]);});
test('accepted swipe consumes only the next owned synthetic picture click and fresh taps recover immediately',t=>{const s=setup(t);s.swipe();assert.equal(s.click().defaultPrevented,true);assert.equal(s.click().defaultPrevented,false);s.swipe();s.pointer('pointerdown',1,160,210);s.pointer('pointerup',1,160,210);assert.equal(s.click().defaultPrevented,false);});
test('trailing click expires and never steals controls or outside-picture input',t=>{const s=setup(t);s.swipe();assert.equal(s.click(100,50).defaultPrevented,false);assert.equal(s.click(150,210,s.doc.getElementById('play')).defaultPrevented,false);assert.equal(s.click(150,210,s.doc.getElementById('outside')).defaultPrevented,false);s.tick(801);assert.equal(s.click().defaultPrevented,false);});
for(const selector of ['button','input','a','[role=slider]','[role=button]'])test(`real mweb sibling control ${selector} retains its drag and click`,t=>{const s=setup(t);const target=s.surface.querySelector(selector);s.swipe(100,180,210,target);assert.deepEqual(s.sets,[]);assert.equal(s.click(150,210,target).defaultPrevented,false);});
test('nested empty sibling overlay and both picture edges are admitted, outside coordinates are rejected',t=>{const s=setup(t);s.swipe(0,100,110,s.doc.getElementById('nested'));s.swipe(402,300,336,s.video);assert.deepEqual(s.sets,[45,30]);s.swipe(100,180,109);s.swipe(100,180,337);s.swipe(-1,80);assert.deepEqual(s.sets,[45,30]);});
for(const [name,initial,target,actual] of [['start',5,-15,0],['end',115,15,120]])test(`finite timeline ${name} is bounded and feedback reports the observed available delta`,t=>{const s=setup(t);s.setTime(initial);s.swipe(target>0?100:200,target>0?200:100);assert.equal(s.video.currentTime,actual);assert.equal(s.feedback().textContent,`5 s ${target>0?'vor':'zurück'}`);});
test('seekable live/DVR window is bounded without crossing a gap',t=>{const s=setup(t);s.video.duration=Infinity;s.video.seekable={length:2,start:i=>[20,80][i],end:i=>[50,110][i]};s.setTime(45);s.swipe();assert.equal(s.video.currentTime,50);s.setTime(30);s.swipe(200,100);assert.equal(s.video.currentTime,20);s.setTime(60);s.swipe();assert.deepEqual(s.sets,[50,20]);});
for(const duration of [NaN,Infinity,0,-1])test(`no seek with unavailable timeline ${duration}`,t=>{const s=setup(t);s.video.duration=duration;s.swipe();assert.deepEqual(s.sets,[]);assert.equal(s.feedback(),null);});
test('refused or throwing setter cannot produce success feedback or a playback request',t=>{const s=setup(t);Object.defineProperty(s.video,'currentTime',{get:()=>30,set:()=>{},configurable:true});s.swipe();assert.equal(s.feedback(),null);Object.defineProperty(s.video,'currentTime',{get:()=>30,set:()=>{throw new Error('no');},configurable:true});s.swipe();assert.equal(s.feedback(),null);assert.deepEqual(s.calls,[]);});
test('media replacement inside the setter cannot announce a phantom success',t=>{const s=setup(t);let time=30;Object.defineProperty(s.video,'currentTime',{get:()=>time,set:v=>{time=v;s.video.src='https://example.test/new';},configurable:true});s.swipe();assert.equal(s.feedback(),null);});
for(const mutation of ['id','route','src','decoded-source','video','root','container','ad-class','ad-data','hidden','mini','native-drag','overlay','wireless','remote','native-fullscreen','seeking','error','not-ready','pose'])test(`candidate is cancelled by ${mutation}; release cannot seek stale media`,t=>{
  const s=setup(t);s.pointer('pointerdown',1,100,210);s.pointer('pointermove',1,180,210);
  if(mutation==='id')s.id('zyxwvutsrqp');if(mutation==='route')s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');if(mutation==='src')s.video.src='https://example.test/b';if(mutation==='decoded-source')Object.defineProperty(s.video,'currentSrc',{value:'https://example.test/c'});
  if(mutation==='video')s.video.replaceWith(s.video.cloneNode());if(mutation==='root')s.root.replaceWith(s.root.cloneNode(true));if(mutation==='container')s.container.replaceWith(s.container.cloneNode(true));if(mutation==='ad-class')s.root.classList.add('ad-showing');if(mutation==='ad-data')s.ad(true);
  if(mutation==='hidden')Object.defineProperty(s.doc,'hidden',{value:true,configurable:true});if(mutation==='mini')s.win.__langformStageInsets={nativeMini:true};if(mutation==='native-drag')s.win.__langformIsNativeDragging=()=>true;if(mutation==='overlay')s.win.__langformHasOpenOverlay=()=>true;
  if(mutation==='wireless')s.video.webkitCurrentPlaybackTargetIsWireless=true;if(mutation==='remote')s.video.remote={state:'connected'};if(mutation==='native-fullscreen')s.video.webkitDisplayingFullscreen=true;if(mutation==='seeking')s.video.seeking=true;if(mutation==='error')s.video.error={code:3};if(mutation==='not-ready')s.video.readyState=1;if(mutation==='pose')s.pose(rect(0,90,402,226));
  s.pointer('pointerup',1,180,210);assert.deepEqual(s.sets,[]);assert.equal(s.click().defaultPrevented,false);
});
for(const event of ['pointercancel','lostpointercapture'])test(`${event} never commits a seek, next contact may start fresh`,t=>{const s=setup(t);s.pointer('pointerdown',1,100,210);s.pointer('pointermove',1,180,210);s.pointer(event,1,180,210);assert.deepEqual(s.sets,[]);s.swipe();assert.deepEqual(s.sets,[45]);});
test('multi-contact and control-first contacts are cancelled without stealing a pinch or button',t=>{const s=setup(t);s.pointer('pointerdown',1,100,210);s.pointer('pointerdown',2,200,210);assert.equal(s.pointer('pointermove',1,250,210).defaultPrevented,false);s.pointer('pointerup',1,250,210);s.pointer('pointerup',2,200,210);assert.deepEqual(s.sets,[]);s.pointer('pointerdown',1,100,210,s.doc.getElementById('play'));s.pointer('pointerdown',2,200,210);s.pointer('pointerup',1,100,210);s.pointer('pointerup',2,300,210);assert.deepEqual(s.sets,[]);s.swipe();assert.deepEqual(s.sets,[45]);});
test('mouse, pen, wrong contact and already claimed input never seek',t=>{const s=setup(t);s.pointer('pointerdown',1,100,210,s.surface,{pointerType:'mouse'});s.pointer('pointerup',1,180,210);s.pointer('pointerdown',1,100,210,s.surface,{pointerType:'pen'});s.pointer('pointerup',1,180,210);s.pointer('pointerdown',1,100,210);s.pointer('pointermove',99,180,210);s.pointer('pointerup',99,180,210);assert.deepEqual(s.sets,[]);s.pointer('pointercancel',1,100,210);const e=new s.win.Event('pointerdown',{bubbles:true,cancelable:true});Object.assign(e,{pointerType:'touch',pointerId:1,clientX:100,clientY:210});e.preventDefault();s.surface.dispatchEvent(e);s.pointer('pointerup',1,180,210);assert.deepEqual(s.sets,[]);});
test('Touch fallback seeks once, rejects multi-contact and cancels on touchcancel',t=>{const s=setup(t,{touch:true});s.touch('touchstart',[[5,100,210]]);s.touch('touchmove',[[5,180,210]]);s.touch('touchend',[],s.surface,[[5,180,210]]);assert.deepEqual(s.sets,[45]);s.touch('touchstart',[[5,100,210]]);s.touch('touchstart',[[5,100,210],[8,200,210]]);s.touch('touchmove',[[5,250,210],[8,200,210]]);s.touch('touchend',[],s.surface,[[5,250,210],[8,200,210]]);assert.deepEqual(s.sets,[45]);s.touch('touchstart',[[5,200,210]]);s.touch('touchmove',[[5,100,210]]);s.touch('touchcancel',[],s.surface,[[5,100,210]]);assert.deepEqual(s.sets,[45]);});
test('Pointer-enabled engines ignore compatibility TouchEvents, no duplicate seek',t=>{const s=setup(t);s.swipe();s.touch('touchstart',[[1,100,210]]);s.touch('touchmove',[[1,180,210]]);s.touch('touchend',[],s.surface,[[1,180,210]]);assert.deepEqual(s.sets,[45]);});
test('20 alternating swipes and fresh taps remain once per contact without accumulated structure changes',t=>{const s=setup(t);const before=s.root.innerHTML,styles=s.video.getAttribute('style');for(let i=0;i<20;i++){s.swipe(i%2?200:100,i%2?100:200);s.pointer('pointerdown',1,100,210);s.pointer('pointerup',1,100,210);assert.equal(s.click().defaultPrevented,false);}assert.equal(s.sets.length,20);assert.equal(s.video.currentTime,30);assert.equal(s.root.innerHTML,before);assert.equal(s.video.getAttribute('style'),styles);});
for(const event of ['blur','resize','orientationchange','yt-navigate-start','popstate'])test(`${event} releases candidate, feedback and click suppression`,t=>{const s=setup(t);s.swipe();s.pointer('pointerdown',1,100,210);s.win.dispatchEvent(new s.win.Event(event));s.pointer('pointerup',1,180,210);assert.deepEqual(s.sets,[45]);assert.equal(s.feedback(),null);assert.equal(s.click().defaultPrevented,false);});
test('own fullscreen actual controls stay available after swipe; enlarged zoom owns pan instead of seek',t=>{const s=setup(t,{fullscreen:true});const ui=s.ui();s.swipe(300,420,200,ui);assert.deepEqual(s.sets,[45]);assert.equal(s.click(420,200,ui).defaultPrevented,true);ui.querySelector('[data-action=play]').click();assert.equal(s.video.paused,true);ui.querySelector('[data-action=forward]').click();assert.equal(s.video.currentTime,55);s.pointer('pointerdown',1,387,200,ui);s.pointer('pointerdown',2,487,200,ui);s.pointer('pointermove',1,337,200,ui);s.pointer('pointermove',2,537,200,ui);s.pointer('pointerup',1,337,200,ui);s.pointer('pointerup',2,537,200,ui);assert.equal(s.win.__langformPlaybackZoom.getState().scale,2);const before=s.sets.length;s.swipe(300,420,200,ui);assert.equal(s.sets.length,before);assert.ok(s.win.__langformPlaybackZoom.getState().x>0);ui.querySelector('[data-action=exit]').click();assert.equal(s.ui(),null);assert.equal(s.video.paused,true);});
test('own fullscreen speed panel or scrub blocks competing picture swipe',t=>{const s=setup(t,{fullscreen:true});s.ui().querySelector('.lf-fs-speed-button').click();s.swipe(300,420,200,s.ui());assert.deepEqual(s.sets,[]);s.ui().querySelector('.lf-fs-speed-button').click();s.pointer('pointerdown',1,100,210,s.ui().querySelector('input'));s.swipe(300,420,200,s.ui());assert.deepEqual(s.sets,[]);});
test('hold timer is cancelled by moved contact and active 2x is restored before seek',t=>{const s=setup(t,{hold:true});s.pointer('pointerdown',1,100,210);const entry=[...s.timers.entries()].find(([,v])=>v.delay===350);assert.ok(entry);s.timers.delete(entry[0]);entry[1].fn();assert.equal(s.video.playbackRate,2);s.pointer('pointermove',1,180,210);assert.equal(s.video.playbackRate,1);s.pointer('pointerup',1,180,210);assert.deepEqual(s.sets,[45]);s.pointer('pointerdown',1,100,210);s.pointer('pointermove',1,180,210);assert.equal([...s.timers.values()].filter(v=>v.delay===350).length,0);s.pointer('pointerup',1,180,210);assert.equal(s.video.playbackRate,1);});
test('touch-action lease is confined to current inline surfaces and restores author attributes after BFCache',async t=>{const s=setup(t);assert.equal(s.root.hasAttribute('data-langform-playback-swipe-surface'),true);assert.equal(s.shared.hasAttribute('data-langform-playback-swipe-surface'),true);assert.equal(s.container.hasAttribute('data-langform-playback-swipe-surface'),false);s.root.setAttribute('data-langform-playback-swipe-surface','author-new');s.win.dispatchEvent(new s.win.PageTransitionEvent('pagehide',{persisted:true}));assert.equal(s.root.getAttribute('data-langform-playback-swipe-surface'),'author-new');assert.equal(s.shared.hasAttribute('data-langform-playback-swipe-surface'),false);assert.equal(s.doc.getElementById('langform-playback-swipe-style'),null);s.win.dispatchEvent(new s.win.PageTransitionEvent('pageshow',{persisted:true}));assert.equal(s.root.hasAttribute('data-langform-playback-swipe-surface'),true);s.win.dispatchEvent(new s.win.PageTransitionEvent('pagehide',{persisted:true}));assert.equal(s.root.getAttribute('data-langform-playback-swipe-surface'),'author-new');});
test('status disappears after900ms and injection is idempotent',t=>{const s=setup(t);s.win.eval(source);s.swipe();assert.deepEqual(s.sets,[45]);const timer=[...s.timers.values()].find(v=>v.delay===900);assert.ok(timer);timer.fn();assert.equal(s.feedback(),null);assert.equal(s.doc.querySelectorAll('#langform-playback-swipe-style').length,1);});
for(const hidden of ['video','root','shared'])test(`visually hidden ${hidden} cannot own picture gesture or keep its touch-action lease`,async t=>{const s=setup(t);s[hidden].style.visibility='hidden';s.video.dispatchEvent(new s.win.Event('loadeddata',{bubbles:true}));s.swipe();assert.deepEqual(s.sets,[]);assert.equal(s.root.hasAttribute('data-langform-playback-swipe-surface'),false);});
test('slow sub56px movement remains unclaimed instead of consuming a non-swipe',t=>{const s=setup(t);s.pointer('pointerdown',1,100,210);s.tick(650);assert.equal(s.pointer('pointermove',1,132,210).defaultPrevented,false);assert.equal(s.pointer('pointerup',1,132,210).defaultPrevented,false);assert.equal(s.click().defaultPrevented,false);assert.deepEqual(s.sets,[]);});
test('empty or unready main media never leases inline touch policy; finite loaded media can acquire it later',t=>{const s=setup(t);s.video.readyState=1;s.video.dispatchEvent(new s.win.Event('loadstart',{bubbles:true}));assert.equal(s.root.hasAttribute('data-langform-playback-swipe-surface'),false);s.video.readyState=4;s.video.dispatchEvent(new s.win.Event('loadeddata',{bubbles:true}));assert.equal(s.root.hasAttribute('data-langform-playback-swipe-surface'),true);});
test('changed contact cannot finish Touch candidate and no phantom seek survives to the next fresh contact',t=>{const s=setup(t,{touch:true});s.touch('touchstart',[[7,100,210]]);s.touch('touchmove',[[8,180,210]]);s.touch('touchend',[],s.surface,[[7,180,210]]);assert.deepEqual(s.sets,[]);s.touch('touchstart',[[9,100,210]]);s.touch('touchend',[],s.surface,[[9,180,210]]);assert.deepEqual(s.sets,[45]);});
for(const cls of ['player-control-overlay','player-controls-middle','player-controls-background','player-controls-content','player-controls-background-container'])test(`empty mweb ${cls} surface remains an admitted picture; nested real button is protected`,t=>{const s=setup(t);s.surface.className=cls;s.swipe();assert.deepEqual(s.sets,[45]);s.swipe(100,180,210,s.doc.getElementById('play'));assert.deepEqual(s.sets,[45]);});
test('unavailable or malformed seekable window leaves the gesture entirely unclaimed',t=>{const s=setup(t);s.video.duration=Infinity;s.pointer('pointerdown',1,100,210);assert.equal(s.pointer('pointermove',1,180,210).defaultPrevented,false);assert.equal(s.pointer('pointerup',1,180,210).defaultPrevented,false);s.video.duration=120;s.video.seekable={length:1,start:()=>60,end:()=>80};s.pointer('pointerdown',1,100,210);assert.equal(s.pointer('pointermove',1,180,210).defaultPrevented,false);s.pointer('pointerup',1,180,210);assert.deepEqual(s.sets,[]);});
test('Touch fallback fresh-contact click recovery, end-only and real control-first remain intact',t=>{const s=setup(t,{touch:true});s.touch('touchstart',[[7,100,210]]);s.touch('touchend',[],s.surface,[[7,180,210]]);assert.deepEqual(s.sets,[45]);assert.equal(s.click().defaultPrevented,true);s.touch('touchstart',[[8,100,210]]);s.touch('touchend',[],s.surface,[[8,180,210]]);s.touch('touchstart',[[9,100,210]]);s.touch('touchend',[],s.surface,[[9,100,210]]);assert.equal(s.click().defaultPrevented,false);const button=s.doc.getElementById('play');s.touch('touchstart',[[11,100,210]],button);s.touch('touchmove',[[11,180,210]],button);s.touch('touchend',[],button,[[11,180,210]]);assert.equal(s.click(150,210,button).defaultPrevented,false);assert.deepEqual(s.sets,[45,60]);});
test('unrelated Touch release cannot commit or end the candidate, matching release remains once',t=>{const s=setup(t,{touch:true});s.touch('touchstart',[[7,100,210]]);s.touch('touchmove',[[7,180,210]]);s.touch('touchend',[[7,180,210]],s.surface,[[99,180,210]]);assert.deepEqual(s.sets,[]);s.touch('touchend',[],s.surface,[[7,180,210]]);assert.deepEqual(s.sets,[45]);});
test('new source or navigation cannot inherit trailing suppression, status or inline old-owner markers',async t=>{const s=setup(t);s.swipe();s.video.src='https://example.test/b';await Promise.resolve();assert.equal(s.feedback(),null);assert.equal(s.click().defaultPrevented,false);s.win.history.replaceState({},'','/feed/subscriptions');s.win.dispatchEvent(new s.win.Event('state-navigateend'));assert.equal(s.root.hasAttribute('data-langform-playback-swipe-surface'),false);assert.equal(s.shared.hasAttribute('data-langform-playback-swipe-surface'),false);});
test('native Mini, magnified source and committed fullscreen never keep the inline touch-action marker',async t=>{const s=setup(t);s.doc.documentElement.setAttribute('data-langform-mini-video','');await Promise.resolve();assert.equal(s.root.hasAttribute('data-langform-playback-swipe-surface'),false);s.doc.documentElement.removeAttribute('data-langform-mini-video');s.win.__langformPlaybackZoom={getState:()=>({scale:2,gesturing:false})};s.video.dispatchEvent(new s.win.Event('loadeddata',{bubbles:true}));assert.equal(s.root.hasAttribute('data-langform-playback-swipe-surface'),false);const f=setup(t,{fullscreen:true});await Promise.resolve();assert.equal(f.root.hasAttribute('data-langform-playback-swipe-surface'),false);assert.equal(f.shared.hasAttribute('data-langform-playback-swipe-surface'),false);});
test('native cancellation removes the whole candidate and touch policy before any late release',t=>{const s=setup(t);s.pointer('pointerdown',1,100,210);s.pointer('pointermove',1,180,210);s.win.__langformPlaybackSwipe.cancel();assert.equal(s.root.hasAttribute('data-langform-playback-swipe-surface'),false);s.pointer('pointerup',1,180,210);assert.deepEqual(s.sets,[]);assert.equal(s.click().defaultPrevented,false);});
test('unrelated feed/comment hydration does not force media layout on every document mutation',async t=>{const s=setup(t);let reads=0;const original=s.video.getBoundingClientRect;s.video.getBoundingClientRect=()=>{reads++;return original();};const outside=s.doc.getElementById('outside');outside.className='hydrating';outside.appendChild(s.doc.createElement('span'));await Promise.resolve();assert.equal(reads,0);outside.firstChild.textContent='other';await Promise.resolve();assert.equal(reads,0);});
test('stale native videoID cancellation cannot erase a new current swipe; matching videoID still cancels',t=>{const s=setup(t);s.pointer('pointerdown',1,100,210);s.pointer('pointermove',1,180,210);s.win.__langformPlaybackSwipe.cancel('zyxwvutsrqp');s.pointer('pointerup',1,180,210);assert.deepEqual(s.sets,[45]);s.pointer('pointerdown',1,100,210);s.win.__langformPlaybackSwipe.cancel('abcdefghijk');s.pointer('pointerup',1,180,210);assert.deepEqual(s.sets,[45]);});
test('relevant rapid mutations coalesce into one frame; no continuous player layout polling',async t=>{const s=setup(t);let reads=0;const original=s.video.getBoundingClientRect;s.video.getBoundingClientRect=()=>{reads++;return original();};for(let i=0;i<20;i++)s.root.className='pose-'+i;await Promise.resolve();assert.equal(reads,0);await new Promise(resolve=>s.win.requestAnimationFrame(resolve));assert.equal(reads,1);await new Promise(resolve=>s.win.requestAnimationFrame(resolve));assert.equal(reads,1);});
test('inline author visibility change revokes input immediately and touch policy at next scheduled frame',async t=>{const s=setup(t);s.pointer('pointerdown',1,100,210);s.video.style.visibility='hidden';s.pointer('pointerup',1,180,210);assert.deepEqual(s.sets,[]);await Promise.resolve();await new Promise(resolve=>s.win.requestAnimationFrame(resolve));assert.equal(s.root.hasAttribute('data-langform-playback-swipe-surface'),false);});
test('existing native-drag-end rearms inline policy before the first immediate resumed picture swipe',t=>{const s=setup(t);let dragging=false;s.win.__langformIsNativeDragging=()=>dragging;dragging=true;s.win.__langformPlaybackSwipe.cancel('abcdefghijk');assert.equal(s.root.hasAttribute('data-langform-playback-swipe-surface'),false);s.swipe();assert.deepEqual(s.sets,[]);dragging=false;s.win.dispatchEvent(new s.win.Event('langform-native-drag-end'));assert.equal(s.root.hasAttribute('data-langform-playback-swipe-surface'),true);s.swipe();assert.deepEqual(s.sets,[45]);});
for(const touch of [false,true])test(`shipping Zoom→Swipe→Hold order recovers after pinch/reset with a fresh primary identifier; touch=${touch}`,t=>{const s=setup(t,{fullscreen:true,hold:true,touch});const ui=s.ui();if(touch){s.touch('touchstart',[[1,350,400]],ui);s.touch('touchstart',[[1,350,400],[2,450,400]],ui);s.touch('touchmove',[[1,300,400],[2,500,400]],ui);s.touch('touchend',[[2,500,400]],ui,[[1,300,400]]);s.touch('touchend',[],ui,[[2,500,400]]);}else{s.pointer('pointerdown',1,350,400,ui);s.pointer('pointerdown',2,450,400,ui);s.pointer('pointermove',1,300,400,ui);s.pointer('pointermove',2,500,400,ui);s.pointer('pointerup',1,300,400,ui);s.pointer('pointerup',2,500,400,ui);}assert.equal(s.win.__langformPlaybackZoom.getState().scale,2);assert.deepEqual(s.sets,[]);ui.querySelector('.lf-playback-zoom-reset').click();assert.equal(s.win.__langformPlaybackZoom.getState().scale,1);if(touch){s.touch('touchstart',[[3,350,400]],ui);s.touch('touchmove',[[3,430,400]],ui);s.touch('touchend',[],ui,[[3,430,400]]);}else{s.pointer('pointerdown',3,350,400,ui,{isPrimary:true});s.pointer('pointermove',3,430,400,ui,{isPrimary:true});s.pointer('pointerup',3,430,400,ui,{isPrimary:true});}assert.deepEqual(s.sets,[45]);assert.equal(s.feedback().textContent,'15 s vor');assert.equal(s.video.playbackRate,1);assert.deepEqual(s.calls,[]);});
test('shipping pinch cancel/zoom reset followed by rapid new primary contacts never retains phantom contacts',t=>{const s=setup(t,{fullscreen:true});const ui=s.ui();s.pointer('pointerdown',1,350,400,ui);s.pointer('pointerdown',2,450,400,ui);s.pointer('pointermove',1,300,400,ui);s.pointer('pointermove',2,500,400,ui);s.pointer('pointercancel',1,300,400,ui);s.pointer('pointerup',2,500,400,ui);ui.querySelector('.lf-playback-zoom-reset').click();for(const id of [3,8,12,21]){s.pointer('pointerdown',id,350,400,ui,{isPrimary:true});s.pointer('pointermove',id,430,400,ui,{isPrimary:true});s.pointer('pointerup',id,430,400,ui,{isPrimary:true});}assert.deepEqual(s.sets,[45,60,75,90]);});

for(const cls of ['ytp-chrome-top','ytp-chrome-bottom'])test(`empty ${cls} picture regions admit swipe while nested controls keep their input`,t=>{
  const s=setup(t);s.surface.className=cls;s.swipe(100,180,120);s.swipe(350,200,326);
  assert.deepEqual(s.sets,[45,30]);
  for(const target of [s.doc.getElementById('play'),s.surface.querySelector('input'),s.surface.querySelector('a')]){
    s.swipe(100,180,210,target);assert.equal(s.click(150,210,target).defaultPrevented,false);
  }
  assert.deepEqual(s.sets,[45,30]);
});
test('own fullscreen control bars reserve their padding for controls and never perform a picture seek',t=>{
  const s=setup(t,{fullscreen:true});const ui=s.ui(),padding=ui.querySelector('.lf-fs-controls');
  s.swipe(200,320,40,padding);s.swipe(450,330,830,padding);assert.deepEqual(s.sets,[]);
  for(const target of [ui.querySelector('[data-action=play]'),ui.querySelector('input')])s.swipe(200,320,40,target);
  assert.deepEqual(s.sets,[]);assert.deepEqual(s.calls,[]);
  s.swipe(200,320,200,ui);assert.deepEqual(s.sets,[45],'the free fullscreen picture still supports seeking');
});
for(const touch of [false,true])test(`hidden fullscreen timeline keeps its physical strip when browser retargets to picture; touch=${touch}`,t=>{
  const s=setup(t,{fullscreen:true,touch}),ui=s.ui(),range=ui.querySelector('input');
  range.getBoundingClientRect=()=>rect(20,800,834,44);ui.setAttribute('data-hidden','');
  if(touch){s.touch('touchstart',[[7,200,820]],ui);s.touch('touchmove',[[7,320,820]],ui);s.touch('touchend',[],ui,[[7,320,820]]);}else s.swipe(200,320,820,ui);
  assert.deepEqual(s.sets,[],'a contact on the timeline must not become a ±15s picture seek');
  if(touch){s.touch('touchstart',[[8,200,600]],ui);s.touch('touchmove',[[8,320,600]],ui);s.touch('touchend',[],ui,[[8,320,600]]);}else s.swipe(200,320,600,ui);
  assert.deepEqual(s.sets,[45],'free picture immediately outside the timeline still seeks');
});
for(const cls of ['ytp-progress-bar-container','ytp-progress-bar','ytp-scrubber-container','player-controls-progress-bar','ytmProgressBarViewModelHost','ytmProgressBarViewModelProgressBar','ytmScrubberViewModelHost'])test(`actual ${cls} timeline remains excluded from picture swipe`,t=>{
  const s=setup(t),timeline=s.doc.createElement('div');timeline.className=cls;s.surface.appendChild(timeline);
  s.swipe(100,180,210,timeline);assert.deepEqual(s.sets,[]);assert.equal(s.click(150,210,timeline).defaultPrevented,false);
});
for(const touch of [false,true])test(`ended video can seek back with fresh input without starting playback; touch=${touch}`,t=>{
  const s=setup(t,{paused:true,touch});s.setTime(120);s.video.ended=true;s.video.dispatchEvent(new s.win.Event('ended',{bubbles:true}));
  if(touch){s.touch('touchstart',[[4,250,210]]);s.touch('touchmove',[[4,150,210]]);s.touch('touchend',[],s.surface,[[4,150,210]]);}else s.swipe(250,150);
  assert.deepEqual(s.sets,[105]);assert.equal(s.video.paused,true);assert.deepEqual(s.calls,[]);
  if(touch){s.touch('touchstart',[[5,150,210]]);s.touch('touchend',[],s.surface,[[5,150,210]]);}else{s.pointer('pointerdown',2,150,210,s.surface,{isPrimary:true});s.pointer('pointerup',2,150,210);}
  assert.equal(s.click(150,210).defaultPrevented,false);
});

for(const touch of [false,true])test(`whole 4:3 free root includes both sidebars and preserves pause; touch=${touch}`,t=>{
  const s=setup(t,{paused:true,touch});s.video.getBoundingClientRect=()=>rect(50,110,301,226);
  for(const [from,to] of [[10,90],[390,310]]){
    if(touch){s.touch('touchstart',[[9,from,210]]);s.touch('touchmove',[[9,to,210]]);s.touch('touchend',[],s.surface,[[9,to,210]]);}else s.swipe(from,to);
  }
  assert.deepEqual(s.sets,[45,30]);assert.equal(s.video.paused,true);assert.deepEqual(s.calls,[]);
  const area=s.win.__langformPlaybackSwipe.getSeekRect(s.video,'abcdefghijk');assert.deepEqual(JSON.parse(JSON.stringify(area)),{x:0,y:110,width:402,height:226,videoID:'abcdefghijk'});
  s.swipe(450,370);s.swipe(10,90,95);assert.deepEqual(s.sets,[45,30]);
  s.swipe(10,90,210,s.doc.getElementById('play'));assert.deepEqual(s.sets,[45,30]);
});
for(const touch of [false,true])test(`actual offscreen ended media seeks back through visible root without Play; touch=${touch}`,t=>{
  const s=setup(t,{paused:true,touch});s.setTime(120);s.video.ended=true;s.video.getBoundingClientRect=()=>rect(0,-568,402,226);
  if(touch){s.touch('touchstart',[[7,250,210]]);s.touch('touchmove',[[7,150,210]]);s.touch('touchend',[],s.surface,[[7,150,210]]);}else s.swipe(250,150);
  assert.deepEqual(s.sets,[105]);assert.equal(s.video.paused,true);assert.deepEqual(s.calls,[]);
});
for(const condition of ['wrong-video','wrong-id','ad','hidden-root','disjoint-playing','empty-root','zoom'])test(`root Seek export retains exact current context guards: ${condition}`,t=>{
  const s=setup(t);let video=s.video,id='abcdefghijk';
  if(condition==='wrong-video')video=s.doc.createElement('video');if(condition==='wrong-id')id='lmnopqrstuv';if(condition==='ad')s.ad(true);
  if(condition==='hidden-root')s.root.style.visibility='hidden';if(condition==='disjoint-playing')s.video.getBoundingClientRect=()=>rect(0,-568,402,226);if(condition==='empty-root')s.root.getBoundingClientRect=()=>rect(0,110,0,0);
  if(condition==='zoom')s.win.__langformPlaybackZoom.getState=()=>({scale:2,gesturing:false});
  assert.equal(s.win.__langformPlaybackSwipe.getSeekRect(video,id),null);
});

function endedSeekContact(s,touch,gap=true,ended=true){
  let time=ended?120:115,pose=ended?rect(0,-568,402,226):rect(50,110,301,226);
  s.video.ended=ended;s.video.paused=true;
  s.video.getBoundingClientRect=()=>pose;
  Object.defineProperty(s.video,'currentTime',{configurable:true,get:()=>time,set:value=>{s.sets.push(value);time=value;s.video.ended=false;pose=gap?rect(0,-568,402,226):rect(50,110,301,226);}});
  let leaked=0;s.surface.className='ytwPlayerEndscreenPlayerEndscreen';
  s.surface.addEventListener('click',event=>{if(event.target.closest('button,a,input,[role=button],[role=slider]'))return;leaked++;s.video.paused=false;});
  if(touch){s.touch('touchstart',[[7,250,210]]);s.touch('touchmove',[[7,150,210]]);s.touch('touchend',[],s.surface,[[7,150,210]]);}else s.swipe(250,150);
  assert.deepEqual(s.sets,[ended?105:100]);assert.equal(s.video.paused,true);
  return{leaked:()=>leaked,reflow:()=>{pose=rect(50,110,301,226);}};
}
for(const touch of [false,true])test(`ended seek trailing click retains pause across temporary offscreen media; touch=${touch}`,t=>{
 const s=setup(t,{paused:true,touch}),probe=endedSeekContact(s,touch);
 assert.equal(s.click(150,210).defaultPrevented,true);
 assert.equal(probe.leaked(),0);assert.equal(s.video.paused,true);assert.equal(s.video.currentTime,105);
});
for(const touch of [false,true])test(`ended seek synthetic tap then click cannot restart the same media; touch=${touch}`,t=>{
 const s=setup(t,{paused:true,touch}),probe=endedSeekContact(s,touch,false);
 const tap=new s.win.MouseEvent('tap',{bubbles:true,cancelable:true,clientX:150,clientY:210});s.surface.dispatchEvent(tap);
 assert.equal(tap.defaultPrevented,true);assert.equal(s.click(150,210).defaultPrevented,true);
 assert.equal(probe.leaked(),0);assert.equal(s.video.paused,true);
});
for(const condition of ['fresh-touch','source','route','player-id','ad','root','container','root-pose','hidden-root','real-control','outside-root','expired','normal-pause-disjoint'])test(`ended seek trailing exception retains ${condition} boundary`,t=>{
 const s=setup(t,{paused:true}),probe=endedSeekContact(s,false,true,condition!=='normal-pause-disjoint');
 if(condition==='fresh-touch'){s.pointer('pointerdown',2,150,210,s.surface,{isPrimary:true});s.pointer('pointerup',2,150,210);}
 if(condition==='source')s.video.src='https://example.test/new-source';
 if(condition==='route')s.win.history.replaceState({},'','/watch?v=lmnopqrstuv');
 if(condition==='player-id')s.id('lmnopqrstuv');if(condition==='ad')s.ad(true);
 if(condition==='root')s.root.id='former-player';
 if(condition==='container'){const replacement=s.doc.createElement('div');replacement.className='html5-video-container';s.root.appendChild(replacement);replacement.appendChild(s.video);}
 if(condition==='root-pose')s.pose(rect(0,130,402,226));if(condition==='hidden-root')s.root.style.visibility='hidden';if(condition==='expired')s.tick(801);
 const target=condition==='real-control'?s.doc.getElementById('play'):condition==='outside-root'?s.doc.getElementById('outside'):s.surface;
 assert.equal(s.click(150,210,target).defaultPrevented,false);
});

function seekedResumeEngine(s,{ended=true,paused=true,noop=false,switchSource=false,deferred=false}={}){
  let time=ended?120:110,modelEnded=ended,api=0,fallback=0;
  s.video.ended=ended;s.video.paused=paused;s.video.getBoundingClientRect=()=>rect(50,110,301,226);
  Object.defineProperty(s.video,'currentTime',{configurable:true,get:()=>time,set:value=>{s.sets.push(value);time=value;s.video.ended=false;}});
  s.root.pauseVideo=()=>{api++;if(switchSource){s.video.src='https://example.test/replacement';return;}if(!modelEnded && !noop)s.video.paused=true;};
  s.video.pause=()=>{fallback++;s.video.paused=true;};
  // Like the live trace: seeked is seen paused, then YouTube's target handler
  // resumes the same source. Its ENDED model cannot be pre-paused by pauseVideo.
  s.video.addEventListener('seeked',()=>{if(modelEnded){modelEnded=false;if(!deferred){s.video.paused=false;s.video.dispatchEvent(new s.win.Event('play',{bubbles:true}));}}});
  s.swipe(250,150);
  assert.equal(api,0,'no speculative pre-seek pause while the player model is still ENDED');
  return{seeked:()=>s.video.dispatchEvent(new s.win.Event('seeked',{bubbles:true})),play:()=>{s.video.paused=false;s.video.dispatchEvent(new s.win.Event('play',{bubbles:true}));},api:()=>api,fallback:()=>fallback};
}
for(const noop of [false,true])test(`owned ended-paused seek corrects one actual seeked autoresume, API noop=${noop}`,async t=>{
 const s=setup(t,{paused:true}),engine=seekedResumeEngine(s,{noop});engine.seeked();
 assert.equal(s.video.paused,false,'fixture reproduces YouTube resume after seeked');
 await Promise.resolve();await Promise.resolve();
 assert.equal(engine.api(),1);assert.equal(engine.fallback(),noop?1:0);assert.equal(s.video.paused,true);assert.equal(s.video.currentTime,105);
 engine.play();await Promise.resolve();assert.equal(engine.api(),1,'consumed transaction never becomes a continuous pause guard');assert.equal(s.video.paused,false);
});
for(const paused of [false,true])test(`ordinary seek never issues pause intent, paused=${paused}`,async t=>{
 const s=setup(t,{paused}),engine=seekedResumeEngine(s,{ended:false,paused});engine.seeked();await Promise.resolve();
 assert.equal(engine.api(),0);assert.equal(engine.fallback(),0);assert.equal(s.video.paused,paused);
});
for(const condition of ['fresh-touch','native-play','control','key','source','id','ad','root-pose','lifecycle','expired'])test(`queued ended seek pause intent is revoked by ${condition}`,async t=>{
 const s=setup(t,{paused:true}),engine=seekedResumeEngine(s);engine.seeked();
 if(condition==='fresh-touch')s.pointer('pointerdown',2,150,210,s.surface,{isPrimary:true});
 if(condition==='native-play')s.win.__langformPlaybackSwipe.cancelEndedSeekGuard('abcdefghijk');
 if(condition==='control')s.click(150,210,s.doc.getElementById('play'));
 if(condition==='key')s.win.dispatchEvent(new s.win.KeyboardEvent('keydown',{key:' '}));
 if(condition==='source')s.video.src='https://example.test/replacement';if(condition==='id')s.id('lmnopqrstuv');if(condition==='ad')s.ad(true);
 if(condition==='root-pose')s.pose(rect(0,130,402,226));if(condition==='lifecycle')s.win.dispatchEvent(new s.win.Event('blur'));if(condition==='expired')s.tick(1501);
 await Promise.resolve();await Promise.resolve();assert.equal(engine.api(),0);assert.equal(engine.fallback(),0);assert.equal(s.video.paused,false);
});
test('API pause source replacement cannot authorize a fallback pause on the new source',async t=>{
 const s=setup(t,{paused:true}),engine=seekedResumeEngine(s,{switchSource:true});engine.seeked();await Promise.resolve();
 assert.equal(engine.api(),1);assert.equal(engine.fallback(),0);assert.equal(s.video.paused,false);
});
test('delayed same-source resume after the seeked microtask consumes its pause intent once',async t=>{
 const s=setup(t,{paused:true}),engine=seekedResumeEngine(s,{deferred:true});engine.seeked();await Promise.resolve();
 assert.equal(s.video.paused,true);assert.equal(engine.api(),0);
 engine.play();await Promise.resolve();assert.equal(engine.api(),1);assert.equal(s.video.paused,true);
 engine.play();await Promise.resolve();assert.equal(engine.api(),1);assert.equal(s.video.paused,false);
});
test('ended seek transaction timeout only releases intent and never pauses playback',async t=>{
 const s=setup(t,{paused:true}),engine=seekedResumeEngine(s,{deferred:true});engine.seeked();await Promise.resolve();
 const timeout=[...s.timers.values()].find(timer=>timer.delay===1500);assert.ok(timeout);timeout.fn();
 assert.equal(engine.api(),0);engine.play();await Promise.resolve();assert.equal(engine.api(),0);assert.equal(s.video.paused,false);
});
