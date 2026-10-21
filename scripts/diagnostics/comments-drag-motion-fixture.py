#!/usr/bin/env python3
"""Frame-sample real WebKit comment springs at 393×852; contacts are synthetic."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--motion-source', type=Path)
parser.add_argument('--controlled-timeline', action='store_true', help='Seek real WebKit animations at 120 Hz positions; no wall-clock/FPS claim')
parser.add_argument('--entrance-only', action='store_true', help='Inspect the actual NF lazy-shell entrance separately from the longer drag sequence')
parser.add_argument('--gesture-trace', action='store_true', help='Include bounded structural contact phases when diagnosing a failed synthetic sequence')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory() as directory:
    base = Path(directory) / 'base.html'
    subprocess.run(['python3', str(root / 'scripts/diagnostics/community-comments-fixture.py'), '--output', str(base), '--safe-top', '59'], check=True, capture_output=True)
    prefix = base.read_text().split('function check(name,condition,detail)')[0]
prefix = prefix.replace('const reduced={matches:true,addEventListener(){}};', 'const reduced={matches:false,addEventListener(name,fn){this.changed=fn}};')
if args.motion_source:
    current = (root / 'ios/Langform/Langform/CommentsMotion.js').read_text()
    prefix = prefix.replace(json.dumps(current), json.dumps(args.motion_source.read_text()))
tests = r'''
const checks=[],samples=[];
function check(name,passed,detail){checks.push({name,passed:!!passed,detail});}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function pointer(target,type,y,id=1){const event=new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',isPrimary:true,button:0,clientX:100,clientY:y});target.dispatchEvent(event);return event;}
function controlledFinish(animation){animation.finish();if(typeof controlledTimeline!=='undefined')animation.dispatchEvent(new Event('finish'));}
function seekSpring(surface,time,finish=false){if(typeof controlledTimeline==='undefined')return;const animation=surface.getAnimations()[0];if(animation){animation.pause();animation.currentTime=time;if(finish)controlledFinish(animation);}}
const markup='<ytm-engagement-panel-section-list-renderer class="comment-item-section"><div class="engagement-panel-section-list-background draggable at-top"><div class="engagement-panel-container" style="height:100%;transform:translateY(0px)"><div class="engagement-panel-section-list-header-wrapper"><div class="engagement-panel-section-list-header"><h2>Kommentare</h2><ytm-button-renderer class="engagement-panel-section-list-header-button close-button"><button>×</button></ytm-button-renderer></div></div><div class="engagement-panel-content-wrapper"><ytm-comments-header-renderer></ytm-comments-header-renderer><div id="long" style="height:1800px;flex-shrink:0">Originale Kommentare</div><button id="reply">Antworten</button><textarea></textarea></div></div></div></ytm-engagement-panel-section-list-renderer>';
function pose(surface){const r=surface.getBoundingClientRect(),header=surface.querySelector('h2'),hr=header.getBoundingClientRect(),hit=document.elementFromPoint(hr.left+hr.width/2,hr.top+hr.height/2),background=surface.closest('.engagement-panel-section-list-background');return {t:performance.now(),top:r.top,bottom:r.bottom,height:r.height,translate:getComputedStyle(surface).translate,headerHit:header.contains(hit),headerCenterY:hr.top+hr.height/2,hitTag:hit?.tagName,backgroundOverflow:getComputedStyle(background).overflow};}
async function mounted(){const panel=document.createElement('ytm-engagement-panel');panel.innerHTML=markup;document.querySelector('panel-container').append(panel);window.dispatchEvent(new Event('engagement-panel-opened'));await wait(20);seekSpring(panel.querySelector('.engagement-panel-container'),300,true);await wait(380);return {panel,surface:panel.querySelector('.engagement-panel-container'),header:panel.querySelector('h2'),body:panel.querySelector('.engagement-panel-content-wrapper')};}
async function sampleSpring(name,surface,ms=620){const frames=[],start=performance.now();await new Promise(resolve=>{function frame(){frames.push({...pose(surface),elapsed:performance.now()-start});if(performance.now()-start<ms)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame)});samples.push({name,frames});return frames;}
(async()=>{
  // Actual public mweb dispatches NF before its lazy shell, then hydrates it.
  const lazy=document.createElement('ytm-engagement-panel');lazy.innerHTML='<div class="engagement-panel-section-list-background draggable at-top"><div class="engagement-panel-container" style="height:100%;transform:translateY(0px)"><div class="engagement-panel-section-list-header-wrapper"><div class="engagement-panel-drag-line"></div><h2>Kommentare</h2></div><div class="engagement-panel-content-wrapper"><div class="spinner"></div></div></div></div>';
  window.dispatchEvent(new CustomEvent('engagement-panel-push',{detail:{identifier:'engagement-panel-comments-section',NF:{engagementPanelSectionListRenderer:{panelIdentifier:'engagement-panel-comments-section'}}}}));document.querySelector('panel-container').append(lazy);window.dispatchEvent(new Event('engagement-panel-opened'));await wait(20);
  const lazySurface=lazy.querySelector('.engagement-panel-container'),entrance=lazySurface.getAnimations()[0];check('nf-lazy-shell-starts-entrance',!!entrance);
  if(entrance){entrance.pause();const positions=[];for(const time of [0,75,150,300]){entrance.currentTime=time;positions.push(pose(lazySurface).top);}check('nf-entrance-has-intermediate-geometry',positions[0]>=innerHeight&&positions[1]>positions[2]&&positions[2]>positions[3],positions);
    entrance.currentTime=120;const before=pose(lazySurface).top;lazy.innerHTML=markup;await wait(20);const hydrated=lazy.querySelector('.engagement-panel-container'),replacement=hydrated.getAnimations()[0];check('nf-hydration-retains-entrance-playhead',!!replacement&&Math.abs((replacement.currentTime||0)-120)<2,{before,after:pose(hydrated).top,currentTime:replacement?.currentTime});if(replacement)controlledFinish(replacement);
  }
  lazy.remove();await wait(40);
  const first=await mounted(), {panel,surface,header,body}=first;
  const original=surface.style.cssText;
  // Two measured moves produce an intentional fast upward release near the
  // expansion target. No clock mocking: browser frame positions are real.
  pointer(header,'pointerdown',330);await wait(45);pointer(header,'pointermove',245);await wait(16);pointer(header,'pointermove',175);pointer(header,'pointerup',175);
  const expanding=await sampleSpring('fast-expand',surface);
  check('spring-bottom-covered',expanding.every(frame=>frame.bottom>=innerHeight-.5),{minimumBottom:Math.min(...expanding.map(f=>f.bottom)),viewport:innerHeight});
  check('spring-header-visible-and-hit-testable',expanding.every(frame=>frame.headerHit),{unreachableFrames:expanding.filter(frame=>!frame.headerHit).length,total:expanding.length});
  check('expanded-rest-safe-top',Math.abs(pose(surface).top-71)<.5,pose(surface));
  const hit=document.elementFromPoint(innerWidth/2,89),renderer=panel.querySelector('ytm-engagement-panel-section-list-renderer');
  check('expanded-controls-hit-testable',surface.contains(hit),{hit:hit?.tagName,hitClass:hit?.className,rendererOverflow:getComputedStyle(renderer).overflow,rendererInteractive:renderer.hasAttribute('data-langform-comments-interactive'),surfaceRect:pose(surface)});
  // Scrolling the real list remains independent from dragging its header.
  body.scrollTop=120;pointer(body,'pointerdown',400);const listMove=pointer(body,'pointermove',470);pointer(body,'pointerup',470);
  check('scrolled-list-not-stolen',body.scrollTop===120&&!listMove.defaultPrevented);
  body.scrollTop=0;
  // Reverse a partially collapsed spring while its presentation is visible.
  pointer(header,'pointerdown',100);await wait(240);pointer(header,'pointermove',220);pointer(header,'pointerup',220);
  await wait(50);seekSpring(surface,50);const beforeRegrab=pose(surface),interrupted=surface.getAnimations()[0];pointer(header,'pointerdown',200);
  check('spring-header-contact-holds-immediately',surface.getAnimations().length===0&&Math.abs(pose(surface).top-beforeRegrab.top)<.5&&Math.abs(pose(surface).height-beforeRegrab.height)<.5,{before:beforeRegrab,after:pose(surface),oldRate:interrupted?.playbackRate});
  await wait(90);check('resting-contact-does-not-drift',Math.abs(pose(surface).top-beforeRegrab.top)<.5,{before:beforeRegrab,after:pose(surface)});
  pointer(header,'pointermove',225);const afterRegrab=pose(surface);
  check('spring-regrab-follows-contact',Math.abs(afterRegrab.top-beforeRegrab.top-25)<2,{before:beforeRegrab,after:afterRegrab});
  pointer(header,'pointercancel',225);const cancelled=await sampleSpring('regrab-cancel',surface);
  check('cancel-settles-without-gap',cancelled.every(frame=>frame.bottom>=innerHeight-.5));
  check('cancel-spring-header-visible-and-hit-testable',cancelled.every(frame=>frame.headerHit),{unreachableFrames:cancelled.filter(frame=>!frame.headerHit).length,total:cancelled.length});
  check('cancel-keeps-panel',panel.isConnected);
  window.dispatchEvent(new Event('resize'));
  check('resize-restores-inline-styles',surface.style.cssText===original);
  // A final coalesced release coordinate is still the user's physical endpoint.
  let closes=0;panel.querySelector('.close-button button').addEventListener('click',()=>{closes++;panel.remove()});
  pointer(header,'pointerdown',300);await wait(200);pointer(header,'pointermove',320);await wait(120);pointer(header,'pointerup',580);
  seekSpring(surface,500,true);await wait(620);check('release-coordinate-completes-dismiss',closes===1&&!panel.isConnected,{closes});panel.remove();await wait(40);
  let next=await mounted();check('reopen-has-one-handle',next.panel.querySelectorAll('[data-langform-comments-handle]').length===1);
  // The real public mweb response wraps each entire comment in a button.
  // Preserve its tap, but allow downward body drag at list-top to own motion.
  const comment=document.createElement('ytm-comment-renderer');comment.innerHTML='<button class="YtmCommentRendererContent"><span class="YtmCommentRendererText">Kommentar</span><div class="YtmCommentRendererDetails"></div></button>';next.body.prepend(comment);
  const details=comment.querySelector('.YtmCommentRendererDetails');let commentTaps=0,bodyCloses=0;comment.querySelector('button').addEventListener('click',()=>commentTaps++);
  pointer(details,'pointerdown',400);pointer(details,'pointerup',400);details.click();check('original-comment-tap-preserved',commentTaps===1);
  next.panel.querySelector('.close-button button').addEventListener('click',()=>{bodyCloses++;next.panel.remove()});
  pointer(details,'pointerdown',400);await wait(60);const bodyDrag=pointer(details,'pointermove',700);pointer(details,'pointerup',700);
  check('comment-button-body-drag-claimed',bodyDrag.defaultPrevented);seekSpring(next.surface,500,true);await wait(620);
  check('comment-button-body-dismiss',bodyCloses===1&&!next.panel.isConnected,{bodyCloses});next.panel.remove();await wait(40);next=await mounted();
  const input=next.panel.querySelector('textarea');input.focus();pointer(next.header,'pointerdown',300);const blocked=pointer(next.header,'pointermove',500);pointer(next.header,'pointerup',500);
  check('keyboard-focus-preserved',!blocked.defaultPrevented&&document.activeElement===input);input.blur();
  reduced.matches=true;reduced.changed();pointer(next.header,'pointerdown',320);await wait(150);pointer(next.header,'pointermove',110);pointer(next.header,'pointerup',110);
  check('reduce-motion-immediate-expanded-pose',next.surface.getAnimations().length===0&&Math.abs(pose(next.surface).top-71)<.5);next.panel.remove();
  check('no-script-errors',errors.length===0,errors);
  report({finished:true,passed:checks.every(c=>c.passed),mode:'real-webkit-raf-synthetic-contacts',viewport:[innerWidth,innerHeight],checks,samples,errors});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack}));
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
if args.gesture_trace:
    tests = tests.replace('const checks=[],samples=[];', 'const gestureTrace=[];testWindow.__langformCommentsGestureTrace=event=>{if(gestureTrace.length<128)gestureTrace.push({phase:event.phase,reason:event.reason,offset:event.offset,rest:event.rest})};const checks=[],samples=[];')
    tests = tests.replace('samples,errors});', 'samples,gestureTrace,errors});')
entrance_start = tests.index('  // Actual public mweb dispatches NF')
drag_start = tests.index('  const first=await mounted()')
if args.entrance_only:
    end = tests.index('})().catch(error=>report', drag_start)
    tests = tests[:drag_start] + "  check('no-script-errors',errors.length===0,errors);report({finished:true,passed:checks.every(c=>c.passed),mode:'real-webkit-controlled-nf-entrance-geometry',checks,errors});\n" + tests[end:]
else:
    tests = tests[:entrance_start] + tests[drag_start:]
if args.controlled_timeline:
    tests = tests.replace("const checks=[],samples=[];", "const checks=[],samples=[];const controlledTimeline=true;")
    start = tests.index('async function sampleSpring(')
    end = tests.index('\n(async()=>{', start)
    tests = tests[:start] + '''async function sampleSpring(name,surface){
      const frames=[],animation=surface.getAnimations()[0];
      if(!animation)throw new Error('Expected running spring: '+name);
      animation.pause();
      for(let index=0;index<=60;index++){
        animation.currentTime=500*index/60;
        frames.push({...pose(surface),controlledTime:500*index/60});
      }
      controlledFinish(animation);await wait(50);samples.push({name,frames});return frames;
    }''' + tests[end:]
    tests = tests.replace("mode:'real-webkit-raf-synthetic-contacts'", "mode:'real-webkit-controlled-timeline-synthetic-contacts-no-fps-proof'")
    tests = tests.replace('viewport:[innerWidth,innerHeight],checks', "viewport:[innerWidth,innerHeight],finishDelivery:'explicit-event-for-occluded-host-not-natural-timing',checks")
args.output.write_text(prefix + tests + '</script>')
print(args.output.resolve())
