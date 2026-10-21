import Foundation
import CryptoKit
#if os(iOS) && !targetEnvironment(simulator) && !targetEnvironment(macCatalyst)
import UIKit
import os
import Darwin
#endif

/// The command-line marker and environment opt-in must both be explicit.
/// Keeping this pure lets the app and the diagnostic runner share one gate.
enum GemmaDiagnosticRequest {
    static func isRequested(arguments: [String] = ProcessInfo.processInfo.arguments,
                            environment: [String: String] = ProcessInfo.processInfo.environment) -> Bool {
        arguments.contains("--langform-gemma-diagnostic") && environment["LANGFORM_GEMMA_PROBE"] == "1"
    }
}

/// This opt-in keeps LangformRoot and its real WebViews. It never selects the
/// isolated GemmaDiagnosticView, even if incompatible launch markers are mixed.
enum GemmaSummaryHostProbeRequest {
    static func isRequested(arguments: [String] = ProcessInfo.processInfo.arguments,
                            environment: [String: String] = ProcessInfo.processInfo.environment) -> Bool {
        arguments.contains("--langform-summary-host-probe")
            && environment["LANGFORM_SUMMARY_HOST_PROBE"] == "1"
            && !GemmaDiagnosticRequest.isRequested(arguments: arguments, environment: environment)
    }
}

/// Isolated, explicitly invoked Google-provider measurement. This probe is
/// disconnected from the normal application UI and summary button.
@MainActor enum GemmaDeviceProbe {
    private static var started = false

    static func runExplicitDiagnostic() async {
        #if os(iOS) && !targetEnvironment(simulator) && !targetEnvironment(macCatalyst)
        guard !started, GemmaDiagnosticRequest.isRequested() else { return }
        started = true
        await run(mode: ProcessInfo.processInfo.environment["LANGFORM_GEMMA_PROBE_MODE"] ?? "smoke")
        #endif
    }

    /// Historical call sites still require the explicit command-line opt-in.
    static func runIfRequested() async {
        await runExplicitDiagnostic()
    }

