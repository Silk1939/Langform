import Foundation

/// Presentation state for explicit recovery controls; never controls playback.
struct PlayerStartupStatus {
    enum State: String {
        case unavailable, unstarted, paused, playing, buffering, ended, failed
    }

    private(set) var state: State = .unavailable
    private(set) var issue = ""
    private var hasMedia = false
    private var missingMediaExpired = false
    private var playRequestGeneration: UInt = 0
    private(set) var hasPresentedPicture = false

    /// A playing event can precede the compositor's first video frame. Keep the
    /// original thumbnail through that gap, independently from Play/Retry UI.
    var keepsStartupPoster: Bool { !hasPresentedPicture }

    mutating func receivePicture(mediaPresented: Bool?, mediaReady: Bool?, frameObservationSupported: Bool?) {
        // Scroll-time playback packets intentionally omit picture readiness.
        // They cannot clear a confirmed picture or falsely dismiss a poster.
        if mediaPresented == true || (frameObservationSupported == false && mediaReady == true) {
            hasPresentedPicture = true
        }
    }

    var needsMediaTimeout: Bool { !hasMedia && state == .unavailable && !missingMediaExpired }
    var requiresReload: Bool { issue == "media-error" || issue == "unavailable-retry" }
    var offersRetry: Bool { state == .failed || (state == .buffering && !issue.isEmpty) }
    var showsButton: Bool { state == .unstarted || offersRetry }
    var showsSpinner: Bool { (state == .buffering && !offersRetry) || needsMediaTimeout }
    var buttonTitle: String { requiresReload ? "Neu laden" : offersRetry ? "Erneut starten" : "Video starten" }

    mutating func receive(state rawState: String?, issue: String?, hasVideo: Bool) {
        hasMedia = hasVideo
        if hasVideo { missingMediaExpired = false }
        if let rawState, let next = State(rawValue: rawState) {
            state = next
            self.issue = issue ?? ""
            // Actual playback or a later deliberate pause supersedes a pending
            // native evaluation failure, just as a newer Start request does.
            if next == .playing || next == .paused || next == .ended || next == .failed {
                playRequestGeneration &+= 1
            }
        }
        // Empty geometry updates must not remove an offered recovery action.
        if missingMediaExpired && !hasVideo {
            state = .failed
            self.issue = "unavailable-retry"
        }
    }

    mutating func beginPlayRequest() -> UInt {
        playRequestGeneration &+= 1
        return playRequestGeneration
    }

    mutating func playRequestFailed(request: UInt) {
        guard request == playRequestGeneration else { return }
        playRequestGeneration &+= 1
        state = .failed
        issue = "rejected"
    }

    mutating func missingMediaTimedOut() {
        guard needsMediaTimeout else { return }
        missingMediaExpired = true
        state = .failed
        issue = "unavailable-retry"
    }
    /// Check the live page again inside the Play evaluation: an ad or user pause
    /// may arrive between the read-only eligibility reply and the native action.
    static func initialPlayJavaScript(videoID: String, play: Bool = false) -> String {
        let data = try! JSONEncoder().encode(videoID)
        let literal = String(data: data, encoding: .utf8)!
        let result = play ? "!!(window.__langformPlay && window.__langformPlay(\(literal), true))" : "true"
        return """
            (function () {
              try {
                var id=\(literal), u=new URL(location.href), r=document.getElementById('movie_player');
                if (document.hidden || (window.__langformIsNativeDragging && window.__langformIsNativeDragging())) return false;
                if (['m.youtube.com','www.youtube.com','youtube.com'].indexOf(u.hostname)===-1 ||
                    u.pathname!='/watch' || u.searchParams.get('v')!==id || !r) return false;
                var d=r.getVideoData&&r.getVideoData(), v=r.querySelector('video');
                if (!d || d.video_id!==id || d.isAd===true || !v || !v.paused || v.ended || v.error || v.seeking ||
                    !Number.isFinite(v.currentTime) || v.currentTime>0) return false;
                if (r.classList && (r.classList.contains('ad-showing') || r.classList.contains('ad-interrupting'))) return false;
                if (window.__langformHasOpenOverlay && window.__langformHasOpenOverlay()) return false;
                var report=window.__langformMeasureVideo&&window.__langformMeasureVideo();
                if (!report || report.playerVideoID!==id || report.playbackState!=='unstarted' || report.playbackIssue) return false;
                if (report.navigationToken && (!report.navigationStarted || !report.navigationComplete || !report.navigationMediaLoaded)) return false;
                return \(result);
              } catch(e) { return false; }
            })();
            """
    }

}


/// One initial request authorized by opening a new Watch video. Playback or a
/// deliberate pause consumes it, even if YouTube started before our bridge.
struct PlayerInitialPlayback {
    let ticket: Int
    let videoID: String
    private(set) var consumed = false
    private(set) var awaitingMedia = true

    func matches(ticket: Int, videoID: String?) -> Bool {
        self.ticket == ticket && self.videoID == videoID
    }

    mutating func claim(ticket: Int, videoID: String) -> Bool {
        guard matches(ticket: ticket, videoID: videoID), !consumed else { return false }
        consumed = true
        return true
    }

    mutating func observe(_ state: PlayerStartupStatus.State) {
        if state == .playing || state == .buffering || state == .paused || state == .ended || state == .failed {
            finish()
        }
    }

    mutating func finish() { consumed = true; awaitingMedia = false }
}
