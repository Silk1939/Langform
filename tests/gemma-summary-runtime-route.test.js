const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

test('tatsächlicher Gemma-Provider lädt CPU und trennt versteckte Quellenwahl von geprüftem Writer', { timeout: 120000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-gemma-route-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const product = path.join(__dirname, '../ios/Langform/Langform');
  const files = ['GemmaSummary.swift', 'GemmaSummaryPolicy.swift', 'GemmaEvidence.swift',
    'GemmaSummaryDocument.swift', 'GemmaClaimValidation.swift', 'GemmaSummaryRepair.swift', 'OnDeviceSummary.swift'];
  for (const name of files) fs.writeFileSync(path.join(root, name), fs.readFileSync(path.join(product, name)));
  const weights = Buffer.from('Only a local SHA-validated model fixture; no inference.');
  const digest = crypto.createHash('sha256').update(weights).digest('hex');
  let store = fs.readFileSync(path.join(product, 'GemmaModelStore.swift'), 'utf8');
  assert.match(store, /nonisolated static let runtimeBackend = "cpu"/);
  store = store.replace('FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]',
    'URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)')
    .replace(/nonisolated static let expectedSHA256 = "[a-f0-9]+"/, `nonisolated static let expectedSHA256 = "${digest}"`)
    .replace(/nonisolated static let expectedBytes: Int64 = [\d_]+/, `nonisolated static let expectedBytes: Int64 = ${weights.length}`);
  fs.writeFileSync(path.join(root, 'GemmaModelStore.swift'), store);
  fs.writeFileSync(path.join(root, 'weights.fixture'), weights);
  const busFixturePath = path.join(__dirname, 'fixtures/summary/bus-pilot-first-writer.json');
  const recordedBus = JSON.parse(fs.readFileSync(busFixturePath, 'utf8'));
  for (const [field, digestField] of [['source', 'sourceSHA256'], ['preparedSource', 'preparedSourceSHA256'],
    ['selection', 'selectionSHA256'], ['writerOutput', 'writerSHA256']]) {
    assert.equal(crypto.createHash('sha256').update(recordedBus[field]).digest('hex'), recordedBus[digestField],
      'The portable first-writer regression must retain the actual recorded bytes: ' + field);
  }
  fs.copyFileSync(busFixturePath, path.join(root, 'bus-first-writer.json'));
  // Only canImport is provided. All real native operations are replaced by the
  // recording actor below, while the product provider/gate/parser remain real.
  fs.writeFileSync(path.join(root, 'LiteRTLM.swift'), 'public enum RouteTestMarker {}\n');
  const swift = ['-module-cache-path', path.join(root, 'modules')];
  const marker = spawnSync('xcrun', ['swiftc', ...swift, '-emit-module', '-module-name', 'LiteRTLM',
    path.join(root, 'LiteRTLM.swift'), '-emit-module-path', path.join(root, 'LiteRTLM.swiftmodule')],
  { encoding: 'utf8', timeout: 30000 });
  assert.equal(marker.status, 0, marker.stderr);
  const harness = path.join(root, 'Route.swift');
  fs.writeFileSync(harness, `
import Foundation
enum GemmaRuntimeError: Error {
  case modelUnavailable(String), insufficientMemory(available: UInt64, required: UInt64), contextTooLarge(input: Int, available: Int), generation(String), outputLimit
}
actor GemmaRuntime {
  static let shared = GemmaRuntime()
  struct Call: Sendable { let instructions: String; let prompt: String; let limit: Int; let thinkingBudget: Int; let hasReview: Bool; let schema: String? }
  struct Load: Sendable { let url: URL; let backend: String; let context: Int? }
  private var calls: [Call] = []
  private var loads: [Load] = []
  private var selection = GemmaRuntime.plan
  private var writerOutputs = [GemmaRuntime.final]
  private var throwingAtCall: Int?
  private var loadFailure: GemmaRuntimeError?
  static let plan = #"{"verdict":[1],"positive":[1],"critical":[1],"context":[]}"#
  static let final = """
  {"tldr":{"text":"Die Sprecher finden die Gestaltung gelungen, kritisieren aber die schlechte Nachtruhe.","evidenceIDs":[1]},
   "points":[{"role":"positive","text":"Die Gestaltung gefällt den Sprechern.","evidenceIDs":[1]},
             {"role":"positive","text":"Auch ruhigere Attraktionen werden gelobt.","evidenceIDs":[1]},
             {"role":"critical","text":"Die Nachtruhe wird kritisch beschrieben.","evidenceIDs":[1]}],
   "takeaway":{"text":"Der Besuch hinterlässt einen gemischten Eindruck.","evidenceIDs":[1]}}
  """
  func configure(_ selection: String, writerOutput: String? = nil, writerOutputs: [String]? = nil, throwingAtCall: Int? = nil,
                 loadFailure: GemmaRuntimeError? = nil) {
    self.selection = selection; self.writerOutputs = writerOutputs ?? [writerOutput ?? Self.final]
    self.throwingAtCall = throwingAtCall; self.loadFailure = loadFailure; calls = []; loads = []
  }
  func load(modelURL: URL, backend: String = "gpu", verifiedContextTokens: Int? = nil) async throws {
    precondition(FileManager.default.fileExists(atPath: modelURL.path))
    loads.append(.init(url: modelURL, backend: backend, context: verifiedContextTokens))
    if let loadFailure { throw loadFailure }
  }
  func generate(instructions: String, prompt: String, maxTokens: Int,
                responseSchemaJSON: String? = nil,
                thinkingBudget: Int = 0,
                reviewPrompt: String? = nil,
                reviewPromptBuilder: (@Sendable (String) throws -> String)? = nil,
                additionalReviewTokenReserve: Int = 0,
                validateDraft: (@Sendable (String) throws -> Void)? = nil,
                onReviewStarted: (@Sendable () async -> Void)? = nil,
                onText: @escaping @Sendable (String) async -> Void) async throws -> String {
    calls.append(.init(instructions: instructions, prompt: prompt, limit: maxTokens, thinkingBudget: thinkingBudget,
      hasReview: reviewPrompt != nil || reviewPromptBuilder != nil || validateDraft != nil || onReviewStarted != nil || additionalReviewTokenReserve != 0, schema: responseSchemaJSON))
    if throwingAtCall == calls.count { throw GemmaRuntimeError.outputLimit }
    let output = calls.count == 1 ? selection : writerOutputs[min(calls.count - 2, writerOutputs.count - 1)]
    // Deliberately emit the hidden ID answer too: the real provider must drop it.
    if calls.count >= 2 { await onText(String(output.prefix(25))) }
    await onText(output)
    return output
  }
  func snapshot() -> ([Load], [Call]) { (loads, calls) }
  func cancelAndUnload() async {}
}
actor Updates {
  private var values: [OnDeviceSummary.Progress] = []
  func add(_ value: OnDeviceSummary.Progress) { values.append(value) }
  func snapshot() -> [OnDeviceSummary.Progress] { values }
}
actor Selections {
  private var values: [String] = []
  func add(_ value: String) { values.append(value) }
  func snapshot() -> [String] { values }
}
@main struct Route {
  static func main() async throws {
    let fixture = URL(fileURLWithPath: CommandLine.arguments[2])
    let url = GemmaModelStore.localModelURL
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data(contentsOf: fixture).write(to: url)
    let validationIssue = GemmaClaimValidation.Issue(field: "points[0]", code: "missingDirectEvidence", message: "Ein direkter Rollenbeleg fehlt.")
    for (arguments, environment, visible) in [
      ([String](), [String: String](), false),
      (["--langform-gemma-diagnostic"], [:], false),
      ([], ["LANGFORM_GEMMA_PROBE": "1"], false),
      (["--langform-gemma-diagnostic"], ["LANGFORM_GEMMA_PROBE": "1"], true),
      (["--langform-gemma-diagnostic"], ["LANGFORM_GEMMA_PROBE": "true"], false),
      (["--langform-gemma-diagnostic-extra"], ["LANGFORM_GEMMA_PROBE": "1"], false)
    ] {
      let failure = GemmaSummary.validationFailure(issues: [validationIssue], arguments: arguments, environment: environment)
      precondition(failure["code"] as? String == "GENERATION_FAILED" && failure["summary"] == nil)
      if visible {
        precondition(failure["diagnosticValidationIssues"] as? [[String: String]] ==
          [["field": validationIssue.field, "code": validationIssue.code, "message": validationIssue.message]])
        precondition(Set(failure.keys) == Set(["code", "message", "diagnosticValidationIssues"]))
      } else {
        precondition(failure["diagnosticValidationIssues"] == nil && Set(failure.keys) == Set(["code", "message"]),
          "Ohne beide exakten Diagnoseoptins dürfen keine internen Validierungsbefunde erscheinen")
      }
    }
    let raw = "[Musik]\\n" + (1...8).map { index in
      "Originalabschnitt \\(index): " + String(repeating: "Die Sprecher schildern ihre Eindrücke zu Gestaltung, Attraktionen und Nachtruhe. ", count: 6)
    }.joined(separator: "\\n") + " UNSELECTED_SOURCE_END_MARKER"
    let source = OnDeviceSummary.prepare(raw)
    precondition(!source.contains("[Musik]") && !source.contains("\\n"))
    let blocks = GemmaEvidence.blocks(in: source)
    precondition(blocks.count > 3 && blocks.joined() == source)
    await GemmaRuntime.shared.configure(GemmaRuntime.plan)
    let updates = Updates(), selections = Selections(), written = Selections(), cache = SummaryReuseCache()
    let result = await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: cache,
      onProgress: { await updates.add($0) }, onSelection: { selection in
        let runtime = await GemmaRuntime.shared.snapshot()
        let progress = await updates.snapshot()
        precondition(runtime.1.count == 1 && runtime.1[0].prompt == GemmaSummaryPolicy.prompt(for: source),
          "Der Diagnosecallback muss das tatsächliche erste Ergebnis vor jedem Writer-Aufruf erhalten")
        precondition(progress.map(\\.phase) == ["preparing", "reading"],
          "Der Diagnosecallback muss vor sichtbarem checking/writing erfolgen")
        await selections.add(selection)
      }, onWritten: { output in
        let runtime = await GemmaRuntime.shared.snapshot()
        precondition(runtime.1.count == 2, "Der Schreibcallback darf erst das tatsächliche zweite Modellresultat erhalten")
        await written.add(output)
      })
    let (loads, calls) = await GemmaRuntime.shared.snapshot()
    precondition(loads.count == 1 && loads[0].backend == "cpu" && loads[0].context == 8192 && loads[0].url == url, "Der tatsächliche Provider muss die CPU-Konstante mit 8K an load weitergeben")
    precondition(calls.count == 2 && calls[0].limit == GemmaSummaryPolicy.selectionTokenLimit && calls[1].limit == GemmaSummaryPolicy.writerTokenLimit &&
      GemmaSummaryPolicy.selectionTokenLimit == 512)
    precondition(calls[0].thinkingBudget == GemmaSummaryPolicy.selectionThinkingTokens &&
      GemmaSummaryPolicy.selectionThinkingTokens == 256 && calls[1].thinkingBudget == GemmaSummaryPolicy.writerThinkingTokens &&
      GemmaSummaryPolicy.writerThinkingTokens == 0 && GemmaSummaryPolicy.writerTokenLimit == 1100,
      "Nur die Quellenwahl erhält das begrenzte Denkbudget; der frische Writer schreibt ohne Denkbudget")
    let expectedSchema = try GemmaEvidence.selectionSchema(for: source)
    let allowedEvidenceIDs = Set(try GemmaEvidence.includedIDs(GemmaRuntime.plan, in: source))
    let expectedWriterSchema = try GemmaSummaryDocument.schema(allowedEvidenceIDs: allowedEvidenceIDs.sorted())
    precondition(calls[0].schema == expectedSchema && calls[1].schema == expectedWriterSchema,
      "Vollständige Quellenwahl und frischer JSON-Writer erhalten jeweils ihr tatsächliches Schema; Writer-IDs gehören nur zu seinen Originalstellen")
    precondition(calls.allSatisfy { !$0.hasReview && $0.instructions == GemmaSummaryPolicy.instructions }, "Zwei frische Einpass-Aufrufe statt eines versteckten KV-Review-Turns")
    precondition(calls[0].prompt == GemmaSummaryPolicy.prompt(for: source), "Der erste Aufruf muss die vollständige vorbereitete Quelle erhalten")
    let expectedWriter = try GemmaSummaryPolicy.writerPrompt(for: GemmaRuntime.plan, source: source)
    precondition(calls[0].prompt.contains("UNSELECTED_SOURCE_END_MARKER") && calls[1].prompt == expectedWriter && !calls[1].prompt.contains("UNSELECTED_SOURCE_END_MARKER"), "Der zweite Aufruf darf ausschließlich die tatsächlich validierten Originalstellen erhalten")
    precondition(calls[1].prompt.contains("Gesamturteil (verdict): [1]") &&
      calls[1].prompt.contains("Positive Erfahrungen (positive): [1]") &&
      calls[1].prompt.contains("Konkrete Kritik (critical): [1]") &&
      calls[1].prompt.contains("Notwendige Einordnung (context): []"),
      "Der tatsächliche Writer muss die vier geprüften Rollen des Belegplans erhalten")
    let progress = await updates.snapshot()
    let observedSelections = await selections.snapshot()
    precondition(observedSelections == [GemmaRuntime.plan], "Der tatsächliche Rollenplan darf genau einmal an den isolierten Diagnosecallback gehen")
    precondition(progress.map(\\.phase) == ["preparing", "reading", "checking", "writing", "writing"])
    precondition(progress.compactMap(\\.tldr).allSatisfy { !$0.contains("[1]") } && progress.dropLast().allSatisfy { $0.tldr == nil }, "Die Quellen-ID-Auswahl darf nie als sichtbarer Entwurf erscheinen")
    let visiblePayload = try JSONSerialization.data(withJSONObject: progress.map(\\.payload))
    precondition(!String(decoding: visiblePayload, as: UTF8.self).contains("[1]") &&
      !String(decoding: visiblePayload, as: UTF8.self).contains("verdict"),
      "Die Quellen-IDs dürfen auch außerhalb der TLDR in keinem öffentlichen Fortschritt stehen")
    precondition(progress.last?.tldr == "Die Sprecher finden die Gestaltung gelungen, kritisieren aber die schlechte Nachtruhe.")
    let writtenOutputs = await written.snapshot()
    precondition(writtenOutputs == [GemmaRuntime.final], "Nur die explizite Diagnose erhält den vollständigen rohen JSON-Writer einmal")
    let summary = result["summary"] as? [String: Any]
    precondition(summary?["model"] as? String == GemmaModelStore.modelName && OnDeviceSummary.reusableResult(result))
    let visibleResult = try JSONSerialization.data(withJSONObject: result)
    precondition(!String(decoding: visibleResult, as: UTF8.self).contains("evidenceIDs"),
      "Verifizierte Belegmetadaten dürfen nicht Bestandteil des sichtbaren oder wiederverwendeten Kurzfassungsergebnisses sein")
    precondition(!String(decoding: visibleResult, as: UTF8.self).contains("\\"role\\""),
      "Auch die interne Punktrolle darf kein sichtbarer Kurzfassungstext oder Cachefeld werden")
    // The real cache must reuse the final parsed answer without a model call.
    let repeated = await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: cache,
      onProgress: nil, onSelection: { await selections.add($0) }, onWritten: { await written.add($0) })
    let afterCached = await GemmaRuntime.shared.snapshot()
    let afterCachedSelections = await selections.snapshot()
    precondition(OnDeviceSummary.reusableResult(repeated) && afterCached.1.count == 2)
    precondition(afterCachedSelections == observedSelections, "Ein Cachehit erzeugt keine erfundene oder wiederholte Quellenwahl")
    let afterCachedWritten = await written.snapshot()
    precondition(afterCachedWritten == writtenOutputs, "Ein Cachehit darf auch kein neues rohes Writerresultat vortäuschen")

    await GemmaRuntime.shared.configure(GemmaRuntime.plan)
    let cancelledProgress = Updates(), cancelledSelections = Selections()
    let cancelledTask = Task {
      await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: SummaryReuseCache(),
        onProgress: { await cancelledProgress.add($0) }, onSelection: { selection in
          await cancelledSelections.add(selection)
          withUnsafeCurrentTask { $0?.cancel() }
        })
    }
    let cancelledResult = await cancelledTask.value
    let afterCancellation = await GemmaRuntime.shared.snapshot()
    let afterCancellationProgress = await cancelledProgress.snapshot()
    let afterCancellationSelections = await cancelledSelections.snapshot()
    precondition(!Task.isCancelled, "Die Abbruchprobe muss ausschließlich ihren eigenen Kindtask beenden")
    precondition(cancelledResult["code"] as? String == "CANCELLED" && afterCancellation.1.count == 1,
      "Ein Abbruch im echten Selectioncallback muss den Writer und weitere Modellarbeit verhindern")
    precondition(afterCancellationSelections == [GemmaRuntime.plan])
    precondition(afterCancellationProgress.map(\\.phase) == ["preparing", "reading"],
      "Der echte Abbruch direkt nach der Auswahl darf weder checking noch writing melden")

    for invalid in [
      #"{"verdict":[999999],"positive":[],"critical":[],"context":[]}"#,
      #"{"verdict":[0],"positive":[],"critical":[],"context":[]}"#,
      #"{"verdict":[true],"positive":[],"critical":[],"context":[]}"#,
      #"{"positive":[1],"critical":[],"context":[]}"#,
      #"{"verdict":[],"positive":[1],"critical":[],"context":[]}"#,
      #"{"verdict":[1,2,3],"positive":[],"critical":[],"context":[]}"#,
      #"{"verdict":[1],"positive":[1,2,3],"critical":[],"context":[]}"#,
      #"{"verdict":[1],"positive":[],"critical":[1,2,3],"context":[]}"#,
      GemmaRuntime.plan.replacingOccurrences(of: "[1]", with: "[\\(blocks.count + 1)]"),
      "[1]", "[]", "[ZU_WENIG_INHALT]"
    ] {
      await GemmaRuntime.shared.configure(invalid)
      let rejectedProgress = Updates()
      let rejected = await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: SummaryReuseCache(),
        onProgress: { await rejectedProgress.add($0) })
      let snapshot = await GemmaRuntime.shared.snapshot()
      let rejectedUpdates = await rejectedProgress.snapshot()
      precondition(rejected["code"] as? String == "GENERATION_FAILED" && snapshot.1.count == 1,
        "Fehlendes Gesamturteil, ungültige/veraltete IDs und überholte Listenverträge müssen den Writer vollständig verhindern")
      precondition(rejectedUpdates.map(\\.phase) == ["preparing", "reading"] && rejectedUpdates.allSatisfy { $0.tldr == nil })
    }
    let noEvidence = #"{"verdict":[],"positive":[],"critical":[],"context":[]}"#
    for empty in [noEvidence, " \\n" + noEvidence + "\\n "] {
      await GemmaRuntime.shared.configure(empty)
      let insufficient = await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: SummaryReuseCache(), onProgress: nil)
      let rejected = await GemmaRuntime.shared.snapshot()
      precondition(insufficient["code"] as? String == "INSUFFICIENT_CONTENT" && rejected.1.count == 1)
    }
    for badWriter in [
      GemmaRuntime.final.replacingOccurrences(of: "\\"evidenceIDs\\":[1]", with: "\\"evidenceIDs\\":[999999]"),
      GemmaRuntime.final.replacingOccurrences(of: "\\"evidenceIDs\\":[1]", with: "\\"evidenceIDs\\":[\\(blocks.count)]"),
      GemmaRuntime.final.replacingOccurrences(of: "\\"evidenceIDs\\":[1]", with: "\\"evidenceIDs\\":[]"),
      "## TLDR\\nEine alte freie Markdownantwort."
    ] {
      await GemmaRuntime.shared.configure(GemmaRuntime.plan, writerOutput: badWriter)
      let badProgress = Updates()
      let rejected = await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: SummaryReuseCache(),
        onProgress: { await badProgress.add($0) })
      let snapshot = await GemmaRuntime.shared.snapshot()
      let updates = await badProgress.snapshot()
      precondition(rejected["code"] as? String == "GENERATION_FAILED" && rejected["summary"] == nil && snapshot.1.count == 3,
        "Ein nach genau einer frischen Korrektur weiterhin ungültiger oder unbelegter Writer darf kein fertiges Ergebnis liefern")
      precondition(rejected["diagnosticValidationIssues"] == nil,
        "Der gewöhnliche öffentliche Provider darf auch bei echten Writer-Prüffehlern keine Diagnosebefunde liefern")
      precondition(updates.allSatisfy { $0.tldr == nil }, "Ungültige Writer-Belege dürfen auch keine TLDR-Vorschau erhalten")
    }

    let validFields = try JSONSerialization.jsonObject(with: Data(GemmaRuntime.final.utf8)) as! [String: Any]
    var withExtraFields = validFields
    var withExtraPoints = validFields["points"] as! [[String: Any]]
    withExtraPoints.append(["role": "positive", "text": "Die Sprecher vergeben 37 Sterne.", "evidenceIDs": [1]])
    withExtraFields["points"] = withExtraPoints
    let withExtra = String(decoding: try JSONSerialization.data(withJSONObject: withExtraFields, options: [.sortedKeys]), as: UTF8.self)
    let extraDocument = try GemmaSummaryDocument.decode(withExtra, allowedEvidenceIDs: allowedEvidenceIDs)
    let extraIssues = try GemmaClaimValidation.issues(for: extraDocument, selection: GemmaRuntime.plan, source: source)
    precondition(!extraIssues.isEmpty && extraIssues.allSatisfy { $0.field == "points[3]" })
    await GemmaRuntime.shared.configure(GemmaRuntime.plan, writerOutput: withExtra)
    let pruneCache = SummaryReuseCache(), pruneRaw = Selections(), appRepairs = Selections()
    let pruned = await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: pruneCache,
      onProgress: nil, onWritten: { output in
        await pruneRaw.add(output)
      }, onAppRepair: { output in
        let nativeCalls = await GemmaRuntime.shared.snapshot()
        let nativeOutputs = await pruneRaw.snapshot()
        precondition(nativeCalls.1.count == 2 && nativeOutputs == [withExtra],
          "Die explizite App-Reparatur darf keinen zweiten nativen Writer vortäuschen")
        await appRepairs.add(output)
      })
    let afterPrune = await GemmaRuntime.shared.snapshot()
    let originalNativeOutputs = await pruneRaw.snapshot()
    let prunedOutputs = await appRepairs.snapshot()
    precondition(OnDeviceSummary.reusableResult(pruned) && afterPrune.1.count == 2 &&
      originalNativeOutputs == [withExtra] && prunedOutputs.count == 1 && prunedOutputs[0] != withExtra,
      "Ein ungültiger redundanter vierter Punkt darf bei drei vollständig belegten übrigen Punkten ohne weiteren nativen Aufruf entfallen")
    let prunedFields = try JSONSerialization.jsonObject(with: Data(prunedOutputs[0].utf8)) as! [String: Any]
    let prunedBytes = try JSONSerialization.data(withJSONObject: prunedFields, options: [.sortedKeys])
    let originalValidBytes = try JSONSerialization.data(withJSONObject: validFields, options: [.sortedKeys])
    precondition(prunedBytes == originalValidBytes,
      "Die App-Reparatur darf ausschließlich den explizit beanstandeten Zusatzpunkt entfernen und keinen Text oder Beleg verändern")
    let prunedDocument = try GemmaSummaryDocument.decode(prunedOutputs[0], allowedEvidenceIDs: allowedEvidenceIDs)
    let remainingPruneIssues = try GemmaClaimValidation.issues(for: prunedDocument, selection: GemmaRuntime.plan, source: source)
    precondition(prunedDocument.points.count == 3 && remainingPruneIssues.isEmpty)
    let prunedBody = pruned["summary"] as! [String: Any]
    precondition((prunedBody["points"] as? [String]) == (summary?["points"] as? [String]))
    let prunedHit = await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: pruneCache,
      onProgress: nil, onWritten: { await pruneRaw.add($0) }, onAppRepair: { await appRepairs.add($0) })
    let afterPrunedHit = await GemmaRuntime.shared.snapshot()
    let rawAfterPrunedHit = await pruneRaw.snapshot()
    let appAfterPrunedHit = await appRepairs.snapshot()
    precondition(OnDeviceSummary.reusableResult(prunedHit) && afterPrunedHit.1.count == 2 &&
      rawAfterPrunedHit == originalNativeOutputs && appAfterPrunedHit == prunedOutputs,
      "Nur das vollständig geprüfte App-Ergebnis darf ohne erneute Modellarbeit oder Diagnosecallbacks aus dem Cache kommen")

    var sparseFields = validFields
    let validPoints = validFields["points"] as! [[String: Any]]
    sparseFields["points"] = [validPoints[0], validPoints[2],
      ["role": "positive", "text": "Die Sprecher vergeben 37 Sterne.", "evidenceIDs": [1]],
      ["role": "critical", "text": "Die Sprecher vergeben 41 Sterne.", "evidenceIDs": [1]]]
    let sparseNative = String(decoding: try JSONSerialization.data(withJSONObject: sparseFields, options: [.sortedKeys]), as: UTF8.self)
    let datedSource = OnDeviceSummary.prepare("Dieser Bericht stammt aus dem Jahr 2025. " + source)
    let sparseCache = SummaryReuseCache(), sparseRaw = Selections(), sparseApp = Selections()
    await GemmaRuntime.shared.configure(GemmaRuntime.plan, writerOutput: sparseNative)
    let sparseResult = await GemmaSummary.reply(source: datedSource, sourceIncomplete: false, cache: sparseCache,
      onProgress: nil, onWritten: { await sparseRaw.add($0) }, onAppRepair: { await sparseApp.add($0) })
    let sparseCalls = await GemmaRuntime.shared.snapshot()
    let sparseRawOutputs = await sparseRaw.snapshot(), sparseAppOutputs = await sparseApp.snapshot()
    precondition(OnDeviceSummary.reusableResult(sparseResult) && sparseCalls.1.count == 2 &&
      sparseRawOutputs == [sparseNative] && sparseAppOutputs.count == 1)
    let sparseDocument = try GemmaSummaryDocument.decode(sparseAppOutputs[0], allowedEvidenceIDs: allowedEvidenceIDs)
    precondition(sparseDocument.points.count == 2 && sparseDocument.points.map(\\.role) == ["positive", "critical"] &&
      sparseDocument.points.map(\\.text) == [validPoints[0]["text"] as! String, validPoints[2]["text"] as! String],
      "Bei zwei vollständig abgedeckten geplanten Aspekten dürfen genau zwei ungültige Zusatzpunkte ohne Textänderung entfallen")
    let sparseIssues = try GemmaClaimValidation.issues(for: sparseDocument, selection: GemmaRuntime.plan, source: datedSource)
    let sparseBody = sparseResult["summary"] as! [String: Any]
    precondition(sparseIssues.isEmpty && sparseBody["caveat"] as? String == "Zeitbezug der Quelle: 2025.")
    let sparseHit = await GemmaSummary.reply(source: datedSource, sourceIncomplete: false, cache: sparseCache,
      onProgress: nil, onWritten: { await sparseRaw.add($0) }, onAppRepair: { await sparseApp.add($0) })
    let sparseAfterHit = await GemmaRuntime.shared.snapshot()
    let sparseRawAfterHit = await sparseRaw.snapshot(), sparseAppAfterHit = await sparseApp.snapshot()
    precondition(NSDictionary(dictionary: sparseHit).isEqual(to: sparseResult) && sparseAfterHit.1.count == 2 &&
      sparseRawAfterHit == sparseRawOutputs && sparseAppAfterHit == sparseAppOutputs,
      "Die zwei geprüften Aspekte und der App-Zeitbezug müssen ohne weitere Modellarbeit im Cache erhalten bleiben")

    await GemmaRuntime.shared.configure(GemmaRuntime.plan, writerOutput: withExtra)
    let cancelledPruneCache = SummaryReuseCache(), cancelledPruneOutputs = Selections()
    let cancelledPrune = Task {
      await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: cancelledPruneCache,
        onProgress: nil, onAppRepair: { output in
          await cancelledPruneOutputs.add(output)
          withUnsafeCurrentTask { $0?.cancel() }
        })
    }
    let cancelledPruneResult = await cancelledPrune.value
    let afterCancelledPrune = await GemmaRuntime.shared.snapshot()
    let cancelledAppOutputs = await cancelledPruneOutputs.snapshot()
    precondition(cancelledPruneResult["code"] as? String == "CANCELLED" && afterCancelledPrune.1.count == 2 &&
      cancelledAppOutputs.count == 1, "Ein Abbruch im App-Reparaturcallback muss vor Erfolg und Cacheablage stoppen")
    await GemmaRuntime.shared.configure(GemmaRuntime.plan, writerOutput: withExtra)
    let pruneAfterCancellation = await GemmaSummary.reply(source: source, sourceIncomplete: false,
      cache: cancelledPruneCache, onProgress: nil)
    let afterPruneRetry = await GemmaRuntime.shared.snapshot()
    precondition(OnDeviceSummary.reusableResult(pruneAfterCancellation) && afterPruneRetry.1.count == 2,
      "Ein abgebrochenes App-Ergebnis darf den nächsten Aufruf nicht über einen fertigen Cacheeintrag erfüllen")

    let inventedNumericTLDR = "Die Sprecher bewerten den Besuch mit 3 von 5 Sternen."
    let numericBad = GemmaRuntime.final.replacingOccurrences(
      of: "Die Sprecher finden die Gestaltung gelungen, kritisieren aber die schlechte Nachtruhe.", with: inventedNumericTLDR)
    let badDocument = try GemmaSummaryDocument.decode(numericBad, allowedEvidenceIDs: allowedEvidenceIDs)
    let numericIssues = try GemmaClaimValidation.issues(for: badDocument, selection: GemmaRuntime.plan, source: source)
    precondition(!numericIssues.isEmpty, "Eine erfundene Skala muss die tatsächliche quellengebundene Zahlenprüfung verletzen")
    await GemmaRuntime.shared.configure(GemmaRuntime.plan, writerOutputs: [numericBad, GemmaRuntime.final])
    let repairCache = SummaryReuseCache(), repairProgress = Updates(), repairedRaw = Selections()
    let repaired = await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: repairCache,
      onProgress: { await repairProgress.add($0) }, onWritten: { await repairedRaw.add($0) })
    let repairCalls = await GemmaRuntime.shared.snapshot()
    let repairUpdates = await repairProgress.snapshot()
    let repairOutputs = await repairedRaw.snapshot()
    precondition(OnDeviceSummary.reusableResult(repaired) && repairCalls.1.count == 3 && repairOutputs == [numericBad, GemmaRuntime.final],
      "Genau eine frische Korrektur darf die geprüfte gültige Antwort ersetzen; beide Rohresultate gehören nur der Diagnose")
    let correction = repairCalls.1[2]
    let expectedRepair = try GemmaSummaryRepair.request(for: numericBad, issues: numericIssues,
      selection: GemmaRuntime.plan, source: source)
    precondition(correction.limit == GemmaSummaryPolicy.correctionTokenLimit && correction.limit == 900 &&
      correction.thinkingBudget == GemmaSummaryPolicy.correctionThinkingTokens &&
      GemmaSummaryPolicy.correctionThinkingTokens == 256 && correction.thinkingBudget < correction.limit &&
      correction.schema == expectedRepair.schemaJSON && correction.prompt == expectedRepair.prompt,
      "Die einzelne Korrektur erhält 256 Denktokens innerhalb des Gesamtlimits 900 und verwendet dieselbe tatsächliche Reparaturanfrage")
    precondition(expectedRepair.schemaJSON == expectedWriterSchema && expectedRepair.needsGeneration &&
      expectedRepair.preparedOutput == numericBad && expectedRepair.removedPointIndices.isEmpty &&
      expectedRepair.remainingIssues == numericIssues,
      "Ein ungeklärter TLDR-Befund benötigt genau einen frischen vollständigen Writer ohne lange Text-enum-Grammatik")
    precondition(!correction.prompt.contains("<abgelehnte_antwort>") && !correction.prompt.contains(numericBad) &&
      !correction.prompt.contains(inventedNumericTLDR),
      "Die frische Korrektur darf weder den verworfenen Entwurf noch dessen erfundene Aussage als Kopiervorlage erhalten")
    let issueBlock = correction.prompt.components(separatedBy: "<pruefbefunde>\\n")[1]
      .components(separatedBy: "\\n</pruefbefunde>")[0]
    let forwardedIssues = try JSONDecoder().decode([GemmaClaimValidation.Issue].self, from: Data(issueBlock.utf8))
    precondition(forwardedIssues == numericIssues,
      "Die Korrektur muss die tatsächlichen Validatorbefunde vollständig zusammen mit den Originalbelegen erhalten")
    precondition(repairUpdates.compactMap(\\.tldr).allSatisfy { !$0.contains("3 von 5") },
      "Die tatsächlich beanstandete Zahlenbehauptung darf nie als TLDR-Vorschau sichtbar werden")
    precondition(repairUpdates.filter { $0.phase == "checking" }.count == 2)
    let repairedHit = await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: repairCache,
      onProgress: nil, onWritten: { await repairedRaw.add($0) })
    let afterRepairHit = await GemmaRuntime.shared.snapshot()
    let afterRepairRaw = await repairedRaw.snapshot()
    precondition(OnDeviceSummary.reusableResult(repairedHit) && afterRepairHit.1.count == 3 && afterRepairRaw == repairOutputs,
      "Nur das korrigierte gültige Ergebnis darf anschließend ohne neue Modellarbeit wiederverwendet werden")

    await GemmaRuntime.shared.configure(GemmaRuntime.plan, writerOutputs: [numericBad, GemmaRuntime.final])
    let cancelledWritten = Selections(), cancelledRepairProgress = Updates()
    let cancelledRepair = Task {
      await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: SummaryReuseCache(),
        onProgress: { await cancelledRepairProgress.add($0) }, onWritten: { output in
          await cancelledWritten.add(output)
          withUnsafeCurrentTask { $0?.cancel() }
        })
    }
    let cancelledRepairResult = await cancelledRepair.value
    let afterCancelledRepair = await GemmaRuntime.shared.snapshot()
    let cancelledRepairUpdates = await cancelledRepairProgress.snapshot()
    let cancelledRepairOutputs = await cancelledWritten.snapshot()
    precondition(cancelledRepairResult["code"] as? String == "CANCELLED" && afterCancelledRepair.1.count == 2 &&
      cancelledRepairOutputs == [numericBad] && cancelledRepairUpdates.filter { $0.phase == "checking" }.count == 1,
      "Ein echter Abbruch im ersten Schreibcallback muss vor Korrekturstatus und drittem Modellaufruf stoppen")
    await GemmaRuntime.shared.configure(GemmaRuntime.plan, throwingAtCall: 2)
    let nativeFailure = await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: SummaryReuseCache(), onProgress: nil)
    let afterNativeFailure = await GemmaRuntime.shared.snapshot()
    precondition(nativeFailure["code"] as? String == "GENERATION_FAILED" && afterNativeFailure.1.count == 2,
      "Ein nativer Ausgabelimitfehler darf keine automatische dritte Generierung starten")
    for (error, expectedCode, memoryAdvice) in [
      (GemmaRuntimeError.insufficientMemory(available: 2_400_000_000, required: 2_500_000_000), "INSUFFICIENT_MEMORY", true),
      (GemmaRuntimeError.modelUnavailable("PRIVATE_NATIVE_REASON"), "MODEL_UNAVAILABLE", false)
    ] {
      await GemmaRuntime.shared.configure(GemmaRuntime.plan, loadFailure: error)
      let failedLoad = await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: SummaryReuseCache(), onProgress: nil)
      let failedLoadCalls = await GemmaRuntime.shared.snapshot()
      let message = failedLoad["message"] as! String
      precondition(failedLoad["code"] as? String == expectedCode && failedLoad["summary"] == nil &&
        failedLoadCalls.0.count == 1 && failedLoadCalls.1.isEmpty)
      precondition(message.contains("schließe andere Apps") == memoryAdvice && !message.contains("PRIVATE_NATIVE_REASON"),
        "Nur tatsächlich typisierter Speichermangel darf den Rat zum Schließen anderer Apps liefern; native Details bleiben verborgen")
    }
    let busFixture = try JSONSerialization.jsonObject(with: Data(contentsOf:
      fixture.deletingLastPathComponent().appendingPathComponent("bus-first-writer.json"))) as! [String: String]
    let busSource = OnDeviceSummary.prepare(busFixture["source"]!)
    precondition(busSource == busFixture["preparedSource"]!)
    let busSelection = busFixture["selection"]!, busWriter = busFixture["writerOutput"]!
    await GemmaRuntime.shared.configure(busSelection, writerOutput: busWriter)
    let busCache = SummaryReuseCache(), busRaw = Selections(), busApp = Selections()
    let busResult = await GemmaSummary.reply(source: busSource, sourceIncomplete: false, cache: busCache,
      onProgress: nil, onWritten: { await busRaw.add($0) }, onAppRepair: { await busApp.add($0) })
    let busCalls = await GemmaRuntime.shared.snapshot(), busNativeOutputs = await busRaw.snapshot(), busAppOutputs = await busApp.snapshot()
    precondition(OnDeviceSummary.reusableResult(busResult) && busCalls.1.count == 2 &&
      busNativeOutputs == [busWriter] && busAppOutputs.isEmpty,
      "Der tatsächlich aufgezeichnete erste Bus-Writer muss ohne unnötige native Korrektur oder App-Umschreibung akzeptiert werden")
    let busDocument = try GemmaSummaryDocument.decode(busWriter,
      allowedEvidenceIDs: Set(GemmaEvidence.includedIDs(busSelection, in: busSource)))
    let busBody = busResult["summary"] as! [String: Any]
    precondition(busBody["tldr"] as? String == busDocument.tldr.text && busBody["points"] as? [String] == busDocument.points.map(\\.text) &&
      busBody["takeaway"] as? String == busDocument.takeaway.text)
    let busHit = await GemmaSummary.reply(source: busSource, sourceIncomplete: false, cache: busCache,
      onProgress: nil, onWritten: { await busRaw.add($0) }, onAppRepair: { await busApp.add($0) })
    let busCallsAfterHit = await GemmaRuntime.shared.snapshot()
    let busRawAfterHit = await busRaw.snapshot(), busAppAfterHit = await busApp.snapshot()
    precondition(NSDictionary(dictionary: busHit).isEqual(to: busResult) && busCallsAfterHit.1.count == 2 &&
      busRawAfterHit == busNativeOutputs && busAppAfterHit == busAppOutputs)
    if CommandLine.arguments.count > 3 {
      try await replayRecordedNativeOutputs(URL(fileURLWithPath: CommandLine.arguments[3]))
    }
    print("GEMMA_CPU_ROUTE_AND_SOURCE_GATE_OK")
  }

  struct RecordedReplay: Decodable {
    let outputDirectory: String
    let cases: [RecordedCase]
  }
  struct RecordedCase: Decodable {
    let name: String
    let source: String
    let preparedSource: String
    let selection: String
    let writerOutputs: [String]
    let removedPointIndices: [Int]
    let sourceYear: String?
    let sourceSHA256: String
    let preparedSourceSHA256: String
  }
  static func replayRecordedNativeOutputs(_ fixtureURL: URL) async throws {
    let fixture = try JSONDecoder().decode(RecordedReplay.self, from: Data(contentsOf: fixtureURL))
    for recorded in fixture.cases {
      let source = OnDeviceSummary.prepare(recorded.source)
      precondition(source == recorded.preparedSource, "Die vollständige aufgezeichnete Quelle muss identisch vorbereitet werden")
      let outputURL = URL(fileURLWithPath: fixture.outputDirectory, isDirectory: true).appendingPathComponent(recorded.name)
      try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)
      await GemmaRuntime.shared.configure(recorded.selection, writerOutputs: recorded.writerOutputs)
      let nativeOutputs = Selections(), appOutputs = Selections(), plans = Selections(), progress = Updates()
      let cache = SummaryReuseCache()
      let result = await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: cache,
        onProgress: { await progress.add($0) }, onSelection: { await plans.add($0) },
        onWritten: { await nativeOutputs.add($0) }, onAppRepair: { output in
          let calls = await GemmaRuntime.shared.snapshot()
          precondition(calls.1.count == recorded.writerOutputs.count + 1,
            "Eine App-Reparatur darf erst nach den tatsächlich aufgezeichneten nativen Phasen erfolgen")
          await appOutputs.add(output)
        })
      let snapshot = await GemmaRuntime.shared.snapshot()
      let raw = await nativeOutputs.snapshot(), transformed = await appOutputs.snapshot()
      let selected = await plans.snapshot(), updates = await progress.snapshot()
      precondition(OnDeviceSummary.reusableResult(result) && snapshot.0.count == 1 && snapshot.0[0].backend == "cpu")
      precondition(snapshot.1.count == recorded.writerOutputs.count + 1 && raw == recorded.writerOutputs && selected == [recorded.selection],
        "Der Replay muss genau die aufgezeichnete Auswahl und die nativen Writer konsumieren, ohne weitere Generierung")
      precondition(transformed.count == (recorded.removedPointIndices.isEmpty ? 0 : 1))
      let acceptedOutput = transformed.last ?? recorded.writerOutputs.last!
      let allowed = Set(try GemmaEvidence.includedIDs(recorded.selection, in: source))
      let accepted = try GemmaSummaryDocument.decode(acceptedOutput, allowedEvidenceIDs: allowed)
      let issues = try GemmaClaimValidation.issues(for: accepted, selection: recorded.selection, source: source)
      precondition(issues.isEmpty)
      var expectedFields = try JSONSerialization.jsonObject(with: Data(recorded.writerOutputs.last!.utf8)) as! [String: Any]
      let originalPoints = expectedFields["points"] as! [[String: Any]]
      expectedFields["points"] = originalPoints.enumerated().filter { !recorded.removedPointIndices.contains($0.offset) }.map(\\.element)
      let actualFields = try JSONSerialization.jsonObject(with: Data(acceptedOutput.utf8))
      let expectedBytes = try JSONSerialization.data(withJSONObject: expectedFields, options: [.sortedKeys])
      let actualBytes = try JSONSerialization.data(withJSONObject: actualFields, options: [.sortedKeys])
      precondition(actualBytes == expectedBytes, "Nur die expliziten Zusatzpunkte dürfen entfallen; kein Text oder Beleg wird umgeschrieben")
      let body = result["summary"] as! [String: Any]
      precondition(body["tldr"] as? String == accepted.tldr.text && body["points"] as? [String] == accepted.points.map(\\.text) &&
        body["takeaway"] as? String == accepted.takeaway.text)
      if let year = recorded.sourceYear {
        precondition(body["caveat"] as? String == "Zeitbezug der Quelle: \\(year).")
      }
      precondition(updates.compactMap(\\.tldr).allSatisfy { !$0.contains("3 von 5 Sternen") },
        "Die verworfene erfundene Bewertung darf im aufgezeichneten Replay nicht als Vorschau erscheinen")
      let cached = await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: cache,
        onProgress: nil, onSelection: { await plans.add($0) }, onWritten: { await nativeOutputs.add($0) },
        onAppRepair: { await appOutputs.add($0) })
      let afterCache = await GemmaRuntime.shared.snapshot()
      let rawAfterCache = await nativeOutputs.snapshot(), appAfterCache = await appOutputs.snapshot(), plansAfterCache = await plans.snapshot()
      precondition(NSDictionary(dictionary: cached).isEqual(to: result) && afterCache.1.count == snapshot.1.count &&
        rawAfterCache == raw && appAfterCache == transformed && plansAfterCache == selected)
      let calls: [[String: Any]] = snapshot.1.enumerated().map { index, call in
        ["index": index + 1, "instructions": call.instructions, "prompt": call.prompt,
         "maxTokens": call.limit, "thinkingBudget": call.thinkingBudget, "responseSchemaJSON": call.schema ?? ""]
      }
      var report: [String: Any] = ["mode": "recorded-native-output-replay", "inferencePerformed": false,
        "freshFullProviderInference": false, "physicalDevice": false, "policy": GemmaSummaryPolicy.version,
        "sourceSHA256": recorded.sourceSHA256, "preparedSourceSHA256": recorded.preparedSourceSHA256,
        "recordedNativeWriterOutputs": raw.count, "totalGenerateCalls": snapshot.1.count,
        "appRepairCount": transformed.count, "removedPointIndices": recorded.removedPointIndices,
        "unchangedRetainedTextAndEvidence": true, "remainingIssues": [], "cacheHitWithoutCallbacksOrModelCalls": true,
        "result": result, "progress": updates.map(\\.payload), "semanticAcceptance": false]
      if let year = recorded.sourceYear { report["sourceYear"] = year }
      try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys, .prettyPrinted])
        .write(to: outputURL.appendingPathComponent("replay-result.json"), options: .atomic)
      try JSONSerialization.data(withJSONObject: calls, options: [.sortedKeys, .prettyPrinted])
        .write(to: outputURL.appendingPathComponent("calls.json"), options: .atomic)
      try acceptedOutput.write(to: outputURL.appendingPathComponent("accepted-document.json"), atomically: true, encoding: .utf8)
    }
  }
}
`);
  const binary = path.join(root, 'route');
  const build = spawnSync('xcrun', ['swiftc', ...swift, '-I', root, '-parse-as-library',
    ...files.map(name => path.join(root, name)), path.join(root, 'GemmaModelStore.swift'), harness, '-o', binary],
  { encoding: 'utf8', timeout: 85000 });
  assert.equal(build.status, 0, build.stderr);
  const replay = process.env.LANGFORM_GEMMA_PROVIDER_REPLAY;
  if (replay) {
    const replayConfig = JSON.parse(fs.readFileSync(replay, 'utf8'));
    const snapshotDirectory = path.join(replayConfig.outputDirectory, 'compiled-provider-sources');
    fs.mkdirSync(snapshotDirectory, { recursive: true });
    const sourceManifest = {};
    for (const name of [...files, 'GemmaModelStore.swift', 'Route.swift']) {
      const bytes = fs.readFileSync(path.join(root, name));
      fs.writeFileSync(path.join(snapshotDirectory, name), bytes);
      sourceManifest[name] = { sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        transformation: name === 'GemmaModelStore.swift' ? 'Only fixture model path, byte count and digest; validation code retained.' : null };
    }
    fs.writeFileSync(path.join(replayConfig.outputDirectory, 'compiled-source-manifest.json'), JSON.stringify(sourceManifest, null, 2) + '\n');
  }
  const run = spawnSync(binary, [root, path.join(root, 'weights.fixture'), ...(replay ? [path.resolve(replay)] : [])], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /GEMMA_CPU_ROUTE_AND_SOURCE_GATE_OK/);
});
