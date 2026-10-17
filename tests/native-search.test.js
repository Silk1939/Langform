const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {JSDOM} = require('jsdom');
const base = path.join(__dirname, '../ios/Langform/Langform');

test('echte Swift-Suchpolicy bindet mobile Treffer und Vorschläge an Query/Filter', {skip:process.platform !== 'darwin',timeout:60000}, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'langform-search-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source = fs.readFileSync(path.join(base,'SearchPolicy.swift'),'utf8');
  const main = source + `
func check(_ ok: Bool, _ message: String) { if !ok { fatalError(message) } }
let text = "NASA + Mars & #1 / 東京 😃"
for filter in LangformSearchFilter.allCases {
 let url = LangformSearchPolicy.resultsURL(query:"  \\(text)  ",filter:filter)!
 check(url.scheme == "https" && url.host == "m.youtube.com" && url.path == "/results","always mobile search")
 let items=URLComponents(url:url,resolvingAgainstBaseURL:false)!.queryItems!
 check(items.first(where:{$0.name == "search_query"})!.value == text,"literal Unicode query round trip")
 check(LangformSearchPolicy.filter(from:url)==filter,"all four filters round trip")
 if filter == .channels {check(url.absoluteString.contains("EgIQAg%253D%253D"),"original mweb parameter encoding")}
}
check(LangformSearchPolicy.resultsURL(query:" \\n ",filter:.videos)==nil,"empty does not navigate")
check(LangformSearchPolicy.query(String(repeating:"x",count:500)).count==200,"bounded query")
check(LangformSearchPolicy.suggestionURL(query:"x")==nil,"single key no request")
let suggest = LangformSearchPolicy.suggestionURL(query:text)!
check(suggest.host == "suggestqueries.google.com" && URLComponents(url:suggest,resolvingAgainstBaseURL:false)!.queryItems!.contains(where:{$0.name=="q" && $0.value==text}),"suggestion query is not a URL or code")
let payload = try! JSONSerialization.data(withJSONObject:["NASA",["nasa live","NASA LIVE",2,"","next","bad\\nrow",String(repeating:"z",count:161)]])
check(LangformSearchPolicy.suggestions(from:payload,expectedQuery:"nasa")==["nasa live","next"],"typed bounded deduplicated text only")
check(LangformSearchPolicy.suggestions(from:payload,expectedQuery:"other").isEmpty,"late foreign query rejected")
check(LangformSearchPolicy.suggestions(from:Data("bad".utf8),expectedQuery:"NASA").isEmpty,"malformed response")
check(LangformSearchPolicy.suggestions(from:Data(repeating:32,count:65537),expectedQuery:"NASA").isEmpty,"oversized response")
print("search policy passed")
`;
  const file=path.join(dir,'main.swift');fs.writeFileSync(file,main);
  const r=spawnSync('xcrun',['swift',file],{encoding:'utf8',timeout:50000});assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/search policy passed/);
});

