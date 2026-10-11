// Feed-only feedback: a small shared settle, stationary search results and
// a neutral search focus, with no decoration work behind the player.
// Content is always readable before discovery; there is no reveal stylesheet,
// scroll loop, delayed navigation, or permanent compositor promotion.
(function (win) {
  if (!win || !win.document || win.__langformFeedReadiness) return;
  var handler = win.webkit && win.webkit.messageHandlers && win.webkit.messageHandlers.langformFeedReady;
  if (!handler || !/^(?:m\.|www\.)?youtube\.com$/.test(win.location.hostname) || !win.MutationObserver) return;
  win.__langformFeedReadiness = true;
  var doc = win.document;
  var documentToken = String(win.performance && win.performance.timeOrigin || Date.now());
  win.__langformFeedDocumentToken = documentToken;
  var content = "ytm-rich-item-renderer, ytm-video-with-context-renderer, ytm-video-renderer, ytm-compact-video-renderer, ytm-grid-video-renderer, ytm-channel-renderer, ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-channel-renderer, yt-lockup-view-model";
  var message = "ytm-message-renderer, ytm-error-message-renderer, ytm-background-promo-renderer, ytd-message-renderer, ytd-error-message-renderer, ytd-background-promo-renderer";
  var watchLinks = 'a[href^="/watch?"], a[href^="https://m.youtube.com/watch?"], a[href^="https://www.youtube.com/watch?"], a[href^="https://youtube.com/watch?"]';
  var channels = "ytm-channel-renderer, ytd-channel-renderer";
  var failedImages = new WeakMap(), decodedImages = new WeakMap(), decodingImages = new WeakMap();
  var alive = true, navigating = false, reported = false, observing = false;
  var generation = 0, frames = [], roots = [];

  function eligible() {
    return alive && !navigating && !reported && !doc.hidden && !/^\/watch(?:\/|$)/.test(win.location.pathname);
  }
  function visible(node) {
    if (!node || !node.isConnected || node.hidden || node.getAttribute("aria-hidden") === "true") return false;
    var rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= win.innerHeight ||
        rect.right <= 0 || rect.left >= win.innerWidth) return false;
    for (var current = node, depth = 0; current && depth < 16; current = current.parentElement, depth++) {
      if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
      var style = win.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return false;
    }
    return true;
  }
  function realContent(node) {
    if (node.matches(message)) return !!node.textContent.trim();
    if (!node.matches(content)) return false;
    return !!node.querySelector(node.matches(channels) ? 'a[href^="/@"], a[href^="/channel/"]' : watchLinks);
  }
  function thumbnail(node) {
    if (node.matches(message + ", " + channels)) return null;
    return node.querySelector(watchLinks.split(", ").map(function (selector) { return selector + " img"; }).join(", "));
  }
  function imageSource(image) {
    var requested = image.getAttribute("src") || "", candidates = image.getAttribute("srcset") || "", selected = image.currentSrc || "";
    // currentSrc may still point at the previous bitmap while a new src/srcset
    // is loading. A rejected old decode must not mark that new request failed.
    return requested || candidates || selected ? requested + "|" + candidates + "|" + selected : "";
  }
  function useful(node) {
    if (!realContent(node)) return false;
    if (node.matches(message + ", " + channels)) return true;
    var image = thumbnail(node);
    // A hydrated link can precede both thumbnail mount and decode. Retaining
    // old pixels until one visible useful row is painted avoids revealing
    // that intermediate placeholder during a refresh.
    if (!image) return false;
    var rect = image.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom <= 0 || rect.top >= win.innerHeight || rect.right <= 0 || rect.left >= win.innerWidth) return true;
    var source = imageSource(image);
    if (source && failedImages.get(image) === source) return true;
    if (!source || !image.complete || image.naturalWidth <= 1 || image.naturalHeight <= 1) return false;
    if (typeof image.decode !== "function" || decodedImages.get(image) === source) return true;
    if (decodingImages.get(image) !== source) {
      decodingImages.set(image, source);
      image.decode().then(function () {
        if (imageSource(image) !== source) return;
        decodedImages.set(image, source);
        decodingImages.delete(image);
        enqueue(node);
      }, function () {
        if (imageSource(image) !== source) return;
        failedImages.set(image, source);
        decodingImages.delete(image);
        enqueue(node);
      });
    }
    return false;
  }
  function geometry(node) {
    var rect = node.getBoundingClientRect(), image = thumbnail(node);
    var imageRect = image && image.getBoundingClientRect();
    return [rect.left, rect.top, rect.width, rect.height].concat(imageRect ? [imageRect.left, imageRect.top, imageRect.width, imageRect.height] : []);
  }
  function sameGeometry(before, after) {
    return before.length === after.length && before.every(function (value, index) { return Math.abs(value - after[index]) <= .5; });
  }
  function stop() {
    observer.disconnect(); observing = false;
    frames.forEach(function (frame) { win.cancelAnimationFrame(frame); });
    frames = []; roots = [];
  }
  function paint(node) {
    var token = generation;
    var previous = geometry(node), stableFrames = 0, attempts = 0;
    // didFinish precedes the first useful paint on slow feeds. Confirm a
    // connected, visible renderer after two compositor opportunities.
    function confirm() {
      frames = [];
      if (!eligible() || token !== generation) return;
      if (!node.isConnected) { enqueue(doc.body); return; }
      if (!useful(node) || !visible(node)) {
        // Image/DOM events resume the affected owner; there is no network or
        // below-fold image polling while a thumbnail is unavailable.
        if (roots.length) frames.push(win.requestAnimationFrame(inspect));
        return;
      }
      var current = geometry(node);
      stableFrames = sameGeometry(previous, current) ? stableFrames + 1 : 0;
      previous = current;
      if (stableFrames >= 2) {
        try { handler.postMessage({ href: win.location.href, documentToken: documentToken }); }
        catch (_) { return; }
        reported = true;
        stop();
        return;
      }
      if (++attempts < 30) frames.push(win.requestAnimationFrame(confirm));
      else if (roots.length) frames.push(win.requestAnimationFrame(inspect));
    }
    frames.push(win.requestAnimationFrame(confirm));
  }
  function inspect() {
    frames = [];
    if (!eligible()) { roots = []; return; }
    var pending = roots; roots = [];
    var budget = 320, measurements = 8;
    for (var r = 0; r < pending.length && budget > 0; r++) {
      var stack = [pending[r]];
      while (stack.length && budget-- > 0) {
        var node = stack.pop();
        if (!node || node.nodeType !== 1 || !node.isConnected) continue;
        if (realContent(node)) {
          if (measurements-- > 0 && visible(node) && useful(node)) { paint(node); return; }
          continue;
        }
        if (node.matches("script, style, video, #langform-discovery, #langform-discovery-sheet, bottom-sheet-container, ytm-engagement-panel, ytd-engagement-panel-section-list-renderer, tp-yt-paper-dialog, #dialog-container")) continue;
        for (var i = Math.min(node.children.length, 48) - 1; i >= 0 && stack.length < 320; i--) stack.push(node.children[i]);
      }
    }
  }
  function enqueue(node) {
    if (!node || node.nodeType !== 1 || !eligible() || roots.length >= 12) return;
    var duplicate = false;
    for (var i = 0; i < roots.length; i++) if (roots[i] === node || roots[i].contains(node)) { duplicate = true; break; }
    if (!duplicate) roots.push(node);
    if (!frames.length) frames.push(win.requestAnimationFrame(inspect));
  }
  var observer = new win.MutationObserver(function (records) {
    if (!eligible()) { stop(); return; }
    for (var i = 0; i < records.length && i < 40; i++) {
      var record = records[i];
      // A mounted skeleton may hydrate its links/text or become visible.
      var target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      var owner = target && target.closest && target.closest(content + ", " + message);
      if (owner) enqueue(owner);
      for (var j = 0; j < record.addedNodes.length && j < 12; j++) enqueue(record.addedNodes[j]);
      if (record.type === "attributes") enqueue(record.target);
    }
  });
  ["load", "error"].forEach(function (name) {
    doc.addEventListener(name, function (event) {
      if (!eligible() || !event.target || event.target.tagName !== "IMG") return;
      var image = event.target, owner = image.closest(content);
      if (!owner) return;
      if (name === "error") failedImages.set(image, imageSource(image));
      else failedImages.delete(image);
      enqueue(owner);
    }, true);
  });
  function wake() {
    if (!eligible()) { stop(); return; }
    if (!observing) { observing = true; observer.observe(doc, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden", "src", "srcset"] }); }
    enqueue(doc.body);
  }
  ["yt-navigate-start", "state-navigatestart"].forEach(function (name) {
    win.addEventListener(name, function () { generation++; navigating = true; reported = false; stop(); });
  });
  ["yt-navigate-finish", "state-navigateend"].forEach(function (name) {
    win.addEventListener(name, function () { navigating = false; wake(); });
  });
  win.addEventListener("pagehide", function () { alive = false; generation++; stop(); });
  win.addEventListener("pageshow", function () { alive = true; navigating = false; wake(); });
  win.addEventListener("langform-feed-visibility", wake);
  doc.addEventListener("visibilitychange", wake);
  doc.addEventListener("DOMContentLoaded", wake, { once: true });
  wake();
})(window);

