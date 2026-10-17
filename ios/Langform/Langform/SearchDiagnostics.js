// Explicit local QA only: structural control classes and fixed label categories,
// never query text, element text, hrefs, account names, or arbitrary attributes.
(function (win) {
  'use strict';
  var bridge = win.webkit && win.webkit.messageHandlers && win.webkit.messageHandlers.langformNativeSearch;
  if (!bridge || win.__langformSearchDiagnostics) return;
  win.__langformSearchDiagnostics = true;
  var count = 0;
  function report(event) {
    if (count >= 12) return;
    var path = event && event.composedPath ? event.composedPath() : [];
    var nodes = path.filter(function(n){return n && n.nodeType===1;}).slice(0,7);
    var structure = nodes.map(function(n){
      var classes = String(n.getAttribute('class') || '').split(/\s+/).filter(function(c){return /(?:yt|search|button|topbar)/i.test(c) && /^[a-zA-Z0-9_-]{1,72}$/.test(c);}).slice(0,3);
      var label = n.getAttribute('aria-label') || n.getAttribute('title') || '';
      return n.tagName.toLowerCase()+'.'+classes.join('.')+':'+(['Suchen','Search','Bei YouTube suchen','In YouTube suchen'].indexOf(label)>=0?label:'other');
    }).join(' > ');
    bridge.postMessage({action:'probe',kind:event?event.type:'ready',structure:structure,
      initialized:typeof win.__langformOpenSearch==='function',links:!!win.__langformLinks,
      active:win.__langformFeedActive===true,prevented:!!(event&&event.defaultPrevented)});
    count++;
  }
  ['pointerdown','touchstart','pointerup','touchend','click'].forEach(function(name){win.addEventListener(name,report,true);});
  win.addEventListener('error',function(e){
    if(count>=12)return;count++;
    var type=e.error && e.error.constructor && e.error.constructor.name;
    bridge.postMessage({action:'probe',kind:'error',errorLine:Number(e.lineno)||0,
      errorType:['TypeError','ReferenceError','SyntaxError','RangeError'].indexOf(type)>=0?type:'unknown',
      initialized:typeof win.__langformOpenSearch==='function',links:!!win.__langformLinks,active:win.__langformFeedActive===true});
  },true);
  win.document.addEventListener('DOMContentLoaded',function(){report();},{once:true});
})(window);
