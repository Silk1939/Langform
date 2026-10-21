const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let directory, binary;
test.before(() => {
  if (process.platform !== 'darwin') return;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-gemma-document-'));
  binary = path.join(directory, 'document');
  const harness = path.join(directory, 'DocumentTest.swift');
  fs.writeFileSync(harness, String.raw`
import Foundation

@main struct DocumentTest {
    static let allowed: Set<Int> = [1, 2, 3]
    static let fence = String(repeating: String(UnicodeScalar(96)!), count: 3)
    static func claim(_ text: String = "Die Sprecher sehen Vor- und Nachteile.", ids: [Int] = [1]) -> [String: Any] {
        ["text": text, "evidenceIDs": ids]
    }
    static func point(_ text: String = "Die Sprecher sehen Vor- und Nachteile.", ids: [Int] = [1], role: String = "main") -> [String: Any] {
        ["role": role, "text": text, "evidenceIDs": ids]
    }
    static func fixture() -> [String: Any] {
        ["tldr": claim("Die Sprecher loben den Versuch, lassen die Dauerlösung offen.", ids: [1, 2]),
         "points": [point("Der Versuch dauert drei Monate.", role: "positive"), point("Die dauerhafte Finanzierung bleibt offen.", ids: [2, 3], role: "critical")],
         "takeaway": claim("Erst die Erprobung erlaubt eine Bewertung.", ids: [3])]
    }
    static func json(_ object: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), as: UTF8.self)
    }
    static func claimJSON(_ text: String, ids: [Int] = [1]) throws -> String {
        let encodedText = String(decoding: try JSONEncoder().encode(text), as: UTF8.self)
        return "{\"text\":" + encodedText + ",\"evidenceIDs\":" + (try json(ids)) + "}"
    }
    static func rejected(_ object: Any, allowedIDs: Set<Int> = allowed) throws {
        let input = try json(object)
        do {
            _ = try GemmaSummaryDocument.decode(input, allowedEvidenceIDs: allowedIDs)
            preconditionFailure("Invalid document accepted: " + input)
        } catch {}
    }
    static func main() throws {
        switch CommandLine.arguments[1] {
        case "render":
            let document = try GemmaSummaryDocument.decode(json(fixture()), allowedEvidenceIDs: allowed)
            let expected = "## TLDR\nDie Sprecher loben den Versuch, lassen die Dauerlösung offen.\n\n## Die wichtigsten Punkte\n* Der Versuch dauert drei Monate.\n* Die dauerhafte Finanzierung bleibt offen.\n\n## Das bleibt hängen\nErst die Erprobung erlaubt eine Bewertung."
            precondition(document.markdown == expected, "Rendering must preserve each accepted text exactly and add only fixed structure")
            precondition(!document.markdown.contains("evidenceIDs") && !document.markdown.contains("[1"))
            precondition(document.tldr.evidenceIDs == [1, 2])
            precondition(document.points.map(\.role) == ["positive", "critical"])
            precondition(document.points[1].claim.text == document.points[1].text && document.points[1].claim.evidenceIDs == [2, 3])
            let roundtrip = String(decoding: try JSONEncoder().encode(document), as: UTF8.self)
            let decoded = try GemmaSummaryDocument.decode(roundtrip, allowedEvidenceIDs: allowed)
            precondition(decoded.markdown == expected)
            var one = fixture(); one["points"] = [point("Ein kurzer Punkt reicht bei wenig Inhalt.")]
            _ = try GemmaSummaryDocument.decode(json(one), allowedEvidenceIDs: allowed)
            var five = fixture(); five["points"] = Array(repeating: point(), count: 5)
            let fiveDecoded = try GemmaSummaryDocument.decode(json(five), allowedEvidenceIDs: allowed)
            precondition(fiveDecoded.points.count == 5)
        case "schema":
            let text = try GemmaSummaryDocument.schema(allowedEvidenceIDs: [3, 1, 2, 1])
            let schema = try JSONSerialization.jsonObject(with: Data(text.utf8)) as! [String: Any]
            precondition(schema["type"] as? String == "object" && schema["additionalProperties"] as? Bool == false)
            precondition(schema["required"] as? [String] == ["tldr", "points", "takeaway"])
            let properties = schema["properties"] as! [String: Any]
            let tldr = properties["tldr"] as! [String: Any]
            precondition(tldr["additionalProperties"] as? Bool == false)
            precondition(tldr["required"] as? [String] == ["text", "evidenceIDs"])
            let fields = tldr["properties"] as! [String: Any]
            let textField = fields["text"] as! [String: Any]
            precondition(textField["minLength"] as? Int == 1 && textField["maxLength"] == nil)
            let evidence = fields["evidenceIDs"] as! [String: Any]
            precondition(evidence["minItems"] as? Int == 1 && evidence["maxItems"] as? Int == 3)
            precondition((evidence["items"] as! [String: Any])["enum"] as? [Int] == [1, 2, 3])
            let points = properties["points"] as! [String: Any]
            precondition(points["minItems"] as? Int == 1 && points["maxItems"] as? Int == 5)
            let pointSchema = points["items"] as! [String: Any]
            precondition(pointSchema["required"] as? [String] == ["role", "text", "evidenceIDs"])
            precondition(pointSchema["additionalProperties"] as? Bool == false)
            let pointProperties = pointSchema["properties"] as! [String: Any]
            precondition((pointProperties["role"] as! [String: Any])["enum"] as? [String] == ["positive", "critical", "main"])
            precondition(((pointProperties["evidenceIDs"] as! [String: Any])["items"] as! [String: Any])["enum"] as? [Int] == [1, 2, 3])
            precondition(text.range(of: "\"tldr\":")!.lowerBound < text.range(of: "\"points\":")!.lowerBound,
                "The constrained schema must emit TLDR before points for validated previews")
            for invalid in [[], [0], [-1], [1, -1]] as [[Int]] {
                do { _ = try GemmaSummaryDocument.schema(allowedEvidenceIDs: invalid); preconditionFailure("Invalid schema IDs accepted") }
                catch {}
            }
        case "unknownFields":
            var root = fixture(); root["extra"] = "must not be ignored"; try rejected(root)
            for name in ["tldr", "takeaway"] {
                var object = fixture()
                var value = claim(); value["unexpected"] = true; object[name] = value
                try rejected(object)
                var missing = claim(); missing.removeValue(forKey: "text"); object[name] = missing
                try rejected(object)
            }
            var extraPoint = point(); extraPoint["unchecked"] = "extra"
            var withPoint = fixture(); withPoint["points"] = [point(), extraPoint]; try rejected(withPoint)
            for name in ["tldr", "points", "takeaway"] {
                var missing = fixture(); missing.removeValue(forKey: name); try rejected(missing)
            }
        case "evidence":
            for ids in [[], [0], [-1], [4], [1, 1], [1, 2, 3, 1]] as [[Int]] {
                for field in ["tldr", "takeaway"] {
                    var object = fixture(); object[field] = claim(ids: ids); try rejected(object)
                }
                var object = fixture(); object["points"] = [point(), point(ids: ids)]; try rejected(object)
            }
            for invalid in [[true], ["1"], [1.25], NSNull()] as [Any] {
                var value = claim(); value["evidenceIDs"] = invalid
                var object = fixture(); object["tldr"] = value; try rejected(object)
            }
            try rejected(fixture(), allowedIDs: [])
            var valid = fixture(); valid["takeaway"] = claim("Drei konkrete Belege sind zulässig.", ids: [3, 1, 2])
            let decoded = try GemmaSummaryDocument.decode(json(valid), allowedEvidenceIDs: allowed)
            precondition(decoded.takeaway.evidenceIDs == [3, 1, 2], "Accepted evidence order is preserved")
        case "textAndWholeDocument":
            for text in ["", " ", "\t", " leading", "trailing ", "line\nline", "line\rline", "line\u{2028}line", "line\u{2029}line",
                         "# Heading", "##Heading", fence + "json", "~~~code", "<THINK>hidden</THINK>", "Text </think>", "<|channel>analysis"] {
                var object = fixture(); object["points"] = [point("Dieser erste Punkt ist gültig."), point(text)]
                try rejected(object)
            }
            for points in [[], Array(repeating: point(), count: 6)] as [[[String: Any]]] {
                var object = fixture(); object["points"] = points; try rejected(object)
            }
            var wrong = fixture(); wrong["tldr"] = "unstructured"; try rejected(wrong)
            let plain = "Die Quelle erwähnt {Klammern}, \"Zitate\" und C:\\Dateien unverändert."
            var exact = fixture(); exact["tldr"] = claim(plain)
            let decoded = try GemmaSummaryDocument.decode(json(exact), allowedEvidenceIDs: allowed)
            precondition(decoded.tldr.text == plain && decoded.markdown.contains(plain))
            for invalid in ["not JSON", fence + "json\n" + (try json(fixture())) + "\n" + fence, (try json(fixture())) + " trailing"] {
                do { _ = try GemmaSummaryDocument.decode(invalid, allowedEvidenceIDs: allowed); preconditionFailure("Malformed JSON accepted") }
                catch {}
            }
        case "pointRoles":
            for role in ["positive", "critical", "main"] {
                var object = fixture(); object["points"] = [point(role: role)]
                let document = try GemmaSummaryDocument.decode(json(object), allowedEvidenceIDs: allowed)
                precondition(document.points[0].role == role)
                precondition(!document.markdown.contains("role") && !document.markdown.contains("evidenceIDs"))
            }
            for role in ["", "context", "verdict", "Positive", "positive critical", "<script>"] {
                var object = fixture(); object["points"] = [point(), point(role: role)]; try rejected(object)
            }
            for role in [NSNull(), true, 1, []] as [Any] {
                var invalidPoint = point(); invalidPoint["role"] = role
                var object = fixture(); object["points"] = [point(), invalidPoint]; try rejected(object)
            }
            var missing = fixture(); missing["points"] = [claim()]; try rejected(missing)
            for field in ["tldr", "takeaway"] {
                var object = fixture(); object[field] = point(); try rejected(object)
            }
        case "previewPrefixes":
            let text = "Ein vollständig belegter TLDR."
            let prefix = "{\"tldr\":" + (try claimJSON(text))
            for length in 0..<prefix.count {
                precondition(GemmaSummaryDocument.preview(String(prefix.prefix(length)), allowedEvidenceIDs: allowed) == nil,
                    "An incomplete claim must never produce a visible preview")
            }
            for suffix in ["", ",", ",\"points\":[", ",\"points\":[{\"text\":\"incomplete"] {
                precondition(GemmaSummaryDocument.preview(prefix + suffix, allowedEvidenceIDs: allowed) == text)
                let claim = GemmaSummaryDocument.previewClaim(prefix + suffix, allowedEvidenceIDs: allowed)
                precondition(claim?.text == text && claim?.evidenceIDs == [1], "Preview validation must retain original IDs for the separate source-content gate")
            }
            precondition(GemmaSummaryDocument.preview(" \n\t" + prefix, allowedEvidenceIDs: allowed) == text)
            precondition(GemmaSummaryDocument.preview(prefix + "garbage", allowedEvidenceIDs: allowed) == nil)
            let completeClaim = try claimJSON(text)
            precondition(GemmaSummaryDocument.preview("{\"points\":[],\"tldr\":" + completeClaim, allowedEvidenceIDs: allowed) == nil,
                "Preview follows the schema's first-field TLDR contract")
            precondition(GemmaSummaryDocument.preview("{\"notTldr\":" + completeClaim, allowedEvidenceIDs: allowed) == nil)
        case "previewEscapes":
            for text in ["Die Sprecher sagen \"gut\"; Klammern } { bleiben Text.",
                         "Ein Pfad C:\\Videos\\ und eine Schlussklammer }.",
                         "Ein Backslash vor einem Zitat: \\\" und {noch} mehr.",
                         "Unicode: 🔬👨‍👩‍👧‍👦 漢字 ä e\u{301}."] {
                let prefix = "{\"tldr\":" + (try claimJSON(text, ids: [3, 1]))
                precondition(GemmaSummaryDocument.preview(prefix, allowedEvidenceIDs: allowed) == text)
            }
            let escapedKey = "{\"tl\\u0064r\":" + (try claimJSON("Ein gültiger TLDR."))
            precondition(GemmaSummaryDocument.preview(escapedKey, allowedEvidenceIDs: allowed) == "Ein gültiger TLDR.")
            precondition(GemmaSummaryDocument.preview("{\"tldr\":{\"text\":\"bad\\q\",\"evidenceIDs\":[1]}}", allowedEvidenceIDs: allowed) == nil)
        case "previewRejectedClaims":
            for ids in [[], [1, 1], [4], [0], [1, 2, 3, 1]] as [[Int]] {
                let prefix = "{\"tldr\":" + (try claimJSON("Kein sichtbarer ungeprüfter TLDR.", ids: ids))
                precondition(GemmaSummaryDocument.preview(prefix, allowedEvidenceIDs: allowed) == nil)
            }
            for text in ["", " ", " leading", "trailing ", "line\nline", "# Header", "<think>hidden", "<|channel>analysis"] {
                let invalidClaim = try claimJSON(text)
                precondition(GemmaSummaryDocument.preview("{\"tldr\":" + invalidClaim, allowedEvidenceIDs: allowed) == nil)
            }
            var extra = claim(); extra["unexpected"] = "no"
            let extraClaim = try json(extra)
            precondition(GemmaSummaryDocument.preview("{\"tldr\":" + extraClaim, allowedEvidenceIDs: allowed) == nil)
            precondition(GemmaSummaryDocument.preview("{\"tldr\":\"just text\"", allowedEvidenceIDs: allowed) == nil)
            precondition(GemmaSummaryDocument.preview("{\"tldr\":{\"text\":\"No IDs yet\"}", allowedEvidenceIDs: allowed) == nil)
        default: preconditionFailure("Unknown test mode")
        }
        print("GEMMA_SUMMARY_DOCUMENT_OK " + CommandLine.arguments[1])
    }
}
`);
  const source = path.join(__dirname, '../ios/Langform/Langform/GemmaSummaryDocument.swift');
  const build = spawnSync('xcrun', ['swiftc', '-parse-as-library', source, harness, '-o', binary], {
    encoding: 'utf8', timeout: 85000,
  });
  assert.equal(build.status, 0, build.stderr);
});

test.after(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }); });

for (const mode of ['render', 'schema', 'unknownFields', 'evidence', 'textAndWholeDocument', 'pointRoles',
  'previewPrefixes', 'previewEscapes', 'previewRejectedClaims']) {
  test(`actual Swift atomic summary document: ${mode}`, { skip: process.platform !== 'darwin' }, () => {
    const run = spawnSync(binary, [mode], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, new RegExp(`GEMMA_SUMMARY_DOCUMENT_OK ${mode}`));
  });
}
