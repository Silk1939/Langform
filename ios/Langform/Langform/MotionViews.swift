import UIKit
import WebKit
import ImageIO

/// Presses are local to the control. UIKit still owns highlighting and actions.
final class MotionButton: UIButton {
    typealias HapticRole = LangformMotion.HapticRole
    var hapticRole: HapticRole = .none

    override var isHighlighted: Bool {
        didSet {
            guard oldValue != isHighlighted else { return }
            if isHighlighted && isEnabled && window != nil && !isHidden && alpha > 0.01 {
                LangformMotion.Haptics.prepare(hapticRole)
            }
            // Stage layout owns the control's frame, so scale only its content
            // layers. Hit area and frame geometry stay stable during a press.
            let pose = isHighlighted && !LangformMotion.reduceSpatialMotion
                ? CATransform3DMakeScale(LangformMotion.Scale.icon, LangformMotion.Scale.icon, 1) : CATransform3DIdentity
            UIView.animate(withDuration: LangformMotion.reduceSpatialMotion ? 0 : (isHighlighted ? LangformMotion.Duration.pressIn : LangformMotion.Duration.pressOut),
                           delay: 0, usingSpringWithDamping: 1,
                           initialSpringVelocity: 0,
                           options: [.beginFromCurrentState, .allowUserInteraction]) {
                self.layer.sublayerTransform = pose
            }
        }
    }

    override func sendAction(_ action: Selector, to target: Any?, for event: UIEvent?) {
        // Only a real touch action earns a tactile beat. State updates,
        // accessibility activation and diagnostic calls never buzz on their own.
        if event?.type == .touches, isEnabled, window != nil, !isHidden, alpha > 0.01 {
            LangformMotion.Haptics.send(hapticRole)
        }
        super.sendAction(action, to: target, for: event)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil { layer.removeAllAnimations(); layer.sublayerTransform = CATransform3DIdentity }
    }

    /// Animate only a visible state change, not initial setup or background
    /// playback reports. The action and accessibility label change immediately.
    func replaceSymbol(_ image: UIImage?) {
        guard window != nil, !isHidden, alpha > 0.01 else {
            setImage(image, for: .normal)
            return
        }
        UIView.transition(with: self, duration: LangformMotion.Duration.fade,
                          options: [.transitionCrossDissolve, .beginFromCurrentState, .allowUserInteraction]) {
            self.setImage(image, for: .normal)
        }
    }
}

/// Keeps one noninteractive image of the old tab, never a second active feed.
final class FeedMotion {
    private var cover: UIView?
    private var animator: UIViewPropertyAnimator?
    private weak var incoming: UIView?
    private var incomingPose = CATransform3DIdentity

    func capture(_ view: UIView) {
        finish()
        guard !UIAccessibility.isReduceMotionEnabled, !view.isHidden, view.window != nil,
              let snapshot = view.snapshotView(afterScreenUpdates: false) else { return }
        snapshot.frame = view.frame
        snapshot.isUserInteractionEnabled = false
        snapshot.accessibilityElementsHidden = true
        cover = snapshot
    }

    func reveal(_ view: UIView, direction: CGFloat = 1) {
        guard !UIAccessibility.isReduceMotionEnabled,
              let cover, let parent = view.superview else { finish(); return }
        parent.insertSubview(cover, aboveSubview: view)
        // Tabs change in place. Keep the viewport and both pictures at their
        // original size: lateral travel and depth scaling made a simple tab
        // selection feel like a page push and exposed mismatched feed edges.
        incoming = view
        incomingPose = view.layer.sublayerTransform
        let animation = UIViewPropertyAnimator(duration: 0.18,
            controlPoint1: CGPoint(x: 0.2, y: 0), controlPoint2: CGPoint(x: 0, y: 1)) {
                cover.alpha = 0
        }
        animator = animation
        animation.addCompletion { [weak self, weak animation] _ in
            guard let self, self.animator === animation else { return }
            self.finish()
        }
        animation.startAnimation()
    }

