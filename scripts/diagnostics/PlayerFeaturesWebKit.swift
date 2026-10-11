import AppKit
import WebKit

/// Real WebKit media/rate/seek/capture regression, with offline WAV content and
/// controlled SponsorBlock bridge responses. It does not emulate finger input.
@MainActor
final class PlayerFeaturesRunner: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var web: WKWebView!, window: NSWindow!, loading: CheckedContinuation<Void, Error>?
    var checks = 0
    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(self,name:"langformSponsorBlock")
        configuration.userContentController.add(self,name:"langformFullscreen")
        for name in ["WebViewLinks","PlaybackHold","SponsorBlock","FullscreenMotion"] {
            let source = try! String(contentsOfFile: FileManager.default.currentDirectoryPath + "/ios/Langform/Langform/" + name + ".js",encoding:.utf8)
            configuration.userContentController.addUserScript(WKUserScript(source:source,injectionTime:.atDocumentStart,forMainFrameOnly:true))
        }
        web = WKWebView(frame:NSRect(x:0,y:0,width:400,height:400),configuration:configuration)
        web.navigationDelegate = self
        window = NSWindow(contentRect:web.frame,styleMask:[.titled],backing:.buffered,defer:false)
        window.contentView = web; window.title = "Langform Player Features · Offline WebKit QA"; window.center(); window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps:true)
        DispatchQueue.main.asyncAfter(deadline:.now()+30) { [weak self] in self?.finish("timeout") }
        Task { @MainActor in do { try await exercise(); finish(nil) } catch { finish(String(describing:error)) } }
    }
    func userContentController(_ controller:WKUserContentController,didReceive message:WKScriptMessage) {
        guard let data=try? JSONSerialization.data(withJSONObject:message.body),let value=String(data:data,encoding:.utf8) else{return}
        web.evaluateJavaScript("window.posts.push(\(value))")
    }
    func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!) { loading?.resume();loading=nil }
    func js(_ source:String) async throws -> Any? {
        try await withCheckedThrowingContinuation { continuation in
            web.evaluateJavaScript(source) { value,error in if let error { continuation.resume(throwing:error) } else { continuation.resume(returning:value) } }
        }
    }
    func check(_ label:String,_ source:String) async throws {
        let value = try await js(source) as? Bool == true
        checks += 1
        print("{\"check\":\"\(label)\",\"passed\":\(value)}")
        if !value {
            print("{\"applicationActive\":\(NSApp.isActive),\"windowVisible\":\(window.isVisible),\"windowOccluded\":\(!window.occlusionState.contains(.visible)),\"webViewHidden\":\(web.isHidden)}")
            print(try await js("JSON.stringify({rate:v.playbackRate,paused:v.paused,seeking:v.seeking,time:v.currentTime,ready:v.readyState,held:__langformPlaybackHold.isActive(),holdTraces:window.holdTraces})") ?? "")
            throw NSError(domain:"PlayerFeatures",code:checks,userInfo:[NSLocalizedDescriptionKey:label])
        }
    }
    func wait(_ milliseconds:UInt64) async throws { try await Task.sleep(nanoseconds:milliseconds*1_000_000) }
    func wav() -> String {
        let rate:UInt32 = 8000, payload=Data(repeating:0,count:Int(rate)*2*8)
        var data=Data()
        func ascii(_ value:String){data.append(contentsOf:value.utf8)}
        func u16(_ value:UInt16){var v=value.littleEndian;withUnsafeBytes(of:&v){data.append(contentsOf:$0)}}
        func u32(_ value:UInt32){var v=value.littleEndian;withUnsafeBytes(of:&v){data.append(contentsOf:$0)}}
        ascii("RIFF");u32(UInt32(payload.count)+36);ascii("WAVEfmt ");u32(16);u16(1);u16(1);u32(rate);u32(rate*2);u16(2);u16(16);ascii("data");u32(UInt32(payload.count));data.append(payload)
        return data.base64EncodedString()
    }
    func exercise() async throws {
        let html="""
        <!doctype html><meta charset=utf-8><style>body{margin:0;background:#181818}ytm-player{display:block;position:relative;width:400px;height:240px}#movie_player{width:400px;height:240px}video{width:400px;height:240px}#surface{position:absolute;inset:0}button{position:absolute;left:180px;top:100px;width:44px;height:44px}</style>
        <ytm-player><div id=movie_player><video playsinline preload=auto src="data:audio/wav;base64,\(wav())"></video><button id=fullscreen class=ytp-fullscreen-button>Full</button></div><ytm-custom-control id=player-control-overlay><div id=surface class=player-controls-background></div><button id=control><svg><text>10</text></svg></button></ytm-custom-control></ytm-player><p id=outside>Ordinary selectable text</p>
        <script>window.posts=[];window.clicks=0;window.seeks=[];window.holdTraces=[];window.__langformPlaybackHoldTrace=function(value){holdTraces.push(value);if(holdTraces.length>10)holdTraces.shift()};window.testID='abcdefghijk';window.r=document.getElementById('movie_player');window.v=r.querySelector('video');r.getVideoData=function(){return{video_id:testID}};r.seekTo=function(time){seeks.push(time);v.currentTime=time};document.getElementById('surface').addEventListener('click',function(){clicks++});window.pointer=function(name,x,target){var e=new PointerEvent(name,{bubbles:true,cancelable:true,pointerId:1,isPrimary:true,clientX:x||80,clientY:110});(target||document.getElementById('surface')).dispatchEvent(e);return e.defaultPrevented};window.selection=function(name,target){var e=new Event(name,{bubbles:true,cancelable:true});target.dispatchEvent(e);return e.defaultPrevented};</script>
        """
        try await withCheckedThrowingContinuation { continuation in loading=continuation;web.loadHTMLString(html,baseURL:URL(string:"https://m.youtube.com/watch?v=abcdefghijk")) }
        for _ in 0..<50 { if try await js("!document.hidden") as? Bool == true {break};try await wait(50) }
        try await check("real WebKit document is visible", "!document.hidden")
        for _ in 0..<50 { if try await js("v.readyState>=2") as? Bool == true {break};try await wait(50) }
        try await check("real WebKit decoded media", "v.readyState>=2&&v.duration===8")
        _ = try await js("v.playbackRate=1.25;v.play();true")
        try await wait(80)
        try await check("real WebKit running media", "!v.paused&&v.playbackRate===1.25")
        try await check("ordinary context menu and selection preserved without hold", "!selection('contextmenu',r)&&!selection('selectstart',document.getElementById('control'))&&!selection('selectstart',document.getElementById('outside'))&&!document.querySelector('[data-langform-playback-held]')")
        _ = try await js("pointer('pointerdown',80);true")
        try await wait(120)
        _ = try await js("pointer('pointerup',80);pointer('click',80);true")
        try await check("short tap preserved", "clicks===1&&v.playbackRate===1.25")
        _ = try await js("pointer('pointerdown',80);true")
        try await wait(420)
        try await check("left hold actual 2x", "v.playbackRate===2&&__langformPlaybackHold.isActive()&&!!document.getElementById('langform-playback-hold')")
        try await check("owned root sibling and nearby SVG cannot select during actual hold", "selection('contextmenu',r)&&selection('contextmenu',document.getElementById('surface'))&&selection('selectstart',document.querySelector('#control text'))&&getComputedStyle(document.querySelector('#control text')).webkitUserSelect==='none'&&!selection('contextmenu',document.getElementById('outside'))&&!selection('selectstart',document.getElementById('outside'))")
        _ = try await js("pointer('pointerup',80);pointer('click',80);true")
        try await check("release actual restoration and capture", "v.playbackRate===1.25&&clicks===1&&!__langformPlaybackHold.isActive()")
        try await check("released gesture restores ordinary selection and removes scoped WebKit guard", "!selection('contextmenu',document.getElementById('surface'))&&!selection('selectstart',document.querySelector('#control text'))&&!document.querySelector('[data-langform-playback-held]')&&!document.getElementById('langform-playback-hold-selection-style')")
        _ = try await js("pointer('pointerdown',320);true")
        try await wait(420)
        try await check("right hold actual 2x", "v.playbackRate===2")
        _ = try await js("pointer('pointercancel',320);true")
        try await check("pointercancel restores", "v.playbackRate===1.25&&!__langformPlaybackHold.isActive()")
        _ = try await js("pointer('pointerdown',80,document.getElementById('control'));true")
        try await wait(420)
        try await check("button cannot begin hold", "v.playbackRate===1.25&&!__langformPlaybackHold.isActive()")
        _ = try await js("v.pause();v.currentTime=1.2;__langformSponsorBlock.setEnabled(true);true")
        try await wait(50)
        try await check("opt in creates one native request", "posts.filter(x=>x.kind==='fetch').length===1")
        _ = try await js("var q=posts.filter(x=>x.kind==='fetch').pop();__langformSponsorBlockReceive({requestID:q.requestID,videoID:q.videoID,status:'ok',segments:[{category:'sponsor',actionType:'skip',segment:[1,3],videoDuration:8,UUID:'fixture'}]});true")
        try await check("paused response cannot seek", "seeks.length===0&&__langformSponsorBlock.getStatus().status==='ready'")
        _ = try await js("v.play();true")
        try await wait(100)
        try await check("actual media sponsor seek", "seeks.length===1&&seeks[0]===3&&v.currentTime>=3&&__langformSponsorBlock.getStatus().canUndo")
        try await wait(100)
        _ = try await js("v.pause();window.originalSeek=r.seekTo;r.seekTo=function(time){seeks.push(time)};window.firstUndoResult=__langformSponsorBlock.undo();true")
        try await check("ignored undo preserves actual position and retry", "firstUndoResult===false&&v.currentTime>=3&&__langformSponsorBlock.getStatus().canUndo&&seeks.length===2")
        _ = try await js("r.seekTo=function(time){seeks.push(time);setTimeout(function(){v.currentTime=time},100)};window.delayedUndoResult=__langformSponsorBlock.undo();true")
        try await check("deferred undo cannot claim unconfirmed return", "delayedUndoResult===false&&v.currentTime>=3&&__langformSponsorBlock.getStatus().canUndo")
        try await wait(200)
        _ = try await js("r.seekTo=originalSeek;v.play();true")
        try await wait(100)
        try await check("undo permits real sponsor playback", "seeks.length===3&&seeks[2]>=1.2&&seeks[2]<2&&v.currentTime<3&&!__langformSponsorBlock.getStatus().canUndo")
        for _ in 0..<30 { if try await js("!v.seeking&&v.readyState>=2&&!v.paused") as? Bool == true {break};try await wait(50) }
        _ = try await js("document.getElementById('fullscreen').click();true")
        try await check("shipping fullscreen opens with real media", "__langformFullscreen.isOpen()&&!!document.getElementById('langform-fullscreen-ui')&&!v.paused")
        for side in [80,320] {
            _ = try await js("pointer('pointerdown',\(side),document.getElementById('langform-fullscreen-ui'));true")
            try await wait(420)
            try await check("fullscreen side \(side) actual 2x and visible badge", "v.playbackRate===2&&__langformPlaybackHold.isActive()&&document.getElementById('langform-playback-hold').parentElement.id==='langform-fullscreen-ui'&&getComputedStyle(document.getElementById('langform-playback-hold')).visibility==='visible'&&getComputedStyle(document.getElementById('langform-playback-hold')).opacity!=='0'")
            try await check("fullscreen side \(side) excludes native selection competition inside owned UI", "selection('contextmenu',document.getElementById('langform-fullscreen-ui'))&&selection('contextmenu',document.querySelector('[data-action=back] svg'))&&selection('selectstart',document.querySelector('[data-action=back] svg'))&&getComputedStyle(document.querySelector('[data-action=back] svg')).webkitUserSelect==='none'&&!selection('contextmenu',document.getElementById('outside'))")
            _ = try await js("pointer('pointerup',\(side),document.getElementById('langform-fullscreen-ui'));true")
            try await check("fullscreen side \(side) restores actual prior rate", "v.playbackRate===1.25&&!__langformPlaybackHold.isActive()&&!document.getElementById('langform-playback-hold')&&!document.querySelector('[data-langform-playback-held]')&&!selection('selectstart',document.querySelector('[data-action=back] svg'))")
        }
        _ = try await js("__langformFullscreen.exit();true")
        try await check("fullscreen exit preserves restored rate", "!__langformFullscreen.isOpen()&&v.playbackRate===1.25&&!v.paused")
        _ = try await js("pointer('pointerdown',80);true")
        try await wait(420)
        try await check("hold before route replacement", "v.playbackRate===2")
        _ = try await js("history.pushState({},'','/watch?v=lmnopqrstuv');testID='lmnopqrstuv';dispatchEvent(new Event('popstate'));true")
        try await check("route change restores still owned old source", "v.playbackRate===1.25&&!__langformPlaybackHold.isActive()&&__langformSponsorBlock.getStatus().videoID==='lmnopqrstuv'")
        _ = try await js("history.replaceState({},'','/watch?v=abcdefghijk');testID='abcdefghijk';dispatchEvent(new Event('popstate'));v.currentTime=4;true")
        for _ in 0..<30 { if try await js("!v.seeking&&v.readyState>=2&&!v.paused") as? Bool == true {break};try await wait(50) }
        _ = try await js("pointer('pointerdown',80);true")
        try await wait(420)
        try await check("hold before same element source replacement", "v.playbackRate===2")
        _ = try await js("v.src=v.src+'#replacement';v.load();true")
        try await wait(100)
        try await check("same element replacement cannot inherit hold rate", "v.playbackRate!==2&&!__langformPlaybackHold.isActive()&&!document.querySelector('[data-langform-playback-held]')&&!document.getElementById('langform-playback-hold-selection-style')")
    }
    func finish(_ error:String?) {
        let result:[String:Any] = ["finished":true,"passed":error == nil,"checks":checks,"platform":"macOS WKWebView","realDecodedMedia":true,"syntheticPointerEvents":true,"error":error ?? ""]
        let data=try! JSONSerialization.data(withJSONObject:result,options:.sortedKeys);print(String(data:data,encoding:.utf8)!)
        web?.stopLoading();window?.orderOut(nil);exit(error == nil ? 0:1)
    }
}
MainActor.assumeIsolated {
    let app=NSApplication.shared
    let runner=PlayerFeaturesRunner()
    app.delegate=runner
    app.setActivationPolicy(.regular)
    app.run()
}
