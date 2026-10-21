import Foundation
import CoreFoundation
#if os(iOS) && !targetEnvironment(simulator)
import UIKit
import os
import Darwin
#endif

/// Opt-in local timing only. Never logs account data, URLs or search queries.
/// Launch with LANGFORM_DIAGNOSTICS=1 and collect Library/Caches/langform-startup.jsonl.
enum StartupDiagnostics {
    static let enabled = ProcessInfo.processInfo.environment["LANGFORM_DIAGNOSTICS"] == "1"
    static let playerEventsEnabled = enabled && ProcessInfo.processInfo.environment["LANGFORM_PLAYER_TRACE"] == "1"
    static let audioRouteProbeEnabled = enabled && ProcessInfo.processInfo.environment["LANGFORM_AUDIO_ROUTE_PROBE"] == "1"
    static let playerObserverEnabled = playerEventsEnabled || audioRouteProbeEnabled
    #if os(iOS) && !targetEnvironment(simulator)
    private static let deviceMemoryProbeEnabled = enabled && ProcessInfo.processInfo.environment["LANGFORM_DEVICE_MEMORY_PROBE"] == "1"
    private static var memoryProbeStarted = false
    private static var memoryProbeEpoch = 0
    private static var memoryProbeObservers: [NSObjectProtocol] = []
    private static var memoryProbeWork: [DispatchWorkItem] = []
    #endif
    private static let runID = UUID().uuidString
    private static var playerRows = 0
    private static let origin = ProcessInfo.processInfo.systemUptime
    private static let fileURL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        .appendingPathComponent("langform-startup.jsonl")
    private static let writer = DispatchQueue(label: "de.ipekkaya.langform.diagnostics", qos: .utility)
    // Native lifecycle and WebKit callbacks own counters on the main thread.
    // Only serialization and file access run on writer; timestamps stay at capture time.
    private static var seen: Set<String> = []

    static func begin() {
        guard enabled else {
            // A normal relaunch must not leave an older process's trace looking
            // like evidence for the current reproduction. Collect before restart.
            writer.async { try? FileManager.default.removeItem(at: fileURL) }
            return
        }
        writer.async { try? Data().write(to: fileURL, options: .atomic) }
        mark("app-init")
        #if os(iOS) && !targetEnvironment(simulator)
        installDeviceMemoryProbe()
        #endif
    }

