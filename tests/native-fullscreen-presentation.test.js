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
class CALayer {
    var bounds = CGRect(x:0,y:0,width:402,height:874), position = CGPoint(x:201,y:437)
    var transform = CGAffineTransform.identity, presented: CALayer?
    func presentation() -> CALayer? { presented }
    func affineTransform() -> CGAffineTransform { transform }
}
class UIView: NSObject {
    var layer = CALayer(), window: UIWindow?
    struct Insets { var top: CGFloat = 62 }
    var safeAreaInsets = Insets()
}
class WKWebView: UIView { var url = URL(string:"https://m.youtube.com/watch?v=abcdefghijk") }
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
    var mode = Mode.expanded, player: WKWebView? = WKWebView(), card = UIView(), loadTicket = 3
    struct Exit { var sourceViewport:CGSize?;var motionViewport:CGSize?;var motionReady=false }
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
clock += 0.1;first.fire()
let row=StartupDiagnostics.rows.last!
expect(row["event"] as? String=="fullscreen-native-presentation" && row["direction"] as? String=="enter","display callback emits its captured direction")
expect(row["cardModelBoundsWidth"] as? Double==402 && row["cardPresentationBoundsWidth"] as? Double==874,"reader records independent model and actual presentation bounds")
expect(row["rootWindowPresentationTransformB"] as? Double==1 && row["rootWindowPresentationTransformTX"] as? Double==20,"root window affine presentation is preserved")
expect(row["stageHasPresentation"] as? Bool==false && row["stagePresentationBoundsWidth"]==nil,"missing presentation is not silently replaced by model geometry")
expect(row["coordinatorAvailable"] as? Bool==true && row["coordinatorIsAnimated"] as? Bool==true && row["coordinatorPercentComplete"] as? Double==0.5,"live coordinator metadata accompanies the same sample")
expect(abs((row["nativeSampleMilliseconds"] as? Double ?? 0)-100)<0.01 && row["nativeSampleUptime"] as? Double==clock,"sample timestamp belongs to capture rather than later log receipt")
stage.startFullscreenPresentation(videoID:"abcdefghijk",token:"exit",direction:"exit")
let replacement=stage.fullscreenPresentationLink!
expect(first.invalidated && replacement !== first,"new fullscreen token retires the old link")
stage.sampleFullscreenPresentation(first)
expect(stage.fullscreenPresentationLink===replacement,"stale callback cannot stop a new owner")
stage.activeRotationCoordinator=nil
clock += 0.1;replacement.fire()
expect(StartupDiagnostics.rows.last!["coordinatorAvailable"] as? Bool==false,"unavailable coordinator is explicitly recorded")
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
