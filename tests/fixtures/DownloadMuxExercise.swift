import Foundation
import AVFoundation
import Darwin

@main struct DownloadMuxExercise {
    static func require(_ value: Bool, _ message: String) throws {
        if !value { throw NSError(domain: "DownloadMuxFixture", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    }
    static func main() async {
        do { try await exercise() }
        catch {
            FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
            exit(1)
        }
    }
    static func exercise() async throws {
        let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let video = directory.appendingPathComponent("video.mp4")
        let audio = directory.appendingPathComponent("audio.m4a")
        let originalVideo = try Data(contentsOf: video), originalAudio = try Data(contentsOf: audio)
        let output = directory.appendingPathComponent("joined.mp4")
        let bytes = try await DownloadMuxer.merge(videoURL: video, audioURL: audio, destinationURL: output, expectedDuration: 4)
        let validated = try await OfflineAssetValidator.validate(output, expectedBytes: bytes)
        try require(bytes == validated && bytes > 0, "mux must pass the unchanged complete-file validator")
        let asset = AVURLAsset(url: output)
        let videoTracks = try await asset.loadTracks(withMediaType: .video)
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        let duration = try await asset.load(.duration)
        try require(videoTracks.count == 1 && audioTracks.count == 1 && abs(duration.seconds - 4) < 0.1, "mux must preserve full duration and both tracks")
        try require(try Data(contentsOf: video) == originalVideo && Data(contentsOf: audio) == originalAudio, "mux modified an original input")
        print("REAL_AVFOUNDATION_MUX_AND_PRODUCTION_VALIDATOR_OK bytes=\(bytes) duration=\(duration.seconds)")
        let rotatedVideo = directory.appendingPathComponent("rotated.mp4")
        let rotatedOutput = directory.appendingPathComponent("rotated-joined.mp4")
        _ = try await DownloadMuxer.merge(videoURL: rotatedVideo, audioURL: audio, destinationURL: rotatedOutput)
        let rotatedSourceTracks = try await AVURLAsset(url: rotatedVideo).loadTracks(withMediaType: .video)
        let rotatedOutputTracks = try await AVURLAsset(url: rotatedOutput).loadTracks(withMediaType: .video)
        let sourceTransform = try await rotatedSourceTracks[0].load(.preferredTransform)
        let outputTransform = try await rotatedOutputTracks[0].load(.preferredTransform)
        print("ROTATED_SOURCE_TRANSFORM \(sourceTransform) OUTPUT \(outputTransform)")
        try require(!sourceTransform.isIdentity && sourceTransform == outputTransform, "video display orientation was lost")
        print("REAL_ROTATED_VIDEO_TRANSFORM_PRESERVED_OK")

        var rejected = 0
        func noPrivateFiles() throws {
            let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
            try require(!files.contains(where: { $0.hasPrefix(".mux-") }), "private temporary output survived")
        }
        func reject(_ name: String, video: URL, audio: URL, destination: URL? = nil, expectedDuration: TimeInterval? = nil) async throws {
            let target = destination ?? directory.appendingPathComponent(name + ".mp4")
            do {
                _ = try await DownloadMuxer.merge(videoURL: video, audioURL: audio, destinationURL: target, expectedDuration: expectedDuration)
                throw NSError(domain: "UnexpectedMuxSuccess", code: 1, userInfo: [NSLocalizedDescriptionKey: name])
            } catch {
                if (error as NSError).domain == "UnexpectedMuxSuccess" { throw error }
                rejected += 1
                if destination == nil { try require(!FileManager.default.fileExists(atPath: target.path), "failed mux was published") }
                try noPrivateFiles()
                print("REJECTED_\(name.uppercased())")
            }
        }
        try await reject("swapped_tracks", video: audio, audio: video)
        try await reject("combined_input", video: directory.appendingPathComponent("combined.mp4"), audio: audio)
        try await reject("duration_mismatch", video: video, audio: directory.appendingPathComponent("long-audio.m4a"))
        try await reject("expected_duration_mismatch", video: video, audio: audio, expectedDuration: 19.0135)
        try await reject("invalid_expected_duration", video: video, audio: audio, expectedDuration: .nan)
        try await reject("zero_expected_duration", video: video, audio: audio, expectedDuration: 0)
        try await reject("truncated_video", video: directory.appendingPathComponent("truncated-video.mp4"), audio: audio)
        try await reject("truncated_audio", video: video, audio: directory.appendingPathComponent("truncated-audio.m4a"))
        try await reject("remote_input", video: URL(string: "https://example.com/video.mp4")!, audio: audio)
        try await reject("same_input", video: video, audio: video)
        try await reject("input_destination_collision", video: video, audio: audio, destination: video)
        let oversized = directory.appendingPathComponent("oversized.mp4")
        FileManager.default.createFile(atPath: oversized.path, contents: Data())
        let handle = try FileHandle(forWritingTo: oversized)
        try handle.truncate(atOffset: UInt64(DownloadSourcePolicy.maximumBytes + 1))
        try handle.close()
        try await reject("oversized_input", video: oversized, audio: audio)
        try FileManager.default.removeItem(at: oversized)
        let existing = directory.appendingPathComponent("existing.mp4")
        let sentinel = Data("existing must remain".utf8)
        try sentinel.write(to: existing)
        try await reject("existing_destination", video: video, audio: audio, destination: existing)
        try require(try Data(contentsOf: existing) == sentinel, "existing destination overwritten")
        try require(rejected == 13, "expected thirteen rejection cases")
        print("WRONG_TRACKS_DURATION_TRUNCATION_SIZE_AND_ATOMIC_DESTINATION_OK")

        let cancelled = directory.appendingPathComponent("cancelled.mp4")
        let task = Task { try await DownloadMuxer.merge(videoURL: video, audioURL: audio, destinationURL: cancelled) }
        var observedWork = false
        for _ in 0..<10_000 {
            let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
            if files.contains(where: { $0.hasPrefix(".mux-") }) { observedWork = true; break }
            try await Task.sleep(nanoseconds: 100_000)
        }
        try require(observedWork, "did not observe the live private mux operation before cancellation")
        task.cancel()
        do { _ = try await task.value; throw NSError(domain: "UnexpectedMuxSuccess", code: 2) }
        catch is CancellationError { }
        try require(!FileManager.default.fileExists(atPath: cancelled.path), "canceled operation published output")
        try noPrivateFiles()
        try require(try Data(contentsOf: video) == originalVideo && Data(contentsOf: audio) == originalAudio, "failure modified an original input")
        print("REAL_MID_PIPELINE_CANCELLATION_CLEANUP_OK")

        // Observe AVFoundation's actual partial output, then cancel while the
        // export pipeline owns that file. Small fixtures may finish between
        // polls; retry those completed attempts without counting them as proof.
        var cancelledPartialOutput = false
        for attempt in 0..<20 where !cancelledPartialOutput {
            let target = directory.appendingPathComponent("cancel-output-\(attempt).mp4")
            let exporting = Task { try await DownloadMuxer.merge(videoURL: video, audioURL: audio, destinationURL: target) }
            var sawPartial = false
            for _ in 0..<10_000 {
                let folders = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
                for folder in folders where folder.lastPathComponent.hasPrefix(".mux-") {
                    let partial = folder.appendingPathComponent("complete.mp4")
                    if let attributes = try? FileManager.default.attributesOfItem(atPath: partial.path),
                       let size = (attributes[.size] as? NSNumber)?.intValue, size < originalVideo.count + originalAudio.count {
                        sawPartial = true
                        break
                    }
                }
                if sawPartial { exporting.cancel(); break }
                if FileManager.default.fileExists(atPath: target.path) { break }
                await Task.yield()
            }
            do { _ = try await exporting.value }
            catch is CancellationError { cancelledPartialOutput = sawPartial }
            if cancelledPartialOutput { try require(!FileManager.default.fileExists(atPath: target.path), "canceled partial output was published") }
            else { try? FileManager.default.removeItem(at: target) }
            try noPrivateFiles()
        }
        try require(cancelledPartialOutput, "never observed and canceled a real partial AVFoundation output")
        print("REAL_PARTIAL_EXPORT_CANCELLATION_CLEANUP_OK")
        try require(try Data(contentsOf: video) == originalVideo && Data(contentsOf: audio) == originalAudio, "export cancellation modified an original input")
        print("ORIGINAL_INPUTS_UNCHANGED_OK")
    }
}
