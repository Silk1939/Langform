const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Explizit kopierte WhatsApp-Nachrichten öffnen genau einen vollständigen geprüften YouTube-Link", {
  skip: process.platform !== "darwin", timeout: 70000,
}, t => {
  const compiler = spawnSync("/usr/bin/xcrun", ["--find", "swift"], { encoding: "utf8" });
  if (compiler.status !== 0) return t.skip("Swift-Toolchain nicht verfügbar");
  const policy = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/ExternalYouTubeLink.swift"), "utf8");
  const entry = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/ExternalLinkInbox.swift"), "utf8");
  function declaration(start) {
    assert.ok(start >= 0);
    const open = entry.indexOf("{", start); let depth = 1, end = open + 1;
    while (depth && end < entry.length) { if (entry[end] === "{") depth++; if (entry[end] === "}") depth--; end++; }
    assert.equal(depth, 0); return entry.slice(start, end);
  }
  const inbox = declaration(entry.indexOf("@MainActor\nfinal class ExternalLinkInbox"));
  const action = declaration(entry.indexOf("    @MainActor\n    func perform()", entry.indexOf("struct OpenCopiedYouTubeLinkIntent")))
    .replace("some IntentResult", "Bool").replace("return .result()", "return true");
  const exercise = String.raw`
var checks = 0
func expect(_ value: Bool, _ message: String) { checks += 1; if !value { print("FAILED: " + message); exit(1) } }
func shared(_ text: String, _ expected: String) {
    do { let link = try ExternalYouTubeLink.parseSharedText(text); expect(link.url.absoluteString == expected, "wrong shared link: " + text) }
    catch { expect(false, "shared link rejected: " + text + ": " + error.localizedDescription) }
}
func rejected(_ text: String) {
    do { _ = try ExternalYouTubeLink.parseSharedText(text); expect(false, "unsafe or ambiguous shared link: " + text) }
    catch { expect(true, "rejected") }
}
shared("Schau mal:\nhttps://youtu.be/aqz-KE-bpKQ?si=tracking&t=1m2s", "https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=62")
shared("Titel – https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=8", "https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=8")
shared("Hier (https://youtu.be/aqz-KE-bpKQ).", "https://m.youtube.com/watch?v=aqz-KE-bpKQ")
shared("Kanal:\thttps://youtube.com/@NASA/posts", "https://m.youtube.com/@NASA/posts")
shared("https://youtu.be/aqz-KE-bpKQ", "https://m.youtube.com/watch?v=aqz-KE-bpKQ")
shared("langform://watch?v=aqz-KE-bpKQ&t=12", "https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=12")
shared("langform://share?text=Schau%20mal%3A%0Ahttps%3A%2F%2Fyoutu.be%2Faqz-KE-bpKQ%3Ft%3D21", "https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=21")
for text in [
    "Schau mal: youtu.be/aqz-KE-bpKQ", "Schau mal: https://youtube.com.evil.invalid/watch?v=aqz-KE-bpKQ",
    "https://evil.invalid/https://youtu.be/aqz-KE-bpKQ", "https://youtube.com@evil.invalid/watch?v=aqz-KE-bpKQ",
    "Schau mal: https://youtube.com/watch?v=aqz-KE-bpKQ&v=M7lc1UVf-VE",
    "Schau mal: https://youtube.com/watch?v=aqz-KE-bpKQ&t=1&t=2",
    "https://youtu.be/aqz-KE-bpKQ https://youtu.be/M7lc1UVf-VE",
    "https://youtu.be/aqz-KE-bpKQ https://evil.invalid",
    "https://youtu.be/aqz-KE-bpKQ jemand@example.com",
    "https://youtu.be/aqz-KE-bpKQ\u{0000}", String(repeating: "x", count: 8193), "Kein Link",
    "langform://share?text=langform%3A%2F%2Fshare%3Ftext%3Dx",
    "langform://share?text=https%3A%2F%2Fyoutu.be%2Faqz-KE-bpKQ&text=https%3A%2F%2Fyoutu.be%2FM7lc1UVf-VE"
] { rejected(text) }
do { _ = try ExternalYouTubeLink.parse("Schau mal:\nhttps://youtu.be/aqz-KE-bpKQ"); expect(false, "system URL route must stay strict") }
catch { expect(true, "strict route rejected message") }
protocol ObservableObject {}
@propertyWrapper struct Published<Value> { var wrappedValue: Value }
@MainActor final class UIPasteboard { static let general = UIPasteboard(); var string: String?; var url: URL? }
INBOX
struct Intent { ACTION }
Task { @MainActor in
    let intent = Intent(), inbox = ExternalLinkInbox.shared
    expect(inbox.request == nil, "app launch must not read clipboard")
    UIPasteboard.general.string = "Aus WhatsApp:\nhttps://youtu.be/aqz-KE-bpKQ?t=12"
    do { _ = try await intent.perform() } catch { expect(false, "copied WhatsApp message rejected") }
    expect(inbox.request?.link.url.absoluteString == "https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=12", "shortcut uses shared-text policy")
    let first = inbox.request!.id
    UIPasteboard.general.string = "https://youtu.be/aqz-KE-bpKQ https://youtu.be/M7lc1UVf-VE"
    do { _ = try await intent.perform(); expect(false, "ambiguous clipboard accepted") } catch {}
    expect(inbox.request?.id == first, "rejected paste preserves current request")
    UIPasteboard.general.string = "https://youtu.be/aqz-KE-bpKQ?t=12"
    do { _ = try await intent.perform() } catch { expect(false, "repeat rejected") }
    expect(inbox.request?.id != first, "deliberate repeat is new request")
    print("SHARED_LINK_POLICY_OK checks=\(checks)"); exit(0)
}
dispatchMain()
`.replace("INBOX", inbox).replace("ACTION", action);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "langform-shared-link-"));
  try {
    const script = path.join(directory, "SharedLink.swift"); fs.writeFileSync(script, policy + "\n" + exercise);
    const result = spawnSync(compiler.stdout.trim(), ["-module-cache-path", path.join(directory, "cache"), script], { encoding: "utf8", timeout: 60000 });
    assert.equal(result.error, undefined, String(result.error)); assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /SHARED_LINK_POLICY_OK checks=26/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
