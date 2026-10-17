const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/WebViewLinks.js"), "utf8");

function setup(t, options = {}) {
  if (typeof options === "string") options = { channels: [options] };
  const dom = new JSDOM(`<ytm-pivot-bar-renderer>
    <ytm-pivot-bar-item-renderer aria-label="Startseite"><span id="home">Startseite</span></ytm-pivot-bar-item-renderer>
    <ytm-pivot-bar-item-renderer><a href="/feed/subscriptions"><span id="subs">Abos</span></a></ytm-pivot-bar-item-renderer>
    <ytm-pivot-bar-item-renderer aria-label="Mein YouTube"><span id="account">Mein YouTube</span></ytm-pivot-bar-item-renderer>
  </ytm-pivot-bar-renderer><a id="channel" href="/@example">Kanal</a>`, {
    url: options.url || "https://m.youtube.com/feed/subscriptions", runScripts: "outside-only", pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const win = dom.window;
  // JSDOM has no layout engine. Model the visibility boundary used when
  // YouTube retains a hidden searchbox alongside the current header.
  win.HTMLElement.prototype.getClientRects = function () {
    for (let node = this; node; node = node.parentElement) {
      const style = win.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return [];
    }
    return [{left:0,top:62,width:160,height:32}];
  };
  const posts = [];
  const messages = [];
  const bodies = [];
  const handlers = {};
  (options.channels || ["langformNavigateFeed"]).forEach(name => {
    handlers[name] = { postMessage(body) {
      if (options.throwBridge && name === "langformNavigateFeed") throw new Error("bridge unavailable");
      posts.push(body.href);
      messages.push({ name, href: body.href });
      bodies.push(JSON.parse(JSON.stringify(body)));
    } };
  });
  win.webkit = { messageHandlers: handlers };
  if (options.beforeScript) options.beforeScript(win);
  let spaClicks = 0;
  const spaSawPrevented = [];
  // The bundled controller installs its document-capture handler first. The
  // native bridge must still win by intercepting one level earlier on window.
  win.document.addEventListener("click", event => {
    spaClicks++;
    spaSawPrevented.push(event.defaultPrevented);
    event.preventDefault();
  }, true);
  win.eval(source);
  return {
    win, posts, messages, bodies, spaSawPrevented, spaClicks: () => spaClicks,
    tap(id, options = {}) {
      const event = new win.MouseEvent("click", { bubbles: true, cancelable: true, composed: true, ...options });
      win.document.getElementById(id).dispatchEvent(event);
      return event;
    },
  };
}

// Match the shipped order: the common WebViewLinks capture handler exists
// before PlayerSettings installs its own contact and click handlers.
function closedPlayerSettings(t, kind = 'pointer') {
  const ctx = setup(t, {url:'https://m.youtube.com/watch?v=abcdefghijk',channels:['langformWatchIntent','langformOpenWatch']});
  const {win}=ctx,doc=win.document;
  doc.body.insertAdjacentHTML('beforeend','<ytm-player><div id="movie_player"><video src="https://example.test/a"></video></div></ytm-player><a id="under-settings" href="/watch?v=lqr_U7cQ3s0">Recommendation</a>');
  const root=doc.getElementById('movie_player'),video=root.querySelector('video');
  let captions=true,now=1000;
  win.Date.now=()=>now;
  root.getVideoData=()=>({video_id:'abcdefghijk'});
  root.getOptions=()=>['track'];root.isSubtitlesOn=()=>captions;
  root.toggleSubtitles=()=>{captions=!captions;};
  Object.defineProperties(video,{readyState:{value:4},duration:{value:200},videoWidth:{value:1920},videoHeight:{value:1080}});
  const contact=(target,type,mode=kind)=>{
    const event=mode==='pointer'?new win.MouseEvent(type,{bubbles:true,cancelable:true,clientX:20,clientY:130}):new win.Event(type,{bubbles:true,cancelable:true});
    if(mode==='pointer')Object.defineProperties(event,{pointerId:{value:3},isPrimary:{value:true}});
    else {const point={identifier:3,clientX:20,clientY:130};Object.defineProperties(event,{touches:{value:type==='touchend'?[]:[point]},changedTouches:{value:[point]}});}
    target.dispatchEvent(event);
  };
  win.eval(fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/PlayerSettings.js'),'utf8'));
  doc.querySelector('.lf-settings-gear').click();
  doc.querySelector('[data-setting="captions"]').click();
  const off=doc.querySelector('[data-caption="false"]');
  contact(off,kind==='pointer'?'pointerdown':'touchstart');
  contact(off,kind==='pointer'?'pointerup':'touchend');
  assert.equal(captions,false);assert.equal(win.__langformPlayerSettings.isOpen(),false);
  assert.equal(ctx.bodies.length,0);
  return {...ctx,contact,advance:ms=>{now+=ms;}};
}

for(const kind of ['pointer','touch'])test(`closed settings ${kind} release cannot reach the earlier native recommendation router`,t=>{
  const ctx=closedPlayerSettings(t,kind);let playerClicks=0;
  ctx.win.__langformHandlePlayerClick=()=>{playerClicks++;return false;};
  ctx.advance(1700);
  const click=ctx.tap('under-settings',{detail:1,clientX:20,clientY:130});
  assert.equal(click.defaultPrevented,true);
  assert.deepEqual(ctx.messages,[],'no native WatchIntent may escape before the later settings capture listener');
  assert.equal(playerClicks,0,'the same release cannot toggle the underlying player controls');
  assert.equal(ctx.spaClicks(),0,'the website recommendation handler must not receive the click either');
});

for(const reason of ['fresh-pointer','fresh-touch','keyboard','elsewhere','expired','route','navigation','pagehide'])test(`settings trailing-click bridge preserves legitimate ${reason} navigation`,t=>{
  const ctx=closedPlayerSettings(t),{win}=ctx,link=win.document.getElementById('under-settings');
  if(reason==='fresh-pointer'){ctx.contact(link,'pointerdown');ctx.contact(link,'pointerup');}
  if(reason==='fresh-touch'){ctx.contact(link,'touchstart','touch');ctx.contact(link,'touchend','touch');}
  if(reason==='expired')ctx.advance(2600);
  if(reason==='route')win.history.replaceState({},'','/watch?v=zyxwvutsrqp');
  if(reason==='navigation')win.dispatchEvent(new win.Event('yt-navigate-start'));
  if(reason==='pagehide')win.dispatchEvent(new win.Event('pagehide'));
  ctx.tap('under-settings',{detail:reason==='keyboard'?0:1,clientX:reason==='elsewhere'?150:20,clientY:130});
  assert.deepEqual(ctx.messages,[{name:'langformWatchIntent',href:'https://m.youtube.com/watch?v=lqr_U7cQ3s0'}]);
  assert.equal(ctx.spaClicks(),0,'the native router retains its existing authority');
});

for(const modifier of ['metaKey','ctrlKey','shiftKey','altKey','button'])test(`settings trailing-click bridge preserves ${modifier} browser handling`,t=>{
  const ctx=closedPlayerSettings(t),before=ctx.spaClicks();
  ctx.tap('under-settings',{detail:1,clientX:20,clientY:130,[modifier]:modifier==='button'?2:true});
  assert.deepEqual(ctx.messages,[]);
  assert.equal(ctx.spaClicks(),before+1,'modified clicks are not claimed by either native bridge');
});

test("native Lupe öffnet UIKit-Suche vor dem originalen Weboverlay", t => {
  const ctx = setup(t, {channels:["langformOpenWatch","langformNativeSearch"]});
  ctx.win.document.body.insertAdjacentHTML('afterbegin','<ytm-header><button class="topbar-button-search-button" id="native-search">Suchen</button></ytm-header>');
  ctx.tap('native-search');
  assert.equal(ctx.spaClicks(),0);
  assert.equal(ctx.bodies.length,1);
  assert.equal(ctx.bodies[0].action,'open');
  assert.equal(ctx.bodies[0].href,ctx.win.location.href);
});
test("tatsächliche 6,1-Zoll-Lupe Bei YouTube suchen öffnet die native Suche", t => {
  const ctx = setup(t, {channels:["langformOpenWatch","langformNativeSearch"]});
  ctx.win.document.body.insertAdjacentHTML('afterbegin','<ytm-mobile-topbar-renderer><button aria-label="Bei YouTube suchen" id="actual-search"><svg></svg></button></ytm-mobile-topbar-renderer>');
  ctx.tap('actual-search');
  assert.equal(ctx.spaClicks(),0);assert.equal(ctx.bodies[0].action,'open');
});
test("native Suche bindet frühe Pointerfreigabe und späten WK-Klick an denselben Kontakt", t => {
  const ctx=setup(t,{channels:['langformOpenWatch','langformNativeSearch']});
  ctx.win.document.body.insertAdjacentHTML('afterbegin','<div aria-label="Bei YouTube suchen" id="search-entry">Suchen</div>');
  let now=1000;ctx.win.Date.now=()=>now;
  const pointer=(name,x=20,y=20)=>{const e=new ctx.win.MouseEvent(name,{bubbles:true,cancelable:true,clientX:x,clientY:y});Object.defineProperty(e,'pointerId',{value:7});ctx.win.document.getElementById('search-entry').dispatchEvent(e)};
  pointer('pointerdown');assert.equal(ctx.bodies.length,0);pointer('pointerup');assert.equal(ctx.bodies.length,1);
  ctx.win.dispatchEvent(new ctx.win.Event('blur'));now=2900;ctx.tap('search-entry',{detail:1});
  assert.deepEqual(ctx.bodies.map(b=>b.action),['open','focus'],'the late WebKit handoff restores focus without reopening a dismissed overlay');
  pointer('pointerdown');pointer('pointerup');assert.deepEqual(ctx.bodies.map(b=>b.action),['open','focus','open'],'fresh physical tap remains available');
});
test("Ziehen ab Suchknopf aktiviert weder bei Release noch beim Nachklick die Suche",t=>{
  const ctx=setup(t,{channels:['langformOpenWatch','langformNativeSearch']});ctx.win.document.body.insertAdjacentHTML('afterbegin','<div aria-label="Bei YouTube suchen" id="moving-search">Suchen</div>');
  for(const [name,x] of [['pointerdown',20],['pointermove',65],['pointerup',65]]){
    const e=new ctx.win.MouseEvent(name,{bubbles:true,cancelable:true,clientX:x,clientY:20});Object.defineProperty(e,'pointerId',{value:9});ctx.win.document.getElementById('moving-search').dispatchEvent(e);
  }
  ctx.tap('moving-search',{detail:1});assert.equal(ctx.bodies.length,0);
});

test("native Suche übernimmt ein getipptes Ergebnis-Suchfeld ohne Webfokus", t => {
  const ctx = setup(t, {url:'https://m.youtube.com/results?search_query=NASA',channels:["langformOpenWatch","langformNativeSearch"]});
  ctx.win.document.body.insertAdjacentHTML('afterbegin','<yt-searchbox><input name="search_query" value="NASA" id="native-input"></yt-searchbox>');
  ctx.tap('native-input');
  assert.equal(ctx.bodies[0].action,'open');
  assert.notEqual(ctx.win.document.activeElement.id,'native-input');
});
test("native search receives the current custom filter after canonical URL cleanup",t=>{
  const ctx=setup(t,{url:'https://m.youtube.com/results?search_query=NASA&sp=EgIQAQ%253D%253D',channels:['langformOpenWatch','langformNativeSearch']});
  ctx.win.__langformSearchFilter=()=> 'unwatched';
  ctx.win.document.body.insertAdjacentHTML('afterbegin','<ytm-header><button class="topbar-button-search-button" id="custom-filter-search">Suchen</button></ytm-header>');
  ctx.tap('custom-filter-search');assert.equal(ctx.bodies[0].filter,'unwatched');
});

test("native Watch-Suchübergabe braucht kein hydriertes Webfeld und bleibt bis Frame widerrufbar", t => {
  const frames=[];
  const ctx=setup(t,{channels:['langformOpenWatch','langformNativeSearch','langformFeedSearch'],beforeScript(win){win.requestAnimationFrame=cb=>{frames.push(cb);return frames.length};win.cancelAnimationFrame=()=>{}}});
  assert.equal(ctx.win.__langformOpenSearch(10),true);
  assert.equal(ctx.bodies.length,0);
  frames.shift()();
  assert.equal(ctx.bodies[0].action,'open');assert.equal(ctx.bodies[0].ticket,10);
  assert.equal(ctx.bodies[1].opened,true);
  assert.equal(ctx.win.__langformOpenSearch(11),true);
  ctx.win.__langformFeedActive=false;
  ctx.win.dispatchEvent(new ctx.win.Event('langform-feed-visibility'));
  frames.shift()();
  assert.equal(ctx.bodies.filter(b=>b.action==='open').length,1);
});

test("ausgefallene native Suchbrücke erhält die originale Lupenaktion", t => {
  const ctx=setup(t,{channels:['langformOpenWatch','langformNativeSearch'],beforeScript(win){win.webkit.messageHandlers.langformNativeSearch.postMessage=()=>{throw new Error('gone')}}});
  ctx.win.document.body.insertAdjacentHTML('afterbegin','<ytm-header><button class="topbar-button-search-button" id="failed-native-search">Suchen</button></ytm-header>');
  ctx.tap('failed-native-search');assert.equal(ctx.spaClicks(),1);assert.equal(ctx.bodies.length,0);
});

test("Abos → Startseite navigiert auch bei schon geänderter URL vor YouTubes altem Feed", t => {
  const ctx = setup(t);
  ctx.tap("home");
  assert.deepEqual(ctx.posts, ["https://m.youtube.com/"]);
  assert.equal(ctx.spaClicks(), 0);
  // Reproduce the reported state: URL says Home, renderer still shows Abos.
  ctx.win.history.replaceState({}, "", "/");
  ctx.tap("home");
  ctx.tap("subs");
  assert.deepEqual(ctx.posts, ["https://m.youtube.com/", "https://m.youtube.com/", "https://m.youtube.com/feed/subscriptions"]);
  assert.equal(ctx.spaClicks(), 0);
});

test("Mein YouTube aktiviert seinen Feed, Kanal und modifizierte Klicks bleiben auf der Seite", t => {
  const ctx = setup(t);
  ctx.tap("account");
  ctx.tap("channel");
  ctx.tap("home", { metaKey: true });
  assert.deepEqual(ctx.posts, ["https://m.youtube.com/feed/library"]);
  assert.equal(ctx.spaClicks(), 2);
});

test("ohne native Feed-Brücke bleibt YouTubes Tab-Navigation unverändert", t => {
  const ctx = setup(t, "langformOpenWatch");
  ctx.tap("home");
  ctx.tap("subs");
  assert.deepEqual(ctx.posts, []);
  assert.equal(ctx.spaClicks(), 2);
});

test("Abos-Tab ohne Link verwendet seine eindeutige Beschriftung", t => {
  const ctx = setup(t);
  const pivot = ctx.win.document.getElementById("subs").closest("ytm-pivot-bar-item-renderer");
  pivot.innerHTML = '<span id="subs">Abos</span>';
  ctx.tap("subs");
  assert.deepEqual(ctx.posts, ["https://m.youtube.com/feed/subscriptions"]);
});

test("echte Tab-Links haben Vorrang vor Beschriftungen und erhalten den Library-Alias", t => {
  const ctx = setup(t);
  const pivot = ctx.win.document.getElementById("account").closest("ytm-pivot-bar-item-renderer");
  pivot.setAttribute("aria-label", "Startseite");
  pivot.innerHTML = '<a href="/feed/you"><span id="account">Home</span></a>';
  ctx.tap("account");
  pivot.querySelector("a").setAttribute("href", "/feed/library");
  ctx.tap("account");
  assert.deepEqual(ctx.posts, ["https://m.youtube.com/feed/you", "https://m.youtube.com/feed/library"]);
  assert.equal(ctx.spaClicks(), 0);
});

test("Beschriftungen auf Kindknoten bleiben auf das getippte Tab begrenzt", t => {
  const ctx = setup(t);
  const subs = ctx.win.document.getElementById("subs").closest("ytm-pivot-bar-item-renderer");
  subs.innerHTML = '<button aria-label="Abos"><span id="subs"></span></button>';
  const account = ctx.win.document.getElementById("account").closest("ytm-pivot-bar-item-renderer");
  account.removeAttribute("aria-label");
  account.innerHTML = '<button title="You"><span id="account"></span></button>';
  ctx.win.document.querySelector = ctx.win.document.querySelectorAll = function () {
    assert.fail("Tab-Tipps dürfen nicht die ganze Seite durchsuchen");
  };
  ctx.tap("subs");
  ctx.tap("account");
  assert.deepEqual(ctx.posts, ["https://m.youtube.com/feed/subscriptions", "https://m.youtube.com/feed/library"]);
});

test("ein Platzhalter-Link verwendet das getippte Tab statt den aktuellen Seitenpfad", t => {
  const ctx = setup(t, { url: "https://m.youtube.com/" });
  const pivot = ctx.win.document.getElementById("subs").closest("ytm-pivot-bar-item-renderer");
  pivot.innerHTML = '<a href="#" aria-label="Abos"><span id="subs"></span></a>';
  ctx.tap("subs");
  assert.deepEqual(ctx.posts, ["https://m.youtube.com/feed/subscriptions"]);
});

test("unbekannte oder fremde explizite Links werden nicht anhand eines Home-Labels umgeleitet", t => {
  const ctx = setup(t);
  const pivot = ctx.win.document.getElementById("home").closest("ytm-pivot-bar-item-renderer");
  pivot.innerHTML = '<a href="/@channel"><span id="home">Startseite</span></a>';
  ctx.tap("home");
  pivot.querySelector("a").setAttribute("href", "https://example.com/");
  ctx.tap("home");
  assert.deepEqual(ctx.posts, []);
  assert.equal(ctx.spaClicks(), 2);
  assert.deepEqual(ctx.spaSawPrevented, [false, false]);
});

test("eine fehlgeschlagene native Tab-Brücke erhält YouTubes Standardaktion", t => {
  const ctx = setup(t, {
    channels: ["langformNavigateFeed", "langformOpenFeed"],
    url: "https://m.youtube.com/watch?v=abcdefghijk", throwBridge: true,
  });
  ctx.tap("subs");
  assert.deepEqual(ctx.messages, [], "der fehlgeschlagene Tab-Tipp darf nicht in die generische Feed-Brücke fallen");
  assert.equal(ctx.spaClicks(), 1);
  assert.deepEqual(ctx.spaSawPrevented, [false]);
});

test("Tabs im Player nutzen die gleiche native Tab-Brücke ohne Video- oder History-Änderung", t => {
  const ctx = setup(t, {
    channels: ["langformNavigateFeed", "langformOpenFeed", "langformPlayer"],
    url: "https://m.youtube.com/watch?v=abcdefghijk",
  });
  const video = ctx.win.document.createElement("video");
  ctx.win.document.body.appendChild(video);
  let pauses = 0;
  let seeks = 0;
  video.pause = function () { pauses++; };
  Object.defineProperty(video, "currentTime", { get: () => 42, set: () => { seeks++; } });
  const beforeURL = ctx.win.location.href;
  const beforeHistory = ctx.win.history.length;
  ctx.tap("home");
  ctx.tap("subs");
  ctx.tap("account");
  assert.deepEqual(ctx.messages.map(message => message.name), ["langformNavigateFeed", "langformNavigateFeed", "langformNavigateFeed"]);
  assert.deepEqual(ctx.posts, ["https://m.youtube.com/", "https://m.youtube.com/feed/subscriptions", "https://m.youtube.com/feed/library"]);
  assert.equal(ctx.spaClicks(), 0);
  assert.equal(ctx.win.location.href, beforeURL);
  assert.equal(ctx.win.history.length, beforeHistory);
  assert.equal(pauses, 0);
  assert.equal(seeks, 0);
  assert.equal(video.isConnected, true);
  assert.equal(video.getAttribute("style"), null);
});

test("Suchknopf im Watch-Player aktiviert die Feed-Suche vor YouTubes Suchoverlay", t => {
  const ctx = setup(t, { channels: ["langformOpenFeed", "langformPlayerRoute"], url: "https://m.youtube.com/watch?v=abcdefghijk" });
  ctx.win.document.body.insertAdjacentHTML("afterbegin", '<ytm-header><button class="topbar-button-search-button"><span id="search-icon">Suche</span></button></ytm-header>');
  const event = ctx.tap("search-icon");
  assert.equal(event.defaultPrevented, true);
  assert.equal(ctx.spaClicks(), 0, "YouTube darf das Suchoverlay nicht im Player öffnen");
  assert.deepEqual(ctx.bodies, [{kind:"search",href:"https://m.youtube.com/",sourceHref:"https://m.youtube.com/watch?v=abcdefghijk",videoID:"abcdefghijk"}]);
  assert.equal(ctx.win.location.pathname, "/watch");
  assert.equal(ctx.win.__langformOpenSearch(), false, "Feed-Aktivierung kann nicht in der Player-Ansicht ausgeführt werden");
});

test("Aktueller View-Model-Suchknopf aktiviert aus Watch ebenfalls die Feed-Suche", t=>{
  const ctx=setup(t,{channels:['langformOpenFeed','langformPlayerRoute'],url:'https://m.youtube.com/watch?v=abcdefghijk'});
  ctx.win.document.body.insertAdjacentHTML('afterbegin','<div class="ytTopBarViewModelHost"><button class="ytTopBarViewModelSearchButton"><span id="current-search-icon"></span></button></div>');
  const event=ctx.tap('current-search-icon');
  assert.equal(event.defaultPrevented,true);assert.equal(ctx.spaClicks(),0);
  assert.equal(ctx.bodies[0].kind,'search');
});

test("Native Feed-Suche erreicht den aktuellen Suchknopf auch im Component-Host", t=>{
  let frame;
  const ctx=setup(t,{channels:['langformOpenWatch','langformFeedSearch'],beforeScript(win){win.requestAnimationFrame=fn=>{frame=fn;return 1;};win.cancelAnimationFrame=()=>{};}});
  ctx.win.document.body.insertAdjacentHTML('afterbegin','<div class="ytTopBarViewModelHost"><ytm-button-renderer class="ytTopBarViewModelSearchButton"><button id="actual-search-button" aria-label="Suchen"></button></ytm-button-renderer></div>');
  let clicks=0;ctx.win.document.querySelector('#actual-search-button').addEventListener('click',()=>clicks++);
  assert.equal(ctx.win.__langformOpenSearch(1),true);frame();
  assert.equal(clicks,1,'the actual original button owns its action');
  assert.equal(ctx.bodies.at(-1).opened,true);
});

test("Versteckte alte Suchfelder und Lupen überholen den sichtbaren Originalknopf nicht", t=>{
  let frame;
  const ctx=setup(t,{channels:['langformOpenWatch','langformFeedSearch'],beforeScript(win){win.requestAnimationFrame=fn=>{frame=fn;return 1;};win.cancelAnimationFrame=()=>{};}});
  ctx.win.document.body.insertAdjacentHTML('afterbegin','<ytm-header hidden><button class="topbar-button-search-button" id="old-search"></button><yt-searchbox><input name="search_query"></yt-searchbox></ytm-header><div class="ytTopBarViewModelHost"><ytm-button-renderer class="ytTopBarViewModelSearchButton"><button id="visible-search"></button></ytm-button-renderer></div>');
  let oldClicks=0,visibleClicks=0;
  ctx.win.document.getElementById('old-search').addEventListener('click',()=>oldClicks++);
  ctx.win.document.getElementById('visible-search').addEventListener('click',()=>visibleClicks++);
  assert.equal(ctx.win.__langformOpenSearch(10),true);frame();
  assert.equal(oldClicks,0);assert.equal(visibleClicks,1);
});

test("Bei geöffneter Suche fokussiert die Brücke das sichtbare Feld hinter versteckten Duplikaten", t=>{
  let frame;
  const ctx=setup(t,{channels:['langformOpenWatch','langformFeedSearch'],beforeScript(win){win.requestAnimationFrame=fn=>{frame=fn;return 1;};win.cancelAnimationFrame=()=>{};}});
  ctx.win.document.body.insertAdjacentHTML('afterbegin','<yt-searchbox hidden><input name="search_query" id="hidden-input"></yt-searchbox><yt-searchbox><input name="search_query" id="visible-input"></yt-searchbox>');
  assert.equal(ctx.win.__langformOpenSearch(11),true);frame();
  assert.equal(ctx.win.document.activeElement,ctx.win.document.getElementById('visible-input'));
  assert.equal(ctx.bodies.at(-1).opened,true);
});

test("Suchformular und SPA-Suche bleiben außerhalb des miniaturisierbaren Dokuments", t => {
  const ctx = setup(t, { channels: ["langformOpenFeed", "langformPlayerRoute"], url: "https://m.youtube.com/watch?v=abcdefghijk" });
  ctx.win.document.body.insertAdjacentHTML("beforeend", '<form action="/results"><input name="search_query" value="Film & Motion"></form>');
  const submit = new ctx.win.Event("submit", {bubbles:true,cancelable:true});
  ctx.win.document.querySelector("form").dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, true);
  assert.equal(ctx.bodies[0].kind,"navigate");
  assert.equal(new URL(ctx.bodies[0].href).searchParams.get("search_query"),"Film & Motion");
  assert.equal(ctx.win.location.pathname,"/watch", "Formularnavigation verändert die Watch-Seite nicht");
  ctx.win.history.pushState({q:1},"","/results?search_query=Film");
  assert.equal(ctx.bodies[1].kind,"departed");
  assert.equal(ctx.bodies[1].videoID,"abcdefghijk");
  assert.equal(ctx.win.history.state.q,1, "YouTubes History-Semantik bleibt erhalten");
  ctx.win.history.replaceState({},"","/watch?v=lmnopqrstuv");
  ctx.win.history.replaceState({},"","/results?search_query=Neu");
  assert.equal(ctx.bodies[2].videoID,"lmnopqrstuv", "Handoff gehört zum zuletzt gewählten Video");
});

test("Suche im Feed verwendet denselben YouTube-Knopf ohne Player-Brücke", t => {
  let frame;
  const ctx = setup(t, {channels:["langformOpenWatch", "langformFeedSearch"], beforeScript(win) {
    win.requestAnimationFrame = callback => { frame = callback; return 1; };
    win.cancelAnimationFrame = () => { frame = null; };
  }});
  ctx.win.document.body.insertAdjacentHTML("afterbegin", '<ytm-header><button class="topbar-button-search-button">Suche</button></ytm-header>');
  assert.equal(ctx.win.__langformOpenSearch(1),true);
  assert.equal(ctx.spaClicks(),0, "queued search remains revocable before the next paint");
  frame();
  assert.equal(ctx.spaClicks(),1);
  assert.deepEqual(ctx.bodies,[{ticket:1,opened:true,href:ctx.win.location.href}]);
  ctx.messages.length = 0;
  ctx.win.history.pushState({},"","/results?search_query=Film");
  assert.deepEqual(ctx.messages,[], "normale Feed-Navigation bekommt keine Player-Meldungen");
});

test("eine überholte Feed-Suche klickt und fokussiert nach Tabwechsel oder pagehide nicht", t => {
  const frames = new Map(); let serial = 0;
  const ctx = setup(t, { channels:["langformOpenWatch", "langformFeedSearch"], beforeScript(win) {
    win.requestAnimationFrame = callback => { frames.set(++serial, callback); return serial; };
    win.cancelAnimationFrame = id => frames.delete(id);
  }});
  function paint() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); }
  ctx.win.document.body.insertAdjacentHTML("afterbegin", '<ytm-header><button class="topbar-button-search-button">Suche</button></ytm-header>');
  ctx.win.__langformFeedActive = false;
  assert.equal(ctx.win.__langformOpenSearch(1),false);
  assert.equal(frames.size,0);
  ctx.win.__langformFeedActive = true;
  assert.equal(ctx.win.__langformOpenSearch(2),true);
  ctx.win.__langformCancelSearch(); paint();
  assert.equal(ctx.spaClicks(),0, "native cancellation revokes the UI effect, not merely its callback");
  assert.equal(ctx.win.__langformOpenSearch(3),true);
  ctx.win.__langformFeedActive = false; paint();
  assert.equal(ctx.spaClicks(),0);
  ctx.win.__langformFeedActive = true;
  ctx.win.__langformOpenSearch(4); ctx.win.dispatchEvent(new ctx.win.Event("pagehide")); paint();
  assert.equal(ctx.spaClicks(),0);
  ctx.win.dispatchEvent(new ctx.win.Event("pageshow"));
  ctx.win.document.body.insertAdjacentHTML("afterbegin", '<yt-searchbox><input name="search_query"></yt-searchbox>');
  const input = ctx.win.document.querySelector('input[name="search_query"]');
  input.getClientRects = () => [{}];
  ctx.win.__langformOpenSearch(5);
  assert.notEqual(ctx.win.document.activeElement,input);
  paint(); assert.equal(ctx.win.document.activeElement,input);
  assert.deepEqual(ctx.bodies.map(body => [body.ticket,body.opened]), [[2,false],[3,false],[4,false],[5,true]]);
});

