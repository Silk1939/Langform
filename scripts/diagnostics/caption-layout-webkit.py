#!/usr/bin/env python3
"""Replay measured live caption geometry against actual shipping controls in WebKit."""
import argparse,json,subprocess,tempfile,hashlib
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True,type=Path);p.add_argument('--before',action='store_true');p.add_argument('--settings-source',type=Path);a=p.parse_args();repo=Path(__file__).resolve().parents[2];src=repo/'ios/Langform/Langform'
with tempfile.TemporaryDirectory() as d:
 b=Path(d)/'base.html';subprocess.run(['python3',str(repo/'scripts/diagnostics/player-settings-webkit.py'),'--output',str(b)],check=True,capture_output=True);html=b.read_text().split('function check(name,passed,info={})')[0]
names=['PlayerSettings.js','FullscreenMotion.js'];hashes={}
for name in names:
 text=(repo/'docs/qa/motion-polish-2026-10-15/controls/caption-layout'/('before-'+name)).read_text() if a.before else (src/name).read_text()
 if name=='PlayerSettings.js' and a.settings_source:text=a.settings_source.read_text()
 if a.before or name=='PlayerSettings.js' and a.settings_source:html=html.replace(json.dumps((src/name).read_text()),json.dumps(text))
 hashes[name]=hashlib.sha256(text.encode()).hexdigest()
