import Foundation
import MediaPlayer
import UIKit

/// The bridge's current identity and finite timeline; no playback assumptions.
struct SystemMediaSnapshot {
    let videoID: String
    let title: String
    let channel: String
    let elapsed: Double
    let duration: Double?
    let playing: Bool
    let rate: Double

    init?(_ values: [String: Any], expectedID: String) {
        guard values["kind"] as? String == "state", values["videoID"] as? String == expectedID,
              expectedID.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil,
              let title = values["title"] as? String, let channel = values["channel"] as? String,
              let elapsed = (values["elapsed"] as? NSNumber)?.doubleValue, elapsed.isFinite, elapsed >= 0,
              let playing = values["playing"] as? Bool,
              let rate = (values["rate"] as? NSNumber)?.doubleValue, rate.isFinite, rate > 0, rate <= 4 else { return nil }
        var duration: Double?
        if let number = values["duration"] as? NSNumber {
            guard number.doubleValue.isFinite, number.doubleValue > 0 else { return nil }
            duration = number.doubleValue
        } else if !(values["duration"] is NSNull) { return nil }
        self.videoID = expectedID
        self.title = String(title.prefix(180)).trimmingCharacters(in: .whitespacesAndNewlines)
        self.channel = String(channel.prefix(120)).trimmingCharacters(in: .whitespacesAndNewlines)
        self.duration = duration
        self.elapsed = duration.map { min(elapsed, $0) } ?? elapsed
        self.playing = playing
        self.rate = rate
    }

    static func commandJavaScript(videoID: String, command: String, value: Double? = nil) -> String? {
        guard videoID.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil,
              ["play", "pause", "toggle", "skip", "position"].contains(command),
              value?.isFinite != false,
              let data = try? JSONSerialization.data(withJSONObject: [videoID, command, value.map { $0 as Any } ?? NSNull()]),
              let arguments = String(data: data, encoding: .utf8) else { return nil }
        return "Boolean(window.__langformSystemCommand && window.__langformSystemCommand(...\(arguments)))"
    }
}

/// WebKit keeps its audio session. This only supplies system metadata/commands.
@MainActor
final class SystemMediaController {
    var onCommand: ((String, String, Double?) -> Void)?
    private var snapshot: SystemMediaSnapshot?
    private var artwork: MPMediaItemArtwork?
    private var artworkRequest: WatchThumbnailRequest?
    private var generation = 0
    private var targets: [(MPRemoteCommand, Any)] = []

    func receive(_ values: [String: Any], expectedID: String) {
        if values["kind"] as? String == "clear", values["videoID"] as? String == expectedID { clear(); return }
        guard let next = SystemMediaSnapshot(values, expectedID: expectedID) else { return }
        let changed = snapshot?.videoID != next.videoID
        snapshot = next
        if changed {
            generation += 1; artworkRequest?.cancel(); artworkRequest = nil; artwork = nil
            removeCommands()
        }
        if targets.isEmpty { installCommands() }
        publish()
        if changed { loadArtwork(videoID: next.videoID) }
    }

    func clear() {
        let id = snapshot?.videoID
        snapshot = nil
        generation += 1
        artworkRequest?.cancel(); artworkRequest = nil; artwork = nil
        let center = MPNowPlayingInfoCenter.default()
        if let id, center.nowPlayingInfo?[MPNowPlayingInfoPropertyExternalContentIdentifier] as? String == id {
            center.nowPlayingInfo = nil
        }
        removeCommands()
    }

    private func removeCommands() {
        for (command, target) in targets { command.removeTarget(target); command.isEnabled = false }
        if !targets.isEmpty { UIApplication.shared.endReceivingRemoteControlEvents() }
        targets.removeAll()
    }

    private func publish() {
        guard let snapshot else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: snapshot.title.isEmpty ? "Video" : snapshot.title,
            MPMediaItemPropertyArtist: snapshot.channel,
            MPNowPlayingInfoPropertyExternalContentIdentifier: snapshot.videoID,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: snapshot.elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: snapshot.playing ? snapshot.rate : 0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: snapshot.rate,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.video.rawValue,
            MPNowPlayingInfoPropertyIsLiveStream: snapshot.duration == nil,
        ]
        if let duration = snapshot.duration { info[MPMediaItemPropertyPlaybackDuration] = duration }
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        let center = MPRemoteCommandCenter.shared()
        center.skipBackwardCommand.isEnabled = snapshot.duration != nil
        center.skipForwardCommand.isEnabled = snapshot.duration != nil
        center.changePlaybackPositionCommand.isEnabled = snapshot.duration != nil
    }

    private func loadArtwork(videoID: String) {
        guard let asset = WatchThumbnailAsset(["videoID": videoID, "url": "https://i.ytimg.com/vi/\(videoID)/hqdefault.jpg"], videoID: videoID) else { return }
        let ticket = generation
        let request = WatchThumbnailRequest(asset: asset) { [weak self] image in
            guard let self, self.generation == ticket, self.snapshot?.videoID == videoID else { return }
            self.artworkRequest = nil
            guard let image else { return }
            self.artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            self.publish()
        }
        artworkRequest = request
        request.start()
    }

    private func installCommands() {
        let center = MPRemoteCommandCenter.shared()
        UIApplication.shared.beginReceivingRemoteControlEvents()
        center.skipBackwardCommand.preferredIntervals = [10]
        center.skipForwardCommand.preferredIntervals = [10]
        bind(center.playCommand, action: "play")
        bind(center.pauseCommand, action: "pause")
        bind(center.togglePlayPauseCommand, action: "toggle")
        bind(center.skipBackwardCommand, action: "skip", value: -10)
        bind(center.skipForwardCommand, action: "skip", value: 10)
        bind(center.changePlaybackPositionCommand, action: "position")
    }

    private func bind(_ command: MPRemoteCommand, action: String, value: Double? = nil) {
        command.isEnabled = true
        let lease = generation
        let target = command.addTarget { [weak self] event in
            let position = (event as? MPChangePlaybackPositionCommandEvent)?.positionTime ?? value
            // A removed handler can still be queued. It must never control the
            // next video; each installation belongs to one media generation.
            guard self != nil else { return .commandFailed }
            DispatchQueue.main.async { [weak self] in
                guard let self, self.generation == lease, let current = self.snapshot else { return }
                self.onCommand?(current.videoID, action, position)
            }
            return .success
        }
        targets.append((command, target))
    }
}