test("Such-Ack folgt erst dem tatsächlichen RAF-Ziel; Hydration kann danach erneut aktivieren", t => {
  const frames = new Map(); let serial = 0;
  const ctx = setup(t, {channels:["langformOpenWatch", "langformFeedSearch"], beforeScript(win) {
    win.requestAnimationFrame = callback => { frames.set(++serial,callback); return serial; };
    win.cancelAnimationFrame = id => frames.delete(id);
  }});
  function paint() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); }
  function mount() { ctx.win.document.body.insertAdjacentHTML("afterbegin", '<ytm-header><button class="topbar-button-search-button">Suche</button></ytm-header>'); }
  mount();
  assert.equal(ctx.win.__langformOpenSearch(7),true);
  assert.deepEqual(ctx.bodies,[], "scheduling cannot acknowledge a click that has not happened");
  ctx.win.document.querySelector("ytm-header").remove();
  paint();
  assert.deepEqual(ctx.bodies,[{ticket:7,opened:false,href:ctx.win.location.href}]);
  assert.equal(ctx.spaClicks(),0);
  mount();
  assert.equal(ctx.win.__langformOpenSearch(7),true);
  paint();
  assert.equal(ctx.spaClicks(),1);
  assert.deepEqual(ctx.bodies.at(-1),{ticket:7,opened:true,href:ctx.win.location.href});
  ctx.win.document.querySelector("button.topbar-button-search-button").click = () => { throw new Error("detached control"); };
  ctx.win.__langformOpenSearch(8); paint();
  assert.deepEqual(ctx.bodies.at(-1),{ticket:8,opened:false,href:ctx.win.location.href});
});

