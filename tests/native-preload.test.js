const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function method(source, name) {
  const start = source.indexOf('func ' + name + '(');
  assert.ok(start >= 0, name);
  const open = source.indexOf('{', start);
  let end = open + 1, depth = 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  return source.slice(start, end);
}
test('Mein YouTube wird zuerst einmal vorgeladen, bleibt beim Scrollen erhalten und gibt Video/Speicherdruck Vorrang', { skip: process.platform !== 'darwin' }, t => {
  const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/YouTubeWebView.swift'), 'utf8');
  const methods = ['scheduleFeedPrewarm', 'cancelFeedPrewarm', 'feedInteractionBegan', 'appEnteredBackground', 'appBecameActive', 'keyboardDidHide', 'restoreFeedRoot', 'resumePreparedPlayer', 'evictCachedFeedsForAccountChange', 'feedTabIsContentReady',
    ...(source.includes('func suspendPreparedPlayer(') ? ['suspendPreparedPlayer'] : [])].map(n => method(source, n)).join('\n');
  const script = `
import Foundation
import CoreGraphics
class DispatchWorkItem {
  var cancelled = false; let action: () -> Void
  init(block: @escaping () -> Void) { action = block }
  func cancel() { cancelled = true }
}
struct Deadline { static func now() -> Deadline { Deadline() }; static func +(lhs: Deadline, rhs: Double) -> Deadline { lhs } }
class DispatchQueue {
  static let main = DispatchQueue(); var pending: [DispatchWorkItem] = []
  func asyncAfter(deadline: Deadline, execute: DispatchWorkItem) { pending.append(execute) }
  func run() { let next = pending; pending = []; for w in next where !w.cancelled { w.action() } }
}
class ProcessInfo { static let processInfo = ProcessInfo(); var isLowPowerModeEnabled = false; enum Thermal { case nominal, serious }; var thermalState = Thermal.nominal }
class UIApplication { static let shared = UIApplication(); enum State { case active, background }; var applicationState = State.active }
class WKNavigation {}
class Scroll { var isTracking = false, isDragging = false, isDecelerating = false }
class Item { let url: URL; init(_ url: URL) { self.url = url } }
class History { var backList: [Item] = [], forwardList: [Item] = [] }
class WKWebView {
 var url: URL? = URL(string: "https://m.youtube.com/"); var isLoading = false
 var isHidden = false, accessibilityElementsHidden = false, isUserInteractionEnabled = true
 var frame = CGRect.zero, scrollView = Scroll(), backForwardList = History()
 var loads: [URL] = [], media: [Bool] = [], stops = 0, mediaSuspensionDepth = 0
 func load(_ request: URLRequest) -> WKNavigation { url = request.url; loads.append(request.url!); isLoading = true; return WKNavigation() }
 func go(to item: Item) -> WKNavigation { url = item.url; return WKNavigation() }
 // WebKit reference-counts these calls: a second true needs a second false.
 // Loading a different document does not release the WKWebView's suspension.
 func setAllMediaPlaybackSuspended(_ flag: Bool, completionHandler: (() -> Void)?) {
  media.append(flag)
  if flag { mediaSuspensionDepth += 1 } else if mediaSuspensionDepth > 0 { mediaSuspensionDepth -= 1 }
  completionHandler?()
 }
 func stopLoading() { stops += 1; isLoading = false }
 func evaluateJavaScript(_ source: String) {}
}
class FeedState {
 let webView = WKWebView(); let rootURL: URL
 var mediaSuspended: Bool?, active: Bool?
 var overlayOpen = false, failed = false, needsReload = false, contentReady = false, accountStale = false, rootNavigation: WKNavigation?
 init(_ url: URL) { rootURL = url; webView.url = url }
}
enum FeedTab: Hashable {
 case home, subscriptions, you
 init?(url: URL?) {
  switch url?.path { case "", "/": self = .home; case "/feed/subscriptions": self = .subscriptions; case "/feed/you", "/feed/library": self = .you; default: return nil }
 }
 ${method(source,"rootURL")}
}
class Network {
 struct Policy { var online = true, constrained = false }; var policy: Policy? = Policy()
}
class Card { var isHidden = true }
class UIPanGestureRecognizer { enum State { case began, ended, cancelled, changed }; var state = State.began }
enum YouTubeWebView {
 static let startURL = URL(string:"https://m.youtube.com/")!
 static ${method(source,"homeURL")}
 ${['isYouTube','isAccountPage','isAccountTransition'].map(n=>'static '+method(source,n)).join('\n')}
}
enum StartupDiagnostics { static var events: [String] = []; static func mark(_ event: String) { events.append(event) } }
class Motion { func finish() {}; func cancel() {} }
class Stage {
  // Preference implementation is executed by motion-system.test.js.
  var motionSynchronizations = 0
  func motionPreferencesChanged() { motionSynchronizations += 1 }
  // Entry-admission ownership is exercised by native-player-interaction.test.js.
  // This fixture owns the adjacent lifecycle behavior, with no pending entry.
  func revokeFullscreenEntryAdmission() {}
    func recordBackgroundPlaybackTransition(_ phase: String) {}
    func watchBackgroundCategoryTransition(_ phase: String) {}
  func clearWatchAudioIntent() {}
  func cancelPendingMinimize() {}
  func discardFeedOpening() {}
  var nativeSearchRecent = [String](), pendingSearch = false, searchCancellations = 0
  func cancelPendingFeedSearch() { pendingSearch = false; searchCancellations += 1 }
  func finishMiniContext() {}
 var feedMotion = Motion(), openingMotion = Motion()
 enum Mode { case closed, loading, expanded, mini }; var mode = Mode.closed
 var feed: WKWebView!, player: WKWebView!, card = Card(), bounds = CGRect(x:0,y:0,width:400,height:800)
 var feedTabs: [FeedTab:FeedState] = [:], activeFeedTab = FeedTab.home, prewarmingTab: FeedTab?
 var backgroundPreparationDisabled = false, keyboardVisible = false, feedFailed = false
 var videoPlaying = false, cardMoving = false
 var dismisser: NSObject?
 var playerWarmupAttempted = false, playerPreparationSuspended = false
 var playerWarmupNavigation: WKNavigation?, playerNavigation: WKNavigation?
 var feedPrewarm: DispatchWorkItem?, missingMediaTimeout: DispatchWorkItem?
 var networkQuality = Network(), insertions = 0, activities: [Bool] = []
 init() { let home = FeedState(URL(string:"https://m.youtube.com/")!); feedTabs[.home] = home; feed = home.webView }
 func makeFeedTab(_ tab: FeedTab, origin: URL?) -> FeedState { let s = FeedState(tab.rootURL(for:origin)); feedTabs[tab] = s; return s }
 func setFeedActivity(_ web: WKWebView, active: Bool) {
  activities.append(active)
  let state = feedTabs.values.first { $0.webView === web }
  if state?.mediaSuspended != !active {
   state?.mediaSuspended = !active
   web.setAllMediaPlaybackSuspended(!active, completionHandler:nil)
  }
 }
 func insertSubview(_ view: Any, belowSubview: WKWebView) { insertions += 1 }
 func ensurePlayer() { if player == nil { player = WKWebView() } }
 func evictFeedTab(_ tab: FeedTab) { feedTabs.removeValue(forKey:tab) }
 func cancelVideoProbe() {}
 func cancelNativeRotation() {}
 func confirmCustomFullscreenEnter() {}
 func confirmCustomFullscreenExit() {}
 func resumeFullscreenExitAfterInactivity() {}
 func updateMissingMediaTimeout() {}
 func finishClose() { dismisser = nil }
 ${methods}
}
func expect(_ condition: Bool, _ text: String) { if !condition { print("FAIL " + text); exit(1) } }
let s = Stage(), pan = UIPanGestureRecognizer()
s.scheduleFeedPrewarm(); s.scheduleFeedPrewarm()
expect(DispatchQueue.main.pending.count == 1, "one pending idle job")
s.feedInteractionBegan(pan); DispatchQueue.main.run()
expect(s.feedTabs[.you] == nil, "touch postpones construction")
pan.state = .ended; s.feed.scrollView.isDecelerating = true; s.feedInteractionBegan(pan); DispatchQueue.main.run()
expect(s.feedTabs[.you] == nil && s.feedPrewarm != nil, "deceleration re-arms preparation instead of losing it forever")
s.feed.scrollView.isDecelerating = false; DispatchQueue.main.run()
expect(s.feedTabs[.you] != nil && s.feedTabs[.subscriptions] == nil, "Mein YouTube is the first idle request")
let you = s.feedTabs[.you]!
expect(you.webView.loads.count == 1 && you.webView.media == [true] && s.activities == [false], "Mein YouTube loads once, media and scans suspended")
pan.state = .began; s.feedInteractionBegan(pan)
expect(s.feedTabs[.you] === you && you.webView.stops == 0, "ongoing Mein YouTube download survives scrolling")
s.cancelFeedPrewarm(keeping:.you)
expect(s.feedTabs[.you] === you, "selecting in-flight Mein YouTube keeps its request")
s.restoreFeedRoot(you,tab:.you)
expect(you.webView.loads.count == 1, "selecting loading tab doesn't start over")
you.rootNavigation = nil; you.webView.isLoading = false
s.restoreFeedRoot(you,tab:.you)
expect(you.webView.loads.count == 1, "loaded Mein YouTube switches without network request")
s.scheduleFeedPrewarm(); DispatchQueue.main.run()
let subscriptions = s.feedTabs[.subscriptions]!
expect(subscriptions.webView.loads.count == 1 && subscriptions.webView.media == [true], "Abos follows the retained Mein YouTube tab")
s.scheduleFeedPrewarm(); DispatchQueue.main.run()
expect(s.player == nil, "only one speculative navigation runs at a time")
subscriptions.webView.isLoading = false; subscriptions.rootNavigation = nil; s.prewarmingTab = nil
s.scheduleFeedPrewarm(); DispatchQueue.main.run()
expect(s.player.loads.map { $0.path } == ["/"], "player primes only site shell, never a speculative watch")
expect(s.player.media == [true] && s.playerPreparationSuspended && !s.player.isUserInteractionEnabled, "prepared player cannot play or intercept input")
s.resumePreparedPlayer(); s.resumePreparedPlayer()
expect(s.player.media == [true,false] && s.player.mediaSuspensionDepth == 0, "explicit accepted watch releases WebKit's media suspension")
s.scheduleFeedPrewarm(); DispatchQueue.main.run()
expect(s.player.loads.count == 1, "idle preparation is bounded")
let priority = Stage(); priority.scheduleFeedPrewarm(); DispatchQueue.main.run()
priority.cancelFeedPrewarm(discardLoading:true)
expect(priority.feedTabs[.you] == nil, "requested video releases unfinished background network work")
priority.scheduleFeedPrewarm(); DispatchQueue.main.run()
expect(priority.feedTabs[.you] != nil, "discarded work can be retried during a later idle phase")
for blocked in 0..<6 {
 let p = Stage()
 switch blocked { case 0: p.mode = .loading; case 1: p.keyboardVisible = true; case 2: p.backgroundPreparationDisabled = true; case 3: p.networkQuality.policy?.constrained = true; case 4: p.networkQuality.policy?.online = false; default: p.feedTabs[.home]?.overlayOpen = true }
 p.scheduleFeedPrewarm(); DispatchQueue.main.run()
 expect(p.feedTabs[.you] == nil && p.player == nil, "blocked preparation has no load")
}
let watching = Stage(); watching.mode = .expanded; watching.videoPlaying = true
watching.scheduleFeedPrewarm(); DispatchQueue.main.run()
expect(watching.feedTabs[.you] != nil && watching.player == nil, "Mein YouTube can prepare during established playback without replacing that player")
let moving = Stage(); moving.mode = .mini; moving.videoPlaying = true; moving.cardMoving = true
moving.scheduleFeedPrewarm(); DispatchQueue.main.run()
expect(moving.feedTabs[.you] == nil, "native motion never constructs a new webview")
let inactive = Stage(); inactive.scheduleFeedPrewarm(); UIApplication.shared.applicationState = .background; DispatchQueue.main.run()
expect(inactive.feedTabs[.you] == nil, "no background app network startup")
UIApplication.shared.applicationState = .active; inactive.appBecameActive(); DispatchQueue.main.run()
expect(inactive.motionSynchronizations == 1,"foreground also refreshes current motion preferences")
expect(inactive.feedTabs[.you] != nil, "foreground retries postponed work")
let rotate = Stage(); rotate.scheduleFeedPrewarm(); DispatchQueue.main.run(); let old = rotate.feedTabs[.you]!
old.webView.isLoading = false; old.rootNavigation = nil; rotate.prewarmingTab = nil
rotate.scheduleFeedPrewarm(); DispatchQueue.main.run()
let rotateSubs = rotate.feedTabs[.subscriptions]!
rotateSubs.webView.isLoading = false; rotateSubs.rootNavigation = nil; rotate.prewarmingTab = nil
rotate.scheduleFeedPrewarm(); DispatchQueue.main.run(); rotate.appEnteredBackground()
expect(rotate.player.stops == 1 && rotate.playerWarmupNavigation == nil && !rotate.playerWarmupAttempted, "incomplete player shell cancels on app background and can retry")
for attempt in 0..<3 {
 rotate.appBecameActive(); DispatchQueue.main.run()
 expect(rotate.player.mediaSuspensionDepth == 1, "retrying unfinished shell must retain one suspension, attempt " + String(attempt))
 rotate.appEnteredBackground()
}
rotate.appBecameActive(); DispatchQueue.main.run()
rotate.mode = .loading
rotate.playerNavigation = rotate.player.load(URLRequest(url: URL(string: "https://m.youtube.com/watch?v=nextvideo01")!))
rotate.resumePreparedPlayer()
expect(rotate.player.mediaSuspensionDepth == 0 && !rotate.playerPreparationSuspended,
       "requested video can play after repeated background preparation cancellations")
for value in ["https://accounts.google.com/ServiceLogin", "https://accounts.youtube.com/accounts/SetSID", "https://m.youtube.com/logout", "https://www.youtube.com/signin?next=feed", "https://m.youtube.com/account_switcher"] {
 expect(YouTubeWebView.isAccountTransition(URL(string:value)), "explicit account transition invalidates personal retained pages")
}
for value in ["https://example.com/logout", "https://m.youtube.com/feed/you", "https://m.youtube.com/watch?v=abcdefghijk", "https://m.youtube.com/logout-simulation"] {
 expect(!YouTubeWebView.isAccountTransition(URL(string:value)), "ordinary pages and foreign origins cannot be account transition")
}
let account = Stage(); account.scheduleFeedPrewarm(); DispatchQueue.main.run()
let cachedYou = account.feedTabs[.you]!
account.nativeSearchRecent = ["Vorheriges Konto – private Suche"]
account.pendingSearch = true
account.evictCachedFeedsForAccountChange()
expect(account.feedTabs[.you] == nil && account.feedTabs[.home]?.accountStale == true, "account transition drops personal retained roots")
expect(account.nativeSearchRecent.isEmpty && !account.pendingSearch && account.searchCancellations == 1,
       "account transition clears prior-account search suggestions and revokes the open or pending search")
let home = account.feedTabs[.home]!
account.restoreFeedRoot(home, tab:.home)
expect(home.webView.loads.count == 1 && !home.accountStale, "stale active root reloads rather than revealing old history")
let early = Stage(); early.feed.isLoading = true
let earlyHome = early.feedTabs[.home]!
early.scheduleFeedPrewarm(); DispatchQueue.main.run()
expect(early.feedTabs[.you] == nil, "loading Home without ready content has priority")
earlyHome.contentReady = true; early.scheduleFeedPrewarm(); DispatchQueue.main.run()
expect(early.feedTabs[.you] != nil, "paint-confirmed Home can prewarm without waiting for remaining resources")
expect(FeedTab.you.rootURL(for:URL(string:"https://m.youtube.com/" )).path == "/feed/library", "mobile personal prewarm uses the real FElibrary root rather than a blank /feed/you shell")
expect(FeedTab.you.rootURL(for:URL(string:"https://m.youtube.com/feed/you" )).path == "/feed/library", "mobile old You alias canonicalizes to library")
expect(FeedTab.you.rootURL(for:URL(string:"https://www.youtube.com/" )).path == "/feed/you", "desktop personal root stays You")
let readiness = Stage(); let readyYou = readiness.makeFeedTab(.you, origin:readiness.feed.url)
readyYou.webView.isLoading = false; readyYou.rootNavigation = nil
expect(!readiness.feedTabIsContentReady(.you), "document finish alone never labels a blank personal shell as cached content")
readyYou.contentReady = true
expect(readiness.feedTabIsContentReady(.you), "confirmed painted canonical root can be labeled cached")
readyYou.accountStale = true; expect(!readiness.feedTabIsContentReady(.you), "old account content is never cached-ready")
readyYou.accountStale = false; readyYou.needsReload = true; expect(!readiness.feedTabIsContentReady(.you), "failed root is never cached-ready")
readyYou.needsReload = false; readyYou.webView.url = URL(string:"https://m.youtube.com/feed/you")
expect(!readiness.feedTabIsContentReady(.you), "wrong mobile alias cannot stand in for confirmed library root")
readyYou.webView.url = URL(string:"https://m.youtube.com/results?search_query=query")
expect(!readiness.feedTabIsContentReady(.you), "search within retained You tab is not personal root readiness")
print("NATIVE_PRELOAD_OK")
`;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'langform-preload-test-'));
  try {
    const file=path.join(dir,'Preload.swift');fs.writeFileSync(file,script);
    const run=spawnSync('xcrun',['swift',file],{encoding:'utf8',timeout:60000});
    assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/NATIVE_PRELOAD_OK/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
