(function () {
  'use strict';
  // Read only, called by native UI immediately before a user starts a download.
  // No fetch, player replacement, cookie export or media mutation. Native
  // resolves raw n/signature challenges using this exact page's player script.
  var win = typeof window !== 'undefined' ? window : globalThis;
  function inspect(now) {
    var page;
    try { page = new URL(win.location.href); } catch (_) { return { reason: 'not-watch' }; }
    var videoID = page.searchParams.get('v') || '';
    if (!/^(m\.|www\.)?youtube\.com$/i.test(page.hostname) || page.protocol !== 'https:' || page.pathname !== '/watch' || !/^[\w-]{11}$/.test(videoID)) return { reason: 'not-watch' };
    var response = null, player = win.document && win.document.getElementById('movie_player');
    try { if (player && typeof player.getPlayerResponse === 'function') response = player.getPlayerResponse(); } catch (_) {}
    if (!response || !response.videoDetails || response.videoDetails.videoId !== videoID) response = win.ytInitialPlayerResponse;
    var details = response && response.videoDetails;
    var result = { videoID: videoID, pageURL: page.href, title: details && details.videoId === videoID ? String(details.title || 'Video').slice(0, 300) : 'Video' };
    if (!details || details.videoId !== videoID) return Object.assign(result, { reason: 'stale-response' });
    var lengthSeconds = Number(details.lengthSeconds);
    if (Number.isFinite(lengthSeconds) && lengthSeconds > 0) result.expectedDuration = lengthSeconds;
    result.userAgent = String(win.navigator && win.navigator.userAgent || '').slice(0, 512);
    var playerScript;
    try { playerScript = win.ytcfg && win.ytcfg.get && win.ytcfg.get('PLAYER_JS_URL'); } catch (_) {}
    if (!playerScript) {
      try { playerScript = Array.from(win.document.scripts || []).map(function (script) { return script.src; }).find(function (src) { return /\/s\/player\/.+\/base\.js(?:\?|$)/.test(src); }); } catch (_) {}
    }
    try {
      var scriptURL = new URL(playerScript, page.href);
      if (scriptURL.protocol === 'https:' && /^(?:www\.|m\.)youtube\.com$/i.test(scriptURL.hostname) && !scriptURL.username && !scriptURL.password && /^\/s\/player\/.+\/base\.js$/.test(scriptURL.pathname)) result.playerScriptURL = scriptURL.href;
    } catch (_) {}
    var broadcast = response.microformat && response.microformat.playerMicroformatRenderer && response.microformat.playerMicroformatRenderer.liveBroadcastDetails;
    // `isLiveContent` also describes completed livestream recordings. Those
    // may have ordinary progressive files and must not be rejected as live.
    if (details.isLive || (broadcast && (broadcast.isLiveNow || !broadcast.endTimestamp)) || (details.isLiveContent && !broadcast && !(Number(details.lengthSeconds) > 0))) return Object.assign(result, { reason: 'live' });
    if (response.playabilityStatus && response.playabilityStatus.status && response.playabilityStatus.status !== 'OK') return Object.assign(result, { reason: 'unavailable' });
    var streaming = response.streamingData || {}, formats = streaming.formats || [];
    var video = win.document && win.document.querySelector('video');
    var current = video && (video.currentSrc || video.src) || '', activeURL = null;
    try { if (/^https:/i.test(current)) activeURL = new URL(current); } catch (_) {}
    if (video && video.mediaKeys) return Object.assign(result, { reason: 'protected' });
    if (streaming.licenseInfos || response.drmFamilies || formats.some(function (f) { return f.drmFamilies || f.drmTrackType; })) return Object.assign(result, { reason: 'protected' });
    var observed = [];
    if (activeURL && video.readyState >= 2) observed.push(activeURL);
    // A blob-backed main element can still have made a resolved progressive
    // request. Observe only URLs the browser already requested; never invent
    // an n/signature or remove a segment parameter to construct another URL.
    try {
      var resources = win.performance && win.performance.getEntriesByType && win.performance.getEntriesByType('resource') || [];
      resources.slice(-80).reverse().forEach(function (entry) {
        // Cross-origin status 0 does not establish that a raw URL succeeded.
        if (!(Number(entry.responseStatus) >= 200 && Number(entry.responseStatus) < 300)) return;
        try { observed.push(new URL(entry.name)); } catch (_) {}
      });
    } catch (_) {}
    function completeURL(url) {
      return url.protocol === 'https:' && !url.username && !url.password && /(^|\.)googlevideo\.com$/i.test(url.hostname)
        && !url.searchParams.has('range') && !url.searchParams.has('sq') && url.pathname.indexOf('/manifest/') < 0 && !/\.(?:m3u8|mpd)$/i.test(url.pathname);
    }
    var candidates = [], expired = false;
    formats.forEach(function (format) {
      var mime = String(format.mimeType || '');
      // Both codecs must be declared. `adaptiveFormats` never count as a file.
      if (!/^video\/mp4(?:;|$)/i.test(mime) || !/(?:avc1|avc3|hev1|hvc1|av01)\./i.test(mime) || !/mp4a\./i.test(mime)) return;
      var url, signatureChallenge = null, signatureParameter = null;
      try {
        if (format.url) url = new URL(format.url);
        else {
          var cipher = new URL('https://local.invalid/?' + String(format.signatureCipher || format.cipher || '')).searchParams;
          url = new URL(cipher.get('url'));
          signatureChallenge = cipher.get('s'); signatureParameter = cipher.get('sp') || 'signature';
          if (!signatureChallenge || signatureChallenge.length > 4096 || !/^[A-Za-z0-9_]{1,32}$/.test(signatureParameter)) return;
        }
      } catch (_) { return; }
      var resolved = observed.find(function (candidate) {
        var expiry = Number(candidate.searchParams.get('expire') || 0);
        return completeURL(candidate) && candidate.searchParams.get('id') && candidate.searchParams.get('id') === url.searchParams.get('id')
          && candidate.searchParams.get('itag') === String(format.itag) && (!expiry || Number.isFinite(expiry) && expiry * 1000 > now + 60000);
      });
      if (resolved) { url = resolved; signatureChallenge = null; signatureParameter = null; }
      if (!completeURL(url)) return;
      var expiry = Number(url.searchParams.get('expire') || 0);
      if (expiry && (!Number.isFinite(expiry) || expiry * 1000 <= now + 60000)) { expired = true; return; }
      var length = Number(format.contentLength || 0);
      if (!Number.isSafeInteger(length) || length < 0 || length > 2147483648) return;
      var candidate = { url: url.href, mimeType: mime, expectedBytes: length, height: Number(format.height) || 0, itag: Number(format.itag) || 0,
        requiresResolution: !resolved && (url.searchParams.has('n') || !!signatureChallenge) };
      if (signatureChallenge) { candidate.signatureChallenge = signatureChallenge; candidate.signatureParameter = signatureParameter; }
      candidates.push(candidate);
    });
    candidates.sort(function (a, b) { return b.height - a.height; });
    if (candidates.length) return Object.assign(result, { reason: 'available', source: candidates[0] });
    return Object.assign(result, { reason: expired ? 'expired' : formats.some(function (f) { return f.signatureCipher || f.cipher; }) ? 'cipher' : streaming.adaptiveFormats && streaming.adaptiveFormats.length ? 'adaptive-only' : /^blob:/i.test(current) ? 'blob-only' : streaming.hlsManifestUrl || streaming.dashManifestUrl ? 'stream-only' : 'missing-source' });
  }
  win.__langformDownloadSource = function () { return inspect(Date.now()); };
  if (typeof module !== 'undefined' && module.exports) module.exports = { inspect: inspect };
})();
