const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function declaration(source, signature) {
  const start = source.indexOf(signature); assert.ok(start >= 0, signature);
  const open = source.indexOf('{', start); let depth = 1, end = open + 1;
  while (depth && end < source.length) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
  return source.slice(start, end).replace('private func', 'func');
}

test('Native Playables-Policy blockiert Route/Spielorigin auch im Unterframe und entsorgt Games beim Tab/Background', {
  skip: process.platform !== 'darwin', timeout:70000,
}, t => {
  const swift = spawnSync('/usr/bin/xcrun', ['--find','swift'], { encoding:'utf8' });
  if (swift.status !== 0) return t.skip('Swift fehlt');
  const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/YouTubeWebView.swift'), 'utf8');
  const methods = ['func setFeedActivity(', 'func appEnteredBackground(', 'func appBecameActive(']
    .map(signature => declaration(source, signature)).join('\n');
  const policy = declaration(source, 'func webView(\n        _ webView: WKWebView,\n        decidePolicyFor navigationAction:');
  const code = `
import Foundation
enum YouTubeWebView {
  ${['isYouTube','isWatchPage','isPlayablePage','isPlayableResource','isAccountPage','isAccountTransition'].map(name => declaration(source, 'static func ' + name + '(')).join('\n')}
}
class WKWebView {
  var media:[Bool] = [], scripts:[String] = [], stopped = false, suspensionDepth = 0
  func setAllMediaPlaybackSuspended(_ value:Bool, completionHandler:(() -> Void)?) {
    media.append(value); suspensionDepth = max(0,suspensionDepth + (value ? 1 : -1))
  }
  func evaluateJavaScript(_ script:String) { scripts.append(script) }
  func stopLoading() { stopped = true }
}
class Refresh { func cancel() {} }
class FeedState { var webView = WKWebView(), active:Bool?, mediaSuspended:Bool?, refresh:Refresh? }
class Work { func cancel() {} }
enum StartupDiagnostics { static func mark(_ value:String) {} }
enum WKNavigationActionPolicy { case allow, cancel }
enum NavigationType { case linkActivated, backForward, other }
struct Frame { var isMainFrame:Bool }
struct WKNavigationAction { var request:URLRequest, targetFrame:Frame?, navigationType = NavigationType.other }
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
  enum Mode { case closed, loading, expanded, mini }
  var feedTabs = [0:FeedState(),1:FeedState()]
  var activeTab = 0
  var feed:WKWebView { feedTabs[activeTab]!.webView }
  var player:WKWebView? = WKWebView(), mode = Mode.closed, dismisser:Work?, cardMoving = false
  var playerWarmupNavigation:String?, playerWarmupAttempted = true, missingMediaTimeout:Work?
  var ownsWatchPlayer = true, watches = 0, destinations = 0, accountInvalidations = 0
  var rotationHeld = true, rotationCancellations = 0
  func feedState(for webView:WKWebView) -> FeedState? { feedTabs.values.first { $0.webView === webView } }
  func cancelPendingFeedSearch() {}
  func evictCachedFeedsForAccountChange() { accountInvalidations += 1 }
  class Motion { func finish() {}; func cancel() {} }
  var feedMotion = Motion(), openingMotion = Motion()
  func finishClose() {}
  func finishMiniContext() {}
  func cancelVideoProbe() {}
  func cancelNativeRotation() { rotationHeld = false; rotationCancellations += 1 }
  func confirmCustomFullscreenEnter() {}
  func confirmCustomFullscreenExit() {}
 func resumeFullscreenExitAfterInactivity() {}
  func cancelFeedPrewarm(discardLoading:Bool) {}
  func updateMissingMediaTimeout() {}
  func scheduleFeedPrewarm() {}
  func openWatch(_ url:URL, userInitiated:Bool) { watches += 1 }
  func showInFeed(_ url:URL) { destinations += 1 }
  func minimizePlayer() {}
  func retirePlayerPage(to url:URL) {}
  ${methods}
  ${policy}
  func navigate(_ raw:String, main:Bool, fromPlayer:Bool = false) -> WKNavigationActionPolicy {
    var result = WKNavigationActionPolicy.allow
    webView(fromPlayer ? player! : feed, decidePolicyFor:WKNavigationAction(request:URLRequest(url:URL(string:raw)!),targetFrame:Frame(isMainFrame:main))) { result = $0 }
    return result
  }
}
func expect(_ value:Bool,_ message:String) { if !value { print("FAILED: " + message); exit(1) } }
let s = Stage()
for host in ["m.youtube.com","www.youtube.com","youtube.com"] {
  for path in ["/playables","/playables/saved","/playables/UgkxGame","/playable/old"] {
    for main in [true,false] {
      expect(s.navigate("https://" + host + path,main:main) == .cancel,"known Playable routes cancelled including iframe")
      expect(s.navigate("https://" + host + path,main:main,fromPlayer:true) == .cancel,"player cannot route a Playable to feed")
    }
  }
}
for host in ["playables.usercontent.goog","12198422295069170377.playables.usercontent.goog"] {
  expect(s.navigate("https://" + host + "/v/assets/index.html",main:false) == .cancel,"game iframe engine cannot start")
}
for raw in ["https://m.youtube.com/gaming","https://m.youtube.com/playables-news","https://example.com/playables/game","https://accounts.google.com/ServiceLogin","https://m.youtube.com/live_chat","https://playables.usercontent.goog.example.com/index.html"] {
  expect(s.navigate(raw,main:false) == .allow,"unrelated subframes and gaming videos retained")
}
expect(s.watches == 0 && s.destinations == 0,"no blocked game becomes a watch or feed navigation")
expect(s.accountInvalidations == 0,"unrelated account iframe never evicts retained feed tabs")
expect(s.navigate("https://m.youtube.com/logout", main:true) == .allow && s.accountInvalidations == 1, "explicit main-frame account action invalidates personal cache without being blocked")
s.setFeedActivity(s.feed,active:true)
let hidden = s.feedTabs[1]!.webView
s.setFeedActivity(hidden,active:false)
expect(hidden.media.last == true && hidden.scripts.contains(where:{$0.contains("__langformDiscardPlayables")}),"tab hide discards game contexts beyond native media suspension")
s.appEnteredBackground()
expect(!s.rotationHeld && s.rotationCancellations == 1,"background lifecycle relinquishes the Stage rotation coordinator")
expect(s.feedTabs.values.allSatisfy({$0.mediaSuspended == true && $0.webView.media.last == true}),"background suspends all retained feed previews")
expect(s.feedTabs.values.allSatisfy({$0.webView.suspensionDepth == 1}),"already inactive subscriptions must not acquire a second background hold")
let heldCounts = s.feedTabs.mapValues { $0.webView.media.count }
let visibilityCounts = s.feedTabs.mapValues { $0.webView.scripts.filter { $0.contains("langform-feed-visibility") }.count }
for _ in 0..<3 { s.appEnteredBackground() }
expect(s.feedTabs.allSatisfy({$0.value.webView.media.count == heldCounts[$0.key] && $0.value.webView.suspensionDepth == 1}),"repeated background is balanced for active and inactive tabs")
expect(s.feedTabs.allSatisfy({$0.value.active == false && $0.value.webView.scripts.filter { $0.contains("langform-feed-visibility") }.count == visibilityCounts[$0.key]}),"background stops feed script activity once without changing visible feed identity")
expect(s.feed.scripts.contains(where:{$0.contains("__langformDiscardPlayables")}) && s.player!.scripts.contains(where:{$0.contains("__langformDiscardPlayables")}),"background purges game frames in both surfaces")
expect(s.player!.media.isEmpty,"background game cleanup does not pause the owned video")
s.appBecameActive()
expect(s.motionSynchronizations == 1,"foreground also refreshes current motion preferences")
expect(s.feedTabs[0]!.mediaSuspended == false && s.feedTabs[1]!.mediaSuspended == true,"foreground restores only the active feed preview policy")
expect(s.feedTabs[0]!.webView.suspensionDepth == 0 && hidden.suspensionDepth == 1,"foreground releases exactly the active tab's hold")
s.activeTab = 1; s.appBecameActive()
expect(hidden.suspensionDepth == 0 && s.feedTabs[0]!.webView.suspensionDepth == 1,"activating formerly inactive subscriptions releases the sole retained hold")
for _ in 0..<2 { s.appEnteredBackground(); s.appEnteredBackground(); s.appBecameActive() }
expect(hidden.suspensionDepth == 0 && s.feedTabs[0]!.webView.suspensionDepth == 1,"repeated background/foreground never leaks an inactive-tab hold")
s.mode = .mini; s.setFeedActivity(s.feed,active:true)
expect(s.feedTabs[1]!.mediaSuspended == true && hidden.suspensionDepth == 1,"miniplayer still suspends feed previews exactly once")
s.mode = .closed; s.setFeedActivity(s.feed,active:true)
expect(hidden.suspensionDepth == 0,"closing miniplayer releases exactly the matching hold")
print("NATIVE_PLAYABLES_POLICY_OK")
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-playables-policy-'));
  try {
    const file = path.join(dir, 'Policy.swift'); fs.writeFileSync(file, code);
    const result = spawnSync(swift.stdout.trim(), [file], { encoding:'utf8', timeout:60000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_PLAYABLES_POLICY_OK/);
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});
