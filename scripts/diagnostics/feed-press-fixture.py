#!/usr/bin/env python3
"""Build the offline feed-press WebKit fixture from the current iPhone source."""

import argparse
import json
from pathlib import Path
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--output",
    type=Path,
    default=Path(tempfile.gettempdir()) / "langform-feed-press" / "fixture.html",
    help="HTML output path (default: %(default)s)",
)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
source = (root / "ios/Langform/Langform/WebViewLinks.js").read_text(encoding="utf-8")
head='''<!doctype html><html><style>body{margin:0;background:#0f0f0f}img{display:block;width:360px;height:202px;margin:20px;background:#53777f}</style><a href="/watch?v=abcdefghijk"><img id="thumbnail" data-src="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"></a><script>'''
setup='''
const errors=[],animations=[];window.addEventListener('error',e=>errors.push(e.message));
const original=Element.prototype.animate;Element.prototype.animate=function(frames,options){const a=original.call(this,frames,options);animations.push({frames,options});return a};
const bound=new Set(['addEventListener','removeEventListener','setTimeout','clearTimeout','getComputedStyle','matchMedia']);
const mock={location:{hostname:'m.youtube.com',pathname:'/',href:'https://m.youtube.com/'},webkit:{messageHandlers:{langformOpenWatch:{postMessage(){}}}},__langformFeedActive:true};
const proxy=new Proxy(mock,{get(t,k){if(k in t)return t[k];const value=window[k];return bound.has(k)?value.bind(window):value;}});
'''
setup += "new Function('window', " + json.dumps(source) + ")(proxy);\n"
tests='''
const samples=[],image=document.querySelector('img'),start=performance.now();let active=true;
function record(){samples.push({t:performance.now()-start,scale:getComputedStyle(image).scale});if(active)requestAnimationFrame(record)}requestAnimationFrame(record);
function pointer(type){image.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,isPrimary:true,clientX:80,clientY:80}))}
setTimeout(()=>pointer('pointerdown'),100);setTimeout(()=>pointer('pointerup'),180);
setTimeout(()=>pointer('pointerdown'),240);setTimeout(()=>pointer('pointerup'),300);
setTimeout(()=>{active=false;const checks={allFourAnimations:animations.length===4,repressContinues:animations.length>=3&&Number(animations[2].frames[0].scale)<1,settled:getComputedStyle(image).scale==='none',noErrors:errors.length===0};window.webkit.messageHandlers.qa.postMessage({finished:true,passed:Object.values(checks).every(Boolean),checks,animations,samples,errors})},750);
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(head + setup + tests + '</script>', encoding="utf-8")
print(args.output.resolve())
