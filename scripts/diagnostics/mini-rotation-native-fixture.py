#!/usr/bin/env python3
"""Historical, rejected raster-cover experiment on Mac Catalyst.

The fixture uses explicit phone-sized stage coordinates and a colored HTML
header/video region. --decoded-video additionally probes a real muted H.264
media layer, whose native snapshot support must be assessed separately.
The raster cover was removed after real hardware-backed media snapshots were
black. Current production uses mini-stage-insets-native-fixture.py instead.
An archived matching native source is needed to rerun this historical fixture.
This is not physical iPhone rotation QA or accepted media continuity evidence.
No Langform app bundle, signing identity or device is changed.
"""
import argparse
import base64
import hashlib
import json
import platform
import plistlib
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--decoded-video', action='store_true')
parser.add_argument('--snapshot-probe', action='store_true')
parser.add_argument('--live-safe-area', action='store_true')
parser.add_argument('--hold-seconds', type=float, default=0)
parser.add_argument('--stage-owned-insets', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
source = args.source or root / 'ios/Langform/Langform/YouTubeWebView.swift'
original = source.read_text()
if 'func holdMiniViewportPicture(' not in original:
    parser.error('The rejected raster-cover implementation is absent. Use '
                 'mini-stage-insets-native-fixture.py for current production, '
                 'or --source with an archived historical implementation.')
args.output.mkdir(parents=True, exist_ok=True)


def declaration(text, signature):
    start = text.index(signature)
    opening = text.index('{', start)
    depth, end = 1, opening + 1
    while depth and end < len(text):
        depth += (text[end] == '{') - (text[end] == '}')
        end += 1
    if depth:
        raise ValueError('Unclosed declaration: ' + signature)
    return text[start:end]


names = ['func resetPlayerForViewportChange(', 'var hasVideoRect:',
         'var pictureRect:', 'func miniFrame(', 'func apply(',
         'func holdMiniViewportPicture(', 'func finishMiniViewportCover(',
         'func finishMiniContext(', 'var cardMoving:', 'func flushPendingRect(', 'func synchronizeStageInsets(']
chunks = '\n'.join(declaration(original, name) for name in names)
layout = declaration(original, 'override func layoutSubviews()')
player_layout = declaration(layout, 'if let player {')
receiver = declaration(original,
    'if customFullscreenEnter == nil && customFullscreenExit == nil && PlayerViewportPolicy.matches(reported: viewport, current: player.bounds.size)')
policy = '\n'.join((root / 'ios/Langform/Langform' / name).read_text()
    for name in ['PlayerGesturePolicy.swift', 'PlayerViewportPolicy.swift'])
video = (root / 'tests/fixtures/mini-rotation-green.mp4').read_bytes()
viewport_source = (root / 'ios/Langform/Langform/ViewportLayout.js').read_text()
viewport_script = 'new Function("window",' + json.dumps(viewport_source) + ')(new Proxy(window,{get(target,key){if(key==="location")return {hostname:"m.youtube.com",pathname:"/watch",href:"https://m.youtube.com/watch?v=abcdefghijk"};const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}}));'

swift = r'''
import UIKit
import WebKit
import QuartzCore

final class Stage: UIView {
    enum Mode { case closed, loading, expanded, mini }
    struct StartupStatus { var keepsStartupPoster = false }
    var mode = Mode.expanded, startupStatus = StartupStatus()
    var player: WKWebView!
    let card = UIView(), closeButton = UIView(), miniPlaybackButton = UIView(), collapseButton = UIView()
    let drag = UIPanGestureRecognizer(), edgeBack = UIScreenEdgePanGestureRecognizer(), cardTap = UITapGestureRecognizer()
    var settler: UIViewPropertyAnimator?, revealer: UIViewPropertyAnimator?, dismisser: UIViewPropertyAnimator?
    var miniContext: UIView?, miniViewportCover: UIView?, miniViewportCoverAspect: CGFloat?
    var pendingRect: CGRect?, videoRect = CGRect.zero, playerLayoutSize = CGSize.zero
    var viewportGeneration = 0, awaitingViewportGeometry = false, videoCropActive = false
    var settlingBetweenModes = false, dragging = false, ownsWatchPlayer = true
    var progress: CGFloat = 0
    var customFullscreenExit: Bool?
    var customFullscreenEnter: Bool?
    static let stageInsetsScriptPrefix = "// langform-stage-insets-v1\n"
    let stageInsetsByView = NSMapTable<WKWebView, NSValue>(keyOptions:.weakMemory, valueOptions:.strongMemory)
    let stageMiniByView = NSMapTable<WKWebView, NSNumber>(keyOptions:.weakMemory, valueOptions:.strongMemory)
    var stageInsetsSourceCache: (insets:UIEdgeInsets, nativeMini:Bool, source:String)?
    var dragPosition: PlayerGesturePolicy.Position? { mode == .mini ? .mini : (mode == .expanded ? .expanded : nil) }
    static let bottomBarHeight: CGFloat = 48
    override init(frame: CGRect) {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        if __LIVE_SAFE_AREA__ {
            configuration.userContentController.addUserScript(WKUserScript(source:__VIEWPORT_SCRIPT__, injectionTime:.atDocumentStart, forMainFrameOnly:true))
        }
        player = WKWebView(frame: .zero, configuration: configuration)
        super.init(frame: frame)
        card.clipsToBounds = true; card.backgroundColor = .black
        backgroundColor = .darkGray
        addSubview(card); card.addSubview(player); card.addSubview(closeButton); card.addSubview(miniPlaybackButton)
        closeButton.backgroundColor = .magenta; miniPlaybackButton.backgroundColor = .magenta
        player.scrollView.contentInsetAdjustmentBehavior = .never
        player.scrollView.isScrollEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }
    func updateChrome() {}
    func updatePlaybackControls() {}
    func applyFullscreenSurface(_ t:CGFloat)->Bool { false }
    func fullscreenPlayerViewport(default viewport:CGSize)->CGSize { viewport }
    func finishClose() { mode = .closed; finishMiniContext() }
    func stopReveal(preservingStartupPoster: Bool = false) {}
    func endDrag() { dragging = false }
    func showStartupPoster() {}
    func measureVideo(after: Double, completion: () -> Void) {}
    func confirmCustomFullscreenExit() {}
    func confirmCustomFullscreenEnter() {}
    override func layoutSubviews() {
        super.layoutSubviews()
        let playerInsetsChanged = __STAGE_OWNED_INSETS__ ? synchronizeStageInsets(player) : false
        __PLAYER_LAYOUT__
    }
    func report(_ rect: CGRect, viewport: CGSize) {
        __RECEIVER__
    }
    __CHUNKS__
}

final class NativeRun: NSObject, WKNavigationDelegate {
    let output = URL(fileURLWithPath: __OUTPUT__)
    var stage: Stage!
    var checks = [[String: Any]](), finished = false
    var lastCover: UIView?
    let portrait = CGSize(width: 390, height: 844), landscape = CGSize(width: 844, height: 390)
    func emit(_ value: [String: Any]) {
        if let bytes = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
           let string = String(data: bytes, encoding: .utf8) { print(string); fflush(stdout) }
    }
    func expect(_ value: Bool, _ name: String) {
        let entry: [String: Any] = ["check": name, "passed": value]
        checks.append(entry); emit(entry)
    }
    func start(in surface: UIView) {
        stage = Stage(frame: CGRect(origin: .zero, size: portrait)); surface.addSubview(stage)
        stage.layoutIfNeeded(); stage.player.navigationDelegate = self
        let html = """
        <!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
        html,body{margin:0;background:rgb(0,0,255)}#header{height:107px;background:rgb(255,0,0)}
        #video{display:block;width:100vw;height:56.25vw;background:__VIDEO_BACKGROUND__;object-fit:fill}#comments{height:1800px;background:rgb(0,0,255)}
        </style><div id="header"></div>__VIDEO_ELEMENT__<div id="comments"></div></html>
        """
        stage.player.loadHTMLString(html, baseURL: URL(string: "https://m.youtube.com/watch?v=abcdefghijk"))
        DispatchQueue.main.asyncAfter(deadline: .now() + 8 + __HOLD_SECONDS__) { [weak self] in
            guard let self, !self.finished else { return }
            self.emit(["finished": true, "passed": false, "error": "native mini fixture timeout"]); exit(2)
        }
    }
    func geometry(_ completion: @escaping (CGRect, CGSize) -> Void) {
        stage.player.evaluateJavaScript("(()=>{let r=document.getElementById('video').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,vw:innerWidth,vh:innerHeight}})()") { result, error in
            guard let data = result as? [String: Double] else {
                self.emit(["finished": true, "passed": false, "error": String(describing: error)]); exit(2)
            }
            completion(CGRect(x:data["x"]!, y:data["y"]!, width:data["w"]!, height:data["h"]!),
                CGSize(width:data["vw"]!, height:data["vh"]!))
        }
    }
    func recordSafeArea(_ phase: String) {
        stage.player.evaluateJavaScript("(()=>{let r=document.getElementById('video').getBoundingClientRect();let p=document.getElementById('env-probe');return {videoY:r.y,videoW:r.width,videoH:r.height,viewportW:innerWidth,viewportH:innerHeight,envTop:p?parseFloat(getComputedStyle(p).paddingTop):null}})()") { value, _ in
            let row:[String:Any] = ["event":"live-safe-area", "phase":phase,
                "stageTop":Double(self.stage.safeAreaInsets.top), "cardTop":Double(self.stage.card.safeAreaInsets.top),
                "wkTop":Double(self.stage.player.safeAreaInsets.top), "wkBottom":Double(self.stage.player.safeAreaInsets.bottom),
                "wkWidth":Double(self.stage.player.bounds.width), "wkHeight":Double(self.stage.player.bounds.height),
                    "stageOwnedInsets":__STAGE_OWNED_INSETS__, "dom":value as? [String:Any] ?? [:]]
            self.emit(row)
            if let data = try? JSONSerialization.data(withJSONObject:row, options:[.sortedKeys]) {
                let path = self.output.appendingPathComponent("live-safe-area.jsonl")
                if !FileManager.default.fileExists(atPath:path.path) { FileManager.default.createFile(atPath:path.path, contents:nil) }
                if let file = try? FileHandle(forWritingTo:path) { try? file.seekToEnd(); try? file.write(contentsOf:data + Data("\n".utf8)); try? file.close() }
            }
        }
    }
    func webView(_ view: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            if __DECODED_VIDEO__ {
                self.stage.player.evaluateJavaScript("(()=>{let v=document.getElementById('video');return {playing:!v.paused,ready:v.readyState,time:v.currentTime}})()") { value, _ in
                    let data = value as? [String:Any] ?? [:]
                    self.expect(data["playing"] as? Bool == true && (data["ready"] as? Int ?? 0) >= 2
                        && (data["time"] as? Double ?? 0) > 0, "real local H.264 video has decoded and is playing")
                    self.emit(["event":"decoded-video", "state":data])
                }
            }
            self.geometry { rect, viewport in
                self.stage.report(rect, viewport: viewport)
                self.recordSafeArea("expanded-before-crop")
                self.stage.mode = .mini; self.stage.videoCropActive = true; self.stage.progress = 1
                if __STAGE_OWNED_INSETS__ { self.stage.synchronizeStageInsets(self.stage.player) }
                self.stage.apply(1)
                self.expect(self.stage.player.bounds.size == self.portrait, "mini keeps the full portrait WK viewport")
                // Let UIKit present the real mini pose before requesting its
                // last displayed pixels, matching an established on-screen mini.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
                    self.recordSafeArea("mini-after-crop")
                    self.stage.player.evaluateJavaScript("(()=>{let v=document.getElementById('video');if(v.pause)v.pause()})()")
                    self.recordSafeArea("mini-paused")
                    self.stage.player.evaluateJavaScript("(()=>{let v=document.getElementById('video');if(v.play)v.play().catch(()=>{})})()")
                    self.recordSafeArea("mini-resumed")
                    self.pixels("confirmed-mini", expectGreen: true)
                    if __SNAPSHOT_PROBE__ {
                        let configuration = WKSnapshotConfiguration()
                        configuration.rect = rect
                        configuration.snapshotWidth = NSNumber(value:Double(self.stage.card.bounds.width))
                        self.stage.player.takeSnapshot(with:configuration) { image, error in
                            if let image {
                                self.stage.miniViewportCover = UIImageView(image:image)
                                self.coverPixels("webkit-picture-probe")
                                self.stage.miniViewportCover = nil
                            } else {
                                self.emit(["event":"webkit-picture-probe", "error":String(describing:error)])
                            }
                            self.resizeMissing(rect)
                        }
                    } else {
                        self.resizeMissing(rect)
                    }
                }
            }
        }
    }
    func resize(_ size: CGSize) {
        stage.frame = CGRect(origin: .zero, size: size)
        stage.setNeedsLayout(); stage.layoutIfNeeded()
    }
    func resizeMissing(_ old: CGRect) {
        resize(landscape); lastCover = stage.miniViewportCover
        expect(lastCover != nil, "rotation retains only the already clipped card snapshot")
        expect(stage.player.bounds.size == landscape, "covered mini receives the full landscape WK viewport")
        expect(stage.player.alpha == 0 && stage.awaitingViewportGeometry, "unconfirmed y=0 crop cannot show through the retained picture")
        coverPixels("video-only-cover")
        pixels("rotation-before-rect", expectGreen: true)
        stage.report(old, viewport: portrait)
        expect(stage.miniViewportCover === lastCover && stage.pendingRect == nil && stage.awaitingViewportGeometry,
               "stale orientation report cannot release the image")
        stage.report(.zero, viewport: landscape)
        expect(stage.miniViewportCover === lastCover && stage.awaitingViewportGeometry,
               "missing current picture cannot release the image")
        stage.pendingRect = CGRect(x: 0, y: 0, width: CGFloat.nan, height: 100)
        stage.flushPendingRect()
        expect(stage.miniViewportCover === lastCover && stage.awaitingViewportGeometry,
               "nonfinite pending geometry cannot bypass readiness")
        stage.settler = UIViewPropertyAnimator(duration: 1, curve: .easeOut)
        stage.report(CGRect(x:0, y:107, width:844, height:474.75), viewport: landscape)
        expect(stage.pendingRect != nil && stage.miniViewportCover === lastCover,
               "current geometry stays queued while native motion owns the card")
        resize(portrait)
        expect(stage.miniViewportCover === lastCover && stage.pendingRect == nil && stage.settler == nil,
               "second resize preserves the confirmed snapshot and clears earlier queued geometry")
        expect(stage.player.bounds.size == portrait, "second resize still assigns the full WK viewport immediately")
        stage.report(CGRect(x:0, y:107, width:844, height:474.75), viewport: landscape)
        expect(stage.miniViewportCover === lastCover && stage.awaitingViewportGeometry,
               "previous resize viewport cannot clear the replacement wait")
        pixels("second-rotation-before-rect", expectGreen: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            self.geometry { rect, viewport in
                self.expect(PlayerViewportPolicy.matches(reported: viewport, current: self.portrait),
                            "WebKit independently confirms the final viewport")
                // Repeated geometry can be numerically identical after two
                // resizes. It must still resolve the current viewport wait.
                self.stage.videoRect = rect
                self.stage.report(rect, viewport: viewport)
                self.expect(self.stage.miniViewportCover == nil && !self.stage.awaitingViewportGeometry
                    && self.stage.player.alpha == 1 && self.stage.settler == nil,
                    "valid identical geometry applies synchronously before cover release without another spring")
                self.expect(self.stage.player.bounds.size == self.portrait, "cover release never shrinks the WK viewport")
                self.pixels("current-rect-released", expectGreen: true)
                self.recordSafeArea("mini-after-rect-release")
                DispatchQueue.main.asyncAfter(deadline:.now() + __HOLD_SECONDS__) { self.lifecycle() }
            }
        }
    }
    func lifecycle() {
        resize(landscape)
        expect(stage.miniViewportCover != nil, "another resize may retain the newly confirmed card")
        stage.finishMiniContext()
        expect(stage.miniViewportCover == nil && stage.miniViewportCoverAspect == nil && stage.player.alpha == 0,
               "background cleanup discards the bitmap without exposing an unconfirmed header")
        pixels("background-cleanup-unconfirmed", expectGreen: false)
        stage.mode = .expanded; stage.progress = 0; stage.videoCropActive = false; stage.apply(0)
        expect(stage.player.alpha == 1 && stage.miniViewportCover == nil
            && stage.player.bounds.size == landscape && stage.card.bounds.size == landscape,
            "expansion removes temporary crop protection and restores the full page without resizing WK")
        finished = true
        let passed = checks.allSatisfy { $0["passed"] as? Bool == true }
        emit(["finished": true, "passed": passed, "checks": checks.count,
              "environment": "real Mac Catalyst UIKit + WKWebView; explicit phone-sized fixture, not physical iPhone rotation",
              "decodedVideoProbe": __DECODED_VIDEO__])
        exit(passed ? 0 : 1)
    }
    func pixels(_ name: String, expectGreen: Bool) {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let image = UIGraphicsImageRenderer(bounds: stage.card.bounds, format: format).image { _ in
            stage.card.drawHierarchy(in: stage.card.bounds, afterScreenUpdates: true)
        }
        try? image.pngData()?.write(to: output.appendingPathComponent(name + ".png"))
        guard let cg = image.cgImage else { expect(false, name + " raster exists"); return }
        let width = cg.width, height = cg.height
        var buffer = [UInt8](repeating: 0, count: width * height * 4)
        guard let context = CGContext(data: &buffer, width: width, height: height,
            bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { expect(false, name + " raster context exists"); return }
        context.draw(cg, in: CGRect(x:0, y:0, width:width, height:height))
        var green = 0, red = 0, blue = 0
        for y in 4..<max(4, height - 4) { for x in 4..<max(4, width - 4) {
            let n = (y * width + x) * 4
            if buffer[n] < 35 && buffer[n+1] > 220 && buffer[n+2] < 35 { green += 1 }
            if buffer[n] > 220 && buffer[n+1] < 35 && buffer[n+2] < 35 { red += 1 }
            if buffer[n] < 35 && buffer[n+1] < 35 && buffer[n+2] > 220 { blue += 1 }
        }}
        let total = max(1, (width - 8) * (height - 8))
        emit(["event":"card-raster", "name":name, "green":green, "headerRed":red,
              "commentsBlue":blue, "pixels":total, "width":width, "height":height])
        // Two real 44pt magenta controls cover part of the small video. Their
        // raster must be excluded from the independent video cover below them.
        expect(red == 0 && blue == 0 && (!expectGreen || Double(green) / Double(total) > 0.6),
               name + " contains painted picture-region pixels and no header/comments")
    }
    func coverPixels(_ name: String) {
        guard let image = (stage.miniViewportCover as? UIImageView)?.image, let cg = image.cgImage else {
            expect(false, "resize cover is an independent image"); return
        }
        try? image.pngData()?.write(to: output.appendingPathComponent(name + ".png"))
        let width = cg.width, height = cg.height
        var buffer = [UInt8](repeating:0, count:width * height * 4)
        guard let context = CGContext(data:&buffer, width:width, height:height,
            bitsPerComponent:8, bytesPerRow:width * 4, space:CGColorSpaceCreateDeviceRGB(),
            bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) else { expect(false, "video cover raster exists"); return }
        context.draw(cg, in:CGRect(x:0, y:0, width:width, height:height))
        var green = 0, magenta = 0
        for n in stride(from:0, to:buffer.count, by:4) {
            if buffer[n] < 35 && buffer[n+1] > 220 && buffer[n+2] < 35 { green += 1 }
            if buffer[n] > 220 && buffer[n+1] < 35 && buffer[n+2] > 220 { magenta += 1 }
        }
        emit(["event":"cover-raster", "green":green, "nativeChromeMagenta":magenta, "pixels":width*height])
        expect(magenta == 0 && Double(green) / Double(width * height) > 0.99,
               "independent cover contains only picture-region pixels, no native play/close ghosts")
    }
}
let run = NativeRun()
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name:"Default", sessionRole:session.role)
        config.delegateClass = SceneDelegate.self; return config
    }
}
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        scene.sizeRestrictions?.minimumSize = CGSize(width:1000,height:900)
        scene.sizeRestrictions?.maximumSize = CGSize(width:1000,height:900)
        let window = UIWindow(windowScene:scene); self.window = window
        let controller = UIViewController(); window.rootViewController = controller; window.makeKeyAndVisible()
        DispatchQueue.main.asyncAfter(deadline:.now()+0.1) {
            if __LIVE_SAFE_AREA__ {
                controller.view.layoutIfNeeded()
                controller.additionalSafeAreaInsets = UIEdgeInsets(top:max(0,62-controller.view.safeAreaInsets.top), left:0, bottom:0, right:0)
                controller.view.layoutIfNeeded()
            }
            run.start(in:controller.view)
        }
    }
}
UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
'''
swift = swift.replace('__PLAYER_LAYOUT__', player_layout).replace('__RECEIVER__', receiver)
swift = swift.replace('__CHUNKS__', chunks).replace('__OUTPUT__', json.dumps(str(args.output.resolve())))
video_element = ('<video id="video" autoplay muted loop playsinline src="data:video/mp4;base64,'
    + base64.b64encode(video).decode() + '"></video>') if args.decoded_video else '<div id="video"></div>'
swift = swift.replace('__VIDEO_ELEMENT__', video_element)
swift = swift.replace('__VIDEO_BACKGROUND__', '#000' if args.decoded_video else 'rgb(0,255,0)')
swift = swift.replace('__DECODED_VIDEO__', 'true' if args.decoded_video else 'false')
swift = swift.replace('__SNAPSHOT_PROBE__', 'true' if args.snapshot_probe else 'false')
swift = swift.replace('__LIVE_SAFE_AREA__', 'true' if args.live_safe_area else 'false')
swift = swift.replace('__STAGE_OWNED_INSETS__', 'true' if args.stage_owned_insets else 'false')
swift = swift.replace('__VIEWPORT_SCRIPT__', json.dumps(viewport_script))
swift = swift.replace('__HOLD_SECONDS__', str(max(0, min(60, args.hold_seconds))))
if args.live_safe_area:
    swift = swift.replace('initial-scale=1', 'initial-scale=1,viewport-fit=cover')
    swift = swift.replace('height:107px;', 'height:calc(48px + env(safe-area-inset-top,0px));')
    if args.stage_owned_insets:
        swift = swift.replace('height:calc(48px + env(safe-area-inset-top,0px));', 'height:calc(48px + var(--lf-safe-top));')
    swift = swift.replace('<div id="header"></div>', '<div id="env-probe" style="position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top,0px)"></div><div id="header"></div>')
build = Path(tempfile.mkdtemp(prefix='langform-native-mini-'))
bundle = build / 'LangformMiniNative.app'
executable = bundle / 'Contents/MacOS/LangformMiniNative'
executable.parent.mkdir(parents=True)
main = build / 'main.swift'
main.write_text(policy + '\n' + swift)
sdk = subprocess.check_output(['xcrun', '--sdk', 'macosx', '--show-sdk-path'], text=True).strip()
support = Path(sdk) / 'System/iOSSupport'
subprocess.run(['xcrun', 'swiftc', '-target', platform.machine() + '-apple-ios17.0-macabi',
    '-sdk', sdk, '-F', str(support / 'System/Library/Frameworks'),
    '-I', str(support / 'usr/include'), '-L', str(support / 'usr/lib'), str(main), '-o', str(executable)], check=True)
info = {'CFBundleIdentifier':'dev.langform.mini-native', 'CFBundleName':'LangformMiniNative',
        'CFBundleExecutable':'LangformMiniNative', 'CFBundlePackageType':'APPL', 'LSUIElement':True,
        'UIApplicationSceneManifest':{'UIApplicationSupportsMultipleScenes':False,
        'UISceneConfigurations':{'UIWindowSceneSessionRoleApplication':[{'UISceneConfigurationName':'Default'}]}}}
with (bundle / 'Contents/Info.plist').open('wb') as file:
    plistlib.dump(info, file)
subprocess.run(['codesign', '--force', '--sign', '-', str(bundle)], check=True)
print(json.dumps({'appBundle':str(bundle), 'executable':str(executable)}), flush=True)
result = subprocess.run([str(executable)], text=True, capture_output=True, timeout=max(15,args.hold_seconds+10))
(args.output / 'native.jsonl').write_text(result.stdout)
(args.output / 'stderr.log').write_text(result.stderr)
(args.output / 'source-fingerprints.json').write_text(json.dumps({
    'source':str(source), 'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),
    'extractedChunksSha256':hashlib.sha256((chunks + player_layout + receiver).encode()).hexdigest(),
    'viewportPolicySha256':hashlib.sha256(policy.encode()).hexdigest(),
    'videoFixtureSha256':hashlib.sha256(video).hexdigest()}, indent=2) + '\n')
print(result.stdout, end='')
if result.returncode:
    print(result.stderr)
    raise SystemExit(result.returncode)
