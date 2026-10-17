const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Native Thumbnail-Geometrie begrenzt Crops und verwirft veraltete Bild-Rückgaben", {
  skip: process.platform !== "darwin", timeout: 70000,
}, t => {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  const app = path.join(__dirname, "../ios/Langform/Langform");
  const geometry = fs.readFileSync(path.join(app, "MotionGeometry.swift"), "utf8");
  const views = fs.readFileSync(path.join(app, "MotionViews.swift"), "utf8");
  const native = fs.readFileSync(path.join(app, "YouTubeWebView.swift"), "utf8");
  const asset = views.slice(views.indexOf("struct WatchThumbnailAsset {"), views.indexOf("/// Downloads only the still IMG asset"));
  const start = views.indexOf("final class WatchOpeningMotion {");
  assert.ok(start >= 0, "execute the production WatchOpeningMotion class");
  let depth = 1, end = views.indexOf("{", start) + 1;
  while (depth && end < views.length) {
    if (views[end] === "{") depth++;
    if (views[end] === "}") depth--;
    end++;
  }
  assert.equal(depth, 0, "complete production class");
  const scrollStart = native.indexOf("@objc private func playerScrollInteractionBegan(");
  assert.ok(scrollStart >= 0, "execute the production player scroll handler");
  let scrollDepth = 1, scrollEnd = native.indexOf("{", scrollStart) + 1;
  while (scrollDepth && scrollEnd < native.length) {
    if (native[scrollEnd] === "{") scrollDepth++;
    if (native[scrollEnd] === "}") scrollDepth--;
    scrollEnd++;
  }
  assert.equal(scrollDepth, 0, "complete player scroll handler");
  const scrollHandler = native.slice(scrollStart, scrollEnd).replace("@objc private func", "func");
  const posterStart = native.indexOf("private func showStartupPoster(");
  assert.ok(posterStart >= 0, "execute the production poster placement handler");
  let posterDepth = 1, posterEnd = native.indexOf("{", posterStart) + 1;
  while (posterDepth && posterEnd < native.length) {
    if (native[posterEnd] === "{") posterDepth++;
    if (native[posterEnd] === "}") posterDepth--;
    posterEnd++;
  }
  assert.equal(posterDepth, 0, "complete poster placement handler");
  const posterHandler = native.slice(posterStart, posterEnd).replace("private func", "func");
  function declaration(signature) {
    const start = native.indexOf(signature); assert.ok(start >= 0, signature);
    let depth = 1, end = native.indexOf("{", start) + 1;
    while (depth && end < native.length) { if (native[end] === "{") depth++; if (native[end] === "}") depth--; end++; }
    assert.equal(depth, 0);
    return native.slice(start, end).replace("private func", "func");
  }
  const feedResize = declaration("if feed.frame != bounds {");
  const geometryStart = native.indexOf('let viewport = CGSize(width: number("viewportWidth")', native.indexOf("private func takeVideoReport("));
  const geometryEnd = native.indexOf("\n        if mode != .loading", geometryStart);
  assert.ok(geometryStart >= 0 && geometryEnd > geometryStart, "execute actual viewport-acceptance block");
  const viewportPolicy = fs.readFileSync(path.join(app, "PlayerViewportPolicy.swift"), "utf8");

  // Execute the unchanged geometry and stateful helper, with minimal recording
  // stand-ins for UIKit/WebKit. This checks coordinates and callback ownership,
  // not rendering, animation performance or interaction on an iPhone.
  const stubs = `
enum YouTubeWebView {
    ${declaration("static func isYouTube(")}
    ${declaration("static func isWatchPage(")}
    ${declaration("static func videoID(")}
}
enum UIAccessibility { static var isReduceMotionEnabled = false }
class Layer { var cornerRadius: CGFloat = 0 }
class UIView {
    enum ContentMode { case scaleAspectFill }
    var frame = CGRect.zero, bounds = CGRect.zero
    var contentMode = ContentMode.scaleAspectFill
    var clipsToBounds = false, isUserInteractionEnabled = true, accessibilityElementsHidden = false
    var alpha: CGFloat = 1
    var transform = CGAffineTransform.identity
    let layer = Layer()
    weak var superview: UIView?
    var children: [UIView] = []
    static func performWithoutAnimation(_ block: () -> Void) { block() }
    func insertSubview(_ view: UIView, aboveSubview: UIView) {
        view.removeFromSuperview()
        let index = children.firstIndex { $0 === aboveSubview }.map { $0 + 1 } ?? children.count
        children.insert(view, at: index); view.superview = self
    }
    func removeFromSuperview() {
        superview?.children.removeAll { $0 === self }; superview = nil
    }
    func rootOrigin() -> CGPoint {
        var result = CGPoint.zero
        var current: UIView? = self
        while let view = current {
            result.x += view.frame.minX - view.bounds.minX
            result.y += view.frame.minY - view.bounds.minY
            current = view.superview
        }
        return result
    }
    func convert(_ rect: CGRect, to: UIView) -> CGRect {
        let origin = rootOrigin(), destination = to.rootOrigin()
        return rect.offsetBy(dx: origin.x - destination.x, dy: origin.y - destination.y)
    }
}
class UIImage { let name: String; init(_ name: String) { self.name = name } }
class UIImageView: UIView {
    let image: UIImage
    init(image: UIImage) { self.image = image; super.init() }
}
class UIPanGestureRecognizer {
    enum State { case possible, began, changed, ended, cancelled, failed }
    var state = State.possible
    var isEnabled = true
}
class ScrollView { var contentOffset = CGPoint.zero; let panGestureRecognizer = UIPanGestureRecognizer() }
class WatchThumbnailRequest {
    static var requests: [WatchThumbnailRequest] = []
    let asset: WatchThumbnailAsset
    let completion: (UIImage?) -> Void
    var cancelled = false
    init(asset: WatchThumbnailAsset, completion: @escaping (UIImage?) -> Void) {
        self.asset = asset; self.completion = completion
    }
    func start() { Self.requests.append(self) }
    func cancel() { cancelled = true }
}
class WKWebView: UIView {
    let scrollView = ScrollView()
    var url = URL(string: "https://m.youtube.com/")
    let requestOrigin = WatchThumbnailRequest.requests.count
    var requests: [WatchThumbnailRequest] { Array(WatchThumbnailRequest.requests.dropFirst(requestOrigin)) }
    func complete(_ index: Int, _ name: String?) {
        requests[index].completion(name.map { UIImage($0) })
    }
}
struct UISpringTimingParameters { init(dampingRatio: CGFloat) {} }
class UIViewPropertyAnimator {
    enum Position { case end }
    enum Curve { case easeOut }
    static var created: [UIViewPropertyAnimator] = []
    var stopped = false
    var isUserInteractionEnabled = true
    var actions: [() -> Void] = [], completions: [(Position) -> Void] = []
    init(duration: Double, timingParameters: UISpringTimingParameters) { Self.created.append(self) }
    init(duration: Double, curve: Curve, animations: @escaping () -> Void) { actions.append(animations); Self.created.append(self) }
    func addAnimations(_ action: @escaping () -> Void) { actions.append(action) }
    func addAnimations(_ action: @escaping () -> Void, delayFactor: CGFloat) { actions.append(action) }
    func addCompletion(_ action: @escaping (Position) -> Void) { completions.append(action) }
    func startAnimation() { actions.forEach { $0() } }
    func stopAnimation(_ immediately: Bool) { stopped = true }
    func finish() { completions.forEach { $0(.end) } }
}
`;
  const exercise = `
func expect(_ condition: Bool, _ message: String) {
    if !condition { print("FAILED: " + message); exit(1) }
}
let viewport = CGSize(width: 390, height: 844)
let coordinates: [String: Any] = ["x": 10, "y": 100, "width": 360, "height": 200,
                                  "viewportWidth": 390, "viewportHeight": 844]
let thumbnail: [String: Any] = ["url": "https://i.ytimg.com/vi/abcdefghijk/hq720.jpg", "videoID": "abcdefghijk"]
func changed(_ key: String, _ value: Any) -> [String: Any] {
    var result = coordinates; result[key] = value; return result
}
expect(MotionGeometry.thumbnail(coordinates, viewport: viewport) == CGRect(x: 10, y: 100, width: 360, height: 200),
       "ordinary CSS coordinates stay exact")
expect(MotionGeometry.thumbnail(coordinates, viewport: CGSize(width: 780, height: 1688)) == CGRect(x: 20, y: 200, width: 720, height: 400),
       "uniform native viewport scaling scales origin and size")
expect(MotionGeometry.thumbnail(changed("y", -40), viewport: viewport) == CGRect(x: 10, y: 0, width: 360, height: 160),
       "mostly visible thumbnail is clipped to viewport")
expect(MotionGeometry.thumbnail(changed("x", -60), viewport: viewport) == CGRect(x: 0, y: 100, width: 300, height: 200),
       "horizontal clipping stays inside viewport")
for key in coordinates.keys {
    for value in [Double.nan, Double.infinity, -Double.infinity] {
        expect(MotionGeometry.thumbnail(changed(key, value), viewport: viewport) == nil,
               "non-finite source value rejected: " + key)
    }
    expect(MotionGeometry.thumbnail(changed(key, "not a number"), viewport: viewport) == nil,
           "nonnumeric source value rejected: " + key)
    var missing = coordinates; missing.removeValue(forKey: key)
    expect(MotionGeometry.thumbnail(missing, viewport: viewport) == nil, "missing value rejected: " + key)
}
for (key, value) in [("x", 500), ("y", 900), ("y", -100), ("width", 40), ("height", 24),
                     ("width", 500), ("height", 900), ("viewportWidth", 0), ("viewportHeight", 40)] {
    expect(MotionGeometry.thumbnail(changed(key, value), viewport: viewport) == nil,
           "offscreen, mostly clipped, tiny or impossible crop rejected")
}
for invalid in [CGSize.zero, CGSize(width: 390, height: 600), CGSize(width: -390, height: 844),
                CGSize(width: CGFloat.nan, height: 844), CGSize(width: 390, height: CGFloat.infinity)] {
    expect(MotionGeometry.thumbnail(coordinates, viewport: invalid) == nil,
           "stale, zero, negative or non-finite native viewport rejected")
}
expect(MotionGeometry.thumbnail(nil, viewport: viewport) == nil, "absent tap geometry is optional")

func feed() -> WKWebView {
    let view = WKWebView(); view.bounds = CGRect(origin: .zero, size: viewport); return view
}
let destination = CGRect(x: 0, y: 0, width: 390, height: 220)
class ScrollStage: UIView {
  func cancelPendingMinimize() {}
    func finishFeedOpeningIfReady() {}
    enum Mode { case loading, expanded, mini, closed }
    var mode = Mode.expanded
    var player: WKWebView! = WKWebView()
    var feed: WKWebView? = WKWebView()
    let card = UIView()
    var videoRect = CGRect(x: 0, y: 0, width: 390, height: 220)
    var pictureRect: CGRect { videoRect }
    var hasVideoRect: Bool { videoRect.width > 8 && videoRect.height > 8 }
    struct StartupStatus { var keepsStartupPoster = true }
    var startupStatus = StartupStatus()
    let openingMotion = WatchOpeningMotion()
    ${scrollHandler}
    ${posterHandler}
}
class RotationStage: ScrollStage {
    func discardFeedOpening() {}
    var viewportGeneration = 0, playerLayoutSize = viewport
    var loadTicket = 1
    var videoSeekGeometry: (rect: CGRect, seek: CGRect, videoID: String, ticket: Int, viewport: Int)?
    var revealer: UIViewPropertyAnimator?, settler: UIViewPropertyAnimator?, dismisser: UIViewPropertyAnimator?
    var settlingBetweenModes = false, dragging = false, awaitingViewportGeometry = false
    var cropCorrection: PlayerViewportPolicy.SurfaceCorrection?
    var drag = UIPanGestureRecognizer(), edgeBack = UIPanGestureRecognizer(), cardTap = UIPanGestureRecognizer()
    var progress: CGFloat = 0
    var pendingRect: CGRect?, customFullscreenEnter: String?, customFullscreenExit: String?
    var cardMoving: Bool { dragging || settler != nil || revealer != nil || dismisser != nil }
    var dragPosition: PlayerGesturePolicy.Position? { mode == .mini ? .mini : (mode == .expanded ? .expanded : nil) }
    struct FeedMotion { func finish() {} }
    let feedMotion = FeedMotion()
    func endDrag() { dragging = false }
    func finishClose() { dismisser = nil }
    func apply(_ progress: CGFloat) {}
    var videoCropActive = false
    func beginVideoCrop() {}
    func restoreExpandedSurface() {}
    func finishMiniContext(preservingViewportCover: Bool = false) {}
    func holdMiniViewportPicture() {}
    func finishMiniViewportCover() {}
    func updateChrome() {}
    func resizeFeed() { guard let feed else { return }; ${feedResize} }
    ${declaration("private func stopReveal(")}
    ${declaration("private func resetPlayerForViewportChange(")}
    ${declaration("private func flushPendingRect(")}
    ${declaration("private func rememberVideoSeekGeometry(")}
    func reportGeometry(_ rect: CGRect, _ viewport: CGSize) {
        let id = "abcdefghijk"
        let dict: [String: Any] = ["playerVideoID": id, "hasVideo": true]
        let hasVideo = dict["hasVideo"] as? Bool == true
        let values: [String: CGFloat] = ["viewportWidth": viewport.width, "viewportHeight": viewport.height]
        func number(_ key: String) -> CGFloat { values[key] ?? 0 }
        ${native.slice(geometryStart, geometryEnd)}
    }
}
func reveal(_ motion: WatchOpeningMotion, _ source: WKWebView) -> UIView {
    let parent = UIView(), card = UIView()
    parent.insertSubview(card, aboveSubview: card)
    motion.reveal(in: parent, above: card, feed: source, destination: destination)
    return parent
}
func picture(_ parent: UIView) -> UIImageView? { parent.children.compactMap { $0 as? UIImageView }.first }

let motion = WatchOpeningMotion(), source = feed()
motion.prepare(thumbnail, videoID: "abcdefghijk", in: source)
expect(source.requests.count == 1 && source.requests[0].asset.url.absoluteString == thumbnail["url"] as! String,
       "the poster requests the exact validated IMG asset instead of capturing a media layer")
motion.prepare(thumbnail, videoID: "abcdefghijk", in: source)
source.complete(1, "current"); source.complete(0, "stale")
let parent = reveal(motion, source)
expect(picture(parent)?.image.name == "current", "older async image request cannot overwrite newer request")
expect(picture(parent)?.isUserInteractionEnabled == false && picture(parent)?.accessibilityElementsHidden == true,
       "decorative copy cannot intercept taps or accessibility")
expect(UIViewPropertyAnimator.created.isEmpty && picture(parent)?.alpha == 1,
       "the confirmed picture appears immediately with no decorative arrival motion")
motion.complete()
let oldAnimation = UIViewPropertyAnimator.created.last!
motion.prepare(thumbnail, videoID: "abcdefghijk", in: source)
expect(picture(parent) == nil && oldAnimation.stopped, "reopening removes the poster and stops its pending dissolve")
source.complete(2, "replacement")
let replacement = reveal(motion, source)
oldAnimation.finish()
expect(picture(replacement)?.image.name == "replacement", "late completion cannot remove a replacement poster")
expect(picture(replacement) != nil && picture(replacement)?.alpha == 1,
       "the static poster stays until a video picture exists")
motion.complete()
let dissolve = UIViewPropertyAnimator.created.last!
motion.complete()
expect(UIViewPropertyAnimator.created.last! === dissolve, "repeated media packets do not restart the poster fade")
expect(picture(replacement) != nil, "poster stays attached during its final dissolve")
dissolve.finish()
expect(picture(replacement) == nil, "video-picture completion releases the held poster")

let cancelled = WatchOpeningMotion(), cancelledSource = feed()
cancelled.prepare(thumbnail, videoID: "abcdefghijk", in: cancelledSource); cancelled.cancel(); cancelledSource.complete(0, "too late")
expect(picture(reveal(cancelled, cancelledSource)) == nil, "cancelled async image request cannot reappear")

for mutation in 0..<4 {
    let guarded = WatchOpeningMotion(), origin = feed()
    guarded.prepare(thumbnail, videoID: "abcdefghijk", in: origin); origin.complete(0, "before change")
    switch mutation {
    case 0: origin.scrollView.contentOffset.y += 3
    case 1: origin.scrollView.contentOffset.x += 3
    case 2: origin.url = URL(string: "https://m.youtube.com/feed/subscriptions")
    default: origin.bounds.size.height -= 40
    }
    expect(picture(reveal(guarded, origin)) == nil, "changed scroll, route or viewport invalidates a prepared crop")
}
let otherTab = WatchOpeningMotion(), origin = feed()
otherTab.prepare(thumbnail, videoID: "abcdefghijk", in: origin); origin.complete(0, "other tab")
expect(picture(reveal(otherTab, feed())) == nil, "same URL in a different feed cannot use a stale thumbnail")

let missing = WatchOpeningMotion(), missingSource = feed()
missing.prepare(thumbnail, videoID: "abcdefghijk", in: missingSource)
expect(picture(reveal(missing, missingSource)) == nil, "playback reveal never waits for pending image request")
missingSource.complete(0, "late")
expect(picture(reveal(missing, missingSource))?.image.name == "late", "pending image request can still provide a poster after early page paint")

let pendingScroll = ScrollStage(), pendingSource = feed()
var pendingCallbacks = 0
pendingScroll.openingMotion.prepare(thumbnail, videoID: "abcdefghijk", in: pendingSource) { pendingCallbacks += 1 }
let pendingPan = pendingScroll.player!.scrollView.panGestureRecognizer
pendingPan.state = .began
pendingScroll.playerScrollInteractionBegan(pendingPan)
pendingSource.complete(0, "image request after watch scroll")
expect(pendingCallbacks == 0 && picture(reveal(pendingScroll.openingMotion, pendingSource)) == nil,
       "watch scrolling cancels a pending crop and its stale callback cannot restore a poster")

let heldScroll = ScrollStage(), heldSource = feed()
heldScroll.openingMotion.prepare(thumbnail, videoID: "abcdefghijk", in: heldSource)
heldSource.complete(0, "held before first frame")
let heldParent = reveal(heldScroll.openingMotion, heldSource)
let heldPicture = picture(heldParent), animationsBeforeScroll = UIViewPropertyAnimator.created.count
let foreignPan = UIPanGestureRecognizer(); foreignPan.state = .began
heldScroll.playerScrollInteractionBegan(foreignPan)
expect(picture(heldParent) === heldPicture, "a different pan cannot clear the current watch poster")
let heldPan = heldScroll.player!.scrollView.panGestureRecognizer
for state in [UIPanGestureRecognizer.State.changed, .ended, .cancelled] {
    heldPan.state = state; heldScroll.playerScrollInteractionBegan(heldPan)
    expect(picture(heldParent) === heldPicture, "only a real scroll beginning removes the held picture")
}
heldScroll.mode = .mini; heldPan.state = .began; heldScroll.playerScrollInteractionBegan(heldPan)
expect(picture(heldParent) === heldPicture, "inactive mini-player page gestures do not alter decoration")
heldScroll.mode = .expanded; heldScroll.playerScrollInteractionBegan(heldPan)
expect(picture(heldParent) == nil && UIViewPropertyAnimator.created.count == animationsBeforeScroll,
       "scrolling the expanded watch page removes its fixed loading poster without a new animation")
heldSource.complete(0, "obsolete held image request")
expect(picture(reveal(heldScroll.openingMotion, heldSource)) == nil,
       "a callback retained before the scroll cannot recreate its stale image")

let placement = ScrollStage(), placementFeed = feed()
placement.feed = placementFeed
placement.bounds = CGRect(origin: .zero, size: viewport)
placement.card.frame = CGRect(x: 20, y: 30, width: 390, height: 844)
placement.insertSubview(placement.card, aboveSubview: placement.card)
let placementPlayer = placement.player!
placementPlayer.frame = CGRect(x: 9, y: 13, width: 390, height: 844)
placement.card.insertSubview(placementPlayer, aboveSubview: placementPlayer)
let startControl = UIView()
placement.card.insertSubview(startControl, aboveSubview: placementPlayer)
placement.insertSubview(placementFeed, aboveSubview: placement.card)
placement.openingMotion.prepare(thumbnail, videoID: "abcdefghijk", in: placementFeed)
placementFeed.complete(0, "controls-safe poster")
placement.mode = .loading; placement.showStartupPoster()
expect(picture(placement) == nil && picture(placement.card) == nil,
       "loading never enlarges the thumbnail in a provisional stage plane")
placement.videoRect = .zero
placement.mode = .expanded; placement.showStartupPoster()
expect(picture(placement.card) == nil, "fallback geometry cannot place the poster")
placement.videoRect = CGRect(x: 0, y: 0, width: 390, height: 220); placement.showStartupPoster()
let expandedPoster = picture(placement.card)
expect(picture(placement) == nil && expandedPoster != nil,
       "only the confirmed expanded video plane receives a poster")
expect(expandedPoster?.frame == placement.pictureRect.offsetBy(dx: 9, dy: 13),
       "expanded placement converts player-local geometry into card coordinates")
expect(placement.card.children.firstIndex { $0 === placementPlayer }! < placement.card.children.firstIndex { $0 === expandedPoster }! &&
       placement.card.children.firstIndex { $0 === expandedPoster }! < placement.card.children.firstIndex { $0 === startControl }!,
       "Start and Retry remain visibly above the held thumbnail, which only covers WebKit")
let placementAnimations = UIViewPropertyAnimator.created.count
placement.showStartupPoster()
expect(picture(placement.card) === expandedPoster && UIViewPropertyAnimator.created.count == placementAnimations,
       "identical picture reports preserve the exact same resting poster without restarting motion")
let originalPosterFrame = expandedPoster!.frame
placement.videoRect = CGRect(x: 0, y: 59, width: 390, height: 260)
placement.showStartupPoster()
expect(picture(placement.card) == nil && expandedPoster!.frame == originalPosterFrame,
       "a late safe-area/aspect change cancels the copy instead of jumping it to a new video box")
placement.showStartupPoster()
expect(picture(placement.card) == nil, "a cancelled geometry cannot recreate the old crop")

let reparented = WatchOpeningMotion(), reparentSource = feed()
reparented.prepare(thumbnail, videoID: "abcdefghijk", in: reparentSource); reparentSource.complete(0, "one plane")
let originalParent = reveal(reparented, reparentSource), originalPicture = picture(originalParent)
let otherParent = reveal(reparented, reparentSource)
expect(picture(originalParent) == nil && picture(otherParent) == nil && originalPicture?.frame == destination,
       "a different parent cannot promote and reposition an existing poster")

let alreadyPresented = ScrollStage(), presentedFeed = feed()
alreadyPresented.feed = presentedFeed; alreadyPresented.startupStatus.keepsStartupPoster = false
alreadyPresented.openingMotion.prepare(thumbnail, videoID: "abcdefghijk", in: presentedFeed); presentedFeed.complete(0, "late after first frame")
alreadyPresented.showStartupPoster()
expect(picture(alreadyPresented.card) == nil, "a late image request cannot cover an already presented video frame")

let rotating = RotationStage(), rotationFeed = feed()
rotating.player.url = URL(string: "https://m.youtube.com/watch?v=abcdefghijk")
rotating.feed = rotationFeed; rotating.bounds = CGRect(origin: .zero, size: viewport)
rotationFeed.frame = rotating.bounds
rotating.insertSubview(rotating.card, aboveSubview: rotating.card)
rotating.card.insertSubview(rotating.player, aboveSubview: rotating.player)
rotating.player.bounds = rotating.bounds
rotating.videoRect = CGRect(x: 0, y: 59, width: 390, height: 219)
rotating.openingMotion.prepare(thumbnail, videoID: "abcdefghijk", in: rotationFeed); rotationFeed.complete(0, "before rotation")
rotating.showStartupPoster()
let rotationPoster = picture(rotating.card), beforeRotationRect = rotationPoster!.frame
let rotationAnimations = UIViewPropertyAnimator.created.count
rotating.bounds = CGRect(x: 0, y: 0, width: 844, height: 390)
rotating.resizeFeed()
expect(picture(rotating.card) === rotationPoster, "resizing the feed cannot delete an active watch startup poster")
rotationFeed.bounds = rotating.bounds; rotating.playerLayoutSize = rotating.bounds.size
rotating.resetPlayerForViewportChange(); rotating.player.bounds = rotating.bounds
expect(picture(rotating.card) === rotationPoster && rotating.awaitingViewportGeometry && !rotating.hasVideoRect,
       "viewport reset retains the visible picture while it waits for new confirmed geometry")
rotationFeed.complete(0, "stale after viewport changed")
rotating.reportGeometry(CGRect(x: 0, y: 59, width: 390, height: 219), viewport)
expect(picture(rotating.card) === rotationPoster && rotationPoster!.frame == beforeRotationRect && rotating.awaitingViewportGeometry,
       "a queued portrait report cannot move or clear the retained landscape startup poster")
let landscapeRect = CGRect(x: 44, y: 0, width: 756, height: 390)
rotating.reportGeometry(landscapeRect, rotating.bounds.size)
expect(picture(rotating.card) === rotationPoster && rotationPoster!.image.name == "before rotation" && rotationPoster!.frame == landscapeRect,
       "the current landscape report lays out the same validated image in the final player plane")
expect(!rotating.awaitingViewportGeometry && UIViewPropertyAnimator.created.count == rotationAnimations,
       "rotation handoff adds no startup flight, fade or crop animation")
rotating.startupStatus.keepsStartupPoster = false; rotating.openingMotion.complete()
let rotationDissolve = UIViewPropertyAnimator.created.last!
rotating.resetPlayerForViewportChange()
expect(picture(rotating.card) == nil && rotationDissolve.stopped,
       "a poster already handed off to a frame is cancelled rather than resurrected by rotation")
rotationFeed.complete(0, "retired after frame")
rotating.videoRect = landscapeRect; rotating.showStartupPoster()
expect(picture(rotating.card) == nil, "late source callbacks cannot restore a completed rotated poster")

let pendingRotation = WatchOpeningMotion(), pendingRotationFeed = feed()
pendingRotation.prepare(thumbnail, videoID: "abcdefghijk", in: pendingRotationFeed); pendingRotation.viewportChanged()
pendingRotationFeed.complete(0, "unknown crop after resize")
expect(picture(reveal(pendingRotation, pendingRotationFeed)) == nil,
       "a image request not validated and shown before resize cannot be trusted after source geometry changed")

UIAccessibility.isReduceMotionEnabled = true
let reduced = WatchOpeningMotion(), reducedSource = feed()
reduced.prepare(thumbnail, videoID: "abcdefghijk", in: reducedSource)
expect(reducedSource.requests.count == 1, "reduced motion still prepares useful static loading content")
reducedSource.complete(0, "static")
let reducedParent = reveal(reduced, reducedSource)
expect(picture(reducedParent)?.frame == destination, "reduced motion places the poster directly at its stable destination")
reduced.complete()
expect(picture(reducedParent) == nil, "confirmed picture removes the reduced-motion poster immediately")
UIAccessibility.isReduceMotionEnabled = false
reduced.prepare(thumbnail, videoID: "abcdefghijk", in: reducedSource); reducedSource.complete(1, "before preference changed")
UIAccessibility.isReduceMotionEnabled = true
let changedPreference = reveal(reduced, reducedSource)
expect(picture(changedPreference)?.frame == destination, "live reduced-motion preference keeps a static loading picture")
reduced.reduceMotionChanged()
expect(picture(changedPreference)?.alpha == 1, "changing the preference stops decoration but retains loading content")
print("NATIVE_MOTION_GEOMETRY_OK")
`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-motion-geometry-"));
  try {
    const script = path.join(directory, "MotionGeometry.swift");
    fs.writeFileSync(script, geometry + "\n" + stubs + "\nenum PlayerGesturePolicy { enum Position { case mini, expanded } }\n" + viewportPolicy + "\n" + asset + "\n" + views.slice(start, end) + "\n" + exercise);
    const result = spawnSync(compiler.stdout.trim(), [script], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_MOTION_GEOMETRY_OK/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
