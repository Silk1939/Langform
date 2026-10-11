#!/usr/bin/env python3
"""Real UIKit/WK mini crop and stage-owned inset regression on Mac Catalyst.

Local H.264 playback is inspected through DOM state and optional CUA compositor
screenshots. Native drawHierarchy is deliberately not used to judge media pixels.
The explicit 62pt stage inset is a fixture, not an actual iPhone environment.
"""
import argparse, base64, hashlib, json, platform, plistlib, subprocess, tempfile
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--baseline-env', action='store_true')
p.add_argument('--hold-seconds', type=float, default=0)
a = p.parse_args()
root = Path(__file__).resolve().parents[2]
native = (root/'ios/Langform/Langform/YouTubeWebView.swift').read_text()
viewport = (root/'ios/Langform/Langform/ViewportLayout.js').read_text()
video = (root/'tests/fixtures/mini-rotation-green.mp4').read_bytes()
a.output.mkdir(parents=True, exist_ok=True)
(a.output/'live.jsonl').unlink(missing_ok=True)

def declaration(source, signature):
    start = source.index(signature); opening = source.index('{',start)
    depth, end = 1, opening+1
    while depth and end < len(source):
        depth += (source[end]=='{') - (source[end]=='}'); end += 1
    if depth: raise ValueError(signature)
    return source[start:end]

names = ['func synchronizeStageInsets(', 'var hasVideoRect:', 'var pictureRect:',
         'func miniFrame(', 'func apply(', 'var cardMoving:', 'func flushPendingRect(']
chunks = '\n'.join(declaration(native,name) for name in names)
player_layout = declaration(declaration(native,'override func layoutSubviews()'), 'if let player {')
policies = '\n'.join((root/'ios/Langform/Langform'/name).read_text()
    for name in ['PlayerGesturePolicy.swift','PlayerViewportPolicy.swift'])
script = 'new Function("window",'+json.dumps(viewport)+')(new Proxy(window,{get(target,key){if(key==="location")return {hostname:"m.youtube.com",pathname:"/watch",href:"https://m.youtube.com/watch?v=abcdefghijk"};const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}}));'

