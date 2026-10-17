const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const file = path.join(__dirname, '../ios/Langform/Langform/CommunityPosts.js');
const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

function setup(t, options = {}) {
  const dom = new JSDOM('<main></main>', { url: options.url || 'https://m.youtube.com/', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document;
  win.webkit = { messageHandlers: options.browser ? {} : { langformOpenWatch: { postMessage() { assert.fail('a post is not a video'); } } } };
  win.eval(source);
  return { win, doc, mount(markup) { doc.querySelector('main').innerHTML = `<ytm-backstage-post-thread-renderer><ytm-backstage-post-renderer>${markup}</ytm-backstage-post-renderer></ytm-backstage-post-thread-renderer>`; return doc.querySelector('ytm-backstage-post-renderer'); },
    click(node, opts = {}) { const event = new win.MouseEvent('click', { bubbles: true, cancelable: true, ...opts }); node.dispatchEvent(event); return event; },
    touch(node, name, x, y) { const event = new win.Event(name, { bubbles: true, cancelable: true }); const point = { identifier: 7, clientX: x, clientY: y }; event.touches = name === 'touchend' ? [] : [point]; event.changedTouches = [point]; node.dispatchEvent(event); return event; } };
}

test('a truncated post body delegates once to the original more button', t => {
  const env = setup(t), card = env.mount('<ytm-text-expander><div class="post-text">A long post</div><button class="text-expander-button" aria-expanded="false">Mehr lesen</button></ytm-text-expander>');
  let expands = 0; card.querySelector('button').addEventListener('click', () => expands++);
  const event = env.click(card.querySelector('.post-text'));
  assert.equal(expands, 1); assert.equal(event.defaultPrevented, true);
});
test('plain card background prefers an original post permalink, never a channel or video link', t => {
  const env = setup(t), card = env.mount('<a href="/@Creator">Avatar</a><div class="post-text">Post</div><a id="post" href="/post/UgkxabcDEF-12_3">Kommentare</a><a href="/watch?v=abcdefghijk">Film</a>');
  let opens = 0; card.querySelector('#post').addEventListener('click', e => { e.preventDefault(); opens++; });
  env.click(card); assert.equal(opens, 1);
});
test('actual expanders and post links retain their own event instead of being replayed', t => {
  const env = setup(t), card = env.mount('<ytm-text-expander><div class="post-text">Post</div><button class="text-expander-button">Read more</button></ytm-text-expander><a href="/post/Ugk123">Comments</a>');
  for (const node of card.querySelectorAll('button,a')) { let calls = 0; node.addEventListener('click', e => { e.preventDefault(); calls++; }); env.click(node); assert.equal(calls, 1); }
});
for (const control of ['<a href="/@Creator">Kanal</a>', '<a href="/watch?v=abcdefghijk">Video</a>', '<button>Abonnieren</button>', '<button aria-label="Gefällt mir">Like</button>', '<input>', '<span role="button" tabindex="0">Antwort</span>']) {
  test(`post controls stay independent: ${control}`, t => {
    const env = setup(t), card = env.mount(`<div class="post-text">Post</div>${control}<a id="post" href="/post/UgkABC">Kommentare</a>`);
    let redirects = 0; card.querySelector('#post').addEventListener('click', e => { e.preventDefault(); redirects++; });
    const event = env.click(card.children[1]); assert.equal(redirects, 0); assert.equal(event.defaultPrevented, false);
  });
}
test('a native line clamp can expand locally when no original action exists', t => {
  const env = setup(t), card = env.mount('<div class="post-text" style="overflow:hidden;max-height:48px;-webkit-line-clamp:2">Entire original post already in DOM</div>');
  env.click(card.querySelector('.post-text'));
  assert.equal(card.querySelector('.post-text').style.maxHeight, 'none');
  assert.equal(card.querySelector('.post-text').style.overflow, 'visible');
  assert.match(card.textContent, /Entire original post/);
});
test('a hidden, disabled or already expanded expander is never activated', t => {
  for (const attrs of ['hidden', 'disabled', 'aria-expanded="true"', 'aria-disabled="true"']) {
    const env = setup(t), card = env.mount(`<ytm-text-expander><div class="post-text">Post</div><button class="text-expander-button" ${attrs}>Mehr lesen</button></ytm-text-expander>`);
    let expands = 0; card.querySelector('button').addEventListener('click', () => expands++); env.click(card.querySelector('.post-text')); assert.equal(expands, 0);
  }
});
test('scrolls, multi-touch, modified and prevented clicks cannot open posts', t => {
  const env = setup(t), card = env.mount('<div class="post-text">Post</div><a href="/post/UgkABC">Details</a>');
  let opens = 0; card.querySelector('a').addEventListener('click', e => { e.preventDefault(); opens++; });
  const body = card.querySelector('.post-text');
  env.touch(body, 'touchstart', 60, 150); env.touch(body, 'touchmove', 60, 185); env.touch(body, 'touchend', 60, 185); env.click(body);
  assert.equal(opens, 0);
  for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) env.click(body, { [modifier]: true });
  const event = new env.win.MouseEvent('click', { bubbles: true, cancelable: true }); event.preventDefault(); body.dispatchEvent(event);
  assert.equal(opens, 0);
});
test('external or malformed post addresses are ignored', t => {
  for (const url of ['https://evil.example/post/Ugkx', 'javascript:alert(1)', '/channel/UCabc/community', '/post/', '/post/UgkABC?next=https://evil.example']) {
    const env = setup(t), card = env.mount(`<div class="post-text">Post</div><a href="${url}">Link</a>`);
    let opens = 0; card.querySelector('a').addEventListener('click', e => { e.preventDefault(); opens++; }); env.click(card.querySelector('.post-text')); assert.equal(opens, 0);
  }
});
test('ordinary browser and inactive feeds stay untouched', t => {
  for (const options of [{ browser: true }, { url: 'https://example.com/' }, {}]) {
    const env = setup(t, options), card = env.mount('<div class="post-text">Post</div><a href="/post/UgkABC">Details</a>');
    if (!options.browser && !options.url) env.win.__langformFeedActive = false;
    let opens = 0; card.querySelector('a').addEventListener('click', e => { e.preventDefault(); opens++; }); env.click(card.querySelector('.post-text')); assert.equal(opens, 0);
  }
});
test('pagehide cancels a pending tap and pageshow accepts newly hydrated cards', t => {
  const env = setup(t), card = env.mount('<div class="post-text">Post</div><a href="/post/UgkABC">Details</a>');
  let opens = 0; card.querySelector('a').addEventListener('click', e => { e.preventDefault(); opens++; });
  env.win.dispatchEvent(new env.win.Event('pagehide')); env.click(card.querySelector('.post-text')); assert.equal(opens, 0);
  env.win.dispatchEvent(new env.win.Event('pageshow')); env.click(card.querySelector('.post-text')); assert.equal(opens, 1);
});
