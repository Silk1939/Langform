const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let directory, binary;
test.before(() => {
  if (process.platform !== 'darwin') return;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-gemma-claims-'));
  binary = path.join(directory, 'claims');
  const harness = path.join(directory, 'ClaimTests.swift');
  fs.writeFileSync(harness, String.raw`
import Foundation

@main struct ClaimTests {
  static let source = String(repeating: "q", count: 12 * 450)
  static func selection(_ verdict: [Int] = [1], positive: [Int] = [3,5], critical: [Int] = [10], context: [Int] = [6]) -> String {
    let value = ["verdict": verdict, "positive": positive, "critical": critical, "context": context]
    return String(decoding: try! JSONSerialization.data(withJSONObject: value), as: UTF8.self)
  }
  static func claim(_ text: String, ids: [Int] = [1]) -> GemmaSummaryDocument.Claim {
    .init(text: text, evidenceIDs: ids)
  }
  static func codes(_ text: String, source: String, ids: [Int] = [1]) -> Set<String> {
    Set(GemmaClaimValidation.issues(for: claim(text, ids: ids), field: "tldr", source: source).map(\.code))
  }
  static func point(_ role: String, _ ids: [Int]) -> [String: Any] {
    ["role": role, "text": "Die Einschätzung bleibt auf diesen Aspekt begrenzt.", "evidenceIDs": ids]
  }
  static func document(_ points: [[String: Any]], tldr: [Int] = [1], selection: String? = nil) throws -> GemmaSummaryDocument {
    let data = try JSONSerialization.data(withJSONObject: [
      "tldr": ["text": "Die Einschätzung bleibt gemischt.", "evidenceIDs": tldr],
      "points": points,
      "takeaway": ["text": "Die Erfahrung lässt Raum für Verbesserungen.", "evidenceIDs": [1]]
    ])
    let ids = Set(try GemmaEvidence.includedIDs(selection ?? Self.selection(), in: source))
    return try GemmaSummaryDocument.decode(String(decoding: data, as: UTF8.self), allowedEvidenceIDs: ids)
  }
  static func documentCodes(_ value: GemmaSummaryDocument, selection: String? = nil) throws -> Set<String> {
    Set(try GemmaClaimValidation.issues(for: value, selection: selection ?? Self.selection(), source: source).map(\.code))
  }
  static func main() throws {
    switch CommandLine.arguments[1] {
    case "inline":
      for text in ["Eine Aussage [62].", "Eine Aussage [1,2].", "Eine Aussage [ 1, 2 ]."] {
        precondition(codes(text, source: "Eine Aussage.").contains("inlineEvidenceIDs"))
      }
      precondition(!codes("Eine Aussage.", source: "Eine Aussage.").contains("inlineEvidenceIDs"))
    case "numbers":
      let original = "Der Bericht stammt aus 2025 und enthält eine unklare Bewertung mit 3 von unbekannten Dingen."
      let issues = GemmaClaimValidation.issues(for: claim("Die Bewertung beträgt drei von fünf Punkten."), field: "tldr", source: original)
      precondition(issues.contains { $0.code == "unsupportedNumber" && $0.message.contains("5") })
      precondition(issues.contains { $0.code == "unsupportedRatio" })
      precondition(codes("Der Wert ist 5.", source: "Der Bericht stammt aus 2025.").contains("unsupportedNumber"))
      precondition(codes("Die Zahl ist drei.", source: "The number is 3.").isEmpty)
      precondition(codes("Die Zahl ist einundzwanzig.", source: "Die Zahl ist 21.").isEmpty)
      precondition(codes("Eine gute Fahrt bleibt zurück.", source: "A good ride.").isEmpty)
      let first = "Der Bericht stammt aus 2025."
      let separated = first + String(repeating: "x", count: 450 - first.count) + "Die Bewertung ist fünf."
      precondition(codes("Die Bewertung ist fünf.", source: separated, ids: [1]).contains("unsupportedNumber"), "A value elsewhere in the source is not a citation for this claim")
    case "locales":
      for (text, original) in [
        ("Die Nacht kostet 1.234,50 Euro.", "One night costs 1,234.50 EUR."),
        ("Die Nacht kostet 1234,5 Euro.", "The cost is 1 234.50 euros."),
        ("Der Preis beträgt 12,50 Euro.", "The price is 12.5 euros."),
        ("Der Wert beträgt 0,123.", "The value is 0.123."),
        ("Der Preis beträgt 1 234 Euro.", "The price is 1,234 euros."),
        ("Es waren 7.000.000 Besucher.", "There were 7 million visitors."),
        ("Die Zahl ist fünfundzwanzig.", "The number is twenty-five.")
      ] { precondition(codes(text, source: original).isEmpty, text + " must match " + original) }
    case "ratios":
      precondition(codes("Die Bewertung ist drei von fünf.", source: "The rating is 3 out of 5.").isEmpty)
      precondition(codes("Die Bewertung ist 3/5.", source: "Die Bewertung ist drei von fünf.").isEmpty)
      let separate = codes("Die Bewertung ist 3 von 5.", source: "Es gibt 3 Eingänge und 5 Ausgänge.")
      precondition(separate.contains("unsupportedRatio") && !separate.contains("unsupportedNumber"), "Independent values must not legitimize an invented rating pair")
      precondition(codes("Die Bewertung ist 5 von 3.", source: "Die Bewertung ist 3 von 5.").contains("unsupportedRatio"))
    case "roles":
      let direct = try GemmaEvidence.directIDs(for: "positive", selection: selection(), source: source)
      let allowed = try GemmaEvidence.allowedIDs(for: "positive", selection: selection(), source: source)
      precondition(direct == [3,5] && allowed == Set(1...12))
      let valid = try document([point("positive",[3]), point("positive",[5]), point("critical",[10])])
      let validIssues = try documentCodes(valid)
      precondition(validIssues.isEmpty)
      let outside = try document([point("positive",[3,10]), point("positive",[5]), point("critical",[10])])
      let outsideCodes = try documentCodes(outside)
      precondition(outsideCodes.isEmpty, "A matching direct-role claim may also cite another supplied source block")
      let contextOnly = try document([point("positive",[4]), point("positive",[5]), point("critical",[10])])
      let contextCodes = try documentCodes(contextOnly)
      precondition(contextCodes.contains("missingDirectEvidence"))
      let wrongTldr = try document([point("positive",[3]), point("positive",[5]), point("critical",[10])], tldr: [3])
      let tldrIssues = try GemmaClaimValidation.issues(for: wrongTldr, selection: selection(), source: source)
      precondition(tldrIssues.contains { $0.field == "tldr" && $0.code == "missingDirectEvidence" })
    case "coverage":
      let represented = try document([point("positive",[3]), point("positive",[3]), point("critical",[10])])
      let representedIssues = try documentCodes(represented)
      precondition(representedIssues.isEmpty, "Selected source blocks are candidates, not a requirement to repeat every block as a separate point")
      for missing in [
        try document([point("main",[1]), point("main",[3]), point("critical",[10])], tldr: [1,3,5]),
        try document([point("positive",[3]), point("main",[10]), point("main",[1])], tldr: [1,10]),
        try document([point("main",[1]), point("main",[3]), point("main",[10])], tldr: [1,3,10])
      ] {
        let issues = try documentCodes(missing)
        precondition(issues.contains("uncoveredRoleEvidence"),
          "Neutral points and TLDR citations cannot replace a directly bound point for a selected positive or critical role")
      }
      let hiddenAsOtherRole = try document([point("positive",[3]), point("positive",[5]), point("positive",[10])])
      let codes = try documentCodes(hiddenAsOtherRole)
      precondition(codes.contains("uncoveredRoleEvidence") && codes.contains("missingDirectEvidence"))
    case "neutral":
      let plan = selection(positive: [], critical: [], context: [])
      let neutral = try document([point("main",[1]), point("main",[1]), point("main",[1])], selection: plan)
      let neutralIssues = try documentCodes(neutral, selection: plan)
      precondition(neutralIssues.isEmpty)
      let mixed = try document([point("main",[6]), point("positive",[3]), point("critical",[10])])
      let mixedIssues = try documentCodes(mixed)
      precondition(mixedIssues.isEmpty, "A supplied neutral context fact need not cite a verdict block or lose its neutral role")
      let sparse = selection(positive: [3], critical: [10], context: [])
      let supplied = Set(try GemmaEvidence.includedIDs(sparse, in: source))
      precondition(supplied.contains(4) && !supplied.contains(7))
      let suppliedMain = try document([point("main",[4]), point("positive",[3]), point("critical",[10])], selection: sparse)
      let suppliedIssues = try documentCodes(suppliedMain, selection: sparse)
      precondition(suppliedIssues.isEmpty)
      for invalid in [7,13,0] {
        var rejected = false
        do { _ = try document([point("main",[invalid]), point("positive",[3]), point("critical",[10])], selection: sparse) }
        catch { rejected = true }
        precondition(rejected, "A neutral label must never admit unprovided, nonexistent or invalid source IDs")
      }
    case "bus":
      let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))) as! [String: String]
      let source = fixture["preparedSource"]!, selection = fixture["selection"]!, raw = fixture["writerOutput"]!
      let allowed = Set(try GemmaEvidence.includedIDs(selection, in: source))
      let document = try GemmaSummaryDocument.decode(raw, allowedEvidenceIDs: allowed)
      let issues = try GemmaClaimValidation.issues(for: document, selection: selection, source: source)
      precondition(issues.isEmpty, "The unchanged actual first bus writer contains positive, critical and neutral grounded facts")
      precondition(document.points.map(\.role) == ["positive", "critical", "main"] && document.points[2].evidenceIDs == [1])
      precondition(!document.points.contains { $0.evidenceIDs.contains(2) } && document.tldr.evidenceIDs.contains(2),
        "The secondary survey block need not become an extra positive point")
    case "correction":
      let rejected = #"{"tldr":{"text":"Die Bewertung ist 3 von 5."}}"#
      let issue = GemmaClaimValidation.Issue(field: "tldr", code: "unsupportedRatio", message: "Das Zahlenpaar ist nicht belegt.")
      let original = try GemmaSummaryPolicy.writerPrompt(for: selection(), source: source)
      let correction = try GemmaSummaryPolicy.correctionPrompt(for: rejected, issues: [issue], selection: selection(), source: source)
      precondition(correction.hasPrefix(original), "The complete original evidence and role plan must survive correction")
      precondition(!correction.contains(rejected), "A rejected draft must never anchor the fresh correction")
      precondition(!correction.contains("Die Bewertung ist 3 von 5."))
      precondition(!correction.contains("<abgelehnte_antwort>"))
      precondition(correction.contains("unsupportedRatio"))
      precondition(correction.contains("Das Zahlenpaar ist nicht belegt."))
    default: preconditionFailure("Unknown mode")
    }
    print("GEMMA_CLAIMS_OK " + CommandLine.arguments[1])
  }
}
`);
  const ios = path.join(__dirname, '../ios/Langform/Langform');
  const build = spawnSync('xcrun', ['swiftc', '-swift-version', '6', '-parse-as-library',
    '-module-cache-path', path.join(directory, 'modules'),
    ...['GemmaEvidence.swift', 'GemmaSummaryDocument.swift', 'GemmaClaimValidation.swift', 'GemmaSummaryPolicy.swift'].map(f => path.join(ios, f)),
    harness, '-o', binary], { encoding: 'utf8', timeout: 60000 });
  assert.equal(build.status, 0, build.stderr);
});
test.after(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }); });

