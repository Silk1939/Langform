import AppKit
import Foundation
import WebKit

private let playerURL = "https://www.youtube.com/s/player/fixture/player_ias.vflset/en_US/base.js"
private let fixturePlayer = """
(function(){
var createURL=function(input,sp="signature",sig=undefined){
    var url=new URL(input);
    var value=Object.create({
        set:function(k,v){url.searchParams.set(k,v);},
        get:function(k){return url.searchParams.get(k);},
        clone:function(){return this;},
        apply:function(){
            var n=url.searchParams.get("n");
            if(n)url.searchParams.set("n",n.split("").reverse().join(""));
            if(sig)url.searchParams.set(sp,sig.split("").reverse().join(""));
        }
    });
    value.set("alr","yes");
    if(sig)value.set(sp,sig);
    return value;
};
}).call(this);
"""

final class FixturePlayerProtocol: URLProtocol {
    static let lock = NSLock()
    static var mode = "valid", requests = 0
    static var lastUserAgent: String?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.requests += 1
        Self.lastUserAgent = request.value(forHTTPHeaderField: "User-Agent")
        let mode = Self.mode; Self.lock.unlock()
        if mode == "hang" { return }
        let code: String
        if mode == "invalid" { code = "this is not valid JavaScript !" }
        else if mode == "expire" { code = fixturePlayer.replacingOccurrences(of: "var n=url.searchParams", with: "var deadline=Date.now()+500;while(Date.now()<deadline){};var n=url.searchParams") }
        else { code = fixturePlayer }
        let declared = mode == "declared-large" ? "8000001" : String(code.utf8.count)
        let response = HTTPURLResponse(url: request.url!, statusCode: mode == "http-error" ? 403 : 200,
                                       httpVersion: "HTTP/1.1", headerFields: ["Content-Type": mode == "html" ? "text/html" : "application/javascript", "Content-Length": declared])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if mode == "actual-large" {
            for _ in 0..<5 { client?.urlProtocol(self, didLoad: Data(repeating: 32, count: 2_000_000)) }
        } else { client?.urlProtocol(self, didLoad: Data(code.utf8)) }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
    static func select(_ next: String) { lock.lock(); mode = next; lock.unlock() }
    static func count() -> Int { lock.lock(); defer { lock.unlock() }; return requests }
}

@MainActor private final class FixtureSnapshotNavigation: NSObject, WKNavigationDelegate {
    var finished = false
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finished = true }
}

