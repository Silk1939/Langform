const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function block(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  const open = source.indexOf('{', start);
  let end = open + 1, depth = 1;
  while (depth && end < source.length) {
    depth += (source[end] === '{') - (source[end] === '}'); end++;
  }
  return source.slice(start, end);
}

test('Shipping staged exit holds WK source until exact ACK, keeps Card ownership and bounds cancellation', {
  skip: process.platform !== 'darwin', timeout: 70000,
}, t => {
  const compiler = spawnSync('/usr/bin/xcrun', ['--find', 'swift'], { encoding: 'utf8' });
  if (compiler.status !== 0) return t.skip('Swift toolchain unavailable');
  const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/YouTubeWebView.swift'), 'utf8');
  const methods = ['fullscreenPlayerViewport', 'applyFullscreenSurface', 'beginNativeRotation', 'cancelNativeRotation',
    'requestFullscreenExitMotion', 'releaseFullscreenExitViewport', 'cancelFullscreenExitMotion', 'fullscreenExitMotionReady',
    'beginCustomFullscreenExit', 'confirmCustomFullscreenExit', 'confirmCustomFullscreenEnter', 'requestPlayerOrientation', 'resetCustomFullscreen']
    .map(name => block(source, 'func ' + name + '(')).join('\n');
  const structs = ['CustomFullscreenEnter', 'CustomFullscreenExit'].map(name =>
    block(source, 'private struct ' + name).replace('private struct', 'struct')).join('\n');
  const layout = block(block(source, 'override func layoutSubviews()'), 'if let player {');
  const policy = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/PlayerViewportPolicy.swift'), 'utf8');
  const swift = `
import Foundation
import CoreGraphics
import CoreFoundation
enum PlayerGesturePolicy { enum Position { case mini,expanded } }
${policy}
var clock=0.0
class DispatchWorkItem { let action:()->Void; var cancelled=false; init(block:@escaping()->Void){action=block};func cancel(){cancelled=true} }
struct Deadline {var when:Double;static func now()->Deadline{Deadline(when:clock)};static func +(a:Deadline,b:Double)->Deadline{Deadline(when:a.when+b)} }
class DispatchQueue {static let main=DispatchQueue();var work=[(Double,DispatchWorkItem)]();func asyncAfter(deadline:Deadline,execute:DispatchWorkItem){work.append((deadline.when,execute))};func run(at time:Double){clock=time;let ready=work.filter{$0.0<=clock};work=work.filter{$0.0>clock};for (_,item) in ready where !item.cancelled {item.action()}} }
enum StartupDiagnostics {static let enabled=false;static var rows=[[String:Any]]();static func videoMark(_ row:[String:Any]){rows.append(row)} }
class Layer {var bounds=CGRect(x:0,y:0,width:874,height:402),position=CGPoint(x:437,y:201),cornerRadius:CGFloat=0,borderWidth:CGFloat=0;var shown:Layer?;func presentation()->Layer?{shown} }
class UIView {enum AnimationCurve{case easeInOut,easeIn,easeOut,linear};static func performWithoutAnimation(_ block:()->Void){block()} }
class Surface {var bounds=CGRect(x:0,y:0,width:874,height:402),center=CGPoint(x:437,y:201),transform=CGAffineTransform.identity,alpha:CGFloat=1,layer=Layer() }
class WKWebView:Surface {
 var url=URL(string:"https://m.youtube.com/watch?v=abcdefghijk"),scripts=[String](),pending=[(String,(Any?,Error?)->Void)]()
 var motionResult:Any?=true,motionError:Error?,deferMotion=false,deferCancel=false
 func evaluateJavaScript(_ source:String,completionHandler:((Any?,Error?)->Void)?=nil){scripts.append(source);guard let completionHandler else{return};let cancel=source.contains("cancelExitMotion");if cancel ? deferCancel : deferMotion {pending.append((source,completionHandler))}else{completionHandler(cancel ? true:motionResult,motionError)}}
}
enum UIInterfaceOrientationMask{case portrait,landscape}
enum Orientation{case portrait,landscape;var isPortrait:Bool{self == .portrait}}
struct Geometry{let mask:UIInterfaceOrientationMask;static func iOS(interfaceOrientations:UIInterfaceOrientationMask)->Geometry{Geometry(mask:interfaceOrientations)}}
class Scene{var interfaceOrientation=Orientation.landscape,rejected=false;func requestGeometryUpdate(_ geometry:Geometry,errorHandler:(Error)->Void){if rejected{errorHandler(NSError(domain:"qa",code:1))}} }
class Controller{func setNeedsUpdateOfSupportedInterfaceOrientations(){} }
class Window{var rootViewController:Controller?=Controller(),windowScene:Scene?=Scene()}
class RotationContext{var isCancelled=false}
class UIViewControllerTransitionCoordinator {
 var context=RotationContext(),completions=[(RotationContext)->Void](),isAnimated=true,transitionDuration=0.35,percentComplete=0.0,completionCurve=UIView.AnimationCurve.easeInOut
 func animate(alongsideTransition:((RotationContext)->Void)?,completion:@escaping(RotationContext)->Void)->Bool{alongsideTransition?(context);completions.append(completion);return true}
 func finish(){completions.forEach{$0(context)}}
}
enum YouTubeWebView{static func videoID(_ url:URL?)->String?{guard let url,["m.youtube.com","www.youtube.com","youtube.com"].contains(url.host ?? ""),url.path=="/watch"else{return nil};return URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems?.first{$0.name=="v"}?.value}}
class Stage {
 enum Mode{case closed,loading,expanded,mini};var mode=Mode.expanded,progress:CGFloat=0,dragging=false,playerFullscreen=true
 var player:WKWebView?=WKWebView(),card=Surface(),closeButton=Surface(),miniPlaybackButton=Surface(),collapseButton=Surface(),window:Window?=Window()
 var bounds=CGRect(x:0,y:0,width:874,height:402),playerLayoutSize=CGSize(width:874,height:402),loadTicket=1,customFullscreenID:String?="abcdefghijk"
 ${structs}
 var customFullscreenEnter:CustomFullscreenEnter?,customFullscreenExit:CustomFullscreenExit?
 var activeRotationCoordinator:UIViewControllerTransitionCoordinator?,nativeRotationGeneration=0,fullscreenCardRotationGeneration:Int?,nativeRotationTarget:CGSize?,nativeRotationDeadlineMilliseconds:Double?,nativeRotationCSSCurve:String?,fullscreenExitMotionTimeout:DispatchWorkItem?
 var fullscreenGeometryTrace:(videoID:String,token:String,ticket:Int,beganAt:TimeInterval,rows:Int)?,fullscreenGeometryDirection="exit",onFullscreen:((Bool)->Void)?
 var layouts=0,resets=0,playerInsetsChanged=false
 var fullscreenSnapLastAt = -Double.infinity
 func startFullscreenPresentation(videoID:String,token:String,direction:String){}
 func resetPlayerForViewportChange(){resets += 1};func updateChrome(){};func measureVideo(after:Double,_ done:()->Void){done()};func updatePlaybackControls(){}
 func setNeedsLayout(){layouts += 1};func layoutIfNeeded(){${layout}}
 func apply(_ value:CGFloat){_ = applyFullscreenSurface(value)}
 ${methods}
}
func expect(_ value:Bool,_ message:String){if !value{print("FAILED: "+message);exit(1)}}
let sourceSize=CGSize(width:874,height:402),target=CGSize(width:402,height:874)
func request(_ token:String="exit")->[String:Any]{["kind":"exit-request","videoID":"abcdefghijk","token":token,"href":"https://m.youtube.com/watch?v=abcdefghijk"]}
func ack(_ token:String="exit",ticket:Int=1)->[String:Any]{["kind":"exit-motion-ready","videoID":"abcdefghijk","token":token,"href":"https://m.youtube.com/watch?v=abcdefghijk","requestTicket":ticket,"width":402,"height":874]}
func begin(_ stage:Stage)->UIViewControllerTransitionCoordinator {
 stage.onFullscreen={_ in stage.bounds=CGRect(origin:.zero,size:target);stage.layoutIfNeeded()}
 stage.beginCustomFullscreenExit(request())
 expect(stage.player!.bounds.size==sourceSize,"source WK bounds survive status-bar/destination Stage relayout before controller rotation")
 let rotation=UIViewControllerTransitionCoordinator();stage.beginNativeRotation(to:target,coordinator:rotation)
 stage.window!.windowScene!.interfaceOrientation = .portrait;stage.layoutIfNeeded();return rotation
}
let stage=Stage()
let ownedRotation=begin(stage)
expect(stage.customFullscreenExit!.motionViewport==target && stage.player!.bounds.size==sourceSize,"accepted API preserves source viewport until ACK")
let script=stage.player!.scripts.first{$0.contains("prepareExitMotion")}!
let args=script.components(separatedBy:"null, ")[1].dropLast(1)
let arguments=try! JSONSerialization.jsonObject(with:Data(args.utf8)) as! [Any]
expect(arguments.count==6 && arguments[5] as? Int==1 && (arguments[4] as! Double)>Date().timeIntervalSince1970*1000,"request supplies actual coordinator deadline and native request ticket")
expect(stage.card.bounds.size==target && stage.fullscreenCardRotationGeneration != nil,"Card destination belongs to the coordinator")
stage.bounds=CGRect(x:0,y:0,width:650,height:650);stage.apply(0)
expect(stage.card.bounds.size==target,"apply0 cannot clobber the active coordinator clip with an intermediate Stage model")
stage.bounds=CGRect(origin:.zero,size:target)
expect(stage.player!.center==CGPoint(x:437,y:201) && stage.player!.transform==CGAffineTransform.identity,"held WK remains unscaled at origin0 even in portrait Card model")
for key in ["token","videoID","href","requestTicket","width","height"] {
 var invalid=ack()
 switch key{case "token":invalid[key]="old";case "videoID":invalid[key]="lmnopqrstuv";case "href":invalid[key]="https://example.com/watch?v=abcdefghijk";case "requestTicket":invalid[key]=0;case "width":invalid[key]=403;default:invalid[key]=875}
 stage.fullscreenExitMotionReady(invalid)
 expect(stage.player!.bounds.size==sourceSize && !stage.customFullscreenExit!.motionReady,"mismatching ACK cannot resize: "+key)
}
for invalidTicket:Any in [true,Double.nan,1.2,Double.infinity] {var invalid=ack();invalid["requestTicket"]=invalidTicket;stage.fullscreenExitMotionReady(invalid);expect(!stage.customFullscreenExit!.motionReady,"boolean/fractional/nonfinite tickets are rejected")}
stage.fullscreenExitMotionReady(ack())
expect(stage.customFullscreenExit!.motionReady && stage.player!.bounds.size==target,"only exact authenticated final-pose ACK shrinks WK viewport")
expect(stage.player!.scripts.contains{$0.contains("prepareExit.apply")} && !stage.player!.scripts.contains{$0.contains("finishExit.apply")},"ready pose prepares natural geometry while actual UIKit completion remains required")
ownedRotation.finish()
expect(stage.player!.scripts.contains{$0.contains("finishExit.apply")} && stage.activeRotationCoordinator==nil,"actual rotation completion permits natural finalization")

let late=Stage();let actualLateRotation=begin(late)
actualLateRotation.finish();expect(late.player!.bounds.size==sourceSize,"native completion alone does not fake JS final-pose ACK")
late.fullscreenExitMotionReady(ack());expect(late.player!.bounds.size==target && late.player!.scripts.contains{$0.contains("finishExit.apply")},"late valid ACK finishes after actual rotation, without second native tween")

for error in [false,true] {
 let unsupported=Stage();unsupported.player!.motionResult=false;if error{unsupported.player!.motionError=NSError(domain:"qa",code:1)}
 let unsupportedRotation=begin(unsupported)
 expect(unsupported.customFullscreenExit!.sourceViewport==nil && !unsupported.customFullscreenExit!.motionReady && unsupported.player!.bounds.size==target,"API false/error uses natural fallback without forged ACK")
 expect(!unsupported.player!.scripts.contains{$0.contains("finishExit.apply")},"fallback does not bypass native rotation completion")
 unsupportedRotation.finish();expect(unsupported.player!.scripts.contains{$0.contains("finishExit.apply")},"actual completion releases unsupported-motion fallback")
}

let stalled=Stage();stalled.player!.deferCancel=true;let stalledRotation=begin(stalled)
DispatchQueue.main.run(at:10)
expect(stalled.customFullscreenExit!.cancellingMotion && stalled.player!.bounds.size==sourceSize,"overdue JS motion stays held while cancellation is requested")
stalled.fullscreenExitMotionReady(ack());expect(!stalled.customFullscreenExit!.motionReady,"late ACK is invalid after native cancellation begins")
DispatchQueue.main.run(at:11)
expect(stalled.customFullscreenExit!.sourceViewport==nil && stalled.player!.bounds.size==target && !stalled.customFullscreenExit!.motionReady,"missing cancel callback has a bounded abort without inventing final-pose readiness")
expect(!stalled.player!.scripts.contains{$0.contains("finishExit.apply")},"bounded script abort still cannot finish live native rotation")
stalledRotation.finish()

let navigated=Stage();navigated.player!.deferMotion=true;let oldRotation=begin(navigated)
navigated.loadTicket += 1;navigated.cancelNativeRotation();navigated.customFullscreenExit=Stage.CustomFullscreenExit(videoID:"abcdefghijk",token:"exit",ticket:2,sourceViewport:sourceSize,motionViewport:target,motionGeneration:navigated.nativeRotationGeneration)
navigated.fullscreenExitMotionReady(ack(ticket:1))
expect(!navigated.customFullscreenExit!.motionReady,"old same-ID/same-token ACK cannot authorize a new navigation ticket")
oldRotation.finish();navigated.player!.pending.forEach{$0.1(false,nil)}
expect(navigated.customFullscreenExit!.sourceViewport==sourceSize,"stale completion/error callback cannot release new request ownership")

let aborted=Stage();let abortedRotation=begin(aborted);abortedRotation.finish()
expect(aborted.player!.bounds.size==sourceSize,"completed UIKit rotation can still hold source before JS ACK")
let layoutsBeforeAbort=aborted.layouts
aborted.resetCustomFullscreen()
expect(aborted.layouts>layoutsBeforeAbort && aborted.customFullscreenExit==nil,"pre-ACK fullscreen reset explicitly schedules native layout after releasing viewport hold")
aborted.layoutIfNeeded()
expect(aborted.player!.bounds.size==target,"next scheduled native layout restores destination WK bounds after inline abort")
aborted.fullscreenExitMotionReady(ack());abortedRotation.finish()
expect(aborted.customFullscreenExit==nil && aborted.player!.bounds.size==target,"late ACK/completion cannot reintroduce abandoned source viewport")
print("NATIVE_STAGED_FULLSCREEN_OK")
`;
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-staged-fullscreen-'));
  try {
    const file = path.join(folder, 'StagedFullscreen.swift'); fs.writeFileSync(file, swift);
    const run = spawnSync(compiler.stdout.trim(), [file], { encoding: 'utf8', timeout: 60000 });
    assert.equal(run.error, undefined, String(run.error));
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /NATIVE_STAGED_FULLSCREEN_OK/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
