// Keep YouTube's real post text, expansion command, permalink and comments.
// Only make a plain tap on the card/text forward to its existing post action.
(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformCommunityPosts || win.location.hostname !== 'm.youtube.com') return;
  var handlers = win.webkit && win.webkit.messageHandlers;
  if (!handlers || !(handlers.langformOpenWatch || handlers.langformPlayer)) return;
  win.__langformCommunityPosts = true;
  var doc = win.document, alive = true, replay = null, contact = null, blockedUntil = 0;
  var posts = 'ytm-backstage-post-renderer, ytm-post-renderer, ytd-backstage-post-renderer, yt-post-renderer, yt-shared-post-renderer';
  var text = '.post-text, .post-content-text, #content-text, .ytPostRendererTextContent, .ytSharedPostRendererTextContent, ytm-text-expander';
  var controls = 'a, button, input, textarea, select, [contenteditable], [role="button"], [role="link"], ytm-menu-renderer, ytm-subscribe-button-renderer, ytm-video-renderer, ytm-video-with-context-renderer, video';
  function active() {
    if (!alive || win.__langformFeedActive === false) return false;
    try { var visibility = win.__langformRealVisibility; if (visibility && typeof visibility.inactive === 'function') return !visibility.inactive(); } catch (_) {}
    return !doc.hidden;
  }
  function usable(node) {
    if (!node || !node.isConnected || node.hidden || node.disabled || node.getAttribute('aria-hidden') === 'true' || node.getAttribute('aria-disabled') === 'true') return false;
    for (var parent = node.parentElement; parent; parent = parent.parentElement) if (parent.hidden || parent.getAttribute('aria-hidden') === 'true') return false;
    var style = win.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
  }
  function expander(card) {
    var list = card.querySelectorAll('ytm-text-expander .text-expander-button, .post-text .text-expander-button, .post-content-text .text-expander-button, .ytPostRendererReadMore, .ytSharedPostRendererReadMore, button[aria-expanded="false"]');
    for (var i = 0; i < list.length; i++) {
      var node = list[i];
      if (!usable(node) || node.getAttribute('aria-expanded') === 'true') continue;
      // Generic aria-expanded is also used by polls, replies and menus.
      if (node.matches('button[aria-expanded="false"]') && !node.closest('ytm-text-expander, .post-text, .post-content-text') && !/^(?:mehr\s*(?:lesen|anzeigen)|read more|show more)(?:\s|$)/i.test(node.textContent.trim())) continue;
      return node;
    }
    return null;
  }
  function permalink(card) {
    var links = card.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      try {
        var url = new win.URL(links[i].getAttribute('href'), win.location.href);
        if (url.protocol === 'https:' && /^(?:m\.|www\.)?youtube\.com$/.test(url.hostname) && /^\/post\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) && !url.search && !url.hash && usable(links[i])) return links[i];
      } catch (_) {}
    }
    return null;
  }
  function forward(event, action) {
    event.preventDefault(); event.stopImmediatePropagation();
    replay = action;
    try { action.click(); } finally { replay = null; }
  }
  win.addEventListener('click', function (event) {
    if (replay || !active() || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || win.performance.now() < blockedUntil) return;
    var target = event.target && (event.target.nodeType === 1 ? event.target : event.target.parentElement);
    if (!target || !target.closest || target.closest(controls)) return;
    var card = target.closest(posts);
    if (!card || !usable(card) || target.closest('bottom-sheet-container, ytm-engagement-panel, #dialog-container, #langform-discovery-sheet')) return;
    var action = expander(card) || permalink(card);
    if (action && action !== target && !action.contains(target)) { forward(event, action); return; }
    // Some mobile variants retain the complete text but omit the expansion
    // command. Reveal only an actually clipped original text node; never
    // synthesize post data, replies, or an inaccessible replacement detail UI.
    var body = target.closest(text) || card.querySelector(text);
    if (!body || body.matches('ytm-text-expander') || body.getAttribute('data-langform-post-expanded') === 'true') return;
    var style = win.getComputedStyle(body), clamp = parseInt(style.webkitLineClamp || style.getPropertyValue('-webkit-line-clamp'), 10);
    if (!(clamp > 0 || ((style.overflow === 'hidden' || style.overflowY === 'hidden') && style.maxHeight && style.maxHeight !== 'none'))) return;
    body.style.setProperty('-webkit-line-clamp', 'unset', 'important');
    body.style.setProperty('max-height', 'none', 'important');
    body.style.setProperty('overflow', 'visible', 'important');
    body.setAttribute('data-langform-post-expanded', 'true');
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  function begin(event) {
    if (!active() || !event.target.closest || !event.target.closest(posts)) { contact = null; return; }
    if (event.touches.length !== 1) { contact = null; blockedUntil = win.performance.now() + 700; return; }
    var point = event.touches[0]; contact = { id: point.identifier, x: point.clientX, y: point.clientY };
  }
  doc.addEventListener('touchstart', begin, { capture: true, passive: true });
  doc.addEventListener('touchmove', function (event) {
    if (!contact) return;
    var point = event.touches.length === 1 && event.touches[0];
    if (!point || point.identifier !== contact.id || Math.hypot(point.clientX - contact.x, point.clientY - contact.y) > 10) {
      contact = null; blockedUntil = win.performance.now() + 700;
    }
  }, { capture: true, passive: true });
  doc.addEventListener('touchend', function () { contact = null; }, { capture: true, passive: true });
  doc.addEventListener('touchcancel', function () { contact = null; blockedUntil = win.performance.now() + 700; }, { capture: true, passive: true });
  win.addEventListener('scroll', function () { if (contact) { contact = null; blockedUntil = win.performance.now() + 700; } }, { capture: true, passive: true });
  win.addEventListener('pagehide', function () { alive = false; contact = null; });
  win.addEventListener('pageshow', function () { alive = true; blockedUntil = 0; });
  ['yt-navigate-start', 'state-navigatestart'].forEach(function (name) { win.addEventListener(name, function () { contact = null; blockedUntil = win.performance.now() + 700; }); });
})(window);