    func finish() {
        let previous = animator
        animator = nil
        previous?.stopAnimation(true)
        // Stop presentation motion before releasing the view or handling a tap.
        if let incoming {
            UIView.performWithoutAnimation { incoming.layer.sublayerTransform = self.incomingPose }
        }
        incoming = nil
        incomingPose = CATransform3DIdentity
        cover?.removeFromSuperview()
        cover = nil
    }
}

struct WatchThumbnailAsset {
    let url: URL
    let videoID: String

    init?(_ values: [String: Any]?, videoID: String?) {
        guard let videoID, let values, values["videoID"] as? String == videoID,
              let raw = values["url"] as? String, let url = URL(string: raw),
              Self.accepts(url, videoID: videoID) else { return nil }
        self.url = url
        self.videoID = videoID
    }

    static func accepts(_ url: URL, videoID: String) -> Bool {
        guard videoID.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil,
              url.scheme == "https", url.host == "i.ytimg.com", url.user == nil, url.password == nil,
              url.port == nil || url.port == 443,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.percentEncodedPath == url.path else { return false }
        let parts = url.path.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 4, parts[0].isEmpty, parts[2] == videoID else { return false }
        let file = String(parts[3])
        if parts[1] == "vi" {
            return file.range(of: "^[A-Za-z0-9_-]+\\.(jpg|jpeg)$", options: .regularExpression) != nil
        }
        if parts[1] == "vi_webp" {
            return file.range(of: "^[A-Za-z0-9_-]+\\.webp$", options: .regularExpression) != nil
        }
        return false
    }
}

/// Downloads only the still IMG asset already identified by the tapped card.
/// No WebKit media layers or video frames are captured for a loading poster.
final class WatchThumbnailRequest: NSObject, URLSessionDataDelegate {
    static let maximumBytes = 2 * 1024 * 1024
    private static let cache: NSCache<NSURL, UIImage> = {
        let cache = NSCache<NSURL, UIImage>()
        cache.countLimit = 24
        cache.totalCostLimit = 16 * 1024 * 1024
        return cache
    }()
    private let asset: WatchThumbnailAsset
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var completion: ((UIImage?) -> Void)?
    private var received = Data()
    private var acceptedResponse = false
    private var redirects = 0
    private var started = false

    init(asset: WatchThumbnailAsset, completion: @escaping (UIImage?) -> Void) {
        self.asset = asset
        self.completion = completion
    }

    func start(configuration: URLSessionConfiguration = .ephemeral) {
        guard !started, completion != nil else { return }
        started = true
        if let image = Self.cache.object(forKey: asset.url as NSURL) {
            DispatchQueue.main.async { [weak self] in
                guard let self, let completion = self.completion else { return }
                self.completion = nil
                completion(image)
            }
            return
        }
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 5
        configuration.timeoutIntervalForResource = 5
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
        self.session = session
        var request = URLRequest(url: asset.url)
        request.setValue("image/jpeg,image/webp", forHTTPHeaderField: "Accept")
        task = session.dataTask(with: request)
        task?.resume()
    }

