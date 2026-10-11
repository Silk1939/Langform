const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Native Bedienprobe startet nur explizit und bestätigt jeden Schritt anhand beobachteter Zustände", {
  skip: process.platform !== "darwin",
  timeout: 70000,
}, function (t) {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swiftc"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Der Bedienprobe-Test benötigt die Swift-Toolchain.");
  const sdk = spawnSync("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" });
  assert.equal(sdk.status, 0, sdk.stdout + sdk.stderr);
  const app = path.join(__dirname, "../ios/Langform/Langform");
  const exercise = `
import Foundation
func expect(_ condition: Bool, _ message: String) {
    if !condition { print("FAILED: " + message); exit(1) }
}
let environment = ["LANGFORM_DIAGNOSTICS": "1", "LANGFORM_PLAYER_PROBE": "1", "LANGFORM_VIDEO_PROBE": "[\\"abcdefghijk\\"]"]
func plan() -> PlayerInteractionProbe { PlayerInteractionProbe(environment: environment)! }
func observation(_ mode: PlayerInteractionProbe.Mode = .expanded, playing: Bool = true,
                 hasVideo: Bool = true, ready: Bool = true, settled: Bool = true,
                 id: String? = "abcdefghijk", url: String? = "https://m.youtube.com/watch?v=abcdefghijk") -> PlayerInteractionProbe.Observation {
    .init(videoID: id, mode: mode, playing: playing, hasVideo: hasVideo, mediaReady: ready,
          settled: settled, url: url.flatMap { URL(string: $0) })
}
for key in ["LANGFORM_DIAGNOSTICS", "LANGFORM_PLAYER_PROBE", "LANGFORM_VIDEO_PROBE"] {
    var missing = environment; missing.removeValue(forKey: key)
    expect(PlayerInteractionProbe(environment: missing) == nil, "each opt-in input is required")
}
for raw in ["0", "true", " 1"] {
    var disabled = environment; disabled["LANGFORM_PLAYER_PROBE"] = raw
    expect(PlayerInteractionProbe(environment: disabled) == nil, "interaction opt-in requires exact one")
}
for raw in ["[]", "[1]", "[\\"abcdefghij\\"]", "[\\"abcdefghijk\\",\\"lmnopqrstuv\\"]"] {
    var bad = environment; bad["LANGFORM_VIDEO_PROBE"] = raw
    expect(PlayerInteractionProbe(environment: bad) == nil, "interaction requires exactly one validated video")
}
expect(PlayerInteractionProbe.timeoutSeconds == 4, "every caller deadline is bounded to four seconds")
var probe = plan()
for unready in [observation(.loading), observation(.mini), observation(playing: false), observation(hasVideo: false),
                observation(ready: false), observation(settled: false), observation(id: nil)] {
    expect(probe.start(observation: unready) == nil && probe.state == .waitingForPlayback,
           "ready playing identity and settled expanded mode are required together")
}
let first = probe.start(observation: observation())!
expect(first.ticket == 1 && first.step == .minimizePlaying && first.action == .minimize, "first confirmed playback issues native collapse once")
expect(probe.start(observation: observation()) == nil, "duplicate initial playing cannot start again")
expect(probe.observe(observation(.mini), ticket: 0) == nil && probe.pending == first, "stale callbacks cannot advance")
expect(probe.observe(observation(.expanded), ticket: 1) == nil, "requested action alone is not an observed minimize")
expect(probe.observe(observation(.mini, settled: false), ticket: 1) == nil, "optimistic destination mode during animation is insufficient")
expect(probe.observe(observation(.mini, hasVideo: false), ticket: 1) == nil, "missing video cannot prove minimize playback")
let pause = probe.observe(observation(.mini), ticket: 1)!
expect(pause.ticket == 2 && pause.step == .pauseMini && pause.action == .toggleMiniPlayback, "observed mini playback requests the existing toggle")
expect(probe.observe(observation(.mini), ticket: 2) == nil, "pause waits for actual nonplaying status")
expect(probe.observe(observation(.mini, playing: false), ticket: 1) == nil && probe.pending == pause, "old-step callback cannot pause-advance")
let expandPaused = probe.observe(observation(.mini, playing: false), ticket: 2)!
expect(expandPaused.step == .expandPaused && expandPaused.action == .expand, "confirmed pause expands with original action")
expect(probe.observe(observation(.expanded, playing: true), ticket: 3) == nil, "expanding must preserve pause")
let minimizePaused = probe.observe(observation(.expanded, playing: false), ticket: 3)!
expect(minimizePaused.step == .minimizePaused && minimizePaused.action == .minimize, "paused expanded mode can be minimized again")
expect(probe.observe(observation(.mini, playing: true), ticket: 4) == nil, "second minimize must preserve pause")
let resume = probe.observe(observation(.mini, playing: false), ticket: 4)!
expect(resume.step == .resumeMini && resume.action == .toggleMiniPlayback, "confirmed paused mini requests resume toggle")
expect(probe.observe(observation(.mini, playing: false), ticket: 5) == nil, "resume waits for actual playing")
let expandPlaying = probe.observe(observation(.mini), ticket: 5)!
expect(expandPlaying.step == .expandPlaying && expandPlaying.action == .expand, "playing mini expands")
expect(probe.observe(observation(.expanded, playing: false), ticket: 6) == nil, "playing expand cannot silently pause")
let close = probe.observe(observation(.expanded), ticket: 6)!
expect(close.step == .close && close.action == .close, "confirmed expanded playback requests close")
expect(probe.observe(observation(.closed, playing: true), ticket: 7) == nil, "closed native mode alone cannot prove stopped playback")
let verify = probe.observe(observation(.closed, playing: false), ticket: 7)!
expect(verify.ticket == 8 && verify.step == .verifyBlank && verify.action == .verifyBlank, "close is followed by a read-only blank check")
expect(probe.observe(observation(.closed, playing: false, hasVideo: false), ticket: 8) == nil,
       "cleared native media flag alone is insufficient without actual blank URL")
expect(probe.observe(observation(.closed, playing: false, hasVideo: true, id: nil, url: "about:blank"), ticket: 8) == nil,
       "blank URL with remaining video is insufficient")
expect(probe.observe(observation(.closed, playing: false, hasVideo: false, ready: false, id: nil, url: "about:blank"), ticket: 8) == nil,
       "final verification produces no further action")
expect(probe.state == .completed && probe.pending == nil, "only observed no-media blank finishes")
probe.timedOut(ticket: 8); probe.cancel()
expect(probe.state == .completed && probe.start(observation: observation()) == nil, "completed run never restarts")

var wrongStart = plan()
expect(wrongStart.start(observation: observation(id: "lmnopqrstuv")) == nil && wrongStart.state == .cancelled,
       "wrong initial video stops without touching it")
for url in [nil, "https://m.youtube.com/watch?v=lmnopqrstuv", "https://example.com/watch?v=abcdefghijk",
            "https://m.youtube.com/feed/library", "http://m.youtube.com/watch?v=abcdefghijk"] as [String?] {
    var staleURL = plan()
    expect(staleURL.start(observation: observation(url: url)) == nil && staleURL.state == .cancelled,
           "cached target ID cannot start against a missing or mismatching actual URL")
    var activeURL = plan(); _ = activeURL.start(observation: observation())
    expect(activeURL.observe(observation(.mini, url: url), ticket: 1) == nil && activeURL.state == .cancelled,
           "active media steps require current URL identity as well as the reported ID")
}
for host in ["m.youtube.com", "www.youtube.com", "youtube.com"] {
    var redirect = plan()
    expect(redirect.start(observation: observation(url: "https://" + host + "/watch?v=abcdefghijk&t=20")) != nil,
           "authorized YouTube host and irrelevant timestamp remain supported")
}
for step in 0...8 {
    var cancelled = plan()
    if step > 0 { _ = cancelled.start(observation: observation()) }
    let confirmed = [observation(.mini), observation(.mini, playing: false), observation(.expanded, playing: false),
                     observation(.mini, playing: false), observation(.mini), observation(.expanded), observation(.closed, playing: false)]
    if step > 1 { for ticket in 1..<step { _ = cancelled.observe(confirmed[ticket - 1], ticket: ticket) } }
    cancelled.cancel(); cancelled.cancel()
    expect(cancelled.state == .cancelled && cancelled.pending == nil, "manual or inactive cancellation works in every phase")
    expect(cancelled.start(observation: observation()) == nil && cancelled.observe(observation(.mini), ticket: step) == nil,
           "cancelled plan cannot be revived by callbacks")
    cancelled.timedOut(ticket: step)
    expect(cancelled.state == .cancelled, "late timeout cannot replace cancellation")
}
for missingIdentity in [nil, "lmnopqrstuv"] as [String?] {
    var mismatch = plan(); _ = mismatch.start(observation: observation())
    expect(mismatch.observe(observation(.mini, id: missingIdentity), ticket: 1) == nil && mismatch.state == .cancelled,
           "missing or mismatched active media identity stops actions")
}
for step in 1...8 {
    var bounded = plan(); _ = bounded.start(observation: observation())
    let confirmed = [observation(.mini), observation(.mini, playing: false), observation(.expanded, playing: false),
                     observation(.mini, playing: false), observation(.mini), observation(.expanded), observation(.closed, playing: false)]
    if step > 1 { for ticket in 1..<step { _ = bounded.observe(confirmed[ticket - 1], ticket: ticket) } }
    bounded.timedOut(ticket: step)
    expect(bounded.state == .timedOut && bounded.pending == nil, "each of eight step deadlines stops permanently")
    expect(bounded.observe(observation(.mini), ticket: step) == nil && bounded.start(observation: observation()) == nil,
           "late callbacks cannot revive any timed-out step")
}
var timeout = plan(); _ = timeout.start(observation: observation())
timeout.timedOut(ticket: 0)
expect(timeout.state == .running, "stale timeout does not stop current step")
timeout.timedOut(ticket: 1)
expect(timeout.state == .timedOut && timeout.pending == nil && timeout.observe(observation(.mini), ticket: 1) == nil,
       "current deadline stops instead of optimistically moving on")
print("PLAYER_INTERACTION_PROBE_OK")
`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-player-probe-test-"));
  try {
    const main = path.join(directory, "main.swift");
    const executable = path.join(directory, "PlayerInteractionProbeTest");
    fs.writeFileSync(main, exercise);
    const compile = spawnSync(compiler.stdout.trim(), ["-sdk", sdk.stdout.trim(),
      path.join(app, "VideoLoadProbe.swift"), path.join(app, "PlayerInteractionProbe.swift"), main, "-o", executable], {
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(compile.error, undefined, String(compile.error));
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    const result = spawnSync(executable, [], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PLAYER_INTERACTION_PROBE_OK/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
