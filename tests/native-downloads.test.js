const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const native = ['DownloadSource.swift', 'DownloadStore.swift', 'OfflineAssetValidator.swift', 'DownloadsView.swift'].map(name => path.join(project, 'ios/Langform/Langform', name));
const exercise = fs.readFileSync(path.join(__dirname, 'fixtures/DownloadNativeExercise.swift'), 'utf8');
const storeExercise = fs.readFileSync(path.join(__dirname, 'fixtures/DownloadStoreExercise.swift'), 'utf8');

function run(command, args, timeout = 60000) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

test('download native source policy, durable metadata and exact AVAsset validator run on Mac', { skip: process.platform !== 'darwin', timeout: 90000 }, t => {
  const swift = spawnSync('/usr/bin/xcrun', ['--find', 'swiftc'], { encoding: 'utf8' });
  if (swift.status !== 0) return t.skip('Swift toolchain unavailable');
  const encoder = spawnSync('/usr/bin/env', ['ffmpeg', '-version'], { encoding: 'utf8' });
  if (encoder.status !== 0) return t.skip('Local AVAsset fixtures require the existing ffmpeg installation');
  const sdk = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' });
  if (sdk.status !== 0) return t.skip('macOS SDK unavailable');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-download-native-'));
  try {
    const file = path.join(folder, 'Exercise.swift');
    const combined = path.join(folder, 'combined.mp4');
    const silent = path.join(folder, 'silent.mp4');
    const faststart = path.join(folder, 'faststart.mp4');
    const truncated = path.join(folder, 'truncated.mp4');
    fs.writeFileSync(file, exercise);
    run('/usr/bin/env', ['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=160x90:r=12:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', combined]);
    run('/usr/bin/env', ['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=160x90:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-y', silent]);
    run('/usr/bin/env', ['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=15:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-shortest', '-y', faststart]);
    const complete = fs.readFileSync(faststart);
    fs.writeFileSync(truncated, complete.subarray(0, Math.floor(complete.length / 2)));
    const executable = path.join(folder, 'download-tests');
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    run(swift.stdout.trim(), ['-parse-as-library', '-target', architecture + '-apple-macosx26.0', '-sdk', sdk.stdout.trim(), native[0], native[2], file, '-o', executable]);
    const output = run(executable, [combined, silent, faststart, truncated]);
    for (const marker of ['SOURCE_POLICY_10_CASES_OK', 'REAL_COMBINED_AVASSET_OK', 'INCOMPLETE_LENGTH_REJECTED', 'CORRUPT_FILE_REJECTED', 'EMPTY_FILE_REJECTED', 'MISSING_AUDIO_REJECTED', 'COMPLETE_FASTSTART_ACCEPTED', 'FASTSTART_TRUNCATION_REJECTED']) assert.ok(output.includes(marker), output);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('production Store executes concurrent budget, reconnect, durable finish, cancellation and restart recovery', { skip: process.platform !== 'darwin', timeout: 90000 }, t => {
  const swift = spawnSync('/usr/bin/xcrun', ['--find', 'swiftc'], { encoding: 'utf8' });
  if (swift.status !== 0) return t.skip('Swift toolchain unavailable');
  const encoder = spawnSync('/usr/bin/env', ['ffmpeg', '-version'], { encoding: 'utf8' });
  if (encoder.status !== 0) return t.skip('Local Store fixtures require the existing ffmpeg installation');
  const sdk = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' });
  if (sdk.status !== 0) return t.skip('macOS SDK unavailable');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-download-store-'));
  try {
    const file = path.join(folder, 'Exercise.swift');
    const store = path.join(folder, 'Store.swift');
    const combined = path.join(folder, 'combined.mp4');
    fs.writeFileSync(file, storeExercise);
    // Replace only iOS/session/volume boundaries. Actual Store methods,
    // manifest persistence and local media/file operations execute on Mac.
    const original = fs.readFileSync(process.env.LANGFORM_DOWNLOAD_STORE_SOURCE || native[1], 'utf8');
    const directoryExpression = 'FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]\n            .appendingPathComponent("OfflineVideos", isDirectory: true)';
    const capacityExpression = 'let values = try directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])';
    assert.ok(original.includes(directoryExpression) && original.includes(capacityExpression), 'platform adapter must match the shipping boundary');
    fs.writeFileSync(store, original.replace('import UIKit\n', '').split('/// Register with @UIApplicationDelegateAdaptor')[0]
      .replace(directoryExpression, 'fixtureDirectory')
      .replace(capacityExpression, 'let values = (volumeAvailableCapacityForImportantUsage: Optional(fixtureCapacity), ignored: false)'));
    run('/usr/bin/env', ['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=160x90:r=12:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', combined]);
    const executable = path.join(folder, 'store-tests');
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    run(swift.stdout.trim(), ['-parse-as-library', '-target', architecture + '-apple-macosx26.0', '-sdk', sdk.stdout.trim(), native[0], native[2], store, file, '-o', executable]);
    const output = run(executable, [folder, combined]);
    t.diagnostic(output.trim());
    for (const marker of ['PARALLEL_START_RECONNECT_CANCEL_BUDGET_OK', 'REAL_STORE_COMPLETE_RELAUNCH_AND_STALE_CANCEL_OK', 'REAL_STORE_PARTIAL_RESPONSE_REJECTED', 'FINISH_BEFORE_BACKGROUND_HANDOVER_OK', 'PENDING_AND_FINAL_CRASH_RECOVERY_OK', 'CANCEL_DURING_VALIDATION_AND_CORRUPT_MANIFEST_OK']) assert.ok(output.includes(marker), output);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('download UI, background delegate and AVAsset pipeline typecheck against the shipping iPhone SDK', { skip: process.platform !== 'darwin', timeout: 60000 }, t => {
  const sdk = spawnSync('/usr/bin/xcrun', ['--sdk', 'iphoneos', '--show-sdk-path'], { encoding: 'utf8' });
  if (sdk.status !== 0) return t.skip('iPhone SDK unavailable');
  run('/usr/bin/xcrun', ['swiftc', '-typecheck', '-target', 'arm64-apple-ios17.0', '-sdk', sdk.stdout.trim(), ...native]);
});
