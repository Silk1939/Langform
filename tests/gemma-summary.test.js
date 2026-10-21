const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const summary = require('../extension/src/summary.js');

test('echter nativer Gemma-Pfad prüft Ergebnis, Teilquelle, Cache und fehlendes Modell ohne Inferenz oder Netzwerk', { timeout: 90000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-gemma-summary-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ios = path.join(__dirname, '../ios/Langform/Langform');
  const modelStore = fs.readFileSync(path.join(ios, 'GemmaModelStore.swift'), 'utf8');
  // Keep every production lifecycle method; only redirect its file location so
  // a test cannot read or change a user's actual installed model or receipt.
  const productionRoot = 'FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]';
  assert.ok(modelStore.includes(productionRoot));
  const fixtureStore = path.join(directory, 'GemmaModelStore.swift');
  fs.writeFileSync(fixtureStore, modelStore.replace(productionRoot,
    'URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)'));
  const harness = path.join(directory, 'GemmaSummaryTest.swift');
  fs.writeFileSync(harness, `
import Foundation
@main struct GemmaSummaryTest {
  static func main() async throws {
    let output = """
    {"tldr":{"text":"Der Versuch soll die Fahrt verkürzen. Die Finanzierung ist noch offen.","evidenceIDs":[1,2]},
     "points":[{"role":"main","text":"Die neue Verbindung wird zunächst erprobt.","evidenceIDs":[1]},
               {"role":"positive","text":"Der Bund könnte sich an den Kosten beteiligen.","evidenceIDs":[2]},
               {"role":"critical","text":"Eine Entscheidung fällt erst nach der Auswertung. Die erwartete Verbesserung ist noch nicht nachgewiesen.","evidenceIDs":[3]}],
     "takeaway":{"text":"Der Versuch ist geplant, die Finanzierung nicht zugesagt.","evidenceIDs":[1,2]}}
    """
    let allowedEvidenceIDs: Set<Int> = [1,2,3]
    let full = GemmaSummary.result(from: output, sourceIncomplete: false, totalSections: 3, allowedEvidenceIDs: allowedEvidenceIDs)
    let body = full["summary"] as! [String: Any]
    let coverage = body["coverage"] as! [String: Any]
    precondition(body["model"] as? String == "Gemma 4 E4B")
    precondition((body["points"] as? [String])?.count == 3)
    precondition(body["tldr"] as? String == "Der Versuch soll die Fahrt verkürzen. Die Finanzierung ist noch offen.")
    precondition((body["points"] as? [String])?.last?.contains("noch nicht nachgewiesen") == true)
    precondition(body["takeaway"] as? String == "Der Versuch ist geplant, die Finanzierung nicht zugesagt.")
    let document = try GemmaSummaryDocument.decode(output, allowedEvidenceIDs: allowedEvidenceIDs)
    let rendered = document.markdown
    precondition(rendered.contains("## TLDR\\n") && rendered.contains("## Die wichtigsten Punkte\\n") && rendered.contains("## Das bleibt hängen\\n"),
      "Die geprüften JSON-Aussagen werden mit den etablierten drei Abschnitten dargestellt")
    let reparsed = OnDeviceSummary.parseSummary(rendered)!
    precondition(reparsed.tldr == body["tldr"] as? String && reparsed.points == body["points"] as? [String] && reparsed.takeaway == body["takeaway"] as? String)
    let publicJSON = String(decoding: try JSONSerialization.data(withJSONObject: full), as: UTF8.self)
    precondition(!publicJSON.contains("evidenceIDs"), "Belegmetadaten dürfen nicht in der sichtbaren Kurzfassung oder im Ergebnis-Cache stehen")
    precondition(coverage["processedSections"] as? Int == 3 && coverage["totalSections"] as? Int == 3)
    precondition(coverage["complete"] as? Bool == true && OnDeviceSummary.reusableResult(full))
    let dated = GemmaSummary.result(from: output, sourceIncomplete: false, totalSections: 3,
      allowedEvidenceIDs: allowedEvidenceIDs, sourceYear: "2025")
    let datedBody = dated["summary"] as! [String: Any]
    precondition(datedBody["caveat"] as? String == "Zeitbezug der Quelle: 2025.")
    precondition(datedBody["tldr"] as? String == body["tldr"] as? String &&
      datedBody["points"] as? [String] == body["points"] as? [String] && OnDeviceSummary.reusableResult(dated),
      "Der Quellenzeitbezug kommt als App-Hinweis hinzu und verändert keinen generierten Inhalt")
    let partial = GemmaSummary.result(from: output, sourceIncomplete: true, totalSections: 3, allowedEvidenceIDs: allowedEvidenceIDs)
    let partialBody = partial["summary"] as! [String: Any]
    precondition((partialBody["coverage"] as! [String: Any])["complete"] as? Bool == false)
    precondition((partialBody["caveat"] as? String)?.contains("unvollständige Untertitel") == true)
    precondition(!OnDeviceSummary.reusableResult(partial), "Eine Teilquelle ist kein vollständiger Cacheeintrag")
    let insufficient = GemmaSummary.result(from: " [ZU_WENIG_INHALT] ", sourceIncomplete: false, totalSections: 1, allowedEvidenceIDs: allowedEvidenceIDs)
    precondition(insufficient["code"] as? String == "INSUFFICIENT_CONTENT")
    for invalid in ["", "Eine freie Antwort ohne Struktur.", "## TLDR\\nNur ein Satz.",
      "<think>Ein Gedanke</think>\\n" + output, "<|channel>analysis\\n" + output,
      output.replacingOccurrences(of: "\\"evidenceIDs\\":[3]", with: "\\"evidenceIDs\\":[99]"),
      output.replacingOccurrences(of: "\\"evidenceIDs\\":[1,2]", with: "\\"evidenceIDs\\":[]"),
      output.replacingOccurrences(of: "\\"evidenceIDs\\":[2]", with: "\\"evidenceIDs\\":[true]"),
      output.replacingOccurrences(of: "\\"takeaway\\":", with: "\\"unexpected\\":")
    ] {
      let failure = GemmaSummary.result(from: invalid, sourceIncomplete: false, totalSections: 1, allowedEvidenceIDs: allowedEvidenceIDs)
      precondition(failure["code"] as? String == "GENERATION_FAILED")
      precondition(failure["summary"] == nil)
    }
    let source = OnDeviceSummary.prepare("Der Versuch ist geplant. Die Finanzierung ist noch offen.")
    let prompt = GemmaSummaryPolicy.prompt(for: source)
    precondition(prompt.components(separatedBy: source).count == 2, "Die vollständige Quelle muss genau einmal unverändert vorkommen")
    precondition(prompt.hasPrefix("<quellenmaterial>\\n[1] " + source + "\\n</quellenmaterial>\\n\\n"))
    let afterSource = prompt.components(separatedBy: "\\n</quellenmaterial>\\n\\n").last!
    precondition(!afterSource.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, "Nach dem Quellenende bleibt die eigentliche Aufgabe erhalten")
    let longSource = "ANFANG " + String(repeating: "Eine Bedingung bleibt offen. 漢字 🧪 ", count: 1300) + " SPÄTE EINSCHRÄNKUNG AM ENDE"
    let longPrompt = GemmaSummaryPolicy.prompt(for: longSource)
    precondition(GemmaEvidence.blocks(in: longSource).joined() == longSource, "Auch große Unicode-Quellen werden nicht gekürzt")
    precondition(longPrompt.contains("SPÄTE EINSCHRÄNKUNG AM ENDE"))
    let identity = GemmaModelStore.providerIdentity + ":" + GemmaSummaryPolicy.runtimeIdentity + ":" + GemmaSummaryPolicy.version + ":" + GemmaSummaryPolicy.instructions + ":" + GemmaSummaryPolicy.verificationPrompt
    let key = OnDeviceSummary.reuseKey(prompt, scope: "summary:" + identity)
    let cache = SummaryReuseCache()
    let data = try JSONSerialization.data(withJSONObject: full, options: [.sortedKeys])
    await cache.store(data, for: key)
    let hit = await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: cache, onProgress: nil)
    precondition(NSDictionary(dictionary: hit).isEqual(to: full), "Ein passender vollständiger Cachehit benötigt kein Modell")
    let partialReply = await GemmaSummary.reply(source: source, sourceIncomplete: true, cache: cache, onProgress: nil)
    precondition(partialReply["code"] as? String == "GEMMA_MODEL_NOT_READY", "Teilquellen dürfen den vollständigen Cachehit nicht übernehmen")
    precondition(partialReply["modelSetup"] as? Bool == true)
    let unchanged = await cache.data(for: key)
    precondition(unchanged == data)
    let datedSource = OnDeviceSummary.prepare("Dieser Bericht stammt aus dem Jahr 2025. Der Versuch ist geplant. Die Finanzierung ist noch offen.")
    let datedKey = OnDeviceSummary.reuseKey(GemmaSummaryPolicy.prompt(for: datedSource), scope: "summary:" + identity)
    let datedCache = SummaryReuseCache()
    await datedCache.store(try JSONSerialization.data(withJSONObject: dated, options: [.sortedKeys]), for: datedKey)
    let datedHit = await GemmaSummary.reply(source: datedSource, sourceIncomplete: false, cache: datedCache, onProgress: nil)
    precondition(NSDictionary(dictionary: datedHit).isEqual(to: dated),
      "Ein vollständiger Cachehit muss den sichtbaren App-Quellenzeitbezug erhalten, ohne ein Modell zu benötigen")
    let missing = await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: SummaryReuseCache(), onProgress: nil)
    precondition(missing["code"] as? String == "GEMMA_MODEL_NOT_READY")
    precondition(missing["modelSetup"] as? Bool == true && missing["summary"] == nil)
    precondition(!FileManager.default.fileExists(atPath: GemmaModelStore.localModelURL.path), "Ein Aufruf lädt kein Modell heimlich nach")
    let canceled = Task {
      try? await Task.sleep(nanoseconds: 5_000_000)
      return await GemmaSummary.reply(source: source, sourceIncomplete: false, cache: cache, onProgress: nil)
    }
    canceled.cancel()
    let canceledReply = await canceled.value
    precondition(canceledReply["code"] as? String == "CANCELLED")
    print("GEMMA_SUMMARY_CONTRACT_OK")
  }
}
`);
  const binary = path.join(directory, 'gemma-summary');
  const build = spawnSync('xcrun', ['swiftc', '-parse-as-library',
    '-target', `${process.arch}-apple-macosx26.0`, '-module-cache-path', path.join(directory, 'modules'),
    path.join(ios, 'OnDeviceSummary.swift'), path.join(ios, 'GemmaSummary.swift'),
    path.join(ios, 'GemmaSummaryPolicy.swift'), path.join(ios, 'GemmaEvidence.swift'),
    path.join(ios, 'GemmaSummaryDocument.swift'), path.join(ios, 'GemmaClaimValidation.swift'),
    path.join(ios, 'GemmaSummaryRepair.swift'),
    fixtureStore, harness, '-o', binary],
  { encoding: 'utf8', timeout: 75000 });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(binary, [path.join(directory, 'model-root')], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /GEMMA_SUMMARY_CONTRACT_OK/);
});

