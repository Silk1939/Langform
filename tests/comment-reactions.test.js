const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/CommentReactions.js'), 'utf8');

function comment(id) {
  return `<ytm-comment-renderer id="${id}" class="YtmCommentRendererHost"><button class="YtmCommentRendererContent" aria-label="Kommentar ${id}"><div class="YtmCommentRendererHeader">Autor ${id}</div><p class="YtmCommentRendererText">Text ${id}</p><div class="YtmCommentRendererDetails" aria-hidden="true"><div class="YtmCommentRendererIcons"><c3-icon class="YtmCommentRendererActionIcon" data-selected="false" data-disabled="false"></c3-icon><span class="YtmCommentRendererCount">10</span></div><div class="YtmCommentRendererIcons"><c3-icon class="YtmCommentRendererActionIcon" data-selected="false" data-disabled="false"></c3-icon></div><div class="YtmCommentRendererIcons">Antworten</div></div></button></ytm-comment-renderer>`;
}
function setup(t, options = {}) {
  const dom = new JSDOM(`<ytm-engagement-panel><ytm-engagement-panel-section-list-renderer class="comment-item-section"><div class="engagement-panel-content-wrapper">${comment('a')}${comment('b')}</div></ytm-engagement-panel-section-list-renderer></ytm-engagement-panel><bottom-sheet-container hidden><button class="close-button">Schließen</button><div class="bottom-sheet-comment-menu-item"></div></bottom-sheet-container>`, {url:'https://m.youtube.com/watch?v=abcdefghijk',runScripts:'outside-only'});
  const win=dom.window,doc=win.document,panel=doc.querySelector('ytm-engagement-panel'),menu=doc.querySelector('bottom-sheet-container'),frames=new Map(),timers=new Map(),opens=[],actions=[],errors=[];
  let serial=0,now=0;
  win.performance.now=()=>now;
  win.setTimeout=(fn,delay)=>{timers.set(++serial,{fn,delay});return serial;};win.clearTimeout=id=>timers.delete(id);
  win.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial;};win.cancelAnimationFrame=id=>frames.delete(id);
  win.Element.prototype.getBoundingClientRect=function(){
    const root=this.closest('ytm-comment-renderer'),row=root?.id==='b'?150:0,index=this.classList.contains('YtmCommentRendererIcons')?[...this.parentElement.children].indexOf(this):0;
    const rect=this.tagName==='YTM-COMMENT-RENDERER'?{x:0,y:row,width:390,height:120}:{x:44+index*44,y:row+72,width:44,height:44};
    return {...rect,left:rect.x,top:rect.y,right:rect.x+rect.width,bottom:rect.y+rect.height};
  };
  win.__langformObserveOverlayContainers=fn=>{win.__notifyComments=fn;fn(panel,true);};
  win.addEventListener('error',event=>{errors.push(event.message);event.preventDefault();});
  const icons=root=>[...root.querySelectorAll('.YtmCommentRendererActionIcon')];
  function populate(root) {
    const labels=options.labels||['Mag ich','Mag ich nicht'];
    menu.querySelector('.bottom-sheet-comment-menu-item').replaceChildren();
    for(const index of [0,1]){
      const renderer=doc.createElement('ytm-toggle-menu-service-item-renderer'),button=doc.createElement('button');button.className='menu-item-button';button.textContent=labels[index];
      button.onclick=()=>{
        actions.push([root.id,index]);
        if(options.noConfirmation)return;
        const before=icons(root)[index].getAttribute('data-selected')==='true';
        icons(root).forEach((icon,i)=>icon.setAttribute('data-selected',String(i===index&&!before)));
        root.querySelector('.YtmCommentRendererCount').textContent=index===0&&!before?'11':'10';
      };
      renderer.appendChild(button);menu.querySelector('.bottom-sheet-comment-menu-item').appendChild(renderer);
    }
    if(options.ambiguous){const duplicate=menu.querySelector('ytm-toggle-menu-service-item-renderer').cloneNode(true);menu.querySelector('.bottom-sheet-comment-menu-item').appendChild(duplicate);}
  }
  function wire(root){const content=root.querySelector('.YtmCommentRendererContent');const openMenu=()=>{
    opens.push(root.id);
    if(options.noMenu)return;
    win.history.replaceState({},'','#bottom-sheet');
    if(options.deferredContainer){doc.body.setAttribute('bottom-sheet-open','');return;}
    menu.hidden=false;
    if(options.login){menu.querySelector('.bottom-sheet-comment-menu-item').textContent='Zum Bewerten bitte anmelden';return;}
    if(!options.lazy)populate(root);
  };if(options.menuControl){
    content.onclick=()=>{root.setAttribute('data-replies-open','true');};
    const opener=doc.createElement('button');opener.className='YtmCommentRendererMenu';opener.textContent='Mehr';
    opener.onclick=event=>{event.stopPropagation();openMenu();};content.querySelector('.YtmCommentRendererDetails').appendChild(opener);
  }else content.onclick=openMenu;}
  panel.querySelectorAll('ytm-comment-renderer').forEach(wire);
  menu.querySelector('.close-button').onclick=()=>{menu.hidden=true;win.history.replaceState({},'','/watch?v=abcdefghijk');win.dispatchEvent(new win.PopStateEvent('popstate'));};
  const frame=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn());};
  const flush=async()=>{for(let i=0;i<4;i++){await Promise.resolve();frame();}};
  const timeout=delay=>{for(const [id,item]of [...timers])if(item.delay===delay){timers.delete(id);item.fn();}};
  win.eval(source);frame();
  const root=id=>doc.getElementById(id),button=(id,index)=>root(id).querySelectorAll('[data-langform-comment-reaction]')[index];
  t.after(()=>{win.dispatchEvent(new win.Event('pagehide'));dom.window.close();assert.deepEqual(errors,[]);});
  return {win,doc,panel,menu,root,button,opens,actions,icons,populate,wire,frames,timers,frame,flush,timeout,advance:value=>{now+=value;}};
}

