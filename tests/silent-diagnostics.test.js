const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { JSDOM } = require("jsdom");
const app = path.join(__dirname, "../ios/Langform/Langform");
const source = fs.readFileSync(path.join(app, "SilentDiagnostics.js"), "utf8");

function page(t) {
  const dom = new JSDOM('<!doctype html><html><body><video id="existing"></video></body></html>', { url: "https://m.youtube.com/", runScripts: "outside-only" });
  const win = dom.window, doc = win.document, media = win.HTMLMediaElement.prototype;
  const values = new WeakMap(), writes = [], plays = [], persistence = [];
  function state(node) { if (!values.has(node)) values.set(node, { muted: false, volume: 1 }); return values.get(node); }
  // Controlled native getters/setters retain real HTMLMediaElement ownership.
  // Actual WebKit event scheduling and audible output need the offline runner.
  for (const key of ["muted", "volume"]) Object.defineProperty(media, key, { configurable: true,
    get() { return state(this)[key]; }, set(value) { state(this)[key] = value; writes.push({ node: this, key, value }); } });
  const result = Promise.resolve("native play result");
  media.play = function (...args) { plays.push({ node: this, muted: this.muted, volume: this.volume, args }); return result; };
  media.pause = () => assert.fail("silence must never pause playback");
  win.localStorage.setItem("yt-player-volume", "user-volume");
  win.sessionStorage.setItem("yt-player-quality", "user-quality");
  doc.cookie = "session=unchanged";
  for (const name of ["setItem", "removeItem", "clear"]) {
    const original = win.Storage.prototype[name];
    win.Storage.prototype[name] = function (...args) { persistence.push({ name, args }); return original.apply(this, args); };
  }
  t.after(() => { win.dispatchEvent(new win.Event("pagehide")); win.close(); });
  win.eval(source);
  return { win, doc, writes, plays, persistence, result,
    async flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); } };
}

function quiet(node) { assert.equal(node.muted, true); assert.equal(node.volume, 0); assert.equal(node.defaultMuted, true); }

test("Lautlose Diagnose stellt vorhandene Medien vor dem nativen Play-Aufruf stumm", t => {
  const p = page(t), video = p.doc.getElementById("existing");
  quiet(video);
  const returned = video.play("argument");
  assert.equal(returned, p.result, "Website behält originales Promise und Rückgabe");
  assert.equal(p.plays.length, 1);
  assert.deepEqual(p.plays[0].args, ["argument"]);
  assert.equal(p.plays[0].muted, true); assert.equal(p.plays[0].volume, 0);
});

test("Unmute- und Volume-Schreibversuche bleiben für Diagnose-Medien wirkungslos", t => {
  const p = page(t), video = p.doc.getElementById("existing");
  for (const value of [false, 0, null]) { video.muted = value; assert.equal(video.muted, true); }
  for (const value of [1, 0.7, 0.01]) { video.volume = value; assert.equal(video.volume, 0); }
  video.defaultMuted = false;
  video.dispatchEvent(new p.win.Event("volumechange"));
  quiet(video);
  assert.ok(p.writes.every(value => value.key === "muted" ? value.value === true : value.value === 0));
});

test("Neue, geklonte und per Parser eingefügte Video-/Audioelemente werden lautlos", async t => {
  const p = page(t), created = p.doc.createElement("video"), audio = p.doc.createElement("audio");
  quiet(created); quiet(audio);
  const wrapper = p.doc.createElement("div");
  wrapper.innerHTML = '<video id="parser-video"></video><audio id="parser-audio"></audio>';
  p.doc.body.appendChild(wrapper); await p.flush();
  quiet(p.doc.getElementById("parser-video")); quiet(p.doc.getElementById("parser-audio"));
  const cloned = p.doc.getElementById("existing").cloneNode(true);
  cloned.removeAttribute("muted");
  cloned.play();
  assert.equal(p.plays.at(-1).muted, true); assert.equal(p.plays.at(-1).volume, 0);
});

