const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const app=path.join(__dirname,'../ios/Langform/Langform');
const policy=fs.readFileSync(path.join(app,'VideoLoadProbe.swift'),'utf8');
const native=fs.readFileSync(path.join(app,'YouTubeWebView.swift'),'utf8');
const diagnostics=fs.readFileSync(path.join(app,'StartupDiagnostics.swift'),'utf8');
function declaration(source,signature){const start=source.indexOf(signature);assert.ok(start>=0,signature);let end=source.indexOf('{',start)+1,depth=1;while(depth&&end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}return source.slice(start,end);}
const sanitizer=declaration(diagnostics,'enum PlayerDiagnosticEvent {');
function swift(t,body){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'langform-audio-route-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'Probe.swift');fs.writeFileSync(file,'import CoreFoundation\n'+policy+'\n'+sanitizer+'\n'+body);const r=spawnSync('/usr/bin/xcrun',['swift',file],{encoding:'utf8',timeout:60000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stdout+r.stderr);}
const expect='func expect(_ value:Bool,_ reason:String){if !value{print("FAILED: "+reason);exit(1)}}\n';

test('shipping silence gate preserves only explicit route-player audio; feed and other diagnostic starts retain their scope',{skip:process.platform!=='darwin',timeout:70000},t=>{
 const start=native.indexOf('        let audibleVideoProbe ='),gateStart=native.indexOf('        if StartupDiagnostics.enabled && !audibleVideoProbe',start);
 assert.ok(start>=0&&gateStart>start);let end=native.indexOf('{',gateStart)+1,depth=1;while(depth&&end<native.length){if(native[end]==='{')depth++;if(native[end]==='}')depth--;end++;}
 const gate=native.slice(start,end),decls=['enabled','audioRouteProbeEnabled'].map(name=>diagnostics.match(new RegExp('    static let '+name+' = [^\\n]+'))[0]).join('\n');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'langform-route-silence-gate-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'Gate.swift');
 fs.writeFileSync(file,policy+`\nenum StartupDiagnostics{${decls}}
struct WKUserScript{enum Time{case atDocumentStart};enum World{case page};let source:String;init(source:String,injectionTime:Time,forMainFrameOnly:Bool,in:World){self.source=source}}
class ContentController{var scripts=[WKUserScript]();func addUserScript(_ script:WKUserScript){scripts.append(script)}}
class Configuration{let userContentController=ContentController()}
func readScripts(_ names:[String])->String{names.joined(separator:",")}
let isFeed=CommandLine.arguments[1]=="feed",configuration=Configuration()
${gate}
let expected=Int(CommandLine.arguments[2])!
if configuration.userContentController.scripts.count != expected{print("FAILED: silence scope");exit(1)}
if configuration.userContentController.scripts.contains(where:{$0.source != "SilentDiagnostics"}){exit(1)}
print("SILENCE_GATE_OK")
`);
 const cases=[{master:'1',route:'0',feed:false,silent:1},{master:'1',route:'1',feed:false,silent:0},{master:'1',route:'1',feed:true,silent:1},{master:'0',route:'1',feed:false,silent:0},{master:'0',route:'1',feed:true,silent:0},{master:null,route:'1',feed:false,silent:0},{master:'1',route:'0',feed:false,video:true,silent:0},{master:'1',route:'0',feed:true,video:true,silent:1}];
 for(const c of cases){const env={...process.env,LANGFORM_DIAGNOSTICS:c.master,LANGFORM_AUDIO_ROUTE_PROBE:c.route};if(c.master===null)delete env.LANGFORM_DIAGNOSTICS;delete env.LANGFORM_VIDEO_PROBE;delete env.LANGFORM_VIDEO_PROBE_PLAY;delete env.LANGFORM_VIDEO_PROBE_AUDIO;if(c.video){env.LANGFORM_VIDEO_PROBE='["abcdefghijk"]';env.LANGFORM_VIDEO_PROBE_PLAY='1';env.LANGFORM_VIDEO_PROBE_AUDIO='1';}const r=spawnSync('/usr/bin/xcrun',['swift',file,c.feed?'feed':'player',String(c.silent)],{env,encoding:'utf8',timeout:60000});assert.equal(r.error,undefined);assert.equal(r.status,0,JSON.stringify(c)+'\n'+r.stdout+r.stderr);}
});

test('audio route policy requires exact independent opt-in and shares a finite48-snapshot budget',{skip:process.platform!=='darwin',timeout:70000},t=>swift(t,expect+`
let enabled=["LANGFORM_DIAGNOSTICS":"1","LANGFORM_AUDIO_ROUTE_PROBE":"1"]
for key in enabled.keys{for bad in ["0","true"," 1",""]{var e=enabled;e[key]=bad;expect(AudioRouteProbe(environment:e)==nil,"exact flag "+key)}}
expect(AudioRouteProbe(environment:[:])==nil,"normal launch has no probe")
var p=AudioRouteProbe(environment:enabled)!
expect(p.claim(kind:"bad",uptime:0)==nil && p.claim(kind:"player-state",uptime:Double.nan)==nil && p.claim(kind:"route-change",uptime:-1)==nil && p.samples==0,"invalid attempts do not consume")
expect(p.claim(kind:"player-state",uptime:100)==1,"first player snapshot")
expect(p.claim(kind:"player-state",uptime:100.999)==nil && p.claim(kind:"player-state",uptime:99)==nil,"at most one per second and no backward clock")
expect(p.claim(kind:"route-change",uptime:100.2)==2 && p.claim(kind:"interruption",uptime:100.3)==3,"events bypass state throttle")
expect(p.claim(kind:"player-state",uptime:101)==4,"notifications do not push player throttle")
for n in 5...48{expect(p.claim(kind:"route-change",uptime:101)==n,"global budget")}
for kind in ["player-state","route-change","interruption"]{expect(p.claim(kind:kind,uptime:200)==nil,"cap "+kind)}
expect(p.samples==48,"never resets at a new source")
print("ROUTE_BUDGET_OK")
`));

test('native route sanitizer keeps allowed Bluetooth types/reasons and excludes private strings',{skip:process.platform!=='darwin',timeout:70000},t=>swift(t,expect+`
expect(AudioRouteProbe.outputTypes(["BluetoothA2DPOutput","BluetoothHFP","BluetoothLE","Speaker","Receiver","Headphones","AirPlay","USBAudio","private headset"])==["a2dp","hfp","le","speaker","receiver","headphones","airplay","usb"],"port whitelist and8 cap")
expect(AudioRouteProbe.outputTypes(["private headset"])==["unknown"],"no names/UIDs exported")
expect(AudioRouteProbe.routeReason(3)=="categoryChange" && AudioRouteProbe.routeReason(2)=="oldDeviceUnavailable" && AudioRouteProbe.routeReason(8)=="routeConfigurationChange" && AudioRouteProbe.routeReason(999)=="unknown","route reasons")
let out=AudioRouteProbe.sanitized(["kind":"route-change","sample":48,"ticket":2,"callbackUptime":12.0,"snapshotUptime":13.0,"applicationState":0,"systemOutputVolume":0.0,"category":"AVAudioSessionCategoryPlayback","mode":"AVAudioSessionModeDefault","outputTypes":["a2dp","private"],"previousOutputTypes":["hfp"],"routeReason":"categoryChange","portName":"private","uid":"secret","url":"https://private","title":"account","shouldResume":false,"wasSuspended":true,"interruptionReason":"routeDisconnected"])
expect(out["systemOutputVolume"] as? Double==0 && out["outputTypes"] as? [String]==["a2dp","unknown"] && out["previousOutputTypes"] as? [String]==["hfp"],"read-only output state")
expect(out["callbackUptime"] as? Double==12 && out["snapshotUptime"] as? Double==13,"separate callback/completion timing")
expect(out["portName"]==nil && out["uid"]==nil && out["url"]==nil && out["title"]==nil,"no private fields")
expect(out["wasSuspended"]==nil && out["interruptionReason"] as? String=="routeDisconnected","unsupported legacy flag is never exported")
for reason in ["default","builtInMicMuted","routeDisconnected","unknown"]{expect(AudioRouteProbe.sanitized(["interruptionReason":reason])["interruptionReason"] as? String==reason,"fixed interruption reason whitelist")}
expect(AudioRouteProbe.sanitized(["interruptionReason":"appWasSuspended"])["interruptionReason"] as? String=="unknown","old unsupported reason is not asserted")
let bad=AudioRouteProbe.sanitized(["sample":49,"ticket":-1,"applicationState":3,"systemOutputVolume":1.1,"snapshotUptime":Double.infinity,"mode":"secret","category":"secret"])
expect(bad["sample"]==nil && bad["ticket"]==nil && bad["applicationState"]==nil && bad["systemOutputVolume"]==nil && bad["snapshotUptime"]==nil,"numeric limits")
expect(bad["mode"] as? String=="unknown" && bad["category"] as? String=="unknown","native strings normalized")
print("ROUTE_PRIVACY_OK")
`));

test('shipping player diagnostic sanitizer validates audio ranges, unknown fields and boolean mute',{skip:process.platform!=='darwin',timeout:70000},t=>swift(t,expect+`
let known:[String:Any]=["event":"volumechange","target":"media","muted":false,"apiMuted":true,"volume":1.0,"apiVolume":100.0,"rate":16.0,"audioDecoded":-1.0,"audioTracks":32,"audioEnabled":1,"mediaToken":2,"sourceToken":3,"audioSession":"interrupted","audioSessionType":"playback","currentSrc":"https://secret","portName":"private"]
let out=PlayerDiagnosticEvent.sanitized(known)!
expect(out["muted"] as? Bool==false && out["apiMuted"] as? Bool==true && out["volume"] as? Double==1 && out["apiVolume"] as? Double==100 && out["rate"] as? Double==16,"known media/API values")
expect(out["audioDecoded"] as? Double == -1 && out["audioTracks"] as? Double==32 && out["audioSession"] as? String=="interrupted","unsupported/track/session values")
expect(out["currentSrc"]==nil && out["portName"]==nil,"private strings stripped")
let invalid=PlayerDiagnosticEvent.sanitized(["event":"ratechange","target":"media","volume":true,"apiVolume":101,"rate":16.01,"audioDecoded":-2,"audioTracks":33,"audioEnabled":-2,"mediaToken":-1,"sourceToken":Double.infinity,"apiMuted":"unknown","audioSession":"secret","audioSessionType":"https://secret"])!
for key in ["volume","apiVolume","rate","audioDecoded","audioTracks","audioEnabled","mediaToken","sourceToken","apiMuted","audioSession","audioSessionType"]{expect(invalid[key]==nil,"invalid "+key)}
expect(PlayerDiagnosticEvent.sanitized(["event":"arbitrary","target":"media"])==nil,"no arbitrary page events")
print("PLAYER_AUDIO_SANITIZER_OK")
`));

test('shipping recorder reads only admitted current Watch, throttles batches, and never exports raw page fields',{skip:process.platform!=='darwin',timeout:70000},t=>swift(t,`
enum StartupDiagnostics{static var audioRouteProbeEnabled=true;static var rows=[[String:Any]]();static func videoMark(_ row:[String:Any]){rows.append(row)}}
class UIApplication{enum State:Int{case active=0,inactive=1,background=2};static let shared=UIApplication();var applicationState=State.active}
struct PortValue{let rawValue:String}
struct PortDescription{let portType:PortValue}
class AVAudioSessionRouteDescription{var outputs=[PortDescription(portType:PortValue(rawValue:"BluetoothA2DPOutput"))]}
class AVAudioSession{static let session=AVAudioSession();static var reads=0;static func sharedInstance()->AVAudioSession{reads+=1;return session};var outputVolume:Float=0.7;var category=PortValue(rawValue:"AVAudioSessionCategoryPlayback"),mode=PortValue(rawValue:"AVAudioSessionModeDefault");var currentRoute=AVAudioSessionRouteDescription()}
class Web{var url:URL?=URL(string:"https://m.youtube.com/watch?v=abcdefghijk")}
enum YouTubeWebView{static func videoID(_ url:URL?)->String?{url.flatMap{URLComponents(url:$0,resolvingAgainstBaseURL:false)?.queryItems?.first{$0.name=="v"}?.value}}}
class Stage{enum Mode{case closed,loading,expanded,mini};var mode=Mode.expanded,player:Web?=Web(),startupVideoID:String?="abcdefghijk",audioRouteProbe=AudioRouteProbe(environment:["LANGFORM_DIAGNOSTICS":"1","LANGFORM_AUDIO_ROUTE_PROBE":"1"]),loadTicket=7,playerPreparationSuspended=false,systemMediaSuspendedForOffline=false;var backgroundCategoryRequest:Int?
${declaration(native,'private func recordAudioRouteSnapshot(').replace('private func','func')}
${declaration(native,'private func recordAudioRoutePlayerRows(').replace('private func','func')}
}
${expect}
for reason in ["normal","master-off","closed","loading","no-player","route","startup"]{
 let s=Stage();let before=AVAudioSession.reads
 if reason=="normal"{s.audioRouteProbe=nil};if reason=="master-off"{StartupDiagnostics.audioRouteProbeEnabled=false};if reason=="closed"{s.mode = .closed};if reason=="loading"{s.mode = .loading};if reason=="no-player"{s.player=nil};if reason=="route"{s.player!.url=URL(string:"https://m.youtube.com/")};if reason=="startup"{s.startupVideoID="zzzzzzzzzzz"}
 s.recordAudioRouteSnapshot(kind:"route-change",callbackUptime:0);expect(AVAudioSession.reads==before,"no native reads: "+reason);StartupDiagnostics.audioRouteProbeEnabled=true
}
let s=Stage(),row:[String:Any]=["event":"timeupdate","target":"media","hasVideo":true,"playerMatches":true,"muted":false,"volume":1.0,"apiVolume":100.0,"mediaToken":1,"sourceToken":1,"url":"https://private","title":"secret"]
let before=AVAudioSession.reads;s.recordAudioRoutePlayerRows([row,row]);s.recordAudioRoutePlayerRows([row]);expect(AVAudioSession.reads==before+1,"one batch snapshot and <=1Hz")
let first=StartupDiagnostics.rows.last!,page=first["page"] as! [String:Any];expect(page["url"]==nil && page["title"]==nil && page["volume"] as? Double==1 && first["ticket"] as? Int==7,"correlation and page sanitizer")
s.recordAudioRoutePlayerRows([["event":"timeupdate","target":"media","hasVideo":true,"playerMatches":false]]);expect(AVAudioSession.reads==before+1,"wrong page media never reads native")
let previous=AVAudioSessionRouteDescription();previous.outputs=[PortDescription(portType:PortValue(rawValue:"BluetoothHFP"))]
s.recordAudioRouteSnapshot(kind:"route-change",callbackUptime:0,previousRoute:previous,routeReason:"categoryChange")
expect(StartupDiagnostics.rows.last?["previousOutputTypes"] as? [String]==["hfp"] && StartupDiagnostics.rows.last?["outputTypes"] as? [String]==["a2dp"],"old and current port types")
s.recordAudioRouteSnapshot(kind:"interruption",callbackUptime:0,interruptionType:"ended",shouldResume:false,interruptionReason:"unknown")
expect(StartupDiagnostics.rows.last?["shouldResume"] as? Bool==false && StartupDiagnostics.rows.last?["interruptionReason"] as? String=="unknown" && StartupDiagnostics.rows.last?["wasSuspended"]==nil,"known options and honest unknown reason")
for _ in 0..<100{s.recordAudioRouteSnapshot(kind:"route-change",callbackUptime:0)}
expect(s.audioRouteProbe!.samples==48 && AVAudioSession.reads==before+48,"cap stops native reads")
print("ROUTE_STAGE_OK")
`));

test('native route observations precede the unchanged functional guards and reuse the existing bridge',()=>{
 const route=declaration(native,'private func backgroundAudioRouteChanged('),interrupt=declaration(native,'private func backgroundAudioInterruption(');
 assert.ok(route.indexOf('observeAudioRouteChange(notification)')<route.indexOf('guard let raw'));
 assert.ok(interrupt.indexOf('observeAudioRouteInterruption(notification)')<interrupt.indexOf('guard let raw'));
 assert.match(route,/AVAudioSession\.RouteChangeReason\(rawValue: raw\) == \.oldDeviceUnavailable/);
 assert.match(route,/backgroundCategoryHandoff\?\.cancel\(\)/);assert.match(interrupt,/if type == \.began \{ backgroundCategoryHandoff\?\.cancel\(\) \}/);
 const record=declaration(native,'private func recordAudioRouteSnapshot(');
 assert.ok(record.indexOf('audioRouteProbe?.claim')<record.indexOf('AVAudioSession.sharedInstance()'));
 assert.doesNotMatch(record,/setActive|setCategory|\.play\(|\.pause\(|unMute|setAllMediaPlaybackSuspended|AudioContext|portName|\.uid/);
 assert.match(native,/if !isFeed && StartupDiagnostics\.playerObserverEnabled/);
 assert.match(diagnostics,/playerObserverEnabled = playerEventsEnabled \|\| audioRouteProbeEnabled/);
 assert.match(native,/StartupDiagnostics\.captionEvents\(rows\)\s+recordAudioRoutePlayerRows\(rows\)/);
 assert.doesNotMatch(native,/name: "langformAudioRoute/);
 assert.match(native,/window\.__langformGestureInputProbe =/);
 const observation=declaration(native,'private func observeAudioRouteInterruption(');
 assert.doesNotMatch(observation,/AVAudioSessionInterruptionWasSuspendedKey|AVAudioSessionInterruptionReasonKey|appWasSuspended/);
 assert.match(observation,/interruptionReason: "unknown"/);
});

test('shipping subscription preserves category-only comparison and never duplicates functional observers',{skip:process.platform!=='darwin',timeout:70000},t=>{
 const start=native.indexOf('        if backgroundCategoryHandoff?.preservesVisibility == true {');assert.ok(start>=0);
 let end=native.indexOf('{',start)+1,depth=1;while(depth&&end<native.length){if(native[end]==='{')depth++;if(native[end]==='}')depth--;end++;}
 const second=native.indexOf('{',end)+1;assert.ok(native.slice(end,second).includes('else if audioRouteProbe != nil'));end=second;depth=1;while(depth&&end<native.length){if(native[end]==='{')depth++;if(native[end]==='}')depth--;end++;}
 const subscription=native.slice(start,end).replace(/#selector\((\w+)\(_:\)\)/g,'"$1"');
 swift(t,`
class NotificationCenter{static let \`default\`=NotificationCenter();var selectors=[String]();func addObserver(_ object:Any,selector:String,name:String,object unused:Any?){selectors.append(selector)}}
enum AVAudioSession{static let interruptionNotification="interruption",routeChangeNotification="route"}
class Handoff{let preservesVisibility:Bool;init(_ value:Bool){preservesVisibility=value}}
class Subscription{var backgroundCategoryHandoff:Handoff?,audioRouteProbe:AudioRouteProbe?;func subscribe(){${subscription}}}
${expect}
for visibility in [true,false]{for probe in [true,false]{NotificationCenter.default.selectors=[];let s=Subscription();s.backgroundCategoryHandoff=Handoff(visibility);if probe{s.audioRouteProbe=AudioRouteProbe(environment:["LANGFORM_DIAGNOSTICS":"1","LANGFORM_AUDIO_ROUTE_PROBE":"1"])};s.subscribe();let expected=visibility ? ["backgroundAudioInterruption","backgroundAudioRouteChanged"] : probe ? ["audioRouteDiagnosticInterruption","audioRouteDiagnosticRouteChange"] : [];expect(NotificationCenter.default.selectors==expected,"exact original functional scope/diagnostic-only baseline")}}
print("SUBSCRIPTION_SCOPE_OK")
`);
 for(const name of ['audioRouteDiagnosticInterruption','audioRouteDiagnosticRouteChange'])assert.doesNotMatch(declaration(native,'private func '+name+'('),/cancel\(|watchBackgroundCategoryTransition|backgroundAudioInterrupted|setActive|setCategory/);
});
