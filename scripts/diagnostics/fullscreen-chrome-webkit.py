#!/usr/bin/env python3
"""Check fullscreen background chrome with real offline macOS WebKit CSS."""
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
html,body{margin:0;background:#172029;color:white;font:16px -apple-system}
main{padding-top:48px}ytm-header{position:fixed;top:0;left:0;right:0;height:48px;display:flex;align-items:center;justify-content:space-between;background:#0008;z-index:2147483647}
ytm-header a{color:white;text-decoration:none}button{min-height:44px}
#movie_player{position:relative;width:100%;aspect-ratio:16/9;background:#245b38}
.html5-video-container,video{position:absolute;inset:0;width:100%;height:100%;background:linear-gradient(30deg,#326846,#60892c);object-fit:contain}
#details{padding:24px}
</style></head><body><main><ytm-header style="visibility:visible!important;opacity:1"><a href="#" style="visibility:visible!important">▶ YouTube</a><button>Suche</button><button>Menü</button></ytm-header><div id="movie_player"><div class="html5-video-container"><video class="html5-main-video"></video></div><button class="ytp-fullscreen-button">Vollbild</button></div><section id="details"><h1>Watch-Details</h1><button>Kommentare</button></section></main><script>
'''
setup = f'''
const sourceSHA256={json.dumps(hashlib.sha256(source_path.read_bytes()).hexdigest())};
const messages=[],errors=[],results=[],calls=[];
addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const testLocation={{pathname:'/watch',href:'https://m.youtube.com/watch?v=abcdefghijk'}};
const testWindow=new Proxy({{}},{{get(t,k){{if(Reflect.has(t,k))return Reflect.get(t,k);if(k==='location')return testLocation;const v=Reflect.get(window,k);return typeof v==='function'?v.bind(window):v;}}}});
testWindow.webkit={{messageHandlers:{{langformFullscreen:{{postMessage:value=>messages.push(value)}}}}}};
const root=document.getElementById('movie_player'),video=root.querySelector('video'),details=document.getElementById('details');
Object.defineProperties(video,{{paused:{{value:false}},ended:{{value:false}},duration:{{value:120}},readyState:{{value:4}},currentTime:{{value:40,writable:true}},videoWidth:{{value:1920}},videoHeight:{{value:1080}}}});
root.getVideoData=()=>({{video_id:'abcdefghijk',title:'Fullscreen ohne YouTube-Kopfzeile'}});
video.play=()=>{{calls.push('play');throw Error('Unexpected direct play')}};video.pause=()=>{{calls.push('pause');throw Error('Unexpected direct pause')}};
new Function('window',{json.dumps(source)})(testWindow);
'''
tests = r'''
function report(value){window.webkit.messageHandlers.qa.postMessage(value)}
function check(name,passed,details={}){const row={name,passed,...details};results.push(row);report(row)}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const ui=()=>document.getElementById('langform-fullscreen-ui');
function painted(node){for(let n=node;n;n=n.parentElement){const css=getComputedStyle(n);if(css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0)return false}return true}
function box(node){const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}
function hit(node){const r=box(node),target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return target===node||node.contains(target)}
(async()=>{
 let header=document.querySelector('ytm-header');const originalStyles=[header,header.querySelector('a')].map(n=>n.getAttribute('style'));
 const inline=box(root),media=video,parent=video.parentElement;
 check('inline header visible',painted(header.querySelector('a'))&&painted(details));
 root.querySelector('button').click();await sleep(250);
 check('fullscreen hides logo/search/menu despite max z-index and inline visibility',!painted(header.querySelector('a'))&&Array.from(header.querySelectorAll('button')).every(n=>!painted(n)),{headerOpacity:getComputedStyle(header).opacity,headerVisibility:getComputedStyle(header).visibility});
 check('hidden header has no pointer hit',!hit(header.querySelector('a'))&&!hit(header.querySelector('button')));
 check('live media and own exit controls remain visible and reachable',painted(video)&&painted(ui().querySelector('[data-action=exit]'))&&hit(ui().querySelector('[data-action=exit]')));
 check('details hidden without changing their layout',!painted(details)&&details.getBoundingClientRect().height>0);
 report({snapshot:'fullscreen-chrome'});await sleep(150);
 ui().click();await sleep(3200);
 check('auto-hidden controls do not reveal YouTube header',ui().hasAttribute('data-hidden')&&!painted(header));ui().click();
 const replacement=header.cloneNode(true);header.replaceWith(replacement);header=replacement;
 const bodyHeader=header.cloneNode(true);document.body.appendChild(bodyHeader);await sleep(50);
 check('replaced and newly inserted body headers remain hidden',!painted(header)&&!painted(bodyHeader));
 check('new body header cannot block own controls',hit(ui().querySelector('[data-action=exit]')));
 ui().querySelector('[data-action=exit]').click();await sleep(50);
 check('exit restores header details and exact author styles',!ui()&&painted(header)&&painted(bodyHeader)&&painted(details)&&JSON.stringify(originalStyles)===JSON.stringify([header,header.querySelector('a')].map(n=>n.getAttribute('style'))));
 check('inline player geometry unchanged',JSON.stringify(box(root))===JSON.stringify(inline),{before:inline,after:box(root)});bodyHeader.remove();
 report({snapshot:'inline-restored'});await sleep(150);
 for(let cycle=0;cycle<3;cycle++){
  root.querySelector('button').click();await sleep(20);check('cycle '+cycle+' header hidden',!painted(header)&&painted(video));
  testWindow.__langformFullscreen.exit('abcdefghijk','navigation',true);await sleep(20);check('cycle '+cycle+' cancellation restores chrome',!ui()&&painted(header)&&painted(details)&&!root.parentElement.hasAttribute('inert'));
 }
 root.querySelector('button').click();window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
 check('pagehide restores visible inline chrome',!ui()&&painted(header)&&!root.parentElement.hasAttribute('inert'));
 window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));root.querySelector('button').click();
 check('restored page reenters without leaked header',!!ui()&&!painted(header)&&painted(video));testWindow.__langformFullscreen.exit('abcdefghijk');
 check('same substituted media node position and playback preserved',root.querySelector('video')===media&&video.parentElement===parent&&video.currentTime===40&&!video.paused&&calls.length===0);
 report({finished:true,passed:errors.length===0&&results.every(row=>row.passed),count:results.length,errors,sourceSHA256,engine:'macOS WKWebView real CSS/compositor; substituted URL/media state'});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack,sourceSHA256}));
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(html + setup + tests + '</script></body></html>')
print(args.output)
