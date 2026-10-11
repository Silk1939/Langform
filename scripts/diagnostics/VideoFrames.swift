import Foundation
import AVFoundation
import AppKit
let source = URL(fileURLWithPath: CommandLine.arguments[1])
let asset = AVURLAsset(url: source)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero
generator.maximumSize = CGSize(width: 900, height: 1600)
for text in CommandLine.arguments.dropFirst(2) {
 let second = Double(text)!
 var actual = CMTime.zero
 let frame = try generator.copyCGImage(at: CMTime(seconds: second, preferredTimescale: 600), actualTime: &actual)
 let bitmap = NSBitmapImageRep(cgImage: frame)
 let path = source.deletingPathExtension().path + "-" + text + ".png"
 try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
 print(path, "actual", CMTimeGetSeconds(actual))
}
