const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const chapters = require('../extension/src/page-captions.js');

test('bar discovery avoids style resolution for unrelated captions and recommendations', () => {
  const dom = new JSDOM('<body><div id="movie_player"><div class="ytp-progress-bar" id="bar"></div><video></video></div></body>', { url: 'https://m.youtube.com/watch?v=abcdefghijk' });
  const win = dom.window, doc = win.document, player = doc.getElementById('movie_player');
  for (let i = 0; i < 400; i++) {
    const node = doc.createElement('span'); node.textContent = 'Caption text'; node.className = 'unrelated'; player.appendChild(node);
  }
  let unrelatedStyleReads = 0;
  const original = win.getComputedStyle.bind(win);
  win.getComputedStyle = node => { if (node.className === 'unrelated') unrelatedStyleReads++; return original(node); };
  assert.equal(chapters.findSeekBar(doc), doc.getElementById('bar'));
  assert.equal(unrelatedStyleReads, 0);
  win.close();
});

test('geometry discovery skips style resolution for elements outside the seek-bar band', () => {
  const dom = new JSDOM('<body><div id="movie_player"><span id="time">1:00 / 10:00</span><div id="bar"></div><video></video></div></body>', { url: 'https://m.youtube.com/watch?v=abcdefghijk' });
  const win = dom.window, doc = win.document;
  function box(node, top, height, width) { node.getBoundingClientRect = () => ({ left: 0, top, width, height, bottom: top + height, right: width }); }
  box(doc.getElementById('time'), 180, 22, 108); box(doc.getElementById('bar'), 210, 3, 390);
  for (let i = 0; i < 400; i++) {
    const node = doc.createElement('div'); node.className = 'unrelated'; box(node, 500, 100, 390); doc.getElementById('movie_player').appendChild(node);
  }
  let unrelatedStyleReads = 0;
  const original = win.getComputedStyle.bind(win);
  win.getComputedStyle = node => { if (node.className === 'unrelated') unrelatedStyleReads++; return original(node); };
  assert.equal(chapters.findSeekBar(doc), doc.getElementById('bar'));
  assert.equal(unrelatedStyleReads, 0);
  win.close();
});

test('hidden preferred bar still loses to a visible lower-ranked bar after hydration', () => {
  const dom = new JSDOM('<body><div id="movie_player"><div style="display:none"><div class="progress-bar-line" id="hidden"></div></div><div class="ytp-progress-bar" id="visible"></div><video></video></div></body>', { url: 'https://m.youtube.com/watch?v=abcdefghijk' });
  assert.equal(chapters.findSeekBar(dom.window.document), dom.window.document.getElementById('visible'));
  dom.window.document.getElementById('hidden').parentElement.style.display = '';
  assert.equal(chapters.findSeekBar(dom.window.document), dom.window.document.getElementById('hidden'));
  dom.window.close();
});
