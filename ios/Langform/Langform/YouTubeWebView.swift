import SwiftUI
import UIKit
import WebKit
import CoreFoundation
import AVFAudio

/// Two web views on one stage. The feed stays on the page Tan came from. A video
/// opens in the player view, which slides up over the feed. Swiping down on the
/// picture shrinks the player view into a card above YouTube's bottom bar. The
/// player view stays on the watch page the whole time, so playback goes on.
struct YouTubeWebView: UIViewControllerRepresentable {
    @Binding var unreachable: Bool
    var reloadToken: Int
    var onFullscreen: ((Bool) -> Void)? = nil
    var downloadRequestToken = 0
    var onDownloads: ((DownloadSource?, String?, @escaping (Bool) -> Void) -> Void)? = nil

    static let startURL = URL(string: "https://m.youtube.com/")!

    /// Home feed on the host the page is already using.
    static func homeURL(for url: URL?) -> URL {
        let host = url?.host?.lowercased() ?? ""
        if host == "www.youtube.com" || host == "youtube.com" {
            return URL(string: "https://www.youtube.com/")!
        }
        return startURL
    }
    /// Fresh YouTube sign-in. Used once, after Google rejects the webview user agent.
    static let signInRetryURL = URL(string: "https://accounts.google.com/ServiceLogin?service=youtube&hl=de&passive=true&continue=https://m.youtube.com/")!
    static let scriptNames = ["TouchPolicy", "ViewportLayout", "early", "logic", "hide", "controller", "summary", "page-captions", "ads", "ShortsBootstrap", "WatchOpening", "WebViewLinks", "CommunityPosts"]
    static let playerEarlyScriptNames = ["WatchBackgroundAudio", "PlaybackQuality"]
    static let playerScriptNames = ["PlaybackZoom", "PlaybackSwipe", "PlaybackHold", "PlayerRect", "WatchAudio", "CaptionToggle", "PlayerSettings", "CommentsMotion", "CommentReactions", "FullscreenChapters", "FullscreenMotion", "DownloadSource", "SystemMedia", "SponsorBlock", "WatchTools"]
    static let feedOnlyScriptNames = ["DiscoveryMenu", "FeedMotion", "SearchResults"]
    // Bundled resources do not change during a launch. Reuse their assembled
    // source instead of reading every file synchronously on a first tab tap.
    private static let commonScriptSource = readScripts(scriptNames)
    private static let feedScriptSource = commonScriptSource + "\n" + readScripts(feedOnlyScriptNames)
    private static let playerScriptSource = readScripts(playerEarlyScriptNames) + "\n" + commonScriptSource + "\n" + readScripts(playerScriptNames)
    /// Mobile Safari 26.6, the current iPhone string as of October 2026.
    /// The frozen OS token is 18_7; Version/26.6 is the Safari release.
    static let safariUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1"
    static let safariPreferenceKey = "langform.preferSafariUserAgent"

    static func isYouTube(_ url: URL?) -> Bool {
        let host = url?.host?.lowercased() ?? ""
        return host == "youtube.com" || host == "www.youtube.com" || host == "m.youtube.com"
    }

    static func isWatchPage(_ url: URL?) -> Bool {
        guard let url, isYouTube(url) else { return false }
        return url.path == "/watch" || url.path.hasPrefix("/watch/")
    }

    /// Playables are separate game engines, not long-form video pages.
    static func isPlayablePage(_ url: URL?) -> Bool {
        guard let url, isYouTube(url) else { return false }
        return url.path == "/playables" || url.path.hasPrefix("/playables/")
            || url.path == "/playable" || url.path.hasPrefix("/playable/")
    }

    static func isPlayableResource(_ url: URL?) -> Bool {
        let host = url?.host?.lowercased() ?? ""
        return host == "playables.usercontent.goog" || host.hasSuffix(".playables.usercontent.goog")
    }

    static func isHomePage(_ url: URL?) -> Bool {
        guard let url, isYouTube(url) else { return false }
        return url.path.isEmpty || url.path == "/"
    }

    static func isAccountPage(_ url: URL?) -> Bool {
        let host = url?.host?.lowercased() ?? ""
        return host == "accounts.google.com" || host == "accounts.youtube.com"
    }

    static func isAccountTransition(_ url: URL?) -> Bool {
        if isAccountPage(url) { return true }
        guard let url, isYouTube(url) else { return false }
        return ["/signin", "/signout", "/logout", "/account_switcher"].contains { path in
            url.path == path || url.path.hasPrefix(path + "/")
        }
    }

    static func videoID(_ url: URL?) -> String? {
        guard isWatchPage(url), let url,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        return items.first(where: { $0.name == "v" })?.value
    }

    static func hasTimestamp(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return parts.queryItems?.contains(where: { ["t", "start"].contains($0.name) && !($0.value ?? "").isEmpty }) == true
            || parts.fragment?.hasPrefix("t=") == true || parts.fragment?.hasPrefix("start=") == true
    }

    func makeUIViewController(context: Context) -> PlayerStageController {
        let controller = PlayerStageController()
        let stage = controller.stage
        stage.onUnreachable = { unreachable = $0 }
        stage.onFullscreen = onFullscreen
        stage.onDownloads = onDownloads
        stage.downloadRequestToken = downloadRequestToken
        stage.reloadToken = reloadToken
        stage.start()
        return controller
    }

    func updateUIViewController(_ controller: PlayerStageController, context: Context) {
        let stage = controller.stage
        stage.onUnreachable = { unreachable = $0 }
        stage.onFullscreen = onFullscreen
        stage.onDownloads = onDownloads
        if stage.downloadRequestToken != downloadRequestToken {
            stage.downloadRequestToken = downloadRequestToken
            stage.requestDownloads()
        }
        guard stage.reloadToken != reloadToken else { return }
        stage.reloadToken = reloadToken
        stage.reload()
    }

    static func dismantleUIViewController(_ controller: PlayerStageController, coordinator: ()) {
        controller.stage.stop()
    }

