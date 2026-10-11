const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const all = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/WebViewLinks.js'), 'utf8');
const start = all.indexOf('(function (win) {');
const source = all.slice(start, all.indexOf('\n(function (win) {', start + 1));

function page(t, { host = 'm.youtube.com', native = true, html = '' } = {}) {
  const dom = new JSDOM('<!doctype html><head></head><body>' + html, {
    url: 'https://' + host + '/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const win = dom.window;
  if (native) win.webkit = { messageHandlers: { langformOpenWatch: { postMessage() {} } } };
  t.after(() => { win.dispatchEvent(new win.Event('pagehide')); win.close(); });
  win.eval(source);
  return { win, doc: win.document, async flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); },
    click(node, options = {}) {
      const event = new win.MouseEvent('click', { bubbles:true, composed:true, cancelable:true, ...options });
      node.dispatchEvent(event); return event;
    } };
}

test('Playables-Link und ankerlose echte MiniGame-Karte stoppen vor YouTubes Command-Handler', t => {
  for (const host of ['m.youtube.com', 'www.youtube.com', 'youtube.com']) {
    const p = page(t, { host, html:'<a href="/playables/UgkxGame"><span>Game</span></a><mini-game-card-view-model><button>Game command</button></mini-game-card-view-model>' });
    let launched = 0;
    p.doc.addEventListener('click', () => launched++, true);
    for (const node of [p.doc.querySelector('a span'), p.doc.querySelector('button')]) {
      assert.equal(p.click(node).defaultPrevented, true);
      assert.equal(p.click(node, { metaKey:true }).defaultPrevented, true);
    }
    assert.equal(launched, 0, 'kein SPA-Command darf ein Spieleiframe starten');
  }
});

test('Pfadgrenzen erhalten Gaming-Videos, Kanäle, Suche und normale Watch-Links', t => {
  const p = page(t);
  for (const href of ['/gaming', '/watch?v=gamevideo01', '/results?search_query=playables', '/@games', '/playables-news', 'https://example.com/playables/game']) {
    const node = p.doc.createElement('a'); node.href = href; p.doc.body.append(node);
    assert.equal(p.click(node).defaultPrevented, false, href);
  }
  for (const href of ['/playables', '/playables/saved', '/playable/old-id', 'https://www.youtube.com/playables/id?x=1']) {
    const node = p.doc.createElement('a'); node.href = href; p.doc.body.append(node);
    assert.equal(p.click(node).defaultPrevented, true, href);
  }
});

test('Bereits verborgenes Gameiframe wird geleert und entfernt; Sign-in, Chat und Video bleiben', t => {
  const p = page(t, { html:'<div hidden><mini-app-container-view-model><iframe id="old" srcdoc="game" src="about:blank"></iframe></mini-app-container-view-model></div><iframe id="signin" src="https://accounts.google.com/"></iframe><iframe id="chat" src="/live_chat"></iframe><iframe id="video" src="/embed/abcdefghijk"></iframe>' });
  assert.equal(p.doc.getElementById('old'), null);
  for (const id of ['signin','chat','video']) assert.ok(p.doc.getElementById(id));
  assert.match(p.doc.getElementById('langform-playables-policy').textContent, /mini-game-card-view-model/);
  assert.equal(p.doc.querySelector('mini-app-container-view-model').hidden, false, 'die Policy zerstört den Frame unabhängig von UI-Sichtbarkeit');
});

test('Später montierte Spieliframes und später gesetzte Spiel-src werden zerstört', async t => {
  const p = page(t);
  const frame = p.doc.createElement('iframe');
  frame.src = 'https://12198422295069170377.playables.usercontent.goog/v/assets/index.html';
  p.doc.body.append(frame); await p.flush();
  assert.equal(frame.isConnected, false); assert.equal(frame.getAttribute('src'), 'about:blank');
  const late = p.doc.createElement('iframe'); p.doc.body.append(late); await p.flush();
  assert.equal(late.isConnected, true);
  late.src = 'https://1.playables.usercontent.goog/v/assets/index.html'; await p.flush();
  assert.equal(late.isConnected, false);
  const named = p.doc.createElement('iframe'); p.doc.body.append(named); await p.flush();
  named.className = 'ytMiniAppContainerViewModelIframe'; await p.flush();
  assert.equal(named.isConnected, false);
});

test('Tab/Background und BFCache räumen auch zwischen Observer-Checkpoints montierte Games auf', async t => {
  const p = page(t);
  for (const event of ['langform-feed-visibility', 'yt-navigate-finish', 'pagehide']) {
    const frame = p.doc.createElement('iframe'); frame.className = 'ytMiniAppContainerViewModelIframe'; p.doc.body.append(frame);
    p.win.dispatchEvent(new p.win.Event(event));
    assert.equal(frame.isConnected, false, event + ' entsorgt synchron den Spiel-Frame');
  }
  const retained = p.doc.createElement('iframe'); retained.className = 'ytMiniAppContainerViewModelIframe'; p.doc.body.append(retained);
  await p.flush(); assert.equal(retained.isConnected, true, 'abgelegte Dokumente werden nicht weiter beobachtet');
  p.win.dispatchEvent(new p.win.Event('pageshow'));
  assert.equal(retained.isConnected, false, 'BFCache-Rückkehr zerstört einen alten Spiel-Kontext');
  const active = p.doc.createElement('iframe'); active.className = 'ytMiniAppContainerViewModelIframe'; p.doc.body.append(active); await p.flush();
  assert.equal(active.isConnected, false, 'Wiederaufnahme schützt auch spätere Iframes');
});

test('Native Cleanup kann ein verborgenes Spiel vor dem nächsten Mutation-Checkpoint entsorgen', t => {
  const p = page(t), frame = p.doc.createElement('iframe');
  frame.className = 'ytMiniAppContainerViewModelIframe'; p.doc.body.append(frame);
  p.win.__langformDiscardPlayables();
  assert.equal(frame.isConnected, false);
});

test('Ausgeblendete Spielkarten lassen Fortsetzungs-Trigger und gemischte Desktop-Videokarten bestehen', t => {
  const p = page(t, { html:'<ytm-rich-item-renderer id="game"><mini-game-card-view-model></mini-game-card-view-model></ytm-rich-item-renderer><ytm-rich-item-renderer id="sentinel"><mini-game-card-view-model></mini-game-card-view-model><ytm-continuation-item-renderer></ytm-continuation-item-renderer></ytm-rich-item-renderer><ytd-rich-item-renderer id="video"><mini-game-card-view-model></mini-game-card-view-model><a href="/watch?v=abcdefghijk">Video</a></ytd-rich-item-renderer>' });
  assert.equal(p.win.getComputedStyle(p.doc.getElementById('game')).display, 'none');
  for (const id of ['sentinel','video']) assert.notEqual(p.win.getComputedStyle(p.doc.getElementById(id)).display, 'none', id);
});

test('Keine Gamepolicy ohne Langform-Brücke oder außerhalb von YouTube', t => {
  for (const options of [{ native:false }, { host:'example.com' }]) {
    const p = page(t, options);
    assert.equal(p.win.__langformPlayablesBlocked, undefined);
    const frame = p.doc.createElement('iframe'); frame.className = 'ytMiniAppContainerViewModelIframe'; p.doc.body.append(frame);
    assert.equal(frame.isConnected, true);
    assert.equal(p.doc.getElementById('langform-playables-policy'), null);
  }
});
