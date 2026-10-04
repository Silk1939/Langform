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
        Du schreibst auf Deutsch drei bis sechs Merksätze zu einem YouTube-Video.
        Die Quelle sind Untertitel. Formuliere neu. Jeder Satz ist ein Punkt, den eine Person behalten kann.
        Bei einem Argument sind die Punkte die Behauptungen.
        Bei einer Anleitung sind die Punkte die Schritte, die zählen.
        Keine Handlung, keine wörtlichen Untertitel, keine Zitate.
        Keine Regieanweisungen, kein [musik], keine Füllwörter wie Bro.
        """)
        do {
            let response = try await session.respond(to: "Untertitel:\n\(source)", generating: KurzfassungDraft.self)
            let draft = response.content
            let points = Array(
                draft.points
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                    .prefix(6)
            )
            if points.count < 3 {
                return ["message": unavailableMessage]
            }
            return ["summary": ["points": points]]
        } catch {
            return ["message": unavailableMessage]
        }
    }

    @available(iOS 26.0, macOS 26.0, *)
    @Generable
    struct KurzfassungDraft {
        @Guide(description: "Drei bis sechs deutsche Merksätze. Bei einem Argument die Behauptungen, bei einer Anleitung die Schritte, die zählen. Keine Handlung, keine Zitate, kein [musik].")
        var points: [String]
    }
    #endif
}
