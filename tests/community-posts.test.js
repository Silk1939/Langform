const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const file = path.join(__dirname, '../ios/Langform/Langform/CommunityPosts.js');
const source = fs.existsSync(file) ? fs.readFileSync(process.env.LANGFORM_COMMUNITY_TEST_SOURCE || file, 'utf8') : '';

function setup(t, options = {}) {
  const dom = new JSDOM('<main></main>', { url: options.url || 'https://m.youtube.com/', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document;
  win.webkit = { messageHandlers: options.browser ? {} : { langformOpenWatch: { postMessage() { assert.fail('a post is not a video'); } } } };
  if (options.links) win.eval(fs.readFileSync(path.join(path.dirname(file), 'WebViewLinks.js'), 'utf8'));
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
test('card background and complete text never trigger an implicit post subpage', t => {
  const env = setup(t), card = env.mount('<a href="/@Creator">Avatar</a><div class="post-text">Post</div><a id="post" href="/post/UgkxabcDEF-12_3">Kommentare</a><a href="/watch?v=abcdefghijk">Film</a>');
  let opens = 0; card.querySelector('#post').addEventListener('click', e => { e.preventDefault(); opens++; });
  assert.equal(env.click(card).defaultPrevented, true); assert.equal(env.click(card.querySelector('.post-text')).defaultPrevented, true); assert.equal(opens, 0);
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
  env.win.dispatchEvent(new env.win.Event('pageshow')); env.click(card.querySelector('a')); assert.equal(opens, 1);
});

function attachment(name = 'one', attributes = '') {
  return `<ytm-backstage-image-renderer><img alt="Bild ${name}" src="https://yt3.ggpht.com/${name}=s640" ${attributes}></ytm-backstage-image-renderer>`;
}
function gallery(env) { return env.doc.getElementById('langform-community-images'); }
function galleryButton(env, label) { return Array.from(gallery(env).querySelectorAll('button')).find(node => node.textContent === label); }

test('an open gallery consumes live native insets on every side while retaining its dialog and focus owner', t => {
  const env = setup(t, { links: true }), card = env.mount(attachment());
  env.win.eval(fs.readFileSync(process.env.LANGFORM_VIEWPORT_TEST_SOURCE || path.join(path.dirname(file), 'ViewportLayout.js'), 'utf8'));
  env.win.__langformSetStageInsets({ top:62, right:0, bottom:34, left:0, nativeMini:false });
  const previous = env.doc.createElement('button'); env.doc.body.prepend(previous); previous.focus();
  env.click(card.querySelector('img'));
  const viewer = gallery(env), close = galleryButton(env, 'Schließen');
  for (const side of ['top', 'right', 'bottom', 'left']) {
    assert.ok(viewer.style.padding.includes(`var(--lf-native-safe-${side},env(safe-area-inset-${side}))`), `native ${side} is used with browser fallback`);
  }
  env.win.__langformSetStageInsets({ top:0, right:62, bottom:21, left:62, nativeMini:false });
  assert.equal(gallery(env), viewer, 'rotation updates CSS without rebuilding the active viewer');
  assert.equal(env.doc.activeElement, close); assert.equal(env.win.__langformHasOpenOverlay(), true);
  assert.equal(env.doc.body.style.overflow, 'hidden');
  galleryButton(env, 'Schließen').click();
  assert.equal(gallery(env), null); assert.equal(env.win.__langformHasOpenOverlay(), false); assert.equal(env.doc.activeElement, previous);
});

test('post image opens enlarged where tapped instead of following its enclosing post URL', t => {
  const env = setup(t, { links: true }), card = env.mount(`<a href="/post/UgkABC">${attachment()}</a><a href="/post/UgkABC">Kommentare</a>`);
  let routes = 0; card.querySelector('a').addEventListener('click', () => routes++);
  const event = env.click(card.querySelector('img'));
  assert.equal(event.defaultPrevented, true); assert.equal(routes, 0);
  const viewer = gallery(env); assert.ok(viewer); assert.equal(viewer.getAttribute('role'), 'dialog');
  assert.equal(viewer.querySelector('img').src, 'https://yt3.ggpht.com/one=s640');
  assert.equal(viewer.querySelector('img').alt, 'Bild one'); assert.equal(env.doc.body.style.overflow, 'hidden');
  galleryButton(env, 'Schließen').click(); assert.equal(gallery(env), null); assert.equal(env.doc.body.style.overflow, '');
});
test('image viewer preserves order, opens selected image, deduplicates carousel clones and retains explicit comments', t => {
  const env = setup(t), card = env.mount(`${attachment('one')}${attachment('two')}${attachment('one')}<a href="/post/UgkABC">Kommentare</a>`);
  env.click(card.querySelectorAll('img')[1]);
  assert.match(gallery(env).textContent, /Bild 2 von 2/); assert.match(gallery(env).querySelector('img').src, /two=/);
  assert.equal(galleryButton(env, 'Weiter').disabled, true); galleryButton(env, 'Zurück').click();
  assert.match(gallery(env).querySelector('img').src, /one=/); assert.equal(galleryButton(env, 'Zurück').disabled, true);
  galleryButton(env, 'Schließen').click();
  let opens = 0; card.querySelector('a').addEventListener('click', e => { e.preventDefault(); opens++; }); env.click(card.querySelector('a')); assert.equal(opens, 1);
});
test('viewer owns native overlay gestures, traps focus and restores focus and the original scroll style', t => {
  const env = setup(t, { links: true }), card = env.mount(attachment());
  env.doc.body.style.setProperty('overflow', 'auto', 'important');
  const trigger = env.doc.createElement('button'); env.doc.body.prepend(trigger); trigger.focus();
  env.click(card.querySelector('img')); assert.equal(env.win.__langformHasOpenOverlay(), true);
  const close = galleryButton(env, 'Schließen'); assert.equal(env.doc.activeElement, close);
  close.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); assert.equal(env.doc.activeElement, close);
  close.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(gallery(env), null); assert.equal(env.win.__langformHasOpenOverlay(), false); assert.equal(env.doc.activeElement, trigger);
  assert.equal(env.doc.body.style.overflow, 'auto'); assert.equal(env.doc.body.style.getPropertyPriority('overflow'), 'important');
});
test('gallery navigation supports horizontal swipes and arrow keys while vertical scrolls and multi-touch do not change slides', t => {
  const env = setup(t), card = env.mount(`${attachment('one')}${attachment('two')}`);
  env.click(card.querySelector('img')); const image = gallery(env).querySelector('img');
  env.touch(image, 'touchstart', 240, 180); env.touch(image, 'touchend', 70, 190); assert.match(image.src, /two=/);
  env.touch(image, 'touchstart', 50, 150); env.touch(image, 'touchend', 160, 300); assert.match(image.src, /two=/);
  image.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })); assert.match(image.src, /one=/);
  const start = new env.win.Event('touchstart', { bubbles: true }); start.touches = [{ identifier: 1, clientX: 200, clientY: 180 }, { identifier: 2, clientX: 190, clientY: 180 }]; image.dispatchEvent(start);
  env.touch(image, 'touchend', 30, 180); assert.match(image.src, /one=/);
});
test('scroll release cannot open an image or fall through into its post subpage', t => {
  const env = setup(t, { links: true }), card = env.mount(`<a href="/post/UgkABC">${attachment()}</a>`), image = card.querySelector('img');
  let navigations = 0; card.querySelector('a').addEventListener('click', () => navigations++);
  env.touch(image, 'touchstart', 60, 150); env.touch(image, 'touchmove', 60, 200); env.touch(image, 'touchend', 60, 200);
  assert.equal(env.click(image).defaultPrevented, true); assert.equal(gallery(env), null); assert.equal(navigations, 0);
});
for (const reason of ['pagehide', 'yt-navigate-start', 'state-navigatestart', 'langform-feed-visibility', 'langform-real-visibilitychange']) {
  test(`gallery closes and releases ownership on ${reason}`, t => {
    const env = setup(t, { links: true }), card = env.mount(attachment()); env.click(card.querySelector('img'));
    assert.ok(gallery(env));
    if (reason === 'langform-feed-visibility') env.win.__langformFeedActive = false;
    if (reason === 'langform-real-visibilitychange') env.win.__langformRealVisibility = { inactive: () => true };
    (reason === 'langform-real-visibilitychange' ? env.doc : env.win).dispatchEvent(new env.win.Event(reason));
    assert.equal(gallery(env), null); assert.equal(env.win.__langformHasOpenOverlay(), false); assert.equal(env.doc.body.style.overflow, '');
  });
}
for (const markup of [
  '<a href="/@Creator"><img src="https://yt3.ggpht.com/avatar=s176"></a>',
  '<a href="/watch?v=abcdefghijk"><img src="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"></a>',
  '<div class="author-thumbnail"><img src="https://yt3.ggpht.com/avatar=s176"></div>',
  '<ytm-backstage-poll-renderer><button><img src="https://yt3.ggpht.com/poll=s640"></button></ytm-backstage-poll-renderer>',
  '<ytm-backstage-image-renderer><img src="https://evil.example/pixel"></ytm-backstage-image-renderer>',
  '<ytm-backstage-image-renderer><img src="data:image/png;base64,abcd"></ytm-backstage-image-renderer>',
  '<ytm-backstage-image-renderer hidden><img src="https://yt3.ggpht.com/hidden=s640"></ytm-backstage-image-renderer>'
]) {
  test(`avatars, videos, polls, foreign and hidden images retain their original controls: ${markup}`, t => {
    const env = setup(t), card = env.mount(markup); env.click(card.querySelector('img')); assert.equal(gallery(env), null);
  });
}
test('large unlinked mobile attachment variants are supported without treating small avatars as content', t => {
  const env = setup(t), card = env.mount('<img id="avatar" src="https://yt3.ggpht.com/avatar=s176"><img id="photo" src="https://lh3.googleusercontent.com/photo=s640">');
  card.querySelector('#avatar').getBoundingClientRect = () => ({ width: 40, height: 40 });
  card.querySelector('#photo').getBoundingClientRect = () => ({ width: 350, height: 200 });
  env.click(card.querySelector('#avatar')); assert.equal(gallery(env), null);
  env.click(card.querySelector('#photo')); assert.match(gallery(env).querySelector('img').src, /photo=/); assert.match(gallery(env).textContent, /Bild 1 von 1/);
});

