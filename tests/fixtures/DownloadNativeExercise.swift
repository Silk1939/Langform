import Foundation
import AVFoundation

@main struct NativeTests {
    static func expect(_ condition: Bool, _ message: String) {
        if !condition { print("FAILED: " + message); exit(1) }
    }
    static func rejected(_ source: DownloadSource, _ message: String, now: Date = Date(timeIntervalSince1970: 2_000_000_000)) {
        do { try DownloadSourcePolicy.validate(source, now: now); print("FAILED: " + message); exit(1) } catch {}
    }
    static func main() async throws {
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let id = "M7lc1UVf-VE"
        var source = DownloadSource(url: URL(string:"https://r1.googlevideo.com/videoplayback?expire=2000003600")!, title:"Test", videoID:id, pageURL:URL(string:"https://m.youtube.com/watch?v=" + id)!, mimeType:"video/mp4; codecs=\"avc1.64001F, mp4a.40.2\"", expectedBytes:50_000, origin:.activeWatch)
        try DownloadSourcePolicy.validate(source, now:now)
        source.url = URL(string:"http://r1.googlevideo.com/videoplayback")!; rejected(source,"HTTP rejected")
        source.url = URL(string:"https://googlevideo.com.evil.invalid/videoplayback")!; rejected(source,"spoofed host rejected")
        source.url = URL(string:"https://r1.googlevideo.com/videoplayback?range=0-100")!; rejected(source,"range rejected")
        source.url = URL(string:"https://r1.googlevideo.com/videoplayback?expire=1999999999")!; rejected(source,"expiry rejected")
        try DownloadSourcePolicy.validate(source, now:now, checkExpiry:false)
        source.url = URL(string:"https://r1.googlevideo.com/videoplayback")!
        source.mimeType = "video/mp4; codecs=\"avc1.64001F\""; rejected(source,"missing audio rejected")
        source.mimeType = "video/mp4; codecs=\"avc1.64001F, mp4a.40.2\""
        source.pageURL = URL(string:"https://m.youtube.com/watch?v=abcdefghijk")!; rejected(source,"wrong page rejected")
        source.pageURL = URL(string:"https://m.youtube.com/watch?v=" + id)!
        source.expectedBytes = DownloadSourcePolicy.maximumBytes + 1; rejected(source,"file limit rejected")
        source.expectedBytes = 50_000
        source.userAgent = "Safari QA\r\nInjected: yes"; rejected(source,"header injection rejected")
        source.userAgent = "Safari QA"
        source.expectedDuration = 1
        let encoded = try JSONEncoder().encode(OfflineDownload(id:UUID(),title:"Durable",source:source,createdAt:now,status:.downloading))
        let recovered = try JSONDecoder().decode(OfflineDownload.self,from:encoded)
        expect(recovered.source == source && recovered.status == .downloading,"manifest roundtrip")
        print("SOURCE_POLICY_10_CASES_OK")
        let local = URL(fileURLWithPath:CommandLine.arguments[1])
        let bytes = try await OfflineAssetValidator.validate(local,expectedBytes:0)
        expect(bytes > 0,"complete combined fixture")
        print("REAL_COMBINED_AVASSET_OK bytes=\(bytes)")
        _ = try await OfflineAssetValidator.validate(local,expectedBytes:bytes,expectedDuration:1)
        do { _ = try await OfflineAssetValidator.validate(local,expectedBytes:bytes,expectedDuration:20); throw NSError(domain:"WrongDurationAccepted",code:1) }
        catch DownloadSourceError.partialResponse { print("WRONG_WATCH_DURATION_REJECTED") }
        do { _ = try await OfflineAssetValidator.validate(local,expectedBytes:bytes + 1); throw NSError(domain:"ExpectedPartialReject",code:1) }
        catch DownloadSourceError.partialResponse { print("INCOMPLETE_LENGTH_REJECTED") }
        let corrupt = local.deletingLastPathComponent().appendingPathComponent("corrupt.mp4")
        try Data("<html>Not a video</html>".utf8).write(to:corrupt)
        do { _ = try await OfflineAssetValidator.validate(corrupt,expectedBytes:0); throw NSError(domain:"CorruptAccepted",code:1) }
        catch let error as NSError where error.domain != "CorruptAccepted" { print("CORRUPT_FILE_REJECTED") }
        let empty = local.deletingLastPathComponent().appendingPathComponent("empty.mp4")
        try Data().write(to:empty)
        do { _ = try await OfflineAssetValidator.validate(empty,expectedBytes:0); throw NSError(domain:"EmptyAccepted",code:1) }
        catch DownloadSourceError.invalidFile { print("EMPTY_FILE_REJECTED") }
        let silent = URL(fileURLWithPath:CommandLine.arguments[2])
        do { _ = try await OfflineAssetValidator.validate(silent,expectedBytes:0); throw NSError(domain:"SilentAccepted",code:1) }
        catch DownloadSourceError.invalidFile { print("MISSING_AUDIO_REJECTED") }
        let faststart = URL(fileURLWithPath:CommandLine.arguments[3])
        _ = try await OfflineAssetValidator.validate(faststart, expectedBytes:0)
        print("COMPLETE_FASTSTART_ACCEPTED")
        let truncated = URL(fileURLWithPath:CommandLine.arguments[4])
        // Its leading moov tables still declare positive duration and both
        // tracks. AVAsset.isPlayable alone does not detect this missing tail.
        let truncatedAsset = AVURLAsset(url:truncated)
        expect(try await truncatedAsset.load(.isPlayable), "truncation fixture reaches the old false-positive path")
        do { _ = try await OfflineAssetValidator.validate(truncated, expectedBytes:0); throw NSError(domain:"TruncatedAccepted",code:1) }
        catch DownloadSourceError.invalidFile { print("FASTSTART_TRUNCATION_REJECTED") }
    }
}
