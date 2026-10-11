#!/usr/bin/env python3
"""Render the shipping FeedRefresh with real UIKit and WKWebView via Mac Catalyst.

The pull is requested programmatically at a negative UIScrollView offset, then
UIKit performs its actual animated return. Pixels before/after cover removal
measure viewport continuity. This is not a physical iPhone finger-swipe test.
The WKWebView is inside a real UIScrollView wrapper: WebKit's own scroll view
clamps programmatic overscroll outside an active native finger gesture.
"""
import argparse, hashlib, json, plistlib, platform, subprocess, tempfile
from pathlib import Path

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--source',type=Path)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args();root=Path(__file__).resolve().parents[2]
source=a.source or root/'ios/Langform/Langform/FeedRefresh.swift'
original=source.read_text();helper=original.replace('private func refreshRequested()', 'func refreshRequested()')
feed=(root/'ios/Langform/Langform/FeedMotion.js').read_text()
a.output.mkdir(parents=True,exist_ok=True)
build=Path(tempfile.mkdtemp(prefix='langform-native-refresh-'));bundle=build/'LangformRefreshNative.app';executable=bundle/'Contents/MacOS/LangformRefreshNative';executable.parent.mkdir(parents=True)
script='new Function("window",'+json.dumps(feed)+')(new Proxy(window,{get(target,key){if(key==="location")return {hostname:"m.youtube.com",pathname:"/",href:"https://m.youtube.com/"};const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}}));'
swift=r'''
import UIKit
import WebKit
import QuartzCore

final class NativeRun: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKURLSchemeHandler {
    let output = URL(fileURLWithPath: __OUTPUT__)
    let readinessScript = __SCRIPT__
    var web: WKWebView!
    var scroll: UIScrollView!, surface: UIView!, html = ""
    var refresh: FeedRefresh!
    var navigation: WKNavigation?
    var started = false, requested = false, finished = false
    var imageRequests = 0, captureOffset: CGFloat = .greatestFiniteMagnitude
    var restY: Double?, pullY: Double?, armedY: Double?, beforeReleaseY: Double?, rows: [[String:Any]] = []
    var sampler: CADisplayLink?
    let began = CACurrentMediaTime()
    func emit(_ object:[String:Any]) {
        if let data=try? JSONSerialization.data(withJSONObject:object,options:[.sortedKeys]),let text=String(data:data,encoding:.utf8){print(text);fflush(stdout)}
    }
    func start(in view:UIView) {
        let configuration=WKWebViewConfiguration()
        configuration.userContentController.add(self,name:"langformFeedReady")
        configuration.userContentController.addUserScript(WKUserScript(source:readinessScript,injectionTime:.atDocumentStart,forMainFrameOnly:true))
        configuration.setURLSchemeHandler(self,forURLScheme:"fixture")
        web=WKWebView(frame:view.bounds,configuration:configuration);web.autoresizingMask=[.flexibleWidth,.flexibleHeight]
        web.isOpaque=false;web.backgroundColor = .white;web.scrollView.backgroundColor = .white
        web.scrollView.contentInsetAdjustmentBehavior = .never;web.scrollView.isScrollEnabled=false;web.navigationDelegate=self
        surface=view;scroll=UIScrollView(frame:view.bounds);scroll.autoresizingMask=[.flexibleWidth,.flexibleHeight];scroll.contentInsetAdjustmentBehavior = .never;scroll.backgroundColor = .white
        scroll.contentSize=CGSize(width:view.bounds.width,height:2600);view.addSubview(scroll);scroll.addSubview(web)
        refresh=FeedRefresh(scrollView:scroll,contentView:surface,canRefresh:{true},onRefresh:{[weak self] in
            guard let self else{return nil};self.captureOffset=self.scroll.contentOffset.y
            self.emit(["event":"capture-and-reload","offset":Double(self.captureOffset),"elapsed":CACurrentMediaTime()-self.began])
            let nav=self.web.reload();self.navigation=nav;return nav
        })
        html="""
        <!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        html,body{margin:0;background:#f8f8f8;font:16px -apple-system}#header{height:120px;background:#ddd}#marker{height:8px;background:rgb(255,0,0)}ytm-video-with-context-renderer{display:block}a{display:block;color:#111;text-decoration:none}img{display:block;width:100%;height:200px;object-fit:cover}h3{margin:12px 16px}#tail{height:2200px;background:linear-gradient(#ececec,#aaa)}
        </style><div id="header"></div><div id="marker"></div><ytm-video-with-context-renderer><a href="/watch?v=abcdefghijk"><img src="fixture://thumbnail.svg"><h3>A real painted feed row</h3></a></ytm-video-with-context-renderer><div id="tail"></div></html>
        """
        navigation=web.load(URLRequest(url:URL(string:"fixture://feed.html")!))
        DispatchQueue.main.asyncAfter(deadline:.now()+12){[weak self]in guard let self,!self.finished else{return};self.emit(["finished":true,"passed":false,"error":"native fixture timeout","imageRequests":self.imageRequests]);exit(2)}
    }
    func webView(_ webView:WKWebView,didCommit navigation:WKNavigation!) { refresh.navigationCommitted(navigation) }
    func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!) {
        refresh.finish(navigation:navigation)
        if !started {started=true;DispatchQueue.main.asyncAfter(deadline:.now()+0.2){self.pull()}}
    }
    func pull() {
        restY=snapshot("rest")
        scroll.setContentOffset(CGPoint(x:0,y:-80),animated:false)
        DispatchQueue.main.asyncAfter(deadline:.now()+0.08){
            self.requested=true;self.pullY = self.snapshot("pull")
            self.sampler=CADisplayLink(target:self,selector:#selector(self.sample(_:)));self.sampler?.add(to:.main,forMode:.common)
            self.refresh.refreshRequested()
            self.armedY=self.snapshot("after-arm-before-return")
            // The production helper never writes this offset. The harness asks
            // the real UIScrollView to perform its native animated return.
            self.scroll.setContentOffset(.zero,animated:true)
        }
    }
    @objc func sample(_ link:CADisplayLink) {
        rows.append(["elapsed":CACurrentMediaTime()-began,"offset":Double(scroll.contentOffset.y),"presentationOffset":Double(scroll.layer.presentation()?.bounds.origin.y ?? scroll.bounds.origin.y)])
    }
    func userContentController(_ controller:WKUserContentController,didReceive message:WKScriptMessage) {
        guard requested,!finished,refresh.acceptsContentReady(navigation:navigation) else{return}
        beforeReleaseY=snapshot("cover-before-release")
        refresh.contentReady(navigation:navigation)
        DispatchQueue.main.asyncAfter(deadline:.now()+0.08){self.complete()}
    }
    func complete() {
        guard !finished else{return};finished=true;sampler?.invalidate();sampler=nil
        let after=snapshot("after-release")
        let jump=(beforeReleaseY != nil && after != nil) ? abs(beforeReleaseY!-after!) : Double.greatestFiniteMagnitude
        let appearanceJump=(pullY != nil && armedY != nil) ? abs(pullY!-armedY!) : Double.greatestFiniteMagnitude
        emit(["finished":true,"passed":jump<=1&&appearanceJump<=1&&abs(captureOffset)<=0.5,"coverAppearanceJumpPoints":appearanceJump,"pullMarkerY":pullY as Any,"armedMarkerY":armedY as Any,"restMarkerY":restY as Any,"coverMarkerY":beforeReleaseY as Any,"afterMarkerY":after as Any,"coverReleaseJumpPoints":jump,"captureOffset":Double(captureOffset),"imageRequests":imageRequests,"viewportWidth":Double(web.bounds.width),"viewportHeight":Double(web.bounds.height),"samples":rows,"environment":"real macOS Catalyst UIScrollView + WKWebView content, programmatic native scroll return; not physical iPhone swipe"])
        refresh.detach();exit(0)
    }
    func snapshot(_ name:String)->Double? {
        let format=UIGraphicsImageRendererFormat();format.scale=1
        let image=UIGraphicsImageRenderer(bounds:surface.bounds,format:format).image{_ in surface.drawHierarchy(in:surface.bounds,afterScreenUpdates:true)}
        try? image.pngData()?.write(to:output.appendingPathComponent(name+".png"))
        guard let cg=image.cgImage else{return nil};let width=cg.width,height=cg.height
        var pixels=[UInt8](repeating:0,count:width*height*4)
        guard let context=CGContext(data:&pixels,width:width,height:height,bitsPerComponent:8,bytesPerRow:width*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)else{return nil}
        context.draw(cg,in:CGRect(x:0,y:0,width:width,height:height))
        let x=min(40,width-1);var ys=[Double]()
        for y in 0..<height {let n=(y*width+x)*4;if pixels[n]>220&&pixels[n+1]<35&&pixels[n+2]<35 {ys.append(Double(y))}}
        let value=ys.isEmpty ? nil : ys.reduce(0,+)/Double(ys.count)
        emit(["event":"raster-marker","name":name,"markerY":value as Any,"redPixels":ys.count])
        return value
    }
    func webView(_ webView:WKWebView,start task:WKURLSchemeTask) {
        imageRequests+=1
        let svg="<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'><rect width='800' height='450' fill='#386d94'/><text x='30' y='160' fill='white' font-size='44'>Painted thumbnail</text></svg>"
        let url=task.request.url!,isPage=url.host=="feed.html"
        let bytes=Data((isPage ? html.replacingOccurrences(of:"thumbnail.svg",with:"thumbnail.svg?request="+String(imageRequests)) : svg).utf8)
        DispatchQueue.main.asyncAfter(deadline:.now()+(isPage ? 0 : 0.35)){
            task.didReceive(URLResponse(url:url,mimeType:isPage ? "text/html" : "image/svg+xml",expectedContentLength:bytes.count,textEncodingName:"utf-8"));task.didReceive(bytes);task.didFinish()
        }
    }
    func webView(_ webView:WKWebView,stop task:WKURLSchemeTask) {}
}
let run=NativeRun()
final class AppDelegate:UIResponder,UIApplicationDelegate {
    func application(_ application:UIApplication,configurationForConnecting session:UISceneSession,options:UIScene.ConnectionOptions)->UISceneConfiguration{let config=UISceneConfiguration(name:"Default",sessionRole:session.role);config.delegateClass=SceneDelegate.self;return config}
}
final class SceneDelegate:UIResponder,UIWindowSceneDelegate {
    var window:UIWindow?
    func scene(_ scene:UIScene,willConnectTo session:UISceneSession,options:UIScene.ConnectionOptions){
        guard let scene=scene as? UIWindowScene else{return}
        scene.sizeRestrictions?.minimumSize=CGSize(width:390,height:844);scene.sizeRestrictions?.maximumSize=CGSize(width:390,height:844)
        let window=UIWindow(windowScene:scene);self.window=window;let controller=UIViewController();controller.view.backgroundColor = .white;window.rootViewController=controller;window.makeKeyAndVisible()
        DispatchQueue.main.asyncAfter(deadline:.now()+0.1){run.start(in:controller.view)}
    }
}
UIApplicationMain(CommandLine.argc,CommandLine.unsafeArgv,nil,NSStringFromClass(AppDelegate.self))
'''
swift=swift.replace('__OUTPUT__',json.dumps(str(a.output.resolve()))).replace('__SCRIPT__',json.dumps(script))
main=build/'main.swift';main.write_text(helper+'\n'+swift)
sdk=subprocess.check_output(['xcrun','--sdk','macosx','--show-sdk-path'],text=True).strip();support=Path(sdk)/'System/iOSSupport'
command=['xcrun','swiftc','-target',platform.machine()+'-apple-ios17.0-macabi','-sdk',sdk,'-F',str(support/'System/Library/Frameworks'),'-I',str(support/'usr/include'),'-L',str(support/'usr/lib'),str(main),'-o',str(executable)]
subprocess.run(command,check=True)
info={'CFBundleIdentifier':'dev.langform.refresh-native','CFBundleName':'LangformRefreshNative','CFBundleExecutable':'LangformRefreshNative','CFBundlePackageType':'APPL','LSUIElement':True,'UIApplicationSceneManifest':{'UIApplicationSupportsMultipleScenes':False,'UISceneConfigurations':{'UIWindowSceneSessionRoleApplication':[{'UISceneConfigurationName':'Default'}]}}}
with (bundle/'Contents/Info.plist').open('wb') as f:plistlib.dump(info,f)
subprocess.run(['codesign','--force','--sign','-',str(bundle)],check=True)
result=subprocess.run([str(executable)],text=True,capture_output=True,timeout=20)
(a.output/'native.jsonl').write_text(result.stdout)
(a.output/'stderr.log').write_text(result.stderr)
(a.output/'source-fingerprints.json').write_text(json.dumps({'feedRefreshSource':str(source),'feedRefreshSha256':hashlib.sha256(original.encode()).hexdigest(),'feedMotionSha256':hashlib.sha256(feed.encode()).hexdigest()},indent=2)+'\n')
print(result.stdout,end='')
if result.returncode:print(result.stderr);raise SystemExit(result.returncode)
