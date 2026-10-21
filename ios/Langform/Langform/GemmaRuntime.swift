import Foundation
import LiteRTLM
import CLiteRTLM
#if os(iOS)
import os
import Darwin
#endif

/// Explicit developer diagnostics only. Store operation names, never prompts
/// or model output; keep the failing C thread's error untouched.
enum GemmaDiagnosticTrace {
    private static let enabled = isEnabled(arguments: ProcessInfo.processInfo.arguments,
                                           environment: ProcessInfo.processInfo.environment)
    private static let normalHost = isNormalHostEnabled(arguments: ProcessInfo.processInfo.arguments,
                                                        environment: ProcessInfo.processInfo.environment)
    private static let lock = NSLock()
    private static let started = ProcessInfo.processInfo.systemUptime

    static func isEnabled(arguments: [String], environment: [String: String]) -> Bool {
        (arguments.contains("--langform-gemma-diagnostic") && environment["LANGFORM_GEMMA_PROBE"] == "1")
            || isNormalHostEnabled(arguments: arguments, environment: environment)
    }

    static func isNormalHostEnabled(arguments: [String], environment: [String: String]) -> Bool {
        arguments.contains("--langform-summary-host-probe") && environment["LANGFORM_SUMMARY_HOST_PROBE"] == "1"
    }

