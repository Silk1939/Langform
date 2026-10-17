const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const directory=path.join(__dirname,'../ios/Langform/Langform');
const source=fs.readFileSync(process.env.LANGFORM_DOUBLETAP_SOURCE || path.join(directory,'PlaybackSwipe.js'),'utf8');
const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
function setup(t,{touch=false,paused=false,fullscreen=false,playerRect=false,webLinks=false,hold=true,compatibility=false,trustedEvents=false}={}){
  const dom=new JSDOM('<!doctype html><html><head></head><body><ytm-player><div id="movie_player"><div class="html5-video-container"><video src="https://example.test/a"></video></div><button class="ytp-fullscreen-button">Fullscreen</button></div><div class="player-control-overlay" id="surface"><button id="play">Play</button><input type="range"><a href="#">Link</a><span role="slider">Slider</span></div></ytm-player><p id="outside">Outside</p></body></html>',{url:'https://m.youtube.com/watch?v=abcdefghijk',runScripts:'outside-only',pretendToBeVisual:true});
  const win=dom.window,doc=win.document,root=doc.getElementById('movie_player'),video=root.querySelector('video'),surface=doc.getElementById('surface'),errors=[],sets=[],calls=[],timers=new Map();
  // jsdom cannot create a trusted browser event. A cached facade supplies that
  // one external input fact to shipping window handlers, preserving event
  // identity and all real dispatch/default/propagation behavior underneath.
  if(trustedEvents){
    const add=win.addEventListener.bind(win),facades=new WeakMap();
    win.addEventListener=(name,listener,options)=>add(name,typeof listener==='function'?function(event){
      if(!event.__fixtureTrusted)return listener.call(this,event);
      if(!facades.has(event))facades.set(event,new Proxy(event,{get:(target,key)=>key==='isTrusted'?true:typeof target[key]==='function'?target[key].bind(target):target[key]}));
      return listener.call(this,facades.get(event));
    }:listener,options);
  }
  win.addEventListener('error',event=>{errors.push(event.message);event.preventDefault();});
  t.after(()=>{win.dispatchEvent(new win.Event('pagehide'));assert.deepEqual(errors,[]);win.close();});
  if(!touch)win.PointerEvent=win.MouseEvent;
  Object.defineProperties(win,{innerWidth:{value:874,writable:true},innerHeight:{value:874,writable:true}});
  let time=30,now=1000,serial=0,mediaID='abcdefghijk',ad=false,pose=rect(0,110,402,226),ordinaryClicks=0;
  root.getVideoData=()=>({video_id:mediaID,isAd:ad});
  Object.defineProperties(video,{currentSrc:{get:()=>video.src,configurable:true},videoWidth:{value:1920,writable:true},videoHeight:{value:1080,writable:true},readyState:{value:4,writable:true},error:{value:null,writable:true},seeking:{value:false,writable:true},duration:{value:120,writable:true},paused:{value:paused,writable:true},ended:{value:false,writable:true},currentTime:{get:()=>time,set:value=>{sets.push(value);time=value;},configurable:true},playbackRate:{value:1,writable:true},seekable:{value:{length:0},writable:true}});
  root.getBoundingClientRect=()=>root.hasAttribute('data-langform-fullscreen-player')?rect(0,0,win.innerWidth,win.innerHeight):pose;
  video.getBoundingClientRect=()=>root.getBoundingClientRect();
  win.Date.now=()=>now;win.setTimeout=(fn,delay)=>{const key=++serial;timers.set(key,{fn,delay});return key;};win.clearTimeout=key=>timers.delete(key);win.scrollTo=()=>{};
  win.webkit={messageHandlers:{langformFullscreen:{postMessage:()=>{}}}};
  win.__langformTogglePlayback=id=>{calls.push(['toggle',id]);video.paused=!video.paused;return true;};
  win.__langformPlay=id=>{calls.push(['play',id]);video.paused=false;return true;};
  // Actual injection order, including competing pinch, hold and fullscreen owners.
  if(webLinks)win.eval(fs.readFileSync(path.join(directory,'WebViewLinks.js'),'utf8'));
  for(const file of ['PlaybackZoom.js'])win.eval(fs.readFileSync(path.join(directory,file),'utf8'));
  win.eval(source);if(hold)win.eval(fs.readFileSync(path.join(directory,'PlaybackHold.js'),'utf8'));
  if(fullscreen){win.eval(fs.readFileSync(path.join(directory,'FullscreenMotion.js'),'utf8'));root.querySelector('button').click();}
  let controlToggles=0;
  if(playerRect){const toggle=doc.createElement('button');toggle.id='player-controls-a11y-toggle';root.appendChild(toggle);toggle.addEventListener('click',()=>controlToggles++);win.eval(fs.readFileSync(path.join(directory,'PlayerRect.js'),'utf8'));}
  surface.addEventListener('click',event=>{if(!event.target.closest('button,a,input,[role=slider]'))ordinaryClicks++;});
  function pointer(type,id,x,y,target=surface,extra={}){const event=new win.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{__fixtureTrusted:trustedEvents,pointerType:'touch',pointerId:id,isPrimary:id===1,button:0,clientX:x,clientY:y,...extra});target.dispatchEvent(event);return event;}
  function webtouch(type,x,y,target=surface,id=1){const event=new win.Event(type==='down'?'touchstart':type==='up'?'touchend':'touchcancel',{bubbles:true,cancelable:true}),point={identifier:id,clientX:x,clientY:y,target};event.__fixtureTrusted=trustedEvents;Object.defineProperties(event,{touches:{value:type==='down'?[point]:[]},changedTouches:{value:type==='down'?[]:[point]}});target.dispatchEvent(event);return event;}
  function contact(type,x,y,target=surface,id=1){if(touch)return webtouch(type,x,y,target,id);const event=pointer(type==='down'?'pointerdown':type==='up'?'pointerup':'pointercancel',id,x,y,target);if(compatibility)webtouch(type,x,y,target,id);return event;}
  function click(x=100,y=210,target=surface,type='click',detail=type==='dblclick'?2:1){const event=new win.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,detail});event.__fixtureTrusted=trustedEvents;target.dispatchEvent(event);return event;}
  function tap(x=100,y=210,target=surface,{duration=60,clickEvent=true}={}){contact('down',x,y,target);now+=duration;const end=contact('up',x,y,target);const result=clickEvent?click(x,y,target):null;return{end,click:result};}
  function double(x=100,y=210,target=surface){tap(x,y,target);now+=100;return tap(x,y,target);}
  function fire(delay){for(const[key,timer]of [...timers])if(timer.delay===delay){timers.delete(key);timer.fn();}}
  return{win,doc,root,video,surface,sets,calls,timers,pointer,webtouch,contact,click,tap,double,fire,tick:ms=>{now+=ms;},id:value=>{mediaID=value;},ad:value=>{ad=value;},setTime:value=>{time=value;},pose:value=>{pose=value;},ordinaryClicks:()=>ordinaryClicks,controlToggles:()=>controlToggles,ui:()=>doc.getElementById('langform-fullscreen-ui'),feedback:()=>doc.getElementById('langform-playback-swipe-status')};
}
for(const touch of [false,true])for(const paused of [false,true])test(`two short same-side contacts seek exactly ten seconds; touch=${touch}, paused=${paused}`,t=>{
  const s=setup(t,{touch,paused});s.video.playbackRate=1.5;
  const first=s.tap(310);assert.equal(first.end.defaultPrevented,false);assert.equal(first.click.defaultPrevented,false);assert.equal(s.ordinaryClicks(),1);assert.deepEqual(s.sets,[]);
  s.tick(100);const second=s.tap(310);assert.equal(second.end.defaultPrevented,true);assert.equal(second.click.defaultPrevented,true);assert.deepEqual(s.sets,[40]);assert.equal(s.feedback().textContent,'10 s vor');
  s.double(100);assert.deepEqual(s.sets,[40,30]);assert.equal(s.feedback().textContent,'10 s zurück');assert.equal(s.video.paused,paused);assert.equal(s.video.playbackRate,1.5);assert.deepEqual(s.calls,[]);
});
for(const touch of [false,true])test(`actual inline PlayerRect single-tap controls remain immediate; touch=${touch}`,t=>{
  const s=setup(t,{touch,playerRect:true,compatibility:true});
  s.tap(100);assert.equal(s.controlToggles(),1);assert.deepEqual(s.sets,[]);s.tick(100);s.tap(100);assert.equal(s.controlToggles(),1);assert.deepEqual(s.sets,[20]);assert.equal(s.video.paused,false);
  s.tick(400);s.tap(100);assert.equal(s.controlToggles(),2,'a fresh short single tap keeps its normal controls action');assert.equal(s.doc.querySelector('#langform-playback-hold-selection-style'),null);
});
for(const touch of [false,true])test(`early common WebViewLinks routes the doubletap's trailing click through the shipping gesture owners; touch=${touch}`,t=>{
  const s=setup(t,{touch,playerRect:true,webLinks:true,compatibility:true});s.double(310);assert.deepEqual(s.sets,[40]);assert.equal(s.controlToggles(),1,'only the first tap toggles controls; the owned second click does not');
});
for(const touch of [false,true])test(`early common WebViewLinks respects the shipping hold click guard; touch=${touch}`,t=>{
  const s=setup(t,{touch,playerRect:true,webLinks:true,compatibility:true});s.contact('down',100,210);s.tick(500);s.fire(350);s.contact('up',100,210);s.click(100);assert.equal(s.video.playbackRate,1);assert.equal(s.controlToggles(),0,'hold synthetic click cannot enter the earlier common-script controls path');
});
test('early common WebViewLinks respects the shipping swipe click guard',t=>{
  const s=setup(t,{playerRect:true,webLinks:true});s.pointer('pointerdown',1,100,210);s.tick(80);s.pointer('pointermove',1,200,210);s.pointer('pointerup',1,200,210);s.click(200);assert.deepEqual(s.sets,[45]);assert.equal(s.controlToggles(),0);
});
for(const touch of [false,true])test(`real WebKit ordering: one touch pair, first click detail2 plus dblclick, then a second click detail1 seeks once; touch=${touch}`,t=>{
  const s=setup(t,{touch,paused:true,playerRect:true,webLinks:true,compatibility:true,trustedEvents:true});
  s.contact('down',310,210);s.tick(63);s.contact('up',310,210);s.tick(50);s.click(310,210,s.surface,'click',2);s.click(310,210,s.surface,'dblclick',2);
  assert.deepEqual(s.sets,[],'browser click count includes an earlier pause control and cannot prove a second contact');assert.equal(s.controlToggles(),1);
  s.tick(152);s.click(310,210,s.surface,'click',1);assert.deepEqual(s.sets,[40]);assert.equal(s.controlToggles(),1);assert.equal(s.video.paused,true);
  s.click(310,210,s.surface,'dblclick',2);assert.deepEqual(s.sets,[40]);
});
for(const playerRect of [false,true])test(`one trusted click routed twice through hook/window remains one tap; PlayerRect=${playerRect}`,t=>{
  const s=setup(t,{playerRect,webLinks:playerRect,trustedEvents:true});s.tap(100);assert.deepEqual(s.sets,[]);if(playerRect)assert.equal(s.controlToggles(),1);
});
for(const touch of [false,true])for(const x of [100,310])test(`native dblclick confirms two admitted picture taps despite delayed WebKit contact delivery; touch=${touch}, x=${x}`,t=>{
  const s=setup(t,{touch,paused:true,playerRect:true,webLinks:true,compatibility:true,trustedEvents:true});s.video.playbackRate=1.5;
  // Actual Simulator failure: first up -> click177ms -> next down602ms
  // after first up -> up81ms -> click(detail2)34ms -> native dblclick.
  s.contact('down',x,210);s.tick(65);s.contact('up',x,210);s.tick(177);s.click(x,210,s.surface,'click',1);
  s.tick(425);s.contact('down',x,210);s.tick(81);s.contact('up',x,210);s.tick(34);s.click(x,210,s.surface,'click',2);
  assert.deepEqual(s.sets,[],'slow ordinary clicks alone never widen the350ms gesture');
  s.tick(2);s.click(x,210,s.surface,'dblclick',2);
  assert.deepEqual(s.sets,[x===100?20:40]);assert.equal(s.video.paused,true);assert.equal(s.video.playbackRate,1.5);assert.deepEqual(s.calls,[]);
  s.click(x,210,s.surface,'click',2);s.click(x,210,s.surface,'dblclick',2);assert.equal(s.sets.length,1,'compatibility events cannot seek twice');
});
for(const mode of ['ordinary-clicks','one-contact','first-control','first-untrusted','first-no-click','too-late','long-second','cancelled-second','moved-second','different-side','distant','source','route','ad','mini','overlay','zoom','blur','key','untrusted-dblclick','wrong-count','expired-confirmation'])test(`native delayed dblclick retains ${mode} boundary`,t=>{
  const s=setup(t,{paused:true,playerRect:true,webLinks:true,compatibility:true,trustedEvents:true});
  if(mode!=='one-contact'){
    if(mode==='first-untrusted'){
      s.pointer('pointerdown',1,310,210,s.surface,{__fixtureTrusted:false});s.tick(65);s.pointer('pointerup',1,310,210,s.surface,{__fixtureTrusted:false});
    }else s.tap(310,210,mode==='first-control'?s.doc.getElementById('play'):s.surface,{duration:65,clickEvent:false});
    if(mode!=='first-no-click')s.click(310,210,mode==='first-control'?s.doc.getElementById('play'):s.surface,'click',1);
    s.tick(mode==='too-late'?701:602);
  }
  const x=mode==='different-side'?100:mode==='distant'?370:310;
  s.contact('down',x,210);
  if(mode==='moved-second')s.pointer('pointermove',1,x+20,210);
  s.tick(mode==='long-second'?351:81);s.contact(mode==='cancelled-second'?'cancel':'up',x,210);s.tick(34);s.click(x,210,s.surface,'click',2);
  if(mode==='source')s.video.src='https://example.test/b';if(mode==='route')s.win.history.replaceState({},'','/watch?v=lmnopqrstuv');if(mode==='ad')s.ad(true);if(mode==='mini')s.win.__langformStageInsets={nativeMini:true};if(mode==='overlay')s.win.__langformHasOpenOverlay=()=>true;if(mode==='zoom')s.win.__langformPlaybackZoom.getState=()=>({scale:2});if(mode==='blur')s.win.dispatchEvent(new s.win.Event('blur'));if(mode==='key')s.win.dispatchEvent(new s.win.KeyboardEvent('keydown',{key:' '}));
  if(mode==='expired-confirmation')s.tick(351);
  if(mode==='untrusted-dblclick')s.surface.dispatchEvent(new s.win.MouseEvent('dblclick',{bubbles:true,cancelable:true,clientX:x,clientY:210,detail:2}));
  else if(mode!=='ordinary-clicks')s.click(x,210,s.surface,'dblclick',mode==='wrong-count'?1:2);
  assert.deepEqual(s.sets,[]);assert.equal(s.video.paused,true);assert.deepEqual(s.calls,[]);
});
for(const touch of [false,true])test(`keyboard/accessibility click detail0 cannot finish a native touch doubletap lease; touch=${touch}`,t=>{
  const s=setup(t,{touch,paused:true,playerRect:true,webLinks:true,trustedEvents:true});s.tap(310);s.tick(150);s.click(310,210,s.surface,'click',0);assert.deepEqual(s.sets,[]);assert.equal(s.video.paused,true);
});
for(const condition of ['expired','opposite','middle','distant','control','source','route','id','ad','mini','overlay','pose','hidden','blur','mouse-start','fresh-touch','untrusted-first','untrusted-second'])test(`native click fallback retains the ${condition} boundary`,t=>{
  const s=setup(t,{paused:true,playerRect:true,webLinks:true,trustedEvents:true});s.contact('down',310,210);s.tick(63);s.contact('up',310,210);s.tick(50);
  function untrustedClick(){s.surface.dispatchEvent(new s.win.MouseEvent('click',{bubbles:true,cancelable:true,clientX:310,clientY:210,detail:2}));}
  if(condition==='untrusted-first')untrustedClick();else s.click(310,210,s.surface,'click',2);
  s.tick(condition==='expired'?351:100);
  if(condition==='source')s.video.src='https://example.test/b';if(condition==='route')s.win.history.replaceState({},'','/watch?v=lmnopqrstuv');if(condition==='id')s.id('lmnopqrstuv');if(condition==='ad')s.ad(true);
  if(condition==='mini')s.win.__langformStageInsets={nativeMini:true};if(condition==='overlay')s.win.__langformHasOpenOverlay=()=>true;if(condition==='pose')s.pose(rect(0,140,402,226));if(condition==='hidden')Object.defineProperty(s.doc,'hidden',{value:true});
  if(condition==='blur')s.win.dispatchEvent(new s.win.Event('blur'));if(condition==='mouse-start')s.pointer('pointerdown',4,310,210,s.surface,{pointerType:'mouse'});if(condition==='fresh-touch'){s.contact('down',100,210);s.tick(60);s.contact('up',100,210);}
  if(condition==='untrusted-second')untrustedClick();else s.click(condition==='opposite'?100:condition==='middle'?201:condition==='distant'?370:310,210,condition==='control'?s.doc.getElementById('play'):s.surface,'click',1);
  assert.deepEqual(s.sets,[]);assert.equal(s.video.paused,true);
});
test('native-looking click pairs without an accepted trusted physical contact cannot seek',t=>{
  const s=setup(t,{playerRect:true,webLinks:true,trustedEvents:true});s.click(310);s.tick(150);s.click(310);assert.deepEqual(s.sets,[]);
  s.pointer('pointerdown',1,310,210,s.surface,{__fixtureTrusted:false});s.tick(60);s.pointer('pointerup',1,310,210,s.surface,{__fixtureTrusted:false});s.click(310);s.tick(150);s.click(310);assert.deepEqual(s.sets,[]);
});
for(const touch of [false,true])test(`second same-side contact shields a competing website doubletap recognizer; touch=${touch}`,t=>{
  const s=setup(t,{touch,hold:false,compatibility:true});let starts=0,ends=0,windowStarts=0,windowEnds=0;
  s.surface.addEventListener('touchstart',()=>{starts++;if(starts===2)s.video.currentTime+=10;});
  s.surface.addEventListener('touchend',()=>ends++);
  s.win.addEventListener('touchstart',event=>{windowStarts++;assert.equal(event.defaultPrevented,false);},true);
  s.win.addEventListener('touchend',()=>windowEnds++,true);
  s.double(310);assert.deepEqual(s.sets,[40]);assert.equal(starts,1);assert.equal(ends,1);assert.equal(windowStarts,2);assert.ok(windowEnds>=1);
});
for(const touch of [false,true])for(const initial of [0.75,1,1.5])test(`one accepted hold owns its website500-ms rival and returns toNormal from${initial}; touch=${touch}`,t=>{
  const s=setup(t,{touch,compatibility:true});s.video.playbackRate=initial;
  let websiteStarts=0,websitePlays=0,nativeTimer=0,previous,websiteHeld=false,captureStarts=0;
  s.surface.addEventListener('touchstart',()=>{websiteStarts++;nativeTimer=s.win.setTimeout(()=>{websitePlays++;previous=s.video.playbackRate;s.video.playbackRate=2;websiteHeld=true;},500);});
  s.surface.addEventListener('touchend',()=>{s.win.clearTimeout(nativeTimer);if(websiteHeld)s.video.playbackRate=previous;});
  s.win.addEventListener('touchstart',event=>{captureStarts++;assert.equal(event.defaultPrevented,false);},true);
  s.contact('down',100,210);s.tick(510);s.fire(350);s.fire(500);assert.equal(s.video.playbackRate,2);assert.equal(s.win.__langformPlaybackHold.isActive(),true);
  s.contact('up',100,210);assert.equal(s.video.playbackRate,1);assert.equal(websiteStarts,0);assert.equal(websitePlays,0);assert.equal(captureStarts,1);assert.deepEqual(s.sets,[]);assert.deepEqual(s.calls,[]);
});
for(const touch of [false,true])test(`second contact can become a 2x hold without a ten-second seek; touch=${touch}`,t=>{
  const s=setup(t,{touch,compatibility:true});s.tap(100);s.tick(100);s.contact('down',100,210);s.tick(510);s.fire(350);assert.equal(s.video.playbackRate,2);s.contact('up',100,210);s.click(100);assert.equal(s.video.playbackRate,1);assert.deepEqual(s.sets,[]);
});
for(const touch of [false,true])for(const rejected of ['middle','outside-picture','control','outside-owner','paused','ended','ad','mini','overlay','wrong-source-id'])test(`hold start shield retains website input for rejected ${rejected}; touch=${touch}`,t=>{
  const s=setup(t,{touch,compatibility:true});let starts=0;const target=rejected==='control'?s.doc.getElementById('play'):rejected==='outside-owner'?s.doc.getElementById('outside'):s.surface;
  target.addEventListener('touchstart',()=>starts++);
  if(rejected==='paused')s.video.paused=true;if(rejected==='ended')s.video.ended=true;if(rejected==='ad')s.ad(true);if(rejected==='mini')s.win.__langformStageInsets={nativeMini:true};if(rejected==='overlay')s.win.__langformHasOpenOverlay=()=>true;if(rejected==='wrong-source-id')s.id('lmnopqrstuv');
  const event=s.contact('down',rejected==='middle'?201:rejected==='outside-picture'?450:100,210,target);assert.equal(event.defaultPrevented,false);assert.equal(starts,1);assert.equal([...s.timers.values()].filter(timer=>timer.delay===350).length,0);
});
for(const touch of [false,true])test(`blocked first website hold start keeps native cancellation/default vertical movement available; touch=${touch}`,t=>{
  const s=setup(t,{touch,compatibility:true});let ends=0,moves=0;s.surface.addEventListener('touchend',()=>ends++);s.surface.addEventListener('touchmove',event=>{moves++;assert.equal(event.defaultPrevented,false);});
  s.contact('down',100,210);
  if(!touch)s.pointer('pointermove',1,103,250);
  const move=new s.win.Event('touchmove',{bubbles:true,cancelable:true});Object.assign(move,{touches:[{identifier:1,clientX:103,clientY:250}]});s.surface.dispatchEvent(move);
  s.contact('up',103,250);assert.equal(ends,1);assert.equal(moves,1);assert.equal(s.win.__langformPlaybackHold.isActive(),false);assert.equal([...s.timers.values()].filter(timer=>timer.delay===350).length,0);assert.deepEqual(s.sets,[]);
});
test('a two-finger contact never completes a pending doubletap or steals pinch ownership',t=>{
  const s=setup(t);s.tap(100);s.tick(100);s.pointer('pointerdown',1,100,210);s.pointer('pointerdown',2,300,210);s.pointer('pointerup',1,100,210);s.pointer('pointerup',2,300,210);assert.deepEqual(s.sets,[]);s.double(310);assert.deepEqual(s.sets,[40]);
});
test('rapid same-side pairs seek exactly once per pair without accumulating hold styles or rate intent',t=>{
  const s=setup(t,{compatibility:true});for(let n=0;n<20;n++)s.double(n%2?100:310);assert.equal(s.sets.length,20);assert.equal(s.video.currentTime,30);assert.equal(s.doc.querySelector('#langform-playback-hold-selection-style'),null);assert.equal(s.video.playbackRate,1);assert.deepEqual(s.calls,[]);
});
for(const touch of [false,true])for(const condition of ['center','opposite','late','long','cancel','move-away-return','control','outside','source','route','player-id','ad','mini','overlay','wireless','native-fullscreen','hidden','pose','blur','resize','key'])test(`doubletap is revoked by ${condition}; touch=${touch}`,t=>{
  const s=setup(t,{touch});s.tap(100);s.tick(condition==='late'?351:100);
  let x=condition==='center'?200:condition==='opposite'?310:100,target=s.surface;
  if(condition==='source')s.video.src='https://example.test/b';if(condition==='route')s.win.history.replaceState({},'','/watch?v=lmnopqrstuv');if(condition==='player-id')s.id('lmnopqrstuv');if(condition==='ad')s.ad(true);
  if(condition==='mini')s.win.__langformStageInsets={nativeMini:true};if(condition==='overlay')s.win.__langformHasOpenOverlay=()=>true;if(condition==='wireless')s.video.webkitCurrentPlaybackTargetIsWireless=true;if(condition==='native-fullscreen')s.video.webkitDisplayingFullscreen=true;
  if(condition==='hidden')Object.defineProperty(s.doc,'hidden',{value:true});if(condition==='pose')s.pose(rect(0,140,402,226));
  if(condition==='blur'||condition==='resize')s.win.dispatchEvent(new s.win.Event(condition));if(condition==='key')s.win.dispatchEvent(new s.win.KeyboardEvent('keydown',{key:' '}));
  if(condition==='control')target=s.doc.getElementById('play');if(condition==='outside')target=s.doc.getElementById('outside');
  s.contact('down',x,210,target);
  if(condition==='move-away-return'){if(touch){const event=new s.win.Event('touchmove',{bubbles:true,cancelable:true});Object.assign(event,{touches:[{identifier:1,clientX:115,clientY:210}]});target.dispatchEvent(event);}else s.pointer('pointermove',1,115,210);}
  s.tick(condition==='long'?351:60);s.contact(condition==='cancel'?'cancel':'up',x,210,target);s.click(x,210,target);assert.deepEqual(s.sets,[]);assert.deepEqual(s.calls,[]);
});
for(const [time,x,expected,label]of [[5,100,0,'5 s zurück'],[115,310,120,'5 s vor']])test(`doubletap clamps ${time} to the available timeline and reports actual delta`,t=>{
  const s=setup(t);s.setTime(time);s.double(x);assert.deepEqual(s.sets,[expected]);assert.equal(s.feedback().textContent,label);
});
test('doubletap stays within the current live/DVR interval',t=>{
  const s=setup(t);s.video.duration=Infinity;s.video.seekable={length:2,start:i=>[20,80][i],end:i=>[50,110][i]};s.setTime(45);s.double(310);assert.deepEqual(s.sets,[50]);s.setTime(85);s.double(100);assert.deepEqual(s.sets,[50,80]);
});
for(const mode of ['throw','refuse','new-source'])test(`doubletap setter ${mode} cannot report phantom success or Play`,t=>{
  const s=setup(t);let time=30;Object.defineProperty(s.video,'currentTime',{configurable:true,get:()=>time,set:value=>{if(mode==='throw')throw Error('refused');if(mode==='new-source'){time=value;s.video.src='https://example.test/b';}}});s.double(310);assert.equal(s.feedback(),null);assert.deepEqual(s.calls,[]);
});
test('doubletap consumes its compatibility tap, click and dblclick, while a fresh contact immediately recovers',t=>{
  const s=setup(t);s.tap(100);s.tick(100);s.tap(100,210,s.surface,{clickEvent:false});
  for(const name of ['tap','click','dblclick'])assert.equal(s.click(100,210,s.surface,name).defaultPrevented,true);
  assert.equal(s.click(100,210,s.doc.getElementById('play')).defaultPrevented,false);s.tap(100);assert.equal(s.ordinaryClicks(),2);assert.deepEqual(s.sets,[20]);
});
for(const touch of [false,true])test(`ended-paused doubletap uses the original cancel and one-shot autoresume guard; touch=${touch}`,async t=>{
  const s=setup(t,{touch,paused:true});s.setTime(120);s.video.ended=true;let cancel=0,pauses=0;
  s.win.__langformCancelEndedAutonav=()=>{cancel++;return true;};s.root.pauseVideo=()=>{pauses++;s.video.paused=true;};
  s.double(100);assert.deepEqual(s.sets,[110]);assert.equal(cancel,1);assert.equal(s.video.paused,true);assert.deepEqual(s.calls,[]);
  s.video.ended=false;s.video.dispatchEvent(new s.win.Event('seeked',{bubbles:true}));s.video.paused=false;s.video.dispatchEvent(new s.win.Event('play',{bubbles:true}));await Promise.resolve();assert.equal(pauses,1);assert.equal(s.video.paused,true);
  s.video.paused=false;s.video.dispatchEvent(new s.win.Event('play',{bubbles:true}));await Promise.resolve();assert.equal(pauses,1);assert.equal(s.video.paused,false,'explicit subsequent replay is never continuously paused');
});
for(const touch of [false,true])test(`own fullscreen doubletap respects actual controls, hold and zoom; touch=${touch}`,t=>{
  const s=setup(t,{touch,fullscreen:true,compatibility:true}),ui=s.ui();s.double(700,200,ui);assert.deepEqual(s.sets,[40]);s.double(170,200,ui);assert.deepEqual(s.sets,[40,30]);
  s.tap(700,200,ui);s.tick(100);s.tap(700,200,ui.querySelector('[data-action=forward]'));assert.equal(s.video.currentTime,40,'real forward button retains its click');
  ui.querySelector('.lf-fs-speed-button').click();s.double(700,200,ui);assert.deepEqual(s.sets,[40,30,40]);
  ui.querySelector('.lf-fs-speed-button').click();
  // The magnified picture belongs to pan even when a side is tapped twice.
  s.win.__langformPlaybackZoom.getState=()=>({scale:2,gesturing:false});s.double(700,200,ui);assert.deepEqual(s.sets,[40,30,40]);
});
