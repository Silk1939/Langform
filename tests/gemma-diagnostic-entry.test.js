const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const product = path.join(__dirname, '../ios/Langform/Langform');

// Use a complete actual source block, preserving its conditions and branches.
// The scene's two View initializers are replaced by recording functions below;
// neither SwiftUI, UIKit nor a native model is started in this macOS harness.
function block(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `Missing actual source marker: ${marker}`);
  const opening = source.indexOf('{', start);
  let depth = 1;
  for (let cursor = opening + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '{') depth += 1;
    if (source[cursor] === '}' && --depth === 0) return source.slice(opening + 1, cursor);
  }
  assert.fail(`Unclosed actual source block: ${marker}`);
}

test('Gemma-Diagnose benötigt im tatsächlichen Swift-Gate und App-Szenenzweig beide ausdrücklichen Startmerkmale', { timeout: 100000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-gemma-diagnostic-entry-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const probe = fs.readFileSync(path.join(product, 'GemmaDeviceProbe.swift'), 'utf8');
  const app = fs.readFileSync(path.join(product, 'LangformApp.swift'), 'utf8');
  const scene = block(app, 'WindowGroup {');
  const explicitEntry = block(probe, 'static func runExplicitDiagnostic()');
  assert.match(explicitEntry, /guard\s+!started,\s*GemmaDiagnosticRequest\.isRequested\(\)\s+else\s*\{\s*return\s*\}/,
    'Auch ein direkter Diagnoseaufruf muss denselben tatsächlichen Gate erneut prüfen');
  assert.doesNotMatch(scene, /YouTubeWebView|GemmaDeviceProbe/,
    'Die Scene wählt nur die eigene native Diagnoseview oder die normale Produktview');
  assert.match(scene, /GemmaDiagnosticRequest\.isRequested\(\)/);
  assert.doesNotMatch(block(app, 'struct LangformRoot: View'), /GemmaDeviceProbe/,
    'Der normale Produktroot darf keine Probe starten');
  const diagnosticView = block(app, 'struct GemmaDiagnosticView: View');
  assert.match(diagnosticView, /GemmaDeviceProbe\.runExplicitDiagnostic\(\)/);
  assert.doesNotMatch(diagnosticView, /YouTubeWebView|DownloadStore|\.onOpenURL/,
    'Die angeforderte Diagnose initialisiert weder Webfeed noch normale Produktnavigation');
  const actualProbe = path.join(directory, 'GemmaDeviceProbe.swift');
  fs.writeFileSync(actualProbe, probe);
  const harness = path.join(directory, 'DiagnosticEntry.swift');
  fs.writeFileSync(harness, `
import Foundation
@resultBuilder enum SceneRecorder {
  static func buildBlock(_ value: String) -> String { value }
  static func buildEither(first value: String) -> String { value }
  static func buildEither(second value: String) -> String { value }
}
func LangformRoot() -> String { "NORMAL_ROOT" }
func GemmaDiagnosticView() -> String { "EXPLICIT_GEMMA_DIAGNOSTIC" }
@SceneRecorder func actualScene() -> String {
${scene}
}
@main struct DiagnosticEntry {
  static func main() {
    let argument = "--langform-gemma-diagnostic"
    let flag = "LANGFORM_GEMMA_PROBE"
    let requests: [([String], [String: String], Bool)] = [
      (["Langform"], [:], false),
      (["Langform", argument], [:], false),
      (["Langform"], [flag: "1"], false),
      (["Langform", argument], [flag: "1"], true),
      (["Langform", "--langform-gemma-diagnostic=1"], [flag: "1"], false),
      (["Langform", "--LANGFORM-GEMMA-DIAGNOSTIC"], [flag: "1"], false),
      (["Langform", argument], [flag: "true"], false),
      (["Langform", argument], [flag: "0"], false),
      (["Langform", argument], [flag: " 1"], false),
      (["Langform", argument], [flag: "1 "], false),
      (["Langform"], ["LANGFORM_DIAGNOSTICS": "1", flag: "1"], false),
      (["Langform", argument], ["LANGFORM_DIAGNOSTICS": "1"], false)
    ]
    for (arguments, environment, expected) in requests {
      precondition(GemmaDiagnosticRequest.isRequested(arguments: arguments, environment: environment) == expected,
        "Unexpected diagnostic permission for arguments/environment pair")
    }
    print(actualScene())
  }
}
`);
  const binary = path.join(directory, 'diagnostic-entry');
  const build = spawnSync('xcrun', ['swiftc', '-swift-version', '6', '-parse-as-library',
    '-module-cache-path', path.join(directory, 'modules'), actualProbe, harness, '-o', binary],
  { encoding: 'utf8', timeout: 80000 });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const cleanEnvironment = { ...process.env };
  delete cleanEnvironment.LANGFORM_GEMMA_PROBE;
  delete cleanEnvironment.LANGFORM_DIAGNOSTICS;
  delete cleanEnvironment.LANGFORM_SUMMARY_HOST_PROBE;
  for (const [arguments_, environment, expected] of [
    [[], {}, 'NORMAL_ROOT'],
    [['--langform-gemma-diagnostic'], {}, 'NORMAL_ROOT'],
    [[], { LANGFORM_GEMMA_PROBE: '1' }, 'NORMAL_ROOT'],
    [[], { LANGFORM_DIAGNOSTICS: '1', LANGFORM_GEMMA_PROBE: '1' }, 'NORMAL_ROOT'],
    [['--langform-gemma-diagnostic'], { LANGFORM_GEMMA_PROBE: 'true' }, 'NORMAL_ROOT'],
    [['--langform-gemma-diagnostic'], { LANGFORM_GEMMA_PROBE: '1' }, 'EXPLICIT_GEMMA_DIAGNOSTIC']
  ]) {
    const run = spawnSync(binary, arguments_, { encoding: 'utf8', timeout: 5000, env: { ...cleanEnvironment, ...environment } });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.equal(run.stdout.trim(), expected,
      `Unexpected actual scene for ${JSON.stringify({ arguments: arguments_, environment })}`);
  }
});

