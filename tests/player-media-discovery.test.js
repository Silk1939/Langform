const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const source = fs.readFileSync(process.env.LANGFORM_PLAYERRECT_TEST_SOURCE || path.join(__dirname, "../ios/Langform/Langform/PlayerRect.js"), "utf8");

async function setup(t, { observe = true, url = "https://m.youtube.com/watch?v=abcdefghijk" } = {}) {
  const dom = new JSDOM('<!doctype html><div id="movie_player"></div>', { url, runScripts: "outside-only" });
  const win = dom.window, root = win.document.getElementById("movie_player");
  await new Promise(resolve => win.addEventListener("load", resolve, { once: true }));
  t.after(() => { win.dispatchEvent(new win.Event("pagehide")); win.close(); });
  const posts = [], frames = new Map(), timers = new Map(), observers = [];
  let serial = 0, reads = 0, paint;
  win.requestAnimationFrame = callback => { const id = ++serial; frames.set(id, callback); return id; };
  win.cancelAnimationFrame = id => frames.delete(id);
  win.setTimeout = (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; };
  win.clearTimeout = id => timers.delete(id);
  const BaseObserver = win.MutationObserver;
  win.MutationObserver = observe ? class extends BaseObserver {
    constructor(callback) { super(callback); this.connected = false; observers.push(this); this.callback = callback; }
    observe(...args) { this.connected = true; super.observe(...args); }
    disconnect() { this.connected = false; super.disconnect(); }
  } : undefined;
  win.ResizeObserver = class { observe() {} disconnect() {} };
  win.PerformanceObserver = class { constructor(callback) { paint = callback; } observe() {} disconnect() {} };
  root.getVideoData = () => ({ video_id: "abcdefghijk" });
  root.getPlayerState = () => -1;
  win.webkit = { messageHandlers: { langformPlayer: { postMessage: body => posts.push(body) } } };
  win.eval(source);
  return { win, root, posts, frames, timers, observers, reads: () => reads,
    frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); },
    paint() { paint({ getEntries: () => [{ name: "first-contentful-paint" }] }); },
    video(container = root) {
      const video = win.document.createElement("video");
      video.getBoundingClientRect = () => { reads++; return { left: 0, top: 110, width: 402, height: 226 }; };
      container.appendChild(video);
      return video;
    },
  };
}

test("ein nach First Paint eingefügtes unstarted-Hauptvideo meldet sich vor Dokumentende ohne Medienevent", async t => {
  const p = await setup(t);
  p.paint(); p.frame();
  assert.equal(p.posts.at(-1).hasVideo, false);
  p.video(p.win.document.body); // An unrelated feed/preview video is not the player.
  await Promise.resolve();
  assert.equal(p.frames.size, 0);
  const video = p.video();
  await Promise.resolve();
  assert.equal(p.frames.size, 1);
  assert.equal(p.reads(), 0, "DOM discovery does not force layout synchronously");
  p.frame();
  assert.equal(p.posts.at(-1).hasVideo, true);
  assert.equal(p.posts.at(-1).playbackState, "unstarted");
  assert.equal(p.posts.at(-1).y, 110);
  assert.equal(video.paused, true, "discovery never calls Play");
  assert.equal(p.observers.filter(observer => observer.connected).length, 0);
  assert.equal(p.timers.size, 0, "the discovery deadline ends with the first main video");
  for (let i = 0; i < 100; i++) p.root.appendChild(p.win.document.createElement("span"));
  await Promise.resolve();
  assert.equal(p.frames.size, 0, "normal player DOM changes create no permanent observer work");
});

test("DOMContentLoaded entdeckt ein unstarted-Video auch ohne MutationObserver", async t => {
  const p = await setup(t, { observe: false });
  p.video();
  p.win.document.dispatchEvent(new p.win.Event("DOMContentLoaded"));
  p.frame();
  assert.equal(p.posts.at(-1).hasVideo, true);
  assert.equal(p.posts.at(-1).playbackState, "unstarted");
  assert.equal(p.timers.size, 0);
});

