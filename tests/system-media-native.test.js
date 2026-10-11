const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('Produktive native Medienpolicy verwirft fremde Identität und ungültige Timeline', { skip: process.platform !== 'darwin', timeout: 60000 }, t => {
  const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/SystemMedia.swift'), 'utf8');
  const struct = source.slice(source.indexOf('struct SystemMediaSnapshot'), source.indexOf('/// WebKit'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-system-media-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'test.swift');
  fs.writeFileSync(file, `import Foundation\n${struct}\n
func expect(_ value: Bool, _ message: String) { if !value { print(message); exit(1) } }
let id = "abcdefghijk"
var values: [String: Any] = ["kind":"state", "videoID":id, "title":" A ", "channel":"Kanal", "elapsed":140, "duration":120, "playing":true, "rate":1]
let snapshot = SystemMediaSnapshot(values, expectedID:id)
expect(snapshot?.elapsed == 120 && snapshot?.title == "A", "finite timeline clamps to duration")
expect(SystemMediaSnapshot(values, expectedID:"zzzzzzzzzzz") == nil, "stale identity rejected")
values["elapsed"] = Double.infinity
expect(SystemMediaSnapshot(values, expectedID:id) == nil, "infinite elapsed rejected")
values["elapsed"] = 10; values["duration"] = NSNull()
expect(SystemMediaSnapshot(values, expectedID:id)?.duration == nil, "live supports absent duration")
values["duration"] = -1
expect(SystemMediaSnapshot(values, expectedID:id) == nil, "negative duration rejected")
expect(SystemMediaSnapshot.commandJavaScript(videoID:id, command:"skip", value:Double.nan) == nil, "invalid seek rejected")
expect(SystemMediaSnapshot.commandJavaScript(videoID:"x';alert(1)", command:"play") == nil, "invalid id rejected")
expect(SystemMediaSnapshot.commandJavaScript(videoID:id, command:"position", value:30)?.contains("abcdefghijk") == true, "explicit valid command encoded")
print("8 system policy checks passed")
`);
  const result = spawnSync('/usr/bin/xcrun', ['swift', file], { encoding: 'utf8', timeout: 55000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /8 system policy checks passed/);
});

test('Produktiver Remotecontroller verwirft alte Befehle und Artwork nach A → B oder Clear', { skip: process.platform !== 'darwin', timeout: 60000 }, t => {
  let source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/SystemMedia.swift'), 'utf8');
  source = source.replace('import MediaPlayer', '').replace('import UIKit', '').replace('@MainActor', '');
  const constants = Array.from(new Set(source.match(/\bMP(?:MediaItemProperty|NowPlayingInfoProperty)[A-Za-z]+\b/g)));
  const stubs = `
${constants.map(name => `let ${name} = "${name}"`).join('\n')}
enum MPNowPlayingInfoMediaType:Int {case video=2}
class UIImage { let size=CGSize(width:20,height:10) }
class MPMediaItemArtwork {init(boundsSize:CGSize,requestHandler:@escaping(CGSize)->UIImage){}}
class MPNowPlayingInfoCenter {
  static let shared=MPNowPlayingInfoCenter();static func \`default\`()->MPNowPlayingInfoCenter{shared}
  var nowPlayingInfo:[String:Any]?
}
class MPRemoteCommandEvent {}
class MPChangePlaybackPositionCommandEvent:MPRemoteCommandEvent{let positionTime:Double;init(_ value:Double){positionTime=value}}
enum MPRemoteCommandHandlerStatus {case success,commandFailed}
class MPRemoteCommand {
  var isEnabled=false, preferredIntervals:[NSNumber]=[]
  var callbacks:[(MPRemoteCommandEvent)->MPRemoteCommandHandlerStatus]=[]
  var removals=0
  func addTarget(handler:@escaping(MPRemoteCommandEvent)->MPRemoteCommandHandlerStatus)->Any{callbacks.append(handler);return callbacks.count}
  func removeTarget(_ target:Any){removals += 1}
}
class MPRemoteCommandCenter {
  static let center=MPRemoteCommandCenter();static func shared()->MPRemoteCommandCenter{center}
  let playCommand=MPRemoteCommand(),pauseCommand=MPRemoteCommand(),togglePlayPauseCommand=MPRemoteCommand(),skipBackwardCommand=MPRemoteCommand(),skipForwardCommand=MPRemoteCommand(),changePlaybackPositionCommand=MPRemoteCommand()
}
class UIApplication {static let shared=UIApplication();var balance=0;func beginReceivingRemoteControlEvents(){balance += 1};func endReceivingRemoteControlEvents(){balance -= 1}}
class DispatchQueue {
  static let main=DispatchQueue();var pending:[()->Void]=[]
  func async(execute:@escaping()->Void){pending.append(execute)}
  func flush(){let next=pending;pending=[];next.forEach{$0()}}
}
struct WatchThumbnailAsset {init?(_ values:[String:Any],videoID:String){}}
class WatchThumbnailRequest {
  static var requests:[WatchThumbnailRequest]=[]
  let completion:(UIImage?)->Void;var cancelled=false
  init(asset:WatchThumbnailAsset,completion:@escaping(UIImage?)->Void){self.completion=completion;Self.requests.append(self)}
  func start(){};func cancel(){cancelled=true}
}
`;
  const exercise = `
func expect(_ value:Bool,_ message:String){if !value{print("FAILED: "+message);exit(1)}}
func state(_ id:String,playing:Bool=true,duration:Any=120)->[String:Any]{["kind":"state","videoID":id,"title":id,"channel":"Channel","elapsed":30,"duration":duration,"playing":playing,"rate":1]}
let a="abcdefghijk",b="zzzzzzzzzzz",controller=SystemMediaController(),center=MPRemoteCommandCenter.shared()
var delivered:[String]=[]
controller.onCommand={id,command,value in delivered.append(id+":"+command)}
controller.receive(state(a),expectedID:a)
expect(UIApplication.shared.balance==1,"one remote ownership")
let oldPlay=center.playCommand.callbacks.last!,oldArt=WatchThumbnailRequest.requests.last!
_ = oldPlay(MPRemoteCommandEvent())
controller.receive(state(b),expectedID:b)
DispatchQueue.main.flush()
expect(delivered.isEmpty,"queued A event cannot command B")
_ = oldPlay(MPRemoteCommandEvent());DispatchQueue.main.flush()
expect(delivered.isEmpty,"removed A handler cannot command B")
oldArt.completion(UIImage())
expect(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPMediaItemPropertyArtwork]==nil,"late A artwork cannot decorate B")
expect(oldArt.cancelled && UIApplication.shared.balance==1,"A request cancelled and command ownership paired")
_ = center.playCommand.callbacks.last!(MPRemoteCommandEvent());DispatchQueue.main.flush()
expect(delivered==[b+":play"],"current B remote event delivered")
controller.receive(state(b,playing:false),expectedID:b)
expect((MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? NSNumber)?.doubleValue==0,"pause freezes system timeline")
controller.receive(state(b,duration:NSNull()),expectedID:b)
expect(!center.skipForwardCommand.isEnabled && !center.changePlaybackPositionCommand.isEnabled,"live disables jumps")
_ = center.pauseCommand.callbacks.last!(MPRemoteCommandEvent());controller.clear();DispatchQueue.main.flush()
expect(delivered==[b+":play"] && UIApplication.shared.balance==0,"clear revokes queued callback and remote ownership")
expect(MPNowPlayingInfoCenter.default().nowPlayingInfo==nil,"own metadata cleared")
controller.receive(state(a),expectedID:a)
MPNowPlayingInfoCenter.default().nowPlayingInfo=[MPNowPlayingInfoPropertyExternalContentIdentifier:"external"]
controller.clear()
expect(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPNowPlayingInfoPropertyExternalContentIdentifier] as? String=="external","foreign now playing metadata preserved")
print("SYSTEM_REMOTE_GENERATION_AND_ARTWORK_OK")
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'langform-system-remote-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const file = path.join(dir, 'test.swift');
  fs.writeFileSync(file, `import Foundation\n${stubs}\n${source}\n${exercise}`);
  const result = spawnSync('/usr/bin/xcrun', ['swift',file], { encoding:'utf8',timeout:55000 });
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/SYSTEM_REMOTE_GENERATION_AND_ARTWORK_OK/);
});
