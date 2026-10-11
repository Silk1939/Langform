#!/usr/bin/env python3
"""Check PlayerRect and deferred quality policy with an offline WebKit video.

The tiny H.264 fixture, decode events and compositor callbacks are real. Route,
YouTube player metadata and page lifecycle signals are supplied by the fixture;
this does not measure live YouTube loading or iPhone frame rate.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
player = root / "ios/Langform/Langform/PlayerRect.js"
source = player.read_text()
quality = root / "ios/Langform/Langform/PlaybackQuality.js"
quality_source = quality.read_text()
runner = Path(__file__).with_name("FeedMotionWebKit.swift").read_text()
runner = runner.replace('configuration.userContentController.add(self, name: "qa")',
                        'configuration.userContentController.add(self, name: "qa")\n'
                        '        configuration.mediaTypesRequiringUserActionForPlayback = []')
runner = runner.replace("web.loadFileURL(fixture, allowingReadAccessTo: fixture.deletingLastPathComponent())",
                        'let html = try! String(contentsOf: fixture, encoding: .utf8)\n'
                        '        web.loadHTMLString(html, baseURL: URL(string: "https://m.youtube.com/watch?v=abcdefghijk"))')
runner = runner.replace("Langform Feed Motion", "Langform First Picture")
with tempfile.TemporaryDirectory(prefix="langform-player-picture-") as temporary:
    directory = Path(temporary)
    clip = directory / "fixture.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                    "color=c=0x476ed2:size=128x72:rate=15", "-t", "2", "-an", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(clip)], check=True, timeout=20)
    import base64
    encoded = base64.b64encode(clip.read_bytes()).decode()
    html = """<!doctype html><meta charset="utf-8"><title>First Picture · Offline QA</title>
