const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");

test("Manifest ist Safari-taugliches MV3 für beide YouTube-Hosts", function () {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.background, undefined);
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
    "src/content.js",
  ]);
  assert.equal(manifest.content_scripts[1].world, "MAIN");
  assert.equal(manifest.content_scripts[1].run_at, "document_start");
  assert.deepEqual(manifest.content_scripts[1].js, ["src/page-captions.js"]);
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
  assert.doesNotMatch(app, /YouTubeWebView[\s\S]{0,280}ignoresSafeArea/);
  assert.doesNotMatch(app, /AVRoutePickerView|AVPlayer/);
  const web = fs.readFileSync(path.join(root, "ios/Langform/Langform/YouTubeWebView.swift"), "utf8");
  assert.match(web, /allowsBackForwardNavigationGestures = true/);
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
  assert.match(web, /playerScriptNames = \["PlayerRect"\]/);

  // The swipe is a pan that never cancels the tap on play and never navigates.
  assert.doesNotMatch(web, /UISwipeGestureRecognizer/);
  assert.match(web, /UIPanGestureRecognizer/);
  assert.match(web, /drag\.cancelsTouchesInView = false/);
  assert.match(web, /drag\.delaysTouchesBegan = false/);
  assert.match(web, /shouldRecognizeSimultaneouslyWith/);
  const begin = swiftFunction(web, "gestureRecognizerShouldBegin");
  assert.match(begin, /move\.y > abs\(move\.x\) \* 2/);
  assert.match(begin, /videoVisible/);
  const dragged = swiftFunction(web, "dragPlayer");
  assert.doesNotMatch(dragged, /goBack|history|load\(|evaluateJavaScript/);
  assert.match(dragged, /settle\(toMini \? \.mini : \.expanded/);

  // The card crops to the video's rect and only exists with one.
  const settle = swiftFunction(web, "settle");
  assert.match(settle, /target == \.mini && !hasVideoRect/);
  const apply = swiftFunction(web, "apply");
  assert.match(apply, /videoRect/);
  assert.match(apply, /player\.transform = CGAffineTransform\(scaleX: scale, y: scale\)/);
  assert.doesNotMatch(apply, /player\.bounds|player\.frame|evaluateJavaScript/);

  // Close leaves the watch page; tapping the card expands it.
  const close = swiftFunction(web, "closePlayer");
  assert.match(close, /about:blank|blankURL/);
  assert.match(swiftFunction(web, "expandCard"), /settle\(\.expanded\)/);
  const collapse = swiftFunction(web, "collapseTapped");
  assert.match(collapse, /videoPlaying/);
  assert.match(collapse, /closePlayer\(\)/);

  // Neither Swift nor the page scripts pause the video or style it.
  const sources = [web, app].concat(
    ["early", "logic", "hide", "controller", "summary", "page-captions"].map(function (name) {
      return fs.readFileSync(path.join(root, "extension/src", name + ".js"), "utf8");
    }),
    ["WebViewLinks", "PlayerRect", "ShortsBootstrap"].map(function (name) {
      return fs.readFileSync(path.join(root, "ios/Langform/Langform", name + ".js"), "utf8");
    })
  );
  sources.forEach(function (text) {
    assert.doesNotMatch(text, /\.pause\(\)|pauseVideo|stopVideo/);
    assert.doesNotMatch(text, /video[\w.]*\.style\.(width|height|objectFit|display)\s*=/);
  });
  const model = fs.readFileSync(path.join(root, "ios/Langform/Langform/OnDeviceSummary.swift"), "utf8");
  assert.match(model, /FoundationModels/);
  assert.match(model, /Die Kurzfassung geht nur mit dem Modell auf dem Gerät/);
  assert.match(model, /drei bis sechs Merksätze/);
  assert.match(model, /\["summary": \["points": points\]\]/);
  const handler = fs.readFileSync(path.join(root, "native/SafariWebExtensionHandler.swift"), "utf8");
  assert.match(handler, /SafariWebExtensionHandler/);
  assert.match(handler, /sendNativeMessage|SFExtensionMessageKey/);
  assert.match(handler, /drei bis sechs Merksätze/);
  assert.match(handler, /\["summary": \["points": points\]\]/);
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
