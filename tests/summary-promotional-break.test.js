const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("nur ausdrücklich eingerahmte Werbeunterbrechung wird vor der Faktenanalyse entfernt", { timeout: 70000 }, t => {
  if (process.platform !== "darwin") return t.skip("Swift-Test benötigt macOS");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-promotional-break-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(__dirname, "..");
  const baseline = process.env.LANGFORM_SUMMARY_PROMOTIONAL_BASELINE;
  const files = baseline ? [path.join(baseline, "OnDeviceSummary.swift"), path.join(baseline, "SafariWebExtensionHandler.swift")]
    : [path.join(root, "ios/Langform/Langform/OnDeviceSummary.swift"), path.join(root, "native/SafariWebExtensionHandler.swift")];
  const harness = path.join(directory, "PromotionalBreak.swift"), binary = path.join(directory, "promotional-break");
  fs.writeFileSync(harness, `
import Foundation
@main struct PromotionalBreak {
    static func main() {
        let source = try! String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
        let start = source.range(of: "But first, a big thank you to Emma for sponsoring this video.")!
        let end = source.range(of: "Thanks for checking them out, and now on with the video.")!
        let expected = (String(source[..<start.lowerBound]) + " " + String(source[end.upperBound...])).replacingOccurrences(of: "\\\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        let intro = "Die Nacht in Silverlake City war teuer. "
        let outro = " Die Zimmer waren laut. Emma wurde später im Gespräch noch erwähnt."
        let commercial = "But first, a big thank you to Emma for sponsoring this video. Our code saves 5% on mattresses. Thanks for checking them out, and now on with the video."
        let cleaners: [(String) -> String] = [OnDeviceSummary.prepare, SafariOnDeviceSummary.prepare]
        for clean in cleaners {
            precondition(clean(source) == expected, "Das komplette Original außerhalb der klaren Emma-Werbepause muss erhalten bleiben")
            precondition(!clean(source).contains("up to 50% discount"), "Das bewiesene Werbeangebot gehört nicht in die Faktenbasis")
            precondition(clean(source).contains("best partner Emma has ever had"), "Spätere narrative Sponsor-Erwähnung darf nicht gelöscht werden")
            precondition(clean(intro + commercial + outro) == (intro + outro).replacingOccurrences(of: "\\\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines))
            let noReturn = intro + "But first, a big thank you to Emma for sponsoring this video. Our code saves 5% on mattresses. Danach fehlen Untertitel."
            precondition(clean(noReturn) == noReturn, "Ohne ausdrückliche Rückkehr kein Inhalt löschen")
            let noOffer = intro + "But first, a big thank you to Emma for sponsoring this video. Die Verantwortung von Sponsoren wird kritisch diskutiert. Thanks for checking them out, and now on with the video." + outro
            precondition(clean(noOffer) == noOffer, "Bloße Sponsoring-Erwähnung ist keine bewiesene Angebotsunterbrechung")
            for (open, close) in [(String(UnicodeScalar(34)!), String(UnicodeScalar(34)!)), ("„", "“"), ("“", "”")] {
                let quoted = intro + open + "Zitierte Werbung. " + commercial + close + outro
                precondition(clean(quoted) == quoted, "Auch nach einem Satz im Zitat bleibt Sponsoring-Text Quelleninhalt")
                let closedQuote = intro + open + "Keine Werbepause" + close + ". "
                let afterQuote = closedQuote + commercial + outro
                let afterQuoteExpected = (closedQuote + outro).replacingOccurrences(of: "\\\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
                precondition(clean(afterQuote) == afterQuoteExpected, "Ein geschlossenes Zitat darf spätere klare Werbung nicht blockieren")
            }
            let unframed = intro + "Emma sponsored this video. Our code saves 5%." + outro
            precondition(clean(unframed) == unframed, "Kein allgemeiner Schlüsselwortfilter")
            let tooLong = intro + "But first, a big thank you to Emma for sponsoring this video. Our code saves 5%. " + String(repeating: "Wichtige spätere Aussage. ", count: 400) + "Thanks for checking them out, and now on with the video." + outro
            precondition(clean(tooLong) == tooLong, "Ein entfernter Rückkehrsatz darf keine großen Quellenbereiche löschen")
            let doubled = intro + commercial + " Der Park ist teuer. " + commercial + outro
            let doubledExpected = (intro + " Der Park ist teuer. " + outro).replacingOccurrences(of: "\\\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
            precondition(clean(doubled) == doubledExpected, "Mehrere klar begrenzte Pausen lassen den Zwischentext erhalten")
        }
        print("PROMOTIONAL_BREAK_BOUNDARIES_OK")
    }
}
`);
  const architecture = process.arch === "arm64" ? "arm64" : "x86_64";
  const compiled = spawnSync("xcrun", ["swiftc", "-parse-as-library", "-target", `${architecture}-apple-macosx26.0`, ...files, harness, "-o", binary], { encoding: "utf8", timeout: 60000 });
  assert.equal(compiled.status, 0, compiled.stderr);
  const ran = spawnSync(binary, [path.join(root, "tests/fixtures/summary/europapark.en.txt")], { encoding: "utf8", timeout: 5000 });
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(ran.stdout, /PROMOTIONAL_BREAK_BOUNDARIES_OK/);
});
