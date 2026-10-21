const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("native Summary-Abbruch antwortet auch zwischen zwei WebViews sofort und alte Tasks behalten keine Anfrage", { timeout: 70000 }, t => {
  if (process.platform !== "darwin") return t.skip("Swift-Test benötigt macOS");
  const source = fs.readFileSync(process.env.LANGFORM_SUMMARY_SOURCE || path.join(__dirname, "../ios/Langform/Langform/YouTubeWebView.swift"), "utf8");
  const start = source.indexOf("    private func answerSummary(");
  const method = source.slice(start, source.indexOf("\n    // MARK: Navigation", start));
  const entry = source.match(/    (?:@MainActor )?private struct SummaryRequestTask \{[\s\S]*?\n    \}/);
  const declaration = source.match(/    private var summaryTasks:[^\n]+/)[0];
  const holds = source.match(/    private var summaryHostHolds[^\n]+/)[0];
  const release = source.match(/    private func releaseSummaryHost\([^\n]+\{[\s\S]*?\n    \}/)[0];
  const inactive = source.match(/    private func cancelInactiveSummaryRequests\(\) \{[\s\S]*?\n    \}/);
  assert.ok(inactive, "Inaktive App muss auch noch wartende Summary-Tasks abbrechen");
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
    init(cancelling id: String, in webView: WKWebView) { body = ["id": id, "cancel": true]; self.webView = webView }
}
@MainActor enum OnDeviceSummary {
    struct Progress { var payload: [String: Any] { ["progress": ["phase": "reading"]] } }
    static var pending: [String: CheckedContinuation<[String: Any], Never>] = [:]
    static var updates: [String: (Progress) async -> Void] = [:]
    static var started: [String] = []
    static var cancelledRequests = Set<String>()
    static func reply(for text: String, sourceIncomplete: Bool, onProgress: @escaping (Progress) async -> Void) async -> [String: Any] {
        started.append(text)
        updates[text] = onProgress
        let payload = await withCheckedContinuation { pending[text] = $0 }
        if Task.isCancelled { cancelledRequests.insert(text) }
        return payload
    }
    static func failure(_ code: String, _ message: String) -> [String: Any] { ["code": code, "message": message] }
}
@MainActor enum GemmaSummaryHostProbe {
    static func claimRequest(id: String, text: String, in webView: WKWebView) -> Bool { false }
    static func ownsRequest(id: String) -> Bool { false }
    static func requestStarted(id: String, lease: UUID, host: [String: Any]) {}
    static func progress(id: String, lease: UUID, update: OnDeviceSummary.Progress, host: [String: Any]) {}
    static func nativeFinished(id: String, lease: UUID, payload: [String: Any], host: [String: Any]) {}
    static func cancelled(id: String, lease: UUID, reason: String, host: [String: Any]) {}
}
@MainActor enum GemmaSummary {
    static var unloadCalls = 0
    static func cancelAndUnload() async { unloadCalls += 1 }
}
@MainActor final class Host {
${entry ? entry[0] : ""}
${declaration}
${holds}
${inactive[0]}
${release}
${method}
    var reclaimsNext = false
    private func prepareSummaryHost(for view: WKWebView) -> Bool { let reclaimed = reclaimsNext; reclaimsNext = false; return reclaimed }
    private func scheduleFeedPrewarm() {}
    private func summaryHostSnapshot(for view: WKWebView) -> [String: Any] { [:] }
    func send(_ id: String, _ text: String, _ view: WKWebView) { answerSummary(WKScriptMessage(id, text, view)) }
    func timeout(_ id: String, _ view: WKWebView) { answerSummary(WKScriptMessage(cancelling: id, in: view)) }
    var count: Int { summaryTasks.count }
    func ticket(for view: WKWebView) -> String? { summaryTasks[ObjectIdentifier(view)]?.id }
    func cancel(_ view: WKWebView) { summaryTasks.removeValue(forKey: ObjectIdentifier(view))?.cancel() }
    func resign() { cancelInactiveSummaryRequests() }
}
@main struct Harness {
    @MainActor static func tick() async { try? await Task.sleep(for: .milliseconds(5)) }
    @MainActor static func main() async {
        let host = Host(), view = WKWebView()
        host.send("ticket-A", "A", view); await tick()
        host.send("ticket-B", "B", view); await tick()
        precondition(view.replies.count == 1 && view.replies[0].contains("ticket-A") && view.replies[0].contains("CANCELLED"), "A braucht einen sofortigen Abschluss")
        precondition(host.count == 1)
        await OnDeviceSummary.updates["A"]!(.init())
        precondition(view.replies.count == 1, "Abgelöster Fortschritt von A darf B nicht erreichen")
        await OnDeviceSummary.updates["B"]!(.init())
        precondition(view.replies.count == 2 && view.replies[1].contains("__langformKurzUpdate") && view.replies[1].contains("ticket-B"), "Eigener Fortschritt muss zur passenden Anfrage gelangen")
        OnDeviceSummary.pending.removeValue(forKey: "A")!.resume(returning: ["summary": ["points": ["Altes A"]]])
        await tick()
        precondition(host.count == 1 && view.replies.count == 2, "Verspätetes A darf B weder löschen noch beantworten")
        OnDeviceSummary.pending.removeValue(forKey: "B")!.resume(returning: ["summary": ["points": ["Aktuelles B"]]])
        await tick()
        precondition(view.replies.count == 3 && view.replies[2].contains("ticket-B") && host.count == 0)
        host.send("ticket-C", "C", view); await tick(); host.cancel(view)
        await OnDeviceSummary.updates["C"]!(.init())
        OnDeviceSummary.pending.removeValue(forKey: "C")!.resume(returning: ["summary": ["points": ["Fremdes Dokument"]]])
        await tick()
        precondition(view.replies.count == 3 && host.count == 0, "Navigation darf keine Antwort oder Fortschritt ins neue Dokument liefern")
        host.send("ticket-D", "D", view); await tick(); host.resign()
        precondition(host.count == 0 && view.replies.count == 4 && view.replies[3].contains("ticket-D") && view.replies[3].contains("CANCELLED"), "App-Wechsel muss auch eine auf Modellprüfung wartende Anfrage sofort abschließen")
        await OnDeviceSummary.updates["D"]!(.init())
        OnDeviceSummary.pending.removeValue(forKey: "D")!.resume(returning: ["summary": ["points": ["Verspätetes D"]]])
        await tick()
        precondition(view.replies.count == 4 && host.count == 0, "Eine inaktive Anfrage darf weder Fortschritt noch eine verspätete Antwort senden")

        // Feed and player use distinct WKWebViews but share one native model.
        // Keep the old continuation alive to simulate a late native callback or
        // the handoff between evidence selection and the writing conversation.
        let sharedHost = Host(), feed = WKWebView(), player = WKWebView()
        sharedHost.send("ticket-feed", "feed-source", feed); await tick()
        sharedHost.send("ticket-player", "player-source", player)
        precondition(feed.replies.count == 1 && feed.replies[0].contains("ticket-feed") && feed.replies[0].contains("CANCELLED"), "Die neue Player-Anfrage muss die Feed-Anfrage synchron abschließen")
        precondition(player.replies.isEmpty && sharedHost.count == 1 && sharedHost.ticket(for: feed) == nil && sharedHost.ticket(for: player) == "ticket-player", "Nur die neueste WebView darf die gesamte Modellpipeline besitzen")
        await tick()
        await OnDeviceSummary.updates["feed-source"]!(.init())
        precondition(feed.replies.count == 1 && player.replies.isEmpty, "Alter Feed-Fortschritt darf keine WebView mehr erreichen")
        await OnDeviceSummary.updates["player-source"]!(.init())
        precondition(feed.replies.count == 1 && player.replies.count == 1 && player.replies[0].contains("__langformKurzUpdate") && player.replies[0].contains("ticket-player") && !player.replies[0].contains("ticket-feed"), "Player-Fortschritt gehört ausschließlich zur neuen Anfrage")
        OnDeviceSummary.pending.removeValue(forKey: "feed-source")!.resume(returning: ["summary": ["points": ["Verspäteter Feed"]]])
        await tick()
        precondition(feed.replies.count == 1 && player.replies.count == 1 && sharedHost.count == 1 && sharedHost.ticket(for: player) == "ticket-player", "Der alte Feed-Abschluss darf weder die neue Anfrage beantworten noch deren Lease entfernen")
        OnDeviceSummary.pending.removeValue(forKey: "player-source")!.resume(returning: ["summary": ["points": ["Aktueller Player"]]])
        await tick()
        precondition(feed.replies.count == 1 && player.replies.count == 2 && player.replies[1].contains("__langformKurzFinish") && player.replies[1].contains("ticket-player") && player.replies[1].contains("Aktueller Player") && sharedHost.count == 0, "Die neue Player-Anfrage muss trotz altem Feed-Abschluss normal fertig werden")

        // Execute the actual native timeout branch. Its cancellation is scoped
        // by both the originating WebView and the exact outstanding ticket.
        let timed = Host(), currentView = WKWebView(), otherView = WKWebView()
        timed.send("timeout-A", "timeout-source-A", currentView); await tick()
        let startedBeforeTimeout = OnDeviceSummary.started.count
        timed.timeout("unknown-ticket", currentView)
        timed.timeout("timeout-A", otherView)
        precondition(timed.count == 1 && timed.ticket(for: currentView) == "timeout-A" && currentView.replies.isEmpty,
          "Ein unbekanntes Ticket oder eine fremde WebView darf die aktuelle Anfrage nicht abbrechen")
        precondition(OnDeviceSummary.started.count == startedBeforeTimeout,
          "Eine Abbruchnachricht darf niemals als leere neue Modellanfrage behandelt werden")
        timed.timeout("timeout-A", currentView)
        precondition(timed.count == 0 && currentView.replies.isEmpty,
          "Der passende Timeout muss den nativen Task entfernen, ohne die bereits ablaufende UI-Frist durch CANCELLED zu ersetzen")
        timed.send("timeout-B", "timeout-source-B", currentView); await tick()
        timed.timeout("timeout-A", currentView)
        timed.timeout("timeout-B", otherView)
        precondition(timed.count == 1 && timed.ticket(for: currentView) == "timeout-B",
          "Ein verspäteter alter Timeout und die falsche WebView dürfen die neue Task-Lease nicht entfernen")
        await OnDeviceSummary.updates["timeout-source-A"]!(.init())
        OnDeviceSummary.pending.removeValue(forKey: "timeout-source-A")!.resume(returning: ["summary": ["points": ["Alter Timeout"]]])
        await tick()
        precondition(OnDeviceSummary.cancelledRequests.contains("timeout-source-A") && currentView.replies.isEmpty && timed.count == 1,
          "Der passende Timeout muss den echten Task canceln; sein späterer Fortschritt/Abschluss darf den Folgerequest nicht erreichen")
        await OnDeviceSummary.updates["timeout-source-B"]!(.init())
        OnDeviceSummary.pending.removeValue(forKey: "timeout-source-B")!.resume(returning: ["summary": ["points": ["Neue erfolgreiche Anfrage"]]])
        await tick()
        let startsAfterB = OnDeviceSummary.started.count
        timed.timeout("timeout-B", currentView)
        timed.timeout("unknown-ticket", otherView)
        precondition(timed.count == 0 && currentView.replies.count == 2 &&
          currentView.replies.allSatisfy { $0.contains("timeout-B") } &&
          !OnDeviceSummary.cancelledRequests.contains("timeout-source-B") &&
          OnDeviceSummary.started.count == startsAfterB && startsAfterB == startedBeforeTimeout + 1,
          "Eine normal abgeschlossene neue Anfrage bleibt erfolgreich; nachträgliche Timeouts starten keine Modellarbeit")

        // Execute the shipping 100ms reclaim suspension and pre-provider lease
        // gate. Cancellation must win before any model/source request begins.
        let reclaiming = Host(), reclaimView = WKWebView()
        reclaiming.reclaimsNext = true
        reclaiming.send("reclaim-A", "reclaim-source-A", reclaimView)
        await tick()
        precondition(!OnDeviceSummary.started.contains("reclaim-source-A"))
        reclaiming.resign()
        precondition(reclaiming.count == 0 && reclaimView.replies.count == 1 && reclaimView.replies[0].contains("CANCELLED"))
        reclaiming.send("reclaim-B", "reclaim-source-B", reclaimView)
        await tick()
        precondition(!OnDeviceSummary.started.contains("reclaim-source-A") && OnDeviceSummary.started.contains("reclaim-source-B"),
          "A revoked reclaim-waiting task must never restart model work or cancel the following request")
        OnDeviceSummary.pending.removeValue(forKey: "reclaim-source-B")!.resume(returning: ["summary": ["points": ["After reclaim"]]])
        await tick()
        precondition(reclaiming.count == 0 && reclaimView.replies.count == 2 && reclaimView.replies.last!.contains("reclaim-B"))
        precondition(GemmaSummary.unloadCalls == 0,
          "The normal host must not run diagnostic-only unload logic for ordinary user requests")
        print("SUMMARY_REQUEST_LIFECYCLE_OK")
    }
}
`);
  const binary = path.join(directory, "lifecycle");
  const compilation = spawnSync("xcrun", ["swiftc", "-module-cache-path", path.join(directory, "modules"), "-parse-as-library", harness, "-o", binary], { encoding: "utf8", timeout: 60000 });
  assert.equal(compilation.status, 0, compilation.stderr);
  const execution = spawnSync(binary, [], { encoding: "utf8", timeout: 5000 });
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /SUMMARY_REQUEST_LIFECYCLE_OK/);
});
