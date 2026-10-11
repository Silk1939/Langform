const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function declaration(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  const open = source.indexOf("{", start);
  let depth = 1, end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
    end++;
  }
  assert.equal(depth, 0, signature);
  return source.slice(start, end).replace("private func", "func");
}

test("nativer Startstatus und fehlende Medien gehören zum aktuellen Video, unabhängig von der KVO-Reihenfolge", {
  skip: process.platform !== "darwin", timeout: 70000,
}, t => {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  const directory = path.join(__dirname, "../ios/Langform/Langform");
  const source = fs.readFileSync(process.env.LANGFORM_STARTUP_SOURCE || path.join(directory, "YouTubeWebView.swift"), "utf8");
  const startup = fs.readFileSync(path.join(directory, "PlayerStartupStatus.swift"), "utf8");
  // Use the complete shipping handlers. Only UIKit, geometry and unrelated
  // diagnostics are stand-ins; controllable scheduling avoids a ten-second wait.
  const exercise = startup + `
import CoreGraphics
final class UIApplication {
  enum State { case active, background }
  static let shared = UIApplication()
  var applicationState = State.active
}
final class Queue {
  var items: [DispatchWorkItem] = []
  func asyncAfter(deadline: DispatchTime, execute: DispatchWorkItem) { items.append(execute) }
}
enum DispatchQueue { static let main = Queue() }
enum YouTubeWebView {
  ${declaration(source, "static func isYouTube(")}
  ${declaration(source, "static func isWatchPage(")}
  ${declaration(source, "static func videoID(")}
}
enum PlayerViewportPolicy { static func matches(reported: CGSize, current: CGSize) -> Bool { false } }
final class Web { var url: URL? = watch(a), bounds = CGRect.zero }
final class Diagnostics {
  enum Outcome { case superseded }
  enum Milestone { case firstMedia, painted, mediaReady, mediaPresented, playing, unstarted, buffering, paused, rejected }
  func finish(_ outcome: Outcome) {}
  var presented = 0
  func mark(_ milestone: Milestone, ticket: Int) { if milestone == .mediaPresented { presented += 1 } }
}
final class OpeningMotion {
  var completions = 0
  func complete() { completions += 1 }
}
final class Stage {
  func cancelPendingMinimize() {}
    func finishFeedOpeningIfReady() {}
  enum Mode { case closed, loading, expanded, mini }
  var mode = Mode.expanded, startupStatus = PlayerStartupStatus()
  var initialPlaybackIntent: PlayerInitialPlayback?
  var initialPlaybackCheckTicket: Int?
  var startupVideoID: String? = a, missingMediaTimeout: DispatchWorkItem?
  var player: Web! = Web(), loadTicket = 1, loadingVideoID: String? = a, lastWatchURL: URL?
  var viewportGeneration = 0
  var videoSeekGeometry: (rect: CGRect, videoID: String, ticket: Int, viewport: Int)?
  var videoPlaying = false, playerFullscreen = false, loadingViaSPA = false, loadCommitted = true
  var customFullscreenID: String?, customFullscreenEnter: Int?, customFullscreenExit: Int?
  var spaStartTimeout: DispatchWorkItem?, videoLoadDiagnostics = Diagnostics()
  var openingMotion = OpeningMotion()
  var loadMediaReady = false, loadHasVideo = false, loadPainted = false
  var cardMoving = false, awaitingViewportGeometry = false, videoRect = CGRect.zero, pendingRect: CGRect?
  var pendingTimestampURL: URL?, updates = 0, resumes = 0
  var retired = 0
  func updatePlaybackControls() { updates += 1 }
  func updateChrome() { updateMissingMediaTimeout(); updatePlaybackControls() }
  func resetPlayerOverlayForVideo(_ id: String?) {}
  func showInFeed(_ url: URL) {}
  func closePlayer() {}
  func retirePlayerPage(to url: URL) { retired += 1; showInFeed(url); closePlayer() }
  func resumePreparedPlayer() { resumes += 1 }
  func flushPendingRect() {}
  func seekTappedLink(_ url: URL) {}
  func considerReveal() {}
  func advanceVideoProbe(_ dict: [String: Any], id: String) {}
  func startInitialPlaybackIfEligible(id: String) {}
  ${declaration(source, "private func playerMoved(")}
  ${declaration(source, "private func updateMissingMediaTimeout(")}
  ${declaration(source, "private func rememberVideoSeekGeometry(")}
  ${declaration(source, "private func takeVideoReport(")}
  ${source.includes("private func resetPlayerStartupForVideo(") ? declaration(source, "private func resetPlayerStartupForVideo(") : ""}
  func report(_ id: String, state: String, hasVideo: Bool, extra: [String: Any] = [:]) {
    var body: [String: Any] = ["href": watch(id).absoluteString, "kind": "playback",
                             "playbackState": state, "playbackIssue": "", "hasVideo": hasVideo,
                             "playing": state == "playing", "playerVideoID": id]
    body.merge(extra) { _, new in new }
    takeVideoReport(body)
  }
}
let a = "abcdefghijk", b = "lmnopqrstuv"
func watch(_ id: String) -> URL { URL(string: "https://m.youtube.com/watch?v=" + id)! }
func expect(_ condition: Bool, _ message: String) {
  if !condition { print("FAILED: " + message); exit(1) }
}

let picture = Stage()
picture.report(a, state: "playing", hasVideo: true,
               extra: ["kind": "geometry", "mediaReady": true, "mediaPresented": false, "frameObservationSupported": true])
expect(picture.startupStatus.keepsStartupPoster && picture.openingMotion.completions == 0,
       "a matching playing report and decoded media retain the poster until a compositor frame")
picture.report(a, state: "playing", hasVideo: true, extra: ["mediaPresented": true])
expect(picture.startupStatus.keepsStartupPoster && picture.openingMotion.completions == 0,
       "partial playback packets cannot inject a picture acknowledgement")
expect(picture.videoLoadDiagnostics.presented == 0, "decoded data or a partial cannot claim first compositor timing")
picture.report(b, state: "playing", hasVideo: true,
               extra: ["kind": "geometry", "mediaReady": true, "mediaPresented": true, "frameObservationSupported": true])
expect(picture.startupStatus.keepsStartupPoster && picture.openingMotion.completions == 0,
       "a different video cannot fade the requested thumbnail")
picture.report(a, state: "playing", hasVideo: true,
               extra: ["kind": "geometry", "mediaReady": true, "mediaPresented": true, "frameObservationSupported": true])
expect(!picture.startupStatus.keepsStartupPoster && picture.openingMotion.completions == 1,
       "the current full report releases the poster after its actual first frame")
expect(picture.videoLoadDiagnostics.presented == 1, "the matching full first-picture report records native arrival timing")
picture.player.url = watch(b)
picture.playerMoved()
expect(picture.startupStatus.keepsStartupPoster, "navigation gives the next video its own picture wait")
picture.report(b, state: "unstarted", hasVideo: true,
               extra: ["kind": "geometry", "mediaReady": true, "mediaPresented": false, "frameObservationSupported": false])
expect(!picture.startupStatus.keepsStartupPoster && picture.openingMotion.completions == 2,
       "older WebKit uses the matching decoded picture fallback")

let missing = Stage()
missing.updateMissingMediaTimeout()
let oldTimer = missing.missingMediaTimeout!
missing.player.url = watch(b)
missing.playerMoved()
expect(oldTimer.isCancelled, "A's missing-media timer is cancelled when YouTube navigates to B")
expect(missing.startupVideoID == b && missing.missingMediaTimeout != nil && missing.missingMediaTimeout !== oldTimer,
       "B receives its own timeout even without a media report")
let newTimer = missing.missingMediaTimeout!
oldTimer.perform()
expect(missing.missingMediaTimeout === newTimer && !missing.startupStatus.showsButton,
       "an old queued deadline cannot clear or expire B's timer")
missing.report(b, state: "unavailable", hasVideo: false)
expect(missing.missingMediaTimeout === newTimer, "repeated B reports do not postpone its deadline")
newTimer.perform()
expect(missing.missingMediaTimeout == nil && missing.startupStatus.requiresReload && missing.startupStatus.showsButton,
       "B offers a working explicit reload after its own missing-media deadline")

let retry = Stage()
retry.startupStatus.missingMediaTimedOut()
retry.videoPlaying = true
retry.player.url = watch(b)
retry.playerMoved()
expect(retry.startupVideoID == b && retry.startupStatus.needsMediaTimeout && !retry.startupStatus.requiresReload && !retry.videoPlaying,
       "B does not inherit A's expired retry or playing indication")
retry.report(b, state: "unavailable", hasVideo: false)
expect(!retry.startupStatus.showsButton, "B's first empty report does not resurrect A's retry")

for state in ["unstarted", "playing", "buffering"] {
  let early = Stage()
  early.updateMissingMediaTimeout()
  let old = early.missingMediaTimeout!
  early.player.url = watch(b)
  early.report(b, state: state, hasVideo: true)
  expect(early.startupVideoID == b && old.isCancelled && early.missingMediaTimeout == nil,
         "accepted B report adopts the new identity before delayed URL KVO")
  early.playerMoved()
  early.playerMoved()
  expect(early.startupStatus.state.rawValue == state && early.missingMediaTimeout == nil,
         "late and repeated KVO preserves B's real playback state")
  early.report(a, state: "failed", hasVideo: false, extra: ["playbackIssue": "media-error"])
  expect(early.startupVideoID == b && early.startupStatus.state.rawValue == state && !early.startupStatus.requiresReload,
         "stale A report cannot replace B's identity or inject a retry")
}

let loading = Stage()
loading.mode = .loading
loading.loadingVideoID = b
loading.startupVideoID = b
loading.loadCommitted = false
loading.playerMoved()
expect(loading.startupVideoID == b, "old visible A URL does not reset native loading target B")
loading.report(b, state: "playing", hasVideo: true)
expect(loading.startupStatus.state == .unavailable, "uncommitted document report stays rejected")
loading.loadCommitted = true
loading.report(a, state: "failed", hasVideo: false)
expect(loading.startupVideoID == b && loading.startupStatus.state == .unavailable,
       "old document report cannot reset the new native loading target")
loading.report(b, state: "unstarted", hasVideo: true)
expect(loading.startupStatus.state == .unstarted && loading.resumes == 1,
       "current committed B report is accepted while URL KVO still points to A")
loading.player.url = watch(b)
loading.playerMoved()
expect(loading.startupStatus.state == .unstarted && loading.missingMediaTimeout == nil,
       "B URL commit preserves accepted loading state without starting an expanded timeout")

let warming = Stage()
warming.mode = .loading; warming.loadingVideoID = b; warming.startupVideoID = b
warming.loadCommitted = false
warming.player.url = URL(string: "https://m.youtube.com/")!
warming.playerMoved()
expect(warming.mode == .loading && warming.startupVideoID == b && warming.retired == 0,
       "delayed Home-shell URL KVO cannot retire a newly requested provisional Watch")

let spa = Stage()
spa.mode = .loading
spa.loadingViaSPA = true
spa.loadingVideoID = b
spa.startupVideoID = b
spa.report(b, state: "failed", hasVideo: false,
           extra: ["navigationToken": "0", "navigationTargetID": b])
expect(spa.startupStatus.state == .unavailable, "stale SPA ticket cannot mutate startup status")
spa.report(b, state: "playing", hasVideo: true,
           extra: ["navigationToken": "1", "navigationTargetID": b])
expect(spa.startupStatus.state == .playing && spa.startupVideoID == b,
       "current SPA ticket can report B before its URL notification")

let pendingInitial = Stage()
pendingInitial.mode = .loading; pendingInitial.loadingViaSPA = true
pendingInitial.loadingVideoID = b; pendingInitial.startupVideoID = b
pendingInitial.initialPlaybackIntent = PlayerInitialPlayback(ticket:1,videoID:b)
let route: [String: Any] = ["navigationToken":"1", "navigationTargetID":b]
pendingInitial.report(b,state:"buffering",hasVideo:true,extra:route)
expect(pendingInitial.initialPlaybackIntent?.consumed == false,
       "a reused SPA media status before a new load cannot consume the next video's initial Start")
var loaded = route; loaded["navigationMediaLoaded"] = true
pendingInitial.report(b,state:"paused",hasVideo:true,extra:loaded)
expect(pendingInitial.initialPlaybackIntent?.consumed == true && pendingInitial.initialPlaybackIntent?.awaitingMedia == false,
       "a real pause of the loaded target permanently consumes initial intent")
pendingInitial.report(b,state:"unstarted",hasVideo:true,extra:loaded)
expect(pendingInitial.initialPlaybackIntent?.consumed == true,
       "return to unstarted never revives an already paused target's initial Start")

let closed = Stage()
closed.mode = .closed
closed.startupVideoID = nil
closed.player.url = watch(b)
let scheduledBeforeClose = DispatchQueue.main.items.count
closed.report(b, state: "playing", hasVideo: true)
expect(closed.startupVideoID == nil && closed.startupStatus.state == .unavailable && !closed.videoPlaying,
       "offstage playback packets cannot reopen startup state")
closed.playerMoved()
closed.playerMoved()
expect(closed.missingMediaTimeout == nil && DispatchQueue.main.items.count == scheduledBeforeClose &&
       closed.startupStatus.state == .unavailable && !closed.videoPlaying,
       "late URL KVO while closed cannot start a media deadline or playback")
print("NATIVE_STARTUP_IDENTITY_OK")
`;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "langform-native-startup-identity-"));
  try {
    const script = path.join(temporary, "StartupIdentity.swift");
    fs.writeFileSync(script, exercise);
    const result = spawnSync(compiler.stdout.trim(), [script], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_STARTUP_IDENTITY_OK/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