const id = 'abcdefghijk';
const track = { languageCode: 'de', baseUrl: 'https://www.youtube.com/api/timedtext?v=' + id + '&lang=de' };
const player = { videoDetails: { videoId: id }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [track] } } };
const captions = JSON.stringify({ events: [{ segs: [{ utf8: 'Die Finanzierung ist noch offen. Eine Entscheidung folgt nach dem Versuch.' }] }] });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function complete(model = 'Gemma 4 E4B') {
  return { summary: { model, tldr: 'Die Finanzierung ist offen.',
    points: ['Die Entscheidung folgt nach dem Versuch.'], takeaway: 'Die Finanzierung bleibt offen.',
    coverage: { complete: true, processedSections: 1, totalSections: 1 } } };
}
function environment(payload) {
  return { player, fetchText: async () => captions, summarize: async () => payload };
}
function ui(t, reply, native = true) {
  const dom = new JSDOM('<!doctype html><body><ytm-video-with-context-renderer><a href="/watch?v=' + id + '">Film</a></ytm-video-with-context-renderer></body>', { url: 'https://m.youtube.com/' });
  const win = dom.window;
  t.after(() => win.close());
  const requests = [], configurations = [];
  const respond = request => {
    if (request.action === 'configureGemma') { configurations.push(request); return; }
    requests.push(request);
    return typeof reply === 'function' ? reply(requests.length) : reply;
  };
  if (native) {
    win.webkit = { messageHandlers: { langformSummary: { postMessage(request) {
      const response = respond(request);
      if (response) win.__langformKurzFinish(request.id, response);
    } } } };
  } else {
    win.browser = { runtime: { sendMessage: async request => respond(request) } };
  }
  win.fetch = async href => ({ ok: true, text: async () => new URL(href).pathname === '/watch'
    ? 'ytInitialPlayerResponse=' + JSON.stringify(player) + ';' : captions });
  summary.decorate(win.document, win.location.href, win);
  return { win, requests, configurations,
    open() { win.document.querySelector('[data-langform-kurz="' + id + '"]').click(); },
    sheet() { return win.document.getElementById('langform-kurzfassung'); } };
}