    static func record(_ stage: String, directory: URL? = nil) {
        guard enabled, stage.range(of: "^[a-z0-9._-]+$", options: .regularExpression) != nil else { return }
        lock.lock()
        defer { lock.unlock() }
        do {
            let folder = directory ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                .appendingPathComponent(normalHost ? "GemmaSummaryHostProbe" : "GemmaProbe", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent("runtime-trace.jsonl")
            if !FileManager.default.fileExists(atPath: url.path) {
                FileManager.default.createFile(atPath: url.path, contents: nil)
            }
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            let origin = started
            var data = try JSONSerialization.data(withJSONObject: [
                "stage": stage, "elapsedSeconds": ProcessInfo.processInfo.systemUptime - origin
            ], options: [.sortedKeys])
            data.append(10)
            try handle.write(contentsOf: data)
        } catch {
            // Diagnostics must never replace a native error or change its
            // failure path when an output file cannot be written.
        }
    }

    /// Raw native setup errors are useful only for an explicitly requested
    /// diagnostic run. They never enter the ordinary content-free journal.
    static func recordNativeFailure(code: Int, message: String, stage: String, directory: URL? = nil) {
        guard enabled, ["engine.settings", "engine.create"].contains(stage) else { return }
        lock.lock()
        defer { lock.unlock() }
        do {
            let folder = directory ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                .appendingPathComponent(normalHost ? "GemmaSummaryHostProbe" : "GemmaProbe", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            var excluded = folder
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try excluded.setResourceValues(values)
            let output = folder.appendingPathComponent("native-failure.json")
            let data = try JSONSerialization.data(withJSONObject: [
                "schemaVersion": 1, "stage": stage, "nativeStatusCode": code,
                "message": message, "processID": ProcessInfo.processInfo.processIdentifier,
                "timestamp": ISO8601DateFormatter().string(from: Date())
            ], options: [.sortedKeys])
            try data.write(to: output, options: .atomic)
            #if os(iOS)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                                                  ofItemAtPath: output.path)
            #endif
        } catch {
            // Keep the captured native status and original failure unchanged.
        }
    }
}

/// One bounded, content-free record survives an ordinary app failure. No
/// prompt, model output, source path or native error string enters this schema.
enum GemmaRuntimeLoadJournal {
    enum Code: String, Codable, Sendable {
        case loadRequested, loadAdmitted, engineReused, loadCoalesced, loaded, loadCancelled
        case insufficientMemory, gpuDisabled, modelMissing, modelMetadataFailed
        case unknownContext, nativeSettingsFailed, nativeCreateFailed, cacheUnavailable, engineMissing
    }

    struct Snapshot: Codable, Sendable {
        let schemaVersion: Int
        let code: Code
        let availableMemoryBytes: UInt64?
        let requiredMemoryBytes: UInt64
        let physicalFootprintBytes: UInt64?
        let processID: Int32
        let buildNumber: Int?
        let backend: String
        let contextTokens: Int?
        let engineLoaded: Bool
        let nativeStatusCode: Int?
        let timestamp: Date
    }

    static let directoryName = "GemmaRuntimeStatus"
    static let fileName = "last-load.json"
    private static let lock = NSLock()

    static func makeSnapshot(code: Code, availableMemoryBytes: UInt64?, physicalFootprintBytes: UInt64?,
                             backend: String, contextTokens: Int?, engineLoaded: Bool,
                             nativeStatusCode: Int? = nil,
                             processID: Int32 = ProcessInfo.processInfo.processIdentifier,
                             buildNumber: Int? = (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String).flatMap(Int.init),
                             timestamp: Date = Date()) -> Snapshot {
        let normalized = backend.lowercased()
        let safeBackend = normalized == "cpu" ? "cpu" : (normalized.hasPrefix("gpu") ? "gpu" : "unknown")
        return Snapshot(schemaVersion: 1, code: code, availableMemoryBytes: availableMemoryBytes,
                        requiredMemoryBytes: GemmaRuntime.minimumColdStartBytes,
                        physicalFootprintBytes: physicalFootprintBytes, processID: processID,
                        buildNumber: buildNumber, backend: safeBackend, contextTokens: contextTokens,
                        engineLoaded: engineLoaded,
                        nativeStatusCode: nativeStatusCode.flatMap { (0...16).contains($0) ? $0 : nil },
                        timestamp: timestamp)
    }

    static func persist(_ snapshot: Snapshot, directory: URL? = nil) {
        lock.lock()
        defer { lock.unlock() }
        do {
            let folder = directory ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                .appendingPathComponent(directoryName, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            var excluded = folder
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try excluded.setResourceValues(values)
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            encoder.outputFormatting = [.sortedKeys]
            let output = folder.appendingPathComponent(fileName)
            try encoder.encode(snapshot).write(to: output, options: .atomic)
            #if os(iOS)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                                                  ofItemAtPath: output.path)
            #endif
        } catch {
            // A status write cannot replace the original runtime failure.
        }
    }

    static func record(_ code: Code, availableMemoryBytes: UInt64? = nil,
                       backend: String, contextTokens: Int?, engineLoaded: Bool,
                       nativeStatusCode: Int? = nil) {
        var available = availableMemoryBytes
        var footprint: UInt64?
        #if os(iOS)
        if available == nil { available = UInt64(os_proc_available_memory()) }
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        if result == KERN_SUCCESS { footprint = info.phys_footprint }
        #endif
        persist(makeSnapshot(code: code, availableMemoryBytes: available, physicalFootprintBytes: footprint,
                             backend: backend, contextTokens: contextTokens, engineLoaded: engineLoaded,
                             nativeStatusCode: nativeStatusCode))
    }
}

enum GemmaRuntimeError: Error, LocalizedError {
    case modelUnavailable(String)
    case insufficientMemory(available: UInt64, required: UInt64)
    case contextTooLarge(input: Int, available: Int)
    case generation(String)
    case outputLimit

    var errorDescription: String? {
        switch self {
        case .modelUnavailable(let detail): return "Gemma ist nicht verfügbar: \(detail)"
        case .insufficientMemory: return "Für den sicheren Modellstart sind mindestens 2,5 GB freier App-Speicher nötig."
        case .contextTooLarge(let input, let available): return "Die vollständige Quelle benötigt \(input) Tokens; verfügbar sind \(available). Die Quelle wurde nicht gekürzt."
        case .generation(let detail): return "Gemma konnte die Kurzfassung nicht erstellen: \(detail)"
        case .outputLimit: return "Gemma hat das Ausgabelimit erreicht. Die unvollständige Kurzfassung wird nicht übernommen."
        }
    }
}

/// One runtime for the application, regardless of how many web views exist.
/// Native handles survive cancellation until the final C callback has drained.
actor GemmaRuntime {
    static let shared = GemmaRuntime()
    // Physical CPU/8K full-source runs reach about 2.0 GB with both constraints.
    // Keep additional room
    // for inference; the former 3.2 GB gate was based on the GPU allocation.
    nonisolated static let minimumColdStartBytes: UInt64 = 2_500_000_000
    private var engine: GemmaNativeEngine?
    private var loading: (url: URL, backend: String, verifiedContextTokens: Int?, epoch: UInt64, task: Task<GemmaNativeEngine, Error>)?
    private var loadEpoch: UInt64 = 0
    private var request: UInt64 = 0
    private var active: GemmaNativeConversation?
    private var worker: Task<GemmaGeneratedText, Error>?
    private(set) var lastMetrics: GemmaRuntimeMetrics?
    private(set) var lastDraftMetrics: GemmaRuntimeMetrics?
    private(set) var lastDraftText: String?
    /// Preserve the underlying runtime error before the provider maps it to a
    /// short user-facing response. No source text is recorded here.
    private(set) var lastFailure: String?
    private var lastLoadBackend = "unknown"
    private var lastLoadContextTokens: Int?

    func load(modelURL: URL, backend: String = "gpu", verifiedContextTokens: Int? = nil) async throws {
        GemmaDiagnosticTrace.record("load.request")
        try Task.checkCancellation()
        lastLoadBackend = backend
        lastLoadContextTokens = verifiedContextTokens
        GemmaRuntimeLoadJournal.record(.loadRequested, backend: backend,
                                       contextTokens: verifiedContextTokens, engineLoaded: engine != nil)
        #if os(iOS)
        // This device runtime aborts inside the Metal driver while compiling
        // argument-buffer pipelines. Swift cannot catch that native exception.
        if backend.lowercased().hasPrefix("gpu") {
            GemmaRuntimeLoadJournal.record(.gpuDisabled, backend: backend,
                                           contextTokens: verifiedContextTokens, engineLoaded: engine != nil)
            let error = GemmaRuntimeError.modelUnavailable(
                "Die GPU-Ausführung ist auf dem iPhone wegen eines Treiberfehlers deaktiviert. Bitte verwende die CPU-Ausführung.")
            lastFailure = String(reflecting: error)
            throw error
        }
        #endif
        if let engine, engine.modelURL == modelURL, engine.backend == backend,
           engine.verifiedContextTokens == verifiedContextTokens {
            GemmaRuntimeLoadJournal.record(.engineReused, backend: backend,
                                           contextTokens: verifiedContextTokens, engineLoaded: true)
            return
        }
        let pending: (url: URL, backend: String, verifiedContextTokens: Int?, epoch: UInt64, task: Task<GemmaNativeEngine, Error>)
        if let loading, loading.url == modelURL, loading.backend == backend,
           loading.verifiedContextTokens == verifiedContextTokens {
            GemmaDiagnosticTrace.record("load.coalesced")
            GemmaRuntimeLoadJournal.record(.loadCoalesced, backend: backend,
                                           contextTokens: verifiedContextTokens, engineLoaded: engine != nil)
            pending = loading
        } else {
            if loading != nil || engine != nil || worker != nil {
                guard let stopLease = await stopAndUnload(), request == stopLease else {
                    throw CancellationError()
                }
                try Task.checkCancellation()
            }
            #if os(iOS)
            // Reserve CPU inference headroom before loading; loaded weights
            // already use this budget. GPU is rejected before this point.
            // Coalesced callers and an existing matching engine skip this check.
            if engine == nil {
                let available = UInt64(os_proc_available_memory())
                guard available >= Self.minimumColdStartBytes else {
                    let error = GemmaRuntimeError.insufficientMemory(available: available, required: Self.minimumColdStartBytes)
                    lastFailure = String(reflecting: error)
                    GemmaRuntimeLoadJournal.record(.insufficientMemory, availableMemoryBytes: available,
                        backend: backend, contextTokens: verifiedContextTokens, engineLoaded: false)
                    GemmaDiagnosticTrace.record("load.memory.rejected")
                    throw error
                }
                GemmaRuntimeLoadJournal.record(.loadAdmitted, availableMemoryBytes: available,
                    backend: backend, contextTokens: verifiedContextTokens, engineLoaded: false)
            }
            #endif
            // The empty-runtime path must not suspend before registering the
            // load. Otherwise two simultaneous callers could both start one.
            request &+= 1
            loadEpoch &+= 1
            let epoch = loadEpoch
            let task = Task.detached(priority: .userInitiated) {
                try GemmaNativeEngine(modelURL: modelURL, backend: backend, verifiedContextTokens: verifiedContextTokens)
            }
            pending = (modelURL, backend, verifiedContextTokens, epoch, task)
            loading = pending
        }
        do {
            let loaded = try await pending.task.value
            guard loadEpoch == pending.epoch else { throw CancellationError() }
            if loading?.epoch == pending.epoch { loading = nil }
            try Task.checkCancellation()
            engine = loaded
            GemmaRuntimeLoadJournal.record(.loaded, backend: backend,
                                           contextTokens: verifiedContextTokens, engineLoaded: true)
            GemmaDiagnosticTrace.record("load.ready")
        } catch {
            if loading?.epoch == pending.epoch { loading = nil }
            lastFailure = String(reflecting: error)
            if error is CancellationError {
                GemmaRuntimeLoadJournal.record(.loadCancelled, backend: backend,
                                               contextTokens: verifiedContextTokens, engineLoaded: engine != nil)
            }
            GemmaDiagnosticTrace.record("load.failed")
            throw error
        }
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
        try Task.checkCancellation()
        request &+= 1
        let lease = request
        let previous = worker
        active?.cancel()
        if let previous { _ = await previous.result }
        guard lease == request else { throw CancellationError() }
        try Task.checkCancellation()
        lastMetrics = nil
        lastDraftMetrics = nil
        lastDraftText = nil
        lastFailure = nil
        guard let engine else {
            let error = GemmaRuntimeError.modelUnavailable("Modell nicht geladen")
            lastFailure = String(reflecting: error)
            GemmaRuntimeLoadJournal.record(.engineMissing, backend: lastLoadBackend,
                                           contextTokens: lastLoadContextTokens, engineLoaded: false)
            throw error
        }
        let reviewEnabled = reviewPrompt != nil || reviewPromptBuilder != nil
        let conversation: GemmaNativeConversation
        do {
            // A schema belongs to one fresh selection turn. Applying it to a
            // later free-text review would constrain the wrong response.
            guard responseSchemaJSON == nil || !reviewEnabled else {
                throw GemmaRuntimeError.generation("Ein Ausgabeformat ist nur für einen einzelnen Modellaufruf erlaubt")
            }
            guard thinkingBudget >= 0, thinkingBudget < maxTokens else {
                throw GemmaRuntimeError.generation("Das Denkbudget muss innerhalb des gesamten Ausgabelimits liegen")
            }
            guard thinkingBudget == 0 || !reviewEnabled else {
                throw GemmaRuntimeError.generation("Ein Denkbudget ist nur für einen einzelnen Modellaufruf erlaubt")
            }
            conversation = try GemmaNativeConversation(engine: engine, instructions: instructions,
                prompt: prompt, maxTokens: maxTokens, reviewEnabled: reviewEnabled,
                reviewPrompt: reviewPrompt, additionalReviewTokenReserve: additionalReviewTokenReserve,
                responseSchemaJSON: responseSchemaJSON, thinkingBudget: thinkingBudget)
        } catch {
            lastFailure = String(reflecting: error)
            throw error
        }
        active = conversation
        let task = Task.detached(priority: .userInitiated) {
            do {
                let stream: AsyncThrowingStream<String, Error>
                var review: GemmaReviewInput?
                if reviewEnabled {
                    // Blocking native send completes the hidden draft and its
                    // callback before reusing this conversation's retained KV.
                    let draft = try conversation.sendDraft()
                    let draftMetrics = try conversation.metrics()
                    await self.recordDraft(draft, metrics: draftMetrics, lease: lease)
                    guard draftMetrics.decodeTokens < maxTokens else { throw GemmaRuntimeError.outputLimit }
                    // Pure local evidence validation can reject an invalid
                    // hidden draft before any writer turn or visible output.
                    try validateDraft?(draft)
                    // Source-owned selections can construct a literal follow-up
                    // locally after validating the hidden first answer.
                    let actualReview = try reviewPromptBuilder?(draft) ?? reviewPrompt ?? ""
                    review = try conversation.prepareReview(actualReview)
                    await onReviewStarted?()
                    try conversation.checkActive()
                    stream = conversation.start(messageJSON: review!.messageJSON)
                } else {
                    stream = conversation.start()
                }
                var output = ""
                for try await delta in stream {
                    output += delta
                    await onText(output)
                }
                let metrics = try conversation.metrics(review: review)
                // Native session destruction waits for its execution task.
                // Do it off the callback thread, and await it before releasing
                // the generation gate or loading another model.
                await conversation.close()
                return GemmaGeneratedText(text: output, metrics: metrics)
            } catch {
                await conversation.close()
                throw error
            }
        }
        worker = task
        defer {
            if lease == request { active = nil; worker = nil }
        }
        let result = await withTaskCancellationHandler {
            await task.result
        } onCancel: {
            // Do not cancel the drain task: AsyncThrowingStream would finish its
            // consumer before the native inference thread stops using handles.
            conversation.cancel()
        }
        guard lease == request else { throw CancellationError() }
        try Task.checkCancellation()
        let output: GemmaGeneratedText
        do { output = try result.get() }
        catch {
            lastFailure = String(reflecting: error)
            throw error
        }
        lastMetrics = output.metrics
        if output.metrics.decodeTokens >= maxTokens { throw GemmaRuntimeError.outputLimit }
        return output.text
    }

    private func recordDraft(_ text: String, metrics: GemmaRuntimeMetrics, lease: UInt64) {
        guard request == lease else { return }
        lastDraftText = text
        lastDraftMetrics = metrics
    }

    func cancelAndUnload() async {
        _ = await stopAndUnload()
    }

    private func stopAndUnload() async -> UInt64? {
        request &+= 1
        loadEpoch &+= 1
        let lease = request
        let previous = worker
        let pending = loading
        active?.cancel()
        if let previous { _ = await previous.result }
        let pendingEngine = await pending?.task.result
        guard request == lease else { return nil }
        active = nil
        worker = nil
        loading = nil
        // A stale coalesced load waiter may still retain the task's result.
        // Explicit native close releases memory before allowing the next load.
        if case .success(let loaded) = pendingEngine { loaded.close() }
        engine?.close()
        engine = nil
        return lease
    }
}

private struct GemmaGeneratedText: Sendable {
    let text: String
    let metrics: GemmaRuntimeMetrics
}

struct GemmaRuntimeMetrics: Codable, Sendable {
    let contextTokens: Int
    let renderedInputTokens: Int
    let prefillTokens: Int
    let decodeTokens: Int
    let totalTokens: Int
    /// Native session metric: always the first conversation turn, including
    /// when this struct describes a later review turn. Measure review latency
    /// separately with onReviewStarted and the first final onText callback.
    let timeToFirstToken: Double
    let prefillTokensPerSecond: Double
    let decodeTokensPerSecond: Double
    let retainedTokensBeforeTurn: Int
    let reservedPrefaceTokens: Int
}

private struct GemmaReviewInput: Sendable {
    let messageJSON: String
    let renderedTokens: Int
    let retainedTokens: Int
    let reservedPrefaceTokens: Int
}

private func gemmaNativeError(_ fallback: String) -> String {
    defer { litert_lm_clear_last_error() }
    return litert_lm_get_last_error_message().map { String(cString: $0) } ?? fallback
}

/// The C error belongs to the failing OS thread, not the Swift task. Copy both
/// values before any diagnostic work or suspension, and clear that thread once.
struct GemmaNativeFailure: Sendable {
    let code: Int
    let message: String

    static func capture(_ fallback: String) -> Self {
        let code = Int(litert_lm_get_last_error_code())
        let message = litert_lm_get_last_error_message().map { String(cString: $0) } ?? fallback
        litert_lm_clear_last_error()
        return Self(code: code, message: message)
    }
}

private final class GemmaNativeEngine: @unchecked Sendable {
    let modelURL: URL
    let backend: String
    let handle: OpaquePointer
    let contextTokens: Int
    let verifiedContextTokens: Int?
    private let cacheLease: GemmaRuntimeCacheLease?
    private let closeLock = NSLock()
    private var closed = false

    init(modelURL: URL, backend: String, verifiedContextTokens: Int?) throws {
        self.modelURL = modelURL
        self.backend = backend
        self.verifiedContextTokens = verifiedContextTokens
        guard FileManager.default.fileExists(atPath: modelURL.path) else {
            GemmaRuntimeLoadJournal.record(.modelMissing, backend: backend, contextTokens: verifiedContextTokens, engineLoaded: false)
            throw GemmaRuntimeError.modelUnavailable("Modelldatei fehlt")
        }
        GemmaDiagnosticTrace.record("model-info.start")
        let info: ModelInfo
        do { info = try ModelInfo(throwingModelPath: modelURL.path) }
        catch {
            GemmaRuntimeLoadJournal.record(.modelMetadataFailed, backend: backend, contextTokens: verifiedContextTokens, engineLoaded: false)
            throw GemmaRuntimeError.modelUnavailable("Modellinformationen konnten nicht gelesen werden")
        }
        GemmaDiagnosticTrace.record("model-info.ok")
        let supported = info.maxContextTokens()
        if let verifiedContextTokens, !(1...16_384).contains(verifiedContextTokens) {
            GemmaRuntimeLoadJournal.record(.unknownContext, backend: backend, contextTokens: nil, engineLoaded: false)
            throw GemmaRuntimeError.modelUnavailable("Das geprüfte Kontextbudget liegt außerhalb des unterstützten Bereichs")
        }
        if supported > 0 {
            if info.isDynamicContext() {
                // A validated caller budget is a cap even when metadata permits
                // a larger dynamic allocation. Never silently allocate beyond it.
                contextTokens = min(verifiedContextTokens ?? 16_384, supported, 16_384)
            } else {
                // A fixed tensor layout cannot be shrunk by changing a token
                // setting. Reject an incompatible cap before native creation.
                if let verifiedContextTokens, supported > verifiedContextTokens {
                    GemmaRuntimeLoadJournal.record(.unknownContext, backend: backend,
                                                   contextTokens: supported, engineLoaded: false)
                    throw GemmaRuntimeError.modelUnavailable("Die feste Kontextgröße des Modells überschreitet das geprüfte Budget")
                }
                contextTokens = supported
            }
        } else if let verifiedContextTokens {
            // Older official artifacts omit this metadata. Only the caller
            // that validated a pinned model may supply its documented budget.
            contextTokens = verifiedContextTokens
        } else {
            GemmaRuntimeLoadJournal.record(.unknownContext, backend: backend, contextTokens: verifiedContextTokens, engineLoaded: false)
            throw GemmaRuntimeError.modelUnavailable("Kontextgröße unbekannt")
        }
        guard let settings = litert_lm_engine_settings_create(modelURL.path, backend, nil, nil) else {
            let failure = GemmaNativeFailure.capture("Engine-Einstellungen fehlen")
            GemmaRuntimeLoadJournal.record(.nativeSettingsFailed, backend: backend, contextTokens: contextTokens,
                                           engineLoaded: false, nativeStatusCode: failure.code)
            GemmaDiagnosticTrace.recordNativeFailure(code: failure.code, message: failure.message, stage: "engine.settings")
            throw GemmaRuntimeError.modelUnavailable(failure.message)
        }
        defer { litert_lm_engine_settings_delete(settings) }
        litert_lm_engine_settings_set_max_num_tokens(settings, Int32(contextTokens))
        litert_lm_engine_settings_enable_benchmark(settings)
        // Upstream issues #2814 / #3913 document FP16 Metal corruption for
        // Gemma 4 at longer contexts. Use FP32 with an independent cache.
        if backend == "gpu" {
            litert_lm_engine_settings_set_activation_data_type(settings, kLiteRtLmActivationDataTypeFloat32)
        } else if backend == "cpu" {
            // Keep dynamic CPU prefills bounded so long sources use less peak
            // memory and cancellation can stop between smaller native chunks.
            litert_lm_engine_settings_set_prefill_chunk_size(settings, 256)
        }
        // A warm XNNPACK cache maps its entire ~2.2 GB file at once. On Apple,
        // building the same file in a fresh directory instead retains smaller
        // build-step mappings (measured largest: ~171 MB). Every new CPU engine
        // therefore owns a fresh file cache; it is not the heap-only :nocache
        // mode. Keep the directory alive until native engine teardown finishes.
        let lease: GemmaRuntimeCacheLease?
        let cache: URL
        do {
            if backend == "cpu" {
                let acquired = try GemmaRuntimeCacheLease.acquire()
                lease = acquired
                cache = acquired.directory
            } else {
                lease = nil
                cache = modelURL.deletingLastPathComponent()
                    .appendingPathComponent("RuntimeCache-v018-f32-" + backend, isDirectory: true)
                try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
            }
        }
        catch {
            GemmaRuntimeLoadJournal.record(.cacheUnavailable, backend: backend, contextTokens: contextTokens, engineLoaded: false)
            throw GemmaRuntimeError.modelUnavailable("Der lokale Modellcache konnte nicht geöffnet werden")
        }
        var cacheTransferred = false
        defer { if !cacheTransferred { lease?.close() } }
        litert_lm_engine_settings_set_cache_dir(settings, cache.path)
        GemmaDiagnosticTrace.record("engine.create.start")
        guard let handle = litert_lm_engine_create(settings) else {
            let failure = GemmaNativeFailure.capture("Engine konnte nicht geladen werden")
            GemmaRuntimeLoadJournal.record(.nativeCreateFailed, backend: backend, contextTokens: contextTokens,
                                           engineLoaded: false, nativeStatusCode: failure.code)
            GemmaDiagnosticTrace.recordNativeFailure(code: failure.code, message: failure.message, stage: "engine.create")
            throw GemmaRuntimeError.modelUnavailable(failure.message)
        }
        self.handle = handle
        self.cacheLease = lease
        cacheTransferred = true
        GemmaDiagnosticTrace.record("engine.create.ok")
    }
    deinit { close() }

    func close() {
        closeLock.lock()
        defer { closeLock.unlock() }
        guard !closed else { return }
        closed = true
        litert_lm_engine_delete(handle)
        cacheLease?.close()
    }

    func countTokens(_ text: String) throws -> Int {
        GemmaDiagnosticTrace.record("tokenize.start")
        guard let result = litert_lm_engine_tokenize(handle, text) else {
            throw GemmaRuntimeError.generation(gemmaNativeError("Tokenzählung fehlgeschlagen"))
        }
        defer { litert_lm_tokenize_result_delete(result) }
        GemmaDiagnosticTrace.record("tokenize.ok")
        return Int(litert_lm_tokenize_result_get_num_tokens(result))
    }
}

private final class GemmaNativeConversation: @unchecked Sendable {
    let engine: GemmaNativeEngine
    let handle: OpaquePointer
    let promptJSON: String
    let maxTokens: Int
    let inputTokens: Int
    let responseSchemaJSON: String?
    private let stateLock = NSLock()
    private var cancelled = false
    private var closed = false
    private var blockingDraft = false
    private var cancellationRetryScheduled = false

    init(engine: GemmaNativeEngine, instructions: String, prompt: String, maxTokens: Int,
         reviewEnabled: Bool = false, reviewPrompt: String? = nil,
         additionalReviewTokenReserve: Int = 0, responseSchemaJSON: String? = nil,
         thinkingBudget: Int = 0) throws {
        self.engine = engine
        self.maxTokens = maxTokens
        self.responseSchemaJSON = responseSchemaJSON
        GemmaDiagnosticTrace.record("conversation.config.start")
        // LiteRT counts thought, closing delimiters and final response within
        // maxTokens. The same total is reserved by the context check below.
        guard thinkingBudget >= 0, thinkingBudget < maxTokens else {
            throw GemmaRuntimeError.generation("Das Denkbudget muss innerhalb des gesamten Ausgabelimits liegen")
        }
        guard !reviewEnabled || (thinkingBudget == 0 && responseSchemaJSON == nil) else {
            throw GemmaRuntimeError.generation("Ausgabeformat und Denkbudget benötigen einen einzelnen Modellaufruf")
        }
        promptJSON = try Self.json(["role": "user", "content": [["type": "text", "text": prompt]]])
        guard maxTokens > 0, maxTokens < engine.contextTokens,
              additionalReviewTokenReserve >= 0, additionalReviewTokenReserve <= engine.contextTokens,
              let session = litert_lm_session_config_create(),
              let config = litert_lm_conversation_config_create(),
              let sampler = litert_lm_sampler_params_create(kLiteRtLmSamplerTypeTopP),
              let thinking = litert_lm_thinking_config_create() else {
            throw GemmaRuntimeError.generation(gemmaNativeError("Konfiguration konnte nicht erstellt werden"))
        }
        defer {
            litert_lm_session_config_delete(session)
            litert_lm_conversation_config_delete(config)
            litert_lm_sampler_params_delete(sampler)
            litert_lm_thinking_config_delete(thinking)
        }
        // The GPU backend ignores the sampler enum. An explicit k=1 is
        // required for greedy output; leaving the C API default k=0 asks the
        // GPU sampler to build an unnecessarily huge vocabulary softmax.
        litert_lm_sampler_params_set_top_k(sampler, 1)
        litert_lm_sampler_params_set_top_p(sampler, 1)
        // k=1 already guarantees the argmax. Keep temperature positive so
        // GPU softmax never divides logits by zero.
        litert_lm_sampler_params_set_temperature(sampler, 1)
        litert_lm_session_config_set_sampler_params(session, sampler)
        litert_lm_conversation_config_set_session_config(config, session)
        let system = try Self.json([["type": "text", "text": instructions]])
        litert_lm_conversation_config_set_system_message(config, system)
        litert_lm_thinking_config_set_enable_thinking(thinking, thinkingBudget > 0)
        litert_lm_thinking_config_set_thinking_token_budget(thinking, Int32(thinkingBudget))
        litert_lm_conversation_config_set_thinking_config(config, thinking)
        // In LiteRT 0.18 this flag enables Gemma's internal tool-call FST,
        // whose vocabulary construction can abort during conversation_create.
        // Explicit request schemas use the separate LlGuidance provider below
        // and OptionalArgs.decoding_constraint; they do not need the tool FST.
        litert_lm_conversation_config_set_enable_constrained_decoding(config, false)
        if responseSchemaJSON != nil {
            // Match the official 0.18 Swift response-format setup. Request
            // constraints are ignored by native code without this provider.
            var provider = kLiteRtLmConstraintProviderTypeLlGuidance
            litert_lm_conversation_config_set_constraint_provider(config, &provider)
            GemmaDiagnosticTrace.record("conversation.constraint.enabled")
        }
        GemmaDiagnosticTrace.record("conversation.create.start")
        guard let handle = litert_lm_conversation_create(engine.handle, config) else {
            throw GemmaRuntimeError.generation(gemmaNativeError("Konversation konnte nicht erstellt werden"))
        }
        GemmaDiagnosticTrace.record("conversation.create.ok")
        do {
            GemmaDiagnosticTrace.record("render.preface.start")
            guard let preface = litert_lm_conversation_render_preface_to_string(handle) else {
                throw GemmaRuntimeError.generation(gemmaNativeError("Systemtext konnte nicht formatiert werden"))
            }
            let renderedPreface = String(cString: preface)
            GemmaDiagnosticTrace.record("render.preface.ok")
            GemmaDiagnosticTrace.record("render.message.start")
            guard let message = litert_lm_conversation_render_message_to_string(handle, promptJSON) else {
                throw GemmaRuntimeError.generation(gemmaNativeError("Quelle konnte nicht formatiert werden"))
            }
            GemmaDiagnosticTrace.record("render.message.ok")
            inputTokens = try engine.countTokens(renderedPreface + String(cString: message))
            let available: Int
            if reviewEnabled {
                let reviewJSON = try Self.json(["role": "user", "content": [["type": "text", "text": reviewPrompt ?? ""]]])
                guard let review = litert_lm_conversation_render_message_to_string(handle, reviewJSON) else {
                    throw GemmaRuntimeError.generation(gemmaNativeError("Prüfanweisung konnte nicht formatiert werden"))
                }
                let reviewTokens = try engine.countTokens(String(cString: review))
                // Reserve both complete outputs and the short follow-up before
                // doing expensive source prefill. Recheck actual retained KV
                // after the draft because native template boundaries may vary.
                available = engine.contextTokens - 2 * maxTokens - reviewTokens - additionalReviewTokenReserve - 64
            } else {
                available = engine.contextTokens - maxTokens - 32
            }
            guard inputTokens <= available else {
                throw GemmaRuntimeError.contextTooLarge(input: inputTokens, available: available)
            }
        } catch {
            litert_lm_conversation_delete(handle)
            throw error
        }
        // Assign the owned handle only after all throwing validation. This
        // keeps a failing fully initialized instance from deleting it twice.
        self.handle = handle
    }

    deinit {
        if !closed {
            // Defensive fallback only. Normal generations await close().
            let nativeHandle = handle
            let owner = engine
            DispatchQueue.global(qos: .utility).async {
                litert_lm_conversation_delete(nativeHandle)
                withExtendedLifetime(owner) {}
            }
        }
    }

    func close() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async { [self] in
                stateLock.lock()
                let shouldClose = !closed
                closed = true
                stateLock.unlock()
                if shouldClose { litert_lm_conversation_delete(handle) }
                continuation.resume()
            }
        }
    }

    func cancel() {
        stateLock.lock()
        cancelled = true
        let notifyNative = !closed
        let needsRetry = blockingDraft && !closed && !cancellationRetryScheduled
        if needsRetry { cancellationRetryScheduled = true }
        stateLock.unlock()
        if notifyNative {
            // Native cancellation may wait for a running GPU prefill. A Task
            // cancellation handler can run on the UI caller's thread, so keep
            // the native call off that thread while the worker still drains.
            DispatchQueue.global(qos: .utility).async { [weak self] in
                guard let self else { return }
                self.stateLock.lock()
                if !self.closed { litert_lm_conversation_cancel_process(self.handle) }
                self.stateLock.unlock()
            }
        }
        if needsRetry { scheduleBlockingCancellationRetry() }
    }

    private func scheduleBlockingCancellationRetry() {
        // A cancellation can race the small gap before the blocking C send
        // registers native work. Retry briefly until that call has returned.
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + .milliseconds(50)) { [weak self] in
            guard let self else { return }
            self.stateLock.lock()
            let retry = self.cancelled && self.blockingDraft && !self.closed
            if retry { litert_lm_conversation_cancel_process(self.handle) }
            else { self.cancellationRetryScheduled = false }
            self.stateLock.unlock()
            if retry { self.scheduleBlockingCancellationRetry() }
        }
    }

