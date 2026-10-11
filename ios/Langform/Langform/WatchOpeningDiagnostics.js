// Explicit, launch-only QA. Drives only Langform's existing feed/watch path;
// never reports titles, accounts, comments, URLs, request bodies or headers.
(function (win) {
  'use strict';
  var mode=win.__langformOpeningProbeMode, bridge=win.webkit&&win.webkit.messageHandlers&&win.webkit.messageHandlers.langformOpeningProbe;
  if(!bridge||!['home','subscriptions','interrupt','rapid','inspect','search'].includes(mode))return;
  var doc=win.document, wait=ms=>new Promise(resolve=>win.setTimeout(resolve,ms));
  function post(row){bridge.postMessage(row);}
  function id(url){try{return new URL(url,win.location.href).searchParams.get('v');}catch(_){return null;}}
  function rect(node){var r=node.getBoundingClientRect();return {y:r.top,width:r.width,height:r.height};}
  function visibleSearchInput(){
    return Array.from(doc.querySelectorAll('yt-searchbox input[name="search_query"],yt-searchbox textarea[name="search_query"],ytm-searchbox input[name="search_query"]'))
      .find(node=>{var r=node.getBoundingClientRect();return r.width>40&&r.height>8&&win.getComputedStyle(node).visibility!=='hidden';});
  }
  function searchSnapshot(phase,finished){
    var input=visibleSearchInput();
    var panel=Array.from(doc.querySelectorAll('.ytSearchboxComponentMweb .ytSearchboxComponentSuggestionsContainer'))
      .find(node=>node.getBoundingClientRect().height>0);
    var r=input&&input.getBoundingClientRect(),p=panel&&panel.getBoundingClientRect(),safe=win.__langformStageInsets||{top:0};
    var visible=!!r&&r.width>40&&r.height>8&&r.top>=safe.top;
    var hit=visible&&doc.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    var below=!p||!!r&&p.top>=r.bottom;
    var results=win.location.pathname==='/results'&&new URL(win.location.href).searchParams.get('search_query')==='arte doku';
    var count=results?doc.querySelectorAll('ytm-video-with-context-renderer,ytm-video-renderer,ytm-compact-video-renderer,yt-lockup-view-model').length:0;
    post({phase:phase,finished:finished,elapsed:win.performance.now(),inputVisible:visible,inputReachable:!!input&&hit===input,suggestionsBelowHeader:below,
      inputY:r?r.top:-1,inputBottom:r?r.bottom:-1,inputWidth:r?r.width:0,panelY:p?p.top:-1,resultsCount:count,
      // YouTube collapses its editable searchbox after submission. Results
      // prove navigation/query/renderers; the preceding phase proves the field.
      passed:finished?results&&count>0:visible&&hit===input&&below});
    return input;
  }
  async function run(){
    await wait(6500);
    if(mode==='search'&&win.webkit.messageHandlers.langformOpenWatch){
      if(win.__langformFeedActive===false)return;
      if(win.location.pathname==='/results'){searchSnapshot('search-results',true);return;}
      win.__lfOpeningProbeGo=function(){
        (async function(){
          if(!win.__langformOpenSearch(987654))throw Error('search-control-unavailable');
          for(var attempt=0;attempt<30&&!visibleSearchInput();attempt++)await wait(100);
          var input=visibleSearchInput();if(!input)throw Error('search-input-unavailable');
          input.focus();
          await wait(1500);input=searchSnapshot('search-field',false);if(!input)throw Error('search-input-unavailable');
          var setter=Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?win.HTMLTextAreaElement.prototype:win.HTMLInputElement.prototype,'value').set;
          setter.call(input,'arte doku');input.dispatchEvent(new win.Event('input',{bubbles:true}));
          var form=input.closest('form');if(!form)throw Error('original-search-form-unavailable');
          if(form.requestSubmit)form.requestSubmit();else form.dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));
          await wait(6000);searchSnapshot('search-results',true);
        })().catch(()=>post({phase:'failed',finished:true,passed:false}));return true;
      };
      post({phase:'request'});return;
    }
    if(win.location.pathname!=='/watch'&&win.webkit.messageHandlers.langformOpenWatch){
      if(mode==='subscriptions'&&win.location.pathname!=='/feed/subscriptions'){
        if(win.__langformFeedActive!==false)post({phase:'switch'});return;
      }
      if(win.__langformFeedActive===false)return;
      if(mode==='interrupt'||mode==='rapid'){win.scrollBy(0,360);await wait(500);}
      var picture=null, link=null;
      function visibleImages(){
        return Array.from(doc.querySelectorAll('a[href] img')).filter(function(image){
          var anchor=image.closest('a[href]'), r=rect(image), video=id(anchor.href);
          return video&&/^[A-Za-z0-9_-]{11}$/.test(video)&&image.complete&&image.naturalWidth>0&&image.currentSrc&&
            r.width>100&&r.height>60&&r.y>100&&r.y+r.height<win.innerHeight-50&&
            !/\/(?:an_webp|an)\//.test(image.currentSrc);
        });
      }
      for(var attempt=0;attempt<80;attempt++){
        var images=visibleImages();
        // inspect explicitly exercises the playing inline preview; other
        // modes prefer a still card so both source paths are covered.
        picture=mode==='inspect'?images.find(function(image){
          var r=image.getBoundingClientRect();
          return Array.from(doc.querySelectorAll('video')).some(function(video){
            var v=video.getBoundingClientRect(),shown=win.getComputedStyle(video);
            return video.readyState>=2&&video.videoWidth>0&&shown.display!=='none'&&shown.visibility!=='hidden'&&shown.opacity!=='0'&&
              Math.abs(v.left-r.left)<2&&Math.abs(v.top-r.top)<2&&Math.abs(v.width-r.width)<2&&Math.abs(v.height-r.height)<2;
          });
        }):images.find(image=>!image.closest('ytm-video-with-context-renderer')?.querySelector('video'))||images[0];
        if(picture){link=picture.closest('a[href]');break;}await wait(150);
      }
      if(!picture)throw Error('no-decoded-visible-thumbnail');
      async function go(){
      var source=rect(picture), scroll=win.scrollY, asset=picture.currentSrc, clicked=win.performance.now();
      post({phase:'source',sourceY:source.y,scrollY:scroll,reduced:win.matchMedia('(prefers-reduced-motion: reduce)').matches,reopened:false});
      picture.click();
      await wait(80);
      var copy=doc.querySelector('#langform-watch-opening .lf-opening-picture img');
      var preview=doc.querySelector('#langform-watch-opening .lf-opening-picture canvas[data-lf-held-preview]');
      var flight=doc.querySelector('#langform-watch-opening .lf-opening-picture');
      post({phase:'moving',elapsed:win.performance.now()-clicked,pictureY:flight?rect(flight).y:-1,
        pictureWidth:flight?rect(flight).width:0,sameAsset:!!copy&&copy.currentSrc===asset,heldPreview:!!preview,
        passed:(!!copy&&copy.currentSrc===asset)||!!preview});
      if(mode==='interrupt'||mode==='rapid'){
        await wait(1100);
        var returned=!doc.getElementById('langform-watch-opening')&&Math.abs(win.scrollY-scroll)<1;
        post({phase:'returned',finished:mode==='interrupt',passed:returned,scrollY:win.scrollY});
        if(mode==='rapid'&&returned){
          var other=visibleImages().find(image=>id(image.closest('a[href]').href)!==id(link.href));
          if(!other)throw Error('no-second-visible-video');
          post({phase:'source',sourceY:rect(other).y,scrollY:win.scrollY,reopened:true});other.click();
        }
      }
      }
      win.__lfOpeningProbeGo=function(){go().catch(()=>post({phase:'failed',finished:true,passed:false}));return true;};
      post({phase:'request'});
      return;
    }
    if(win.location.pathname==='/watch'&&win.webkit.messageHandlers.langformPlayer){
      await wait(2000);
      var app=doc.querySelector('ytm-app'), proto=app, methods=[];
      for(var level=0;proto&&level<3;level++,proto=Object.getPrototypeOf(proto)){
        Object.getOwnPropertyNames(proto).forEach(function(name){
          if(/command|endpoint|service|request|dispatch|comment/i.test(name)&&typeof app[name]==='function')methods.push(name);
        });
      }
      var tags=Array.from(doc.querySelectorAll('[class*=omment],ytm-comments-entry-point-header-renderer'))
        .map(n=>n.tagName).filter((name,index,all)=>all.indexOf(name)===index).slice(0,40);
      var commentNodes=doc.querySelectorAll('ytm-comments-entry-point-header-renderer,[class*=CommentsEntryPoint]');
      var movie=doc.getElementById('movie_player'),video=movie&&movie.querySelector('video');
      post({phase:'watch',commentsPresent:commentNodes.length>0,commentsButton:!!doc.querySelector('ytm-comments-entry-point-header-renderer button'),
        loggedIn:win.ytcfg&&win.ytcfg.get('LOGGED_IN')===true,commentsCount:commentNodes.length,methods:methods,tags:tags,
        videoPainted:!!video&&video.readyState>=2&&video.currentTime>0,
        globals:Array.from(doc.querySelectorAll('[class*=CommentsEntryPoint]')).map(n=>String(n.className).split(' ')[0]).slice(0,40),
        finished:true,passed:!!video&&video.readyState>=2});
    }
  }
  doc.addEventListener('DOMContentLoaded',()=>run().catch(()=>post({phase:'failed',finished:true,passed:false})),{once:true});
})(window);
