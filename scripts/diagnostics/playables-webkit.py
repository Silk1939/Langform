#!/usr/bin/env python3
"""Exercise real iframe timer/WebAudio teardown in offline macOS WebKit.

The game is an offline same-origin srcdoc fixture with a zero-gain oscillator.
No audible signal is generated. This is not the physical YouTube game itself.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=Path)
parser.add_argument("--before", action="store_true")
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
source = args.source or root / "ios/Langform/Langform/WebViewLinks.js"
code = source.read_text()
if "__langformPlayablesBlocked" in code:
    start = code.index("(function (win) {")
    code = code[start:code.index("\n(function (win) {", start + 1)]
html = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Playables engine · Offline WebKit</title></head><body><h1>Playables context teardown</h1><iframe id="ordinary" srcdoc="ordinary frame"></iframe><script>
const results=[],ticks={},before=""" + json.dumps(args.before) + ";\nconst shipping=" + json.dumps(code) + ";\n"
html += r"""
const bridge={langformOpenWatch:{postMessage(){}},langformNavigateFeed:{postMessage(){}}};
const proxy=new Proxy({webkit:{messageHandlers:bridge}},{get(target,key){if(key in target)return target[key];const value=window[key];return typeof value==='function'?value.bind(window):value;}});
function report(value){window.webkit.messageHandlers.qa.postMessage(value)}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function check(name,checks,details={}){const result={name,passed:Object.values(checks).every(Boolean),checks,...details};results.push(result);report(result)}
async function until(predicate){for(let i=0;i<40;i++){if(predicate())return;await wait(25)}throw Error('bounded fixture wait failed')}
window.addEventListener('message',event=>{if(event.data&&event.data.gameTick)ticks[event.data.gameTick]=(ticks[event.data.gameTick]||0)+1});
function game(id){
 const frame=document.createElement('iframe');frame.id=id;frame.className='ytMiniAppContainerViewModelIframe';
 frame.srcdoc='<script>window.__gameContext=new AudioContext();var osc=__gameContext.createOscillator(),gain=__gameContext.createGain();gain.gain.value=0;osc.connect(gain);gain.connect(__gameContext.destination);osc.start();__gameContext.resume();setInterval(function(){parent.postMessage({gameTick:'+JSON.stringify(id)+'},"*")},25);<\/script>';
 document.body.append(frame);return frame;
}
function audioClock(context){try{return context.currentTime}catch(_){return null}}
async function run(){
 const old=game('retained');await until(()=>ticks.retained>=3);
 const context=old.contentWindow.__gameContext,startClock=audioClock(context);await wait(150);
 check('fixture game was running before policy',{ticks:ticks.retained>=3,realWebAudio:context instanceof old.contentWindow.AudioContext,running:context.state==='running',clockAdvances:audioClock(context)>startClock},{ticks:ticks.retained,audioState:context.state,audioTime:audioClock(context)});
 new Function('window',shipping)(proxy);await wait(80);
 const settledTicks=ticks.retained,settledClock=audioClock(context);await wait(250);
 const afterClock=audioClock(context);
 check(before?'prior source retains game engine':'current policy destroys retained game engine',before?{
  retained:old.isConnected,timersContinue:ticks.retained>settledTicks,audioContinues:afterClock>settledClock
 }:{
  detached:!old.isConnected,blankSource:old.getAttribute('src')==='about:blank',timersStopped:ticks.retained===settledTicks,audioClockStopped:afterClock===null||settledClock===null||Math.abs(afterClock-settledClock)<.01
 },{ticksBefore:settledTicks,ticksAfter:ticks.retained,audioBefore:settledClock,audioAfter:afterClock,audioState:context.state});
 const late=game('late');await wait(200);
 check('newly mounted game frame',before?{retained:late.isConnected,timersStart:(ticks.late||0)>0}:{detached:!late.isConnected,noGameTicks:!ticks.late},{ticks:ticks.late||0});
 const hidden=game('hidden');window.__langformFeedActive=false;window.dispatchEvent(new Event('langform-feed-visibility'));await wait(100);
 check('tab-hide cancels a newly mounted game',before?{retained:hidden.isConnected}:{detached:!hidden.isConnected});
 window.dispatchEvent(new Event('pagehide'));
 const restored=game('restored');await wait(100);
 window.dispatchEvent(new Event('pageshow'));await wait(100);
 check('BFCache restoration does not restore a game',before?{retained:restored.isConnected}:{detached:!restored.isConnected});
 check('ordinary iframe remains intact',{retained:!!document.getElementById('ordinary')});
 if(!before){
  const native=game('native');proxy.__langformDiscardPlayables();
  check('native lifecycle cleanup is synchronous',{detached:!native.isConnected});
 }
 window.dispatchEvent(new Event('pagehide'));document.querySelectorAll('iframe').forEach(frame=>frame.remove());
 report({finished:true,passed:results.every(value=>value.passed),cases:results.length,before,environment:'actual offline macOS WKWebView; same-origin srcdoc game timer and real zero-gain WebAudio oscillator; lifecycle signals supplied by fixture; no physical-iPhone/YouTube-game claim'});
}
run().catch(error=>report({finished:true,passed:false,error:String(error),cases:results.length}));
</script></body></html>
"""
args.output.parent.mkdir(parents=True, exist_ok=True)
fixture = args.output.with_suffix(".html")
fixture.write_text(html)
runner = Path(__file__).with_name("FeedMotionWebKit.swift").read_text()
runner = runner.replace('configuration.userContentController.add(self, name: "qa")',
                        'configuration.userContentController.add(self, name: "qa")\n'
                        '        configuration.websiteDataStore = .nonPersistent()\n'
                        '        configuration.mediaTypesRequiringUserActionForPlayback = []')
runner = runner.replace('web.loadFileURL(fixture, allowingReadAccessTo: fixture.deletingLastPathComponent())',
                        'let html = try! String(contentsOf: fixture, encoding: .utf8)\n'
                        '        web.loadHTMLString(html, baseURL: URL(string: "https://m.youtube.com/"))')
runner = runner.replace("Langform Feed Motion", "Langform Playables Engine")
with tempfile.TemporaryDirectory(prefix="langform-playables-webkit-") as temporary:
    directory = Path(temporary)
    swift = directory / "main.swift"; swift.write_text(runner)
    executable = directory / "playables-webkit"
    subprocess.run(["xcrun", "swiftc", str(swift), "-o", str(executable)], check=True, timeout=60)
    result = subprocess.run([str(executable), str(fixture.resolve()), str(directory / "snapshots")], capture_output=True, text=True, timeout=35)
    metadata = {"source":str(source),"sourceSHA256":hashlib.sha256(source.read_bytes()).hexdigest(),"before":args.before}
    output = json.dumps(metadata, sort_keys=True) + "\n" + result.stdout
    args.output.write_text(output); print(output, end="")
    if result.stderr:
        import sys
        print(result.stderr, end="", file=sys.stderr)
    raise SystemExit(result.returncode)
