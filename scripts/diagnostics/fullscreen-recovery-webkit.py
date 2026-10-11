#!/usr/bin/env python3
"""Check stalled fullscreen fallback recovery with real offline macOS WebKit CSS.

Uses FullscreenMotionWebKit.swift. Media state and watch URL are substituted;
the native window resize, DOM layout and hidden/inert state are real.
"""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--source', type=Path)
parser.add_argument('--expect-stuck', action='store_true')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
source_path = args.source or repo / 'ios/Langform/Langform/FullscreenMotion.js'
source = source_path.read_text()
html = '''<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#182029;color:white;font:16px -apple-system}
#movie_player{position:relative;width:100%;aspect-ratio:16/9;background:#245b38}
.html5-video-container,video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
#details{padding:24px}button{min-height:44px}
</style></head><body><main><div id="movie_player"><div class="html5-video-container"><video class="html5-main-video"></video></div><button class="ytp-fullscreen-button">Vollbild</button></div><section id="details"><h1>Watch-Details</h1><button id="comments">Kommentare öffnen</button></section></main><script>
'''
setup = f'''
const sourceSHA256={json.dumps(hashlib.sha256(source_path.read_bytes()).hexdigest())},expectStuck={str(args.expect_stuck).lower()};
const messages=[],errors=[],results=[],calls=[];
addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const testLocation={{pathname:'/watch',href:'https://m.youtube.com/watch?v=abcdefghijk'}};
const testWindow=new Proxy({{}},{{get(t,k){{if(Reflect.has(t,k))return Reflect.get(t,k);if(k==='location')return testLocation;const v=Reflect.get(window,k);return typeof v==='function'?v.bind(window):v;}}}});
testWindow.__langformFullscreenExitProtocol=1;
testWindow.__langformStageInsets={{top:0,right:0,bottom:0,left:0}};
testWindow.webkit={{messageHandlers:{{langformFullscreen:{{postMessage:value=>messages.push(value)}}}}}};
const root=document.getElementById('movie_player'),video=root.querySelector('video'),details=document.getElementById('details');
Object.defineProperties(video,{{paused:{{value:false}},ended:{{value:false}},duration:{{value:120}},readyState:{{value:4}},currentTime:{{value:40,writable:true}},videoWidth:{{value:1920}},videoHeight:{{value:1080}}}});
root.getVideoData=()=>({{video_id:'abcdefghijk',title:'Fullscreen fallback recovery'}});
video.play=()=>{{calls.push('play');throw Error('Unexpected direct play')}};
video.pause=()=>{{calls.push('pause');throw Error('Unexpected direct pause')}};
new Function('window',{json.dumps(source)})(testWindow);
'''
tests = r'''
function report(value){window.webkit.messageHandlers.qa.postMessage(value)}
function check(name,passed,details={}){const row={name,passed,...details};results.push(row);report(row);if(!passed)throw Error(name)}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function frames(n){while(n--)await new Promise(requestAnimationFrame)}
async function resize(width,height){report({resize:{width,height}});for(let i=0;i<90;i++){await frames(1);if(Math.abs(innerWidth-width)<1&&Math.abs(innerHeight-height)<1)return}throw Error('WK resize timeout')}
function pose(){return {hidden:details.hasAttribute('data-langform-fullscreen-exit-context'),opacity:getComputedStyle(details).opacity,visibility:getComputedStyle(details).visibility,open:testWindow.__langformFullscreen.isOpen(),pinned:video.hasAttribute('data-langform-fullscreen-exit-video'),inert:document.querySelectorAll('[inert]').length}}
(async()=>{
 const media=video,parent=video.parentElement;
 for(const mode of ['uncached','cached','cancelled-staged']){
  await resize(402,874);video.style.width='402px';video.style.height='226.125px';testWindow.__langformStageInsets.top=0;
  root.querySelector('button').click();await frames(2);
  if(mode==='uncached')testWindow.__langformStageInsets.top=1;
  await resize(874,402);testWindow.__langformFullscreen.exit('abcdefghijk');
  const request=messages.findLast(row=>row.kind==='exit-request');check(mode+' exit requested',!!request);
  if(mode==='cancelled-staged'){
   check(mode+' staged accepted',testWindow.__langformFullscreen.prepareExitMotion('abcdefghijk',request.token,402,874,Date.now()+300,12));
   check(mode+' motion cancelled',testWindow.__langformFullscreen.cancelExitMotion('abcdefghijk',request.token));
  }
  // Substitute a YouTube author write that never hydrates back to portrait.
  video.style.width='874px';video.style.height='491.625px';
  testWindow.__langformFullscreen.prepareExit('abcdefghijk',request.token,402,874);
  testWindow.__langformFullscreen.finishExit('abcdefghijk',request.token,402,874);
  await resize(402,874);await frames(3);
  check(mode+' pending watch context hidden',pose().hidden&&pose().opacity==='0'&&pose().open,{pose:pose()});
  await sleep(2100);await frames(3);const after=pose();
  if(expectStuck){check(mode+' old fallback stays stuck',after.open&&after.hidden&&after.opacity==='0',{pose:after});testWindow.__langformFullscreen.exit('abcdefghijk','qa-cleanup',true)}
  else{
   check(mode+' watch context visible after abort',!after.open&&!after.hidden&&after.opacity==='1'&&after.visibility==='visible'&&!after.pinned&&after.inert===0,{pose:after});
   check(mode+' abort reported once without commit',messages.filter(row=>row.reason==='exit-layout-timeout').length===results.filter(row=>row.name.endsWith('watch context visible after abort')).length&&!messages.some(row=>row.kind==='exit-commit'));
   check(mode+' late finish ignored',!testWindow.__langformFullscreen.finishExit('abcdefghijk',request.token,402,874));
   let clicks=0;const button=document.getElementById('comments');button.onclick=()=>clicks++;button.focus();button.click();
   check(mode+' watch control focus and action restored',document.activeElement===button&&clicks===1);
  }
  check(mode+' substituted media identity and position preserved',root.querySelector('video')===media&&video.parentElement===parent&&video.currentTime===40&&!video.paused&&calls.length===0);
 }
 report({finished:true,passed:errors.length===0&&results.every(row=>row.passed),count:results.length,errors,sourceSHA256,expectStuck,engine:'macOS WKWebView, real native resize and CSS; substituted URL/media state'});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack,sourceSHA256,expectStuck}));
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(html + setup + tests + '</script></body></html>')
print(args.output)
