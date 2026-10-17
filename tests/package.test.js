const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");

test("Manifest ist Safari-taugliches MV3 für beide YouTube-Hosts", function () {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage", "nativeMessaging", "clipboardWrite"]);
  assert.deepEqual(manifest.background.scripts, ["src/background.js"]);
  assert.equal(manifest.background.service_worker, "src/background.js");
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://www.youtube.com/*",
    "https://m.youtube.com/*",
  ]);
  assert.equal(manifest.content_scripts[0].run_at, "document_start");
  assert.deepEqual(manifest.content_scripts[0].js, [
    "src/early.js",
    "src/logic.js",
    "src/hide.js",
    "src/controller.js",
    "src/summary.js",
    "src/ad-skip.js",
    "src/ads.js",
    "src/playback-shortcuts.js",
    "src/content.js",
  ]);
  assert.equal(manifest.content_scripts[1].world, "MAIN");
  assert.equal(manifest.content_scripts[1].run_at, "document_start");
  assert.deepEqual(manifest.content_scripts[1].js, ["src/page-adblock.js", "src/page-captions.js"]);
  assert.deepEqual(manifest.content_scripts[1].matches, manifest.content_scripts[0].matches);
  assert.deepEqual(manifest.web_accessible_resources[0].resources, ["src/page-captions.js"]);
  assert.equal(manifest.action.default_popup, "popup/popup.html");
  ["icon16.png", "icon32.png", "icon48.png", "icon128.png", "icon512.png"].forEach(function (name) {
    assert.ok(fs.existsSync(path.join(root, "extension/icons", name)), name);
  });
  const joined = JSON.stringify(manifest);
  assert.doesNotMatch(joined, /sidePanel|offscreen|declarativeNetRequest|identity|scripting/);
});

