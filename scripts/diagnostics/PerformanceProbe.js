// Diagnostic-only callback attribution. Loaded before shipping scripts.
(function (win) {
  'use strict';
  var stats = {}, current = '', started = performance.now(), frames = [], lastFrame = 0;
  performance.setResourceTimingBufferSize(2000);
  var captionRequests = [], xhrOpen = win.XMLHttpRequest.prototype.open, xhrSend = win.XMLHttpRequest.prototype.send;
  var requests = new WeakMap();
  win.XMLHttpRequest.prototype.open = function (method, url) {
    if (/\/api\/timedtext(?:\?|$)/.test(String(url))) {
      var row = { openMilliseconds: performance.now(), sendMilliseconds: 0 };
      captionRequests.push(row); requests.set(this, row);
      this.addEventListener('load', function () {
        var cache = this.getResponseHeader('cache-control') || '';
        row.noStore = /no-store/.test(cache); row.noCache = /no-cache/.test(cache);
      });
    }
    return xhrOpen.apply(this, arguments);
  };
  win.XMLHttpRequest.prototype.send = function () {
    var row = requests.get(this); if (row) row.sendMilliseconds = performance.now();
    return xhrSend.apply(this, arguments);
  };
  win.__lfProfileSource = '';
  win.__lfRecordFunction = function (name, elapsed) {
    var key = 'page-captions:function-' + name;
    var row = stats[key] || (stats[key] = { calls: 0, milliseconds: 0, maxMilliseconds: 0 });
    row.calls++; row.milliseconds += elapsed; row.maxMilliseconds = Math.max(row.maxMilliseconds, elapsed);
  };
  function wrap(fn, type, owner) {
    if (typeof fn !== 'function' || !owner) return fn;
    return function () {
      var previous = current, begin = performance.now(); current = owner;
      try { return fn.apply(this, arguments); }
      finally {
        var elapsed = performance.now() - begin, key = owner + ':' + type;
        var row = stats[key] || (stats[key] = { calls: 0, milliseconds: 0, maxMilliseconds: 0 });
        row.calls++; row.milliseconds += elapsed; row.maxMilliseconds = Math.max(row.maxMilliseconds, elapsed);
        current = previous;
      }
    };
  }
  var Observer = win.MutationObserver;
  win.MutationObserver = function (fn) { return new Observer(wrap(fn, 'mutation', current || win.__lfProfileSource)); };
  win.MutationObserver.prototype = Observer.prototype;
  var listeners = new WeakMap(), add = win.EventTarget.prototype.addEventListener, remove = win.EventTarget.prototype.removeEventListener;
  win.EventTarget.prototype.addEventListener = function (type, listener, options) {
    var owner = current || win.__lfProfileSource, capture = typeof options === 'boolean' ? options : !!(options && options.capture);
    var key = type + ':' + capture, map = listeners.get(this);
    if (owner && typeof listener === 'function') {
      if (!map) { map = {}; listeners.set(this, map); }
      if (!map[key]) map[key] = new WeakMap();
      var wrapped = map[key].get(listener);
      if (!wrapped) { wrapped = wrap(listener, 'event', owner); map[key].set(listener, wrapped); }
      listener = wrapped;
    }
    return add.call(this, type, listener, options);
  };
  win.EventTarget.prototype.removeEventListener = function (type, listener, options) {
    var capture = typeof options === 'boolean' ? options : !!(options && options.capture), map = listeners.get(this), key = type + ':' + capture;
    return remove.call(this, type, map && map[key] && map[key].get(listener) || listener, options);
  };
  ['setTimeout', 'setInterval', 'requestAnimationFrame'].forEach(function (name) {
    var original = win[name]; win[name] = function (fn) {
      var args = Array.from(arguments); args[0] = wrap(fn, name, current || win.__lfProfileSource);
      return original.apply(win, args);
    };
  });
  var nativeFrame = win.requestAnimationFrame;
  function frame(now) { if (lastFrame) frames.push(now - lastFrame); lastFrame = now; nativeFrame(frame); }
  nativeFrame(frame);
  win.__lfPerformanceSnapshot = function () {
    var captionKeys = [];
    return { elapsedMilliseconds: performance.now() - started, callbacks: stats,
      captionResources: performance.getEntriesByType('resource').filter(function (r) { return /\/api\/timedtext(?:\?|$)/.test(r.name); }).map(function (r) {
        var key = captionKeys.indexOf(r.name); if (key < 0) { key = captionKeys.length; captionKeys.push(r.name); }
        var url = new URL(r.name), formats = ['json3','srv1','srv2','srv3','ttml','vtt'];
        var response = (document.getElementById('movie_player') && typeof document.getElementById('movie_player').getPlayerResponse === 'function' ? document.getElementById('movie_player').getPlayerResponse() : win.ytInitialPlayerResponse), tracks = response && response.captions && response.captions.playerCaptionsTracklistRenderer.captionTracks || [];
        var extras = ['fmt','xorb','xobt','xovt','c','cbr','cbrver','cplayer'];
        function normalize(value) { var candidate=new URL(value, location.href); extras.forEach(function(k){candidate.searchParams.delete(k);}); return candidate.href; }
        var baseTrackIndex = tracks.findIndex(function(t){return normalize(t.baseUrl)===normalize(url.href);});
        var request = captionRequests.find(function(q){return Math.abs(q.sendMilliseconds-r.startTime)<20;}) || {};
        return { requestKey: key, transport: r.initiatorType, formatCode: formats.indexOf(url.searchParams.get('fmt'))+1, baseTrackIndex: baseTrackIndex+1, extraParamMask: extras.reduce(function(mask,k,i){return mask+(url.searchParams.has(k)?Math.pow(2,i):0);},0), openMilliseconds: request.openMilliseconds || 0, sendMilliseconds: request.sendMilliseconds || 0, noStore: !!request.noStore, noCache: !!request.noCache, startMilliseconds: r.startTime, durationMilliseconds: r.duration, dnsMilliseconds: r.domainLookupEnd-r.domainLookupStart, connectMilliseconds: r.connectEnd-r.connectStart, tlsMilliseconds: r.secureConnectionStart ? r.connectEnd-r.secureConnectionStart : 0, requestStartMilliseconds: r.requestStart, responseStartMilliseconds: r.responseStart, responseEndMilliseconds: r.responseEnd, transferBytes: r.transferSize, bodyBytes: r.decodedBodySize };
      }),
      frameGapsOver50ms: frames.filter(function (v) { return v > 50; }).length,
      maxFrameGapMilliseconds: Math.max(0, ...frames),
      navigation: performance.getEntriesByType('navigation').map(function (n) {
        return { responseStart: n.responseStart, responseEnd: n.responseEnd, domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd };
      }) };
  };
})(window);
