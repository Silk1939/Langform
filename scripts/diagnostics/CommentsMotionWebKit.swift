import AppKit
import WebKit

// Runs the generated offline fixture in macOS WebKit and writes JSONL to stdout.
// This exercises the browser compositor; it is not an iPhone or live-YouTube test.
final class Runner: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    let fixtureURL: URL
    var window: NSWindow!
    var web: WKWebView!
    var timeout: DispatchWorkItem?
    var activity: NSObjectProtocol?
    init(fixtureURL: URL) {
        self.fixtureURL = fixtureURL
        super.init()
    }
    func applicationDidFinishLaunching(_ note: Notification) {
        activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .latencyCritical], reason: "Local WebKit motion validation")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "qa")
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 402, height: 874), configuration: configuration)
        web.navigationDelegate = self
        window = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Langform Kommentar-Motion · lokaler WebKit-Test"
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.contentView = web
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        web.loadFileURL(fixtureURL, allowingReadAccessTo: fixtureURL.deletingLastPathComponent())
        let item = DispatchWorkItem { print("{\"error\":\"timeout\"}"); exit(2) }
        timeout = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 25, execute: item)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("({visibility:document.visibilityState,hidden:document.hidden,viewport:[innerWidth,innerHeight]})") { value, _ in
            let info: [String: Any] = ["runner": "visibility", "appActive": NSApp.isActive, "windowVisible": self.window.isVisible, "windowOccluded": !self.window.occlusionState.contains(.visible), "document": value ?? NSNull()]
            if let data = try? JSONSerialization.data(withJSONObject: info, options: [.sortedKeys]), let json = String(data: data, encoding: .utf8) { print(json) }
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if let data = try? JSONSerialization.data(withJSONObject: message.body, options: [.sortedKeys]), let json = String(data: data, encoding: .utf8) {
            print(json)
        }
        if let result = message.body as? [String: Any], result["finished"] as? Bool == true {
            timeout?.cancel()
            let resultCode: Int32 = result["passed"] as? Bool == true ? 0 : 1
            web.stopLoading(); window.orderOut(nil)
            exit(resultCode)
        }
    }
}
guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("Usage: comments-motion-webkit /path/to/fixture.html\n".utf8))
    exit(64)
}
let fixtureURL = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
guard FileManager.default.isReadableFile(atPath: fixtureURL.path) else {
    FileHandle.standardError.write(Data("Fixture is not readable: \(fixtureURL.path)\n".utf8))
    exit(66)
}
let app = NSApplication.shared
let runner = Runner(fixtureURL: fixtureURL)
app.delegate = runner
app.setActivationPolicy(.accessory)
app.run()
