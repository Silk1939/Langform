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

  function forEachElement(rootNode, visit) {
    var stack = [rootNode];
    var seen = new Set();
    while (stack.length) {
      var node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      if (node.nodeType === 1) visit(node);
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
        if (ITEM_TAGS[tagNameOf(node)]) found = node;
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

  function hideElement(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.tagName === "HTML" || el.tagName === "BODY" || el.tagName === "HEAD") return;
    if (el.getAttribute(MARK) === "1") return;
    el.setAttribute(MARK, "1");
    if (el.classList) el.classList.add(HIDDEN_CLASS);
    if (el.style && el.style.setProperty) el.style.setProperty("display", "none", "important");
  }

  function hideWrappingSection(shelf, base) {
    var node = parentAcross(shelf);
    var guard = 0;
    while (node && guard++ < 8) {
      if (node.nodeType === 1 && STOP_TAGS[node.tagName]) return;
      if (node.nodeType === 1 && SECTION_TAGS[tagNameOf(node)]) {
        var counts = countMedia(node, base);
        if (counts.watch === 0) hideElement(node);
        return;
      }
      node = parentAcross(node);
    }
  }

  function scan(rootNode, base) {
    if (!rootNode || (rootNode.nodeType !== 1 && rootNode.nodeType !== 9 && rootNode.nodeType !== 11)) {
      return;
    }
    var pageBase = base || "https://www.youtube.com/";
    var anchors = [];
    var shelves = [];
    var chips = [];
    var marked = [];
    forEachElement(rootNode, function (el) {
      var tag = tagNameOf(el);
      if (el.tagName === "A" && el.hasAttribute("href")) anchors.push(el);
      if (REEL_TAGS[tag] || tag.indexOf("shelf") !== -1) shelves.push(el);
      if (tag.indexOf("chip") !== -1) chips.push(el);
      if (hasShortsAttr(el)) marked.push(el);
    });

    for (var s = 0; s < shelves.length; s++) {
      if (!shelfIsShorts(shelves[s], pageBase)) continue;
      hideElement(shelves[s]);
      hideWrappingSection(shelves[s], pageBase);
    }
    for (var m = 0; m < marked.length; m++) {
      hideElement(outermostItem(marked[m]) || marked[m]);
    }
    for (var c = 0; c < chips.length; c++) {
      if (isShortsChip(chips[c])) hideElement(chips[c]);
    }
    for (var a = 0; a < anchors.length; a++) {
      if (ignoredAnchor(anchors[a])) continue;
      if (!logic().isShortsHref(anchors[a].getAttribute("href"), pageBase)) continue;
      hideElement(outermostItem(anchors[a]) || anchors[a]);
    }
  }

  function anchorSelectors() {
    return [
      'a[href="/shorts"]',
      'a[href="/shorts/"]',
      'a[href^="/shorts/"]',
      'a[href^="/shorts?"]',
      'a[href="/feed/shorts"]',
      'a[href^="/feed/shorts?"]',
      'a[href^="https://www.youtube.com/shorts/"]',
      'a[href="https://www.youtube.com/shorts"]',
      'a[href^="https://www.youtube.com/shorts?"]',
      'a[href^="https://m.youtube.com/shorts/"]',
      'a[href="https://m.youtube.com/shorts"]',
      'a[href^="https://m.youtube.com/shorts?"]',
      'a[href^="https://youtube.com/shorts/"]',
      'a[href="https://youtube.com/shorts"]',
      'a[href^="https://youtube.com/shorts?"]',
      'a[href^="https://www.youtube.com/feed/shorts"]',
      'a[href^="https://m.youtube.com/feed/shorts"]',
    ];
  }

  function cssText() {
    var anchors = anchorSelectors().join(", ");
    var items = Object.keys(ITEM_TAGS).map(function (tag) {
      return tag + ":has(" + anchors + ")";
    });
    var always = [
      "ytd-reel-shelf-renderer",
      "ytm-reel-shelf-renderer",
      "ytd-reel-item-renderer",
      "ytm-reel-item-renderer",
      "ytd-reel-video-renderer",
      "ytm-reel-video-renderer",
      "ytd-rich-shelf-renderer[is-shorts]",
      "ytm-rich-shelf-renderer[is-shorts]",
      "ytd-rich-section-renderer:has(ytd-reel-shelf-renderer)",
      "ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])",
      "ytm-rich-section-renderer:has(ytm-reel-shelf-renderer)",
      "ytm-rich-section-renderer:has(ytm-rich-shelf-renderer[is-shorts])",
      "[overlay-style=\"SHORTS\"]",
      "." + HIDDEN_CLASS,
    ];
    return always.concat(items).join(",\n") + " {\n  display: none !important;\n}\n";
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

  function applyEnabled(doc, enabled, base) {
    if (!doc) return;
    if (enabled) {
      ensureStyle(doc);
      scan(doc, base);
      return;
    }
    removeStyle(doc);
    clearMarks(doc);
    setVeil(doc, false);
  }

  return {
    MARK: MARK,
    HIDDEN_CLASS: HIDDEN_CLASS,
    STYLE_ID: STYLE_ID,
    VEIL_CLASS: VEIL_CLASS,
    cssText: cssText,
    scan: scan,
    applyEnabled: applyEnabled,
    setVeil: setVeil,
    clearMarks: clearMarks,
    hideElement: hideElement,
  };
});
