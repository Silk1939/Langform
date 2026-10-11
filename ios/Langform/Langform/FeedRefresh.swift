import UIKit
import WebKit
import QuartzCore

/// Retained by a cached feed, never attached to the separate video player.
@MainActor
final class FeedRefresh: NSObject {
    private static let pullDistance: CGFloat = 64
    private weak var scrollView: UIScrollView?
    private weak var contentView: UIView?
    private var cover: UIView?
    private var coverTimeout: DispatchWorkItem?
    private var generation = 0
    private let indicator = UIActivityIndicatorView(style: .medium)
    private let previousAlwaysBounceVertical: Bool
    private var canRefresh: (() -> Bool)?
    private var onRefresh: (() -> WKNavigation?)?
    private var pendingNavigation: WKNavigation?
    private var pendingCommitted = false
    private var pending = false
    private var awaitingRest = false
    private var settleLink: CADisplayLink?
    private var settleDeadline: TimeInterval = 0
    private var settledFrames = 0
    private var trackingPull = false
    private var pullOrigin = CGPoint.zero

    init(scrollView: UIScrollView, contentView: UIView? = nil, canRefresh: @escaping () -> Bool,
         onRefresh: @escaping () -> WKNavigation?) {
        self.scrollView = scrollView
        self.contentView = contentView
        previousAlwaysBounceVertical = scrollView.alwaysBounceVertical
        self.canRefresh = canRefresh
        self.onRefresh = onRefresh
        super.init()
        indicator.color = .label
        indicator.accessibilityLabel = "Feed aktualisieren"
        indicator.isUserInteractionEnabled = false
        indicator.hidesWhenStopped = true
        indicator.translatesAutoresizingMaskIntoConstraints = false
        (contentView ?? scrollView).addSubview(indicator)
        NSLayoutConstraint.activate([
            indicator.centerXAnchor.constraint(equalTo: scrollView.frameLayoutGuide.centerXAnchor),
            indicator.topAnchor.constraint(equalTo: scrollView.frameLayoutGuide.topAnchor, constant: 12)
        ])
        scrollView.alwaysBounceVertical = true
        // Observe WebKit's existing pan, without introducing a competing gesture.
        // A UIRefreshControl imposes its own long trigger distance and holds a
        // blank inset open during reload. This indicator never changes the inset.
        scrollView.panGestureRecognizer.addTarget(self, action: #selector(handlePan(_:)))
    }

    @objc private func handlePan(_ pan: UIPanGestureRecognizer) {
        guard let scrollView else { return }
        // The superview stays fixed while the scroll view's bounds rubber-band.
        let translation = pan.translation(in: scrollView.superview)
        switch pan.state {
        case .began:
            pullOrigin = translation
            trackingPull = !pending && canRefresh?() == true && isAtTop(scrollView)
        case .changed, .ended:
            guard trackingPull, !pending else { return }
            let dx = translation.x - pullOrigin.x
            let dy = translation.y - pullOrigin.y
            let armed = canRefresh?() == true && isAtTop(scrollView)
                && dy >= Self.pullDistance && dy > abs(dx)
            if pan.state == .ended {
                trackingPull = false
                if armed { refreshRequested() }
                else { indicator.stopAnimating() }
            } else if armed {
                indicator.startAnimating()
            } else {
                indicator.stopAnimating()
            }
        case .cancelled, .failed:
            trackingPull = false
            if !pending { indicator.stopAnimating() }
        default:
            break
        }
    }

    private func isAtTop(_ scrollView: UIScrollView) -> Bool {
        scrollView.contentOffset.y + scrollView.adjustedContentInset.top <= 1
    }

    private func refreshRequested() {
        guard !pending, canRefresh?() == true else { return }
        pending = true
        generation += 1
        awaitingRest = true
        settledFrames = 0
        settleDeadline = CACurrentMediaTime() + 2
        indicator.startAnimating()
        // .ended still contains WebKit's rubber-banded negative offset. A
        // fixed snapshot of that pose would jump up when the new document at
        // offset zero replaces it. Let the existing scroll view finish its
        // native return before retaining the viewport or replacing the DOM.
        let link = CADisplayLink(target: self, selector: #selector(settleAfterPull(_:)))
        settleLink = link
        link.add(to: .main, forMode: .common)
    }

    @objc private func settleAfterPull(_ link: CADisplayLink) {
        guard link === settleLink else { return }
        guard pending, awaitingRest, let scrollView, canRefresh?() == true else { cancel(); return }
        guard CACurrentMediaTime() < settleDeadline else { cancel(); return }
        let idle = !scrollView.isTracking && !scrollView.isDragging && !scrollView.isDecelerating
        let atRest = abs(scrollView.contentOffset.y + scrollView.adjustedContentInset.top) <= 0.5
        settledFrames = idle && atRest ? settledFrames + 1 : 0
        guard settledFrames >= 2 else { return }
        link.invalidate()
        settleLink = nil
        awaitingRest = false
        beginReloadAtRest()
    }

    private func beginReloadAtRest() {
        let token = generation
        if let contentView, let snapshot = contentView.snapshotView(afterScreenUpdates: false) {
            snapshot.frame = contentView.bounds
            snapshot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            snapshot.isUserInteractionEnabled = false
            snapshot.accessibilityElementsHidden = true
            contentView.addSubview(snapshot)
            cover = snapshot
            // Above the retained content, with the existing viewport anchors.
            contentView.bringSubviewToFront(indicator)
            let timeout = DispatchWorkItem { [weak self] in
                guard let self, self.generation == token else { return }
                self.cancel()
            }
            coverTimeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: timeout)
        }
        indicator.startAnimating()
        pendingNavigation = onRefresh?()
        // A rejected or unavailable WebKit load has no terminal callback.
        if pendingNavigation == nil { cancel() }
    }

    /// An old document's finish/failure cannot complete a newer refresh.
    func finish(navigation: WKNavigation?) {
        guard pending, let navigation, navigation === pendingNavigation else { return }
        // didFinish can precede YouTube's hydrated feed. Keep its old painted
        // contents until FeedMotion confirms real rows after two paint frames.
        if cover == nil { cancel() }
    }

    func contentReady(navigation: WKNavigation?) {
        guard acceptsContentReady(navigation: navigation) else { return }
        cancel()
    }

    func acceptsContentReady(navigation: WKNavigation?) -> Bool {
        guard pending, pendingCommitted, let navigation else { return false }
        return navigation === pendingNavigation
    }

    func navigationCommitted(_ navigation: WKNavigation?) {
        guard pending, let navigation, navigation === pendingNavigation else { return }
        pendingCommitted = true
    }

    func failed(navigation: WKNavigation?) {
        guard pending, let navigation, navigation === pendingNavigation else { return }
        cancel()
    }

    func releaseCoverForInteraction() {
        // A new gesture also cancels a pull awaiting the native return. A
        // retained picture must never conceal the page receiving a new tap.
        if pending { cancel() }
    }

    /// Another navigation replaces the document requested by the gesture.
    func navigationStarted(_ navigation: WKNavigation?) {
        guard pending, let navigation, navigation !== pendingNavigation else { return }
        cancel()
    }

    /// Also used when hiding a cached tab or stopping its web process.
    func cancel() {
        generation += 1
        settleLink?.invalidate()
        settleLink = nil
        awaitingRest = false
        settledFrames = 0
        coverTimeout?.cancel()
        coverTimeout = nil
        cover?.removeFromSuperview()
        cover = nil
        pending = false
        pendingNavigation = nil
        pendingCommitted = false
        trackingPull = false
        indicator.stopAnimating()
    }

    /// Explicit teardown removes the target and releases the owner's closures.
    func detach() {
        cancel()
        if let scrollView {
            scrollView.panGestureRecognizer.removeTarget(self, action: #selector(handlePan(_:)))
            scrollView.alwaysBounceVertical = previousAlwaysBounceVertical
        }
        indicator.removeFromSuperview()
        scrollView = nil
        contentView = nil
        canRefresh = nil
        onRefresh = nil
    }
}
