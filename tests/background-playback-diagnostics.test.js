const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {JSDOM}=require('jsdom');
const app=path.join(__dirname,'../ios/Langform/Langform');
const policy=fs.readFileSync(path.join(app,'VideoLoadProbe.swift'),'utf8');
const native=fs.readFileSync(path.join(app,'YouTubeWebView.swift'),'utf8');
const snapshot=policy.match(/static let snapshotFunction = #"""\n([\s\S]*?)\n"""#/)[1];
function page(t){
 const dom=new JSDOM('<div id="movie_player"><video src="https://private.example/media?secret=sample"></video></div><video id="preview"></video>',{url:'https://m.youtube.com/watch?v=abcdefghijk',runScripts:'outside-only',pretendToBeVisual:true});
 t.after(()=>dom.window.close());const win=dom.window,doc=win.document,root=doc.getElementById('movie_player'),video=root.querySelector('video');
 const values={paused:false,ended:false,seeking:false,muted:false,error:null,readyState:4,currentTime:30,duration:120,playbackRate:1,volume:1,currentSrc:video.src};
 for(const name of Object.keys(values))Object.defineProperty(video,name,{configurable:true,get:()=>values[name],set:()=>assert.fail('snapshot never writes '+name)});
 video.play=video.pause=()=>assert.fail('snapshot never changes playback');win.setTimeout=win.setInterval=()=>assert.fail('snapshot creates no timers');
 const data={video_id:'abcdefghijk',isAd:false};root.getVideoData=()=>data;video.webkitPresentationMode='inline';video.webkitSupportsPresentationMode=()=>true;
 const run=()=>win.eval('('+snapshot+')("abcdefghijk")');return{win,doc,root,video,values,data,run};
}
test('shipping snapshot reads only current main media and keeps URLs/account text out of its result',t=>{
 const s=page(t),first=s.run();assert.equal(first.ownerMatches,true);assert.equal(first.paused,false);assert.equal(first.time,30);assert.equal(first.hasSource,true);assert.equal(first.sourceKind,'https');assert.equal(first.supportsPiP,true);
 assert.deepEqual([first.mediaToken,first.sourceToken],[1,1]);assert.deepEqual([s.run().mediaToken,s.run().sourceToken],[1,1]);
 assert.doesNotMatch(JSON.stringify(first),/private|secret|https:\/\/|abcdefghijk/);assert.equal(s.doc.querySelectorAll('video').length,2);
});
for(const state of ['paused','ended','seeking','muted','hidden','buffering','error'])test('shipping snapshot reports '+state+' without playback, rate or volume changes',t=>{
 const s=page(t);if(state==='hidden')Object.defineProperty(s.doc,'hidden',{value:true,configurable:true});else if(state==='buffering')s.values.readyState=2;else if(state==='error')s.values.error={code:4};else s.values[state]=true;
 const out=s.run();assert.equal(out.ownerMatches,true);assert.equal(out[state==='buffering'?'readyState':state],state==='buffering'?2:true);assert.equal(out.rate,1);assert.equal(out.volume,1);
});
test('source and physical medium ordinals distinguish same-video replacement without exporting the source',t=>{
 const s=page(t);const first=s.run();s.values.currentSrc='blob:private-new';const source=s.run();assert.equal(source.mediaToken,first.mediaToken);assert.equal(source.sourceToken,first.sourceToken+1);assert.equal(source.sourceKind,'blob');
 s.video.setAttribute('src','https://private.example/next');assert.equal(s.run().sourceToken,source.sourceToken+1);
 const replacement=s.video.cloneNode();Object.defineProperties(replacement,{currentSrc:{value:'blob:third'},currentTime:{value:30},duration:{value:120},readyState:{value:4}});s.video.replaceWith(replacement);
 const next=s.run();assert.equal(next.mediaToken,first.mediaToken+1);assert.equal(next.ownerMatches,true);assert.doesNotMatch(JSON.stringify(next),/private|third|secret/);
});
for(const variant of ['route','data','ad-data','ad-class','absent','changed-during-read'])test('snapshot ownership rejects '+variant,t=>{
 const s=page(t);if(variant==='route')s.win.history.replaceState({},'','/watch?v=zzzzzzzzzzz');if(variant==='data')s.data.video_id='zzzzzzzzzzz';if(variant==='ad-data')s.data.isAd=true;if(variant==='ad-class')s.root.classList.add('ad-showing');if(variant==='absent')s.video.remove();
 if(variant==='changed-during-read')Object.defineProperty(s.video,'currentTime',{get:()=>{s.values.currentSrc='blob:changed-during-read';return 30;}});
 assert.equal(s.run().ownerMatches,false);
});
test('feature-detected system states are observed, never set or used as proof of audible playback',t=>{
 const s=page(t);Object.defineProperties(s.win.navigator,{audioSession:{value:{get type(){return'playback';},set type(_){assert.fail('no category write');},state:'interrupted'}},mediaSession:{value:{playbackState:'paused'}}});
 const result=s.run();assert.equal(result.audioSessionType,'playback');assert.equal(result.audioSessionState,'interrupted');assert.equal(result.mediaSessionState,'paused');assert.equal(result.paused,false,'main media remains authoritative');
});
function method(name){const start=native.indexOf('private func '+name+'(');assert.ok(start>=0);let end=native.indexOf('{',start)+1,depth=1;while(depth&&end<native.length){if(native[end]==='{')depth++;if(native[end]==='}')depth--;end++;}return native.slice(start,end);}
function swift(t,body){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'langform-background-probe-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'Probe.swift');fs.writeFileSync(file,policy+'\n'+body);const out=spawnSync('/usr/bin/xcrun',['swift',file],{encoding:'utf8',timeout:60000});assert.equal(out.error,undefined);assert.equal(out.status,0,out.stdout+out.stderr);}
test('shipping diagnostic opt-in, sample cap and privacy sanitizer execute in Swift',{skip:process.platform!=='darwin',timeout:70000},t=>swift(t,`
func expect(_ value:Bool,_ reason:String){if !value{print("FAILED: "+reason);exit(1)}}
let enabled=["LANGFORM_DIAGNOSTICS":"1","LANGFORM_BACKGROUND_AUDIO_PROBE":"1","LANGFORM_VIDEO_PROBE":"[\\"abcdefghijk\\"]","LANGFORM_VIDEO_PROBE_PLAY":"1","LANGFORM_VIDEO_PROBE_AUDIO":"1"]
for key in enabled.keys {for bad in ["0","true"," 1",""]{var env=enabled;env[key]=bad;expect(BackgroundPlaybackProbe(environment:env)==nil,"exact opt-in "+key)}}
var multiple=enabled;multiple["LANGFORM_VIDEO_PROBE"]="[\\"abcdefghijk\\",\\"zzzzzzzzzzz\\"]";expect(BackgroundPlaybackProbe(environment:multiple)==nil,"single audible owner only")
var p=BackgroundPlaybackProbe(environment:enabled)!;expect(p.claim(phase:"unknown",videoID:p.videoID)==nil && p.claim(phase:"watch-ready",videoID:"zzzzzzzzzzz")==nil && p.samples==0,"no budget consumed by invalid phase/identity")
expect(p.claim(phase:"watch-ready",videoID:p.videoID)==1 && p.claim(phase:"watch-ready",videoID:p.videoID)==nil,"baseline once")
for number in 2...20 {expect(p.claim(phase:"did-enter-background",videoID:p.videoID)==number,"finite numbered budget")};expect(p.claim(phase:"background+2s",videoID:p.videoID)==nil && p.samples==20,"cap stops reads")
let clean=BackgroundPlaybackProbe.sanitized(["paused":true,"time":30,"duration":Double.infinity,"sourceToken":2,"sourceKind":"https","audioSessionType":"https://secret","currentSrc":"https://private","title":"account", "error":false])
expect(clean["paused"] as? Bool==true && clean["time"] as? Int==30,"known finite values preserved")
expect(clean["duration"]==nil && clean["currentSrc"]==nil && clean["title"]==nil && clean["audioSessionType"]==nil,"no nonfinite/private strings exported")
expect(p.snapshotJavaScript().contains("abcdefghijk"),"encoded current owner")
print("BACKGROUND_POLICY_OK")
`));
test('shipping native observer rejects stale callbacks, labels delayed completion state and schedules only bounded +2/+6 reads',{skip:process.platform!=='darwin',timeout:70000},t=>swift(t,`
enum StartupDiagnostics {static var enabled=true;static var rows:[[String:Any]]=[];static func videoMark(_ row:[String:Any]){rows.append(row)}}
class UIApplication {static let shared=UIApplication();enum State:Int{case active=0,inactive=1,background=2};var applicationState=State.active}
enum MediaState:Int {case none=0,playing=1,paused=2,suspended=3}
class Web {var url=URL(string:"https://m.youtube.com/watch?v=abcdefghijk");var reads=0;var queries=0;var states:[(MediaState)->Void]=[];var scripts:[(Any?,Error?)->Void]=[];func requestMediaPlaybackState(_ done:@escaping(MediaState)->Void){queries+=1;states.append(done)};func evaluateJavaScript(_ source:String,completionHandler:@escaping(Any?,Error?)->Void){reads+=1;scripts.append(completionHandler)}}
enum YouTubeWebView {static func videoID(_ url:URL?)->String?{url.flatMap{URLComponents(url:$0,resolvingAgainstBaseURL:false)?.queryItems?.first{$0.name=="v"}?.value}}}
class DispatchWorkItem {let body:()->Void;var cancelled=false;init(block:@escaping()->Void){body=block};func cancel(){cancelled=true};func run(){if !cancelled{body()}}}
struct Deadline {static func now()->Deadline{Deadline()};static func +(lhs:Deadline,rhs:Double)->Double{rhs}}
class DispatchQueue {static let main=DispatchQueue();var pending:[(Double,DispatchWorkItem)]=[];func asyncAfter(deadline:Double,execute:DispatchWorkItem){pending.append((deadline,execute))}}
class Stage {enum Mode{case closed,loading,expanded,mini};var mode=Mode.expanded;var player:Web?=Web();var loadTicket=1;var systemMediaSuspendedForOffline=false;var backgroundPlaybackWork:[DispatchWorkItem]=[];var backgroundPlaybackProbe:BackgroundPlaybackProbe?
 init(){backgroundPlaybackProbe=BackgroundPlaybackProbe(environment:["LANGFORM_DIAGNOSTICS":"1","LANGFORM_BACKGROUND_AUDIO_PROBE":"1","LANGFORM_VIDEO_PROBE":"[\\"abcdefghijk\\"]","LANGFORM_VIDEO_PROBE_PLAY":"1","LANGFORM_VIDEO_PROBE_AUDIO":"1"])}
 ${method('recordBackgroundPlaybackTransition')}
 ${method('sampleBackgroundPlayback')}
 func record(_ phase:String){recordBackgroundPlaybackTransition(phase)}
}
func expect(_ value:Bool,_ message:String){if !value{print("FAILED: "+message);exit(1)}}
let normal=Stage();normal.backgroundPlaybackProbe=nil;normal.record("did-enter-background");expect(normal.player!.reads==0 && DispatchQueue.main.pending.isEmpty,"normal app has no reads/tasks")
let disabled=Stage();StartupDiagnostics.enabled=false;disabled.record("watch-ready");expect(disabled.player!.reads==0,"diagnostics master disabled");StartupDiagnostics.enabled=true
let stage=Stage(),web=stage.player!;stage.record("watch-ready");stage.record("watch-ready");expect(web.reads==1 && web.queries==1,"one true baseline")
UIApplication.shared.applicationState = .background;web.states[0](.paused);web.scripts[0](["paused":true,"time":30,"currentSrc":"https://secret"],nil)
let delayed=StartupDiagnostics.rows.last!;expect(delayed["requestedApplicationState"] as? Int==0 && delayed["completionApplicationState"] as? Int==2,"delayed callback retains actual request/completion states")
expect((delayed["snapshot"] as? [String:Any])?["currentSrc"]==nil,"sanitized native output")
stage.record("did-enter-background");expect(DispatchQueue.main.pending.map{$0.0}==[2,6],"only two one-shot samples")
let oldTasks=DispatchQueue.main.pending.map{$0.1};stage.record("did-become-active");expect(oldTasks.allSatisfy{$0.cancelled},"return cancels delayed background requests")
let count=StartupDiagnostics.rows.count;stage.loadTicket+=1;web.states[1](.playing);web.scripts[1](["paused":false],nil);expect(StartupDiagnostics.rows.count==count,"old ticket replies rejected")
let stale=Stage(),old=stale.player!;stale.record("watch-ready");stale.player=Web();let before=StartupDiagnostics.rows.count;old.states[0](.playing);old.scripts[0](["paused":false],nil);expect(StartupDiagnostics.rows.count==before,"replaced WKView replies rejected")
let changed=Stage();changed.record("watch-ready");changed.player!.url=URL(string:"https://m.youtube.com/watch?v=zzzzzzzzzzz");let previous=StartupDiagnostics.rows.count;changed.player!.states[0](.playing);changed.player!.scripts[0](["paused":false],nil);expect(StartupDiagnostics.rows.count==previous,"route replies rejected")
let capped=Stage();for _ in 0..<40{capped.record("did-enter-background")};expect(capped.player!.reads==20 && capped.player!.queries==20 && capped.backgroundPlaybackWork.isEmpty,"budget stops queries and scheduled work")
let retired=Stage();retired.record("did-enter-background");let planned=retired.backgroundPlaybackWork;retired.record("cancel");expect(planned.allSatisfy{$0.cancelled} && retired.backgroundPlaybackWork.isEmpty,"stop revokes timers")
print("BACKGROUND_STAGE_OK")
`));
