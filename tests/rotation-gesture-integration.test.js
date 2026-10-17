const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(process.env.LANGFORM_ROTATION_ZOOM_SOURCE || path.join(__dirname,'../ios/Langform/Langform/PlaybackZoom.js'),'utf8');
const fullscreen=fs.readFileSync(process.env.LANGFORM_ROTATION_FULLSCREEN_SOURCE || path.join(__dirname,'../ios/Langform/Langform/FullscreenMotion.js'),'utf8');
const hold=fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/PlaybackHold.js'),'utf8');
const background=fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/WatchBackgroundAudio.js'),'utf8');
const box=(x,y,width,height)=>({x,y,left:x,top:y,right:x+width,bottom:y+height,width,height});
function setup(t,options={}){
  const dom=new JSDOM('<!doctype html><html><head></head><body><main><div id="movie_player"><div class="html5-video-container"><video class="html5-main-video" src="https://example.test/a"></video></div><button class="ytp-fullscreen-button">Vollbild</button></div></main><p id="copy">Copy outside</p></body></html>',{url:'https://m.youtube.com/watch?v=abcdefghijk',runScripts:'outside-only',pretendToBeVisual:true});
  const win=dom.window,doc=win.document,root=doc.getElementById('movie_player'),video=root.querySelector('video'),container=video.parentElement;
  const errors=[];win.addEventListener('error',event=>{errors.push(event.message);event.preventDefault();});
  t.after(()=>{assert.deepEqual(calls,options.expectedPlaybackCalls || [], 'only explicitly expected background/user actions occur');assert.equal(video.playbackRate,1,'rate preserved');win.dispatchEvent(new win.Event('pagehide'));assert.deepEqual(errors,[]);win.close();});
  Object.defineProperties(win,{innerWidth:{value:874,writable:true},innerHeight:{value:402,writable:true}});
  if(!options.touch)win.PointerEvent=win.MouseEvent;
  win.scrollTo=()=>{};
  let actualID='abcdefghijk';root.getVideoData=()=>({video_id:actualID,title:'Video'});
  Object.defineProperties(video,{videoWidth:{value:options.iw || 1920,writable:true},videoHeight:{value:options.ih || 1080,writable:true},
    readyState:{value:4,writable:true},paused:{value:!!options.paused,writable:true},ended:{value:false,writable:true},duration:{value:120,writable:true},currentTime:{value:30,writable:true,configurable:true},playbackRate:{value:1,writable:true},error:{value:null,writable:true},currentSrc:{get:()=>video.src,configurable:true}});
  root.getBoundingClientRect=()=>root.hasAttribute('data-langform-fullscreen-player')?box(0,0,win.innerWidth,win.innerHeight):box(0,110,402,226.125);
  video.getBoundingClientRect=()=>root.getBoundingClientRect();
  const messages=[],calls=[],timers=new Map();let serial=0;
  win.setTimeout=(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;};win.clearTimeout=id=>timers.delete(id);
  win.webkit={messageHandlers:{langformFullscreen:{postMessage:value=>messages.push(value)}}};
  win.__langformTogglePlayback=id=>{calls.push(['toggle',id]);video.paused=!video.paused;video.dispatchEvent(new win.Event(video.paused?'pause':'play'));return true;};
  win.__langformPlay=id=>{calls.push(['play',id]);video.paused=false;video.dispatchEvent(new win.Event('play'));return true;};
  const rawVisibility={hidden:false};
  if(options.background){
    Object.defineProperty(doc,'hidden',{get:()=>rawVisibility.hidden,configurable:true});
    Object.defineProperty(doc,'visibilityState',{get:()=>rawVisibility.hidden?'hidden':'visible',configurable:true});
    video.play=()=>{calls.push(['background-play','abcdefghijk']);video.paused=false;video.dispatchEvent(new win.Event('play'));return Promise.resolve();};
    video.pause=()=>{calls.push(['explicit-pause','abcdefghijk']);video.paused=true;video.dispatchEvent(new win.Event('pause'));};
    win.eval(background);
  }
  win.eval(source);if(options.swipe)win.eval(fs.readFileSync(process.env.LANGFORM_ROTATION_SWIPE_SOURCE || path.join(__dirname,'../ios/Langform/Langform/PlaybackSwipe.js'),'utf8'));win.eval(hold);win.eval(fullscreen);
  const enter=()=>root.querySelector('.ytp-fullscreen-button').click();
  const ui=()=>doc.getElementById('langform-fullscreen-ui');
  const state=()=>win.__langformPlaybackZoom.getState();
  const pointer=(type,id,x,y,target=ui(),extra={})=>{const event=new win.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{pointerType:'touch',pointerId:id,button:0,clientX:x,clientY:y,isPrimary:id===1,...extra});target.dispatchEvent(event);return event;};
  const touch=(type,points,target=ui(),changed=[])=>{const event=new win.Event(type,{bubbles:true,cancelable:true});Object.defineProperties(event,{touches:{value:points.map(([id,x,y,node])=>({identifier:id,clientX:x,clientY:y,target:node || target}))},changedTouches:{value:changed.map(([id,x,y])=>({identifier:id,clientX:x,clientY:y,target}))}});target.dispatchEvent(event);return event;};
  const pinch=(scale=2,cx=437,cy=100)=>{pointer('pointerdown',1,cx-50,cy);pointer('pointerdown',2,cx+50,cy);pointer('pointermove',1,cx-50*scale,cy);pointer('pointermove',2,cx+50*scale,cy);pointer('pointerup',1,cx-50*scale,cy);pointer('pointerup',2,cx+50*scale,cy);};
  return{win,doc,root,video,container,enter,ui,state,pointer,touch,pinch,messages,calls,timers,rawVisibility,actualID:id=>{actualID=id;}};
}
function closeTo(actual,expected,message){assert.ok(Math.abs(actual-expected)<.0001,`${message || ''}: ${actual} ≈ ${expected}`);}
function fields(state){return state && [state.scale,state.x,state.y];}