test("Discovery endet nach zehn Sekunden und pagehide; BFCache reaktiviert nur das aktuelle Hauptmedium", async t => {
  const p = await setup(t);
  const observer = p.observers.at(-1);
  const [id, deadline] = [...p.timers].find(([, timer]) => timer.delay === 10000);
  p.timers.delete(id); deadline.callback();
  assert.equal(observer.connected, false);
  p.video(); await Promise.resolve();
  assert.equal(p.frames.size, 0, "the bounded observer does not continue after its deadline");
  p.win.dispatchEvent(new p.win.Event("pageshow")); p.frame();
  assert.equal(p.posts.at(-1).hasVideo, true);
  p.win.dispatchEvent(new p.win.Event("pagehide"));
  const before = p.reads(), count = p.posts.length;
  observer.callback([{ addedNodes: [p.root] }]);
  p.win.document.dispatchEvent(new p.win.Event("DOMContentLoaded"));
  assert.equal(p.frames.size, 0);
  assert.equal(p.reads(), before);
  assert.equal(p.posts.length, count);
  assert.equal(p.timers.size, 0);
});

test("Feed-Dokumente erhalten keine Hauptmedia-Discovery", async t => {
  const p = await setup(t, { url: "https://m.youtube.com/" });
  p.video(); await Promise.resolve();
  assert.equal(p.observers.length, 0);
  assert.equal(p.timers.size, 0);
  assert.equal(p.frames.size, 0);
});

test("Zoom meldet den unvergrößerten Medienviewport an den nativen Player und gibt nach Reset die normale Messung frei", async t => {
  const p = await setup(t);
  const video = p.video(), received = [];
  video.getBoundingClientRect = () => ({ left: -201, top: -113, width: 804, height: 452 });
  p.win.__langformPlaybackZoom = {
    getLayoutRect(media) {
      received.push(media);
      return { left: 0, top: 0, width: 402, height: 226 };
    },
  };
  let report = p.win.__langformMeasureVideo();
  assert.equal(received.at(-1), video, "der Hook erhält den tatsächlichen Hauptmedienknoten");
  assert.deepEqual([report.x, report.y, report.width, report.height], [0, 0, 402, 226]);
  p.win.__langformPlaybackZoom.getLayoutRect = () => null;
  video.getBoundingClientRect = () => ({ left: 0, top: 110, width: 402, height: 226 });
  report = p.win.__langformMeasureVideo();
  assert.deepEqual([report.x, report.y, report.width, report.height], [0, 110, 402, 226]);
});

test("fehlende, defekte und nicht endliche Zoomgeometrie verhindern die normale Medienmessung nicht", async t => {
  const p = await setup(t);
  p.video();
  const hooks = [undefined, {}, { getLayoutRect: () => null },
    { getLayoutRect() { throw new Error("stale owner"); } },
    ...[NaN, Infinity, -1, 0, 8, "402"].map(width => ({ getLayoutRect: () => ({ left: 0, top: 0, width, height: 226 }) })),
    { getLayoutRect: () => ({ left: NaN, top: 0, width: 402, height: 226 }) },
    { getLayoutRect: () => ({ left: 0, top: Infinity, width: 402, height: 226 }) },
  ];
  for (const hook of hooks) {
    p.win.__langformPlaybackZoom = hook;
    const report = p.win.__langformMeasureVideo();
    assert.deepEqual([report.x, report.y, report.width, report.height], [0, 110, 402, 226]);
  }
  p.root.replaceChildren();
  p.win.__langformPlaybackZoom = { getLayoutRect() { assert.fail("kein Hook ohne aktuelles Hauptmedium"); } };
  assert.equal(p.win.__langformMeasureVideo().hasVideo, false);
});

test("SPA nach einem leeren Hauptplayer armiert die Discovery neu; ein vorhandenes Video braucht keinen weiteren DOM-Observer", async t => {
  const p = await setup(t);
  p.video(); await Promise.resolve(); p.frame();
  const discovered = p.observers.length;
  p.win.dispatchEvent(new p.win.Event("pageshow")); p.frame();
  assert.equal(p.observers.length, discovered, "a current media node needs only its own ResizeObserver");
  p.root.replaceChildren();
  p.win.dispatchEvent(new p.win.Event("yt-navigate-finish")); p.frame();
  assert.equal(p.posts.at(-1).hasVideo, false);
  assert.equal(p.observers.filter(observer => observer.connected).length, 1);
  p.video(); await Promise.resolve(); p.frame();
  assert.equal(p.posts.at(-1).hasVideo, true);
  assert.equal(p.observers.filter(observer => observer.connected).length, 0);
  assert.equal(p.timers.size, 0);
});

