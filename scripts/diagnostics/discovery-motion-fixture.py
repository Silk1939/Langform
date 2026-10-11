#!/usr/bin/env python3
"""Build the offline discovery-motion WebKit fixture from the current iPhone source."""

import argparse
import json
from pathlib import Path
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--output",
    type=Path,
    default=Path(tempfile.gettempdir()) / "langform-discovery-motion" / "fixture.html",
    help="HTML output path (default: %(default)s)",
)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
source = (root / "ios/Langform/Langform/DiscoveryMenu.js").read_text(encoding="utf-8")
html='''<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#0f0f0f;color:#fff;font:16px -apple-system}ytm-app,ytm-header,ytm-browse{display:block}ytm-header{height:52px}ytm-browse{height:1800px;background:#292929}#result{white-space:pre-wrap}</style><ytm-app><ytm-header>Langform</ytm-header><ytm-browse>Feed</ytm-browse></ytm-app><script>'''
setup='''
const errors=[];window.addEventListener('error',e=>errors.push(e.message));
const locationMock={hostname:'m.youtube.com',pathname:'/',href:'https://m.youtube.com/'};
const media={matches:false,addEventListener(){}};
const mock={location:locationMock,webkit:{messageHandlers:{langformOpenWatch:{postMessage(){}},langformNavigateFeed:{postMessage(){}}}},matchMedia:()=>media,__langformFeedActive:true};
const bound=new Set(['addEventListener','removeEventListener','setTimeout','clearTimeout','getComputedStyle']);
const proxy=new Proxy(mock,{get(t,k){if(k in t)return t[k];const value=window[k];return bound.has(k)?value.bind(window):value;}});
'''
setup += "new Function('window', " + json.dumps(source) + ")(proxy);\n"
tests='''
const results=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function pose(sheet){const panel=sheet.querySelector('.lf-discovery-panel');return {open:sheet.open,top:panel.getBoundingClientRect().top,opacity:getComputedStyle(panel).opacity,outerScroll:sheet.scrollTop,panelScroll:panel.scrollTop,focus:document.activeElement===sheet.querySelector('.lf-discovery-close')}}
function report(value){window.webkit.messageHandlers.qa.postMessage(value)}
async function scenario(name,focusAt,closeAt,reopenAt){
 document.querySelector('#langform-discovery button').click();
 const sheet=document.querySelector('#langform-discovery-sheet'),samples=[],start=performance.now();let running=true;
 function sample(){samples.push({t:performance.now()-start,...pose(sheet)});if(running)requestAnimationFrame(sample)}requestAnimationFrame(sample);
 if(focusAt!==null)setTimeout(()=>sheet.querySelector('.lf-discovery-close').focus(),focusAt);
 if(closeAt!==null)setTimeout(()=>sheet.querySelector('.lf-discovery-close').click(),closeAt);
 if(reopenAt!==null)setTimeout(()=>document.querySelector('#langform-discovery button').click(),reopenAt);
 await wait(750);running=false;
 const open=samples.filter(x=>x.open);
 const checks={solid:open.every(x=>x.opacity==='1'),noOuterScroll:open.every(x=>x.outerScroll===0),motion:open.some(x=>x.top>300),settledOpen:closeAt===null||reopenAt!==null?sheet.open:!sheet.open,noErrors:errors.length===0};
 if(closeAt===null)checks.continuity=open.every((x,i)=>!i||x.top<=open[i-1].top+1);
 const result={name,passed:Object.values(checks).every(Boolean),checks,samples};results.push(result);report(result);sheet.close();await wait(30);
}
(async()=>{await wait(100);await scenario('warm-open',null,null,null);await scenario('focus-during-open',50,null,null);await scenario('close-during-open',30,90,null);await scenario('rapid-reopen',30,80,140);report({finished:true,passed:results.every(x=>x.passed),errors})})().catch(e=>report({finished:true,passed:false,error:String(e),stack:e.stack}));
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(html + setup + tests + '</script>', encoding="utf-8")
print(args.output.resolve())
