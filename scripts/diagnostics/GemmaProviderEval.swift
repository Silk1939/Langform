import Foundation
import CryptoKit
import Darwin

/// Command-line harness only. All inference, prompts, constraints, parsing and
/// caching policy are compiled from the unchanged product source snapshot.
@main struct GemmaProviderEval {
    @MainActor static func main() async {
        let arguments = CommandLine.arguments
        guard arguments.count == 3 else {
            fputs("usage: GemmaProviderEval source.txt output-directory\n", stderr)
            exit(64)
        }
        let sourceURL = URL(fileURLWithPath: arguments[1])
        let directory = URL(fileURLWithPath: arguments[2], isDirectory: true)
        let run = Evaluation(directory: directory, sourceURL: sourceURL)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try Data(contentsOf: sourceURL)
            guard let source = String(data: data, encoding: .utf8) else {
                throw CocoaError(.fileReadInapplicableStringEncoding)
            }
            let prepared = OnDeviceSummary.prepare(source)
            run.report["inputBytes"] = data.count
            run.report["inputSHA256"] = digest(data)
            run.report["preparedInputBytes"] = prepared.utf8.count
            run.report["preparedInputSHA256"] = digest(Data(prepared.utf8))
            try data.write(to: directory.appendingPathComponent("source.txt"), options: .atomic)
            try Data(prepared.utf8).write(to: directory.appendingPathComponent("prepared-source.txt"), options: .atomic)
            run.report["status"] = "running"
            run.persist()
            let sampler = Task { @MainActor in
                while !Task.isCancelled {
                    run.captureMemory()
                    run.persist()
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                }
            }
            let result: [String: Any]
            if let previousPath = ProcessInfo.processInfo.environment["LANGFORM_GEMMA_EVAL_CORRECTION_FROM"] {
                result = try await correctionComponent(previousURL: URL(fileURLWithPath: previousPath),
                    sourceData: data, prepared: prepared, run: run)
            } else {
                result = await GemmaSummary.reply(source: prepared, sourceIncomplete: false,
                cache: SummaryReuseCache(), onProgress: { progress in
                    var row = progress.payload["progress"] as? [String: Any] ?? [:]
                    row["elapsedSeconds"] = run.elapsed
                    if run.progress.count < 256 { run.progress.append(row) }
                    run.captureMemory()
                    run.persist()
                }, onSelection: { selection in
                    run.report["selection"] = selection
                    run.report["selectionElapsedSeconds"] = run.elapsed
                    do {
                        _ = try GemmaEvidence.validate(selection, in: prepared)
                        run.report["sourceSelectionVerified"] = true
                        run.report["includedEvidenceIDs"] = try GemmaEvidence.includedIDs(selection, in: prepared)
                        let writerPrompt = try GemmaSummaryPolicy.writerPrompt(for: selection, source: prepared)
                        try Data(writerPrompt.utf8).write(to: directory.appendingPathComponent("writer-prompt.txt"), options: .atomic)
                    } catch {
                        run.report["sourceSelectionVerified"] = false
                        run.report["selectionValidationError"] = String(reflecting: error)
                    }
                    if let metrics = await GemmaRuntime.shared.lastMetrics {
                        run.report["selectionMetrics"] = try? jsonValue(metrics)
                    }
                    try? Data(selection.utf8).write(to: directory.appendingPathComponent("selection.txt"), options: .atomic)
                    run.captureMemory()
                    run.persist()
                }, onWritten: { output in
                    await run.recordWritten(output)
                }, onAppRepair: { document in
                    run.report["appRepairedDocument"] = document
                    run.report["appRepairCallbackCount"] = (run.report["appRepairCallbackCount"] as? Int ?? 0) + 1
                    run.report["appRepairIsNative"] = false
                    run.report["appRepairElapsedSeconds"] = run.elapsed
                    if let data = document.data(using: .utf8),
                       let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        run.report["appRepairedDocumentFields"] = object.keys.sorted()
                    }
                    try? Data(document.utf8).write(to: directory.appendingPathComponent("app-repaired-document.json"), options: .atomic)
                    run.persist()
                })
            }
            sampler.cancel()
            run.report["result"] = result
            run.report["runtimeLastFailure"] = await GemmaRuntime.shared.lastFailure
            if let metrics = await GemmaRuntime.shared.lastMetrics {
                run.report["nativeMetrics"] = try? jsonValue(metrics)
            }
            let completed = result["code"] == nil && OnDeviceSummary.reusableResult(result)
            run.report["complete"] = completed
            run.report["status"] = completed ? "completed" : "failed"
            run.report["elapsedSeconds"] = run.elapsed
            run.report["finishedAt"] = ISO8601DateFormatter().string(from: Date())
            run.captureMemory()
            run.persist()
            await GemmaRuntime.shared.cancelAndUnload()
            print("GEMMA_PROVIDER_EVAL \(completed ? "completed" : "failed") \(sourceURL.lastPathComponent) \(String(format: "%.3f", run.elapsed))s \(directory.appendingPathComponent("result.json").path)")
            exit(completed ? 0 : 2)
        } catch {
            run.report["status"] = "failed"
            run.report["complete"] = false
            run.report["errorReflection"] = String(reflecting: error)
            run.report["errorLocalizedDescription"] = error.localizedDescription
            run.report["elapsedSeconds"] = run.elapsed
            run.persist()
            await GemmaRuntime.shared.cancelAndUnload()
            fputs("GEMMA_PROVIDER_EVAL failed: \(String(reflecting: error))\n", stderr)
            exit(2)
        }
    }

    @MainActor private static func correctionComponent(previousURL: URL, sourceData: Data, prepared: String,
                                               run: Evaluation) async throws -> [String: Any] {
        let previousData = try Data(contentsOf: previousURL)
        guard let previous = try JSONSerialization.jsonObject(with: previousData) as? [String: Any],
              previous["inputSHA256"] as? String == digest(sourceData),
              previous["preparedInputSHA256"] as? String == digest(Data(prepared.utf8)),
              let selection = previous["selection"] as? String,
              let first = (previous["writerAttempts"] as? [[String: Any]])?.first?["raw"] as? String else {
            throw NSError(domain: "GemmaCorrectionFixture", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Prior report source hashes, selection or first writer do not match."])
        }
        run.report["providerRoute"] = "nativeCorrectionComponent"
        run.report["freshReuseCache"] = false
        run.report["previousReport"] = previousURL.path
        run.report["previousReportSHA256"] = digest(previousData)
        run.report["selection"] = selection
        run.report["selectionSHA256"] = digest(Data(selection.utf8))
        run.report["originalFirstWriterSHA256"] = digest(Data(first.utf8))
        run.report["selectionNativeGenerationPerformed"] = false
        run.report["initialWriterNativeGenerationPerformed"] = false
        let allowed = Set(try GemmaEvidence.includedIDs(selection, in: prepared))
        let document = try GemmaSummaryDocument.decode(first, allowedEvidenceIDs: allowed)
        let issues = try GemmaClaimValidation.issues(for: document, selection: selection, source: prepared)
        guard !issues.isEmpty else { throw NSError(domain: "GemmaCorrectionFixture", code: 2) }
        run.report["issuesBefore"] = try jsonValue(issues)
        try Data(selection.utf8).write(to: run.directory.appendingPathComponent("selection.txt"), options: .atomic)
        try Data(first.utf8).write(to: run.directory.appendingPathComponent("original-first-writer.txt"), options: .atomic)
        let repair = try GemmaSummaryRepair.request(for: first, issues: issues, selection: selection, source: prepared)
        let prompt = repair.prompt
        run.report["removedPointIndices"] = try jsonValue(repair.removedPointIndices)
        run.report["fixedFields"] = try jsonValue(repair.fixedFields)
        run.report["correctionSchemaSHA256"] = digest(Data(repair.schemaJSON.utf8))
        try Data(repair.schemaJSON.utf8).write(to: run.directory.appendingPathComponent("correction-schema.json"), options: .atomic)
        try Data(prompt.utf8).write(to: run.directory.appendingPathComponent("correction-prompt.txt"), options: .atomic)
        run.report["correctionPromptSHA256"] = digest(Data(prompt.utf8))
        run.report["correctionTokenLimit"] = GemmaSummaryPolicy.correctionTokenLimit
        run.report["correctionThinkingTokens"] = GemmaSummaryPolicy.correctionThinkingTokens
        run.persist()
        let modelURL = try await GemmaModelStore.shared.validatedURL()
        try await GemmaRuntime.shared.load(modelURL: modelURL, backend: GemmaModelStore.runtimeBackend,
                                           verifiedContextTokens: GemmaModelStore.verifiedContextTokens)
        let output = try await GemmaRuntime.shared.generate(instructions: GemmaSummaryPolicy.instructions,
            prompt: prompt, maxTokens: GemmaSummaryPolicy.correctionTokenLimit,
            responseSchemaJSON: repair.schemaJSON,
            thinkingBudget: GemmaSummaryPolicy.correctionThinkingTokens) { _ in }
        await run.recordWritten(output)
        let finalDocument = try GemmaSummaryDocument.decode(output, allowedEvidenceIDs: allowed)
        let remaining = try GemmaClaimValidation.issues(for: finalDocument, selection: selection, source: prepared)
        run.report["issuesAfter"] = try jsonValue(remaining)
        run.report["correctionValidatorPassed"] = remaining.isEmpty
        return remaining.isEmpty ? GemmaSummary.result(from: output, sourceIncomplete: false,
            totalSections: max(1, OnDeviceSummary.sections(for: prepared).count), allowedEvidenceIDs: allowed)
            : OnDeviceSummary.failure("GENERATION_FAILED", "Die Korrektur enthält weiterhin belegte Validatorverstöße.")
    }

    static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func jsonValue<T: Encodable>(_ value: T) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
    }
}

