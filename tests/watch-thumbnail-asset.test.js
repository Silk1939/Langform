const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("native Still-Thumbnail-Ladung bindet URL/ID, begrenzt Antworten und verwirft Redirects, Animationen und abgebrochene Rückgaben", {
  skip: process.platform !== "darwin", timeout: 70000,
}, t => {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/MotionViews.swift"), "utf8");
  const start = source.indexOf("struct WatchThumbnailAsset {");
  const end = source.indexOf("/// One opportunistic still image", start);
  assert.ok(start >= 0 && end > start);
  const exercise = `
import Foundation
import ImageIO
class UIImage: NSObject {
    let cgImage: CGImage?
    init(cgImage: CGImage) { self.cgImage = cgImage; super.init() }
}
${source.slice(start, end)}
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }
let id = "abcdefghijk", good = URL(string: "https://i.ytimg.com/vi/abcdefghijk/hq720.jpg")!
func asset(_ url: URL = good) -> WatchThumbnailAsset {
    WatchThumbnailAsset(["url": url.absoluteString, "videoID": id], videoID: id)!
}
for raw in ["http://i.ytimg.com/vi/abcdefghijk/hq720.jpg", "https://evil.example/vi/abcdefghijk/hq720.jpg",
    "https://i.ytimg.com.evil.example/vi/abcdefghijk/hq720.jpg", "https://user@i.ytimg.com/vi/abcdefghijk/hq720.jpg",
    "https://i.ytimg.com:444/vi/abcdefghijk/hq720.jpg", "https://i.ytimg.com/vi/lmnopqrstuv/hq720.jpg",
    "https://i.ytimg.com/an_webp/abcdefghijk/mqdefault_6s.webp", "https://i.ytimg.com/vi/abcdefghijk/movie.mp4",
    "https://i.ytimg.com/vi_webp/abcdefghijk/hq720.jpg", "https://i.ytimg.com/vi/abcdefghijk/hq720.webp",
    "https://i.ytimg.com/vi/%61bcdefghijk/hq720.jpg", "https://i.ytimg.com/vi/abcdefghijk/hq720.jpg/extra"] {
    expect(!WatchThumbnailAsset.accepts(URL(string: raw)!, videoID: id), "invalid asset rejected: " + raw)
}
expect(WatchThumbnailAsset.accepts(good, videoID: id), "the exact JPEG asset is accepted")
expect(WatchThumbnailAsset.accepts(URL(string: "https://i.ytimg.com/vi_webp/abcdefghijk/hq720.webp?sqp=example")!, videoID: id),
       "still WebP preserves its original query")
expect(WatchThumbnailAsset(["url": good.absoluteString, "videoID": "lmnopqrstuv"], videoID: id) == nil,
       "the payload and requested video must agree")

let space = CGColorSpaceCreateDeviceRGB()
let context = CGContext(data: nil, width: 64, height: 36, bitsPerComponent: 8, bytesPerRow: 64 * 4,
    space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(CGColor(red: 1, green: 0, blue: 0, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: 64, height: 36))
let cg = context.makeImage()!
func encoded(_ type: String, count: Int = 1) -> Data {
    let buffer = NSMutableData()
    let destination = CGImageDestinationCreateWithData(buffer, type as CFString, count, nil)!
    for _ in 0..<count { CGImageDestinationAddImage(destination, cg, nil) }
    expect(CGImageDestinationFinalize(destination), "offline image fixture encodes")
    return buffer as Data
}
let jpeg = encoded("public.jpeg")
expect(WatchThumbnailRequest.decode(jpeg)?.cgImage?.width == 64, "real ImageIO decodes the known still")
expect(WatchThumbnailRequest.decode(encoded("com.compuserve.gif", count: 2)) == nil, "an animated container cannot become a still poster")
expect(WatchThumbnailRequest.decode(Data(repeating: 0, count: WatchThumbnailRequest.maximumBytes + 1)) == nil,
       "oversized data is rejected before decoding")
expect(WatchThumbnailRequest.decode(Data("not an image".utf8)) == nil, "invalid pixels cannot produce a poster")

class OfflineImageProtocol: URLProtocol {
    static var starts = 0
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.starts += 1
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "image/jpeg", "Content-Length": String(jpeg.count)])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: jpeg)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
func configuration() -> URLSessionConfiguration {
    let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [OfflineImageProtocol.self]; return config
}
func pump(_ condition: () -> Bool) {
    let deadline = Date().addingTimeInterval(4)
    while !condition() && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
    expect(condition(), "bounded offline URLSession completes")
}
var result: UIImage?, done = false
let first = WatchThumbnailRequest(asset: asset()) { result = $0; done = true }
first.start(configuration: configuration()); first.start(configuration: configuration())
pump { done }
expect(result?.cgImage?.width == 64 && OfflineImageProtocol.starts == 1, "one request uses the actual delegate and image decoder")
var cached: UIImage?, cacheDone = false
let second = WatchThumbnailRequest(asset: asset()) { cached = $0; cacheDone = true }
second.start(configuration: configuration()); pump { cacheDone }
expect(cached === result && OfflineImageProtocol.starts == 1, "the bounded decoded cache reuses the exact original asset")
var cancelledCallback = false
let cachedCancelled = WatchThumbnailRequest(asset: asset()) { _ in cancelledCallback = true }
cachedCancelled.start(configuration: configuration()); cachedCancelled.cancel()
RunLoop.main.run(until: Date().addingTimeInterval(0.02))
expect(!cancelledCallback, "cancel also revokes a queued cache reply")

let session = URLSession(configuration: .ephemeral), task = session.dataTask(with: good)
for (status, mime, length, url) in [(404, "image/jpeg", "100", good), (200, "text/html", "100", good),
    (200, "image/jpeg", String(WatchThumbnailRequest.maximumBytes + 1), good),
    (200, "image/jpeg", "100", URL(string: "https://evil.example/image.jpg")!)] {
    let request = WatchThumbnailRequest(asset: asset()) { _ in expect(false, "rejected responses never complete with an image") }
    let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil,
        headerFields: ["Content-Type": mime, "Content-Length": length])!
    var allowed = true
    request.urlSession(session, dataTask: task, didReceive: response) { allowed = $0 == .allow }
    expect(!allowed, "HTTP status, MIME, declared bytes and final URL are checked before data")
}
let unknownLength = WatchThumbnailRequest(asset: asset()) { _ in expect(false, "oversized streamed data never produces an image") }
var allowed = false
unknownLength.urlSession(session, dataTask: task,
    didReceive: HTTPURLResponse(url: good, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "image/jpeg"])!) {
        allowed = $0 == .allow
    }
expect(allowed, "unknown lengths remain bounded by received bytes")
unknownLength.urlSession(session, dataTask: task, didReceive: Data(repeating: 0, count: WatchThumbnailRequest.maximumBytes))
unknownLength.urlSession(session, dataTask: task, didReceive: Data([0]))
unknownLength.urlSession(session, task: task, didCompleteWithError: nil)
let redirectResponse = HTTPURLResponse(url: good, statusCode: 302, httpVersion: nil, headerFields: [:])!
for target in ["https://evil.example/image.jpg", "http://i.ytimg.com/vi/abcdefghijk/hq720.jpg",
               "https://i.ytimg.com/vi/lmnopqrstuv/hq720.jpg", "https://i.ytimg.com/an_webp/abcdefghijk/mq.webp"] {
    let request = WatchThumbnailRequest(asset: asset()) { _ in expect(false, "rejected redirects have no poster") }
    var redirected = true
    request.urlSession(session, task: task, willPerformHTTPRedirection: redirectResponse,
        newRequest: URLRequest(url: URL(string: target)!)) { redirected = $0 != nil }
    expect(!redirected, "redirect preserves exact HTTPS host, still type and target identity")
}
let boundedRedirect = WatchThumbnailRequest(asset: asset()) { _ in }
for count in 1...4 {
    var redirected = false
    boundedRedirect.urlSession(session, task: task, willPerformHTTPRedirection: redirectResponse,
        newRequest: URLRequest(url: good)) { redirected = $0 != nil }
    expect(redirected == (count <= 3), "redirect chain is bounded")
}
session.invalidateAndCancel()
print("WATCH_THUMBNAIL_ASSET_OK")
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "langform-thumbnail-asset-"));
  try {
    const file = path.join(dir, "Thumbnail.swift"); fs.writeFileSync(file, exercise);
    const result = spawnSync(compiler.stdout.trim(), [file], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /WATCH_THUMBNAIL_ASSET_OK/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