test('nur die genaue Modellidentität wird durch den öffentlichen Kurzfassungspfad angezeigt', async () => {
  const known = await summary.loadSummary(id, environment(complete()));
  assert.equal(known.summary.model, 'Gemma 4 E4B');
  assert.equal(known.summary.coverage.complete, true);
  for (const unknown of ['Gemma', 'Apple Intelligence', '<img src=x onerror=alert(1)>']) {
    const result = await summary.loadSummary(id, environment(complete(unknown)));
    assert.equal(result.summary.model, undefined);
    assert.equal(result.summary.points.length, 1);
  }
});

test('fehlendes Modell bietet gezielte native Einrichtung; der Tipp erzeugt ausschließlich den Konfigurationsauftrag', async t => {
  const setup = { code: 'GEMMA_MODEL_NOT_READY', message: 'Das Google-Modell ist noch nicht bereit.', modelSetup: true };
  const env = ui(t, attempt => attempt === 1 ? setup : complete());
  env.open(); await tick();
  assert.equal(env.sheet().getAttribute('data-summary-state'), 'error');
  const button = env.sheet().querySelector('.langform-kurz-model-setup');
  assert.ok(button);
  assert.equal(button.textContent, 'Google-Modell einrichten');
  assert.equal(env.configurations.length, 0);
  button.click();
  assert.equal(env.requests.length, 1);
  assert.deepEqual(env.configurations, [{ action: 'configureGemma' }]);
  env.sheet().querySelector('.langform-kurz-retry').click(); await tick();
  assert.equal(env.requests.length, 2);
  assert.equal(env.sheet().getAttribute('data-summary-state'), 'ready');
  assert.equal(env.sheet().querySelector('.langform-kurz-model-setup'), null);
  assert.equal(env.sheet().querySelector('.langform-kurz-model').textContent, 'Gemma 4 E4B · Auf deinem iPhone');
});

