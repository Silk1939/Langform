const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const directory=path.join(__dirname,'../ios/Langform/Langform');
const source=fs.readFileSync(path.join(directory,'PlayerSettings.js'),'utf8');
function setup(t,options={}){
  const dom=new JSDOM('<!doctype html><head></head><body><ytm-player><div id="movie_player"><video src="https://example.test/a"></video><button class="ytp-fullscreen-button">Fullscreen</button></div><player-autonav-toggle><button aria-pressed="false">Original Autoplay</button></player-autonav-toggle></ytm-player><input type="search"></body>',{url:'https://m.youtube.com/watch?v=abcdefghijk',runScripts:'outside-only',pretendToBeVisual:true});
  const win=dom.window,doc=win.document,root=doc.getElementById('movie_player'),video=root.querySelector('video'),original=doc.querySelector('player-autonav-toggle button'),calls=[],overlays=[],errors=[];
  win.addEventListener('error',e=>{errors.push(e.message);e.preventDefault();});
  t.after(()=>{win.dispatchEvent(new win.Event('pagehide'));win.close();assert.deepEqual(errors,[]);});
  let id='abcdefghijk',quality='hd720',caption=false,manual=false;
  root.getVideoData=()=>({video_id:id,title:'A video'});root.getPlaybackQuality=()=>quality;
  root.getAvailableQualityLevels=()=>['hd1080','hd720','large','medium','invalid','hd720'];
  root.setPlaybackQualityRange=(a,b)=>{calls.push(['quality',a,b]);quality=b;manual=true;};
  root.getOptions=()=>['track'];root.isSubtitlesOn=()=>caption;root.toggleSubtitles=user=>{calls.push(['captions',user]);caption=!caption;};
  Object.defineProperties(video,{paused:{value:true,writable:true},ended:{value:false,writable:true},readyState:{value:4,writable:true},duration:{value:200,writable:true},videoWidth:{value:1920},videoHeight:{value:1080},currentTime:{value:30,writable:true}});
  video.play=()=>{throw Error('no own play')};video.pause=()=>{throw Error('no own pause')};
  win.__langformSetOverlayState=(name,value)=>overlays.push([name,value]);
  win.__langformGetQualityStatus=()=>({mode:manual?'manual':'adaptive',actual:quality,requestedCap:'hd720'});
  win.__langformUseAdaptiveQuality=expected=>{calls.push(['auto',expected]);manual=false;return true;};
  original.addEventListener('click',()=>{calls.push(['original-autoplay']);original.setAttribute('aria-pressed',String(original.getAttribute('aria-pressed')!=='true'));});
  if(options.before)options.before({win,doc,root,video,original});
  win.eval(source);
  const gear=()=>doc.querySelector('.lf-player-settings[data-inline] .lf-settings-gear'),layer=()=>doc.querySelector('.lf-player-settings-layer'),setting=key=>layer().querySelector(`[data-setting="${key}"]`);
  return {win,doc,root,video,original,calls,overlays,gear,layer,setting,id:value=>{id=value},caption:()=>caption,loadFullscreen(){win.scrollTo=()=>{};win.webkit={messageHandlers:{langformFullscreen:{postMessage:()=>{}}}};win.eval(fs.readFileSync(path.join(directory,'FullscreenMotion.js'),'utf8'));root.querySelector('.ytp-fullscreen-button').click();return doc.getElementById('langform-fullscreen-ui');}};
}
function contact(s,button,type,kind='pointer',x=20,primary=true){
  const e=kind==='pointer'?new s.win.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:130}):new s.win.Event(type,{bubbles:true,cancelable:true});
  if(kind==='pointer')Object.defineProperties(e,{pointerId:{value:3},isPrimary:{value:primary}});
  else {const point={identifier:3,clientX:x,clientY:130};Object.defineProperties(e,{touches:{value:type==='touchend'?[]:[point]},changedTouches:{value:[point]}});}
  button.dispatchEvent(e);return e;
}
for(const kind of ['pointer','touch'])test(`own settings ${kind} release activates without a browser click, once, while other window cleanup still runs`,t=>{
  const s=setup(t),toggle=s.doc.querySelector('.lf-autoplay-switch'),down=kind==='pointer'?'pointerdown':'touchstart',up=kind==='pointer'?'pointerup':'touchend';let cleaned=0;
  s.win.addEventListener(up,()=>cleaned++,true);
  contact(s,toggle,down,kind);contact(s,toggle,up,kind);
  assert.equal(s.original.getAttribute('aria-pressed'),'true');assert.equal(cleaned,1);
  toggle.dispatchEvent(new s.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));assert.equal(s.calls.length,1);
  contact(s,s.gear(),down,kind);contact(s,s.gear(),up,kind);assert.equal(s.layer().hidden,false);
  s.gear().dispatchEvent(new s.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));assert.equal(s.layer().hidden,false);
  const speed=s.setting('speed');contact(s,speed,down,kind);contact(s,speed,up,kind);
  const choice=s.layer().querySelector('[data-speed="1.5"]');contact(s,choice,down,kind);contact(s,choice,up,kind);
  assert.equal(s.video.playbackRate,1.5);assert.equal(s.video.currentTime,30);assert.equal(s.video.paused,true);assert.equal(s.layer().hidden,true);
});
for(const reason of ['move','cancel','secondary','source','route','ad','inactive','removed'])test(`owned settings contact is revoked after ${reason}`,t=>{
  const s=setup(t),toggle=s.doc.querySelector('.lf-autoplay-switch');contact(s,toggle,'pointerdown');
  if(reason==='move')contact(s,toggle,'pointermove','pointer',45);
  if(reason==='cancel')contact(s,toggle,'pointercancel');
  if(reason==='secondary')contact(s,toggle,'pointerdown','pointer',20,false);
  if(reason==='source')s.video.src='https://example.test/replaced';
  if(reason==='route')s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');
  if(reason==='ad')s.root.classList.add('ad-showing');
  if(reason==='inactive')Object.defineProperty(s.doc,'hidden',{value:true});
  if(reason==='removed')toggle.remove();
  contact(s,toggle,'pointerup');toggle.dispatchEvent(new s.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
  assert.deepEqual(s.calls,[]);assert.equal(s.video.playbackRate,1);
});
test('a delayed click from the preceding gear cannot close the next submenu after another physical tap',t=>{
  const s=setup(t);let now=1000;s.win.Date.now=()=>now;
  contact(s,s.gear(),'pointerdown');contact(s,s.gear(),'pointerup');
  const quality=s.setting('quality');now=1200;contact(s,quality,'pointerdown');contact(s,quality,'pointerup');
  now=2900;s.gear().dispatchEvent(new s.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
  assert.equal(s.layer().hidden,false);assert.equal(s.layer().querySelector('h2').textContent,'Qualität');
  s.gear().click();assert.equal(s.layer().hidden,true,'explicit keyboard/AX-style zero-detail activation remains available');
});
test('gear opens a real bottom dialog while media state stays untouched; close restores focus and overlay lease',t=>{const s=setup(t);s.gear().click();assert.equal(s.layer().hidden,false);assert.equal(s.layer().querySelector('[role=dialog]').getAttribute('aria-modal'),'true');assert.equal(s.gear().getAttribute('aria-expanded'),'true');assert.equal(s.video.currentTime,30);assert.equal(s.video.paused,true);assert.deepEqual(s.calls,[]);assert.equal(s.overlays.at(-1)[1],true);assert.match(s.layer().textContent,/Qualität/);assert.match(s.layer().textContent,/Wiedergabegeschwindigkeit/);assert.match(s.layer().textContent,/Untertitel/);s.layer().querySelector('.lf-settings-close').click();assert.equal(s.layer().hidden,true);assert.equal(s.doc.activeElement,s.gear());assert.equal(s.overlays.at(-1)[1],false);});
test('inline controls share the original sibling-overlay layer and capture only their own actions before website player handlers',t=>{
  const s=setup(t,{before:({root})=>{
    root.style.cssText='position:relative;z-index:0';
    const overlay=root.ownerDocument.createElement('div');overlay.id='player-control-overlay';overlay.style.cssText='position:absolute;inset:0;z-index:50';root.parentElement.appendChild(overlay);
    root.parentElement.addEventListener('click',event=>{if(event.target.closest('.lf-player-settings'))event.stopImmediatePropagation();},true);
  }});
  const wrap=s.gear().closest('.lf-player-settings');
  assert.equal(wrap.parentElement,s.root.parentElement,'controls escape movie_player stacking context beneath original sibling overlay');
  s.gear().click();assert.equal(s.layer().hidden,false,'capture precedes website player listener');
  s.layer().querySelector('.lf-settings-close').click();
  s.doc.querySelector('.lf-autoplay-switch').click();assert.deepEqual(s.calls,[['original-autoplay']],'nested original action is delegated once');
});
test('own gear click cannot be swallowed by a website capture listener on the current player owner',t=>{
  const s=setup(t,{before:({root})=>root.parentElement.addEventListener('click',event=>{if(event.target.closest('.lf-player-settings'))event.stopImmediatePropagation();},true)});
  s.gear().click();assert.equal(s.layer().hidden,false);
});
test('bottom-sheet actions survive a website document capture listener and execute exactly once',t=>{
  const s=setup(t,{before:({doc})=>doc.addEventListener('click',event=>{if(event.target.closest('.lf-player-settings-layer'))event.stopImmediatePropagation();},true)});
  s.gear().click();s.setting('speed').click();
  assert.equal(s.layer().querySelector('h2').textContent,'Wiedergabegeschwindigkeit');
  s.layer().querySelector('[data-speed="1.5"]').click();assert.equal(s.video.playbackRate,1.5);assert.equal(s.layer().hidden,true);assert.deepEqual(s.calls,[]);
  s.gear().click();s.setting('quality').click();s.layer().querySelector('[data-quality="medium"]').click();assert.deepEqual(s.calls,[['quality','medium','medium']]);assert.equal(s.layer().hidden,true);
});
test('manual quality delegates exact user choice and Auto returns to the bounded adaptive policy',t=>{const s=setup(t);s.gear().click();s.setting('quality').click();assert.equal(s.layer().querySelectorAll('[data-quality="hd720"]').length,1);assert.equal(s.layer().querySelector('[data-quality="invalid"]'),null);s.layer().querySelector('[data-quality="hd1080"]').click();assert.deepEqual(s.calls,[['quality','hd1080','hd1080']]);assert.equal(s.layer().hidden,true);s.gear().click();s.setting('quality').click();s.layer().querySelector('[data-quality="auto"]').click();assert.deepEqual(s.calls.at(-1),['auto','abcdefghijk']);assert.equal(s.video.paused,true);});
test('manual speed changes only current media rate and preserves paused playback, source and time',t=>{const s=setup(t);s.gear().click();s.setting('speed').click();s.layer().querySelector('[data-speed="1.5"]').click();assert.equal(s.video.playbackRate,1.5);assert.equal(s.video.defaultPlaybackRate,1);assert.equal(s.video.currentTime,30);assert.equal(s.video.paused,true);assert.equal(s.video.getAttribute('src'),'https://example.test/a');assert.deepEqual(s.calls,[]);});
test('an already open menu enables real capabilities after hydration without replacing focused controls',t=>{
  let ready=false;
  const s=setup(t,{before:({root,video})=>{root.getAvailableQualityLevels=()=>ready?['medium']:[];root.getOptions=()=>ready?['track']:[];video.readyState=0;}});
  s.gear().click();const quality=s.setting('quality'),speed=s.setting('speed'),captions=s.setting('captions');
  assert.equal(quality.disabled,true);assert.equal(speed.disabled,true);assert.equal(captions.disabled,true);
  s.layer().querySelector('.lf-settings-close').focus();const focus=s.doc.activeElement;
  ready=true;s.video.readyState=4;s.video.dispatchEvent(new s.win.Event('loadedmetadata'));
  assert.equal(s.setting('quality'),quality);assert.equal(s.setting('speed'),speed);assert.equal(s.setting('captions'),captions);assert.equal(s.doc.activeElement,focus);
  assert.equal(quality.disabled,false);assert.equal(speed.disabled,false);assert.equal(captions.disabled,false);assert.deepEqual(s.calls,[]);
  quality.click();assert.ok(s.layer().querySelector('[data-quality="medium"]'));
});
test('open speed choices follow external rate changes in place',t=>{
  const s=setup(t);s.gear().click();s.setting('speed').click();const choice=s.layer().querySelector('[data-speed="1.5"]');
  choice.focus();s.video.playbackRate=1.5;s.video.dispatchEvent(new s.win.Event('ratechange'));
  assert.equal(s.layer().querySelector('[data-speed="1.5"]'),choice);assert.equal(choice.getAttribute('aria-checked'),'true');assert.equal(s.doc.activeElement,choice);assert.deepEqual(s.calls,[]);
});
test('caption setting toggles actual state once, repeated explicit same choice is a no-op',t=>{const s=setup(t);s.gear().click();s.setting('captions').click();s.layer().querySelector('[data-caption="true"]').click();assert.equal(s.caption(),true);assert.deepEqual(s.calls,[['captions',true]]);s.gear().click();s.setting('captions').click();s.layer().querySelector('[data-caption="true"]').click();assert.deepEqual(s.calls,[['captions',true]]);s.gear().click();s.setting('captions').click();s.layer().querySelector('[data-caption="false"]').click();assert.equal(s.caption(),false);assert.deepEqual(s.calls,[['captions',true],['captions',true]]);});
test('Autoplay mirrors and invokes original YouTube control; ended/pause/seek never initiates own next navigation',async t=>{const s=setup(t),toggle=s.doc.querySelector('.lf-autoplay-switch');assert.equal(toggle.getAttribute('aria-checked'),'false');toggle.click();assert.equal(s.original.getAttribute('aria-pressed'),'true');assert.equal(toggle.getAttribute('aria-checked'),'true');for(const name of ['ended','pause','seeking','seeked'])s.video.dispatchEvent(new s.win.Event(name,{bubbles:true}));await Promise.resolve();assert.deepEqual(s.calls,[['original-autoplay']]);assert.equal(s.win.location.pathname,'/watch');toggle.click();assert.equal(toggle.getAttribute('aria-checked'),'false');assert.deepEqual(s.calls,[['original-autoplay'],['original-autoplay']]);});
test('a later explicit original On choice revokes an earlier own Off endscreen guard',async t=>{
  const s=setup(t);let cancels=0;s.original.click();s.doc.querySelector('.lf-autoplay-switch').click();assert.equal(s.original.getAttribute('aria-pressed'),'false');
  s.original.click();await Promise.resolve();assert.equal(s.original.getAttribute('aria-pressed'),'true');
  s.win.__langformCancelEndedAutonav=()=>{cancels++;return true;};
  const e=s.doc.createElement('player-endscreen');e.innerHTML='<div class="ytwPlayerEndscreenButtonContainer"><ytm-button-renderer class="ytwPlayerEndscreenActionButton"><button class="ytSpecButtonShapeNextTonal">Abbrechen</button></ytm-button-renderer></div>';s.root.parentElement.appendChild(e);
  s.video.ended=true;s.video.paused=true;s.video.dispatchEvent(new s.win.Event('ended'));await Promise.resolve();assert.equal(cancels,0);
});
test('missing original Autoplay control leaves an honest unavailable toggle and hydrates without a default preference write',async t=>{const s=setup(t,{before:({original})=>original.remove()}),toggle=s.doc.querySelector('.lf-autoplay-switch');assert.equal(toggle.disabled,true);toggle.click();assert.deepEqual(s.calls,[]);s.doc.querySelector('player-autonav-toggle').appendChild(s.original);await Promise.resolve();assert.equal(toggle.disabled,false);assert.equal(toggle.getAttribute('aria-checked'),'false');assert.deepEqual(s.calls,[]);});
test('nested player-container does not hide the original Autoplay sibling in the outer ytm-player owner',t=>{
  const s=setup(t,{before:({root,doc})=>{const container=doc.createElement('div');container.id='player-container-id';root.before(container);container.appendChild(root);}});
  const toggle=s.doc.querySelector('.lf-autoplay-switch');
  assert.equal(toggle.disabled,false,'nearest inner container is not the complete mobile player owner');
  assert.equal(toggle.closest('.lf-player-settings').parentElement,s.doc.querySelector('ytm-player'),'inline layer shares the original control sibling owner');
  toggle.click();assert.equal(s.original.getAttribute('aria-pressed'),'true');assert.deepEqual(s.calls,[['original-autoplay']]);
});
for(const changed of ['route','id','root','video','source','ad','mini','inactive'])test(`stale settings cannot change media after ${changed}`,async t=>{const s=setup(t);s.gear().click();s.setting('speed').click();const b=s.layer().querySelector('[data-speed="2"]');if(changed==='route')s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');if(changed==='id')s.id('zyxwvutsrqp');if(changed==='root')s.root.replaceWith(s.root.cloneNode(true));if(changed==='video')s.video.replaceWith(s.video.cloneNode());if(changed==='source')s.video.src='https://example.test/b';if(changed==='ad')s.root.classList.add('ad-showing');if(changed==='mini')s.win.__langformStageInsets={nativeMini:true};if(changed==='inactive')Object.defineProperty(s.doc,'hidden',{value:true});b.click();await Promise.resolve();assert.equal(s.video.playbackRate,1);assert.deepEqual(s.calls,[]);});
test('wireless playback preserves original route and disables local quality and speed commands',t=>{const s=setup(t);s.video.webkitCurrentPlaybackTargetIsWireless=true;s.gear().click();assert.equal(s.setting('quality').disabled,true);assert.equal(s.setting('speed').disabled,true);assert.deepEqual(s.calls,[]);});
test('fullscreen reuses top gear and toggle; settings dialog blocks zoom and closes before the player transaction',t=>{const s=setup(t),ui=s.loadFullscreen();assert.ok(ui.querySelector('.lf-fs-top .lf-settings-gear'));assert.ok(ui.querySelector('.lf-fs-top .lf-autoplay-switch'));const gear=ui.querySelector('.lf-settings-gear');gear.click();const layer=ui.querySelector('.lf-player-settings-layer');assert.equal(layer.hidden,false);assert.equal(s.win.__langformPlayerSettings.isOpen(),true);ui.querySelector('[data-action=exit]').click();assert.equal(s.win.__langformFullscreen.isOpen(),false);assert.equal(s.win.__langformPlayerSettings.isOpen(),false);assert.equal(s.doc.querySelectorAll('.lf-player-settings-layer').length,1);assert.equal(s.video.currentTime,30);assert.deepEqual(s.calls,[]);});
test('Escape dismisses menu before fullscreen and Tab stays inside visible sheet actions',t=>{const s=setup(t),ui=s.loadFullscreen();ui.querySelector('.lf-settings-gear').click();const sheet=ui.querySelector('.lf-settings-sheet');sheet.dispatchEvent(new s.win.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert.equal(sheet.contains(s.doc.activeElement),true);sheet.dispatchEvent(new s.win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(s.win.__langformFullscreen.isOpen(),true);assert.equal(s.win.__langformPlayerSettings.isOpen(),false);});

test('missing original DOM toggle uses the public live Autonav enum only on explicit user intent and verifies the actual change',t=>{
  let state=2;const commands=[];
  const s=setup(t,{before:({root,original})=>{original.remove();root.getVideoData=()=>({video_id:'abcdefghijk',autonavState:state});root.setAutonavState=(value,user)=>{commands.push([value,user]);state=value;};}});
  const toggle=s.doc.querySelector('.lf-autoplay-switch');assert.equal(toggle.disabled,false);assert.equal(toggle.getAttribute('aria-checked'),'true');assert.deepEqual(commands,[]);
  toggle.click();assert.deepEqual(commands,[[1,true]]);assert.equal(state,1);assert.equal(toggle.getAttribute('aria-checked'),'false');
  toggle.click();assert.deepEqual(commands,[[1,true],[2,true]]);assert.equal(toggle.getAttribute('aria-checked'),'true');assert.equal(s.video.currentTime,30);assert.equal(s.video.paused,true);assert.deepEqual(s.calls,[]);
});
test('original DOM control keeps priority over the public API fallback',t=>{
  const commands=[];const s=setup(t,{before:({root})=>{root.getVideoData=()=>({video_id:'abcdefghijk',autonavState:2});root.setAutonavState=(...args)=>commands.push(args);}});
  s.doc.querySelector('.lf-autoplay-switch').click();assert.deepEqual(s.calls,[['original-autoplay']]);assert.deepEqual(commands,[]);
});
for(const invalid of [null,0,3,4,'1',true,NaN])test(`unknown or transitional public Autonav state ${String(invalid)} never invents a toggle state or preference`,t=>{
  const commands=[];const s=setup(t,{before:({root,original})=>{original.remove();root.getVideoData=()=>({video_id:'abcdefghijk',autonavState:invalid});root.setAutonavState=(...args)=>commands.push(args);}});
  const toggle=s.doc.querySelector('.lf-autoplay-switch');assert.equal(toggle.disabled,true);toggle.click();assert.deepEqual(commands,[]);
});
for(const mode of ['refused','throwing','ad','foreign-id','changed-source','missing-setter'])test(`public Autonav fallback preserves ${mode} ownership and never claims an optimistic preference`,t=>{
  let state=1,ad=false,foreign=false,change=false;const commands=[];
  const s=setup(t,{before:({root,video,original})=>{original.remove();root.getVideoData=()=>{if(change)video.src='https://example.test/replaced';return {video_id:foreign?'zyxwvutsrqp':'abcdefghijk',autonavState:state,isAd:ad};};if(mode!=='missing-setter')root.setAutonavState=(value,user)=>{commands.push([value,user]);if(mode==='throwing')throw Error('not available');if(mode!=='refused')state=value;};}});
  const toggle=s.doc.querySelector('.lf-autoplay-switch');if(mode==='ad')ad=true;if(mode==='foreign-id')foreign=true;if(mode==='changed-source')change=true;
  toggle.click();assert.equal(state,1);assert.equal(toggle.getAttribute('aria-checked'),mode==='missing-setter'?null:'false');assert.equal(s.video.currentTime,30);assert.equal(s.video.paused,true);
  assert.equal(commands.length,mode==='refused'||mode==='throwing'?1:0);
});

test('confirmed explicit Off cancels the exact original countdown even when its endscreen mounts after ended',async t=>{
  let state=2,cancels=0;const s=setup(t,{before:({root,original})=>{original.remove();root.getVideoData=()=>({video_id:'abcdefghijk',autonavState:state});root.setAutonavState=value=>{state=value;};}});
  s.win.__langformCancelEndedAutonav=(id,video,root)=>{assert.equal(id,'abcdefghijk');assert.equal(video,s.video);assert.equal(root,s.root);cancels++;root.parentElement.querySelector('player-endscreen').remove();return true;};
  s.doc.querySelector('.lf-autoplay-switch').click();assert.equal(state,1);
  s.video.ended=true;s.video.paused=true;s.video.dispatchEvent(new s.win.Event('ended'));assert.equal(cancels,0);
  const endscreen=s.doc.createElement('player-endscreen');endscreen.innerHTML='<div class="ytwPlayerEndscreenButtonContainer"><ytm-button-renderer class="ytwPlayerEndscreenActionButton"><button class="ytSpecButtonShapeNextTonal">Abbrechen</button></ytm-button-renderer></div>';s.root.parentElement.appendChild(endscreen);
  await Promise.resolve();await Promise.resolve();assert.equal(cancels,1);assert.equal(s.win.location.pathname,'/watch');assert.equal(s.video.currentTime,30);
});

test('explicit Off executes the actual shipping PlayerRect Cancel contract and stops the original independent countdown',async t=>{
  let state=2,cancels=0,navigations=0;const s=setup(t,{before:({root,original})=>{original.remove();root.getVideoData=()=>({video_id:'abcdefghijk',autonavState:state});root.setAutonavState=value=>{state=value;};}});
  s.win.eval(fs.readFileSync(path.join(directory,'PlayerRect.js'),'utf8'));
  const timer=s.win.setTimeout(()=>navigations++,2000);
  s.doc.querySelector('.lf-autoplay-switch').click();s.video.ended=true;s.video.paused=true;s.video.dispatchEvent(new s.win.Event('ended'));
  const original=s.doc.createElement('div');original.className='player-controls-content';original.innerHTML='<player-endscreen class="ytwPlayerEndscreenHost"><div class="ytwPlayerEndscreenPlayerEndscreen"><div class="ytwPlayerEndscreenButtonContainer"><ytm-button-renderer class="ytwPlayerEndscreenActionButton"><button class="ytSpecButtonShapeNextHost ytSpecButtonShapeNextTonal">Abbrechen</button></ytm-button-renderer></div></div></player-endscreen>';
  original.querySelector('button').addEventListener('click',()=>{cancels++;s.win.clearTimeout(timer);original.remove();});s.root.parentElement.appendChild(original);
  await Promise.resolve();await Promise.resolve();assert.equal(cancels,1);assert.equal(navigations,0);assert.equal(s.video.currentTime,30);assert.equal(s.video.paused,true);assert.equal(s.video.ended,true);
});
test('an explicit Off choice stays effective on a later replay of the same source without an unbounded ended retry',async t=>{
  let state=2,cancels=0,now=1000;const s=setup(t,{before:({root,original,win})=>{original.remove();win.Date.now=()=>now;root.getVideoData=()=>({video_id:'abcdefghijk',autonavState:state});root.setAutonavState=value=>{state=value;};}});
  s.win.__langformCancelEndedAutonav=()=>{cancels++;s.root.parentElement.querySelector('player-endscreen').remove();return true;};
  function mountEnd(){const e=s.doc.createElement('player-endscreen');e.innerHTML='<div class="ytwPlayerEndscreenButtonContainer"><ytm-button-renderer class="ytwPlayerEndscreenActionButton"><button class="ytSpecButtonShapeNextTonal">Abbrechen</button></ytm-button-renderer></div>';s.root.parentElement.appendChild(e);}
  s.doc.querySelector('.lf-autoplay-switch').click();s.video.ended=true;s.video.paused=true;mountEnd();s.video.dispatchEvent(new s.win.Event('ended'));await Promise.resolve();assert.equal(cancels,1);
  now+=20000;s.video.dispatchEvent(new s.win.Event('pause'));s.video.ended=false;s.video.paused=false;s.video.dispatchEvent(new s.win.Event('play'));
  s.video.ended=true;s.video.paused=true;mountEnd();s.video.dispatchEvent(new s.win.Event('ended'));await Promise.resolve();assert.equal(cancels,2);assert.equal(state,1);
});
for(const mode of ['no-choice','source','ad','inactive','on-choice','seeking'])test(`Off countdown enforcement cannot outlive ${mode} ownership`,async t=>{
  let state=2,cancels=0;const s=setup(t,{before:({root,original})=>{original.remove();root.getVideoData=()=>({video_id:'abcdefghijk',autonavState:state});root.setAutonavState=value=>{state=value;};}});
  s.win.__langformCancelEndedAutonav=()=>{cancels++;return true;};const toggle=s.doc.querySelector('.lf-autoplay-switch');
  if(mode!=='no-choice')toggle.click();if(mode==='on-choice')toggle.click();if(mode==='source')s.video.src='https://example.test/new';if(mode==='ad')s.root.classList.add('ad-showing');if(mode==='inactive')Object.defineProperty(s.doc,'hidden',{value:true});if(mode==='seeking')Object.defineProperty(s.video,'seeking',{value:true});
  s.video.ended=true;s.video.paused=true;const endscreen=s.doc.createElement('player-endscreen');endscreen.innerHTML='<div class="ytwPlayerEndscreenButtonContainer"><ytm-button-renderer class="ytwPlayerEndscreenActionButton"><button class="ytSpecButtonShapeNextTonal">Abbrechen</button></ytm-button-renderer></div>';s.root.parentElement.appendChild(endscreen);s.video.dispatchEvent(new s.win.Event('ended'));await Promise.resolve();assert.equal(cancels,0,mode);
});

test('missing projected preference waits for the original control and confirms an explicit enable without API assumptions',async t=>{
  const commands=[];const s=setup(t,{before:({root,original})=>{original.remove();root.getVideoData=()=>({video_id:'abcdefghijk'});root.setAutonavState=(...args)=>commands.push(args);}});
  const toggle=s.doc.querySelector('.lf-autoplay-switch');assert.equal(toggle.disabled,false);assert.equal(toggle.getAttribute('role'),'button');assert.equal(toggle.hasAttribute('aria-checked'),false);assert.equal(toggle.getAttribute('aria-label'),'Autoplay einschalten');assert.deepEqual(commands,[]);
  toggle.click();assert.equal(toggle.getAttribute('aria-label'),'Autoplay wird eingeschaltet');assert.equal(toggle.disabled,true);assert.deepEqual(commands,[]);
  s.doc.querySelector('player-autonav-toggle').appendChild(s.original);await Promise.resolve();await Promise.resolve();
  assert.equal(s.original.getAttribute('aria-pressed'),'true');assert.equal(toggle.getAttribute('aria-label'),'Autoplay an');assert.equal(toggle.getAttribute('role'),'switch');assert.deepEqual(s.calls,[['original-autoplay']]);assert.deepEqual(commands,[]);
  toggle.click();assert.equal(toggle.getAttribute('aria-label'),'Autoplay aus');assert.deepEqual(s.calls,[['original-autoplay'],['original-autoplay']]);assert.equal(s.video.currentTime,30);assert.equal(s.video.paused,true);
});
for(const hostTag of ['ytm-player','ytd-player','div'])test(`deferred Autoplay reveals only the bound original controls in ${hostTag} host`,async t=>{
  let reveals=0,foreignReveals=0;const s=setup(t,{before:({doc,root,original})=>{
    const previous=root.parentElement,owner=doc.createElement(hostTag);if(hostTag==='div')owner.id='player-container-id';
    owner.append(...previous.childNodes);previous.replaceWith(owner);original.remove();
    root.setAutonavState=()=>assert.fail('no unverified API preference');
    const foreign=doc.createElement('button');foreign.id='player-controls-a11y-toggle';foreign.addEventListener('click',()=>foreignReveals++);doc.body.prepend(foreign);
    const reveal=doc.createElement('button');reveal.id='player-controls-a11y-toggle';owner.appendChild(reveal);
    reveal.addEventListener('click',()=>{reveals++;owner.querySelector('player-autonav-toggle').appendChild(original);});
  }});
  const toggle=s.doc.querySelector('.lf-autoplay-switch');assert.equal(toggle.getAttribute('aria-label'),'Autoplay einschalten');
  toggle.click();await Promise.resolve();await Promise.resolve();
  assert.equal(reveals,1,'explicit enable reaches the original reveal sibling in its bound player host');assert.equal(foreignReveals,0);
  assert.equal(s.original.getAttribute('aria-pressed'),'true');assert.equal(toggle.getAttribute('aria-label'),'Autoplay an');assert.equal(toggle.disabled,false);
  assert.deepEqual(s.calls,[['original-autoplay']]);assert.equal(s.video.currentTime,30);assert.equal(s.video.paused,true);
});
function originalWatchResponse(id='abcdefghijk',capable=false){return {currentVideoEndpoint:{watchEndpoint:{videoId:id}},contents:{singleColumnWatchNextResults:{results:{results:{contents:[]}}}},playerOverlays:{playerOverlayRenderer:capable?{autonavToggle:{autoplaySwitchButtonRenderer:{enabled:false}}}:{videoDetails:{}}}};}
test('complete current original response without Autoplay does not promise an unavailable Enable action',async t=>{
  let response=originalWatchResponse(),reveals=0;const s=setup(t,{before:({root,original,doc})=>{
    original.remove();root.setAutonavState=()=>assert.fail('no invented preference');root.getWatchNextResponse=()=>response;
    const b=doc.createElement('button');b.id='player-controls-a11y-toggle';b.addEventListener('click',()=>reveals++);root.parentElement.appendChild(b);
  }});
  const toggle=s.doc.querySelector('.lf-autoplay-switch');assert.equal(toggle.getAttribute('aria-label'),'Autoplay aktuell nicht verfügbar');assert.equal(toggle.disabled,true);assert.equal(toggle.getAttribute('role'),'button');assert.equal(toggle.hasAttribute('aria-checked'),false);toggle.click();assert.equal(reveals,0);assert.deepEqual(s.calls,[]);
  response=originalWatchResponse('abcdefghijk',true);s.win.dispatchEvent(new s.win.Event('video-data-change'));
  assert.equal(toggle.disabled,false);assert.equal(toggle.getAttribute('aria-label'),'Autoplay einschalten','a new current response can become capable without source reload');
  response=originalWatchResponse();s.doc.querySelector('player-autonav-toggle').appendChild(s.original);await Promise.resolve();
  assert.equal(toggle.getAttribute('aria-label'),'Autoplay aus','actual original control takes precedence over response metadata');assert.equal(toggle.disabled,false);assert.deepEqual(s.calls,[]);
});
test('late complete response without Autoplay retires pending enable and preserves late original recovery',async t=>{
  let response={};const s=setup(t,{before:({root,original})=>{original.remove();root.setAutonavState=()=>assert.fail('no invented preference');root.getWatchNextResponse=()=>response;}}),toggle=s.doc.querySelector('.lf-autoplay-switch');
  toggle.click();assert.equal(toggle.getAttribute('aria-label'),'Autoplay wird eingeschaltet');response=originalWatchResponse();s.win.dispatchEvent(new s.win.Event('video-data-change'));
  assert.equal(toggle.getAttribute('aria-label'),'Autoplay aktuell nicht verfügbar');assert.equal(toggle.disabled,true);assert.equal(toggle.hasAttribute('aria-checked'),false);
  s.doc.querySelector('player-autonav-toggle').appendChild(s.original);await Promise.resolve();assert.equal(toggle.getAttribute('aria-label'),'Autoplay aus');assert.deepEqual(s.calls,[]);
});
for(const kind of ['wrong-id','no-id','partial-results','partial-overlay','overlay-autoplay','next-autoplay','throws'])test(`missing Autoplay remains unknown for ${kind} original response`,t=>{
  const response=originalWatchResponse();if(kind==='wrong-id')response.currentVideoEndpoint.watchEndpoint.videoId='zyxwvutsrqp';if(kind==='no-id')delete response.currentVideoEndpoint;
  if(kind==='partial-results')delete response.contents.singleColumnWatchNextResults.results;if(kind==='partial-overlay')delete response.playerOverlays;
  if(kind==='overlay-autoplay')response.playerOverlays.playerOverlayRenderer.autoplay={};if(kind==='next-autoplay')response.contents.singleColumnWatchNextResults.autoplay={};
  const s=setup(t,{before:({root,original})=>{original.remove();root.setAutonavState=()=>assert.fail('no invented preference');root.getWatchNextResponse=()=>{if(kind==='throws')throw Error('not ready');return response;};}}),toggle=s.doc.querySelector('.lf-autoplay-switch');
  assert.equal(toggle.disabled,false);assert.equal(toggle.getAttribute('aria-label'),'Autoplay einschalten');assert.deepEqual(s.calls,[]);
});
for(const trigger of ['timer','mutation'])test(`unconfirmed Autoplay becomes unavailable after a delayed ${trigger} deadline`,async t=>{
  let now=1000,expire;const s=setup(t,{before:({root,original,win})=>{
    original.remove();root.setAutonavState=()=>assert.fail('no unverified API preference');win.Date.now=()=>now;
    win.setTimeout=(fn,delay)=>{if(delay===8000)expire=fn;return 1;};win.clearTimeout=()=>{};
  }});
  const toggle=s.doc.querySelector('.lf-autoplay-switch');toggle.click();assert.equal(toggle.getAttribute('aria-label'),'Autoplay wird eingeschaltet');
  now=9020;if(trigger==='timer')expire();else{s.root.classList.add('deadline-observation');await Promise.resolve();}
  assert.equal(toggle.getAttribute('aria-label'),'Autoplay aktuell nicht verfügbar');assert.equal(toggle.disabled,true);assert.deepEqual(s.calls,[]);
  // Actual late hydration stays authoritative, but never inherits an expired command.
  s.doc.querySelector('player-autonav-toggle').appendChild(s.original);await Promise.resolve();await Promise.resolve();
  assert.equal(toggle.getAttribute('aria-label'),'Autoplay aus');assert.equal(toggle.disabled,false);assert.equal(s.original.getAttribute('aria-pressed'),'false');assert.deepEqual(s.calls,[]);
});
for(const change of ['source','navigation','ad','inactive','expiry'])test(`deferred original Autoplay enable cannot outlive ${change}`,async t=>{
  let expire;const s=setup(t,{before:({root,original,win})=>{original.remove();root.setAutonavState=()=>assert.fail('no unverified API preference');if(change==='expiry'){win.setTimeout=(fn,delay)=>{if(delay===8000)expire=fn;return 1;};win.clearTimeout=()=>{};}}});
  s.doc.querySelector('.lf-autoplay-switch').click();
  if(change==='source')s.video.src='https://example.test/replaced';if(change==='navigation')s.win.dispatchEvent(new s.win.Event('yt-navigate-start'));if(change==='ad')s.root.classList.add('ad-showing');if(change==='inactive')Object.defineProperty(s.doc,'hidden',{value:true});if(change==='expiry')expire();
  s.doc.querySelector('player-autonav-toggle').appendChild(s.original);await Promise.resolve();await Promise.resolve();
  assert.equal(s.original.getAttribute('aria-pressed'),'false');assert.deepEqual(s.calls,[]);
});

function motionSetup(t,options={}){
  const animations=[],timers=new Map();let serial=0,query;
  const s=setup(t,{before({win}){
    query=new win.EventTarget();query.matches=!!options.reduced;win.matchMedia=()=>query;
    win.setTimeout=fn=>{timers.set(++serial,fn);return serial;};win.clearTimeout=id=>timers.delete(id);
    win.Element.prototype.animate=function(frames,settings){const animation={target:this,frames,settings,canceled:false,cancel(){this.canceled=true;},finish(){if(this.onfinish)this.onfinish();}};animations.push(animation);return animation;};
  }});
  return {...s,animations,query,expire(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}},timers};
}
test('root settings back button is visually hidden as well as excluded from keyboard traversal',t=>{
  const s=setup(t);s.gear().click();const back=s.layer().querySelector('.lf-settings-back');
  assert.equal(back.hidden,true);assert.equal(s.win.getComputedStyle(back).display,'none');
  s.setting('speed').click();assert.equal(back.hidden,false);assert.equal(s.win.getComputedStyle(back).display,'flex');
  back.click();assert.equal(s.win.getComputedStyle(back).display,'none');
});
test('sheet opening and closing animate while semantic dismissal and hit release happen immediately',t=>{
  const s=motionSetup(t);s.gear().click();assert.equal(s.animations.length,2);assert.equal(s.layer().hidden,false);assert.equal(s.layer().inert,false);
  assert.deepEqual(Array.from(s.animations[0].frames,x=>x.transform),['translateY(100%)','none']);
  s.animations[0].finish();assert.equal(s.timers.size,0);
  s.layer().querySelector('.lf-settings-close').click();assert.equal(s.win.__langformPlayerSettings.isOpen(),false);assert.equal(s.layer().inert,true);assert.equal(s.layer().style.pointerEvents,'none');assert.equal(s.layer().hidden,false);
  assert.equal(s.doc.activeElement,s.gear());assert.equal(s.overlays.at(-1)[1],false);assert.deepEqual(s.calls,[]);assert.equal(s.video.currentTime,30);
  const closing=s.animations[2];assert.equal(closing.frames[1].transform,'translateY(100%)');closing.finish();assert.equal(s.layer().hidden,true);assert.equal(s.timers.size,0);
});
test('reopening an interrupted closing sheet cancels old completion and retains the current visual pose',t=>{
  const s=motionSetup(t);s.gear().click();s.animations[0].finish();s.setting('speed').click();s.layer().querySelector('.lf-settings-close').click();
  const closing=s.animations[2],css=s.win.getComputedStyle.bind(s.win);s.win.getComputedStyle=node=>node.classList.contains('lf-settings-sheet')?{transform:'matrix(1, 0, 0, 1, 80)',opacity:'.7'}:css(node);
  s.gear().click();assert.equal(closing.canceled,true);assert.equal(s.animations[4].frames[0].transform,'matrix(1, 0, 0, 1, 80)');
  assert.equal(s.layer().querySelector('h2').textContent,'Wiedergabegeschwindigkeit','interrupted reversal keeps the current submenu height and content');
  closing.finish();assert.equal(s.layer().hidden,false);assert.equal(s.layer().inert,false);assert.equal(s.win.__langformPlayerSettings.isOpen(),true);
  s.animations[4].finish();assert.equal(s.layer().hidden,false);assert.equal(s.timers.size,0);
});
for(const reason of ['source','navigation','pagehide'])test(`closing animation cannot outlive ${reason}`,async t=>{
  const s=motionSetup(t);s.gear().click();s.animations[0].finish();s.layer().querySelector('.lf-settings-close').click();const closing=s.animations[2];
  if(reason==='source'){s.video.src='https://example.test/replaced';s.video.dispatchEvent(new s.win.Event('loadstart'));}
  if(reason==='navigation')s.win.dispatchEvent(new s.win.Event('yt-navigate-start'));
  if(reason==='pagehide')s.win.dispatchEvent(new s.win.Event('pagehide'));
  assert.equal(s.layer().hidden,true);assert.equal(closing.canceled,true);closing.finish();assert.equal(s.layer().hidden,true);assert.equal(s.timers.size,0);assert.deepEqual(s.calls,[]);
});
test('a suspended animation retires on its bounded timer without holding the overlay',t=>{
  const s=motionSetup(t);s.gear().click();s.expire();assert.equal(s.layer().hidden,false);assert.ok(s.animations.every(a=>a.canceled));
  s.layer().querySelector('.lf-settings-close').click();s.expire();assert.equal(s.layer().hidden,true);assert.equal(s.timers.size,0);assert.equal(s.overlays.at(-1)[1],false);
});
test('Reduce Motion skips sheet motion and changing it during close retires the lease',t=>{
  const s=motionSetup(t,{reduced:true});s.gear().click();assert.equal(s.animations.length,0);s.layer().querySelector('.lf-settings-close').click();assert.equal(s.layer().hidden,true);
  s.query.matches=false;s.gear().click();s.animations[0].finish();s.layer().querySelector('.lf-settings-close').click();s.query.matches=true;s.query.dispatchEvent(new s.win.Event('change'));
  assert.equal(s.layer().hidden,true);assert.equal(s.timers.size,0);assert.ok(s.animations.every(a=>a.canceled));
});

test('inline mirror hides only the exact original gear and autoplay while preserving original bindings and layout state',t=>{
  const s=setup(t,{before({root,doc}){const gear=doc.createElement('button');gear.className='icon-button player-settings-icon';gear.setAttribute('aria-label','Einstellungen');root.parentElement.appendChild(gear);const other=doc.createElement('button');other.className='unrelated';other.setAttribute('aria-label','Einstellungen');doc.body.appendChild(other);}});
  const originalGear=s.doc.querySelector('.player-settings-icon'),other=s.doc.querySelector('.unrelated');
  assert.equal(s.win.getComputedStyle(originalGear).visibility,'hidden');assert.equal(s.win.getComputedStyle(s.original).visibility,'hidden');
  assert.equal(originalGear.hidden,false);assert.equal(s.original.hidden,false);assert.equal(s.original.disabled,false);assert.notEqual(s.win.getComputedStyle(other).visibility,'hidden');
  s.doc.querySelector('.lf-autoplay-switch').click();assert.equal(s.original.getAttribute('aria-pressed'),'true');assert.deepEqual(s.calls,[['original-autoplay']]);
  assert.equal(s.gear().getAttribute('data-langform-settings-replaced'),null);assert.equal(s.win.getComputedStyle(s.gear()).visibility,'visible');
});
for(const reason of ['ad','route','source','pagehide','inactive'])test(`original-control replacement restores owner styles on ${reason}`,async t=>{
  const s=setup(t);assert.equal(s.original.hasAttribute('data-langform-settings-replaced'),true);
  if(reason==='ad')s.root.classList.add('ad-showing');
  if(reason==='inactive'){Object.defineProperty(s.doc,'hidden',{value:true});s.doc.dispatchEvent(new s.win.Event('visibilitychange'));}
  if(reason==='route'){s.win.history.replaceState({},'','/');s.win.dispatchEvent(new s.win.Event('yt-navigate-start'));}
  if(reason==='source'){s.root.replaceWith(s.root.cloneNode(true));s.win.dispatchEvent(new s.win.Event('video-data-change'));}
  if(reason==='pagehide')s.win.dispatchEvent(new s.win.Event('pagehide'));
  await Promise.resolve();assert.equal(s.original.hasAttribute('data-langform-settings-replaced'),false);assert.equal(s.original.getAttribute('aria-pressed'),'false');assert.equal(s.original.disabled,false);assert.deepEqual(s.calls,[]);
  if(reason==='ad')assert.equal(s.gear().closest('.lf-player-settings').hidden,true);
});
test('hydrated original controls replace their old visual lease and keep confirmed Autoplay live',async t=>{
  const s=setup(t),newToggle=s.original.cloneNode(true);newToggle.setAttribute('aria-pressed','true');s.original.replaceWith(newToggle);await Promise.resolve();
  assert.equal(s.original.hasAttribute('data-langform-settings-replaced'),false);assert.equal(newToggle.hasAttribute('data-langform-settings-replaced'),true);
  assert.equal(s.doc.querySelector('.lf-autoplay-switch').getAttribute('aria-checked'),'true');assert.deepEqual(s.calls,[]);
  s.win.dispatchEvent(new s.win.Event('pagehide'));assert.equal(newToggle.hasAttribute('data-langform-settings-replaced'),false,'a cloned own marker must not become a persistent author style');
});
test('unavailable or disabled original autoplay is not granted a replacement lease or re-enabled',t=>{
  const s=setup(t,{before({original}){original.disabled=true;original.style.visibility='hidden';}});
  assert.equal(s.original.hasAttribute('data-langform-settings-replaced'),false);assert.equal(s.original.disabled,true);assert.equal(s.original.style.visibility,'hidden');assert.equal(s.doc.querySelector('.lf-autoplay-switch').disabled,true);assert.deepEqual(s.calls,[]);
});

for(const kind of ['pointer','touch'])test(`closing settings ${kind} release cannot click through to the feed at the same contact position`,t=>{
  const s=setup(t),under=s.doc.createElement('a');under.href='/watch?v=zyxwvutsrqp';s.doc.body.appendChild(under);let activated=0;under.addEventListener('click',e=>{e.preventDefault();activated++;});
  s.gear().click();s.setting('captions').click();const choice=s.layer().querySelector('[data-caption="true"]');
  contact(s,choice,kind==='pointer'?'pointerdown':'touchstart',kind);contact(s,choice,kind==='pointer'?'pointerup':'touchend',kind);
  assert.equal(s.caption(),true);assert.equal(s.win.__langformPlayerSettings.isOpen(),false);
  s.win.Date.now=()=>Date.now()+1500;const click=new s.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1,clientX:20,clientY:130});under.dispatchEvent(click);
  assert.equal(activated,0,'the compatibility click must not select a recommendation beneath the dismissed sheet');assert.equal(click.defaultPrevented,true);
});
for(const reason of ['new-contact','elsewhere','expired','keyboard','route'])test(`closed-sheet trailing click guard preserves ${reason} activation`,t=>{
  const s=setup(t),under=s.doc.createElement('button');s.doc.body.appendChild(under);let activated=0,now=1000;s.win.Date.now=()=>now;under.addEventListener('click',()=>activated++);
  s.gear().click();const close=s.layer().querySelector('.lf-settings-close');contact(s,close,'pointerdown');contact(s,close,'pointerup');
  if(reason==='new-contact'){contact(s,under,'pointerdown');contact(s,under,'pointerup');}
  if(reason==='expired')now+=2800;
  if(reason==='route')s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');
  under.dispatchEvent(new s.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:reason==='keyboard'?0:1,clientX:reason==='elsewhere'?150:20,clientY:130}));
  assert.equal(activated,1);
});
for(const available of [true,false])test(`original caption control is replaced only when own caption capability is ${available}`,t=>{
  const s=setup(t,{before({root,doc}){const cc=doc.createElement('yt-closed-captions-toggle-button');cc.innerHTML='<ytm-closed-captioning-button><button class="ytmClosedCaptioningButtonButton" aria-pressed="false"></button></ytm-closed-captioning-button>';root.parentElement.appendChild(cc);const unrelated=doc.createElement('button');unrelated.className='ytmClosedCaptioningButtonButton';doc.body.appendChild(unrelated);if(!available)root.getOptions=()=>[];}});
  const cc=s.doc.querySelector('yt-closed-captions-toggle-button button'),unrelated=s.doc.body.lastElementChild;
  assert.equal(cc.hasAttribute('data-langform-settings-replaced'),available);assert.equal(cc.getAttribute('aria-pressed'),'false');assert.equal(cc.disabled,false);assert.equal(unrelated.hasAttribute('data-langform-settings-replaced'),false);
  s.win.dispatchEvent(new s.win.Event('pagehide'));assert.equal(cc.hasAttribute('data-langform-settings-replaced'),false);
});

function captionLayoutSetup(t,{fullscreen=false,scale=1,rotated=false,tooLarge=false}={}){
  const s=setup(t),doc=s.doc,bounds=fullscreen?{x:0,y:0,width:852,height:393}:{x:0,y:107,width:393,height:221.1};
  const rect=b=>({...b,left:b.x,top:b.y,right:b.x+b.width,bottom:b.y+b.height});
  s.root.getBoundingClientRect=()=>rect(bounds);
  const container=doc.createElement('div');container.className='ytp-caption-window-container';s.root.appendChild(container);
  const caption=doc.createElement('div');caption.className='caption-window ytp-caption-window-bottom';caption.textContent='A deliberately long caption\nwith a second readable line';caption.style.cssText='bottom:2%;left:50%;font-size:18px';container.appendChild(caption);
  container.getBoundingClientRect=()=>rect(bounds);Object.defineProperties(container,{offsetWidth:{get:()=>bounds.width/scale},offsetHeight:{get:()=>bounds.height/scale}});
  if(scale!==1)container.style.transform=`matrix(${scale},0,0,${scale},0,0)`;if(rotated)container.style.transform='matrix(0,1,-1,0,0,0)';
  const original=fullscreen?{x:205,y:296,width:410,height:61}:{x:66.5,y:255.7,width:tooLarge?390:228,height:tooLarge?219:52};
  caption.getBoundingClientRect=()=>{const v=(caption.style.translate||'0 0').split(' ').map(parseFloat);return rect({...original,x:original.x+(v[0]||0)*scale,y:original.y+(v[1]||0)*scale});};
  let owner=s.root.parentElement;const controls=[];
  if(fullscreen){owner=doc.createElement('div');owner.id='langform-fullscreen-ui';doc.body.appendChild(owner);s.root.setAttribute('data-langform-fullscreen-player','');}
  const layouts=fullscreen?[['lf-fs-title',79,8,550,44],['lf-fs-time',79,275,694,44],['lf-fs-range-wrap',79,319,694,44],['lf-fs-chapters',79,231,694,44]]:[['player-controls-bottom',12,254.1,303,44],['player-controls-middle',86.5,189.5,220,56]];
  for(const [cls,x,y,width,height] of layouts){const n=doc.createElement('div');n.className=cls;n.getBoundingClientRect=()=>rect({x,y,width,height});owner.appendChild(n);controls.push(n);}
  if(fullscreen){const center=doc.createElement('div');center.className='lf-fs-center';const b=doc.createElement('button');b.getBoundingClientRect=()=>rect({x:390,y:164.5,width:64,height:64});center.appendChild(b);owner.appendChild(center);controls.push(b);}else{const wrap=s.gear().parentElement;wrap.getBoundingClientRect=()=>rect({x:285,y:113,width:100,height:44});controls.push(wrap);}
  const update=()=>s.win.__langformPlayerSettings.refreshCaptions?s.win.__langformPlayerSettings.refreshCaptions():s.win.dispatchEvent(new s.win.Event('video-data-change'));
  return {...s,caption,container,controls,bounds,original,update,rect,setScale(value){scale=value;container.style.transform=`matrix(${scale},0,0,${scale},0,0)`;},clear(){controls.forEach(n=>n.style.visibility='hidden');update();},overlaps(){const a=caption.getBoundingClientRect();return controls.some(n=>{const b=n.getBoundingClientRect();return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;});}};
}
for(const fullscreen of [false,true])test(`caption avoids actual ${fullscreen?'fullscreen':'inline'} lower and center controls without altering authored text style`,t=>{
  const s=captionLayoutSetup(t,{fullscreen});assert.equal(s.overlaps(),true);s.update();assert.equal(s.overlaps(),false);
  const first=s.caption.style.translate;s.update();assert.equal(s.caption.style.translate,first,'repeated measurement must not accumulate displacement');
  const r=s.caption.getBoundingClientRect();assert.ok(r.top>=s.bounds.y&&r.bottom<=s.bounds.y+s.bounds.height);assert.equal(s.caption.style.bottom,'2%');assert.equal(s.caption.style.left,'50%');assert.equal(s.caption.style.fontSize,'18px');
  s.clear();assert.equal(s.caption.style.translate,'');assert.equal(s.caption.getBoundingClientRect().top,s.original.y);
});
for(const end of ['ad','pagehide','route','author'])test(`caption placement releases safely for ${end}`,t=>{
  const s=captionLayoutSetup(t);s.update();assert.notEqual(s.caption.style.translate,'');
  if(end==='ad')s.root.classList.add('ad-showing');if(end==='pagehide')s.win.dispatchEvent(new s.win.Event('pagehide'));if(end==='route')s.win.history.replaceState({},'','/');if(end==='author')s.caption.style.setProperty('translate','7px 9px');s.update();
  assert.equal(s.caption.style.translate,end==='author'?'7px 9px':'');assert.equal(s.caption.style.bottom,'2%');assert.equal(s.caption.style.fontSize,'18px');
});
test('caption viewport displacement is converted through an axis-aligned scaled parent',t=>{const s=captionLayoutSetup(t,{scale:2});s.update();assert.equal(s.overlaps(),false);s.clear();assert.equal(s.caption.style.translate,'');});
for(const variant of ['rotated','tooLarge'])test(`caption leaves ${variant} author geometry intact when safe placement is unavailable`,t=>{const s=captionLayoutSetup(t,{[variant]:true}),text=s.caption.textContent;s.update();assert.equal(s.caption.style.translate,'');assert.equal(s.caption.textContent,text);assert.equal(s.caption.style.fontSize,'18px');});

test('caption remeasures its own displacement after an ancestor scale change without losing the original anchor',t=>{const s=captionLayoutSetup(t);s.update();for(const scale of [2,.75,1.0002828,1]){s.setScale(scale);s.update();assert.equal(s.overlaps(),false);const first=s.caption.style.translate;for(let i=0;i<30;i++)s.update();assert.equal(s.caption.style.translate,first);}s.clear();assert.equal(s.caption.getBoundingClientRect().top,s.original.y);});
for(const property of ['rotate','scale'])test(`caption preserves unsupported individual CSS ${property}`,t=>{const s=captionLayoutSetup(t);s.container.style[property]=property==='rotate'?'20deg':'2';s.update();assert.equal(s.caption.style.translate,'');});
test('caption refresh reads no player or control geometry when captions are absent',t=>{const s=setup(t);s.root.getBoundingClientRect=()=>assert.fail('no caption geometry work without caption windows');s.gear().getBoundingClientRect=()=>assert.fail('no control geometry work');s.win.__langformPlayerSettings.refreshCaptions();});

test('only a real fullscreen caption/status collision leases the side status position and releases with the badge',t=>{const s=captionLayoutSetup(t,{fullscreen:true});s.update();const ui=s.doc.getElementById('langform-fullscreen-ui'),badge=s.doc.createElement('div');badge.id='langform-playback-hold';badge.getBoundingClientRect=()=>s.rect({x:400,y:58,width:46,height:31});ui.appendChild(badge);s.update();assert.equal(ui.hasAttribute('data-caption-status-side'),false,'shorter caption is below the status');badge.getBoundingClientRect=()=>s.rect({x:400,y:100,width:46,height:31});s.update();assert.equal(ui.hasAttribute('data-caption-status-side'),true);badge.remove();s.update();assert.equal(ui.hasAttribute('data-caption-status-side'),false);});
test('caption status side lease restores on route cleanup',t=>{const s=captionLayoutSetup(t,{fullscreen:true});s.update();const ui=s.doc.getElementById('langform-fullscreen-ui'),badge=s.doc.createElement('div');badge.id='langform-playback-hold';badge.getBoundingClientRect=()=>s.rect({x:400,y:100,width:46,height:31});ui.appendChild(badge);s.update();assert.equal(ui.hasAttribute('data-caption-status-side'),true);s.win.dispatchEvent(new s.win.Event('pagehide'));assert.equal(ui.hasAttribute('data-caption-status-side'),false);});

test('fullscreen caption reserves controls already at zero opacity when reveal is intended',t=>{const s=captionLayoutSetup(t,{fullscreen:true}),ui=s.doc.getElementById('langform-fullscreen-ui');const group=s.doc.createElement('div');group.className='lf-fs-controls';group.style.opacity='0';ui.appendChild(group);s.controls.forEach(n=>group.appendChild(n.parentElement.classList.contains('lf-fs-center')?n.parentElement:n));s.update();assert.equal(s.overlaps(),false,'caption must reserve upcoming controls before the first visible reveal frame');ui.setAttribute('data-hidden','');s.update();assert.equal(s.caption.style.translate,'','settled hidden controls restore author pose');ui.removeAttribute('data-hidden');s.update();assert.equal(s.overlaps(),false);});