test("abgebrochene Suchframes können neuere Requests nicht bestätigen oder ausführen", t => {
  const frames = new Map(); let serial = 0;
  const ctx = setup(t, {channels:["langformOpenWatch", "langformFeedSearch"], beforeScript(win) {
    win.requestAnimationFrame = callback => { frames.set(++serial,callback); return serial; };
    win.cancelAnimationFrame = id => frames.delete(id);
  }});
  ctx.win.document.body.insertAdjacentHTML("afterbegin", '<ytm-header><button class="topbar-button-search-button">Suche</button></ytm-header>');
  ctx.win.__langformOpenSearch(1); const old = [...frames.values()][0];
  ctx.win.__langformCancelSearch(); ctx.win.__langformOpenSearch(2);
  old();
  assert.equal(ctx.spaClicks(),0);
  assert.deepEqual(ctx.bodies.map(body => [body.ticket,body.opened]),[[1,false]]);
  ctx.win.__langformFeedActive = false;
  ctx.win.dispatchEvent(new ctx.win.Event("langform-feed-visibility"));
  assert.equal(frames.size,0);
  assert.deepEqual(ctx.bodies.map(body => [body.ticket,body.opened]),[[1,false],[2,false]]);
});

test("fehlende oder fehlgeschlagene Suchbrücke erhält die normale YouTube-Aktion", t => {
  const ctx = setup(t,{channels:["langformOpenFeed", "langformPlayerRoute"],url:"https://m.youtube.com/watch?v=abcdefghijk"});
  ctx.win.document.body.insertAdjacentHTML("afterbegin",'<ytm-header><button class="topbar-button-search-button"><span id="search-default">Suche</span></button></ytm-header>');
  ctx.win.webkit.messageHandlers.langformPlayerRoute.postMessage = () => { throw new Error("bridge unavailable"); };
  ctx.tap("search-default");
  assert.equal(ctx.spaClicks(),1);
  assert.deepEqual(ctx.spaSawPrevented,[false],"failed native interception leaves the action for YouTube's router");
  assert.deepEqual(ctx.bodies,[]);
  const feed = setup(t,{channels:["langformOpenWatch"]});
  feed.win.document.body.insertAdjacentHTML("afterbegin",'<ytm-header><button id="feed-default" class="topbar-button-search-button">Suche</button></ytm-header>');
  assert.equal(feed.win.__langformOpenSearch(1),false,"native scheduling needs the acknowledgement handler");
  assert.equal(feed.tap("feed-default").defaultPrevented,true,"YouTube's own capture handler still receives a direct feed click");
  assert.equal(feed.spaClicks(),1);
});

