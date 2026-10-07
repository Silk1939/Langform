import SwiftUI
import UIKit
import WebKit

/// Two web views on one stage. The feed stays on the page Tan came from. A video
/// opens in the player view, which slides up over the feed. Swiping down on the
/// picture shrinks the player view into a card above YouTube's bottom bar. The
/// player view stays on the watch page the whole time, so playback goes on.
struct YouTubeWebView: UIViewRepresentable {
    @Binding var unreachable: Bool
    var reloadToken: Int

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
    static let scriptNames = ["early", "logic", "hide", "controller", "summary", "page-captions", "ShortsBootstrap", "WebViewLinks"]
    static let playerScriptNames = ["PlayerRect"]
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

    static func isHomePage(_ url: URL?) -> Bool {
        guard let url, isYouTube(url) else { return false }
        return url.path.isEmpty || url.path == "/"
    }

    static func isAccountPage(_ url: URL?) -> Bool {
        let host = url?.host?.lowercased() ?? ""
        return host == "accounts.google.com" || host == "accounts.youtube.com"
    }

    static func videoID(_ url: URL?) -> String? {
        guard isWatchPage(url), let url,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        return items.first(where: { $0.name == "v" })?.value
    }

    func makeUIView(context: Context) -> PlayerStage {
        let stage = PlayerStage()
        stage.onUnreachable = { unreachable = $0 }
        stage.reloadToken = reloadToken
        stage.start()
        return stage
    }

    func updateUIView(_ stage: PlayerStage, context: Context) {
        stage.onUnreachable = { unreachable = $0 }
        guard stage.reloadToken != reloadToken else { return }
        stage.reloadToken = reloadToken
        stage.reload()
    }

