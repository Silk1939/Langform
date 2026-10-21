import Foundation
#if os(iOS)
import UIKit
#endif

enum GemmaSummary {
    static func reply(source: String, sourceIncomplete: Bool, cache: SummaryReuseCache,
                      onProgress: ((OnDeviceSummary.Progress) async -> Void)?,
                      onSelection: ((String) async -> Void)? = nil,
                      onWritten: ((String) async -> Void)? = nil,
                      onAppRepair: ((String) async -> Void)? = nil) async -> [String: Any] {
        let identity = GemmaModelStore.providerIdentity + ":" + GemmaSummaryPolicy.runtimeIdentity + ":" + GemmaSummaryPolicy.version
            + ":" + GemmaSummaryPolicy.instructions + ":" + GemmaSummaryPolicy.verificationPrompt
        let prompt = GemmaSummaryPolicy.prompt(for: source)
        let key = OnDeviceSummary.reuseKey(prompt, scope: "summary:" + identity)
        do {
            try await checkActiveRequest()
            if !sourceIncomplete, let data = await cache.data(for: key),
               let cached = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               OnDeviceSummary.reusableResult(cached) {
                try Task.checkCancellation()
                return cached
            }
            #if os(iOS)
            let awake = await SummaryIdleTimer.begin()
            defer { Task { @MainActor in SummaryIdleTimer.end(awake) } }
            #endif
            let total = max(1, OnDeviceSummary.sections(for: source).count)
            await onProgress?(.init(phase: "preparing", processedSections: 0, totalSections: total,
                                   sourceIncomplete: sourceIncomplete, coverageIncomplete: false))
            let modelURL: URL
            do {
                modelURL = try await GemmaModelStore.shared.validatedURL()
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                var missing = OnDeviceSummary.failure("GEMMA_MODEL_NOT_READY",
                    "Das Google-Modell ist noch nicht bereit. Öffne die Modelleinstellungen, um es zu laden oder den Download zu prüfen.")
                missing["modelSetup"] = true
                return missing
            }
            #if canImport(LiteRTLM) && !targetEnvironment(simulator)
            try await checkActiveRequest()
            try await GemmaRuntime.shared.load(modelURL: modelURL,
                                               backend: GemmaModelStore.runtimeBackend,
                                               verifiedContextTokens: GemmaModelStore.verifiedContextTokens)
            try await checkActiveRequest()
            await onProgress?(.init(phase: "reading", processedSections: 0, totalSections: total,
                                   sourceIncomplete: sourceIncomplete, coverageIncomplete: false))
            let selection = try await GemmaRuntime.shared.generate(
                instructions: GemmaSummaryPolicy.instructions,
                prompt: prompt, maxTokens: GemmaSummaryPolicy.selectionTokenLimit,
                responseSchemaJSON: try GemmaEvidence.selectionSchema(for: source),
                thinkingBudget: GemmaSummaryPolicy.selectionThinkingTokens
            ) { _ in }
            await onSelection?(selection)
            try await checkActiveRequest()
            let allowedEvidenceIDs = Set(try GemmaEvidence.includedIDs(selection, in: source))
            let verdictIDs = try GemmaEvidence.directIDs(for: "verdict", selection: selection, source: source)
            let verdictContextIDs = try GemmaEvidence.allowedIDs(for: "verdict", selection: selection, source: source)
            let writerPrompt = try GemmaSummaryPolicy.writerPrompt(for: selection, source: source)
            let run = GemmaSummaryProgress(total: total, sourceIncomplete: sourceIncomplete,
                                           source: source, verdictIDs: verdictIDs,
                                           verdictContextIDs: verdictContextIDs, update: onProgress)
            await run.startReview()
            try await checkActiveRequest()
            // The first conversation is fully drained and released. Give the
            // writer only the selected original passages, without the previous
            // draft or the unrelated full-source KV competing for attention.
            let writerSchema = try GemmaSummaryDocument.schema(allowedEvidenceIDs: allowedEvidenceIDs.sorted())
            var output = try await GemmaRuntime.shared.generate(
                instructions: GemmaSummaryPolicy.instructions,
                prompt: writerPrompt, maxTokens: GemmaSummaryPolicy.writerTokenLimit,
                responseSchemaJSON: writerSchema,
                thinkingBudget: GemmaSummaryPolicy.writerThinkingTokens
            ) { text in await run.receive(text) }
            await onWritten?(output)
            try await checkActiveRequest()
            var issues = try validationIssues(for: output, selection: selection, source: source,
                                              allowedEvidenceIDs: allowedEvidenceIDs)
            if !issues.isEmpty {
                await run.startReview()
                try await checkActiveRequest()
                // The app may omit only a redundant invalid extra point while
                // preserving valid main points and both selected review sides.
                // This is recorded separately from actual native model output.
                let repair = try GemmaSummaryRepair.request(for: output, issues: issues,
                                                             selection: selection, source: source)
                if repair.preparedOutput != output {
                    output = repair.preparedOutput
                    await onAppRepair?(output)
                    try await checkActiveRequest()
                }
                if repair.needsGeneration {
                    // At most one fresh native retry. Long literal grammar
                    // enums are unsupported by the pinned native tokenizer.
                    output = try await GemmaRuntime.shared.generate(
                        instructions: GemmaSummaryPolicy.instructions,
                        prompt: repair.prompt,
                        maxTokens: GemmaSummaryPolicy.correctionTokenLimit,
                        responseSchemaJSON: repair.schemaJSON, thinkingBudget: GemmaSummaryPolicy.correctionThinkingTokens
                    ) { text in await run.receive(text) }
                    await onWritten?(output)
                    try await checkActiveRequest()
                    let findings = try validationIssues(for: output, selection: selection, source: source,
                                                         allowedEvidenceIDs: allowedEvidenceIDs)
                    if !findings.isEmpty {
                        let finalRepair = try GemmaSummaryRepair.request(for: output, issues: findings,
                                                                        selection: selection, source: source)
                        if finalRepair.preparedOutput != output {
                            output = finalRepair.preparedOutput
                            await onAppRepair?(output)
                            try await checkActiveRequest()
                        }
                    }
                }
                issues = try validationIssues(for: output, selection: selection, source: source,
                                               allowedEvidenceIDs: allowedEvidenceIDs)
            }
            guard issues.isEmpty else {
                return validationFailure(issues: issues)
            }
            let result = result(from: output, sourceIncomplete: sourceIncomplete, totalSections: total,
                                allowedEvidenceIDs: allowedEvidenceIDs,
                                sourceYear: try GemmaClaimValidation.requiredSourceYear(selection: selection, source: source))
            if !sourceIncomplete, OnDeviceSummary.reusableResult(result),
               let data = try? JSONSerialization.data(withJSONObject: result) {
                await cache.store(data, for: key)
            }
            try Task.checkCancellation()
            return result
            #else
            _ = modelURL
            return OnDeviceSummary.failure("MODEL_UNAVAILABLE",
                "Gemma wird auf einem echten iPhone ausgeführt. Der Simulator unterstützt diese lokale Modellprüfung nicht.")
            #endif
        } catch is CancellationError {
            return OnDeviceSummary.failure("CANCELLED", "Die Kurzfassung wurde abgebrochen.")
        } catch {
            if case GemmaEvidenceError.insufficient = error {
                return OnDeviceSummary.failure("INSUFFICIENT_CONTENT", OnDeviceSummary.insufficientContentMessage)
            }
            if error is GemmaEvidenceError {
                return OnDeviceSummary.failure("GENERATION_FAILED",
                    "Die Kurzfassung konnte nicht zuverlässig an der Quelle belegt werden. Bitte versuche es erneut.")
            }
            #if canImport(LiteRTLM) && !targetEnvironment(simulator)
            switch error {
            case GemmaRuntimeError.contextTooLarge:
                return OnDeviceSummary.failure("CONTEXT_TOO_LARGE",
                    "Dieses Video ist für das lokale Kontextbudget zu lang. Es wurde keine gekürzte Kurzfassung erstellt.")
            case GemmaRuntimeError.outputLimit:
                return OnDeviceSummary.failure("GENERATION_FAILED",
                    "Gemma hat keine vollständige Kurzfassung geliefert. Bitte versuche es erneut.")
            case GemmaRuntimeError.insufficientMemory:
                return OnDeviceSummary.failure("INSUFFICIENT_MEMORY",
                    "Für den sicheren lokalen Modellstart ist gerade zu wenig Arbeitsspeicher frei. Bitte schließe andere Apps und versuche es erneut.")
            case GemmaRuntimeError.modelUnavailable:
                return OnDeviceSummary.failure("MODEL_UNAVAILABLE",
                    "Gemma konnte auf diesem iPhone gerade nicht geladen werden. Bitte versuche es erneut.")
            default: break
            }
            #endif
            return OnDeviceSummary.failure("GENERATION_FAILED",
                "Gemma konnte dieses Video gerade nicht zusammenfassen. Bitte versuche es erneut.")
        }
    }

