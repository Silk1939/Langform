const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('lokaler Kurzfassungs-Cache hält Quelle, Teilstatus, Abbruch, Neustart und Speichergrenzen ein', { timeout: 90000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-summary-reuse-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const harness = path.join(directory, 'Reuse.swift');
  fs.writeFileSync(harness, `
import Foundation
@main struct ReuseTest {
  static func main() async throws {
    let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let disk = root.appendingPathComponent("persisted")
    let cache = SummaryReuseCache(directory: disk)
    let source = "Ein Versuch ist geplant. Die Finanzierung ist noch offen."
    let key = OnDeviceSummary.reuseKey(source, scope: "summary")
    precondition(key == OnDeviceSummary.reuseKey(source, scope: "summary"))
    precondition(key != OnDeviceSummary.reuseKey(source + " Späte Einschränkung.", scope: "summary"))
    precondition(key != OnDeviceSummary.reuseKey(source, scope: "analysis"))
    let result: [String: Any] = ["summary": ["tldr": "Ein Versuch ist geplant.", "points": ["Die Finanzierung ist offen."], "takeaway": "Der Versuch steht noch aus.", "coverage": ["processedSections": 1, "totalSections": 1, "complete": true]]]
    precondition(OnDeviceSummary.reusableResult(result))
    precondition(!OnDeviceSummary.reusableResult(["code": "GENERATION_FAILED"]))
    let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    await cache.store(data, for: key)
    let hit = await OnDeviceSummary.cachedReply(for: source, sourceIncomplete: false, cache: cache)
    precondition(hit != nil)
    let changed = await OnDeviceSummary.cachedReply(for: source + " Die Finanzierung wurde gestrichen.", sourceIncomplete: false, cache: cache)
    precondition(changed == nil, "Ein identischer Videoanfang ist keine identische Quelle")
    let partial = await OnDeviceSummary.cachedReply(for: source, sourceIncomplete: true, cache: cache)
    precondition(partial == nil, "Eine Teilquelle übernimmt keine vollständige alte Antwort")
    let reopened = SummaryReuseCache(directory: disk)
    let restored = await reopened.data(for: key)
    precondition(restored == data, "Neustart muss ohne Modellaufruf möglich sein")
    let reply = await OnDeviceSummary.reply(for: source, cache: reopened)
    precondition(NSDictionary(dictionary: reply).isEqual(to: result), "Produktpfad muss den identischen vollständigen Inhalt liefern")
    let canceled = Task {
      try? await Task.sleep(nanoseconds: 30_000_000)
      return await OnDeviceSummary.reply(for: source, cache: reopened)
    }
    canceled.cancel()
    let cancellation = await canceled.value
    precondition(cancellation["code"] as? String == "CANCELLED", "Auch ein Cachehit respektiert den Abbruch")
    var invalid = result["summary"] as! [String: Any]
    for coverage in [["processedSections": 0, "totalSections": 1, "complete": true], ["processedSections": 1, "totalSections": 2, "complete": true], ["processedSections": 1, "totalSections": 1, "complete": false]] as [[String: Any]] {
      invalid["coverage"] = coverage
      precondition(!OnDeviceSummary.reusableResult(["summary": invalid]))
    }
    await cache.store(Data("broken json".utf8), for: key)
    let corruptedReply = await OnDeviceSummary.cachedReply(for: source, sourceIncomplete: false, cache: cache)
    precondition(corruptedReply == nil)
    let now = Date()
    let bounded = SummaryReuseCache(maximumEntries: 2, lifetime: 10)
    for n in 0..<3 { await bounded.store(Data([UInt8(n)]), for: String(n), now: now.addingTimeInterval(Double(n))) }
    let oldest = await bounded.data(for: "0", now: now.addingTimeInterval(3))
    let newest = await bounded.data(for: "2", now: now.addingTimeInterval(3))
    precondition(oldest == nil && newest == Data([2]))
    let expired = await bounded.data(for: "2", now: now.addingTimeInterval(12))
    precondition(expired == nil)
    await bounded.store(Data(repeating: 1, count: 16_385), for: "oversized", now: now)
    let oversized = await bounded.data(for: "oversized", now: now)
    precondition(oversized == nil)
    try Data("broken json".utf8).write(to: disk.appendingPathComponent("reuse-v1.json"))
    let corruptDisk = SummaryReuseCache(directory: disk)
    let ignored = await corruptDisk.data(for: key)
    precondition(ignored == nil)
    precondition(OnDeviceSummary.completedTLDR("## TLDR\\nNoch ein angefangener") == nil)
    precondition(OnDeviceSummary.completedTLDR("## TLDR\\nDie Finanzierung ist offen.\\n## Die wichtigsten Punk") == nil)
    precondition(OnDeviceSummary.completedTLDR("## TLDR\\nDie Finanzierung ist offen.\\n## Die wichtigsten Punkte\\n* ") == "Die Finanzierung ist offen.")
    precondition(OnDeviceSummary.completedTLDR("Vorrede\\n## TLDR\\nKern.\\n## Die wichtigsten Punkte") == nil)
    precondition(OnDeviceSummary.completedTLDR("## TLDR\\n[ZU_WENIG_INHALT]\\n## Die wichtigsten Punkte") == nil)
    print("SUMMARY_REUSE_AND_PREVIEW_OK")
  }
}
`);
  const binary = path.join(directory, 'reuse');
  const build = spawnSync('xcrun', ['swiftc', '-parse-as-library', '-module-cache-path', path.join(directory, 'modules'),
    '-target', `${process.arch}-apple-macosx26.0`, path.join(__dirname, '../ios/Langform/Langform/OnDeviceSummary.swift'), harness, '-o', binary],
  { encoding: 'utf8', timeout: 70000 });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(binary, [directory], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /SUMMARY_REUSE_AND_PREVIEW_OK/);
});