    static func makeWebView(relay: WKScriptMessageHandler, messages: [String], scripts: [String]) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Same store for both views: one sign-in, one set of cookies.
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let pagePreferences = WKWebpagePreferences()
        pagePreferences.preferredContentMode = .mobile
        configuration.defaultWebpagePreferences = pagePreferences
        for name in messages {
            configuration.userContentController.add(relay, contentWorld: .page, name: name)
        }
        let source = concatenatedScripts(scripts)
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
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
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
        names.compactMap { name in
            guard let url = Bundle.main.url(forResource: name, withExtension: "js") else { return nil }
            return try? String(contentsOf: url, encoding: .utf8)
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

final class PlayerStage: UIView, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UIGestureRecognizerDelegate {
    enum Mode {
        case closed
        case expanded
        case mini
    }

    var onUnreachable: ((Bool) -> Void)?
    var reloadToken = 0

    private(set) var mode: Mode = .closed
    /// 0 is the full player, 1 is the card.
    private var progress: CGFloat = 0
    /// The video element's box in the player view, in points. Read from the page, never set on it.
    private var videoRect: CGRect = .zero
    private var videoPlaying = false
    private var dragging = false
    private var feedFailed = false
    private var playerFailed = false
    private var lastWatchURL: URL?
    private var triedFallback = false
    private var showsMiniChevron: Bool?
    private var observations: [NSKeyValueObservation] = []

    private var feed: WKWebView!
    private var player: WKWebView!
    private let card = UIView()
    private let collapseButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    private let backButton = UIButton(type: .system)
    private var drag: UIPanGestureRecognizer!
    private var cardTap: UITapGestureRecognizer!

    /// Height of the pivot bar at the bottom of m.youtube.com.
    static let bottomBarHeight: CGFloat = 48
    static let blankURL = URL(string: "about:blank")!

    func start() {
        guard feed == nil else { return }
        UserDefaults.standard.set(true, forKey: YouTubeWebView.safariPreferenceKey)
        backgroundColor = .black
        let relay = ScriptRelay(self)
        let feedView = YouTubeWebView.makeWebView(
            relay: relay,
            messages: ["langformSummary", "langformOpenWatch"],
            scripts: YouTubeWebView.scriptNames
        )
        let playerView = YouTubeWebView.makeWebView(
            relay: relay,
            messages: ["langformSummary", "langformOpenFeed", "langformPlayer"],
            scripts: YouTubeWebView.scriptNames + YouTubeWebView.playerScriptNames
        )
        feed = feedView
        player = playerView
        for webView in [feedView, playerView] {
            webView.navigationDelegate = self
            webView.uiDelegate = self
        }
        addSubview(feedView)

        card.clipsToBounds = true
        card.backgroundColor = .black
        card.isHidden = true
        addSubview(card)
        card.addSubview(playerView)

        closeButton.setImage(Self.symbol("xmark", size: 13), for: .normal)
        Self.styleRound(closeButton, diameter: 28)
        closeButton.accessibilityLabel = "Schließen"
        closeButton.alpha = 0
        closeButton.addTarget(self, action: #selector(closePlayer), for: .touchUpInside)
        card.addSubview(closeButton)

        Self.styleRound(collapseButton, diameter: 44)
        collapseButton.alpha = 0
        collapseButton.addTarget(self, action: #selector(collapseTapped), for: .touchUpInside)
        addSubview(collapseButton)

        backButton.setImage(Self.symbol("chevron.backward", size: 15), for: .normal)
        Self.styleRound(backButton, diameter: 36)
        backButton.accessibilityLabel = "Zurück"
        backButton.isHidden = true
        backButton.addTarget(self, action: #selector(feedBack), for: .touchUpInside)
        addSubview(backButton)

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

        cardTap = UITapGestureRecognizer(target: self, action: #selector(expandCard))
        cardTap.delegate = self
        cardTap.isEnabled = false
        card.addGestureRecognizer(cardTap)

        observations = [
            feedView.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.updateChrome() }
            },
            feedView.observe(\.url, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.feedMoved() }
            },
            playerView.observe(\.url, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.playerMoved() }
            },
        ]
        updateChrome()
        feedView.load(URLRequest(url: YouTubeWebView.startURL))
    }

    func reload() {
        if playerFailed, mode != .closed, let url = lastWatchURL {
            player.load(URLRequest(url: url))
        }
        if feedFailed || !playerFailed {
            feed.load(URLRequest(url: YouTubeWebView.startURL))
        }
        feedFailed = false
        playerFailed = false
    }

    // MARK: Layout

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let feed, let player else { return }
        feed.frame = bounds
        // The player view keeps the full size in every mode. The page never
        // relayouts for the card; only the layer is scaled and cropped.
        player.bounds = CGRect(origin: .zero, size: bounds.size)
        if !dragging { apply(progress) }
        collapseButton.frame = CGRect(x: 10, y: 10, width: 44, height: 44)
        backButton.frame = CGRect(x: 12, y: bounds.height - 68 - 36, width: 36, height: 36)
    }

    private var hasVideoRect: Bool {
        videoRect.width > 8 && videoRect.height > 8
    }

    /// The video picture in the player view. Without a reported rect it is the
    /// top 16:9 of the view, where m.youtube.com puts the player, so the card
    /// never crops to nothing.
    private var pictureRect: CGRect {
        if hasVideoRect { return videoRect }
        return CGRect(x: 0, y: 0, width: bounds.width, height: bounds.width * 9 / 16)
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
        let bottom = bounds.height - Self.bottomBarHeight - 10
        return CGRect(x: bounds.width - width - 10, y: bottom - height, width: width, height: height)
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
        let full = bounds
        guard full.width > 0, full.height > 0 else { return }
        let source = pictureRect
        let target = miniFrame()
        let box = Self.mix(full, target, t)
        let picture = Self.mix(source, target, t)
        let scale = source.width > 0 ? picture.width / source.width : 1
        card.bounds = CGRect(origin: .zero, size: box.size)
        card.center = CGPoint(x: box.midX, y: box.midY)
        let origin = CGPoint(
            x: picture.minX - scale * source.minX - box.minX,
            y: picture.minY - scale * source.minY - box.minY
        )
        player.transform = CGAffineTransform(scaleX: scale, y: scale)
        player.center = CGPoint(x: origin.x + scale * full.width / 2, y: origin.y + scale * full.height / 2)
        card.layer.cornerRadius = 12 * t
        closeButton.frame = CGRect(x: box.width - 34, y: 6, width: 28, height: 28)
        closeButton.alpha = mode == .closed ? 0 : max(0, (t - 0.8) / 0.2)
        collapseButton.alpha = mode == .closed ? 0 : max(0, 1 - t * 3)
    }

    // MARK: Modes

    private func openWatch(_ url: URL) {
        lastWatchURL = url
        let sameVideo = mode != .closed && YouTubeWebView.videoID(url) != nil
            && YouTubeWebView.videoID(player.url) == YouTubeWebView.videoID(url)
        if !sameVideo {
            videoRect = .zero
            videoPlaying = false
            player.load(URLRequest(url: url))
        }
        switch mode {
        case .expanded:
            return
        case .mini:
            settle(.expanded)
        case .closed:
            mode = .expanded
            progress = 0
            player.isUserInteractionEnabled = true
            cardTap.isEnabled = false
            card.alpha = 1
            apply(0)
            collapseButton.alpha = 0
            card.isHidden = false
            card.transform = CGAffineTransform(translationX: 0, y: bounds.height)
            updateChrome()
            UIView.animate(
                withDuration: 0.42,
                delay: 0,
                usingSpringWithDamping: 0.9,
                initialSpringVelocity: 0,
                options: [.allowUserInteraction],
                animations: {
                    self.card.transform = .identity
                    self.collapseButton.alpha = 1
                }
            )
        }
    }

    private func settle(_ target: Mode, speed: CGFloat = 0, travel: CGFloat = 1) {
        guard target != .closed else { return }
        mode = target
        let end: CGFloat = target == .mini ? 1 : 0
        let remaining = abs(end - progress) * travel
        let spring = remaining > 1 ? min(8, abs(speed) / remaining) : 0
        player.isUserInteractionEnabled = target == .expanded
        cardTap.isEnabled = target == .mini
        updateChrome()
        UIView.animate(
            withDuration: 0.45,
            delay: 0,
            usingSpringWithDamping: 0.88,
            initialSpringVelocity: spring,
            options: [.allowUserInteraction, .beginFromCurrentState],
            animations: {
                self.progress = end
                self.apply(end)
            }
        )
    }

    /// Leaves the watch page and removes the card.
    @objc private func closePlayer() {
        guard mode != .closed else { return }
        mode = .closed
        endDrag()
        videoPlaying = false
        player.isUserInteractionEnabled = true
        cardTap.isEnabled = false
        if player.url?.scheme != "about" {
            player.load(URLRequest(url: Self.blankURL))
        }
        updateChrome()
        UIView.animate(withDuration: 0.22, animations: {
            self.card.alpha = 0
            self.collapseButton.alpha = 0
        }, completion: { _ in
            guard self.mode == .closed else { return }
            self.card.isHidden = true
            self.card.alpha = 1
            self.videoRect = .zero
            self.progress = 0
            self.apply(0)
        })
    }

    @objc private func expandCard() {
        guard mode == .mini else { return }
        settle(.expanded)
    }

    /// Down chevron while a video plays, back to the feed when nothing plays.
    @objc private func collapseTapped() {
        guard mode == .expanded else { return }
        guard videoPlaying else {
            closePlayer()
            return
        }
        if pictureOnScreen {
            settle(.mini)
            return
        }
        // Scrolled down to the comments: bring the picture back first.
        player.scrollView.setContentOffset(.zero, animated: true)
        measureVideo(after: 0.35) { [weak self] in
            guard let self, self.mode == .expanded else { return }
            self.settle(.mini)
        }
    }

    @objc private func feedBack() {
        if feed.canGoBack {
            feed.goBack()
        } else {
            feed.load(URLRequest(url: YouTubeWebView.homeURL(for: feed.url)))
        }
    }

    private func updateChrome() {
        guard let feed else { return }
        let feedOnPage = !YouTubeWebView.isHomePage(feed.url) && !YouTubeWebView.isWatchPage(feed.url)
        backButton.isHidden = !(mode != .expanded && feed.canGoBack && feedOnPage)
        if showsMiniChevron != videoPlaying {
            showsMiniChevron = videoPlaying
            collapseButton.setImage(Self.symbol(videoPlaying ? "chevron.down" : "chevron.backward", size: 19), for: .normal)
            collapseButton.accessibilityLabel = videoPlaying ? "Verkleinern" : "Zurück"
        }
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
            dragging = true
            card.layer.removeAllAnimations()
            player.layer.removeAllAnimations()
            // The scroll pan has already failed; this keeps the page still until the finger lifts.
            player.scrollView.isScrollEnabled = false
            follow(pan)
        case .changed:
            follow(pan)
        case .ended, .cancelled, .failed:
            let travel = dragTravel
            let speed = pan.velocity(in: self).y
            endDrag()
            let toMini = pan.state == .ended && speed > -200 && (progress > 0.3 || speed > 600)
            settle(toMini ? .mini : .expanded, speed: speed, travel: travel)
        default:
            break
        }
    }