    #if os(iOS) && !targetEnvironment(simulator) && !targetEnvironment(macCatalyst)
    private enum Mode: String {
        case smoke, summary
        case publicSummary = "public"
    }
    private static let maximumSourceBytes = 150_000
    private static let smokePrompt = "Antworte nur mit OK."
    private static var directory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("GemmaProbe", isDirectory: true)
    }

    private static func run(mode rawMode: String) async {
        let run = Measurement(directory: directory, mode: rawMode)
        run.persist()
        do {
            // Each explicit process run owns a fresh trace. Reports and prior
            // traces are archived by the runner before the next launch.
            run.stage("preparingTrace")
            for name in ["runtime-trace.jsonl", "native-failure.json"] {
                let previous = directory.appendingPathComponent(name)
                if FileManager.default.fileExists(atPath: previous.path) {
                    try FileManager.default.removeItem(at: previous)
                }
            }
            guard let mode = Mode(rawValue: rawMode) else {
                throw ProbeFailure(code: "PROBE_MODE_INVALID", message: "LANGFORM_GEMMA_PROBE_MODE muss smoke, summary oder public sein.")
            }
            // Only the explicit diagnostic waits here. No WebView or ordinary
            // provider work is needed to establish native engine viability.
            run.stage("waitingForActive")
            let activeDeadline = ProcessInfo.processInfo.systemUptime + 10
            while UIApplication.shared.applicationState != .active {
                try Task.checkCancellation()
                guard ProcessInfo.processInfo.systemUptime < activeDeadline else {
                    throw ProbeFailure(code: "PROBE_APP_INACTIVE", message: "Langform wurde nicht aktiv.")
                }
                try await Task.sleep(nanoseconds: 50_000_000)
            }
            try Task.checkCancellation()
            let source: String?
            switch mode {
            case .smoke:
                source = nil
                run.report["inputBytes"] = smokePrompt.utf8.count
                run.report["inputSHA256"] = digest(Data(smokePrompt.utf8))
                run.report["prompt"] = smokePrompt
                run.report["maxOutputTokens"] = 16
                run.report["providerRoute"] = "directGemmaRuntime"
                run.report["sourceFileRequired"] = false
            case .summary, .publicSummary:
                run.stage("readingSource")
                let loaded = try readSource()
                source = loaded.source
                run.report["inputBytes"] = loaded.data.count
                run.report["inputSHA256"] = digest(loaded.data)
                run.report["preparedInputSHA256"] = digest(Data(OnDeviceSummary.prepare(loaded.source).utf8))
                run.report["providerRoute"] = mode == .publicSummary ? "OnDeviceSummary.reply" : "GemmaSummary.reply"
                run.report["sourceFileRequired"] = true
            }
            guard UIApplication.shared.applicationState == .active else {
                throw ProbeFailure(code: "PROBE_APP_INACTIVE", message: "Langform ist vor dem Modellaufruf inaktiv geworden.")
            }
            let awake = SummaryIdleTimer.begin()
            defer { SummaryIdleTimer.end(awake) }
            let observer = NotificationCenter.default.addObserver(
                forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
            ) { _ in
                Task { @MainActor in
                    run.interrupted = true
                    run.report["status"] = "cancelled"
                    run.report["complete"] = false
                    run.report["failureCode"] = "PROBE_APP_BACKGROUNDED"
                    run.captureMemory(label: "interrupted")
                    await run.captureRuntimeState()
                    run.persist()
                    #if canImport(LiteRTLM)
                    await GemmaRuntime.shared.cancelAndUnload()
                    #endif
                }
            }
            defer { NotificationCenter.default.removeObserver(observer) }
            run.startUptime = ProcessInfo.processInfo.systemUptime
            run.report["status"] = "running"
            run.captureMemory(label: "beforeModelVerification")
            run.persist()
            let memoryTask = Task { @MainActor in
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                    guard !Task.isCancelled else { break }
                    run.captureMemory(label: "sampling")
                    await run.captureRuntimeState()
                    run.persist()
                }
            }
            defer { memoryTask.cancel() }
            // Full size/SHA/receipt validation and the strict CPU/8K contract
            // stay identical for all diagnostic modes.
            guard GemmaModelStore.runtimeBackend == "cpu", GemmaModelStore.verifiedContextTokens == 8_192 else {
                throw ProbeFailure(code: "PROBE_RUNTIME_CONTRACT", message: "Die Diagnose benötigt CPU und das geprüfte 8K-Kontextbudget.")
            }
            run.stage("validatingModel")
            let modelURL = try await GemmaModelStore.shared.validatedURL()
            run.report["modelFileVerified"] = true
            run.captureMemory(label: "modelVerified")
            run.persist()
            switch mode {
            case .smoke:
                #if canImport(LiteRTLM)
                run.stage("loadingRuntime")
                try await GemmaRuntime.shared.load(modelURL: modelURL,
                                                   backend: GemmaModelStore.runtimeBackend,
                                                   verifiedContextTokens: GemmaModelStore.verifiedContextTokens)
                run.report["runtimeLoadSucceeded"] = true
                await run.captureRuntimeState()
                run.captureMemory(label: "runtimeLoaded")
                run.persist()
                try Task.checkCancellation()
                guard !run.interrupted, UIApplication.shared.applicationState == .active else {
                    throw ProbeFailure(code: "PROBE_APP_BACKGROUNDED", message: "Langform wurde vor dem Modelltest inaktiv.")
                }
                run.stage("generatingSmoke")
                let output = try await GemmaRuntime.shared.generate(
                    instructions: "Antworte knapp und genau. Gib ausschließlich die angeforderte Antwort aus.",
                    prompt: smokePrompt, maxTokens: 16
                ) { _ in }
                run.report["result"] = ["text": output]
                run.report["smokeResponseMatchesExpected"] = output.trimmingCharacters(in: .whitespacesAndNewlines) == "OK"
                guard !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    throw ProbeFailure(code: "PROBE_EMPTY_OUTPUT", message: "Die Laufzeit hat keine Antwort erzeugt.")
                }
                // Completion proves a native generation, never summary quality.
                run.report["status"] = "completed"
                run.report["complete"] = true
                #else
                _ = modelURL
                throw ProbeFailure(code: "PROBE_RUNTIME_UNAVAILABLE", message: "Die Gemma-Laufzeit ist nicht eingebunden.")
                #endif
            case .summary:
                guard let source else {
                    throw ProbeFailure(code: "PROBE_INPUT_MISSING", message: "source.txt fehlt.")
                }
                run.stage("generatingSummary")
                let preparedSource = OnDeviceSummary.prepare(source)
                let result = await GemmaSummary.reply(source: preparedSource, sourceIncomplete: false,
                                                      cache: SummaryReuseCache(), onProgress: { progress in
                    run.record(progress)
                }, onSelection: { selection in
                    // This is the actual first conversation result. Persist it
                    // before the fresh writer clears the runtime's last metrics.
                    run.report["selectionCallbackReceived"] = true
                    run.report["evidencePlan"] = selection
                    do {
                        _ = try GemmaEvidence.validate(selection, in: preparedSource)
                        run.report["sourceSelectionVerified"] = true
                    } catch {
                        run.report["sourceSelectionVerified"] = false
                        run.report["sourceSelectionVerificationError"] = String(reflecting: error)
                    }
                    #if canImport(LiteRTLM)
                    if let metrics = await GemmaRuntime.shared.lastMetrics,
                       let data = try? JSONEncoder().encode(metrics),
                       let value = try? JSONSerialization.jsonObject(with: data) {
                        run.report["nativeEvidenceMetrics"] = value
                    }
                    #endif
                    run.captureMemory(label: "selectionCompleted")
                    run.persist()
                }, onWritten: { output in
                    // Raw fixture output is retained only in the explicitly
                    // requested diagnostic, including a rejected document.
                    run.report["writerOutput"] = output
                    var attempts = run.report["writerAttempts"] as? [[String: Any]] ?? []
                    var attempt: [String: Any] = ["index": attempts.count + 1, "raw": output,
                        "elapsedSeconds": ProcessInfo.processInfo.systemUptime - run.startUptime]
                    #if canImport(LiteRTLM)
                    if let metrics = await GemmaRuntime.shared.lastMetrics,
                       let data = try? JSONEncoder().encode(metrics),
                       let value = try? JSONSerialization.jsonObject(with: data) {
                        attempt["nativeMetrics"] = value
                    }
                    #endif
                    attempts.append(attempt)
                    run.report["writerAttempts"] = attempts
                    run.report["writerAttemptCount"] = attempts.count
                    run.persist()
                }, onAppRepair: { document in
                    // App selection is never mislabeled as a native writer.
                    var documents = run.report["appRepairedDocuments"] as? [String] ?? []
                    documents.append(document)
                    run.report["appRepairedDocuments"] = documents
                    run.report["appRepairCount"] = documents.count
                    run.persist()
                })
                run.report["result"] = result
                if result["code"] != nil || !OnDeviceSummary.reusableResult(result) {
                    run.report["status"] = "failed"
                    run.report["complete"] = false
                    run.report["failureCode"] = result["code"] as? String ?? "PROBE_INCOMPLETE_RESULT"
                } else {
                    run.report["status"] = "completed"
                    run.report["complete"] = true
                }
            case .publicSummary:
                guard let source else {
                    throw ProbeFailure(code: "PROBE_INPUT_MISSING", message: "source.txt fehlt.")
                }
                run.stage("generatingPublicSummary")
                // Exercise the same native entry as the public summary route,
                // with a new reuse cache. This does not exercise caption fetch
                // or a physical tap on the ordinary summary button.
                let result = await OnDeviceSummary.reply(for: source, cache: SummaryReuseCache(), onProgress: { progress in
                    run.record(progress)
                })
                run.report["result"] = result
                let actualModel = (result["summary"] as? [String: Any])?["model"] as? String
                run.report["expectedProviderModel"] = GemmaModelStore.modelName
                run.report["actualProviderModel"] = actualModel ?? ""
                run.report["publicProviderVerified"] = actualModel == GemmaModelStore.modelName
                if result["code"] != nil || !OnDeviceSummary.reusableResult(result) {
                    run.report["status"] = "failed"
                    run.report["complete"] = false
                    run.report["failureCode"] = result["code"] as? String ?? "PROBE_INCOMPLETE_RESULT"
                } else if actualModel != GemmaModelStore.modelName {
                    throw ProbeFailure(code: "PROBE_PROVIDER_MISMATCH",
                        message: "Der öffentliche Kurzfassungseinstieg hat nicht das erwartete Google-Modell verwendet.")
                } else {
                    run.report["status"] = "completed"
                    run.report["complete"] = true
                }
            }
            run.captureMemory(label: "afterInference")
            if run.interrupted || UIApplication.shared.applicationState != .active {
                run.report["status"] = "cancelled"
                run.report["complete"] = false
                run.report["failureCode"] = "PROBE_APP_BACKGROUNDED"
            } else if Task.isCancelled || (run.report["result"] as? [String: Any])?["code"] as? String == "CANCELLED" {
                run.report["status"] = "cancelled"
                run.report["complete"] = false
                run.report["failureCode"] = "PROBE_TASK_CANCELLED"
            }
        } catch is CancellationError {
            run.report["status"] = "cancelled"
            run.report["complete"] = false
            run.report["failureCode"] = "PROBE_TASK_CANCELLED"
        } catch let failure as ProbeFailure {
            run.report["status"] = "failed"
            run.report["complete"] = false
            run.report["failureCode"] = failure.code
            run.report["failureMessage"] = failure.message
            run.recordTechnicalFailure(failure)
        } catch {
            run.report["status"] = "failed"
            run.report["complete"] = false
            #if canImport(LiteRTLM)
            run.report["failureCode"] = error is GemmaRuntimeError ? "PROBE_RUNTIME_ERROR" : "PROBE_IO_ERROR"
            #else
            run.report["failureCode"] = "PROBE_IO_ERROR"
            #endif
            run.recordTechnicalFailure(error)
        }
        await run.captureRuntimeState()
        if run.interrupted {
            run.report["status"] = "cancelled"
            run.report["complete"] = false
            run.report["failureCode"] = "PROBE_APP_BACKGROUNDED"
        }
        if run.report["complete"] as? Bool != true, run.report["failureStage"] == nil {
            run.report["failureStage"] = run.report["stage"] ?? "preparing"
        }
        run.report["elapsedSeconds"] = max(0, ProcessInfo.processInfo.systemUptime - run.startUptime)
        run.report["finishedAt"] = ISO8601DateFormatter().string(from: Date())
        run.captureMemory(label: "terminal")
        run.persist()
        #if canImport(LiteRTLM)
        await GemmaRuntime.shared.cancelAndUnload()
        #endif
    }

    private static func readSource() throws -> (source: String, data: Data) {
        let sourceURL = directory.appendingPathComponent("source.txt")
        guard FileManager.default.fileExists(atPath: sourceURL.path) else {
            throw ProbeFailure(code: "PROBE_INPUT_MISSING", message: "source.txt fehlt.")
        }
        let attributes = try FileManager.default.attributesOfItem(atPath: sourceURL.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              let size = attributes[.size] as? NSNumber,
              size.int64Value > 0, size.int64Value <= maximumSourceBytes else {
            throw ProbeFailure(code: "PROBE_INPUT_SIZE", message: "Die Quelle muss 1 bis 150.000 Bytes enthalten.")
        }
        let handle = try FileHandle(forReadingFrom: sourceURL)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: maximumSourceBytes + 1) ?? Data()
        guard !data.isEmpty, data.count <= maximumSourceBytes else {
            throw ProbeFailure(code: "PROBE_INPUT_SIZE", message: "Die Quelle ist leer oder zu groß.")
        }
        guard let source = String(data: data, encoding: .utf8),
              !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ProbeFailure(code: "PROBE_INPUT_UTF8", message: "Die Quelle benötigt gültigen, nicht leeren UTF-8-Text.")
        }
        return (source, data)
    }

    private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private struct ProbeFailure: Error, LocalizedError {
        let code: String
        let message: String
        var errorDescription: String? { message }
    }

    @MainActor private final class Measurement {
        let directory: URL
        var startUptime = ProcessInfo.processInfo.systemUptime
        var interrupted = false
        var progress: [[String: Any]] = []
        var memory: [[String: Any]] = []
        var report: [String: Any] = [
            "schemaVersion": 3,
            "summaryPolicy": GemmaSummaryPolicy.version,
            "summaryRuntimeIdentity": GemmaSummaryPolicy.runtimeIdentity,
            "selectionOutputTokenLimit": GemmaSummaryPolicy.selectionTokenLimit,
            "selectionThinkingTokenBudget": GemmaSummaryPolicy.selectionThinkingTokens,
            "writerOutputTokenLimit": GemmaSummaryPolicy.writerTokenLimit,
            "writerThinkingTokenBudget": GemmaSummaryPolicy.writerThinkingTokens,
            "correctionOutputTokenLimit": GemmaSummaryPolicy.correctionTokenLimit,
            "maximumWriterAttempts": 2,
            "runtimeBackend": GemmaModelStore.runtimeBackend,
            "verifiedContextTokens": GemmaModelStore.verifiedContextTokens ?? 0,
            "prefillChunkTokens": 256,
            "runtimeTraceFile": "runtime-trace.jsonl",
            "runID": UUID().uuidString,
            "processID": ProcessInfo.processInfo.processIdentifier,
            "startedAt": ISO8601DateFormatter().string(from: Date()),
            "model": GemmaModelStore.modelName,
            "providerIdentity": GemmaModelStore.providerIdentity,
            "sourceIncomplete": false,
            "physicalDevice": true,
            "semanticAcceptance": false,
            "complete": false,
            "status": "preparing",
            "osVersion": ProcessInfo.processInfo.operatingSystemVersionString
        ]

        init(directory: URL, mode: String) {
            self.directory = directory
            report["mode"] = mode
            let summaryMode = mode == "summary" || mode == "public"
            report["freshWriterConversation"] = summaryMode
            report["freshReuseCache"] = summaryMode
            report["sourceFileRequired"] = summaryMode
        }

        func stage(_ name: String) {
            report["stage"] = name
            captureMemory(label: name)
            persist()
        }

        func recordTechnicalFailure(_ error: Error) {
            let failure = error as NSError
            report["failureStage"] = report["stage"] ?? "preparing"
            report["errorReflection"] = String(reflecting: error)
            report["errorLocalizedDescription"] = error.localizedDescription
            report["errorDomain"] = failure.domain
            report["errorCode"] = failure.code
        }

        func captureRuntimeState() async {
            #if canImport(LiteRTLM)
            if let failure = await GemmaRuntime.shared.lastFailure {
                report["runtimeLastFailure"] = failure
            }
            if let metrics = await GemmaRuntime.shared.lastMetrics,
               let data = try? JSONEncoder().encode(metrics),
               let value = try? JSONSerialization.jsonObject(with: data) {
                report["nativeMetrics"] = value
            }
            #endif
        }

        func record(_ update: OnDeviceSummary.Progress) {
            guard !interrupted else { return }
            var row = update.payload["progress"] as? [String: Any] ?? [:]
            row["elapsedSeconds"] = max(0, ProcessInfo.processInfo.systemUptime - startUptime)
            // A bounded local log is sufficient even if a future model emits
            // per-token progress; it does not affect the actual reply stream.
            if progress.count < 256 { progress.append(row) }
            captureMemory(label: update.phase)
            persist()
        }

        func captureMemory(label: String) {
            guard memory.count < 260 else { return }
            var row: [String: Any] = [
                "phase": label,
                "elapsedSeconds": max(0, ProcessInfo.processInfo.systemUptime - startUptime),
                "physicalMemoryBytes": ProcessInfo.processInfo.physicalMemory,
                "availableMemoryBytes": UInt64(os_proc_available_memory())
            ]
            var info = task_vm_info_data_t()
            var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
            let result = withUnsafeMutablePointer(to: &info) { pointer in
                pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                    task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
                }
            }
            if result == KERN_SUCCESS {
                row["physicalFootprintBytes"] = info.phys_footprint
                row["residentMemoryBytes"] = info.resident_size
                let peak = report["peakObservedPhysicalFootprintBytes"] as? UInt64 ?? 0
                report["peakObservedPhysicalFootprintBytes"] = max(peak, info.phys_footprint)
            }
            memory.append(row)
        }

        func persist() {
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                    attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
                var excludedDirectory = directory
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                try excludedDirectory.setResourceValues(values)
                var snapshot = report
                snapshot["progress"] = progress
                snapshot["memory"] = memory
                let data = try JSONSerialization.data(withJSONObject: snapshot, options: [.prettyPrinted, .sortedKeys])
                let output = directory.appendingPathComponent("result.json")
                try data.write(to: output, options: .atomic)
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                                                      ofItemAtPath: output.path)
            } catch {
                let failure = error as NSError
                NSLog("GEMMA_PROBE_REPORT_WRITE_FAILED domain=%@ code=%ld", failure.domain, failure.code)
            }
        }
    }
    #endif
}

