const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const app=path.join(__dirname,'../ios/Langform/Langform');
const source=fs.readFileSync(path.join(app,'WatchBackgroundAudio.js'),'utf8');
const snapshot=fs.readFileSync(path.join(app,'VideoLoadProbe.swift'),'utf8').match(/static let snapshotFunction = #"""\n([\s\S]*?)\n"""#/)[1];
function setup(t){
 const dom=new JSDOM('<section><div id="movie_player"><video src="blob:private-main"></video></div></section><video id="preview"></video>',{url:'https://m.youtube.com/watch?v=abcdefghijk',runScripts:'outside-only',pretendToBeVisual:true});
 const win=dom.window,doc=win.document,root=doc.getElementById('movie_player'),video=root.querySelector('video');
 let hidden=false;Object.defineProperties(doc,{hidden:{get:()=>hidden,configurable:true},visibilityState:{get:()=>hidden?'hidden':'visible',configurable:true}});
 const hiddenDescriptor=Object.getOwnPropertyDescriptor(doc,'hidden'),visibilityDescriptor=Object.getOwnPropertyDescriptor(doc,'visibilityState');
 const state={paused:false,ended:false,error:null,seeking:false,readyState:4,muted:false,volume:1,currentSrc:'blob:private-main',playbackRate:1,currentTime:20,duration:120};
 for(const key of Object.keys(state))Object.defineProperty(video,key,{get:()=>state[key],set:()=>assert.fail('no media write '+key),configurable:true});
 const calls={play:0,pause:0,rootPlay:0,rootPause:0,foreign:0},posts=[];
 video.play=function(){if(this!==video){calls.foreign++;return;}calls.play++;state.paused=false;return Promise.resolve();};
 video.pause=function(){if(this!==video){calls.foreign++;return;}calls.pause++;state.paused=true;};
 root.pauseVideo=function(){calls.rootPause++;state.paused=true;};root.playVideo=function(){calls.rootPlay++;state.paused=false;};
 const play=video.play,pause=video.pause,rootPause=root.pauseVideo,rootPlay=root.playVideo;
 const data={video_id:'abcdefghijk',isAd:false};root.getVideoData=()=>data;
 win.webkit={messageHandlers:{langformBackgroundAudio:{postMessage:r=>posts.push(JSON.parse(JSON.stringify(r)))}}};
 win.setTimeout=win.setInterval=()=>assert.fail('no timers');
 Object.defineProperty(win.navigator,'audioSession',{get:()=>undefined});
 win.eval(source);
 const api=win.__langformWatchBackgroundAudio,real=win.__langformRealVisibility;
 t.after(()=>{api.foreground();win.dispatchEvent(new win.Event('pagehide'));win.close();});
 const emit=name=>video.dispatchEvent(new win.Event(name,{bubbles:true}));
 const capture=(cycle=1)=>api.capture('abcdefghijk',7,cycle,true);
 const hide=()=>{hidden=true;doc.dispatchEvent(new win.Event('visibilitychange'));};
 const category=(owner,cycle=1,applied=true)=>api.categoryReady('abcdefghijk',7,cycle,owner.token,applied);
 const background=(cycle=1)=>api.background('abcdefghijk',7,cycle);
 return{win,doc,root,video,state,data,calls,posts,api,real,capture,category,background,hide,emit,setHidden:v=>hidden=v,play,pause,rootPause,rootPlay,hiddenDescriptor,visibilityDescriptor};
}
test('early bootstrap is passive and exposes original visibility without timers, descriptors or playback writes',t=>{
 const s=setup(t);assert.equal(s.real.hidden(),false);assert.equal(s.real.inactive(),false);assert.equal(s.real.nativeInactive(),false);
 assert.deepEqual(Object.getOwnPropertyDescriptor(s.doc,'hidden'),s.hiddenDescriptor);assert.deepEqual(Object.getOwnPropertyDescriptor(s.doc,'visibilityState'),s.visibilityDescriptor);
 assert.deepEqual(s.calls,{play:0,pause:0,rootPlay:0,rootPause:0,foreign:0});assert.deepEqual(s.posts,[]);
});
test('source lease masks only document instance and diagnostics separate native, actual and exposed visibility',t=>{
 const s=setup(t),proto=Object.getPrototypeOf(s.doc),before=Object.getOwnPropertyDescriptor(proto,'hidden');
 const owner=s.capture();assert.equal(owner.accepted,true);assert.equal(owner.mayContinue,true);assert.equal(s.real.nativeInactive(),true);assert.equal(s.real.inactive(),true);assert.equal(s.real.hidden(),false);
 s.hide();assert.equal(s.doc.hidden,false);assert.equal(s.doc.visibilityState,'visible');assert.equal(s.real.hidden(),true);assert.equal(s.real.visibilityState(),'hidden');
 assert.deepEqual(Object.getOwnPropertyDescriptor(proto,'hidden'),before);
 const out=s.win.eval('('+snapshot+')("abcdefghijk")');assert.equal(out.hidden,true);assert.equal(out.exposedHidden,false);assert.equal(out.nativeInactive,true);assert.equal(out.visibility,'hidden');assert.equal(out.exposedVisibility,'visible');
 assert.doesNotMatch(JSON.stringify(out),/private|blob:|secret/);
});
for(const pausedReady of [1,2,4])test('already paused readyState '+pausedReady+' preserves exact source and never earns continuation',t=>{
 const s=setup(t);s.state.paused=true;s.state.readyState=pausedReady;const owner=s.capture();assert.equal(owner.accepted,true);assert.equal(owner.mayContinue,false);
 s.hide();s.background();s.category(owner);s.category(owner);s.background();assert.equal(s.state.paused,true);assert.equal(s.calls.play,0);assert.equal(s.doc.hidden,false);
 s.api.foreground();assert.equal(s.calls.play,0);assert.equal(s.real.nativeInactive(),false);
});
test('own lifecycle relay precedes captured rate and page window/document visibility teardown is blocked',t=>{
 const s=setup(t);let cleanup=0,pageEvents=0;s.state.playbackRate=2;
 s.doc.addEventListener('langform-real-visibilitychange',()=>{cleanup++;if(s.real.inactive())s.state.playbackRate=1;});
 s.win.addEventListener('visibilitychange',()=>{pageEvents++;if(s.doc.hidden)s.state.currentSrc='blob:replaced';},true);
 s.doc.addEventListener('visibilitychange',()=>{pageEvents++;s.state.currentSrc='blob:replaced';});
 const owner=s.capture();assert.equal(cleanup,1);s.state.paused=true;s.hide();assert.equal(cleanup,2);assert.equal(pageEvents,0);s.background();s.category(owner);assert.equal(s.calls.play,1,'restored rate was captured');assert.equal(s.state.currentSrc,'blob:private-main');
});
for(const order of ['category-background-hidden','background-category-hidden','hidden-category-background','hidden-background-category','category-hidden-background','background-hidden-category'])test('one prior-playing continuation waits for actual hidden, category and native background: '+order,t=>{
 const s=setup(t),owner=s.capture();s.state.paused=true;s.emit('pause');
 for(const step of order.split('-')){if(step==='category')s.category(owner);if(step==='background')s.background();if(step==='hidden')s.hide();}
 assert.equal(s.calls.play,1);assert.equal(s.state.paused,false);assert.equal(s.doc.hidden,false);
 s.category(owner);s.background();s.hide();s.state.paused=true;s.emit('pause');s.category(owner);s.background();s.hide();assert.equal(s.calls.play,1,'no retry after consumed cycle');
 s.api.foreground();assert.equal(s.state.paused,true);assert.equal(s.calls.play,1,'foreground never starts media');
});
test('already running at handoff consumes privilege without a redundant play request',t=>{
 const s=setup(t),owner=s.capture();s.hide();s.category(owner);s.background();assert.equal(s.calls.play,0);assert.ok(s.posts.some(r=>r.kind==='already-playing'));
 s.state.paused=true;s.emit('pause');s.hide();s.background();s.category(owner);assert.equal(s.calls.play,0);
});
for(const method of ['video.pause','root.pauseVideo','explicitAction','interrupt','video.play','root.playVideo'])test(method+' revokes continuation while retaining same paused source',t=>{
 const s=setup(t),owner=s.capture();s.state.paused=true;s.emit('pause');s.hide();
 if(method==='video.pause')s.video.pause();if(method==='root.pauseVideo')s.root.pauseVideo();if(method==='explicitAction')s.api.explicitAction('abcdefghijk');if(method==='interrupt')s.api.interrupt('abcdefghijk',7,1);if(method==='video.play')s.video.play();if(method==='root.playVideo')s.root.playVideo();
 s.state.paused=true;const explicitPlay=s.calls.play;s.category(owner);s.background();s.category(owner);assert.equal(s.calls.play,explicitPlay);assert.equal(s.state.paused,true);assert.equal(s.doc.hidden,false);assert.equal(s.api.matches('abcdefghijk',7,owner.token),true);
});
test('platform pause event retains privilege; explicit pause already paused during native capture still revokes it',t=>{
 const s=setup(t),owner=s.capture();s.state.paused=true;s.emit('pause');s.hide();s.background();s.category(owner);assert.equal(s.calls.play,1);
 const next=s.capture(2);s.state.paused=true;s.emit('pause');s.api.explicitAction('abcdefghijk');s.category(next,2);s.background(2);assert.equal(s.calls.play,1);assert.equal(s.doc.hidden,false);
});
test('wrong ID, ticket, token or old same-video cycle cannot grant, interrupt or cancel newer lease',t=>{
 const s=setup(t),old=s.capture(1),owner=s.capture(2);s.state.paused=true;s.hide();
 assert.equal(s.api.background('zzzzzzzzzzz',7,2),false);assert.equal(s.api.background('abcdefghijk',8,2),false);assert.equal(s.category(old,1),false);assert.equal(s.api.interrupt('abcdefghijk',7,1),false);assert.equal(s.api.cancel('abcdefghijk',7,1,old.token),false);assert.equal(s.api.explicitAction('zzzzzzzzzzz'),false);
 s.category(owner,2);s.background(2);assert.equal(s.calls.play,1);
});
for(const reason of ['mute','zero-volume','rate','seeking','not-ready','category-failure'])test('no continuation after '+reason+' and no source/mute/rate/seek changes',t=>{
 const s=setup(t),owner=s.capture();s.state.paused=true;s.hide();
 if(reason==='mute'){s.state.muted=true;s.emit('volumechange');}if(reason==='zero-volume'){s.state.volume=0;s.emit('volumechange');}if(reason==='rate'){s.state.playbackRate=1.5;s.emit('ratechange');}if(reason==='seeking')s.state.seeking=true;if(reason==='not-ready')s.state.readyState=2;
 s.category(owner,1,reason!=='category-failure');s.background();assert.equal(s.calls.play,0);assert.equal(s.state.paused,true);assert.equal(s.doc.hidden,false);assert.equal(s.state.currentTime,20);
 if(reason!=='category-failure'){s.state.muted=false;s.state.volume=1;s.state.playbackRate=1;s.state.seeking=false;s.state.readyState=4;s.category(owner);s.background();s.hide();assert.equal(s.calls.play,0,'rejected slot cannot retry');}
});
for(const reason of ['source','src-attribute','video','root','ad-class','ad-data','route','ended','error','emptied','loadstart','navigation','pagehide'])test('ownership loss '+reason+' cancels source protection and all continuation',async t=>{
 const s=setup(t),owner=s.capture();s.state.paused=true;s.setHidden(true);
 if(reason==='source')s.state.currentSrc='blob:other';if(reason==='src-attribute')s.video.setAttribute('src','blob:other');if(reason==='video')s.video.replaceWith(s.video.cloneNode());if(reason==='root')s.root.replaceWith(s.root.cloneNode(true));if(reason==='ad-class')s.root.classList.add('ad-showing');if(reason==='ad-data')s.data.isAd=true;if(reason==='route')s.win.history.replaceState({},'','/watch?v=zzzzzzzzzzz');if(reason==='ended'){s.state.ended=true;s.emit('ended');}if(reason==='error'){s.state.error={code:4};s.emit('error');}if(reason==='emptied'||reason==='loadstart')s.emit(reason);if(reason==='navigation')s.win.dispatchEvent(new s.win.Event('yt-navigate-start'));if(reason==='pagehide')s.win.dispatchEvent(new s.win.Event('pagehide'));
 s.category(owner);s.background();for(let n=0;n<4;n++)await Promise.resolve();assert.equal(s.calls.play,0);assert.equal(s.doc.hidden,true);assert.equal(s.api.matches('abcdefghijk',7,owner.token),false);
});
test('getVideoData reading hidden cannot recurse and reentrant explicit pause prevents deferred play',t=>{
 const s=setup(t);let reads=0;s.root.getVideoData=()=>{reads++;assert.equal(s.doc.hidden,false);return s.data;};const owner=s.capture();assert.ok(reads<10);
 s.state.paused=true;s.hide();s.category(owner);s.root.getVideoData=()=>{s.root.pauseVideo();return s.data;};s.background();assert.equal(s.calls.play,0);assert.equal(s.state.paused,true);assert.equal(s.doc.hidden,false);
});
test('foreground restores only owned descriptors and methods and never overwrites newer page replacements',t=>{
 const s=setup(t);s.capture();const replacement=()=>true,replacementPause=()=>{};Object.defineProperty(s.doc,'hidden',{get:replacement,configurable:true});s.video.pause=replacementPause;s.api.foreground();
 assert.equal(Object.getOwnPropertyDescriptor(s.doc,'hidden').get,replacement);assert.equal(s.video.pause,replacementPause);assert.equal(s.video.play,s.play);assert.equal(s.root.pauseVideo,s.rootPause);assert.equal(s.root.playVideo,s.rootPlay);assert.deepEqual(Object.getOwnPropertyDescriptor(s.doc,'visibilityState'),s.visibilityDescriptor);assert.equal(s.calls.play,0);
});
for(const property of ['hidden','visibilityState','pause'])test('unwrappable '+property+' rejects lease and rolls back owned changes',t=>{
 const s=setup(t);if(property==='pause')Object.defineProperty(s.video,'pause',{value:s.pause,writable:false,configurable:false});else{const old=Object.getOwnPropertyDescriptor(s.doc,property);Object.defineProperty(s.doc,property,{...old,configurable:false});}
 assert.equal(s.capture().accepted,false);s.setHidden(true);assert.equal(s.doc.hidden,true);assert.equal(s.calls.play,0);assert.equal(s.video.play,s.play);
});
test('instance wrapper on foreign receiver preserves foreign action without revoking current main',t=>{
 const s=setup(t),owner=s.capture();s.video.pause.call(s.doc.getElementById('preview'));assert.equal(s.calls.foreign,1);s.state.paused=true;s.hide();s.background();s.category(owner);assert.equal(s.calls.play,1);
});
test('continuation promise rejection is observed once and never retried or replayed on foreground',async t=>{
 const s=setup(t);s.video.play=function(){s.calls.play++;return Promise.reject(new Error('blocked'));};const owner=s.capture();s.state.paused=true;s.hide();s.background();s.category(owner);await Promise.resolve();assert.equal(s.calls.play,1);assert.ok(s.posts.some(row=>row.kind==='continuation-failed'));s.background();s.category(owner);s.hide();s.api.foreground();assert.equal(s.calls.play,1);assert.equal(s.state.paused,true);
});
for(const input of ['remote-pause','central-pause'])test(input+' while already platform-paused revokes privilege without losing source',t=>{
 const s=setup(t);if(input==='remote-pause')s.win.eval(fs.readFileSync(path.join(app,'SystemMedia.js'),'utf8'));
 else{s.win.requestAnimationFrame=()=>1;s.win.cancelAnimationFrame=()=>{};s.win.setTimeout=()=>1;s.win.clearTimeout=()=>{};s.win.eval(fs.readFileSync(path.join(app,'PlayerRect.js'),'utf8'));}
 const owner=s.capture();s.state.paused=true;s.emit('pause');s.hide();
 const command=input==='remote-pause'?s.win.__langformSystemCommand('abcdefghijk','pause'):s.win.__langformPause('abcdefghijk');assert.equal(command,true);
 s.background();s.category(owner);assert.equal(s.calls.play,0);assert.equal(s.state.paused,true);assert.equal(s.doc.hidden,false);assert.ok(s.posts.some(r=>r.kind==='pause-intent'));
});
test('paused protection revalidates data-only advertisement outside getter without granting playback',t=>{
 const s=setup(t);s.state.paused=true;const owner=s.capture();s.setHidden(true);s.data.isAd=true;s.background();s.category(owner);assert.equal(s.doc.hidden,true);assert.equal(s.calls.play,0);assert.equal(s.api.matches('abcdefghijk',7,owner.token),false);
});
test('page replacement of a protected method revokes ownership and does not overwrite the new implementation',t=>{
 const s=setup(t),owner=s.capture(),replacement=()=>{};s.video.pause=replacement;s.state.paused=true;s.setHidden(true);s.background();s.category(owner);assert.equal(s.calls.play,0);assert.equal(s.video.pause,replacement);assert.equal(s.doc.hidden,true);
});
test('failed category decision is terminal for the same cycle even if a duplicate later claims success',t=>{
 const s=setup(t),owner=s.capture();s.state.paused=true;s.hide();s.background();s.category(owner,1,false);s.category(owner,1,true);s.hide();assert.equal(s.calls.play,0);assert.equal(s.state.paused,true);assert.equal(s.doc.hidden,false);
});
for(const reason of ['root','video','source','src-attribute','route','ad-class','native-drag'])test('central explicit Pause rejects reentrant '+reason+' before revocation or media command',t=>{
 const s=setup(t);s.win.requestAnimationFrame=()=>1;s.win.cancelAnimationFrame=()=>{};s.win.setTimeout=()=>1;s.win.clearTimeout=()=>{};s.win.eval(fs.readFileSync(path.join(app,'PlayerRect.js'),'utf8'));
 let intents=0;s.win.__langformWatchBackgroundAudio.explicitAction=()=>{intents++;};
 s.root.getVideoData=()=>{if(reason==='root')s.root.replaceWith(s.root.cloneNode(true));if(reason==='video')s.video.replaceWith(s.video.cloneNode());if(reason==='source')s.state.currentSrc='blob:new';if(reason==='src-attribute')s.video.setAttribute('src','blob:new');if(reason==='route')s.win.history.replaceState({},'','/watch?v=zzzzzzzzzzz');if(reason==='ad-class')s.root.classList.add('ad-showing');if(reason==='native-drag')s.win.__langformSetNativeDragging(true,'abcdefghijk');return s.data;};
 assert.equal(s.win.__langformPause('abcdefghijk'),false);assert.equal(s.calls.pause+s.calls.rootPause,0);assert.equal(intents,0);assert.equal(s.state.paused,false);
});
for(const old of [1,2])test('delayed/duplicate capture cycle '+old+' cannot replace already-owned cycle2',t=>{
 const s=setup(t),owner=s.capture(2);let relays=0;s.doc.addEventListener('langform-real-visibilitychange',()=>relays++);
 assert.equal(s.capture(old).accepted,false);assert.equal(relays,0);assert.equal(s.api.matches('abcdefghijk',7,owner.token),true);s.state.paused=true;s.hide();s.category(owner,2);s.background(2);assert.equal(s.calls.play,1);
});
for(const callback of ['data','relay'])test('reentrant newer capture during '+callback+' prevents stale outer lease promotion',t=>{
 const s=setup(t);let newer,triggered=false;
 function replace(){if(!triggered){triggered=true;newer=s.capture(2);}}
 if(callback==='data')s.root.getVideoData=()=>{replace();return s.data;};else s.doc.addEventListener('langform-real-visibilitychange',replace);
 const older=s.capture(1);assert.equal(older.accepted,false);assert.equal(newer.accepted,true);assert.equal(s.api.matches('abcdefghijk',7,newer.token),true);s.state.paused=true;s.hide();s.category(newer,2);s.background(2);assert.equal(s.calls.play,1);
});
test('foreground native-cycle fence rejects unexecuted stale captures without masking visible page',t=>{
 const s=setup(t);assert.equal(s.api.foreground(2),true);assert.equal(s.capture(1).accepted,false);assert.equal(s.capture(2).accepted,false);assert.equal(s.real.nativeInactive(),false);assert.deepEqual(Object.getOwnPropertyDescriptor(s.doc,'hidden'),s.hiddenDescriptor);assert.equal(s.calls.play,0);
 const next=s.capture(3);assert.equal(next.accepted,true);assert.equal(s.real.nativeInactive(),true);
});
test('stale foreground of prior cycle cannot tear down newer source protection or continuation',t=>{
 const s=setup(t),owner=s.capture(2);assert.equal(s.api.foreground(1),false);assert.equal(s.real.nativeInactive(),true);assert.equal(s.api.matches('abcdefghijk',7,owner.token),true);s.state.paused=true;s.hide();s.category(owner,2);s.background(2);assert.equal(s.calls.play,1);
});
test('foreground reentrancy during capture revokes native-inactive authority before installing any mask',t=>{
 const s=setup(t);s.root.getVideoData=()=>{s.api.foreground(1);return s.data;};assert.equal(s.capture(1).accepted,false);assert.equal(s.real.nativeInactive(),false);assert.deepEqual(Object.getOwnPropertyDescriptor(s.doc,'hidden'),s.hiddenDescriptor);assert.equal(s.calls.play,0);
});
test('reentrant newer capture during method installation restores only stale installed fields',t=>{
 const s=setup(t);let newer,triggered=false;Object.defineProperty(s.root,'pauseVideo',{configurable:true,get(){if(!triggered){triggered=true;newer=s.capture(2);}return s.rootPause;}});
 assert.equal(s.capture(1).accepted,false);assert.equal(newer.accepted,true);assert.equal(s.api.matches('abcdefghijk',7,newer.token),true);s.state.paused=true;s.hide();s.category(newer,2);s.background(2);assert.equal(s.calls.play,1);
});
test('throwing original control getter rejects and rolls back partial source protection',t=>{
 const s=setup(t);Object.defineProperty(s.root,'pauseVideo',{configurable:true,get(){throw new Error('page getter');}});assert.equal(s.capture(1).accepted,false);assert.deepEqual(Object.getOwnPropertyDescriptor(s.doc,'hidden'),s.hiddenDescriptor);assert.equal(s.video.pause,s.pause);assert.equal(s.video.play,s.play);assert.equal(s.calls.play,0);
});
test('reentrant newer capture in captured video.play getter survives outer pre-promotion boundary',t=>{
 const s=setup(t);let newer,triggered=false;Object.defineProperty(s.video,'play',{configurable:true,get(){if(!triggered){triggered=true;newer=s.capture(2);}return s.play;}});
 const older=s.capture(1);assert.equal(older.accepted,false);assert.equal(newer.accepted,true);assert.equal(s.api.matches('abcdefghijk',7,newer.token),true);
 s.state.paused=true;s.hide();s.category(newer,2);s.background(2);assert.equal(s.calls.play,1);
});
test('native visibility capture accepts arbitrary exact current Watch owner without a diagnostic-video dependency',t=>{
 const s=setup(t);s.win.history.replaceState({},'','/watch?v=zzzzzzzzzzz');s.data.video_id='zzzzzzzzzzz';const owner=s.api.capture('zzzzzzzzzzz',7,1,true);assert.equal(owner.accepted,true);assert.equal(owner.mayContinue,true);s.state.paused=true;s.hide();s.api.background('zzzzzzzzzzz',7,1);s.api.categoryReady('zzzzzzzzzzz',7,1,owner.token,true);assert.equal(s.calls.play,1);
});
for(const reason of ['source','attribute','protected','metadata'])test('opt-in lease trace records exact '+reason+' cancellation without URL or metadata reread',t=>{
 const s=setup(t);s.win.__langformBackgroundAudioDiagnostics=true;let dataReads=0;s.root.getVideoData=()=>{dataReads++;return s.data;};const owner=s.capture();const before=dataReads;
 if(reason==='source')s.state.currentSrc='blob:private-replaced';if(reason==='attribute')s.video.setAttribute('src','blob:private-replaced');if(reason==='protected')s.root.pauseVideo=()=>{};if(reason==='metadata')s.data.video_id='zzzzzzzzzzz';s.background();
 const rows=s.posts.filter(row=>row.kind==='diagnostic'),last=rows.at(-1);assert.equal(last.phase,'cancel');assert.equal(last.trigger,'background');assert.equal(last.reason,{source:'source-changed',attribute:'attribute-changed',protected:'protected-field-replaced',metadata:'metadata-id'}[reason]);if(reason==='protected')assert.equal(last.field,'root.pauseVideo');
 assert.equal(dataReads-before,reason==='metadata'?1:0,'only the existing ownership read executes');assert.doesNotMatch(JSON.stringify(rows),/blob:|private|secret|stack|currentSrc|https:/);assert.equal(s.api.matches('abcdefghijk',7,owner.token),false);
});
test('opt-in waiting trace distinguishes category, native-background and real-visible gates before one continuation',t=>{
 const s=setup(t);s.win.__langformBackgroundAudioDiagnostics=true;const owner=s.capture();s.category(owner);s.background();s.state.paused=true;s.hide();
 const rows=s.posts.filter(row=>row.kind==='diagnostic');assert.ok(rows.some(row=>row.phase==='waiting'&&row.trigger==='category'&&row.reason==='not-background'));assert.ok(rows.some(row=>row.phase==='waiting'&&row.trigger==='background'&&row.reason==='real-visible'));assert.ok(rows.some(row=>row.phase==='continued'&&row.trigger==='visibility'));assert.equal(s.calls.play,1);
});
test('opt-in explicit Pause trace revokes privilege while source mask remains; media event alone is distinct',t=>{
 const s=setup(t);s.win.__langformBackgroundAudioDiagnostics=true;s.capture();s.state.paused=true;s.emit('pause');s.video.pause();
 const rows=s.posts.filter(row=>row.kind==='diagnostic');assert.ok(rows.some(row=>row.phase==='media-event'&&row.trigger==='pause'));assert.ok(rows.some(row=>row.phase==='revoke'&&row.trigger==='pause'&&row.reason==='explicit-intent'));assert.equal(s.doc.hidden,false);assert.equal(s.calls.play,0);
});
test('diagnostic trace is capped at32 rows/document and creates no extra media reads',t=>{
 const s=setup(t);s.win.__langformBackgroundAudioDiagnostics=true;s.capture();Object.defineProperty(s.video,'currentTime',{configurable:true,get:()=>assert.fail('reason trace does not sample media time')});
 for(let n=0;n<100;n++)s.emit('pause');const rows=s.posts.filter(row=>row.kind==='diagnostic');assert.equal(rows.length,32);assert.deepEqual(rows.map(row=>row.row),Array.from({length:32},(_,n)=>n+1));assert.ok(rows.every(row=>!('time'in row)&&!('readyState'in row)&&!('paused'in row)));s.api.foreground(1);s.capture(2);assert.equal(s.posts.filter(row=>row.kind==='diagnostic').length,32);
});
