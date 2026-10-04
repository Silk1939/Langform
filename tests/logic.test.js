const test = require("node:test");
const assert = require("node:assert/strict");
const { ns } = require("./helpers");
const logic = ns.logic;

test("erkennt Shorts-Pfade und lässt normale Seiten stehen", function () {
  assert.equal(logic.isShortsPath("/shorts"), true);
  assert.equal(logic.isShortsPath("/shorts/"), true);
  assert.equal(logic.isShortsPath("/shorts/abc"), true);
  assert.equal(logic.isShortsPath("/feed/shorts"), true);
  assert.equal(logic.isShortsPath("/feed/shorts/"), true);
  assert.equal(logic.isShortsPath("/watch"), false);
  assert.equal(logic.isShortsPath("/results"), false);
  assert.equal(logic.isShortsPath("/feed/subscriptions"), false);
  assert.equal(logic.isShortsPath("/@kanal/shorts"), false);
  assert.equal(logic.isShortsPath("/shorts-extra"), false);
  assert.equal(logic.isShortsPath("/shortcake"), false);
});

test("ordnet Links ein, auch absolut und mit Parametern", function () {
  const base = "https://www.youtube.com/feed/subscriptions";
  assert.equal(logic.classifyHref("/shorts/abc?feature=share", base), "shorts");
  assert.equal(logic.classifyHref("/shorts", base), "shorts");
  assert.equal(logic.classifyHref("/shorts/", base), "shorts");
  assert.equal(logic.classifyHref("/feed/shorts", base), "shorts");
  assert.equal(logic.classifyHref("https://m.youtube.com/shorts/reel9", base), "shorts");
  assert.equal(logic.classifyHref("https://www.youtube.com/shorts?si=1", base), "shorts");
  assert.equal(logic.classifyHref("/watch?v=abc", base), "watch");
  assert.equal(logic.classifyHref("https://example.com/shorts/fremd", base), "other");
  assert.equal(logic.classifyHref("/shorts-extra", base), "other");
  assert.equal(logic.isShortsHref("#", base), false);
});

test("Startseite hängt vom Host ab", function () {
  assert.equal(logic.homeUrl("m.youtube.com"), "https://m.youtube.com/");
  assert.equal(logic.homeUrl("www.youtube.com"), "https://www.youtube.com/");
  assert.equal(logic.homeUrl("youtube.com"), "https://www.youtube.com/");
});

test("Schalter ist standardmäßig an", function () {
  assert.equal(logic.enabledFromStorage(undefined), true);
  assert.equal(logic.enabledFromStorage({}), true);
  assert.equal(logic.enabledFromStorage({ enabled: true }), true);
  assert.equal(logic.enabledFromStorage({ enabled: false }), false);
});

test("früher Plan versteckt nur, wenn der Cache an ist", function () {
  assert.deepEqual(logic.initialPlan("1", "/shorts/abc"), { arm: true, veil: true });
  assert.deepEqual(logic.initialPlan("1", "/"), { arm: true, veil: false });
  assert.deepEqual(logic.initialPlan("0", "/shorts/abc"), { arm: false, veil: false });
  assert.deepEqual(logic.initialPlan(null, "/shorts/abc"), { arm: false, veil: true });
  assert.deepEqual(logic.initialPlan(null, "/feed/subscriptions"), { arm: false, veil: false });
  assert.deepEqual(logic.initialPlan(null, "/feed/shorts"), { arm: false, veil: true });
});

test("liest die Navigations-URL aus YouTube-Events", function () {
  assert.equal(logic.extractNavUrl({ url: "/shorts/a" }), "/shorts/a");
  assert.equal(
    logic.extractNavUrl({
      endpoint: { commandMetadata: { webCommandMetadata: { url: "/shorts/b" } } },
    }),
    "/shorts/b"
  );
  assert.equal(logic.extractNavUrl(null), null);
  assert.equal(logic.extractNavUrl({ endpoint: {} }), null);
});
