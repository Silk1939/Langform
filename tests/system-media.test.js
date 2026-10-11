const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/SystemMedia.js'), 'utf8');

function page(t) {
  const dom = new JSDOM('<div id="movie_player"><video></video></div><video id="preview"></video>', {
    url: 'https://m.youtube.com/watch?v=abcdefghijk', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const win = dom.window, root = win.document.getElementById('movie_player'), video = root.querySelector('video');
  const state = { paused: false, ended: false, error: null, readyState: 4, currentTime: 30, duration: 120, playbackRate: 1 };
  Object.entries(state).forEach(([key]) => Object.defineProperty(video, key, { get: () => state[key], set: value => state[key] = value }));
  const posts = [], commands = [], data = { video_id: 'abcdefghijk', title: 'Titel A', author: 'Kanal' };
  root.getVideoData = () => data;
  root.pauseVideo = () => { commands.push('pause'); state.paused = true; };
  root.seekTo = value => { commands.push(['seek', value]); state.currentTime = value; };
  win.__langformPlay = id => { commands.push(['play', id]); state.paused = false; return true; };
  win.webkit = { messageHandlers: { langformSystemMedia: { postMessage: payload => posts.push(JSON.parse(JSON.stringify(payload))) } } };
  let now = 0;
  win.performance.now = () => now;
  win.eval(source);
  return { win, root, video, state, posts, commands, data, tick: value => now = value,
    event: name => video.dispatchEvent(new win.Event(name, { bubbles: true })) };
}

test('Metadaten lesen verändert die Wiedergabe nicht; Pause und laufende Zeit folgen dem Hauptvideo', t => {
  const p = page(t);
  assert.equal(p.posts.at(-1).playing, true);
  assert.deepEqual(p.commands, []);
  p.state.paused = true; p.event('pause');
  assert.equal(p.posts.at(-1).playing, false);
  const count = p.posts.length;
  p.tick(1000); p.state.currentTime = 31; p.event('timeupdate');
  assert.equal(p.posts.length, count);
  p.tick(5100); p.event('timeupdate');
  assert.equal(p.posts.at(-1).elapsed, 31);
  p.win.document.getElementById('preview').dispatchEvent(new p.win.Event('playing', { bubbles: true }));
  assert.equal(p.posts.length, count + 1);
  assert.deepEqual(p.commands, []);
});

test('Systembefehle sind explizit, begrenzt und an das aktuelle Video gebunden', t => {
  const p = page(t), command = p.win.__langformSystemCommand;
  assert.equal(command('zzzzzzzzzzz', 'pause'), false);
  assert.equal(command('abcdefghijk', 'pause'), true);
  assert.equal(command('abcdefghijk', 'toggle'), true);
  assert.equal(command('abcdefghijk', 'skip', -1000), true);
  assert.equal(p.state.currentTime, 0);
  assert.equal(command('abcdefghijk', 'position', 500), true);
  assert.equal(p.state.currentTime, 120);
  assert.equal(command('abcdefghijk', 'position', NaN), false);
  assert.equal(command('abcdefghijk', 'unknown'), false);
  p.win.__langformIsNativeDragging = () => true;
  assert.equal(command('abcdefghijk', 'pause'), false);
  assert.deepEqual(p.commands, ['pause', ['play', 'abcdefghijk'], ['seek', 0], ['seek', 120]]);
});

test('Werbung, veralteter Player und ausgeblendete Seite können keine fremden Medien steuern', t => {
  const p = page(t), command = p.win.__langformSystemCommand;
  p.root.classList.add('ad-showing'); p.win.__langformPublishSystemMedia();
  assert.equal(p.posts.at(-1).kind, 'clear');
  assert.equal(command('abcdefghijk', 'pause'), false);
  p.root.classList.remove('ad-showing'); p.data.video_id = 'zzzzzzzzzzz';
  assert.equal(command('abcdefghijk', 'play'), false);
  p.data.video_id = 'abcdefghijk';
  p.win.dispatchEvent(new p.win.Event('pagehide'));
  assert.equal(command('abcdefghijk', 'play'), false);
  p.win.dispatchEvent(new p.win.Event('pageshow'));
  assert.equal(p.posts.at(-1).kind, 'state');
  p.win.history.replaceState({}, '', '/watch?v=zzzzzzzzzzz');
  assert.equal(command('abcdefghijk', 'play'), false);
  assert.deepEqual(p.commands, []);
});

test('Live/fehlende Timeline verhindert Sprünge und nichtfinite Werte gelangen nicht ins System', t => {
  const p = page(t);
  p.state.duration = Infinity; p.win.__langformPublishSystemMedia();
  assert.equal(p.posts.at(-1).duration, null);
  assert.equal(p.win.__langformSystemCommand('abcdefghijk', 'skip', 10), false);
  const count = p.posts.length;
  p.state.currentTime = NaN; p.win.__langformPublishSystemMedia();
  assert.equal(p.posts.length, count);
});

test('Werbe-Playback räumt die alte Systemkarte auf; Buffering friert die Systemzeit ein', t => {
  const p = page(t);
  p.event('waiting');
  assert.equal(p.posts.at(-1).playing, false);
  p.event('playing');
  assert.equal(p.posts.at(-1).playing, true);
  p.root.classList.add('ad-showing');
  p.event('playing');
  assert.deepEqual(p.posts.at(-1), { kind: 'clear', videoID: 'abcdefghijk' });
  assert.equal(p.win.__langformSystemCommand('abcdefghijk', 'pause'), false);
  assert.deepEqual(p.commands, []);
});
