const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Externe YouTube-Links normalisieren Video-/Feedrouten und verwerfen fremde oder mehrdeutige Eingaben", {
  skip: process.platform !== "darwin", timeout: 70000,
}, t => {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  // Execute the unmodified production policy rather than a JavaScript copy.
  const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/ExternalYouTubeLink.swift"), "utf8");
  const exercise = String.raw`
var checks = 0
func expect(_ condition: Bool, _ message: String) {
    checks += 1
    if !condition { print("FAILED: " + message); exit(1) }
}
func accepted(_ raw: String, _ output: String, _ destination: ExternalYouTubeLink.Destination = .video) {
    do {
        let link = try ExternalYouTubeLink.parse(raw)
        expect(link.url.absoluteString == output, raw + " → " + link.url.absoluteString)
        expect(link.destination == destination, "destination: " + raw)
    } catch { expect(false, raw + " rejected: " + error.localizedDescription) }
}
func rejected(_ raw: String) {
    do { _ = try ExternalYouTubeLink.parse(raw); expect(false, "unsafe/unsupported link accepted: " + raw) }
    catch { expect(true, "rejected") }
}
accepted("https://youtu.be/M7lc1UVf-VE?si=tracking&t=1m2s", "https://m.youtube.com/watch?v=M7lc1UVf-VE&t=62")
accepted(" https://www.youtube.com/watch?v=aqz-KE-bpKQ&feature=shared&start=8 ", "https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=8")
accepted("http://youtube.com/watch?v=aqz-KE-bpKQ#t=1h2m3s", "https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=3723")
accepted("https://www.youtu.be/aqz-KE-bpKQ?t=0", "https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=0")
accepted("https://youtube.com/shorts/aqz-KE-bpKQ?si=remove", "https://m.youtube.com/watch?v=aqz-KE-bpKQ")
accepted("https://youtube.com/live/aqz-KE-bpKQ?start=12", "https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=12")
accepted("https://youtube.com/embed/aqz-KE-bpKQ?autoplay=1", "https://m.youtube.com/watch?v=aqz-KE-bpKQ")
accepted("https://youtube.com/watch?v=aqz-KE-bpKQ&list=PL_123-45&index=02&t=9", "https://m.youtube.com/watch?v=aqz-KE-bpKQ&list=PL_123-45&index=2&t=9")
accepted("langform://watch?v=aqz-KE-bpKQ&t=12", "https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=12")
accepted("langform://open?url=https%3A%2F%2Fyoutu.be%2Faqz-KE-bpKQ%3Ft%3D7", "https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=7")
accepted("https://youtube.com/playlist?list=PL_123-45&si=removed", "https://m.youtube.com/playlist?list=PL_123-45", .feed)
accepted("https://youtube.com/@NASA?si=removed", "https://m.youtube.com/@NASA", .feed)
accepted("https://youtube.com/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ", "https://m.youtube.com/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ", .feed)
accepted("https://youtube.com/user/NASA", "https://m.youtube.com/user/NASA", .feed)
accepted("https://youtube.com/c/NASA", "https://m.youtube.com/c/NASA", .feed)
accepted("https://youtube.com/feed/subscriptions", "https://m.youtube.com/feed/subscriptions", .feed)
accepted("https://youtube.com/feed/library", "https://m.youtube.com/feed/library", .feed)
accepted("https://youtube.com", "https://m.youtube.com/", .feed)
accepted("https://www.youtube.com/post/Ugkx_ABC-123?si=tracking", "https://m.youtube.com/post/Ugkx_ABC-123", .feed)
accepted("https://youtube.com/@NASA/videos?view=0", "https://m.youtube.com/@NASA/videos", .feed)
accepted("https://youtube.com/@NASA/community", "https://m.youtube.com/@NASA/community", .feed)
accepted("https://youtube.com/@NASA/posts", "https://m.youtube.com/@NASA/posts", .feed)
accepted("https://youtube.com/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ/streams", "https://m.youtube.com/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ/streams", .feed)
accepted("https://youtube.com/user/NASA/playlists", "https://m.youtube.com/user/NASA/playlists", .feed)
accepted("https://youtube.com/c/NASA/about", "https://m.youtube.com/c/NASA/about", .feed)
for raw in [
    "", "not a link", "youtu.be/aqz-KE-bpKQ", "javascript:alert(1)", "file:///etc/passwd",
    "https://youtube.com.evil.invalid/watch?v=aqz-KE-bpKQ", "https://evil.youtube.com/watch?v=aqz-KE-bpKQ",
    "https://youtube.com@evil.invalid/watch?v=aqz-KE-bpKQ", "https://user:secret@youtube.com/watch?v=aqz-KE-bpKQ",
    "https://youtube.com:443/watch?v=aqz-KE-bpKQ", "https://youtu.be/tooShort", "https://youtu.be/aqz-KE-bpKQ/extra",
    "https://youtube.com/watch?v=aqz-KE-bpKQ&v=M7lc1UVf-VE", "https://youtube.com/watch?v=aqz-KE-bpKQ&t=1&t=2",
    "https://youtube.com/watch?v=aqz-KE-bpKQ&t=-1", "https://youtube.com/watch?v=aqz-KE-bpKQ&t=9999999999999999999999h",
    "https://youtube.com/watch?v=aqz-KE-bpKQ&t=2s1m", "https://youtube.com/watch?v=aqz-KE-bpKQ&t=604801",
    "https://youtube.com/watch?v=aqz-KE-bpKQ&t=2%0A", "https://youtube.com/watch?v=aqz-KE-bpKQ%0A",
    "https://youtube.com/watch?v=aqz-KE-bpKQ&list=PL_ok%0A", "https://youtube.com/playlist?list=bad%2Fpath",
    "https://youtube.com/redirect?q=https://evil.invalid", "https://youtube.com/attribution_link?u=%2Fwatch%3Fv%3Daqz-KE-bpKQ",
    "https://youtube.com/post/", "https://youtube.com/post/Ug", "https://youtube.com/post/UgABC/extra",
    "https://youtube.com/post/UgABC%0A", "https://youtube.com/post/UgABC%2Fextra",
    "https://youtube.com/@NASA/logout", "https://youtube.com/@NASA/videos/extra", "https://youtube.com/channel/NASA/delete",
    "https://youtube.com/channel/NASA/videos/extra", "https://youtube.com/logout", "https://youtube.com/account_switcher", "https://youtube.com/playables",
    "langform://open?url=langform%3A%2F%2Fopen%3Furl%3Dhttps%3A%2F%2Fyoutube.com",
    "langform://open?url=https%3A%2F%2Fyoutube.com&url=https%3A%2F%2Fevil.invalid",
    "langform://open/path?url=https%3A%2F%2Fyoutube.com", "langform://evil?url=https%3A%2F%2Fyoutube.com",
    "https://youtube.com/\nwatch?v=aqz-KE-bpKQ", String(repeating: "x", count: 8193)
] { rejected(raw) }
print("EXTERNAL_LINK_POLICY_OK checks=\(checks)")
`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-links-test-"));
  try {
    const script = path.join(directory, "ExternalLinks.swift");
    fs.writeFileSync(script, source + "\n" + exercise);
    const result = spawnSync(compiler.stdout.trim(), ["-module-cache-path", path.join(directory, "cache"), script], {
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /EXTERNAL_LINK_POLICY_OK checks=92/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("Native Linkübergabe verbraucht jede Anfrage einmal und übernimmt neue Playlists auch während eines Ladevorgangs", {
  skip: process.platform !== "darwin", timeout: 70000,
}, t => {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  const appPath = path.join(__dirname, "../ios/Langform/Langform");
  const policy = fs.readFileSync(path.join(appPath, "ExternalYouTubeLink.swift"), "utf8");
  const stage = fs.readFileSync(path.join(appPath, "YouTubeWebView.swift"), "utf8");
  const start = stage.indexOf("    func acceptExternalLink(");
  assert.ok(start >= 0);
  let depth = 1, end = stage.indexOf("{", start) + 1;
  while (depth && end < stage.length) {
    if (stage[end] === "{") depth++;
    if (stage[end] === "}") depth--;
    end++;
  }
  assert.equal(depth, 0);
  const acceptance = stage.slice(start, end);
  const exercise = String.raw`
struct ExternalLinkInbox {
    struct Request { let id = UUID(); let link: ExternalYouTubeLink }
}
enum YouTubeWebView {
    static func videoID(_ url: URL?) -> String? {
        guard let url else { return nil }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "v" }?.value
    }
}
struct Player { var url: URL? }
final class Harness {
    enum Mode { case closed, loading, expanded, mini }
    var feed: Int? = 1
    var player: Player?
    var mode: Mode = .closed
    var loadingVideoID: String?
    var lastWatchURL: URL?
    var acceptedExternalLinkID: UUID?
    var events: [String] = []
    func cancelDownloadSourceRequest() {}
    func cancelPendingFeedSearch() { events.append("cancelSearch") }
    func discardFeedOpening() { events.append("discardOpening") }
    func closePlayer() { events.append("close"); mode = .closed }
    func showInFeed(_ url: URL) { events.append("feed:" + url.absoluteString) }
    func openWatch(_ url: URL, userInitiated: Bool) {
        // Recording stand-in reproduces only the existing same-video admission
        // boundary. The test executes the production acceptance method above.
        let currentID = mode == .loading ? loadingVideoID : YouTubeWebView.videoID(player?.url)
        if mode != .closed && currentID == YouTubeWebView.videoID(url) {
            events.append("reuse"); return
        }
        events.append(userInitiated ? "open-user" : "open-passive")
        mode = .loading; lastWatchURL = url; loadingVideoID = YouTubeWebView.videoID(url)
    }
ACCEPTANCE_METHOD
}
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }
func request(_ path: String) -> ExternalLinkInbox.Request {
    ExternalLinkInbox.Request(link: try! ExternalYouTubeLink.parse("https://youtube.com/" + path))
}
let stage = Harness()
let first = request("watch?v=aqz-KE-bpKQ&list=PL_A")
stage.feed = nil; stage.acceptExternalLink(first)
expect(stage.events.isEmpty && stage.acceptedExternalLinkID == nil, "unstarted stage must retain request")
stage.feed = 1; stage.acceptExternalLink(first)
expect(stage.events == ["cancelSearch", "open-user"], "cold request uses ordinary user-open route")
stage.acceptExternalLink(first)
expect(stage.events.count == 2, "SwiftUI rerender must not replay consumed request")
stage.events = []; stage.acceptExternalLink(request("watch?v=aqz-KE-bpKQ&list=PL_A&t=8"))
expect(stage.events == ["cancelSearch", "reuse"], "same playlist keeps same loading request")
stage.events = []; stage.acceptExternalLink(request("watch?v=aqz-KE-bpKQ&list=PL_B&t=12"))
expect(stage.events == ["cancelSearch", "discardOpening", "close", "open-user"], "new playlist must bypass same-video loading shortcut")
expect(stage.lastWatchURL?.query?.contains("list=PL_B") == true, "new list belongs to new watch request")
stage.events = []; stage.player = Player(url: stage.lastWatchURL); stage.mode = .expanded
stage.acceptExternalLink(request("watch?v=aqz-KE-bpKQ&t=20"))
expect(stage.events == ["cancelSearch", "reuse"], "plain same-video timestamp preserves existing media")
stage.events = []; stage.acceptExternalLink(request("@NASA"))
expect(stage.events == ["cancelSearch", "discardOpening", "close", "feed:https://m.youtube.com/@NASA"], "browse entry retires watch before changing feed")
stage.events = []
let unsafe = ExternalLinkInbox.Request(link: ExternalYouTubeLink(url: URL(string: "https://evil.invalid/watch?v=aqz-KE-bpKQ")!, destination: .video))
stage.acceptExternalLink(unsafe)
expect(stage.events.isEmpty && stage.acceptedExternalLinkID != unsafe.id, "forged internal request cannot bypass URL validation")
print("EXTERNAL_LINK_HANDOFF_OK")
`.replace("ACCEPTANCE_METHOD", acceptance);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-link-handoff-"));
  try {
    const script = path.join(directory, "Handoff.swift");
    fs.writeFileSync(script, policy + "\n" + exercise);
    const result = spawnSync(compiler.stdout.trim(), ["-module-cache-path", path.join(directory, "cache"), script], {
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /EXTERNAL_LINK_HANDOFF_OK/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});


test("Vorkonfigurierter Kopier-Kurzbefehl nimmt nur die bewusste aktuelle Eingabe an und wiederholt gültige Absichten", {
  skip: process.platform !== "darwin", timeout: 70000,
}, t => {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  const appPath = path.join(__dirname, "../ios/Langform/Langform");
  const policy = fs.readFileSync(path.join(appPath, "ExternalYouTubeLink.swift"), "utf8");
  const entry = fs.readFileSync(path.join(appPath, "ExternalLinkInbox.swift"), "utf8");
  function declaration(start) {
    assert.ok(start >= 0); const open = entry.indexOf("{", start); let depth = 1, end = open + 1;
    while (depth && end < entry.length) { if (entry[end] === "{") depth++; if (entry[end] === "}") depth--; end++; }
    assert.equal(depth, 0); return entry.slice(start, end);
  }
  const inbox = declaration(entry.indexOf("@MainActor\nfinal class ExternalLinkInbox"));
  const intentStart = entry.indexOf("struct OpenCopiedYouTubeLinkIntent");
  const action = declaration(entry.indexOf("    @MainActor\n    func perform()", intentStart));
  // Keep the real admission body; only the framework's empty IntentResult is
  // represented by a Bool so this policy test can run without UIKit/AppIntents.
  const performed = action.replace("some IntentResult", "Bool").replace("return .result()", "return true");
  const exercise = String.raw`
protocol ObservableObject {}
@propertyWrapper struct Published<Value> { var wrappedValue: Value }
@MainActor final class UIPasteboard { static let general = UIPasteboard(); var string: String?; var url: URL? }
INBOX
struct Intent { ACTION }
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }
Task { @MainActor in
    let intent = Intent(), inbox = ExternalLinkInbox.shared
    expect(inbox.request == nil, "launch alone must not read or open clipboard")
    UIPasteboard.general.string = "https://youtu.be/aqz-KE-bpKQ?t=8"
    do { _ = try await intent.perform() } catch { expect(false, "copied video rejected") }
    let first = inbox.request!.id
    expect(inbox.request?.link.url.absoluteString == "https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=8", "copied video uses strict common policy")
    do { _ = try await intent.perform() } catch { expect(false, "repeat rejected") }
    expect(inbox.request?.id != first, "a second deliberate shortcut invocation is a new user intention")
    let current = inbox.request!.id
    for copied in [nil, "", "https://evil.invalid/watch?v=aqz-KE-bpKQ", "not a link"] as [String?] {
        UIPasteboard.general.string = copied; UIPasteboard.general.url = nil
        do { _ = try await intent.perform(); expect(false, "invalid copied content accepted") } catch {}
        expect(inbox.request?.id == current, "invalid clipboard must not replace current request")
    }
    UIPasteboard.general.string = nil; UIPasteboard.general.url = URL(string: "https://youtube.com/post/UgkABC?si=removed")
    do { _ = try await intent.perform() } catch { expect(false, "URL clipboard fallback rejected") }
    expect(inbox.request?.link.destination == .feed && inbox.request?.link.url.absoluteString == "https://m.youtube.com/post/UgkABC", "URL clipboard uses current feed policy")
    print("COPIED_LINK_INTENT_OK"); exit(0)
}
dispatchMain()
`.replace("INBOX", inbox).replace("ACTION", performed);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-copied-link-"));
  try {
    const script = path.join(directory, "CopiedLink.swift"); fs.writeFileSync(script, policy + "\n" + exercise);
    const result = spawnSync(compiler.stdout.trim(), ["-module-cache-path", path.join(directory, "cache"), script], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error)); assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /COPIED_LINK_INTENT_OK/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
