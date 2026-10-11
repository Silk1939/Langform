import AppKit
import WebKit

// Offline macOS WebKit regression. Run through playback-suspension-webkit.py,
// which appends the two suspension methods from the current app source.
// The media decoder, playback promises and suspension counter are real WebKit;
// no YouTube server or iPhone interaction is involved.
final class SuspensionStage {
    var player: WKWebView!
    var playerPreparationSuspended = false
    init(player: WKWebView) { self.player = player }
}

enum FixtureFailure: Error { case failed(String) }

@MainActor
final class PlaybackSuspensionRunner: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var navigation: CheckedContinuation<Void, Error>?
    var timeout: DispatchWorkItem?
    var checks = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.websiteDataStore = .nonPersistent()
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 400, height: 160), configuration: configuration)
        web.navigationDelegate = self
        window = NSWindow(contentRect: web.frame, styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "Langform Playback Suspension · Offline WebKit QA"
        window.contentView = web
        window.orderFront(nil)
        let deadline = DispatchWorkItem { [weak self] in self?.finish(error: "timeout") }
        timeout = deadline
        DispatchQueue.main.asyncAfter(deadline: .now() + 25, execute: deadline)
        Task { @MainActor in
            do { try await exercise(); finish() }
            catch { finish(error: String(describing: error)) }
        }
    }

    func emit(_ value: [String: Any]) {
        if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
           let json = String(data: data, encoding: .utf8) { print(json) }
    }

    func finish(error: String? = nil) {
        timeout?.cancel()
        emit(["finished": true, "passed": error == nil, "checks": checks,
              "platform": "macOS WKWebView", "offline": true, "error": error ?? ""])
        web?.stopLoading()
        window?.orderOut(nil)
        exit(error == nil ? 0 : 1)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let pending = self.navigation; self.navigation = nil; pending?.resume()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        let pending = self.navigation; self.navigation = nil; pending?.resume(throwing: error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let pending = self.navigation; self.navigation = nil; pending?.resume(throwing: error)
    }

    func silentWAV() -> String {
        let sampleRate: UInt32 = 8_000
        let payload = Data(repeating: 0, count: Int(sampleRate) * 2 * 2)
        var wav = Data()
        func ascii(_ text: String) { wav.append(contentsOf: text.utf8) }
        func u16(_ value: UInt16) { var little = value.littleEndian; withUnsafeBytes(of: &little) { wav.append(contentsOf: $0) } }
        func u32(_ value: UInt32) { var little = value.littleEndian; withUnsafeBytes(of: &little) { wav.append(contentsOf: $0) } }
        ascii("RIFF"); u32(UInt32(payload.count) + 36); ascii("WAVEfmt ")
        u32(16); u16(1); u16(1); u32(sampleRate); u32(sampleRate * 2); u16(2); u16(16)
        ascii("data"); u32(UInt32(payload.count)); wav.append(payload)
        return wav.base64EncodedString()
    }

    func document(_ name: String) async throws {
        let html = """
        <!doctype html><meta charset="utf-8"><title>\(name)</title>
        <style>body{font:15px -apple-system;background:#171717;color:white;padding:18px}</style>
        <p>\(name)</p><audio id="media" loop preload="auto" src="data:audio/wav;base64,\(silentWAV())"></audio>
        <script>
        window.playOutcome = 'not-requested';
        window.startMedia = function () {
          window.playOutcome = 'pending';
          document.getElementById('media').play().then(function () { window.playOutcome = 'fulfilled'; },
            function (error) { window.playOutcome = error.name; });
        };
        </script>
        """
        try await withCheckedThrowingContinuation { continuation in
            navigation = continuation
            web.loadHTMLString(html, baseURL: URL(string: "https://offline.langform.invalid/"))
        }
    }

    func javascript(_ source: String) async throws -> Any? {
        try await withCheckedThrowingContinuation { continuation in
            web.evaluateJavaScript(source) { value, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: value) }
            }
        }
    }

    func suspend(_ value: Bool) async {
        await withCheckedContinuation { continuation in
            web.setAllMediaPlaybackSuspended(value) { continuation.resume() }
        }
    }

    func mediaState() async -> WKMediaPlaybackState {
        await withCheckedContinuation { continuation in
            web.requestMediaPlaybackState { continuation.resume(returning: $0) }
        }
    }

    func stateName(_ state: WKMediaPlaybackState) -> String {
        switch state {
        case .none: return "none"
        case .playing: return "playing"
        case .paused: return "paused"
        case .suspended: return "suspended"
        @unknown default: return "unknown"
        }
    }

    func sample(_ label: String, flag: Bool, expected: WKMediaPlaybackState, rejectedPlay: Bool = false) async throws {
        var state = await mediaState()
        for _ in 0..<30 {
            if state == expected { break }
            try await Task.sleep(nanoseconds: 100_000_000)
            state = await mediaState()
        }
        let before = try await javascript("media.currentTime") as? Double ?? -1
        try await Task.sleep(nanoseconds: 200_000_000)
        let snapshot = "({paused:media.paused,time:media.currentTime,readyState:media.readyState,playOutcome:window.playOutcome,document:document.title})"
        var media = try await javascript(snapshot) as? [String: Any] ?? [:]
        var elapsed = (media["time"] as? Double ?? -1) - before
        // A newly created audio output can begin advancing slightly after the
        // fulfilled play promise. Bound that real decoder start independently
        // of the immediate native state, instead of assuming one fixed delay.
        for _ in 0..<20 {
            if expected != .playing || elapsed > 0.1 { break }
            try await Task.sleep(nanoseconds: 100_000_000)
            media = try await javascript(snapshot) as? [String: Any] ?? [:]
            elapsed = (media["time"] as? Double ?? -1) - before
        }
        state = await mediaState()
        let playbackConfirmed = expected == .playing
            ? media["paused"] as? Bool == false && media["playOutcome"] as? String == "fulfilled" && elapsed > 0.1
            // WebKit may reconcile its audio-output clock backwards when it
            // pauses; the relevant contract is that playback does not advance.
            : media["paused"] as? Bool == true && elapsed < 0.001
        let rejectionConfirmed = !rejectedPlay || media["playOutcome"] as? String == "NotAllowedError"
        let passed = state == expected && playbackConfirmed && rejectionConfirmed
        checks += 1
        emit(["name": label, "nativeState": stateName(state), "expectedState": stateName(expected),
              "playerPreparationSuspended": flag, "media": media, "elapsedMediaSeconds": elapsed, "passed": passed])
        guard passed else { throw FixtureFailure.failed(label) }
    }

    func start() async throws { _ = try await javascript("window.startMedia(); undefined") }

    func exercise() async throws {
        try await document("Initial player")
        try await start()
        try await sample("initial media really plays", flag: false, expected: .playing)

        // Before the fix: close and idle preparation each acquire a native
        // hold, although the app keeps only a single Boolean to represent it.
        var priorFlag = true
        await suspend(true)
        await suspend(true)
        try await sample("old close plus prewarm acquires two holds", flag: priorFlag, expected: .suspended)
        priorFlag = false
        await suspend(false)
        try await sample("one resume clears app flag but leaves native suspension", flag: priorFlag, expected: .suspended)
        try await document("New video after close and refresh")
        try await start()
        try await sample("new document play remains blocked with app flag false", flag: priorFlag, expected: .suspended, rejectedPlay: true)
        await suspend(false)
        try await start()
        try await sample("second balancing resume restores real playback", flag: priorFlag, expected: .playing)

        let stage = SuspensionStage(player: web)
        for cycle in 1...3 {
            stage.suspendPreparedPlayer()
            stage.suspendPreparedPlayer()
            try await sample("fixed cycle \(cycle): close and prewarm share one hold",
                             flag: stage.playerPreparationSuspended, expected: .suspended)
            try await document("Fixed new video \(cycle)")
            stage.resumePreparedPlayer()
            stage.resumePreparedPlayer()
            try await start()
            try await sample("fixed cycle \(cycle): one release lets new media play",
                             flag: stage.playerPreparationSuspended, expected: .playing)
        }
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let runner = PlaybackSuspensionRunner()
    app.delegate = runner
    app.setActivationPolicy(.accessory)
    app.run()
}
