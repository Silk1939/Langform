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

test("Native Close hält die echte Fläche, stoppt Medien sofort und verwirft überholte Abschlüsse", {
  skip: process.platform !== "darwin", timeout: 70000,
}, t => {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/YouTubeWebView.swift"), "utf8");
  const methods = ["closePlayer", "cancelCloseMotion", "finishClose", "beginLoading", "resumePreparedPlayer", "setFeedActivity", "scheduleFeedPrewarm", "cancelFeedPrewarm", "feedInteractionBegan", "appEnteredBackground", "reduceMotionChanged",
    ...(source.includes("func suspendPreparedPlayer(") ? ["suspendPreparedPlayer"] : [])]
    .map(name => declaration(source, "func " + name + "(")).join("\n");
  // Execute shipping lifecycle methods. The animator intentionally permits
  // delivering stale completions after cancellation to exercise their guards.
  // This models ordering/state, not UIKit pixels, media decoding or frame rate.
  const exercise = `
import Foundation
import CoreGraphics
enum UIAccessibility { static var isReduceMotionEnabled = false }
class DispatchWorkItem {
  var cancelled = false; let action: () -> Void
  init(block: @escaping () -> Void) { action = block }
  func cancel() { cancelled = true }
}
struct Deadline { static func now() -> Deadline { Deadline() }; static func +(lhs: Deadline, rhs: Double) -> Deadline { lhs } }
class DispatchQueue {
  static let main = DispatchQueue(); var pending: [DispatchWorkItem] = []
  func asyncAfter(deadline: Deadline, execute: DispatchWorkItem) { pending.append(execute) }
  func run() { let next = pending; pending = []; for work in next where !work.cancelled { work.action() } }
}
class ProcessInfo { static let processInfo = ProcessInfo(); var isLowPowerModeEnabled = false; enum Thermal { case nominal }; var thermalState = Thermal.nominal }
class UIApplication { static let shared = UIApplication(); enum State { case active }; var applicationState = State.active }
class UIPanGestureRecognizer { enum State { case began, ended, cancelled }; var state = State.began }
enum FeedTab: Hashable {
  case home, subscriptions
  init?(url: URL?) {
    switch url?.path { case "", "/": self = .home; case "/feed/subscriptions": self = .subscriptions; default: return nil }
  }
}
class Network { struct Policy { var online = true, constrained = false }; var policy: Policy? = Policy() }
enum YouTubeWebView { static func homeURL(for url: URL?) -> URL { URL(string: "https://m.youtube.com/")! } }
enum StartupDiagnostics { static func mark(_ event: String) {} }
class UIViewPropertyAnimator {
  enum Position { case start, current, end }
  enum Curve { case easeIn }
  var stopped = false, animations: [() -> Void] = [], completions: [(Position) -> Void] = []
  let duration: Double
  init(duration: Double, curve: Curve) { self.duration = duration }
  func addAnimations(_ action: @escaping () -> Void) { animations.append(action) }
  func addCompletion(_ action: @escaping (Position) -> Void) { completions.append(action) }
  func startAnimation() { animations.forEach { $0() } }
  func stopAnimation(_ immediately: Bool) { stopped = true }
  func finish(_ position: Position = .end) { completions.forEach { $0(position) } }
}
class Layer { func removeAllAnimations() {} }
class Card {
  var isHidden = false, alpha: CGFloat = 1
  var transform = CGAffineTransform.identity, layer = Layer()
}
class Control { var isEnabled = true, alpha: CGFloat = 1, isHidden = false }
class Cancellable { var cancelled = false; func cancel() { cancelled = true } }
class Motion { func finish() {}; func cancel() {}; func reduceMotionChanged() {} }
class WKNavigation {}
class Scroll { var isTracking = false, isDragging = false, isDecelerating = false }
class WKWebView {
  var url: URL? = URL(string: "https://m.youtube.com/watch?v=abcdefghijk")
  var isUserInteractionEnabled = true, dirty = false, scans = 0, stops = 0
  var isLoading = false, isHidden = false, accessibilityElementsHidden = false
  var frame = CGRect.zero, scrollView = Scroll(), mediaSuspensionDepth = 0
  var loads: [URL] = [], media: [Bool] = [], activity: [Bool] = []
  func load(_ request: URLRequest) -> WKNavigation {
    url = request.url; loads.append(request.url!); return WKNavigation()
  }
  func stopLoading() { stops += 1 }
  // WKWebView suspension is paired, not an idempotent Boolean setter.
  // Keep its depth across loads to reproduce close + idle prewarm + reopen.
  func setAllMediaPlaybackSuspended(_ value: Bool, completionHandler: (() -> Void)?) {
    media.append(value)
    if value { mediaSuspensionDepth += 1 } else if mediaSuspensionDepth > 0 { mediaSuspensionDepth -= 1 }
    completionHandler?()
  }
  func canStartMedia() -> Bool { mediaSuspensionDepth == 0 }
  func evaluateJavaScript(_ script: String) {
    let active = script.contains("= true;"); activity.append(active)
    if active && dirty { dirty = false; scans += 1 }
  }
}
class FeedState {
  var active: Bool?, mediaSuspended: Bool?; var refresh: Cancellable?
  let webView: WKWebView, rootURL: URL
  var overlayOpen = false, rootNavigation: WKNavigation?
  init(_ webView: WKWebView = WKWebView(), rootURL: URL = URL(string: "https://m.youtube.com/")!) {
    self.webView = webView; self.rootURL = rootURL; webView.url = rootURL
  }
}
struct PlayerStartupStatus {}
class Diagnostics { enum Outcome { case cancelled }; func finish(_ outcome: Outcome) {} }
class Stage {
  func cancelPendingMinimize() {}
  class SystemMedia { var clears = 0; func clear() { clears += 1 } }
  let systemMedia = SystemMedia()
  var feedOpening: Int?
  func reverseFeedOpening() {}
  func discardFeedOpening() {}
  enum Mode { case closed, loading, expanded, mini }
  static let blankURL = URL(string: "about:blank")!
  var mode = Mode.expanded
  var player: WKWebView! = WKWebView(), feed: WKWebView! = WKWebView(), state = FeedState()
  var feedTabs: [FeedTab: FeedState] = [:], activeFeedTab = FeedTab.home, prewarmingTab: FeedTab?
  var backgroundPreparationDisabled = false, keyboardVisible = false, feedFailed = false
  var bounds = CGRect(x: 0, y: 0, width: 400, height: 800), networkQuality = Network()
  var feedPrewarm: DispatchWorkItem?
  var card = Card(), cardTap = Control(), collapseButton = Control(), loadStatus = Control()
  var window: NSObject? = NSObject()
  var settler: UIViewPropertyAnimator?, revealer: UIViewPropertyAnimator?, dismisser: UIViewPropertyAnimator?
  var feedMotion = Motion(), openingMotion = Motion(), videoLoadDiagnostics = Diagnostics()
  var loadingTimeout: Cancellable?, missingMediaTimeout: Cancellable?
  var summaryTasks: [ObjectIdentifier: Cancellable] = [:]
  var playerNavigation: WKNavigation?, playerWarmupNavigation: WKNavigation?
  var loadingViaSPA = false, playerWarmupAttempted = false, executingInteractionProbe = false
  var playerPreparationSuspended = false, playerOverlayOpen = false, playerFullscreen = false
  var playerOverlayVideoID: String? = "abcdefghijk"
  var videoPlaying = true, dragging = false, settlingBetweenModes = false
  var startupStatus = PlayerStartupStatus(), loadTicket = 10
  var startupVideoID: String? = "abcdefghijk"
  var loadingVideoID: String? = "abcdefghijk", pendingTimestampURL: URL?
  var pendingRect: CGRect?, videoRect = CGRect(x: 0, y: 0, width: 400, height: 225)
  var progress: CGFloat = 0, prewarms = 0, probeCancellations = 0
  init() {
    state = FeedState(feed)
    feedTabs[.home] = state
    feedTabs[.subscriptions] = FeedState(rootURL: URL(string: "https://m.youtube.com/feed/subscriptions")!)
  }
  ${declaration(source, "var cardMoving:")}
  func feedState(for web: WKWebView) -> FeedState? { web === feed ? state : nil }
  func updateChrome() { setFeedActivity(feed, active: true) }
  func apply(_ value: CGFloat) { progress = value }
  var videoCropActive = false
  func beginVideoCrop() {}
  func restoreExpandedSurface() {}
  func finishMiniContext() {}
  func cancelVideoProbe() { probeCancellations += 1 }
  var downloadCancellations=0
  func cancelDownloadSourceRequest() { downloadCancellations += 1 }
  func cancelNativeRotation() {}
  func cancelPendingFeedSearch() {}
  func resetCustomFullscreen() {}
  func cancelSPAWaits() {}
  func ensurePlayer() { if player == nil { player = WKWebView() } }
  func makeFeedTab(_ tab: FeedTab, origin: URL?) -> FeedState {
    let state = FeedState(rootURL: URL(string: "https://m.youtube.com/feed/subscriptions")!)
    feedTabs[tab] = state; return state
  }
  func evictFeedTab(_ tab: FeedTab) { feedTabs.removeValue(forKey: tab) }
  func freezeSettle() { settler?.stopAnimation(true); settler = nil }
  func freezeReveal() { revealer?.stopAnimation(true); revealer = nil }
  func endDrag() { dragging = false }
  func settle(_ target: Mode) { fatalError("This close test must not settle an open player") }
  func insertSubview(_ view: Any, belowSubview: WKWebView) {}
  ${methods}
}
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }

let normal = Stage()
normal.updateChrome(); normal.feed.dirty = true
let pending = Cancellable(); normal.summaryTasks[ObjectIdentifier(normal.player)] = pending
normal.closePlayer()
expect(normal.systemMedia.clears == 1, "closing clears system metadata and its remote commands")
expect(normal.downloadCancellations > 0, "closing cancels download preparation immediately")
let dismissal = normal.dismisser!
expect(normal.mode == .closed && normal.cardMoving, "closed logical mode keeps motion gate until exit completion")
expect(normal.player.media == [true] && normal.playerPreparationSuspended && normal.player.stops == 1,
       "audio/autoplay suspension and load stop happen immediately")
expect(normal.player.loads.isEmpty && !normal.card.isHidden, "live surface survives while its exit runs")
expect(normal.feed.media == [true] && normal.state.active == false && normal.feed.scans == 0,
       "dirty feed and preview media stay suspended during exit")
expect(pending.cancelled && !normal.player.isUserInteractionEnabled, "old summary and web input cannot outlive close")
expect(normal.playerOverlayVideoID == nil && !normal.playerOverlayOpen, "closing releases the previous video's overlay identity")
expect(dismissal.duration == 0.20, "exit uses one short duration")
normal.closePlayer()
expect(normal.dismisser === dismissal && normal.player.media == [true], "duplicate close does not restart or repeat suspension")
dismissal.finish()
expect(normal.dismisser == nil && normal.card.isHidden && normal.card.alpha == 1 && normal.card.transform.isIdentity,
       "completion releases animation and restores reusable card pose")
expect(normal.player.loads == [Stage.blankURL], "blank navigation is deferred to completion")
expect(normal.feed.media == [true, false] && normal.state.active == true && normal.feed.scans == 1,
       "feed resumes once after exit")
dismissal.finish()
expect(normal.player.loads.count == 1 && normal.feed.scans == 1, "stale completion cannot repeat teardown")

// The actual beginLoading method is the handoff used by openWatch after its
// new loadTicket. The old fade must not blank, hide or move the replacement.
let replacement = Stage(); replacement.closePlayer(); let oldClose = replacement.dismisser!
replacement.loadTicket += 1; replacement.beginLoading()
let nextURL = URL(string: "https://m.youtube.com/watch?v=nextvideo01")!
replacement.playerNavigation = replacement.player.load(URLRequest(url: nextURL))
expect(oldClose.stopped && replacement.dismisser == nil && replacement.mode == .loading,
       "new loading handoff cancels prior dismissal")
expect(!replacement.card.isHidden && replacement.card.alpha == 1 && replacement.card.transform.isIdentity,
       "new document starts with a clean reusable card")
oldClose.finish()
expect(replacement.player.loads == [nextURL] && !replacement.card.isHidden,
       "old close cannot navigate new document to blank")
replacement.resumePreparedPlayer(); replacement.resumePreparedPlayer()
expect(replacement.player.media == [true, false], "accepted new player resumes media exactly once")
replacement.mode = .mini; replacement.closePlayer(); let secondClose = replacement.dismisser!
oldClose.finish()
expect(replacement.dismisser === secondClose && !replacement.card.isHidden,
       "old close cannot finish a second close even though mode is closed again")
secondClose.finish()
expect(replacement.player.loads == [nextURL, Stage.blankURL], "current second close alone unloads new video")

// Identity and ticket are independent defenses: a stale ticket must not own
// even a currently retained animator. Normal handoff cancels it immediately.
let ticketGuard = Stage(); ticketGuard.closePlayer(); let invalid = ticketGuard.dismisser!
ticketGuard.loadTicket += 1; invalid.finish()
expect(ticketGuard.dismisser === invalid && ticketGuard.player.loads.isEmpty, "mismatched request ticket rejects completion")
ticketGuard.beginLoading()

for reason in ["reduce", "offwindow", "loading", "hidden"] {
  let instant = Stage()
  if reason == "reduce" { UIAccessibility.isReduceMotionEnabled = true }
  if reason == "offwindow" { instant.window = nil }
  if reason == "loading" { instant.mode = .loading }
  if reason == "hidden" { instant.card.isHidden = true }
  instant.closePlayer()
  expect(instant.dismisser == nil && instant.card.isHidden && instant.player.loads == [Stage.blankURL],
         reason + " closes immediately without a hidden animation wait")
  expect(instant.player.media == [true], reason + " still suspends old media")
  UIAccessibility.isReduceMotionEnabled = false
}

let background = Stage(); background.closePlayer(); let interrupted = background.dismisser!
background.appEnteredBackground()
expect(background.card.isHidden && background.dismisser == nil && background.player.loads == [Stage.blankURL],
       "background finalizes already-closed live surface")
interrupted.finish()
expect(background.player.loads.count == 1, "background's stale animation completion does nothing")

let reducedWhileClosing = Stage(); reducedWhileClosing.closePlayer(); let reducedExit = reducedWhileClosing.dismisser!
UIAccessibility.isReduceMotionEnabled = true; reducedWhileClosing.reduceMotionChanged(); reducedExit.finish()
expect(reducedWhileClosing.dismisser == nil && reducedWhileClosing.card.isHidden && reducedWhileClosing.player.loads == [Stage.blankURL],
       "Reduce Motion toggled mid-close finalizes once without leaving a hidden live player")
UIAccessibility.isReduceMotionEnabled = false

let lifecycle = Stage(); lifecycle.closePlayer(); let beforeReset = lifecycle.dismisser!
lifecycle.finishClose(); lifecycle.finishClose(); beforeReset.finish()
expect(lifecycle.card.isHidden && lifecycle.player.loads == [Stage.blankURL],
       "shared rotation/stop/memory cleanup is idempotent")

// The reported interaction: playing -> mini -> close -> feed refresh -> new
// watch. Run the shipping close/prewarm/loading/resume methods together. A
// Boolean mock missed that true + true + false leaves WebKit suspended.
DispatchQueue.main.pending = []
let reused = Stage(), refreshPan = UIPanGestureRecognizer()
for cycle in 0..<3 {
  reused.mode = .mini; reused.videoPlaying = true; reused.card.isHidden = false
  reused.closePlayer(); reused.dismisser!.finish()
  expect(reused.player.url == Stage.blankURL && !reused.player.canStartMedia(),
         "closing stops old media before refreshed feed, cycle " + String(cycle))
  refreshPan.state = .began; reused.feedInteractionBegan(refreshPan)
  // Completing the feed's reload schedules the same idle preparation as
  // didFinish. Feed navigation must not alter the separate player's lock.
  _ = reused.feed.load(URLRequest(url: URL(string: "https://m.youtube.com/")!))
  refreshPan.state = .ended; reused.feedInteractionBegan(refreshPan)
  DispatchQueue.main.run()
  expect(reused.playerWarmupAttempted && reused.player.url?.path == "/",
         "refreshed feed prepares the same player shell, cycle " + String(cycle))
  reused.cancelFeedPrewarm(discardLoading: true)
  reused.loadTicket += 1; reused.beginLoading()
  reused.playerNavigation = reused.player.load(URLRequest(url: nextURL))
  reused.resumePreparedPlayer(); reused.resumePreparedPlayer()
  expect(reused.player.canStartMedia() && !reused.playerPreparationSuspended && reused.player.isUserInteractionEnabled,
         "new watch accepts Play after close, refresh and prewarm, cycle " + String(cycle))
}
expect(reused.player.media == [true, false, true, false, true, false],
       "three reused-player cycles keep suspension calls balanced")

// Closing an in-flight watch that still owns its preparation lock must also
// avoid acquiring it again before the next document can release it.
let interruptedLoad = Stage()
interruptedLoad.mode = .mini; interruptedLoad.closePlayer(); interruptedLoad.dismisser!.finish()
DispatchQueue.main.run()
interruptedLoad.loadTicket += 1; interruptedLoad.beginLoading()
interruptedLoad.closePlayer()
DispatchQueue.main.run()
interruptedLoad.loadTicket += 1; interruptedLoad.beginLoading()
interruptedLoad.playerNavigation = interruptedLoad.player.load(URLRequest(url: nextURL))
interruptedLoad.resumePreparedPlayer()
expect(interruptedLoad.player.canStartMedia(), "closing a still-suspended load leaves the following video's Play usable")
print("NATIVE_CLOSE_MOTION_OK")
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "langform-native-close-"));
  try {
    const file = path.join(dir, "Close.swift"); fs.writeFileSync(file, exercise);
    const result = spawnSync(compiler.stdout.trim(), [file], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_CLOSE_MOTION_OK/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
