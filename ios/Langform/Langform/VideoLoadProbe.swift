import Foundation

/// Opt-in diagnostic requests only. The Stage owns scheduling and routes these
/// URLs through its ordinary openWatch. A separate, exact opt-in permits one
/// existing native Start action; it is explicit playback, never autoplay proof.
struct VideoLoadProbe {
    struct Request: Equatable {
        let number: Int
        let url: URL
    }

    enum State: Equatable {
        case waitingForFeed, waitingForVideo, finished, cancelled
    }

    static let timeoutSeconds: TimeInterval = 30
    private(set) var state: State = .waitingForFeed
    private(set) var pending: Request?
    let requestsNativeStart: Bool
    /// Separate single-video audio QA uses the ordinary user-open intent. All
    /// other diagnostic plans remain silent, including multi-video runs.
    let requestsAudibleUserOpen: Bool
    var audibleVideoID: String? { requestsAudibleUserOpen ? videoIDs.first : nil }
    private let videoIDs: [String]
    private var nextIndex = 0
    private var nativeStartRequest: Int?

    init?(environment: [String: String] = ProcessInfo.processInfo.environment) {
        guard environment["LANGFORM_DIAGNOSTICS"] == "1",
              let raw = environment["LANGFORM_VIDEO_PROBE"],
              let data = raw.data(using: .utf8),
              let ids = (try? JSONSerialization.jsonObject(with: data)) as? [String],
              (1...2).contains(ids.count),
              ids.allSatisfy({ id in
                  id.utf8.count == 11 && id.utf8.allSatisfy { byte in
                      (65...90).contains(byte) || (97...122).contains(byte) ||
                      (48...57).contains(byte) || byte == 95 || byte == 45
                  }
              }) else { return nil }
        videoIDs = ids
        requestsNativeStart = environment["LANGFORM_VIDEO_PROBE_PLAY"] == "1"
        requestsAudibleUserOpen = requestsNativeStart && ids.count == 1 &&
            environment["LANGFORM_VIDEO_PROBE_AUDIO"] == "1"
    }

    func mayRequestNativeStart(videoID: String, requestNumber: Int) -> Bool {
        requestsNativeStart && state == .waitingForVideo && pending?.number == requestNumber &&
            nativeStartRequest != requestNumber && videoID == videoIDs[nextIndex - 1]
    }

    /// Claim before invoking Start. Rejection, stalled media or later pause can
    /// never turn an observation into a playback retry for this request.
    mutating func claimNativeStart(videoID: String, requestNumber: Int) -> Bool {
        guard mayRequestNativeStart(videoID: videoID, requestNumber: requestNumber) else { return false }
        nativeStartRequest = requestNumber
        return true
    }

    mutating func start(feedReady: Bool) -> Request? {
        guard feedReady, state == .waitingForFeed else { return nil }
        return next()
    }

    /// Call only for a playing report bound to this request's native load ticket.
    /// A matching page alone or an old ready/playing report must not advance it.
    mutating func reportedPlaying(videoID: String, mediaReady: Bool, requestNumber: Int) -> Request? {
        guard state == .waitingForVideo, pending?.number == requestNumber,
              mediaReady, videoID == videoIDs[nextIndex - 1] else { return nil }
        return next()
    }

    /// The Stage schedules one timeoutSeconds deadline with the request number.
    /// Keeping the number in that closure prevents an old timer skipping a video.
    mutating func timedOut(requestNumber: Int) -> Request? {
        guard state == .waitingForVideo, pending?.number == requestNumber else { return nil }
        return next()
    }

    /// Manual interaction or app inactivity permanently stops this launch's plan.
    mutating func cancel() {
        guard state != .finished, state != .cancelled else { return }
        pending = nil
        state = .cancelled
    }

