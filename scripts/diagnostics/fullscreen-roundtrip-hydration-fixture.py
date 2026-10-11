#!/usr/bin/env python3
"""Actual WebKit repeated roundtrips with stale fullscreen author geometry.

Native window resizing, CSS containing blocks and media-node animations are real.
Route/readiness are substituted; this is not physical iPhone motion approval.
"""
import argparse
import hashlib
import json
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',required=True,type=Path)
parser.add_argument('--source',type=Path)
parser.add_argument('--expect-bounce',action='store_true')
args=parser.parse_args()
repo=Path(__file__).resolve().parents[2]
source_path=args.source or repo/'ios/Langform/Langform/FullscreenMotion.js'
source=source_path.read_text()
head='''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>
html,body{margin:0;background:#152529;color:white;font:14px -apple-system}header{height:110px}html[data-langform-fullscreen] header{height:0}#movie_player{position:relative;width:100%;aspect-ratio:16/9;background:#114a33}.html5-video-container{position:absolute;inset:0;width:100%;height:100%}video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.item{height:80px;border-bottom:1px solid #fff3}
</style></head><body><header>Stage header</header><main><div id="movie_player"><div class="html5-video-container"><video class="html5-main-video"></video></div><button class="ytp-fullscreen-button">Fullscreen</button></div>'''+ '<div class="item">Watch context</div>'*18 +'</main><script>'
setup=f'''
const expectBounce={str(args.expect_bounce).lower()},sourceSHA256={json.dumps(hashlib.sha256(source_path.read_bytes()).hexdigest())};
const errors=[],messages=[],trace=[],starts=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const testLocation={{pathname:'/watch',href:'https://m.youtube.com/watch?v=abcdefghijk'}};
const testWindow=new Proxy({{}},{{get(t,k){{if(Reflect.has(t,k))return Reflect.get(t,k);if(k==='location')return testLocation;const v=Reflect.get(window,k);return typeof v==='function'?v.bind(window):v;}}}});
testWindow.__langformFullscreenEnterProtocol=1;testWindow.__langformFullscreenExitProtocol=1;
testWindow.webkit={{messageHandlers:{{langformFullscreen:{{postMessage:value=>messages.push(value)}}}}}};
const root=document.getElementById('movie_player'),video=root.querySelector('video');
Object.defineProperties(video,{{paused:{{value:false}},ended:{{value:false}},duration:{{value:Infinity}},readyState:{{value:4}},currentTime:{{get:()=>40+performance.now()/1000,set:()=>{{throw Error('Unexpected seek')}}}},videoWidth:{{value:1280}},videoHeight:{{value:720}}}});
root.getVideoData=()=>({{video_id:'abcdefghijk',title:'Repeated fullscreen hydration'}});
video.play=()=>{{throw Error('Unexpected play')}};video.pause=()=>{{throw Error('Unexpected pause')}};
const realAnimate=video.animate.bind(video);let cycle=0;
video.animate=function(keyframes,timing){{starts.push({{cycle,root:rect(root),outer:rect(video),viewport:{{width:innerWidth,height:innerHeight}},keyframes,timing}});return realAnimate(keyframes,timing);}};
new Function('window',{json.dumps(source)})(testWindow);
'''
tests=r'''
const results=[];function report(value){window.webkit.messageHandlers.qa.postMessage(value)}
function result(name,passed,details){const row={name,passed,...details};results.push(row);report(row)}
function rect(node){const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}
function picture(){const outer=rect(video),fit=getComputedStyle(video).objectFit,scale=fit==='cover'?Math.max(outer.width/1280,outer.height/720):Math.min(outer.width/1280,outer.height/720);return fit==='fill'?outer:{x:outer.x+(outer.width-1280*scale)/2,y:outer.y+(outer.height-720*scale)/2,width:1280*scale,height:720*scale}}
function sample(phase){const row={cycle,phase,milliseconds:performance.now(),viewport:{width:innerWidth,height:innerHeight},root:rect(root),outer:rect(video),picture:picture(),held:video.hasAttribute('data-langform-fullscreen-enter-video'),open:testWindow.__langformFullscreen.isOpen()};trace.push(row);return row}
function delta(a,b){return Math.max(...['x','y','width','height'].map(k=>Math.abs(a[k]-b[k])))}
const expected={x:(874-402*16/9)/2,y:0,width:402*16/9,height:402};
async function frames(n,phase){for(let i=0;i<n;i++){await new Promise(requestAnimationFrame);sample(phase)}}
async function resize(width,height,phase){report({resize:{width,height}});for(let i=0;i<60;i++){await new Promise(requestAnimationFrame);sample(phase);if(Math.abs(innerWidth-width)<1&&Math.abs(innerHeight-height)<1)return;}throw Error('native resize timeout')}
(async()=>{
 await resize(402,874,'initial');await frames(2,'initial');const node=video,parent=video.parentElement,mediaSource=video.getAttribute('src'),startTime=video.currentTime;
 for(cycle=1;cycle<=6;cycle++){
  const before=sample('before-entry');root.querySelector('button').click();const request=messages.filter(x=>x.kind==='enter-request').at(-1);const faulty=[2,3,6].includes(cycle);
  if(faulty){root.style.setProperty('height','874px','important');root.style.setProperty('width','874px','important');}
  if(cycle===3){root.style.setProperty('left','-472px','important');root.style.willChange='transform';}
  testWindow.__langformFullscreen.prepareEnter('abcdefghijk',request.token,874,402);await resize(874,402,'entry-resize');testWindow.__langformFullscreen.finishEnter('abcdefghijk',request.token,874,402);
  await frames(6,'stale-fullscreen-author');const stale=sample('before-fullscreen-hydration');const early=starts.filter(x=>x.cycle===cycle);
  result(`cycle-${cycle}-entry-never-animates-to-stale-fullscreen-root`,faulty?(expectBounce?early.length>=1:early.length===0&&stale.held&&!messages.some(x=>x.kind==='enter-commit'&&x.token===request.token)):early.length===1,{stale,early});
  if(cycle===3){const shifted=trace.filter(x=>x.cycle===cycle&&x.phase==='stale-fullscreen-author'&&x.outer.x < -400);result(expectBounce?'same-live-pin-shifts-under-author-containing-block':'same-live-pin-remains-viewport-owned-under-author-containing-block',expectBounce?shifted.length>0:shifted.length===0,{shiftedFrames:shifted.length});}
  for(const property of ['height','width','left','will-change'])root.style.removeProperty(property);await frames(34,'hydrated-fullscreen-author');const committed=sample('entry-committed');const animated=starts.filter(x=>x.cycle===cycle);
  result(`cycle-${cycle}-entry-reaches-one-true-contained-target`,!committed.held&&delta(committed.picture,expected)<1&&messages.filter(x=>x.kind==='enter-commit'&&x.token===request.token).length===1&&(expectBounce&&faulty?animated.length>=2:animated.length===1),{committed,animationCount:animated.length,expected});
  testWindow.__langformFullscreen.exit('abcdefghijk');const exit=messages.filter(x=>x.kind==='exit-request').at(-1);
  // Match the native cached-destination protocol: motion completes in the old
  // viewport before its identity-bound acknowledgement permits rotation.
  const accepted=testWindow.__langformFullscreen.prepareExitMotion('abcdefghijk',exit.token,402,874,Date.now()+250,cycle);
  if(!accepted)throw Error('cached exit rejected in cycle '+cycle);
  testWindow.__langformFullscreen.prepareExit('abcdefghijk',exit.token,402,874);
  for(let i=0;i<90&&!messages.some(x=>x.kind==='exit-motion-ready'&&x.token===exit.token);i++)await frames(1,'exit-staged');
  if(!messages.some(x=>x.kind==='exit-motion-ready'&&x.token===exit.token))throw Error('cached exit not ready in cycle '+cycle);
  await resize(402,874,'exit-resize');testWindow.__langformFullscreen.finishExit('abcdefghijk',exit.token,402,874);
  // Do not start another transaction while WebKit is handing the node back.
  for(let i=0;i<90&&!messages.some(x=>x.kind==='exit-commit'&&x.token===exit.token);i++)await frames(1,'exit-completed');const after=sample('after-exit');
  result(`cycle-${cycle}-exit-keeps-correct-inline-content-without-second-motion`,!after.open&&delta(before.picture,after.picture)<1&&messages.filter(x=>x.kind==='exit-commit'&&x.token===exit.token).length===1,{before,after});
 }
 result('six-roundtrips-preserve-same-running-media-node-parent-source-and-clock',root.querySelector('video')===node&&video.parentElement===parent&&video.getAttribute('src')===mediaSource&&!video.paused&&video.currentTime>startTime,{currentTime:video.currentTime,startTime,paused:video.paused});
 report({trace,starts,messages,sourceSHA256});report({finished:true,passed:errors.length===0&&results.every(x=>x.passed),count:results.length,errors,sourceSHA256,engine:'macOS WKWebView native repeated resize + actual author CSS hydration/containing-block, substituted running media/route'});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack,sourceSHA256,messages,trace}));
'''
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(head+setup+tests+'</script></body></html>')
print(args.output)
