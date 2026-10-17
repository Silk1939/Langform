const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const script=fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/PlaybackHoldDiagnostics.js'),'utf8');

function page(t,verbose=true){
  const dom=new JSDOM('<div id="movie_player"><video></video></div><video id="preview"></video>',{url:'https://m.youtube.com/watch?v=abcdefghijk',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(()=>{dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();});
  const win=dom.window,doc=win.document,root=doc.getElementById('movie_player'),video=root.querySelector('video');
  win.__langformGestureInputProbe=verbose;
  const computed=win.getComputedStyle.bind(win);win.getComputedStyle=node=>computed(node);doc.elementsFromPoint=()=>[];
  const state={paused:false,ended:false,seeking:false,readyState:4,error:null,currentTime:30,duration:100,muted:false,volume:.7,playbackRate:1,currentSrc:'https://private.example/stream?secret=token',webkitAudioDecodedByteCount:8000};
  for(const key of Object.keys(state))Object.defineProperty(video,key,{configurable:true,get:()=>state[key],set:()=>assert.fail('diagnostics wrote '+key)});
  video.play=video.pause=()=>assert.fail('diagnostics changed playback');
  root.getVideoData=()=>({video_id:'abcdefghijk'});root.isMuted=()=>state.muted;root.getVolume=()=>state.volume*100;
  root.unMute=root.mute=root.setVolume=()=>assert.fail('diagnostics changed player sound');
  Object.defineProperty(video,'audioTracks',{configurable:true,value:[{enabled:true},{enabled:false}]});
  Object.defineProperty(win.navigator,'audioSession',{configurable:true,value:{state:'active',type:'playback'}});
  const timers=new Map();let serial=0;
  win.setTimeout=fn=>{const id=++serial;timers.set(id,fn);return id;};win.clearTimeout=id=>timers.delete(id);
  win.eval(script);doc.dispatchEvent(new win.Event('DOMContentLoaded'));
  const label=()=>doc.getElementById('langform-hold-probe').textContent;
  const values=()=>Object.fromEntries(label().split(' ').map(part=>{const i=part.indexOf('=');return[part.slice(0,i),part.slice(i+1)];}));
  const tick=()=>{const next=[...timers].at(-1);if(!next)return false;const [id,fn]=next;timers.delete(id);fn();return true;};
  return{win,doc,root,video,state,label,values,tick,pending:()=>timers.size,event:name=>video.dispatchEvent(new win.Event(name,{bubbles:true}))};
}

test('opt-in probe remains fresh through a long natural ad and next video, then stops within ten minutes',t=>{
  const p=page(t,false);
  for(let i=0;i<920;i++){
    p.state.currentTime=i/4;
    assert.equal(p.tick(),true,'probe expired during a healthy226-second ad');
  }
  p.state.currentTime=1.25;p.state.duration=1161;p.state.currentSrc='blob:next-private-source';
  p.root.getVideoData=()=>({video_id:'nextvideo12'});
  assert.equal(p.tick(),true);assert.equal(p.values().time,'1.250');assert.equal(p.values().data,'nextvideo12');
  assert.doesNotMatch(p.label(),/next-private-source/);
  let total=921;
  while(p.tick())assert.ok(++total<2401,'opt-in sampling must remain bounded');
  assert.equal(p.pending(),0);assert.ok(total>=921);
  const last=p.label();assert.equal(p.tick(),false);assert.equal(p.label(),last);
  assert.equal(p.state.muted,false);assert.equal(p.state.playbackRate,1);
});

test('opt-in gesture audio evidence distinguishes player mute, media mute, decode and session state without changing sound',t=>{
  const p=page(t);let s=p.values();
  assert.equal(s.muted,'false');assert.equal(s.apiMuted,'false');assert.equal(s.volume,'0.7');assert.equal(s.apiVolume,'70');
  assert.equal(s.audioDecoded,'8000');assert.equal(s.audioTracks,'2');assert.equal(s.audioEnabled,'1');assert.equal(s.audioSession,'active');
  p.state.muted=true;p.state.webkitAudioDecodedByteCount=16000;p.win.navigator.audioSession.state='interrupted';p.event('volumechange');p.tick();s=p.values();
  assert.equal(s.muted,'true');assert.equal(s.audioDecoded,'16000');assert.equal(s.audioSession,'interrupted');
  assert.match(s.audioEvents,/:volumechange:30\.000:false:true:0\.7:1:true:70:16000:interrupted/);
  assert.doesNotMatch(p.label(),/private|secret|https:\/\/|token/);
});

test('diagnostic event history is bounded and ignores preview media',t=>{
  const p=page(t);p.doc.getElementById('preview').dispatchEvent(new p.win.Event('volumechange',{bubbles:true}));p.tick();
  assert.equal(p.values().audioEvents,'');
  for(let i=0;i<27;i++){p.state.currentTime=i;p.event(i%2?'seeking':'ratechange');}
  p.tick();const events=p.values().audioEvents.split('>');assert.equal(events.length,20);
  assert.match(events[0],/:seeking:7\.000:/);assert.match(events.at(-1),/:ratechange:26\.000:/);
});

test('missing, throwing and invalid optional audio APIs are reported as unknown rather than guessed',t=>{
  const p=page(t);p.root.isMuted=()=>{throw Error('unavailable');};p.root.getVolume=()=>NaN;
  p.state.webkitAudioDecodedByteCount=undefined;
  Object.defineProperty(p.video,'audioTracks',{value:undefined});
  p.win.navigator.audioSession.state='private-session-label';p.win.navigator.audioSession.type='private-type';p.tick();
  const s=p.values();assert.equal(s.apiMuted,'unknown');assert.equal(s.apiVolume,'-1');assert.equal(s.audioDecoded,'-1');assert.equal(s.audioTracks,'-1');assert.equal(s.audioSession,'unknown');assert.equal(s.audioSessionType,'unknown');
  assert.doesNotMatch(p.label(),/private-session|private-type/);
});

test('source ordinals distinguish a replaced stream from a replaced media node without exposing URLs',t=>{
  const p=page(t);const first=p.values();p.state.currentSrc='blob:second-private-source';p.tick();const second=p.values();
  assert.equal(second.audioMedia,first.audioMedia);assert.equal(Number(second.audioSource),Number(first.audioSource)+1);
  const replacement=p.doc.createElement('video');Object.defineProperty(replacement,'currentSrc',{value:'blob:third-private-source'});p.video.replaceWith(replacement);p.tick();const third=p.values();
  assert.equal(Number(third.audioMedia),Number(second.audioMedia)+1);assert.equal(Number(third.audioSource),Number(second.audioSource)+1);
  assert.doesNotMatch(p.label(),/private-source/);
});

test('ordinary Hold probe keeps compact audio state without installing the verbose gesture recorder',t=>{
  const p=page(t,false);p.event('ratechange');p.event('volumechange');p.tick();
  assert.equal(p.win.__langformPlaybackSwipeTrace,undefined);
  assert.equal(p.win.__langformReplayDiagnostic,undefined);
  assert.equal(p.values().audioEvents,'');assert.equal(p.values().gestureInputs,'');assert.equal(p.values().swipeTrace,'');
  assert.equal(p.values().muted,'false');assert.equal(p.values().apiMuted,'false');assert.equal(p.values().audioTracks,'2');
});

test('existing opt-in samples report fullscreen input stage and inert state without invoking player or gesture APIs',t=>{
  const p=page(t,false),first=Number(p.values().sample),pending=p.pending();
  p.win.__langformFullscreen={getZoomContext(){assert.fail('readiness must not invoke a layout-producing gesture API');}};
  assert.equal(p.values().fsStage,'none');assert.equal(p.values().fsInert,'none');
  const ui=p.doc.createElement('div');ui.id='langform-fullscreen-ui';ui.setAttribute('data-entering','');ui.setAttribute('inert','');p.doc.body.appendChild(ui);
  p.tick();assert.equal(p.values().fsStage,'entering');assert.equal(p.values().fsInert,'true');assert.ok(Number(p.values().sample)>first);
  ui.removeAttribute('data-entering');ui.removeAttribute('inert');ui.inert=false;p.tick();
  assert.equal(p.values().fsStage,'open');assert.equal(p.values().fsInert,'false');assert.equal(p.values().data,'abcdefghijk');
  ui.inert=true;p.tick();assert.equal(p.values().fsStage,'open');assert.equal(p.values().fsInert,'true','inert property is reported independently of transition attributes');
  ui.setAttribute('data-exiting','');p.tick();assert.equal(p.values().fsStage,'exiting');assert.equal(p.values().fsInert,'true');
  ui.remove();p.tick();assert.equal(p.values().fsStage,'none');assert.equal(p.values().fsInert,'none');
  assert.equal(p.pending(),pending,'no additional sampling timer');assert.equal(p.state.currentTime,30);assert.equal(p.state.playbackRate,1);
});

test('replay diagnostics expose only bounded allowlisted primitives without inspecting DOM or private payloads',t=>{
  const p=page(t),read=p.win.__langformReplayDiagnostic;
  assert.equal(typeof read,'function');
  const oldComputed=p.win.getComputedStyle;
  p.win.getComputedStyle=()=>assert.fail('replay callback performed layout');
  p.doc.querySelectorAll=()=>assert.fail('replay callback queried DOM');
  const privateValue={toJSON(){assert.fail('serialized a private object');},toString(){assert.fail('coerced a private object');}};
  read({phase:'control',result:'available',matched:true,ended:true,initial:false,nativeMini:false,miniMarker:true,navComplete:true,navPresented:true,navMatches:true,sourceMatches:true,owner:true,count:2,rawCount:8,tag:'BUTTON',nodeRole:'endscreen-buttons',beforeMini:true,afterMini:false,controlVisible:true,rootBranch:false,url:'https://private.example',label:'PRIVATE LABEL',detail:privateValue});
  const invalid={phase:'candidates',result:privateValue,count:9,rawCount:1.5,tag:'PRIVATE-ACCOUNT',nodeRole:'PRIVATE-CLASS',controlVisible:privateValue,rootBranch:1,owner:'true',detail:privateValue};
  Object.defineProperty(invalid,'matched',{get(){assert.fail('replay callback invoked an accessor');}});read(invalid);
  read({phase:'private-phase',result:'clicked'});read({phase:privateValue});
  p.win.getComputedStyle=oldComputed;delete p.doc.querySelectorAll;p.tick();
  const rows=p.values().replayTrace.split('>').map(JSON.parse);
  assert.equal(rows.length,2);
  assert.deepEqual(rows[0],{phase:'control',result:'available',tag:'BUTTON',nodeRole:'endscreen-buttons',matched:true,ended:true,initial:false,nativeMini:false,miniMarker:true,navComplete:true,navPresented:true,navMatches:true,sourceMatches:true,owner:true,beforeMini:true,afterMini:false,controlVisible:true,rootBranch:false,count:2,rawCount:8});
  assert.deepEqual(rows[1],{phase:'candidates'});
  assert.doesNotMatch(p.values().replayTrace,/private|PRIVATE|https|label|detail/);
});

test('replay diagnostics retain the latest twelve fixed size rows and have no media side effects',t=>{
  const p=page(t);assert.equal(typeof p.win.__langformReplayDiagnostic,'function');
  for(let i=0;i<25;i++)p.win.__langformReplayDiagnostic({phase:'target',result:i<13?'initial':'clicked',matched:true,count:i%9,rawCount:8,tag:'BUTTON'});
  p.tick();const value=p.values().replayTrace,rows=value.split('>').map(JSON.parse);
  assert.equal(rows.length,12);assert.ok(rows.every(row=>row.result==='clicked'));assert.ok(value.length<6000);
  assert.equal(p.state.currentTime,30);assert.equal(p.state.paused,false);assert.equal(p.state.muted,false);assert.equal(p.state.playbackRate,1);
});

test('diagnostic input/candidate callbacks do not force layout before the real 350ms Hold timer is armed',t=>{
  const p=page(t,false),hold=fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/PlaybackHold.js'),'utf8');
  p.win.PointerEvent=p.win.MouseEvent;
  p.video.getBoundingClientRect=()=>({left:0,top:0,right:400,bottom:240,width:400,height:240});
  p.win.eval(hold);
  let layouts=0;const computed=p.win.getComputedStyle;
  p.win.getComputedStyle=node=>{layouts++;return computed(node);};
  const event=new p.win.MouseEvent('pointerdown',{bubbles:true,cancelable:true,clientX:80,clientY:110});
  Object.defineProperties(event,{pointerId:{value:1},isPrimary:{value:true}});p.video.dispatchEvent(event);
  assert.equal(p.doc.getElementById('movie_player').hasAttribute('data-langform-playback-held'),true);
  assert.equal(layouts,0,'Probe layout work must be deferred until after gesture admission and timer creation');
});

test('read-only original settings probe distinguishes outer-owner siblings and body portals without labels, text or URLs',t=>{
  const p=page(t,false),owner=p.doc.createElement('ytm-player'),inner=p.doc.createElement('div');inner.id='player-container-id';
  p.root.replaceWith(owner);owner.appendChild(inner);inner.appendChild(p.root);
  const original=p.doc.createElement('player-autonav-toggle');original.className='ytwPlayerAutonavToggleHost';original.innerHTML='<button aria-pressed="true" aria-label="private-account-label">private-video-title</button>';owner.appendChild(original);
  original.getBoundingClientRect=()=>({left:12,top:24,width:44,height:44});
  const portal=original.cloneNode(true);p.doc.body.appendChild(portal);portal.querySelector('button').disabled=true;portal.querySelector('button').setAttribute('aria-pressed','false');
  p.tick();const state=JSON.parse(p.values().settingsOriginals);
  assert.equal(state.length,2);assert.equal(state[0].ownerContains,true);assert.equal(state[0].currentRoot,false);assert.equal(state[0].hostTag,'YTM-PLAYER');assert.equal(state[0].pressed,'true');assert.deepEqual(state[0].rect,[12,24,44,44]);
  assert.equal(state[0].ancestors[1].tag,'YTM-PLAYER');assert.equal(state[1].ownerContains,false);assert.equal(state[1].disabled,true);assert.equal(state[1].pressed,'false');
  assert.doesNotMatch(p.values().settingsOriginals,/private|label|title|https|src|href/);
});

test('original settings probe has at most8 controls and7 ancestors with bounded class and rectangle data',t=>{
  const p=page(t,false);let parent=p.root;
  for(let i=0;i<12;i++){const next=p.doc.createElement('div');next.className='known-class '.repeat(8);parent.appendChild(next);parent=next;}
  for(let i=0;i<14;i++){const toggle=p.doc.createElement('div');toggle.className='ytp-autonav-toggle-button extra';toggle.setAttribute('aria-checked','true');parent.appendChild(toggle);}
  p.tick();const state=JSON.parse(p.values().settingsOriginals);assert.equal(state.length,8);
  for(const item of state){assert.equal(item.ancestors.length,7);assert.equal(item.pressed,'true');assert.equal(item.ownerContains,true);assert.equal(item.currentRoot,true);for(const entry of item.ancestors)assert.ok(entry.classes.split('.').length<=4);}
});

test('settings reveal probe uses the same outer-player and container fallback as original controls without activating either',t=>{
  for(const outer of ['ytm-player','ytd-player','container','root']){
    const p=page(t,false),container=p.doc.createElement('div');container.id='player-container-id';
    let owner=p.root;
    if(outer!=='root'){p.root.replaceWith(container);container.appendChild(p.root);owner=container;}
    if(outer==='ytm-player'||outer==='ytd-player'){owner=p.doc.createElement(outer);container.replaceWith(owner);owner.appendChild(container);}
    const reveal=p.doc.createElement('button');reveal.id='player-controls-a11y-toggle';reveal.className='known-reveal';reveal.textContent='PRIVATE TITLE';reveal.setAttribute('aria-label','PRIVATE LABEL');
    reveal.addEventListener('click',()=>assert.fail('probe activated reveal'));reveal.getBoundingClientRect=()=>assert.fail('structural reveal probe forced layout');owner.appendChild(reveal);
    const portal=reveal.cloneNode(true);portal.disabled=true;p.doc.body.appendChild(portal);
    p.tick();const state=JSON.parse(p.values().settingsReveal);
    assert.equal(state.controls.length,2);assert.equal(state.controls[0].ownerContains,true);assert.equal(state.controls[0].currentRoot,outer==='root');
    assert.equal(state.hostTag,owner.tagName);assert.equal(state.controls[0].tag,'BUTTON');assert.equal(state.controls[0].disabled,false);
    assert.equal(state.controls[1].ownerContains,false);assert.equal(state.controls[1].disabled,true);
    assert.doesNotMatch(p.values().settingsReveal,/PRIVATE|label|title|https|src|href/);
  }
});

test('settings reveal probe bounds controls and ancestor tokens and exports only known own autoplay status enums',t=>{
  const p=page(t,false);let parent=p.root;
  for(let i=0;i<7;i++){const next=p.doc.createElement('div');next.className='known '.repeat(10)+' invalid:token '+ 'x'.repeat(65);parent.appendChild(next);parent=next;}
  for(let i=0;i<7;i++){const control=p.doc.createElement(i?'button':'div');control.id='player-controls-a11y-toggle';control.setAttribute('aria-disabled','true');parent.appendChild(control);}
  const own=p.doc.createElement('div');own.className='lf-player-settings';own.innerHTML='<button class="lf-autoplay-switch" aria-checked="false" aria-label="Autoplay wird eingeschaltet" disabled></button><button class="lf-autoplay-switch" aria-checked="PRIVATE" aria-label="PRIVATE ACCOUNT"></button><button class="lf-autoplay-switch" aria-label="Autoplay an"></button>';p.doc.body.appendChild(own);
  p.tick();const state=JSON.parse(p.values().settingsReveal);assert.equal(state.controls.length,4);assert.equal(state.own.length,2);
  assert.equal(state.controls[0].tag,'DIV');assert.equal(state.controls[0].disabled,true);
  for(const control of state.controls){assert.equal(control.ancestors.length,4);for(const ancestor of control.ancestors){assert.ok(ancestor.classes.split('.').length<=4);assert.ok(ancestor.classes.length<=259);}}
  assert.deepEqual(state.own,[{state:'pending',checked:'false',disabled:true},{state:'unknown',checked:'unknown',disabled:false}]);
  assert.doesNotMatch(p.values().settingsReveal,/PRIVATE|invalid:|x{65}|ACCOUNT/);
});

test('reveal hydration probe caps alternative original controls and normalizes overlay and reveal labels without private text',t=>{
  const p=page(t,false);
  p.root.insertAdjacentHTML('beforeend','<div id="player-control-overlay" class="player-controls-content shown" aria-hidden="false"></div>'+['Show player controls','Hide player controls','Steuerelemente des Videoplayers anzeigen','Steuerelemente des Videoplayers ausblenden'].map(label=>'<button id="player-controls-a11y-toggle" aria-label="'+label+'"></button>').join('')+'<div class="lf-player-settings"><button aria-label="Autoplay PRIVATE OWN"></button></div>'+Array.from({length:6},(_,i)=>'<button class="original-auto" role="switch" aria-label="'+(i%2?'Automatische Wiedergabe':'Autoplay')+' PRIVATE ACCOUNT" aria-checked="true" aria-pressed="false"></button><player-autonav-toggle></player-autonav-toggle>').join(''));
  p.doc.body.insertAdjacentHTML('beforeend','<button aria-label="Autoplay PRIVATE PORTAL"></button>');p.tick();
  const state=JSON.parse(p.values().settingsReveal);
  assert.deepEqual(state.controls.map(x=>x.intent),['show','hide','show','hide']);
  assert.deepEqual(state.overlay,{tag:'DIV',classes:'player-controls-content.shown',ariaHidden:'false'});
  assert.deepEqual(state.toggleCounts,{owner:4,document:4});assert.equal(state.candidates.length,4);
  assert.ok(state.candidates.every(x=>x.tag==='BUTTON'&&x.role==='switch'&&x.checked==='true'&&x.pressed==='false'&&x.labelMatched));
  assert.doesNotMatch(p.values().settingsReveal,/PRIVATE|ACCOUNT|PORTAL|Show player|Steuerelemente/);
});

test('watch-next probe reads only the matching current public response and distinguishes complete absent capability from partial or stale data',t=>{
  const p=page(t,false);let calls=0,response;
  p.root.getWatchNextResponse=()=>{calls++;if(response instanceof Error)throw response;return response;};
  const fresh=()=>({currentVideoEndpoint:{watchEndpoint:{videoId:'abcdefghijk'}},contents:{singleColumnWatchNextResults:{results:{results:{contents:[]}}}},playerOverlays:{playerOverlayRenderer:{}},toJSON(){assert.fail('private response serialized');}});
  response=fresh();p.tick();let state=JSON.parse(p.values().settingsReveal).watchNext;
  assert.deepEqual(state,{available:true,matchingVideo:true,complete:true,togglePresent:false,overlayAutoplay:false,nextAutoplay:false,enabled:'unknown'});
  response.playerOverlays.playerOverlayRenderer={autonavToggle:{autoplaySwitchButtonRenderer:{enabled:false,title:'PRIVATE'}},autoplay:{title:'PRIVATE'}};response.contents.singleColumnWatchNextResults.autoplay={title:'PRIVATE'};p.tick();state=JSON.parse(p.values().settingsReveal).watchNext;
  assert.equal(state.enabled,false);assert.equal(state.togglePresent,true);assert.equal(state.overlayAutoplay,true);assert.equal(state.nextAutoplay,true);
  delete response.contents.singleColumnWatchNextResults.results;p.tick();assert.equal(JSON.parse(p.values().settingsReveal).watchNext.complete,false);
  response=fresh();response.currentVideoEndpoint.watchEndpoint.videoId='staleprivate';p.tick();state=JSON.parse(p.values().settingsReveal).watchNext;assert.equal(state.matchingVideo,false);assert.equal(state.complete,false);assert.equal(state.enabled,'unknown');
  const before=calls;p.root.getVideoData=()=>({video_id:'foreignprivate'});p.tick();assert.equal(calls,before,'never invoke foreign player response');
  p.root.getVideoData=()=>({video_id:'abcdefghijk'});response=Error('PRIVATE');p.tick();assert.equal(JSON.parse(p.values().settingsReveal).watchNext.complete,false);
  assert.doesNotMatch(p.values().settingsReveal,/PRIVATE|staleprivate|foreignprivate|title|videoId|abcdefghijk/);
});

test('opt-in ad baseline reports actual player data and ad classes without changing playback or treating short duration as an ad',t=>{
  const p=page(t,false);p.state.duration=6.041;p.tick();assert.equal(p.values().ad,'false','short media alone never marks an ad');
  p.root.getVideoData=()=>({video_id:'abcdefghijk',isAd:true});p.tick();assert.equal(p.values().ad,'true');
  p.root.getVideoData=()=>({video_id:'abcdefghijk',isAd:false});
  for(const cls of ['ad-showing','ad-interrupting']){p.root.classList.add(cls);p.tick();assert.equal(p.values().ad,'true',cls);p.root.classList.remove(cls);p.tick();assert.equal(p.values().ad,'false',cls+' cleared');}
  p.root.getVideoData=()=>{throw Error('not ready')};p.root.classList.add('ad-showing');p.tick();assert.equal(p.values().ad,'true','class evidence survives unavailable metadata');
  assert.equal(p.state.currentTime,30);assert.equal(p.state.playbackRate,1);assert.equal(p.state.muted,false);
});
test('source kind reports only a fixed safe enum and never leaks the media URL',t=>{
  const p=page(t,false);
  for(const [source,kind] of [['blob:https://private.example/secret','blob'],['https://private.example/media?secret=token','https'],['data:private-secret','other'],['','none']]){
    p.state.currentSrc=source;p.tick();assert.equal(p.values().sourceKind,kind);assert.doesNotMatch(p.label(),/private|secret|token|https:\/\//);
  }
});

test('verbose swipe trace never serializes navigation detail objects or private payloads',t=>{
  const p=page(t),payload={ytResponse:{title:'PRIVATE TITLE',query:'PRIVATE QUERY',href:'https://private.example/?secret='+'x'.repeat(150000)}};
  p.win.__langformPlaybackSwipeTrace({phase:'clear',reason:'state-navigateend',event:'state-navigateend',detail:payload,href:'https://private.example',query:'PRIVATE QUERY',text:'PRIVATE TITLE'});p.tick();
  const trace=p.values().swipeTrace;assert.ok(trace.length<=6000);assert.doesNotMatch(trace,/PRIVATE|private|ytResponse|https|secret|href|query|text/);
  const record=JSON.parse(trace);assert.equal(record.event,'state-navigateend');assert.equal(Object.hasOwn(record,'detail'),false);
});
test('verbose swipe trace copies only primitive allowed fields without traversing or invoking objects',t=>{
  const p=page(t),detail={toJSON(){assert.fail('nested navigation detail was serialized')}};
  assert.doesNotThrow(()=>p.win.__langformPlaybackSwipeTrace({phase:'click',reason:'input',event:'click',detail,pointerType:'touch',candidate:true,lastTap:true,source:{toJSON(){assert.fail('source serialized')}}}));
  p.win.__langformPlaybackSwipeTrace({phase:'click',reason:'input',event:'click',detail:2,pointer:1,x:314.4,y:173.3,trusted:true,candidate:false,at:1792000000123});p.tick();
  const records=p.values().swipeTrace.split('>').map(JSON.parse);assert.equal(records[1].detail,2);assert.equal(records[1].trusted,true);assert.equal(records[1].x,314.4);assert.ok(!Object.hasOwn(records[0],'detail'));
});
test('verbose swipe trace keeps at most12 rows, strings80, valid JSON and a strict6k total budget',t=>{
  const p=page(t);for(let i=0;i<30;i++)p.win.__langformPlaybackSwipeTrace({phase:'a'.repeat(400),reason:'r'.repeat(400),event:'e'.repeat(400),pointerType:'touch',at:1792000000000+i,detail:2,pointer:i,x:314.4,y:173.3,candidate:true,lastTap:true,secondTap:true,primary:true,prevented:false,trusted:true,previous:true,cancelled:false,moved:false,second:true,activeHold:false,control:false,elapsed:60,gap:100,side:1,left:0,top:107,width:393,height:221,amount:10,contact:1,private:'Q'.repeat(20000)});
  p.tick();const trace=p.values().swipeTrace,rows=trace.split('>').map(JSON.parse);assert.equal(rows.length,12);assert.ok(trace.length<=6000,trace.length);for(const row of rows)for(const value of Object.values(row)){assert.ok(value===null||['string','number','boolean'].includes(typeof value));if(typeof value==='string')assert.ok(value.length<=80);}
});

test('settings observation exports only finite public enums and booleans without changing preferences',t=>{
  const p=page(t,false);let writes=0;
  p.root.setAutonavState=()=>writes++;p.root.getVideoData=()=>({video_id:'abcdefghijk',autonavState:2,autoplaySwitchButtonRenderer:{enabled:true}});
  p.root.getPlaybackQuality=()=> 'medium';p.root.isSubtitlesOn=()=>true;p.root.getOptions=()=>['track'];p.win.__langformGetQualityStatus=()=>({mode:'manual'});p.tick();
  const v=p.values();assert.equal(v.autonavState,'2');assert.equal(v.autonavPreference,'true');assert.equal(v.autonavSetter,'true');assert.equal(v.qualityActual,'medium');assert.equal(v.qualityMode,'manual');assert.equal(v.captionState,'true');assert.equal(v.captionAvailable,'true');assert.equal(writes,0);
  p.root.getVideoData=()=>({video_id:'abcdefghijk',autonavState:'private-token',autoplaySwitchButtonRenderer:{enabled:'private-token'}});p.root.getPlaybackQuality=()=> 'private-token';p.win.__langformGetQualityStatus=()=>({mode:'private-token'});p.root.isSubtitlesOn=()=> 'private-token';p.root.getOptions=()=>null;p.tick();
  for(const key of ['autonavState','autonavPreference','qualityActual','qualityMode','captionState','captionAvailable'])assert.equal(p.values()[key],'unknown',key);assert.doesNotMatch(p.label(),/private-token/);assert.equal(writes,0);
});


test('Hold probe exports at most16 existing zoom diagnostic rows only under explicit fullscreen diagnostics',t=>{
  const p=page(t,false);let reads=0;
  p.win.__langformPlaybackZoom={getDiagnostics(){reads++;return Array.from({length:20},(_,i)=>({event:'owner-created',sequence:i}));}};
  p.tick();assert.equal(reads,0);assert.equal(p.values().zoomTrace,'[]');
  p.win.__langformFullscreenDiagnostics=true;p.tick();assert.equal(reads,1);
  const rows=JSON.parse(p.values().zoomTrace);assert.equal(rows.length,16);assert.equal(rows[0].sequence,4);
  assert.equal(p.state.playbackRate,1);assert.equal(p.state.muted,false);
});
