const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('öffentlicher Kurzfassungsknopf routet physisches iOS ohne versteckten Apple-Fallback zu Gemma und erhält Eingabe-, Fortschritts- und Abbruchvertrag', { timeout: 180000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const product = path.join(__dirname, '../ios/Langform/Langform');
  const actual = fs.readFileSync(path.join(product, 'OnDeviceSummary.swift'), 'utf8');
  const app = fs.readFileSync(path.join(product, 'LangformApp.swift'), 'utf8');
  const start = actual.indexOf('    static func reply(for captions:');
  const end = actual.indexOf('\n    enum GenerationDeadline:', start);
  assert.ok(start >= 0 && end > start);
  const entry = actual.slice(start, end);
  assert.doesNotMatch(entry, /GemmaRuntime|GemmaModelStore|GemmaDeviceProbe|GemmaDiagnosticRequest/,
    'Der öffentliche Knopf darf ausschließlich an den geprüften Provider delegieren, keine native Engine oder Diagnose starten');
  assert.doesNotMatch(app, /GemmaDeviceProbe\.runIfRequested/,
    'Die öffentliche Gemma-Auswahl darf keine automatische Probe beim normalen Appstart zurückbringen');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-safe-summary-entry-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  // Only the entry's platform predicates are mapped to independent compiler
  // flags. All conditions, provider forwarding, validation, Apple cache code
  // and the rest of the actual Swift file remain intact. No model is started.
  const forcedEntry = entry.replace(/\bos\(iOS\)/g, 'LANGFORM_TEST_IOS_ROUTING')
    .replace(/\btargetEnvironment\(simulator\)/g, 'LANGFORM_TEST_SIMULATOR_ROUTING')
    .replace(/\btargetEnvironment\(macCatalyst\)/g, 'LANGFORM_TEST_CATALYST_ROUTING');
  const source = path.join(directory, 'OnDeviceSummary.swift');
  fs.writeFileSync(source, actual.slice(0, start) + forcedEntry + actual.slice(end));
  const markerDirectory = path.join(directory, 'LiteRTMarker');
  fs.mkdirSync(markerDirectory);
  fs.writeFileSync(path.join(markerDirectory, 'LiteRTLM.swift'), 'public enum SafeEntryImportMarker {}\n');
  const cache = ['-module-cache-path', path.join(directory, 'modules')];
  const module = spawnSync('xcrun', ['swiftc', ...cache, '-emit-module', '-module-name', 'LiteRTLM',
    path.join(markerDirectory, 'LiteRTLM.swift'), '-emit-module-path', path.join(markerDirectory, 'LiteRTLM.swiftmodule')],
  { encoding: 'utf8', timeout: 25000 });
  assert.equal(module.status, 0, module.stderr);
  const harness = path.join(directory, 'SafeEntry.swift');
  fs.writeFileSync(harness, `
import Foundation
actor Calls {
  static let shared = Calls()
  struct Call: Sendable { let source: String; let incomplete: Bool; let cache: SummaryReuseCache }
  private var calls: [Call] = []
  func add(source: String, incomplete: Bool, cache: SummaryReuseCache) {
    calls.append(.init(source: source, incomplete: incomplete, cache: cache))
  }
  func snapshot() -> [Call] { calls }
}
enum GemmaSummary {
  static func reply(source: String, sourceIncomplete: Bool, cache: SummaryReuseCache,
                    onProgress: ((OnDeviceSummary.Progress) async -> Void)?) async -> [String: Any] {
    if Task.isCancelled { return OnDeviceSummary.failure("CANCELLED", "cancelled delegate") }
    await Calls.shared.add(source: source, incomplete: sourceIncomplete, cache: cache)
    await onProgress?(.init(phase: "reading", processedSections: 0, totalSections: 1,
      sourceIncomplete: sourceIncomplete, coverageIncomplete: false))
    return ["routeMarker": "physical-gemma", "receivedIncomplete": sourceIncomplete]
  }
}
actor Updates {
  private var values: [OnDeviceSummary.Progress] = []
  func add(_ value: OnDeviceSummary.Progress) { values.append(value) }
  func snapshot() -> [OnDeviceSummary.Progress] { values }
}
actor Gate {
  private var open = false
  private var waiter: CheckedContinuation<Void, Never>?
  func wait() async {
    if open { return }
    await withCheckedContinuation { waiter = $0 }
  }
  func release() { open = true; waiter?.resume(); waiter = nil }
}
@main struct SafeEntry {
  static func main() async throws {
    #if canImport(LiteRTLM)
    let liteRTAvailable = true
    #else
    let liteRTAvailable = false
    #endif
    #if LANGFORM_EXPECT_LITERT
    precondition(liteRTAvailable, "Der Test muss bei tatsächlich importierbarem LiteRT-Modul laufen")
    #else
    precondition(!liteRTAvailable, "Die Fallbackprobe darf kein LiteRT-Modul importieren können")
    #endif
    let cache = SummaryReuseCache(), updates = Updates()
    let captions = "[Musik]\\nDie Sprecher loben die Gestaltung, kritisieren aber die schlechte Nachtruhe."
    let source = OnDeviceSummary.prepare(captions)
    let stored: [String: Any] = ["routeMarker": "preexisting-apple-cache", "summary": [
      "tldr": "Die Gestaltung gefällt, die Nachtruhe wird kritisiert.",
      "points": ["Die Gestaltung wird gelobt.", "Die Nachtruhe war schlecht."],
      "takeaway": "Der Besuch hinterlässt einen gemischten Eindruck.",
      "coverage": ["complete": true, "processedSections": 1, "totalSections": 1]]]
    precondition(OnDeviceSummary.reusableResult(stored))
    await cache.store(try JSONSerialization.data(withJSONObject: stored),
      for: OnDeviceSummary.reuseKey(source, scope: "summary"))
    let result = await OnDeviceSummary.reply(for: captions, cache: cache, onProgress: { await updates.add($0) })
    let calls = await Calls.shared.snapshot()
    let progress = await updates.snapshot()
    #if LANGFORM_EXPECT_GEMMA
    precondition(result["routeMarker"] as? String == "physical-gemma",
      "Der physische iOS-Knopf muss Gemma verwenden und darf keinen alten Apple-Cachehit liefern")
    precondition(calls.count == 1 && calls[0].source == source && !calls[0].incomplete && calls[0].cache === cache,
      "Der tatsächliche Einstieg muss die vollständig vorbereitete Quelle und denselben Cache genau einmal weitergeben")
    precondition(progress.map(\\.phase) == ["reading"] && progress[0].sourceIncomplete == false,
      "Der echte Fortschrittscallback muss den Provider erreichen")
    let incomplete = await OnDeviceSummary.reply(for: captions, sourceIncomplete: true, cache: cache)
    let afterIncomplete = await Calls.shared.snapshot()
    precondition(incomplete["routeMarker"] as? String == "physical-gemma" && incomplete["receivedIncomplete"] as? Bool == true)
    precondition(afterIncomplete.count == 2 && afterIncomplete[1].source == source && afterIncomplete[1].incomplete)
    #else
    precondition(result["routeMarker"] as? String == "preexisting-apple-cache" && OnDeviceSummary.reusableResult(result),
      "Mac und Simulator müssen den bestehenden Apple-Cachevertrag verwenden")
    precondition(calls.isEmpty && progress.isEmpty)
    #endif
    let beforeInvalid = await Calls.shared.snapshot()
    let empty = await OnDeviceSummary.reply(for: "  \\n", cache: cache)
    precondition(empty["code"] as? String == "MISSING_CAPTIONS")
    let unusable = await OnDeviceSummary.reply(for: "[Musik] 12345", cache: cache)
    precondition(unusable["code"] as? String == "UNUSABLE_CAPTIONS")
    let gate = Gate()
    let cancelled = Task { await gate.wait(); return await OnDeviceSummary.reply(for: captions, cache: cache) }
    cancelled.cancel(); await gate.release()
    let cancelledResult = await cancelled.value
    precondition(cancelledResult["code"] as? String == "CANCELLED")
    let afterInvalid = await Calls.shared.snapshot()
    precondition(afterInvalid.count == beforeInvalid.count,
      "Leere, unbrauchbare und bereits abgebrochene Anfragen dürfen keine neue Modellarbeit erzeugen")
    print("PUBLIC_SUMMARY_PLATFORM_ROUTE_OK")
  }
}
`);
  for (const [name, platform, liteRT, gemma] of [
    ['physical-ios', ['LANGFORM_TEST_IOS_ROUTING'], true, true],
    ['ios-simulator', ['LANGFORM_TEST_IOS_ROUTING', 'LANGFORM_TEST_SIMULATOR_ROUTING'], true, false],
    ['mac', [], true, false],
    ['mac-catalyst', ['LANGFORM_TEST_IOS_ROUTING', 'LANGFORM_TEST_CATALYST_ROUTING'], true, false],
    ['ios-without-litert', ['LANGFORM_TEST_IOS_ROUTING'], false, true]
  ]) {
    const binary = path.join(directory, name);
    const flags = [...platform, ...(liteRT ? ['LANGFORM_EXPECT_LITERT'] : []), ...(gemma ? ['LANGFORM_EXPECT_GEMMA'] : [])];
    const build = spawnSync('xcrun', ['swiftc', ...cache, ...flags.flatMap(flag => ['-D', flag]),
      ...(liteRT ? ['-I', markerDirectory] : []), '-parse-as-library', source, harness, '-o', binary],
    { encoding: 'utf8', timeout: 75000 });
    assert.equal(build.status, 0, `${name}: ${build.stderr}`);
    const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 5000 });
    assert.equal(run.status, 0, `${name}: ${run.stdout + run.stderr}`);
    assert.match(run.stdout, /PUBLIC_SUMMARY_PLATFORM_ROUTE_OK/);
  }
});
