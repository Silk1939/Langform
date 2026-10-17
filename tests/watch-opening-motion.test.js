const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/WatchOpening.js'), 'utf8');
const near = (a,b,epsilon=1e-7) => assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);

function environment(t, options={}) {
  const dom = new JSDOM('<ytm-app><div class="card"><img id="source" src="https://i.ytimg.com/vi/abcdefghijk/hq720.jpg" style="object-fit:cover;object-position:25% 75%;border-radius:12px 8px"></div><ytm-pivot-bar-renderer>Tabs</ytm-pivot-bar-renderer></ytm-app>',{url:'https://m.youtube.com/',runScripts:'outside-only',pretendToBeVisual:true});
  const win=dom.window,doc=win.document,animations=[],messages=[],sourceImage=doc.getElementById('source'),rect={left:12,top:420,width:300,height:210};
  let now=0;
  Object.defineProperty(win.performance,'now',{value:()=>now});
  Object.defineProperties(win.HTMLImageElement.prototype,{complete:{get:()=>true},naturalWidth:{get:()=>1600},naturalHeight:{get:()=>900},currentSrc:{get(){return this.src;}}});
  Object.defineProperty(win,'innerWidth',{value:402});win.__langformStageInsets={top:62};
  const preference={matches:!!options.reduced,addEventListener(name,fn){this.changed=fn;}};
  win.matchMedia=query=>query.includes('reduced-motion')?preference:{matches:false};
  if(options.role)win.__langformMotion=options.role;
  win.webkit={messageHandlers:{langformOpening:{postMessage:value=>messages.push(value)}}};
  const realStyle=win.getComputedStyle.bind(win);
  function interpolate(a,b,p){
    if(typeof a==='number')return a+(b-a)*p;
    const numbers=String(b).match(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)||[];let index=0;
    return String(a).replace(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi,number=>String(Number(number)+(Number(numbers[index++])-Number(number))*p));
  }
  function sample(node,key){
    const animation=animations.findLast(a=>a.node===node&&!a.cancelled&&key in a.frames[0]);
    if(!animation)return node.style[key]||realStyle(node)[key];
    const progress=Math.max(0,Math.min(1,(animation.currentTime-(animation.timing.delay||0))/animation.timing.duration));
    const position=progress*(animation.frames.length-1),left=Math.min(animation.frames.length-2,Math.floor(position)),fraction=position-left;
    return interpolate(animation.frames[left][key],animation.frames[left+1][key],fraction);
  }
  function components(value){
    const numbers=String(value).match(/-?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number)||[];
    if(String(value).startsWith('matrix('))return numbers;
    if(String(value).includes('scale('))return [numbers[2],0,0,numbers[2],numbers[0],numbers[1]];
    if(String(value).startsWith('translate('))return [1,0,0,1,numbers[0],numbers[1]];
    return [1,0,0,1,0,0];
  }
  win.Element.prototype.animate=function(frames,timing){
    const began=now,a={node:this,frames:JSON.parse(JSON.stringify(frames)),timing,cancelled:false,onfinish:null,manual:null,
      get currentTime(){return this.manual===null?Math.max(0,now-began):this.manual;},set currentTime(value){this.manual=value;},
      cancel(){this.cancelled=true;},finish(){this.manual=timing.duration;if(this.onfinish)this.onfinish();}};
    animations.push(a);return a;
  };
  win.Element.prototype.getBoundingClientRect=function(){
    let value=rect;
    if(this.classList.contains('lf-opening-picture')){const m=components(sample(this,'transform'));value={left:m[4],top:m[5],width:parseFloat(sample(this,'width')),height:parseFloat(sample(this,'height'))};}
    if(this.classList.contains('lf-opening-visual')){const m=components(sample(this,'transform')),parent=this.parentElement.getBoundingClientRect();value={left:parent.left+m[4],top:parent.top+m[5],width:parseFloat(this.style.width)*m[0],height:parseFloat(this.style.height)*m[3]};}
    return {...value,x:value.left,y:value.top,right:value.left+value.width,bottom:value.top+value.height};
  };
  win.getComputedStyle=node=>{
    const css=realStyle(node);
    if(node.classList.contains('lf-opening-picture')||node.classList.contains('lf-opening-visual')){
      const radius=String(sample(node,'borderRadius')||'0').split('/').map(s=>s.trim().split(/\s+/));
      return new Proxy(css,{get(target,key){
        if(key==='transform')return 'matrix('+components(sample(node,'transform')).join(',')+')';
        if(['width','height','opacity'].includes(key))return String(sample(node,key)||'1');
        const index=['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'].indexOf(key);
        if(index>=0)return (radius[0][index]||radius[0][0]||'0')+' '+((radius[1]||radius[0])[index]||(radius[1]||radius[0])[0]||'0');
        return Reflect.get(target,key);
      }});
    }
    return css;
  };
  win.eval(source);
  t.after(()=>{win.dispatchEvent(new win.Event('pagehide'));win.close();});
  return {win,doc,rect,animations,messages,preference,image:sourceImage,seek:value=>{now=value;},components,
    begin:()=>win.__langformBeginWatchOpening(sourceImage,'/watch?v=abcdefghijk'),
    control:(command,token)=>win.__langformWatchOpeningControl(command,token),
    flight:()=>animations.findLast(a=>a.node.classList.contains('lf-opening-picture')&&a.frames.length>2&&!a.cancelled),
    visualFlight:()=>animations.findLast(a=>a.node.classList.contains('lf-opening-visual')&&!a.cancelled),
  };
}

