#!/usr/bin/env python3
"""Build the current feed motion script into an offline real-WebKit fixture.

Run the resulting HTML with CommentsMotionWebKit.swift. Native visibility and
Reduce Motion signals are simulated; layout, styles, mutation delivery, and
WAAPI interpolation use the browser. This is not live YouTube or iPhone QA.
"""
import argparse
import json
from pathlib import Path
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=Path(tempfile.gettempdir()) / 'langform-feed-surface-motion' / 'fixture.html')
parser.add_argument('--source', type=Path, help='Optional prior FeedMotion.js for a controlled before/after capture')
parser.add_argument('--capture', action='store_true', help='Freeze reproducible home/search/focus poses and request PNGs from FeedMotionWebKit.swift')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
motion = (args.source or (root / 'ios/Langform/Langform/FeedMotion.js')).read_text()
head = '''<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}html,body{margin:0;background:#101215;color:#f1f3f5;font:15px -apple-system}body{padding:18px 16px}
.searchbox-input-wrapper{display:block;padding:10px 14px;background:#20262e;border-radius:12px;margin:18px 0 14px}input{display:block;box-sizing:border-box;width:100%;padding:0;border:0;background:transparent;color:#fff;outline:none;font:16px -apple-system}.poster-link{display:block}.poster-link img{display:block;width:100%;height:155px;object-fit:cover;border-radius:13px}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}h1{font-size:22px;margin:0;letter-spacing:-.7px}header small{font-size:10px;color:#8192a6;letter-spacing:1.7px}
yt-chip{display:block}ytm-chip-cloud-chip-renderer{display:inline-block;transform-origin:center}button{border:0;border-radius:18px;padding:10px 16px;background:#d9f28c;color:#14230e;font:600 13px -apple-system}
#feed{display:grid;gap:18px;margin-top:18px}ytm-rich-item-renderer{display:block}ytm-video-with-context-renderer{display:block}.poster{height:155px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(145deg,#25384f,#735437);font-size:25px;font-weight:700;letter-spacing:-1px}.poster span{opacity:.75}a{color:inherit;text-decoration:none}h3{font-size:16px;margin:9px 0 3px}p{font-size:12px;color:#8b96a3;margin:0}
</style><header><h1>Langform</h1><small>WEBKIT / MOTION</small></header><ytm-chip-cloud-chip-renderer id="chip"><button id="filter">Neue Perspektiven</button></ytm-chip-cloud-chip-renderer><ytm-searchbox><form><div class="searchbox-input-wrapper" id="search-shell"><input type="search" name="search_query" id="query" placeholder="Raum für neue Gedanken" autocomplete="off"></div></form></ytm-searchbox><main id="feed"></main><script>
'''
setup = f'''
const results=[],errors=[],animations=[];
function report(value){{window.webkit.messageHandlers.qa.postMessage(value);}}
window.addEventListener('error',e=>{{errors.push(e.message);report({{error:e.message}});}});
window.addEventListener('unhandledrejection',e=>{{errors.push(String(e.reason));report({{error:String(e.reason)}});}});
const reduced=new EventTarget();reduced.matches=false;
const state={{__langformFeedActive:false}};
const testLocation={{hostname:'m.youtube.com',pathname:'/',href:'https://m.youtube.com/'}};
const captureOnly={json.dumps(args.capture)};
const testWindow=new Proxy(state,{{get(target,key){{
 if(Reflect.has(target,key))return target[key];
 if(key==='location')return testLocation;
 if(key==='webkit')return {{messageHandlers:{{langformOpenWatch:{{postMessage(){{}}}}}}}};
 if(key==='matchMedia')return ()=>reduced;
 const value=Reflect.get(window,key);return typeof value==='function'?value.bind(window):value;
}}}});
const originalAnimate=Element.prototype.animate;
Element.prototype.animate=function(frames,timing){{const animation=originalAnimate.call(this,frames,timing);animations.push({{node:this,animation,timing,frames}});return animation;}};
let geometryReads=0;
const originalRect=Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect=function(){{geometryReads++;return originalRect.call(this);}};
new Function('window',{json.dumps(motion)})(testWindow);
'''
tests = r'''
const feed=document.getElementById('feed'),chip=document.getElementById('chip'),button=document.getElementById('filter');
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function frame(){return new Promise(resolve=>requestAnimationFrame(resolve));}
function card(id){
 const node=document.createElement('ytm-rich-item-renderer');node.id=id;
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="740" height="310"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#25384f"/><stop offset="1" stop-color="#735437"/></linearGradient></defs><rect width="740" height="310" fill="url(#g)"/><circle cx="620" cy="210" r="150" fill="#889692" opacity=".14"/><text x="52" y="175" fill="#e0ded2" font-family="sans-serif" font-size="42" font-weight="700">Eine neue Perspektive</text></svg>';
 node.innerHTML='<ytm-video-with-context-renderer><a class="poster-link" href="/watch?v=abcdefghijk"><img src="data:image/svg+xml;base64,'+btoa(svg)+'"></a><h3>Gedanken, die bleiben · '+id+'</h3><p>Langform · 24 Minuten</p></ytm-video-with-context-renderer>';
 return node;
}
function visibility(value){state.__langformFeedActive=value;window.dispatchEvent(new Event('langform-feed-visibility'));}
function pointer(type,x=30){button.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,isPrimary:true,pointerId:1,clientX:x,clientY:30,button:0}));}
function pose(node){const style=getComputedStyle(node);const rect=originalRect.call(node);return {translate:style.translate,scale:style.scale,opacity:style.opacity,top:rect.top,width:rect.width,height:rect.height};}
function check(name,checks,detail={}){const result={name,checks,passed:Object.values(checks).every(Boolean),...detail};results.push(result);report(result);}
async function run(){
 const a=card('one'),b=card('two'),c=card('three'),d=card('below');feed.append(a,b,c,d);
 await wait(60);
 check('inactive feed is immediately readable',{noEffects:animations.length===0,noReads:geometryReads===0,readable:getComputedStyle(a).opacity==='1',noInlineDecoration:!a.hasAttribute('style')});
 const thumbnailRest=pose(a.querySelector("a"));
 visibility(true);
 const samples=[];
 for(let i=0;i<32;i++){await frame();samples.push({a:pose(a),b:pose(b),thumbnail:pose(a.querySelector("a")),title:pose(a.querySelector("h3"))});}
 await wait(120);
 const reveal=animations.filter(entry=>entry.node.matches('ytm-rich-item-renderer'));
 check('real compositor calm card settle',{
  bounded:reveal.length>0&&reveal.length<=3,
  translated:samples.some(s=>s.a.translate!=='none'&&parseFloat(s.a.translate.split(' ').at(-1))>0),
  readable:samples.every(s=>Number(s.a.opacity)>=.939&&Number(s.title.opacity)>=.939),
  thumbnailAligned:samples.every(s=>Math.abs(s.thumbnail.width-thumbnailRest.width)<.1),
  thumbnailHeightStable:samples.every(s=>Math.abs(s.thumbnail.height-thumbnailRest.height)<.1),
  titleAligned:samples.every(s=>s.title.translate==='none'),
  imagePressUntouched:a.querySelector('img').getAnimations().length===0,
  settles:pose(a).translate==='none'&&pose(a).opacity==='1'&&a.getAnimations().length===0,
  noOffscreenEffect:!animations.some(entry=>entry.node===d),
  noResidualStyle:!a.hasAttribute('style'),
  noCascade:reveal.every(entry=>!entry.timing.delay),
 },{sampleCount:samples.length,first:samples[0],middle:samples[5],last:samples.at(-1),animatedCards:reveal.map(entry=>entry.node.id)});
 const beforeHydration=animations.length,readsBeforeHydration=geometryReads;
 a.querySelector('h3').append(' · erweitert');await wait(40);
 check('hydrated inner renderer does not animate a second time',{noEffect:animations.length===beforeHydration,noGeometry:geometryReads===readsBeforeHydration});
 let clicks=0;button.addEventListener('click',()=>clicks++);
 pointer('pointerdown');await wait(45);
 const pressed=pose(chip);
 pointer('pointerup');button.click();await wait(35);
 const returning=pose(chip);
 pointer('pointerdown');await frame();const interrupted=pose(chip);
 pointer('pointercancel');await frame();
 check('press, calm return and interruption',{
  contracts:parseFloat(pressed.scale)<1&&parseFloat(pressed.scale)>=.979,
  returns:parseFloat(returning.scale)>.98&&parseFloat(returning.scale)<=1,
  interruptedContinuously:parseFloat(interrupted.scale)<=1,
  cancellationClears:chip.getAnimations().length===0&&pose(chip).scale==='none',
  originalClick:clicks===1,
 },{pressed,returning,interrupted});
 pointer('pointerdown');await wait(20);pointer('pointermove',42);await frame();
 check('scroll gesture wins over press',{settled:chip.getAnimations().length===0&&pose(chip).scale==='none'});
 window.dispatchEvent(new Event('scroll'));
 const momentum=card('during-scroll');feed.prepend(momentum);await wait(50);
 check('new results stay still during fast scrolling',{noEffect:!animations.some(entry=>entry.node===momentum),readable:pose(momentum).opacity==='1'});
 visibility(false);await wait(20);
 const asleepReads=geometryReads,asleepCount=animations.length;
 const hidden=card('hidden-mount');feed.prepend(hidden);await wait(60);
 check('covered feed makes no decoration work',{noReads:geometryReads===asleepReads,noEffects:animations.length===asleepCount});
 await wait(140);visibility(true);await frame();await frame();
 const resumed=animations.some(entry=>entry.node===hidden);
 visibility(false);await frame();
 check('resume once and yield to native player',{newCardRevealed:resumed,allCancelled:document.getAnimations().length===0,readable:pose(hidden).opacity==='1'});
 visibility(true);reduced.matches=true;reduced.dispatchEvent(new Event('change'));
 const reducedCard=card('reduce-motion');feed.prepend(reducedCard);pointer('pointerdown');await wait(60);
 check('simulated Reduce Motion skips decoration',{noAnimations:document.getAnimations().length===0,noReveal:!animations.some(entry=>entry.node===reducedCard),noPress:chip.getAnimations().length===0,readable:pose(reducedCard).opacity==='1'});
 reduced.matches=false;reduced.dispatchEvent(new Event('change'));pointer('pointercancel');await frame();await frame();
 window.dispatchEvent(new Event('yt-navigate-start'));testLocation.pathname='/results';
 const searchResult=card('search-result');feed.replaceChildren(searchResult);await wait(20);
 window.dispatchEvent(new Event('yt-navigate-finish'));await frame();await frame();
 const resultAnimation=animations.find(entry=>entry.node===searchResult);
 check('search results stay stationary as one surface',{stationary:resultAnimation&&resultAnimation.frames.every(frame=>frame.translate==='0px 0px'),onePart:animations.filter(entry=>searchResult===entry.node||searchResult.contains(entry.node)).length===1});
 await wait(450);
 const input=document.getElementById('query'),shell=document.getElementById('search-shell');
 const shellBefore=pose(shell);input.focus();await wait(80);const halo=document.getElementById('langform-search-focus-halo'),focusPose=pose(halo);
 const focused=animations.filter(entry=>entry.node===halo).length;
 input.value='Lange Gespräche';input.dispatchEvent(new Event('input',{bubbles:true}));await wait(400);
 check('stationary search focus edge',{stationary:focusPose.translate==='none'&&focusPose.scale==='none',halo:!!document.getElementById('langform-search-focus-halo'),realFocus:document.activeElement===input,noTypingAnimation:animations.filter(entry=>entry.node===halo).length===focused,settled:pose(halo).scale==='none',inputStable:pose(shell).scale==='none'&&pose(shell).translate==='none'&&pose(shell).width===shellBefore.width&&shell.getAnimations().length===0,hitTransparent:getComputedStyle(halo).pointerEvents==='none',valuePreserved:input.value==='Lange Gespräche'},{focusPose,shellBefore,shellAfter:pose(shell)});
 button.focus();await frame();check('focus halo leaves with focus',{released:!document.getElementById('langform-search-focus-halo')});
 // Deterministic large-feed and accessibility regressions. These use real
 // layout reads and focus events; the baseline --source run demonstrates the
 // previous budget/focus failures against the identical fixture.
 window.dispatchEvent(new Event('yt-navigate-start'));testLocation.pathname='/';
 const offscreen=document.createElement('section');offscreen.style.marginTop='3000px';
 for(let i=0;i<100;i++)offscreen.append(card('offscreen-'+i));
 feed.replaceChildren(offscreen);
 const offscreenReads=geometryReads;
 window.dispatchEvent(new Event('yt-navigate-finish'));await frame();await frame();
 const offscreenDelta=geometryReads-offscreenReads;
 check('offscreen hydration has a real layout-read ceiling',{bounded:offscreenDelta<=8,noEffects:document.getAnimations().length===0},{layoutReads:offscreenDelta,cards:100});
 window.dispatchEvent(new Event('yt-navigate-start'));
 const group=[card('group-one'),card('group-two'),card('group-three')];feed.replaceChildren(...group);
 window.dispatchEvent(new Event('yt-navigate-finish'));await frame();await frame();
 const cohortReads=geometryReads;
 const trailing=document.createElement('section');for(let i=0;i<40;i++)trailing.append(card('trailing-'+i));feed.append(trailing);
 await frame();await frame();
 const cohortDelta=geometryReads-cohortReads;
 check('a full entrance cohort does not measure another batch',{noWastedReads:cohortDelta===0},{layoutReads:cohortDelta,cards:40});
 window.dispatchEvent(new Event('yt-navigate-start'));
 const keyboardCard=card('keyboard-focus');feed.replaceChildren(keyboardCard);
 window.dispatchEvent(new Event('yt-navigate-finish'));await frame();await frame();
 const effectsBeforeFocus=keyboardCard.getAnimations({subtree:true}).length;
 const keyboardLink=keyboardCard.querySelector('a');keyboardLink.focus({preventScroll:true});
 const effectsAfterFocus=keyboardCard.getAnimations({subtree:true}).length;
 check('real keyboard focus settles the whole moving card',{wasAnimating:effectsBeforeFocus>0,focusRetained:document.activeElement===keyboardLink,noMovingTarget:effectsAfterFocus===0},{effectsBeforeFocus,effectsAfterFocus});
 window.dispatchEvent(new Event('yt-navigate-start'));
 const preFocused=card('focus-before-discovery');feed.replaceChildren(preFocused);
 const preFocusedLink=preFocused.querySelector('a');preFocusedLink.focus({preventScroll:true});
 window.dispatchEvent(new Event('yt-navigate-finish'));await frame();await frame();
 const queuedFocusEffects=preFocused.getAnimations({subtree:true}).length;
 check('a pre-focused link remains stationary through discovery',{focusRetained:document.activeElement===preFocusedLink,noEntrance:queuedFocusEffects===0},{effects:queuedFocusEffects});
 window.dispatchEvent(new Event('pagehide'));await frame();
 check('pagehide releases compositor effects',{noAnimations:document.getAnimations().length===0});
 check('no runtime errors',{noErrors:errors.length===0},{errors});
 report({finished:true,passed:results.every(result=>result.passed),cases:results.length,environment:'macOS WebKit offline fixture; native visibility and Reduce Motion signals simulated'});
}
async function snapshot(name){await new Promise(resolve=>{window.__qaSnapshotDone=resolve;report({snapshot:name});});}
async function capture(){
 const nodes=[card('Gedanken'),card('Gespräche'),card('Perspektiven')];feed.append(...nodes);
 await Promise.all([...feed.querySelectorAll('img')].map(img=>img.decode().catch(()=>{})));
 visibility(true);await frame();await frame();
 for(const entry of animations){entry.animation.pause();entry.animation.currentTime=70;}
 await frame();await snapshot('home-70ms');
 visibility(false);window.dispatchEvent(new Event('yt-navigate-start'));testLocation.pathname='/results';
 feed.replaceChildren(card('Suchergebnis 1'),card('Suchergebnis 2'),card('Suchergebnis 3'));
 await Promise.all([...feed.querySelectorAll('img')].map(img=>img.decode().catch(()=>{})));
 window.dispatchEvent(new Event('yt-navigate-finish'));visibility(true);await frame();await frame();
 for(const entry of animations){if(entry.animation.playState!=='idle'){entry.animation.pause();entry.animation.currentTime=70;}}
 await frame();await snapshot('search-70ms');
 for(const entry of animations){entry.animation.cancel();}
 document.getElementById('query').focus();await frame();
 for(const entry of animations){if(entry.animation.playState!=='idle'){entry.animation.pause();entry.animation.currentTime=90;}}
 await frame();await snapshot('focus-90ms');
 report({finished:true,passed:errors.length===0,captures:3});
}
(captureOnly?capture():run()).catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack}));
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(head + setup + tests + '</script></html>')
print(args.output)