for (const [mode, title] of [
  ['inline', 'Quellnummern dürfen nicht im sichtbaren Text erscheinen'],
  ['numbers', 'Zahlen und Zahlenwörter benötigen genaue Belege; 2025 belegt keine 5 und Artikel zählen nicht'],
  ['locales', 'deutsche und englische Dezimal-/Gruppierungsformen sowie eindeutige Zahlwörter werden normalisiert'],
  ['ratios', 'Bewertungspaare benötigen dieselbe Reihenfolge und ein wirkliches Paar in den zitierten Stellen'],
  ['roles', 'direkte Rollenbelege bleiben Pflicht, zusätzliche Zitate dürfen die gesamte tatsächlich gelieferte Quellenunion nutzen'],
  ['coverage', 'jede ausgewählte positive und kritische Rolle braucht einen eigenen direkt belegten Punkt; Kandidatenblöcke sind keine Einzelpunktpflicht'],
  ['neutral', 'neutrale Kernfakten dürfen neben Lob und Kritik nur tatsächlich gelieferte Quellenblöcke zitieren'],
  ['bus', 'der unveränderte erste native Bus-Writer bleibt mit neutralem Kernfakt und beiden belegten Rollen gültig'],
  ['correction', 'der Korrekturauftrag behält alle Originalbelege und präzisen Befunde, enthält aber keinen abgelehnten Entwurf']
]) {
  test('Gemma-Claimprüfung: ' + title, { timeout: 15000 }, t => {
    if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
    const run = spawnSync(binary, [mode, path.join(__dirname, 'fixtures/summary/bus-pilot-first-writer.json')], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, new RegExp('GEMMA_CLAIMS_OK ' + mode));
  });
}