@MainActor private final class Evaluation {
    let directory: URL
    let started = ProcessInfo.processInfo.systemUptime
    var elapsed: Double { ProcessInfo.processInfo.systemUptime - started }
    var progress: [[String: Any]] = []
    var writerAttempts: [[String: Any]] = []
    var report: [String: Any]

    init(directory: URL, sourceURL: URL) {
        self.directory = directory
        report = [
            "schemaVersion": 1,
            "startedAt": ISO8601DateFormatter().string(from: Date()),
            "sourcePath": sourceURL.path,
            "platform": "macOS",
            "physicalDevice": false,
            "providerRoute": "GemmaSummary.reply",
            "policy": GemmaSummaryPolicy.version,
            "runtimeIdentity": GemmaSummaryPolicy.runtimeIdentity,
            "model": GemmaModelStore.modelName,
            "modelIdentity": GemmaModelStore.providerIdentity,
            "runtimeBackend": GemmaModelStore.runtimeBackend,
            "verifiedContextTokens": GemmaModelStore.verifiedContextTokens ?? 0,
            "selectionTokenLimit": GemmaSummaryPolicy.selectionTokenLimit,
            "selectionThinkingTokens": GemmaSummaryPolicy.selectionThinkingTokens,
            "writerTokenLimit": GemmaSummaryPolicy.writerTokenLimit,
            "writerThinkingTokens": GemmaSummaryPolicy.writerThinkingTokens,
            "correctionTokenLimit": GemmaSummaryPolicy.correctionTokenLimit,
            "correctionThinkingTokens": GemmaSummaryPolicy.correctionThinkingTokens,
            "sourceIncomplete": false,
            "freshReuseCache": true,
            "executionMode": ProcessInfo.processInfo.environment["LANGFORM_GEMMA_EVAL_EXECUTION_MODE"] ?? "serial independent CPU processes",
            "evaluationJobs": Int(ProcessInfo.processInfo.environment["LANGFORM_GEMMA_EVAL_JOBS"] ?? "1") ?? 1,
            "sourceManifest": ProcessInfo.processInfo.environment["LANGFORM_GEMMA_EVAL_SOURCE_MANIFEST"] ?? "",
            "performanceComparison": false,
            "semanticAcceptance": false,
            "status": "preparing",
            "complete": false
        ]
    }

