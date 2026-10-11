import Foundation
import CryptoKit

/// Read-only SponsorBlock API. Queries use the documented k-anonymity endpoint,
/// an ephemeral session and fixed host; no YouTube cookies or account data.
final class SponsorBlockService {
    private var task: URLSessionDataTask?
    private var generation = 0
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 8
        session = URLSession(configuration: configuration)
    }

    static func hash(_ id: String) -> String? {
        guard id.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else { return nil }
        return SHA256.hash(data: Data(id.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func request(for id: String) -> URLRequest? {
        guard let hash = hash(id), var parts = URLComponents(string: "https://sponsor.ajay.app/api/skipSegments/\(hash.prefix(4))") else { return nil }
        parts.queryItems = [URLQueryItem(name: "categories", value: "[\"sponsor\"]"),
                            URLQueryItem(name: "actionTypes", value: "[\"skip\"]"),
                            URLQueryItem(name: "service", value: "YouTube")]
        guard let url = parts.url else { return nil }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    static func segments(from data: Data, videoID: String) -> [[String: Any]]? {
        guard data.count <= 1_048_576, hash(videoID) != nil,
              let candidates = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]], candidates.count <= 500 else { return nil }
        guard let owner = candidates.first(where: { $0["videoID"] as? String == videoID }) else { return [] }
        guard let items = owner["segments"] as? [[String: Any]], items.count <= 500 else { return nil }
        return items.filter { $0["category"] as? String == "sponsor" && $0["actionType"] as? String == "skip" }
    }

    func cancel() { generation += 1; task?.cancel(); task = nil }

    func fetch(videoID: String, completion: @escaping (String, [[String: Any]]) -> Void) {
        cancel()
        guard let request = Self.request(for: videoID) else { completion("unavailable", []); return }
        let owner = generation
        task = session.dataTask(with: request) { [weak self] data, response, error in
            var state = "unavailable", segments: [[String: Any]] = []
            if error == nil, let response = response as? HTTPURLResponse {
                if response.statusCode == 404 { state = "empty" }
                else if response.statusCode == 200, let data, let result = Self.segments(from: data, videoID: videoID) {
                    segments = result; state = result.isEmpty ? "empty" : "ok"
                }
            }
            DispatchQueue.main.async {
                guard let self, self.generation == owner else { return }
                self.task = nil; completion(state, segments)
            }
        }
        task?.resume()
    }

    deinit { task?.cancel(); session.invalidateAndCancel() }
}