test('unequal source/target ratios preserve exact first crop/radii and uniform bitmap scale at all sampled times',t=>{
  const e=environment(t),token=e.begin(),clip=e.flight(),visual=e.visualFlight(),first=clip.frames[0],image=e.doc.querySelector('.lf-opening-visual');
  assert.equal(first.transform,'translate(12px,420px)');assert.equal(first.width,'300px');assert.equal(first.height,'210px');
  assert.equal(first.borderRadius,'12px 8px 12px 8px / 12px 8px 12px 8px');
  const m=e.components(visual.frames[0].transform);near(m[0],210/900);near(m[3],m[0]);near(m[4],(300-1600*m[0])*.25);near(m[5],0);
  assert.equal(image.currentSrc,e.image.currentSrc);assert.equal(e.doc.querySelectorAll('video').length,0);
  for(let at=0;at<=clip.timing.duration;at+=3.17){e.seek(at);const shown=image.getBoundingClientRect();near(shown.width/shown.height,1600/900,1e-8);}
  assert.equal(clip.frames.at(-1).borderRadius,'0px 0px 0px 0px / 0px 0px 0px 0px');
  assert.ok(visual.frames.every(f=>!f.transform.includes('scale(')||!f.transform.split('scale(')[1].includes(',')),'one uniform scale, never XY');
  clip.finish();assert.equal(e.control('status',token).landed,true);
});

test('forward landing preserves the fixed 400ms native contract without an adaptive extension',t=>{
  const e=environment(t),token=e.begin(),a=e.flight(),duration=a.timing.duration/1000;
  assert.equal(duration,.4);
  e.seek(200);assert.equal(e.control('status',token).landed,false);assert.equal(e.messages.filter(m=>m.kind==='landed').length,0);
  e.seek(399);assert.equal(e.control('status',token).landed,false);
  a.finish();assert.equal(e.control('status',token).landed,true);assert.equal(e.messages.filter(m=>m.kind==='landed').length,1);
  assert.ok(e.doc.querySelector('.lf-opening-picture'),'native readiness still owns removal');
});

test('an equal-sized outer square clip preserves the source image elliptical rounded crop',t=>{
  const e=environment(t);e.image.style.borderRadius='12px / 8px';e.image.parentElement.style.overflow='hidden';e.image.parentElement.style.borderRadius='0px';e.begin();
  assert.equal(e.flight().frames[0].borderRadius,'12px 12px 12px 12px / 8px 8px 8px 8px');
});

test('reverse takes displayed clip and uniform visual pose and carries outbound velocity',t=>{
  const e=environment(t),token=e.begin(),old=e.flight(),oldFinish=old.onfinish;
  e.seek(96);const before=e.control('status',token).rect,visual=e.doc.querySelector('.lf-opening-visual'),visualBefore=e.win.getComputedStyle(visual).transform;
  e.control('reverse',token);const reverse=e.flight(),v=e.visualFlight();
  assert.equal(reverse.timing.duration,320,'return preserves its separate existing 320ms budget');
  const first=e.components(reverse.frames[0].transform);near(first[4],before.x);near(first[5],before.y);near(parseFloat(reverse.frames[0].width),before.width);near(parseFloat(reverse.frames[0].height),before.height);
  e.components(v.frames[0].transform).forEach((value,i)=>near(value,e.components(visualBefore)[i]));
  assert.ok(e.components(reverse.frames[1].transform)[5]<first[5],'the first reverse interval carries the actual still-upward velocity');
  oldFinish();assert.equal(e.messages.filter(m=>m.kind==='landed').length,0,'old forward callback cannot land reversal');
  reverse.finish();assert.equal(e.doc.getElementById('langform-watch-opening'),null);assert.equal(e.messages.at(-1).kind,'cancelled');
  assert.ok(e.animations.every(a=>a.cancelled));
});

