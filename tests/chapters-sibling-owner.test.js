const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const chapters = require(process.env.LANGFORM_CHAPTER_SOURCE || '../extension/src/page-captions.js');

function siblingPage(t) {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="player-container-id"><div class="player-api player-size"><div id="movie_player" class="html5-video-player"><video id="v"></video></div></div>
    <div id="player-control-container"><div id="player-control-overlay"><div class="player-controls-bottom" id="row">
    <div class="ytp-time-display" id="time">0:02 / 17:02</div>
    <div id="original" style="visibility:hidden"><div class="ytwPlayerTimeDisplayPlayerBarActionContainer"><button id="native" aria-label="View chapters">Intro</button></div></div>
    <button id="fullscreen" aria-label="Vollbild"></button></div><div class="progress-bar-line" id="bar"></div></div></div></div>
    <button id="unrelated">Andere Fläche</button></body>`, { url: 'https://m.youtube.com/watch?v=abcdefghijk' });
  const win = dom.window, doc = win.document, timers = new Map(), intervals = new Map(); let serial = 0;
  t.after(() => win.close());
  win.setTimeout = (callback, delay) => { timers.set(++serial, { callback, delay }); return serial; };
  win.clearTimeout = id => timers.delete(id);
  win.setInterval = (callback, delay) => { intervals.set(++serial, { callback, delay }); return serial; };
  win.clearInterval = id => intervals.delete(id);
  Object.defineProperty(doc.documentElement, 'clientWidth', { value: 393 });
  function box(id, x, y, width, height) {
    doc.getElementById(id).getBoundingClientRect = () => ({ x, y, left:x, top:y, width, height, right:x+width, bottom:y+height });
  }
  box('player-container-id',0,107,393,221); box('movie_player',0,107,393,221);
  box('time',36,264,142,24); box('native',124.6,264,53.1,24); box('fullscreen',345,254,48,44); box('bar',0,315,393,4);
  const video = doc.getElementById('v'); let source = 'blob:current';
  Object.defineProperty(video, 'paused', { get: () => false }); Object.defineProperty(video, 'ended', { get: () => false });
  Object.defineProperty(video, 'currentSrc', { get: () => source }); video.currentTime = 5;
  video.play = video.pause = () => assert.fail('Kapitelabgleich darf kein Medium steuern');
  win.ytInitialPlayerResponse = { videoDetails: { videoId:'abcdefghijk',lengthSeconds:'1460',shortDescription:'0:00 Intro\n1:23 Gespräch\n12:04 Schluss' }, streamingData:{formats:[{url:'https://example.test/media'}]} };
  chapters.armChapters(win);
  const own = () => doc.getElementById('langform-chapter-chip');
  assert.ok(own()); assert.equal(own().getAttribute('data-langform-chip-placed'),'1');
  function contact(node = doc.getElementById('player-control-overlay')) { node.dispatchEvent(new win.Event('pointerdown',{bubbles:true})); }
  function follow() { return [...intervals.values()].filter(item => item.delay === 350); }
  function tick(count = 1) { for (let n=0;n<count;n++) for (const item of follow()) item.callback(); }
  function reveal() { doc.getElementById('original').style.visibility='visible'; }
  return { win,doc,video,own,contact,follow,tick,reveal,timers,intervals,setSource:value => { source=value; } };
}

function airplayAnchor(p) {
  const gear=p.doc.createElement('button');
  gear.setAttribute('aria-label','Settings');
  gear.getBoundingClientRect=()=>({x:300,y:264,left:300,top:264,width:44,height:44,right:344,bottom:308});
  p.doc.getElementById('movie_player').appendChild(gear);
  p.video.webkitShowPlaybackTargetPicker=()=>{};
  return gear;
}

test('native Kapitelübernahme erhält den gebundenen AirPlay-Follow bis zum späten Controls-Fade', t => {
  const p=siblingPage(t),gear=airplayAnchor(p);
  p.contact(p.video);p.contact();p.tick(3);p.reveal();p.tick();
  assert.equal(p.own(),null);
  const airplay=p.doc.getElementById('langform-airplay');assert.ok(airplay);
  assert.equal(airplay.style.visibility,'');
  p.tick();assert.equal(p.follow().length,1);
  gear.style.opacity='0';p.tick();assert.equal(airplay.style.visibility,'hidden');
  p.tick(11);assert.equal(p.follow().length,0,'die bestehende 16-Tick-Frist bleibt begrenzt');
});

for (const replacement of ['source','player','overlay','chapter']) test('AirPlay-Follow verwirft nach nativer Kapitelübernahme den geänderten '+replacement+'-Owner', t => {
  const p=siblingPage(t),gear=airplayAnchor(p);
  p.contact();p.reveal();p.tick();
  const airplay=p.doc.getElementById('langform-airplay');assert.ok(airplay);
  assert.equal(p.own(),null);p.tick();assert.equal(p.follow().length,1);
  if(replacement==='source')p.setSource('blob:replacement');
  else if(replacement==='chapter')p.doc.documentElement.removeAttribute('data-langform-chapter-ui');
  else {
    const previous=p.doc.getElementById(replacement==='player'?'movie_player':'player-control-overlay');
    previous.replaceWith(previous.cloneNode(true));
  }
  gear.style.opacity='0';p.tick();
  assert.equal(p.follow().length,0);
  assert.equal(airplay.style.visibility,'','der alte Follow schreibt nach Ownerwechsel nicht mehr');
});

test('mobiler Geschwisterkontakt gleicht ein später sichtbares Originalkapitel ab', t => {
  const p=siblingPage(t); const markup=p.video.outerHTML;
  p.contact(); assert.equal(p.follow().length,1); p.reveal(); p.tick();
  assert.equal(p.own(),null); assert.equal(p.doc.documentElement.getAttribute('data-langform-chapter-ui'),'native');
  assert.equal(p.video.outerHTML,markup); assert.equal(p.video.currentTime,5);
});
test('späteres Original-Reveal wird am bestehenden vierten Followtick übernommen', t => {
  const p=siblingPage(t); p.contact(); p.tick(3); assert.ok(p.own()); p.reveal(); p.tick(); assert.equal(p.own(),null);
});
test('wiederholte Geschwisterkontakte verwenden nur einen begrenzten Followtimer', t => {
  const p=siblingPage(t); p.contact(); p.contact(); p.contact(); assert.equal(p.follow().length,1);
  p.tick(17); assert.equal(p.follow().length,0); assert.ok(p.own());
});
test('Kontakt außerhalb des aktuellen Watchowners startet keinen Kapitelabgleich', t => {
  const p=siblingPage(t); p.contact(p.doc.getElementById('unrelated')); p.reveal(); p.tick();
  assert.equal(p.follow().length,0); assert.ok(p.own());
});
test('fremde Playerdaten autorisieren den neuen Geschwisterpfad nicht', t => {
  const p=siblingPage(t); p.win.ytInitialPlayerResponse.videoDetails.videoId='lmnopqrstuv'; p.contact();
  assert.equal(p.follow().length,0); assert.ok(p.own());
});
test('URL-Wechsel verwirft einen gehaltenen Geschwisterabgleich vor native Ownership', t => {
  const p=siblingPage(t); p.contact(); const callback=p.follow()[0].callback;
  p.win.history.replaceState({},'', '/watch?v=lmnopqrstuv'); p.reveal(); callback();
  assert.ok(p.own()); assert.equal(p.follow().length,0);
});
test('Medienquellenwechsel verwirft den bisherigen Geschwisterabgleich', t => {
  const p=siblingPage(t); p.contact(); const callback=p.follow()[0].callback;
  p.setSource('blob:replacement'); p.reveal(); callback(); assert.ok(p.own()); assert.equal(p.follow().length,0);
});
test('ersetzter Playerroot bekommt keinen gehaltenen Geschwisterabgleich', t => {
  const p=siblingPage(t); p.contact(); const callback=p.follow()[0].callback;
  const previous=p.doc.getElementById('movie_player'); previous.replaceWith(previous.cloneNode(true)); p.reveal(); callback();
  assert.ok(p.own()); assert.equal(p.follow().length,0);
});
test('neuer Overlayowner startet eigenen Followtimer und ignoriert den alten Rückruf', t => {
  const p=siblingPage(t); p.contact(); const callback=p.follow()[0].callback;
  const old=p.doc.getElementById('player-control-overlay'), next=p.doc.createElement('div'); next.id=old.id;
  while(old.firstChild) next.appendChild(old.firstChild); old.replaceWith(next);
  p.contact(next); assert.equal(p.follow().length,1); p.reveal(); callback(); assert.ok(p.own());
  p.tick(); assert.equal(p.own(),null);
});
test('Mobile-Navigationsstart räumt auch gehaltene Geschwistercallbacks ab', t => {
  const p=siblingPage(t); p.contact(); const callback=p.follow()[0].callback;
  p.win.dispatchEvent(new p.win.CustomEvent('state-navigatestart',{detail:{href:'/watch?v=lmnopqrstuv'}}));
  assert.equal(p.own(),null); p.reveal(); callback();
  assert.notEqual(p.doc.documentElement.getAttribute('data-langform-chapter-ui'),'native'); assert.equal(p.follow().length,0);
});
test('Kommentar- und Dialogkontakte im Watchowner bleiben ohne neuen Followtimer', t => {
  const p=siblingPage(t), dialog=p.doc.createElement('div'); dialog.setAttribute('role','dialog');
  p.doc.getElementById('player-control-overlay').appendChild(dialog); p.contact(dialog); assert.equal(p.follow().length,0);
});
test('sichtbare fremde Kapitel außerhalb des gebundenen Owners übernehmen dessen Chip nicht', t => {
  const p=siblingPage(t), foreign=p.doc.createElement('button'); foreign.className='ytp-chapter-title'; foreign.textContent='Fremd';
  foreign.getBoundingClientRect=()=>({left:124,top:264,width:53,height:24,right:177,bottom:288}); p.doc.body.insertBefore(foreign,p.doc.body.firstChild);
  p.contact(); p.tick(4); assert.ok(p.own());
});
test('verstecktes Original bleibt versteckt und wird nicht durch Visibilitylockerung freigegeben', t => {
  const p=siblingPage(t); p.contact(); p.tick(4); assert.ok(p.own());
  assert.equal(p.doc.getElementById('original').style.visibility,'hidden');
});
test('native Dragphase verschiebt den Geschwisterabgleich bis zum bisherigen Followtick', t => {
  const p=siblingPage(t); let dragging=true; p.win.__langformIsNativeDragging=()=>dragging;
  p.contact(); p.reveal(); p.tick(3); assert.ok(p.own()); dragging=false; p.tick(); assert.equal(p.own(),null);
});
test('synchroner Quellenwechsel während nativer Geometriemessung verliert keine neue Ownership', t => {
  const p=siblingPage(t); p.contact(); p.reveal();
  p.doc.getElementById('native').getBoundingClientRect=()=>{
    p.setSource('blob:replacement-during-measurement');
    return {left:124,top:264,width:53,height:24,right:177,bottom:288};
  };
  p.tick(); assert.ok(p.own()); assert.notEqual(p.doc.documentElement.getAttribute('data-langform-chapter-ui'),'native');
});
test('Geschwisterkontakt bindet auch einen zuvor ungebundenen Videofollow und entwertet dessen Rückruf', t => {
  const p=siblingPage(t); p.contact(p.video); assert.equal(p.follow().length,1); const oldCallback=p.follow()[0].callback;
  p.contact(); assert.equal(p.follow().length,1); p.reveal(); p.setSource('blob:replacement');
  oldCallback(); assert.ok(p.own()); p.tick(); assert.ok(p.own()); assert.equal(p.follow().length,0);
});
