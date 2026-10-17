const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const skip = require('../extension/src/ad-skip.js');
const ads = require('../extension/src/ads.js');

const settle = () => new Promise(resolve => setTimeout(resolve, 15));
function page(t, inner = '<button class="ytp-skip-ad-button" disabled>Überspringen</button>', ad = true) {
  const dom = new JSDOM(`<!doctype html><body><div id="movie_player" class="html5-video-player ${ad ? 'ad-showing' : ''}"><video src="blob:https://www.youtube.com/ad"></video><div class="video-ads ytp-ad-module">${inner}</div></div>`, { url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  const win = dom.window, doc = win.document, player = doc.getElementById('movie_player'), video = doc.querySelector('video');
  t.after(() => win.close());
  let clicks = 0;
  player.addEventListener('click', event => { if (event.target.closest('button, [role=button]')) clicks++; });
  let time = 2;
  const writes = [];
  Object.defineProperty(video, 'currentTime', { get: () => time, set: n => { writes.push(n); time = n; } });
  Object.defineProperty(video, 'duration', { get: () => 6.041 });
  video.play = () => assert.fail('Skip must not play');
  video.pause = () => assert.fail('Skip must not pause');
  player.seekTo = () => assert.fail('Skip must not seek');
  video.playbackRate = 2;
  return { win, doc, player, video, writes, clicks: () => clicks, button: () => doc.querySelector('button, [role=button]') };
}

test('an already-present disabled Skip is clicked exactly once when enabled, without a media event', async t => {
  const p = page(t); skip.install(p.win); await settle(); assert.equal(p.clicks(), 0);
  p.button().disabled = false; await settle(); assert.equal(p.clicks(), 1);
  p.button().firstChild.data = 'Skip ad'; await settle(); assert.equal(p.clicks(), 1);
  assert.deepEqual(p.writes, []); assert.equal(p.video.currentTime, 2); assert.equal(p.video.playbackRate, 2);
});

for (const [attribute, value] of [['aria-disabled', 'true'], ['hidden', ''], ['inert', '']]) {
  test(`${attribute} on an ancestor defers the original Skip until that restriction is removed`, async t => {
    const p = page(t, `<div ${attribute}="${value}"><button class="ytp-ad-skip-button">Skip ad</button></div>`);
    skip.install(p.win); await settle(); assert.equal(p.clicks(), 0);
    p.button().parentElement.removeAttribute(attribute); await settle(); assert.equal(p.clicks(), 1);
  });
}

for (const html of [
  '<div class="ytp-ad-skip-button-modern"><button>Überspringen</button></div>',
  '<ytm-ad-skip-button-renderer><button>Skip ad</button></ytm-ad-skip-button-renderer>',
  '<div class="ytp-ad-skip-button-slot"><span><button role="button">Skip</button></span></div>',
  '<div class="ytp-ad-player-overlay"><button aria-label="Werbung überspringen">→</button></div>'
]) test('modern/mobile controls invoke their actual nested button', async t => {
  const p = page(t, html); let original = 0; p.button().addEventListener('click', () => original++);
  skip.install(p.win); await settle(); assert.equal(original, 1); assert.equal(p.clicks(), 1); assert.deepEqual(p.writes, []);
});

test('fallback observes a text-node countdown becoming Skip', async t => {
  const p = page(t, '<button>5</button>'); skip.install(p.win); await settle(); assert.equal(p.clicks(), 0);
  p.button().firstChild.data = 'Überspringen'; await settle(); assert.equal(p.clicks(), 1);
});

test('modern wrappers with an old hidden button still invoke the current visible control', async t => {
  const p = page(t, '<div class="ytp-ad-skip-button-modern"><button hidden>Old</button><button id="current">→</button></div>');
  let current = 0; p.doc.getElementById('current').onclick = () => current++;
  skip.install(p.win); ads.install(p.win); await settle(); assert.equal(current, 1); assert.equal(p.clicks(), 1);
});

test('a control can explicitly enable pointer events within a pointer-transparent overlay', async t => {
  const p = page(t, '<div style="pointer-events:none"><button class="ytp-skip-ad-button" style="pointer-events:auto">Skip ad</button></div>');
  skip.install(p.win); await settle(); assert.equal(p.clicks(), 1);
});

test('a visible noninteractive ad badge still identifies an ad without the player class', async t => {
  const p = page(t, '<span class="ytp-ad-simple-ad-badge" style="pointer-events:none">Ad</span><button class="ytp-next-skip-ad-button" disabled>Skip</button>', false);
  skip.install(p.win); await settle(); assert.equal(p.clicks(), 0);
  p.button().disabled = false; await settle(); assert.equal(p.clicks(), 1);
});

test('no ad and unrelated buttons are never clicked', async t => {
  const normal = page(t, '<button class="ytp-skip-ad-button">Skip</button>', false);
  skip.install(normal.win); await settle(); assert.equal(normal.clicks(), 0);
  const ad = page(t, '<button>Weiter</button>'); ad.player.insertAdjacentHTML('beforeend', '<button id="outside">Skip ad</button>');
  skip.install(ad.win); await settle(); assert.equal(ad.clicks(), 0);
  ad.player.classList.remove('ad-showing'); ad.doc.querySelector('.video-ads').textContent = 'Skip ad';
  await settle(); assert.equal(ad.clicks(), 0);
});

test('existing ads.js and the observer deliver one original click and retain MSE protection', async t => {
  const p = page(t); skip.install(p.win); ads.install(p.win); await settle();
  assert.equal(p.clicks(), 0); assert.equal(p.video.muted, true); assert.deepEqual(p.writes, []);
  p.button().disabled = false; await settle(); assert.equal(p.clicks(), 1);
  p.video.dispatchEvent(new p.win.Event('playing', { bubbles: true })); await settle(); assert.equal(p.clicks(), 1);
  p.player.classList.remove('ad-showing'); await settle(); assert.equal(p.video.muted, false);
  assert.equal(p.video.currentTime, 2); assert.equal(p.video.playbackRate, 2); assert.deepEqual(p.writes, []);
});

test('a failed automatic click leaves the original button usable after the short duplicate guard', async t => {
  const p = page(t, '<button class="ytp-skip-ad-button">Skip ad</button>'); let now = 1;
  p.win.performance.now = () => now; skip.install(p.win); assert.equal(p.clicks(), 1);
  now = 701; p.button().click(); assert.equal(p.clicks(), 2);
});

test('new ad source and next ad each have their own original Skip action', async t => {
  const p = page(t, '<button class="ytp-skip-ad-button">Skip ad</button>'); skip.install(p.win); assert.equal(p.clicks(), 1);
  p.video.setAttribute('src', 'blob:https://www.youtube.com/ad-2');
  p.video.dispatchEvent(new p.win.Event('loadedmetadata', { bubbles: true })); assert.equal(p.clicks(), 2);
  p.player.classList.remove('ad-showing'); await settle(); p.player.classList.add('ad-showing'); await settle(); assert.equal(p.clicks(), 3);
});

test('pagehide disconnects, pageshow reconnects, and repeated install adds no duplicate click', async t => {
  const p = page(t); skip.install(p.win); skip.install(p.win); await settle();
  p.win.dispatchEvent(new p.win.PageTransitionEvent('pagehide')); await settle();
  p.button().disabled = false; await settle(); assert.equal(p.clicks(), 0);
  p.win.dispatchEvent(new p.win.PageTransitionEvent('pageshow')); await settle(); assert.equal(p.clicks(), 1);
  p.win.dispatchEvent(new p.win.Event('yt-navigate-finish')); await settle(); assert.equal(p.clicks(), 1);
});

test('legacy synthetic Skip clicks cannot run on an inactive page', async t => {
  const p = page(t); skip.install(p.win); ads.install(p.win); await settle();
  p.win.dispatchEvent(new p.win.PageTransitionEvent('pagehide'));
  p.button().disabled = false; ads.handle(p.win); await settle(); assert.equal(p.clicks(), 0);
  p.win.dispatchEvent(new p.win.PageTransitionEvent('pageshow')); await settle(); assert.equal(p.clicks(), 1);
});

test('a late player and a navigation replacement are discovered without polling', async t => {
  const p = page(t); const old = p.player; old.remove(); skip.install(p.win);
  p.doc.body.appendChild(old); p.button().disabled = false; await settle(); assert.equal(p.clicks(), 1);
  const next = old.cloneNode(true); let nextClicks = 0; next.querySelector('button').addEventListener('click', () => nextClicks++);
  old.replaceWith(next); p.win.dispatchEvent(new p.win.Event('yt-navigate-finish')); await settle(); assert.equal(nextClicks, 1);
  old.querySelector('button').click(); assert.equal(nextClicks, 1);
});

test('browser companion stays event driven and is limited to YouTube', t => {
  const source = fs.readFileSync(require.resolve('../extension/src/ad-skip.js'), 'utf8');
  assert.doesNotMatch(source, /setInterval|setTimeout|requestAnimationFrame|\.currentTime\s*=|\.playbackRate\s*=/);
  const dom = new JSDOM('<div id="movie_player" class="ad-showing"><button class="ytp-skip-ad-button">Skip</button></div>', { url: 'https://example.com/' });
  t.after(() => dom.window.close()); let clicks = 0; dom.window.document.querySelector('button').onclick = () => clicks++;
  skip.install(dom.window); assert.equal(clicks, 0);
});
