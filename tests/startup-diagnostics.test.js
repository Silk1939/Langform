const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Diagnose-Logging wartet nicht auf den Writer und bewahrt Reihenfolge und Erfassungszeit", {
  skip: process.platform !== "darwin", timeout: 70000,
}, function (t) {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/StartupDiagnostics.swift"), "utf8");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-startup-diagnostics-"));
  const filename = `${path.basename(directory)}.jsonl`;
  const exercise = `
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }
extension StartupDiagnostics {
    static var testFile: URL { fileURL }
    static var capturedAt: Double { (ProcessInfo.processInfo.systemUptime - origin) * 1000 }
    static func holdWriter(_ gate: DispatchSemaphore, _ started: DispatchSemaphore) {
        writer.async { started.signal(); gate.wait() }
    }
    static func drainWriter() { writer.sync {} }
}
let nativeEvent = PlayerDiagnosticEvent.sanitized(["event": "webkitbeginfullscreen", "target": "media", "nativeVideoFullscreen": true, "documentFullscreen": false, "privateTitle": "never persist"])!
expect(nativeEvent["nativeVideoFullscreen"] as? Bool == true && nativeEvent["documentFullscreen"] as? Bool == false && nativeEvent["privateTitle"] == nil, "native fullscreen states pass without arbitrary data")
let apiEvent = PlayerDiagnosticEvent.sanitized(["event": "fullscreen-api", "target": "media", "fullscreenAPI": "webkitEnterFullscreen", "apiIntercepted": false, "nativeDragging": true, "nativeMini": true])!
expect(apiEvent["fullscreenAPI"] as? String == "webkitEnterFullscreen" && apiEvent["apiIntercepted"] as? Bool == false, "fixed fullscreen API trace survives the native boundary")
let invalidAPI = PlayerDiagnosticEvent.sanitized(["event": "fullscreen-api", "target": "media", "fullscreenAPI": "privateTitle"])!
expect(invalidAPI["fullscreenAPI"] == nil, "unknown API string is not persisted")
let gate = DispatchSemaphore(value: 0), started = DispatchSemaphore(value: 0)
let sentinel = Data("old trace".utf8)
try sentinel.write(to: StartupDiagnostics.testFile)
defer { try? FileManager.default.removeItem(at: StartupDiagnostics.testFile) }
StartupDiagnostics.holdWriter(gate, started)
expect(started.wait(timeout: .now() + 2) == .success, "writer can be held independently of UI callbacks")
StartupDiagnostics.begin()
StartupDiagnostics.mark("native-layout", once: true)
StartupDiagnostics.mark("native-layout", once: true)
StartupDiagnostics.videoMark(["event": "video-requested", "request": 1, "milliseconds": 0])
StartupDiagnostics.playerEvents([["event": "play", "target": "media"], ["event": "pause", "target": "media"]])
let capturedThrough = StartupDiagnostics.capturedAt
expect(try Data(contentsOf: StartupDiagnostics.testFile) == sentinel, "begin and callbacks never perform inline file writes")
gate.signal()
StartupDiagnostics.drainWriter()
if StartupDiagnostics.enabled {
    let lines = try String(contentsOf: StartupDiagnostics.testFile, encoding: .utf8).split(separator: "\\n")
    let rows = try lines.map { try JSONSerialization.jsonObject(with: Data($0.utf8)) as! [String: Any] }
    expect(rows.map { $0["event"] as! String } == ["app-init", "native-layout", "video-requested", "play", "pause"], "truncation, once marker and event batches preserve FIFO order")
    expect(rows[0]["processID"] as? Int == Int(ProcessInfo.processInfo.processIdentifier), "process identity survives serialization")
    for row in [rows[0], rows[1]] { expect((row["milliseconds"] as! Double) <= capturedThrough, "milestones use capture time rather than writer execution time") }
    for row in rows.suffix(2) { expect((row["receivedMilliseconds"] as! Double) <= capturedThrough, "player events use receive time rather than writer execution time") }
} else {
    expect(!FileManager.default.fileExists(atPath: StartupDiagnostics.testFile.path), "normal launch asynchronously removes old diagnostics and records nothing")
}
print("STARTUP_DIAGNOSTICS_OK")
`;
  try {
    const file = path.join(directory, "Diagnostics.swift");
    fs.writeFileSync(file, source.replace('"langform-startup.jsonl"', JSON.stringify(filename)) + "\n" + exercise);
    for (const enabled of ["1", "0"]) {
      const result = spawnSync(compiler.stdout.trim(), ["-swift-version", "5", file], {
        encoding: "utf8", timeout: 30000,
        env: { ...process.env, LANGFORM_DIAGNOSTICS: enabled, LANGFORM_PLAYER_TRACE: "1" },
      });
      assert.equal(result.error, undefined, String(result.error));
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /STARTUP_DIAGNOSTICS_OK/);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("Log-Kopie ignoriert unvollständige Schlusszeilen einschließlich abgeschnittener UTF-8-Zeichen", function () {
  const result = spawnSync("python3", ["-c", `
import sys, tempfile
from pathlib import Path
sys.path.insert(0, 'scripts')
from diagnostics.trace import read_trace_rows
with tempfile.TemporaryDirectory() as directory:
    target = Path(directory) / 'trace.jsonl'
    target.write_bytes(b'{"event":"ready"}\\n{"event":"partial')
    assert read_trace_rows(target) == [{'event': 'ready'}]
    target.write_bytes(b'{"event":"ready"}\\n{"event":"' + 'ä'.encode()[:1])
    assert read_trace_rows(target) == [{'event': 'ready'}]
    target.write_bytes(b'{"event":"ready"}\\n{"event":"done"}')
    assert read_trace_rows(target) == [{'event': 'ready'}]
    target.write_bytes(b'{"event":"ready"}\\n\\n{"event":"done"}\\n')
    assert read_trace_rows(target) == [{'event': 'ready'}, {'event': 'done'}]
    target.write_bytes(b'broken\\n')
    try: read_trace_rows(target)
    except ValueError: pass
    else: raise AssertionError('complete corrupt rows must not be hidden')
print('TRACE_READER_OK')
`], { cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 10000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /TRACE_READER_OK/);
});
