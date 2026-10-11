// Watch actions stay in the document flow, outside the video and its controls.
(function (win) {
  'use strict';
  var doc = win && win.document;
  var bridge = win && win.webkit && win.webkit.messageHandlers && win.webkit.messageHandlers.langformDownloads;
  if (!doc || !bridge || win.__langformWatchTools) return;
  win.__langformWatchTools = true;
  var row, download, sponsor, status, undo, retry, timer, observer, mutationTimer, attempt = 0;
  var delays = [100, 400, 1000, 2000, 4000];
  function videoID() {
    try {
      var url = new URL(win.location.href);
      var id = url.searchParams.get('v') || '';
      return url.protocol === 'https:' && /^(m\.|www\.)?youtube\.com$/.test(url.hostname)
        && /^\/watch\/?$/.test(url.pathname) && /^[\w-]{11}$/.test(id) ? id : '';
    } catch (_) { return ''; }
  }
  function render() {
    if (!row) return;
    var busy = win.__langformDownloadLoading === true;
    download.disabled = busy;
    download.textContent = busy ? 'Quelle wird geprüft…' : 'Downloads';
    download.setAttribute('aria-busy', String(busy));
    var api = win.__langformSponsorBlock;
    var state = api && api.getStatus();
    sponsor.disabled = !api;
    sponsor.setAttribute('aria-pressed', String(!!(state && state.enabled)));
    sponsor.textContent = 'SponsorBlock: ' + (state && state.enabled ? 'an' : 'aus');
    var labels = { off: '', loading: 'Sponsorsegmente werden geladen…', ready: 'Sponsorsegmente werden automatisch übersprungen.',
      empty: 'Für dieses Video sind keine Sponsorsegmente gemeldet.', unavailable: 'SponsorBlock ist gerade nicht erreichbar.' };
    status.textContent = state ? labels[state.status] || '' : '';
    undo.hidden = !(state && state.canUndo);
    retry.hidden = !(state && state.enabled && state.status === 'unavailable');
  }
  win.__langformSetDownloadLoading = function (busy) { win.__langformDownloadLoading = busy === true; render(); };
  function button(label, action) {
    var node = doc.createElement('button');
    node.type = 'button'; node.textContent = label;
    node.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); action(); });
    return node;
  }
  function create() {
    if (!doc.getElementById('langform-watch-tools-style')) {
      var style = doc.createElement('style'); style.id = 'langform-watch-tools-style';
      style.textContent = '#langform-watch-tools{display:block;box-sizing:border-box;padding:8px 12px;color:inherit;font:14px/1.4 -apple-system,BlinkMacSystemFont,Roboto,sans-serif}'
        + '#langform-watch-tools .lf-watch-actions{display:flex;flex-wrap:wrap;gap:8px}'
        + '#langform-watch-tools button{min-height:44px;padding:8px 14px;border:0;border-radius:22px;background:var(--yt-spec-badge-chip-background,rgba(128,128,128,.16));color:inherit;font:500 14px -apple-system,BlinkMacSystemFont,Roboto,sans-serif;cursor:pointer}'
        + '#langform-watch-tools button:disabled{opacity:.6;cursor:default}#langform-watch-tools [hidden]{display:none}'
        + '#langform-watch-tools .lf-watch-status:empty{display:none}#langform-watch-tools .lf-watch-status{margin:8px 0 0;font-size:13px}'
        + '#langform-watch-tools details{margin-top:6px;font-size:12px}#langform-watch-tools summary{min-height:32px;display:flex;align-items:center;cursor:pointer}'
        + '#langform-watch-tools a{color:inherit;text-decoration:underline}';
      (doc.head || doc.documentElement).appendChild(style);
    }
    row = doc.createElement('section'); row.id = 'langform-watch-tools'; row.setAttribute('aria-label', 'Langform Videoaktionen');
    var actions = doc.createElement('div'); actions.className = 'lf-watch-actions';
    download = button('Downloads', function () {
      var id = videoID(); if (!id || win.__langformDownloadLoading) return;
      win.__langformSetDownloadLoading(true);
      bridge.postMessage({ kind: 'open', videoID: id });
    });
    download.setAttribute('aria-label', 'Downloads öffnen');
    sponsor = button('SponsorBlock: aus', function () {
      var api = win.__langformSponsorBlock; if (api) api.setEnabled(!api.getStatus().enabled);
    });
    sponsor.setAttribute('aria-label', 'SponsorBlock umschalten');
    undo = button('Überspringen rückgängig', function () { var api = win.__langformSponsorBlock; if (api) api.undo(); });
    retry = button('SponsorBlock erneut laden', function () { var api = win.__langformSponsorBlock; if (api) api.retry(); });
    [download, sponsor, undo, retry].forEach(function (node) { actions.appendChild(node); });
    row.appendChild(actions);
    status = doc.createElement('p'); status.className = 'lf-watch-status'; status.setAttribute('role', 'status'); row.appendChild(status);
    var info = doc.createElement('details');
    var summary = doc.createElement('summary'); summary.textContent = 'Über SponsorBlock'; info.appendChild(summary);
    var text = doc.createElement('p');
    text.appendChild(doc.createTextNode('Community-Markierungen von '));
    var link = doc.createElement('a'); link.href = 'https://sponsor.ajay.app/'; link.textContent = 'SponsorBlock / Ajay Ramachandran';
    link.target = '_blank'; link.rel = 'noopener noreferrer'; text.appendChild(link);
    text.appendChild(doc.createTextNode('. Bei Aktivierung wird ein kurzer Hash der Video-ID gesendet, keine Kontodaten. Nur gemeldete Sponsorsegmente werden übersprungen. Daten: '));
    var license = doc.createElement('a'); license.href = 'https://creativecommons.org/licenses/by-nc-sa/4.0/';
    license.textContent = 'CC BY-NC-SA 4.0'; license.target = '_blank'; license.rel = 'noopener noreferrer';
    text.appendChild(license); text.appendChild(doc.createTextNode('.'));
    info.appendChild(text); row.appendChild(info); render();
  }
  function mount() {
    if (!videoID()) { if (row) row.remove(); return false; }
    var metadata = doc.querySelector('ytm-slim-video-metadata-section-renderer, ytd-watch-metadata, #above-the-fold');
    if (!metadata || metadata.closest('#movie_player, ytm-player, ytd-player')) return false;
    if (!row) create();
    if (row.parentElement !== metadata) metadata.appendChild(row);
    render(); return true;
  }
  function check() {
    timer = null;
    observeHydration();
    if (!mount() && attempt < delays.length) timer = win.setTimeout(check, delays[attempt++]);
  }
  function observeHydration() {
    if (observer || !doc.documentElement || typeof win.MutationObserver !== 'function') return;
    observer = new win.MutationObserver(function () {
      // Once connected, all unrelated DOM changes cost this single check.
      // Hydration can replace/remove our renderer after navigation completes.
      if ((row && row.isConnected) || mutationTimer != null || !videoID()) return;
      mutationTimer = win.setTimeout(function () { mutationTimer = null; mount(); }, 0);
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  }
  function navigate() {
    if (timer != null) win.clearTimeout(timer);
    win.__langformDownloadLoading = false;
    attempt = 0; check();
  }
  win.addEventListener('yt-navigate-finish', navigate);
  win.addEventListener('popstate', navigate);
  win.addEventListener('langform-sponsorblock-state', render);
  win.addEventListener('pagehide', function () {
    if (timer != null) win.clearTimeout(timer);
    if (mutationTimer != null) win.clearTimeout(mutationTimer);
    mutationTimer = null;
    if (observer) observer.disconnect();
    observer = null;
  });
  win.addEventListener('pageshow', check);
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', check, { once: true });
  else check();
})(typeof window !== 'undefined' ? window : null);
