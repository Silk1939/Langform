#!/usr/bin/env python3
"""Actual desktop WebKit compositor trace of source-viewport staged exit.

The runner performs real WK/native-window resizes. Media playback is substituted;
this fixture proves geometry ordering, not physical iPhone visual acceptance.
"""
import argparse
import hashlib
import json
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--source', type=Path)
p.add_argument('--expect-hard-pin', action='store_true')
p.add_argument('--portrait-video', action='store_true')
p.add_argument('--inline-fit', choices=['contain', 'cover', 'fill'], default='contain')
p.add_argument('--transformed-ancestors', action='store_true')
p.add_argument('--scrolled', action='store_true')
p.add_argument('--stage-insets', action='store_true')
a = p.parse_args()
repo = Path(__file__).resolve().parents[2]
source_path = a.source or repo / 'ios/Langform/Langform/FullscreenMotion.js'
source = source_path.read_text()
html = '''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>
html,body{margin:0;background:#202936;color:white;font:14px -apple-system}main{width:100%}.header{height:110px}#movie_player{position:relative;width:100%;aspect-ratio:16/9;background:#26472b}.html5-video-container,video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.card{height:100px;border-bottom:1px solid #fff3}video{background:repeating-linear-gradient(45deg,#497793 0px,#497793 20px,#354461 20px,#354461 40px)}
</style></head><body><main><div class="header">Header</div><div id="movie_player"><div class="html5-video-container"><video class="html5-main-video"></video></div><button class="ytp-fullscreen-button">Vollbild</button></div><div id="context" class="card">Watch Kontext</div>''' + '<div class="card">Feed</div>' * 25 + '</main><script>'
setup = f'''
const baseline={str(a.expect_hard_pin).lower()},portrait={str(a.portrait_video).lower()},inlineFit={json.dumps(a.inline_fit)},transformed={str(a.transformed_ancestors).lower()},scrolled={str(a.scrolled).lower()},stageInsets={str(a.stage_insets).lower()},sourceSHA256={json.dumps(hashlib.sha256(source_path.read_bytes()).hexdigest())};
const errors=[],messages=[],trace=[],results=[],calls=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const testLocation={{pathname:'/watch',href:'https://m.youtube.com/watch?v=abcdefghijk'}};
const testWindow=new Proxy({{}},{{get(t,k){{if(Reflect.has(t,k))return Reflect.get(t,k);if(k==='location')return testLocation;const v=Reflect.get(window,k);return typeof v==='function'?v.bind(window):v;}}}});
testWindow.__langformFullscreenExitProtocol=1;testWindow.__langformStageInsets={{top:stageInsets?62:0,right:0,bottom:0,left:0}};
testWindow.webkit={{messageHandlers:{{langformFullscreen:{{postMessage:value=>messages.push(value)}}}}}};
const root=document.getElementById('movie_player'),video=root.querySelector('video'),context=document.getElementById('context');
Object.defineProperties(video,{{paused:{{value:false}},ended:{{value:false}},duration:{{value:120}},readyState:{{value:4}},currentTime:{{value:40,writable:true}},videoWidth:{{value:portrait?1080:1920}},videoHeight:{{value:portrait?1920:1080}}}});
video.style.objectFit=inlineFit;
if(transformed){{root.parentElement.style.transform='translateX(3px)';root.style.transform='translateY(4px)';video.parentElement.style.transform='translateY(2px)';video.style.setProperty('transform','translateX(7px)','important');}}
root.getVideoData=()=>({{video_id:'abcdefghijk',title:'Source viewport exit'}});video.play=()=>{{throw Error('Unexpected play')}};video.pause=()=>{{throw Error('Unexpected pause')}};
new Function('window',{json.dumps(source)})(testWindow);
'''
tests = r'''
function report(value){window.webkit.messageHandlers.qa.postMessage(value)}
function result(name,passed,details={}){const value={name,passed,...details};results.push(value);report(value)}
function rect(node){const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}
function intersection(a,b){const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),r=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);return {x,y,width:r-x,height:bottom-y}}
function distance(a,b){return Math.max(...['x','y','width','height'].map(k=>Math.abs(a[k]-b[k])))}
function clipBox(box,clip){if(clip==='none')return box;const match=/^inset\(([^()]+)\)$/.exec(clip);if(!match)throw Error('Unmeasured actual clip: '+clip);let v=match[1].trim().split(/\s+/);if(v.length===1)v=[v[0],v[0],v[0],v[0]];if(v.length===2)v=[v[0],v[1],v[0],v[1]];if(v.length===3)v=[v[0],v[1],v[2],v[1]];v=v.map((n,i)=>parseFloat(n)/(n.endsWith('%')?100:i%2?box.width:box.height));return {x:box.x+box.width*v[3],y:box.y+box.height*v[0],width:box.width*(1-v[1]-v[3]),height:box.height*(1-v[0]-v[2])}}
function sample(phase){const outer=rect(video),css=getComputedStyle(video),scale=css.objectFit==='cover'?Math.max(outer.width/video.videoWidth,outer.height/video.videoHeight):Math.min(outer.width/video.videoWidth,outer.height/video.videoHeight),picture=css.objectFit==='fill'?outer:{x:outer.x+(outer.width-video.videoWidth*scale)/2,y:outer.y+(outer.height-video.videoHeight*scale)/2,width:video.videoWidth*scale,height:video.videoHeight*scale};const value={phase,epoch:Date.now(),viewport:{width:innerWidth,height:innerHeight},root:rect(root),picture,visible:intersection(picture,clipBox(outer,css.clipPath)),clip:css.clipPath,fullscreen:root.hasAttribute('data-langform-fullscreen-player'),handoff:video.hasAttribute('data-langform-fullscreen-exit-video'),contextHidden:context.hasAttribute('data-langform-fullscreen-exit-context')};trace.push(value);return value}
async function frames(count,phase){for(let i=0;i<count;i++){await new Promise(requestAnimationFrame);sample(phase)}}
async function resize(width,height,phase){report({resize:{width,height}});for(let i=0;i<60;i++){await new Promise(requestAnimationFrame);sample(phase);if(Math.abs(innerWidth-width)<1&&Math.abs(innerHeight-height)<1)return;}throw Error('native WK resize timeout')}
(async()=>{
await resize(402,874,'initial');if(scrolled)scrollTo(0,50);await frames(2,'initial');const before=sample('inline-before'),node=video,parent=video.parentElement;
root.querySelector('button').click();await resize(874,402,'entry');await frames(3,'fullscreen');if(stageInsets)testWindow.__langformStageInsets.top=0;
testWindow.__langformFullscreen.exit('abcdefghijk');const request=messages.find(m=>m.kind==='exit-request'),start=sample('exit-source');
const supported=typeof testWindow.__langformFullscreen.prepareExitMotion==='function';
const accepted=supported&&testWindow.__langformFullscreen.prepareExitMotion('abcdefghijk',request.token,402,874,Date.now()+330,19);
testWindow.__langformVideoProbeTicket=999;
if(baseline){
testWindow.__langformFullscreen.prepareExit('abcdefghijk',request.token,402,874);await resize(402,874,'baseline-hard-pin');await frames(2,'baseline-hard-pin');const pin=sample('baseline-pinned');
result('build38-hard-pin-before-rotation-completion-reproduced',!accepted&&distance(start.picture,pin.picture)>250,{start,pin});testWindow.__langformFullscreen.finishExit('abcdefghijk',request.token,402,874);await frames(12,'baseline-final');
}else if(portrait&&inlineFit==='fill'){
result('portrait-fill-uses-explicit-uniform-motion-fallback',accepted===false&&!messages.some(m=>m.kind==='exit-motion-ready')&&distance(sample('rejected').picture,start.picture)<1);
testWindow.__langformFullscreen.prepareExit('abcdefghijk',request.token,402,874);await resize(402,874,'fallback');testWindow.__langformFullscreen.finishExit('abcdefghijk',request.token,402,874);await frames(20,'fallback');
}else{
result('staged-motion-accepted-with-source-WK-still-held',accepted===true&&innerWidth===874&&innerHeight===402&&root.hasAttribute('data-langform-fullscreen-player'));
testWindow.__langformFullscreen.prepareExit('abcdefghijk',request.token,402,874);testWindow.__langformFullscreen.finishExit('abcdefghijk',request.token,402,874);
for(let i=0;i<60&&!messages.some(m=>m.kind==='exit-motion-ready');i++)await frames(1,'before-ACK');
const ack=messages.find(m=>m.kind==='exit-motion-ready'),end=sample('ACK-before-resize'),motion=trace.filter(f=>f.phase==='before-ACK'),steps=motion.slice(1).map((f,i)=>distance(f.picture,motion[i].picture));
result('ACK-follows-measured-final-pin-in-old-source-coordinate-space',!!ack&&ack.requestTicket===19&&ack.width===402&&ack.height===874&&end.viewport.width===874&&end.viewport.height===402&&end.fullscreen&&end.handoff&&distance(end.picture,before.picture)<1&&distance(end.visible,before.visible)<1,{ack,end,before});
const uniform=motion.every(f=>Math.abs(f.picture.width/f.picture.height-start.picture.width/start.picture.height)<.0001),fits=motion.every(f=>f.visible.x>=-1&&f.visible.y>=-1&&f.visible.x+f.visible.width<=875&&f.visible.y+f.visible.height<=403);
result('every-presented-source-frame-is-uniform-and-visible-within-held-WK',motion.length>=6&&uniform&&fits&&steps.filter(n=>n>1).length>=4&&Math.max(...steps)<distance(start.picture,end.picture)*.4,{samples:motion.length,uniform,fits,steps});
result('watch-context-and-fullscreen-flow-held-through-ACK',motion.every(f=>f.fullscreen&&f.contextHidden)&&end.fullscreen&&end.contextHidden);
video.style.width='874px';video.style.height='491.625px';if(stageInsets)testWindow.__langformStageInsets.top=62;
await resize(402,874,'actual-WK-shrink');await frames(12,'delayed-natural-hydration');const pending=sample('pending-natural');
result('staged-final-pin-survives-real-shrink-and-delayed-author-hydration',testWindow.__langformFullscreen.isOpen()&&distance(pending.picture,end.picture)<1&&!messages.some(m=>m.kind==='exit-commit'),{pending,end});
video.style.width='100%';video.style.height='100%';await frames(8,'natural-ready');const final=sample('final-inline'),late=trace.filter(f=>['actual-WK-shrink','delayed-natural-hydration','pending-natural','natural-ready','final-inline'].includes(f.phase));
result('two-natural-frames-release-same-picture-without-second-motion',!testWindow.__langformFullscreen.isOpen()&&messages.filter(m=>m.kind==='exit-commit').length===1&&late.every(f=>distance(f.picture,end.picture)<1)&&distance(final.picture,before.picture)<1,{final,end,maxLateDelta:Math.max(...late.map(f=>distance(f.picture,end.picture)))});
}
result('same-live-media-node-parent-time-and-playback-restored',video===node&&video.parentElement===parent&&video.currentTime===40&&!video.paused&&calls.length===0&&!document.querySelector('[data-langform-fullscreen-placeholder]'),{time:video.currentTime,paused:video.paused,open:testWindow.__langformFullscreen.isOpen()});
report({trace,sourceSHA256});report({finished:true,passed:errors.length===0&&results.every(r=>r.passed),count:results.length,errors,sourceSHA256,engine:'macOS WKWebView; real native window resize; substituted media'});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack,sourceSHA256}));
'''
a.output.parent.mkdir(parents=True, exist_ok=True)
a.output.write_text(html + setup + tests + '</script></body></html>')
print(a.output)
