const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

let buildDirectory;
let binary;
const supported = process.platform === 'darwin';

test.before(() => {
  if (!supported) return;
  buildDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-cache-swift-'));
  const fixture = path.join(buildDirectory, 'CacheFixture.swift');
  binary = path.join(buildDirectory, 'cache-fixture');
  fs.writeFileSync(fixture, `
import Foundation
import Darwin
@main struct CacheFixture {
  static func main() throws {
    let action = CommandLine.arguments[1]
    let root = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
    if action == "reject" {
      do {
        let unexpected = try GemmaRuntimeCacheLease.acquire(root: root)
        unexpected.close()
        fatalError("Unsafe root was admitted")
      } catch { print("REJECTED"); return }
    }
    let lease = try GemmaRuntimeCacheLease.acquire(root: root)
    print(lease.directory.path)
    fflush(stdout)
    if action == "hold" { _ = readLine() }
    if action == "abandon" { withExtendedLifetime(lease) { _exit(0) } }
    lease.close()
    lease.close()
  }
}
`);
  const built = spawnSync('xcrun', ['swiftc', '-swift-version', '6', '-parse-as-library',
    path.join(__dirname, '../ios/Langform/Langform/GemmaRuntimeCache.swift'), fixture, '-o', binary],
  { encoding: 'utf8', timeout: 80000 });
  assert.equal(built.status, 0, built.stdout + built.stderr);
});

test.after(() => {
  if (buildDirectory) fs.rmSync(buildDirectory, { recursive: true, force: true });
});

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-cache-case-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, root: path.join(directory, 'pool') };
}

function run(action, root) {
  const result = spawnSync(binary, [action, root], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim();
}

function exited(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Fixture did not exit')); }, 15000);
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

async function hold(t, root) {
  const child = spawn(binary, ['hold', root], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  child.stdin.on('error', () => {});
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin.end('\n');
      await exited(child);
    }
  });
  const directory = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('No lease path: ' + stderr)); }, 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', data => {
      text += data;
      if (text.includes('\n')) { clearTimeout(timer); resolve(text.split('\n')[0]); }
    });
    child.once('exit', code => {
      if (!text.includes('\n')) { clearTimeout(timer); reject(new Error('Fixture exited ' + code + ': ' + stderr)); }
    });
  });
  return { child, directory };
}

async function close(held) {
  held.child.stdin.end('\n');
  assert.equal((await exited(held.child)).code, 0);
}

