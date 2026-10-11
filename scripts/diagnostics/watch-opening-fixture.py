#!/usr/bin/env python3
"""Offline compositor checks for the shipping opening; no iPhone/network."""
import argparse
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--output',required=True,type=Path);a=p.parse_args()
root=Path(__file__).resolve().parents[2]
source=(root/'ios/Langform/Langform/WatchOpening.js').read_text()
a.output.parent.mkdir(parents=True,exist_ok=True)
html="""<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>body{margin:0;background:white}ytm-app{display:block}.card{margin-top:360px}img{width:402px;height:226px}ytm-pivot-bar-renderer{position:fixed;bottom:0;height:48px;width:100%;background:#eee}</style><ytm-app><div class=card><img id=thumb src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360'%3E%3Crect width='640' height='360' fill='%23226ab9'/%3E%3C/svg%3E"></div><ytm-pivot-bar-renderer>Tabs</ytm-pivot-bar-renderer></ytm-app><script>window.__langformStageInsets={top:62};var messages=[];window.webkit.messageHandlers.langformOpening={postMessage:x=>messages.push(x)};var reduce=false,realMedia=window.matchMedia;window.matchMedia=q=>q.includes('reduced-motion')?{get matches(){return reduce},addEventListener(){}}:realMedia(q);</script><script>"""+source+"""</script><script>
var passed=true,count=0;function check(ok,name,detail){passed=passed&&!!ok;count++;window.webkit.messageHandlers.qa.postMessage({ok:!!ok,name,detail:detail||null});}
var delay=ms=>new Promise(r=>setTimeout(r,ms)), frame=()=>new Promise(r=>requestAnimationFrame(r));
async function run(){var img=document.getElementById('thumb');await img.decode();await frame();var before=img.getBoundingClientRect();
var t=__langformBeginWatchOpening(img,'https://m.youtube.com/watch?v=abcdefghijk');
check(!!t&&!!document.getElementById('langform-watch-opening'),'immediate surface without native or network');
await delay(80);var s=__langformWatchOpeningControl('status',t);check(s.rect.y<before.y-20&&s.rect.y>105,'spring moves before data',s);
await delay(400);s=__langformWatchOpeningControl('status',t);check(s.landed&&Math.abs(s.rect.y-110)<1&&Math.abs(s.rect.width-402)<1,'one stable target',s);
check(document.querySelector('.lf-opening-picture img').currentSrc===img.currentSrc,'identical decoded asset held after landing');
__langformWatchOpeningControl('ready',t);await delay(200);check(getComputedStyle(document.querySelector('.lf-opening-wash')).opacity==='0','details uncover independently of held poster');
__langformWatchOpeningControl('finish',t);check(!document.getElementById('langform-watch-opening')&&!img.hasAttribute('data-lf-opening-origin'),'handoff restores source');
t=__langformBeginWatchOpening(img,'https://m.youtube.com/watch?v=abcdefghijk');await delay(110);var p=__langformWatchOpeningControl('status',t).rect;
var wash=document.querySelector('.lf-opening-wash'), washBefore=Number(getComputedStyle(wash).opacity);
__langformWatchOpeningControl('reverse',t);var washAfter=Number(getComputedStyle(wash).opacity);
check(Math.abs(washBefore-washAfter)<.02,'background reversal keeps displayed opacity',{before:washBefore,after:washAfter});
await frame();var p2=__langformWatchOpeningControl('status',t).rect;
check(Math.abs(p.y-p2.y)<18,'reverse starts at displayed position',{before:p,after:p2});await delay(370);
check(!document.getElementById('langform-watch-opening')&&messages.some(x=>x.token===t&&x.kind==='cancelled'),'reverse completes and returns source');
var old=__langformBeginWatchOpening(img,'https://m.youtube.com/watch?v=abcdefghijk');await delay(70);
var next=__langformBeginWatchOpening(img,'https://m.youtube.com/watch?v=lmnopqrstuv');
check(__langformWatchOpeningControl('finish',old)===false,'stale completion cannot clear replacement');await delay(450);
check(__langformWatchOpeningControl('status',next).landed,'replacement owns landing');__langformWatchOpeningControl('discard',next);
reduce=true;t=__langformBeginWatchOpening(img,'https://m.youtube.com/watch?v=abcdefghijk');await frame();s=__langformWatchOpeningControl('status',t);
check(Math.abs(s.rect.y-110)<1,'reduced motion uses destination dissolve');await delay(190);check(__langformWatchOpeningControl('status',t).landed,'reduced motion reaches landing');
__langformWatchOpeningControl('reverse',t);check(!!document.getElementById('langform-watch-opening'),'reduced reversal keeps surface during dissolve');await delay(190);check(!document.getElementById('langform-watch-opening'),'reduced reversal removes surface after dissolve');
check(window.scrollY===0,'source scroll position preserved');
window.webkit.messageHandlers.qa.postMessage({finished:true,passed,checks:count});}
run().catch(e=>window.webkit.messageHandlers.qa.postMessage({finished:true,passed:false,error:String(e)}));
</script>"""
a.output.write_text(html)
