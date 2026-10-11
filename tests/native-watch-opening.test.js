const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');

function method(source,name){
  const start=source.indexOf('private func '+name+'(');assert.ok(start>=0);
  let depth=0,begin=source.indexOf('{',start),end=begin;
  for(;end<source.length;end++){if(source[end]==='{')depth++;if(source[end]==='}'&&--depth===0){end++;break;}}
  return source.slice(start,end).replace('private func','func');
}

test('Shipping-Native-Bridge restauriert Input und übergibt nur ein gelandetes aktuelles Bild oder einen bestätigten Videoframe',{
  skip:process.platform!=='darwin',timeout:30000,
},t=>{
  const compiler=spawnSync('/usr/bin/xcrun',['--find','swift'],{encoding:'utf8'});
  if(compiler.status!==0)return t.skip('Swift toolchain unavailable');
  const directory=path.join(__dirname,'../ios/Langform/Langform');
  const motion=fs.readFileSync(path.join(directory,'MotionViews.swift'),'utf8');
  const stage=fs.readFileSync(path.join(directory,'YouTubeWebView.swift'),'utf8');
  const bridge=motion.slice(motion.indexOf('final class WatchFeedOpening {'));
  const exercise=`
import Foundation
class UIColor { static let clear=UIColor() }
class Scroll { var backgroundColor:UIColor?=UIColor(); var isScrollEnabled=true }
class WKWebView {
 var backgroundColor:UIColor?=UIColor(), underPageBackgroundColor:UIColor?=UIColor()
 var scrollView=Scroll(), isUserInteractionEnabled=true, commands:[String]=[]
 func evaluateJavaScript(_ code:String,completionHandler:((Any?,Error?)->Void)?=nil){commands.append(code);completionHandler?(true,nil)}
}
${bridge}
class View {}
enum StartupDiagnostics { static func mark(_ name:String){} }
class Stage {
 enum Mode { case loading,expanded,closed,mini }
 var mode=Mode.expanded, loadTicket=7, hasVideoRect=true
 let feed=WKWebView(),card=View(),collapseButton=View()
 var feedOpening:WatchFeedOpening?, moves=0
 var loadingTimeout:DispatchWorkItem?
 class Poster { var hasVisiblePicture=false }; let openingMotion=Poster()
 struct Status { var keepsStartupPoster=true }; var startupStatus=Status()
 func insertSubview(_ view:View,aboveSubview:WKWebView){moves += 1}
 func insertSubview(_ view:View,belowSubview:WKWebView){}
 func bringSubviewToFront(_ view:View){}
 ${method(stage,'finishFeedOpeningIfReady')}
 ${method(stage,'discardFeedOpening')}
 func begin(live:Bool=false)->WatchFeedOpening{
  let opening=WatchFeedOpening(values:["openingToken":"opening-1-1234","videoID":"abcdefghijk","livePreview":live],source:feed,videoID:"abcdefghijk",ticket:loadTicket,fromFeed:true)!
  feedOpening=opening;return opening
 }
}
func expect(_ ok:Bool,_ name:String){if !ok{print("FAILED "+name);exit(1)}}
let source=WKWebView(), old=source.backgroundColor, under=source.underPageBackgroundColor, scroll=source.scrollView.backgroundColor
source.scrollView.isScrollEnabled=false;source.isUserInteractionEnabled=false
for token in ["invalid","opening-1-2');evil(","opening-x-9"] {
 expect(WatchFeedOpening(values:["openingToken":token,"videoID":"abcdefghijk"],source:source,videoID:"abcdefghijk",ticket:1,fromFeed:true)==nil,"reject invalid native token")
}
expect(WatchFeedOpening(values:["openingToken":"opening-1-3","videoID":"lmnopqrstuv"],source:source,videoID:"abcdefghijk",ticket:1,fromFeed:true)==nil,"reject mismatched video")
let bridge=WatchFeedOpening(values:["openingToken":"opening-1-3","videoID":"abcdefghijk"],source:source,videoID:"abcdefghijk",ticket:1,fromFeed:true)!
bridge.command("discard");bridge.restore()
expect(source.backgroundColor===old && source.underPageBackgroundColor===under && source.scrollView.backgroundColor===scroll,"restore actual captured backgrounds")
expect(!source.scrollView.isScrollEnabled && !source.isUserInteractionEnabled,"restore captured disabled state rather than force-enable input")
expect(source.commands.count==1 && source.commands[0].contains("[\\"discard\\",\\"opening-1-3\\"]"),"native command uses JSON data")
let s=Stage(), a=s.begin();a.landed=true;s.mode = .loading;s.openingMotion.hasVisiblePicture=true
s.finishFeedOpeningIfReady();expect(s.moves==0,"never promote a loading Watch")
s.mode = .expanded;a.landed=false;s.finishFeedOpeningIfReady();expect(s.moves==0,"never skip source landing")
a.landed=true;a.reversing=true;s.finishFeedOpeningIfReady();expect(s.moves==0,"reversal owns its plane")
a.reversing=false;s.loadTicket=8;s.finishFeedOpeningIfReady();expect(s.moves==0,"old ticket cannot reveal")
s.loadTicket=7;s.openingMotion.hasVisiblePicture=false;s.finishFeedOpeningIfReady();expect(s.moves==0,"unpainted media with no poster remains covered")
s.openingMotion.hasVisiblePicture=true;s.finishFeedOpeningIfReady()
expect(s.moves==1 && s.feedOpening==nil && s.feed.isUserInteractionEnabled && s.feed.scrollView.isScrollEnabled,"stationary matching poster completes handoff and restores input")
let b=s.begin(live:true);b.landed=true;s.finishFeedOpeningIfReady();expect(s.moves==1,"live preview cannot hand off to a different still poster")
s.startupStatus.keepsStartupPoster=false;s.finishFeedOpeningIfReady();expect(s.moves==2 && s.feedOpening==nil,"confirmed first video frame owns live-preview handoff")
print("NATIVE_WATCH_OPENING_OK")
`;
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'langform-native-opening-'));
  try{
    const file=path.join(tmp,'Opening.swift');fs.writeFileSync(file,exercise);
    const result=spawnSync(compiler.stdout.trim(),[file],{encoding:'utf8',timeout:25000});
    assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+result.stderr);
    assert.match(result.stdout,/NATIVE_WATCH_OPENING_OK/);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
