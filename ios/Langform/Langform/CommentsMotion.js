// The mobile watch page mounts comments in panel-container >
// ytm-engagement-panel, not in the generic bottom-sheet-container. Its g8NBcb
// renderer identifies comments by comment-item-section / continuationUrl and
// uses a drag transform on .engagement-panel-container. An accepted app drag
// owns independent translate/height until its physical spring settles; the
// original transform and fixed scrim stay untouched. Hydration and dragging
// never start a text fade; reduced ordinary entry/close may dissolve in place.
(function (win) {
  if (!win || !win.document || win.__langformCommentsMotion ||
      win.location.hostname !== "m.youtube.com" ||
      !win.webkit || !win.webkit.messageHandlers || !win.webkit.messageHandlers.langformPlayer ||
      typeof win.__langformObserveOverlayContainers !== "function" ||
      typeof win.MutationObserver !== "function") return;
  win.__langformCommentsMotion = true;

  var entries = new Map();
  var pendingPanels = [];
  var reduced = win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)");
  var appMotion = win.__langformMotion;
  function reduceSpatialMotion() { return !!(appMotion && appMotion.reduceSpatialMotion || reduced && reduced.matches); }
  var closeSelector = ".engagement-panel-section-list-header-button.close-button button";
  var movingAttribute = "data-langform-comments-moving";
  var clipStyle = win.document.createElement("style");
  clipStyle.textContent = "ytm-engagement-panel .engagement-panel-section-list-background.at-top[" + movingAttribute + "]:not([data-langform-comments-interactive]){overflow:clip!important}" +
    "ytm-engagement-panel[data-langform-comments-sheet] .engagement-panel-section-list-header-wrapper{touch-action:none}" +
    "ytm-engagement-panel .engagement-panel-section-list-background[data-langform-comments-interactive]{overflow:visible!important}" +
    "ytm-engagement-panel ytm-engagement-panel-section-list-renderer[data-langform-comments-interactive]{overflow:visible!important}" +
    "ytm-engagement-panel[data-langform-comments-sheet] [data-langform-comments-handle]{display:block!important;width:36px;height:5px;min-height:5px;margin:8px auto 6px;border-radius:3px;background:rgba(160,160,160,.7);pointer-events:none}";
  (win.document.head || win.document.documentElement).appendChild(clipStyle);

  function visible(node) {
    return node.isConnected && !node.hidden && node.getAttribute("aria-hidden") !== "true";
  }
  function pageInactive() {
    try { var visibility = win.__langformRealVisibility; if (visibility && typeof visibility.inactive === "function") return !!visibility.inactive(); } catch (_) {}
    return !!win.document.hidden;
  }
  function stopAnimation(entry) {
    entry.acceleratedAnimation = null;
    if (entry.clipNode) {
      entry.clipNode.removeAttribute(movingAttribute);
      entry.clipNode = null;
    }
    if (!entry.animation) return;
    entry.animation.onfinish = null;
    entry.animation.cancel();
    entry.animation = null;
  }
  function clearCloseWait(entry) {
    if (entry.closeTimer) win.clearTimeout(entry.closeTimer);
    entry.closeTimer = 0;
  }
  function stopWaiting(entry) {
    entry.waiting = false;
    entry.observer.disconnect();
    entry.observer.observe(entry.node, { attributes: true, attributeOldValue: true, attributeFilter: ["hidden", "aria-hidden"], childList: true });
  }
  function reset(entry) {
    cancelDrag(entry, true);
    entry.node.removeAttribute("data-langform-comments-sheet");
    stopAnimation(entry);
    clearCloseWait(entry);
    entry.surface = null;
    entry.closing = false;
    entry.finishClose = null;
    entry.renderer = null;
    entry.shown = false;
    entry.entered = false;
  }
  // Finger ownership and spring settlement are independent of YouTube's
  // transform. Preserve every original inline value and restore it at close,
  // navigation, hydration and keyboard/viewport changes.
  function restorePresentation(entry) {
    if (!entry.presentation || !entry.surface) return;
    if (entry.interactiveBackground) entry.interactiveBackground.removeAttribute("data-langform-comments-interactive");
    if (entry.interactiveRenderer) entry.interactiveRenderer.removeAttribute("data-langform-comments-interactive");
    entry.interactiveBackground = null;
    entry.interactiveRenderer = null;
    ["translate", "height", "max-height", "flex-shrink"].forEach(function (key) {
      var saved = entry.presentation[key];
      if (saved.value) entry.surface.style.setProperty(key, saved.value, saved.priority);
      else entry.surface.style.removeProperty(key);
    });
    entry.presentation = null;
    entry.restOffset = 0;
  }
  function present(entry, offset) {
    if (!entry.surface || !entry.presentation) return;
    entry.surface.style.setProperty("translate", "0px " + offset + "px");
    if (offset < 0) {
      entry.surface.style.setProperty("height", entry.baseHeight - offset + "px");
      entry.surface.style.setProperty("max-height", "none");
      entry.surface.style.setProperty("flex-shrink", "0");
    }
    else {
      ["height", "max-height", "flex-shrink"].forEach(function (key) {
        var saved = entry.presentation[key];
        if (saved.value) entry.surface.style.setProperty(key, saved.value, saved.priority);
        else entry.surface.style.removeProperty(key);
      });
    }
  }
  function currentOffset(entry) {
    var value = win.getComputedStyle(entry.surface).translate || "0px 0px";
    var parts = value.trim().split(/\s+/);
    return parts.length > 1 ? parseFloat(parts[1]) || 0 : 0;
  }
  function cancelDrag(entry, restore) {
    entry.drag = null;
    entry.contact = null;
    entry.node.removeAttribute("data-langform-comments-dragging");
    if (restore) { restorePresentation(entry); entry.springTarget = null; }
  }
  function preparePresentation(entry, offset) {
    if (entry.presentation) return;
    entry.presentation = {};
    ["translate", "height", "max-height", "flex-shrink"].forEach(function (key) {
      entry.presentation[key] = { value: entry.surface.style.getPropertyValue(key), priority: entry.surface.style.getPropertyPriority(key) };
    });
    var rect = entry.surface.getBoundingClientRect();
    var viewportHeight = win.innerHeight || win.document.documentElement.clientHeight;
    var safeTop = win.__langformStageInsets && win.__langformStageInsets.top;
    var expansionTop = Math.min(viewportHeight - 44, Math.max(12, Number.isFinite(safeTop) && safeTop >= 0 ? safeTop + 12 : 12));
    entry.baseHeight = rect.height;
    entry.expandDistance = Math.max(0, rect.top - offset - expansionTop);
    entry.closeDistance = Math.max(0, viewportHeight - rect.top + offset) + 2;
    entry.interactiveBackground = entry.surface.closest(".engagement-panel-section-list-background");
    if (entry.interactiveBackground) entry.interactiveBackground.setAttribute("data-langform-comments-interactive", "");
    // Current mweb adds a second overflow:auto wrapper above the background.
    // Expanding only the child draws its header outside that clip while AX
    // still reports its offscreen frame. Lift both clips for this lease only.
    entry.interactiveRenderer = entry.renderer;
    if (entry.interactiveRenderer) entry.interactiveRenderer.setAttribute("data-langform-comments-interactive", "");
  }
  // Closed-form damped oscillator: x'' + 2*zeta*w*x' + w*w*x = 0.
  // Sample once at release. The compositor runs these physical positions;
  // there is no JavaScript frame loop or layout work during settlement.
  function springFrames(from, to, velocity) {
    var omega = 19, damping = .88, duration = 500, frames = [];
    var decay = damping * omega, frequency = omega * Math.sqrt(1 - damping * damping);
    var a = from - to, b = (Math.max(-2200, Math.min(2200, velocity)) + decay * a) / frequency;
    for (var i = 0; i <= 32; i++) {
      var time = duration / 1000 * i / 32;
      var offset = to + Math.exp(-decay * time) * (a * Math.cos(frequency * time) + b * Math.sin(frequency * time));
      frames.push({ translate: "0px " + (i === 32 ? to : Math.round(offset * 1000) / 1000) + "px" });
    }
    return frames;
  }
  function finishOriginalClose(entry, button) {
    var href = win.location.href;
    entry.finishClose = function () {
      entry.finishClose = null;
      if (!visible(entry.node) || !button.isConnected || win.location.href !== href) { reset(entry); return; }
      entry.replay = true;
      try { button.click(); } finally { entry.replay = false; }
      clearCloseWait(entry);
      var closingAnimation = entry.animation;
      entry.closeTimer = win.setTimeout(function () {
        if (!entry.closing || entry.animation !== closingAnimation) return;
        entry.closeTimer = 0;
        stopAnimation(entry);
        restorePresentation(entry);
        entry.closing = false;
      }, 500);
    };
  }
  function settleDrag(entry, offset, target, velocity, dismiss) {
    entry.fadeOnly = false;
    entry.drag = null;
    entry.node.removeAttribute("data-langform-comments-dragging");
    stopAnimation(entry);
    entry.springTarget = target;
    if (dismiss) {
      var button = entry.renderer && entry.renderer.querySelector(closeSelector);
      if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") { dismiss = false; target = 0; entry.springTarget = 0; }
      else { entry.closing = true; finishOriginalClose(entry, button); }
    }
    if (!canAnimate(entry.surface)) {
      present(entry, target);
      entry.restOffset = target;
      if (entry.closing && entry.finishClose) entry.finishClose();
      else if (!target) restorePresentation(entry);
      entry.springTarget = null;
      return;
    }
    entry.frames = springFrames(offset, target, velocity);
    // Reserve the complete spring's upward excursion, including velocity
    // overshoot. Sizing only for its destination exposes the page below the
    // sheet during a fast release. This is one boundary layout write; the
    // compositor still animates translation alone. Settlement trims the
    // offscreen reserve back to the exact final height.
    var highestOffset = entry.frames.reduce(function (value, frame) {
      return Math.min(value, parseFloat(frame.translate.split(" ")[1]));
    }, 0);
    if (highestOffset < 0) {
      entry.surface.style.setProperty("height", entry.baseHeight - highestOffset + "px");
      entry.surface.style.setProperty("max-height", "none");
      entry.surface.style.setProperty("flex-shrink", "0");
    }
    entry.timing = { duration: 500, easing: "linear", fill: "both" };
    entry.startedAt = win.performance.now();
    installAnimation(entry);
  }
  function editable(node) {
    var control = node && node.closest && node.closest('input, textarea, select, [contenteditable], button, a, [role="button"], [role="link"], ytm-menu-renderer');
    // Mobile YouTube makes the entire comment text/details a menu button.
    // It must still scroll and hand a downward drag at list-top to the sheet.
    // A candidate leaves tap delivery untouched; nearer real actions (reaction,
    // reply, link, input) remain excluded by the closest-control lookup.
    if (control && control.matches('button.YtmCommentRendererContent') && control.closest('ytm-comment-renderer') && control.closest('.engagement-panel-content-wrapper')) return null;
    return control;
  }
  function scrollingAncestor(node, surface) {
    for (var parent = node; parent && parent !== surface; parent = parent.parentElement) if (parent.scrollTop > 1) return true;
    return false;
  }
  function traceGesture(entry, event, phase, reason, motion) {
    if (typeof win.__langformCommentsGestureTrace !== "function") return;
    var drag = entry && entry.drag;
    try { win.__langformCommentsGestureTrace({ phase: phase, reason: reason || "none", event: event && event.type || "none",
      target: event && event.target, active: win.document.activeElement, prevented: !!(event && event.defaultPrevented),
      shown: !!(entry && entry.shown), closing: !!(entry && entry.closing), header: !!(drag && drag.header), claimed: !!(drag && drag.claimed),
      kind: drag && drag.kind || "none", offset: drag && drag.offset || 0, rest: entry && entry.restOffset || 0, motion: motion }); } catch (_) {}
  }
  function ownContact(entry, drag) {
    entry.contact = { pointerId: drag.pointerId, touchId: drag.touchId, endedAt: null };
  }
  function shieldContact(entry, event, point, kind, retire) {
    var contact = entry.contact;
    if (!contact) return;
    if (contact.endedAt !== null && win.performance.now() - contact.endedAt > 500) { entry.contact = null; return; }
    var key = kind === "touch" ? "touchId" : "pointerId";
    if (contact[key] === undefined || !point || (kind === "touch" ? point.identifier : event.pointerId) !== contact[key]) return;
    // iOS sends both streams. Once this contact belongs to the header (or a
    // claimed body drag), even its subthreshold and companion-stream events
    // must not reach the original sheet's move recognizer.
    event.stopImmediatePropagation();
    if (retire) {
      contact[key] = undefined;
      contact.endedAt = win.performance.now();
      if (contact.pointerId === undefined && contact.touchId === undefined) entry.contact = null;
    }
  }
  function beginDrag(entry, event, point, kind) {
    var rejection = !entry.shown ? "not-shown" : !entry.surface ? "no-surface" : !visible(entry.node) ? "not-visible" : entry.closing ? "closing" : event.defaultPrevented ? "prevented" : !point ? "no-point" : editable(event.target) ? "control" :
      !win.CSS || !win.CSS.supports || !win.CSS.supports("translate", "0px 1px") ? "no-translate" : null;
    if (rejection) { traceGesture(entry,event,"begin-reject",rejection); return; }
    var existing = entry.drag;
    if (existing) {
      // iOS dispatches pointerdown then touchstart for the same finger. The
      // touch stream can prevent native scrolling after a body drag is claimed.
      if (kind === "touch" && existing.kind === "pointer" && Math.abs(point.clientX - existing.x) < 2 && Math.abs(point.clientY - existing.y) < 2) { existing.kind = kind; existing.id = existing.touchId = point.identifier; if (entry.contact) entry.contact.touchId = point.identifier; if (existing.header) event.stopImmediatePropagation(); return; }
      if (kind !== existing.kind) return;
      settleDrag(entry, existing.offset, entry.restOffset || 0, 0, false); return;
    }
    var header = event.target.closest(".engagement-panel-section-list-header-wrapper");
    var body = event.target.closest(".engagement-panel-content-wrapper");
    var background = entry.surface.closest(".engagement-panel-section-list-background");
    if (background && background.scrollTop > 1) { traceGesture(entry,event,"begin-reject","wrapper-scroll"); return; }
    if (!header && (!body || scrollingAncestor(event.target, entry.surface))) { traceGesture(entry,event,"begin-reject",body ? "body-scroll" : "outside"); return; }
    var active = win.document.activeElement;
    if (active && active.closest && active.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) { traceGesture(entry,event,"begin-reject","active-input"); return; }
    entry.drag = { kind: kind, id: kind === "touch" ? point.identifier : event.pointerId, pointerId: kind === "pointer" ? event.pointerId : undefined, touchId: kind === "touch" ? point.identifier : undefined, x: point.clientX, y: point.clientY,
      lastX: point.clientX, lastY: point.clientY, lastTime: win.performance.now(), velocity: 0, offset: entry.restOffset || 0, startOffset: null, header: !!header, claimed: false };
    entry.contact = null;
    if (header) ownContact(entry, entry.drag);
    traceGesture(entry,event,"begin");
    if (header) event.stopImmediatePropagation();
  }
  function moveDrag(entry, event, point, kind, finalPoint) {
    var drag = entry.drag;
    if (!drag || drag.kind !== kind || !point || (kind === "touch" ? point.identifier : event.pointerId) !== drag.id) return;
    var dx = point.clientX - drag.x, dy = point.clientY - drag.y;
    if (!drag.claimed) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) > Math.abs(dy) * .8 || (!drag.header && (dy <= 0 || scrollingAncestor(event.target, entry.surface)))) { entry.drag = null; return; }
      drag.startOffset = currentOffset(entry);
      preparePresentation(entry, drag.startOffset);
      if (!(entry.baseHeight > 0 && isFinite(entry.closeDistance) && entry.closeDistance > 2)) { cancelDrag(entry, true); return; }
      stopAnimation(entry);
      drag.claimed = true;
      if (!entry.contact) ownContact(entry, drag);
      entry.node.setAttribute("data-langform-comments-dragging", "");
      traceGesture(entry,event,"claim");
    }
    var now = win.performance.now(), dt = now - drag.lastTime;
    if (dt >= 8 || (finalPoint && dt > 0 && point.clientY !== drag.lastY)) {
      drag.velocity = Math.max(-2200, Math.min(2200, (point.clientY - drag.lastY) / dt * 1000));
    }
    drag.lastTime = now; drag.lastX = point.clientX; drag.lastY = point.clientY;
    var offset = drag.startOffset + dy;
    if (offset < -entry.expandDistance) offset = -entry.expandDistance + (offset + entry.expandDistance) * .18;
    drag.offset = Math.max(-entry.expandDistance - 36, offset);
    present(entry, drag.offset);
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }
  function endDrag(entry, event, point, kind, cancelled) {
    var drag = entry.drag;
    if (!drag || drag.kind !== kind || (!cancelled && (!point || (kind === "touch" ? point.identifier : event.pointerId) !== drag.id))) return;
    // WebKit can coalesce the last movement into pointerup/touchend. Commit
    // that endpoint before choosing the spring, including a last reversal;
    // unchanged endpoints retain the last velocity and its existing age rule.
    if (!cancelled && (point.clientY !== drag.lastY || point.clientX !== drag.lastX)) {
      moveDrag(entry, event, point, kind, true);
      if (entry.drag !== drag) return;
    }
    entry.node.removeAttribute("data-langform-comments-dragging");
    if (!drag.claimed) { entry.drag = null; return; }
    var velocity = win.performance.now() - drag.lastTime > 100 ? 0 : drag.velocity;
    var projected = drag.offset + velocity * .12;
    var dismiss = !cancelled && projected > Math.min(180, entry.closeDistance * .3);
    var target = cancelled ? entry.restOffset || 0 : dismiss ? entry.closeDistance : projected < -entry.expandDistance * .35 ? -entry.expandDistance : 0;
    traceGesture(entry,event,"release",cancelled ? "cancel" : dismiss ? "dismiss" : target ? "expanded" : "rest");
    entry.suppressClickUntil = win.performance.now() + 450;
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
    settleDrag(entry, drag.offset, target, cancelled ? 0 : velocity, dismiss);
  }
  function sheetSurface(entry) {
    return entry.node.querySelector(".engagement-panel-container");
  }
  function ensureHandle(entry) {
    if (!entry.surface || !(entry.commentIntent || entry.renderer)) return;
    entry.node.setAttribute("data-langform-comments-sheet", "");
    var header = entry.surface.querySelector(".engagement-panel-section-list-header-wrapper");
    if (!header || header.querySelector("[data-langform-comments-handle]")) return;
    var handle = header.querySelector(".engagement-panel-drag-line") || win.document.createElement("div");
    handle.setAttribute("data-langform-comments-handle", "");
    handle.setAttribute("aria-hidden", "true");
    if (!handle.parentElement) header.insertBefore(handle, header.firstChild);
  }
  function canAnimate(surface) {
    return surface && typeof surface.animate === "function" &&
      win.CSS && win.CSS.supports && win.CSS.supports("translate", "0px 1px") &&
      !reduceSpatialMotion();
  }
  function canDecorate(surface) {
    // Only ordinary app entry/close may dissolve. A finger and hydration
    // retain their direct presentation/clock ownership.
    return appMotion && reduceSpatialMotion()
      ? surface && typeof surface.animate === "function" : canAnimate(surface);
  }
  function installAnimation(entry, currentTime, playbackRate, startTime) {
    var surface = entry.surface;
    // YouTube focuses the header button during entrance. A translated child
    // expands overflow:auto's scroll range, so focus can scroll its ancestor
    // hundreds of pixels and snap back when the effect ends. Clip only that
    // wrapper during ordinary entry/exit; an interactive sheet can extend
    // above its old wrapper, so its drag/spring lease must remain unclipped.
    // The inner comment list retains its own scrolling in both paths.
    entry.clipNode = surface.closest(".engagement-panel-section-list-background");
    if (entry.clipNode) entry.clipNode.setAttribute(movingAttribute, "");
    var animation = surface.animate(entry.frames, entry.timing);
    // Reuse the document timeline origin when a shell is replaced. Copying
    // only currentTime can repeat the previous WebKit sampling tick.
    if (typeof startTime === "number" && isFinite(startTime)) {
      if (playbackRate) animation.playbackRate = playbackRate;
      animation.startTime = startTime;
    } else {
      if (typeof currentTime === "number" && isFinite(currentTime)) animation.currentTime = currentTime;
      if (playbackRate && typeof animation.updatePlaybackRate === "function") animation.updatePlaybackRate(playbackRate);
    }
    entry.animation = animation;
    if (playbackRate === 2) entry.acceleratedAnimation = animation;
    animation.onfinish = function () {
      if (entry.animation !== animation || entry.surface !== surface) return;
      if (entry.closing) {
        // Keep the offscreen frame while YouTube's original command removes
        // the panel. Cancelling here would flash it back at its resting pose.
        var finishClose = entry.finishClose;
        if (finishClose) finishClose();
      } else {
        if (entry.springTarget !== null && entry.springTarget !== undefined) {
          var target = entry.springTarget;
          present(entry, target);
          entry.restOffset = target;
          entry.springTarget = null;
          if (!target) restorePresentation(entry);
        }
        stopAnimation(entry);
      }
    };
  }
  function syncSurface(entry) {
    var next = sheetSurface(entry);
    if (next === entry.surface) return;
    var hadPresentation = !!entry.presentation;
    cancelDrag(entry, true);
    var time = entry.animation && entry.animation.currentTime;
    if (entry.animation && typeof time !== "number") time = Math.max(0, win.performance.now() - entry.startedAt);
    var reportedRate = entry.animation && entry.animation.playbackRate;
    var rate = entry.animation && (entry.acceleratedAnimation === entry.animation ? 2 : reportedRate);
    var startTime = entry.animation && entry.animation.startTime;
    var oldStart = startTime;
    var oldTime = time;
    var continuing = entry.animation && !entry.closing && !hadPresentation;
    // Removing the loading shell can reset WebKit's running Animation to
    // currentTime=0/startTime=null even after the compositor displayed it.
    // Recover only that detached state from our monotonic entrance clock.
    // A valid sampled time, explicit pause or finite timeline origin wins.
    var pendingRate = rate !== reportedRate;
    if (continuing && entry.surface && !entry.surface.isConnected && entry.animation.playState === "running" &&
        ((time === 0 && !Number.isFinite(startTime)) || pendingRate)) {
      time = Math.min(entry.timing.duration, Math.max(time || 0, entry.clockElapsed +
        (win.performance.now() - entry.clockAt) * entry.clockRate));
      // An accepted updatePlaybackRate may still expose the old1x origin.
      // Resume its integrated2x playhead instead of multiplying that old origin.
      if (pendingRate) startTime = null;
    }
    var transfer = continuing && typeof win.__langformCommentsGestureTrace === "function" ? {
      oldTop: entry.surface.getBoundingClientRect().top, oldConnected: entry.surface.isConnected,
      baseTop: entry.motionBaseTop, oldTime: oldTime, recoveredTime: time, oldStart: oldStart, rate: rate,
      timeline: win.document.timeline && win.document.timeline.currentTime,
      elapsed: win.performance.now() - entry.startedAt,
      progress: entry.animation.effect && entry.animation.effect.getComputedTiming().progress,
      state: entry.animation.playState
    } : null;
    stopAnimation(entry);
    if (entry.closing) {
      clearCloseWait(entry);
      entry.closing = false;
      entry.finishClose = null;
    }
    entry.surface = next;
    ensureHandle(entry);
    // The skeleton and hydrated comments are the same entrance. Transfer its
    // playhead instead of sending fresh text back below the screen.
    if (continuing && (entry.fadeOnly ? canDecorate(next) : canAnimate(next))) {
      if (transfer) transfer.newRestTop = next.getBoundingClientRect().top;
      installAnimation(entry, time, rate, startTime);
      if (transfer) {
        transfer.newTop = next.getBoundingClientRect().top;
        transfer.newTime = entry.animation.currentTime;
        transfer.newStart = entry.animation.startTime;
        traceGesture(entry,null,"surface-swap","hydration",transfer);
      }
    }
  }
  function motion(entry, opening) {
    var surface = entry.surface;
    var fadeOnly = !!appMotion && reduceSpatialMotion();
    var background = surface && surface.closest(".engagement-panel-section-list-background");
    // Do not reset a legitimate existing wrapper scroll position by clipping
    // it (for example after a keyboard/layout change in a short viewport).
    if (!canDecorate(surface) || (background && background.scrollTop !== 0)) {
      stopAnimation(entry);
      return false;
    }
    var from = "0px 0px";
    var opacity = opening ? 0 : 1;
    var currentOffset = 0;
    if (entry.animation || entry.presentation) {
      var pose = win.getComputedStyle(surface);
      from = pose.translate || from;
      if (fadeOnly) opacity = pose.opacity || "1";
      var parts = from.trim().split(/\s+/);
      currentOffset = parts.length > 1 ? parseFloat(parts[1]) || 0 : 0;
    }
    // One bounded geometry read at the boundary, never while the list scrolls.
    // Subtract the current decoration to recover its resting position.
    var rect = surface.getBoundingClientRect();
    var viewportHeight = win.innerHeight || win.document.documentElement.clientHeight;
    var distance = Math.max(0, viewportHeight - rect.top + currentOffset) + 2;
    if (!isFinite(distance) || rect.height <= 0 || viewportHeight <= 0) {
      stopAnimation(entry);
      return false;
    }
    stopAnimation(entry);
    entry.fadeOnly = fadeOnly;
    entry.frames = fadeOnly
      ? [{ translate: from, opacity: opacity }, { translate: from, opacity: opening ? 1 : 0 }]
      : [{ translate: opening ? "0px " + distance + "px" : from },
        { translate: opening ? "0px 0px" : "0px " + distance + "px" }];
    entry.timing = {
      duration: appMotion ? (fadeOnly ? appMotion.durations.fade : opening ? appMotion.durations.sheetEnter : appMotion.durations.sheetExit) : opening ? 300 : 180,
      easing: appMotion ? (fadeOnly ? appMotion.easings.fade : opening ? appMotion.easings.enter : appMotion.easings.exit) : opening ? "cubic-bezier(0.16, 1, 0.3, 1)" : "cubic-bezier(0.4, 0, 1, 1)",
      fill: "both",
    };
    entry.startedAt = win.performance.now();
    entry.motionBaseTop = rect.top - currentOffset;
    entry.clockAt = entry.startedAt;
    entry.clockElapsed = 0;
    entry.clockRate = 1;
    installAnimation(entry);
    traceGesture(entry,null,opening ? "entrance" : "exit","started");
    return true;
  }
  function commentRenderer(node) {
    var renderer = node.querySelector("ytm-engagement-panel-section-list-renderer");
    if (!renderer) return null;
    if (renderer.classList.contains("comment-item-section") ||
        renderer.continuationUrl === "/watch_comment?action_get_comments=1" ||
        renderer.querySelector("ytm-comments-header-renderer")) return renderer;
    return null;
  }
  function inspect(entry) {
    if (!visible(entry.node)) { reset(entry); stopWaiting(entry); return; }
    if (entry.shown && entry.renderer && entry.renderer.isConnected) return;
    var renderer = commentRenderer(entry.node);
    if (!renderer) return;
    entry.renderer = renderer;
    syncSurface(entry);
    ensureHandle(entry);
    entry.shown = true;
    entry.commentIntent = true;
    stopWaiting(entry);
    if (!entry.entered && entry.surface) { entry.entered = true; motion(entry, true); }
  }
  function waitForRenderer(entry) {
    if (!visible(entry.node)) { reset(entry); return; }
    if (entry.shown && entry.renderer && entry.renderer.isConnected) return;
    syncSurface(entry);
    if (entry.renderer && !entry.renderer.isConnected) {
      // Hydration/data replacement changes the inner renderer, not the visible
      // outer sheet. Keep its entrance timeline and never restart at opacity 0.
      // An old X, however, belongs to the removed button and must be discarded.
      if (entry.closing) { stopAnimation(entry); clearCloseWait(entry); entry.closing = false; entry.finishClose = null; }
      entry.renderer = null;
      entry.shown = false;
    }
    // A slow network may leave the lazy module's skeleton mounted for seconds.
    // Observe only this still-unclassified panel until its comments arrive;
    // once recognized, deep mutations/scrolling produce no decoration work.
    if (!entry.waiting) {
      entry.waiting = true;
      entry.observer.observe(entry.node, { attributes: true, attributeOldValue: true, attributeFilter: ["hidden", "aria-hidden"], childList: true, subtree: true });
    }
    inspect(entry);
    if (!entry.entered) {
      if (entry.commentIntent && entry.surface) { entry.entered = true; motion(entry, true); }
      // With no opening intent, a populated shell may already have been drawn.
      // Its late comments can still be recognized/closed without fading that
      // existing surface out and translating it back to the entrance pose.
      else if (!entry.commentIntent && entry.node.childElementCount) entry.entered = true;
    }
  }
  function attach(node, connected) {
    if (node.tagName !== "YTM-ENGAGEMENT-PANEL") return;
    var previous = entries.get(node);
    if (!connected) {
      if (!previous) return;
      reset(previous);
      previous.observer.disconnect();
      node.removeEventListener("click", previous.click, true);
      entries.delete(node);
      return;
    }
    if (previous) return;
    var intent = pendingPanels.shift();
    var entry = { node: node, renderer: null, surface: null, animation: null, closeTimer: 0, shown: false, entered: false, commentIntent: !!(intent && intent.comments), closing: false, finishClose: null, replay: false, waiting: false, drag: null, presentation: null, restOffset: 0, springTarget: null, suppressClickUntil: 0 };
    entry.observer = new win.MutationObserver(function (records) {
      if (!visible(node)) { reset(entry); stopWaiting(entry); return; }
      // A hide and reopen can be batched into one delivery. Its old hidden
      // value still proves that any previous close must no longer fire.
      if (records.some(function (record) {
        return record.target === node && record.type === "attributes" &&
          ((record.attributeName === "hidden" && record.oldValue !== null) ||
           (record.attributeName === "aria-hidden" && record.oldValue === "true"));
      })) reset(entry);
      waitForRenderer(entry);
    });
    entry.touch = function (event) {
      // Readable comments become fully opaque as soon as the user reaches
      // them. A fade never follows a list scroll, header drag or release.
      if (entry.fadeOnly && entry.animation && !entry.closing) stopAnimation(entry);
      // Keep the displayed pose continuous. Accelerate the remaining entrance
      // while list/control touches still reach YouTube. A header candidate
      // takes its own drag lease without cancelling the visible pose here.
      if (!entry.closing && entry.animation && entry.acceleratedAnimation !== entry.animation && entry.animation.playbackRate !== 2 && typeof entry.animation.updatePlaybackRate === "function") {
        // WebKit may apply the new rate on its next timeline sample. Remember
        // this request so the matching pointer/touch pair cannot reschedule it.
        entry.acceleratedAnimation = entry.animation;
        var clockNow = win.performance.now();
        entry.clockElapsed = Math.max(entry.animation.currentTime || 0,
          (entry.clockElapsed || 0) + (clockNow - (Number.isFinite(entry.clockAt) ? entry.clockAt : clockNow)) * (entry.clockRate || 1));
        entry.clockAt = clockNow;
        entry.clockRate = 2;
        entry.animation.updatePlaybackRate(2);
      }
      if (event.type === "touchstart") {
        if (event.touches && event.touches.length === 1) beginDrag(entry, event, event.touches[0], "touch");
        else if (entry.drag && entry.drag.claimed) settleDrag(entry, entry.drag.offset, entry.restOffset || 0, 0, false);
        else cancelDrag(entry, false);
      } else if (event.pointerType && !event.button) {
        if (event.isPrimary === false) {
          if (entry.drag && entry.drag.claimed) settleDrag(entry, entry.drag.offset, entry.restOffset || 0, 0, false);
          else cancelDrag(entry, false);
        } else beginDrag(entry, event, event, "pointer");
      }
    };
    entry.input = function (event) {
      var touch = event.type.indexOf("touch") === 0, kind = touch ? "touch" : "pointer";
      var point = touch ? ((event.type === "touchmove" ? event.touches : event.changedTouches) || [])[0] : event;
      shieldContact(entry, event, point, kind);
      if (event.type === "touchmove" || event.type === "pointermove") {
        if (touch && event.touches.length !== 1 && entry.drag) { endDrag(entry, event, null, entry.drag.kind, true); return; }
        moveDrag(entry, event, point, kind);
      } else {
        endDrag(entry, event, point, kind, /cancel$/.test(event.type));
        shieldContact(entry, event, point, kind, true);
      }
    };
    entry.click = function (event) {
      if (!entry.replay && event.detail > 0 && win.performance.now() < entry.suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (entry.replay || !entry.shown || !visible(node) || event.defaultPrevented ||
          event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var target = event.target;
      var button = target && target.closest && target.closest(closeSelector);
      if (!button || !entry.renderer.contains(button) || button.disabled || button.getAttribute("aria-disabled") === "true") return;
      if (!canDecorate(entry.surface)) return;
      if (entry.closing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      entry.closing = true;
      finishOriginalClose(entry, button);
      // Only intercept an X if an exit actually started. A synchronous
      // button.click() replay here would be suppressed by its click-in-progress
      // flag, losing the original command in an invalid/scrolled layout.
      if (!motion(entry, false)) {
        entry.closing = false;
        entry.finishClose = null;
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    entries.set(node, entry);
    entry.observer.observe(node, { attributes: true, attributeOldValue: true, attributeFilter: ["hidden", "aria-hidden"], childList: true });
    node.addEventListener("click", entry.click, true);
    waitForRenderer(entry);
  }
  function cancelAll() {
    pendingPanels = [];
    entries.forEach(function (entry) {
      reset(entry);
      stopWaiting(entry);
    });
  }
  function settleMotion(event) {
    entries.forEach(function (entry) {
      if (entry.animation) traceGesture(entry,event,"motion-settle",event && /^(resize|orientationchange|blur)$/.test(event.type) ? event.type : "lifecycle");
      cancelDrag(entry, true);
      if (!entry.animation && !entry.finishClose) return;
      // Keyboard and rotation already move the real sheet. Hand back its
      // layout immediately instead of composing another percentage transform
      // over changing bounds. Preserve an X the user has already requested.
      var finishClose = entry.finishClose;
      stopAnimation(entry);
      clearCloseWait(entry);
      if (finishClose) finishClose();
      clearCloseWait(entry);
      entry.closing = false;
    });
  }
  // YouTube announces the data before mounting zrb's stable outer panel. The
  // first open can show Ebb's loading shell while g8NBcb is fetched. Classify
  // that shell from the actual push payload, so it and hydrated comments share
  // one entrance. Record other panel types too to preserve the stack's order.
  win.addEventListener("engagement-panel-push", function (event) {
    var detail = event.detail;
    // The current public mweb dispatcher/consumer uses NF; older versions
    // used wF. Read only these verified payload slots, never arbitrary data.
    var renderer = detail && ((detail.NF && detail.NF.engagementPanelSectionListRenderer) || (detail.wF && detail.wF.engagementPanelSectionListRenderer));
    // The payload identifies the outer comments panel, not its inner item
    // section. Current Watch responses use engagement-panel-comments-section.
    var comments = renderer && (renderer.panelIdentifier === "engagement-panel-comments-section" || renderer.panelIdentifier === "comment-item-section");
    traceGesture(null,event,"panel-intent",renderer ? comments ? "comments" : "other" : "unknown");
    if (renderer) pendingPanels.push({ identifier: detail.identifier, comments: !!comments });
  }, true);
  win.addEventListener("engagement-panel-pop", function (event) {
    var intent = pendingPanels[pendingPanels.length - 1];
    // Arb pops only the top of the stack. Repeated comment pushes can share
    // an identifier; a pop must not discard a lower shell before discovery.
    if (event.detail && intent && intent.identifier === event.detail.identifier) pendingPanels.pop();
  }, true);
  win.addEventListener("pagehide", function () { pendingPanels = []; });
  // Install once at document start, before YouTube's global recognizer. A
  // listener on the late-mounted panel runs after document/window capture;
  // both recognizers could then own the same header and the original would
  // snap its transform independently after our small drag returned to rest.
  ["pointerdown", "touchstart"].forEach(function (name) {
    win.addEventListener(name, function (event) {
      var target = event.target, panel = target && target.closest && target.closest("ytm-engagement-panel");
      var entry = panel && entries.get(panel);
      if (entries.size) traceGesture(entry,event,"route-start",entry ? "entry" : "no-entry");
      if (entry) entry.touch(event);
    }, { capture: true, passive: true });
  });
  ["pointermove", "pointerup", "pointercancel", "touchmove", "touchend", "touchcancel"].forEach(function (name) {
    win.addEventListener(name, function (event) {
      entries.forEach(function (entry) { if (entry.drag || entry.contact) entry.input(event); });
    }, { capture: true, passive: false });
  });
  win.__langformObserveOverlayContainers(attach);
  win.addEventListener("state-navigatestart", cancelAll);
  win.addEventListener("yt-navigate-start", cancelAll);
  win.addEventListener("resize", settleMotion);
  win.addEventListener("orientationchange", settleMotion);
  win.addEventListener("blur", settleMotion);
  ["visibilitychange", "langform-real-visibilitychange"].forEach(function (name) { win.document.addEventListener(name, function () { if (pageInactive()) settleMotion(); }); });
  if (win.visualViewport) win.visualViewport.addEventListener("resize", settleMotion);
  if (reduced && reduced.addEventListener) reduced.addEventListener("change", function () {
    if (reduced.matches) settleMotion();
  });
  if (appMotion) win.addEventListener("langform-motion-change", settleMotion);
})(window);