test("eigene Oberflächen und gleich beschriftete Elemente außerhalb der Pivot-Leiste werden nicht abgefangen", t => {
  const ctx = setup(t);
  const wrapper = ctx.win.document.createElement("div");
  wrapper.id = "langform-summary";
  const account = ctx.win.document.getElementById("account").closest("ytm-pivot-bar-item-renderer");
  account.replaceWith(wrapper);
  wrapper.appendChild(account);
  const outside = ctx.win.document.createElement("button");
  outside.id = "outside";
  outside.setAttribute("aria-label", "Startseite");
  ctx.win.document.body.appendChild(outside);
  ctx.tap("account");
  ctx.tap("outside");
  assert.deepEqual(ctx.posts, []);
  assert.equal(ctx.spaClicks(), 2);
});

test("nur die mobile Beschriftungs-Fallbackroute nutzt Library, Desktop behält You", t => {
  for (const host of ["www.youtube.com", "youtube.com"]) {
    const ctx = setup(t, { url: `https://${host}/` });
    ctx.tap("account");
    assert.deepEqual(ctx.posts, [`https://${host}/feed/you`]);
  }
});

test("bekannte YouTube-Sheets blockieren native Gesten nur sichtbar und überschreiben kein offenes Discovery-Menü", async t => {
  const dom = new JSDOM('<button id="settings">Settings</button><bottom-sheet-container hidden role="dialog"><div>Menu</div></bottom-sheet-container>', {
    url: "https://m.youtube.com/watch?v=abcdefghijk", runScripts: "outside-only",
  });
  t.after(() => dom.window.close());
  const win = dom.window;
  const posts = [];
  win.webkit = { messageHandlers: { langformOverlayState: { postMessage(body) { posts.push(JSON.parse(JSON.stringify(body))); } } } };
  win.eval(source);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  const sheet = win.document.querySelector("bottom-sheet-container");
  assert.equal(posts.at(-1).open, false);
  sheet.hidden = false;
  await flush();
  assert.equal(posts.at(-1).open, true);
  assert.equal(posts.at(-1).href, win.location.href);
  const openReports = posts.length;
  win.__langformSetOverlayState("discovery", true);
  sheet.hidden = true;
  await flush();
  assert.equal(posts.length, openReports, "das andere noch offene Menü hält die Sperre ohne doppelte Posts");
  win.__langformSetOverlayState("discovery", false);
  assert.equal(posts.at(-1).open, false);
  sheet.hidden = false;
  sheet.style.display = "none";
  await flush();
  assert.equal(posts.at(-1).open, false);
  sheet.style.display = "";
  await flush();
  assert.equal(posts.at(-1).open, true);
  sheet.remove();
  await flush();
  assert.equal(posts.at(-1).open, false);

  // A menu rendered later by a click is discovered without polling. Ordinary
  // feed additions and generic ARIA labels are not treated as blocking sheets.
  win.document.getElementById("settings").click();
  const wrapper = win.document.createElement("div");
  wrapper.innerHTML = '<div id="dialog-container"><section role="dialog">Settings</section></div>';
  win.document.body.appendChild(wrapper);
  await flush();
  assert.equal(posts.at(-1).open, true);
  wrapper.querySelector("#dialog-container").remove();
  await flush();
  assert.equal(posts.at(-1).open, false);
  const beforeFeedChange = posts.length;
  wrapper.innerHTML = '<ytm-rich-item-renderer><div role="dialog">Unrelated renderer</div></ytm-rich-item-renderer>';
  await flush();
  assert.equal(posts.length, beforeFeedChange);
  win.__langformSetOverlayState("discovery", true);
  win.dispatchEvent(new win.Event("pagehide"));
  assert.equal(posts.at(-1).open, false);
  const afterHide = posts.length;
  win.__langformSetOverlayState("discovery", true);
  await flush();
  assert.equal(posts.length, afterHide, "eine abgelöste Seite liefert keine neuen Zustände");
});