function rotation(t,opts={}){
  const s=setup(t,{...opts,swipe:true});
  s.win.__langformMeasureVideo=()=>({playerVideoID:'abcdefghijk',hasVideo:true,mediaReady:true,navigationToken:''});
  s.enter();assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),true,'baseline exit');s.enter();return s;
}
for(const end of ['pointerup','pointercancel','lostpointercapture'])test('released pinch rotation after '+end,t=>{
  const s=rotation(t);s.pointer('pointerdown',1,387,201);s.pointer('pointerdown',2,487,201);s.pointer('pointermove',2,587,201);
  assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),false,'active pinch');
  s.pointer(end,2,587,201);assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),false,'first contact remains');
  s.pointer('pointerup',1,387,201);
  if(end==='lostpointercapture') {assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),false,'capture loss leaves actual second contact');s.pointer('pointerup',2,587,201);}
  assert.equal(s.state().gesturing,false);assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),true,'all contacts released');
});
for(const end of ['pointerup','pointercancel','lostpointercapture'])test('pinch first contact '+end+' keeps active second pointer',t=>{
  const s=rotation(t);s.pointer('pointerdown',1,387,201);s.pointer('pointerdown',2,487,201);s.pointer('pointermove',2,587,201);
  s.pointer(end,1,387,201);assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),false,'second actual contact remains');
  s.pointer('pointerup',2,587,201);
  if(end==='lostpointercapture'){assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),false,'actual first contact remains');s.pointer('pointerup',1,387,201);}
  assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),true,'both physically released');
});
for(const end of ['touchend','touchcancel'])test('released touch pinch rotation after '+end,t=>{
  const s=rotation(t,{touch:true});s.touch('touchstart',[[10,387,201]]);s.touch('touchstart',[[10,387,201],[20,487,201]]);s.touch('touchmove',[[10,337,201],[20,537,201]]);
  assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),false,'active pinch');
  s.touch(end,[[10,337,201]],s.ui(),[[20,537,201]]);assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),false,'first contact remains');
  s.touch('touchend',[],s.ui(),[[10,337,201]]);assert.equal(s.state().gesturing,false);
  assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),true,'all contacts released');
});
for(const end of ['pointerup','pointercancel','lostpointercapture'])for(const inline of [false,true])test('swipe '+end+' re-arms '+(inline?'inline entry':'portrait exit'),t=>{
  const s=rotation(t);if(inline)s.win.__langformFullscreen.exit('abcdefghijk');
  const target=inline?s.video:s.ui(),cy=inline?200:100;
  s.pointer('pointerdown',1,200,cy,target);s.pointer('pointermove',1,300,cy,target);
  const attempt=()=>inline?s.win.__langformFullscreen.enter('abcdefghijk'):s.win.__langformFullscreen.exitForRotation('abcdefghijk');
  assert.equal(attempt(),false,'active swipe contact');s.pointer(end,1,300,cy,target);
  if(end==='lostpointercapture'){assert.equal(attempt(),false,'capture loss retains actual contact');s.pointer('pointerup',1,300,cy,target);}
  assert.equal(attempt(),true,'actual swipe released');
});
for(const end of ['touchend','touchcancel'])test('touch swipe '+end+' re-arms portrait exit',t=>{
  const s=rotation(t,{touch:true});s.touch('touchstart',[[10,200,100]]);s.touch('touchmove',[[10,300,100]]);
  assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),false,'active swipe');
  s.touch(end,[],s.ui(),[[10,300,100]]);assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),true,'actual swipe released');
});
for(const kind of ['control','plain'])test(kind+' lost capture is not a physical release',t=>{
  const s=rotation(t),target=kind==='control'?s.ui().querySelector('[data-action=play]'):s.ui();
  s.pointer('pointerdown',1,437,201,target);s.pointer('lostpointercapture',1,437,201,target);
  assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),false,'finger still active');
  s.pointer('pointerup',1,437,201,target);assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),true,'actual release');
});
for(const guard of ['control','speed','wrong-id','source','ad','drag','overlay'])test('rotation retains '+guard+' ownership guard',t=>{
  const s=rotation(t);s.pinch(2,437,201);let expected='abcdefghijk';
  if(guard==='control')s.pointer('pointerdown',1,437,201,s.ui().querySelector('[data-action=play]'));
  if(guard==='speed')s.ui().querySelector('.lf-fs-speed-button').click();
  if(guard==='wrong-id')expected='zyxwvutsrqp';
  if(guard==='source'){const report=s.win.__langformMeasureVideo;s.win.__langformMeasureVideo=()=>{s.video.src='https://example.test/replacement';return report();};}
  if(guard==='ad')s.root.classList.add('ad-showing');
  if(guard==='drag')s.win.__langformIsNativeDragging=()=>true;
  if(guard==='overlay')s.win.__langformHasOpenOverlay=()=>true;
  assert.equal(s.win.__langformFullscreen.exitForRotation(expected),false,'guard remains');
});

