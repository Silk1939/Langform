const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let directory, binary;
test.before(() => {
  if (process.platform !== 'darwin') return;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-gemma-repair-'));
  binary = path.join(directory, 'repair');
  const harness = path.join(directory, 'RepairTests.swift');
  fs.writeFileSync(harness, String.raw`
import Foundation

@main struct RepairTests {
  static func source(_ prefixes: [Int: String] = [:]) -> String {
    (1...12).map { id in
      let prefix = prefixes[id, default: ""]
      return prefix + String(repeating: "q", count: 450 - prefix.count)
    }.joined()
  }
  static let selection = #"{"verdict":[1],"positive":[3,5],"critical":[10],"context":[6]}"#
  static func point(_ role: String, _ ids: [Int]) -> [String: Any] {
    ["role": role, "text": "Die Einschätzung bleibt auf diesen Aspekt begrenzt.", "evidenceIDs": ids]
  }
  static func object(_ points: [[String: Any]]? = nil, tldr: String = "Die Einschätzung bleibt gemischt.") -> [String: Any] {
    ["tldr": ["text": tldr, "evidenceIDs": [1]],
     "points": points ?? [point("positive", [3]), point("positive", [5]), point("critical", [10])],
     "takeaway": ["text": "Die Erfahrung lässt Raum für Verbesserungen.", "evidenceIDs": [1]]]
  }
  static func json(_ value: Any) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), as: UTF8.self)
  }
  static func request(_ original: [String: Any], source: String? = nil,
                      selection: String = Self.selection) throws -> GemmaSummaryRepair.Request {
    let source = source ?? Self.source()
    let output = try json(original)
    let allowed = Set(try GemmaEvidence.includedIDs(selection, in: source))
    let document = try GemmaSummaryDocument.decode(output, allowedEvidenceIDs: allowed)
    let issues = try GemmaClaimValidation.issues(for: document, selection: selection, source: source)
    return try GemmaSummaryRepair.request(for: output, issues: issues, selection: selection, source: source)
  }
  static func properties(_ request: GemmaSummaryRepair.Request) throws -> [String: Any] {
    let schema = try JSONSerialization.jsonObject(with: Data(request.schemaJSON.utf8)) as! [String: Any]
    return schema["properties"] as! [String: Any]
  }
  static func equal(_ left: Any, _ right: Any) throws -> Bool { try json(left) == json(right) }
  static func main() throws {
    switch CommandLine.arguments[1] {
    case "freeze":
      let value = object(tldr: "Die Bewertung beträgt drei von fünf.")
      let request = try request(value)
      let schema = try properties(request)
      precondition(request.fixedFields == ["points", "takeaway"])
      precondition(request.removedPointIndices.isEmpty)
      precondition(request.needsGeneration && !request.remainingIssues.isEmpty)
      let exactOriginal = try json(value)
      precondition(request.preparedOutput == exactOriginal)
      for field in ["tldr", "points", "takeaway"] {
        precondition((schema[field] as! [String: Any])["enum"] == nil, "Long exact-text native enums are forbidden")
      }
      precondition(!request.prompt.contains("Die Bewertung beträgt drei von fünf."), "The bad field must never anchor its own repair")
      precondition(request.prompt.contains("unsupportedRatio"))
    case "prune":
      let good = [point("positive", [3]), point("positive", [5]), point("critical", [10])]
      let value = object(good + [point("critical", [8])])
      let request = try request(value)
      precondition(request.removedPointIndices == [3])
      precondition(request.fixedFields == ["tldr", "points", "takeaway"])
      precondition(!request.needsGeneration && request.remainingIssues.isEmpty)
      let prepared = try JSONSerialization.jsonObject(with: Data(request.preparedOutput.utf8)) as! [String: Any]
      let exact = try equal(prepared["points"]!, good)
      precondition(exact)
      for field in ["tldr", "takeaway"] {
        let unchanged = try equal(prepared[field]!, value[field]!)
        precondition(unchanged, "No retained claim text or IDs may be rewritten")
      }
    case "minimum":
      let request = try request(object([point("positive", [3,5]), point("critical", [10]), point("critical", [8])]))
      precondition(request.removedPointIndices.isEmpty, "Never silently reduce a summary below three points")
      precondition(!request.fixedFields.contains("points"))
      precondition(request.needsGeneration)
    case "coverage":
      for points in [
        [point("positive", [3]), point("positive", [3]), point("main", [1]), point("critical", [8])],
        [point("critical", [10]), point("critical", [10]), point("main", [1]), point("positive", [8])]
      ] {
        let request = try request(object(points))
        precondition(request.removedPointIndices.isEmpty, "Removal cannot erase the only candidate for a selected positive or critical role")
        precondition(!request.fixedFields.contains("points"))
        precondition(request.prompt.contains("uncoveredRoleEvidence"))
        precondition(request.needsGeneration)
      }
    case "sparse":
      let plan = #"{"verdict":[1],"positive":[3],"critical":[10],"context":[6]}"#
      let good = [point("positive", [3]), point("critical", [10])]
      let original = object(good + [point("positive", [8]), point("critical", [8])])
      let value = try request(original, selection: plan)
      precondition(value.removedPointIndices == [2,3] && !value.needsGeneration)
      precondition(value.remainingIssues.isEmpty)
      let prepared = try JSONSerialization.jsonObject(with: Data(value.preparedOutput.utf8)) as! [String: Any]
      let exact = try equal(prepared["points"]!, good)
      precondition(exact, "Two selected core aspects may retain two exact valid points")
      let missing = object([point("positive", [3]), point("positive", [3]), point("critical", [8]), point("critical", [8])])
      let rejected = try request(missing, selection: plan)
      precondition(rejected.removedPointIndices.isEmpty && rejected.needsGeneration)
      precondition(rejected.remainingIssues.contains { $0.code == "uncoveredRoleEvidence" })
    case "fatal":
      let original = object([point("positive", [3]), point("positive", [5]),
        point("critical", [10]), point("critical", [8])], tldr: "Die Bewertung ist drei von fünf.")
      let value = try request(original)
      let exactOriginal = try json(original)
      precondition(value.preparedOutput == exactOriginal && value.removedPointIndices.isEmpty,
        "A fatal TLDR finding must leave the entire native draft and correction input unchanged")
      precondition(value.needsGeneration)
      precondition(value.remainingIssues.contains { $0.code == "unsupportedNumber" })
      precondition(value.remainingIssues.contains { $0.field == "points[3]" })
    case "year":
      let original = source([1: "Der Besuch war 2026. ", 6: "Historisch war 1999 wichtig. "])
      let request = try request(object(), source: original)
      precondition(request.fixedFields == ["tldr", "points", "takeaway"])
      precondition(!request.needsGeneration && request.remainingIssues.isEmpty)
      let year = try GemmaClaimValidation.requiredSourceYear(selection: selection, source: original)
      precondition(year == "2026", "The source year is explicit metadata, never a generated claim")
      precondition(!request.preparedOutput.contains("2026"), "Metadata must not silently rewrite native claim text")
    case "yearScope":
      for original in [source([6: "Das Jahr 2026 steht nur im Kontext. "]), source([1: "Vergleich zwischen 2025 und 2026. "])] {
        let value = try request(object(), source: original)
        precondition(value.fixedFields == ["tldr", "points", "takeaway"], "Only one unique direct-verdict year creates a requirement")
        let year = try GemmaClaimValidation.requiredSourceYear(selection: selection, source: original)
        precondition(year == nil)
      }
    case "malformed":
      let raw = #"{"tldr":{"text":"Bad draft"}}"#
      let issue = GemmaClaimValidation.Issue(field: "document", code: "structuralIssue", message: "Das Dokument ist unvollständig.")
      let value = try GemmaSummaryRepair.request(for: raw, issues: [issue], selection: selection, source: source())
      precondition(value.fixedFields.isEmpty && value.removedPointIndices.isEmpty)
      precondition(value.needsGeneration && value.preparedOutput == raw && value.remainingIssues == [issue])
      let expected = try GemmaSummaryDocument.schema(allowedEvidenceIDs: GemmaEvidence.includedIDs(selection, in: source()))
      precondition(value.schemaJSON == expected)
      precondition(!value.prompt.contains("Bad draft"))
    default: preconditionFailure("Unknown mode")
    }
    print("GEMMA_REPAIR_OK " + CommandLine.arguments[1])
  }
}
`);
  const ios = path.join(__dirname, '../ios/Langform/Langform');
  const build = spawnSync('xcrun', ['swiftc', '-swift-version', '6', '-parse-as-library',
    '-module-cache-path', path.join(directory, 'modules'),
    ...['GemmaEvidence.swift', 'GemmaSummaryDocument.swift', 'GemmaClaimValidation.swift', 'GemmaSummaryPolicy.swift', 'GemmaSummaryRepair.swift'].map(f => path.join(ios, f)),
    harness, '-o', binary], { encoding: 'utf8', timeout: 60000 });
  assert.equal(build.status, 0, build.stderr);
});
test.after(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }); });