test('native Gemma-Stufen werden ausschließlich nach Doppel-Opt-in lokal und ohne Freitext protokolliert', { timeout: 100000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-gemma-native-trace-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const runtime = fs.readFileSync(path.join(product, 'GemmaRuntime.swift'), 'utf8');
  const declaration = 'enum GemmaDiagnosticTrace {' + block(runtime, 'enum GemmaDiagnosticTrace') + '}';
  const calls = [...runtime.matchAll(/GemmaDiagnosticTrace\.record\(([^\n]*)\)/g)];
  assert.ok(calls.length >= 10, 'Die tatsächlichen nativen Lade-/Generierungsschritte benötigen ihre eigenen Messpunkte');
  for (const call of calls) {
    assert.match(call[1], /^"[a-z0-9._-]+"$/,
      'Runtime-Messpunkte dürfen ausschließlich feste Operationsnamen übergeben, keinen Prompt oder Modelltext');
  }
  for (const stage of ['model-info.start', 'engine.create.start', 'engine.create.ok',
    'conversation.create.start', 'conversation.create.ok', 'render.preface.start', 'render.message.start',
    'tokenize.start', 'stream.start', 'callback.error', 'callback.final']) {
    assert.ok(calls.some(call => call[1] === JSON.stringify(stage)), `Fehlender nativer Messpunkt: ${stage}`);
  }
  const source = path.join(directory, 'Trace.swift');
  fs.writeFileSync(source, 'import Foundation\n' + declaration);
  const harness = path.join(directory, 'TraceExercise.swift');
  fs.writeFileSync(harness, `
import Foundation
@main struct TraceExercise {
  static func main() {
    let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    GemmaDiagnosticTrace.record("engine.create.start", directory: directory)
    for invalid in ["PRIVATE_SOURCE sentence", "private\\nsource", "../private/source", "source:private", "Quelle ä", ""] {
      GemmaDiagnosticTrace.record(invalid, directory: directory)
    }
    DispatchQueue.concurrentPerform(iterations: 32) { index in
      GemmaDiagnosticTrace.record("callback.\\(index)", directory: directory)
    }
    GemmaDiagnosticTrace.record("callback.final", directory: directory)
  }
}
`);
  const binary = path.join(directory, 'trace-exercise');
  const build = spawnSync('xcrun', ['swiftc', '-swift-version', '6', '-parse-as-library',
    '-module-cache-path', path.join(directory, 'modules'), source, harness, '-o', binary],
  { encoding: 'utf8', timeout: 80000 });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const cleanEnvironment = { ...process.env };
  delete cleanEnvironment.LANGFORM_GEMMA_PROBE;
  delete cleanEnvironment.LANGFORM_DIAGNOSTICS;
  delete cleanEnvironment.LANGFORM_SUMMARY_HOST_PROBE;
  for (const [index, [arguments_, environment, requested]] of [
    [[], {}, false],
    [['--langform-gemma-diagnostic'], {}, false],
    [[], { LANGFORM_GEMMA_PROBE: '1' }, false],
    [[], { LANGFORM_DIAGNOSTICS: '1', LANGFORM_GEMMA_PROBE: '1' }, false],
    [['--langform-gemma-diagnostic'], { LANGFORM_GEMMA_PROBE: '1' }, true],
    [['--langform-summary-host-probe'], {}, false],
    [[], { LANGFORM_SUMMARY_HOST_PROBE: '1' }, false],
    [['--langform-summary-host-probe'], { LANGFORM_SUMMARY_HOST_PROBE: 'true' }, false],
    [['--langform-summary-host-probe'], { LANGFORM_SUMMARY_HOST_PROBE: '1' }, true]
  ].entries()) {
    const outputDirectory = path.join(directory, `run-${index}`);
    const run = spawnSync(binary, [outputDirectory, ...arguments_],
      { encoding: 'utf8', timeout: 5000, env: { ...cleanEnvironment, ...environment } });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    if (!requested) {
      assert.equal(fs.existsSync(outputDirectory), false,
        'Ohne beide Merkmale darf der tatsächliche Trace weder Ordner noch Datei anlegen');
      continue;
    }
    const content = fs.readFileSync(path.join(outputDirectory, 'runtime-trace.jsonl'), 'utf8');
    const rows = content.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(rows.length, 34, 'Parallele native Callbacks müssen vollständige, getrennte JSON-Zeilen behalten');
    assert.deepEqual(new Set(rows.map(row => row.stage)),
      new Set(['engine.create.start', ...Array.from({ length: 32 }, (_, i) => `callback.${i}`), 'callback.final']));
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), ['elapsedSeconds', 'stage']);
      assert.equal(typeof row.elapsedSeconds, 'number');
      assert.ok(row.elapsedSeconds >= 0);
    }
    assert.doesNotMatch(content, /PRIVATE_SOURCE|private|Quelle/);
  }
});

