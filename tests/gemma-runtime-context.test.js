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
  for (let index = opening + 1; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail('Unclosed declaration ' + marker);
}

// Only metadata responses and native C allocation boundaries are controlled.
// The shipping initializer must resolve the caller's budget and forward that
// exact value to native settings; no duplicated resolver decides the outcome.
test('tatsächlicher nativer Kontextvertrag erhält die geprüfte 8K-Grenze bei dynamischen Modellen und verwirft unzulässige feste Schrumpfung', { timeout: 90000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-gemma-context-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/GemmaRuntime.swift'), 'utf8');
  const actual = ['enum GemmaRuntimeError:', 'struct GemmaNativeFailure:', 'private final class GemmaNativeEngine:']
    .map(marker => declaration(source, marker)).join('\n');
  const leaseSource = path.join(__dirname, '../ios/Langform/Langform/GemmaRuntimeCache.swift');
  // Substitute only the default cache location, keeping the shipping lease
  // and native constructor logic intact and away from the user's real caches.
  assert.equal((actual.match(/GemmaRuntimeCacheLease\.acquire\(\)/g) || []).length, 1);
  const isolated = actual.replace('GemmaRuntimeCacheLease.acquire()',
    'GemmaRuntimeCacheLease.acquire(root: URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true))');
  const harness = path.join(directory, 'Context.swift');
  fs.writeFileSync(harness, String.raw`
import Foundation
private enum Metadata {
  static var supported = 0, dynamic = false
}
private struct ModelInfo {
  init(throwingModelPath: String) throws {}
  func maxContextTokens() -> Int { Metadata.supported }
  func isDynamicContext() -> Bool { Metadata.dynamic }
}
private enum Native {
  static var settingsCreated = 0, settingsDeleted = 0, enginesCreated = 0, enginesDeleted = 0
  static var configuredTokens: Int32?
  static var chunk: Int32?
  static var journal: [GemmaRuntimeLoadJournal.Code] = []
  static func reset() {
    settingsCreated = 0; settingsDeleted = 0; enginesCreated = 0; enginesDeleted = 0
    configuredTokens = nil; chunk = nil; journal = []
  }
}
private enum GemmaRuntimeLoadJournal {
  enum Code { case modelMissing, modelMetadataFailed, unknownContext, nativeSettingsFailed, cacheUnavailable, nativeCreateFailed }
  static func record(_ code: Code, backend: String, contextTokens: Int?, engineLoaded: Bool, nativeStatusCode: Int? = nil) {
    Native.journal.append(code)
  }
}
private enum GemmaDiagnosticTrace {
  static func record(_ stage: String) {}
  static func recordNativeFailure(code: Int, message: String, stage: String) {}
}
private let kLiteRtLmActivationDataTypeFloat32: Int32 = 1
private func litert_lm_get_last_error_code() -> Int32 { 0 }
private func litert_lm_get_last_error_message() -> UnsafePointer<CChar>? { nil }
private func litert_lm_clear_last_error() {}
private func gemmaNativeError(_ fallback: String) -> String { fallback }
private func litert_lm_engine_settings_create(_ path: String, _ backend: String, _ vision: String?, _ audio: String?) -> OpaquePointer? {
  precondition(backend == "cpu" && vision == nil && audio == nil)
  Native.settingsCreated += 1; return OpaquePointer(bitPattern: 1)
}
private func litert_lm_engine_settings_delete(_ p: OpaquePointer) { Native.settingsDeleted += 1 }
private func litert_lm_engine_settings_set_max_num_tokens(_ p: OpaquePointer, _ n: Int32) { Native.configuredTokens = n }
private func litert_lm_engine_settings_enable_benchmark(_ p: OpaquePointer) {}
private func litert_lm_engine_settings_set_activation_data_type(_ p: OpaquePointer, _ n: Int32) {}
private func litert_lm_engine_settings_set_prefill_chunk_size(_ p: OpaquePointer, _ n: Int32) { Native.chunk = n }
private func litert_lm_engine_settings_set_cache_dir(_ p: OpaquePointer, _ path: String) {}
private func litert_lm_engine_create(_ p: OpaquePointer) -> OpaquePointer? {
  precondition(Native.configuredTokens != nil)
  Native.enginesCreated += 1; return OpaquePointer(bitPattern: 2)
}
private func litert_lm_engine_delete(_ p: OpaquePointer) { Native.enginesDeleted += 1 }
private func litert_lm_engine_tokenize(_ p: OpaquePointer, _ text: String) -> OpaquePointer? { nil }
private func litert_lm_tokenize_result_delete(_ p: OpaquePointer) {}
private func litert_lm_tokenize_result_get_num_tokens(_ p: OpaquePointer) -> Int32 { 0 }
` + isolated + String.raw`
@main struct ContextExercise {
  static func main() throws {
    let model = URL(fileURLWithPath: CommandLine.arguments[1])
    try Data("controlled model metadata boundary".utf8).write(to: model)
    let cases: [(String, Int, Bool, Int?, Int?)] = [
      ("dynamic32768_verified8192", 32768, true, 8192, 8192),
      ("dynamic32768_verified16384", 32768, true, 16384, 16384),
      ("dynamic32768_no_hint", 32768, true, nil, 16384),
      ("dynamic8192_verified8192", 8192, true, 8192, 8192),
      ("dynamic8192_smaller_hint", 8192, true, 4096, 4096),
      ("dynamic4096_larger_cap", 4096, true, 8192, 4096),
      ("dynamic4096_no_hint", 4096, true, nil, 4096),
      ("dynamic32768_zero_hint", 32768, true, 0, nil),
      ("dynamic32768_negative_hint", 32768, true, -1, nil),
      ("dynamic32768_excessive_hint", 32768, true, 32768, nil),
      ("fixed8192_no_hint", 8192, false, nil, 8192),
      ("fixed8192_matching_hint", 8192, false, 8192, 8192),
      ("fixed8192_larger_cap", 8192, false, 16384, 8192),
      ("fixed8192_unsupported_shrink", 8192, false, 4096, nil),
      ("fixed8192_invalid_zero", 8192, false, 0, nil),
      ("fixed8192_invalid_large", 8192, false, 32768, nil),
      ("fixed32768_unsupported_shrink", 32768, false, 8192, nil),
      ("missing_metadata_verified8192", 0, false, 8192, 8192),
      ("missing_metadata_no_hint", 0, false, nil, nil),
      ("missing_metadata_invalid_hint", 0, false, 16385, nil)
    ]
    for (name, supported, dynamic, hint, expected) in cases {
      Native.reset(); Metadata.supported = supported; Metadata.dynamic = dynamic
      do {
        let engine = try GemmaNativeEngine(modelURL: model, backend: "cpu", verifiedContextTokens: hint)
        precondition(expected != nil, "Invalid context contract allocated native engine: " + name)
        precondition(engine.contextTokens == expected && Native.configuredTokens == Int32(expected!),
          "Native token setting exceeds the caller/model context contract: " + name)
        precondition(engine.verifiedContextTokens == hint)
        precondition(Native.settingsCreated == 1 && Native.settingsDeleted == 1 && Native.enginesCreated == 1)
        precondition(Native.chunk == 256 && Native.journal.isEmpty)
        engine.close()
        precondition(Native.enginesDeleted == 1)
      } catch GemmaRuntimeError.modelUnavailable(let message) {
        precondition(expected == nil && !message.isEmpty, "A supported context contract failed: " + name)
        precondition(Native.settingsCreated == 0 && Native.settingsDeleted == 0 && Native.enginesCreated == 0,
          "Invalid context contracts must fail before creating native settings or engines: " + name)
        precondition(Native.journal.count == 1 && Native.journal[0] == .unknownContext)
      }
      print("GEMMA_CONTEXT_CASE_OK " + name)
    }
    print("GEMMA_NATIVE_CONTEXT_CONTRACT_OK")
  }
}
`);
  const binary = path.join(directory, 'context');
  const build = spawnSync('xcrun', ['swiftc', '-parse-as-library', '-module-cache-path', path.join(directory, 'modules'),
    harness, leaseSource, '-o', binary], { encoding: 'utf8', timeout: 70000 });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const run = spawnSync(binary, [path.join(directory, 'model.litertlm'), path.join(directory, 'cache-root')], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal((run.stdout.match(/GEMMA_CONTEXT_CASE_OK /g) || []).length, 20);
  assert.match(run.stdout, /GEMMA_NATIVE_CONTEXT_CONTRACT_OK/);
});
