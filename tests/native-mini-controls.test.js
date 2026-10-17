const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('real UIKit mini controls retain separate complete44pt targets and exact media crop across seven aspect ratios', {
  skip: process.platform !== 'darwin', timeout: 90000,
}, () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-mini-controls-'));
  try {
    const result = spawnSync('python3', ['scripts/diagnostics/mini-controls-catalyst.py', '--output', output], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 80000,
    });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const rows = fs.readFileSync(path.join(output, 'native.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const end = rows.at(-1);
    assert.equal(end.finished, true);
    assert.equal(end.passed, true);
    assert.equal(end.samples.length, 7);
    assert.equal(Object.keys(end.checks).length, 108);
    assert.deepEqual(end.failed, []);
  } finally {
    fs.rmSync(output, {recursive: true, force: true});
  }
});
