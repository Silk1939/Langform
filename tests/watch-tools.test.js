const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require('node:path').join(__dirname, '../ios/Langform/Langform/WatchTools.js'), 'utf8');
function fixture(t, options = {}) {
  const dom = new JSDOM(options.html || '<div id="movie_player"><video></video><button>UT</button></div><ytm-slim-video-metadata-section-renderer><h1>Titel</h1><button>Mag ich</button></ytm-slim-video-metadata-section-renderer>', { url: options.url || 'https://m.youtube.com/watch?v=abcdefghijk', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const win = dom.window, posts = [], timers = new Map(); let next = 0;
  const state = { enabled: false, status: 'off', canUndo: false };
  win.setTimeout = (fn, delay) => { timers.set(++next, { fn, delay }); return next; };
  win.clearTimeout = id => timers.delete(id);
  win.webkit = { messageHandlers: { langformDownloads: { postMessage: body => posts.push(body) } } };
  let retries = 0, undos = 0;
  const update = values => { Object.assign(state, values); win.dispatchEvent(new win.CustomEvent('langform-sponsorblock-state', { detail: state })); };
  win.__langformSponsorBlock = { getStatus: () => state, setEnabled: enabled => update({ enabled, status: enabled ? 'loading' : 'off' }), undo: () => { undos++; update({ canUndo: false }); }, retry: () => { retries++; update({ status: 'loading' }); } };
  win.eval(source); win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  return { win, posts, timers, state, update, get retries() { return retries; }, get undos() { return undos; }, row: () => win.document.getElementById('langform-watch-tools'), click: label => win.document.querySelector(`[aria-label="${label}"]`).click() };
}
test('Watchwerkzeuge sitzen bei Metadaten im Dokumentfluss und verändern Originalcontrols nicht', t => {
  const env = fixture(t);
  assert.equal(env.row().parentElement.tagName, 'YTM-SLIM-VIDEO-METADATA-SECTION-RENDERER');
  assert.equal(env.win.document.querySelector('#movie_player').innerHTML, '<video></video><button>UT</button>');
  assert.equal(env.row().querySelector('button').textContent, 'Downloads');
  const style = env.win.document.getElementById('langform-watch-tools-style').textContent;
  assert.doesNotMatch(style, /position\s*:\s*(fixed|absolute)|z-index/);
  assert.match(style, /flex-wrap:wrap/);
});
test('Schnelle Downloadtips ergeben eine Anfrage und der Abschluss gibt den Button wieder frei', t => {
  const env = fixture(t);
  env.click('Downloads öffnen'); env.click('Downloads öffnen'); env.click('Downloads öffnen');
  assert.equal(env.posts.length, 1);
  assert.equal(env.posts[0].videoID, 'abcdefghijk');
  assert.equal(env.row().querySelector('button').disabled, true);
  env.win.__langformSetDownloadLoading(false);
  env.click('Downloads öffnen'); assert.equal(env.posts.length, 2);
});
test('Werkzeuge folgen Videowechsel und Ersatzrenderer ohne doppelte Zeilen', t => {
  const env = fixture(t);
  env.click('Downloads öffnen');
  env.win.history.pushState({}, '', '/watch?v=zzzzzzzzzzz');
  const replacement = env.win.document.createElement('ytm-slim-video-metadata-section-renderer');
  env.row().parentElement.replaceWith(replacement);
  env.win.dispatchEvent(new env.win.Event('yt-navigate-finish'));
  env.win.dispatchEvent(new env.win.Event('yt-navigate-finish'));
  assert.equal(env.row().parentElement, replacement);
  assert.equal(env.win.document.querySelectorAll('#langform-watch-tools').length, 1);
  env.click('Downloads öffnen'); assert.equal(env.posts[1].videoID, 'zzzzzzzzzzz');
  env.win.history.pushState({}, '', '/results?search_query=NASA');
  env.win.dispatchEvent(new env.win.Event('yt-navigate-finish'));
  assert.equal(env.row(), null);
});
test('SponsorBlock-Schalter zeigt Loading, leere Daten, Fehler, Retry und Rücknahme erreichbar an', t => {
  const env = fixture(t);
  env.click('SponsorBlock umschalten');
  assert.equal(env.state.enabled, true);
  assert.match(env.row().textContent, /werden geladen/);
  env.update({ status: 'empty' }); assert.match(env.row().textContent, /keine Sponsorsegmente/);
  env.update({ status: 'unavailable' });
  const retry = [...env.row().querySelectorAll('button')].find(b => b.textContent === 'SponsorBlock erneut laden');
  assert.equal(retry.hidden, false); retry.click(); assert.equal(env.retries, 1);
  env.update({ status: 'ready', canUndo: true });
  const undo = [...env.row().querySelectorAll('button')].find(b => b.textContent === 'Überspringen rückgängig');
  assert.equal(undo.hidden, false); undo.click(); assert.equal(env.undos, 1); assert.equal(undo.hidden, true);
  env.click('SponsorBlock umschalten'); assert.equal(env.state.enabled, false);
});
test('Späte Hydration bleibt begrenzt und mountet erst außerhalb des Players', t => {
  const env = fixture(t, { html: '<div id="movie_player"><ytm-slim-video-metadata-section-renderer></ytm-slim-video-metadata-section-renderer></div>' });
  assert.equal(env.row(), null);
  let count = 0;
  while (env.timers.size) { const [id, item] = env.timers.entries().next().value; env.timers.delete(id); item.fn(); count++; }
  assert.equal(count, 5);
  env.win.document.querySelector('#movie_player').after(env.win.document.createElement('ytd-watch-metadata'));
  env.win.document.querySelector('ytm-slim-video-metadata-section-renderer').remove();
  env.win.dispatchEvent(new env.win.Event('yt-navigate-finish'));
  assert.equal(env.row().parentElement.tagName, 'YTD-WATCH-METADATA');
});
test('Hydration nach abgeschlossener Navigation stellt entfernte Werkzeuge ohne nächstes SPA-Event wieder her', async t => {
  const env = fixture(t);
  const metadata = env.row().parentElement;
  metadata.replaceChildren(env.win.document.createElement('h1'));
  await Promise.resolve();
  for (const [id, item] of [...env.timers]) { env.timers.delete(id); item.fn(); }
  assert.equal(env.row().parentElement, metadata);
  assert.equal(env.win.document.querySelectorAll('#langform-watch-tools').length, 1);
  await Promise.resolve();
  assert.equal(env.timers.size, 0, 'Eigenes Einhängen erzeugt keinen Observerloop');
});
test('Metadaten nach Retryfenster werden noch erreichbar, gewöhnliche Playerupdates planen keine Arbeit', async t => {
  const env = fixture(t, { html: '<div id="movie_player"><video></video></div>' });
  while (env.timers.size) { const [id, item] = env.timers.entries().next().value; env.timers.delete(id); item.fn(); }
  const metadata = env.win.document.createElement('ytm-slim-video-metadata-section-renderer');
  env.win.document.body.appendChild(metadata);
  await Promise.resolve();
  for (const [id, item] of [...env.timers]) { env.timers.delete(id); item.fn(); }
  assert.equal(env.row().parentElement, metadata);
  await Promise.resolve();
  env.win.document.querySelector('#movie_player').appendChild(env.win.document.createElement('div'));
  await Promise.resolve();
  assert.equal(env.timers.size, 0);
});