async function endedPage(t) {
  const p=await setup(t),video=p.video();let plays=0;
  const hidden={left:0,top:-568,width:402,height:226},inline={left:50,top:110,width:301,height:226};
  let box=hidden;
  Object.defineProperties(video,{ended:{value:true,writable:true},paused:{value:true,writable:true},readyState:{value:4},videoWidth:{value:640},videoHeight:{value:480},duration:{value:19.014},currentTime:{value:19.014,writable:true}});
  video.getBoundingClientRect=()=>box;
  p.root.getBoundingClientRect=()=>({left:0,top:110,width:402,height:226});
  p.root.playVideo=()=>{plays++;video.ended=false;video.paused=false;video.currentTime=0;box=inline;video.dispatchEvent(new p.win.Event('playing'));};
  return {...p,video,hidden,inline,plays:()=>plays,setBox:value=>{box=value;},measure:()=>p.win.__langformMeasureVideo()};
}
const geometry=report=>[report.x,report.y,report.width,report.height];
test('the real ended offscreen-media geometry reports the visible current endscreen; replay returns to the actual 4:3 media box',async t=>{
  const p=await endedPage(t),report=p.measure();
  assert.deepEqual(geometry(report),[0,110,402,226]);assert.equal(report.playbackState,'ended');assert.equal(report.playing,false);assert.equal(report.mediaReady,true);
  p.video.dispatchEvent(new p.win.Event('ended'));p.frame();assert.deepEqual(geometry(p.posts.at(-1)),[0,110,402,226]);assert.equal(p.plays(),0,'measuring the endscreen never restarts media');
  assert.equal(p.win.__langformPlay('abcdefghijk'),true);assert.equal(p.plays(),1);assert.deepEqual(geometry(p.measure()),[50,110,301,226]);
});
for(const mode of ['mismatchedID','missingID','staleRoute','adData','adDataTruthy','ad-showing','ad-interrupting','documentFullscreen','nativeVideoFullscreen','playerFullscreen','customFullscreen'])test('ended viewport fallback excludes '+mode,async t=>{
  const p=await endedPage(t);
  if(mode==='mismatchedID')p.root.getVideoData=()=>({video_id:'lmnopqrstuv'});
  if(mode==='missingID')p.root.getVideoData=()=>({});
  if(mode==='staleRoute')p.win.history.replaceState({},'', '/watch?v=lmnopqrstuv');
  if(mode==='adData')p.root.getVideoData=()=>({video_id:'abcdefghijk',isAd:true});
  if(mode==='adDataTruthy')p.root.getVideoData=()=>({video_id:'abcdefghijk',isAd:1});
  if(mode==='ad-showing'||mode==='ad-interrupting')p.root.classList.add(mode);
  if(mode==='documentFullscreen')Object.defineProperty(p.win.document,'fullscreenElement',{value:p.root});
  if(mode==='nativeVideoFullscreen')Object.defineProperty(p.video,'webkitDisplayingFullscreen',{value:true});
  if(mode==='playerFullscreen')p.root.isFullscreen=()=>true;
  if(mode==='customFullscreen')p.win.__langformFullscreen={isOpen:()=>true};
  assert.deepEqual(geometry(p.measure()),[0,-568,402,226]);assert.equal(p.plays(),0);
});
for(const mode of ['display','visibility','opacity','ancestor','zero','outside','invalid','throwing'])test('a genuinely hidden or invalid ended root does not create visible geometry ('+mode+')',async t=>{
  const p=await endedPage(t);
  if(mode==='display')p.root.style.display='none';
  if(mode==='visibility')p.root.style.visibility='hidden';
  if(mode==='opacity')p.root.style.opacity='0';
  if(mode==='ancestor')p.win.document.body.style.display='none';
  if(mode==='zero')p.root.getBoundingClientRect=()=>({left:0,top:110,width:0,height:0});
  if(mode==='outside')p.root.getBoundingClientRect=()=>({left:0,top:1000,width:402,height:226});
  if(mode==='invalid')p.root.getBoundingClientRect=()=>({left:NaN,top:110,width:402,height:226});
  if(mode==='throwing')p.root.getBoundingClientRect=()=>{throw Error('detached layout');};
  assert.deepEqual(geometry(p.measure()),[0,-568,402,226]);assert.equal(p.plays(),0);
});
test('ended fallback preserves visible media, paused geometry and a valid owner zoom basis',async t=>{
  const p=await endedPage(t);p.setBox(p.inline);assert.deepEqual(geometry(p.measure()),[50,110,301,226]);
  p.setBox(p.hidden);p.video.ended=false;assert.deepEqual(geometry(p.measure()),[0,-568,402,226]);
  p.video.ended=true;p.win.__langformPlaybackZoom={getLayoutRect:()=>({left:20,top:110,width:360,height:226})};
  assert.deepEqual(geometry(p.measure()),[20,110,360,226]);assert.equal(p.plays(),0);
});
test('opt-in geometry diagnostics observe only a successfully posted full report and keep the real raw media rect separate',async t=>{
  const p=await endedPage(t),seen=[];p.win.__langformPlayerRectDiagnostic=body=>seen.push(body);
  p.measure();assert.equal(seen.length,0,'a read-only native measure is not a posted report');
  p.video.dispatchEvent(new p.win.Event('ended'));p.frame();assert.equal(seen.length,1);
  assert.deepEqual(geometry(seen[0]),[0,110,402,226]);assert.equal(seen[0].playerVideoID,'abcdefghijk');assert.equal(seen[0].playbackState,'ended');
  assert.equal(seen[0].href,p.win.location.href);assert.equal(p.video.getBoundingClientRect().top,-568);
  p.video.dispatchEvent(new p.win.Event('ended'));p.frame();assert.equal(seen.length,1,'unchanged reports remain deduplicated');
});
test('a failing opt-in geometry diagnostic never blocks the production media report',async t=>{
  const p=await endedPage(t);p.win.__langformPlayerRectDiagnostic=()=>{throw Error('diagnostic only');};
  p.video.dispatchEvent(new p.win.Event('ended'));p.frame();assert.deepEqual(geometry(p.posts.at(-1)),[0,110,402,226]);
  assert.equal(p.win.__langformPlay('abcdefghijk'),true);p.frame();assert.deepEqual(geometry(p.posts.at(-1)),[50,110,301,226]);
});