    func cancel() {
        completion = nil
        task?.cancel()
        session?.invalidateAndCancel()
        task = nil
        session = nil
        received.removeAll()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        redirects += 1
        guard completion != nil, redirects <= 3, let url = request.url,
              WatchThumbnailAsset.accepts(url, videoID: asset.videoID) else {
            completionHandler(nil)
            cancel()
            return
        }
        completionHandler(request)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard completion != nil, let http = response as? HTTPURLResponse, http.statusCode == 200,
              let url = http.url, WatchThumbnailAsset.accepts(url, videoID: asset.videoID),
              ["image/jpeg", "image/webp"].contains(http.mimeType?.lowercased() ?? ""),
              response.expectedContentLength <= Int64(Self.maximumBytes) else {
            completionHandler(.cancel)
            cancel()
            return
        }
        acceptedResponse = true
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard completion != nil, acceptedResponse, data.count <= Self.maximumBytes - received.count else { cancel(); return }
        received.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let completion else { return }
        let data = received, url = asset.url
        received.removeAll()
        task.cancel()
        self.task = nil
        session.finishTasksAndInvalidate()
        self.session = nil
        guard error == nil, acceptedResponse, !data.isEmpty else { self.completion = nil; completion(nil); return }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let image = Self.decode(data)
            if let image, let cg = image.cgImage {
                Self.cache.setObject(image, forKey: url as NSURL, cost: cg.bytesPerRow * cg.height)
            }
            DispatchQueue.main.async { [weak self] in
                guard let self, let completion = self.completion else { return }
                self.completion = nil
                completion(image)
            }
        }
    }

    static func decode(_ data: Data) -> UIImage? {
        guard data.count <= maximumBytes,
              let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) == 1,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
              let width = properties[kCGImagePropertyPixelWidth as String] as? Int,
              let height = properties[kCGImagePropertyPixelHeight as String] as? Int,
              width > 0, height > 0, width <= 4096, height <= 4096, width * height <= 8 * 1024 * 1024,
              let cg = CGImageSourceCreateThumbnailAtIndex(source, 0,
                [kCGImageSourceCreateThumbnailFromImageAlways: true,
                 kCGImageSourceCreateThumbnailWithTransform: true,
                 kCGImageSourceThumbnailMaxPixelSize: 1600] as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }
}

/// One opportunistic still image per explicit feed tap. Playback never waits for it.
/// Its generation, URL, scroll and viewport guards prevent a stale thumbnail
/// from covering a different tab or a scrolled-away video.
final class WatchOpeningMotion {
    private weak var source: WKWebView?
    private var generation = 0
    private var viewport = CGSize.zero
    private var offset = CGPoint.zero
    private var url: URL?
    private var image: UIImage?
    private var flight: UIImageView?
    private var animator: UIViewPropertyAnimator?
    private var completing = false
    private var changingViewport = false
    private var request: WatchThumbnailRequest?

    var hasVisiblePicture: Bool { flight?.superview != nil && !completing }

    func prepare(_ values: [String: Any]?, videoID: String?, in webView: WKWebView, onReady: (() -> Void)? = nil) {
        cancel()
        guard let asset = WatchThumbnailAsset(values, videoID: videoID) else { return }
        source = webView
        viewport = webView.bounds.size
        offset = webView.scrollView.contentOffset
        url = webView.url
        let token = generation
        let request = WatchThumbnailRequest(asset: asset) { [weak self, weak webView] result in
            guard let self, self.generation == token, self.source === webView else { return }
            self.request = nil
            self.image = result
            if result != nil { onReady?() }
        }
        self.request = request
        request.start()
    }

    func reveal(in parent: UIView, above card: UIView, feed: WKWebView, destination: CGRect) {
        guard source === feed, feed.url == url,
              changingViewport || (feed.bounds.size == viewport &&
                abs(feed.scrollView.contentOffset.y - offset.y) < 2 &&
                abs(feed.scrollView.contentOffset.x - offset.x) < 2),
              destination.width > 0, destination.height > 0 else { cancel(); return }
        // Page paint may beat the image download. Preserve that pending request;
        // the stage's request/identity guards decide if its eventual image is useful.
        guard let image else { return }
        if let flight {
            if changingViewport {
                guard flight.superview === parent else { cancel(); return }
                // Rotation is an explicit viewport handoff, not a second
                // startup landing. Keep the existing picture until WebKit
                // confirms its new plane, then lay it out without a tween.
                UIView.performWithoutAnimation { flight.frame = destination }
                viewport = feed.bounds.size
                offset = feed.scrollView.contentOffset
                changingViewport = false
                return
            }
            // The poster has one resting place: the confirmed video picture.
            // A changed layout cancels the copy instead of visibly jumping it
            // from a provisional box into the actual player.
            guard flight.superview === parent, flight.frame == destination else { cancel(); return }
            return
        }
        let picture = UIImageView(image: image)
        picture.contentMode = .scaleAspectFill
        picture.clipsToBounds = true
        picture.layer.cornerRadius = 0
        picture.frame = destination
        picture.isUserInteractionEnabled = false
        picture.accessibilityElementsHidden = true
        parent.insertSubview(picture, aboveSubview: card)
        flight = picture
        // Show useful loading content immediately at the final picture plane.
        // Only the handoff to a presented video frame needs a short dissolve.
    }

