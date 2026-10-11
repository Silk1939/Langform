#!/usr/bin/env python3
"""Generate a scene-based Catalyst probe from current shipping crop methods.

This is an offline UIKit/CoreAnimation geometry probe. It runs no WebKit page,
does not load YouTube, and neither signs nor installs the iPhone app.
"""
import argparse
import hashlib
import json
import plistlib
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--native-source', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
app = root / 'ios/Langform/Langform'
native_path = args.native_source or app / 'YouTubeWebView.swift'
native = native_path.read_text()

def declaration(signature):
    start = native.index(signature)
    end = native.index('{', start) + 1
    depth = 1
    while depth and end < len(native):
        if native[end] == '{':
            depth += 1
        elif native[end] == '}':
            depth -= 1
        end += 1
    if depth:
        raise ValueError(f'incomplete declaration: {signature}')
    return native[start:end].replace('private func', 'func').replace('private var', 'var')

methods = '\n'.join(declaration(signature) for signature in [
    'private var hasVideoRect:', 'private var pictureRect:',
    'private func miniFrame()', 'private func apply(_ t:',
    'private func freezeSettle()', 'private var cardMoving:',
    'private func flushPendingRect()', 'private func follow(_ pan:',
    'private func settle(_ target:',
])
policy = (app / 'PlayerViewportPolicy.swift').read_text()
gesture = (app / 'PlayerGesturePolicy.swift').read_text()
hashes = {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
          for path in [app / 'PlayerViewportPolicy.swift', app / 'PlayerGesturePolicy.swift']}
hashes['nativeSource'] = hashlib.sha256(native.encode()).hexdigest()
hashes['extractedMethods'] = hashlib.sha256(methods.encode()).hexdigest()

