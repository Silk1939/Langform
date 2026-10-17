#!/usr/bin/env python3
"""Measure shipping mini frames and real UIKit button hit regions, without a simulator.

The video is a colored UIView. This proves native geometry/hit testing, not
decoded media, finger input or iPhone frame rate. JSONL includes source hashes.
"""
import argparse
import hashlib
import json
import platform
import plistlib
import subprocess
import tempfile
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
root = Path(__file__).resolve().parents[2]
app = root / 'ios/Langform/Langform'
native = (app / 'YouTubeWebView.swift').read_text()

def declaration(signature):
    start = native.index(signature)
    end = native.index('{', start) + 1
    depth = 1
    while depth and end < len(native):
        depth += (native[end] == '{') - (native[end] == '}')
        end += 1
    if depth:
        raise ValueError(signature)
    return native[start:end].replace('private func', 'func').replace('private var', 'var')

methods = '\n'.join(declaration(s) for s in ['private var hasVideoRect:', 'private var pictureRect:',
    'private func miniFrame()', 'private func apply(_ t:'])
collapse_frame = next(line.strip() for line in native.splitlines() if 'collapseButton.frame = CGRect(' in line)
policy = '\n'.join((app / name).read_text() for name in ['PlayerViewportPolicy.swift', 'PlayerGesturePolicy.swift'])
hashes = {str((app / name).relative_to(root)): hashlib.sha256((app / name).read_bytes()).hexdigest()
          for name in ['YouTubeWebView.swift', 'PlayerViewportPolicy.swift', 'PlayerGesturePolicy.swift']}
hashes['extractedMethods'] = hashlib.sha256(methods.encode()).hexdigest()

