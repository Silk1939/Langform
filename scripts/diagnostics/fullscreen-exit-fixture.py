#!/usr/bin/env python3
"""Generate a real WebKit resize/scroll trace of fullscreen exit ordering.

The legacy source option reproduces the previous release's intermediate inline
landscape frame. Native window resizing is real; media state is substituted.
"""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--legacy-source', type=Path)
parser.add_argument('--source', type=Path)
parser.add_argument('--expect-content-jump', action='store_true')
parser.add_argument('--portrait-video', action='store_true')
parser.add_argument('--transformed-ancestors', action='store_true')
parser.add_argument('--inline-fit', choices=['contain','cover','fill'], default='contain')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
source_path = args.legacy_source or args.source or repo / 'ios/Langform/Langform/FullscreenMotion.js'
source = source_path.read_text()
legacy = args.legacy_source is not None
head = '''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>
html,body{margin:0;background:#182029;color:white;font:14px -apple-system}main{width:100%}.spacer{height:250px}#movie_player{position:relative;width:100%;height:auto;aspect-ratio:16/9;background:#164331}.html5-video-container,video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.card{height:80px;border-bottom:1px solid #ffffff20}
</style></head><body><main><div class="spacer">Inhalt vor dem Player</div><div id="movie_player"><div class="html5-video-container"><video class="html5-main-video"></video></div><button class="ytp-fullscreen-button">Vollbild</button></div><div id="anchor" class="card">Erster Inhalt unter dem Video</div>''' + '<div class="card">Weiterer Inhalt</div>' * 40 + '</main><script>'
setup = f'''
const legacy={str(legacy).lower()},expectContentJump={str(args.expect_content_jump).lower()},sourceSHA256={json.dumps(hashlib.sha256(source_path.read_bytes()).hexdigest())};
const errors=[],messages=[],calls=[],trace=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const testLocation={{pathname:'/watch',href:'https://m.youtube.com/watch?v=abcdefghijk'}};
const testWindow=new Proxy({{}},{{get(t,k){{if(Reflect.has(t,k))return Reflect.get(t,k);if(k==='location')return testLocation;const v=Reflect.get(window,k);return typeof v==='function'?v.bind(window):v;}}}});
testWindow.__langformFullscreenExitProtocol=1;
testWindow.webkit={{messageHandlers:{{langformFullscreen:{{postMessage:value=>messages.push(value)}}}}}};
const root=document.getElementById('movie_player'),video=root.querySelector('video'),anchor=document.getElementById('anchor');
Object.defineProperties(video,{{paused:{{value:false}},ended:{{value:false}},duration:{{value:120}},readyState:{{value:4}},currentTime:{{value:40,writable:true}},videoWidth:{{value:{1080 if args.portrait_video else 1920}}},videoHeight:{{value:{1920 if args.portrait_video else 1080}}}}});
video.style.objectFit={json.dumps(args.inline_fit)};
if({str(args.transformed_ancestors).lower()}){{root.parentElement.style.transform='translateX(3px)';root.style.transform='translateY(4px)';video.parentElement.style.transform='translateY(2px)';video.style.setProperty('transform','translateX(7px)','important');}}
root.getVideoData=()=>({{video_id:'abcdefghijk',title:'Exit geometry'}});
video.play=()=>{{throw Error('Unexpected direct play')}};video.pause=()=>{{throw Error('Unexpected direct pause')}};
new Function('window',{json.dumps(source)})(testWindow);
'''
tests = r'''
const results=[];function report(value){window.webkit.messageHandlers.qa.postMessage(value)}
function result(name,passed,details){const value={name,passed,...details};results.push(value);report(value)}
function rect(node){const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}
function sample(phase){const r=rect(root),v=rect(video),fit=getComputedStyle(video).objectFit,scale=fit==='cover'?Math.max(v.width/video.videoWidth,v.height/video.videoHeight):Math.min(v.width/video.videoWidth,v.height/video.videoHeight),picture=fit==='fill'?v:{x:v.x+(v.width-video.videoWidth*scale)/2,y:v.y+(v.height-video.videoHeight*scale)/2,width:video.videoWidth*scale,height:video.videoHeight*scale};const value={phase,viewport:{width:innerWidth,height:innerHeight},root:r,picture:picture,fullscreen:root.hasAttribute('data-langform-fullscreen-player'),handoff:video.hasAttribute('data-langform-fullscreen-exit-video'),scrollY,anchorTop:anchor.offsetTop};trace.push(value);return value}
async function frames(count,phase){for(let i=0;i<count;i++){await new Promise(requestAnimationFrame);sample(phase)}}
async function resize(width,height,phase){report({resize:{width,height}});for(let i=0;i<60;i++){await new Promise(requestAnimationFrame);sample(phase);if(Math.abs(innerWidth-width)<1&&Math.abs(innerHeight-height)<1)return;}throw Error('real WKWebView resize timed out')}
(async()=>{
 await resize(402,874,'initial-resize');scrollTo(0,200);await frames(2,'initial-inline');const before=sample('before-open'),originalMedia=video,parent=video.parentElement;
 root.querySelector('.ytp-fullscreen-button').click();await frames(2,'entered-portrait');await resize(874,402,'landscape-resize');await frames(3,'fullscreen-landscape');
 testWindow.__langformFullscreen.exit('abcdefghijk');const request=messages.find(value=>value.kind==='exit-request');
 if(!legacy){
  result('exit-request-keeps-fullscreen-owned',!!request&&root.hasAttribute('data-langform-fullscreen-player')&&testWindow.__langformFullscreen.isOpen(),{request,root:rect(root)});
  if(testWindow.__langformFullscreen.prepareExit)testWindow.__langformFullscreen.prepareExit('abcdefghijk',request.token,402,874);
  else testWindow.__langformFullscreen.finishExit('abcdefghijk',request.token,402,874);
 }
 await frames(6,'waiting-in-old-landscape');
 const oldInlineFrames=trace.filter(value=>value.phase==='waiting-in-old-landscape'&&!value.fullscreen);
 result(legacy?'legacy-inline-landscape-jump-reproduced':'no-inline-landscape-frame-before-native-viewport',legacy?oldInlineFrames.length===6&&oldInlineFrames.every(value=>value.root.width>before.root.width*2&&value.root.height>before.root.height*2):oldInlineFrames.length===0,{before,intermediate:trace.filter(value=>value.phase==='waiting-in-old-landscape')});
 await resize(402,874,'returning-portrait');
 if(!legacy&&testWindow.__langformFullscreen.prepareExit){
  await frames(16,'during-rotation');const prepared=sample('prepared-before-native-completion');
  result('live-picture-reaches-inline-within-rotation-but-remains-owned',testWindow.__langformFullscreen.isOpen()&&video.hasAttribute('data-langform-fullscreen-exit-video')&&!messages.some(value=>value.kind==='exit-commit')&&Math.abs(prepared.picture.y-before.picture.y)<1,{prepared});
  testWindow.__langformFullscreen.finishExit('abcdefghijk',request.token,402,874);
  await frames(6,'after-portrait');const committed=sample('committed-inline');
  result('native-completion-releases-same-picture-without-second-motion',!testWindow.__langformFullscreen.isOpen()&&Math.abs(committed.picture.y-prepared.picture.y)<1&&Math.abs(committed.picture.width-prepared.picture.width)<1,{prepared,committed});
 }else await frames(30,'after-portrait');
 const after=sample('final-inline'),inlineExitFrames=trace.filter(value=>['waiting-in-old-landscape','returning-portrait','during-rotation','after-portrait'].includes(value.phase)&&!value.fullscreen);
 if(!legacy){
  result('inline-handoff-only-in-confirmed-portrait',inlineExitFrames.length>0&&inlineExitFrames.every(value=>Math.abs(value.viewport.width-402)<1&&Math.abs(value.viewport.height-874)<1&&Math.abs(value.root.width-before.root.width)<1&&Math.abs(value.root.height-before.root.height)<1),{inlineExitFrames});
  result('saved-scroll-and-document-flow-return-without-anchor-jump',Math.abs(after.scrollY-before.scrollY)<1&&Math.abs(after.anchorTop-before.anchorTop)<1&&trace.filter(value=>value.fullscreen).every(value=>Math.abs(value.anchorTop-before.anchorTop)<1),{before,after,fullscreenAnchorPositions:trace.filter(value=>value.fullscreen).map(value=>value.anchorTop)});
  result('exit-commit-follows-viewport-agreement-and-media-continuity',messages.filter(value=>value.kind==='exit-commit').length===1&&root.querySelector('video')===originalMedia&&video.parentElement===parent&&video.currentTime===40&&!video.paused&&calls.length===0&&!document.querySelector('[data-langform-fullscreen-placeholder]'),{messages,time:video.currentTime,paused:video.paused});
  const exitFrames=trace.filter(value=>['returning-portrait','during-rotation','after-portrait'].includes(value.phase)),steps=[];
  for(let i=1;i<exitFrames.length;i++){const a=exitFrames[i-1],b=exitFrames[i];if(a.viewport.width===b.viewport.width&&a.viewport.height===b.viewport.height)steps.push(Math.max(Math.abs(a.picture.x-b.picture.x),Math.abs(a.picture.y-b.picture.y),Math.abs(a.picture.width-b.picture.width),Math.abs(a.picture.height-b.picture.height)));}
  const largestStep=Math.max(0,...steps),first=exitFrames[0].picture,last=exitFrames.at(-1).picture,totalDistance=Math.max(Math.abs(first.x-last.x),Math.abs(first.y-last.y),Math.abs(first.width-last.width),Math.abs(first.height-last.height)),largestStepFraction=largestStep/Math.max(1,totalDistance);
  const cachedFirstPose=Math.max(...['x','y','width','height'].map(key=>Math.abs(first[key]-before.picture[key])))<1;
  result(expectContentJump?'build33-content-center-to-inline-jump-reproduced':'portrait-picture-ready-within-rotation-without-late-second-motion',expectContentJump?largestStep>200:(cachedFirstPose&&largestStep<1||largestStepFraction<.35&&steps.filter(value=>value>1).length>=4)&&exitFrames.some(value=>value.handoff),{largestStep,largestStepFraction,totalDistance,cachedFirstPose,steps,exitFrames});
 }
 report({trace,legacy,sourceSHA256});
 report({finished:true,passed:errors.length===0&&results.every(value=>value.passed),count:results.length,errors,legacy,sourceSHA256,engine:'macOS WKWebView with actual native window resize and substituted media'});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack,legacy,sourceSHA256}));
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(head + setup + tests + '</script></body></html>')
print(args.output)
