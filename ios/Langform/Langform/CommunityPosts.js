// Post text expands where it was tapped. Image attachments open in a small
// accessible viewer; only explicit links/comments navigate to the post page.
(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformCommunityPosts || win.location.hostname !== 'm.youtube.com') return;
  var handlers = win.webkit && win.webkit.messageHandlers;
  if (!handlers || !(handlers.langformOpenWatch || handlers.langformPlayer)) return;
  win.__langformCommunityPosts = true;
  var doc = win.document, alive = true, replay = null, contact = null, blockedUntil = 0, viewer = null;
  var posts = 'ytm-backstage-post-renderer, ytm-post-renderer, ytd-backstage-post-renderer, yt-post-renderer, yt-shared-post-renderer';
  var text = '.post-text, .post-content-text, #content-text, .ytPostRendererTextContent, .ytSharedPostRendererTextContent, ytm-text-expander';
  var controls = 'a, button, input, textarea, select, [contenteditable], [role="button"], [role="link"], [role="radio"], [role="checkbox"], ytm-backstage-poll-renderer, ytm-poll-renderer, ytm-menu-renderer, ytm-subscribe-button-renderer, ytm-video-renderer, ytm-video-with-context-renderer, video';
  var attachments = 'ytm-backstage-image-renderer, ytm-post-image-renderer, ytm-post-multi-image-renderer, yt-post-image-view-model, yt-post-multi-image-view-model, .post-image, .post-multi-image, .backstage-image, .ytPostImageViewModelHost, .ytPostMultiImageViewModelHost';
  var excludedImages = 'ytm-channel-thumbnail-with-link-renderer, .post-author-thumbnail, .author-thumbnail, .channel-thumbnail-icon, .yt-spec-avatar-shape, ytm-backstage-poll-renderer, ytm-poll-renderer, ytm-video-renderer, ytm-video-with-context-renderer';
  function active() {
    if (!alive || win.__langformFeedActive === false) return false;
    try { var visibility = win.__langformRealVisibility; if (visibility && typeof visibility.inactive === 'function') return !visibility.inactive(); } catch (_) {}
    return !doc.hidden;
  }
  function usable(node) {
    if (!node || !node.isConnected || node.hidden || node.disabled || node.getAttribute('aria-hidden') === 'true' || node.getAttribute('aria-disabled') === 'true') return false;
    for (var parent = node; parent; parent = parent.parentElement) {
      if (parent.hidden || parent.getAttribute('aria-hidden') === 'true') return false;
      var style = win.getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
  }
  function expander(card) {
    var list = card.querySelectorAll('ytm-text-expander .text-expander-button, .post-text .text-expander-button, .post-content-text .text-expander-button, .ytPostRendererReadMore, .ytSharedPostRendererReadMore, button[aria-expanded="false"]');
    for (var i = 0; i < list.length; i++) {
      var node = list[i];
      if (node.closest(posts) !== card || !usable(node) || node.getAttribute('aria-expanded') === 'true') continue;
      if (node.matches('button[aria-expanded="false"]') && !node.closest('ytm-text-expander, .post-text, .post-content-text') && !/^(?:mehr\s*(?:lesen|anzeigen)|read more|show more)(?:\s|$)/i.test(node.textContent.trim())) continue;
      return node;
    }
    return null;
  }
  function postLink(node) {
    if (!node) return false;
    try {
      var url = new win.URL(node.getAttribute('href'), win.location.href);
      return url.protocol === 'https:' && /^(?:m\.|www\.)?youtube\.com$/.test(url.hostname) && /^\/post\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) && !url.username && !url.password && !url.port;
    } catch (_) { return false; }
  }
  function imageSource(image, card) {
    if (!image || image.tagName !== 'IMG' || image.closest(posts) !== card || image.closest(excludedImages)) return null;
    var anchor = image.closest('a[href]');
    if (anchor && !postLink(anchor)) return null;
    // Prefer explicit image renderers. A large, unlinked post attachment is a
    // fallback for mobile variants; a creator avatar must never become a slide.
    if (!image.closest(attachments)) {
      var rect = image.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 80) return null;
    }
    try {
      var url = new win.URL(image.currentSrc || image.getAttribute('src') || image.getAttribute('data-src'), win.location.href);
      if (url.protocol !== 'https:' || url.username || url.password || url.port ||
          !/(?:^|\.)(?:ggpht\.com|googleusercontent\.com)$/.test(url.hostname)) return null;
      return url.href;
    } catch (_) { return null; }
  }
  function annotateImages(root) {
    if (!active() || !root || !root.querySelectorAll) return;
    var images = root.tagName === 'IMG' ? [root] : Array.prototype.slice.call(root.querySelectorAll('img'));
    images.forEach(function (image) {
      var card = image.closest(posts);
      if (!card || !imageSource(image, card)) return;
      var anchor = image.closest('a[href]');
      // A pure image anchor gets button semantics because its tap opens the
      // viewer. Mixed text links keep their existing accessible link meaning.
      var control = anchor && !anchor.textContent.trim() ? anchor : image;
      if (control !== anchor && image.closest('a, button, [role="button"], [role="link"]')) return;
      if (control.hasAttribute('data-langform-post-image')) return;
      control.setAttribute('data-langform-post-image', 'true');
      control.setAttribute('role', 'button'); control.tabIndex = 0;
      control.setAttribute('aria-label', (image.getAttribute('alt') ? image.getAttribute('alt') + '. ' : '') + 'Beitragsbild vergrößern');
    });
  }
  var imageObserver = new win.MutationObserver(function (records) {
    if (!active()) return;
    records.forEach(function (record) {
      if (record.type === 'attributes') annotateImages(record.target);
      else Array.prototype.forEach.call(record.addedNodes, annotateImages);
    });
  });
  function observeImages() {
    annotateImages(doc);
    imageObserver.observe(doc, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-src', 'srcset'] });
  }
  function stop(event) { event.preventDefault(); event.stopImmediatePropagation(); return true; }
  function overlay(open) {
    if (typeof win.__langformSetOverlayState === 'function') win.__langformSetOverlayState('community-images', open);
  }
  function closeViewer(restoreFocus) {
    if (!viewer) return;
    var previous = viewer;
    viewer = null;
    previous.node.remove();
    if (previous.overflow) doc.body.style.setProperty('overflow', previous.overflow, previous.priority);
    else doc.body.style.removeProperty('overflow');
    overlay(false);
    if (restoreFocus !== false && previous.focus && previous.focus.isConnected && typeof previous.focus.focus === 'function') previous.focus.focus({ preventScroll: true });
  }
  function button(label, action) {
    var node = doc.createElement('button');
    node.type = 'button'; node.textContent = label; node.setAttribute('aria-label', label);
    node.style.cssText = 'min-width:48px;min-height:48px;border:0;border-radius:12px;background:#252525;color:white;font:600 17px -apple-system,system-ui;padding:8px 14px;touch-action:manipulation';
    node.addEventListener('click', function (event) { stop(event); action(); });
    return node;
  }
  function selectImage(index) {
    if (!viewer) return;
    viewer.index = Math.max(0, Math.min(viewer.images.length - 1, index));
    var slide = viewer.images[viewer.index];
    viewer.image.src = slide.src;
    viewer.image.alt = slide.alt || 'Beitragsbild';
    viewer.counter.textContent = 'Bild ' + (viewer.index + 1) + ' von ' + viewer.images.length;
    viewer.previous.disabled = viewer.index === 0;
    viewer.next.disabled = viewer.index === viewer.images.length - 1;
    viewer.previous.style.opacity = viewer.previous.disabled ? '.35' : '1';
    viewer.next.style.opacity = viewer.next.disabled ? '.35' : '1';
  }
  function openViewer(image, card) {
    var src = imageSource(image, card);
    if (!src || !usable(image)) return false;
    var images = [], index = 0;
    Array.prototype.forEach.call(card.querySelectorAll('img'), function (candidate) {
      var source = imageSource(candidate, card);
      if (!source || images.length >= 20) return;
      var known = images.findIndex(function (item) { return item.src === source; });
      if (candidate === image) index = known >= 0 ? known : images.length;
      if (known < 0) images.push({ src: source, alt: candidate.getAttribute('alt') || '' });
    });
    if (!images.length) return false;
    var selected = images.findIndex(function (item) { return item.src === src; });
    if (selected < 0) {
      // A pathological card can contain many retained carousel clones. Keep
      // the bounded viewer anchored to the image the person actually tapped.
      images[images.length - 1] = { src: src, alt: image.getAttribute('alt') || '' };
      index = images.length - 1;
    } else index = selected;
    closeViewer(false);
    var root = doc.createElement('div'); root.id = 'langform-community-images';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Beitragsbilder');
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;background:rgba(0,0,0,.97);color:white;box-sizing:border-box;padding:var(--lf-native-safe-top,env(safe-area-inset-top)) var(--lf-native-safe-right,env(safe-area-inset-right)) var(--lf-native-safe-bottom,env(safe-area-inset-bottom)) var(--lf-native-safe-left,env(safe-area-inset-left));overscroll-behavior:contain';
    var header = doc.createElement('div'); header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;flex-shrink:0';
    var counter = doc.createElement('span'); counter.setAttribute('role', 'status'); counter.setAttribute('aria-live', 'polite'); counter.style.cssText = 'font:500 16px -apple-system,system-ui';
    var close = button('Schließen', function () { closeViewer(); }); close.setAttribute('aria-label', 'Beitragsbilder schließen');
    header.appendChild(counter); header.appendChild(close);
    var area = doc.createElement('div'); area.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:0;flex:1;overflow:hidden';
    var display = doc.createElement('img'); display.draggable = false; display.style.cssText = 'width:100%;height:100%;min-height:0;object-fit:contain;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none';
    area.appendChild(display);
    var footer = doc.createElement('div'); footer.style.cssText = 'display:flex;justify-content:center;gap:24px;padding:8px 12px;flex-shrink:0';
    var previous = button('Zurück', function () { selectImage(viewer.index - 1); });
    var next = button('Weiter', function () { selectImage(viewer.index + 1); });
    footer.appendChild(previous); footer.appendChild(next); footer.hidden = images.length === 1;
    if (footer.hidden) footer.style.setProperty('display', 'none', 'important');
    root.appendChild(header); root.appendChild(area); root.appendChild(footer);
    viewer = { node: root, image: display, counter: counter, previous: previous, next: next, images: images, index: index, focus: doc.activeElement, overflow: doc.body.style.getPropertyValue('overflow'), priority: doc.body.style.getPropertyPriority('overflow') };
    doc.body.style.setProperty('overflow', 'hidden', 'important');
    doc.body.appendChild(root); selectImage(index); overlay(true); close.focus({ preventScroll: true });
    var swipe = null;
    area.addEventListener('touchstart', function (event) { swipe = event.touches.length === 1 ? { id: event.touches[0].identifier, x: event.touches[0].clientX, y: event.touches[0].clientY } : null; }, { passive: true });
    area.addEventListener('touchmove', function (event) { if (event.touches.length !== 1) swipe = null; }, { passive: true });
    area.addEventListener('touchcancel', function () { swipe = null; }, { passive: true });
    area.addEventListener('touchend', function (event) {
      var point = event.changedTouches[0], origin = swipe; swipe = null;
      if (!viewer || !origin || !point || point.identifier !== origin.id) return;
      var dx = point.clientX - origin.x, dy = point.clientY - origin.y;
      if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.5) selectImage(viewer.index + (dx < 0 ? 1 : -1));
    }, { passive: true });
    return true;
  }
  function handleClick(event) {
    if (replay || !active() || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    var target = event.target && (event.target.nodeType === 1 ? event.target : event.target.parentElement);
    if (!target || !target.closest) return false;
    if (viewer) {
      // Let the viewer's own controls receive their click. Background clicks
      // cannot leak into a retained feed or a player gesture behind the dialog.
      if (viewer.node.contains(target)) return false;
      return stop(event);
    }
    if (target.closest('bottom-sheet-container, ytm-engagement-panel, #dialog-container, #langform-discovery-sheet')) return false;
    var card = target.closest(posts);
    if (!card || !usable(card)) return false;
    var imageControl = target.closest('[data-langform-post-image]');
    var image = target.closest('img') || (imageControl && imageControl.querySelector('img'));
    if (image && imageSource(image, card)) {
      if (win.performance.now() < blockedUntil) return stop(event);
      if (openViewer(image, card)) return stop(event);
    }
    if (target.closest(controls)) return false;
    // Never turn card whitespace, a full text, or an unknown image into an
    // implicit /post/ navigation. Comments and explicit links keep their action.
    var body = target.closest(text);
    if (!body || body.closest(posts) !== card || win.performance.now() < blockedUntil) return stop(event);
    var action = expander(card);
    if (action && action !== target && !action.contains(target)) {
      stop(event); replay = action;
      try { action.click(); } finally { replay = null; }
      return true;
    }
    if (body.matches('ytm-text-expander') || body.getAttribute('data-langform-post-expanded') === 'true') return stop(event);
    var style = win.getComputedStyle(body), clamp = parseInt(style.webkitLineClamp || style.getPropertyValue('-webkit-line-clamp'), 10);
    if (!(clamp > 0 || ((style.overflow === 'hidden' || style.overflowY === 'hidden') && style.maxHeight && style.maxHeight !== 'none'))) return stop(event);
    body.style.setProperty('-webkit-line-clamp', 'unset', 'important');
    body.style.setProperty('max-height', 'none', 'important');
    body.style.setProperty('overflow', 'visible', 'important');
    body.setAttribute('data-langform-post-expanded', 'true');
    return stop(event);
  }
  win.__langformHandleCommunityClick = handleClick;
  win.addEventListener('click', handleClick, true);
  win.addEventListener('keydown', function (event) {
    if (!viewer) {
      var target = event.target && event.target.closest && event.target.closest('[data-langform-post-image]');
      if (active() && target && !event.repeat && (event.key === 'Enter' || event.key === ' ')) {
        var image = target.tagName === 'IMG' ? target : target.querySelector('img');
        if (image && openViewer(image, image.closest(posts))) stop(event);
      }
      return;
    }
    if (event.key === 'Escape') { stop(event); closeViewer(); }
    else if (event.key === 'ArrowLeft') { stop(event); selectImage(viewer.index - 1); }
    else if (event.key === 'ArrowRight') { stop(event); selectImage(viewer.index + 1); }
    else if (event.key === 'Tab') {
      var buttons = Array.prototype.filter.call(viewer.node.querySelectorAll('button'), function (node) { return !node.disabled && !node.closest('[hidden]'); });
      var index = buttons.indexOf(doc.activeElement), next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      stop(event); buttons[next].focus();
    }
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
  win.addEventListener('pagehide', function () { alive = false; contact = null; imageObserver.disconnect(); closeViewer(false); });
  win.addEventListener('pageshow', function () { alive = true; blockedUntil = 0; observeImages(); });
  win.addEventListener('langform-feed-visibility', function () { if (!active()) closeViewer(false); else annotateImages(doc); });
  ['visibilitychange', 'langform-real-visibilitychange'].forEach(function (name) { doc.addEventListener(name, function () { if (!active()) closeViewer(false); }); });
  ['yt-navigate-start', 'state-navigatestart'].forEach(function (name) { win.addEventListener(name, function () { contact = null; blockedUntil = win.performance.now() + 700; closeViewer(false); }); });
  observeImages();
})(window);
