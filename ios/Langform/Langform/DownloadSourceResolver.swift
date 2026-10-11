import Foundation
import WebKit

enum DownloadSourceResolverError: LocalizedError {
    case invalidPlayer, invalidChallenge, solverUnavailable, failed, timedOut, cancelled
    var errorDescription: String? {
        switch self {
        case .invalidPlayer: return "Die aktuelle Videoquelle konnte nicht sicher aufgelöst werden. Öffne das Video erneut."
        case .invalidChallenge, .failed: return "Der Videolink konnte gerade nicht aufgelöst werden. Versuche den Download erneut."
        case .solverUnavailable: return "Die Downloadfunktion ist gerade nicht verfügbar. Starte die App erneut."
        case .timedOut: return "Die Downloadvorbereitung hat zu lange gedauert. Versuche es erneut."
        case .cancelled: return "Die Downloadvorbereitung wurde abgebrochen."
        }
    }
}

/// Resolves only the current combined MP4. All player code runs in a separate,
/// network-isolated, nonpersistent WebKit context with pinned EJS 0.8.0 scripts.
/// The playback WebView, account cookies and background transfer remain separate.
@MainActor final class DownloadSourceResolver: NSObject, WKNavigationDelegate {
    private static let maximumScriptBytes = 8_000_000
    private static let document = """
    <!doctype html><html><head><meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; form-action 'none'; base-uri 'none'"></head><body></body></html>
    """
    private final class Job {
        let snapshot: [String: Any]
        let videoID: String
        let playerScriptURL: URL
        let completion: (Result<DownloadSource, Error>) -> Void
        let requests: [[String: Any]]
        let signatureParameter: String
        var playerCode: String?
        var timeout: DispatchWorkItem?
        init(snapshot: [String: Any], videoID: String, playerScriptURL: URL, requests: [[String: Any]], signatureParameter: String,
             completion: @escaping (Result<DownloadSource, Error>) -> Void) {
            self.snapshot = snapshot; self.videoID = videoID; self.playerScriptURL = playerScriptURL; self.requests = requests
            self.signatureParameter = signatureParameter; self.completion = completion
        }
    }
    private let configuration: URLSessionConfiguration
    private let resourceLoader: (String) throws -> String
    private let deadlineSeconds: TimeInterval
    private var current: Job?
    private var generation = 0
    private var fetch: BoundedPlayerScriptRequest?
    private var solver: WKWebView?
    private var playerCache: [(url: URL, code: String)] = []

    /// Injection is limited to the transport/resource boundaries; production
    /// identity, expiry, byte limits and real WebKit solver execute unchanged.
    init(configuration: URLSessionConfiguration = .ephemeral, deadlineSeconds: TimeInterval = 30,
         resourceLoader: @escaping (String) throws -> String = { name in
             guard let url = Bundle.main.url(forResource: name, withExtension: "js") else {
                 throw DownloadSourceResolverError.solverUnavailable
             }
             return try String(contentsOf: url, encoding: .utf8)
         }) {
        self.configuration = configuration; self.resourceLoader = resourceLoader
        self.deadlineSeconds = min(30, max(0.01, deadlineSeconds))
        super.init()
    }

