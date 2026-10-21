import Foundation

/// One policy for URL entry, paste and Shortcuts. Never load an untrusted URL
/// directly into a signed-in WebView; rebuild only supported YouTube routes.
struct ExternalYouTubeLink: Equatable {
    enum Destination: Equatable { case video, feed }
    let url: URL
    let destination: Destination

    enum LinkError: LocalizedError {
        case invalid, unsupported, ambiguous
        var errorDescription: String? {
            switch self {
            case .invalid: return "Bitte füge einen gültigen YouTube-Link ein."
            case .unsupported: return "Dieser YouTube-Link führt zu keiner unterstützten Video-, Beitrags-, Kanal- oder Playlistseite."
            case .ambiguous: return "Die Nachricht enthält mehrere Links. Bitte kopiere nur den gewünschten YouTube-Link."
            }
        }
    }

    /// An explicit paste or copied-link shortcut can contain a WhatsApp message
    /// as well as a bare URL. Keep system URL callbacks on `parse`: extracting
    /// a link from a message is allowed only for these deliberate text inputs.
    static func parseSharedText(_ text: String) throws -> ExternalYouTubeLink {
        if let link = try? parse(text) { return link }
        let raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let messageControls = CharacterSet.controlCharacters.subtracting(.newlines)
            .subtracting(CharacterSet(charactersIn: "\t"))
        guard !raw.isEmpty, raw.utf8.count <= 8192,
              !raw.unicodeScalars.contains(where: messageControls.contains),
              let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            throw LinkError.invalid
        }
        let links = detector.matches(in: raw, range: NSRange(raw.startIndex..., in: raw))
        guard links.count <= 1 else { throw LinkError.ambiguous }
        guard let match = links.first, let range = Range(match.range, in: raw) else { throw LinkError.invalid }
        // NSDataDetector also recognizes bare domains and email addresses. Do
        // not repair those into a URL, or accept the detector's rewritten URL.
        let candidate = String(raw[range])
        guard ["https://", "http://"].contains(where: candidate.lowercased().hasPrefix) else { throw LinkError.invalid }
        return try parse(candidate)
    }

    static func parse(_ text: String) throws -> ExternalYouTubeLink {
        let raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, raw.utf8.count <= 8192,
              !raw.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              let incoming = URLComponents(string: raw) else { throw LinkError.invalid }
        if incoming.scheme?.lowercased() == "langform" {
            guard incoming.user == nil, incoming.password == nil, incoming.port == nil,
                  incoming.fragment == nil, incoming.path.isEmpty || incoming.path == "/" else { throw LinkError.invalid }
            let items = incoming.queryItems ?? []
            if incoming.host?.lowercased() == "share" {
                guard items.count == 1, items[0].name == "text", let value = items[0].value,
                      URLComponents(string: value)?.scheme?.lowercased() != "langform" else { throw LinkError.invalid }
                return try parseSharedText(value)
            }
            if incoming.host?.lowercased() == "open" {
                guard items.count == 1, items[0].name == "url", let value = items[0].value,
                      URLComponents(string: value)?.scheme?.lowercased() != "langform" else { throw LinkError.invalid }
                return try parse(value)
            }
            // Convenient when constructing a link without a nested URL.
            guard incoming.host?.lowercased() == "watch" else { throw LinkError.invalid }
            var watch = URLComponents()
            watch.scheme = "https"; watch.host = "m.youtube.com"; watch.path = "/watch"
            watch.queryItems = items
            guard let url = watch.url else { throw LinkError.invalid }
            return try parseYouTube(url)
        }
        guard let url = incoming.url else { throw LinkError.invalid }
        return try parseYouTube(url)
    }

    private static func parseYouTube(_ url: URL) throws -> ExternalYouTubeLink {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              ["https", "http"].contains(parts.scheme?.lowercased() ?? ""),
              parts.user == nil, parts.password == nil, parts.port == nil,
              let host = parts.host?.lowercased(),
              ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"].contains(host) else {
            throw LinkError.invalid
        }
        let items = parts.queryItems ?? []
        for key in ["v", "t", "start", "list", "index"] where items.filter({ $0.name == key }).count > 1 {
            throw LinkError.invalid
        }
        func item(_ name: String) -> String? { items.first(where: { $0.name == name })?.value }
        let segments = parts.path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        let shortHost = host == "youtu.be" || host == "www.youtu.be"
        let video: String?
        if shortHost { video = segments.count == 1 ? segments[0] : nil }
        else if parts.path == "/watch" || parts.path == "/watch/" { video = item("v") }
        else if segments.count == 2, ["live", "embed", "shorts"].contains(segments[0]) { video = segments[1] }
        else { video = nil }

        if let video {
            guard matches(video, "[A-Za-z0-9_-]{11}") else { throw LinkError.invalid }
            var query = [URLQueryItem(name: "v", value: video)]
            if let playlist = item("list") {
                guard validPlaylist(playlist) else { throw LinkError.invalid }
                query.append(URLQueryItem(name: "list", value: playlist))
                if let index = item("index") {
                    guard let number = Int(index), (1...100000).contains(number) else { throw LinkError.invalid }
                    query.append(URLQueryItem(name: "index", value: String(number)))
                }
            }
            let fragment = parts.fragment.flatMap { fragment -> String? in
                if fragment.hasPrefix("t=") { return String(fragment.dropFirst(2)) }
                if fragment.hasPrefix("start=") { return String(fragment.dropFirst(6)) }
                return nil
            }
            if let timestamp = item("t") ?? item("start") ?? fragment {
                guard let seconds = timestampSeconds(timestamp) else { throw LinkError.invalid }
                query.append(URLQueryItem(name: "t", value: String(seconds)))
            }
            return try build(path: "/watch", query: query, destination: .video)
        }
        guard !shortHost else { throw LinkError.invalid }
        if parts.path == "/playlist", let playlist = item("list"), validPlaylist(playlist) {
            return try build(path: "/playlist", query: [URLQueryItem(name: "list", value: playlist)], destination: .feed)
        }
        if ["", "/", "/feed/subscriptions", "/feed/library", "/feed/you"].contains(parts.path) {
            return try build(path: parts.path.isEmpty ? "/" : parts.path, destination: .feed)
        }
        if segments.count == 2, segments[0] == "post", matches(segments[1], "[A-Za-z0-9_-]{3,200}") {
            return try build(path: "/post/" + segments[1], destination: .feed)
        }
        // Shared links often include the creator's selected tab. Keep only
        // known browse tabs; account/actions and arbitrary extra paths stay out.
        let channelTabs = ["featured", "videos", "streams", "playlists", "community", "posts", "about"]
        if (1...2).contains(segments.count), segments[0].hasPrefix("@"),
           matches(String(segments[0].dropFirst()), "[\\p{L}\\p{N}_.-]{1,100}"),
           segments.count == 1 || channelTabs.contains(segments[1]) {
            return try build(path: "/" + segments.joined(separator: "/"), destination: .feed)
        }
        if (2...3).contains(segments.count), ["channel", "c", "user"].contains(segments[0]),
           matches(segments[1], "[\\p{L}\\p{N}_.-]{1,100}"),
           segments.count == 2 || channelTabs.contains(segments[2]) {
            return try build(path: "/" + segments.joined(separator: "/"), destination: .feed)
        }
        throw LinkError.unsupported
    }

    private static func build(path: String, query: [URLQueryItem] = [], destination: Destination) throws -> ExternalYouTubeLink {
        var output = URLComponents()
        output.scheme = "https"; output.host = "m.youtube.com"; output.path = path
        output.queryItems = query.isEmpty ? nil : query
        guard let url = output.url else { throw LinkError.invalid }
        return ExternalYouTubeLink(url: url, destination: destination)
    }

    private static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: "\\A(?:" + pattern + ")\\z", options: .regularExpression) != nil
    }
    private static func validPlaylist(_ value: String) -> Bool { matches(value, "[A-Za-z0-9_-]{2,160}") }
    private static func timestampSeconds(_ value: String) -> Int? {
        guard !value.isEmpty, value.count <= 24 else { return nil }
        if matches(value, "[0-9]+"), let number = Int(value), (0...604800).contains(number) { return number }
        guard matches(value, "(?:[0-9]+h)?(?:[0-9]+m)?(?:[0-9]+s)?"),
              value.last.map({ ["h", "m", "s"].contains(String($0)) }) == true else { return nil }
        var seconds = 0, digits = ""
        for character in value {
            if character.isNumber { digits.append(character); continue }
            guard let number = Int(digits) else { return nil }
            let multiplier = character == "h" ? 3600 : character == "m" ? 60 : 1
            guard number <= 604800 / multiplier else { return nil }
            seconds += number * multiplier; digits = ""
            guard seconds <= 604800 else { return nil }
        }
        return seconds
    }
}
