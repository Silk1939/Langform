// Opt-in sponsor skipping. The native bridge queries only a four-character
// SHA-256 prefix; account identifiers, cookies and referrers are never sent.
(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformSponsorBlock) return;
  var doc = win.document, key = 'langform.sponsorblock.enabled', active = true, navigating = false;
  function pageInactive() {
    try { var visibility=win.__langformRealVisibility; if (visibility && typeof visibility.inactive==='function') return !!visibility.inactive(); } catch (_) {}
    return !!doc.hidden;
  }
  var enabled = false, id = '', status = 'off', segments = [], pending = null, serial = 0, timer = 0;
  var cache = new Map(), attempted = new Set(), ignored = new Set(), lastSkip = null, waitingSkip = null, waitingUndo = null, skipped = 0, published = '';
  try { enabled = win.localStorage.getItem(key) === 'true'; } catch (_) {}
  function pageID() {
    try {
      var url = new URL(win.location.href), value = url.searchParams.get('v') || '';
      return url.protocol === 'https:' && /^(m\.|www\.)?youtube\.com$/.test(url.hostname) && url.pathname === '/watch' && /^[A-Za-z0-9_-]{11}$/.test(value) ? value : '';
    } catch (_) { return ''; }
  }
  function media() {
    var root = doc.getElementById('movie_player'), video = root && root.querySelector('video'), data;
    if (!active || navigating || !id || pageID() !== id || !root || !video || !video.isConnected) return null;
    try { data = root.getVideoData && root.getVideoData(); } catch (_) { return null; }
    if (!data || data.video_id !== id || data.isAd || root.classList.contains('ad-showing') || root.classList.contains('ad-interrupting') ||
        video.webkitCurrentPlaybackTargetIsWireless || video.remote && video.remote.state === 'connected') return null;
    return { root:root, video:video };
  }
  function getStatus() {
    return { enabled:enabled, videoID:id, status:status, segments:segments.length, skipped:skipped,
      canUndo:!!owns(lastSkip,media()) };
  }
  function publish() {
    var value = getStatus(), signature = JSON.stringify(value);
    if (signature === published) return;
    published = signature;
    win.dispatchEvent(new win.CustomEvent('langform-sponsorblock-state', { detail:value }));
  }
  function post(value) {
    try {
      var handler = win.webkit && win.webkit.messageHandlers && win.webkit.messageHandlers.langformSponsorBlock;
      if (!handler || typeof handler.postMessage !== 'function') return false;
      handler.postMessage(value); return true;
    } catch (_) { return false; }
  }
  function cancel() {
    if (timer) win.clearTimeout(timer);
    timer = 0;
    if (pending) post({ kind:'cancel', requestID:pending.token, videoID:pending.id });
    pending = null;
  }
  function normalize(items) {
    if (!Array.isArray(items) || items.length > 500) return [];
    return items.filter(function (item) {
      return item && item.category === 'sponsor' && item.actionType === 'skip' && Array.isArray(item.segment) && item.segment.length === 2 &&
        item.segment.every(function (n) { return typeof n === 'number' && Number.isFinite(n) && n >= 0; }) &&
        item.segment[1] > item.segment[0] && item.segment[1] <= 604800 &&
        (item.videoDuration === undefined || typeof item.videoDuration === 'number' && Number.isFinite(item.videoDuration) && item.videoDuration >= 0) &&
        (!(item.videoDuration > 0) || item.segment[1] <= item.videoDuration + 1);
    }).map(function (item) {
      return { start:item.segment[0], end:item.segment[1], duration:item.videoDuration || 0,
        key:String(item.UUID || '') + ':' + item.segment.join(':') };
    }).sort(function (a,b) { return a.start - b.start || a.end - b.end; });
  }
  function request(force) {
    if (!enabled || !active || navigating || !id || pageID() !== id || pending) return;
    var cached = cache.get(id);
    if (!force && cached && Date.now() - cached.at < 600000) {
      segments = cached.items; status = segments.length ? 'ready' : 'empty'; publish(); return;
    }
    var requestID = Date.now().toString(36) + '-' + (++serial).toString(36);
    pending = { id:id, token:requestID }; status = 'loading'; publish();
    timer = win.setTimeout(function () {
      if (!pending || pending.token !== requestID) return;
      cancel(); status = 'unavailable'; publish();
    }, 10000);
    if (!post({ kind:'fetch', videoID:id, requestID:requestID })) { cancel(); status = 'unavailable'; publish(); }
  }
  function receive(value) {
    if (!value || !pending || value.requestID !== pending.token || value.videoID !== pending.id ||
        value.videoID !== id || pageID() !== id || !enabled || !active || navigating) return false;
    if (timer) win.clearTimeout(timer);
    timer = 0; pending = null;
    if (value.status !== 'ok' && value.status !== 'empty') { status = 'unavailable'; segments = []; publish(); return true; }
    segments = normalize(value.segments || []); status = segments.length ? 'ready' : 'empty';
    cache.delete(id); cache.set(id, { at:Date.now(), items:segments });
    if (cache.size > 20) cache.delete(cache.keys().next().value);
    publish();
    // A late database response must wait for the next actual playback event.
    // Enabling a switch or loading metadata alone never seeks the video.
    return true;
  }
  function seek(current, target) {
    try {
      if (typeof current.root.seekTo === 'function') current.root.seekTo(target, true);
      else current.video.currentTime = target;
      return true;
    } catch (_) { return false; }
  }
  function owns(owner,current) {
    return !!(owner && current && owner.id === id && owner.video === current.video && owner.root === current.root &&
      (current.video.currentSrc || current.video.src || '') === owner.source);
  }
  function waitingOwner(current) {
    var waiting = waitingSkip;
    if (!waiting) return null;
    if (!owns(waiting,current) || Date.now() > waiting.until) { waitingSkip = null; return null; }
    return waiting;
  }
  function confirmSkip(current,kind) {
    var waiting = waitingOwner(current);
    if (!waiting || kind !== 'command' && !((kind === 'seeking' || kind === 'seeked') && waiting.sawSeeking)) return;
    var time = Number(current.video.currentTime);
    // A later natural timeupdate cannot establish that our command worked.
    // Accept the immediate jump, or a real seek that starts within three
    // seconds. Once started, a slow buffer may finish within thirty seconds;
    // the position must still match. Natural playback never confirms a skip.
    if (!Number.isFinite(time) || time < waiting.target - 0.05 || time > waiting.target + 1 || time <= waiting.from + 0.025) return;
    lastSkip = { id:id, root:waiting.root, video:waiting.video, source:waiting.source, from:waiting.from, keys:waiting.keys };
    waitingSkip = null; skipped += 1; publish();
  }
  function undoOwner(current) {
    var waiting = waitingUndo;
    if (!waiting) return null;
    if (!owns(waiting,current) || waiting.previous !== lastSkip || Date.now() > waiting.until) { waitingUndo = null; return null; }
    return waiting;
  }
  function confirmUndo(current,kind) {
    var waiting = undoOwner(current);
    if (!waiting || kind !== 'command' && !((kind === 'seeking' || kind === 'seeked') && waiting.sawSeeking)) return;
    var time = Number(current.video.currentTime);
    if (!Number.isFinite(time) || time < waiting.target - 0.05 || time > waiting.target + 1 ||
        (waiting.target < waiting.from ? time >= waiting.from - 0.025 : time <= waiting.from + 0.025)) return;
    waiting.previous.keys.forEach(function (value) { ignored.add(value); });
    waitingUndo = null; lastSkip = null; publish();
  }
  function sample(event) {
    var current = media();
    if (lastSkip && !owns(lastSkip,current)) { lastSkip = null; waitingUndo = null; publish(); }
    if (current && event.target === current.video) { waitingOwner(current); undoOwner(current); }
    if (!enabled || status !== 'ready' || !current || event.target !== current.video || pageInactive() ||
        current.video.paused || current.video.ended || current.video.seeking || current.video.error || current.video.readyState < 2) return;
    var video = current.video, duration = Number(video.duration), time = Number(video.currentTime);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(time) || time < 0) return;
    var available = segments.filter(function (item) {
      return !ignored.has(item.key) && (!item.duration || Math.abs(item.duration - duration) <= Math.max(2,duration * 0.02)) && item.end <= duration;
    });
    var item = available.find(function (value) { return time >= value.start && time < value.end - 0.05; });
    if (!item || attempted.has(item.key)) return;
    var group = [item], end = item.end;
    available.forEach(function (next) {
      if (next !== item && next.start <= end && next.end > item.start) { group.push(next); end = Math.max(end,next.end); }
    });
    group.forEach(function (value) { attempted.add(value.key); });
    waitingSkip = { id:id, root:current.root, video:video, source:video.currentSrc || video.src || '',
      from:time, target:end, until:Date.now() + 3000, sawSeeking:false, keys:group.map(function (value) { return value.key; }) };
    if (seek(current,end)) {
      confirmSkip(current,'command');
    } else waitingSkip = null;
  }
  function undo() {
    var current = media(), previous = lastSkip;
    if (!owns(previous,current)) { waitingUndo = null; publish(); return false; }
    var duration = Number(current.video.duration);
    if (!Number.isFinite(duration) || previous.from >= duration) return false;
    // An ignored/failed command keeps the option for a deliberate retry. Only
    // the actual return to this media owner's sponsor commits the exception.
    waitingUndo = { id:id, root:current.root, video:current.video, source:previous.source, previous:previous,
      from:Number(current.video.currentTime), target:previous.from, until:Date.now() + 3000, sawSeeking:false };
    if (!seek(current,previous.from)) { waitingUndo = null; return false; }
    confirmUndo(current,'command');
    return lastSkip !== previous;
  }
  function navigate() {
    var next = pageID();
    navigating = false;
    if (next !== id) { cancel(); id = next; segments = []; attempted.clear(); ignored.clear(); lastSkip = null; waitingSkip = null; waitingUndo = null; skipped = 0; }
    if (!enabled || !id) { status = 'off'; publish(); return; }
    if (!pending && status !== 'ready' && status !== 'empty') request(false);
    // After a cancelled same-video navigation a fresh owner may use the cache.
    else if (!pending && !segments.length) request(false);
    publish();
  }
  win.__langformSponsorBlockReceive = receive;
  win.__langformSponsorBlock = {
    getStatus:getStatus,
    setEnabled:function (value) {
      enabled = value === true;
      try { win.localStorage.setItem(key, String(enabled)); } catch (_) {}
      cancel(); segments = []; lastSkip = null; waitingSkip = null; waitingUndo = null; attempted.clear(); ignored.clear(); status = 'off';
      navigate(); return getStatus();
    },
    undo:undo,
    retry:function () { cancel(); request(true); return getStatus(); }
  };
  ['timeupdate','playing'].forEach(function (name) { doc.addEventListener(name,sample,true); });
  doc.addEventListener('seeking',function (event) {
    var current = media(), waiting = waitingOwner(current);
    if (waiting && event.target === current.video) {
      if (!waiting.sawSeeking) { waiting.sawSeeking = true; waiting.until = Date.now() + 30000; }
      confirmSkip(current,'seeking');
    }
    var undoing = undoOwner(current);
    if (undoing && event.target === current.video) {
      if (!undoing.sawSeeking) { undoing.sawSeeking = true; undoing.until = Date.now() + 30000; }
      confirmUndo(current,'seeking');
    }
  },true);
  doc.addEventListener('seeked',function (event) { var current = media(); if (current && event.target === current.video) { confirmSkip(current,'seeked'); confirmUndo(current,'seeked'); } },true);
  ['loadstart','emptied'].forEach(function (name) {
    doc.addEventListener(name,function (event) {
      if (lastSkip && event.target === lastSkip.video) { lastSkip = null; waitingSkip = null; waitingUndo = null; publish(); }
    },true);
  });
  doc.addEventListener('yt-navigate-start',function () { navigating = true; cancel(); lastSkip = null; waitingSkip = null; waitingUndo = null; status = enabled ? 'loading' : 'off'; publish(); });
  ['yt-navigate-finish','state-navigateend'].forEach(function (name) { win.addEventListener(name,navigate); });
  win.addEventListener('popstate',navigate);
  win.addEventListener('pagehide',function () { active = false; cancel(); lastSkip = null; waitingSkip = null; waitingUndo = null; publish(); });
  win.addEventListener('pageshow',function () { active = true; navigate(); });
  ['visibilitychange','langform-real-visibilitychange'].forEach(function(name){doc.addEventListener(name,function () { if (pageInactive()) { waitingSkip = null; waitingUndo = null; } });});
  doc.addEventListener('DOMContentLoaded',navigate,{ once:true });
  navigate();
})(window);
