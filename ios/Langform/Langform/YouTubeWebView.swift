import SwiftUI
import UIKit
import WebKit

struct YouTubeWebView: UIViewRepresentable {
    @Binding var unreachable: Bool
    @Binding var canGoBack: Bool
    @Binding var watchPage: Bool
    var reloadToken: Int
    var goBackToken: Int

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
    static let scriptNames = ["early", "logic", "hide", "controller", "summary", "page-captions", "ShortsBootstrap"]
    /// Mobile Safari 26.6, the current iPhone string as of October 2026.
    /// The frozen OS token is 18_7; Version/26.6 is the Safari release.
    static let safariUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1"
    static let safariPreferenceKey = "langform.preferSafariUserAgent"

    static func isWatchPage(_ url: URL?) -> Bool {
        guard let url else { return false }
        let host = url.host?.lowercased() ?? ""
        let youtube = host == "youtube.com" || host == "www.youtube.com" || host == "m.youtube.com"
        guard youtube else { return false }
        return url.path == "/watch" || url.path.hasPrefix("/watch/")
    }

    static func isAccountPage(_ url: URL?) -> Bool {
        let host = url?.host?.lowercased() ?? ""
        return host == "accounts.google.com" || host == "accounts.youtube.com"
    }

    /// Back one entry, or the start page when there is none.
    static func leaveWatch(_ webView: WKWebView) {
        if webView.canGoBack {
            webView.goBack()
        } else if isWatchPage(webView.url) {
            webView.load(URLRequest(url: startURL))
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let pagePreferences = WKWebpagePreferences()
        pagePreferences.preferredContentMode = .mobile
        configuration.defaultWebpagePreferences = pagePreferences
        configuration.userContentController.add(context.coordinator, contentWorld: .page, name: "langformSummary")
        let source = Self.concatenatedScripts()
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
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.contentInset = .zero
        webView.scrollView.automaticallyAdjustsScrollIndicatorInsets = false
        // Same mobile Safari string from the first paint, so YouTube does not
        // lay out a desktop page inside the phone width.
        webView.customUserAgent = Self.safariUserAgent
        #if DEBUG
        webView.isInspectable = true
        #endif
        context.coordinator.onUnreachable = { unreachable = $0 }
        context.coordinator.onCanGoBack = { canGoBack = $0 }
        context.coordinator.onWatchPage = { watchPage = $0 }
        context.coordinator.attach(webView)
        webView.load(URLRequest(url: Self.startURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onUnreachable = { unreachable = $0 }
        context.coordinator.onCanGoBack = { canGoBack = $0 }
        context.coordinator.onWatchPage = { watchPage = $0 }
        webView.allowsBackForwardNavigationGestures = true
        if webView.customUserAgent != Self.safariUserAgent {
            webView.customUserAgent = Self.safariUserAgent
        }
        if context.coordinator.goBackToken != goBackToken {
            context.coordinator.goBackToken = goBackToken
            Self.leaveWatch(webView)
        }
        guard context.coordinator.reloadToken != reloadToken else { return }
        context.coordinator.reloadToken = reloadToken
        webView.load(URLRequest(url: Self.startURL))
    }

    private static func concatenatedScripts() -> String {
        scriptNames.compactMap { name in
            guard let url = Bundle.main.url(forResource: name, withExtension: "js") else { return nil }
            return try? String(contentsOf: url, encoding: .utf8)
        }.joined(separator: "\n")
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UIGestureRecognizerDelegate {
        var onUnreachable: ((Bool) -> Void)?
        var onCanGoBack: ((Bool) -> Void)?
        var onWatchPage: ((Bool) -> Void)?
        var reloadToken = 0
        var goBackToken = 0
        private var triedFallback = false
        private var switchingAgent = false
        private var canGoBackObservation: NSKeyValueObservation?
        private var urlObservation: NSKeyValueObservation?
        private weak var webView: WKWebView?

        func attach(_ webView: WKWebView) {
            self.webView = webView
            UserDefaults.standard.set(true, forKey: YouTubeWebView.safariPreferenceKey)
            canGoBackObservation = webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] webView, _ in
                DispatchQueue.main.async {
                    self?.onCanGoBack?(webView.canGoBack)
                }
            }
            urlObservation = webView.observe(\.url, options: [.initial, .new]) { [weak self] webView, _ in
                let watch = YouTubeWebView.isWatchPage(webView.url)
                DispatchQueue.main.async {
                    self?.onWatchPage?(watch)
                }
            }
            let swipe = UISwipeGestureRecognizer(target: self, action: #selector(swipedDownOnPlayer(_:)))
            swipe.direction = .down
            swipe.cancelsTouchesInView = false
            swipe.delaysTouchesBegan = false
            swipe.delaysTouchesEnded = false
            swipe.delegate = self
            webView.addGestureRecognizer(swipe)
        }

        /// The player sits at the top of the watch page, 16:9 of the width.
        /// The bottom strip of it is YouTube’s scrubber and stays YouTube’s.
        private func playerBand(in webView: WKWebView) -> ClosedRange<CGFloat> {
            let height = min(webView.bounds.width * 9 / 16, webView.bounds.height * 0.5)
            return 0...max(0, height - 36)
        }

        @objc private func swipedDownOnPlayer(_ recognizer: UISwipeGestureRecognizer) {
            guard recognizer.state == .ended, let webView,
                  YouTubeWebView.isWatchPage(webView.url) else { return }
            YouTubeWebView.leaveWatch(webView)
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard gestureRecognizer is UISwipeGestureRecognizer, let webView,
                  YouTubeWebView.isWatchPage(webView.url) else { return false }
            let y = gestureRecognizer.location(in: webView).y
            return playerBand(in: webView).contains(y)
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard let webView, YouTubeWebView.isWatchPage(webView.url) else { return false }
            return playerBand(in: webView).contains(touch.location(in: webView).y)
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "langformSummary",
                  let body = message.body as? [String: Any],
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

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
            }
            return nil
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let scheme = navigationAction.request.url?.scheme?.lowercased() else {
                decisionHandler(.allow)
                return
            }
            if scheme != "http" && scheme != "https" && scheme != "about" && scheme != "blob" {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            switchingAgent = false
            onUnreachable?(false)
            onCanGoBack?(webView.canGoBack)
            onWatchPage?(YouTubeWebView.isWatchPage(webView.url))
            considerUserAgentFallback(webView)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            handleFailure(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            handleFailure(error)
        }

        private func handleFailure(_ error: Error) {
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
            // A newer load replaced this one (Startseite, redirect). The page is still coming.
            if nsError.domain == "WebKitErrorDomain" && nsError.code == 102 { return }
            switchingAgent = false
            onUnreachable?(true)
        }

        /// Only the Google sign-in pages can refuse the webview. Reading
        /// innerText on YouTube would force a full layout after every load.
        private func considerUserAgentFallback(_ webView: WKWebView) {
            if triedFallback { return }
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
            switchingAgent = true
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
    }
}