    #if os(iOS) && !targetEnvironment(simulator)
    private static func installDeviceMemoryProbe() {
        guard deviceMemoryProbeEnabled, memoryProbeObservers.isEmpty else { return }
        let center = NotificationCenter.default
        memoryProbeObservers = [
            center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
                startDeviceMemoryProbe()
            },
            center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in
                stopDeviceMemoryProbe()
            }
        ]
        if UIApplication.shared.applicationState == .active { startDeviceMemoryProbe() }
    }

    private static func startDeviceMemoryProbe() {
        guard deviceMemoryProbeEnabled, !memoryProbeStarted,
              UIApplication.shared.applicationState == .active else { return }
        memoryProbeStarted = true
        memoryProbeEpoch += 1
        let epoch = memoryProbeEpoch
        let activeOrigin = ProcessInfo.processInfo.systemUptime
        for (index, delay) in [0.0, 5.0, 15.0, 30.0].enumerated() {
            let work = DispatchWorkItem {
                guard deviceMemoryProbeEnabled, memoryProbeEpoch == epoch,
                      UIApplication.shared.applicationState == .active else { return }
                var row: [String: Any] = [
                    "event": "device-memory-probe", "index": index, "scheduledSeconds": delay,
                    "elapsedMilliseconds": max(0, (ProcessInfo.processInfo.systemUptime - activeOrigin) * 1000),
                    "availableMemoryBytes": UInt64(os_proc_available_memory()),
                    "physicalMemoryBytes": ProcessInfo.processInfo.physicalMemory,
                    "osVersion": ProcessInfo.processInfo.operatingSystemVersionString
                ]
                if let footprint = currentPhysicalFootprint() { row["physicalFootprintBytes"] = footprint }
                append(row)
                if index == 3 { stopDeviceMemoryProbe() }
            }
            memoryProbeWork.append(work)
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
        }
    }

    private static func stopDeviceMemoryProbe() {
        memoryProbeEpoch += 1
        memoryProbeWork.forEach { $0.cancel() }
        memoryProbeWork.removeAll()
        memoryProbeObservers.forEach { NotificationCenter.default.removeObserver($0) }
        memoryProbeObservers.removeAll()
    }

    /// Public self-task accounting only; failure omits this optional metric.
    private static func currentPhysicalFootprint() -> UInt64? {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        guard result == KERN_SUCCESS else { return nil }
        return info.phys_footprint
    }
    #endif

    static func mark(_ event: String, once: Bool = false, documentMilliseconds: Double? = nil) {
        guard enabled, !once || seen.insert(event).inserted else { return }
        var entry: [String: Any] = ["event": event,
                                    "milliseconds": max(0, (ProcessInfo.processInfo.systemUptime - origin) * 1000)]
        if event == "app-init" {
            entry["processID"] = ProcessInfo.processInfo.processIdentifier
            entry["runID"] = runID
            entry["unixMilliseconds"] = Date().timeIntervalSince1970 * 1000
            entry["build"] = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
            entry["playerTrace"] = playerEventsEnabled
            entry["audioRouteProbe"] = audioRouteProbeEnabled
        }
        #if DEBUG
        entry["configuration"] = "Debug"
        #else
        entry["configuration"] = "Release"
        #endif
        if let documentMilliseconds { entry["documentMilliseconds"] = documentMilliseconds }
        append(entry)
    }

    static func videoMark(_ entry: [String: Any]) {
        guard enabled else { return }
        var entry = entry
        entry["scope"] = "video-load"
        #if DEBUG
        entry["configuration"] = "Debug"
        #else
        entry["configuration"] = "Release"
        #endif
        append(entry)
    }

    static func playerEvents(_ rows: [[String: Any]]) {
        guard playerEventsEnabled, playerRows < 2000 else { return }
        var entries: [[String: Any]] = []
        for row in rows.prefix(min(32, 2000 - playerRows)) {
            guard var entry = PlayerDiagnosticEvent.sanitized(row) else { continue }
            entry["scope"] = "player-events"
            entry["runID"] = runID
            entry["processID"] = ProcessInfo.processInfo.processIdentifier
            entry["receivedMilliseconds"] = max(0, (ProcessInfo.processInfo.systemUptime - origin) * 1000)
            entries.append(entry)
        }
        playerRows += entries.count
        append(entries)
    }

    /// The normal player-event sanitizer rejects custom QA rows. Keep this
    /// separate opt-in restricted to one public video and typed state values.
    static func captionEvents(_ rows: [[String: Any]]) {
        guard playerEventsEnabled, ProcessInfo.processInfo.environment["LANGFORM_CAPTIONS_PROBE"] == "1" else { return }
        func snapshot(_ value: Any?) -> [String: Any] {
            guard let source = value as? [String: Any] else { return [:] }
            var result: [String: Any] = [:]
            for key in ["enabled", "trackSelected", "paused", "muted", "fixLoaded"] {
                if let value = source[key] as? Bool { result[key] = value }
            }
            for key in ["windows", "spokenSegments", "visibleSpokenSegments", "time", "toggleCalls"] {
                if let value = source[key] as? Double, value.isFinite, value >= 0, value < 100000 { result[key] = value }
            }
            for key in ["language", "translation"] {
                if let value = source[key] as? String, value.isEmpty || value.range(of: "^[a-zA-Z0-9-]{1,24}$", options: .regularExpression) != nil { result[key] = value }
            }
            if let value = source["pressed"] as? String, ["true", "false"].contains(value) { result["pressed"] = value }
            return result
        }
        for row in rows.prefix(8) {
            guard row["event"] as? String == "captions-probe", row["videoID"] as? String == "M7lc1UVf-VE",
                  let phase = row["phase"] as? String, ["explicit-diagnostic-play", "before", "toggle", "complete", "failed"].contains(phase) else { continue }
            var entry: [String: Any] = ["event": "captions-probe", "videoID": "M7lc1UVf-VE", "phase": phase]
            for key in ["expected", "passed", "finished", "spokenObserved"] {
                if let value = row[key] as? Bool { entry[key] = value }
            }
            for key in ["index", "count"] {
                if let value = row[key] as? Int, (0...6).contains(value) { entry[key] = value }
            }
            entry["before"] = snapshot(row["before"])
            entry["after"] = snapshot(row["after"] ?? row)
            videoMark(entry)
        }
    }

    static func performanceEvent(_ row: [String: Any]) {
        guard enabled, ProcessInfo.processInfo.environment["LANGFORM_PERFORMANCE_PROBE"] == "1",
              let phase = row["phase"] as? String, ["ready", "first-frame", "before", "toggle", "complete", "failed"].contains(phase) else { return }
        var entry: [String: Any] = ["event": "performance-probe", "phase": phase]
        for key in ["milliseconds", "playToFrameMilliseconds", "commandMilliseconds", "stateMilliseconds", "clickedAtMilliseconds", "index", "trackCount", "responseTrackCount", "maxAge", "status", "extraParamMask"] {
            if let value = row[key] as? Double, value.isFinite, value >= 0, value < 100000 { entry[key] = value }
        }
        for key in ["expected", "passed", "finished", "enabled", "optionsReady", "baseURLAvailable", "trackURLAvailable", "trackBaseURLAvailable", "responseAPIAvailable", "cacheable", "cacheHeaderPresent", "formatSrv3", "requestMatchesBase", "noStore", "noCache", "formatJSON3", "baseMatchIgnoringExtra", "warmStarted", "warmReady", "warmHit"] { if let value = row[key] as? Bool { entry[key] = value } }
        if let profile = row["profile"] as? [String: Any] {
            var result: [String: Any] = [:]
            for key in ["elapsedMilliseconds", "frameGapsOver50ms", "maxFrameGapMilliseconds"] {
                if let value = profile[key] as? Double, value.isFinite, value >= 0, value < 100000 { result[key] = value }
            }
            var callbacks: [String: Any] = [:]
            if let rows = profile["callbacks"] as? [String: [String: Any]] {
                let allowed: Set<String> = ["ViewportLayout", "early", "logic", "hide", "controller", "summary", "page-captions", "ads", "ShortsBootstrap", "WebViewLinks", "PlaybackQuality", "PlayerRect", "CaptionToggle", "CommentsMotion", "CommentReactions", "FullscreenChapters", "FullscreenMotion"]
                for (key, values) in rows {
                    let parts = key.split(separator: ":").map(String.init)
                    let kinds = ["mutation", "event", "setTimeout", "setInterval", "requestAnimationFrame"] + ["ensureAirPlay", "refreshChapters", "findSeekBar", "playerControls", "controlLine", "chaptersFromPlayer"].map { "function-" + $0 }
                    guard parts.count == 2, allowed.contains(parts[0]), kinds.contains(parts[1]) else { continue }
                    var clean: [String: Double] = [:]
                    for field in ["calls", "milliseconds", "maxMilliseconds"] {
                        if let value = values[field] as? Double, value.isFinite, value >= 0, value < 100000 { clean[field] = value }
                    }
                    callbacks[key] = clean
                }
            }
            result["callbacks"] = callbacks; entry["profile"] = result
            if let resources = profile["captionResources"] as? [[String: Any]] {
                entry["captionResources"] = resources.prefix(32).map { row -> [String: Double] in
                    var clean: [String: Double] = [:]
                    for field in ["requestKey", "formatCode", "baseTrackIndex", "extraParamMask", "openMilliseconds", "sendMilliseconds", "startMilliseconds", "durationMilliseconds", "dnsMilliseconds", "connectMilliseconds", "tlsMilliseconds", "requestStartMilliseconds", "responseStartMilliseconds", "responseEndMilliseconds", "transferBytes", "bodyBytes"] {
                        if let value = row[field] as? Double, value.isFinite, value >= 0, value < 10000000 { clean[field] = value }
                    }
                    for field in ["noStore", "noCache"] { if let value = row[field] as? Bool { clean[field] = value ? 1 : 0 } }
                    return clean
                }
            }
        }
        videoMark(entry)
    }

    private static func append(_ entry: [String: Any]) {
        append([entry])
    }

    private static func append(_ entries: [[String: Any]]) {
        guard !entries.isEmpty else { return }
        writer.async {
            var data = Data()
            for entry in entries {
                guard let line = try? JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys]) else { continue }
                data.append(line); data.append(10)
            }
            guard let handle = try? FileHandle(forWritingTo: fileURL) else { return }
            defer { try? handle.close() }
            do {
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
            } catch { /* Diagnostics must never interfere with playback. */ }
        }
    }
}