    /// The card follows the finger: progress is the downward translation over the way to the card.
    private func follow(_ pan: UIPanGestureRecognizer) {
        let t = min(1, max(0, pan.translation(in: self).y / dragTravel))
        progress = t
        apply(t)
    }

    private func endDrag() {
        dragging = false
        drag.cancelsTouchesInView = false
        player.scrollView.isScrollEnabled = true
    }

    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === drag else { return super.gestureRecognizerShouldBegin(gestureRecognizer) }
        guard mode == .expanded, YouTubeWebView.isWatchPage(player.url) else { return false }
        // Only a clear downward swipe. A tap, a scrub or a sideways move stays YouTube's.
        let move = drag.translation(in: self)
        let speed = drag.velocity(in: self)
        let downward = move.y > 6 && move.y > abs(move.x) * 2
        let flick = move.y > 0 && speed.y > 250 && speed.y > abs(speed.x) * 2
        let begins = downward || flick
        // From here on the page gets touchcancel, so YouTube does not also act on
        // the drag. A tap never reaches this point and still plays.
        drag.cancelsTouchesInView = begins
        return begins
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        if gestureRecognizer === cardTap {
            guard let view = touch.view else { return true }
            return !view.isDescendant(of: closeButton)
        }
        guard gestureRecognizer === drag else { return true }
        guard mode == .expanded, YouTubeWebView.isWatchPage(player.url) else { return false }
        // The visible part of the picture, without its bottom strip, which is YouTube's scrubber.
        var band = pictureRect.intersection(CGRect(origin: .zero, size: bounds.size))
        guard !band.isNull, band.height > 40 else { return false }
        band.size.height -= 32
        return band.contains(touch.location(in: player))
    }

    /// The web view's scroll pan waits for the drag. A touch on the picture that
    /// goes down becomes the drag and the scroll pan fails; anything else fails the
    /// drag within a few points and the page scrolls as before.
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        gestureRecognizer === drag && otherGestureRecognizer === player?.scrollView.panGestureRecognizer
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        let scrollPan = player?.scrollView.panGestureRecognizer
        if gestureRecognizer === drag && otherGestureRecognizer === scrollPan { return false }
        if otherGestureRecognizer === drag && gestureRecognizer === scrollPan { return false }
        return true
    }

    // MARK: Where each view goes

    private func feedMoved() {
        updateChrome()
        guard let url = feed.url, YouTubeWebView.isWatchPage(url) else { return }
        // YouTube navigated the feed itself. The video belongs in the player view.
        openWatch(url)
        if feed.canGoBack {
            feed.goBack()
        } else {
            feed.load(URLRequest(url: YouTubeWebView.homeURL(for: url)))
        }
    }

    private func playerMoved() {
        guard let url = player.url else { return }
        if YouTubeWebView.isWatchPage(url) {
            lastWatchURL = url
            return
        }
        guard mode != .closed else { return }
        if url.scheme == "about" {
            closePlayer()
            return
        }
        // A channel, search or the start page belongs to the feed.
        showInFeed(url)
        closePlayer()
    }

    private func showInFeed(_ url: URL) {
        let current = feed.url
        let same = current?.host == url.host && current?.path == url.path && current?.query == url.query
        if !same {
            feed.load(URLRequest(url: url))
        }
    }

    private func measureVideo(after delay: TimeInterval, _ done: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self else { return }
            self.player.evaluateJavaScript("window.__langformMeasureVideo ? window.__langformMeasureVideo() : null") { [weak self] result, _ in
                self?.takeVideoReport(result)
                done()
            }
        }
    }

    private func takeVideoReport(_ body: Any?) {
        guard let dict = body as? [String: Any] else { return }
        func number(_ key: String) -> CGFloat {
            guard let value = dict[key] as? NSNumber else { return 0 }
            return CGFloat(truncating: value)
        }
        let rect = CGRect(x: number("x"), y: number("y"), width: number("width"), height: number("height"))
        videoPlaying = (dict["playing"] as? NSNumber)?.boolValue ?? false
        let valid = rect.width > 8 && rect.height > 8
        // The card keeps its last picture; an empty rect only counts in the full player.
        if valid {
            videoRect = rect
        } else if mode == .expanded && !dragging {
            videoRect = .zero
        }
        if valid && mode == .mini && !dragging {
            UIView.animate(withDuration: 0.2) { self.apply(1) }
        }
        updateChrome()
    }

    // MARK: Messages

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "langformSummary":
            answerSummary(message)
        case "langformOpenWatch":
            guard message.webView === feed,
                  let body = message.body as? [String: Any],
                  let href = body["href"] as? String,
                  let url = URL(string: href),
                  YouTubeWebView.isWatchPage(url) else { return }
            openWatch(url)
        case "langformOpenFeed":
            guard message.webView === player,
                  let body = message.body as? [String: Any],
                  let href = body["href"] as? String,
                  let url = URL(string: href) else { return }
            showInFeed(url)
            // The video keeps playing in the card while the feed shows the page.
            if mode == .expanded {
                settle(.mini)
            } else {
                closePlayer()
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
        Task { @MainActor in
            let payload = await OnDeviceSummary.reply(for: text)
            guard let data = try? JSONSerialization.data(withJSONObject: payload),
                  let json = String(data: data, encoding: .utf8),
                  let idData = try? JSONEncoder().encode(id),
                  let idLiteral = String(data: idData, encoding: .utf8) else { return }
            let script = "window.__langformKurzFinish && window.__langformKurzFinish(\(idLiteral), \(json))"
            webView.evaluateJavaScript(script, in: nil, in: .page)
        }
    }

    // MARK: Navigation

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard navigationAction.targetFrame == nil, let url = navigationAction.request.url else { return nil }
        if YouTubeWebView.isWatchPage(url) {
            openWatch(url)
        } else {
            feed.load(navigationAction.request)
            if webView === player && mode == .expanded {
                settle(.mini)
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
        if scheme != "http" && scheme != "https" && scheme != "about" && scheme != "blob" {
            decisionHandler(.cancel)
            return
        }
        if webView === feed,
           navigationAction.targetFrame?.isMainFrame == true,
           navigationAction.navigationType != .backForward,
           YouTubeWebView.isWatchPage(url) {
            decisionHandler(.cancel)
            openWatch(url)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === feed {
            feedFailed = false
        } else {
            playerFailed = false
        }
        if !feedFailed && !playerFailed {
            report(unreachable: false)
        }
        updateChrome()
        considerUserAgentFallback(webView)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleFailure(error, in: webView)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleFailure(error, in: webView)
    }

    private func handleFailure(_ error: Error, in webView: WKWebView) {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        // A newer load replaced this one (Startseite, redirect). The page is still coming.
        if nsError.domain == "WebKitErrorDomain" && nsError.code == 102 { return }
        if webView === player {
            guard mode != .closed else { return }
            playerFailed = true
        } else {
            feedFailed = true
        }
        report(unreachable: true)
    }

    private func report(unreachable: Bool) {
        DispatchQueue.main.async { [weak self] in
            self?.onUnreachable?(unreachable)
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
                guard self.isEmbeddedLoginRefusal(blob) else { return }
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
        button.backgroundColor = UIColor.black.withAlphaComponent(0.55)
        button.layer.cornerRadius = diameter / 2
        button.clipsToBounds = true
    }
}
