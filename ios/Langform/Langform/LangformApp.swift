import AVKit
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
    @State private var miniPlayer = false
    @State private var videoCrop: CGRect = .zero
    @State private var reloadToken = 0
    @State private var goBackToken = 0
    @State private var enterMiniToken = 0
    @State private var leaveMiniToken = 0

    private var showMini: Bool { miniPlayer && watchPage && !unreachable }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Color.black.ignoresSafeArea()
            YouTubeWebView(
                unreachable: $unreachable,
                canGoBack: $canGoBack,
                watchPage: $watchPage,
                miniPlayer: $miniPlayer,
                videoCrop: $videoCrop,
                reloadToken: reloadToken,
                goBackToken: goBackToken,
                enterMiniToken: enterMiniToken,
                leaveMiniToken: leaveMiniToken
            )
            .modifier(MiniPlayerEffect(mini: showMini, crop: videoCrop, animated: watchPage))
            .allowsHitTesting(!showMini)
            .overlay(alignment: .topLeading) {
                if watchPage && !unreachable && !miniPlayer {
                    Button {
                        enterMiniToken += 1
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
            .overlay(alignment: .topTrailing) {
                if watchPage && !unreachable && !miniPlayer {
                    AirPlayRouteButton()
                        .frame(width: 44, height: 44)
                        .background(Color.black.opacity(0.55), in: Circle())
                        .padding(.trailing, 10)
                        .padding(.top, 58)
                        .accessibilityLabel("AirPlay")
                }
            }
            if showMini {
                MiniPlayerChrome(
                    crop: videoCrop,
                    onExpand: { miniPlayer = false },
                    onClose: { leaveMiniToken += 1 }
                )
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

struct MiniLayout {
    var scale: CGFloat
    var offset: CGSize
    var mask: CGRect
    var maskRadius: CGFloat
    var card: CGRect

    static func resolve(size: CGSize, crop: CGRect, mini: Bool) -> MiniLayout {
        let full = CGRect(origin: .zero, size: size)
        guard mini, size.width > 1, size.height > 1 else {
            return MiniLayout(scale: 1, offset: .zero, mask: full, maskRadius: 0, card: full)
        }
        let source: CGRect
        if crop.width > 8, crop.height > 8 {
            source = crop
        } else {
            let height = min(size.width * 9 / 16, size.height)
            source = CGRect(x: 0, y: 0, width: size.width, height: height)
        }
        let cardWidth = min(168, max(128, size.width * 0.44))
        let scale = cardWidth / max(source.width, 1)
        let cardHeight = source.height * scale
        let card = CGRect(
            x: size.width - cardWidth - 12,
            y: size.height - cardHeight - 76,
            width: cardWidth,
            height: cardHeight
        )
        let offset = CGSize(
            width: card.minX - source.minX * scale,
            height: card.minY - source.minY * scale
        )
        let radius = min(12, cardHeight / 5) / max(scale, 0.01)
        return MiniLayout(scale: scale, offset: offset, mask: source, maskRadius: radius, card: card)
    }
}

private struct MiniPlayerEffect: ViewModifier {
    var mini: Bool
    var crop: CGRect
    var animated: Bool

    func body(content: Content) -> some View {
        GeometryReader { geo in
            let layout = MiniLayout.resolve(size: geo.size, crop: crop, mini: mini)
            content
                .frame(width: geo.size.width, height: geo.size.height)
                .mask {
                    RoundedRectangle(cornerRadius: layout.maskRadius, style: .continuous)
                        .frame(width: layout.mask.width, height: layout.mask.height)
                        .position(x: layout.mask.midX, y: layout.mask.midY)
                }
                .scaleEffect(layout.scale, anchor: .topLeading)
                .offset(layout.offset)
        }
        .animation(animated ? .spring(response: 0.45, dampingFraction: 0.86) : nil, value: mini)
    }
}

private struct MiniPlayerChrome: View {
    var crop: CGRect
    var onExpand: () -> Void
    var onClose: () -> Void

    var body: some View {
        GeometryReader { geo in
            let card = MiniLayout.resolve(size: geo.size, crop: crop, mini: true).card
            Button(action: onExpand) {
                Color.clear
                    .frame(width: card.width, height: card.height)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .position(x: card.midX, y: card.midY)
            .accessibilityLabel("Vollbild")
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.white)
                    .frame(width: 32, height: 32)
                    .background(Color.black.opacity(0.72), in: Circle())
            }
            .buttonStyle(.plain)
            .position(x: card.maxX - 20, y: card.minY + 20)
            .accessibilityLabel("Schließen")
        }
    }
}

private struct AirPlayRouteButton: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let picker = AVRoutePickerView(frame: CGRect(x: 0, y: 0, width: 44, height: 44))
        picker.prioritizesVideoDevices = true
        picker.tintColor = .white
        picker.activeTintColor = .white
        picker.backgroundColor = .clear
        return picker
    }

    func updateUIView(_ picker: AVRoutePickerView, context: Context) {
        picker.prioritizesVideoDevices = true
        picker.tintColor = .white
        picker.activeTintColor = .white
    }
}
