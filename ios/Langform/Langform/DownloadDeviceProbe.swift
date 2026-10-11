import Foundation
import AVFoundation

/// Exact, opt-in public-video diagnostic. It uses the ordinary native download
/// store and leaves its validated local result available for a user's replay.
/// No media autoplay, audio-session ownership or network-policy change occurs.
@MainActor enum DownloadDeviceProbe {
    private static let videoID = "jNQXAC9IVRw"
    private static var accepted = false
    private static var task: Task<Void, Never>?

    static var enabled: Bool {
        isEnabled(environment: ProcessInfo.processInfo.environment)
    }

    static func isEnabled(environment: [String: String]) -> Bool {
        guard environment["LANGFORM_DIAGNOSTICS"] == "1",
              environment["LANGFORM_DOWNLOAD_PROBE"] == "1",
              VideoLoadProbe(environment: environment) != nil,
              let raw = environment["LANGFORM_VIDEO_PROBE"], let data = raw.data(using: .utf8),
              let ids = (try? JSONSerialization.jsonObject(with: data)) as? [String] else { return false }
        return ids == [videoID]
    }

    static func accept(source: DownloadSource?, message: String?) {
        guard enabled, !accepted else { return }
        accepted = true
        guard let source, source.origin == .activeWatch, source.videoID == videoID,
              let duration = source.expectedDuration, duration.isFinite, (18...20).contains(duration) else {
            mark(phase: "source-unavailable", status: "failed", fields: ["hasBridgeMessage": message != nil])
            return
        }
        do {
            try DownloadSourcePolicy.validate(source)
            let store = DownloadStore.shared
            let id = try store.start(source)
            mark(phase: "start", status: "downloading", fields: ["expectedBytes": source.expectedBytes,
                  "expectedDuration": duration, "cellularAllowed": store.allowCellular])
            task = Task { @MainActor in
                defer { task = nil }
                let deadline = ProcessInfo.processInfo.systemUptime + 60
                var previousStatus: OfflineDownload.Status?
                while ProcessInfo.processInfo.systemUptime < deadline {
                    guard let item = store.items.first(where: { $0.id == id }) else {
                        mark(phase: "item-unavailable", status: "failed")
                        return
                    }
                    if item.status != previousStatus {
                        previousStatus = item.status
                        mark(phase: "status", status: item.status.rawValue, fields: ["bytes": item.receivedBytes,
                              "expectedBytes": item.expectedBytes])
                    }
                    switch item.status {
                    case .ready:
                        do {
                            guard let url = store.fileURL(for: item), url.isFileURL else { throw DownloadSourceError.invalidFile }
                            let bytes = try await OfflineAssetValidator.validate(url, expectedBytes: source.expectedBytes,
                                                                               expectedDuration: duration)
                            let asset = AVURLAsset(url: url)
                            let actualDuration = try await asset.load(.duration)
                            let video = try await asset.loadTracks(withMediaType: .video)
                            let audio = try await asset.loadTracks(withMediaType: .audio)
                            let protected = try await asset.load(.hasProtectedContent)
                            mark(phase: "complete", status: "ready", fields: ["passed": true, "localFile": true,
                                  "bytes": bytes, "expectedBytes": source.expectedBytes, "duration": actualDuration.seconds,
                                  "expectedDuration": duration, "videoTracks": video.count, "audioTracks": audio.count,
                                  "protected": protected])
                        } catch {
                            markFailure(phase: "local-validation-failed", error: error)
                        }
                        return
                    case .failed, .cancelled:
                        mark(phase: "transfer-failed", status: item.status.rawValue, fields: ["bytes": item.receivedBytes,
                              "expectedBytes": item.expectedBytes])
                        return
                    case .downloading, .validating:
                        break
                    }
                    do { try await Task.sleep(for: .milliseconds(500)) }
                    catch { mark(phase: "probe-cancelled", status: "cancelled"); return }
                }
                // This bounds observation. It does not cancel a user-visible
                // background transfer or mutate its selected network policy.
                mark(phase: "timeout", status: "pending", fields: ["passed": false])
            }
        } catch { markFailure(phase: "start-failed", error: error) }
    }

    private static func markFailure(phase: String, error: Error) {
        let value = error as NSError
        // Domain/code are typed diagnostics; never persist localized errors,
        // URLs, source parameters, page strings or signed links.
        mark(phase: phase, status: "failed", fields: ["errorCode": value.code, "passed": false])
    }

    private static func mark(phase: String, status: String, fields: [String: Any] = [:]) {
        var entry = fields
        entry["event"] = "download-device-probe"
        entry["phase"] = phase
        entry["status"] = status
        entry["videoID"] = videoID
        StartupDiagnostics.videoMark(entry)
    }
}