    /// Expose exact gate failures only during the explicitly requested local
    /// diagnostic. Ordinary summaries never return diagnostic details or drafts.
    static func validationFailure(issues: [GemmaClaimValidation.Issue],
                                  arguments: [String] = ProcessInfo.processInfo.arguments,
                                  environment: [String: String] = ProcessInfo.processInfo.environment) -> [String: Any] {
        var result = OnDeviceSummary.failure("GENERATION_FAILED",
            "Die Kurzfassung konnte nicht zuverlässig an der Quelle belegt werden. Bitte versuche es erneut.")
        if arguments.contains("--langform-gemma-diagnostic"), environment["LANGFORM_GEMMA_PROBE"] == "1" {
            result["diagnosticValidationIssues"] = issues.map {
                ["field": $0.field, "code": $0.code, "message": $0.message]
            }
        }
        return result
    }

    private static func validationIssues(for output: String, selection: String, source: String,
                                         allowedEvidenceIDs: Set<Int>) throws -> [GemmaClaimValidation.Issue] {
        guard let document = try? GemmaSummaryDocument.decode(output, allowedEvidenceIDs: allowedEvidenceIDs) else {
            return [.init(field: "document", code: "invalid_document",
                          message: "Das vollständige JSON muss das geforderte Schema mit gültigen Originalnummern und Punktrollen einhalten.")]
        }
        return try GemmaClaimValidation.issues(for: document, selection: selection, source: source)
    }

