const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
test('shipping portrait-up admission and commitment preserve diagonal, cancellation and reversal ownership', {skip:process.platform!=='darwin',timeout:70000},()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'langform-portrait-up-'));
  try {
    const source=fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/PlayerGesturePolicy.swift'),'utf8');
    const script=path.join(directory,'Policy.swift');
    fs.writeFileSync(script,source+`
func check(_ value: Bool, _ name: String) { if !value { print(name); exit(1) } }
func admit(_ x: CGFloat, _ y: CGFloat, _ vx: CGFloat = 0, _ vy: CGFloat = 0) -> Bool {
    PlayerGesturePolicy.canEnterFullscreen(translation: CGPoint(x:x,y:y), velocity: CGPoint(x:vx,y:vy))
}
func commit(_ ended: Bool, _ x: CGFloat, _ y: CGFloat, _ vx: CGFloat = 0, _ vy: CGFloat = 0) -> Bool {
    PlayerGesturePolicy.finishesFullscreenEntry(ended: ended, translation: CGPoint(x:x,y:y), velocity: CGPoint(x:vx,y:vy))
}
check(admit(5,-15), "portrait upward gesture admitted")
check(admit(0,0,20,-400), "UIKit zero translation can use upward velocity")
check(!admit(0,0), "stationary contact rejected")
check(!admit(30,-10,0,-900), "horizontal displacement cannot be overridden by flick")
check(!admit(0,8,0,-900), "downward displacement cannot be overridden")
check(!admit(0,0,400,-300), "sideways zero-translation velocity rejected")
check(commit(true,5,-36), "upward threshold commits")
check(commit(true,1,-8,20,-650), "short definite upward flick commits")
check(!commit(true,0,-35), "short slow contact restores portrait")
check(!commit(false,0,-200,0,-900), "cancelled contact never commits")
check(!commit(true,5,40,0,-900), "direction reversal does not enter")
check(!commit(true,80,-60,0,-900), "final horizontal diagonal does not enter")
check(!commit(true,0,0,0,-900), "released no-displacement contact does not enter")
print("PORTRAIT_FULLSCREEN_POLICY_OK")
`);
    const result=spawnSync('/usr/bin/xcrun',['swift',script],{encoding:'utf8',timeout:60000});
    assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/PORTRAIT_FULLSCREEN_POLICY_OK/);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
