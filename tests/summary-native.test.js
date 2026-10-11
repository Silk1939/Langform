const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Execute the actual shipping functions, including Unicode chunking and quote validation.
// No available model, network, or non-deterministic generated answer is needed here.
test("native Zusammenfassung erhält jede Quellenstelle und akzeptiert nur echte Originalbelege", { timeout: 70000 }, function (t) {
  if (process.platform !== "darwin") return t.skip("Swift-Test benötigt macOS");
  const compiler = spawnSync("xcrun", ["--find", "swiftc"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht installiert");
  const version = spawnSync("/usr/bin/sw_vers", ["-productVersion"], { encoding: "utf8" });
  if (Number.parseInt(version.stdout, 10) < 26) return t.skip("macOS 26 erforderlich");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "langform-summary-test-"));
  try {
    const harness = path.join(temporary, "SourceTest.swift");
    const binary = path.join(temporary, "source-test");
    fs.writeFileSync(harness, `
import Foundation
import FoundationModels

@main
struct SourceTest {
    static func main() async {
        let short = OnDeviceSummary.prepare("  Hallo [musik] Welt.\\nDer Anteil beträgt [99 Prozent].  ")
        precondition(short == "Hallo Welt. Der Anteil beträgt [99 Prozent].", "Kurze Quellen und Zahlen in Klammern bleiben vollständig")
        let source = (0..<180).map { "Abschnitt \\($0): Eine bedingte Finanzierung ist noch nicht zugesagt. " }.joined()
        let chunks = OnDeviceSummary.sections(for: source)
        precondition(chunks.count > 1)
        precondition(chunks.joined() == source, "Keine Quelle wird stillschweigend ausgelassen")
        precondition(chunks.allSatisfy { $0.utf8.count <= 3400 }, "UTF-8-Kontextbudget überschritten")
        let late = "Die abschließende Einschränkung verändert die Aussage."
        let withEnding = OnDeviceSummary.sections(for: source + late)
        precondition(withEnding.last!.hasSuffix(late), "Die letzte Einschränkung bleibt erhalten")
        let unicode = String(repeating: "🔬漢字ä", count: 2200)
        let unicodeChunks = OnDeviceSummary.sections(for: unicode)
        precondition(unicodeChunks.joined() == unicode && unicodeChunks.allSatisfy { $0.utf8.count <= 3400 }, "Unicode ohne Wortgrenzen bleibt vollständig")
        precondition(OnDeviceSummary.contextEdge(unicode, suffix: false).utf8.count <= 350)
        precondition(OnDeviceSummary.contextEdge(unicode, suffix: true).utf8.count <= 350)
        precondition(OnDeviceSummary.sections(for: "").isEmpty)
        precondition(SafariOnDeviceSummary.prepare(source) == OnDeviceSummary.prepare(source))
        precondition(SafariOnDeviceSummary.sections(for: source) == chunks, "Safari und iOS verarbeiten dieselbe vollständige Quelle")
        for text in [source + late, unicode, "", "Kurze vollständige Quelle."] {
            let packed = try! await SafariOnDeviceSummary.packedSections(for: text) { $0.utf8.count <= 7800 }
            precondition(packed.joined() == text, "Auch größere Abschnitte erhalten jedes Zeichen in Reihenfolge")
            for index in packed.indices {
                let previous = index > 0 ? SafariOnDeviceSummary.contextEdge(packed[index - 1], suffix: true) : ""
                let next = index + 1 < packed.count ? SafariOnDeviceSummary.contextEdge(packed[index + 1], suffix: false) : ""
                precondition((previous + packed[index] + next).utf8.count <= 7800, "Nachbarkontext muss ins Budget passen")
            }
            if text == source + late {
                precondition(packed.count < chunks.count, "Passende Nachbarabschnitte sparen Modelldurchläufe")
                precondition(packed.last!.hasSuffix(late), "Eine späte Einschränkung darf nicht verloren gehen")
            }
        }
        let exact = String(repeating: "a", count: 1700)
        let exactPacked = try! await SafariOnDeviceSummary.packedSections(for: exact) { $0.utf8.count <= 1700 }
        precondition(exactPacked == [exact], "Genau passendes Budget ist erlaubt")
        do {
            _ = try await SafariOnDeviceSummary.packedSections(for: exact) { $0.utf8.count < 1700 }
            preconditionFailure("Ein übergroßer Einzelabschnitt braucht den konservativen Fallback")
        } catch SafariOnDeviceSummary.ContextBudgetError.sectionTooLarge { }
        catch { preconditionFailure("Falscher Budgetfehler") }
        do {
            _ = try await SafariOnDeviceSummary.packedSections(for: source) { _ in throw CancellationError() }
            preconditionFailure("Abbruch wurde ignoriert")
        } catch is CancellationError { }
        catch { preconditionFailure("Falscher Abbruchfehler") }
        let claims = [
            OnDeviceSummary.EvidencePoint(statement: "Die Finanzierung ist offen.", quote: "noch nicht zugesagt"),
            OnDeviceSummary.EvidencePoint(statement: "Die Finanzierung steht fest.", quote: "Der Bund bezahlt alles"),
            OnDeviceSummary.EvidencePoint(statement: "Die Finanzierung ist offen.", quote: "noch nicht zugesagt"),
            OnDeviceSummary.EvidencePoint(statement: "Nicht belegter Wert", quote: "99")
        ]
        let verified = OnDeviceSummary.grounded(claims, in: source)
        precondition(verified.count == 1 && verified.first!.statement == "Die Finanzierung ist offen.", "Erfundene Zitate und Dopplungen dürfen nicht in die Schlussfassung")
        let parsed = OnDeviceSummary.parseSummary("## TLDR\\nDer Versuch soll die Fahrzeit verkürzen.\\n## Die wichtigsten Punkte\\n* Die Finanzierung ist noch nicht zugesagt.\\n  Der Bund könnte sich beteiligen.\\n* **Eine Entscheidung** fällt nach dem Versuch.\\n## Das bleibt hängen\\nDie Verbesserung ist ein Ziel. Unnötiger Nachsatz.\\n## Wichtige Einordnung\\nDas ist ein geplanter Versuch.")!
        precondition(parsed.points.count == 2 && parsed.points[0].contains("könnte"))
        precondition(parsed.points[1] == "Eine Entscheidung fällt nach dem Versuch.")
        precondition(parsed.takeaway == "Die Verbesserung ist ein Ziel.", "Ein Merksatz bleibt ein Satz")
        precondition(parsed.caveat == "Das ist ein geplanter Versuch.")
        precondition(OnDeviceSummary.parseSummary("Nur irgend ein Text") == nil, "Fehlende Abschnitte dürfen nicht als fertige Kurzfassung erscheinen")
        precondition(SafariOnDeviceSummary.completedTLDR("Noch nicht vollstän", pointsStarted: false) == nil)
        precondition(SafariOnDeviceSummary.completedTLDR("Die Bahn soll schneller fahren.", pointsStarted: true) == "Die Bahn soll schneller fahren.", "Nur ein vollständig generiertes Feld wird vorab gezeigt")
        precondition(SafariOnDeviceSummary.completedTLDR("[ZU_WENIG_INHALT]", pointsStarted: true) == nil)
        precondition(SafariOnDeviceSummary.completedTLDR(nil, pointsStarted: true) == nil)
        precondition(SafariOnDeviceSummary.completedTLDR(String(repeating: "a", count: 2001), pointsStarted: true) == nil)
        let excessive = "## TLDR\\nKern.\\n## Die wichtigsten Punkte\\n" + (0..<9).map { "* Punkt \\($0)." }.joined(separator: "\\n") + "\\n## Das bleibt hängen\\nMerksatz."
        precondition(OnDeviceSummary.parseSummary(excessive) == nil, "Keine wichtigen Punkte still auf acht abschneiden")
        do { try OnDeviceSummary.checkDeadline(Date.distantPast); preconditionFailure("Frist wurde ignoriert") }
        catch OnDeviceSummary.GenerationDeadline.reached { }
        catch { preconditionFailure("Falscher Fristfehler") }
        precondition(OnDeviceSummary.availabilityFailure(.available) == nil)
        let reasons: [(SystemLanguageModel.Availability.UnavailableReason, String)] = [
            (.deviceNotEligible, "deviceNotEligible"), (.appleIntelligenceNotEnabled, "appleIntelligenceNotEnabled"), (.modelNotReady, "modelNotReady")
        ]
        for (reason, name) in reasons {
            let iosReply = OnDeviceSummary.availabilityFailure(.unavailable(reason))!
            let safariReply = SafariOnDeviceSummary.availabilityFailure(.unavailable(reason))!
            precondition(iosReply["code"] as? String == "MODEL_UNAVAILABLE")
            precondition(iosReply["reason"] as? String == name)
            precondition(iosReply["message"] as? String == safariReply["message"] as? String)
            precondition(iosReply["message"] as? String != OnDeviceSummary.unavailableMessage, "Ein bekannter Grund braucht eine konkrete Meldung")
        }
        let missing = await OnDeviceSummary.reply(for: "   ")
        let unusable = await OnDeviceSummary.reply(for: "[musik] [Applaus] 123 ...")
        precondition(missing["code"] as? String == "MISSING_CAPTIONS")
        precondition(unusable["code"] as? String == "UNUSABLE_CAPTIONS")
        print("FULL_SOURCE_AND_GROUNDING_OK")
    }
}
`);
    const architecture = process.arch === "arm64" ? "arm64" : "x86_64";
    const compilation = spawnSync("xcrun", [
      "swiftc", "-parse-as-library", "-target", `${architecture}-apple-macosx26.0`,
      path.join(__dirname, "../ios/Langform/Langform/OnDeviceSummary.swift"),
      path.join(__dirname, "../native/SafariWebExtensionHandler.swift"),
      harness, "-o", binary,
    ], { encoding: "utf8", timeout: 60000 });
    assert.equal(compilation.error, undefined, String(compilation.error));
    assert.equal(compilation.status, 0, compilation.stderr);
    const execution = spawnSync(binary, [], { encoding: "utf8", timeout: 5000 });
    assert.equal(execution.error, undefined, String(execution.error));
    assert.equal(execution.status, 0, execution.stderr);
    assert.match(execution.stdout, /FULL_SOURCE_AND_GROUNDING_OK/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
