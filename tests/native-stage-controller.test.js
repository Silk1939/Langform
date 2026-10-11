const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function declaration(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  const open = source.indexOf('{', start);
  let end = open + 1, depth = 1;
  while (depth && end < source.length) {
    depth += (source[end] === '{') - (source[end] === '}');
    end++;
  }
  return source.slice(start, end);
}

test('Shipping Stage controller and representable lifecycle typecheck against real UIKit/SwiftUI', {
  skip: process.platform !== 'darwin', timeout: 60000,
}, t => {
  const sdk = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' });
  if (sdk.status !== 0) return t.skip('Apple SDK unavailable');
  const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/YouTubeWebView.swift'), 'utf8');
  const controller = declaration(source, 'final class PlayerStageController:');
  const lifecycle = ['func makeUIViewController(', 'func updateUIViewController(', 'static func dismantleUIViewController(']
    .map(signature => declaration(source, signature)).join('\n');
  const rotation = ['func beginNativeRotation(', 'func cancelNativeRotation(']
    .map(signature => declaration(source, signature)).join('\n');
  const swift = `
import SwiftUI
import UIKit
import WebKit
struct DownloadSource {}
struct YouTubeWebView: UIViewControllerRepresentable {
    @Binding var unreachable: Bool
    var reloadToken: Int
    var onFullscreen: ((Bool) -> Void)?
    var onDownloads: ((DownloadSource?, String?, @escaping (Bool) -> Void) -> Void)?
    var downloadRequestToken = 0
    static func videoID(_ url: URL?) -> String? {
        URLComponents(url: url ?? URL(string: "about:blank")!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "v" }?.value
    }
    ${lifecycle}
}
${controller}
final class PlayerStage: UIView {
    var onUnreachable: ((Bool) -> Void)?, onFullscreen: ((Bool) -> Void)?
    var onDownloads: ((DownloadSource?, String?, @escaping (Bool) -> Void) -> Void)?
    var downloadRequestToken = 0
    func requestDownloads() {}
    var reloadToken = 0, loadTicket = 1, nativeRotationGeneration = 0
    enum Mode { case closed, expanded }; var mode = Mode.expanded
    var player: WKWebView? = WKWebView(), card = UIView()
    var fullscreenCardRotationGeneration: Int?, nativeRotationTarget: CGSize?, nativeRotationDeadlineMilliseconds: Double?, nativeRotationCSSCurve: String?, fullscreenExitMotionTimeout: DispatchWorkItem?
    struct Pending { var token: String; var waitingForRotation = false;var sourceViewport:CGSize?;var motionViewport:CGSize?;var motionGeneration:Int?;var cancellingMotion=false;var allowsCurrentOrientation=false;var rotationDeadlineMilliseconds:Double?;var rotationCSSCurve:String? }
    var customFullscreenEnter: Pending?, customFullscreenExit: Pending?
    var activeRotationCoordinator: UIViewControllerTransitionCoordinator?
    func start() {}; func reload() {}; func stop() { cancelNativeRotation() }
    func confirmCustomFullscreenEnter(afterRotation: Bool = false) {}
    func confirmCustomFullscreenExit(afterRotation: Bool = false) {}
    func requestFullscreenExitMotion(viewport:CGSize,deadline:Double) {}
    func cancelFullscreenExitMotion() {}
    ${rotation}
}
`;
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-stage-controller-'));
  try {
    const file = path.join(folder, 'StageController.swift');
    fs.writeFileSync(file, swift);
    const support = path.join(sdk.stdout.trim(), 'System/iOSSupport');
    const result = spawnSync('/usr/bin/xcrun', ['swiftc', '-typecheck', '-target', 'arm64-apple-ios17.0-macabi',
      '-sdk', sdk.stdout.trim(), '-I', path.join(support, 'usr/include'),
      '-F', path.join(support, 'System/Library/Frameworks'), file], { encoding: 'utf8', timeout: 50000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
