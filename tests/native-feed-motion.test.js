const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function declaration(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  const open = source.indexOf("{", start);
  let depth = 1, end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
    end++;
  }
  return source.slice(start, end);
}

test("Native Player hält schmutzige Feeds während Drag, Feder und Crop ruhig und gibt sie am Ende frei", {
  skip: process.platform !== "darwin", timeout: 70000,
}, t => {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  const app = path.join(__dirname, "../ios/Langform/Langform");
  const source = fs.readFileSync(path.join(app, "YouTubeWebView.swift"), "utf8");
  const callbacks = ["setFeedActivity", "settle", "flushPendingRect", "dragPlayer", "endDrag", "resetPlayerForViewportChange"]
    .map(name => declaration(source, "func " + name + "(")).join("\n");
  const policies = ["PlayerGesturePolicy.swift", "PlayerViewportPolicy.swift"]
    .map(name => fs.readFileSync(path.join(app, name), "utf8")).join("\n");
  // Execute the shipping state transitions. The WebView stub records native
  // visibility dispatches and a dirty feed resuming; it is not a UIKit FPS test.
  const exercise = `
import Foundation
import CoreGraphics
enum UIAccessibility { static var isReduceMotionEnabled = false }
enum UIView { static func performWithoutAnimation(_ action: () -> Void) { action() } }
enum StartupDiagnostics { static func mark(_ name: String) {} }
struct UISpringTimingParameters { init(dampingRatio: CGFloat, initialVelocity: CGVector) {} }
class UIViewPropertyAnimator {
  enum Position { case start, current, end }
  enum Curve { case easeOut }
  var isUserInteractionEnabled = false, stopped = false
  var animations: [() -> Void] = [], completions: [(Position) -> Void] = []
  init(duration: Double, timingParameters: UISpringTimingParameters) {}
  init(duration: Double, curve: Curve, animations: @escaping () -> Void) { self.animations = [animations] }
  func addAnimations(_ action: @escaping () -> Void) { animations.append(action) }
  func addCompletion(_ action: @escaping (Position) -> Void) { completions.append(action) }
  func startAnimation() { animations.forEach { $0() } }
  func stopAnimation(_ immediately: Bool) { stopped = true }
  func finish(_ position: Position = .end) { completions.forEach { $0(position) } }
}
class UIPanGestureRecognizer {
  enum State { case possible, began, changed, ended, cancelled, failed }
  var state = State.possible, delta = CGPoint.zero, speed = CGPoint.zero
  var isEnabled = true, cancelsTouchesInView = false
  func velocity(in: Any) -> CGPoint { speed }
}
class Card { var transform = CGAffineTransform.identity }
class WKWebView {
  var isUserInteractionEnabled = true, dirty = false, scans = 0
  var activity: [Bool] = [], media: [Bool] = []
  func evaluateJavaScript(_ script: String) {
    let active = script.contains("= true;")
    activity.append(active)
    if active && dirty { dirty = false; scans += 1 }
  }
  func setAllMediaPlaybackSuspended(_ value: Bool, completionHandler: (() -> Void)?) { media.append(value) }
}
class FeedState { var active: Bool?, mediaSuspended: Bool?; var refresh: Refresh? }
class Refresh { func cancel() {} }
class Stage {
  func cancelPendingMinimize() {}
 var cropCorrection: PlayerViewportPolicy.SurfaceCorrection?
  func discardFeedOpening() {}
  var ownsWatchPlayer = true
  struct StartupStatus { var keepsStartupPoster = true }
  var startupStatus = StartupStatus()
  var startupVideoID: String?
  func startInitialPlaybackIfEligible(id: String) {}
  enum Mode { case closed, loading, expanded, mini }
  var mode = Mode.expanded
  var feed = WKWebView(), player = WKWebView(), state = FeedState(), card = Card()
  var settler: UIViewPropertyAnimator?, revealer: UIViewPropertyAnimator?, dismisser: UIViewPropertyAnimator?
  var dragging = false, edgeBackTracking = false, edgeBackUsesPicture = false, fullscreenExitDrag = false
  var playerFullscreen = false, dragCanTakeOver = false, settlingBetweenModes = false, awaitingViewportGeometry = false
  var progress: CGFloat = 0, dragOrigin: CGFloat = 0, dragRevealOrigin: CGFloat = 0, dragTravel: CGFloat = 600
  var pendingRect: CGRect?, videoRect = CGRect(x: 0, y: 0, width: 400, height: 225)
  var drag = UIPanGestureRecognizer(), edgeBack = UIPanGestureRecognizer(), cardTap = UIPanGestureRecognizer()
  var viewportGeneration = 0
  var dragPosition: PlayerGesturePolicy.Position? { mode == .mini ? .mini : (mode == .expanded ? .expanded : nil) }
  ${declaration(source, "var cardMoving:")}
  func feedState(for view: WKWebView) -> FeedState? { view === feed ? state : nil }
  func updateChrome() { setFeedActivity(feed, active: true) }
  func apply(_ progress: CGFloat) {}
  var videoCropActive = false
  func beginVideoCrop() {}
  func restoreExpandedSurface() {}
  func finishMiniContext() {}
  func freezeSettle() { settler?.stopAnimation(true); settler = nil; settlingBetweenModes = false }
  func freezeReveal() { revealer?.stopAnimation(true); revealer = nil }
  func stopReveal(preservingStartupPoster: Bool = false) { freezeReveal(); card.transform = .identity }
  func showStartupPoster() {}
  func finishClose() { dismisser?.stopAnimation(true); dismisser = nil }
  func follow(_ pan: UIPanGestureRecognizer) { progress = min(1, max(0, dragOrigin + pan.delta.y / dragTravel)) }
  func setNativeDragging(_ active: Bool) {}
  func cancelVideoProbe() {}
  func requestFullscreenExit() {}
  ${callbacks}
}
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }
let s = Stage()
s.updateChrome(); s.feed.dirty = true
expect(s.state.active == false, "covered expanded feed begins inactive")
s.settle(.mini)
let first = s.settler!
expect(s.state.active == false && s.feed.scans == 0, "mini target cannot resume dirty scans before spring starts")
expect(s.feed.media == [true], "feed preview stays suspended with a player")
first.finish()
expect(s.state.active == true && s.feed.scans == 1, "completed mini reveals one dirty feed scan")
let count = s.feed.activity.count
s.updateChrome()
expect(s.feed.activity.count == count, "repeated chrome refresh is deduplicated")

// A direct upward drag from mini suspends the visible feed immediately. A
// cancelled gesture returns to mini, but resumes work only after its spring.
s.drag.state = .began; s.drag.delta.y = -150; s.dragPlayer(s.drag)
s.feed.dirty = true
expect(s.state.active == false, "finger tracking from mini pauses feed scans")
s.drag.state = .cancelled; s.dragPlayer(s.drag)
expect(s.state.active == false && s.feed.scans == 1 && s.mode == .mini, "cancel does not resume work ahead of return spring")
s.settler!.finish()
expect(s.state.active == true && s.feed.scans == 2, "cancelled mini drag eventually restores feed")

// Interrupted completions must not release a newer transition's suspension.
s.settle(.expanded); let expand = s.settler!
s.progress = 0.4; s.settle(.mini); let replacement = s.settler!
s.feed.dirty = true
expand.finish()
expect(s.state.active == false && s.feed.scans == 2, "old completion cannot resume interrupted transition")
replacement.finish()
expect(s.state.active == true && s.feed.scans == 3, "replacement transition resumes once")

// Geometry arriving during the mode spring produces a crop correction. Keep
// the gate across both animations instead of briefly waking the whole feed.
s.mode = .expanded; s.progress = 0; s.updateChrome(); s.feed.dirty = true
s.settle(.mini); let motion = s.settler!
s.pendingRect = CGRect(x: 0, y: 0, width: 400, height: 300)
motion.finish(); let crop = s.settler!
expect(crop !== motion && s.state.active == false && s.feed.scans == 3, "queued crop keeps dirty feed suspended")
crop.finish()
expect(s.state.active == true && s.feed.scans == 4, "last crop completion resumes the feed")
s.pendingRect = CGRect(x: 0, y: 1, width: 400, height: 300); s.flushPendingRect()
expect(s.state.active == false, "standalone crop correction also pauses feed")
s.settler!.finish()
expect(s.state.active == true, "standalone correction also releases its gate")

UIAccessibility.isReduceMotionEnabled = true
s.settle(.expanded); s.feed.dirty = true; s.settle(.mini)
expect(s.settler == nil && s.state.active == true && s.feed.scans == 5, "reduce motion reaches rest and resumes immediately")
UIAccessibility.isReduceMotionEnabled = false
s.settle(.expanded); s.feed.dirty = true
s.resetPlayerForViewportChange(); s.updateChrome()
expect(s.settler == nil && s.state.active == false, "rotation preserves expanded feed cover")
s.progress = 0; s.settle(.mini); let rotated = s.settler!
s.resetPlayerForViewportChange(); s.updateChrome()
expect(s.settler == nil && s.state.active == true && s.feed.scans == 6, "rotation to resting mini releases cancelled animation gate")
rotated.finish()
expect(s.feed.scans == 6, "late rotation completion does not duplicate resumed work")

let hidden = Stage(); hidden.mode = .mini
hidden.setFeedActivity(hidden.feed, active: false)
expect(hidden.state.active == false && hidden.feed.media == [true], "inactive tabs stay inactive even with a resting mini")
hidden.mode = .closed; hidden.setFeedActivity(hidden.feed, active: true)
expect(hidden.state.active == true && hidden.feed.media == [true, false], "closed player releases active feed media")
hidden.feed.dirty = true
hidden.mode = .loading; hidden.updateChrome()
expect(hidden.state.active == false && hidden.feed.media.last == true && hidden.feed.dirty,
       "opening a video suspends optional feed scans and preview decoding during startup")
hidden.mode = .mini; hidden.updateChrome()
expect(hidden.state.active == true && !hidden.feed.dirty,
       "return to the visible mini feed releases deferred work once")
print("NATIVE_FEED_MOTION_OK")
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "langform-feed-motion-"));
  try {
    const file = path.join(dir, "Motion.swift");
    fs.writeFileSync(file, policies + "\n" + exercise);
    const result = spawnSync(compiler.stdout.trim(), [file], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_FEED_MOTION_OK/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