test('tatsächlicher Gemma-Probeexport erhält Fehlerstufe, native Ursache und Messwerte statt nur der öffentlichen Fehlermeldung', { timeout: 100000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-gemma-probe-export-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const probe = fs.readFileSync(path.join(product, 'GemmaDeviceProbe.swift'), 'utf8');
  // Retain the actual report, stage, error, runtime-copy and persistence code.
  // Only the iOS-only available-app-memory call is substituted; this test makes
  // no claim about an iPhone's memory budget, model viability or summary quality.
  const measurement = ('@MainActor private final class Measurement {' +
    block(probe, '@MainActor private final class Measurement') + '}')
    .replace('UInt64(os_proc_available_memory())', 'UInt64(0)');
  const selectionHandler = block(probe, '}, onSelection: { selection in').replace(/^\s*selection in/, '');
  const writerHandler = block(probe, '}, onWritten: { output in').replace(/^\s*output in/, '');
  const appRepairHandler = block(probe, '}, onAppRepair: { document in').replace(/^\s*document in/, '');
  const swift = ['-module-cache-path', path.join(directory, 'modules')];
  fs.writeFileSync(path.join(directory, 'LiteRTLM.swift'), 'public enum ProbeExportMarker {}\n');
  const marker = spawnSync('xcrun', ['swiftc', ...swift, '-emit-module', '-module-name', 'LiteRTLM',
    path.join(directory, 'LiteRTLM.swift'), '-emit-module-path', path.join(directory, 'LiteRTLM.swiftmodule')],
  { encoding: 'utf8', timeout: 25000 });
  assert.equal(marker.status, 0, marker.stdout + marker.stderr);
  const harness = path.join(directory, 'ProbeExport.swift');
  fs.writeFileSync(harness, `
import Foundation
import Darwin
enum GemmaSummaryPolicy {
  static let version = "export-test-only"
  static let runtimeIdentity = "export-runtime"
  static let selectionTokenLimit = 512
  static let selectionThinkingTokens = 256
  static let writerTokenLimit = 1100
  static let writerThinkingTokens = 0
  static let correctionTokenLimit = 900
  static let correctionThinkingTokens = 256
}
enum GemmaModelStore {
  static let runtimeBackend = "cpu"
  static let verifiedContextTokens: Int? = 8192
  static let modelName = "fixture-model"
  static let providerIdentity = "fixture-provider"
}
enum OnDeviceSummary {
  struct Progress { let phase: String; let payload: [String: Any] }
}
struct ExportMetrics: Codable, Sendable { let decodeTokens: Int }
actor GemmaRuntime {
  static let shared = GemmaRuntime()
  let lastFailure: String? = "underlying-native-fixture-error"
  private(set) var lastMetrics: ExportMetrics? = .init(decodeTokens: 7)
  func setMetrics(_ tokens: Int) { lastMetrics = .init(decodeTokens: tokens) }
}
${measurement}
@MainActor private func captureActualSelection(_ selection: String, run: Measurement, preparedSource: String) async {
${selectionHandler}
}
@MainActor private func captureActualWriter(_ output: String, run: Measurement) async {
${writerHandler}
}
@MainActor private func captureActualAppRepair(_ document: String, run: Measurement) async {
${appRepairHandler}
}
enum NativeFailure: Error, LocalizedError {
  case generation(String)
  var errorDescription: String? { "Native generation fixture failure" }
}
@main struct ProbeExport {
  @MainActor static func main() async throws {
    let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let smoke = Measurement(directory: root.appendingPathComponent("smoke"), mode: "smoke")
    smoke.stage("generatingSmoke")
    smoke.report["status"] = "failed"
    smoke.report["failureCode"] = "PROBE_RUNTIME_ERROR"
    smoke.recordTechnicalFailure(NativeFailure.generation("NATIVE_DETAIL_FIXTURE"))
    await smoke.captureRuntimeState()
    smoke.persist()
    let summary = Measurement(directory: root.appendingPathComponent("summary"), mode: "summary")
    summary.stage("generatingSummary")
    let preparedSource = "Die Sprecher finden die Gestaltung gelungen und kritisieren die schlechte Nachtruhe."
    await captureActualSelection(#"{"verdict":[1],"positive":[],"critical":[],"context":[]}"#, run: summary, preparedSource: preparedSource)
    await GemmaRuntime.shared.setMetrics(11)
    await captureActualWriter("rejected-first-writer", run: summary)
    await GemmaRuntime.shared.setMetrics(13)
    await captureActualWriter("accepted-correction-writer", run: summary)
    await captureActualAppRepair("explicit-app-repaired-document", run: summary)
    await summary.captureRuntimeState()
    summary.record(.init(phase: "reading", payload: ["progress": ["phase": "reading"]]))
    summary.interrupted = true
    summary.record(.init(phase: "writing", payload: ["progress": ["phase": "writing"]]))
    summary.persist()
    let invalid = Measurement(directory: root.appendingPathComponent("invalid-selection"), mode: "summary")
    await captureActualSelection(#"{"verdict":[99999],"positive":[],"critical":[],"context":[]}"#, run: invalid, preparedSource: preparedSource)
    invalid.persist()
  }
}
`);
  const binary = path.join(directory, 'probe-export');
  const build = spawnSync('xcrun', ['swiftc', ...swift, '-swift-version', '6', '-I', directory,
    '-parse-as-library', path.join(product, 'GemmaEvidence.swift'), harness, '-o', binary],
  { encoding: 'utf8', timeout: 70000 });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const output = path.join(directory, 'reports');
  const run = spawnSync(binary, [output], { encoding: 'utf8', timeout: 5000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const smoke = JSON.parse(fs.readFileSync(path.join(output, 'smoke/result.json'), 'utf8'));
  assert.equal(smoke.schemaVersion, 3);
  assert.equal(smoke.stage, 'generatingSmoke');
  assert.equal(smoke.failureStage, 'generatingSmoke');
  assert.equal(smoke.failureCode, 'PROBE_RUNTIME_ERROR');
  assert.match(smoke.errorReflection, /NativeFailure\.generation\("NATIVE_DETAIL_FIXTURE"\)/);
  assert.equal(smoke.errorLocalizedDescription, 'Native generation fixture failure');
  assert.match(smoke.errorDomain, /NativeFailure/);
  assert.equal(typeof smoke.errorCode, 'number');
  assert.equal(smoke.runtimeLastFailure, 'underlying-native-fixture-error');
  assert.deepEqual(smoke.nativeMetrics, { decodeTokens: 7 });
  assert.equal(smoke.nativeEvidenceMetrics, undefined,
    'Ohne tatsächlichen Selectioncallback darf kein veralteter Draft als Quellenwahl ausgegeben werden');
  assert.equal(smoke.runtimeTraceFile, 'runtime-trace.jsonl');
  assert.equal(smoke.sourceFileRequired, false);
  assert.equal(smoke.freshReuseCache, false);
  assert.equal(smoke.semanticAcceptance, false);
  assert.equal(smoke.complete, false);
  assert.equal(smoke.status, 'failed');
  assert.ok(smoke.memory.some(row => row.phase === 'generatingSmoke'));
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'summary/result.json'), 'utf8'));
  assert.equal(summary.sourceFileRequired, true);
  assert.equal(summary.freshReuseCache, true);
  assert.equal(summary.semanticAcceptance, false);
  assert.equal(summary.selectionOutputTokenLimit, 512);
  assert.equal(summary.selectionThinkingTokenBudget, 256);
  assert.equal(summary.writerOutputTokenLimit, 1100);
  assert.equal(summary.writerThinkingTokenBudget, 0);
  assert.equal(summary.correctionOutputTokenLimit, 900);
  assert.equal(summary.selectionCallbackReceived, true);
  assert.equal(summary.evidencePlan, '{"verdict":[1],"positive":[],"critical":[],"context":[]}');
  assert.equal(summary.sourceSelectionVerified, true);
  assert.deepEqual(summary.nativeEvidenceMetrics, { decodeTokens: 7 },
    'Die tatsächlichen Auswahlmesswerte müssen den späteren Writer-Metrikwechsel überleben');
  assert.deepEqual(summary.nativeMetrics, { decodeTokens: 13 });
  assert.equal(summary.writerAttemptCount, 2);
  assert.equal(summary.appRepairCount, 1);
  assert.deepEqual(summary.appRepairedDocuments, ['explicit-app-repaired-document'],
    'Die App-Transformation muss getrennt von den beiden tatsächlichen nativen Writerantworten erhalten bleiben');
  assert.equal(summary.writerOutput, 'accepted-correction-writer');
  assert.deepEqual(summary.writerAttempts.map(value => [value.index, value.raw, value.nativeMetrics]), [
    [1, 'rejected-first-writer', { decodeTokens: 11 }],
    [2, 'accepted-correction-writer', { decodeTokens: 13 }]
  ], 'Der abgelehnte Entwurf und seine eigenen Metriken müssen neben der Korrektur erhalten bleiben');
  assert.deepEqual(summary.progress.map(row => row.phase), ['reading'],
    'Ein nachträglicher Fortschritt darf den unterbrochenen Diagnosebericht nicht wieder auf writing setzen');
  const invalid = JSON.parse(fs.readFileSync(path.join(output, 'invalid-selection/result.json'), 'utf8'));
  assert.equal(invalid.selectionCallbackReceived, true);
  assert.equal(invalid.evidencePlan, '{"verdict":[99999],"positive":[],"critical":[],"context":[]}');
  assert.equal(invalid.sourceSelectionVerified, false);
  assert.match(invalid.sourceSelectionVerificationError, /GemmaEvidenceError\.ungrounded/);
});
