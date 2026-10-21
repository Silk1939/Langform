const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } = require('node:fs');
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
    home, bin, profiles, dataPath, env,
    helper: () => spawnSync('python3', [path.join(root, 'scripts/check-iphone-signing.py'),
      '--identity', identity, '--team', 'RFN59MUTQ3', '--bundle', 'de.ipekkaya.langform',
      '--device', '00008160-001234D11440000A', '--profiles-directory', profiles], { env, encoding: 'utf8' }),
    deploy: () => spawnSync('bash', [path.join(root, 'scripts/deploy-iphone.sh'), '--build-only'], { env, encoding: 'utf8' }),
    assertNoXcode: () => assert.equal(existsSync(calls), false, 'failure must occur before Xcode or devicectl'),
  };
}

const trustedFixtureRuntime = Buffer.concat([Buffer.from('cffaedfe', 'hex'), Buffer.from('approved fixture runtime')]);
const normalizedFixtureRuntime = Buffer.concat([Buffer.from('cffaedfe', 'hex'), Buffer.from('approved normalized fixture runtime')]);

function writePlist(file, value) {
  const result = spawnSync('python3', ['-c', 'import json, plistlib, sys; sys.stdout.buffer.write(plistlib.dumps(json.load(sys.stdin)))'],
    { input: JSON.stringify(value) });
  assert.equal(result.status, 0, result.stderr.toString());
  writeFileSync(file, result.stdout);
}

