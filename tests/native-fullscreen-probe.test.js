const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

function method(source,name) {
  const start=source.indexOf('func '+name+'(');assert.ok(start>=0,name);
  let end=source.indexOf('{',start)+1,depth=1;
  while(depth&&end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}
  return source.slice(start,end);
}

test('native fullscreen diagnostic admits only the valid opt-in plan, authenticates commits and cancels stale work',{
  skip:process.platform!=='darwin',timeout:70000,
},t=>{
  const app=path.join(__dirname,'../ios/Langform/Langform'),source=fs.readFileSync(path.join(app,'YouTubeWebView.swift'),'utf8');
  const methods=['startFullscreenDiagnosticProbeBeforeClose','cancelFullscreenDiagnosticProbe','fullscreenDiagnosticChanged'].map(name=>method(source,name)).join('\n');
  const exercise=`
import Foundation
enum StartupDiagnostics { static let enabled=true; static var events:[String]=[]; static func mark(_ event:String){events.append(event)} }
class UIApplication { enum State { case active, background }; static let shared=UIApplication(); var applicationState=State.active }
class Queue { var deadlines:[DispatchTime]=[];func asyncAfter(deadline:DispatchTime,execute:DispatchWorkItem){deadlines.append(deadline)} }
enum DispatchQueue { static let main=Queue() }
class Web { var url:URL?=URL(string:"https://m.youtube.com/watch?v=abcdefghijk");var scripts:[String]=[];var completion:((Any?,Error?)->Void)?
 func evaluateJavaScript(_ source:String,completionHandler:((Any?,Error?)->Void)?=nil){scripts.append(source);if let completionHandler{completion=completionHandler}}
}
enum YouTubeWebView { static func videoID(_ url:URL?)->String? { guard let url,url.scheme=="https",["m.youtube.com","www.youtube.com","youtube.com"].contains(url.host ?? ""),url.path=="/watch" else{return nil};return URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems?.first{$0.name=="v"}?.value } }
struct StartupStatus { enum State { case playing,paused };var state=State.playing }
class Stage {
 enum Mode { case expanded,mini,closed,loading };var mode=Mode.expanded
 var dragging=false,cardMoving=false,playerOverlayOpen=false,videoPlaying=true
 var customFullscreenID:String?,customFullscreenEnter:String?,customFullscreenExit:String?
 var startupStatus=StartupStatus(),startupVideoID:String?="abcdefghijk",loadTicket=42,player:Web?=Web()
 var interactionProbe=PlayerInteractionProbe(),interactionProbeWork:DispatchWorkItem?,interactionProbeTimeout:DispatchWorkItem?
 var fullscreenDiagnosticPending:(videoID:String,ticket:Int,token:String,request:PlayerInteractionProbe.Request)?
 var fullscreenDiagnosticCompletedTicket:Int?,fullscreenDiagnosticTimeout:DispatchWorkItem?,resumed:[PlayerInteractionProbe.Request]=[]
 func scheduleInteractionAction(_ request:PlayerInteractionProbe.Request){resumed.append(request)}
 ${methods}
}
func expect(_ value:Bool,_ message:String){if !value{print("FAILED: "+message);exit(1)}}
func closeRequest(_ stage:Stage)->PlayerInteractionProbe.Request {
 let url=stage.player!.url
 _=stage.interactionProbe?.start(observation:.init(videoID:"abcdefghijk",mode:.expanded,playing:true,hasVideo:true,mediaReady:true,settled:true,url:url))
 while let request=stage.interactionProbe?.pending,request.step != .close {
  let expanded=request.step == .expandPaused || request.step == .expandPlaying
  let playing=request.step == .minimizePlaying || request.step == .resumeMini || request.step == .expandPlaying
  _=stage.interactionProbe?.observe(.init(videoID:"abcdefghijk",mode:expanded ? .expanded:.mini,playing:playing,hasVideo:true,mediaReady:true,settled:true,url:url),ticket:request.ticket)
 }
 return stage.interactionProbe!.pending!
}
func body(_ stage:Stage,_ phase:String,_ token:String?=nil)->[String:Any]{["kind":"diagnostic-probe","phase":phase,"videoID":"abcdefghijk","token":token ?? stage.fullscreenDiagnosticPending!.token,"href":"https://m.youtube.com/watch?v=abcdefghijk"]}
func arguments(_ stage:Stage)->[Any] {
 let script=stage.player!.scripts[0],range=script.range(of:"DiagnosticProbe.run.apply(null, ")!
 let raw=String(script[range.upperBound...].dropLast())
 return try! JSONSerialization.jsonObject(with:raw.data(using:.utf8)!) as! [Any]
}
func timeoutSeconds()->Double { Double(DispatchQueue.main.deadlines.last!.uptimeNanoseconds-DispatchTime.now().uptimeNanoseconds)/1_000_000_000 }
unsetenv("LANGFORM_FULLSCREEN_PROBE_CYCLES");unsetenv("LANGFORM_FULLSCREEN_PROBE_HOLD_MS")
let ordinary=Stage(),ordinaryRequest=closeRequest(ordinary)
unsetenv("LANGFORM_FULLSCREEN_PROBE")
expect(!ordinary.startFullscreenDiagnosticProbeBeforeClose(ordinaryRequest)&&ordinary.player!.scripts.isEmpty,"default launch cannot schedule or evaluate fullscreen diagnostics")
setenv("LANGFORM_FULLSCREEN_PROBE","1",1)
for target in [Stage.Mode.mini,.closed,.loading] {ordinary.mode=target;expect(!ordinary.startFullscreenDiagnosticProbeBeforeClose(ordinaryRequest),"nonexpanded mode rejected")};ordinary.mode = .expanded
ordinary.dragging=true;expect(!ordinary.startFullscreenDiagnosticProbeBeforeClose(ordinaryRequest),"drag rejected");ordinary.dragging=false
ordinary.videoPlaying=false;expect(!ordinary.startFullscreenDiagnosticProbeBeforeClose(ordinaryRequest),"actual native playback required");ordinary.videoPlaying=true
let active=Stage(),request=closeRequest(active)
expect(active.startFullscreenDiagnosticProbeBeforeClose(request),"valid expandedPlaying plan starts fullscreen before close")
let token=active.fullscreenDiagnosticPending!.token
expect(active.player!.scripts.count==1&&active.player!.scripts[0].contains("DiagnosticProbe.run.apply"),"production JS run once")
let defaults=arguments(active)
expect(defaults.count==4&&defaults[0] as? String == "abcdefghijk"&&defaults[1] as? String == token&&defaults[2] as? Int == 1&&defaults[3] as? Int == 3000,"default probe serializes one real cycle and existing hold")
expect(abs(timeoutSeconds()-14)<0.1,"single-cycle default preserves bounded 14-second deadline")
expect(active.startFullscreenDiagnosticProbeBeforeClose(request)&&active.player!.scripts.count==1,"duplicate scheduling cannot create another sequence")
active.player!.completion?(true,nil)
active.fullscreenDiagnosticChanged(body(active,"opened","stale"));expect(!StartupDiagnostics.events.contains("fullscreen-probe-opened"),"stale ACK rejected")
active.customFullscreenID="abcdefghijk";active.customFullscreenEnter="pending"
active.fullscreenDiagnosticChanged(body(active,"opened"));expect(!StartupDiagnostics.events.contains("fullscreen-probe-opened"),"entry screenshot hold requires native commit")
active.customFullscreenEnter=nil;active.fullscreenDiagnosticChanged(body(active,"opened"));expect(StartupDiagnostics.events.contains("fullscreen-probe-opened"),"committed opened marker accepted")
active.fullscreenDiagnosticChanged(body(active,"finished"));expect(active.resumed.isEmpty,"fullscreen ownership cannot resume close")
active.customFullscreenID=nil;active.fullscreenDiagnosticChanged(body(active,"inline"));active.fullscreenDiagnosticChanged(body(active,"finished"))
expect(active.fullscreenDiagnosticPending==nil&&active.fullscreenDiagnosticCompletedTicket==42&&active.resumed==[request],"matching inline completion resumes exact close once")
expect(!active.startFullscreenDiagnosticProbeBeforeClose(request),"same load cannot repeat diagnostic handoff")
active.fullscreenDiagnosticChanged(["phase":"finished","token":token]);expect(active.resumed.count==1,"late completion no-op")
for (cycles,hold,budget) in [(1,200,8.4),(6,250,31.0),(6,3000,60.0)] {
 setenv("LANGFORM_FULLSCREEN_PROBE_CYCLES",String(cycles),1);setenv("LANGFORM_FULLSCREEN_PROBE_HOLD_MS",String(hold),1)
 let repeated=Stage(),repeatRequest=closeRequest(repeated)
 expect(repeated.startFullscreenDiagnosticProbeBeforeClose(repeatRequest),"bounded repetition starts only one native run")
 let values=arguments(repeated)
 expect(values[2] as? Int == cycles && values[3] as? Int == hold,"exact repetitions and millisecond hold reach production JS API")
 expect(abs(timeoutSeconds()-budget)<0.1,"deadline scales with cycles and committed holds, capped at 60 seconds")
 expect(repeated.startFullscreenDiagnosticProbeBeforeClose(repeatRequest)&&repeated.player!.scripts.count==1,"repeat scheduling cannot duplicate real fullscreen run")
 repeated.cancelFullscreenDiagnosticProbe()
 expect(repeated.player!.scripts.count==2&&repeated.interactionProbe?.state == .cancelled,"repeated run retains real page cancellation and lifecycle")
}
for (key,value) in [("LANGFORM_FULLSCREEN_PROBE_CYCLES","0"),("LANGFORM_FULLSCREEN_PROBE_CYCLES","7"),("LANGFORM_FULLSCREEN_PROBE_CYCLES","1.5"),("LANGFORM_FULLSCREEN_PROBE_CYCLES","nan"),("LANGFORM_FULLSCREEN_PROBE_CYCLES","999999999999999999999999"),("LANGFORM_FULLSCREEN_PROBE_HOLD_MS","199"),("LANGFORM_FULLSCREEN_PROBE_HOLD_MS","3001"),("LANGFORM_FULLSCREEN_PROBE_HOLD_MS","250.0"),("LANGFORM_FULLSCREEN_PROBE_HOLD_MS","nan")] {
 unsetenv("LANGFORM_FULLSCREEN_PROBE_CYCLES");unsetenv("LANGFORM_FULLSCREEN_PROBE_HOLD_MS");setenv(key,value,1)
 let invalid=Stage(),invalidRequest=closeRequest(invalid),before=DispatchQueue.main.deadlines.count
 expect(!invalid.startFullscreenDiagnosticProbeBeforeClose(invalidRequest)&&invalid.player!.scripts.isEmpty&&invalid.fullscreenDiagnosticPending==nil&&DispatchQueue.main.deadlines.count==before,"invalid native environment cannot evaluate JS or create probe work")
}
unsetenv("LANGFORM_FULLSCREEN_PROBE_CYCLES");unsetenv("LANGFORM_FULLSCREEN_PROBE_HOLD_MS")
let stale=Stage(),staleRequest=closeRequest(stale);_ = stale.startFullscreenDiagnosticProbeBeforeClose(staleRequest)
stale.loadTicket += 1;stale.player!.completion?(true,nil)
expect(stale.fullscreenDiagnosticPending==nil&&stale.interactionProbe?.state == .cancelled&&stale.player!.scripts.last!.contains("DiagnosticProbe.cancel.apply"),"load-ticket change cancels actual JS pending motion")
let failure=Stage(),failureRequest=closeRequest(failure);_ = failure.startFullscreenDiagnosticProbeBeforeClose(failureRequest);failure.player!.completion?(false,nil)
expect(failure.fullscreenDiagnosticPending==nil&&failure.interactionProbe?.state == .cancelled,"missing/refused page API terminates probe")
let deadline=Stage(),deadlineRequest=closeRequest(deadline);_ = deadline.startFullscreenDiagnosticProbeBeforeClose(deadlineRequest);deadline.fullscreenDiagnosticTimeout!.perform()
expect(deadline.fullscreenDiagnosticPending==nil&&StartupDiagnostics.events.last=="fullscreen-probe-timeout"&&deadline.resumed.isEmpty,"bounded timeout cancels without automatic close")
let background=Stage(),backgroundRequest=closeRequest(background);_ = background.startFullscreenDiagnosticProbeBeforeClose(backgroundRequest)
UIApplication.shared.applicationState = .background;background.fullscreenDiagnosticChanged(body(background,"opened"))
expect(background.fullscreenDiagnosticPending==nil&&background.interactionProbe?.state == .cancelled,"background cannot continue screenshot or close sequence")
let count=background.player!.scripts.count;background.cancelFullscreenDiagnosticProbe();expect(background.player!.scripts.count==count,"cancel with no owned work is strict no-op")
print("native-fullscreen-probe: passed")
`;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'langform-native-fullscreen-probe-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'main.swift');fs.writeFileSync(file,fs.readFileSync(path.join(app,'VideoLoadProbe.swift'),'utf8')+'\n'+fs.readFileSync(path.join(app,'PlayerInteractionProbe.swift'),'utf8')+'\n'+exercise);
  const run=spawnSync('/usr/bin/xcrun',['swift',file],{encoding:'utf8',timeout:60000,env:{...process.env,LANGFORM_DIAGNOSTICS:'1',LANGFORM_PLAYER_PROBE:'1',LANGFORM_FULLSCREEN_PROBE:'1',LANGFORM_VIDEO_PROBE:'["abcdefghijk"]'}});
  assert.equal(run.status,0,run.stderr+'\n'+run.stdout);assert.match(run.stdout,/native-fullscreen-probe: passed/);
});
