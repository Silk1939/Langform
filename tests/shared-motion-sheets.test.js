const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const repository = fs.existsSync(path.resolve(__dirname, '../package.json'))
  ? path.resolve(__dirname, '..') : path.resolve(__dirname, '../../../../..');

// Reuse the existing behavioral fixtures, not copies of product behavior.
function fixture(file, names, substitutions = []) {
  const filename = path.join(repository, 'tests', file), source = fs.readFileSync(filename, 'utf8');
  let prelude = source.slice(0, source.indexOf(file === 'player-settings.test.js' ? '\nfor(const kind' : '\ntest('));
  if (file === 'player-settings.test.js') {
    const start = source.indexOf('function motionSetup(');
    prelude += '\n' + source.slice(start, source.indexOf('\ntest(', start));
  }
  for (const [before, after] of substitutions) prelude = prelude.replace(before, after);
  const helper = new Module(filename, module); helper.filename = filename; helper.paths = Module._nodeModulePaths(path.dirname(filename));
  helper._compile(prelude + '\nmodule.exports={' + names.join(',') + '};', filename);
  return helper.exports;
}
const comments = fixture('comments-motion.test.js', ['setup', 'dragEvent', 'comments', 'skeleton'], [
  ['win.eval(motion);', 'if(options.shared)win.__langformMotion=options.shared;win.eval(motion);'],
]);
const settings = fixture('player-settings.test.js', ['setup', 'motionSetup'], [
  ['query=new win.EventTarget();', 'if(options.shared)win.__langformMotion=options.shared;query=new win.EventTarget();'],
]);
const summary = fixture('summary-motion.test.js', ['setup'], [
  ['summary.decorate(doc, win.location.href, win);', 'if(options.shared)win.__langformMotion=options.shared;summary.decorate(doc, win.location.href, win);'],
]);
const chapters = require(path.join(repository, 'extension/src/page-captions.js'));
const { JSDOM } = require('jsdom');

function roles(reduced = false) {
  const state = { reduced };
  return Object.freeze({
    durations: Object.freeze({ fade: 160, sheetEnter: 280, sheetExit: 180, submenu: 180 }),
    easings: Object.freeze({ enter: 'cubic-bezier(.16,1,.3,1)', exit: 'cubic-bezier(.4,0,1,1)', fade: 'ease-out' }),
    get reduceSpatialMotion() { return state.reduced; },
    change(win, reduced) { state.reduced = reduced; win.dispatchEvent(new win.Event('langform-motion-change')); },
  });
}
function settingsEnvironment(t, reduced = false) {
  const shared = roles(reduced);
  const env = settings.motionSetup(t, { shared });
  return { ...env, shared };
}
function captionEnvironment(t, reduced = false) {
  const dom = new JSDOM('<!doctype html><body><div id="movie_player"><video></video></div></body>', { url: 'https://m.youtube.com/watch?v=abcdefghijk' });
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document, shared = roles(reduced), animations = [], seeks = [];
  win.__langformMotion = shared; win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const ui = chapters.renderChapterUi(doc, [{ title: 'Anfang', start: 0 }, { title: 'Mitte', start: 83 }, { title: 'Schluss', start: 140 }], seconds => seeks.push(seconds));
  const sheet = doc.getElementById('langform-chapter-sheet');
  sheet.animate = (frames, options) => { const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; }, finish() { if (this.onfinish) this.onfinish(); } }; animations.push(animation); return animation; };
  return { win, doc, ui, sheet, animations, seeks, shared };
}

test('shared ordinary comment entry uses sheet role while finger settlement keeps the existing spring', async t => {
  const env = comments.setup(t, { shared: roles() }), panel = env.mount(); await env.flush();
  assert.equal(env.animations[0].settings.duration, 280);
  assert.equal(env.animations[0].settings.easing, 'cubic-bezier(.16,1,.3,1)');
  assert.ok(env.animations[0].frames.every(frame => !('opacity' in frame)));
  env.animations[0].finish();
  const header = panel.querySelector('.engagement-panel-section-list-header-wrapper');
  comments.dragEvent(env, header, 'pointerdown', 100, 240);
  comments.dragEvent(env, header, 'pointermove', 100, 190);
  comments.dragEvent(env, header, 'pointerup', 100, 190);
  assert.equal(env.animations.at(-1).settings.duration, 500);
  assert.equal(env.animations.at(-1).settings.easing, 'linear');
});

