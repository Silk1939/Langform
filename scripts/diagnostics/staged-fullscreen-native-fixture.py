#!/usr/bin/env python3
"""Actual UIKit Card presentation + WK source viewport; synthetic coordinator, not iPhone QA."""
import argparse,base64,hashlib,json,platform,plistlib,subprocess,tempfile
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[2];source=(root/'ios/Langform/Langform/YouTubeWebView.swift').read_text();video=(root/'tests/fixtures/mini-rotation-green.mp4').read_bytes();a.output.mkdir(parents=True,exist_ok=True)
def declaration(text,signature):
    start=text.index(signature);opening=text.index('{',start);depth,end=1,opening+1
    while depth and end<len(text):
        depth+=(text[end]=='{')-(text[end]=='}');end+=1
    return text[start:end]
names=['fullscreenPlayerViewport','applyFullscreenSurface','beginNativeRotation','cancelNativeRotation','requestFullscreenExitMotion','releaseFullscreenExitViewport','cancelFullscreenExitMotion','fullscreenExitMotionReady']
chunks='\n'.join(declaration(source,'func '+name+'(') for name in names)
structs='\n'.join(declaration(source,'private struct '+name).replace('private struct','struct') for name in ['CustomFullscreenEnter','CustomFullscreenExit'])
controller=declaration(source,'final class PlayerStageController:');layout=declaration(declaration(source,'override func layoutSubviews()'),'if let player {')
swift=r'''
import UIKit
import WebKit
import QuartzCore
import CoreFoundation
enum StartupDiagnostics{static let enabled=false;static func videoMark(_ row:[String:Any]){}}
enum YouTubeWebView{static func videoID(_ url:URL?)->String?{"abcdefghijk"}}
typealias PlayerStage=Stage
__CONTROLLER__
final class Stage:UIView,WKScriptMessageHandler{
 enum Mode{case closed,loading,expanded,mini}
 var mode=Mode.expanded,progress:CGFloat=0,dragging=false,playerFullscreen=true
 var customFullscreenID:String?="abcdefghijk",loadTicket=1,nativeRotationGeneration=0
 __STRUCTS__
 var customFullscreenEnter:CustomFullscreenEnter?,customFullscreenExit:CustomFullscreenExit?
 var activeRotationCoordinator:UIViewControllerTransitionCoordinator?
 var fullscreenCardRotationGeneration:Int?,nativeRotationTarget:CGSize?,nativeRotationDeadlineMilliseconds:Double?,nativeRotationCSSCurve:String?,fullscreenExitMotionTimeout:DispatchWorkItem?
 var player:WKWebView?,card=UIView(),closeButton=UIView(),miniPlaybackButton=UIView(),collapseButton=UIView()
 var playerLayoutSize=CGSize.zero,playerInsetsChanged=false,ackBefore:(([String:Any])->Void)?,nativeFinished=0
 override init(frame:CGRect){super.init(frame:frame);let c=WKWebViewConfiguration();c.allowsInlineMediaPlayback=true;c.mediaTypesRequiringUserActionForPlayback=[];c.userContentController.add(self,name:"ready");player=WKWebView(frame:.zero,configuration:c);card.clipsToBounds=true;card.backgroundColor = .black;addSubview(card);card.addSubview(player!);player!.scrollView.contentInsetAdjustmentBehavior = .never;player!.scrollView.isScrollEnabled=false}
 required init?(coder:NSCoder){fatalError()}
 func updateChrome(){};func updatePlaybackControls(){};func resetPlayerForViewportChange(){}
 func measureVideo(after:Double,_ done:()->Void){done()};func apply(_ t:CGFloat){_ = applyFullscreenSurface(t)}
 func confirmCustomFullscreenEnter(afterRotation:Bool=false){}
 func confirmCustomFullscreenExit(afterRotation:Bool=false){if afterRotation{nativeFinished += 1}}
 override func layoutSubviews(){super.layoutSubviews();__LAYOUT__}
 func userContentController(_ controller:WKUserContentController,didReceive message:WKScriptMessage){guard let body=message.body as? [String:Any]else{return};ackBefore?(body);fullscreenExitMotionReady(body)}
 __CHUNKS__
}
final class FixtureCoordinator:NSObject,UIViewControllerTransitionCoordinator{
 let containerView:UIView;weak var stage:Stage?
 var isAnimated:Bool{true};var presentationStyle:UIModalPresentationStyle{.none};var initiallyInteractive:Bool{false};var isInterruptible:Bool{true};var isInteractive:Bool{false};var isCancelled:Bool{false}
 var transitionDuration:TimeInterval{0.35};var percentComplete:CGFloat{0};var completionVelocity:CGFloat{1};var completionCurve:UIView.AnimationCurve{.easeInOut};var targetTransform:CGAffineTransform{.identity}
 init(container:UIView,stage:Stage){containerView=container;self.stage=stage}
 func viewController(forKey key:UITransitionContextViewControllerKey)->UIViewController?{nil}
 func view(forKey key:UITransitionContextViewKey)->UIView?{nil}
 func animate(alongsideTransition animation:((UIViewControllerTransitionCoordinatorContext)->Void)?,completion:((UIViewControllerTransitionCoordinatorContext)->Void)?)->Bool{
  UIView.animate(withDuration:transitionDuration,delay:0,options:[.curveEaseInOut,.beginFromCurrentState]){self.stage?.bounds=CGRect(x:0,y:0,width:402,height:874);self.stage?.center=CGPoint(x:201,y:437);animation?(self);self.stage?.setNeedsLayout();self.stage?.layoutIfNeeded()}completion:{_ in completion?(self)};return true
 }
 func animateAlongsideTransition(in view:UIView?,animation:((UIViewControllerTransitionCoordinatorContext)->Void)?,completion:((UIViewControllerTransitionCoordinatorContext)->Void)?)->Bool{animate(alongsideTransition:animation,completion:completion)}
 func notifyWhenInteractionChanges(_ handler:@escaping(UIViewControllerTransitionCoordinatorContext)->Void){}
 func notifyWhenInteractionEnds(_ handler:@escaping(UIViewControllerTransitionCoordinatorContext)->Void){}
}
final class Run:NSObject,WKNavigationDelegate{
 var controller:PlayerStageController!,coordinator:FixtureCoordinator!,link:CADisplayLink?,rows=[[String:Any]](),checks=[[String:Any]](),started=0.0,ackTime:Double?,finished=false,applied=false,attempts=0
 var stage:Stage{controller.stage}
 func emit(_ row:[String:Any]){let bytes=try!JSONSerialization.data(withJSONObject:row,options:.sortedKeys);print(String(data:bytes,encoding:.utf8)!);fflush(stdout)}
 func expect(_ value:Bool,_ message:String){let row:[String:Any]=["check":message,"passed":value];checks.append(row);emit(row)}
 func start(in parent:UIViewController){
  controller=PlayerStageController();parent.addChild(controller);controller.view.frame=CGRect(x:0,y:0,width:874,height:402);parent.view.addSubview(controller.view);controller.didMove(toParent:parent);stage.layoutIfNeeded();stage.player!.navigationDelegate=self
  stage.ackBefore={body in
   self.ackTime=CACurrentMediaTime()-self.started
   self.expect(self.stage.player!.bounds.size==CGSize(width:874,height:402),"real WK source is874x402 at final live-node ACK")
   self.expect((body["innerWidth"] as? NSNumber)?.intValue==874 && (body["innerHeight"] as? NSNumber)?.intValue==402,"real document viewport stays source-sized throughout motion")
   self.expect(((body["videoReady"] as? NSNumber)?.intValue ?? 0)>=2,"local H.264 stays decoded at handoff")
   self.expect(abs((body["videoWidth"] as? Double ?? 0)-402)<1 && abs((body["videoY"] as? Double ?? 0)-110)<1,"same live node pinned402x226/y110 before WK resize")
  }
  let html="""
  <html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:black}video{position:fixed;left:80px;top:0;width:714.6667px;height:402px;object-fit:fill}</style><video id="video" autoplay muted loop playsinline src="data:video/mp4;base64,__VIDEO__"></video><script>
  let motion;window.__langformFullscreen={prepareExitMotion(id,token,width,height,deadline,ticket){let v=document.getElementById('video'),scale=402/v.getBoundingClientRect().width;
   motion=v.animate([{transform:'none',transformOrigin:'0 0'},{transform:'translate(-80px,110px) scale('+scale+')',transformOrigin:'0 0'}],{duration:Math.max(0,deadline-Date.now()),easing:'cubic-bezier(.2,0,.25,1)',fill:'forwards'});
   motion.onfinish=()=>{v.style.cssText='position:fixed;left:0;top:110px;width:402px;height:226.125px;object-fit:fill';motion.cancel();let box=v.getBoundingClientRect();window.webkit.messageHandlers.ready.postMessage({kind:'exit-motion-ready',href:'https://m.youtube.com/watch?v=abcdefghijk',videoID:id,token,width,height,requestTicket:ticket,innerWidth:innerWidth,innerHeight:innerHeight,videoReady:v.readyState,videoWidth:box.width,videoY:box.y})};return true},cancelExitMotion(){if(motion)motion.cancel();return true}};
  </script></html>
  """
  stage.player!.loadHTMLString(html,baseURL:URL(string:"https://m.youtube.com/watch?v=abcdefghijk"))
 }
 func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){waitForMedia()}
 func waitForMedia(){
  attempts += 1;stage.player!.evaluateJavaScript("document.getElementById('video').readyState"){value,_ in
   if ((value as? NSNumber)?.intValue ?? 0)<2 {if self.attempts>30{self.expect(false,"media decoded");self.finish();return};DispatchQueue.main.asyncAfter(deadline:.now()+0.05){self.waitForMedia()};return};self.begin()
  }
 }
 func begin(){
  stage.customFullscreenExit=Stage.CustomFullscreenExit(videoID:"abcdefghijk",token:"fixture",ticket:1,sourceViewport:stage.player!.bounds.size)
  started=CACurrentMediaTime();link=CADisplayLink(target:self,selector:#selector(sample));link!.add(to:.main,forMode:.common)
  coordinator=FixtureCoordinator(container:controller.parent!.view,stage:stage);controller.viewWillTransition(to:CGSize(width:402,height:874),with:coordinator)
  DispatchQueue.main.asyncAfter(deadline:.now()+0.9){self.finish()}
 }
 @objc func sample(){
  let t=CACurrentMediaTime()-started,p=stage.card.layer.presentation(),wp=stage.player!.layer.presentation()
  let row:[String:Any]=["event":"native-display","milliseconds":t*1000,"stageWidth":stage.layer.presentation()?.bounds.width ?? -1,"cardWidth":p?.bounds.width ?? -1,"cardHeight":p?.bounds.height ?? -1,"wkWidth":stage.player!.bounds.width,"wkHeight":stage.player!.bounds.height,"wkTransformA":stage.player!.transform.a,"wkTransformD":stage.player!.transform.d,"wkX":stage.player!.frame.minX,"wkY":stage.player!.frame.minY,"wkPresentationWidth":wp?.bounds.width ?? -1,"ready":stage.customFullscreenExit?.motionReady==true]
  rows.append(row);emit(row);if t>0.12 && !applied {applied=true;UIView.performWithoutAnimation{stage.apply(0)}}
 }
 func finish(){
  guard !finished else{return};finished=true;link?.invalidate()
  let middle=rows.filter{($0["milliseconds"] as! Double)>50 && ($0["milliseconds"] as! Double)<250}
  expect(middle.count>=4 && middle.allSatisfy{($0["cardWidth"] as! CGFloat)>402 && ($0["cardWidth"] as! CGFloat)<874},"actual UIKit Card interpolates; apply0 preserves presentation")
  expect(rows.allSatisfy{($0["wkTransformA"] as! CGFloat)==1 && ($0["wkTransformD"] as! CGFloat)==1 && ($0["wkX"] as! CGFloat)==0 && ($0["wkY"] as! CGFloat)==0},"real WK stays identity at origin0")
  expect(ackTime != nil && ackTime!>0.2 && rows.filter{($0["milliseconds"] as! Double)<ackTime!*1000}.allSatisfy{($0["wkWidth"] as! CGFloat)==874 && ($0["wkHeight"] as! CGFloat)==402},"all pre-ACK samples hold source WK bounds")
  expect(stage.player!.bounds.size==CGSize(width:402,height:874) && stage.nativeFinished==1,"ACK and actual coordinator completion reach destination once")
  let passed=checks.allSatisfy{$0["passed"] as! Bool};emit(["finished":true,"passed":passed,"checks":checks.count,"samples":rows.count,"environment":"real Catalyst UIKit/WK/H.264 with fixture coordinator and minimal JS bridge; not iPhone/YouTube motion acceptance"]);exit(passed ? 0:1)
 }
}
let run=Run()
final class AppDelegate:UIResponder,UIApplicationDelegate{func application(_ application:UIApplication,configurationForConnecting session:UISceneSession,options:UIScene.ConnectionOptions)->UISceneConfiguration{let c=UISceneConfiguration(name:"Default",sessionRole:session.role);c.delegateClass=SceneDelegate.self;return c}}
final class SceneDelegate:UIResponder,UIWindowSceneDelegate{
 var window:UIWindow?
 func scene(_ scene:UIScene,willConnectTo session:UISceneSession,options:UIScene.ConnectionOptions){guard let scene=scene as? UIWindowScene else{return};scene.sizeRestrictions?.minimumSize=CGSize(width:1000,height:1000);scene.sizeRestrictions?.maximumSize=CGSize(width:1000,height:1000);let window=UIWindow(windowScene:scene);self.window=window;let vc=UIViewController();window.rootViewController=vc;window.makeKeyAndVisible();DispatchQueue.main.asyncAfter(deadline:.now()+0.1){run.start(in:vc)}}
}
UIApplicationMain(CommandLine.argc,CommandLine.unsafeArgv,nil,NSStringFromClass(AppDelegate.self))
'''
swift=swift.replace('__CHUNKS__',chunks).replace('__STRUCTS__',structs).replace('__CONTROLLER__',controller).replace('__LAYOUT__',layout).replace('__VIDEO__',base64.b64encode(video).decode())
build=Path(tempfile.mkdtemp(prefix='langform-staged-native-'));bundle=build/'LangformStagedNative.app';exe=bundle/'Contents/MacOS/LangformStagedNative';exe.parent.mkdir(parents=True)
main=build/'main.swift';main.write_text(swift)
sdk=subprocess.check_output(['xcrun','--sdk','macosx','--show-sdk-path'],text=True).strip();support=Path(sdk)/'System/iOSSupport'
subprocess.run(['xcrun','swiftc','-target',platform.machine()+'-apple-ios17.0-macabi','-sdk',sdk,'-F',str(support/'System/Library/Frameworks'),'-I',str(support/'usr/include'),'-L',str(support/'usr/lib'),str(main),'-o',str(exe)],check=True)
info={'CFBundleIdentifier':'dev.langform.staged-native','CFBundleName':'LangformStagedNative','CFBundleExecutable':exe.name,'CFBundlePackageType':'APPL','LSUIElement':True,'UIApplicationSceneManifest':{'UIApplicationSupportsMultipleScenes':False,'UISceneConfigurations':{'UIWindowSceneSessionRoleApplication':[{'UISceneConfigurationName':'Default'}]}}}
with(bundle/'Contents/Info.plist').open('wb')as file:plistlib.dump(info,file)
subprocess.run(['codesign','--force','--sign','-',str(bundle)],check=True)
result=subprocess.run([str(exe)],text=True,capture_output=True,timeout=15)
(a.output/'native.jsonl').write_text(result.stdout);(a.output/'stderr.log').write_text(result.stderr)
(a.output/'source-fingerprints.json').write_text(json.dumps({'nativeSha256':hashlib.sha256(source.encode()).hexdigest(),'chunksSha256':hashlib.sha256((chunks+layout+controller+structs).encode()).hexdigest(),'fixtureVideoSha256':hashlib.sha256(video).hexdigest()},indent=2)+'\n')
print(result.stdout,end='')
if result.returncode:print(result.stderr);raise SystemExit(result.returncode)

