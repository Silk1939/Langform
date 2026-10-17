import Foundation

enum LangformSearchFilter: String, CaseIterable {
    case all, videos, channels, unwatched
    var title: String {
        switch self { case .all: return "Alle"; case .videos: return "Videos"; case .channels: return "Kanäle"; case .unwatched: return "Ungesehen" }
    }
}

/// Typed routing shared by the native entry and the result chips. Queries never
/// become JavaScript, HTML, a host name, or a navigation to an account endpoint.
enum LangformSearchPolicy {
    static func query(_ value: String) -> String {
        String(value.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
    }

    static func resultsURL(query value: String, filter: LangformSearchFilter) -> URL? {
        let value = query(value)
        guard !value.isEmpty else { return nil }
        var parts = URLComponents(string: "https://m.youtube.com/results")!
        var items = [URLQueryItem(name: "search_query", value: value)]
        // Mweb's own search endpoints use percent-escaped protobuf params as
        // query values (the resulting URL therefore contains %253D).
        switch filter {
        case .all: break
        case .videos, .unwatched: items.append(URLQueryItem(name: "sp", value: "EgIQAQ%3D%3D"))
        case .channels: items.append(URLQueryItem(name: "sp", value: "EgIQAg%3D%3D"))
        }
        if filter == .unwatched { items.append(URLQueryItem(name: "lf_unwatched", value: "1")) }
        parts.queryItems = items
        return parts.url
    }

    static func filter(from url: URL?) -> LangformSearchFilter {
        let items = url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems } ?? []
        if items.contains(where: { $0.name == "lf_unwatched" && $0.value == "1" }) { return .unwatched }
        let params = items.first(where: { $0.name == "sp" })?.value?.removingPercentEncoding
        switch params { case "EgIQAg==": return .channels; case "EgIQAQ==": return .videos; default: return .all }
    }

    static func suggestionURL(query value: String) -> URL? {
        let value = query(value)
        guard value.count >= 2 else { return nil }
        var parts = URLComponents(string: "https://suggestqueries.google.com/complete/search")!
        parts.queryItems = [URLQueryItem(name: "client", value: "firefox"), URLQueryItem(name: "ds", value: "yt"),
                            URLQueryItem(name: "hl", value: "de"), URLQueryItem(name: "q", value: value)]
        return parts.url
    }

    static func suggestions(from data: Data, expectedQuery: String) -> [String] {
        guard data.count <= 65_536, let array = try? JSONSerialization.jsonObject(with: data) as? [Any],
              let echoed = array.first as? String, query(echoed).caseInsensitiveCompare(query(expectedQuery)) == .orderedSame,
              array.count >= 2, let values = array[1] as? [Any] else { return [] }
        var seen = Set<String>()
        return values.prefix(24).compactMap { value in
            guard let text = value as? String else { return nil }
            let clean = query(text)
            guard !clean.isEmpty, clean.count <= 160, !clean.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
                  seen.insert(clean.lowercased()).inserted else { return nil }
            return clean
        }.prefix(8).map { $0 }
    }
}
