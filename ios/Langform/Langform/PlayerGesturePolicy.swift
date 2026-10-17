import Foundation

/// Direction decisions shared by the native gestures and their host-side tests.
/// UIKit has already applied the pan distance threshold before these are called.
enum PlayerGesturePolicy {
    enum Position {
        case expanded, mini
    }

    static func allowsDrag(position: Position?, overlayOpen: Bool) -> Bool {
        switch position {
        case .expanded: return !overlayOpen
        // The mini card disables WebKit interaction and crops the sheet away.
        // Its native upward drag must remain available to reopen that page.
        case .mini: return true
        case nil: return false
        }
    }

    static func canBegin(
        position: Position,
        isTransitioning: Bool,
        touchBeganWhileTransitioning: Bool,
        translation: CGPoint,
        velocity: CGPoint
    ) -> Bool {
        let vertical = abs(translation.y) > abs(translation.x) * 1.15
        // A grab belongs to the transition on which the finger landed, even if
        // that spring ends before UIKit crosses its pan threshold.
        if isTransitioning || touchBeganWhileTransitioning {
            return vertical || directedFlick(translation: translation, velocity: velocity, sign: translation.y < 0 ? -1 : 1)
        }
        let sign: CGFloat = position == .expanded ? 1 : -1
        return translation.y * sign > 0 && vertical
            || directedFlick(translation: translation, velocity: velocity, sign: sign)
    }

    private static func directedFlick(translation: CGPoint, velocity: CGPoint, sign: CGFloat) -> Bool {
        translation.y * sign > 0 && velocity.y * sign > 250 && abs(velocity.y) > abs(velocity.x) * 1.15
    }

    /// Only the stationary portrait picture uses this additional direction.
    /// Existing mini/spring gestures keep canBegin's independent semantics.
    static func canEnterFullscreen(translation: CGPoint, velocity: CGPoint) -> Bool {
        if translation.x == 0 && translation.y == 0 {
            return velocity.y < -250 && abs(velocity.y) > abs(velocity.x) * 1.15
        }
        return translation.y < 0 && abs(translation.y) > abs(translation.x) * 1.15
    }

    static func finishesFullscreenEntry(ended: Bool, translation: CGPoint, velocity: CGPoint) -> Bool {
        ended && translation.y < 0 && abs(translation.y) > abs(translation.x) * 1.15
            && (translation.y <= -36 || velocity.y < -600 && abs(velocity.y) > abs(velocity.x) * 1.15)
    }

    static func scrubberInset(position: Position, isTransitioning: Bool) -> CGFloat {
        // Only the expanded, stationary WebView exposes an interactive scrubber.
        position == .expanded && !isTransitioning ? 44 : 0
    }

    /// An opening card can still be below its expanded resting position. An
    /// upward grab first consumes that visible offset, then expands the crop.
    /// Recompute from the gesture origin so reversing direction stays continuous.
    static func trackedPose(origin: CGFloat, revealOffset: CGFloat, translation: CGFloat, travel: CGFloat)
        -> (progress: CGFloat, revealOffset: CGFloat) {
        let offset = max(0, revealOffset)
        let consumed = min(0, max(-offset, translation))
        return (min(1, max(0, origin + (translation - consumed) / max(1, travel))), offset + consumed)
    }

    static func finishesMini(ended: Bool, progress: CGFloat, velocity: CGFloat, startedFromMini: Bool = false) -> Bool {
        // Cancellation restores the resting position rather than committing a
        // transition. The player's left-edge gesture always starts expanded.
        guard ended else { return startedFromMini }
        return velocity > -200 && (progress > 0.3 || velocity > 600)
    }
}
