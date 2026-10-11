const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Native Gesten erlauben diagonales Verkleinern, Mini-Hochziehen und Übergabe nach Federende", {
  skip: process.platform !== "darwin",
  timeout: 70000,
}, function (t) {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Der Gestentest benötigt die Swift-Toolchain.");
  // Execute the exact Foundation-only production policy. No UIKit, simulator,
  // mirrored implementation or user-device interaction is involved.
  const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/PlayerGesturePolicy.swift"), "utf8");
  const exercise = `
func expect(_ condition: Bool, _ message: String) {
    if !condition { print("FAILED: " + message); exit(1) }
}
func begins(_ position: PlayerGesturePolicy.Position, _ x: CGFloat, _ y: CGFloat,
            vx: CGFloat = 0, vy: CGFloat = 0, moving: Bool = false, grabbed: Bool = false) -> Bool {
    PlayerGesturePolicy.canBegin(position: position, isTransitioning: moving,
                                 touchBeganWhileTransitioning: grabbed,
                                 translation: CGPoint(x: x, y: y), velocity: CGPoint(x: vx, y: vy))
}
expect(PlayerGesturePolicy.allowsDrag(position: .expanded, overlayOpen: false), "expanded video without sheet accepts a drag")
expect(!PlayerGesturePolicy.allowsDrag(position: .expanded, overlayOpen: true), "expanded sheet keeps its own gestures")
expect(PlayerGesturePolicy.allowsDrag(position: .mini, overlayOpen: true), "hidden sheet cannot block native mini-up drag")
expect(PlayerGesturePolicy.allowsDrag(position: .mini, overlayOpen: false), "ordinary mini keeps upward drag")
expect(!PlayerGesturePolicy.allowsDrag(position: nil, overlayOpen: false), "closed/loading players cannot drag")
expect(!PlayerGesturePolicy.allowsDrag(position: nil, overlayOpen: true), "stale sheet cannot make closed/loading players draggable")

expect(begins(.expanded, 10, 15), "natural diagonal downward start must minimize")
expect(begins(.expanded, 0, 4), "UIKit already crossed its own threshold; no second distance gate")
expect(!begins(.expanded, 15, 10), "mostly horizontal scrub belongs to YouTube")
expect(!begins(.expanded, 0, -20), "expanded upward scrolling must not minimize")
expect(!begins(.expanded, 0, 0), "stationary touch is not a drag")
expect(begins(.expanded, 10, 5, vx: 30, vy: 500), "downward flick may disambiguate diagonal translation")
expect(!begins(.expanded, 10, -5, vx: 30, vy: 500), "flick cannot override opposite travel")

expect(begins(.mini, 5, -20), "resting mini can expand by upward drag")
expect(!begins(.mini, 0, 20), "resting mini does not accept downward drag")
expect(!begins(.mini, 25, -10), "resting mini ignores horizontal motion")
expect(begins(.mini, 10, -5, vx: 20, vy: -500), "upward mini flick expands")

expect(begins(.mini, 0, 20, moving: true), "running spring can be redirected downward")
expect(begins(.expanded, 0, -20, moving: true), "running spring can be redirected upward")
expect(begins(.mini, 0, 20, grabbed: true), "touch began during collapse; spring ended before pan threshold")
expect(begins(.expanded, 0, -20, grabbed: true), "touch began during expansion; spring ended before pan threshold")
expect(!begins(.mini, 20, 0, moving: true, grabbed: true), "transition grab still cannot steal a horizontal scrub")
expect(!begins(.mini, 0, 20), "next touch cannot reuse the previous transition latch")

expect(PlayerGesturePolicy.scrubberInset(position: .expanded, isTransitioning: false) == 44,
       "expanded scrubber keeps its touch area")
expect(PlayerGesturePolicy.scrubberInset(position: .mini, isTransitioning: false) == 0,
       "mini has no interactive WebKit scrubber")
expect(PlayerGesturePolicy.scrubberInset(position: .expanded, isTransitioning: true) == 0,
       "moving picture can be grabbed across its full height")

expect(PlayerGesturePolicy.finishesMini(ended: true, progress: 0.8, velocity: 0), "downward completion minimizes")
expect(!PlayerGesturePolicy.finishesMini(ended: true, progress: 0.2, velocity: 0), "long mini-up drag expands")
expect(!PlayerGesturePolicy.finishesMini(ended: true, progress: 0.9, velocity: -700), "upward mini flick expands even near its origin")
expect(PlayerGesturePolicy.finishesMini(ended: true, progress: 0.1, velocity: 700), "downward flick minimizes")
expect(!PlayerGesturePolicy.finishesMini(ended: false, progress: 0.9, velocity: 700), "cancelled edge drag cannot commit navigation")
expect(PlayerGesturePolicy.finishesMini(ended: false, progress: 0.2, velocity: -700, startedFromMini: true),
       "cancelled mini-up drag restores the mini instead of committing expansion")
print("NATIVE_GESTURE_POLICY_OK")
`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-gesture-test-"));
  try {
    const script = path.join(directory, "GesturePolicy.swift");
    fs.writeFileSync(script, source + "\n" + exercise);
    const result = spawnSync(compiler.stdout.trim(), [script], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_GESTURE_POLICY_OK/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
