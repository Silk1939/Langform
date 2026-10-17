const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Video-Probe bleibt explizit opt-in, identitätsgebunden, einmalig und nach Abbruch dauerhaft still", {
  skip: process.platform !== "darwin",
  timeout: 70000,
}, function (t) {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swiftc"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Der Video-Probe-Test benötigt die Swift-Toolchain.");
  const sdk = spawnSync("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" });
  assert.equal(sdk.status, 0, sdk.stdout + sdk.stderr);
  const source = path.join(__dirname, "../ios/Langform/Langform/VideoLoadProbe.swift");
  const exercise = `
import Foundation
func expect(_ condition: Bool, _ message: String) {
    if !condition { print("FAILED: " + message); exit(1) }
}
func plan(_ raw: String = "[\\"abcdefghijk\\",\\"lmnopqrstuv\\"]") -> VideoLoadProbe {
    VideoLoadProbe(environment: ["LANGFORM_DIAGNOSTICS": "1", "LANGFORM_VIDEO_PROBE": raw])!
}
let validJSON = "[\\"abcdefghijk\\"]"
for diagnostics in [nil, "0", "true", " 1", "1 "] as [String?] {
    var environment = ["LANGFORM_VIDEO_PROBE": validJSON]
    environment["LANGFORM_DIAGNOSTICS"] = diagnostics
    expect(VideoLoadProbe(environment: environment) == nil, "no probe without exact diagnostic opt-in")
}
expect(VideoLoadProbe(environment: ["LANGFORM_DIAGNOSTICS": "1"]) == nil, "diagnostics alone never opens a video")
for raw in ["", "not-json", "[]", "{}", "null", "1", "true", "\\"abcdefghijk\\"", "[1]", "[null]", "[true]",
            "[\\"abcdefghijk\\",1]", "[\\"abcdefghijk\\",\\"lmnopqrstuv\\",\\"A_bC-d01234\\"]"] {
    expect(VideoLoadProbe(environment: ["LANGFORM_DIAGNOSTICS": "1", "LANGFORM_VIDEO_PROBE": raw]) == nil,
           "malformed or unbounded configuration stays disabled")
}
for id in ["abcdefghij", "abcdefghijkl", "abcdefghij ", "abcdefghij/", "abcdefghij&", "abcdefghij.", "abcdefghijä", "abcdefghij😀"] {
    let raw = String(data: try! JSONSerialization.data(withJSONObject: [id]), encoding: .utf8)!
    expect(VideoLoadProbe(environment: ["LANGFORM_DIAGNOSTICS": "1", "LANGFORM_VIDEO_PROBE": raw]) == nil,
           "IDs require exactly eleven ASCII alphanumeric, underscore or dash bytes")
}
expect(VideoLoadProbe(environment: ["LANGFORM_DIAGNOSTICS": "1", "LANGFORM_VIDEO_PROBE": "[\\"A_bC-d01234\\"]"]) != nil,
       "uppercase, underscore, dash and digits remain valid")
expect(VideoLoadProbe.timeoutSeconds == 30, "caller deadline never exceeds thirty seconds")
let audioBase = ["LANGFORM_DIAGNOSTICS":"1", "LANGFORM_VIDEO_PROBE":validJSON, "LANGFORM_VIDEO_PROBE_PLAY":"1"]
for flag in [nil, "0", "true", " 1", "1 "] as [String?] {
    var env = audioBase; env["LANGFORM_VIDEO_PROBE_AUDIO"] = flag
    expect(!VideoLoadProbe(environment:env)!.requestsAudibleUserOpen, "ordinary diagnostic playback remains silent")
}
var audioEnv = audioBase; audioEnv["LANGFORM_VIDEO_PROBE_AUDIO"] = "1"
expect(VideoLoadProbe(environment:audioEnv)!.requestsAudibleUserOpen, "single valid exact AUDIO plus PLAY opts into ordinary audible user-open")
audioEnv["LANGFORM_VIDEO_PROBE_PLAY"] = "0"
expect(!VideoLoadProbe(environment:audioEnv)!.requestsAudibleUserOpen, "audio alone cannot enable an audible open")
audioEnv["LANGFORM_VIDEO_PROBE_PLAY"] = "1"
audioEnv["LANGFORM_VIDEO_PROBE"] = "[\\"abcdefghijk\\",\\"lmnopqrstuv\\"]"
expect(!VideoLoadProbe(environment:audioEnv)!.requestsAudibleUserOpen, "multi-video diagnostic plans remain silent")
for flag in [nil, "0", "true", " 1", "1 "] as [String?] {
    var env = ["LANGFORM_DIAGNOSTICS":"1", "LANGFORM_VIDEO_PROBE":validJSON]
    env["LANGFORM_VIDEO_PROBE_PLAY"] = flag
    var passive = VideoLoadProbe(environment:env)!
    _ = passive.start(feedReady:true)
    expect(!passive.requestsNativeStart && !passive.claimNativeStart(videoID:"abcdefghijk",requestNumber:1),
           "native Start remains disabled without its exact opt-in")
}
var explicit = VideoLoadProbe(environment:["LANGFORM_DIAGNOSTICS":"1", "LANGFORM_VIDEO_PROBE":"[\\"abcdefghijk\\",\\"abcdefghijk\\"]", "LANGFORM_VIDEO_PROBE_PLAY":"1"])!
expect(!explicit.claimNativeStart(videoID:"abcdefghijk",requestNumber:1), "no Start before request begins")
_ = explicit.start(feedReady:true)
expect(!explicit.claimNativeStart(videoID:"lmnopqrstuv",requestNumber:1) && !explicit.claimNativeStart(videoID:"abcdefghijk",requestNumber:2),
       "wrong ID and request number never consume native Start")
expect(explicit.claimNativeStart(videoID:"abcdefghijk",requestNumber:1) && !explicit.claimNativeStart(videoID:"abcdefghijk",requestNumber:1),
       "exactly one native Start per active request")
_ = explicit.timedOut(requestNumber:1)
expect(!explicit.claimNativeStart(videoID:"abcdefghijk",requestNumber:1) && explicit.claimNativeStart(videoID:"abcdefghijk",requestNumber:2),
       "same-ID next request has its own claim; stale request remains rejected")
explicit.cancel()
expect(!explicit.claimNativeStart(videoID:"abcdefghijk",requestNumber:2), "cancelled probe remains inert")

var sequence = plan()
expect(sequence.state == .waitingForFeed && sequence.pending == nil, "initial plan has no request")
expect(sequence.start(feedReady: false) == nil, "loading feed never starts a probe")
expect(sequence.reportedPlaying(videoID: "abcdefghijk", mediaReady: true, requestNumber: 1) == nil,
       "unsolicited playback before start cannot issue a URL")
expect(sequence.timedOut(requestNumber: 1) == nil, "no deadline before an issued request")
let first = sequence.start(feedReady: true)!
expect(first.number == 1 && first.url.absoluteString == "https://m.youtube.com/watch?v=abcdefghijk",
       "first ready feed produces exactly the first normal watch URL")
expect(sequence.start(feedReady: true) == nil && sequence.pending == first, "repeated feed ready never restarts")
expect(sequence.reportedPlaying(videoID: "lmnopqrstuv", mediaReady: true, requestNumber: 1) == nil,
       "wrong video identity cannot advance")
expect(sequence.reportedPlaying(videoID: "abcdefghijk", mediaReady: false, requestNumber: 1) == nil,
       "a page identity with unready media cannot advance")
expect(sequence.reportedPlaying(videoID: "abcdefghijk", mediaReady: true, requestNumber: 2) == nil,
       "wrong request number cannot advance")
expect(sequence.timedOut(requestNumber: 0) == nil && sequence.pending == first, "stale deadline leaves current request intact")
let second = sequence.reportedPlaying(videoID: "abcdefghijk", mediaReady: true, requestNumber: 1)!
expect(second.number == 2 && second.url.absoluteString == "https://m.youtube.com/watch?v=lmnopqrstuv",
       "identity-confirmed ready and playing issues only the next URL")
expect(sequence.reportedPlaying(videoID: "abcdefghijk", mediaReady: true, requestNumber: 1) == nil,
       "repeated playing does not finish the next request")
expect(sequence.timedOut(requestNumber: 1) == nil && sequence.pending == second, "old timeout cannot skip the second video")
expect(sequence.reportedPlaying(videoID: "lmnopqrstuv", mediaReady: true, requestNumber: 2) == nil,
       "last successful report issues no third URL")
expect(sequence.state == .finished && sequence.pending == nil, "successful plan ends")
expect(sequence.start(feedReady: true) == nil && sequence.timedOut(requestNumber: 2) == nil,
       "completed plan never loops")

var timeoutSequence = plan()
_ = timeoutSequence.start(feedReady: true)
expect(timeoutSequence.timedOut(requestNumber: 1)?.number == 2, "timeout can try only the remaining video")
expect(timeoutSequence.timedOut(requestNumber: 1) == nil, "repeated first timeout is harmless")
expect(timeoutSequence.timedOut(requestNumber: 2) == nil && timeoutSequence.state == .finished,
       "last timeout stops permanently")

for initialRequests in [0, 1, 2] {
    var cancelled = plan()
    if initialRequests > 0 { _ = cancelled.start(feedReady: true) }
    if initialRequests > 1 { _ = cancelled.timedOut(requestNumber: 1) }
    cancelled.cancel(); cancelled.cancel()
    expect(cancelled.state == .cancelled && cancelled.pending == nil, "manual or inactive cancellation is idempotent")
    expect(cancelled.start(feedReady: true) == nil && cancelled.timedOut(requestNumber: initialRequests) == nil,
           "cancelled plans cannot be restarted by feed or timer")
    expect(cancelled.reportedPlaying(videoID: "abcdefghijk", mediaReady: true, requestNumber: 1) == nil,
           "late playback cannot revive a cancelled plan")
}

var single = plan(validJSON)
expect(single.start(feedReady: true)?.number == 1, "single-ID configuration issues one URL")
expect(single.reportedPlaying(videoID: "abcdefghijk", mediaReady: true, requestNumber: 1) == nil && single.state == .finished,
       "single video finishes after its successful report")
var singleTimeout = plan(validJSON)
_ = singleTimeout.start(feedReady: true)
expect(singleTimeout.timedOut(requestNumber: 1) == nil && singleTimeout.state == .finished && singleTimeout.pending == nil,
       "single video deadline cannot open an unconfigured second URL")
var sameID = plan("[\\"abcdefghijk\\",\\"abcdefghijk\\"]")
_ = sameID.start(feedReady: true)
expect(sameID.reportedPlaying(videoID: "abcdefghijk", mediaReady: true, requestNumber: 1)?.number == 2,
       "even repeated IDs have distinct request numbers")
expect(sameID.reportedPlaying(videoID: "abcdefghijk", mediaReady: true, requestNumber: 1) == nil && sameID.state == .waitingForVideo,
       "same-ID stale reports still cannot finish the next request")
print("VIDEO_LOAD_PROBE_OK")
`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-video-probe-test-"));
  try {
    const main = path.join(directory, "main.swift");
    const executable = path.join(directory, "VideoLoadProbeTest");
    fs.writeFileSync(main, exercise);
    const compile = spawnSync(compiler.stdout.trim(), ["-sdk", sdk.stdout.trim(), source, main, "-o", executable], {
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(compile.error, undefined, String(compile.error));
    assert.equal(compile.status, 0, compile.stdout + compile.stderr);
    const result = spawnSync(executable, [], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /VIDEO_LOAD_PROBE_OK/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