test('third-finger gesture cancellation keeps every actual pointer until released',t=>{
  const s=rotation(t);s.pointer('pointerdown',1,387,201);s.pointer('pointerdown',2,487,201);s.pointer('pointermove',2,587,201);s.pointer('pointerdown',3,500,201);
  assert.equal(s.state().gesturing,false,'gesture cancelled by third finger');
  s.pointer('pointerup',1,387,201);assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),false,'two fingers remain');
  s.pointer('pointerup',2,587,201);assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),false,'third finger remains');
  s.pointer('pointerup',3,500,201);assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),true,'all physical contacts released');
});
test('touch gesture cancellation keeps its remaining current touchlist',t=>{
  const s=rotation(t,{touch:true});s.touch('touchstart',[[10,387,201],[20,487,201]]);s.touch('touchmove',[[10,337,201],[20,537,201]]);
  s.touch('touchstart',[[10,337,201],[20,537,201],[30,500,201]]);assert.equal(s.state().gesturing,false);
  s.touch('touchend',[[20,537,201],[30,500,201]],s.ui(),[[10,337,201]]);assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),false,'remaining current touchlist');
  s.touch('touchend',[[30,500,201]],s.ui(),[[20,537,201]]);assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),false,'last touch remains');
  s.touch('touchend',[],s.ui(),[[30,500,201]]);assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),true,'all actual touches released');
});

