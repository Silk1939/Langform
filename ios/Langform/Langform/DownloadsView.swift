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
    var offline = false
    var onOfflinePlayback: (() -> Void)?
    var onOfflinePlaybackEnded: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @State private var importing = false
    @State private var showingURL = false
    @State private var errorMessage: String?
    @State private var playback: OfflineDownload?

    private var readyItems: [OfflineDownload] { store.items.filter { store.fileURL(for: $0) != nil } }
    private var pendingItems: [OfflineDownload] { store.items.filter { $0.status != .ready } }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 12) {
                        Image(systemName: "play.rectangle.on.rectangle.fill")
                            .font(.title2).foregroundStyle(.tint)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(readyItems.isEmpty ? "Deine Offlinebibliothek" : "\(readyItems.count) \(readyItems.count == 1 ? "Video" : "Videos") für unterwegs")
                                .font(.headline)
                            Text(offline ? "Deine Mediathek funktioniert auch ohne Internet." : "Gespeicherte Videos brauchen kein Internet.")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 6)
                }
                Section {
                    if readyItems.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("Noch keine Videos gespeichert", systemImage: "tray")
                                .font(.headline)
                            Text("Importiere eine Videodatei aus der Dateien-App. Bereits auf deinem iPhone liegende Dateien kannst du auch offline hinzufügen.")
                                .font(.callout).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 8)
                        .accessibilityIdentifier("langform.library.empty")
                    }
                    ForEach(readyItems) { item in
                        readyRow(item)
                            .swipeActions { Button("Löschen", role: .destructive) { store.remove(item) } }
                    }
                } header: {
                    Text("Offline verfügbar")
                } footer: {
                    if !readyItems.isEmpty { Text("\(Self.bytes(store.usedBytes)) auf diesem iPhone · Zum Löschen nach links wischen.") }
                }
                Section {
                    Button { importing = true } label: { Label("Videodatei importieren", systemImage: "folder.badge.plus") }
                        .accessibilityIdentifier("langform.library.import")
                } footer: {
                    Text("Importierte und vollständig geladene Videos bleiben bis zum Löschen auf diesem Gerät. Dateien, die nur in iCloud liegen, benötigen zuerst eine Verbindung.")
                }
                if let message = store.libraryError { Section { Text(message).foregroundStyle(.red) } }
                if !pendingItems.isEmpty {
                    Section("Downloads und Importe") {
                        ForEach(pendingItems) { item in
                            downloadRow(item)
                                .swipeActions { Button("Löschen", role: .destructive) { store.remove(item) } }
                        }
                    }
                }
                if currentSource != nil || sourceMessage != nil {
                    Section("Aktuelles Video") {
                        if let source = currentSource {
                            Text(source.title).lineLimit(3)
                            Button {
                                do { _ = try store.start(source) }
                                catch { errorMessage = error.localizedDescription }
                            } label: { Label("Video herunterladen", systemImage: "arrow.down.circle") }
                                .disabled(offline)
                        } else if let sourceMessage {
                            Text(sourceMessage).font(.callout).foregroundStyle(.secondary)
                        }
                    }
                }
                Section {
                    Button { showingURL = true } label: { Label("Videodatei über Link laden", systemImage: "link") }
                        .disabled(offline)
                    Toggle("Mobile Daten für neue Downloads", isOn: $store.allowCellular)
                    Text(offline ? "Neue Downloads sind mit einer Internetverbindung möglich. Deine gespeicherten Videos und lokale Importe funktionieren weiterhin."
                         : store.allowCellular ? "Neue Downloads können mobile Daten verwenden. Der Datensparmodus wird berücksichtigt."
                         : "Neue Downloads warten auf WLAN. Bereits gestartete Downloads behalten ihre gewählte Einstellung.")
                        .font(.caption).foregroundStyle(.secondary)
                } header: {
                    Text("Neue Videos speichern")
                } footer: {
                    Text("Downloads benötigen eine vollständige Videodatei mit Bild und Ton. YouTube-Streams sind nicht immer als solche Datei verfügbar.")
                }
            }
            .accessibilityIdentifier("langform.library.screen")
            .navigationTitle("Mediathek")
            .toolbar { ToolbarItem(placement: .confirmationAction) {
                Button("Fertig") { dismiss() }.accessibilityIdentifier("langform.library.close")
            } }
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

    private func readyRow(_ item: OfflineDownload) -> some View {
        Button {
            guard store.fileURL(for: item) != nil else {
                errorMessage = "Die lokale Videodatei fehlt. Importiere sie erneut oder lade das Video erneut herunter."
                return
            }
            onOfflinePlayback?()
            playback = item
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "film")
                    .font(.title2).foregroundStyle(.secondary)
                    .frame(width: 36)
                VStack(alignment: .leading, spacing: 5) {
                    Text(item.title).font(.headline).foregroundStyle(.primary).lineLimit(3)
                    Label("\(Self.bytes(item.receivedBytes)) · Offline verfügbar", systemImage: "checkmark.circle.fill")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
                Image(systemName: "play.circle.fill").font(.title).foregroundStyle(.tint)
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(item.title), abspielen")
        .accessibilityHint("Spielt die gespeicherte Datei ohne Internet ab")
        .accessibilityIdentifier("langform.library.play.\(item.id.uuidString)")
    }

    @ViewBuilder private func downloadRow(_ item: OfflineDownload) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(item.title).font(.headline).lineLimit(3)
            switch item.status {
            case .ready:
                EmptyView()
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
                if item.source != nil && !offline {
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
    @State private var itemObservation: NSKeyValueObservation?
    @State private var timeObserver: Any?
    @State private var ready = false
    @State private var elapsed = 0.0
    @State private var playbackError: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ZStack {
                    VideoPlayer(player: player)
                        .accessibilityIdentifier("langform.offline.player")
                    if let playbackError {
                        VStack(spacing: 12) {
                            Image(systemName: "exclamationmark.triangle").font(.largeTitle)
                            Text("Video konnte nicht abgespielt werden").font(.headline)
                            Text(playbackError).font(.callout).foregroundStyle(.secondary)
                        }
                        .multilineTextAlignment(.center)
                        .padding(24)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(.systemBackground))
                    } else if !ready {
                        ProgressView("Lokales Video wird geöffnet …")
                            .padding(16).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
                HStack {
                    Label("Offline", systemImage: "wifi.slash")
                    Spacer()
                    Text(playbackError != nil ? "Wiedergabe fehlgeschlagen" : ready ? Self.timestamp(elapsed) : "Wird geladen …")
                        .monospacedDigit()
                        .accessibilityLabel("Offline-Wiedergabe")
                        .accessibilityValue(playbackError != nil ? "Wiedergabe fehlgeschlagen" : ready ? "Bereit, \(Int(elapsed)) Sekunden abgespielt" : "Wird geladen")
                        .accessibilityIdentifier("langform.offline.player.status")
                }
                .font(.caption).foregroundStyle(.white.opacity(0.75))
                .padding(.horizontal, 16).padding(.vertical, 10)
            }
                .background(.black)
                .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) {
                    Button("Fertig") { dismiss() }.accessibilityIdentifier("langform.offline.player.close")
                } }
                .onAppear(perform: startPlayback)
                .onDisappear(perform: stopPlayback)
                .onReceive(NotificationCenter.default.publisher(for: .AVPlayerItemFailedToPlayToEndTime)) { notification in
                    guard let item = notification.object as? AVPlayerItem, item === player?.currentItem else { return }
                    playbackError = (notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error)?.localizedDescription
                        ?? "Die gespeicherte Datei konnte nicht vollständig gelesen werden. Importiere sie erneut."
                }
        }
    }

    private func startPlayback() {
        guard player == nil else { return }
        ready = false
        elapsed = 0
        playbackError = nil
        let item = AVPlayerItem(url: url)
        let next = AVPlayer(playerItem: item)
        player = next
        itemObservation = item.observe(\.status, options: [.initial, .new]) { item, _ in
            DispatchQueue.main.async {
                guard player === next else { return }
                switch item.status {
                case .readyToPlay: ready = true
                case .failed:
                    playbackError = item.error?.localizedDescription ?? "Die gespeicherte Datei lässt sich nicht öffnen. Importiere sie erneut."
                default: break
                }
            }
        }
        timeObserver = next.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main) { time in
            guard player === next, time.seconds.isFinite else { return }
            elapsed = max(0, time.seconds)
        }
        next.play()
    }

    private func stopPlayback() {
        itemObservation?.invalidate()
        itemObservation = nil
        if let timeObserver { player?.removeTimeObserver(timeObserver) }
        timeObserver = nil
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        onPlaybackEnded?()
    }

    private static func timestamp(_ seconds: Double) -> String {
        let value = max(0, Int(seconds))
        return value >= 3600 ? String(format: "%d:%02d:%02d", value / 3600, value / 60 % 60, value % 60)
            : String(format: "%d:%02d", value / 60, value % 60)
    }
}
