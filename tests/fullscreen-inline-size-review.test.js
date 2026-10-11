const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// These checks exercise real DOM mutation delivery and lease cleanup. Layout
// and CSS cascade claims require the separate actual WKWebView fixtures.
function setup(t, options = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main><div id="movie_player"><div class="html5-video-container" style="width:390px;height:219.375px"><video class="html5-main-video" style="width:390px;height:219.375px"></video></div></div></main></body></html>', {
    url: 'https://m.youtube.com/watch?v=abcdefghijk', runScripts: 'outside-only',
  });
  const win = dom.window, root = win.document.getElementById('movie_player');
  const video = root.querySelector('video'), container = video.parentElement;
  if (options.placement) {
    video.style.position = 'absolute';
    video.style.top = options.top || '0px';
    video.style.left = options.left || '0px';
    video.style.transform = options.transform || 'none';
    root.getBoundingClientRect = () => ({x:0,y:100,width:390,height:219.375});
    video.getBoundingClientRect = () => ({x:Number.parseFloat(video.style.left) || 0,y:100+(Number.parseFloat(video.style.top) || 0),width:390,height:219.375,left:Number.parseFloat(video.style.left) || 0,top:100+(Number.parseFloat(video.style.top) || 0)});
  }
  root.getVideoData = () => ({ video_id: 'abcdefghijk' });
  win.scrollTo = () => {};
  win.webkit = { messageHandlers: { langformFullscreen: { postMessage() {} } } };
  const errors = [];
  win.addEventListener('error', event => { errors.push(event.message); event.preventDefault(); });
  t.after(() => { win.dispatchEvent(new win.Event('pagehide')); dom.window.close(); assert.deepEqual(errors, []); });
  const source = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/FullscreenMotion.js'), 'utf8');
  const entry = 'win.__langformFullscreen = {';
  assert.ok(source.includes(entry), 'shipping fullscreen API entry point exists');
  win.eval(source.replace(entry,
    'win.__reviewInlineSizeOwner={claim:claimInlineSizeOwner,apply:applyInlineSizeOwner,release:releaseInlineSizeOwner,cache:cacheInlineDestination};' + entry));
  const lease = {
    id: 'abcdefghijk', root, video,
    videoDimensions: [['390px', ''], ['219.375px', '']],
    inlineContainerDimensions: [['390px', ''], ['219.375px', '']],
  };
  if (options.placement) win.__reviewInlineSizeOwner.cache(lease);
  assert.equal(win.__reviewInlineSizeOwner.claim(lease), true);
  return { win, root, video, container, owner: win.__reviewInlineSizeOwner, lease };
}
async function mutations() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
function property(node, key) { return [node.style.getPropertyValue(key), node.style.getPropertyPriority(key)]; }

test('persistent inline size lease preserves latest author dimensions and priorities after its own reapply', async t => {
  const s = setup(t);
  s.container.style.setProperty('width', '402px', 'important');
  s.video.style.setProperty('height', '226.125px', 'important');
  await mutations();
  assert.deepEqual(property(s.container, 'width'), ['100%', 'important']);
  assert.deepEqual(property(s.video, 'height'), ['100%', 'important']);
  s.owner.release();
  assert.deepEqual(property(s.container, 'width'), ['402px', 'important'], 'latest YouTube width belongs to the author');
  assert.deepEqual(property(s.video, 'height'), ['226.125px', 'important'], 'latest YouTube height and priority survive release');
  assert.deepEqual(property(s.video, 'width'), ['390px', ''], 'unchanged author dimension retains its original priority');
});

test('an author removing a dimension is preserved by cleanup after inline size reapply', async t => {
  const s = setup(t);
  s.container.style.removeProperty('height');
  s.video.style.removeProperty('width');
  await mutations();
  assert.deepEqual(property(s.container, 'height'), ['100%', 'important']);
  assert.deepEqual(property(s.video, 'width'), ['100%', 'important']);
  s.owner.release();
  assert.deepEqual(property(s.container, 'height'), ['', '']);
  assert.deepEqual(property(s.video, 'width'), ['', '']);
});

test('stable owner reapply does not create a mutation loop and navigation releases its correction', async t => {
  const s = setup(t);
  await mutations();
  const observer = new s.win.MutationObserver(() => {});
  observer.observe(s.root, { subtree: true, attributes: true, attributeFilter: ['style'] });
  for (let i = 0; i < 12; i++) s.owner.apply();
  assert.equal(observer.takeRecords().length, 0, 'an unchanged lease has no DOM writes');
  s.win.dispatchEvent(new s.win.Event('yt-navigate-start'));
  await mutations();
  assert.deepEqual(property(s.video, 'width'), ['390px', '']);
  assert.deepEqual(property(s.container, 'height'), ['219.375px', '']);
  s.video.style.width = '410px';
  await mutations();
  assert.deepEqual(property(s.video, 'width'), ['410px', ''], 'a retired lease cannot mutate the new navigation');
  observer.disconnect();
});