for(const family of ['pointer','touch'])for(const surface of ['inline-control','inline-plain','fullscreen-control','fullscreen-plain'])test(family+' hidden lifecycle releases interrupted '+surface+' contact',t=>{
  const s=rotation(t,{touch:family==='touch'}),inline=surface.startsWith('inline');
  if(inline)s.win.__langformFullscreen.exit('abcdefghijk');
  const target=inline?(surface.endsWith('control')?s.root.querySelector('.ytp-fullscreen-button'):s.video):(surface.endsWith('control')?s.ui().querySelector('[data-action=play]'):s.ui());
  const attempt=()=>inline?s.win.__langformFullscreen.enter('abcdefghijk'):s.win.__langformFullscreen.exitForRotation('abcdefghijk');
  if(family==='pointer')s.pointer('pointerdown',1,200,200,target);else s.touch('touchstart',[[10,200,200]],target);
  assert.equal(attempt(),false,'actual active contact');
  let hidden=false;Object.defineProperty(s.doc,'hidden',{get:()=>hidden,configurable:true});
  hidden=true;s.doc.dispatchEvent(new s.win.Event('visibilitychange'));assert.equal(attempt(),false,'hidden document cannot rotate');
  hidden=false;s.doc.dispatchEvent(new s.win.Event('visibilitychange'));
  assert.equal(attempt(),true,'visible current player is no longer locked by interrupted contact');
});

for(const family of ['pointer','touch'])test(family+' blur releases interrupted original fullscreen-button contact',t=>{
  const s=rotation(t,{touch:family==='touch'});s.win.__langformFullscreen.exit('abcdefghijk');
  const target=s.root.querySelector('.ytp-fullscreen-button');
  if(family==='pointer')s.pointer('pointerdown',1,200,200,target);else s.touch('touchstart',[[10,200,200]],target);
  assert.equal(s.win.__langformFullscreen.enter('abcdefghijk'),false,'active original button contact');
  s.win.dispatchEvent(new s.win.Event('blur'));
  assert.equal(s.win.__langformFullscreen.enter('abcdefghijk'),true,'interrupted original button no longer locks physical entry');
});

for(const signal of ['hidden','native-inactive'])for(const family of ['pointer','touch'])for(const inline of [false,true])test(signal+' relay releases interrupted '+family+' contact with masked document visibility (inline='+inline+')',t=>{
  const s=rotation(t,{touch:family==='touch'});if(inline)s.win.__langformFullscreen.exit('abcdefghijk');
  let hidden=false,nativeInactive=false;
  s.win.__langformRealVisibility={hidden:()=>hidden,inactive:()=>hidden||nativeInactive};
  Object.defineProperty(s.doc,'hidden',{value:false,configurable:true});
  const target=inline?s.root.querySelector('.ytp-fullscreen-button'):s.ui().querySelector('[data-action=play]');
  const attempt=()=>inline?s.win.__langformFullscreen.enter('abcdefghijk'):s.win.__langformFullscreen.exitForRotation('abcdefghijk');
  if(family==='pointer')s.pointer('pointerdown',1,200,200,target);else s.touch('touchstart',[[10,200,200]],target);
  if(signal==='hidden')hidden=true;else nativeInactive=true;
  s.doc.dispatchEvent(new s.win.Event('langform-real-visibilitychange'));
  assert.equal(s.doc.hidden,false,'website-facing visibility is masked');assert.equal(attempt(),false,'actual inactivity still blocks rotation');
  hidden=false;nativeInactive=false;s.doc.dispatchEvent(new s.win.Event('langform-real-visibilitychange'));
  assert.equal(attempt(),true,'real relay cleared interrupted physical contact');
});