test("BFCache startet die Beobachtung erneut und erneute Injection erzeugt keine Play-Wrapper-Kette", async t => {
  const p = page(t), play = p.win.HTMLMediaElement.prototype.play;
  p.win.eval(source); assert.equal(p.win.HTMLMediaElement.prototype.play, play);
  p.win.dispatchEvent(new p.win.Event("pagehide"));
  p.doc.body.insertAdjacentHTML("beforeend", '<video id="after-restore"></video>');
  const restored = p.doc.getElementById("after-restore");
  p.win.dispatchEvent(new p.win.Event("pageshow")); await p.flush(); quiet(restored);
  restored.play(); assert.equal(p.plays.length, 1);
});

test("Stummschaltung verändert keine gespeicherte Nutzerwahl, Cookies oder normale Seiten", async t => {
  const p = page(t);
  p.doc.getElementById("existing").play(); await p.flush();
  assert.deepEqual(p.persistence, []);
  assert.equal(p.win.localStorage.getItem("yt-player-volume"), "user-volume");
  assert.equal(p.win.sessionStorage.getItem("yt-player-quality"), "user-quality");
  assert.equal(p.doc.cookie, "session=unchanged");
  const normal = new JSDOM('<video></video>', { url: "https://m.youtube.com/", runScripts: "outside-only" });
  t.after(() => normal.window.close());
  const video = normal.window.document.querySelector("video");
  assert.equal(video.muted, false); assert.equal(video.volume, 1);
});

test("Ein Website-volumechange-Listener kann den Diagnose-Mute nicht als Nutzerwahl speichern", t => {
  const p = page(t), video = p.doc.getElementById("existing"), attempts = [];
  // YouTube's player g.l7/Bo path writes this exact key without a prefix.
  // It stores a JSON-stringified volume choice inside its Storage envelope.
  video.addEventListener("volumechange", () => {
    const data = JSON.stringify({ volume: Math.floor(video.volume * 100), muted: video.muted });
    for (const [name, storage] of [["session", p.win.sessionStorage], ["local", p.win.localStorage]]) {
      const record = { data, creation: 1234 };
      if (name === "local") record.expiration = 2592001234;
      attempts.push({ name, record });
      storage.setItem("yt-player-volume", JSON.stringify(record));
    }
  });
  video.muted = false; video.volume = 0.8;
  video.dispatchEvent(new p.win.Event("volumechange"));
  assert.equal(attempts.length, 2, "Website-Listener wurde tatsächlich aufgerufen");
  assert.ok(attempts.every(({ record }) => JSON.parse(record.data).muted && JSON.parse(record.data).volume === 0));
  assert.equal(p.win.localStorage.getItem("yt-player-volume"), "user-volume");
  assert.equal(p.win.sessionStorage.getItem("yt-player-volume"), null, "fehlende Wahl bleibt fehlend");
  assert.deepEqual(p.persistence, [], "kein vorübergehender Write mit späterem Restore");
  quiet(video);
});

test("Der Diagnose-Storage-Schutz betrifft nur den exakten Volume-Schlüssel und bleibt idempotent", t => {
  const p = page(t), setItem = p.win.Storage.prototype.setItem;
  p.win.eval(source);
  assert.equal(p.win.Storage.prototype.setItem, setItem, "erneute Injection erzeugt keine Wrapper-Kette");
  for (const key of ["yt-player-quality", "yt-player-bandwidth", "yt-player-audio-quality-setting", "yt-player-volume-other", "foreign-volume"]) {
    p.win.localStorage.setItem(key, "changed");
    assert.equal(p.win.localStorage.getItem(key), "changed");
  }
  p.win.localStorage.removeItem("foreign-volume");
  assert.equal(p.win.localStorage.getItem("foreign-volume"), null);
  assert.equal(p.persistence.length, 6);
  const normal = new JSDOM('<video></video>', { url: "https://m.youtube.com/", runScripts: "outside-only" });
  t.after(() => normal.window.close());
  for (const storage of [normal.window.localStorage, normal.window.sessionStorage]) {
    storage.setItem("yt-player-volume", "normal-user-choice");
    assert.equal(storage.getItem("yt-player-volume"), "normal-user-choice");
  }
});

