import Foundation

/// Opt-in native action plan. The Stage executes the same existing button
/// actions and supplies observed state; this type has no UI, timers or playback.
struct PlayerInteractionProbe {
    enum Mode { case closed, loading, expanded, mini }
    enum State { case waitingForPlayback, running, completed, cancelled, timedOut }
    enum Action { case minimize, toggleMiniPlayback, expand, close, verifyBlank }
    enum Step: String {
        case minimizePlaying, pauseMini, expandPaused, minimizePaused
        case resumeMini, expandPlaying, close, verifyBlank

        var action: Action {
            switch self {
            case .minimizePlaying, .minimizePaused: return .minimize
            case .pauseMini, .resumeMini: return .toggleMiniPlayback
            case .expandPaused, .expandPlaying: return .expand
            case .close: return .close
            case .verifyBlank: return .verifyBlank
            }
        }
    }
    struct Request: Equatable {
        let ticket: Int
        let step: Step
        var action: Action { step.action }
    }
    struct Observation {
        let videoID: String?
        let mode: Mode
        let playing: Bool
        let hasVideo: Bool
        let mediaReady: Bool
        let settled: Bool
        let url: URL?
    }

    static let timeoutSeconds: TimeInterval = 4
    private static let steps: [Step] = [.minimizePlaying, .pauseMini, .expandPaused, .minimizePaused,
                                        .resumeMini, .expandPlaying, .close, .verifyBlank]
    private(set) var state: State = .waitingForPlayback
    private(set) var pending: Request?
    private let videoID: String
    private var nextIndex = 0

    init?(environment: [String: String] = ProcessInfo.processInfo.environment) {
        guard environment["LANGFORM_PLAYER_PROBE"] == "1",
              VideoLoadProbe(environment: environment) != nil,
              let raw = environment["LANGFORM_VIDEO_PROBE"], let data = raw.data(using: .utf8),
              let ids = (try? JSONSerialization.jsonObject(with: data)) as? [String],
              ids.count == 1 else { return nil }
        videoID = ids[0]
    }

    /// On this first request, the Stage cancels its VideoLoadProbe before it can
    /// advance on the same report. Only confirmed, settled playback starts us.
    mutating func start(observation: Observation) -> Request? {
        guard state == .waitingForPlayback else { return nil }
        if let id = observation.videoID, id != videoID { cancel(); return nil }
        guard observation.videoID == videoID, observation.mode == .expanded,
              observation.mediaReady, observation.hasVideo, observation.playing,
              observation.settled else { return nil }
        guard matchesVideoURL(observation.url) else { cancel(); return nil }
        state = .running
        return next()
    }

    mutating func observe(_ observation: Observation, ticket: Int) -> Request? {
        guard state == .running, let request = pending, request.ticket == ticket else { return nil }
        let closing = request.step == .close || request.step == .verifyBlank
        guard observation.videoID == videoID || (closing && observation.videoID == nil) else {
            cancel()
            return nil
        }
        if !closing && !matchesVideoURL(observation.url) { cancel(); return nil }
        guard observation.settled else { return nil }
        if closing {
            guard observation.mode == .closed, !observation.playing else { return nil }
            if request.step == .verifyBlank {
                guard !observation.hasVideo, observation.url?.absoluteString == "about:blank" else { return nil }
            }
        } else {
            guard observation.hasVideo, observation.mediaReady else { return nil }
            let expanded = request.step == .expandPaused || request.step == .expandPlaying
            let playing = request.step == .minimizePlaying || request.step == .resumeMini || request.step == .expandPlaying
            guard observation.mode == (expanded ? .expanded : .mini), observation.playing == playing else { return nil }
        }
        return next()
    }

    mutating func timedOut(ticket: Int) {
        guard state == .running, pending?.ticket == ticket else { return }
        pending = nil
        state = .timedOut
    }

    /// Manual input or app inactivity permanently stops this launch's plan.
    mutating func cancel() {
        guard state == .waitingForPlayback || state == .running else { return }
        pending = nil
        state = .cancelled
    }

    private func matchesVideoURL(_ url: URL?) -> Bool {
        guard let url, url.scheme == "https",
              let host = url.host, ["m.youtube.com", "www.youtube.com", "youtube.com"].contains(host),
              url.path == "/watch" || url.path.hasPrefix("/watch/"),
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return false }
        return items.first(where: { $0.name == "v" })?.value == videoID
    }

    private mutating func next() -> Request? {
        guard nextIndex < Self.steps.count else {
            pending = nil
            state = .completed
            return nil
        }
        let request = Request(ticket: nextIndex + 1, step: Self.steps[nextIndex])
        nextIndex += 1
        pending = request
        return request
    }
}
