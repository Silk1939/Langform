const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/ViewportLayout.js'), 'utf8');
function page(t, route='/', modern=false) {
  const dom = new JSDOM(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>
  ytm-mobile-topbar-renderer,.ytTopBarViewModelHost {position:fixed;top:-48px;transform:translateY(-48px);background:transparent;z-index:4}
  header.mobile-topbar-header {position:relative;height:48px;background:transparent}
  </style></head><body><ytm-app>${modern ? '<div class="ytTopBarViewModelHost out"><button id="search">Suche</button></div>' : '<ytm-mobile-topbar-renderer class="out"><header class="mobile-topbar-header"><button id="search">Suche</button></header></ytm-mobile-topbar-renderer>'}<div id="feed">Feedinhalt</div></ytm-app></body></html>`, {url:'https://m.youtube.com'+route,runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const win=dom.window,doc=win.document;
  win.__langformStageInsets={top:59,right:0,bottom:34,left:0,nativeMini:false};
  win.eval(source);
  return {win,doc,cover:()=>doc.querySelector('#langform-feed-safe-top-cover'),header:()=>doc.querySelector(modern?'.ytTopBarViewModelHost':'ytm-mobile-topbar-renderer'),css:node=>win.getComputedStyle(node),event:name=>win.dispatchEvent(new win.Event(name)),async flush(){for(let i=0;i<8;i++)await Promise.resolve();},stage(patch){win.__langformSetStageInsets({top:59,right:0,bottom:34,left:0,nativeMini:false,...patch});}};
}
for(const route of ['/','/feed/subscriptions','/feed/you','/feed/library','/results?search_query=test']) {
  test('Feedstatusleiste ist deckend und Header bleibt auch .out fest: '+route,async t=>{
    const p=page(t,route);await p.flush();assert.ok(p.cover());
    const c=p.css(p.cover());assert.equal(c.position,'fixed');assert.equal(c.top,'0px');assert.equal(c.height,'var(--lf-safe-top)');assert.equal(c.backgroundColor,'rgb(0, 0, 0)');assert.equal(c.pointerEvents,'none');
    assert.equal(p.cover().parentElement,p.doc.documentElement,'no transformed header ancestor');assert.equal(p.cover().getAttribute('aria-hidden'),'true');
    assert.equal(p.css(p.header()).top,'var(--lf-safe-top)');assert.equal(p.css(p.header()).transform,'none');assert.equal(p.css(p.header()).backgroundColor,'rgb(0, 0, 0)');
    let clicks=0;p.doc.querySelector('#search').addEventListener('click',()=>clicks++);p.doc.querySelector('#search').click();assert.equal(clicks,1);
  });
}
test('Moderner mobiler Header bleibt nach Out/Hydration erreichbar und erhält keine doppelte SafeArea',async t=>{
 const p=page(t,'/',true);await p.flush();assert.ok(p.cover());assert.equal(p.css(p.header()).top,'var(--lf-safe-top)');
 p.header().outerHTML='<div class="ytTopBarViewModelHost out" style="height:48px"><button id="search">Neu</button></div>';await p.flush();
 assert.equal(p.css(p.header()).top,'var(--lf-safe-top)');assert.equal(p.css(p.header()).height,'48px');assert.equal(p.doc.querySelectorAll('#langform-feed-safe-top-cover').length,1);
});
test('FeedSafeTop bleibt mit Mini, reagiert auf Rotation und wird in Fullscreen freigegeben',async t=>{
 const p=page(t);await p.flush();p.stage({nativeMini:true});await p.flush();assert.ok(p.cover());
 p.doc.documentElement.setAttribute('data-langform-fullscreen','');await p.flush();assert.equal(p.cover(),null);
 p.doc.documentElement.removeAttribute('data-langform-fullscreen');await p.flush();assert.ok(p.cover());
 p.stage({top:0,left:59,right:59,bottom:21});await p.flush();assert.equal(p.cover(),null);assert.equal(p.doc.documentElement.style.getPropertyValue('--lf-native-safe-top'),'0px');
 p.stage({top:59});await p.flush();assert.ok(p.cover());
});
test('FeedSafeTop räumt bei Watch, Konto, Shorts und BFCache die eigene Deckfläche ab',async t=>{
 const p=page(t);await p.flush();assert.ok(p.cover());
 for(const route of ['/watch?v=abcdefghijk','/shorts/abcdefghijk','/account','/playables/abc']) {
  p.event('yt-navigate-start');assert.equal(p.cover(),null);p.win.history.replaceState({},'',route);p.event('yt-navigate-finish');await p.flush();assert.equal(p.cover(),null);assert.equal(p.doc.documentElement.hasAttribute('data-langform-feed-header'),false);
 }
 p.win.history.replaceState({},'','/feed/you');p.event('popstate');await p.flush();assert.ok(p.cover());
 p.event('pagehide');await p.flush();assert.equal(p.cover(),null);p.event('pageshow');await p.flush();assert.equal(p.doc.querySelectorAll('#langform-feed-safe-top-cover').length,1);
});
test('FeedSafeTop überschreibt keine fremde DOM-ID und ändert weder Scroll noch Medien',async t=>{
 const p=page(t);await p.flush();p.event('pagehide');p.doc.documentElement.insertAdjacentHTML('beforeend','<span id="langform-feed-safe-top-cover">Autor</span>');p.event('pageshow');await p.flush();
 assert.equal(p.doc.querySelectorAll('#langform-feed-safe-top-cover').length,1);assert.equal(p.cover().textContent,'Autor');assert.equal(p.doc.querySelector('#feed').textContent,'Feedinhalt');
});
