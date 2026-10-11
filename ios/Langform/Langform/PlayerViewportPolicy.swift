import Foundation
import CoreGraphics

/// Geometry rules used when UIKit and WebKit change viewport at different times.
enum PlayerViewportPolicy {
    struct SurfaceGeometry {
        let frame: CGRect
        let scale: CGFloat
        let origin: CGPoint
    }

    /// Difference between a grabbed presentation pose and the regular drag
    /// geometry. It fades to zero at the next resting endpoint, while keeping
    /// the first finger frame at exactly the geometry already on screen.
    struct SurfaceCorrection {
        let frameOrigin: CGPoint
        let frameSize: CGSize
        let scale: CGFloat
        let origin: CGPoint
        let progress: CGFloat

        init?(shown: SurfaceGeometry, regular: SurfaceGeometry, progress: CGFloat) {
            let values = [shown.frame.minX, shown.frame.minY, shown.frame.width, shown.frame.height,
                          shown.scale, shown.origin.x, shown.origin.y,
                          regular.frame.minX, regular.frame.minY, regular.frame.width, regular.frame.height,
                          regular.scale, regular.origin.x, regular.origin.y, progress]
            guard values.allSatisfy({ $0.isFinite }), shown.frame.width > 0, shown.frame.height > 0,
                  shown.scale > 0, progress >= 0, progress <= 1 else { return nil }
            frameOrigin = CGPoint(x: shown.frame.minX - regular.frame.minX, y: shown.frame.minY - regular.frame.minY)
            frameSize = CGSize(width: shown.frame.width - regular.frame.width, height: shown.frame.height - regular.frame.height)
            scale = shown.scale - regular.scale
            origin = CGPoint(x: shown.origin.x - regular.origin.x, y: shown.origin.y - regular.origin.y)
            self.progress = progress
        }

        func weight(at value: CGFloat) -> CGFloat {
            let value = min(1, max(0, value))
            if progress == 0 { return 1 - value }
            if progress == 1 { return value }
            return value <= progress ? value / progress : (1 - value) / (1 - progress)
        }
    }

    /// The video alone travels into the mini player. The WebView retains its
    /// original viewport behind this crop, so comments never scale into it.
    static func surfaceGeometry(viewport: CGRect, picture: CGRect, mini: CGRect,
                                progress: CGFloat, videoOnly: Bool,
                                correction: SurfaceCorrection? = nil) -> SurfaceGeometry {
        func mix(_ a: CGRect, _ b: CGRect) -> CGRect {
            CGRect(x: a.minX + (b.minX - a.minX) * progress,
                   y: a.minY + (b.minY - a.minY) * progress,
                   width: a.width + (b.width - a.width) * progress,
                   height: a.height + (b.height - a.height) * progress)
        }
        let frame = mix(videoOnly ? picture : viewport, mini)
        let image = mix(picture, mini)
        let scale = picture.width > 0 ? image.width / picture.width : 1
        let origin = CGPoint(x: image.minX - scale * picture.minX - frame.minX,
                             y: image.minY - scale * picture.minY - frame.minY)
        guard let correction else { return SurfaceGeometry(frame: frame, scale: scale, origin: origin) }
        let weight = correction.weight(at: progress)
        return SurfaceGeometry(
            frame: CGRect(x: frame.minX + correction.frameOrigin.x * weight,
                          y: frame.minY + correction.frameOrigin.y * weight,
                          width: frame.width + correction.frameSize.width * weight,
                          height: frame.height + correction.frameSize.height * weight),
            scale: scale + correction.scale * weight,
            origin: CGPoint(x: origin.x + correction.origin.x * weight,
                            y: origin.y + correction.origin.y * weight))
    }

    static func restingProgress(position: PlayerGesturePolicy.Position?) -> CGFloat {
        // Mode describes the resting destination, even halfway through a drag
        // or spring. Rotation preserves it instead of committing a new gesture.
        position == .mini ? 1 : 0
    }

    static func matches(reported: CGSize, current: CGSize) -> Bool {
        guard reported.width.isFinite, reported.height.isFinite,
              current.width.isFinite, current.height.isFinite,
              reported.width > 0, reported.height > 0,
              current.width > 0, current.height > 0 else { return false }
        // Mobile YouTube's device-width viewport uses one CSS pixel per point.
        // Allow rounding, but reject a queued rect from the other orientation.
        return abs(reported.width - current.width) <= 2 && abs(reported.height - current.height) <= 2
    }

    static func canFinishFullscreenExit(in viewport: CGSize, portrait: Bool,
                                        allowsCurrentOrientation: Bool, rotating: Bool) -> Bool {
        guard !rotating, matches(reported: viewport, current: viewport) else { return false }
        // A rejected platform orientation request may keep landscape. It still
        // needs one confirmed viewport, rather than waiting forever for portrait.
        return allowsCurrentOrientation || (portrait && viewport.height >= viewport.width)
    }

    static func fallbackPicture(in viewport: CGSize) -> CGRect {
        guard viewport.width.isFinite, viewport.height.isFinite,
              viewport.width > 0, viewport.height > 0 else { return .zero }
        let width = min(viewport.width, viewport.height * 16 / 9)
        return CGRect(x: (viewport.width - width) / 2, y: 0, width: width, height: width * 9 / 16)
    }
}
