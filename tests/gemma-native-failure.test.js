const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function declaration(source, marker) {
  const start = source.indexOf(marker), opening = source.indexOf('{', start);
  assert.ok(start >= 0, marker);
  let depth = 1;
  for (let i = opening + 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail('Unclosed ' + marker);
}

test('tatsächlicher Engine-Fehlweg kopiert nativen Threadstatus/Text und löscht exakt einmal vor Journal/Diagnose', { timeout: 90000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-native-failure-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const runtime = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/GemmaRuntime.swift'), 'utf8');
  const actual = ['enum GemmaRuntimeError:', 'struct GemmaNativeFailure:', 'private final class GemmaNativeEngine:']
    .map(marker => declaration(runtime, marker)).join('\n');
  const leaseSource = path.join(__dirname, '../ios/Langform/Langform/GemmaRuntimeCache.swift');
  // Substitute only the default cache location, keeping the shipping lease
  // and native constructor logic intact and away from the user's real caches.
  assert.equal((actual.match(/GemmaRuntimeCacheLease\.acquire\(\)/g) || []).length, 1);
  const isolated = actual.replace('GemmaRuntimeCacheLease.acquire()',
    'GemmaRuntimeCacheLease.acquire(root: URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true))');
  const file = path.join(directory, 'Failure.swift');
  fs.writeFileSync(file, String.raw`
import Foundation
import Darwin
private enum Native {
  static var mode = ""
  static var events: [String] = []
  static var code: Int32 = 0
  static let text = UnsafeMutablePointer<CChar>.allocate(capacity: 2048)
  static var missingMessage = false
  static var owner: Thread?
  static var diagnostic: (Int, String, String)?
  static func fail() {
    owner = Thread.current
    code = 2
    let bytes = Array("UNKNOWN: mmap ENOMEM\nFailed to allocate aligned memory /private/model-cache".utf8CString)
    for (i, byte) in bytes.enumerated() { text[i] = byte }
  }
  static func checkThread() { precondition(Thread.current === owner, "Native TLS status must be captured on the failing C thread") }
  static func clobber() {
    code = 13
    let bytes = Array("WRONG_AFTER_JOURNAL".utf8CString)
    for (i, byte) in bytes.enumerated() { text[i] = byte }
  }
}
private let kLiteRtLmActivationDataTypeFloat32: Int32 = 1
private struct ModelInfo {
  init(throwingModelPath: String) throws {}
  func maxContextTokens() -> Int { 8192 }
  func isDynamicContext() -> Bool { false }
}
private enum GemmaDiagnosticTrace {
  static func record(_ stage: String) {}
  static func recordNativeFailure(code: Int, message: String, stage: String) {
    Native.events.append("diagnostic")
    Native.diagnostic = (code, message, stage)
    Native.clobber()
  }
}
private enum GemmaRuntimeLoadJournal {
  enum Code { case modelMissing, modelMetadataFailed, unknownContext, nativeSettingsFailed, cacheUnavailable, nativeCreateFailed }
  static func record(_ code: Code, backend: String, contextTokens: Int?, engineLoaded: Bool, nativeStatusCode: Int? = nil) {
    Native.events.append("journal")
    precondition(nativeStatusCode == 2)
    Native.clobber()
  }
}
private func litert_lm_get_last_error_code() -> Int32 {
  Native.checkThread(); Native.events.append("code"); return Native.code
}
private func litert_lm_get_last_error_message() -> UnsafePointer<CChar>? {
  Native.checkThread(); Native.events.append("message"); return Native.missingMessage ? nil : UnsafePointer(Native.text)
}
private func litert_lm_clear_last_error() {
  Native.checkThread(); Native.events.append("clear"); Native.code = 0
  // Invalidate the actual returned C buffer to detect retaining its pointer
  // rather than copying its text before clear or Foundation logging.
  Native.text[0] = 0
}
private func gemmaNativeError(_ fallback: String) -> String { GemmaNativeFailure.capture(fallback).message }
private func litert_lm_engine_settings_create(_ path: String, _ backend: String, _ vision: String?, _ audio: String?) -> OpaquePointer? {
  if Native.mode == "settings" { Native.fail(); return nil }
  return OpaquePointer(bitPattern: 1)
}
private func litert_lm_engine_settings_delete(_ p: OpaquePointer) {}
private func litert_lm_engine_settings_set_max_num_tokens(_ p: OpaquePointer, _ n: Int32) {}
private func litert_lm_engine_settings_enable_benchmark(_ p: OpaquePointer) {}
private func litert_lm_engine_settings_set_activation_data_type(_ p: OpaquePointer, _ n: Int32) {}
private func litert_lm_engine_settings_set_prefill_chunk_size(_ p: OpaquePointer, _ n: Int32) {}
private func litert_lm_engine_settings_set_cache_dir(_ p: OpaquePointer, _ path: String) {}
private func litert_lm_engine_create(_ p: OpaquePointer) -> OpaquePointer? { Native.fail(); return nil }
private func litert_lm_engine_delete(_ p: OpaquePointer) {}
private func litert_lm_engine_tokenize(_ p: OpaquePointer, _ text: String) -> OpaquePointer? { nil }
private func litert_lm_tokenize_result_delete(_ p: OpaquePointer) {}
private func litert_lm_tokenize_result_get_num_tokens(_ p: OpaquePointer) -> Int32 { 0 }
` + isolated + String.raw`
@main struct FailureExercise {
  static func main() throws {
    let model = URL(fileURLWithPath: CommandLine.arguments[1])
    try Data("model".utf8).write(to: model)
    for mode in ["settings", "engine", "missingMessage"] {
      Native.mode = mode; Native.events = []; Native.diagnostic = nil
      Native.missingMessage = mode == "missingMessage"
      let expected = Native.missingMessage ? "Engine konnte nicht geladen werden" : "UNKNOWN: mmap ENOMEM\nFailed to allocate aligned memory /private/model-cache"
      do {
        _ = try GemmaNativeEngine(modelURL: model, backend: "cpu", verifiedContextTokens: 8192)
        preconditionFailure("The controlled failed C creation unexpectedly succeeded")
      } catch GemmaRuntimeError.modelUnavailable(let message) {
        precondition(message == expected, "Thrown failure lost the exact captured native detail")
      }
      precondition(Native.events == ["code", "message", "clear", "journal", "diagnostic"],
        "Read status and copy text on the failing thread, clear once, then permit logging")
      precondition(Native.diagnostic?.0 == 2 && Native.diagnostic?.1 == expected
        && Native.diagnostic?.2 == (mode == "settings" ? "engine.settings" : "engine.create"))
    }
    print("GEMMA_NATIVE_FAILURE_CAPTURE_OK")
  }
}
`);
  const binary = path.join(directory, 'failure');
  const build = spawnSync('xcrun', ['swiftc', '-parse-as-library', '-module-cache-path', path.join(directory, 'modules'),
    file, leaseSource, '-o', binary], { encoding: 'utf8', timeout: 70000 });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const run = spawnSync(binary, [path.join(directory, 'model.litertlm'), path.join(directory, 'cache-root')], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /GEMMA_NATIVE_FAILURE_CAPTURE_OK/);
});

test('nativer Fehlertext wird nur mit vollständigem Diagnose-Opt-in und festem Engine-Stufennamen exportiert', { timeout: 90000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-native-failure-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/GemmaRuntime.swift'), 'utf8');
  const harness = path.join(directory, 'FailureGate.swift');
  fs.writeFileSync(harness, 'import Foundation\n' + declaration(source, 'enum GemmaDiagnosticTrace') + String.raw`
@main struct FailureGate {
  static func main() {
    GemmaDiagnosticTrace.recordNativeFailure(code: 2,
      message: "UNKNOWN: mmap ENOMEM\nFailed to allocate aligned memory /private/model-cache",
      stage: CommandLine.arguments[2], directory: URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true))
  }
}
`);
  const binary = path.join(directory, 'gate');
  const build = spawnSync('xcrun', ['swiftc', '-swift-version', '6', '-parse-as-library', '-module-cache-path',
    path.join(directory, 'modules'), harness, '-o', binary], { encoding: 'utf8', timeout: 70000 });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const clean = { ...process.env };
  delete clean.LANGFORM_GEMMA_PROBE;
  delete clean.LANGFORM_SUMMARY_HOST_PROBE;
  const cases = [
    [[], {}, false], [['--langform-gemma-diagnostic'], {}, false], [[], { LANGFORM_GEMMA_PROBE: '1' }, false],
    [['--langform-gemma-diagnostic'], { LANGFORM_GEMMA_PROBE: 'true' }, false],
    [['--langform-gemma-diagnostic'], { LANGFORM_GEMMA_PROBE: '1' }, true],
    [['--langform-summary-host-probe'], {}, false], [[], { LANGFORM_SUMMARY_HOST_PROBE: '1' }, false],
    [['--langform-summary-host-probe'], { LANGFORM_SUMMARY_HOST_PROBE: 'true' }, false],
    [['--langform-summary-host-probe'], { LANGFORM_SUMMARY_HOST_PROBE: '1' }, true]
  ];
  for (const [index, [args, env, allowed]] of cases.entries()) {
    for (const stage of ['engine.settings', 'engine.create', 'engine.create PRIVATE SOURCE', '../source', 'stream.start']) {
      const output = path.join(directory, `run-${index}-${stage.replace(/\W/g, '_')}`);
      const run = spawnSync(binary, [output, stage, ...args], { env: { ...clean, ...env }, encoding: 'utf8', timeout: 5000 });
      assert.equal(run.status, 0, run.stdout + run.stderr);
      if (!allowed || !['engine.settings', 'engine.create'].includes(stage)) {
        assert.equal(fs.existsSync(output), false, 'No ordinary/partial opt-in/invalid-stage error content may be persisted');
        continue;
      }
      const report = JSON.parse(fs.readFileSync(path.join(output, 'native-failure.json'), 'utf8'));
      assert.deepEqual(Object.keys(report).sort(), ['message', 'nativeStatusCode', 'processID', 'schemaVersion', 'stage', 'timestamp']);
      assert.equal(report.nativeStatusCode, 2);
      assert.equal(report.stage, stage);
      assert.equal(report.message, 'UNKNOWN: mmap ENOMEM\nFailed to allocate aligned memory /private/model-cache');
      assert.ok(Number.isInteger(report.processID) && report.processID > 0);
      assert.deepEqual(fs.readdirSync(output), ['native-failure.json']);
    }
  }
});
