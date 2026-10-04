import Foundation
import SafariServices

#if canImport(FoundationModels)
import FoundationModels
#endif

/// Native side of the Safari extension “Shorts ausblenden”.
/// The page script sends caption text; this handler asks the on-device model.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        if !Thread.isMainThread {
            DispatchQueue.main.sync {
                self.beginRequest(with: context)
            }
            return
        }
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any]
        let text = message?["text"] as? String ?? ""
        let box = SummaryBox()
        // Bleib in beginRequest. Task.detached kehrt vorher zurück, und Safari
        // beendet die Anfrage, bevor completeRequest läuft. Keine Semaphore:
        // der Run Loop muss wach bleiben, sonst antwortet das Modell nicht.
        let task = Task { @MainActor in
            box.value = await SafariOnDeviceSummary.reply(for: text)
            box.done = true
        }
        while !box.done {
            RunLoop.main.run(mode: .common, before: Date(timeIntervalSinceNow: 0.05))
        }
        withExtendedLifetime(task) {}
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: box.value]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}

private final class SummaryBox: @unchecked Sendable {
    var value: [String: Any] = ["message": SafariOnDeviceSummary.unavailableMessage]
    var done = false
}

enum SafariOnDeviceSummary {
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

    private static func prepare(_ text: String) -> String {
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