(function (win) {
  if (!win || !win.document || win.__langformFeedMotion) return;
  var handlers = win.webkit && win.webkit.messageHandlers;
  if (!handlers || !handlers.langformOpenWatch || handlers.langformPlayer ||
      win.location.hostname !== "m.youtube.com" || !win.MutationObserver ||
      !win.CSS || !win.CSS.supports || !win.CSS.supports("translate", "0px 1px")) return;
  win.__langformFeedMotion = true;

  var doc = win.document;
  var cards = "ytm-rich-item-renderer, ytm-video-with-context-renderer, ytm-video-renderer, ytm-compact-video-renderer, ytm-grid-video-renderer";
  var controls = "ytm-chip-cloud-chip-renderer, ytm-searchbox button, yt-searchbox button, ytm-mobile-topbar-renderer button, ytm-topbar-menu-button-renderer button, .mobile-topbar-header button";
  var excluded = "input, textarea, select, [contenteditable], video, ytm-pivot-bar-item-renderer, #langform-discovery, #langform-discovery-sheet, #langform-search-focus-halo, bottom-sheet-container, ytm-engagement-panel, #dialog-container";
  var seen = new WeakSet();
  var entrances = new Map();
  var roots = [];
  var frame = 0;
  var observing = false;
  var alive = true;
  var navigating = false;
  var scrollingUntil = 0;
  var pointerHeld = false;
  var press = null;
  var pressAnimation = null;
  var pressNode = null;
  var searchShell = null;
  var searchAnimation = null;
  var searchHalo = null;
  var reduced = win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)");
  var ease = "cubic-bezier(.16, 1, .3, 1)";

  function active() {
    return alive && !navigating && win.__langformFeedActive !== false && !doc.hidden &&
      !(reduced && reduced.matches) && win.location && !/^\/watch(?:\/|$)/.test(win.location.pathname);
  }
  function covered() {
    return typeof win.__langformHasOpenOverlay === "function" && win.__langformHasOpenOverlay();
  }
  function stopEntrance(node) {
    var entry = entrances.get(node);
    if (!entry) return;
    entry.animations.forEach(function (animation) {
      animation.onfinish = null;
      animation.cancel();
    });
    entrances.delete(node);
  }
  function stopEntrances() { entrances.forEach(function (_, node) { stopEntrance(node); }); }
  function stopPress() {
    press = null;
    if (pressAnimation) { pressAnimation.onfinish = null; pressAnimation.cancel(); }
    pressAnimation = null;
    pressNode = null;
  }
  function clearQueue() {
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    roots = [];
  }
  function suspend() {
    observer.disconnect();
    observing = false;
    clearQueue();
    stopEntrances();
    stopPress();
    pointerHeld = false;
    stopSearch(true);
  }
  function plain(value) { return !value || value === "none" || value === "0px" || value === "0px 0px"; }
  function outerCard(node) {
    var card = node.closest && node.closest(cards);
    if (!card) return null;
    for (var parent = card.parentElement; parent; parent = card.parentElement) {
      var outer = parent.closest(cards);
      if (!outer) break;
      card = outer;
    }
    return card;
  }
  function inspect(node, candidates, measurements) {
    if (seen.has(node) || !node.isConnected ||
        !node.querySelector('a[href^="/watch?"], a[href^="https://m.youtube.com/watch?"]')) return;
    // Once a real card exists, recycling/hydrating its metadata must never
    // restart its entrance. Offscreen cards are deliberately left at rest.
    seen.add(node);
    // Bound actual layout reads, including cards above/below the viewport.
    // Counting only accepted candidates let long offscreen batches consume
    // dozens of measurements, even with a full three-card entrance already on.
    if (!measurements.left || pointerHeld || scrollingUntil > win.performance.now() || covered() ||
        (doc.activeElement && node.contains(doc.activeElement))) return;
    measurements.left--;
    var rect = node.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 40 || rect.bottom <= 0 || rect.top >= win.innerHeight ||
        rect.right <= 0 || rect.left >= win.innerWidth) return;
    var style = win.getComputedStyle(node);
    if (node.hidden || style.display === "none" || style.visibility === "hidden" ||
        style.visibility === "collapse" || !plain(style.translate) ||
        (style.opacity && style.opacity !== "1") || typeof node.animate !== "function") return;
    candidates.push({ node: node, top: rect.top });
  }
  function flush() {
    frame = 0;
    if (!active()) { roots = []; return; }
    var pending = roots;
    roots = [];
    var candidates = [];
    var measurements = { left: entrances.size < 3 ? 8 : 0 };
    var budget = 320;
    for (var r = 0; r < pending.length && budget > 0; r++) {
      var stack = [pending[r]];
      while (stack.length && budget-- > 0) {
        var node = stack.pop();
        if (!node || node.nodeType !== 1 || !node.isConnected) continue;
        if (node.matches(cards)) { inspect(node, candidates, measurements); continue; }
        if (node.matches("script, style, video, " + excluded)) continue;
        // A bounded traversal, including for a complete results-page mount.
        // Decorative discovery is allowed to skip a deep/offscreen tail.
        var children = node.children;
        for (var i = Math.min(children.length, 48) - 1; i >= 0 && stack.length < 320; i--) stack.push(children[i]);
      }
    }
    candidates.sort(function (a, b) { return a.top - b.top; });
    for (var c = 0; c < candidates.length && entrances.size < 3; c++) {
      var card = candidates[c].node;
      var search = win.location.pathname === "/results";
      var entry = { animations: [] };
      entrances.set(card, entry);
      try {
        // Results, thumbnail and headline stay aligned. Separate staggered
        // tracks made an ordinary page change look like sliding tiles and
        // exposed a different pose for every part of a tapped result.
        var animation = card.animate([
          { translate: search ? "0px 0px" : "0px 8px", opacity: .94 },
          { translate: "0px 0px", opacity: 1 }
        ], { duration: search ? 160 : 220, easing: ease, fill: "backwards" });
        entry.animations.push(animation);
        animation.onfinish = (function (node, current) { return function () {
          if (entrances.get(node) === current) stopEntrance(node);
        }; })(card, entry);
      } catch (_) { stopEntrance(card); /* Decoration cannot block a working feed. */ }
    }
  }
  function enqueue(root) {
    if (!root || root.nodeType !== 1 || !active() || roots.length >= 12) return;
    for (var i = 0; i < roots.length; i++) if (roots[i] === root || roots[i].contains(root)) return;
    roots.push(root);
    if (!frame) frame = win.requestAnimationFrame(flush);
  }
  var observer = new win.MutationObserver(function (records) {
    if (!active()) { suspend(); return; }
    // Inspect additions only, never rescan the feed for thumbnail loads,
    // attribute writes, progress updates, or removed text. Work is capped even
    // when YouTube commits a large hydration batch in one delivery.
    for (var i = 0; i < records.length && i < 40; i++) {
      var record = records[i];
      if (!record.addedNodes.length) continue;
      var card = outerCard(record.target);
      if (card) { if (!seen.has(card)) enqueue(card); continue; }
      for (var j = 0; j < record.addedNodes.length && j < 12; j++) enqueue(record.addedNodes[j]);
    }
    entrances.forEach(function (_, node) { if (!node.isConnected) stopEntrance(node); });
    // DOM replacement can remove a focused input without dispatching blur.
    if (searchShell && !searchShell.isConnected) stopSearch(true);
  });
  function wake() {
    if (!active()) { suspend(); return; }
    if (observing || !doc.body) return;
    observing = true;
    observer.observe(doc.body, { childList: true, subtree: true });
    enqueue(doc.body);
  }

  function begin(event, point, id) {
    if (!active() || covered() || event.defaultPrevented || !point ||
        !event.target.closest || event.target.closest(excluded)) { stopPress(); return; }
    var node = event.target.closest(controls);
    if (!node || node.disabled || node.getAttribute("aria-disabled") === "true" ||
        typeof node.animate !== "function" || !win.CSS.supports("scale", "1")) { stopPress(); return; }
    var from = pressNode === node && pressAnimation ? win.getComputedStyle(node).scale : "1";
    stopPress();
    var existing = win.getComputedStyle(node).scale;
    if (existing && existing !== "none" && existing !== "1" && existing !== "1 1") return;
    try {
      pressAnimation = node.animate([{ scale: from && from !== "none" ? from : "1" }, { scale: ".98" }], {
        duration: 100, easing: ease, fill: "forwards"
      });
      pressNode = node;
      press = { node: node, x: point.clientX, y: point.clientY, id: id };
    } catch (_) { stopPress(); }
  }
  function move(point, id) {
    if (!press || press.id !== id) return;
    var x = point.clientX - press.x, y = point.clientY - press.y;
    if (x * x + y * y > 64) stopPress();
  }
  function release(id) {
    if (!press || press.id !== id) return;
    var node = press.node;
    var scale = win.getComputedStyle(node).scale;
    stopPress();
    if (!active() || !node.isConnected || covered()) return;
    try {
      var animation = node.animate([{ scale: scale && scale !== "none" ? scale : ".98" }, { scale: "1" }], {
        duration: 160, easing: ease
      });
      pressAnimation = animation;
      pressNode = node;
      animation.onfinish = function () { if (pressAnimation === animation) stopPress(); };
    } catch (_) { stopPress(); }
  }
  function stopSearch(clearFocus) {
    if (searchAnimation) { searchAnimation.onfinish = null; searchAnimation.cancel(); }
    searchAnimation = null;
    if (clearFocus) {
      if (searchHalo) searchHalo.remove();
      searchHalo = null;
      searchShell = null;
    }
  }
  function focusSearch(event) {
    var input = event.target;
    if (!active() || covered() || !input || !input.matches ||
        !input.matches('input[type="search"], input[name="search_query"], textarea[name="search_query"], ytm-searchbox input, yt-searchbox input')) return;
    var shell = input.closest(".searchbox-input-wrapper, .ytSearchboxComponentInputBox, ytm-searchbox, yt-searchbox, .searchbox-form");
    if (!shell || shell === searchShell || typeof shell.animate !== "function") return;
    stopSearch(true);
    // Fade only a non-interactive neutral focus edge. Moving a focused
    // input's ancestor would also move caret hit geometry during a quick tap.
    // Measure once at focus; remove on scrolling/keyboard resize rather than
    // chase layout with a listener or a permanent animation frame loop.
    var rect = shell.getBoundingClientRect();
    if (!isFinite(rect.left + rect.top + rect.width + rect.height) || rect.width <= 0 || rect.height <= 0) return;
    var style = win.getComputedStyle(shell);
    var halo = doc.createElement("div");
    halo.id = "langform-search-focus-halo";
    halo.setAttribute("aria-hidden", "true");
    halo.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;box-sizing:border-box;" +
      "background:transparent;border:1px solid rgba(128,128,128,.45);" +
      "border-radius:" + (style.borderRadius && style.borderRadius !== "0px" ? style.borderRadius : "22px") + ";" +
      "left:" + rect.left + "px;top:" + rect.top + "px;width:" + rect.width + "px;height:" + rect.height + "px";
    searchShell = shell;
    searchHalo = halo;
    doc.body.appendChild(halo);
    try {
      var animation = halo.animate([
        { opacity: .45 }, { opacity: 1 }
      ], { duration: 160, easing: ease });
      searchAnimation = animation;
      animation.onfinish = function () { if (searchAnimation === animation) stopSearch(false); };
    } catch (_) { stopSearch(false); }
  }
  ["keydown", "beforeinput", "compositionstart"].forEach(function (name) {
    doc.addEventListener(name, function () { stopSearch(false); }, { capture: true, passive: true });
  });
  doc.addEventListener("focusin", function (event) {
    // Keyboard and accessibility activation have no pointerdown. The focused
    // link and its outline must settle before another user action can target it.
    stopEntrances();
    focusSearch(event);
  });
  doc.addEventListener("focusout", function (event) {
    if (!searchShell || (event.relatedTarget && searchShell.contains(event.relatedTarget))) return;
    stopSearch(true);
  });
  var passive = { capture: true, passive: true };
  if (typeof win.PointerEvent === "function") {
    win.addEventListener("pointerdown", function (event) {
      // Feed entrance yields as soon as the finger can start a scroll or open
      // a card; source-rect measurement then sees its actual resting position.
      stopEntrances();
      stopSearch(false);
      pointerHeld = true;
      if (event.isPrimary === false || event.button) { stopPress(); return; }
      begin(event, event, event.pointerId);
    }, passive);
    win.addEventListener("pointermove", function (event) { move(event, event.pointerId); }, passive);
    win.addEventListener("pointerup", function (event) { if (event.isPrimary !== false) pointerHeld = false; release(event.pointerId); }, passive);
    win.addEventListener("pointercancel", function () { pointerHeld = false; stopPress(); }, passive);
  } else {
    win.addEventListener("touchstart", function (event) {
      stopEntrances();
      stopSearch(false);
      pointerHeld = true;
      if (event.touches.length !== 1) { stopPress(); return; }
      begin(event, event.touches[0], event.touches[0].identifier);
    }, passive);
    win.addEventListener("touchmove", function (event) {
      if (event.touches.length !== 1) { stopPress(); return; }
      move(event.touches[0], event.touches[0].identifier);
    }, passive);
    win.addEventListener("touchend", function (event) {
      pointerHeld = event.touches.length > 0;
      for (var i = 0; i < event.changedTouches.length; i++) release(event.changedTouches[i].identifier);
    }, passive);
    win.addEventListener("touchcancel", function () { pointerHeld = false; stopPress(); }, passive);
  }
  win.addEventListener("scroll", function () {
    scrollingUntil = win.performance.now() + 140;
    stopEntrances();
    stopPress();
    stopSearch(true);
  }, passive);
  win.addEventListener("blur", function () { pointerHeld = false; stopEntrances(); stopPress(); stopSearch(true); });
  win.addEventListener("resize", function () { clearQueue(); stopEntrances(); stopPress(); stopSearch(true); });
  if (win.visualViewport) win.visualViewport.addEventListener("resize", function () { stopSearch(true); });
  win.addEventListener("pagehide", function () { alive = false; suspend(); });
  win.addEventListener("pageshow", function () { alive = true; navigating = false; wake(); });
  win.addEventListener("langform-feed-visibility", wake);
  doc.addEventListener("visibilitychange", wake);
  ["yt-navigate-start", "state-navigatestart"].forEach(function (name) {
    win.addEventListener(name, function () { navigating = true; suspend(); });
  });
  ["yt-navigate-finish", "state-navigateend"].forEach(function (name) {
    win.addEventListener(name, function () { navigating = false; wake(); });
  });
  if (reduced && reduced.addEventListener) reduced.addEventListener("change", wake);
  doc.addEventListener("DOMContentLoaded", wake, { once: true });
  wake();
})(window);
