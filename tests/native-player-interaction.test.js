const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Compile the shipping delegate and pan callbacks against small UIKit input
// stubs. This tests admission/state decisions, not UIKit timing or physical taps.
function method(source, name) {
  const start = source.indexOf("func " + name + "(");
  assert.ok(start >= 0, name);
  const open = source.indexOf("{", start);
  let depth = 1, end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
    end++;
  }
  const prefix = name === "gestureRecognizerShouldBegin" ? "override " : "";
  return prefix + source.slice(start, end);
}

function block(source, label) {
  const start=source.indexOf(label); if(start<0)return '';
  const open=source.indexOf('{',start);let depth=1,end=open+1;
  while(depth && end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}
  assert.equal(depth,0,label);return source.slice(start,end);
}

test("Native Player übernimmt Reveal sofort und konsumiert Vollbild-Ausgang ohne Minimieren", {
  skip: process.platform !== "darwin", timeout: 70000,
}, function (t) {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  const app = path.join(__dirname, "../ios/Langform/Langform");
  const source = fs.readFileSync(path.join(app, "YouTubeWebView.swift"), "utf8");
  const policy = fs.readFileSync(path.join(app, "PlayerGesturePolicy.swift"), "utf8");
  const callbacks = ["gestureRecognizerShouldBegin", "dragPlayer", "follow", "edgeBackDragged", "acceptsFullscreenEntry", "fullscreenEntryBinding", "fullscreenEntryAdmissionIsCurrent", "revokeFullscreenEntryAdmission", "endDrag", "enterFullscreenFromSwipe"].map(name => method(source, name)).join("\n");
  const admission = block(source, "private struct FullscreenEntryAdmission").replace("private ", "");
  const stateAllows = block(source, "private var fullscreenEntryStateAllows").replace("private ", "");
  assert.ok(admission && stateAllows, "compile the actual admission binding and current-state gate");
  // Extract only the admission-relevant statements from the real successful
  // close/load/stop paths, preserving their shipping order. Other lifecycle
  // subsystems remain outside this small input-state fixture.
  const lifecycle = ["stop", "openWatch", "closePlayer"].map(name => {
    const body = method(source, name);
    const rows = body.match(/^\s*(?:revokeFullscreenEntryAdmission\(\)|endDrag\(\)|loadTicket \+= 1|mode = \.closed|startupVideoID = (?:loadingVideoID|nil)|player = nil)\s*$/gm) || [];
    const expected = {
      stop: ["endDrag()", "revokeFullscreenEntryAdmission()", "loadTicket += 1", "mode = .closed", "player = nil"],
      openWatch: ["revokeFullscreenEntryAdmission()", "loadTicket += 1", "startupVideoID = loadingVideoID", "endDrag()"],
      closePlayer: ["revokeFullscreenEntryAdmission()", "loadTicket += 1", "mode = .closed", "endDrag()", "startupVideoID = nil"],
    };
    assert.deepEqual(rows.map(row => row.trim()), expected[name], name + " lifecycle order is taken from shipping");
    return "func admissionCleanup_" + name + "() {\n" + rows.join("\n") + "\n}";
  }).join("\n");
  const exercise = `
import Foundation
import CoreGraphics
class UIApplication { enum State { case active, inactive }; static let shared = UIApplication(); var applicationState = State.active }
class UIGestureRecognizer { enum State: Int { case possible, began, changed, ended, cancelled, failed }; var state = State.possible }
class UIPanGestureRecognizer: UIGestureRecognizer {
  var delta = CGPoint.zero, speed = CGPoint.zero, cancelsTouchesInView = false
  func translation(in: Any) -> CGPoint { delta }
  func velocity(in: Any) -> CGPoint { speed }
}
class UIScreenEdgePanGestureRecognizer: UIPanGestureRecognizer {}
class Base { func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool { true } }
class Web {
 var url: URL? = URL(string: "https://m.youtube.com/watch?v=abcdefghijk"), scripts: [String] = []
 func evaluateJavaScript(_ script: String) { scripts.append(script) }
}
enum YouTubeWebView {
 static func isWatchPage(_ url: URL?) -> Bool { url?.path == "/watch" }
 static func videoID(_ url: URL?) -> String? { URLComponents(url:url!,resolvingAgainstBaseURL:false)?.queryItems?.first(where:{$0.name=="v"})?.value }
}
enum StartupDiagnostics {
  static let enabled = false
  static func mark(_ e: String, once: Bool = false, documentMilliseconds: Double? = nil) {}
  static func videoMark(_ entry: [String: Any]) {}
}
enum UIView { static func performWithoutAnimation(_ block: () -> Void) { block() } }
class Card { var transform = CGAffineTransform.identity }
class Stage: Base {
  ${admission}
  var fullscreenEntryAdmission: FullscreenEntryAdmission?
  var fullscreenEntryAdmissionRevoked = false
  ${stateAllows}
  var loadingVideoID: String? = "zyxwvutsrqp"
  ${lifecycle}
  var feedOpening: Int?
  func reverseFeedOpening() {}
  enum Mode { case expanded, mini, closed, loading }
  var mode = Mode.expanded
  var dragging = false, edgeBackTracking = false, playerOverlayOpen = false, playerFullscreen = false
  var customFullscreenID: String?
  var fullscreenExitDrag = false, fullscreenEnterDrag = false, dragCanTakeOver = false, settlingBetweenModes = false
  var revealer: NSObject?, settler: NSObject?
  var player: Web! = Web()
  var nativeDragVideoID: String?, startupVideoID: String? = "abcdefghijk"
  var bounds = CGRect(x:0,y:0,width:390,height:844)
  var cardMoving: Bool { settler != nil || revealer != nil || dragging }
  var drag = UIPanGestureRecognizer(), edgeBack = UIScreenEdgePanGestureRecognizer()
  var progress: CGFloat = 0, dragOrigin: CGFloat = 0, dragRevealOrigin: CGFloat = 0, dragTravel: CGFloat = 600
  var edgeBackUsesPicture = false, pictureOnScreen = true
  var ownsWatchPlayer = true
  var edgeBackTravel: CGFloat = 600
  var card = Card()
  var exitRequests = 0, follows = 0, settles = 0, nativeDragging = false
  var dragPosition: PlayerGesturePolicy.Position? { mode == .expanded ? .expanded : (mode == .mini ? .mini : nil) }
  func cancelFeedPrewarm() {}
  func cancelVideoProbe() {}
  func updateChrome() {}
  func setNativeDragging(_ active: Bool) {
    nativeDragging = active
    nativeDragVideoID = active ? YouTubeWebView.videoID(player.url) : nil
    player.evaluateJavaScript(active ? "LOCK" : "UNLOCK")
  }
  func traceEdgeWindowState(_ phase: String) {}
  var loadTicket = 1
  func freezeSettle() {}
  func freezeReveal() {}
  func beginVideoCrop() {}
  func requestFullscreenExit() { exitRequests += 1 }
  func apply(_ progress: CGFloat) { follows += 1 }
  func followEdgeBack(_ pan: UIPanGestureRecognizer) { follows += 1 }
  func minimizePlayer() { mode = .mini }
  func settle(_ target: Mode, speed: CGFloat = 0, travel: CGFloat = 1) { settles += 1; mode = target }
  ${callbacks}
}
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }
let s = Stage()
s.revealer = NSObject(); s.drag.delta.y = 20
expect(s.gestureRecognizerShouldBegin(s.drag), "downward swipe during first reveal must be admitted immediately")
s.drag.delta.y = -20
expect(s.gestureRecognizerShouldBegin(s.drag), "moving reveal can be grabbed in reverse")
s.playerOverlayOpen = true
expect(!s.gestureRecognizerShouldBegin(s.drag), "comments keep their own scrolling while reveal runs")
s.playerOverlayOpen = false; s.revealer = nil
expect(s.gestureRecognizerShouldBegin(s.drag), "stationary expanded portrait upward picture swipe enters fullscreen")
s.drag.delta = CGPoint(x: 20, y: 5)
expect(!s.gestureRecognizerShouldBegin(s.drag), "horizontal scrub remains with YouTube")
s.drag.delta = CGPoint(x: 0, y: 20); s.playerFullscreen = true
s.customFullscreenID = "abcdefghijk"
expect(!s.gestureRecognizerShouldBegin(s.drag), "custom fullscreen scrub and controls cannot begin a card-exit pan")
s.customFullscreenID = nil
s.drag.state = .began; s.dragPlayer(s.drag)
expect(s.exitRequests == 1 && s.follows == 0 && !s.dragging, "fullscreen drag requests exit without moving card")
s.playerFullscreen = false // report can arrive before the same finger lifts
s.drag.state = .changed; s.drag.delta.y = 500; s.dragPlayer(s.drag)
s.drag.state = .ended; s.drag.speed.y = 1000; s.dragPlayer(s.drag)
expect(s.settles == 0 && s.follows == 0 && s.mode == .expanded, "same drag cannot also minimize after fullscreen report")
expect(!s.fullscreenExitDrag && !s.nativeDragging, "fullscreen drag cleanup clears its latch")
s.playerFullscreen = true; s.drag.state = .began; s.dragPlayer(s.drag)
s.drag.state = .cancelled; s.dragPlayer(s.drag)
expect(s.exitRequests == 2 && s.settles == 0 && !s.fullscreenExitDrag, "cancelled fullscreen drag cleans up without card motion")
s.playerFullscreen = false; s.drag.state = .began; s.drag.delta.y = 80; s.drag.speed.y = 0; s.dragPlayer(s.drag)
s.drag.state = .cancelled; s.dragPlayer(s.drag)
expect(s.mode == .expanded && s.settles == 1, "ordinary cancelled down returns expanded")
s.drag.state = .began; s.drag.delta.y = 20; s.dragPlayer(s.drag)
s.drag.state = .ended; s.drag.speed.y = 800; s.dragPlayer(s.drag)
expect(s.mode == .mini && s.settles == 2, "fast ordinary downward swipe minimizes")
s.drag.state = .began; s.drag.delta.y = -100; s.drag.speed.y = 0; s.dragPlayer(s.drag)
s.drag.state = .cancelled; s.dragPlayer(s.drag)
expect(s.mode == .mini && s.settles == 3, "cancelled mini expansion restores mini")
let held = Stage()
held.card.transform = CGAffineTransform(translationX: 0, y: 175)
held.drag.state = .began; held.dragPlayer(held.drag)
expect(held.card.transform.ty == 175 && held.progress == 0, "grab starts at frozen visible pose")
held.drag.state = .changed; held.drag.delta.y = -75; held.dragPlayer(held.drag)
expect(held.card.transform.ty == 100 && held.progress == 0, "upward finger movement consumes held reveal offset continuously")
held.drag.delta.y = -200; held.dragPlayer(held.drag)
expect(held.card.transform.isIdentity && held.progress == 0, "upward movement clamps at expanded resting boundary")
held.drag.delta.y = -50; held.dragPlayer(held.drag)
expect(held.card.transform.ty == 125 && held.progress == 0, "reversal reconstructs current pose from original touch without hysteresis")
held.drag.delta.y = 60; held.dragPlayer(held.drag)
expect(held.card.transform.ty == 175 && held.progress == 0.1, "downward motion follows crop while retaining original opening pose")
let mid = PlayerGesturePolicy.trackedPose(origin: 0.4, revealOffset: 90, translation: -120, travel: 600)
expect(abs(mid.progress - 0.35) < 0.00001 && mid.revealOffset == 0, "grabbed mode spring consumes offset then expands remaining thirty points")
for useEdge in [false, true] {
  for terminal in [UIGestureRecognizer.State.failed, .cancelled] {
    let rejected = Stage()
    let pan: UIPanGestureRecognizer = useEdge ? rejected.edgeBack : rejected.drag
    pan.delta = useEdge ? CGPoint(x: 20, y: 0) : CGPoint(x: 0, y: 20)
    expect(rejected.gestureRecognizerShouldBegin(pan), "fixture admits pan before UIKit starts it")
    pan.state = terminal
    if useEdge { rejected.edgeBackDragged(rejected.edgeBack) } else { rejected.dragPlayer(rejected.drag) }
    expect(!rejected.nativeDragging && !rejected.dragging && !rejected.edgeBackTracking,
           "admission then failed/cancelled without began cannot leave page controls locked")
    expect(rejected.settles == 0, "unstarted pan never moves or settles card")
  }
  let began = Stage()
  let pan: UIPanGestureRecognizer = useEdge ? began.edgeBack : began.drag
  pan.delta = useEdge ? CGPoint(x: 20, y: 0) : CGPoint(x: 0, y: 20)
  expect(began.gestureRecognizerShouldBegin(pan), "real pan admitted")
  expect(!began.nativeDragging, "admission alone does not suspend page controls")
  pan.state = .began
  if useEdge { began.edgeBackDragged(began.edgeBack) } else { began.dragPlayer(began.drag) }
  expect(began.nativeDragging, "began still suppresses trailing WebKit clicks during real pan")
  pan.state = .cancelled
  if useEdge { began.edgeBackDragged(began.edgeBack) } else { began.dragPlayer(began.drag) }
  expect(!began.nativeDragging, "real cancelled pan releases page input")
}
let actualEdge = Stage()
actualEdge.edgeBack.delta = .zero; actualEdge.edgeBack.speed = CGPoint(x: 200, y: 0)
expect(actualEdge.gestureRecognizerShouldBegin(actualEdge.edgeBack), "actual UIKit screen-edge begin with zero translation uses rightward velocity")
actualEdge.edgeBack.speed = .zero
expect(!actualEdge.gestureRecognizerShouldBegin(actualEdge.edgeBack), "stationary edge contact never begins")
actualEdge.edgeBack.speed = CGPoint(x: -200, y: 0)
expect(!actualEdge.gestureRecognizerShouldBegin(actualEdge.edgeBack), "leftward edge velocity rejected")
actualEdge.edgeBack.speed = CGPoint(x: 200, y: 300)
expect(!actualEdge.gestureRecognizerShouldBegin(actualEdge.edgeBack), "vertical edge velocity remains page scroll")
actualEdge.edgeBack.delta = CGPoint(x: -1, y: 0); actualEdge.edgeBack.speed = CGPoint(x: 200, y: 0)
expect(!actualEdge.gestureRecognizerShouldBegin(actualEdge.edgeBack), "positive velocity cannot override negative translation")
actualEdge.edgeBack.delta = CGPoint(x: 1, y: 2)
expect(!actualEdge.gestureRecognizerShouldBegin(actualEdge.edgeBack), "positive velocity cannot override already vertical translation")
actualEdge.edgeBack.delta = .zero; actualEdge.playerFullscreen = true
expect(!actualEdge.gestureRecognizerShouldBegin(actualEdge.edgeBack), "velocity fallback preserves fullscreen exclusion")
actualEdge.playerFullscreen = false; actualEdge.playerOverlayOpen = true
expect(!actualEdge.gestureRecognizerShouldBegin(actualEdge.edgeBack), "velocity fallback preserves overlay exclusion")
let openingEdge = Stage()
openingEdge.mode = .loading; openingEdge.feedOpening = 1
openingEdge.edgeBack.delta = CGPoint(x: 20, y: 0)
expect(openingEdge.gestureRecognizerShouldBegin(openingEdge.edgeBack), "rightward edge can reverse an opening card while loading")
openingEdge.edgeBack.delta = CGPoint(x: 0, y: 20)
expect(!openingEdge.gestureRecognizerShouldBegin(openingEdge.edgeBack), "vertical edge scroll cannot reverse opening")
openingEdge.edgeBack.delta = CGPoint(x: 20, y: 0); openingEdge.customFullscreenID = "abcdefghijk"
expect(!openingEdge.gestureRecognizerShouldBegin(openingEdge.edgeBack), "custom fullscreen excludes native edge even before the legacy report")
let otherActive = Stage()
otherActive.drag.delta = CGPoint(x: 0, y: 20); otherActive.drag.state = .began; otherActive.dragPlayer(otherActive.drag)
otherActive.edgeBack.state = .failed; otherActive.edgeBackDragged(otherActive.edgeBack)
expect(otherActive.nativeDragging && otherActive.dragging, "unstarted other recognizer cannot unlock an active drag")
otherActive.drag.state = .ended; otherActive.dragPlayer(otherActive.drag)
expect(!otherActive.nativeDragging, "active gesture's own terminal event releases its lock")
let upward = Stage(); upward.drag.delta = CGPoint(x:0,y:-20)
expect(upward.gestureRecognizerShouldBegin(upward.drag), "portrait video admits upward entry")
upward.drag.state = .began; upward.dragPlayer(upward.drag)
expect(upward.fullscreenEnterDrag && upward.nativeDragging && upward.follows == 0 && upward.settles == 0, "upward contact owns page without cropping to mini")
upward.drag.delta.y = -100; upward.drag.state = .changed; upward.dragPlayer(upward.drag)
expect(upward.follows == 0 && upward.player.scripts == ["LOCK"], "tracking does not move the mini card or enter before release")
upward.drag.state = .ended; upward.dragPlayer(upward.drag)
expect(upward.player.scripts.count == 3 && upward.player.scripts[1] == "UNLOCK" && upward.player.scripts[2].contains("enterForGesture"), "committed entry unlocks page before invoking exact-owner fullscreen API")
expect(!upward.fullscreenEnterDrag && !upward.dragging && upward.mode == .expanded && upward.settles == 0, "upward release never minimizes")
for terminal in [UIGestureRecognizer.State.cancelled, .failed] {
 let cancelled = Stage(); cancelled.drag.delta.y = -20; expect(cancelled.gestureRecognizerShouldBegin(cancelled.drag), "upward contact admitted before began"); cancelled.drag.state = .began; cancelled.dragPlayer(cancelled.drag)
 cancelled.drag.delta.y = -100; cancelled.drag.state = terminal; cancelled.dragPlayer(cancelled.drag)
 expect(cancelled.player.scripts == ["LOCK","UNLOCK"] && !cancelled.dragging && cancelled.settles == 0, "cancelled upward contact only unlocks, no fullscreen or mini")
}
let reversed = Stage(); reversed.drag.delta.y = -20; expect(reversed.gestureRecognizerShouldBegin(reversed.drag), "upward contact admitted before began"); reversed.drag.state = .began; reversed.dragPlayer(reversed.drag)
reversed.drag.delta.y = 80; reversed.drag.speed.y = 700; reversed.drag.state = .ended; reversed.dragPlayer(reversed.drag)
expect(reversed.player.scripts == ["LOCK","UNLOCK"] && reversed.settles == 0, "upward then downward reversal cannot commit either route")
for guardCase in 0..<6 {
 let guarded = Stage(); guarded.drag.delta.y = -20
 switch guardCase { case 0: guarded.bounds.size = CGSize(width:844,height:390); case 1: guarded.playerOverlayOpen = true; case 2: guarded.mode = .mini; case 3: guarded.customFullscreenID = "abcdefghijk"; case 4: guarded.dragCanTakeOver = true; default: guarded.revealer = NSObject() }
 expect(!guarded.acceptsFullscreenEntry(guarded.drag), "fullscreen entry retains portrait, overlay, mini and transition guards")
}
let replaced = Stage(); replaced.drag.delta.y = -20; expect(replaced.gestureRecognizerShouldBegin(replaced.drag), "upward contact admitted before began"); replaced.drag.state = .began; replaced.dragPlayer(replaced.drag)
replaced.player.url = URL(string:"https://m.youtube.com/watch?v=zyxwvutsrqp")
replaced.drag.delta.y = -100; replaced.drag.state = .ended; replaced.dragPlayer(replaced.drag)
expect(replaced.player.scripts == ["LOCK","UNLOCK"], "source replacement revokes old upward contact")

// An accepted direction belongs to one contact. Later UIKit input samples may
// be neutral; source/state changes still revoke it without generic card motion.
var admissionCases = 0
func admissionCheck(_ name: String, _ success: Bool, _ stage: Stage) {
  admissionCases += 1; expect(success, "admission: " + name)
}
for timing in 0..<3 {
 let s=Stage();s.drag.delta=timing==1 ? .zero:CGPoint(x:0,y:-12);s.drag.speed=CGPoint(x:0,y:-400)
 let admitted=s.gestureRecognizerShouldBegin(s.drag)
 if timing != 0 {s.drag.delta = .zero;s.drag.speed = .zero}
 s.drag.state = .began;s.dragPlayer(s.drag)
 admissionCheck("accepted-upward-direction-latched-"+String(timing),admitted && s.fullscreenEnterDrag && s.follows==0 && s.nativeDragging,s)
 s.drag.delta=CGPoint(x:0,y:-115);s.drag.state = .ended;s.dragPlayer(s.drag)
 admissionCheck("matching-release-enters-once-"+String(timing),s.player.scripts.filter{$0.contains("enterForGesture")}.count==1 && s.settles==0 && !s.dragging,s)
}
for mutation in 0..<11 {
 let s=Stage();s.drag.delta=CGPoint(x:0,y:-12);_ = s.gestureRecognizerShouldBegin(s.drag)
 switch mutation {
 case 0:s.player.url=URL(string:"https://m.youtube.com/watch?v=zyxwvutsrqp")
 case 1:s.loadTicket += 1
 case 2:s.player=Web()
 case 3:s.mode = .mini
 case 4:s.playerOverlayOpen=true
 case 5:s.revealer=NSObject()
 case 6:s.dragCanTakeOver=true
 case 7:UIApplication.shared.applicationState = .inactive
 case 8:s.playerFullscreen=true
 case 9:s.bounds.size=CGSize(width:844,height:390)
 default:s.startupVideoID="zyxwvutsrqp"
 }
 s.drag.state = .began;s.dragPlayer(s.drag)
 admissionCheck("changed-binding-or-state-aborts-without-crop-"+String(mutation),!s.fullscreenEnterDrag && !s.dragging && s.follows==0 && s.exitRequests==0 && !s.drag.cancelsTouchesInView,s)
 UIApplication.shared.applicationState = .active
}
let revoked=Stage();revoked.drag.delta.y = -12;_ = revoked.gestureRecognizerShouldBegin(revoked.drag)
revoked.revokeFullscreenEntryAdmission();revoked.drag.state = .began;revoked.dragPlayer(revoked.drag)
admissionCheck("revoked-old-contact-never-falls-into-crop",revoked.follows==0 && !revoked.dragging && !revoked.fullscreenEnterDrag,revoked)
for terminal in [UIGestureRecognizer.State.cancelled,.failed,.ended] {
 let s=Stage();s.drag.delta.y = -12;_ = s.gestureRecognizerShouldBegin(s.drag);s.drag.state=terminal;s.dragPlayer(s.drag)
 admissionCheck("terminal-clears-pending-owner-"+String(terminal.rawValue),s.fullscreenEntryAdmission==nil && !s.fullscreenEntryAdmissionRevoked && s.follows==0 && s.player.scripts.isEmpty,s)
}
let admissionReversed=Stage();admissionReversed.drag.delta.y = -12;_ = admissionReversed.gestureRecognizerShouldBegin(admissionReversed.drag);admissionReversed.drag.state = .began;admissionReversed.dragPlayer(admissionReversed.drag)
admissionReversed.drag.delta.y=100;admissionReversed.drag.speed.y=700;admissionReversed.drag.state = .ended;admissionReversed.dragPlayer(admissionReversed.drag)
admissionCheck("reversal-cancels-entry-without-mini",admissionReversed.settles==0 && admissionReversed.player.scripts==["LOCK","UNLOCK"],admissionReversed)
for variant in 0..<3 {
 let s=Stage();s.drag.delta.y=variant==0 ? 12:-12
 if variant==1 {s.revealer=NSObject();s.dragCanTakeOver=true}
 if variant==2 {s.mode = .mini}
 let admitted=s.gestureRecognizerShouldBegin(s.drag);s.drag.state = .began;s.dragPlayer(s.drag)
 admissionCheck("ordinary-down-transition-mini-preserved-"+String(variant),admitted && !s.fullscreenEnterDrag && s.follows==1 && s.dragging,s)
}
let reject=Stage();reject.drag.delta.y = -12;_ = reject.gestureRecognizerShouldBegin(reject.drag);reject.drag.delta=CGPoint(x:30,y:0)
admissionCheck("rejected-admission-clears-pending-owner",!reject.gestureRecognizerShouldBegin(reject.drag) && reject.fullscreenEntryAdmission==nil,reject)

for cleanup in 0..<3 {
 let s = Stage(); s.drag.delta.y = -12
 expect(s.gestureRecognizerShouldBegin(s.drag), "lifecycle fixture starts with accepted upward contact")
 switch cleanup {
 case 0: s.admissionCleanup_closePlayer()
 case 1: s.admissionCleanup_openWatch()
 default: s.admissionCleanup_stop()
 }
 let oldScripts = s.player?.scripts ?? []
 s.drag.state = .began; s.dragPlayer(s.drag)
 admissionCheck("actual-lifecycle-order-rejects-late-began-" + String(cleanup),
   !s.dragging && !s.fullscreenEnterDrag && s.follows == 0 && !s.drag.cancelsTouchesInView && (s.player?.scripts ?? []) == oldScripts, s)
}
expect(admissionCases == 29, "all 26 admission and three shipping lifecycle sequences executed")
print("NATIVE_FULLSCREEN_ADMISSION_29_OK")

print("NATIVE_PLAYER_INTERACTION_OK")
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "langform-native-interaction-"));
  try {
    const file = path.join(dir, "Interaction.swift");
    fs.writeFileSync(file, policy + "\n" + exercise);
    const result = spawnSync(compiler.stdout.trim(), [file], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_PLAYER_INTERACTION_OK/);
    assert.match(result.stdout, /NATIVE_FULLSCREEN_ADMISSION_29_OK/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Native Freeze bewahrt sichtbare Reveal-/Federposition; Rotation entfernt gehaltene Translation", {
  skip: process.platform !== "darwin", timeout: 70000,
}, function (t) {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/YouTubeWebView.swift"), "utf8");
  const callbacks = ["freezeReveal", "freezeSettle", "stopReveal"].map(name => method(source, name)).join("\n");
  const viewportPolicy = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/PlayerViewportPolicy.swift"), "utf8");
  const exercise = `
import Foundation
import CoreGraphics
// Model/presentation stubs deliberately differ, as during a UIKit animation.
class Layer {
  var bounds = CGRect(x: 0, y: 0, width: 400, height: 800)
  var position = CGPoint.zero
  var pose = CGAffineTransform.identity
  var shown: Layer?
  func presentation() -> Layer? { shown }
  func affineTransform() -> CGAffineTransform { pose }
}
class Card { var alpha: CGFloat = 1; var layer = Layer(); var bounds = CGRect(x: 0, y: 0, width: 400, height: 800); var frame = CGRect.zero; var transform = CGAffineTransform.identity }
class Animator { var stopped = false; var onStop: (() -> Void)?; func stopAnimation(_ immediately: Bool) { stopped = true; onStop?() } }
enum UIView { static func performWithoutAnimation(_ block: () -> Void) { block() } }
class OpeningMotion { func cancel() {}; func viewportChanged() {} }
class Stage {
  func cancelPendingMinimize() {}
  enum Mode { case mini, expanded }
  var mode = Mode.expanded, customFullscreenID: String?
  var player: Card?
  var cropCorrection: PlayerViewportPolicy.SurfaceCorrection?
  var openingMotion = OpeningMotion()
  var videoCropActive = false, pictureRect = CGRect(x: 0, y: 107, width: 400, height: 225)
  var card = Card(), bounds = CGRect(x: 0, y: 0, width: 400, height: 800)
  let closeButton = Card(), miniPlaybackButton = Card()
  var revealer: Animator?, settler: Animator?, settlingBetweenModes = false
  var progress: CGFloat = 0
  func miniFrame() -> CGRect { CGRect(x: 200, y: 600, width: 180, height: 100) }
  func apply(_ t: CGFloat) { card.bounds.size.height = 800 - 700 * t }
  ${callbacks}
}
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }
let s = Stage(), shown = Layer(), reveal = Animator()
shown.pose = CGAffineTransform(translationX: 0, y: 175)
s.card.layer.shown = shown; s.revealer = reveal
reveal.onStop = { s.card.layer.shown = nil; s.card.transform = .identity }
s.freezeReveal()
expect(reveal.stopped && s.revealer == nil && s.card.transform.ty == 175, "freeze reads presentation before stop and retains actual opening pose")
s.stopReveal()
expect(s.card.transform.isIdentity, "viewport reset clears frozen translation even with no live reveal animator")
let spring = Animator(), mid = Layer()
mid.bounds.size.height = 520; mid.pose = CGAffineTransform(translationX: 0, y: 90)
s.card.layer.shown = mid; s.settler = spring; s.settlingBetweenModes = true; s.progress = 1
spring.onStop = { s.card.layer.shown = nil; s.card.transform = .identity }
s.freezeSettle()
expect(abs(s.progress - 0.4) < 0.0001 && s.card.bounds.height == 520, "grab reconstructs actual mode progress, not destination")
expect(s.card.transform.ty == 90 && spring.stopped && s.settler == nil, "grab preserves reveal offset still decaying inside spring")
s.stopReveal()
expect(s.card.transform.isIdentity, "rotation clears offset after interrupted settle too")
print("NATIVE_PLAYER_FREEZE_OK")
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "langform-native-freeze-"));
  try {
    const file = path.join(dir, "Freeze.swift"); fs.writeFileSync(file, 'enum PlayerGesturePolicy { enum Position { case mini, expanded } }\n' + viewportPolicy + '\n' + exercise);
    const result = spawnSync(compiler.stdout.trim(), [file], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_PLAYER_FREEZE_OK/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Native Minikartentipp prüft den echten Touch bis Ende, maximale Auslenkung und einzelnen Besitzer", {
  skip:process.platform!=="darwin",timeout:70000,
},function(t){
  const compiler=spawnSync('/usr/bin/xcrun',['--find','swift'],{encoding:'utf8'});
  if(compiler.status!==0)return t.skip('Swift-Toolchain nicht verfügbar');
  const source=fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/YouTubeWebView.swift'),'utf8');
  const shipping=block(source,'final class PlayerCardTapGestureRecognizer:');
  const type=shipping?'PlayerCardTapGestureRecognizer':'UITapGestureRecognizer';
  if(shipping)assert.match(source,/cardTap = PlayerCardTapGestureRecognizer\(/,'the actual card uses the shipping subclass');
  // The previous candidate is exercised verbatim with a controlled early
  // shouldBegin sample of zero. The real trace proves that zero sample despite
  // 27pt input; this fixture does not assert a UIKit callback/cache cause.
  const early=shipping?'':block(method(source,'gestureRecognizerShouldBegin'),'if gestureRecognizer === cardTap {');
  const exercise=`
import Foundation
import CoreGraphics
class UIView {}
class UITouch: NSObject {
  enum Phase { case began, moved, stationary, ended, cancelled }
  var phase = Phase.began, windowPoint = CGPoint(x:210,y:720), localPoint = CGPoint.zero
  func location(in view: UIView?) -> CGPoint { view == nil ? windowPoint : localPoint }
}
class UIEvent { var allTouches: Set<UITouch>?; init(_ touches: Set<UITouch>? = nil){allTouches=touches} }
class UIGestureRecognizer {
  enum State:Int { case possible,began,changed,ended,cancelled,failed }
  var state=State.possible
  func touchesBegan(_ touches:Set<UITouch>,with event:UIEvent){}
  func touchesMoved(_ touches:Set<UITouch>,with event:UIEvent){}
  func touchesEnded(_ touches:Set<UITouch>,with event:UIEvent){}
  func touchesCancelled(_ touches:Set<UITouch>,with event:UIEvent){}
  func reset(){state = .possible}
}
class UITapGestureRecognizer: UIGestureRecognizer {
  var actions=0, beganForwards=0, movedForwards=0, endedForwards=0
  var earlyShouldBegin:(()->Bool)?
  func location(in view:Any)->CGPoint{.zero}
  override func touchesBegan(_ touches:Set<UITouch>,with event:UIEvent){beganForwards+=1;if earlyShouldBegin?()==false {state = .failed}}
  override func touchesMoved(_ touches:Set<UITouch>,with event:UIEvent){movedForwards+=1}
  override func touchesEnded(_ touches:Set<UITouch>,with event:UIEvent){endedForwards+=1;if state == .possible {actions+=1;state = .ended}}
  override func touchesCancelled(_ touches:Set<UITouch>,with event:UIEvent){state = .failed}
}
enum StartupDiagnostics {
  static var enabled=true,rows:[[String:Any]]=[]
  static func videoMark(_ row:[String:Any]){rows.append(row)}
}
${shipping}
class Stage:UIView {
  enum Mode{case mini,expanded};var mode=Mode.mini
  let cardTap=${type}();var cardTapOrigin:CGPoint?,cardTapDiagnosticCount=0
  func early(_ gestureRecognizer:UIGestureRecognizer)->Bool{${early}\nreturn true}
}
var failures:[String]=[]
func expect(_ value:Bool,_ message:String){if !value {failures.append(message);print("FAILED: "+message)}}
func started()->(Stage,UITouch){
  let s=Stage(),touch=UITouch();s.cardTapOrigin = .zero
  s.cardTap.earlyShouldBegin={s.early(s.cardTap)}
  s.cardTap.touchesBegan([touch],with:UIEvent([touch]));return(s,touch)
}
func move(_ s:Stage,_ touch:UITouch,_ delta:CGPoint){touch.phase = .moved;touch.windowPoint=CGPoint(x:210+delta.x,y:720+delta.y);s.cardTap.touchesMoved([touch],with:UIEvent([touch]))}
func end(_ s:Stage,_ touch:UITouch,_ delta:CGPoint){touch.phase = .ended;touch.windowPoint=CGPoint(x:210+delta.x,y:720+delta.y);s.cardTap.touchesEnded([touch],with:UIEvent([touch]))}
for delta in [CGPoint.zero,CGPoint(x:10,y:0),CGPoint(x:0,y:10),CGPoint(x:6,y:8),CGPoint(x:-6,y:-8)]{
  let(s,touch)=started();move(s,touch,delta);end(s,touch,delta)
  expect(s.cardTap.actions==1,"stationary/10pt boundary still performs exactly one real tap action")
}
for delta in [CGPoint(x:0,y:27),CGPoint(x:0,y:-27),CGPoint(x:27,y:0),CGPoint(x:-27,y:0),CGPoint(x:10.001,y:0),CGPoint(x:8,y:8)]{
  for returns in [false,true]{
    let(s,touch)=started();move(s,touch,delta);if returns {move(s,touch,.zero)};end(s,touch,returns ? .zero:delta)
    expect(s.cardTap.actions==0,"27pt/over10 movement including return to origin cannot expand")
    expect(s.cardTap.endedForwards==0,"rejected excursion never forwards Ended to the native tap superclass")
  }
}
let(finalOnly,lastTouch)=started();end(finalOnly,lastTouch,CGPoint(x:0,y:27))
expect(finalOnly.cardTap.actions==0 && finalOnly.cardTap.endedForwards==0,"final Ended displacement rejects even with no Moved event")
let(windowOnly,windowTouch)=started();windowTouch.localPoint=CGPoint(x:999,y:999);end(windowOnly,windowTouch,.zero)
expect(windowOnly.cardTap.actions==1,"a moving local/card frame cannot reject a stationary window contact")
let(foreign,ownedTouch)=started(),otherTouch=UITouch();otherTouch.phase = .moved
foreign.cardTap.touchesMoved([otherTouch],with:UIEvent([ownedTouch,otherTouch]));end(foreign,ownedTouch,.zero)
expect(foreign.cardTap.actions==0,"foreign touch ID cannot release or replace the owned contact")
let(doubleBegin,firstTouch)=started(),secondTouch=UITouch()
doubleBegin.cardTap.touchesBegan([secondTouch],with:UIEvent([firstTouch,secondTouch]));end(doubleBegin,firstTouch,.zero)
expect(doubleBegin.cardTap.actions==0,"second Begin fails the candidate")
let(multiEnd,multiTouch)=started(),extraTouch=UITouch();extraTouch.phase = .ended;multiTouch.phase = .ended
multiEnd.cardTap.touchesEnded([multiTouch,extraTouch],with:UIEvent([multiTouch,extraTouch]))
expect(multiEnd.cardTap.actions==0,"more than one ending touch cannot perform an action")
let(activeOutside,outsideOwner)=started(),outsideTouch=UITouch()
activeOutside.cardTap.touchesMoved([outsideOwner],with:UIEvent([outsideOwner,outsideTouch]));end(activeOutside,outsideOwner,.zero)
expect(activeOutside.cardTap.actions==0,"another active window touch cancels this free-card tap")
let initialMulti=Stage(),initialFirst=UITouch(),initialSecond=UITouch();initialMulti.cardTapOrigin = .zero
initialMulti.cardTap.touchesBegan([initialFirst,initialSecond],with:UIEvent([initialFirst,initialSecond]));end(initialMulti,initialFirst,.zero)
expect(initialMulti.cardTap.actions==0 && initialMulti.cardTap.beganForwards==0,"initial multitouch fails before entering the native tap superclass")
let(emptyMove,emptyOwner)=started();emptyMove.cardTap.touchesMoved([],with:UIEvent([emptyOwner]));end(emptyMove,emptyOwner,.zero)
expect(emptyMove.cardTap.actions==0,"an empty malformed movement cannot preserve a candidate")
let(wrongEnd,rightOwner)=started(),wrongOwner=UITouch();wrongOwner.phase = .ended
wrongEnd.cardTap.touchesEnded([wrongOwner],with:UIEvent([rightOwner,wrongOwner]));end(wrongEnd,rightOwner,.zero)
expect(wrongEnd.cardTap.actions==0,"a foreign Ended cannot recognize or rearm the real owner")
let badBegin=Stage(),badBeginTouch=UITouch();badBeginTouch.windowPoint=CGPoint(x:CGFloat.nan,y:720);badBegin.cardTapOrigin = .zero
badBegin.cardTap.touchesBegan([badBeginTouch],with:UIEvent([badBeginTouch]));end(badBegin,badBeginTouch,.zero)
expect(badBegin.cardTap.actions==0 && badBegin.cardTap.beganForwards==0,"nonfinite origin fails before native Begin")
let(cancelled,cancelTouch)=started();cancelTouch.phase = .cancelled;cancelled.cardTap.touchesCancelled([cancelTouch],with:UIEvent([cancelTouch]));end(cancelled,cancelTouch,.zero)
expect(cancelled.cardTap.actions==0,"cancelled contact cannot later recognize")
cancelled.cardTap.reset();let retry=UITouch();cancelled.cardTapOrigin = .zero
cancelled.cardTap.touchesBegan([retry],with:UIEvent([retry]));end(cancelled,retry,.zero)
expect(cancelled.cardTap.actions==1,"reset releases cancelled owner for a new normal tap")
let(resetDuring,oldTouch)=started();move(resetDuring,oldTouch,CGPoint(x:0,y:27));resetDuring.cardTap.reset();end(resetDuring,oldTouch,.zero)
expect(resetDuring.cardTap.actions==0,"reset cannot turn a stale Ended into a tap")
let(invalid,invalidTouch)=started();invalidTouch.windowPoint=CGPoint(x:CGFloat.nan,y:720);invalid.cardTap.touchesMoved([invalidTouch],with:UIEvent([invalidTouch]));end(invalid,invalidTouch,.zero)
expect(invalid.cardTap.actions==0,"nonfinite coordinates reject rather than bypass movement comparison")
let disabled=Stage();StartupDiagnostics.enabled=false;let before=StartupDiagnostics.rows.count,quietTouch=UITouch();disabled.cardTapOrigin = .zero
disabled.cardTap.touchesBegan([quietTouch],with:UIEvent([quietTouch]));end(disabled,quietTouch,.zero)
expect(disabled.cardTap.actions==1 && StartupDiagnostics.rows.count==before,"disabled diagnostics preserve tap with no rows")
StartupDiagnostics.enabled=true;StartupDiagnostics.rows=[];let bounded=Stage()
for _ in 0..<45{let touch=UITouch();bounded.cardTapOrigin = .zero;bounded.cardTap.touchesBegan([touch],with:UIEvent([touch]));end(bounded,touch,.zero);bounded.cardTap.reset()}
expect(bounded.cardTap.actions==45,"diagnostic cap cannot consume real taps")
expect(!StartupDiagnostics.rows.isEmpty && StartupDiagnostics.rows.count<=40,"diagnostics are bounded at40 for recognizer lifetime")
expect(StartupDiagnostics.rows.allSatisfy{$0["candidate"] is Bool && $0["maxDisplacement"] is Double && $0["phase"] is String && $0["state"] is Int},"diagnostics expose only actual candidate/displacement/phase/state samples")
if !failures.isEmpty {print("CARD_TAP_TRACKING_FAILED: "+String(failures.count));exit(1)}
print("CARD_TAP_TRACKING_OK")
`;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'langform-card-tap-'));
  try{
    const file=path.join(dir,'CardTap.swift');fs.writeFileSync(file,exercise);
    const result=spawnSync(compiler.stdout.trim(),[file],{encoding:'utf8',timeout:60000});
    assert.equal(result.error,undefined,String(result.error));assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/CARD_TAP_TRACKING_OK/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
