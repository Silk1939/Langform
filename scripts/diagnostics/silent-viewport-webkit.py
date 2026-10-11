#!/usr/bin/env python3
"""Exercise diagnostic silence and native viewport scripts in real macOS WebKit.

Uses an offline, audio-free H.264 clip: native media properties/events, frame
injection and CSS layout are real. Pagehide/pageshow are supplied lifecycle
signals. This is not iPhone safe-area or audible-output verification.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
app = root / "ios/Langform/Langform"
paths = [app / "SilentDiagnostics.js", app / "ViewportLayout.js"]
runner = Path(__file__).with_name("FeedMotionWebKit.swift").read_text()
with tempfile.TemporaryDirectory(prefix="langform-silent-viewport-") as temporary:
    directory = Path(temporary)
    clip = directory / "fixture.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                    "color=c=0x476ed2:size=128x72:rate=15", "-t", "2", "-an", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(clip)], check=True, timeout=20)
    encoded = base64.b64encode(clip.read_bytes()).decode()
    instrumentation = """
window.__qaVolumeChanges=0;window.__qaPlayStates=[];
document.addEventListener('volumechange',function(){window.__qaVolumeChanges++;},true);
window.__qaMuted=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'muted').set;
window.__qaVolume=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'volume').set;
var nativePlay=HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play=function(){window.__qaPlayStates.push({muted:this.muted,volume:this.volume});return nativePlay.apply(this,arguments);};
localStorage.setItem('yt-player-volume','user-volume');sessionStorage.setItem('yt-player-quality','user-quality');
window.__qaStorageWrites=0;
['setItem','removeItem','clear'].forEach(function(key){var original=Storage.prototype[key];Storage.prototype[key]=function(){window.__qaStorageWrites++;return original.apply(this,arguments);};});
// Website listener exercises the confirmed player volume-storage key and
// envelope, without claiming this exact listener exists in current mweb.
window.__qaWebsiteVolumeWrites=0;
document.addEventListener('volumechange',function(event){
 var node=event.target;if(!(node instanceof HTMLMediaElement))return;
 window.__qaWebsiteVolumeWrites++;
 var payload=JSON.stringify({data:JSON.stringify({volume:Math.floor(node.volume*100),muted:node.muted}),creation:Date.now(),expiration:Date.now()+2592000000});
 localStorage.setItem('yt-player-volume',payload);sessionStorage.setItem('yt-player-volume',payload);
},true);
"""
    instrumentation_path = directory / "instrumentation.js"
    instrumentation_path.write_text(instrumentation)
    additions = ('\n        configuration.websiteDataStore = .nonPersistent()\n'
                 '        configuration.mediaTypesRequiringUserActionForPlayback = []\n')
    for path, main_only in [(instrumentation_path, False), (paths[0], False), (paths[1], True)]:
        additions += ('        configuration.userContentController.addUserScript(WKUserScript('
                      f'source: try! String(contentsOfFile: {json.dumps(str(path))}, encoding: .utf8), '
                      f'injectionTime: .atDocumentStart, forMainFrameOnly: {str(main_only).lower()}, in: .page))\n')
    runner = runner.replace('configuration.userContentController.add(self, name: "qa")',
                            'configuration.userContentController.add(self, name: "qa")' + additions)
    runner = runner.replace('web.loadFileURL(fixture, allowingReadAccessTo: fixture.deletingLastPathComponent())',
                            'let html = try! String(contentsOf: fixture, encoding: .utf8)\n'
                            '        web.loadHTMLString(html, baseURL: URL(string: "https://m.youtube.com/"))')
    runner = runner.replace("Langform Feed Motion", "Langform Silent Viewport")
    html = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.25,user-scalable=yes,viewport-fit=contain">
<title>Silent Viewport · Offline QA</title><style>
body{margin:0;background:#111;color:white;font:15px -apple-system}ytm-app{display:block;padding-top:48px}ytm-header{position:fixed;top:0}.player-container{position:absolute;top:48px}video{width:300px;height:168px}iframe{width:300px;height:100px}
</style></head><body><ytm-app><ytm-header>Native viewport</ytm-header><div class="player-container"><video id="media" playsinline preload="auto"></video></div></ytm-app>
<script>
var results=[],media=document.getElementById('media');
function report(value){window.webkit.messageHandlers.qa.postMessage(value);}
function check(name,values){var passed=Object.values(values).every(Boolean);results.push({name:name,passed:passed});report({name:name,passed:passed,assertions:values});if(!passed)throw new Error(name);}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function until(predicate){for(var i=0;i<60;i++){if(predicate())return;await wait(50);}throw new Error('bounded wait timed out');}
function quiet(node){return node.muted===true&&node.volume===0&&node.defaultMuted===true;}
async function run(){
 await wait(50);
 check('existing parser media is quiet before play',{quiet:quiet(media),noPlay:window.__qaPlayStates.length===0});
 media.muted=false;media.volume=1;
 check('unmute and volume property writes stay quiet',{quiet:quiet(media)});
 media.src='data:video/mp4;base64,""" + encoded + """';media.load();await until(()=>media.readyState>=2);
 await media.play();await until(()=>!media.paused);await wait(100);
 check('real native playback starts with muted zero-volume media',{states:window.__qaPlayStates.length===1&&window.__qaPlayStates.every(value=>value.muted&&value.volume===0),playing:!media.paused,quiet:quiet(media)});
 window.__qaMuted.call(media,false);window.__qaVolume.call(media,1);await wait(250);
 var settled=window.__qaVolumeChanges;await wait(350);
 check('native volumechange recovery settles without an event loop',{quiet:quiet(media),bounded:settled<30,settled:window.__qaVolumeChanges===settled});
 var created=document.createElement('audio');
 check('new detached media is immediately quiet',{quiet:quiet(created)});
 var wrapper=document.createElement('div');wrapper.innerHTML='<video id="parsed"></video><audio id="parsed-audio"></audio>';document.body.appendChild(wrapper);await wait(30);
 check('inserted parser media is quiet',{video:quiet(document.getElementById('parsed')),audio:quiet(document.getElementById('parsed-audio'))});
 var iframe=document.createElement('iframe');iframe.srcdoc='<html><body><audio id="frame-media"></audio></body></html>';document.body.appendChild(iframe);
 await until(()=>iframe.contentDocument&&iframe.contentDocument.getElementById('frame-media'));await wait(50);
 var frameMedia=iframe.contentDocument.getElementById('frame-media');frameMedia.muted=false;frameMedia.volume=0.8;
 check('document-start diagnostic injection covers embedded frames',{marker:iframe.contentWindow.__langformSilentDiagnostics===true,quiet:quiet(frameMedia),viewportMainOnly:!iframe.contentWindow.__langformViewportLayout});
 check('website volume listener cannot persist diagnostic silence',{listener:window.__qaWebsiteVolumeWrites>0,noWrites:window.__qaStorageWrites===0,volume:localStorage.getItem('yt-player-volume')==='user-volume',missingSession:sessionStorage.getItem('yt-player-volume')===null,quality:sessionStorage.getItem('yt-player-quality')==='user-quality'});
 var meta=document.querySelector('meta[name=viewport]');
 check('native viewport retains all unrelated tokens',{tokens:meta.content==='width=device-width,initial-scale=1.25,user-scalable=yes,viewport-fit=cover',style:document.querySelectorAll('#langform-viewport-layout').length===1});
 var size=[innerWidth,innerHeight];document.documentElement.setAttribute('data-langform-fullscreen','');await wait(30);
 check('fullscreen keeps exactly the same viewport plane',{width:innerWidth===size[0],height:innerHeight===size[1]});document.documentElement.removeAttribute('data-langform-fullscreen');
 var replacement=document.createElement('meta');replacement.name='viewport';replacement.content='width=device-width,initial-scale=1.25,user-scalable=yes,viewport-fit=auto';meta.replaceWith(replacement);await wait(40);
 check('hydrated viewport replacement is covered',{tokens:replacement.content==='width=device-width,initial-scale=1.25,user-scalable=yes,viewport-fit=cover'});
 window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pageshow'));replacement.content='width=device-width,initial-scale=1.25,user-scalable=yes,viewport-fit=contain';await wait(40);
 check('restored page observes later viewport content changes',{tokens:replacement.content==='width=device-width,initial-scale=1.25,user-scalable=yes,viewport-fit=cover'});
 media.pause();window.dispatchEvent(new Event('pagehide'));
 report({finished:true,passed:results.every(value=>value.passed),cases:results.length,volumeChanges:window.__qaVolumeChanges,playStates:window.__qaPlayStates,environment:'macOS WKWebView; audio-free H.264; real document-start/all-frame injection; simulated lifecycle'});
}
run().catch(error=>report({finished:true,passed:false,error:String(error),cases:results.length}));
</script></body></html>"""
    fixture = directory / "fixture.html"
    fixture.write_text(html)
    swift = directory / "main.swift"
    swift.write_text(runner)
    executable = directory / "silent-viewport-webkit"
    subprocess.run(["xcrun", "swiftc", str(swift), "-o", str(executable)], check=True, timeout=60)
    result = subprocess.run([str(executable), str(fixture), str(directory / "snapshots")], capture_output=True, text=True, timeout=35)
    metadata = json.dumps({"shippingSources": {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}}, sort_keys=True)
    output = metadata + "\n" + result.stdout
    print(output, end="")
    if result.stderr:
        import sys
        print(result.stderr, end="", file=sys.stderr)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
    raise SystemExit(result.returncode)
