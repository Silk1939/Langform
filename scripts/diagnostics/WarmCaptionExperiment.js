// QA only. Warm one candidate response; redirect only an EXACT matching GET.
// No caption API, preference, button or visual state is changed.
(function(win){
 'use strict';
 var info=win.__lfCaptionWarmInfo={started:false,ready:false,hit:false}, candidate='',blob='',originalOpen=XMLHttpRequest.prototype.open;
 function canonical(value){var u=new URL(value,location.href);u.searchParams.sort();return u.href;}
 XMLHttpRequest.prototype.open=function(method,value,async){
  if(blob && method==='GET' && async!==false && canonical(value)===candidate){
   info.hit=true;var consume=blob;blob='';this.addEventListener('loadend',function(){URL.revokeObjectURL(consume);},{once:true});
   var args=Array.from(arguments);args[1]=consume;return originalOpen.apply(this,args);
  }
  return originalOpen.apply(this,arguments);
 };
 var attempts=0,timer=setInterval(function(){
  if(++attempts>150){clearInterval(timer);return;}
  var root=document.getElementById('movie_player'),video=root&&root.querySelector('video');
  if(!root||typeof root.getPlayerResponse!=='function'||!video||video.readyState<2)return;
  var response=root.getPlayerResponse(),renderer=response&&response.captions&&response.captions.playerCaptionsTracklistRenderer;
  var tracks=renderer&&renderer.captionTracks;
  if(!tracks||!tracks.length)return;
  clearInterval(timer);
  var audio=renderer.audioTracks&&renderer.audioTracks[renderer.defaultAudioTrackIndex||0];
  var index=audio&&Number.isInteger(audio.defaultCaptionTrackIndex)?audio.defaultCaptionTrackIndex:0;
  var track=tracks[index];if(!track||!track.baseUrl)return;
  var url=new URL(track.baseUrl,location.href);url.searchParams.set('fmt','json3');
  if(url.origin!==location.origin||url.pathname!=='/api/timedtext')return;
  candidate=canonical(url);info.started=true;
  fetch(url.href,{credentials:'same-origin'}).then(function(response){
   if(!response.ok||/no-store/.test(response.headers.get('cache-control')||''))return null;
   return response.blob();
  }).then(function(value){if(!value)return;blob=URL.createObjectURL(value);info.ready=true;}).catch(function(){});
 },20);
 win.addEventListener('pagehide',function(){clearInterval(timer);if(blob)URL.revokeObjectURL(blob);blob='';});
})(window);
