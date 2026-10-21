import SwiftUI

@main
struct LangformApp: App {
    @UIApplicationDelegateAdaptor(LangformDownloadAppDelegate.self) private var downloadDelegate
    init() { StartupDiagnostics.begin(); _ = DownloadStore.shared }
    var body: some Scene {
        WindowGroup {
            if GemmaDiagnosticRequest.isRequested() {
                GemmaDiagnosticView()
            } else {
                LangformRoot()
            }
        }
    }
}

/// Reachable only through the explicit developer launch request above. No
/// remote feed competes for memory while the local engine is measured.
private struct GemmaDiagnosticView: View {
    @State private var screenLease: UUID?
    @State private var finished = false

    var body: some View {
        if finished {
            LangformRoot()
        } else {
            VStack(spacing: 16) {
                ProgressView()
                Text("Lokaler Gemma-Test")
            }
            .onAppear {
                if screenLease == nil { screenLease = SummaryIdleTimer.begin() }
            }
            .onDisappear { releaseScreenLease() }
            .task {
                await GemmaDeviceProbe.runExplicitDiagnostic()
                releaseScreenLease()
                finished = true
            }
        }
    }

    private func releaseScreenLease() {
        if let screenLease { SummaryIdleTimer.end(screenLease) }
        screenLease = nil
    }
}

/// The feed, the player view, the card and their chevrons live in `PlayerStage`,
/// because the swipe moves them frame by frame.
struct LangformRoot: View {
    @StateObject private var externalLinks = ExternalLinkInbox.shared
    @StateObject private var connection = LibraryConnectivity()
    @ObservedObject private var library = DownloadStore.shared
    @State private var unreachable = false
    @State private var reloadToken = 0
    @State private var fullscreen = false
    @State private var downloadRequestToken = 0
    @State private var downloads: DownloadPresentation?
    @State private var hasOnlineStage = false
    @State private var offlinePlaybackActive = false
    @State private var offlinePlaybackControl: ((Bool) -> Void)?
    @State private var showsLinkEntry = false
    @State private var showsModelSetup = false
    @State private var linkError: String?

