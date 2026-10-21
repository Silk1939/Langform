const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function block(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `Missing actual source marker: ${marker}`);
  const opening = source.indexOf('{', start);
  let depth = 1;
  for (let cursor = opening + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '{') depth += 1;
    if (source[cursor] === '}' && --depth === 0) return source.slice(opening + 1, cursor);
  }
  assert.fail(`Unclosed actual source block: ${marker}`);
}

test('tatsächlicher CPU-Kaltstart prüft die Speichergrenze vor nativem Aufbau und erhält vorhandene/coalescierte Engines', { timeout: 100000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-gemma-memory-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const runtime = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/GemmaRuntime.swift'), 'utf8');
  const actorStart = runtime.indexOf('actor GemmaRuntime {');
  const generationStart = runtime.indexOf('    func generate(', actorStart);
  assert.ok(actorStart >= 0 && generationStart > actorStart);
  // Preserve the actor's actual state, load implementation, failure type and
  // unload implementation. Only iOS selection and its memory sensor are mapped
  // to this macOS harness; native engine creation is held/recorded by a fake.
  const loader = runtime.slice(actorStart, generationStart)
    .replace(/\bos\(iOS\)/g, 'LANGFORM_TEST_IOS_ROUTING')
    .replace(/\bos_proc_available_memory\(\)/g, 'MemoryBudget.shared.available()')
    + 'private func stopAndUnload() async -> UInt64? {' + block(runtime, 'private func stopAndUnload()') + '}\n'
    + 'func stateForTest() -> (Bool, Bool) { (engine != nil, loading != nil) }\n}';
  const error = 'enum GemmaRuntimeError: Error, LocalizedError {' + block(runtime, 'enum GemmaRuntimeError') + '}';
  const journal = ('enum GemmaRuntimeLoadJournal {' + block(runtime, 'enum GemmaRuntimeLoadJournal') + '}')
    .replace('FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]',
      'URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)');
  const harness = path.join(directory, 'MemoryExercise.swift');
  fs.writeFileSync(harness, `
import Foundation
final class MemoryBudget: @unchecked Sendable {
  static let shared = MemoryBudget()
  private let lock = NSLock()
  private var bytes: UInt64 = 0
  private var reads = 0
  func set(_ bytes: UInt64) { lock.lock(); self.bytes = bytes; lock.unlock() }
  func available() -> UInt64 { lock.lock(); defer { lock.unlock() }; reads += 1; return bytes }
  func count() -> Int { lock.lock(); defer { lock.unlock() }; return reads }
}
final class NativeControl: @unchecked Sendable {
  static let shared = NativeControl()
  private let condition = NSCondition()
  private var held = false
  private var creates = 0
  private var closes = 0
  func hold() { condition.lock(); held = true; condition.unlock() }
  func created() {
    condition.lock(); creates += 1; condition.broadcast()
    while held { condition.wait() }
    condition.unlock()
  }
  func waitForCreates(_ expected: Int) {
    condition.lock(); while creates < expected { condition.wait() }; condition.unlock()
  }
  func release() { condition.lock(); held = false; condition.broadcast(); condition.unlock() }
  func closed() { condition.lock(); closes += 1; condition.unlock() }
  func snapshot() -> (Int, Int) { condition.lock(); defer { condition.unlock() }; return (creates, closes) }
}
final class Stages: @unchecked Sendable {
  static let shared = Stages()
  private let lock = NSLock()
  private var values: [String] = []
  func record(_ value: String) { lock.lock(); values.append(value); lock.unlock() }
  func count(_ value: String) -> Int { lock.lock(); defer { lock.unlock() }; return values.filter { $0 == value }.count }
}
// A recorder replaces diagnostics I/O, never the load or memory decision.
enum GemmaDiagnosticTrace { static func record(_ stage: String) { Stages.shared.record(stage) } }
private final class GemmaNativeEngine: @unchecked Sendable {
  let modelURL: URL
  let backend: String
  let verifiedContextTokens: Int?
  init(modelURL: URL, backend: String, verifiedContextTokens: Int?) throws {
    self.modelURL = modelURL; self.backend = backend; self.verifiedContextTokens = verifiedContextTokens
    NativeControl.shared.created()
  }
  func close() { NativeControl.shared.closed() }
}
// These unused generation-state types allow the complete real load/unload
// declarations to compile. No generation method or callback is replaced/run.
private final class GemmaNativeConversation: @unchecked Sendable { func cancel() {} }
private struct GemmaGeneratedText: Sendable {}
struct GemmaRuntimeMetrics: Codable, Sendable {}
${error}
${journal}
${loader}
actor Gate {
  private var open = false
  private var waiter: CheckedContinuation<Void, Never>?
  func wait() async { if open { return }; await withCheckedContinuation { waiter = $0 } }
  func release() { open = true; waiter?.resume(); waiter = nil }
}
@main struct MemoryExercise {
  static func main() async throws {
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    let threshold = GemmaRuntime.minimumColdStartBytes
    precondition(threshold == 2_500_000_000, "The measured CPU threshold must remain pinned")
    let runtime = GemmaRuntime()
    MemoryBudget.shared.set(threshold - 1)
    do {
      try await runtime.load(modelURL: url, backend: "cpu", verifiedContextTokens: 8192)
      preconditionFailure("A cold engine must not start below the memory guard")
    } catch GemmaRuntimeError.insufficientMemory(let available, let required) {
      precondition(available == threshold - 1 && required == threshold)
    }
    let failure = await runtime.lastFailure
    precondition(failure?.contains("insufficientMemory") == true)
    let journalURL = url.appendingPathComponent("GemmaRuntimeStatus/last-load.json")
    let rejectedJournal = try JSONSerialization.jsonObject(with: Data(contentsOf: journalURL)) as! [String: Any]
    precondition(rejectedJournal["code"] as? String == "insufficientMemory" &&
      rejectedJournal["availableMemoryBytes"] as? UInt64 == threshold - 1 &&
      rejectedJournal["requiredMemoryBytes"] as? UInt64 == threshold && rejectedJournal["engineLoaded"] as? Bool == false)
    precondition(NativeControl.shared.snapshot().0 == 0 && MemoryBudget.shared.count() == 1)
    precondition(Stages.shared.count("load.memory.rejected") == 1)
    MemoryBudget.shared.set(threshold)
    try await runtime.load(modelURL: url, backend: "cpu", verifiedContextTokens: 8192)
    let loaded = await runtime.stateForTest()
    precondition(loaded.0 && !loaded.1 && NativeControl.shared.snapshot().0 == 1 && MemoryBudget.shared.count() == 2)
    let loadedJournal = try JSONSerialization.jsonObject(with: Data(contentsOf: journalURL)) as! [String: Any]
    precondition(loadedJournal["code"] as? String == "loaded" && loadedJournal["engineLoaded"] as? Bool == true)
    MemoryBudget.shared.set(0)
    try await runtime.load(modelURL: url, backend: "cpu", verifiedContextTokens: 8192)
    precondition(NativeControl.shared.snapshot().0 == 1 && MemoryBudget.shared.count() == 2,
      "An already matching loaded engine must not be rejected against the cold budget a second time")
    let gpu = GemmaRuntime()
    for backend in ["gpu", "GPU", "gpu-fp32"] {
      do {
        try await gpu.load(modelURL: url, backend: backend, verifiedContextTokens: 8192)
        preconditionFailure("The known aborting GPU route must remain blocked")
      } catch GemmaRuntimeError.modelUnavailable(let detail) {
        precondition(detail.contains("GPU"))
      }
    }
    precondition(NativeControl.shared.snapshot().0 == 1 && MemoryBudget.shared.count() == 2,
      "GPU must be rejected before native creation and before any CPU memory decision")
    let gate = Gate(), cancelled = GemmaRuntime()
    let child = Task {
      await gate.wait()
      try await cancelled.load(modelURL: url, backend: "cpu", verifiedContextTokens: 8192)
    }
    child.cancel(); await gate.release()
    do { try await child.value; preconditionFailure("An already cancelled load must stop") }
    catch is CancellationError {}
    precondition(NativeControl.shared.snapshot().0 == 1 && MemoryBudget.shared.count() == 2)

    let coalesced = GemmaRuntime()
    MemoryBudget.shared.set(threshold)
    NativeControl.shared.hold()
    let first = Task { try await coalesced.load(modelURL: url, backend: "cpu", verifiedContextTokens: 8192) }
    await Task.detached { NativeControl.shared.waitForCreates(2) }.value
    MemoryBudget.shared.set(0)
    let second = Task { try await coalesced.load(modelURL: url, backend: "cpu", verifiedContextTokens: 8192) }
    let deadline = ProcessInfo.processInfo.systemUptime + 5
    while Stages.shared.count("load.coalesced") == 0 && ProcessInfo.processInfo.systemUptime < deadline {
      await Task.yield()
    }
    let joinedWhilePending = Stages.shared.count("load.coalesced") == 1
    NativeControl.shared.release()
    try await first.value; try await second.value
    precondition(joinedWhilePending, "The second caller must join the actual pending load before native construction resumes")
    precondition(NativeControl.shared.snapshot().0 == 2 && MemoryBudget.shared.count() == 3,
      "Coalesced callers share one constructor and the original successful cold-memory guard")
    print("GEMMA_ACTUAL_CPU_MEMORY_GUARD_OK")
  }
}
`);
  const binary = path.join(directory, 'memory-exercise');
  const build = spawnSync('xcrun', ['swiftc', '-swift-version', '6', '-D', 'LANGFORM_TEST_IOS_ROUTING',
    '-module-cache-path', path.join(directory, 'modules'), '-parse-as-library', harness, '-o', binary],
  { encoding: 'utf8', timeout: 80000 });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const run = spawnSync(binary, [path.join(directory, 'model.fixture')], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /GEMMA_ACTUAL_CPU_MEMORY_GUARD_OK/);
});