const summary = require('../extension/src/summary.js');
test('iPhone-Fortschritt zeigt nur eigene vollständige Vorschau und räumt nach Abschluss auf', async () => {
  const seen = [];
  let posted;
  const host = { setTimeout, clearTimeout, setInterval, clearInterval,
    webkit: { messageHandlers: { langformSummary: { postMessage(payload) { posted = payload; } } } } };
  const promise = summary.loadSummary('aqz-KE-bpKQ', {
    player: { videoDetails: { videoId: 'aqz-KE-bpKQ' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { baseUrl: 'https://www.youtube.com/api/timedtext?v=aqz-KE-bpKQ', languageCode: 'de' }
    ] } } }, watchPage: true, host,
    fetchText: async () => JSON.stringify({ events: [{ segs: [{ utf8: 'Die Finanzierung ist noch offen.' }] }] }),
    onProgress: progress => seen.push(progress), sourceIncomplete: false
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(posted.sourceIncomplete, false);
  const progress = { progress: { phase: 'writing', processedSections: 1, totalSections: 1,
    sourceIncomplete: false, coverageIncomplete: false, tldr: 'Die Finanzierung ist offen.' } };
  host.__langformKurzUpdate('fremde-anfrage', progress);
  assert.equal(seen.length, 0);
  host.__langformKurzUpdate(posted.id, { progress: { ...progress.progress, coverageIncomplete: true } });
  assert.equal(seen.length, 0, 'Eine Teilanalyse darf keine vollständige Vorschau zeigen');
  host.__langformKurzUpdate(posted.id, progress);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tldr, 'Die Finanzierung ist offen.');
  host.__langformKurzFinish(posted.id, { summary: { tldr: 'Die Finanzierung ist offen.', points: ['Noch keine Zusage.'],
    takeaway: 'Die Entscheidung steht aus.', coverage: { processedSections: 1, totalSections: 1, complete: true } } });
  const result = await promise;
  assert.equal(result.summary.tldr, 'Die Finanzierung ist offen.');
  assert.equal(Object.keys(host.__langformKurzWait).length, 0);
  assert.equal(Object.keys(host.__langformKurzProgressWait).length, 0);
  host.__langformKurzUpdate(posted.id, progress);
  assert.equal(seen.length, 1, 'Verspätete Vorschau darf keinen fertigen Zustand überschreiben');
});

for (const route of ['relay', 'native']) {
  for (const sourceIncomplete of [false, true]) {
    test(`Quellenstatus bleibt auf ${route} erhalten: unvollständig=${sourceIncomplete}`, async () => {
      let posted;
      const response = { summary: { points: ['Eine bedingte Aussage.'], coverage: {
        processedSections: 1, totalSections: 1, complete: !sourceIncomplete
      } } };
      const runtime = route === 'relay' ? {
        sendMessage: async payload => { posted = payload; return response; },
        connect: () => ({ postMessage() {}, disconnect() {},
          onMessage: { addListener() {}, removeListener() {} },
          onDisconnect: { addListener() {}, removeListener() {} } })
      } : { sendNativeMessage: async (_name, payload) => { posted = payload; return response; } };
      const result = await summary.loadSummary('aqz-KE-bpKQ', {
        player: { videoDetails: { videoId: 'aqz-KE-bpKQ' }, captions: { playerCaptionsTracklistRenderer: {
          captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=aqz-KE-bpKQ', languageCode: 'de' }]
        } } }, watchPage: true, sourceIncomplete,
        host: { browser: { runtime }, setTimeout, clearTimeout, setInterval, clearInterval },
        fetchText: async () => JSON.stringify({ events: [{ segs: [{ utf8: 'Die Finanzierung ist noch offen.' }] }] })
      });
      assert.equal(posted.sourceIncomplete, sourceIncomplete);
      assert.equal(result.summary.coverage.complete, !sourceIncomplete);
    });
  }
}
