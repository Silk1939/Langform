import SwiftUI
import AVKit
import UniformTypeIdentifiers

/// Always reachable from native chrome, including when YouTube is unreachable.
/// `currentSource` is inspected on demand by the active watch view; it is not a
/// promise that every YouTube video exposes a downloadable file.
struct DownloadsView: View {
    @ObservedObject var store: DownloadStore = .shared
    var currentSource: DownloadSource?
    var sourceMessage: String?
    var onOfflinePlayback: (() -> Void)?
    var onOfflinePlaybackEnded: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @State private var importing = false
    @State private var showingURL = false
    @State private var errorMessage: String?
    @State private var playback: OfflineDownload?

    var body: some View {
        NavigationStack {
            List {
                Section("Aktuelles Video") {
                    if let source = currentSource {
                        Text(source.title).lineLimit(3)
                        Button {
                            do { _ = try store.start(source) }
                            catch { errorMessage = error.localizedDescription }
                        } label: { Label("Video herunterladen", systemImage: "arrow.down.circle") }
                    } else {
                        Text(sourceMessage ?? "Öffne ein Video, um seine Downloadquelle zu prüfen.")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                }
                Section {
                    Toggle("Mobile Daten für neue Downloads", isOn: $store.allowCellular)
                    Text(store.allowCellular ? "Neue Downloads können mobile Daten verwenden. Der Datensparmodus wird berücksichtigt." : "Neue Downloads warten auf WLAN. Bereits gestartete Downloads behalten ihre gewählte Einstellung.")
                        .font(.caption).foregroundStyle(.secondary)
                    LabeledContent("Gespeichert", value: Self.bytes(store.usedBytes))
                    if store.activeCount > 0 { Text("\(store.activeCount) Download(s) aktiv").font(.caption).foregroundStyle(.secondary) }
                }
                Section("Offlinebibliothek") {
                    if store.items.isEmpty {
                        Text("Deine gespeicherten Videos erscheinen hier und lassen sich auch ohne Internet abspielen.")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                    ForEach(store.items) { item in
                        downloadRow(item)
                            .swipeActions { Button("Löschen", role: .destructive) { store.remove(item) } }
                    }
                }
                Section {
                    Button { importing = true } label: { Label("Videodatei importieren", systemImage: "folder.badge.plus") }
                    Button { showingURL = true } label: { Label("Videodatei über Link laden", systemImage: "link") }
                } footer: {
                    Text("Downloads benötigen eine vollständige Videodatei mit Bild und Ton. YouTube-Streams sind nicht immer als solche Datei verfügbar. Importierte oder vollständig geladene Videos bleiben bis zum Löschen auf diesem Gerät.")
                }
                if let message = store.libraryError { Section { Text(message).foregroundStyle(.red) } }
            }
            .navigationTitle("Downloads")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } } }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.mpeg4Movie, .quickTimeMovie], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls): urls.forEach { store.importFile($0) }
            case .failure(let error): errorMessage = error.localizedDescription
            }
        }
        .sheet(isPresented: $showingURL) { DirectVideoDownloadView(store: store) }
        .sheet(item: $playback) { item in
            if let url = store.fileURL(for: item) { OfflineVideoPlayer(url: url, title: item.title, onPlaybackEnded: onOfflinePlaybackEnded) }
            else { Color.clear.onAppear { onOfflinePlaybackEnded?(); playback = nil } }
        }
        .alert("Download", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK") { errorMessage = nil }
        } message: { Text(errorMessage ?? "") }
    }

    @ViewBuilder private func downloadRow(_ item: OfflineDownload) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(item.title).font(.headline).lineLimit(3)
            switch item.status {
            case .ready:
                HStack {
                    Text(Self.bytes(item.receivedBytes)).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button {
                        guard store.fileURL(for: item) != nil else {
                            errorMessage = "Die lokale Videodatei fehlt. Lade das Video erneut herunter."
                            return
                        }
                        onOfflinePlayback?(); playback = item
                    } label: { Label("Abspielen", systemImage: "play.fill") }
                        .buttonStyle(.borderless)
                }
            case .downloading:
                if let progress = item.progress { ProgressView(value: progress) } else { ProgressView() }
                HStack {
                    Text(item.expectedBytes > 0 ? "\(Self.bytes(item.receivedBytes)) von \(Self.bytes(item.expectedBytes))" : Self.bytes(item.receivedBytes))
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Abbrechen") { store.cancel(item) }.buttonStyle(.borderless)
                }
            case .validating:
                HStack { ProgressView(); Text("Videodatei wird geprüft …").font(.caption).foregroundStyle(.secondary) }
                Button("Abbrechen") { store.cancel(item) }.buttonStyle(.borderless)
            case .failed, .cancelled:
                Text(item.errorMessage ?? "Download abgebrochen.").font(.caption).foregroundStyle(.secondary)
                if item.source != nil {
                    Button("Erneut versuchen") {
                        do { try store.retry(item) } catch { errorMessage = error.localizedDescription }
                    }.buttonStyle(.borderless)
                }
            }
        }
        .padding(.vertical, 4)
    }

    static func bytes(_ bytes: Int64) -> String { ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file) }
}

private struct DirectVideoDownloadView: View {
    @ObservedObject var store: DownloadStore
    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @State private var title = ""
    @State private var errorMessage: String?
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("HTTPS-Link zur Videodatei", text: $link).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    TextField("Titel (optional)", text: $title)
                } footer: { Text("Direkte MP4-, M4V- oder MOV-Dateien mit Bild und Ton. Links zu Videoseiten oder Streaminglisten werden nicht als Offlinevideo gespeichert.") }
                if let message = errorMessage { Text(message).foregroundStyle(.red) }
                Button("Herunterladen") {
                    do {
                        guard let url = URL(string: link.trimmingCharacters(in: .whitespacesAndNewlines)) else { throw DownloadSourceError.unsupported("Der Videolink ist ungültig.") }
                        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
                        _ = try store.start(DownloadSource(url: url, title: String((name.isEmpty ? url.deletingPathExtension().lastPathComponent : name).prefix(300)),
                                                         videoID: nil, pageURL: nil, mimeType: "", expectedBytes: 0, origin: .directFile))
                        dismiss()
                    } catch { errorMessage = error.localizedDescription }
                }.disabled(link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .navigationTitle("Videolink")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } } }
        }
    }
}

private struct OfflineVideoPlayer: View {
    let url: URL
    let title: String
    var onPlaybackEnded: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?
    var body: some View {
        NavigationStack {
            VideoPlayer(player: player).background(.black)
                .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Fertig") { dismiss() } } }
                .onAppear { player = AVPlayer(url: url); player?.play() }
                .onDisappear { player?.pause(); player?.replaceCurrentItem(with: nil); player = nil; onPlaybackEnded?() }
        }
    }
}
