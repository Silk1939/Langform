const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('physical rotation intent keeps one current video, respects manual exit and rejects busy or stale ownership', {
  skip: process.platform !== 'darwin', timeout: 70000,
}, t => {
  const compiler = spawnSync('/usr/bin/xcrun', ['--find', 'swift'], { encoding:'utf8' });
  if (compiler.status !== 0) return t.skip('Swift toolchain is required.');
  const source = fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/PlayerRotationIntentPolicy.swift'),'utf8');
  const exercise = `
func expect(_ value: Bool, _ message: String) { if !value { print("FAILED: " + message); exit(1) } }
let owner = PlayerRotationIntentPolicy.Owner(videoID: "abcdefghijk", ticket: 4)
var inline = PlayerRotationIntentPolicy.Context(owner: owner, expanded: true, foreground: true, mediaOwned: true, geometryCurrent: true)
var full = inline; full.fullscreen = true
var policy = PlayerRotationIntentPolicy(); policy.reset(orientation: .portrait)
let entry = policy.observe(.landscape, context: inline, now: 10)
expect(entry?.action == .enter && entry?.owner == owner, "landscape opens the matching inline video")
expect(policy.isCurrent(entry!, context: inline), "request remains current before dispatch")
expect(policy.observe(.landscape, context: inline, now: 10.1) == nil, "duplicate landscape notifications do not toggle")
expect(policy.observe(.unknown, context: inline, now: 10.2) == nil, "face-up/down/unknown do not create an orientation")
expect(policy.observe(.landscape, context: inline, now: 10.3) == nil, "flat device does not rearm landscape")
let exitRequest = policy.observe(.portrait, context: full, now: 11)
expect(exitRequest?.action == .exit, "physical portrait returns a fullscreen video inline")
expect(!policy.isCurrent(entry!, context: inline), "opposite physical orientation revokes old entry")
expect(policy.observe(.portrait, context: full, now: 11.1) == nil, "duplicate portrait does not repeat exit")

policy.reset(orientation: .portrait)
_ = policy.observe(.landscape, context: inline, now: 20)
policy.fullscreenExitRequested()
expect(policy.observe(.unknown, context: inline, now: 20.1) == nil, "flat movement preserves manual dismissal")
expect(policy.observe(.landscape, context: inline, now: 20.2) == nil, "manual exit stays inline while landscape")
_ = policy.observe(.portrait, context: inline, now: 21)
expect(policy.observe(.landscape, context: inline, now: 22)?.action == .enter, "new portrait to landscape movement rearms")

for index in 0..<7 {
  policy.reset(orientation: .portrait)
  var blocked = inline
  switch index {
  case 0: blocked.owner = nil
  case 1: blocked.expanded = false
  case 2: blocked.foreground = false
  case 3: blocked.mediaOwned = false
  case 4: blocked.gestureActive = true
  case 5: blocked.overlayOpen = true
  default: blocked.fullscreenTransition = true
  }
  expect(policy.observe(.landscape, context: blocked, now: 30) == nil, "blocked context cannot enter " + String(index))
  expect(policy.takePending(context: inline, now: 30.1) == nil, "unblocked report cannot invent delayed entry " + String(index))
}

policy.reset(orientation: .portrait)
var resizing = inline; resizing.nativeRotating = true; resizing.geometryCurrent = false
expect(policy.observe(.landscape, context: resizing, now: 40) == nil, "UIKit rotation waits before entry")
expect(policy.takePending(context: resizing, now: 40.2) == nil, "entry never dispatches during rotation")
resizing.nativeRotating = false
expect(policy.takePending(context: resizing, now: 40.3) == nil, "old viewport cannot authorize entry")
expect(policy.takePending(context: inline, now: 40.4)?.action == .enter, "matching fresh viewport finishes physical intent")
expect(policy.takePending(context: inline, now: 40.5) == nil, "geometry completion dispatches once")

for index in 0..<6 {
  policy.reset(orientation: .portrait)
  _ = policy.observe(.landscape, context: resizing, now: 50)
  var changed = inline
  switch index {
  case 0: changed.owner = .init(videoID: "zyxwvutsrqp", ticket: 4)
  case 1: changed.owner = .init(videoID: "abcdefghijk", ticket: 5)
  case 2: changed.foreground = false
  case 3: changed.gestureActive = true
  case 4: changed.fullscreenTransition = true
  default: changed.fullscreen = true
  }
  expect(policy.takePending(context: changed, now: 50.1) == nil, "changed context revokes pending " + String(index))
  expect(policy.takePending(context: inline, now: 50.2) == nil, "revoked request stays revoked " + String(index))
}
policy.reset(orientation: .portrait)
_ = policy.observe(.landscape, context: resizing, now: 60)
expect(policy.takePending(context: inline, now: 62.01) == nil, "overdue rotation cannot suddenly open")
policy.reset(orientation: .portrait)
_ = policy.observe(.landscape, context: resizing, now: 70)
policy.reset(orientation: .landscape)
expect(policy.takePending(context: inline, now: 70.1) == nil, "background reset cancels pending entry")
expect(policy.observe(.landscape, context: inline, now: 70.2) == nil, "foreground baseline is no physical rotation")
expect(policy.observe(.portrait, context: inline, now: 71) == nil, "portrait inline does not exit something absent")
expect(policy.observe(.landscape, context: full, now: 72) == nil, "already fullscreen is never toggled inline by landscape")
print("NATIVE_ROTATION_INTENT_OK")
`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'langform-rotation-policy-'));
  try {
    const script = path.join(directory,'RotationPolicy.swift'); fs.writeFileSync(script,source+'\n'+exercise);
    const result = spawnSync(compiler.stdout.trim(),[script],{encoding:'utf8',timeout:60000});
    assert.equal(result.error,undefined,String(result.error));
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.match(result.stdout,/NATIVE_ROTATION_INTENT_OK/);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
