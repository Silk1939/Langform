#!/usr/bin/env python3
"""Local WebKit gallery safe-area regression. Use FullscreenMotionWebKit.swift.

Source route/media are substitutes; real CSS geometry, focus and hit testing
run in WebKit. No simulator, physical finger or native status-bar hit is claimed.
"""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--community-source', type=Path)
parser.add_argument('--viewport-source', type=Path)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
sources = [args.viewport_source or repo / 'ios/Langform/Langform/ViewportLayout.js',
           repo / 'ios/Langform/Langform/WebViewLinks.js',
           args.community_source or repo / 'ios/Langform/Langform/CommunityPosts.js']
fingerprints = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
html = '''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="img-src data:"><style>
html,body{margin:0;background:#111;color:white;font:16px -apple-system}main{padding-top:140px}img{width:220px;height:160px;background:#333}
#env-probe{position:fixed;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);width:0;height:0;pointer-events:none}
</style></head><body><button id="previous">Vorheriger Fokus</button><div id="env-probe"></div><main><ytm-backstage-post-renderer><ytm-backstage-image-renderer><img alt="Lokales Testbild" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></ytm-backstage-image-renderer></ytm-backstage-post-renderer></main><script>
const errors=[],results=[],messages=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const route={hostname:'m.youtube.com',pathname:'/@fixture/posts',href:'https://m.youtube.com/@fixture/posts'};
const testWindow=new Proxy({}, {get(target,key){if(Reflect.has(target,key))return Reflect.get(target,key);if(key==='location')return route;const value=Reflect.get(window,key);return typeof value==='function'?value.bind(window):value;}});
testWindow.webkit={messageHandlers:{langformOpenWatch:{postMessage(){throw Error('unexpected video open')}},langformOverlayState:{postMessage(row){messages.push(row)}}}};
const attachment=document.querySelector('main img');
// Keep the renderer image local; only its read-only source identity is a
// whitelisted attachment URL. CSP blocks the viewer's remote image request.
Object.defineProperty(attachment,'currentSrc',{get:()=> 'https://yt3.ggpht.com/local-fixture=s640'});
'''
html += 'const sourceFingerprints=' + json.dumps(fingerprints) + ';\n'
for path in sources:
    html += "new Function('window'," + json.dumps(path.read_text()) + ')(testWindow);\n'
html += r'''
function result(name,passed,details={}){const row={name,passed,...details};results.push(row);webkit.messageHandlers.qa.postMessage(row);}
function box(node){const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};}
function near(a,b){return Math.abs(a-b)<.1;}
function viewer(){return document.getElementById('langform-community-images');}
function close(){return viewer().querySelector('[aria-label="Beitragsbilder schließen"]');}
function state(top,right=0,bottom=0,left=0){return testWindow.__langformSetStageInsets({top,right,bottom,left,nativeMini:false});}
function open(){document.getElementById('previous').focus();attachment.click();return viewer();}
function hitClose(){const r=box(close()),node=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(node)node.click();return node;}
function insets(){const c=getComputedStyle(viewer());return ['paddingTop','paddingRight','paddingBottom','paddingLeft'].map(key=>parseFloat(c[key]));}
(async()=>{
 webkit.messageHandlers.qa.postMessage({resize:{width:402,height:874}});await wait(120);
 const env=getComputedStyle(document.getElementById('env-probe'));
 result('real-webkit-env-insets-are-zero',[env.paddingTop,env.paddingRight,env.paddingBottom,env.paddingLeft].every(value=>parseFloat(value)===0),{env:[env.paddingTop,env.paddingRight,env.paddingBottom,env.paddingLeft]});
 result('no-native-snapshot-leaves-fallback-unset',!testWindow.__langformStageInsets&&!document.documentElement.style.getPropertyValue('--lf-native-safe-top'));
 open();let r=box(close());
 result('browser-env-fallback-without-native-snapshot',near(r.y,8)&&insets().every(value=>value===0),{close:r,padding:insets()});
 hitClose();result('fallback-viewer-closes-through-actual-webkit-hit',!viewer()&&document.activeElement.id==='previous');
 state(62,0,34,0);const retained=open(),button=close();r=box(button);
 result('native-top62-env0-keeps-close-below-status-bar',near(r.y,70)&&near(r.height,48)&&insets()[0]===62,{viewport:{width:innerWidth,height:innerHeight},close:r,padding:insets()});
 result('portrait-close-hit-target-is-inside-viewport',r.x>=0&&r.right<=innerWidth&&r.y>=62&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===button,{close:r});
 webkit.messageHandlers.qa.postMessage({snapshot:'gallery-native-top62'});await wait(80);
 state(0,0,0,0);r=box(close());
 result('open-viewer-consumes-top-change-without-rebuild',viewer()===retained&&close()===button&&document.activeElement===button&&near(r.y,8),{close:r,padding:insets()});
 webkit.messageHandlers.qa.postMessage({resize:{width:874,height:402}});await wait(120);state(0,62,21,62);r=box(close());
 const counter=box(viewer().querySelector('[role="status"]'));
 result('landscape-consumes-native-left-and-right62',near(r.right,innerWidth-62-12)&&near(counter.x,62+12)&&r.y===8,{viewport:{width:innerWidth,height:innerHeight},close:r,counter,padding:insets()});
 result('landscape-protects-right-safe-strip-from-close',document.elementFromPoint(innerWidth-20,r.y+r.height/2)!==button,{testX:innerWidth-20,close:r});
 result('landscape-bottom-is-native21',insets()[2]===21,{padding:insets()});
 state(0,0,0,0);r=box(close());
 result('open-viewer-consumes-horizontal-inset-removal',viewer()===retained&&close()===button&&near(r.right,innerWidth-12)&&insets().every(value=>value===0),{close:r,padding:insets()});
 webkit.messageHandlers.qa.postMessage({resize:{width:402,height:874}});await wait(120);state(62,0,34,0);r=box(close());
 result('open-viewer-consumes-portrait-return-and-bottom34',viewer()===retained&&document.activeElement===button&&near(r.y,70)&&insets()[2]===34,{close:r,padding:insets()});
 const accepted=testWindow.__langformSetStageInsets({top:0,right:-1,bottom:0,left:0,nativeMini:false});
 result('invalid-stage-update-cannot-partially-move-open-controls',accepted===false&&near(box(close()).y,70)&&insets()[2]===34,{close:box(close()),padding:insets()});
 result('viewer-preserves-native-overlay-owner-before-close',testWindow.__langformHasOpenOverlay()&&document.body.style.overflow==='hidden');
 hitClose();
 result('native-inset-viewer-close-restores-focus-and-owner',!viewer()&&!testWindow.__langformHasOpenOverlay()&&document.activeElement.id==='previous'&&document.body.style.overflow==='',{focused:document.activeElement.id});
 result('no-uncaught-errors',errors.length===0,{errors});
 webkit.messageHandlers.qa.postMessage({finished:true,passed:results.every(row=>row.passed),count:results.length,sourceFingerprints});
})().catch(error=>webkit.messageHandlers.qa.postMessage({finished:true,passed:false,error:String(error),stack:error.stack}));
</script></body></html>'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(html)
print(args.output)
