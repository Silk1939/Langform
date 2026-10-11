const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("native Summary-Abbruch antwortet sofort und ein alter Task löscht keine neue Anfrage", { timeout: 70000 }, t => {
  if (process.platform !== "darwin") return t.skip("Swift-Test benötigt macOS");
  const source = fs.readFileSync(process.env.LANGFORM_SUMMARY_SOURCE || path.join(__dirname, "../ios/Langform/Langform/YouTubeWebView.swift"), "utf8");
  const start = source.indexOf("    private func answerSummary(");
  const method = source.slice(start, source.indexOf("\n    // MARK: Navigation", start));
  const entry = source.match(/    private struct SummaryRequestTask \{[\s\S]*?\n    \}/);
  const declaration = source.match(/    private var summaryTasks:[^\n]+/)[0];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-summary-lifecycle-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const harness = path.join(directory, "Lifecycle.swift");
  fs.writeFileSync(harness, `
import Foundation
enum ContentWorld { case page }
@MainActor final class WKWebView {
    var replies: [String] = []
    func evaluateJavaScript(_ script: String, in frame: Any?, in world: ContentWorld) { replies.append(script) }
}
@MainActor final class WKScriptMessage {
    var body: Any
    var webView: WKWebView?
    init(_ id: String, _ text: String, _ webView: WKWebView) { body = ["id": id, "text": text]; self.webView = webView }
}
@MainActor enum OnDeviceSummary {
    static var pending: [String: CheckedContinuation<[String: Any], Never>] = [:]
    static func reply(for text: String, sourceIncomplete: Bool) async -> [String: Any] {
        await withCheckedContinuation { pending[text] = $0 }
    }
    static func failure(_ code: String, _ message: String) -> [String: Any] { ["code": code, "message": message] }
}
@MainActor final class Host {
${entry ? entry[0] : ""}
${declaration}
${method}
    func send(_ id: String, _ text: String, _ view: WKWebView) { answerSummary(WKScriptMessage(id, text, view)) }
    var count: Int { summaryTasks.count }
    func cancel(_ view: WKWebView) { summaryTasks.removeValue(forKey: ObjectIdentifier(view))?.cancel() }
}
@main struct Harness {
    @MainActor static func tick() async { try? await Task.sleep(for: .milliseconds(5)) }
    @MainActor static func main() async {
        let host = Host(), view = WKWebView()
        host.send("ticket-A", "A", view); await tick()
        host.send("ticket-B", "B", view); await tick()
        precondition(view.replies.count == 1 && view.replies[0].contains("ticket-A") && view.replies[0].contains("CANCELLED"), "A braucht einen sofortigen Abschluss")
        precondition(host.count == 1)
        OnDeviceSummary.pending.removeValue(forKey: "A")!.resume(returning: ["summary": ["points": ["Altes A"]]])
        await tick()
        precondition(host.count == 1 && view.replies.count == 1, "Verspätetes A darf B weder löschen noch beantworten")
        OnDeviceSummary.pending.removeValue(forKey: "B")!.resume(returning: ["summary": ["points": ["Aktuelles B"]]])
        await tick()
        precondition(view.replies.count == 2 && view.replies[1].contains("ticket-B") && host.count == 0)
        host.send("ticket-C", "C", view); await tick(); host.cancel(view)
        OnDeviceSummary.pending.removeValue(forKey: "C")!.resume(returning: ["summary": ["points": ["Fremdes Dokument"]]])
        await tick()
        precondition(view.replies.count == 2 && host.count == 0, "Navigation darf keine Antwort ins neue Dokument liefern")
        print("SUMMARY_REQUEST_LIFECYCLE_OK")
    }
}
`);
  const binary = path.join(directory, "lifecycle");
  const compilation = spawnSync("xcrun", ["swiftc", "-parse-as-library", harness, "-o", binary], { encoding: "utf8", timeout: 60000 });
  assert.equal(compilation.status, 0, compilation.stderr);
  const execution = spawnSync(binary, [], { encoding: "utf8", timeout: 5000 });
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /SUMMARY_REQUEST_LIFECYCLE_OK/);
});