<style>body{margin:0;background:#111;color:white;font:15px -apple-system}#movie_player{padding-top:59px}video{width:400px;height:225px;display:block}p{padding:16px}</style>
<div id="movie_player"><video id="media" playsinline muted preload="auto"></video></div>
<p>Real H.264 decoder and first presented frame</p>
<script>
var media = document.getElementById('media'), root = document.getElementById('movie_player');
var actualID = 'abcdefghijk', registrations = 0, presentations = 0, qualityCalls = [], qualityResets = [], preference = 'hd1080';
root.getVideoData = function(){return {video_id:actualID};};
root.getPreferredQuality = function(){return preference;};
root.setPlaybackQualityRange = function(minimum,maximum){qualityCalls.push({minimum:minimum,maximum:maximum,presentations:presentations});preference=maximum;};
localStorage.setItem('yt-player-quality','oldHD');sessionStorage.setItem('yt-player-quality','oldHD');
var originalRemove = Storage.prototype.removeItem;
Storage.prototype.removeItem = function(key){qualityResets.push({key:key,presentations:presentations});return originalRemove.call(this,key);};
var originalFrame = media.requestVideoFrameCallback;
if (originalFrame) media.requestVideoFrameCallback = function(callback){
  registrations++;return originalFrame.call(this,function(now,metadata){presentations++;callback(now,metadata);});
};
</script><script>""" + quality_source.replace("</script", "<\\/script") + """</script><script>""" + source.replace("</script", "<\\/script") + """</script><script>
var results = [];
function report(value){window.webkit.messageHandlers.qa.postMessage(value);}
function check(name,values){var passed=Object.values(values).every(Boolean);results.push({name:name,passed:passed});report({name:name,passed:passed,assertions:values});if(!passed)throw new Error(name);}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function frame(){return new Promise(resolve=>requestAnimationFrame(resolve));}
async function until(predicate){for(var i=0;i<60;i++){if(predicate())return;await wait(50);}throw new Error('bounded state wait timed out');}
async function run(){
 var blank=window.__langformMeasureVideo();
 check('blank media cannot dismiss its poster',{unready:!blank.mediaReady,unpresented:!blank.mediaPresented});
 media.dispatchEvent(new Event('waiting'));media.dispatchEvent(new Event('playing'));
 window.__langformSetNetworkPolicy({online:true,interface:'wifi'});
 check('initial quality target remains untouched before a real frame',{range:qualityCalls.length===0,reset:qualityResets.length===0,target:preference==='hd1080',stored:localStorage.getItem('yt-player-quality')==='oldHD'});
 media.src='data:video/mp4;base64,""" + encoded + """';media.load();
 await until(()=>media.readyState>=2);await frame();
 var decoded=window.__langformMeasureVideo();
 check('real video decodes with identified geometry',{decoded:decoded.mediaReady,width:media.videoWidth===128,height:media.videoHeight===72,capability:decoded.frameObservationSupported});
 report({name:'exact decoded picture geometry',geometry:{x:decoded.x,y:decoded.y,width:decoded.width,height:decoded.height,viewportWidth:decoded.viewportWidth,viewportHeight:decoded.viewportHeight}});
 check('reported geometry contains the real header offset',{x:decoded.x===0,y:decoded.y===59,width:decoded.width===400,height:decoded.height===225});
 await media.play();await until(()=>window.__langformMeasureVideo().mediaPresented);await wait(120);
 var count=registrations;
 check('a real compositor frame dismisses the poster',{presented:window.__langformMeasureVideo().mediaPresented,callback:presentations>0});
 check('adaptive range and preference reset follow an actual presented frame',{cap:qualityCalls.length===1&&qualityCalls[0].maximum==='hd720',rangeAfterFrame:qualityCalls.every(value=>value.presentations>0),resetAfterFrame:qualityResets.length===2&&qualityResets.every(value=>value.presentations>0)});
 await wait(350);for(var i=0;i<30;i++)window.__langformMeasureVideo();
 check('continuous playback installs no repeated frame observer',{oneShot:registrations===count});
 root.style.paddingTop='100px';media.style.height='260px';await frame();
 var changed=window.__langformMeasureVideo();
 report({name:'exact changed picture geometry',geometry:{x:changed.x,y:changed.y,width:changed.width,height:changed.height,viewportWidth:changed.viewportWidth,viewportHeight:changed.viewportHeight}});
 check('changed layout reports the actual shifted video plane',{y:changed.y===100,height:changed.height===260});
 actualID='lmnopqrstuv';
 check('mismatched main-player identity cannot inherit the first picture',{unready:!window.__langformMeasureVideo().mediaReady,unpresented:!window.__langformMeasureVideo().mediaPresented});
 actualID='abcdefghijk';await until(()=>window.__langformMeasureVideo().mediaPresented);
 window.dispatchEvent(new Event('pagehide'));
 check('retired page cannot retain presented readiness',{unready:!window.__langformMeasureVideo().mediaReady,unpresented:!window.__langformMeasureVideo().mediaPresented});
 window.dispatchEvent(new Event('pageshow'));await until(()=>window.__langformMeasureVideo().mediaPresented);
 check('restored current player receives a new real frame',{presented:window.__langformMeasureVideo().mediaPresented});
 media.pause();media.currentTime=0;media.load();
 check('new source invalidates the former presented frame',{unpresented:!window.__langformMeasureVideo().mediaPresented});
 await until(()=>media.readyState>=2);await media.play();await until(()=>window.__langformMeasureVideo().mediaPresented);
 check('freshly loaded source confirms its own compositor picture',{presented:window.__langformMeasureVideo().mediaPresented});
 media.pause();window.dispatchEvent(new Event('pagehide'));
 report({finished:true,passed:results.every(value=>value.passed),cases:results.length,registrations:registrations,presentations:presentations,qualityCalls:qualityCalls,qualityResets:qualityResets,environment:'macOS WKWebView; offline H.264; simulated player quality API, metadata and lifecycle'});
}
run().catch(error=>report({finished:true,passed:false,error:String(error),cases:results.length}));
</script>"""
    fixture = directory / "fixture.html"
    fixture.write_text(html)
    swift = directory / "main.swift"
    swift.write_text(runner)
    executable = directory / "player-picture-webkit"
    subprocess.run(["xcrun", "swiftc", str(swift), "-o", str(executable)], check=True, timeout=60)
    result = subprocess.run([str(executable), str(fixture), str(directory / "snapshots")], capture_output=True, text=True, timeout=35)
    metadata = json.dumps({"shippingSource": str(player), "shippingSHA256": hashlib.sha256(source.encode()).hexdigest(),
                           "qualitySource": str(quality), "qualitySHA256": hashlib.sha256(quality_source.encode()).hexdigest()}, sort_keys=True)
    output = metadata + "\n" + result.stdout
    print(output, end="")
    if result.stderr:
        import sys
        print(result.stderr, end="", file=sys.stderr)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
    raise SystemExit(result.returncode)
