const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function method(source, name) {
  const start = source.indexOf('func ' + name + '('), open = source.indexOf('{',start);
  assert.ok(start >= 0, name);let end=open+1,depth=1;
  while(depth&&end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}
  return source.slice(start,end);
}

test('fullscreen trace authenticates the current exit and writes bounded numeric geometry without page strings',{
  skip:process.platform!=='darwin',timeout:70000,
},t=>{
  const compiler=spawnSync('/usr/bin/xcrun',['--find','swift'],{encoding:'utf8'});
  if(compiler.status!==0)return t.skip('Swift toolchain unavailable');
  const source=fs.readFileSync(path.join(__dirname,'../ios/Langform/Langform/YouTubeWebView.swift'),'utf8');
  const bridge=source.slice(source.indexOf('case "langformFullscreen":'),source.indexOf('case "langformProbeInteraction":'));
  assert.match(source,/guard message\.frameInfo\.isMainFrame else \{ return \}/);
  assert.match(bridge,/message\.webView === player/);assert.match(bridge,/securityOrigin\.protocol == "https"/);
  assert.match(bridge,/\["m\.youtube\.com", "www\.youtube\.com", "youtube\.com"\]\.contains/);
  const methods=['fullscreenGeometryChanged','fullscreenGeometryRow'].map(name=>method(source,name)).join('\n');
  const exercise=`
import Foundation
import CoreGraphics
enum StartupDiagnostics { static var enabled=true; static var entries:[[String:Any]]=[]; static func videoMark(_ entry:[String:Any]) { entries.append(entry) } }
enum YouTubeWebView { static func videoID(_ url:URL?)->String? { guard let url,["m.youtube.com","www.youtube.com","youtube.com"].contains(url.host ?? ""),url.path=="/watch" else{return nil};return URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems?.first{$0.name=="v"}?.value } }
struct Transform { var a=1.0,d=1.0,tx=0.0,ty=0.0 }
class Player { var url=URL(string:"https://m.youtube.com/watch?v=abcdefghijk");var bounds=CGRect(x:0,y:0,width:390,height:844);var transform=Transform() }
class Card { var frame=CGRect(x:0,y:0,width:390,height:844) }
struct Insets { var top=59.0,bottom=34.0 }
class Stage {
 enum Mode { case expanded,mini };var mode=Mode.expanded
 var fullscreenGeometryTrace:(videoID:String,token:String,ticket:Int,beganAt:TimeInterval,rows:Int)?
 var loadTicket=2,player:Player?=Player(),card=Card(),bounds=CGRect(x:0,y:0,width:390,height:844),safeAreaInsets=Insets(),progress=0.0,playerFullscreen=true
 struct Exit {var waitingForRotation=false};var customFullscreenExit:Exit?=Exit()
 var customFullscreenEnter:Exit?;var fullscreenGeometryDirection="exit"
 ${methods}
}
func expect(_ value:Bool,_ note:String) {if !value {fputs("FAILED: \\(note)\\n",stderr);exit(1)}}
let stage=Stage()
stage.fullscreenGeometryTrace=("abcdefghijk","1",2,ProcessInfo.processInfo.systemUptime,0)
func body(_ rows:[[String:Any]],token:String="1",id:String="abcdefghijk")->[String:Any] { ["kind":"geometry-trace","videoID":id,"token":token,"href":"https://m.youtube.com/watch?v=\\(id)","rows":rows] }
let row:[String:Any]=["phase":"handoff","sequence":1,"pictureY":100.25,"viewportWidth":390,"paused":true,"rootFixed":false,"exitContextHidden":true,"exitUsingCachedDestination":false,"videoWidth":Double.nan,"title":"private title","query":"private search","href":"https://private.test","videoID":"private","phaseInjection":"value"]
stage.fullscreenGeometryChanged(body([row],token:"old"));expect(StartupDiagnostics.entries.isEmpty,"stale token rejected")
stage.fullscreenGeometryChanged(body([row],id:"zyxwvutsrqp"));expect(StartupDiagnostics.entries.isEmpty,"stale media rejected")
stage.fullscreenGeometryChanged(body([["phase":"arbitrary private string"]]));expect(StartupDiagnostics.entries.isEmpty,"phase whitelist enforced")
stage.fullscreenGeometryChanged(body([row]));expect(StartupDiagnostics.entries.count==1,"current transaction records geometry")
let entry=StartupDiagnostics.entries[0]
expect(entry["event"] as? String == "fullscreen-geometry" && entry["pictureY"] as? Double == 100.25,"numeric geometry preserved")
expect(entry["safeTop"] as? Double == 59 && entry["nativePlayerWidth"] as? CGFloat == 390 && entry["nativeExitPending"] as? Bool == true,"native geometry and ownership included")
expect(entry["direction"] as? String == "exit" && entry["nativeEnterPending"] as? Bool == false,"native transition direction is explicit")
expect(entry["exitContextHidden"] as? Bool == true && entry["exitUsingCachedDestination"] as? Bool == false,"bounded context/cache booleans accompany measured motion onset")
let unsafeFlags=stage.fullscreenGeometryRow(["phase":"handoff","exitContextHidden":"private page text","exitUsingCachedDestination":"private query"])
expect(unsafeFlags?["exitContextHidden"]==nil && unsafeFlags?["exitUsingCachedDestination"]==nil,"new flags cannot persist arbitrary page strings")
let ownerMetrics:[String:Any]=["phase":"handoff","inlineSizeOwned":true,"inlineSizeSuspended":false,"playerSetSizeAvailable":false,"naturalVideoWidth":402.0,"naturalVideoHeight":226.125,"naturalContainerWidth":402.0,"naturalContainerHeight":226.125,"videoInlineWidth":100.0,"videoInlineHeight":100.0,"containerInlineWidth":100.0,"containerInlineHeight":100.0]
let ownerEntry=stage.fullscreenGeometryRow(ownerMetrics)
expect(ownerEntry?["inlineSizeOwned"] as? Bool == true && ownerEntry?["inlineSizeSuspended"] as? Bool == false && ownerEntry?["playerSetSizeAvailable"] as? Bool == false,"inline ownership is explicitly typed geometry metadata")
for key in ["naturalVideoWidth","naturalVideoHeight","naturalContainerWidth","naturalContainerHeight","videoInlineWidth","videoInlineHeight","containerInlineWidth","containerInlineHeight"] {
 expect(ownerEntry?[key] as? Double == ownerMetrics[key] as? Double,"owner geometry preserves finite scalar \\(key)")
 var invalid=ownerMetrics;invalid[key]=Double.infinity
 expect(stage.fullscreenGeometryRow(invalid)?[key]==nil,"nonfinite owner scalar rejected: \\(key)")
 invalid[key]="private page string"
 expect(stage.fullscreenGeometryRow(invalid)?[key]==nil,"page string cannot enter owner scalar: \\(key)")
}
for key in ["inlineSizeOwned","inlineSizeSuspended","playerSetSizeAvailable"] {
 var invalid=ownerMetrics;invalid[key]="private page string"
 expect(stage.fullscreenGeometryRow(invalid)?[key]==nil,"page string cannot enter owner flag: \\(key)")
}
expect(["title","query","href","videoID","phaseInjection","videoWidth","token"].allSatisfy{entry[$0]==nil},"page strings and nonfinite values are excluded")
stage.customFullscreenExit=nil;stage.playerFullscreen=false
stage.fullscreenGeometryChanged(body([["phase":"committed","pictureY":100]]));expect(StartupDiagnostics.entries.count==2,"postcommit observation retained for same request")
stage.loadTicket=3;stage.fullscreenGeometryChanged(body([row]));expect(StartupDiagnostics.entries.count==2,"new navigation cannot append stale trace")
stage.loadTicket=2;stage.mode = .mini;stage.fullscreenGeometryChanged(body([row]));expect(StartupDiagnostics.entries.count==2,"inactive player mode rejected")
stage.mode = .expanded;StartupDiagnostics.enabled=false;stage.fullscreenGeometryChanged(body([row]));expect(StartupDiagnostics.entries.count==2,"diagnostics disabled by default")
StartupDiagnostics.enabled=true;stage.fullscreenGeometryTrace?.beganAt=ProcessInfo.processInfo.systemUptime-4
stage.fullscreenGeometryChanged(body([row]));expect(StartupDiagnostics.entries.count==2,"three second budget enforced")
stage.fullscreenGeometryTrace=("abcdefghijk","2",2,ProcessInfo.processInfo.systemUptime,0)
StartupDiagnostics.entries=[]
stage.fullscreenGeometryChanged(body(Array(repeating:row,count:100),token:"2"));expect(StartupDiagnostics.entries.count==12,"per message bound enforced")
for _ in 0..<30 {stage.fullscreenGeometryChanged(body(Array(repeating:row,count:12),token:"2"))}
expect(StartupDiagnostics.entries.count==240 && stage.fullscreenGeometryTrace?.rows==240,"per exit frame bound enforced")
stage.fullscreenGeometryTrace=("abcdefghijk","3",2,ProcessInfo.processInfo.systemUptime,0);stage.fullscreenGeometryDirection="enter";stage.customFullscreenEnter=Stage.Exit(waitingForRotation:true)
StartupDiagnostics.entries=[];stage.fullscreenGeometryChanged(body([row],token:"3"))
expect(StartupDiagnostics.entries.count==1 && StartupDiagnostics.entries[0]["direction"] as? String == "enter" && StartupDiagnostics.entries[0]["nativeEnterPending"] as? Bool == true && StartupDiagnostics.entries[0]["nativeRotating"] as? Bool == true,"first entry tracing uses authenticated native direction and rotation ownership")
print("FULLSCREEN_GEOMETRY_DIAGNOSTICS_OK")
`;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'langform-fs-trace-'));
  try {
    const file=path.join(directory,'Trace.swift');fs.writeFileSync(file,exercise);
    const result=spawnSync(compiler.stdout.trim(),[file],{encoding:'utf8',timeout:60000});
    assert.equal(result.error,undefined,String(result.error));assert.equal(result.status,0,result.stdout+result.stderr);
    assert.match(result.stdout,/FULLSCREEN_GEOMETRY_DIAGNOSTICS_OK/);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