prefix = r'''
import UIKit

// The native surface geometry is real UIKit. The substituted medium is one
// colored UIView; only network/playback/chrome callbacks below are no-ops.
final class Stage: UIView {
    enum Mode { case closed, loading, mini, expanded }
    static let bottomBarHeight: CGFloat = 49
    let card = UIView(), closeButton = UIButton(), miniPlaybackButton = UIButton(), collapseButton = UIButton()
    var player: UIView! = UIView()
    var mode = Mode.mini, progress: CGFloat = 1, videoCropActive = true
    var videoRect = CGRect.zero, pendingRect: CGRect?, awaitingViewportGeometry = false
    var settlingBetweenModes = false, dragging = false
    var settler: UIViewPropertyAnimator?, revealer: UIViewPropertyAnimator?, dismisser: UIViewPropertyAnimator?
    var feedOpening: Any?
    var customFullscreenID: String?, startupVideoID: String?
    var cropCorrection: PlayerViewportPolicy.SurfaceCorrection?
    var dragOrigin: CGFloat = 1, dragRevealOrigin: CGFloat = 0, dragTravel: CGFloat = 600
    let cardTap = UITapGestureRecognizer()
    var ownsWatchPlayer: Bool { true }
    override var safeAreaInsets: UIEdgeInsets { .zero }
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .darkGray
        card.backgroundColor = .blue
        card.clipsToBounds = true
        addSubview(card)
        player!.frame = bounds
        player!.backgroundColor = .orange
        card.addSubview(player!)
    }
    required init?(coder: NSCoder) { fatalError("unavailable") }
    func applyFullscreenSurface(_ t: CGFloat) -> Bool { false }
    func updatePlaybackControls() {}
    func updateChrome() {}
    func showStartupPoster() {}
    func freezeReveal() {}
    func beginVideoCrop() {}
    func restoreExpandedSurface() {}
    func startInitialPlaybackIfEligible(id: String) {}
'''
suffix = r'''
final class ProbePan: UIPanGestureRecognizer {
    var y: CGFloat = 0
    override func translation(in view: UIView?) -> CGPoint { CGPoint(x: 0, y: y) }
}
func rect(_ value: CGRect) -> [Double] {
    [Double(value.minX), Double(value.minY), Double(value.width), Double(value.height)]
}
func pose(_ stage: Stage, presentation: Bool) -> [String: Any] {
    let card = presentation ? stage.card.layer.presentation() ?? stage.card.layer : stage.card.layer
    let player = presentation ? stage.player!.layer.presentation() ?? stage.player!.layer : stage.player!.layer
    let parent = presentation ? stage.layer.presentation() ?? stage.layer : stage.layer
    let t = player.affineTransform()
    return ["card": rect(card.frame), "playerPosition": [Double(player.position.x), Double(player.position.y)],
            "playerScale": [Double(t.a), Double(t.d)],
            "picturePlane": rect(player.convert(stage.pictureRect, to: parent)),
            "presentationAvailable": stage.card.layer.presentation() != nil,
            "runningAnimations": stage.card.layer.animationKeys() ?? []]
}
func maximumDifference(_ lhs: [String: Any], _ rhs: [String: Any], key: String) -> Double {
    guard let a = lhs[key] as? [Double], let b = rhs[key] as? [Double], a.count == b.count else { return .infinity }
    return zip(a, b).map { abs($0 - $1) }.max() ?? 0
}
func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
          let string = String(data: data, encoding: .utf8) else { fatalError("nonserializable result") }
    print(string)
    fflush(stdout)
}

final class Delegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting scene: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Crop Probe", sessionRole: scene.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    var window: UIWindow?
    var stage: Stage?
    var results: [[String: Any]] = []
    let configurations: [(String, CGRect, CGRect, Double)] = [
        ("landscape-to-square-80ms", CGRect(x: 0, y: 48, width: 402, height: 226.125), CGRect(x: 0, y: 48, width: 402, height: 402), 0.08),
        ("landscape-to-portrait-60ms", CGRect(x: 0, y: 48, width: 402, height: 226.125), CGRect(x: 84, y: 48, width: 234, height: 416), 0.06),
        ("portrait-to-landscape-100ms", CGRect(x: 84, y: 48, width: 234, height: 416), CGRect(x: 0, y: 48, width: 402, height: 226.125), 0.10),
        ("rect-offset-only-80ms", CGRect(x: 0, y: 48, width: 402, height: 226.125), CGRect(x: 0, y: 112, width: 402, height: 226.125), 0.08),
        ("completed-crop-300ms", CGRect(x: 0, y: 48, width: 402, height: 226.125), CGRect(x: 0, y: 48, width: 402, height: 402), 0.30),
    ]
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        let controller = UIViewController()
        controller.view.backgroundColor = .black
        window.rootViewController = controller
        self.window = window
        window.makeKeyAndVisible()
        emit(["engine": "Mac Catalyst UIKit/CoreAnimation", "hashes": sourceHashes])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.run(0) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { emit(["finished": true, "error": "timeout"]); exit(2) }
    }
    func run(_ index: Int) {
        guard index < configurations.count else {
            var checks: [String: Bool] = ["allFiveScenariosCompleted": results.count == 5]
            for (index, result) in results.enumerated() {
                let name = result["name"] as! String
                checks[name + ":cropRunningAtGrab"] = result["cropWasRunning"] as? Bool == (index < 4)
                checks[name + ":miniCorrectionReleased"] = result["correctionReleased"] as? Bool == true
                checks[name + ":expandedCorrectionReleased"] = result["expandedCorrectionReleased"] as? Bool == true
                for (key, value) in result where key.hasSuffix("DifferencePoints") {
                    checks[name + ":" + key] = (value as? Double).map { $0.isFinite && $0 < 0.1 } ?? false
                }
            }
            let passed = checks.values.allSatisfy { $0 }
            emit(["finished": true, "results": results, "runtimeCompleted": true, "checks": checks, "passed": passed])
            exit(passed ? 0 : 1)
        }
        stage?.removeFromSuperview()
        let stage = Stage(frame: CGRect(x: 30, y: 30, width: 402, height: 874))
        self.stage = stage
        window!.rootViewController!.view.addSubview(stage)
        let (name, oldRect, newRect, delay) = configurations[index]
        stage.videoRect = oldRect
        UIView.performWithoutAnimation { stage.apply(1) }
        CATransaction.flush()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            stage.pendingRect = newRect
            stage.flushPendingRect()
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                let running = stage.settler != nil
                let before = pose(stage, presentation: true)
                stage.freezeSettle()
                CATransaction.flush()
                let immediateModel = pose(stage, presentation: false)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.025) {
                    let after = pose(stage, presentation: true)
                    let pan = ProbePan()
                    stage.dragOrigin = stage.progress
                    stage.follow(pan)
                    let firstFinger = pose(stage, presentation: false)
                    pan.y = -40
                    stage.follow(pan)
                    let movedFinger = pose(stage, presentation: false)
                    pan.y = 0
                    stage.follow(pan)
                    let reversedFinger = pose(stage, presentation: false)
                    var result: [String: Any] = [
                        "name": name, "requestedGrabAfterSeconds": delay, "cropWasRunning": running,
                        "before": before, "immediateModel": immediateModel, "after": after,
                        "cardDifferencePoints": maximumDifference(before, after, key: "card"),
                        "pictureDifferencePoints": maximumDifference(before, after, key: "picturePlane"),
                        "modelCardDifferencePoints": maximumDifference(before, immediateModel, key: "card"),
                        "modelPictureDifferencePoints": maximumDifference(before, immediateModel, key: "picturePlane"),
                        "animationsRemoved": stage.settler == nil,
                        "firstFingerCardDifferencePoints": maximumDifference(before, firstFinger, key: "card"),
                        "firstFingerPictureDifferencePoints": maximumDifference(before, firstFinger, key: "picturePlane"),
                        "reversedFingerCardDifferencePoints": maximumDifference(before, reversedFinger, key: "card"),
                        "reversedFingerPictureDifferencePoints": maximumDifference(before, reversedFinger, key: "picturePlane"),
                        "movedFinger": movedFinger,
                    ]
                    stage.settle(.mini)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.38) {
                        let settled = pose(stage, presentation: true)
                        let natural = PlayerViewportPolicy.surfaceGeometry(viewport: stage.bounds, picture: stage.pictureRect,
                            mini: stage.miniFrame(), progress: 1, videoOnly: true)
                        let targetCard: [String: Any] = ["card": rect(natural.frame)]
                        result["settledCardDifferencePoints"] = maximumDifference(settled, targetCard, key: "card")
                        result["settled"] = settled
                        result["correctionReleased"] = stage.cropCorrection == nil
                        stage.settle(.expanded)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
                            let springBefore = pose(stage, presentation: true)
                            stage.freezeSettle()
                            let springAfter = pose(stage, presentation: false)
                            stage.dragOrigin = stage.progress
                            let nextPan = ProbePan()
                            stage.follow(nextPan)
                            let springFinger = pose(stage, presentation: false)
                            result["modeSpringGrabProgress"] = Double(stage.progress)
                            result["modeSpringCardDifferencePoints"] = maximumDifference(springBefore, springAfter, key: "card")
                            result["modeSpringPictureDifferencePoints"] = maximumDifference(springBefore, springAfter, key: "picturePlane")
                            result["modeSpringFirstFingerCardDifferencePoints"] = maximumDifference(springBefore, springFinger, key: "card")
                            result["modeSpringFirstFingerPictureDifferencePoints"] = maximumDifference(springBefore, springFinger, key: "picturePlane")
                            stage.settle(.expanded)
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.38) {
                                let expanded = pose(stage, presentation: true)
                                let target = PlayerViewportPolicy.surfaceGeometry(viewport: stage.bounds, picture: stage.pictureRect,
                                    mini: stage.miniFrame(), progress: 0, videoOnly: true)
                                result["expandedCardDifferencePoints"] = maximumDifference(expanded, ["card": rect(target.frame)], key: "card")
                                result["expandedCorrectionReleased"] = stage.cropCorrection == nil
                                self.results.append(result)
                                emit(result)
                                self.run(index + 1)
                            }
                        }
                    }
                }
            }
        }
    }
}
UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(Delegate.self))
'''

