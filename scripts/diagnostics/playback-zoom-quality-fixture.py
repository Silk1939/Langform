#!/usr/bin/env python3
"""Isolated real-WebKit crop/quality regression; media metadata is substituted.

Run the generated page with FullscreenMotionWebKit.swift --landscape. Contacts
are synthetic, CSS matrices and video bounds come from WebKit, not an iPhone.
"""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--source', type=Path)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
sources = [args.source or repo / 'ios/Langform/Langform/PlaybackZoom.js']
sources += [repo / 'ios/Langform/Langform' / name for name in ['PlaybackSwipe.js', 'PlaybackHold.js', 'FullscreenMotion.js']]
fingerprints = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
html = '''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;background:#111;color:white;font:14px -apple-system}#movie_player{width:402px;height:226px}.html5-video-container,video{width:100%;height:100%}
</style></head><body><main><div id="movie_player"><div class="html5-video-container"><video preload="none" src="https://example.test/fixture"></video></div><button class="ytp-fullscreen-button">Vollbild</button></div></main><script>
const errors=[],results=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const route={hostname:'m.youtube.com',pathname:'/watch',href:'https://m.youtube.com/watch?v=abcdefghijk'};
const testWindow=new Proxy({}, {get(target,key){if(Reflect.has(target,key))return Reflect.get(target,key);if(key==='location')return route;const value=Reflect.get(window,key);return typeof value==='function'?value.bind(window):value;}});
testWindow.webkit={messageHandlers:{langformFullscreen:{postMessage(){}}}};
testWindow.__langformFullscreenDiagnostics=true;
const root=document.getElementById('movie_player'),video=root.querySelector('video'),container=video.parentElement;
let actualID='abcdefghijk',currentSource='https://example.test/fixture';
Object.defineProperties(video,{videoWidth:{value:1920,writable:true},videoHeight:{value:1080,writable:true},paused:{value:false},ended:{value:false},duration:{value:120},readyState:{value:4},error:{value:null},currentTime:{value:40,writable:true},currentSrc:{get:()=>currentSource}});
root.getVideoData=()=>({video_id:actualID,title:'Zoom quality fixture'});
video.play=()=>{throw Error('unexpected play')};video.pause=()=>{throw Error('unexpected pause')};
'''
html += 'const sourceFingerprints=' + json.dumps(fingerprints) + ';\n'
for path in sources:
    html += "new Function('window'," + json.dumps(path.read_text()) + ')(testWindow);\n'