for(const signal of ['hidden','native-inactive'])test(signal+' relay restores a live temporary hold while document remains visible',t=>{
  const s=setup(t,{swipe:true});let inactive=false;
  s.win.__langformRealVisibility={hidden:()=>signal==='hidden'&&inactive,inactive:()=>inactive};
  Object.defineProperty(s.doc,'hidden',{value:false,configurable:true});
  s.pointer('pointerdown',1,100,200,s.video);
  const timer=[...s.timers].find(([,value])=>value.delay===350);assert.ok(timer,'actual Hold timer armed');s.timers.delete(timer[0]);timer[1].fn();
  assert.equal(s.video.playbackRate,2);assert.equal(s.win.__langformPlaybackHold.isActive(),true);
  inactive=true;s.doc.dispatchEvent(new s.win.Event('langform-real-visibilitychange'));
  assert.equal(s.video.playbackRate,1,'temporary rate restored before background continuation capture');assert.equal(s.win.__langformPlaybackHold.isActive(),false);
});

for(const family of ['pointer','touch'])for(const gesture of ['pinch','swipe','hold','control','scrub'])test('shipping background lease cleans '+family+' '+gesture+' before one owned continuation',t=>{
  const s=rotation(t,{touch:family==='touch',background:true,expectedPlaybackCalls:[['background-play','abcdefghijk']]});
  const ui=s.ui(),target=gesture==='control'?ui.querySelector('[data-action=play]'):gesture==='scrub'?ui.querySelector('input'):ui;
  if(family==='pointer'){
    s.pointer('pointerdown',1,gesture==='hold'?100:200,100,target);
    if(gesture==='pinch'){s.pointer('pointerdown',2,300,100,target);s.pointer('pointermove',2,400,100,target);}
    if(gesture==='swipe')s.pointer('pointermove',1,300,100,target);
  }else{
    s.touch('touchstart',[[10,gesture==='hold'?100:200,100]],target);
    if(gesture==='pinch'){s.touch('touchstart',[[10,200,100],[20,300,100]],target);s.touch('touchmove',[[10,150,100],[20,350,100]],target);}
    if(gesture==='swipe')s.touch('touchmove',[[10,300,100]],target);
  }
  if(gesture==='scrub'){target.value='45';target.dispatchEvent(new s.win.Event('input',{bubbles:true}));assert.equal(s.video.currentTime,30,'range preview waits for a real release before seeking');}
  if(gesture==='hold'){const timer=[...s.timers].find(([,value])=>value.delay===350);assert.ok(timer);s.timers.delete(timer[0]);timer[1].fn();assert.equal(s.video.playbackRate,2);}
  const api=s.win.__langformWatchBackgroundAudio,source=s.video.currentSrc,position=s.video.currentTime;
  const owner=api.capture('abcdefghijk',7,1,true);assert.equal(owner.accepted,true);assert.equal(owner.mayContinue,true);
  assert.equal(s.video.playbackRate,1,'arm relays cleanup before capturing the rate');assert.equal(s.win.__langformPlaybackHold.isActive(),false);assert.equal(s.state(),null,'zoom context is inactive');
  s.video.paused=true;s.video.dispatchEvent(new s.win.Event('pause'));
  api.background('abcdefghijk',7,1);api.categoryReady('abcdefghijk',7,1,owner.token,true);
  s.rawVisibility.hidden=true;s.doc.dispatchEvent(new s.win.Event('visibilitychange'));
  assert.equal(s.doc.hidden,false,'source lease masks website-facing visibility');assert.equal(s.win.__langformRealVisibility.hidden(),true);
  assert.equal(s.video.paused,false);assert.equal(s.video.currentSrc,source);assert.equal(s.video.currentTime,position,'interrupted swipe never commits a seek');
  s.doc.dispatchEvent(new s.win.Event('visibilitychange'));api.background('abcdefghijk',7,1);assert.equal(s.calls.length,1,'one continuation only');
  s.rawVisibility.hidden=false;api.foreground();assert.equal(s.calls.length,1,'foreground never plays');
  assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),true,'dynamic FS/control contacts were cleaned');
});

