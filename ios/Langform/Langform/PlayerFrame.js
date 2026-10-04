(function () {
  // Viewport only. YouTube keeps its own player layout.
  var VIEWPORT =
    "width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover";

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

  viewport(document);
  document.addEventListener("DOMContentLoaded", function () {
    viewport(document);
  });
})();
