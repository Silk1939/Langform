const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function declaration(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, 'Missing actual source: ' + marker);
  const opening = source.indexOf('{', start);
  let depth = 1;
  for (let index = opening + 1; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail('Unclosed actual source: ' + marker);
}

let directory, binary;
test.before(() => {
  if (process.platform !== 'darwin') return;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-summary-host-'));
  binary = path.join(directory, 'host');
  const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/YouTubeWebView.swift'), 'utf8');
  let schedule = declaration(source, '    private func scheduleFeedPrewarm()');
  // Replace only OS sensors and the external dispatch scheduler. The complete
  // shipping entry guard, delayed closure and allocation decisions remain real.
  schedule = schedule.replaceAll('ProcessInfo.processInfo.isLowPowerModeEnabled', 'Sensors.lowPower')
    .replaceAll('ProcessInfo.processInfo.thermalState', 'Sensors.thermal')
    .replace('DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: work)', 'Scheduler.items.append(work)');
  assert.ok(schedule.includes('Scheduler.items.append(work)'));
  const declarations = [
    declaration(source, '    @MainActor private struct SummaryRequestTask'),
    source.match(/    private var summaryTasks:[^\n]+/)[0],
    source.match(/    private var summaryHostHolds[^\n]+/)[0],
    declaration(source, '    private func cancelInactiveSummaryRequests()'),
    declaration(source, '    private func cancelFeedPrewarm('),
    declaration(source, '    private func prepareSummaryHost('),
    declaration(source, '    private func releaseSummaryHost('),
    declaration(source, '    private func answerSummary('),
    schedule
  ].join('\n');
  const harness = path.join(directory, 'Host.swift');
  fs.writeFileSync(harness, String.raw`
import Foundation

@MainActor enum Scheduler { static var items: [DispatchWorkItem] = [] }
@MainActor enum Sensors {
  enum Thermal { case nominal, serious }
  static var lowPower = false
  static var thermal = Thermal.nominal
}
@MainActor final class UIApplication {
  enum State { case active, background }
  static let shared = UIApplication()
  var applicationState = State.active
}
enum FeedTab: CaseIterable {
  case home, you, subscriptions
  init?(url: URL?) { guard url != nil else { return nil }; self = .home }
}
@MainActor final class Scroll {
  var isTracking = false, isDragging = false, isDecelerating = false
}
@MainActor final class WKWebView {
  let identity: String
  init(_ identity: String) { self.identity = identity }
  var url: URL? = URL(string: "https://m.youtube.com/")
  var frame = 0
  var isHidden = false, accessibilityElementsHidden = false, isUserInteractionEnabled = true
  var isLoading = false
  let scrollView = Scroll()
  var loads = 0
  var replies: [String] = []
  func evaluateJavaScript(_ script: String, in frame: Any?, in world: ContentWorld) { replies.append(script) }
  func load(_ request: URLRequest) -> String? { loads += 1; return "navigation" }
}
@MainActor final class FeedState {
  let webView: WKWebView
  var overlayOpen = false, contentReady = true
  var rootURL = URL(string: "https://m.youtube.com/")!
  var rootNavigation: String?
  init(_ webView: WKWebView) { self.webView = webView }
}
@MainActor enum StartupDiagnostics { static func mark(_ value: String) {} }
enum ContentWorld { case page }
@MainActor final class WKScriptMessage {
  let body: Any
  let webView: WKWebView?
  init(_ id: String, _ text: String, _ view: WKWebView) { body = ["id": id, "text": text]; webView = view }
}
@MainActor enum OnDeviceSummary {
  struct Progress { var payload: [String: Any] { ["progress": ["phase": "reading"]] } }
  static var pending: [String: CheckedContinuation<[String: Any], Never>] = [:]
  static func reply(for text: String, sourceIncomplete: Bool, onProgress: @escaping (Progress) async -> Void) async -> [String: Any] {
    await withCheckedContinuation { pending[text] = $0 }
  }
  static func failure(_ code: String, _ message: String) -> [String: Any] { ["code": code, "message": message] }
}
@MainActor enum GemmaSummaryHostProbe {
  static func cancelled(id: String, lease: UUID, reason: String, host: [String: Any]) {}
  static func claimRequest(id: String, text: String, in view: WKWebView) -> Bool { false }
  static func ownsRequest(id: String) -> Bool { false }
  static func requestStarted(id: String, lease: UUID, host: [String: Any]) {}
  static func progress(id: String, lease: UUID, update: OnDeviceSummary.Progress, host: [String: Any]) {}
  static func nativeFinished(id: String, lease: UUID, payload: [String: Any], host: [String: Any]) {}
}
enum YouTubeWebView { static func homeURL(for origin: URL?) -> URL { URL(string: "https://m.youtube.com/")! } }
@MainActor final class Host {
  enum Mode { case closed, loading, expanded }
  struct NetworkPolicy { var online = true, constrained = false }
  struct Network { var policy: NetworkPolicy? = NetworkPolicy() }
  var feedTabs: [FeedTab: FeedState] = [:]
  var activeFeedTab = FeedTab.home
  var feed: WKWebView? { feedTabs[activeFeedTab]?.webView }
  var player = WKWebView("player")
  var card = WKWebView("card")
  var feedPrewarm: DispatchWorkItem?
  var prewarmingTab: FeedTab?
  var backgroundPreparationDisabled = false
  var mode = Mode.expanded
  var videoPlaying = true, cardMoving = false, keyboardVisible = false, feedFailed = false
  var playerWarmupAttempted = false
  var playerWarmupNavigation: String?, playerNavigation: String?
  var networkQuality = Network()
  var bounds = 1
  var evicted: [FeedTab] = []
  var created: [FeedTab] = []
  var ensurePlayerCount = 0
  init() { feedTabs[.home] = FeedState(WKWebView("home")) }
  func evictFeedTab(_ tab: FeedTab) { evicted.append(tab); feedTabs.removeValue(forKey: tab) }
  func makeFeedTab(_ tab: FeedTab, origin: URL?) -> FeedState {
    created.append(tab)
    let state = FeedState(WKWebView(String(describing: tab)))
    feedTabs[tab] = state
    return state
  }
  func insertSubview(_ view: WKWebView, belowSubview: WKWebView) {}
  func setFeedActivity(_ view: WKWebView, active: Bool) {}
  func ensurePlayer() { ensurePlayerCount += 1 }
  func suspendPreparedPlayer() {}
  func installLease() {
    let lease = UUID()
    summaryHostHolds.insert(lease)
    summaryTasks[ObjectIdentifier(player)] = SummaryRequestTask(id: "current", lease: lease, task: Task {}, finishCancelled: {})
  }
  func removeLease() { summaryTasks.removeAll(); summaryHostHolds.removeAll() }
  func send(_ id: String, _ text: String) { answerSummary(WKScriptMessage(id, text, player)) }
  func cancelAll() { cancelInactiveSummaryRequests() }
  var holdCount: Int { summaryHostHolds.count }
  var requestCount: Int { summaryTasks.count }
  private func summaryHostSnapshot(for source: WKWebView) -> [String: Any] { [:] }
  func schedule() { scheduleFeedPrewarm() }
  func prepare(_ source: WKWebView) -> Bool { prepareSummaryHost(for: source) }
  ` + declarations + String.raw`
}
@main struct HostExercise {
  @MainActor static func main() async {
    switch CommandLine.arguments[1] {
    case "prewarm":
      let busy = Host()
      busy.installLease()
      busy.schedule()
      precondition(Scheduler.items.isEmpty && busy.created.isEmpty,
        "A live native summary lease must prevent scheduling a new background web view")
      busy.removeLease()
      busy.schedule()
      precondition(Scheduler.items.count == 1)
      let queued = Scheduler.items.removeFirst()
      busy.installLease()
      queued.perform()
      precondition(busy.created.isEmpty && busy.ensurePlayerCount == 0 && busy.prewarmingTab == nil,
        "A prewarm queued before the summary must recheck ownership inside its actual delayed closure")
      busy.removeLease()
      busy.schedule()
      precondition(Scheduler.items.count == 1)
      Scheduler.items.removeFirst().perform()
      precondition(busy.created == [.you] && busy.feedTabs[.you]?.webView.loads == 1,
        "Prewarming remains available after the final summary lease has ended")
    case "preserve":
      let host = Host()
      let active = host.feed!, player = host.player
      host.feedTabs[.you] = FeedState(WKWebView("source-you"))
      host.feedTabs[.subscriptions] = FeedState(WKWebView("inactive-subscriptions"))
      let source = host.feedTabs[.you]!.webView
      source.isLoading = true
      host.prewarmingTab = .you
      let reclaimed = host.prepare(source)
      precondition(reclaimed && host.feedTabs.count == 2)
      precondition(host.feedTabs[.home]?.webView === active && host.feedTabs[.you]?.webView === source && host.player === player,
        "Host preparation must retain active feed, exact source document and player identities")
      precondition(host.evicted == [.subscriptions] && !host.evicted.contains(.you),
        "Discarding a prewarm must not evict the source before the preservation loop")
    case "player":
      let host = Host(), active = Host()
      host.feedTabs[.you] = FeedState(WKWebView("you"))
      host.feedTabs[.subscriptions] = FeedState(WKWebView("subscriptions"))
      let originalFeed = host.feed!, originalPlayer = host.player
      precondition(host.prepare(originalPlayer))
      precondition(host.feedTabs.count == 1 && host.feed === originalFeed && host.player === originalPlayer)
      precondition(Set(host.evicted) == Set([.you, .subscriptions]))
      precondition(!active.prepare(active.feed!), "A host with nothing reclaimable must not pretend to release memory")
      precondition(active.feedTabs.count == 1 && active.evicted.isEmpty)
    case "drain":
      let host = Host()
      host.send("old-ticket", "old-source")
      await wait { OnDeviceSummary.pending["old-source"] != nil }
      host.send("new-ticket", "new-source")
      await wait { OnDeviceSummary.pending["new-source"] != nil }
      precondition(host.holdCount == 2 && host.requestCount == 1,
        "A superseded native request retains its distinct hold until its callback drain completes")
      host.cancelAll()
      precondition(host.requestCount == 0 && host.holdCount == 2)
      host.schedule()
      precondition(Scheduler.items.isEmpty && host.created.isEmpty,
        "Removing cancelled request tickets must not permit prewarming beside draining native work")
      OnDeviceSummary.pending.removeValue(forKey: "old-source")!.resume(returning: ["summary": [:]])
      await wait { host.holdCount == 1 }
      host.schedule()
      precondition(Scheduler.items.isEmpty && host.created.isEmpty,
        "Completion of the stale owner cannot release the newer native owner's hold")
      OnDeviceSummary.pending.removeValue(forKey: "new-source")!.resume(returning: ["summary": [:]])
      await wait { host.holdCount == 0 }
      precondition(Scheduler.items.count == 1)
      Scheduler.items.removeFirst().perform()
      precondition(host.created == [.you], "Prewarm resumes only after both actual task bodies have drained")
    default: preconditionFailure("Unknown host exercise")
    }
    print("SUMMARY_HOST_MEMORY_OK " + CommandLine.arguments[1])
  }
  @MainActor static func wait(_ condition: () -> Bool) async {
    let end = ProcessInfo.processInfo.systemUptime + 3
    while !condition() && ProcessInfo.processInfo.systemUptime < end { await Task.yield() }
    precondition(condition(), "Controlled host continuation did not reach its required state")
  }
}
`);
  const build = spawnSync('xcrun', ['swiftc', '-parse-as-library',
    '-module-cache-path', path.join(directory, 'modules'), harness, '-o', binary],
  { encoding: 'utf8', timeout: 60000 });
  assert.equal(build.status, 0, build.stdout + build.stderr);
});
test.after(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }); });

for (const [mode, title] of [
  ['prewarm', 'aktive Summary-Lease sperrt unmittelbaren und bereits eingeplanten Prewarm bis zum Abschluss'],
  ['preserve', 'Speicherfreigabe erhält aktive Feed-, Quell- und Player-Identität auch bei ladendem Source-Prewarm'],
  ['player', 'nur tatsächlich inaktive fremde Feed-Tabs werden vor einem Playerauftrag freigegeben'],
  ['drain', 'abgebrochene alte und neue native Tasks halten Prewarming bis zum vollständigen Drain getrennt gesperrt']
]) {
  test('Normaler Summary-Host: ' + title, t => {
    if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
    const run = spawnSync(binary, [mode], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, new RegExp('SUMMARY_HOST_MEMORY_OK ' + mode));
  });
}
