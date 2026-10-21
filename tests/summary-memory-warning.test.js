const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('tatsächliche Memory-Warning- und Webprozess-Einstiege beenden wartende Kurzfassungen vor dem UI-Aufräumen', { timeout: 70000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/YouTubeWebView.swift'), 'utf8');
  const start = source.indexOf('    @objc private func releaseInactiveFeeds() {');
  const end = source.indexOf('\n        backgroundPreparationDisabled', start);
  assert.ok(start >= 0 && end > start);
  // Real entry sequence only; unrelated UIKit feed/player cleanup is outside
  // this executable boundary and is deliberately not claimed as covered.
  const prefix = source.slice(start, end).replace('@objc private func releaseInactiveFeeds()', 'func memoryWarning()') + '\n    }';
  assert.match(prefix, /cancelInactiveSummaryRequests\(\)/);
  const processStart = source.indexOf('    func webViewWebContentProcessDidTerminate(');
  const processEnd = source.indexOf('\n        if webView === player', processStart);
  assert.ok(processStart >= 0 && processEnd > processStart);
  const processPrefix = source.slice(processStart, processEnd) + '\n    }';
  assert.match(processPrefix, /summaryTasks\.removeValue\(forKey: ObjectIdentifier\(webView\)\)\?\.cancel\(\)/);
  const inactive = source.match(/    private func cancelInactiveSummaryRequests\(\) \{[\s\S]*?\n    \}/)?.[0];
  const entry = source.match(/    (?:@MainActor )?private struct SummaryRequestTask \{[\s\S]*?\n    \}/)?.[0];
  const declaration = source.match(/    private var summaryTasks:[^\n]+/)?.[0];
  const holds = source.match(/    private var summaryHostHolds[^\n]+/)?.[0];
  const release = source.match(/    private func releaseSummaryHost\([^\n]+\{[\s\S]*?\n    \}/)?.[0];
  const answerStart = source.indexOf('    private func answerSummary(');
  const answer = source.slice(answerStart, source.indexOf('\n    // MARK: Navigation', answerStart));
  assert.ok(inactive && entry && declaration && holds && release && answerStart >= 0);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-summary-memory-warning-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const harness = path.join(directory, 'MemoryWarning.swift');
  fs.writeFileSync(harness, `
import Foundation
enum ContentWorld { case page }
@MainActor final class WKWebView {
  var replies: [String] = []
  func evaluateJavaScript(_ script: String, in frame: Any?, in world: ContentWorld) { replies.append(script) }
}
@MainActor final class WKScriptMessage {
  let body: Any; let webView: WKWebView?
  init(_ id: String, _ text: String, _ view: WKWebView) { body = ["id": id, "text": text]; webView = view }
}
@MainActor enum OnDeviceSummary {
  struct Progress { var payload: [String: Any] { ["progress": ["phase": "reading"]] } }
  static var pending: [String: CheckedContinuation<[String: Any], Never>] = [:]
  static var updates: [String: (Progress) async -> Void] = [:]
  static var cancelledRequests = Set<String>()
  static func reply(for text: String, sourceIncomplete: Bool, onProgress: @escaping (Progress) async -> Void) async -> [String: Any] {
    updates[text] = onProgress
    let payload = await withCheckedContinuation { pending[text] = $0 }
    if Task.isCancelled { cancelledRequests.insert(text) }
    return payload
  }
  static func failure(_ code: String, _ message: String) -> [String: Any] { ["code": code, "message": message] }
}
@MainActor enum GemmaSummaryHostProbe {
  static func cancelled(id: String, lease: UUID, reason: String, host: [String: Any]) {}
  static func claimRequest(id: String, text: String, in view: WKWebView) -> Bool { false }
  static func ownsRequest(id: String) -> Bool { false }
  static func requestStarted(id: String, lease: UUID, host: [String: Any]) {}
  static func progress(id: String, lease: UUID, update: OnDeviceSummary.Progress, host: [String: Any]) {}
  static func nativeFinished(id: String, lease: UUID, payload: [String: Any], host: [String: Any]) {}
}
@MainActor final class Host {
${entry}
${declaration}
${holds}
${inactive}
${release}
${prefix}
${processPrefix}
${answer}
  private func prepareSummaryHost(for source: WKWebView) -> Bool { false }
  private func scheduleFeedPrewarm() {}
  private func summaryHostSnapshot(for source: WKWebView) -> [String: Any] { [:] }
  func send(_ id: String, _ text: String, _ view: WKWebView) { answerSummary(WKScriptMessage(id, text, view)) }
  var count: Int { summaryTasks.count }
  var holdCount: Int { summaryHostHolds.count }
  func ticket(_ view: WKWebView) -> String? { summaryTasks[ObjectIdentifier(view)]?.id }
}
@main struct MemoryWarning {
  @MainActor static func tick() async { try? await Task.sleep(for: .milliseconds(5)) }
  @MainActor static func main() async {
    let host = Host(), view = WKWebView()
    host.send("before-warning", "waiting-model-check", view); await tick()
    host.memoryWarning()
    precondition(host.count == 0 && view.replies.count == 1 && view.replies[0].contains("before-warning") && view.replies[0].contains("CANCELLED"), "Warnung muss auch eine noch wartende Anfrage synchron beenden")
    precondition(host.holdCount == 1, "Memory warning must retain the cancelled native task's host hold until drain")
    host.send("after-warning", "new-model-check", view); await tick()
    await OnDeviceSummary.updates["waiting-model-check"]!(.init())
    OnDeviceSummary.pending.removeValue(forKey: "waiting-model-check")!.resume(returning: ["summary": ["points": ["Verspätet"]]])
    await tick()
    precondition(OnDeviceSummary.cancelledRequests.contains("waiting-model-check") && view.replies.count == 1 && host.count == 1 && host.ticket(view) == "after-warning", "Alter Fortschritt/Abschluss darf weder die neue Anfrage erreichen noch deren Lease entfernen")
    await OnDeviceSummary.updates["new-model-check"]!(.init())
    OnDeviceSummary.pending.removeValue(forKey: "new-model-check")!.resume(returning: ["summary": ["points": ["Aktuell"]]])
    await tick()
    precondition(view.replies.count == 3 && view.replies[1].contains("after-warning") && view.replies[2].contains("after-warning") && host.count == 0)

    host.send("terminated-document", "old-document-source", view); await tick()
    host.webViewWebContentProcessDidTerminate(view)
    precondition(host.count == 0 && view.replies.count == 3, "Die echte Webprozess-Einstiegssequenz muss den alten Task entfernen, ohne JavaScript in den beendeten Prozess zu senden")
    host.send("new-document", "new-document-source", view); await tick()
    await OnDeviceSummary.updates["old-document-source"]!(.init())
    OnDeviceSummary.pending.removeValue(forKey: "old-document-source")!.resume(returning: ["summary": ["points": ["Falsches altes Dokument"]]])
    await tick()
    precondition(OnDeviceSummary.cancelledRequests.contains("old-document-source") && view.replies.count == 3 && host.count == 1 && host.ticket(view) == "new-document", "Ein alter Prozess-Task darf weder Fortschritt/Antwort ins neue Dokument senden noch dessen Lease löschen")
    await OnDeviceSummary.updates["new-document-source"]!(.init())
    OnDeviceSummary.pending.removeValue(forKey: "new-document-source")!.resume(returning: ["summary": ["points": ["Neues Dokument"]]])
    await tick()
    precondition(view.replies.count == 5 && view.replies[3].contains("new-document") && view.replies[4].contains("new-document") && host.count == 0)
    print("MEMORY_WARNING_SUMMARY_ENTRY_OK")
  }
}
`);
  const binary = path.join(directory, 'memory-warning');
  const build = spawnSync('xcrun', ['swiftc', '-module-cache-path', path.join(directory, 'modules'),
    '-parse-as-library', harness, '-o', binary], { encoding: 'utf8', timeout: 60000 });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 5000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /MEMORY_WARNING_SUMMARY_ENTRY_OK/);
});
