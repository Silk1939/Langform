(function (win) {
  'use strict';
  if (!win || !win.document || win.__langformFullscreenChapters) return;
  var doc = win.document, serial = 0;
  function attribute(node,name,value) { if (node.getAttribute(name) !== value) node.setAttribute(name,value); }
  function pageID() {
    try { return win.location.pathname === '/watch' ? new URL(win.location.href).searchParams.get('v') || '' : ''; }
    catch (_) { return ''; }
  }
  function clock(value) {
    var seconds = Math.max(0, Math.floor(value)), h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  function ownedChapters(id) {
    var response = win.ytInitialPlayerResponse;
    // The producer stamps the normalized list with its video owner. A changed
    // URL, old response or unknown owner cannot reuse previous seek positions.
    if (pageID() !== id || doc.documentElement.__langformChapterVideoID !== id ||
        !response || !response.videoDetails || response.videoDetails.videoId !== id) return [];
    var items = doc.documentElement.__langformChapterList;
    if (!Array.isArray(items) || items.length < 2 || items.length > 200) return [];
    var result = [], previous = -1;
    for (var i = 0; i < items.length; i++) {
      var item = items[i], start = item && item.start, title = item && item.title;
      if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 || start <= previous ||
          typeof title !== 'string' || !title.trim()) return [];
      result.push({ start:start, title:title.trim() }); previous = start;
    }
    return result;
  }
  function mount(options) {
    options = options || {};
    var host = options.host, id = options.videoID;
    if (!host || !host.isConnected || !id) return { update:function () {}, close:function () {}, isOpen:function () { return false; } };
    var alive = true, open = false, motion = null, items = [], signature = '', durationKey = null, snapStart = null, pointer = null;
    var reduced = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)');
    var style = doc.createElement('style');
    style.textContent = `
.lf-fs-chapters { position:relative; }
#langform-fullscreen-ui .lf-fs-chapter-label { display:flex; align-items:center; gap:8px; width:auto; min-width:44px; max-width:100%; height:44px; padding:0; border-radius:8px; text-align:left; font-size:14px; font-weight:600; }
.lf-fs-chapter-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.lf-fs-chapter-chevron { flex:none; font-size:24px; line-height:1; transition:transform 160ms cubic-bezier(.16,1,.3,1); }
.lf-fs-chapter-label[aria-expanded=true] .lf-fs-chapter-chevron { transform:rotate(90deg); }
.lf-fs-chapter-panel { position:absolute; bottom:calc(100% + 6px); left:0; right:0; z-index:2; max-height:45vh; max-height:45dvh; overflow:auto; overscroll-behavior:contain; border:1px solid #ffffff18; border-radius:14px; background:#181818fa; box-shadow:0 8px 32px #0007; }
.lf-fs-chapter-header { position:sticky; top:0; z-index:1; display:flex; align-items:center; justify-content:space-between; padding:4px 8px 4px 16px; background:#181818; }
.lf-fs-chapter-header h2 { margin:0; font-size:16px; }
#langform-fullscreen-ui .lf-fs-chapter-row { display:flex; align-items:center; gap:12px; width:100%; min-height:56px; height:auto; padding:12px 16px; border-radius:0; text-align:left; font-size:14px; }
.lf-fs-chapter-row span:first-child { min-width:46px; padding:4px 6px; border-radius:4px; background:#ffffff0d; font-size:12px; font-variant-numeric:tabular-nums; color:#ccc; flex:none; }
.lf-fs-chapter-row span:last-child { overflow-wrap:anywhere; line-height:1.35; }
.lf-fs-chapter-row[aria-current=true] { background:#ffffff18; box-shadow:inset 3px 0 #f03; }
#langform-fullscreen-ui .lf-fs-chapter-row:active { transform:none; background:#ffffff25; }
.lf-fs-chapter-row:disabled { opacity:.5; }
.lf-fs-chapter-markers { position:absolute; top:calc(50% - 1.5px); left:7px; right:7px; height:3px; border-radius:2px; overflow:hidden; pointer-events:none; background:linear-gradient(to right,#f03 var(--progress),#ffffff60 var(--progress)); }
.lf-fs-chapter-markers span { position:absolute; top:0; height:100%; background:#000; transform:translateX(-50%); }
.lf-fs-chapter-panel[hidden], .lf-fs-chapter-label[hidden], .lf-fs-chapter-markers[hidden] { display:none!important; }
@media (prefers-reduced-motion:reduce) { .lf-fs-chapter-panel { animation:none; transition:none; } .lf-fs-chapter-chevron { transition:none; } }
`;
    var label = doc.createElement('button');
    label.type = 'button'; label.className = 'lf-fs-chapter-label'; label.hidden = true;
    label.setAttribute('aria-expanded', 'false');
    var labelTitle = doc.createElement('span'); labelTitle.className = 'lf-fs-chapter-title'; label.appendChild(labelTitle);
    var chevron = doc.createElement('span'); chevron.className = 'lf-fs-chapter-chevron'; chevron.textContent = ' ›'; chevron.setAttribute('aria-hidden','true'); label.appendChild(chevron);
    var panel = doc.createElement('section');
    panel.className = 'lf-fs-chapter-panel'; panel.id = 'langform-fullscreen-chapters-' + (++serial); panel.hidden = true;
    label.setAttribute('aria-controls', panel.id);
    var header = doc.createElement('header'); header.className = 'lf-fs-chapter-header';
    var heading = doc.createElement('h2'); heading.id = panel.id + '-heading'; heading.textContent = 'Kapitel';
    panel.setAttribute('aria-labelledby', heading.id);
    var dismiss = doc.createElement('button'); dismiss.type = 'button'; dismiss.textContent = '×'; dismiss.setAttribute('aria-label', 'Kapitelliste schließen');
    header.appendChild(heading); header.appendChild(dismiss);
    var list = doc.createElement('div'); list.className = 'lf-fs-chapter-list';
    panel.appendChild(header); panel.appendChild(list);
    var markers = doc.createElement('div'); markers.className = 'lf-fs-chapter-markers'; markers.hidden = true; markers.setAttribute('aria-hidden', 'true');
    host.classList.add('lf-fs-chapters');
    host.insertBefore(label, host.firstChild); host.appendChild(panel); host.appendChild(style);
    var markerHost = options.markerHost || host;
    markerHost.appendChild(markers);
    function activity() { if (typeof options.onActivity === 'function') options.onActivity(); }
    function rememberPointer(event) { var button = event.target.closest && event.target.closest('button'); pointer = button ? {button:button,until:win.performance.now() + 800} : null; activity(); }
    function clearPointer() { pointer = null; }
    function isPointer(event) { var button = event.target.closest && event.target.closest('button'); var value = event.detail > 0 || !!(pointer && pointer.button === button && win.performance.now() < pointer.until); pointer = null; return value; }
    function revealCurrent() {
      var row = list.querySelector('[aria-current=true]');
      if (!row || !panel.clientHeight) return;
      var rowBox = row.getBoundingClientRect(), panelBox = panel.getBoundingClientRect(), headerHeight = header.getBoundingClientRect().height;
      if (rowBox.top < panelBox.top + headerHeight || rowBox.bottom > panelBox.bottom) {
        panel.scrollTop = Math.max(0,Math.min(panel.scrollTop + rowBox.top - panelBox.top - headerHeight - (panel.clientHeight - headerHeight - rowBox.height) / 2,panel.scrollHeight - panel.clientHeight));
      }
    }
    function cancelMotion() {
      var previous = motion; motion = null;
      if (previous) previous.cancel();
    }
    function settleMotion() {
      cancelMotion(); panel.hidden = !open;
    }
    function reducedChanged() { if (reduced.matches) settleMotion(); }
    function setOpen(value, focus, releasePointer) {
      var next = !!value && alive && items.length >= 2 && pageID() === id;
      var changed = next !== open;
      if (next && changed && typeof options.onOpen === 'function') options.onOpen();
      open = next;
      if (panel.inert !== !open) panel.inert = !open;
      attribute(panel,'aria-hidden', String(!open));
      attribute(label,'aria-expanded', String(open));
      if (changed) {
        // Capture the visible pose before cancelling, so a new tap reverses
        // an unfinished transition from its current opacity and position.
        var pose = win.getComputedStyle(panel), wasHidden = panel.hidden;
        var from = { opacity:wasHidden ? '0' : pose.opacity || '1',
          transform:wasHidden ? 'translateY(6px)' : pose.transform || 'none' };
        cancelMotion();
        if (typeof panel.animate !== 'function' || (reduced && reduced.matches)) panel.hidden = !open;
        else {
          panel.hidden = false;
          var animation;
          try {
            animation = panel.animate([from, { opacity:open ? '1' : '0',
              transform:open ? 'translateY(0)' : 'translateY(6px)' }],
              { duration:open ? 180 : 140, easing:'cubic-bezier(0.22,1,0.36,1)', fill:'both' });
            motion = animation;
            animation.finished.then(function () {
              if (!alive || motion !== animation) return;
              panel.hidden = !open; cancelMotion();
            }, function () { /* an interrupted transition has a newer owner */ });
          } catch (_) { settleMotion(); }
        }
      }
      if (next && changed) revealCurrent();
      if (!open && releasePointer && (doc.activeElement === label || panel.contains(doc.activeElement))) doc.activeElement.blur();
      if (focus) { var target = open ? dismiss : label; if (!target.hidden && target.isConnected) target.focus({ preventScroll:true }); }
    }
    function canSeek(start) {
      var duration = Number(options.getDuration && options.getDuration());
      return pageID() === id && Number.isFinite(duration) && duration > 0 && start < duration &&
        typeof options.canSeek === 'function' && options.canSeek() === true;
    }
    function resetSnap() { snapStart = null; }
    function snap(value, width, pointer) {
      var result = { value:value, entered:false }, current = ownedChapters(id);
      var duration = Number(options.getDuration && options.getDuration());
      if (!alive || pointer !== true || !Number.isFinite(value) || !Number.isFinite(width) || width <= 0 ||
          !Number.isFinite(duration) || duration <= 0 || current.length < 2 || !canSeek(0)) {
        resetSnap(); return result;
      }
      var candidates = current.filter(function (item) { return item.start < duration; });
      if (candidates.length < 2) { resetSnap(); return result; }
      if (snapStart !== null && candidates.some(function (item) { return item.start === snapStart; }) &&
          Math.abs(value - snapStart) * width / duration <= 12) {
        // Dense chapters must remain reachable inside the held marker's release
        // band. A small margin preserves hysteresis around their midpoint.
        var heldDistance = Math.abs(value - snapStart) * width / duration;
        var other = null, otherDistance = Infinity;
        candidates.forEach(function (item) {
          var pixels = Math.abs(value - item.start) * width / duration;
          if (item.start !== snapStart && pixels <= 8 && pixels < otherDistance) { other = item.start; otherDistance = pixels; }
        });
        var margin = other === null ? 0 : Math.min(2,Math.abs(other - snapStart) * width / duration / 4);
        if (other !== null && otherDistance + margin < heldDistance) { snapStart = other; result.entered = true; }
        result.value = snapStart; return result;
      }
      resetSnap();
      var closest = null, distance = Infinity;
      candidates.forEach(function (item) {
        var pixels = Math.abs(value - item.start) * width / duration;
        if (pixels <= 8 && pixels < distance) { closest = item.start; distance = pixels; }
      });
      if (closest !== null) { snapStart = closest; result.value = closest; result.entered = true; }
      return result;
    }
    function select(event) {
      event.preventDefault(); event.stopPropagation();
      var fromPointer = isPointer(event);
      var row = event.target.closest && event.target.closest('[data-lf-fs-chapter-start]');
      if (!alive || !open || !row || !list.contains(row)) return;
      var current = ownedChapters(id), index = Number(row.getAttribute('data-lf-fs-chapter-index'));
      if (JSON.stringify(current) !== signature || !current[index] || !canSeek(current[index].start)) { update(); return; }
      if (typeof options.seek === 'function' && options.seek(current[index].start) !== false) {
        setOpen(false, !fromPointer, fromPointer); update(); activity();
      }
    }
    function toggle(event) { event.preventDefault(); event.stopPropagation(); var fromPointer = isPointer(event); update(); setOpen(!open, !fromPointer, fromPointer); activity(); }
    function dismissList(event) { event.preventDefault(); event.stopPropagation(); var fromPointer = isPointer(event); setOpen(false, !fromPointer, fromPointer); activity(); }
    function key(event) { pointer = null; if (event.key === 'Escape' && open) dismissList(event); }
    function update() {
      if (!alive) return;
      if (pageID() !== id || !host.isConnected) { close(); return; }
      var next = ownedChapters(id), nextSignature = JSON.stringify(next);
      if (nextSignature !== signature) {
        items = next; signature = nextSignature; resetSnap(); list.replaceChildren();
        items.forEach(function (item, index) {
          var row = doc.createElement('button'); row.type = 'button'; row.className = 'lf-fs-chapter-row';
          row.setAttribute('data-lf-fs-chapter-start', String(item.start)); row.setAttribute('data-lf-fs-chapter-index', String(index));
          var time = doc.createElement('span'); time.textContent = clock(item.start);
          var title = doc.createElement('span'); title.textContent = item.title;
          row.appendChild(time); row.appendChild(title); list.appendChild(row);
        });
        durationKey = null;
      }
      if (label.hidden !== (items.length < 2)) label.hidden = items.length < 2;
      if (label.hidden) setOpen(false, false);
      var duration = Number(options.getDuration && options.getDuration());
      var knownDuration = Number.isFinite(duration) && duration > 0;
      if (durationKey !== duration) {
        durationKey = duration; markers.replaceChildren();
        if (knownDuration) items.forEach(function (item,index) {
          if (item.start <= 0 || item.start >= duration) return;
          var previous = index > 0 ? items[index - 1].start : 0, next = index + 1 < items.length ? Math.min(duration,items[index + 1].start) : duration;
          var tick = doc.createElement('span'); tick.style.left = (item.start / duration * 100) + '%';
          // Keep short chapters visible instead of letting a fixed gap eat them.
          tick.style.width = 'min(3px,' + (Math.min(item.start - previous,next - item.start) / duration * 35) + '%)'; markers.appendChild(tick);
        });
      }
      var hideMarkers = !knownDuration || label.hidden || !markers.childElementCount;
      if (markers.hidden !== hideMarkers) markers.hidden = hideMarkers;
      if (markerHost.hasAttribute('data-lf-fs-segmented') === hideMarkers) markerHost.toggleAttribute('data-lf-fs-segmented',!hideMarkers);
      var time = Number(options.getTime && options.getTime()), currentIndex = -1;
      if (Number.isFinite(time)) items.forEach(function (item, index) { if (item.start <= time) currentIndex = index; });
      var title = currentIndex >= 0 ? items[currentIndex].title : 'Kapitel';
      if (labelTitle.textContent !== title) labelTitle.textContent = title;
      attribute(label,'aria-label', currentIndex >= 0 ? 'Kapitel: ' + items[currentIndex].title : 'Kapitel anzeigen');
      // One player-identity/readiness check per update. A row click still
      // validates its current owner and seek range immediately before seeking.
      var enabled = knownDuration && typeof options.canSeek === 'function' && options.canSeek() === true;
      Array.from(list.children).forEach(function (row, index) {
        if (index === currentIndex) attribute(row,'aria-current', 'true'); else if (row.hasAttribute('aria-current')) row.removeAttribute('aria-current');
        var disabled = !enabled || items[index].start >= duration;
        if (row.disabled !== disabled) row.disabled = disabled;
      });
    }
    function close() {
      if (!alive) return;
      alive = false; open = false; pointer = null; resetSnap(); cancelMotion();
      if (reduced && reduced.removeEventListener) reduced.removeEventListener('change', reducedChanged);
      label.removeEventListener('click', toggle); dismiss.removeEventListener('click', dismissList);
      list.removeEventListener('click', select); panel.removeEventListener('keydown', key); label.removeEventListener('keydown',key); panel.removeEventListener('pointerdown', rememberPointer); label.removeEventListener('pointerdown',rememberPointer); win.removeEventListener('pointercancel',clearPointer);
      win.removeEventListener('pagehide', close); win.removeEventListener('popstate', update);
      win.removeEventListener('state-navigateend', update); doc.removeEventListener('yt-navigate-finish', update);
      markerHost.removeAttribute('data-lf-fs-segmented');
      [label,panel,markers,style].forEach(function (node) { node.remove(); }); items = [];
    }
    label.addEventListener('click', toggle); dismiss.addEventListener('click', dismissList);
    list.addEventListener('click', select); panel.addEventListener('keydown', key); label.addEventListener('keydown',key); panel.addEventListener('pointerdown', rememberPointer); label.addEventListener('pointerdown',rememberPointer); win.addEventListener('pointercancel',clearPointer);
    win.addEventListener('pagehide', close); win.addEventListener('popstate', update);
    win.addEventListener('state-navigateend', update); doc.addEventListener('yt-navigate-finish', update);
    if (reduced && reduced.addEventListener) reduced.addEventListener('change', reducedChanged);
    update();
    return { update:update, close:close, dismiss:function () { pointer = null; setOpen(false,false); settleMotion(); }, snap:snap, resetSnap:resetSnap, isOpen:function () { return alive && open; } };
  }
  win.__langformFullscreenChapters = { mount:mount };
})(window);