test('native Oberfläche verwirft verspätete Vorschläge, behält Tastatur und Medien unabhängig',()=>{
  const s=fs.readFileSync(path.join(base,'NativeSearch.swift'),'utf8');
  assert.match(s,/UITextFieldDelegate, UITableViewDataSource, UITableViewDelegate/);
  assert.match(s,/self\.generation == ticket/);assert.match(s,/query\(self\.field\.text/);
  assert.match(s,/request\?\.cancel\(\)/);assert.match(s,/httpShouldSetCookies = false/);
  assert.match(s,/URLSessionConfiguration\.ephemeral/);assert.doesNotMatch(s,/UserDefaults|AVAudioSession|evaluateJavaScript|\.play\(|\.pause\(/);
  assert.match(s,/accessibilityViewIsModal = true/);assert.match(s,/keyboardFrame/);
});

function results(t,{url='https://m.youtube.com/results?search_query=NASA',markup='',active=true,beforeScript}={}) {
  const dom=new JSDOM(markup,{url,runScripts:'outside-only',pretendToBeVisual:true});const win=dom.window,posts=[];
  win.__langformFeedActive=active;
  win.webkit={messageHandlers:{langformOpenWatch:{postMessage(){}},langformNativeSearch:{postMessage(b){posts.push(b)}}}};
  const frames=new Map();let serial=0;win.requestAnimationFrame=cb=>{frames.set(++serial,cb);return serial};win.cancelAnimationFrame=id=>frames.delete(id);
  t.after(()=>{win.dispatchEvent(new win.Event('pagehide'));win.close()});
  if(beforeScript)beforeScript(win);
  win.eval(fs.readFileSync(path.join(base,'SearchResults.js'),'utf8'));
  function paint(){const callbacks=[...frames.values()];frames.clear();callbacks.forEach(cb=>cb())} paint();
  return {win,posts,paint};
}
test('own result chip wins before a website document capture listener',t=>{
  const c=results(t,{beforeScript:win=>win.document.addEventListener('click',e=>e.stopImmediatePropagation(),true)});
  c.win.document.querySelector('[data-filter="unwatched"]').click();
  assert.deepEqual(JSON.parse(JSON.stringify(c.posts)),[{action:'filter',filter:'unwatched',href:c.win.location.href}]);
});
test('a completed physical chip tap routes once before a missing or delayed compatibility click',t=>{
  const c=results(t),button=c.win.document.querySelector('[data-filter="unwatched"]');
  for(const type of ['pointerdown','pointerup']){
    const e=new c.win.MouseEvent(type,{bubbles:true,cancelable:true,clientX:300,clientY:130});Object.defineProperty(e,'pointerId',{value:3});button.dispatchEvent(e);
  }
  assert.equal(c.posts.length,1);assert.equal(c.posts[0].filter,'unwatched');
  button.dispatchEvent(new c.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
  assert.equal(c.posts.length,1,'the same tap must not reload a second time');
});
test('a chip drag and its trailing click preserve scrolling without choosing a filter',t=>{
  const c=results(t),button=c.win.document.querySelector('[data-filter="channels"]');
  for(const [type,x] of [['pointerdown',250],['pointermove',275],['pointerup',250]]){
    const e=new c.win.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:130});Object.defineProperty(e,'pointerId',{value:3});button.dispatchEvent(e);
    if(type==='pointermove')assert.equal(e.defaultPrevented,false);
  }
  button.dispatchEvent(new c.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
  assert.equal(c.posts.length,0);
});
test('touch-only chip tap chooses once and suppresses its delayed compatibility click',t=>{
  const c=results(t),button=c.win.document.querySelector('[data-filter="videos"]');
  for(const type of ['touchstart','touchend']){
    const e=new c.win.Event(type,{bubbles:true,cancelable:true}),point={identifier:4,clientX:140,clientY:130};
    Object.defineProperties(e,{touches:{value:type==='touchstart'?[point]:[]},changedTouches:{value:[point]}});button.dispatchEvent(e);
  }
  assert.equal(c.posts.length,1);assert.equal(c.posts[0].filter,'videos');
  button.dispatchEvent(new c.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));assert.equal(c.posts.length,1);
});
test('secondary pointers, cancellation and inactive feed invalidate an incomplete chip tap',t=>{
  for(const reason of ['secondary','cancel','inactive']){
    const c=results(t),button=c.win.document.querySelector('[data-filter="videos"]');
    function pointer(type,id=3,primary=true){const e=new c.win.MouseEvent(type,{bubbles:true,cancelable:true,clientX:140,clientY:130});Object.defineProperties(e,{pointerId:{value:id},isPrimary:{value:primary}});button.dispatchEvent(e);}
    pointer('pointerdown');
    if(reason==='secondary')pointer('pointerdown',4,false);
    if(reason==='cancel')pointer('pointercancel');
    if(reason==='inactive')c.win.__langformFeedActive=false;
    pointer('pointerup');button.dispatchEvent(new c.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
    assert.equal(c.posts.length,0,reason);
  }
});
test('Suchchips behalten Originaltreffer, geben gültige Filter an native Navigation',t=>{
  const c=results(t,{markup:'<ytm-app><div id="list"><ytm-compact-channel-renderer id="channel">Kanal</ytm-compact-channel-renderer><ytm-video-with-context-renderer id="video">Video</ytm-video-with-context-renderer></div></ytm-app>'});
  assert.equal(c.win.document.querySelectorAll('#langform-search-chips button').length,4);
  assert.equal(c.win.document.querySelector('[data-filter="all"]').getAttribute('aria-pressed'),'true');
  assert.ok(c.win.document.getElementById('list').hasAttribute('data-langform-search-order'));
  assert.equal(c.win.document.getElementById('list').firstElementChild.id,'channel','ranking does not reparent YouTube objects');
  c.win.document.querySelector('[data-filter="videos"]').click();
  assert.deepEqual(JSON.parse(JSON.stringify(c.posts)),[{action:'filter',filter:'videos',href:c.win.location.href}]);
});
test('Ungesehen entfernt ausschließlich YouTube-markierte gesehene Treffer',t=>{
  const c=results(t,{url:'https://m.youtube.com/results?search_query=NASA&lf_unwatched=1',markup:'<ytm-video-with-context-renderer id="seen"><ytm-thumbnail-overlay-resume-playback-renderer></ytm-thumbnail-overlay-resume-playback-renderer></ytm-video-with-context-renderer><ytm-video-with-context-renderer id="unknown"></ytm-video-with-context-renderer>'});
  assert.ok(c.win.document.getElementById('seen').hasAttribute('data-langform-watched-result'));
  assert.ok(!c.win.document.getElementById('unknown').hasAttribute('data-langform-watched-result'));
  c.win.history.replaceState({},'', '/results?search_query=NASA');c.win.dispatchEvent(new c.win.Event('yt-navigate-finish'));c.paint();
  assert.ok(!c.win.document.getElementById('seen').hasAttribute('data-langform-watched-result'));
});
test('unwatched intent survives YouTube canonical URL cleanup for the same video search',t=>{
  const c=results(t,{url:'https://m.youtube.com/results?search_query=NASA&sp=EgIQAQ%253D%253D&lf_unwatched=1',markup:'<ytm-video-with-context-renderer id="seen"><ytm-thumbnail-overlay-resume-playback-renderer></ytm-thumbnail-overlay-resume-playback-renderer></ytm-video-with-context-renderer>'});
  c.win.history.replaceState({},'','/results?search_query=NASA&sp=EgIQAQ%253D%253D');c.win.dispatchEvent(new c.win.Event('yt-navigate-finish'));c.paint();
  assert.equal(c.win.document.querySelector('[data-filter="unwatched"]').getAttribute('aria-pressed'),'true');
  assert.equal(c.win.__langformSearchFilter(),'unwatched');assert.ok(c.win.document.getElementById('seen').hasAttribute('data-langform-watched-result'));
  c.win.document.querySelector('[data-filter="videos"]').click();c.paint();
  assert.equal(c.win.__langformSearchFilter(),'videos','an explicit Videos choice clears the extra filter even when URL already matches');
  assert.ok(!c.win.document.getElementById('seen').hasAttribute('data-langform-watched-result'));
});
test('unwatched intent cannot leak into a different query or an all-results route',t=>{
  for(const destination of ['/results?search_query=other&sp=EgIQAQ%253D%253D','/results?search_query=NASA']){
    const c=results(t,{url:'https://m.youtube.com/results?search_query=NASA&sp=EgIQAQ%253D%253D&lf_unwatched=1'});
    c.win.history.replaceState({},'',destination);c.win.dispatchEvent(new c.win.Event('yt-navigate-finish'));c.paint();
    assert.equal(c.win.document.querySelector('[data-filter="unwatched"]').getAttribute('aria-pressed'),'false');
  }
});
test('Videos werden auch vor einer separaten Kanal-Ergebnisgruppe priorisiert',t=>{
  const c=results(t,{markup:'<ytm-section-list-renderer id="sections"><ytm-item-section-renderer id="channels"><div><ytm-compact-channel-renderer>Kanal</ytm-compact-channel-renderer></div></ytm-item-section-renderer><ytm-item-section-renderer id="videos"><div><ytm-video-with-context-renderer>Video</ytm-video-with-context-renderer></div></ytm-item-section-renderer></ytm-section-list-renderer>'});
  assert.ok(c.win.document.getElementById('sections').hasAttribute('data-langform-search-order'));
  assert.ok(c.win.document.getElementById('channels').hasAttribute('data-langform-channel-section'));
  assert.equal(c.win.document.getElementById('sections').firstElementChild.id,'channels');
});
for (const options of [{url:'https://m.youtube.com/watch?v=abcdefghijk'},{active:false},{url:'https://m.youtube.com/'}]) {
 test('keine Suchchips außerhalb aktiver Ergebnisse '+JSON.stringify(options),t=>{const c=results(t,options);assert.equal(c.win.document.getElementById('langform-search-chips'),null)});
}
test('späte Kanal-/Videotreffer und Seitenwechsel räumen eigene Attribute auf',async t=>{
 const c=results(t,{markup:'<div id="list"></div>'});const list=c.win.document.getElementById('list');
 list.innerHTML='<ytm-compact-channel-renderer>Kanal</ytm-compact-channel-renderer><ytm-video-with-context-renderer>Video</ytm-video-with-context-renderer>';
 await Promise.resolve();c.paint();assert.ok(list.hasAttribute('data-langform-search-order'));
 c.win.history.replaceState({},'','/');c.win.dispatchEvent(new c.win.Event('yt-navigate-finish'));c.paint();assert.ok(!list.hasAttribute('data-langform-search-order'));assert.equal(c.win.document.getElementById('langform-search-chips'),null);
});
