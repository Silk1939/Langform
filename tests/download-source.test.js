const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../ios/Langform/Langform/DownloadSource.js'), 'utf8');
const now = 2000000000000;
const id = 'M7lc1UVf-VE';
function format(overrides = {}) { return {url:'https://r1.googlevideo.com/videoplayback?expire=2000003600', mimeType:'video/mp4; codecs="avc1.64001F, mp4a.40.2"', height:360, contentLength:'50000', ...overrides}; }
function inspect(response = {}, options = {}) {
  const window = { location:{href:options.href || `https://m.youtube.com/watch?v=${id}`}, navigator:{userAgent:'Safari QA'}, ytcfg:{get(){return options.playerScript || '/s/player/current/player_ias.vflset/en_US/base.js';}}, performance:{getEntriesByType(){return options.resources || []; }}, ytInitialPlayerResponse:{videoDetails:{videoId:id,title:'The Video'}, streamingData:{formats:[format()]}, ...response}, document:{ scripts:[], getElementById(){ return options.player || null; }, querySelector(){return {currentSrc:options.currentSrc || '',readyState:options.readyState ?? 2};} } };
  vm.runInNewContext(code, {window,URL,Date:{now:()=>now}, module:{exports:{}}});
  return window.__langformDownloadSource();
}
test('selects highest complete progressive format', () => { const r=inspect({streamingData:{formats:[format(),format({height:720,url:'https://r2.googlevideo.com/videoplayback?expire=2000003600'})]}}); assert.equal(r.reason,'available'); assert.equal(r.source.height,720); assert.equal(r.videoID,id); });
test('never takes an audio-only adaptive stream',()=>assert.equal(inspect({streamingData:{adaptiveFormats:[format()],formats:[]}}).reason,'adaptive-only'));
test('blob-only has an explicit unsupported result',()=>assert.equal(inspect({streamingData:{}},{currentSrc:'blob:https://m.youtube.com/a'}).reason,'blob-only'));
test('malformed cipher cannot become a source',()=>assert.equal(inspect({streamingData:{formats:[format({url:undefined,signatureCipher:'encrypted'})]}}).reason,'cipher'));
test('stale response identity cannot cross video navigation',()=>assert.equal(inspect({videoDetails:{videoId:'abcdefghijk'}}).reason,'stale-response'));
test('active response wins over stale global response',()=>assert.equal(inspect({videoDetails:{videoId:'abcdefghijk'}},{player:{getPlayerResponse(){return {videoDetails:{videoId:id,title:'Current'},streamingData:{formats:[format()]}};}}}).title,'Current'));
test('protected video is excluded',()=>assert.equal(inspect({drmFamilies:['widevine']}).reason,'protected'));
test('live content is excluded',()=>assert.equal(inspect({videoDetails:{videoId:id,isLiveContent:true}}).reason,'live'));
test('non HTTPS direct sources are excluded',()=>assert.equal(inspect({streamingData:{formats:[format({url:'http://r1.googlevideo.com/videoplayback'})]}}).reason,'missing-source'));
test('range and segment sources are excluded',()=>{ for(const query of ['range=0-100','sq=1']) assert.equal(inspect({streamingData:{formats:[format({url:`https://r1.googlevideo.com/videoplayback?${query}`})]}}).reason,'missing-source'); });
test('host suffix does not accept googlevideo lookalikes',()=>assert.equal(inspect({streamingData:{formats:[format({url:'https://googlevideo.com.evil.invalid/video'})]}}).reason,'missing-source'));
test('source expiring within one minute cannot start',()=>assert.equal(inspect({streamingData:{formats:[format({url:'https://r1.googlevideo.com/videoplayback?expire=2000000030'})]}}).reason,'expired'));
test('a valid complete source may coexist with blob playback',()=>assert.equal(inspect({}, {currentSrc:'blob:https://m.youtube.com/a'}).reason,'available'));
test('unavailable and non-watch pages are explicit unsupported states',()=>{ assert.equal(inspect({playabilityStatus:{status:'LOGIN_REQUIRED'}}).reason,'unavailable'); assert.equal(inspect({}, {href:'https://m.youtube.com/'}).reason,'not-watch'); });
test('video-only format is excluded',()=>assert.equal(inspect({streamingData:{formats:[format({mimeType:'video/mp4; codecs="avc1.64001F"'})]}}).reason,'missing-source'));
test('2 GB cap is enforced before a file download',()=>assert.equal(inspect({streamingData:{formats:[format({contentLength:'2147483649'})]}}).reason,'missing-source'));
test('reader creates no network or playback effects',()=>assert.ok(!/fetch\(|XMLHttpRequest|\.play\(|\.pause\(|\.src\s*=|appendChild\(/.test(code)));
test('completed livestream recordings retain file availability',()=>assert.equal(inspect({videoDetails:{videoId:id,isLiveContent:true,lengthSeconds:'1344'},microformat:{playerMicroformatRenderer:{liveBroadcastDetails:{isLiveNow:false,endTimestamp:'2013-04-10T17:23:06+00:00'}}}}).reason,'available'));
test('uses the active player resolved URL only for the same combined format',()=>{
  const r=inspect({streamingData:{formats:[format({itag:18,url:'https://r1.googlevideo.com/videoplayback?id=same-media&itag=18&n=initial'})]}},{currentSrc:'https://r2.googlevideo.com/videoplayback?id=same-media&itag=18&n=already-resolved'});
  assert.match(r.source.url,/n=already-resolved/);
});
test('cannot take a different video or adaptive media URL from the active element',()=>{
  const r=inspect({streamingData:{formats:[format({itag:18,url:'https://r1.googlevideo.com/videoplayback?id=same-media&itag=18'})]}},{currentSrc:'https://r2.googlevideo.com/videoplayback?id=ad-media&itag=18'});
  assert.match(r.source.url,/id=same-media/);
});
test('blob playback may use an already observed complete progressive request with matching media and format',()=>{
  const r=inspect({streamingData:{formats:[format({itag:18,url:'https://r1.googlevideo.com/videoplayback?id=same-media&itag=18&n=initial'})]}},{currentSrc:'blob:https://m.youtube.com/main',resources:[{name:'https://r2.googlevideo.com/videoplayback?id=same-media&itag=18&n=browser-resolved',responseStatus:200}]});
  assert.match(r.source.url,/n=browser-resolved/);
});
test('raw progressive n must use the exact current player before native download',()=>{
  const r=inspect({streamingData:{formats:[format({url:'https://r1.googlevideo.com/videoplayback?id=source&n=raw'})]}});
  assert.equal(r.source.requiresResolution,true);
  assert.equal(Object.hasOwn(r.source,'signatureChallenge'),false);
  assert.equal(Object.hasOwn(r.source,'signatureParameter'),false);
  assert.equal(r.playerScriptURL,'https://m.youtube.com/s/player/current/player_ias.vflset/en_US/base.js');
  assert.equal(r.userAgent,'Safari QA');
});
test('valid cipher preserves the signature challenge and its own signature parameter',()=>{
  const cipher=new URLSearchParams({url:'https://r1.googlevideo.com/videoplayback?id=source&n=raw',s:'encrypted-s',sp:'sig'}).toString();
  const r=inspect({streamingData:{formats:[format({url:undefined,signatureCipher:cipher})]}});
  assert.equal(r.reason,'available'); assert.equal(r.source.requiresResolution,true);
  assert.equal(r.source.signatureChallenge,'encrypted-s'); assert.equal(r.source.signatureParameter,'sig');
});
test('an unconfirmed cross-origin or unloaded media URL cannot be treated as resolved',()=>{
  const raw='https://r1.googlevideo.com/videoplayback?id=same&itag=18&n=raw';
  const other='https://r1.googlevideo.com/videoplayback?id=same&itag=18&n=unconfirmed';
  for (const options of [{resources:[{name:other,responseStatus:0}]},{currentSrc:other,readyState:0}]) {
    const r=inspect({streamingData:{formats:[format({url:raw,itag:18})]}},options);
    assert.equal(r.source.url,raw); assert.equal(r.source.requiresResolution,true);
  }
});
test('confirmed matching browser source is never transformed a second time',()=>{
  const r=inspect({streamingData:{formats:[format({url:'https://r1.googlevideo.com/videoplayback?id=same&itag=18&n=raw',itag:18})]}},{resources:[{name:'https://r1.googlevideo.com/videoplayback?id=same&itag=18&n=resolved',responseStatus:206}]});
  assert.equal(r.source.requiresResolution,false); assert.match(r.source.url,/n=resolved/);
});
test('foreign player script and hostile signature parameter are not resolution inputs',()=>{
  const r=inspect({}, {playerScript:'https://foreign.invalid/s/player/test/base.js'});
  assert.equal(r.playerScriptURL,undefined);
  const cipher=new URLSearchParams({url:'https://r1.googlevideo.com/videoplayback',s:'s',sp:'n&changed=true'}).toString();
  assert.equal(inspect({streamingData:{formats:[format({url:undefined,signatureCipher:cipher})]}}).reason,'cipher');
});
test('partial active or observed URLs cannot displace the declared complete source',()=>{
  const original='https://r1.googlevideo.com/videoplayback?id=same-media&itag=18&n=original';
  for(const query of ['range=0-100','sq=1']) {
    const partial='https://r2.googlevideo.com/videoplayback?id=same-media&itag=18&'+query;
    const r=inspect({streamingData:{formats:[format({itag:18,url:original})]}},{currentSrc:partial,resources:[{name:partial}]});
    assert.equal(r.source.url,original);
  }
});
test('observed requests from another media, adaptive format, expired source or reported HTTP failure are ignored',()=>{
  const original='https://r1.googlevideo.com/videoplayback?id=same-media&itag=18&n=original';
  const names=['https://r2.googlevideo.com/videoplayback?id=other-media&itag=18', 'https://r2.googlevideo.com/videoplayback?id=same-media&itag=137', 'https://r2.googlevideo.com/videoplayback?id=same-media&itag=18&expire=2000000030'];
  for(const name of names) assert.equal(inspect({streamingData:{formats:[format({itag:18,url:original})]}},{resources:[{name}]}).source.url,original);
  assert.equal(inspect({streamingData:{formats:[format({itag:18,url:original})]}},{resources:[{name:'https://r2.googlevideo.com/videoplayback?id=same-media&itag=18&n=denied',responseStatus:403}]}).source.url,original);
});