    private struct DownloadPresentation: Identifiable {
        let id = UUID()
        let source: DownloadSource?
        let message: String?
        let offlinePlayback: (Bool) -> Void
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Color.black.ignoresSafeArea()
                // A cold offline launch needs neither a YouTube document nor a
                // source resolver. Retain an existing stage on later path loss
                // so a brief disconnection does not destroy the user's player.
                if hasOnlineStage || connection.online == true {
                    YouTubeWebView(unreachable: $unreachable, reloadToken: reloadToken,
                                   onFullscreen: { fullscreen = $0 }, downloadRequestToken: downloadRequestToken,
                                   offlinePlaybackActive: offlinePlaybackActive,
                                   externalLinkRequest: externalLinks.request,
                                   onOpenLink: { showsLinkEntry = true },
                                   onSummarySetup: { showsModelSetup = true },
                                   onOfflinePlaybackControl: { control in
                                       offlinePlaybackControl = control
                                       control(offlinePlaybackActive)
                                   },
                                   onDownloads: { source, message, ownership in
                                       DownloadDeviceProbe.accept(source: source, message: message)
                                       guard downloads == nil else { return }
                                       downloads = DownloadPresentation(source: source, message: message, offlinePlayback: { active in
                                           offlinePlaybackActive = active
                                           ownership(active)
                                       })
                                   })
                        .ignoresSafeArea(.container, edges: fullscreen ? .all : [.top, .leading, .trailing])
                }
                if (!hasOnlineStage && connection.online != true) || unreachable {
                    offlineLanding
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            if !fullscreen {
                libraryEntry
            }
        }
        .background(Color(.systemBackground).ignoresSafeArea())
        .statusBarHidden(fullscreen)
        .onChange(of: connection.online) { _, online in
            if online == true {
                hasOnlineStage = true
                if unreachable {
                    unreachable = false
                    reloadToken += 1
                }
            }
        }
        .onOpenURL { url in
            do { try externalLinks.submit(url.absoluteString) }
            catch { linkError = error.localizedDescription }
        }
        .onChange(of: externalLinks.request?.id) { _, _ in
            downloads?.offlinePlayback(false)
            downloads = nil
            showsLinkEntry = false
            unreachable = false
        }
        .sheet(isPresented: $showsLinkEntry) {
            YouTubeLinkEntry { try externalLinks.submitSharedText($0) }
        }
        .sheet(isPresented: $showsModelSetup) {
            GemmaModelSetupView()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in
            Task { await GemmaSummary.cancelAndUnload() }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)) { _ in
            Task { await GemmaSummary.cancelAndUnload() }
        }
        .alert("Link konnte nicht geöffnet werden", isPresented: Binding(
            get: { linkError != nil }, set: { if !$0 { linkError = nil } })) {
                Button("OK", role: .cancel) { linkError = nil }
            } message: { Text(linkError ?? "") }
        .sheet(item: $downloads) { presentation in
            DownloadsView(currentSource: presentation.source, sourceMessage: presentation.message, offline: connection.online == false,
                          onOfflinePlayback: { presentation.offlinePlayback(true) },
                          onOfflinePlaybackEnded: { presentation.offlinePlayback(false) })
        }
    }

    private var readyCount: Int {
        library.items.filter { library.fileURL(for: $0) != nil }.count
    }

    private func openLibrary() {
        // The permanent entry always opens local state directly. Inspecting a
        // current online video remains a separate, explicitly chosen action.
        downloads = DownloadPresentation(source: nil, message: nil, offlinePlayback: { active in
            offlinePlaybackActive = active
            offlinePlaybackControl?(active)
        })
    }

    private var libraryEntry: some View {
        Button(action: openLibrary) {
            HStack(spacing: 10) {
                Image(systemName: "play.rectangle.on.rectangle")
                    .font(.system(size: 19, weight: .semibold))
                Text("Mediathek").font(.subheadline.weight(.semibold))
                Spacer()
                Text(readyCount > 0 ? "\(readyCount) offline" : connection.online == false ? "Offline" : "Auch offline")
                    .font(.caption).foregroundStyle(.secondary)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 20)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(.regularMaterial)
        .overlay(alignment: .top) { Divider() }
        .accessibilityLabel("Mediathek")
        .accessibilityValue(readyCount > 0 ? "\(readyCount) Videos offline verfügbar" : "Auch ohne Internet verfügbar")
        .accessibilityIdentifier("langform.library.open")
    }

    private var offlineLanding: some View {
        ScrollView {
            VStack(spacing: 24) {
                Image(systemName: connection.online == false ? "wifi.slash" : "play.rectangle.on.rectangle")
                    .font(.system(size: 44, weight: .light))
                    .foregroundStyle(.secondary)
                    .padding(.top, 36)
                VStack(spacing: 10) {
                    Text(connection.online == false ? "Langform ist auch offline da." : unreachable ? "YouTube ist gerade nicht erreichbar." : "Deine Videos. Auch offline.")
                        .font(.title2.weight(.bold))
                    Text(readyCount > 0
                         ? "\(readyCount) gespeicherte \(readyCount == 1 ? "Video wartet" : "Videos warten") in deiner Mediathek. Zum Abspielen brauchst du kein Internet."
                         : "Deine Mediathek öffnet sich ohne Internet. Importiere eine Videodatei vom iPhone oder speichere Videos, wenn du wieder online bist.")
                        .font(.body).foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)
                Button(action: openLibrary) {
                    Label("Mediathek öffnen", systemImage: "play.rectangle.on.rectangle")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("langform.offline.library")
                if connection.online != false {
                    Button(unreachable ? "YouTube erneut laden" : "Mit YouTube verbinden") {
                        unreachable = false
                        hasOnlineStage = true
                        reloadToken += 1
                    }
                    .buttonStyle(.bordered)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("langform.offline.retry")
                } else {
                    Text("Gespeicherte Videos bleiben hier. Neue Videos benötigen eine Internetverbindung.")
                        .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
            }
            .padding(28)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .accessibilityIdentifier("langform.offline.screen")
    }
}

/// A confirmed path observation controls the cold-start screen. The library is
/// usable immediately while the monitor is still establishing its first path.
private final class LibraryConnectivity: ObservableObject {
    @Published private(set) var online: Bool?
    private let monitor = NetworkQualityMonitor()

    init() {
        #if targetEnvironment(simulator)
        // Deterministic native dependency-path QA, independent of the Mac's
        // network. This is not evidence of a physical airplane-mode test.
        if ProcessInfo.processInfo.environment["LANGFORM_OFFLINE_LIBRARY_PROBE"] == "1" {
            online = false
            return
        }
        #endif
        monitor.onChange = { [weak self] policy in self?.online = policy.online }
        monitor.start()
    }
}
