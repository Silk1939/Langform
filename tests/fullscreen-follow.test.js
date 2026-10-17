const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const repository = fs.existsSync(path.resolve(__dirname, '../package.json')) ? path.resolve(__dirname, '..') : path.resolve(__dirname, '../../../../..');
const draftSource = path.resolve(__dirname, '../ios/Langform/Langform/FullscreenMotion.js');
if (fs.existsSync(draftSource) && !process.env.LANGFORM_FULLSCREEN_TEST_SOURCE) process.env.LANGFORM_FULLSCREEN_TEST_SOURCE = draftSource;
const filename = path.join(repository, 'tests/fullscreen-motion.test.js'), existing = fs.readFileSync(filename, 'utf8');
const helper = new Module(filename, module); helper.filename = filename; helper.paths = Module._nodeModulePaths(path.dirname(filename));
helper._compile(existing.slice(0, existing.indexOf('\ntest(')) + '\nmodule.exports={setup};', filename);
const { setup } = helper.exports;

function environment(t, options = {}) {
  let now = 1000, animation = null, reduced = !!options.reduced, writes = 0;
  const animations = [], keys = ['translate', 'scale', 'transform-origin'];
  const s = setup(t, { nativeSetup(video, root, win) {
    win.PointerEvent = options.touch ? undefined : win.MouseEvent;
    win.CSS = { supports: () => true }; win.__langformFullscreenExitProtocol = options.transaction ? 1 : 0;
    const preference = new win.EventTarget(); preference.matches = reduced; win.matchMedia = () => preference;
    win.__langformMotion = { get reduceSpatialMotion() { return reduced; } };
    win.performance.now = () => now;
    Object.defineProperties(win, { innerWidth: { value: 844 }, innerHeight: { value: 390 } });
    Object.defineProperties(video, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 },
      currentTime: { configurable: true, get: () => 40, set: () => { writes++; } } });
    Object.defineProperty(win.document, 'hidden', { value: false, configurable: true, writable: true });
    const realStyle = win.getComputedStyle.bind(win);
    function effective(key, fallback) {
      if (!animation || animation.cancelled || !(key in animation.frames[0])) return fallback;
      const frames = animation.frames, index = Math.min(frames.length - 2, Math.floor(animation.fraction * (frames.length - 1)));
      const a = frames[index], b = frames[index + 1], p = animation.fraction * (frames.length - 1) - index;
      if (key === 'translate') return '0px ' + (parseFloat(a.translate.split(' ')[1]) * (1-p) + parseFloat(b.translate.split(' ')[1]) * p) + 'px';
      return String(Number(a.scale) * (1-p) + Number(b.scale) * p);
    }
    win.getComputedStyle = node => {
      const css = realStyle(node);
      if (node !== video) return css;
      return new Proxy(css, { get(target, key) {
        if (key === 'translate') return effective(key, video.style.translate || 'none');
        if (key === 'scale') return effective(key, video.style.scale || 'none');
        if (key === 'objectFit') return video.hasAttribute('data-langform-fullscreen-exit-video') ? 'fill' : 'contain';
        if (key === 'objectPosition') return '50% 50%';
        if (key === 'clipPath') return 'none';
        return target[key];
      } });
    };
    const rect = box => ({ ...box, left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height });
    root.getBoundingClientRect = () => rect(root.hasAttribute('data-langform-fullscreen-player')
      ? { x: 0, y: 0, width: 844, height: 390 } : { x: 0, y: 107, width: 390, height: 219.375 });
    video.getBoundingClientRect = () => {
      if (video.hasAttribute('data-langform-fullscreen-exit-video')) {
        const css = win.document.getElementById('langform-fullscreen-exit-style').textContent;
        const value = key => Number(css.match(new RegExp('(?:[;{])' + key + ':([-\\d.]+)px'))[1]);
        return rect({ x: value('left'), y: value('top'), width: value('width'), height: value('height') });
      }
      const box = root.getBoundingClientRect(), css = win.getComputedStyle(video), scale = Number(css.scale === 'none' ? 1 : css.scale);
      const parts = css.translate.trim().split(/\s+/), y = parts.length > 1 ? parseFloat(parts[1]) : 0;
      return rect({ x: box.x + box.width * (1-scale)/2, y: box.y + box.height * (1-scale)/2 + y, width: box.width*scale, height: box.height*scale });
    };
    video.animate = (frames, timing) => {
      const value = { frames, timing, fraction: 0, cancelled: false, onfinish: null,
        cancel() { this.cancelled = true; if (animation === this) animation = null; },
        finish() { this.fraction = 1; if (this.onfinish) this.onfinish(); } };
      animation = value; animations.push(value); return value;
    };
  } });
  s.enter(); const rootStyle = s.root.getAttribute('style'), original = Object.fromEntries(keys.map(key => [key, [s.video.style.getPropertyValue(key), s.video.style.getPropertyPriority(key)]]));
  function fire(type, y, x = 150, extras = {}) {
    now += extras.elapsed || 0;
    const event = new s.win.Event(type, { bubbles: true, cancelable: true });
    const pointer = extras.pointer || 1, point = { identifier: pointer, clientX: x, clientY: y };
    if (options.touch) Object.defineProperties(event, { touches: { value: /end|cancel/.test(type) ? [] : [point] }, changedTouches: { value: [point] } });
    else Object.assign(event, { pointerType: 'touch', pointerId: pointer, isPrimary: extras.secondary !== true, clientX: x, clientY: y });
    (extras.target || s.ui()).dispatchEvent(event); return event;
  }
  const names = options.touch ? ['touchstart', 'touchmove', 'touchend', 'touchcancel'] : ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'];
  function picture() {
    const box = s.video.getBoundingClientRect();
    if (s.video.hasAttribute('data-langform-fullscreen-exit-video')) return box;
    const scale = Math.min(box.width / 1920, box.height / 1080), width = 1920*scale, height = 1080*scale;
    return { x: box.x + (box.width-width)/2, y: box.y + (box.height-height)/2, width, height };
  }
  return { ...s, keys, original, rootStyle, fire, names, animations, picture, writes: () => writes,
    advance: value => { now += value; }, reduce(value) { reduced = value; s.win.dispatchEvent(new s.win.Event('langform-motion-change')); },
    clean() { for (const key of keys) assert.deepEqual([s.video.style.getPropertyValue(key), s.video.style.getPropertyPriority(key)], original[key]); assert.equal(s.video.hasAttribute('data-langform-fullscreen-follow'), false); },
  };
}

