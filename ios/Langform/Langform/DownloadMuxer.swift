import Foundation
@preconcurrency import AVFoundation

/// Joins already downloaded, complete MP4 video and AAC audio tracks. No
/// network access or audio-session ownership is involved. Both source files
/// stay intact; only a fully validated result is moved to the final URL.
enum DownloadMuxer {
    enum Failure: LocalizedError {
        case invalidTracks, durationMismatch, unsupportedContainer, destinationExists, exportFailed
        var errorDescription: String? {
            switch self {
            case .invalidTracks: return "Die heruntergeladenen Bild- und Tonspuren sind nicht vollständig oder nicht kompatibel."
            case .durationMismatch: return "Bild- und Tonspur haben unterschiedliche Längen. Es wurde kein Offlinevideo gespeichert."
            case .unsupportedContainer: return "Diese Bild- und Tonspuren können nicht gemeinsam als MP4 gespeichert werden."
            case .destinationExists: return "An diesem Speicherort liegt bereits eine Datei."
            case .exportFailed: return "Bild und Ton konnten nicht zu einem vollständigen Offlinevideo zusammengeführt werden."
            }
        }
    }

    static func merge(videoURL: URL, audioURL: URL, destinationURL: URL, expectedDuration: TimeInterval? = nil) async throws -> Int64 {
        let videoURL = videoURL.standardizedFileURL
        let audioURL = audioURL.standardizedFileURL
        let destinationURL = destinationURL.standardizedFileURL
        guard videoURL.isFileURL, audioURL.isFileURL, destinationURL.isFileURL,
              videoURL.resolvingSymlinksInPath() != audioURL.resolvingSymlinksInPath(),
              destinationURL.resolvingSymlinksInPath() != videoURL.resolvingSymlinksInPath(),
              destinationURL.resolvingSymlinksInPath() != audioURL.resolvingSymlinksInPath() else { throw Failure.invalidTracks }
        try Task.checkCancellation()
        if let expectedDuration {
            guard expectedDuration.isFinite, expectedDuration > 0 else { throw Failure.durationMismatch }
        }
        let videoBytes = try sourceBytes(videoURL)
        let audioBytes = try sourceBytes(audioURL)
        guard videoBytes <= DownloadSourcePolicy.maximumBytes - audioBytes else { throw DownloadSourceError.tooLarge }
        let fileManager = FileManager.default
        guard !fileManager.fileExists(atPath: destinationURL.path) else { throw Failure.destinationExists }
        let directory = destinationURL.deletingLastPathComponent()
        // At this point the input bytes already occupy disk. The export needs
        // another copy's worth of space, plus the shared metadata/safety reserve.
        let filesystem = try fileManager.attributesOfFileSystem(forPath: directory.path)
        let available = (filesystem[.systemFreeSize] as? NSNumber)?.int64Value ?? 0
        guard available >= videoBytes + audioBytes + DownloadSourcePolicy.spaceReserve else { throw DownloadSourceError.insufficientSpace }
        let temporaryDirectory = directory.appendingPathComponent(".mux-" + UUID().uuidString, isDirectory: true)
        try fileManager.createDirectory(at: temporaryDirectory, withIntermediateDirectories: false)
        defer { try? fileManager.removeItem(at: temporaryDirectory) }
        let temporaryURL = temporaryDirectory.appendingPathComponent("complete.mp4")
        let videoAsset = AVURLAsset(url: videoURL)
        let audioAsset = AVURLAsset(url: audioURL)
        let control = CancellationControl(assets: [videoAsset, audioAsset])
        return try await withTaskCancellationHandler {
            do {
                let video = try await sourceTrack(videoAsset, requiredType: .video, forbiddenType: .audio)
                let audio = try await sourceTrack(audioAsset, requiredType: .audio, forbiddenType: .video)
                let videoRange = try await video.load(.timeRange)
                let audioRange = try await audio.load(.timeRange)
                let videoDuration = videoRange.duration.seconds
                let audioDuration = audioRange.duration.seconds
                guard videoRange.start.seconds.isFinite, audioRange.start.seconds.isFinite,
                      videoDuration.isFinite, audioDuration.isFinite, videoDuration > 0, audioDuration > 0 else { throw Failure.invalidTracks }
                // AAC packet rounding is expected; substantially different
                // sources must not be silently clipped into a seemingly valid file.
                guard abs(videoDuration - audioDuration) <= 0.75,
                      abs(videoRange.start.seconds - audioRange.start.seconds) <= 0.25 else { throw Failure.durationMismatch }
                if let expectedDuration {
                    guard abs(videoDuration - expectedDuration) <= 0.75,
                          abs(audioDuration - expectedDuration) <= 0.75 else { throw Failure.durationMismatch }
                }
                try await validateInputSamples(videoAsset, track: video, range: videoRange, control: control)
                try await validateInputSamples(audioAsset, track: audio, range: audioRange, control: control)
                try Task.checkCancellation()
                let composition = AVMutableComposition()
                guard let composedVideo = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
                      let composedAudio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw Failure.invalidTracks }
                try composedVideo.insertTimeRange(videoRange, of: video, at: .zero)
                try composedAudio.insertTimeRange(audioRange, of: audio, at: .zero)
                composedVideo.preferredTransform = try await video.load(.preferredTransform)
                guard await AVAssetExportSession.compatibility(ofExportPreset: AVAssetExportPresetPassthrough, with: composition, outputFileType: .mp4),
                      let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough),
                      session.supportedFileTypes.contains(.mp4) else { throw Failure.unsupportedContainer }
                session.outputURL = temporaryURL
                session.outputFileType = .mp4
                session.shouldOptimizeForNetworkUse = true
                try await export(session, control: control)
                try Task.checkCancellation()
                let bytes = try await OfflineAssetValidator.validate(temporaryURL, expectedBytes: 0)
                if let expectedDuration {
                    let duration = try await AVURLAsset(url: temporaryURL).load(.duration)
                    guard duration.seconds.isFinite, abs(duration.seconds - expectedDuration) <= 0.75 else { throw Failure.durationMismatch }
                }
                try Task.checkCancellation()
                // moveItem is an atomic same-volume rename and never replaces
                // an existing destination. A racing save cannot destroy a file.
                try control.publish { try fileManager.moveItem(at: temporaryURL, to: destinationURL) }
                return bytes
            } catch {
                if Task.isCancelled { throw CancellationError() }
                throw error
            }
        } onCancel: {
            control.cancel()
        }
    }

    private static func sourceBytes(_ url: URL) throws -> Int64 {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              let bytes = (attributes[.size] as? NSNumber)?.int64Value, bytes > 0 else { throw Failure.invalidTracks }
        guard bytes <= DownloadSourcePolicy.maximumBytes else { throw DownloadSourceError.tooLarge }
        return bytes
    }

    private static func sourceTrack(_ asset: AVURLAsset, requiredType: AVMediaType, forbiddenType: AVMediaType) async throws -> AVAssetTrack {
        let timeout = DispatchWorkItem { asset.cancelLoading() }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 15, execute: timeout)
        defer { timeout.cancel() }
        let protected = try await asset.load(.hasProtectedContent)
        let tracks = try await asset.loadTracks(withMediaType: requiredType)
        let forbidden = try await asset.loadTracks(withMediaType: forbiddenType)
        guard !protected, tracks.count == 1, forbidden.isEmpty else { throw Failure.invalidTracks }
        let descriptions = try await tracks[0].load(.formatDescriptions)
        let supported: Set<FourCharCode> = requiredType == .video
            ? [kCMVideoCodecType_H264, kCMVideoCodecType_HEVC, kCMVideoCodecType_AV1]
            : [kAudioFormatMPEG4AAC]
        guard !descriptions.isEmpty, descriptions.allSatisfy({ supported.contains(CMFormatDescriptionGetMediaSubType($0)) }) else { throw Failure.invalidTracks }
        return tracks[0]
    }

    private static func validateInputSamples(_ asset: AVAsset, track: AVAssetTrack, range: CMTimeRange, control: CancellationControl) async throws {
        try Task.checkCancellation()
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            DispatchQueue.global(qos: .utility).async {
                do {
                    let reader = try AVAssetReader(asset: asset)
                    let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
                    output.alwaysCopiesSampleData = true
                    guard reader.canAdd(output) else { throw Failure.invalidTracks }
                    reader.add(output)
                    guard try control.startReader(reader) else { throw Failure.invalidTracks }
                    defer { if reader.status == .reading { reader.cancelReading() } }
                    let deadline = ProcessInfo.processInfo.systemUptime + 120
                    var samples = 0, lastEnd = -Double.infinity
                    while reader.status == .reading {
                        guard !control.isCancelled else { throw CancellationError() }
                        guard ProcessInfo.processInfo.systemUptime < deadline else { throw Failure.invalidTracks }
                        let next: Bool = autoreleasepool {
                            guard let sample = output.copyNextSampleBuffer() else { return false }
                            let time = CMSampleBufferGetPresentationTimeStamp(sample).seconds
                            let duration = CMSampleBufferGetDuration(sample).seconds
                            if time.isFinite { lastEnd = max(lastEnd, time + (duration.isFinite && duration > 0 ? duration : 0)) }
                            return true
                        }
                        if !next { break }
                        samples += 1
                    }
                    guard !control.isCancelled else { throw CancellationError() }
                    guard reader.status == .completed, samples > 0,
                          lastEnd + 0.25 >= CMTimeRangeGetEnd(range).seconds else { throw Failure.invalidTracks }
                    continuation.resume()
                } catch { continuation.resume(throwing: error) }
            }
        }
    }

    private static func export(_ session: AVAssetExportSession, control: CancellationControl) async throws {
        try Task.checkCancellation()
        defer { control.setExport(nil) }
        let timeout = DispatchWorkItem { session.cancelExport() }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 180, execute: timeout)
        defer { timeout.cancel() }
        guard !control.isCancelled else { throw CancellationError() }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            control.startExport(session) { result in continuation.resume(with: result) }
        }
    }

    /// The Task's cancellation callback may race with starting a reader or
    /// exporter. Registration checks the latched flag as well as canceling the
    /// current operation, so no canceled operation can subsequently continue.
    private final class CancellationControl: @unchecked Sendable {
        private let lock = NSLock()
        private var cancelled = false
        private var export: AVAssetExportSession?
        private let assets: [AVURLAsset]
        init(assets: [AVURLAsset]) { self.assets = assets }
        var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return cancelled }
        func startReader(_ value: AVAssetReader) throws -> Bool {
            lock.lock(); defer { lock.unlock() }
            guard !cancelled else { throw CancellationError() }
            return value.startReading()
        }
        func setExport(_ value: AVAssetExportSession?) {
            lock.lock(); export = value; lock.unlock()
        }
        func startExport(_ value: AVAssetExportSession, completion: @escaping @Sendable (Result<Void, Error>) -> Void) {
            lock.lock()
            guard !cancelled else { lock.unlock(); completion(.failure(CancellationError())); return }
            export = value
            value.exportAsynchronously { [self] in
                // AVFoundation can invoke its callback synchronously. Read its
                // terminal state after releasing the registration lock.
                DispatchQueue.global(qos: .utility).async { [self] in
                    lock.lock()
                    let cancelled = cancelled, session = export
                    lock.unlock()
                    if cancelled { completion(.failure(CancellationError())) }
                    else if session?.status == .completed { completion(.success(())) }
                    else { completion(.failure(session?.error ?? Failure.exportFailed)) }
                }
            }
            lock.unlock()
        }
        func publish(_ move: () throws -> Void) throws {
            lock.lock(); defer { lock.unlock() }
            guard !cancelled else { throw CancellationError() }
            try move()
        }
        func cancel() {
            lock.lock(); cancelled = true; let export = export; lock.unlock()
            assets.forEach { $0.cancelLoading() }
            // Apple forbids cancelReading concurrently with copyNextSampleBuffer.
            // The reader loop sees the latched flag and cancels on its own queue.
            export?.cancelExport()
        }
    }
}
