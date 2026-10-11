const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Native Startanzeige trennt Puffern, Ablehnung und ausdrücklich angefordertes Neuladen", {
  skip: process.platform !== "darwin",
  timeout: 70000,
}, function (t) {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Der Startstatus-Test benötigt die Swift-Toolchain.");
  const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/PlayerStartupStatus.swift"), "utf8");
  const exercise = `
func expect(_ condition: Bool, _ message: String) {
    if !condition { print("FAILED: " + message); exit(1) }
}
var status = PlayerStartupStatus()
expect(status.keepsStartupPoster && !status.hasPresentedPicture, "new video keeps the tapped poster")
status.receive(state: "playing", issue: "", hasVideo: true)
expect(status.keepsStartupPoster, "playing is not proof of a video frame on screen")
status.receivePicture(mediaPresented: false, mediaReady: true, frameObservationSupported: true)
expect(status.keepsStartupPoster, "decoding retains the poster while compositor confirmation is available")
status.receivePicture(mediaPresented: true, mediaReady: true, frameObservationSupported: true)
expect(!status.keepsStartupPoster && status.hasPresentedPicture, "one matching presented frame releases the poster")
status.receivePicture(mediaPresented: nil, mediaReady: nil, frameObservationSupported: nil)
status.receivePicture(mediaPresented: false, mediaReady: false, frameObservationSupported: false)
expect(!status.keepsStartupPoster, "partial reports and later buffering cannot resurrect startup decoration")
status = PlayerStartupStatus()
status.receivePicture(mediaPresented: false, mediaReady: false, frameObservationSupported: false)
expect(status.keepsStartupPoster, "absence of an observer alone does not prove a picture")
status.receivePicture(mediaPresented: false, mediaReady: true, frameObservationSupported: false)
expect(!status.keepsStartupPoster, "older WebKit can release its poster when a real image has decoded")
status = PlayerStartupStatus()
expect(status.needsMediaTimeout && status.showsSpinner && !status.showsButton, "transient missing media shows loading while it gets time to initialize")
status.missingMediaTimedOut()
expect(status.showsButton && status.requiresReload && status.buttonTitle == "Neu laden", "permanently missing media offers explicit reload")
status.receive(state: "unavailable", issue: "", hasVideo: false)
expect(status.showsButton && status.requiresReload && !status.needsMediaTimeout, "empty repeated reports cannot erase recovery or loop timers")
status.receive(state: "playing", issue: "", hasVideo: true)
expect(!status.showsButton && !status.showsSpinner && !status.requiresReload, "late real media recovers without reload")

status.receive(state: "unstarted", issue: "", hasVideo: true)
expect(status.showsButton && status.buttonTitle == "Video starten" && !status.requiresReload,
       "unstarted media always offers explicit play even with hidden web controls")
status.missingMediaTimedOut()
expect(status.state == .unstarted && !status.requiresReload, "stale absent-media deadline cannot replace a real player")
status.receive(state: "buffering", issue: "", hasVideo: true)
expect(status.showsSpinner && !status.showsButton, "buffering shows progress without a fake pause")
status.receive(state: "buffering", issue: "timeout", hasVideo: true)
expect(status.showsButton && !status.showsSpinner && !status.requiresReload && status.buttonTitle == "Erneut starten",
       "buffering deadline offers user-controlled retry, not forced reload")
status.receive(state: "failed", issue: "rejected", hasVideo: true)
expect(status.showsButton && !status.requiresReload, "rejected play remains a visible play retry")
let failedRequest = status.beginPlayRequest()
status.playRequestFailed(request: failedRequest)
expect(status.showsButton && !status.showsSpinner && status.buttonTitle == "Erneut starten" && status.issue == "rejected",
       "false or failed native bridge requests offer explicit retry")
let oldRequest = status.beginPlayRequest()
let newRequest = status.beginPlayRequest()
status.receive(state: "unstarted", issue: "", hasVideo: true)
status.playRequestFailed(request: oldRequest)
expect(status.state == .unstarted, "a failed old evaluation cannot replace a newer explicit request")
status.playRequestFailed(request: newRequest)
expect(status.state == .failed, "the current request still exposes its failure")
for terminal in ["playing", "paused", "ended"] {
    let request = status.beginPlayRequest()
    status.receive(state: terminal, issue: "", hasVideo: true)
    status.playRequestFailed(request: request)
    expect(status.state.rawValue == terminal && status.issue.isEmpty, "confirmed playback or pause supersedes a late native failure")
}
status.receive(state: "failed", issue: "media-error", hasVideo: true)
expect(status.showsButton && status.requiresReload && status.buttonTitle == "Neu laden", "fatal media error labels its full reload")
let mediaErrorRequest = status.beginPlayRequest()
status.receive(state: "failed", issue: "media-error", hasVideo: true)
status.playRequestFailed(request: mediaErrorRequest)
expect(status.requiresReload && status.issue == "media-error", "a late native failure cannot erase an authoritative fatal media error")
status.receive(state: "paused", issue: "", hasVideo: true)
expect(!status.showsButton && !status.showsSpinner && !status.requiresReload, "ordinary pause stays with YouTube controls")
status.receive(state: "ended", issue: "", hasVideo: true)
expect(!status.showsButton && !status.showsSpinner, "ended media keeps its normal replay interface")
status.receive(state: "malformed", issue: "media-error", hasVideo: true)
expect(status.state == .ended && !status.requiresReload, "unknown states cannot inject a reload action")
status = PlayerStartupStatus()
expect(status.needsMediaTimeout && !status.requiresReload, "new video clears all prior errors")
print("PLAYER_STARTUP_STATUS_OK")
`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-startup-test-"));
  try {
    const script = path.join(directory, "StartupStatus.swift");
    fs.writeFileSync(script, source + "\n" + exercise);
    const result = spawnSync(compiler.stdout.trim(), [script], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PLAYER_STARTUP_STATUS_OK/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
