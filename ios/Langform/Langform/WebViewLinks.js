// Langform has two web views. The feed hands every video to the player view;
// the player view hands every page that is not a video back to the feed, so
// the video keeps playing in the card while the feed shows the channel.
(function (win) {
  if (!win || !win.document || win.__langformLinks) return;
  var host = String((win.location && win.location.hostname) || "");
  if (host !== "m.youtube.com" && host !== "www.youtube.com" && host !== "youtube.com") return;
  win.__langformLinks = true;

  function handler(name) {
    var handlers = win.webkit && win.webkit.messageHandlers;
    var target = handlers && handlers[name];
    return target && typeof target.postMessage === "function" ? target : null;
  }

  function youtubeHost(name) {
    return name === "m.youtube.com" || name === "www.youtube.com" || name === "youtube.com";
  }

  function isWatch(url) {
    return url.pathname === "/watch" || url.pathname.indexOf("/watch/") === 0;
  }

  function onWatchPage() {
    try {
      return isWatch(new URL(win.location.href));
    } catch (err) {
      return false;
    }
  }

  function ours(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.hasAttribute && node.hasAttribute("data-langform-kurz")) return true;
    return String(node.id || "").indexOf("langform-") === 0;
  }

  function eventPath(event) {
    if (typeof event.composedPath === "function") {
      var path = event.composedPath();
      if (path && path.length) return path;
    }
    var list = [];
    var node = event.target;
    while (node) {
      list.push(node);
      node = node.parentNode || node.host || null;
    }
    return list;
  }

  function linkOf(event) {
    var path = eventPath(event);
    for (var i = 0; i < path.length; i++) {
      var node = path[i];
      if (ours(node)) return null;
      if (node && node.tagName === "A" && node.hasAttribute && node.hasAttribute("href")) return node;
    }
    return null;
  }

  function hand(event, name, href) {
    var target = handler(name);
    if (!target) return;
    try {
      target.postMessage({ href: href });
    } catch (err) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  }

  function onClick(event) {
    if (!event || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    var link = linkOf(event);
    if (!link) return;
    var raw = String(link.getAttribute("href") || "");
    if (!raw || raw.charAt(0) === "#" || /^javascript:/i.test(raw)) return;
    var url;
    try {
      url = new URL(raw, win.location.href);
    } catch (err) {
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    var video = youtubeHost(url.hostname) && isWatch(url) && !!url.searchParams.get("v");
    if (handler("langformOpenWatch")) {
      if (video && !onWatchPage()) hand(event, "langformOpenWatch", url.href);
      return;
    }
    if (handler("langformOpenFeed") && youtubeHost(url.hostname) && !isWatch(url)) {
      hand(event, "langformOpenFeed", url.href);
    }
  }

  win.addEventListener("click", onClick, true);
})(typeof window !== "undefined" ? window : this);
