const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

test('Watch-Deadline bleibt nach Seiten-Reveal bis zur Bildübergabe aktiv und ignoriert alte oder abgebrochene Übergänge', {
  skip: process.platform !== 'darwin', timeout: 30000,
}, t => {
  const compiler = spawnSync('/usr/bin/xcrun', ['--find', 'swift'], { encoding: 'utf8' });
  if (compiler.status !== 0) return t.skip('Swift toolchain unavailable');
  const source = fs.readFileSync(process.env.LANGFORM_HANDOFF_SOURCE || path.join(__dirname, '../ios/Langform/Langform/YouTubeWebView.swift'), 'utf8');
  const open = source.slice(source.indexOf('private func openWatch('), source.indexOf('private func showStartupPoster('));
  const timeout = open.match(/let timeout = DispatchWorkItem \{ \[weak self\] in([\s\S]*?)\n        \}\n        loadingTimeout = timeout/);
  assert.ok(timeout, 'execute the actual Watch deadline closure');
  const reveal = source.slice(source.indexOf('private func reveal()'), source.indexOf('private func stopReveal('));
  const revealPrefix = reveal.slice(reveal.indexOf('{') + 1, reveal.indexOf('        cancelSPAWaits()'));
  const exercise = `
import Foundation
final class Item { var cancelled = false; func cancel() { cancelled = true } }
final class Opening { var ticket = 7; var reversing = false }
final class Diagnostics { func mark(_ kind: Kind, ticket: Int) {} ; enum Kind { case revealStarted } }
final class Stage {
 enum Mode { case loading, expanded, mini, closed }
 var mode = Mode.loading, loadTicket = 7, failures = 0
 var feedOpening: Opening?, loadingTimeout: Item? = Item()
 let videoLoadDiagnostics = Diagnostics()
 func failPlayer() { failures += 1 }
 func fireDeadline() { let ticket = 7; let fire = { [weak self] in ${timeout[1]} }; fire() }
 func revealStart() { ${revealPrefix} }
}
func expect(_ ok: Bool, _ text: String) { if !ok { print("FAILED " + text); exit(1) } }
let waiting = Stage(); waiting.feedOpening = Opening()
let item = waiting.loadingTimeout!; waiting.revealStart()
expect(!item.cancelled && waiting.loadingTimeout === item, "painted Watch cannot cancel its still-unfinished picture handoff deadline")
waiting.mode = .expanded; waiting.fireDeadline()
expect(waiting.failures == 1, "expanded Watch with missing poster and first picture offers the existing failure/abort recovery")
let loading = Stage(); loading.fireDeadline(); expect(loading.failures == 1, "ordinary document loading keeps its bounded failure")
let done = Stage(); let doneItem = done.loadingTimeout!; done.revealStart()
expect(doneItem.cancelled && done.loadingTimeout == nil, "ordinary Reveal without a source picture releases its timer")
done.mode = .expanded; done.fireDeadline(); expect(done.failures == 0, "completed picture handoff cannot fail playback")
for kind in 0..<4 {
 let stale = Stage(); let opening = Opening(); stale.feedOpening = opening; stale.mode = .expanded
 switch kind { case 0: stale.loadTicket = 8; case 1: opening.ticket = 6; case 2: opening.reversing = true; default: stale.mode = .closed }
 stale.fireDeadline(); expect(stale.failures == 0, "old, reversing or closed handoffs cannot affect current playback")
}
print("WATCH_HANDOFF_TIMEOUT_OK")
`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-handoff-timeout-'));
  try {
    const file = path.join(tmp, 'Handoff.swift'); fs.writeFileSync(file, exercise);
    const result = spawnSync(compiler.stdout.trim(), [file], { encoding: 'utf8', timeout: 25000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /WATCH_HANDOFF_TIMEOUT_OK/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