swift = r'''
import UIKit
import WebKit
import QuartzCore
final class Stage:UIView {
    var feedOpening:Int?
    enum Mode { case closed,loading,expanded,mini }
    var mode = Mode.expanded, progress:CGFloat = 0, videoCropActive = false
    var player:WKWebView!, videoRect = CGRect.zero, pendingRect:CGRect?
    let card=UIView(), closeButton=UIView(), miniPlaybackButton=UIView(), collapseButton=UIView()
    var settler:UIViewPropertyAnimator?, revealer:UIViewPropertyAnimator?, dismisser:UIViewPropertyAnimator?
    var dragging=false, awaitingViewportGeometry=false, settlingBetweenModes=false
    var cropCorrection:PlayerViewportPolicy.SurfaceCorrection?
    var playerLayoutSize=CGSize.zero
    static let bottomBarHeight:CGFloat=48
    static let stageInsetsScriptPrefix="// langform-stage-insets-v1\n"
    let stageInsetsByView=NSMapTable<WKWebView,NSValue>(keyOptions:.weakMemory,valueOptions:.strongMemory)
    let stageMiniByView=NSMapTable<WKWebView,NSNumber>(keyOptions:.weakMemory,valueOptions:.strongMemory)
    var stageInsetsSourceCache:(insets:UIEdgeInsets,nativeMini:Bool,source:String)?
    override init(frame:CGRect) {
        let config=WKWebViewConfiguration();config.allowsInlineMediaPlayback=true;config.mediaTypesRequiringUserActionForPlayback=[]
        config.userContentController.addUserScript(WKUserScript(source:__VIEWPORT_SCRIPT__,injectionTime:.atDocumentStart,forMainFrameOnly:true))
        player=WKWebView(frame:.zero,configuration:config)
        super.init(frame:frame)
        backgroundColor = .darkGray; card.backgroundColor = .black; card.clipsToBounds=true
        addSubview(card);card.addSubview(player);card.addSubview(closeButton);card.addSubview(miniPlaybackButton)
        closeButton.backgroundColor = .magenta;miniPlaybackButton.backgroundColor = .magenta
        player.scrollView.contentInsetAdjustmentBehavior = .never;player.scrollView.contentInset = .zero
        player.scrollView.isScrollEnabled=false
    }
    required init?(coder:NSCoder){fatalError()}
    func updatePlaybackControls() {}
    func applyFullscreenSurface(_ t:CGFloat)->Bool { false }
    func fullscreenPlayerViewport(default viewport:CGSize)->CGSize { viewport }
    func updateChrome() {}
    func showStartupPoster() {}
    func resetPlayerForViewportChange() { pendingRect=nil;awaitingViewportGeometry=true; if mode != .mini {videoRect = .zero} }
    func confirmCustomFullscreenEnter() {}
    func confirmCustomFullscreenExit() {}
    func measureVideo(after:Double,completion:()->Void) {}
    override func layoutSubviews() {
        super.layoutSubviews()
        let playerInsetsChanged = !__BASELINE__ ? synchronizeStageInsets(player) : false
        __PLAYER_LAYOUT__
    }
    func syncMode() { if !__BASELINE__ { _ = synchronizeStageInsets(player) } }
    __CHUNKS__
}
final class NativeRun:NSObject,WKNavigationDelegate {
    let output=URL(fileURLWithPath:__OUTPUT__)
    let size=CGSize(width:390,height:844)
    var stage:Stage!,html="",finished=false,reloading=false,rows=[[String:Any]](),checks=[[String:Any]]()
    func emit(_ row:[String:Any]) {
        guard let bytes=try? JSONSerialization.data(withJSONObject:row,options:[.sortedKeys]),let text=String(data:bytes,encoding:.utf8)else{return}
        print(text);fflush(stdout)
        let path=output.appendingPathComponent("live.jsonl")
        if !FileManager.default.fileExists(atPath:path.path){FileManager.default.createFile(atPath:path.path,contents:nil)}
        if let file=try? FileHandle(forWritingTo:path){_ = try? file.seekToEnd();try?file.write(contentsOf:bytes+Data("\n".utf8));try?file.close()}
    }
    func expect(_ value:Bool,_ name:String){let row:[String:Any]=["check":name,"passed":value];checks.append(row);emit(row)}
    func start(in surface:UIView){
        stage=Stage(frame:CGRect(origin:.zero,size:size));surface.addSubview(stage);stage.layoutIfNeeded()
        stage.player.navigationDelegate=self
        html="""
        <!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>
        html,body{margin:0;background:#222}ytm-app{display:block;padding-top:48px}ytm-header{position:fixed;top:0;left:0;height:48px;width:100%;background:red;z-index:4}
        .player-container{position:fixed;top:48px;left:0;width:100vw;height:56.25vw;z-index:2}#movie_player,.html5-video-container,video{display:block;width:100%;height:100%}video{object-fit:fill;background:black}
        #comments{margin-top:56.25vw;height:1800px;background:blue}#env-probe{position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top,0px)}
        #player-control-overlay{position:absolute;inset:0}.player-controls-middle{position:absolute;left:40%;top:40%;color:white}.player-controls-bottom{position:absolute;left:0;right:0;bottom:0;color:white}
        </style><div id="env-probe"></div><ytm-header></ytm-header><ytm-app><div class="player-container"><div id="movie_player"><div class="html5-video-container"><video id="video" autoplay muted loop playsinline src="data:video/mp4;base64,__VIDEO__"></video></div><div id="player-control-overlay"><div class="player-controls-content"><div class="player-controls-middle">YT PLAY</div><div class="player-controls-bottom">YT 0:01 / 0:02</div></div></div></div></div><div id="comments">TITLE AND COMMENTS</div></ytm-app></html>
        """
        stage.player.loadHTMLString(html,baseURL:URL(string:"https://m.youtube.com/watch?v=abcdefghijk"))
        DispatchQueue.main.asyncAfter(deadline:.now()+8+__HOLD__){guard !self.finished else{return};self.emit(["finished":true,"passed":false,"error":"live fixture timeout"]);exit(2)}
    }
    func record(_ phase:String,_ completion:@escaping ([String:Any])->Void){
        let nativeState:[String:Any]=["stageTop":Double(stage.safeAreaInsets.top),"wkTop":Double(stage.player.safeAreaInsets.top),
            "wkWidth":Double(stage.player.bounds.width),"wkHeight":Double(stage.player.bounds.height),"mode":String(describing:stage.mode),"progress":Double(stage.progress)]
        stage.player.evaluateJavaScript("(()=>{let v=document.getElementById('video'),r=v.getBoundingClientRect(),h=document.documentElement,c=document.querySelector('#player-control-overlay');return {x:r.x,y:r.y,width:r.width,height:r.height,innerW:innerWidth,innerH:innerHeight,envTop:parseFloat(getComputedStyle(document.getElementById('env-probe')).paddingTop),nativeTop:h.style.getPropertyValue('--lf-native-safe-top'),nativeMini:h.hasAttribute('data-langform-mini-video'),controlVisibility:getComputedStyle(c).visibility,videoVisibility:getComputedStyle(v).visibility,paused:v.paused,ready:v.readyState,time:v.currentTime}})()"){value,error in
            guard let dom=value as? [String:Any]else{self.emit(["finished":true,"passed":false,"error":String(describing:error)]);exit(2)}
            var row=nativeState;row["event"]="live-stage-insets";row["phase"]=phase;row["dom"]=dom;row["baselineEnv"]=__BASELINE__
            self.rows.append(row);self.emit(row)
            self.expect(self.stage.player.bounds.size==self.size && dom["innerW"] as? Double==390 && dom["innerH"] as? Double==844,phase+" keeps full native and CSS viewport")
            self.expect(dom["videoVisibility"] as? String=="visible" && (dom["ready"] as? Int ?? 0)>=2,phase+" retains decoded visible live video")
            if !__BASELINE__ {
                self.expect(dom["nativeTop"] as? String=="62px" && abs((dom["y"] as? Double ?? -1)-110)<0.1,phase+" uses stable stage-owned 62pt and videoY110")
            }
            completion(dom)
        }
    }
    func delay(_ action:@escaping()->Void){DispatchQueue.main.asyncAfter(deadline:.now()+0.08,execute:action)}
    func webView(_ view:WKWebView,didFinish navigation:WKNavigation!){
        delay{
            if self.reloading{self.record("reload-bootstrap"){dom in self.expect(dom["nativeMini"] as? Bool==false,"reloaded expanded document cannot inherit stale mini controls");self.finish()};return}
            self.record("expanded"){dom in
                self.stage.videoRect=CGRect(x:dom["x"] as! Double,y:dom["y"] as! Double,width:dom["width"] as! Double,height:dom["height"] as! Double)
                self.stage.awaitingViewportGeometry=false;self.stage.videoCropActive=true;self.stage.syncMode()
                self.stage.mode = .mini;self.stage.progress=0.3;self.stage.apply(0.3)
                self.delay{self.record("drag-0.3"){_ in self.stage.progress=0.7;self.stage.apply(0.7)
                    self.delay{self.record("drag-0.7"){_ in self.stage.progress=1;self.stage.apply(1)
                        self.delay{self.mini()}
                    }}
                }}
            }
        }
    }
    func mini(){
        record("mini-playing"){dom in
            if !__BASELINE__ {self.expect(dom["nativeMini"] as? Bool==true && dom["controlVisibility"] as? String=="hidden","native mini exclusively owns playback controls")}
            self.stage.player.evaluateJavaScript("document.getElementById('video').pause()"){_,_ in self.delay{
                self.record("mini-paused"){paused in self.expect(paused["paused"] as? Bool==true,"real media pauses in the same stable crop")
                    self.stage.player.evaluateJavaScript("document.getElementById('video').play()"){_,_ in self.delay{
                        self.record("mini-resumed"){playing in self.expect(playing["paused"] as? Bool==false,"real media resumes in the same stable crop")
                            DispatchQueue.main.asyncAfter(deadline:.now()+__HOLD__){self.expand()}
                        }
                    }}
                }
            }}
        }
    }
    func expand(){
        stage.mode = .expanded;stage.progress=0;stage.videoCropActive=false;stage.syncMode();stage.apply(0)
        delay{self.record("expanded-restored"){dom in
            self.expect(dom["controlVisibility"] as? String=="visible" && dom["nativeMini"] as? Bool==false,"expansion restores embedded controls without touching live video")
            let controller=self.stage.player.configuration.userContentController
            let bootstraps=controller.userScripts.filter{$0.source.hasPrefix(Stage.stageInsetsScriptPrefix)}
            if !__BASELINE__ {self.expect(bootstraps.count==1 && controller.userScripts.count==2,"mode changes retain exactly one native bootstrap and the base script")}
            self.reloading=true;self.stage.player.loadHTMLString(self.html,baseURL:URL(string:"https://m.youtube.com/watch?v=abcdefghijk"))
        }}
    }
    func finish(){finished=true;let passed=checks.allSatisfy{$0["passed"] as? Bool==true};emit(["finished":true,"passed":passed,"checks":checks.count,"baselineEnv":__BASELINE__,"environment":"real Mac Catalyst UIKit/WKWebView with decoded local H.264; explicit62pt fixture, not iPhone QA"]);exit(passed ? 0:1)}
}
let run=NativeRun()
final class AppDelegate:UIResponder,UIApplicationDelegate{func application(_ application:UIApplication,configurationForConnecting session:UISceneSession,options:UIScene.ConnectionOptions)->UISceneConfiguration{let c=UISceneConfiguration(name:"Default",sessionRole:session.role);c.delegateClass=SceneDelegate.self;return c}}
final class SceneDelegate:UIResponder,UIWindowSceneDelegate{
    var window:UIWindow?
    func scene(_ scene:UIScene,willConnectTo session:UISceneSession,options:UIScene.ConnectionOptions){
        guard let scene=scene as? UIWindowScene else{return};scene.sizeRestrictions?.minimumSize=CGSize(width:1000,height:900);scene.sizeRestrictions?.maximumSize=CGSize(width:1000,height:900)
        let window=UIWindow(windowScene:scene);self.window=window;let vc=UIViewController();window.rootViewController=vc;window.makeKeyAndVisible()
        DispatchQueue.main.asyncAfter(deadline:.now()+0.1){vc.view.layoutIfNeeded();vc.additionalSafeAreaInsets=UIEdgeInsets(top:max(0,62-vc.view.safeAreaInsets.top),left:0,bottom:0,right:0);vc.view.layoutIfNeeded();run.start(in:vc.view)}
    }
}
UIApplicationMain(CommandLine.argc,CommandLine.unsafeArgv,nil,NSStringFromClass(AppDelegate.self))
'''
swift=swift.replace('__VIEWPORT_SCRIPT__',json.dumps(script)).replace('__PLAYER_LAYOUT__',player_layout).replace('__CHUNKS__',chunks)
swift=swift.replace('__OUTPUT__',json.dumps(str(a.output.resolve()))).replace('__VIDEO__',base64.b64encode(video).decode())
swift=swift.replace('__BASELINE__','true' if a.baseline_env else 'false').replace('__HOLD__',str(max(0,min(60,a.hold_seconds))))
build=Path(tempfile.mkdtemp(prefix='langform-stage-insets-'));bundle=build/'LangformStageInsetsNative.app';exe=bundle/'Contents/MacOS/LangformStageInsetsNative';exe.parent.mkdir(parents=True)
main=build/'main.swift';main.write_text(policies+'\n'+swift)
sdk=subprocess.check_output(['xcrun','--sdk','macosx','--show-sdk-path'],text=True).strip();support=Path(sdk)/'System/iOSSupport'
subprocess.run(['xcrun','swiftc','-target',platform.machine()+'-apple-ios17.0-macabi','-sdk',sdk,'-F',str(support/'System/Library/Frameworks'),'-I',str(support/'usr/include'),'-L',str(support/'usr/lib'),str(main),'-o',str(exe)],check=True)
info={'CFBundleIdentifier':'dev.langform.stage-insets-native','CFBundleName':'LangformStageInsetsNative','CFBundleExecutable':exe.name,'CFBundlePackageType':'APPL','LSUIElement':True,'UIApplicationSceneManifest':{'UIApplicationSupportsMultipleScenes':False,'UISceneConfigurations':{'UIWindowSceneSessionRoleApplication':[{'UISceneConfigurationName':'Default'}]}}}
with(bundle/'Contents/Info.plist').open('wb')as f:plistlib.dump(info,f)
subprocess.run(['codesign','--force','--sign','-',str(bundle)],check=True)
print(json.dumps({'appBundle':str(bundle),'executable':str(exe)}),flush=True)
result=subprocess.run([str(exe)],text=True,capture_output=True,timeout=max(15,a.hold_seconds+10))
(a.output/'native.jsonl').write_text(result.stdout);(a.output/'stderr.log').write_text(result.stderr)
(a.output/'source-fingerprints.json').write_text(json.dumps({'nativeSha256':hashlib.sha256(native.encode()).hexdigest(),'chunksSha256':hashlib.sha256((chunks+player_layout).encode()).hexdigest(),'viewportJsSha256':hashlib.sha256(viewport.encode()).hexdigest(),'fixtureVideoSha256':hashlib.sha256(video).hexdigest()},indent=2)+'\n')
print(result.stdout,end='')
if result.returncode:print(result.stderr);raise SystemExit(result.returncode)
