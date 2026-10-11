#!/usr/bin/env python3
"""Reproduce cached YouTube video dimensions after a real WebKit portrait resize.

Root layout and window resizing are real. A delayed root ResizeObserver models
YouTube's stale media styles; media/route are substituted, not iPhone approval.
"""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--source', type=Path)
parser.add_argument('--expect-delayed-jump', action='store_true')
parser.add_argument('--expect-late-handoff', action='store_true')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
source_path = args.source or repo / 'ios/Langform/Langform/FullscreenMotion.js'
source = source_path.read_text()
head = '''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>
html,body{margin:0;background:#152529;color:white;font:14px -apple-system}header{height:110px}html[data-langform-fullscreen] header{height:0}#movie_player{position:relative;width:100%;aspect-ratio:16/9;background:#114a33}.html5-video-container{position:absolute;inset:0;width:100%;height:100%}video{position:absolute;inset:auto;width:100%;height:100%;object-fit:cover;left:0;top:0}.item{height:80px;border-bottom:1px solid #fff3}
</style></head><body><header>Stage-owned safe area + YouTube header</header><main><div id="movie_player"><div class="html5-video-container"><video class="html5-main-video"></video></div><button class="ytp-fullscreen-button">Fullscreen</button></div>''' + '<div class="item">Feed item</div>' * 18 + '</main><script>'
setup = f'''
const expectDelayedJump={str(args.expect_delayed_jump).lower()},expectLateHandoff={str(args.expect_late_handoff).lower()},sourceSHA256={json.dumps(hashlib.sha256(source_path.read_bytes()).hexdigest())};
const errors=[],messages=[],trace=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const testLocation={{pathname:'/watch',href:'https://m.youtube.com/watch?v=abcdefghijk'}};
const testWindow=new Proxy({{}},{{get(t,k){{if(Reflect.has(t,k))return Reflect.get(t,k);if(k==='location')return testLocation;const v=Reflect.get(window,k);return typeof v==='function'?v.bind(window):v;}}}});
testWindow.__langformFullscreenExitProtocol=1;
testWindow.webkit={{messageHandlers:{{langformFullscreen:{{postMessage:value=>messages.push(value)}}}}}};
const root=document.getElementById('movie_player'),video=root.querySelector('video');
Object.defineProperties(video,{{paused:{{value:false}},ended:{{value:false}},duration:{{value:Infinity}},readyState:{{value:4}},currentTime:{{value:40,writable:true}},videoWidth:{{value:1280}},videoHeight:{{value:720}}}});
root.getVideoData=()=>({{video_id:'abcdefghijk',title:'Delayed media layout'}});
video.play=()=>{{throw Error('Unexpected play')}};video.pause=()=>{{throw Error('Unexpected pause')}};
new Function('window',{json.dumps(source)})(testWindow);
'''
tests = r'''
const results=[];function report(value){window.webkit.messageHandlers.qa.postMessage(value)}
function result(name,passed,details){const value={name,passed,...details};results.push(value);report(value)}
function rect(node){const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}
function sample(phase){const outer=rect(video),fit=getComputedStyle(video).objectFit,scale=fit==='cover'?Math.max(outer.width/1280,outer.height/720):Math.min(outer.width/1280,outer.height/720),picture=fit==='fill'?outer:{x:outer.x+(outer.width-1280*scale)/2,y:outer.y+(outer.height-720*scale)/2,width:1280*scale,height:720*scale};const context=document.querySelector('header'),row={phase,milliseconds:performance.now(),viewport:{width:innerWidth,height:innerHeight},root:rect(root),outer,picture,held:video.hasAttribute('data-langform-fullscreen-exit-video'),open:testWindow.__langformFullscreen.isOpen(),contextHidden:getComputedStyle(context).visibility==='hidden'||getComputedStyle(context).opacity==='0',videoAnimations:video.getAnimations().length};trace.push(row);return row}
function distance(a,b){return Math.max(...['x','y','width','height'].map(k=>Math.abs(a[k]-b[k])))}
async function frames(count,phase){for(let i=0;i<count;i++){await new Promise(requestAnimationFrame);sample(phase)}}
async function resize(width,height,phase){report({resize:{width,height}});for(let i=0;i<60;i++){await new Promise(requestAnimationFrame);sample(phase);if(Math.abs(innerWidth-width)<1&&Math.abs(innerHeight-height)<1)return;}throw Error('native resize timed out')}
(async()=>{
 await resize(402,874,'initial-inline');await frames(2,'initial-inline');const initial=sample('before-open'),node=video,parent=video.parentElement,source=video.getAttribute('src');
 root.querySelector('button').click();await resize(874,402,'entry-landscape');await frames(3,'entry-landscape');const fullscreen=sample('before-exit');
 // YouTube still owns the old media styles after its root has resized. These
 // author values remain observable under our pin without becoming visible.
 Object.assign(video.style,{left:'0px',top:'191px',width:'874px',height:'492px'});
 testWindow.__langformFullscreen.exit('abcdefghijk');const immediate=sample('same-turn-after-exit');const request=messages.find(value=>value.kind==='exit-request');
 result(expectDelayedJump?'build35-exit-did-not-pin-immediately':'exit-pins-live-content-before-UIKit-resize',expectDelayedJump?!immediate.held:immediate.held&&distance(fullscreen.picture,immediate.picture)<1,{fullscreen,immediate});
 testWindow.__langformFullscreen.prepareExit('abcdefghijk',request.token,402,874);
 await resize(402,874,'portrait-resize');testWindow.__langformFullscreen.finishExit('abcdefghijk',request.token,402,874);
 await frames(30,'stale-inline-media');const stale=sample('before-delayed-hydration');
 result(expectDelayedJump?'build35-committed-stale-landscape-media-pose':expectLateHandoff?'build36-correct-inline-context-shows-under-oversized-landscape-live-picture':'first-portrait-frame-uses-known-inline-picture-while-natural-media-is-stale',expectDelayedJump?!stale.held&&messages.some(value=>value.kind==='exit-commit')&&stale.picture.width>800:stale.held&&stale.open&&!messages.some(value=>value.kind==='exit-commit')&&Math.abs(stale.root.width-402)<1&&(expectLateHandoff?distance(stale.picture,fullscreen.picture)<1&&!stale.contextHidden:distance(stale.picture,initial.picture)<1&&stale.contextHidden),{stale});
 let hydration=null;
 // A real ResizeObserver on the current root supplies the delayed YouTube
 // layout. It can update author styles while the live video stays pinned.
 const observer=new ResizeObserver(()=>{
  if(hydration||root.hasAttribute('data-langform-fullscreen-player')||Math.abs(root.getBoundingClientRect().width-402)>1)return;
  hydration={root:rect(root),held:video.hasAttribute('data-langform-fullscreen-exit-video'),authorWidth:video.style.width};
  Object.assign(video.style,{left:'0px',top:'0px',width:'100%',height:'100%'});sample('root-observer-hydration');
 });observer.observe(root);await frames(28,'hydrated-inline-media');observer.disconnect();const final=sample('after-commit');
 result('natural-root-hydration-remains-observable-while-pinned',!!hydration&&(expectDelayedJump||hydration.held),{hydration});
 result('final-inline-content-matches-real-portrait-player',!final.open&&!final.held&&distance(initial.picture,final.picture)<1&&messages.filter(value=>value.kind==='exit-commit').length===1,{initial,final});
 const current=trace.filter(r=>r.viewport.width===402&&['portrait-resize','stale-inline-media','before-delayed-hydration','root-observer-hydration','hydrated-inline-media','after-commit'].includes(r.phase));
 const steps=current.slice(1).map((r,i)=>distance(r.picture,current[i].picture)),largestStep=Math.max(...steps),total=distance(fullscreen.picture,initial.picture);
 const oversized=current.filter(r=>r.picture.width>initial.picture.width+2),moving=current.filter(r=>r.videoAnimations>0),firstPortrait=current[0];
 result(expectDelayedJump?'build35-post-commit-layout-jump-reproduced':expectLateHandoff?'build36-oversized-portrait-hold-then-secondary-video-motion-reproduced':'no-oversized-portrait-hold-or-secondary-video-motion-before-commit',expectDelayedJump?largestStep>400:expectLateHandoff?oversized.length>25&&moving.length>3&&largestStep/Math.max(1,total)<.35:oversized.length===0&&moving.length===0&&current.every(r=>distance(r.picture,initial.picture)<1),{largestStep,total,largestStepFraction:largestStep/Math.max(1,total),steps,oversizedPortraitFrames:oversized.length,movingPortraitFrames:moving.length,firstPortrait,waitingVisibleMilliseconds:current.filter(r=>r.contextHidden&&distance(r.picture,initial.picture)>1).length*1000/60});
 result('same-media-node-parent-source-time-and-running-live-state',root.querySelector('video')===node&&video.parentElement===parent&&video.getAttribute('src')===source&&video.currentTime===40&&!video.paused,{currentTime:video.currentTime,paused:video.paused});
 report({trace,sourceSHA256});report({finished:true,passed:errors.length===0&&results.every(r=>r.passed),count:results.length,errors,sourceSHA256,engine:'macOS WKWebView native window resize + actual ResizeObserver, substituted running live media/route'});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack,sourceSHA256}));
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(head + setup + tests + '</script></body></html>')
print(args.output)
