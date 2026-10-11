#!/usr/bin/env python3
"""Generate offline macOS WebKit QA for the current player overlay bridge.

Run with the existing CommentsMotionWebKit.swift runner. The fixture uses real
DOM, CSS and MutationObserver behavior; only location and message transport are
substituted. It does not test iPhone gestures, playback or live YouTube markup.
"""

import argparse
import hashlib
import json
from pathlib import Path
import tempfile


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--output", type=Path,
    default=Path(tempfile.gettempdir()) / "langform-player-overlay" / "fixture.html",
)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
source_path = root / "ios/Langform/Langform/WebViewLinks.js"
source = source_path.read_text(encoding="utf-8")
fingerprints = {
    str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
    for path in [source_path, Path(__file__), root / "scripts/diagnostics/CommentsMotionWebKit.swift"]
}
head = """<!doctype html><html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{margin:0;background:#171717;color:white;font:16px -apple-system}
#picture{height:226px;display:grid;place-items:center;background:#344b55}
ytm-engagement-panel{display:block;padding:24px;background:#2e2e2e}
.closed{display:none}
</style>
<div id="picture">Offline overlay bridge QA</div>
<main id="old-parent"><div id="wrapper" hidden><panel-container>
<ytm-engagement-panel><section>Kommentare</section></ytm-engagement-panel>
</panel-container></div></main><aside id="destination" hidden></aside>
<script>
"""
setup = r"""
const errors=[],posts=[],results=[];
const startedAt=performance.now();
const report=value=>window.webkit.messageHandlers.qa.postMessage(value);
window.addEventListener('error',event=>errors.push(event.message));
window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
const testLocation={hostname:'m.youtube.com',href:'https://m.youtube.com/watch?v=abcdefghijk',pathname:'/watch',protocol:'https:'};
let discoveryExpiries=0,documentSearches=0;
const bound=new Set(['addEventListener','removeEventListener','dispatchEvent','setTimeout','clearTimeout','getComputedStyle','matchMedia','requestAnimationFrame','cancelAnimationFrame']);
const mock={
  location:testLocation,
  webkit:{messageHandlers:{langformOverlayState:{postMessage(value){posts.push({...value,t:performance.now()-startedAt});}}}},
  setTimeout(callback,delay,...args){
    return window.setTimeout(delay===2000?()=>{discoveryExpiries++;callback();}:callback,delay,...args);
  }
};
const testWindow=new Proxy(mock,{get(target,key){
  if(Reflect.has(target,key))return Reflect.get(target,key);
  const value=Reflect.get(window,key);
  return bound.has(key)?value.bind(window):value;
}});
"""
setup += "new Function('window', " + json.dumps(source) + ")(testWindow);\n"
setup += "const sourceFingerprints=" + json.dumps(fingerprints) + ";\n"
tests = r"""
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wrapper=document.getElementById('wrapper');
const oldParent=document.getElementById('old-parent');
const destination=document.getElementById('destination');
const panel=document.querySelector('ytm-engagement-panel');
async function state(name,mutate,expected,extraCheck=()=>true){
  const before=posts.length;
  if(mutate)mutate();
  await wait(1000);
  const last=posts[posts.length-1];
  const style=getComputedStyle(panel);
  const row={name,passed:!!last&&last.open===expected&&extraCheck(before),expectedOpen:expected,
    reportedOpen:last?last.open:null,bridgeReports:posts.length,discoveryExpiries,
    elapsedMilliseconds:Math.round(performance.now()-startedAt),documentSearches,
    panelConnected:panel.isConnected,panelDisplay:style.display,panelVisibility:style.visibility,
    panelRectCount:panel.getClientRects().length};
  results.push(row);report(row);
}
(async()=>{
  await state('initial-hidden-ancestor',null,false,()=>getComputedStyle(panel).display==='block'&&panel.getClientRects().length===0);
  await wait(1200);
  const query=document.querySelectorAll.bind(document);
  document.querySelectorAll=function(selector){documentSearches++;return query(selector);};
  await state('reopen-after-discovery',()=>{wrapper.hidden=false;},true,()=>discoveryExpiries>0&&panel.getClientRects().length>0);
  await state('ancestor-display-none',()=>{wrapper.style.display='none';},false,()=>panel.getClientRects().length===0);
  await state('ancestor-display-reopen',()=>{wrapper.style.display='';},true,()=>panel.getClientRects().length>0);
  await state('ancestor-visibility-hidden',()=>{wrapper.style.visibility='hidden';},false,()=>getComputedStyle(panel).visibility==='hidden');
  await state('ancestor-visibility-reopen',()=>{wrapper.style.visibility='';},true);
  await state('ancestor-aria-hidden',()=>wrapper.setAttribute('aria-hidden','true'),false);
  await state('ancestor-aria-reopen',()=>wrapper.removeAttribute('aria-hidden'),true);
  await state('ancestor-css-class-hidden',()=>{wrapper.className='closed';},false,()=>panel.getClientRects().length===0);
  await state('ancestor-css-class-reopen',()=>{wrapper.className='';},true);
  await state('reparent-into-hidden-ancestor',()=>destination.appendChild(wrapper),false,()=>panel.getClientRects().length===0);
  await state('reparented-ancestor-reopen',()=>{destination.hidden=false;},true);
  await state('old-ancestor-no-longer-affects-panel',()=>{oldParent.hidden=true;},true,before=>posts.length===before);
  await state('new-ancestor-hidden',()=>{destination.hidden=true;},false);
  await state('new-ancestor-reopen',()=>{destination.hidden=false;},true);
  await state('remove-reparented-wrapper',()=>destination.remove(),false,()=>!panel.isConnected);
  report({finished:true,passed:results.every(row=>row.passed)&&errors.length===0&&documentSearches===0,
    count:results.length,errors,documentSearches,discoveryExpiries,sourceFingerprints,
    engine:'macOS WKWebView; substituted location and bridge; real DOM/CSS/MutationObserver',
    userAgent:navigator.userAgent,
    limits:'Offline retained-panel fixture; no live YouTube, iPhone touch recognition, WebKit media overlay or playback verification'});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack,sourceFingerprints}));
"""
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(head + setup + tests + "</script></html>", encoding="utf-8")
print(args.output.resolve())