for (const [mode, title] of [
  ['freeze', 'offene Befunde brauchen eine echte Korrektur mit gewöhnlichem Schema ohne native Text-enums'],
  ['prune', 'redundanter ungültiger vierter Punkt wird ausdrücklich entfernt, drei gültige Punkte bleiben exakt'],
  ['minimum', 'ungültiger Punkt wird bei nur drei vorhandenen Punkten nicht entfernt'],
  ['coverage', 'Entfernen darf keine ausgewählte positive oder kritische Seite vollständig aus den Punkten löschen'],
  ['sparse', 'zwei ausgewählte Kernaspekte dürfen zwei gültige Punkte behalten, aber niemals einen Hauptbeleg verlieren'],
  ['fatal', 'ein verbleibender fataler Zahlenbefund verhindert jede appseitige Punktentfernung'],
  ['year', 'ein eindeutiges Jahr direkter Gesamturteilsbelege bleibt separate Quellenmetadaten ohne Textrewrite'],
  ['yearScope', 'Kontextjahre und mehrdeutige Gesamturteilsjahre erzeugen keine erfundene Jahresangabe'],
  ['malformed', 'strukturell ungültige Antworten nutzen einen begrenzten freien Fallback ohne Entwurfkopie']
]) {
  test('Gemma-Feldreparatur: ' + title, t => {
    if (process.platform !== 'darwin') return t.skip('Swift-Test benötigt macOS');
    const run = spawnSync(binary, [mode], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, new RegExp('GEMMA_REPAIR_OK ' + mode));
  });
}
