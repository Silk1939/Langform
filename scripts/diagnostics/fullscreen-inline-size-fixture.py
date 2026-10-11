#!/usr/bin/env python3
"""Real WK six-cycle cascade regression for persistent inline media sizing.

YouTube-like author dimensions remain stale permanently, including !important.
No fixture hydration resets them. Playback state is substituted, not proven.
"""
import argparse
import json
from pathlib import Path

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',required=True,type=Path)
p.add_argument('--source',type=Path)
p.add_argument('--important',action='store_true')
p.add_argument('--expect-stale-media',action='store_true')
p.add_argument('--portrait-cover',action='store_true')
p.add_argument('--transformed-ancestors',action='store_true')
p.add_argument('--scrolled',action='store_true')
a=p.parse_args()
repo=Path(__file__).resolve().parents[2]
source=a.source or repo/'ios/Langform/Langform/FullscreenMotion.js'
# Reuse only the real WK harness, media substitution and geometric sampling.
import subprocess
subprocess.run(['python3',str(repo/'scripts/diagnostics/fullscreen-staged-exit-fixture.py'),'--output',str(a.output),'--source',str(source),*(['--portrait-video','--inline-fit','cover'] if a.portrait_cover else []),*(['--transformed-ancestors'] if a.transformed_ancestors else []),*(['--scrolled'] if a.scrolled else [])],check=True,stdout=subprocess.DEVNULL)
html=a.output.read_text();cut=html.index('(async()=>{')
prefix=html[:cut]
tests=r'''
const staleBaseline=BASELINE,authorPriority=PRIORITY;
(async()=>{
await resize(402,874,'initial');if(scrolled)scrollTo(0,50);await frames(2,'initial');const node=video,parent=video.parentElement,container=parent,inline=sample('inline-original'),summaries=[];
for(let cycle=1;cycle<=(staleBaseline?1:6);cycle++){
 const before=sample('cycle-'+cycle+'-inline');root.querySelector('button').click();await resize(874,402,'cycle-'+cycle+'-entry');await frames(3,'cycle-'+cycle+'-fullscreen');
 testWindow.__langformFullscreen.exit('abcdefghijk');const request=messages.filter(m=>m.kind==='exit-request').at(-1),start=sample('cycle-'+cycle+'-source');
 const accepted=testWindow.__langformFullscreen.prepareExitMotion('abcdefghijk',request.token,402,874,Date.now()+250,cycle+20);
 result('cycle-'+cycle+'-uses-correct-inline-cache',accepted===true&&distance(before.picture,inline.picture)<1,{before,inline});
 testWindow.__langformFullscreen.prepareExit('abcdefghijk',request.token,402,874);
 for(let i=0;i<50&&!messages.some(m=>m.kind==='exit-motion-ready'&&m.token===request.token);i++)await frames(1,'cycle-'+cycle+'-motion');
 const ack=messages.find(m=>m.kind==='exit-motion-ready'&&m.token===request.token),held=sample('cycle-'+cycle+'-ACK');
 result('cycle-'+cycle+'-ACK-keeps-real-source-viewport',!!ack&&innerWidth===874&&innerHeight===402&&distance(held.picture,inline.picture)<1,{ack,held});
 // Permanent author updates. They deliberately outlive the real native resize.
 video.style.setProperty('width','874px',authorPriority);video.style.setProperty('height','491.625px',authorPriority);
 container.style.setProperty('width','874px',authorPriority);container.style.setProperty('height','491.625px',authorPriority);
 await resize(402,874,'cycle-'+cycle+'-real-WK-shrink');testWindow.__langformFullscreen.finishExit('abcdefghijk',request.token,402,874);
 await frames(staleBaseline?135:15,'cycle-'+cycle+'-stale-author');const after=sample('cycle-'+cycle+'-inline-after'),cycleTrace=trace.filter(r=>r.phase.startsWith('cycle-'+cycle+'-')&&r.viewport.width===402&&r.phase!=='cycle-'+cycle+'-inline');
 if(staleBaseline){
  result('build39-persistent-stale-media-abort-and-next-cache-poison-reproduced',!testWindow.__langformFullscreen.isOpen()&&after.root.width===402&&after.picture.width>800&&!messages.some(m=>m.kind==='exit-commit'&&m.token===request.token),{after,messages});break;
 }
 result('cycle-'+cycle+'-permanent-author-dimensions-cannot-break-natural-release',!testWindow.__langformFullscreen.isOpen()&&messages.some(m=>m.kind==='exit-commit'&&m.token===request.token)&&distance(after.picture,inline.picture)<1&&getComputedStyle(video).objectFit===inlineFit&&cycleTrace.every(r=>distance(r.picture,inline.picture)<1),{after,maxLateDelta:Math.max(...cycleTrace.map(r=>distance(r.picture,inline.picture)))});
 // Later unrelated author writes must also remain responsive before next open.
 video.style.setProperty('width','873px',authorPriority);video.style.setProperty('height','491.0625px',authorPriority);container.style.setProperty('width','873px',authorPriority);container.style.setProperty('height','491.0625px',authorPriority);
 await frames(3,'cycle-'+cycle+'-late-author');const late=sample('cycle-'+cycle+'-late-inline');
 result('cycle-'+cycle+'-persistent-owner-prevents-late-author-snap',distance(late.picture,inline.picture)<1&&video.style.width==='100%'&&container.style.width==='100%'&&video.style.getPropertyPriority('width')==='important',{late});
 summaries.push({cycle,source:start.picture,held:held.picture,after:after.picture,late:late.picture});
}
if(!staleBaseline){
 video.style.setProperty('height','229px','important');container.style.setProperty('width','405px','important');await frames(2,'latest-author');dispatchEvent(new Event('yt-navigate-start'));await frames(2,'navigation-cleanup');
 result('navigation-cleanup-restores-latest-author-declarations-and-priorities',video.style.height==='229px'&&video.style.getPropertyPriority('height')==='important'&&container.style.width==='405px'&&container.style.getPropertyPriority('width')==='important',{videoStyleHeight:video.style.height,containerStyleWidth:container.style.width});
}
result('six-cycles-keep-media-node-parent-time-and-playback',video===node&&video.parentElement===parent&&video.currentTime===40&&!video.paused&&calls.length===0,{time:video.currentTime,paused:video.paused,cycles:summaries.length});
report({trace,summaries,sourceSHA256});report({finished:true,passed:errors.length===0&&results.every(r=>r.passed),count:results.length,errors,sourceSHA256,engine:'macOS WKWebView; real native window resize; persistent stale author dimensions; substituted media'});
})().catch(error=>report({finished:true,passed:false,error:String(error),stack:error.stack,sourceSHA256}));
'''
tests=tests.replace('BASELINE',str(a.expect_stale_media).lower()).replace('PRIORITY',json.dumps('important' if a.important else ''))
a.output.write_text(prefix+tests+'</script></body></html>')
print(a.output)