    static func makeWebView(relay: WKScriptMessageHandler, messages: [String], scripts: [String], isFeed: Bool = false) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Same store for both views: one sign-in, one set of cookies.
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let pagePreferences = WKWebpagePreferences()
        pagePreferences.preferredContentMode = .mobile
        configuration.defaultWebpagePreferences = pagePreferences
        let audibleVideoProbe = !isFeed && VideoLoadProbe()?.requestsAudibleUserOpen == true
        // This explicit read-only reproduction must observe the user's sound
        // state, rather than install the unrelated quiet-fixture mute mask.
        let audibleRouteProbe = !isFeed && StartupDiagnostics.audioRouteProbeEnabled
        if StartupDiagnostics.enabled && !audibleVideoProbe && !audibleRouteProbe {
            configuration.userContentController.addUserScript(WKUserScript(
                source: readScripts(["SilentDiagnostics"]), injectionTime: .atDocumentStart,
                forMainFrameOnly: false, in: .page))
        }
        for name in messages {
            configuration.userContentController.add(relay, contentWorld: .page, name: name)
        }
        if StartupDiagnostics.enabled,
           let probe = ProcessInfo.processInfo.environment["LANGFORM_OPENING_PROBE"],
           ["home", "subscriptions", "interrupt", "rapid", "inspect", "search"].contains(probe) {
            configuration.userContentController.add(relay, contentWorld: .page, name: "langformOpeningProbe")
            configuration.userContentController.addUserScript(WKUserScript(
                source: "window.__langformOpeningProbeMode='\(probe)';\n" + readScripts(["WatchOpeningDiagnostics"]),
                injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        }
        if VideoLoadProbe() != nil {
            configuration.userContentController.add(relay, contentWorld: .page, name: "langformProbeInteraction")
            configuration.userContentController.addUserScript(WKUserScript(source: """
                (function () {
                  function touched() { window.webkit.messageHandlers.langformProbeInteraction.postMessage(true); }
                  document.addEventListener('touchstart', touched, { capture: true, passive: true });
                  document.addEventListener('pointerdown', touched, { capture: true, passive: true });
                })();
                """, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        }
        // A feed document stays quiet until the stage confirms it is the active
        // tab. The player has no activity flag and continues playback normally.
        if isFeed && StartupDiagnostics.enabled {
            configuration.userContentController.add(relay, contentWorld: .page, name: "langformDiagnostics")
            configuration.userContentController.addUserScript(WKUserScript(
                source: readScripts(["StartupDiagnostics"]), injectionTime: .atDocumentStart,
                forMainFrameOnly: true, in: .page))
            if ProcessInfo.processInfo.environment["LANGFORM_NATIVE_SEARCH_PROBE"] == "1" {
                configuration.userContentController.addUserScript(WKUserScript(
                    source: readScripts(["SearchDiagnostics"]), injectionTime: .atDocumentStart,
                    forMainFrameOnly: true, in: .page))
            }
        }
        if !isFeed && StartupDiagnostics.playerObserverEnabled {
            configuration.userContentController.add(relay, contentWorld: .page, name: "langformPlayerDiagnostics")
            configuration.userContentController.addUserScript(WKUserScript(
                source: readScripts(["PlayerDiagnostics"]), injectionTime: .atDocumentStart,
                forMainFrameOnly: true, in: .page))
            if ProcessInfo.processInfo.environment["LANGFORM_CAPTIONS_PROBE"] == "1", VideoLoadProbe() != nil {
                configuration.userContentController.addUserScript(WKUserScript(
                    source: readScripts(["CaptionDiagnostics"]), injectionTime: .atDocumentStart,
                    forMainFrameOnly: true, in: .page))
            }
        }
        if !isFeed && StartupDiagnostics.enabled && ProcessInfo.processInfo.environment["LANGFORM_PERFORMANCE_PROBE"] == "1" && VideoLoadProbe() != nil {
            configuration.userContentController.add(relay, contentWorld: .page, name: "langformPerformanceDiagnostics")
            configuration.userContentController.addUserScript(WKUserScript(
                source: readScripts([ProcessInfo.processInfo.environment["LANGFORM_FIRST_CAPTION_PROBE"] == "1" ? "FirstCaptionDiagnostics" : "PerformanceDiagnostics"]), injectionTime: .atDocumentStart,
                forMainFrameOnly: true, in: .page))
        }
        if !isFeed && StartupDiagnostics.enabled && ProcessInfo.processInfo.environment["LANGFORM_HOLD_PROBE"] == "1" {
            let gestureInputProbe = ProcessInfo.processInfo.environment["LANGFORM_GESTURE_INPUT_PROBE"] == "1"
            configuration.userContentController.addUserScript(WKUserScript(
                source: "window.__langformSettingsDeferredControlProbe = \(ProcessInfo.processInfo.environment["LANGFORM_SETTINGS_DEFERRED_CONTROL_PROBE"] == "1" ? "true" : "false");\nwindow.__langformGestureInputProbe = \(gestureInputProbe ? "true" : "false");\nwindow.__langformCommentsStructureProbe = \(ProcessInfo.processInfo.environment["LANGFORM_COMMENTS_STRUCTURE_PROBE"] == "1" ? "true" : "false");\n" + readScripts(["PlaybackHoldDiagnostics"]), injectionTime: .atDocumentStart,
                forMainFrameOnly: true, in: .page))
        }
        let quietBootstrap = isFeed ? "window.__langformFeedActive = false;\n" :
            "window.__langformBackgroundAudioDiagnostics = \(StartupDiagnostics.enabled && BackgroundPlaybackProbe() != nil);\nwindow.__langformFullscreenEnterProtocol = 1;\nwindow.__langformFullscreenExitProtocol = 1;\nwindow.__langformFullscreenDiagnostics = \(StartupDiagnostics.enabled);\nwindow.__langformFullscreenProbeEnabled = \(StartupDiagnostics.enabled && ProcessInfo.processInfo.environment["LANGFORM_FULLSCREEN_PROBE"] == "1" && PlayerInteractionProbe() != nil && VideoLoadProbe() != nil);\nif (location.pathname !== '/watch') window.__langformFeedActive = false;\n"
        let motionBootstrapScript = WKUserScript(source: LangformMotion.bootstrapSource,
            injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page)
        configuration.userContentController.addUserScript(motionBootstrapScript)
        let source = quietBootstrap + concatenatedScripts(scripts)
        if !source.isEmpty {
            configuration.userContentController.addUserScript(
                WKUserScript(
                    source: source,
                    injectionTime: .atDocumentStart,
                    forMainFrameOnly: true,
                    in: .page
                )
            )
        }
        let webView = LangformWebView(frame: .zero, configuration: configuration)
        webView.motionBootstrapScript = motionBootstrapScript
        webView.allowsLinkPreview = false
        webView.isOpaque = false
        webView.backgroundColor = isFeed ? .systemBackground : .black
        webView.scrollView.backgroundColor = isFeed ? .clear : .black
        // Feed bounce areas follow YouTube's actual page background. Forcing
        // black here exposed a separate strip during pull-to-refresh.
        if !isFeed { webView.underPageBackgroundColor = .black }
        // Feed pages keep WebKit's interactive history gesture. The separate
        // player uses the stage's interactive transition to the mini card instead.
        webView.allowsBackForwardNavigationGestures = isFeed
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.contentInset = .zero
        webView.scrollView.automaticallyAdjustsScrollIndicatorInsets = false
        // Same mobile Safari string from the first paint, so YouTube does not
        // lay out a desktop page inside the phone width.
        webView.customUserAgent = safariUserAgent
        #if DEBUG
        webView.isInspectable = true
        #endif
        return webView
    }

    private static func concatenatedScripts(_ names: [String]) -> String {
        if names == scriptNames { return feedScriptSource }
        if names == scriptNames + playerScriptNames { return playerScriptSource }
        return readScripts(names)
    }

    private static func readScripts(_ names: [String]) -> String {
        names.compactMap { name in
            guard let url = Bundle.main.url(forResource: name, withExtension: "js") else { return nil }
            guard let source = try? String(contentsOf: url, encoding: .utf8) else { return nil }
            if StartupDiagnostics.enabled && ProcessInfo.processInfo.environment["LANGFORM_PERFORMANCE_PROBE"] == "1" {
                var measuredSource = source
                if name == "page-captions" {
                    for function in ["ensureAirPlay", "refreshChapters", "findSeekBar", "playerControls", "controlLine", "chaptersFromPlayer"] {
                        let wrapper = "function \(function)(){var t=performance.now();try{return __lf_original_\(function).apply(this,arguments);}finally{if(window.__lfRecordFunction)window.__lfRecordFunction('\(function)',performance.now()-t);}}\nfunction __lf_original_\(function)("
                        measuredSource = measuredSource.replacingOccurrences(of: "function \(function)(", with: wrapper)
                    }
                }
                return "window.__lfProfileSource='\(name)';\n" + measuredSource + "\nwindow.__lfProfileSource='';\n"
            }
            return source
        }.joined(separator: "\n")
    }
}

/// The content controller keeps its handlers alive. This relay keeps the stage out of that cycle.
final class ScriptRelay: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

final class PlayerCardView: UIView {
    var onActivate: (() -> Void)?

    override func accessibilityActivate() -> Bool {
        guard let onActivate else { return false }
        onActivate()
        return true
    }
}

/// Keep a free-card tap bounded through its final touch event. The card itself
/// can move during native transitions, so all samples use window coordinates.
final class PlayerCardTapGestureRecognizer: UITapGestureRecognizer {
    private weak var contact: UITouch?
    private var origin: CGPoint?
    private var maxDisplacement: CGFloat = 0
    private var rejected = false
    private var reportedMove = false
    private var diagnosticCount = 0

    private func trace(_ phase: String) {
        guard StartupDiagnostics.enabled, diagnosticCount < 40 else { return }
        diagnosticCount += 1
        StartupDiagnostics.videoMark(["event": "mini-card-tap-tracking", "phase": phase,
            "candidate": !rejected && contact != nil, "maxDisplacement": Double(maxDisplacement),
            "state": state.rawValue])
    }

    private func reject(_ phase: String) {
        rejected = true
        state = .failed
        trace(phase)
        contact = nil
        origin = nil
    }

    private func hasOtherActiveTouch(_ event: UIEvent, than touch: UITouch) -> Bool {
        event.allTouches?.contains { other in
            other !== touch && other.phase != .ended && other.phase != .cancelled
        } ?? false
    }

    private func accepts(_ touches: Set<UITouch>, event: UIEvent, phase: String) -> Bool {
        guard !rejected, state == .possible, let contact, let origin, touches.count == 1,
              touches.first === contact, !hasOtherActiveTouch(event, than: contact) else {
            reject(phase)
            return false
        }
        let point = contact.location(in: nil)
        guard point.x.isFinite, point.y.isFinite else { reject(phase); return false }
        maxDisplacement = max(maxDisplacement, hypot(point.x - origin.x, point.y - origin.y))
        guard maxDisplacement <= 10 else { reject(phase); return false }
        return true
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard !rejected, state == .possible, contact == nil, touches.count == 1,
              let touch = touches.first, !hasOtherActiveTouch(event, than: touch) else {
            reject("began")
            return
        }
        let point = touch.location(in: nil)
        guard point.x.isFinite, point.y.isFinite else { reject("began"); return }
        contact = touch
        origin = point
        trace("began")
        super.touchesBegan(touches, with: event)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard accepts(touches, event: event, phase: "moved") else { return }
        if !reportedMove { reportedMove = true; trace("moved") }
        super.touchesMoved(touches, with: event)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        // Reject before UITap can recognize and schedule its target action,
        // including a final displacement without an intervening moved event.
        guard accepts(touches, event: event, phase: "ended") else { return }
        trace("ended")
        super.touchesEnded(touches, with: event)
        contact = nil
        origin = nil
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        reject("cancelled")
        super.touchesCancelled(touches, with: event)
    }

    override func reset() {
        contact = nil
        origin = nil
        maxDisplacement = 0
        rejected = false
        reportedMove = false
        super.reset()
        trace("reset")
    }
}

/// UIKit delivers the rotation coordinator to the controller that owns the
/// stage before changing its bounds. The window's hosting controller does not
/// expose that coordinator reliably for this embedded player.
final class PlayerStageController: UIViewController {
    let stage = PlayerStage()

    override func loadView() { view = stage }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        stage.beginNativeRotation(to: size, coordinator: coordinator)
        super.viewWillTransition(to: size, with: coordinator)
    }
}

/// Selection is owned by editable website fields. Player labels and feed cards
/// must never offer WebKit's native copy/lookup menu during a playback hold.
final class LangformWebView: WKWebView {
    var motionBootstrapScript: WKUserScript?

    /// Refresh the one app-owned snapshot in place. Retaining every other
    /// script object preserves its content world, timing and relative order.
    func synchronizeMotionPreferences() {
        let source = LangformMotion.bootstrapSource
        let controller = configuration.userContentController
        if let installed = motionBootstrapScript, installed.source != source {
            let scripts = controller.userScripts
            if scripts.contains(where: { $0 === installed }) {
                let replacement = WKUserScript(source: source, injectionTime: .atDocumentStart,
                    forMainFrameOnly: true, in: .page)
                controller.removeAllUserScripts()
                scripts.forEach { controller.addUserScript($0 === installed ? replacement : $0) }
                motionBootstrapScript = replacement
            }
        }
        evaluateJavaScript(LangformMotion.preferenceUpdateSource)
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(copy(_:)) || action == #selector(cut(_:)) ||
            action == #selector(select(_:)) || action == #selector(selectAll(_:)) { return false }
        return super.canPerformAction(action, withSender: sender)
    }
}

final class PlayerStage: UIView, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UIGestureRecognizerDelegate {
    private enum FeedTab: Hashable {
        case home, subscriptions, you

        var position: Int {
            switch self {
            case .home: return 0
            case .subscriptions: return 1
            case .you: return 2
            }
        }

        init?(url: URL?) {
            guard let url, YouTubeWebView.isYouTube(url),
                  ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return nil }
            switch url.path {
            case "", "/": self = .home
            case "/feed/subscriptions": self = .subscriptions
            case "/feed/you", "/feed/library": self = .you
            default: return nil
            }
        }

        func rootURL(for origin: URL?) -> URL {
            let path: String
            switch self {
            case .home: path = "/"
            case .subscriptions: path = "/feed/subscriptions"
            case .you: path = YouTubeWebView.homeURL(for: origin).host == "m.youtube.com" ? "/feed/library" : "/feed/you"
            }
            return URL(string: path, relativeTo: YouTubeWebView.homeURL(for: origin))!.absoluteURL
        }
    }

    private final class FeedState {
        let webView: WKWebView
        let rootURL: URL
        var observations: [NSKeyValueObservation] = []
        var navigation: WKNavigation?
        var rootNavigation: WKNavigation?
        var active: Bool?
        var mediaSuspended: Bool?
        var overlayOpen = false
        var failed = false
        var needsReload = false
        var contentReady = false
        var accountStale = false
        var refresh: FeedRefresh?

        init(webView: WKWebView, rootURL: URL) {
            self.webView = webView
            self.rootURL = rootURL
        }
    }

    enum Mode {
        case closed
        /// The watch page loads behind the feed. Nothing of the player is on screen yet.
        case loading
        case expanded
        case mini
    }

    var onUnreachable: ((Bool) -> Void)?
    var onFullscreen: ((Bool) -> Void)?
    var onDownloads: ((DownloadSource?, String?, @escaping (Bool) -> Void) -> Void)?
    var downloadRequestToken = 0
    private let systemMedia = SystemMediaController()
    private var systemMediaSuspendedForOffline = false
    var reloadToken = 0

    private(set) var mode: Mode = .closed
    /// 0 is the full player, 1 is the card.
    private var progress: CGFloat = 0
    /// The video element's box in the player view, in points. Read from the page, never set on it.
    private var videoRect: CGRect = .zero
    /// Contact priority requires a current main-video report, not a retained crop.
    private var videoSeekGeometry: (rect: CGRect, seek: CGRect, videoID: String, ticket: Int, viewport: Int)?
    private var videoPlaying = false
    private var startupStatus = PlayerStartupStatus()
    private var startupVideoID: String?
    private var missingMediaTimeout: DispatchWorkItem?
    private var dragging = false
    private var nativeDragVideoID: String?
    private var playerOverlayOpen = false
    private var playerOverlayVideoID: String?
    private var playerFullscreen = false
    private var commentReactionDiagnosticCount = 0
    private var customFullscreenID: String?
    private struct CustomFullscreenEnter {
        let videoID: String
        let token: String
        let ticket: Int
        var allowsCurrentOrientation = false
        var waitingForRotation = false
        var preparedViewport: CGSize?
        var sentViewport: CGSize?
        var rotationDeadlineMilliseconds: Double?
        var rotationCSSCurve: String?
    }
    private var customFullscreenEnter: CustomFullscreenEnter?
    private struct CustomFullscreenExit {
        let videoID: String
        let token: String
        let ticket: Int
        var opensSearchInFeed = false
        var allowsCurrentOrientation = false
        var waitingForRotation = false
        var preparedViewport: CGSize?
        var sentViewport: CGSize?
        var sourceViewport: CGSize?
        var motionViewport: CGSize?
        var motionGeneration: Int?
        var motionReady = false
        var preRotationMotion = false
        var portraitRequested = false
        var cancellingMotion = false
        var diagnosticMotionStarted = false
    }
    private var customFullscreenExit: CustomFullscreenExit?
    private struct PendingPhysicalFullscreenExit {
        let videoID: String
        let ticket: Int
        let rotationGeneration: Int
        let player: ObjectIdentifier
        let sourceViewport: CGSize
        let expiresAt: TimeInterval
    }
    private var pendingPhysicalFullscreenExit: PendingPhysicalFullscreenExit?
    private let sponsorBlock = SponsorBlockService()
    private var sponsorBlockRequest: (token: String, videoID: String, ticket: Int)?
    private var activeRotationCoordinator: UIViewControllerTransitionCoordinator?
    private var rotationIntentPolicy = PlayerRotationIntentPolicy()
    private var observesPhysicalOrientation = false
    private var nativeRotationGeneration = 0
    private var fullscreenCardRotationGeneration: Int?
    private var nativeRotationTarget: CGSize?
    private var nativeRotationDeadlineMilliseconds: Double?
    private var nativeRotationCSSCurve: String?
    private var fullscreenExitMotionTimeout: DispatchWorkItem?
    private var fullscreenGeometryTrace: (videoID: String, token: String, ticket: Int, beganAt: TimeInterval, rows: Int)?
    private var fullscreenGeometryDirection = "exit"
    private var fullscreenPresentationLink: CADisplayLink?
    private var fullscreenPresentationTrace: (videoID: String, token: String, ticket: Int, direction: String, beganAt: TimeInterval, frames: Int)?

    private final class FullscreenPresentationTarget: NSObject {
        weak var stage: PlayerStage?
        init(_ stage: PlayerStage) { self.stage = stage }
        @objc func sample(_ link: CADisplayLink) {
            guard let stage else { link.invalidate(); return }
            stage.sampleFullscreenPresentation(link)
        }
    }
    private let fullscreenSelectionFeedback = UISelectionFeedbackGenerator()
    private var fullscreenSnapLastAt = -Double.infinity
    private var fullscreenExitDrag = false
    private var fullscreenEnterDrag = false
    private var feedTabs: [FeedTab: FeedState] = [:]
    private var activeFeedTab: FeedTab = .home
    private var feedPrewarm: DispatchWorkItem?
    private var backgroundPreparationDisabled = false
    private var prewarmingTab: FeedTab?
    private var playerWarmupAttempted = false
    private var playerWarmupNavigation: WKNavigation?
    private var playerPreparationSuspended = false
    private var keyboardVisible = false
    private var feedSearchTicket = 0
    private var pendingFeedSearch: (view: ObjectIdentifier, ticket: Int)?
    private var feedSearchInFlight: Int?
    private var nativeSearchOverlay: NativeSearchOverlay?
    private var nativeSearchRecent: [String] = []
    private var minimizeRequestTicket = 0
    private var pendingMinimizeRequest: Int?
    private var feedFailed: Bool {
        get { feedTabs[activeFeedTab]?.failed ?? false }
        set { feedTabs[activeFeedTab]?.failed = newValue }
    }
    private var lastWatchURL: URL?
    private var triedFallback = false
    private var showsPlayingState: Bool?
    /// A fresh document may reveal as soon as its video is decoded. An optional
    /// SPA probe requires a ticket-bound router transition and a new video frame.
    private var loadTicket = 0
    private var videoLoadDiagnostics = VideoLoadDiagnostics()
    private var videoProbe = VideoLoadProbe()
    private var backgroundPlaybackProbe = BackgroundPlaybackProbe()
    private var audioRouteProbe = AudioRouteProbe()
    private var backgroundPlaybackWork: [DispatchWorkItem] = []
    private var backgroundCategoryHandoff = WatchBackgroundAudioCategoryHandoff()
    private var backgroundCategoryRequest: (number: Int, ticket: Int, id: String, token: Int?)?
    private var backgroundCategorySerial = 0
    private var backgroundContinuationRevoked = false
    private var backgroundAudioInterrupted = false
    private var backgroundLeaseDiagnosticTicket = 0
    private var backgroundLeaseDiagnosticCount = 0
    private var videoProbeTicket: Int?
    private var videoProbeWork: DispatchWorkItem?
    private var videoProbeTimeout: DispatchWorkItem?
    private var videoProbePlayCheck: (ticket: Int, request: Int)?
    private var startingVideoProbePlayback = false
    private var initialPlaybackIntent: PlayerInitialPlayback?
    private var initialPlaybackCheckTicket: Int?
    private var startingWatchPlayback = false
    private var watchAudioIntent: (ticket: Int, videoID: String)?
    private var watchAudioCheckTicket: Int?
    private var interactionProbe = PlayerInteractionProbe()
    private var interactionProbeWork: DispatchWorkItem?
    private var interactionProbeTimeout: DispatchWorkItem?
    private var interactionProbeObserving = false
    private var executingInteractionProbe = false
    private var interactionProbeNotBefore: TimeInterval = 0
    private var fullscreenDiagnosticPending: (videoID: String, ticket: Int, token: String, request: PlayerInteractionProbe.Request)?
    private var fullscreenDiagnosticCompletedTicket: Int?
    private var fullscreenDiagnosticTimeout: DispatchWorkItem?
    private var loadingVideoID: String?
    private var loadFinished = false
    private var loadCommitted = false
    private var loadHasVideo = false
    private var loadPainted = false
    private var loadMediaReady = false
    // Diagnostics can compare full loads; normal requests reuse YouTube's router.
    private static let playerSPAEnabled = ProcessInfo.processInfo.environment["LANGFORM_PLAYER_SPA"] != "0"
    private var loadingViaSPA = false
    private var spaStartTimeout: DispatchWorkItem?
    private var spaReadyTimeout: DispatchWorkItem?
    private var observations: [NSKeyValueObservation] = []
    /// The spring between full player and card. Core Animation runs it on the
    /// display link. An interrupted transition resumes from its displayed height.
    private var settler: UIViewPropertyAnimator?
    /// Crop corrections also use an animator, but do not change the player mode.
    private var settlingBetweenModes = false
    private var cropCorrection: PlayerViewportPolicy.SurfaceCorrection?
    private var revealer: UIViewPropertyAnimator?
    /// Closing retains the paused picture until its surface has left the stage.
    private var dismisser: UIViewPropertyAnimator?
    private let feedMotion = FeedMotion()
    private let openingMotion = WatchOpeningMotion()
    private var feedOpening: WatchFeedOpening?
    private var videoCropActive = false
    private var miniContext: UIView?
    private var miniDiagnosticCount = 0
    /// Progress when the finger went down, so a grab mid-flight does not jump.
    private var dragOrigin: CGFloat = 0
    private var dragRevealOrigin: CGFloat = 0
    private var dragCanTakeOver = false
    private struct FullscreenEntryAdmission {
        let videoID: String
        let ticket: Int
        let player: ObjectIdentifier
        let mode: Mode
    }
    private var fullscreenEntryAdmission: FullscreenEntryAdmission?
    // Revocation drops the old owner but remembers that its admitted contact
    // must not be reclassified as a mini/crop drag before that contact ends.
    private var fullscreenEntryAdmissionRevoked = false
    /// A rect the page reported while the card moved. Applied once it rests.
    private var pendingRect: CGRect?
    private var playerLayoutSize: CGSize = .zero
    private var viewportGeneration = 0
    private var awaitingViewportGeometry = false
    private var playerNavigation: WKNavigation?
    private var loadingTimeout: DispatchWorkItem?
    private var pendingTimestampURL: URL?
    private struct SummaryRequestTask {
        let id: String
        let lease: UUID
        let task: Task<Void, Never>
        func cancel() { task.cancel() }
    }
    private var summaryTasks: [ObjectIdentifier: SummaryRequestTask] = [:]
    private let downloadSourceResolver = DownloadSourceResolver()
    private var downloadSourceRequestGeneration = 0
    private var downloadSourceLoading = false
    private var downloadDeviceProbeStarted = false
    private let networkQuality = NetworkQualityMonitor()
    private var networkPolicyScript: WKUserScript?
    private static let stageInsetsScriptPrefix = "// langform-stage-insets-v1\n"
    private let stageInsetsByView = NSMapTable<WKWebView, NSValue>(keyOptions: .weakMemory, valueOptions: .strongMemory)
    private let stageMiniByView = NSMapTable<WKWebView, NSNumber>(keyOptions: .weakMemory, valueOptions: .strongMemory)
    private var stageInsetsSourceCache: (insets: UIEdgeInsets, nativeMini: Bool, source: String)?

    private var feed: WKWebView!
    private var player: WKWebView!
    private let card = PlayerCardView()
    private let collapseButton = MotionButton(type: .system)
    private let closeButton = MotionButton(type: .system)
    private let miniPlaybackButton = MotionButton(type: .system)
    private let startPlaybackButton = MotionButton(type: .system)
    private let backButton = MotionButton(type: .system)
    private let loadStatus = UIView()
    private let loadStatusRow = UIStackView()
    private let loadLabel = UILabel()
    private let retryButton = MotionButton(type: .system)
    private let dismissStatusButton = MotionButton(type: .system)
    private var drag: UIPanGestureRecognizer!
    private var cardTap: UITapGestureRecognizer!
    private var edgeBack: UIPanGestureRecognizer!
    private var edgeBackTracking = false
    private var edgeBackUsesPicture = false

    /// Height of the pivot bar at the bottom of m.youtube.com.
    static let bottomBarHeight: CGFloat = 48
    static let blankURL = URL(string: "about:blank")!

    func start() {
        guard feed == nil else { return }
        systemMedia.onCommand = { [weak self] id, action, value in self?.systemPlaybackCommand(id: id, action: action, value: value) }
        UserDefaults.standard.set(true, forKey: YouTubeWebView.safariPreferenceKey)
        backgroundColor = .black
        StartupDiagnostics.mark("stage-start")
        let home = makeFeedTab(.home, origin: YouTubeWebView.startURL)
        StartupDiagnostics.mark("feed-created")
        let feedView = home.webView
        feed = feedView
        networkQuality.onChange = { [weak self] _ in
            self?.updateNetworkPolicy()
            self?.scheduleFeedPrewarm()
        }
        networkQuality.start()
        addSubview(feedView)

        card.clipsToBounds = true
        card.layer.cornerCurve = .continuous
        card.layer.borderColor = UIColor.white.withAlphaComponent(0.16).cgColor
        card.backgroundColor = .black
        card.isHidden = true
        card.accessibilityLabel = "Video vergrößern"
        card.accessibilityTraits = .button
        card.onActivate = { [weak self] in self?.expandCard() }
        card.accessibilityCustomActions = [UIAccessibilityCustomAction(name: "Video schließen") { [weak self] _ in
            self?.closePlayer()
            return true
        }]
        addSubview(card)

        closeButton.setImage(Self.symbol("xmark", size: 13), for: .normal)
        Self.styleRound(closeButton, diameter: 44)
        closeButton.accessibilityLabel = "Schließen"
        closeButton.alpha = 0
        closeButton.addTarget(self, action: #selector(closePlayer), for: .touchUpInside)
        card.addSubview(closeButton)

        Self.styleRound(miniPlaybackButton, diameter: 44)
        miniPlaybackButton.alpha = 0
        miniPlaybackButton.addTarget(self, action: #selector(toggleMiniPlayback), for: .touchUpInside)
        card.addSubview(miniPlaybackButton)

        var startConfiguration = UIButton.Configuration.filled()
        startConfiguration.baseBackgroundColor = .white
        startConfiguration.baseForegroundColor = .black
        startConfiguration.cornerStyle = .capsule
        startConfiguration.image = Self.symbol("play.fill", size: 17)
        startConfiguration.imagePadding = 8
        startConfiguration.title = "Video starten"
        startPlaybackButton.configuration = startConfiguration
        startPlaybackButton.isHidden = true
        startPlaybackButton.addTarget(self, action: #selector(startPlaybackTapped), for: .touchUpInside)
        card.addSubview(startPlaybackButton)
        Self.styleRound(collapseButton, diameter: 44)
        collapseButton.setImage(Self.symbol("chevron.down", size: 19), for: .normal)
        collapseButton.accessibilityLabel = "Verkleinern"
        collapseButton.hapticRole = .commit
        collapseButton.alpha = 0
        collapseButton.addTarget(self, action: #selector(collapseTapped), for: .touchUpInside)
        addSubview(collapseButton)

        backButton.setImage(Self.symbol("chevron.backward", size: 15), for: .normal)
        Self.styleRound(backButton, diameter: 44)
        backButton.accessibilityLabel = "Zurück"
        backButton.isHidden = true
        backButton.addTarget(self, action: #selector(feedBack), for: .touchUpInside)
        addSubview(backButton)

        loadStatus.backgroundColor = UIColor.secondarySystemBackground
        loadStatus.layer.cornerRadius = 16
        loadStatus.isHidden = true
        addSubview(loadStatus)
        loadLabel.font = .preferredFont(forTextStyle: .footnote)
        loadLabel.adjustsFontForContentSizeCategory = true
        loadLabel.numberOfLines = 0
        loadLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        retryButton.setTitle("Erneut", for: .normal)
        retryButton.accessibilityLabel = "Video erneut laden"
        retryButton.addTarget(self, action: #selector(retryPlayer), for: .touchUpInside)
        dismissStatusButton.setImage(Self.symbol("xmark", size: 14), for: .normal)
        dismissStatusButton.accessibilityLabel = "Meldung schließen"
        dismissStatusButton.addTarget(self, action: #selector(dismissLoadStatus), for: .touchUpInside)
        loadStatusRow.axis = .horizontal
        loadStatusRow.alignment = .center
        loadStatusRow.spacing = 10
        for view in [loadLabel, retryButton, dismissStatusButton] {
            loadStatusRow.addArrangedSubview(view)
        }
        loadStatus.addSubview(loadStatusRow)
        loadStatusRow.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            loadStatusRow.leadingAnchor.constraint(equalTo: loadStatus.leadingAnchor, constant: 14),
            loadStatusRow.trailingAnchor.constraint(equalTo: loadStatus.trailingAnchor, constant: -6),
            loadStatusRow.topAnchor.constraint(equalTo: loadStatus.topAnchor, constant: 6),
            loadStatusRow.bottomAnchor.constraint(equalTo: loadStatus.bottomAnchor, constant: -6),
            dismissStatusButton.widthAnchor.constraint(equalToConstant: 44),
            dismissStatusButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            retryButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
        ])

        // A pan only begins after the finger has moved, so a tap on play never starts it.
        // It sits on the card, not on the web view: WebKit defers and fails gestures
        // inside its own view tree while the page handles the touch.
        drag = UIPanGestureRecognizer(target: self, action: #selector(dragPlayer(_:)))
        drag.cancelsTouchesInView = false
        drag.delaysTouchesBegan = false
        drag.delaysTouchesEnded = false
        drag.maximumNumberOfTouches = 1
        drag.delegate = self
        card.addGestureRecognizer(drag)

        cardTap = PlayerCardTapGestureRecognizer(target: self, action: #selector(expandCard))
        cardTap.delegate = self
        cardTap.isEnabled = false
        card.addGestureRecognizer(cardTap)
        cardTap.require(toFail: drag)

        edgeBack = UIPanGestureRecognizer(target: self, action: #selector(edgeBackDragged(_:)))
        edgeBack.maximumNumberOfTouches = 1
        // Direction and the narrow left contact band admit the native back pan.
        // Ordinary taps keep immediate delivery to the page.
        edgeBack.delaysTouchesBegan = false
        edgeBack.delaysTouchesEnded = false
        edgeBack.delegate = self
        addGestureRecognizer(edgeBack)

        NotificationCenter.default.addObserver(self, selector: #selector(releaseInactiveFeeds),
                                               name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appEnteredBackground),
                                               name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(cancelVideoProbeForInactivity),
                                               name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appBecameActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillShow),
                                               name: UIResponder.keyboardWillShowNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardDidHide),
                                               name: UIResponder.keyboardDidHideNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(motionPreferencesChanged),
                                               name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(motionPreferencesChanged),
                                               name: UIAccessibility.prefersCrossFadeTransitionsStatusDidChange, object: nil)
        if backgroundCategoryHandoff?.preservesVisibility == true {
            NotificationCenter.default.addObserver(self, selector: #selector(backgroundAudioInterruption(_:)),
                                                   name: AVAudioSession.interruptionNotification, object: nil)
            NotificationCenter.default.addObserver(self, selector: #selector(backgroundAudioRouteChanged(_:)),
                                                   name: AVAudioSession.routeChangeNotification, object: nil)
        } else if audioRouteProbe != nil {
            // A category-only comparison previously had no functional audio
            // observers. Diagnose it without introducing cancellation actions.
            NotificationCenter.default.addObserver(self, selector: #selector(audioRouteDiagnosticInterruption(_:)),
                                                   name: AVAudioSession.interruptionNotification, object: nil)
            NotificationCenter.default.addObserver(self, selector: #selector(audioRouteDiagnosticRouteChange(_:)),
                                                   name: AVAudioSession.routeChangeNotification, object: nil)
        }
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
        observesPhysicalOrientation = true
        rotationIntentPolicy.reset(orientation: physicalPlayerOrientation)
        NotificationCenter.default.addObserver(self, selector: #selector(physicalDeviceOrientationChanged),
                                               name: UIDevice.orientationDidChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(resetPhysicalRotationBaseline),
                                               name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(resetPhysicalRotationBaseline),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(playerSceneBecameInactive(_:)),
                                               name: UIScene.willDeactivateNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(playerSceneBecameActive(_:)),
                                               name: UIScene.didActivateNotification, object: nil)
        updateChrome()
        StartupDiagnostics.mark("feed-load-requested", once: true)
        home.rootNavigation = feedView.load(URLRequest(url: home.rootURL))
    }

    /// Construct on demand or during idle preparation, then keep this WebView.
    private func ensurePlayer() {
        guard player == nil else { return }
        let playerView = YouTubeWebView.makeWebView(
            relay: ScriptRelay(self),
            messages: ["langformSummary", "langformOpenFeed", "langformPlayerRoute", "langformWatchIntent", "langformPlayer", "langformNavigateFeed", "langformOverlayState", "langformFullscreen", "langformOpening", "langformSystemMedia", "langformBackgroundAudio", "langformDownloads", "langformSponsorBlock"],
            scripts: YouTubeWebView.scriptNames + YouTubeWebView.playerScriptNames
        )
        player = playerView
        playerPreparationSuspended = false
        StartupDiagnostics.mark("player-created", once: true)
        playerView.navigationDelegate = self
        playerView.uiDelegate = self
        synchronizeStageInsets(playerView)
        playerView.scrollView.panGestureRecognizer.addTarget(self, action: #selector(playerScrollInteractionBegan(_:)))
        card.insertSubview(playerView, at: 0)
        observations = [
            playerView.observe(\.url, options: [.new]) { [weak self, weak playerView] _, _ in
                DispatchQueue.main.async {
                    guard let self, let playerView, self.player === playerView else { return }
                    self.playerMoved()
                }
            },
        ]
        updateNetworkPolicy()
        setNeedsLayout()
        layoutIfNeeded()
        updateChrome()
    }

    private func systemPlaybackCommand(id: String, action: String, value: Double? = nil) {
        guard !systemMediaSuspendedForOffline, mode == .expanded || mode == .mini, let player,
              YouTubeWebView.videoID(player.url) == id,
              let script = SystemMediaSnapshot.commandJavaScript(videoID: id, command: action, value: value) else { return }
        if ["play", "pause", "toggle"].contains(action) { watchBackgroundCategoryTransition("interrupt") }
        player.evaluateJavaScript(script)
    }

    @objc func requestDownloads() {
        cancelDownloadSourceRequest()
        let generation = downloadSourceRequestGeneration
        let offlinePlayback: (Bool) -> Void = { [weak self] active in
            guard let self else { return }
            self.systemMediaSuspendedForOffline = active
            if active {
                self.watchBackgroundCategoryTransition("cancel")
                self.systemMedia.clear()
                self.player?.pauseAllMediaPlayback(completionHandler: nil)
            } else if self.mode == .expanded || self.mode == .mini {
                self.player?.evaluateJavaScript("window.__langformPublishSystemMedia && window.__langformPublishSystemMedia()")
            }
        }
        guard mode == .expanded || mode == .mini, let player,
              let id = YouTubeWebView.videoID(player.url) else {
            onDownloads?(nil, "Öffne ein Video, um seine Downloadquelle zu prüfen.", offlinePlayback)
            return
        }
        let ticket = loadTicket
        setDownloadSourceLoading(true)
        player.evaluateJavaScript("window.__langformDownloadSource ? window.__langformDownloadSource() : ({reason:'missing-source'})") { [weak self, weak player] result, error in
            guard let self, self.downloadSourceRequestGeneration == generation else { return }
            guard let player, self.player === player, self.loadTicket == ticket, self.mode == .expanded || self.mode == .mini,
                  YouTubeWebView.videoID(player.url) == id else {
                self.setDownloadSourceLoading(false)
                self.onDownloads?(nil, "Das aktuelle Video hat gewechselt. Öffne Downloads erneut.", offlinePlayback)
                return
            }
            do {
                guard error == nil, let body = result as? [String: Any] else {
                    throw DownloadSourceError.unsupported("Die Downloadquelle konnte gerade nicht geprüft werden. Versuche es erneut.")
                }
                self.downloadSourceResolver.resolve(body, expectedVideoID: id) { [weak self, weak player] resolution in
                    guard let self, self.downloadSourceRequestGeneration == generation else { return }
                    self.setDownloadSourceLoading(false)
                    guard let player, self.player === player, self.loadTicket == ticket,
                          self.mode == .expanded || self.mode == .mini, YouTubeWebView.videoID(player.url) == id else {
                        self.onDownloads?(nil, "Das aktuelle Video hat gewechselt. Öffne Downloads erneut.", offlinePlayback)
                        return
                    }
                    switch resolution {
                    case .success(let source): self.onDownloads?(source, nil, offlinePlayback)
                    case .failure(let error): self.onDownloads?(nil, error.localizedDescription, offlinePlayback)
                    }
                }
            } catch {
                self.setDownloadSourceLoading(false)
                self.onDownloads?(nil, error.localizedDescription, offlinePlayback)
            }
        }
    }

    private func setDownloadSourceLoading(_ loading: Bool) {
        downloadSourceLoading = loading
        player?.evaluateJavaScript("window.__langformSetDownloadLoading && window.__langformSetDownloadLoading(\(loading ? "true" : "false"))")
    }

    private func cancelDownloadSourceRequest() {
        // Invalidate before cancel(), whose completion may run synchronously.
        downloadSourceRequestGeneration += 1
        downloadSourceResolver.cancel()
        setDownloadSourceLoading(false)
    }

    func reload() {
        cancelFeedPrewarm()
        guard let state = feedTabs[activeFeedTab] else { return }
        state.refresh?.cancel()
        feedFailed = false
        state.needsReload = false
        state.rootNavigation = nil
        feed.load(URLRequest(url: feed.url ?? state.rootURL))
        report(unreachable: false, from: feed)
    }

    func stop() {
        watchBackgroundCategoryTransition("cancel")
        recordBackgroundPlaybackTransition("cancel")
        sponsorBlock.cancel()
        clearWatchAudioIntent()
        sponsorBlockRequest = nil
        cancelDownloadSourceRequest()
        systemMedia.clear()
        systemMedia.onCommand = nil
        onDownloads = nil
        discardFeedOpening()
        cancelPendingFeedSearch()
        resetCustomFullscreen()
        feedMotion.finish()
        openingMotion.cancel()
        if dismisser != nil { finishClose() }
        cancelVideoProbe()
        videoLoadDiagnostics.finish(.cancelled)
        networkQuality.stop()
        networkPolicyScript = nil
        missingMediaTimeout?.cancel()
        missingMediaTimeout = nil
        endDrag()
        cancelFeedPrewarm()
        loadingTimeout?.cancel()
        cancelSPAWaits()
        revokeFullscreenEntryAdmission()
        loadTicket += 1
        settler?.stopAnimation(true)
        revealer?.stopAnimation(true)
        settler = nil
        settlingBetweenModes = false
        revealer = nil
        mode = .closed
        rotationIntentPolicy.reset(orientation: physicalPlayerOrientation)
        if observesPhysicalOrientation {
            UIDevice.current.endGeneratingDeviceOrientationNotifications()
            observesPhysicalOrientation = false
        }
        NotificationCenter.default.removeObserver(self, name: UIDevice.orientationDidChangeNotification, object: nil)
        NotificationCenter.default.removeObserver(self, name: UIScene.willDeactivateNotification, object: nil)
        NotificationCenter.default.removeObserver(self, name: UIScene.didActivateNotification, object: nil)
        NotificationCenter.default.removeObserver(self, name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
        NotificationCenter.default.removeObserver(self, name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.removeObserver(self, name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.removeObserver(self, name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.removeObserver(self, name: UIResponder.keyboardWillShowNotification, object: nil)
        NotificationCenter.default.removeObserver(self, name: UIResponder.keyboardDidHideNotification, object: nil)
        NotificationCenter.default.removeObserver(self, name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
        NotificationCenter.default.removeObserver(self, name: UIAccessibility.prefersCrossFadeTransitionsStatusDidChange, object: nil)
        observations.removeAll()
        summaryTasks.values.forEach { $0.cancel() }
        summaryTasks.removeAll()
        let webViews = feedTabs.values.map(\.webView) + [player].compactMap({ $0 })
        for state in feedTabs.values {
            state.refresh?.detach()
            state.observations.removeAll()
        }
        for webView in webViews {
            webView.scrollView.panGestureRecognizer.removeTarget(self, action: #selector(feedInteractionBegan(_:)))
            webView.scrollView.panGestureRecognizer.removeTarget(self, action: #selector(playerScrollInteractionBegan(_:)))
            webView.stopLoading()
            webView.navigationDelegate = nil
            webView.uiDelegate = nil
            webView.configuration.userContentController.removeAllScriptMessageHandlers()
        }
        feedTabs.removeAll()
        feed = nil
        player = nil
        onUnreachable = nil
        onFullscreen = nil
    }

    // MARK: Network hints

    private func updateNetworkPolicy() {
        guard let player else { return }
        let json = networkQuality.policy?.json ?? "null"
        let source = "window.__langformSetNetworkPolicy && window.__langformSetNetworkPolicy(\(json));"
        // Keep a fresh snapshot for the next document without accumulating one
        // user script per path change or rebuilding the cached application code.
        let controller = player.configuration.userContentController
        let retained = controller.userScripts.filter { $0 !== networkPolicyScript }
        let snapshot = WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page)
        controller.removeAllUserScripts()
        retained.forEach { controller.addUserScript($0) }
        controller.addUserScript(snapshot)
        networkPolicyScript = snapshot
        player.evaluateJavaScript(source, in: nil, in: .page)
    }

    private func sendNetworkPolicyToCurrentDocument() {
        guard let player else { return }
        let json = networkQuality.policy?.json ?? "null"
        player.evaluateJavaScript("window.__langformSetNetworkPolicy && window.__langformSetNetworkPolicy(\(json));", in: nil, in: .page)
    }

    /// The stage owns this viewport. A transformed/clipped WK child reports a
    /// different env(safe-area-inset-top), even though its bounds stay full size.
    @discardableResult
    private func synchronizeStageInsets(_ webView: WKWebView, forceDocument: Bool = false) -> Bool {
        guard bounds.width > 0, bounds.height > 0 else { return false }
        let insets = safeAreaInsets
        let nativeMini = webView === player && (videoCropActive || mode == .mini)
        let changed = stageInsetsByView.object(forKey: webView)?.uiEdgeInsetsValue != insets
            || stageMiniByView.object(forKey: webView)?.boolValue != nativeMini
        guard changed || forceDocument else { return false }
        if stageInsetsSourceCache?.insets != insets || stageInsetsSourceCache?.nativeMini != nativeMini {
            let source = Self.stageInsetsScriptPrefix
                + "window.__langformStageInsets = {top:\(insets.top),right:\(insets.right),bottom:\(insets.bottom),left:\(insets.left),nativeMini:\(nativeMini)};"
                + "window.__langformSetStageInsets && window.__langformSetStageInsets(window.__langformStageInsets);"
            stageInsetsSourceCache = (insets, nativeMini, source)
        }
        guard let source = stageInsetsSourceCache?.source else { return false }
        if changed {
            let controller = webView.configuration.userContentController
            let retained = controller.userScripts.filter { !$0.source.hasPrefix(Self.stageInsetsScriptPrefix) }
            let bootstrap = WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page)
            controller.removeAllUserScripts()
            // Native values exist before ViewportLayout configures parsed nodes.
            controller.addUserScript(bootstrap)
            retained.forEach { controller.addUserScript($0) }
            stageInsetsByView.setObject(NSValue(uiEdgeInsets: insets), forKey: webView)
            stageMiniByView.setObject(NSNumber(value: nativeMini), forKey: webView)
        }
        if changed || forceDocument { webView.evaluateJavaScript(source, in: nil, in: .page) }
        return changed
    }

    // MARK: Feed tabs

    private func makeFeedTab(_ tab: FeedTab, origin: URL?) -> FeedState {
        let webView = YouTubeWebView.makeWebView(
            relay: ScriptRelay(self),
            messages: ["langformSummary", "langformOpenWatch", "langformNavigateFeed", "langformOverlayState", "langformFeedReady", "langformFeedSearch", "langformNativeSearch", "langformOpening", "langformDownloads"],
            scripts: YouTubeWebView.scriptNames,
            isFeed: true
        )
        webView.navigationDelegate = self
        webView.uiDelegate = self
        synchronizeStageInsets(webView)
        webView.scrollView.scrollsToTop = false
        webView.scrollView.panGestureRecognizer.addTarget(self, action: #selector(feedInteractionBegan(_:)))
        let state = FeedState(webView: webView, rootURL: tab.rootURL(for: origin))
        state.refresh = FeedRefresh(scrollView: webView.scrollView, contentView: webView, canRefresh: { [weak self, weak webView, weak state] in
            guard let self, let webView, let state else { return false }
            return self.feed === webView && FeedTab(url: webView.url) != nil
                && self.mode != .expanded && !state.overlayOpen
        }, onRefresh: { [weak self, weak webView, weak state] in
            guard let self, let webView, let state, self.feed === webView else { return nil }
            self.cancelFeedPrewarm()
            state.failed = false
            state.needsReload = false
            state.rootNavigation = nil
            let navigation = webView.reload()
            state.navigation = navigation
            self.report(unreachable: false, from: webView)
            return navigation
        })
        state.observations = [
            webView.observe(\.canGoBack, options: [.new]) { [weak self, weak webView] _, _ in
                DispatchQueue.main.async {
                    guard let self, let webView, self.feed === webView else { return }
                    self.updateChrome()
                }
            },
            webView.observe(\.url, options: [.new]) { [weak self, weak webView] _, _ in
                DispatchQueue.main.async {
                    guard let self, let webView, self.feed === webView else { return }
                    self.feedMoved()
                }
            },
        ]
        feedTabs[tab] = state
        return state
    }

    private func feedState(for webView: WKWebView) -> FeedState? {
        feedTabs.values.first { $0.webView === webView }
    }

    private func feedTabIsContentReady(_ tab: FeedTab) -> Bool {
        guard let state = feedTabs[tab] else { return false }
        return !state.needsReload && !state.accountStale && state.rootNavigation == nil && state.contentReady &&
            state.webView.url?.host == state.rootURL.host && state.webView.url?.path == state.rootURL.path
    }

    /// Switch the existing page into place. Its scroll position and DOM survive.
    /// Only a first visit, a lost web process, or a missing root history entry loads.
    private func activateFeedTab(_ tab: FeedTab, origin: URL?) {
        cancelPendingFeedSearch()
        cancelFeedPrewarm(keeping: tab)
        if tab == .subscriptions || tab == .you {
            StartupDiagnostics.mark(feedTabIsContentReady(tab)
                ? (tab == .you ? "you-selected-cached" : "subscriptions-selected-cached")
                : (tab == .you ? "you-selected-loading" : "subscriptions-selected-loading"))
        }
        let state = feedTabs[tab] ?? makeFeedTab(tab, origin: origin)
        let next = state.webView
        if next !== feed {
            let direction: CGFloat = tab.position > activeFeedTab.position ? 1 : -1
            openingMotion.cancel()
            if let previous = feed {
                feedMotion.capture(previous)
                previous.isHidden = true
                previous.accessibilityElementsHidden = true
                previous.scrollView.scrollsToTop = false
                setFeedActivity(previous, active: false)
            }
            activeFeedTab = tab
            feed = next
            next.frame = bounds
            next.isHidden = false
            // During a new video's load the feed must remain in front of its
            // unfinished player; the mini or expanded player otherwise stays above it.
            if mode == .loading || mode == .closed {
                insertSubview(next, aboveSubview: card)
            } else {
                insertSubview(next, belowSubview: card)
            }
            setFeedActivity(next, active: true)
            feedMotion.reveal(next, direction: direction)
        }
        restoreFeedRoot(state, tab: tab)
        updateChrome()
        report(unreachable: state.failed, from: next)
        setNeedsLayout()
        scheduleFeedPrewarm()
    }

    private func restoreFeedRoot(_ state: FeedState, tab: FeedTab) {
        let webView = state.webView
        guard state.rootNavigation == nil else { return }
        if !state.needsReload, !state.accountStale, FeedTab(url: webView.url) == tab { return }
        state.failed = false
        if !state.needsReload, !state.accountStale {
            let history = webView.backForwardList
            if let item = history.backList.reversed().first(where: { FeedTab(url: $0.url) == tab })
                ?? history.forwardList.first(where: { FeedTab(url: $0.url) == tab }) {
                state.rootNavigation = webView.go(to: item)
                return
            }
        }
        state.needsReload = false
        state.accountStale = false
        state.rootNavigation = webView.load(URLRequest(url: state.rootURL))
    }

    private func setFeedActivity(_ webView: WKWebView, active: Bool) {
        guard let state = feedState(for: webView) else { return }
        if !active { state.refresh?.cancel() }
        // Feed navigation and scanning remain available under the miniplayer,
        // but preview videos must not run a second decoder beside the player.
        let mediaSuspended = !active || mode != .closed || dismisser != nil
        if state.mediaSuspended != mediaSuspended {
            state.mediaSuspended = mediaSuspended
            webView.setAllMediaPlaybackSuspended(mediaSuspended, completionHandler: nil)
            if mediaSuspended {
                webView.evaluateJavaScript("window.__langformDiscardPlayables && window.__langformDiscardPlayables();")
            }
        }
        // A newly uncovered feed can have queued DOM work. Keep that work out
        // of the player's drag/spring; reactivate it when the card comes to rest.
        let effectiveActive = active && mode != .expanded && mode != .loading && !cardMoving
        guard state.active != effectiveActive else { return }
        state.active = effectiveActive
        // The separate player never receives the feed's activity flag.
        let flag = effectiveActive ? "true" : "false"
        webView.evaluateJavaScript("window.__langformFeedActive = \(flag); window.dispatchEvent(new Event('langform-feed-visibility'));")
    }

    @objc private func releaseInactiveFeeds() {
        backgroundPreparationDisabled = true
        if dismisser != nil { finishClose() }
        cancelFeedPrewarm(discardLoading: true)
        if mode == .closed, let player {
            playerWarmupNavigation = nil
            observations.removeAll()
            player.scrollView.panGestureRecognizer.removeTarget(self, action: #selector(playerScrollInteractionBegan(_:)))
            player.stopLoading()
            player.configuration.userContentController.removeAllScriptMessageHandlers()
            player.removeFromSuperview()
            self.player = nil
            networkPolicyScript = nil
            card.isHidden = true
        }
        for tab in Array(feedTabs.keys) where tab != activeFeedTab {
            evictFeedTab(tab)
        }
    }

    private func evictFeedTab(_ tab: FeedTab) {
        guard tab != activeFeedTab, let state = feedTabs.removeValue(forKey: tab) else { return }
        state.refresh?.detach()
        let webView = state.webView
        state.observations.removeAll()
        summaryTasks.removeValue(forKey: ObjectIdentifier(webView))?.cancel()
        webView.stopLoading()
        webView.scrollView.panGestureRecognizer.removeTarget(self, action: #selector(feedInteractionBegan(_:)))
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.configuration.userContentController.removeAllScriptMessageHandlers()
        webView.removeFromSuperview()
    }

    private func evictCachedFeedsForAccountChange() {
        cancelPendingFeedSearch()
        nativeSearchRecent.removeAll()
        cancelFeedPrewarm(discardLoading: true)
        // Cookies stay in the shared WebKit store. Drop only retained account
        // pages, so a subsequent tab selection cannot reveal an old account's
        // history, playlists or back-forward cached root after sign-out.
        for state in feedTabs.values { state.accountStale = true }
        for tab in Array(feedTabs.keys) where tab != activeFeedTab { evictFeedTab(tab) }
    }

    /// Prepare Mein YouTube first, then Abos and the player shell without opening
    /// a video. User input postpones construction, but never throws away a tab
    /// download just because the user scrolls. Explicit video loads take priority.
    private func scheduleFeedPrewarm() {
        guard feedPrewarm == nil, prewarmingTab == nil, !backgroundPreparationDisabled, let feed,
              mode != .loading, (mode == .closed || videoPlaying), !cardMoving,
              !keyboardVisible, !feedFailed,
              feedTabs[activeFeedTab]?.overlayOpen == false,
              FeedTab(url: feed.url) != nil,
              feedTabs[.you] == nil || feedTabs[.subscriptions] == nil || (mode == .closed && !playerWarmupAttempted) else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.feedPrewarm = nil
            guard self.prewarmingTab == nil, !self.backgroundPreparationDisabled, let feed = self.feed,
                  self.mode != .loading, (self.mode == .closed || self.videoPlaying), !self.cardMoving,
                  !self.keyboardVisible, !self.feedFailed,
                  !feed.isLoading || self.feedTabs[self.activeFeedTab]?.contentReady == true,
                  self.feedTabs[self.activeFeedTab]?.overlayOpen == false,
                  FeedTab(url: feed.url) != nil,
                  UIApplication.shared.applicationState == .active,
                  !ProcessInfo.processInfo.isLowPowerModeEnabled,
                  ProcessInfo.processInfo.thermalState == .nominal,
                  self.networkQuality.policy?.online != false,
                  self.networkQuality.policy?.constrained != true else { return }
            if feed.scrollView.isTracking || feed.scrollView.isDragging || feed.scrollView.isDecelerating {
                self.scheduleFeedPrewarm()
                return
            }
            if let tab = [FeedTab.you, .subscriptions].first(where: { self.feedTabs[$0] == nil }) {
                let state = self.makeFeedTab(tab, origin: feed.url)
                state.webView.frame = self.bounds
                state.webView.isHidden = false
                state.webView.accessibilityElementsHidden = true
                self.insertSubview(state.webView, belowSubview: feed)
                self.setFeedActivity(state.webView, active: false)
                self.prewarmingTab = tab
                StartupDiagnostics.mark(tab == .you ? "you-preload-started" : "subscriptions-preload-started")
                state.rootNavigation = state.webView.load(URLRequest(url: state.rootURL))
            } else if self.mode == .closed, self.prewarmingTab == nil, !self.playerWarmupAttempted {
                self.playerWarmupAttempted = true
                self.ensurePlayer()
                self.player.isUserInteractionEnabled = false
                self.suspendPreparedPlayer()
                self.card.isHidden = false
                self.insertSubview(self.card, belowSubview: feed)
                StartupDiagnostics.mark("player-preload-started")
                self.playerWarmupNavigation = self.player.load(URLRequest(url: YouTubeWebView.homeURL(for: feed.url)))
                self.playerNavigation = self.playerWarmupNavigation
            }
        }
        feedPrewarm = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: work)
    }

    private func cancelFeedPrewarm(keeping selectedTab: FeedTab? = nil, discardLoading: Bool = false) {
        feedPrewarm?.cancel()
        feedPrewarm = nil
        if let tab = prewarmingTab {
            if tab == selectedTab || tab == activeFeedTab {
                prewarmingTab = nil
            } else if discardLoading {
                if feedTabs[tab]?.webView.isLoading == true { evictFeedTab(tab) }
                prewarmingTab = nil
            }
        }
    }

    @objc private func feedInteractionBegan(_ pan: UIPanGestureRecognizer) {
        if pan.state == .began { feedMotion.finish(); openingMotion.cancel(); cancelVideoProbe(); cancelFeedPrewarm() }
        if pan.state == .ended || pan.state == .cancelled { scheduleFeedPrewarm() }
    }

    @objc private func playerScrollInteractionBegan(_ pan: UIPanGestureRecognizer) {
        guard mode == .expanded, let player,
              pan === player.scrollView.panGestureRecognizer, pan.state == .began else { return }
        // The loading picture belongs to the video region. A real page scroll
        // must not leave that stationary copy covering comments or description.
        cancelPendingMinimize()
        openingMotion.cancel()
    }

    @objc private func appEnteredBackground() {
        revokeFullscreenEntryAdmission()
        watchBackgroundCategoryTransition("did-enter-background")
        recordBackgroundPlaybackTransition("did-enter-background")
        clearWatchAudioIntent()
        cancelPendingMinimize()
        discardFeedOpening()
        cancelNativeRotation()
        finishMiniContext()
        // A retained feed may contain an independently running game iframe.
        // Suspend native previews and discard game documents, not only audio.
        for state in feedTabs.values {
            // WebKit counts suspension holds. An inactive tab already owns
            // one, so repeated background notifications must not acquire more.
            if state.mediaSuspended != true {
                state.mediaSuspended = true
                state.webView.setAllMediaPlaybackSuspended(true, completionHandler: nil)
            }
            if state.active != false {
                state.active = false
                state.webView.evaluateJavaScript("window.__langformFeedActive = false; window.dispatchEvent(new Event('langform-feed-visibility'));")
            }
            state.webView.evaluateJavaScript("window.__langformDiscardPlayables && window.__langformDiscardPlayables();")
        }
        player?.evaluateJavaScript("window.__langformDiscardPlayables && window.__langformDiscardPlayables();")
        cancelPendingFeedSearch()
        feedMotion.finish()
        openingMotion.cancel()
        if dismisser != nil { finishClose() }
        cancelVideoProbe()
        cancelFeedPrewarm(discardLoading: true)
        if mode == .closed, playerWarmupNavigation != nil {
            player?.stopLoading()
            playerWarmupNavigation = nil
            playerWarmupAttempted = false
        }
        missingMediaTimeout?.cancel()
        missingMediaTimeout = nil
    }

    @objc private func cancelVideoProbeForInactivity() {
        revokeFullscreenEntryAdmission()
        watchBackgroundCategoryTransition("will-resign-active")
        recordBackgroundPlaybackTransition("will-resign-active")
        cancelNativeRotation()
        initialPlaybackIntent = nil
        initialPlaybackCheckTicket = nil
        clearWatchAudioIntent()
        cancelVideoProbe()
    }

    @objc private func appBecameActive() {
        motionPreferencesChanged()
        watchBackgroundCategoryTransition("foreground")
        recordBackgroundPlaybackTransition("did-become-active")
        StartupDiagnostics.mark("app-active")
        for state in feedTabs.values { setFeedActivity(state.webView, active: state.webView === feed) }
        updateMissingMediaTimeout()
        scheduleFeedPrewarm()
        confirmCustomFullscreenEnter()
        resumeFullscreenExitAfterInactivity()
        confirmCustomFullscreenExit()
    }

    @objc private func keyboardWillShow() {
        keyboardVisible = true
        cancelFeedPrewarm()
    }

    @objc private func keyboardDidHide() {
        keyboardVisible = false
        scheduleFeedPrewarm()
    }

    @objc private func motionPreferencesChanged() {
        for webView in feedTabs.values.map(\.webView) + [player].compactMap({ $0 }) {
            (webView as? LangformWebView)?.synchronizeMotionPreferences()
        }
        reduceMotionChanged()
    }

    @objc private func reduceMotionChanged() {
        guard UIAccessibility.isReduceMotionEnabled else { return }
        feedMotion.finish()
        openingMotion.reduceMotionChanged()
        if dismisser != nil { finishClose() }
        // A finger keeps direct control; only autonomous motion settles now.
        if !dragging, cardMoving, mode == .mini || mode == .expanded { settle(mode) }
    }

    // MARK: Layout

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        setNeedsLayout()
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        // A dissolve must never leave a new feed tappable under an old picture.
        // End the decorative cover before UIKit dispatches this next touch.
        if event?.type == .touches {
            feedMotion.finish()
            feedState(for: feed)?.refresh?.releaseCoverForInteraction()
        }
        return super.hitTest(point, with: event)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        for state in feedTabs.values { synchronizeStageInsets(state.webView) }
        let playerInsetsChanged = player.map { synchronizeStageInsets($0) } ?? false
        if bounds.width > 0 && bounds.height > 0 { StartupDiagnostics.mark("native-layout", once: true) }
        guard let feed else { return }
        if feed.frame != bounds {
            feedMotion.finish()
            if !(mode == .expanded && startupStatus.keepsStartupPoster && playerLayoutSize != bounds.size) {
                openingMotion.cancel()
            }
            feed.frame = bounds
        }
        if let player {
            let viewport = fullscreenPlayerViewport(default: bounds.size)
            let sizeChanged = viewport.width > 0 && viewport.height > 0 && playerLayoutSize != viewport
            if sizeChanged {
                playerLayoutSize = viewport
                resetPlayerForViewportChange()
            }
            // The player view keeps the full size in every mode. The page never
            // relayouts for the card; only the layer is scaled and cropped.
            let playerBounds = CGRect(origin: .zero, size: viewport)
            if sizeChanged {
                UIView.performWithoutAnimation {
                    player.bounds = playerBounds
                    apply(progress)
                }
                updateChrome()
                // WebKit may not have processed its resize yet. That measurement is
                // harmlessly ignored until the report carries the new viewport size.
                measureVideo(after: 0) {}
            } else {
                if player.bounds != playerBounds { player.bounds = playerBounds }
                if !dragging { apply(progress) }
                if playerInsetsChanged { measureVideo(after: 0) {} }
            }
            confirmCustomFullscreenEnter()
            confirmCustomFullscreenExit()
        }
        collapseButton.frame = CGRect(x: safeAreaInsets.left + 10, y: safeAreaInsets.top + 2, width: 44, height: 44)
        backButton.frame = CGRect(x: safeAreaInsets.left + 12, y: bounds.height - safeAreaInsets.bottom - 68 - 44, width: 44, height: 44)
        guard !loadStatus.isHidden else { return }
        let statusWidth = min(420, max(0, bounds.width - 24))
        let statusSize = loadStatus.systemLayoutSizeFitting(
            CGSize(width: statusWidth, height: UIView.layoutFittingCompressedSize.height),
            withHorizontalFittingPriority: .required,
            verticalFittingPriority: .fittingSizeLevel
        )
        loadStatus.frame = CGRect(x: (bounds.width - statusWidth) / 2,
                                  y: bounds.height - safeAreaInsets.bottom - Self.bottomBarHeight - statusSize.height - 12,
                                  width: statusWidth, height: statusSize.height)
    }

    private func resetPlayerForViewportChange() {
        cancelPendingMinimize()
        discardFeedOpening()
        viewportGeneration += 1
        finishMiniContext()
        videoCropActive = mode == .mini
        if dismisser != nil { finishClose() }
        // Do not derive progress from a presentation layer measured in the old
        // bounds. Stop native motion and preserve the selected resting mode.
        let animator = settler
        settler = nil
        settlingBetweenModes = false
        cropCorrection = nil
        animator?.stopAnimation(true)
        stopReveal(preservingStartupPoster: mode == .expanded && startupStatus.keepsStartupPoster)
        endDrag()
        // Reset recognizers after clearing tracking flags, so their cancelled
        // callbacks cannot settle to a target calculated before the rotation.
        drag.isEnabled = false
        edgeBack.isEnabled = false
        drag.isEnabled = true
        edgeBack.isEnabled = true
        cardTap.isEnabled = false
        cardTap.isEnabled = mode == .mini
        player.isUserInteractionEnabled = mode != .mini
        progress = PlayerViewportPolicy.restingProgress(position: dragPosition)
        pendingRect = nil
        // Retain the confirmed mini crop until a matching new viewport report.
        // A guessed y=0 would expose the mobile header during WebKit's resize.
        if mode != .mini { videoRect = .zero }
        awaitingViewportGeometry = true
    }

    private var hasVideoRect: Bool {
        videoRect.width > 8 && videoRect.height > 8
    }

    private var ownsWatchPlayer: Bool {
        guard let id = YouTubeWebView.videoID(player?.url), !id.isEmpty else { return false }
        return startupVideoID == id
    }

    private func rememberVideoSeekGeometry(_ rect: CGRect, videoID: String, playerVideoID: String?, hasVideo: Bool, viewport: CGSize,
                                           seekRect: CGRect? = nil, allowDisjointSeek: Bool = false) {
        guard let player, customFullscreenEnter == nil, customFullscreenExit == nil,
              PlayerViewportPolicy.matches(reported: viewport, current: player.bounds.size) else { return }
        guard hasVideo, playerVideoID == videoID, YouTubeWebView.videoID(player.url) == videoID,
              rect.minX.isFinite, rect.minY.isFinite, rect.width.isFinite, rect.height.isFinite,
              rect.width > 8, rect.height > 8 else {
            videoSeekGeometry = nil
            return
        }
        var seek = rect
        if let area = seekRect, area.minX.isFinite, area.minY.isFinite, area.width.isFinite, area.height.isFinite,
           area.width > 8, area.height > 8, CGRect(origin: .zero, size: viewport).contains(area),
           allowDisjointSeek || area.intersects(rect) {
            seek = area
        }
        videoSeekGeometry = (rect, seek, videoID, loadTicket, viewportGeneration)
    }

    /// In a settled Watch, even a left-edge picture contact belongs to the
    /// horizontal JS seek. Retained geometry from an earlier video cannot claim it.
    private func videoSeekOwnsEdgeContact(_ contact: CGPoint) -> Bool {
        guard mode == .expanded, feedOpening == nil, !cardMoving, !awaitingViewportGeometry,
              !playerOverlayOpen, !playerFullscreen, customFullscreenID == nil,
              customFullscreenEnter == nil, customFullscreenExit == nil,
              ownsWatchPlayer, hasVideoRect, let player, let geometry = videoSeekGeometry,
              geometry.videoID == YouTubeWebView.videoID(player.url), geometry.ticket == loadTicket,
              geometry.viewport == viewportGeneration, geometry.rect == videoRect,
              contact.x.isFinite, contact.y.isFinite else { return false }
        let picture = player.convert(geometry.seek, to: self)
        guard picture.minX.isFinite, picture.minY.isFinite, picture.maxX.isFinite, picture.maxY.isFinite else { return false }
        let visible = picture.intersection(CGRect(origin: .zero, size: bounds.size))
        return !visible.isNull && visible.width > 8 && visible.height > 8 && visible.contains(contact)
    }

    /// The video picture in the player view. Without a reported rect it is the
    /// top 16:9 of the view, where m.youtube.com puts the player, so the card
    /// never crops to nothing.
    private var pictureRect: CGRect {
        if hasVideoRect { return videoRect }
        return PlayerViewportPolicy.fallbackPicture(in: bounds.size)
    }

    private func miniFrame() -> CGRect {
        let picture = pictureRect
        let aspect = picture.width > 0 ? picture.height / picture.width : 9.0 / 16.0
        var width = min(bounds.width * 0.48, 230)
        var height = width * aspect
        if height > 160 {
            height = 160
            width = height / aspect
        }
        let bottom = bounds.height - safeAreaInsets.bottom - Self.bottomBarHeight - 10
        // Keep44pt controls inside unusually wide/narrow pictures without
        // exposing the surrounding WebKit page through a letterboxed crop.
        // Preserve the picture ratio and never grow beyond the safe viewport.
        let requiredScale = max(1, 44 / max(1, min(width, height)))
        let availableWidth = max(1, bounds.width - safeAreaInsets.left - safeAreaInsets.right - 20)
        let availableHeight = max(1, bottom - safeAreaInsets.top - 10)
        let growth = max(1, min(requiredScale, min(availableWidth / width, availableHeight / height)))
        width *= growth
        height *= growth
        return CGRect(x: bounds.width - safeAreaInsets.right - width - 10, y: bottom - height, width: width, height: height)
    }

    private static func mix(_ a: CGRect, _ b: CGRect, _ t: CGFloat) -> CGRect {
        CGRect(
            x: a.minX + (b.minX - a.minX) * t,
            y: a.minY + (b.minY - a.minY) * t,
            width: a.width + (b.width - a.width) * t,
            height: a.height + (b.height - a.height) * t
        )
    }

    /// Moves the card and scales the player view so the video picture lands on the card.
    private func apply(_ t: CGFloat) {
        guard let player else { return }
        if mode == .closed || mode == .loading { cropCorrection = nil }
        if applyFullscreenSurface(t) { return }
        let full = bounds
        guard full.width > 0, full.height > 0 else { return }
        let source = pictureRect
        let target = miniFrame()
        let geometry = PlayerViewportPolicy.surfaceGeometry(viewport: full, picture: source,
            mini: target, progress: t, videoOnly: videoCropActive || mode == .mini,
            correction: cropCorrection)
        let box = geometry.frame
        let scale = geometry.scale
        card.bounds = CGRect(origin: .zero, size: box.size)
        card.center = CGPoint(x: box.midX, y: box.midY)
        let origin = geometry.origin
        player.transform = CGAffineTransform(scaleX: scale, y: scale)
        player.center = CGPoint(x: origin.x + scale * full.width / 2, y: origin.y + scale * full.height / 2)
        card.layer.cornerRadius = 10 * t
        card.layer.borderWidth = min(1, max(0, t))
        let controls = PlayerViewportPolicy.miniControls(in: box.size, target: target.size, progress: t, correction: cropCorrection)
        closeButton.frame = controls.close
        miniPlaybackButton.frame = controls.playback
        let offStage = mode == .closed || mode == .loading
        // Use the same interpolation during direct dragging and the spring, so
        // grabbing a moving card does not abruptly change the buttons' opacity.
        let chromeProgress = min(1, max(0, t))
        closeButton.alpha = offStage ? 0 : chromeProgress
        miniPlaybackButton.alpha = offStage ? 0 : chromeProgress
        collapseButton.alpha = offStage ? (feedOpening != nil ? 1 : 0) : 1 - chromeProgress
        updatePlaybackControls()
    }

    private func finishMiniContext() {
        miniContext?.layer.removeAllAnimations()
        miniContext?.removeFromSuperview()
        miniContext = nil
    }

    private func beginVideoCrop() {
        guard !videoCropActive, ownsWatchPlayer, hasVideoRect, let player else { return }
        finishMiniContext()
        // Keep the surrounding page at its original size for a short dissolve.
        // The mask excludes the video, so there is never a second video image.
        if mode == .expanded, window != nil, !UIAccessibility.isReduceMotionEnabled,
           let snapshot = player.snapshotView(afterScreenUpdates: false) {
            snapshot.frame = bounds
            snapshot.isUserInteractionEnabled = false
            snapshot.accessibilityElementsHidden = true
            let path = UIBezierPath(rect: bounds)
            path.append(UIBezierPath(rect: player.convert(pictureRect, to: self)))
            let mask = CAShapeLayer()
            mask.path = path.cgPath
            mask.fillRule = .evenOdd
            snapshot.layer.mask = mask
            insertSubview(snapshot, belowSubview: card)
            miniContext = snapshot
            UIView.animate(withDuration: 0.16, delay: 0,
                           options: [.beginFromCurrentState, .allowUserInteraction]) {
                snapshot.alpha = 0
            } completion: { [weak self, weak snapshot] _ in
                guard let self, self.miniContext === snapshot else { return }
                self.finishMiniContext()
            }
        }
        videoCropActive = true
        synchronizeStageInsets(player)
        UIView.performWithoutAnimation { apply(progress) }
    }

    private func restoreExpandedSurface() {
        guard mode == .expanded, progress < 0.001 else { return }
        cropCorrection = nil
        videoCropActive = false
        if let player { synchronizeStageInsets(player) }
        UIView.performWithoutAnimation { apply(0) }
        finishMiniContext()
    }

    private func recordMiniSurface() {
        guard StartupDiagnostics.enabled, miniDiagnosticCount < 12,
              mode == .mini, !cardMoving, hasVideoRect, let player else { return }
        miniDiagnosticCount += 1
        let visible = card.convert(card.bounds, to: player)
        let onlyPicture = abs(visible.minX - pictureRect.minX) < 1
            && abs(visible.minY - pictureRect.minY) < 1
            && abs(visible.width - pictureRect.width) < 1
            && abs(visible.height - pictureRect.height) < 1
        StartupDiagnostics.videoMark(["event": "mini-picture-crop", "onlyPicture": onlyPicture,
            "cropX": visible.minX, "cropY": visible.minY,
            "cropWidth": visible.width, "cropHeight": visible.height,
            "pictureX": pictureRect.minX, "pictureY": pictureRect.minY,
            "pictureWidth": pictureRect.width, "pictureHeight": pictureRect.height,
            "cardWidth": card.bounds.width, "cardHeight": card.bounds.height])
    }

    // MARK: Modes

    /// Explicit diagnostic launch only; identical openWatch path without claiming
    /// a physical tap. One or two requests, cancelled by real touches/background.
    private func startVideoProbe() {
        guard mode == .closed, UIApplication.shared.applicationState == .active,
              let request = videoProbe?.start(feedReady: true) else { return }
        StartupDiagnostics.mark("video-probe-started")
        if interactionProbe != nil {
            let delay = ProcessInfo.processInfo.environment["LANGFORM_PLAYER_PROBE_DELAY"].flatMap(Double.init) ?? 0
            interactionProbeNotBefore = ProcessInfo.processInfo.systemUptime + (delay.isFinite ? min(20, max(0, delay)) : 0)
        }
        scheduleVideoProbe(request)
    }

    private func scheduleVideoProbe(_ request: VideoLoadProbe.Request) {
        videoProbeWork?.cancel()
        videoProbeTimeout?.cancel()
        videoProbeTicket = nil
        videoProbePlayCheck = nil
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.videoProbe?.pending == request,
                  UIApplication.shared.applicationState == .active else { return }
            self.openWatch(request.url, userInitiated: self.videoProbe?.requestsAudibleUserOpen == true)
            self.videoProbeTicket = self.loadTicket
            let timeout = DispatchWorkItem { [weak self] in
                guard let self, self.videoProbe?.pending == request else { return }
                StartupDiagnostics.mark("video-probe-timeout")
                if let next = self.videoProbe?.timedOut(requestNumber: request.number) {
                    self.scheduleVideoProbe(next)
                } else {
                    self.videoProbeTicket = nil
                    self.interactionProbe?.cancel()
                    self.interactionProbeWork?.cancel()
                    self.interactionProbeWork = nil
                }
            }
            self.videoProbeTimeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + VideoLoadProbe.timeoutSeconds, execute: timeout)
        }
        videoProbeWork = work
        // Keep the feed's initial loading outside the video request duration.
        let initialDelay = ProcessInfo.processInfo.environment["LANGFORM_VIDEO_PROBE_INITIAL_DELAY"].flatMap(Double.init) ?? 2
        let delay = request.number == 1 && initialDelay.isFinite ? min(15, max(2, initialDelay)) : 2
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func advanceVideoProbe(_ dict: [String: Any], id: String) {
        startVideoProbePlaybackIfEligible(id: id)
        if interactionProbe != nil {
            scheduleInteractionObservation()
            return
        }
        guard videoProbeTicket == loadTicket, mode == .expanded,
              dict["playbackState"] as? String == "playing",
              let request = videoProbe?.pending else { return }
        if DownloadDeviceProbe.enabled && !downloadDeviceProbeStarted && id == "jNQXAC9IVRw" {
            downloadDeviceProbeStarted = true
            requestDownloads()
        }
        let next = videoProbe?.reportedPlaying(videoID: id,
                                               mediaReady: dict["mediaReady"] as? Bool == true,
                                               requestNumber: request.number)
        if let next {
            scheduleVideoProbe(next)
        } else if videoProbe?.state == .finished {
            videoProbeTimeout?.cancel()
            videoProbeTicket = nil
            StartupDiagnostics.mark("video-probe-finished")
        }
    }

    private func videoProbeMayStartPlayback(id: String, requestNumber: Int, ticket: Int) -> Bool {
        guard StartupDiagnostics.enabled, videoProbeTicket == ticket, loadTicket == ticket,
              mode == .expanded, UIApplication.shared.applicationState == .active,
              !playerOverlayOpen, !dragging, !cardMoving, !videoPlaying,
              startupStatus.state == .unstarted, startupStatus.issue.isEmpty, !startupStatus.requiresReload,
              startupVideoID == id, loadingVideoID == id,
              YouTubeWebView.videoID(player?.url) == id else { return false }
        return videoProbe?.mayRequestNativeStart(videoID: id, requestNumber: requestNumber) == true
    }

    private func startVideoProbePlaybackIfEligible(id: String) {
        guard let request = videoProbe?.pending, let player,
              videoProbeMayStartPlayback(id: id, requestNumber: request.number, ticket: loadTicket),
              videoProbePlayCheck == nil else { return }
        let ticket = loadTicket
        videoProbePlayCheck = (ticket, request.number)
        player.evaluateJavaScript(PlayerStartupStatus.initialPlayJavaScript(videoID: id)) { [weak self, weak player] result, error in
            guard let self, let player, self.player === player,
                  self.videoProbePlayCheck?.ticket == ticket,
                  self.videoProbePlayCheck?.request == request.number else { return }
            self.videoProbePlayCheck = nil
            guard error == nil, result as? Bool == true,
                  self.videoProbeMayStartPlayback(id: id, requestNumber: request.number, ticket: ticket),
                  self.videoProbe?.claimNativeStart(videoID: id, requestNumber: request.number) == true else { return }
            StartupDiagnostics.mark("video-probe-native-start")
            let wasExecuting = self.executingInteractionProbe
            self.executingInteractionProbe = true
            self.startingVideoProbePlayback = true
            defer {
                self.startingVideoProbePlayback = false
                self.executingInteractionProbe = wasExecuting
            }
            self.startPlaybackTapped()
        }
    }

    private var awaitingInitialPlayback: Bool {
        initialPlaybackIntent?.matches(ticket: loadTicket, videoID: startupVideoID) == true &&
            initialPlaybackIntent?.awaitingMedia == true && startupStatus.state == .unstarted && startupStatus.issue.isEmpty
    }

    private func clearWatchAudioIntent() {
        watchAudioIntent = nil
        watchAudioCheckTicket = nil
    }

    /// Audio is one separate part of opening a new video. YouTube may already
    /// be playing it muted, so that must not consume the sound intent early.
    private func startWatchAudioIfEligible(id: String) {
        guard let intent = watchAudioIntent, intent.ticket == loadTicket, intent.videoID == id,
              mode == .loading || mode == .expanded || mode == .mini,
              UIApplication.shared.applicationState == .active,
              startupVideoID == id, loadingVideoID == id,
              !playerOverlayOpen, !dragging, let player,
              YouTubeWebView.videoID(player.url) == id else { return }
        guard watchAudioCheckTicket == nil,
              let data = try? JSONEncoder().encode(id),
              let literal = String(data: data, encoding: .utf8) else { return }
        let ticket = loadTicket
        watchAudioCheckTicket = ticket
        player.evaluateJavaScript("window.__langformApplyWatchAudio && window.__langformApplyWatchAudio(\(literal), '\(ticket)')") { [weak self, weak player] result, error in
            guard let self, let player, self.player === player,
                  self.watchAudioCheckTicket == ticket,
                  self.watchAudioIntent?.ticket == ticket,
                  self.watchAudioIntent?.videoID == id else { return }
            self.watchAudioCheckTicket = nil
            guard self.loadTicket == ticket, self.startupVideoID == id,
                  YouTubeWebView.videoID(player.url) == id,
                  UIApplication.shared.applicationState == .active,
                  error == nil, result as? Bool == true else { return }
            self.watchAudioIntent = nil
            StartupDiagnostics.mark("video-watch-audio-intent-handled")
        }
    }

    private func initialPlaybackMayStart(id: String, ticket: Int) -> Bool {
        guard mode == .loading || mode == .expanded,
              UIApplication.shared.applicationState == .active,
              !playerOverlayOpen, !dragging, !cardMoving, !videoPlaying,
              startupStatus.state == .unstarted, startupStatus.issue.isEmpty, !startupStatus.requiresReload,
              loadTicket == ticket, startupVideoID == id, loadingVideoID == id,
              YouTubeWebView.videoID(player?.url) == id,
              initialPlaybackIntent?.matches(ticket: ticket, videoID: id) == true,
              initialPlaybackIntent?.consumed == false else { return false }
        return true
    }

    private func startInitialPlaybackIfEligible(id: String) {
        guard let player, initialPlaybackMayStart(id: id, ticket: loadTicket),
              initialPlaybackCheckTicket == nil else { return }
        let ticket = loadTicket
        initialPlaybackCheckTicket = ticket
        player.evaluateJavaScript(PlayerStartupStatus.initialPlayJavaScript(videoID: id)) { [weak self, weak player] result, error in
            guard let self, let player, self.player === player,
                  self.initialPlaybackCheckTicket == ticket else { return }
            self.initialPlaybackCheckTicket = nil
            guard error == nil, result as? Bool == true,
                  self.initialPlaybackMayStart(id: id, ticket: ticket),
                  self.initialPlaybackIntent?.claim(ticket: ticket, videoID: id) == true else { return }
            StartupDiagnostics.mark("video-watch-intent-start")
            let wasExecuting = self.executingInteractionProbe
            self.executingInteractionProbe = true
            self.startingWatchPlayback = true
            defer {
                self.startingWatchPlayback = false
                self.executingInteractionProbe = wasExecuting
            }
            self.startPlaybackTapped()
        }
    }

    private func cancelVideoProbe() {
        stopFullscreenPresentation()
        cancelFullscreenDiagnosticProbe()
        if videoProbe?.state == .waitingForFeed || videoProbe?.state == .waitingForVideo ||
            interactionProbe?.state == .waitingForPlayback || interactionProbe?.state == .running {
            StartupDiagnostics.mark("video-probe-cancelled", once: true)
        }
        videoProbe?.cancel()
        videoProbeWork?.cancel()
        videoProbeTimeout?.cancel()
        videoProbeTicket = nil
        videoProbePlayCheck = nil
        interactionProbe?.cancel()
        interactionProbeWork?.cancel()
        interactionProbeWork = nil
        interactionProbeTimeout?.cancel()
    }

    /// Read-only observation is bounded by the diagnostic plan. It never feeds a
    /// forced measurement into native playback state or masks delayed reports.
    private func scheduleInteractionObservation(after delay: Double = 0.05) {
        guard let state = interactionProbe?.state,
              state == .waitingForPlayback || state == .running,
              fullscreenDiagnosticPending == nil,
              interactionProbeWork == nil, !interactionProbeObserving else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.interactionProbeWork = nil
            guard let player = self.player, UIApplication.shared.applicationState == .active else { return }
            let pending = self.interactionProbe?.pending
            self.interactionProbeObserving = true
            let script = """
                (function () {
                  var v=document.querySelector('#movie_player video,ytm-player video,ytd-player video,video');
                  var r=document.getElementById('movie_player'), actual='';
                  try { var d=r&&r.getVideoData&&r.getVideoData(); actual=d&&d.video_id||''; } catch(e) {}
                  return { href:String(location.href), actualID:actual, hasVideo:!!v,
                    playing:!!(v&&!v.paused&&!v.ended),
                    paused:!!(v&&v.paused), ended:!!(v&&v.ended),
                    ready:!!(v&&v.readyState>=2&&v.videoWidth>0&&v.videoHeight>0) };
                })();
                """
            player.evaluateJavaScript(script) { [weak self] result, _ in
                guard let self else { return }
                self.interactionProbeObserving = false
                guard UIApplication.shared.applicationState == .active else {
                    self.cancelVideoProbe()
                    return
                }
                guard self.interactionProbe?.pending == pending,
                      let dict = result as? [String: Any],
                      let href = dict["href"] as? String, let url = URL(string: href) else {
                    self.scheduleInteractionObservation()
                    return
                }
                let id = YouTubeWebView.videoID(url)
                let actualID = dict["actualID"] as? String ?? ""
                let closing = pending?.step == .close || pending?.step == .verifyBlank
                if !closing && actualID.isEmpty {
                    self.scheduleInteractionObservation()
                    return
                }
                guard actualID.isEmpty || actualID == id else { self.cancelVideoProbe(); return }
                let probeMode: PlayerInteractionProbe.Mode
                switch self.mode {
                case .closed: probeMode = .closed
                case .loading: probeMode = .loading
                case .expanded: probeMode = .expanded
                case .mini: probeMode = .mini
                }
                let actualPlaying = dict["playing"] as? Bool == true
                if pending == nil, let id { self.startVideoProbePlaybackIfEligible(id: id) }
                let observation = PlayerInteractionProbe.Observation(
                    videoID: id, mode: probeMode, playing: actualPlaying,
                    hasVideo: dict["hasVideo"] as? Bool == true,
                    mediaReady: dict["ready"] as? Bool == true,
                    settled: !self.cardMoving, url: url)
                if let pending {
                    // A control is correct only after native state agrees with
                    // the existing media, not solely because its JS call ran.
                    if actualPlaying != self.videoPlaying ||
                        (actualPlaying && self.startupStatus.state != .playing) {
                        self.scheduleInteractionObservation()
                        return
                    }
                    let expectsPause = pending.step == .pauseMini || pending.step == .expandPaused || pending.step == .minimizePaused
                    if expectsPause && (dict["paused"] as? Bool != true ||
                                        dict["ended"] as? Bool == true || self.startupStatus.state != .paused) {
                        self.scheduleInteractionObservation()
                        return
                    }
                    if let next = self.interactionProbe?.observe(observation, ticket: pending.ticket) {
                        StartupDiagnostics.mark("player-probe-confirmed-" + pending.step.rawValue)
                        self.scheduleInteractionAction(next)
                    } else if self.interactionProbe?.state == .completed {
                        self.interactionProbeTimeout?.cancel()
                        StartupDiagnostics.mark("player-probe-confirmed-" + pending.step.rawValue)
                        StartupDiagnostics.mark("player-probe-completed")
                    } else {
                        self.scheduleInteractionObservation()
                    }
                } else if self.videoProbeTicket == self.loadTicket,
                          self.startupStatus.state == .playing,
                          let first = self.interactionProbe?.start(observation: observation) {
                    self.videoProbe?.cancel()
                    self.videoProbeTimeout?.cancel()
                    self.videoProbeTicket = nil
                    StartupDiagnostics.mark("player-probe-started")
                    self.performInteractionProbe(first)
                } else {
                    self.scheduleInteractionObservation()
                }
            }
        }
        interactionProbeWork = work
        // A diagnostic-only delay lets Instruments finish attaching before the
        // action sequence. No polling during this wait; default launches use 0.
        let wait = state == .waitingForPlayback ? max(delay, interactionProbeNotBefore - ProcessInfo.processInfo.systemUptime) : delay
        DispatchQueue.main.asyncAfter(deadline: .now() + wait, execute: work)
    }

    /// Leave the confirmed live media on screen briefly for diagnostic screenshots.
    /// The normal product path never creates an interaction plan or delays controls.
    private func scheduleInteractionAction(_ request: PlayerInteractionProbe.Request) {
        guard StartupDiagnostics.enabled, interactionProbe?.state == .running,
              interactionProbe?.pending == request else { return }
        if startFullscreenDiagnosticProbeBeforeClose(request) { return }
        let rawDelay = ProcessInfo.processInfo.environment["LANGFORM_PLAYER_PROBE_STEP_DELAY"].flatMap(Double.init) ?? 0
        // Blank must be observed before the ordinary closed-player prewarm.
        let delay = request.step == .verifyBlank ? 0 : (rawDelay.isFinite ? min(3, max(0, rawDelay)) : 0)
        guard delay > 0 else { performInteractionProbe(request); return }
        interactionProbeTimeout?.cancel()
        interactionProbeWork?.cancel()
        let ticket = loadTicket
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.interactionProbeWork = nil
            guard self.loadTicket == ticket, self.interactionProbe?.state == .running,
                  self.interactionProbe?.pending == request,
                  UIApplication.shared.applicationState == .active else { return }
            self.performInteractionProbe(request)
        }
        interactionProbeWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func performInteractionProbe(_ request: PlayerInteractionProbe.Request) {
        interactionProbeTimeout?.cancel()
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, self.interactionProbe?.pending == request else { return }
            self.interactionProbe?.timedOut(ticket: request.ticket)
            self.interactionProbeWork?.cancel()
            self.interactionProbeWork = nil
            StartupDiagnostics.mark("player-probe-timeout-" + request.step.rawValue)
        }
        interactionProbeTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + PlayerInteractionProbe.timeoutSeconds, execute: timeout)
        StartupDiagnostics.mark("player-probe-action-" + request.step.rawValue)
        executingInteractionProbe = true
        defer { executingInteractionProbe = false }
        switch request.action {
        case .minimize: collapseTapped()
        case .toggleMiniPlayback: toggleMiniPlayback()
        case .expand: expandCard()
        case .close: closePlayer()
        case .verifyBlank: break
        }
        scheduleInteractionObservation(after: 0.1)
    }

    private func openWatch(_ url: URL, userInitiated: Bool = false, sourceRect: [String: Any]? = nil,
                           sourceThumbnail: [String: Any]? = nil, sourceView: WKWebView? = nil) {
        cancelPendingFeedSearch()
        feedMotion.finish()
        if userInitiated { cancelVideoProbe() }
        let requestedAt = ProcessInfo.processInfo.systemUptime
        let playerExisted = player != nil
        ensurePlayer()
        cancelFeedPrewarm(discardLoading: true)
        let sameVideo = mode != .closed && YouTubeWebView.videoID(url) != nil
            && (mode == .loading ? loadingVideoID : YouTubeWebView.videoID(player.url)) == YouTubeWebView.videoID(url)
        lastWatchURL = url
        if sameVideo {
            if !systemMediaSuspendedForOffline {
                player.evaluateJavaScript("window.__langformPublishSystemMedia && window.__langformPublishSystemMedia()")
            }
            if let values = sourceThumbnail,
               let transient = WatchFeedOpening(values: values, source: sourceView ?? feed,
                                                videoID: YouTubeWebView.videoID(url), ticket: loadTicket, fromFeed: false) {
                transient.command("discard"); transient.restore()
            }
            if userInitiated && YouTubeWebView.hasTimestamp(url) {
                if mode == .loading { pendingTimestampURL = url } else { seekTappedLink(url) }
            }
            if mode == .mini { settle(.expanded) }
            return
        }
        cancelDownloadSourceRequest()
        discardFeedOpening()
        // Never chain a second SPA request onto a half-finished transition.
        systemMedia.clear()
        // The prepared shell warms WebKit/resources. Its first watch still
        // loads a fresh document: YouTube can stall when routing from suspended home.
        let currentID = (mode == .expanded || mode == .mini) ? YouTubeWebView.videoID(player.url) : nil
        playerWarmupNavigation = nil
        loadingTimeout?.cancel()
        cancelSPAWaits()
        revokeFullscreenEntryAdmission()
        loadTicket += 1
        initialPlaybackCheckTicket = nil
        initialPlaybackIntent = userInitiated ? YouTubeWebView.videoID(url).map {
            PlayerInitialPlayback(ticket: loadTicket, videoID: $0)
        } : nil
        watchAudioCheckTicket = nil
        watchAudioIntent = userInitiated ? YouTubeWebView.videoID(url).map {
            (ticket: loadTicket, videoID: $0)
        } : nil
        videoLoadDiagnostics.begin(ticket: loadTicket, requestedAt: requestedAt, playerExisted: playerExisted)
        videoLoadDiagnostics.mark(.prepared, ticket: loadTicket)
        loadingVideoID = YouTubeWebView.videoID(url)
        resetLoadReadiness()
        videoRect = .zero
        videoSeekGeometry = nil
        pendingRect = nil
        pendingTimestampURL = nil
        videoPlaying = false
        startupStatus = PlayerStartupStatus()
        startupVideoID = loadingVideoID
        missingMediaTimeout?.cancel()
        missingMediaTimeout = nil
        playerOverlayOpen = false
        playerOverlayVideoID = nil
        playerFullscreen = false
        endDrag()
        beginLoading()
        let ticket = loadTicket
        if let sourceView {
            feedOpening = WatchFeedOpening(values: sourceThumbnail, source: sourceView,
                                           videoID: loadingVideoID, ticket: ticket, fromFeed: sourceView === feed)
            if let opening = feedOpening {
                // The source already started its image spring in the click
                // handler. Loading runs behind it, never gates its first frame.
                if opening.fromFeed { insertSubview(feed, aboveSubview: card) }
                else { insertSubview(card, aboveSubview: feed) }
                bringSubviewToFront(collapseButton)
                StartupDiagnostics.mark("watch-opening-claimed")
                updateChrome()
                opening.command("status") { [weak self, weak opening] result, _ in
                    guard let self, let opening, self.feedOpening === opening else { return }
                    guard let values = result as? [String: Any], values["token"] as? String == opening.token,
                          values["id"] as? String == opening.videoID else {
                        self.discardFeedOpening(); self.considerReveal(); return
                    }
                    guard values["landed"] as? Bool == true else { return }
                    opening.landed = true
                    self.considerReveal()
                }
            }
        }
        let posterAsset = feedOpening?.livePreview == true ? nil : sourceThumbnail
        openingMotion.prepare(posterAsset, videoID: loadingVideoID, in: feed) { [weak self] in
            guard let self, self.loadTicket == ticket,
                  self.mode == .loading || self.mode == .expanded,
                  self.startupStatus.keepsStartupPoster else { return }
            self.showStartupPoster()
        }
        if Self.playerSPAEnabled, let currentID {
            tryPlayerSPA(url, currentID: currentID, ticket: ticket)
        } else {
            loadPlayerDocument(url, ticket: ticket)
        }
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, self.loadTicket == ticket,
                  self.mode == .loading || (self.mode == .expanded &&
                    self.feedOpening?.ticket == ticket && self.feedOpening?.reversing == false) else { return }
            self.failPlayer()
        }
        loadingTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: timeout)
    }

    private func showStartupPoster() {
        guard mode == .expanded, hasVideoRect, startupStatus.keepsStartupPoster,
              let feed, let player else { return }
        // This stationary native copy takes over at the actual Watch picture
        // plane. The source already owns any feed-to-player movement.
        openingMotion.reveal(in: card, above: player, feed: feed,
                             destination: player.convert(pictureRect, to: card))
        finishFeedOpeningIfReady()
    }

    private func discardFeedOpening() {
        guard let opening = feedOpening else { return }
        feedOpening = nil
        if mode != .loading {
            loadingTimeout?.cancel()
            loadingTimeout = nil
        }
        opening.command("discard"); opening.restore()
        if mode == .loading { insertSubview(card, belowSubview: feed) }
    }

    private func finishFeedOpeningIfReady() {
        guard let opening = feedOpening, opening.ticket == loadTicket, opening.landed,
              !opening.reversing, mode == .expanded, hasVideoRect,
              (!opening.livePreview && openingMotion.hasVisiblePicture) || !startupStatus.keepsStartupPoster else { return }
        // The native copy is the same validated thumbnail, or a confirmed
        // video frame. Never uncover an unpainted WebKit picture plane.
        feedOpening = nil
        loadingTimeout?.cancel()
        loadingTimeout = nil
        insertSubview(card, aboveSubview: feed)
        opening.command("finish"); opening.restore()
        bringSubviewToFront(collapseButton)
        StartupDiagnostics.mark("watch-opening-handoff")
    }

    private func reverseFeedOpening(completion: (() -> Void)? = nil) {
        guard let opening = feedOpening, !opening.reversing else { return }
        cancelDownloadSourceRequest()
        opening.reversing = true
        initialPlaybackIntent = nil
        clearWatchAudioIntent()
        player?.stopLoading()
        suspendPreparedPlayer()
        opening.onCancelled = { [weak self, weak opening] in
            guard let self, let opening, self.feedOpening === opening else { return }
            self.feedOpening = nil
            opening.command("discard"); opening.restore()
            self.closePlayer()
            completion?()
        }
        opening.command("reverse") { [weak opening] result, _ in
            if result as? Bool != true { opening?.onCancelled?() }
        }
        // A terminated/replaced source document must not leave input locked.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak opening] in opening?.onCancelled?() }
    }

    private func feedOpeningChanged(_ message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "https",
              ["m.youtube.com", "www.youtube.com", "youtube.com"].contains(message.frameInfo.securityOrigin.host),
              let opening = feedOpening, opening.source === message.webView,
              opening.ticket == loadTicket,
              let values = message.body as? [String: Any], values["token"] as? String == opening.token,
              values["videoID"] as? String == opening.videoID else { return }
        switch values["kind"] as? String {
        case "landed":
            opening.landed = true
            StartupDiagnostics.mark("watch-opening-landed")
            considerReveal(); finishFeedOpeningIfReady()
        case "cancelled": opening.onCancelled?()
        case "discarded":
            discardFeedOpening()
            if mode == .loading { considerReveal() }
        default: break
        }
    }

    private func resetLoadReadiness() {
        loadFinished = false
        loadCommitted = false
        loadHasVideo = false
        loadPainted = false
        loadMediaReady = false
    }

    private func suspendPreparedPlayer() {
        // WebKit counts suspension requests. Closing and subsequent idle
        // preparation share one hold; a second true would need a second false
        // and leave even YouTube's own Play button blocked after reopening.
        guard !playerPreparationSuspended, let player else { return }
        playerPreparationSuspended = true
        player.setAllMediaPlaybackSuspended(true, completionHandler: nil)
    }

    private func resumePreparedPlayer() {
        guard playerPreparationSuspended else { return }
        playerPreparationSuspended = false
        player.setAllMediaPlaybackSuspended(false, completionHandler: nil)
    }

    private func cancelSPAWaits() {
        spaStartTimeout?.cancel()
        spaReadyTimeout?.cancel()
        spaStartTimeout = nil
        spaReadyTimeout = nil
    }

    private func loadPlayerDocument(_ url: URL, ticket: Int) {
        guard mode == .loading, loadTicket == ticket else { return }
        loadingViaSPA = false
        cancelSPAWaits()
        resetLoadReadiness()
        var request = URLRequest(url: url)
        request.timeoutInterval = 30
        videoLoadDiagnostics.mark(.documentRequested, ticket: ticket)
        playerNavigation = player.load(request)
    }

    private func fallbackFromSPA(_ url: URL, ticket: Int) {
        guard loadingViaSPA, mode == .loading, loadTicket == ticket else { return }
        videoLoadDiagnostics.mark(.spaFallback, ticket: ticket)
        // Flipping the flag before loading makes every timeout/callback a no-op
        // after the first fallback, including a late router acknowledgement.
        loadPlayerDocument(url, ticket: ticket)
    }

    private func tryPlayerSPA(_ url: URL, currentID: String, ticket: Int) {
        guard let data = try? JSONEncoder().encode([url.absoluteString, currentID, String(ticket)]),
              let arguments = String(data: data, encoding: .utf8) else {
            loadPlayerDocument(url, ticket: ticket)
            return
        }
        loadingViaSPA = true
        videoLoadDiagnostics.mark(.spaRequested, ticket: ticket)
        let startTimeout = DispatchWorkItem { [weak self] in
            self?.fallbackFromSPA(url, ticket: ticket)
        }
        let readyTimeout = DispatchWorkItem { [weak self] in
            self?.fallbackFromSPA(url, ticket: ticket)
        }
        spaStartTimeout = startTimeout
        spaReadyTimeout = readyTimeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: startTimeout)
        // A slow but acknowledged route must not be discarded and downloaded
        // a second time after just 1.8 seconds. Missing routers fail immediately.
        DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: readyTimeout)
        let script = "Boolean(window.__langformNavigateWatch && window.__langformNavigateWatch.apply(window, \(arguments)))"
        player.evaluateJavaScript(script) { [weak self] result, error in
            guard let self, self.mode == .loading, self.loadTicket == ticket, self.loadingViaSPA else { return }
            if error != nil || (result as? Bool) != true {
                self.fallbackFromSPA(url, ticket: ticket)
            }
        }
    }

    private func seekTappedLink(_ url: URL) {
        guard let data = try? JSONEncoder().encode(url.absoluteString),
              let literal = String(data: data, encoding: .utf8) else { return }
        pendingTimestampURL = url
        let ticket = loadTicket
        player.evaluateJavaScript("window.__langformSeekFromLink && window.__langformSeekFromLink(\(literal))") { [weak self] result, _ in
            guard let self, self.loadTicket == ticket, self.pendingTimestampURL == url else { return }
            if (result as? NSNumber)?.boolValue == true { self.pendingTimestampURL = nil }
        }
    }

    private func showLoadFailure() {
        loadLabel.text = "Das Video konnte nicht geladen werden."
        retryButton.isHidden = false
        loadStatus.isHidden = false
        bringSubviewToFront(loadStatus)
        setNeedsLayout()
        UIAccessibility.post(notification: .announcement, argument: loadLabel.text)
    }

    @objc private func retryPlayer() {
        cancelVideoProbe()
        guard let url = lastWatchURL else { return }
        openWatch(url)
    }

    @objc private func dismissLoadStatus() {
        cancelVideoProbe()
        if mode == .loading { closePlayer() }
        loadStatus.isHidden = true
    }

    private func failPlayer() {
        videoLoadDiagnostics.finish(.failed)
        if feedOpening != nil {
            reverseFeedOpening { [weak self] in self?.showLoadFailure() }
            return
        }
        closePlayer()
        showLoadFailure()
    }

    /// The player view loads at full size behind the opaque feed. WebKit sees it
    /// as visible and paints it; the user still sees and uses the feed.
    private func beginLoading() {
        watchBackgroundCategoryTransition("cancel")
        cancelPendingMinimize()
        finishMiniContext()
        videoCropActive = false
        resetCustomFullscreen()
        cancelCloseMotion()
        openingMotion.cancel()
        mode = .loading
        progress = 0
        player.isUserInteractionEnabled = true
        cardTap.isEnabled = false
        settler?.stopAnimation(true)
        settler = nil
        settlingBetweenModes = false
        revealer?.stopAnimation(true)
        revealer = nil
        card.layer.removeAllAnimations()
        card.alpha = 1
        card.transform = .identity
        apply(0)
        insertSubview(card, belowSubview: feed)
        card.isHidden = false
        // YouTube provides its own loading feedback once its page is visible.
        // The native bar is reserved for failures, never routine loading.
        loadStatus.isHidden = true
        updateChrome()
    }

    private func considerReveal() {
        guard mode == .loading else { return }
        guard feedOpening?.landed != false, feedOpening?.reversing != true else { return }
        guard hasVideoRect else { return }
        if loadingViaSPA {
            // A reused document's paint or didFinish belongs to the previous
            // video. Only a new frame carrying this request's identity may reveal.
            if loadMediaReady { reveal() }
            return
        }
        guard loadCommitted else { return }
        if loadMediaReady || (loadFinished && loadHasVideo) || loadPainted {
            reveal()
        }
    }

    /// The thumbnail already landed during loading. Reveal the watch surface
    /// beneath it, without moving the video box a second time.
    private func reveal() {
        guard mode == .loading else { return }
        videoLoadDiagnostics.mark(.revealStarted, ticket: loadTicket)
        // A painted page may still be covered by its source picture. Its
        // existing deadline ends only when a poster/first frame takes over;
        // otherwise a failed poster plus stalled media could wait forever.
        if feedOpening == nil {
            loadingTimeout?.cancel()
            loadingTimeout = nil
        }
        cancelSPAWaits()
        loadingViaSPA = false
        loadStatus.isHidden = true
        mode = .expanded
        if let url = pendingTimestampURL {
            seekTappedLink(url)
        }
        if feedOpening?.fromFeed != true { insertSubview(card, aboveSubview: feed) }
        apply(0)
        showStartupPoster()
        if !startupStatus.keepsStartupPoster { openingMotion.complete() }
        if let opening = feedOpening, !opening.ready {
            opening.ready = true
            opening.command("ready")
        }
        if let id = startupVideoID {
            player.evaluateJavaScript("window.__langformRevealWatchContent && window.__langformRevealWatchContent('\(id)')")
        }
        finishFeedOpeningIfReady()
        card.transform = .identity
        card.alpha = 1
        updateChrome()
        flushPendingRect()
        videoLoadDiagnostics.mark(.revealCompleted, ticket: loadTicket)
    }

    private func stopReveal(preservingStartupPoster: Bool = false) {
        if preservingStartupPoster { openingMotion.viewportChanged() }
        else { openingMotion.cancel() }
        let animator = revealer
        revealer = nil
        animator?.stopAnimation(true)
        // Rotation also resets a pose previously frozen by a finger, when the
        // reveal animator itself has already been released.
        card.transform = .identity
        card.alpha = 1
    }

    /// Keep the rendered pose when a finger grabs the opening card. Stopping
    /// the animator alone would expose its already-identity model transform.
    private func freezeReveal() {
        openingMotion.cancel()
        guard let animator = revealer else { return }
        let transform = card.layer.presentation()?.affineTransform() ?? card.transform
        revealer = nil
        animator.stopAnimation(true)
        // A direct gesture takes over the surface immediately, including opacity.
        UIView.performWithoutAnimation { card.transform = transform; card.alpha = 1 }
    }

    /// Fallback for a WebKit without paint timing: after the load event, a body
    /// with laid-out content has been painted.
    private func checkPaintAfterLoad(ticket: Int) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.mode == .loading, self.loadTicket == ticket, !self.loadingViaSPA else { return }
            let script = "(function(){var b=document.body;return !!(b&&b.childElementCount>0&&b.getBoundingClientRect().height>0);})()"
            self.player.evaluateJavaScript(script) { [weak self] result, _ in
                guard let self, self.mode == .loading, self.loadTicket == ticket, !self.loadingViaSPA else { return }
                if (result as? NSNumber)?.boolValue == true {
                    self.loadPainted = true
                    self.considerReveal()
                }
            }
        }
    }

    /// Springs the card to the full player or the card. The finger's speed carries
    /// into the spring, measured in the animation's own unit (distance left per second).
    private func settle(_ target: Mode, speed: CGFloat = 0, travel: CGFloat = 1) {
        guard target != .closed else { return }
        guard target != .mini || ownsWatchPlayer else { return }
        freezeSettle()
        freezeReveal()
        if target == .mini { beginVideoCrop() }
        mode = target
        let end: CGFloat = target == .mini ? 1 : 0
        let distance = end - progress
        var relative: CGFloat = 0
        if abs(distance) > 0.001, travel > 0 {
            relative = min(12, max(-12, (speed / travel) / distance))
        }
        player.isUserInteractionEnabled = target == .expanded
        cardTap.isEnabled = target == .mini
        if UIAccessibility.isReduceMotionEnabled || (abs(distance) < 0.001 && card.transform.isIdentity && cropCorrection == nil) {
            progress = end
            card.transform = .identity
            cropCorrection = nil
            apply(end)
            restoreExpandedSurface()
            flushPendingRect()
            updateChrome()
            if target == .expanded, let id = startupVideoID {
                startInitialPlaybackIfEligible(id: id)
            }
            return
        }
        let timing = UISpringTimingParameters(dampingRatio: 0.92, initialVelocity: CGVector(dx: relative, dy: relative))
        // A nearly completed drag only needs a short settle, not a full transition.
        let duration = 0.20 + 0.12 * Double(min(1, abs(distance)))
        let animator = UIViewPropertyAnimator(duration: duration, timingParameters: timing)
        animator.isUserInteractionEnabled = true
        animator.addAnimations {
            self.card.transform = .identity
            self.cropCorrection = nil
            self.apply(end)
        }
        animator.addCompletion { [weak self, weak animator] position in
            guard let self, self.settler === animator else { return }
            self.settler = nil
            self.settlingBetweenModes = false
            if position == .end {
                self.restoreExpandedSurface()
                self.flushPendingRect()
            }
            self.updateChrome()
            if position == .end, target == .expanded, let id = self.startupVideoID {
                self.startInitialPlaybackIfEligible(id: id)
            }
        }
        progress = end
        settlingBetweenModes = true
        settler = animator
        updateChrome()
        animator.startAnimation()
    }

    /// Stops a running spring where the card is on screen and makes that the model.
    private func freezeSettle() {
        cancelPendingMinimize()
        guard let animator = settler else { return }
        settler = nil
        let wasChangingMode = settlingBetweenModes
        settlingBetweenModes = false
        let cardPose = card.layer.presentation()
        let playerPose = player?.layer.presentation()
        let closeFrame = closeButton.layer.presentation().map {
            CGRect(x: $0.position.x - $0.bounds.width / 2, y: $0.position.y - $0.bounds.height / 2,
                   width: $0.bounds.width, height: $0.bounds.height)
        } ?? closeButton.frame
        let playbackFrame = miniPlaybackButton.layer.presentation().map {
            CGRect(x: $0.position.x - $0.bounds.width / 2, y: $0.position.y - $0.bounds.height / 2,
                   width: $0.bounds.width, height: $0.bounds.height)
        } ?? miniPlaybackButton.frame
        let shown = cardPose?.bounds.size.height ?? card.bounds.height
        let transform = cardPose?.affineTransform() ?? card.transform
        animator.stopAnimation(true)
        let full = videoCropActive ? pictureRect.height : bounds.height
        let small = miniFrame().height
        if wasChangingMode, full - small > 1 {
            progress = min(1, max(0, (full - shown) / (full - small)))
        }
        if let cardPose, let playerPose, customFullscreenID == nil {
            let scale = playerPose.affineTransform().a
            let frame = CGRect(x: cardPose.position.x - cardPose.bounds.width / 2,
                               y: cardPose.position.y - cardPose.bounds.height / 2,
                               width: cardPose.bounds.width, height: cardPose.bounds.height)
            let geometry = PlayerViewportPolicy.SurfaceGeometry(frame: frame, scale: scale,
                origin: CGPoint(x: playerPose.position.x - scale * bounds.width / 2,
                                y: playerPose.position.y - scale * bounds.height / 2))
            let regular = PlayerViewportPolicy.surfaceGeometry(viewport: bounds, picture: pictureRect,
                mini: miniFrame(), progress: progress, videoOnly: videoCropActive || mode == .mini)
            cropCorrection = PlayerViewportPolicy.SurfaceCorrection(shown: geometry, regular: regular, progress: progress)
            let controls = PlayerViewportPolicy.miniControls(in: frame.size, target: miniFrame().size, progress: progress)
            cropCorrection?.controls = PlayerViewportPolicy.ControlCorrection(shownClose: closeFrame, shownPlayback: playbackFrame,
                regularClose: controls.close, regularPlayback: controls.playback)
        }
        UIView.performWithoutAnimation {
            card.transform = transform
            apply(progress)
        }
    }

    private var cardMoving: Bool {
        dragging || settler != nil || revealer != nil || dismisser != nil
    }

    private func flushPendingRect() {
        guard !cardMoving, let rect = pendingRect else { return }
        pendingRect = nil
        guard rect.minX.isFinite, rect.minY.isFinite,
              rect.width.isFinite, rect.height.isFinite,
              rect.width > 8, rect.height > 8 else { return }
        // The receiver accepts only a rect with the current WK viewport size.
        // Apply it without adding a crop spring to the viewport transition.
        let afterViewportChange = awaitingViewportGeometry
        // A play/pause report during a transition can repeat the same geometry.
        // Do not follow the real transition with an empty crop animation.
        guard rect != videoRect || afterViewportChange else { return }
        videoRect = rect
        if afterViewportChange {
            awaitingViewportGeometry = false
            UIView.performWithoutAnimation {
                if mode == .expanded || mode == .mini { apply(progress) }
            }
            showStartupPoster()
        } else if mode == .mini && !UIAccessibility.isReduceMotionEnabled {
            let animator = UIViewPropertyAnimator(duration: 0.2, curve: .easeOut) { self.apply(1) }
            animator.isUserInteractionEnabled = true
            settlingBetweenModes = false
            settler = animator
            animator.addCompletion { [weak self, weak animator] _ in
                guard let self, self.settler === animator else { return }
                self.settler = nil
                self.flushPendingRect()
                self.updateChrome()
            }
            updateChrome()
            animator.startAnimation()
        } else if mode == .expanded || mode == .mini {
            apply(progress)
        }
    }

    /// Leaves the watch page and removes the card.
    @objc private func closePlayer() {
        watchBackgroundCategoryTransition("cancel")
        cancelDownloadSourceRequest()
        clearWatchAudioIntent()
        if feedOpening != nil { reverseFeedOpening(); return }
        finishMiniContext()
        cancelPendingFeedSearch()
        resetCustomFullscreen()
        if !executingInteractionProbe { cancelVideoProbe() }
        guard mode != .closed else { return }
        systemMedia.clear()
        videoLoadDiagnostics.finish(.cancelled)
        loadingTimeout?.cancel()
        loadingTimeout = nil
        cancelSPAWaits()
        loadingViaSPA = false
        revokeFullscreenEntryAdmission()
        loadTicket += 1
        loadingVideoID = nil
        playerWarmupNavigation = nil
        playerWarmupAttempted = false
        loadStatus.isHidden = true
        freezeSettle()
        freezeReveal()
        let animateClose = (mode == .mini || mode == .expanded) && !card.isHidden
            && window != nil && !UIAccessibility.isReduceMotionEnabled
        pendingRect = nil
        pendingTimestampURL = nil
        summaryTasks.removeValue(forKey: ObjectIdentifier(player))?.cancel()
        mode = .closed
        endDrag()
        playerOverlayOpen = false
        playerOverlayVideoID = nil
        playerFullscreen = false
        videoPlaying = false
        startupStatus = PlayerStartupStatus()
        startupVideoID = nil
        missingMediaTimeout?.cancel()
        missingMediaTimeout = nil
        player.isUserInteractionEnabled = false
        cardTap.isEnabled = false
        player.stopLoading()
        // Stop audio and any attempted page autoplay immediately, while keeping
        // the rendered surface alive for its short exit. Resume only when a new
        // document commits, using the existing prepared-player handoff.
        suspendPreparedPlayer()
        guard animateClose else { finishClose(); return }
        let ticket = loadTicket
        let animator = UIViewPropertyAnimator(duration: 0.20, curve: .easeIn)
        animator.addAnimations {
            self.card.alpha = 0
            self.card.transform = self.card.transform.translatedBy(x: 0, y: 24)
            self.collapseButton.alpha = 0
        }
        animator.addCompletion { [weak self, weak animator] _ in
            guard let self, self.dismisser === animator, self.loadTicket == ticket,
                  self.mode == .closed else { return }
            self.finishClose()
        }
        dismisser = animator
        updateChrome()
        animator.startAnimation()
    }

    private func cancelCloseMotion() {
        let animator = dismisser
        dismisser = nil
        animator?.stopAnimation(true)
        card.alpha = 1
        card.transform = .identity
    }

    private func finishClose() {
        if mode == .closed { cancelDownloadSourceRequest() }
        finishMiniContext()
        videoCropActive = false
        cancelCloseMotion()
        guard mode == .closed else { return }
        card.isHidden = true
        player?.isUserInteractionEnabled = true
        if let player, player.url?.scheme != "about" {
            playerNavigation = player.load(URLRequest(url: Self.blankURL))
        }
        videoRect = .zero
        progress = 0
        apply(0)
        updateChrome()
        scheduleFeedPrewarm()
    }

    @objc private func expandCard() {
        if !executingInteractionProbe { cancelVideoProbe() }
        guard mode == .mini else { return }
        settle(.expanded)
    }

    @objc private func toggleMiniPlayback() {
        if !executingInteractionProbe { cancelVideoProbe() }
        guard mode == .mini, let id = YouTubeWebView.videoID(player.url),
              let data = try? JSONEncoder().encode(id),
              let literal = String(data: data, encoding: .utf8) else { return }
        // Only this explicit control asks the existing page player to play or pause.
        // The page's next media report supplies the actual resulting button state.
        player.evaluateJavaScript("window.__langformTogglePlayback && window.__langformTogglePlayback(\(literal))")
    }

    private func setNativeDragging(_ active: Bool) {
        let id: String
        if active {
            guard let current = YouTubeWebView.videoID(player?.url), current != nativeDragVideoID else { return }
            nativeDragVideoID = current
            id = current
        } else {
            guard let current = nativeDragVideoID else { return }
            nativeDragVideoID = nil
            id = current
        }
        guard let player, let data = try? JSONEncoder().encode(id),
              let literal = String(data: data, encoding: .utf8) else { return }
        let flag = active ? "true" : "false"
        let cancelSwipe = active ? "if (window.__langformPlaybackSwipe && typeof window.__langformPlaybackSwipe.cancel === 'function') window.__langformPlaybackSwipe.cancel(\(literal)); " : ""
        player.evaluateJavaScript(cancelSwipe + "window.__langformSetNativeDragging && window.__langformSetNativeDragging(\(flag), \(literal))")
    }

    /// Read-only and bounded to an explicitly enabled diagnostic gesture run.
    private func traceEdgeWindowState(_ phase: String) {
        guard StartupDiagnostics.enabled, let scene = window?.windowScene else { return }
        let windows: [[String: Any]] = scene.windows.map { item in
            var controllers: [String] = []
            var controller = item.rootViewController
            while let current = controller, controllers.count < 8 {
                controllers.append(String(describing: type(of: current)))
                controller = current.presentedViewController
            }
            return ["class": String(describing: type(of: item)), "hidden": item.isHidden,
                    "key": item.isKeyWindow, "level": Double(item.windowLevel.rawValue),
                    "controllers": controllers]
        }
        StartupDiagnostics.videoMark(["event": "edge-window-state", "phase": phase,
            "mode": String(describing: mode), "fullscreen": playerFullscreen,
            "customFullscreen": customFullscreenID != nil, "windows": windows,
            "unixMilliseconds": Date().timeIntervalSince1970 * 1000])
        if phase == "settled", mode == .mini,
           ProcessInfo.processInfo.environment["LANGFORM_MINI_CHROME_TRACE"] == "1", let player {
            let traceTicket = loadTicket
            let script = """
            (function(){var selectors=['ytm-related-chip-cloud-renderer','ytm-feed-filter-chip-bar-renderer','ytm-chip-cloud-renderer','yt-chip-cloud-renderer','.ytChipBarViewModelHost','.ytChipCloudViewModelHost','ytm-header','.rich-grid-sticky-header'];return selectors.flatMap(function(selector){return Array.from(document.querySelectorAll(selector)).slice(0,8).map(function(node){var r=node.getBoundingClientRect(),css=getComputedStyle(node),parents=[],p=node.parentElement;while(p&&parents.length<6){parents.push(p.tagName);p=p.parentElement;}return {selector:selector,tag:node.tagName,parents:parents,x:r.x,y:r.y,width:r.width,height:r.height,position:css.position,visibility:css.visibility,opacity:css.opacity,containsMedia:!!node.querySelector('video,audio,.html5-video-container,.ytp-caption-window-container')};});});})()
            """
            player.evaluateJavaScript(script) { [weak self, weak player] result, _ in
                guard let self, self.player === player, self.loadTicket == traceTicket,
                      self.mode == .mini, let nodes = result as? [[String: Any]] else { return }
                StartupDiagnostics.videoMark(["event": "mini-watch-chrome", "nodes": nodes])
            }
        }
    }

    /// A paused video remains available in the mini card, just like a playing one.
    @objc private func collapseTapped() {
        if !executingInteractionProbe { cancelVideoProbe() }
        if feedOpening != nil { reverseFeedOpening(); return }
        guard mode == .expanded else { return }
        if playerFullscreen { requestFullscreenExit(); return }
        minimizePlayer()
    }

    private func requestFullscreenExit() {
        guard let id = YouTubeWebView.videoID(player?.url),
              let data = try? JSONEncoder().encode(id),
              let literal = String(data: data, encoding: .utf8) else { return }
        // Completion comes from the actual media report. A rejected/no-op exit
        // must not turn this same action into an accidental minimization.
        player.evaluateJavaScript("window.__langformExitFullscreen && window.__langformExitFullscreen(\(literal))")
    }

    private func cancelPendingMinimize() {
        minimizeRequestTicket += 1
        pendingMinimizeRequest = nil
    }

    private func minimizePlayer() {
        guard mode == .expanded, ownsWatchPlayer, !dragging, !playerOverlayOpen,
              !playerFullscreen, customFullscreenID == nil else { return }
        if pictureOnScreen {
            settle(.mini)
            return
        }
        // Scrolled down to the comments: bring the picture back first.
        // Rapid taps share one request; a newer gesture or mode transition
        // revokes this intent even if its geometry callback arrives afterward.
        guard pendingMinimizeRequest == nil else { return }
        minimizeRequestTicket += 1
        let request = minimizeRequestTicket
        pendingMinimizeRequest = request
        let ticket = loadTicket, videoID = startupVideoID
        player.scrollView.setContentOffset(.zero, animated: true)
        measureVideo(after: 0.35) { [weak self] in
            guard let self, self.pendingMinimizeRequest == request else { return }
            self.pendingMinimizeRequest = nil
            guard self.minimizeRequestTicket == request, self.loadTicket == ticket,
                  self.startupVideoID == videoID, self.mode == .expanded,
                  self.ownsWatchPlayer, !self.dragging,
                  !self.playerOverlayOpen, !self.playerFullscreen, self.customFullscreenID == nil else { return }
            self.settle(.mini)
        }
    }

    @objc private func feedBack() {
        cancelVideoProbe()
        if feed.canGoBack {
            feed.goBack()
        } else if let state = feedTabs[activeFeedTab] {
            restoreFeedRoot(state, tab: activeFeedTab)
        }
    }

    private var feedHasBackDestination: Bool {
        guard let url = feed?.url else { return false }
        return FeedTab(url: url) == nil && !YouTubeWebView.isWatchPage(url)
    }

    @objc private func edgeBackDragged(_ pan: UIPanGestureRecognizer) {
        if StartupDiagnostics.enabled {
            let move = pan.translation(in: self), speed = pan.velocity(in: self)
            StartupDiagnostics.videoMark(["event": "edge-back-action", "state": pan.state.rawValue,
                "translationX": Double(move.x), "translationY": Double(move.y),
                "velocityX": Double(speed.x), "velocityY": Double(speed.y), "progress": Double(progress),
                "tracking": edgeBackTracking, "usesPicture": edgeBackUsesPicture,
                "pictureOnScreen": pictureOnScreen, "ownsWatchPlayer": ownsWatchPlayer,
                "mode": String(describing: mode), "feedOpening": feedOpening != nil])
        }
        if feedOpening != nil {
            if pan.state == .began { reverseFeedOpening() }
            return
        }
        switch pan.state {
        case .began:
            cancelVideoProbe()
            setNativeDragging(true)
            freezeSettle()
            freezeReveal()
            edgeBackTracking = true
            edgeBackUsesPicture = pictureOnScreen
            if edgeBackUsesPicture { beginVideoCrop() }
            dragging = edgeBackUsesPicture
            dragOrigin = progress
            if edgeBackUsesPicture { followEdgeBack(pan) }
        case .changed:
            if edgeBackTracking && edgeBackUsesPicture { followEdgeBack(pan) }
        case .ended, .cancelled, .failed:
            guard edgeBackTracking else { return }
            let speed = pan.state == .ended ? pan.velocity(in: self).x : 0
            let usesPicture = edgeBackUsesPicture
            let completion = usesPicture ? progress : pan.translation(in: self).x / edgeBackTravel
            let toMini = PlayerGesturePolicy.finishesMini(ended: pan.state == .ended, progress: completion, velocity: speed)
            if StartupDiagnostics.enabled {
                StartupDiagnostics.videoMark(["event": "edge-back-terminal", "state": pan.state.rawValue,
                    "completion": Double(completion), "speed": Double(speed), "toMini": toMini, "usesPicture": usesPicture])
            }
            traceEdgeWindowState("terminal")
            let traceTicket = loadTicket
            if StartupDiagnostics.enabled {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [weak self] in
                    guard let self, self.loadTicket == traceTicket else { return }
                    self.traceEdgeWindowState("settled")
                }
            }
            endDrag()
            if usesPicture {
                settle(toMini ? .mini : .expanded, speed: speed, travel: edgeBackTravel)
            } else if toMini {
                // In the comments, first bring the video back into the viewport;
                // cropping an offscreen WebKit video would produce an empty card.
                minimizePlayer()
            }
        default:
            break
        }
    }

    private var edgeBackTravel: CGFloat { max(1, bounds.width * 0.75) }

    private func followEdgeBack(_ pan: UIPanGestureRecognizer) {
        let t = min(1, max(0, dragOrigin + pan.translation(in: self).x / edgeBackTravel))
        progress = t
        // Direct manipulation follows the finger even with Reduce Motion; the
        // existing settle path then reaches its endpoint without an extra spring.
        UIView.performWithoutAnimation { apply(t) }
    }

    @objc private func startPlaybackTapped() {
        if !executingInteractionProbe { cancelVideoProbe() }
        if !startingWatchPlayback { initialPlaybackIntent?.finish() }
        guard mode == .expanded || (mode == .loading && startingWatchPlayback),
              !playerOverlayOpen, let url = player.url,
              let id = YouTubeWebView.videoID(url) else { return }
        if startupStatus.requiresReload {
            // Missing media or a fatal error may require a fresh document. This branch is
            // only reached by the separately labelled, explicit reload button.
            closePlayer()
            openWatch(url)
            return
        }
        guard let data = try? JSONEncoder().encode(id),
              let literal = String(data: data, encoding: .utf8) else { return }
        // This is one explicit user request. A failed bridge/guard also offers
        // Retry; neither a timer nor this callback retries playback.
        if id == loadingVideoID { videoLoadDiagnostics.mark(.playRequested, ticket: loadTicket) }
        let ticket = loadTicket
        let requestedPlayer = player
        let request = startupStatus.beginPlayRequest()
        let initialStart = startingVideoProbePlayback || startingWatchPlayback
        let script = initialStart
            ? PlayerStartupStatus.initialPlayJavaScript(videoID: id, play: true)
            : "window.__langformPlay && window.__langformPlay(\(literal))"
        player.evaluateJavaScript(script) { [weak self] result, error in
            guard let self, self.mode == .expanded || self.mode == .loading || (self.mode == .mini && initialStart),
                  self.loadTicket == ticket,
                  self.player === requestedPlayer,
                  YouTubeWebView.videoID(self.player?.url) == id else { return }
            guard error != nil || (result as? Bool) != true else { return }
            self.startupStatus.playRequestFailed(request: request)
            if self.initialPlaybackIntent?.matches(ticket: ticket, videoID: id) == true {
                self.initialPlaybackIntent?.finish()
            }
            self.updatePlaybackControls()
        }
    }

    private func updatePlaybackControls() {
        let visible = pictureRect.intersection(CGRect(origin: .zero, size: bounds.size))
        let mayShow = mode == .expanded && customFullscreenID == nil && !playerOverlayOpen && !dragging
            && !(settler != nil && settlingBetweenModes) && progress < 0.001
            && !visible.isNull && visible.height >= 80
        let showButton = mayShow && startupStatus.showsButton && !awaitingInitialPlayback
        startPlaybackButton.isHidden = !showButton
        if showButton {
            let title = startupStatus.buttonTitle
            if startPlaybackButton.configuration?.title != title {
                startPlaybackButton.configuration?.title = title
            }
            startPlaybackButton.accessibilityLabel = title
            let width = min(210, max(44, visible.width - 24))
            startPlaybackButton.frame = CGRect(x: visible.midX - width / 2, y: visible.midY - 22, width: width, height: 44)
        }
    }

    private func updateMissingMediaTimeout() {
        guard mode == .expanded, startupStatus.needsMediaTimeout,
              UIApplication.shared.applicationState == .active else {
            missingMediaTimeout?.cancel()
            missingMediaTimeout = nil
            return
        }
        guard missingMediaTimeout == nil, let id = YouTubeWebView.videoID(player.url) else { return }
        let ticket = loadTicket
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, self.mode == .expanded, self.loadTicket == ticket,
                  UIApplication.shared.applicationState == .active,
                  YouTubeWebView.videoID(self.player?.url) == id else { return }
            self.missingMediaTimeout = nil
            self.startupStatus.missingMediaTimedOut()
            self.updatePlaybackControls()
        }
        missingMediaTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: timeout)
    }

    private func updateChrome() {
        guard let feed else { return }
        if let player { synchronizeStageInsets(player) }
        recordMiniSurface()
        collapseButton.isHidden = customFullscreenID != nil || (!ownsWatchPlayer && feedOpening == nil)
        if feedOpening != nil { collapseButton.alpha = 1; bringSubviewToFront(collapseButton) }
        updateMissingMediaTimeout()
        updatePlaybackControls()
        setFeedActivity(feed, active: true)
        activatePendingFeedSearch()
        backButton.isHidden = !(mode != .expanded && feedHasBackDestination)
        // Only the view on top answers a tap on the status bar. Two candidates
        // and iOS scrolls neither.
        let playerOnTop = mode == .expanded
        feed.accessibilityElementsHidden = playerOnTop
        player?.accessibilityElementsHidden = !playerOnTop
        card.isAccessibilityElement = mode == .mini
        if feed.scrollView.scrollsToTop == playerOnTop { feed.scrollView.scrollsToTop = !playerOnTop }
        if let player, player.scrollView.scrollsToTop != playerOnTop { player.scrollView.scrollsToTop = playerOnTop }
        if showsPlayingState != videoPlaying {
            showsPlayingState = videoPlaying
            miniPlaybackButton.replaceSymbol(Self.symbol(videoPlaying ? "pause.fill" : "play.fill", size: 18))
            let playbackLabel = videoPlaying ? "Video pausieren" : "Video wiedergeben"
            miniPlaybackButton.accessibilityLabel = playbackLabel
            card.accessibilityValue = videoPlaying ? "Wiedergabe läuft" : "Pausiert"
            card.accessibilityCustomActions = [
                UIAccessibilityCustomAction(name: playbackLabel) { [weak self] _ in
                    self?.toggleMiniPlayback()
                    return true
                },
                UIAccessibilityCustomAction(name: "Video schließen") { [weak self] _ in
                    self?.closePlayer()
                    return true
                },
            ]
        }
        scheduleFeedPrewarm()
    }

    // MARK: Swipe down

    /// Some of the picture is in the viewport, at least a strip a finger can hit.
    private var pictureOnScreen: Bool {
        let shown = pictureRect.intersection(CGRect(origin: .zero, size: bounds.size))
        return !shown.isNull && shown.height > 40
    }

    private var dragTravel: CGFloat {
        max(80, miniFrame().minY - pictureRect.minY)
    }

    @objc private func dragPlayer(_ pan: UIPanGestureRecognizer) {
        switch pan.state {
        case .began:
            let entry = fullscreenEntryAdmission
            fullscreenEntryAdmission = nil
            let revokedEntry = fullscreenEntryAdmissionRevoked
            fullscreenEntryAdmissionRevoked = false
            cancelVideoProbe()
            if revokedEntry {
                drag.cancelsTouchesInView = false
                return
            }
            if let entry {
                guard fullscreenEntryAdmissionIsCurrent(entry) else {
                    drag.cancelsTouchesInView = false
                    return
                }
                fullscreenEnterDrag = true
                setNativeDragging(true)
                dragging = true
                StartupDiagnostics.mark("drag-fullscreen-enter-began")
                return
            }
            if playerFullscreen {
                fullscreenExitDrag = true
                requestFullscreenExit()
                StartupDiagnostics.mark("drag-fullscreen-exit")
                return
            }
            // A spring still running stops where the card is; the finger takes it from there.
            setNativeDragging(true)
            freezeSettle()
            freezeReveal()
            beginVideoCrop()
            dragging = true
            dragOrigin = progress
            dragRevealOrigin = card.transform.ty
            updateChrome()
            StartupDiagnostics.mark("drag-begin")
            // The scroll pan already waits for this recognizer. Disabling its
            // entire scroll view here sends WebKit an additional touch cancellation.
            follow(pan)
        case .changed:
            if fullscreenExitDrag || fullscreenEnterDrag { return }
            if dragging && !edgeBackTracking { follow(pan) }
        case .ended, .cancelled, .failed:
            fullscreenEntryAdmission = nil
            fullscreenEntryAdmissionRevoked = false
            if fullscreenExitDrag { endDrag(); return }
            if fullscreenEnterDrag {
                let commits = PlayerGesturePolicy.finishesFullscreenEntry(
                    ended: pan.state == .ended, translation: pan.translation(in: self), velocity: pan.velocity(in: self))
                let id = nativeDragVideoID, ticket = loadTicket
                endDrag()
                if commits, let id { enterFullscreenFromSwipe(videoID: id, ticket: ticket) }
                return
            }
            guard dragging && !edgeBackTracking else { return }
            let travel = dragTravel
            let speed = pan.state == .ended ? pan.velocity(in: self).y : 0
            endDrag()
            let toMini = PlayerGesturePolicy.finishesMini(ended: pan.state == .ended, progress: progress, velocity: speed, startedFromMini: mode == .mini)
            StartupDiagnostics.mark(toMini ? "drag-end-mini" : "drag-end-expanded")
            settle(toMini ? .mini : .expanded, speed: speed, travel: travel)
        default:
            break
        }
    }

    /// The card follows the finger: progress is the downward translation over the way to the card.
    /// Runs in the pan's own callback, once per touch frame, without a timer of its own.
    private func follow(_ pan: UIPanGestureRecognizer) {
        let pose = PlayerGesturePolicy.trackedPose(
            origin: dragOrigin, revealOffset: dragRevealOrigin,
            translation: pan.translation(in: self).y, travel: dragTravel
        )
        progress = pose.progress
        UIView.performWithoutAnimation {
            card.transform = CGAffineTransform(translationX: 0, y: pose.revealOffset)
            apply(pose.progress)
        }
    }

    private func endDrag() {
        // Close/load/stop may run after delegate admission but before began.
        // Preserve that contact's revocation until its terminal or next contact.
        revokeFullscreenEntryAdmission()
        setNativeDragging(false)
        dragging = false
        dragRevealOrigin = 0
        dragCanTakeOver = false
        edgeBackTracking = false
        edgeBackUsesPicture = false
        fullscreenExitDrag = false
        fullscreenEnterDrag = false
        drag.cancelsTouchesInView = false
    }

    private var dragPosition: PlayerGesturePolicy.Position? {
        switch mode {
        case .expanded: return .expanded
        case .mini: return .mini
        case .closed, .loading: return nil
        }
    }

    private var fullscreenEntryStateAllows: Bool {
        mode == .expanded && !playerFullscreen && customFullscreenID == nil && !playerOverlayOpen &&
            bounds.height > bounds.width && revealer == nil && !cardMoving && !dragCanTakeOver &&
            !edgeBackTracking && UIApplication.shared.applicationState == .active
    }

    private func acceptsFullscreenEntry(_ pan: UIPanGestureRecognizer) -> Bool {
        fullscreenEntryStateAllows &&
            PlayerGesturePolicy.canEnterFullscreen(translation: pan.translation(in: self), velocity: pan.velocity(in: self))
    }

    private func fullscreenEntryBinding() -> FullscreenEntryAdmission? {
        guard let player, let id = YouTubeWebView.videoID(player.url), id == startupVideoID else { return nil }
        return FullscreenEntryAdmission(videoID: id, ticket: loadTicket, player: ObjectIdentifier(player), mode: mode)
    }

    private func fullscreenEntryAdmissionIsCurrent(_ entry: FullscreenEntryAdmission) -> Bool {
        guard fullscreenEntryStateAllows, let player else { return false }
        return entry.mode == mode && entry.ticket == loadTicket && entry.player == ObjectIdentifier(player) &&
            YouTubeWebView.videoID(player.url) == entry.videoID && startupVideoID == entry.videoID
    }

    private func revokeFullscreenEntryAdmission() {
        if fullscreenEntryAdmission != nil { fullscreenEntryAdmissionRevoked = true }
        fullscreenEntryAdmission = nil
    }

    private func enterFullscreenFromSwipe(videoID: String, ticket: Int) {
        guard mode == .expanded, !playerFullscreen, customFullscreenID == nil,
              !playerOverlayOpen, !dragging, !cardMoving, loadTicket == ticket,
              bounds.height > bounds.width, let player,
              YouTubeWebView.videoID(player.url) == videoID, startupVideoID == videoID,
              let data = try? JSONEncoder().encode(videoID), let literal = String(data: data, encoding: .utf8) else { return }
        // endDrag queued the input unlock first; the live JS owner validates
        // media, ad, zoom, wireless and source ownership again before entering.
        player.evaluateJavaScript("window.__langformFullscreen && window.__langformFullscreen.enterForGesture(\(literal))")
    }

    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        if gestureRecognizer === edgeBack {
            guard !dragging, (mode == .expanded || feedOpening != nil),
                  !playerOverlayOpen, !playerFullscreen, customFullscreenID == nil else {
                if StartupDiagnostics.enabled {
                    StartupDiagnostics.videoMark(["event": "edge-back-admission", "phase": "should-begin",
                        "admitted": false, "reason": "state", "mode": String(describing: mode),
                        "dragging": dragging, "overlay": playerOverlayOpen, "fullscreen": playerFullscreen])
                }
                return false
            }
            let move = edgeBack.translation(in: self), speed = edgeBack.velocity(in: self)
            // UIKit can call a pan delegate before translation starts.
            // Only that exact zero case uses velocity; existing displacement
            // keeps ownership of its direction and cannot be overridden.
            let direction = move == .zero ? speed : move
            let admitted = direction.x > 0 && direction.x > abs(direction.y) * 1.5
            if StartupDiagnostics.enabled {
                StartupDiagnostics.videoMark(["event": "edge-back-admission", "phase": "should-begin",
                    "admitted": admitted, "reason": "direction", "translationX": Double(move.x),
                    "translationY": Double(move.y), "velocityX": Double(speed.x), "velocityY": Double(speed.y)])
            }
            guard admitted else { return false }
            if feedOpening == nil { cancelFeedPrewarm() }
            return true
        }
        guard gestureRecognizer === drag else { return super.gestureRecognizerShouldBegin(gestureRecognizer) }
        fullscreenEntryAdmission = nil
        fullscreenEntryAdmissionRevoked = false
        // Custom fullscreen owns its timeline and controls; a vertical scrub
        // must not become the card's exit gesture.
        guard customFullscreenID == nil else { return false }
        guard !edgeBackTracking else { return false }
        guard let position = dragPosition,
              PlayerGesturePolicy.allowsDrag(position: position, overlayOpen: playerOverlayOpen),
              YouTubeWebView.isWatchPage(player.url) else { return false }
        // Expanded moves down, mini moves up; a grab during a spring can redirect
        // either way. Sideways scrubs and taps remain with the page/card control.
        let entry = acceptsFullscreenEntry(drag) ? fullscreenEntryBinding() : nil
        fullscreenEntryAdmission = entry
        let begins = entry != nil || PlayerGesturePolicy.canBegin(
            position: position,
            isTransitioning: revealer != nil || (settler != nil && settlingBetweenModes),
            touchBeganWhileTransitioning: dragCanTakeOver,
            translation: drag.translation(in: self),
            velocity: drag.velocity(in: self)
        )
        // From here on the page gets touchcancel, so YouTube does not also act on
        // the drag. A tap never reaches this point and still plays.
        drag.cancelsTouchesInView = begins
        // Admission may fail before .began; only the action callback owns the
        // page input lock, paired with its actual terminal event.
        return begins
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        if gestureRecognizer === edgeBack {
            let contact = touch.location(in: self)
            let admitted = (mode == .expanded || feedOpening != nil) && !playerOverlayOpen
                && !playerFullscreen && customFullscreenID == nil && contact.x >= 0 && contact.x <= 12
                && !videoSeekOwnsEdgeContact(contact)
            if StartupDiagnostics.enabled {
                StartupDiagnostics.videoMark(["event": "edge-back-admission", "phase": "should-receive",
                    "admitted": admitted, "mode": String(describing: mode), "dragging": dragging,
                    "overlay": playerOverlayOpen, "fullscreen": playerFullscreen,
                    "touchX": Double(touch.location(in: self).x), "touchY": Double(touch.location(in: self).y),
                    "touchType": touch.type.rawValue, "boundsWidth": Double(bounds.width), "boundsHeight": Double(bounds.height)])
            }
            return admitted
        }
        if gestureRecognizer === cardTap {
            guard let view = touch.view else { return true }
            return !view.isDescendant(of: closeButton) && !view.isDescendant(of: miniPlaybackButton)
                && !view.isDescendant(of: startPlaybackButton)
        }
        guard gestureRecognizer === drag else { return true }
        fullscreenEntryAdmission = nil
        fullscreenEntryAdmissionRevoked = false
        guard customFullscreenID == nil else { return false }
        dragCanTakeOver = false
        if let view = touch.view,
           view.isDescendant(of: closeButton) || view.isDescendant(of: miniPlaybackButton)
                || view.isDescendant(of: startPlaybackButton) { return false }
        let interrupting = revealer != nil || (settler != nil && settlingBetweenModes)
        guard PlayerGesturePolicy.allowsDrag(position: dragPosition, overlayOpen: playerOverlayOpen),
              YouTubeWebView.isWatchPage(player.url) else { return false }
        // The visible part of the picture, without its bottom strip, which is YouTube's scrubber.
        // Keep the gesture's video-only region aligned with the picture currently
        // on screen, rather than its destination in the animation's model layer.
        let picture: CGRect
        if interrupting, let shownCard = card.layer.presentation() {
            // Reveal animates the ancestor card, so the player need not have
            // its own presentation layer. A settling player does have one.
            let inCard: CGRect
            if let shownPlayer = player.layer.presentation() {
                inCard = shownPlayer.convert(pictureRect, to: shownCard)
            } else {
                inCard = player.convert(pictureRect, to: card)
            }
            picture = shownCard.convert(inCard, to: layer.presentation() ?? layer)
        } else {
            picture = player.convert(pictureRect, to: self)
        }
        var band = picture.intersection(CGRect(origin: .zero, size: bounds.size))
        // A moving card is grabbed, not scrubbed. Reserving 44 points there
        // needlessly removed much of the mini card's remaining hit area.
        let scrubberInset = PlayerGesturePolicy.scrubberInset(position: mode == .mini ? .mini : .expanded, isTransitioning: interrupting)
        guard !band.isNull, band.height > scrubberInset + 8 else { return false }
        band.size.height -= scrubberInset
        let receives = band.contains(touch.location(in: self))
        // Keep a grab eligible if the spring happens to finish before UIKit
        // crosses its pan threshold; the finger still began on the moving card.
        dragCanTakeOver = receives && interrupting
        return receives
    }

    /// The page can claim touchmove through more than the outer scroll pan.
    /// Let its recognizers wait for this picture-only drag using their public
    /// view ancestry. Outside our hit region/direction this pan fails promptly,
    /// so comments, scrubbing and ordinary page gestures retain their input.
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        let isPlayerGesture = player.map { webView in
            otherGestureRecognizer.view?.isDescendant(of: webView) == true
        } ?? false
        if gestureRecognizer === edgeBack {
            return otherGestureRecognizer === drag || isPlayerGesture
        }
        return gestureRecognizer === drag && isPlayerGesture
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        // In particular, never let a WebKit tap recognize alongside the native
        // drag: its trailing touch must not also toggle the playing video.
        return false
    }

    // MARK: Where each view goes

    private func feedMoved() {
        if YouTubeWebView.isAccountTransition(feed.url) { evictCachedFeedsForAccountChange() }
        if YouTubeWebView.isPlayablePage(feed.url), let state = feedState(for: feed) {
            // SPA game routes bypass WKNavigationAction. Load a fresh root
            // instead of restoring a history item retaining its game context.
            state.refresh?.cancel()
            state.rootNavigation = feed.load(URLRequest(url: state.rootURL))
            return
        }
        if FeedTab(url: feed.url) != .home { cancelFeedPrewarm() }
        updateChrome()
        guard let url = feed.url, YouTubeWebView.isWatchPage(url) else { return }
        // YouTube navigated the feed itself. The video belongs in the player view.
        openWatch(url, userInitiated: true)
        if feed.canGoBack {
            feed.goBack()
        } else {
            feed.load(URLRequest(url: YouTubeWebView.homeURL(for: url)))
        }
    }

    private func playerMoved() {
        guard let url = player.url else { return }
        if YouTubeWebView.isWatchPage(url) {
            if mode == .loading && YouTubeWebView.videoID(url) != loadingVideoID { return }
            resetPlayerStartupForVideo(YouTubeWebView.videoID(url))
            resetPlayerOverlayForVideo(YouTubeWebView.videoID(url))
            if mode != .loading, YouTubeWebView.videoID(url) != loadingVideoID {
                videoLoadDiagnostics.finish(.superseded)
            }
            lastWatchURL = url
            updateMissingMediaTimeout()
            return
        }
        // URL KVO from the prepared Home shell can be delivered after a new
        // watch request starts. Only a committed new document may leave it.
        if mode == .loading && (!loadCommitted || loadingViaSPA) { return }
        guard mode != .closed else { return }
        if url.scheme == "about" {
            if mode == .loading { return }
            closePlayer()
            return
        }
        // A channel, search or the start page belongs to the feed.
        retirePlayerPage(to: url)
    }

    private func resetPlayerStartupForVideo(_ id: String?) {
        // YouTube can change videos without openWatch(). Reset the old video's
        // retry state and timer once, preserving a new report that beat URL KVO.
        guard startupVideoID != id else { return }
        watchBackgroundCategoryTransition("cancel")
        if let intent = initialPlaybackIntent, intent.videoID != id {
            initialPlaybackIntent = nil
            initialPlaybackCheckTicket = nil
        }
        if let intent = watchAudioIntent, intent.videoID != id { clearWatchAudioIntent() }
        startupVideoID = id
        videoSeekGeometry = nil
        missingMediaTimeout?.cancel()
        missingMediaTimeout = nil
        startupStatus = PlayerStartupStatus()
        videoPlaying = false
        updatePlaybackControls()
    }

    private func resetPlayerOverlayForVideo(_ id: String?) {
        // URL KVO reaches us asynchronously. Keep a current route's overlay
        // report even if it arrived first; release only the previous video's
        // lock so it cannot disable this video's drag or Start control.
        guard playerOverlayVideoID != id else { return }
        playerOverlayVideoID = nil
        playerOverlayOpen = false
        updatePlaybackControls()
    }

    private func showInFeed(_ url: URL, forceReload: Bool = false) {
        guard !YouTubeWebView.isPlayablePage(url), !YouTubeWebView.isPlayableResource(url) else { return }
        cancelPendingFeedSearch()
        if let tab = FeedTab(url: url) {
            activateFeedTab(tab, origin: url)
            return
        }
        let current = feed.url
        let same = current?.host == url.host && current?.path == url.path && current?.query == url.query
        if !same || forceReload {
            feed.load(URLRequest(url: url))
        }
    }

    private func openSearchInFeed() {
        guard ownsWatchPlayer, !playerFullscreen, customFullscreenID == nil, let feed else { return }
        if mode == .expanded { minimizePlayer() }
        cancelPendingFeedSearch()
        feedSearchTicket += 1
        pendingFeedSearch = (ObjectIdentifier(feed), feedSearchTicket)
        activatePendingFeedSearch()
    }

    private func cancelPendingFeedSearch() {
        dismissNativeSearch()
        pendingFeedSearch = nil
        feedSearchInFlight = nil
        feedSearchTicket += 1
        feed?.evaluateJavaScript("window.__langformCancelSearch && window.__langformCancelSearch()")
    }

    private func dismissNativeSearch() {
        nativeSearchOverlay?.cancel()
        nativeSearchOverlay?.removeFromSuperview()
        nativeSearchOverlay = nil
    }

    private func nativeSearchChanged(_ body: [String: Any], from webView: WKWebView) {
        guard webView === feed, feedState(for: webView)?.active == true,
              UIApplication.shared.applicationState == .active, !cardMoving,
              mode == .closed || mode == .mini,
              let href = body["href"] as? String, href == webView.url?.absoluteString else { return }
        let action = body["action"] as? String ?? "open"
        if action == "focus" {
            nativeSearchOverlay?.focus()
            return
        }
        if action == "filter" {
            guard let value = body["filter"] as? String, let filter = LangformSearchFilter(rawValue: value),
                  let current = webView.url, current.path == "/results",
                  let query = URLComponents(url: current, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "search_query" })?.value,
                  let url = LangformSearchPolicy.resultsURL(query: query, filter: filter) else { return }
            showInFeed(url)
            return
        }
        guard action == "open" else { return }
        if let value = body["ticket"] {
            guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                  number.doubleValue.isFinite, number.doubleValue >= 0, number.doubleValue <= 9_007_199_254_740_991,
                  number.doubleValue.rounded(.towardZero) == number.doubleValue,
                  let request = pendingFeedSearch, request.view == ObjectIdentifier(webView),
                  request.ticket == number.intValue, feedSearchInFlight == request.ticket else { return }
        }
        if let nativeSearchOverlay { nativeSearchOverlay.focus(); return }
        let parts = webView.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }
        let query = parts?.path == "/results" ? parts?.queryItems?.first(where: { $0.name == "search_query" })?.value ?? "" : ""
        let selected = query.isEmpty ? LangformSearchFilter.videos :
            (LangformSearchFilter(rawValue: body["filter"] as? String ?? "") ?? LangformSearchPolicy.filter(from: webView.url))
        let sourceURL = webView.url
        let sourceNavigation = feedState(for: webView)?.navigation
        let overlay = NativeSearchOverlay(query: query, filter: selected, recent: nativeSearchRecent)
        overlay.frame = bounds
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.onClose = { [weak self, weak overlay] in
            guard let self, let overlay, self.nativeSearchOverlay === overlay else { return }
            self.dismissNativeSearch()
        }
        overlay.onSubmit = { [weak self, weak overlay, weak webView] query, filter in
            guard let self, let overlay, let webView, self.nativeSearchOverlay === overlay,
                  self.feed === webView, webView.url == sourceURL,
                  self.feedState(for: webView)?.navigation === sourceNavigation,
                  self.feedState(for: webView)?.active == true, !self.cardMoving,
                  UIApplication.shared.applicationState == .active,
                  self.mode == .closed || self.mode == .mini,
                  let url = LangformSearchPolicy.resultsURL(query: query, filter: filter) else { return }
            self.nativeSearchRecent.removeAll { $0.caseInsensitiveCompare(query) == .orderedSame }
            self.nativeSearchRecent.insert(query, at: 0)
            self.nativeSearchRecent = Array(self.nativeSearchRecent.prefix(20))
            self.dismissNativeSearch()
            // The canonical Videos URL can equal an Unwatched document after
            // YouTube removed our extra parameter. A native Videos submission
            // explicitly clears that document's retained extra filter.
            self.showInFeed(url, forceReload: selected == .unwatched && filter == .videos)
        }
        nativeSearchOverlay = overlay
        addSubview(overlay)
        overlay.focus()
        UIAccessibility.post(notification: .screenChanged, argument: overlay)
    }

    private func activatePendingFeedSearch() {
        guard let feed, let request = pendingFeedSearch,
              request.view == ObjectIdentifier(feed), feedSearchInFlight == nil, !cardMoving,
              mode == .mini || mode == .closed, feedState(for: feed)?.active == true else { return }
        feedSearchInFlight = request.ticket
        feed.evaluateJavaScript("window.__langformOpenSearch ? window.__langformOpenSearch(\(request.ticket)) : false") { [weak self, weak feed] result, error in
            guard let self, let feed, self.feed === feed,
                  self.pendingFeedSearch?.ticket == request.ticket,
                  self.feedSearchInFlight == request.ticket else { return }
            // true only schedules a revocable frame. Its actual click/focus
            // acknowledgement owns consumption of this pending request.
            if error != nil || (result as? Bool) != true { self.feedSearchInFlight = nil }
        }
    }

    private func feedSearchChanged(_ body: [String: Any], from webView: WKWebView) {
        guard webView === feed, let request = pendingFeedSearch,
              request.view == ObjectIdentifier(webView),
              let ticket = body["ticket"] as? Int, ticket == request.ticket,
              feedSearchInFlight == ticket, let opened = body["opened"] as? Bool,
              let href = body["href"] as? String, let url = URL(string: href),
              url.scheme == "https", YouTubeWebView.isYouTube(url) else { return }
        // The search control may change history before URL KVO catches up.
        // Feed identity and the document-bound ticket own this acknowledgement.
        feedSearchInFlight = nil
        if opened { pendingFeedSearch = nil }
    }

    private func feedSearchDocumentChanged(_ webView: WKWebView) {
        guard webView === feed else { return }
        dismissNativeSearch()
        let hadSearch = feedSearchInFlight != nil || pendingFeedSearch?.view == ObjectIdentifier(webView)
        feedSearchInFlight = nil
        if let request = pendingFeedSearch, request.view == ObjectIdentifier(webView) {
            // A reload can keep the same URL. Old document acknowledgements
            // must not finish the next document's attempt for that URL.
            feedSearchTicket += 1
            pendingFeedSearch = (request.view, feedSearchTicket)
        }
        if hadSearch {
            webView.evaluateJavaScript("window.__langformCancelSearch && window.__langformCancelSearch()")
        }
    }

    private func retirePlayerPage(to url: URL) {
        // A search/channel document is page content, with no playable surface.
        // Remove it directly; never animate its renderer into a mini-player.
        showInFeed(url)
        openingMotion.cancel()
        card.isHidden = true
        closePlayer()
    }

    private func measureVideo(after delay: TimeInterval, _ done: @escaping () -> Void) {
        let ticket = loadTicket
        let viewport = viewportGeneration
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, self.mode != .closed, self.loadTicket == ticket, self.viewportGeneration == viewport else { return }
            self.player.evaluateJavaScript("window.__langformMeasureVideo ? window.__langformMeasureVideo() : null") { [weak self] result, _ in
                guard let self, self.mode != .closed, self.loadTicket == ticket, self.viewportGeneration == viewport else { return }
                self.takeVideoReport(result)
                done()
            }
        }
    }

    private func takeVideoReport(_ body: Any?) {
        guard mode != .closed, let dict = body as? [String: Any] else { return }
        if mode == .loading {
            if loadingViaSPA {
                guard dict["navigationToken"] as? String == String(loadTicket),
                      dict["navigationTargetID"] as? String == loadingVideoID else { return }
                // The router starts before location.href changes. Accept only
                // its ticket-bound acknowledgement at this stage, no old media.
                if dict["navigationStarted"] as? Bool == true {
                    spaStartTimeout?.cancel()
                    spaStartTimeout = nil
                }
                guard dict["playerVideoID"] as? String == loadingVideoID else { return }
            } else {
                // A retry can still receive an old report until the new document
                // commits; a late SPA report must not reveal the fallback page.
                guard loadCommitted, (dict["navigationToken"] as? String ?? "").isEmpty else { return }
            }
        }
        guard let href = dict["href"] as? String,
              let id = YouTubeWebView.videoID(URL(string: href)),
              id == (mode == .loading ? loadingVideoID : YouTubeWebView.videoID(player.url)) else { return }
        resetPlayerStartupForVideo(id)
        if mode == .loading, dict["playerVideoID"] as? String == loadingVideoID {
            // The prepared home document stays silent until the requested
            // watch player has actually taken ownership of its media.
            resumePreparedPlayer()
        }
        func number(_ key: String) -> CGFloat {
            guard let value = dict[key] as? NSNumber else { return 0 }
            let result = CGFloat(truncating: value)
            return result.isFinite ? result : 0
        }
        let rect = CGRect(x: number("x"), y: number("y"), width: number("width"), height: number("height"))
        let hasVideo = dict["hasVideo"] as? Bool == true
        // Recommendations navigated by YouTube's own router are not attributed
        // to an earlier native request. Old tickets are rejected by the recorder.
        if id == loadingVideoID {
            if hasVideo { videoLoadDiagnostics.mark(.firstMedia, ticket: loadTicket) }
            if dict["painted"] as? Bool == true { videoLoadDiagnostics.mark(.painted, ticket: loadTicket) }
            if dict["mediaReady"] as? Bool == true { videoLoadDiagnostics.mark(.mediaReady, ticket: loadTicket) }
            if hasVideo, dict["kind"] as? String != "playback",
               dict["mediaReady"] as? Bool == true, dict["mediaPresented"] as? Bool == true,
               (dict["playerVideoID"] as? String ?? id) == id {
                videoLoadDiagnostics.mark(.mediaPresented, ticket: loadTicket)
            }
            switch dict["playbackState"] as? String {
            case "playing": videoLoadDiagnostics.mark(.playing, ticket: loadTicket)
            case "unstarted": videoLoadDiagnostics.mark(.unstarted, ticket: loadTicket)
            case "buffering": videoLoadDiagnostics.mark(.buffering, ticket: loadTicket)
            case "paused": videoLoadDiagnostics.mark(.paused, ticket: loadTicket)
            default: break
            }
            if dict["playbackIssue"] as? String == "rejected" {
                videoLoadDiagnostics.mark(.rejected, ticket: loadTicket)
            }
        } else {
            videoLoadDiagnostics.finish(.superseded)
        }
        if let fullscreen = dict["fullscreen"] as? Bool {
            playerFullscreen = customFullscreenID != nil || fullscreen
            if playerFullscreen { cancelPendingMinimize() }
        }
        startupStatus.receive(state: dict["playbackState"] as? String,
                              issue: dict["playbackIssue"] as? String, hasVideo: hasVideo)
        startWatchAudioIfEligible(id: id)
        if initialPlaybackIntent?.matches(ticket: loadTicket, videoID: id) == true,
           !loadingViaSPA || dict["navigationMediaLoaded"] as? Bool == true {
            initialPlaybackIntent?.observe(startupStatus.state)
        }
        // WebKit owns the media and its audio session. Reports update UI only;
        // activating a separate native session can interrupt resumed playback.
        if hasVideo, let playing = dict["playing"] as? Bool {
            videoPlaying = playing
            if !playing && backgroundCategoryHandoff?.preservesVisibility != true { watchBackgroundCategoryTransition("cancel") }
        }
        if dict["kind"] as? String == "playback" {
            // Scroll-time status packets contain no geometry or readiness.
            // Applying their absent fields would clear the crop or reveal an
            // old document. Keep the identity guards above and only update UI.
            updateChrome()
            startInitialPlaybackIfEligible(id: id)
            return
        }
        startupStatus.receivePicture(mediaPresented: dict["mediaPresented"] as? Bool,
                                     mediaReady: dict["mediaReady"] as? Bool,
                                     frameObservationSupported: dict["frameObservationSupported"] as? Bool)
        if mode == .expanded && !startupStatus.keepsStartupPoster {
            finishFeedOpeningIfReady()
            openingMotion.complete()
        }
        if mode == .loading {
            if loadingViaSPA {
                if dict["navigationComplete"] as? Bool == true, dict["mediaReady"] as? Bool == true {
                    loadMediaReady = true
                }
            } else {
                if hasVideo { loadHasVideo = true }
                if dict["painted"] as? Bool == true { loadPainted = true }
                if dict["mediaReady"] as? Bool == true { loadMediaReady = true }
            }
        }
        let viewport = CGSize(width: number("viewportWidth"), height: number("viewportHeight"))
        if customFullscreenEnter == nil && customFullscreenExit == nil && PlayerViewportPolicy.matches(reported: viewport, current: player.bounds.size) {
            let seekFields = dict["seekRect"] as? [String: Any]
            let seekRect: CGRect? = seekFields.flatMap { fields in
                guard fields["videoID"] as? String == id,
                      let x = fields["x"] as? NSNumber, let y = fields["y"] as? NSNumber,
                      let width = fields["width"] as? NSNumber, let height = fields["height"] as? NSNumber else { return nil }
                return CGRect(x: CGFloat(x.doubleValue), y: CGFloat(y.doubleValue),
                              width: CGFloat(width.doubleValue), height: CGFloat(height.doubleValue))
            }
            rememberVideoSeekGeometry(rect, videoID: id, playerVideoID: dict["playerVideoID"] as? String,
                                      hasVideo: hasVideo, viewport: viewport, seekRect: seekRect,
                                      allowDisjointSeek: dict["playbackState"] as? String == "ended")
            let valid = rect.width > 8 && rect.height > 8
            // Playback state above remains independent from geometry. A queued
            // pre-rotation rect can never replace the new crop or pending rect.
            if cardMoving {
                if valid { pendingRect = rect }
            } else if valid {
                if rect != videoRect || awaitingViewportGeometry {
                    pendingRect = rect
                    flushPendingRect()
                }
            } else if mode == .expanded || mode == .loading {
                // The card keeps its last picture; an empty rect only counts in the full player.
                videoRect = .zero
            }
        }
        if mode != .loading, (dict["hasVideo"] as? NSNumber)?.boolValue == true, let url = pendingTimestampURL {
            seekTappedLink(url)
        }
        updateChrome()
        considerReveal()
        startInitialPlaybackIfEligible(id: id)
        advanceVideoProbe(dict, id: id)
        if (dict["playing"] as? NSNumber)?.boolValue == true && (dict["mediaReady"] as? NSNumber)?.boolValue == true {
            recordBackgroundPlaybackTransition("watch-ready")
        }
        finishPhysicalRotationIntent()
    }

    /// Separate exact opt-in; no background task, polling or playback changes.
    private func recordBackgroundPlaybackTransition(_ phase: String) {
        guard StartupDiagnostics.enabled, backgroundPlaybackProbe != nil else { return }
        if phase != "watch-ready" {
            backgroundPlaybackWork.forEach { $0.cancel() }
            backgroundPlaybackWork.removeAll()
        }
        guard phase != "cancel", mode == .expanded || mode == .mini,
              !systemMediaSuspendedForOffline, let player,
              let id = YouTubeWebView.videoID(player.url), id == backgroundPlaybackProbe?.videoID,
              let remaining = backgroundPlaybackProbe?.samples, remaining < BackgroundPlaybackProbe.maximumSamples else { return }
        sampleBackgroundPlayback(phase)
        guard phase == "did-enter-background", backgroundPlaybackProbe!.samples < BackgroundPlaybackProbe.maximumSamples else { return }
        let ticket = loadTicket
        for delay in [2.0, 6.0] {
            let work = DispatchWorkItem { [weak self, weak player] in
                guard let self, let player, self.player === player, self.loadTicket == ticket,
                      YouTubeWebView.videoID(player.url) == id,
                      UIApplication.shared.applicationState == .background else { return }
                self.sampleBackgroundPlayback(delay == 2 ? "background+2s" : "background+6s")
            }
            backgroundPlaybackWork.append(work)
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
        }
    }

    private func sampleBackgroundPlayback(_ phase: String) {
        guard StartupDiagnostics.enabled, mode == .expanded || mode == .mini,
              !systemMediaSuspendedForOffline, let player,
              let id = YouTubeWebView.videoID(player.url),
              let number = backgroundPlaybackProbe?.claim(phase: phase, videoID: id),
              let script = backgroundPlaybackProbe?.snapshotJavaScript() else { return }
        let ticket = loadTicket, requested = ProcessInfo.processInfo.systemUptime
        let requestedState = UIApplication.shared.applicationState.rawValue
        let request: [String: Any] = ["event": "background-audio-probe", "phase": phase,
                                    "sample": number, "ticket": ticket,
                                    "requestedApplicationState": requestedState,
                                    "requestedUptime": requested]
        var initial = request; initial["kind"] = "requested"
        StartupDiagnostics.videoMark(initial)
        player.requestMediaPlaybackState { [weak self, weak player] state in
            guard let self, let player, self.player === player, self.loadTicket == ticket,
                  self.mode == .expanded || self.mode == .mini, !self.systemMediaSuspendedForOffline,
                  YouTubeWebView.videoID(player.url) == id else { return }
            var entry = request; entry["kind"] = "webkit"
            entry["completionApplicationState"] = UIApplication.shared.applicationState.rawValue
            entry["completionMilliseconds"] = max(0, (ProcessInfo.processInfo.systemUptime - requested) * 1000)
            entry["mediaPlaybackState"] = state.rawValue
            StartupDiagnostics.videoMark(entry)
        }
        player.evaluateJavaScript(script) { [weak self, weak player] result, error in
            guard let self, let player, self.player === player, self.loadTicket == ticket,
                  self.mode == .expanded || self.mode == .mini, !self.systemMediaSuspendedForOffline,
                  YouTubeWebView.videoID(player.url) == id else { return }
            var entry = request; entry["kind"] = "javascript"
            entry["completionApplicationState"] = UIApplication.shared.applicationState.rawValue
            entry["completionMilliseconds"] = max(0, (ProcessInfo.processInfo.systemUptime - requested) * 1000)
            entry["error"] = error != nil
            entry["snapshot"] = BackgroundPlaybackProbe.sanitized(result as? [String: Any] ?? [:])
            StartupDiagnostics.videoMark(entry)
        }
    }

    /// Current Watch background leases are source-bound. Explicit diagnostic
    /// comparisons remain isolated; a category declaration never plays media.
    private func watchBackgroundCategoryTransition(_ phase: String) {
        guard let handoff = backgroundCategoryHandoff else { return }
        if phase == "cancel" || phase == "foreground" {
            handoff.cancel()
            let previous = backgroundCategoryRequest
            backgroundCategoryRequest = nil
            backgroundContinuationRevoked = true
            if phase == "foreground", handoff.preservesVisibility {
                player?.evaluateJavaScript("window.__langformWatchBackgroundAudio && window.__langformWatchBackgroundAudio.foreground(\(backgroundCategorySerial))")
            } else if let previous, let player,
                      let data = try? JSONSerialization.data(withJSONObject: [previous.id, previous.ticket, previous.number]),
                      let arguments = String(data: data, encoding: .utf8) {
                player.evaluateJavaScript("window.__langformWatchBackgroundAudio && window.__langformWatchBackgroundAudio.cancel(...\(arguments))")
            }
            return
        }
        if phase == "interrupt" || phase == "did-enter-background" {
            guard handoff.preservesVisibility, let current = backgroundCategoryRequest, let player,
                  current.ticket == loadTicket, YouTubeWebView.videoID(player.url) == current.id,
                  let data = try? JSONSerialization.data(withJSONObject: [current.id, current.ticket, current.number]),
                  let arguments = String(data: data, encoding: .utf8) else { return }
            if phase == "interrupt" {
                backgroundContinuationRevoked = true
                handoff.cancel()
            }
            let action = phase == "interrupt" ? "interrupt" : "background"
            player.evaluateJavaScript("window.__langformWatchBackgroundAudio && window.__langformWatchBackgroundAudio.\(action)(...\(arguments))")
            return
        }
        guard phase == "will-resign-active", backgroundCategoryRequest == nil,
              mode == .expanded || mode == .mini, videoPlaying || handoff.preservesVisibility, !dragging,
              !systemMediaSuspendedForOffline, let player,
              let id = YouTubeWebView.videoID(player.url), id == startupVideoID, (handoff.videoID == nil || handoff.videoID == id),
              let data = try? JSONSerialization.data(withJSONObject: [id, loadTicket, backgroundCategorySerial + 1, handoff.preservesVisibility]),
              let arguments = String(data: data, encoding: .utf8) else { return }
        backgroundCategorySerial += 1
        backgroundContinuationRevoked = backgroundAudioInterrupted
        let number = backgroundCategorySerial, ticket = loadTicket
        backgroundCategoryRequest = (number, ticket, id, nil)
        let requestedState = UIApplication.shared.applicationState.rawValue
        player.evaluateJavaScript("window.__langformWatchBackgroundAudio ? window.__langformWatchBackgroundAudio.capture(...\(arguments)) : ({accepted:false})") { [weak self, weak player] result, error in
            guard let self, let player, self.player === player, self.loadTicket == ticket,
                  self.backgroundCategoryRequest?.number == number, self.backgroundCategoryRequest?.ticket == ticket,
                  self.mode == .expanded || self.mode == .mini, self.videoPlaying || handoff.preservesVisibility, !self.dragging,
                  !self.systemMediaSuspendedForOffline, YouTubeWebView.videoID(player.url) == id,
                  self.startupVideoID == id, UIApplication.shared.applicationState != .active else { return }
            guard error == nil, let values = result as? [String: Any], values["accepted"] as? Bool == true,
                  values["videoID"] as? String == id, values["ticket"] as? Int == ticket,
                  values["request"] as? Int == number, let token = values["token"] as? Int, token > 0 else {
                StartupDiagnostics.videoMark(["event": "background-category-probe", "kind": "capture-rejected",
                                              "ticket": ticket, "request": number,
                                              "requestedApplicationState": requestedState,
                                              "completionApplicationState": UIApplication.shared.applicationState.rawValue])
                self.watchBackgroundCategoryTransition("cancel")
                return
            }
            self.backgroundCategoryRequest = (number, ticket, id, token)
            if handoff.preservesVisibility && (values["mayContinue"] as? Bool != true || self.backgroundContinuationRevoked) {
                self.watchBackgroundCategoryTransition("interrupt")
                StartupDiagnostics.videoMark(["event": "background-visibility-probe", "kind": "source-retained-paused",
                                              "ticket": ticket, "request": number, "token": token])
                return
            }
            let owner = WatchBackgroundAudioCategoryHandoff.Owner(videoID: id, ticket: ticket, token: token)
            handoff.request(owner) { [weak self, weak player] outcome in
                guard let self else { return }
                let current = outcome.current && player != nil && self.player === player && self.loadTicket == ticket &&
                    self.backgroundCategoryRequest?.number == number && self.backgroundCategoryRequest?.token == token &&
                    (self.mode == .expanded || self.mode == .mini) && (self.videoPlaying || handoff.preservesVisibility) &&
                    (!handoff.preservesVisibility || !self.backgroundContinuationRevoked) && !self.systemMediaSuspendedForOffline &&
                    YouTubeWebView.videoID(player?.url) == id && UIApplication.shared.applicationState != .active
                StartupDiagnostics.videoMark(["event": "background-category-probe", "kind": "result",
                                              "ticket": ticket, "request": number, "token": token,
                                              "applied": outcome.applied, "failed": outcome.failed, "current": current,
                                              "categoryMilliseconds": outcome.milliseconds,
                                              "categoryBefore": outcome.categoryBefore ?? "not-called",
                                              "categoryAfter": outcome.categoryAfter ?? "not-called",
                                              "requestedApplicationState": requestedState,
                                              "completionApplicationState": UIApplication.shared.applicationState.rawValue])
                if handoff.preservesVisibility, current, outcome.applied,
                   let data = try? JSONSerialization.data(withJSONObject: [id, ticket, number, token, true]),
                   let arguments = String(data: data, encoding: .utf8) {
                    player?.evaluateJavaScript("window.__langformWatchBackgroundAudio && window.__langformWatchBackgroundAudio.categoryReady(...\(arguments))")
                }
            }
        }
    }

    /// One host output snapshot, correlated with existing page rows. The
    /// budget is claimed before any AVAudioSession getter; normal launches do
    /// not read the session and no observation activates or changes playback.
    private func recordAudioRouteSnapshot(kind: String, callbackUptime: Double,
                                          previousRoute: AVAudioSessionRouteDescription? = nil, routeReason: String? = nil,
                                          interruptionType: String? = nil, shouldResume: Bool? = nil,
                                          interruptionReason: String? = nil, playerRow: [String: Any]? = nil) {
        guard StartupDiagnostics.audioRouteProbeEnabled, audioRouteProbe != nil,
              mode == .expanded || mode == .mini, let player,
              let id = YouTubeWebView.videoID(player.url), startupVideoID == id else { return }
        let now = ProcessInfo.processInfo.systemUptime
        guard let sample = audioRouteProbe?.claim(kind: kind, uptime: now) else { return }
        let session = AVAudioSession.sharedInstance()
        var values: [String: Any] = ["kind": kind, "sample": sample, "ticket": loadTicket,
            "callbackUptime": callbackUptime, "snapshotUptime": now,
            "applicationState": UIApplication.shared.applicationState.rawValue,
            "systemOutputVolume": Double(session.outputVolume), "category": session.category.rawValue,
            "mode": session.mode.rawValue,
            "outputTypes": AudioRouteProbe.outputTypes(session.currentRoute.outputs.map { $0.portType.rawValue }),
            "preparationSuspended": playerPreparationSuspended, "offlinePlayback": systemMediaSuspendedForOffline,
            "categoryHandoffPending": backgroundCategoryRequest != nil]
        if let previousRoute { values["previousOutputTypes"] = AudioRouteProbe.outputTypes(previousRoute.outputs.map { $0.portType.rawValue }) }
        if let routeReason { values["routeReason"] = routeReason }
        if let interruptionType { values["interruptionType"] = interruptionType }
        if let shouldResume { values["shouldResume"] = shouldResume }
        if let interruptionReason { values["interruptionReason"] = interruptionReason }
        var entry = AudioRouteProbe.sanitized(values)
        entry["event"] = "audio-route-probe"
        if let playerRow, let page = PlayerDiagnosticEvent.sanitized(playerRow) { entry["page"] = page }
        StartupDiagnostics.videoMark(entry)
    }

    private func recordAudioRoutePlayerRows(_ rows: [[String: Any]]) {
        guard StartupDiagnostics.audioRouteProbeEnabled, audioRouteProbe != nil,
              let row = rows.suffix(32).reversed().compactMap({ PlayerDiagnosticEvent.sanitized($0) })
                .first(where: { $0["hasVideo"] as? Bool == true && $0["playerMatches"] as? Bool == true }) else { return }
        recordAudioRouteSnapshot(kind: "player-state", callbackUptime: ProcessInfo.processInfo.systemUptime, playerRow: row)
    }

    private func observeAudioRouteInterruption(_ notification: Notification) {
        if StartupDiagnostics.audioRouteProbeEnabled {
            let callbackUptime = ProcessInfo.processInfo.systemUptime
            let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            let kind = raw == AVAudioSession.InterruptionType.began.rawValue ? "began" :
                raw == AVAudioSession.InterruptionType.ended.rawValue ? "ended" : "unknown"
            let shouldResume = (notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt)
                .map { AVAudioSession.InterruptionOptions(rawValue: $0).contains(.shouldResume) }
            // The old suspension flag is unsupported. Keep this existing
            // cross-version observer passive; without a supported deactivation
            // context, the reason is unknown rather than inferred from legacy keys.
            let observe: () -> Void = { [weak self] in
                self?.recordAudioRouteSnapshot(kind: "interruption", callbackUptime: callbackUptime,
                                               interruptionType: kind, shouldResume: shouldResume, interruptionReason: "unknown")
            }
            if Thread.isMainThread { observe() } else { DispatchQueue.main.async(execute: observe) }
        }
    }

    @objc private func audioRouteDiagnosticInterruption(_ notification: Notification) {
        observeAudioRouteInterruption(notification)
    }

    @objc private func audioRouteDiagnosticRouteChange(_ notification: Notification) {
        observeAudioRouteChange(notification)
    }

    @objc private func backgroundAudioInterruption(_ notification: Notification) {
        observeAudioRouteInterruption(notification)
        guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .began { backgroundCategoryHandoff?.cancel() }
        let update = { [weak self] in
            guard let self else { return }
            self.backgroundAudioInterrupted = type == .began
            if type == .began { self.watchBackgroundCategoryTransition("interrupt") }
        }
        if Thread.isMainThread { update() } else { DispatchQueue.main.async(execute: update) }
    }

    private func observeAudioRouteChange(_ notification: Notification) {
        if StartupDiagnostics.audioRouteProbeEnabled {
            let callbackUptime = ProcessInfo.processInfo.systemUptime
            let reason = AudioRouteProbe.routeReason(notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt)
            let previous = notification.userInfo?[AVAudioSessionRouteChangePreviousRouteKey] as? AVAudioSessionRouteDescription
            let observe: () -> Void = { [weak self] in
                self?.recordAudioRouteSnapshot(kind: "route-change", callbackUptime: callbackUptime,
                                               previousRoute: previous, routeReason: reason)
            }
            if Thread.isMainThread { observe() } else { DispatchQueue.main.async(execute: observe) }
        }
    }

    @objc private func backgroundAudioRouteChanged(_ notification: Notification) {
        observeAudioRouteChange(notification)
        guard let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
        backgroundCategoryHandoff?.cancel()
        let update = { [weak self] in
            guard let self else { return }
            self.watchBackgroundCategoryTransition("interrupt")
        }
        if Thread.isMainThread { update() } else { DispatchQueue.main.async(execute: update) }
    }

    // MARK: Messages

    /// An opt-in, bounded diagnostic uses the production fullscreen path after
    /// settled playback. The ordinary eight-step interaction plan is unchanged.
    private func startFullscreenDiagnosticProbeBeforeClose(_ request: PlayerInteractionProbe.Request) -> Bool {
        guard StartupDiagnostics.enabled, ProcessInfo.processInfo.environment["LANGFORM_FULLSCREEN_PROBE"] == "1",
              PlayerInteractionProbe() != nil, VideoLoadProbe() != nil,
              request.step == .close, interactionProbe?.state == .running, interactionProbe?.pending == request,
              fullscreenDiagnosticCompletedTicket != loadTicket else { return false }
        let environment = ProcessInfo.processInfo.environment
        guard let cycles = Int(environment["LANGFORM_FULLSCREEN_PROBE_CYCLES"] ?? "1"), (1...6).contains(cycles),
              let holdMilliseconds = Int(environment["LANGFORM_FULLSCREEN_PROBE_HOLD_MS"] ?? "3000"),
              (200...3000).contains(holdMilliseconds) else { return false }
        if fullscreenDiagnosticPending != nil { return true }
        guard UIApplication.shared.applicationState == .active, mode == .expanded,
              !dragging, !cardMoving, !playerOverlayOpen, customFullscreenID == nil,
              videoPlaying, startupStatus.state == .playing, let player,
              let id = YouTubeWebView.videoID(player.url), startupVideoID == id else { return false }
        let token = UUID().uuidString, ticket = loadTicket
        fullscreenDiagnosticPending = (id, ticket, token, request)
        interactionProbeWork?.cancel(); interactionProbeWork = nil
        interactionProbeTimeout?.cancel()
        StartupDiagnostics.mark("fullscreen-probe-started")
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, self.fullscreenDiagnosticPending?.token == token else { return }
            self.cancelFullscreenDiagnosticProbe(timedOut: true)
        }
        fullscreenDiagnosticTimeout = timeout
        let timeoutSeconds = min(60.0, 4.0 + Double(cycles) * (4.0 + 2.0 * Double(holdMilliseconds) / 1000.0))
        DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds, execute: timeout)
        guard let data = try? JSONSerialization.data(withJSONObject: [id, token, cycles, holdMilliseconds]),
              let arguments = String(data: data, encoding: .utf8) else {
            cancelFullscreenDiagnosticProbe(); return true
        }
        player.evaluateJavaScript("window.__langformFullscreenDiagnosticProbe && window.__langformFullscreenDiagnosticProbe.run.apply(null, \(arguments))") { [weak self, weak player] result, error in
            guard let self, self.fullscreenDiagnosticPending?.token == token else { return }
            guard self.player === player, self.loadTicket == ticket,
                  UIApplication.shared.applicationState == .active, error == nil, result as? Bool == true else {
                self.cancelFullscreenDiagnosticProbe(); return
            }
        }
        return true
    }

    private func cancelFullscreenDiagnosticProbe(timedOut: Bool = false) {
        guard let pending = fullscreenDiagnosticPending else { return }
        fullscreenDiagnosticPending = nil
        fullscreenDiagnosticTimeout?.cancel(); fullscreenDiagnosticTimeout = nil
        interactionProbe?.cancel()
        interactionProbeWork?.cancel(); interactionProbeWork = nil
        interactionProbeTimeout?.cancel()
        StartupDiagnostics.mark(timedOut ? "fullscreen-probe-timeout" : "fullscreen-probe-cancelled")
        if let data = try? JSONSerialization.data(withJSONObject: [pending.token]),
           let arguments = String(data: data, encoding: .utf8) {
            player?.evaluateJavaScript("window.__langformFullscreenDiagnosticProbe && window.__langformFullscreenDiagnosticProbe.cancel.apply(null, \(arguments))")
        }
    }

    private func fullscreenDiagnosticChanged(_ body: [String: Any]) {
        guard StartupDiagnostics.enabled, let pending = fullscreenDiagnosticPending,
              pending.ticket == loadTicket, interactionProbe?.state == .running,
              interactionProbe?.pending == pending.request, mode == .expanded,
              body["videoID"] as? String == pending.videoID, body["token"] as? String == pending.token,
              let href = body["href"] as? String, YouTubeWebView.videoID(URL(string: href)) == pending.videoID,
              YouTubeWebView.videoID(player?.url) == pending.videoID,
              let phase = body["phase"] as? String,
              ["opened", "inline", "finished", "cancelled", "timeout"].contains(phase) else { return }
        guard UIApplication.shared.applicationState == .active else { cancelFullscreenDiagnosticProbe(); return }
        if phase == "cancelled" || phase == "timeout" {
            cancelFullscreenDiagnosticProbe(timedOut: phase == "timeout"); return
        }
        if phase == "opened" {
            guard customFullscreenID == pending.videoID, customFullscreenEnter == nil, customFullscreenExit == nil else { return }
            StartupDiagnostics.mark("fullscreen-probe-opened")
            return
        }
        guard customFullscreenID == nil, customFullscreenEnter == nil, customFullscreenExit == nil else { return }
        if phase == "inline" { StartupDiagnostics.mark("fullscreen-probe-inline"); return }
        fullscreenDiagnosticTimeout?.cancel(); fullscreenDiagnosticTimeout = nil
        fullscreenDiagnosticPending = nil
        fullscreenDiagnosticCompletedTicket = pending.ticket
        StartupDiagnostics.mark("fullscreen-probe-finished")
        scheduleInteractionAction(pending.request)
    }

    private func customFullscreenChanged(_ body: [String: Any]) {
        guard let open = body["open"] as? Bool,
              let id = body["videoID"] as? String,
              let href = body["href"] as? String,
              YouTubeWebView.videoID(URL(string: href)) == id else { return }
        StartupDiagnostics.videoMark([
            "event": "fullscreen-request", "open": open,
            "mode": String(describing: mode), "dragging": dragging,
            "matchesURL": YouTubeWebView.videoID(player?.url) == id,
            "reason": body["reason"] as? String ?? ""
        ])
        if !open {
            guard customFullscreenID == id else { return }
            var opensSearchInFeed = false
            if body["kind"] as? String == "exit-commit" {
                guard let exit = customFullscreenExit, exit.videoID == id,
                      exit.token == body["token"] as? String, exit.ticket == loadTicket else { return }
                opensSearchInFeed = exit.opensSearchInFeed && YouTubeWebView.videoID(player?.url) == id
            }
            resetCustomFullscreen()
            updateChrome()
            measureVideo(after: 0) {}
            if opensSearchInFeed { openSearchInFeed() }
            return
        }
        guard mode == .expanded, !dragging,
              YouTubeWebView.videoID(player?.url) == id else { return }
        guard customFullscreenID != id else { return }
        let entryToken = body["kind"] as? String == "enter-request" ? body["token"] as? String : nil
        if body["kind"] as? String == "enter-request", entryToken?.isEmpty != false { return }
        freezeSettle()
        freezeReveal()
        progress = 0
        card.transform = .identity
        restoreExpandedSurface()
        apply(0)
        customFullscreenExit = nil
        customFullscreenID = id
        customFullscreenEnter = entryToken.map { CustomFullscreenEnter(videoID: id, token: $0, ticket: loadTicket) }
        if StartupDiagnostics.enabled, let entryToken {
            fullscreenGeometryTrace = (id, entryToken, loadTicket, ProcessInfo.processInfo.systemUptime, 0)
            fullscreenGeometryDirection = "enter"
            startFullscreenPresentation(videoID: id, token: entryToken, direction: "enter")
        }
        playerFullscreen = true
        fullscreenSelectionFeedback.prepare()
        onFullscreen?(true)
        requestPlayerOrientation(.landscape, onRejected: { [weak self] in
            guard let self, let entryToken, self.customFullscreenEnter?.token == entryToken,
                  self.customFullscreenEnter?.ticket == self.loadTicket else { return }
            self.customFullscreenEnter?.allowsCurrentOrientation = true
            self.confirmCustomFullscreenEnter()
        })
        if entryToken != nil { setNeedsLayout(); confirmCustomFullscreenEnter() }
        updateChrome()
    }

    private func pendingPhysicalFullscreenExitSource(videoID: String) -> CGSize? {
        guard let pending = pendingPhysicalFullscreenExit, let player,
              activeRotationCoordinator != nil, mode == .expanded,
              pending.videoID == videoID, pending.ticket == loadTicket,
              pending.rotationGeneration == nativeRotationGeneration,
              pending.player == ObjectIdentifier(player), customFullscreenID == videoID,
              YouTubeWebView.videoID(player.url) == videoID,
              let target = nativeRotationTarget, target.height > target.width,
              ProcessInfo.processInfo.systemUptime <= pending.expiresAt else { return nil }
        return pending.sourceViewport
    }

    private func fullscreenPlayerViewport(default viewport: CGSize) -> CGSize {
        if let id = customFullscreenID, let source = pendingPhysicalFullscreenExitSource(videoID: id) { return source }
        guard let exit = customFullscreenExit, exit.ticket == loadTicket,
              mode == .expanded, customFullscreenID == exit.videoID,
              YouTubeWebView.videoID(player?.url) == exit.videoID,
              let source = exit.sourceViewport else { return viewport }
        return exit.motionReady && !exit.preRotationMotion ? exit.motionViewport ?? viewport : source
    }

    private func applyFullscreenSurface(_ t: CGFloat) -> Bool {
        guard mode == .expanded, t < 0.001, customFullscreenID != nil, let player else { return false }
        // The clipping Card follows UIKit's own rotation. The WebView always
        // stays at origin zero with uniform identity geometry; its viewport
        // shrinks only after the live video confirms its final inline pose.
        if fullscreenCardRotationGeneration == nil {
            card.bounds = CGRect(origin: .zero, size: bounds.size)
            card.center = CGPoint(x: bounds.midX, y: bounds.midY)
        }
        player.transform = .identity
        player.center = CGPoint(x: player.bounds.midX, y: player.bounds.midY)
        card.layer.cornerRadius = 0
        card.layer.borderWidth = 0
        closeButton.alpha = 0
        miniPlaybackButton.alpha = 0
        collapseButton.alpha = 1
        updatePlaybackControls()
        return true
    }

    func beginNativeRotation(to size: CGSize, coordinator: UIViewControllerTransitionCoordinator) {
        guard mode == .expanded, size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0 else { return }
        let sourceViewport = player?.bounds.size
        pendingPhysicalFullscreenExit = nil
        nativeRotationGeneration += 1
        let generation = nativeRotationGeneration
        let ticket = loadTicket
        let videoID = YouTubeWebView.videoID(player?.url)
        let entryToken = customFullscreenEnter?.token
        let exitToken = customFullscreenExit?.token
        activeRotationCoordinator = coordinator
        nativeRotationTarget = size
        let remaining = coordinator.isAnimated ? coordinator.transitionDuration * max(0, 1 - Double(coordinator.percentComplete)) : 0
        nativeRotationDeadlineMilliseconds = (Date().timeIntervalSince1970 + remaining) * 1000
        switch coordinator.completionCurve {
        case .easeIn: nativeRotationCSSCurve = "cubic-bezier(.42,0,1,1)"
        case .easeOut: nativeRotationCSSCurve = "cubic-bezier(0,0,.58,1)"
        case .linear: nativeRotationCSSCurve = "linear"
        default: nativeRotationCSSCurve = "cubic-bezier(.42,0,.58,1)"
        }
        customFullscreenEnter?.rotationDeadlineMilliseconds = nativeRotationDeadlineMilliseconds
        customFullscreenEnter?.rotationCSSCurve = nativeRotationCSSCurve
        fullscreenCardRotationGeneration = generation
        let sourceBounds = card.layer.presentation()?.bounds ?? card.bounds
        let sourceCenter = card.layer.presentation()?.position ?? card.center
        UIView.performWithoutAnimation {
            card.bounds = CGRect(origin: .zero, size: sourceBounds.size)
            card.center = sourceCenter
        }
        if exitToken == nil, customFullscreenEnter == nil, size.height > size.width,
           UIApplication.shared.applicationState == .active,
           let id = customFullscreenID, id == videoID, let player, let source = sourceViewport,
           source.width.isFinite, source.height.isFinite, source.width > source.height, source.height > 8,
           abs(source.width-bounds.width) <= 2, abs(source.height-bounds.height) <= 2,
           let data = try? JSONEncoder().encode(id), let literal = String(data: data, encoding: .utf8) {
            // Rotation can beat its asynchronous page exit request. Lease only
            // this current source viewport before the first destination layout.
            // The page retains its existing ad/contact/zoom/overlay admission.
            pendingPhysicalFullscreenExit = PendingPhysicalFullscreenExit(videoID: id, ticket: ticket,
                rotationGeneration: generation, player: ObjectIdentifier(player), sourceViewport: source,
                expiresAt: ProcessInfo.processInfo.systemUptime + min(2, max(0.8, remaining + 0.5)))
            player.evaluateJavaScript("window.__langformFullscreen && window.__langformFullscreen.exitForRotation(\(literal))")
        }
        if exitToken != nil {
            if let exit = customFullscreenExit, exit.preRotationMotion {
                let matchingTarget = exit.motionViewport.map {
                    abs($0.width-size.width) <= 2 && abs($0.height-size.height) <= 2
                } == true
                customFullscreenExit?.preRotationMotion = false
                if exit.ticket == loadTicket, exit.videoID == videoID, exit.motionReady,
                   exit.portraitRequested, !exit.cancellingMotion, matchingTarget {
                    // CSS has already reached its bound inline pose. Only the
                    // actual matching native transition releases WK bounds.
                    customFullscreenExit?.motionGeneration = generation
                } else {
                    // A physical/opposite transition won the race. Cancel its
                    // old pose before returning to the existing natural path.
                    customFullscreenExit?.motionReady = false
                    customFullscreenExit?.cancellingMotion = false
                    cancelFullscreenExitMotion()
                }
            } else {
                customFullscreenExit?.cancellingMotion = false
                requestFullscreenExitMotion(viewport: size, deadline: nativeRotationDeadlineMilliseconds!, curve: nativeRotationCSSCurve)
            }
        }
        // This runs with the source bounds. A later layout prepares WebKit only
        // after it has the actual destination viewport, while rotation is held.
        confirmCustomFullscreenEnter()
        confirmCustomFullscreenExit()
        _ = coordinator.animate(alongsideTransition: { [weak self] _ in
            guard let self, self.nativeRotationGeneration == generation, self.mode == .expanded,
                  self.loadTicket == ticket, YouTubeWebView.videoID(self.player?.url) == videoID else { return }
            self.card.bounds = CGRect(origin: .zero, size: size)
            self.card.center = CGPoint(x: size.width / 2, y: size.height / 2)
        }) { [weak self] context in
            guard let self, self.nativeRotationGeneration == generation else { return }
            self.pendingPhysicalFullscreenExit = nil
            self.activeRotationCoordinator = nil
            self.fullscreenCardRotationGeneration = nil
            self.nativeRotationTarget = nil
            self.nativeRotationDeadlineMilliseconds = nil
            self.nativeRotationCSSCurve = nil
            self.customFullscreenEnter?.waitingForRotation = false
            self.customFullscreenExit?.waitingForRotation = false
            guard self.loadTicket == ticket, YouTubeWebView.videoID(self.player?.url) == videoID else { return }
            let finishingExitToken = self.customFullscreenExit.flatMap { exit -> String? in
                guard exit.ticket == ticket, exit.videoID == videoID,
                      exitToken.map({ exit.token == $0 }) ?? (exit.motionGeneration == generation) else { return nil }
                return exit.token
            }
            if context.isCancelled, finishingExitToken != nil {
                self.customFullscreenExit?.allowsCurrentOrientation = true
                self.cancelFullscreenExitMotion()
            }
            self.setNeedsLayout()
            if let entryToken, self.customFullscreenEnter?.token == entryToken {
                self.confirmCustomFullscreenEnter(afterRotation: true)
            }
            if !context.isCancelled, let finishingExitToken, self.customFullscreenExit?.token == finishingExitToken {
                self.confirmCustomFullscreenExit(afterRotation: true)
            }
            if !context.isCancelled, self.customFullscreenExit?.sourceViewport != nil, self.customFullscreenExit?.motionViewport == nil,
               self.window?.windowScene?.interfaceOrientation.isPortrait == true, self.bounds.height >= self.bounds.width {
                self.requestFullscreenExitMotion(viewport: self.bounds.size, deadline: Date().timeIntervalSince1970 * 1000)
            }
            self.finishPhysicalRotationIntent()
        }
    }

    private func cancelNativeRotation() {
        nativeRotationGeneration += 1
        pendingPhysicalFullscreenExit = nil
        activeRotationCoordinator = nil
        fullscreenCardRotationGeneration = nil
        nativeRotationTarget = nil
        nativeRotationDeadlineMilliseconds = nil
        nativeRotationCSSCurve = nil
        fullscreenExitMotionTimeout?.cancel()
        fullscreenExitMotionTimeout = nil
        customFullscreenEnter?.waitingForRotation = false
        customFullscreenExit?.waitingForRotation = false
        customFullscreenExit?.sourceViewport = nil
        customFullscreenExit?.motionViewport = nil
        customFullscreenExit?.motionGeneration = nil
        customFullscreenExit?.preRotationMotion = false
        setNeedsLayout()
    }

    private func confirmCustomFullscreenEnter(afterRotation: Bool = false) {
        guard var entry = customFullscreenEnter, entry.ticket == loadTicket,
              customFullscreenID == entry.videoID, customFullscreenExit == nil,
              mode == .expanded, YouTubeWebView.videoID(player?.url) == entry.videoID, let player else { return }
        let viewport = player.bounds.size
        let sizeReady = viewport.width.isFinite && viewport.height.isFinite && viewport.width > 8 && viewport.height > 8 &&
            (viewport.width >= viewport.height || entry.allowsCurrentOrientation)
        if !afterRotation, activeRotationCoordinator != nil {
            if sizeReady, entry.preparedViewport != viewport,
               let data = try? JSONSerialization.data(withJSONObject: [entry.videoID, entry.token, viewport.width, viewport.height,
                    entry.rotationDeadlineMilliseconds ?? Date().timeIntervalSince1970 * 1000, entry.rotationCSSCurve ?? "cubic-bezier(.42,0,.58,1)"]),
               let arguments = String(data: data, encoding: .utf8) {
                entry.preparedViewport = viewport
                customFullscreenEnter = entry
                player.evaluateJavaScript("window.__langformFullscreen && window.__langformFullscreen.prepareEnter.apply(null, \(arguments))")
            }
            entry.waitingForRotation = true; customFullscreenEnter = entry
            return
        }
        guard sizeReady, !entry.waitingForRotation,
              window?.windowScene?.interfaceOrientation.isPortrait == false || entry.allowsCurrentOrientation,
              entry.sentViewport != viewport else { return }
        var finishArguments: [Any] = [entry.videoID, entry.token, viewport.width, viewport.height]
        if let deadline = entry.rotationDeadlineMilliseconds {
            finishArguments.append(deadline)
            finishArguments.append(entry.rotationCSSCurve ?? "cubic-bezier(.42,0,.58,1)")
        }
        guard let data = try? JSONSerialization.data(withJSONObject: finishArguments),
              let arguments = String(data: data, encoding: .utf8) else { return }
        customFullscreenEnter?.sentViewport = viewport
        player.evaluateJavaScript("window.__langformFullscreen && window.__langformFullscreen.finishEnter.apply(null, \(arguments))")
    }

    private func finishCustomFullscreenEnter(_ body: [String: Any]) {
        guard body["kind"] as? String == "enter-commit", body["open"] as? Bool == true,
              let entry = customFullscreenEnter, entry.ticket == loadTicket,
              customFullscreenID == entry.videoID, customFullscreenExit == nil,
              body["videoID"] as? String == entry.videoID, body["token"] as? String == entry.token,
              let href = body["href"] as? String, YouTubeWebView.videoID(URL(string: href)) == entry.videoID,
              YouTubeWebView.videoID(player?.url) == entry.videoID, mode == .expanded else { return }
        customFullscreenEnter = nil
        StartupDiagnostics.videoMark(["event": "fullscreen-enter-commit", "mode": String(describing: mode)])
        measureVideo(after: 0) {}
        updateChrome()
    }

    private func resetCustomFullscreen() {
        cancelNativeRotation()
        let hadExitRequest = customFullscreenExit?.portraitRequested == true
        if customFullscreenID != nil { rotationIntentPolicy.fullscreenExitRequested() }
        customFullscreenExit = nil
        customFullscreenEnter = nil
        guard customFullscreenID != nil else { return }
        customFullscreenID = nil
        playerFullscreen = false
        fullscreenSnapLastAt = -Double.infinity
        if !hadExitRequest {
            onFullscreen?(false)
            requestPlayerOrientation(.portrait)
        }
    }

    private func requestFullscreenExitMotion(viewport: CGSize, deadline: Double, curve: String? = nil) {
        guard var exit = customFullscreenExit, exit.ticket == loadTicket,
              mode == .expanded, customFullscreenID == exit.videoID,
              YouTubeWebView.videoID(player?.url) == exit.videoID, let player,
              let source = exit.sourceViewport, !exit.motionReady, !exit.cancellingMotion,
              viewport.width.isFinite, viewport.height.isFinite, viewport.width > 8, viewport.height > 8,
              deadline.isFinite else { return }
        if exit.motionViewport == viewport && exit.motionGeneration == nativeRotationGeneration { return }
        exit.motionViewport = viewport
        exit.motionGeneration = nativeRotationGeneration
        let startsMotionDiagnostics = StartupDiagnostics.enabled && !exit.diagnosticMotionStarted
        if startsMotionDiagnostics { exit.diagnosticMotionStarted = true }
        customFullscreenExit = exit
        if startsMotionDiagnostics {
            // A delayed UIKit rotation can outlive the request-time probe.
            // One fresh bounded window per owner captures the actual handoff.
            fullscreenGeometryTrace = (exit.videoID, exit.token, exit.ticket, ProcessInfo.processInfo.systemUptime, 0)
            fullscreenGeometryDirection = "exit"
            startFullscreenPresentation(videoID: exit.videoID, token: exit.token, direction: "exit")
        }
        let generation = nativeRotationGeneration
        var requestArguments: [Any] = [exit.videoID, exit.token, viewport.width, viewport.height, deadline, exit.ticket]
        if let curve { requestArguments.append(curve) }
        guard let data = try? JSONSerialization.data(withJSONObject: requestArguments),
              let arguments = String(data: data, encoding: .utf8) else { releaseFullscreenExitViewport(); return }
        StartupDiagnostics.videoMark(["event": "fullscreen-exit-motion-request", "nativeUnixMilliseconds": Date().timeIntervalSince1970 * 1000,
            "sourceWidth": source.width, "sourceHeight": source.height, "targetWidth": viewport.width, "targetHeight": viewport.height])
        fullscreenExitMotionTimeout?.cancel()
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, self.loadTicket == exit.ticket, self.nativeRotationGeneration == generation,
                  self.customFullscreenExit?.token == exit.token, self.customFullscreenExit?.motionReady == false else { return }
            // An overdue script is cancelled explicitly. This never pretends
            // that its motion or UIKit rotation has reached the destination.
            self.cancelFullscreenExitMotion()
        }
        fullscreenExitMotionTimeout = timeout
        let remaining = max(0, (deadline - Date().timeIntervalSince1970 * 1000) / 1000)
        DispatchQueue.main.asyncAfter(deadline: .now() + min(2, max(0.8, remaining + 0.5)), execute: timeout)
        player.evaluateJavaScript("window.__langformFullscreen && window.__langformFullscreen.prepareExitMotion.apply(null, \(arguments))") { [weak self] result, error in
            guard let self, self.loadTicket == exit.ticket, self.nativeRotationGeneration == generation,
                  self.customFullscreenExit?.token == exit.token, self.customFullscreenExit?.motionViewport == viewport,
                  self.customFullscreenExit?.motionReady == false, self.customFullscreenExit?.cancellingMotion == false else { return }
            if StartupDiagnostics.enabled {
                var row: [String: Any] = ["event": "fullscreen-exit-motion-result",
                    "nativeUnixMilliseconds": Date().timeIntervalSince1970 * 1000,
                    "accepted": (result as? Bool) == true, "scriptError": error != nil]
                if let error = error as NSError? { row["scriptErrorCode"] = error.code }
                StartupDiagnostics.videoMark(row)
            }
            // False/error means no staged motion was accepted. The existing
            // natural-layout handoff is then free to use the current viewport.
            if error != nil || (result as? Bool) != true { self.releaseFullscreenExitViewport() }
        }
    }

    private func releaseFullscreenExitViewport() {
        guard let exit = customFullscreenExit, exit.ticket == loadTicket,
              mode == .expanded, customFullscreenID == exit.videoID,
              YouTubeWebView.videoID(player?.url) == exit.videoID else { return }
        fullscreenExitMotionTimeout?.cancel()
        fullscreenExitMotionTimeout = nil
        customFullscreenExit?.sourceViewport = nil
        customFullscreenExit?.motionViewport = nil
        customFullscreenExit?.motionGeneration = nil
        customFullscreenExit?.cancellingMotion = false
        customFullscreenExit?.preRotationMotion = false
        requestFullscreenExitPortrait()
        setNeedsLayout()
        layoutIfNeeded()
        confirmCustomFullscreenExit()
    }

    private func cancelFullscreenExitMotion() {
        guard var exit = customFullscreenExit, exit.ticket == loadTicket, exit.sourceViewport != nil,
              !exit.cancellingMotion, let player else { return }
        guard exit.motionViewport != nil else { releaseFullscreenExitViewport(); return }
        exit.cancellingMotion = true
        customFullscreenExit = exit
        fullscreenExitMotionTimeout?.cancel()
        fullscreenExitMotionTimeout = nil
        guard let data = try? JSONSerialization.data(withJSONObject: [exit.videoID, exit.token]),
              let arguments = String(data: data, encoding: .utf8) else { releaseFullscreenExitViewport(); return }
        let generation = nativeRotationGeneration
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, self.loadTicket == exit.ticket, self.nativeRotationGeneration == generation,
                  self.customFullscreenExit?.token == exit.token, self.customFullscreenExit?.cancellingMotion == true else { return }
            StartupDiagnostics.videoMark(["event": "fullscreen-exit-motion-aborted", "reason": "cancel-no-reply"])
            self.releaseFullscreenExitViewport()
        }
        fullscreenExitMotionTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: timeout)
        player.evaluateJavaScript("window.__langformFullscreen && window.__langformFullscreen.cancelExitMotion.apply(null, \(arguments))") { [weak self] _, _ in
            guard let self, self.loadTicket == exit.ticket, self.nativeRotationGeneration == generation,
                  self.customFullscreenExit?.token == exit.token, self.customFullscreenExit?.cancellingMotion == true else { return }
            self.releaseFullscreenExitViewport()
        }
    }

    private func fullscreenExitMotionReady(_ body: [String: Any]) {
        guard body["kind"] as? String == "exit-motion-ready", var exit = customFullscreenExit,
              exit.ticket == loadTicket, exit.motionGeneration == nativeRotationGeneration,
              mode == .expanded, customFullscreenID == exit.videoID,
              YouTubeWebView.videoID(player?.url) == exit.videoID,
              body["videoID"] as? String == exit.videoID, body["token"] as? String == exit.token,
              let requestTicket = body["requestTicket"] as? NSNumber,
              CFGetTypeID(requestTicket) != CFBooleanGetTypeID(),
              requestTicket.doubleValue.isFinite, requestTicket.doubleValue >= 0,
              requestTicket.doubleValue <= 9007199254740991, requestTicket.doubleValue == Double(exit.ticket),
              let href = body["href"] as? String, YouTubeWebView.videoID(URL(string: href)) == exit.videoID,
              let target = exit.motionViewport, let source = exit.sourceViewport,
              !exit.motionReady, !exit.cancellingMotion,
              let width = body["width"] as? NSNumber, let height = body["height"] as? NSNumber,
              width.doubleValue.isFinite, height.doubleValue.isFinite,
              width.doubleValue == Double(target.width), height.doubleValue == Double(target.height) else { return }
        exit.motionReady = true
        customFullscreenExit = exit
        fullscreenExitMotionTimeout?.cancel()
        fullscreenExitMotionTimeout = nil
        StartupDiagnostics.videoMark(["event": "fullscreen-exit-motion-ready", "nativeUnixMilliseconds": Date().timeIntervalSince1970 * 1000,
            "sourceWidth": source.width, "sourceHeight": source.height, "targetWidth": target.width, "targetHeight": target.height])
        if exit.preRotationMotion {
            requestFullscreenExitPortrait()
            return
        }
        setNeedsLayout()
        layoutIfNeeded()
        confirmCustomFullscreenExit()
    }

    private func resumeFullscreenExitAfterInactivity() {
        guard UIApplication.shared.applicationState == .active,
              let exit = customFullscreenExit, exit.sourceViewport == nil,
              !exit.preRotationMotion, !exit.portraitRequested else { return }
        requestFullscreenExitPortrait()
    }

    private func requestFullscreenExitPortrait() {
        guard var exit = customFullscreenExit, exit.ticket == loadTicket,
              mode == .expanded, customFullscreenID == exit.videoID,
              YouTubeWebView.videoID(player?.url) == exit.videoID,
              !exit.portraitRequested else { return }
        exit.portraitRequested = true
        customFullscreenExit = exit
        onFullscreen?(false)
        requestPlayerOrientation(.portrait, onRejected: { [weak self] in
            guard let self, self.loadTicket == exit.ticket,
                  self.customFullscreenExit?.token == exit.token,
                  self.customFullscreenExit?.ticket == exit.ticket,
                  self.customFullscreenID == exit.videoID,
                  YouTubeWebView.videoID(self.player?.url) == exit.videoID,
                  self.mode == .expanded else { return }
            self.customFullscreenExit?.allowsCurrentOrientation = true
            self.releaseFullscreenExitViewport()
            self.confirmCustomFullscreenExit()
        })
    }

    private func beginCustomFullscreenExit(_ body: [String: Any]) {
        guard body["kind"] as? String == "exit-request",
              let id = body["videoID"] as? String, customFullscreenID == id,
              let token = body["token"] as? String, !token.isEmpty,
              let href = body["href"] as? String, YouTubeWebView.videoID(URL(string: href)) == id,
              YouTubeWebView.videoID(player?.url) == id, mode == .expanded else { return }
        guard customFullscreenExit == nil else { return }
        rotationIntentPolicy.fullscreenExitRequested()
        customFullscreenEnter = nil
        let physicalSource = pendingPhysicalFullscreenExitSource(videoID: id)
        pendingPhysicalFullscreenExit = nil
        customFullscreenExit = CustomFullscreenExit(videoID: id, token: token, ticket: loadTicket,
            opensSearchInFeed: body["action"] as? String == "search", sourceViewport: physicalSource ?? player?.bounds.size)
        if StartupDiagnostics.enabled {
            fullscreenGeometryTrace = (id, token, loadTicket, ProcessInfo.processInfo.systemUptime, 0)
            fullscreenGeometryDirection = "exit"
            startFullscreenPresentation(videoID: id, token: token, direction: "exit")
        }
        if physicalSource != nil, activeRotationCoordinator != nil,
           let target = nativeRotationTarget, let deadline = nativeRotationDeadlineMilliseconds {
            customFullscreenExit?.waitingForRotation = true
            requestFullscreenExitMotion(viewport: target, deadline: deadline, curve: nativeRotationCSSCurve)
            return
        }
        if activeRotationCoordinator == nil,
           window?.windowScene?.interfaceOrientation.isPortrait == false,
           let source = customFullscreenExit?.sourceViewport,
           source.width.isFinite, source.height.isFinite, source.width > source.height,
           source.height > 8, abs(source.width-bounds.width) <= 2, abs(source.height-bounds.height) <= 2 {
            // JS validates this proposed viewport against its bound, stable
            // inline cache before accepting any live picture interpolation.
            customFullscreenExit?.preRotationMotion = true
            requestFullscreenExitMotion(viewport: CGSize(width:source.height,height:source.width),
                deadline: Date().timeIntervalSince1970 * 1000 + 200)
            return
        }
        requestFullscreenExitPortrait()
        setNeedsLayout()
        if activeRotationCoordinator == nil, window?.windowScene?.interfaceOrientation.isPortrait == true,
           bounds.height >= bounds.width {
            requestFullscreenExitMotion(viewport: bounds.size, deadline: Date().timeIntervalSince1970 * 1000)
        }
        confirmCustomFullscreenExit()
    }

    private func confirmCustomFullscreenExit(afterRotation: Bool = false) {
        guard var exit = customFullscreenExit, exit.ticket == loadTicket,
              customFullscreenID == exit.videoID, mode == .expanded,
              YouTubeWebView.videoID(player?.url) == exit.videoID, let player else { return }
        if exit.preRotationMotion || exit.sourceViewport != nil && !exit.motionReady { return }
        if !afterRotation, activeRotationCoordinator != nil {
            let viewport = player.bounds.size
            // UIKit exposes its destination bounds before the rotation ends.
            // Start the live-node handoff within that rotation; this does not
            // authorize removing its fixed pose or native fullscreen ownership.
            if PlayerViewportPolicy.canFinishFullscreenExit(in: viewport, portrait: viewport.height >= viewport.width,
                    allowsCurrentOrientation: exit.allowsCurrentOrientation, rotating: false),
               exit.preparedViewport != viewport,
               let data = try? JSONSerialization.data(withJSONObject: [exit.videoID, exit.token, viewport.width, viewport.height]),
               let arguments = String(data: data, encoding: .utf8) {
                exit.preparedViewport = viewport
                customFullscreenExit = exit
                player.evaluateJavaScript("window.__langformFullscreen && window.__langformFullscreen.prepareExit.apply(null, \(arguments))")
            }
            exit.waitingForRotation = true
            customFullscreenExit = exit
            return
        }
        let viewport = player.bounds.size
        let portrait = window?.windowScene?.interfaceOrientation.isPortrait == true
        guard PlayerViewportPolicy.canFinishFullscreenExit(in: viewport, portrait: portrait,
                allowsCurrentOrientation: exit.allowsCurrentOrientation, rotating: exit.waitingForRotation),
              exit.sentViewport != viewport,
              let data = try? JSONSerialization.data(withJSONObject: [exit.videoID, exit.token, viewport.width, viewport.height]),
              let arguments = String(data: data, encoding: .utf8) else { return }
        customFullscreenExit?.sentViewport = viewport
        player.evaluateJavaScript("window.__langformFullscreen && window.__langformFullscreen.finishExit.apply(null, \(arguments))")
    }

    private func fullscreenChapterSnap(_ body: [String: Any]) {
        guard body["kind"] as? String == "chapter-snap",
              let id = body["videoID"] as? String, customFullscreenID == id,
              let href = body["href"] as? String,
              YouTubeWebView.videoID(URL(string: href)) == id,
              YouTubeWebView.videoID(player?.url) == id,
              mode == .expanded, !dragging else { return }
        let now = ProcessInfo.processInfo.systemUptime
        guard now - fullscreenSnapLastAt >= 0.07 else { return }
        fullscreenSnapLastAt = now
        fullscreenSelectionFeedback.selectionChanged()
        fullscreenSelectionFeedback.prepare()
    }

    // Capture only bounded numeric geometry from the current enter/exit transaction.
    // The token and media ID authenticate messages but never enter the log.
    /// Read actual Core Animation presentation at display time, independently
    /// of the later receipt of a batch of WebKit geometry rows.
    private func startFullscreenPresentation(videoID: String, token: String, direction: String) {
        stopFullscreenPresentation()
        guard StartupDiagnostics.enabled, ["enter", "exit"].contains(direction),
              mode == .expanded, let player, window != nil,
              UIApplication.shared.applicationState == .active,
              YouTubeWebView.videoID(player.url) == videoID else { return }
        fullscreenPresentationTrace = (videoID, token, loadTicket, direction, CACurrentMediaTime(), 0)
        let link = CADisplayLink(target: FullscreenPresentationTarget(self), selector: #selector(FullscreenPresentationTarget.sample(_:)))
        link.preferredFramesPerSecond = 60
        fullscreenPresentationLink = link
        link.add(to: .main, forMode: .common)
    }

    private func stopFullscreenPresentation() {
        fullscreenPresentationLink?.invalidate()
        fullscreenPresentationLink = nil
        fullscreenPresentationTrace = nil
    }

    private func sampleFullscreenPresentation(_ link: CADisplayLink) {
        guard StartupDiagnostics.enabled, fullscreenPresentationLink === link,
              var trace = fullscreenPresentationTrace, trace.ticket == loadTicket,
              mode == .expanded, let player, let window,
              UIApplication.shared.applicationState == .active,
              YouTubeWebView.videoID(player.url) == trace.videoID else {
            if fullscreenPresentationLink === link { stopFullscreenPresentation() }
            else { link.invalidate() }
            return
        }
        let capturedAt = CACurrentMediaTime()
        let elapsed = max(0, capturedAt - trace.beganAt)
        guard elapsed <= 2, trace.frames < 120 else { stopFullscreenPresentation(); return }
        trace.frames += 1
        fullscreenPresentationTrace = trace
        var row: [String: Any] = [
            "event": "fullscreen-native-presentation", "direction": trace.direction,
            "sequence": trace.frames, "requestTicket": trace.ticket,
            "nativeSampleUptime": capturedAt, "nativeSampleMilliseconds": elapsed * 1000,
            "nativeUnixMilliseconds": Date().timeIntervalSince1970 * 1000,
            "displayTimestamp": link.timestamp, "displayTargetTimestamp": link.targetTimestamp,
            "nativeEnterPending": customFullscreenEnter != nil,
            "nativeExitPending": customFullscreenExit != nil,
            "nativeFullscreen": playerFullscreen,
            "nativeTraceMotionWindow": trace.direction == "exit" && customFullscreenExit?.diagnosticMotionStarted == true
        ]
        row["nativeExitViewportHeld"] = customFullscreenExit?.sourceViewport != nil &&
            (customFullscreenExit?.motionReady == false || customFullscreenExit?.preRotationMotion == true)
        row["nativeExitPreRotation"] = customFullscreenExit?.preRotationMotion == true
        row["nativeExitMotionRequested"] = customFullscreenExit?.motionViewport != nil
        row["nativeExitMotionReady"] = customFullscreenExit?.motionReady == true
        if let target = nativeRotationTarget {
            row["nativeRotationTargetWidth"] = target.width
            row["nativeRotationTargetHeight"] = target.height
        }
        func number(_ key: String, _ value: CGFloat) {
            if value.isFinite { row[key] = Double(value) }
        }
        func captureColor(_ color: UIColor?, _ prefix: String, _ traits: UITraitCollection) {
            var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
            guard let color = color?.resolvedColor(with: traits),
                  color.getRed(&red, green: &green, blue: &blue, alpha: &alpha),
                  [red, green, blue, alpha].allSatisfy({ $0.isFinite && (0...1).contains($0) }) else {
                row[prefix + "Available"] = false
                return
            }
            row[prefix + "Available"] = true
            number(prefix + "Red", red); number(prefix + "Green", green)
            number(prefix + "Blue", blue); number(prefix + "Alpha", alpha)
        }
        func captureLayer(_ layer: CALayer, _ prefix: String, _ traits: UITraitCollection) {
            number(prefix + "BoundsX", layer.bounds.minX); number(prefix + "BoundsY", layer.bounds.minY)
            number(prefix + "BoundsWidth", layer.bounds.width); number(prefix + "BoundsHeight", layer.bounds.height)
            number(prefix + "PositionX", layer.position.x); number(prefix + "PositionY", layer.position.y)
            let transform = layer.affineTransform()
            number(prefix + "TransformA", transform.a); number(prefix + "TransformB", transform.b)
            number(prefix + "TransformC", transform.c); number(prefix + "TransformD", transform.d)
            number(prefix + "TransformTX", transform.tx); number(prefix + "TransformTY", transform.ty)
            captureColor(layer.backgroundColor.map { UIColor(cgColor: $0) }, prefix + "Background", traits)
            number(prefix + "Opacity", CGFloat(layer.opacity))
            row[prefix + "Hidden"] = layer.isHidden
            row[prefix + "Opaque"] = layer.isOpaque
        }
        func captureView(_ view: UIView, _ prefix: String) {
            captureLayer(view.layer, prefix + "Model", view.traitCollection)
            let presentation = view.layer.presentation()
            row[prefix + "HasPresentation"] = presentation != nil
            if let presentation { captureLayer(presentation, prefix + "Presentation", view.traitCollection) }
            number(prefix + "SafeTop", view.safeAreaInsets.top)
            captureColor(view.backgroundColor, prefix + "Background", view.traitCollection)
            number(prefix + "Alpha", view.alpha)
            row[prefix + "Hidden"] = view.isHidden
            row[prefix + "Opaque"] = view.isOpaque
        }
        captureView(self, "stage"); captureView(card, "card"); captureView(player, "player")
        captureView(player.scrollView, "playerScroll")
        captureColor(player.underPageBackgroundColor, "playerUnderPageBackground", player.traitCollection)
        if let feed { captureView(feed, "feed") }
        captureView(window, "rootWindow")
        if let rootView = window.rootViewController?.viewIfLoaded { captureView(rootView, "rootView") }
        let coordinator = activeRotationCoordinator
        row["coordinatorAvailable"] = coordinator != nil
        if let coordinator {
            row["coordinatorIsAnimated"] = coordinator.isAnimated
            row["coordinatorTransitionDuration"] = coordinator.transitionDuration
            row["coordinatorPercentComplete"] = Double(coordinator.percentComplete)
        }
        StartupDiagnostics.videoMark(row)
        if trace.frames == 120 { stopFullscreenPresentation() }
    }

    private func fullscreenGeometryChanged(_ body: [String: Any]) {
        guard StartupDiagnostics.enabled, var trace = fullscreenGeometryTrace,
              trace.ticket == loadTicket, mode == .expanded, let player,
              trace.videoID == body["videoID"] as? String,
              trace.token == body["token"] as? String,
              let href = body["href"] as? String,
              YouTubeWebView.videoID(URL(string: href)) == trace.videoID,
              YouTubeWebView.videoID(player.url) == trace.videoID,
              ProcessInfo.processInfo.systemUptime - trace.beganAt < 3,
              trace.rows < 240, let rows = body["rows"] as? [[String: Any]] else { return }
        for row in rows.prefix(min(12, 240 - trace.rows)) {
            guard var entry = fullscreenGeometryRow(row) else { continue }
            entry["event"] = "fullscreen-geometry"
            entry["direction"] = fullscreenGeometryDirection
            entry["nativeMilliseconds"] = (ProcessInfo.processInfo.systemUptime - trace.beganAt) * 1000
            entry["stageWidth"] = bounds.width; entry["stageHeight"] = bounds.height
            entry["safeTop"] = safeAreaInsets.top; entry["safeBottom"] = safeAreaInsets.bottom
            entry["nativePlayerWidth"] = player.bounds.width; entry["nativePlayerHeight"] = player.bounds.height
            entry["nativeCardX"] = card.frame.minX; entry["nativeCardY"] = card.frame.minY
            entry["nativeCardWidth"] = card.frame.width; entry["nativeCardHeight"] = card.frame.height
            entry["nativePlayerScaleX"] = player.transform.a; entry["nativePlayerScaleY"] = player.transform.d
            entry["nativePlayerTranslateX"] = player.transform.tx; entry["nativePlayerTranslateY"] = player.transform.ty
            entry["nativeProgress"] = progress; entry["nativeFullscreen"] = playerFullscreen
            entry["nativeExitPending"] = customFullscreenExit != nil
            entry["nativeEnterPending"] = customFullscreenEnter != nil
            entry["nativeRotating"] = customFullscreenExit?.waitingForRotation == true || customFullscreenEnter?.waitingForRotation == true
            StartupDiagnostics.videoMark(entry)
            trace.rows += 1
        }
        fullscreenGeometryTrace = trace
    }

    private func fullscreenGeometryRow(_ row: [String: Any]) -> [String: Any]? {
        guard let phase = row["phase"] as? String,
              ["waiting", "handoff", "committed", "cancelled"].contains(phase) else { return nil }
        var result: [String: Any] = ["phase": phase]
        for key in ["sequence", "documentMilliseconds", "documentEpochMilliseconds", "viewportWidth", "viewportHeight", "scrollX", "scrollY",
                    "pictureX", "pictureY", "pictureWidth", "pictureHeight", "videoX", "videoY", "videoWidth", "videoHeight",
                    "rootX", "rootY", "rootWidth", "rootHeight", "intrinsicWidth", "intrinsicHeight", "currentTime", "headerY",
                    "naturalVideoWidth", "naturalVideoHeight", "naturalContainerWidth", "naturalContainerHeight",
                    "videoInlineWidth", "videoInlineHeight", "containerInlineWidth", "containerInlineHeight",
                    "exitBeforeResetWidth", "exitBeforeResetHeight", "exitAfterResetWidth", "exitAfterResetHeight",
                    "exitMotionReceivedEpochMilliseconds", "exitMotionSetupEpochMilliseconds", "exitMotionDurationMilliseconds",
                    "exitMotionFromWidth", "exitMotionFromHeight", "exitMotionPinnedWidth", "exitMotionPinnedHeight",
                    "exitAnimationMilliseconds", "exitAnimationProgress"] {
            if let value = row[key] as? NSNumber, value.doubleValue.isFinite { result[key] = value.doubleValue }
        }
        for key in ["exitRequestEpochMilliseconds", "exitAnimationCreatedEpochMilliseconds", "exitHandoffToInlineCalls"] {
            if let value = row[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite {
                result[key] = value.doubleValue
            }
        }
        if let reason = row["exitMotionRejectedReason"] as? NSNumber,
           reason.doubleValue.isFinite, reason.doubleValue.rounded() == reason.doubleValue,
           reason.doubleValue >= 0, reason.doubleValue <= 10 { result["exitMotionRejectedReason"] = reason.doubleValue }
        for (keys, maximum) in [
            (["exitHTMLPaint", "exitBodyPaint", "exitHitPaint", "exitAncestorPaint"], 3.0),
            (["exitHitDepth", "exitAncestorDepth"], 12.0),
            (["exitHitRole", "exitAncestorRole"], 5.0)
        ] {
            for key in keys {
                if let value = row[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
                   value.doubleValue.isFinite, value.doubleValue.rounded() == value.doubleValue,
                   value.doubleValue >= 0, value.doubleValue <= maximum { result[key] = value.doubleValue }
            }
        }
        for key in ["paused", "hidden", "held", "rootFixed", "exitContextHidden", "exitUsingCachedDestination", "exitMotionBeforeResize",
                    "inlineSizeOwned", "inlineSizeSuspended", "playerSetSizeAvailable",
                    "exitWatchContextVisible", "exitBackdropLeased", "exitRevealsActive", "traceMotionWindow"] {
            if let value = row[key] as? Bool { result[key] = value }
        }
        return result
    }

    private var physicalPlayerOrientation: PlayerRotationIntentPolicy.Orientation {
        switch UIDevice.current.orientation {
        case .portrait: return .portrait
        case .landscapeLeft, .landscapeRight: return .landscape
        // Portrait upside down is not supported by this iPhone app.
        default: return .unknown
        }
    }

    private var physicalRotationContext: PlayerRotationIntentPolicy.Context {
        let id = YouTubeWebView.videoID(player?.url)
        let owner = id.map { PlayerRotationIntentPolicy.Owner(videoID: $0, ticket: loadTicket) }
        let geometry = videoSeekGeometry
        let mediaOwned = ownsWatchPlayer && startupStatus.hasPresentedPicture
            && geometry?.videoID == id && geometry?.ticket == loadTicket
        func active(_ gesture: UIGestureRecognizer?) -> Bool {
            gesture?.state == .began || gesture?.state == .changed
        }
        return PlayerRotationIntentPolicy.Context(owner: owner, expanded: mode == .expanded,
            fullscreen: customFullscreenID != nil,
            foreground: UIApplication.shared.applicationState == .active
                && window?.windowScene?.activationState == .foregroundActive && !systemMediaSuspendedForOffline,
            mediaOwned: mediaOwned,
            gestureActive: dragging || edgeBackTracking || active(drag) || active(edgeBack)
                || active(player?.scrollView.panGestureRecognizer),
            overlayOpen: playerOverlayOpen || keyboardVisible,
            fullscreenTransition: customFullscreenEnter != nil || customFullscreenExit != nil || cardMoving || feedOpening != nil,
            nativeRotating: activeRotationCoordinator != nil,
            geometryCurrent: geometry?.viewport == viewportGeneration && !awaitingViewportGeometry && hasVideoRect)
    }

    @objc private func physicalDeviceOrientationChanged() {
        let context = physicalRotationContext
        if let request = rotationIntentPolicy.observe(physicalPlayerOrientation, context: context,
                                                     now: ProcessInfo.processInfo.systemUptime) {
            performPhysicalRotation(request)
        }
    }

    @objc private func resetPhysicalRotationBaseline() {
        rotationIntentPolicy.reset(orientation: physicalPlayerOrientation)
    }

    @objc private func playerSceneBecameInactive(_ notification: Notification) {
        guard let scene = notification.object as? UIScene, scene === window?.windowScene else { return }
        revokeFullscreenEntryAdmission()
        rotationIntentPolicy.reset(orientation: physicalPlayerOrientation)
    }

    @objc private func playerSceneBecameActive(_ notification: Notification) {
        guard let scene = notification.object as? UIScene, scene === window?.windowScene else { return }
        rotationIntentPolicy.reset(orientation: physicalPlayerOrientation)
    }

    private func finishPhysicalRotationIntent() {
        if let request = rotationIntentPolicy.takePending(context: physicalRotationContext,
                                                         now: ProcessInfo.processInfo.systemUptime) {
            performPhysicalRotation(request)
        }
    }

    private func performPhysicalRotation(_ request: PlayerRotationIntentPolicy.Request) {
        guard rotationIntentPolicy.isCurrent(request, context: physicalRotationContext), let player,
              let data = try? JSONEncoder().encode(request.owner.videoID),
              let literal = String(data: data, encoding: .utf8) else { return }
        // The page checks the live main-video owner, ads and contacts again at
        // execution. This uses the same fullscreen transaction as its button.
        let action = request.action == .enter ? "enter" : "exitForRotation"
        StartupDiagnostics.mark("physical-rotation-\(action)-request")
        player.evaluateJavaScript("window.__langformFullscreen && window.__langformFullscreen.\(action)(\(literal))")
    }

    private func requestPlayerOrientation(_ orientations: UIInterfaceOrientationMask, onRejected: (() -> Void)? = nil) {
        guard let scene = window?.windowScene else { onRejected?(); return }
        window?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        // Let UIKit animate the existing WebView. A rejected orientation request
        // still leaves the in-page fullscreen controls usable in the current size.
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: orientations)) { _ in onRejected?() }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame else { return }
        switch message.name {
        case "langformSponsorBlock":
            guard let player, message.webView === player, mode != .closed,
                  message.frameInfo.securityOrigin.protocol == "https",
                  ["m.youtube.com", "www.youtube.com", "youtube.com"].contains(message.frameInfo.securityOrigin.host),
                  let body = message.body as? [String: Any],
                  let id = body["videoID"] as? String, SponsorBlockService.hash(id) != nil,
                  let token = body["requestID"] as? String, token.count <= 80,
                  YouTubeWebView.videoID(player.url) == id else { return }
            if body["kind"] as? String == "cancel" {
                guard sponsorBlockRequest?.token == token, sponsorBlockRequest?.videoID == id else { return }
                sponsorBlock.cancel(); sponsorBlockRequest = nil; return
            }
            guard body["kind"] as? String == "fetch" else { return }
            let ticket = loadTicket
            sponsorBlockRequest = (token, id, ticket)
            sponsorBlock.fetch(videoID: id) { [weak self, weak player] status, segments in
                guard let self, let player, self.player === player, self.mode != .closed,
                      self.sponsorBlockRequest?.token == token, self.sponsorBlockRequest?.videoID == id,
                      self.sponsorBlockRequest?.ticket == ticket,
                      self.loadTicket == ticket, YouTubeWebView.videoID(player.url) == id,
                      let data = try? JSONSerialization.data(withJSONObject: ["requestID":token, "videoID":id, "status":status, "segments":segments]),
                      let payload = String(data:data, encoding:.utf8) else { return }
                self.sponsorBlockRequest = nil
                player.evaluateJavaScript("window.__langformSponsorBlockReceive && window.__langformSponsorBlockReceive(\(payload))")
            }
        case "langformDownloads":
            guard let view = message.webView,
                  message.frameInfo.securityOrigin.protocol == "https",
                  ["m.youtube.com", "www.youtube.com", "youtube.com"].contains(message.frameInfo.securityOrigin.host) else { return }
            if view === player {
                guard let body = message.body as? [String: Any], body["kind"] as? String == "open",
                      let id = body["videoID"] as? String, let currentID = YouTubeWebView.videoID(view.url),
                      id == currentID else { return }
                guard mode == .expanded, customFullscreenID == nil, !playerOverlayOpen else {
                    // The document marks its button busy before posting. A mode
                    // change may overtake that message; acknowledge the rejected
                    // intent without clearing another native preparation.
                    if !downloadSourceLoading { setDownloadSourceLoading(false) }
                    return
                }
            } else {
                guard feedState(for: view)?.active == true else { return }
            }
            requestDownloads()
        case "langformBackgroundAudio":
            guard message.frameInfo.isMainFrame, let player, message.webView === player,
                  message.frameInfo.securityOrigin.protocol == "https",
                  ["m.youtube.com", "www.youtube.com", "youtube.com"].contains(message.frameInfo.securityOrigin.host),
                  let current = backgroundCategoryRequest, let body = message.body as? [String: Any],
                  ["cancel", "pause-intent", "continued", "already-playing", "continuation-rejected", "continuation-failed", "diagnostic"].contains(body["kind"] as? String ?? ""), body["videoID"] as? String == current.id,
                  body["ticket"] as? Int == current.ticket, body["request"] as? Int == current.number,
                  let token = body["token"] as? Int, token > 0, current.token == nil || current.token == token else { return }
            if body["kind"] as? String == "diagnostic" {
                guard StartupDiagnostics.enabled, backgroundPlaybackProbe != nil else { return }
                let phases = ["captured", "cancel", "revoke", "waiting", "rejected", "already-playing", "continued", "visibility", "media-event", "background", "category"]
                let reasons = ["none", "document-inactive", "route", "root-missing", "video-missing", "root-replaced", "video-replaced", "disconnected", "ended", "media-error", "not-ready", "source-empty", "source-changed", "attribute-changed", "native-drag", "metadata-exception", "metadata-missing", "metadata-id", "metadata-ad", "ad-class", "protected-field-replaced", "explicit-intent", "stale-lease", "category-only", "not-background", "category-not-ready", "native-active", "real-visible", "privilege-revoked", "consumed", "media-state"]
                let triggers = ["none", "capture", "capture-replaced", "hidden-getter", "visibility-getter", "mutation", "visibility", "background", "category", "native-cancel", "native-interrupt", "foreground", "explicit-action", "continuation-check", "pause", "play", "pauseVideo", "playVideo", "playing", "ended", "emptied", "loadstart", "error", "volumechange", "ratechange", "loadedmetadata", "yt-navigate-start", "yt-navigate-finish", "state-navigateend", "popstate", "pagehide"]
                let fields = ["none", "document.hidden", "document.visibilityState", "video.pause", "video.play", "root.pauseVideo", "root.playVideo"]
                guard let phase = body["phase"] as? String, phases.contains(phase),
                      let reason = body["reason"] as? String, reasons.contains(reason),
                      let trigger = body["trigger"] as? String, triggers.contains(trigger),
                      let field = body["field"] as? String, fields.contains(field),
                      let row = body["row"] as? Int, (1...32).contains(row) else { return }
                if backgroundLeaseDiagnosticTicket != current.ticket { backgroundLeaseDiagnosticTicket = current.ticket; backgroundLeaseDiagnosticCount = 0 }
                guard backgroundLeaseDiagnosticCount < 32 else { return }
                backgroundLeaseDiagnosticCount += 1
                var entry: [String: Any] = ["event": "background-lease-probe", "phase": phase, "reason": reason, "trigger": trigger, "field": field,
                                            "ticket": current.ticket, "request": current.number, "token": token, "row": row,
                                            "completionApplicationState": UIApplication.shared.applicationState.rawValue]
                for key in ["nativeInactive", "mayContinue", "consumed", "background", "categoryReady"] {
                    if let value = body[key] as? Bool { entry[key] = value }
                }
                for key in ["milliseconds"] {
                    if let value = body[key] as? NSNumber, value.doubleValue.isFinite, value.doubleValue >= 0, value.doubleValue <= 100_000_000 { entry[key] = value }
                }
                StartupDiagnostics.videoMark(entry)
                return
            }
            if body["kind"] as? String == "cancel" {
                watchBackgroundCategoryTransition("cancel")
            } else if body["kind"] as? String == "pause-intent" {
                backgroundContinuationRevoked = true
                backgroundCategoryHandoff?.cancel()
            } else if ["continued", "already-playing", "continuation-rejected", "continuation-failed"].contains(body["kind"] as? String ?? "") {
                StartupDiagnostics.videoMark(["event": "background-visibility-probe", "kind": body["kind"] as! String,
                                              "ticket": current.ticket, "request": current.number, "token": token])
            }
        case "langformSystemMedia":
            guard let player, message.webView === player, mode != .closed, !systemMediaSuspendedForOffline,
                  message.frameInfo.securityOrigin.protocol == "https",
                  ["m.youtube.com", "www.youtube.com", "youtube.com"].contains(message.frameInfo.securityOrigin.host),
                  let id = mode == .loading ? loadingVideoID : YouTubeWebView.videoID(player.url),
                  let body = message.body as? [String: Any] else { return }
            systemMedia.receive(body, expectedID: id)
        case "langformNativeSearch":
            StartupDiagnostics.mark("native-search-bridge-received")
            guard message.frameInfo.isMainFrame, let webView = message.webView, webView === feed,
                  message.frameInfo.securityOrigin.protocol == "https",
                  ["m.youtube.com", "www.youtube.com", "youtube.com"].contains(message.frameInfo.securityOrigin.host),
                  let body = message.body as? [String: Any] else { return }
            if body["action"] as? String == "probe" {
                guard StartupDiagnostics.enabled, ProcessInfo.processInfo.environment["LANGFORM_NATIVE_SEARCH_PROBE"] == "1" else { return }
                var row: [String:Any] = ["event":"native-search-probe"]
                for key in ["initialized","links","active","prevented"] { if let value = body[key] as? Bool { row[key] = value } }
                if let kind = body["kind"] as? String, ["ready","pointerdown","touchstart","pointerup","touchend","click","error"].contains(kind) { row["kind"] = kind }
                if let type = body["errorType"] as? String, ["TypeError","ReferenceError","SyntaxError","RangeError","unknown"].contains(type) { row["errorType"] = type }
                if let line = body["errorLine"] as? Double, line.isFinite, line >= 0, line < 100_000 { row["errorLine"] = line }
                if let value = body["structure"] as? String, value.count <= 1600,
                   value.range(of:"^[a-zA-Z0-9_ .:>äöüß-]*$",options:.regularExpression) != nil { row["structure"] = value }
                StartupDiagnostics.videoMark(row)
                return
            }
            nativeSearchChanged(body, from: webView)
            StartupDiagnostics.mark(nativeSearchOverlay == nil ? "native-search-not-presented" : "native-search-presented")
        case "langformFeedSearch":
            guard message.frameInfo.isMainFrame,
                  let webView = message.webView, feedState(for: webView) != nil,
                  message.frameInfo.securityOrigin.protocol == "https",
                  ["m.youtube.com", "www.youtube.com", "youtube.com"].contains(message.frameInfo.securityOrigin.host),
                  let body = message.body as? [String: Any] else { return }
            feedSearchChanged(body, from: webView)
        case "langformFeedReady":
            guard message.frameInfo.isMainFrame, let webView = message.webView, let state = feedState(for: webView),
                  message.frameInfo.securityOrigin.protocol == "https",
                  ["m.youtube.com", "www.youtube.com", "youtube.com"].contains(message.frameInfo.securityOrigin.host),
                  let body = message.body as? [String: Any],
                  let href = body["href"] as? String, href == webView.url?.absoluteString,
                  let token = body["documentToken"] as? String else { return }
            let navigation = state.navigation
            if webView === feed { activatePendingFeedSearch() }
            // Check before scheduling JS as well as after it: an old document
            // can compute a result before commit but deliver it after commit.
            // A previous document can have the same reload URL. Verify its
            // document identity in the current page before releasing a cover.
            webView.evaluateJavaScript("window.__langformFeedDocumentToken || ''") { [weak self, weak state] result, _ in
                guard let self, let state, state.navigation === navigation, (result as? String) == token,
                      href == state.webView.url?.absoluteString else { return }
                state.contentReady = true
                if state.webView === self.feedTabs[.you]?.webView {
                    StartupDiagnostics.mark("you-preload-content-ready", once: true)
                }
                state.refresh?.contentReady(navigation: navigation)
                self.scheduleFeedPrewarm()
            }
        case "langformFullscreen":
            guard message.webView === player,
                  message.frameInfo.securityOrigin.protocol == "https",
                  ["m.youtube.com", "www.youtube.com", "youtube.com"].contains(message.frameInfo.securityOrigin.host),
                  let body = message.body as? [String: Any] else { return }
            if body["kind"] as? String == "geometry-trace" {
                fullscreenGeometryChanged(body)
                return
            }
            if body["kind"] as? String == "comment-reaction-trace" {
                guard StartupDiagnostics.enabled, commentReactionDiagnosticCount < 60,
                      let phase = body["phase"] as? String,
                      ["open", "bind", "inspect", "finish"].contains(phase) else { return }
                commentReactionDiagnosticCount += 1
                var row: [String: Any] = ["event": "comment-reaction-trace", "phase": phase]
                for key in ["sequence", "containerCount", "activeCount", "actionCount"] {
                    if let number = body[key] as? NSNumber, number.doubleValue.isFinite,
                       (0...1000).contains(number.intValue) { row[key] = number.intValue }
                }
                for key in ["candidate", "nativeSheet", "executed", "owned", "sheetOpen", "sheetHash", "closePresent"] {
                    if let value = body[key] as? Bool { row[key] = value }
                }
                StartupDiagnostics.videoMark(row)
                return
            }
            if body["kind"] as? String == "diagnostic-probe" {
                fullscreenDiagnosticChanged(body)
                return
            }
            if body["kind"] as? String == "chapter-snap" {
                fullscreenChapterSnap(body)
                return
            }
            if body["kind"] as? String == "exit-request" {
                beginCustomFullscreenExit(body)
                return
            }
            if body["kind"] as? String == "exit-motion-ready" {
                fullscreenExitMotionReady(body)
                return
            }
            if body["kind"] as? String == "enter-commit" {
                finishCustomFullscreenEnter(body)
                return
            }
            customFullscreenChanged(body)
        case "langformProbeInteraction":
            guard message.webView === feed || message.webView === player else { return }
            cancelVideoProbe()
        case "langformPerformanceDiagnostics":
            guard message.webView === player, message.frameInfo.securityOrigin.protocol == "https",
                  ["youtube.com", "m.youtube.com", "www.youtube.com"].contains(message.frameInfo.securityOrigin.host) else { return }
            if let row = message.body as? [String: Any] { StartupDiagnostics.performanceEvent(row) }
        case "langformPlayerDiagnostics":
            guard message.webView === player,
                  message.frameInfo.securityOrigin.protocol == "https",
                  ["youtube.com", "m.youtube.com", "www.youtube.com"].contains(message.frameInfo.securityOrigin.host),
                  let rows = message.body as? [[String: Any]] else { return }
            StartupDiagnostics.playerEvents(rows)
            StartupDiagnostics.captionEvents(rows)
            recordAudioRoutePlayerRows(rows)
            if StartupDiagnostics.playerEventsEnabled,
               rows.contains(where: { ["pointerdown", "pointerup", "touchstart", "touchend", "click", "after-input"].contains($0["event"] as? String ?? "") }) {
                StartupDiagnostics.videoMark([
                    "event": "player-input-state", "mode": String(describing: mode),
                    "interactive": player.isUserInteractionEnabled,
                    "preparationSuspended": playerPreparationSuspended,
                    "dragLatch": nativeDragVideoID != nil, "dragging": dragging,
                    "edgeBackTracking": edgeBackTracking,
                    "customFullscreen": customFullscreenID != nil
                ])
            }
        case "langformDiagnostics":
            guard StartupDiagnostics.enabled, let webView = message.webView,
                  let body = message.body as? [String: Any],
                  let event = body["event"] as? String,
                  ["feed-shell-visible", "feed-content-visible"].contains(event) else { return }
            if webView === feed {
                StartupDiagnostics.mark(event, once: true, documentMilliseconds: body["documentMilliseconds"] as? Double)
            } else if event == "feed-content-visible",
                      webView === feedTabs[.subscriptions]?.webView || webView === feedTabs[.you]?.webView {
                // Laid-out rows behind the active feed, not visible user content.
                StartupDiagnostics.mark(webView === feedTabs[.you]?.webView ? "you-preload-content-ready" : "subscriptions-preload-content-ready",
                                        documentMilliseconds: body["documentMilliseconds"] as? Double)
            }
        case "langformOverlayState":
            guard let webView = message.webView,
                  let body = message.body as? [String: Any],
                  let open = body["open"] as? Bool,
                  let href = body["href"] as? String, let url = URL(string: href) else { return }
            if webView === player {
                let expectedID = mode == .loading ? loadingVideoID : YouTubeWebView.videoID(player.url)
                guard mode != .closed, let id = YouTubeWebView.videoID(url), id == expectedID else { return }
                playerOverlayVideoID = id
                playerOverlayOpen = open
                updatePlaybackControls()
                if !open {
                    startInitialPlaybackIfEligible(id: id)
                    startVideoProbePlaybackIfEligible(id: id)
                }
                if open && mode == .expanded && (dragging || edgeBackTracking) {
                    endDrag()
                    settle(.expanded)
                }
            } else if let state = feedState(for: webView), url.absoluteString == webView.url?.absoluteString {
                state.overlayOpen = open
                webView.allowsBackForwardNavigationGestures = !open
                if webView === feed {
                    if open { cancelFeedPrewarm() } else { scheduleFeedPrewarm() }
                }
            }
        case "langformSummary":
            guard message.webView === feed || message.webView === player else { return }
            cancelFeedPrewarm()
            answerSummary(message)
        case "langformOpenWatch":
            guard message.webView === feed,
                  let body = message.body as? [String: Any],
                  let href = body["href"] as? String,
                  let url = URL(string: href),
                  YouTubeWebView.isWatchPage(url) else { return }
            openWatch(url, userInitiated: true, sourceRect: body["sourceRect"] as? [String: Any],
                      sourceThumbnail: body["sourceThumbnail"] as? [String: Any], sourceView: message.webView)
        case "langformOpening":
            feedOpeningChanged(message)
        case "langformOpeningProbe":
            guard StartupDiagnostics.enabled,
                  let probe = ProcessInfo.processInfo.environment["LANGFORM_OPENING_PROBE"],
                  ["home", "subscriptions", "interrupt", "rapid", "inspect", "search"].contains(probe),
                  message.frameInfo.isMainFrame,
                  let body = message.body as? [String: Any], let phase = body["phase"] as? String,
                  ["switch", "request", "source", "moving", "returned", "watch", "failed", "search-field", "search-results"].contains(phase) else { return }
            var entry: [String: Any] = ["event": "watch-opening-probe", "phase": phase, "probe": probe,
                                        "mode": String(describing: mode), "nativePoster": openingMotion.hasVisiblePicture,
                                        "nativeBridge": feedOpening != nil, "nativeInput": feed?.isUserInteractionEnabled == true]
            for key in ["passed", "finished", "sameAsset", "heldPreview", "landed", "reduced", "reopened", "commentsPresent", "commentsButton", "loggedIn", "videoPainted", "inputVisible", "inputReachable", "suggestionsBelowHeader"] {
                if let value = body[key] as? Bool { entry[key] = value }
            }
            for key in ["elapsed", "scrollY", "sourceY", "pictureY", "pictureWidth", "targetY", "commentsCount", "nextRequests", "inputY", "inputBottom", "inputWidth", "panelY", "resultsCount"] {
                if let value = body[key] as? Double, value.isFinite, abs(value) < 100000 { entry[key] = value }
            }
            // Structural API names only, never page text, headers, cookies or tokens.
            for key in ["tags", "methods", "globals"] {
                if let names = body[key] as? [String] {
                    entry[key] = names.prefix(40).filter { $0.range(of: "^[A-Za-z0-9_$.-]{1,80}$", options: .regularExpression) != nil }
                }
            }
            StartupDiagnostics.videoMark(entry)
            if phase == "switch", message.webView === feed, probe == "subscriptions" {
                activateFeedTab(.subscriptions, origin: YouTubeWebView.startURL)
            } else if phase == "request", message.webView === feed, mode == .closed {
                feed.evaluateJavaScript("window.__lfOpeningProbeGo && window.__lfOpeningProbeGo()")
            } else if phase == "source", message.webView === feed,
                      probe == "interrupt" || (probe == "rapid" && body["reopened"] as? Bool != true) {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.13) { [weak self] in
                    guard let self, self.feedOpening != nil else { return }
                    self.collapseTapped()
                }
            }
        case "langformWatchIntent":
            guard message.webView === player, message.frameInfo.isMainFrame,
                  mode == .expanded || mode == .mini,
                  message.frameInfo.securityOrigin.protocol == "https",
                  ["m.youtube.com", "www.youtube.com", "youtube.com"].contains(message.frameInfo.securityOrigin.host),
                  let body = message.body as? [String: Any],
                  let sourceID = body["sourceVideoID"] as? String, sourceID == startupVideoID,
                  sourceID == YouTubeWebView.videoID(player?.url),
                  let href = body["href"] as? String, let url = URL(string: href),
                  url.scheme == "https", YouTubeWebView.isYouTube(url),
                  YouTubeWebView.isWatchPage(url), YouTubeWebView.videoID(url) != nil else { return }
            openWatch(url, userInitiated: true, sourceRect: body["sourceRect"] as? [String: Any],
                      sourceThumbnail: body["sourceThumbnail"] as? [String: Any], sourceView: message.webView)
        case "langformNavigateFeed":
            let fromPlayer = message.webView === player && (mode == .expanded || mode == .mini)
            guard message.webView === feed || fromPlayer,
                  let body = message.body as? [String: Any],
                  let href = body["href"] as? String,
                  let url = URL(string: href),
                  let tab = FeedTab(url: url) else { return }
            activateFeedTab(tab, origin: url)
            if fromPlayer && mode == .expanded { minimizePlayer() }
        case "langformOpenFeed":
            guard message.webView === player,
                  let body = message.body as? [String: Any],
                  let href = body["href"] as? String,
                  let url = URL(string: href) else { return }
            showInFeed(url)
            // The video keeps playing in the card while the feed shows the page.
            if mode == .expanded && ownsWatchPlayer {
                minimizePlayer()
            } else if !ownsWatchPlayer {
                closePlayer()
            }
        case "langformPlayerRoute":
            guard message.webView === player, message.frameInfo.isMainFrame,
                  mode != .closed,
                  message.frameInfo.securityOrigin.protocol == "https",
                  ["m.youtube.com", "www.youtube.com", "youtube.com"].contains(message.frameInfo.securityOrigin.host),
                  let body = message.body as? [String: Any], let kind = body["kind"] as? String,
                  let sourceID = body["videoID"] as? String, !sourceID.isEmpty, sourceID == startupVideoID,
                  let href = body["href"] as? String, let url = URL(string: href),
                  url.scheme == "https", YouTubeWebView.isYouTube(url), !YouTubeWebView.isWatchPage(url) else { return }
            if kind == "search" {
                guard let sourceHref = body["sourceHref"] as? String,
                      YouTubeWebView.videoID(URL(string: sourceHref)) == startupVideoID,
                      ownsWatchPlayer else { return }
                openSearchInFeed()
            } else if kind == "navigate" {
                showInFeed(url)
                if mode == .expanded && ownsWatchPlayer { minimizePlayer() }
                else if !ownsWatchPlayer { retirePlayerPage(to: url) }
            } else if kind == "departed" {
                guard mode == .expanded || mode == .mini,
                      player?.url == url else { return }
                retirePlayerPage(to: url)
            }
        case "langformPlayer":
            guard message.webView === player else { return }
            takeVideoReport(message.body)
        default:
            break
        }
    }

    private func answerSummary(_ message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let webView = message.webView else { return }
        let text = body["text"] as? String ?? ""
        let sourceIncomplete = body["sourceIncomplete"] as? Bool ?? false
        let key = ObjectIdentifier(webView)
        let reply: (WKWebView, String, [String: Any]) -> Void = { webView, ticket, payload in
            guard let data = try? JSONSerialization.data(withJSONObject: payload),
                  let json = String(data: data, encoding: .utf8),
                  let idData = try? JSONEncoder().encode(ticket),
                  let idLiteral = String(data: idData, encoding: .utf8) else { return }
            let script = "window.__langformKurzFinish && window.__langformKurzFinish(\(idLiteral), \(json))"
            webView.evaluateJavaScript(script, in: nil, in: .page)
        }
        if let previous = summaryTasks.removeValue(forKey: key) {
            previous.cancel()
            // Closing the sheet keeps JS work pending. Complete the displaced
            // ticket immediately so reopening it offers an explicit retry.
            reply(webView, previous.id, OnDeviceSummary.failure("CANCELLED", "Die Kurzfassung wurde abgebrochen."))
        }
        let lease = UUID()
        let task = Task { @MainActor [weak self, weak webView] in
            let payload = await OnDeviceSummary.reply(for: text, sourceIncomplete: sourceIncomplete)
            guard !Task.isCancelled, let self, let webView,
                  self.summaryTasks[key]?.lease == lease else { return }
            self.summaryTasks.removeValue(forKey: key)
            reply(webView, id, payload)
        }
        summaryTasks[key] = SummaryRequestTask(id: id, lease: lease, task: task)
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView,
                 contextMenuConfigurationForElement elementInfo: WKContextMenuElementInfo,
                 completionHandler: @escaping (UIContextMenuConfiguration?) -> Void) {
        completionHandler(nil)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard webView === feed || webView === player,
              navigationAction.targetFrame == nil, let url = navigationAction.request.url,
              ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        guard !YouTubeWebView.isPlayablePage(url), !YouTubeWebView.isPlayableResource(url) else { return nil }
        if YouTubeWebView.isWatchPage(url) {
            openWatch(url, userInitiated: navigationAction.navigationType == .linkActivated)
        } else {
            showInFeed(url)
            if webView === player && mode == .expanded && ownsWatchPlayer {
                minimizePlayer()
            }
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
            decisionHandler(.allow)
            return
        }
        // Also reject cross-origin game iframe loads. A same-page command can
        // create one without ever navigating the main YouTube document.
        if YouTubeWebView.isPlayablePage(url) || YouTubeWebView.isPlayableResource(url) {
            decisionHandler(.cancel)
            return
        }
        if scheme != "http" && scheme != "https" && scheme != "about" && scheme != "blob" {
            decisionHandler(.cancel)
            return
        }
        if feedState(for: webView) != nil, navigationAction.targetFrame?.isMainFrame == true,
           YouTubeWebView.isAccountTransition(url) { evictCachedFeedsForAccountChange() }
        if feedState(for: webView) != nil,
           navigationAction.targetFrame?.isMainFrame == true,
           navigationAction.navigationType != .backForward,
           YouTubeWebView.isWatchPage(url) {
            decisionHandler(.cancel)
            // A hidden feed must never steal the active player's video.
            if webView === feed {
                openWatch(url, userInitiated: navigationAction.navigationType == .linkActivated)
            }
            return
        }
        // Route full navigations as well as intercepted SPA links before the
        // player leaves its watch page, so a channel tap keeps the video alive.
        if webView === player, mode == .expanded || mode == .mini,
           navigationAction.targetFrame?.isMainFrame == true,
           YouTubeWebView.isYouTube(url), !YouTubeWebView.isWatchPage(url) {
            decisionHandler(.cancel)
            showInFeed(url)
            if mode == .expanded && ownsWatchPlayer { minimizePlayer() }
            else if !ownsWatchPlayer { retirePlayerPage(to: url) }
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === player || feedState(for: webView) != nil { synchronizeStageInsets(webView, forceDocument: true) }
        feedState(for: webView)?.refresh?.finish(navigation: navigation)
        if webView === feed { StartupDiagnostics.mark("feed-finish", once: true) }
        guard webView === player || feedState(for: webView) != nil else { return }
        if webView === player, let current = playerNavigation, let navigation, navigation !== current { return }
        if webView === player, mode == .closed, let warmup = playerWarmupNavigation,
           let navigation, warmup === navigation {
            playerWarmupNavigation = nil
            if YouTubeWebView.isHomePage(webView.url) { StartupDiagnostics.mark("player-preload-ready") }
            return
        }
        if webView === player, mode != .closed, !loadingViaSPA,
           YouTubeWebView.videoID(webView.url) == loadingVideoID {
            videoLoadDiagnostics.mark(.documentFinished, ticket: loadTicket)
        }
        if let state = feedState(for: webView) {
            if let current = state.navigation, let navigation, navigation !== current { return }
            state.failed = false
            state.needsReload = false
            if let tab = prewarmingTab, feedTabs[tab]?.webView === webView {
                prewarmingTab = nil
                StartupDiagnostics.mark(tab == .you ? "you-preload-finished" : "subscriptions-preload-finished")
            }
            if let root = state.rootNavigation, let navigation, root === navigation {
                state.rootNavigation = nil
            }
            setFeedActivity(webView, active: webView === feed)
            scheduleFeedPrewarm()
            guard webView === feed else { return }
            activatePendingFeedSearch()
            startVideoProbe()
        } else if webView === player, mode != .closed && webView.url?.scheme != "about" {
            if mode == .loading, !loadingViaSPA, YouTubeWebView.videoID(webView.url) == loadingVideoID {
                loadFinished = true
                let ticket = loadTicket
                measureVideo(after: 0) { [weak self] in self?.considerReveal() }
                checkPaintAfterLoad(ticket: ticket)
            }
        }
        if !feedFailed, let feed {
            report(unreachable: false, from: feed)
        }
        updateChrome()
        considerUserAgentFallback(webView)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        feedState(for: webView)?.refresh?.failed(navigation: navigation)
        if webView === player, let current = playerNavigation, let navigation, navigation !== current { return }
        if let current = feedState(for: webView)?.navigation, let navigation, navigation !== current { return }
        finishFeedRootNavigation(webView, navigation: navigation)
        handleFailure(error, in: webView)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        feedState(for: webView)?.refresh?.failed(navigation: navigation)
        if webView === player, let current = playerNavigation, let navigation, navigation !== current { return }
        if let current = feedState(for: webView)?.navigation, let navigation, navigation !== current { return }
        finishFeedRootNavigation(webView, navigation: navigation)
        handleFailure(error, in: webView)
    }

    private func finishFeedRootNavigation(_ webView: WKWebView, navigation: WKNavigation?) {
        guard let state = feedState(for: webView), let root = state.rootNavigation,
              let navigation, root === navigation else { return }
        state.rootNavigation = nil
        if let tab = prewarmingTab, feedTabs[tab] === state {
            prewarmingTab = nil
            scheduleFeedPrewarm()
        }
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        (webView as? LangformWebView)?.synchronizeMotionPreferences()
        if webView === player || feedState(for: webView) != nil { synchronizeStageInsets(webView, forceDocument: true) }
        if webView === feed { StartupDiagnostics.mark("feed-commit", once: true) }
        if webView === player { sendNetworkPolicyToCurrentDocument() }
        if webView === player, mode == .loading, !loadingViaSPA,
           let current = playerNavigation, let navigation, current === navigation {
            loadCommitted = true
            resumePreparedPlayer()
            videoLoadDiagnostics.mark(.documentCommit, ticket: loadTicket)
            measureVideo(after: 0) { [weak self] in self?.considerReveal() }
        }
        if let state = feedState(for: webView) {
            if let current = state.navigation, let navigation, navigation !== current { return }
            // Every document starts with the inactive bootstrap flag, even when
            // its tab was already active before this navigation.
            state.refresh?.navigationCommitted(navigation)
            state.active = nil
            setFeedActivity(webView, active: webView === feed)
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        // load() already supplied the current navigation. An older callback must
        // not replace it and then make didCommit reject the requested document.
        if webView === player, mode == .loading, !loadingViaSPA,
           let current = playerNavigation, let navigation, navigation !== current { return }
        summaryTasks.removeValue(forKey: ObjectIdentifier(webView))?.cancel()
        if webView === player {
            resetCustomFullscreen()
            // If YouTube chooses a full navigation for the probe, adopt that
            // document instead of issuing a second full load at the deadline.
            if mode == .loading, loadingViaSPA {
                loadingViaSPA = false
                cancelSPAWaits()
                resetLoadReadiness()
            }
            playerNavigation = navigation
            playerOverlayOpen = false
            playerOverlayVideoID = nil
        }
        if let state = feedState(for: webView) {
            feedSearchDocumentChanged(webView)
            state.refresh?.navigationStarted(navigation)
            state.navigation = navigation
            state.contentReady = false
            state.overlayOpen = false
            webView.allowsBackForwardNavigationGestures = true
            if let root = state.rootNavigation, let navigation, root !== navigation {
                state.rootNavigation = nil
            }
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView === player {
            resetCustomFullscreen()
            playerWarmupNavigation = nil
            if mode != .closed { failPlayer() }
        } else if let state = feedState(for: webView) {
            state.refresh?.cancel()
            state.rootNavigation = nil
            state.needsReload = true
            state.failed = true
            if webView === feed {
                report(unreachable: true, from: webView)
            } else if let tab = feedTabs.first(where: { $0.value.webView === webView })?.key {
                evictFeedTab(tab)
            }
        }
    }

    private func handleFailure(_ error: Error, in webView: WKWebView) {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        // A newer load replaced this one (Startseite, redirect). The page is still coming.
        if nsError.domain == "WebKitErrorDomain" && nsError.code == 102 { return }
        if webView === player {
            playerWarmupNavigation = nil
            guard mode != .closed else { return }
            failPlayer()
            return
        } else if let state = feedState(for: webView) {
            state.failed = true
            state.needsReload = true
            guard webView === feed else { return }
            report(unreachable: true, from: webView)
        }
    }

    private func report(unreachable: Bool, from webView: WKWebView) {
        let source = ObjectIdentifier(webView)
        DispatchQueue.main.async { [weak self] in
            guard let self, let feed = self.feed, ObjectIdentifier(feed) == source else { return }
            self.onUnreachable?(unreachable)
        }
    }

    /// Only the Google sign-in pages can refuse the webview. Reading
    /// innerText on YouTube would force a full layout after every load.
    private func considerUserAgentFallback(_ webView: WKWebView) {
        if triedFallback || webView !== feed { return }
        guard YouTubeWebView.isAccountPage(webView.url) else { return }
        let script = """
        (function () {
          var href = String(location.href || "");
          var text = "";
          try {
            text = (document.body && document.body.innerText) ? document.body.innerText.slice(0, 5000) : "";
          } catch (err) {}
          return href + "\\n" + text;
        })()
        """
        webView.evaluateJavaScript(script) { [weak self, weak webView] result, _ in
            guard let self, let webView else { return }
            let blob = result as? String ?? ""
            DispatchQueue.main.async {
                guard webView === self.feed, self.isEmbeddedLoginRefusal(blob) else { return }
                self.useSafariUserAgent(webView)
            }
        }
    }

    private func useSafariUserAgent(_ webView: WKWebView) {
        if triedFallback { return }
        triedFallback = true
        UserDefaults.standard.set(true, forKey: YouTubeWebView.safariPreferenceKey)
        webView.customUserAgent = YouTubeWebView.safariUserAgent
        webView.load(URLRequest(url: YouTubeWebView.signInRetryURL))
    }

    private func isEmbeddedLoginRefusal(_ blob: String) -> Bool {
        let lower = blob.lowercased()
        if lower.contains("disallowed_useragent") { return true }
        let href = String(lower.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first ?? "")
        let onAccountHost = href.contains("accounts.google.com") || href.contains("accounts.youtube.com")
        guard onAccountHost else { return false }
        let markers = [
            "may not be secure",
            "möglicherweise nicht sicher",
            "couldn't sign you in",
            "could not sign you in",
            "anmeldung nicht möglich",
            "dieser browser oder diese app",
            "signin/rejected",
            "secure browsers policy",
            "use a different browser",
            "anderen browser",
        ]
        return markers.contains { lower.contains($0) }
    }

    // MARK: Chrome

    private static func symbol(_ name: String, size: CGFloat) -> UIImage? {
        UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: size, weight: .semibold))
    }

    private static func styleRound(_ button: UIButton, diameter: CGFloat) {
        button.tintColor = .white
        button.backgroundColor = UIColor.black.withAlphaComponent(0.62)
        button.layer.cornerRadius = diameter / 2
        button.layer.cornerCurve = .continuous
        button.layer.borderColor = UIColor.white.withAlphaComponent(0.14).cgColor
        button.layer.borderWidth = 0.5
        button.clipsToBounds = true
    }
}