for (const touch of [false, true]) test(`${touch ? 'touch' : 'pointer'} follow is uniform, bounded and video-only before unchanged release commit`, t => {
  const s = environment(t, { touch, transaction: true }), [start, move, end] = s.names;
  s.fire(start, 120); s.fire(move, 190); const before = s.picture();
  assert.ok(Number(s.video.style.scale) < 1); assert.ok(Number(s.video.style.scale) >= .965);
  assert.ok(parseFloat(s.video.style.translate.split(' ')[1]) > 0);
  s.fire(move, 2000); assert.ok(parseFloat(s.video.style.translate.split(' ')[1]) <= 28);
  assert.equal(s.root.getAttribute('style'), s.rootStyle);
  assert.equal(s.messages.some(row => row.kind === 'exit-request'), false);
  const displayed = s.picture(); s.advance(1000); s.fire(end, 2000);
  const pinned = s.picture();
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(pinned[key] - displayed[key]) < .0001, key + ' pins the currently visible picture');
  assert.equal(s.messages.filter(row => row.kind === 'exit-request').length, 1);
  assert.equal(s.video.hasAttribute('data-langform-fullscreen-follow'), false);
  assert.equal(s.video.style.scale, ''); assert.ok(before.width < 844);
  assert.equal(s.writes(), 0); assert.deepEqual(s.calls, []);
});

test('slow short release springs from presentation; regrab and late completion cannot snap the new contact', t => {
  const s = environment(t), [start, move, end] = s.names;
  s.fire(start, 120); s.fire(move, 160); s.advance(1000); s.fire(end, 160);
  const returning = s.animations[0], stale = returning.onfinish;
  assert.equal(returning.timing.duration, 240); returning.fraction = .35;
  const shown = s.video.getBoundingClientRect();
  s.fire(start, 160); s.fire(move, 180);
  assert.equal(returning.cancelled, true);
  const taken = s.video.getBoundingClientRect();
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(taken[key]-shown[key]) < .01, key + ' continues displayed rollback pose within a hundredth pixel');
  stale(); assert.equal(s.video.hasAttribute('data-langform-fullscreen-follow'), true);
  s.fire(move, 190); s.fire(s.names[3], 190);
  assert.equal(s.animations.length, 2); s.animations[1].finish(); s.clean();
  assert.ok(s.ui()); assert.equal(s.writes(), 0); assert.deepEqual(s.calls, []);
});

