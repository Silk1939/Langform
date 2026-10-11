#!/usr/bin/env python3
"""Generate a small offline macOS WebKit fixture using the unchanged fullscreen source.

Run: python3 scripts/diagnostics/fullscreen-motion-fixture.py --output /tmp/langform-motion21/fullscreen.html
Then: /tmp/langform-motion21/webkit /tmp/langform-motion21/fullscreen.html
Media readiness and location are substitutes; this is not an iPhone/YouTube playback test.
"""
import argparse
import hashlib
import json
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=Path(tempfile.gettempdir()) / 'langform-motion21' / 'fullscreen.html')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
source_path = repo / 'ios/Langform/Langform/FullscreenMotion.js'
source = source_path.read_text()
chapters_path = repo / 'ios/Langform/Langform/FullscreenChapters.js'
chapters_source = chapters_path.read_text()
captions_path = repo / 'extension/src/page-captions.js'
captions_source = captions_path.read_text()
mobile_fixture_path = repo / 'tests/fixtures/chapters/mobile-auto-chapters.json'
mobile_fixture = json.loads(mobile_fixture_path.read_text())
fingerprints = {str(path.relative_to(repo)): hashlib.sha256(path.read_bytes()).hexdigest() for path in [source_path, chapters_path, captions_path, mobile_fixture_path, Path(__file__), repo / 'scripts/diagnostics/FullscreenMotionWebKit.swift']}
head = '''<!doctype html><html style="overflow:auto"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=contain"><title>Fullscreen QA - YouTube</title><style>
html,body{margin:0;background:#17202a;color:white;font:14px -apple-system}body{height:1400px}main{width:390px;transform:translateX(2px);transition:transform 600ms}#movie_player{width:390px;height:220px;min-width:640px;min-height:320px;padding:12px;background:#35454e;transition:width 600ms,height 600ms,transform 600ms;animation:fixture-scale 4s ease infinite}.html5-video-container{max-width:380px;max-height:214px;transition:width 600ms,height 600ms}video{width:100%;height:100%;max-width:380px;max-height:214px;object-fit:cover;transform:scale(.94);transition:width 600ms,height 600ms,transform 600ms}@keyframes fixture-scale{50%{transform:scale(.96)}}button{min-width:44px;min-height:44px}
</style></head><body><button id="before">Vorheriger Fokus</button><main><div id="movie_player" style="width:390px;height:220px"><div class="html5-video-container"><video class="html5-main-video" style="object-fit:cover"></video></div><button class="ytp-fullscreen-button">Vollbild</button></div></main><script>'''
setup = f'''
const sourceFingerprints={json.dumps(fingerprints)};
const mobileChapterFixture={json.dumps(mobile_fixture)};
const errors=[],messages=[],calls=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const testLocation={{hostname:'m.youtube.com',pathname:'/watch',href:'https://m.youtube.com/watch?v=abcdefghijk'}};
const testWindow=new Proxy({{}},{{get(t,k){{if(Reflect.has(t,k))return Reflect.get(t,k);if(k==='location')return testLocation;const v=Reflect.get(window,k);return typeof v==='function'?v.bind(window):v;}}}});
testWindow.webkit={{messageHandlers:{{langformFullscreen:{{postMessage(value){{messages.push(value)}}}}}}}};
const motionPreference=new EventTarget();motionPreference.matches=false;testWindow.matchMedia=query=>query.includes('prefers-reduced-motion')?motionPreference:window.matchMedia(query);
const root=document.getElementById('movie_player'),video=root.querySelector('video'),parent=video.parentElement;
let paused=false,nativeCalls=0;
Object.defineProperties(video,{{paused:{{get:()=>paused}},ended:{{value:false}},duration:{{value:120,writable:true}},readyState:{{value:4}},currentTime:{{value:40,writable:true}}}});
root.getVideoData=()=>({{video_id:'abcdefghijk',title:'Fullscreen Test'}});
video.webkitEnterFullscreen=()=>{{nativeCalls++;}};
testWindow.ytInitialPlayerResponse={{videoDetails:{{videoId:'abcdefghijk'}}}};
const chapterItems=[{{start:0,title:'Einleitung'}},{{start:30,title:'Das Thema'}},{{start:75,title:'Fazit'}}];
testWindow.__langformChapterCache={{player:testWindow.ytInitialPlayerResponse,fractions:chapterItems}};
document.documentElement.__langformChapterList=chapterItems;document.documentElement.__langformChapterVideoID='abcdefghijk';
video.play=()=>{{throw Error('Unexpected direct play')}};video.pause=()=>{{throw Error('Unexpected direct pause')}};
testWindow.__langformPlay=id=>{{calls.push(['play',id]);paused=false;video.dispatchEvent(new Event('play'));video.dispatchEvent(new Event('playing'));return true;}};
testWindow.__langformTogglePlayback=id=>{{calls.push(['toggle',id]);paused=!paused;video.dispatchEvent(new Event(paused?'pause':'play'));return true;}};
const captionsModule={{exports:{{}}}};new Function('module','globalThis',{json.dumps(captions_source)})(captionsModule,testWindow);const captionsApi=captionsModule.exports;
new Function('window',{json.dumps(chapters_source)})(testWindow);
new Function('window',{json.dumps(source)})(testWindow);
'''
tests = r'''
const results=[];const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function report(value){window.webkit.messageHandlers.qa.postMessage(value)}
function result(name,passed,details){const value={name,passed,...details};results.push(value);report(value)}
function rect(node){const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}
function full(node){const r=rect(node);return Math.abs(r.x)<1&&Math.abs(r.y)<1&&Math.abs(r.width-innerWidth)<1&&Math.abs(r.height-innerHeight)<1}
function enter(){root.querySelector('.ytp-fullscreen-button').click()}
function ui(){return document.getElementById('langform-fullscreen-ui')}
(async()=>{
 const inlineHost=document.createElement('div');inlineHost.style.cssText='position:fixed;left:20px;top:100px;width:360px;height:44px;z-index:10';
 const inlineBar=document.createElement('div');inlineBar.style.cssText='position:absolute;left:0;right:0;top:20.5px;height:3px';
 const nativeScrub=document.createElement('input');nativeScrub.type='range';nativeScrub.style.cssText='position:absolute;left:0;top:-20.5px;width:100%;height:44px;margin:0;padding:0;border:0';inlineBar.appendChild(nativeScrub);inlineHost.appendChild(inlineBar);document.body.appendChild(inlineHost);
 let inlineSeeks=0,nativeScrubClicks=0;nativeScrub.addEventListener('click',()=>nativeScrubClicks++);
 captionsApi.drawChapterBar(inlineBar,[{title:'Intro',start:0,fraction:0},{title:'Thema',start:30,fraction:.25},{title:'Ende',start:75,fraction:.625}],()=>inlineSeeks++);
 const inlineMarkers=Array.from(inlineBar.querySelectorAll('[data-langform-chapter]')),inlineHitChecks=inlineMarkers.map(node=>{const r=rect(node),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);hit?.click();return hit===nativeScrub;});
 captionsApi.drawChapterBar(inlineBar,[{title:'Intro',start:0,fraction:0},{title:'Dicht A',start:60,fraction:.5},{title:'Dicht B',start:60.5,fraction:60.5/120}],()=>inlineSeeks++);
 const inlineDenseWidths=Array.from(inlineBar.querySelectorAll('[data-langform-chapter]')).map(node=>rect(node).width);
 result('inline-chapter-gaps-preserve-native-scrub-and-dense-segments',inlineMarkers.length===2&&inlineHitChecks.every(Boolean)&&nativeScrubClicks===2&&inlineSeeks===0&&inlineDenseWidths.length===2&&inlineDenseWidths.every(width=>width>0&&width<1)&&inlineBar.querySelector('[data-langform-chapters]').getAttribute('aria-hidden')==='true',{inlineHitChecks,nativeScrubClicks,inlineSeeks,inlineDenseWidths});inlineHost.remove();
 const oldMeta=document.querySelector('meta[name=viewport]').content,oldStyles=[root,video,parent.parentElement,document.documentElement].map(n=>n.getAttribute('style'));
 const before=document.getElementById('before');before.focus();enter();await wait(30);
 const entryTop=ui().querySelector('.lf-fs-top'),entryBottom=ui().querySelector('.lf-fs-bottom'),entryControls=Array.from(ui().querySelectorAll('.lf-fs-center button'));
 const entrySample={top:new DOMMatrix(getComputedStyle(entryTop).transform).m42,bottom:new DOMMatrix(getComputedStyle(entryBottom).transform).m42,delays:entryControls.map(node=>getComputedStyle(node).animationDelay)};
 const geometrySamples=[];for(let i=0;i<10;i++){await new Promise(requestAnimationFrame);geometrySamples.push({root:rect(root),video:rect(video),container:rect(parent),full:full(root)&&full(video)&&full(parent)});}await wait(120);
 const geometryOwners=[root,video,parent,root.parentElement];
 result('fullscreen-geometry-has-no-inherited-layout-tweens',geometrySamples.every(sample=>sample.full)&&geometryOwners.every(node=>node.getAnimations().length===0&&parseFloat(getComputedStyle(node).transitionDuration)===0),{geometrySamples,transitions:geometryOwners.map(node=>getComputedStyle(node).transitionDuration),animations:geometryOwners.map(node=>node.getAnimations().length)});
 result('directional-controls-entry-settles-without-resident-animations',entrySample.top<0&&entrySample.bottom>0&&entrySample.delays.join(',')==='0.024s,0s,0.048s'&&entryTop.getAnimations().length===0&&entryBottom.getAnimations().length===0&&entryControls.every(node=>node.getAnimations().length===0),{entrySample,settledTop:getComputedStyle(entryTop).transform,settledBottom:getComputedStyle(entryBottom).transform});
 result('webkit-fullscreen-layout-and-safe-area-metadata',full(root)&&full(video)&&full(ui())&&getComputedStyle(video).objectFit==='contain'&&getComputedStyle(document.documentElement).overflow==='hidden'&&document.querySelector('meta[name=viewport]').content.includes('viewport-fit=cover'),{viewport:{width:innerWidth,height:innerHeight},root:rect(root),video:rect(video),ui:rect(ui()),videoFit:getComputedStyle(video).objectFit});
 const controls=Array.from(ui().querySelectorAll('button,input')).filter(node=>!node.closest('[hidden]')),hits=controls.map(node=>{const r=rect(node);const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {label:node.getAttribute('aria-label'),width:r.width,height:r.height,hittable:hit===node||node.contains(hit)}});
 result('webkit-control-hit-areas',hits.every(x=>x.hittable&&x.height>=44&&x.width>=44),{hits});
 result('media-continuity-on-entry',video.parentElement===parent&&video.currentTime===40&&!paused&&calls.length===0,{time:video.currentTime,paused,calls:calls.length});
 const mutations=new MutationObserver(()=>{});mutations.observe(ui(),{subtree:true,attributes:true,childList:true,characterData:true});
 for(let i=0;i<12;i++)video.dispatchEvent(new Event('timeupdate'));
 const unchangedMutations=mutations.takeRecords().length;mutations.disconnect();
 result('unchanged-media-events-leave-controls-and-chapters-idle',unchangedMutations===0,{events:12,domMutations:unchangedMutations});
 ui().click();await wait(220);
 const hiddenSample={hidden:ui().hasAttribute('data-hidden'),opacity:getComputedStyle(entryTop).opacity,top:new DOMMatrix(getComputedStyle(entryTop).transform).m42,bottom:new DOMMatrix(getComputedStyle(entryBottom).transform).m42,tabIndex:entryControls[1].tabIndex,pointerEvents:getComputedStyle(entryTop).pointerEvents};
 ui().click();await wait(220);
 result('controls-reveal-reverses-direction-and-restores-input',hiddenSample.hidden&&hiddenSample.opacity==='0'&&hiddenSample.top<0&&hiddenSample.bottom>0&&hiddenSample.tabIndex===-1&&hiddenSample.pointerEvents==='none'&&!ui().hasAttribute('data-hidden')&&entryControls[1].tabIndex===0&&getComputedStyle(entryTop).opacity==='1'&&video.currentTime===40&&!paused,{hiddenSample,shownOpacity:getComputedStyle(entryTop).opacity,time:video.currentTime});
 const speedButton=ui().querySelector('.lf-fs-speed-button'),speedPanel=ui().querySelector('.lf-fs-speed-panel'),speedChoice=rate=>speedPanel.querySelector('[data-rate="'+rate+'"]');
 speedButton.click();await wait(200);
 const speedRect=rect(speedPanel),speedHits=Array.from(speedPanel.querySelectorAll('[data-rate]')).map(node=>{const r=rect(node),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {rate:node.getAttribute('data-rate'),width:r.width,height:r.height,hittable:node===hit||node.contains(hit)};});
 result('speed-picker-compact-layout-accessibility-and-targets',!speedPanel.hidden&&speedPanel.getAttribute('role')==='menu'&&document.activeElement===speedChoice(1)&&speedRect.x>=0&&speedRect.y>=0&&speedRect.x+speedRect.width<=innerWidth&&speedRect.y+speedRect.height<=innerHeight&&speedHits.every(hit=>hit.width>=44&&hit.height>=44&&hit.hittable),{viewport:{width:innerWidth,height:innerHeight},panel:speedRect,hits:speedHits,focusedRate:document.activeElement.getAttribute('data-rate')});
 report({snapshot:'speed-picker'});await wait(60);speedChoice(1.5).click();
 const immediateRate=video.playbackRate,rateLabel=speedButton.textContent,keyboardFocusRestored=document.activeElement===speedButton;
 video.playbackRate=1.75;video.dispatchEvent(new Event('ratechange'));
 result('speed-selection-and-external-rate-remain-authoritative',immediateRate===1.5&&rateLabel==='1,5×'&&speedPanel.hidden&&keyboardFocusRestored&&speedButton.textContent==='1,75×'&&speedChoice(1.75).getAttribute('aria-checked')==='true'&&video.currentTime===40&&!paused&&calls.length===0&&video.defaultPlaybackRate===1,{immediateRate,rateLabel,externalRate:video.playbackRate,externalLabel:speedButton.textContent,keyboardFocusRestored,time:video.currentTime,calls:calls.length,defaultPlaybackRate:video.defaultPlaybackRate});
 const keptRate=video.playbackRate;Object.defineProperty(video,'playbackRate',{configurable:true,get:()=>keptRate,set(){}});speedButton.click();speedChoice(2).click();
 const unsupportedMessage=speedPanel.querySelector('[role=status]');result('unsupported-speed-does-not-create-false-selection',!speedPanel.hidden&&speedButton.textContent==='1,75×'&&speedChoice(2).getAttribute('aria-checked')==='false'&&!unsupportedMessage.hidden&&unsupportedMessage.textContent.includes('weiterhin'),{actualRate:video.playbackRate,label:speedButton.textContent,message:unsupportedMessage.textContent});delete video.playbackRate;
 speedChoice(1.75).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));result('speed-keyboard-escape-restores-trigger-within-fullscreen',speedPanel.hidden&&document.activeElement===speedButton&&testWindow.__langformFullscreen.isOpen(),{hidden:speedPanel.hidden,focus:document.activeElement.className,fullscreen:testWindow.__langformFullscreen.isOpen()});
 function speedTap(node){node.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:2,isPrimary:true}));node.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));}
 speedTap(speedButton);speedTap(speedChoice(1.25));const touchRate=video.playbackRate,touchFocusOwned=ui().contains(document.activeElement);await wait(3120);
 result('touch-speed-selection-releases-focus-and-controls-autohide',touchRate===1.25&&!touchFocusOwned&&speedPanel.hidden&&ui().hasAttribute('data-hidden')&&video.currentTime===40&&!paused,{touchRate,touchFocusOwned,controlsHidden:ui().hasAttribute('data-hidden'),time:video.currentTime});ui().click();video.playbackRate=1;video.dispatchEvent(new Event('ratechange'));
 const feedback=()=>ui()?.querySelector('.lf-fs-feedback'),effects=node=>Array.from(node.querySelectorAll('*')).flatMap(child=>child.getAnimations());
 ui().querySelector('[data-action=forward]').click();const firstFeedback=feedback(),firstEffects=effects(firstFeedback),oldCompletion=firstEffects.at(-1).onfinish,immediateSkip=video.currentTime;
 await wait(80);ui().querySelector('[data-action=forward]').click();const secondFeedback=feedback(),accumulatedSkip=video.currentTime;oldCompletion();await wait(160);
 const forwardButton=ui().querySelector('[data-action=forward]'),forwardRect=rect(forwardButton),forwardHit=document.elementFromPoint(forwardRect.x+forwardRect.width/2,forwardRect.y+forwardRect.height/2),feedbackOpacity=getComputedStyle(secondFeedback.querySelector('.lf-fs-feedback-content')).opacity;
 result('seek-feedback-accumulates-without-blocking-or-stale-completions',immediateSkip===50&&accumulatedSkip===60&&secondFeedback.textContent==='+20 s'&&secondFeedback===feedback()&&!firstFeedback.isConnected&&firstEffects.every(effect=>effect.playState==='idle')&&forwardButton.contains(forwardHit)&&secondFeedback.getAttribute('aria-hidden')==='true'&&Number(feedbackOpacity)>.98,{immediateSkip,accumulatedSkip,label:secondFeedback.textContent,pointerEvents:getComputedStyle(secondFeedback).pointerEvents,hittable:forwardButton.contains(forwardHit),feedbackOpacity});
 report({snapshot:'skip-feedback'});await wait(60);
 ui().querySelector('[data-action=back]').click();const changedDirection=feedback().textContent;video.currentTime=117;ui().querySelector('[data-action=forward]').click();const clampedFeedback=feedback().textContent,clampedTime=video.currentTime;
 ui().querySelector('[data-action=forward]').click();result('seek-feedback-direction-reset-and-clamped-distance',changedDirection==='−10 s'&&clampedFeedback==='+3 s'&&clampedTime===120&&!feedback(),{changedDirection,clampedFeedback,clampedTime,noBoundaryConfirmation:!feedback()});
 video.currentTime=40;video.dispatchEvent(new Event('timeupdate'));ui().querySelector('[data-action=play]').click();const pausedImmediately=paused,pauseConfirmation=feedback()?.getAttribute('data-kind'),pauseCalls=calls.length;
 await wait(160);report({snapshot:'pause-feedback'});await wait(60);ui().querySelector('[data-action=play]').click();const playingImmediately=!paused,playConfirmation=feedback()?.getAttribute('data-kind'),playEffects=effects(feedback());await wait(390);
 result('actual-playback-feedback-finishes-and-releases-compositor-effects',pausedImmediately&&pauseConfirmation==='pause'&&pauseCalls===1&&playingImmediately&&playConfirmation==='play'&&calls.length===2&&!feedback()&&playEffects.every(effect=>effect.playState==='idle')&&video.currentTime===40,{pausedImmediately,pauseConfirmation,playingImmediately,playConfirmation,calls:calls.length,remainingFeedback:!!feedback(),effects:playEffects.map(effect=>effect.playState)});calls.length=0;
 ui().querySelector('[data-action=forward]').click();const reducedOld=feedback(),reducedEffects=effects(reducedOld),reducedCompletion=reducedEffects.at(-1).onfinish;motionPreference.matches=true;motionPreference.dispatchEvent(new Event('change'));reducedCompletion();ui().querySelector('[data-action=forward]').click();
 result('reduce-motion-cancels-feedback-and-preserves-immediate-seek',!reducedOld.isConnected&&!feedback()&&reducedEffects.every(effect=>effect.playState==='idle')&&video.currentTime===60,{time:video.currentTime,remainingFeedback:!!feedback(),effects:reducedEffects.map(effect=>effect.playState)});motionPreference.matches=false;motionPreference.dispatchEvent(new Event('change'));
 ui().querySelector('[data-action=back]').click();const backgroundFeedback=feedback(),backgroundEffects=effects(backgroundFeedback);Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
 result('background-cleans-up-feedback-without-changing-media',!backgroundFeedback.isConnected&&!feedback()&&backgroundEffects.every(effect=>effect.playState==='idle')&&video.currentTime===50&&!paused,{time:video.currentTime,remainingFeedback:!!feedback()});delete document.hidden;video.currentTime=40;video.dispatchEvent(new Event('timeupdate'));
 ui().querySelector('[data-action=forward]').click();const range=ui().querySelector('input');range.value='73';range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new Event('change',{bubbles:true}));
 result('explicit-seek-and-playback-preservation',video.currentTime===73&&!paused&&calls.length===0&&range.parentElement.style.getPropertyValue('--progress').startsWith('60.833'),{time:video.currentTime,progress:range.parentElement.style.getPropertyValue('--progress')});
 const chapterLabel=ui().querySelector('.lf-fs-chapter-label'),namedBefore=chapterLabel.textContent,clockBefore=ui().querySelector('[data-clock]').textContent;
 chapterLabel.click();const chapterPanel=ui().querySelector('.lf-fs-chapter-panel');speedButton.click();const speedDismissedChapters=chapterPanel.hidden&&!speedPanel.hidden;chapterLabel.click();
 result('speed-and-chapter-popovers-share-one-active-layer',speedDismissedChapters&&speedPanel.hidden&&!chapterPanel.hidden,{speedDismissedChapters,speedHidden:speedPanel.hidden,chaptersHidden:chapterPanel.hidden});
 await wait(200);chapterPanel.scrollTop=chapterPanel.scrollHeight-chapterPanel.clientHeight;
 const chapterRow=chapterPanel.querySelector('[data-lf-fs-chapter-start="75"]'),chapterRect=rect(chapterRow),chapterHit=document.elementFromPoint(chapterRect.x+chapterRect.width/2,chapterRect.y+chapterRect.height/2);
 const markers=ui().querySelector('.lf-fs-chapter-markers'),markerRect=rect(markers),rangeRect=rect(range),markerFractions=Array.from(markers.children).map(node=>node.style.left);
 const gapHits=Array.from(markers.children).map(node=>{const r=rect(node),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {width:r.width,hittableRange:hit===range,height:r.height};});
 const segmentedTrack=getComputedStyle(range,'::-webkit-slider-runnable-track').backgroundColor;
 result('segmented-chapter-track-keeps-native-thumb-and-hit-surface',range.parentElement.hasAttribute('data-lf-fs-segmented')&&markers.getAttribute('aria-hidden')==='true'&&Math.abs(markerRect.x-rangeRect.x-7)<.5&&Math.abs(markerRect.width-(rangeRect.width-14))<.5&&gapHits.every(gap=>gap.width>0&&gap.width<=3.01&&gap.height===3&&gap.hittableRange),{rangeRect,markerRect,gapHits,segmentedTrack,progress:range.parentElement.style.getPropertyValue('--progress')});
 report({snapshot:'chapter-segments'});await wait(300);
 chapterRow.click();const immediateChapterTime=video.currentTime;
 const closingInert=chapterPanel.inert&&chapterPanel.hasAttribute('inert')&&!chapterPanel.hidden,closingFocus=document.activeElement===chapterLabel;
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
 result('keyboard-tab-skips-inert-chapter-list-during-close',closingInert&&closingFocus&&document.activeElement===speedButton,{closingInert,closingFocus,focus:document.activeElement.className,time:video.currentTime});
 await Promise.allSettled(chapterPanel.getAnimations().map(animation=>animation.finished));await wait(20);
 result('named-chapter-picker-time-seek-and-marker-alignment',namedBefore.includes('Das Thema')&&clockBefore==='1:13 / 2:00'&&chapterRow.contains(chapterHit)&&immediateChapterTime===75&&video.currentTime===75&&chapterLabel.textContent.includes('Fazit')&&chapterPanel.hidden&&markerFractions.join(',')==='25%,62.5%'&&Math.abs(markerRect.y+markerRect.height/2-(rangeRect.y+rangeRect.height/2))<1,{namedBefore,clockBefore,chapterTime:video.currentTime,immediateChapterTime,markerFractions,markerRect,rangeRect,rowHittable:chapterRow.contains(chapterHit),chapterPanelHidden:chapterPanel.hidden,currentChapter:chapterLabel.textContent});
 range.focus();testWindow.__langformFullscreen.exit('abcdefghijk');await wait(20);
 result('exit-restores-focus-overflow-metadata-and-styles',!ui()&&document.activeElement===before&&document.querySelector('meta[name=viewport]').content===oldMeta&&getComputedStyle(document.documentElement).overflow==='auto'&&JSON.stringify(oldStyles)===JSON.stringify([root,video,parent.parentElement,document.documentElement].map(n=>n.getAttribute('style')))&&!root.parentElement.hasAttribute('inert')&&video.currentTime===75&&!paused,{focus:document.activeElement.id,overflow:getComputedStyle(document.documentElement).overflow,meta:document.querySelector('meta[name=viewport]').content,time:video.currentTime});
 const fullscreenButton=root.querySelector('.ytp-fullscreen-button');fullscreenButton.addEventListener('touchstart',()=>video.webkitEnterFullscreen());
 function touch(name,points,ended){const event=new Event(name,{bubbles:true,cancelable:true});Object.defineProperties(event,{touches:{value:points},changedTouches:{value:ended||points}});fullscreenButton.dispatchEvent(event);return event;}
 const point={identifier:1,clientX:20,clientY:20};touch('touchstart',[point]);const end=touch('touchend',[],[point]);fullscreenButton.click();
 result('owned-native-touchstart-fallback',testWindow.__langformFullscreen.isOpen()&&nativeCalls===0&&end.defaultPrevented&&video.currentTime===75&&!paused,{nativeCalls,touchendPrevented:end.defaultPrevented,time:video.currentTime});
 testWindow.__langformFullscreen.exit('abcdefghijk');
 // Apply the production reduce-motion CSSOM rules as an unconditional fixture
 // override. This verifies WebKit's actual computed style, without changing the
 // user's macOS accessibility setting or claiming its media query was enabled.
 const sheet=document.getElementById('langform-fullscreen-style').sheet;
 const reduceRule=Array.from(sheet.cssRules).find(rule=>rule.conditionText&&rule.conditionText.includes('prefers-reduced-motion'));
 const override=document.createElement('style');override.textContent=Array.from(reduceRule.cssRules).map(rule=>rule.cssText).join('\n');document.head.appendChild(override);
 enter();await wait(40);const top=ui().querySelector('.lf-fs-top'),play=ui().querySelector('[data-action=play]');
 result('webkit-reduced-motion-rules',getComputedStyle(top).animationName==='none'&&parseFloat(getComputedStyle(top).transitionDuration)===0&&getComputedStyle(play).animationName==='none'&&parseFloat(getComputedStyle(play).transitionDuration)===0&&top.getAnimations().length===0&&Array.from(ui().querySelectorAll('button,button svg')).every(node=>node.getAnimations().length===0),{mode:'production CSSOM rules applied as fixture override',systemPreference:matchMedia('(prefers-reduced-motion:reduce)').matches,animation:getComputedStyle(top).animationName,transition:getComputedStyle(top).transitionDuration});
 const reducedSpeedButton=ui().querySelector('.lf-fs-speed-button'),reducedSpeedPanel=ui().querySelector('.lf-fs-speed-panel');reducedSpeedButton.click();
 result('speed-picker-respects-reduced-motion-with-immediate-controls',!reducedSpeedPanel.hidden&&reducedSpeedPanel.getAnimations().length===0&&getComputedStyle(reducedSpeedPanel).animationName==='none'&&document.activeElement===reducedSpeedPanel.querySelector('[aria-checked=true]'),{animation:getComputedStyle(reducedSpeedPanel).animationName,activeEffects:reducedSpeedPanel.getAnimations().length});document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 const scrub=ui().querySelector('input'),scrubWidth=rect(scrub).width - 14,secondsPerPixel=120/scrubWidth;
 const snapCount=()=>messages.filter(value=>value.kind==='chapter-snap').length;
 function pointer(name){scrub.dispatchEvent(new PointerEvent(name,{bubbles:true,pointerType:'touch',pointerId:1,isPrimary:true}));}
 function preview(value){scrub.value=String(value);scrub.dispatchEvent(new Event('input',{bubbles:true}));return Number(scrub.value);}
 const snapBefore=snapCount(),timeBeforeSnap=video.currentTime;pointer('pointerdown');
 const entered=preview(30-7*secondsPerPixel),previewClock=ui().querySelector('[data-clock]').textContent,previewName=ui().querySelector('.lf-fs-chapter-label').textContent;
 const previewDidNotSeek=video.currentTime===timeBeforeSnap,sticky=preview(30+10*secondsPerPixel),released=preview(30+13*secondsPerPixel),reentered=preview(30+7*secondsPerPixel),detentMessages=snapCount()-snapBefore;
 scrub.dispatchEvent(new Event('change',{bubbles:true}));pointer('pointerup');
 result('chapter-detent-preview-hysteresis-and-commit',entered===30&&sticky===30&&released!==30&&reentered===30&&previewDidNotSeek&&previewClock==='0:30 / 2:00'&&previewName.includes('Das Thema')&&detentMessages===2&&video.currentTime===30&&!paused&&calls.length===0,{width:scrubWidth,entered,sticky,released,reentered,previewDidNotSeek,previewClock,previewName,detentMessages,committed:video.currentTime});
 paused=true;video.dispatchEvent(new Event('pause'));const pausedSnapBefore=snapCount();pointer('pointerdown');const pausedPreview=preview(75-7*secondsPerPixel),pausedDidNotSeek=video.currentTime===30;
 scrub.dispatchEvent(new Event('change',{bubbles:true}));pointer('pointerup');const pausedCommit=video.currentTime;
 scrub.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));const keyboardPreview=preview(76);scrub.dispatchEvent(new Event('change',{bubbles:true}));
 result('chapter-detent-paused-and-keyboard-preservation',pausedPreview===75&&pausedDidNotSeek&&pausedCommit===75&&paused&&keyboardPreview===76&&video.currentTime===76&&snapCount()-pausedSnapBefore===1&&calls.length===0,{pausedPreview,pausedDidNotSeek,pausedCommit,keyboardPreview,paused,detentMessages:snapCount()-pausedSnapBefore});
 const denseTimeBefore=video.currentTime,denseMessagesBefore=snapCount();video.duration=scrubWidth/4;
 document.documentElement.__langformChapterList=[{start:0,title:'Einleitung'},{start:20,title:'Dicht A'},{start:21,title:'Dicht B'},{start:60,title:'Ende'}];
 video.dispatchEvent(new Event('loadedmetadata'));pointer('pointerdown');const denseA=preview(20);
 const jitterA=[20.4,20.5,20.6].map(preview),denseB=preview(21),jitterB=[20.6,20.5,20.4].map(preview),denseName=ui().querySelector('.lf-fs-chapter-label').textContent;
 const denseDidNotSeek=video.currentTime===denseTimeBefore;scrub.dispatchEvent(new Event('change',{bubbles:true}));pointer('pointerup');
 result('dense-four-pixel-detent-handoff-and-midpoint-jitter',denseA===20&&jitterA.every(value=>value===20)&&denseB===21&&jitterB.every(value=>value===21)&&denseDidNotSeek&&video.currentTime===21&&denseName.includes('Dicht B')&&snapCount()-denseMessagesBefore===2&&paused,{gapPixels:scrubWidth/video.duration,denseA,jitterA,denseB,jitterB,denseDidNotSeek,committed:video.currentTime,denseLabel:denseName,detentMessages:snapCount()-denseMessagesBefore,paused});
 video.duration=120;document.documentElement.__langformChapterList=chapterItems;video.dispatchEvent(new Event('loadedmetadata'));
 const savedProducer={response:testWindow.ytInitialPlayerResponse,initialData:testWindow.ytInitialData,cache:testWindow.__langformChapterCache,list:document.documentElement.__langformChapterList,owner:document.documentElement.__langformChapterVideoID,time:video.currentTime,duration:video.duration};
 // Keep the baseline watch ID while using the real minimal mobile renderer shape.
 const rebasedMobile=JSON.parse(JSON.stringify(mobileChapterFixture).replaceAll('x-ZRLIdXBRU','abcdefghijk'));
 const actualRenderers=rebasedMobile.initialData.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer.decoratedPlayerBarRenderer.playerBar.multiMarkersPlayerBarRenderer.markersMap[0].value.chapters;
 const producerTitles=actualRenderers.map(item=>item.chapterRenderer.title.runs.map(run=>run.text).join('')),producerStarts=[0,95.88,204];
 for(const producerKind of ['overlays','macromarkers']){
  delete document.documentElement.__langformChapterList;delete document.documentElement.__langformChapterVideoID;testWindow.__langformChapterCache=null;
  const playerWithoutChapters=rebasedMobile.player;
  const hydratedInitial={currentVideoEndpoint:{watchEndpoint:{videoId:'abcdefghijk'}}};testWindow.ytInitialPlayerResponse=playerWithoutChapters;testWindow.ytInitialData=JSON.stringify(hydratedInitial);video.duration=312;video.currentTime=40;
  captionsApi.refreshChapters(testWindow);video.dispatchEvent(new Event('loadedmetadata'));const initiallyAbsent=!(document.documentElement.__langformChapterList||[]).length&&testWindow.__langformChapterCache===null;
  if(producerKind==='overlays')hydratedInitial.playerOverlays=rebasedMobile.initialData.playerOverlays;
  else hydratedInitial.engagementPanels=[{engagementPanelSectionListRenderer:{content:{macroMarkersListRenderer:{contents:producerStarts.map((start,index)=>({macroMarkersListItemRenderer:{title:{runs:[{text:producerTitles[index]}]},onTap:{watchEndpoint:{videoId:'abcdefghijk',startTimeSeconds:start}}}}))}}}}];
  testWindow.ytInitialData=JSON.stringify(hydratedInitial);captionsApi.refreshChapters(testWindow);video.dispatchEvent(new Event('loadedmetadata'));
  const publishedStarts=(document.documentElement.__langformChapterList||[]).map(item=>item.start),producerRows=ui().querySelectorAll('.lf-fs-chapter-row').length,producerTicks=ui().querySelector('.lf-fs-chapter-markers').children.length;
  const producerOriginalTime=video.currentTime;pointer('pointerdown');const producerPreview=preview(95.88-7*312/scrubWidth),producerPreviewName=ui().querySelector('.lf-fs-chapter-label').textContent,producerClock=ui().querySelector('[data-clock]').textContent;const producerBeforeCommit=video.currentTime;
  scrub.dispatchEvent(new Event('change',{bubbles:true}));pointer('pointerup');const producerCommit=video.currentTime;
  result('shipping-producer-hydration-to-fullscreen-'+producerKind,initiallyAbsent&&publishedStarts.length===3&&publishedStarts.every((value,index)=>Math.abs(value-producerStarts[index])<1e-6)&&document.documentElement.__langformChapterVideoID==='abcdefghijk'&&producerRows===3&&producerTicks===2&&producerPreviewName.includes(producerTitles[1])&&producerClock==='1:35 / 5:12'&&Math.abs(producerCommit-95.88)<1e-6&&producerBeforeCommit===producerOriginalTime&&paused,{initiallyAbsent,initialDataType:typeof testWindow.ytInitialData,fixtureSource:mobileChapterFixture.source.url,fixtureOwnerRebased:true,publishedStarts,producerRows,producerTicks,quantizedDOMRange:producerPreview,producerPreviewName,producerClock,producerCommit,producerBeforeCommit,paused});
  hydratedInitial.currentVideoEndpoint.watchEndpoint.videoId='zyxwvutsrqp';testWindow.ytInitialData=JSON.stringify(hydratedInitial);captionsApi.refreshChapters(testWindow);video.dispatchEvent(new Event('loadedmetadata'));
  result('shipping-producer-stale-initialdata-rejected-'+producerKind,!(document.documentElement.__langformChapterList||[]).length&&ui().querySelector('.lf-fs-chapter-label').hidden&&ui().querySelectorAll('.lf-fs-chapter-row').length===0&&ui().querySelector('.lf-fs-chapter-markers').hidden,{owner:document.documentElement.__langformChapterVideoID||'',rows:ui().querySelectorAll('.lf-fs-chapter-row').length,labelHidden:ui().querySelector('.lf-fs-chapter-label').hidden});
 }
 const locationBefore={...testLocation};testLocation.pathname='/';testLocation.href='https://m.youtube.com/';captionsApi.refreshChapters(testWindow);Object.assign(testLocation,locationBefore);
 testWindow.ytInitialPlayerResponse=savedProducer.response;testWindow.ytInitialData=savedProducer.initialData;testWindow.__langformChapterCache=savedProducer.cache;document.documentElement.__langformChapterList=savedProducer.list;document.documentElement.__langformChapterVideoID=savedProducer.owner;video.duration=savedProducer.duration;video.currentTime=savedProducer.time;video.dispatchEvent(new Event('loadedmetadata'));
 testWindow.__langformFullscreen.exit('abcdefghijk');override.remove();
 enter();ui().remove();await wait(20);
 result('external-ui-removal-restores-interaction',!root.closest('[inert]')&&!testWindow.__langformFullscreen.isOpen()&&!document.documentElement.hasAttribute('data-langform-fullscreen')&&document.querySelector('meta[name=viewport]').content===oldMeta,{inert:!!root.closest('[inert]'),uiExists:!!ui()});
 const attributeCases=[];
 for(const owner of ['html','player','ancestor']){enter();const target=owner==='html'?document.documentElement:owner==='player'?root:root.parentElement;const name=owner==='html'?'data-langform-fullscreen':owner==='player'?'data-langform-fullscreen-player':'data-langform-fullscreen-ancestor';target.removeAttribute(name);await wait(20);attributeCases.push({owner,passed:!ui()&&!root.closest('[inert]')&&!testWindow.__langformFullscreen.isOpen()});}
 result('owned-attribute-loss-restores-interaction',attributeCases.every(value=>value.passed),{cases:attributeCases});
 enter();document.getElementById('langform-fullscreen-style').remove();await wait(20);const callsBefore=nativeCalls;touch('touchstart',[point]);touch('touchend',[],[point]);fullscreenButton.click();
 result('stylesheet-loss-restores-and-keeps-native-fallback',!ui()&&!root.closest('[inert]')&&!testWindow.__langformFullscreen.isOpen()&&nativeCalls===callsBefore+1,{inert:!!root.closest('[inert]'),nativeFallbackCalls:nativeCalls-callsBefore});
 report({finished:true,passed:errors.length===0&&results.every(x=>x.passed),count:results.length,errors,engine:'macOS WKWebView, substituted media/location',sourceFingerprints});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack}));
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(head + setup + tests + '</script></body></html>')
print(args.output)
