const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const directory = path.join(__dirname, '../ios/Langform/Langform');
const opening = fs.readFileSync(path.join(directory, 'WatchOpening.js'), 'utf8');
const links = fs.readFileSync(path.join(directory, 'WebViewLinks.js'), 'utf8');

function setup(t, options = {}) {
  const dom = new JSDOM(`<ytm-app><ytm-video-with-context-renderer><a href="/watch?v=abcdefghijk"><img id="thumbnail" src="https://i.ytimg.com/vi/abcdefghijk/hq720.jpg"></a></ytm-video-with-context-renderer><ytm-pivot-bar-renderer>Tabs</ytm-pivot-bar-renderer></ytm-app>`, {
    url: options.url || 'https://m.youtube.com/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const win = dom.window, doc = win.document, animations = [], messages = [], timers = new Map();
  t.after(() => { win.dispatchEvent(new win.Event('pagehide')); win.close(); });
  let timerID=0, presentation=null, matrixReads=0, requests=0, backgroundPresentation=null;
  const preference={matches:!!options.reduced,addEventListener(name,fn){this.changed=fn;}};
  win.matchMedia = query => query.includes('reduced-motion') ? preference : { matches:true };
  win.__langformStageInsets={top:62};
  win.__langformFeedActive=true;
  win.fetch=()=>{requests++;return Promise.reject(Error('opening must not request data'));};
  win.setTimeout=(fn,delay)=>{const id=++timerID;timers.set(id,{fn,delay});return id;};
  win.clearTimeout=id=>timers.delete(id);
  Object.defineProperties(win.HTMLImageElement.prototype,{
    complete:{get(){return !options.unloaded;}},naturalWidth:{get(){return options.unloaded?0:1280;}},
    naturalHeight:{get(){return 720;}},currentSrc:{get(){return this.src;}},
  });
  win.Element.prototype.getBoundingClientRect=function(){
    return {x:0,y:420,left:0,top:420,width:402,height:226.125,right:402,bottom:646.125};
  };
  win.Element.prototype.animate=function(frames,timing){
    const a={node:this,frames:JSON.parse(JSON.stringify(frames)),timing,cancelled:false,onfinish:null,
      cancel(){this.cancelled=true;},finish(){if(this.onfinish)this.onfinish();}};
    animations.push(a);return a;
  };
  const originalStyle=win.getComputedStyle.bind(win);
  win.getComputedStyle=node=>{
    const s=originalStyle(node);
    if(node.classList.contains('lf-opening-picture')&&presentation){matrixReads++;return {transform:presentation};}
    if(backgroundPresentation){
      if(node.classList.contains('lf-opening-wash'))return {opacity:backgroundPresentation.wash};
      if(node.tagName==='YTM-APP')return {opacity:backgroundPresentation.app};
      if(node.tagName==='YTM-PIVOT-BAR-RENDERER')return {transform:backgroundPresentation.bar};
    }
    return s;
  };
  win.webkit={messageHandlers:{
    langformOpening:{postMessage(body){messages.push({channel:'opening',...JSON.parse(JSON.stringify(body))});}},
    langformOpenWatch:{postMessage(body){
      if(options.throwBridge)throw Error('bridge unavailable');
      assert.ok(!options.unloaded ? doc.querySelector('.lf-opening-picture img, .lf-opening-picture canvas') : true,'picture must already exist before native data request');
      messages.push({channel:'watch',...JSON.parse(JSON.stringify(body))});
    }},
  }};
  win.eval(opening);win.eval(links);
  return {win,doc,animations,messages,timers,preference,
    image:doc.getElementById('thumbnail'),
    presentation(value){presentation=value;},matrixReads:()=>matrixReads,requests:()=>requests,
    backgroundPresentation(value){backgroundPresentation=value;},
    tap(){const event=new win.MouseEvent('click',{bubbles:true,cancelable:true});doc.getElementById('thumbnail').dispatchEvent(event);return event;},
    flight(){return animations.findLast(a=>a.node.classList.contains('lf-opening-picture')&&a.frames.length>2&&!a.cancelled);},
  };
}

for(const route of ['/', '/feed/subscriptions'])test(`der Klick auf ${route} startet das identische Bild vor der nativen Watch-Anfrage`,t=>{
  const env=setup(t,{url:'https://m.youtube.com'+route}), event=env.tap();
  assert.equal(event.defaultPrevented,true);
  assert.deepEqual(env.messages.map(m=>m.channel),['opening','watch']);
  const token=env.messages[0].token;
  assert.equal(env.messages[1].sourceThumbnail.openingToken,token);
  assert.equal(env.doc.querySelector('.lf-opening-picture img').currentSrc,env.image.currentSrc);
  assert.equal(env.doc.querySelector('.lf-opening-picture img').id,'','no duplicate source ID');
  assert.equal(env.requests(),0,'motion never waits on an image or data fetch');
  env.flight().finish();
  assert.equal(env.messages.at(-1).kind,'landed');
  assert.ok(env.doc.querySelector('.lf-opening-picture'),'landing retains the image until native owns the plane');
  env.win.__langformWatchOpeningControl('finish',token);
  assert.equal(env.image.hasAttribute('data-lf-opening-origin'),false);
  assert.equal(env.doc.getElementById('langform-watch-opening'),null);
});

test('eine fehlgeschlagene native Brücke entfernt den neuen Cover und erhält YouTubes Klick',t=>{
  const env=setup(t,{throwBridge:true}), event=env.tap();
  assert.equal(event.defaultPrevented,false);
  assert.equal(env.doc.getElementById('langform-watch-opening'),null);
  assert.equal(env.image.hasAttribute('data-lf-opening-origin'),false);
  assert.ok(env.animations.every(a=>a.cancelled));
});

test('ein ungeladenes Bild behält den bestehenden geschützten Watch-Pfad',t=>{
  const env=setup(t,{unloaded:true});env.tap();
  assert.equal(env.doc.getElementById('langform-watch-opening'),null);
  assert.deepEqual(env.messages.map(m=>m.channel),['watch']);
  assert.equal(env.messages[0].sourceThumbnail,undefined);
});

test('späte Antworten eines alten Videos können den neueren Übergang nicht entfernen',t=>{
  const env=setup(t);
  const a=env.win.__langformBeginWatchOpening(env.image,'/watch?v=abcdefghijk');
  const b=env.win.__langformBeginWatchOpening(env.image,'/watch?v=lmnopqrstuv');
  assert.equal(env.win.__langformWatchOpeningControl('finish',a),false);
  assert.equal(env.win.__langformWatchOpeningControl('reverse',a),false);
  assert.equal(env.win.__langformWatchOpeningControl('status',b).id,'lmnopqrstuv');
  assert.ok(env.doc.getElementById('langform-watch-opening'));
  env.flight().finish();
  assert.equal(env.messages.at(-1).token,b);
  assert.equal(env.messages.at(-1).kind,'landed');
});

test('Unterbrechen übernimmt genau die Präsentationsposition und meldet erst nach Rückkehr Abbruch',t=>{
  const env=setup(t), token=env.win.__langformBeginWatchOpening(env.image,'/watch?v=abcdefghijk');
  env.presentation('matrix(1, 0, 0, 1, 0, 270)');
  assert.equal(env.win.__langformWatchOpeningControl('reverse',token),true);
  const reverse=env.flight();
  assert.equal(env.matrixReads(),1,'one takeover measurement, no per-frame layout loop');
  assert.equal(reverse.frames[0].transform,'translate(0px,270px) scale(1,1)');
  assert.equal(env.messages.some(m=>m.kind==='cancelled'),false);
  reverse.finish();
  assert.equal(env.messages.at(-1).kind,'cancelled');
  assert.equal(env.doc.getElementById('langform-watch-opening'),null);
});

test('Bewegung reduzieren verwendet nur die kurze Überblendung am Ziel',t=>{
  const env=setup(t,{reduced:true}), token=env.win.__langformBeginWatchOpening(env.image,'/watch?v=abcdefghijk');
  assert.equal(env.flight(),undefined,'no growing physical spring');
  const picture=env.doc.querySelector('.lf-opening-picture');
  assert.match(picture.style.transform,/translate\(0px,110px\)/);
  const dissolve=env.animations.find(a=>a.node===picture);
  assert.equal(dissolve.timing.duration,160);
  assert.deepEqual(dissolve.frames,[{opacity:0},{opacity:1}]);
  dissolve.finish();assert.equal(env.win.__langformWatchOpeningControl('status',token).landed,true);
});

test('Abbruch übernimmt auch die laufende Überblendung und Tableistenposition',t=>{
  const env=setup(t),token=env.win.__langformBeginWatchOpening(env.image,'/watch?v=abcdefghijk');
  const originalEffects=env.animations.filter(a=>!a.node.classList.contains('lf-opening-picture'));
  env.backgroundPresentation({wash:'0.37',app:'0.63',bar:'matrix(1, 0, 0, 1, 0, 34)'});
  env.win.__langformWatchOpeningControl('reverse',token);
  assert.ok(originalEffects.every(a=>!a.cancelled),'running background styles remain until replacement effects own them');
  assert.deepEqual(env.animations.findLast(a=>a.node.classList.contains('lf-opening-wash')).frames,[{opacity:.37},{opacity:0}]);
  assert.deepEqual(env.animations.findLast(a=>a.node.tagName==='YTM-APP').frames,[{opacity:.63},{opacity:1}]);
  assert.deepEqual(env.animations.findLast(a=>a.node.tagName==='YTM-PIVOT-BAR-RENDERER').frames,[{transform:'matrix(1, 0, 0, 1, 0, 34)'},{transform:'translateY(0)'}]);
  env.flight().finish();assert.ok(env.animations.every(a=>a.cancelled));
});

test('Abbruch mit Bewegung reduzieren blendet weich zurück und räumt erst danach auf',t=>{
  const env=setup(t,{reduced:true}),token=env.win.__langformBeginWatchOpening(env.image,'/watch?v=abcdefghijk');
  env.win.__langformWatchOpeningControl('reverse',token);
  assert.ok(env.doc.getElementById('langform-watch-opening'));
  assert.equal(env.messages.some(m=>m.kind==='cancelled'),false);
  const dissolve=env.animations.findLast(a=>a.node.classList.contains('lf-opening-picture'));
  assert.equal(dissolve.timing.duration,160);
  assert.equal(dissolve.frames.at(-1).opacity,0);
  dissolve.finish();assert.equal(env.messages.at(-1).kind,'cancelled');
  assert.equal(env.doc.getElementById('langform-watch-opening'),null);
});

test('eine laufende Feedvorschau hält ihr sichtbares Bild ohne Export und ohne Reparenting des Videos',t=>{
  const env=setup(t), video=env.doc.createElement('video');env.image.closest('ytm-video-with-context-renderer').appendChild(video);
  Object.defineProperties(video,{readyState:{value:4},videoWidth:{value:1280},videoHeight:{value:720}});
  let drawn=null;
  env.win.HTMLCanvasElement.prototype.getContext=()=>({fillStyle:'',fillRect(){},drawImage(...args){drawn=args;}});
  env.win.HTMLCanvasElement.prototype.toDataURL=()=>assert.fail('cross-origin pixels must not be exported');
  env.tap();
  const canvas=env.doc.querySelector('canvas[data-lf-held-preview]');
  assert.ok(canvas);
  assert.equal(drawn[0],video);
  assert.equal(env.messages.find(m=>m.channel==='watch').sourceThumbnail.livePreview,true);
  assert.equal(video.parentElement.tagName,'YTM-VIDEO-WITH-CONTEXT-RENDERER');
  assert.equal(env.doc.querySelector('.lf-opening-picture video'),null);
});

test('ein verdecktes oder geometrisch anderes Vorschauvideo ersetzt das getippte Bild nicht',t=>{
  const env=setup(t), video=env.doc.createElement('video');env.doc.body.appendChild(video);
  Object.defineProperties(video,{readyState:{value:4},videoWidth:{value:1280},videoHeight:{value:720}});
  video.getBoundingClientRect=()=>({left:0,top:0,width:80,height:45});
  env.win.HTMLCanvasElement.prototype.getContext=()=>assert.fail('unrelated video must never be captured');
  env.tap();assert.equal(env.doc.querySelector('canvas'),null);
  assert.equal(env.messages.find(m=>m.channel==='watch').sourceThumbnail.livePreview,undefined);
  assert.equal(env.doc.querySelector('.lf-opening-picture img').currentSrc,env.image.currentSrc);
});

test('Watch-Hydration behält vorhandene Größen und animiert denselben Inhalt nicht zweimal',async t=>{
  const env=setup(t,{url:'https://m.youtube.com/watch?v=abcdefghijk'});
  env.doc.body.insertAdjacentHTML('beforeend','<ytm-slim-video-information-renderer style="height:54px"></ytm-slim-video-information-renderer>');
  const title=env.doc.querySelector('ytm-slim-video-information-renderer');
  env.win.__langformRevealWatchContent('abcdefghijk');
  const count=env.animations.length;
  title.appendChild(env.doc.createElement('span'));await Promise.resolve();await Promise.resolve();
  assert.equal(title.style.height,'54px');
  assert.equal(env.animations.length,count,'hydrated text does not restart or reset its owner');
  assert.deepEqual(env.animations[0].frames.map(f=>Object.keys(f)),[['opacity','transform'],['opacity','transform']]);
  assert.equal([...env.timers.values()].filter(t=>t.delay===4000).length,1,'bounded hydration observation');
});
