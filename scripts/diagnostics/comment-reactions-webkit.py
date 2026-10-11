#!/usr/bin/env python3
"""Offline WebKit checks for direct thumbs with the current player scripts.

Uses real DOM/CSS/hit testing and hash/history menu close. The YouTube server
action is a local fixture: no real comment or account is modified.
"""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--menu-control', action='store_true', help='Original three-dot menu; content tap expands replies')
parser.add_argument('--deferred-container', action='store_true', help='Native marker precedes sheet unhide/hydration')
parser.add_argument('--async-marker', action='store_true', help='Native markers and menu arrive after the original click')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
scripts = {name: (repo / 'ios/Langform/Langform' / name).read_text() for name in ['WebViewLinks.js', 'CommentsMotion.js', 'CommentReactions.js']}
markup = '''<ytm-engagement-panel-section-list-renderer class="comment-item-section"><div class="engagement-panel-section-list-background at-top"><div class="engagement-panel-container"><div class="engagement-panel-section-list-header-wrapper"><h2>Kommentare</h2></div><div class="engagement-panel-content-wrapper"><ytm-comments-header-renderer></ytm-comments-header-renderer><div id="comments"></div></div></div></div></ytm-engagement-panel-section-list-renderer>'''
html = '''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html{font-size:10px}html,body{margin:0;background:#151515;color:white;font-family:-apple-system,sans-serif}#video{height:226px;background:#233b30;display:grid;place-items:center;font-size:16px}h2{font-size:20px;margin:0;padding:18px}ytm-engagement-panel{position:fixed;top:226px;bottom:0;left:0;right:0}ytm-engagement-panel[hidden]{display:none}.engagement-panel-section-list-background,.engagement-panel-container{height:100%;display:flex;flex-direction:column}.engagement-panel-container{background:#222}.engagement-panel-content-wrapper{overflow-y:auto;flex:1;padding:0 16px}ytm-comments-header-renderer{display:block}button{font:inherit;background:none;border:0;color:inherit;padding:0}ytm-comment-renderer{display:flex;padding:4px 0;font-size:1.3rem}.avatar{width:32px;height:32px;flex-shrink:0;background:#536269;border-radius:50%;display:grid;place-items:center}.YtmCommentRendererContent{flex-grow:1;overflow:hidden;padding:0 8px;text-align:initial}.YtmCommentRendererHeader{display:flex;justify-content:space-between}.YtmCommentRendererTitle{font-size:1.2rem;color:#ddd}.YtmCommentRendererText{margin:4px 0;font-size:1.4rem;line-height:1.25}.YtmCommentRendererDetails{display:flex;align-items:center;font-size:1.1rem;color:#ddd}.YtmCommentRendererIcons{width:40px;height:36px;display:flex;justify-content:center;align-items:center}.YtmCommentRendererActionIcon{display:block;width:16px;height:16px}.YtmCommentRendererActionIcon[data-selected=true]{color:#5aa7ff}.YtmCommentRendererCount{margin-left:4px}.YtmCommentRendererActionIcon svg{width:100%;height:100%;fill:currentColor}bottom-sheet-container{position:fixed;inset:0;z-index:5;background:#0009;padding-top:550px}bottom-sheet-container[hidden]{display:none}.bottom-sheet-comment-menu-item{background:#333}.menu-item-button{display:block;width:100%;height:48px;font-size:16px}.close-button{position:absolute;top:0;left:0;width:12px;height:12px}
</style></head><body><div id="video">Video · lokale Bedienprüfung</div><ytm-engagement-panel>''' + markup + '''</ytm-engagement-panel><bottom-sheet-container hidden><div class="bottom-sheet-comment-menu-item"></div><button class="close-button" aria-label="Schließen"></button></bottom-sheet-container><script>'''
setup = f'''
const errors=[],commands=[],results=[];let activeRoot=null;const menuControl={json.dumps(args.menu_control)},deferredContainer={json.dumps(args.deferred_container)},asyncMarker={json.dumps(args.async_marker)};
addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const testLocation={{hostname:'m.youtube.com',get href(){{return 'https://m.youtube.com/watch?v=abcdefghijk'+location.hash}},get hash(){{return location.hash}},pathname:'/watch',protocol:'https:'}};
const handlers={{langformPlayer:{{postMessage(){{}}}},langformOverlayState:{{postMessage(){{}}}}}};
const testWindow=new Proxy({{}},{{get(t,k){{if(Reflect.has(t,k))return Reflect.get(t,k);if(k==='location')return testLocation;if(k==='webkit')return {{messageHandlers:handlers}};const v=Reflect.get(window,k);return typeof v==='function'?v.bind(window):v;}}}});
const panel=document.querySelector('ytm-engagement-panel'),menu=document.querySelector('bottom-sheet-container');
if(deferredContainer){{const other=document.createElement('bottom-sheet-container');other.hidden=true;other.innerHTML='<button>Fullscreen</button>';document.body.appendChild(other)}}
const thumb='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10h4v11H3zm6 11V10l5-8 2 1v6h5l1 2-3 10z"/></svg>';
function comment(id){{return `<ytm-comment-renderer id="${{id}}" class="YtmCommentRendererHost"><span class="avatar">A</span><button class="YtmCommentRendererContent"><div class="YtmCommentRendererHeader"><span class="YtmCommentRendererTitle">Autor ${{id}}</span></div><p class="YtmCommentRendererText">Direkte Reaktionen am Kommentar. Die Symbole und der Zähler zeigen den Zustand der Originalaktion.</p><div class="YtmCommentRendererDetails" aria-hidden="true"><div class="YtmCommentRendererIcons"><c3-icon class="YtmCommentRendererActionIcon" data-selected="false" data-disabled="false">${{thumb}}</c3-icon><span class="YtmCommentRendererCount">10</span></div><div class="YtmCommentRendererIcons"><c3-icon class="YtmCommentRendererActionIcon" data-selected="false" data-disabled="false" style="transform:rotate(180deg)">${{thumb}}</c3-icon></div><div class="YtmCommentRendererIcons">↩</div></div></button></ytm-comment-renderer>`}}
for(let i=0;i<15;i++)document.getElementById('comments').insertAdjacentHTML('beforeend',comment('comment-'+i));
function closeMenu(){{menu.hidden=true;document.body.removeAttribute('bottom-sheet-open');panel.inert=false;panel.removeAttribute('aria-hidden');(activeRoot?.querySelector('button.YtmCommentRendererMenu') || activeRoot?.querySelector('.YtmCommentRendererContent'))?.focus()}}
addEventListener('hashchange',()=>{{if(location.hash!=='#bottom-sheet')closeMenu()}});
menu.querySelector('.close-button').onclick=()=>history.back();
function wire(root){{const content=root.querySelector('.YtmCommentRendererContent');const openMenu=()=>{{
 const begin=()=>{{activeRoot=root;location.hash='bottom-sheet';document.body.setAttribute('bottom-sheet-open','');panel.inert=true;panel.setAttribute('aria-hidden','true');
 const hydrate=()=>{{menu.hidden=false;
 const holder=menu.querySelector('.bottom-sheet-comment-menu-item');holder.replaceChildren();
 for(const index of [0,1]){{const renderer=document.createElement('ytm-toggle-menu-service-item-renderer'),button=document.createElement('button');button.className='menu-item-button';button.textContent=index?(root.querySelectorAll('.YtmCommentRendererActionIcon')[index].getAttribute('data-selected')==='true'?'Dislike entfernen':'Mag ich nicht'):'Mag ich';
  button.onclick=()=>{{commands.push([root.id,index]);setTimeout(()=>{{const icons=root.querySelectorAll('.YtmCommentRendererActionIcon'),before=icons[index].getAttribute('data-selected')==='true';icons.forEach((icon,i)=>icon.setAttribute('data-selected',String(i===index&&!before)));root.querySelector('.YtmCommentRendererCount').textContent=index===0&&!before?'11':'10';}},80)}};
  renderer.appendChild(button);holder.appendChild(renderer);
 }}
 }};if(deferredContainer)setTimeout(hydrate,80);else hydrate();}};if(asyncMarker)setTimeout(begin,80);else begin();
}};if(menuControl){{const opener=document.createElement('button');opener.className='YtmCommentRendererMenu';opener.textContent='⋮';content.querySelector('.YtmCommentRendererDetails').appendChild(opener);content.onclick=()=>root.setAttribute('data-replies-open','true');opener.onclick=event=>{{event.stopPropagation();openMenu()}}}}else content.onclick=openMenu;}}
document.querySelectorAll('ytm-comment-renderer').forEach(wire);
'''
for name, source in scripts.items():
    setup += '\nnew Function("window",' + json.dumps(source) + ')(testWindow);\n'
