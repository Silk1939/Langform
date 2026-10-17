const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

function declaration(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  const open = source.indexOf("{", start);
  let depth = 1, end = open + 1;
  while (depth && end < source.length) { if (source[end] === "{") depth++; if (source[end] === "}") depth--; end++; }
  assert.equal(depth, 0);
  return source.slice(start, end).replace("private func", "func");
}

test("native audible-open handoff is current-ticket bound, one-at-a-time, and ignores stale completion", {
  skip: process.platform !== "darwin", timeout: 70000,
}, t => {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift toolchain unavailable");
  const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/YouTubeWebView.swift"), "utf8");
  const methods = ["startWatchAudioIfEligible", "clearWatchAudioIntent"].map(name => declaration(source, "private func " + name + "(")).join("\n");
  const exercise = `
import Foundation
class UIApplication {
 enum State { case active, background }
 static let shared = UIApplication()
 var applicationState = State.active
}
enum StartupDiagnostics { static var events = [String](); static func mark(_ event: String) { events.append(event) } }
class Web {
 var url: URL? = watch(a), scripts = [String](), replies = [(Any?, Error?) -> Void]()
 func evaluateJavaScript(_ code: String, completionHandler: @escaping (Any?, Error?) -> Void) { scripts.append(code); replies.append(completionHandler) }
}
enum YouTubeWebView {
 ${declaration(source, "static func isYouTube(")}
 ${declaration(source, "static func isWatchPage(")}
 ${declaration(source, "static func videoID(")}
}
class Stage {
 enum Mode { case closed, loading, expanded, mini }
 var mode = Mode.expanded, playerOverlayOpen = false, dragging = false
 var player: Web! = Web(), loadTicket = 1, startupVideoID: String? = a, loadingVideoID: String? = a
 var watchAudioIntent: (ticket: Int, videoID: String)? = (1, a), watchAudioCheckTicket: Int?
 ${methods}
}
let a = "abcdefghijk", b = "lmnopqrstuv"
func watch(_ id: String) -> URL { URL(string:"https://m.youtube.com/watch?v=" + id)! }
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }
for mode in [Stage.Mode.loading, .expanded, .mini] {
 let s = Stage(); s.mode = mode; s.startWatchAudioIfEligible(id:a)
 expect(s.player.scripts.count == 1 && s.player.scripts[0].contains("__langformApplyWatchAudio(\\"" + a + "\\", '1')"), "one current explicit open audio call")
 for _ in 0..<50 { s.startWatchAudioIfEligible(id:a) }
 expect(s.player.scripts.count == 1, "in-flight replies prevent report floods")
 s.player.replies[0](true,nil)
 expect(s.watchAudioIntent == nil && s.watchAudioCheckTicket == nil, "handled exact intent is released")
 for _ in 0..<50 { s.startWatchAudioIfEligible(id:a) }
 expect(s.player.scripts.count == 1, "same-open playback and status cannot unmute again")
}
for kind in ["closed", "background", "overlay", "drag", "wrongTicket", "wrongIntentID", "wrongURL", "wrongStartupID", "wrongLoadingID", "noIntent", "noPlayer"] {
 let s = Stage()
 switch kind {
 case "closed": s.mode = .closed
 case "background": UIApplication.shared.applicationState = .background
 case "overlay": s.playerOverlayOpen = true
 case "drag": s.dragging = true
 case "wrongTicket": s.loadTicket = 2
 case "wrongIntentID": s.watchAudioIntent = (1,b)
 case "wrongURL": s.player.url = watch(b)
 case "wrongStartupID": s.startupVideoID = b
 case "wrongLoadingID": s.loadingVideoID = b
 case "noIntent": s.watchAudioIntent = nil
 default: s.player = nil
 }
 s.startWatchAudioIfEligible(id:a)
 expect(s.player?.scripts.isEmpty ?? true, "rejected native owner cannot request sound: " + kind)
 UIApplication.shared.applicationState = .active
}
let deferred = Stage(); deferred.startWatchAudioIfEligible(id:a); deferred.player.replies[0](false,nil)
expect(deferred.watchAudioCheckTicket == nil && deferred.watchAudioIntent?.ticket == 1, "ad/loading rejection keeps only the same open intent")
deferred.startWatchAudioIfEligible(id:a); expect(deferred.player.scripts.count == 2, "later valid media report can finish sound initialization")
deferred.player.replies[1](true,nil); expect(deferred.watchAudioIntent == nil, "second readiness result consumes same intent")
for kind in ["newTicket", "newVideo", "newPlayer", "inactive", "cancelled"] {
 let s = Stage(); s.startWatchAudioIfEligible(id:a); let old = s.player!, callback = old.replies[0]
 switch kind {
 case "newTicket": s.loadTicket = 2; s.watchAudioIntent = (2,a); s.watchAudioCheckTicket = 2
 case "newVideo": s.player.url = watch(b); s.startupVideoID = b; s.loadingVideoID = b; s.watchAudioIntent = (2,b); s.watchAudioCheckTicket = 2
 case "newPlayer": s.player = Web(); s.watchAudioIntent = (2,a); s.watchAudioCheckTicket = 2
 case "inactive": s.clearWatchAudioIntent(); UIApplication.shared.applicationState = .background
 default: s.clearWatchAudioIntent()
 }
 let intent = s.watchAudioIntent, check = s.watchAudioCheckTicket
 callback(true,nil)
 expect(s.watchAudioIntent?.ticket == intent?.ticket && s.watchAudioIntent?.videoID == intent?.videoID && s.watchAudioCheckTicket == check,
        "old completion cannot consume current intent: " + kind)
 UIApplication.shared.applicationState = .active
}
print("NATIVE_WATCH_AUDIO_OK")
`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "langform-watch-audio-"));
  try {
    const file = path.join(temp, "main.swift"); fs.writeFileSync(file, exercise);
    const result = spawnSync(compiler.stdout.trim(), [file], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_WATCH_AUDIO_OK/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
