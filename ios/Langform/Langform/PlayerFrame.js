(function () {
  var VIEWPORT =
    "width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover";
  var STYLE_ID = "langform-player-frame";

  function viewport(doc) {
    if (!doc || !doc.documentElement) return;
    var meta = doc.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = doc.createElement("meta");
      meta.setAttribute("name", "viewport");
      (doc.head || doc.documentElement).appendChild(meta);
    }
    if (meta.getAttribute("content") !== VIEWPORT) meta.setAttribute("content", VIEWPORT);
  }

  function frame(doc) {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".player-container {",
      "  left: 0 !important;",
      "  right: 0 !important;",
      "  width: 100% !important;",
      "  max-width: 100% !important;",
      "  margin-left: 0 !important;",
      "  margin-right: 0 !important;",
      "}",
      ".player-container .player-size,",
      "ytm-watch .player-size {",
      "  position: relative !important;",
      "  width: 100% !important;",
      "  max-width: 100% !important;",
      "  height: 0 !important;",
      "  padding-bottom: 56.25% !important;",
      "  margin: 0 !important;",
      "  left: 0 !important;",
      "}",
      ".player-container .html5-video-player,",
      "#movie_player {",
      "  position: absolute !important;",
      "  top: 0 !important;",
      "  left: 0 !important;",
      "  right: 0 !important;",
      "  bottom: 0 !important;",
      "  width: 100% !important;",
      "  height: 100% !important;",
      "  max-width: none !important;",
      "  margin: 0 !important;",
      "}",
      ".player-container video,",
      "#movie_player video {",
      "  position: absolute !important;",
      "  top: 0 !important;",
      "  left: 0 !important;",
      "  width: 100% !important;",
      "  height: 100% !important;",
      "  max-width: none !important;",
      "  margin: 0 !important;",
      "  object-fit: contain !important;",
      "}",
    ].join("\n");
    (doc.documentElement || doc.head).appendChild(style);
  }

  function apply(doc) {
    viewport(doc);
    frame(doc);
  }

  apply(document);
  document.addEventListener("DOMContentLoaded", function () {
    apply(document);
  });
})();
