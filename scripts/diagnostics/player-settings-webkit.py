#!/usr/bin/env python3
"""Offline WKWebView settings geometry and frame sampling; no iPhone/media proof."""
import argparse, hashlib, json
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--source-dir',type=Path);a=p.parse_args()
repo=Path(__file__).resolve().parents[2];src=a.source_dir or repo/'ios/Langform/Langform'
sources={name:(src/name).read_text() for name in ['PlayerSettings.js','FullscreenMotion.js']}
html='''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>
html,body{margin:0;background:#121212;color:#fff;font:16px -apple-system}ytm-player{display:block;position:relative;margin-top:80px}#movie_player{position:relative;width:100%;aspect-ratio:16/9;background:linear-gradient(40deg,#375f78,#1e2836)}.html5-video-container,video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.ytp-fullscreen-button{position:absolute;bottom:10px;right:10px}main{padding:20px}player-autonav-toggle{position:absolute;display:block;right:70px;top:0}player-autonav-toggle button,.player-settings-icon{width:44px;height:44px}.player-settings-icon{position:absolute;right:22px;top:0}yt-closed-captions-toggle-button{position:absolute;right:118px;top:0}.ytmClosedCaptioningButtonButton{width:44px;height:44px}</style></head><body><ytm-player><div id="movie_player"><div class="html5-video-container"><video></video></div><button class="ytp-fullscreen-button">Vollbild</button></div><yt-closed-captions-toggle-button><ytm-closed-captioning-button><button class="ytmClosedCaptioningButtonButton" aria-pressed="false">CC</button></ytm-closed-captioning-button></yt-closed-captions-toggle-button><player-autonav-toggle><button aria-pressed="false">Original Autoplay</button></player-autonav-toggle><button class="icon-button player-settings-icon" aria-label="Einstellungen">⚙</button></ytm-player><main><h1>Ein langer Videotitel für die Prüfung der überlappungsfreien Player-Steuerelemente</h1></main><script>'''
setup=r'''
const results=[],errors=[],frames=[],commands=[];
const report=x=>window.webkit.messageHandlers.qa.postMessage(x),sleep=ms=>new Promise(r=>setTimeout(r,ms));
addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const testLocation={pathname:'/watch',href:'https://m.youtube.com/watch?v=abcdefghijk'};
const w=new Proxy({},{get(t,k){if(Reflect.has(t,k))return Reflect.get(t,k);if(k==='location')return testLocation;const v=Reflect.get(window,k);return typeof v==='function'?v.bind(window):v;}});
w.__langformRealVisibility={inactive:()=>false,hidden:()=>false};
w.webkit={messageHandlers:{langformFullscreen:{postMessage:x=>commands.push(x)}}};w.__langformFullscreenExitProtocol=1;
const root=document.getElementById('movie_player'),video=root.querySelector('video');
Object.defineProperties(video,{paused:{value:true},ended:{value:false},duration:{value:120},readyState:{value:4},currentTime:{value:40,writable:true},videoWidth:{value:1920},videoHeight:{value:1080}});
root.getVideoData=()=>({video_id:'abcdefghijk',title:'Ein sehr langer Videotitel mit Kapitel, Untertiteln und weiteren Steuerelementen ohne gegenseitige Überdeckung'});
root.getAvailableQualityLevels=()=>['highres','hd2160','hd1440','hd1080','hd720','large','medium','small','tiny'];root.setPlaybackQualityRange=(...x)=>commands.push(x);
root.getOptions=()=>['track'];root.isSubtitlesOn=()=>false;root.toggleSubtitles=()=>{};w.__langformGetQualityStatus=()=>({mode:'adaptive',actual:'hd720'});w.__langformUseAdaptiveQuality=()=>true;
const original=document.querySelector('player-autonav-toggle button');original.onclick=()=>original.setAttribute('aria-pressed',String(original.getAttribute('aria-pressed')!=='true'));
video.play=()=>{throw Error('no direct playback')};video.pause=()=>{throw Error('no direct playback')};
'''
setup+='\n'.join('new Function("window",'+json.dumps(source)+')(w);' for source in sources.values())
tests=r'''
function check(name,passed,info={}){const result={name,passed,...info};results.push(result);report(result)}
function box(n){const b=n.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom}}
function hit(n){const b=box(n),t=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return t===n||n.contains(t)}
function sheet(){return Array.from(document.querySelectorAll('.lf-player-settings-layer')).find(x=>!x.hidden)}
function sample(n){let b=box(n);return {time:performance.now(),...b,display:getComputedStyle(n).display,opacity:getComputedStyle(n).opacity,hidden:n.hidden,hit:hit(n),transform:getComputedStyle(n).transform}}
function capture(n,ms){return new Promise(resolve=>{const begin=performance.now(),out=[];function frame(){out.push(sample(n));if(performance.now()-begin<ms)setTimeout(frame,16);else resolve(out)}setTimeout(frame,16)})}
async function cycle(width,height,fullscreen){report({resize:{width,height}});await sleep(160);
 if(!fullscreen){
  const originals=Array.from(document.querySelectorAll('button.player-settings-icon,player-autonav-toggle button,yt-closed-captions-toggle-button button')),own=document.querySelector('.lf-player-settings[data-inline]'),toggle=own.querySelector('.lf-autoplay-switch');
  check('inline exact original controls hidden while their layout remains',originals.length===3&&originals.every(n=>getComputedStyle(n).visibility==='hidden'&&box(n).width===44));
  check('inline replacement gear and toggle keep actual hits',hit(toggle)&&hit(own.querySelector('.lf-settings-gear')));
  toggle.click();check('hidden original Autoplay binding still changes real ARIA',original.getAttribute('aria-pressed')==='true');toggle.click();
  root.classList.add('ad-showing');await sleep(20);check('ad restores original controls and withdraws replacements',own.hidden&&originals.every(n=>getComputedStyle(n).visibility==='visible'));root.classList.remove('ad-showing');await sleep(20);
  const under=document.createElement('button');under.textContent='Underlying recommendation';under.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:1';document.body.appendChild(under);let clicked=0;under.onclick=()=>clicked++;
  own.querySelector('.lf-settings-gear').click();document.getAnimations().forEach(a=>a.finish());await sleep(20);const closingLayer=sheet();closingLayer.querySelector('[data-setting="captions"]').click();
  const off=closingLayer.querySelector('[data-caption="false"]'),b=box(off),x=b.x+b.width/2,y=b.y+b.height/2;
  check('caption action owns actual contact before dismissal',hit(off));
  for(const type of ['pointerdown','pointerup'])off.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:6,isPrimary:true,pointerType:'touch',clientX:x,clientY:y}));
  const target=document.elementFromPoint(x,y);check('dismissed caption sheet retargets same coordinate to underlying feed',target===under,{x,y,target:target&&target.tagName,inert:closingLayer.inert});
  target.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1,clientX:x,clientY:y}));check('caption-release compatibility click cannot activate underlying feed',clicked===0,{clicked});
  document.getAnimations().forEach(a=>a.finish());w.__langformPlayerSettings.dismiss();under.remove();await sleep(30);
 }
 if(fullscreen){document.querySelector('.ytp-fullscreen-button').click();await sleep(300)}
 const owner=fullscreen?document.getElementById('langform-fullscreen-ui'):document,gear=owner.querySelector(fullscreen?'.lf-settings-gear':'.lf-player-settings[data-inline] .lf-settings-gear');report({opening:{hidden:document.hidden,disabled:gear.disabled,id:root.getVideoData().video_id,location:w.location.href}});
 if(fullscreen){const controls=Array.from(owner.querySelectorAll('.lf-fs-top button'));check(`${width}x${height} fullscreen top controls fit and remain hittable`,controls.every(n=>box(n).width>=44&&box(n).height>=44&&box(n).x>=0&&box(n).right<=width&&hit(n)),{controls:controls.map(n=>({label:n.getAttribute('aria-label'),box:box(n)}))});}
 gear.click();document.getAnimations().forEach(a=>a.finish());await sleep(40);
 const layer=sheet(),panel=layer.querySelector('.lf-settings-sheet'),back=layer.querySelector('.lf-settings-back'),heading=layer.querySelector('h2'),close=layer.querySelector('.lf-settings-close');
 const prefix=`${width}x${height} ${fullscreen?'fullscreen':'inline'}`;
 check(prefix+' root hidden back occupies no space',back.hidden&&box(back).width===0,{hidden:back.hidden,display:getComputedStyle(back).display,box:box(back)});
 check(prefix+' root sheet fits viewport',box(panel).x>=0&&box(panel).right<=width+.5&&box(panel).y>=0&&box(panel).bottom<=height+.5,{box:box(panel),scrollWidth:panel.scrollWidth,clientWidth:panel.clientWidth});
 check(prefix+' root rows hittable and >=44pt',Array.from(layer.querySelectorAll('[data-setting]')).every(n=>box(n).height>=44&&hit(n)));
 report({snapshot:(fullscreen?'fullscreen':'inline')+'-root'});await sleep(100);
 layer.querySelector('[data-setting="speed"]').click();await sleep(60);
 check(prefix+' long speed heading does not overlap close',box(heading).right<=box(close).x && box(heading).x>=box(back).right,{heading:box(heading),close:box(close),sheet:box(panel),scrollWidth:panel.scrollWidth,clientWidth:panel.clientWidth});
 check(prefix+' speed choices fit horizontal sheet',panel.scrollWidth<=panel.clientWidth,{scrollWidth:panel.scrollWidth,clientWidth:panel.clientWidth});
 check(prefix+' close remains hittable',hit(close),{box:box(close)});
 if(fullscreen){
  // Desktop WebKit has zero env() insets. Substitute only the input values of
  // the same shipping declarations to represent iPhone landscape's home area.
  const safe=document.createElement('style');safe.textContent='.lf-settings-sheet{padding-bottom:calc(12px + 21px);max-height:calc(100dvh - 40px - 0px)}';document.head.appendChild(safe);
  check(prefix+' 21pt bottom inset retains requested 40pt top clearance',box(panel).y>=39.5&&box(panel).bottom<=height+.5,{box:box(panel),simulatedSafeBottom:21,simulatedSafeTop:0});
  panel.scrollTop=panel.scrollHeight;const last=layer.querySelector('[data-speed="2"]');check(prefix+' last speed option reachable after scrolling with safe inset',hit(last)&&box(last).bottom<=height-21,{box:box(last),scrollTop:panel.scrollTop});panel.scrollTop=0;safe.remove();
 }
 report({snapshot:(fullscreen?'fullscreen':'inline')+'-speed'});await sleep(100);
 const before=sample(panel);close.click();
 const motion=panel.getAnimations(),closing=[];
 for(const a of motion)a.pause();
 for(const progress of [0,.1,.25,.5,.75,.9,1]){for(const a of motion)a.currentTime=a.effect.getTiming().duration*progress;closing.push({...sample(panel),progress});}
 frames.push({prefix,before,closing,mode:'controlled WAAPI currentTime; real WebKit computed geometry; no wallclock FPS'});
 const inProgress=closing.some(x=>x.width>0&&x.y>before.y+.5&&x.y<height);
 if(motion.length){
  for(const a of motion)a.currentTime=a.effect.getTiming().duration*.5;const reversing=sample(panel),view=layer.querySelector('h2').textContent;
  gear.click();const reopened=panel.getAnimations();for(const a of reopened){a.pause();a.currentTime=0;}const resumed=sample(panel);
  check(prefix+' interrupted submenu reopens from same geometry',Math.abs(reversing.y-resumed.y)<.5&&Math.abs(reversing.height-resumed.height)<.5&&layer.querySelector('h2').textContent===view,{before:reversing,after:resumed});
  for(const a of reopened)a.finish();await sleep(20);close.click();for(const a of panel.getAnimations())a.finish();
 }else for(const a of motion)a.finish();await sleep(40);
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 check(prefix+' closing has intermediate visible frames unless Reduced Motion',reduced || inProgress,{reduced,before,first:closing[0],last:closing.at(-1)});
 check(prefix+' closed layer releases inputs',layer.hidden||layer.inert);
 if(fullscreen)w.__langformFullscreen.exit('abcdefghijk','navigation',true);
}
(async()=>{await cycle(393,852,false);await cycle(852,393,true);report({frames});report({finished:true,passed:results.every(x=>x.passed)&&errors.length===0,count:results.length,errors,engine:'macOS WKWebView; real CSS and controlled WAAPI computed geometry; fixture URL/media/visibility; background document so no wallclock FPS or iPhone/heard-audio proof',reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches});})().catch(e=>report({finished:true,passed:false,error:String(e),stack:e.stack}));
'''
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(html+setup+tests+'</script></body></html>');print(a.output)
(a.output.parent/(a.output.stem+'-sources.json')).write_text(json.dumps({name:hashlib.sha256(text.encode()).hexdigest() for name,text in sources.items()},indent=2)+'\n')
