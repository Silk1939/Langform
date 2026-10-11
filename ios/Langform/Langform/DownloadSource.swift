import Foundation

/// A resolved, combined video file. Never represents an HLS/DASH manifest or a
/// WebKit blob. The original signed URL stays private in Application Support.
struct DownloadSource: Codable, Equatable {
    enum Origin: String, Codable { case activeWatch, directFile }
    var url: URL
    var title: String
    var videoID: String?
    var pageURL: URL?
    var mimeType: String
    var expectedBytes: Int64
    var origin: Origin
    var userAgent: String? = nil
    var expectedDuration: Double? = nil
}

enum DownloadSourceError: LocalizedError {
    case unsupported(String), expired, tooLarge, insufficientSpace, invalidFile, partialResponse, network(Int)
    var errorDescription: String? {
        switch self {
        case .unsupported(let reason): return reason
        case .expired: return "Der Videolink ist abgelaufen. Öffne das Video erneut und versuche den Download noch einmal."
        case .tooLarge: return "Diese Datei ist größer als das Downloadlimit von 2 GB."
        case .insufficientSpace: return "Für diesen Download ist zu wenig Speicher frei. Lösche zuerst einen Download oder andere Dateien."
        case .invalidFile: return "Die Datei enthält kein vollständig abspielbares Video mit Ton."
        case .partialResponse: return "Die Quelle hat nur einen Teil des Videos geliefert. Es wurde kein Offlinevideo gespeichert."
        case .network(let code): return code == 401 || code == 403 ? "Die Videoquelle erlaubt den Download gerade nicht. Öffne das Video erneut und versuche es noch einmal." : "Der Download ist fehlgeschlagen (HTTP \(code))."
        }
    }
}

enum DownloadSourcePolicy {
    static let maximumBytes: Int64 = 2_147_483_648
    static let spaceReserve: Int64 = 100 * 1_024 * 1_024

    static func validate(_ source: DownloadSource, now: Date = Date(), checkExpiry: Bool = true) throws {
        guard let components = URLComponents(url: source.url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "https", let host = components.host?.lowercased(), !host.isEmpty,
              components.user == nil, components.password == nil else {
            throw DownloadSourceError.unsupported("Es wird eine direkte HTTPS-Videodatei benötigt.")
        }
        let items = components.queryItems ?? []
        guard !items.contains(where: { ["range", "sq"].contains($0.name.lowercased()) }),
              !["m3u8", "mpd"].contains(source.url.pathExtension.lowercased()),
              !source.url.path.contains("/manifest/") else {
            throw DownloadSourceError.unsupported("Diese Quelle ist ein Stream oder ein Videosegment und kann hier nicht als vollständige Datei gespeichert werden.")
        }
        guard source.expectedBytes >= 0, source.expectedBytes <= maximumBytes else { throw DownloadSourceError.tooLarge }
        if let userAgent = source.userAgent {
            guard !userAgent.isEmpty, userAgent.utf8.count <= 512,
                  !userAgent.unicodeScalars.contains(where: { $0.value < 32 || $0.value > 126 }) else {
                throw DownloadSourceError.unsupported("Der Downloadkontext ist ungültig. Öffne das Video erneut.")
            }
        }
        if let duration = source.expectedDuration {
            guard duration.isFinite, duration > 0 else { throw DownloadSourceError.invalidFile }
        }
        if checkExpiry, let value = items.first(where: { $0.name == "expire" })?.value {
            guard let expiry = Double(value), expiry.isFinite, expiry > now.timeIntervalSince1970 + 60 else { throw DownloadSourceError.expired }
        }
        if source.origin == .activeWatch {
            guard host == "googlevideo.com" || host.hasSuffix(".googlevideo.com"),
                  let videoID = source.videoID, videoID.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil,
                  source.mimeType.lowercased().hasPrefix("video/mp4"), source.mimeType.lowercased().contains("mp4a."),
                  ["avc1.", "avc3.", "hev1.", "hvc1.", "av01."].contains(where: { source.mimeType.lowercased().contains($0) }) else {
                throw DownloadSourceError.unsupported("Für dieses Video wurde keine vollständige MP4-Datei mit Bild und Ton gefunden.")
            }
            guard let pageURL = source.pageURL, let page = URLComponents(url: pageURL, resolvingAgainstBaseURL: false),
                  page.scheme == "https", ["youtube.com", "www.youtube.com", "m.youtube.com"].contains(page.host?.lowercased() ?? ""),
                  page.path == "/watch", page.queryItems?.first(where: { $0.name == "v" })?.value == videoID else {
                throw DownloadSourceError.unsupported("Die Downloadquelle gehört nicht zur aktuellen Videoseite.")
            }
        }
    }

    static func assessment(_ snapshot: [String: Any], expectedVideoID: String?) throws -> DownloadSource {
        guard let videoID = snapshot["videoID"] as? String, videoID == expectedVideoID else {
            throw DownloadSourceError.unsupported("Das aktuelle Video hat gewechselt. Öffne Downloads erneut.")
        }
        guard snapshot["reason"] as? String == "available", let source = snapshot["source"] as? [String: Any],
              let value = source["url"] as? String, let url = URL(string: value), let mime = source["mimeType"] as? String else {
            let message: String
            switch snapshot["reason"] as? String {
            case "expired": throw DownloadSourceError.expired
            case "live": message = "Livevideos können hier noch nicht offline gespeichert werden."
            case "protected": message = "Dieses Video ist geschützt und kann hier nicht heruntergeladen werden."
            case "stale-response", "unavailable": message = "Für das aktuelle Video ist noch keine passende Downloadquelle verfügbar. Lade die Videoseite neu und versuche es noch einmal."
            case "adaptive-only", "blob-only", "stream-only": message = "YouTube liefert dieses Video als Stream. Eine vollständige Videodatei mit Bild und Ton ist für Langform gerade nicht verfügbar."
            default: message = "Für dieses YouTube-Video ist gerade keine direkt verfügbare Downloadquelle vorhanden."
            }
            throw DownloadSourceError.unsupported(message)
        }
        guard source["requiresResolution"] as? Bool != true else {
            throw DownloadSourceError.unsupported("Die Videoquelle muss zuerst aufgelöst werden. Öffne Downloads erneut.")
        }
        let result = DownloadSource(url: url, title: String((snapshot["title"] as? String ?? "Video").prefix(300)),
                                    videoID: videoID, pageURL: (snapshot["pageURL"] as? String).flatMap(URL.init(string:)),
                                    mimeType: mime, expectedBytes: (source["expectedBytes"] as? NSNumber)?.int64Value ?? 0, origin: .activeWatch,
                                    userAgent: (snapshot["userAgent"] as? String).flatMap({ $0.isEmpty ? nil : $0 }),
                                    expectedDuration: (snapshot["expectedDuration"] as? NSNumber)?.doubleValue)
        try validate(result)
        return result
    }
}

struct OfflineDownload: Codable, Identifiable, Equatable {
    enum Status: String, Codable { case downloading, validating, ready, failed, cancelled }
    var id: UUID
    var title: String
    var source: DownloadSource?
    var createdAt: Date
    var status: Status
    var receivedBytes: Int64 = 0
    var expectedBytes: Int64 = 0
    var fileName: String?
    var errorMessage: String?
    var progress: Double? { expectedBytes > 0 ? min(1, max(0, Double(receivedBytes) / Double(expectedBytes))) : nil }
    var isActive: Bool { status == .downloading || status == .validating }
}
