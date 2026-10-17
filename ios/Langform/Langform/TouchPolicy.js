// App-only WebKit touch policy. Text entry keeps the editing tools required by
// search/comments; the page chrome and media never start a selection or callout.
(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformTouchPolicy) return;
  win.__langformTouchPolicy = true;
  var doc = win.document, active = true;
  var editing = 'textarea,input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="tel"],input[type="password"],input[type="number"],[contenteditable]:not([contenteditable="false"])';
  function install() {
    if (doc.getElementById('langform-touch-policy') || !doc.documentElement) return;
    var style = doc.createElement('style'); style.id = 'langform-touch-policy';
    style.textContent = 'html,body,body *{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}' +
      editing.split(',').map(function (selector) { return selector + ',' + selector + ' *'; }).join(',') + '{-webkit-user-select:text!important;user-select:text!important;-webkit-touch-callout:default!important}' +
      '[contenteditable="false"],[contenteditable="false"] *{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}';
    (doc.head || doc.documentElement).appendChild(style);
  }
  function editable(target) {
    var node = target && (target.nodeType === 1 ? target : target.parentElement);
    if (!node || !node.closest) return false;
    // An explicitly noneditable nested island is page chrome again.
    var boundary = node.closest('[contenteditable]');
    if (boundary && boundary.getAttribute('contenteditable') === 'false') return false;
    return !!node.closest(editing);
  }
  function suppress(event) {
    if (!active || editable(event.target)) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  }
  install();
  doc.addEventListener('DOMContentLoaded',install,{once:true});
  ['contextmenu','selectstart'].forEach(function (name) { win.addEventListener(name,suppress,true); });
  win.addEventListener('pagehide',function () { active = false; });
  win.addEventListener('pageshow',function () { active = true; install(); });
})(window);
