#!/usr/bin/env python3
"""Real macOS WebKit hit tests using public YouTube CSS and shipping inset JS."""
import argparse
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--css',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args()
root=Path(__file__).resolve().parents[2]
source=(root/'ios/Langform/Langform/ViewportLayout.js').read_text()
css=a.css.read_text()
markup='''<button class="mobile-topbar-back-arrow" style="height:48px;width:48px">←</button><yt-searchbox class="ytSearchboxComponentHost ytSearchboxComponentMweb"><form class="ytSearchboxComponentSearchForm"><div class="ytSearchboxComponentInputContainer"><div class="ytSearchboxComponentInputBox"><input class="ytSearchboxComponentInput" name="search_query" placeholder="Search"></div></div><div class="ytSearchboxComponentSuggestionsContainer"><div style="height:48px">Previous search</div><div style="height:48px">Another search</div><div style="height:48px">Third search</div></div></form></yt-searchbox>'''
html='''<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>'''+css+'''</style><style>ytm-mobile-topbar-renderer{position:fixed}input[name=search_query]{min-width:40px}.ytSearchboxComponentSuggestionsContainer{background:white}</style><ytm-app></ytm-app><script>window.__langformStageInsets={top:62,right:0,bottom:34,left:0};</script><script>'''+source+'''</script><script>
var passed=true,count=0;function check(ok,name,detail){passed=passed&&!!ok;count++;window.webkit.messageHandlers.qa.postMessage({ok:!!ok,name,detail});}
var delay=ms=>new Promise(r=>setTimeout(r,ms));
var markup='''+repr(markup)+''';
async function run(){
for(var modern of [false,true]){
var app=document.querySelector('ytm-app');app.innerHTML=modern?'<div class="ytTopBarViewModelHost" data-mode="searching">'+markup+'</div>':'<ytm-mobile-topbar-renderer><div class="mobile-topbar-header" data-mode="searching">'+markup+'</div></ytm-mobile-topbar-renderer>';
await delay(50);
for(var top of [62,20,0]){
__langformSetStageInsets({top:top,right:0,bottom:34,left:0});await delay(30);
var input=app.querySelector('input'),panel=app.querySelector('.ytSearchboxComponentSuggestionsContainer'),r=input.getBoundingClientRect(),p=panel.getBoundingClientRect();
var hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),context={modern,top,inputY:r.y,inputBottom:r.bottom,inputWidth:r.width,panelY:p.y,hit:hit&&hit.tagName};
check(r.width>40&&r.height>8&&r.y>=top&&r.bottom<=p.y&&Math.abs(p.y-(top+48))<1&&hit===input,'input reachable above suggestions '+(modern?'modern':'legacy')+' inset '+top,context);
}
}
window.webkit.messageHandlers.qa.postMessage({finished:true,passed,checks:count});}
run().catch(e=>window.webkit.messageHandlers.qa.postMessage({finished:true,passed:false,error:String(e)}));
</script>'''
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(html)
