// Read-only metadata belongs to the active main medium, never to a preview/ad.
// Playback commands are invoked only by native system controls explicitly.
(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformSystemMediaInstalled) return;
  win.__langformSystemMediaInstalled = true;
  var doc = win.document, active = true, last = '', lastAt = -Infinity, waitingForVideo = null;
  function id() {
    try {
      var url = new URL(win.location.href);
      return url.protocol === 'https:' && /^(m\.|www\.)?youtube\.com$/.test(url.hostname) && url.pathname === '/watch'
        && /^[A-Za-z0-9_-]{11}$/.test(url.searchParams.get('v') || '') ? url.searchParams.get('v') : '';
    } catch (_) { return ''; }
  }
  function media(expected) {
    var current = id(), root = doc.getElementById('movie_player');
    if (!active || !current || (expected && expected !== current) || !root) return null;
    var data, video = root.querySelector('video');
    try { data = root.getVideoData && root.getVideoData(); } catch (_) { return null; }
    if (!data || data.video_id !== current || data.isAd || !video || !video.isConnected ||
        root.classList.contains('ad-showing') || root.classList.contains('ad-interrupting')) return null;
    return { id:current, root:root, data:data, video:video };
  }
  function post(payload) {
    var handlers = win.webkit && win.webkit.messageHandlers, handler = handlers && handlers.langformSystemMedia;
    if (handler && typeof handler.postMessage === 'function') handler.postMessage(payload);
  }
  function publish(force) {
    if (!active) return;
    var current = media(), now = win.performance.now();
    if (!current) {
      var clear = 'clear:' + id();
      if (last !== clear) { last = clear; post({ kind:'clear', videoID:id() }); }
      return;
    }
    var video = current.video, duration = Number(video.duration), elapsed = Number(video.currentTime);
    if (!Number.isFinite(elapsed) || elapsed < 0) return;
    var playing = !video.paused && !video.ended && !video.error && video.readyState >= 3 && waitingForVideo !== video;
    var rate = Number(video.playbackRate);
    var payload = { kind:'state', videoID:current.id, title:String(current.data.title || 'Video').slice(0,180),
      channel:String(current.data.author || '').slice(0,120), elapsed:elapsed,
      duration:Number.isFinite(duration) && duration > 0 ? duration : null,
      playing:playing, rate:Number.isFinite(rate) && rate > 0 && rate <= 4 ? rate : 1 };
    var key = JSON.stringify([payload.videoID,payload.title,payload.channel,payload.duration,payload.playing,payload.rate]);
    if (!force && key === last && now - lastAt < 5000) return;
    last = key; lastAt = now; post(payload);
  }
  win.__langformPublishSystemMedia = function () { publish(true); };
  win.__langformSystemCommand = function (expected, command, value) {
    var current = media(expected);
    if (!current || (win.__langformIsNativeDragging && win.__langformIsNativeDragging())) return false;
    var root = current.root, video = current.video;
    try {
      if (command === 'play' || (command === 'toggle' && (video.paused || video.ended))) {
        return !!(win.__langformPlay && win.__langformPlay(expected));
      }
      if (command === 'pause' || command === 'toggle') {
        if (win.__langformWatchBackgroundAudio && typeof win.__langformWatchBackgroundAudio.explicitAction==='function')
          win.__langformWatchBackgroundAudio.explicitAction(expected);
        if (!video.paused) { if (typeof root.pauseVideo === 'function') root.pauseVideo(); else video.pause(); }
      } else if (command === 'skip' || command === 'position') {
        var duration = Number(video.duration), amount = Number(value);
        if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(amount)) return false;
        var target = command === 'skip' ? Number(video.currentTime) + amount : amount;
        if (!Number.isFinite(target)) return false;
        target = Math.max(0, Math.min(duration, target));
        if (typeof root.seekTo === 'function') root.seekTo(target, true); else video.currentTime = target;
      } else return false;
      publish(true);
      return true;
    } catch (_) { return false; }
  };
  var events = ['play','playing','pause','waiting','stalled','ended','error','durationchange','loadedmetadata','seeked','ratechange','timeupdate'];
  events.forEach(function (name) {
    doc.addEventListener(name, function (event) {
      var current = media();
      if (current && event.target === current.video) {
        if (name === 'waiting' || name === 'stalled') waitingForVideo = current.video;
        else if (name === 'playing' || name === 'pause' || name === 'ended') waitingForVideo = null;
        publish(name !== 'timeupdate');
      } else if (!current) {
        var root = doc.getElementById('movie_player');
        // Ad or route replacement can invalidate media before its event. Clear
        // the old system card then; previews elsewhere cannot publish it.
        if (root && event.target && event.target.tagName === 'VIDEO' && root.contains(event.target)) publish(true);
      }
    }, true);
  });
  function navigation() { last = ''; waitingForVideo = null; publish(true); }
  doc.addEventListener('yt-navigate-start', function () { last = ''; post({ kind:'clear', videoID:id() }); });
  doc.addEventListener('yt-navigate-finish', navigation);
  win.addEventListener('popstate', navigation);
  win.addEventListener('pageshow', function () { active = true; navigation(); });
  win.addEventListener('pagehide', function () { active = false; last = ''; post({ kind:'clear', videoID:id() }); });
  publish(true);
})(window);
