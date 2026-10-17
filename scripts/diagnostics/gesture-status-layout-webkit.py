#!/usr/bin/env python3
"""Actual WK geometry of shipping gesture statuses against shipping fullscreen controls."""
import argparse,json,subprocess,tempfile,hashlib
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--fullscreen-source',type=Path);p.add_argument('--settings-source',type=Path);p.add_argument('--portrait',action='store_true');p.add_argument('--safe-insets',action='store_true');p.add_argument('--live-caption',action='store_true');a=p.parse_args();repo=Path(__file__).resolve().parents[2];src=repo/'ios/Langform/Langform'
with tempfile.TemporaryDirectory() as d:
 b=Path(d)/'base.html';subprocess.run(['python3',str(repo/'scripts/diagnostics/player-settings-webkit.py'),'--output',str(b)],check=True,capture_output=True);prefix=b.read_text().split('function check(name,passed,info={})')[0]
if a.settings_source:prefix=prefix.replace(json.dumps((src/'PlayerSettings.js').read_text()),json.dumps(a.settings_source.read_text()))
if a.fullscreen_source:prefix=prefix.replace(json.dumps((src/'FullscreenMotion.js').read_text()),json.dumps(a.fullscreen_source.read_text()))
prefix=prefix.replace('paused:{value:true}','paused:{value:false}')
prefix+='''\nObject.defineProperties(video,{currentSrc:{value:'https://example.test/a.mp4'},seekable:{value:{length:1,start:()=>0,end:()=>120}}});
w.ytInitialPlayerResponse={videoDetails:{videoId:'abcdefghijk'}};document.documentElement.__langformChapterVideoID='abcdefghijk';document.documentElement.__langformChapterList=[{start:0,title:'Ein wirklich langer Kapitelname mit vielen Zusatzinformationen und Sonderzeichen — und trotzdem erreichbaren Playerknöpfen'},{start:90,title:'Zweites Kapitel'}];\n'''
names=['FullscreenChapters.js','PlaybackHold.js','PlaybackZoom.js','PlaybackSwipe.js']
for name in names:prefix+='new Function("window",'+json.dumps((src/name).read_text())+')(w);\n'
tests='const layout='+json.dumps({'width':393 if a.portrait else 852,'height':852 if a.portrait else 393,'safeTop':59 if a.portrait and a.safe_insets else 0,'safeBottom':34 if a.portrait and a.safe_insets else 21 if a.safe_insets else 0,'safeSide':0 if a.portrait or not a.safe_insets else 59,'liveCaption':a.live_caption})+';\n'+r'''
const checks=[],samples=[];
function check(name,passed,info={}){const row={name,passed,...info};checks.push(row);report(row)}
function box(n){const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}
function hit(n){const r=box(n),t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return n===t||n.contains(t)}
function overlap(a,b){return Math.min(a.right,b.right)>Math.max(a.x,b.x)&&Math.min(a.bottom,b.bottom)>Math.max(a.y,b.y)}
function pointer(type,x,y,id=1,primary=true){const e=new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,isPrimary:primary,button:type==='pointermove'?-1:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y});document.getElementById('langform-fullscreen-ui').dispatchEvent(e);return e}
async function inspectStatus(id,name){if(layout.liveCaption){w.__langformPlayerSettings.refreshCaptions();await Promise.resolve();}const n=document.getElementById(id),ui=document.getElementById('langform-fullscreen-ui'),controls=Array.from(ui.querySelectorAll('.lf-fs-top button,.lf-fs-title,.lf-fs-chapter-label,.lf-fs-time,.lf-fs-range-wrap'));
 check(name+' shipping status actually mounted',!!n,{rate:video.playbackRate,time:video.currentTime});if(!n)return;
 const collisions=controls.filter(c=>overlap(box(n),box(c))).map(c=>({label:c.getAttribute('aria-label')||c.className,box:box(c)}));
 check(name+' status does not obscure title or controls',!collisions.length,{status:box(n),collisions});
 check(name+' status clears top safe area and representative caption zone',box(n).y>=layout.safeTop&&!overlap(box(n),box(document.querySelector('.caption-window'))),{status:box(n),safeTop:layout.safeTop,caption:box(document.querySelector('.caption-window'))});
 check(name+' buttons keep44pt hits',Array.from(ui.querySelectorAll('.lf-fs-top button')).every(c=>box(c).width>=44&&box(c).height>=44&&hit(c)));
 samples.push({name,box:box(n)});
}
(async()=>{
 report({resize:{width:layout.width,height:layout.height}});await sleep(200);check('requested viewport actually active',innerWidth===layout.width&&innerHeight===layout.height,{width:innerWidth,height:innerHeight});
 const inset={top:layout.safeTop,bottom:layout.safeBottom,left:layout.safeSide,right:layout.safeSide};for(const style of document.querySelectorAll('style'))style.textContent=style.textContent.replace(/env\(safe-area-inset-(top|bottom|left|right)\)/g,(_,edge)=>inset[edge]+'px');w.__langformStageInsets={top:layout.safeTop,bottom:layout.safeBottom};document.querySelector('.ytp-fullscreen-button').click();await sleep(40);document.getAnimations().forEach(a=>a.finish());await sleep(20);
 const ui=document.getElementById('langform-fullscreen-ui'),chapter=ui.querySelector('.lf-fs-chapter-label');
 check('long real chapter label remains within controls',!!chapter&&!chapter.hidden&&box(chapter).right<=innerWidth-20&&hit(chapter),{box:chapter&&box(chapter)});
 // Representative two-line original caption position is visual context only;
 // no assertion of current live YouTube caption sizing follows this fixture.
 const caption=document.createElement('div');caption.className='caption-window';caption.textContent='Ein mehrzeiliger Untertitel als sichtbarer Kontext\nfür die gleichzeitig geöffneten Steuerelemente';caption.style.cssText='position:fixed;left:50%;bottom:146px;transform:translateX(-50%);white-space:pre-line;background:#000b;color:white;font:18px/1.3 -apple-system;text-align:center;pointer-events:none';ui.appendChild(caption);if(layout.liveCaption){const container=document.createElement('div');container.className='ytp-caption-window-container';container.style.cssText='position:absolute;inset:0;width:calc(100% - 48px)';root.appendChild(container);container.appendChild(caption);caption.style.cssText='position:absolute;bottom:2%;left:50%;width:'+Math.min(341,innerWidth-80)+'px;margin-left:'+(-Math.min(341,innerWidth-80)/2)+'px;margin-bottom:16px;padding:0 8px;white-space:pre-line;background:#000b;color:white;font:24px/40px -apple-system;text-align:center;pointer-events:none';caption.textContent='But for this particular show,\nwe are going to be focusing on';w.__langformPlayerSettings.refreshCaptions();}
 const x=innerWidth*.14,y=innerHeight*.4;pointer('pointerdown',x,y);await sleep(410);await inspectStatus('langform-playback-hold','hold');report({snapshot:'hold-title-chapter-caption'});await sleep(100);pointer('pointerup',x,y);await sleep(40);
 pointer('pointerdown',x,y);pointer('pointerup',x,y);await sleep(60);pointer('pointerdown',x,y);pointer('pointerup',x,y);await inspectStatus('langform-playback-swipe-status','doubletap');await sleep(920);
 pointer('pointerdown',x,y);pointer('pointermove',x+100,y);pointer('pointerup',x+100,y);await inspectStatus('langform-playback-swipe-status','swipe');report({snapshot:'swipe-title-chapter-caption'});await sleep(920);
 if(layout.liveCaption){ui.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));await sleep(20);document.getAnimations().forEach(a=>a.finish());}
 const a=innerWidth*.4,b=innerWidth*.6;pointer('pointerdown',a,y,11);pointer('pointerdown',b,y,12,false);pointer('pointermove',a-30,y,11);pointer('pointermove',b+30,y,12,false);await inspectStatus('langform-playback-zoom-status','pinch');report({snapshot:'pinch-title-chapter-caption'});await sleep(120);pointer('pointerup',a-30,y,11);pointer('pointerup',b+30,y,12,false);
 const reset=ui.querySelector('.lf-playback-zoom-reset');check('zoom reset fits beside long title and settings',!!reset&&hit(reset)&&box(reset).right<=innerWidth-layout.safeSide,{box:reset&&box(reset)});
 if(reset)reset.click();if(layout.liveCaption){await sleep(40);w.__langformPlayerSettings.refreshCaptions();check('caption collision side lease restores after gesture status ends',!ui.hasAttribute('data-caption-status-side'));}check('media preserved after status probes',video.playbackRate===1&&video.currentTime>0&&video.currentTime<120&&video.paused===false,{rate:video.playbackRate,time:video.currentTime,paused:video.paused});
 check('no script errors',errors.length===0,{errors});report({finished:true,passed:checks.every(x=>x.passed),checks,samples,viewport:[innerWidth,innerHeight],simulatedInsets:inset,limits:'Actual shipping modules/statuses from synthetic contacts; URL/media/visibility supplied; long shipping chapter/title; caption geometry synthetic and measured in WebKit; no physical or FPS proof'});
})().catch(e=>report({finished:true,passed:false,error:String(e),stack:e.stack}));
'''
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(prefix+tests+'</script>');print(a.output)
(a.output.parent/'sources.json').write_text(json.dumps({name:hashlib.sha256((a.fullscreen_source if name=='FullscreenMotion.js' and a.fullscreen_source else a.settings_source if name=='PlayerSettings.js' and a.settings_source else src/name).read_bytes()).hexdigest() for name in names+['FullscreenMotion.js','PlayerSettings.js']},indent=2)+'\n')
