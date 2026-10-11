import SwiftUI

@main
struct LangformApp: App {
    @UIApplicationDelegateAdaptor(LangformDownloadAppDelegate.self) private var downloadDelegate
    init() { StartupDiagnostics.begin(); _ = DownloadStore.shared }
    var body: some Scene {
        WindowGroup {
            LangformRoot()
        }
    }
}

/// The feed, the player view, the card and their chevrons live in `PlayerStage`,
/// because the swipe moves them frame by frame.
struct LangformRoot: View {
    @State private var unreachable = false
    @State private var reloadToken = 0
    @State private var fullscreen = false
    @State private var downloadRequestToken = 0
    @State private var downloads: DownloadPresentation?

    private struct DownloadPresentation: Identifiable {
        let id = UUID()
        let source: DownloadSource?
        let message: String?
        let offlinePlayback: (Bool) -> Void
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            YouTubeWebView(unreachable: $unreachable, reloadToken: reloadToken,
                           onFullscreen: { fullscreen = $0 }, downloadRequestToken: downloadRequestToken,
                           onDownloads: { source, message, ownership in
                               DownloadDeviceProbe.accept(source: source, message: message)
                               downloads = DownloadPresentation(source: source, message: message, offlinePlayback: ownership)
                           })
                .ignoresSafeArea(.container, edges: .all)
            if unreachable {
                VStack(spacing: 16) {
                    Text("YouTube ist gerade nicht erreichbar.")
                        .font(.body)
                        .multilineTextAlignment(.center)
                    Button("Nochmal laden") {
                        unreachable = false
                        reloadToken += 1
                    }
                    .buttonStyle(.borderedProminent)
                    Button { downloadRequestToken += 1 } label: { Label("Downloads öffnen", systemImage: "arrow.down.circle") }
                        .buttonStyle(.bordered)
                }
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(.systemBackground))
            }
        }
        .statusBarHidden(fullscreen)
        .sheet(item: $downloads) { presentation in
            DownloadsView(currentSource: presentation.source, sourceMessage: presentation.message,
                          onOfflinePlayback: { presentation.offlinePlayback(true) },
                          onOfflinePlaybackEnded: { presentation.offlinePlayback(false) })
        }
    }
}
