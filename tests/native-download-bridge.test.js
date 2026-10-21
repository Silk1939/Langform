const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function declaration(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  const open = source.indexOf('{', start);
  let end = open + 1, depth = 1;
  while (depth && end < source.length) { depth += (source[end] === '{') - (source[end] === '}'); end++; }
  return source.slice(start, end);
}
function messageBranch(source, name) {
  const marker = `case "${name}":`;
  const start = source.indexOf(marker) + marker.length;
  const end = source.indexOf('\n        case ', start);
  assert.ok(start >= marker.length && end > start, name);
  return source.slice(start, end);
}

test('Shipping Downloadbridge schützt späte Quellen und den Offlinebesitz der Systemmedien', { skip: process.platform !== 'darwin', timeout: 60000 }, t => {
  const native = path.join(__dirname, '../ios/Langform/Langform');
  const source = fs.readFileSync(path.join(native, 'YouTubeWebView.swift'), 'utf8');
  const snapshot = fs.readFileSync(path.join(native, 'SystemMedia.swift'), 'utf8').split('/// WebKit')[0].replace('import MediaPlayer', '').replace('import UIKit', '');
  const policy = fs.readFileSync(path.join(native, 'DownloadSource.swift'), 'utf8');
  const externalPolicy = fs.readFileSync(path.join(native, 'ExternalYouTubeLink.swift'), 'utf8');
  const acceptExternalLink = declaration(source, 'func acceptExternalLink(');
  const makeController = declaration(source, 'func makeUIViewController(');
  const updateController = declaration(source, 'func updateUIViewController(');
  const offlinePlayback = declaration(source, 'func setOfflinePlaybackActive(');
  const request = declaration(source, 'func requestDownloads(');
  const cancelDownload = declaration(source, 'private func cancelDownloadSourceRequest(').replace('private func', 'func');
  const loading = declaration(source, 'private func setDownloadSourceLoading(').replace('private func', 'func');
  const command = declaration(source, 'private func systemPlaybackCommand(').replace('private func', 'func');
  const handler = messageBranch(source, 'langformSystemMedia');
  const downloadHandler = messageBranch(source, 'langformDownloads');
  assert.ok(downloadHandler.includes('requestDownloads()'), 'extract the actual incoming download branch');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-download-bridge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'test.swift');
  fs.writeFileSync(file, `${policy}\n${externalPolicy}\n${snapshot}\n
class WebView {
  var url: URL? = URL(string:"https://m.youtube.com/watch?v=abcdefghijk")
  var replies: [(Any?, Error?) -> Void] = [], commands: [String] = [], pauses = 0, downloadLoading=false
  func evaluateJavaScript(_ script:String, completionHandler: ((Any?,Error?)->Void)? = nil) {
    commands.append(script)
    if script.contains("__langformSetDownloadLoading(true)") {downloadLoading=true}
    if script.contains("__langformSetDownloadLoading(false)") {downloadLoading=false}
    if let completionHandler { replies.append(completionHandler) }
  }
  func pauseAllMediaPlayback(completionHandler:(()->Void)?) { pauses += 1; completionHandler?() }
}
struct YouTubeWebView {
  struct Context {}
  var unreachable:Bool {get {false} nonmutating set {}}
  var reloadToken=0, downloadRequestToken=0
  var offlinePlaybackActive=false
  var externalLinkRequest:ExternalLinkInbox.Request?
  var onFullscreen:((Bool)->Void)?, onOpenLink:(()->Void)?, onSummarySetup:(()->Void)?
  var onDownloads:((DownloadSource?,String?,@escaping(Bool)->Void)->Void)?
  var onOfflinePlaybackControl:((@escaping(Bool)->Void)->Void)?
  static func videoID(_ url:URL?)->String? { guard let url else{return nil}; return URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems?.first{$0.name=="v"}?.value }
  ${makeController}
  ${updateController}
}
class PlayerStageController {let stage=Stage()}
class Media {
  var clears=0, received=0
  func clear(){clears += 1}
  func receive(_ body:[String:Any],expectedID:String){received += 1}
}
class DownloadSourceResolver {
  var hold=false, cancellations=0, resolutions=0
  var pending:[(Result<DownloadSource,Error>)->Void]=[]
  var onCancel:(()->Void)?
  func cancel(){cancellations += 1;let callback=onCancel;onCancel=nil;callback?()}
  func resolve(_ snapshot:[String:Any],expectedVideoID:String,completion:@escaping(Result<DownloadSource,Error>)->Void){
    resolutions += 1
    let result=Result {try DownloadSourcePolicy.assessment(snapshot,expectedVideoID:expectedVideoID)}
    if hold {pending.append(completion)} else {completion(result)}
  }
}
struct Origin { var protocolName="https", host="m.youtube.com"; var \`protocol\`:String {protocolName} }
struct Frame { var securityOrigin=Origin() }
struct Message { var webView:WebView?, frameInfo=Frame(), body:Any }
struct FeedState {var active=true}
struct ExternalLinkInbox {
  struct Request {let id=UUID();let link:ExternalYouTubeLink}
}
class Stage {
  enum Mode {case closed,loading,expanded,mini}
  var mode=Mode.expanded, loadTicket=1, loadingVideoID:String?
  var player:WebView! = WebView()
  var systemMedia=Media(), systemMediaSuspendedForOffline=false
  var downloadSourceResolver=DownloadSourceResolver(), downloadSourceRequestGeneration=0, downloadSourceLoading=false
  var sourceLoading:Bool {player?.downloadLoading == true}
  var customFullscreenID:String?, playerOverlayOpen=false
  var feed:WebView?=WebView(), acceptedExternalLinkID:UUID?, lastWatchURL:URL?
  var reloadToken=0, downloadRequestToken=0, starts=0, reloads=0
  var onUnreachable:((Bool)->Void)?, onFullscreen:((Bool)->Void)?
  var onOpenLink:(()->Void)?, onSummarySetup:(()->Void)?
  func start(){starts += 1}
  func reload(){reloads += 1}
  var reusedExternalWatch=false
  func cancelPendingFeedSearch(){}
  func discardFeedOpening(){}
  func closePlayer(){mode = .closed}
  func showInFeed(_ url:URL){}
  func openWatch(_ url:URL,userInitiated:Bool){
    // Preserve the ordinary same-video shortcut without changing the ticket or
    // player identity: stale-source safety must come from real link admission.
    reusedExternalWatch = mode != .closed && YouTubeWebView.videoID(player?.url)==YouTubeWebView.videoID(url)
    if reusedExternalWatch {return}
    loadTicket += 1;lastWatchURL=url
  }
  var backgroundTransitions:[String]=[]
  func watchBackgroundCategoryTransition(_ phase:String){backgroundTransitions.append(phase)}
  func feedState(for view:WebView)->FeedState? {nil}
  var onDownloads:((DownloadSource?,String?,@escaping(Bool)->Void)->Void)?
  ${request}
  ${offlinePlayback}
  ${cancelDownload}
  ${loading}
  ${command}
  ${acceptExternalLink}
  func receive(_ message:Message){${handler}}
  func receiveDownload(_ message:Message){${downloadHandler}}
}
func expect(_ value:Bool,_ message:String){if !value{print("FAILED: "+message);exit(1)}}
func available(_ id:String)->[String:Any]{
 ["videoID":id,"title":"Video","pageURL":"https://m.youtube.com/watch?v="+id,"reason":"available", "source":["url":"https://r.googlevideo.com/videoplayback?id=file","mimeType":"video/mp4; codecs=avc1.42001E, mp4a.40.2","expectedBytes":100]]
}
let stage=Stage(), a=stage.player!
var presentations=0, accepted:DownloadSource?, message:String?, ownership:((Bool)->Void)?
stage.onDownloads={source,error,callback in presentations += 1; accepted=source;message=error;ownership=callback}
stage.requestDownloads()
expect(presentations==0 && a.replies.count==1,"source assessment waits for JS")
a.replies.removeFirst()(available("abcdefghijk"),nil)
expect(accepted?.videoID=="abcdefghijk" && message==nil,"current source accepted")
stage.downloadSourceResolver.hold=true
stage.requestDownloads();a.replies.removeFirst()(available("abcdefghijk"),nil)
expect(stage.sourceLoading && stage.downloadSourceResolver.pending.count==1,"asynchronous resolution keeps loading visible")
stage.loadTicket += 1
stage.downloadSourceResolver.pending.removeFirst()(.success(accepted!))
expect(accepted==nil && !stage.sourceLoading && message?.contains("gewechselt")==true,"same-id navigation during resolution rejected")
stage.requestDownloads();a.replies.removeFirst()(available("abcdefghijk"),nil)
let firstResolution=stage.downloadSourceResolver.pending.removeFirst()
let validSource=try! DownloadSourcePolicy.assessment(available("abcdefghijk"),expectedVideoID:"abcdefghijk")
stage.requestDownloads();a.replies.removeFirst()(available("abcdefghijk"),nil)
let beforeLate=presentations
firstResolution(.success(validSource))
expect(presentations==beforeLate && stage.sourceLoading,"old resolution cannot replace a new request or hide its spinner")
stage.downloadSourceResolver.pending.removeFirst()(.success(validSource))
expect(accepted==validSource && !stage.sourceLoading,"latest resolution presents once")
stage.requestDownloads();a.replies.removeFirst()(available("abcdefghijk"),nil)
let cancelledResolution=stage.downloadSourceResolver.pending.removeFirst()
stage.cancelDownloadSourceRequest()
let beforeCancelled=presentations
cancelledResolution(.success(validSource))
expect(presentations==beforeCancelled && !stage.sourceLoading,"closing or opening another watch cancels preparation without stale presentation or a disabled button")
stage.downloadSourceResolver.hold=false
stage.requestDownloads();stage.loadTicket += 1
a.replies.removeFirst()(available("abcdefghijk"),nil)
expect(accepted==nil && message?.contains("gewechselt")==true,"same-id old ticket rejected")
stage.requestDownloads();a.url=URL(string:"https://m.youtube.com/watch?v=zzzzzzzzzzz")
a.replies.removeFirst()(available("abcdefghijk"),nil)
expect(accepted==nil,"new video cannot inherit old source")
stage.requestDownloads();a.replies.removeFirst()(available("abcdefghijk"),nil)
expect(accepted==nil,"wrong source ID rejected by native policy")
ownership?(true)
expect(stage.systemMediaSuspendedForOffline && stage.systemMedia.clears==1 && a.pauses==1,"offline playback pauses all WebKit media and removes remote owner")
expect(stage.feed?.pauses==1,"download ownership pauses feed media too")
expect(stage.backgroundTransitions.last=="cancel","offline ownership also retires the previous background lease")
stage.receive(Message(webView:a,body:["kind":"state","playing":true]))
expect(stage.systemMedia.received==0 && stage.systemMediaSuspendedForOffline,"late playing callback cannot steal offline system card")
let commandCount=a.commands.count
stage.systemPlaybackCommand(id:"zzzzzzzzzzz",action:"play")
expect(a.commands.count==commandCount,"queued remote event cannot restart web video while offline player owns it")
ownership?(false)
expect(!stage.systemMediaSuspendedForOffline && a.commands.last?.contains("PublishSystemMedia")==true,"offline dismissal refreshes actual paused metadata without resuming playback")
stage.receive(Message(webView:a,body:["kind":"state","playing":false]))
expect(stage.systemMedia.received==1,"online bridge restored")
stage.receive(Message(webView:WebView(),body:[:]))
expect(stage.systemMedia.received==1,"foreign webview rejected")
stage.mode = .closed;stage.requestDownloads()
expect(accepted==nil && message?.contains("Öffne ein Video")==true,"offline library opens without active watch")

let openMessage:[String:Any] = ["kind":"open","videoID":"abcdefghijk"]
for state in ["mini","loading","closed","overlay","fullscreen"] {
  let queued=Stage(), web=queued.player!
  // WatchTools marks its button busy before its asynchronous native message.
  web.downloadLoading=true
  if state=="mini" {queued.mode = .mini}
  if state=="loading" {queued.mode = .loading}
  if state=="closed" {queued.mode = .closed}
  if state=="overlay" {queued.playerOverlayOpen=true}
  if state=="fullscreen" {queued.customFullscreenID="abcdefghijk"}
  queued.receiveDownload(Message(webView:web,body:openMessage))
  expect(!web.downloadLoading && !queued.downloadSourceLoading && web.replies.isEmpty,"state-rejected queued click unlocks without opening: "+state)
  queued.mode = .expanded;queued.playerOverlayOpen=false;queued.customFullscreenID=nil
  queued.receiveDownload(Message(webView:web,body:openMessage))
  expect(web.downloadLoading && queued.downloadSourceLoading && web.replies.count==1,"returning expanded accepts a fresh request: "+state)
  web.replies.removeFirst()(available("abcdefghijk"),nil)
  expect(!web.downloadLoading && !queued.downloadSourceLoading,"accepted request releases native and button busy state: "+state)
}
for invalid in ["foreign","origin","protocol","kind","id","body","missingIDs"] {
  let queued=Stage(), web=queued.player!
  web.downloadLoading=true;queued.mode = .mini
  var entry=Message(webView:web,body:openMessage)
  if invalid=="foreign" {entry.webView=WebView()}
  if invalid=="origin" {entry.frameInfo.securityOrigin.host="example.com"}
  if invalid=="protocol" {entry.frameInfo.securityOrigin.protocolName="http"}
  if invalid=="kind" {entry.body=["kind":"other","videoID":"abcdefghijk"]}
  if invalid=="id" {entry.body=["kind":"open","videoID":"zzzzzzzzzzz"]}
  if invalid=="body" {entry.body="invalid"}
  if invalid=="missingIDs" {entry.body=["kind":"open"];web.url=nil}
  queued.receiveDownload(entry)
  expect(web.downloadLoading && web.commands.isEmpty && web.replies.isEmpty,"foreign or stale input cannot clear the current button: "+invalid)
}
for phase in ["javascript","resolver"] {
  let resolving=Stage(), web=resolving.player!
  resolving.downloadSourceResolver.hold=true
  resolving.requestDownloads()
  if phase=="resolver" {web.replies.removeFirst()(available("abcdefghijk"),nil)}
  let cancellations=resolving.downloadSourceResolver.cancellations
  resolving.mode = .mini
  resolving.receiveDownload(Message(webView:web,body:openMessage))
  expect(web.downloadLoading && resolving.downloadSourceLoading && resolving.downloadSourceResolver.cancellations==cancellations,"state rejection cannot hide or cancel active preparation: "+phase)
  if phase=="javascript" {web.replies.removeFirst()(available("abcdefghijk"),nil)}
  expect(resolving.downloadSourceResolver.pending.count==1,"only original resolution remains: "+phase)
  resolving.downloadSourceResolver.pending.removeFirst()(.success(validSource))
  expect(!web.downloadLoading && !resolving.downloadSourceLoading,"original resolution retains its ordinary completion: "+phase)
}
for mode in [Stage.Mode.expanded,.mini] {
  for phase in ["javascript","resolver","synchronous-cancel"] {
    let linking=Stage(), web=linking.player!
    linking.mode=mode;linking.downloadSourceResolver.hold=true
    var latePresentations=0
    linking.onDownloads={_,_,_ in latePresentations += 1}
    linking.requestDownloads()
    if phase != "javascript" {web.replies.removeFirst()(available("abcdefghijk"),nil)}
    var lateResolution:((Result<DownloadSource,Error>)->Void)?
    if phase != "javascript" {lateResolution=linking.downloadSourceResolver.pending.removeFirst()}
    if phase=="synchronous-cancel" {
      linking.downloadSourceResolver.onCancel={lateResolution?(.success(validSource))}
    }
    let ticket=linking.loadTicket
    let link=ExternalLinkInbox.Request(link:try! ExternalYouTubeLink.parse("https://youtu.be/abcdefghijk?t=42"))
    linking.acceptExternalLink(link)
    expect(linking.reusedExternalWatch && linking.loadTicket==ticket && linking.player === web,"same-video link preserves player and load ticket: "+phase)
    if phase=="javascript" {
      web.replies.removeFirst()(available("abcdefghijk"),nil)
      while !linking.downloadSourceResolver.pending.isEmpty {
        linking.downloadSourceResolver.pending.removeFirst()(.success(validSource))
      }
    }
    else if phase=="resolver" {lateResolution?(.success(validSource))}
    expect(latePresentations==0 && linking.downloadSourceResolver.pending.isEmpty,"old download cannot reopen SwiftUI sheet after same-video link: "+phase)
    expect(!web.downloadLoading && !linking.downloadSourceLoading,"accepted link retires download loading before same-video shortcut: "+phase)
  }
}
for rejection in ["nil","duplicate","unstarted","unsafe"] {
  let linking=Stage(), web=linking.player!
  linking.downloadSourceResolver.hold=true
  var presentations=0
  linking.onDownloads={_,_,_ in presentations += 1}
  linking.requestDownloads();web.replies.removeFirst()(available("abcdefghijk"),nil)
  let link=ExternalLinkInbox.Request(link:try! ExternalYouTubeLink.parse("https://youtu.be/abcdefghijk?t=42"))
  if rejection=="duplicate" {linking.acceptedExternalLinkID=link.id}
  if rejection=="unstarted" {linking.feed=nil}
  let cancellations=linking.downloadSourceResolver.cancellations
  if rejection=="nil" {linking.acceptExternalLink(nil)}
  else if rejection=="unsafe" {
    linking.acceptExternalLink(ExternalLinkInbox.Request(link:ExternalYouTubeLink(url:URL(string:"https://evil.invalid/watch?v=abcdefghijk")!,destination:.video)))
  } else {linking.acceptExternalLink(link)}
  expect(linking.downloadSourceResolver.cancellations==cancellations && linking.sourceLoading,"rejected or duplicate link preserves current download request: "+rejection)
  linking.downloadSourceResolver.pending.removeFirst()(.success(validSource))
  expect(presentations==1 && !linking.sourceLoading,"original download completion remains valid after link rejection: "+rejection)
}
// Execute the shipping representable entry point: the native library receives
// ownership independently of requestDownloads(), even before a watch exists.
var reconnectControl:((Bool)->Void)?
var reconnectView=YouTubeWebView(offlinePlaybackActive:true,onOfflinePlaybackControl:{reconnectControl=$0})
let reconnectedController=reconnectView.makeUIViewController(context:YouTubeWebView.Context())
let reconnected=reconnectedController.stage, reconnectWeb=reconnected.player!, reconnectFeed=reconnected.feed!
expect(reconnectControl==nil && reconnected.systemMediaSuspendedForOffline,"a stage mounted during local playback is suspended synchronously before callback delivery")
expect(reconnected.systemMedia.clears==1 && reconnectWeb.pauses==1 && reconnectFeed.pauses==1 && reconnected.backgroundTransitions == ["cancel"],"reconnect mount pauses existing web owners once")
let reconnectDeadline=Date(timeIntervalSinceNow:1)
while reconnectControl==nil && Date()<reconnectDeadline {RunLoop.main.run(until:Date(timeIntervalSinceNow:0.01))}
expect(reconnectControl != nil,"reconnect callback arrives after synchronous suspension")
reconnectControl?(true)
reconnectView.updateUIViewController(reconnectedController,context:YouTubeWebView.Context())
expect(reconnected.systemMedia.clears==1 && reconnectWeb.pauses==1 && reconnectFeed.pauses==1 && reconnected.backgroundTransitions == ["cancel"],"callback state replay and unchanged SwiftUI update do not pause or retire ownership twice")
reconnectView.offlinePlaybackActive=false
reconnectView.updateUIViewController(reconnectedController,context:YouTubeWebView.Context())
reconnectControl?(false)
expect(!reconnected.systemMediaSuspendedForOffline && reconnectWeb.commands == ["window.__langformPublishSystemMedia && window.__langformPublishSystemMedia()"] && reconnectFeed.commands.isEmpty,"inactive SwiftUI update refreshes metadata once without resuming either web view")
expect(reconnected.downloadSourceResolver.resolutions==0 && reconnected.downloadSourceResolver.cancellations==0 && reconnected.reloads==0 && reconnectWeb.replies.isEmpty,"reconnect ownership handover never resolves a source or reloads the watch")
for currentMode in [Stage.Mode.closed,.expanded,.mini] {
  var libraryControl:((Bool)->Void)?
  var deliveries=0, downloadPresentations=0
  let view=YouTubeWebView(
    onDownloads:{_,_,_ in downloadPresentations += 1},
    onOfflinePlaybackControl:{libraryControl=$0;deliveries += 1}
  )
  let controller=view.makeUIViewController(context:YouTubeWebView.Context())
  let native=controller.stage
  native.mode=currentMode
  native.feed?.url=nil
  if currentMode == .closed {native.player=nil}
  expect(libraryControl==nil && deliveries==0,"library ownership is delivered after representable creation")
  let deadline=Date(timeIntervalSinceNow:1)
  while libraryControl==nil && Date()<deadline {RunLoop.main.run(until:Date(timeIntervalSinceNow:0.01))}
  expect(deliveries==1 && native.starts==1,"native library gets one control without page readiness")
  let web=native.player, feed=native.feed!
  libraryControl?(true)
  expect(native.systemMediaSuspendedForOffline && native.systemMedia.clears==1 && native.backgroundTransitions == ["cancel"],"library retires web system and background owners")
  expect(feed.pauses==1 && (web==nil || web?.pauses==1),"library pauses feed and any watch without loading a source")
  if let web {
    native.receive(Message(webView:web,body:["kind":"state","playing":true]))
    native.systemPlaybackCommand(id:"abcdefghijk",action:"play")
    expect(native.systemMedia.received==0 && web.commands.isEmpty,"late web state and queued remote play cannot steal library ownership")
  }
  libraryControl?(false)
  expect(!native.systemMediaSuspendedForOffline,"library dismissal releases the remote suspension")
  let expectedCommands=currentMode == .closed ? [] : ["window.__langformPublishSystemMedia && window.__langformPublishSystemMedia()"]
  expect((web?.commands ?? [])==expectedCommands && feed.commands.isEmpty,"dismissal only refreshes paused watch metadata and never resumes playback")
  expect(downloadPresentations==0 && native.downloadSourceResolver.resolutions==0 && native.downloadSourceResolver.cancellations==0 && (web?.replies.isEmpty ?? true),"direct library ownership never requests or resolves a network download source")
}
var retiredLibraryControl:((Bool)->Void)?
var retiredController:PlayerStageController?=YouTubeWebView(onOfflinePlaybackControl:{retiredLibraryControl=$0}).makeUIViewController(context:YouTubeWebView.Context())
weak var retiredStage:Stage?=retiredController?.stage
let retirementDeadline=Date(timeIntervalSinceNow:1)
while retiredLibraryControl==nil && Date()<retirementDeadline {RunLoop.main.run(until:Date(timeIntervalSinceNow:0.01))}
expect(retiredLibraryControl != nil,"lifetime regression obtains the actual native callback")
retiredController=nil
expect(retiredStage==nil,"retained library control does not retain a retired web stage")
retiredLibraryControl?(true);retiredLibraryControl?(false)
print("DOWNLOAD_BRIDGE_IDENTITY_AND_OFFLINE_OWNERSHIP_OK")
`);
  const result = spawnSync('/usr/bin/xcrun', ['swift', file], { encoding:'utf8', timeout:55000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /DOWNLOAD_BRIDGE_IDENTITY_AND_OFFLINE_OWNERSHIP_OK/);
});
