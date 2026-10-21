const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const summary = require('../extension/src/summary.js');

const product = path.join(__dirname, '../ios/Langform/Langform');
let directory, binary, transport;

function body(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, marker);
  const opening = source.indexOf('{', start);
  let depth = 1;
  for (let index = opening + 1; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return source.slice(opening + 1, index);
  }
  assert.fail('Unclosed actual scene');
}

test.before(() => {
  if (process.platform !== 'darwin') return;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-summary-host-probe-'));
  binary = path.join(directory, 'probe');
  const scene = body(fs.readFileSync(path.join(product, 'LangformApp.swift'), 'utf8'), 'WindowGroup {');
  const harness = path.join(directory, 'HostProbe.swift');
  fs.writeFileSync(harness, `
import Foundation
@resultBuilder enum SceneRecorder {
  static func buildBlock(_ value: String) -> String { value }
  static func buildEither(first value: String) -> String { value }
  static func buildEither(second value: String) -> String { value }
}
func LangformRoot() -> String { "NORMAL_ROOT" }
func GemmaDiagnosticView() -> String { "ISOLATED_ROOT" }
@SceneRecorder func actualScene() -> String {
${scene}
}
@main struct HostProbeExercise {
  @MainActor static func main() throws {
    let marker = "--langform-summary-host-probe", key = "LANGFORM_SUMMARY_HOST_PROBE"
    let cases: [([String], [String: String], Bool)] = [
      ([], [:], false), ([marker], [:], false), ([], [key: "1"], false),
      ([marker], [key: "true"], false), ([marker], [key: "0"], false),
      ([marker], [key: " 1"], false), ([marker + "=1"], [key: "1"], false),
      ([marker], [key: "1"], true),
      ([marker, "--langform-gemma-diagnostic"], [key: "1"], true),
      ([marker], [key: "1", "LANGFORM_GEMMA_PROBE": "1"], true),
      ([marker, "--langform-gemma-diagnostic"], [key: "1", "LANGFORM_GEMMA_PROBE": "1"], false)
    ]
    for (arguments, environment, expected) in cases {
      precondition(GemmaSummaryHostProbeRequest.isRequested(arguments: arguments, environment: environment) == expected)
    }
    precondition(!GemmaSummaryHostProbe.enabled, "macOS must never enable an actual host model probe")
    try GemmaSummaryHostProbe.transportScript.write(toFile: CommandLine.arguments[1], atomically: true, encoding: .utf8)
    print(actualScene())
  }
}
`);
  const build = spawnSync('xcrun', ['swiftc', '-swift-version', '6', '-parse-as-library',
    '-module-cache-path', path.join(directory, 'modules'), path.join(product, 'GemmaDeviceProbe.swift'),
    harness, '-o', binary], { encoding: 'utf8', timeout: 60000 });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const environment = { ...process.env };
  delete environment.LANGFORM_GEMMA_PROBE;
  delete environment.LANGFORM_SUMMARY_HOST_PROBE;
  const output = path.join(directory, 'transport.js');
  const run = spawnSync(binary, [output, '--langform-summary-host-probe'], {
    env: { ...environment, LANGFORM_SUMMARY_HOST_PROBE: '1' }, encoding: 'utf8', timeout: 5000
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.stdout.trim(), 'NORMAL_ROOT', 'The host probe must retain the real product root');
  transport = fs.readFileSync(output, 'utf8');
});
test.after(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }); });