test('fresh cache paths never reuse a closed cache and close is idempotent', async t => {
  if (!supported) return t.skip('Swift filesystem fixture requires macOS');
  const { root } = workspace(t);
  const first = run('once', root);
  const second = run('once', root);
  assert.notEqual(first, second);
  assert.equal(path.dirname(first), root);
  assert.equal(fs.existsSync(first), false);
  assert.equal(fs.existsSync(second), false);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('two independent active processes keep their own leases through acquisition and close', async t => {
  if (!supported) return t.skip('Swift filesystem fixture requires macOS');
  const { root } = workspace(t);
  const first = await hold(t, root);
  fs.writeFileSync(path.join(first.directory, 'packed-weights.fixture'), 'first engine');
  const second = await hold(t, root);
  assert.notEqual(first.directory, second.directory);
  assert.equal(fs.readFileSync(path.join(first.directory, 'packed-weights.fixture'), 'utf8'), 'first engine');
  assert.equal(fs.existsSync(path.join(second.directory, 'packed-weights.fixture')), false);
  await close(first);
  assert.equal(fs.existsSync(first.directory), false);
  assert.equal(fs.existsSync(second.directory), true);
  await close(second);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('a killed process releases flock and its recognized stale cache is pruned', async t => {
  if (!supported) return t.skip('Swift filesystem fixture requires macOS');
  const { root } = workspace(t);
  const crashed = await hold(t, root);
  fs.mkdirSync(path.join(crashed.directory, 'nested'));
  fs.writeFileSync(path.join(crashed.directory, 'nested', 'packed.fixture'), 'stale');
  crashed.child.kill('SIGKILL');
  assert.equal((await exited(crashed.child)).signal, 'SIGKILL');
  assert.equal(fs.existsSync(crashed.directory), true);
  const next = await hold(t, root);
  assert.equal(fs.existsSync(crashed.directory), false);
  assert.notEqual(next.directory, crashed.directory);
  await close(next);
});

test('unknown directories and invalid markers are left untouched', async t => {
  if (!supported) return t.skip('Swift filesystem fixture requires macOS');
  const { root } = workspace(t);
  fs.mkdirSync(root);
  const unknown = path.join(root, 'user-content');
  const invalid = path.join(root, 'lease-12345678-1234-1234-1234-123456789abc');
  for (const directory of [unknown, invalid]) {
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'keep'), 'user data');
  }
  fs.writeFileSync(path.join(invalid, '.langform-cache-v1'), 'not our marker');
  fs.writeFileSync(path.join(invalid, '.lease.lock'), '');
  const active = await hold(t, root);
  await close(active);
  for (const directory of [unknown, invalid]) assert.equal(fs.readFileSync(path.join(directory, 'keep'), 'utf8'), 'user data');
});

test('root and recognized child symlinks are never followed or removed', async t => {
  if (!supported) return t.skip('Swift filesystem fixture requires macOS');
  const { root, directory } = workspace(t);
  const outside = path.join(directory, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep'), 'outside');
  const rootLink = path.join(directory, 'root-link');
  fs.symlinkSync(outside, rootLink, 'dir');
  assert.equal(run('reject', rootLink), 'REJECTED');
  assert.deepEqual(fs.readdirSync(outside), ['keep']);
  const abandoned = run('abandon', root);
  const moved = path.join(directory, 'moved-recognized-cache');
  fs.renameSync(abandoned, moved);
  fs.writeFileSync(path.join(moved, 'keep'), 'recognized but outside');
  fs.symlinkSync(moved, abandoned, 'dir');
  const fresh = await hold(t, root);
  await close(fresh);
  assert.equal(fs.lstatSync(abandoned).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(moved, 'keep'), 'utf8'), 'recognized but outside');
});

test('symlink markers and lock files cannot authorize stale cleanup', async t => {
  if (!supported) return t.skip('Swift filesystem fixture requires macOS');
  const { root, directory } = workspace(t);
  const markerLease = run('abandon', root);
  const markerTarget = path.join(directory, 'marker-target');
  fs.renameSync(path.join(markerLease, '.langform-cache-v1'), markerTarget);
  fs.symlinkSync(markerTarget, path.join(markerLease, '.langform-cache-v1'));
  const lockLease = run('abandon', root);
  const lockTarget = path.join(directory, 'lock-target');
  fs.renameSync(path.join(lockLease, '.lease.lock'), lockTarget);
  fs.symlinkSync(lockTarget, path.join(lockLease, '.lease.lock'));
  const fresh = await hold(t, root);
  await close(fresh);
  assert.equal(fs.existsSync(markerLease), true);
  assert.equal(fs.existsSync(lockLease), true);
  assert.equal(fs.lstatSync(path.join(markerLease, '.langform-cache-v1')).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(lockLease, '.lease.lock')).isSymbolicLink(), true);
});

test('close unlinks contained symlinks without touching their targets', async t => {
  if (!supported) return t.skip('Swift filesystem fixture requires macOS');
  const { root, directory } = workspace(t);
  const outside = path.join(directory, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep'), 'outside');
  const lease = await hold(t, root);
  fs.symlinkSync(outside, path.join(lease.directory, 'link'), 'dir');
  await close(lease);
  assert.equal(fs.existsSync(lease.directory), false);
  assert.equal(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'outside');
});

test('close refuses to remove a different directory substituted at the leased path', async t => {
  if (!supported) return t.skip('Swift filesystem fixture requires macOS');
  const { root, directory } = workspace(t);
  const lease = await hold(t, root);
  const moved = path.join(directory, 'moved-active-cache');
  fs.renameSync(lease.directory, moved);
  fs.mkdirSync(lease.directory);
  fs.writeFileSync(path.join(lease.directory, 'keep'), 'replacement');
  await close(lease);
  assert.equal(fs.readFileSync(path.join(lease.directory, 'keep'), 'utf8'), 'replacement');
  assert.equal(fs.existsSync(moved), true);
});
