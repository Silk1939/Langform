import Foundation

/// Opt-in diagnostic requests only. The Stage owns scheduling and routes these
/// URLs through its ordinary openWatch. A separate, exact opt-in permits one
/// existing native Start action; it is explicit playback, never autoplay proof.
struct VideoLoadProbe {
    struct Request: Equatable {
        let number: Int
        let url: URL
    }

    enum State: Equatable {
        case waitingForFeed, waitingForVideo, finished, cancelled
    }

    static let timeoutSeconds: TimeInterval = 30
    private(set) var state: State = .waitingForFeed
    private(set) var pending: Request?
    let requestsNativeStart: Bool
    private let videoIDs: [String]
    private var nextIndex = 0
    private var nativeStartRequest: Int?

    init?(environment: [String: String] = ProcessInfo.processInfo.environment) {
        guard environment["LANGFORM_DIAGNOSTICS"] == "1",
              let raw = environment["LANGFORM_VIDEO_PROBE"],
              let data = raw.data(using: .utf8),
              let ids = (try? JSONSerialization.jsonObject(with: data)) as? [String],
              (1...2).contains(ids.count),
              ids.allSatisfy({ id in
                  id.utf8.count == 11 && id.utf8.allSatisfy { byte in
                      (65...90).contains(byte) || (97...122).contains(byte) ||
                      (48...57).contains(byte) || byte == 95 || byte == 45
                  }
              }) else { return nil }
        videoIDs = ids
        requestsNativeStart = environment["LANGFORM_VIDEO_PROBE_PLAY"] == "1"
    }

    func mayRequestNativeStart(videoID: String, requestNumber: Int) -> Bool {
        requestsNativeStart && state == .waitingForVideo && pending?.number == requestNumber &&
            nativeStartRequest != requestNumber && videoID == videoIDs[nextIndex - 1]
    }

    /// Claim before invoking Start. Rejection, stalled media or later pause can
    /// never turn an observation into a playback retry for this request.
    mutating func claimNativeStart(videoID: String, requestNumber: Int) -> Bool {
        guard mayRequestNativeStart(videoID: videoID, requestNumber: requestNumber) else { return false }
        nativeStartRequest = requestNumber
        return true
    }

    mutating func start(feedReady: Bool) -> Request? {
        guard feedReady, state == .waitingForFeed else { return nil }
        return next()
    }

    /// Call only for a playing report bound to this request's native load ticket.
    /// A matching page alone or an old ready/playing report must not advance it.
    mutating func reportedPlaying(videoID: String, mediaReady: Bool, requestNumber: Int) -> Request? {
        guard state == .waitingForVideo, pending?.number == requestNumber,
              mediaReady, videoID == videoIDs[nextIndex - 1] else { return nil }
        return next()
    }

    /// The Stage schedules one timeoutSeconds deadline with the request number.
    /// Keeping the number in that closure prevents an old timer skipping a video.
    mutating func timedOut(requestNumber: Int) -> Request? {
        guard state == .waitingForVideo, pending?.number == requestNumber else { return nil }
        return next()
    }

    /// Manual interaction or app inactivity permanently stops this launch's plan.
    mutating func cancel() {
        guard state != .finished, state != .cancelled else { return }
        pending = nil
        state = .cancelled
    }

    private mutating func next() -> Request? {
        guard nextIndex < videoIDs.count else {
            pending = nil
            state = .finished
            return nil
        }
        let url = URL(string: "https://m.youtube.com/watch?v=" + videoIDs[nextIndex])!
        nextIndex += 1
        let request = Request(number: nextIndex, url: url)
        pending = request
        state = .waitingForVideo
        return request
    }
}
