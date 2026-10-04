import SwiftUI
import WebKit

struct YouTubeWebView: UIViewRepresentable {
    @Binding var unreachable: Bool
    var reloadToken: Int

    static let startURL = URL(string: "https://m.youtube.com/")!
    /// Fresh YouTube sign-in. Used once, after Google rejects the webview user agent.
    static let signInRetryURL = URL(string: "https://accounts.google.com/ServiceLogin?service=youtube&hl=de&passive=true&continue=https://m.youtube.com/")!
    static let scriptNames = ["logic", "hide", "controller", "ShortsBootstrap"]
    /// Mobile Safari 26.6, the current iPhone string as of October 2026.
    /// The frozen OS token is 18_7; Version/26.6 is the Safari release.
    static let safariUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1"
    static let safariPreferenceKey = "langform.preferSafariUserAgent"

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        let pagePreferences = WKWebpagePreferences()
        pagePreferences.preferredContentMode = .mobile
        configuration.defaultWebpagePreferences = pagePreferences
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
        #if DEBUG
        webView.isInspectable = true
        #endif
        context.coordinator.attach(webView)
        webView.load(URLRequest(url: Self.startURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onUnreachable = { unreachable = $0 }
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

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var onUnreachable: ((Bool) -> Void)?
        var reloadToken = 0
        private var triedFallback = false
        private var switchingAgent = false

        func attach(_ webView: WKWebView) {
            if UserDefaults.standard.bool(forKey: YouTubeWebView.safariPreferenceKey) {
                webView.customUserAgent = YouTubeWebView.safariUserAgent
                triedFallback = true
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
            switchingAgent = false
            onUnreachable?(true)
        }

        private func considerUserAgentFallback(_ webView: WKWebView) {
            if triedFallback || webView.customUserAgent == YouTubeWebView.safariUserAgent { return }
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