    func checkActive() throws {
        stateLock.lock()
        let unavailable = cancelled || closed
        stateLock.unlock()
        if unavailable { throw CancellationError() }
    }

    func sendDraft() throws -> String {
        stateLock.lock()
        guard !cancelled, !closed else { stateLock.unlock(); throw CancellationError() }
        blockingDraft = true
        stateLock.unlock()
        defer {
            stateLock.lock()
            blockingDraft = false
            stateLock.unlock()
        }
        guard let args = litert_lm_conversation_optional_args_create() else {
            throw GemmaRuntimeError.generation("Ausgabeoptionen fehlen")
        }
        defer { litert_lm_conversation_optional_args_delete(args) }
        litert_lm_conversation_optional_args_set_max_output_tokens(args, Int32(maxTokens))
        if let responseSchemaJSON {
            litert_lm_conversation_optional_args_set_constraint(args, kLiteRtLmConstraintTypeJsonSchema, responseSchemaJSON)
        }
        guard let response = litert_lm_conversation_send_message(handle, promptJSON, nil, args) else {
            try checkActive()
            throw GemmaRuntimeError.generation(gemmaNativeError("Entwurf konnte nicht erstellt werden"))
        }
        defer { litert_lm_json_response_delete(response) }
        try checkActive()
        guard let json = litert_lm_json_response_get_string(response) else {
            throw GemmaRuntimeError.generation(gemmaNativeError("Entwurf konnte nicht gelesen werden"))
        }
        return try Conversation.jsonToMessage(String(cString: json)).toString
    }