test('reduced comment fade follows hydration playhead once and immediately settles at touch', async t => {
  const env = comments.setup(t, { shared: roles(true) }), panel = env.push(comments.skeleton); await env.flush();
  const opening = env.animations[0];
  assert.equal(opening.settings.duration, 160);
  assert.equal(opening.frames[0].translate, opening.frames[1].translate);
  assert.deepEqual(opening.frames.map(frame => frame.opacity), [0, 1]);
  opening.currentTime = 64;
  panel.innerHTML = comments.comments; await env.flush();
  assert.equal(env.animations.length, 2);
  assert.equal(env.animations[1].currentTime, 64, 'hydration continues the same fade clock');
  const header = panel.querySelector('.engagement-panel-section-list-header-wrapper');
  comments.dragEvent(env, header, 'pointerdown', 100, 240);
  assert.equal(env.animations[1].cancelled, true, 'reading/dragging never carries a text fade');
  comments.dragEvent(env, header, 'pointermove', 100, 190);
  const surface = panel.querySelector('.engagement-panel-container');
  assert.ok(parseFloat(surface.style.translate.split(' ')[1]) < 0, 'direct finger movement is retained');
  comments.dragEvent(env, header, 'pointerup', 100, 190);
  assert.equal(env.animations.length, 2, 'reduced finger release starts no spatial spring or text fade');
});

test('reduced comment close retains its visual pose and lifecycle commits original close only once', async t => {
  const shared = roles(true), env = comments.setup(t, { shared }), panel = env.mount(); await env.flush();
  const surface = panel.querySelector('.engagement-panel-container'), button = panel.querySelector('button');
  let closes = 0; button.addEventListener('click', () => { closes++; panel.hidden = true; });
  const originalStyle = env.win.getComputedStyle;
  env.win.getComputedStyle = node => node === surface ? { translate: '0px 0px', opacity: '.63' } : originalStyle(node);
  button.click();
  const closing = env.animations.at(-1), staleFinish = closing.onfinish;
  assert.equal(closing.frames[0].opacity, '.63'); assert.equal(closing.frames[1].opacity, 0);
  assert.equal(closes, 0);
  env.win.dispatchEvent(new env.win.Event('yt-navigate-start')); staleFinish(); await env.flush();
  assert.equal(closes, 0, 'route revokes rather than replaying a stale YouTube close');
  assert.equal(closing.cancelled, true);
});

test('shared settings enter role and same-tree submenu updates keep actions immediate', t => {
  const env = settingsEnvironment(t); env.gear().click();
  assert.equal(env.animations[0].settings.duration, 280); env.animations[0].finish();
  const items = env.layer().querySelector('.lf-settings-items');
  env.setting('speed').click();
  assert.equal(env.layer().querySelector('.lf-settings-items'), items);
  assert.equal(env.layer().querySelectorAll('.lf-settings-items').length, 1);
  const submenu = env.animations.at(-1);
  assert.equal(submenu.target, items); assert.equal(submenu.settings.duration, 180);
  assert.equal(items.style.height, ''); assert.equal(items.style.minHeight, '');
  assert.equal(env.doc.activeElement, env.layer().querySelector('.lf-settings-back'));
  env.layer().querySelector('[data-speed="1.5"]').click();
  assert.equal(env.video.playbackRate, 1.5); assert.equal(env.win.__langformPlayerSettings.isOpen(), false);
  assert.equal(submenu.canceled, true); assert.equal(env.doc.activeElement, env.gear());
  assert.equal(env.animations.at(-2).settings.duration, 180);
});

test('submenu reversal inherits opacity and transform and stale completion cannot retire its replacement', t => {
  const env = settingsEnvironment(t); env.gear().click(); env.animations[0].finish(); env.setting('speed').click();
  const old = env.animations.at(-1), staleFinish = old.onfinish, items = env.layer().querySelector('.lf-settings-items'), originalStyle = env.win.getComputedStyle;
  env.win.getComputedStyle = node => node === items ? { opacity: '.61', transform: 'matrix(1,0,0,1,3,0)' } : originalStyle(node);
  env.layer().querySelector('.lf-settings-back').click();
  const next = env.animations.at(-1);
  assert.equal(old.canceled, true); assert.equal(next.frames[0].opacity, '.61');
  assert.equal(next.frames[0].transform, 'matrix(1,0,0,1,3,0)');
  staleFinish(); assert.equal(next.canceled, false); assert.equal(env.layer().hidden, false);
  assert.equal(env.doc.activeElement, env.layer().querySelector('.lf-settings-close'));
});

