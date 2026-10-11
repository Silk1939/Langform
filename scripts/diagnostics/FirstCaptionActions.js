// One first-enable measurement in an isolated public-video session.
(async function (win) {
  'use strict';
  var bridge = win.webkit.messageHandlers.qa, wait = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
  function report(row) { bridge.postMessage(row); }
  function visible() {
    return Array.from(document.querySelectorAll('.ytp-caption-segment')).some(function (node) {
      if (!node.textContent.trim() || node.closest('.ytp-caption-window-top')) return false;
      var box = node.getBoundingClientRect(); if (!box.width || !box.height) return false;
      for (var p = node; p; p = p.parentElement) { var css = getComputedStyle(p); if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false; }
      return true;
    });
  }
  var root, video, button, origin = performance.now(), started = false, preloadStarted = false;
  for (var i = 0; i < 200; i++) {
    root = document.getElementById('movie_player'); video = root && root.querySelector('video');
    button = document.querySelector('ytm-closed-captioning-button button');
    if (root && root.playVideo && !started) { root.playVideo(); started = true; }
    if (win.__lfModulePreloadExperiment && root && root.loadModule && !preloadStarted) {
      preloadStarted = true;
      report({ phase: 'preload-before', milliseconds: performance.now()-origin, enabled: root.isSubtitlesOn(), pressed: button && button.getAttribute('aria-pressed') });
      root.loadModule('captions');
    }
    if (video && video.readyState >= 2 && button && button.getAttribute('aria-disabled') !== 'true') break;
    await wait(20);
  }
  if (!video || !button || !root) throw Error('player unavailable');
  // Seek to continuous spoken cues. It is outside the measured UT interval.
  root.seekTo(60, true); await wait(600);
  var initial = root.isSubtitlesOn(), pressed = button.getAttribute('aria-pressed');
  report({ phase: 'before', milliseconds: performance.now()-origin, enabled: initial, pressed: pressed,
    optionsReady: root.getOptions('captions').indexOf('track') >= 0, windows: document.querySelectorAll('.caption-window').length });
  if (initial || pressed === 'true' || document.querySelector('.caption-window')) {
    if (initial) button.click();
    report({ phase: 'failed', finished: true, passed: false, error: 'captions already on before first click', profile: win.__lfPerformanceSnapshot() }); return;
  }
  var clicked = performance.now(); button.click(); var command = performance.now()-clicked, state = null, spoken = null;
  for (var n = 0; n < 600; n++) {
    if (state === null && root.isSubtitlesOn()) state = performance.now()-clicked;
    if (visible()) { spoken = performance.now()-clicked; break; }
    await wait(8);
  }
  var rows = win.__lfPerformanceSnapshot();
  var resources = rows.captionResources.filter(function (r) { return r.startMilliseconds >= clicked; });
  var passed = spoken !== null && root.isSubtitlesOn() && button.getAttribute('aria-pressed') === 'true';
  if (root.isSubtitlesOn()) button.click();
  report({ phase: 'complete', finished: true, passed: passed,
    clickedAtMilliseconds: clicked, milliseconds: spoken, commandMilliseconds: command, stateMilliseconds: state,
    captionNetwork: resources, profile: rows });
})(window).catch(function (e) { window.webkit.messageHandlers.qa.postMessage({ phase:'failed', finished:true, passed:false, error:String(e), profile:window.__lfPerformanceSnapshot() }); });
