const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

// Runs in this mirrored draft and after moving the test into repository/tests.
const sourceRoot = process.env.LANGFORM_MOTION_SOURCE_ROOT || path.resolve(__dirname, '..');
const app = path.join(sourceRoot, 'ios/Langform/Langform');
let fixture;
function compileFixture() {
  if (fixture) return fixture;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-motion-roles-'));
  const motion = fs.readFileSync(path.join(app, 'Motion.swift'), 'utf8').replace('import UIKit', 'import Foundation');
  const views = fs.readFileSync(path.join(app, 'MotionViews.swift'), 'utf8');
  const button = views.slice(views.indexOf('final class MotionButton'), views.indexOf('/// Keeps one noninteractive image'));
  const web = fs.readFileSync(path.join(app, 'YouTubeWebView.swift'), 'utf8');
  const synchronization = web.slice(web.indexOf('    func synchronizeMotionPreferences()'), web.indexOf('    override func canPerformAction'));
  assert.match(synchronization, /func synchronizeMotionPreferences/);
  const source = `
import Foundation
typealias Selector = String
struct CATransform3D: Equatable { var x: CGFloat; var y: CGFloat }
let CATransform3DIdentity = CATransform3D(x: 1, y: 1)
func CATransform3DMakeScale(_ x: CGFloat, _ y: CGFloat, _ z: CGFloat) -> CATransform3D { CATransform3D(x:x,y:y) }
class Layer { var sublayerTransform = CATransform3DIdentity; var removals=0; func removeAllAnimations(){removals += 1} }
class UIImage {}
class UIEvent { enum EventType { case touches, presses }; let type: EventType; init(_ type:EventType){self.type=type} }
@MainActor enum UIAccessibility { static var isReduceMotionEnabled=false; static var prefersCrossFadeTransitions=false }
@MainActor class ProcessInfo { static let processInfo=ProcessInfo(); var systemUptime:Double=100 }
@MainActor class UIImpactFeedbackGenerator {
 enum Style { case light }; static var preparations=0, impacts=0; static var intensities:[CGFloat]=[]
 init(style:Style){};func prepare(){Self.preparations += 1};func impactOccurred(intensity:CGFloat){Self.impacts += 1;Self.intensities.append(intensity)}
}
@MainActor class UISelectionFeedbackGenerator {
 static var preparations=0,selections=0;func prepare(){Self.preparations += 1};func selectionChanged(){Self.selections += 1}
}
@MainActor class UIView {
 struct AnimationOptions: OptionSet { let rawValue:Int; static let beginFromCurrentState=Self(rawValue:1),allowUserInteraction=Self(rawValue:2),transitionCrossDissolve=Self(rawValue:4) }
 static var records:[(duration:Double,damping:CGFloat)]=[]
 static func animate(withDuration:Double,delay:Double,usingSpringWithDamping:CGFloat,initialSpringVelocity:CGFloat,options:AnimationOptions,animations:()->Void){records.append((withDuration,usingSpringWithDamping));animations()}
 static func transition(with:UIView,duration:Double,options:AnimationOptions,animations:()->Void){animations()}
}
@MainActor class UIButton:UIView {
 enum State { case normal };var isHighlighted=false,isEnabled=true,isHidden=false;var alpha:CGFloat=1;var window:NSObject?;var layer=Layer();var actions=0
 func sendAction(_ action:Selector,to target:Any?,for event:UIEvent?){actions += 1};func didMoveToWindow(){};func setImage(_ image:UIImage?,for state:State){}
}
@MainActor class WKContentWorld { static let page=WKContentWorld(), isolated=WKContentWorld() }
enum WKUserScriptInjectionTime { case atDocumentStart, atDocumentEnd }
@MainActor class WKUserScript {
 let source:String,injectionTime:WKUserScriptInjectionTime,forMainFrameOnly:Bool,world:WKContentWorld
 init(source:String,injectionTime:WKUserScriptInjectionTime,forMainFrameOnly:Bool,in world:WKContentWorld){self.source=source;self.injectionTime=injectionTime;self.forMainFrameOnly=forMainFrameOnly;self.world=world}
}
@MainActor class UserContentController {
 var userScripts:[WKUserScript]=[],removals=0
 func addUserScript(_ script:WKUserScript){userScripts.append(script)}
 func removeAllUserScripts(){removals += 1;userScripts=[]}
}
@MainActor class WebConfiguration {let userContentController=UserContentController()}
@MainActor class LangformWebView {
 let configuration=WebConfiguration();var motionBootstrapScript:WKUserScript?;var evaluations:[String]=[]
 func evaluateJavaScript(_ source:String){evaluations.append(source)}
 ${synchronization}
}
${motion}
${button}
func expect(_ value:Bool,_ name:String){if !value{print("FAILED "+name);exit(1)}}
@main struct Runner {
 @MainActor static func main(){
  let a=MotionButton();a.window=NSObject()
  a.sendAction("play",to:nil,for:UIEvent(.touches))
  expect(a.actions==1 && UIImpactFeedbackGenerator.impacts==0 && UISelectionFeedbackGenerator.selections==0,"default role forwards action silently")
  a.hapticRole = .commit;a.isHighlighted=true
  expect(a.layer.sublayerTransform.x==LangformMotion.Scale.icon && a.layer.sublayerTransform.y==LangformMotion.Scale.icon,"only content has shared icon scale")
  expect(UIImpactFeedbackGenerator.preparations==1,"semantic touch prepares relevant feedback")
  a.isHighlighted=false
  expect(UIView.records.last!.duration==LangformMotion.Duration.pressOut && UIView.records.last!.damping==1 && a.layer.sublayerTransform==CATransform3DIdentity,"release returns critically without overshoot")
  a.sendAction("play",to:nil,for:UIEvent(.touches))
  expect(UIImpactFeedbackGenerator.impacts==1,"commit touch emits one impact")
  let b=MotionButton();b.window=NSObject();b.hapticRole = .selection
  ProcessInfo.processInfo.systemUptime=100.01;b.sendAction("choice",to:nil,for:UIEvent(.touches))
  expect(UISelectionFeedbackGenerator.selections==0,"cooldown applies across adjacent controls and roles")
  ProcessInfo.processInfo.systemUptime=100.071;b.sendAction("choice",to:nil,for:UIEvent(.touches))
  expect(UISelectionFeedbackGenerator.selections==1,"selection after cooldown emits selection feedback")
  ProcessInfo.processInfo.systemUptime=101
  b.sendAction("choice",to:nil,for:nil);b.sendAction("choice",to:nil,for:UIEvent(.presses))
  b.isEnabled=false;b.sendAction("choice",to:nil,for:UIEvent(.touches));b.isEnabled=true
  b.isHidden=true;b.sendAction("choice",to:nil,for:UIEvent(.touches));b.isHidden=false
  b.alpha=0;b.sendAction("choice",to:nil,for:UIEvent(.touches));b.alpha=1
  b.window=nil;b.sendAction("choice",to:nil,for:UIEvent(.touches))
  expect(UISelectionFeedbackGenerator.selections==1,"non-touch,disabled,hidden,transparent and detached actions never buzz")
  UIAccessibility.prefersCrossFadeTransitions=true;a.isHighlighted=true
  expect(a.layer.sublayerTransform==CATransform3DIdentity && UIView.records.last!.duration==0,"crossfade preference disables spatial press motion")
  UIAccessibility.prefersCrossFadeTransitions=false;a.isHighlighted=false;UIAccessibility.isReduceMotionEnabled=true;a.isHighlighted=true
  expect(a.layer.sublayerTransform==CATransform3DIdentity && UIView.records.last!.duration==0,"reduce motion disables spatial press motion")
  a.layer.sublayerTransform=CATransform3DMakeScale(0.5,0.5,1);a.window=nil;a.didMoveToWindow()
  expect(a.layer.removals==1 && a.layer.sublayerTransform==CATransform3DIdentity,"detachment clears presentation decoration")
  UIAccessibility.isReduceMotionEnabled=false
  let web=LangformWebView(),controller=web.configuration.userContentController
  let earlier=WKUserScript(source:"earlier",injectionTime:.atDocumentEnd,forMainFrameOnly:false,in:.isolated)
  let original=WKUserScript(source:LangformMotion.bootstrapSource,injectionTime:.atDocumentStart,forMainFrameOnly:true,in:.page)
  let consumer=WKUserScript(source:"consumer",injectionTime:.atDocumentStart,forMainFrameOnly:true,in:.page)
  web.motionBootstrapScript=original
  [earlier,original,consumer].forEach{controller.addUserScript($0)}
  web.synchronizeMotionPreferences()
  expect(controller.removals==0 && web.motionBootstrapScript === original,"unchanged bootstrap retains every user script")
  var snapshots=["initial":original.source]
  UIAccessibility.prefersCrossFadeTransitions=true;web.synchronizeMotionPreferences()
  let crossFade=web.motionBootstrapScript!
  expect(controller.removals==1 && crossFade !== original,"changed native preference replaces the stored bootstrap")
  expect(controller.userScripts.count==3 && controller.userScripts[0] === earlier && controller.userScripts[1] === crossFade && controller.userScripts[2] === consumer,"replacement preserves every other object and injection order")
  expect(earlier.world === WKContentWorld.isolated && earlier.injectionTime == .atDocumentEnd && !earlier.forMainFrameOnly,"isolated-world script timing and frame scope remain unchanged")
  expect(crossFade.world === WKContentWorld.page && crossFade.injectionTime == .atDocumentStart && crossFade.forMainFrameOnly,"motion snapshot retains page-world document-start main-frame scope")
  snapshots["crossFade"]=crossFade.source;snapshots["crossFadeUpdate"]=web.evaluations.last!
  web.synchronizeMotionPreferences();expect(controller.removals==1,"repeat synchronization does not rebuild user scripts")
  UIAccessibility.isReduceMotionEnabled=true;web.synchronizeMotionPreferences()
  snapshots["reduced"]=web.motionBootstrapScript!.source;snapshots["reducedUpdate"]=web.evaluations.last!
  UIAccessibility.isReduceMotionEnabled=false;UIAccessibility.prefersCrossFadeTransitions=false;web.synchronizeMotionPreferences()
  snapshots["disabled"]=web.motionBootstrapScript!.source;snapshots["disabledUpdate"]=web.evaluations.last!
  print("PREFERENCE_SNAPSHOTS_BEGIN")
  print(String(data:try! JSONSerialization.data(withJSONObject:snapshots),encoding:.utf8)!)
  print("NATIVE_MOTION_ROLES_OK")
  print("BOOTSTRAP_BEGIN")
  print(LangformMotion.bootstrapSource)
  UIAccessibility.isReduceMotionEnabled=true
  print("BOOTSTRAP_REDUCED_BEGIN")
  print(LangformMotion.bootstrapSource)
 }
}
`;
  try {
    const file = path.join(directory, 'MotionFixture.swift'), binary = path.join(directory, 'motion-fixture');
    fs.writeFileSync(file, source);
    const built = spawnSync('/usr/bin/xcrun', ['swiftc', '-parse-as-library', file, '-o', binary], { encoding: 'utf8', timeout: 40000 });
    assert.equal(built.error, undefined); assert.equal(built.status, 0, built.stdout + built.stderr);
    const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /NATIVE_MOTION_ROLES_OK/);
    const [bootstrapSource, reducedSource] = result.stdout.split('BOOTSTRAP_BEGIN\n')[1].split('BOOTSTRAP_REDUCED_BEGIN\n');
    const snapshots = JSON.parse(result.stdout.split('PREFERENCE_SNAPSHOTS_BEGIN\n')[1].split('\n')[0]);
    fixture = { source: bootstrapSource, reducedSource, snapshots };
    return fixture;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function runtime(options = {}) {
  const variables = new Map(), events = [], ready = [], observers = [], queryListeners = [];
  const root = { style: { setProperty: (key, value) => variables.set(key, value) } };
  const query = { matches: !!options.reduced, addEventListener: (name, handler) => queryListeners.push(handler) };
  const document = { head: null, documentElement: options.noRoot ? null : root, addEventListener: (name, handler) => ready.push(handler) };
  const window = { document, matchMedia: () => query, dispatchEvent: event => events.push(event),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    MutationObserver: class { constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
  };
  const context = vm.createContext({ window });
  vm.runInContext(options.source ?? compileFixture().source, context);
  return { window, context, document, root, variables, events, ready, observers, queryListeners, motion: window.__langformMotion };
}

test('native semantic touch haptics, global cooldown and stable press layers execute from the draft source', { skip: process.platform !== 'darwin', timeout: 60000 }, () => {
  assert.ok(compileFixture().source);
});

test('native-generated bootstrap works without head, freezes shared roles and is idempotent', { skip: process.platform !== 'darwin', timeout: 60000 }, () => {
  const s = runtime();
  assert.equal(s.motion.durations.sheetEnter, 280);
  assert.equal(s.motion.durations.hero, s.motion.springs.hero.duration);
  assert.equal(s.motion.scales.icon, .94);
  for (const value of [s.motion, s.motion.durations, s.motion.easings, s.motion.scales, s.motion.springs, s.motion.springs.hero]) assert.equal(Object.isFrozen(value), true);
  assert.equal(s.variables.get('--lf-duration-sheetEnter'), '280ms');
  assert.equal(s.variables.get('--lf-scale-icon'), '0.94');
  const original = s.motion; vm.runInContext(compileFixture().source, s.context);
  assert.equal(s.window.__langformMotion, original); assert.equal(s.queryListeners.length, 1);
});

test('documentStart with no root installs CSS exactly when the root arrives', { skip: process.platform !== 'darwin', timeout: 60000 }, () => {
  const s = runtime({ noRoot: true });
  assert.equal(s.variables.size, 0); assert.equal(s.observers.length, 1);
  s.document.documentElement = s.root; s.observers[0].callback();
  assert.equal(s.variables.get('--lf-duration-fade'), '160ms');
  assert.equal(s.observers[0].disconnected, true);
});

test('live media and native preferences sync effective spatial motion and emit only real changes', { skip: process.platform !== 'darwin', timeout: 60000 }, () => {
  const s = runtime();
  assert.equal(s.motion.reduceSpatialMotion, false);
  s.queryListeners[0]({ matches: true });
  assert.equal(s.motion.reducedMotion, true); assert.equal(s.motion.reduceSpatialMotion, true);
  assert.equal(s.variables.get('--lf-reduced-motion'), '1'); assert.equal(s.events.length, 1);
  s.motion.setNativePreferences(true, false); assert.equal(s.events.length, 1);
  assert.equal(s.motion.setNativePreferences('false', false), false); assert.equal(s.events.length, 1);
  s.motion.setNativePreferences(false, true);
  assert.equal(s.motion.reducedMotion, false); assert.equal(s.motion.prefersCrossFade, true); assert.equal(s.motion.reduceSpatialMotion, true);
  assert.equal(s.variables.get('--lf-prefers-crossfade'), '1');
  s.queryListeners[0]({ matches: false }); assert.equal(s.motion.reduceSpatialMotion, true);
  s.motion.setNativePreferences(false, false);
  assert.equal(s.motion.reduceSpatialMotion, false); assert.equal(s.variables.get('--lf-reduce-spatial-motion'), '0');
  assert.equal(s.events.at(-1).type, 'langform-motion-change'); assert.equal(Object.isFrozen(s.events.at(-1).detail), true);
});

test('a fresh document uses an available false media preference after Reduce Motion was disabled', { skip: process.platform !== 'darwin', timeout: 60000 }, () => {
  const s = runtime({ source: compileFixture().reducedSource, reduced: false });
  assert.equal(s.motion.reducedMotion, false);
  assert.equal(s.motion.reduceSpatialMotion, false);
});

test('native preference synchronization updates live pages and stored scripts for fresh following documents', { skip: process.platform !== 'darwin', timeout: 60000 }, () => {
  const { snapshots } = compileFixture();
  const current = runtime({ source: snapshots.initial });
  assert.equal(current.motion.reduceSpatialMotion, false);
  vm.runInContext(snapshots.crossFadeUpdate, current.context);
  assert.equal(current.motion.prefersCrossFade, true);
  const next = runtime({ source: snapshots.crossFade });
  assert.equal(next.motion.prefersCrossFade, true);
  assert.equal(next.motion.reduceSpatialMotion, true);
  vm.runInContext(snapshots.reducedUpdate, next.context);
  assert.equal(next.motion.reducedMotion, true);
  assert.equal(runtime({ source: snapshots.reduced, reduced: true }).motion.reducedMotion, true);
  vm.runInContext(snapshots.disabledUpdate, next.context);
  assert.equal(next.motion.reduceSpatialMotion, false);
  const final = runtime({ source: snapshots.disabled });
  assert.equal(final.motion.reducedMotion, false);
  assert.equal(final.motion.prefersCrossFade, false);
  assert.equal(final.motion.reduceSpatialMotion, false);
});

test('notification, foreground and document commit synchronize retained WebView preferences', () => {
  const web = fs.readFileSync(path.join(app, 'YouTubeWebView.swift'), 'utf8');
  const preferenceHook = web.slice(web.indexOf('@objc private func motionPreferencesChanged()'), web.indexOf('@objc private func reduceMotionChanged()'));
  assert.match(preferenceHook, /feedTabs\.values\.map\(\\\.webView\) \+ \[player\]/);
  assert.match(preferenceHook, /synchronizeMotionPreferences\(\)/);
  assert.match(web.slice(web.indexOf('@objc private func appBecameActive()'), web.indexOf('@objc private func keyboardWillShow()')), /motionPreferencesChanged\(\)/);
  assert.match(web.slice(web.indexOf('func webView(_ webView: WKWebView, didCommit'), web.indexOf('func webView(_ webView: WKWebView, didStartProvisionalNavigation')), /synchronizeMotionPreferences\(\)/);
  assert.ok(web.indexOf('addUserScript(motionBootstrapScript)') < web.indexOf('let source = quietBootstrap + concatenatedScripts(scripts)'), 'bootstrap remains before its consumers');
});