args.output.mkdir(parents=True, exist_ok=True)
source = args.output / 'CropProbe.swift'
source.write_text(prefix + methods + '\n}\n' + policy + '\n' + gesture +
                  '\nlet sourceHashes: [String: String] = ' +
                  json.dumps(hashes).replace('{', '[').replace('}', ']') + '\n' + suffix)
bundle = args.output / 'CropProbe.app/Contents'
(bundle / 'MacOS').mkdir(parents=True, exist_ok=True)
(bundle / 'Resources').mkdir(exist_ok=True)
(bundle / 'Info.plist').write_bytes(plistlib.dumps({
    'CFBundleExecutable': 'CropProbe', 'CFBundleIdentifier': 'de.ipekkaya.langform.crop-probe',
    'CFBundleName': 'Langform Crop Probe', 'CFBundlePackageType': 'APPL',
    'CFBundleVersion': '1', 'CFBundleShortVersionString': '1', 'LSMinimumSystemVersion': '14.0',
    'UIDeviceFamily': [2], 'UIApplicationSupportsIndirectInputEvents': True, 'NSPrincipalClass': 'UIApplication',
    'UIApplicationSceneManifest': {'UIApplicationSupportsMultipleScenes': False,
        'UISceneConfigurations': {'UIWindowSceneSessionRoleApplication': [
            {'UISceneConfigurationName': 'Crop Probe', 'UISceneDelegateClassName': 'CropProbe.SceneDelegate'}]}}
}))
print(source.resolve())