test('reduced settings open and close fade in place and release semantics before pixels finish', t => {
  const env = settingsEnvironment(t, true); env.gear().click();
  const opening = env.animations[0];
  assert.equal(opening.settings.duration, 160);
  assert.deepEqual(Array.from(opening.frames, frame => frame.transform), ['none', 'none']);
  assert.deepEqual(Array.from(opening.frames, frame => frame.opacity), [0, 1]); opening.finish();
  env.layer().querySelector('.lf-settings-close').click();
  assert.equal(env.win.__langformPlayerSettings.isOpen(), false); assert.equal(env.layer().inert, true);
  const closing = env.animations.at(-2), staleFinish = closing.onfinish;
  assert.equal(closing.frames[0].transform, closing.frames[1].transform);
  assert.equal(closing.frames[1].opacity, 0); assert.equal(env.doc.activeElement, env.gear());
  env.gear().click(); staleFinish(); assert.equal(env.layer().hidden, false); assert.equal(env.layer().inert, false);
});

for (const reason of ['source', 'route', 'preference']) test(`submenu has bounded immediate cleanup for ${reason}`, t => {
  const env = settingsEnvironment(t); env.gear().click(); env.animations[0].finish(); env.setting('speed').click();
  const submenu = env.animations.at(-1), staleFinish = submenu.onfinish;
  if (reason === 'source') { env.video.src = 'https://example.test/replaced'; env.video.dispatchEvent(new env.win.Event('loadstart')); }
  if (reason === 'route') env.win.dispatchEvent(new env.win.Event('yt-navigate-start'));
  if (reason === 'preference') env.shared.change(env.win, true);
  staleFinish(); assert.equal(submenu.canceled, true); assert.equal(env.timers.size, 0);
  assert.equal(env.layer().hidden, reason !== 'preference'); assert.deepEqual(env.calls, []);
});

test('shared summary exit uses exit role and reduced reversal preserves opacity without model reentry', async t => {
  const normal = summary.setup(t, { shared: roles() }), normalSheet = normal.open();
  normalSheet.querySelector('header button').click();
  assert.equal(normal.animations[2].timing.easing, 'cubic-bezier(.4,0,1,1)');
  const shared = roles(true), env = summary.setup(t, { shared }), sheet = env.open(); await env.flush();
  assert.equal(env.animations[0].timing.duration, 160);
  assert.deepEqual(env.animations[0].frames.map(frame => frame.opacity), [0, 1]);
  assert.equal(env.animations[0].frames[0].transform, env.animations[0].frames[1].transform);
  const getStyle = env.win.getComputedStyle.bind(env.win);
  env.win.getComputedStyle = node => node.className === 'langform-kurz' ? { transform: 'matrix(1,0,0,1,0,0)', opacity: '.57' } : getStyle(node);
  sheet.querySelector('header button').click(); const closing = env.animations[2], stale = closing.onfinish;
  assert.equal(closing.frames[0].opacity, '.57'); env.open();
  assert.equal(env.animations[4].frames[0].opacity, '.57'); stale();
  assert.equal(sheet.isConnected, true); assert.equal(env.modelCalls.length, 1);
  env.win.dispatchEvent(new env.win.Event('pagehide')); assert.equal(sheet.isConnected, false);
});

test('shared caption sheet role keeps single seek and reduced close/reopen owns visual opacity', t => {
  const normal = captionEnvironment(t); normal.ui.open(); normal.animations[0].finish();
  normal.sheet.querySelector('[data-start="83"]').click();
  assert.equal(normal.animations[1].options.easing, 'cubic-bezier(.4,0,1,1)'); assert.deepEqual(normal.seeks, [83]);
  const env = captionEnvironment(t, true); env.ui.open();
  assert.equal(env.animations[0].options.duration, 160);
  assert.deepEqual(env.animations[0].frames.map(frame => frame.opacity), [0, 1]);
  const getStyle = env.win.getComputedStyle.bind(env.win);
  env.win.getComputedStyle = node => node === env.sheet ? { transform: 'matrix(1,0,0,1,0,0)', opacity: '.48' } : getStyle(node);
  env.ui.close(); const stale = env.animations[1].onfinish;
  assert.equal(env.animations[1].frames[0].opacity, '.48'); env.ui.open();
  assert.equal(env.animations[2].frames[0].opacity, '.48'); stale();
  assert.equal(env.sheet.style.display, 'flex'); assert.equal(env.sheet.style.pointerEvents, '');
  env.win.dispatchEvent(new env.win.Event('pagehide'));
  assert.equal(env.sheet.style.display, 'none'); assert.equal(env.animations[2].cancelled, true);
});
