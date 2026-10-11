import AppKit
import WebKit

// Real WebKit fixture runner with explicit, awaited PNG capture requests.
// Native visibility and preference signals are supplied by the offline HTML;
// snapshots, focus, layout and animation interpolation are WebKit's own.
final class FeedMotionRunner: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    let fixture: URL
    let output: URL
    var window: NSWindow!
    var web: WKWebView!
    var timeout: DispatchWorkItem?
    init(fixture: URL, output: URL) { self.fixture = fixture; self.output = output }

    func applicationDidFinishLaunching(_ note: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "qa")
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 402, height: 874), configuration: configuration)
        window = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Langform Feed Motion · Offline WebKit QA"
        window.contentView = web
        window.orderFront(nil)
        web.loadFileURL(fixture, allowingReadAccessTo: fixture.deletingLastPathComponent())
        let item = DispatchWorkItem { print("{\"error\":\"timeout\"}"); exit(2) }
        timeout = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 25, execute: item)
    }

    func emit(_ value: [String: Any]) {
        if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
           let json = String(data: data, encoding: .utf8) { print(json) }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let value = message.body as? [String: Any] else { return }
        if let name = value["snapshot"] as? String {
            guard name.range(of: "^[a-z0-9-]+$", options: .regularExpression) != nil else { exit(3) }
            let configuration = WKSnapshotConfiguration()
            configuration.rect = web.bounds
            configuration.afterScreenUpdates = true
            web.takeSnapshot(with: configuration) { [self] image, error in
                guard let image, let tiff = image.tiffRepresentation,
                      let representation = NSBitmapImageRep(data: tiff),
                      let png = representation.representation(using: .png, properties: [:]) else {
                    emit(["error": error?.localizedDescription ?? "Snapshot encoding failed"])
                    exit(3)
                }
                do {
                    try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
                    let path = output.appendingPathComponent(name + ".png")
                    try png.write(to: path)
                    emit(["snapshot": path.path, "width": representation.pixelsWide, "height": representation.pixelsHigh])
                    web.evaluateJavaScript("window.__qaSnapshotDone()")
                } catch { emit(["error": error.localizedDescription]); exit(3) }
            }
            return
        }
        emit(value)
        if value["finished"] as? Bool == true {
            timeout?.cancel()
            web.stopLoading()
            window.orderOut(nil)
            exit(value["passed"] as? Bool == true ? 0 : 1)
        }
    }
}

guard CommandLine.arguments.count == 3 else {
    FileHandle.standardError.write(Data("Usage: feed-motion-webkit fixture.html output-directory\n".utf8))
    exit(64)
}
let fixture = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
let output = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL
guard FileManager.default.isReadableFile(atPath: fixture.path) else { exit(66) }
let app = NSApplication.shared
let runner = FeedMotionRunner(fixture: fixture, output: output)
app.delegate = runner
app.setActivationPolicy(.accessory)
app.run()