test("Klicks und neue Kommentare in registrierten Sheets verursachen keine Dokument- oder Teilbaumsuche", async t => {
  const dom = new JSDOM('<button id="settings">Settings</button><bottom-sheet-container role="dialog"><div id="comments"><button id="reply">Antworten</button></div></bottom-sheet-container>', {
    url: "https://m.youtube.com/watch?v=abcdefghijk", runScripts: "outside-only",
  });
  t.after(() => { dom.window.dispatchEvent(new dom.window.Event("pagehide")); dom.window.close(); });
  const win = dom.window;
  win.webkit = { messageHandlers: { langformOverlayState: { postMessage() {} } } };
  win.eval(source);
  await new Promise(resolve => setImmediate(resolve));
  let documentSearches = 0;
  let commentSearches = 0;
  let discoveryWindows = 0;
  const query = win.document.querySelectorAll.bind(win.document);
  win.document.querySelectorAll = function (selector) { documentSearches++; return query(selector); };
  const timeout = win.setTimeout.bind(win);
  win.setTimeout = function (callback, delay) { if (delay === 2000) discoveryWindows++; return timeout(callback, delay); };
  win.document.getElementById("reply").click();
  const thread = win.document.createElement("div");
  thread.innerHTML = "<p>Kommentar</p>".repeat(100);
  const threadQuery = thread.querySelectorAll.bind(thread);
  thread.querySelectorAll = function (selector) { commentSearches++; return threadQuery(selector); };
  win.document.getElementById("comments").appendChild(thread);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(documentSearches, 0);
  assert.equal(commentSearches, 0);
  assert.equal(discoveryWindows, 0, "innere Klicks verlängern keine globale Beobachtung");
  win.document.getElementById("settings").click();
  assert.equal(documentSearches, 0, "auch äußere Klicks scannen nicht synchron vor der Aktion");
  assert.equal(discoveryWindows, 1, "ein äußerer Öffner darf nach neu montierten Sheets sehen");
});

test("das Entfernen eines ganzen Sheet-Wrappers löst die Gestensperre auch nach Ende der Discovery", async t => {
  const dom = new JSDOM('<main><div id="wrapper"><panel-container><ytm-engagement-panel><div>Kommentare</div></ytm-engagement-panel></panel-container></div></main>', {
    url: "https://m.youtube.com/watch?v=abcdefghijk", runScripts: "outside-only",
  });
  t.after(() => { dom.window.dispatchEvent(new dom.window.Event("pagehide")); dom.window.close(); });
  const win = dom.window;
  const timers = new Map();
  let serial = 0;
  win.setTimeout = (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; };
  win.clearTimeout = id => timers.delete(id);
  const posts = [];
  const notifications = [];
  win.webkit = { messageHandlers: { langformOverlayState: { postMessage(body) { posts.push(body.open); } } } };
  win.eval(source);
  win.__langformObserveOverlayContainers((node, connected) => notifications.push({ node, connected }));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  assert.equal(posts.at(-1), true);
  Array.from(timers.values()).forEach(timer => timer.callback());
  let documentSearches = 0;
  const query = win.document.querySelectorAll.bind(win.document);
  win.document.querySelectorAll = function (selector) { documentSearches++; return query(selector); };
  const panel = win.document.querySelector("ytm-engagement-panel");
  win.document.getElementById("wrapper").remove();
  await flush();
  assert.equal(posts.at(-1), false, "ein abgelöstes Blatt darf native Playergesten nicht dauerhaft sperren");
  assert.equal(notifications.at(-1).node, panel);
  assert.equal(notifications.at(-1).connected, false, "Decorator lösen ihre Observer und Animationen");
  assert.equal(documentSearches, 0, "Removal prüft registrierte Knoten ohne Dokumentscan");
});

