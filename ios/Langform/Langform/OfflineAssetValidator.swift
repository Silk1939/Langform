import Foundation
@preconcurrency import AVFoundation

/// Shared by background downloads and file imports. Tests execute this same
/// validator with real local AVAssets on the Mac, without an iOS simulator.
enum OfflineAssetValidator {
    static func validate(_ url: URL, expectedBytes: Int64, expectedDuration: Double? = nil) async throws -> Int64 {
        let bytes = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? 0
        guard bytes > 0 else { throw DownloadSourceError.invalidFile }
        guard bytes <= DownloadSourcePolicy.maximumBytes else { throw DownloadSourceError.tooLarge }
        guard expectedBytes <= 0 || bytes == expectedBytes else { throw DownloadSourceError.partialResponse }
        let asset = AVURLAsset(url: url)
        let timeout = DispatchWorkItem { asset.cancelLoading() }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 15, execute: timeout)
        defer { timeout.cancel() }
        let playable = try await asset.load(.isPlayable)
        let protected = try await asset.load(.hasProtectedContent)
        let duration = try await asset.load(.duration)
        let video = try await asset.loadTracks(withMediaType: .video)
        let audio = try await asset.loadTracks(withMediaType: .audio)
        guard playable, !protected, duration.seconds.isFinite, duration.seconds > 0, !video.isEmpty, !audio.isEmpty else { throw DownloadSourceError.invalidFile }
        if let expectedDuration {
            guard expectedDuration.isFinite, expectedDuration > 0,
                  abs(duration.seconds - expectedDuration) <= max(1.25, expectedDuration * 0.001) else { throw DownloadSourceError.partialResponse }
        }
        // A fast-start MP4 keeps its duration/track tables at the beginning.
        // AVAsset can therefore report `isPlayable` even when its media tail
        // is missing. Read every compressed sample before calling it offline.
        // This checks file completeness without decoding frames or blocking UI.
        try await validateSamples(asset, tracks: video + audio)
        return bytes
    }

    private static func validateSamples(_ asset: AVAsset, tracks: [AVAssetTrack]) async throws {
        var declaredEnds: [Double] = []
        for track in tracks {
            let range = try await track.load(.timeRange)
            let end = CMTimeRangeGetEnd(range).seconds
            guard end.isFinite else { throw DownloadSourceError.invalidFile }
            declaredEnds.append(end)
        }
        let expectedEnds = declaredEnds
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            DispatchQueue.global(qos: .utility).async {
                do {
                    let reader = try AVAssetReader(asset: asset)
                    let outputs = tracks.map { track -> AVAssetReaderTrackOutput in
                        let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
                        // Copying forces the reader to touch media bytes;
                        // lazy sample references can hide a missing file tail.
                        output.alwaysCopiesSampleData = true
                        return output
                    }
                    for output in outputs {
                        guard reader.canAdd(output) else { throw DownloadSourceError.invalidFile }
                        reader.add(output)
                    }
                    let deadline = ProcessInfo.processInfo.systemUptime + 120
                    guard reader.startReading() else { throw DownloadSourceError.invalidFile }
                    defer { if reader.status == .reading { reader.cancelReading() } }
                    for (index, output) in outputs.enumerated() {
                        var samples = 0
                        var lastEnd = -Double.infinity
                        while reader.status == .reading {
                            guard ProcessInfo.processInfo.systemUptime < deadline else {
                                reader.cancelReading()
                                throw DownloadSourceError.invalidFile
                            }
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
                        // Some containers report a clean reader EOF for a
                        // truncated tail. Its samples must still reach that
                        // track's declared end (allowing packet rounding).
                        guard samples > 0, lastEnd + 0.25 >= expectedEnds[index] else { throw DownloadSourceError.invalidFile }
                    }
                    guard reader.status == .completed else { throw DownloadSourceError.invalidFile }
                    continuation.resume()
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
}
