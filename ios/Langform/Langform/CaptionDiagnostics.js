// Bounded public-video QA, injected only for an explicit diagnostic launch.
// Normal player launches never inject or run this file.
(function (win) {
  'use strict';
  var bridge = win.webkit && win.webkit.messageHandlers && (win.webkit.messageHandlers.qa || win.webkit.messageHandlers.langformPlayerDiagnostics);
  if (!bridge || win.__langformCaptionDiagnostics || win.location.pathname !== '/watch' ||
      new URL(win.location.href).searchParams.get('v') !== 'M7lc1UVf-VE') return;
  win.__langformCaptionDiagnostics = true;
  var doc = win.document, cancelled = false, toggleCalls = 0, originalToggle, hookedRoot, toggleHook;
  var wait = function (ms) { return new Promise(function (resolve) { win.setTimeout(resolve, ms); }); };
  function report(row) {
    row.event = 'captions-probe'; row.videoID = 'M7lc1UVf-VE'; row.unixMilliseconds = Date.now();
    bridge.postMessage(win.webkit.messageHandlers.qa ? row : [row]);
  }
  function cancel(event) { if (event.isTrusted) cancelled = true; }
  doc.addEventListener('touchstart', cancel, true); doc.addEventListener('pointerdown', cancel, true);
  win.addEventListener('pagehide', function () { cancelled = true; });
  function current() {
    if (cancelled || new URL(win.location.href).searchParams.get('v') !== 'M7lc1UVf-VE') throw Error('cancelled/navigation');
    var root = doc.getElementById('movie_player');
    if (!root || !root.getVideoData || root.getVideoData().video_id !== 'M7lc1UVf-VE') return null;
    return root;
  }
  function snapshot(root) {
    var button = doc.querySelector('ytm-closed-captioning-button button');
    var track = root.getOption('captions', 'track') || {}, video = root.querySelector('video');
    var segments = Array.from(doc.querySelectorAll('.ytp-caption-segment')).filter(function (node) {
      // Language-on notification isn't spoken-caption evidence.
      return !node.closest('.ytp-caption-window-top') && node.textContent.trim();
    });
    var visibleSegments = segments.filter(function (node) {
      var box = node.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return false;
      for (var parent = node; parent; parent = parent.parentElement) {
        var css = win.getComputedStyle(parent);
        if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
      }
      return true;
    });
    return { enabled: root.isSubtitlesOn(), pressed: button && button.getAttribute('aria-pressed'),
      language: track.languageCode || '', translation: track.translationLanguage && track.translationLanguage.languageCode || '',
      trackSelected: !!track.languageCode, windows: doc.querySelectorAll('.caption-window').length,
      spokenSegments: segments.length, visibleSpokenSegments: visibleSegments.length, time: video && video.currentTime, paused: video && video.paused,
      muted: video && video.muted, fixLoaded: win.__langformCaptionToggle === true, toggleCalls: toggleCalls };
  }
  (async function () {
    var root, button, started = false;
    for (var i = 0; i < 90; i++) {
      root = current(); button = doc.querySelector('ytm-closed-captioning-button button');
      if (root && root.playVideo && !started) {
        started = true; root.playVideo(); report({ phase: 'explicit-diagnostic-play' });
      }
      if (root && button && button.getAttribute('aria-disabled') !== 'true' && root.isSubtitlesOn &&
          root.getOptions('captions').indexOf('track') >= 0) break;
      await wait(400);
    }
    if (!root || !button || !root.isSubtitlesOn) throw Error('no ready captions button');
    // The fixed video's opening has a caption-free intro. Seek into speech so
    // the evidence can distinguish spoken cues from the language notification.
    root.seekTo(60, true); await wait(2000); current();
    hookedRoot = root; originalToggle = root.toggleSubtitles;
    toggleHook = function () { toggleCalls++; return originalToggle.apply(this, arguments); };
    root.toggleSubtitles = toggleHook;
    if (root.toggleSubtitles !== toggleHook) throw Error('cannot observe actual toggle command');
    function ancestors(node) { var out = []; for (; node; node = node.parentElement) out.push(node.tagName + '#' + node.id); return out; }
    report({ phase: 'before', ...snapshot(root), rootAncestors: ancestors(root), buttonAncestors: ancestors(button) });
    var initial = root.isSubtitlesOn(), language = snapshot(root).language, rows = [], spokenObserved = snapshot(root).visibleSpokenSegments > 0;
    for (var index = 0; index < 6; index++) {
      current(); var expected = !root.isSubtitlesOn(), before = snapshot(root);
      button = doc.querySelector('ytm-closed-captioning-button button'); button.click();
      await wait(expected ? 1200 : 450);
      var after = snapshot(current());
      spokenObserved = spokenObserved || after.visibleSpokenSegments > 0;
      var passed = after.enabled === expected && after.trackSelected === expected &&
        after.pressed === String(expected) && after.toggleCalls === before.toggleCalls + 1 &&
        (expected ? after.visibleSpokenSegments > 0 : after.windows === 0);
      rows.push(passed); report({ phase: 'toggle', index: index, expected: expected, passed: passed, before: before, after: after });
    }
    var last = snapshot(current());
    report({ phase: 'complete', finished: true, passed: rows.every(Boolean) && last.enabled === initial && (!initial || last.language === language), count: rows.length, spokenObserved: spokenObserved, after: last });
  })().catch(function (error) { report({ phase: 'failed', finished: true, passed: false, error: String(error) }); }).finally(function () {
    if (hookedRoot && hookedRoot.toggleSubtitles === toggleHook) hookedRoot.toggleSubtitles = originalToggle;
    doc.removeEventListener('touchstart', cancel, true); doc.removeEventListener('pointerdown', cancel, true);
  });
})(window);
