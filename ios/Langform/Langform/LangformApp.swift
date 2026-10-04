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
    @State private var reloadToken = 0

    var body: some View {
        ZStack {
            YouTubeWebView(unreachable: $unreachable, reloadToken: reloadToken)
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
        .ignoresSafeArea()
    }
}
