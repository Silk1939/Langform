import AppKit
import WebKit

// Public fixed-video QA with an isolated, nonpersistent YouTube session.
final class Runner: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    var web: WKWebView!
    var window: NSWindow!
    func applicationDidFinishLaunching(_ note: Notification) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "qa")
        for path in CommandLine.arguments.dropFirst() {
            config.userContentController.addUserScript(WKUserScript(source: try! String(contentsOfFile: path, encoding: .utf8), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 402, height: 874), configuration: config)
        web.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1"
        window = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.contentView = web
        window.orderFront(nil)
        web.load(URLRequest(url: URL(string: "https://m.youtube.com/watch?v=M7lc1UVf-VE")!))
        DispatchQueue.main.asyncAfter(deadline: .now()+55) { print("{\"finished\":true,\"passed\":false,\"error\":\"timeout\"}"); exit(2) }
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if let data = try? JSONSerialization.data(withJSONObject: message.body, options: [.sortedKeys]), let value = String(data: data, encoding: .utf8) { print(value); fflush(stdout) }
        if let row = message.body as? [String:Any], row["finished"] as? Bool == true { web.stopLoading(); window.orderOut(nil); exit(row["passed"] as? Bool == true ? 0 : 1) }
    }
}
let app = NSApplication.shared
let runner = Runner()
app.delegate = runner
app.setActivationPolicy(.accessory)
app.run()