for (const wrap of [false, true]) test(`dynamically hydrated image is an accessible keyboard control; pure post anchor=${wrap}`, async t => {
  const env = setup(t, { links: true }), card = env.mount(wrap ? `<a href="/post/UgkABC">${attachment()}</a>` : attachment());
  await Promise.resolve();
  const control = card.querySelector('[data-langform-post-image]'); assert.ok(control);
  assert.equal(control.getAttribute('role'), 'button'); assert.equal(control.tabIndex, 0); assert.match(control.getAttribute('aria-label'), /Beitragsbild vergrößern/);
  control.focus(); control.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.ok(gallery(env)); galleryButton(env, 'Schließen').click(); assert.equal(env.doc.activeElement, control);
});
test('image hydration observer stops with a hidden page and resumes on pageshow', async t => {
  const env = setup(t); env.win.dispatchEvent(new env.win.Event('pagehide')); const card = env.mount(attachment());
  await Promise.resolve(); assert.equal(card.querySelector('[data-langform-post-image]'), null);
  env.win.dispatchEvent(new env.win.Event('pageshow')); assert.ok(card.querySelector('[data-langform-post-image]'));
});

test('nested shared posts keep separate image galleries', t => {
  const env = setup(t), card = env.mount(`${attachment('outer')}<ytm-post-renderer>${attachment('inner')}</ytm-post-renderer>`);
  env.click(card.querySelector('ytm-post-renderer img')); assert.match(gallery(env).querySelector('img').src, /inner=/); assert.match(gallery(env).textContent, /Bild 1 von 1/);
  galleryButton(env, 'Schließen').click(); env.click(card.querySelector('img')); assert.match(gallery(env).querySelector('img').src, /outer=/); assert.match(gallery(env).textContent, /Bild 1 von 1/);
});
test('bounded galleries still open the actual tapped image in a pathological large card', t => {
  const env = setup(t), card = env.mount(Array.from({ length: 25 }, (_, index) => attachment('image-' + index)).join(''));
  env.click(card.querySelectorAll('img')[24]); assert.match(gallery(env).querySelector('img').src, /image-24=/); assert.match(gallery(env).textContent, /Bild 20 von 20/);
});

test('semantic accessibility activation on a pure image anchor opens the viewer without a post subpage', async t => {
  const env = setup(t, { links: true }), card = env.mount(`<a href="/post/UgkABC">${attachment()}</a>`);
  await Promise.resolve();
  let subpages = 0; card.querySelector('a').addEventListener('click', () => subpages++);
  const event = env.click(card.querySelector('a')); assert.equal(event.defaultPrevented, true); assert.equal(subpages, 0); assert.ok(gallery(env));
});
