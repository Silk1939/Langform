#!/usr/bin/env python3
"""Offline real-WebKit DOM/CSS checks; uses Reduce Motion, never claims finger/FPS parity."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--safe-top', type=int, default=0, help='Native top inset supplied to the real WebKit fixture')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
sources = {name: (root / 'ios/Langform/Langform' / name).read_text() for name in ['WebViewLinks.js', 'CommentsMotion.js', 'CommunityPosts.js']}
head = '''<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{height:100%;margin:0;background:#171717;color:white;font:16px -apple-system;overflow:hidden}panel-container{display:block}ytm-engagement-panel{position:fixed;inset:274px 0 0;z-index:4}ytm-engagement-panel[hidden]{display:none}ytm-engagement-panel-section-list-renderer{display:flex;flex-direction:column;height:100%;overflow-y:auto}.engagement-panel-section-list-background{display:flex;flex-direction:column;flex-grow:1;height:100%;background:transparent;z-index:4}.engagement-panel-section-list-background.at-top{overflow-y:auto}.engagement-panel-container{background:#222;flex-grow:1;display:flex;flex-direction:column;overflow:hidden}.engagement-panel-section-list-header-wrapper{padding:0 16px}.engagement-panel-section-list-header{display:flex;align-items:center;justify-content:space-between}h2{font-size:20px}.engagement-panel-content-wrapper{flex:1;overflow-y:auto;min-height:0;padding:0 16px}button{width:44px;height:44px}ytm-backstage-post-renderer{display:block;background:#303030;padding:16px}.post-text{max-height:42px;overflow:hidden;-webkit-line-clamp:2}
</style><main></main><panel-container></panel-container><script>'''
setup = '''
const errors=[],results=[];function report(value){window.webkit.messageHandlers.qa.postMessage(value)};
window.addEventListener('error',event=>errors.push(event.message));
const handlers={langformPlayer:{postMessage(){}},langformOverlayState:{postMessage(){}}};
const testLocation={hostname:'m.youtube.com',href:'https://m.youtube.com/watch?v=abcdefghijk',pathname:'/watch',protocol:'https:'};
// Keep live browser APIs, including CSS/layout/event dispatch. Only the app
// bridges, HTTPS app location and Reduce Motion preference are fixture inputs.
const reduced={matches:true,addEventListener(){}};
const testWindow=new Proxy({__langformRealVisibility:{inactive(){return false}}},{get(target,key){if(Reflect.has(target,key))return Reflect.get(target,key);if(key==='location')return testLocation;if(key==='webkit')return{messageHandlers:handlers};if(key==='matchMedia')return()=>reduced;const value=Reflect.get(window,key);return typeof value==='function'?value.bind(window):value;}});
'''
setup += '\n'.join('new Function("window",' + json.dumps(value) + ')(testWindow);' for value in sources.values())
setup += '\ntestWindow.__langformStageInsets={top:' + str(args.safe_top) + '};\n'
tests = r'''
function check(name,condition,detail){results.push({name,passed:!!condition,detail});if(!condition)report(results.at(-1));}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function pointer(target,type,y,x=100,id=1){const event=new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',isPrimary:true,button:0,clientX:x,clientY:y});target.dispatchEvent(event);return event;}
function drag(target,from,to){pointer(target,'pointerdown',from);const move=pointer(target,'pointermove',to);pointer(target,'pointerup',to);return move;}
const markup='<ytm-engagement-panel-section-list-renderer class="comment-item-section"><div class="engagement-panel-section-list-background draggable at-top"><div class="engagement-panel-container" style="height:100%;transform:translateY(0px)"><div class="engagement-panel-section-list-header-wrapper"><div class="engagement-panel-section-list-header"><h2>Kommentare</h2><ytm-button-renderer class="engagement-panel-section-list-header-button close-button"><button>×</button></ytm-button-renderer></div></div><div class="engagement-panel-content-wrapper"><ytm-comments-header-renderer></ytm-comments-header-renderer><div id="long" style="height:1800px;flex-shrink:0">Originale Kommentare mit Like und Antwort</div><button id="reply">Antworten</button><textarea></textarea></div></div></div></ytm-engagement-panel-section-list-renderer>';
(async()=>{
 const panel=document.createElement('ytm-engagement-panel');panel.innerHTML=markup;document.querySelector('panel-container').append(panel);await wait(35);
 const surface=panel.querySelector('.engagement-panel-container'),header=panel.querySelector('h2'),body=panel.querySelector('.engagement-panel-content-wrapper'),background=panel.querySelector('.engagement-panel-section-list-background'),close=panel.querySelector('.close-button button');
 const before=surface.getBoundingClientRect(),original=surface.style.cssText;
 const handle=panel.querySelector('[data-langform-comments-handle]'),hr=handle?.getBoundingClientRect();
 check('sichtbarer zentrierter Handle',!!hr&&hr.width===36&&hr.height===5&&Math.abs(hr.left+hr.width/2-innerWidth/2)<1,hr&&{left:hr.left,width:hr.width,height:hr.height});
 close.focus();pointer(header,'pointerdown',300);const move=pointer(header,'pointermove',354);const during=surface.getBoundingClientRect();
 check('Fingertranslation bleibt exakt',move.defaultPrevented&&Math.abs(during.top-before.top-54)<.2,{before:before.top,during:during.top});
 pointer(header,'pointerup',354);check('Reduce Motion sofortiger Snap',Math.abs(surface.getBoundingClientRect().top-before.top)<.2&&surface.getAnimations().length===0);
 check('Originaltransform und Höhe wiederhergestellt',surface.style.cssText===original);
 drag(header,320,100);const expanded=surface.getBoundingClientRect();
 const expandedTop=testWindow.__langformStageInsets.top+12;
 check('Aufwärtsdrag erweitert bis Safe Top',Math.abs(expanded.top-expandedTop)<.2,{top:expanded.top,bottom:expanded.bottom,height:expanded.height});
 check('Unterkante ohne Lücke',Math.abs(expanded.bottom-innerHeight)<.2,{bottom:expanded.bottom,viewport:innerHeight});
 check('erweiterter Header tatsächlich hit-testbar',surface.contains(document.elementFromPoint(innerWidth/2,expandedTop+18)));
 check('YouTubes Transform und Inhalt erhalten',surface.style.transform==='translateY(0px)'&&panel.querySelector('#reply')?.textContent==='Antworten');
 body.scrollTop=100;const scroll=body.scrollTop;const scrollMove=drag(body,400,610);check('gescrollte Liste behält Ownership',scroll===100&&body.scrollTop===100&&!scrollMove.defaultPrevented);body.scrollTop=0;
 const input=panel.querySelector('textarea');input.focus();const inputMove=drag(header,300,600);check('aktive Eingabe behält Fokus und Tastatur',document.activeElement===input&&!inputMove.defaultPrevented);input.blur();
 testWindow.visualViewport?.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('resize'));check('Resize räumt Expandedstyles auf',surface.style.cssText===original&&!background.hasAttribute('data-langform-comments-interactive'));
 let closes=0;close.addEventListener('click',()=>{closes++;panel.remove()});drag(header,300,580);await wait(20);check('Dismiss genau einmal im Originalpfad',closes===1&&!panel.isConnected);
 check('Overlay bleibt bis zur echten Entfernung gesperrt',!testWindow.__langformHasOpenOverlay());
 const feed=document.querySelector('main');feed.innerHTML='<ytm-backstage-post-renderer><ytm-text-expander><div class="post-text">Vollständiger Originaltext</div><button class="text-expander-button" aria-expanded="false">Mehr lesen</button></ytm-text-expander><a id="channel" href="/@Creator">Kanal</a><a id="post" href="/post/UgkxABC">Kommentare</a></ytm-backstage-post-renderer>';
 const card=feed.firstElementChild;let expands=0,opens=0;card.querySelector('button').addEventListener('click',event=>{event.preventDefault();expands++});card.querySelector('#post').addEventListener('click',event=>{event.preventDefault();opens++});
 card.querySelector('.post-text').click();check('Posttap nutzt originale Expansion',expands===1&&opens===0);
 card.querySelector('button').remove();card.querySelector('.post-text').click();check('Detail nutzt originalen Postlink',opens===1);
 card.querySelector('#channel').addEventListener('click',event=>event.preventDefault());card.querySelector('#channel').click();check('Kanallink unabhängig',opens===1&&expands===1);
 card.querySelector('#post').remove();card.querySelector('.post-text').click();const css=getComputedStyle(card.querySelector('.post-text'));check('fehlender Originalexpander zeigt vorhandenen Volltext',css.maxHeight==='none'&&css.overflow==='visible');
 check('keine Skriptfehler',errors.length===0,errors);
 report({finished:true,mode:'reduced-motion-dom-css',actualDocumentVisibility:document.visibilityState,passed:results.every(r=>r.passed),checks:results,errors});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack}));
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(head + setup + tests + '</script>')
print(args.output.resolve())
