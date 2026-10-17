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

test('Shipping pre-rotation exit retains source bounds until actual matching native rotation and owns fallback', {
  skip: process.platform !== 'darwin', timeout: 70000,
}, t => {
  const compiler = spawnSync('/usr/bin/xcrun', ['--find', 'swift'], { encoding: 'utf8' });
  if (compiler.status !== 0) return t.skip('Swift toolchain unavailable');
  const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/YouTubeWebView.swift'), 'utf8');
  const methods = ['pendingPhysicalFullscreenExitSource', 'fullscreenPlayerViewport', 'applyFullscreenSurface', 'beginNativeRotation', 'cancelNativeRotation',
    'requestFullscreenExitMotion', 'releaseFullscreenExitViewport', 'cancelFullscreenExitMotion', 'fullscreenExitMotionReady',
    'beginCustomFullscreenExit', 'confirmCustomFullscreenExit', 'confirmCustomFullscreenEnter', 'requestPlayerOrientation', 'resetCustomFullscreen', 'requestFullscreenExitPortrait', 'resumeFullscreenExitAfterInactivity']
    .map(name => block(source, 'func ' + name + '(')).join('\n');
  const structs = ['CustomFullscreenEnter', 'CustomFullscreenExit', 'PendingPhysicalFullscreenExit'].map(name =>
    block(source, 'private struct ' + name).replace('private struct', 'struct')).join('\n');
  const layout = block(block(source, 'override func layoutSubviews()'), 'if let player {');
  const policy = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/PlayerViewportPolicy.swift'), 'utf8');
  const rotationPolicy = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/PlayerRotationIntentPolicy.swift'), 'utf8');
  const swift = `
import Foundation
import CoreGraphics
import CoreFoundation
enum PlayerGesturePolicy { enum Position { case mini,expanded } }
${policy}
${rotationPolicy}
var clock=0.0
class DispatchWorkItem { let action:()->Void; var cancelled=false; init(block:@escaping()->Void){action=block};func cancel(){cancelled=true} }
struct Deadline {var when:Double;static func now()->Deadline{Deadline(when:clock)};static func +(a:Deadline,b:Double)->Deadline{Deadline(when:a.when+b)} }
class DispatchQueue {static let main=DispatchQueue();var work=[(Double,DispatchWorkItem)]();func asyncAfter(deadline:Deadline,execute:DispatchWorkItem){work.append((deadline.when,execute))};func run(at time:Double){clock=time;let ready=work.filter{$0.0<=clock};work=work.filter{$0.0>clock};for (_,item) in ready where !item.cancelled {item.action()}} }
enum StartupDiagnostics {static var enabled=false;static var rows=[[String:Any]]();static func videoMark(_ row:[String:Any]){rows.append(row)} }
class Layer {var bounds=CGRect(x:0,y:0,width:874,height:402),position=CGPoint(x:437,y:201),cornerRadius:CGFloat=0,borderWidth:CGFloat=0;var shown:Layer?;func presentation()->Layer?{shown} }
class UIView {enum AnimationCurve{case easeInOut,easeIn,easeOut,linear};static func performWithoutAnimation(_ block:()->Void){block()} }
class Surface {var bounds=CGRect(x:0,y:0,width:874,height:402),center=CGPoint(x:437,y:201),transform=CGAffineTransform.identity,alpha:CGFloat=1,layer=Layer() }
class WKWebView:Surface {
 var url=URL(string:"https://m.youtube.com/watch?v=abcdefghijk"),scripts=[String](),pending=[(String,(Any?,Error?)->Void)]()
 var motionResult:Any?=true,motionError:Error?,deferMotion=false,deferCancel=false,onScript:((String)->Void)?
 func evaluateJavaScript(_ source:String,completionHandler:((Any?,Error?)->Void)?=nil){scripts.append(source);onScript?(source);guard let completionHandler else{return};let cancel=source.contains("cancelExitMotion");if cancel ? deferCancel : deferMotion {pending.append((source,completionHandler))}else{completionHandler(cancel ? true:motionResult,motionError)}}
}
class UIApplication {enum State {case active,inactive};static let shared=UIApplication();var applicationState=State.active}
enum UIInterfaceOrientationMask{case portrait,landscape}
enum Orientation{case portrait,landscape;var isPortrait:Bool{self == .portrait}}
struct Geometry{let mask:UIInterfaceOrientationMask;static func iOS(interfaceOrientations:UIInterfaceOrientationMask)->Geometry{Geometry(mask:interfaceOrientations)}}
class Scene{var interfaceOrientation=Orientation.landscape,rejected=false,deferRejection=false,requests=[UIInterfaceOrientationMask](),rejections=[(Error)->Void]();func requestGeometryUpdate(_ geometry:Geometry,errorHandler:@escaping(Error)->Void){requests.append(geometry.mask);if deferRejection{rejections.append(errorHandler)}else if rejected{errorHandler(NSError(domain:"qa",code:1))}} }
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
 var customFullscreenEnter:CustomFullscreenEnter?,customFullscreenExit:CustomFullscreenExit?,pendingPhysicalFullscreenExit:PendingPhysicalFullscreenExit?
 var activeRotationCoordinator:UIViewControllerTransitionCoordinator?,nativeRotationGeneration=0,fullscreenCardRotationGeneration:Int?,nativeRotationTarget:CGSize?,nativeRotationDeadlineMilliseconds:Double?,nativeRotationCSSCurve:String?,fullscreenExitMotionTimeout:DispatchWorkItem?
 var rotationIntentPolicy = PlayerRotationIntentPolicy()
 func finishPhysicalRotationIntent() {}
 var fullscreenGeometryTrace:(videoID:String,token:String,ticket:Int,beganAt:TimeInterval,rows:Int)?,fullscreenGeometryDirection="exit",onFullscreen:((Bool)->Void)?
 var layouts=0,resets=0,playerInsetsChanged=false
 var fullscreenSnapLastAt = -Double.infinity
 var presentationStarts=0
 func startFullscreenPresentation(videoID:String,token:String,direction:String){presentationStarts += 1}
 func resetPlayerForViewportChange(){resets += 1};func updateChrome(){};func measureVideo(after:Double,_ done:()->Void){done()};func updatePlaybackControls(){}
 func setNeedsLayout(){layouts += 1};func layoutIfNeeded(){${layout}}
 func apply(_ value:CGFloat){_ = applyFullscreenSurface(value)}
 ${methods}
}
var checks=0
func expect(_ value:Bool,_ message:String){checks += 1;if !value{print("FAILED: "+message);exit(1)}}
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

let stage=Stage();var statusChanges=0
stage.onFullscreen={_ in statusChanges += 1;stage.layoutIfNeeded()}
stage.beginCustomFullscreenExit(request())
expect(stage.window!.windowScene!.requests.isEmpty,"prestaged CSS starts before any UIKit orientation request")
expect(statusChanges==0,"status-bar allocation remains source-stable during pre-rotation interpolation")
expect(stage.player!.bounds.size==sourceSize && stage.customFullscreenExit?.motionViewport==target,"accepted prestage holds source WK viewport")
let script=stage.player!.scripts.first{$0.contains("prepareExitMotion")}!
let args=script.components(separatedBy:"null, ")[1].dropLast(1)
let arguments=try! JSONSerialization.jsonObject(with:Data(args.utf8)) as! [Any]
expect(arguments.count==6 && arguments[5] as? Int==1 && (arguments[4] as! Double)-Date().timeIntervalSince1970*1000 <= 205,"prestage has a bounded200ms deadline and original request ticket")
stage.layoutIfNeeded()
expect(stage.player!.bounds.size==sourceSize,"ordinary layout cannot release the source while CSS is pending")
for key in ["token","videoID","href","requestTicket","width","height"] {
 var invalid=ack()
 switch key {case "token":invalid[key]="old";case "videoID":invalid[key]="lmnopqrstuv";case "href":invalid[key]="https://example.com/watch?v=abcdefghijk";case "requestTicket":invalid[key]=0;case "width":invalid[key]=403;default:invalid[key]=875}
 stage.fullscreenExitMotionReady(invalid)
 expect(stage.window!.windowScene!.requests.isEmpty && stage.player!.bounds.size==sourceSize,"invalid ACK cannot start rotation: "+key)
}
for invalidTicket:Any in [true,Double.nan,1.2,Double.infinity] {var invalid=ack();invalid["requestTicket"]=invalidTicket;stage.fullscreenExitMotionReady(invalid);expect(stage.window!.windowScene!.requests.isEmpty,"boolean/fractional/nonfinite ticket cannot start rotation")}
stage.fullscreenExitMotionReady(ack())
expect(stage.customFullscreenExit!.motionReady && stage.window!.windowScene!.requests.count==1 && statusChanges==1,"exact CSS-ready ACK requests portrait exactly once")
expect(stage.player!.bounds.size==sourceSize,"CSS-ready ACK must not prematurely resize WK in the landscape Card")
stage.fullscreenExitMotionReady(ack());stage.beginCustomFullscreenExit(request("duplicate"));stage.layoutIfNeeded()
expect(stage.window!.windowScene!.requests.count==1 && stage.player!.bounds.size==sourceSize,"duplicate ACK/request/layout leaves one rotation and source viewport")
let beforeScripts=stage.player!.scripts.count
let rotation=UIViewControllerTransitionCoordinator();stage.beginNativeRotation(to:target,coordinator:rotation)
stage.bounds=CGRect(origin:.zero,size:target);stage.window!.windowScene!.interfaceOrientation = .portrait;stage.layoutIfNeeded()
expect(stage.player!.bounds.size==target && stage.player!.transform==CGAffineTransform.identity,"only matching actual native begin authorizes target WK viewport without counter-transform")
expect(stage.player!.scripts.dropFirst(beforeScripts).filter{$0.contains("prepareExitMotion")}.isEmpty,"matching native begin cannot start a second CSS motion")
stage.confirmCustomFullscreenExit()
expect(!stage.player!.scripts.contains{$0.contains("finishExit.apply")},"CSS ACK does not bypass actual UIKit completion")
rotation.finish()
expect(stage.player!.scripts.contains{$0.contains("finishExit.apply")},"actual native completion permits final inline handoff")
for failure in [0,1] {
 let rejected=Stage();rejected.player!.motionResult=false;if failure==1{rejected.player!.motionError=NSError(domain:"qa",code:1)}
 rejected.beginCustomFullscreenExit(request())
 expect(rejected.window!.windowScene!.requests.count==1 && rejected.customFullscreenExit?.sourceViewport==nil,"API rejection/error requests portrait fallback exactly once")
 rejected.fullscreenExitMotionReady(ack())
 expect(rejected.window!.windowScene!.requests.count==1 && rejected.customFullscreenExit?.motionReady==false,"rejected prestage cannot accept a late ACK")
}
let timedOut=Stage();timedOut.player!.deferCancel=true;timedOut.beginCustomFullscreenExit(request())
DispatchQueue.main.run(at:10)
expect(timedOut.customFullscreenExit?.cancellingMotion==true && timedOut.window!.windowScene!.requests.isEmpty,"timeout first cancels the held JS pose, without pretending completion")
timedOut.fullscreenExitMotionReady(ack());expect(timedOut.customFullscreenExit?.motionReady==false,"late ready cannot beat pending cancellation")
DispatchQueue.main.run(at:11)
expect(timedOut.window!.windowScene!.requests.count==1 && timedOut.customFullscreenExit?.sourceViewport==nil,"bounded missing cancel reply releases held viewport and requests fallback once")
timedOut.player!.pending.forEach{$0.1(true,nil)}
expect(timedOut.window!.windowScene!.requests.count==1,"late cancel completion cannot request a duplicate rotation")
let reset=Stage();reset.beginCustomFullscreenExit(request());reset.resetCustomFullscreen()
expect(reset.customFullscreenExit==nil && reset.window!.windowScene!.requests.count==1,"reset before CSS ACK still restores portrait exactly once")
reset.fullscreenExitMotionReady(ack());expect(reset.window!.windowScene!.requests.count==1,"late ACK after reset cannot rotate again")
let inactive=Stage();inactive.beginCustomFullscreenExit(request());inactive.cancelNativeRotation()
expect(inactive.window!.windowScene!.requests.isEmpty && inactive.customFullscreenExit?.sourceViewport==nil,"inactivity cancellation releases pending prestage without starting UIKit rotation")
inactive.fullscreenExitMotionReady(ack());expect(inactive.window!.windowScene!.requests.isEmpty,"late ACK after inactive generation cancellation cannot start rotation")
UIApplication.shared.applicationState = .inactive
inactive.resumeFullscreenExitAfterInactivity();expect(inactive.window!.windowScene!.requests.isEmpty,"resume helper cannot request orientation while application remains inactive")
UIApplication.shared.applicationState = .active
inactive.resumeFullscreenExitAfterInactivity()
expect(inactive.window!.windowScene!.requests.count==1,"foreground resume requests the cancelled prestage fallback exactly once")
inactive.resumeFullscreenExitAfterInactivity();expect(inactive.window!.windowScene!.requests.count==1,"repeated foreground event cannot request portrait twice")
let inactiveChanged=Stage();inactiveChanged.beginCustomFullscreenExit(request());inactiveChanged.cancelNativeRotation();inactiveChanged.loadTicket += 1;inactiveChanged.resumeFullscreenExitAfterInactivity()
expect(inactiveChanged.window!.windowScene!.requests.isEmpty,"foreground resume cannot rotate a superseding same-ID navigation")
let inactiveClosed=Stage();inactiveClosed.beginCustomFullscreenExit(request());inactiveClosed.cancelNativeRotation();inactiveClosed.resetCustomFullscreen();inactiveClosed.resumeFullscreenExitAfterInactivity()
expect(inactiveClosed.customFullscreenExit==nil && inactiveClosed.window!.windowScene!.requests.count==1,"JS reset after inactive cancellation restores portrait, then foreground cannot resurrect exit")
for ready in [false,true] {
 let interrupted=Stage();interrupted.beginCustomFullscreenExit(request());if ready{interrupted.fullscreenExitMotionReady(ack())}
 let other=UIViewControllerTransitionCoordinator();let otherTarget=CGSize(width:412,height:892)
 interrupted.beginNativeRotation(to:otherTarget,coordinator:other)
 expect(interrupted.customFullscreenExit?.sourceViewport==nil && interrupted.customFullscreenExit?.motionReady==false,"different native viewport cancels either pending or ready cached motion")
 expect(interrupted.window!.windowScene!.requests.count==1,"physical/reversed target owns a single portrait fallback")
 interrupted.fullscreenExitMotionReady(ack());expect(interrupted.customFullscreenExit?.motionReady==false,"obsolete generation ACK cannot release another rotation")
}
let physical=Stage();physical.beginCustomFullscreenExit(request());let physicalRotation=UIViewControllerTransitionCoordinator();physical.beginNativeRotation(to:target,coordinator:physicalRotation)
expect(physical.customFullscreenExit?.sourceViewport==nil && physical.window!.windowScene!.requests.count==1,"already begun physical rotation cancels an unfinished prestage even if its target matches")
let existing=Stage();existing.activeRotationCoordinator=UIViewControllerTransitionCoordinator();existing.beginCustomFullscreenExit(request())
expect(existing.window!.windowScene!.requests.count==1 && !existing.player!.scripts.contains{$0.contains("prepareExitMotion")},"exit within an existing rotation retains the ordinary path")
// UIKit's actual portrait callback can beat the asynchronous WebKit exit body.
let race=Stage(),raceRotation=UIViewControllerTransitionCoordinator()
raceRotation.completionCurve = .easeOut
var heldBeforeDispatch=false
race.player!.onScript={script in
 if script.contains("exitForRotation") {
  race.bounds=CGRect(origin:.zero,size:target);race.layoutIfNeeded()
  heldBeforeDispatch = race.player!.bounds.size==sourceSize && race.customFullscreenExit==nil
 }
}
race.beginNativeRotation(to:target,coordinator:raceRotation)
expect(heldBeforeDispatch && race.pendingPhysicalFullscreenExit != nil,"source hold exists before asynchronous exit dispatch or first destination layout")
expect(race.player!.scripts.filter{$0.contains("exitForRotation")}.count==1,"physical begin invokes the existing guarded page rotation exit once")
race.window!.windowScene!.interfaceOrientation = .portrait
race.beginCustomFullscreenExit(request("physical"))
expect(race.pendingPhysicalFullscreenExit==nil && race.customFullscreenExit?.sourceViewport==sourceSize && race.customFullscreenExit?.motionViewport==target,"matching exit body consumes original source viewport before any JS resize")
expect(race.player!.bounds.size==sourceSize,"native destination layout stays source-sized until authenticated CSS readiness")
let physicalScript=race.player!.scripts.first{$0.contains("prepareExitMotion")}!
let physicalArgs=try! JSONSerialization.jsonObject(with:Data(physicalScript.components(separatedBy:"null, ")[1].dropLast(1).utf8)) as! [Any]
expect(physicalArgs.count==7 && physicalArgs[6] as? String=="cubic-bezier(0,0,.58,1)" && (physicalArgs[4] as! Double)>Date().timeIntervalSince1970*1000,"physical motion starts within current coordinator deadline and receives its exact system curve")
race.fullscreenExitMotionReady(ack("physical"));raceRotation.finish();race.layoutIfNeeded()
expect(race.player!.bounds.size==target && race.pendingPhysicalFullscreenExit==nil && race.player!.scripts.contains{$0.contains("finishExit.apply")},"completion finalizes the matching exit created asynchronously after native rotation began")
for ready in [false,true] {
 let cancelledPhysical=Stage(),cancelledCoordinator=UIViewControllerTransitionCoordinator()
 cancelledPhysical.player!.deferCancel=true
 cancelledPhysical.beginNativeRotation(to:target,coordinator:cancelledCoordinator)
 cancelledPhysical.beginCustomFullscreenExit(request("cancelled-physical"))
 if ready {cancelledPhysical.fullscreenExitMotionReady(ack("cancelled-physical"))}
 cancelledCoordinator.context.isCancelled=true;cancelledCoordinator.finish()
 expect(cancelledPhysical.customFullscreenExit?.allowsCurrentOrientation==true && cancelledPhysical.customFullscreenExit?.cancellingMotion==true,"cancelled native rotation revokes its asynchronously created exit, ready="+String(ready))
 expect(cancelledPhysical.player!.scripts.filter{$0.contains("cancelExitMotion.apply")}.count==1 && !cancelledPhysical.player!.scripts.contains{$0.contains("finishExit.apply")},"cancelled rotation queues one cancellation instead of confirming normal success")
 expect(cancelledPhysical.pendingPhysicalFullscreenExit==nil,"cancelled coordinator clears its passive physical lease")
 cancelledPhysical.player!.pending.filter{$0.0.contains("cancelExitMotion")}.forEach{$0.1(true,nil)}
 expect(cancelledPhysical.customFullscreenExit?.sourceViewport==nil && cancelledPhysical.customFullscreenExit?.cancellingMotion==false,"cancellation ACK releases source ownership for the existing natural recovery")
}
for changed in ["ticket","video","webview","generation","inactive"] {
 let stale=Stage(),coordinator=UIViewControllerTransitionCoordinator();stale.beginNativeRotation(to:target,coordinator:coordinator)
 switch changed {
 case "ticket":stale.loadTicket += 1
 case "video":stale.player!.url=URL(string:"https://m.youtube.com/watch?v=lmnopqrstuv")
 case "webview":stale.player=WKWebView()
 case "generation":stale.nativeRotationGeneration += 1
 default:stale.mode = .closed
 }
 expect(stale.pendingPhysicalFullscreenExitSource(videoID:"abcdefghijk")==nil && stale.fullscreenPlayerViewport(default:target)==target,"stale pending capture cannot hold changed ownership: "+changed)
 stale.cancelNativeRotation();expect(stale.pendingPhysicalFullscreenExit==nil,"rotation cancellation clears pending physical capture: "+changed)
}
let unanswered=Stage(),unansweredRotation=UIViewControllerTransitionCoordinator();unanswered.beginNativeRotation(to:target,coordinator:unansweredRotation)
expect(unanswered.pendingPhysicalFullscreenExit != nil,"unanswered guarded page request temporarily retains source geometry")
unansweredRotation.finish()
expect(unanswered.pendingPhysicalFullscreenExit==nil && unanswered.fullscreenPlayerViewport(default:target)==target,"native completion clears passive source lease even if page rejected or never answered")
let expired=Stage(),expiredRotation=UIViewControllerTransitionCoordinator();expired.beginNativeRotation(to:target,coordinator:expiredRotation)
expired.pendingPhysicalFullscreenExit=Stage.PendingPhysicalFullscreenExit(videoID:"abcdefghijk",ticket:1,rotationGeneration:expired.nativeRotationGeneration,player:ObjectIdentifier(expired.player!),sourceViewport:sourceSize,expiresAt:ProcessInfo.processInfo.systemUptime-1)
expect(expired.pendingPhysicalFullscreenExitSource(videoID:"abcdefghijk")==nil,"expired capture cannot hold a viewport even if coordinator callback has not arrived")
let fresh=Stage(),oldCoordinator=UIViewControllerTransitionCoordinator(),newCoordinator=UIViewControllerTransitionCoordinator()
fresh.beginNativeRotation(to:target,coordinator:oldCoordinator);fresh.beginNativeRotation(to:target,coordinator:newCoordinator);oldCoordinator.finish()
expect(fresh.pendingPhysicalFullscreenExit?.rotationGeneration==fresh.nativeRotationGeneration && fresh.activeRotationCoordinator === newCoordinator,"stale native completion cannot clear the replacement physical capture")
fresh.cancelNativeRotation();expect(fresh.pendingPhysicalFullscreenExit==nil,"reset retires the pending capture")
let portrait=Stage();portrait.bounds=CGRect(origin:.zero,size:target);portrait.player!.bounds=portrait.bounds;portrait.window!.windowScene!.interfaceOrientation = .portrait;portrait.beginCustomFullscreenExit(request())
expect(portrait.window!.windowScene!.requests.count==1,"already-portrait exit uses the original orientation path")
let sceneRejected=Stage();sceneRejected.window!.windowScene!.rejected=true;sceneRejected.beginCustomFullscreenExit(request());sceneRejected.fullscreenExitMotionReady(ack())
expect(sceneRejected.window!.windowScene!.requests.count==1 && sceneRejected.customFullscreenExit?.allowsCurrentOrientation==true && sceneRejected.customFullscreenExit?.sourceViewport==nil,"rejected scene request safely releases the prestage without recursion")
let lateScene=Stage();lateScene.window!.windowScene!.deferRejection=true;lateScene.beginCustomFullscreenExit(request());lateScene.fullscreenExitMotionReady(ack())
lateScene.loadTicket=2;lateScene.customFullscreenExit=Stage.CustomFullscreenExit(videoID:"abcdefghijk",token:"exit",ticket:2,sourceViewport:sourceSize)
lateScene.window!.windowScene!.rejections.forEach{$0(NSError(domain:"qa",code:2))}
expect(lateScene.customFullscreenExit?.allowsCurrentOrientation==false && lateScene.customFullscreenExit?.sourceViewport==sourceSize,"stale scene rejection cannot mutate a same-ID/same-token newer navigation")
let owner=Stage();owner.player!.deferMotion=true;owner.beginCustomFullscreenExit(request());owner.loadTicket += 1
owner.player!.pending.forEach{$0.1(false,nil)};owner.fullscreenExitMotionReady(ack());DispatchQueue.main.run(at:30)
expect(owner.window!.windowScene!.requests.isEmpty,"superseded ticket ignores old callback/ACK/deadline without rotating new ownership")
let route=Stage();route.beginCustomFullscreenExit(request());route.player!.url=URL(string:"https://m.youtube.com/watch?v=lmnopqrstuv");route.fullscreenExitMotionReady(ack());DispatchQueue.main.run(at:40)
expect(route.window!.windowScene!.requests.isEmpty,"changed source URL cannot authorize a stale pre-rotation request")
print("PRESTAGE_CHECKS=\\(checks)")
print("NATIVE_STAGED_FULLSCREEN_OK")
`;
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-staged-fullscreen-'));
  try {
    const file = path.join(folder, 'StagedFullscreen.swift'); fs.writeFileSync(file, swift);
    const run = spawnSync(compiler.stdout.trim(), [file], { encoding: 'utf8', timeout: 60000 });
    assert.equal(run.error, undefined, String(run.error));
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /NATIVE_STAGED_FULLSCREEN_OK/); console.log(run.stdout.trim());
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
