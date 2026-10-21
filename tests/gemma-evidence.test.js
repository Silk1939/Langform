const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let directory, binary;
test.before(() => {
  if (process.platform !== 'darwin') return;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-gemma-evidence-v14-'));
  binary = path.join(directory, 'evidence');
  const harness = path.join(directory, 'EvidenceTest.swift');
  fs.writeFileSync(harness, String.raw`
import Foundation

@main struct EvidenceTest {
  static let fixed: [String] = (1...10).map { id in
    let marker = "[SOURCE-\(id)]"
    return marker + String(repeating: "x", count: 450 - marker.count)
  }
  static var source: String { fixed.joined() }
  static func plan(_ verdict: [Int], positive: [Int] = [], critical: [Int] = [], context: [Int] = []) -> String {
    let value = ["verdict": verdict, "positive": positive, "critical": critical, "context": context]
    return String(decoding: try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self)
  }
  static func selection(_ ids: [Int]) -> String {
    precondition(ids.count <= 8)
    var cursor = 0
    var groups = [[Int]]()
    for limit in [2,2,2,2] {
      let end = min(ids.count, cursor + limit)
      groups.append(Array(ids[cursor..<end]))
      cursor = end
    }
    return plan(groups[0], positive: groups[1], critical: groups[2], context: groups[3])
  }
  static func accepts(_ output: String, count: Int = 10, equals expected: [Int]) throws {
    let actual = try GemmaEvidence.selectedIDs(output, count: count)
    precondition(actual == expected, "Accepted IDs must be unique and in source order")
  }
  static func rejected(_ output: String, count: Int = 10, as expected: String) {
    do {
      _ = try GemmaEvidence.selectedIDs(output, count: count)
      preconditionFailure("Unexpected accepted plan: " + output)
    } catch GemmaEvidenceError.malformed {
      precondition(expected == "malformed", "Expected " + expected + ", got malformed")
    } catch GemmaEvidenceError.ungrounded {
      precondition(expected == "ungrounded", "Expected " + expected + ", got ungrounded")
    } catch GemmaEvidenceError.insufficient {
      precondition(expected == "insufficient", "Expected " + expected + ", got insufficient")
    } catch { preconditionFailure("Unexpected error: " + String(describing: error)) }
  }
  static func checkReconstruction(_ input: String) {
    let blocks = GemmaEvidence.blocks(in: input)
    precondition(Data(blocks.joined().utf8) == Data(input.utf8), "Every original byte and Unicode cluster survives")
    precondition(blocks.allSatisfy { !$0.isEmpty && $0.count <= 450 })
    precondition(input.isEmpty == blocks.isEmpty)
  }
  static func passages(_ ids: [Int], equal expected: [String]) throws {
    let actual = try GemmaEvidence.validate(selection(ids), in: source)
    precondition(actual == expected, "Neighbour passages must be untouched, merged and in source order")
  }

  static func main() throws {
    switch CommandLine.arguments[1] {
    case "reconstruction":
      for input in ["", "Kurz.", String(repeating: "a", count: 1801),
                    String(repeating: "🔬👨‍👩‍👧‍👦漢字e\u{301}ä ", count: 300),
                    String(repeating: "Das ist ein vollständiger Satz. Danach folgt ein anderer! Noch offen?\n", count: 80),
                    String(repeating: "einLangesWortOhneGrenze", count: 130),
                    "  Anfang bleibt. " + String(repeating: "Text ", count: 250) + " Ende bleibt.  "] {
        checkReconstruction(input)
      }
      precondition(GemmaEvidence.blocks(in: String(repeating: "a", count: 1801)).map(\.count) == [450,450,450,450,1])
      let sentence = String(repeating: "a", count: 250) + ". " + String(repeating: "b", count: 500)
      precondition(GemmaEvidence.blocks(in: sentence).first == String(repeating: "a", count: 250) + ". ")
      let word = String(repeating: "a", count: 300) + " " + String(repeating: "b", count: 500)
      precondition(GemmaEvidence.blocks(in: word).first == String(repeating: "a", count: 300) + " ")
    case "fixtures":
      let root = URL(fileURLWithPath: CommandLine.arguments[2])
      for name in ["europapark.en.txt", "heidepark.de.txt"] {
        let bytes = try Data(contentsOf: root.appendingPathComponent(name))
        let original = String(data: bytes, encoding: .utf8)!
        precondition(bytes.count > 24_000)
        checkReconstruction(original)
        let blocks = GemmaEvidence.blocks(in: original)
        let lines = GemmaEvidence.numberedSource(original).components(separatedBy: "\n")
        precondition(lines.count == blocks.count)
        var rebuilt = ""
        for (index, line) in lines.enumerated() {
          let prefix = "[\(index + 1)] "
          precondition(line.hasPrefix(prefix))
          rebuilt += line.dropFirst(prefix.count)
        }
        precondition(Data(rebuilt.utf8) == bytes, "Every complete fixture byte remains in the numbered source")
      }
    case "numbering":
      precondition(GemmaEvidence.numberedSource("") == "")
      precondition(GemmaEvidence.numberedSource("Kurz.") == "[1] Kurz.")
      precondition(GemmaEvidence.blocks(in: source) == fixed)
      let expected = fixed.enumerated().map { "[\($0.offset + 1)] " + $0.element }.joined(separator: "\n")
      precondition(GemmaEvidence.numberedSource(source) == expected)
      let misleading = "Die Quelle erwähnt [9999], aber das ist keine vergebene ID."
      checkReconstruction(misleading)
      rejected(plan([9999]), count: 1, as: "ungrounded")
    case "types":
      for raw in ["", "not JSON", "null", "1", "true", #""1""#, "[]", "[1]", "{}",
                  #"{"verdict":[1],"positive":[],"critical":[]}"#,
                  #"{"verdict":[1],"positive":[],"critical":[],"context":[],"extra":[]}"#,
                  #"{"verdict":[true],"positive":[],"critical":[],"context":[]}"#,
                  #"{"verdict":["1"],"positive":[],"critical":[],"context":[]}"#,
                  #"{"verdict":[1.5],"positive":[],"critical":[],"context":[]}"#,
                  #"{"verdict":[null],"positive":[],"critical":[],"context":[]}"#,
                  #"{"verdict":[[1]],"positive":[],"critical":[],"context":[]}"#,
                  #"{"verdict":[{"id":1}],"positive":[],"critical":[],"context":[]}"#,
                  #"{"verdict":1,"positive":[],"critical":[],"context":[]}"#,
                  #"{"verdict":[1],"positive":false,"critical":[],"context":[]}"#,
                  plan([1]) + " trailing"] {
        rejected(raw, as: "malformed")
      }
      try accepts(plan([1]), equals: [1])
      try accepts(plan([3,1], positive: [2]), equals: [1,2,3])
    case "bounds":
      for raw in [plan([0]), plan([-1]), plan([11]), plan([1], critical: [11])] {
        rejected(raw, as: "ungrounded")
      }
      rejected(plan([1]), count: 0, as: "ungrounded")
      rejected(plan([1]), count: -3, as: "ungrounded")
      rejected(plan([1,2,3]), as: "malformed")
      rejected(plan([1], positive: [2,3,4]), as: "malformed")
      rejected(plan([1], critical: [2,3,4]), as: "malformed")
      rejected(plan([1], context: [2,3,4]), as: "malformed")
      rejected(plan([1,2], positive: [3,4,5], critical: [6,7,8], context: [9,10,11]), count: 11, as: "malformed")
      try accepts(selection([8,7,6,5,4,3,2,1]), equals: Array(1...8))
      rejected(plan([], positive: [1]), as: "malformed")
      rejected(plan([], critical: [1]), as: "malformed")
      rejected(plan([], context: [1]), as: "malformed")
    case "duplicates":
      let repeated = plan([2,1], positive: [2,4], critical: [4,1], context: [2])
      try accepts(repeated, equals: [1,2,4])
      let unique = try GemmaEvidence.validate(selection([1,2,4]), in: source)
      let repeatedPassages = try GemmaEvidence.validate(repeated, in: source)
      precondition(unique == repeatedPassages)
    case "context":
      try passages([1], equal: [fixed[0...2].joined()])
      try passages([10], equal: [fixed[7...9].joined()])
      try passages([5], equal: [fixed[2...6].joined()])
      try passages([2,3], equal: [fixed[0...4].joined()])
      try passages([2,4], equal: [fixed[0...5].joined()])
      try passages([2,5], equal: [fixed[0...6].joined()])
      try passages([2,6], equal: [fixed[0...7].joined()])
      try passages([10,2,2], equal: [fixed[0...3].joined(), fixed[7...9].joined()])
      let distant = (1...60).map { id in
        let marker = "[DISTANT-\(id)]"
        return marker + String(repeating: "z", count: 450 - marker.count)
      }
      let chosen = selection([45,3,15,9,21,27,33,39])
      let actual = try GemmaEvidence.validate(chosen, in: distant.joined())
      let expected = stride(from: 0, through: 42, by: 6).map { distant[$0...($0 + 4)].joined() }
      precondition(actual == expected, "Eight IDs retain exactly forty unchanged blocks in source order")
      precondition(actual.allSatisfy { distant.joined().contains($0) })
      precondition(actual.reduce(0) { $0 + $1.count } == 40 * 450)
      let included = try GemmaEvidence.includedIDs(chosen, in: distant.joined())
      let expectedIDs = stride(from: 1, through: 43, by: 6).flatMap { Array($0...($0 + 4)) }
      precondition(included == expectedIDs && !included.contains(6))
      let short = try GemmaEvidence.validate(plan([1]), in: "Kurz.")
      precondition(short == ["Kurz."])
      do {
        _ = try GemmaEvidence.validate(plan([2], critical: [999]), in: source)
        preconditionFailure("A valid role cannot conceal an invalid role")
      } catch GemmaEvidenceError.ungrounded {}
    case "fences":
      let fence = String(repeating: String(UnicodeScalar(96)!), count: 3)
      for raw in [plan([2,1]), fence + "json\n" + plan([2,1]) + "\n" + fence,
                  fence + "\n" + plan([2,1]) + "\n" + fence] {
        try accepts(raw, equals: [1,2])
      }
      rejected("Here is the plan: " + plan([1]), as: "malformed")
    case "insufficient":
      rejected(plan([]), as: "insufficient")
      rejected(" \n" + plan([]) + "\t ", count: 0, as: "insufficient")
      rejected("[]", as: "malformed")
      rejected("[ZU_WENIG_INHALT]", as: "malformed")
    case "schema":
      func checkSchema(_ input: String, expectedIDs: [Int]) throws {
        let text = try GemmaEvidence.selectionSchema(for: input)
        let propertyStart = text.range(of: "\"properties\":")!.upperBound
        let requiredStart = text.range(of: "\"required\":", range: propertyStart..<text.endIndex)!.lowerBound
        let body = text[propertyStart..<requiredStart]
        let order = ["verdict", "positive", "critical", "context"].map { role in
          body.range(of: "\"" + role + "\":")!.lowerBound
        }
        precondition(zip(order, order.dropFirst()).allSatisfy { $0 < $1 },
          "The actual grammar must choose the overall judgment before reasons and context")
        let value = try JSONSerialization.jsonObject(with: Data(text.utf8)) as! [String: Any]
        precondition(value["type"] as? String == "object")
        precondition(value["additionalProperties"] as? Bool == false)
        precondition(Set(value["required"] as! [String]) == Set(["verdict","positive","critical","context"]))
        let properties = value["properties"] as! [String: [String: Any]]
        precondition(Set(properties.keys) == Set(["verdict","positive","critical","context"]))
        for (role, maximum) in [("verdict",2),("positive",2),("critical",2),("context",2)] {
          let field = properties[role]!
          precondition(field["type"] as? String == "array")
          precondition(field["minItems"] as? Int == 0 && field["maxItems"] as? Int == maximum)
          let items = field["items"] as! [String: Any]
          precondition(items["type"] as? String == "integer")
          precondition(items["enum"] as? [Int] == expectedIDs, "Every role may reference only actual source IDs")
        }
      }
      try checkSchema("", expectedIDs: [])
      try checkSchema("Kurz.", expectedIDs: [1])
      try checkSchema(source, expectedIDs: Array(1...10))
      let root = URL(fileURLWithPath: CommandLine.arguments[2])
      for name in ["europapark.en.txt", "heidepark.de.txt"] {
        let full = try String(contentsOf: root.appendingPathComponent(name), encoding: .utf8)
        let count = GemmaEvidence.blocks(in: full).count
        precondition(count > 10)
        try checkSchema(full, expectedIDs: Array(1...count))
      }
    case "evidence-numbering":
      let ids = [1,2,3,4,8,9,10]
      let chosen = plan([10], positive: [2,2])
      let included = try GemmaEvidence.includedIDs(chosen, in: source)
      precondition(included == ids)
      let numbered = try GemmaEvidence.numberedEvidence(chosen, in: source)
      let expected = ids.map { "[\($0)] " + fixed[$0 - 1] }.joined(separator: "\n")
      precondition(Data(numbered.utf8) == Data(expected.utf8))
      let short = try GemmaEvidence.numberedEvidence(plan([1]), in: "Kurz.")
      precondition(short == "[1] Kurz.")
      do {
        _ = try GemmaEvidence.numberedEvidence(plan([]), in: source)
        preconditionFailure("An insufficient plan cannot produce writer evidence")
      } catch GemmaEvidenceError.insufficient {}
      let root = URL(fileURLWithPath: CommandLine.arguments[2])
      for name in ["europapark.en.txt", "heidepark.de.txt"] {
        let full = try String(contentsOf: root.appendingPathComponent(name), encoding: .utf8)
        let blocks = GemmaEvidence.blocks(in: full)
        let chosen = plan([blocks.count], positive: [1])
        let expectedIDs = Array(1...3) + Array((blocks.count - 2)...blocks.count)
        let actualIDs = try GemmaEvidence.includedIDs(chosen, in: full)
        precondition(actualIDs == expectedIDs)
        let numbered = try GemmaEvidence.numberedEvidence(chosen, in: full)
        let expected = expectedIDs.map { "[\($0)] " + blocks[$0 - 1] }.joined(separator: "\n")
        precondition(Data(numbered.utf8) == Data(expected.utf8))
      }
    case "roles":
      let chosen = plan([10], positive: [2], critical: [8], context: [1])
      let text = try GemmaEvidence.planEvidence(chosen, in: source)
      precondition(text.contains("Gesamturteil (verdict): [10]\nZugehöriger Kontext: [8,9,10]"))
      precondition(text.contains("Positive Erfahrungen (positive): [2]\nZugehöriger Kontext: [1,2,3,4]"))
      precondition(text.contains("Konkrete Kritik (critical): [8]\nZugehöriger Kontext: [6,7,8,9,10]"))
      precondition(text.contains("Notwendige Einordnung (context): [1]\nZugehöriger Kontext: [1,2,3]"))
      let union = try GemmaEvidence.numberedEvidence(chosen, in: source)
      precondition(text.components(separatedBy: union).count == 2, "All role context is supplied once as the unchanged union")
      for id in [1,2,3,4,6,7,8,9,10] {
        precondition(text.components(separatedBy: "[\(id)] " + fixed[id - 1]).count == 2)
      }
      precondition(!text.contains(fixed[4]), "Role context must not fill unselected gaps")
    case "writer":
      let chosen = plan([10], positive: [2,2])
      let prompt = try GemmaSummaryPolicy.writerPrompt(for: chosen, source: source)
      precondition(prompt.hasPrefix(GemmaSummaryPolicy.verificationPrompt))
      precondition(prompt.contains("<originalstellen>\n") && prompt.hasSuffix("\n</originalstellen>"))
      let roleEvidence = try GemmaEvidence.planEvidence(chosen, in: source)
      precondition(prompt.components(separatedBy: roleEvidence).count == 2)
      for gap in fixed[4...6] { precondition(!prompt.contains(gap)) }
      let first = GemmaSummaryPolicy.prompt(for: source)
      precondition(first.components(separatedBy: GemmaEvidence.numberedSource(source)).count == 2)
      do {
        _ = try GemmaSummaryPolicy.writerPrompt(for: plan([999]), source: source)
        preconditionFailure("Invalid roles cannot build a writer prompt")
      } catch GemmaEvidenceError.ungrounded {}
    default: preconditionFailure("Unknown test mode")
    }
    print("GEMMA_EVIDENCE_V14_OK " + CommandLine.arguments[1])
  }
}
`);
  const ios = path.join(__dirname, '../ios/Langform/Langform');
  const build = spawnSync('xcrun', ['swiftc', '-swift-version', '6', '-parse-as-library',
    '-module-cache-path', path.join(directory, 'modules'),
    path.join(ios, 'GemmaEvidence.swift'), path.join(ios, 'GemmaSummaryPolicy.swift'),
    path.join(ios, 'GemmaSummaryDocument.swift'), path.join(ios, 'GemmaClaimValidation.swift'), harness, '-o', binary],
  { encoding: 'utf8', timeout: 60000 });
  assert.equal(build.status, 0, build.stderr);
});
test.after(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }); });

