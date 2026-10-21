const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

test('Abbruch während echter Progress-Awaits verhindert nach Resume neue Modellarbeit', { timeout: 70000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const sourcePath = process.env.LANGFORM_SUMMARY_SOURCE || path.join(__dirname, '../ios/Langform/Langform/OnDeviceSummary.swift');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const start = source.indexOf('    private static func generate(_ source:');
  const end = source.indexOf('\n    @available', start);
  assert.ok(start >= 0 && end > start, 'Die tatsächlich ausgelieferte generate-Methode muss extrahiert werden');
  const generate = source.slice(start, end);
  t.diagnostic('OnDeviceSummary SHA256: ' + crypto.createHash('sha256').update(source).digest('hex'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-progress-cancellation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const harness = path.join(directory, 'ProgressCancellation.swift');
  // Run the unmodified shipping generate body, including both real suspension
  // points and the calls that create/prewarm/stream the model session. Only its
  // dependencies are deterministic stand-ins: no FoundationModels inference,
  // UIKit notification delivery, model quality, or device memory is claimed.
  // This also avoids replacing FoundationModels' @Generable compiler macros.
  fs.writeFileSync(harness, `
import Foundation
import Darwin

struct SystemLanguageModel {
  static let \`default\` = SystemLanguageModel()
  var availability: Int { 0 }
}
struct Prompt { init(_ text: String) {} }
struct GenerationOptions {
  enum SamplingMode { case greedy }
  init(samplingMode: SamplingMode, maximumResponseTokens: Int) {}
}
struct Snapshot { let content: String }
@MainActor final class LanguageModelSession {
  static var creations = 0
  static var prewarms = 0
  static var streams = 0
  static func reset() { creations = 0; prewarms = 0; streams = 0 }
  init(model: SystemLanguageModel, instructions: String) { Self.creations += 1 }
  func prewarm(promptPrefix: Prompt) { Self.prewarms += 1 }
  func streamResponse(to prompt: String, options: GenerationOptions) -> AsyncThrowingStream<Snapshot, Error> {
    Self.streams += 1
    return AsyncThrowingStream { continuation in
      continuation.yield(Snapshot(content: "complete"))
      continuation.finish()
    }
  }
}
actor SummaryReuseCache {}
@MainActor enum OnDeviceSummary {
  struct Progress {
    var phase: String
    var processedSections: Int
    var totalSections: Int
    var sourceIncomplete: Bool
    var coverageIncomplete: Bool
    var tldr: String?
  }
  struct EvidencePoint { let statement: String }
  struct ParsedSummary { let tldr: String; let points: [String]; let takeaway: String; let caveat: String }
  static let summaryInstructions = "fixture"
  static let generationFailedMessage = "failed"
  static let insufficientContentMessage = "insufficient"
  static func availabilityFailure(_ availability: Int) -> [String: Any]? { nil }
  static func sections(for source: String) -> [String] { [source] }
  static func contextEdge(_ text: String, suffix: Bool) -> String { "" }
  static func reusableAnalysis(_ source: String, model: SystemLanguageModel, cache: SummaryReuseCache) async throws -> [EvidencePoint] {
    try Task.checkCancellation()
    return [EvidencePoint(statement: "note")]
  }
  static func grounded(_ points: [EvidencePoint], in source: String) -> [EvidencePoint] { points }
  static func notesText(_ points: [EvidencePoint]) -> String { "small grounded note" }
  static func noteGroups(_ points: [EvidencePoint]) -> [[EvidencePoint]] { [points] }
  static func checkDeadline(_ deadline: Date) throws { try Task.checkCancellation() }
  static func completedTLDR(_ text: String) -> String? { nil }
  static func cleanOutput(_ text: String) -> String { text }
  static func parseSummary(_ text: String) -> ParsedSummary? {
    text == "complete" ? ParsedSummary(tldr: "Kern", points: ["Punkt"], takeaway: "Merksatz", caveat: "") : nil
  }
  static func failure(_ code: String, _ message: String) -> [String: Any] { ["code": code, "message": message] }
${generate}
  static func run(_ source: String, onProgress: ((Progress) async -> Void)? = nil) async throws -> [String: Any] {
    try await generate(source, sourceIncomplete: false, cache: SummaryReuseCache(), onProgress: onProgress)
  }
}
@MainActor final class ProgressGate {
  private var paused = false
  private var arrived: CheckedContinuation<Void, Never>?
  private var resume: CheckedContinuation<Void, Never>?
  func pause() async {
    paused = true
    arrived?.resume(); arrived = nil
    await withCheckedContinuation { resume = $0 }
  }
  func waitUntilPaused() async {
    if paused { return }
    await withCheckedContinuation { arrived = $0 }
  }
  func release() { resume?.resume(); resume = nil }
}
struct FixtureFailure: Error, CustomStringConvertible {
  let description: String
}
@main struct ProgressCancellation {
  static func expect(_ value: Bool, _ message: String) throws {
    if !value { throw FixtureFailure(description: message) }
  }
  @MainActor static func cancelled(phase: String, source: String) async throws {
    LanguageModelSession.reset()
    let gate = ProgressGate()
    let task = Task { @MainActor in
      do {
        _ = try await OnDeviceSummary.run(source) { progress in
          if progress.phase == phase { await gate.pause() }
        }
        return false
      } catch is CancellationError { return true }
      catch { return false }
    }
    await gate.waitUntilPaused()
    let expectedSessions = phase == "reading" ? 0 : 1
    try expect(LanguageModelSession.creations == expectedSessions && LanguageModelSession.streams == 0,
      "Der Callback muss vor der zu prüfenden Modellarbeit suspendieren")
    task.cancel()
    gate.release()
    let wasCancelled = await task.value
    try expect(wasCancelled, "Der abgebrochene Callback muss nach Resume CancellationError liefern")
    try expect(LanguageModelSession.creations == expectedSessions,
      "Abbruch im reading-Callback darf nach Resume keine Session erzeugen")
    try expect(LanguageModelSession.prewarms == 0,
      "Abbruch im reading-Callback darf nach Resume keinen Prewarm starten")
    try expect(LanguageModelSession.streams == 0,
      "Abbruch im writing-Callback darf nach Resume keinen Stream starten")
  }
  @MainActor static func main() async {
    do {
      // Long input would prewarm immediately after reading progress resumes.
      try await cancelled(phase: "reading", source: String(repeating: "a", count: 4201))
      // Short input reaches writing without an earlier prewarm operation.
      try await cancelled(phase: "writing", source: "Vollständige kurze Quelle.")
      // Control: the same extracted method still reaches both operations when
      // the callback completes normally, so an inert fixture cannot pass.
      LanguageModelSession.reset()
      let result = try await OnDeviceSummary.run(String(repeating: "a", count: 4201)) { _ in }
      try expect(LanguageModelSession.creations == 1 && LanguageModelSession.prewarms == 1 && LanguageModelSession.streams == 1 && result["summary"] != nil,
        "Ohne Abbruch muss die echte Sequenz Session, Prewarm und Stream erreichen")
      print("PROGRESS_CALLBACK_CANCEL_GATES_OK")
    } catch {
      print("PROGRESS_CALLBACK_CANCEL_GATES_FAILED: \\(error)")
      exit(1)
    }
  }
}
`);
  const binary = path.join(directory, 'progress-cancellation');
  const build = spawnSync('xcrun', ['swiftc', '-module-cache-path', path.join(directory, 'modules'),
    '-parse-as-library', harness, '-o', binary], { encoding: 'utf8', timeout: 60000 });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 5000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /PROGRESS_CALLBACK_CANCEL_GATES_OK/);
});
