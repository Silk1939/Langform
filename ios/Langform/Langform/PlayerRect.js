// Player view only. Tells the app where the video picture is, whether it plays,
// and whether the page has painted, so the player is only shown once there is
// something to see and the card can crop to the picture. Reads the video, never writes it.
(function (win) {
  if (!win || !win.document || win.__langformPlayerRect) return;
  win.__langformPlayerRect = true;
  var doc = win.document;
  var last = "";
  var timer = 0;
  var painted = false;

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

  // The element is looked up once per page, not on every report.
  function currentVideo() {
    if (!onWatchPage()) return null;
    if (cachedVideo && cachedVideo.isConnected) return cachedVideo;
    cachedVideo = doc.querySelector("#movie_player video, ytm-player video, ytd-player video, video");
    if (cachedVideo && typeof win.ResizeObserver === "function") {
      try {
        if (sizeWatch) sizeWatch.disconnect();
        sizeWatch = new win.ResizeObserver(soon);
        sizeWatch.observe(cachedVideo);
      } catch (err) {
        sizeWatch = null;
      }
    }
    return cachedVideo;
  }

  function measure() {
    var video = currentVideo();
    var rect = null;
    if (video && typeof video.getBoundingClientRect === "function") {
      try {
        rect = video.getBoundingClientRect();
      } catch (err) {
        rect = null;
      }
    }
    return {
      x: rect ? Number(rect.left) || 0 : 0,
      y: rect ? Number(rect.top) || 0 : 0,
      width: rect ? Number(rect.width) || 0 : 0,
      height: rect ? Number(rect.height) || 0 : 0,
      playing: !!(video && !video.paused && !video.ended),
      hasVideo: !!video,
      painted: painted,
      href: String(win.location.href || ""),
    };
  }

  function report() {
    timer = 0;
    var target = handler();
    if (!target) return;
    var box = measure();
    var key = [
      Math.round(box.x),
      Math.round(box.y),
      Math.round(box.width),
      Math.round(box.height),
      box.playing ? 1 : 0,
      box.hasVideo ? 1 : 0,
      box.painted ? 1 : 0,
      box.href,
    ].join(",");
    if (key === last) return;
    last = key;
    try {
      target.postMessage(box);
    } catch (err) {
      /* the page is going away */
    }
  }

  function soon() {
    if (scrolling) return;
    if (!timer) timer = win.setTimeout(report, 120);
  }

  // Measuring forces a layout. During a scroll that is a dropped frame, so the
  // rect is read once the page has come to rest.
  var scrolling = false;
  var scrollTimer = 0;
  function onScroll() {
    scrolling = true;
    if (timer) {
      win.clearTimeout(timer);
      timer = 0;
    }
    if (scrollTimer) win.clearTimeout(scrollTimer);
    scrollTimer = win.setTimeout(function () {
      scrollTimer = 0;
      scrolling = false;
      soon();
    }, 160);
  }

  // Events only. Nothing polls the page while a video plays.
  ["playing", "pause", "ended", "emptied", "loadedmetadata", "resize"].forEach(function (name) {
    doc.addEventListener(name, soon, true);
  });
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
  win.addEventListener("resize", soon);
  win.addEventListener("pageshow", soon);
  win.addEventListener("yt-navigate-finish", function () {
    cachedVideo = null;
    soon();
  });

  // First contentful paint: the page has drawn something other than an empty view.
  function notePaint() {
    if (painted) return;
    painted = true;
    soon();
  }
  try {
    if (typeof win.PerformanceObserver === "function") {
      var watcher = new win.PerformanceObserver(function (list) {
        if (list.getEntries().length) notePaint();
      });
      watcher.observe({ type: "paint", buffered: true });
    }
  } catch (err) {
    /* no paint timing in this WebKit */
  }

  win.__langformMeasureVideo = function () {
    last = "";
    return measure();
  };
})(typeof window !== "undefined" ? window : this);