for (const [mode, title] of [
  ['reconstruction', 'Unicode, Satzgrenzen und lange Wörter bleiben innerhalb der Quellblöcke vollständig'],
  ['fixtures', 'beide vollständigen Originaltranskripte bleiben bytegleich rekonstruierbar'],
  ['numbering', 'nur tatsächliche Quellnummern können Belege werden'],
  ['types', 'nur genau vier typisierte Rollen mit ganzzahligen IDs sind zulässig'],
  ['bounds', 'Rollengrenzen, Quellenbereich und notwendiges Gesamturteil werden strikt geprüft'],
  ['duplicates', 'Rollen behalten ihre Zuordnung, gemeinsame Quellnummern erscheinen im Kontext nur einmal'],
  ['context', 'acht Rollenauswahlen mit bis zu vierzig Originalblöcken bleiben exakt vereinigt und unbelegte Lücken bleiben offen'],
  ['fences', 'bekannte JSON-Codeblöcke sind lesbar, freier Begleittext wird abgelehnt'],
  ['insufficient', 'nur der vollständig leere Rollenplan signalisiert unzureichenden Inhalt'],
  ['schema', 'das tatsächliche Schema begrenzt jede Rolle auf vorhandene Quellen-IDs'],
  ['evidence-numbering', 'alle Kontextblöcke behalten ihre ursprünglichen Nummern und Bytes'],
  ['roles', 'jede Rolle erhält ihre konkreten Beleg- und Kontextnummern vor dem unveränderten Quellenunion'],
  ['writer', 'der tatsächliche Writer erhält ausschließlich den typisierten Rollenplan und Originalquellen']
]) {
  test('Gemma-Quellbelege: ' + title, { timeout: 15000 }, t => {
    if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
    const run = spawnSync(binary, [mode, path.join(__dirname, 'fixtures/summary')], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, new RegExp('GEMMA_EVIDENCE_V14_OK ' + mode));
  });
}
