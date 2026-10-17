// Player view only. Tells the app where the video picture is, whether it plays,
// and whether the page has painted, so the player is only shown once there is
// something to see and the card can crop to the picture. Native playback changes
// follow a deliberate Watch-open intent or explicit playback controls.
(function (win) {
  if (!win || !win.document || win.__langformPlayerRect) return;
  win.__langformPlayerRect = true;
  var doc = win.document;
  var last = "";
  var timer = 0;
  var frame = 0;
  var playbackFrame = 0;
  var playbackTimer = 0;
  var playbackDirty = false;
  var lastPlayback = "";
  var active = true;
  var painted = false;
  var fullscreenExitAttempt = null;
  var fullscreenExitTimer = 0;

  function handler() {
    var handlers = win.webkit && win.webkit.messageHandlers;
    var target = handlers && handlers.langformPlayer;
    return target && typeof target.postMessage === "function" ? target : null;
  }

  function onWatchPage() {
    var path = "";
    try {
      path = win.location.pathname || "";
    } catch (err) {
      return false;
    }
    return path === "/watch" || path.indexOf("/watch/") === 0;
  }

  var cachedVideo = null;
  var sizeWatch = null;
  var mediaDiscovery = null;
  var mediaDiscoveryTimer = 0;

  function stopMediaDiscovery() {
    if (mediaDiscovery) mediaDiscovery.disconnect();
    mediaDiscovery = null;
    if (mediaDiscoveryTimer) win.clearTimeout(mediaDiscoveryTimer);
    mediaDiscoveryTimer = 0;
  }

  function discoverMainMedia() {
    if (!active || !onWatchPage()) { stopMediaDiscovery(); return; }
    if (!currentVideo()) return;
    stopMediaDiscovery();
    soon();
  }

  function armMediaDiscovery() {
    stopMediaDiscovery();
    if (!active || !onWatchPage() || currentVideo() || typeof win.MutationObserver !== "function") return;
    // An unstarted video can arrive after first paint without emitting a media
    // event. Observe only that initial insertion; never poll or measure each
    // feed mutation, and release the observer after discovery or a deadline.
    mediaDiscovery = new win.MutationObserver(function (records) {
      if (!active) { stopMediaDiscovery(); return; }
      var candidate = records.some(function (record) {
        return Array.prototype.some.call(record.addedNodes, function (node) {
          return node && node.nodeType === 1 &&
            ((node.matches && node.matches("video, #movie_player, ytm-player, ytd-player")) ||
             (node.querySelector && node.querySelector("video, #movie_player, ytm-player, ytd-player")));
        });
      });
      if (candidate) discoverMainMedia();
    });
    mediaDiscovery.observe(doc, { childList: true, subtree: true });
    mediaDiscoveryTimer = win.setTimeout(stopMediaDiscovery, 10000);
  }

  function forgetVideo() {
    cachedVideo = null;
    if (sizeWatch) sizeWatch.disconnect();
    sizeWatch = null;
  }

  function findPlayerVideo() {
    // A selector list is matched in document order, not selector priority.
    // Never let an earlier recommendation/preview become the playback target.
    var root = doc.getElementById("movie_player");
    return root ? root.querySelector("video") : doc.querySelector("ytm-player video, ytd-player video");
  }

  // The element is looked up once per page, not on every report.
  function currentVideo() {
    // Late media events and native reads can arrive after pagehide. They must
    // not reacquire the released node, observer or playback-start deadline.
    if (!active || !onWatchPage()) return null;
    // Hydration can retain an old media node elsewhere in the document while
    // replacing the main player. Connection alone does not preserve ownership:
    // native Play/Pause and geometry must follow the current player container.
    var root = doc.getElementById("movie_player");
    if (cachedVideo && cachedVideo.isConnected &&
        (root ? root.contains(cachedVideo) : cachedVideo.closest("ytm-player, ytd-player"))) return cachedVideo;
    forgetVideo();
    cachedVideo = findPlayerVideo();
    if (cachedVideo && typeof win.ResizeObserver === "function") {
      try {
        sizeWatch = new win.ResizeObserver(soon);
        sizeWatch.observe(cachedVideo);
      } catch (err) {
        sizeWatch = null;
      }
    }
    return cachedVideo;
  }

  function videoID() {
    try { return onWatchPage() ? new URL(win.location.href).searchParams.get("v") || "" : ""; }
    catch (err) { return ""; }
  }

  function matchesVideo(expectedID) {
    var id = videoID();
    return active && !!id && (!expectedID || expectedID === id);
  }

  var documentVideoID = videoID();
  var navigation = null;

  function playerVideoID() {
    var root = doc.getElementById("movie_player");
    try {
      var data = root && typeof root.getVideoData === "function" && root.getVideoData();
      return data && typeof data.video_id === "string" ? data.video_id : "";
    } catch (err) { return ""; }
  }

  function fullscreenInfo(video, actualID) {
    var state = { open: false, target: null, exit: null };
    var id = videoID();
    if (!active || !video || !id || (actualID && actualID !== id) || (!actualID && id !== documentVideoID)) return state;
    var custom = win.__langformFullscreen;
    try {
      if (custom && typeof custom.isOpen === "function" && custom.isOpen() === true) {
        return { open: true, target: custom,
          exit: typeof custom.exit === "function" ? function () { return custom.exit(id); } : null };
      }
    } catch (err) { /* retain separately confirmed platform state */ }
    var element = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (element && (element === video || (typeof element.contains === "function" && element.contains(video)))) {
      state.open = true;
      var documentExit = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (typeof documentExit === "function") return { open: true, target: doc, exit: documentExit };
    }
    if (video.webkitDisplayingFullscreen === true) {
      state.open = true;
      if (typeof video.webkitExitFullscreen === "function") return { open: true, target: video, exit: video.webkitExitFullscreen };
    }
    var root = doc.getElementById("movie_player");
    try {
      // These exact methods exist on YouTube's current player API. Never toggle
      // an unconfirmed or unknown fullscreen implementation into fullscreen.
      if (root && root.contains(video) && typeof root.isFullscreen === "function" && root.isFullscreen() === true) {
        state.open = true;
        if (typeof root.toggleFullscreen === "function") return { open: true, target: root, exit: root.toggleFullscreen };
      }
    } catch (err) { /* keep only a separately confirmed platform state */ }
    return state;
  }

  function cancelFullscreenExit() {
    if (fullscreenExitTimer) win.clearTimeout(fullscreenExitTimer);
    fullscreenExitTimer = 0;
    fullscreenExitAttempt = null;
  }

  // Only the native explicit down/menu action calls this. A successful return
  // acknowledges the request, not completion; reports follow actual platform
  // state and never change playback, seek position or page navigation.
  win.__langformExitFullscreen = function (expectedID) {
    if (typeof expectedID !== "string" || !expectedID || !matchesVideo(expectedID)) return false;
    var video = currentVideo();
    var info = fullscreenInfo(video, playerVideoID());
    if (!info.open || !info.exit) return false;
    if (fullscreenExitAttempt && fullscreenExitAttempt.id === expectedID && fullscreenExitAttempt.video === video) return false;
    cancelFullscreenExit();
    var attempt = { id: expectedID, video: video };
    fullscreenExitAttempt = attempt;
    function completed() {
      if (fullscreenExitAttempt !== attempt) return;
      cancelFullscreenExit();
      if (matchesVideo(attempt.id) && currentVideo() === attempt.video) soon();
    }
    // A WebKit void/no-op exit cannot hold the explicit-action guard forever.
    // This deadline only releases the guard; it performs no automatic retry.
    fullscreenExitTimer = win.setTimeout(completed, 1000);
    try {
      var result = info.exit.call(info.target);
      if (result && typeof result.then === "function") result.then(completed, completed);
      soon();
      return true;
    } catch (err) {
      completed();
      return false;
    }
  };

  function decoded(video) {
    return !!(video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0);
  }

  // Decoding and page paint do not prove that the video surface has presented
  // its first frame. Native keeps the tapped thumbnail until this one-shot
  // acknowledgement; observing it never starts playback or loops per frame.
  var firstPictureVideo = null;
  var firstPictureID = "";
  var firstPictureFrame = null;
  var firstPictureGeneration = 0;
  var firstPicturePresented = false;
  var firstPictureObservationFailed = false;

  function resetFirstPicture() {
    firstPictureGeneration += 1;
    if (firstPictureFrame !== null && firstPictureVideo) {
      try { firstPictureVideo.cancelVideoFrameCallback(firstPictureFrame); } catch (err) {}
    }
    firstPictureFrame = null;
    firstPictureVideo = null;
    firstPictureID = "";
    firstPicturePresented = false;
    firstPictureObservationFailed = false;
  }

  function firstPicture(video, actualID) {
    var id = videoID();
    var matches = active && !navigation && video && id && id === documentVideoID && (!actualID || actualID === id);
    if (!matches) { resetFirstPicture(); return false; }
    if (video !== firstPictureVideo || id !== firstPictureID) {
      resetFirstPicture();
      firstPictureVideo = video;
      firstPictureID = id;
    }
    if (!firstPicturePresented && !firstPictureObservationFailed && firstPictureFrame === null && decoded(video) &&
        typeof video.requestVideoFrameCallback === "function" && typeof video.cancelVideoFrameCallback === "function") {
      var generation = firstPictureGeneration;
      try {
        var handle = video.requestVideoFrameCallback(function () {
          if (generation !== firstPictureGeneration) return;
          if (firstPictureFrame === handle) firstPictureFrame = null;
          var currentID = playerVideoID();
          if (!active || navigation || currentVideo() !== video || videoID() !== id ||
              (currentID && currentID !== id) || !decoded(video)) return;
          firstPicturePresented = true;
          soon();
        });
        firstPictureFrame = handle;
      } catch (err) { firstPictureObservationFailed = true; /* allow native's decoded-image fallback */ }
    }
    return firstPicturePresented;
  }

  function cancelNavigationFrame(pending) {
    if (pending && pending.frame !== null && pending.frameVideo) {
      try { pending.frameVideo.cancelVideoFrameCallback(pending.frame); } catch (err) {}
      pending.frame = null;
    }
  }

  function navigationMatches(pending) {
    return active && navigation === pending && videoID() === pending.id && playerVideoID() === pending.id;
  }

  function awaitNavigationFrame() {
    var pending = navigation;
    if (!pending || !pending.started || !navigationMatches(pending)) return;
    var video = currentVideo();
    // A replacement element cannot contain the former video's decoded frame.
    // A reused element needs a fresh loadedmetadata/loadeddata event instead.
    if (video && video !== pending.originalVideo && decoded(video)) pending.mediaLoaded = true;
    if (!pending.mediaLoaded || !decoded(video) || pending.frame !== null || pending.presented ||
        typeof video.requestVideoFrameCallback !== "function") return;
    pending.frameVideo = video;
    var generation = pending.mediaGeneration;
    try {
      var handle = video.requestVideoFrameCallback(function () {
        if (pending.frame === handle) pending.frame = null;
        if (!navigationMatches(pending) || pending.mediaGeneration !== generation || currentVideo() !== video || !pending.mediaLoaded || !decoded(video)) return;
        pending.presented = true;
        soon();
      });
      pending.frame = handle;
    } catch (err) { /* native's bounded full-load fallback remains available */ }
  }

  // Native may try this only for an already loaded mobile watch document.
  // A normal anchor reaches YouTube's own complete-page SPA router. A final
  // bubble listener cancels browser-default navigation if no router claims it;
  // native owns the short, ticket-bound full-document fallback.
  win.__langformNavigateWatch = function (href, expectedCurrentID, token) {
    var url;
    try { url = new URL(href, win.location.href); } catch (err) { return false; }
    var id = url.searchParams.get("v") || "";
    var video = currentVideo();
    if (!matchesVideo(expectedCurrentID) || !expectedCurrentID || videoID() === id ||
        win.location.hostname !== "m.youtube.com" || url.origin !== win.location.origin || url.pathname !== "/watch" ||
        !/^[A-Za-z0-9_-]{11}$/.test(id) || typeof token !== "string" || !token ||
        !doc.body || doc.readyState !== "complete" || nativeDragging ||
        (navigation && !(navigation.presented && navigation.complete)) || playerVideoID() !== expectedCurrentID ||
        !video || typeof video.requestVideoFrameCallback !== "function" || typeof video.cancelVideoFrameCallback !== "function") return false;
    cancelNavigationFrame(navigation);
    resetFirstPicture();
    var pending = { token: token, id: id, originalVideo: video, started: false, complete: false,
      mediaLoaded: false, mediaGeneration: 0, presented: false, frame: null, frameVideo: null };
    navigation = pending;
    resetInteraction();
    var anchor = doc.createElement("a");
    anchor.id = "langform-native-watch-link";
    anchor.hidden = true;
    anchor.href = url.href;
    var claimed = false;
    function preventDefaultNavigation(event) {
      if (event.target !== anchor) return;
      claimed = event.defaultPrevented;
      event.preventDefault();
    }
    doc.body.appendChild(anchor);
    win.addEventListener("click", preventDefaultNavigation);
    try { anchor.click(); } catch (err) { claimed = false; }
    win.removeEventListener("click", preventDefaultNavigation);
    anchor.remove();
    if (!claimed) {
      cancelNavigationFrame(pending);
      navigation = null;
      return false;
    }
    soon();
    return true;
  };

  var nativeDragging = false;
  var dragVideoID = "";
  var suppressClickUntil = 0;

  win.__langformIsNativeDragging = function () { return active && nativeDragging; };

  function resetInteraction() {
    nativeDragging = false;
    dragVideoID = "";
    suppressClickUntil = 0;
    surfaceTouch = null;
  }

  win.__langformSetNativeDragging = function (dragging, expectedID) {
    if (!matchesVideo(expectedID)) return false;
    if (dragging && win.__langformPlaybackHold) win.__langformPlaybackHold.cancel();
    if (dragging) {
      nativeDragging = true;
      dragVideoID = videoID();
      suppressClickUntil = 0;
    } else if (nativeDragging) {
      nativeDragging = false;
      suppressClickUntil = Date.now() + 450;
      win.dispatchEvent(new win.Event("langform-native-drag-end"));
    }
    return true;
  };

  var playbackVideo = null;
  var playbackID = "";
  var playbackIssue = "";
  var waitingForData = false;
  var playedOnce = false;
  var progressTime = null;
  var confirmedProgress = false;
  var playAttempt = null;
  var playTimer = 0;

  function resetProgress(video) {
    var time = video ? Number(video.currentTime) : NaN;
    progressTime = isFinite(time) && time >= 0 ? time : null;
    confirmedProgress = false;
  }

  function cancelPlayDeadline() {
    if (playTimer) win.clearTimeout(playTimer);
    playTimer = 0;
    playAttempt = null;
  }

  function syncPlayback(video) {
    var id = videoID();
    if (playbackVideo === video && playbackID === id) return;
    cancelPlayDeadline();
    playbackVideo = video;
    playbackID = id;
    playbackIssue = "";
    waitingForData = false;
    playedOnce = false;
    resetProgress(video);
  }

  // A timeupdate can also be a seek or an ad. Only an advancing, usable main
  // stream can supersede a missed recovery event or a late YouTube state=3.
  function notePlaybackProgress(video) {
    function invalidate() {
      var changed = confirmedProgress;
      confirmedProgress = false;
      return changed;
    }
    var time = Number(video.currentTime);
    var previous = progressTime;
    progressTime = isFinite(time) && time >= 0 ? time : null;
    var id = videoID();
    if (!active || !id || video.paused || video.ended || video.seeking || video.error || video.readyState < 3 ||
        (playbackIssue && playbackIssue !== "timeout")) return invalidate();
    var root = doc.getElementById("movie_player");
    var actualID = "";
    try {
      if (root) {
        if (!root.contains(video) || root.classList.contains("ad-showing") || root.classList.contains("ad-interrupting")) return invalidate();
        var data = typeof root.getVideoData === "function" && root.getVideoData();
        if (data && data.isAd === true) return invalidate();
        actualID = data && data.video_id || "";
      }
    } catch (err) { return invalidate(); }
    if ((actualID && actualID !== id) || (!actualID && id !== documentVideoID)) return invalidate();
    if (previous === null || progressTime === null || time <= previous) return false;
    var changed = !confirmedProgress || waitingForData || playbackIssue === "timeout";
    confirmedProgress = true;
    waitingForData = false;
    playedOnce = true;
    playbackIssue = "";
    cancelPlayDeadline();
    return changed;
  }

  function playbackStatus(video) {
    syncPlayback(video);
    if (!active || !video) return "unavailable";
    if (video.error || (playbackIssue && playbackIssue !== "timeout")) return "failed";
    if (video.ended) return "ended";
    var state = null;
    var root = doc.getElementById("movie_player");
    try { if (root && typeof root.getPlayerState === "function") state = root.getPlayerState(); } catch (err) {}
    if (video.paused) {
      if (playbackIssue === "timeout") return "failed";
      return playedOnce || video.currentTime > 0 || state === 2 ? "paused" : "unstarted";
    }
    if (waitingForData || (!playedOnce && (video.readyState < 3 || state === -1 || state === 5)) ||
        (state === 3 && (!confirmedProgress || video.readyState < 3 || video.seeking))) return "buffering";
    return "playing";
  }

  function currentAttempt(attempt) {
    return active && playAttempt === attempt && videoID() === attempt.id && currentVideo() === attempt.video;
  }

  // One deadline per explicit start or buffering episode. It only makes Retry
  // available; neither this timer nor a rejected promise retries playback.
  function watchPlaybackStart(video) {
    if (playAttempt) return playAttempt;
    var attempt = { video: video, id: videoID() };
    playAttempt = attempt;
    playTimer = win.setTimeout(function () {
      playTimer = 0;
      if (!currentAttempt(attempt)) return;
      if (playbackStatus(video) !== "playing" && !video.ended) {
        playbackIssue = "timeout";
        playbackChanged();
      } else {
        playAttempt = null;
      }
    }, 3000);
    return attempt;
  }

  function playRejected(attempt) {
    if (!currentAttempt(attempt)) return;
    cancelPlayDeadline();
    playbackIssue = "rejected";
    playbackChanged();
  }

  var replayAutonavCancelNode = null;
  function traceReplay(phase, values) {
    if (win.__langformGestureInputProbe !== true || typeof win.__langformReplayDiagnostic !== "function") return;
    try { win.__langformReplayDiagnostic(Object.assign({phase:phase},values)); } catch (_) { /* opt-in diagnostics cannot affect playback */ }
  }

  function replayAutonavOwner(root) {
    return root && (root.closest("ytm-player,ytd-player") || root.closest("#player-container-id"));
  }

  function replayTargetMatches(expectedID, video, root, owner, source) {
    if (typeof expectedID !== "string" || !expectedID || !matchesVideo(expectedID) || nativeDragging ||
        !root || !root.isConnected || doc.getElementById("movie_player") !== root ||
        !video || !video.isConnected || currentVideo() !== video || root.querySelector("video") !== video ||
        !root.contains(video) || !owner || !owner.isConnected || replayAutonavOwner(root) !== owner ||
        owner.querySelector("#movie_player") !== root ||
        (video.currentSrc || video.src || "") !== source ||
        (navigation && (!navigation.complete || !navigation.presented || !navigationMatches(navigation)))) return false;
    var data = typeof root.getVideoData === "function" && root.getVideoData();
    return !!(data && data.video_id === expectedID && !data.isAd &&
      !root.classList.contains("ad-showing") && !root.classList.contains("ad-interrupting"));
  }

  function replayControlAvailable(control, root, video, owner, expectedID) {
    if (!control.isConnected || replayAutonavOwner(control) !== owner ||
        (control.closest("#movie_player") && control.closest("#movie_player") !== root)) {
      traceReplay("control", {result:"target"}); return false;
    }
    if (control.disabled || control.matches(":disabled") || control.getAttribute("aria-disabled") === "true" ||
        typeof control.click !== "function") { traceReplay("control", {result:"disabled"}); return false; }
    if (control.closest("[hidden]")) { traceReplay("control", {result:"hidden"}); return false; }
    var ownFullscreen = false, custom = win.__langformFullscreen;
    if (custom && typeof custom.isOpen === "function" && custom.isOpen() === true && typeof custom.getZoomContext === "function") {
      var context = custom.getZoomContext();
      ownFullscreen = !!(context && context.id === expectedID && context.root === root && context.video === video);
    }
    // Our confirmed fullscreen deliberately hides/inerts YouTube's original
    // controls. Its programmatic Cancel still owns this exact ended player.
    if (ownFullscreen) return true;
    var html = doc.documentElement, miniAttribute = "data-langform-mini-video";
    var ownMini = !!(win.__langformStageInsets && win.__langformStageInsets.nativeMini === true &&
      html.hasAttribute(miniAttribute) && !html.hasAttribute("data-langform-fullscreen"));
    var miniValue = ownMini ? html.getAttribute(miniAttribute) : null, available = true;
    // The native mini deliberately hides the original endscreen via this one
    // CSS marker. Read its underlying visibility synchronously without that
    // rule; foreign hidden/inert/display/opacity still reject the control.
    // Restore before the original click, without yielding a paint or timer.
    if (ownMini) html.removeAttribute(miniAttribute);
    try {
      // Visibility is inherited but can be overridden by a descendant. The
      // original endscreen does this while hiding its surrounding chrome.
      // Check effective visibility at the actionable control/live media only;
      // display, opacity, hidden and inert still apply through every ancestor.
      for (var index = 0, branches = [control, video]; available && index < branches.length; index++) {
        var branchVisible = false;
        for (var node = branches[index]; node; node = node.parentElement) {
          if (node.hasAttribute("inert") || node.inert || node.hidden) { traceReplay("control",{result:node.hidden ? "hidden" : "inert",tag:node.tagName}); available = false; break; }
          var css = win.getComputedStyle(node);
          var visibilityHidden = css.visibility === "hidden" || css.visibility === "collapse";
          if (node === branches[index]) branchVisible = !visibilityHidden;
          if (visibilityHidden && win.__langformGestureInputProbe === true) {
            var role = node === control ? "control" : node === root ? "player" :
              node.matches(".player-controls-content") ? "controls-content" :
              node.matches("#player-control-overlay") ? "control-overlay" :
              node.matches(".ytwPlayerEndscreenContainer") ? "endscreen-container" :
              node.matches(".ytwPlayerEndscreenPlayerEndscreen") ? "endscreen-body" :
              node.matches(".ytwPlayerEndscreenButtonContainer") ? "endscreen-buttons" : "other";
            traceReplay("control",{result:"visibility",tag:node.tagName,beforeMini:ownMini,
              controlVisible:branchVisible,rootBranch:index === 1,nodeRole:role,matched:node !== branches[index]});
          }
          if (css.display === "none" || visibilityHidden && node === branches[index] ||
              css.opacity !== "" && Number(css.opacity) === 0) { traceReplay("control",{result:css.display === "none" ? "display" : css.opacity !== "" && Number(css.opacity) === 0 ? "opacity" : "visibility",tag:node.tagName,beforeMini:ownMini}); available = false; break; }
        }
      }
    } finally {
      if (ownMini && win.__langformStageInsets && win.__langformStageInsets.nativeMini === true && !html.hasAttribute(miniAttribute))
        html.setAttribute(miniAttribute, miniValue);
    }
    var valid = available && (!ownMini || !!(win.__langformStageInsets && win.__langformStageInsets.nativeMini === true && html.getAttribute(miniAttribute) === miniValue));
    traceReplay("control",{result:"available",matched:valid,beforeMini:ownMini,afterMini:html.hasAttribute(miniAttribute)});
    return valid;
  }

  function cancelEndedAutonav(expectedID, video, root, initial) {
    traceReplay("start",{ended:video.ended === true,initial:initial === true,nativeMini:!!(win.__langformStageInsets && win.__langformStageInsets.nativeMini),miniMarker:doc.documentElement.hasAttribute("data-langform-mini-video")});
    if (initial || video.ended !== true) return true;
    if (replayAutonavCancelNode) return false;
    var owner = replayAutonavOwner(root), source = video.currentSrc || video.src || "";
    var matchingTarget = replayTargetMatches(expectedID, video, root, owner, source);
    if (win.__langformGestureInputProbe === true) traceReplay("target",{matched:matchingTarget,owner:!!owner,sourceMatches:(video.currentSrc || video.src || "") === source,navComplete:!navigation || !!navigation.complete,navPresented:!navigation || !!navigation.presented,navMatches:!navigation || navigationMatches(navigation)});
    if (!matchingTarget) return true;
    // Verified on the live mobile endscreen: this action cancels its current
    // countdown, while the global Autoplay switch retains the user's choice.
    var selector = ".player-controls-content > player-endscreen.ytwPlayerEndscreenHost " +
      ".ytwPlayerEndscreenPlayerEndscreen > .ytwPlayerEndscreenButtonContainer > " +
      "ytm-button-renderer.ytwPlayerEndscreenActionButton > button.ytSpecButtonShapeNextHost.ytSpecButtonShapeNextTonal";
    var originalControls = owner.querySelectorAll(selector);
    var controls = Array.prototype.filter.call(originalControls, function (control) {
      var label = String(control.getAttribute("aria-label") || control.textContent || "").replace(/\s+/g, " ").trim();
      return /^(Abbrechen|Cancel)$/i.test(label) && replayControlAvailable(control, root, video, owner, expectedID);
    });
    traceReplay("candidates",{count:Math.min(8,controls.length),rawCount:Math.min(8,originalControls.length)});
    if (controls.length !== 1) return true;
    if (!replayTargetMatches(expectedID, video, root, owner, source)) return false;
    replayAutonavCancelNode = controls[0];
    try { replayAutonavCancelNode.click(); traceReplay("cancel",{result:"clicked"}); }
    finally { replayAutonavCancelNode = null; }
    return replayTargetMatches(expectedID, video, root, owner, source);
  }

  // A deliberate seek back from the end also abandons this endscreen's
  // pending Next action. Keep the same original-control/owner checks as Replay;
  // this entry point neither starts media nor changes global Autoplay.
  win.__langformCancelEndedAutonav = function (expectedID, expectedVideo, expectedRoot) {
    var video = currentVideo(), root = doc.getElementById("movie_player");
    if (!matchesVideo(expectedID) || nativeDragging || !video || video !== expectedVideo ||
        root !== expectedRoot || video.ended !== true || video.paused !== true) return false;
    try { return cancelEndedAutonav(expectedID, video, root, false); }
    catch (_) { return false; }
  };

  // Native mini-player and expanded Start/Retry buttons call this. Reports
  // follow actual media events and rejected requests, without optimistic state.
  function requestPlayback(expectedID, playOnly, initial) {
    if (!matchesVideo(expectedID) || nativeDragging) return false;
    if (initial && navigation && (!navigation.started || !navigation.complete || !navigation.mediaLoaded || !navigationMatches(navigation))) return false;
    var video = currentVideo();
    if (!video) return false;
    syncPlayback(video);
    var root = doc.getElementById("movie_player");
    var shouldPlay = playOnly || video.paused || video.ended;
    var action = shouldPlay ? "playVideo" : "pauseVideo";
    var attempt = null;
    try {
      if (root && root.contains(video)) {
        if (typeof root.getVideoData === "function") {
          var data = root.getVideoData();
          if (data && data.video_id && data.video_id !== videoID()) return false;
        }
      }
      var swipe = win.__langformPlaybackSwipe;
      if(swipe && typeof swipe.cancelEndedSeekGuard === "function")swipe.cancelEndedSeekGuard(expectedID);
      if (shouldPlay && !cancelEndedAutonav(expectedID, video, root, initial)) return false;
      if (win.__langformWatchBackgroundAudio && typeof win.__langformWatchBackgroundAudio.explicitAction === "function")
        win.__langformWatchBackgroundAudio.explicitAction(expectedID);
      cancelPlayDeadline();
      playbackIssue = "";
      if (shouldPlay) attempt = watchPlaybackStart(video);
      var usedPlayerAPI = root && root.contains(video) && typeof root[action] === "function";
      var result = usedPlayerAPI ? root[action]() :
        shouldPlay ? video.play() : video.pause();
      // YouTube's exposed playVideo can return without starting its media.
      // Finish this same explicit Start request once through the matching media
      // element. A buffered/running stream, ad or changed route is never touched.
      if (playOnly && usedPlayerAPI && video.paused && currentAttempt(attempt) &&
          matchesVideo(expectedID) && !nativeDragging && currentVideo() === video &&
          root === doc.getElementById("movie_player") && root.contains(video) &&
          (!navigation || (navigation.complete && navigation.presented) ||
            (initial && navigation.started && navigation.complete && navigation.mediaLoaded && navigationMatches(navigation))) &&
          !root.classList.contains("ad-showing") && !root.classList.contains("ad-interrupting")) {
        var currentData = typeof root.getVideoData === "function" && root.getVideoData();
        var currentID = currentData && currentData.video_id || "";
        if ((!currentData || currentData.isAd !== true) &&
            (currentID ? currentID === videoID() : videoID() === documentVideoID)) {
          // The direct request now supplies the authoritative promise outcome.
          if (result && typeof result.catch === "function") result.catch(function () {});
          result = video.play();
        }
      }
      if (result && typeof result.catch === "function") result.catch(function () { if (attempt) playRejected(attempt); });
      playbackChanged();
      return true;
    } catch (err) {
      if (attempt) playRejected(attempt);
      return false;
    }
  }
  win.__langformTogglePlayback = function (expectedID) {
    return requestPlayback(expectedID, false);
  };
  // Expanded recovery is a Play action, never a toggle that could pause an
  // already pending buffered stream. A bound Watch-open intent can use the same
  // one request before its first frame; stale SPA media remain excluded.
  win.__langformPlay = function (expectedID, initial) {
    return requestPlayback(expectedID, true, initial === true);
  };

  // A system Pause is meaningful even while WebKit has already paused on Home:
  // revoke the old continuation privilege before issuing the original command.
  win.__langformPause = function (expectedID) {
    if (!matchesVideo(expectedID) || nativeDragging) return false;
    var video=currentVideo(),root=doc.getElementById("movie_player");
    if (!video || !root || !root.contains(video)) return false;
    var mediaSource=String(video.currentSrc || video.src || ""),sourceAttribute=video.getAttribute("src");
    try {
      var data=typeof root.getVideoData==="function" && root.getVideoData();
      if (data && (data.isAd || data.video_id && data.video_id!==expectedID) ||
          !matchesVideo(expectedID) || nativeDragging || root!==doc.getElementById("movie_player") ||
          video!==currentVideo() || !root.isConnected || !video.isConnected || !root.contains(video) ||
          String(video.currentSrc || video.src || "")!==mediaSource || video.getAttribute("src")!==sourceAttribute ||
          root.classList.contains("ad-showing") || root.classList.contains("ad-interrupting")) return false;
      if (win.__langformWatchBackgroundAudio && typeof win.__langformWatchBackgroundAudio.explicitAction === "function")
        win.__langformWatchBackgroundAudio.explicitAction(expectedID);
      if (!video.paused) { if (typeof root.pauseVideo === "function") root.pauseVideo(); else video.pause(); }
      playbackChanged();return true;
    } catch (_) { return false; }
  };

  function eventPath(event) {
    if (typeof event.composedPath === "function") {
      var path = event.composedPath();
      if (path && path.length) return path;
    }
    var path = [];
    var node = event.target;
    while (node) { path.push(node); node = node.parentNode || node.host; }
    return path;
  }

  function playerNode(node) {
    return node && node.nodeType === 1 && (node.id === "movie_player" || node.id === "player-control-overlay" ||
      /^(YTM-PLAYER|YTD-PLAYER|YTM-CUSTOM-CONTROL|VIDEO)$/.test(node.tagName));
  }

  function consume(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    return true;
  }

  function isControl(node) {
    if (!node || node.nodeType !== 1) return false;
    if (/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|LABEL)$/.test(node.tagName) || node.isContentEditable) return true;
    if (/^(button|slider|link|menuitem|checkbox|switch|textbox|tab)$/.test(node.getAttribute("role") || "")) return true;
    if (String(node.id || "").indexOf("langform-") === 0 || node.hasAttribute("data-langform-kurz")) return true;
    return /scrub|seek|progress|chapter|airplay/i.test(String(node.id || "") + " " + String(node.className || ""));
  }

  // YouTube's mouse-like surface click toggles playback. Its existing a11y
  // button instead changes only controls visibility, using YouTube's own state.
  // Whitelist empty surfaces and leave every real control and unknown DOM alone.
  // During hydration the toggle may not exist yet. Never let that temporary
  // absence turn the black picture into YouTube's mouse-like Play/Pause button.
  win.__langformHandlePlayerClick = function (event) {
    if (!event || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !matchesVideo()) return false;
    // The earlier common WebViewLinks capture handler calls this entry before
    // the gesture modules' window listeners. Give their owned trailing clicks
    // and current touch-click lease first refusal on this path as well.
    if (typeof win.__langformConsumePlaybackSwipeClick === "function" && win.__langformConsumePlaybackSwipeClick(event)) return true;
    if (typeof win.__langformConsumePlaybackHoldClick === "function" && win.__langformConsumePlaybackHoldClick(event)) return true;
    if (typeof win.__langformConsumeFullscreenGestureClick === "function" && win.__langformConsumeFullscreenGestureClick(event)) return true;
    var path = eventPath(event);
    // Only the exact internal countdown Cancel bypasses a remaining drag-click
    // guard, and only during its synchronous, deliberately untrusted click.
    if (replayAutonavCancelNode && event.isTrusted === false && path[0] === replayAutonavCancelNode) return false;
    if (!path.some(playerNode)) return false;
    if (dragVideoID === videoID() && (nativeDragging || Date.now() < suppressClickUntil)) return consume(event);
    if (typeof win.__langformHasOpenOverlay === "function" && win.__langformHasOpenOverlay()) return false;
    if (path.some(isControl)) return false;
    var target = path[0];
    if (!target || target.nodeType !== 1) return false;
    var video = currentVideo();
    if (target === video && video.controls) return false;
    var surface = target === video || target.id === "movie_player" ||
      /(^|\s)(player-control-overlay|html5-video-container|player-controls-middle|player-controls-bottom|fullscreen-controls|player-controls-background|top-full-screen-controls|player-controls-content|player-controls-background-container)(\s|$)/.test(String(target.id || "") + " " + String(target.className || ""));
    if (!surface) return false;
    var toggle = doc.getElementById("player-controls-a11y-toggle");
    if (!toggle || toggle.tagName !== "BUTTON" || !toggle.isConnected || toggle.disabled || toggle.getAttribute("aria-disabled") === "true" || typeof toggle.click !== "function") return consume(event);
    try { toggle.click(); } catch (err) { return consume(event); }
    return consume(event);
  };
  win.addEventListener("click", win.__langformHandlePlayerClick, true);
  function freshTouch() {
    if (!nativeDragging) suppressClickUntil = 0;
  }
  win.addEventListener("pointerdown", freshTouch, { capture: true, passive: true });
  win.addEventListener("touchstart", freshTouch, { capture: true, passive: true });
  var surfaceTouch = null;
  function trackSurfaceTouch(event) {
    var path = eventPath(event);
    if (!matchesVideo() || !path.some(playerNode) || path.some(isControl)) return;
    var touch = event.touches ? event.touches[0] : event;
    if (!touch) return;
    surfaceTouch = { x: touch.clientX, y: touch.clientY, id: videoID(), moved: false };
  }
  function moveSurfaceTouch(event) {
    if (!surfaceTouch) return;
    var touch = event.touches ? event.touches[0] : event;
    if (!touch) return;
    var dx = touch.clientX - surfaceTouch.x;
    var dy = touch.clientY - surfaceTouch.y;
    if (dx * dx + dy * dy > 64) surfaceTouch.moved = true;
  }
  function finishSurfaceTouch(event) {
    if (!surfaceTouch) return;
    if (surfaceTouch.id === videoID() && (surfaceTouch.moved || /cancel$/.test(event.type))) {
      dragVideoID = surfaceTouch.id;
      suppressClickUntil = Date.now() + 450;
    }
    surfaceTouch = null;
  }
  ["pointerdown", "touchstart"].forEach(function (name) { win.addEventListener(name, trackSurfaceTouch, { capture: true, passive: true }); });
  ["pointermove", "touchmove"].forEach(function (name) { win.addEventListener(name, moveSurfaceTouch, { capture: true, passive: true }); });
  ["pointerup", "pointercancel", "touchend", "touchcancel"].forEach(function (name) { win.addEventListener(name, finishSurfaceTouch, { capture: true, passive: true }); });
  // Do not consume touchend/touchcancel: YouTube needs them to cancel its
  // long-press playback-speed timer when a native pan takes over.

  function viewportDimension(value) {
    value = Number(value);
    return isFinite(value) && value > 0 ? value : 0;
  }

  function inactivePlayerViewport(video, mediaRect, actualID, fullscreen, state) {
    var id=videoID(),root=doc.getElementById("movie_player");
    // At the real media end, the mobile player can move its video offscreen
    // while showing a replay/endscreen in the same visible player. Native must
    // follow that current surface, rather than crop the invisible media node.
    var poster=video && state==="unstarted" && video.paused===true && video.ended===false &&
      video.readyState<2 && video.currentTime===0 && !video.error && !video.seeking;
    if(!video || !(video.ended===true || poster) || !id || actualID!==id || fullscreen || !root || !root.isConnected ||
        !root.contains(video) || root.querySelector("video")!==video ||
        (navigation ? !navigationMatches(navigation) || !navigation.complete || !navigation.presented : id!==documentVideoID))return null;
    function valid(rect){return rect && [rect.left,rect.top,rect.width,rect.height].every(Number.isFinite) && rect.width>8 && rect.height>8;}
    function overlaps(a,b){return Math.min(a.left+a.width,b.left+b.width)>Math.max(a.left,b.left) && Math.min(a.top+a.height,b.top+b.height)>Math.max(a.top,b.top);}
    try {
      var data=typeof root.getVideoData==="function" && root.getVideoData();
      if(!data || data.video_id!==id || data.isAd || root.classList.contains("ad-showing") || root.classList.contains("ad-interrupting"))return null;
      var rect=root.getBoundingClientRect();
      if(!valid(rect) || valid(mediaRect) && overlaps(mediaRect,rect) ||
          !overlaps(rect,{left:0,top:0,width:viewportDimension(win.innerWidth),height:viewportDimension(win.innerHeight)}))return null;
      for(var node=root;node;node=node.parentElement){
        var css=win.getComputedStyle(node);
        if(css.display==="none" || css.visibility==="hidden" || css.visibility==="collapse" || css.opacity!=="" && Number(css.opacity)===0)return null;
      }
      return rect;
    } catch(err){return null;}
  }

  function measure() {
    var video = currentVideo();
    var rect = null;
    var zoomBasis = false;
    if (video && typeof video.getBoundingClientRect === "function") {
      try {
        // The native player follows the media viewport, not the enlarged pixels
        // inside it. Zoom only exposes a basis rect for its exact live owner.
        var zoom = win.__langformPlaybackZoom;
        var basis = zoom && typeof zoom.getLayoutRect === "function" ? zoom.getLayoutRect(video) : null;
        if (basis && Number.isFinite(basis.left) && Number.isFinite(basis.top) &&
            Number.isFinite(basis.width) && Number.isFinite(basis.height) &&
            basis.width > 8 && basis.height > 8) { rect = basis; zoomBasis = true; }
      } catch (err) {
        rect = null;
      }
      if (!rect) {
        try { rect = video.getBoundingClientRect(); } catch (err) { rect = null; }
      }
    }
    var actualID = playerVideoID();
    var fullscreen = fullscreenInfo(video, actualID).open;
    var playbackState = playbackStatus(video);
    // The unstarted poster is visible before YouTube moves its unloaded media
    // into place. Preserve the native Start contact without declaring a frame.
    if(!zoomBasis && video)rect=inactivePlayerViewport(video,rect,actualID,fullscreen,playbackState) || rect;
    var mediaReady = navigation ? navigationMatches(navigation) && navigation.complete && navigation.presented :
      active && videoID() === documentVideoID && (!actualID || actualID === documentVideoID) && decoded(video);
    mediaReady = !!(mediaReady && rect && rect.width > 8 && rect.height > 8);
    var mediaPresented = navigation ? mediaReady : firstPicture(video, actualID) && mediaReady;
    var seekRect = null;
    try {
      var swipe = win.__langformPlaybackSwipe;
      if (video && actualID === videoID() && swipe && typeof swipe.getSeekRect === "function") seekRect = swipe.getSeekRect(video, actualID);
    } catch (err) { /* keep the existing native media priority on unavailable seek context */ }
    return {
      x: rect ? Number(rect.left) || 0 : 0,
      y: rect ? Number(rect.top) || 0 : 0,
      width: rect ? Number(rect.width) || 0 : 0,
      height: rect ? Number(rect.height) || 0 : 0,
      seekRect: seekRect,
      viewportWidth: viewportDimension(win.innerWidth),
      viewportHeight: viewportDimension(win.innerHeight),
      playing: !!(video && !video.paused && !video.ended),
      hasVideo: !!video,
      fullscreen: fullscreen,
      playbackState: playbackState,
      playbackIssue: video && video.error ? "media-error" : playbackIssue,
      painted: navigation ? mediaReady : painted,
      mediaReady: mediaReady,
      mediaPresented: !!mediaPresented,
      frameObservationSupported: !!(video && typeof video.requestVideoFrameCallback === "function" &&
        typeof video.cancelVideoFrameCallback === "function" && (navigation || !firstPictureObservationFailed)),
      playerVideoID: actualID,
      navigationToken: navigation ? navigation.token : "",
      navigationTargetID: navigation ? navigation.id : "",
      navigationStarted: !!(navigation && navigation.started),
      navigationComplete: !!(navigation && navigation.complete),
      navigationMediaLoaded: !!(navigation && navigation.mediaLoaded),
      href: String(win.location.href || ""),
    };
  }

  function report() {
    timer = 0;
    frame = 0;
    if (!active) return;
    var target = handler();
    if (!target) return;
    var box = measure();
    playbackDirty = false;
    var statusKey = playbackKey(box);
    var key = [
      Math.round(box.x),
      Math.round(box.y),
      Math.round(box.width),
      Math.round(box.height),
      JSON.stringify(box.seekRect),
      box.viewportWidth,
      box.viewportHeight,
      box.playing ? 1 : 0,
      box.hasVideo ? 1 : 0,
      box.fullscreen ? 1 : 0,
      box.playbackState,
      box.playbackIssue,
      box.painted ? 1 : 0,
      box.mediaReady ? 1 : 0,
      box.mediaPresented ? 1 : 0,
      box.frameObservationSupported ? 1 : 0,
      box.playerVideoID,
      box.navigationToken,
      box.navigationStarted ? 1 : 0,
      box.navigationComplete ? 1 : 0,
      box.navigationMediaLoaded ? 1 : 0,
      box.href,
    ].join(",");
    // A partial may have changed native state since this exact full payload.
    // Do not swallow the return to that earlier state or poison its dedupe key.
    if (key === last && statusKey === lastPlayback) return;
    last = key;
    lastPlayback = statusKey;
    try {
      target.postMessage(box);
      if(typeof win.__langformPlayerRectDiagnostic==="function"){
        try { win.__langformPlayerRectDiagnostic({x:box.x,y:box.y,width:box.width,height:box.height,
          playerVideoID:box.playerVideoID,playbackState:box.playbackState,href:box.href}); } catch(err) { /* read-only diagnostic */ }
      }
    } catch (err) {
      /* the page is going away */
    }
  }

  function playbackKey(box) {
    return [box.playing ? 1 : 0, box.hasVideo ? 1 : 0, box.playbackState, box.playbackIssue,
      box.playerVideoID, box.navigationToken, box.navigationTargetID, box.navigationStarted ? 1 : 0,
      box.navigationMediaLoaded ? 1 : 0, box.href].join(",");
  }

  function reportPlayback() {
    playbackFrame = 0;
    playbackTimer = 0;
    playbackDirty = false;
    if (!active) return;
    var target = handler();
    var video = currentVideo();
    var id = videoID();
    if (!target || !video || !id || !video.closest("#movie_player, ytm-player, ytd-player")) return;
    var root = doc.getElementById("movie_player");
    var actualID = playerVideoID();
    // A removed main node must not turn an unrelated preview into an audio
    // pause. Keep the native session until an identified main-media event.
    if ((root && !root.contains(video)) || (actualID && actualID !== id) || (!actualID && id !== documentVideoID)) return;
    var box = {
      kind: "playback",
      hasVideo: true,
      playing: !video.paused && !video.ended,
      playbackState: playbackStatus(video),
      playbackIssue: video.error ? "media-error" : playbackIssue,
      href: String(win.location.href || ""),
      playerVideoID: actualID,
      navigationToken: navigation ? navigation.token : "",
      navigationTargetID: navigation ? navigation.id : "",
      navigationStarted: !!(navigation && navigation.started),
      navigationMediaLoaded: !!(navigation && navigation.mediaLoaded),
    };
    var key = playbackKey(box);
    if (key === lastPlayback) return;
    lastPlayback = key;
    try { target.postMessage(box); } catch (err) { /* the page is going away */ }
  }

  function soonPlayback() {
    if (!active || playbackFrame || playbackTimer) return;
    if (typeof win.requestAnimationFrame === "function" && typeof win.cancelAnimationFrame === "function") {
      playbackFrame = win.requestAnimationFrame(reportPlayback);
    } else {
      playbackTimer = win.setTimeout(reportPlayback, 16);
    }
  }

  function playbackChanged() {
    playbackDirty = true;
    if (scrolling) soonPlayback();
    else soon();
  }

  function cancelPlaybackReport() {
    if (playbackFrame) win.cancelAnimationFrame(playbackFrame);
    if (playbackTimer) win.clearTimeout(playbackTimer);
    playbackFrame = 0;
    playbackTimer = 0;
    playbackDirty = false;
  }

  function soon() {
    if (!active || scrolling || frame || timer) return;
    // Coalesce media and geometry events into the next display frame, so the
    // native controls and first reveal do not wait through a fixed debounce.
    if (typeof win.requestAnimationFrame === "function" && typeof win.cancelAnimationFrame === "function") {
      frame = win.requestAnimationFrame(report);
    } else {
      timer = win.setTimeout(report, 16);
    }
  }

  function cancelReport() {
    if (frame) win.cancelAnimationFrame(frame);
    if (timer) win.clearTimeout(timer);
    frame = 0;
    timer = 0;
  }

  // Measuring forces a layout. During a scroll that is a dropped frame, so the
  // rect is read once the page has come to rest.
  var scrolling = false;
  var scrollTimer = 0;
  function geometryChanged() {
    if (!active) return;
    if (fullscreenExitAttempt && !fullscreenInfo(currentVideo(), playerVideoID()).open) cancelFullscreenExit();
    // Rotation/fullscreen can move the picture while a scroll is settling.
    // Report the current viewport with its rect on the next frame, so native
    // can discard an older portrait/landscape measurement in transit.
    if (scrollTimer) win.clearTimeout(scrollTimer);
    scrollTimer = 0;
    scrolling = false;
    soon();
  }
  function onScroll(event) {
    if (!active) return;
    var target = event && event.target;
    if (target && target !== doc && target !== doc.scrollingElement && target !== doc.documentElement && target !== doc.body) {
      var video = cachedVideo && cachedVideo.isConnected ? cachedVideo : findPlayerVideo();
      // A comments/menu/chapter list scroll does not move the video. Keep media
      // reports responsive and avoid measuring the player when that list rests.
      if (!video || typeof target.contains !== "function" || !target.contains(video)) return;
    }
    scrolling = true;
    cancelReport();
    // Scrolls postpone geometry only. A previously queued media update survives
    // even before the first rect, with no dummy geometry or readiness fields.
    if (playbackDirty) soonPlayback();
    if (scrollTimer) win.clearTimeout(scrollTimer);
    scrollTimer = win.setTimeout(function () {
      scrollTimer = 0;
      scrolling = false;
      soon();
    }, 160);
  }

  // Events only. Nothing polls the page while a video plays.
  ["play", "playing", "pause", "waiting", "stalled", "canplay", "error", "ended", "emptied", "loadstart", "loadedmetadata", "loadeddata", "seeking", "seeked", "timeupdate", "resize"].forEach(function (name) {
    doc.addEventListener(name, function (event) {
      var video = currentVideo();
      // Capturing sees every preview/ad/replaced media node in the document.
      // Only this player's current video can change its readiness or playback;
      // unrelated media must not force a layout read in the next frame.
      if (!video || event.target !== video) return;
      if (name === "emptied" || name === "loadstart" || name === "loadedmetadata") resetFirstPicture();
      if (event.target === video) {
        syncPlayback(video);
        if (name === "timeupdate") {
          // Continuous playback needs no geometry reads or reports. Schedule
          // only its first confirmed progress/recovery; report() still dedupes.
          if (notePlaybackProgress(video)) playbackChanged();
          return;
        }
        if (name === "playing") {
          resetProgress(video);
          playedOnce = true;
          waitingForData = false;
          playbackIssue = "";
          cancelPlayDeadline();
        } else if (name === "pause" || name === "ended") {
          resetProgress(video);
          waitingForData = false;
          cancelPlayDeadline();
        } else if (name === "error") {
          resetProgress(video);
          cancelPlayDeadline();
          playbackIssue = "media-error";
        } else if (name === "emptied" || name === "loadstart") {
          resetProgress(video);
          playedOnce = false;
          waitingForData = false;
        } else if (name === "waiting" || name === "play" ||
            (name === "stalled" && video.readyState < 3 && !video.seeking)) {
          // A stalled download can coexist with smooth buffered playback; it
          // only needs recovery UI when usable media data is actually missing.
          resetProgress(video);
          if (name !== "play") waitingForData = true;
          if (!video.paused && !video.ended && !playbackIssue) watchPlaybackStart(video);
        } else if (name === "canplay") {
          resetProgress(video);
          waitingForData = false;
        } else if (name === "seeking" || name === "seeked" || name === "loadedmetadata") {
          resetProgress(video);
        }
      }
      var pending = navigation;
      if (pending && event.target === video) {
        if (name === "emptied" || name === "loadstart") {
          cancelNavigationFrame(pending);
          pending.mediaGeneration += 1;
          pending.mediaLoaded = false;
          pending.presented = false;
        } else if ((name === "loadedmetadata" || name === "loadeddata") && pending.started && navigationMatches(pending)) {
          if (name === "loadedmetadata") {
            cancelNavigationFrame(pending);
            pending.mediaGeneration += 1;
            pending.presented = false;
          }
          pending.mediaLoaded = true;
        }
        awaitNavigationFrame();
      }
      if (name === "resize") soon();
      else playbackChanged();
    }, true);
  });
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  ["resize", "orientationchange", "player-fullscreen-change"].forEach(function (name) {
    win.addEventListener(name, geometryChanged);
  });
  ["fullscreenchange", "webkitfullscreenchange", "webkitbeginfullscreen", "webkitendfullscreen"].forEach(function (name) {
    doc.addEventListener(name, geometryChanged, true);
  });
  if (win.visualViewport) win.visualViewport.addEventListener("resize", geometryChanged);
  win.addEventListener("pageshow", function () {
    active = true;
    armMediaDiscovery();
    observePaint();
    soon();
  });
  doc.addEventListener("DOMContentLoaded", discoverMainMedia);
  function navigated() {
    cancelFullscreenExit();
    resetInteraction();
    forgetVideo();
    armMediaDiscovery();
    resetFirstPicture();
    if (navigation && navigation.started && videoID() === navigation.id) navigation.complete = true;
    awaitNavigationFrame();
    soon();
  }
  win.addEventListener("yt-navigate-finish", navigated);
  win.addEventListener("state-navigateend", navigated);
  win.addEventListener("state-navigatestart", function (event) {
    var pending = navigation;
    if (!pending) return;
    var url;
    try { url = new URL(event.detail && event.detail.href, win.location.href); } catch (err) { return; }
    if (url.origin !== win.location.origin || url.pathname !== "/watch" || url.searchParams.get("v") !== pending.id) return;
    pending.started = true;
    soon();
  });
  win.addEventListener("video-data-change", function () { awaitNavigationFrame(); soon(); });
  win.addEventListener("pagehide", function () {
    active = false;
    stopMediaDiscovery();
    cancelFullscreenExit();
    cancelPlayDeadline();
    cancelNavigationFrame(navigation);
    resetFirstPicture();
    navigation = null;
    resetInteraction();
    cancelReport();
    cancelPlaybackReport();
    if (scrollTimer) win.clearTimeout(scrollTimer);
    scrollTimer = 0;
    scrolling = false;
    forgetVideo();
    if (watcher && typeof watcher.disconnect === "function") watcher.disconnect();
    watcher = null;
  });

  // First contentful paint: the page has drawn something other than an empty view.
  function notePaint() {
    if (painted) return;
    painted = true;
    if (watcher && typeof watcher.disconnect === "function") watcher.disconnect();
    soon();
  }
  var watcher = null;
  function observePaint() {
    if (painted || watcher || !active || typeof win.PerformanceObserver !== "function") return;
    try {
      watcher = new win.PerformanceObserver(function (list) {
        if (!active) return;
        if (list.getEntries().some(function (entry) { return entry.name === "first-contentful-paint"; })) notePaint();
      });
      watcher.observe({ type: "paint", buffered: true });
    } catch (err) {
      watcher = null;
      /* no paint timing in this WebKit */
    }
  }
  observePaint();
  armMediaDiscovery();

  win.__langformMeasureVideo = function () {
    return measure();
  };
})(typeof window !== "undefined" ? window : this);
