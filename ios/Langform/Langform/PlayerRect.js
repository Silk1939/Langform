// Player view only. Tells the app where the video picture is and whether it
// plays, so the card can crop to the picture. Reads the video, never writes it.
(function (win) {
  if (!win || !win.document || win.__langformPlayerRect) return;
  win.__langformPlayerRect = true;
  var doc = win.document;
  var last = "";
  var timer = 0;

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

  function measure() {
    var video = onWatchPage() ? doc.querySelector("#movie_player video, ytm-player video, ytd-player video, video") : null;
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
    };
  }

  function report() {
    timer = 0;
    var target = handler();
    if (!target) return;
    var box = measure();
    var key = [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height), box.playing ? 1 : 0].join(",");
    if (key === last) return;
    last = key;
    try {
      target.postMessage(box);
    } catch (err) {
      /* the page is going away */
    }
  }

  function soon() {
    if (!timer) timer = win.setTimeout(report, 120);
  }

  ["playing", "pause", "ended", "emptied", "loadedmetadata", "resize"].forEach(function (name) {
    doc.addEventListener(name, soon, true);
  });
  doc.addEventListener("scroll", soon, { capture: true, passive: true });
  win.addEventListener("resize", soon);
  win.addEventListener("pageshow", soon);
  win.addEventListener("yt-navigate-finish", soon);
  win.setInterval(soon, 1000);

  win.__langformMeasureVideo = function () {
    last = "";
    return measure();
  };
})(typeof window !== "undefined" ? window : this);
