const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const file = path.join(__dirname, '../ios/Langform/Langform/CaptionToggle.js');
const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

function page(t, options = {}) {
  const dom = new JSDOM('<ytm-player><div id="movie_player"><video></video><div class="captions"></div></div><ytm-watch-player-controls><yt-closed-captions-toggle-button><ytm-closed-captioning-button><button aria-pressed="false" aria-label="Untertitel"><svg><path/></svg></button></ytm-closed-captioning-button></yt-closed-captions-toggle-button></ytm-watch-player-controls></ytm-player><button id="other">Untertitel</button>', { url: 'https://m.youtube.com/watch?v=abcdefghijk', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const win = dom.window, root = win.document.getElementById('movie_player');
  const button = win.document.querySelector('ytm-closed-captioning-button button');
  let enabled = !!options.enabled, playerID = 'abcdefghijk', original = 0;
  const calls = [], track = { languageCode: 'tr', displayName: 'Türkisch' };
  function render() { root.querySelector('.captions').innerHTML = enabled ? '<div class="caption-window">Ein echter Untertitel</div>' : ''; }
  render();
  root.getVideoData = () => ({ video_id: playerID, isAd: options.ad });
  root.getOptions = () => options.noTracks ? [] : ['track', 'tracklist'];
  root.isSubtitlesOn = () => enabled;
  root.getOption = (_, key) => key === 'tracklist' ? [track] : enabled ? track : {};
  root.toggleSubtitles = initiated => { calls.push(initiated); if (options.throwBefore) throw Error('unsupported'); enabled = !enabled; render(); if (options.throwAfter) throw Error('after mutation'); };
  if (options.unsupported) delete root.toggleSubtitles;
  // Reproduce the reported only-on behavior and stale UI. This handler never
  // disables the actual renderer, even if its aria-pressed flag says otherwise.
  button.onclick = () => { original++; enabled = true; render(); };
  win.eval(source);
  return { win, root, button, calls, track, enabled: () => enabled, original: () => original,
    id: value => { playerID = value; }, click: () => button.querySelector('path').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) };
}

test('UT schaltet tatsächliche Untertitel mehrfach ein und aus, trotz stale aria-pressed', t => {
  const p = page(t);
  for (const expected of [true, false, true, false]) { p.click(); assert.equal(p.enabled(), expected); assert.equal(!!p.root.querySelector('.caption-window'), expected); }
  assert.deepEqual(p.calls, [true, true, true, true]); assert.equal(p.original(), 0);
});
test('bereits aktive Untertitel werden beim ersten Tipp ausgeschaltet', t => { const p=page(t,{enabled:true});p.click();assert.equal(p.enabled(),false); });
test('schnelle Doppeltipps erzeugen genau zwei Wechsel', t => { const p=page(t);p.click();p.click();assert.equal(p.enabled(),false);assert.equal(p.calls.length,2); });
test('Sprachauswahl bleibt beim Ausschalten und erneuten Einschalten erhalten', t => { const p=page(t,{enabled:true});p.click();p.click();assert.equal(p.root.getOption('captions','track'),p.track); });
test('fremdes Video und Werbung werden nicht über das Player-API geschaltet', t => {
  for (const options of [{}, {ad:true}]) { const p=page(t,options);if(!options.ad)p.id('other-video');p.click();assert.equal(p.calls.length,0);assert.equal(p.original(),1); }
});
test('fehlende API und fehlende Untertitel behalten die Originalbedienung', t => {
  for (const options of [{unsupported:true},{noTracks:true},{throwBefore:true}]) { const p=page(t,options);p.click();assert.equal(p.original(),1);assert.equal(p.enabled(),true); }
});
test('Ausnahme nach Zustandswechsel löst keinen zweiten Originalbefehl aus', t => { const p=page(t,{enabled:true,throwAfter:true});p.click();assert.equal(p.enabled(),false);assert.equal(p.original(),0); });
test('andere Buttons und deaktivierte UT-Steuerung bleiben unberührt', t => {
  const p=page(t);p.win.document.getElementById('other').click();p.button.setAttribute('aria-disabled','true');p.click();assert.deepEqual(p.calls,[]);assert.equal(p.original(),1);
});
test('SPA-Videowechsel verwendet nur die neue Playeridentität', t => {
  const p=page(t);p.win.history.replaceState({},'', '/watch?v=zyxwvutsrqp');p.click();assert.deepEqual(p.calls,[]);p.id('zyxwvutsrqp');p.click();assert.equal(p.calls.length,1);
});
test('pagehide beendet Eingriffe, pageshow stellt sie einmal wieder her', t => {
  const p=page(t);p.win.dispatchEvent(new p.win.PageTransitionEvent('pagehide'));p.click();assert.equal(p.calls.length,0);p.win.dispatchEvent(new p.win.PageTransitionEvent('pageshow'));p.win.eval(source);p.click();assert.equal(p.calls.length,1);assert.equal(p.enabled(),false);
});
test('aktuelle mobile DIV-Container und getrennte Custom-Controls teilen dieselbe Playerzugehörigkeit', t => {
  const p=page(t), owner=p.root.parentElement;
  const container=p.win.document.createElement('div');container.id='player-container-id';
  container.innerHTML='<div id="player"></div><div id="player-control-container"><ytm-custom-control></ytm-custom-control></div>';
  container.querySelector('#player').appendChild(p.root);
  container.querySelector('ytm-custom-control').appendChild(owner.querySelector('ytm-watch-player-controls'));
  owner.replaceWith(container);
  p.click();p.click();assert.equal(p.enabled(),false);assert.equal(p.calls.length,2);assert.equal(p.original(),0);
});
