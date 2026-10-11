// Feed-only navigation. YouTube still owns the header, account and destinations.
(function (win) {
  if (!win || !win.document || win.__langformDiscovery) return;
  var handlers = win.webkit && win.webkit.messageHandlers;
  if (!handlers || !handlers.langformOpenWatch || handlers.langformPlayer) return;
  if (win.location.hostname !== "m.youtube.com") return;
  win.__langformDiscovery = true;

  var doc = win.document;
  var bar = null;
  var sheet = null;
  var sheetMotion = null;
  var trigger = null;
  var timer = null;
  var attempts = 0;
  var retryDelays = [100, 400, 1000, 2000];
  var dirty = true;
  var reducedMotion = win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)");
  var icons = {
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/>',
    music: '<path d="M9 18V5l10-2v13M9 8l10-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="16" cy="16" rx="3" ry="2"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    live: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
    gaming: '<path d="M7 7h10c3 0 4 4 4 9 0 3-3 3-5 0H8c-2 3-5 3-5 0 0-5 1-9 4-9Z M7 10v5M4.5 12.5h5M16 11h.1M18 14h.1"/>',
    news: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h4M7 16h4M15 12h2M15 16h2"/>',
    sport: '<circle cx="12" cy="12" r="9"/><path d="m12 7 5 4-2 6H9l-2-6ZM12 7V3M17 11l4-2M15 17l2 3M9 17l-2 3M7 11 3 9"/>',
    learn: '<path d="M9 18h6M10 21h4M8 15a7 7 0 1 1 8 0l-1 3H9Z"/>',
    podcast: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
    bell: '<path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5ZM10 21h4"/>',
  };

  // Verified against the mobile site's real browse responses, 2026-10-08.
  // /feed/explore and /feed/playlists are not reliable mobile destinations.
  var topics = [
    ["Musik", "/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ", "music"],
    ["Filme & Shows", "/feed/storefront", "film"],
    ["Live", "/live", "live"],
    ["Gaming", "/gaming", "gaming"],
    ["Nachrichten", "/channel/UCYfdidRxbB8Qhf0Nx7ioOYw", "news"],
    ["Sport", "/channel/UCEgdi0XIXXZ-qJOFPf4JSKw", "sport"],
    ["Wissen", "/channel/UCtFRv9O2AHqOZjjynzrv-xg", "learn"],
    ["Podcasts", "/podcasts", "podcast"],
  ];

  function icon(name) {
    return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + icons[name] + '</svg>';
  }

  function active() { return win.__langformFeedActive !== false; }
  function feedRoot() { return /^(?:\/|\/feed\/(?:subscriptions|library|you))$/.test(win.location.pathname); }
  function cancelRetry() {
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
  }

  function stopSheetMotion() {
    if (!sheetMotion) return;
    var motion = sheetMotion;
    sheetMotion = null;
    motion.animations.forEach(function (animation) {
      animation.onfinish = null;
      animation.cancel();
    });
  }

  function finishClose() {
    stopSheetMotion();
    if (sheet && sheet.open) sheet.close();
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    reportOverlay(false);
  }

  function moveSheet(opening) {
    var panel = sheet.querySelector(".lf-discovery-panel");
    var backdrop = sheet.querySelector(".lf-discovery-backdrop");
    // Move one solid surface from its actual edge. Fading the whole panel makes
    // its readable text wash out and reveals a large sheet after only 36 px.
    var panelFrom = { transform: opening ? "translateY(calc(100% + 2px))" : "translateY(0)" };
    var backdropFrom = { opacity: opening ? 0 : 1 };
    // Sample only an interrupted transition. Normal opening and all scrolling
    // need no layout reads; rapid reversal continues from the displayed pose.
    if (sheetMotion) {
      var panelStyle = win.getComputedStyle(panel);
      panelFrom = { transform: panelStyle.transform };
      backdropFrom = { opacity: win.getComputedStyle(backdrop).opacity };
    }
    stopSheetMotion();
    if ((reducedMotion && reducedMotion.matches) || typeof panel.animate !== "function") {
      if (!opening) finishClose();
      return;
    }
    var timing = {
      duration: opening ? 300 : 180,
      easing: opening ? "cubic-bezier(0.16, 1, 0.3, 1)" : "cubic-bezier(0.7, 0, 0.84, 0)",
      fill: "both",
    };
    var motion = { opening: opening, animations: [] };
    sheetMotion = motion;
    try {
      motion.animations.push(panel.animate([panelFrom, { transform: opening ? "translateY(0)" : "translateY(calc(100% + 2px))" }], timing));
      motion.animations.push(backdrop.animate([backdropFrom, { opacity: opening ? 1 : 0 }], timing));
    } catch (err) {
      stopSheetMotion();
      if (!opening) finishClose();
      return;
    }
    motion.animations[0].onfinish = function () {
      if (sheetMotion !== motion) return;
      if (opening) stopSheetMotion();
      else finishClose();
    };
  }

  function closeSheet(immediate) {
    if (immediate === true || !sheet || !sheet.open) { finishClose(); return; }
    if (sheetMotion && !sheetMotion.opening) return;
    // Keep modal input ownership until the panel has left the screen.
    moveSheet(false);
  }

  function settleSheetMotion() {
    if (!sheetMotion) return;
    if (sheetMotion.opening) stopSheetMotion();
    else finishClose();
  }

  function reportOverlay(open) {
    if (typeof win.__langformSetOverlayState === "function") {
      win.__langformSetOverlayState("discovery", open);
    }
  }

  function ensureStyle() {
    if (doc.getElementById("langform-discovery-style")) return;
    var style = doc.createElement("style");
    style.id = "langform-discovery-style";
    // Only the inner panel scrolls. Unlike overflow:hidden, clip prevents
    // dialog autofocus from scrolling the outer viewport during translation.
    style.textContent = `
      #langform-discovery { display:flex; align-items:center; gap:8px; padding:6px 12px; box-sizing:border-box; background:var(--yt-spec-base-background,#0f0f0f); color:var(--yt-spec-text-primary,#f1f1f1); }
      #langform-discovery button { display:flex; align-items:center; gap:9px; min-height:44px; padding:0 14px; border:0; border-radius:22px; background:var(--yt-spec-badge-chip-background,rgba(128,128,128,.16)); color:inherit; font:500 15px -apple-system,BlinkMacSystemFont,Roboto,sans-serif; cursor:pointer; }
      #langform-discovery svg, #langform-discovery-sheet svg { width:23px; height:23px; flex-shrink:0; }
      #langform-discovery-sheet { box-sizing:border-box; position:fixed; inset:0; margin:0; width:100%; height:100%; max-width:none; max-height:none; padding:0; border:0; overflow:clip; background:transparent; color:var(--yt-spec-text-primary,#f1f1f1); font:15px/1.4 -apple-system,BlinkMacSystemFont,Roboto,sans-serif; }
      #langform-discovery-sheet::backdrop { background:transparent; }
      #langform-discovery-sheet .lf-discovery-backdrop { position:absolute; inset:0; background:rgba(0,0,0,.55); }
      #langform-discovery-sheet .lf-discovery-panel { box-sizing:border-box; position:absolute; inset:auto 0 0; margin:0 auto; width:100%; max-width:560px; max-height:85dvh; overflow:auto; overscroll-behavior:contain; border-radius:22px 22px 0 0; background:var(--yt-spec-base-background,#0f0f0f); }
      #langform-discovery-sheet .lf-discovery-head { display:flex; align-items:center; justify-content:space-between; padding:10px 12px 6px 20px; }
      #langform-discovery-sheet h2 { margin:0; font-size:20px; font-weight:650; }
      #langform-discovery-sheet h3 { margin:20px 4px 8px; font-size:14px; color:var(--yt-spec-text-secondary,#aaa); font-weight:500; }
      #langform-discovery-sheet button, #langform-discovery-sheet a { box-sizing:border-box; color:inherit; font:inherit; text-decoration:none; cursor:pointer; }
      #langform-discovery-sheet .lf-discovery-close { width:44px; height:44px; border:0; border-radius:50%; background:transparent; font-size:27px; }
      #langform-discovery-sheet .lf-discovery-content { padding:0 16px calc(20px + env(safe-area-inset-bottom)); }
      #langform-discovery-sheet .lf-discovery-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
      #langform-discovery-sheet[open] .lf-discovery-grid svg { animation:lf-discovery-icon-in 220ms cubic-bezier(.16,1,.3,1) backwards; animation-delay:calc(var(--lf-order,0) * 18ms); }
      #langform-discovery-sheet .lf-discovery-grid a:nth-child(2) { --lf-order:1; }
      #langform-discovery-sheet .lf-discovery-grid a:nth-child(3) { --lf-order:2; }
      #langform-discovery-sheet .lf-discovery-grid a:nth-child(4) { --lf-order:3; }
      #langform-discovery-sheet .lf-discovery-grid a:nth-child(5) { --lf-order:4; }
      #langform-discovery-sheet .lf-discovery-grid a:nth-child(6) { --lf-order:5; }
      #langform-discovery-sheet .lf-discovery-grid a:nth-child(7) { --lf-order:6; }
      #langform-discovery-sheet .lf-discovery-grid a:nth-child(8) { --lf-order:7; }
      @keyframes lf-discovery-icon-in { from { opacity:.35; transform:translateY(10px) scale(.85); } to { opacity:1; transform:none; } }
      #langform-discovery-sheet .lf-discovery-link, #langform-discovery-sheet .lf-discovery-notifications { display:flex; align-items:center; gap:12px; min-height:48px; padding:10px 12px; border:0; border-radius:12px; background:var(--yt-spec-badge-chip-background,rgba(128,128,128,.12)); text-align:left; }
      #langform-discovery-sheet .lf-discovery-list { display:grid; gap:6px; }
      #langform-discovery-sheet .lf-discovery-list a { display:block; min-height:44px; padding:11px 12px; border-radius:10px; }
      #langform-discovery-sheet small { display:block; color:var(--yt-spec-text-secondary,#aaa); font-size:12px; }
      #langform-discovery-sheet .lf-discovery-note { margin:10px 4px; color:var(--yt-spec-text-secondary,#aaa); font-size:13px; }
      #langform-discovery-sheet .lf-discovery-notifications { width:100%; margin:8px 0 16px; }
      #langform-discovery-sheet a:active, #langform-discovery-sheet button:active { background:rgba(128,128,128,.24); }
      #langform-discovery button, #langform-discovery-sheet a, #langform-discovery-sheet button { -webkit-tap-highlight-color:transparent; transition:transform 180ms cubic-bezier(.16,1,.3,1), background-color 100ms ease-out; }
      #langform-discovery button:active, #langform-discovery-sheet a:active, #langform-discovery-sheet button:active { transform:scale(.985); transition-duration:100ms; }
      #langform-discovery button:focus-visible, #langform-discovery-sheet :focus-visible { outline:2px solid #3ea6ff; outline-offset:2px; }
      @media (prefers-reduced-motion:reduce) { #langform-discovery button, #langform-discovery-sheet a, #langform-discovery-sheet button { transition:none; } #langform-discovery button:active, #langform-discovery-sheet a:active, #langform-discovery-sheet button:active { transform:none; } #langform-discovery-sheet[open] .lf-discovery-grid svg { animation:none; } }
    `;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function heading(parent, text) {
    var title = doc.createElement("h3");
    title.textContent = text;
    parent.appendChild(title);
  }

  function addLink(parent, label, path, iconName, note) {
    var link = doc.createElement("a");
    link.className = "lf-discovery-link";
    link.href = new URL(path, "https://m.youtube.com/").href;
    if (iconName) link.innerHTML = icon(iconName);
    var text = doc.createElement("span");
    text.textContent = label;
    if (note) {
      var detail = doc.createElement("small");
      detail.textContent = note;
      text.appendChild(detail);
    }
    link.appendChild(text);
    link.addEventListener("click", function (event) {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      closeSheet(true);
      // The library is an existing retained native tab. Ordinary destinations
      // stay normal links, preserving browser history and YouTube's own pages.
      if (path === "/feed/library" && handlers.langformNavigateFeed) {
        try {
          handlers.langformNavigateFeed.postMessage({ href: link.href });
          event.preventDefault();
        } catch (_) { /* A real anchor remains usable without the bridge. */ }
      }
    });
    parent.appendChild(link);
  }

  function notificationButton() {
    var header = doc.querySelector("ytm-header, ytm-mobile-topbar-renderer");
    if (!header) return null;
    var controls = header.querySelectorAll("button[aria-label], [role='button'][aria-label]");
    for (var i = 0; i < controls.length; i++) {
      var control = controls[i];
      if (!/^(?:Benachrichtigungen|Notifications)(?:$|[\s,(.:])/i.test(control.getAttribute("aria-label") || "")) continue;
      if (control.disabled || control.closest("[hidden], [aria-hidden='true']")) continue;
      if (!control.getClientRects().length) continue;
      var style = win.getComputedStyle(control);
      if (style.display !== "none" && style.visibility !== "hidden") return control;
    }
    return null;
  }

  function openSheet() {
    if (!active() || !feedRoot()) return;
    if (sheet && sheet.open) {
      if (sheetMotion && !sheetMotion.opening) moveSheet(true);
      return;
    }
    stopSheetMotion();
    if (sheet) sheet.remove();
    sheet = doc.createElement("dialog");
    sheet.id = "langform-discovery-sheet";
    sheet.setAttribute("aria-labelledby", "langform-discovery-title");
    sheet.innerHTML = '<div class="lf-discovery-backdrop" aria-hidden="true"></div><div class="lf-discovery-panel"><div class="lf-discovery-head"><h2 id="langform-discovery-title">Entdecken</h2><button type="button" class="lf-discovery-close" aria-label="Menü schließen">×</button></div><div class="lf-discovery-content"></div></div>';
    sheet.querySelector("button").addEventListener("click", closeSheet);
    sheet.addEventListener("close", function (event) {
      if (event.target === sheet && !sheet.open) {
        stopSheetMotion();
        if (trigger) trigger.setAttribute("aria-expanded", "false");
        reportOverlay(false);
      }
    });
    sheet.addEventListener("cancel", function (event) { event.preventDefault(); closeSheet(); });
    sheet.addEventListener("click", function (event) {
      if (event.target === sheet || event.target.classList.contains("lf-discovery-backdrop")) closeSheet();
    });
    var content = sheet.querySelector(".lf-discovery-content");
    var notifications = notificationButton();
    if (notifications) {
      var button = doc.createElement("button");
      button.type = "button";
      button.className = "lf-discovery-notifications";
      button.innerHTML = icon("bell") + "<span>Benachrichtigungen</span>";
      button.addEventListener("click", function () {
        closeSheet(true);
        if (notifications.isConnected) notifications.click();
      });
      content.appendChild(button);
    } else {
      var unavailable = doc.createElement("p");
      unavailable.className = "lf-discovery-note";
      unavailable.textContent = "Benachrichtigungen bietet YouTube auf dieser Seite nicht an.";
      content.appendChild(unavailable);
    }
    var grid = doc.createElement("div");
    grid.className = "lf-discovery-grid";
    topics.forEach(function (item) { addLink(grid, item[0], item[1], item[2]); });
    content.appendChild(grid);
    heading(content, "Dein YouTube");
    var account = doc.createElement("div");
    account.className = "lf-discovery-list";
    addLink(account, "Playlists & Mediathek", "/feed/library", null, "In deinem YouTube-Konto");
    addLink(account, "Käufe & Mitgliedschaften", "/paid_memberships", null, "Anmeldung bei YouTube erforderlich");
    content.appendChild(account);
    heading(content, "Apps & Dienste · offizielle Websites");
    var services = doc.createElement("div");
    services.className = "lf-discovery-list";
    [
      ["YouTube Studio", "https://studio.youtube.com/"],
      ["YouTube Music", "https://music.youtube.com/"],
      ["YouTube Kids", "https://www.youtubekids.com/"],
      ["YouTube Create", "https://www.youtube.com/creators/youtube-create/"],
    ].forEach(function (item) { addLink(services, item[0], item[1]); });
    content.appendChild(services);
    heading(content, "Info & Recht");
    var info = doc.createElement("div");
    info.className = "lf-discovery-list";
    [
      ["Über YouTube", "https://about.youtube/"],
      ["Wie funktioniert YouTube?", "https://www.youtube.com/howyoutubeworks/"],
      ["Hilfe", "https://support.google.com/youtube/?hl=de"],
      ["Impressum", "https://www.youtube.com/t/impressum?hl=de"],
      ["Nutzungsbedingungen", "https://www.youtube.com/t/terms"],
      ["Datenschutz", "https://policies.google.com/privacy?hl=de"],
    ].forEach(function (item) { addLink(info, item[0], item[1]); });
    content.appendChild(info);
    doc.body.appendChild(sheet);
    sheet.showModal();
    trigger.setAttribute("aria-expanded", "true");
    reportOverlay(true);
    moveSheet(true);
  }

  function mount() {
    if (!active() || !feedRoot()) return false;
    var app = doc.querySelector("ytm-app");
    if (!app) return false;
    var browse = null;
    var header = null;
    for (var i = 0; i < app.children.length; i++) {
      var child = app.children[i];
      if (child.tagName === "YTM-BROWSE") browse = child;
      if (child.tagName === "YTM-HEADER" || child.tagName === "YTM-MOBILE-TOPBAR-RENDERER") header = child;
    }
    if (!browse || !header || typeof win.HTMLDialogElement === "undefined" ||
        typeof win.HTMLDialogElement.prototype.showModal !== "function") return false;
    // Wait for the real feed before choosing a slot. YouTube's fixed chip bar
    // has a spacer in the rich grid; our row must follow that spacer or those
    // chips would cover it. Other feeds already flow below the top header.
    if (browse.querySelector(".ghost-ytm-rich-grid-renderer")) return false;
    var chipSpacer = browse.querySelector(".rich-grid-sticky-header");
    ensureStyle();
    if (!bar) {
      bar = doc.createElement("nav");
      bar.id = "langform-discovery";
      bar.setAttribute("aria-label", "Themen entdecken");
      trigger = doc.createElement("button");
      trigger.type = "button";
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.setAttribute("aria-expanded", "false");
      trigger.innerHTML = icon("compass") + "<span>Entdecken</span>";
      trigger.addEventListener("click", openSheet);
      bar.appendChild(trigger);
      if (handlers.langformDownloads) {
        var downloads = doc.createElement("button");
        downloads.type = "button";
        downloads.textContent = "Downloads";
        downloads.setAttribute("aria-label", "Downloads öffnen");
        downloads.addEventListener("click", function () {
          if (!active()) return;
          handlers.langformDownloads.postMessage({ kind: "open" });
        });
        bar.appendChild(downloads);
      }
    }
    if (chipSpacer) {
      if (chipSpacer.nextElementSibling !== bar) chipSpacer.parentNode.insertBefore(bar, chipSpacer.nextSibling);
    } else if (browse.previousElementSibling !== bar) {
      app.insertBefore(bar, browse);
    }
    dirty = false;
    return true;
  }

  function attemptMount() {
    timer = null;
    if (!active()) { dirty = true; return; }
    if (!feedRoot()) return;
    mount();
    // Also check initial hydration for a short, fixed window. No observer,
    // scrolling work, network fetches or polling after these four retries.
    if (attempts < retryDelays.length) timer = win.setTimeout(attemptMount, retryDelays[attempts++]);
  }

  function navigate() {
    cancelRetry();
    closeSheet(true);
    dirty = true;
    if (!feedRoot()) {
      if (bar) bar.remove();
      return;
    }
    attempts = 0;
    if (active()) attemptMount();
  }

  win.addEventListener("langform-feed-visibility", function () {
    if (!active()) { cancelRetry(); closeSheet(true); return; }
    if (dirty || !bar || !bar.isConnected) navigate();
  });
  win.addEventListener("yt-navigate-finish", navigate);
  win.addEventListener("yt-navigate-start", function () { cancelRetry(); closeSheet(true); dirty = true; });
  win.addEventListener("popstate", navigate);
  win.addEventListener("pagehide", function () { cancelRetry(); closeSheet(true); });
  // The keyboard and rotation already relayout the modal. Settle at its new
  // bounds instead of finishing a percentage transform over changing geometry.
  win.addEventListener("resize", settleSheetMotion);
  win.addEventListener("orientationchange", settleSheetMotion);
  if (win.visualViewport) win.visualViewport.addEventListener("resize", settleSheetMotion);
  doc.addEventListener("visibilitychange", function () {
    if (doc.hidden) { cancelRetry(); closeSheet(true); }
    else if (active() && (dirty || !bar || !bar.isConnected)) navigate();
  });
  if (reducedMotion && typeof reducedMotion.addEventListener === "function") {
    reducedMotion.addEventListener("change", function () {
      if (reducedMotion.matches) settleSheetMotion();
    });
  }
  win.addEventListener("pageshow", function () { if (!bar || !bar.isConnected) navigate(); });
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", navigate, { once: true });
  else navigate();
})(typeof window !== "undefined" ? window : this);