test('same-image retap starts at the displayed pose while old token and callbacks lose ownership',t=>{
  const e=environment(t),oldToken=e.begin(),old=e.flight(),oldFinish=old.onfinish;
  e.seek(80);const shown=e.control('status',oldToken).rect,next=e.begin(),newFlight=e.flight(),first=e.components(newFlight.frames[0].transform);
  near(first[4],shown.x);near(first[5],shown.y);near(parseFloat(newFlight.frames[0].width),shown.width);
  assert.notEqual(next,oldToken);assert.equal(e.control('finish',oldToken),false);oldFinish();assert.equal(e.messages.filter(m=>m.kind==='landed').length,0);
  newFlight.finish();assert.equal(e.messages.at(-1).token,next);e.control('finish',next);assert.equal(e.doc.getElementById('langform-watch-opening'),null);
});

test('stage2 roles supply the spring and crossfade; skeleton blocks only change opacity',t=>{
  const role={springs:{hero:{omega:30,damping:.94}},durations:{fade:125},easings:{fade:'linear'},reduceSpatialMotion:false};
  const e=environment(t,{role}),token=e.begin();
  const skeletons=e.animations.filter(a=>a.node.classList.contains('lf-opening-block'));assert.equal(skeletons.length,5);
  for(const a of skeletons){assert.deepEqual(a.frames,[{opacity:0},{opacity:1}]);assert.equal(a.timing.duration,125);assert.equal(a.timing.easing,'linear');}
  const baseline=environment(t);baseline.begin();
  assert.equal(e.flight().timing.duration,400,'shared role cannot extend the native landing contract');
  assert.ok(e.components(e.flight().frames[30].transform)[5]<baseline.components(baseline.flight().frames[30].transform)[5],'shared omega changes the physical trajectory within the same native budget');
  e.control('discard',token);assert.ok(e.animations.every(a=>a.cancelled));assert.equal(e.doc.querySelector('.lf-opening-picture'),null);
});

test('reduceSpatialMotion starts a stationary short crossfade and keeps native finish immediate',t=>{
  const e=environment(t,{role:{reduceSpatialMotion:true,durations:{fade:120}}}),token=e.begin();
  assert.equal(e.flight(),undefined);assert.ok(e.animations.every(a=>a.frames.every(f=>!('transform' in f))),'no decorative motion under crossfade preference');
  const picture=e.doc.querySelector('.lf-opening-picture'),start=picture.getBoundingClientRect();e.seek(70);assert.deepEqual(picture.getBoundingClientRect(),start);
  const dissolve=e.animations.find(a=>a.node===picture);assert.equal(dissolve.timing.duration,120);assert.equal(e.image.hasAttribute('data-lf-opening-origin'),false,'original thumbnail stays in the fading feed');
  dissolve.finish();assert.equal(e.control('status',token).landed,true);e.control('finish',token);
  assert.equal(e.doc.getElementById('langform-watch-opening'),null);assert.ok(e.animations.every(a=>a.cancelled));
});

test('live preference change crossfades two stationary stills, never a duplicate live video',t=>{
  const role={reduceSpatialMotion:false,durations:{fade:120}},e=environment(t,{role}),token=e.begin();e.seek(80);
  const barMotion=e.animations.find(a=>a.node.tagName==='YTM-PIVOT-BAR-RENDERER');
  const original=e.doc.querySelector('.lf-opening-picture'),before=original.getBoundingClientRect();role.reduceSpatialMotion=true;e.win.dispatchEvent(new e.win.Event('langform-motion-change'));
  assert.equal(e.flight(),undefined);assert.deepEqual(original.getBoundingClientRect(),before);assert.equal(e.doc.querySelectorAll('.lf-opening-picture').length,2);assert.equal(e.doc.querySelectorAll('video').length,0);
  assert.equal(barMotion.cancelled,true,'live reduce preference also freezes the tab bar motion');
  const newest=e.doc.querySelectorAll('.lf-opening-picture')[1],end=newest.getBoundingClientRect();e.seek(130);assert.deepEqual(newest.getBoundingClientRect(),end);assert.deepEqual(original.getBoundingClientRect(),before);
  e.animations.findLast(a=>a.node===newest).finish();assert.equal(e.control('status',token).landed,true);assert.equal(e.doc.querySelectorAll('.lf-opening-picture').length,1);
  e.control('discard',token);assert.ok(e.animations.every(a=>a.cancelled));
});

test('reduced reverse crossfades and restores source only after completion; stale reverse is rejected',t=>{
  const e=environment(t,{reduced:true}),token=e.begin();e.control('reverse',token);
  assert.equal(e.control('reverse','wrong-token'),false);assert.ok(e.doc.getElementById('langform-watch-opening'));
  const dissolve=e.animations.findLast(a=>a.node.classList.contains('lf-opening-picture'));assert.deepEqual(dissolve.frames.at(-1),{opacity:0});dissolve.finish();
  assert.equal(e.doc.getElementById('langform-watch-opening'),null);assert.equal(e.messages.at(-1).kind,'cancelled');assert.equal(e.image.hasAttribute('data-lf-opening-origin'),false);
});
