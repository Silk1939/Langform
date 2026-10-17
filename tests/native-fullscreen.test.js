const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function declaration(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  const open = source.indexOf('{', start);
  let end = open + 1, depth = 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  return source.slice(start, end);
}
function method(source, name) { return declaration(source, 'func ' + name + '('); }

test('Vollbild dreht nur den aktuellen Player und beendet den Modus bei Navigation ohne fremde Abschlüsse', {
  skip: process.platform !== 'darwin', timeout: 70000,
}, t => {
  const compiler = spawnSync('/usr/bin/xcrun', ['--find', 'swift'], { encoding: 'utf8' });
  if (compiler.status !== 0) return t.skip('Swift-Toolchain nicht verfügbar');
  const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/YouTubeWebView.swift'), 'utf8');
  const methods = ['pendingPhysicalFullscreenExitSource', 'cancelPendingMinimize', 'customFullscreenChanged', 'beginNativeRotation', 'cancelNativeRotation', 'confirmCustomFullscreenEnter', 'finishCustomFullscreenEnter', 'resetCustomFullscreen', 'beginCustomFullscreenExit', 'requestFullscreenExitPortrait', 'resumeFullscreenExitAfterInactivity', 'confirmCustomFullscreenExit', 'fullscreenChapterSnap', 'requestPlayerOrientation', 'cancelVideoProbeForInactivity', 'appBecameActive', 'openSearchInFeed', 'minimizePlayer', 'cancelPendingFeedSearch', 'activatePendingFeedSearch'].map(n => method(source, n)).join('\n');
  const controller = declaration(source, 'final class PlayerStageController:');
  const viewportPolicy = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/PlayerViewportPolicy.swift'), 'utf8');
  const rotationPolicy = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/PlayerRotationIntentPolicy.swift'), 'utf8');
  const exercise = `
import Foundation
import CoreGraphics
enum PlayerGesturePolicy { enum Position { case mini, expanded } }
${viewportPolicy}
${rotationPolicy}
enum StartupDiagnostics { static let enabled = false; static func videoMark(_ entry: [String: Any]) {}; static func mark(_ event: String) {} }
class UISelectionFeedbackGenerator { var selections = 0; var prepared = 0; func selectionChanged() { selections += 1 }; func prepare() { prepared += 1 } }
class UIApplication { enum State { case active, inactive }; static let shared=UIApplication(); var applicationState=State.active }
enum UIInterfaceOrientationMask { case portrait, landscape }
struct Geometry { let mask: UIInterfaceOrientationMask; static func iOS(interfaceOrientations: UIInterfaceOrientationMask) -> Geometry { Geometry(mask: interfaceOrientations) } }
enum Orientation { case portrait, landscape; var isPortrait: Bool { self == .portrait } }
class Scene { var requests: [UIInterfaceOrientationMask] = []; var interfaceOrientation = Orientation.portrait; var rejected = false; func requestGeometryUpdate(_ geometry: Geometry, errorHandler: (Error) -> Void) { requests.append(geometry.mask); if rejected { errorHandler(NSError(domain:"qa",code:1)) } } }
class RotationContext { var isCancelled = false }
class UIView { enum AnimationCurve { case easeIn,easeOut,easeInOut,linear }; static func performWithoutAnimation(_ block: () -> Void) { block() } }
class UIViewControllerTransitionCoordinator {
 var completions: [(RotationContext) -> Void] = [], context=RotationContext()
 var acceptsAnimations = true, completesImmediately = false, isAnimated = true
 var transitionDuration = 0.35, percentComplete = 0.0, completionCurve = UIView.AnimationCurve.easeInOut
 func animate(alongsideTransition: ((RotationContext) -> Void)?, completion: @escaping (RotationContext) -> Void) -> Bool { alongsideTransition?(context); completions.append(completion); if completesImmediately { completion(context) }; return acceptsAnimations }
 func finish() { completions.forEach { $0(context) } }
}
typealias Rotation = UIViewControllerTransitionCoordinator
class UIViewController {
 var view: PlayerStage?, forwardedSizes = [CGSize](), coordinatorPresentWhenForwarded = false
 func loadView() {}
 func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) { forwardedSizes.append(size); coordinatorPresentWhenForwarded = view?.activeRotationCoordinator === coordinator }
}
class Controller { var updates = 0; var transitionCoordinator: Rotation?; func setNeedsUpdateOfSupportedInterfaceOrientations() { updates += 1 } }
class Window { var windowScene: Scene? = Scene(); var rootViewController: Controller? = Controller() }
class Scroll { var offsets = 0; func setContentOffset(_ offset: CGPoint, animated: Bool) { offsets += 1 } }
class WKWebView { var url = URL(string: "https://m.youtube.com/watch?v=abcdefghijk"); var bounds = CGRect(x:0,y:0,width:390,height:844); var scripts: [String] = [], scrollView = Scroll(); var completions: [(Any?, Error?) -> Void] = []; func evaluateJavaScript(_ source: String, completionHandler: ((Any?, Error?) -> Void)? = nil) { scripts.append(source); if let completionHandler { completions.append(completionHandler) } } }
class Layer { var bounds=CGRect(x:0,y:0,width:390,height:844),position=CGPoint(x:195,y:422); func presentation() -> Layer? {nil} }
class Card { enum Transform { case offset, identity }; var transform = Transform.offset,layer=Layer();var bounds=CGRect(x:0,y:0,width:390,height:844),center=CGPoint(x:195,y:422) }
enum YouTubeWebView {
 static func videoID(_ url: URL?) -> String? {
   guard let url, ["m.youtube.com","youtube.com","www.youtube.com"].contains(url.host ?? ""), url.path == "/watch" else { return nil }
   return URLComponents(url: url,resolvingAgainstBaseURL:false)?.queryItems?.first { $0.name == "v" }?.value
 }
 ${declaration(source, 'static func dismantleUIViewController(')}
}
struct FeedState { let webView: WKWebView; var active = true }
class Stage {
  // Preference implementation is executed by motion-system.test.js.
  var motionSynchronizations = 0
  func motionPreferencesChanged() { motionSynchronizations += 1 }
  // Entry-admission ownership is exercised by native-player-interaction.test.js.
  // This fixture owns the adjacent lifecycle behavior, with no pending entry.
  func revokeFullscreenEntryAdmission() {}
    func recordBackgroundPlaybackTransition(_ phase: String) {}
    func watchBackgroundCategoryTransition(_ phase: String) {}
 var minimizeRequestTicket = 0, pendingMinimizeRequest: Int?
 enum Mode { case closed, loading, expanded, mini }
 var mode = Mode.expanded, dragging = false, playerFullscreen = false
 var progress = 0.5, card = Card(), appliedProgress: Double?
 var customFullscreenID: String?, player: WKWebView! = WKWebView(), window: Window? = Window()
 struct CustomFullscreenExit { let videoID: String; let token: String; let ticket: Int; var opensSearchInFeed = false; var allowsCurrentOrientation = false; var waitingForRotation = false; var preparedViewport: CGSize?; var sentViewport: CGSize?; var sourceViewport:CGSize?;var motionViewport:CGSize?;var motionGeneration:Int?;var motionReady=false;var preRotationMotion=false;var portraitRequested=false;var cancellingMotion=false;var rotationDeadlineMilliseconds:Double?;var rotationCSSCurve:String? }
 typealias CustomFullscreenEnter = CustomFullscreenExit
 var customFullscreenEnter: CustomFullscreenEnter?
 var customFullscreenExit: CustomFullscreenExit?, loadTicket = 0, measurements = 0, layouts = 0
 ${declaration(source, 'private struct PendingPhysicalFullscreenExit').replace('private struct', 'struct')}
 var pendingPhysicalFullscreenExit:PendingPhysicalFullscreenExit?
 var activeRotationCoordinator: UIViewControllerTransitionCoordinator?, nativeRotationGeneration = 0
 var rotationIntentPolicy = PlayerRotationIntentPolicy()
 func finishPhysicalRotationIntent() {}
 func clearWatchAudioIntent() {}
 var fullscreenCardRotationGeneration:Int?,nativeRotationTarget:CGSize?,nativeRotationDeadlineMilliseconds:Double?,nativeRotationCSSCurve:String?,fullscreenExitMotionTimeout:DispatchWorkItem?
 var bounds=CGRect(x:0,y:0,width:390,height:844)
 var fullscreenGeometryTrace: (videoID: String, token: String, ticket: Int, beganAt: TimeInterval, rows: Int)?
 var fullscreenGeometryDirection = "exit"
 let fullscreenSelectionFeedback = UISelectionFeedbackGenerator()
 var fullscreenSnapLastAt = -Double.infinity
 var events: [Bool] = [], freezeCount = 0, chromeUpdates = 0, expandedSurfaceRestores = 0
 var feedTabs = [String: FeedState](), feed: WKWebView!, initialPlaybackIntent: Int?, initialPlaybackCheckTicket: Int?, stops = 0
 var startupVideoID: String? = "abcdefghijk", playerOverlayOpen = false, pictureOnScreen = true, cardMoving = false, settlements = 0
 var pendingFeedSearch: (view: ObjectIdentifier, ticket: Int)?, feedSearchTicket = 0, feedSearchInFlight: Int?
 ${declaration(source, 'private var ownsWatchPlayer:').replace('private var', 'var')}
 func settle(_ target: Mode) { settlements += 1; mode = target; cardMoving = true }
 func feedState(for web: WKWebView) -> FeedState? { web === feed ? FeedState(webView: web) : nil }
 func dismissNativeSearch() {}
 lazy var onFullscreen: ((Bool) -> Void)? = { [weak self] in self?.events.append($0) }
 func freezeSettle() { cancelPendingMinimize(); freezeCount += 1 }; func freezeReveal() { freezeCount += 1 }; func updateChrome() { chromeUpdates += 1 }
 func apply(_ value: Double) { appliedProgress = value }
 func startFullscreenPresentation(videoID: String, token: String, direction: String) {}
 func setFeedActivity(_ web: WKWebView, active: Bool) {}; func updateMissingMediaTimeout() {}; func scheduleFeedPrewarm() {}; func cancelVideoProbe() {}
 // Staged WebKit motion/ACK are exercised separately in native-staged-fullscreen.test.js.
 // This orientation/transaction harness follows its explicit unsupported-motion fallback.
 func requestFullscreenExitMotion(viewport:CGSize,deadline:Double,curve:String?=nil) { customFullscreenExit?.sourceViewport=nil; customFullscreenExit?.preRotationMotion=false; requestFullscreenExitPortrait() }
 func releaseFullscreenExitViewport() { customFullscreenExit?.sourceViewport=nil }
 func cancelFullscreenExitMotion() { customFullscreenExit?.sourceViewport=nil }
 func stop() { stops += 1; resetCustomFullscreen() }
 func restoreExpandedSurface() { expect(progress == 0, "fullscreen clears mini crop only after returning expanded progress"); expandedSurfaceRestores += 1 }
 func measureVideo(after delay: Double, _ done: () -> Void) { measurements += 1; done() }; func setNeedsLayout() { layouts += 1 }
 ${methods}
}
typealias PlayerStage = Stage
${controller}
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }
func payload(_ open: Bool, _ id: String = "abcdefghijk", _ href: String? = nil) -> [String: Any] {
 ["open":open, "videoID":id, "href":href ?? "https://m.youtube.com/watch?v=" + id]
}
let stage = Stage()
stage.customFullscreenChanged(payload(true,"lmnopqrstuv"))
stage.customFullscreenChanged(payload(true,"abcdefghijk","https://example.com/watch?v=abcdefghijk"))
stage.customFullscreenChanged(["open":true])
expect(stage.events.isEmpty, "unknown or mismatched video cannot rotate or expand UI")
for mode in [Stage.Mode.closed, .loading, .mini] { stage.mode = mode; stage.customFullscreenChanged(payload(true)) }
stage.mode = .expanded; stage.dragging = true; stage.customFullscreenChanged(payload(true))
expect(stage.events.isEmpty, "hidden/loading/mini/dragging cannot enter fullscreen")
stage.dragging = false; stage.customFullscreenChanged(payload(true))
stage.customFullscreenChanged(payload(true))
expect(stage.events == [true] && stage.freezeCount == 2 && stage.playerFullscreen, "one accepted entry freezes motion once and expands safe area")
expect(stage.progress == 0 && stage.appliedProgress == 0 && stage.card.transform == .identity && stage.expandedSurfaceRestores == 1, "early fullscreen clears the existing mini crop once before rotating")
expect(stage.window!.windowScene!.requests == [.landscape], "entry requests supported UIKit landscape once")
func snapPayload(_ id: String = "abcdefghijk", _ href: String? = nil) -> [String: Any] {
 ["kind":"chapter-snap", "videoID":id, "href":href ?? "https://m.youtube.com/watch?v=" + id]
}
stage.fullscreenChapterSnap(snapPayload("lmnopqrstuv"))
stage.fullscreenChapterSnap(snapPayload("abcdefghijk", "https://example.com/watch?v=abcdefghijk"))
stage.dragging = true; stage.fullscreenChapterSnap(snapPayload()); stage.dragging = false
expect(stage.fullscreenSelectionFeedback.selections == 0, "stale, foreign and card-dragging snap messages cannot trigger haptics")
stage.fullscreenChapterSnap(snapPayload()); stage.fullscreenChapterSnap(snapPayload())
expect(stage.fullscreenSelectionFeedback.selections == 1, "active fullscreen produces one detent, rapid duplicate does not buzz repeatedly")
stage.fullscreenSnapLastAt = -Double.infinity; stage.fullscreenChapterSnap(snapPayload())
expect(stage.fullscreenSelectionFeedback.selections == 2, "later marker entry is ready for another detent")
stage.customFullscreenChanged(payload(false,"lmnopqrstuv"))
expect(stage.customFullscreenID == "abcdefghijk", "stale close never removes current fullscreen")
stage.player!.url = URL(string:"https://m.youtube.com/watch?v=lmnopqrstuv")
stage.customFullscreenChanged(payload(false))
expect(stage.events == [true,false] && !stage.playerFullscreen && stage.customFullscreenID == nil, "originating document may close its own mode after changing route")
expect(stage.window!.windowScene!.requests == [.landscape,.portrait], "exit restores portrait once")
stage.fullscreenChapterSnap(snapPayload())
expect(stage.fullscreenSelectionFeedback.selections == 2, "closed fullscreen cannot produce marker haptics")
stage.resetCustomFullscreen(); stage.customFullscreenChanged(payload(false))
expect(stage.events.count == 2, "duplicate cleanup has no effects")
stage.window = nil; stage.customFullscreenChanged(payload(true,"lmnopqrstuv"))
expect(stage.customFullscreenID == "lmnopqrstuv", "in-page UI remains usable when no scene can rotate")
stage.resetCustomFullscreen()

let handoff = Stage()
handoff.customFullscreenChanged(payload(true))
handoff.player!.bounds = CGRect(x:0,y:0,width:844,height:390)
handoff.window!.windowScene!.interfaceOrientation = .landscape
func exitRequest(_ token: String) -> [String: Any] { ["kind":"exit-request", "videoID":"abcdefghijk", "href":"https://m.youtube.com/watch?v=abcdefghijk", "token":token] }
handoff.beginCustomFullscreenExit(exitRequest("1"))
expect(handoff.events == [true,false] && handoff.customFullscreenID != nil && handoff.playerFullscreen, "status bar restores at exit request while native fullscreen ownership remains")
expect(handoff.player!.scripts.isEmpty, "old landscape bounds do not confirm inline geometry")
handoff.beginCustomFullscreenExit(exitRequest("duplicate"))
expect(handoff.customFullscreenExit!.token == "1" && handoff.events == [true,false], "duplicate request cannot replace the active exit")
let rotation = Rotation()
handoff.beginNativeRotation(to: CGSize(width:390,height:844), coordinator: rotation)
expect(handoff.player!.bounds.size == CGSize(width:844,height:390) && handoff.activeRotationCoordinator === rotation && handoff.player!.scripts.isEmpty, "owning controller delivers coordinator before WebKit destination bounds; old landscape cannot prepare portrait")
handoff.window!.windowScene!.interfaceOrientation = .portrait
handoff.player!.bounds = CGRect(x:0,y:0,width:390,height:844)
handoff.confirmCustomFullscreenExit()
expect(handoff.player!.scripts.count == 1 && handoff.player!.scripts[0].contains("prepareExit.apply") && handoff.customFullscreenExit!.waitingForRotation, "portrait bounds prepare the owned live-node motion within UIKit rotation without final release")
handoff.confirmCustomFullscreenExit()
expect(handoff.player!.scripts.count == 1, "repeated rotation layout prepares the same viewport once")
rotation.finish()
expect(handoff.activeRotationCoordinator == nil && handoff.player!.scripts.count == 2 && handoff.player!.scripts[1].contains("finishExit.apply"), "actual completed rotation releases its transient coordinator and confirms the destination to WebKit")
handoff.confirmCustomFullscreenExit()
expect(handoff.player!.scripts.count == 2, "the same viewport is confirmed once")
var commit = payload(false); commit["kind"] = "exit-commit"; commit["token"] = "stale"
handoff.customFullscreenChanged(commit)
expect(handoff.customFullscreenID != nil, "a stale geometry commit cannot release ownership")
commit["token"] = "1"; handoff.customFullscreenChanged(commit)
expect(handoff.customFullscreenID == nil && handoff.customFullscreenExit == nil && !handoff.playerFullscreen, "matching WebKit commit returns inline ownership")
expect(handoff.events == [true,false] && handoff.window!.windowScene!.requests == [.landscape,.portrait], "commit does not restore status bar or request portrait a second time")
expect(handoff.measurements == 1, "inline geometry is measured after its confirmed handoff")
rotation.finish(); expect(handoff.player!.scripts.count == 2, "late native completion cannot affect a finished exit")

func searchStage() -> Stage {
 let result = Stage(); result.feed = WKWebView(); result.feed.url = URL(string:"https://m.youtube.com/")
 result.customFullscreenChanged(payload(true)); return result
}
func searchRequest(_ token: String) -> [String: Any] { var request = exitRequest(token); request["action"] = "search"; return request }
func searchCommit(_ token: String) -> [String: Any] { var result = payload(false); result["kind"] = "exit-commit"; result["token"] = token; return result }
let search = searchStage()
let mediaOwner = search.player!, mediaURL = mediaOwner.url
search.beginCustomFullscreenExit(searchRequest("search"))
expect(search.customFullscreenExit?.opensSearchInFeed == true && search.feed.scripts.isEmpty && search.settlements == 0, "search intent belongs to the exit token and cannot minimize or invoke feed before commit")
search.beginCustomFullscreenExit(searchRequest("duplicate-search"))
search.customFullscreenChanged(searchCommit("stale"))
expect(search.customFullscreenExit?.token == "search" && search.feed.scripts.isEmpty && search.settlements == 0, "duplicate and stale search requests cannot trigger the feed")
search.customFullscreenChanged(searchCommit("search"))
expect(search.mode == .mini && search.settlements == 1 && search.player === mediaOwner && search.player.url == mediaURL, "committed fullscreen search uses the shipping Mini path with the retained Watch instance and route")
expect(search.customFullscreenID == nil && !search.playerFullscreen && search.pendingFeedSearch != nil && search.feedSearchInFlight == nil, "native fullscreen ownership is reset before preparing feed search")
expect(search.feed.scripts.count == 1 && search.feed.scripts[0].contains("__langformCancelSearch") && search.player.scrollView.offsets == 0 && search.feed.scrollView.offsets == 0, "neither live Watch nor Feed is navigated or scrolled and moving Mini has not yet invoked search")
search.cardMoving = false; search.activatePendingFeedSearch()
expect(search.feed.scripts.count == 2 && search.feed.scripts[1].contains("__langformOpenSearch(") && search.feedSearchInFlight != nil, "after Mini settles the existing real YouTube feed-search API runs only in the Feed")
search.customFullscreenChanged(searchCommit("search")); search.activatePendingFeedSearch()
expect(search.settlements == 1 && search.feed.scripts.count == 2, "duplicate commit or activation cannot repeat the transition or actual search")

let normal = searchStage(); normal.beginCustomFullscreenExit(exitRequest("normal"))
var forged = searchCommit("normal"); forged["action"] = "search"; normal.customFullscreenChanged(forged)
expect(normal.mode == .expanded && normal.feed.scripts.isEmpty && normal.pendingFeedSearch == nil, "a normal exit cannot acquire a search action at commit")
for reason in ["navigation", "inactive", "exit-layout-timeout", "bridge-unavailable"] {
 let cancelled = searchStage(); cancelled.beginCustomFullscreenExit(searchRequest("cancelled"))
 var abort = payload(false); abort["reason"] = reason; cancelled.customFullscreenChanged(abort)
 cancelled.customFullscreenChanged(searchCommit("cancelled"))
 expect(cancelled.feed.scripts.isEmpty && cancelled.settlements == 0 && cancelled.pendingFeedSearch == nil, "aborted search exits never invoke feed; late commits remain inert")
}
let obsolete = searchStage(); obsolete.beginCustomFullscreenExit(searchRequest("obsolete")); obsolete.loadTicket += 1; obsolete.customFullscreenChanged(searchCommit("obsolete"))
expect(obsolete.feed.scripts.isEmpty && obsolete.settlements == 0, "a superseded load ticket cannot dispatch the previous search")
let otherVideo = searchStage(); otherVideo.beginCustomFullscreenExit(searchRequest("other-video")); otherVideo.player.url = URL(string:"https://m.youtube.com/watch?v=lmnopqrstuv"); otherVideo.startupVideoID = "lmnopqrstuv"; otherVideo.customFullscreenChanged(searchCommit("other-video"))
expect(otherVideo.feed.scripts.isEmpty && otherVideo.settlements == 0, "a newly owned video cannot inherit the previous video's fullscreen search action")
let noFeed = Stage(); noFeed.customFullscreenChanged(payload(true)); noFeed.beginCustomFullscreenExit(searchRequest("no-feed")); noFeed.customFullscreenChanged(searchCommit("no-feed"))
expect(noFeed.mode == .expanded && noFeed.settlements == 0, "missing retained feed leaves the live player expanded instead of inventing search navigation")

let rejected = Stage(); rejected.customFullscreenChanged(payload(true))
rejected.player!.bounds = CGRect(x:0,y:0,width:844,height:390)
rejected.window!.windowScene!.interfaceOrientation = .landscape
rejected.window!.windowScene!.rejected = true
rejected.beginCustomFullscreenExit(exitRequest("2"))
expect(rejected.customFullscreenExit!.allowsCurrentOrientation && rejected.player!.scripts.count == 1, "a rejected rotation explicitly confirms stable current bounds instead of stranding fullscreen")
let superseded = Stage(); superseded.customFullscreenChanged(payload(true)); superseded.player!.bounds = CGRect(x:0,y:0,width:844,height:390); superseded.window!.windowScene!.interfaceOrientation = .landscape
superseded.beginCustomFullscreenExit(exitRequest("3")); superseded.loadTicket += 1
superseded.player!.bounds = CGRect(x:0,y:0,width:390,height:844); superseded.window!.windowScene!.interfaceOrientation = .portrait
superseded.confirmCustomFullscreenExit()
expect(superseded.player!.scripts.isEmpty, "a superseded navigation ticket never confirms an old document")

func entryRequest(_ token: String) -> [String: Any] { ["kind":"enter-request", "open":true, "videoID":"abcdefghijk", "href":"https://m.youtube.com/watch?v=abcdefghijk", "token":token] }
func entryCommit(_ token: String) -> [String: Any] { ["kind":"enter-commit", "open":true, "videoID":"abcdefghijk", "href":"https://m.youtube.com/watch?v=abcdefghijk", "token":token] }
let firstEntry = Stage()
firstEntry.customFullscreenChanged(entryRequest("entry-1"))
expect(firstEntry.customFullscreenEnter != nil && firstEntry.playerFullscreen && firstEntry.player!.scripts.isEmpty, "first entry holds native ownership without committing old portrait bounds")
let enteringRotation = Rotation()
firstEntry.beginNativeRotation(to: CGSize(width:844,height:390), coordinator: enteringRotation)
expect(firstEntry.player!.scripts.isEmpty && firstEntry.player!.bounds.width == 390, "entry coordinator arrives at old portrait bounds before layout")
firstEntry.player!.bounds = CGRect(x:0,y:0,width:844,height:390)
firstEntry.confirmCustomFullscreenEnter()
expect(firstEntry.player!.scripts.count == 1 && firstEntry.player!.scripts[0].contains("prepareEnter.apply"), "landscape destination starts the live handoff during UIKit rotation")
expect(firstEntry.customFullscreenEnter!.waitingForRotation && firstEntry.events == [true], "entry preparation cannot restore status bar or release native ownership")
firstEntry.confirmCustomFullscreenEnter(); expect(firstEntry.player!.scripts.count == 1,"same entry viewport prepares once")
firstEntry.window!.windowScene!.interfaceOrientation = .landscape
enteringRotation.finish()
expect(firstEntry.player!.scripts.count == 2 && firstEntry.player!.scripts[1].contains("finishEnter.apply"), "only completed native rotation authorizes final entry release")
firstEntry.finishCustomFullscreenEnter(entryCommit("old"));expect(firstEntry.customFullscreenEnter != nil,"stale entry commit cannot release geometry latch")
firstEntry.finishCustomFullscreenEnter(entryCommit("entry-1"))
expect(firstEntry.customFullscreenEnter == nil && firstEntry.playerFullscreen && firstEntry.customFullscreenID != nil && firstEntry.events == [true], "matching entry commit keeps fullscreen while releasing its geometry latch")
expect(firstEntry.measurements == 1,"entry remeasures the real fullscreen video after fixed-node release")
enteringRotation.finish();expect(firstEntry.player!.scripts.count == 2,"stale UIKit entry completion cannot recommit")

let rejectedEntry = Stage(); rejectedEntry.window!.windowScene!.rejected = true
rejectedEntry.customFullscreenChanged(entryRequest("entry-rejected"))
expect(rejectedEntry.customFullscreenEnter!.allowsCurrentOrientation && rejectedEntry.player!.scripts.count == 1 && rejectedEntry.player!.scripts[0].contains("finishEnter.apply"),"rejected orientation confirms current stable bounds instead of stranding fixed inline picture")

let lateEntry = Stage();lateEntry.customFullscreenChanged(entryRequest("late-entry"))
let lateEntryRotation=Rotation();lateEntryRotation.transitionDuration=0
lateEntry.beginNativeRotation(to:CGSize(width:844,height:390),coordinator:lateEntryRotation)
lateEntryRotation.finish()
expect(lateEntry.player!.scripts.isEmpty && lateEntry.customFullscreenEnter!.rotationDeadlineMilliseconds != nil,"finished rotation retains request-bound timing while WK still has portrait bounds")
lateEntry.player!.bounds=CGRect(x:0,y:0,width:844,height:390);lateEntry.window!.windowScene!.interfaceOrientation = .landscape;lateEntry.confirmCustomFullscreenEnter()
let lateArguments=try!JSONSerialization.jsonObject(with:Data(lateEntry.player!.scripts.last!.components(separatedBy:"null, ")[1].dropLast().utf8)) as! [Any]
expect(lateArguments.count==6 && (lateArguments[4] as! Double)<=Date().timeIntervalSince1970*1000 && lateArguments[5] as? String=="cubic-bezier(.42,0,.58,1)","late finishEnter carries elapsed actual deadline/curve so JS cannot restart a post-rotation tween")

let cancelledEntry = Stage(); cancelledEntry.customFullscreenChanged(entryRequest("entry-cancel"))
cancelledEntry.player!.bounds = CGRect(x:0,y:0,width:844,height:390)
let cancelledRotation = Rotation();cancelledEntry.beginNativeRotation(to: CGSize(width:844,height:390), coordinator: cancelledRotation)
cancelledEntry.confirmCustomFullscreenEnter();cancelledEntry.resetCustomFullscreen();cancelledRotation.finish()
expect(cancelledEntry.customFullscreenEnter == nil && cancelledEntry.player!.scripts.count == 1,"page departure revokes pending entry and stale native completion")

let reverseEntry = Stage();reverseEntry.customFullscreenChanged(entryRequest("entry-reverse"))
reverseEntry.beginCustomFullscreenExit(exitRequest("exit-reverse"))
expect(reverseEntry.customFullscreenEnter == nil && reverseEntry.customFullscreenExit != nil && reverseEntry.events == [true,false],"exit during first entry transfers native ownership to the current exit token")
reverseEntry.finishCustomFullscreenEnter(entryCommit("entry-reverse"))
expect(reverseEntry.customFullscreenExit != nil,"stale entry ACK cannot clear the current exit")

let ticketEntry = Stage();ticketEntry.customFullscreenChanged(entryRequest("entry-ticket"));ticketEntry.loadTicket += 1
ticketEntry.player!.bounds = CGRect(x:0,y:0,width:844,height:390);ticketEntry.window!.windowScene!.interfaceOrientation = .landscape
ticketEntry.confirmCustomFullscreenEnter();ticketEntry.finishCustomFullscreenEnter(entryCommit("entry-ticket"))
expect(ticketEntry.player!.scripts.isEmpty && ticketEntry.customFullscreenEnter != nil,"superseded native ticket rejects both entry viewport and commit")

let owner = PlayerStageController();owner.loadView()
owner.stage.customFullscreenChanged(entryRequest("owned-entry"))
let ownerRotation=Rotation()
owner.viewWillTransition(to:CGSize(width:844,height:390),with:ownerRotation)
expect(owner.view === owner.stage && owner.forwardedSizes == [CGSize(width:844,height:390)] && owner.coordinatorPresentWhenForwarded,"shipping controller owns Stage and forwards UIKit transition after exposing coordinator")
expect(owner.stage.player!.bounds.width==390 && owner.stage.player!.scripts.isEmpty,"viewWillTransition leaves source WK viewport untouched before layout")
owner.stage.player!.bounds=CGRect(x:0,y:0,width:844,height:390);owner.stage.confirmCustomFullscreenEnter()
owner.stage.window!.windowScene!.interfaceOrientation = .landscape;ownerRotation.finish()
expect(owner.stage.player!.scripts.count==2 && owner.stage.activeRotationCoordinator==nil,"controller-owned coordinator completes one actual entry")

let reversing=Stage();reversing.customFullscreenChanged(entryRequest("first-entry"))
let forward=Rotation();reversing.beginNativeRotation(to:CGSize(width:844,height:390),coordinator:forward)
reversing.player!.bounds=CGRect(x:0,y:0,width:844,height:390);reversing.confirmCustomFullscreenEnter()
reversing.window!.windowScene!.interfaceOrientation = .landscape
reversing.beginCustomFullscreenExit(exitRequest("opposite-exit"))
expect(reversing.customFullscreenExit!.waitingForRotation || reversing.customFullscreenExit!.sourceViewport != nil,"opposite pending request respects rotation or staged source-viewport ownership")
forward.finish()
expect(reversing.player!.scripts.count==1 && reversing.customFullscreenExit != nil && !reversing.customFullscreenExit!.waitingForRotation,"old entry completion clears only the ended rotation hold and never finishes a newer exit token")
reversing.confirmCustomFullscreenExit()
expect(reversing.player!.scripts.count==1,"old landscape orientation cannot finish the opposite portrait request")
let backward=Rotation();reversing.beginNativeRotation(to:CGSize(width:390,height:844),coordinator:backward)
reversing.player!.bounds=CGRect(x:0,y:0,width:390,height:844);reversing.window!.windowScene!.interfaceOrientation = .portrait;reversing.confirmCustomFullscreenExit()
backward.finish();expect(reversing.player!.scripts.count==3 && reversing.player!.scripts.last!.contains("finishExit"),"opposite request completes from its own portrait rotation")

let replaced=Stage();replaced.customFullscreenChanged(entryRequest("replacement"))
let staleRotation=Rotation(),currentRotation=Rotation()
replaced.beginNativeRotation(to:CGSize(width:844,height:390),coordinator:staleRotation)
replaced.beginNativeRotation(to:CGSize(width:844,height:390),coordinator:currentRotation)
replaced.player!.bounds=CGRect(x:0,y:0,width:844,height:390);replaced.window!.windowScene!.interfaceOrientation = .landscape;replaced.confirmCustomFullscreenEnter()
staleRotation.finish()
expect(replaced.activeRotationCoordinator === currentRotation && replaced.customFullscreenEnter!.waitingForRotation && replaced.player!.scripts.count==1,"stale coordinator cannot release replacement rotation ownership")
currentRotation.finish();expect(replaced.activeRotationCoordinator==nil && replaced.player!.scripts.count==2,"replacement finishes exactly its current transaction")

for changesTicket in [false,true] {
 let staleIdentity=Stage();staleIdentity.customFullscreenChanged(entryRequest("identity"))
 let identityRotation=Rotation();staleIdentity.beginNativeRotation(to:CGSize(width:844,height:390),coordinator:identityRotation)
 staleIdentity.player!.bounds=CGRect(x:0,y:0,width:844,height:390);staleIdentity.window!.windowScene!.interfaceOrientation = .landscape;staleIdentity.confirmCustomFullscreenEnter()
 if changesTicket {staleIdentity.loadTicket += 1} else {staleIdentity.player!.url=URL(string:"https://m.youtube.com/watch?v=lmnopqrstuv")}
 identityRotation.finish()
 expect(staleIdentity.activeRotationCoordinator==nil && staleIdentity.player!.scripts.count==1,"changed ticket/video retires coordinator without finishing an obsolete document")
}

let refused=Stage();refused.customFullscreenChanged(entryRequest("no-queued-animation"))
let refusedRotation=Rotation();refusedRotation.acceptsAnimations=false
refused.beginNativeRotation(to:CGSize(width:844,height:390),coordinator:refusedRotation)
refused.player!.bounds=CGRect(x:0,y:0,width:844,height:390);refused.window!.windowScene!.interfaceOrientation = .landscape;refused.confirmCustomFullscreenEnter()
expect(refused.activeRotationCoordinator === refusedRotation && refused.player!.scripts.count==1,"animate false does not imply actual rotation has completed")
refusedRotation.finish();expect(refused.activeRotationCoordinator==nil && refused.player!.scripts.count==2,"completion still releases rotation when animations could not queue")

let zero=Stage();zero.customFullscreenChanged(entryRequest("zero"));zero.player!.bounds=CGRect(x:0,y:0,width:844,height:390);zero.window!.windowScene!.interfaceOrientation = .landscape
let zeroRotation=Rotation();zeroRotation.transitionDuration=0;zeroRotation.completesImmediately=true
zero.beginNativeRotation(to:CGSize(width:844,height:390),coordinator:zeroRotation)
expect(zero.activeRotationCoordinator==nil && zero.player!.scripts.count==2 && !zero.customFullscreenEnter!.waitingForRotation,"synchronous zero-duration completion does not strand ownership")

let tornDown=Stage();tornDown.customFullscreenChanged(entryRequest("teardown"))
let tornRotation=Rotation();tornDown.beginNativeRotation(to:CGSize(width:844,height:390),coordinator:tornRotation)
tornDown.cancelNativeRotation();tornDown.player!.bounds=CGRect(x:0,y:0,width:844,height:390);tornDown.window!.windowScene!.interfaceOrientation = .landscape;tornRotation.finish()
expect(tornDown.activeRotationCoordinator==nil && !tornDown.customFullscreenEnter!.waitingForRotation && tornDown.player!.scripts.isEmpty,"teardown releases coordinator and revokes its queued completion")
let dismantled = PlayerStageController();dismantled.stage.customFullscreenChanged(entryRequest("dismantle"))
let dismantleRotation=Rotation();dismantled.stage.beginNativeRotation(to:CGSize(width:844,height:390),coordinator:dismantleRotation)
YouTubeWebView.dismantleUIViewController(dismantled, coordinator: ())
dismantleRotation.finish()
expect(dismantled.stage.stops==1 && dismantled.stage.activeRotationCoordinator==nil && dismantled.stage.customFullscreenEnter==nil && dismantled.stage.player!.scripts.isEmpty,"shipping representable teardown calls Stage.stop and invalidates pending rotation")

let inactive = Stage();inactive.customFullscreenChanged(entryRequest("inactive"))
let inactiveRotation=Rotation();inactive.beginNativeRotation(to:CGSize(width:844,height:390),coordinator:inactiveRotation)
inactive.player!.bounds=CGRect(x:0,y:0,width:844,height:390);inactive.window!.windowScene!.interfaceOrientation = .landscape;inactive.confirmCustomFullscreenEnter()
inactive.initialPlaybackIntent=1;inactive.initialPlaybackCheckTicket=1
inactive.cancelVideoProbeForInactivity();inactiveRotation.finish()
expect(inactive.activeRotationCoordinator==nil && !inactive.customFullscreenEnter!.waitingForRotation && inactive.initialPlaybackIntent==nil && inactive.player!.scripts.count==1,"inactivity releases owned rotation and prevents obsolete completion from finishing")
inactive.appBecameActive()
expect(inactive.motionSynchronizations==1,"foreground also refreshes current motion preferences")
expect(inactive.player!.scripts.count==2 && inactive.player!.scripts.last!.contains("finishEnter"),"resume confirms actual current orientation without holding a departed coordinator")

weak var rotationStage:Stage?
let lifetimeRotation=Rotation()
do {let ephemeral=Stage();rotationStage=ephemeral;ephemeral.beginNativeRotation(to:CGSize(width:844,height:390),coordinator:lifetimeRotation)}
expect(rotationStage==nil,"native coordinator completion retains no Stage");lifetimeRotation.finish()
print("NATIVE_FULLSCREEN_OK")
`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-fullscreen-test-'));
  try {
    const file = path.join(directory, 'Fullscreen.swift');
    fs.writeFileSync(file, exercise);
    const result = spawnSync(compiler.stdout.trim(), [file], { encoding: 'utf8', timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_FULLSCREEN_OK/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
