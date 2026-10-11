(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (!root.ShortsAusblenden) root.ShortsAusblenden = {};
  root.ShortsAusblenden.hide = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var MARK = "data-shorts-ausblenden";
  var HIDDEN_CLASS = "shorts-ausblenden-hidden";
  var STYLE_ID = "shorts-ausblenden-style";
  var VEIL_ID = "shorts-ausblenden-veil";
  var VEIL_CLASS = "shorts-ausblenden-veil";

  var ITEM_TAGS = {
    "ytd-rich-item-renderer": 1,
    "ytd-video-renderer": 1,
    "ytd-grid-video-renderer": 1,
    "ytd-compact-video-renderer": 1,
    "ytd-compact-radio-renderer": 1,
    "ytd-reel-item-renderer": 1,
    "ytd-reel-video-renderer": 1,
    "ytd-rich-grid-media": 1,
    "ytd-rich-grid-slim-media": 1,
    "yt-lockup-view-model": 1,
    "ytd-guide-entry-renderer": 1,
    "ytd-mini-guide-entry-renderer": 1,
    "ytd-guide-collapsible-entry-renderer": 1,
    "yt-chip-cloud-chip-renderer": 1,
    "ytm-chip-cloud-chip-renderer": 1,
    "ytm-video-with-context-renderer": 1,
    "ytm-compact-video-renderer": 1,
    "ytm-rich-item-renderer": 1,
    "ytm-reel-item-renderer": 1,
    "ytm-shorts-lockup-view-model": 1,
    "ytm-shorts-lockup-view-model-v2": 1,
    "ytm-pivot-bar-item-renderer": 1,
  };

  var REEL_TAGS = {
    "ytd-reel-shelf-renderer": 1,
    "ytm-reel-shelf-renderer": 1,
    "ytd-reel-item-renderer": 1,
    "ytm-reel-item-renderer": 1,
    "ytd-reel-video-renderer": 1,
    "ytm-reel-video-renderer": 1,
  };

  var SECTION_TAGS = {
    "ytd-rich-section-renderer": 1,
    "ytm-rich-section-renderer": 1,
  };

  var STOP_TAGS = {
    HTML: 1,
    BODY: 1,
    HEAD: 1,
    "YTD-APP": 1,
    "YTM-APP": 1,
    "YTD-PAGE-MANAGER": 1,
  };

  function logic() {
    return globalThis.ShortsAusblenden.logic;
  }

  function tagNameOf(el) {
    return el && el.tagName ? el.tagName.toLowerCase() : "";
  }

  function parentAcross(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    var rootNode = typeof node.getRootNode === "function" ? node.getRootNode() : null;
    if (rootNode && rootNode.host) return rootNode.host;
    return null;
  }

  function isPlayerChrome(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    return tag === "VIDEO" || tag === "YTD-PLAYER" || tag === "YTM-PLAYER" || el.id === "movie_player";
  }

  function containsContinuation(el) {
    return !!(el && el.querySelector &&
      el.querySelector("ytm-continuation-item-renderer, ytd-continuation-item-renderer"));
  }

  function forEachElement(rootNode, visit) {
    var stack = [rootNode];
    var seen = new Set();
    while (stack.length) {
      var node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      if (node.nodeType === 1) visit(node);
      if (node.nodeType === 1 && isPlayerChrome(node)) continue;
      if (node.shadowRoot) stack.push(node.shadowRoot);
      var children = node.children;
      if (!children || !children.length) continue;
      for (var i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  }

  function hasShortsAttr(el) {
    if (!el || !el.getAttribute) return false;
    if (el.hasAttribute("is-shorts")) return true;
    var overlay = el.getAttribute("overlay-style");
    return !!overlay && String(overlay).toUpperCase() === "SHORTS";
  }

  function isSearchBox(el) {
    var tag = el && el.tagName;
    return tag === "YTM-SEARCHBOX" || tag === "YTD-SEARCHBOX" || tag === "YT-SEARCHBOX";
  }

  function isSearchForm(el) {
    if (!el || el.tagName !== "FORM") return false;
    if (el.getAttribute("role") === "search") return true;
    var action = String(el.getAttribute("action") || "").toLowerCase();
    if (action.indexOf("/results") !== -1 || action.indexOf("search") !== -1) return true;
    var inputs = el.getElementsByTagName ? el.getElementsByTagName("input") : [];
    for (var i = 0; i < inputs.length; i++) {
      var name = String(inputs[i].getAttribute("name") || "").toLowerCase();
      var type = String(inputs[i].getAttribute("type") || "").toLowerCase();
      if (name === "search_query" || name === "q" || type === "search") return true;
    }
    return false;
  }

  function ownedBySearch(el) {
    var node = el;
    var guard = 0;
    while (node && guard++ < 12) {
      if (node.nodeType === 1) {
        if (isSearchForm(node) || isSearchBox(node)) return true;
        if (node.getAttribute && node.getAttribute("role") === "search") return true;
      }
      node = parentAcross(node);
    }
    return false;
  }

  function isSearchControl(el) {
    if (!el || el.nodeType !== 1) return false;
    if (isSearchForm(el) || isSearchBox(el)) return true;
    if (el.getAttribute("role") === "search") return true;
    var tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      var type = String(el.getAttribute("type") || "").toLowerCase();
      var name = String(el.getAttribute("name") || "").toLowerCase();
      if (type === "search" || name === "search_query" || name === "q") return true;
    }
    if ((tag === "BUTTON" || tag === "YTM-BUTTON-RENDERER") && ownedBySearch(el)) return true;
    return false;
  }

  function isChapterUi(el) {
    var node = el;
    var guard = 0;
    while (node && guard++ < 12) {
      if (node.nodeType === 1) {
        var tag = tagNameOf(node);
        var id = node.id || "";
        if (
          tag.indexOf("macro-markers") !== -1 ||
          tag.indexOf("chapter") !== -1 ||
          id === "chapters" ||
          id === "chapter-list" ||
          id === "segments-container"
        ) {
          return true;
        }
      }
      node = parentAcross(node);
    }
    return false;
  }

  function isTimestampAnchor(el, base) {
    if (!el || el.tagName !== "A" || !el.hasAttribute("href")) return false;
    return logic().timestampSeconds(el.getAttribute("href"), base) != null;
  }

  function ignoredAnchor(el) {
    var node = el;
    var guard = 0;
    while (node && guard++ < 40) {
      if (node.nodeType === 1) {
        var id = node.id || "";
        var tag = tagNameOf(node);
        if (
          id === "description" ||
          id === "description-inline-expander" ||
          id === "comment" ||
          id === "comments" ||
          tag.indexOf("comment") !== -1
        ) {
          return true;
        }
      }
      node = parentAcross(node);
    }
    return false;
  }

  function outermostItem(el) {
    var found = null;
    var node = el;
    var guard = 0;
    while (node && guard++ < 50) {
      if (node.nodeType === 1) {
      if (STOP_TAGS[node.tagName]) break;
      if (isSearchForm(node) || isSearchBox(node) || node.getAttribute("role") === "search") break;
      if (isChapterUi(node) && node !== el) break;
      // Continuation lives beside content in some hydrated feed containers.
      // Remove the individual Shorts card/link, never its pagination owner.
      if (ITEM_TAGS[tagNameOf(node)] && !containsContinuation(node)) found = node;
      }
      node = parentAcross(node);
    }
    return found;
  }

  function countMedia(rootNode, base) {
    var shorts = 0;
    var watch = 0;
    forEachElement(rootNode, function (el) {
      if (el.tagName !== "A" || !el.hasAttribute("href")) return;
      var kind = logic().classifyHref(el.getAttribute("href"), base);
      if (kind === "shorts") shorts += 1;
      else if (kind === "watch") watch += 1;
    });
    return { shorts: shorts, watch: watch };
  }

  function shelfIsShorts(el, base) {
    var tag = tagNameOf(el);
    if (REEL_TAGS[tag]) return true;
    if (hasShortsAttr(el)) return true;
    if (tag.indexOf("shelf") === -1) return false;
    var counts = countMedia(el, base);
    return counts.shorts > 0 && counts.watch === 0;
  }

  function chipLabel(el) {
    var label = el.getAttribute("title") || el.getAttribute("aria-label") || "";
    label = String(label).replace(/\s+/g, " ").trim();
    if (!label && el.textContent) label = String(el.textContent).replace(/\s+/g, " ").trim();
    return label;
  }

  function isShortsChip(el) {
    var tag = tagNameOf(el);
    if (tag.indexOf("chip") === -1) return false;
    var label = chipLabel(el);
    return label === "Shorts" || label === "YouTube Shorts";
  }

  var removedCount = 0;

  function hideElement(el, doRemove, doomed) {
    if (!el || el.nodeType !== 1) return;
    if (el.tagName === "HTML" || el.tagName === "BODY" || el.tagName === "HEAD") return;
    if (isPlayerChrome(el) || isSearchControl(el) || isChapterUi(el)) return;
    if (containsContinuation(el)) {
      // A sentinel can arrive after an initially empty Shorts wrapper was
      // marked. Restore that wrapper before WebKit measures its intersection.
      if (el.getAttribute(MARK) === "1") {
        el.removeAttribute(MARK);
        if (el.classList) el.classList.remove(HIDDEN_CLASS);
        if (el.style) el.style.removeProperty("display");
      }
      return;
    }
    // YouTube can reuse an already-marked card for playback between scans.
    // Recheck before every removal, and undo our mark on the reused container.
    if (el.querySelector && el.querySelector("video, #movie_player, ytm-player, ytd-player")) {
      if (el.getAttribute(MARK) === "1") {
        el.removeAttribute(MARK);
        if (el.classList) el.classList.remove(HIDDEN_CLASS);
        if (el.style) el.style.removeProperty("display");
      }
      return;
    }
    if (el.getAttribute(MARK) !== "1") {
      // Taking a playing video out of the document pauses it.
      el.setAttribute(MARK, "1");
      if (el.classList) el.classList.add(HIDDEN_CLASS);
      if (el.style && el.style.setProperty) el.style.setProperty("display", "none", "important");
    }
    if (doRemove && doomed) doomed.push(el);
  }

  function isShortsTab(el) {
    var tag = tagNameOf(el);
    if (
      tag !== "ytm-pivot-bar-item-renderer" &&
      tag !== "ytd-guide-entry-renderer" &&
      tag !== "ytd-mini-guide-entry-renderer"
    ) {
      return false;
    }
    var label = el.getAttribute("aria-label") || el.getAttribute("title") || "";
    label = String(label).replace(/\s+/g, " ").trim();
    if (!label && el.textContent) label = String(el.textContent).replace(/\s+/g, " ").trim();
    return label === "Shorts" || label === "YouTube Shorts";
  }

  function hideWrappingSection(shelf, base, doRemove, doomed) {
    var node = parentAcross(shelf);
    var guard = 0;
    while (node && guard++ < 8) {
      if (node.nodeType === 1 && STOP_TAGS[node.tagName]) return;
      if (node.nodeType === 1 && SECTION_TAGS[tagNameOf(node)]) {
        var counts = countMedia(node, base);
        if (counts.watch === 0) hideElement(node, doRemove, doomed);
        return;
      }
      node = parentAcross(node);
    }
  }

  function scan(rootNode, base, options) {
    if (!rootNode || (rootNode.nodeType !== 1 && rootNode.nodeType !== 9 && rootNode.nodeType !== 11)) {
      return;
    }
    var doRemove = !options || options.remove !== false;
    var doomed = [];
    var pageBase = base || "https://www.youtube.com/";
    var anchors = [];
    var shelves = [];
    var chips = [];
    var marked = [];
    var tabs = [];
    forEachElement(rootNode, function (el) {
      var tag = tagNameOf(el);
      if (el.getAttribute(MARK) === "1" && containsContinuation(el)) hideElement(el, false);
      if (el.tagName === "A" && el.hasAttribute("href")) anchors.push(el);
      if (REEL_TAGS[tag] || tag.indexOf("shelf") !== -1) shelves.push(el);
      if (tag.indexOf("chip") !== -1) chips.push(el);
      if (hasShortsAttr(el)) marked.push(el);
      if (
        tag === "ytm-pivot-bar-item-renderer" ||
        tag === "ytd-guide-entry-renderer" ||
        tag === "ytd-mini-guide-entry-renderer"
      ) {
        tabs.push(el);
      }
    });

    for (var s = 0; s < shelves.length; s++) {
      if (!shelfIsShorts(shelves[s], pageBase)) continue;
      hideElement(shelves[s], doRemove, doomed);
      hideWrappingSection(shelves[s], pageBase, doRemove, doomed);
    }
    for (var m = 0; m < marked.length; m++) {
      if (isChapterUi(marked[m]) || ownedBySearch(marked[m])) continue;
      hideElement(outermostItem(marked[m]) || marked[m], doRemove, doomed);
    }
    for (var c = 0; c < chips.length; c++) {
      if (isChapterUi(chips[c])) continue;
      if (isShortsChip(chips[c])) hideElement(chips[c], doRemove, doomed);
    }
    for (var t = 0; t < tabs.length; t++) {
      if (isShortsTab(tabs[t])) hideElement(tabs[t], doRemove, doomed);
    }
    for (var a = 0; a < anchors.length; a++) {
      if (ignoredAnchor(anchors[a])) continue;
      if (isTimestampAnchor(anchors[a], pageBase) || isChapterUi(anchors[a])) continue;
      if (ownedBySearch(anchors[a])) continue;
      if (!logic().isShortsHref(anchors[a].getAttribute("href"), pageBase)) continue;
      hideElement(outermostItem(anchors[a]) || anchors[a], doRemove, doomed);
    }
    if (!doRemove) return 0;
    var removedNow = 0;
    for (var d = 0; d < doomed.length; d++) {
      var node = doomed[d];
      if (!node || !node.isConnected || !node.parentNode) continue;
      node.remove();
      removedNow += 1;
      removedCount += 1;
    }
    return removedNow;
  }

  function cssText() {
    var shared = globalThis.ShortsAusblenden && globalThis.ShortsAusblenden.buildCss;
    return shared ? shared() : "";
  }

  function ensureStyle(doc) {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = cssText();
    (doc.documentElement || doc.head || doc).appendChild(style);
  }

  function removeStyle(doc) {
    if (!doc) return;
    var style = doc.getElementById(STYLE_ID);
    if (style) style.remove();
  }

  function clearMarks(rootNode) {
    if (!rootNode) return;
    forEachElement(rootNode, function (el) {
      if (el.getAttribute(MARK) !== "1") return;
      el.removeAttribute(MARK);
      if (el.classList) el.classList.remove(HIDDEN_CLASS);
      if (el.style && el.style.removeProperty) el.style.removeProperty("display");
    });
  }

  function setVeil(doc, on) {
    if (!doc || !doc.documentElement) return;
    var existing = doc.getElementById(VEIL_ID);
    if (!on) {
      if (existing) existing.remove();
      doc.documentElement.classList.remove(VEIL_CLASS);
      return;
    }
    doc.documentElement.classList.add(VEIL_CLASS);
    if (existing) return;
    var style = doc.createElement("style");
    style.id = VEIL_ID;
    style.textContent = [
      "html." + VEIL_CLASS + " { background: #14120e !important; }",
      "html." + VEIL_CLASS + " body { visibility: hidden !important; }",
      "html." + VEIL_CLASS + "::before {",
      '  content: "Shorts sind blockiert. Weiter zur Startseite …";',
      "  visibility: visible;",
      "  display: block;",
      "  box-sizing: border-box;",
      "  min-height: 100vh;",
      "  padding: 28px 22px;",
      "  background: #14120e;",
      "  color: #f4efe6;",
      "  font: 16px/1.45 system-ui, sans-serif;",
      "}",
    ].join("\n");
    doc.documentElement.appendChild(style);
  }

  function applyEnabled(doc, enabled, base, remove) {
    if (!doc) return 0;
    if (enabled) {
      ensureStyle(doc);
      return scan(doc, base, { remove: remove !== false });
    }
    removeStyle(doc);
    clearMarks(doc);
    setVeil(doc, false);
    return 0;
  }

  function pullRemoved() {
    var count = removedCount;
    removedCount = 0;
    return count;
  }

  return {
    MARK: MARK,
    HIDDEN_CLASS: HIDDEN_CLASS,
    STYLE_ID: STYLE_ID,
    VEIL_CLASS: VEIL_CLASS,
    cssText: cssText,
    ensureStyle: ensureStyle,
    scan: scan,
    applyEnabled: applyEnabled,
    setVeil: setVeil,
    clearMarks: clearMarks,
    hideElement: hideElement,
    pullRemoved: pullRemoved,
    isSearchControl: isSearchControl,
    isChapterUi: isChapterUi,
  };
});
