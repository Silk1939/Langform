// Browser-extension MAIN-world response filtering. The native iPhone player
// does not load this file; no media, DOM controls or request options are changed.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else if (root && root.document) api.install(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var FLAG = "__langformPageAdblock";
  var AD_KEYS = ["adPlacements", "playerAds", "adSlots"];
  var WRAPPERS = ["playerResponse", "response"];
  var parseJSON = JSON.parse;
  var stringifyJSON = JSON.stringify;

  function playerShape(value) {
    return ["videoDetails", "playabilityStatus", "streamingData"].some(function (key) {
      var property = Object.getOwnPropertyDescriptor(value, key);
      return property && Object.prototype.hasOwnProperty.call(property, "value") &&
        property.value && typeof property.value === "object";
    });
  }

  function clean(value, change, seen, depth, known) {
    if (!value || typeof value !== "object" || depth > 12 || seen.has(value)) return value;
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        // Player batch responses are short; never walk an arbitrary feed tree.
        for (var i = 0; i < Math.min(value.length, 256); i++) {
          var item = Object.getOwnPropertyDescriptor(value, String(i));
          if (item && Object.prototype.hasOwnProperty.call(item, "value")) clean(item.value, change, seen, depth + 1, known);
        }
        return value;
      }
      known = known || playerShape(value);
      if (known) AD_KEYS.forEach(function (key) {
        var property = Object.getOwnPropertyDescriptor(value, key);
        if (property && property.configurable && Reflect.deleteProperty(value, key)) change.changed = true;
      });
      WRAPPERS.forEach(function (key) {
        var property = Object.getOwnPropertyDescriptor(value, key);
        if (property && Object.prototype.hasOwnProperty.call(property, "value")) clean(property.value, change, seen, depth + 1, known || key === "playerResponse");
      });
    } catch (_) { /* Frozen values and foreign objects retain their native behavior. */ }
    return value;
  }

  function prune(value, known) { return clean(value, { changed: false }, new WeakSet(), 0, known === true); }

  function pruneText(text, known) {
    if (typeof text !== "string" || !/"(?:adPlacements|playerAds|adSlots)"\s*:/.test(text)) return text;
    try {
      var value = Reflect.apply(parseJSON, JSON, [text]);
      var change = { changed: false };
      clean(value, change, new WeakSet(), 0, known === true);
      return change.changed ? Reflect.apply(stringifyJSON, JSON, [value]) : text;
    } catch (_) { return text; }
  }

  function requestURL(value) {
    if (typeof value === "string") return value;
    if (value && typeof value.url === "string") return value.url;
    if (value && typeof value.href === "string") return value.href;
    return "";
  }

  function matchesURL(value, base) {
    try {
      var url = new URL(requestURL(value), base);
      return (url.origin === "https://www.youtube.com" || url.origin === "https://m.youtube.com") &&
        !/get_drm_license/i.test(url.pathname + url.search) &&
        (/^\/youtubei\/v\d+\/(?:player|get_watch|next)\/?$/.test(url.pathname) || /^\/playlist\/?$/.test(url.pathname));
    } catch (_) { return false; }
  }

  function install(win) {
    if (!win || !win.document || !win.location || win.location.protocol !== "https:" ||
        !/^(www|m)\.youtube\.com$/.test(win.location.hostname)) return null;
    if (win[FLAG]) return win[FLAG];
    var state = { active: true };
    win[FLAG] = state;
    var targetResponses = new WeakSet();
    var responseHooks = Object.create(null);
    var hookedProperties = new WeakMap();
    var xhrRequests = new WeakMap();
    var base = win.location.href;

    function activePrune(value) { return state.active ? prune(value) : value; }
    function playerPrune(value) { return state.active ? prune(value, true) : value; }
    function activeText(value) { return state.active ? pruneText(value, true) : value; }
    function matching(value) { return matchesURL(value, base); }
    function replace(object, key, value) {
      try { Object.defineProperty(object, key, { configurable: true, writable: true, value: value }); return true; }
      catch (_) { return false; /* A page may lock a native entry point before injection. */ }
    }

    // Cover initial inline assignments as well as later SPA player responses.
    // Existing accessor receivers and read-only/nonconfigurable semantics survive.
    function watchProperty(object, key, transform) {
      if (!object || (typeof object !== "object" && typeof object !== "function")) return;
      var names = hookedProperties.get(object);
      if (!names) { names = new Set(); hookedProperties.set(object, names); }
      if (names.has(key)) return;
      names.add(key);
      try {
        var original = Object.getOwnPropertyDescriptor(object, key);
        if (original && (!original.configurable || ("value" in original && !original.writable))) {
          transform("value" in original ? original.value : original.get && Reflect.apply(original.get, object, []));
          return;
        }
        var stored = original && original.value;
        var accessor = original && !("value" in original);
        var descriptor = { configurable: true, enumerable: original ? original.enumerable : true,
          get: function () {
            var value = accessor ? original.get && Reflect.apply(original.get, this, []) : stored;
            return state.active ? transform(value) : value;
          } };
        if (!accessor || original.set) descriptor.set = function (value) {
          var next = state.active ? transform(value) : value;
          if (accessor) Reflect.apply(original.set, this, [next]);
          else stored = next;
        };
        Object.defineProperty(object, key, descriptor);
        if (!accessor && state.active) stored = transform(stored);
      } catch (_) { /* An unavailable global must not block the original player. */ }
    }
    function playerValue(value) { return typeof value === "string" ? activeText(value) : playerPrune(value); }
    function playerArgs(value) {
      watchProperty(value, "player_response", playerValue);
      watchProperty(value, "raw_player_response", playerValue);
      return value;
    }
    function playerConfig(value) { watchProperty(value, "args", playerArgs); return value; }
    function playerContainer(value) { watchProperty(value, "config", playerConfig); return value; }
    watchProperty(win, "ytInitialPlayerResponse", playerValue);
    watchProperty(win, "playerResponse", playerValue);
    watchProperty(win, "ytplayer", playerContainer);

    if (win.JSON && typeof win.JSON.parse === "function") {
      var originalParse = win.JSON.parse;
      replace(win.JSON, "parse", new Proxy(originalParse, { apply: function (target, receiver, args) {
        return activePrune(Reflect.apply(target, receiver, args));
      } }));
    }

    function selectedResponse(response) {
      try { return response.status >= 200 && response.status < 300 &&
        (targetResponses.has(response) || matching(response.url)); }
      catch (_) { return false; }
    }
    function responseMethod(target, receiver, args, name) {
      // Keep a genuine native Response receiver, including prototype.call(...).
      // Native body consumption, invalid-receiver and already-read errors win.
      var result = Reflect.apply(target, receiver, args);
      if (!state.active || !selectedResponse(receiver)) return result;
      if (name === "clone") return filteredResponse(result);
      return result.then(name === "json" ? playerPrune : activeText);
    }
    function responseHook(target, name) {
      return new Proxy(target, { apply: function (native, receiver, args) {
        return responseMethod(native, receiver, args, name);
      } });
    }

    // Return the original native Response rather than a Proxy around its branded
    // object. Scoped native-method hooks cover normal and prototype-call reads.
    if (win.Response && win.Response.prototype) ["json", "text", "clone"].forEach(function (name) {
      var native = win.Response.prototype[name];
      if (typeof native !== "function") return;
      var hook = responseHook(native, name);
      responseHooks[name] = replace(win.Response.prototype, name, hook) ? hook : null;
    });
    function filteredResponse(response) {
      if (!response || typeof response !== "object" || targetResponses.has(response)) return response;
      targetResponses.add(response);
      // Also cover clone results with another native prototype and locked
      // prototypes that permit an instance override. Fully locked objects pass through.
      ["json", "text", "clone"].forEach(function (name) {
        var method = response[name];
        if (typeof method === "function" && method !== responseHooks[name]) replace(response, name, responseHook(method, name));
      });
      return response;
    }
    if (typeof win.fetch === "function") {
      replace(win, "fetch", new Proxy(win.fetch, { apply: function (target, receiver, args) {
        var result = Reflect.apply(target, receiver, args);
        if (!state.active || !matching(args[0])) return result;
        return result.then(function (response) {
          if (!state.active || !response || response.status < 200 || response.status >= 300) return response;
          // A cross-origin redirect is outside this filter's scope.
          if (response.url && !matching(response.url)) return response;
          return filteredResponse(response);
        });
      } }));
    }

    var xhr = win.XMLHttpRequest && win.XMLHttpRequest.prototype;
    if (xhr && typeof xhr.open === "function") {
      replace(xhr, "open", new Proxy(xhr.open, { apply: function (target, receiver, args) {
        var result = Reflect.apply(target, receiver, args);
        xhrRequests.set(receiver, { selected: state.active && matching(args[1]), raw: null, filtered: null });
        return result;
      } }));
      ["response", "responseText"].forEach(function (name) {
        try {
          var descriptor = Object.getOwnPropertyDescriptor(xhr, name);
          if (!descriptor || !descriptor.get || !descriptor.configurable) return;
          var nativeGet = descriptor.get;
          Object.defineProperty(xhr, name, { configurable: descriptor.configurable, enumerable: descriptor.enumerable,
            get: function () {
              var raw = Reflect.apply(nativeGet, this, []);
              var request = xhrRequests.get(this);
              if (!state.active || !request || !request.selected || this.readyState !== 4 || this.status < 200 || this.status >= 300) return raw;
              if (this.responseURL && !matching(this.responseURL)) return raw;
              var type = this.responseType;
              if (name === "response" && type === "json") return playerPrune(raw);
              if (type !== "" && type !== "text") return raw;
              if (typeof raw !== "string") return raw;
              if (request.raw !== raw) { request.raw = raw; request.filtered = activeText(raw); }
              return request.filtered;
            } });
        } catch (_) { /* Leave native getters in place when a page locks them. */ }
      });
    }

    win.addEventListener("pagehide", function () { state.active = false; });
    win.addEventListener("pageshow", function () { state.active = true; });
    return state;
  }

  return { install: install, prune: prune, pruneText: pruneText, matchesURL: matchesURL };
});
