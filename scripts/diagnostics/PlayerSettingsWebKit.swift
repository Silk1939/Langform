import AppKit
import WebKit
import Darwin

setbuf(stdout, nil)

// Offline desktop WebKit compositor checks. Media readiness and location are
// supplied by the fixture; successful results do not establish iPhone playback.
final class Runner: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    let fixtureURL: URL
    let landscape: Bool
    var window: NSWindow!
    var web: WKWebView!
    var timeout: DispatchWorkItem?
    init(fixtureURL: URL, landscape: Bool) {
        self.fixtureURL = fixtureURL
        self.landscape = landscape
        super.init()
    }
    func applicationDidFinishLaunching(_ note: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "qa")
        let size = landscape ? NSSize(width: 852, height: 393) : NSSize(width: 393, height: 852)
        web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: configuration)
        window = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Langform Vollbild · lokaler WebKit-Test"
        window.contentView = web
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        web.loadFileURL(fixtureURL, allowingReadAccessTo: fixtureURL.deletingLastPathComponent())
        let item = DispatchWorkItem { print("{\"error\":\"timeout\"}"); exit(2) }
        timeout = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 50, execute: item)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if let body = message.body as? [String: Any], let resize = body["resize"] as? [String: NSNumber],
           let width = resize["width"]?.doubleValue, let height = resize["height"]?.doubleValue,
           width.isFinite, height.isFinite, width > 0, height > 0 {
            let size = NSSize(width: width, height: height)
            window.setContentSize(size)
            web.frame = NSRect(origin: .zero, size: size)
        }
        if let body = message.body as? [String: Any], let name = body["snapshot"] as? String,
           !name.isEmpty, name.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" }) {
            web.takeSnapshot(with: nil) { image, error in
                guard let image, let tiff = image.tiffRepresentation,
                      let bitmap = NSBitmapImageRep(data: tiff),
                      let png = bitmap.representation(using: .png, properties: [:]) else { return }
                let mode = self.landscape ? "landscape" : "portrait"
                try? png.write(to: self.fixtureURL.deletingLastPathComponent().appendingPathComponent("\(mode)-\(name).png"))
            }
        }
        if let data = try? JSONSerialization.data(withJSONObject: message.body, options: [.sortedKeys]),
           let json = String(data: data, encoding: .utf8) { print(json) }
        if let result = message.body as? [String: Any], result["finished"] as? Bool == true {
            timeout?.cancel()
            let code: Int32 = result["passed"] as? Bool == true ? 0 : 1
            web.stopLoading(); window.orderOut(nil)
            exit(code)
        }
    }
}
guard CommandLine.arguments.count == 2 || (CommandLine.arguments.count == 3 && CommandLine.arguments[2] == "--landscape") else {
    FileHandle.standardError.write(Data("Usage: player-settings-webkit /path/to/fixture.html [--landscape]\n".utf8))
    exit(64)
}
let fixtureURL = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
guard FileManager.default.isReadableFile(atPath: fixtureURL.path) else { exit(66) }
let app = NSApplication.shared
let runner = Runner(fixtureURL: fixtureURL, landscape: CommandLine.arguments.count == 3)
app.delegate = runner
app.setActivationPolicy(.accessory)
app.run()