    func prepareReview(_ prompt: String) throws -> GemmaReviewInput {
        try checkActive()
        let retained = Int(litert_lm_conversation_get_token_count(handle))
        guard retained >= 0 else { throw GemmaRuntimeError.generation(gemmaNativeError("Kontext konnte nicht geprüft werden")) }
        let json = try Self.json(["role": "user", "content": [["type": "text", "text": prompt]]])
        guard let rendered = litert_lm_conversation_render_message_to_string(handle, json) else {
            throw GemmaRuntimeError.generation(gemmaNativeError("Prüfanweisung konnte nicht formatiert werden"))
        }
        let tokens = try engine.countTokens(String(cString: rendered))
        guard let preface = litert_lm_conversation_render_preface_to_string(handle) else {
            throw GemmaRuntimeError.generation(gemmaNativeError("Systemtext konnte nicht geprüft werden"))
        }
        // The retained count already contains the prior source and draft.
        // Reserve the small preface again to conservatively cover boundaries;
        // it is not sent or prefilled a second time.
        let prefaceReserve = try engine.countTokens(String(cString: preface))
        let available = engine.contextTokens - maxTokens - 32
        let required = retained + tokens + prefaceReserve
        guard required <= available else {
            throw GemmaRuntimeError.contextTooLarge(input: required, available: available)
        }
        return .init(messageJSON: json, renderedTokens: tokens, retainedTokens: retained,
                     reservedPrefaceTokens: prefaceReserve)
    }

