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
  let depth = 1, end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0);
  return source.slice(start, end).replace('private func', 'func').replace('private var', 'var');
}

test('native Suche bleibt im Feed; nur ein aktuelles Watch-Dokument darf zum Mini-Player werden', {
  skip: process.platform !== 'darwin', timeout: 70000,
}, t => {
  const compiler = spawnSync('/usr/bin/xcrun', ['--find', 'swift'], { encoding: 'utf8' });
  if (compiler.status !== 0) return t.skip('Swift-Toolchain nicht verfügbar');
  const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/YouTubeWebView.swift'), 'utf8');
  const routeStart = source.indexOf('case "langformPlayerRoute":');
  const routeEnd = source.indexOf('case "langformPlayer":', routeStart);
  const route = source.slice(routeStart + 'case "langformPlayerRoute":'.length, routeEnd);
  const ackStart = source.indexOf('case "langformFeedSearch":');
  const ackEnd = source.indexOf('case "langformFeedReady":', ackStart);
  const acknowledgement = source.slice(ackStart + 'case "langformFeedSearch":'.length, ackEnd);
  const policy = declaration(source, 'func webView(\n        _ webView: WKWebView,\n        decidePolicyFor navigationAction:');
  const methods = ['cancelPendingMinimize', 'minimizePlayer', 'showInFeed', 'openSearchInFeed', 'cancelPendingFeedSearch',
    'activatePendingFeedSearch', 'feedSearchChanged', 'feedSearchDocumentChanged', 'retirePlayerPage', 'playerMoved'].map(name => declaration(source, 'private func ' + name + '(')).join('\n');
  const exercise = `
import Foundation
import CoreGraphics
enum YouTubeWebView {
  ${declaration(source, 'static func isYouTube(')}
  ${declaration(source, 'static func isAccountPage(')}
  ${declaration(source, 'static func isAccountTransition(')}
  ${declaration(source, 'static func isWatchPage(')}
  ${declaration(source, 'static func isPlayablePage(')}
  ${declaration(source, 'static func isPlayableResource(')}
  ${declaration(source, 'static func videoID(')}
}
enum FeedTab { case home, subscriptions
  init?(url: URL?) {
    switch url?.path { case "", "/": self = .home; case "/feed/subscriptions": self = .subscriptions; default: return nil }
  }
}
class Scroll { var offsets = 0; func setContentOffset(_ offset: CGPoint, animated: Bool) { offsets += 1 } }
class WKWebView {
  var url: URL?, scrollView = Scroll(), scripts: [String] = [], loads: [URL] = []
  var completions: [(Any?, Error?) -> Void] = []
  var cancelledSearches = 0
  init(_ url: URL) { self.url = url }
  func load(_ request: URLRequest) { loads.append(request.url!); url = request.url }
  func evaluateJavaScript(_ script: String, completionHandler: @escaping (Any?, Error?) -> Void) {
    scripts.append(script); completions.append(completionHandler)
  }
  func evaluateJavaScript(_ script: String) { cancelledSearches += 1 }
}
struct Origin { var \`protocol\` = "https", host = "m.youtube.com" }
struct Frame { var isMainFrame = true, securityOrigin = Origin() }
class Message { var webView: WKWebView?, frameInfo = Frame(), body: Any
  init(_ webView: WKWebView?, _ body: Any) { self.webView = webView; self.body = body }
}
enum WKNavigationActionPolicy { case allow, cancel }
enum NavigationType { case linkActivated, formSubmitted, backForward, other }
struct WKNavigationAction { var request: URLRequest, targetFrame: Frame? = Frame(), navigationType = NavigationType.other }
class Card { var isHidden = false }
class Motion { var cancellations = 0; func cancel() { cancellations += 1 } }
class Diagnostics { enum Outcome { case superseded }; func finish(_ outcome: Outcome) {} }
class FeedState { var active = true }
class Stage {
  enum Mode { case closed, loading, expanded, mini }
  var minimizeRequestTicket = 0, pendingMinimizeRequest: Int?, loadTicket = 1, accountInvalidations = 0
  var mode = Mode.expanded, player: WKWebView! = WKWebView(watch(a)), feed: WKWebView! = WKWebView(home)
  var startupVideoID: String? = a, loadingVideoID: String? = a, lastWatchURL: URL?
  var pendingFeedSearch: (view: ObjectIdentifier, ticket: Int)?, feedSearchTicket = 0
  var feedSearchInFlight: Int?
  var playerOverlayOpen = false, pictureOnScreen = true, dragging = false
  var playerFullscreen = false, customFullscreenID: String?
  var cardMoving = false, state = FeedState(), loadCommitted = true, loadingViaSPA = false
  var card = Card(), openingMotion = Motion(), videoLoadDiagnostics = Diagnostics()
  var settlements = 0, closes = 0, openedWatches = 0, measured: [() -> Void] = []
  var feedDestinations: [URL] = []
  ${declaration(source, 'private var ownsWatchPlayer:')}
  func settle(_ target: Mode) { cancelPendingMinimize(); settlements += 1; mode = target }
  func closePlayer() { cancelPendingFeedSearch(); closes += 1; mode = .closed; startupVideoID = nil }
  func measureVideo(after delay: TimeInterval, _ done: @escaping () -> Void) { measured.append(done) }
  func activateFeedTab(_ tab: FeedTab, origin: URL?) { cancelPendingFeedSearch(); if let origin { feedDestinations.append(origin) } }
  func feedState(for web: WKWebView) -> FeedState? { web === feed ? state : nil }
  func openWatch(_ url: URL, userInitiated: Bool) { openedWatches += 1 }
  func resetPlayerStartupForVideo(_ id: String?) { startupVideoID = id }
  func resetPlayerOverlayForVideo(_ id: String?) {}
  func dismissNativeSearch() {}
  func evictCachedFeedsForAccountChange() { accountInvalidations += 1 }
  func updateMissingMediaTimeout() {}
  ${methods}
  ${policy}
  func receive(_ message: Message) { ${route} }
  func receiveSearch(_ message: Message) { ${acknowledgement} }
  func searchAck(_ opened: Bool, ticket: Int? = nil, href: URL? = nil, sender: WKWebView? = nil) {
    receiveSearch(Message(sender ?? feed,["ticket":ticket ?? pendingFeedSearch!.ticket,"opened":opened,"href":(href ?? feed.url!).absoluteString]))
  }
  func send(_ kind: String, id: String = a, href: URL = results) {
    receive(Message(player, ["kind":kind, "videoID":id, "href":href.absoluteString, "sourceHref":watch(id).absoluteString]))
  }
  func navigate(_ url: URL, type: NavigationType = .other, main: Bool = true) -> WKNavigationActionPolicy {
    let action = WKNavigationAction(request: URLRequest(url:url), targetFrame:Frame(isMainFrame:main), navigationType:type)
    var answer = WKNavigationActionPolicy.allow
    webView(player, decidePolicyFor:action) { answer = $0 }
    return answer
  }
}
let a = "abcdefghijk", b = "lmnopqrstuv"
let home = URL(string:"https://m.youtube.com/")!, results = URL(string:"https://m.youtube.com/results?search_query=motion")!
func watch(_ id: String) -> URL { URL(string:"https://m.youtube.com/watch?v=" + id)! }
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }

let header = Stage(); header.send("search")
expect(header.mode == .mini && header.settlements == 1 && header.player.url == watch(a), "header search minimizes the owned video while retaining its Watch document")
expect(header.feed.scripts.count == 1 && header.player.scripts.isEmpty && header.pendingFeedSearch != nil, "search API executes exclusively in the feed")
header.feed.completions[0](true,nil)
expect(header.pendingFeedSearch != nil && header.feedSearchInFlight != nil, "scheduling retains the request until its actual RAF action")
header.activatePendingFeedSearch()
expect(header.feed.scripts.count == 1, "an in-flight request cannot schedule duplicate search controls")
header.searchAck(true)
expect(header.pendingFeedSearch == nil && header.feedSearchInFlight == nil, "actual successful feed activation consumes the request")

for type in [NavigationType.formSubmitted, .other, .backForward, .linkActivated] {
  let form = Stage()
  expect(form.navigate(results,type:type) == .cancel, "all top-level non-Watch navigations are handed to the feed before commit")
  expect(form.mode == .mini && form.player.url == watch(a) && form.feed.loads == [results], "search results do not replace the retained video")
}
let frame = Stage(); expect(frame.navigate(results,main:false) == .allow && frame.settlements == 0, "subframe navigations cannot reroute the player")

let alreadySearch = Stage(); alreadySearch.player.url = results
alreadySearch.minimizePlayer()
expect(alreadySearch.mode == .expanded && alreadySearch.settlements == 0 && alreadySearch.measured.isEmpty, "a search renderer cannot minimize even before delayed URL KVO")
alreadySearch.playerMoved()
expect(alreadySearch.mode == .closed && alreadySearch.card.isHidden && alreadySearch.openingMotion.cancellations == 1 && alreadySearch.feed.loads == [results], "committed search is removed directly without a page-to-mini animation")

let transientDeparture = Stage(); transientDeparture.send("departed")
expect(transientDeparture.mode == .expanded && transientDeparture.feed.loads.isEmpty, "a transient SPA departure cannot retire a player that has already returned to Watch")
let departure = Stage(); departure.player.url = results; departure.send("departed")
expect(departure.mode == .closed && departure.card.isHidden && departure.settlements == 0, "SPA departure removes the non-video page even if native URL KVO has not arrived")
let stale = Stage(); stale.startupVideoID = b; stale.player.url = watch(b); stale.send("departed",id:a); stale.send("search",id:a)
expect(stale.mode == .expanded && stale.feed.loads.isEmpty && stale.feed.scripts.isEmpty, "old video messages cannot close or search for the new video")

for invalid in ["subframe", "origin", "source", "sender"] {
  let stage = Stage(), message = Message(stage.player,["kind":"search","videoID":a,"href":results.absoluteString,"sourceHref":watch(a).absoluteString])
  if invalid == "subframe" { message.frameInfo.isMainFrame = false }
  if invalid == "origin" { message.frameInfo.securityOrigin.host = "example.com" }
  if invalid == "source" { message.body = ["kind":"search","videoID":a,"href":results.absoluteString,"sourceHref":watch(b).absoluteString] }
  if invalid == "sender" { message.webView = stage.feed }
  stage.receive(message)
  expect(stage.settlements == 0 && stage.feed.scripts.isEmpty, invalid + " cannot activate native search")
}

let ticket = Stage(); ticket.openSearchInFeed(); let old = ticket.feed.completions[0]
ticket.cancelPendingFeedSearch(); ticket.openSearchInFeed(); let current = ticket.pendingFeedSearch!.ticket
old(true,nil)
expect(ticket.pendingFeedSearch?.ticket == current, "stale completion cannot consume a newer request")
ticket.searchAck(true,ticket:current - 2)
expect(ticket.pendingFeedSearch?.ticket == current && ticket.feedSearchInFlight == current, "stale action acknowledgement cannot consume the new request")
ticket.feed.completions[1](false,nil); ticket.activatePendingFeedSearch()
expect(ticket.feed.scripts.count == 3 && ticket.pendingFeedSearch?.ticket == current, "not-yet-mounted search retries on the same feed")
ticket.searchAck(false)
expect(ticket.pendingFeedSearch?.ticket == current && ticket.feedSearchInFlight == nil, "a target removed by hydration retains its legitimate search request")
ticket.activatePendingFeedSearch()
expect(ticket.feed.scripts.count == 4 && ticket.feedSearchInFlight == current, "a later content-ready attempt can open the remounted header")
let oldFeed = ticket.feed!; ticket.feed = WKWebView(home); ticket.activatePendingFeedSearch(); oldFeed.completions[2](true,nil)
expect(ticket.feed.scripts.isEmpty && ticket.pendingFeedSearch?.ticket == current, "a retained old feed cannot open or finish search on another tab")
ticket.searchAck(true,ticket:current,sender:oldFeed)
expect(ticket.pendingFeedSearch?.ticket == current, "a stale retained feed acknowledgement cannot finish the active tab's search")
ticket.cancelPendingFeedSearch()
expect(ticket.pendingFeedSearch == nil && ticket.feedSearchInFlight == nil && ticket.feedSearchTicket > current, "lifecycle cancellation invalidates state, in-flight action and queued completion")

for invalid in ["subframe", "origin", "protocol", "sender", "href", "ticket", "opened"] {
  let ack = Stage(); ack.openSearchInFeed(); let pending = ack.pendingFeedSearch!.ticket
  let message = Message(ack.feed,["ticket":pending,"opened":true,"href":home.absoluteString])
  if invalid == "subframe" { message.frameInfo.isMainFrame = false }
  if invalid == "origin" { message.frameInfo.securityOrigin.host = "example.com" }
  if invalid == "protocol" { message.frameInfo.securityOrigin.protocol = "http" }
  if invalid == "sender" { message.webView = ack.player }
  if invalid == "href" { message.body = ["ticket":pending,"opened":true,"href":"https://example.com/"] }
  if invalid == "ticket" { message.body = ["ticket":pending - 1,"opened":true,"href":home.absoluteString] }
  if invalid == "opened" { message.body = ["ticket":pending,"opened":"true","href":home.absoluteString] }
  ack.receiveSearch(message)
  expect(ack.pendingFeedSearch?.ticket == pending && ack.feedSearchInFlight == pending, invalid + " cannot finish the feed search acknowledgement")
}
let history = Stage(); history.openSearchInFeed(); history.searchAck(true,href:results)
expect(history.pendingFeedSearch == nil && history.feedSearchInFlight == nil, "search's synchronous history change can acknowledge before URL KVO")
let document = Stage(); document.openSearchInFeed(); let previousDocument = document.pendingFeedSearch!.ticket
let previousCancellations = document.feed.cancelledSearches
document.feedSearchDocumentChanged(document.feed)
expect(document.pendingFeedSearch!.ticket != previousDocument && document.feedSearchInFlight == nil, "a reload keeps search intent under a fresh document ticket")
expect(document.feed.cancelledSearches == previousCancellations + 1, "provisional navigation revokes the old RAF UI effect before pagehide")
document.activatePendingFeedSearch(); let freshDocument = document.pendingFeedSearch!.ticket
document.searchAck(true,ticket:previousDocument)
expect(document.pendingFeedSearch?.ticket == freshDocument && document.feedSearchInFlight == freshDocument, "same-URL old-document acknowledgements cannot finish the new attempt")
document.searchAck(true)
expect(document.pendingFeedSearch == nil, "the new document's actual search action finishes its own request")
let idleDocument = Stage(); idleDocument.feedSearchDocumentChanged(idleDocument.feed)
expect(idleDocument.feed.cancelledSearches == 0, "navigation without pending search does not queue redundant cancellation")
let failure = Stage(); failure.openSearchInFeed()
failure.feed.completions[0](nil,NSError(domain:"qa",code:1))
expect(failure.pendingFeedSearch != nil && failure.feedSearchInFlight == nil, "a JavaScript failure preserves the request without blocking future readiness")

let waiting = Stage(); waiting.cardMoving = true; waiting.openSearchInFeed()
expect(waiting.feed.scripts.isEmpty && waiting.pendingFeedSearch != nil, "search waits until the mini transition rests")
waiting.cardMoving = false; waiting.state.active = false; waiting.activatePendingFeedSearch()
expect(waiting.feed.scripts.isEmpty, "an inactive retained feed cannot open search")
waiting.state.active = true; waiting.activatePendingFeedSearch()
expect(waiting.feed.scripts.count == 1, "resting active feed executes the pending search")

let scrolled = Stage(); scrolled.pictureOnScreen = false; scrolled.minimizePlayer(); scrolled.player.url = results
scrolled.minimizePlayer()
expect(scrolled.measured.count == 1, "non-Watch never starts a second delayed minimize")
scrolled.measured[0]()
expect(scrolled.settlements == 0, "delayed minimize rechecks document ownership before settling")
let redirected = Stage(); redirected.pictureOnScreen = false; redirected.minimizePlayer()
redirected.settle(.mini); redirected.settle(.expanded); redirected.measured[0]()
expect(redirected.mode == .expanded && redirected.settlements == 2,
       "delayed minimize cannot undo the user's newer mini-to-expanded transition")
let retry = Stage(); retry.pictureOnScreen = false; retry.minimizePlayer()
let cancelledMinimize = retry.measured[0]
retry.cancelPendingMinimize(); retry.minimizePlayer(); cancelledMinimize()
expect(retry.settlements == 0 && retry.pendingMinimizeRequest != nil,
       "old callback cannot consume a later minimize request")
retry.measured[1](); retry.measured[1]()
expect(retry.mode == .mini && retry.settlements == 1 && retry.pendingMinimizeRequest == nil,
       "current delayed request settles once and releases its pending state")
let changedVideo = Stage(); changedVideo.pictureOnScreen = false; changedVideo.minimizePlayer()
changedVideo.player.url = watch(b); changedVideo.startupVideoID = b; changedVideo.measured[0]()
expect(changedVideo.settlements == 0 && changedVideo.pendingMinimizeRequest == nil,
       "same native mode on another watch identity cannot inherit an old minimize")
let touching = Stage(); touching.pictureOnScreen = false; touching.dragging = true; touching.minimizePlayer()
expect(touching.measured.isEmpty, "another finger controlling the picture cannot start a delayed collapse")
let repeated = Stage(); repeated.pictureOnScreen = false
for _ in 0..<12 { repeated.minimizePlayer() }
expect(repeated.measured.count == 1 && repeated.player.scrollView.offsets == 1,
       "rapid repeated minimize taps share one scroll and geometry request")
for custom in [false,true] {
  let fullscreen = Stage(); fullscreen.pictureOnScreen = false; fullscreen.minimizePlayer()
  if custom { fullscreen.customFullscreenID = a } else { fullscreen.playerFullscreen = true }
  fullscreen.measured[0](); fullscreen.minimizePlayer(); fullscreen.openSearchInFeed()
  expect(fullscreen.mode == .expanded && fullscreen.settlements == 0 && fullscreen.pendingFeedSearch == nil,
         "an old delayed minimize or header-search cannot steal a newly opened fullscreen player")
}
let accountRouting = Stage()
for raw in ["https://m.youtube.com/logout", "https://accounts.google.com/ServiceLogin", "https://m.youtube.com/account_switcher"] {
 let action = WKNavigationAction(request: URLRequest(url:URL(string:raw)!), targetFrame:Frame(isMainFrame:true))
 var answer = WKNavigationActionPolicy.cancel
 accountRouting.webView(accountRouting.feed, decidePolicyFor:action) { answer = $0 }
 expect(answer == .allow, "feed account navigation remains usable")
}
expect(accountRouting.accountInvalidations == 3 && accountRouting.player.url == watch(a) && accountRouting.mode == .expanded, "actual main-frame account routes invalidate cache while retaining current Watch")
for raw in ["https://m.youtube.com/feed/you", "https://example.com/logout", "https://accounts.google.com/ServiceLogin"] {
 let action = WKNavigationAction(request: URLRequest(url:URL(string:raw)!), targetFrame:Frame(isMainFrame:false))
 accountRouting.webView(accountRouting.feed, decidePolicyFor:action) { _ in }
}
expect(accountRouting.accountInvalidations == 3, "account iframe cannot evict personal tabs")
print("NATIVE_PLAYER_ROUTING_OK")
`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-native-routing-'));
  try {
    const script = path.join(directory, 'Routing.swift'); fs.writeFileSync(script, exercise);
    const result = spawnSync(compiler.stdout.trim(), [script], { encoding:'utf8', timeout:60000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_PLAYER_ROUTING_OK/);
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
});