for(const family of ['pointer','touch'])test('shipping paused background source lease preserves pause after gesture cleanup ('+family+')',t=>{
  const s=rotation(t,{touch:family==='touch',background:true,paused:true}),api=s.win.__langformWatchBackgroundAudio;
  const target=s.ui().querySelector('[data-action=play]');
  if(family==='pointer')s.pointer('pointerdown',1,200,100,target);else s.touch('touchstart',[[10,200,100]],target);
  const owner=api.capture('abcdefghijk',7,1,true);assert.equal(owner.accepted,true);assert.equal(owner.mayContinue,false);
  api.background('abcdefghijk',7,1);api.categoryReady('abcdefghijk',7,1,owner.token,true);s.rawVisibility.hidden=true;s.doc.dispatchEvent(new s.win.Event('visibilitychange'));
  assert.equal(s.doc.hidden,false);assert.equal(s.video.paused,true);assert.deepEqual(s.calls,[]);
  s.rawVisibility.hidden=false;api.foreground();assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),true);assert.equal(s.video.paused,true);
});

test('shipping explicit pause disarms continuation while preserving the same masked source',t=>{
  const s=rotation(t,{background:true,expectedPlaybackCalls:[['explicit-pause','abcdefghijk']]}),api=s.win.__langformWatchBackgroundAudio;
  const owner=api.capture('abcdefghijk',7,1,true);assert.equal(owner.mayContinue,true);const source=s.video.currentSrc;
  s.video.pause();api.background('abcdefghijk',7,1);api.categoryReady('abcdefghijk',7,1,owner.token,true);s.rawVisibility.hidden=true;s.doc.dispatchEvent(new s.win.Event('visibilitychange'));
  assert.equal(s.video.paused,true);assert.equal(s.doc.hidden,false);assert.equal(s.video.currentSrc,source);assert.equal(s.calls.length,1);
  s.rawVisibility.hidden=false;api.foreground();assert.equal(s.calls.length,1);assert.equal(s.video.paused,true);
});

for(const family of ['pointer','touch'])for(const paused of [false,true])test(family+' released swipe permits portrait exit while its media seek is pending (paused='+paused+')',t=>{
  const s=rotation(t,{touch:family==='touch',paused});
  let seeking=false,time=s.video.currentTime;
  Object.defineProperties(s.video,{
    currentTime:{get:()=>time,set:value=>{time=value;seeking=true;},configurable:true},
    seeking:{get:()=>seeking,configurable:true},
  });
  if(family==='pointer'){
    s.pointer('pointerdown',1,200,100);s.pointer('pointermove',1,300,100);s.pointer('pointerup',1,300,100);
  }else{
    s.touch('touchstart',[[10,200,100]]);s.touch('touchmove',[[10,300,100]]);s.touch('touchend',[],s.ui(),[[10,300,100]]);
  }
  assert.equal(time,45,'the real swipe seeks before the orientation request');
  assert.equal(seeking,true,'seeked has not arrived yet');
  assert.equal(s.state().gesturing,false,'no zoom gesture still owns a finger');
  assert.equal(s.win.__langformFullscreen.exitForRotation('abcdefghijk'),true,'current fullscreen may return without waiting for the media seek');
  assert.equal(time,45,'return does not alter the seek target');
  assert.equal(s.video.paused,paused,'return preserves the existing playback choice');
});
