// Use the player's real caption state, rather than the mobile button's cached
// track/aria state. toggleSubtitles(true) toggles both ways; its argument marks
// a user choice. toggleSubtitlesOn is deliberately not used (enable only).
(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformCaptionToggle) return;
  if (!/^(m\.|www\.)?youtube\.com$/.test(win.location.hostname)) return;
  win.__langformCaptionToggle = true;
  var doc = win.document, active = true;
  var selector = 'ytm-closed-captioning-button button,yt-closed-captions-toggle-button button';
  function click(event) {
    if (!active || event.defaultPrevented) return;
    var button = event.target && event.target.closest && event.target.closest(selector);
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    var root = doc.getElementById('movie_player');
    if (!root || typeof root.toggleSubtitles !== 'function' || typeof root.isSubtitlesOn !== 'function' ||
        typeof root.getVideoData !== 'function' || typeof root.getOptions !== 'function') return;
    var owner = root.closest('#player-container-id,ytm-player');
    if (!owner || button.closest('#player-container-id,ytm-player') !== owner || !root.querySelector('video')) return;
    var before;
    try {
      var url = new URL(win.location.href), info = root.getVideoData();
      if (url.pathname !== '/watch' || !info || !info.video_id || info.video_id !== url.searchParams.get('v') ||
          info.isAd || root.classList.contains('ad-showing') || root.classList.contains('ad-interrupting') ||
          root.getOptions('captions').indexOf('track') < 0) return;
      before = root.isSubtitlesOn();
      if (typeof before !== 'boolean') return;
      root.toggleSubtitles(true);
    } catch (_) {
      // Keep the original action on unsupported APIs. A command that already
      // changed captions must not be followed by another toggle after an error.
      try { if (typeof before !== 'boolean' || root.isSubtitlesOn() === before) return; }
      catch (_) { return; }
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  win.addEventListener('click', click, true);
  win.addEventListener('pagehide', function () { active = false; });
  win.addEventListener('pageshow', function () { active = true; });
})(window);
