#!/usr/bin/env python3
"""Generate offline WKWebView checks for fullscreen-to-retained-feed search.

Run with the existing AppKit FullscreenMotionWebKit.swift runner. Real shipping
FullscreenMotion and WebViewLinks operate in separate DOM documents. Native
entry/exit acknowledgements, the feed handoff, URL and media state are mocked.
There is no iPhone, simulator, YouTube request, or live media playback.
"""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--source', type=Path)
parser.add_argument('--links', type=Path)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
motion_path = args.source or repo / 'ios/Langform/Langform/FullscreenMotion.js'
links_path = args.links or repo / 'ios/Langform/Langform/WebViewLinks.js'
motion = motion_path.read_text()
links = links_path.read_text()
fingerprints = {str(path.relative_to(repo)) if path.is_relative_to(repo) else str(path):
                hashlib.sha256(path.read_bytes()).hexdigest()
                for path in [motion_path, links_path, Path(__file__),
                             repo / 'scripts/diagnostics/FullscreenMotionWebKit.swift']}
html = '''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;background:#182029;color:white;font:16px -apple-system}
header{height:96px;background:#0007}button{min-height:44px}
ytm-header{position:fixed;inset:0 0 auto;height:48px;display:flex;align-items:center;justify-content:space-between;background:#111d;z-index:2147483647}
#movie_player{position:relative;width:100%;aspect-ratio:16/9;background:#245b38}
.html5-video-container,video{position:absolute;inset:0;width:100%;height:100%}
video{object-fit:contain;background:repeating-linear-gradient(45deg,#497793 0px,#497793 20px,#354461 20px,#354461 40px)}
#details{height:900px;padding:24px}#feed{position:fixed;left:0;top:0;width:100%;height:100%;border:0;z-index:10;visibility:hidden}
#feed[data-active]{visibility:visible}
</style></head><body><main><header><ytm-header>YouTube <button aria-label="Suchen">Suche im Watch</button></ytm-header></header><div id="movie_player"><div class="html5-video-container"><video class="html5-main-video" src="data:video/mp4;base64,"></video></div><button class="ytp-fullscreen-button">Vollbild</button></div><section id="details"><h1>Watch-Details</h1><button>Kommentare</button></section></main><iframe id="feed" title="Beibehaltener Feed"></iframe><script>
'''
setup = f'''
const sourceFingerprints={json.dumps(fingerprints)};
const motionSource={json.dumps(motion)},linksSource={json.dumps(links)};
const messages=[],errors=[],results=[],nativeTrace=[],mediaCalls=[],feedAcks=[];
addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const A='abcdefghijk',B='lmnopqrstuv';
const testLocation={{hostname:'m.youtube.com',pathname:'/watch',href:'https://m.youtube.com/watch?v='+A}};
function proxyWindow(real,location){{return new Proxy({{}},{{get(t,k){{if(Reflect.has(t,k))return Reflect.get(t,k);if(k==='location')return location;const value=Reflect.get(real,k);return typeof value==='function'?value.bind(real):value;}}}})}}
const testWindow=proxyWindow(window,testLocation),root=document.getElementById('movie_player'),video=root.querySelector('video'),container=video.parentElement,feedFrame=document.getElementById('feed'),header=document.querySelector('ytm-header'),details=document.getElementById('details');
let mediaID=A,feedWindow,feedDoc,pendingSearch=null,feedTicket=0,originalSearchClicks=0,searchApiCalls=0,nativeMode='expanded';
testWindow.__langformFullscreenEnterProtocol=1;testWindow.__langformFullscreenExitProtocol=1;
testWindow.__langformStageInsets={{top:0,right:0,bottom:0,left:0}};
Object.defineProperties(video,{{paused:{{value:false}},ended:{{value:false}},duration:{{value:120}},readyState:{{value:4}},currentTime:{{value:40,writable:true}},videoWidth:{{value:1920}},videoHeight:{{value:1080}},playbackRate:{{value:1,writable:true}}}});
root.getVideoData=()=>({{video_id:mediaID,title:'Ein sehr langer Videotitel zur Prüfung der gleichzeitig erreichbaren Vollbildsuche und Schließensteuerung ohne Überlappung'}});
video.play=()=>{{mediaCalls.push('play');throw Error('Unexpected direct play')}};video.pause=()=>{{mediaCalls.push('pause');throw Error('Unexpected direct pause')}};
function nativeBridge(value){{
 messages.push(JSON.parse(JSON.stringify(value)));nativeTrace.push({{event:'bridge',...value}});
 if(value.kind==='exit-request'){{pendingSearch=value.action==='search'?{{id:value.videoID,token:value.token,href:value.href}}:null;return}}
 if(value.kind==='exit-commit'){{
  const request=pendingSearch;pendingSearch=null;
  if(!request||request.id!==value.videoID||request.token!==value.token||request.href!==value.href)return;
  if(testLocation.href!==request.href||mediaID!==request.id)return;
  nativeMode='mini';feedFrame.setAttribute('data-active','');feedWindow.__langformFeedActive=true;
  const ticket=++feedTicket;searchApiCalls++;const accepted=feedWindow.__langformOpenSearch(ticket);
  nativeTrace.push({{event:'mock-native-feed-search',ticket,accepted,afterCommit:true}});return;
 }}
 if(value.open===false)pendingSearch=null;
}}
testWindow.webkit={{messageHandlers:{{langformFullscreen:{{postMessage:nativeBridge}}}}}};
new Function('window',motionSource)(testWindow);
'''
tests = r'''
function report(value){window.webkit.messageHandlers.qa.postMessage(value)}
function check(name,passed,extra={}){const row={name,passed,...extra};results.push(row);report(row)}
function rect(node){const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}
function painted(node){if(!node)return false;for(let n=node;n;n=n.parentElement){const css=n.ownerDocument.defaultView.getComputedStyle(n);if(css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0)return false}return true}
function hit(node){if(!node)return false;const r=rect(node),target=node.ownerDocument.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return target===node||node.contains(target)}
const ui=()=>document.getElementById('langform-fullscreen-ui');
async function frames(n){while(n--)await new Promise(requestAnimationFrame)}
async function until(test,label){for(let n=0;n<90;n++){if(test())return;await frames(1)}throw Error('condition timeout '+label)}
async function resize(width,height){report({resize:{width,height}});await until(()=>Math.abs(innerWidth-width)<1&&Math.abs(innerHeight-height)<1,'native resize');await frames(2)}
async function initFeed(){
 const ready=new Promise(resolve=>feedFrame.addEventListener('load',resolve,{once:true}));
 feedFrame.srcdoc='<!doctype html><html><head><style>html,body{margin:0;background:#21212b;color:white;font:16px -apple-system}ytm-header{position:fixed;inset:0 0 auto;height:48px;background:#101018;display:flex;justify-content:space-between;align-items:center}button{height:44px;width:88px}#feed-content{padding:64px 24px 0;height:1800px}ytm-searchbox{position:fixed;inset:52px 12px auto;background:#333;padding:12px}input{height:40px;width:90%}[hidden]{display:none!important}</style></head><body><ytm-header>Abos <button aria-label="Suchen" id="original-search">Suchen</button></ytm-header><section id="feed-content"><h1>Erhaltener Abos-Feed</h1><p>Dieser unabhängige Scrollstand bleibt erhalten.</p></section><ytm-searchbox id="original-search-ui" hidden><input name="search_query" aria-label="YouTube suchen"><button id="close-search">Schließen</button></ytm-searchbox></body></html>';
 await ready;const raw=feedFrame.contentWindow;feedDoc=raw.document;
 feedWindow=proxyWindow(raw,{hostname:'m.youtube.com',pathname:'/feed/subscriptions',href:'https://m.youtube.com/feed/subscriptions'});
 feedWindow.__langformFeedActive=false;feedWindow.webkit={messageHandlers:{langformOpenWatch:{postMessage:body=>nativeTrace.push({event:'unexpected-feed-watch',body})},langformFeedSearch:{postMessage:body=>feedAcks.push(JSON.parse(JSON.stringify(body)))}}};
 feedDoc.getElementById('original-search').addEventListener('click',()=>{originalSearchClicks++;const sheet=feedDoc.getElementById('original-search-ui');sheet.hidden=false;sheet.querySelector('input').focus({preventScroll:true})});
 feedDoc.getElementById('close-search').addEventListener('click',()=>{feedDoc.getElementById('original-search-ui').hidden=true;feedDoc.getElementById('original-search').focus({preventScroll:true})});
 new raw.Function('window',linksSource)(feedWindow);raw.scrollTo(0,360);await frames(2);
}
function deactivateFeed(){feedWindow.__langformFeedActive=false;feedWindow.__langformCancelSearch();feedWindow.dispatchEvent(new feedFrame.contentWindow.Event('langform-feed-visibility'));feedFrame.removeAttribute('data-active');nativeMode='expanded'}
async function enter(width=874,height=402){
 deactivateFeed();await resize(402,874);scrollTo(0,40);await frames(3);const baseline={scrollX,scrollY,root:rect(root),video:rect(video),feedScroll:feedFrame.contentWindow.scrollY};
 root.querySelector('button').click();const request=messages.filter(row=>row.kind==='enter-request').at(-1);if(!request)throw Error('missing enter request');
 testWindow.__langformFullscreen.prepareEnter(mediaID,request.token,width,height);await resize(width,height);testWindow.__langformFullscreen.finishEnter(mediaID,request.token,width,height);
 await until(()=>messages.some(row=>row.kind==='enter-commit'&&row.token===request.token),'enter commit');await frames(3);return baseline;
}
async function finishExit(request){
 const deadline=Date.now()+120;testWindow.__langformFullscreen.prepareExitMotion(request.videoID,request.token,402,874,deadline,Number(request.token)+100);
 testWindow.__langformFullscreen.prepareExit(request.videoID,request.token,402,874);await until(()=>messages.some(row=>row.kind==='exit-motion-ready'&&row.token===request.token),'exit ready');
 await resize(402,874);testWindow.__langformFullscreen.finishExit(request.videoID,request.token,402,874);
 await until(()=>!testWindow.__langformFullscreen.isOpen(),'exit commit');await frames(3);
}
function unchangedMedia(node,parent,src,time){return video===node&&video.parentElement===parent&&video.getAttribute('src')===src&&video.currentTime===time&&!video.paused&&mediaCalls.length===0}
(async()=>{
 await initFeed();const sameVideo=video,sameParent=container,source=video.getAttribute('src'),time=video.currentTime;
 check('real retained feed loaded shipping search API',typeof feedWindow.__langformOpenSearch==='function'&&feedFrame.contentWindow.scrollY===360);
 for(let cycle=1;cycle<=3;cycle++){
  const before=await enter(),button=ui().querySelector('[data-action=search]'),b=button&&rect(button),title=ui().querySelector('.lf-fs-title'),titleBox=rect(title),exit=ui().querySelector('[data-action=exit]');
  check('cycle '+cycle+' search 44px visible hittable and labelled',!!button&&painted(button)&&hit(button)&&b.width>=44&&b.height>=44&&button.getAttribute('aria-label')==='Suchen (Vollbild verlassen)',{button:b,title:titleBox});
  check('cycle '+cycle+' long title leaves both top controls reachable',hit(exit)&&titleBox.x+titleBox.width<=b.x+.5&&b.x+b.width<=innerWidth&&!!button.querySelector('svg path'));
  check('cycle '+cycle+' hidden YouTube header cannot intercept search',!painted(header)&&!hit(header.querySelector('button'))&&hit(button));
  if(cycle===1){report({snapshot:'fullscreen-search-visible'});await frames(15)}
  const previousClicks=originalSearchClicks,previousCalls=searchApiCalls,start=messages.length;
  button.click();const request=messages.slice(start).find(row=>row.kind==='exit-request');
  check('cycle '+cycle+' search requests one identity scoped exit',!!request&&request.action==='search'&&request.videoID===mediaID&&request.href===testLocation.href&&typeof request.token==='string'&&messages.slice(start).filter(row=>row.kind==='exit-request').length===1,{request});
  check('cycle '+cycle+' no feed action before matching exit commit',originalSearchClicks===previousClicks&&searchApiCalls===previousCalls&&!feedFrame.hasAttribute('data-active')&&nativeMode==='expanded'&&ui().hasAttribute('data-exiting'));
  button.click();check('cycle '+cycle+' duplicate exiting tap cannot duplicate search',messages.slice(start).filter(row=>row.kind==='exit-request').length===1&&searchApiCalls===previousCalls);
  report({snapshot:'search-cycle-'+cycle+'-exit-pending'});await frames(3);await finishExit(request);
  await until(()=>feedAcks.some(row=>row.ticket===feedTicket&&row.opened),'feed search acknowledgement');
  check('cycle '+cycle+' original YouTube search button opened once after commit',originalSearchClicks===previousClicks+1&&searchApiCalls===previousCalls+1&&!feedDoc.getElementById('original-search-ui').hidden&&feedDoc.activeElement===feedDoc.querySelector('input')&&nativeMode==='mini',{feedAcks:feedAcks.slice(-1)});
  check('cycle '+cycle+' live node time source playback and both scroll positions preserved',unchangedMedia(sameVideo,sameParent,source,time)&&scrollX===before.scrollX&&scrollY===before.scrollY&&feedFrame.contentWindow.scrollY===before.feedScroll,{watchBefore:before.scrollY,watchAfter:scrollY,feedBefore:before.feedScroll,feedAfter:feedFrame.contentWindow.scrollY});
  check('cycle '+cycle+' fullscreen cleanup restores normal author chrome',!ui()&&!document.querySelector('[inert]')&&painted(header)&&painted(details)&&!testWindow.__langformFullscreen.isOpen());
  report({snapshot:'search-cycle-'+cycle+'-feed-open'});await frames(3);feedDoc.getElementById('close-search').click();
  check('cycle '+cycle+' closing original search returns to retained feed',feedDoc.getElementById('original-search-ui').hidden&&feedFrame.hasAttribute('data-active')&&feedFrame.contentWindow.scrollY===before.feedScroll&&feedDoc.activeElement===feedDoc.getElementById('original-search'));
 }
 const clicks=originalSearchClicks,calls=searchApiCalls;
 await enter();ui().querySelector('[data-action=exit]').click();const normal=messages.filter(row=>row.kind==='exit-request').at(-1);await finishExit(normal);
 check('ordinary fullscreen exit commits without opening retained feed search',!('action' in normal)&&messages.some(row=>row.kind==='exit-commit'&&row.token===normal.token)&&originalSearchClicks===clicks&&searchApiCalls===calls&&nativeMode==='expanded'&&painted(header)&&!ui());
 await enter();const abandoned=ui().querySelector('[data-action=search]');abandoned.click();const cancelled=messages.filter(row=>row.kind==='exit-request').at(-1);testWindow.__langformFullscreen.exit(mediaID,'navigation',true);await frames(3);
 check('interrupted search exit cancels pending native mock intent',pendingSearch===null&&!ui()&&painted(header)&&originalSearchClicks===clicks&&searchApiCalls===calls);
 check('late callbacks from cancelled exit cannot reopen search',!testWindow.__langformFullscreen.prepareExit(cancelled.videoID,cancelled.token,402,874)&&!testWindow.__langformFullscreen.finishExit(cancelled.videoID,cancelled.token,402,874)&&originalSearchClicks===clicks);
 await resize(402,874);await enter();ui().querySelector('[data-action=search]').click();const stale=messages.filter(row=>row.kind==='exit-request').at(-1);dispatchEvent(new Event('yt-navigate-start'));mediaID=B;testLocation.href='https://m.youtube.com/watch?v='+B;dispatchEvent(new Event('video-data-change'));await frames(3);
 check('navigation to another video retires search UI and token',!ui()&&pendingSearch===null&&!testWindow.__langformFullscreen.finishExit(A,stale.token,402,874)&&originalSearchClicks===clicks&&searchApiCalls===calls);
 await resize(402,874);delete testWindow.__langformFullscreenExitProtocol;root.querySelector('button').click();const legacyEntry=messages.filter(row=>row.kind==='enter-request').at(-1);testWindow.__langformFullscreen.prepareEnter(B,legacyEntry.token,874,402);await resize(874,402);testWindow.__langformFullscreen.finishEnter(B,legacyEntry.token,874,402);await until(()=>messages.some(row=>row.kind==='enter-commit'&&row.token===legacyEntry.token),'legacy enter');
 check('unsupported exit protocol omits search instead of a dead button',!!ui()&&!ui().querySelector('[data-action=search]'));testWindow.__langformFullscreen.exit(B,'fixture-finished',true);
 testWindow.__langformFullscreenExitProtocol=1;
 await enter(402,874);const portraitButton=ui().querySelector('[data-action=search]'),portraitBox=rect(portraitButton),portraitTitle=rect(ui().querySelector('.lf-fs-title'));
 check('portrait fullscreen also keeps labelled 44px search and exit hittable',painted(portraitButton)&&hit(portraitButton)&&portraitBox.width>=44&&portraitBox.height>=44&&hit(ui().querySelector('[data-action=exit]'))&&portraitTitle.x+portraitTitle.width<=portraitBox.x+.5,{button:portraitBox,title:portraitTitle});
 report({snapshot:'portrait-fullscreen-search-visible'});await frames(15);
 testWindow.__langformFullscreen.exit(mediaID,'portrait-fixture-finished',true);await frames(2);
 check('all search paths preserve substituted media without play pause or reload',unchangedMedia(sameVideo,sameParent,source,time)&&nativeTrace.every(row=>row.event!=='unexpected-feed-watch'),{mediaCalls});
 report({nativeTrace,feedAcks,sourceFingerprints});report({finished:true,passed:errors.length===0&&results.every(row=>row.passed),count:results.length,errors,sourceFingerprints,engine:'macOS WKWebView real separate DOMs CSS/compositor events hit tests and original local search control; native coordination URL and media readiness/playback mocked',limitations:['No iPhone or simulator','No live YouTube API or search','Native token/mini coordinator is a mock; shipping Swift tested separately','Colored video has substituted state and is not live audio/video']});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack,messages,nativeTrace,sourceFingerprints,scroll:{watch:scrollY,feed:feedFrame.contentWindow&&feedFrame.contentWindow.scrollY}}));
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(html + setup + tests + '</script></body></html>')
print(args.output)