    func viewportChanged() {
        // Only an already validated, visible image can cross a resize.
        guard flight != nil, !completing else { cancel(); return }
        generation += 1
        request?.cancel()
        request = nil
        changingViewport = true
    }

    func complete() {
        guard !completing else { return }
        guard let flight else { cancel(); return }
        completing = true
        animator?.stopAnimation(true)
        animator = nil
        if UIAccessibility.isReduceMotionEnabled { cancel(); return }
        let animation = UIViewPropertyAnimator(duration: 0.18,
            timingParameters: UISpringTimingParameters(dampingRatio: 1))
        animation.addAnimations { flight.alpha = 0 }
        animator = animation
        animation.addCompletion { [weak self, weak animation] _ in
            guard let self, self.animator === animation else { return }
            self.cancel()
        }
        animation.startAnimation()
    }

    func reduceMotionChanged() {
        if completing { cancel(); return }
        animator?.stopAnimation(true)
        animator = nil
        flight?.alpha = 1
    }

    func cancel() {
        generation += 1
        completing = false
        changingViewport = false
        request?.cancel()
        request = nil
        let previous = animator
        animator = nil
        previous?.stopAnimation(true)
        flight?.removeFromSuperview()
        flight = nil
        image = nil
        source = nil
    }
}

/// Keeps the source document and its decoded image above the loading Watch.
/// The native poster/first frame must own the identical plane before handoff.
final class WatchFeedOpening {
    weak var source: WKWebView?
    let token: String
    let videoID: String
    let ticket: Int
    let fromFeed: Bool
    let livePreview: Bool
    var landed = false
    var ready = false
    var reversing = false
    var onCancelled: (() -> Void)?
    private let background: UIColor?
    private let scrollBackground: UIColor?
    private let underBackground: UIColor?
    private let scrollEnabled: Bool
    private let interactionEnabled: Bool

    init?(values: [String: Any]?, source: WKWebView, videoID: String?, ticket: Int, fromFeed: Bool) {
        guard let token = values?["openingToken"] as? String,
              token.range(of: "^opening-[0-9]+-[0-9]+$", options: .regularExpression) != nil,
              let videoID, videoID.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil,
              values?["videoID"] as? String == videoID else { return nil }
        self.source = source; self.token = token; self.videoID = videoID
        self.ticket = ticket; self.fromFeed = fromFeed
        livePreview = values?["livePreview"] as? Bool == true
        background = source.backgroundColor; scrollBackground = source.scrollView.backgroundColor
        underBackground = source.underPageBackgroundColor
        scrollEnabled = source.scrollView.isScrollEnabled
        interactionEnabled = source.isUserInteractionEnabled
        source.backgroundColor = .clear; source.scrollView.backgroundColor = .clear
        source.underPageBackgroundColor = .clear
        source.scrollView.isScrollEnabled = false
        source.isUserInteractionEnabled = false
    }

    func command(_ name: String, completion: ((Any?, Error?) -> Void)? = nil) {
        // Both values are local enumerations/validated tokens; JSON preserves
        // them as data in the page world instead of interpolating source text.
        guard let data = try? JSONSerialization.data(withJSONObject: [name, token]),
              let arguments = String(data: data, encoding: .utf8), let source else { completion?(false, nil); return }
        source.evaluateJavaScript("window.__langformWatchOpeningControl && window.__langformWatchOpeningControl(...\(arguments))", completionHandler: completion)
    }

    func restore() {
        source?.backgroundColor = background; source?.scrollView.backgroundColor = scrollBackground
        source?.underPageBackgroundColor = underBackground
        source?.scrollView.isScrollEnabled = scrollEnabled
        source?.isUserInteractionEnabled = interactionEnabled
        onCancelled = nil
    }
}