test("versteckte Sheet-Vorfahren blockieren weder Start noch Swipe und werden ohne neue Discovery wieder geöffnet", async t => {
  const dom = new JSDOM('<style>.closed { display: none; }</style><main><div id="wrapper" hidden><panel-container><ytm-engagement-panel style="display:block"><div>Kommentare</div></ytm-engagement-panel></panel-container></div></main>', {
    url: "https://m.youtube.com/watch?v=abcdefghijk", runScripts: "outside-only",
  });
  t.after(() => { dom.window.dispatchEvent(new dom.window.Event("pagehide")); dom.window.close(); });
  const win = dom.window;
  let stopDiscovery;
  win.setTimeout = callback => { stopDiscovery = callback; return 1; };
  win.clearTimeout = () => {};
  const posts = [];
  win.webkit = { messageHandlers: { langformOverlayState: { postMessage(body) { posts.push(body.open); } } } };
  win.eval(source);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  assert.equal(posts.at(-1), false, "der eigene display-Wert des Panels reicht unter einem versteckten Wrapper nicht aus");
  stopDiscovery();
  let documentSearches = 0;
  const query = win.document.querySelectorAll.bind(win.document);
  win.document.querySelectorAll = function (selector) { documentSearches++; return query(selector); };
  const wrapper = win.document.getElementById("wrapper");
  wrapper.hidden = false;
  await flush();
  assert.equal(posts.at(-1), true);

  const hiddenStates = [
    [() => { wrapper.hidden = true; }, () => { wrapper.hidden = false; }],
    [() => wrapper.setAttribute("aria-hidden", "true"), () => wrapper.removeAttribute("aria-hidden")],
    [() => { wrapper.style.display = "none"; }, () => { wrapper.style.display = ""; }],
    [() => { wrapper.style.visibility = "hidden"; }, () => { wrapper.style.visibility = ""; }],
    [() => { wrapper.className = "closed"; }, () => { wrapper.className = ""; }],
  ];
  for (const [hide, show] of hiddenStates) {
    hide();
    await flush();
    assert.equal(posts.at(-1), false, "ein unsichtbarer zurückbehaltener Wrapper löst die native Sperre");
    show();
    await flush();
    assert.equal(posts.at(-1), true, "ein wiederverwendetes Sheet sperrt native Gesten erst beim erneuten Öffnen");
  }
  assert.equal(documentSearches, 0, "Sichtbarkeitsänderungen beobachten nur bekannte Knoten und ihre Vorfahren");
});

test("verschobene Sheet-Wrapper lösen alte Strukturbeobachter und bleiben am neuen Ort beobachtet", async t => {
  const dom = new JSDOM('<main><div id="wrapper"><panel-container><ytm-engagement-panel><div>Kommentare</div></ytm-engagement-panel></panel-container></div></main><aside id="destination"></aside>', {
    url: "https://m.youtube.com/watch?v=abcdefghijk", runScripts: "outside-only",
  });
  t.after(() => { dom.window.dispatchEvent(new dom.window.Event("pagehide")); dom.window.close(); });
  const win = dom.window;
  let stopDiscovery;
  win.setTimeout = callback => { stopDiscovery = callback; return 1; };
  win.clearTimeout = () => {};
  const posts = [];
  win.webkit = { messageHandlers: { langformOverlayState: { postMessage(body) { posts.push(body.open); } } } };
  win.eval(source);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  stopDiscovery();
  win.document.getElementById("destination").appendChild(win.document.getElementById("wrapper"));
  await flush();
  assert.equal(posts.at(-1), true, "Verschieben allein schließt kein sichtbares Blatt");
  win.document.getElementById("destination").hidden = true;
  await flush();
  assert.equal(posts.at(-1), false, "der neue Vorfahr gibt beim Verstecken die native Gestensperre frei");
  win.document.getElementById("destination").hidden = false;
  await flush();
  assert.equal(posts.at(-1), true, "das verschobene Sheet bleibt auch beim Wiederöffnen beobachtet");
  const beforeUnrelatedChange = posts.length;
  win.document.querySelector("main").hidden = true;
  win.document.querySelector("main").appendChild(win.document.createElement("p"));
  await flush();
  assert.equal(posts.length, beforeUnrelatedChange);
  win.document.getElementById("destination").remove();
  await flush();
  assert.equal(posts.at(-1), false, "auch der neue Wrapper wird ohne globale Discovery freigegeben");
});

function thumbnail(ctx, { href = "/watch?v=abcdefghijk", src = "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", rect = { left: 16, top: 120, width: 358, height: 201 } } = {}) {
  const link = ctx.win.document.createElement("a");
  link.id = "watch-card";
  link.href = href;
  const image = ctx.win.document.createElement("img");
  image.id = "watch-thumbnail";
  image.src = src;
  image.getBoundingClientRect = () => rect;
  link.appendChild(image);
  ctx.win.document.body.appendChild(link);
  Object.defineProperty(ctx.win, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(ctx.win, "innerHeight", { configurable: true, value: 740 });
  return { link, image };
}

function motionSetup(t, { reduced = false, touchFallback = false, channels = ["langformOpenWatch", "langformNavigateFeed"], url } = {}) {
  const animations = [];
  let media;
  const ctx = setup(t, { channels, url, beforeScript(win) {
    if (!touchFallback) win.PointerEvent = win.MouseEvent;
    win.CSS = { supports: (property, value) => property === "scale" && value === "1" };
    media = new win.EventTarget();
    media.matches = reduced;
    win.matchMedia = () => media;
    win.Element.prototype.animate = function (keyframes, options) {
      const animation = { node: this, keyframes, options, cancelled: false, cancel() { this.cancelled = true; } };
      animations.push(animation);
      return animation;
    };
  } });
  return { ...ctx, animations, media,
    pointer(type, node, { x = 100, y = 200, id = 1, primary = true, ...options } = {}) {
      const event = new ctx.win.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, ...options });
      Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: primary } });
      node.dispatchEvent(event);
      return event;
    },
    touch(type, node, points) {
      const event = new ctx.win.Event(type, { bubbles: true, cancelable: true, composed: true });
      Object.defineProperties(event, { touches: { value: type === "touchend" ? [] : points }, changedTouches: { value: points } });
      node.dispatchEvent(event);
      return event;
    },
  };
}

test("Videoöffnung übermittelt nur die sichtbare Geometrie des passenden getippten Thumbnails", t => {
  const ctx = setup(t, "langformOpenWatch");
  const { image } = thumbnail(ctx, { rect: { left: -10, top: 620, width: 400, height: 200 } });
  ctx.tap(image.id);
  assert.deepEqual(ctx.bodies, [{ href: "https://m.youtube.com/watch?v=abcdefghijk", sourceRect: {
    x: 0, y: 620, width: 390, height: 120, viewportWidth: 390, viewportHeight: 740,
  } }]);
  assert.equal(ctx.spaClicks(), 0, "Geometrie verzögert die native Öffnung nicht");
});

function titledCard(ctx, { id = "abcdefghijk", sourceID = id, renderer = "ytm-video-with-context-renderer", y = 120 } = {}) {
  const doc = ctx.win.document;
  const card = doc.createElement(renderer);
  const { link, image } = thumbnail(ctx, { href: "/watch?v=" + id,
    src: "https://i.ytimg.com/vi/" + sourceID + "/hqdefault.jpg", rect: { left: 16, top: y, width: 358, height: 201 } });
  link.id = "thumbnail-link-" + id; image.id = "thumbnail-" + id;
  card.appendChild(link);
  const title = doc.createElement("a"); title.id = "title-" + id; title.href = "/watch?v=" + id;
  const text = doc.createElement("span"); text.id = "title-text-" + id; text.textContent = "Video-Titel";
  title.appendChild(text); card.appendChild(title); doc.body.appendChild(card);
  return { card, link, image, title, text };
}

test("ein Titel-/Textlink nutzt nur das eindeutig zugeordnete Vorschaubild derselben Videokarte", t => {
  const ctx = setup(t, "langformOpenWatch");
  const selected = titledCard(ctx);
  titledCard(ctx, { id: "lmnopqrstuv", y: 420 });
  ctx.win.document.querySelector = ctx.win.document.querySelectorAll = () => assert.fail("Titelöffnung darf nicht den Feed durchsuchen");
  ctx.tap(selected.text.id);
  assert.deepEqual(ctx.bodies, [{ href: "https://m.youtube.com/watch?v=abcdefghijk", sourceRect: {
    x: 16, y: 120, width: 358, height: 201, viewportWidth: 390, viewportHeight: 740,
  } }]);
  assert.equal(ctx.spaClicks(), 0);
});

test("Feed- und Titel-Taps übergeben das bereits geladene echte Still-IMG mit derselben Watch-ID", t => {
  const ctx = setup(t, "langformOpenWatch");
  const first = titledCard(ctx), second = titledCard(ctx, { id: "lmnopqrstuv", y: 420 });
  for (const [card, url] of [[first, "https://i.ytimg.com/vi/abcdefghijk/hq720.jpg?sqp=example"],
                           [second, "https://i.ytimg.com/vi_webp/lmnopqrstuv/hq720.webp"]]) {
    Object.defineProperties(card.image, { currentSrc: { value: url }, complete: { value: true }, naturalWidth: { value: 1280 } });
  }
  ctx.tap(first.image.id); ctx.tap(second.text.id);
  assert.deepEqual(ctx.bodies.map(body => body.sourceThumbnail), [
    { url: "https://i.ytimg.com/vi/abcdefghijk/hq720.jpg?sqp=example", videoID: "abcdefghijk" },
    { url: "https://i.ytimg.com/vi_webp/lmnopqrstuv/hq720.webp", videoID: "lmnopqrstuv" },
  ]);
  assert.equal(ctx.bodies[1].sourceRect.y, 420, "the asset and geometry belong to the same selected card");
  assert.equal(ctx.spaClicks(), 0);
});

