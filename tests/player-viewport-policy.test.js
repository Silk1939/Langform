const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Rotation bewahrt den Player-Modus, verwirft alte Viewports und hält den Ersatzrahmen im Bild", {
  skip: process.platform !== "darwin",
  timeout: 70000,
}, function (t) {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Der Rotationstest benötigt die Swift-Toolchain.");
  const app = path.join(__dirname, "../ios/Langform/Langform");
  const source = ["PlayerGesturePolicy.swift", "PlayerViewportPolicy.swift"]
    .map(function (name) { return fs.readFileSync(path.join(app, name), "utf8"); }).join("\n");
  const exercise = `
func expect(_ condition: Bool, _ message: String) {
    if !condition { print("FAILED: " + message); exit(1) }
}
let portrait = CGSize(width: 390, height: 844)
let landscape = CGSize(width: 844, height: 320)
expect(PlayerViewportPolicy.matches(reported: portrait, current: portrait), "current portrait geometry accepted")
expect(PlayerViewportPolicy.matches(reported: landscape, current: landscape), "current landscape geometry accepted")
expect(!PlayerViewportPolicy.matches(reported: portrait, current: landscape), "queued portrait report cannot corrupt landscape crop")
expect(!PlayerViewportPolicy.matches(reported: landscape, current: portrait), "queued landscape report cannot corrupt portrait crop")
expect(!PlayerViewportPolicy.matches(reported: CGSize(width: 844, height: 390), current: landscape), "same width with old height is also stale")
expect(PlayerViewportPolicy.matches(reported: CGSize(width: 843, height: 319), current: landscape), "one-point viewport rounding is safe")
for bad in [CGSize.zero, CGSize(width: -390, height: 844), CGSize(width: CGFloat.nan, height: 844), CGSize(width: 390, height: CGFloat.infinity)] {
    expect(!PlayerViewportPolicy.matches(reported: bad, current: portrait), "invalid or absent viewport must not enter crop geometry")
    expect(PlayerViewportPolicy.fallbackPicture(in: bad) == .zero, "invalid bounds have no fallback picture")
}
for size in [portrait, landscape, CGSize(width: 500, height: 500), CGSize(width: 844, height: 160)] {
    let picture = PlayerViewportPolicy.fallbackPicture(in: size)
    expect(picture.minX >= 0 && picture.minY == 0 && picture.maxX <= size.width + 0.001 && picture.maxY <= size.height + 0.001,
           "fallback is viewport-fit, including a short landscape viewport")
    expect(abs(picture.width / picture.height - 16 / 9) < 0.001, "fallback preserves 16:9 without changing the web video")
}
expect(PlayerViewportPolicy.fallbackPicture(in: portrait).width == portrait.width, "portrait keeps the full-width fallback")
expect(PlayerViewportPolicy.fallbackPicture(in: landscape).height == landscape.height, "landscape constrains fallback height")
expect(!PlayerViewportPolicy.canFinishFullscreenExit(in: landscape, portrait: false, allowsCurrentOrientation: false, rotating: false), "inline CSS cannot return in the old landscape viewport")
expect(!PlayerViewportPolicy.canFinishFullscreenExit(in: portrait, portrait: true, allowsCurrentOrientation: false, rotating: true), "a UIKit transition must finish before the inline handoff")
expect(!PlayerViewportPolicy.canFinishFullscreenExit(in: landscape, portrait: true, allowsCurrentOrientation: false, rotating: false), "reported portrait does not accept mismatched landscape bounds")
expect(PlayerViewportPolicy.canFinishFullscreenExit(in: portrait, portrait: true, allowsCurrentOrientation: false, rotating: false), "settled portrait bounds can confirm the native destination")
expect(PlayerViewportPolicy.canFinishFullscreenExit(in: landscape, portrait: false, allowsCurrentOrientation: true, rotating: false), "a rejected platform rotation explicitly confirms its current viewport")
expect(!PlayerViewportPolicy.canFinishFullscreenExit(in: .zero, portrait: true, allowsCurrentOrientation: true, rotating: false), "rotation rejection never makes absent geometry valid")

// The native mode records the selected resting destination independently from
// the in-flight gesture/animation progress. Rotation must restore that endpoint.
for previousProgress: CGFloat in [0, 0.2, 0.7, 1] {
    var progress = previousProgress
    progress = PlayerViewportPolicy.restingProgress(position: .expanded)
    expect(progress == 0, "expanded/partly-minimized drag returns expanded on rotation")
    progress = previousProgress
    progress = PlayerViewportPolicy.restingProgress(position: .mini)
    expect(progress == 1, "mini/partly-expanded drag returns mini on rotation")
}
expect(PlayerViewportPolicy.restingProgress(position: nil) == 0, "closed/loading never gains a mini transition from rotation")
// Invert the actual presentation geometry: every visible point of the moving
// card must map to the video, including the intermediate drag/spring poses.
let stage = CGRect(x: 0, y: 0, width: 402, height: 874)
let pictures = [CGRect(x: 0, y: 107, width: 402, height: 226.125),
                CGRect(x: 81, y: 107, width: 240, height: 426.6666667),
                CGRect(x: 0, y: -35, width: 402, height: 226.125)]
for picture in pictures {
    let mini = CGRect(x: 200, y: 660, width: 180, height: 180 * picture.height / picture.width)
    for progress: CGFloat in [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1] {
        let geometry = PlayerViewportPolicy.surfaceGeometry(viewport: stage, picture: picture,
            mini: mini, progress: progress, videoOnly: true)
        let visible = CGRect(x: -geometry.origin.x / geometry.scale,
            y: -geometry.origin.y / geometry.scale,
            width: geometry.frame.width / geometry.scale,
            height: geometry.frame.height / geometry.scale)
        expect(abs(visible.minX - picture.minX) < 0.001 && abs(visible.minY - picture.minY) < 0.001
            && abs(visible.width - picture.width) < 0.001 && abs(visible.height - picture.height) < 0.001,
            "intermediate mini crop contains exactly the video, never header, title or comments")
        expect(abs(geometry.frame.width / geometry.frame.height - picture.width / picture.height) < 0.001,
            "mini transition preserves the picture aspect instead of shrinking the page")
    }
    let expanded = PlayerViewportPolicy.surfaceGeometry(viewport: stage, picture: picture,
        mini: mini, progress: 0, videoOnly: false)
    let cropped = PlayerViewportPolicy.surfaceGeometry(viewport: stage, picture: picture,
        mini: mini, progress: 0, videoOnly: true)
    let fullPictureOrigin = CGPoint(x: expanded.frame.minX + expanded.origin.x + expanded.scale * picture.minX,
        y: expanded.frame.minY + expanded.origin.y + expanded.scale * picture.minY)
    let cropPictureOrigin = CGPoint(x: cropped.frame.minX + cropped.origin.x + cropped.scale * picture.minX,
        y: cropped.frame.minY + cropped.origin.y + cropped.scale * picture.minY)
    expect(fullPictureOrigin == cropPictureOrigin && expanded.scale == cropped.scale,
        "taking the video-only crop or restoring the page never changes the actual picture position")
}
let oldPageMotion = PlayerViewportPolicy.surfaceGeometry(viewport: stage, picture: pictures[0],
    mini: CGRect(x: 200, y: 660, width: 180, height: 101.25), progress: 0.5, videoOnly: false)
expect(oldPageMotion.frame.height / oldPageMotion.scale > pictures[0].height + 100,
    "the previous whole-page interpolation demonstrably exposes non-video content midway")
print("PLAYER_VIEWPORT_POLICY_OK")
`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-viewport-test-"));
  try {
    const script = path.join(directory, "ViewportPolicy.swift");
    fs.writeFileSync(script, source + "\n" + exercise);
    const result = spawnSync(compiler.stdout.trim(), [script], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PLAYER_VIEWPORT_POLICY_OK/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
