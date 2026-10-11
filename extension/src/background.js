(function (root) {
  var MESSAGE_TYPE = "langform:summarize";
  var STATUS_TYPE = "langform:summary-status";
  var KEEPALIVE_PORT = "langform:summary-keepalive";
  var HEARTBEAT_TYPE = "langform:summary-heartbeat";
  var NATIVE_HOST = "de.ipekkaya.shorts-ausblenden";
  var ERROR_MESSAGES = {
    UNTRUSTED_SENDER: "Die Kurzfassung konnte auf dieser Seite nicht angefordert werden.",
    INVALID_CAPTIONS: "Die Untertitel konnten nicht an die Kurzfassung übergeben werden.",
    MISSING_CAPTIONS: "Die Untertitel sind leer.",
    CAPTIONS_TOO_LARGE: "Die Untertitel sind für die lokale Kurzfassung gerade zu groß.",
    NATIVE_CONNECTION_UNAVAILABLE: "Die Verbindung zur Kurzfassung-App ist gerade nicht verfügbar.",
    NATIVE_CONNECTION_FAILED: "Die Kurzfassung-App konnte nicht erreicht werden. Bitte versuche es erneut.",
    INVALID_NATIVE_RESPONSE: "Die Kurzfassung-App hat keine gültige Antwort zurückgegeben. Bitte versuche es erneut.",
    NATIVE_TIMEOUT: "Die Kurzfassung braucht zu lange. Bitte versuche es erneut.",
    CANCELLED: "Die Kurzfassung wurde abgebrochen.",
  };
  var MAX_CAPTION_BYTES = 1024 * 1024;
  var CACHE_VERSION = "structured-tldr-3";
  // Changed source preparation must not reuse older model results. A new key
  // also leaves existing older-version storage untouched during this upgrade.
  var CACHE_KEY = "langformSummaryCacheV3";
  var CACHE_LIMIT = 12;
  var CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var CACHE_IO_TIMEOUT_MS = 500;
  var MAX_RESULT_BYTES = 64 * 1024;
  var PROGRESS_INTERVAL_MS = 1000;
  var REQUEST_ID = /^[A-Za-z0-9_-]{12,96}$/;
  var pendingRequests = new Map();
  var progressClients = new Map();
  var nativeProgressRequests = new Map();
  var cacheEntries = null;
  var cacheLoading = null;
  var cacheWrite = Promise.resolve();
  // Long transcripts are read in sections before the final explanation.
  var TIMEOUT_MS = 10 * 60 * 1000;
  var promiseApi = !!(root.browser && root.browser.runtime && root.browser.runtime.onMessage);
  var runtime = promiseApi ? root.browser.runtime : root.chrome && root.chrome.runtime;
  if (!runtime || !runtime.onMessage || typeof runtime.onMessage.addListener !== "function") return;
  var extension = promiseApi ? root.browser : root.chrome;
  var storage = extension.storage && extension.storage.local;

  function storageCall(method, value) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = root.setTimeout(function () { finish(null); }, CACHE_IO_TIMEOUT_MS);
      function finish(result) {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        resolve(result);
      }
      try {
        if (promiseApi) {
          var result = storage[method](value);
          if (!result || typeof result.then !== "function") finish(null);
          else result.then(finish, function () { finish(null); });
        } else {
          storage[method](value, function (result) {
            finish(runtime.lastError ? null : result);
          });
        }
      } catch (error) { finish(null); }
    });
  }

  function cacheableResult(result) {
    if (!result || result.code || result.message || !result.summary) return false;
    var summary = result.summary;
    if (summary.coverage && summary.coverage.complete === false) return false;
    if (!Array.isArray(summary.points) || !summary.points.length || summary.points.length > 8) return false;
    if (!summary.points.every(function (point) { return typeof point === "string" && !!point.trim(); })) return false;
    try { return new TextEncoder().encode(JSON.stringify(result)).byteLength <= MAX_RESULT_BYTES; }
    catch (error) { return false; }
  }

  function validCacheEntry(entry) {
    var age = entry && Date.now() - entry.createdAt;
    return !!(entry && typeof entry.key === "string" && /^[a-f0-9]{64}$/.test(entry.key) &&
      Number.isFinite(age) && age >= 0 && age < CACHE_TTL_MS && cacheableResult(entry.result));
  }

  function loadCache() {
    if (cacheEntries) return Promise.resolve(cacheEntries);
    if (!cacheLoading) {
      cacheLoading = storageCall("get", CACHE_KEY).then(function (stored) {
        cacheLoading = null;
        // A failed/timed-out read leaves the persisted contents unknown. Retry
        // on the next request; never replace them with an empty-cache snapshot.
        if (!stored || typeof stored !== "object") return null;
        var cache = stored && stored[CACHE_KEY];
        cacheEntries = cache && cache.version === CACHE_VERSION && Array.isArray(cache.entries)
          ? cache.entries.filter(validCacheEntry).slice(-CACHE_LIMIT) : [];
        return cacheEntries;
      });
    }
    return cacheLoading;
  }

  function persistentKey(message, privateRequest) {
    if (privateRequest || message.sourceIncomplete === true || !storage || typeof storage.get !== "function" || typeof storage.set !== "function" ||
        !root.crypto || !root.crypto.subtle || typeof root.crypto.subtle.digest !== "function") return null;
    // Only a content fingerprint and the resulting explanation reach extension
    // storage. Captions, video IDs and private-browsing results are never saved.
    var source = CACHE_VERSION + "\n" + (message.sourceIncomplete === true ? "partial\n" : "full\n") + message.text;
    try {
      return root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)).then(function (bytes) {
        return Array.from(new Uint8Array(bytes), function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
      }, function () { return null; });
    } catch (error) { return null; }
  }

  function rememberResult(key, result) {
    if (!key || !cacheEntries || !cacheableResult(result)) return;
    cacheEntries = cacheEntries.filter(function (entry) { return entry.key !== key && validCacheEntry(entry); });
    cacheEntries.push({ key: key, createdAt: Date.now(), result: result });
    cacheEntries = cacheEntries.slice(-CACHE_LIMIT);
    var snapshot = {};
    snapshot[CACHE_KEY] = { version: CACHE_VERSION, entries: cacheEntries };
    // Serial writes preserve every completed request even when two tabs finish
    // together. Storage failures must never turn a valid summary into an error.
    cacheWrite = cacheWrite.then(function () { return storageCall("set", snapshot); });
  }

  function allowedSender(sender) {
    if (!runtime.id || !sender || sender.id !== runtime.id || typeof sender.url !== "string") return false;
    try {
      var url = new URL(sender.url);
      if (url.protocol !== "https:") return false;
      var origin = url.origin;
      return origin === "https://www.youtube.com" || origin === "https://m.youtube.com" || origin === "https://youtube.com";
    } catch (err) {
      return false;
    }
  }

  function failure(code) {
    return { code: code, message: ERROR_MESSAGES[code] };
  }

  function captionError(text) {
    if (typeof text !== "string") return "INVALID_CAPTIONS";
    if (!text.trim()) return "MISSING_CAPTIONS";
    if (text.length > MAX_CAPTION_BYTES || new TextEncoder().encode(text).byteLength > MAX_CAPTION_BYTES) return "CAPTIONS_TOO_LARGE";
    return null;
  }

  function nativeReply(response) {
    if (!response || typeof response !== "object" || Array.isArray(response)) return failure("INVALID_NATIVE_RESPONSE");
    // Only an actual native answer may describe model availability. Empty or
    // malformed transport replies cannot establish the model's state.
    if (response.summary && typeof response.summary === "object" && !Array.isArray(response.summary)) return response;
    if (typeof response.message === "string" && response.message.trim()) return response;
    if (typeof response.code === "string" && response.code.trim()) {
      var coded = Object.assign({}, response);
      if (coded.code !== "MODEL_UNAVAILABLE") coded.message = "Die Kurzfassung konnte gerade nicht erstellt werden. Bitte versuche es erneut.";
      return coded;
    }
    return failure("INVALID_NATIVE_RESPONSE");
  }

  function connectionFailure(error) {
    return failure(error && error.name === "AbortError" ? "CANCELLED" : "NATIVE_CONNECTION_FAILED");
  }

  function isPrivateRequest(sender) {
    return !!(sender.incognito || (sender.tab && sender.tab.incognito) ||
      (extension.extension && extension.extension.inIncognitoContext));
  }

  function progressClientKey(message, sender) {
    if (!allowedSender(sender) || !sender.tab || !Number.isInteger(sender.tab.id) || sender.tab.id < 0 ||
        typeof message.requestId !== "string" || !REQUEST_ID.test(message.requestId)) return null;
    var frameId = sender.frameId == null ? 0 : sender.frameId;
    if (!Number.isInteger(frameId) || frameId < 0) return null;
    // A guessed token in another tab, frame, document or private context does
    // not grant access to its preview. Native status is never queried on demand.
    return JSON.stringify([sender.id, sender.tab.id, frameId, sender.url, isPrivateRequest(sender), message.requestId]);
  }

  function subscribeProgress(job, message, sender) {
    var clientKey = progressClientKey(message, sender);
    if (!clientKey) return;
    var existing = progressClients.get(clientKey);
    if (existing && existing !== job) return;
    progressClients.set(clientKey, job);
    job.clientKeys.add(clientKey);
    if (!job.started && !job.nativeId && !nativeProgressRequests.has(message.requestId)) {
      job.nativeId = message.requestId;
      nativeProgressRequests.set(job.nativeId, job);
    }
  }

  function nativeProgress(response) {
    var progress = response && response.progress;
    if (!progress || typeof progress !== "object" || Array.isArray(progress) ||
        ["preparing", "reading", "reducing", "writing"].indexOf(progress.phase) === -1 ||
        !Number.isInteger(progress.processedSections) || !Number.isInteger(progress.totalSections) ||
        progress.processedSections < 0 || progress.totalSections < progress.processedSections || progress.totalSections > 10000 ||
        typeof progress.sourceIncomplete !== "boolean" || typeof progress.coverageIncomplete !== "boolean") return null;
    var sanitized = {
      phase: progress.phase,
      processedSections: progress.processedSections,
      totalSections: progress.totalSections,
      sourceIncomplete: progress.sourceIncomplete,
      coverageIncomplete: progress.coverageIncomplete,
    };
    // Only final synthesis can provide a whole-source TLDR. Reject oversized
    // text instead of cutting a condition or qualification out of the preview.
    if (progress.phase === "writing" && progress.totalSections > 0 && progress.processedSections === progress.totalSections &&
        !progress.sourceIncomplete && !progress.coverageIncomplete && typeof progress.tldr === "string" && progress.tldr.length <= 2000 && progress.tldr.trim()) {
      sanitized.tldr = progress.tldr.trim();
    }
    return sanitized;
  }

  if (runtime.onConnect && typeof runtime.onConnect.addListener === "function") {
    runtime.onConnect.addListener(function (port) {
      if (!port || port.name !== KEEPALIVE_PORT || !allowedSender(port.sender) ||
          !port.onMessage || typeof port.onMessage.addListener !== "function" ||
          typeof port.postMessage !== "function") {
        if (port && typeof port.disconnect === "function") port.disconnect();
        return;
      }

      var connected = true;
      function disconnect() {
        connected = false;
        if (typeof port.onMessage.removeListener === "function") port.onMessage.removeListener(heartbeat);
        if (port.onDisconnect && typeof port.onDisconnect.removeListener === "function") port.onDisconnect.removeListener(disconnect);
      }
      function heartbeat(message) {
        if (!connected || !message || typeof message !== "object" || Array.isArray(message) ||
            Object.keys(message).length !== 1 || message.type !== HEARTBEAT_TYPE) return;
        try {
          // WebKit unloads nonpersistent backgrounds after 30 seconds unless
          // a port has recent outgoing background activity. Receiving a ping
          // alone does not renew that activity, so answer every heartbeat.
          port.postMessage({ type: "langform:summary-heartbeat-ack" });
        } catch (err) {
          disconnect();
          if (typeof port.disconnect === "function") port.disconnect();
        }
      }
      port.onMessage.addListener(heartbeat);
      if (port.onDisconnect && typeof port.onDisconnect.addListener === "function") port.onDisconnect.addListener(disconnect);
    });
  }

  runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message && message.type === STATUS_TYPE) {
      var clientKey = progressClientKey(message, sender);
      var progressJob = clientKey && progressClients.get(clientKey);
      sendResponse({ progress: progressJob && !progressJob.settled ? progressJob.progress : null });
      return false;
    }
    if (!message || message.type !== MESSAGE_TYPE) return false;
    var rejected = !allowedSender(sender) ? "UNTRUSTED_SENDER" : captionError(message.text);
    if (!rejected && typeof runtime.sendNativeMessage !== "function") rejected = "NATIVE_CONNECTION_UNAVAILABLE";
    if (rejected) {
      sendResponse(failure(rejected));
      return false;
    }

    var privateRequest = isPrivateRequest(sender);
    var requestKey = (privateRequest ? "private\n" : "regular\n") +
      (message.sourceIncomplete === true ? "partial\n" : "full\n") + message.text;
    var shared = pendingRequests.get(requestKey);
    if (shared) {
      shared.responders.push(sendResponse);
      subscribeProgress(shared, message, sender);
      return true;
    }
    var job = { responders: [sendResponse], clientKeys: new Set(), nativeId: null, progress: null, started: false, settled: false };
    pendingRequests.set(requestKey, job);
    subscribeProgress(job, message, sender);
    var settled = false;
    var key = null;
    var progressTimer = 0;
    var progressInFlight = false;
    var timer = root.setTimeout(function () { finish(failure("NATIVE_TIMEOUT")); }, TIMEOUT_MS);
    function finish(response) {
      if (settled) return;
      settled = true;
      job.settled = true;
      root.clearTimeout(timer);
      if (progressTimer) root.clearTimeout(progressTimer);
      progressTimer = 0;
      job.clientKeys.forEach(function (clientKey) {
        if (progressClients.get(clientKey) === job) progressClients.delete(clientKey);
      });
      if (job.nativeId && nativeProgressRequests.get(job.nativeId) === job) nativeProgressRequests.delete(job.nativeId);
      pendingRequests.delete(requestKey);
      var result = nativeReply(response);
      rememberResult(key, result);
      job.responders.forEach(function (respond) {
        try { respond(result); }
        catch (err) { /* A tab may have navigated while another still waits. */ }
      });
    }

    function scheduleProgress() {
      if (settled || !job.nativeId || progressInFlight || progressTimer) return;
      progressTimer = root.setTimeout(pollProgress, PROGRESS_INTERVAL_MS);
    }

    function pollProgress() {
      progressTimer = 0;
      if (settled || progressInFlight) return;
      progressInFlight = true;
      var answered = false;
      function receive(response) {
        if (answered) return;
        answered = true;
        progressInFlight = false;
        if (settled) return;
        var snapshot = nativeProgress(response);
        if (snapshot) job.progress = snapshot;
        scheduleProgress();
      }
      try {
        var body = { operation: "summaryStatus", requestId: job.nativeId };
        if (promiseApi) {
          var pending = runtime.sendNativeMessage(NATIVE_HOST, body);
          if (!pending || typeof pending.then !== "function") receive(null);
          else pending.then(receive, function () { receive(null); });
        } else {
          runtime.sendNativeMessage(NATIVE_HOST, body, function (response) {
            try { receive(runtime.lastError ? null : response); }
            catch (error) { receive(null); }
          });
        }
      } catch (error) { receive(null); }
    }

    function generate() {
      if (settled) return;
      job.started = true;
      try {
        var body = { text: message.text };
        if (job.nativeId) body.requestId = job.nativeId;
        if (typeof message.sourceIncomplete === "boolean") body.sourceIncomplete = message.sourceIncomplete;
        if (promiseApi) {
          // Safari/browser uses the promise form. Never call the host a second
          // time to try another signature: generation is an expensive request.
          var pending = runtime.sendNativeMessage(NATIVE_HOST, body);
          if (!pending || typeof pending.then !== "function") finish(failure("NATIVE_CONNECTION_FAILED"));
          else pending.then(finish, function (error) { finish(connectionFailure(error)); });
        } else {
          runtime.sendNativeMessage(NATIVE_HOST, body, function (response) {
            try {
              var error = runtime.lastError;
              finish(error ? connectionFailure(error) : response);
            } catch (error) {
              finish(connectionFailure(error));
            }
          });
        }
        // The original native request remains open and owns generation.
        // Optional status requests cannot settle it or start replacement work.
        scheduleProgress();
      } catch (err) {
        finish(connectionFailure(err));
      }
    }
    var fingerprint = persistentKey(message, privateRequest);
    if (!fingerprint) generate();
    else fingerprint.then(function (value) {
      key = value;
      if (!key || settled) { generate(); return; }
      return loadCache().then(function (entries) {
        if (!entries) { key = null; generate(); return; }
        var cached = entries.find(function (entry) { return entry.key === key && validCacheEntry(entry); });
        if (cached) {
          // Reusing a result never extends its original expiry date.
          key = null;
          finish(cached.result);
        } else generate();
      });
    }).catch(function () { generate(); });
    // Keep Safari/Chrome's response channel open until the native reply.
    return true;
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