setup += '\nconst sourceSHA256=' + json.dumps({name: hashlib.sha256(source.encode()).hexdigest() for name, source in scripts.items()}) + ';\n'
tests = r'''
function report(value){window.webkit.messageHandlers.qa.postMessage(value)}
function check(name,passed,details={}){const row={name,passed,...details};results.push(row);report(row);if(!passed)throw Error(name)}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function frames(n){while(n--)await new Promise(requestAnimationFrame)}
const button=(root,index)=>root.querySelectorAll('[data-langform-comment-reaction]')[index];
function hit(root,index){const target=button(root,index),r=target.getBoundingClientRect(),slot=root.querySelectorAll('.YtmCommentRendererIcons')[index].getBoundingClientRect();return {correct:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===target,size:r.width>=44&&r.height>=44,aligned:Math.max(Math.abs(r.x-slot.x),Math.abs(r.y-slot.y),Math.abs(r.width-slot.width),Math.abs(r.height-slot.height))<.6,buttonRect:{x:r.x,y:r.y,width:r.width,height:r.height},slotRect:{x:slot.x,y:slot.y,width:slot.width,height:slot.height}}}
(async()=>{
 await frames(5);const root=document.getElementById('comment-0');
 check('two independent accessible buttons outside source comment button',root.querySelectorAll('[data-langform-comment-reaction]').length===2&&!button(root,0).closest('.YtmCommentRendererContent'));
 for(const index of [0,1]){const geometry=hit(root,index);check('initial thumb hit target '+index,geometry.correct&&geometry.size&&geometry.aligned,{geometry})}
 const before=commands.length;button(root,0).click();button(root,0).click();await wait(250);await frames(3);
 check('one original like despite immediate double click',commands.length===before+1&&commands.at(-1)[0]===root.id&&commands.at(-1)[1]===0);
 check('thumb activation never expands replies',!root.hasAttribute('data-replies-open'));
 check('original async state and count reflected',button(root,0).getAttribute('aria-pressed')==='true'&&root.querySelector('.YtmCommentRendererCount').textContent==='11');
 check('original history close restored comments and focus',menu.hidden&&!panel.inert&&!panel.hasAttribute('aria-hidden')&&document.activeElement===button(root,0));
 check('no menu mask or busy state left',!document.querySelector('[data-langform-comment-direct-menu]')&&!button(root,0).disabled);
 button(root,0).click();await wait(250);await frames(3);check('like removed by original action',button(root,0).getAttribute('aria-pressed')==='false');
 button(root,1).click();await wait(250);await frames(3);check('dislike selected directly',button(root,1).getAttribute('aria-pressed')==='true'&&commands.at(-1)[1]===1);
 button(root,1).click();await wait(250);await frames(3);check('dislike removed by original action',button(root,1).getAttribute('aria-pressed')==='false');
 const scroll=panel.querySelector('.engagement-panel-content-wrapper');scroll.scrollTop=300;await frames(3);const other=document.getElementById('comment-4');
 for(const index of [0,1]){const geometry=hit(other,index);check('thumb hit target retained after real list scroll '+index,geometry.correct&&geometry.size&&geometry.aligned,{geometry})}
 button(other,1).click();await wait(250);await frames(3);check('scrolled comment owns its action',commands.at(-1)[0]===other.id&&button(other,1).getAttribute('aria-pressed')==='true');
 scroll.scrollTop=0;const content=root.querySelector('.YtmCommentRendererText');content.textContent+=' More text added by hydration. More text added by hydration. More text added by hydration.';await frames(5);
 const geometry=hit(root,0);check('resize observer follows multiline text hydration',geometry.correct&&geometry.aligned,{geometry});
 panel.hidden=true;await frames(3);panel.hidden=false;await frames(5);check('reopened comments retain exactly two controls',root.querySelectorAll('[data-langform-comment-reaction]').length===2&&hit(root,0).correct);
 button(root,0).click();await wait(250);await frames(3);report({snapshot:'direct-buttons'});await wait(200);
 check('no uncaught script errors',errors.length===0,{errors});
 report({finished:true,passed:results.every(row=>row.passed),count:results.length,commands,sourceSHA256,engine:'macOS WKWebView with real DOM, CSS, hit testing, scrolling and hash/history; local reaction actions'});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack,sourceSHA256}));
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(html + setup + tests + '</script></body></html>')
print(args.output)
