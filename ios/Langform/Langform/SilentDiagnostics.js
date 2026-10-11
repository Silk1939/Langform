// Injected only for explicit diagnostic launches, before YouTube's scripts.
// Media tests must be quiet even if YouTube restores a previous volume choice.
(function (win) {
  'use strict';
  if (!win || !win.document || !win.HTMLMediaElement || win.__langformSilentDiagnostics) return;
  win.__langformSilentDiagnostics = true;
  // YouTube stores its volume choice in both session and local storage. A
  // website listener can turn our enforced mute into that persistent choice.
  // Keep this one preference untouched during diagnostics; other storage
  // operations retain their native behavior and normal launches omit this file.
  var storage = win.Storage && win.Storage.prototype;
  if (storage && storage.setItem && storage.getItem) {
    var setItem = storage.setItem, getItem = storage.getItem;
    storage.setItem = function (key) {
      if (key === 'yt-player-volume' && arguments.length >= 2) {
        getItem.call(this,key); // Keep the native Storage receiver check.
        return;
      }
      return setItem.apply(this,arguments);
    };
  }
  var media = win.HTMLMediaElement.prototype;
  var muted = Object.getOwnPropertyDescriptor(media,'muted');
  var volume = Object.getOwnPropertyDescriptor(media,'volume');
  function quiet(node) {
    if (!(node instanceof win.HTMLMediaElement)) return;
    if (muted && muted.set) muted.set.call(node,true);
    if (volume && volume.set) volume.set.call(node,0);
    node.defaultMuted = true;
  }
  if (muted && muted.configurable && muted.set) {
    Object.defineProperty(media,'muted',Object.assign({},muted,{set:function () { muted.set.call(this,true); }}));
  }
  if (volume && volume.configurable && volume.set) {
    Object.defineProperty(media,'volume',Object.assign({},volume,{set:function () { volume.set.call(this,0); }}));
  }
  var play = media.play;
  media.play = function () { quiet(this); return play.apply(this,arguments); };
  var create = win.document.createElement;
  win.document.createElement = function () {
    var node = create.apply(this,arguments); quiet(node); return node;
  };
  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    quiet(node);
    node.querySelectorAll('video,audio').forEach(quiet);
  }
  var observer = new win.MutationObserver(function (records) {
    records.forEach(function (record) { record.addedNodes.forEach(scan); });
  });
  observer.observe(win.document,{childList:true,subtree:true});
  ['loadstart','loadedmetadata','play','playing','volumechange'].forEach(function (name) {
    win.document.addEventListener(name,function (event) { quiet(event.target); },true);
  });
  scan(win.document.documentElement);
  win.addEventListener('pagehide',function () { observer.disconnect(); });
  win.addEventListener('pageshow',function () {
    observer.observe(win.document,{childList:true,subtree:true}); scan(win.document.documentElement);
  });
})(typeof window !== 'undefined' ? window : this);
