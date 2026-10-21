#!/usr/bin/env python3
"""Offline WebKit layout/contact regression; use FullscreenMotionWebKit.swift.

This checks real WebKit CSS/hit testing and synthetic event ownership. Media
metadata and the YouTube route are substitutes; it is not physical iPhone QA.
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
motion = args.source or repo / 'ios/Langform/Langform/FullscreenMotion.js'
chapters = repo / 'ios/Langform/Langform/FullscreenChapters.js'
fingerprints = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in [motion, chapters]}
html = '''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>
html,body{margin:0;background:#111;color:white;font:14px -apple-system}#movie_player{width:402px;height:226px}.html5-video-container,video{width:100%;height:100%}
</style></head><body><main><div id="movie_player"><div class="html5-video-container"><video src="https://example.test/fixture"></video></div><div class="player-controls-content"><button class="ytp-fullscreen-button">Vollbild</button></div></div></main><script>'''
html += '''
const errors=[],results=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const route={hostname:'m.youtube.com',pathname:'/watch',href:'https://m.youtube.com/watch?v=abcdefghijk'};
const testWindow=new Proxy({}, {get(target,key){if(Reflect.has(target,key))return Reflect.get(target,key);if(key==='location')return route;const value=Reflect.get(window,key);return typeof value==='function'?value.bind(window):value;}});
testWindow.webkit={messageHandlers:{langformFullscreen:{postMessage(){}}}};
const root=document.getElementById('movie_player'),video=root.querySelector('video');
Object.defineProperties(video,{paused:{value:false},ended:{value:false},duration:{value:120},readyState:{value:4},currentTime:{value:40,writable:true}});
root.getVideoData=()=>({video_id:'abcdefghijk',title:'Ein langer Videotitel, der im Querformat erreichbar bleibt'});
video.play=()=>{throw Error('unexpected play')};video.pause=()=>{throw Error('unexpected pause')};
testWindow.ytInitialPlayerResponse={videoDetails:{videoId:'abcdefghijk'}};
document.documentElement.__langformChapterVideoID='abcdefghijk';
document.documentElement.__langformChapterList=[{start:0,title:'Ein langes Kapitel mit vielen Wörtern'},{start:75,title:'Das Fazit'}];
'''
html += 'const sourceFingerprints=' + json.dumps(fingerprints) + ';\n'
for path in [chapters, motion]:
    html += "new Function('window'," + json.dumps(path.read_text()) + ')(testWindow);\n'
html += r'''
function result(name,passed,details){const row={name,passed,...details};results.push(row);webkit.messageHandlers.qa.postMessage(row);}
function box(node){const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}
function hit(node){const r=box(node),at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {label:node.getAttribute('aria-label')||node.textContent,rect:r,hittable:node===at||node.contains(at)};}
function pointer(target,name,id=7,extra={}){const e=new Event(name,{bubbles:true,cancelable:true});Object.assign(e,{pointerType:'touch',pointerId:id,isPrimary:id===7,button:0,clientX:120,clientY:innerHeight-30,...extra});target.dispatchEvent(e);}
function input(range,value){range.value=String(value);range.dispatchEvent(new Event('input',{bubbles:true}));}
(async()=>{
 for(const [width,height] of [[874,402],[844,320],[568,240],[402,874]]){
  webkit.messageHandlers.qa.postMessage({resize:{width,height}});await wait(120);
  root.querySelector('button').click();await wait(250);
  const ui=document.getElementById('langform-fullscreen-ui');
  if(!ui){result('fullscreen-open',false,{width,height});continue;}
  // Measure the settled layout independently of compositor throttling when
  // the test's accessory window is briefly occluded during a resize.
  ui.getAnimations({subtree:true}).forEach(animation=>animation.finish());
  const items=Array.from(ui.querySelectorAll('button,input')).filter(node=>!node.closest('[hidden]'));
  const hits=items.map(hit);
  result('visible-controls-have-separate-hit-targets',hits.every(item=>item.hittable&&item.rect.width>=43.9&&item.rect.height>=43.9&&item.rect.x>=-.1&&item.rect.y>=-.1&&item.rect.x+item.rect.width<=innerWidth+.1&&item.rect.y+item.rect.height<=innerHeight+.1),{viewport:{width:innerWidth,height:innerHeight},hits});
  if(!document.hidden){webkit.messageHandlers.qa.postMessage({snapshot:'controls-'+width+'x'+height});await wait(80);}
  const range=ui.querySelector('input');
  result('slider-owns-diagonal-browser-touch',getComputedStyle(range).touchAction==='none',{viewport:{width:innerWidth,height:innerHeight},touchAction:getComputedStyle(range).touchAction});
  pointer(range,'pointerdown');input(range,52);pointer(range,'pointercancel');input(range,86);range.dispatchEvent(new Event('change',{bubbles:true}));
  result('cancelled-range-rejects-late-native-change',video.currentTime===40&&!!document.getElementById('langform-fullscreen-ui'),{time:video.currentTime});
  ui.querySelector('button').focus();range.focus();input(range,54);range.dispatchEvent(new Event('change',{bubbles:true}));
  result('new-range-focus-admits-nonpointer-adjustment',video.currentTime===(document.hidden?40:54),{time:video.currentTime,hidden:document.hidden,focused:document.activeElement===range});
  pointer(range,'pointerdown');input(range,52);pointer(range,'pointerup');
  result('fresh-range-release-respects-real-visibility',video.currentTime===(document.hidden?40:52)&&!!document.getElementById('langform-fullscreen-ui'),{time:video.currentTime,hidden:document.hidden,disabled:range.disabled});
  const timeline=box(range),contactY=timeline.y+timeline.height/2;
  ui.setAttribute('data-hidden','');
  pointer(ui,'pointerdown',7,{clientY:contactY});pointer(ui,'pointermove',7,{clientY:contactY+95});pointer(ui,'pointerup',7,{clientY:contactY+95});
  result('retargeted-timeline-does-not-exit-fullscreen',!!document.getElementById('langform-fullscreen-ui'),{viewport:{width:innerWidth,height:innerHeight},contactY});
  testWindow.__langformFullscreen.exit('abcdefghijk');video.currentTime=40;await wait(80);
 }
 result('no-uncaught-errors',errors.length===0,{errors});
 webkit.messageHandlers.qa.postMessage({finished:true,passed:results.every(row=>row.passed),count:results.length,sourceFingerprints});
})().catch(error=>webkit.messageHandlers.qa.postMessage({finished:true,passed:false,error:String(error),stack:error.stack}));
</script></body></html>'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(html)
print(args.output)
