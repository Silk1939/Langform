(function (root) {
  if (!root.ShortsAusblenden) root.ShortsAusblenden = {};
  var ns = root.ShortsAusblenden;
  var STYLE_ID = "shorts-ausblenden-style";
  var FLAG = "shorts-ausblenden-enabled";

  var ITEM_TAGS = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-compact-radio-renderer",
    "ytd-reel-item-renderer",
    "ytd-reel-video-renderer",
    "ytd-rich-grid-media",
    "ytd-rich-grid-slim-media",
    "yt-lockup-view-model",
    "ytd-guide-entry-renderer",
    "ytd-mini-guide-entry-renderer",
    "ytd-guide-collapsible-entry-renderer",
    "yt-chip-cloud-chip-renderer",
    "ytm-chip-cloud-chip-renderer",
    "ytm-video-with-context-renderer",
    "ytm-compact-video-renderer",
    "ytm-rich-item-renderer",
    "ytm-reel-item-renderer",
    "ytm-shorts-lockup-view-model",
    "ytm-shorts-lockup-view-model-v2",
    "ytm-pivot-bar-item-renderer",
  ];

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

  function safeAnchors() {
    return anchorSelectors().map(function (sel) {
      return (
        sel +
        ":not(#description a):not(#description-inline-expander a):not(#comments a):not(#comment a):not(ytd-comments a):not(ytd-comment-thread-renderer a):not(ytd-comment-renderer a):not(ytd-comment-view-model a):not(ytm-comment-renderer a)"
      );
    });
  }

  var CHAPTER_GUARD =
    ":not(ytd-macro-markers-list-renderer *)" +
    ":not(ytm-macro-markers-list-renderer *)" +
    ":not(ytd-macro-markers-list-item-renderer *)" +
    ":not(ytm-macro-markers-list-item-renderer *)" +
    ":not(ytd-chapter-renderer *)" +
    ":not(ytm-chapter-renderer *)" +
    ":not(.ytwPlayerTimeDisplayPlayerBarActionContainer)" +
    ":not(.ytwPlayerTimeDisplayPlayerBarActionContainer *)" +
    ":not(.engagement-panel-macro-markers-description-chapters)" +
    ":not(.engagement-panel-macro-markers-description-chapters *)";

  var SEARCH_GUARD =
    ':not(:has(form[role="search"]))' +
    ':not(:has(input[name="search_query"]))' +
    ':not(:has(input[type="search"]))';

  // Only the bar, guide and chip containers can hold YouTube's search box.
  // Feed cards skip the extra :has() tests, which WebKit re-evaluates on every
  // mutation while the feed streams in.
  function mayHoldSearch(tag) {
    return tag.indexOf("pivot") !== -1 || tag.indexOf("guide") !== -1 || tag.indexOf("chip") !== -1;
  }

  function buildCss() {
    var anchors = safeAnchors().join(", ");
    var items = ITEM_TAGS.map(function (tag) {
      return tag + ":has(" + anchors + ")" + (mayHoldSearch(tag) ? SEARCH_GUARD : "") + CHAPTER_GUARD;
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
      '[overlay-style="SHORTS"]',
      'yt-chip-cloud-chip-renderer[title="Shorts"]' + CHAPTER_GUARD,
      'yt-chip-cloud-chip-renderer[title="YouTube Shorts"]' + CHAPTER_GUARD,
      'ytm-chip-cloud-chip-renderer[title="Shorts"]' + CHAPTER_GUARD,
      'ytm-chip-cloud-chip-renderer[title="YouTube Shorts"]' + CHAPTER_GUARD,
      'ytm-pivot-bar-item-renderer[aria-label="Shorts"]' + SEARCH_GUARD,
      'ytm-pivot-bar-item-renderer[aria-label="YouTube Shorts"]' + SEARCH_GUARD,
      'ytm-pivot-bar-item-renderer:has([aria-label="Shorts"])' + SEARCH_GUARD,
      'ytm-pivot-bar-item-renderer:has([aria-label="YouTube Shorts"])' + SEARCH_GUARD,
      ".shorts-ausblenden-hidden",
    ];
    return always.concat(items).join(",\n") + " {\n  display: none !important;\n}\n";
  }

  function install(doc) {
    if (!doc || !doc.documentElement || doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = buildCss();
    doc.documentElement.appendChild(style);
  }

  ns.buildCss = buildCss;
  ns.css = buildCss();

  var flag = null;
  try {
    if (root.localStorage) flag = root.localStorage.getItem(FLAG);
  } catch (err) {
    /* storage blocked */
  }
  if (flag !== "0") install(root.document);
})(typeof globalThis !== "undefined" ? globalThis : this);
