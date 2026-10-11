#!/usr/bin/env python3
"""Trace the first fullscreen entry in real desktop WebKit, frame by frame.

Window resizing is native. Route and media readiness are substituted; this is
not physical iPhone video-pixel or UIKit rotation approval.
"""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--source', type=Path)
parser.add_argument('--expect-entry-jump', action='store_true')
parser.add_argument('--portrait-video', action='store_true')
parser.add_argument('--inline-fit', choices=['contain', 'cover', 'fill'], default='contain')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
source_path = args.source or repo / 'ios/Langform/Langform/FullscreenMotion.js'
source = source_path.read_text()
head = '''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>
:root{--safe-top:62px}html,body{margin:0;background:#182029;color:white;font:14px -apple-system}#header{height:calc(48px + var(--safe-top))}html[data-langform-fullscreen] #header{height:0}main{width:100%}#movie_player{position:relative;width:100%;height:auto;aspect-ratio:16/9;background:#164331}.html5-video-container,video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.card{height:80px;border-bottom:1px solid #ffffff20}
</style></head><body><div id="header">YouTube Kopfbereich mit Stage Safe Area</div><main><div id="movie_player"><div class="html5-video-container"><video class="html5-main-video"></video></div><button class="ytp-fullscreen-button">Vollbild</button></div><div id="anchor" class="card">Inhalt unter dem Video</div>''' + '<div class="card">Weiterer Inhalt</div>' * 25 + '</main><script>'
setup = f'''
const expectEntryJump={str(args.expect_entry_jump).lower()},sourceSHA256={json.dumps(hashlib.sha256(source_path.read_bytes()).hexdigest())};
const errors=[],messages=[],trace=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const testLocation={{pathname:'/watch',href:'https://m.youtube.com/watch?v=abcdefghijk'}};
const testWindow=new Proxy({{}},{{get(t,k){{if(Reflect.has(t,k))return Reflect.get(t,k);if(k==='location')return testLocation;const v=Reflect.get(window,k);return typeof v==='function'?v.bind(window):v;}}}});
testWindow.__langformFullscreenEnterProtocol=1;testWindow.__langformFullscreenExitProtocol=1;
testWindow.webkit={{messageHandlers:{{langformFullscreen:{{postMessage:value=>messages.push(value)}}}}}};
const root=document.getElementById('movie_player'),video=root.querySelector('video');
Object.defineProperties(video,{{paused:{{value:true}},ended:{{value:false}},duration:{{value:Infinity}},readyState:{{value:4}},currentTime:{{value:40,writable:true}},videoWidth:{{value:{1080 if args.portrait_video else 1920}}},videoHeight:{{value:{1920 if args.portrait_video else 1080}}}}});
video.style.objectFit={json.dumps(args.inline_fit)};
root.getVideoData=()=>({{video_id:'abcdefghijk',title:'First entry geometry'}});
video.play=()=>{{throw Error('Unexpected direct play')}};video.pause=()=>{{throw Error('Unexpected direct pause')}};
new Function('window',{json.dumps(source)})(testWindow);
'''
tests = r'''
const results=[];function report(value){window.webkit.messageHandlers.qa.postMessage(value)}
function result(name,passed,details){const value={name,passed,...details};results.push(value);report(value)}
function rect(node){const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}
function sample(phase){const v=rect(video),fit=getComputedStyle(video).objectFit,scale=fit==='cover'?Math.max(v.width/video.videoWidth,v.height/video.videoHeight):Math.min(v.width/video.videoWidth,v.height/video.videoHeight),picture=fit==='fill'?v:{x:v.x+(v.width-video.videoWidth*scale)/2,y:v.y+(v.height-video.videoHeight*scale)/2,width:video.videoWidth*scale,height:video.videoHeight*scale};const value={phase,viewport:{width:innerWidth,height:innerHeight},root:rect(root),picture,fullscreen:root.hasAttribute('data-langform-fullscreen-player'),held:video.hasAttribute('data-langform-fullscreen-enter-video'),scrollY};trace.push(value);return value}
async function frames(count,phase){for(let i=0;i<count;i++){await new Promise(requestAnimationFrame);sample(phase)}}
async function resize(width,height,phase){report({resize:{width,height}});for(let i=0;i<60;i++){await new Promise(requestAnimationFrame);sample(phase);if(Math.abs(innerWidth-width)<1&&Math.abs(innerHeight-height)<1)return;}throw Error('real WKWebView resize timed out')}
function delta(a,b){return Math.max(...['x','y','width','height'].map(key=>Math.abs(a[key]-b[key])))}
(async()=>{
 await resize(402,874,'initial-resize');await frames(2,'initial-inline');const before=sample('before-first-tap'),originalMedia=video,parent=video.parentElement,source=video.getAttribute('src');
 root.querySelector('.ytp-fullscreen-button').click();const immediate=sample('same-turn-after-tap');
 document.documentElement.style.setProperty('--safe-top','0px');await frames(4,'waiting-portrait');const waiting=trace.filter(value=>value.phase==='waiting-portrait');
 const initialDelta=delta(before.picture,immediate.picture),largestPortraitDelta=Math.max(...waiting.map(value=>delta(before.picture,value.picture)));
 result(expectEntryJump?'build34-first-entry-portrait-jump-reproduced':'first-entry-pins-inline-content-before-native-statusbar-or-rotation',expectEntryJump?initialDelta>200:initialDelta<1&&largestPortraitDelta<1&&waiting.every(value=>value.held),{before,immediate,waiting,initialDelta,largestPortraitDelta});
 const request=messages.find(value=>value.open===true);
 if(testWindow.__langformFullscreen.prepareEnter)testWindow.__langformFullscreen.prepareEnter('abcdefghijk',request.token,874,402);
 await resize(874,402,'rotating-landscape');await frames(16,'during-native-rotation');const prepared=sample('prepared-landscape');
 if(testWindow.__langformFullscreen.prepareEnter){
  const targetScale=Math.min(874/video.videoWidth,402/video.videoHeight),target={x:(874-video.videoWidth*targetScale)/2,y:(402-video.videoHeight*targetScale)/2,width:video.videoWidth*targetScale,height:video.videoHeight*targetScale};
  result('same-live-node-reaches-contained-landscape-before-native-release',testWindow.__langformFullscreen.isOpen()&&prepared.held&&!messages.some(value=>value.kind==='enter-commit')&&delta(prepared.picture,target)<1,{prepared,target});
  testWindow.__langformFullscreen.finishEnter('abcdefghijk',request.token,874,402);await frames(6,'native-completed');const committed=sample('entry-committed');
  result('native-entry-completion-releases-without-second-pose-or-aspect-change',!committed.held&&delta(prepared.picture,committed.picture)<1&&messages.filter(value=>value.kind==='enter-commit').length===1,{prepared,committed});
  const movement=trace.filter(value=>['rotating-landscape','during-native-rotation'].includes(value.phase)),steps=[];
  for(let i=1;i<movement.length;i++)if(movement[i].viewport.width===movement[i-1].viewport.width&&movement[i].viewport.height===movement[i-1].viewport.height)steps.push(delta(movement[i-1].picture,movement[i].picture));
  const totalDistance=delta(before.picture,committed.picture),largestStep=Math.max(0,...steps),largestStepFraction=largestStep/Math.max(1,totalDistance);
  result('entry-picture-follows-continuous-compositor-trajectory',largestStepFraction<.35&&steps.filter(value=>value>1).length>=4,{largestStep,largestStepFraction,steps,movement});
 }
 result('entry-keeps-same-media-parent-time-and-paused-live-state',root.querySelector('video')===originalMedia&&video.parentElement===parent&&video.getAttribute('src')===source&&video.currentTime===40&&video.paused,{time:video.currentTime,paused:video.paused,messages});
 report({trace,sourceSHA256});report({finished:true,passed:errors.length===0&&results.every(value=>value.passed),count:results.length,errors,sourceSHA256,engine:'macOS WKWebView with actual window resize and substituted live/paused media'});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack,sourceSHA256}));
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(head + setup + tests + '</script></body></html>')
print(args.output)