test("Popup und README sprechen Deutsch und nennen die Grenzen", function () {
  const popup = fs.readFileSync(path.join(root, "extension/popup/popup.html"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(popup, /lang="de"/);
  assert.match(popup, /Shorts blockieren/);
  assert.match(popup, /YouTube-App/);
  assert.match(readme, /YouTube-App/);
  assert.match(readme, /chrome:\/\/extensions/);
  assert.match(readme, /about:debugging/);
  assert.match(readme, /Einstellungen → Safari → Erweiterungen/);
  assert.match(readme, /7 Tage/);
  assert.match(readme, /m\.youtube\.com/);
  assert.match(readme, /Nicht signierte Erweiterungen erlauben/);
});

function swiftFunction(source, name) {
  const start = source.indexOf("func " + name + "(");
  assert.notEqual(start, -1, name);
  const next = source.indexOf("\n    func ", start + 1);
  const nextPrivate = source.indexOf("\n    private func ", start + 1);
  const nextOverride = source.indexOf("\n    override func ", start + 1);
  const nextObjc = source.indexOf("\n    @objc ", start + 1);
  const ends = [next, nextPrivate, nextOverride, nextObjc, source.length].filter(function (i) { return i > start; });
  return source.slice(start, Math.min.apply(null, ends));
}

test("Feed und Player sind zwei Webansichten, der Player fährt als Karte über den Feed", function () {
  assert.equal(fs.existsSync(path.join(root, "ios/Langform/Langform/PlayerFrame.js")), false);
  const app = fs.readFileSync(path.join(root, "ios/Langform/Langform/LangformApp.swift"), "utf8");
  assert.match(app, /Color\.black\.ignoresSafeArea/);
  assert.match(app, /ignoresSafeArea\(\.container, edges: \.all\)/, "Inline und Vollbild teilen eine bildschirmfüllende Stage");
  assert.doesNotMatch(app, /edges: fullscreen \?/, "Fullscreen darf keine zweite native Viewport-Ausdehnung auslösen");
  assert.doesNotMatch(app, /AVRoutePickerView|AVPlayer/);
  const web = fs.readFileSync(path.join(root, "ios/Langform/Langform/YouTubeWebView.swift"), "utf8");
  assert.match(web, /allowsBackForwardNavigationGestures = isFeed/, "Feed-Unterseiten behalten WebKit-Zurück, der Player seine Karten-Randgeste");
  assert.match(web, /allowsAirPlayForMediaPlayback = true/);
  assert.match(web, /allowsInlineMediaPlayback = true/);
  assert.match(web, /guard YouTubeWebView\.isAccountPage\(webView\.url\)/);
  assert.doesNotMatch(web, /PlayerFrame|viewport-fit|AVPlayer|googlevideo|GCKCastContext/);

  // Two web views on the same data store.
  assert.equal((web.match(/YouTubeWebView\.makeWebView\(/g) || []).length, 2);
  assert.match(web, /websiteDataStore = \.default\(\)/);
  assert.match(web, /"langformOpenWatch"/);
  assert.match(web, /"langformOpenFeed"/);
  assert.match(web, /"langformPlayer"/);
  assert.match(web, /"WebViewLinks"/);
  assert.match(web, /playerEarlyScriptNames = \["WatchBackgroundAudio", "PlaybackQuality"\]/);
  assert.match(web, /playerScriptNames = \["PlaybackZoom", "PlaybackSwipe", "PlaybackHold", "PlayerRect", "WatchAudio", "CaptionToggle", "PlayerSettings", "CommentsMotion", "CommentReactions", "FullscreenChapters", "FullscreenMotion", "DownloadSource", "SystemMedia", "SponsorBlock", "WatchTools"\]/);

  // The swipe is a pan that never cancels the tap on play and never navigates.
  assert.doesNotMatch(web, /UISwipeGestureRecognizer/);
  assert.match(web, /UIPanGestureRecognizer/);
  assert.match(web, /drag\.cancelsTouchesInView = false/);
  assert.match(web, /drag\.delaysTouchesBegan = false/);
  assert.match(web, /shouldRecognizeSimultaneouslyWith/);
  const begin = swiftFunction(web, "gestureRecognizerShouldBegin");
  // Direction, interruption and cancellation behavior is executed against the
  // shipping Swift policy in native-gesture-policy.test.js.
  assert.match(begin, /let entry = acceptsFullscreenEntry\(drag\) \? fullscreenEntryBinding\(\) : nil/);
  assert.match(begin, /fullscreenEntryAdmission = entry/);
  assert.match(begin, /let begins = entry != nil \|\| PlayerGesturePolicy\.canBegin\(/);
  // Touches are cancelled only once a picture-owned vertical gesture is recognized.
  assert.match(begin, /drag\.cancelsTouchesInView = begins/);
  assert.doesNotMatch(swiftFunction(web, "reveal"), /0\.6\b/);
  assert.doesNotMatch(web, /videoVisible/);
  // The drag sits outside WebKit's view tree and the page scroll waits for it.
  assert.match(web, /card\.addGestureRecognizer\(drag\)/);
  assert.doesNotMatch(web, /playerView\.addGestureRecognizer\(drag\)|player\.addGestureRecognizer\(drag\)/);
  // The public subtree failure relationship is executed from the shipping
  // delegate in native-player-priority.test.js, including inner WebKit input.
  assert.match(web, /shouldBeRequiredToFailBy otherGestureRecognizer/);
  // The card follows the finger.
  assert.match(swiftFunction(web, "follow"), /PlayerGesturePolicy\.trackedPose\(/);
  // Without a rect the card crops the top 16:9, never an empty mask.
  assert.match(web, /PlayerViewportPolicy\.fallbackPicture\(in: bounds\.size\)/);
  const dragged = swiftFunction(web, "dragPlayer");
  assert.doesNotMatch(dragged, /acceptsFullscreenEntry\(/, "accepted direction is not reclassified at began");
  assert.match(dragged, /fullscreenEntryAdmissionIsCurrent\(entry\)/, "source and state are checked again at began");
  const endDrag = swiftFunction(web, "endDrag");
  assert.match(endDrag, /revokeFullscreenEntryAdmission\(\)/, "general cleanup preserves revocation until contact terminal");
  assert.doesNotMatch(endDrag, /fullscreenEntryAdmissionRevoked = false/);
  const receive = swiftFunction(web, "gestureRecognizer");
  assert.match(receive, /guard gestureRecognizer === drag[\s\S]*fullscreenEntryAdmission = nil[\s\S]*fullscreenEntryAdmissionRevoked = false/);
  for (const hook of ["cancelVideoProbeForInactivity", "appEnteredBackground", "playerSceneBecameInactive"]) {
    assert.match(swiftFunction(web, hook), /revokeFullscreenEntryAdmission\(\)/, hook);
  }
  assert.match(swiftFunction(web, "playerSceneBecameInactive"), /scene === window\?\.windowScene[\s\S]*revokeFullscreenEntryAdmission/);
  assert.doesNotMatch(dragged, /goBack|history|load\(|evaluateJavaScript/);
  assert.doesNotMatch(dragged, /isScrollEnabled\s*=/, "der native Pan darf WebKit nicht zusätzlich per Scroll-Disable abbrechen");
  assert.match(dragged, /settle\(toMini \? \.mini : \.expanded/);

  // The card crops to the picture.
  const apply = swiftFunction(web, "apply");
  assert.match(apply, /let source = pictureRect/);
  assert.match(apply, /player\.transform = CGAffineTransform\(scaleX: scale, y: scale\)/);
  assert.doesNotMatch(apply, /player\.bounds|player\.frame|evaluateJavaScript/);

  // The decoded source owns the opening; the unpainted Watch loads behind it.
  const open = swiftFunction(web, "openWatch");
  assert.doesNotMatch(open, /UIView\.animate/);
  assert.match(open, /if opening\.fromFeed \{ insertSubview\(feed, aboveSubview: card\) \}/);
  assert.match(open, /beginLoading\(\)/);
  const loading = swiftFunction(web, "beginLoading");
  assert.match(loading, /insertSubview\(card, belowSubview: feed\)/);
  assert.match(swiftFunction(web, "considerReveal"), /\(loadFinished && loadHasVideo\) \|\| loadPainted/);
  assert.match(swiftFunction(web, "considerReveal"), /feedOpening\?\.landed != false/);
  assert.match(swiftFunction(web, "finishFeedOpeningIfReady"), /openingMotion\.hasVisiblePicture[\s\S]*startupStatus\.keepsStartupPoster/);
  const reveal = swiftFunction(web, "reveal");
  assert.match(reveal, /guard mode == \.loading/);
  assert.match(reveal, /insertSubview\(card, aboveSubview: feed\)/);
  assert.doesNotMatch(reveal, /UIViewPropertyAnimator/, "Watch erscheint ohne zweite native Eintrittsbewegung");

  // Card motion is a spring animator Core Animation drives on the display link.
  // A finger stops it where it is on screen and takes over from that progress.
  const settle = swiftFunction(web, "settle");
  assert.match(settle, /UISpringTimingParameters\(dampingRatio: [\d.]+, initialVelocity: CGVector/);
  assert.match(settle, /UIViewPropertyAnimator\(duration:/);
  assert.doesNotMatch(settle, /UIView\.animate|Timer|CADisplayLink|asyncAfter/);
  const freeze = swiftFunction(web, "freezeSettle");
  assert.match(freeze, /layer\.presentation\(\)/);
  assert.match(freeze, /stopAnimation\(true\)/);
  assert.match(dragged, /freezeSettle\(\)[\s\S]*dragOrigin = progress/);
  assert.doesNotMatch(dragged, /removeAllAnimations/);
  assert.match(swiftFunction(web, "follow"), /origin: dragOrigin, revealOffset: dragRevealOrigin/);
  // The opt-in, bounded fullscreen presentation logger is exercised in
  // native-fullscreen-presentation.test.js. Normal player motion has no loop.
  const normalPlayer = web.replace(swiftFunction(web, "startFullscreenPresentation"), "");
  assert.doesNotMatch(normalPlayer, /Timer\.scheduledTimer|CADisplayLink\(/);
  // While the card moves a new picture rect waits, so the crop never jumps under the finger.
  assert.match(swiftFunction(web, "takeVideoReport"), /if cardMoving \{\s*if valid \{ pendingRect = rect \}/);
  // Only the view on top owns the status-bar tap.
  assert.match(swiftFunction(web, "updateChrome"), /scrollsToTop/);
  const failed = swiftFunction(web, "handleFailure");
  assert.match(failed, /if webView === player \{[\s\S]*failPlayer\(\)\s*return/);
  assert.match(swiftFunction(web, "failPlayer"), /closePlayer\(\)[\s\S]*showLoadFailure\(\)/);
  const finished = web.slice(web.indexOf("didFinish navigation"), web.indexOf("didFail navigation"));
  assert.match(finished, /loadFinished = true/);

  // Close leaves the watch page; tapping the card expands it.
  const close = swiftFunction(web, "closePlayer");
  assert.match(close, /finishClose\(\)/);
  assert.match(swiftFunction(web, "finishClose"), /about:blank|blankURL/);
  assert.match(swiftFunction(web, "expandCard"), /settle\(\.expanded\)/);
  const collapse = swiftFunction(web, "collapseTapped");
  assert.match(collapse, /minimizePlayer\(\)/);
  assert.doesNotMatch(collapse, /videoPlaying|closePlayer\(\)/, "der Chevron verkleinert auch ein pausiertes Video");

  // Playback is only changed by PlayerRect's explicit mini-button action,
  // covered by interaction tests. Passive scripts never pause or stop a video.
  const sources = [web, app].concat(
    ["early", "logic", "hide", "controller", "summary", "page-captions", "ads"].map(function (name) {
      return fs.readFileSync(path.join(root, "extension/src", name + ".js"), "utf8");
    }),
    ["WebViewLinks", "ShortsBootstrap"].map(function (name) {
      return fs.readFileSync(path.join(root, "ios/Langform/Langform", name + ".js"), "utf8");
    })
  );
  sources.forEach(function (text) {
    assert.doesNotMatch(text, /\.pause\s*\(|(?:pauseVideo|stopVideo)\s*\(/);
  });
  sources.concat(fs.readFileSync(path.join(root, "ios/Langform/Langform/PlayerRect.js"), "utf8")).forEach(function (text) {
    assert.doesNotMatch(text, /video[\w.]*\.style\.(width|height|objectFit|display)\s*=/);
  });
  const model = fs.readFileSync(path.join(root, "ios/Langform/Langform/OnDeviceSummary.swift"), "utf8");
  assert.match(model, /FoundationModels/);
  assert.match(model, /Die Kurzfassung geht nur mit dem Modell auf dem Gerät/);
  const handler = fs.readFileSync(path.join(root, "native/SafariWebExtensionHandler.swift"), "utf8");
  assert.match(handler, /SafariWebExtensionHandler/);
  assert.match(handler, /sendNativeMessage|SFExtensionMessageKey/);
});

test("Konverter-Skript ist gültiges Bash und zielt auf Mac und iPhone", function () {
  const script = path.join(root, "scripts/convert-safari.sh");
  execFileSync("bash", ["-n", script], { stdio: "pipe" });
  const text = fs.readFileSync(script, "utf8");
  assert.match(text, /safari-web-extension-converter/);
  assert.match(text, /--swift/);
  assert.match(text, /de\.ipekkaya\.shorts-ausblenden/);
  assert.match(text, /SafariWebExtensionHandler\.swift/);
  assert.doesNotMatch(text, /--ios-only|--macos-only/);
  const stat = fs.statSync(script);
  assert.ok(stat.mode & 0o111, "convert-safari.sh ist ausführbar");
});