test("Native Injection ist nur bei expliziter Diagnose aktiv, vor anderen Skripten und in allen Frames", { skip: process.platform !== "darwin", timeout: 70000 }, t => {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  const native = fs.readFileSync(path.join(app, "YouTubeWebView.swift"), "utf8");
  const beginning = native.indexOf("if StartupDiagnostics.enabled && !audibleVideoProbe && !audibleRouteProbe {");
  assert.match(native, /let audibleVideoProbe = !isFeed && VideoLoadProbe\(\)\?\.requestsAudibleUserOpen == true/);
  assert.ok(beginning >= 0);
  let depth = 1, end = native.indexOf("{", beginning) + 1;
  while (depth && end < native.length) { if (native[end] === "{") depth++; if (native[end] === "}") depth--; end++; }
  assert.equal(depth, 0);
  const motion = native.indexOf('let motionBootstrapScript = WKUserScript(source: LangformMotion.bootstrapSource');
  const motionInstalled = native.indexOf('addUserScript(motionBootstrapScript)');
  const bundle = native.indexOf('let source = quietBootstrap + concatenatedScripts(scripts)');
  assert.ok(motion >= 0 && end < motion && motion < motionInstalled && motionInstalled < bundle,
    "Diagnostic vor separat aktualisierbaren Motionrollen; Rollen vor ihren Verbrauchern");
  const names = ["scriptNames", "playerEarlyScriptNames", "playerScriptNames", "feedOnlyScriptNames"];
  for (const property of names) assert.equal(JSON.parse(native.match(new RegExp("static let " + property + " = (\\[[^\\]]+\\])"))[1]).includes("SilentDiagnostics"), false);
  const swift = `import Foundation
enum StartupDiagnostics { static var enabled = false }
struct WKUserScript {
 enum InjectionTime { case atDocumentStart, atDocumentEnd }; enum World { case page }
 let source: String, injectionTime: InjectionTime, forMainFrameOnly: Bool, world: World
 init(source: String, injectionTime: InjectionTime, forMainFrameOnly: Bool, in world: World) {
  self.source=source; self.injectionTime=injectionTime; self.forMainFrameOnly=forMainFrameOnly; self.world=world
 }
}
class Controller { var scripts: [WKUserScript] = []; func addUserScript(_ script: WKUserScript) { scripts.append(script) } }
struct Configuration { let userContentController = Controller() }
func readScripts(_ names: [String]) -> String { names.joined(separator: ",") }
func inject(_ configuration: Configuration, audibleVideoProbe: Bool = false, audibleRouteProbe: Bool = false) { ${native.slice(beginning, end)} }
let normal = Configuration(); inject(normal)
precondition(normal.userContentController.scripts.isEmpty, "normal launch has no silent injection")
StartupDiagnostics.enabled = true
let diagnostic = Configuration(); inject(diagnostic)
precondition(diagnostic.userContentController.scripts.count == 1)
let script = diagnostic.userContentController.scripts[0]
precondition(script.source == "SilentDiagnostics" && script.injectionTime == .atDocumentStart && !script.forMainFrameOnly && script.world == .page)
let audibleDiagnostic = Configuration(); inject(audibleDiagnostic, audibleVideoProbe: true)
precondition(audibleDiagnostic.userContentController.scripts.isEmpty, "the separately authorized main-player audio test must observe actual mute state")
print("SILENT_INJECTION_OK")
`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-silent-injection-"));
  try {
    const file = path.join(directory, "main.swift"); fs.writeFileSync(file, swift);
    const result = spawnSync(compiler.stdout.trim(), [file], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /SILENT_INJECTION_OK/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