@main struct DownloadResolverExercise {
    @MainActor static func spin(_ seconds: TimeInterval) {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
    }
    @MainActor static func snapshot(script: String = playerURL, n: String = "abcDEF", signature: String? = nil,
                                     expiry: TimeInterval = Date().timeIntervalSince1970 + 300) -> [String: Any] {
        var source: [String: Any] = ["url": "https://fixture.googlevideo.com/videoplayback?expire=\(expiry)&itag=18&n=\(n)",
                                    "mimeType": "video/mp4; codecs=\"avc1.42001E, mp4a.40.2\"", "expectedBytes": 10,
                                    "requiresResolution": true]
        if let signature { source["signatureChallenge"] = signature; source["signatureParameter"] = "sig" }
        return ["videoID": "abcdefghijk", "title": "Fixture", "reason": "available",
                "pageURL": "https://m.youtube.com/watch?v=abcdefghijk", "source": source,
                "playerScriptURL": script, "userAgent": "Langform-Resolver-Fixture"]
    }
    @MainActor static func resolve(_ resolver: DownloadSourceResolver, _ input: [String: Any], expected: String = "abcdefghijk") throws -> Result<DownloadSource, Error> {
        var answer: Result<DownloadSource, Error>?
        var calls = 0
        resolver.resolve(input, expectedVideoID: expected) { value in answer = value; calls += 1 }
        let deadline = Date().addingTimeInterval(10)
        while answer == nil && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
        guard let answer, calls == 1 else { throw NSError(domain: "fixture", code: 1) }
        spin(0.05)
        precondition(calls == 1, "completion exactly once")
        return answer
    }
    @MainActor static func webKitSnapshot(_ input: [String: Any]) throws -> [String: Any] {
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame: .zero, configuration: config)
        let navigation = FixtureSnapshotNavigation(); web.navigationDelegate = navigation
        web.loadHTMLString("<!doctype html><html></html>", baseURL: nil)
        let deadline = Date().addingTimeInterval(5)
        while !navigation.finished && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
        precondition(navigation.finished, "snapshot WebKit navigation must finish")
        let serialized = String(data: try JSONSerialization.data(withJSONObject: input), encoding: .utf8)!
        var answer: Result<Any, Error>?
        web.callAsyncJavaScript("return JSON.parse(serialized);", arguments: ["serialized": serialized], in: nil, in: .page) { answer = $0 }
        while answer == nil && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
        guard let answer, let result = try answer.get() as? [String: Any] else { fatalError("snapshot WebKit bridge failed") }
        web.navigationDelegate = nil; web.stopLoading()
        return result
    }
    @MainActor static func main() throws {
        _ = NSApplication.shared; NSApp.setActivationPolicy(.prohibited)
        let folder = URL(fileURLWithPath: CommandLine.arguments[1])
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FixturePlayerProtocol.self]
        let loader: (String) throws -> String = { name in try String(contentsOf: folder.appendingPathComponent(name + ".js"), encoding: .utf8) }
        func make(_ seconds: TimeInterval = 30) -> DownloadSourceResolver {
            DownloadSourceResolver(configuration: config, deadlineSeconds: seconds, resourceLoader: loader)
        }
        let resolver = make()
        let source = try resolve(resolver, snapshot(signature: "signatureABC")).get()
        let items = URLComponents(url: source.url, resolvingAgainstBaseURL: false)!.queryItems!
        precondition(items.first(where: { $0.name == "n" })?.value == "FEDcba")
        precondition(items.first(where: { $0.name == "sig" })?.value == "CBAerutangis")
        precondition(items.first(where: { $0.name == "itag" })?.value == "18")
        precondition(FixturePlayerProtocol.lastUserAgent == "Langform-Resolver-Fixture")
        print("REAL_SHIPPING_WEBKIT_EJS_N_AND_SIGNATURE_OK")

        var nullable = snapshot(); var nullableSource = nullable["source"] as! [String: Any]
        nullableSource["signatureChallenge"] = NSNull(); nullableSource["signatureParameter"] = NSNull()
        nullable["source"] = nullableSource
        let bridged = try webKitSnapshot(nullable)
        let bridgedSource = bridged["source"] as! [String: Any]
        precondition(bridgedSource["signatureChallenge"] is NSNull && bridgedSource["signatureParameter"] is NSNull)
        let nullResult = try resolve(resolver, bridged).get()
        precondition(URLComponents(url: nullResult.url, resolvingAgainstBaseURL: false)!.queryItems!.first(where: { $0.name == "n" })?.value == "FEDcba")
        nullableSource["signatureChallenge"] = "signatureABC"; nullable["source"] = nullableSource
        let defaultSignature = try resolve(resolver, webKitSnapshot(nullable)).get()
        precondition(URLComponents(url: defaultSignature.url, resolvingAgainstBaseURL: false)!.queryItems!.first(where: { $0.name == "signature" })?.value == "CBAerutangis")
        print("WEBKIT_JSON_NULL_CIPHER_FIELDS_ARE_OPTIONAL_OK")

        let beforeObserved = FixturePlayerProtocol.count()
        var observed = snapshot(script: "not-a-player-script", n: "alreadyResolved")
        var observedSource = observed["source"] as! [String: Any]
        observedSource["requiresResolution"] = false
        observed["source"] = observedSource
        let observedResult = try resolve(resolver, observed).get()
        precondition(URLComponents(url: observedResult.url, resolvingAgainstBaseURL: false)!.queryItems!.first(where: { $0.name == "n" })?.value == "alreadyResolved")
        precondition(FixturePlayerProtocol.count() == beforeObserved)
        print("OBSERVED_COMPLETE_SOURCE_IS_NOT_TRANSFORMED_TWICE_OK")

        let requests = FixturePlayerProtocol.count()
        _ = try resolve(resolver, snapshot(n: "other123")).get()
        precondition(FixturePlayerProtocol.count() == requests, "exact player URL cached")
        let urlB = playerURL.replacingOccurrences(of: "fixture/", with: "fixtureB/")
        let urlC = playerURL.replacingOccurrences(of: "fixture/", with: "fixtureC/")
        _ = try resolve(resolver, snapshot(script: urlB)).get()
        _ = try resolve(resolver, snapshot(script: urlC)).get()
        _ = try resolve(resolver, snapshot()).get()
        precondition(FixturePlayerProtocol.count() == requests + 3, "two-entry cache evicts old URL")
        print("EXACT_PLAYER_CACHE_REUSE_AND_TWO_ENTRY_EVICTION_OK")

        for url in ["https://youtube.com.evil.test/s/player/x/a/base.js", "http://www.youtube.com/s/player/x/a/base.js",
                    "https://www.youtube.com/s/player/x/a/../base.js", "https://user@www.youtube.com/s/player/x/a/base.js",
                    "https://www.youtube.com/s/player/x/a/base.js?script=other"] {
            if case .success = try resolve(make(), snapshot(script: url)) { fatalError("invalid player accepted") }
        }
        if case .success = try resolve(make(), snapshot(), expected: "other123456") { fatalError("foreign video accepted") }
        if case .success = try resolve(make(), snapshot(expiry: Date().timeIntervalSince1970 + 30)) { fatalError("expired source accepted") }
        var malformed = snapshot(); var raw = malformed["source"] as! [String: Any]
        raw["signatureChallenge"] = "abc"; raw["signatureParameter"] = "expire"; malformed["source"] = raw
        if case .success = try resolve(make(), malformed) { fatalError("reserved signature parameter accepted") }
        raw["signatureChallenge"] = 12; raw["signatureParameter"] = "sig"; malformed["source"] = raw
        if case .success = try resolve(make(), malformed) { fatalError("malformed signature accepted") }
        raw["signatureChallenge"] = NSNull(); raw["signatureParameter"] = 12; malformed["source"] = raw
        if case .success = try resolve(make(), webKitSnapshot(malformed)) { fatalError("malformed optional signature parameter accepted") }
        print("PLAYER_URL_VIDEO_EXPIRY_AND_SIGNATURE_PARAMETER_GUARDS_OK")

        for mode in ["invalid", "html", "http-error", "declared-large", "actual-large"] {
            FixturePlayerProtocol.select(mode)
            if case .success = try resolve(make(), snapshot()) { fatalError("bad player accepted") }
        }
        let recovery = make()
        FixturePlayerProtocol.select("invalid")
        if case .success = try resolve(recovery, snapshot()) { fatalError("invalid player accepted") }
        let beforeRecovery = FixturePlayerProtocol.count()
        FixturePlayerProtocol.select("valid")
        _ = try resolve(recovery, snapshot()).get()
        precondition(FixturePlayerProtocol.count() == beforeRecovery + 1, "invalid player cannot poison cache")
        print("FAILED_PLAYER_IS_NOT_CACHED_AND_RETRY_RECOVERS_OK")
        FixturePlayerProtocol.select("expire")
        let expiring = try resolve(make(), snapshot(expiry: Date().timeIntervalSince1970 + 60.3))
        if case .success = expiring { fatalError("source expiry not rechecked after solver") }
        if case .failure(let error) = expiring { precondition(error is DownloadSourceError, "final expiry uses source policy") }
        print("SCRIPT_HTTP_DECLARED_ACTUAL_LIMIT_AND_FINAL_EXPIRY_GUARDS_OK")

        FixturePlayerProtocol.select("hang")
        let cancelled = make()
        var cancelCalls = 0
        cancelled.resolve(snapshot(), expectedVideoID: "abcdefghijk") { result in
            if case .success = result { fatalError("cancel produced source") }; cancelCalls += 1
        }
        cancelled.cancel(); cancelled.cancel(); spin(0.1)
        precondition(cancelCalls == 1)
        let timeout = make(0.08)
        if case .success = try resolve(timeout, snapshot()) { fatalError("hanging fetch succeeded") }
        print("CANCEL_AND_BOUNDED_DEADLINE_COMPLETE_EXACTLY_ONCE_OK")

        let replaced = make()
        var oldCalls = 0
        replaced.resolve(snapshot(), expectedVideoID: "abcdefghijk") { result in
            if case .success = result { fatalError("old hanging job accepted") }; oldCalls += 1
        }
        FixturePlayerProtocol.select("valid")
        _ = try resolve(replaced, snapshot()).get()
        precondition(oldCalls == 1)
        print("REPLACED_JOB_CANNOT_OVERWRITE_NEW_RESOLUTION_OK")

        let reentrant = make()
        var nested: Result<DownloadSource, Error>?, outerCalls = 0, cancelledCalls = 0
        FixturePlayerProtocol.select("hang")
        reentrant.resolve(snapshot(), expectedVideoID: "abcdefghijk") { _ in
            cancelledCalls += 1
            reentrant.resolve(snapshot(n: "nested123"), expectedVideoID: "abcdefghijk") { nested = $0 }
        }
        FixturePlayerProtocol.select("valid")
        reentrant.resolve(snapshot(n: "outer123"), expectedVideoID: "abcdefghijk") { result in
            if case .success = result { fatalError("outer request stole reentrant job") }; outerCalls += 1
        }
        let end = Date().addingTimeInterval(5)
        while nested == nil && Date() < end { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
        guard let nested else { fatalError("reentrant completion lost") }
        _ = try nested.get()
        precondition(cancelledCalls == 1 && outerCalls == 1)
        print("REENTRANT_CANCEL_CALLBACK_PRESERVES_NEWEST_JOB_OK")
    }
}
