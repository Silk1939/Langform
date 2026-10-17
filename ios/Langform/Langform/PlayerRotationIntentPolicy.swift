import Foundation

/// Physical device movement creates one intent. Interface geometry changes do
/// not create intents: UIKit also rotates after a manual fullscreen command.
struct PlayerRotationIntentPolicy {
    enum Orientation: Equatable { case portrait, landscape, unknown }
    enum Action: Equatable { case enter, exit }
    struct Owner: Equatable {
        let videoID: String
        let ticket: Int
    }
    struct Context {
        var owner: Owner?
        var expanded = false
        var fullscreen = false
        var foreground = false
        var mediaOwned = false
        var gestureActive = false
        var overlayOpen = false
        var fullscreenTransition = false
        var nativeRotating = false
        var geometryCurrent = false
    }
    struct Request: Equatable {
        let owner: Owner
        let action: Action
        let generation: Int
    }
    private struct Pending {
        let request: Request
        let expiresAt: TimeInterval
    }
    private var observed: Orientation = .unknown
    private var generation = 0
    private var pending: Pending?
    private var landscapeDismissed = false

    /// Opening/foregrounding establishes a baseline without manufacturing a
    /// movement that happened while the app was inactive.
    mutating func reset(orientation: Orientation) {
        generation += 1
        pending = nil
        observed = orientation
        if orientation == .portrait { landscapeDismissed = false }
    }

    mutating func observe(_ orientation: Orientation, context: Context, now: TimeInterval) -> Request? {
        guard orientation != .unknown, orientation != observed else { return nil }
        generation += 1
        observed = orientation
        pending = nil
        if orientation == .portrait { landscapeDismissed = false }
        guard canOwnIntent(context), let owner = context.owner else { return nil }
        let action: Action
        if orientation == .landscape, !context.fullscreen, !landscapeDismissed { action = .enter }
        else if orientation == .portrait, context.fullscreen { action = .exit }
        else { return nil }
        let request = Request(owner: owner, action: action, generation: generation)
        pending = Pending(request: request, expiresAt: now + 2)
        return takePending(context: context, now: now)
    }

    /// Only the original orientation event can survive a short UIKit rotation
    /// and its matching WebKit geometry report. Busy fingers/sheets, a new
    /// video, a fullscreen transition or inactivity revoke it immediately.
    mutating func takePending(context: Context, now: TimeInterval) -> Request? {
        guard let pending else { return nil }
        guard now.isFinite, now <= pending.expiresAt, canOwnIntent(context),
              context.owner == pending.request.owner,
              pending.request.generation == generation,
              (pending.request.action == .enter ? !context.fullscreen : context.fullscreen) else {
            self.pending = nil
            return nil
        }
        guard !context.nativeRotating, context.geometryCurrent else { return nil }
        self.pending = nil
        return pending.request
    }

    mutating func fullscreenExitRequested() {
        generation += 1
        pending = nil
        if observed == .landscape { landscapeDismissed = true }
    }

    func isCurrent(_ request: Request, context: Context) -> Bool {
        request.generation == generation && request.owner == context.owner && canOwnIntent(context)
            && !context.nativeRotating && context.geometryCurrent
            && (request.action == .enter ? !context.fullscreen : context.fullscreen)
    }

    private func canOwnIntent(_ context: Context) -> Bool {
        context.owner != nil && context.expanded && context.foreground && context.mediaOwned
            && !context.gestureActive && !context.overlayOpen && !context.fullscreenTransition
    }
}