    func start(messageJSON: String? = nil) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            stateLock.lock()
            defer { stateLock.unlock() }
            guard !cancelled, !closed else { continuation.finish(throwing: CancellationError()); return }
            guard let args = litert_lm_conversation_optional_args_create() else {
                continuation.finish(throwing: GemmaRuntimeError.generation("Ausgabeoptionen fehlen")); return
            }
            defer { litert_lm_conversation_optional_args_delete(args) }
            litert_lm_conversation_optional_args_set_max_output_tokens(args, Int32(maxTokens))
            if let responseSchemaJSON {
                litert_lm_conversation_optional_args_set_constraint(args, kLiteRtLmConstraintTypeJsonSchema, responseSchemaJSON)
                GemmaDiagnosticTrace.record("stream.constraint.set")
            }
            let context = GemmaStreamContext(conversation: self, continuation: continuation)
            let pointer = Unmanaged.passRetained(context).toOpaque()
            GemmaDiagnosticTrace.record("stream.start")
            let status = litert_lm_conversation_send_message_stream(handle, messageJSON ?? promptJSON, nil, args,
                                                                  gemmaStreamCallback, pointer)
            if status != 0 {
                let error = GemmaRuntimeError.generation(gemmaNativeError("Generierung konnte nicht starten"))
                GemmaDiagnosticTrace.record("stream.start.failed")
                Unmanaged<GemmaStreamContext>.fromOpaque(pointer).release()
                continuation.finish(throwing: error)
            } else {
                GemmaDiagnosticTrace.record("stream.accepted")
            }
        }
    }

    func metrics(review: GemmaReviewInput? = nil) throws -> GemmaRuntimeMetrics {
        GemmaDiagnosticTrace.record("metrics.start")
        guard let info = litert_lm_conversation_get_benchmark_info(handle) else {
            throw GemmaRuntimeError.generation(gemmaNativeError("Die Vollständigkeit der Ausgabe konnte nicht geprüft werden"))
        }
        defer { litert_lm_benchmark_info_delete(info) }
        let prefill = litert_lm_benchmark_info_get_num_prefill_turns(info) - 1
        let decode = litert_lm_benchmark_info_get_num_decode_turns(info) - 1
        guard prefill >= 0, decode >= 0 else {
            throw GemmaRuntimeError.generation("Die Ausgabe hatte keinen vollständigen Generierungsdurchlauf")
        }
        GemmaDiagnosticTrace.record("metrics.ok")
        return .init(contextTokens: engine.contextTokens, renderedInputTokens: review?.renderedTokens ?? inputTokens,
                     prefillTokens: prefill >= 0 ? Int(litert_lm_benchmark_info_get_prefill_token_count_at(info, prefill)) : 0,
                     decodeTokens: decode >= 0 ? Int(litert_lm_benchmark_info_get_decode_token_count_at(info, decode)) : 0,
                     totalTokens: Int(litert_lm_conversation_get_token_count(handle)),
                     timeToFirstToken: litert_lm_benchmark_info_get_time_to_first_token(info),
                     prefillTokensPerSecond: prefill >= 0 ? litert_lm_benchmark_info_get_prefill_tokens_per_sec_at(info, prefill) : 0,
                     decodeTokensPerSecond: decode >= 0 ? litert_lm_benchmark_info_get_decode_tokens_per_sec_at(info, decode) : 0,
                     retainedTokensBeforeTurn: review?.retainedTokens ?? 0,
                     reservedPrefaceTokens: review?.reservedPrefaceTokens ?? 0)
    }

    private static func json(_ object: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
    }
}

