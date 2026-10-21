const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function balancedDeclaration(source, signature) {
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

test('native Suchfeldeingabe prüft vollständige Links vor dem Suchlimit und erhält normale Suchtexte', {
  skip: process.platform !== 'darwin', timeout: 60000,
}, () => {
  const app = path.join(__dirname, '../ios/Langform/Langform');
  const submit = balancedDeclaration(fs.readFileSync(path.join(app, 'NativeSearch.swift'), 'utf8'), 'func submit(');
  const script = fs.readFileSync(path.join(app, 'SearchPolicy.swift'), 'utf8') + '\n' +
    fs.readFileSync(path.join(app, 'ExternalYouTubeLink.swift'), 'utf8') + `
class Search {
 var filter = LangformSearchFilter.channels
 var cancelled = 0
 var submitted: [(NativeSearchSubmission, LangformSearchFilter)] = []
 lazy var onSubmit: ((NativeSearchSubmission, LangformSearchFilter) -> Void)? = { [weak self] in self?.submitted.append(($0,$1)) }
 func cancel() { cancelled += 1 }
 ${submit}
}
func expect(_ value: Bool, _ text: String) { if !value { fatalError(text) } }
func queryValue(_ value: NativeSearchSubmission) -> String? { if case .query(let query) = value { return query }; return nil }
func linkValue(_ value: NativeSearchSubmission) -> URL? { if case .youtubeLink(let url) = value { return url }; return nil }
let s=Search()
s.submit(" https://youtu.be/aqz-KE-bpKQ?t=23&si=" + String(repeating:"x",count:300) + " ")
expect(s.submitted.count == 1 && linkValue(s.submitted[0].0)?.absoluteString == "https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=23", "full URL parsed before 200-character search limit")
expect(s.submitted[0].1 == .channels && s.cancelled == 1, "URL preserves callback and closes keyboard")
s.submit("  NASA Mars  ")
expect(queryValue(s.submitted[1].0) == "NASA Mars" && s.submitted[1].1 == .channels && s.cancelled == 2,"ordinary query and filter preserved")
s.submit("  ")
expect(s.submitted.count == 2 && s.cancelled == 2,"empty input keeps the current search")
s.submit(String(repeating:"q",count:300))
expect(queryValue(s.submitted[2].0)?.count == 200,"ordinary query remains bounded")
print("SEARCH_INPUT_FULL_URL_OK")
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-search-input-'));
  try {
    const file = path.join(dir, 'Input.swift'); fs.writeFileSync(file, script);
    const result = spawnSync('/usr/bin/xcrun', ['swift', '-module-cache-path', path.join(dir, 'cache'), file], {encoding:'utf8', timeout:50000});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /SEARCH_INPUT_FULL_URL_OK/);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});

test('echter nativer Suchrouter schützt Tickets und Overlaybesitz über Feed-, Dokument- und Lifecyclewechsel', {
  skip: process.platform !== 'darwin', timeout: 60000,
}, t => {
  const swift = spawnSync('/usr/bin/xcrun', ['--find', 'swift'], { encoding: 'utf8' });
  if (swift.status !== 0) return t.skip('Swift-Toolchain fehlt für den tatsächlichen Routingtest.');
  const app = path.join(__dirname, '../ios/Langform/Langform');
  const source = fs.readFileSync(path.join(app, 'YouTubeWebView.swift'), 'utf8');
  const policy = fs.readFileSync(path.join(app, 'SearchPolicy.swift'), 'utf8');
  const linkPolicy = fs.readFileSync(path.join(app, 'ExternalYouTubeLink.swift'), 'utf8');
  // The production method bodies run verbatim. Only UIKit presentation and
  // destination loading are passive stubs; this is not an iPhone UI/SDK test.
  const methods = ['nativeSearchChanged', 'dismissNativeSearch']
    .map(name => balancedDeclaration(source, 'func ' + name + '(')).join('\n');
  const script = `
import Foundation
import CoreFoundation
import CoreGraphics
${policy}
${linkPolicy}
class ExternalLinkInbox {
  static let shared = ExternalLinkInbox()
  var links = [URL]()
  func submit(_ text: String) throws { links.append(try ExternalYouTubeLink.parse(text).url) }
}
class WKNavigation {}
class WKWebView { var url: URL?; init(_ raw: String = "https://m.youtube.com/") { url = URL(string:raw) } }
class FeedState { var active = true, navigation: WKNavigation? = WKNavigation() }
class UIApplication {
  enum State { case active, inactive, background }
  static let shared = UIApplication(); var applicationState = State.active
}
enum UIAccessibility {
  enum Notification { case screenChanged }
  static var announcements = 0
  static func post(notification: Notification, argument: Any?) { announcements += 1 }
}
class NativeSearchOverlay {
  enum Resize { case flexibleWidth, flexibleHeight }
  var frame = CGRect.zero, autoresizingMask: Set<Resize> = []
  var onSubmit: ((NativeSearchSubmission, LangformSearchFilter) -> Void)?, onClose: (() -> Void)?, onOpenLink: (() -> Void)?
  let query: String, filter: LangformSearchFilter, recent: [String]
  var focusCount = 0, cancelCount = 0, removeCount = 0
  init(query: String, filter: LangformSearchFilter, recent: [String]) { self.query=query; self.filter=filter; self.recent=recent }
  func focus() { focusCount += 1 }
  func present() { focus() }
  func cancel() { cancelCount += 1 }
  func removeFromSuperview() { removeCount += 1 }
  ${balancedDeclaration(fs.readFileSync(path.join(app, 'NativeSearch.swift'), 'utf8'), 'func submit(')}
}
class Stage {
  enum Mode { case closed, mini, expanded, loading }
  var feed = WKWebView(), state = FeedState(), mode = Mode.mini, cardMoving = false
  var bounds = CGRect(x:0,y:0,width:390,height:844)
  var pendingFeedSearch: (view: ObjectIdentifier, ticket: Int)?, feedSearchInFlight: Int?
  var nativeSearchOverlay: NativeSearchOverlay?, nativeSearchRecent = [String]()
  var added = 0, destinations = [URL](), forcedReloads = 0
  var linkOpens = 0
  lazy var onOpenLink: (() -> Void)? = { [weak self] in self?.linkOpens += 1 }
  let player = WKWebView("https://m.youtube.com/watch?v=abcdefghijk&t=17")
  func feedState(for web: WKWebView) -> FeedState? { web === feed ? state : nil }
  func addSubview(_ overlay: NativeSearchOverlay) { added += 1 }
  func showInFeed(_ url: URL, forceReload: Bool = false) { destinations.append(url); if forceReload { forcedReloads += 1 } }
  func prepareTicket(_ value: Int = 14) { pendingFeedSearch = (ObjectIdentifier(feed),value); feedSearchInFlight=value }
  func open(ticket: Any? = nil, from web: WKWebView? = nil, href: String? = nil) {
    var body: [String:Any] = ["action":"open","href":href ?? feed.url!.absoluteString]
    if let ticket { body["ticket"] = ticket }
    nativeSearchChanged(body, from:web ?? feed)
  }
  ${methods}
}
var assertions = 0
func expect(_ ok: Bool, _ text: String) { assertions += 1; if !ok { print("FAILED: " + text); exit(1) } }
let originalWatch = "https://m.youtube.com/watch?v=abcdefghijk&t=17"
func preservesMini(_ s: Stage) -> Bool { s.mode == .mini && s.player.url!.absoluteString == originalWatch }

for item in 0..<6 {
 let s=Stage()
 switch item {
 case 0: s.state.active=false
 case 1: UIApplication.shared.applicationState = .inactive
 case 2: UIApplication.shared.applicationState = .background
 case 3: s.cardMoving=true
 case 4: s.mode = .expanded
 default: s.mode = .loading
 }
 s.open(); expect(s.nativeSearchOverlay == nil && s.added == 0,"inactive UI cannot open search " + String(item))
 UIApplication.shared.applicationState = .active
}
let foreign=Stage(); foreign.open(from:WKWebView()); expect(foreign.nativeSearchOverlay == nil,"different feed rejected")
let href=Stage(); href.open(href:"https://m.youtube.com/feed/you"); expect(href.nativeSearchOverlay == nil,"different source href rejected")

let invalid: [Any] = ["14",true,false,NSNull(),-1,14.5,Double.infinity,Double.nan,9_007_199_254_740_992.0]
for value in invalid {
 let s=Stage(); s.prepareTicket(); s.open(ticket:value)
 expect(s.nativeSearchOverlay == nil,"ticket must be a finite non-Boolean safe integer: " + String(describing:value))
}
for item in 0..<4 {
 let s=Stage(); s.prepareTicket()
 switch item { case 0:s.pendingFeedSearch=nil;case 1:s.feedSearchInFlight=nil;case 2:s.pendingFeedSearch=(ObjectIdentifier(WKWebView()),14);default:s.prepareTicket(15) }
 s.open(ticket:14); expect(s.nativeSearchOverlay == nil,"revoked or foreign search ticket rejected " + String(item))
}
let direct=Stage(); direct.open()
expect(direct.nativeSearchOverlay != nil && direct.added == 1 && direct.nativeSearchOverlay!.focusCount == 1,"direct open needs no synthetic ticket")
expect(direct.nativeSearchOverlay!.filter == .videos && direct.nativeSearchOverlay!.frame == direct.bounds,"default videos and 390px native overlay geometry retained")
direct.open(); expect(direct.added == 1 && direct.nativeSearchOverlay!.focusCount == 2,"repeated same-owner open focuses one surface")
direct.nativeSearchChanged(["action":"focus","href":direct.feed.url!.absoluteString],from:direct.feed)
expect(direct.added == 1 && direct.nativeSearchOverlay!.focusCount == 3,"late native handoff refocuses only its existing surface")
let noSurface=Stage()
noSurface.nativeSearchChanged(["action":"focus","href":noSurface.feed.url!.absoluteString],from:noSurface.feed)
expect(noSurface.nativeSearchOverlay == nil && noSurface.added == 0,"a late click never reopens a closed search")
let foreignFocus=direct.nativeSearchOverlay!.focusCount
direct.nativeSearchChanged(["action":"focus","href":"https://m.youtube.com/results?search_query=other"],from:direct.feed)
expect(direct.nativeSearchOverlay!.focusCount == foreignFocus,"foreign document cannot steal current native focus")
let customFilter=Stage();customFilter.feed.url=URL(string:"https://m.youtube.com/results?search_query=NASA&sp=EgIQAQ%253D%253D")!
customFilter.nativeSearchChanged(["action":"open","filter":"unwatched","href":customFilter.feed.url!.absoluteString],from:customFilter.feed)
expect(customFilter.nativeSearchOverlay!.filter == .unwatched,"verified current native chip survives YouTube canonical parameter cleanup")
customFilter.nativeSearchOverlay!.onSubmit?(.query("NASA"),.videos)
expect(customFilter.destinations.count == 1 && customFilter.forcedReloads == 1,"explicit native Videos choice clears retained unwatched intent even when the canonical URL is already identical")
let ticketed=Stage(); ticketed.prepareTicket(); ticketed.open(ticket:NSNumber(value:14))
expect(ticketed.nativeSearchOverlay != nil && preservesMini(ticketed),"matching ticket opens without replacing Watch")
print("SEARCH_TICKET_AND_ENTRY_GUARDS_OK")

let replaced=Stage(); replaced.open(); let old=replaced.nativeSearchOverlay!
replaced.dismissNativeSearch(); replaced.open(); let replacement=replaced.nativeSearchOverlay!
old.onSubmit?(.query("old query"),.channels); old.onClose?(); old.onOpenLink?()
expect(replaced.nativeSearchOverlay === replacement && replaced.destinations.isEmpty,"old callbacks cannot consume replacement overlay")
expect(replaced.linkOpens == 0,"retired overlay cannot open external link input")
expect(old.cancelCount == 1 && old.removeCount == 1 && replacement.cancelCount == 0,"old callback cannot cancel new surface")
replacement.onClose?(); expect(replaced.nativeSearchOverlay == nil && replacement.cancelCount == 1 && replacement.removeCount == 1,"current close cancels and removes exactly its own surface")

for item in 0..<10 {
 let s=Stage(); s.nativeSearchRecent=["retained"]; s.open(); let overlay=s.nativeSearchOverlay!
 switch item {
 case 0:s.feed=WKWebView()
 case 1:s.feed.url=URL(string:"https://m.youtube.com/feed/you")
 case 2:s.state.navigation=WKNavigation()
 case 3:s.state.active=false
 case 4:s.cardMoving=true
 case 5:s.mode = .expanded
 case 6:s.mode = .loading
 case 7:UIApplication.shared.applicationState = .inactive
 case 8:UIApplication.shared.applicationState = .background
 default:s.dismissNativeSearch()
 }
 overlay.onSubmit?(.query("stale"),.unwatched)
 let linkCount = ExternalLinkInbox.shared.links.count
 overlay.onSubmit?(.youtubeLink(URL(string:"https://youtu.be/aqz-KE-bpKQ?t=23")!),.videos)
 overlay.onOpenLink?()
 expect(s.destinations.isEmpty && s.nativeSearchRecent == ["retained"],"stale submission cannot navigate or record private query " + String(item))
 expect(s.linkOpens == 0,"stale link action cannot open native sheet " + String(item))
 expect(ExternalLinkInbox.shared.links.count == linkCount,"stale URL submission cannot replace current media " + String(item))
 UIApplication.shared.applicationState = .active
}
print("SEARCH_OVERLAY_FEED_DOCUMENT_LIFECYCLE_LEASES_OK")

let linkEntry=Stage();linkEntry.open();let linkForm=linkEntry.nativeSearchOverlay!
linkForm.onOpenLink?()
expect(linkEntry.linkOpens == 1 && linkEntry.nativeSearchOverlay == nil && linkForm.cancelCount == 1 && linkForm.removeCount == 1,"current link action dismisses its own search before opening the native sheet")
linkForm.onOpenLink?()
expect(linkEntry.linkOpens == 1 && linkEntry.destinations.isEmpty && preservesMini(linkEntry),"repeated old link action neither reopens nor changes current player/feed")

let pasted=Stage(); pasted.nativeSearchRecent=["retained"]; pasted.open()
let pastedForm=pasted.nativeSearchOverlay!
let linksBefore=ExternalLinkInbox.shared.links.count
pastedForm.submit("https://youtu.be/aqz-KE-bpKQ?t=23&si=remove")
expect(ExternalLinkInbox.shared.links.count == linksBefore+1 && ExternalLinkInbox.shared.links.last!.absoluteString == "https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=23","pasted URL goes through normal link inbox with its timestamp")
expect(pasted.nativeSearchOverlay == nil && pasted.destinations.isEmpty && pasted.nativeSearchRecent == ["retained"],"pasted link closes search without becoming a result query or recent search")
pastedForm.submit("https://youtu.be/M7lc1UVf-VE")
expect(ExternalLinkInbox.shared.links.count == linksBefore+1,"retired search cannot replay URL submission")
print("SEARCH_PASTED_URL_OWNERSHIP_OK")

// Execute the unchanged production NativeSearch.submit together with the
// unchanged production stage callback. The full URL is invalid; its first
// 200 characters alone look like a valid, different opening intention.
for raw in [
 "https://youtu.be/aqz-KE-bpKQ?si=" + String(repeating:"x",count:250) + "&t=120&t=30",
 "https://www.youtube.com/watch?v=aqz-KE-bpKQ&si=" + String(repeating:"x",count:250) + "&v=M7lc1UVf-VE"
] {
 var rejectedFull = false
 do { _ = try ExternalYouTubeLink.parse(raw) } catch { rejectedFull = true }
 expect(rejectedFull,"full duplicated v/t URL is rejected before any truncation")
 expect((try? ExternalYouTubeLink.parse(LangformSearchPolicy.query(raw))) != nil,"the bounded prefix alone would incorrectly be a valid URL")
 let s=Stage(); s.open(); let entry=s.nativeSearchOverlay!
 let before=ExternalLinkInbox.shared.links.count
 entry.submit(raw)
 expect(ExternalLinkInbox.shared.links.count == before,"invalid full URL can never regain link semantics after the query limit")
 expect(s.destinations.count == 1 && s.destinations[0].path == "/results","rejected URL follows the existing bounded ordinary-query route")
 let query=URLComponents(url:s.destinations[0],resolvingAgainstBaseURL:false)!.queryItems!.first(where:{$0.name == "search_query"})!.value
 expect(query == LangformSearchPolicy.query(raw),"bounded query stays literal and never becomes another video or time")
 expect(s.nativeSearchOverlay == nil && preservesMini(s),"rejected full URL query preserves media and closes only its own search")
}
print("SEARCH_REJECTED_FULL_URL_NEVER_REINTERPRETED_OK")


let legit=Stage(); legit.nativeSearchRecent=["NASA + Mars & #1 / 東京 😃"] + (0..<22).map { "query-" + String($0) }
legit.open(); let form=legit.nativeSearchOverlay!
form.onSubmit?(.query("NASA + Mars & #1 / 東京 😃"),.channels)
expect(legit.destinations.count == 1 && legit.nativeSearchOverlay == nil && form.cancelCount == 1 && form.removeCount == 1,"legitimate submission routes once and closes its own UI")
let parts=URLComponents(url:legit.destinations[0],resolvingAgainstBaseURL:false)!
expect(parts.scheme == "https" && parts.host == "m.youtube.com" && parts.path == "/results","submission stays mobile YouTube")
expect(parts.queryItems!.first(where:{$0.name == "search_query"})!.value == "NASA + Mars & #1 / 東京 😃" && LangformSearchPolicy.filter(from:legit.destinations[0]) == .channels,"literal Unicode query and chosen filter survive routing")
expect(legit.nativeSearchRecent.count == 20 && legit.nativeSearchRecent[0] == "NASA + Mars & #1 / 東京 😃" && legit.nativeSearchRecent.filter({$0 == "NASA + Mars & #1 / 東京 😃"}).count == 1,"recent queries remain deduplicated and bounded")
expect(preservesMini(legit),"native query routing preserves mini Watch URL and timestamp")

for filter in LangformSearchFilter.allCases {
 let s=Stage(); s.feed.url=LangformSearchPolicy.resultsURL(query:"NASA & 東京",filter:.all)
 s.nativeSearchChanged(["action":"filter","filter":filter.rawValue,"href":s.feed.url!.absoluteString],from:s.feed)
 expect(s.destinations.count == 1 && LangformSearchPolicy.filter(from:s.destinations[0]) == filter && preservesMini(s),"filter dispatch preserves query and Mini " + filter.rawValue)
 expect(URLComponents(url:s.destinations[0],resolvingAgainstBaseURL:false)!.queryItems!.first(where:{$0.name == "search_query"})!.value == "NASA & 東京","filter uses current literal query")
}
for item in 0..<3 {
 let s=Stage(); if item != 0 {s.feed.url=LangformSearchPolicy.resultsURL(query:"NASA",filter:.videos)}
 s.nativeSearchChanged(["action":"filter","filter":item == 1 ? "invalid" : "videos","href":item == 2 ? "https://m.youtube.com/" : s.feed.url!.absoluteString],from:s.feed)
 expect(s.destinations.isEmpty,"invalid filter or source cannot navigate " + String(item))
}
print("SEARCH_LITERAL_QUERY_FILTER_AND_MINI_PRESERVED_OK")
print("NATIVE_SEARCH_ROUTING_OK assertions=" + String(assertions))
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-native-search-routing-'));
  try {
    const file = path.join(dir, 'SearchRouting.swift'); fs.writeFileSync(file, script);
    const result = spawnSync(swift.stdout.trim(), ['-module-cache-path', path.join(dir, 'cache'), file], { encoding: 'utf8', timeout: 50000 });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /SEARCH_TICKET_AND_ENTRY_GUARDS_OK/);
    assert.match(result.stdout, /SEARCH_OVERLAY_FEED_DOCUMENT_LIFECYCLE_LEASES_OK/);
    assert.match(result.stdout, /SEARCH_LITERAL_QUERY_FILTER_AND_MINI_PRESERVED_OK/);
    assert.match(result.stdout, /SEARCH_REJECTED_FULL_URL_NEVER_REINTERPRETED_OK/);
    assert.match(result.stdout, /NATIVE_SEARCH_ROUTING_OK assertions=\d+/);
    t.diagnostic(result.stdout.trim());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
