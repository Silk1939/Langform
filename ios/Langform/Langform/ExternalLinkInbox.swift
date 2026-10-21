import SwiftUI
import AppIntents
import UIKit

/// Keeps a cold-launch intent until SwiftUI has created the stage. Each
/// submission has an identity, so repeated view updates never replay a link.
@MainActor
final class ExternalLinkInbox: ObservableObject {
    static let shared = ExternalLinkInbox()
    struct Request: Identifiable {
        let id = UUID()
        let link: ExternalYouTubeLink
    }
    @Published private(set) var request: Request?

    func submit(_ text: String) throws { request = Request(link: try ExternalYouTubeLink.parse(text)) }
    func submitSharedText(_ text: String) throws { request = Request(link: try ExternalYouTubeLink.parseSharedText(text)) }
}

struct OpenYouTubeLinkIntent: AppIntent {
    static var title: LocalizedStringResource = "YouTube-Link in Langform öffnen"
    static var description = IntentDescription("Öffnet einen geteilten YouTube-Link direkt im Langform-Player.")
    static var openAppWhenRun: Bool = true
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground }

    @Parameter(title: "YouTube-Link", description: "Der YouTube-Link aus dem Teilen-Menü oder der Zwischenablage.")
    var url: URL

    static var parameterSummary: some ParameterSummary { Summary("\(\.$url) in Langform öffnen") }

    @MainActor
    func perform() async throws -> some IntentResult {
        try ExternalLinkInbox.shared.submit(url.absoluteString)
        return .result()
    }
}

/// This shortcut is available after installation without building a personal
/// workflow. Clipboard access happens only when the named action is run.
struct OpenCopiedYouTubeLinkIntent: AppIntent {
    static var title: LocalizedStringResource = "Kopierten YouTube-Link öffnen"
    static var description = IntentDescription("Öffnet den von dir kopierten YouTube-Link in Langform.")
    static var openAppWhenRun: Bool = true
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .foreground }

    @MainActor
    func perform() async throws -> some IntentResult {
        let copied = UIPasteboard.general.string ?? UIPasteboard.general.url?.absoluteString ?? ""
        try ExternalLinkInbox.shared.submitSharedText(copied)
        return .result()
    }
}

struct LangformLinkShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenCopiedYouTubeLinkIntent(),
            phrases: ["Kopierten YouTube-Link in \(.applicationName) öffnen", "Kopierten Link mit \(.applicationName) öffnen"],
            shortTitle: "Kopierten Link öffnen",
            systemImageName: "link"
        )
    }
}

struct YouTubeLinkEntry: View {
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var error: String?
    @FocusState private var focused: Bool
    let open: (String) throws -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://youtu.be/…", text: $text, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .focused($focused)
                        .accessibilityLabel("YouTube-Link")
                        .accessibilityIdentifier("langform-external-link-field")
                        .onSubmit(openLink)
                    PasteButton(payloadType: String.self) { values in
                        if let value = values.first { text = value; openLink() }
                    }
                    .labelStyle(.titleAndIcon)
                    .accessibilityLabel("Link einfügen und öffnen")
                    .accessibilityHint("Öffnet einen einzelnen YouTube-Link auch aus einer kopierten Nachricht.")
                    .accessibilityIdentifier("langform-paste-open-external-link")
                    if let error { Text(error).foregroundStyle(.red).font(.callout) }
                    Button("In Langform öffnen", action: openLink)
                        .accessibilityIdentifier("langform-open-external-link")
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } footer: {
                    Text("Videos öffnen im Player. Kanäle und Playlists öffnen im Feed und schließen dabei das laufende Video.")
                }
                Section {
                    Text("Kopiere den YouTube-Link. Starte danach „Kopierten Link öffnen“ bei den Langform-Kurzbefehlen oder über die iPhone-Suche. Dafür musst du keinen eigenen Kurzbefehl bauen.")
                        .font(.callout)
                    ShortcutsLink()
                        .accessibilityLabel("Kurzbefehle öffnen")
                        .accessibilityIdentifier("langform-open-shortcuts")
                } header: {
                    Text("Kopieren → Langform")
                }
                Section {
                    Text("Lege einmal in Kurzbefehle einen Kurzbefehl mit der Aktion „YouTube-Link in Langform öffnen“ an. Wähle „Kurzbefehleingabe“ als YouTube-Link und aktiviere „Im Share-Sheet anzeigen“ für URLs. Danach: YouTube-Link teilen → deinen Kurzbefehl wählen.")
                        .font(.callout)
                } header: {
                    Text("Direkt aus WhatsApp & anderen Apps")
                } footer: {
                    Text("iOS bestimmt, welche App einen normalen YouTube-Link beim Antippen öffnet. Der Teilen-Kurzbefehl übergibt ihn gezielt an Langform.")
                }
            }
            .navigationTitle("YouTube-Link öffnen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Fertig") { dismiss() } } }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func openLink() {
        do { try open(text); dismiss() }
        catch { self.error = error.localizedDescription }
    }
}
