const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Real UIKit/WK mini keeps stage-owned insets through drag and decoded pause/play", {
  skip: process.platform !== "darwin", timeout: 90000,
}, t => {
  const sdk = spawnSync("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" });
  if (sdk.status !== 0) return t.skip("Mac Catalyst SDK is unavailable");
  const root = path.resolve(__dirname, "..");
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "langform-stage-insets-test-"));
  const run = baseline => {
    const destination = path.join(output, baseline ? "baseline" : "current");
    const args = ["scripts/diagnostics/mini-stage-insets-native-fixture.py", "--output", destination];
    if (baseline) args.push("--baseline-env");
    const result = spawnSync("python3", args, { cwd: root, encoding: "utf8", timeout: 40000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const rows = fs.readFileSync(path.join(destination, "native.jsonl"), "utf8")
      .trim().split("\n").map(JSON.parse);
    assert.equal(rows.at(-1).finished, true);
    assert.equal(rows.at(-1).passed, true);
    return rows;
  };
  try {
    // This is a real Catalyst UIKit/WKWebView surface, with an explicit 62pt
    // fixture inset. DOM readyState/pause/play are real media observations;
    // hardware media pixels need a compositor screenshot, not drawHierarchy.
    const baseline = run(true);
    const current = run(false);
    const live = rows => rows.filter(row => row.event === "live-stage-insets");
    const before = live(baseline), after = live(current);
    const phases = ["expanded", "drag-0.3", "drag-0.7", "mini-playing", "mini-paused",
      "mini-resumed", "expanded-restored", "reload-bootstrap"];
    assert.deepEqual(before.map(row => row.phase), phases);
    assert.deepEqual(after.map(row => row.phase), phases);
    assert.equal(before[0].stageTop, 62);
    // Catalyst can expose 0 for CSS env even while UIKit reports the explicit
    // 62pt fixture inset (observed on macOS 27.0.1). Keep the historical 62pt
    // baseline where available and check the actual env-to-layout relationship.
    // The shipping/native path below must still produce 62px and y110 in every
    // phase, regardless of the baseline WebKit environment.
    assert.ok([0, 62].includes(before[0].dom.envTop));
    assert.equal(before[0].dom.y, 48 + before[0].dom.envTop);
    for (const row of before.slice(1, 6)) {
      assert.equal(row.stageTop, 62, row.phase);
      assert.equal(row.wkTop, 0, row.phase);
      assert.equal(row.dom.envTop, 0, row.phase);
      assert.equal(row.dom.y, 48, row.phase + " reproduces WebKit env losing the stage inset");
    }
    for (const row of after) {
      assert.equal(row.stageTop, 62, row.phase);
      assert.equal(row.wkWidth, 390, row.phase);
      assert.equal(row.wkHeight, 844, row.phase);
      assert.equal(row.dom.innerW, 390, row.phase);
      assert.equal(row.dom.innerH, 844, row.phase);
      assert.equal(row.dom.nativeTop, "62px", row.phase);
      assert.equal(row.dom.y, 110, row.phase);
      assert.equal(row.dom.videoVisibility, "visible", row.phase);
      assert.ok(row.dom.ready >= 2, row.phase);
      const mini = row.phase.startsWith("drag-") || row.phase.startsWith("mini-");
      assert.equal(row.dom.nativeMini, mini, row.phase);
      assert.equal(row.dom.controlVisibility, mini ? "hidden" : "visible", row.phase);
    }
    const paused = after.find(row => row.phase === "mini-paused");
    const resumed = after.find(row => row.phase === "mini-resumed");
    assert.equal(paused.dom.paused, true);
    assert.equal(resumed.dom.paused, false);
    assert.ok(Math.abs(resumed.dom.time - paused.dom.time) > 0.001,
      "decoded media advances after resume, including an actual loop wrap");
    assert.ok(current.some(row => row.check === "mode changes retain exactly one native bootstrap and the base script" && row.passed));
    assert.equal(current.at(-1).checks, 30);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
