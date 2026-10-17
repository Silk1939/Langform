import Foundation
import AVFAudio

/// Current-Watch background handoff with isolated opt-in comparisons. WebKit
/// retains ownership; one category declaration never activates or plays media.
final class WatchBackgroundAudioCategoryHandoff {
    struct Owner: Equatable {
        let videoID: String
        let ticket: Int
        let token: Int
    }
    struct Result {
        let owner: Owner
        let applied: Bool
        let failed: Bool
        let current: Bool
        let milliseconds: Double
        let categoryBefore: String?
        let categoryAfter: String?
    }
    let videoID: String?
    let preservesVisibility: Bool
    private let queue: DispatchQueue
    private let lock = NSLock()
    private var generation = 0
    private var owner: Owner?

    init?(environment: [String: String] = ProcessInfo.processInfo.environment) {
        let visibility = environment["LANGFORM_BACKGROUND_VISIBILITY_PROBE"]
        let category = environment["LANGFORM_BACKGROUND_CATEGORY_PROBE"]
        if visibility != nil || category != nil {
            // Explicit comparisons remain fail-closed, including the exact
            // zero-valued visibility baseline. They never fall into normal mode.
            guard (visibility == nil || visibility == "0" || visibility == "1"),
                  (category == nil || category == "0" || category == "1"),
                  visibility == "1" || category == "1",
                  let probe = VideoLoadProbe(environment: environment), let audibleID = probe.audibleVideoID else { return nil }
            videoID = audibleID
            preservesVisibility = visibility == "1"
        } else {
            // A normal current user-open Watch needs no diagnostic native Start
            // or fixed video. Stage and JS still prove its current source owner.
            videoID = nil
            preservesVisibility = true
        }
        queue = DispatchQueue(label: "de.ipekkaya.langform.background-category", qos: .userInitiated)
    }

    func cancel() {
        lock.lock(); generation += 1; owner = nil; lock.unlock()
    }

    func request(_ next: Owner, completion: @escaping (Result) -> Void) {
        lock.lock(); generation += 1; let request = generation; owner = next; lock.unlock()
        queue.async { [weak self] in
            guard let self else { return }
            let started = ProcessInfo.processInfo.systemUptime
            self.lock.lock(); let accepted = self.generation == request && self.owner == next; self.lock.unlock()
            var applied = false, failed = false, categoryBefore: String?, categoryAfter: String?
            if accepted {
                do {
                    // A single public category declaration, never setActive.
                    // Cancellation cannot undo an already-started OS call;
                    // its result therefore records current ownership separately.
                    let session = AVAudioSession.sharedInstance()
                    categoryBefore = session.category.rawValue
                    try session.setCategory(.playback)
                    categoryAfter = session.category.rawValue
                    applied = true
                } catch { failed = true }
            }
            self.lock.lock(); let current = self.generation == request && self.owner == next; self.lock.unlock()
            let result = Result(owner: next, applied: applied, failed: failed, current: current,
                                milliseconds: max(0, (ProcessInfo.processInfo.systemUptime - started) * 1000),
                                categoryBefore: categoryBefore, categoryAfter: categoryAfter)
            DispatchQueue.main.async { completion(result) }
        }
    }
}
