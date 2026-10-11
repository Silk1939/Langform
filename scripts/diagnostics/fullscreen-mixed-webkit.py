#!/usr/bin/env python3
"""Offline macOS WebKit mixed fullscreen geometry and identity regression.

Uses the existing FullscreenMotionWebKit.swift runner. Native window resize,
CSS cascade, hit testing and DOM events are real; media state/URL are replaced.
This fixture does not establish physical iPhone playback or finger acceptance.
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
source_path = args.source or repo / 'ios/Langform/Langform/FullscreenMotion.js'
source = source_path.read_text()
html = '''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;background:#182029;color:white;font:16px -apple-system}
main{transform:translateX(3px)}header{height:96px;background:#0007}button{min-height:44px}
#movie_player{position:relative;width:100%;aspect-ratio:16/9;background:#245b38;transform:translateY(4px)}
.html5-video-container,video{position:absolute;inset:0;width:100%;height:100%}
video{object-fit:contain;background:repeating-linear-gradient(45deg,#497793 0px,#497793 20px,#354461 20px,#354461 40px)}
#details{height:900px;padding:24px}ytm-header{position:fixed;inset:0 0 auto;height:48px;z-index:2147483647}
</style></head><body><main><header><ytm-header>YouTube <button>Suche</button></ytm-header></header><div id="movie_player"><div class="html5-video-container"><video class="html5-main-video"></video></div><button class="ytp-fullscreen-button">Vollbild</button></div><section id="details"><h1>Watch-Details</h1><button>Kommentare</button></section></main><script>
'''
setup = f'''
const sourceSHA256={json.dumps(hashlib.sha256(source_path.read_bytes()).hexdigest())};
const messages=[],errors=[],results=[],trace=[],commands=[],directMediaCalls=[];
addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const testLocation={{pathname:'/watch',href:'https://m.youtube.com/watch?v=abcdefghijk'}};
const testWindow=new Proxy({{}},{{get(t,k){{if(Reflect.has(t,k))return Reflect.get(t,k);if(k==='location')return testLocation;const v=Reflect.get(window,k);return typeof v==='function'?v.bind(window):v;}}}});
testWindow.__langformFullscreenEnterProtocol=1;testWindow.__langformFullscreenExitProtocol=1;
testWindow.__langformStageInsets={{top:0,right:0,bottom:0,left:0}};
testWindow.webkit={{messageHandlers:{{langformFullscreen:{{postMessage:value=>messages.push(value)}}}}}};
const root=document.getElementById('movie_player'),video=root.querySelector('video'),container=video.parentElement,details=document.getElementById('details'),header=document.querySelector('ytm-header');
let mediaID='abcdefghijk',mediaWidth=1920,mediaHeight=1080,paused=false;
Object.defineProperties(video,{{paused:{{get:()=>paused}},ended:{{value:false}},duration:{{value:120}},readyState:{{value:4}},currentTime:{{value:40,writable:true}},videoWidth:{{get:()=>mediaWidth}},videoHeight:{{get:()=>mediaHeight}}}});
root.getVideoData=()=>({{video_id:mediaID,title:'Mischfolge '+mediaID}});
video.play=()=>{{directMediaCalls.push('play');throw Error('Unexpected direct play')}};video.pause=()=>{{directMediaCalls.push('pause');throw Error('Unexpected direct pause')}};
testWindow.__langformTogglePlayback=id=>{{if(id!==mediaID)return false;commands.push({{kind:'pause',id}});paused=true;video.dispatchEvent(new Event('pause'));return true}};
testWindow.__langformPlay=id=>{{if(id!==mediaID)return false;commands.push({{kind:'play',id}});paused=false;video.dispatchEvent(new Event('playing'));return true}};
new Function('window',{json.dumps(source)})(testWindow);
'''
tests = r'''
function report(value){window.webkit.messageHandlers.qa.postMessage(value)}
function check(name,passed,details={}){const row={name,passed,...details};results.push(row);report(row)}
function rect(node){const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}
function picture(){const outer=rect(video),fit=getComputedStyle(video).objectFit,scale=fit==='cover'?Math.max(outer.width/mediaWidth,outer.height/mediaHeight):Math.min(outer.width/mediaWidth,outer.height/mediaHeight);return fit==='fill'?outer:{x:outer.x+(outer.width-mediaWidth*scale)/2,y:outer.y+(outer.height-mediaHeight*scale)/2,width:mediaWidth*scale,height:mediaHeight*scale}}
function sample(phase){const row={phase,epoch:Date.now(),id:mediaID,viewport:{width:innerWidth,height:innerHeight},root:rect(root),picture:picture(),fit:getComputedStyle(video).objectFit,time:video.currentTime,open:testWindow.__langformFullscreen.isOpen()};trace.push(row);return row}
function distance(a,b){return Math.max(...['x','y','width','height'].map(key=>Math.abs(a[key]-b[key])))}
function painted(node){for(let n=node;n;n=n.parentElement){const css=getComputedStyle(n);if(css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0)return false}return true}
function hit(node){const r=rect(node),target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return target===node||node.contains(target)}
async function frames(n,phase){while(n--){await new Promise(requestAnimationFrame);sample(phase)}}
async function resize(width,height,phase){report({resize:{width,height}});for(let i=0;i<90;i++){await frames(1,phase);if(Math.abs(innerWidth-width)<1&&Math.abs(innerHeight-height)<1)return}throw Error('WK resize timeout')}
async function until(test,phase){for(let i=0;i<90;i++){if(test())return;await frames(1,phase)}throw Error('condition timeout '+phase)}
const A='abcdefghijk',B='lmnopqrstuv';
(async()=>{
 const sameNode=video,sameParent=container;
 const modes=[{id:A,width:1920,height:1080,fit:'contain'},{id:A,width:1920,height:1080,fit:'cover'},{id:B,width:1080,height:1920,fit:'cover'},{id:B,width:1080,height:1920,fit:'contain'},{id:A,width:1920,height:1080,fit:'cover'},{id:A,width:1920,height:1080,fit:'contain'}];
 for(let index=0;index<modes.length;index++){
  const mode=modes[index],cycle=index+1;
  await resize(402,874,'cycle-'+cycle+'-initial');
  if(mediaID!==mode.id){dispatchEvent(new Event('yt-navigate-start'));mediaID=mode.id;testLocation.href='https://m.youtube.com/watch?v='+mediaID;video.style.width='100%';video.style.height='100%';container.style.width='100%';container.style.height='100%';dispatchEvent(new Event('video-data-change'))}
  mediaWidth=mode.width;mediaHeight=mode.height;video.style.objectFit=mode.fit;video.dispatchEvent(new Event('loadedmetadata'));
  scrollTo(0,index%2?40:0);await frames(3,'cycle-'+cycle+'-inline');const before=sample('cycle-'+cycle+'-before');
  root.querySelector('button').click();const enter=messages.filter(row=>row.kind==='enter-request').at(-1);
  check('cycle '+cycle+' entry identity',!!enter&&enter.videoID===mediaID);
  const delayed=cycle%2===0;
  if(delayed){root.style.setProperty('width','874px','important');root.style.setProperty('height','874px','important');root.style.setProperty('left','-472px','important')}
  testWindow.__langformFullscreen.prepareEnter(mediaID,enter.token,874,402);await resize(874,402,'cycle-'+cycle+'-landscape');testWindow.__langformFullscreen.finishEnter(mediaID,enter.token,874,402);await frames(3,'cycle-'+cycle+'-delayed-root');
  if(delayed){check('cycle '+cycle+' waits for stale root instead of committing a small shifted picture',video.hasAttribute('data-langform-fullscreen-enter-video')&&!messages.some(row=>row.kind==='enter-commit'&&row.token===enter.token));for(const key of ['width','height','left'])root.style.removeProperty(key)}
  await until(()=>messages.some(row=>row.kind==='enter-commit'&&row.token===enter.token),'cycle-'+cycle+'-enter-commit');await frames(2,'cycle-'+cycle+'-fullscreen');
  const scale=Math.min(874/mediaWidth,402/mediaHeight),expected={x:(874-mediaWidth*scale)/2,y:(402-mediaHeight*scale)/2,width:mediaWidth*scale,height:mediaHeight*scale},full=sample('cycle-'+cycle+'-full');
  check('cycle '+cycle+' fullscreen actual contained geometry',distance(full.picture,expected)<1&&distance(full.root,{x:0,y:0,width:874,height:402})<1,{full,expected});
  const ui=document.getElementById('langform-fullscreen-ui'),range=ui.querySelector('input');
  check('cycle '+cycle+' controls hit and page chrome hidden',hit(ui.querySelector('[data-action=exit]'))&&!painted(header)&&!painted(details));
  range.value=String(30+cycle*7);range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new Event('change',{bubbles:true}));video.dispatchEvent(new Event('seeked'));
  check('cycle '+cycle+' user scrub seeks same media',video.currentTime===30+cycle*7);
  ui.querySelector('[data-action=forward]').click();ui.querySelector('[data-action=back]').click();
  ui.querySelector('[data-action=play]').click();check('cycle '+cycle+' user pause delivered',paused);ui.querySelector('[data-action=play]').click();check('cycle '+cycle+' user resume delivered',!paused);
  const wantedTime=video.currentTime;
  testWindow.__langformFullscreen.exit(mediaID);const exit=messages.filter(row=>row.kind==='exit-request').at(-1);
  check('cycle '+cycle+' exit motion cached for same identity',testWindow.__langformFullscreen.prepareExitMotion(mediaID,exit.token,402,874,Date.now()+250,cycle+100));
  testWindow.__langformFullscreen.prepareExit(mediaID,exit.token,402,874);
  await until(()=>messages.some(row=>row.kind==='exit-motion-ready'&&row.token===exit.token),'cycle-'+cycle+'-exit-ready');
  video.style.setProperty('width','874px','important');video.style.setProperty('height','491.625px','important');container.style.setProperty('width','874px','important');container.style.setProperty('height','491.625px','important');
  await resize(402,874,'cycle-'+cycle+'-portrait');testWindow.__langformFullscreen.finishExit(mediaID,exit.token,402,874);
  await until(()=>!testWindow.__langformFullscreen.isOpen(),'cycle-'+cycle+'-exit-commit');await frames(3,'cycle-'+cycle+'-restored');const after=sample('cycle-'+cycle+'-after');
  check('cycle '+cycle+' inline crop and object fit restored after scrub and stale author dimensions',distance(before.picture,after.picture)<1&&after.fit===mode.fit,{before,after});
  check('cycle '+cycle+' no additional seek media replacement or hidden controls',video===sameNode&&video.parentElement===sameParent&&video.currentTime===wantedTime&&!paused&&painted(header)&&painted(details)&&!document.querySelector('[inert]')&&!document.getElementById('langform-fullscreen-ui'));
 }
 // A navigation can interrupt an already running scrub. Detached old controls
 // and late native callbacks must not seek or resize the next video.
 root.querySelector('button').click();const oldEnter=messages.filter(row=>row.kind==='enter-request').at(-1);testWindow.__langformFullscreen.prepareEnter(mediaID,oldEnter.token,874,402);await resize(874,402,'navigation-landscape');testWindow.__langformFullscreen.finishEnter(mediaID,oldEnter.token,874,402);await until(()=>messages.some(row=>row.kind==='enter-commit'&&row.token===oldEnter.token),'navigation-enter');
 const oldRange=document.querySelector('#langform-fullscreen-ui input');oldRange.value='95';oldRange.dispatchEvent(new Event('input',{bubbles:true}));
 dispatchEvent(new Event('yt-navigate-start'));mediaID=B;testLocation.href='https://m.youtube.com/watch?v='+B;dispatchEvent(new Event('video-data-change'));const retainedTime=video.currentTime;
 oldRange.dispatchEvent(new Event('change',{bubbles:true}));
 check('navigation during scrub retires old controls without a seek on B',video.currentTime===retainedTime&&!testWindow.__langformFullscreen.isOpen()&&!document.getElementById('langform-fullscreen-ui'));
 check('late native entry cannot overwrite B layout',!testWindow.__langformFullscreen.finishEnter(A,oldEnter.token,874,402));
 await resize(402,874,'navigation-inline');video.style.setProperty('height','240px','important');await frames(2,'new-author');
 check('old inline owner does not overwrite B author styles',video.style.height==='240px'&&video.style.getPropertyPriority('height')==='important');
 check('all intended pause play commands were identity scoped',commands.length===12&&commands.every(row=>row.id===A||row.id===B)&&directMediaCalls.length===0,{commands,directMediaCalls});
 report({trace,sourceSHA256});report({finished:true,passed:errors.length===0&&results.every(row=>row.passed),count:results.length,errors,sourceSHA256,engine:'macOS WKWebView real native resize/CSS/hit tests; substituted URL, intrinsic dimensions and media playback'});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack,sourceSHA256,messages,trace,css:{video:video.getAttribute('style'),container:container.getAttribute('style'),root:root.getAttribute('style'),computed:getComputedStyle(video).cssText},scroll:{x:scrollX,y:scrollY}}));
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(html + setup + tests + '</script></body></html>')
print(args.output)
