import SwiftUI

@main
struct LangformApp: App {
    var body: some Scene {
        WindowGroup {
            LangformRoot()
        }
    }
}

struct LangformRoot: View {
    @State private var unreachable = false
    @State private var canGoBack = false
    @State private var watchPage = false
    @State private var reloadToken = 0
    @State private var goBackToken = 0

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Color.black.ignoresSafeArea()
            YouTubeWebView(
                unreachable: $unreachable,
                canGoBack: $canGoBack,
                watchPage: $watchPage,
                reloadToken: reloadToken,
                goBackToken: goBackToken
            )
            .overlay(alignment: .topLeading) {
                if watchPage && !unreachable {
                    Button {
                        goBackToken += 1
                    } label: {
                        Image(systemName: "chevron.backward")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(Color.white)
                            .frame(width: 44, height: 44)
                            .background(Color.black.opacity(0.55), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .padding(.leading, 10)
                    .padding(.top, 10)
                    .accessibilityLabel("Zurück")
                }
            }
            if canGoBack && !watchPage && !unreachable {
                Button {
                    goBackToken += 1
                } label: {
                    Image(systemName: "chevron.backward")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Color.white)
                        .frame(width: 36, height: 36)
                        .background(Color.black.opacity(0.55), in: Circle())
                }
                .buttonStyle(.plain)
                .padding(.leading, 12)
                .padding(.bottom, 68)
                .accessibilityLabel("Zurück")
            }
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
                }
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(.systemBackground))
            }
        }
    }
}
