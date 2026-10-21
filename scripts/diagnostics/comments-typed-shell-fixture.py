#!/usr/bin/env python3
"""Generate real offline WebKit checks for a typed, not yet hydrated comments shell.

Synthetic panel push and contacts; real DOM, CSS and browser animations.
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
with tempfile.TemporaryDirectory(prefix='langform-comments-typed-shell-') as temporary:
    base = Path(temporary) / 'base.html'
    subprocess.run(['python3', str(root / 'scripts/diagnostics/community-comments-fixture.py'), '--output', str(base), '--safe-top', '62'], check=True, capture_output=True)
    prefix = base.read_text().split('function check(name,condition,detail)')[0]
prefix = prefix.replace('const reduced={matches:true,addEventListener(){}};', 'const reduced={matches:false,addEventListener(){}};')
prefix = prefix.replace('inset:274px 0 0', 'inset:274.1px 0 0')
if args.motion_source:
    current = (root / 'ios/Langform/Langform/CommentsMotion.js').read_text()
    assert prefix.count(json.dumps(current)) == 1
    prefix = prefix.replace(json.dumps(current), json.dumps(args.motion_source.read_text()))
tests = r'''
const checks=[],traces=[],clock={now:1000};testWindow.performance={now:()=>clock.now};
testWindow.__langformCommentsGestureTrace=e=>{if(traces.length<100)traces.push({phase:e.phase,reason:e.reason,shown:e.shown,offset:e.offset,motion:e.motion});};
const commentsID='engagement-panel-comments-section';
const surfaceMarkup='<div class="engagement-panel-container" style="height:100%;transform:translateY(0px)"><div class="engagement-panel-section-list-header-wrapper"><h2>Kommentare</h2><ytm-button-renderer class="engagement-panel-section-list-header-button close-button"><button>×</button></ytm-button-renderer></div><div class="engagement-panel-content-wrapper"><div class="spinner"></div><div style="height:1500px"></div></div></div>';
function shell(type=commentsID){return '<ytm-engagement-panel-section-list-renderer class="'+type+'"><div class="engagement-panel-section-list-background at-top">'+surfaceMarkup+'</div></ytm-engagement-panel-section-list-renderer>';}
function push(id=commentsID){window.dispatchEvent(new CustomEvent('engagement-panel-push',{detail:{identifier:id,changedSlot:{engagementPanelSectionListRenderer:{panelIdentifier:id}}}}));}
function wait(ms){return new Promise(r=>setTimeout(r,ms));}
function check(name,passed,detail){checks.push({name,passed:!!passed,detail});}
function input(target,type,y,ms=0){clock.now+=ms;const e=new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:31,pointerType:'touch',isPrimary:true,button:0,clientX:201,clientY:y});target.dispatchEvent(e);return e;}
async function finish(surface){const a=surface.getAnimations()[0];if(a){a.finish();a.dispatchEvent(new Event('finish'));}await wait(25);}
async function mount(){push();const panel=document.createElement('ytm-engagement-panel');panel.innerHTML=shell();document.querySelector('panel-container').append(panel);await wait(25);return {panel,surface:panel.querySelector('.engagement-panel-container'),header:panel.querySelector('h2')};}
(async()=>{
 let first=await mount();let {panel,surface,header}=first;
 check('typed-shell-without-header-starts-entrance',!panel.querySelector('ytm-comments-header-renderer')&&surface.getAnimations().length===1);
 await finish(surface);
 const rest=surface.getBoundingClientRect().top;
 input(header,'pointerdown',333.5);const move=input(header,'pointermove',233.5,300);input(header,'pointerup',233.5,150);await finish(surface);
 check('typed-shell-header-drag-before-header-hydration',move.defaultPrevented&&surface.getBoundingClientRect().top<rest-50,{rest,top:surface.getBoundingClientRect().top,trace:traces.slice(-4)});
 let closes=0;const close=panel.querySelector('.close-button button');close.addEventListener('click',()=>{closes++;panel.remove()});close.click();
 check('typed-shell-close-animates-before-original-command',closes===0&&surface.getAnimations().length===1);
 await finish(surface);check('typed-shell-close-calls-original-once',closes===1&&!panel.isConnected,{closes});panel.remove();await wait(25);

 const entrancesBefore=traces.filter(t=>t.phase==='entrance').length;
 first=await mount();({panel,surface,header}=first);const outer=panel.querySelector('ytm-engagement-panel-section-list-renderer');
 const entrance=surface.getAnimations()[0];if(!entrance)throw new Error('typed shell entrance missing');entrance.pause();entrance.currentTime=120;const before=surface.getBoundingClientRect().top;
 surface.outerHTML=surfaceMarkup;for(let tick=0;tick<8;tick++)await Promise.resolve();surface=panel.querySelector('.engagement-panel-container');const replacement=surface.getAnimations()[0];if(replacement)replacement.pause();
 check('typed-shell-deep-surface-replacement-still-observed',!!replacement,{before,after:surface.getBoundingClientRect().top,time:replacement?.currentTime});
 check('typed-shell-replacement-keeps-playhead',!!replacement&&Math.abs((replacement.currentTime||0)-120)<2,{time:replacement?.currentTime});
 panel.querySelector('.engagement-panel-content-wrapper').insertAdjacentHTML('afterbegin','<ytm-comments-header-renderer></ytm-comments-header-renderer>');await wait(25);
 check('late-header-keeps-existing-surface-and-one-entrance',outer.isConnected&&surface===panel.querySelector('.engagement-panel-container')&&traces.filter(t=>t.phase==='entrance').length===entrancesBefore+1);
 await finish(surface);panel.remove();await wait(25);

 first=await mount();({panel,surface,header}=first);await finish(surface);
 panel.hidden=true;await wait(25);push('engagement-panel-description-section');panel.innerHTML=shell('engagement-panel-description-section');panel.hidden=false;await wait(25);
 surface=panel.querySelector('.engagement-panel-container');header=panel.querySelector('h2');input(header,'pointerdown',330);const foreignMove=input(header,'pointermove',220,150);input(header,'pointerup',220,150);
 check('explicit-foreign-reused-shell-revokes-old-comments-ownership',!foreignMove.defaultPrevented&&!panel.hasAttribute('data-langform-comments-sheet')&&surface.getAnimations().length===0,{prevented:foreignMove.defaultPrevented,sheet:panel.hasAttribute('data-langform-comments-sheet'),animations:surface.getAnimations().length});panel.remove();await wait(25);

 const unknown=document.createElement('ytm-engagement-panel');unknown.innerHTML=shell('unclassified');document.querySelector('panel-container').append(unknown);await wait(25);unknown.querySelector('.engagement-panel-content-wrapper').insertAdjacentHTML('afterbegin','<ytm-comments-header-renderer></ytm-comments-header-renderer>');await wait(25);
 check('already-drawn-unknown-shell-never-replays-entry',unknown.querySelector('.engagement-panel-container').getAnimations().length===0);unknown.remove();
 check('no-script-errors',errors.length===0,errors);report({finished:true,passed:checks.every(c=>c.passed),mode:'real-macos-webkit-dom-css-synthetic-typed-panel-and-contact-clock-no-device-fps-proof',checks,traces,errors});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack,checks,traces,errors}));
</script>
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(prefix + tests)
print(args.output.resolve())