test("unfertige, animierte oder fremde Thumbnail-Assets werden nicht an native Bildladung übergeben", t => {
  const ctx = setup(t, "langformOpenWatch"), selected = titledCard(ctx);
  let currentSrc, complete = true, naturalWidth = 1280;
  Object.defineProperties(selected.image, {
    currentSrc: { get: () => currentSrc }, complete: { get: () => complete }, naturalWidth: { get: () => naturalWidth },
  });
  const urls = ["http://i.ytimg.com/vi/abcdefghijk/hq720.jpg", "https://evil.ytimg.com/vi/abcdefghijk/hq720.jpg",
    "https://user@i.ytimg.com/vi/abcdefghijk/hq720.jpg", "https://i.ytimg.com:444/vi/abcdefghijk/hq720.jpg",
    "https://i.ytimg.com/an_webp/abcdefghijk/mqdefault_6s.webp", "https://i.ytimg.com/vi/abcdefghijk/video.mp4",
    "https://i.ytimg.com/vi/lmnopqrstuv/hq720.jpg", "https://i.ytimg.com/vi/abcdefghijk/hq720.webp"];
  for (const url of urls) { currentSrc = url; ctx.tap(selected.text.id); }
  currentSrc = "https://i.ytimg.com/vi/abcdefghijk/hq720.jpg";
  complete = false; ctx.tap(selected.text.id);
  complete = true; naturalWidth = 0; ctx.tap(selected.text.id);
  naturalWidth = 1280; ctx.win.__langformFeedActive = false; ctx.tap(selected.text.id);
  assert.equal(ctx.bodies.length, urls.length + 3, "asset validation never blocks the deliberate Watch intent");
  assert.ok(ctx.bodies.every(body => !body.sourceThumbnail));
});

test("Titelöffnung trennt mehrere Videokarten und verwirft einen uneindeutigen Renderer mit mehreren IDs", t => {
  const ctx = setup(t, "langformOpenWatch");
  const first = titledCard(ctx), second = titledCard(ctx, { id: "lmnopqrstuv", y: 420 });
  ctx.tap(second.title.id);
  assert.equal(ctx.bodies[0].sourceRect.y, 420, "die zweite Karte übernimmt nicht das erste Bild");
  assert.equal(ctx.bodies[0].href, "https://m.youtube.com/watch?v=lmnopqrstuv");
  const foreign = ctx.win.document.createElement("a"); foreign.href = "/watch?v=otherVideo1"; first.card.appendChild(foreign);
  ctx.tap(first.title.id);
  assert.deepEqual(ctx.bodies[1], { href: "https://m.youtube.com/watch?v=abcdefghijk" },
    "ein Renderer mit mehreren eigenen Video-IDs ist keine sichere Thumbnail-Zuordnung");
});

test("Titelöffnung fällt ohne eigenes passendes Thumbnail zurück und übernimmt keine verschachtelte Karte", t => {
  const ctx = setup(t, "langformOpenWatch");
  const wrong = titledCard(ctx, { sourceID: "wrongvideo1" });
  ctx.tap(wrong.title.id);
  assert.deepEqual(ctx.bodies[0], { href: "https://m.youtube.com/watch?v=abcdefghijk" });
  wrong.image.remove();
  const nested = titledCard(ctx, { renderer: "ytm-compact-video-renderer", y: 420 });
  wrong.card.appendChild(nested.card);
  ctx.tap(wrong.title.id);
  assert.deepEqual(ctx.bodies[1], { href: "https://m.youtube.com/watch?v=abcdefghijk" },
    "auch eine verschachtelte Karte mit gleicher ID ist nicht das Vorschaubild des getippten Titels");
  wrong.card.appendChild(nested.image);
  ctx.tap(wrong.title.id);
  assert.deepEqual(ctx.bodies[2], { href: "https://m.youtube.com/watch?v=abcdefghijk" },
    "ein Bild ohne eigenen passenden Watch-Anker ist kein zugeordnetes Video-Thumbnail");
});

test("unsichtbare, ungültige und fremde Bilder liefern keine Video-Startgeometrie", t => {
  for (const options of [
    { rect: { left: 0, top: 725, width: 390, height: 200 } },
    { rect: { left: 0, top: -180, width: 390, height: 200 } },
    { rect: { left: NaN, top: 120, width: 390, height: 200 } },
    { rect: { left: 0, top: 120, width: 0, height: 0 } },
    { src: "https://i.ytimg.com/vi/anotherVideo/hqdefault.jpg" },
    { src: "https://example.com/vi/abcdefghijk/hqdefault.jpg" },
    { src: "https://yt3.ggpht.com/avatar.jpg" },
  ]) {
    const ctx = setup(t, "langformOpenWatch");
    const { image } = thumbnail(ctx, options);
    ctx.tap(image.id);
    assert.deepEqual(ctx.bodies, [{ href: "https://m.youtube.com/watch?v=abcdefghijk" }]);
  }
});

test("Titel, Feed-Tabs, inaktive Feeds und Playernavigation übernehmen kein benachbartes Vorschaubild", t => {
  const ctx = setup(t, { channels: ["langformOpenWatch", "langformNavigateFeed"] });
  const { link, image } = thumbnail(ctx);
  const title = ctx.win.document.createElement("a");
  title.id = "watch-title";
  title.href = link.href;
  link.after(title);
  ctx.tap(title.id);
  ctx.tap("home");
  ctx.win.__langformFeedActive = false;
  ctx.tap(image.id);
  assert.equal(ctx.bodies.length, 3);
  assert.ok(ctx.bodies.every(body => !body.sourceRect));
  ctx.win.history.replaceState({}, "", "/watch?v=oldVideo");
  ctx.win.__langformFeedActive = true;
  ctx.tap(image.id);
  assert.equal(ctx.bodies.length, 3, "Watch-Empfehlungen verbleiben vollständig beim Player");
});

test("Thumbnail-Taps reagieren direkt und geben YouTubes Styles, Scrollen und Klicks unverändert frei", t => {
  const ctx = motionSetup(t);
  const { link, image } = thumbnail(ctx);
  image.style.transform = "translateY(2px)";
  image.style.transition = "opacity 200ms";
  const originalStyle = image.getAttribute("style");
  const down = ctx.pointer("pointerdown", image);
  assert.equal(down.defaultPrevented, false);
  assert.equal(ctx.animations.length, 1);
  const press = ctx.animations[0];
  assert.equal(press.node, image, "nur das Bild, nicht die Karte, wird bewegt");
  assert.equal(press.options.duration, 100);
  assert.equal(press.keyframes[1].scale, ".985");
  assert.equal(link.getAttribute("style"), null);
  const up = ctx.pointer("pointerup", image);
  assert.equal(up.defaultPrevented, false);
  assert.equal(press.cancelled, true);
  assert.equal(ctx.animations.length, 2);
  const release = ctx.animations[1];
  assert.equal(release.options.duration, 180);
  assert.equal(release.keyframes[1].scale, "1");
  release.onfinish();
  assert.equal(release.cancelled, true, "nach der Rückkehr bleibt keine Animation hängen");
  assert.equal(image.getAttribute("style"), originalStyle);
  ctx.tap(image.id);
  assert.equal(ctx.bodies.length, 1);
  assert.equal(ctx.bodies[0].href, link.href);
  assert.equal(ctx.spaClicks(), 0);
});