private final class GemmaStreamContext {
    // Own both handles until the callback's final/error chunk has returned.
    let conversation: GemmaNativeConversation
    let continuation: AsyncThrowingStream<String, Error>.Continuation
    var pendingError: Error?
    var sawThoughtChannel = false
    init(conversation: GemmaNativeConversation, continuation: AsyncThrowingStream<String, Error>.Continuation) {
        self.conversation = conversation
        self.continuation = continuation
    }
}

private func gemmaStreamCallback(_ userData: UnsafeMutableRawPointer?, _ chunk: OpaquePointer?) {
    guard let userData else { return }
    let retained = Unmanaged<GemmaStreamContext>.fromOpaque(userData)
    let context = retained.takeUnretainedValue()
    if let error = litert_lm_stream_chunk_get_error(chunk) {
        let failure = GemmaRuntimeError.generation(String(cString: error))
        GemmaDiagnosticTrace.record("callback.error")
        context.continuation.finish(throwing: failure)
        retained.release()
        return
    }
    if let text = litert_lm_stream_chunk_get_text(chunk) {
        do {
            let message = try Conversation.jsonToMessage(String(cString: text))
            if !context.sawThoughtChannel, let thought = message.channels["thought"], !thought.isEmpty {
                context.sawThoughtChannel = true
                // Record only channel activity, never its private text.
                GemmaDiagnosticTrace.record("callback.thought.filtered")
            }
            if !message.toString.isEmpty { context.continuation.yield(message.toString) }
        } catch {
            // Defer the error to the terminal callback; the native thread still
            // owns this context until then, even if a single chunk is invalid.
            context.pendingError = error
        }
    }
    if litert_lm_stream_chunk_is_final(chunk) {
        GemmaDiagnosticTrace.record("callback.final")
        if let error = context.pendingError { context.continuation.finish(throwing: error) }
        else { context.continuation.finish() }
        retained.release()
    }
}