test('six later fullscreen sessions do not turn lease styles into author restore values', async t => {
  const s = setup(t);
  s.container.style.setProperty('height', '226.125px', 'important');
  s.video.style.setProperty('width', '402px', 'important');
  await mutations();
  const button = s.win.document.createElement('button');
  button.className = 'ytp-fullscreen-button';
  s.root.appendChild(button);
  await mutations();
  for (let cycle = 0; cycle < 6; cycle++) {
    button.click();
    assert.equal(s.win.__langformFullscreen.isOpen(), true, 'shipping control opens the next transaction');
    await mutations();
    assert.equal(s.win.__langformFullscreen.exit('abcdefghijk'), true);
    await mutations();
    assert.equal(s.win.__langformFullscreen.isOpen(), false);
    assert.deepEqual(property(s.video, 'width'), ['100%', 'important'], 'correction is still active between sessions');
  }
  s.win.dispatchEvent(new s.win.Event('yt-navigate-start'));
  await mutations();
  assert.deepEqual(property(s.video, 'width'), ['402px', 'important'], 'next-open cache must retain the latest real author width');
  assert.deepEqual(property(s.container, 'height'), ['226.125px', 'important']);
  assert.deepEqual(property(s.video, 'height'), ['219.375px', ''], 'lease CSS never becomes author CSS');
});

test('an author write immediately before the next fullscreen activation survives delayed observer delivery', async t => {
  const s = setup(t);
  await mutations();
  const button = s.win.document.createElement('button');
  button.className = 'ytp-fullscreen-button';
  s.root.appendChild(button);
  await mutations();
  // YouTube can update its media style and call the fullscreen API within the
  // same task. The MutationObserver has not delivered the author write yet.
  s.video.style.setProperty('width', '414px', 'important');
  button.click();
  assert.equal(s.win.__langformFullscreen.isOpen(), true);
  await mutations();
  s.win.__langformFullscreen.exit('abcdefghijk');
  await mutations();
  s.win.dispatchEvent(new s.win.Event('yt-navigate-start'));
  await mutations();
  assert.deepEqual(property(s.video, 'width'), ['414px', 'important']);
});

for (const boundary of ['ad', 'watch ID', 'media ID before URL change', 'reparent', 'pagehide']) {
  test(`inline size lease retires at ${boundary} boundary without affecting later author changes`, async t => {
    const s = setup(t);
    await mutations();
    if (boundary === 'ad') s.root.classList.add('ad-showing');
    if (boundary === 'watch ID') {
      s.win.history.replaceState({}, '', '/watch?v=zyxwvutsrqp');
      s.win.dispatchEvent(new s.win.Event('video-data-change'));
    }
    if (boundary === 'media ID before URL change') {
      s.root.getVideoData = () => ({ video_id: 'zyxwvutsrqp' });
      s.win.dispatchEvent(new s.win.Event('video-data-change'));
    }
    if (boundary === 'reparent') {
      const next = s.win.document.createElement('div');
      next.className = 'html5-video-container';
      s.root.appendChild(next);
      next.appendChild(s.video);
    }
    if (boundary === 'pagehide') s.win.dispatchEvent(new s.win.Event('pagehide'));
    await mutations();
    assert.deepEqual(property(s.video, 'width'), ['390px', '']);
    assert.deepEqual(property(s.container, 'height'), ['219.375px', '']);
    s.video.style.setProperty('height', '240px', 'important');
    await mutations();
    assert.deepEqual(property(s.video, 'height'), ['240px', 'important'], 'the retired observer owns no later author writes');
  });
}

test('originally flush inline placement survives late landscape top/left writes and restores their exact author priorities',async t => {
  const s=setup(t,{placement:true});
  s.video.style.setProperty('top','191px','important');s.video.style.setProperty('left','80px');
  await mutations();
  assert.deepEqual(property(s.video,'top'),['0px','important']);
  assert.deepEqual(property(s.video,'left'),['0px','important']);
  s.owner.release();
  assert.deepEqual(property(s.video,'top'),['191px','important']);
  assert.deepEqual(property(s.video,'left'),['80px','']);
});

for (const original of [{top:'17px'},{left:'5px'},{transform:'translateY(3px)'}]) test(`original author placement is outside the zero-origin correction (${JSON.stringify(original)})`,async t => {
  const s=setup(t,{placement:true,...original});
  s.video.style.setProperty('top','23px');s.video.style.setProperty('left','9px','important');
  await mutations();
  assert.deepEqual(property(s.video,'top'),['23px','']);
  assert.deepEqual(property(s.video,'left'),['9px','important']);
  s.owner.release();
  assert.deepEqual(property(s.video,'top'),['23px','']);assert.deepEqual(property(s.video,'left'),['9px','important']);
});