/// Whitelist again at the native boundary; never persist arbitrary page strings.
enum PlayerDiagnosticEvent {
    static func sanitized(_ row: [String: Any]) -> [String: Any]? {
        let events: Set<String> = ["loadstart", "loadedmetadata", "loadeddata", "play", "playing", "pause", "waiting", "stalled", "canplay", "seeking", "seeked", "emptied", "ended", "error", "progress", "timeupdate", "volumechange", "ratechange", "pointerdown", "pointerup", "touchstart", "touchend", "click", "after-input", "webkitbeginfullscreen", "webkitendfullscreen", "fullscreen-api"]
        guard let event = row["event"] as? String, events.contains(event),
              let target = row["target"] as? String, ["media", "control", "video", "surface"].contains(target) else { return nil }
        var result: [String: Any] = ["event": event, "target": target]
        for key in ["sequence", "route", "documentEpoch", "documentMilliseconds", "unixMilliseconds", "playerState", "readyState", "networkState", "currentTime", "bufferAhead", "errorCode"] {
            if let value = row[key] as? NSNumber, value.doubleValue.isFinite { result[key] = value.doubleValue }
        }
        for key in ["hasVideo", "playerMatches", "paused", "seeking", "muted", "apiMuted", "manualQuality", "controlsToggle", "hidden", "trusted", "prevented", "pageInert", "fullscreenUI", "fullscreenMarked", "nativeVideoFullscreen", "documentFullscreen", "apiIntercepted", "nativeDragging", "nativeMini"] {
            if let value = row[key] as? Bool { result[key] = value }
        }
        let audioRanges: [String: ClosedRange<Double>] = ["volume": 0...1, "apiVolume": 0...100, "rate": 0...16,
            "audioDecoded": -1...Double.greatestFiniteMagnitude, "audioTracks": -1...32, "audioEnabled": -1...32,
            "mediaToken": 0...Double.greatestFiniteMagnitude, "sourceToken": 0...Double.greatestFiniteMagnitude]
        for (key, range) in audioRanges {
            if let value = row[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
               value.doubleValue.isFinite, range.contains(value.doubleValue) { result[key] = value.doubleValue }
        }
        let audioStrings = ["audioSession": ["inactive", "active", "interrupted", "unknown"],
            "audioSessionType": ["auto", "playback", "ambient", "transient", "transient-solo", "play-and-record", "unknown"]]
        for (key, choices) in audioStrings {
            if let value = row[key] as? String, choices.contains(value) { result[key] = value }
        }
        if let value = row["fullscreenAPI"] as? String,
           ["requestFullscreen", "webkitRequestFullscreen", "webkitRequestFullScreen", "webkitEnterFullscreen", "webkitEnterFullScreen"].contains(value) {
            result["fullscreenAPI"] = value
        }
        for key in ["actualQuality", "requestedCap"] {
            if let value = row[key] as? String, ["unknown", "auto", "tiny", "small", "medium", "large", "hd720", "hd1080", "hd1440", "hd2160", "highres"].contains(value) { result[key] = value }
        }
        return result
    }
}

/// First milestones per native video request, with no URL, media ID or account
/// information. Request time starts at openWatch, not at the physical finger tap.
struct VideoLoadDiagnostics {
    enum Event: String {
        case requested = "video-requested"
        case prepared = "video-player-prepared"
        case documentRequested = "video-document-requested"
        case documentCommit = "video-document-commit"
        case documentFinished = "video-document-finished"
        case spaRequested = "video-spa-requested"
        case spaFallback = "video-spa-fallback"
        case firstMedia = "video-first-media"
        case painted = "video-painted-report"
        case mediaReady = "video-media-ready"
        case mediaPresented = "video-media-presented"
        case revealStarted = "video-reveal-started"
        case revealCompleted = "video-reveal-completed"
        case playing = "video-playing-report"
        case unstarted = "video-unstarted-report"
        case buffering = "video-buffering-report"
        case paused = "video-paused-report"
        case rejected = "video-start-rejected"
        case playRequested = "video-explicit-play-requested"
        case failed = "video-failed"
        case cancelled = "video-cancelled"
        case superseded = "video-superseded"
    }

