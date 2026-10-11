import Foundation
import CoreGraphics

/// Untrusted CSS viewport coordinates become a bounded native thumbnail crop.
enum MotionGeometry {
    static func thumbnail(_ values: [String: Any]?, viewport: CGSize) -> CGRect? {
        guard let values, viewport.width > 0, viewport.height > 0 else { return nil }
        func number(_ key: String) -> CGFloat? {
            guard let value = values[key] as? NSNumber else { return nil }
            let result = CGFloat(truncating: value)
            return result.isFinite ? result : nil
        }
        guard let x = number("x"), let y = number("y"),
              let width = number("width"), let height = number("height"),
              let vw = number("viewportWidth"), let vh = number("viewportHeight"),
              vw > 40, vh > 40, width > 40, height > 24,
              width <= vw * 1.05, height <= vh,
              abs(viewport.width / vw - viewport.height / vh) < 0.12 else { return nil }
        let scale = viewport.width / vw
        let crop = CGRect(x: x * scale, y: y * scale, width: width * scale, height: height * scale)
            .intersection(CGRect(origin: .zero, size: viewport))
        guard !crop.isNull, crop.width > 40, crop.height > 24,
              crop.width * crop.height >= width * height * scale * scale * 0.65 else { return nil }
        return crop
    }
}
