const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function declaration(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  let end = source.indexOf('{', start) + 1, depth = 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0, 'complete shipping declaration');
  return source.slice(start, end).replace('private func', 'func').replace('private var', 'var');
}

test('Crop-Feder geht ohne Sprung in ersten Fingerframe und Umkehr über', {
  skip: process.platform !== 'darwin', timeout: 70000,
}, t => {
  const compiler = spawnSync('/usr/bin/xcrun', ['--find', 'swift'], { encoding: 'utf8' });
  if (compiler.status !== 0) return t.skip('Swift-Toolchain nicht verfügbar');
  const app = path.join(__dirname, '../ios/Langform/Langform');
  const native = fs.readFileSync(process.env.LANGFORM_CROP_SOURCE || path.join(app, 'YouTubeWebView.swift'), 'utf8');
  const policy = ['PlayerViewportPolicy.swift', 'PlayerGesturePolicy.swift'].map(name => fs.readFileSync(path.join(app, name), 'utf8')).join('\n');
  const methods = ['private func cancelPendingMinimize()', 'private var hasVideoRect:', 'private var pictureRect:', 'private func miniFrame()',
    'private func apply(_ t:', 'private func freezeSettle()', 'private func follow(_ pan:']
    .map(signature => declaration(native, signature)).join('\n');
  // UIKit timing is tested separately by the permanent Catalyst probe. Here
  // deterministic, deliberately different model/presentation poses exercise
  // the unchanged shipping methods and first pan callback together.
  const exercise = `
class Layer {
    var bounds = CGRect.zero, position = CGPoint.zero, pose = CGAffineTransform.identity
    var cornerRadius: CGFloat = 0, borderWidth: CGFloat = 0
    var shown: Layer?
    func presentation() -> Layer? { shown }
    func affineTransform() -> CGAffineTransform { pose }
}
class UIView {
    let layer = Layer()
    var bounds = CGRect.zero { didSet { layer.bounds = bounds } }
    var center = CGPoint.zero { didSet { layer.position = center } }
    var transform = CGAffineTransform.identity { didSet { layer.pose = transform } }
    var alpha: CGFloat = 1
    var frame: CGRect {
        get { CGRect(x: center.x - bounds.width / 2, y: center.y - bounds.height / 2, width: bounds.width, height: bounds.height) }
        set { bounds = CGRect(origin: .zero, size: newValue.size); center = CGPoint(x: newValue.midX, y: newValue.midY) }
    }
    static func performWithoutAnimation(_ block: () -> Void) { block() }
}
class UIPanGestureRecognizer { var y: CGFloat = 0; func translation(in: UIView) -> CGPoint { CGPoint(x: 0, y: y) } }
class Animator { var stopped = false; func stopAnimation(_ immediately: Bool) { stopped = true } }
struct Insets { var bottom: CGFloat = 0, right: CGFloat = 0 }
class Stage: UIView {
    var minimizeRequestTicket = 0, pendingMinimizeRequest: Int?
    enum Mode { case closed, loading, mini, expanded }
    static let bottomBarHeight: CGFloat = 49
    var mode = Mode.mini, progress: CGFloat = 1, videoCropActive = true
    var videoRect = CGRect(x: 84, y: 48, width: 234, height: 416)
    let card = UIView(), closeButton = UIView(), miniPlaybackButton = UIView(), collapseButton = UIView()
    var player: UIView? = UIView()
    var cropCorrection: PlayerViewportPolicy.SurfaceCorrection?, customFullscreenID: String?, feedOpening: Any?
    var settlingBetweenModes = false, settler: Animator?
    var dragOrigin: CGFloat = 1, dragRevealOrigin: CGFloat = 0, dragTravel: CGFloat = 600
    var safeAreaInsets = Insets()
    func applyFullscreenSurface(_ t: CGFloat) -> Bool { false }
    func updatePlaybackControls() {}
    ${methods}
}
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED " + message); exit(1) } }
func near(_ a: CGFloat, _ b: CGFloat) -> Bool { abs(a - b) < 0.000001 }
func shownGeometry(_ s: Stage) -> PlayerViewportPolicy.SurfaceGeometry {
    let scale = s.player!.transform.a
    return PlayerViewportPolicy.SurfaceGeometry(frame: s.card.frame, scale: scale,
        origin: CGPoint(x: s.player!.center.x - scale * s.bounds.width / 2,
                        y: s.player!.center.y - scale * s.bounds.height / 2))
}
func matches(_ a: PlayerViewportPolicy.SurfaceGeometry, _ b: PlayerViewportPolicy.SurfaceGeometry) -> Bool {
    near(a.frame.minX, b.frame.minX) && near(a.frame.minY, b.frame.minY) && near(a.frame.width, b.frame.width)
    && near(a.frame.height, b.frame.height) && near(a.scale, b.scale) && near(a.origin.x, b.origin.x) && near(a.origin.y, b.origin.y)
}
let stage = Stage()
stage.minimizeRequestTicket = 3; stage.pendingMinimizeRequest = 3
stage.freezeSettle()
expect(stage.pendingMinimizeRequest == nil && stage.minimizeRequestTicket == 4,
       "new native gesture or mode request revokes delayed minimize even without a running spring")
stage.bounds = CGRect(x: 0, y: 0, width: 402, height: 874)
stage.player!.bounds = stage.bounds
stage.apply(1)
let presentedCard = Layer(), presentedPlayer = Layer()
// Measured presentation geometry from the scene-based Catalyst reproduction;
// native model has already reached the new 90 x 160 mini target.
presentedCard.bounds = CGRect(x: 0, y: 0, width: 146, height: 132)
presentedCard.position = CGPoint(x: 319, y: 749)
presentedPlayer.pose = CGAffineTransform(scaleX: 0.432, y: 0.432)
presentedPlayer.position = CGPoint(x: 61.5, y: 127.5)
stage.card.layer.shown = presentedCard; stage.player!.layer.shown = presentedPlayer
stage.settler = Animator()
let expected = PlayerViewportPolicy.SurfaceGeometry(frame: CGRect(x: 246, y: 683, width: 146, height: 132), scale: 0.432,
    origin: CGPoint(x: 61.5 - 0.432 * 201, y: 127.5 - 0.432 * 437))
stage.freezeSettle()
expect(matches(shownGeometry(stage), expected), "crop-only grab preserves card AND decoded-picture transform")
expect(stage.settler == nil && stage.progress == 1, "crop grab keeps selected mini progress without a running animator")
let pan = UIPanGestureRecognizer()
stage.follow(pan)
expect(matches(shownGeometry(stage), expected), "first finger callback cannot reapply the already-new crop target")
pan.y = -40; stage.follow(pan)
expect(stage.progress < 1 && stage.card.bounds.height > expected.frame.height, "upward finger motion leaves the held mini pose continuously")
pan.y = 0; stage.follow(pan)
expect(matches(shownGeometry(stage), expected), "finger reversal returns to the exact held card and picture without hysteresis")
stage.progress = 0; stage.apply(0)
let expanded = PlayerViewportPolicy.surfaceGeometry(viewport: stage.bounds, picture: stage.pictureRect, mini: stage.miniFrame(), progress: 0, videoOnly: true)
expect(matches(shownGeometry(stage), expanded), "correction ends at the ordinary expanded video plane")
stage.mode = .loading; stage.apply(0)
expect(stage.cropCorrection == nil, "a new loading document cannot inherit the previous video's held crop")

// Interrupted mode springs retain a correction only between their endpoints.
for p: CGFloat in [0.0001, 0.2, 0.65, 0.9999] {
    let regular = PlayerViewportPolicy.surfaceGeometry(viewport: stage.bounds, picture: stage.pictureRect, mini: stage.miniFrame(), progress: p, videoOnly: true)
    let actual = PlayerViewportPolicy.SurfaceGeometry(frame: regular.frame.offsetBy(dx: 12, dy: -8), scale: regular.scale + 0.05, origin: CGPoint(x: regular.origin.x - 7, y: regular.origin.y + 9))
    let correction = PlayerViewportPolicy.SurfaceCorrection(shown: actual, regular: regular, progress: p)!
    let restored = PlayerViewportPolicy.surfaceGeometry(viewport: stage.bounds, picture: stage.pictureRect, mini: stage.miniFrame(), progress: p, videoOnly: true, correction: correction)
    expect(matches(restored, actual), "arbitrary spring handoff preserves every rendered component, including near endpoints")
    for endpoint: CGFloat in [0, 1] {
        let natural = PlayerViewportPolicy.surfaceGeometry(viewport: stage.bounds, picture: stage.pictureRect, mini: stage.miniFrame(), progress: endpoint, videoOnly: true)
        let corrected = PlayerViewportPolicy.surfaceGeometry(viewport: stage.bounds, picture: stage.pictureRect, mini: stage.miniFrame(), progress: endpoint, videoOnly: true, correction: correction)
        expect(matches(natural, corrected), "mode-spring correction reaches both normal endpoints")
    }
}
let invalid = PlayerViewportPolicy.SurfaceGeometry(frame: .zero, scale: .nan, origin: .zero)
expect(PlayerViewportPolicy.SurfaceCorrection(shown: invalid, regular: expected, progress: 1) == nil, "invalid presentation cannot introduce nonfinite crop motion")
print("NATIVE_CROP_HANDOFF_OK")
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-native-crop-'));
  try {
    const script = path.join(dir, 'Crop.swift'); fs.writeFileSync(script, policy + '\n' + exercise);
    const result = spawnSync(compiler.stdout.trim(), [script], { encoding: 'utf8', timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_CROP_HANDOFF_OK/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