    private let enabled: Bool
    private let clock: () -> Double
    private let emit: ([String: Any]) -> Void
    private var sequence = 0
    private var ticket: Int?
    private var origin: Double = 0
    private var playerExisted = false
    private var seen: Set<Event> = []

    init(enabled: Bool = StartupDiagnostics.enabled,
         clock: @escaping () -> Double = { ProcessInfo.processInfo.systemUptime },
         emit: @escaping ([String: Any]) -> Void = StartupDiagnostics.videoMark) {
        self.enabled = enabled
        self.clock = clock
        self.emit = emit
    }

    mutating func begin(ticket: Int, requestedAt: Double, playerExisted: Bool) {
        guard enabled else { return }
        finish(.superseded)
        sequence += 1
        self.ticket = ticket
        origin = requestedAt
        self.playerExisted = playerExisted
        seen.removeAll(keepingCapacity: true)
        // Preserve the entry time even though player creation already occurred.
        record(.requested, milliseconds: 0)
    }

    mutating func mark(_ event: Event, ticket: Int) {
        guard enabled, self.ticket == ticket else { return }
        record(event, milliseconds: max(0, (clock() - origin) * 1000))
    }

    mutating func finish(_ event: Event) {
        guard enabled, ticket != nil else { return }
        // Closing or replacing a video that already started is not a failed
        // startup. Keep any post-playing reveal completion until this point.
        if !seen.contains(.playing) {
            record(event, milliseconds: max(0, (clock() - origin) * 1000))
        }
        ticket = nil
    }

    private mutating func record(_ event: Event, milliseconds: Double) {
        guard seen.insert(event).inserted else { return }
        emit(["request": sequence, "event": event.rawValue,
              "milliseconds": milliseconds, "playerExisted": playerExisted])
    }
}