test("Scrollgesten über 8 Pixel, fremde Pointer und Mehrfinger-Gesten lösen keine Rückfederung aus", t => {
  const ctx = motionSetup(t);
  const { image } = thumbnail(ctx);
  ctx.pointer("pointerdown", image);
  ctx.pointer("pointermove", image, { x: 200, id: 2 });
  assert.equal(ctx.animations[0].cancelled, false, "ein anderer Pointer bewegt die aktive Geste nicht");
  ctx.pointer("pointermove", image, { x: 108 });
  assert.equal(ctx.animations[0].cancelled, false);
  ctx.pointer("pointermove", image, { x: 109 });
  assert.equal(ctx.animations[0].cancelled, true);
  ctx.pointer("pointerup", image);
  assert.equal(ctx.animations.length, 1);
  ctx.pointer("pointerdown", image);
  ctx.pointer("pointerdown", image, { id: 2, primary: false });
  assert.equal(ctx.animations.at(-1).cancelled, true);
  assert.equal(ctx.animations.length, 2);
});

test("Abbruch, Scrollen, Tabwechsel, Navigation, Hintergrund und Reduced Motion räumen Press-Animationen auf", t => {
  for (const trigger of ["pointercancel", "scroll", "blur", "pagehide", "yt-navigate-start", "feed-inactive", "hidden", "real-hidden", "native-inactive", "reduce"]) {
    const ctx = motionSetup(t);
    const { image } = thumbnail(ctx);
    ctx.pointer("pointerdown", image);
    assert.equal(ctx.animations.length, 1);
    if (trigger === "feed-inactive") {
      ctx.win.__langformFeedActive = false;
      ctx.win.dispatchEvent(new ctx.win.Event("langform-feed-visibility"));
    } else if (trigger === "hidden") {
      Object.defineProperty(ctx.win.document, "hidden", { value: true });
      ctx.win.document.dispatchEvent(new ctx.win.Event("visibilitychange"));
    } else if (trigger === "real-hidden" || trigger === "native-inactive") {
      ctx.win.__langformRealVisibility = {hidden:()=>trigger === "real-hidden",inactive:()=>true};
      Object.defineProperty(ctx.win.document,"hidden",{value:false});
      ctx.win.document.dispatchEvent(new ctx.win.Event("langform-real-visibilitychange"));
    } else if (trigger === "reduce") {
      ctx.media.matches = true;
      ctx.media.dispatchEvent(new ctx.win.Event("change"));
    } else {
      ctx.win.dispatchEvent(new ctx.win.Event(trigger));
    }
    ctx.pointer("pointerup", image);
    assert.equal(ctx.animations[0].cancelled, true, trigger);
    assert.equal(ctx.animations.length, 1, trigger + " darf beim Loslassen keine neue Bewegung starten");
  }
});

test("Rückfederung wird beim Verlassen des Feeds ebenfalls abgebrochen und später wieder aktiviert", t => {
  const ctx = motionSetup(t);
  const { image } = thumbnail(ctx);
  ctx.pointer("pointerdown", image);
  ctx.pointer("pointerup", image);
  ctx.win.__langformFeedActive = false;
  ctx.win.dispatchEvent(new ctx.win.Event("langform-feed-visibility"));
  assert.equal(ctx.animations.at(-1).cancelled, true);
  ctx.pointer("pointerdown", image);
  assert.equal(ctx.animations.length, 2);
  ctx.win.__langformFeedActive = true;
  ctx.win.dispatchEvent(new ctx.win.Event("langform-feed-visibility"));
  ctx.pointer("pointerdown", image);
  assert.equal(ctx.animations.length, 3);
  ctx.win.dispatchEvent(new ctx.win.Event("pagehide"));
  ctx.pointer("pointerdown", image);
  assert.equal(ctx.animations.length, 3);
  ctx.win.dispatchEvent(new ctx.win.Event("pageshow"));
  ctx.pointer("pointerdown", image);
  assert.equal(ctx.animations.length, 4);
});

test("Reduced Motion, eigene Oberflächen, vorhandene Scale-Werte und Player bleiben ohne Tap-Bewegung", t => {
  for (const kind of ["reduced", "own", "scale", "player", "inactive", "unsupported", "no-bridge"]) {
    const ctx = motionSetup(t, { reduced: kind === "reduced", channels: kind === "no-bridge" ? [] : undefined,
      url: kind === "player" ? "https://m.youtube.com/watch?v=oldVideo" : undefined });
    const { link, image } = thumbnail(ctx);
    if (kind === "own") link.id = "langform-chapter-link";
    if (kind === "scale") image.style.scale = "1.1";
    if (kind === "inactive") ctx.win.__langformFeedActive = false;
    if (kind === "unsupported") ctx.win.CSS.supports = () => false;
    ctx.pointer("pointerdown", image);
    ctx.pointer("pointerup", image);
    assert.equal(ctx.animations.length, 0, kind);
  }
});

test("nur passende Thumbnails und native Pivot-Tabs bekommen Feedback, ohne Dokumentsuche", t => {
  const ctx = motionSetup(t);
  const { image } = thumbnail(ctx);
  const input = ctx.win.document.createElement("input");
  image.parentNode.appendChild(input);
  ctx.win.document.querySelector = ctx.win.document.querySelectorAll = () => assert.fail("Tap-Feedback darf nicht den Feed durchsuchen");
  ctx.pointer("pointerdown", ctx.win.document.getElementById("channel"));
  ctx.pointer("pointerdown", input);
  assert.equal(ctx.animations.length, 0);
  ctx.pointer("pointerdown", ctx.win.document.getElementById("home"));
  assert.equal(ctx.animations.length, 1);
  assert.equal(ctx.animations[0].node.tagName, "YTM-PIVOT-BAR-ITEM-RENDERER");
  ctx.pointer("pointerup", ctx.win.document.getElementById("home"));
  ctx.pointer("pointerdown", image);
  assert.equal(ctx.animations.at(-1).node, image);
});

test("Touch-Fallback wahrt passive Eingaben und räumt nach Scrollen oder Mehrfachberührung auf", t => {
  const ctx = motionSetup(t, { touchFallback: true });
  const { image } = thumbnail(ctx);
  const point = { identifier: 7, clientX: 100, clientY: 200 };
  const down = ctx.touch("touchstart", image, [point]);
  assert.equal(down.defaultPrevented, false);
  assert.equal(ctx.animations.length, 1);
  ctx.touch("touchend", image, [point]);
  assert.equal(ctx.animations.length, 2);
  ctx.touch("touchstart", image, [point]);
  ctx.touch("touchmove", image, [{ ...point, clientY: 220 }]);
  ctx.touch("touchend", image, [point]);
  assert.equal(ctx.animations.length, 3);
  assert.equal(ctx.animations.at(-1).cancelled, true);
  ctx.touch("touchstart", image, [point]);
  ctx.touch("touchstart", image, [point, { ...point, identifier: 8 }]);
  assert.equal(ctx.animations.length, 4);
  assert.equal(ctx.animations.at(-1).cancelled, true);
});

test("erneutes Drücken während der Rückkehr übernimmt die sichtbare Größe ohne Reset", t => {
  const ctx = motionSetup(t);
  const { image } = thumbnail(ctx);
  const getComputedStyle = ctx.win.getComputedStyle.bind(ctx.win);
  ctx.win.getComputedStyle = node => {
    if (node !== image) return getComputedStyle(node);
    const animated = ctx.animations.some(animation => animation.node === node && !animation.cancelled);
    return { display: "inline", visibility: "visible", opacity: "1", scale: animated ? "0.994" : "none" };
  };
  ctx.pointer("pointerdown", image);
  ctx.pointer("pointerup", image);
  const returning = ctx.animations.at(-1);
  const staleFinish = returning.onfinish;
  ctx.pointer("pointerdown", image);
  const secondPress = ctx.animations.at(-1);
  assert.equal(returning.cancelled, true);
  assert.equal(returning.onfinish, null);
  assert.equal(secondPress.keyframes[0].scale, "0.994");
  staleFinish();
  assert.equal(secondPress.cancelled, false, "ein überholtes Finish beendet den neuen Druck nicht");
  ctx.pointer("pointerup", image);
  ctx.animations.at(-1).onfinish();
  assert.ok(ctx.animations.every(animation => animation.cancelled));
  assert.equal(image.getAttribute("style"), null);
});

test("ein neuer Druck auf ein anderes Thumbnail übernimmt keine fremde Restskalierung", t => {
  const ctx = motionSetup(t);
  const first = thumbnail(ctx).image;
  const second = thumbnail(ctx).image;
  ctx.pointer("pointerdown", first);
  ctx.pointer("pointerup", first);
  ctx.pointer("pointerdown", second);
  assert.equal(ctx.animations.at(-1).node, second);
  assert.equal(ctx.animations.at(-1).keyframes[0].scale, "1");
  assert.ok(ctx.animations.slice(0, -1).every(animation => animation.cancelled));
});
