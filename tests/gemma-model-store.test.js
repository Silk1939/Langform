const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('Gemma-Dateiprüfung hält RSS beim tatsächlichen Hash einer großen Sparse-Datei begrenzt', { timeout: 90000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift/RSS-Test benötigt macOS');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-gemma-store-memory-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const productionStore = fs.readFileSync(process.env.LANGFORM_MODEL_STORE_MEMORY_SOURCE || path.join(__dirname, '../ios/Langform/Langform/GemmaModelStore.swift'), 'utf8');
  const start = productionStore.indexOf('enum GemmaModelError');
  const end = productionStore.indexOf('@MainActor\nfinal class GemmaModelStore');
  assert.ok(start >= 0 && end > start, 'Der Speicherprobe liegt der tatsächliche Datei-Validator zugrunde');
  const harness = path.join(directory, 'GemmaStoreMemory.swift');
  fs.writeFileSync(harness, `
import Foundation
import CryptoKit
import Darwin
${productionStore.slice(start, end)}
@main struct GemmaStoreMemory {
  static func main() throws {
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    let megabyte = 1_024 * 1_024
    let size = 300 * megabyte
    // A sparse zero-filled fixture exercises 75 actual Foundation reads. Its
    // independent expected hash needs only one reusable 1-MiB buffer.
    precondition(FileManager.default.createFile(atPath: url.path, contents: nil))
    let writer = try FileHandle(forWritingTo: url)
    try writer.truncate(atOffset: UInt64(size)); try writer.close()
    let zeros = Data(repeating: 0, count: megabyte)
    var expected = SHA256()
    for _ in 0..<300 { expected.update(data: zeros) }
    let digest = expected.finalize().map { String(format: "%02x", $0) }.joined()
    var cancellationChecks = 0
    let stamp = try GemmaModelFileValidator.validate(url, expectedBytes: Int64(size), expectedSHA256: digest) {
      cancellationChecks += 1
    }
    precondition(stamp.size == Int64(size) && cancellationChecks >= 77, "Die ganze große Datei muss geprüft werden")
    var usage = rusage()
    precondition(getrusage(RUSAGE_SELF, &usage) == 0)
    // Darwin reports bytes. Without a per-read autorelease pool, Foundation's
    // autoreleased NSData buffers retain roughly the whole 300-MiB fixture.
    print("GEMMA_VALIDATION_PEAK_RSS_BYTES=\\(usage.ru_maxrss)")
    precondition(usage.ru_maxrss < 100 * megabyte, "Die Modellprüfung darf ihre gelesenen Chunks nicht bis zum Task-Ende behalten")
    print("GEMMA_VALIDATION_MEMORY_OK")
  }
}
`);
  const binary = path.join(directory, 'gemma-store-memory');
  const build = spawnSync('xcrun', ['swiftc', '-O', '-swift-version', '6', '-parse-as-library',
    '-module-cache-path', path.join(directory, 'modules'), harness, '-o', binary],
  { encoding: 'utf8', timeout: 70000 });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(binary, [path.join(directory, 'large-sparse-model.litertlm')], { encoding: 'utf8', timeout: 15000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /GEMMA_VALIDATION_MEMORY_OK/);
  const peak = Number(run.stdout.match(/GEMMA_VALIDATION_PEAK_RSS_BYTES=(\d+)/)?.[1]);
  assert.ok(peak > 0 && peak < 100 * 1_024 * 1_024, `Gemessener Peak-RSS: ${peak}`);
  t.diagnostic(`300 MiB vollständig gehasht, Peak-RSS ${(peak / 1_024 / 1_024).toFixed(1)} MiB`);
});

test('Gemma prüft echte Dateigröße, Hash, Austausch und Abbruch ohne große Modellgewichte', { timeout: 90000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Swift benötigt macOS');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-gemma-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const productionStore = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/GemmaModelStore.swift'), 'utf8');
  const productionRoot = 'FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]';
  assert.ok(productionStore.includes(productionRoot));
  const fixtureStore = path.join(directory, 'GemmaModelStore.swift');
  fs.writeFileSync(fixtureStore, productionStore.replace(productionRoot,
    'URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)'));
  const blockedModelRoot = path.join(directory, 'blocked-model-root');
  fs.writeFileSync(blockedModelRoot, 'This regular file deliberately prevents the model directory preflight.');
  const harness = path.join(directory, 'GemmaStoreTest.swift');
  fs.writeFileSync(harness, `
import Foundation
import CryptoKit
import Combine
@main struct GemmaStoreTest {
  @MainActor static func main() async throws {
    let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let file = root.appendingPathComponent("fixture.litertlm")
    let data = Data(repeating: 37, count: 8 * 1_024 * 1_024 + 17)
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    let bytes = Int64(data.count)
    do { _ = try GemmaModelFileValidator.validate(file, expectedBytes: bytes, expectedSHA256: digest); preconditionFailure("missing") }
    catch GemmaModelError.missing {}
    try data.write(to: file)
    let validated = try GemmaModelFileValidator.validate(file, expectedBytes: bytes, expectedSHA256: digest)
    let unchanged = try GemmaModelFileValidator.stamp(for: file)
    precondition(validated == unchanged)
    do { _ = try GemmaModelFileValidator.validate(file, expectedBytes: bytes + 1, expectedSHA256: digest); preconditionFailure("size") }
    catch GemmaModelError.wrongSize(let expected, let actual) { precondition(expected == bytes + 1 && actual == bytes) }
    do { _ = try GemmaModelFileValidator.validate(file, expectedBytes: bytes, expectedSHA256: String(repeating: "0", count: 64)); preconditionFailure("hash") }
    catch GemmaModelError.wrongChecksum {}
    var checks = 0
    do {
      _ = try GemmaModelFileValidator.validate(file, expectedBytes: bytes, expectedSHA256: digest) {
        checks += 1
        if checks == 3 { throw CancellationError() }
      }
      preconditionFailure("cancel")
    } catch is CancellationError { precondition(checks == 3) }
    let link = root.appendingPathComponent("symlink.litertlm")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: file)
    do { _ = try GemmaModelFileValidator.validate(link, expectedBytes: bytes, expectedSHA256: digest); preconditionFailure("symlink") }
    catch GemmaModelError.unavailable {}
    checks = 0
    do {
      _ = try GemmaModelFileValidator.validate(file, expectedBytes: bytes, expectedSHA256: digest) {
        checks += 1
        if checks == 3 {
          try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(10)], ofItemAtPath: file.path)
        }
      }
      preconditionFailure("changed")
    } catch GemmaModelError.fileChanged {}
    let changed = try GemmaModelFileValidator.stamp(for: file)
    precondition(validated != changed)
    let replacement = root.appendingPathComponent("replacement.litertlm")
    try data.write(to: replacement)
    try FileManager.default.removeItem(at: file)
    try FileManager.default.moveItem(at: replacement, to: file)
    let replaced = try GemmaModelFileValidator.stamp(for: file)
    precondition(replaced != validated, "Gleiche Größe darf einen Austausch nicht verdecken")
    _ = try GemmaModelFileValidator.validate(file, expectedBytes: bytes, expectedSHA256: digest.uppercased())
    let staging = root.appendingPathComponent("staging", isDirectory: true)
    try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
    let abandoned = staging.appendingPathComponent(UUID().uuidString + ".pending")
    let active = staging.appendingPathComponent(UUID().uuidString + ".pending")
    let ownedDirectory = staging.appendingPathComponent(UUID().uuidString + ".pending", isDirectory: true)
    let unrelated = staging.appendingPathComponent("notes.pending")
    let oldModel = staging.appendingPathComponent("gemma-4-E2B-it.litertlm")
    let receipt = staging.appendingPathComponent("validated.json")
    let symbolic = staging.appendingPathComponent(UUID().uuidString + ".pending")
    for url in [abandoned, active, unrelated, oldModel, receipt] { try Data("keep or remove only by ownership".utf8).write(to: url) }
    try FileManager.default.createDirectory(at: ownedDirectory, withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(at: symbolic, withDestinationURL: oldModel)
    try GemmaModelFileValidator.removeAbandonedDownloads(in: staging, keeping: [active.lastPathComponent])
    precondition(!FileManager.default.fileExists(atPath: abandoned.path))
    for kept in [active, ownedDirectory, unrelated, oldModel, receipt, symbolic] {
      precondition(FileManager.default.fileExists(atPath: kept.path), "Wiederherstellung darf nur verwaiste eigene Stagingdateien löschen")
    }
    let preservedModel = try Data(contentsOf: oldModel)
    precondition(preservedModel == Data("keep or remove only by ownership".utf8))
    // Execute the real download preflight with a blocked fixture directory.
    // It fails before URLSession can start any transfer. Terminal publication
    // must already expose an idle store so SwiftUI can enable Retry.
    let store = GemmaModelStore()
    var errorsObserved = 0
    var terminalStillDownloading = false
    let observation = store.$status.sink { status in
      if case .error = status {
        errorsObserved += 1
        terminalStillDownloading = terminalStillDownloading || store.isDownloading
      }
    }
    await store.download()
    precondition(errorsObserved == 1 && !terminalStillDownloading)
    precondition(!store.isDownloading && !store.isBusy)
    await store.download()
    precondition(errorsObserved == 2 && !terminalStillDownloading, "Nach einem Fehler muss Retry direkt wieder möglich sein")
    withExtendedLifetime(observation) {}
    precondition(GemmaModelStore.expectedBytes == 3_659_530_240)
    precondition(GemmaModelStore.modelName == "Gemma 4 E4B" && GemmaModelStore.verifiedContextTokens == 8_192)
    precondition(GemmaModelStore.downloadURL.scheme == "https")
    precondition(GemmaModelStore.downloadURL.path.contains(GemmaModelStore.revision))
    precondition(GemmaModelStore.providerIdentity.contains(GemmaModelStore.expectedSHA256))
    precondition(GemmaModelStore.localModelURL.path.hasSuffix("GemmaModels/gemma-4-E4B-2eee7ac325f2/gemma-4-E4B-it.litertlm"))
    print("GEMMA_FILE_CONTRACT_OK")
  }
}
`);
  const binary = path.join(directory, 'gemma-store');
  const build = spawnSync('xcrun', ['swiftc', '-swift-version', '6', '-parse-as-library',
    '-module-cache-path', path.join(directory, 'modules'),
    fixtureStore, harness, '-o', binary],
  { encoding: 'utf8', timeout: 70000 });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(binary, [directory, blockedModelRoot], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /GEMMA_FILE_CONTRACT_OK/);
});
