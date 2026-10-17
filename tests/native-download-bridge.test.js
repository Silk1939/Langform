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
  fs.writeFileSync(file, `${policy}\n${snapshot}\n
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
enum YouTubeWebView {
  static func videoID(_ url:URL?)->String? { guard let url else{return nil}; return URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems?.first{$0.name=="v"}?.value }
}
class Media {
  var clears=0, received=0
  func clear(){clears += 1}
  func receive(_ body:[String:Any],expectedID:String){received += 1}
}
class DownloadSourceResolver {
  var hold=false, cancellations=0
  var pending:[(Result<DownloadSource,Error>)->Void]=[]
  func cancel(){cancellations += 1}
  func resolve(_ snapshot:[String:Any],expectedVideoID:String,completion:@escaping(Result<DownloadSource,Error>)->Void){
    let result=Result {try DownloadSourcePolicy.assessment(snapshot,expectedVideoID:expectedVideoID)}
    if hold {pending.append(completion)} else {completion(result)}
  }
}
struct Origin { var protocolName="https", host="m.youtube.com"; var \`protocol\`:String {protocolName} }
struct Frame { var securityOrigin=Origin() }
struct Message { var webView:WebView?, frameInfo=Frame(), body:Any }
struct FeedState {var active=true}
class Stage {
  enum Mode {case closed,loading,expanded,mini}
  var mode=Mode.expanded, loadTicket=1, loadingVideoID:String?
  var player:WebView! = WebView()
  var systemMedia=Media(), systemMediaSuspendedForOffline=false
  var downloadSourceResolver=DownloadSourceResolver(), downloadSourceRequestGeneration=0, downloadSourceLoading=false
  var sourceLoading:Bool {player?.downloadLoading == true}
  var customFullscreenID:String?, playerOverlayOpen=false
  var backgroundTransitions:[String]=[]
  func watchBackgroundCategoryTransition(_ phase:String){backgroundTransitions.append(phase)}
  func feedState(for view:WebView)->FeedState? {nil}
  var onDownloads:((DownloadSource?,String?,@escaping(Bool)->Void)->Void)?
  ${request}
  ${cancelDownload}
  ${loading}
  ${command}
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
print("DOWNLOAD_BRIDGE_IDENTITY_AND_OFFLINE_OWNERSHIP_OK")
`);
  const result = spawnSync('/usr/bin/xcrun', ['swift', file], { encoding:'utf8', timeout:55000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /DOWNLOAD_BRIDGE_IDENTITY_AND_OFFLINE_OWNERSHIP_OK/);
});
