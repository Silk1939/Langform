const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const app = path.join(__dirname, '../ios/Langform/Langform');
const links = fs.readFileSync(path.join(app, 'WebViewLinks.js'), 'utf8');
const motion = fs.readFileSync(path.join(app, 'CommentsMotion.js'), 'utf8');
const commentsID = 'engagement-panel-comments-section';
const shell = `<div class="engagement-panel-section-list-background at-top">
 <div class="engagement-panel-container"><div class="engagement-panel-section-list-header-wrapper"></div>
 <div class="engagement-panel-content-wrapper"><div class="spinner"></div></div></div></div>`;
// Actual content evidence stays distinct from the outer panel identifier.
// An identifier/class alone must not stop the deep lazy-hydration observer.
const hydrated = `<ytm-engagement-panel-section-list-renderer class="engagement-panel-comments-section">
 <div class="engagement-panel-section-list-background at-top"><div class="engagement-panel-container">
 <div class="engagement-panel-section-list-header-wrapper"><ytm-button-renderer class="engagement-panel-section-list-header-button close-button"><button>Close</button></ytm-button-renderer></div>
 <div class="engagement-panel-content-wrapper"><ytm-comments-header-renderer></ytm-comments-header-renderer></div>
 </div></div></ytm-engagement-panel-section-list-renderer>`;

function setup(t) {
 const dom = new JSDOM('<!doctype html><html><body><div id="movie_player"><video></video></div><panel-container></panel-container></body></html>', {
  url: 'https://m.youtube.com/watch?v=abcdefghijk', runScripts: 'outside-only',
 });
 t.after(() => dom.window.close());
 const win = dom.window, doc = win.document, animations = [], traces = [], errors = [];
 win.addEventListener('error', event => { errors.push(event.message); event.preventDefault(); });
 t.after(() => assert.deepEqual(errors, [], 'shipping handlers do not throw on supplied schemas'));
 win.CSS = { supports: () => true };
 win.matchMedia = () => ({ matches: false, addEventListener() {} });
 win.visualViewport = new win.EventTarget();
 win.webkit = { messageHandlers: { langformPlayer: { postMessage() {} }, langformOverlayState: { postMessage() {} } } };
 Object.defineProperty(win, 'innerHeight', { value: 874 });
 win.Element.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 274, left: 0, top: 274, right: 402, bottom: 874, width: 402, height: 600 };
 };
 win.Element.prototype.animate = function (frames, timing) {
  const animation = { node: this, frames: structuredClone(frames), timing, currentTime: 0, playbackRate: 1,
   playState: 'running', startTime: null, cancelled: false, onfinish: null,
   effect: { getTiming: () => timing, getComputedTiming: () => ({ progress: .25 }) },
   cancel() { this.cancelled = true; this.playState = 'idle'; },
   updatePlaybackRate(rate) { this.playbackRate = rate; },
   finish() { this.currentTime = timing.duration; this.playState = 'finished'; this.onfinish?.(); },
  };
  animations.push(animation); return animation;
 };
 win.__langformCommentsGestureTrace = value => traces.push(value);
 win.eval(links); win.eval(motion);
 return { win, doc, animations, traces,
  event(detail) { win.dispatchEvent(new win.CustomEvent('engagement-panel-push', { detail })); },
  mount(markup = shell) { const panel=doc.createElement('ytm-engagement-panel');panel.innerHTML=markup;doc.querySelector('panel-container').appendChild(panel);return panel; },
  async flush() { for (let i=0;i<8;i++) await Promise.resolve(); },
 };
}
function renderer(panelIdentifier = commentsID) { return { engagementPanelSectionListRenderer: { panelIdentifier } }; }

test('direct typed panel payload starts its lazy shell before hydration and keeps the playhead', async t => {
 const env=setup(t);
 env.event({ identifier: commentsID, ...renderer() });
 const panel=env.mount();await env.flush();
 assert.equal(env.animations.length,1,'the loading shell owns the first entrance');
 const first=env.animations[0];first.currentTime=96;
 panel.innerHTML=hydrated;await env.flush();
 assert.equal(env.animations.length,2,'hydrated surface inherits the ongoing entrance');
 assert.equal(first.cancelled,true);assert.equal(env.animations[1].currentTime,96);
 assert.equal(env.animations[1].node,panel.querySelector('.engagement-panel-container'));
 assert.equal(env.traces.filter(value=>value.phase==='entrance').length,1,'hydration cannot start another entrance');
});

