const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const native = path.join(project, 'ios/Langform/Langform');
const fixture = path.join(__dirname, 'fixtures/DownloadResolverExercise.swift');

function run(command, args, timeout = 90000) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

test('shipping EJS resources match pinned official byte lengths and SHA3-512 with retained licenses', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(project, 'docs/qa/download-resolver-2026-10-11/product-bundles.json'), 'utf8'));
  for (const item of manifest) {
    assert.equal(item.version, '0.8.0');
    assert.equal(item.officialYtDlpChecksumMatched, true);
    const data = fs.readFileSync(path.join(native, item.productResource));
    assert.equal(data.length, item.bytes);
    assert.equal(crypto.createHash('sha3-512').update(data).digest('hex'), item.sha3_512);
  }
  const notices = fs.readFileSync(path.join(native, 'ThirdPartyLicensing.txt'), 'utf8');
  for (const notice of ['Unlicense', 'meriyah 6.1.4 (ISC)', 'astring 1.9.0 (MIT)', 'Permission', 'WARRANT']) assert.ok(notices.includes(notice));
});

test('actual shipping Swift resolver runs pinned EJS in real Mac WebKit with transport, cache, identity, expiry and cancellation cases', { skip: process.platform !== 'darwin', timeout: 120000 }, t => {
  const sdk = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' });
  if (sdk.status !== 0) return t.skip('macOS SDK unavailable');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-download-resolver-'));
  try {
    const executable = path.join(folder, 'resolver-tests');
    const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    run('/usr/bin/xcrun', ['swiftc', '-parse-as-library', '-target', arch + '-apple-macosx26.0', '-sdk', sdk.stdout.trim(),
      path.join(native, 'DownloadSource.swift'), path.join(native, 'DownloadSourceResolver.swift'), fixture, '-o', executable]);
    const output = run(executable, [native], 60000);
    t.diagnostic(output.trim());
    for (const marker of ['REAL_SHIPPING_WEBKIT_EJS_N_AND_SIGNATURE_OK', 'EXACT_PLAYER_CACHE_REUSE_AND_TWO_ENTRY_EVICTION_OK',
      'PLAYER_URL_VIDEO_EXPIRY_AND_SIGNATURE_PARAMETER_GUARDS_OK', 'SCRIPT_HTTP_DECLARED_ACTUAL_LIMIT_AND_FINAL_EXPIRY_GUARDS_OK',
      'CANCEL_AND_BOUNDED_DEADLINE_COMPLETE_EXACTLY_ONCE_OK', 'REPLACED_JOB_CANNOT_OVERWRITE_NEW_RESOLUTION_OK']) assert.ok(output.includes(marker), output);
    for (const marker of ['FAILED_PLAYER_IS_NOT_CACHED_AND_RETRY_RECOVERS_OK', 'REENTRANT_CANCEL_CALLBACK_PRESERVES_NEWEST_JOB_OK']) assert.ok(output.includes(marker), output);
    assert.ok(output.includes('OBSERVED_COMPLETE_SOURCE_IS_NOT_TRANSFORMED_TWICE_OK'), output);
    assert.ok(output.includes('WEBKIT_JSON_NULL_CIPHER_FIELDS_ARE_OPTIONAL_OK'), output);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('shipping Swift resolver typechecks against the existing iPhone SDK', { skip: process.platform !== 'darwin', timeout: 60000 }, t => {
  const sdk = spawnSync('/usr/bin/xcrun', ['--sdk', 'iphoneos', '--show-sdk-path'], { encoding: 'utf8' });
  if (sdk.status !== 0) return t.skip('iPhone SDK unavailable');
  run('/usr/bin/xcrun', ['swiftc', '-typecheck', '-target', 'arm64-apple-ios17.0', '-sdk', sdk.stdout.trim(),
    path.join(native, 'DownloadSource.swift'), path.join(native, 'DownloadSourceResolver.swift')]);
});
