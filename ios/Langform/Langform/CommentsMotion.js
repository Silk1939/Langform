// The mobile watch page mounts comments in panel-container >
// ytm-engagement-panel, not in the generic bottom-sheet-container. Its g8NBcb
// renderer identifies comments by comment-item-section / continuationUrl and
// owns the header drag transform on .engagement-panel-container. Animate the
// solid sheet with an independent translate, leaving that transform and the
// fixed scrim's containing block untouched. Never fade readable comment text.
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
  var closeSelector = ".engagement-panel-section-list-header-button.close-button button";
  var movingAttribute = "data-langform-comments-moving";
  var clipStyle = win.document.createElement("style");
  clipStyle.textContent = "ytm-engagement-panel .engagement-panel-section-list-background.at-top[" + movingAttribute + "]{overflow:clip!important}";
  (win.document.head || win.document.documentElement).appendChild(clipStyle);

  function visible(node) {
    return node.isConnected && !node.hidden && node.getAttribute("aria-hidden") !== "true";
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
    stopAnimation(entry);
    clearCloseWait(entry);
    entry.surface = null;
    entry.closing = false;
    entry.finishClose = null;
    entry.renderer = null;
    entry.shown = false;
    entry.entered = false;
  }
  function sheetSurface(entry) {
    return entry.node.querySelector(".engagement-panel-container");
  }
  function canAnimate(surface) {
    return surface && typeof surface.animate === "function" &&
      win.CSS && win.CSS.supports && win.CSS.supports("translate", "0px 1px") &&
      !(reduced && reduced.matches);
  }
  function installAnimation(entry, currentTime, playbackRate, startTime) {
    var surface = entry.surface;
    // YouTube focuses the header button during entrance. A translated child
    // expands overflow:auto's scroll range, so focus can scroll its ancestor
    // hundreds of pixels and snap back when the effect ends. Clip only that
    // wrapper while moving; the inner comment list retains its own scrolling.
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
    animation.onfinish = function () {
      if (entry.animation !== animation || entry.surface !== surface) return;
      if (entry.closing) {
        // Keep the offscreen frame while YouTube's original command removes
        // the panel. Cancelling here would flash it back at its resting pose.
        var finishClose = entry.finishClose;
        if (finishClose) finishClose();
      } else {
        stopAnimation(entry);
      }
    };
  }
  function syncSurface(entry) {
    var next = sheetSurface(entry);
    if (next === entry.surface) return;
    var time = entry.animation && entry.animation.currentTime;
    if (entry.animation && typeof time !== "number") time = Math.max(0, win.performance.now() - entry.startedAt);
    var rate = entry.animation && entry.animation.playbackRate;
    var startTime = entry.animation && entry.animation.startTime;
    var continuing = entry.animation && !entry.closing;
    stopAnimation(entry);
    if (entry.closing) {
      clearCloseWait(entry);
      entry.closing = false;
      entry.finishClose = null;
    }
    entry.surface = next;
    // The skeleton and hydrated comments are the same entrance. Transfer its
    // playhead instead of sending fresh text back below the screen.
    if (continuing && canAnimate(next)) installAnimation(entry, time, rate, startTime);
  }
  function motion(entry, opening) {
    var surface = entry.surface;
    var background = surface && surface.closest(".engagement-panel-section-list-background");
    // Do not reset a legitimate existing wrapper scroll position by clipping
    // it (for example after a keyboard/layout change in a short viewport).
    if (!canAnimate(surface) || (background && background.scrollTop !== 0)) {
      stopAnimation(entry);
      return false;
    }
    var from = "0px 0px";
    var currentOffset = 0;
    if (entry.animation) {
      from = win.getComputedStyle(surface).translate || from;
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
    entry.frames = [{ translate: opening ? "0px " + distance + "px" : from },
      { translate: opening ? "0px 0px" : "0px " + distance + "px" }];
    entry.timing = {
      duration: opening ? 300 : 180,
      easing: opening ? "cubic-bezier(0.16, 1, 0.3, 1)" : "cubic-bezier(0.4, 0, 1, 1)",
      fill: "both",
    };
    entry.startedAt = win.performance.now();
    installAnimation(entry);
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
      node.removeEventListener("pointerdown", previous.touch, true);
      node.removeEventListener("touchstart", previous.touch, true);
      entries.delete(node);
      return;
    }
    if (previous) return;
    var intent = pendingPanels.shift();
    var entry = { node: node, renderer: null, surface: null, animation: null, closeTimer: 0, shown: false, entered: false, commentIntent: !!(intent && intent.comments), closing: false, finishClose: null, replay: false, waiting: false };
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
    entry.touch = function () {
      // Keep the displayed pose continuous. Accelerate the remaining entrance
      // while the original touch reaches YouTube immediately; do not cancel
      // the effect on pointerdown and jump the sheet to its final position.
      if (!entry.closing && entry.animation && entry.acceleratedAnimation !== entry.animation && entry.animation.playbackRate !== 2 && typeof entry.animation.updatePlaybackRate === "function") {
        // WebKit may apply the new rate on its next timeline sample. Remember
        // this request so the matching pointer/touch pair cannot reschedule it.
        entry.acceleratedAnimation = entry.animation;
        entry.animation.updatePlaybackRate(2);
      }
    };
    entry.click = function (event) {
      if (entry.replay || !entry.shown || !visible(node) || event.defaultPrevented ||
          event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var target = event.target;
      var button = target && target.closest && target.closest(closeSelector);
      if (!button || !entry.renderer.contains(button) || button.disabled || button.getAttribute("aria-disabled") === "true") return;
      if (!canAnimate(entry.surface)) return;
      if (entry.closing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      entry.closing = true;
      var href = win.location.href;
      entry.finishClose = function () {
        entry.finishClose = null;
        if (!visible(node) || !button.isConnected || win.location.href !== href) {
          reset(entry);
          return;
        }
        entry.replay = true;
        try { button.click(); } finally { entry.replay = false; }
        // A no-op/failed original command must not leave an invisible modal.
        // Normal removal/hide cancels this timer through the shared observer.
        clearCloseWait(entry);
        var closingAnimation = entry.animation;
        entry.closeTimer = win.setTimeout(function () {
          if (!entry.closing || entry.animation !== closingAnimation) return;
          entry.closeTimer = 0;
          stopAnimation(entry);
          entry.closing = false;
        }, 500);
      };
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
    node.addEventListener("pointerdown", entry.touch, { capture: true, passive: true });
    node.addEventListener("touchstart", entry.touch, { capture: true, passive: true });
    waitForRenderer(entry);
  }
  function cancelAll() {
    pendingPanels = [];
    entries.forEach(function (entry) {
      reset(entry);
      stopWaiting(entry);
    });
  }
  function settleMotion() {
    entries.forEach(function (entry) {
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
    var renderer = detail && detail.wF && detail.wF.engagementPanelSectionListRenderer;
    if (renderer) pendingPanels.push({ identifier: detail.identifier, comments: renderer.panelIdentifier === "comment-item-section" });
  }, true);
  win.addEventListener("engagement-panel-pop", function (event) {
    var intent = pendingPanels[pendingPanels.length - 1];
    // Arb pops only the top of the stack. Repeated comment pushes can share
    // an identifier; a pop must not discard a lower shell before discovery.
    if (event.detail && intent && intent.identifier === event.detail.identifier) pendingPanels.pop();
  }, true);
  win.addEventListener("pagehide", function () { pendingPanels = []; });
  win.__langformObserveOverlayContainers(attach);
  win.addEventListener("state-navigatestart", cancelAll);
  win.addEventListener("yt-navigate-start", cancelAll);
  win.addEventListener("resize", settleMotion);
  win.addEventListener("orientationchange", settleMotion);
  if (win.visualViewport) win.visualViewport.addEventListener("resize", settleMotion);
  if (reduced && reduced.addEventListener) reduced.addEventListener("change", function () {
    if (reduced.matches) settleMotion();
  });
})(window);