    func recordWritten(_ output: String) async {
        let index = writerAttempts.count + 1
        var attempt: [String: Any] = ["index": index, "raw": output, "elapsedSeconds": elapsed]
        report["rawWriter"] = output
        report["writerOutput"] = output
        report["writerElapsedSeconds"] = elapsed
        try? Data(output.utf8).write(to: directory.appendingPathComponent("writer-output.txt"), options: .atomic)
        try? Data(output.utf8).write(to: directory.appendingPathComponent("writer-attempt-\(index).txt"), options: .atomic)
        if let metrics = await GemmaRuntime.shared.lastMetrics, let value = try? GemmaProviderEval.jsonValue(metrics) {
            attempt["nativeMetrics"] = value
            report["writerMetrics"] = value
        }
        if let selection = report["selection"] as? String {
            do {
                let source = try String(contentsOf: directory.appendingPathComponent("prepared-source.txt"), encoding: .utf8)
                let allowed = Set(try GemmaEvidence.includedIDs(selection, in: source))
                let document = try GemmaSummaryDocument.decode(output, allowedEvidenceIDs: allowed)
                attempt["strictDocumentParsed"] = true
                let issues = try GemmaClaimValidation.issues(for: document, selection: selection, source: source)
                attempt["recomputedValidationIssues"] = try GemmaProviderEval.jsonValue(issues)
                attempt["recomputedValidatorPassed"] = issues.isEmpty
            } catch {
                attempt["validationAnalysisError"] = String(reflecting: error)
            }
        }
        writerAttempts.append(attempt)
        report["writerAttempts"] = writerAttempts
        report["writerAttemptCount"] = writerAttempts.count
        captureMemory()
        persist()
    }

    func captureMemory() {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let status = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        if status == KERN_SUCCESS {
            let peak = report["peakObservedPhysicalFootprintBytes"] as? UInt64 ?? 0
            report["peakObservedPhysicalFootprintBytes"] = max(peak, info.phys_footprint)
            report["peakObservedResidentBytes"] = max(report["peakObservedResidentBytes"] as? UInt64 ?? 0, info.resident_size)
            var samples = report["memorySamples"] as? [[String: Any]] ?? []
            if samples.count < 2_000 {
                samples.append(["elapsedSeconds": elapsed, "physicalFootprintBytes": info.phys_footprint,
                    "residentBytes": info.resident_size, "virtualBytes": info.virtual_size,
                    "regionCount": info.region_count])
                report["memorySamples"] = samples
            }
        }
    }

    func persist() {
        do {
            var snapshot = report
            snapshot["progress"] = progress
            try JSONSerialization.data(withJSONObject: snapshot, options: [.prettyPrinted, .sortedKeys])
                .write(to: directory.appendingPathComponent("result.json"), options: .atomic)
        } catch {
            fputs("EVAL_REPORT_WRITE_FAILED \(String(reflecting: error))\n", stderr)
        }
    }
}