test('Einrichtung benötigt den exakten Fehlervertrag und einen verfügbaren nativen Handler', async t => {
  for (const payload of [
    { code: 'GEMMA_MODEL_NOT_READY', message: 'Nicht bereit.', modelSetup: false },
    { code: 'GENERATION_FAILED', message: 'Fehlgeschlagen.', modelSetup: true }
  ]) {
    const result = await summary.loadSummary(id, environment(payload));
    assert.equal(result.modelSetup, undefined);
    const env = ui(t, payload);
    env.open(); await tick();
    assert.equal(env.sheet().querySelector('.langform-kurz-model-setup'), null);
  }
  const safari = ui(t, { code: 'GEMMA_MODEL_NOT_READY', message: 'Nicht bereit.', modelSetup: true }, false);
  safari.open(); await tick();
  assert.equal(safari.sheet().getAttribute('data-summary-state'), 'error');
  assert.equal(safari.sheet().querySelector('.langform-kurz-model-setup'), null);
});

test('Modellangabe und Teilquellenhinweis bleiben sichtbar, Teilresultate werden beim Wiederöffnen neu angefordert', async t => {
  const partial = complete();
  partial.summary.coverage.complete = false;
  partial.summary.caveat = 'Es standen unvollständige Untertitel zur Verfügung.';
  const env = ui(t, partial);
  env.open(); await tick();
  assert.equal(env.sheet().querySelector('.langform-kurz-model').textContent, 'Gemma 4 E4B · Auf deinem iPhone');
  assert.match(env.sheet().textContent, /unvollständige Untertitel/);
  assert.match(env.sheet().textContent, /Teil der verfügbaren Untertitel/);
  env.open(); await tick();
  assert.equal(env.requests.length, 2);
});
