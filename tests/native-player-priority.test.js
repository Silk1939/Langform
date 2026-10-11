const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("native Player-Pans priorisieren WebKit-Unterbäume, ohne Feed und native Bedienelemente zu übernehmen", {
  skip: process.platform !== "darwin",
  timeout: 70000,
}, function (t) {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Der Prioritätstest benötigt die Swift-Toolchain.");
  const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/YouTubeWebView.swift"), "utf8");
  const label = source.indexOf("shouldBeRequiredToFailBy otherGestureRecognizer:");
  assert.ok(label >= 0, "Die verwendete delegate-Methode ist vorhanden.");
  const start = source.lastIndexOf("func gestureRecognizer(", label);
  const body = source.indexOf("{", label);
  let depth = 1;
  let end = body + 1;
  while (end < source.length && depth) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
    end++;
  }
  assert.equal(depth, 0);
  // Execute the production delegate method verbatim. Minimal public UIKit
  // identity/tree stubs replace only platform objects, not the priority logic.
  const method = source.slice(start, end);
  const script = `
import Foundation
class UIView {
    weak var superview: UIView?
    init(_ parent: UIView? = nil) { superview = parent }
    func isDescendant(of ancestor: UIView) -> Bool {
        var current: UIView? = self
        while let node = current { if node === ancestor { return true }; current = node.superview }
        return false
    }
}
class UIGestureRecognizer {
    var view: UIView?
    init(_ view: UIView? = nil) { self.view = view }
}
class UIPanGestureRecognizer: UIGestureRecognizer {}
class UIScreenEdgePanGestureRecognizer: UIPanGestureRecognizer {}
class UITapGestureRecognizer: UIGestureRecognizer {}
class UIScrollView: UIView {
    lazy var panGestureRecognizer = UIPanGestureRecognizer(self)
}
class WKWebView: UIView {
    lazy var scrollView = UIScrollView(self)
}
class PlayerStage {
    let card = UIView()
    lazy var drag = UIPanGestureRecognizer(card)
    lazy var edgeBack = UIScreenEdgePanGestureRecognizer(card)
    var player: WKWebView? = WKWebView()
    ${method}
}
func expect(_ condition: Bool, _ message: String) {
    if !condition { print("FAILED: " + message); exit(1) }
}
let stage = PlayerStage()
let player = stage.player!
let content = UIView(player.scrollView)
let childScroll = UIScrollView(content)
let childContent = UIView(childScroll)
let innerPan = childScroll.panGestureRecognizer
let touchEvents = UIGestureRecognizer(content)
let genericInnerGesture = UIGestureRecognizer(childContent)
let playerRootGesture = UIGestureRecognizer(player)
let feed = WKWebView()
let feedGesture = feed.scrollView.panGestureRecognizer
let nativeControl = UIView(stage.card)
let nativeControlGesture = UITapGestureRecognizer(nativeControl)
let unrelated = UIGestureRecognizer(UIView())
let missingView = UIGestureRecognizer()
for candidate in [player.scrollView.panGestureRecognizer, innerPan, touchEvents, genericInnerGesture, playerRootGesture] {
    expect(stage.gestureRecognizer(stage.drag, shouldBeRequiredToFailBy: candidate), "player subtree waits for native picture drag")
    expect(stage.gestureRecognizer(stage.edgeBack, shouldBeRequiredToFailBy: candidate), "player subtree waits for native edge-back")
}
expect(stage.gestureRecognizer(stage.edgeBack, shouldBeRequiredToFailBy: stage.drag), "edge-back has priority over native drag")
expect(!stage.gestureRecognizer(stage.drag, shouldBeRequiredToFailBy: stage.drag), "no self dependency")
expect(!stage.gestureRecognizer(stage.drag, shouldBeRequiredToFailBy: stage.edgeBack), "no edge-back dependency cycle")
for candidate in [feedGesture, nativeControlGesture, unrelated, missingView] {
    expect(!stage.gestureRecognizer(stage.drag, shouldBeRequiredToFailBy: candidate), "feed/native controls/unrelated gestures stay independent")
    expect(!stage.gestureRecognizer(stage.edgeBack, shouldBeRequiredToFailBy: candidate), "edge does not acquire feed/native controls")
}
expect(!stage.gestureRecognizer(unrelated, shouldBeRequiredToFailBy: touchEvents), "only the app's configured player gestures own priority")
stage.player = nil
expect(!stage.gestureRecognizer(stage.drag, shouldBeRequiredToFailBy: touchEvents), "lazy player absence is safe")
expect(!stage.gestureRecognizer(stage.edgeBack, shouldBeRequiredToFailBy: touchEvents), "edge handles absent player safely")
expect(stage.gestureRecognizer(stage.edgeBack, shouldBeRequiredToFailBy: stage.drag), "native edge/drag relation remains valid before player creation")
print("NATIVE_PLAYER_PRIORITY_OK")
`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-priority-test-"));
  try {
    const filename = path.join(directory, "PlayerPriority.swift");
    fs.writeFileSync(filename, script);
    const result = spawnSync(compiler.stdout.trim(), [filename], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_PLAYER_PRIORITY_OK/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Native Drag widerruft den passenden Swipekandidaten vor dem JS-Latch und nur beim tatsächlichen Start", {
  skip:process.platform!=="darwin", timeout:70000,
},function(t){
  const vm=require("node:vm");
  const compiler=spawnSync("/usr/bin/xcrun",["--find","swift"],{encoding:"utf8"});
  if(compiler.status!==0)return t.skip("Swipe-Abbruchprüfung benötigt Swift.");
  const source=fs.readFileSync(path.join(__dirname,"../ios/Langform/Langform/YouTubeWebView.swift"),"utf8");
  const start=source.indexOf("func setNativeDragging(_ active: Bool)");
  assert.ok(start>=0);
  const body=source.indexOf("{",start);let depth=1,end=body+1;
  while(depth&&end<source.length){if(source[end]==="{")depth++;if(source[end]==="}")depth--;end++;}
  assert.equal(depth,0);
  const method=source.slice(start,end);
  const script=`
import Foundation
enum YouTubeWebView {
  static func videoID(_ url:URL?)->String? {
    guard let url,url.path=="/watch" else{return nil}
    return URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems?.first(where:{$0.name=="v"})?.value
  }
}
class Web {
  var url:URL?=URL(string:"https://m.youtube.com/watch?v=abcdefghijk"),scripts:[String]=[]
  func evaluateJavaScript(_ source:String){scripts.append(source)}
}
class Stage {
  var player:Web! = Web(),nativeDragVideoID:String?
  ${method}
}
let s=Stage();s.setNativeDragging(true);s.setNativeDragging(true);s.setNativeDragging(false);s.setNativeDragging(false)
print(String(data:try! JSONEncoder().encode(s.player.scripts),encoding:.utf8)!)
`;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"langform-swipe-cancel-test-"));
  try{
    const file=path.join(dir,"Cancel.swift");fs.writeFileSync(file,script);
    const result=spawnSync(compiler.stdout.trim(),[file],{encoding:"utf8",timeout:60000});
    assert.equal(result.error,undefined,String(result.error));assert.equal(result.status,0,result.stdout+result.stderr);
    const scripts=JSON.parse(result.stdout.trim());assert.equal(scripts.length,2,"duplicate Native begin/end must not produce duplicate cancels");
    function run(code,currentID="abcdefghijk",swipe=true){
      const calls=[];
      const window={
        __langformSetNativeDragging(active,expectedID){calls.push(["latch",active,expectedID]);},
      };
      if(swipe)window.__langformPlaybackSwipe={cancel(expectedID){if(expectedID===currentID)calls.push(["cancel",expectedID]);}};
      vm.runInNewContext(code,{window});return calls;
    }
    assert.deepEqual(run(scripts[0]),[["cancel","abcdefghijk"],["latch",true,"abcdefghijk"]],"actual shipping JS cancels before changing the drag latch");
    assert.deepEqual(run(scripts[1]),[["latch",false,"abcdefghijk"]],"release does not cancel a fresh later swipe");
    assert.deepEqual(run(scripts[0],"zyxwvutsrqp"),[["latch",true,"abcdefghijk"]],"expected ID prevents an old Native start cancelling a new SPA candidate");
    assert.deepEqual(run(scripts[0],"abcdefghijk",false),[["latch",true,"abcdefghijk"]],"absence of the new module leaves legacy Native dragging functional");
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("stabile aktuelle Videobildkontakte geben den linken Rand an ±15s-Swipe frei; fremde und bewegte Bilder nicht", {
  skip: process.platform !== "darwin", timeout: 70000,
}, function (t) {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Der Kontaktprioritätstest benötigt die Swift-Toolchain.");
  const app = path.join(__dirname, "../ios/Langform/Langform");
  const source = fs.readFileSync(path.join(app, "YouTubeWebView.swift"), "utf8");
  function shipping(label, optional = false) {
    const start = source.indexOf(label);
    if (optional && start < 0) return "";
    assert.ok(start >= 0, label);
    const body = source.indexOf("{", start);
    let depth = 1, end = body + 1;
    while (depth && end < source.length) {
      if (source[end] === "{") depth++;
      if (source[end] === "}") depth--;
      end++;
    }
    assert.equal(depth, 0, label);
    // Strip visibility only; the shipping decision bodies run verbatim.
    return source.slice(start, end).replace(/^private /, "");
  }
  const owns = shipping("private func videoSeekOwnsEdgeContact", true);
  const remember = shipping("private func rememberVideoSeekGeometry", true);
  const properties = ["hasVideoRect", "pictureRect", "ownsWatchPlayer", "cardMoving"]
    .map(name => shipping("private var " + name + ":")).join("\n");
  const script = `
import Foundation
import CoreGraphics
class Layer {
  var shown: Layer?
  func presentation() -> Layer? { shown }
  func convert(_ rect: CGRect, to: Layer) -> CGRect { rect }
}
class UIView {
  var bounds = CGRect(x:0,y:0,width:402,height:874), layer = Layer()
  var offset = CGPoint.zero
  weak var superview: UIView?
  func convert(_ rect: CGRect, to: UIView) -> CGRect { rect.offsetBy(dx:offset.x,dy:offset.y) }
  func isDescendant(of ancestor: UIView) -> Bool { self === ancestor }
}
class Web: UIView { var url: URL? = URL(string:"https://m.youtube.com/watch?v=abcdefghijk") }
class UIGestureRecognizer {}
class UITapGestureRecognizer: UIGestureRecognizer {}
class UIPanGestureRecognizer: UIGestureRecognizer {}
class UITouch {
  enum Kind:Int { case direct=0 };var type=Kind.direct
  var view: UIView?, point: CGPoint
  init(_ point:CGPoint, _ view:UIView? = nil){self.point=point;self.view=view}
  func location(in: UIView) -> CGPoint { point }
}
enum StartupDiagnostics { static let enabled=false; static func videoMark(_ row:[String:Any]){} }
enum YouTubeWebView {
  ${["isYouTube", "isWatchPage", "videoID"].map(name => shipping("static func " + name + "(")).join("\n")}
}
class Stage: UIView {
  enum Mode { case expanded, mini, loading, closed }
  var mode=Mode.expanded, feedOpening:Int?, startupVideoID:String?="abcdefghijk"
  var player:Web! = Web(), card=UIView(), closeButton=UIView(), miniPlaybackButton=UIView(), startPlaybackButton=UIView()
  var edgeBack=UIPanGestureRecognizer(), drag=UIPanGestureRecognizer(), cardTap=UITapGestureRecognizer()
  var playerOverlayOpen=false,playerFullscreen=false,customFullscreenID:String?
  var customFullscreenEnter:NSObject?,customFullscreenExit:NSObject?
  var dragging=false, dragCanTakeOver=false, awaitingViewportGeometry=false
  var revealer:NSObject?,settler:NSObject?,dismisser:NSObject?,settlingBetweenModes=false
  var loadTicket=1,viewportGeneration=0
  var videoRect=CGRect(x:0,y:110,width:402,height:226)
  var videoSeekGeometry:(rect:CGRect,videoID:String,ticket:Int,viewport:Int)?
  var dragPosition:PlayerGesturePolicy.Position? { mode == .expanded ? .expanded : (mode == .mini ? .mini:nil) }
  ${properties}
  ${owns || "func videoSeekOwnsEdgeContact(_ contact:CGPoint)->Bool{return false}"}
  ${remember || "func rememberVideoSeekGeometry(_ rect:CGRect,videoID:String,playerVideoID:String?,hasVideo:Bool,viewport:CGSize){videoSeekGeometry=(rect,videoID,loadTicket,viewportGeneration)}"}
  ${shipping("func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch)")}
  func confirm(_ id:String="abcdefghijk", _ actual:String?="abcdefghijk", _ has:Bool=true, _ viewport:CGSize?=nil) {
    rememberVideoSeekGeometry(videoRect,videoID:id,playerVideoID:actual,hasVideo:has,viewport:viewport ?? player.bounds.size)
  }
  func receives(_ point:CGPoint)->Bool { gestureRecognizer(edgeBack,shouldReceive:UITouch(point)) }
}
var failures:[String]=[]
func expect(_ value:Bool,_ message:String){if !value{failures.append(message);print("FAILED: "+message)}}
for x:CGFloat in [0,8,12] {
  let s=Stage();s.confirm()
  expect(!s.receives(CGPoint(x:x,y:177)),"physical picture at left edge belongs to JS Seek")
  expect(s.receives(CGPoint(x:x,y:100)),"left edge outside picture retains native Back")
}
let s=Stage();s.confirm()
expect(!s.receives(CGPoint(x:13,y:100)),"native Back remains inside the12pt band")
expect(!s.receives(CGPoint(x:200,y:177)),"middle picture is never a native edge start")
for kind in ["loading","mini","closed","overlay","native-fullscreen","custom-fullscreen"] {
  let q=Stage();q.confirm()
  if kind=="loading" {q.mode = .loading}
  if kind=="mini" {q.mode = .mini}
  if kind=="closed" {q.mode = .closed}
  if kind=="overlay" {q.playerOverlayOpen=true}
  if kind=="native-fullscreen" {q.playerFullscreen=true}
  if kind=="custom-fullscreen" {q.customFullscreenID="abcdefghijk"}
  expect(!q.videoSeekOwnsEdgeContact(CGPoint(x:8,y:177)),kind+" must not claim stable-picture priority")
  expect(!q.receives(CGPoint(x:8,y:177)),kind+" retains existing admission exclusion")
}
for kind in ["opening","loading-opening","revealing","settling","dismissing","dragging","awaiting-viewport","fullscreen-enter","fullscreen-exit"] {
  let q=Stage();q.confirm()
  if kind=="opening" || kind=="loading-opening" {q.feedOpening=1}
  if kind=="loading-opening" {q.mode = .loading}
  if kind=="revealing" {q.revealer=NSObject()}
  if kind=="settling" {q.settler=NSObject()}
  if kind=="dismissing" {q.dismisser=NSObject()}
  if kind=="dragging" {q.dragging=true}
  if kind=="awaiting-viewport" {q.awaitingViewportGeometry=true}
  if kind=="fullscreen-enter" {q.customFullscreenEnter=NSObject()}
  if kind=="fullscreen-exit" {q.customFullscreenExit=NSObject()}
  expect(!q.videoSeekOwnsEdgeContact(CGPoint(x:8,y:177)),kind+" remains with previous motion admission")
  expect(q.receives(CGPoint(x:8,y:177)),kind+" does not introduce a new native Back exclusion")
}
for kind in ["missing-geometry","new-route","old-ticket","old-viewport","pending-rect","no-owner","non-watch","absent-player"] {
  let q=Stage();q.confirm()
  if kind=="missing-geometry" {q.videoSeekGeometry=nil}
  if kind=="new-route" {q.player.url=URL(string:"https://m.youtube.com/watch?v=zyxwvutsrqp");q.startupVideoID="zyxwvutsrqp"}
  if kind=="old-ticket" {q.loadTicket+=1}
  if kind=="old-viewport" {q.viewportGeneration+=1}
  if kind=="pending-rect" {q.videoRect.origin.y=120}
  if kind=="no-owner" {q.startupVideoID=nil}
  if kind=="non-watch" {q.player.url=URL(string:"https://m.youtube.com/results?search_query=x")}
  if kind=="absent-player" {q.player=nil}
  expect(!q.videoSeekOwnsEdgeContact(CGPoint(x:8,y:177)),kind+" cannot acquire a stale cached picture")
}
let changed=Stage();changed.confirm();changed.player.url=URL(string:"https://m.youtube.com/watch?v=zyxwvutsrqp");changed.startupVideoID="zyxwvutsrqp"
changed.confirm("zyxwvutsrqp","zyxwvutsrqp")
expect(changed.videoSeekOwnsEdgeContact(CGPoint(x:8,y:177)),"same physical box can be newly confirmed for its actual new video")
let fresh=Stage();fresh.confirm();fresh.loadTicket+=1;fresh.viewportGeneration+=1;fresh.confirm()
expect(fresh.videoSeekOwnsEdgeContact(CGPoint(x:8,y:177)),"a fresh matching ticket and viewport restores stable Seek priority")
for kind in ["missing-video","wrong-media","unknown-media","invalid-rect"] {
  let q=Stage();q.confirm()
  if kind=="invalid-rect" {q.videoRect.size.width=0}
  q.confirm("abcdefghijk",kind=="wrong-media" ? "zyxwvutsrqp":kind=="unknown-media" ? nil:"abcdefghijk",kind != "missing-video")
  expect(!q.videoSeekOwnsEdgeContact(CGPoint(x:8,y:177)),kind+" full report cannot confirm picture ownership")
}
let stale=Stage();stale.confirm();stale.confirm("abcdefghijk","abcdefghijk",true,CGSize(width:800,height:402))
expect(stale.videoSeekOwnsEdgeContact(CGPoint(x:8,y:177)),"ignored late old-viewport report must not revoke the last current confirmed box")
let shifted=Stage();shifted.confirm();shifted.player.offset=CGPoint(x:25,y:40)
expect(shifted.receives(CGPoint(x:8,y:177)),"use physical converted picture rather than unconverted cache")
expect(shifted.videoSeekOwnsEdgeContact(CGPoint(x:30,y:177)),"shifted current picture accepts its actual visible coordinate")
let clipped=Stage();clipped.videoRect.origin.y = -100;clipped.confirm()
expect(clipped.videoSeekOwnsEdgeContact(CGPoint(x:8,y:12)),"clipped visible portion belongs to Seek")
expect(clipped.receives(CGPoint(x:8,y:200)),"outside clipped physical picture retains Back")
let fallback=Stage();fallback.videoRect = .zero;fallback.confirm()
expect(!fallback.videoSeekOwnsEdgeContact(CGPoint(x:8,y:12)),"16:9 fallback must never acquire JS priority")
expect(!s.videoSeekOwnsEdgeContact(CGPoint(x:CGFloat.nan,y:177)),"nonfinite contact rejected")
let invalid=Stage();invalid.videoRect.origin.y=CGFloat.infinity;invalid.confirm()
expect(!invalid.videoSeekOwnsEdgeContact(CGPoint(x:8,y:177)),"nonfinite reported picture rejected")
expect(s.gestureRecognizer(s.cardTap,shouldReceive:UITouch(CGPoint(x:8,y:177))),"card tap admission is unchanged")
expect(!s.gestureRecognizer(s.cardTap,shouldReceive:UITouch(CGPoint(x:8,y:177),s.closeButton)),"native close remains excluded from free card taps")
expect(s.gestureRecognizer(s.drag,shouldReceive:UITouch(CGPoint(x:100,y:177))),"ordinary vertical native picture pan remains eligible")
s.customFullscreenID="abcdefghijk"
expect(!s.gestureRecognizer(s.drag,shouldReceive:UITouch(CGPoint(x:100,y:177))),"custom fullscreen keeps vertical and Zoom ownership")
if !failures.isEmpty {print("NATIVE_VIDEO_SEEK_PRIORITY_FAILED: "+String(failures.count));exit(1)}
print("NATIVE_VIDEO_SEEK_PRIORITY_OK")
`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-seek-priority-test-"));
  try {
    const filename = path.join(directory, "SeekPriority.swift");
    const policy = fs.readFileSync(path.join(app,"PlayerGesturePolicy.swift"),"utf8");
    const viewport = fs.readFileSync(path.join(app,"PlayerViewportPolicy.swift"),"utf8");
    fs.writeFileSync(filename, policy + "\n" + viewport + "\n" + script);
    const result = spawnSync(compiler.stdout.trim(), [filename], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_VIDEO_SEEK_PRIORITY_OK/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
