#!/usr/bin/env python3
"""Exercise feed filtering and paint readiness in real offline macOS WebKit.

YouTube's visible-sentinel callback shape is modeled with IntersectionObserver;
this does not fetch YouTube data or claim live iPhone pagination verification.
"""
import argparse
import json
from pathlib import Path
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=Path(tempfile.gettempdir()) / 'langform-feed-search-20261009' / 'continuation.html')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
js = '\n'.join((root / 'extension/src' / (name + '.js')).read_text() for name in ['logic', 'early', 'hide'])
feed = (root / 'ios/Langform/Langform/FeedMotion.js').read_text()
head = '''<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}html,body{margin:0;background:#101215;color:#f1f3f5;font:16px -apple-system}main{padding:16px}ytm-rich-item-renderer,ytm-rich-section-renderer,ytm-reel-shelf-renderer,ytm-video-with-context-renderer{display:block}ytm-rich-item-renderer{height:200px;padding:20px;background:#222;margin-bottom:12px}ytm-continuation-item-renderer{display:block;height:32px;background:#555}a{color:inherit}ytm-message-renderer{display:block;min-height:40px}#spacer{height:1800px}</style><main id="feed"></main><script>'''
setup = r'''
const cases=[],errors=[],ready=[];
const rootFeed=document.getElementById('feed');
function report(value){webkit.messageHandlers.qa.postMessage(value);}
window.addEventListener('error',event=>{errors.push(event.message);report({error:event.message});});
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function frame(){return new Promise(resolve=>requestAnimationFrame(resolve));}
function check(name,checks,details={}){const result={name,checks,passed:Object.values(checks).every(Boolean),...details};cases.push(result);report(result);}
const state={__langformFeedActive:false};
const locationState={hostname:'m.youtube.com',pathname:'/',href:'https://m.youtube.com/'};
const testWindow=new Proxy(state,{get(target,key){
 if(Reflect.has(target,key))return target[key];
 if(key==='location')return locationState;
 if(key==='webkit')return {messageHandlers:{langformFeedReady:{postMessage(message){ready.push(message);}}}};
 const value=Reflect.get(window,key);return typeof value==='function'?value.bind(window):value;
}});
'''
run = r'''
function thumbnailMarkup(){return '<img style="display:block;width:100%;height:110px;object-fit:cover" src="data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225"><rect width="400" height="225" fill="#386d94"/></svg>')+'">';}
function card(short,id){const node=document.createElement('ytm-rich-item-renderer');node.id=id;node.innerHTML='<a href="/'+(short?'shorts/abcdefghijk':'watch?v=abcdefghijk')+'">'+thumbnailMarkup()+(short?'Short':'A long video')+'</a>';return node;}
function navigate(){window.dispatchEvent(new Event('yt-navigate-start'));rootFeed.replaceChildren();window.scrollTo(0,0);}
function finish(){window.dispatchEvent(new Event('yt-navigate-finish'));}
async function continuationCase(nested){
 navigate();
 const spacer=document.createElement('div');spacer.id='spacer';
 const section=document.createElement('ytm-rich-section-renderer');
 const shelf=document.createElement('ytm-reel-shelf-renderer');
 const shorts=[card(true,'short-one'),card(true,'short-two')];shelf.append(...shorts);
 const sentinel=document.createElement('ytm-continuation-item-renderer');sentinel.textContent='Loading';
 if(nested)shelf.append(sentinel);section.append(shelf);if(!nested)section.append(sentinel);
 rootFeed.append(spacer,section);finish();
 let callbackCount=0,next=null;
 const observer=new IntersectionObserver(entries=>{
  entries.filter(entry=>entry.intersectionRect.height>0).forEach(()=>{callbackCount++;observer.disconnect();next=card(false,'next-page');section.insertBefore(next,section.firstChild);ShortsAusblenden.hide.scan(rootFeed,'https://m.youtube.com/');});
 },{rootMargin:'10%',threshold:.01});
 observer.observe(sentinel);
 ShortsAusblenden.hide.ensureStyle(document);ShortsAusblenden.hide.scan(rootFeed,'https://m.youtube.com/');
 await wait(80);const before=sentinel.getBoundingClientRect();
 window.scrollTo(0,document.documentElement.scrollHeight);await wait(180);
 check(nested?'pagination inside shelf survives':'pagination beside shelf survives',{
  connected:sentinel.isConnected&&section.isConnected,
  nativeHeight:before.height>0,
  shortsRemoved:!shorts.some(node=>node.isConnected),
  observerLoads:callbackCount===1,
  nextPageVisible:next&&next.isConnected&&getComputedStyle(next).display!=='none',
 },{beforeHeight:before.height,callbackCount});
 observer.disconnect();
}
async function readinessCases(){
 navigate();rootFeed.innerHTML='<ytm-loading-renderer>Loading</ytm-loading-renderer><ytm-continuation-item-renderer>Loading more</ytm-continuation-item-renderer>';
 const count=ready.length;finish();await wait(80);
 check('spinner and continuation cannot release a refresh snapshot',{notReady:ready.length===count});
 const real=card(false,'ready-video');rootFeed.prepend(real);await wait(100);
 check('rendered feed releases the snapshot with document identity',{oneReport:ready.length===count+1,correctIdentity:ready.at(-1)?.documentToken===String(performance.timeOrigin),correctURL:ready.at(-1)?.href==='https://m.youtube.com/',globalIdentity:state.__langformFeedDocumentToken===String(performance.timeOrigin)});
 real.append(document.createTextNode(' · hydrated'));await wait(80);
 check('hydration does not duplicate readiness',{oneReport:ready.length===count+1});
 navigate();rootFeed.innerHTML='<section hidden id="hidden"><ytm-video-with-context-renderer><a href="/watch?v=abcdefghijk">'+thumbnailMarkup()+'Hidden video</a></ytm-video-with-context-renderer></section>';finish();
 const hiddenCount=ready.length;await wait(100);
 check('a hidden renderer keeps the snapshot',{notReady:ready.length===hiddenCount});
 document.getElementById('hidden').hidden=false;await wait(100);
 check('unhiding actual content releases it',{ready:ready.length===hiddenCount+1});
 navigate();rootFeed.innerHTML='<ytm-message-renderer>No videos found</ytm-message-renderer>';finish();const emptyCount=ready.length;await wait(100);
 check('explicit empty feed releases the snapshot',{ready:ready.length===emptyCount+1});
}
(async()=>{
 await continuationCase(false);await continuationCase(true);
 await readinessCases();
 navigate();const waiting=card(false,'waiting-thumbnail');const image=waiting.querySelector('img'),realSource=image.src;image.removeAttribute('src');rootFeed.append(waiting);finish();
 const waitingCount=ready.length;await wait(80);
 check('a hydrated link with no thumbnail source keeps the retained feed',{notReady:ready.length===waitingCount});
 image.src=realSource;await image.decode();await wait(80);
 check('actual bitmap decode releases the retained feed',{ready:ready.length===waitingCount+1});
 navigate();const moving=card(false,'moving-row');rootFeed.append(moving);await moving.querySelector('img').decode();const movingCount=ready.length;finish();
 for(let i=1;i<=5;i++){moving.style.marginTop=(i*7)+'px';await frame();}
 check('layout hydration postpones readiness',{notReady:ready.length===movingCount});
 await frame();await frame();await frame();
 check('two stable native geometry frames release it',{ready:ready.length===movingCount+1});
 window.dispatchEvent(new Event('pagehide'));
 check('no runtime errors',{noErrors:errors.length===0},{errors});
 report({finished:true,passed:cases.every(result=>result.passed),cases:cases.length,environment:'offline macOS WebKit; actual layout/CSS/IntersectionObserver, modeled YouTube pagination callback'});
})();
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(head + setup + '\n' + js + '\nnew Function("window",' + json.dumps(feed) + ')(testWindow);\n' + run + '</script></html>')
print(args.output)
