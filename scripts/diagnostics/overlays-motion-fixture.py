#!/usr/bin/env python3
"""Generate offline summary/chapter motion QA from current production sources."""

import argparse
import hashlib
import json
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=Path(tempfile.gettempdir()) / 'langform-overlay-motion' / 'fixture.html')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
fingerprints = {name: hashlib.sha256((repo / name).read_bytes()).hexdigest() for name in [
    'extension/src/summary.js', 'extension/src/page-captions.js',
    'scripts/diagnostics/CommentsMotionWebKit.swift', 'scripts/diagnostics/overlays-motion-fixture.py',
]}
summary = (repo / 'extension/src/summary.js').read_text()
chapters = (repo / 'extension/src/page-captions.js').read_text()
head = '''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;color:#fff;background:#222;font:16px -apple-system}body{min-height:1600px}#movie_player{height:250px;background:#35454e}#time{padding:12px}video{display:none}ytm-video-with-context-renderer{display:block;padding:24px}button{cursor:pointer}#summary-open{margin:24px}
</style><div id="movie_player"><div id="time">0:00 / 24:20</div><video></video></div><ytm-video-with-context-renderer><a href="https://m.youtube.com/watch?v=abcdefghijk">Film</a></ytm-video-with-context-renderer><script>'''
setup = f'''
const sourceFingerprints={json.dumps(fingerprints)};
const errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const summaryModule={{exports:{{}}}}, chapterModule={{exports:{{}}}};
new Function('module','globalThis',{json.dumps(summary)})(summaryModule,window);
new Function('module','globalThis',{json.dumps(chapters)})(chapterModule,window);
const summaryApi=summaryModule.exports, chaptersApi=chapterModule.exports;
const testLocation={{hostname:'m.youtube.com',href:'https://m.youtube.com/',pathname:'/',protocol:'https:'}};
let modelCalls=0, replyDelay=140;
const testWindow=new Proxy({{}},{{get(t,k){{if(Reflect.has(t,k))return Reflect.get(t,k);if(k==='location')return testLocation;const v=Reflect.get(window,k);return typeof v==='function'?v.bind(window):v;}}}});
testWindow.webkit={{messageHandlers:{{langformSummary:{{postMessage(request){{modelCalls++;setTimeout(()=>testWindow.__langformKurzFinish(request.id,{{summary:{{points:Array.from({{length:8}},(_,i)=>'Punkt '+i+': Das Gemüse braucht 20 Minuten und ruht anschließend kurz. Diese Aussage erklärt den Ablauf.') }}}}),replyDelay);}}}}}}}};
testWindow.fetch=async href=>({{ok:true,text:async()=>new URL(href).pathname==='/watch'?'ytInitialPlayerResponse='+JSON.stringify({{videoDetails:{{videoId:'abcdefghijk'}},captions:{{playerCaptionsTracklistRenderer:{{captionTracks:[{{languageCode:'de',baseUrl:'https://m.youtube.com/api/timedtext?v=abcdefghijk&lang=de'}}]}}}}}})+';':JSON.stringify({{events:[{{segs:[{{utf8:'Das Gemüse braucht 20 Minuten. Danach ruht es kurz.'}}]}}]}})}});
summaryApi.decorate(document,'https://m.youtube.com/',testWindow);
const opener=document.querySelector('[data-langform-kurz]');
const chapterItems=Array.from({{length:16}},(_,i)=>({{start:i*83,title:'Kapitel '+i}}));
'''
tests = r'''
const results=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function report(value){window.webkit.messageHandlers.qa.postMessage(value)}
function pose(sheet, panel=sheet){const r=panel.getBoundingClientRect();return {top:r.top,bottom:r.bottom,opacity:getComputedStyle(panel).opacity,outerScroll:sheet.scrollTop,pageScroll:scrollY,connected:sheet.isConnected,display:getComputedStyle(sheet).display};}
function sample(sheet,panel){const state={running:true,rows:[]};function tick(){if(!state.running)return;state.rows.push({t:performance.now(),...pose(sheet,panel)});requestAnimationFrame(tick)}requestAnimationFrame(tick);return state;}
function monotonic(rows,direction){return rows.filter(x=>x.connected&&x.display!=='none').every((x,i,a)=>!i||(direction==='up'?x.top<=a[i-1].top+1:x.top>=a[i-1].top-1));}
function summarySheet(){return document.getElementById('langform-kurzfassung')}
async function summaryAutofocus(){
 opener.click();const sheet=summarySheet(),panel=sheet.querySelector('.langform-kurz'),trace=sample(sheet,panel);await wait(35);
 const close=sheet.querySelector('header button'),before=pose(sheet,panel);close.blur();close.focus();const after=pose(sheet,panel);
 await wait(360);trace.running=false;const atRest=pose(sheet,panel),body=sheet.querySelector('.langform-kurz-body');body.scrollTop=100;
 const pass=after.top<=before.top+1&&after.outerScroll===0&&after.pageScroll===before.pageScroll&&monotonic(trace.rows,'up')&&getComputedStyle(body).overflowY==='auto'&&body.scrollTop===Math.min(100,body.scrollHeight-body.clientHeight)&&panel.getAnimations().length===0;
 results.push({name:'summary-autofocus-and-reading',passed:pass,before,after,atRest,readingScroll:body.scrollTop,readingMax:body.scrollHeight-body.clientHeight,panelAnimations:panel.getAnimations().length,frames:trace.rows});sheet.querySelector('header button').click();await wait(220);
}
async function summaryReverse(){
 opener.click();const sheet=summarySheet(),panel=sheet.querySelector('.langform-kurz');await wait(65);sheet.querySelector('header button').click();await wait(45);
 const before=pose(sheet,panel);opener.click();const after=pose(sheet,panel);await wait(330);
 const trace=sample(sheet,panel);sheet.querySelector('header button').click();await wait(220);trace.running=false;
 results.push({name:'summary-quick-reverse-and-exit',passed:Math.abs(before.top-after.top)<1&&monotonic(trace.rows,'down')&&!sheet.isConnected,before,after,frames:trace.rows});
}
async function summaryAsyncClose(){
 testWindow.__langformKurzCache=null;const beforeCalls=modelCalls;opener.click();const sheet=summarySheet();await wait(45);sheet.querySelector('header button').click();await wait(110);
 const stateWhileClosing=sheet.getAttribute('data-summary-state');opener.click();const ready=sheet.getAttribute('data-summary-state');await wait(350);
 results.push({name:'summary-result-during-exit',passed:stateWhileClosing==='pending'&&ready==='ready'&&modelCalls===beforeCalls+1&&sheet.isConnected,stateWhileClosing,ready,modelCalls: modelCalls-beforeCalls});sheet.querySelector('header button').click();await wait(220);
}
async function chapterAutofocus(){
 const sought=[],ui=chaptersApi.renderChapterUi(document,chapterItems,x=>sought.push(x));const sheet=document.getElementById('langform-chapter-sheet');ui.open();const trace=sample(sheet);await wait(35);
 const button=sheet.querySelector('header button'),before=pose(sheet);button.focus();const after=pose(sheet);await wait(320);trace.running=false;
 const list=sheet.querySelector('[data-langform-chapter-list]');list.scrollTop=100;const readingScroll=list.scrollTop;
 const exit=sample(sheet);sheet.querySelector('[data-start="83"]').click();const immediateSeek=sought.slice();await wait(220);exit.running=false;
 results.push({name:'chapter-autofocus-and-immediate-seek',passed:after.top<=before.top+1&&after.outerScroll===0&&after.pageScroll===before.pageScroll&&monotonic(trace.rows,'up')&&readingScroll===100&&immediateSeek.length===1&&immediateSeek[0]===83&&monotonic(exit.rows,'down')&&getComputedStyle(sheet).display==='none',before,after,readingScroll,immediateSeek,frames:trace.rows,exitFrames:exit.rows});
}
async function chapterReverse(){
 const ui=chaptersApi.renderChapterUi(document,chapterItems,()=>{}),sheet=document.getElementById('langform-chapter-sheet');ui.open();await wait(70);ui.close();await wait(45);
 const before=pose(sheet);ui.open();const after=pose(sheet);await wait(330);const trace=sample(sheet);ui.close();await wait(220);trace.running=false;
 results.push({name:'chapter-quick-reverse-and-exit',passed:Math.abs(before.top-after.top)<1&&monotonic(trace.rows,'down')&&getComputedStyle(sheet).display==='none',before,after,frames:trace.rows});
}
(async()=>{await summaryAutofocus();await summaryReverse();await summaryAsyncClose();await chapterAutofocus();await chapterReverse();results.forEach(report);report({finished:true,passed:errors.length===0&&results.every(x=>x.passed),errors,count:results.length,sourceFingerprints})})().catch(e=>report({finished:true,passed:false,error:String(e),stack:e.stack}));
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(head+setup+tests+'</script>')
print(args.output)