    private mutating func next() -> Request? {
        guard nextIndex < videoIDs.count else {
            pending = nil
            state = .finished
            return nil
        }
        let url = URL(string: "https://m.youtube.com/watch?v=" + videoIDs[nextIndex])!
        nextIndex += 1
        let request = Request(number: nextIndex, url: url)
        pending = request
        state = .waitingForVideo
        return request
    }
}


/// Read-only, bounded background evidence. This never owns audio or playback.
/// A separate exact opt-in is required in addition to the existing audible QA.
struct BackgroundPlaybackProbe {
    static let maximumSamples = 20
    let videoID: String
    private(set) var samples = 0
    private var capturedReady = false

    init?(environment: [String: String] = ProcessInfo.processInfo.environment) {
        guard environment["LANGFORM_BACKGROUND_AUDIO_PROBE"] == "1",
              VideoLoadProbe(environment: environment)?.requestsAudibleUserOpen == true,
              let raw = environment["LANGFORM_VIDEO_PROBE"], let data = raw.data(using: .utf8),
              let ids = (try? JSONSerialization.jsonObject(with: data)) as? [String], ids.count == 1 else { return nil }
        videoID = ids[0]
    }

    mutating func claim(phase: String, videoID: String) -> Int? {
        guard videoID == self.videoID, samples < Self.maximumSamples,
              ["watch-ready", "will-resign-active", "did-enter-background", "background+2s", "background+6s", "did-become-active"].contains(phase),
              phase != "watch-ready" || !capturedReady else { return nil }
        if phase == "watch-ready" { capturedReady = true }
        samples += 1
        return samples
    }

    func snapshotJavaScript() -> String {
        let literal = String(data: try! JSONSerialization.data(withJSONObject: [videoID]), encoding: .utf8)!
        return "(" + Self.snapshotFunction + ")(..." + literal + ")"
    }

