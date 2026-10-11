const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Safari beantwortet native Anfragen asynchron, ohne den MainActor zu blockieren", {
  skip: process.platform !== "darwin",
  timeout: 70000,
}, function (t) {
  const version = spawnSync("/usr/bin/sw_vers", ["-productVersion"], { encoding: "utf8" });
  if (version.status === 0 && Number.parseInt(version.stdout, 10) < 26) {
    t.skip("Der native Handler-Test benötigt macOS 26 oder neuer.");
    return;
  }
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swiftc"], { encoding: "utf8" });
  if (compiler.status !== 0) {
    t.skip("Der native Handler-Test benötigt den Swift-Compiler aus Xcode.");
    return;
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-native-test-"));
  try {
    const harness = path.join(directory, "Lifecycle.swift");
    const binary = path.join(directory, "lifecycle");
    fs.writeFileSync(harness, `
import Foundation
import SafariServices

final class ProbeContext: NSExtensionContext {
    private let payload = NSExtensionItem()
    var onComplete: (([String: Any]) -> Void)?
    var completionCount = 0

    override init() {
        super.init()
        // Leertext antwortet ohne Apple-Modell, Netzwerk oder lange Generierung.
        payload.userInfo = [SFExtensionMessageKey: ["text": ""]]
    }
    init(message: [String: Any], profile: UUID? = nil) {
        super.init()
        payload.userInfo = [SFExtensionMessageKey: message]
        if let profile { payload.userInfo?[SFExtensionProfileKey] = profile }
    }
    required init?(coder: NSCoder) { fatalError("unused") }
    override var inputItems: [Any] { [payload] }

    override func completeRequest(returningItems items: [Any]?, completionHandler: ((Bool) -> Void)? = nil) {
        completionCount += 1
        precondition(completionCount == 1, "Request completed more than once")
        let item = items?.first as? NSExtensionItem
        let reply = item?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]
        onComplete?(reply)
        onComplete = nil
        completionHandler?(false)
    }
}

@main
struct LifecycleTest {
    @MainActor
    static func request(_ handler: SafariWebExtensionHandler, _ message: [String: Any], profile: UUID? = nil) async -> [String: Any] {
        await withCheckedContinuation { continuation in
            let context = ProbeContext(message: message, profile: profile)
            context.onComplete = { continuation.resume(returning: $0) }
            handler.beginRequest(with: context)
        }
    }

    @MainActor
    static func main() async {
        let handler = SafariWebExtensionHandler()
        var didReturn = false
        let reply: [String: Any] = await withCheckedContinuation { continuation in
            var context: ProbeContext? = ProbeContext()
            weak var retainedContext = context
            context!.onComplete = { reply in
                precondition(didReturn, "Completion must be asynchronous")
                continuation.resume(returning: reply)
            }
            let started = Date()
            handler.beginRequest(with: context!)
            precondition(Date().timeIntervalSince(started) < 0.5, "beginRequest blocked")
            didReturn = true
            context = nil
            precondition(retainedContext != nil, "Task must retain its request context")
        }
        precondition(reply["message"] as? String == SafariOnDeviceSummary.missingCaptionsMessage)
        precondition(reply["code"] as? String == "MISSING_CAPTIONS")
        let requestId = "summary-test-123456"
        let profile = UUID()
        let store = SafariSummaryProgressStore.shared
        let key = SafariSummaryProgressStore.key(requestId: requestId, profile: profile.uuidString)!
        precondition(SafariSummaryProgressStore.key(requestId: "short", profile: "x") == nil)
        precondition(SafariSummaryProgressStore.key(requestId: String(repeating: "a", count: 97), profile: "x") == nil)
        let lease = store.begin(key)
        store.update(key, lease: lease, progress: SafariSummaryProgress(phase: "writing", processedSections: 1, totalSections: 1, tldr: "Die Kernaussage steht fest."))
        let progressReply = await request(handler, ["operation": "summaryStatus", "requestId": requestId], profile: profile)
        let progress = progressReply["progress"] as! [String: Any]
        precondition(progress["tldr"] as? String == "Die Kernaussage steht fest.")
        precondition(progressReply["summary"] == nil, "Fortschritt ist kein fertiges Ergebnis")
        let foreign = await request(handler, ["operation": "summaryStatus", "requestId": requestId], profile: UUID())
        precondition(foreign["progress"] is NSNull, "Profile dürfen fremden Fortschritt nicht sehen")
        let missingStatus = await request(handler, ["operation": "summaryStatus", "requestId": "summary-unknown-123"])
        precondition(missingStatus["progress"] is NSNull && missingStatus["code"] == nil, "Statusabfragen dürfen keine Generierung starten")
        let replacement = store.begin(key)
        store.finish(key, lease: lease)
        precondition(store.snapshot(for: key) != nil, "Ein alter Abschluss darf keinen neueren Auftrag löschen")
        store.finish(key, lease: replacement)
        precondition(store.snapshot(for: key) == nil, "Abgeschlossene Anfragen hinterlassen keinen Entwurf")
        let old = Date(timeIntervalSince1970: 100)
        _ = store.begin("expired", now: old)
        precondition(store.snapshot(for: "expired", now: old.addingTimeInterval(601)) == nil, "Verwaiste Vorschauen laufen ab")
        let bounded = SafariSummaryProgressStore()
        for index in 0..<40 { _ = bounded.begin(String(index), now: old.addingTimeInterval(Double(index))) }
        precondition(bounded.snapshot(for: "0", now: old.addingTimeInterval(41)) == nil)
        precondition(bounded.snapshot(for: "39", now: old.addingTimeInterval(41)) != nil)
        // Ein versehentlich doppelt geplanter Abschluss muss ebenfalls auffallen.
        try? await Task.sleep(for: .milliseconds(50))
        print("NATIVE_LIFECYCLE_OK")
    }
}
`);
    const architecture = process.arch === "arm64" ? "arm64" : "x86_64";
    const compilation = spawnSync("/usr/bin/xcrun", [
      "swiftc", "-parse-as-library", "-target", `${architecture}-apple-macosx26.0`,
      path.join(__dirname, "..", "native", "SafariWebExtensionHandler.swift"),
      harness, "-o", binary,
    ], { encoding: "utf8", timeout: 60000 });
    assert.equal(compilation.error, undefined, String(compilation.error));
    assert.equal(compilation.status, 0, compilation.stderr);

    // Die frühere RunLoop-Schleife blockiert hier dauerhaft und wird beendet.
    const execution = spawnSync(binary, [], { encoding: "utf8", timeout: 5000 });
    assert.equal(execution.error, undefined, String(execution.error));
    assert.equal(execution.status, 0, execution.stderr);
    assert.match(execution.stdout, /NATIVE_LIFECYCLE_OK/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
