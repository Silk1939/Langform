#!/usr/bin/env python3
"""Measure native viewport CSS scroll states in actual offline macOS WebKit.

The 59px top safe area is an explicit fixture value. This is real WebKit CSS
layout with copied public YouTube rules, not an iPhone environment or gesture
test. --before checks the known Build33 overlap against the same fixture.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=Path, help="Optional prior ViewportLayout.js")
parser.add_argument("--youtube-css", type=Path, required=True, help="Saved current official mobile root stylesheet")
parser.add_argument("--css-url", default="https://m.youtube.com/s/_/ytmweb/_/ss/k=ytmweb.c3_base.QswTdmvETwA.L.W.O/am=AAAAAMCAIIA9Aw/d=1/rs=ABnK5FLd_uwqaoY5s2qXoKJe1x9cM-uDqg/m=root,c3_base,Raq4cb,PzUdZb,DlvF1d,Tu3MB,SFvGjc,HDmU1e,cDTHu,uhlLGb,JoU6vf,OM7xob,UAM5m,Di4hBc,dpUCFd,oPp5Le,A4oAVe,Nr0kfe")
parser.add_argument("--before", action="store_true", help="Assert the known pre-fix overlap and header-out override")
parser.add_argument("--output", type=Path, required=True, help="Evidence log path; HTML and PNGs are saved alongside")
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
source = args.source or root / "ios/Langform/Langform/ViewportLayout.js"
css = args.youtube_css.read_text()
# Exact declarations from the current downloaded public source. No recreation
# of YouTube's timing/state rules and no network resources inside the fixture.
selectors = [
    "ytm-header,ytm-header-bar,ytm-mobile-topbar-renderer",
    "ytm-mobile-topbar-renderer.sticky-player.out",
    "ytm-mobile-topbar-renderer.sticky-player.in",
    "ytm-app.is-automotive,ytm-app.sticky-player",
    "ytm-app.is-automotive.header-in-player,ytm-app.sticky-player.header-in-player",
    ".player-container.sticky-player",
    ".player-container.header-in-player,.player-container.sticky-player.header-in-player",
    ".rich-grid-sticky-header",
    ".rich-grid-sticky-header ytm-feed-filter-chip-bar-renderer",
    ".is-hashtag .rich-grid-sticky-header ytm-feed-filter-chip-bar-renderer",
    ".rich-grid-sticky-header ytm-feed-filter-chip-bar-renderer.filter-chip-bar-out",
    ".rich-grid-sticky-header.persistent-header ytm-feed-filter-chip-bar-renderer.filter-chip-bar-out",
    ".rich-grid-sticky-header ytm-feed-filter-chip-bar-renderer.filter-chip-bar-in",
    ".rich-grid-sticky-header ytm-feed-filter-chip-bar-renderer.filter-chip-bar-static",
]
rules = []
for selector in selectors:
    match = re.search(r"(?:^|\})\s*" + re.escape(selector) + r"\{[^{}]*\}", css)
    if not match:
        raise SystemExit("Current YouTube rule missing: " + selector)
    rules.append(match.group(0).lstrip("}").strip())
youtube_rules = "\n".join(rules)
html = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Viewport scroll · Offline WebKit</title><style>
html,body{margin:0;background:#0f0f0f;color:#eee;font:16px -apple-system}
ytm-app,ytm-mobile-topbar-renderer,ytm-rich-grid-renderer,ytm-feed-filter-chip-bar-renderer{display:block}
ytm-mobile-topbar-renderer{height:48px;background:#30464e;box-sizing:border-box;padding:12px}
ytm-feed-filter-chip-bar-renderer{height:62px;background:#916431;box-sizing:border-box;padding:18px}
.player-container{height:0}.video-fixture{height:226px;background:#314947;display:grid;place-items:center}.metadata{height:200px;padding:18px}
</style><style>""" + youtube_rules + """</style></head><body><ytm-app class="sticky-player"><ytm-mobile-topbar-renderer id="header-bar" class="sticky-player in">YouTube · Fixture header</ytm-mobile-topbar-renderer><div class="player-container sticky-player"></div><ytm-rich-grid-renderer><div class="rich-grid-sticky-header persistent-header"><ytm-feed-filter-chip-bar-renderer id="filter-chip-bar">Alle · Musik · Podcasts</ytm-feed-filter-chip-bar-renderer></div><div class="video-fixture">Offline video thumbnail</div><div class="metadata">59px safe top is simulated.<br>Actual macOS WebKit layout.</div></ytm-rich-grid-renderer></ytm-app><script>
"""
html += "const before=" + json.dumps(args.before) + ";\n"
html += """
const root=document.documentElement,app=document.querySelector('ytm-app'),header=document.querySelector('#header-bar'),chips=document.querySelector('#filter-chip-bar'),grid=document.querySelector('ytm-rich-grid-renderer'),holder=document.querySelector('.rich-grid-sticky-header'),player=document.querySelector('.player-container'),results=[];
root.style.setProperty('--lf-safe-top','59px');
function report(value){window.webkit.messageHandlers.qa.postMessage(value)}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function box(node){const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return {top:rect.top,bottom:rect.bottom,height:rect.height,position:style.position,paddingTop:style.paddingTop}}
function overlap(a,b){return Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))}
function near(a,b){return Math.abs(a-b)<.1}
async function scenario(name,change,expected){
 change();await wait(280);
 const pose={header:box(header),chips:box(chips),app:box(app),player:box(player),holder:box(holder)};
 const checks={header:near(pose.header.top,expected.header),chips:near(pose.chips.top,expected.chips),position:pose.chips.position===expected.position,flowInset:near(parseFloat(pose.app.paddingTop),expected.flow),player:near(pose.player.top,expected.player)};
 if('overlap' in expected)checks.overlap=near(overlap(pose.header,pose.chips),expected.overlap);
 const result={name,passed:Object.values(checks).every(Boolean),checks,pose,overlap:overlap(pose.header,pose.chips)};results.push(result);report(result);
}
function baseline(){root.removeAttribute('data-langform-fullscreen');app.className='sticky-player';player.className='player-container sticky-player';header.className='sticky-player in';grid.className='';holder.className='rich-grid-sticky-header persistent-header';chips.className=''}
async function run(){
 await scenario('default fixed bar',baseline,{header:59,chips:before?48:107,position:'fixed',flow:107,player:107,overlap:before?48:0});
 await new Promise(resolve=>{window.__qaSnapshotDone=resolve;report({snapshot:'default-'+(before?'before':'after')})});
 await scenario('in fixed bar',()=>{chips.className='filter-chip-bar-in'},{header:59,chips:before?48:107,position:'fixed',flow:107,player:107,overlap:before?48:0});
 await scenario('static relative bar',()=>{chips.className='filter-chip-bar-static'},{header:59,chips:107,position:'relative',flow:107,player:107,overlap:0});
 await scenario('persistent out bar',()=>{header.className='sticky-player out';chips.className='filter-chip-bar-out'},{header:before?59:-48,chips:before?0:59,position:'fixed',flow:107,player:107,overlap:before?3:0});
 await scenario('nonpersistent out bar',()=>{holder.classList.remove('persistent-header')},{header:before?59:-48,chips:-60,position:'fixed',flow:107,player:107});
 await scenario('hashtag relative bar',()=>{baseline();grid.className='is-hashtag'},{header:59,chips:107,position:'relative',flow:107,player:107,overlap:0});
 await scenario('header in player',()=>{baseline();app.classList.add('header-in-player');player.classList.add('header-in-player')},{header:59,chips:before?48:107,position:'fixed',flow:59,player:59,overlap:before?48:0});
 await scenario('fullscreen header in player',()=>{root.setAttribute('data-langform-fullscreen','')},{header:0,chips:48,position:'fixed',flow:0,player:0,overlap:0});
 await scenario('fullscreen persistent out',()=>{header.className='sticky-player out';chips.className='filter-chip-bar-out'},{header:-48,chips:0,position:'fixed',flow:0,player:0,overlap:0});
 await scenario('back to inline persistent out',()=>{root.removeAttribute('data-langform-fullscreen')},{header:before?59:-48,chips:before?0:59,position:'fixed',flow:59,player:59,overlap:before?3:0});
 await scenario('back to inline in',()=>{header.className='sticky-player in';chips.className='filter-chip-bar-in'},{header:59,chips:before?48:107,position:'fixed',flow:59,player:59,overlap:before?48:0});
 window.dispatchEvent(new Event('pagehide'));
 report({finished:true,passed:results.every(value=>value.passed),cases:results.length,before,environment:'actual offline macOS WKWebView CSS layout; 59px safe top supplied by fixture; no physical-iPhone or gesture claim'});
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
                        '        configuration.userContentController.addUserScript(WKUserScript('
                        f'source: try! String(contentsOfFile: {json.dumps(str(source.resolve()))}, encoding: .utf8), '
                        'injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))')
runner = runner.replace('web.loadFileURL(fixture, allowingReadAccessTo: fixture.deletingLastPathComponent())',
                        'let html = try! String(contentsOf: fixture, encoding: .utf8)\n'
                        '        web.loadHTMLString(html, baseURL: URL(string: "https://m.youtube.com/"))')
runner = runner.replace("Langform Feed Motion", "Langform Viewport Scroll")
with tempfile.TemporaryDirectory(prefix="langform-viewport-scroll-") as temporary:
    directory = Path(temporary)
    swift = directory / "main.swift"
    swift.write_text(runner)
    executable = directory / "viewport-scroll-webkit"
    subprocess.run(["xcrun", "swiftc", str(swift), "-o", str(executable)], check=True, timeout=60)
    result = subprocess.run([str(executable), str(fixture.resolve()), str(args.output.with_suffix("").resolve())], capture_output=True, text=True, timeout=35)
    metadata = {"source": str(source), "sourceSHA256": hashlib.sha256(source.read_bytes()).hexdigest(),
                "youtubeCSS": args.css_url, "youtubeCSSSHA256": hashlib.sha256(args.youtube_css.read_bytes()).hexdigest(),
                "exactRuleCount": len(rules), "simulatedSafeTop": 59, "before": args.before}
    output = json.dumps(metadata, sort_keys=True) + "\n" + result.stdout
    args.output.write_text(output)
    print(output, end="")
    if result.stderr:
        import sys
        print(result.stderr, end="", file=sys.stderr)
    raise SystemExit(result.returncode)
