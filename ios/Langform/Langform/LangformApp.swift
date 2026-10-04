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
    @State private var reloadToken = 0
    @State private var goBackToken = 0

    var body: some View {
        ZStack(alignment: .topLeading) {
            YouTubeWebView(
                unreachable: $unreachable,
                canGoBack: $canGoBack,
                reloadToken: reloadToken,
                goBackToken: goBackToken
            )
            .ignoresSafeArea()
            if canGoBack && !unreachable {
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
                .padding(.leading, 10)
                .padding(.top, 6)
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