test('direct thumb buttons are independent siblings over the existing YouTube icons and preserve the original comment menu',async t=>{
  const s=setup(t),content=s.root('a').querySelector('.YtmCommentRendererContent');
  assert.equal(s.doc.querySelectorAll('[data-langform-comment-reaction]').length,4);
  assert.equal(s.button('a',0).closest('.YtmCommentRendererContent'),null,'no nested buttons inside YouTube’s comment button');
  assert.equal(s.button('a',0).style.left,'44px');assert.equal(s.button('a',1).style.left,'88px');assert.equal(s.button('a',0).style.height,'44px');
  assert.equal(s.button('a',0).getAttribute('aria-pressed'),'false');assert.ok(s.button('a',1).getAttribute('aria-label').includes('Mag ich nicht'));
  content.click();await s.flush();assert.equal(s.menu.hidden,false);assert.deepEqual(s.opens,['a']);assert.deepEqual(s.actions,[],'ordinary comment tap retains its original menu');
});
test('one direct like executes the actual matching original menu action and updates only from YouTube',async t=>{
  const s=setup(t),button=s.button('b',0);button.click();await s.flush();
  assert.deepEqual(s.opens,['b']);assert.deepEqual(s.actions,[['b',0]]);assert.equal(s.menu.hidden,true);
  assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(s.root('b').querySelector('.YtmCommentRendererCount').textContent,'11');
  assert.equal(s.button('a',0).getAttribute('aria-pressed'),'false');assert.equal(button.disabled,false);assert.equal(s.menu.hasAttribute('data-langform-comment-direct-menu'),false);
});
test('direct thumbs use the comment’s own menu button when the content tap opens replies',async t=>{
  const s=setup(t,{menuControl:true});
  for(const index of [0,1]){s.button('b',index).click();await s.flush();}
  assert.deepEqual(s.actions,[['b',0],['b',1]]);assert.deepEqual(s.opens,['b','b']);
  assert.equal(s.root('b').hasAttribute('data-replies-open'),false);
  assert.equal(s.button('b',1).getAttribute('aria-pressed'),'true');
});
test('disabled native menu button cannot trigger the content/replies fallback',async t=>{
  const s=setup(t,{menuControl:true});s.root('a').querySelector('.YtmCommentRendererMenu').disabled=true;
  s.button('a',0).click();await s.flush();assert.deepEqual(s.opens,[]);assert.deepEqual(s.actions,[]);
  assert.equal(s.root('a').hasAttribute('data-replies-open'),false);
});
test('a replaced menu opener invalidates the unfinished original command',async t=>{
  const s=setup(t,{menuControl:true,lazy:true});s.button('a',0).click();await s.flush();
  assert.deepEqual(s.opens,['a']);s.root('a').querySelector('.YtmCommentRendererMenu').remove();
  s.populate(s.root('a'));await s.flush();assert.deepEqual(s.actions,[]);assert.equal(s.menu.hidden,false);
});
test('native sheet-open marker binds its still-hidden container before deferred menu hydration',async t=>{
  const s=setup(t,{menuControl:true,deferredContainer:true});s.button('a',0).click();
  assert.equal(s.menu.hidden,true);s.populate(s.root('a'));s.menu.hidden=false;await s.flush();
  assert.deepEqual(s.actions,[['a',0]]);assert.equal(s.menu.hidden,true);
  assert.equal(s.button('a',0).getAttribute('aria-pressed'),'true');
});
test('a sheet-open marker outside the opening window cannot adopt another menu',async t=>{
  const s=setup(t,{menuControl:true,noMenu:true});s.button('a',0).click();
  s.advance(501);s.doc.body.setAttribute('bottom-sheet-open','');s.win.history.replaceState({},'','#bottom-sheet');
  s.populate(s.root('b'));s.menu.hidden=false;await s.flush();assert.deepEqual(s.actions,[]);
});
test('native menu markers and items may arrive asynchronously after the own three-dot click',async t=>{
  const s=setup(t,{menuControl:true,noMenu:true});s.button('a',0).click();
  s.advance(80);s.doc.body.setAttribute('bottom-sheet-open','');s.win.history.replaceState({},'','#bottom-sheet');
  s.populate(s.root('a'));s.menu.hidden=false;await s.flush();
  assert.deepEqual(s.actions,[['a',0]]);assert.equal(s.menu.hidden,true);
});
test('intervening user input cancels attribution of an asynchronously opened native menu',async t=>{
  const s=setup(t,{menuControl:true,noMenu:true});s.button('a',0).click();
  s.root('b').dispatchEvent(new s.win.Event('pointerdown',{bubbles:true}));
  s.doc.body.setAttribute('bottom-sheet-open','');s.win.history.replaceState({},'','#bottom-sheet');
  s.populate(s.root('b'));s.menu.hidden=false;await s.flush();assert.deepEqual(s.actions,[]);
});
test('native deferred opening selects its one active sheet among normal/fullscreen containers',async t=>{
  const s=setup(t,{menuControl:true,deferredContainer:true});
  const other=s.doc.createElement('bottom-sheet-container');other.hidden=true;other.innerHTML='<button>Fullscreen</button>';s.doc.body.appendChild(other);
  s.button('b',1).click();s.populate(s.root('b'));s.menu.hidden=false;await s.flush();
  assert.deepEqual(s.actions,[['b',1]]);assert.equal(other.hidden,true);assert.equal(s.menu.hidden,true);
});
test('repeat like removes it, dislike replaces like, and repeat dislike removes it',async t=>{
  const s=setup(t);
  for(const [index,like,dislike]of [[0,true,false],[0,false,false],[0,true,false],[1,false,true],[1,false,false]]){
    s.button('a',index).click();await s.flush();
    assert.equal(s.button('a',0).getAttribute('aria-pressed'),String(like));assert.equal(s.button('a',1).getAttribute('aria-pressed'),String(dislike));
  }
  assert.deepEqual(s.actions,[['a',0],['a',0],['a',0],['a',1],['a',1]]);
});
for(const labels of [['Like','Dislike'],['Unlike','Remove dislike'],['Gefällt mir nicht mehr','Mag ich nicht entfernen'],['Mag ich','Dislike entfernen']])test(`native action labels support selection/removal (${labels.join(' / ')})`,async t=>{
  const s=setup(t,{labels});s.button('a',1).click();await s.flush();assert.deepEqual(s.actions,[['a',1]]);
});
test('slow original confirmation never fabricates pressed state or vote counts and a rapid second tap does not duplicate a reaction',async t=>{
  const s=setup(t,{noConfirmation:true});s.button('a',0).click();s.button('a',0).click();s.button('b',1).click();await s.flush();
  assert.deepEqual(s.actions,[['a',0]]);assert.equal(s.button('a',0).getAttribute('aria-pressed'),'false');assert.equal(s.root('a').querySelector('.YtmCommentRendererCount').textContent,'10');
  s.timeout(2000);await s.flush();assert.match(s.doc.getElementById('langform-comment-reaction-notice').textContent,/nicht bestätigt/);assert.equal(s.button('a',0).disabled,false);
});
for(const option of ['login','ambiguous'])test(`login or ambiguous menu stays visible without any invented reaction (${option})`,async t=>{
  const s=setup(t,{[option]:true});s.button('a',0).click();await s.flush();s.timeout(2000);await s.flush();
  assert.deepEqual(s.actions,[]);assert.equal(s.menu.hidden,false);assert.equal(s.menu.hasAttribute('data-langform-comment-direct-menu'),false);assert.equal(s.button('a',0).getAttribute('aria-pressed'),'false');
});
test('unsupported menu labels stay available for the user rather than guessing an action',async t=>{
  const s=setup(t,{labels:['Responder','Denunciar']});s.button('a',0).click();await s.flush();s.timeout(2000);await s.flush();
  assert.equal(s.menu.hidden,false);assert.deepEqual(s.actions,[]);
});
test('lazy menu items in the synchronously opened original container are selected once',async t=>{
  const s=setup(t,{lazy:true});s.button('b',1).click();s.populate(s.root('b'));await s.flush();assert.deepEqual(s.actions,[['b',1]]);assert.equal(s.menu.hidden,true);
});
test('an unrelated menu appearing later cannot be adopted as this comment’s command',async t=>{
  const s=setup(t,{noMenu:true});s.button('a',0).click();s.menu.hidden=false;s.populate(s.root('b'));await s.flush();
  assert.deepEqual(s.actions,[]);assert.equal(s.menu.hidden,false);
});
for(const change of ['video','comment','remove','input','hide','escape','pagehide'])test(`an unfinished reaction cannot act after ownership changes (${change})`,async t=>{
  const s=setup(t,{lazy:true});s.button('a',0).click();
  if(change==='video')s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');
  if(change==='comment')s.root('a').querySelector('.YtmCommentRendererText').textContent='A different hydrated comment';
  if(change==='remove')s.root('a').remove();
  if(change==='input')s.doc.body.dispatchEvent(new s.win.Event('pointerdown',{bubbles:true}));
  if(change==='hide'){Object.defineProperty(s.doc,'hidden',{value:true});s.doc.dispatchEvent(new s.win.Event('visibilitychange'));}
  if(change==='escape')s.doc.dispatchEvent(new s.win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  if(change==='pagehide')s.win.dispatchEvent(new s.win.Event('pagehide'));
  const root=s.root('a')||s.root('b');s.populate(root);await s.flush();s.timeout(2000);await s.flush();assert.deepEqual(s.actions,[]);assert.equal(s.menu.hasAttribute('data-langform-comment-direct-menu'),false);
});
test('disabled/paused source icons and an existing modal block direct reactions',async t=>{
  const s=setup(t);s.icons(s.root('a'))[0].setAttribute('data-disabled','true');await s.flush();s.button('a',0).click();assert.deepEqual(s.opens,[]);
  s.menu.hidden=false;s.populate(s.root('b'));s.button('a',1).click();assert.deepEqual(s.opens,[]);
});
test('a cancelled pointer or a drag over the thumb cannot produce a trailing click reaction',async t=>{
  const s=setup(t),button=s.button('a',0);
  const event=(name,values)=>{const event=new s.win.Event(name,{bubbles:true});Object.assign(event,values);button.dispatchEvent(event);};
  const trailingClick=()=>button.dispatchEvent(new s.win.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
  event('pointerdown',{pointerId:1,clientX:10,clientY:10});event('pointermove',{pointerId:1,clientX:12,clientY:35});event('pointerup',{pointerId:1});trailingClick();assert.deepEqual(s.actions,[]);
  s.advance(1000);event('pointerdown',{pointerId:2,clientX:10,clientY:10});event('pointercancel',{pointerId:2});trailingClick();assert.deepEqual(s.actions,[]);
  s.advance(1000);button.click();await s.flush();assert.deepEqual(s.actions,[['a',0]]);
});
test('explicit keyboard/assistive activation remains available after a cancelled pointer gesture',async t=>{
  const s=setup(t),button=s.button('a',0);button.dispatchEvent(new s.win.Event('pointercancel',{bubbles:true}));
  button.focus();button.click();await s.flush();assert.deepEqual(s.actions,[['a',0]]);assert.equal(s.doc.activeElement,button);
});
test('new replies and replacement renderers get one fresh set of controls; closed/reopened panels retain actual source state',async t=>{
  const s=setup(t);s.panel.querySelector('.engagement-panel-content-wrapper').insertAdjacentHTML('beforeend',comment('reply'));s.wire(s.root('reply'));await s.flush();
  assert.equal(s.root('reply').querySelectorAll('[data-langform-comment-reaction]').length,2);s.button('reply',1).click();await s.flush();
  s.panel.hidden=true;await s.flush();assert.equal(s.button('reply',1).hidden,true);s.panel.hidden=false;await s.flush();assert.equal(s.button('reply',1).getAttribute('aria-pressed'),'true');
  s.root('a').querySelector('.YtmCommentRendererContent').outerHTML=comment('fresh').match(/<button[\s\S]*<\/button>/)[0];s.wire(s.root('a'));await s.flush();
  assert.equal(s.root('a').querySelectorAll('[data-langform-comment-reaction]').length,2);
});
test('idle scroll does not schedule geometry work; pagehide and restored pages release and rebuild ownership',async t=>{
  const s=setup(t);await s.flush();assert.equal(s.frames.size,0);for(let i=0;i<100;i++)s.panel.dispatchEvent(new s.win.Event('scroll'));assert.equal(s.frames.size,0);
  s.win.dispatchEvent(new s.win.PageTransitionEvent('pagehide',{persisted:true}));assert.equal(s.doc.querySelectorAll('[data-langform-comment-reaction]').length,0);assert.equal(s.doc.getElementById('langform-comment-reactions-style'),null);assert.equal(s.timers.size,0);
  s.win.dispatchEvent(new s.win.PageTransitionEvent('pageshow',{persisted:true}));await s.flush();assert.equal(s.doc.querySelectorAll('[data-langform-comment-reaction]').length,4);s.button('a',0).click();await s.flush();assert.deepEqual(s.actions,[['a',0]]);
});
