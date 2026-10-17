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
    depth += (source[end] === "{") - (source[end] === "}");
    end++;
  }
  return source.slice(start, end);
}

test("Fullscreen display-time diagnostics distinguish presentation, stop stale lifecycles and keep no Stage", {
  skip: process.platform !== "darwin", timeout: 70000,
}, t => {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift toolchain unavailable");
  const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/YouTubeWebView.swift"), "utf8");
  const methods = ["startFullscreenPresentation", "stopFullscreenPresentation", "sampleFullscreenPresentation", "cancelVideoProbe"]
    .map(name => declaration(source, "func " + name + "(")).join("\n");
  const target = declaration(source, "private final class FullscreenPresentationTarget:");
  // Execute the shipping reader/weak target/lifecycle code with a virtual
  // display clock and separately controlled model/presentation layers. This
  // proves the capture semantics and bounds; it is not UIKit rotation QA.
  const swift = `
import Foundation
import CoreGraphics
var clock: Double = 10
func CACurrentMediaTime() -> Double { clock }
enum StartupDiagnostics {
    static var enabled = false, rows = [[String:Any]]()
    static func videoMark(_ row: [String:Any]) { rows.append(row) }
    static func mark(_ name: String, once: Bool = false) {}
}
class UIApplication {
    enum State { case active, background }
    static let shared = UIApplication()
    var applicationState = State.active
}
class UITraitCollection { var dark = false }
class UIColor {
    var values: [CGFloat], convertible = true
    var resolved: UIColor?
    init(_ values: [CGFloat]) { self.values = values }
    init(cgColor: CGColor) { values = cgColor.components ?? [] }
    func resolvedColor(with traits: UITraitCollection) -> UIColor { traits.dark ? resolved ?? self : self }
    func getRed(_ red: inout CGFloat, green: inout CGFloat, blue: inout CGFloat, alpha: inout CGFloat) -> Bool {
        guard convertible, values.count == 4 else { return false }
        red=values[0];green=values[1];blue=values[2];alpha=values[3];return true
    }
}
class CALayer {
    var bounds = CGRect(x:0,y:0,width:402,height:874), position = CGPoint(x:201,y:437)
    var transform = CGAffineTransform.identity, presented: CALayer?
    var backgroundColor: CGColor?, opacity: Float = 1, isHidden = false, isOpaque = false
    func presentation() -> CALayer? { presented }
    func affineTransform() -> CGAffineTransform { transform }
}
class UIView: NSObject {
    var layer = CALayer(), window: UIWindow?
    var backgroundColor: UIColor?, traitCollection = UITraitCollection(), alpha: CGFloat = 1, isHidden = false, isOpaque = false
    struct Insets { var top: CGFloat = 62 }
    var safeAreaInsets = Insets()
}
class WKWebView: UIView {
    var url = URL(string:"https://m.youtube.com/watch?v=abcdefghijk"), scrollView = UIView()
    var underPageBackgroundColor = UIColor([0,0,0,1])
}
class Coordinator {
    var isAnimated = true, transitionDuration: Double = 0.35, percentComplete: CGFloat = 0.5
}
class Controller { var viewIfLoaded: UIView? = UIView(), transitionCoordinator: Coordinator? = Coordinator() }
class UIWindow: UIView { var rootViewController: Controller? = Controller() }
@objc class CADisplayLink: NSObject {
    static var links = [CADisplayLink]()
    var target: NSObject?, selector: Selector, invalidated = false, attached = false
    var preferredFramesPerSecond = 0, timestamp: Double = 0, targetTimestamp: Double = 0
    init(target: Any, selector: Selector) { self.target=target as? NSObject;self.selector=selector;super.init();Self.links.append(self) }
    func add(to loop: RunLoop, forMode mode: RunLoop.Mode) { attached=true }
    func invalidate() { invalidated=true;target=nil }
    func fire() { timestamp=clock-0.002;targetTimestamp=clock+0.015;_ = target?.perform(selector,with:self) }
}
enum YouTubeWebView {
    static func videoID(_ url: URL?) -> String? {
        guard let url,url.host=="m.youtube.com",url.path=="/watch" else{return nil}
        return URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems?.first{$0.name=="v"}?.value
    }
}
class Probe {
    enum State { case waitingForFeed, waitingForVideo, waitingForPlayback, running }
    var state = State.running
    func cancel() {}
}
class PlayerStage: UIView {
    enum Mode { case expanded, mini, closed }
    var mode = Mode.expanded, player: WKWebView? = WKWebView(), card = UIView(), feed: WKWebView? = WKWebView(), loadTicket = 3
    struct Exit { var sourceViewport:CGSize?;var motionViewport:CGSize?;var motionReady=false;var preRotationMotion=false;var diagnosticMotionStarted=false }
    var customFullscreenEnter: Int?, customFullscreenExit: Exit?, playerFullscreen = true
    var activeRotationCoordinator: Coordinator?
    var nativeRotationTarget:CGSize?
    var fullscreenPresentationLink: CADisplayLink?
    var fullscreenPresentationTrace: (videoID:String,token:String,ticket:Int,direction:String,beganAt:TimeInterval,frames:Int)?
    var videoProbe: Probe?, interactionProbe: Probe?
    var videoProbeWork: DispatchWorkItem?, videoProbeTimeout: DispatchWorkItem?, videoProbeTicket: Int?, videoProbePlayCheck: Int?
    var interactionProbeWork: DispatchWorkItem?, interactionProbeTimeout: DispatchWorkItem?
    func cancelFullscreenDiagnosticProbe() {}
    ${target}
    ${methods}
}
func expect(_ value: Bool, _ name: String) { if !value {print("FAILED: "+name);exit(1)} }
let stage = PlayerStage();stage.window=UIWindow()
stage.activeRotationCoordinator=Coordinator()
stage.startFullscreenPresentation(videoID:"abcdefghijk",token:"entry",direction:"enter")
expect(stage.fullscreenPresentationLink==nil && CADisplayLink.links.isEmpty,"normal launches allocate no display link")
StartupDiagnostics.enabled=true
stage.startFullscreenPresentation(videoID:"wrongvideo",token:"entry",direction:"enter")
expect(stage.fullscreenPresentationLink==nil,"foreign video cannot begin sampling")
stage.startFullscreenPresentation(videoID:"abcdefghijk",token:"entry",direction:"enter")
let first=stage.fullscreenPresentationLink!
expect(first.attached && first.preferredFramesPerSecond==60,"diagnostic link runs in the common display loop at bounded rate")
let picture=CALayer();picture.bounds=CGRect(x:0,y:0,width:874,height:402);picture.position=CGPoint(x:437,y:201)
picture.transform=CGAffineTransform(a:0,b:1,c:-1,d:0,tx:20,ty:30)
stage.card.layer.presented=picture
stage.window!.layer.presented=picture
stage.player!.backgroundColor=UIColor([0,0,0,1])
stage.player!.scrollView.backgroundColor=UIColor([0.2,0.3,0.4,0.5])
stage.feed!.backgroundColor=UIColor([1,1,1,1]);stage.feed!.alpha=0.7;stage.feed!.isHidden=true;stage.feed!.isOpaque=true
stage.backgroundColor=UIColor([1,1,1,1]);stage.backgroundColor!.resolved=UIColor([0,0,0,1]);stage.traitCollection.dark=true
stage.card.layer.backgroundColor=CGColor(red:1,green:1,blue:1,alpha:1)
picture.backgroundColor=CGColor(red:0,green:0,blue:0,alpha:0.25);picture.opacity=0.6;picture.isHidden=true;picture.isOpaque=true
clock += 0.1;first.fire()
let row=StartupDiagnostics.rows.last!
expect(row["event"] as? String=="fullscreen-native-presentation" && row["direction"] as? String=="enter","display callback emits its captured direction")
expect(row["nativeTraceMotionWindow"] as? Bool==false,"request-time presentation window is explicit")
expect(row["cardModelBoundsWidth"] as? Double==402 && row["cardPresentationBoundsWidth"] as? Double==874,"reader records independent model and actual presentation bounds")
expect(row["rootWindowPresentationTransformB"] as? Double==1 && row["rootWindowPresentationTransformTX"] as? Double==20,"root window affine presentation is preserved")
expect(row["stageHasPresentation"] as? Bool==false && row["stagePresentationBoundsWidth"]==nil,"missing presentation is not silently replaced by model geometry")
expect(row["coordinatorAvailable"] as? Bool==true && row["coordinatorIsAnimated"] as? Bool==true && row["coordinatorPercentComplete"] as? Double==0.5,"live coordinator metadata accompanies the same sample")
expect(abs((row["nativeSampleMilliseconds"] as? Double ?? 0)-100)<0.01 && row["nativeSampleUptime"] as? Double==clock,"sample timestamp belongs to capture rather than later log receipt")
expect(row["playerBackgroundRed"] as? Double==0 && row["playerUnderPageBackgroundAlpha"] as? Double==1 && row["playerScrollBackgroundBlue"] as? Double==0.4,"player, scroll and independent under-page colors share the actual sample")
expect(row["stageBackgroundRed"] as? Double==0,"dynamic UIColor resolves using the sampled view traits")
expect(row["cardModelBackgroundRed"] as? Double==1 && row["cardPresentationBackgroundRed"] as? Double==0 && row["cardPresentationBackgroundAlpha"] as? Double==0.25,"layer model and presentation colors remain distinct")
expect(row["feedBackgroundRed"] as? Double==1 && row["feedAlpha"] as? Double==0.7 && row["feedHidden"] as? Bool==true && row["feedOpaque"] as? Bool==true,"underlying feed paint and visibility accompany bounded geometry without content")
expect(row["cardPresentationHidden"] as? Bool==true && row["cardPresentationOpaque"] as? Bool==true && abs((row["cardPresentationOpacity"] as? Double ?? 0)-0.6)<0.0001,"presentation layer paint visibility is sampled independently")
expect(row["rootViewBackgroundAvailable"] as? Bool==false && row["rootViewBackgroundRed"]==nil,"missing color is explicit and not guessed black")
for invalid in [[CGFloat.nan,0,0,1],[0,CGFloat.infinity,0,1],[-0.1,0,0,1],[0,0,1.1,1]] {
    stage.player!.backgroundColor=UIColor(invalid);clock += 0.001;first.fire()
    let invalidRow=StartupDiagnostics.rows.last!
    expect(invalidRow["playerBackgroundAvailable"] as? Bool==false && invalidRow["playerBackgroundRed"]==nil,"invalid or extended RGB is omitted rather than silently clamped")
}
stage.player!.backgroundColor=UIColor([0,0,0,1]);stage.player!.backgroundColor!.convertible=false
clock += 0.001;first.fire()
expect(StartupDiagnostics.rows.last!["playerBackgroundAvailable"] as? Bool==false,"non-RGB color is explicitly unavailable")
stage.player!.backgroundColor=nil
stage.startFullscreenPresentation(videoID:"abcdefghijk",token:"exit",direction:"exit")
let replacement=stage.fullscreenPresentationLink!
expect(first.invalidated && replacement !== first,"new fullscreen token retires the old link")
stage.sampleFullscreenPresentation(first)
expect(stage.fullscreenPresentationLink===replacement,"stale callback cannot stop a new owner")
stage.activeRotationCoordinator=nil
stage.customFullscreenExit=PlayerStage.Exit(diagnosticMotionStarted:true)
clock += 0.1;replacement.fire()
expect(StartupDiagnostics.rows.last!["coordinatorAvailable"] as? Bool==false,"unavailable coordinator is explicitly recorded")
expect(StartupDiagnostics.rows.last!["nativeTraceMotionWindow"] as? Bool==true,"motion-time presentation window remains distinguishable by typed flag")
stage.customFullscreenExit=PlayerStage.Exit(sourceViewport:CGSize(width:874,height:402),motionViewport:CGSize(width:402,height:874),motionReady:true,preRotationMotion:true,diagnosticMotionStarted:true)
clock += 0.001;replacement.fire()
expect(StartupDiagnostics.rows.last!["nativeExitViewportHeld"] as? Bool==true && StartupDiagnostics.rows.last!["nativeExitPreRotation"] as? Bool==true,"ready CSS still holds source WK bounds before native rotation begins")
stage.customFullscreenExit?.preRotationMotion=false
clock += 0.001;replacement.fire()
expect(StartupDiagnostics.rows.last!["nativeExitViewportHeld"] as? Bool==false && StartupDiagnostics.rows.last!["nativeExitPreRotation"] as? Bool==false,"matching native begin releases the ready source viewport")
stage.customFullscreenExit?.motionReady=false
clock += 0.001;replacement.fire()
expect(StartupDiagnostics.rows.last!["nativeExitViewportHeld"] as? Bool==true,"coordinator-first motion still holds its source before readiness")
stage.cancelVideoProbe()
expect(replacement.invalidated && stage.fullscreenPresentationTrace==nil,"shipping cancel lifecycle used by close/newWatch/background/stop releases the link")
for reason in 0..<5 {
    stage.mode = .expanded;stage.window=UIWindow();stage.player!.url=URL(string:"https://m.youtube.com/watch?v=abcdefghijk");UIApplication.shared.applicationState = .active
    stage.startFullscreenPresentation(videoID:"abcdefghijk",token:String(reason),direction:"exit")
    let link=stage.fullscreenPresentationLink!
    if reason==0 {stage.loadTicket += 1}
    if reason==1 {stage.player!.url=URL(string:"https://m.youtube.com/watch?v=lmnopqrstuv")}
    if reason==2 {UIApplication.shared.applicationState = .background}
    if reason==3 {stage.window=nil}
    if reason==4 {stage.mode = .mini}
    link.fire()
    expect(link.invalidated && stage.fullscreenPresentationLink==nil,"ticket, route, background, detached and mini changes cancel sampling")
}
stage.mode = .expanded;stage.window=UIWindow();stage.player!.url=URL(string:"https://m.youtube.com/watch?v=abcdefghijk");UIApplication.shared.applicationState = .active
stage.startFullscreenPresentation(videoID:"abcdefghijk",token:"bounded",direction:"exit")
let bounded=stage.fullscreenPresentationLink!,count=StartupDiagnostics.rows.count
for _ in 0..<125 {clock += 0.001;bounded.fire()}
expect(bounded.invalidated && stage.fullscreenPresentationLink==nil && StartupDiagnostics.rows.count-count==120,"120-frame cap does not depend on callback frequency")
stage.startFullscreenPresentation(videoID:"abcdefghijk",token:"timecap",direction:"exit")
let expired=stage.fullscreenPresentationLink!,beforeExpiry=StartupDiagnostics.rows.count
clock += 2.01;expired.fire()
expect(expired.invalidated && StartupDiagnostics.rows.count==beforeExpiry,"two-second cap stops before capturing overdue samples")
weak var released: PlayerStage?
var orphanLink: CADisplayLink!
do {
    let ephemeral=PlayerStage();ephemeral.window=UIWindow();released=ephemeral
    ephemeral.startFullscreenPresentation(videoID:"abcdefghijk",token:"weak",direction:"enter")
    orphanLink=ephemeral.fullscreenPresentationLink!
}
expect(released==nil,"runloop/link target has no retain cycle with Stage")
orphanLink.fire()
expect(orphanLink.invalidated,"weak target invalidates itself after Stage teardown")
print("FULLSCREEN_PRESENTATION_DIAGNOSTICS_OK")
`;
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "langform-fullscreen-presentation-"));
  try {
    const filename = path.join(folder, "Presentation.swift");
    fs.writeFileSync(filename, swift);
    const result = spawnSync(compiler.stdout.trim(), [filename], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /FULLSCREEN_PRESENTATION_DIAGNOSTICS_OK/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
