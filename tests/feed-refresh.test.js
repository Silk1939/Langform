const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Feed-Refresh reagiert auf einen kurzen bewussten Zug ohne offenen Refresh-Inset und folgt der Navigation", {
  skip: process.platform !== "darwin", timeout: 70000,
}, function (t) {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  // Run the shipping helper against pan/navigation stubs. Only framework
  // imports, actor/ObjC syntax and callback visibility are adapted for Foundation.
  // This verifies gesture/state transitions, not UIKit rendering or touch feel.
  const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/FeedRefresh.swift"), "utf8")
    .replace(/^import (UIKit|WebKit|QuartzCore)$/gm, "")
    .replace(/^@MainActor$/gm, "")
    .replace(/@objc private func handlePan/g, "func handlePan")
    .replace(/@objc private func settleAfterPull/g, "func settleAfterPull")
    .replace(/#selector\(settleAfterPull\(_:\)\)/g, '"settleAfterPull"')
    .replace(/#selector\(handlePan\(_:\)\)/g, '"handlePan"');
  const stubs = `
import Foundation
import CoreGraphics
struct UIColor { static let label = UIColor() }
struct UIEdgeInsets { var top: CGFloat = 0, bottom: CGFloat = 0 }
class NSLayoutConstraint {
    static var activated: [NSLayoutConstraint] = []
    let first: Anchor, second: Anchor, constant: CGFloat
    init(_ first: Anchor, _ second: Anchor, _ constant: CGFloat) {
        self.first = first; self.second = second; self.constant = constant
    }
    static func activate(_ constraints: [NSLayoutConstraint]) { activated += constraints }
}
class Anchor {
    func constraint(equalTo other: Anchor, constant: CGFloat = 0) -> NSLayoutConstraint {
        NSLayoutConstraint(self, other, constant)
    }
}
class LayoutGuide { let centerXAnchor = Anchor(), topAnchor = Anchor() }
class UIView {
    struct AutoresizingMask: OptionSet {
        let rawValue: Int
        static let flexibleWidth = Self(rawValue: 1), flexibleHeight = Self(rawValue: 2)
    }
    var frame = CGRect.zero, bounds = CGRect(x: 0, y: 0, width: 390, height: 844)
    var autoresizingMask: AutoresizingMask = [], accessibilityElementsHidden = false
    var snapshot: UIView?, snapshotRequests = 0
    func snapshotView(afterScreenUpdates: Bool) -> UIView? { snapshotRequests += 1; return snapshot }
    func bringSubviewToFront(_ view: UIView) { subviews.removeAll { $0 === view }; subviews.append(view) }
    var superview: UIView?
    var subviews: [UIView] = []
    var isUserInteractionEnabled = true, translatesAutoresizingMaskIntoConstraints = true
    var accessibilityLabel: String?
    let centerXAnchor = Anchor(), topAnchor = Anchor()
    func addSubview(_ child: UIView) { child.removeFromSuperview(); subviews.append(child); child.superview = self }
    func removeFromSuperview() { superview?.subviews.removeAll { $0 === self }; superview = nil }
}
class WKNavigation {}
var testClock: Double = 0
func CACurrentMediaTime() -> Double { testClock }
class CADisplayLink {
    static var active: [CADisplayLink] = []
    var target: FeedRefresh?, invalidated = false
    init(target: AnyObject, selector: String) { self.target = target as? FeedRefresh; Self.active.append(self) }
    func add(to runLoop: RunLoop, forMode mode: RunLoop.Mode) {}
    func invalidate() { invalidated = true; target = nil }
    static func tick() {
        testClock += 1.0 / 60
        for link in active where !link.invalidated { link.target?.settleAfterPull(link) }
        active.removeAll { $0.invalidated }
    }
}
class UIScrollView: UIView {
    var alwaysBounceVertical = false
    var refreshControl: AnyObject?
    var contentOffset = CGPoint.zero
    var isTracking = false, isDragging = false, isDecelerating = false
    var contentInset = UIEdgeInsets(), adjustedContentInset = UIEdgeInsets()
    let frameLayoutGuide = LayoutGuide()
    let panGestureRecognizer = UIPanGestureRecognizer()
}
class UIActivityIndicatorView: UIView {
    enum Style { case medium }
    var color: UIColor?, hidesWhenStopped = false, isAnimating = false
    init(style: Style) {}
    func startAnimating() { isAnimating = true }
    func stopAnimating() { isAnimating = false }
}
class UIPanGestureRecognizer {
    enum State { case possible, began, changed, ended, cancelled, failed }
    var state = State.possible, delta = CGPoint.zero
    weak var target: FeedRefresh?
    var removed = 0
    func addTarget(_ target: AnyObject, action: String) { self.target = target as? FeedRefresh }
    func removeTarget(_ target: AnyObject, action: String) { self.target = nil; removed += 1 }
    func translation(in view: UIView?) -> CGPoint { delta }
    func emit(_ state: State, _ y: CGFloat = 0, x: CGFloat = 0) {
        self.state = state; delta = CGPoint(x: x, y: y); target?.handlePan(self)
        if state == .ended { CADisplayLink.tick(); CADisplayLink.tick() }
    }
    func pull(_ y: CGFloat = 64) { emit(.began); emit(.changed, y); emit(.ended, y) }
}
`;
  const exercise = `
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }
let scroll = UIScrollView()
var allowed = true, loads = 0
var requested: WKNavigation? = WKNavigation()
let refresh = FeedRefresh(scrollView: scroll, canRefresh: { allowed }, onRefresh: { loads += 1; return requested })
let pan = scroll.panGestureRecognizer
let indicator = scroll.subviews[0] as! UIActivityIndicatorView
expect(scroll.alwaysBounceVertical && indicator.accessibilityLabel == "Feed aktualisieren", "attach enables short-feed pull and labels action")
expect(!indicator.isUserInteractionEnabled && indicator.hidesWhenStopped, "indicator neither intercepts feed touches nor remains visible at rest")
expect(NSLayoutConstraint.activated.contains { $0.second === scroll.frameLayoutGuide.topAnchor }, "indicator stays in the viewport instead of opening space above the document")
expect(scroll.refreshControl == nil && scroll.contentInset.top == 0, "attachment creates no native refresh control or blank refresh inset")
pan.pull(63)
expect(loads == 0 && !indicator.isAnimating, "short accidental pulls do not refresh")
pan.emit(.began); pan.emit(.changed, 64)
expect(loads == 0 && indicator.isAnimating, "64-point finger pull gives feedback but waits for release")
pan.emit(.changed, 40); pan.emit(.ended, 40)
expect(loads == 0 && !indicator.isAnimating, "pulling back below threshold cancels")
pan.emit(.began); pan.emit(.changed, 80, x: 120); pan.emit(.ended, 80, x: 120)
expect(loads == 0, "horizontal history gesture is not a refresh")
pan.emit(.began); pan.emit(.changed, 80); pan.emit(.cancelled, 80)
pan.emit(.began); pan.emit(.changed, 80); pan.emit(.failed, 80)
expect(loads == 0 && !indicator.isAnimating, "cancelled and failed gestures do not refresh")
scroll.contentOffset.y = 150
pan.emit(.began); scroll.contentOffset.y = -40; pan.emit(.changed, 220); pan.emit(.ended, 220)
expect(loads == 0, "scrolling back to top is not itself a deliberate refresh")
scroll.contentOffset.y = 0
pan.emit(.began); pan.emit(.changed, 80); allowed = false; pan.emit(.ended, 80)
expect(loads == 0 && !indicator.isAnimating, "hidden or covered feed cannot accept release")
allowed = true
pan.emit(.began); pan.emit(.changed, 80); refresh.cancel(); pan.emit(.ended, 80)
expect(loads == 0 && !indicator.isAnimating, "hiding a tab while tracking cancels its pending pull")
pan.pull()
expect(loads == 1 && indicator.isAnimating, "short release starts one reload and keeps feedback until terminal callback")
pan.emit(.ended, 64); pan.pull(); pan.emit(.cancelled)
expect(loads == 1 && indicator.isAnimating, "duplicate and unrelated gestures neither reload nor end pending spinner")
expect(scroll.contentInset.top == 0 && scroll.contentOffset.y == 0, "reload adds no inset and does not force a scroll position")
refresh.finish(navigation: nil)
refresh.finish(navigation: WKNavigation())
refresh.navigationStarted(nil)
refresh.navigationStarted(requested)
expect(indicator.isAnimating, "nil, old terminal and matching start do not complete pending refresh")
refresh.finish(navigation: requested)
expect(!indicator.isAnimating, "matching finish completes refresh")
refresh.finish(navigation: requested)
expect(!indicator.isAnimating, "duplicate terminal callback is inert")
let old = requested
requested = WKNavigation(); pan.pull()
refresh.finish(navigation: old)
expect(loads == 2 && indicator.isAnimating, "old callback cannot end newer pull")
refresh.navigationStarted(WKNavigation())
expect(!indicator.isAnimating, "a replacing navigation cancels pending refresh")
allowed = false; pan.pull()
expect(loads == 2 && !indicator.isAnimating, "non-feed or hidden owner rejects pull without reload")
allowed = true; requested = nil; pan.pull()
expect(loads == 3 && !indicator.isAnimating, "unavailable reload has no terminal callback and ends spinner")
requested = WKNavigation(); pan.pull(); refresh.cancel()
expect(loads == 4 && !indicator.isAnimating, "hide/process termination cancels pending spinner")
scroll.contentInset.top = 20; scroll.adjustedContentInset.top = 20; scroll.contentOffset.y = -20
pan.pull(); refresh.finish(navigation: requested)
expect(loads == 5 && !indicator.isAnimating, "adjusted top inset still permits the next deliberate pull")
expect(scroll.contentInset.top == 20 && scroll.contentOffset.y == -20, "existing scroll insets and offsets are preserved")
refresh.detach()
expect(!scroll.alwaysBounceVertical && pan.removed == 1 && indicator.superview == nil, "detach restores original scrolling and removes target and indicator")
pan.pull()
expect(loads == 5, "detached gesture cannot call owner")
let bounce = UIScrollView(); bounce.alwaysBounceVertical = true
let otherControl = NSObject(); bounce.refreshControl = otherControl
let bounced = FeedRefresh(scrollView: bounce, canRefresh: { true }, onRefresh: { WKNavigation() })
bounced.detach()
expect(bounce.alwaysBounceVertical && bounce.refreshControl === otherControl, "existing bounce and another owner's refresh control are preserved")
class Owner { var allowed = true; var navigation = WKNavigation() }
var owner: Owner? = Owner(); weak var weakOwner = owner
let released = FeedRefresh(scrollView: UIScrollView(), canRefresh: { [kept = owner!] in kept.allowed }, onRefresh: { [kept = owner!] in kept.navigation })
owner = nil
expect(weakOwner != nil, "callbacks retain their owner until teardown")
released.detach()
expect(weakOwner == nil, "teardown releases both owner callbacks")
let surface = UIView(), liveScroll = UIScrollView()
surface.addSubview(liveScroll)
let retained = UIView(); surface.snapshot = retained
var refreshNavigation: WKNavigation? = WKNavigation()
let painted = FeedRefresh(scrollView: liveScroll, contentView: surface,
                          canRefresh: { true }, onRefresh: { refreshNavigation })
liveScroll.panGestureRecognizer.pull()
let paintedIndicator = surface.subviews.compactMap { $0 as? UIActivityIndicatorView }.first!
expect(retained.superview === surface && retained.frame == surface.bounds,
       "reload retains the current painted content at the same viewport size")
expect(!retained.isUserInteractionEnabled && retained.accessibilityElementsHidden,
       "the retained content cannot intercept gestures or appear twice to VoiceOver")
expect(surface.subviews.last === paintedIndicator && paintedIndicator.isAnimating,
       "refresh feedback remains above the retained picture")
painted.finish(navigation: refreshNavigation)
expect(retained.superview === surface && paintedIndicator.isAnimating,
       "network completion before feed hydration must not expose a blank page")
painted.contentReady(navigation: WKNavigation())
expect(retained.superview === surface, "old readiness cannot release the current picture")
expect(!painted.acceptsContentReady(navigation: refreshNavigation),
       "old document readiness is rejected before scheduling asynchronous token evaluation")
painted.contentReady(navigation: refreshNavigation)
expect(retained.superview === surface, "old document with the same URL before commit cannot release the cover")
painted.navigationCommitted(WKNavigation())
painted.contentReady(navigation: refreshNavigation)
expect(retained.superview === surface, "a stale document commit cannot grant paint readiness")
painted.navigationCommitted(refreshNavigation)
painted.contentReady(navigation: refreshNavigation)
expect(retained.superview == nil && !paintedIndicator.isAnimating,
       "painted rows release the retained content and spinner together")
refreshNavigation = WKNavigation(); liveScroll.panGestureRecognizer.pull()
painted.failed(navigation: refreshNavigation)
expect(retained.superview == nil && !paintedIndicator.isAnimating, "failure releases retained contents")
liveScroll.panGestureRecognizer.pull(); painted.releaseCoverForInteraction()
expect(retained.superview == nil && !paintedIndicator.isAnimating,
       "new input sees the actual page before dispatch rather than a stale picture")
liveScroll.panGestureRecognizer.pull(); painted.detach()
expect(retained.superview == nil && paintedIndicator.superview == nil,
       "teardown releases retained content, feedback and scheduled cleanup")
let settlingScroll = UIScrollView(), settlingSurface = UIView(), settlingSnapshot = UIView()
settlingSurface.addSubview(settlingScroll); settlingSurface.snapshot = settlingSnapshot
var settlingLoads = 0, captureOffset: CGFloat = .greatestFiniteMagnitude
let settling = FeedRefresh(scrollView: settlingScroll, contentView: settlingSurface,
    canRefresh: { true }, onRefresh: { settlingLoads += 1; captureOffset = settlingScroll.contentOffset.y; return WKNavigation() })
settlingScroll.contentOffset.y = -48
settlingScroll.panGestureRecognizer.pull()
expect(settlingLoads == 0 && settlingSurface.snapshotRequests == 0,
       "release at a rubber-banded offset does not freeze that displaced picture or restart WebKit")
settlingScroll.contentOffset.y = -1; CADisplayLink.tick(); CADisplayLink.tick()
expect(settlingLoads == 0, "an almost-returned viewport is still owned by native scrolling")
settlingScroll.contentOffset.y = 0; settlingScroll.isDecelerating = true
CADisplayLink.tick(); CADisplayLink.tick()
expect(settlingLoads == 0, "passing zero during active native deceleration cannot capture early")
settlingScroll.isDecelerating = false; CADisplayLink.tick()
expect(settlingLoads == 0, "a single rest frame is insufficient")
CADisplayLink.tick()
expect(settlingLoads == 1 && settlingSurface.snapshotRequests == 1 && captureOffset == 0,
       "two native rest frames capture and reload at the same viewport origin")
settling.cancel(); settlingScroll.contentOffset.y = -48; settlingScroll.panGestureRecognizer.pull()
settling.releaseCoverForInteraction(); settlingScroll.contentOffset.y = 0
CADisplayLink.tick(); CADisplayLink.tick()
expect(settlingLoads == 1 && CADisplayLink.active.isEmpty,
       "a new gesture cancels a waiting pull before snapshot or reload")
settlingScroll.contentOffset.y = -48; settlingScroll.panGestureRecognizer.pull()
testClock += 3; CADisplayLink.tick()
expect(settlingLoads == 1 && CADisplayLink.active.isEmpty,
       "an interrupted return cannot keep a display link and pending refresh alive forever")
settling.detach()
print("FEED_REFRESH_OK")
`;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "langform-feed-refresh-"));
  try {
    const script = path.join(temporary, "FeedRefresh.swift");
    fs.writeFileSync(script, stubs + "\n" + source + "\n" + exercise);
    const result = spawnSync(compiler.stdout.trim(), [script], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /FEED_REFRESH_OK/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
