const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const dir = path.join(__dirname,'../ios/Langform/Langform');
const sponsor = fs.readFileSync(path.join(dir,'SponsorBlock.js'),'utf8');
const hold = fs.readFileSync(path.join(dir,'PlaybackHold.js'),'utf8');

function page(t,script,options={}) {
  const dom = new JSDOM('<div id="movie_player"><video></video><button id="control">Play</button><div id="surface"></div></div>',{url:'https://m.youtube.com/watch?v=abcdefghijk',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const win=dom.window, doc=win.document, root=doc.getElementById('movie_player'), video=root.querySelector('video');
  const state={id:'abcdefghijk',paused:false,ended:false,seeking:false,error:null,readyState:4,duration:100,currentTime:12,currentSrc:'content.mp4',rate:1.25,ad:false,hidden:false};
  const posts=[], seeks=[], rates=[], timers=new Map(); let now=1000,serial=0;
  Object.defineProperty(doc,'hidden',{get:()=>state.hidden});
  for (const key of ['paused','ended','seeking','error','readyState','duration','currentSrc']) Object.defineProperty(video,key,{get:()=>state[key]});
  Object.defineProperty(video,'currentTime',{get:()=>state.currentTime,set:value=>{ seeks.push(value); state.currentTime=value; }});
  Object.defineProperty(video,'playbackRate',{get:()=>state.rate,set:value=>{rates.push(value); state.rate=value;}});
  root.getVideoData=()=>({video_id:state.id,isAd:state.ad});
  root.seekTo=value=>{seeks.push(value); if(!options.ignoreSeek)state.currentTime=value;};
  video.getBoundingClientRect=()=>({left:0,top:0,right:400,bottom:240,width:400,height:240});
  win.Date.now=()=>now;
  win.setTimeout=(fn,delay)=>{const id=++serial; timers.set(id,{fn,at:now+delay});return id;};
  win.clearTimeout=id=>timers.delete(id);
  if(options.pointer)win.PointerEvent=win.MouseEvent;
  win.webkit={messageHandlers:{langformSponsorBlock:{postMessage:value=>posts.push(JSON.parse(JSON.stringify(value)))}}};
  if(options.enabled)win.localStorage.setItem('langform.sponsorblock.enabled','true');
  win.eval(script);
  const surface=doc.getElementById('surface');
  function advance(ms){const until=now+ms;for(;;){const next=[...timers].filter(([,v])=>v.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=until;}
  function pointer(type,target=surface,x=80,y=110,extra={}){const event=new win.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,buttons:type==='pointerdown'||type==='pointermove'?1:0,...extra});Object.defineProperties(event,{pointerId:{value:extra.pointerId??1},isPrimary:{value:extra.isPrimary??true},pointerType:{value:extra.pointerType??'touch'}});target.dispatchEvent(event);return event;}
  function touch(type,target=surface,x=80,y=110,count=1){const event=new win.Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'touches',{value:type==='touchend'||type==='touchcancel'?[]:Array.from({length:count},(_,identifier)=>({identifier,clientX:x,clientY:y}))});target.dispatchEvent(event);return event;}
  function receive(items,status='ok',request=posts.filter(x=>x.kind==='fetch').at(-1)){return win.__langformSponsorBlockReceive({requestID:request.requestID,videoID:request.videoID,status,segments:items});}
  return{win,doc,root,video,state,posts,seeks,rates,timers,surface,advance,pointer,touch,receive,emit:name=>video.dispatchEvent(new win.Event(name,{bubbles:true})),status:()=>JSON.parse(JSON.stringify(win.__langformSponsorBlock.getStatus()))};
}
const segment=(start=10,end=20,extra={})=>({category:'sponsor',actionType:'skip',segment:[start,end],videoDuration:100,UUID:'first',...extra});

test('SponsorBlock bleibt ohne Opt-in still; Aktivierung ist persistent, nur sponsor/skip wird übernommen',t=>{
  const p=page(t,sponsor);assert.equal(p.posts.length,0);assert.equal(p.status().status,'off');
  p.win.__langformSponsorBlock.setEnabled(true);
  assert.equal(p.win.localStorage.getItem('langform.sponsorblock.enabled'),'true');assert.equal(p.posts.length,1);
  assert.deepEqual(Object.keys(p.posts[0]).sort(),['kind','requestID','videoID']);
  p.receive([segment(),segment(30,40,{category:'intro'}),segment(50,60,{actionType:'mute'}),segment(70,60),segment(-1,8),segment(90,110)]);
  assert.equal(p.status().segments,1);assert.equal(p.status().status,'ready');assert.deepEqual(p.seeks,[]);
  p.emit('timeupdate');assert.deepEqual(p.seeks,[20]);assert.equal(p.status().skipped,1);assert.equal(p.status().canUndo,true);
});
test('SponsorBlock undo stellt den tatsächlich übersprungenen Zeitpunkt wieder her und lässt den Sponsor danach laufen',t=>{
  const p=page(t,sponsor,{enabled:true});p.receive([segment()]);p.emit('playing');
  p.state.seeking=true;assert.equal(p.win.__langformSponsorBlock.undo(),true);assert.deepEqual(p.seeks,[20,12]);p.state.seeking=false;
  p.emit('timeupdate');assert.deepEqual(p.seeks,[20,12]);assert.equal(p.status().canUndo,false);
});
test('Undo-no-op und Exception behalten die Rücknahme für einen bewussten echten Retry',t=>{
  for(const mode of ['no-op','exception']){
    const p=page(t,sponsor,{enabled:true});p.receive([segment()]);p.emit('playing');
    p.root.seekTo=value=>{p.seeks.push(value);if(mode==='exception')throw new Error('seek failed');};
    assert.equal(p.win.__langformSponsorBlock.undo(),false,mode);assert.equal(p.state.currentTime,20,mode);assert.equal(p.status().canUndo,true,mode);
    p.advance(4000);p.state.currentTime=21;p.emit('timeupdate');assert.equal(p.status().canUndo,true,mode);assert.deepEqual(p.seeks,[20,12],mode);
    p.root.seekTo=value=>{p.seeks.push(value);p.state.currentTime=value;};
    assert.equal(p.win.__langformSponsorBlock.undo(),true,mode);assert.equal(p.state.currentTime,12,mode);assert.equal(p.status().canUndo,false,mode);
    p.emit('playing');assert.deepEqual(p.seeks,[20,12,12],mode);
  }
});
test('Async Undo bleibt unbestätigt bis zum echten Rücksprung und erlaubt bereits gestartetes langsames Buffering',t=>{
  for(const mode of ['startedAtTarget','slowBuffer']){
    const p=page(t,sponsor,{enabled:true});p.receive([segment()]);p.emit('playing');
    p.root.seekTo=value=>p.seeks.push(value);
    assert.equal(p.win.__langformSponsorBlock.undo(),false);assert.equal(p.status().canUndo,true);
    p.advance(200);p.state.seeking=true;if(mode==='startedAtTarget')p.state.currentTime=12;p.emit('seeking');
    if(mode==='slowBuffer'){p.advance(6000);p.state.currentTime=12;p.emit('timeupdate');assert.equal(p.status().canUndo,true);p.state.seeking=false;p.emit('seeked');}
    assert.equal(p.status().canUndo,false,mode);assert.equal(p.state.currentTime,12,mode);assert.equal(p.status().skipped,1,mode);
    assert.deepEqual(p.seeks,[20,12],mode);
  }
});
test('Wartende Rücknahme ist an genau ihr Medium gebunden und wird bei Sourcewechsel oder Lebenszyklusende verworfen',t=>{
  for(const mode of ['source','root','navigation','disable','pagehide']){
    const p=page(t,sponsor,{enabled:true});p.receive([segment()]);p.emit('playing');p.root.seekTo=value=>p.seeks.push(value);
    assert.equal(p.win.__langformSponsorBlock.undo(),false);assert.equal(p.status().canUndo,true);
    if(mode==='source')p.state.currentSrc='next-content.mp4';
    if(mode==='root'){const next=p.doc.createElement('div');next.id='movie_player';next.getVideoData=()=>({video_id:p.state.id});p.root.replaceWith(next);next.appendChild(p.video);}
    if(mode==='navigation'){p.win.history.pushState({},'','/watch?v=lmnopqrstuv');p.state.id='lmnopqrstuv';p.win.dispatchEvent(new p.win.Event('popstate'));}
    if(mode==='disable')p.win.__langformSponsorBlock.setEnabled(false);
    if(mode==='pagehide')p.win.dispatchEvent(new p.win.Event('pagehide'));
    p.state.currentTime=12;p.emit('seeking');p.emit('seeked');assert.equal(p.status().canUndo,false,mode);
    assert.equal(p.win.__langformSponsorBlock.undo(),false,mode);assert.deepEqual(p.seeks,[20,12],mode);
  }
});
test('Überlappende Sponsorabschnitte werden in einem Sprung übersprungen, ignoriertes seekTo erzeugt keine Schleife',t=>{
  const p=page(t,sponsor,{enabled:true,ignoreSeek:true});p.receive([segment(),segment(18,30,{UUID:'second'})]);
  p.emit('timeupdate');p.emit('playing');p.emit('timeupdate');assert.deepEqual(p.seeks,[30]);assert.equal(p.status().skipped,0);assert.equal(p.status().canUndo,false);
  p.state.seeking=true;p.emit('seeking');p.state.currentTime=30;p.state.seeking=false;p.emit('seeked');assert.equal(p.status().skipped,1);assert.equal(p.status().canUndo,true);
});
test('Ignoriertes Sponsor-Seek wird durch natürliches Abspielen bis zum Segmentende niemals als Skip bestätigt',t=>{
  const p=page(t,sponsor,{enabled:true,ignoreSeek:true});p.receive([segment()]);p.emit('playing');
  assert.deepEqual(p.seeks,[20]);
  for(const time of [13,18,20,21]){p.state.currentTime=time;p.emit('timeupdate');assert.equal(p.status().skipped,0);assert.equal(p.status().canUndo,false);}
  assert.equal(p.win.__langformSponsorBlock.undo(),false);assert.deepEqual(p.seeks,[20]);
});
test('Tatsächlicher verzögerter Seek bestätigt den Positionssprung beim Start oder nach langsamem Buffer',t=>{
  for(const mode of ['startedAtTarget','slowBuffer']){
    const p=page(t,sponsor,{enabled:true,ignoreSeek:true});p.receive([segment()]);p.emit('playing');
    p.advance(200);p.state.seeking=true;if(mode==='startedAtTarget')p.state.currentTime=20;p.emit('seeking');
    if(mode==='slowBuffer'){assert.equal(p.status().canUndo,false);p.advance(6000);p.state.currentTime=20;p.emit('timeupdate');assert.equal(p.status().canUndo,false);p.state.seeking=false;p.emit('seeked');}
    assert.equal(p.status().skipped,1,mode);assert.equal(p.status().canUndo,true,mode);
    p.root.seekTo=value=>{p.seeks.push(value);p.state.currentTime=value;};
    assert.equal(p.win.__langformSponsorBlock.undo(),true,mode);assert.deepEqual(p.seeks,[20,12],mode);
  }
});
test('Verspäteter, fremder oder zum anderen Ziel führender Seek bestätigt keinen wartenden Sponsor-Sprung',t=>{
  for(const mode of ['lateStart','lateFinish','source','destination','missingStart']){
    const p=page(t,sponsor,{enabled:true,ignoreSeek:true});p.receive([segment()]);p.emit('playing');
    if(mode==='lateStart')p.advance(3001);
    if(mode!=='missingStart'){p.state.seeking=true;p.emit('seeking');}
    if(mode==='lateFinish')p.advance(30001);
    if(mode==='source')p.state.currentSrc='other-content.mp4';
    p.state.currentTime=mode==='destination'?50:20;p.state.seeking=false;p.emit('seeked');p.emit('timeupdate');
    assert.equal(p.status().skipped,0,mode);assert.equal(p.status().canUndo,false,mode);
  }
});
test('Undo unterdrückt auch vollständig enthaltene Sponsorsegmente',t=>{
  const p=page(t,sponsor,{enabled:true});p.state.currentTime=11.5;p.receive([segment(),segment(11,12,{UUID:'nested'})]);p.emit('timeupdate');
  assert.deepEqual(p.seeks,[20]);assert.equal(p.win.__langformSponsorBlock.undo(),true);p.emit('timeupdate');assert.deepEqual(p.seeks,[20,11.5]);
});
test('Ads, falsche Video-ID, Preview, Pause, Scrub, Hintergrund, Remote und abweichende Dauer werden nie übersprungen',t=>{
  for(const mode of ['ad','classAd','identity','pause','seek','hidden','remote','duration','preview']){
    const p=page(t,sponsor,{enabled:true});p.receive([segment()]);
    if(mode==='ad')p.state.ad=true;if(mode==='classAd')p.root.classList.add('ad-showing');if(mode==='identity')p.state.id='lmnopqrstuv';
    if(mode==='pause')p.state.paused=true;if(mode==='seek')p.state.seeking=true;if(mode==='hidden')p.state.hidden=true;
    if(mode==='remote')p.video.webkitCurrentPlaybackTargetIsWireless=true;if(mode==='duration')p.state.duration=120;
    if(mode==='preview')p.doc.body.appendChild(p.doc.createElement('video')).dispatchEvent(new p.win.Event('timeupdate',{bubbles:true}));else p.emit('timeupdate');
    assert.deepEqual(p.seeks,[],mode);
  }
});
test('Navigation A→B→A, Disable und Pagehide verwerfen alte Sponsorantworten',t=>{
  const p=page(t,sponsor,{enabled:true});const first=p.posts[0];
  p.doc.dispatchEvent(new p.win.Event('yt-navigate-start',{bubbles:true}));p.win.history.pushState({},'','/watch?v=lmnopqrstuv');p.state.id='lmnopqrstuv';p.win.dispatchEvent(new p.win.Event('yt-navigate-finish'));
  const second=p.posts.filter(x=>x.kind==='fetch').at(-1);assert.equal(p.receive([segment()],'ok',first),false);
  p.win.history.pushState({},'','/watch?v=abcdefghijk');p.state.id='abcdefghijk';p.win.dispatchEvent(new p.win.Event('yt-navigate-finish'));
  const third=p.posts.filter(x=>x.kind==='fetch').at(-1);assert.equal(p.receive([segment()],'ok',first),false);assert.equal(p.receive([segment()],'ok',second),false);
  p.win.__langformSponsorBlock.setEnabled(false);assert.equal(p.receive([segment()],'ok',third),false);p.emit('timeupdate');assert.deepEqual(p.seeks,[]);
  p.win.__langformSponsorBlock.setEnabled(true);const fourth=p.posts.filter(x=>x.kind==='fetch').at(-1);p.win.dispatchEvent(new p.win.Event('pagehide'));assert.equal(p.receive([segment()],'ok',fourth),false);
});
test('404 ist kein Fehler; Timeout beendet den Request; Retry lädt neu, Cache verhindert identische Abrufe',t=>{
  const p=page(t,sponsor,{enabled:true});p.receive([],'empty');assert.equal(p.status().status,'empty');
  p.win.dispatchEvent(new p.win.Event('yt-navigate-finish'));assert.equal(p.posts.filter(x=>x.kind==='fetch').length,1);
  p.win.__langformSponsorBlock.retry();p.advance(10001);assert.equal(p.status().status,'unavailable');assert.equal(p.timers.size,0);
  p.win.__langformSponsorBlock.retry();p.receive([segment()]);assert.equal(p.status().status,'ready');
});
test('Gedrückthalten links und rechts setzt2× nach350ms und kehrt beim echten Loslassen zu1× zurück',t=>{
  for(const x of [80,320]){const p=page(t,hold,{pointer:true});p.pointer('pointerdown',p.surface,x);p.advance(349);assert.deepEqual(p.rates,[]);p.advance(1);assert.equal(p.state.rate,2);assert.equal(p.win.__langformPlaybackHold.isActive(),true);assert.ok(p.doc.getElementById('langform-playback-hold'));p.pointer('pointerup',p.surface,x);assert.deepEqual(p.rates,[2,1]);assert.equal(p.doc.getElementById('langform-playback-hold'),null);const click=p.pointer('click',p.surface,x);assert.equal(click.defaultPrevented,true);}
});
test('Nutzerwunsch: echter Release nach langem Hold kehrt zu1× zurück; ein Abbruch bewahrt vorherige Tempoabsicht',t=>{
  for(const end of ['pointerup','pointercancel']){
    const p=page(t,hold,{pointer:true});p.state.rate=1.5;p.pointer('pointerdown');p.advance(350);
    for(let i=0;i<12;i++){p.advance(250);p.pointer('pointermove',p.surface,80+(i%2),110);assert.equal(p.state.rate,2,'durchgehender Fingerkontakt bleibt2×');assert.equal(p.win.__langformPlaybackHold.isActive(),true);}
    p.pointer(end);assert.equal(p.state.rate,end==='pointerup'?1:1.5,end);assert.equal(p.win.__langformPlaybackHold.isActive(),false);
  }
});
test('Holdseiten und sichtbare 2×-Anzeige verwenden bei vergrößertem Video den aktuellen Medienviewport',t=>{
  for(const x of [80,320]){
    const p=page(t,hold,{pointer:true}), received=[];
    p.video.getBoundingClientRect=()=>({left:-1400,top:-840,right:1800,bottom:1080,width:3200,height:1920});
    p.win.__langformPlaybackZoom={getLayoutRect:video=>{
      received.push(video);return {left:0,top:0,width:400,height:240};
    }};
    p.pointer('pointerdown',p.surface,x);p.advance(350);
    assert.equal(p.state.rate,2,'die sichtbare Seite bleibt beim Zoom eine Holdseite');
    const badge=p.doc.getElementById('langform-playback-hold');assert.ok(badge);
    assert.equal(badge.style.left,'200px');assert.equal(badge.style.top,'12px');
    assert.ok(received.every(video=>video===p.video));
    p.pointer('pointerup',p.surface,x);assert.equal(p.state.rate,1);
    assert.equal(p.doc.getElementById('langform-playback-hold'),null);
  }
});
test('ungültiger oder bereits freigegebener Zoomowner fällt für Holdzulassung und Anzeige auf normale Geometrie zurück',t=>{
  const hooks=[undefined,{}, {getLayoutRect:()=>null},{getLayoutRect(){throw new Error('stale zoom');}},
    {getLayoutRect:()=>({left:NaN,top:0,width:400,height:240})},
    {getLayoutRect:()=>({left:0,top:0,width:Infinity,height:240})},
    {getLayoutRect:()=>({left:0,top:0,width:0,height:240})}];
  for(const hook of hooks){
    const p=page(t,hold,{pointer:true});p.win.__langformPlaybackZoom=hook;
    p.pointer('pointerdown');p.advance(350);assert.equal(p.state.rate,2);
    assert.equal(p.doc.getElementById('langform-playback-hold').style.top,'12px');
    p.pointer('pointerup');assert.equal(p.state.rate,1);
    p.state.ad=true;p.pointer('pointerdown');p.advance(350);assert.equal(p.state.rate,1,'Geometrie hebt Adguard nicht auf');
  }
});
test('Kurze Taps, Mitte, Controls, Scrubber und obere Zeile behalten ihre Aktionen',t=>{
  const p=page(t,hold,{pointer:true});p.pointer('pointerdown');p.advance(180);p.pointer('pointerup');assert.equal(p.pointer('click').defaultPrevented,false);
  for(const [target,x,y] of [[p.surface,200,110],[p.doc.getElementById('control'),80,110],[p.surface,80,220],[p.surface,80,20]]){p.pointer('pointerdown',target,x,y);p.advance(500);p.pointer('pointerup',target,x,y);assert.deepEqual(p.rates,[]);}
});
test('Bereits der zugelassene Kontakt schützt vor nativer Auswahl, bevor die 350-ms-Tempoaktion beginnt',t=>{
  for(const pointer of [true,false])for(const mode of ['root','sibling','fullscreen']){
    const p=page(t,hold,{pointer});let target=p.surface,owner=p.root;
    if(mode==='sibling'){
      owner=p.doc.createElement('ytm-player');p.root.replaceWith(owner);owner.appendChild(p.root);
      target=p.doc.createElement('div');owner.appendChild(target);
    }
    if(mode==='fullscreen'){owner=p.doc.createElement('div');owner.id='langform-fullscreen-ui';p.doc.body.appendChild(owner);target=owner;}
    const nearby=p.doc.createElement('span');nearby.innerHTML='<svg><text>10</text></svg>';owner.appendChild(nearby);
    const outside=p.doc.createElement('p');outside.textContent='Copy me';p.doc.body.appendChild(outside);
    const down=pointer?p.pointer('pointerdown',target):p.touch('touchstart',target);
    assert.equal(down.defaultPrevented,false,'kurze Taps behalten ihren Kontakt');
    for(const delay of [0,349]){
      p.advance(delay);
      assert.equal(p.state.rate,1.25,`${pointer}:${mode}:vor Frist kein 2×`);
      assert.equal(p.win.__langformPlaybackHold.isActive(),false);
      assert.equal(owner.hasAttribute('data-langform-playback-held'),true,`${pointer}:${mode}:ab Kontaktbeginn`);
      assert.ok(p.doc.getElementById('langform-playback-hold-selection-style'));
      for(const event of ['selectstart','contextmenu']){
        assert.equal(p.pointer(event,nearby.querySelector('text')).defaultPrevented,true);
        assert.equal(p.pointer(event,outside).defaultPrevented,false);
      }
    }
    p.advance(1);assert.equal(p.state.rate,2);
    if(pointer)p.pointer('pointerup',target);else p.touch('touchend',target);
    assert.equal(p.state.rate,1);assert.equal(owner.hasAttribute('data-langform-playback-held'),false);
    assert.equal(p.doc.getElementById('langform-playback-hold-selection-style'),null);
  }
});
test('Auswahlschutz eines noch wartenden Holds endet auch ohne Tempoänderung bei jedem Abbruch',async t=>{
  for(const mode of ['short','move','cancel','blur','pause','source','root','multitouch','native']){
    const p=page(t,hold,{pointer:true});p.pointer('pointerdown');p.advance(100);
    assert.equal(p.root.hasAttribute('data-langform-playback-held'),true,mode);
    if(mode==='short')p.pointer('pointerup');
    if(mode==='move')p.pointer('pointermove',p.surface,95);
    if(mode==='cancel')p.pointer('pointercancel');
    if(mode==='blur')p.win.dispatchEvent(new p.win.Event('blur'));
    if(mode==='pause'){p.state.paused=true;p.emit('pause');}
    if(mode==='source'){p.state.currentSrc='next-source.mp4';p.emit('loadstart');}
    if(mode==='root'){p.root.remove();await Promise.resolve();}
    if(mode==='multitouch')p.pointer('pointerdown',p.surface,80,110,{pointerId:2,isPrimary:false});
    if(mode==='native')p.win.__langformPlaybackHold.cancel();
    p.advance(500);
    assert.deepEqual(p.rates,[],mode);assert.equal(p.win.__langformPlaybackHold.isActive(),false,mode);
    assert.equal(p.root.hasAttribute('data-langform-playback-held'),false,mode);
    assert.equal(p.doc.querySelector('[data-langform-playback-held]'),null,mode);
    assert.equal(p.doc.getElementById('langform-playback-hold-selection-style'),null,mode);
    if(mode==='short')assert.equal(p.pointer('click').defaultPrevented,false);
  }
});
test('Der aktive Hold sperrt Kontextmenü und Auswahl im aktuellen Root, mweb-Sibling und eigenen Vollbild',t=>{
  for(const mode of ['root','sibling','fullscreen']){
    const p=page(t,hold,{pointer:true});let target=p.surface,owner=p.root;
    if(mode==='sibling'){
      owner=p.doc.createElement('ytm-player');p.root.replaceWith(owner);owner.appendChild(p.root);
      target=p.doc.createElement('div');target.className='player-controls-background';owner.appendChild(target);
    }
    if(mode==='fullscreen'){owner=p.doc.createElement('div');owner.id='langform-fullscreen-ui';p.doc.body.appendChild(owner);target=owner;}
    const textControl=p.doc.createElement('button');textControl.innerHTML='<svg><text>10</text></svg>';owner.appendChild(textControl);
    p.pointer('pointerdown',target);p.advance(350);assert.equal(p.state.rate,2,mode);
    // WebKit can select a nearby control label although the finger started on
    // the empty picture. That selection belongs to the existing held gesture.
    for(const selectionTarget of [target,textControl.querySelector('text')])for(const event of ['contextmenu','selectstart']){
      assert.equal(p.pointer(event,selectionTarget).defaultPrevented,true,`${mode}:${event}`);
    }
    assert.equal(owner.hasAttribute('data-langform-playback-held'),true,mode);
    const style=p.doc.getElementById('langform-playback-hold-selection-style');assert.ok(style,mode);assert.match(style.textContent,/-webkit-touch-callout:\s*none/);
    p.pointer('pointerup',target);assert.equal(p.state.rate,1,mode);assert.equal(owner.hasAttribute('data-langform-playback-held'),false,mode);
    for(const event of ['contextmenu','selectstart'])assert.equal(p.pointer(event,textControl).defaultPrevented,false,`${mode}:released:${event}`);
  }
});
test('Normales Copy ohne Hold, kurzer Tap, Control-Start und fremde Fläche bleiben erhalten; veralteter Owner sperrt nichts',t=>{
  for(const mode of ['idle','short','control','outside','stale']){
    const p=page(t,hold,{pointer:true}),outside=p.doc.createElement('p');outside.textContent='Copy me';p.doc.body.appendChild(outside);
    if(mode!=='idle')p.pointer('pointerdown',mode==='control'?p.doc.getElementById('control'):p.surface);
    if(mode==='short'){p.advance(100);p.pointer('pointerup');}
    if(['control','outside','stale'].includes(mode))p.advance(350);
    if(mode==='stale')p.state.currentSrc='next-source.mp4';
    const target=mode==='outside'?outside:mode==='control'?p.doc.getElementById('control'):p.surface;
    for(const event of ['contextmenu','selectstart'])assert.equal(p.pointer(event,target).defaultPrevented,false,`${mode}:${event}`);
    if(mode!=='outside')assert.equal(p.root.hasAttribute('data-langform-playback-held'),false,mode);
  }
});
test('Haltgebundener WebKit-Auswahlschutz wird bei Cancel, Lifecycle und Root-Reparent vollständig entfernt',async t=>{
  for(const mode of ['cancel','blur','source','root']){
    const p=page(t,hold,{pointer:true});p.pointer('pointerdown');p.advance(350);
    assert.equal(p.root.hasAttribute('data-langform-playback-held'),true,mode);
    if(mode==='cancel')p.pointer('pointercancel');
    if(mode==='blur')p.win.dispatchEvent(new p.win.Event('blur'));
    if(mode==='source'){p.state.currentSrc='next-source.mp4';p.emit('loadstart');}
    if(mode==='root'){const next=p.doc.createElement('div');next.id='movie_player';next.getVideoData=()=>({video_id:'abcdefghijk'});p.root.replaceWith(next);next.appendChild(p.video);await Promise.resolve();await Promise.resolve();}
    assert.equal(p.root.hasAttribute('data-langform-playback-held'),false,mode);assert.equal(p.doc.querySelector('[data-langform-playback-held]'),null,mode);
    assert.equal(p.doc.getElementById('langform-playback-hold-selection-style'),null,mode);assert.equal(p.state.rate,1.25,mode);
  }
});
test('Bewegung, mehrere Finger, Pointercancel, Appwechsel und Pause beenden den Hold ohne spätes 2×',t=>{
  for(const mode of ['move','cancel','blur','pause','hidden','mini']){const p=page(t,hold,{pointer:true});p.pointer('pointerdown');p.advance(350);if(mode==='move')p.pointer('pointermove',p.surface,95);if(mode==='cancel')p.pointer('pointercancel');if(mode==='blur')p.win.dispatchEvent(new p.win.Event('blur'));if(mode==='pause'){p.state.paused=true;p.emit('pause');}if(mode==='hidden'){p.state.hidden=true;p.doc.dispatchEvent(new p.win.Event('visibilitychange'));}if(mode==='mini'){p.win.__langformStageInsets={nativeMini:true};p.pointer('pointermove');}assert.equal(p.state.rate,1.25,mode);assert.equal(p.win.__langformPlaybackHold.isActive(),false,mode);}
  const p=page(t,hold);p.touch('touchstart');p.advance(100);p.touch('touchstart',p.surface,80,110,2);p.advance(500);assert.deepEqual(p.rates,[]);
});
test('Eine zwischenzeitliche manuelle Tempowahl behält ihre eigene Geschwindigkeit',t=>{
  for(const mode of ['manual','sourceWithOwnRate']){const p=page(t,hold,{pointer:true});p.pointer('pointerdown');p.advance(350);if(mode==='manual'){p.state.rate=1.75;p.emit('ratechange');}if(mode==='sourceWithOwnRate'){p.state.currentSrc='ad-or-new.mp4';p.state.rate=1.5;}p.pointer('pointerup');assert.deepEqual(p.rates,[2],mode);}
});
test('Root-Replacement, Reparent und Detach restaurieren die gehaltene physische Node ohne neue Node zu ändern',async t=>{
  for(const mode of ['root','detach','replacement']){const p=page(t,hold,{pointer:true});p.pointer('pointerdown');p.advance(350);
    const next=p.doc.createElement('div');next.id='movie_player';next.getVideoData=()=>({video_id:'abcdefghijk'});
    let newVideo;
    if(mode==='root'){p.root.replaceWith(next);next.appendChild(p.video);}
    if(mode==='detach')p.video.remove();
    if(mode==='replacement'){newVideo=p.doc.createElement('video');newVideo.playbackRate=1.75;p.video.replaceWith(newVideo);}
    await Promise.resolve();await Promise.resolve();assert.deepEqual(p.rates,[2,1.25],mode);assert.equal(p.win.__langformPlaybackHold.isActive(),false,mode);
    if(newVideo)assert.equal(newVideo.playbackRate,1.75);
  }
});
test('Quelle auf demselben Element erbt die temporäre 2×-Rate nicht',t=>{
  const p=page(t,hold,{pointer:true});p.pointer('pointerdown');p.advance(350);
  p.state.currentSrc='new-video.mp4';p.emit('loadstart');assert.deepEqual(p.rates,[2,1.25]);assert.equal(p.win.__langformPlaybackHold.isActive(),false);
});
test('Bereits geänderte URL/Playerdaten restaurieren das weiterhin gehaltene alte Medium vor Quellenwechsel',t=>{
  const p=page(t,hold,{pointer:true});p.pointer('pointerdown');p.advance(350);
  p.state.id='lmnopqrstuv';p.win.history.pushState({},'','/watch?v=lmnopqrstuv');p.win.dispatchEvent(new p.win.Event('popstate'));
  assert.deepEqual(p.rates,[2,1.25]);p.state.currentSrc='new-video.mp4';p.emit('loadstart');assert.equal(p.state.rate,1.25);
});
test('Touch-Fallback und Fullscreen-Hintergrund halten 2×, echte Fullscreencontrols sind ausgenommen',t=>{
  const p=page(t,hold);p.touch('touchstart');p.advance(350);p.touch('touchend');assert.deepEqual(p.rates,[2,1]);
  const fs=p.doc.createElement('div');fs.id='langform-fullscreen-ui';p.doc.body.appendChild(fs);
  p.touch('touchstart',fs,320);p.advance(350);p.touch('touchcancel',fs,320);assert.deepEqual(p.rates,[2,1,2,1]);
});
test('Shipping-Fullscreen zeigt den 2×-Hinweis auf beiden Seiten; eigene Controls und kurze Taps bleiben erhalten',t=>{
  const p=page(t,hold,{pointer:true});p.win.scrollTo=()=>{};p.win.__langformStageInsets={nativeMini:false};
  p.win.webkit.messageHandlers.langformFullscreen={postMessage:()=>{}};
  p.win.eval(fs.readFileSync(path.join(dir,'WebViewLinks.js'),'utf8'));
  p.win.eval(fs.readFileSync(path.join(dir,'FullscreenMotion.js'),'utf8'));
  const trigger=p.doc.getElementById('control');trigger.className='ytp-fullscreen-button';trigger.click();
  const ui=p.doc.getElementById('langform-fullscreen-ui');assert.ok(ui);assert.equal(p.win.__langformHasOpenOverlay(),false);
  for(const x of [80,320]){
    p.pointer('pointerdown',ui,x);p.advance(350);assert.equal(p.state.rate,2);
    const badge=p.doc.getElementById('langform-playback-hold');assert.equal(badge.parentElement,ui);assert.equal(p.win.getComputedStyle(badge).visibility,'visible');assert.notEqual(p.win.getComputedStyle(badge).opacity,'0');
    const backGlyph=ui.querySelector('[data-action=back] svg');assert.ok(backGlyph);
    for(const target of [ui,backGlyph])for(const event of ['contextmenu','selectstart'])assert.equal(p.pointer(event,target,x).defaultPrevented,true);
    p.pointer('pointerup',ui,x);assert.equal(p.state.rate,1);assert.equal(p.pointer('click',ui,x).defaultPrevented,true);
  }
  const forward=ui.querySelector('[data-action=forward]');p.pointer('pointerdown',forward);p.advance(500);p.pointer('pointerup',forward);forward.click();
  assert.deepEqual(p.rates,[2,1,2,1]);assert.equal(p.state.currentTime,22);
  p.pointer('pointerdown',ui);p.advance(100);p.pointer('pointerup',ui);p.pointer('click',ui);assert.equal(ui.hasAttribute('data-hidden'),true);
  assert.deepEqual(p.rates,[2,1,2,1]);p.win.__langformFullscreen.exit();
});
test('Originales mweb Custom-Control-Sibling gehört zur aktuellen Videofläche, seine Buttons bleiben bedienbar',t=>{
  const p=page(t,hold,{pointer:true});
  const owner=p.doc.createElement('ytm-player');p.root.replaceWith(owner);owner.appendChild(p.root);
  const overlay=p.doc.createElement('ytm-custom-control');overlay.id='player-control-overlay';
  const background=p.doc.createElement('div');background.className='player-controls-background';overlay.appendChild(background);
  const button=p.doc.createElement('button');button.textContent='Play';overlay.appendChild(button);owner.appendChild(overlay);
  p.pointer('pointerdown',background);p.advance(350);assert.equal(p.state.rate,2);p.pointer('pointerup',background);assert.equal(p.state.rate,1);
  p.pointer('pointerdown',button);p.advance(500);p.pointer('pointerup',button);assert.deepEqual(p.rates,[2,1]);
});
test('Ads, native Mini, fremdes Player-Medium, Pause und native Drag nehmen keinen Hold an',t=>{
  for(const mode of ['ad','mini','identity','pause','drag']){const p=page(t,hold,{pointer:true});if(mode==='ad')p.state.ad=true;if(mode==='mini')p.win.__langformStageInsets={nativeMini:true};if(mode==='identity')p.state.id='lmnopqrstuv';if(mode==='pause')p.state.paused=true;if(mode==='drag')p.win.__langformIsNativeDragging=()=>true;p.pointer('pointerdown');p.advance(1000);assert.deepEqual(p.rates,[],mode);}
});
test('Shipping ViewportLayout-Miniwechsel beendet den gehaltenen Zustand ohne weiteres Pointerereignis',async t=>{
  const p=page(t,hold,{pointer:true});p.win.eval(fs.readFileSync(path.join(dir,'ViewportLayout.js'),'utf8'));
  p.pointer('pointerdown');p.advance(350);assert.equal(p.state.rate,2);
  p.win.__langformStageInsets={top:0,bottom:0,left:0,right:0,nativeMini:true};p.win.__langformSetStageInsets(p.win.__langformStageInsets);
  await Promise.resolve();await Promise.resolve();assert.equal(p.state.rate,1.25);assert.equal(p.win.__langformPlaybackHold.isActive(),false);
});
test('Opt-in Holdprobe unterscheidet Admission, Kandidat und konkrete Abbruchursache ohne Guards zu ändern',t=>{
  for(const mode of ['paused','controls','short','move','source','seeking','blur']){
    const p=page(t,hold,{pointer:true}), events=[];
    p.win.__langformPlaybackHoldTrace=value=>events.push(JSON.parse(JSON.stringify(value)));
    if(mode==='paused')p.state.paused=true;
    p.pointer('pointerdown',mode==='controls'?p.doc.getElementById('control'):p.surface);
    if(mode==='short'){p.advance(100);p.pointer('pointerup');}
    if(mode==='move')p.pointer('pointermove',p.surface,95);
    if(mode==='source')p.state.currentSrc='new-source.mp4';
    if(mode==='seeking')p.state.seeking=true;
    if(mode==='blur')p.win.dispatchEvent(new p.win.Event('blur'));
    p.advance(500);
    const reasons={paused:'media-paused',controls:'surface-control-target',short:'release-before-hold:pointerup',move:'movement',source:'timer:source-changed',seeking:'timer:media-seeking',blur:'lifecycle:blur'};
    assert.equal(events.at(-1).reason,reasons[mode],mode);
    assert.equal(events.at(-1).phase,mode==='paused'||mode==='controls'?'rejected':'cancelled',mode);
    assert.deepEqual(p.rates,[],mode);
    if(mode==='source')assert.equal(events.at(-1).sourceChanged,true);
    if(mode==='seeking')assert.equal(events.at(-1).seeking,true);
    for(const event of events)assert.equal(JSON.stringify(event).includes('.mp4'),false,'no media URL in diagnostic state');
  }
});
test('Fehlernder optionaler Holdprobe-Callback beeinträchtigt 2× und Rollback nicht',t=>{
  const p=page(t,hold,{pointer:true});p.win.__langformPlaybackHoldTrace=()=>{throw new Error('probe failure');};
  p.pointer('pointerdown');p.advance(350);assert.equal(p.state.rate,2);p.pointer('pointerup');assert.deepEqual(p.rates,[2,1]);
});

for(const pointerType of ['touch','pen']){
  test(`350-ms-Kandidat überlebt mehrere standardkonforme button=-1-Moves des selben ${pointerType}-Kontakts`,t=>{
    const p=page(t,hold,{pointer:true}), trace=[];p.win.__langformPlaybackHoldTrace=value=>trace.push(value);
    p.pointer('pointerdown',p.surface,80,110,{pointerType,button:0,buttons:1});
    for(let i=0;i<5;i++){p.advance(60);p.pointer('pointermove',p.surface,80+i%2,110,{pointerType,button:-1,buttons:1});assert.deepEqual(p.rates,[]);}
    p.advance(50);assert.equal(p.state.rate,2);assert.equal(p.win.__langformPlaybackHold.isActive(),true);
    p.pointer('pointerup',p.surface,80,110,{pointerType,button:0,buttons:0});
    assert.deepEqual(p.rates,[2,1]);assert.equal(trace.filter(value=>value.phase==='cancelled').length,0);
  });
  test(`aktiver 2×-Hold bleibt über button=-1-Moves aktiv und kehrt nur einmal beim ${pointerType}-Release zu1× zurück`,t=>{
    const p=page(t,hold,{pointer:true});p.pointer('pointerdown',p.surface,80,110,{pointerType,buttons:1});p.advance(350);
    for(let i=0;i<10;i++){p.advance(40);const move=p.pointer('pointermove',p.surface,80+i%2,110,{pointerType,button:-1,buttons:1});assert.equal(p.state.rate,2);assert.equal(move.defaultPrevented,true);}
    p.pointer('pointerup',p.surface,80,110,{pointerType,button:0,buttons:0});p.pointer('pointerup',p.surface,80,110,{pointerType,button:0,buttons:0});p.advance(500);
    assert.deepEqual(p.rates,[2,1]);assert.equal(p.win.__langformPlaybackHold.isActive(),false);
  });
}
for(const phase of ['pending','held']){
  test(`${phase}: button=-1 ist keine Ausnahme für Hover, Nebenbuttons, fremde Pointer oder zu großen Weg`,t=>{
    for(const [name,extra,x] of [['hover',{buttons:0},80],['right-button',{buttons:2},80],['barrel-chord',{buttons:3},80],['eraser',{buttons:32},80],['non-primary',{isPrimary:false},80],['foreign-id',{pointerId:2},80],['changed-type',{pointerType:'mouse'},80],['movement',{},91]]){
      const p=page(t,hold,{pointer:true});p.pointer('pointerdown');if(phase==='held')p.advance(350);
      p.pointer('pointermove',p.surface,x,110,{button:-1,buttons:1,...extra});p.advance(500);
      assert.equal(p.win.__langformPlaybackHold.isActive(),false,name);assert.deepEqual(p.rates,phase==='held'?[2,1.25]:[],name);
      assert.equal(p.doc.getElementById('langform-playback-hold-selection-style'),null,name);
    }
  });
}
test('button=-1-Start, rechte Starttaste und nichtprimärer Kontakt werden weiterhin abgewiesen',t=>{
  for(const extra of [{button:-1,buttons:1},{button:2,buttons:2},{button:0,buttons:1,isPrimary:false}]){
    const p=page(t,hold,{pointer:true});p.pointer('pointerdown',p.surface,80,110,extra);p.advance(500);assert.deepEqual(p.rates,[]);assert.equal(p.win.__langformPlaybackHold.isActive(),false);
  }
});
