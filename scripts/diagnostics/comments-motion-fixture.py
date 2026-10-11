#!/usr/bin/env python3
"""Build an offline comments-motion fixture from the current iPhone scripts."""

import argparse
import json
from pathlib import Path
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--output",
    type=Path,
    default=Path(tempfile.gettempdir()) / "langform-comments-motion" / "fixture.html",
    help="HTML output path (default: %(default)s)",
)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
links=(root/'ios/Langform/Langform/WebViewLinks.js').read_text()
motion=(root/'ios/Langform/Langform/CommentsMotion.js').read_text()
markup='''<ytm-engagement-panel-section-list-renderer class="comment-item-section"><ytw-scrim class="ytWebScrimHost"></ytw-scrim><div class="engagement-panel-section-list-background draggable at-top"><div class="engagement-panel-container" style="height:100%;transform:translateY(0px)"><div class="engagement-panel-section-list-header-wrapper"><div class="engagement-panel-drag-line"></div><div class="engagement-panel-section-list-header"><h2>Kommentare</h2><ytm-button-renderer class="engagement-panel-section-list-header-button close-button"><button>×</button></ytm-button-renderer></div></div><div class="engagement-panel-content-wrapper"><ytm-comments-header-renderer></ytm-comments-header-renderer><p><b>Ein Kommentar</b></p><p>Das Kommentarblatt bleibt lesbar und gleitet als feste Fläche.</p><p>Weitere Kommentare …</p></div></div></div></ytm-engagement-panel-section-list-renderer>'''
skeleton='''<div class="engagement-panel-section-list-background draggable"><div class="engagement-panel-container"><div class="engagement-panel-section-list-header-wrapper"><div class="engagement-panel-drag-line"></div><h2>Kommentare laden …</h2></div><div class="engagement-panel-content-wrapper"></div></div></div>'''
head='''<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;background:#171717;color:#fff;font:16px -apple-system;height:100%;overflow:hidden}#video{height:226px;background:#37444d;padding-top:48px;box-sizing:content-box;display:grid;place-items:center}#metadata{padding:24px}panel-container{display:block}ytm-engagement-panel{position:fixed;left:0;right:0;bottom:0;top:274px;z-index:4}ytm-engagement-panel[hidden]{display:none}ytm-engagement-panel-section-list-renderer{display:flex;flex-direction:column;height:100%}.engagement-panel-section-list-background{display:flex;flex-direction:column;flex-grow:1;height:100%;background:transparent;z-index:4}.engagement-panel-section-list-background.at-top{overflow-y:auto;-webkit-overflow-scrolling:touch}.engagement-panel-container{background:#222;flex-grow:1;display:flex;flex-direction:column;overflow:hidden}.engagement-panel-section-list-header-wrapper{padding:12px 16px}.engagement-panel-section-list-header{display:flex;align-items:center;justify-content:space-between}h2{font-size:20px}.engagement-panel-drag-line{width:40px;height:4px;background:#666;border-radius:4px;margin:auto}.engagement-panel-content-wrapper{flex:1;overflow-y:auto;padding:0 16px}button{background:none;color:white;font-size:26px;border:none;width:44px;height:44px}.ytWebScrimHost{position:fixed;inset:0;background:rgba(0,0,0,.2);z-index:-1}#result{white-space:pre-wrap}
</style><div id="video">Video</div><div id="metadata">Videotitel<br>Beschreibung und Empfehlungen</div><button id="open" hidden>Kommentare</button><panel-container></panel-container><script>'''
setup=f'''
const qaErrors=[];window.addEventListener('error',e=>{{qaErrors.push(e.message);window.webkit.messageHandlers.qa.postMessage({{error:e.message,line:e.lineno}});}});window.addEventListener('unhandledrejection',e=>qaErrors.push(String(e.reason)));
const testLocation={{hostname:'m.youtube.com',href:'https://m.youtube.com/watch?v=abcdefghijk',pathname:'/watch',protocol:'https:'}};
const messages={{langformPlayer:{{postMessage(){{}}}},langformOverlayState:{{postMessage(){{}}}}}};
const testWindow=new Proxy({{}},{{get(t,k){{if(Reflect.has(t,k))return Reflect.get(t,k);if(k==='location')return testLocation;if(k==='webkit')return {{messageHandlers:messages}};const v=Reflect.get(window,k);return typeof v==='function'?v.bind(window):v;}}}});
try{{new Function('window', {json.dumps(links)})(testWindow);}}catch(e){{qaErrors.push(String(e));window.webkit.messageHandlers.qa.postMessage({{setupError:String(e),stack:e.stack}});}}
try{{new Function('window', {json.dumps(motion)})(testWindow);}}catch(e){{qaErrors.push(String(e));window.webkit.messageHandlers.qa.postMessage({{setupError:String(e),stack:e.stack}});}}
const markup={json.dumps(markup)},skeleton={json.dumps(skeleton)};
'''
tests = r"""
const results = [];
const closeSelector = '.close-button button';
const backgroundSelector = '.engagement-panel-section-list-background';
const movingAttribute = 'data-langform-comments-moving';
function report(value) { window.webkit.messageHandlers.qa.postMessage(value); }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function pose(panel) {
  const surface = panel.querySelector('.engagement-panel-container');
  const scrim = panel.querySelector('ytw-scrim');
  const background = panel.querySelector(backgroundSelector);
  if (!surface || !panel.isConnected) return { removed: true };
  const rect = surface.getBoundingClientRect(), style = getComputedStyle(surface);
  return {
    top: rect.top, translate: style.translate, opacity: style.opacity,
    outer: getComputedStyle(panel).transform,
    scrimTop: scrim ? scrim.getBoundingClientRect().top : null,
    scrollTop: background.scrollTop,
    clipping: background.hasAttribute(movingAttribute),
    overflowY: getComputedStyle(background).overflowY,
    closeFocused: document.activeElement === panel.querySelector(closeSelector),
  };
}
function movesUp(samples) {
  return samples.every((sample, index) => index === 0 || sample.top <= samples[index - 1].top + 1);
}
function movesDown(samples) {
  return samples.every((sample, index) => index === 0 || sample.top >= samples[index - 1].top - 1);
}
async function scenario(name, hydrate, closeAt, touchAt, removeDelay) {
  document.getElementById('open').click();
  const panel = document.createElement('ytm-engagement-panel');
  panel.innerHTML = hydrate === null ? markup : skeleton;
  window.dispatchEvent(new CustomEvent('engagement-panel-push', { detail: {
    identifier: 'comment-item-section',
    wF: { engagementPanelSectionListRenderer: { panelIdentifier: 'comment-item-section' } },
  } }));
  document.querySelector('panel-container').append(panel);
  let commandCount = 0, closeSample = null, touchSample = null, hydrationSample = null;
  let focusSample = null, active = true;
  const samples = [], start = performance.now();
  function wire() {
    panel.querySelector(closeSelector)?.addEventListener('click', () => {
      commandCount++;
      setTimeout(() => panel.remove(), removeDelay);
    });
  }
  function focusClose() {
    const button = panel.querySelector(closeSelector);
    const before = pose(panel);
    // Real DOM focus with the browser's default scroll behavior reproduces the
    // focus-induced ancestor scroll; dispatching a focus event would not.
    button.focus();
    focusSample = { t: performance.now() - start, before, after: pose(panel), received: document.activeElement === button };
  }
  wire();
  if (hydrate === null) setTimeout(focusClose, 30);
  function sample() {
    samples.push({ t: performance.now() - start, ...pose(panel) });
    if (active) requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
  if (hydrate !== null) setTimeout(() => {
    const before = pose(panel);
    panel.innerHTML = markup;
    wire();
    queueMicrotask(() => {
      hydrationSample = { t: performance.now() - start, before, after: pose(panel) };
      focusClose();
    });
  }, hydrate);
  if (touchAt !== null) setTimeout(() => {
    const before = pose(panel);
    panel.querySelector('.engagement-panel-content-wrapper').dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, pointerId: 1, isPrimary: true,
    }));
    touchSample = { t: performance.now() - start, before, after: pose(panel) };
  }, touchAt);
  if (closeAt !== null) setTimeout(() => {
    const before = pose(panel);
    panel.querySelector(closeSelector).click();
    closeSample = { t: performance.now() - start, before, after: pose(panel) };
  }, closeAt);
  await wait(Math.max(800, (hydrate || 0) + 450, (closeAt || 0) + 220 + removeDelay + 80));
  active = false;
  const shown = samples.filter(sample => !sample.removed);
  const checks = {
    animated: shown.some(sample => sample.translate !== 'none' && sample.top > 280),
    solid: shown.every(sample => sample.opacity === '1'),
    stableOuter: shown.every(sample => sample.outer === 'none'),
    stableScrim: shown.every(sample => sample.scrimTop === null || Math.abs(sample.scrimTop) < .1),
    noBackgroundScroll: shown.every(sample => sample.scrollTop === 0),
    noErrors: qaErrors.length === 0,
    focusReceived: !!focusSample && focusSample.received,
    focusRetained: !!focusSample && shown.filter(sample => sample.t >= focusSample.t).every(sample => sample.closeFocused),
  };
  // Same-call getComputedStyle after replacing an animation can expose the
  // previous WebKit sampling tick. Preserve these raw boundary readings above,
  // but judge visible direction only from successive animation-frame samples.
  if (hydrationSample) checks.hydrationContinuity = movesUp(shown);
  if (touchSample) checks.touchContinuity = movesUp(shown);
  if (closeSample) {
    const entranceFrames = shown.filter(sample => sample.t < closeSample.t);
    const exitFrames = shown.filter(sample => sample.t >= closeSample.t);
    checks.closeContinuity = movesUp(entranceFrames) && exitFrames.length > 1 && movesDown(exitFrames);
  }
  if (closeAt !== null) {
    checks.oneOriginalClose = commandCount === 1;
    checks.removed = !panel.isConnected;
    const exitHold = shown.filter(sample => sample.t > closeSample.t + 240);
    checks.noExitFlash = exitHold.length > 0 && exitHold.every(sample => sample.top >= innerHeight - 2);
  } else {
    checks.settled = Math.abs(pose(panel).top - 274) < 1;
    const released = shown.filter(sample => sample.t >= focusSample.t && !sample.clipping && sample.translate === 'none');
    checks.clipReleased = released.length > 0 && !pose(panel).clipping;
    checks.focusRetainedAfterClipRelease = released.length > 0 && released.every(sample => sample.closeFocused);
    checks.scrollRestoredAfterClipRelease = released.length > 0 && released.every(sample => sample.overflowY === 'auto');
  }
  const result = {
    name, checks, passed: Object.values(checks).every(Boolean), commandCount,
    hydrationSample, touchSample, closeSample, focusSample, samples,
  };
  results.push(result);
  report(result);
  panel.remove();
  await wait(40);
}
async function checkPrescrolledClose() {
  document.getElementById('open').click();
  const panel = document.createElement('ytm-engagement-panel');
  panel.innerHTML = markup;
  document.querySelector('panel-container').append(panel);
  await wait(430);
  const background = panel.querySelector(backgroundSelector);
  const surface = panel.querySelector('.engagement-panel-container');
  const spacer = document.createElement('div');
  spacer.style.cssText = 'height:1600px;flex-shrink:0';
  background.append(spacer);
  background.scrollTop = 120;
  const before = pose(panel);
  let commandCount = 0, scrollAtOriginalClose = null;
  panel.querySelector(closeSelector).addEventListener('click', () => {
    commandCount++;
    scrollAtOriginalClose = background.scrollTop;
    panel.remove();
  });
  panel.querySelector(closeSelector).click();
  const checks = {
    wrapperWasScrolled: before.scrollTop === 120,
    originalCloseImmediate: commandCount === 1 && !panel.isConnected,
    wrapperScrollPreserved: scrollAtOriginalClose === 120,
    noExitAnimation: surface.getAnimations().length === 0,
  };
  const result = { name: 'pre-scrolled-close', checks, passed: Object.values(checks).every(Boolean), before, commandCount, scrollAtOriginalClose };
  results.push(result);
  report(result);
  panel.remove();
  await wait(40);
}
function checkClipScope() {
  // Isolate selector behavior from YouTube's gesture implementation. The real
  // drag changes .at-top and transform; this fixture does not simulate its touch physics.
  const panel = document.createElement('ytm-engagement-panel');
  panel.innerHTML = '<div class="engagement-panel-section-list-background at-top" style="overflow:hidden">' +
    '<div class="engagement-panel-container" style="transform:translateY(48px)"></div></div>';
  const background = panel.querySelector(backgroundSelector);
  const surface = panel.querySelector('.engagement-panel-container');
  background.setAttribute(movingAttribute, '');
  document.body.append(panel);
  const atTop = { overflow: getComputedStyle(background).overflowY, transform: getComputedStyle(surface).transform };
  background.classList.remove('at-top');
  const dragging = { overflow: getComputedStyle(background).overflowY, transform: getComputedStyle(surface).transform };
  background.removeAttribute(movingAttribute);
  background.classList.add('at-top');
  const idle = { overflow: getComputedStyle(background).overflowY };
  const outside = document.createElement('div');
  outside.className = 'engagement-panel-section-list-background at-top';
  outside.setAttribute(movingAttribute, '');
  outside.style.overflow = 'auto';
  document.body.append(outside);
  const outsidePanel = { overflow: getComputedStyle(outside).overflowY };
  const checks = {
    atTopClipsWhileMoving: atTop.overflow === 'clip',
    dragKeepsOriginalOverflow: dragging.overflow === 'hidden',
    dragTransformUntouched: dragging.transform === atTop.transform && new DOMMatrix(dragging.transform).m42 === 48,
    idleOverflowUnchanged: idle.overflow === 'hidden',
    selectorStaysInsidePanel: outsidePanel.overflow === 'auto',
  };
  const result = { name: 'clip-css-scope', checks, passed: Object.values(checks).every(Boolean), atTop, dragging, idle, outsidePanel };
  results.push(result);
  report(result);
  panel.remove();
  outside.remove();
}
(async () => {
  await scenario('warm-open', null, null, null, 0);
  await scenario('hydrate-120ms', 120, null, null, 0);
  await scenario('hydrate-600ms', 600, null, null, 0);
  await scenario('touch-during-open', null, null, 65, 0);
  await scenario('close-during-open-delayed-removal', null, 90, null, 100);
  await scenario('close-after-open-delayed-removal', null, 430, null, 100);
  await checkPrescrolledClose();
  checkClipScope();
  report({ finished: true, passed: results.every(result => result.passed), errors: qaErrors });
})().catch(error => report({ finished: true, passed: false, error: String(error), stack: error.stack }));
"""
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(head + setup + tests + '</script>', encoding="utf-8")
print(args.output.resolve())