#if os(iOS)
import UIKit
import WebKit
import os
import Darwin
#endif

/// A single explicit control request through the shipping JavaScript/WK bridge.
/// The stage owns the actual request lease and cancellation. After any terminal
/// report, the controlled runner restarts the normal app to release native handles.
@MainActor enum GemmaSummaryHostProbe {
    static var enabled: Bool {
        #if os(iOS) && !targetEnvironment(simulator) && !targetEnvironment(macCatalyst)
        return GemmaSummaryHostProbeRequest.isRequested()
        #else
        return false
        #endif
    }

    /// A function expression with a separately JSON-encoded control payload.
    /// The only substituted dependency is caption transport; model requests,
    /// ticket ownership, timeout and final reply use the shipping implementation.
    static let transportScript = #"""
    (function (configuration) {
      var hosts = ['m.youtube.com', 'www.youtube.com', 'youtube.com'];
      var api = window.ShortsAusblenden && window.ShortsAusblenden.summary;
      var observer = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.langformSummaryHostProbe;
      if (window.top !== window || location.protocol !== 'https:' || hosts.indexOf(location.hostname) < 0 ||
          location.pathname !== '/watch' || new URL(location.href).searchParams.get('v') !== configuration.videoID ||
          !api || typeof api.loadSummary !== 'function' || !observer || typeof observer.postMessage !== 'function' ||
          window.__langformSummaryHostProbeStarted) return false;
      window.__langformSummaryHostProbeStarted = configuration.nonce;
      function report(phase, result) {
        var summary = result && result.summary;
        var code = result && typeof result.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(result.code) ? result.code : '';
        observer.postMessage({ nonce: configuration.nonce, phase: phase, code: code,
          model: summary && summary.model === configuration.expectedModel ? summary.model : '',
          complete: !!(!code && summary && Array.isArray(summary.points) && summary.points.length > 0 &&
            (!summary.coverage || summary.coverage.complete !== false)),
          pointCount: summary && Array.isArray(summary.points) ? summary.points.length : 0 });
      }
      var player = { videoDetails: { videoId: configuration.videoID }, captions: {
        playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'de',
          baseUrl: 'https://www.youtube.com/api/timedtext?v=' + encodeURIComponent(configuration.videoID) + '&lang=de' }] }
      } };
      report('started', null);
      api.loadSummary(configuration.videoID, { host: window, watchPage: true, player: player, originalLanguage: true,
        fetchText: function () { return Promise.resolve(JSON.stringify({ events: [{ segs: [{ utf8: configuration.text }] }] })); },
        onProgress: function () { report('progress', null); }
      }).then(function (result) { report('complete', result); }, function () {
        report('failed', { code: 'HOST_PROBE_JS_FAILED' });
      });
      return true;
    })
    """#

    #if os(iOS)
    private static var started = false
    private static var current: Run?
    private static let expectedSourceSHA256 = "bb9911d8c8e19d5c64d50c0447b7b46bf277b965224ca6840dda9bccc6732e61"
    private static let timeoutNanoseconds: UInt64 = 240_000_000_000
    private static var directory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("GemmaSummaryHostProbe", isDirectory: true)
    }

    /// The caller first confirms its ordinary expanded Watch and active document.
    /// No replacement root, WebView or model call is created by this probe.
    @discardableResult static func startIfEligible(in webView: WKWebView, videoID: String,
                                                  host: [String: Any],
                                                  cancelRequest: @escaping (String) -> Void) -> Bool {
        guard enabled, !started, UIApplication.shared.applicationState == .active,
              let url = webView.url, url.scheme == "https",
              ["m.youtube.com", "www.youtube.com", "youtube.com"].contains(url.host ?? ""),
              url.path == "/watch", URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "v" })?.value == videoID else { return false }
        started = true
        let run = Run(webView: webView, directory: directory, cancelRequest: cancelRequest)
        current = run
        run.record("watchReady", host: host)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            // This trace belongs to this explicit process run; preserve source.
            for name in ["runtime-trace.jsonl", "native-failure.json"] {
                let previous = directory.appendingPathComponent(name)
                if FileManager.default.fileExists(atPath: previous.path) {
                    try FileManager.default.removeItem(at: previous)
                }
            }
            let handle = try FileHandle(forReadingFrom: directory.appendingPathComponent("source.txt"))
            defer { try? handle.close() }
            let data = try handle.read(upToCount: 16_385) ?? Data()
            guard data.count == 1_617, digest(data) == expectedSourceSHA256,
                  let source = String(data: data, encoding: .utf8) else {
                run.finish(status: "failed", code: "HOST_PROBE_CONTROL_SOURCE_MISMATCH")
                return false
            }
            run.preparedControl = OnDeviceSummary.prepare(source)
            run.report["inputBytes"] = data.count
            run.report["inputSHA256"] = digest(data)
            run.report["preparedInputSHA256"] = digest(Data(run.preparedControl.utf8))
            let configuration: [String: Any] = ["nonce": run.nonce, "videoID": videoID,
                "text": source, "expectedModel": GemmaModelStore.modelName]
            let json = String(decoding: try JSONSerialization.data(withJSONObject: configuration), as: UTF8.self)
            run.idleLease = SummaryIdleTimer.begin()
            run.installDeadlineAndObservers()
            run.report["status"] = "running"
            run.record("bridgeDispatch", host: host)
            webView.evaluateJavaScript(transportScript + "(" + json + ");", in: nil, in: .page) { value in
                Task { @MainActor in
                    guard current === run, !run.finished else { return }
                    switch value {
                    case .success(let accepted):
                        guard accepted as? Bool == true else {
                            run.abort(code: "HOST_PROBE_BRIDGE_UNAVAILABLE")
                            return
                        }
                        run.report["scriptAccepted"] = true
                        run.persist()
                    case .failure:
                        run.abort(code: "HOST_PROBE_SCRIPT_FAILED")
                    }
                }
            }
            return true
        } catch {
            run.finish(status: "failed", code: "HOST_PROBE_CONTROL_SOURCE_UNREADABLE")
            return false
        }
    }

    /// Claim only the known control source from the very same live WebView.
    /// Normal user inputs never enter this report, even during the opted-in run.
    static func claimRequest(id: String, text: String, in webView: WKWebView) -> Bool {
        guard enabled, let run = current, !run.finished, run.webView === webView,
              run.requestID == nil, !run.preparedControl.isEmpty,
              OnDeviceSummary.prepare(text) == run.preparedControl else { return false }
        run.requestID = id
        run.report["requestTicket"] = id
        run.report["bridgeControlSourceVerified"] = true
        run.persist()
        return true
    }

    static func ownsRequest(id: String) -> Bool {
        enabled && current?.finished == false && current?.requestID == id
    }

    static func requestStarted(id: String, lease: UUID, host: [String: Any]) {
        guard ownsRequest(id: id), let run = current, run.requestLease == nil else { return }
        run.requestLease = lease
        run.report["requestLease"] = lease.uuidString
        run.record("nativeRequestStarted", host: host)
    }

    static func progress(id: String, lease: UUID, update: OnDeviceSummary.Progress, host: [String: Any]) {
        guard ownsRequest(id: id), let run = current, run.requestLease == lease else { return }
        var row: [String: Any] = ["phase": update.phase, "processedSections": update.processedSections,
            "totalSections": update.totalSections, "sourceIncomplete": update.sourceIncomplete,
            "coverageIncomplete": update.coverageIncomplete, "elapsedSeconds": run.elapsed]
        row["previewPresent"] = update.tldr != nil
        if run.progress.count < 256 { run.progress.append(row) }
        run.record("nativeProgress", host: host)
    }

    /// Record the owned native result, then let the normal WK reply proceed.
    /// Do not globally unload here: an awaited unload could revoke a newer lease.
    /// Completion requires the shipping JS Promise; the runner restarts afterward.
    static func nativeFinished(id: String, lease: UUID, payload: [String: Any], host: [String: Any]) {
        guard ownsRequest(id: id), let run = current, run.requestLease == lease else { return }
        run.report["result"] = payload // Explicit fixed public control source only.
        let summary = payload["summary"] as? [String: Any]
        let model = summary?["model"] as? String ?? ""
        run.nativeComplete = payload["code"] == nil && OnDeviceSummary.reusableResult(payload)
            && model == GemmaModelStore.modelName
        run.report["nativeComplete"] = run.nativeComplete
        run.report["actualProviderModel"] = model
        run.report["nativeResultCode"] = machineCode(payload["code"]) ?? (run.nativeComplete ? "OK" : "HOST_PROBE_INCOMPLETE_RESULT")
        run.record("nativeFinished", host: host)
    }

    static func cancelled(id: String, lease: UUID, reason: String, host: [String: Any]) {
        guard ownsRequest(id: id), let run = current, run.requestLease == lease else { return }
        if ["replaced", "navigation", "background", "memoryWarning", "timeout", "webProcessTerminated", "closed", "request_cancelled"].contains(reason) {
            run.report["cancellationReason"] = reason
        }
        run.record("nativeCancelled", host: host)
        run.finish(status: "cancelled", code: run.report["failureCode"] as? String ?? "CANCELLED")
    }

    static func receive(_ body: Any, from webView: WKWebView) {
        guard enabled, let run = current, !run.finished, run.webView === webView,
              let row = body as? [String: Any], row["nonce"] as? String == run.nonce,
              let phase = row["phase"] as? String else { return }
        switch phase {
        case "started": run.report["shippingJavaScriptStarted"] = true
        case "progress": run.report["bridgeProgressCount"] = (run.report["bridgeProgressCount"] as? Int ?? 0) + 1
        case "complete", "failed":
            run.report["bridgeTerminalReceived"] = true
            let model = row["model"] as? String ?? ""
            run.report["bridgeProviderVerified"] = model == GemmaModelStore.modelName
            let complete = phase == "complete" && row["complete"] as? Bool == true
                && run.nativeComplete && model == GemmaModelStore.modelName && run.requestLease != nil
            let code = machineCode(row["code"]) ?? run.report["nativeResultCode"] as? String
                ?? "HOST_PROBE_BRIDGE_INCOMPLETE"
            run.finish(status: complete ? "completed" : "failed", code: complete ? nil : code)
            return
        default: return
        }
        run.persist()
    }

    private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func machineCode(_ value: Any?) -> String? {
        guard let text = value as? String, text.range(of: "^[A-Z0-9_]{1,80}$", options: .regularExpression) != nil else { return nil }
        return text
    }

    @MainActor private final class Run {
        weak var webView: WKWebView?
        let directory: URL
        let nonce = UUID().uuidString
        let started = ProcessInfo.processInfo.systemUptime
        let cancelRequest: (String) -> Void
        var preparedControl = ""
        var requestID: String?
        var requestLease: UUID?
        var idleLease: UUID?
        var finished = false
        var nativeComplete = false
        var deadline: Task<Void, Never>?
        var sampler: Task<Void, Never>?
        var observer: NSObjectProtocol?
        var progress: [[String: Any]] = []
        var events: [[String: Any]] = []
        var report: [String: Any]
        var elapsed: Double { max(0, ProcessInfo.processInfo.systemUptime - started) }

        init(webView: WKWebView, directory: URL, cancelRequest: @escaping (String) -> Void) {
            self.webView = webView
            self.directory = directory
            self.cancelRequest = cancelRequest
            report = ["schemaVersion": 1, "providerRoute": "shippingJS.loadSummary→WK→OnDeviceSummary.reply",
                "normalRoot": true, "isolatedDiagnosticView": false, "diagnosticCaptionTransport": true,
                "physicalTapProved": false, "realCaptionFetchProved": false, "freshReuseCache": false,
                "summaryPolicy": GemmaSummaryPolicy.version, "summaryRuntimeIdentity": GemmaSummaryPolicy.runtimeIdentity,
                "expectedProviderModel": GemmaModelStore.modelName, "runtimeBackend": GemmaModelStore.runtimeBackend,
                "verifiedContextTokens": GemmaModelStore.verifiedContextTokens ?? 0,
                "timeoutSeconds": 240, "physicalDevice": true, "semanticAcceptance": false,
                "externalNormalRestartRequired": true,
                "nativeUnloadPolicy": "external_normal_process_restart",
                "runID": nonce, "processID": ProcessInfo.processInfo.processIdentifier,
                "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
                "startedAt": ISO8601DateFormatter().string(from: Date()), "complete": false, "status": "preparing",
                "runtimeTraceFile": "runtime-trace.jsonl"]
        }

        func installDeadlineAndObservers() {
            deadline = Task { @MainActor [weak self] in
                do { try await Task.sleep(nanoseconds: GemmaSummaryHostProbe.timeoutNanoseconds) } catch { return }
                guard let self, !self.finished else { return }
                self.abort(code: "HOST_PROBE_TIMEOUT")
            }
            sampler = Task { @MainActor [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return }
                    guard let self, !self.finished else { return }
                    self.record("sampling", host: [:])
                }
            }
            observer = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification,
                object: nil, queue: .main) { [weak self] _ in
                    Task { @MainActor in self?.abort(code: "HOST_PROBE_APP_INACTIVE") }
                }
        }

        func abort(code: String) {
            guard !finished else { return }
            report["failureCode"] = code
            if let requestID { cancelRequest(requestID) }
            finish(status: "cancelled", code: code)
        }

        func finish(status: String, code: String?) {
            guard !finished else { return }
            finished = true
            deadline?.cancel(); deadline = nil
            sampler?.cancel(); sampler = nil
            if let observer { NotificationCenter.default.removeObserver(observer) }
            observer = nil
            if let idleLease { SummaryIdleTimer.end(idleLease) }
            idleLease = nil
            report["status"] = status
            report["complete"] = status == "completed"
            if let code { report["failureCode"] = code }
            report["finishedAt"] = ISO8601DateFormatter().string(from: Date())
            report["elapsedSeconds"] = elapsed
            report["idleLeaseReleased"] = true
            record("terminal", host: [:])
        }

        func record(_ phase: String, host: [String: Any]) {
            guard events.count < 300 else { persist(); return }
            var row: [String: Any] = ["phase": phase, "elapsedSeconds": elapsed,
                "availableMemoryBytes": UInt64(os_proc_available_memory()),
                "physicalMemoryBytes": ProcessInfo.processInfo.physicalMemory]
            var info = task_vm_info_data_t()
            var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
            let status = withUnsafeMutablePointer(to: &info) { pointer in
                pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                    task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
                }
            }
            if status == KERN_SUCCESS { row["selfPhysicalFootprintBytes"] = info.phys_footprint }
            for key in ["webViewCount", "feedCount", "inactiveFeedCount", "summaryRequestCount", "summaryHostHoldCount", "loadTicket"] {
                if let value = host[key] as? Int, (0...100_000).contains(value) { row[key] = value }
            }
            for key in ["playerPresent", "foreground", "prewarming", "sameLease", "sourceIsPlayer", "sourceIsActiveFeed", "playerMounted", "activeFeedMounted"] {
                if let value = host[key] as? Bool { row[key] = value }
            }
            if host["hostKind"] as? String == "normal_webview" { row["hostKind"] = "normal_webview" }
            if let mode = host["mode"] as? String, ["closed", "loading", "expanded", "mini"].contains(mode) { row["mode"] = mode }
            events.append(row)
            persist()
        }

        func persist() {
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                    attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
                var folder = directory
                var values = URLResourceValues(); values.isExcludedFromBackup = true
                try folder.setResourceValues(values)
                var snapshot = report
                snapshot["events"] = events
                snapshot["progress"] = progress
                let data = try JSONSerialization.data(withJSONObject: snapshot, options: [.prettyPrinted, .sortedKeys])
                let url = directory.appendingPathComponent("result.json")
                try data.write(to: url, options: .atomic)
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
            } catch {
                NSLog("GEMMA_HOST_PROBE_REPORT_WRITE_FAILED")
            }
        }
    }
    #endif
}
