const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function declaration(source, name) {
  const start = source.indexOf("func " + name + "(");
  assert.ok(start >= 0, name);
  const open = source.indexOf("{", start);
  let depth = 1, end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
    end++;
  }
  return source.slice(start, end);
}

test("WebKit-Medienmeldungen aktualisieren Pause/Play und schützen fremde, leere und veraltete Berichte", {
  skip: process.platform !== "darwin", timeout: 70000,
}, function (t) {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Der Medienbericht-Test benötigt die Swift-Toolchain.");
  const app = path.join(__dirname, "../ios/Langform/Langform");
  const source = fs.readFileSync(path.join(app, "YouTubeWebView.swift"), "utf8");
  const status = fs.readFileSync(path.join(app, "PlayerStartupStatus.swift"), "utf8");
  // Execute the shipping report callback and startup state. UIKit/WebKit are
  // inert stubs; a received report may describe playback, never command it.
  const exercise = `
import CoreGraphics
enum YouTubeWebView {
    static func videoID(_ url: URL?) -> String? {
        guard let url else { return nil }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "v" }?.value
    }
}
enum PlayerViewportPolicy {
    static func matches(reported: CGSize, current: CGSize) -> Bool { reported == current }
}
struct Diagnostics {
    enum Event { case firstMedia, painted, mediaReady, mediaPresented, playing, unstarted, buffering, paused, rejected }
    enum Finish { case superseded }
    func mark(_ event: Event, ticket: Int) {}
    func finish(_ finish: Finish) {}
}
class WebView {
    var url: URL? = URL(string: "https://m.youtube.com/watch?v=abcdefghijk")
    var bounds = CGRect(x: 0, y: 0, width: 400, height: 800)
    var playbackCommands: [String] = []
    func evaluateJavaScript(_ script: String) { playbackCommands.append(script) }
}
class OpeningMotion { func complete() {} }
class ReportStage {
    func recordBackgroundPlaybackTransition(_ phase: String) {}
    struct BackgroundPolicy { let preservesVisibility = false }
    var backgroundCategoryHandoff: BackgroundPolicy?
    func watchBackgroundCategoryTransition(_ phase: String) {}
  func cancelPendingMinimize() {}
    func finishFeedOpeningIfReady() {}
    let openingMotion = OpeningMotion()
    enum Mode { case closed, loading, expanded, mini }
    var mode = Mode.expanded
    var player: WebView! = WebView()
    var loadingViaSPA = false, loadCommitted = true, loadMediaReady = false, loadHasVideo = false, loadPainted = false
    var playerFullscreen = false, videoPlaying = false, cardMoving = false, awaitingViewportGeometry = false
    var customFullscreenID: String?, customFullscreenEnter: Int?, customFullscreenExit: Int?
    var loadingVideoID: String? = "abcdefghijk"
    var loadTicket = 1, videoLoadDiagnostics = Diagnostics(), startupStatus = PlayerStartupStatus()
    var viewportGeneration = 0
    var videoSeekGeometry: (rect: CGRect, seek: CGRect, videoID: String, ticket: Int, viewport: Int)?
    var initialPlaybackIntent: PlayerInitialPlayback?
    var initialPlaybackCheckTicket: Int?
    var watchAudioIntent: (ticket: Int, videoID: String)?
    func clearWatchAudioIntent() { watchAudioIntent = nil }
    var startupVideoID: String? = "abcdefghijk", missingMediaTimeout: DispatchWorkItem?
    var spaStartTimeout: DispatchWorkItem?, pendingTimestampURL: URL?, pendingRect: CGRect?
    var videoRect = CGRect(x: 0, y: 40, width: 400, height: 225)
    var chromeUpdates = 0, preparedResumes = 0, revealChecks = 0
    func resumePreparedPlayer() { preparedResumes += 1 }
    func updateChrome() { chromeUpdates += 1 }
    func updatePlaybackControls() {}
    func flushPendingRect() { if let pendingRect { videoRect = pendingRect }; pendingRect = nil }
    func seekTappedLink(_ url: URL) { player.playbackCommands.append("seek") }
    func considerReveal() { revealChecks += 1 }
    func advanceVideoProbe(_ dict: [String: Any], id: String) {}
    func startInitialPlaybackIfEligible(id: String) {}
    func startWatchAudioIfEligible(id: String) {}
    func finishPhysicalRotationIntent() {}
    ${declaration(source, "rememberVideoSeekGeometry")}
    ${declaration(source, "takeVideoReport")}
    ${declaration(source, "resetPlayerStartupForVideo")}
}
func expect(_ condition: Bool, _ message: String) {
    if !condition { print("FAILED: " + message); exit(1) }
}
func packet(_ state: String, playing: Bool, hasVideo: Bool = true) -> [String: Any] {
    ["kind": "playback", "href": "https://m.youtube.com/watch?v=abcdefghijk",
     "playerVideoID": "abcdefghijk", "hasVideo": hasVideo,
     "playing": playing, "playbackState": state]
}
let stage = ReportStage()
let picture = stage.videoRect
stage.takeVideoReport(packet("playing", playing: true))
expect(stage.videoPlaying && stage.startupStatus.state == .playing && stage.chromeUpdates == 1,
       "actual playing media updates the native playing indicator")
stage.takeVideoReport(packet("paused", playing: false))
expect(!stage.videoPlaying && stage.startupStatus.state == .paused && stage.chromeUpdates == 2,
       "actual pause updates the native indicator")
stage.takeVideoReport(packet("playing", playing: true))
expect(stage.videoPlaying && stage.startupStatus.state == .playing,
       "resumed media restores the playing indicator without an extra command")
stage.takeVideoReport(packet("buffering", playing: true))
expect(stage.videoPlaying && stage.startupStatus.showsSpinner,
       "buffering shows progress while preserving the media's actual play intent")
expect(stage.videoRect == picture && stage.pendingRect == nil && stage.revealChecks == 0,
       "lightweight state packets cannot change the crop or reveal readiness")
stage.takeVideoReport(packet("unavailable", playing: false, hasVideo: false))
expect(stage.videoPlaying, "a replaced or temporarily absent node does not prove a pause")
stage.takeVideoReport(packet("playing", playing: true))

var stale = packet("paused", playing: false)
stale["href"] = "https://m.youtube.com/watch?v=lmnopqrstuv"
let updates = stage.chromeUpdates
stage.takeVideoReport(stale)
stage.takeVideoReport(nil)
stage.takeVideoReport("invalid")
expect(stage.videoPlaying && stage.chromeUpdates == updates && stage.startupStatus.state == .playing,
       "another video's late report and malformed packets cannot replace current playback")
stage.mode = .closed
stage.takeVideoReport(packet("paused", playing: false))
expect(stage.chromeUpdates == updates && stage.videoPlaying, "closed player ignores late reports")
stage.mode = .mini
stage.takeVideoReport(packet("paused", playing: false))
expect(!stage.videoPlaying && stage.startupStatus.state == .paused,
       "mini card receives the same actual pause state")
expect(stage.player.playbackCommands.isEmpty, "pause, play and buffering observations never issue playback commands")

let loading = ReportStage()
loading.mode = .loading
loading.loadCommitted = false
loading.takeVideoReport(packet("playing", playing: true))
expect(loading.chromeUpdates == 0 && loading.preparedResumes == 0, "uncommitted full load rejects old reports")
loading.loadCommitted = true
var oldSPA = packet("playing", playing: true)
oldSPA["navigationToken"] = "old-spa"
loading.takeVideoReport(oldSPA)
expect(loading.chromeUpdates == 0, "stale SPA reports cannot complete a fresh full load")
loading.takeVideoReport(packet("playing", playing: true))
expect(loading.videoPlaying && loading.preparedResumes == 1 && !loading.loadMediaReady && loading.revealChecks == 0,
       "identified lightweight status resumes the prepared view without inventing first-frame readiness")
var full = packet("playing", playing: true)
full.removeValue(forKey: "kind")
full["x"] = 0; full["y"] = 20; full["width"] = 400; full["height"] = 225
full["viewportWidth"] = 400; full["viewportHeight"] = 800
full["mediaReady"] = true; full["painted"] = true
loading.takeVideoReport(full)
expect(loading.loadMediaReady && loading.loadHasVideo && loading.loadPainted && loading.revealChecks == 1,
       "identified full media report still supplies real reveal readiness")
expect(loading.videoRect == CGRect(x: 0, y: 20, width: 400, height: 225), "full report applies matching viewport geometry")
expect(loading.player.playbackCommands.isEmpty, "ready media is reported without replaying it")
print("WEBKIT_MEDIA_REPORT_OK")
`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-media-report-"));
  try {
    const script = path.join(directory, "MediaReport.swift");
    fs.writeFileSync(script, status + "\n" + exercise);
    const result = spawnSync(compiler.stdout.trim(), [script], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /WEBKIT_MEDIA_REPORT_OK/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
