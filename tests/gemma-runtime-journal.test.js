const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function declaration(source, marker) {
  const start = source.indexOf(marker), opening = source.indexOf('{', start);
  assert.ok(start >= 0);
  let depth = 1;
  for (let i = opening + 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail('Unclosed declaration: ' + marker);
}

test('tatsächliches Laufzeitjournal speichert feste Fehlerklassen und Speicherwerte atomisch ohne Quell-/Fehlertext', { timeout: 90000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-gemma-journal-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const runtime = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/GemmaRuntime.swift'), 'utf8');
  const journal = declaration(runtime, 'enum GemmaRuntimeLoadJournal');
  const threshold = runtime.match(/nonisolated static let minimumColdStartBytes: UInt64 = ([\d_]+)/)[1];
  const harness = path.join(directory, 'Journal.swift');
  fs.writeFileSync(harness, String.raw`
import Foundation
enum GemmaRuntime { static let minimumColdStartBytes: UInt64 = ` + threshold + String.raw` }
` + journal + String.raw`
@main struct JournalExercise {
  static func main() throws {
    let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let allowedKeys = Set(["schemaVersion", "code", "availableMemoryBytes", "requiredMemoryBytes", "physicalFootprintBytes",
      "processID", "buildNumber", "backend", "contextTokens", "engineLoaded", "timestamp"])
    let codes: [GemmaRuntimeLoadJournal.Code] = [.loadRequested, .loadAdmitted, .engineReused, .loadCoalesced,
      .loaded, .loadCancelled, .insufficientMemory, .gpuDisabled, .modelMissing, .modelMetadataFailed,
      .unknownContext, .nativeSettingsFailed, .nativeCreateFailed, .cacheUnavailable, .engineMissing]
    for code in codes {
      let snapshot = GemmaRuntimeLoadJournal.makeSnapshot(code: code, availableMemoryBytes: 2_400_000_000,
        physicalFootprintBytes: 321, backend: "PRIVATE_SOURCE native-error /private/model-path", contextTokens: 8192,
        engineLoaded: false, processID: 123, buildNumber: 91, timestamp: Date(timeIntervalSince1970: 0))
      GemmaRuntimeLoadJournal.persist(snapshot, directory: directory)
      let data = try Data(contentsOf: directory.appendingPathComponent("last-load.json"))
      let object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
      let text = String(decoding: data, as: UTF8.self)
      precondition(Set(object.keys) == allowedKeys && object["code"] as? String == code.rawValue)
      precondition(object["requiredMemoryBytes"] as? UInt64 == 2_500_000_000 && object["backend"] as? String == "unknown")
      precondition(object["timestamp"] as? String == "1970-01-01T00:00:00Z")
      precondition(!text.contains("PRIVATE_SOURCE") && !text.contains("native-error") && !text.contains("/private/model-path"),
        "The only free-text input must be normalized; no captions, output, path or raw native error belongs in the journal")
      let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
      let decoded = try decoder.decode(GemmaRuntimeLoadJournal.Snapshot.self, from: data)
      precondition(decoded.code == code && decoded.availableMemoryBytes == 2_400_000_000 && decoded.processID == 123)
    }
    let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
    precondition(files == ["last-load.json"], "The ordinary failure journal is bounded to one atomically replaced record")
    for (backend, expected) in [("CPU", "cpu"), ("gpu-fp32", "gpu"), ("other-provider", "unknown")] {
      let snapshot = GemmaRuntimeLoadJournal.makeSnapshot(code: .engineMissing, availableMemoryBytes: nil,
        physicalFootprintBytes: nil, backend: backend, contextTokens: nil, engineLoaded: false)
      precondition(snapshot.backend == expected)
    }
    for nativeCode in [-1, 0, 2, 8, 16, 17, Int.max] {
      let snapshot = GemmaRuntimeLoadJournal.makeSnapshot(code: .nativeCreateFailed, availableMemoryBytes: nil,
        physicalFootprintBytes: nil, backend: "cpu", contextTokens: 8192, engineLoaded: false,
        nativeStatusCode: nativeCode, processID: 123, buildNumber: 91)
      GemmaRuntimeLoadJournal.persist(snapshot, directory: directory)
      let data = try Data(contentsOf: directory.appendingPathComponent("last-load.json"))
      let object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
      if (0...16).contains(nativeCode) {
        precondition(snapshot.nativeStatusCode == nativeCode && object["nativeStatusCode"] as? Int == nativeCode)
        precondition(Set(object.keys) == allowedKeys.subtracting(["availableMemoryBytes", "physicalFootprintBytes"]).union(["nativeStatusCode"]))
      } else {
        precondition(snapshot.nativeStatusCode == nil && object["nativeStatusCode"] == nil,
          "The ordinary journal accepts only bounded numeric native status codes, never arbitrary native text")
      }
    }
    let blocked = directory.appendingPathComponent("not-a-directory")
    try Data("untouched".utf8).write(to: blocked)
    let snapshot = GemmaRuntimeLoadJournal.makeSnapshot(code: .nativeCreateFailed, availableMemoryBytes: nil,
      physicalFootprintBytes: nil, backend: "cpu", contextTokens: 8192, engineLoaded: false)
    GemmaRuntimeLoadJournal.persist(snapshot, directory: blocked)
    let untouched = try String(contentsOf: blocked, encoding: .utf8)
    precondition(untouched == "untouched", "A failed diagnostic write cannot replace the original runtime outcome")
    print("GEMMA_RUNTIME_JOURNAL_PRIVACY_OK")
  }
}
`);
  const binary = path.join(directory, 'journal');
  const build = spawnSync('xcrun', ['swiftc', '-swift-version', '6', '-parse-as-library',
    '-module-cache-path', path.join(directory, 'modules'), harness, '-o', binary], { encoding: 'utf8', timeout: 70000 });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const run = spawnSync(binary, [path.join(directory, 'records')], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /GEMMA_RUNTIME_JOURNAL_PRIVACY_OK/);
});