swift = r'''
import UIKit
import QuartzCore
final class Stage: UIView {
    enum Mode { case closed, loading, mini, expanded }
    static let bottomBarHeight: CGFloat = 49
    let card = UIView(), closeButton = UIButton(), miniPlaybackButton = UIButton(), collapseButton = UIButton()
    var player: UIView! = UIView()
    var mode = Mode.mini, progress: CGFloat = 1, videoCropActive = true
    var videoRect = CGRect.zero
    var cropCorrection: PlayerViewportPolicy.SurfaceCorrection?
    var feedOpening: Any?
    override var safeAreaInsets: UIEdgeInsets { UIEdgeInsets(top: 59, left: 0, bottom: 34, right: 0) }
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .darkGray
        card.backgroundColor = .black; card.clipsToBounds = true
        addSubview(card); player.frame = bounds; player.backgroundColor = .systemOrange
        card.addSubview(player); card.addSubview(miniPlaybackButton); card.addSubview(closeButton)
        closeButton.backgroundColor = .red; miniPlaybackButton.backgroundColor = .blue
    }
    required init?(coder: NSCoder) { fatalError() }
    func applyFullscreenSurface(_ t: CGFloat) -> Bool { false }
    func updatePlaybackControls() {}
    func layoutCollapse() { __COLLAPSE_FRAME__ }
    __METHODS__
}
func rect(_ r: CGRect) -> [Double] { [Double(r.minX), Double(r.minY), Double(r.width), Double(r.height)] }
func emit(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!); fflush(stdout)
}
final class Delegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting scene: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Mini Controls Probe", sessionRole: scene.role)
        config.delegateClass = SceneDelegate.self; return config
    }
}
final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene), controller = UIViewController()
        window.rootViewController = controller; self.window = window; window.makeKeyAndVisible()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.run() }
    }
    func run() {
        emit(["engine": "Mac Catalyst UIKit/CoreAnimation", "sourceHashes": __HASHES__])
        var checks = [String: Bool](), samples = [[String: Any]]()
        let cases: [(String, CGFloat)] = [("16-9", 16/9), ("4-3", 4/3), ("square", 1),
            ("9-16", 9/16), ("9-32", 9/32), ("4-1", 4), ("8-1", 8)]
        for (name, ratio) in cases {
            let stage = Stage(frame: CGRect(x: 0, y: 0, width: 393, height: 852))
            window!.rootViewController!.view.addSubview(stage)
            stage.layoutCollapse()
            let width = min(393, 600 * ratio), height = width / ratio
            stage.videoRect = CGRect(x: (393 - width)/2, y: 110, width: width, height: height)
            UIView.performWithoutAnimation { stage.apply(1) }; CATransaction.flush()
            let box = stage.card.bounds, close = stage.closeButton.frame, play = stage.miniPlaybackButton.frame
            let picture = stage.player.convert(stage.pictureRect, to: stage.card)
            checks[name + ":closeInsideCard"] = box.contains(close)
            checks[name + ":playInsideCard"] = box.contains(play)
            checks[name + ":controlsDoNotIntersect"] = !close.intersects(play)
            checks[name + ":close44pt"] = close.width >= 44 && close.height >= 44
            checks[name + ":play44pt"] = play.width >= 44 && play.height >= 44
            checks[name + ":cardInsideSafeViewport"] = CGRect(x: 0, y: 59, width: 393, height: 852-59-34-49).contains(stage.card.frame)
            checks[name + ":sourceRatioPreserved"] = abs(picture.width / picture.height - ratio) < 0.00001
            checks[name + ":onlyPictureVisible"] = abs(picture.minX) < 0.001 && abs(picture.minY) < 0.001 && abs(picture.width-box.width) < 0.001 && abs(picture.height-box.height) < 0.001
            checks[name + ":closeCenterHit"] = stage.card.hitTest(CGPoint(x: close.midX, y: close.midY), with: nil) === stage.closeButton
            checks[name + ":playCenterHit"] = stage.card.hitTest(CGPoint(x: play.midX, y: play.midY), with: nil) === stage.miniPlaybackButton
            // Every interior point in each nominal44pt target must hit that
            // control, not its sibling or the card's clipping boundary.
            for (label, button) in [("close", stage.closeButton), ("play", stage.miniPlaybackButton)] {
                var hits = true
                for x in stride(from: CGFloat(0.5), to: button.bounds.width, by: 1) {
                    for y in stride(from: CGFloat(0.5), to: button.bounds.height, by: 1) {
                        let point = button.convert(CGPoint(x: x, y: y), to: stage.card)
                        if stage.card.hitTest(point, with: nil) !== button { hits = false }
                    }
                }
                checks[name + ":" + label + "EntireTargetHit"] = hits
            }
            samples.append(["name": name, "card": rect(stage.card.frame), "close": rect(close), "play": rect(play), "picture": rect(picture)])
            if name == "16-9" {
                let collapse = stage.collapseButton.frame
                checks["header:collapseInside48ptBar"] = CGRect(x: 0, y: 59, width: 393, height: 48).contains(collapse)
                checks["header:collapse44pt"] = collapse.width == 44 && collapse.height == 44
                checks["header:collapseAbovePicture"] = collapse.maxY <= stage.pictureRect.minY
            }
            var continuous = true, contained = true, separate = true
            var previous: CGRect?
            for index in 0...1000 {
                let value = CGFloat(index) / 1000
                stage.progress = value; stage.apply(value)
                let play = stage.miniPlaybackButton.frame, close = stage.closeButton.frame
                //0.001 progress is at most0.6pt of this fixture's travel; a
                // discontinuous row switch would jump tens of points.
                if let previous, abs(play.minY-previous.minY) > 2 { continuous = false }
                contained = contained && stage.card.bounds.contains(play) && stage.card.bounds.contains(close)
                separate = separate && !play.intersects(close)
                previous = play
            }
            checks[name + ":continuousControlTravel"] = continuous
            checks[name + ":targetsContainedDuringDrag"] = contained
            checks[name + ":targetsSeparateDuringDrag"] = separate
            stage.removeFromSuperview()
        }
        let failed = checks.filter { !$0.value }.keys.sorted()
        emit(["finished": true, "passed": failed.isEmpty, "checks": checks, "failed": failed, "samples": samples])
        exit(failed.isEmpty ? 0 : 1)
    }
}
UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(Delegate.self))
'''
a.output.mkdir(parents=True, exist_ok=True)
source = a.output / 'MiniControlsProbe.swift'
source.write_text(policy + '\n' + swift.replace('__METHODS__', methods).replace('__COLLAPSE_FRAME__', collapse_frame).replace('__HASHES__', json.dumps(hashes).replace('{', '[').replace('}', ']')))
# UIKitMacHelper scene creation proved unreliable when launching the bundle at
# long nested QA paths. Keep the temporary executable in a short unique path;
# the exact generated source and all observations remain in the requested output.
build_directory = tempfile.TemporaryDirectory(prefix='lf-mini-')
bundle = Path(build_directory.name) / 'MiniControlsProbe.app/Contents'
(bundle / 'MacOS').mkdir(parents=True, exist_ok=True)
(bundle / 'Info.plist').write_bytes(plistlib.dumps({
    'CFBundleExecutable': 'MiniControlsProbe', 'CFBundleIdentifier': 'de.ipekkaya.langform.mini-controls-probe.' + hashlib.sha256(build_directory.name.encode()).hexdigest()[:12],
    'CFBundleName': 'Langform Mini Controls Probe', 'CFBundlePackageType': 'APPL',
    'CFBundleVersion': '1', 'CFBundleShortVersionString': '1', 'LSMinimumSystemVersion': '14.0',
    'UIDeviceFamily': [2], 'UIApplicationSupportsIndirectInputEvents': True, 'NSPrincipalClass': 'UIApplication',
    'UIApplicationSceneManifest': {'UIApplicationSupportsMultipleScenes': False,
        'UISceneConfigurations': {'UIWindowSceneSessionRoleApplication': [{
            'UISceneConfigurationName': 'Mini Controls Probe', 'UISceneDelegateClassName': 'MiniControlsProbe.SceneDelegate'}]}}
}))
sdk = subprocess.check_output(['xcrun', '--sdk', 'macosx', '--show-sdk-path'], text=True).strip()
binary = bundle / 'MacOS/MiniControlsProbe'
command = ['xcrun', 'swiftc', '-target', platform.machine() + '-apple-ios17.0-macabi', '-sdk', sdk,
           '-F', sdk + '/System/iOSSupport/System/Library/Frameworks', '-I', sdk + '/System/iOSSupport/usr/lib/swift',
           str(source), '-o', str(binary)]
compiled = subprocess.run(command, text=True, capture_output=True, timeout=60)
(a.output / 'compile.log').write_text(compiled.stdout + compiled.stderr)
if compiled.returncode:
    print(compiled.stdout + compiled.stderr)
    raise SystemExit(compiled.returncode)
run = subprocess.run([str(binary.resolve())], text=True, capture_output=True, timeout=20)
(a.output / 'native.jsonl').write_text(run.stdout)
(a.output / 'runtime.stderr').write_text(run.stderr)
print(run.stdout)
raise SystemExit(run.returncode)
