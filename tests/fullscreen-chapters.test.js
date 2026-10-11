const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const script = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/FullscreenChapters.js'), 'utf8');
function setup(t, entries = [{start:0,title:'Intro'}, {start:60,title:'Gespräch'}, {start:180,title:'Schluss'}], configure) {
  const dom = new JSDOM('<div id="langform-fullscreen-ui"><div id="host"></div><div id="timeline"><input type="range"></div></div>', {url:'https://m.youtube.com/watch?v=abcdefghijk',runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document, state = {time:0,duration:240,seekable:true,activity:0}, seeks = [];
  const response = {videoDetails:{videoId:'abcdefghijk'}};
  win.ytInitialPlayerResponse = response;
  win.__langformChapterCache = {player:response,fractions:entries};
  doc.documentElement.__langformChapterList = entries;
  doc.documentElement.__langformChapterVideoID = 'abcdefghijk';
  if (configure) configure(win);
  win.eval(script);
  const host = doc.getElementById('host'), markerHost = doc.getElementById('timeline');
  state.readinessChecks=0;
  const ui = win.__langformFullscreenChapters.mount({host,markerHost,videoID:'abcdefghijk',getTime:()=>state.time,getDuration:()=>state.duration,canSeek:()=>{state.readinessChecks++;return state.seekable;},seek:value=>{seeks.push(value);state.time=value;return true;},onActivity:()=>{state.activity++;}});
  const label = () => host.querySelector('.lf-fs-chapter-label'), panel = () => host.querySelector('.lf-fs-chapter-panel');
  return {win,doc,state,seeks,ui,host,markerHost,label,panel,rows:()=>Array.from(host.querySelectorAll('.lf-fs-chapter-row')),markers:()=>markerHost.querySelector('.lf-fs-chapter-markers')};
}
test('Vollbildkapitel zeigen bestehende Namen, Zeiten, Grenzen und das laufende Kapitel', t => {
  const p = setup(t);
  assert.equal(p.label().textContent, 'Intro ›');
  assert.equal(p.label().getAttribute('aria-label'), 'Kapitel: Intro');
  assert.deepEqual(p.rows().map(r=>r.textContent), ['0:00Intro','1:00Gespräch','3:00Schluss']);
  assert.deepEqual(Array.from(p.markers().children).map(n=>n.style.left), ['25%','75%']);
  assert.equal(p.markerHost.hasAttribute('data-lf-fs-segmented'),true);
  p.state.time = 179; p.ui.update();
  assert.equal(p.label().textContent, 'Gespräch ›');
  assert.deepEqual(p.rows().map(r=>r.getAttribute('aria-current')), [null,'true',null]);
  p.state.time = 180; p.ui.update();
  assert.equal(p.label().textContent, 'Schluss ›');
  assert.deepEqual(p.rows().map(r=>r.getAttribute('aria-current')), [null,null,'true']);
  assert.deepEqual(p.seeks, [], 'Statusupdates verändern keine Wiedergabe');
});
test('playback within one chapter leaves its DOM untouched and checks player readiness once for the whole list', t => {
  const entries=Array.from({length:200},(_,index)=>({start:index,title:'Kapitel '+index}));
  const p=setup(t,entries), observer=new p.win.MutationObserver(()=>{});
  observer.observe(p.host,{subtree:true,attributes:true,childList:true,characterData:true});
  observer.observe(p.markerHost,{subtree:true,attributes:true,childList:true});
  p.state.readinessChecks=0;
  for(let i=0;i<12;i++){p.state.time=i/100;p.ui.update();}
  assert.equal(observer.takeRecords().length,0,'no repeated label, row, marker or accessibility mutations');
  assert.equal(p.state.readinessChecks,12,'200 rows share one player validation per event');
  p.state.time=1;p.ui.update();
  assert.equal(p.label().textContent,'Kapitel 1 ›');
  assert.equal(p.rows()[0].hasAttribute('aria-current'),false);
  assert.equal(p.rows()[1].getAttribute('aria-current'),'true');
  p.state.seekable=false;p.ui.update();
  assert.ok(p.rows().every(row=>row.disabled));
  observer.takeRecords();p.ui.update();
  assert.equal(observer.takeRecords().length,0,'an unchanged disabled list stays idle too');
  p.state.seekable=true;p.ui.update();p.label().click();p.rows()[50].click();
  assert.deepEqual(p.seeks,[50],'a later explicit row click still validates and seeks');
  observer.disconnect();
});
test('Kapitelliste öffnet zugänglich und sucht nur nach explizitem gültigem Klick', t => {
  const p = setup(t);
  p.label().click();
  assert.equal(p.ui.isOpen(), true);
  assert.equal(p.label().getAttribute('aria-expanded'), 'true');
  assert.equal(p.label().getAttribute('aria-controls'), p.panel().id);
  assert.equal(p.doc.activeElement.getAttribute('aria-label'), 'Kapitelliste schließen');
  p.rows()[1].querySelector('span:last-child').click();
  assert.deepEqual(p.seeks, [60]);
  assert.equal(p.ui.isOpen(), false);
  assert.equal(p.doc.activeElement, p.label());
  assert.equal(p.rows()[1].getAttribute('aria-current'), 'true');
  assert.ok(p.state.activity >= 2);
  p.label().click();
  const escape = new p.win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});
  p.panel().dispatchEvent(escape);
  assert.equal(escape.defaultPrevented,true);
  assert.equal(p.ui.isOpen(),false);
  assert.deepEqual(p.seeks,[60], 'Liste schließen sucht nicht und schließt kein Vollbild');
});
test('Keine oder ungültige Kapitel erzeugen keine erfundenen Controls oder Marken', t => {
  for (const entries of [[],[{start:0,title:'Einziges'}],[{start:0,title:'A'},{start:0,title:'B'}],[{start:10,title:'A'},{start:5,title:'B'}],[{start:0,title:'A'},{start:NaN,title:'B'}],[{start:0,title:'A'},{start:4,title:''}]]) {
    const p = setup(t,entries);
    assert.equal(p.label().hidden,true);
    assert.equal(p.markers().hidden,true);
    assert.equal(p.rows().length,0);
    p.label().click(); assert.equal(p.ui.isOpen(),false);
    assert.deepEqual(p.seeks,[]);
  }
});
test('Live oder unbekannte Dauer vermeidet ungültige Marken und Kapitel-Seeks', t => {
  const p = setup(t);
  for (const duration of [0,NaN,Infinity]) {
    p.state.duration=duration; p.ui.update();
    assert.equal(p.markers().hidden,true);
    assert.equal(p.markers().childElementCount,0);
    assert.ok(p.rows().every(row=>row.disabled));
    p.label().click(); p.rows()[1].click();
    assert.deepEqual(p.seeks,[]);
  }
  p.state.duration=240; p.state.seekable=false; p.ui.update();
  assert.ok(p.rows().every(row=>row.disabled));
  p.state.seekable=true; p.ui.update();
  assert.ok(p.rows().every(row=>!row.disabled));
});
test('Veraltete Kapitel, Antwort-Hydration und Seitenwechsel können keine fremden Sprünge auslösen', t => {
  const p = setup(t);
  p.label().click(); const oldRow=p.rows()[1];
  p.win.ytInitialPlayerResponse={videoDetails:{videoId:'hydrating-other-video'}};
  oldRow.click();
  assert.deepEqual(p.seeks,[]);
  assert.equal(p.label().hidden,true);
  assert.equal(p.ui.isOpen(),false);
  p.win.ytInitialPlayerResponse.videoDetails.videoId='abcdefghijk';
  p.ui.update(); p.label().click();
  const heldRow=p.rows()[1];
  p.win.history.replaceState({},'', '/watch?v=lmnopqrstuv');
  heldRow.click();
  assert.deepEqual(p.seeks,[]);
  p.win.dispatchEvent(new p.win.Event('state-navigateend'));
  assert.equal(p.host.childElementCount,0);
  assert.equal(p.markers(),null);
  assert.equal(p.ui.isOpen(),false);
});
test('Kapitel verlangen einen eindeutigen Besitzer passend zu Route und Playerantwort', t => {
  const p=setup(t);
  for (const owner of ['',undefined,'lmnopqrstuv']) {
    p.doc.documentElement.__langformChapterVideoID=owner;p.ui.update();
    assert.equal(p.label().hidden,true);
    assert.equal(p.markers().hidden,true);
  }
  p.doc.documentElement.__langformChapterVideoID='abcdefghijk';p.ui.update();
  assert.equal(p.label().textContent,'Intro ›');
  p.win.ytInitialPlayerResponse.videoDetails.videoId='stale';p.ui.update();
  assert.equal(p.label().hidden,true);
  assert.deepEqual(p.seeks,[]);
});
test('Teardown entfernt UI und Eingaben; Bewegung respektiert reduzierte Animation ohne Polling', t => {
  const p=setup(t);
  const style=p.host.querySelector('style').textContent;
  assert.match(script,/duration:open \? 180 : 140/);
  assert.match(style,/min-height:56px/);
  assert.match(style,/max-height:45dvh/);
  assert.match(style,/@media \(prefers-reduced-motion:reduce\).*animation:none; transition:none;/);
  assert.doesNotMatch(script,/requestAnimationFrame|setInterval|setTimeout/);
  p.label().click();const heldLabel=p.label(),heldRow=p.rows()[1];
  p.ui.close();p.ui.close();p.ui.update();
  heldLabel.click();heldRow.click();
  assert.equal(p.host.childElementCount,0);
  assert.equal(p.markerHost.querySelector('input').isConnected,true);
  assert.equal(p.markers(),null);
  assert.deepEqual(p.seeks,[]);
  assert.equal(p.ui.isOpen(),false);
});
function animated(p) {
  const animations=[];
  p.panel().animate=function(frames,timing) {
    let finish;
    const animation={frames,timing,cancelled:false,finished:new Promise(resolve=>{finish=resolve;}),finish:()=>finish(),cancel(){this.cancelled=true;}};
    animations.push(animation);return animation;
  };
  return animations;
}
test('Kapitelmotion kehrt laufendes Schließen um und verwirft veraltete Animationsergebnisse', async t => {
  const p=setup(t), animations=animated(p);
  p.label().click();
  assert.equal(animations[0].timing.duration,180);
  assert.equal(p.panel().hidden,false);
  p.win.getComputedStyle=()=>({opacity:'0.6',transform:'matrix(1, 0, 0, 1, 0, 3)'});
  p.panel().querySelector('button').click();
  assert.equal(animations[0].cancelled,true);
  assert.equal(animations[1].timing.duration,140);
  assert.deepEqual({...animations[1].frames[0]},{opacity:'0.6',transform:'matrix(1, 0, 0, 1, 0, 3)'});
  assert.equal(p.panel().hidden,false,'Ausblendung bleibt bis zum Ende sichtbar');
  assert.equal(p.panel().inert,true,'schließende Liste akzeptiert keine weitere Eingabe');
  p.label().click();
  assert.equal(animations[1].cancelled,true);
  assert.equal(p.panel().inert,false);
  assert.equal(p.ui.isOpen(),true);
  animations[1].finish();animations[0].finish();await Promise.resolve();
  assert.equal(p.panel().hidden,false,'alte Abschlüsse können neu geöffnete Liste nicht ausblenden');
  animations[2].finish();await Promise.resolve();
  assert.equal(p.panel().hidden,false);
  p.panel().querySelector('button').click();
  animations[3].finish();await Promise.resolve();
  assert.equal(p.panel().hidden,true,'nur aktueller Abschluss blendet vollständig aus');
  assert.deepEqual(p.seeks,[]);
});
test('Reduce Motion beendet eine laufende Kapitelanimation sofort und animiert weitere Gesten nicht', t => {
  let preference;
  const p=setup(t,undefined,win=>{
    preference=new win.EventTarget();preference.matches=false;win.matchMedia=()=>preference;
  });
  const animations=animated(p);
  p.label().click();assert.equal(animations.length,1);
  preference.matches=true;preference.dispatchEvent(new p.win.Event('change'));
  assert.equal(animations[0].cancelled,true);
  assert.equal(p.panel().hidden,false);
  p.panel().querySelector('button').click();
  assert.equal(p.panel().hidden,true);
  p.label().click();
  assert.equal(p.panel().hidden,false);
  assert.equal(animations.length,1,'bei reduzierter Bewegung sind beide Richtungen sofort');
});
test('Seitenwechsel während Kapitelmotion bricht ab; späterer Abschluss erzeugt keine UI', async t => {
  const p=setup(t), animations=animated(p);
  p.label().click();
  p.win.history.replaceState({},'', '/watch?v=lmnopqrstuv');
  p.win.dispatchEvent(new p.win.Event('state-navigateend'));
  assert.equal(animations[0].cancelled,true);
  animations[0].finish();await Promise.resolve();
  assert.equal(p.host.childElementCount,0);
  assert.equal(p.markers(),null);
  assert.equal(p.ui.isOpen(),false);
  assert.deepEqual(p.seeks,[]);
});
test('Pointer-Detents wählen nächstes Kapitel bei acht Pixeln und bleiben bis zwölf Pixeln kleben', t => {
  const p=setup(t);
  let result=p.ui.snap(54,240,true);assert.equal(result.value,60);assert.equal(result.entered,true);
  result=p.ui.snap(70,240,true);assert.equal(result.value,60);assert.equal(result.entered,false);
  result=p.ui.snap(73,240,true);assert.equal(result.value,73);assert.equal(result.entered,false);
  result=p.ui.snap(174,240,true);assert.equal(result.value,180);assert.equal(result.entered,true);
  result=p.ui.snap(182,240,true);assert.equal(result.value,180);assert.equal(result.entered,false);
  p.ui.resetSnap();result=p.ui.snap(182,240,true);assert.equal(result.entered,true);
  assert.deepEqual(p.seeks,[],'Detents berechnen nur den Vorschauwert');
});
test('Detents verwenden Pixel statt Sekunden und bleiben bei nahen Kapitelgrenzen stabil', t => {
  const p=setup(t,[{start:0,title:'A'},{start:60,title:'B'},{start:70,title:'C'}]);
  let result=p.ui.snap(66,240,true);assert.equal(result.value,70,'nächster Marker gewinnt');
  result=p.ui.snap(65,240,true);assert.equal(result.value,70,'Mittelpunkt bleibt innerhalb der Hysterese beim aktuellen Marker');
  result=p.ui.snap(57,240,true);assert.equal(result.value,60);assert.equal(result.entered,true);
  p.ui.resetSnap();p.state.duration=120;
  assert.equal(p.ui.snap(56,240,true).value,60,'vier Sekunden entsprechen hier acht Pixeln');
  assert.equal(p.ui.snap(53,240,true).value,53,'sieben Sekunden überschreiten zwölf Pixel');
});
test('Tastatur, unbekannte Maße, Live, Sperren und fremde Kapitel bleiben ohne Detents', t => {
  const p=setup(t);
  assert.equal(p.ui.snap(57,240,false).value,57);
  for(const width of [0,NaN,Infinity]) assert.equal(p.ui.snap(57,width,true).value,57);
  p.state.duration=Infinity;assert.equal(p.ui.snap(57,240,true).value,57);
  p.state.duration=240;p.state.seekable=false;assert.equal(p.ui.snap(57,240,true).value,57);
  p.state.seekable=true;p.doc.documentElement.__langformChapterVideoID='other';assert.equal(p.ui.snap(57,240,true).value,57);
  p.doc.documentElement.__langformChapterVideoID='abcdefghijk';p.ui.close();assert.equal(p.ui.snap(57,240,true).value,57);
  assert.deepEqual(p.seeks,[]);
});
test('Dichte Kapitel wechseln direkt zum vier Pixel entfernten Marker und bleiben um den Mittelpunkt stabil', t => {
  const p=setup(t,[{start:0,title:'A'},{start:60,title:'B'},{start:64,title:'C'}]);
  let result=p.ui.snap(59,240,true);assert.equal(result.value,60);assert.equal(result.entered,true);
  result=p.ui.snap(64,240,true);assert.equal(result.value,64,'Finger auf Nachbarmarker darf nicht am alten Kapitel hängen');assert.equal(result.entered,true);
  result=p.ui.snap(64,240,true);assert.equal(result.entered,false,'gleicher Marker meldet keine zweite Einrastung');
  for(const value of [62,62.2,61.8]) { result=p.ui.snap(value,240,true);assert.equal(result.value,64);assert.equal(result.entered,false,'Mittelpunkt-Jitter bleibt beim aktuellen Marker'); }
  result=p.ui.snap(60,240,true);assert.equal(result.value,60);assert.equal(result.entered,true);
  result=p.ui.snap(62.2,240,true);assert.equal(result.value,60);assert.equal(result.entered,false);
  result=p.ui.snap(62.6,240,true);assert.equal(result.value,64);assert.equal(result.entered,true,'klar näherer Nachbarmarker übernimmt');
  assert.deepEqual(p.seeks,[]);
});

test('opening chapters reveals the current row within its own scroll container without moving the watch page', t => {
  const p = setup(t); p.state.time = 180; p.ui.update();
  p.doc.documentElement.scrollTop = 37;
  Object.defineProperties(p.panel(),{clientHeight:{value:120},scrollHeight:{value:400}});
  p.panel().getBoundingClientRect = () => ({top:100,bottom:220,height:120});
  p.panel().querySelector('header').getBoundingClientRect = () => ({height:44});
  p.rows()[2].getBoundingClientRect = () => ({top:300,bottom:356,height:56});
  p.label().click();
  assert.equal(p.panel().scrollTop,146);
  assert.equal(p.doc.documentElement.scrollTop,37);
  assert.deepEqual(p.seeks,[]);
  assert.equal(p.rows()[2].getAttribute('aria-current'),'true');
});
