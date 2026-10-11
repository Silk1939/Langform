const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Run the shipping result assembly independently of generated model wording.
// The source-completeness flag is transport evidence, not a model judgment.
test("native Teilquellen bleiben unvollständig, auch wenn alle verfügbaren Abschnitte verarbeitet sind", { timeout: 70000 }, t => {
  if (process.platform !== "darwin") return t.skip("Swift-Test benötigt macOS");
  const baseline = process.env.LANGFORM_SUMMARY_COVERAGE_BASELINE;
  const files = baseline ? [path.join(baseline, "OnDeviceSummary.swift"), path.join(baseline, "SafariWebExtensionHandler.swift")]
    : [path.join(__dirname, "../ios/Langform/Langform/OnDeviceSummary.swift"), path.join(__dirname, "../native/SafariWebExtensionHandler.swift")];
  const probes = files.map((file, index) => {
    const source = fs.readFileSync(file, "utf8");
    const start = source.indexOf('        var summary: [String: Any] = ["tldr":');
    const end = source.indexOf('\n        return ["summary": summary]', start) + '\n        return ["summary": summary]'.length;
    assert.ok(start >= 0 && end > start, "shipping result assembly not found");
    return `enum Probe${index} {
      struct Draft { var caveat = "" }
      static func cleanOutput(_ text: String) -> String { text }
      static func result(sourceIncomplete: Bool, processedSections: Int, total: Int, failedSections: Int = 0) -> [String: Any] {
        let tldr = "Kernaussage.", points = ["Ein Punkt."], takeaway = "Merksatz.", draft = Draft()
        let chunks = Array(repeating: "Abschnitt", count: total)
${source.slice(start, end)}
      }
      static func verify() {
        let fragment = result(sourceIncomplete: true, processedSections: 2, total: 2)["summary"] as! [String: Any]
        let partialCoverage = fragment["coverage"] as! [String: Any]
        precondition(partialCoverage["complete"] as? Bool == false, "Teilquelle darf nicht cachefähig als vollständig markiert werden")
        precondition(partialCoverage["processedSections"] as? Int == 2 && partialCoverage["totalSections"] as? Int == 2)
        precondition((fragment["caveat"] as? String)?.contains("unvollständige Untertitel") == true)
        precondition((fragment["caveat"] as? String)?.contains("2 von 2") != true, "Verarbeitungsfehler und fehlende Quellteile sind verschiedene Grenzen")
        let full = result(sourceIncomplete: false, processedSections: 2, total: 2)["summary"] as! [String: Any]
        precondition((full["coverage"] as! [String: Any])["complete"] as? Bool == true)
        precondition(full["caveat"] == nil)
        let failed = result(sourceIncomplete: false, processedSections: 1, total: 2, failedSections: 1)["summary"] as! [String: Any]
        precondition((failed["coverage"] as! [String: Any])["complete"] as? Bool == false)
        precondition((failed["caveat"] as? String)?.contains("1 von 2") == true)
        let both = result(sourceIncomplete: true, processedSections: 1, total: 2, failedSections: 1)["summary"] as! [String: Any]
        precondition((both["coverage"] as! [String: Any])["complete"] as? Bool == false)
        precondition((both["caveat"] as? String)?.contains("1 von 2") == true && (both["caveat"] as? String)?.contains("unvollständige Untertitel") == true)
      }
    }`;
  }).join("\n");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-summary-coverage-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const harness = path.join(directory, "Coverage.swift"), binary = path.join(directory, "coverage");
  fs.writeFileSync(harness, `import Foundation\n${probes}\n@main struct Main { static func main() { Probe0.verify(); Probe1.verify(); print("SOURCE_COVERAGE_OK") } }\n`);
  const compiled = spawnSync("xcrun", ["swiftc", "-parse-as-library", harness, "-o", binary], { encoding: "utf8", timeout: 60000 });
  assert.equal(compiled.status, 0, compiled.stderr);
  const ran = spawnSync(binary, [], { encoding: "utf8", timeout: 5000 });
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(ran.stdout, /SOURCE_COVERAGE_OK/);
});

test("Safari veröffentlicht den fertigen TLDR erst bei vollständiger Quelle und vollständiger Analyse", { timeout: 70000 }, t => {
  if (process.platform !== "darwin") return t.skip("Swift-Test benötigt macOS");
  const baseline = process.env.LANGFORM_SUMMARY_COVERAGE_BASELINE;
  const file = baseline ? path.join(baseline, "SafariWebExtensionHandler.swift") : path.join(__dirname, "../native/SafariWebExtensionHandler.swift");
  const source = fs.readFileSync(file, "utf8");
  const start = source.indexOf("        for try await snapshot in stream {");
  const end = source.indexOf("\n        // Collect the completed guided value", start);
  assert.ok(start >= 0 && end > start);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-summary-preview-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const harness = path.join(directory, "Preview.swift"), binary = path.join(directory, "preview");
  fs.writeFileSync(harness, `
import Foundation
struct Progress { var sourceIncomplete: Bool; var coverageIncomplete: Bool; var tldr: String? }
struct Snapshot { struct Content { var tldr: String?; var points: [String]? }; var content: Content }
enum Probe {
    static func checkDeadline(_ deadline: Date) throws { }
    static func completedTLDR(_ text: String?, pointsStarted: Bool) -> String? { pointsStarted ? text : nil }
    static func preview(sourceIncomplete: Bool, coverageIncomplete: Bool) async throws -> [String] {
        let deadline = Date.distantFuture
        var progress = Progress(sourceIncomplete: sourceIncomplete, coverageIncomplete: coverageIncomplete)
        var previews: [String] = []
        let onProgress: ((Progress) async -> Void)? = { if let text = $0.tldr { previews.append(text) } }
        let stream = AsyncThrowingStream<Snapshot, Error> { continuation in
            continuation.yield(Snapshot(content: .init(tldr: "Noch unfert", points: nil)))
            continuation.yield(Snapshot(content: .init(tldr: "Vollständige Kernaussage.", points: ["Punkt."])))
            continuation.yield(Snapshot(content: .init(tldr: "Vollständige Kernaussage.", points: ["Punkt."])))
            continuation.finish()
        }
${source.slice(start, end)}
        return previews
    }
}
@main struct Main {
    static func main() async throws {
        for sourceIncomplete in [false, true] {
            for coverageIncomplete in [false, true] {
                let previews = try await Probe.preview(sourceIncomplete: sourceIncomplete, coverageIncomplete: coverageIncomplete)
                precondition(previews == (sourceIncomplete || coverageIncomplete ? [] : ["Vollständige Kernaussage."]), "Native Teilquellen dürfen keine vollständige Vorschau veröffentlichen")
            }
        }
        print("SOURCE_PREVIEW_OK")
    }
}
`);
  const compiled = spawnSync("xcrun", ["swiftc", "-parse-as-library", harness, "-o", binary], { encoding: "utf8", timeout: 60000 });
  assert.equal(compiled.status, 0, compiled.stderr);
  const ran = spawnSync(binary, [], { encoding: "utf8", timeout: 5000 });
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(ran.stdout, /SOURCE_PREVIEW_OK/);
});
