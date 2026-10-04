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

test("die App setzt kein eigenes Layout auf den YouTube-Player", function () {
  assert.equal(fs.existsSync(path.join(root, "ios/Langform/Langform/PlayerFrame.js")), false);
  const app = fs.readFileSync(path.join(root, "ios/Langform/Langform/LangformApp.swift"), "utf8");
  assert.match(app, /watchPage/);
  assert.doesNotMatch(app, /topLeading/);
  assert.match(app, /bottomLeading/);
  assert.match(app, /Color\.black\.ignoresSafeArea/);
  assert.doesNotMatch(app, /YouTubeWebView[\s\S]{0,280}ignoresSafeArea/);
  const web = fs.readFileSync(path.join(root, "ios/Langform/Langform/YouTubeWebView.swift"), "utf8");
  assert.match(web, /allowsBackForwardNavigationGestures = true/);
  assert.match(web, /isWatchPage/);
  assert.doesNotMatch(web, /PlayerFrame|viewport-fit/);
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