    // Raw source strings are used only in this diagnostic document's identity
    // record. They are never returned, posted, persisted or fetched.
    static let snapshotFunction = #"""
function (expectedID) {
  var win=window,doc=win.document,root=doc.getElementById('movie_player'),video=root && root.querySelector('video'),info;
  function pageID(){try{var u=new URL(win.location.href);return u.protocol==='https:' && /^(m\.|www\.)?youtube\.com$/.test(u.hostname) && u.pathname==='/watch' ? u.searchParams.get('v') || '' : '';}catch(_){return '';}}
  function known(value,values){return values.indexOf(value)>=0 ? value : 'unknown';}
  try{info=root && root.getVideoData && root.getVideoData();}catch(_){return {ownerMatches:false};}
  var isAd=!!(root && (root.classList.contains('ad-showing') || root.classList.contains('ad-interrupting') || info && info.isAd));
  if(pageID()!==expectedID || !root || !video || !root.isConnected || !video.isConnected || !info || info.video_id!==expectedID)return {ownerMatches:false,isAd:isAd};
  var source=String(video.currentSrc || video.src || ''),attribute=video.getAttribute('src');
  var state=win.__langformBackgroundPlaybackProbeState;
  if(!state || state.id!==expectedID)state=win.__langformBackgroundPlaybackProbeState={id:expectedID,nextMedia:0,nextSource:0,record:null};
  var old=state.record,changed=!old || old.root!==root || old.video!==video;
  var record={root:root,video:video,source:source,attribute:attribute,
    mediaToken:changed ? ++state.nextMedia : old.mediaToken,
    sourceToken:changed || old.source!==source || old.attribute!==attribute ? ++state.nextSource : old.sourceToken};
  state.record=record;
  var audio=win.navigator.audioSession,session=win.navigator.mediaSession;
  var visibilityReader=win.__langformRealVisibility,actualHidden=visibilityReader && typeof visibilityReader.hidden==='function' ? visibilityReader.hidden() : !!doc.hidden;
  var actualVisibility=visibilityReader && typeof visibilityReader.visibilityState==='function' ? visibilityReader.visibilityState() : doc.visibilityState;
  var result={ownerMatches:!isAd,isAd:isAd,hidden:!!actualHidden,exposedHidden:!!doc.hidden,nativeInactive:!!(visibilityReader && typeof visibilityReader.nativeInactive==='function' && visibilityReader.nativeInactive()),paused:!!video.paused,ended:!!video.ended,seeking:!!video.seeking,muted:!!video.muted,error:!!video.error,
    readyState:Number(video.readyState),time:Number(video.currentTime),duration:Number(video.duration),rate:Number(video.playbackRate),volume:Number(video.volume),
    mediaToken:record.mediaToken,sourceToken:record.sourceToken,hasSource:!!source,sourceKind:!source?'none':source.indexOf('blob:')===0?'blob':source.indexOf('https:')===0?'https':source.indexOf('http:')===0?'http':'other',
    visibility:known(actualVisibility,['hidden','visible','prerender']),exposedVisibility:known(doc.visibilityState,['hidden','visible','prerender']),presentation:known(video.webkitPresentationMode,['inline','fullscreen','picture-in-picture']),
    supportsPiP:!!(typeof video.webkitSupportsPresentationMode==='function' && video.webkitSupportsPresentationMode('picture-in-picture')),
    audioSessionType:known(audio && audio.type,['auto','playback','ambient','transient','transient-solo','play-and-record']),audioSessionState:known(audio && audio.state,['inactive','active','interrupted']),
    mediaSessionState:known(session && session.playbackState,['none','paused','playing'])};
  var current;try{current=root.getVideoData && root.getVideoData();}catch(_){current=null;}
  result.ownerMatches=result.ownerMatches && pageID()===expectedID && root===doc.getElementById('movie_player') && video===root.querySelector('video') && root.isConnected && video.isConnected &&
    current && current.video_id===expectedID && !current.isAd && !root.classList.contains('ad-showing') && !root.classList.contains('ad-interrupting') &&
    String(video.currentSrc || video.src || '')===source && video.getAttribute('src')===attribute;
  result.ownerMatches=!!result.ownerMatches;
  return result;
}

"""#

    static func sanitized(_ values: [String: Any]) -> [String: Any] {
        var clean: [String: Any] = [:]
        for key in ["ownerMatches", "isAd", "hidden", "exposedHidden", "nativeInactive", "paused", "ended", "seeking", "muted", "error", "hasSource", "supportsPiP"] {
            if let value = values[key] as? Bool { clean[key] = value }
        }
        for key in ["time", "duration", "rate", "volume", "readyState", "mediaToken", "sourceToken"] {
            if let value = values[key] as? NSNumber, value.doubleValue.isFinite,
               value.doubleValue >= 0, value.doubleValue <= 10_000_000 { clean[key] = value }
        }
        let allowed = [
            "sourceKind": ["none", "blob", "https", "http", "other"],
            "visibility": ["hidden", "visible", "prerender", "unknown"],
            "exposedVisibility": ["hidden", "visible", "prerender", "unknown"],
            "presentation": ["inline", "fullscreen", "picture-in-picture", "unknown"],
            "audioSessionType": ["auto", "playback", "ambient", "transient", "transient-solo", "play-and-record", "unknown"],
            "audioSessionState": ["inactive", "active", "interrupted", "unknown"],
            "mediaSessionState": ["none", "paused", "playing", "unknown"],
        ]
        for (key, choices) in allowed {
            if let value = values[key] as? String, choices.contains(value) { clean[key] = value }
        }
        return clean
    }
}

/// Finite opt-in observations only. Claim before reading the native session;
/// notifications share the same launch budget as throttled page-state rows.
struct AudioRouteProbe {
    static let maximumSamples = 48
    private(set) var samples = 0
    private var lastPlayerState: Double?

    init?(environment: [String: String] = ProcessInfo.processInfo.environment) {
        guard environment["LANGFORM_DIAGNOSTICS"] == "1",
              environment["LANGFORM_AUDIO_ROUTE_PROBE"] == "1" else { return nil }
    }

    mutating func claim(kind: String, uptime: Double) -> Int? {
        guard ["player-state", "route-change", "interruption"].contains(kind),
              uptime.isFinite, uptime >= 0, samples < Self.maximumSamples else { return nil }
        if kind == "player-state" {
            if let lastPlayerState, uptime - lastPlayerState < 1 { return nil }
            lastPlayerState = uptime
        }
        samples += 1
        return samples
    }

    static func outputTypes(_ raw: [String]) -> [String] {
        let known = ["BluetoothA2DPOutput": "a2dp", "BluetoothHFP": "hfp", "BluetoothLE": "le",
                     "Speaker": "speaker", "Receiver": "receiver", "Headphones": "headphones",
                     "AirPlay": "airplay", "USBAudio": "usb"]
        return raw.prefix(8).map { known[$0] ?? "unknown" }
    }

    static func routeReason(_ raw: UInt?) -> String {
        let known: [UInt: String] = [0: "unknown", 1: "newDeviceAvailable", 2: "oldDeviceUnavailable",
                                    3: "categoryChange", 4: "override", 6: "wakeFromSleep",
                                    7: "noSuitableRouteForCategory", 8: "routeConfigurationChange"]
        return raw.flatMap { known[$0] } ?? "unknown"
    }

    /// Native strings also cross a whitelist; no port names, UIDs, URLs or
    /// arbitrary page fields can enter this diagnostic record.
    static func sanitized(_ row: [String: Any]) -> [String: Any] {
        var clean: [String: Any] = [:]
        let strings = [
            "kind": ["player-state", "route-change", "interruption"],
            "routeReason": ["unknown", "newDeviceAvailable", "oldDeviceUnavailable", "categoryChange", "override", "wakeFromSleep", "noSuitableRouteForCategory", "routeConfigurationChange"],
            "interruptionType": ["began", "ended", "unknown"],
            "interruptionReason": ["default", "builtInMicMuted", "routeDisconnected", "unknown"],
            "category": ["AVAudioSessionCategoryAmbient", "AVAudioSessionCategorySoloAmbient", "AVAudioSessionCategoryPlayback", "AVAudioSessionCategoryRecord", "AVAudioSessionCategoryPlayAndRecord", "AVAudioSessionCategoryMultiRoute", "unknown"],
            "mode": ["AVAudioSessionModeDefault", "AVAudioSessionModeVoiceChat", "AVAudioSessionModeGameChat", "AVAudioSessionModeVideoRecording", "AVAudioSessionModeMeasurement", "AVAudioSessionModeMoviePlayback", "AVAudioSessionModeVideoChat", "AVAudioSessionModeSpokenAudio", "AVAudioSessionModeVoicePrompt", "unknown"],
        ]
        for (key, choices) in strings {
            if let value = row[key] as? String { clean[key] = choices.contains(value) ? value : "unknown" }
        }
        for key in ["callbackUptime", "snapshotUptime"] {
            if let value = row[key] as? Double, value.isFinite, value >= 0 { clean[key] = value }
        }
        for key in ["sample", "ticket", "applicationState"] {
            if let value = row[key] as? Int, value >= 0,
               key != "sample" || (1...maximumSamples).contains(value),
               key != "applicationState" || (0...2).contains(value) { clean[key] = value }
        }
        if let value = row["systemOutputVolume"] as? Double, value.isFinite, (0...1).contains(value) { clean["systemOutputVolume"] = value }
        for key in ["shouldResume", "preparationSuspended", "offlinePlayback", "categoryHandoffPending"] {
            if let value = row[key] as? Bool { clean[key] = value }
        }
        let ports = ["a2dp", "hfp", "le", "speaker", "receiver", "headphones", "airplay", "usb", "unknown"]
        for key in ["outputTypes", "previousOutputTypes"] {
            if let values = row[key] as? [String] { clean[key] = values.prefix(8).map { ports.contains($0) ? $0 : "unknown" } }
        }
        return clean
    }
}