for (const boundary of ['ad','watch ID','reparent','replacement','pagehide']) test(`inline placement retires at ${boundary} and cannot affect later media styles`,async t => {
  const s=setup(t,{placement:true});
  s.video.style.top='191px';s.video.style.left='80px';await mutations();
  const replacement=s.video.cloneNode();replacement.style.top='37px';
  if (boundary==='ad') s.root.classList.add('ad-showing');
  if (boundary==='watch ID') {s.win.history.replaceState({},'','/watch?v=zyxwvutsrqp');s.win.dispatchEvent(new s.win.Event('video-data-change'));}
  if (boundary==='reparent') {const next=s.win.document.createElement('div');next.className='html5-video-container';s.root.appendChild(next);next.appendChild(s.video);}
  if (boundary==='replacement') s.video.replaceWith(replacement);
  if (boundary==='pagehide') s.win.dispatchEvent(new s.win.Event('pagehide'));
  await mutations();
  assert.deepEqual(property(s.video,'top'),['191px','']);assert.deepEqual(property(s.video,'left'),['80px','']);
  s.video.style.top='41px';replacement.style.top='47px';s.video.dispatchEvent(new s.win.Event('loadstart'));await mutations();
  assert.deepEqual(property(s.video,'top'),['41px','']);assert.deepEqual(property(replacement,'top'),['47px','']);
});

test('same-element src change retires placement ownership before another style write',async t => {
  const s=setup(t,{placement:true});
  s.video.style.top='191px';await mutations();assert.deepEqual(property(s.video,'top'),['0px','important']);
  s.video.setAttribute('src','https://example.test/new-source');await mutations();
  assert.deepEqual(property(s.video,'top'),['191px','']);
  s.video.style.setProperty('top','29px','important');s.video.style.left='7px';await mutations();
  s.video.dispatchEvent(new s.win.Event('loadstart'));s.video.dispatchEvent(new s.win.Event('loadedmetadata'));await mutations();
  assert.deepEqual(property(s.video,'top'),['29px','important']);assert.deepEqual(property(s.video,'left'),['7px','']);
});

test('new currentSrc and immediate fresh author positioning are preserved before observer delivery',async t => {
  const s=setup(t,{placement:true});
  Object.defineProperty(s.video,'currentSrc',{value:'https://example.test/new-current-source',configurable:true});
  s.video.style.setProperty('top','19px','important');s.video.style.left='4px';
  s.video.dispatchEvent(new s.win.Event('loadstart'));
  await mutations();
  assert.deepEqual(property(s.video,'top'),['19px','important']);assert.deepEqual(property(s.video,'left'),['4px','']);
  s.video.style.top='33px';await mutations();assert.deepEqual(property(s.video,'top'),['33px','']);
});

test('stable placement lease does not produce mutation loops and preserves author removal on release',async t => {
  const s=setup(t,{placement:true});await mutations();
  const observer=new s.win.MutationObserver(()=>{});observer.observe(s.video,{attributes:true,attributeFilter:['style']});
  for(let i=0;i<12;i++)s.owner.apply();assert.equal(observer.takeRecords().length,0);observer.disconnect();
  s.video.style.removeProperty('top');s.video.style.removeProperty('left');await mutations();
  assert.deepEqual(property(s.video,'top'),['0px','important']);s.owner.release();
  assert.deepEqual(property(s.video,'top'),['','']);assert.deepEqual(property(s.video,'left'),['','']);
});

test('a later explicitly qualified source acquires a fresh placement lease on the surviving size owner',async t => {
  const s=setup(t,{placement:true});
  s.video.setAttribute('src','https://example.test/new-source');await mutations();
  s.video.style.top='0px';s.video.style.left='0px';await mutations();
  const next={id:'abcdefghijk',root:s.root,video:s.video};
  s.owner.cache(next);assert.equal(next.inlinePlacementEligible,true);
  assert.equal(s.owner.claim(next),true);
  s.video.style.top='191px';s.video.style.left='80px';await mutations();
  assert.deepEqual(property(s.video,'top'),['0px','important']);
  assert.deepEqual(property(s.video,'left'),['0px','important']);
  s.owner.release();
  assert.deepEqual(property(s.video,'top'),['191px','']);
  assert.deepEqual(property(s.video,'left'),['80px','']);
});

test('source replacement during the next active fullscreen transaction removes its own pin and correction',async t => {
  const s=setup(t,{placement:true});await mutations();
  const button=s.win.document.createElement('button');button.className='ytp-fullscreen-button';s.root.appendChild(button);await mutations();
  button.click();assert.equal(s.win.__langformFullscreen.isOpen(),true);
  s.video.style.setProperty('top','191px','important');s.video.style.setProperty('left','80px','important');await mutations();
  s.video.setAttribute('src','https://example.test/new-source');s.video.dispatchEvent(new s.win.Event('loadstart'));await mutations();
  assert.equal(s.win.__langformFullscreen.isOpen(),false,'an owned pose cannot pin replacement media');
  assert.equal(s.win.document.getElementById('langform-fullscreen-ui'),null);
  assert.equal(s.video.hasAttribute('data-langform-fullscreen-enter-video'),false);
  assert.equal(s.video.hasAttribute('data-langform-fullscreen-exit-video'),false);
  assert.deepEqual(property(s.video,'top'),['191px','important']);assert.deepEqual(property(s.video,'left'),['80px','important']);
  s.video.style.top='39px';await mutations();assert.deepEqual(property(s.video,'top'),['39px','']);
});