for (const [dy, elapsed, dx, commits] of [[19, 1, 0, false], [20, 1000, 0, false], [20, 20, 0, true], [30, 50, 0, false], [30, 49, 0, true], [63, 1000, 0, false], [64, 1000, 0, true], [64, 1000, 60, false]]) {
  test(`release policy is unchanged: ${dy}px/${elapsed}ms, horizontal ${dx}`, t => {
    const s = environment(t, { transaction: true }), [start, move, end] = s.names;
    s.fire(start, 120); s.fire(move, 120+dy, 150+dx); s.advance(elapsed); s.fire(end, 120+dy, 150+dx);
    assert.equal(s.messages.some(row => row.kind === 'exit-request'), commits);
    assert.equal(s.writes(), 0); assert.deepEqual(s.calls, []);
  });
}

test('reduced motion keeps small direct translation and releases immediately without an autonomous rollback', t => {
  const s = environment(t, { reduced: true }), [start, move] = s.names;
  s.fire(start, 120); s.fire(move, 500);
  assert.equal(s.video.style.scale, '1'); assert.ok(parseFloat(s.video.style.translate.split(' ')[1]) <= 12);
  assert.ok(parseFloat(s.video.style.translate.split(' ')[1]) > 0);
  s.fire(s.names[3], 500); assert.equal(s.animations.length, 0); s.clean(); assert.ok(s.ui());
});

for (const kind of ['route', 'ad', 'source', 'hidden', 'blur', 'resize', 'pointer', 'capture', 'preference', 'video', 'root']) test(`owner change retires preview immediately: ${kind}`, async t => {
  const s = environment(t), [start, move] = s.names; s.fire(start, 120); s.fire(move, 160);
  const oldVideo = s.video;
  if (kind === 'route') { s.win.history.replaceState({}, '', '/watch?v=zyxwvutsrqp'); s.win.dispatchEvent(new s.win.Event('yt-navigate-start')); }
  if (kind === 'ad') s.root.classList.add('ad-showing');
  if (kind === 'source') s.video.src = 'https://example.test/replaced';
  if (kind === 'hidden') { s.doc.hidden = true; s.doc.dispatchEvent(new s.win.Event('visibilitychange')); }
  if (kind === 'blur' || kind === 'resize') s.win.dispatchEvent(new s.win.Event(kind));
  if (kind === 'capture') s.win.dispatchEvent(new s.win.Event('lostpointercapture'));
  if (kind === 'pointer') s.fire(move, 180, 150, { pointer: 2 });
  if (kind === 'preference') s.reduce(true);
  if (kind === 'video') s.video.replaceWith(s.video.cloneNode());
  if (kind === 'root') s.root.replaceWith(s.root.cloneNode(true));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(oldVideo.hasAttribute('data-langform-fullscreen-follow'), false);
  assert.equal(s.doc.querySelectorAll('[data-langform-fullscreen-follow]').length, 0);
  assert.equal(oldVideo.style.translate, ''); assert.equal(oldVideo.style.scale, '');
  assert.equal(s.animations.length, 0); assert.equal(s.writes(), 0); assert.deepEqual(s.calls, []);
});

for (const key of ['translate', 'scale', 'transform-origin']) test(`author mutation preserves foreign ${key} and retires only the owned properties`, async t => {
  const s = environment(t), [start, move] = s.names; s.fire(start, 120); s.fire(move, 160);
  const foreign = { translate: '3px 5px', scale: '1.04', 'transform-origin': '10% 20%' }[key];
  s.video.style.setProperty(key, foreign, 'important'); s.video.style.color = 'red';
  await Promise.resolve(); await Promise.resolve();
  assert.equal(s.video.style.getPropertyValue(key), foreign); assert.equal(s.video.style.getPropertyPriority(key), 'important');
  for (const other of s.keys.filter(value => value !== key)) assert.deepEqual([s.video.style.getPropertyValue(other), s.video.style.getPropertyPriority(other)], s.original[other]);
  s.fire(move, 190); assert.equal(s.video.hasAttribute('data-langform-fullscreen-follow'), false, 'revoked physical contact cannot take another lease');
  assert.equal(s.video.style.color, 'red'); assert.equal(s.writes(), 0); assert.deepEqual(s.calls, []);
});

test('source mutation during pose measurement cannot hand a stale gesture box to the exit transaction', t => {
  const s = environment(t, { transaction: true }), [start, move, end] = s.names;
  s.fire(start, 120); s.fire(move, 200);
  const original = s.win.getComputedStyle; let changed = false;
  s.win.getComputedStyle = node => { const css = original(node); if (node === s.video && !changed) { changed = true; s.video.src = 'https://example.test/new'; } return css; };
  s.fire(end, 200);
  assert.equal(s.video.hasAttribute('data-langform-fullscreen-follow'), false);
  assert.equal(s.messages.some(row => row.kind === 'exit-request'), false);
  assert.equal(s.writes(), 0); assert.deepEqual(s.calls, []);
});
