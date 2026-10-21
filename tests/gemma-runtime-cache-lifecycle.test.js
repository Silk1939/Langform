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

// Exercise the shipping NativeEngine constructor/close and real file lease.
// Only the C engine boundary is controlled; it checks cache lifetime at the
// instant native delete runs, before Swift may release the lease.
test('tatsächliche NativeEngine hält ihren frischen CPU-Dateicache bis nach EngineDelete und räumt Fehler, Deinit und paralleles Close korrekt auf', { timeout: 90000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-native-cache-life-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const runtime = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/GemmaRuntime.swift'), 'utf8');
  let actual = ['enum GemmaRuntimeError:', 'struct GemmaNativeFailure:', 'private final class GemmaNativeEngine:']
    .map(marker => declaration(runtime, marker)).join('\n');
  assert.equal((actual.match(/GemmaRuntimeCacheLease\.acquire\(\)/g) || []).length, 1);
  actual = actual.replace('GemmaRuntimeCacheLease.acquire()',
    'GemmaRuntimeCacheLease.acquire(root: URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true))');
  const leaseSource = path.join(__dirname, '../ios/Langform/Langform/GemmaRuntimeCache.swift');
  const harness = path.join(directory, 'Lifecycle.swift');
  fs.writeFileSync(harness, String.raw`
import Foundation
import Darwin
import Dispatch
private struct ModelInfo {
  init(throwingModelPath: String) throws {}
  func maxContextTokens() -> Int { 8192 }
  func isDynamicContext() -> Bool { false }
}
private enum Native {
  static var nextSettings = 10, nextEngine = 100
  static var settingsCaches: [Int: URL] = [:]
  static var settingsBackends: [Int: String] = [:]
  static var engineCaches: [Int: URL] = [:]
  static var cachePaths: [URL] = []
  static var deletedHandles: Set<Int> = []
  static var deleteSawLiveCache: [Int: Bool] = [:]
  static var createAttempts = 0, deleteCalls = 0, settingsDeletes = 0
  static var failNextCreate = false
  static var gpuFloat32Calls = 0
  static var journal: [GemmaRuntimeLoadJournal.Code] = []
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
  Native.nextSettings += 1
  Native.settingsBackends[Native.nextSettings] = backend
  return OpaquePointer(bitPattern: Native.nextSettings)
}
private func litert_lm_engine_settings_delete(_ p: OpaquePointer) { Native.settingsDeletes += 1 }
private func litert_lm_engine_settings_set_max_num_tokens(_ p: OpaquePointer, _ n: Int32) { precondition(n == 8192) }
private func litert_lm_engine_settings_enable_benchmark(_ p: OpaquePointer) {}
private func litert_lm_engine_settings_set_activation_data_type(_ p: OpaquePointer, _ n: Int32) {
  precondition(Native.settingsBackends[Int(bitPattern: p)] == "gpu" && n == kLiteRtLmActivationDataTypeFloat32)
  Native.gpuFloat32Calls += 1
}
private func litert_lm_engine_settings_set_prefill_chunk_size(_ p: OpaquePointer, _ n: Int32) {
  precondition(Native.settingsBackends[Int(bitPattern: p)] == "cpu" && n == 256)
}
private func litert_lm_engine_settings_set_cache_dir(_ p: OpaquePointer, _ path: String) {
  let url = URL(fileURLWithPath: path, isDirectory: true)
  precondition(FileManager.default.fileExists(atPath: path))
  Native.settingsCaches[Int(bitPattern: p)] = url
  Native.cachePaths.append(url)
}
private func litert_lm_engine_create(_ p: OpaquePointer) -> OpaquePointer? {
  Native.createAttempts += 1
  let cache = Native.settingsCaches[Int(bitPattern: p)]!
  if Native.settingsBackends[Int(bitPattern: p)] == "cpu" {
    precondition(!FileManager.default.fileExists(atPath: cache.appendingPathComponent("controlled.xnnpack_cache").path),
      "A new CPU engine must receive a fresh cache, never a preceding warm cache")
  }
  try! Data("native cache must outlive engine delete".utf8).write(to: cache.appendingPathComponent("controlled.xnnpack_cache"))
  if Native.failNextCreate { Native.failNextCreate = false; return nil }
  Native.nextEngine += 1
  Native.engineCaches[Native.nextEngine] = cache
  return OpaquePointer(bitPattern: Native.nextEngine)
}
private func litert_lm_engine_delete(_ p: OpaquePointer) {
  let key = Int(bitPattern: p), cache = Native.engineCaches[key]!
  precondition(!Native.deletedHandles.contains(key), "Native engine was deleted twice")
  let live = FileManager.default.fileExists(atPath: cache.path)
    && FileManager.default.fileExists(atPath: cache.appendingPathComponent("controlled.xnnpack_cache").path)
  precondition(live, "Deleting the file cache before native engine teardown invalidates mapped weights")
  Native.deleteSawLiveCache[key] = live
  Native.deletedHandles.insert(key); Native.deleteCalls += 1
}
private func litert_lm_engine_tokenize(_ p: OpaquePointer, _ text: String) -> OpaquePointer? { nil }
private func litert_lm_tokenize_result_delete(_ p: OpaquePointer) {}
private func litert_lm_tokenize_result_get_num_tokens(_ p: OpaquePointer) -> Int32 { 0 }
` + actual + String.raw`
@main struct CacheLifecycleExercise {
  static func main() throws {
    let manager = FileManager.default
    let model = URL(fileURLWithPath: CommandLine.arguments[1])
    let root = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
    try Data("controlled metadata boundary".utf8).write(to: model)
    let first = try GemmaNativeEngine(modelURL: model, backend: "cpu", verifiedContextTokens: 8192)
    let firstCache = Native.cachePaths.last!
    let second = try GemmaNativeEngine(modelURL: model, backend: "cpu", verifiedContextTokens: 8192)
    let secondCache = Native.cachePaths.last!
    precondition(firstCache != secondCache && manager.fileExists(atPath: firstCache.path)
      && manager.fileExists(atPath: secondCache.path), "Acquiring a second lease must preserve the first active engine")
    precondition(firstCache.path.hasPrefix(root.path + "/") && secondCache.path.hasPrefix(root.path + "/"))
    first.close(); first.close()
    precondition(Native.deleteCalls == 1 && !manager.fileExists(atPath: firstCache.path)
      && manager.fileExists(atPath: secondCache.path), "Close must remove only the first engine's own cache")

    Native.failNextCreate = true
    do {
      _ = try GemmaNativeEngine(modelURL: model, backend: "cpu", verifiedContextTokens: 8192)
      preconditionFailure("Controlled native-create failure was ignored")
    } catch GemmaRuntimeError.modelUnavailable {}
    let failedCache = Native.cachePaths.last!
    precondition(failedCache != firstCache && failedCache != secondCache
      && !manager.fileExists(atPath: failedCache.path) && Native.deleteCalls == 1,
      "A failed native creation must release its fresh cache without deleting a nonexistent engine")
    precondition(manager.fileExists(atPath: secondCache.path) && Native.journal.last == .nativeCreateFailed)

    var automatic: GemmaNativeEngine? = try GemmaNativeEngine(modelURL: model, backend: "cpu", verifiedContextTokens: 8192)
    let automaticCache = Native.cachePaths.last!
    precondition(automatic != nil && manager.fileExists(atPath: automaticCache.path))
    automatic = nil
    precondition(!manager.fileExists(atPath: automaticCache.path) && Native.deleteCalls == 2,
      "Deinit must delete native state before removing its cache")

    let group = DispatchGroup()
    for _ in 0..<12 {
      group.enter()
      DispatchQueue.global().async { second.close(); group.leave() }
    }
    precondition(group.wait(timeout: .now() + 5) == .success)
    precondition(Native.deleteCalls == 3 && !manager.fileExists(atPath: secondCache.path),
      "Overlapping close callers must execute native deletion and lease cleanup only once")
    precondition(Native.deleteSawLiveCache.count == 3 && Native.deleteSawLiveCache.values.allSatisfy { $0 })

    // The new CPU lease must not turn the preexisting GPU cache into a disposable one.
    let gpuCache = model.deletingLastPathComponent().appendingPathComponent("RuntimeCache-v018-f32-gpu", isDirectory: true)
    try manager.createDirectory(at: gpuCache, withIntermediateDirectories: true)
    let prior = gpuCache.appendingPathComponent("preserved-warm-cache")
    try Data("existing GPU cache".utf8).write(to: prior)
    let gpu = try GemmaNativeEngine(modelURL: model, backend: "gpu", verifiedContextTokens: 8192)
    precondition(Native.cachePaths.last == gpuCache && Native.gpuFloat32Calls == 1)
    gpu.close(); gpu.close()
    precondition(Native.deleteCalls == 4 && manager.fileExists(atPath: prior.path)
      && manager.fileExists(atPath: gpuCache.path), "CPU cache leases must preserve the legacy GPU cache lifetime")
    precondition(Native.createAttempts == 5 && Native.settingsDeletes == 5)
    precondition(Native.cachePaths.prefix(4).count == Set(Native.cachePaths.prefix(4)).count)
    print("GEMMA_NATIVE_CACHE_LIFECYCLE_OK")
  }
}
`);
  const binary = path.join(directory, 'lifecycle');
  const build = spawnSync('xcrun', ['swiftc', '-parse-as-library', '-module-cache-path', path.join(directory, 'modules'),
    harness, leaseSource, '-o', binary], { encoding: 'utf8', timeout: 70000 });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const run = spawnSync(binary, [path.join(directory, 'model.litertlm'), path.join(directory, 'cache-root')],
    { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /GEMMA_NATIVE_CACHE_LIFECYCLE_OK/);
});
