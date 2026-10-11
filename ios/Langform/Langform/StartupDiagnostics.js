// Registered only for an explicitly instrumented launch. Visible content is a
// rendering marker, not proof that a real user action has completed.
(function () {
  var bridge = window.webkit && window.webkit.messageHandlers.langformDiagnostics;
  if (!bridge) return;
  var remaining = { 'feed-shell-visible': true, 'feed-content-visible': true };
  var observer, timer, frame;
  function visible(selector) {
    var elements = document.querySelectorAll(selector);
    for (var i = 0; i < elements.length; i++) {
      var box = elements[i].getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0) return true;
    }
    return false;
  }
  function stop() {
    if (observer) observer.disconnect();
    clearTimeout(timer);
    cancelAnimationFrame(frame);
  }
  function check() {
    frame = null;
    if (document.hidden) return;
    var selectors = {
      'feed-shell-visible': 'ytm-mobile-topbar-renderer, ytm-pivot-bar-renderer, header',
      'feed-content-visible': 'ytm-rich-item-renderer a[href*="/watch?"], ytm-video-with-context-renderer a[href*="/watch?"], ytm-video-renderer a[href*="/watch?"]'
    };
    Object.keys(remaining).forEach(function (event) {
      if (!visible(selectors[event])) return;
      delete remaining[event];
      // Wait for the next render opportunity, rather than reporting insertion
      // of a DOM node that has not yet had an opportunity to paint.
      requestAnimationFrame(function () {
        bridge.postMessage({ event: event, documentMilliseconds: performance.now() });
      });
    });
    if (!Object.keys(remaining).length) stop();
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(check); }
  observer = new MutationObserver(schedule);
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  addEventListener('DOMContentLoaded', schedule);
  addEventListener('resize', schedule);
  addEventListener('pagehide', stop, { once: true });
  timer = setTimeout(stop, 30000);
  schedule();
})();
