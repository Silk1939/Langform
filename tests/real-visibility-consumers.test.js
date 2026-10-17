const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const app=path.join(__dirname,'../ios/Langform/Langform');
const before=process.env.LANGFORM_REAL_VISIBILITY_BEFORE;
function source(name){return fs.readFileSync(path.join(before||app,name+(before?'.before.js':'.js')),'utf8');}

for(const signal of ['hidden','native-inactive'])test('startup render observer cancels on real '+signal+' and reports only after a visible render',t=>{
  const dom=new JSDOM('<header></header><ytm-rich-item-renderer><a href="/watch?v=abcdefghijk">Video</a></ytm-rich-item-renderer>',{url:'https://m.youtube.com/watch?v=abcdefghijk',runScripts:'outside-only',pretendToBeVisual:true});
  const win=dom.window,doc=win.document,frames=new Map(),posts=[];let serial=0,inactive=false;
  t.after(()=>{win.dispatchEvent(new win.Event('pagehide'));win.close();});
  win.__langformRealVisibility={hidden:()=>signal==='hidden'&&inactive,inactive:()=>inactive};
  Object.defineProperty(doc,'hidden',{value:false,configurable:true});
  win.webkit={messageHandlers:{langformDiagnostics:{postMessage:row=>posts.push(row)}}};
  win.requestAnimationFrame=fn=>{const n=++serial;frames.set(n,fn);return n;};win.cancelAnimationFrame=n=>frames.delete(n);
  win.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:20,top:0,bottom:20});
  win.eval(source('StartupDiagnostics'));assert.equal(frames.size,1);
  inactive=true;doc.dispatchEvent(new win.Event('langform-real-visibilitychange'));assert.equal(frames.size,0,'pending marker check is cancelled despite masked page property');assert.deepEqual(posts,[]);
  inactive=false;doc.dispatchEvent(new win.Event('langform-real-visibilitychange'));
  function paint(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());}
  paint();paint();assert.deepEqual(posts.map(row=>row.event),['feed-shell-visible','feed-content-visible']);
  doc.dispatchEvent(new win.Event('langform-real-visibilitychange'));assert.equal(frames.size,0,'finished bounded observer removed its own relay listener');
});

test('startup markers retain their pending identity when inactivity arrives between check and paint',t=>{
  const dom=new JSDOM('<header></header><ytm-rich-item-renderer><a href="/watch?v=abcdefghijk">Video</a></ytm-rich-item-renderer>',{url:'https://m.youtube.com/watch?v=abcdefghijk',runScripts:'outside-only',pretendToBeVisual:true});
  const win=dom.window,doc=win.document,frames=new Map(),posts=[];let serial=0,inactive=false;
  t.after(()=>{win.dispatchEvent(new win.Event('pagehide'));win.close();});
  win.__langformRealVisibility={hidden:()=>false,inactive:()=>inactive};win.webkit={messageHandlers:{langformDiagnostics:{postMessage:row=>posts.push(row)}}};
  win.requestAnimationFrame=fn=>{const n=++serial;frames.set(n,fn);return n;};win.cancelAnimationFrame=n=>frames.delete(n);
  win.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:20,top:0,bottom:20});
  function paint(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());}
  win.eval(source('StartupDiagnostics'));paint();assert.equal(frames.size,2,'both original markers await actual paint');assert.deepEqual(posts,[]);
  inactive=true;doc.dispatchEvent(new win.Event('langform-real-visibilitychange'));paint();assert.deepEqual(posts,[],'no visible marker may post from an inactive paint');assert.equal(frames.size,0);
  inactive=false;doc.dispatchEvent(new win.Event('langform-real-visibilitychange'));paint();paint();assert.deepEqual(posts.map(row=>row.event),['feed-shell-visible','feed-content-visible']);
  win.dispatchEvent(new win.Event('resize'));assert.equal(frames.size,0,'completed observer cannot restart');
});