html += r'''
function result(name,passed,details={}){const row={name,passed,...details};results.push(row);webkit.messageHandlers.qa.postMessage(row);}
function box(node){const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}
function pointer(name,id,x,y){const e=new Event(name,{bubbles:true,cancelable:true});Object.assign(e,{pointerType:'touch',pointerId:id,isPrimary:id===1,button:0,clientX:x,clientY:y});ui().dispatchEvent(e);}
function ui(){return document.getElementById('langform-fullscreen-ui');}
function state(){return testWindow.__langformPlaybackZoom.getState();}
function pose(s){return s&&[s.scale,s.x,s.y];}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function near(a,b){return Math.abs(a-b)<.05;}
function pinch(scale=2,cx=350,cy=201){pointer('pointerdown',1,cx-50,cy);pointer('pointerdown',2,cx+50,cy);pointer('pointermove',1,cx-50*scale,cy);pointer('pointermove',2,cx+50*scale,cy);pointer('pointerup',1,cx-50*scale,cy);pointer('pointerup',2,cx+50*scale,cy);}
function matrix(){const m=new DOMMatrix(getComputedStyle(video).transform);return [m.a,m.e,m.f];}
async function enter(){root.querySelector('button').click();await wait(160);ui().getAnimations({subtree:true}).forEach(a=>a.finish());await wait(30);}
async function fresh(){testWindow.__langformFullscreen.exit('abcdefghijk','qa');await wait(30);actualID='abcdefghijk';currentSource='https://example.test/fixture';video.src=currentSource;video.videoWidth=1920;video.videoHeight=1080;root.classList.remove('ad-showing');await enter();pinch();return state();}
(async()=>{
 await enter();pinch();
 const initial=pose(state()),initialMatrix=matrix(),initialBounds=box(video),basis=testWindow.__langformPlaybackZoom.getLayoutRect(video);
 result('initial-zoom-has-real-webkit-projection',equal(initial,initialMatrix)&&initial&&initial[0]===2&&initialBounds.width>innerWidth*1.9,{pose:initial,matrix:initialMatrix,bounds:initialBounds,hidden:document.hidden});
 for(const [width,height] of [[1280,720],[640,360],[3840,2160]]){
  video.videoWidth=width;video.videoHeight=height;
  const live=pose(state()),bounds=box(video),layout=testWindow.__langformPlaybackZoom.getLayoutRect(video);
  result('same-aspect-quality-retains-getter-crop-'+width,equal(live,initial)&&equal(matrix(),initialMatrix)&&equal(bounds,initialBounds)&&equal(layout,basis),{pose:live,matrix:matrix(),bounds,layout});
  video.dispatchEvent(new Event('loadedmetadata',{bubbles:true}));await wait(10);
  result('same-aspect-metadata-retains-crop-'+width,equal(pose(state()),initial)&&equal(matrix(),initialMatrix),{pose:pose(state()),matrix:matrix()});
 }
 pointer('pointerdown',1,437,150);pointer('pointermove',1,477,165);pointer('pointerup',1,477,165);
 const panned=pose(state());
 result('pan-after-quality-change-keeps-scale-and-css-projection',panned&&near(panned[0],2)&&near(panned[1],initial[1]+40)&&near(panned[2],initial[2]+15)&&equal(matrix(),panned)&&!state().gesturing,{pose:panned,matrix:matrix(),time:video.currentTime,rate:video.playbackRate});
 result('fresh-mid-pinch-starts-with-a-committed-crop',equal(pose(await fresh()),[2,87,0]),{pose:pose(state())});pointer('pointerdown',1,387,201);pointer('pointerdown',2,487,201);pointer('pointermove',1,337,201);pointer('pointermove',2,537,201);
 video.videoWidth=1280;video.videoHeight=720;video.dispatchEvent(new Event('loadedmetadata',{bubbles:true}));
 pointer('pointermove',1,287,201);pointer('pointermove',2,587,201);pointer('pointerup',1,287,201);pointer('pointerup',2,587,201);
 result('quality-change-mid-pinch-keeps-contact-projection',equal(pose(state()),[6,261,0])&&equal(matrix(),[6,261,0])&&!state().gesturing,{pose:pose(state()),matrix:matrix()});
 for(const guard of ['aspect','source','src-attribute','video-id','viewport','ad','root','video']){
  const original=await fresh();result('owner-guard-'+guard+'-has-real-initial-crop',equal(pose(original),[2,87,0]),{pose:pose(original)});let restore=()=>{};
  if(guard==='aspect'){video.videoWidth=1280;video.videoHeight=721;}
  if(guard==='source')currentSource='https://example.test/other';
  if(guard==='src-attribute')video.setAttribute('src','https://example.test/other');
  if(guard==='video-id')actualID='zyxwvutsrqp';
  if(guard==='viewport'){root.style.setProperty('width','870px','important');restore=()=>root.style.removeProperty('width');}
  if(guard==='ad')root.classList.add('ad-showing');
  if(guard==='root'){const replacement=root.cloneNode(true);root.replaceWith(replacement);restore=()=>replacement.replaceWith(root);}
  if(guard==='video'){const replacement=video.cloneNode(true);video.replaceWith(replacement);restore=()=>replacement.replaceWith(video);}
  await wait(10);const retained=state(),layout=testWindow.__langformPlaybackZoom.getLayoutRect(video);
  result('owner-guard-'+guard+'-rejects-old-crop',(!retained||retained.scale===1)&&layout===null,{state:retained,layout});
  restore();
 }
 result('no-playback-mutation-or-uncaught-error',video.currentTime===40&&video.playbackRate===1&&errors.length===0,{time:video.currentTime,rate:video.playbackRate,errors});
 webkit.messageHandlers.qa.postMessage({finished:true,passed:results.every(row=>row.passed),count:results.length,sourceFingerprints});
})().catch(error=>webkit.messageHandlers.qa.postMessage({finished:true,passed:false,error:String(error),stack:error.stack}));
</script></body></html>'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(html)
print(args.output)