    func resolve(_ snapshot: [String: Any], expectedVideoID: String,
                 completion: @escaping (Result<DownloadSource, Error>) -> Void) {
        generation &+= 1
        let requestGeneration = generation
        if let job = current { finish(job, .failure(DownloadSourceResolverError.cancelled)) }
        // A cancelled callback may synchronously start another request. The
        // newer request wins; never overwrite it or leave its completion open.
        guard generation == requestGeneration else {
            completion(.failure(DownloadSourceResolverError.cancelled)); return
        }
        do {
            guard let source = snapshot["source"] as? [String: Any] else {
                _ = try DownloadSourcePolicy.assessment(snapshot, expectedVideoID: expectedVideoID)
                throw DownloadSourceResolverError.invalidChallenge
            }
            guard source["requiresResolution"] as? Bool == true else {
                completion(.success(try DownloadSourcePolicy.assessment(snapshot, expectedVideoID: expectedVideoID)))
                return
            }
            // Validate a private copy first. The ordinary source policy never
            // permits requiresResolution=true to reach a background download.
            var clean = snapshot, rawSource = source
            rawSource.removeValue(forKey: "requiresResolution")
            clean["source"] = rawSource
            let raw = try DownloadSourcePolicy.assessment(clean, expectedVideoID: expectedVideoID)
            guard raw.url.absoluteString.utf8.count <= 32_768,
                  let components = URLComponents(url: raw.url, resolvingAgainstBaseURL: false) else {
                throw DownloadSourceResolverError.invalidChallenge
            }
            let nItems = (components.queryItems ?? []).filter { $0.name == "n" }
            guard nItems.count <= 1 else { throw DownloadSourceResolverError.invalidChallenge }
            var requests: [[String: Any]] = []
            if let challenge = nItems.first?.value {
                guard Self.validChallenge(challenge) else { throw DownloadSourceResolverError.invalidChallenge }
                requests.append(["type": "n", "challenges": [challenge]])
            }
            // JSON null crosses the WebKit boundary as NSNull. Optional cipher
            // fields may be absent or null; all other nonstring values fail.
            let signatureChallenge = source["signatureChallenge"] is NSNull ? nil : source["signatureChallenge"]
            let signatureValue = source["signatureParameter"] is NSNull ? nil : source["signatureParameter"]
            guard signatureChallenge == nil || signatureChallenge is String,
                  signatureValue == nil || signatureValue is String else {
                throw DownloadSourceResolverError.invalidChallenge
            }
            let signatureParameter = signatureValue as? String ?? "signature"
            if let challenge = signatureChallenge as? String {
                guard Self.validChallenge(challenge), ["signature", "sig"].contains(signatureParameter) else {
                    throw DownloadSourceResolverError.invalidChallenge
                }
                requests.append(["type": "sig", "challenges": [challenge]])
            }
            guard !requests.isEmpty, let value = snapshot["playerScriptURL"] as? String,
                  value.utf8.count <= 2_048, let scriptURL = URL(string: value),
                  Self.allowedPlayerScript(scriptURL) else { throw DownloadSourceResolverError.invalidPlayer }
            let job = Job(snapshot: clean, videoID: expectedVideoID, playerScriptURL: scriptURL, requests: requests,
                          signatureParameter: signatureParameter, completion: completion)
            current = job
            let timeout = DispatchWorkItem { [weak self, weak job] in
                guard let self, let job, self.current === job else { return }
                self.finish(job, .failure(DownloadSourceResolverError.timedOut))
            }
            job.timeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + deadlineSeconds, execute: timeout)
            if let index = playerCache.firstIndex(where: { $0.url == scriptURL }) {
                let cached = playerCache.remove(at: index)
                playerCache.append(cached)
                startSolver(job, playerCode: cached.code)
                return
            }
            var request = URLRequest(url: scriptURL)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            request.timeoutInterval = min(15, deadlineSeconds)
            if let userAgent = snapshot["userAgent"] as? String, Self.validUserAgent(userAgent) {
                request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
            }
            let fetch = BoundedPlayerScriptRequest(request: request, configuration: configuration,
                                                   maximumBytes: Self.maximumScriptBytes) { [weak self, weak job] result in
                guard let self, let job, self.current === job else { return }
                self.fetch = nil
                switch result {
                case .success(let code):
                    self.startSolver(job, playerCode: code)
                case .failure: self.finish(job, .failure(DownloadSourceResolverError.failed))
                }
            }
            self.fetch = fetch
            fetch.start()
        } catch { completion(.failure(error)) }
    }

    func cancel() {
        generation &+= 1
        guard let job = current else { return }
        finish(job, .failure(DownloadSourceResolverError.cancelled))
    }

    private static func validChallenge(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 4_096 && !value.unicodeScalars.contains { $0.value < 33 || $0.value > 126 }
    }
    private static func validUserAgent(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 512 && !value.unicodeScalars.contains { $0.value < 32 || $0.value == 127 }
    }
    private static func allowedPlayerScript(_ url: URL) -> Bool {
        guard let c = URLComponents(url: url, resolvingAgainstBaseURL: false), c.scheme == "https",
              ["www.youtube.com", "m.youtube.com"].contains(c.host?.lowercased() ?? ""),
              c.user == nil, c.password == nil, c.port == nil || c.port == 443,
              c.query == nil, c.fragment == nil else { return false }
        return c.path.range(of: "^/s/player/[A-Za-z0-9_-]+/[A-Za-z0-9_./-]+/base\\.js$", options: .regularExpression) != nil
            && !c.path.split(separator: "/").contains("..")
    }

    private func startSolver(_ job: Job, playerCode: String) {
        guard current === job else { return }
        job.playerCode = playerCode
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        solver = web
        web.loadHTMLString(Self.document, baseURL: nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(webView === solver && navigationAction.request.url?.absoluteString == "about:blank" ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === solver, let job = current, let code = job.playerCode else { return }
        do {
            let lib = try resourceLoader("DownloadSolverLib"), core = try resourceLoader("DownloadSolverCore")
            guard lib.utf8.count <= 200_000, core.utf8.count <= 20_000 else { throw DownloadSourceResolverError.solverUnavailable }
            webView.evaluateJavaScript(lib + "\nObject.assign(globalThis,lib);\n" + core + "\nvoid 0;") { [weak self, weak job, weak webView] _, error in
                guard let self, let job, let webView, self.current === job, self.solver === webView else { return }
                guard error == nil else { self.finish(job, .failure(DownloadSourceResolverError.solverUnavailable)); return }
                webView.callAsyncJavaScript("return JSON.stringify(jsc({type:'player',player:player,requests:requests,output_preprocessed:false}));",
                    arguments: ["player": code, "requests": job.requests], in: nil, in: .page) { [weak self, weak job, weak webView] result in
                    guard let self, let job, let webView, self.current === job, self.solver === webView else { return }
                    do {
                        let value = try result.get()
                        let resolved = try self.resolvedSource(job, value: value)
                        self.finish(job, .success(resolved))
                    } catch { self.finish(job, .failure(error is DownloadSourceError ? error : DownloadSourceResolverError.failed)) }
                }
            }
        } catch { finish(job, .failure(DownloadSourceResolverError.solverUnavailable)) }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if webView === solver, let job = current { finish(job, .failure(DownloadSourceResolverError.failed)) }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView === solver, let job = current { finish(job, .failure(DownloadSourceResolverError.failed)) }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView === solver, let job = current { finish(job, .failure(DownloadSourceResolverError.failed)) }
    }

    private func resolvedSource(_ job: Job, value: Any) throws -> DownloadSource {
        guard let string = value as? String, string.utf8.count <= 32_768,
              let data = string.data(using: .utf8),
              let result = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              result["type"] as? String == "result", let responses = result["responses"] as? [[String: Any]],
              responses.count == job.requests.count, var source = job.snapshot["source"] as? [String: Any],
              let url = source["url"] as? String, var components = URLComponents(string: url) else {
            throw DownloadSourceResolverError.failed
        }
        var items = components.queryItems ?? []
        for (index, response) in responses.enumerated() {
            guard response["type"] as? String == "result", let values = response["data"] as? [String: String],
                  let original = (job.requests[index]["challenges"] as? [String])?.first,
                  let transformed = values[original], Self.validChallenge(transformed), !transformed.hasPrefix("enhanced_except_") else {
                throw DownloadSourceResolverError.failed
            }
            let key = job.requests[index]["type"] as? String == "n" ? "n" : job.signatureParameter
            items.removeAll { $0.name == key }
            items.append(URLQueryItem(name: key, value: transformed))
        }
        components.queryItems = items
        guard let final = components.url else { throw DownloadSourceResolverError.failed }
        source["url"] = final.absoluteString
        source.removeValue(forKey: "signatureChallenge")
        source.removeValue(forKey: "signatureParameter")
        var snapshot = job.snapshot
        snapshot["source"] = source
        return try DownloadSourcePolicy.assessment(snapshot, expectedVideoID: job.videoID)
    }

    private func finish(_ job: Job, _ result: Result<DownloadSource, Error>) {
        guard current === job else { return }
        if case .success = result, let code = job.playerCode {
            playerCache.removeAll { $0.url == job.playerScriptURL }
            playerCache.append((job.playerScriptURL, code))
            while playerCache.count > 2 { playerCache.removeFirst() }
        }
        current = nil
        job.timeout?.cancel(); job.timeout = nil
        fetch?.cancel(); fetch = nil
        solver?.navigationDelegate = nil
        solver?.stopLoading(); solver = nil
        job.playerCode = nil
        job.completion(result)
    }
}

/// Streaming bounds apply to declared and actual bytes before accumulation.
/// A serial delegate queue keeps native network work outside the UI thread.
private final class BoundedPlayerScriptRequest: NSObject, URLSessionDataDelegate {
    private let request: URLRequest
    private let configuration: URLSessionConfiguration
    private let maximumBytes: Int
    private let completion: @MainActor (Result<String, Error>) -> Void
    private let lock = NSLock()
    private var finished = false
    private var received = Data()
    private var session: URLSession?
    private var task: URLSessionDataTask?
    init(request: URLRequest, configuration: URLSessionConfiguration, maximumBytes: Int,
         completion: @escaping @MainActor (Result<String, Error>) -> Void) {
        self.request = request; self.configuration = configuration
        self.maximumBytes = maximumBytes; self.completion = completion
    }
    func start() {
        let config = configuration.copy() as! URLSessionConfiguration
        config.urlCache = nil; config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
        queue.qualityOfService = .utility
        let session = URLSession(configuration: config, delegate: self, delegateQueue: queue)
        self.session = session
        let task = session.dataTask(with: request)
        self.task = task; task.resume()
    }
    func cancel() { complete(.failure(DownloadSourceResolverError.cancelled)) }
    private func complete(_ result: Result<String, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true; received.removeAll(keepingCapacity: false)
        lock.unlock()
        session?.invalidateAndCancel()
        DispatchQueue.main.async { self.completion(result) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let response = response as? HTTPURLResponse, response.statusCode == 200, response.url == request.url,
              response.expectedContentLength <= maximumBytes,
              ["text/javascript", "application/javascript", "application/x-javascript", "text/plain", "application/octet-stream"].contains(response.mimeType?.lowercased() ?? "") else {
            completionHandler(.cancel); complete(.failure(DownloadSourceResolverError.failed)); return
        }
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        guard data.count <= maximumBytes - received.count else {
            lock.unlock(); complete(.failure(DownloadSourceResolverError.failed)); return
        }
        received.append(data)
        lock.unlock()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let data = received, alreadyFinished = finished
        lock.unlock()
        guard !alreadyFinished else { return }
        if error == nil, !data.isEmpty, let code = String(data: data, encoding: .utf8) { complete(.success(code)) }
        else { complete(.failure(DownloadSourceResolverError.failed)) }
    }
}
