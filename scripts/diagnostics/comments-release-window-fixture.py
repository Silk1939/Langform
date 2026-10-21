#!/usr/bin/env python3
"""Generate an offline WebKit replay of expanded-comment release trajectories.

DOM, CSS and WebKit animations are real. Contact coordinates, event delivery
and the monotonic contact clock are supplied; this is no physical/FPS proof.
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--motion-source', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='langform-comment-release-window-') as temporary:
    base = Path(temporary) / 'base.html'
    subprocess.run(['python3', str(root / 'scripts/diagnostics/community-comments-fixture.py'), '--output', str(base), '--safe-top', '62'], check=True, capture_output=True)
    prefix = base.read_text().split('function check(name,condition,detail)')[0]
prefix = prefix.replace('const reduced={matches:true,addEventListener(){}};', 'const reduced={matches:false,addEventListener(){}};')
prefix = prefix.replace('inset:274px 0 0', 'inset:274.1px 0 0')
if args.motion_source:
    current = (root / 'ios/Langform/Langform/CommentsMotion.js').read_text()
    assert prefix.count(json.dumps(current)) == 1, 'exactly one embedded production motion script expected'
    prefix = prefix.replace(json.dumps(current), json.dumps(args.motion_source.read_text()))
tests = r'''
const checks=[],releases=[],contactClock={now:1000};testWindow.performance={now:()=>contactClock.now};
testWindow.__langformCommentsGestureTrace=e=>{if(e.phase==='release')releases.push({reason:e.reason,offset:e.offset,rest:e.rest,motion:e.motion});};
const markup='<ytm-engagement-panel-section-list-renderer class="comment-item-section"><div class="engagement-panel-section-list-background draggable at-top"><div class="engagement-panel-container" style="height:100%;transform:translateY(0px)"><div class="engagement-panel-section-list-header-wrapper"><h2>Kommentare</h2><ytm-button-renderer class="engagement-panel-section-list-header-button close-button"><button>×</button></ytm-button-renderer></div><div class="engagement-panel-content-wrapper"><ytm-comments-header-renderer></ytm-comments-header-renderer><ytm-comment-renderer><button class="YtmCommentRendererContent"><div class="YtmCommentRendererDetails">Kommentar</div></button></ytm-comment-renderer><button id="reaction">Like</button><div style="height:1800px"></div></div></div></div></ytm-engagement-panel-section-list-renderer>';
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
function input(target,type,y,ms=0){contactClock.now+=ms;const event=new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:31,pointerType:'touch',isPrimary:true,button:0,clientX:221,clientY:y});target.dispatchEvent(event);return event;}
function check(name,passed,detail){checks.push({name,passed:!!passed,detail});}
async function finish(surface){const a=surface.getAnimations()[0];if(a){a.finish();a.dispatchEvent(new Event('finish'));}await wait(25);}
async function mount(){const panel=document.createElement('ytm-engagement-panel');panel.innerHTML=markup;document.querySelector('panel-container').append(panel);await wait(25);const surface=panel.querySelector('.engagement-panel-container');await finish(surface);return {panel,surface,header:panel.querySelector('h2'),body:panel.querySelector('.YtmCommentRendererDetails'),list:panel.querySelector('.engagement-panel-content-wrapper')};}
(async()=>{
for(const delivery of ['high-rate','duplicate-endpoint','quantized-endpoint','quantized-reverse-endpoint','held-endpoint','coalesced-release','final-reversal','sustained-reversal']){
 const {panel,surface,header,body}=await mount();
 input(header,'pointerdown',333.5);input(header,'pointermove',73.5,400);input(header,'pointerup',73.5,150);await finish(surface);
 input(header,'pointerdown',133);input(header,'pointermove',168,200);input(header,'pointerup',168,150);await finish(surface);
 check(delivery+'-expanded-pose',Math.abs(surface.getBoundingClientRect().top-74)<.2,{top:surface.getBoundingClientRect().top});
 let closes=0;panel.querySelector('.close-button button').addEventListener('click',()=>{closes++;panel.remove()});
 input(body,'pointerdown',393.3);
 if(delivery==='high-rate'){for(let i=1;i<=125;i++)input(body,'pointermove',393.3+375.6*i/125,501/125);}
 else if(delivery==='quantized-endpoint'||delivery==='quantized-reverse-endpoint'){
  const beforeEndpoint=768.9+(delivery==='quantized-endpoint'?-1:1)/3;
  for(let i=1;i<=30;i++)input(body,'pointermove',393.3+(beforeEndpoint-393.3)*i/30,484/30);
  input(body,'pointermove',768.9,17);
 }
 else if(delivery==='coalesced-release')input(body,'pointermove',550,208);
 else{
  input(body,'pointermove',768.9,501);
  if(delivery==='duplicate-endpoint')input(body,'pointermove',768.9,16);
  if(delivery==='held-endpoint')for(let i=0;i<8;i++)input(body,'pointermove',768.9,16);
  if(delivery==='sustained-reversal')for(let i=1;i<=3;i++)input(body,'pointermove',768.9-3*i,4);
 }
 input(body,'pointerup',delivery==='final-reversal'?740:delivery==='sustained-reversal'?759.9:768.9,delivery==='coalesced-release'?293:delivery==='final-reversal'?5:1);
 const release=releases.at(-1);await finish(surface);
 const stays=['held-endpoint','final-reversal','sustained-reversal'].includes(delivery);
 check(delivery+'-release-intent',closes===(stays?0:1),{closes,release});
 const velocity=release?.motion?.velocity,projected=release?.motion?.projected;
 check(delivery+'-trajectory',Number.isFinite(velocity)&&Number.isFinite(projected)&&(delivery==='held-endpoint'?velocity===0:stays?velocity<0:velocity>100),release);
 panel.remove();await wait(20);
}
// The release estimator must not change list/control ownership.
const {panel,surface,body,list}=await mount();
list.scrollTop=100;const before=list.scrollTop;input(body,'pointerdown',400);const scrolled=input(body,'pointermove',500,40);input(body,'pointerup',500,1);
check('scrolled-list-keeps-contact',before===100&&list.scrollTop===100&&!scrolled.defaultPrevented&&!panel.hasAttribute('data-langform-comments-dragging'));
list.scrollTop=0;const action=panel.querySelector('#reaction');input(action,'pointerdown',400);const controlled=input(action,'pointermove',500,40);input(action,'pointerup',500,1);
check('inner-control-keeps-contact',!controlled.defaultPrevented&&!panel.hasAttribute('data-langform-comments-dragging'));
check('original-transform-preserved',surface.style.transform==='translateY(0px)');panel.remove();
check('no-script-errors',errors.length===0,errors);report({finished:true,passed:checks.every(c=>c.passed),mode:'real-macos-webkit-dom-css-controlled-contact-clock-synthetic-events-no-fps-proof',checks,errors});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack}));
</script>
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(prefix + tests)
print(args.output.resolve())
