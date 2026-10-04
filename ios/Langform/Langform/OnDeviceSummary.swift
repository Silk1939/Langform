import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

enum OnDeviceSummary {
    static let unavailableMessage = "Die Kurzfassung geht nur mit dem Modell auf dem Gerät, und das ist gerade nicht verfügbar."

    static func reply(for captions: String) async -> [String: Any] {
        let source = prepare(captions)
        guard !source.isEmpty else { return ["message": unavailableMessage] }
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) {
            return await generate(source)
        }
        #endif
        return ["message": unavailableMessage]
    }

    /// Head, middle, and ending, short enough for the on-device context.
    static func prepare(_ text: String) -> String {
        let cleaned = text
            .replacingOccurrences(of: "\\[[^\\]]*\\]", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.count <= 6000 { return cleaned }
        let head = String(cleaned.prefix(2200))
        let tail = String(cleaned.suffix(2200))
        let midStart = cleaned.index(cleaned.startIndex, offsetBy: max(0, cleaned.count / 2 - 800))
        let midEnd = cleaned.index(midStart, offsetBy: min(1600, cleaned.distance(from: midStart, to: cleaned.endIndex)))
        let mid = String(cleaned[midStart..<midEnd])
        return head + "\n…\n" + mid + "\n…\n" + tail
    }

    #if canImport(FoundationModels)
    @available(iOS 26.0, macOS 26.0, *)
    private static func generate(_ source: String) async -> [String: Any] {
        let model = SystemLanguageModel.default
        guard case .available = model.availability else {
            return ["message": unavailableMessage]
        }
        let session = LanguageModelSession(instructions: """
        Du schreibst eine kurze deutsche Kurzfassung eines YouTube-Videos.
        Die Quelle sind Untertitel. Formuliere neu, auf Deutsch.
        Worum es geht: zwei oder drei Sätze.
        Punkte: ein paar echte Inhalte, keine Zitate.
        Schluss: ein oder zwei Sätze, wie das Video ausgeht.
        Keine wörtlichen Untertitel, keine Regieanweisungen, kein [musik], keine Füllwörter wie Bro.
        """)
        do {
            let response = try await session.respond(to: "Untertitel:\n\(source)", generating: KurzfassungDraft.self)
            let draft = response.content
            let about = draft.about.trimmingCharacters(in: .whitespacesAndNewlines)
            let ending = draft.ending.trimmingCharacters(in: .whitespacesAndNewlines)
            let points = draft.points.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            if about.isEmpty && ending.isEmpty && points.isEmpty {
                return ["message": unavailableMessage]
            }
            return ["summary": ["about": about, "points": points, "ending": ending]]
        } catch {
            return ["message": unavailableMessage]
        }
    }

    @available(iOS 26.0, macOS 26.0, *)
    @Generable
    struct KurzfassungDraft {
        @Guide(description: "Zwei oder drei deutsche Sätze, worum es geht. Keine Zitate.")
        var about: String

        @Guide(description: "Drei bis fünf kurze deutsche Punkte zum Inhalt. Keine Zitate, kein [musik].")
        var points: [String]

        @Guide(description: "Ein oder zwei deutsche Sätze, wie das Video ausgeht. Keine Zitate.")
        var ending: String
    }
    #endif
}
