const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Video-Zeitmarker trennen Anfragen, ignorieren alte Tickets und enthalten keine Nutzerdaten", {
  skip: process.platform !== "darwin", timeout: 70000,
}, function (t) {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/StartupDiagnostics.swift"), "utf8");
  const exercise = `
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }
var time = 10.004
var rows: [[String: Any]] = []
var recorder = VideoLoadDiagnostics(enabled: true, clock: { time }, emit: { rows.append($0) })
recorder.begin(ticket: 11, requestedAt: 10, playerExisted: false)
recorder.mark(.prepared, ticket: 11)
expect(rows.count == 2 && abs((rows[1]["milliseconds"] as! Double) - 4) < 0.001, "first creation belongs to request duration")
time = 10.25
recorder.mark(.documentCommit, ticket: 11)
for _ in 0..<100 { recorder.mark(.documentCommit, ticket: 11) }
expect(rows.count == 3, "each milestone writes once, never each frame")
recorder.mark(.playing, ticket: 10)
expect(rows.count == 3, "old request cannot mark new playback")
time = 12
recorder.begin(ticket: 12, requestedAt: 12, playerExisted: true)
expect(rows[3]["event"] as! String == "video-superseded", "unfinished old request is classified")
recorder.mark(.documentCommit, ticket: 11)
recorder.mark(.documentCommit, ticket: 12)
expect(rows.last!["request"] as! Int == 2 && rows.last!["milliseconds"] as! Double == 0, "second request has own origin and deduplication")
time = 12.4
recorder.mark(.playing, ticket: 12)
recorder.mark(.revealCompleted, ticket: 12)
recorder.mark(.mediaPresented, ticket: 11)
expect(rows.last!["event"] as! String == "video-reveal-completed", "old first-picture callback cannot mark this request")
time = 12.45
recorder.mark(.mediaPresented, ticket: 12)
recorder.mark(.mediaPresented, ticket: 12)
expect(rows.last!["event"] as! String == "video-media-presented" &&
       rows.filter { $0["event"] as? String == "video-media-presented" }.count == 1,
       "first compositor timing belongs to its own request and writes once even after playing")
let completed = rows.count
recorder.finish(.cancelled)
recorder.mark(.mediaReady, ticket: 12)
expect(rows.count == completed, "closing played video is not a failed startup; later callbacks ignored")
recorder.begin(ticket: 13, requestedAt: 12.4, playerExisted: true)
recorder.finish(.failed)
let failed = rows.count
recorder.finish(.cancelled)
recorder.mark(.playing, ticket: 13)
expect(rows.count == failed && rows.last!["event"] as! String == "video-failed", "failure has one terminal result")
let keys: Set<String> = ["request", "event", "milliseconds", "playerExisted"]
for row in rows { expect(Set(row.keys) == keys, "only sequence, event, time and creation state are emitted") }
var disabled = VideoLoadDiagnostics(enabled: false, clock: { fatalError("disabled diagnostics must not read clock") }, emit: { _ in fatalError("disabled diagnostics must not emit") })
disabled.begin(ticket: 1, requestedAt: 0, playerExisted: false)
disabled.mark(.prepared, ticket: 1)
disabled.finish(.failed)
let sanitized = PlayerDiagnosticEvent.sanitized(["event": "waiting", "target": "media", "paused": false,
    "bufferAhead": 0.25, "readyState": 2, "actualQuality": "medium", "currentTime": Double.nan,
    "href": "https://private.example", "title": "private title", "requestedCap": "private value"])!
expect(sanitized["bufferAhead"] as? Double == 0.25 && sanitized["paused"] as? Bool == false, "media evidence survives native boundary")
expect(sanitized["href"] == nil && sanitized["title"] == nil && sanitized["requestedCap"] == nil && sanitized["currentTime"] == nil, "unexpected strings and non-finite numbers never reach disk")
expect(PlayerDiagnosticEvent.sanitized(["event": "private text", "target": "media"]) == nil, "event labels are fixed")
expect(PlayerDiagnosticEvent.sanitized(["event": "click", "target": "private target"]) == nil, "target labels are fixed")
print("VIDEO_DIAGNOSTICS_OK")
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "langform-video-diagnostics-"));
  try {
    const file = path.join(dir, "Diagnostics.swift");
    fs.writeFileSync(file, source + "\n" + exercise);
    const result = spawnSync(compiler.stdout.trim(), [file], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /VIDEO_DIAGNOSTICS_OK/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
