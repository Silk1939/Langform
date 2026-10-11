const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
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
  assert.equal(depth, 0);
  return source.slice(start, end).replace("private func", "func").replace("private var", "var");
}

test("erster Watch-Start und opt-in Diagnose starten einmal, verwerfen stale Requests und respektieren echte Pause", {
  skip: process.platform !== "darwin", timeout: 70000,
}, t => {
  const swift = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (swift.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  const dir = path.join(__dirname, "../ios/Langform/Langform");
  const native = fs.readFileSync(path.join(dir, "YouTubeWebView.swift"), "utf8");
  const helpers = ["videoProbeMayStartPlayback", "startVideoProbePlaybackIfEligible", "initialPlaybackMayStart", "startInitialPlaybackIfEligible", "startPlaybackTapped", "expandCard", "settle", "resetPlayerStartupForVideo"]
    .map(name => declaration(native, "private func " + name + "(")).join("\n");
  const property = declaration(native, "private var awaitingInitialPlayback:");
  const watchStart = native.indexOf('case "langformWatchIntent":');
  const watchEnd = native.indexOf('case "langformNavigateFeed":', watchStart);
  assert.ok(watchStart >= 0 && watchEnd > watchStart);
  const watchRoute = native.slice(watchStart + 'case "langformWatchIntent":'.length, watchEnd);
  const exercise = `
import CoreGraphics
enum UIAccessibility { static var isReduceMotionEnabled = false }
struct UISpringTimingParameters { init(dampingRatio: CGFloat, initialVelocity: CGVector) {} }
class UIViewPropertyAnimator {
 enum Position { case start, current, end }
 var isUserInteractionEnabled = false
 var animations: [() -> Void] = [], completions: [(Position) -> Void] = []
 init(duration: Double, timingParameters: UISpringTimingParameters) {}
 func addAnimations(_ action: @escaping () -> Void) { animations.append(action) }
 func addCompletion(_ action: @escaping (Position) -> Void) { completions.append(action) }
 func startAnimation() { animations.forEach { $0() } }
 func stopAnimation(_ immediately: Bool) {}
 func finish(_ position: Position = .end) { completions.forEach { $0(position) } }
}
class Card { var transform = CGAffineTransform.identity }
class CardTap { var isEnabled = false }
class UIApplication {
 enum State { case active, background }
 static let shared = UIApplication()
 var applicationState = State.active
}
enum StartupDiagnostics {
 static var enabled = true
 static var events: [String] = []
 static func mark(_ event: String) { events.append(event) }
}
class Web {
 var url: URL? = watch(a)
 var isUserInteractionEnabled = true
 var scripts: [String] = []
 var replies: [(Any?, Error?) -> Void] = []
 func evaluateJavaScript(_ code: String, completionHandler: @escaping (Any?, Error?) -> Void) {
  scripts.append(code); replies.append(completionHandler)
 }
}
enum YouTubeWebView {
 ${declaration(native, "static func isYouTube(")}
 ${declaration(native, "static func isWatchPage(")}
 ${declaration(native, "static func videoID(")}
}
struct Origin { var \`protocol\` = "https", host = "m.youtube.com" }
struct Frame { var isMainFrame = true, securityOrigin = Origin() }
class Message { var webView: Web?, frameInfo = Frame(), body: Any = [:] }
struct Recorder {
 enum Event { case playRequested }
 var playRequests = 0
 mutating func mark(_ event: Event, ticket: Int) { playRequests += 1 }
}
class Stage {
 var cropCorrection: Any?
 enum Mode { case loading, expanded, mini, closed }
 var mode = Mode.expanded, playerOverlayOpen = false, dragging = false, videoPlaying = false
 var ownsWatchPlayer = true, forcedMoving = false, settlingBetweenModes = false
 var missingMediaTimeout: DispatchWorkItem?
 var progress: CGFloat = 0, card = Card(), cardTap = CardTap()
 var settler: UIViewPropertyAnimator?, revealer: UIViewPropertyAnimator?, dismisser: UIViewPropertyAnimator?
 var cardMoving: Bool {
  get { forcedMoving || dragging || settler != nil || revealer != nil || dismisser != nil }
  set { forcedMoving = newValue }
 }
 var player: Web! = Web(), loadTicket = 1
 var videoSeekGeometry: (rect: CGRect, videoID: String, ticket: Int, viewport: Int)?
 var startupStatus = PlayerStartupStatus(), startupVideoID: String? = a, loadingVideoID: String? = a
 var videoProbe: VideoLoadProbe?, videoProbeTicket: Int?
 var videoProbePlayCheck: (ticket: Int, request: Int)?, startingVideoProbePlayback = false
 var initialPlaybackIntent: PlayerInitialPlayback?, initialPlaybackCheckTicket: Int?, startingWatchPlayback = false
 var executingInteractionProbe = false, videoLoadDiagnostics = Recorder(), updates = 0, reloads = 0, cancellations = 0
 var watchIntentURLs: [URL] = []
 init(diagnostic: Bool = false, flag: String? = "1", intent: Bool = false) {
  startupStatus.receive(state: "unstarted", issue: "", hasVideo: true)
  if diagnostic {
   var env = ["LANGFORM_DIAGNOSTICS":"1", "LANGFORM_VIDEO_PROBE":"[\\"abcdefghijk\\",\\"abcdefghijk\\"]"]
   env["LANGFORM_VIDEO_PROBE_PLAY"] = flag
   videoProbe = VideoLoadProbe(environment: env); _ = videoProbe?.start(feedReady: true); videoProbeTicket = loadTicket
  }
  if intent { initialPlaybackIntent = PlayerInitialPlayback(ticket: loadTicket, videoID: a) }
 }
 func cancelVideoProbe() { cancellations += 1; videoProbe?.cancel(); videoProbeTicket = nil; videoProbePlayCheck = nil }
 func updatePlaybackControls() { updates += 1 }
 func updateChrome() { updatePlaybackControls() }
 func freezeSettle() { settler?.stopAnimation(true); settler = nil; settlingBetweenModes = false }
 func freezeReveal() { revealer?.stopAnimation(true); revealer = nil }
 func beginVideoCrop() {}
 func apply(_ progress: CGFloat) {}
 func restoreExpandedSurface() {}
 func flushPendingRect() {}
 func closePlayer() { mode = .closed }
 func openWatch(_ url: URL) { reloads += 1 }
 func openWatch(_ url: URL, userInitiated: Bool, sourceRect: [String:Any]? = nil,
                sourceThumbnail: [String:Any]? = nil, sourceView: Web? = nil) { if userInitiated { watchIntentURLs.append(url) } }
 func handleWatch(_ message: Message) { ${watchRoute} }
 func state(_ raw: String, issue: String = "") {
  startupStatus.receive(state: raw, issue: issue, hasVideo: true)
  if initialPlaybackIntent?.matches(ticket:loadTicket,videoID:startupVideoID) == true {
   initialPlaybackIntent?.observe(startupStatus.state)
  }
 }
 ${helpers}
 ${property}
}
let a = "abcdefghijk", b = "lmnopqrstuv"
func watch(_ id: String) -> URL { URL(string:"https://m.youtube.com/watch?v=" + id)! }
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }
func attempt(_ s: Stage, diagnostic: Bool) {
 if diagnostic { s.startVideoProbePlaybackIfEligible(id:a) } else { s.startInitialPlaybackIfEligible(id:a) }
}
for flag in [nil,"0","true"," 1","1 "] as [String?] {
 let s = Stage(diagnostic:true,flag:flag); attempt(s, diagnostic:true)
 expect(s.player.scripts.isEmpty && s.cancellations == 0, "diagnostic native Start needs exact second opt-in")
}
StartupDiagnostics.enabled = false
let noDiagnostics = Stage(diagnostic:true); attempt(noDiagnostics,diagnostic:true)
expect(noDiagnostics.player.scripts.isEmpty, "diagnostics must still be enabled at the action boundary")
let normal = Stage(intent:true)
attempt(normal,diagnostic:false)
expect(normal.player.scripts.count == 1 && normal.awaitingInitialPlayback, "product intent works without diagnostics and suppresses the initial Start button")
normal.player.replies[0](true,nil)
expect(normal.player.scripts.count == 2 && normal.cancellations == 0 && normal.awaitingInitialPlayback,
       "one ordinary native Start is issued and stays pending until actual media state")
normal.player.replies[1](false,nil)
expect(normal.startupStatus.state == .failed && !normal.awaitingInitialPlayback && normal.reloads == 0,
       "failed initial bridge exposes explicit recovery without a reload")
normal.state("unstarted"); attempt(normal,diagnostic:false)
expect(normal.player.scripts.count == 2, "a later unstarted report cannot retry a rejected start")
StartupDiagnostics.enabled = true
for diagnostic in [false,true] {
 let s = Stage(diagnostic:diagnostic,intent:!diagnostic)
 for _ in 0..<20 { attempt(s,diagnostic:diagnostic) }
 expect(s.player.scripts.count == 1, "overlapping observations issue one read-only eligibility query")
 s.player.replies[0](true,nil)
 expect(s.player.scripts.count == 2 && s.videoLoadDiagnostics.playRequests == 1 && s.cancellations == 0,
        "one existing Start request neither cancels the authorized probe nor changes lifecycle")
 expect(!s.startingVideoProbePlayback && !s.startingWatchPlayback && !s.executingInteractionProbe, "action guards are scoped to the synchronous native call")
 s.player.replies[1](true,nil)
 for _ in 0..<20 { attempt(s,diagnostic:diagnostic) }
 expect(s.player.scripts.count == 2, "an accepted but stalled request never retries")
 s.state("playing"); s.state("paused"); s.state("unstarted"); attempt(s,diagnostic:diagnostic)
 expect(s.player.scripts.count == 2, "a played or deliberately paused video never gets restarted")
 for invalid in ["mini","closed","overlay","drag","motion","playing","paused","buffering","ended","failed","reload","ticket","id","url","inactive","cancel"] {
  UIApplication.shared.applicationState = .active
  let invalidStage = Stage(diagnostic:diagnostic,intent:!diagnostic)
  switch invalid {
  case "mini": invalidStage.mode = .mini
  case "closed": invalidStage.mode = .closed
  case "overlay": invalidStage.playerOverlayOpen = true
  case "drag": invalidStage.dragging = true
  case "motion": invalidStage.cardMoving = true
  case "playing": invalidStage.videoPlaying = true
  case "paused", "buffering", "ended", "failed": invalidStage.state(invalid)
  case "reload": invalidStage.state("unstarted",issue:"media-error")
  case "ticket": invalidStage.loadTicket += 1
  case "id": invalidStage.startupVideoID = b
  case "url": invalidStage.player.url = watch(b)
  case "inactive": UIApplication.shared.applicationState = .background
  default: if diagnostic { invalidStage.videoProbe?.cancel() } else { invalidStage.initialPlaybackIntent = nil }
  }
  attempt(invalidStage,diagnostic:diagnostic)
  expect(invalidStage.player.scripts.isEmpty && invalidStage.reloads == 0, "no Start for ineligible native state " + invalid)
 }
 UIApplication.shared.applicationState = .active
 for change in ["ticket","video","webview","inactive","overlay","paused","cancel","request"] {
  let stale = Stage(diagnostic:diagnostic,intent:!diagnostic)
  attempt(stale,diagnostic:diagnostic)
  let oldWeb = stale.player!, reply = oldWeb.replies[0]
  switch change {
  case "ticket": stale.loadTicket += 1
  case "video": stale.player.url = watch(b)
  case "webview": stale.player = Web()
  case "inactive": UIApplication.shared.applicationState = .background
  case "overlay": stale.playerOverlayOpen = true
  case "paused": stale.state("paused")
  case "cancel": if diagnostic { stale.videoProbe?.cancel() } else { stale.initialPlaybackIntent = nil }
  default:
   if diagnostic { _ = stale.videoProbe?.timedOut(requestNumber:1) }
   else { stale.initialPlaybackIntent = PlayerInitialPlayback(ticket:2,videoID:a) }
  }
  reply(true,nil)
  expect(oldWeb.scripts.count == 1 && stale.player.scripts.count <= 1, "stale eligibility cannot start media after " + change)
  UIApplication.shared.applicationState = .active
 }
}
let loadingWatch = Stage(intent:true); loadingWatch.mode = .loading
attempt(loadingWatch,diagnostic:false); loadingWatch.player.replies[0](true,nil)
expect(loadingWatch.player.scripts.count == 2, "a matching new SPA media can start while reveal still waits for its first frame")
let loadingProbe = Stage(diagnostic:true); loadingProbe.mode = .loading
attempt(loadingProbe,diagnostic:true)
expect(loadingProbe.player.scripts.isEmpty, "diagnostic action retains its expanded-only contract")
let automatic = Stage(intent:true); automatic.state("buffering"); automatic.state("unstarted"); attempt(automatic,diagnostic:false)
expect(automatic.player.scripts.isEmpty && !automatic.awaitingInitialPlayback, "YouTube's own started stream consumes initial intent and cannot be retried")
let noIntent = Stage(); attempt(noIntent,diagnostic:false)
expect(noIntent.player.scripts.isEmpty, "an unsolicited URL/status alone never creates start authorization")
for reduced in [false,true] {
 UIAccessibility.isReduceMotionEnabled = reduced
 let returned = Stage(intent:true)
 attempt(returned,diagnostic:false)
 returned.mode = .mini; returned.progress = 1
 returned.player.replies[0](true,nil)
 expect(returned.player.scripts.count == 1 && returned.initialPlaybackIntent?.consumed == false,
        "Mini rejects the pending eligibility reply without consuming authorized Start")
 returned.expandCard()
 if !reduced {
  expect(returned.player.scripts.count == 1 && returned.cardMoving,
         "expanding motion itself cannot begin playback before reaching expanded")
  returned.settler!.finish()
 }
 expect(returned.player.scripts.count == 2 && !returned.cardMoving,
        "actual expanded completion reconsiders the current initial intent, including Reduce Motion")
 returned.player.replies[1](true,nil)
 expect(returned.player.scripts.count == 3 && returned.videoLoadDiagnostics.playRequests == 1,
        "reconsidering after a rejected observation still produces exactly one native Start")
 returned.player.replies[2](true,nil)
 returned.settle(.expanded)
 expect(returned.player.scripts.count == 3, "repeat expanded completion cannot retry an already claimed request")
}
UIAccessibility.isReduceMotionEnabled = false
let interrupted = Stage(intent:true)
interrupted.mode = .mini; interrupted.progress = 1; interrupted.expandCard()
let oldExpansion = interrupted.settler!
interrupted.settle(.mini)
oldExpansion.finish()
expect(interrupted.player.scripts.isEmpty, "stale expanded completion never starts while a newer minimization owns the surface")
interrupted.settler!.finish()
expect(interrupted.player.scripts.isEmpty, "actual mini completion never requests initial Play")
interrupted.expandCard(); interrupted.settler!.finish(.current)
expect(interrupted.player.scripts.isEmpty, "an interrupted expansion has not reached the required expanded resting pose")
let miniFailure = Stage(intent:true)
attempt(miniFailure,diagnostic:false); miniFailure.player.replies[0](true,nil)
miniFailure.mode = .mini; miniFailure.progress = 1
miniFailure.player.replies[1](false,nil)
expect(miniFailure.startupStatus.state == .failed && miniFailure.initialPlaybackIntent?.awaitingMedia == false,
       "bound initial failure still becomes explicit recovery after the surface moves into Mini")
miniFailure.expandCard(); miniFailure.settler!.finish()
expect(miniFailure.player.scripts.count == 2 && !miniFailure.awaitingInitialPlayback && miniFailure.startupStatus.showsButton,
       "failed claimed Start exposes recovery when expanded; completion never retries it")
let miniPause = Stage(intent:true)
attempt(miniPause,diagnostic:false); miniPause.player.replies[0](true,nil)
miniPause.mode = .mini; miniPause.state("paused"); miniPause.player.replies[1](false,nil)
expect(miniPause.startupStatus.state == .paused,
       "real pause supersedes a late initial failure even in Mini")
let departed = Stage(intent:true)
attempt(departed,diagnostic:false)
let oldEligibility = departed.player.replies[0]
departed.player.url = watch(b); departed.resetPlayerStartupForVideo(b); departed.state("playing")
expect(departed.initialPlaybackIntent == nil && departed.initialPlaybackCheckTicket == nil,
       "a non-native SPA identity change retires the old unclaimed authorization and its observation")
departed.player.url = watch(a); departed.resetPlayerStartupForVideo(a); departed.state("unstarted")
oldEligibility(true,nil); attempt(departed,diagnostic:false)
expect(departed.player.scripts.count == 1 && !departed.awaitingInitialPlayback,
       "A to B to A cannot resurrect A's old authorization or an old same-ID callback")
let currentIntent = Stage(intent:true)
currentIntent.loadTicket = 2; currentIntent.loadingVideoID = b
currentIntent.initialPlaybackIntent = PlayerInitialPlayback(ticket:2,videoID:b)
currentIntent.initialPlaybackCheckTicket = 2
currentIntent.player.url = watch(b); currentIntent.resetPlayerStartupForVideo(b)
expect(currentIntent.initialPlaybackIntent?.matches(ticket:2,videoID:b) == true && currentIntent.initialPlaybackCheckTicket == 2,
       "reset to the newly authorized target preserves its current native openWatch intent and matching observation")
currentIntent.startupVideoID = b
currentIntent.resetPlayerStartupForVideo(b)
expect(currentIntent.initialPlaybackIntent?.consumed == false,
       "repeated current-ID KVO never cancels or consumes a fresh bound request")
for changed in ["valid", "mini", "frame", "origin", "scheme", "source", "view", "closed", "loading", "target", "targetscheme"] {
 let stage = Stage(), message = Message()
 message.webView = stage.player
 var payload = ["href":watch(b).absoluteString,"sourceVideoID":a]
 switch changed {
 case "mini": stage.mode = .mini
 case "frame": message.frameInfo.isMainFrame = false
 case "origin": message.frameInfo.securityOrigin.host = "other.example"
 case "scheme": message.frameInfo.securityOrigin.\`protocol\` = "http"
 case "source": payload["sourceVideoID"] = b
 case "view": message.webView = Web()
 case "closed": stage.mode = .closed
 case "loading": stage.mode = .loading
 case "target": payload["href"] = "https://other.example/watch?v=lmnopqrstuv"
 case "targetscheme": payload["href"] = "http://m.youtube.com/watch?v=lmnopqrstuv"
 default: break
 }
 message.body = payload; stage.handleWatch(message)
 expect(stage.watchIntentURLs.count == (changed == "valid" || changed == "mini" ? 1 : 0),
        "only the current HTTPS main-frame Watch may authorize a recommendation " + changed)
}
let fixtures = ["eligibility":PlayerStartupStatus.initialPlayJavaScript(videoID:a),
                "play":PlayerStartupStatus.initialPlayJavaScript(videoID:a,play:true)]
print("SCRIPT_FIXTURE:" + String(data:try! JSONSerialization.data(withJSONObject:fixtures),encoding:.utf8)!)
print("NATIVE_INITIAL_PLAY_OK")
`;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "langform-initial-play-"));
  try {
    const file = path.join(temporary, "InitialPlay.swift");
    fs.writeFileSync(file, fs.readFileSync(path.join(dir, "PlayerStartupStatus.swift"), "utf8") + "\n" + fs.readFileSync(path.join(dir, "VideoLoadProbe.swift"), "utf8") + "\n" + exercise);
    const result = spawnSync(swift.stdout.trim(), [file], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_INITIAL_PLAY_OK/);
    const scripts = JSON.parse(result.stdout.split("\n").find(line => line.startsWith("SCRIPT_FIXTURE:")).slice(15));
    function page() {
      const video = { paused:true, ended:false, error:null, seeking:false, currentTime:0 };
      const data = { video_id:"abcdefghijk", isAd:false };
      const classes = new Set();
      const root = { getVideoData:() => data, querySelector:() => video, classList:{ contains:name => classes.has(name) } };
      const report = { playerVideoID:"abcdefghijk", playbackState:"unstarted", playbackIssue:"", navigationToken:"" };
      const document = { hidden:false, getElementById:() => root };
      const window = { __langformMeasureVideo:() => report, __langformPlay:(id,initial) => { calls.push({id,initial}); return true; } };
      const location = { href:"https://m.youtube.com/watch?v=abcdefghijk" };
      const calls = [];
      return { video,data,classes,root,report,document,window,location,calls, run:script => vm.runInNewContext(script,{window,document,location,URL}) };
    }
    const valid = page();
    assert.equal(valid.run(scripts.eligibility), true);
    assert.equal(valid.calls.length, 0, "eligibility is read-only");
    assert.equal(valid.run(scripts.play), true);
    assert.deepEqual(valid.calls, [{id:"abcdefghijk",initial:true}]);
    for (const change of [
      p=>p.data.isAd=true, p=>p.classes.add("ad-showing"), p=>p.classes.add("ad-interrupting"),
      p=>p.video.paused=false, p=>p.video.ended=true, p=>p.video.error={}, p=>p.video.seeking=true,
      p=>p.video.currentTime=10, p=>p.video.currentTime=NaN, p=>p.data.video_id="lmnopqrstuv",
      p=>p.report.playerVideoID="lmnopqrstuv", p=>p.report.playbackState="paused", p=>p.report.playbackIssue="rejected",
      p=>p.location.href="https://m.youtube.com/watch?v=lmnopqrstuv", p=>p.location.href="https://m.youtube.com/",
      p=>p.location.href="https://other.example/watch?v=abcdefghijk",
      p=>p.document.getElementById=()=>null, p=>p.root.querySelector=()=>null, p=>p.document.hidden=true,
      p=>p.root.getVideoData=()=>{throw Error("hydration")}, p=>p.window.__langformHasOpenOverlay=()=>true,
      p=>p.window.__langformIsNativeDragging=()=>true,
      p=>Object.assign(p.report,{navigationToken:"1",navigationStarted:true,navigationComplete:true,navigationMediaLoaded:false}),
      p=>Object.assign(p.report,{navigationToken:"1",navigationStarted:false,navigationComplete:true,navigationMediaLoaded:true}),
      p=>Object.assign(p.report,{navigationToken:"1",navigationStarted:true,navigationComplete:false,navigationMediaLoaded:true}),
    ]) {
      const p=page(); assert.equal(p.run(scripts.eligibility),true);
      change(p);
      assert.equal(p.run(scripts.play),false,"live guard rechecks race at actual Play evaluation");
      assert.equal(p.calls.length,0);
    }
    const spa=page(); Object.assign(spa.report,{navigationToken:"1",navigationStarted:true,navigationComplete:true,navigationMediaLoaded:true,mediaPresented:false});
    assert.equal(spa.run(scripts.play),true,"new loaded SPA media may start before its first picture");
  } finally { fs.rmSync(temporary,{recursive:true,force:true}); }
});