function page(url, payload) {
  const dom = new JSDOM('<!doctype html><body></body>', { url, runScripts: 'outside-only' });
  const requests = [], reports = [];
  let resolve;
  const complete = new Promise(done => { resolve = done; });
  dom.window.ShortsAusblenden = { summary };
  dom.window.webkit = { messageHandlers: {
    langformSummaryHostProbe: { postMessage(report) {
      reports.push(JSON.parse(JSON.stringify(report)));
      if (report.phase === 'complete' || report.phase === 'failed') resolve();
    } },
    langformSummary: { postMessage(request) {
      requests.push(JSON.parse(JSON.stringify(request)));
      // Only the external native boundary is controlled. The actual probe
      // executes shipping loadSummary, transcript parsing and ticket bridge.
      dom.window.__langformKurzUpdate(request.id, { progress: { phase: 'reading', processedSections: 0, totalSections: 1,
        sourceIncomplete: false, coverageIncomplete: false } });
      dom.window.__langformKurzFinish(request.id, payload);
    } }
  } };
  return { dom, requests, reports, complete };
}

test('Hostprobe bleibt im echten App-Root und benutzt tatsächlichen Caption- und WK-Tickettransport ohne Modellsubstitution', async t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/summary/bus-pilot-first-writer.json'), 'utf8'));
  const configuration = { nonce: 'host-test', videoID: 'abcdefghijk', text: fixture.source, expectedModel: 'Gemma 4 E4B' };
  const host = page('https://m.youtube.com/watch?v=abcdefghijk', {
    summary: { model: configuration.expectedModel, points: ['Der Testpunkt bleibt lokal.'], coverage: { complete: true } }
  });
  t.after(() => host.dom.window.close());
  const start = host.dom.window.eval(transport);
  assert.equal(start(configuration), true);
  await host.complete;
  assert.equal(host.requests.length, 1);
  assert.equal(typeof host.requests[0].id, 'string');
  assert.equal(host.requests[0].text, fixture.source.replace(/\s+/g, ' ').trim());
  assert.equal(host.requests[0].sourceIncomplete, false);
  assert.deepEqual(host.reports.map(report => report.phase), ['started', 'progress', 'complete']);
  assert.deepEqual(host.reports.at(-1), { nonce: 'host-test', phase: 'complete', code: '',
    model: configuration.expectedModel, complete: true, pointCount: 1 });
  assert.equal(start(configuration), false, 'A second launch cannot create a second model ticket in the same document');
  assert.equal(host.requests.length, 1);
  assert.ok(host.reports.every(report => Object.keys(report).sort().join(',') === 'code,complete,model,nonce,phase,pointCount'));
  assert.equal(JSON.stringify(host.reports).includes(fixture.source), false);
});

test('Hostprobe bindet Dokument/Video und überträgt native Speicherfehler ohne Quell- oder Fehlervolltext', async t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const config = { nonce: 'failure-test', videoID: 'zyxwvutsrqp', text: 'Lokale vertrauliche Kontrollquelle mit ausreichend Inhalt für das Transkript.', expectedModel: 'Gemma 4 E4B' };
  for (const url of ['https://example.com/watch?v=zyxwvutsrqp', 'http://m.youtube.com/watch?v=zyxwvutsrqp',
    'https://m.youtube.com/', 'https://m.youtube.com/watch?v=abcdefghijk']) {
    const host = page(url, {});
    assert.equal(host.dom.window.eval(transport)(config), false);
    assert.equal(host.requests.length, 0);
    assert.equal(host.reports.length, 0);
    host.dom.window.close();
  }
  const host = page('https://m.youtube.com/watch?v=zyxwvutsrqp', {
    code: 'INSUFFICIENT_MEMORY', message: 'PRIVATE_NATIVE_FAILURE source/path/secret'
  });
  t.after(() => host.dom.window.close());
  assert.equal(host.dom.window.eval(transport)(config), true);
  await host.complete;
  assert.equal(host.requests.length, 1);
  assert.deepEqual(host.reports.at(-1), { nonce: config.nonce, phase: 'complete', code: 'INSUFFICIENT_MEMORY',
    model: '', complete: false, pointCount: 0 });
  assert.doesNotMatch(JSON.stringify(host.reports), /PRIVATE_NATIVE_FAILURE|Kontrollquelle|source\/path/);
});
