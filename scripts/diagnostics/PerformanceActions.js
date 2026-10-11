(async function (win) {
  'use strict';
  var wait = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
  var bridge = win.webkit.messageHandlers.qa;
  function report(row) { bridge.postMessage(row); }
  var root, video, button, origin = performance.now(), requestedPlay = false;
  for (var i = 0; i < 150; i++) {
    root = document.getElementById('movie_player'); video = root && root.querySelector('video');
    button = document.querySelector('ytm-closed-captioning-button button');
    if (root && root.playVideo && !requestedPlay) { root.playVideo(); requestedPlay = true; }
    if (root && root.playVideo && video && button && root.getOptions('captions').indexOf('track') >= 0) break;
    await wait(100);
  }
  if (!video || !button) throw Error('player unavailable');
  report({ phase: 'ready', milliseconds: performance.now() - origin });
  var playAt = performance.now(); root.playVideo();
  await new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(Error('no video frame')); }, 20000);
    video.requestVideoFrameCallback(function () { clearTimeout(timer); resolve(); });
  });
  report({ phase: 'first-frame', milliseconds: performance.now() - origin, playToFrameMilliseconds: performance.now() - playAt });
  root.seekTo(60, true); await wait(1800);
  var initial = root.isSubtitlesOn(), results = [];
  for (var index = 0; index < 6; index++) {
    var expected = !root.isSubtitlesOn(), clicked = performance.now(); button.click();
    var commandMs = performance.now() - clicked, visible = false, stateMs = root.isSubtitlesOn() === expected ? commandMs : null;
    for (var attempt = 0; attempt < 120; attempt++) {
      visible = Array.from(document.querySelectorAll('.ytp-caption-segment')).some(function (n) {
        if (n.closest('.ytp-caption-window-top') || !n.textContent.trim()) return false;
        var box = n.getBoundingClientRect(); return box.width > 0 && box.height > 0;
      });
      if (stateMs === null && root.isSubtitlesOn() === expected) stateMs = performance.now() - clicked;
      if (root.isSubtitlesOn() === expected && (expected ? visible : !document.querySelector('.caption-window'))) break;
      await wait(16);
    }
    var row = { phase: 'toggle', index: index, expected: expected, milliseconds: performance.now() - clicked,
      commandMilliseconds: commandMs, stateMilliseconds: stateMs, clickedAtMilliseconds: clicked,
      passed: root.isSubtitlesOn() === expected && (expected ? visible : !document.querySelector('.caption-window')) };
    results.push(row); report(row); await wait(700);
  }
  if (root.isSubtitlesOn() !== initial) button.click();
  report({ phase: 'complete', finished: true, passed: results.every(function (row) { return row.passed; }), profile: win.__lfPerformanceSnapshot() });
})(window).catch(function (e) { window.webkit.messageHandlers.qa.postMessage({ phase: 'failed', finished: true, passed: false, error: String(e), profile: window.__lfPerformanceSnapshot() }); });
