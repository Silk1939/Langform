const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("native Tabwechsel blenden ohne Größen- oder Richtungsbewegung um und restaurieren Originalposen bei jedem Abbruch", {
  skip: process.platform !== "darwin", timeout: 70000,
}, t => {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/MotionViews.swift"), "utf8");
  const start = source.indexOf("final class FeedMotion {");
  assert.ok(start >= 0, "execute the shipping FeedMotion class");
  let depth = 1, end = source.indexOf("{", start) + 1;
  while (depth && end < source.length) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
    end++;
  }
  assert.equal(depth, 0);
  // Execute callback ownership and geometry with recording UIKit stand-ins.
  // This does not emulate animation rendering or physical iPhone interaction.
  const harness = `
import Foundation
import CoreGraphics
import QuartzCore
enum UIAccessibility { static var isReduceMotionEnabled = false }
class Layer {
    var poses: [CATransform3D] = []
    var sublayerTransform = CATransform3DIdentity {
        didSet { poses.append(sublayerTransform) }
    }
}
class UIView {
    var frame = CGRect(x: 0, y: 0, width: 390, height: 844)
    var bounds = CGRect(x: 0, y: 0, width: 390, height: 844)
    var transform = CGAffineTransform.identity
    var alpha: CGFloat = 1
    var isHidden = false, isUserInteractionEnabled = true, accessibilityElementsHidden = false
    var window: Bool? = true
    let layer = Layer()
    weak var superview: UIView?
    var children: [UIView] = []
    var snapshot: UIView?, snapshotRequests: [Bool] = []
    var snapshotPoses: [CATransform3D] = []
    func snapshotView(afterScreenUpdates: Bool) -> UIView? {
        snapshotRequests.append(afterScreenUpdates)
        snapshotPoses.append(layer.sublayerTransform)
        return snapshot
    }
    func insertSubview(_ view: UIView, aboveSubview sibling: UIView) {
        view.removeFromSuperview()
        let index = children.firstIndex { $0 === sibling }.map { $0 + 1 } ?? children.count
        children.insert(view, at: index); view.superview = self
    }
    func removeFromSuperview() {
        superview?.children.removeAll { $0 === self }; superview = nil
    }
    static func performWithoutAnimation(_ action: () -> Void) { action() }
}
class UIViewPropertyAnimator {
    enum Position { case end }
    static var created: [UIViewPropertyAnimator] = []
    var stopped = false
    var action: () -> Void, completions: [(Position) -> Void] = []
    init(duration: Double, controlPoint1: CGPoint, controlPoint2: CGPoint, animations: @escaping () -> Void) {
        action = animations; Self.created.append(self)
    }
    func addCompletion(_ action: @escaping (Position) -> Void) { completions.append(action) }
    func startAnimation() { action() }
    func stopAnimation(_ immediately: Bool) { stopped = true }
    func finish() { completions.forEach { $0(.end) } }
}
${source.slice(start, end)}
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }
func close(_ lhs: CGFloat, _ rhs: CGFloat) -> Bool { abs(lhs - rhs) < 0.00001 }
func origin() -> UIView { let view = UIView(); view.snapshot = UIView(); return view }
let parent = UIView(), next = UIView(), playerCard = UIView()
let originalPose = CATransform3DRotate(CATransform3DMakeTranslation(7, 3, 0), 0.08, 0, 0, 1)
next.layer.sublayerTransform = originalPose
let originalFrame = next.frame, originalBounds = next.bounds
parent.insertSubview(next, aboveSubview: next)
parent.insertSubview(playerCard, aboveSubview: next)
let motion = FeedMotion(), first = origin()
let firstCover = first.snapshot!
motion.capture(first)
expect(first.snapshotRequests == [false], "capture reuses the painted feed without waiting for a new frame")
expect(!firstCover.isUserInteractionEnabled && firstCover.accessibilityElementsHidden,
       "cover can never intercept input or enter the accessibility tree")
expect(firstCover.superview == nil, "capture alone does not insert the old feed")
next.layer.poses.removeAll()
motion.reveal(next, direction: 1)
let firstAnimation = UIViewPropertyAnimator.created.last!
expect(parent.children.count == 3 && parent.children[1] === firstCover && parent.children[2] === playerCard,
       "cover sits immediately above its feed and below the current video card")
expect(firstCover.transform.isIdentity && firstCover.alpha == 0,
       "forward tab only dissolves its original full-size picture")
expect(next.layer.poses.isEmpty,
       "incoming viewport layers are never translated or scaled during a tab switch")
expect(CATransform3DEqualToTransform(next.layer.sublayerTransform, originalPose),
       "the scheduled landing returns to the original matrix rather than identity")
expect(next.frame == originalFrame && next.bounds == originalBounds && next.transform.isIdentity &&
       next.alpha == 1 && next.isUserInteractionEnabled && next.snapshotRequests.isEmpty,
       "incoming animation changes no viewport, layout, hit area or alpha and takes no second screenshot")

// The incoming view becomes the outgoing view on the very next tab selection.
// Its original sublayer matrix must be restored before the new screenshot.
next.snapshot = UIView()
let replacement = next, replacementCover = replacement.snapshot!
motion.capture(replacement)
expect(firstAnimation.stopped && firstCover.superview == nil && parent.children.count == 2,
       "new capture immediately cancels and removes an interrupted tab cover")
expect(CATransform3DEqualToTransform(replacement.snapshotPoses.last!, originalPose),
       "an interrupted incoming feed is restored before capturing it for the next transition")
next.layer.poses.removeAll()
motion.reveal(next, direction: -1)
let replacementAnimation = UIViewPropertyAnimator.created.last!
expect(replacementCover.transform.isIdentity && next.layer.poses.isEmpty,
       "backward tab has the same quiet dissolve without a directional push")
let beforeStaleCompletion = next.layer.poses.count
firstAnimation.finish()
expect(replacementCover.superview === parent && !replacementAnimation.stopped &&
       next.layer.poses.count == beforeStaleCompletion,
       "late completion cannot remove its replacement or reset that transition's incoming pose")
replacementAnimation.finish()
expect(replacementCover.superview == nil && parent.children.count == 2 &&
       CATransform3DEqualToTransform(next.layer.sublayerTransform, originalPose),
       "current completion removes its image and restores the exact incoming pose")

let cancelled = origin()
motion.capture(cancelled); motion.finish(); motion.finish()
let beforeCancelledReveal = UIViewPropertyAnimator.created.count
motion.reveal(next)
expect(UIViewPropertyAnimator.created.count == beforeCancelledReveal && cancelled.snapshot!.superview == nil,
       "finish also clears a captured image before reveal and is safe to repeat")

let preference = origin()
motion.capture(preference)
UIAccessibility.isReduceMotionEnabled = true
motion.reveal(next)
expect(UIViewPropertyAnimator.created.count == beforeCancelledReveal && preference.snapshot!.superview == nil,
       "Reduce Motion enabled between capture and reveal discards the pending cover")
UIAccessibility.isReduceMotionEnabled = false
motion.reveal(next)
expect(UIViewPropertyAnimator.created.count == beforeCancelledReveal,
       "turning motion back on cannot revive that discarded picture")
UIAccessibility.isReduceMotionEnabled = true
let reduced = origin(); motion.capture(reduced)
expect(reduced.snapshotRequests.isEmpty, "Reduce Motion skips snapshot work at capture")
UIAccessibility.isReduceMotionEnabled = false

let detached = origin(), withoutParent = UIView()
motion.capture(detached); motion.reveal(withoutParent)
motion.reveal(next)
expect(detached.snapshot!.superview == nil && UIViewPropertyAnimator.created.count == beforeCancelledReveal,
       "missing destination parent clears the pending capture permanently")
for unavailable in 0..<3 {
    let view = origin()
    if unavailable == 0 { view.isHidden = true }
    else if unavailable == 1 { view.window = nil }
    else { view.snapshot = nil }
    motion.capture(view); motion.reveal(next)
    expect(UIViewPropertyAnimator.created.count == beforeCancelledReveal, "unavailable source cannot animate")
}

let wide = origin(); next.bounds.size.width = 1000
next.layer.poses.removeAll()
motion.capture(wide); motion.reveal(next, direction: 1)
expect(wide.snapshot!.transform.isIdentity && next.layer.poses.isEmpty,
       "wide viewport changes still introduce no travel or scaling")
let lastAnimation = UIViewPropertyAnimator.created.last!
let beforeFinish = next.layer.poses.count
motion.finish(); lastAnimation.finish()
expect(wide.snapshot!.superview == nil && lastAnimation.stopped && parent.children.count == 2 &&
       next.layer.poses.count == beforeFinish + 1 &&
       CATransform3DEqualToTransform(next.layer.sublayerTransform, originalPose),
       "touch/background/resize cleanup restores the original matrix once and late completion does nothing")
next.layer.sublayerTransform = CATransform3DMakeTranslation(2, 4, 0)
motion.finish()
expect(CATransform3DEqualToTransform(next.layer.sublayerTransform, CATransform3DMakeTranslation(2, 4, 0)),
       "after cleanup there is no retained incoming view whose later pose could be overwritten")
print("NATIVE_TAB_TRANSITION_OK")
`;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "langform-tab-transition-"));
  try {
    const script = path.join(temporary, "FeedMotion.swift");
    fs.writeFileSync(script, harness);
    const result = spawnSync(compiler.stdout.trim(), [script], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_TAB_TRANSITION_OK/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
