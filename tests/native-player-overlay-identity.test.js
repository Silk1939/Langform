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

test("native Overlay-Sperre folgt der Video-ID und bewahrt aktuelle Meldungen vor dem URL-KVO", {
  skip: process.platform !== "darwin", timeout: 70000,
}, t => {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/YouTubeWebView.swift"), "utf8");
  const overlayStart = source.indexOf('case "langformOverlayState":');
  const overlayEnd = source.indexOf('case "langformSummary":', overlayStart);
  assert.ok(overlayStart >= 0 && overlayEnd > overlayStart);
  const overlay = source.slice(overlayStart + 'case "langformOverlayState":'.length, overlayEnd);
  // Run the shipping URL callback and message handler with both possible event
  // orders. The harness models native state/identity, not WebKit visibility.
  const exercise = `
import Foundation
enum YouTubeWebView {
  ${declaration(source, "static func isYouTube(")}
  ${declaration(source, "static func isWatchPage(")}
  ${declaration(source, "static func videoID(")}
}
class Web {
  var url: URL?, allowsBackForwardNavigationGestures = true
  init(_ url: URL?) { self.url = url }
}
class Message {
  var webView: Web?, body: Any
  init(_ webView: Web?, _ body: Any) { self.webView = webView; self.body = body }
}
class FeedState { var overlayOpen = false }
class Diagnostics {
  enum Outcome { case superseded }
  var finished = 0
  func finish(_ outcome: Outcome) { finished += 1 }
}
class Stage {
  enum Mode { case closed, loading, expanded, mini }
  var mode = Mode.expanded, playerOverlayOpen = true
  var playerOverlayVideoID: String? = "abcdefghijk"
  var player: Web! = Web(watch("lmnopqrstuv")), feed = Web(URL(string: "https://m.youtube.com/"))
  var loadingVideoID: String? = "lmnopqrstuv", lastWatchURL: URL? = watch("abcdefghijk")
  var loadCommitted = true, loadingViaSPA = false
  var videoLoadDiagnostics = Diagnostics(), feedState = FeedState()
  var dragging = false, edgeBackTracking = false
  var updates = 0, settlements = 0, endDrags = 0, shown: [URL] = [], closes = 0
  func updatePlaybackControls() { updates += 1 }
  func startInitialPlaybackIfEligible(id: String) {}
  func startVideoProbePlaybackIfEligible(id: String) {}
  func resetPlayerStartupForVideo(_ id: String?) {}
  func updateMissingMediaTimeout() {}
  func showInFeed(_ url: URL) { shown.append(url) }
  func closePlayer() { closes += 1 }
  func retirePlayerPage(to url: URL) { showInFeed(url); closePlayer() }
  func endDrag() { dragging = false; edgeBackTracking = false; endDrags += 1 }
  func settle(_ mode: Mode) { settlements += 1 }
  func feedState(for web: Web) -> FeedState? { web === feed ? feedState : nil }
  func cancelFeedPrewarm() {}
  func scheduleFeedPrewarm() {}
  ${declaration(source, "private func playerMoved(")}
  ${declaration(source, "private func resetPlayerOverlayForVideo(")}
  func receiveOverlay(_ message: Message) { ${overlay} }
  func report(_ id: String, open: Bool) {
    receiveOverlay(Message(player, ["href": watch(id).absoluteString, "open": open]))
  }
}
func watch(_ id: String) -> URL { URL(string: "https://m.youtube.com/watch?v=" + id)! }
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }

let old = Stage()
old.playerMoved()
expect(!old.playerOverlayOpen && old.playerOverlayVideoID == nil && old.updates == 1,
       "new video releases previous video's overlay before its first report")
expect(old.lastWatchURL == watch("lmnopqrstuv"), "URL callback still adopts current watch")
old.report("lmnopqrstuv", open: true)
expect(old.playerOverlayOpen && old.playerOverlayVideoID == "lmnopqrstuv",
       "new report restores the current video's real sheet lock")

for open in [true, false] {
  let current = Stage()
  current.report("lmnopqrstuv", open: open)
  expect(current.playerOverlayVideoID == "lmnopqrstuv" && current.playerOverlayOpen == open,
         "accepted report records identity even when closing")
  current.playerMoved()
  current.playerMoved()
  expect(current.playerOverlayVideoID == "lmnopqrstuv" && current.playerOverlayOpen == open && current.updates == 1,
         "late and repeated URL callbacks preserve a current route's report")
}

let stale = Stage()
stale.playerMoved()
stale.report("abcdefghijk", open: true)
expect(!stale.playerOverlayOpen && stale.playerOverlayVideoID == nil && stale.updates == 1,
       "old video's delayed message cannot re-lock current player")
stale.report("lmnopqrstuv", open: true)
stale.report("abcdefghijk", open: false)
expect(stale.playerOverlayOpen && stale.playerOverlayVideoID == "lmnopqrstuv" && stale.updates == 2,
       "old video's close cannot unlock a current sheet")

let loading = Stage()
loading.mode = .loading
loading.player.url = watch("abcdefghijk")
loading.report("lmnopqrstuv", open: true)
loading.playerMoved()
expect(loading.playerOverlayOpen && loading.playerOverlayVideoID == "lmnopqrstuv",
       "old native URL during loading cannot erase incoming document's report")
loading.player.url = watch("lmnopqrstuv")
loading.playerMoved()
expect(loading.playerOverlayOpen && loading.updates == 1, "commit callback preserves new loading identity")

let closed = Stage()
closed.mode = .closed
closed.report("lmnopqrstuv", open: false)
expect(closed.playerOverlayOpen && closed.playerOverlayVideoID == "abcdefghijk" && closed.updates == 0,
       "offstage messages are ignored")

let drag = Stage()
drag.dragging = true
drag.report("lmnopqrstuv", open: true)
expect(!drag.dragging && drag.endDrags == 1 && drag.settlements == 1,
       "current visible sheet cancels an in-flight native drag")
drag.playerMoved()
expect(drag.playerOverlayOpen && drag.settlements == 1, "KVO cannot release the drag's new sheet lock")
print("NATIVE_PLAYER_OVERLAY_IDENTITY_OK")
`;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "langform-native-overlay-"));
  try {
    const script = path.join(temporary, "OverlayIdentity.swift");
    fs.writeFileSync(script, exercise);
    const result = spawnSync(compiler.stdout.trim(), [script], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_PLAYER_OVERLAY_IDENTITY_OK/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
