const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('Actual UIKit clip presentation follows Stage while real WK source viewport survives until live-node ACK', {
  skip: process.platform !== 'darwin', timeout: 60000,
}, t => {
  const sdk = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' });
  if (sdk.status !== 0) return t.skip('Catalyst SDK unavailable');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-staged-render-'));
  try {
    const result = spawnSync('python3', ['scripts/diagnostics/staged-fullscreen-native-fixture.py', '--output', folder], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 50000,
    });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const rows = fs.readFileSync(path.join(folder, 'native.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.at(-1).finished, true);
    assert.equal(rows.at(-1).passed, true);
    assert.equal(rows.at(-1).checks, 8);
    const display = rows.filter(row => row.event === 'native-display');
    assert.ok(display.length >= 20, 'actual display callbacks capture intermediate presentation');
    const source = display.filter(row => !row.ready), destination = display.filter(row => row.ready);
    assert.ok(source.length >= 8 && destination.length >= 8);
    for (const row of source) {
      assert.equal(row.wkWidth, 874);
      assert.equal(row.wkHeight, 402);
      assert.equal(row.wkPresentationWidth, 874, 'WK bounds do not stretch within the UIKit clip animation');
      assert.ok(Math.abs(row.cardWidth - row.stageWidth) < 1, 'clip and Stage share actual UIKit presentation timing');
    }
    for (const row of destination) {
      assert.equal(row.wkWidth, 402);
      assert.equal(row.wkHeight, 874);
      assert.equal(row.wkPresentationWidth, 402);
    }
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
