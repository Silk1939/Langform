const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const source = fs.readFileSync(process.env.LANGFORM_FEED_BACK_TEST_SOURCE ||
  path.join(__dirname, '../ios/Langform/Langform/YouTubeWebView.swift'), 'utf8');

function declaration(signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  const open = source.indexOf('{', start);
  let depth = 1, end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0, signature);
  return source.slice(start, end);
}

test('nativer Feed-Zurückknopf reagiert auf aktuellen Overlaybesitz und bleibt eindeutig auffindbar', () => {
  assert.match(declaration('func updateChrome('), /\bupdateFeedBackButton\(\)/);
  const overlay = declaration('else if let state = feedState(for: webView), url.absoluteString == webView.url?.absoluteString');
  assert.match(overlay, /state\.overlayOpen = open[\s\S]*if webView === feed\s*\{\s*updateFeedBackButton\(\)/);
  assert.match(source, /backButton\.accessibilityIdentifier = "langform-feed-back"/);
});

test('echte native Zurückmethoden schützen Galerie, verspätete Tipps und wechselnde Feedzustände', {
  skip: process.platform !== 'darwin', timeout: 60000,
}, t => {
  const tool = spawnSync('/usr/bin/xcrun', ['--find', 'swift'], {encoding:'utf8'});
  if (tool.status !== 0) return t.skip('Swift-Toolchain fehlt für den tatsächlichen Feed-Zurücktest.');
  const methods = ['func feedBack(', 'var feedHasBackDestination:', 'func feedState('].map(declaration).join('\n');
  let visibility;
  if (source.includes('func updateFeedBackButton(')) {
    visibility = declaration('func updateFeedBackButton(');
  } else {
    // Historical replay: package the exact old updateChrome guard and exact
    // old visibility assignment, without inventing an overlay policy for it.
    const chrome = declaration('func updateChrome(');
    const guardLine = chrome.match(/^\s*guard let feed else \{ return \}\s*$/m);
    const visibilityLine = chrome.match(/^\s*backButton\.isHidden = .*$/m);
    assert.ok(guardLine && visibilityLine, 'historical production visibility statements');
    visibility = `func updateFeedBackButton() {\n${guardLine[0]}\n${visibilityLine[0]}\n}`;
  }
  const feedOverlayBranch = declaration('else if let state = feedState(for: webView), url.absoluteString == webView.url?.absoluteString')
    .replace(/^else /, '');
  const script = `
import Foundation
class WKWebView {
 var url: URL?, canGoBack = true, backCalls = 0
 var allowsBackForwardNavigationGestures = true
 init(_ raw: String = "https://m.youtube.com/@channel") { url = URL(string: raw) }
 func goBack() { backCalls += 1 }
}
class Button { var isHidden = false }
class NativeSearchOverlay {}
class FeedState {
 let webView: WKWebView
 var overlayOpen = false
 init(_ webView: WKWebView) { self.webView = webView }
}
enum FeedTab: Hashable {
 case home, subscriptions, you
 ${declaration('init?(url: URL?)')}
}
enum YouTubeWebView {
 ${declaration('static func isYouTube(')}
 ${declaration('static func isWatchPage(')}
}
class Stage {
 enum Mode { case closed, loading, expanded, mini }
 var mode = Mode.mini
 var feed: WKWebView! = WKWebView()
 var feedTabs: [FeedTab:FeedState] = [:]
 var activeFeedTab = FeedTab.home
 var nativeSearchOverlay: NativeSearchOverlay?
 let backButton = Button()
 var probeCancellations = 0, rootRestores = 0, prewarmCancellations = 0, prewarmSchedules = 0
 init() { feedTabs[.home] = FeedState(feed) }
 func cancelVideoProbe() { probeCancellations += 1 }
 func restoreFeedRoot(_ state: FeedState, tab: FeedTab) { rootRestores += 1 }
 func cancelFeedPrewarm() { prewarmCancellations += 1 }
 func scheduleFeedPrewarm() { prewarmSchedules += 1 }
 func receiveOverlay(_ open: Bool, href: String? = nil, from webView: WKWebView? = nil) {
   let webView = webView ?? feed!
   guard let url = URL(string: href ?? webView.url!.absoluteString) else { return }
   ${feedOverlayBranch}
 }
 ${methods}
 ${visibility}
}
var passed = 0, failures = [String]()
func expect(_ ok: Bool, _ name: String) { if ok { passed += 1 } else { failures.append(name); print("FAILED: " + name) } }
func unchanged(_ s: Stage, _ web: WKWebView) -> Bool {
 s.probeCancellations == 0 && s.rootRestores == 0 && web.backCalls == 0
}

for raw in ["https://m.youtube.com/", "https://m.youtube.com/feed/subscriptions", "https://m.youtube.com/feed/you", "https://m.youtube.com/feed/library", "https://m.youtube.com/watch?v=abcdefghijk", "https://www.youtube.com/watch/abcdefghijk"] {
 let s = Stage(); s.feed.url = URL(string:raw); s.updateFeedBackButton()
 expect(!s.feedHasBackDestination && s.backButton.isHidden,"root/watch has no feed-back destination: " + raw)
}
let missingURL = Stage(); missingURL.feed.url = nil; missingURL.updateFeedBackButton()
expect(!missingURL.feedHasBackDestination && missingURL.backButton.isHidden,"missing URL hides back")
for mode in [Stage.Mode.closed, .loading, .mini] {
 let s = Stage(); s.mode = mode; s.updateFeedBackButton()
 expect(s.feedHasBackDestination && !s.backButton.isHidden,"ordinary feed history remains visible in " + String(describing:mode))
}
let expanded = Stage(); expanded.mode = .expanded; expanded.updateFeedBackButton()
expect(expanded.backButton.isHidden,"expanded player hides feed back")
let absent = Stage(); absent.feed = nil; absent.backButton.isHidden = false; absent.updateFeedBackButton()
expect(absent.backButton.isHidden,"missing feed actively removes a previously visible back button")
let unknown = Stage(); let unknownWeb = unknown.feed!; unknown.feedTabs = [:]; unknown.updateFeedBackButton(); unknown.feedBack()
expect(unknown.backButton.isHidden && unchanged(unknown,unknownWeb),"unknown current feed ownership is hidden and cannot cancel probe/navigate")

for history in [true,false] {
 let s = Stage(); let web = s.feed!; web.canGoBack = history
 s.feedTabs[.home]!.overlayOpen = true; s.updateFeedBackButton()
 expect(s.backButton.isHidden,"DOM overlay hides native back, history=" + String(history))
 s.backButton.isHidden = false // A tap can already be queued before native visibility catches up.
 s.feedBack()
 expect(unchanged(s,web),"queued overlay tap neither cancels a probe nor goes back/restores root, history=" + String(history))
 s.feedTabs[.home]!.overlayOpen = false; s.updateFeedBackButton()
 expect(!s.backButton.isHidden,"closing DOM overlay restores usable history, history=" + String(history))
 s.feedBack()
 expect(s.probeCancellations == 1 && web.backCalls == (history ? 1 : 0) && s.rootRestores == (history ? 0 : 1),"legitimate close then back executes original history/root route exactly once")
}
for history in [true,false] {
 let s = Stage(); let web = s.feed!; web.canGoBack = history; s.nativeSearchOverlay = NativeSearchOverlay(); s.feedBack()
 expect(unchanged(s,web),"native search also rejects a queued underlying back action, history=" + String(history))
}

let swapped = Stage(); let old = swapped.feed!; let replacement = WKWebView("https://m.youtube.com/results?search_query=new")
let replacementState = FeedState(replacement); replacementState.overlayOpen = true
swapped.feedTabs[.subscriptions] = replacementState; swapped.feed = replacement
// The tab index deliberately lags the actual foreground WKWebView.
swapped.updateFeedBackButton(); swapped.feedBack()
expect(swapped.backButton.isHidden && unchanged(swapped,replacement) && old.backCalls == 0,"guard reads actual foreground feed identity, not the retained active-tab state")
swapped.feed = old; swapped.activeFeedTab = .subscriptions; swapped.updateFeedBackButton(); swapped.feedBack()
expect(!swapped.backButton.isHidden && old.backCalls == 1 && replacement.backCalls == 0 && swapped.probeCancellations == 1,"unrelated inactive overlay cannot block current closed-overlay history")

let messages = Stage(); let active = messages.feed!, inactive = WKWebView("https://m.youtube.com/@inactive")
let inactiveState = FeedState(inactive); messages.feedTabs[.subscriptions] = inactiveState
messages.updateFeedBackButton(); messages.receiveOverlay(true)
expect(messages.feedTabs[.home]!.overlayOpen && messages.backButton.isHidden && !active.allowsBackForwardNavigationGestures,"current open message immediately hides native back and disables web swipe-back")
expect(messages.prewarmCancellations == 1 && messages.prewarmSchedules == 0 && messages.probeCancellations == 0,"current open preserves original prewarm semantics without cancelling playback probe")
messages.receiveOverlay(false,from:inactive)
expect(messages.backButton.isHidden && !inactiveState.overlayOpen && messages.prewarmSchedules == 0,"inactive close cannot expose back above current gallery")
messages.receiveOverlay(false,href:"https://m.youtube.com/@old-document")
expect(messages.feedTabs[.home]!.overlayOpen && messages.backButton.isHidden,"stale current-document message cannot release overlay ownership")
messages.receiveOverlay(false)
expect(!messages.feedTabs[.home]!.overlayOpen && !messages.backButton.isHidden && active.allowsBackForwardNavigationGestures,"matching close restores both actual history controls")
expect(messages.prewarmSchedules == 1 && messages.prewarmCancellations == 1,"matching close keeps original schedule/cancel counts")
messages.receiveOverlay(true,from:inactive)
expect(inactiveState.overlayOpen && !messages.backButton.isHidden && !inactive.allowsBackForwardNavigationGestures,"known inactive overlay updates only its own web gestures")
let foreign = WKWebView("https://m.youtube.com/@foreign"); messages.receiveOverlay(true,from:foreign)
expect(!messages.backButton.isHidden && foreign.allowsBackForwardNavigationGestures,"unknown webview cannot mutate current back visibility")
print("NATIVE_FEED_BACK assertions=" + String(passed + failures.count) + " passed=" + String(passed) + " failed=" + String(failures.count))
if !failures.isEmpty { exit(1) }
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-native-feed-back-'));
  try {
    const file = path.join(dir, 'FeedBack.swift'); fs.writeFileSync(file, script);
    const result = spawnSync(tool.stdout.trim(), ['-module-cache-path', path.join(dir, 'cache'), file], {encoding:'utf8',timeout:50000});
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_FEED_BACK assertions=\d+ passed=\d+ failed=0/);
    t.diagnostic(result.stdout.trim());
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