function signingFixture(t, { runtime = true, frameworkInfo = {}, runtimeBytes = trustedFixtureRuntime, mock = {} } = {}) {
  const state = fixture(t);
  const app = path.join(state.home, 'Langform.app');
  mkdirSync(app);
  writePlist(path.join(app, 'Info.plist'), {
    CFBundleIdentifier: 'de.ipekkaya.langform', CFBundlePackageType: 'APPL', CFBundleExecutable: 'Langform',
  });
  writeFileSync(path.join(app, 'Langform'), Buffer.concat([Buffer.from('cffaedfe', 'hex'), Buffer.from('fixture app')]));
  const framework = path.join(app, 'Frameworks/CLiteRTLM.framework');
  if (runtime) {
    mkdirSync(framework, { recursive: true });
    writePlist(path.join(framework, 'Info.plist'), {
      CFBundleIdentifier: 'com.google.odml.litertlm.CLiteRTLM', CFBundlePackageType: 'FMWK',
      CFBundleExecutable: 'CLiteRTLM', CFBundleSupportedPlatforms: ['iPhoneOS'], ...frameworkInfo,
    });
    writeFileSync(path.join(framework, 'CLiteRTLM'), runtimeBytes);
  }
  const data = JSON.parse(readFileSync(state.dataPath, 'utf8'));
  data.signingMock = mock;
  writeFileSync(state.dataPath, JSON.stringify(data));
  const codeCalls = path.join(state.home, 'codesign-calls.jsonl');
  writeFileSync(path.join(state.bin, 'codesign'), `#!/usr/bin/env python3
import base64, json, os, pathlib, plistlib, sys
args = sys.argv[1:]
data = json.load(open(os.environ['LANGFORM_SIGNING_TEST_DATA']))
mock = data.get('signingMock', {})
with open(os.environ['LANGFORM_SIGNING_TEST_CODE_CALLS'], 'a') as log: log.write(json.dumps(args) + '\\n')
target = pathlib.Path(args[-1])
framework = target.suffix == '.framework'
state_path = pathlib.Path(os.environ['LANGFORM_SIGNING_TEST_CODE_CALLS'] + '.state')
signed = json.loads(state_path.read_text()) if state_path.exists() else {}
if '--sign' in args:
    entitlements = plistlib.loads(pathlib.Path(args[args.index('--entitlements') + 1]).read_bytes()) if '--entitlements' in args else {}
    signed[str(target)] = entitlements
    state_path.write_text(json.dumps(signed))
elif '--verify' in args:
    if framework and mock.get('failFrameworkVerify'): sys.exit(19)
elif '--entitlements' in args:
    entitlements = mock.get('frameworkEntitlements', {}) if framework else signed.get(str(target), {})
    if entitlements: sys.stdout.buffer.write(plistlib.dumps(entitlements))
elif any(arg.startswith('--extract-certificates=') for arg in args):
    prefix = next(arg.split('=', 1)[1] for arg in args if arg.startswith('--extract-certificates='))
    certificate = b'wrong fixture certificate' if framework and mock.get('wrongFrameworkCertificate') else base64.b64decode(data['profile']['DeveloperCertificates'][0])
    pathlib.Path(prefix + '0').write_bytes(certificate)
elif '--remove-signature' in args:
    if mock.get('normalizedBinary'): target.write_bytes(base64.b64decode(mock['normalizedBinary']))
else:
    sys.exit('Unexpected codesign command: ' + repr(args))
`, { mode: 0o755 });
  const env = { ...state.env, LANGFORM_SIGNING_TEST_CODE_CALLS: codeCalls };
  return {
    ...state, app, framework,
    calls: () => existsSync(codeCalls) ? readFileSync(codeCalls, 'utf8').trim().split('\n').map(JSON.parse) : [],
    sign: () => spawnSync('python3', ['-c', `
import importlib.util, pathlib, plistlib, subprocess, sys
spec = importlib.util.spec_from_file_location('signing', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
# Replace only binary fixtures in this imported test instance; production pins
# remain immutable and the real keychain/codesign tools are never invoked.
module.LITERT_DEVICE_BINARY_SHA256 = '${createHash('sha256').update(trustedFixtureRuntime).digest('hex')}'
module.LITERT_RESIGNED_UNSIGNED_SHA256 = '${createHash('sha256').update(normalizedFixtureRuntime).digest('hex')}'
profile_path = pathlib.Path(sys.argv[3])
profile = plistlib.loads(subprocess.run(['security', 'cms', '-D', '-i', str(profile_path)], capture_output=True, check=True).stdout)
try:
    module.sign_app(pathlib.Path(sys.argv[2]), profile_path, profile, identity='${fixtureIdentity}', team='RFN59MUTQ3', bundle='de.ipekkaya.langform')
except (module.SigningError, subprocess.SubprocessError) as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
`, path.join(root, 'scripts/check-iphone-signing.py'), app, path.join(state.profiles, `${uuid}.mobileprovision`)], { env, encoding: 'utf8' }),
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

test('manual signing keeps the existing single-executable app behavior', (t) => {
  const state = signingFixture(t, { runtime: false });
  const result = state.sign();
  assert.equal(result.status, 0, result.stderr);
  const signCalls = state.calls().filter((args) => args.includes('--sign'));
  assert.equal(signCalls.length, 1);
  assert.equal(signCalls[0].at(-1), state.app);
  assert.equal(signCalls[0][signCalls[0].indexOf('--sign') + 1], fixtureIdentity);
  assert.ok(signCalls[0].includes('--entitlements'));
  state.assertNoXcode();
});

test('approved Google runtime is signed and verified explicitly before the app with the same identity', (t) => {
  const state = signingFixture(t);
  const result = state.sign();
  assert.equal(result.status, 0, result.stderr);
  const calls = state.calls();
  const signCalls = calls.filter((args) => args.includes('--sign'));
  assert.deepEqual(signCalls.map((args) => args.at(-1)), [state.framework, state.app]);
  for (const args of signCalls) assert.equal(args[args.indexOf('--sign') + 1], fixtureIdentity);
  assert.equal(signCalls[0].includes('--entitlements'), false, 'framework receives no app entitlements');
  assert.ok(signCalls[1].includes('--entitlements'));
  const frameworkVerify = calls.findIndex((args) => args.includes('--verify') && args.at(-1) === state.framework);
  const appSign = calls.findIndex((args) => args.includes('--sign') && args.at(-1) === state.app);
  assert.ok(frameworkVerify > 0 && frameworkVerify < appSign);
  assert.ok(calls.every((args) => !args.includes('--deep')));
  assert.equal(existsSync(path.join(state.framework, 'embedded.mobileprovision')), false);
  state.assertNoXcode();
});

test('an already signed pinned runtime is checked using a temporary unsigned copy', (t) => {
  const signedBytes = Buffer.concat([trustedFixtureRuntime, Buffer.from('fixture existing signature')]);
  const state = signingFixture(t, { runtimeBytes: signedBytes,
    mock: { normalizedBinary: normalizedFixtureRuntime.toString('base64') } });
  const result = state.sign();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(state.calls().some((args) => args.includes('--remove-signature') && args.at(-1) !== path.join(state.framework, 'CLiteRTLM')));
  assert.deepEqual(readFileSync(path.join(state.framework, 'CLiteRTLM')), signedBytes,
    'provenance normalization must not alter the actual embedded runtime');
});

for (const [name, configuration, change, reason] of [
  ['different framework metadata', { frameworkInfo: { CFBundleIdentifier: 'com.example.other' } }, null, /unerwartete Bundle-Metadaten/],
  ['simulator runtime', { frameworkInfo: { CFBundleSupportedPlatforms: ['iPhoneSimulator'] } }, null, /unerwartete Bundle-Metadaten/],
  ['modified runtime with approved name', { runtimeBytes: Buffer.concat([trustedFixtureRuntime, Buffer.from('tampered')]) }, null, /nicht der ausdrücklich freigegebenen/],
  ['unknown framework', {}, (state) => mkdirSync(path.join(state.app, 'Frameworks/Other.framework')), /Eingebetteter Code/],
  ['embedded extension', {}, (state) => mkdirSync(path.join(state.app, 'PlugIns/Share.appex'), { recursive: true }), /Eingebetteter Code/],
  ['extra dynamic library', {}, (state) => writeFileSync(path.join(state.framework, 'extra.dylib'), 'unapproved'), /Eingebetteter Code/],
  ['hidden extra Mach-O', {}, (state) => writeFileSync(path.join(state.framework, 'helper'), Buffer.concat([Buffer.from('cffaedfe', 'hex'), Buffer.from('extra executable')])), /Zusätzliche ausführbare Datei/],
  ['symlink inside runtime', {}, (state) => symlinkSync(path.join(state.app, 'Langform'), path.join(state.framework, 'linked')), /Verknüpfter Bundle-Inhalt/],
]) {
  test(`manual signing rejects ${name} before any signature mutation`, (t) => {
    const state = signingFixture(t, configuration);
    change?.(state);
    const result = state.sign();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, reason);
    assert.equal(state.calls().some((args) => args.includes('--sign')), false);
    assert.equal(existsSync(path.join(state.app, 'embedded.mobileprovision')), false);
    state.assertNoXcode();
  });
}

for (const [name, mock, reason] of [
  ['runtime signature does not verify', { failFrameworkVerify: true }, /exit status 19/],
  ['runtime requests unexpected entitlements', { frameworkEntitlements: { 'get-task-allow': true } }, /Berechtigungen von Google-Laufzeit/],
  ['runtime uses another certificate', { wrongFrameworkCertificate: true }, /Zertifikat von Google-Laufzeit/],
]) {
  test(`manual signing stops before app signing when ${name}`, (t) => {
    const state = signingFixture(t, { mock });
    const result = state.sign();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, reason);
    assert.deepEqual(state.calls().filter((args) => args.includes('--sign')).map((args) => args.at(-1)), [state.framework]);
    state.assertNoXcode();
  });
}