html=html.replace('paused:{value:true}','paused:{value:true,configurable:true}')
html+='''
w.ytInitialPlayerResponse={videoDetails:{videoId:'abcdefghijk'}};document.documentElement.__langformChapterVideoID='abcdefghijk';document.documentElement.__langformChapterList=[{start:0,title:'Ein langer Kapitelname mit zusätzlichen Informationen und unveränderten Playerbuttons'},{start:90,title:'Zweites Kapitel'}];
'''
html+='new Function("window",'+json.dumps((src/'FullscreenChapters.js').read_text())+')(w);\n'
html+=r'''
const checks=[];function check(name,passed,info={}){checks.push({name,passed,...info});report(checks.at(-1));}
function box(n){const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}
function hit(n){const r=box(n),t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return n===t||n.contains(t)}
function overlap(a,b){return a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y;}
function refresh(){if(w.__langformPlayerSettings.refreshCaptions)w.__langformPlayerSettings.refreshCaptions();else dispatchEvent(new Event('video-data-change'));}
const style=document.createElement('style');style.textContent='ytm-player{margin-top:107px}.caption-fixture-native{position:absolute;pointer-events:none}.player-controls-middle{left:86.5px;top:82.5px;width:220px;height:56px;background:#ffffff20}.player-controls-bottom{left:12px;top:147.1px;width:303px;height:44px;background:#ffffff20}.ytp-caption-window-container{position:absolute;inset:0;width:calc(100% - 48px)}.caption-window{position:absolute;box-sizing:content-box;padding:0 8px;color:white;background:#000b;font:15px/26px -apple-system;white-space:pre;text-align:center;margin-bottom:16px;margin-left:-106px}.caption-window span{display:block}html[data-langform-fullscreen] .caption-fixture-native{visibility:hidden}';document.head.appendChild(style);
for(const [cls,text]of[['player-controls-middle','Native center controls'],['player-controls-bottom','0:37 / 22:23 · Intro']]){const n=document.createElement('div');n.className=cls+' caption-fixture-native';n.textContent=text;root.parentElement.appendChild(n);}
const container=document.createElement('div');container.className='ytp-caption-window-container';root.appendChild(container);const caption=document.createElement('div');caption.className='caption-window ytp-caption-window-bottom';caption.style.cssText='bottom:2%;left:50%;width:212px';caption.innerHTML='<span>But for this particular show,</span><span>we are going to be focusing on</span>';container.appendChild(caption);
Object.defineProperty(video,'paused',{value:false,configurable:true});
const native=Array.from(document.querySelectorAll('.caption-fixture-native'));
async function inspect(mode){
 const fs=mode==='fullscreen',ui=document.getElementById('langform-fullscreen-ui'),controls=fs?Array.from(ui.querySelectorAll('.lf-fs-top button,.lf-fs-title,.lf-fs-center button,.lf-fs-chapters,.lf-fs-time,.lf-fs-range-wrap')):native.concat(document.querySelector('.lf-player-settings[data-inline]'));
 refresh();await sleep(60);const r=box(caption),collisions=controls.filter(n=>box(n).width>0&&box(n).height>0&&overlap(r,box(n)));
 check(mode+' measured two-line caption clears visible controls',!collisions.length,{caption:r,collisions:collisions.map(n=>({class:n.className,rect:box(n)}))});
 const bounds=box(root);check(mode+' caption remains inside player',r.x>=bounds.x&&r.y>=bounds.y&&r.right<=bounds.right&&r.bottom<=bounds.bottom,{caption:r,bounds});
 check(mode+' two lines remain visible without text clipping',caption.querySelectorAll('span').length===2&&caption.scrollWidth<=caption.clientWidth&&caption.scrollHeight<=caption.clientHeight,{scroll:[caption.scrollWidth,caption.scrollHeight],client:[caption.clientWidth,caption.clientHeight]});
 const first=caption.style.translate;refresh();await sleep(30);check(mode+' repeated update has no cumulative displacement',caption.style.translate===first,{translate:first});
 check(mode+' authored anchor and text settings preserved',caption.style.bottom==='2%'&&caption.style.left==='50%'&&caption.style.transform==='');
 if(fs)check(mode+' top and center controls remain hittable',Array.from(ui.querySelectorAll('.lf-fs-top button,.lf-fs-center button')).every(hit));
 report({snapshot:mode+'-caption-controls'});await sleep(90);
 if(fs){ui.setAttribute('data-hidden','');await sleep(30);ui.getAnimations({subtree:true}).forEach(a=>a.finish());await sleep(30);}else native.forEach(n=>n.style.opacity='0');refresh();await Promise.resolve();
 check(mode+' hidden controls restore original caption pose',caption.style.translate==='',{caption:box(caption),translate:caption.style.translate});
 if(fs){ui.removeAttribute('data-hidden');await sleep(30);ui.getAnimations({subtree:true}).forEach(a=>a.finish());await sleep(30);}else native.forEach(n=>n.style.opacity='1');refresh();await Promise.resolve();
 check(mode+' revealed controls reacquire clear caption pose',controls.every(n=>!box(n).width||!box(n).height||!overlap(box(caption),box(n))));
 if(fs){
  ui.setAttribute('data-hidden','');await sleep(30);ui.getAnimations({subtree:true}).forEach(a=>a.finish());refresh();
  check('fullscreen settled hide releases caption before reversal',caption.style.translate==='');
  ui.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
  const transitions=ui.getAnimations({subtree:true});transitions.forEach(a=>{a.pause();a.currentTime=0;});refresh();
  const samples=[];for(const progress of [0,.10,.25,.50,.75,1]){transitions.forEach(a=>a.currentTime=Number(a.effect.getTiming().duration)*progress);const visible=controls.filter(n=>{for(let p=n;p&&p.nodeType===1;p=p.parentElement)if(Number(getComputedStyle(p).opacity)===0)return false;return true;});samples.push({progress,caption:box(caption),collisions:visible.filter(n=>overlap(box(caption),box(n))).map(n=>n.className)});}
  check('fullscreen caption clears controls throughout actual reveal transition after hide',samples.every(s=>!s.collisions.length),{samples});
  transitions.forEach(a=>a.finish());refresh();report({snapshot:'fullscreen-caption-reveal-end'});
 }

}
(async()=>{
 report({resize:{width:393,height:852}});await sleep(180);await inspect('inline');
 report({resize:{width:852,height:393}});await sleep(180);document.querySelector('.ytp-fullscreen-button').click();await sleep(60);document.getAnimations().forEach(a=>a.finish());await sleep(30);
 caption.style.width='410px';caption.style.marginLeft='-205px';caption.style.fontSize='24px';caption.style.lineHeight='31px';caption.style.bottom='2%';
 await inspect('fullscreen');
 caption.style.setProperty('translate','3px 4px');refresh();check('later author translate is not overwritten',caption.style.translate==='3px 4px');
 dispatchEvent(new Event('pagehide'));check('pagehide preserves later author value',caption.style.translate==='3px 4px');check('no script errors',errors.length===0,{errors});
 report({finished:true,passed:checks.every(x=>x.passed),checks,limits:'Actual shipping layout; inline rectangles copied from live40 probe, caption text and media synthetic, fullscreen original caption dimensions representative; final live40 supplies real caption geometry. No FPS or heard audio.'});
})().catch(e=>report({finished:true,passed:false,error:String(e),stack:e.stack}));
</script></body></html>
'''
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(html);(a.output.parent/'sources.json').write_text(json.dumps(hashes,indent=2)+'\n');print(a.output)
