const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const pinnedIdentity = 'E94E8C9CC2FF184832B68E4C02A332867D66F560';
const fixtureCertificate = Buffer.from('test certificate bytes; no real keychain access');
const fixtureIdentity = createHash('sha1').update(fixtureCertificate).digest('hex').toUpperCase();
const uuid = '12345678-1234-1234-1234-123456789abc';

function fixture(t, { identity = fixtureIdentity, revoked = false, profile = {}, missing = false } = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'langform-signing-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = path.join(home, 'bin');
  mkdirSync(bin);
  const profiles = path.join(home, 'Library/Developer/Xcode/UserData/Provisioning Profiles');
  mkdirSync(profiles, { recursive: true });
  const data = {
    identity,
    revoked,
    profile: {
      UUID: uuid,
      Name: 'Fixture profile',
      TeamIdentifier: ['RFN59MUTQ3'],
      Platform: ['iOS'],
      Entitlements: {
        'application-identifier': 'RFN59MUTQ3.de.ipekkaya.langform',
        'com.apple.developer.team-identifier': 'RFN59MUTQ3',
        'get-task-allow': true,
      },
      CreationDate: '2020-01-01T00:00:00',
      ExpirationDate: '2099-01-01T00:00:00',
      ProvisionedDevices: ['00008160-001234D11440000A'],
      DeveloperCertificates: [fixtureCertificate.toString('base64')],
      ...profile,
    },
  };
  const dataPath = path.join(home, 'fixture.json');
  writeFileSync(dataPath, JSON.stringify(data));
  if (!missing) writeFileSync(path.join(profiles, `${uuid}.mobileprovision`), 'fixture');
  writeFileSync(path.join(bin, 'security'), `#!/usr/bin/env python3
import base64, datetime, json, os, plistlib, sys
data = json.load(open(os.environ['LANGFORM_SIGNING_TEST_DATA']))
if sys.argv[1:] == ['find-identity', '-v', '-p', 'codesigning']:
    suffix = ' (CSSMERR_TP_CERT_REVOKED)' if data['revoked'] else ''
    print('  1) ' + data['identity'] + ' "Apple Development: Test"' + suffix)
    print('     1 valid identities found')
elif sys.argv[1:4] == ['cms', '-D', '-i']:
    profile = data['profile']
    for key in ['CreationDate', 'ExpirationDate']:
        if key in profile: profile[key] = datetime.datetime.fromisoformat(profile[key])
    profile['DeveloperCertificates'] = [base64.b64decode(value) for value in profile['DeveloperCertificates']]
    sys.stdout.buffer.write(plistlib.dumps(profile))
else:
    sys.exit('Unexpected security command: ' + repr(sys.argv))
`, { mode: 0o755 });
  const calls = path.join(home, 'xcode-calls');
  for (const command of ['xcodebuild', 'xcrun']) {
    writeFileSync(path.join(bin, command), '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$LANGFORM_SIGNING_TEST_CALLS"\nexit 71\n', { mode: 0o755 });
  }
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    LANGFORM_SIGNING_PROFILES_DIRECTORY: profiles,
    LANGFORM_SIGNING_TEST_DATA: dataPath,
    LANGFORM_SIGNING_TEST_CALLS: calls,
  };
  return {
    helper: () => spawnSync('python3', [path.join(root, 'scripts/check-iphone-signing.py'),
      '--identity', identity, '--team', 'RFN59MUTQ3', '--bundle', 'de.ipekkaya.langform',
      '--device', '00008160-001234D11440000A', '--profiles-directory', profiles], { env, encoding: 'utf8' }),
    deploy: () => spawnSync('bash', [path.join(root, 'scripts/deploy-iphone.sh'), '--build-only'], { env, encoding: 'utf8' }),
    assertNoXcode: () => assert.equal(existsSync(calls), false, 'failure must occur before Xcode or devicectl'),
  };
}

test('signing preflight accepts matching local profile and exact existing identity', (t) => {
  const state = fixture(t);
  const result = state.helper();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), uuid);
  state.assertNoXcode();
});

for (const [name, settings, reason] of [
  ['missing profiles', { missing: true }, /keine lokalen Provisioning-Profile/],
  ['expired profile', { profile: { ExpirationDate: '2000-01-01T00:00:00' } }, /Profil abgelaufen/],
  ['mismatched certificate', {}, /festes Zertifikat fehlt/],
  ['revoked identity even when security calls it valid', { revoked: true }, /nicht gültig verfügbar/],
]) {
  test(`deployment stops before Xcode for ${name}`, (t) => {
    const state = fixture(t, { identity: pinnedIdentity, ...settings });
    const result = state.deploy();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, reason);
    state.assertNoXcode();
  });
}

for (const [name, profile, reason] of [
  ['different team', { TeamIdentifier: ['OTHER'] }, /anderes Team/],
  ['different platform', { Platform: ['tvOS'] }, /kein iOS-Profil/],
  ['different app', { Entitlements: { 'com.apple.developer.team-identifier': 'RFN59MUTQ3', 'application-identifier': 'RFN59MUTQ3.other' } }, /andere App-ID/],
  ['unsupported capabilities', { Entitlements: { 'com.apple.developer.team-identifier': 'RFN59MUTQ3', 'application-identifier': 'RFN59MUTQ3.de.ipekkaya.langform', 'get-task-allow': true, 'aps-environment': 'development' } }, /zusätzliche Profil-Berechtigungen/],
  ['different device', { ProvisionedDevices: ['ANOTHER-DEVICE'] }, /SrTan fehlt/],
  ['future profile', { CreationDate: '2098-01-01T00:00:00' }, /noch nicht gültig/],
]) {
  test(`signing preflight rejects ${name}`, (t) => {
    const state = fixture(t, { profile });
    const result = state.helper();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, reason);
    state.assertNoXcode();
  });
}