    static func result(from output: String, sourceIncomplete: Bool, totalSections: Int,
                       allowedEvidenceIDs: Set<Int>, sourceYear: String? = nil) -> [String: Any] {
        if output.trimmingCharacters(in: .whitespacesAndNewlines) == "[ZU_WENIG_INHALT]" {
            return OnDeviceSummary.failure("INSUFFICIENT_CONTENT", OnDeviceSummary.insufficientContentMessage)
        }
        guard !output.contains("<think>"), !output.contains("<|channel>"),
              let parsed = try? GemmaSummaryDocument.decode(output, allowedEvidenceIDs: allowedEvidenceIDs) else {
            return OnDeviceSummary.failure("GENERATION_FAILED", OnDeviceSummary.generationFailedMessage)
        }
        var summary: [String: Any] = ["tldr": parsed.tldr.text, "points": parsed.points.map(\.text),
            "takeaway": parsed.takeaway.text, "model": GemmaModelStore.modelName,
            "coverage": ["processedSections": totalSections, "totalSections": totalSections,
                         "complete": !sourceIncomplete]]
        var caveats = [String]()
        if sourceIncomplete {
            caveats.append("Es standen nur unvollständige Untertitel zur Verfügung. Diese Kurzfassung bezieht sich auf den verfügbaren Ausschnitt.")
        }
        if let sourceYear { caveats.append("Zeitbezug der Quelle: \(sourceYear).") }
        if !caveats.isEmpty { summary["caveat"] = caveats.joined(separator: " ") }
        return ["summary": summary]
    }

    static func cancelAndUnload() async {
        #if canImport(LiteRTLM) && !targetEnvironment(simulator)
        await GemmaRuntime.shared.cancelAndUnload()
        #endif
    }

    private static func checkActiveRequest() async throws {
        try Task.checkCancellation()
        #if os(iOS)
        let active = await MainActor.run { UIApplication.shared.applicationState == .active }
        guard active else { throw CancellationError() }
        #endif
    }
}

#if os(iOS)
/// Overlapping requests and the opt-in probe share one balanced screen lease.
@MainActor enum SummaryIdleTimer {
    private static var owners = Set<UUID>()
    private static var previous = false

    static func begin() -> UUID {
        let owner = UUID()
        if owners.isEmpty {
            previous = UIApplication.shared.isIdleTimerDisabled
            UIApplication.shared.isIdleTimerDisabled = true
        }
        owners.insert(owner)
        return owner
    }

    static func end(_ owner: UUID) {
        guard owners.remove(owner) != nil else { return }
        if owners.isEmpty { UIApplication.shared.isIdleTimerDisabled = previous }
    }
}
#endif

/// One generation owns its preview state. Native request leases provide the
/// independent final gate before any callback reaches a WebView.
private actor GemmaSummaryProgress {
    let total: Int
    let sourceIncomplete: Bool
    let source: String
    let verdictIDs: Set<Int>
    let verdictContextIDs: Set<Int>
    let update: ((OnDeviceSummary.Progress) async -> Void)?
    private var preview: String?
    private var started = false

    init(total: Int, sourceIncomplete: Bool, source: String, verdictIDs: Set<Int>,
         verdictContextIDs: Set<Int>,
         update: ((OnDeviceSummary.Progress) async -> Void)?) {
        self.total = total
        self.sourceIncomplete = sourceIncomplete
        self.source = source
        self.verdictIDs = verdictIDs
        self.verdictContextIDs = verdictContextIDs
        self.update = update
    }

    func receive(_ text: String) async {
        var value: String?
        if !sourceIncomplete,
           let claim = GemmaSummaryDocument.previewClaim(text, allowedEvidenceIDs: verdictContextIDs),
           !verdictIDs.isDisjoint(with: claim.evidenceIDs),
           GemmaClaimValidation.issues(for: claim, field: "tldr", source: source).isEmpty {
            value = claim.text
        }
        guard !started || (value != nil && value != preview) else { return }
        started = true
        preview = value
        await update?(.init(phase: "writing", processedSections: total, totalSections: total,
                            sourceIncomplete: sourceIncomplete, coverageIncomplete: false, tldr: value))
    }

    func startReview() async {
        preview = nil
        started = false
        await update?(.init(phase: "checking", processedSections: total, totalSections: total,
                            sourceIncomplete: sourceIncomplete, coverageIncomplete: false))
    }
}
