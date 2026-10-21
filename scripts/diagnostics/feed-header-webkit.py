#!/usr/bin/env python3
"""Check the shipping feed header in real offline WebKit layout.

Scroll-state classes/individual transforms and native safe-area values are
supplied by the fixture. This proves CSS geometry and restoration, not the
current YouTube DOM, authenticated subscriptions or physical iPhone scrolling.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--source", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
source = args.source or root / "ios/Langform/Langform/ViewportLayout.js"
args.output.mkdir(parents=True, exist_ok=True)
args.output = args.output.resolve()
source = source.resolve()
runner = Path(__file__).with_name("FeedMotionWebKit.swift").read_text()
injection = '''
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.addUserScript(WKUserScript(source: "window.__langformStageInsets={top:59,right:0,bottom:34,left:0,nativeMini:false};", injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        configuration.userContentController.addUserScript(WKUserScript(source: try! String(contentsOfFile: SOURCE, encoding: .utf8), injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
'''.replace("SOURCE", json.dumps(str(source)))
runner = runner.replace('configuration.userContentController.add(self, name: "qa")',
                        'configuration.userContentController.add(self, name: "qa")' + injection)
runner = runner.replace('web.loadFileURL(fixture, allowingReadAccessTo: fixture.deletingLastPathComponent())',
                        'let html = try! String(contentsOf: fixture, encoding: .utf8)\n'
                        '        web.loadHTMLString(html, baseURL: URL(string: "https://m.youtube.com/feed/subscriptions"))')
runner = runner.replace("Langform Feed Motion", "Langform Feed Header")
html = r'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#fff;color:#111;font:18px -apple-system}ytm-app{display:block;padding-top:48px}
ytm-header,ytm-header-bar,ytm-mobile-topbar-renderer,.ytTopBarViewModelHost{display:block;position:fixed;top:0;left:0;right:0;height:48px;background:#fff;z-index:4}
header.mobile-topbar-header{display:flex;align-items:center;height:48px;background:white}
.scroll-pose{translate:0px 48px;scale:1 .98;rotate:1deg;transition:top 350ms,translate 350ms}
.logo{margin-left:18px;color:red;font-size:20px;font-weight:700}button{width:44px;height:44px;margin-left:auto}
#feed{height:2500px;background:repeating-linear-gradient(0deg,#80c7ee 0 80px,#e6a26e 80px 160px)}
#unrelated{position:fixed;right:4px;top:400px;width:10px;height:10px;translate:0 7px;transition:translate 1s}
#player{position:absolute;top:500px;width:220px;height:124px;translate:0 3px}
</style></head><body><ytm-app><div id="mount"></div><div id="feed">Subscriptions feed</div></ytm-app><div id="unrelated"></div><video id="player"></video>
<script>
var results=[],failures=0;
function report(value){window.webkit.messageHandlers.qa.postMessage(value);}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function check(name,values,details){var passed=Object.values(values).every(Boolean);if(!passed)failures++;results.push({name,passed,assertions:values,details});report(results[results.length-1]);}
function rect(node){var r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,width:r.width,height:r.height};}
function near(a,b){return Math.abs(a-b)<.6;}
function snapshot(name){return new Promise(resolve=>{window.__qaSnapshotDone=resolve;report({snapshot:name});});}
function mount(kind){
 var bar=kind==='modern'?'<div class="ytTopBarViewModelHost scroll-pose out"><header class="mobile-topbar-header"><b class="logo">YouTube</b><button aria-label="Search">⌕</button></header></div>':'<ytm-mobile-topbar-renderer class="scroll-pose out"><header class="mobile-topbar-header"><b class="logo">YouTube</b><button aria-label="Search">⌕</button></header></ytm-mobile-topbar-renderer>';
 document.getElementById('mount').innerHTML=kind==='nested'?'<ytm-header class="scroll-pose"><ytm-header-bar class="scroll-pose">'+bar+'</ytm-header-bar></ytm-header>':bar;
}
async function pose(kind,name,inset){
 var hosts=Array.from(document.querySelectorAll('ytm-header,ytm-header-bar,ytm-mobile-topbar-renderer,.ytTopBarViewModelHost'));
 var row=document.querySelector('header.mobile-topbar-header'),cover=document.getElementById('langform-feed-safe-top-cover');
 var hostRects=hosts.map(rect),rowRect=rect(row),coverRect=cover&&rect(cover);
 check(kind+' '+name,{hostOrigin:hostRects.every(r=>near(r.top,inset)),rowOrigin:near(rowRect.top,inset),rowHeight:near(rowRect.height,48),fullWidth:hostRects.every(r=>near(r.width,innerWidth)),safePaint:inset===0?!cover:!!coverRect&&near(coverRect.top,0)&&near(coverRect.bottom,inset),individualTransforms:hosts.every(h=>getComputedStyle(h).translate==='none'&&getComputedStyle(h).scale==='none'&&getComputedStyle(h).rotate==='none'),stationaryGeometry:hosts.every(h=>getComputedStyle(h).transitionProperty==='none'),unrelatedPreserved:getComputedStyle(document.getElementById('unrelated')).translate==='0px 7px',mediaPreserved:getComputedStyle(document.getElementById('player')).translate==='0px 3px'}, {hostRects,rowRect,coverRect,scrollY});
}
async function run(){
 await wait(80);
 for(var kind of ['legacy','modern','nested']){
  window.__langformSetStageInsets({top:59,right:0,bottom:34,left:0,nativeMini:false});mount(kind);await wait(50);await pose(kind,'initial out',59);
  scrollTo(0,640);await wait(30);await pose(kind,'scroll down',59);
  document.querySelectorAll('.scroll-pose').forEach(h=>h.classList.replace('out','in'));scrollTo(0,320);await wait(30);await pose(kind,'scroll back up',59);
  await wait(380);await pose(kind,'settled',59);
  window.__langformSetStageInsets({top:0,right:59,bottom:21,left:59,nativeMini:false});await wait(30);await pose(kind,'zero top inset',0);
  window.__langformSetStageInsets({top:59,right:0,bottom:34,left:0,nativeMini:false});await wait(30);await pose(kind,'safe inset restored',59);
  // Fullscreen restores the author's 350ms transition as well as its pose.
  // Wait for that author-owned transition before asserting its final value.
  document.documentElement.setAttribute('data-langform-fullscreen','');await wait(390);
  check(kind+' releases author geometry in fullscreen',{authorTranslate:getComputedStyle(document.querySelector('.scroll-pose')).translate==='0px 48px',noCover:!document.getElementById('langform-feed-safe-top-cover')});
  document.documentElement.removeAttribute('data-langform-fullscreen');await wait(30);await pose(kind,'after fullscreen',59);
  var taps=0;document.querySelector('button').onclick=()=>taps++;document.querySelector('button').click();check(kind+' search action survives',{tap:taps===1});
  if(kind==='nested')await snapshot('nested-header-after-scroll-return');
 }
 report({finished:true,passed:failures===0,total:results.length,failures,results});
}
run().catch(error=>report({finished:true,passed:false,error:String(error),results}));
</script></body></html>'''
with tempfile.TemporaryDirectory(prefix="langform-feed-header-") as temporary:
    directory = Path(temporary)
    runner_path = directory / "Runner.swift"
    runner_path.write_text(runner)
    fixture = directory / "fixture.html"
    fixture.write_text(html)
    executable = directory / "feed-header-webkit"
    subprocess.run(["xcrun", "swiftc", "-module-cache-path", str(directory / "module-cache"), str(runner_path), "-o", str(executable)], check=True, timeout=90)
    try:
        result = subprocess.run([str(executable), str(fixture), str(args.output)], text=True, capture_output=True, timeout=40)
    except subprocess.TimeoutExpired as error:
        def decode(value):
            return value.decode(errors="replace") if isinstance(value, bytes) else value or ""
        result = subprocess.CompletedProcess(error.cmd, 124, decode(error.stdout), decode(error.stderr) + "\nOffline WebKit timed out.\n")
    (args.output / "run.log").write_text(result.stdout + result.stderr)
    messages=[]
    for line in result.stdout.splitlines():
        try: messages.append(json.loads(line))
        except json.JSONDecodeError: pass
    summary = next((value for value in reversed(messages) if value.get("finished")), {"passed": False, "error": "no completion"})
    summary.update({"source": str(source), "sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "runnerExitCode": result.returncode, "scope": "Offline macOS WebKit CSS geometry. Supplied DOM/scroll states/insets, no live YouTube or iPhone proof."})
    (args.output / "validation.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({key:summary.get(key) for key in ["passed","total","failures","runnerExitCode","error"]}))
    raise SystemExit(0 if result.returncode == 0 and summary.get("passed") else 1)