async function posterPage(t) {
  const p=await setup(t),video=p.video();let plays=0,box={left:0,top:-568,width:402,height:226};
  Object.defineProperties(video,{ended:{value:false,writable:true},paused:{value:true,writable:true},readyState:{value:0,writable:true},duration:{value:NaN,writable:true},currentTime:{value:0,writable:true},videoWidth:{value:0,writable:true},videoHeight:{value:0,writable:true}});
  video.getBoundingClientRect=()=>box;
  p.root.getBoundingClientRect=()=>({left:0,top:110,width:402,height:226});
  p.root.playVideo=()=>{plays++;video.paused=false;video.readyState=4;video.duration=19.014;video.videoWidth=320;video.videoHeight=240;box={left:50,top:110,width:301,height:226};video.dispatchEvent(new p.win.Event('playing'));};
  return {...p,video,plays:()=>plays,measure:()=>p.win.__langformMeasureVideo()};
}
test('an actual unstarted offscreen media node reports its visible poster without pretending decoded frames; explicit native Play starts the same owner',async t=>{
  const p=await posterPage(t),report=p.measure();
  assert.deepEqual(geometry(report),[0,110,402,226]);assert.equal(report.playbackState,'unstarted');assert.equal(report.mediaReady,false);assert.equal(report.mediaPresented,false);assert.equal(p.plays(),0);
  p.video.dispatchEvent(new p.win.Event('loadstart'));p.frame();assert.deepEqual(geometry(p.posts.at(-1)),[0,110,402,226]);
  assert.equal(p.win.__langformPlay('abcdefghijk'),true);assert.equal(p.plays(),1);assert.deepEqual(geometry(p.measure()),[50,110,301,226]);assert.equal(p.measure().playbackState,'playing');
});
test('poster fallback never turns a deliberate zero-time pause, decoded stream, ad, stale owner or hidden root into new playable geometry',async t=>{
  for(const mode of ['pauseAtZero','decoded','mismatchedID','ad','hidden','fullscreen']) {
    const p=await posterPage(t);
    if(mode==='pauseAtZero')p.root.getPlayerState=()=>2;
    if(mode==='decoded')p.video.readyState=4;
    if(mode==='mismatchedID')p.root.getVideoData=()=>({video_id:'lmnopqrstuv'});
    if(mode==='ad')p.root.getVideoData=()=>({video_id:'abcdefghijk',isAd:true});
    if(mode==='hidden')p.root.style.display='none';
    if(mode==='fullscreen')p.win.__langformFullscreen={isOpen:()=>true};
    assert.deepEqual(geometry(p.measure()),[0,-568,402,226],mode);assert.equal(p.plays(),0);
  }
});