test('a renamed first-level typed payload animates before the site mounts and transfers a replaced lazy surface', async t => {
 const env=setup(t);let panel;
 env.win.addEventListener('engagement-panel-push',()=>{panel=env.mount();});
 env.event({ identifier: commentsID, changedPublicSlot: renderer() });await env.flush();
 assert.equal(env.animations.length,1,'capture must classify before the original mount handler');
 const first=env.animations[0];first.currentTime=122;
 panel.innerHTML=hydrated;await env.flush();
 assert.equal(env.animations.length,2);assert.equal(first.cancelled,true);
 assert.equal(env.animations[1].currentTime,122,'new renderer retains the existing playhead');
 assert.equal(env.traces.find(value=>value.phase==='panel-intent').reason,'comments');
});

test('first-level foreign panel payloads retain queue order without borrowing the comments entrance', async t => {
 const env=setup(t);
 env.event({ identifier:'playlist', renamed:renderer('engagement-panel-playlist') });
 env.event({ identifier:commentsID, renamed:renderer() });
 const foreign=env.mount(),comments=env.mount();await env.flush();
 assert.equal(env.animations.length,1);
 assert.equal(env.animations[0].node,comments.querySelector('.engagement-panel-container'));
 assert.equal(foreign.hasAttribute('data-langform-comments-sheet'),false);
 assert.deepEqual(env.traces.filter(value=>value.phase==='panel-intent').map(value=>value.reason),['other','comments']);
});

test('an unknown populated shell does not replay entrance when real comments arrive much later', async t => {
 const env=setup(t);
 env.event({ identifier:commentsID, unrelated:{ panelIdentifier:commentsID } });
 const panel=env.mount();await env.flush();assert.equal(env.animations.length,0);
 panel.innerHTML=hydrated;await env.flush();
 assert.equal(env.animations.length,0,'already drawn shell remains readable when classified late');
 assert.equal(panel.hasAttribute('data-langform-comments-sheet'),true,'verified content still receives controls');
 assert.equal(env.traces[0].reason,'unknown');
});

test('the schema scan stops before a seventeenth first-level object slot', async t => {
 const env=setup(t),detail={identifier:commentsID};
 for(let index=0;index<17;index++)detail['filler'+index]={type:'unrelated'};
 detail.afterBound=renderer();
 env.event(detail);env.mount();await env.flush();
 assert.equal(env.animations.length,0);assert.equal(env.traces[0].reason,'unknown');
});

for(const [name,detail] of [
 ['a deeper matching renderer',{identifier:commentsID,renamed:{nested:renderer()}}],
 ['a different renderer key',{identifier:commentsID,renamed:{differentRenderer:{panelIdentifier:commentsID}}}],
 ['an inherited first-level slot',Object.assign(Object.create({inherited:renderer()}),{identifier:commentsID})],
 ['a non-string typed panel identifier',{identifier:commentsID,renamed:{engagementPanelSectionListRenderer:{panelIdentifier:{toString:()=>commentsID}}}}],
])test(name+' cannot classify a newly mounted lazy shell as comments',async t=>{
 const env=setup(t);env.event(detail);env.mount();await env.flush();
 assert.equal(env.animations.length,0);
});

for(const [name,identifier] of [['numeric',7],['object identity',{}],['undefined',undefined]])test('pending panel pop preserves '+name+' identifier equality',async t=>{
 const env=setup(t);
 env.event({identifier,renamed:renderer()});
 env.win.dispatchEvent(new env.win.CustomEvent('engagement-panel-pop',{detail:{identifier}}));
 env.event({identifier:'playlist',renamed:renderer('engagement-panel-playlist')});
 const foreign=env.mount();await env.flush();
 assert.equal(env.animations.length,0,'a matching pop revokes the pending comment intent before a foreign panel mounts');
 assert.equal(foreign.hasAttribute('data-langform-comments-sheet'),false);
});
