const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("native Start wertet tatsächliche JS-Auftragsannahme aus und verwirft veraltete Antworten", {
  skip: process.platform !== "darwin", timeout: 70000,
}, function (t) {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Der native Start-Test benötigt die Swift-Toolchain.");
  const directory = path.join(__dirname, "../ios/Langform/Langform");
  const source = fs.readFileSync(path.join(directory, "YouTubeWebView.swift"), "utf8");
  const start = source.indexOf("private func startPlaybackTapped()");
  assert.ok(start >= 0);
  const open = source.indexOf("{", start);
  let depth = 1, end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
    end++;
  }
  const method = source.slice(start, end).replace("private func", "func");
  const status = fs.readFileSync(path.join(directory, "PlayerStartupStatus.swift"), "utf8");
  const exercise = `
class Web {
    var url = URL(string: "https://m.youtube.com/watch?v=abcdefghijk")
    var replies: [(Any?, Error?) -> Void] = []
    func evaluateJavaScript(_ code: String, completionHandler: @escaping (Any?, Error?) -> Void) {
        replies.append(completionHandler)
    }
}
enum YouTubeWebView {
    static func videoID(_ url: URL?) -> String? {
        guard let url else { return nil }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "v" })?.value
    }
}
struct Recorder {
    enum Event { case playRequested }
    mutating func mark(_ event: Event, ticket: Int) {}
}
class Stage {
    enum Mode { case expanded, mini, closed, loading }
    var mode = Mode.expanded
    var executingInteractionProbe = false, playerOverlayOpen = false
    var startingVideoProbePlayback = false, startingWatchPlayback = false
    var initialPlaybackIntent: PlayerInitialPlayback?
    var player: Web! = Web()
    var startupStatus = PlayerStartupStatus()
    var loadingVideoID: String? = "abcdefghijk", loadTicket = 1
    var videoLoadDiagnostics = Recorder()
    var updates = 0, reloads = 0
    init() { startupStatus.receive(state: "unstarted", issue: "", hasVideo: true) }
    func cancelVideoProbe() {}
    func updatePlaybackControls() { updates += 1 }
    func closePlayer() {}
    func openWatch(_ url: URL) { reloads += 1 }
    ${method}
}
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }
for outcome in ["false", "missing", "error"] {
    let s = Stage(); s.startPlaybackTapped()
    let result: Any? = outcome == "false" ? false : nil
    let error: Error? = outcome == "error" ? NSError(domain: "JavaScript", code: 1) : nil
    s.player.replies[0](result, error)
    expect(s.startupStatus.state == .failed && s.startupStatus.buttonTitle == "Erneut starten" && s.updates == 1,
           "false, missing and throwing bridges provide explicit recovery")
}
let accepted = Stage(); accepted.startPlaybackTapped(); accepted.player.replies[0](true, nil)
expect(accepted.startupStatus.state == .unstarted && accepted.updates == 0, "accepted request is not optimistic Playing")
for change in ["ticket", "video", "webview", "mode"] {
    let s = Stage(); s.startPlaybackTapped(); let reply = s.player.replies[0]
    if change == "ticket" { s.loadTicket += 1 }
    if change == "video" { s.player.url = URL(string: "https://m.youtube.com/watch?v=lmnopqrstuv") }
    if change == "webview" { s.player = Web() }
    if change == "mode" { s.mode = .closed }
    reply(false, nil)
    expect(s.startupStatus.state == .unstarted && s.updates == 0, "stale document or video cannot expose another video's failure")
}
let newer = Stage(); newer.startPlaybackTapped(); newer.startPlaybackTapped()
newer.player.replies[0](false, nil)
expect(newer.startupStatus.state == .unstarted, "older request cannot replace newer request")
newer.player.replies[1](false, nil)
expect(newer.startupStatus.state == .failed, "newest failure remains visible")
for terminal in ["playing", "paused", "ended"] {
    let s = Stage(); s.startPlaybackTapped()
    s.startupStatus.receive(state: terminal, issue: "", hasVideo: true)
    s.player.replies[0](false, nil)
    expect(s.startupStatus.state.rawValue == terminal && s.startupStatus.issue.isEmpty,
           "real media state supersedes late bridge failure")
}
print("NATIVE_PLAY_REQUEST_OK")
`;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "langform-native-play-"));
  try {
    const script = path.join(temporary, "PlayRequest.swift");
    fs.writeFileSync(script, status + "\n" + exercise);
    const result = spawnSync(compiler.stdout.trim(), [script], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_PLAY_REQUEST_OK/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
