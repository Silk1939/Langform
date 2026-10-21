const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const app = path.join(__dirname, "../ios/Langform/Langform");
const source = fs.readFileSync(process.env.LANGFORM_VIEWPORT_TEST_SOURCE || path.join(app, "ViewportLayout.js"), "utf8");

function page(t, content = "width=device-width,initial-scale=1", host = "m.youtube.com", siteCSS = "") {
  const dom = new JSDOM('<!doctype html><html><head><meta name="viewport">' + (siteCSS ? '<style>' + siteCSS + '</style>' : '') + '</head><body><ytm-app><ytm-header></ytm-header></ytm-app></body></html>', {
    url: "https://" + host + "/", runScripts: "outside-only",
  });
  const win = dom.window, doc = win.document;
  doc.querySelector('meta[name="viewport"]').content = content;
  t.after(() => { win.dispatchEvent(new win.Event("pagehide")); win.close(); });
  win.eval(source);
  return { win, doc, meta: () => doc.querySelector('meta[name="viewport"]'),
    async flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); },
    event: name => win.dispatchEvent(new win.Event(name)) };
}

function tokens(meta) { return meta.content.split(",").map(value => value.trim()); }

test('native stage snapshots publish all four validated CSS insets and rotation replaces the complete snapshot', t => {
  const p = page(t), root = p.doc.documentElement;
  const read = () => ['top','right','bottom','left'].map(side => root.style.getPropertyValue(`--lf-native-safe-${side}`));
  assert.equal(p.win.__langformSetStageInsets({top:62,right:0,bottom:34,left:0,nativeMini:false}),true);
  assert.deepEqual(read(),['62px','0px','34px','0px']);
  assert.equal(p.win.__langformSetStageInsets({top:0,right:62,bottom:21,left:62,nativeMini:false}),true);
  assert.deepEqual(read(),['0px','62px','21px','62px']);
  for (const invalid of [{top:3,right:-1,bottom:4,left:5},{top:3,right:4,bottom:NaN,left:5},{top:3,right:4,bottom:5,left:'6'},{top:3,right:4,bottom:5}]) {
    assert.equal(p.win.__langformSetStageInsets(invalid),false);
    assert.deepEqual(read(),['0px','62px','21px','62px'],'an invalid member cannot partially overwrite trusted native insets');
  }
});

// Current public mweb root CSS (c3_base.QswTdmvETwA, 2026-10-09). These are
// YouTube's scroll-state rules, not a copy of Langform's inset implementation.
// JSDOM resolves matching/position but retains env()/var()/calc() expressions.
// Its cascade omits specificity/importance between stylesheets, so put the site
// rules first and check priority separately. Safe-area pixels need iPhone QA.
const youtubeScrollCSS = `
ytm-app { display:block; }
ytm-app.sticky-player { padding-top:48px; }
ytm-app.sticky-player.header-in-player { padding-top:0; }
ytm-header,ytm-header-bar,ytm-mobile-topbar-renderer { position:fixed;top:0;left:0;right:0;z-index:4; }
ytm-mobile-topbar-renderer.sticky-player.out { top:-48px; }
ytm-mobile-topbar-renderer.sticky-player.in { top:0; }
.player-container.sticky-player { position:fixed;top:48px; }
.player-container.header-in-player,.player-container.sticky-player.header-in-player { top:0; }
.rich-grid-sticky-header { width:100%;margin-bottom:62px; }
.rich-grid-sticky-header ytm-feed-filter-chip-bar-renderer { position:fixed;top:48px;left:0;right:0;z-index:3;width:100%; }
.is-hashtag .rich-grid-sticky-header ytm-feed-filter-chip-bar-renderer { position:relative;top:0; }
.rich-grid-sticky-header ytm-feed-filter-chip-bar-renderer.filter-chip-bar-out { position:fixed;top:-60px; }
.rich-grid-sticky-header.persistent-header ytm-feed-filter-chip-bar-renderer.filter-chip-bar-out { top:0; }
.rich-grid-sticky-header ytm-feed-filter-chip-bar-renderer.filter-chip-bar-in { position:fixed;top:48px; }
.rich-grid-sticky-header ytm-feed-filter-chip-bar-renderer.filter-chip-bar-static { position:relative;top:0; }
`;

function chipPage(t) {
  const p = page(t, undefined, undefined, youtubeScrollCSS);
  p.doc.querySelector("ytm-app").outerHTML = '<ytm-app class="sticky-player"><ytm-mobile-topbar-renderer id="header-bar" class="sticky-player in"></ytm-mobile-topbar-renderer><div class="player-container sticky-player"></div><ytm-rich-grid-renderer><div class="rich-grid-sticky-header persistent-header"><ytm-feed-filter-chip-bar-renderer id="filter-chip-bar"></ytm-feed-filter-chip-bar-renderer></div></ytm-rich-grid-renderer></ytm-app>';
  return Object.assign(p, {
    app: p.doc.querySelector("ytm-app"), header: p.doc.querySelector("#header-bar"),
    grid: p.doc.querySelector("ytm-rich-grid-renderer"), holder: p.doc.querySelector(".rich-grid-sticky-header"),
    chips: p.doc.querySelector("#filter-chip-bar"), player: p.doc.querySelector(".player-container"),
    style: node => p.win.getComputedStyle(node),
  });
}

test("Sichtbare fixed Filter stehen im gemeinsamen Koordinatenraum unter dem eingerückten Header", async t => {
  const p = chipPage(t); await p.flush();
  for (const state of ["", "filter-chip-bar-in"]) {
    p.chips.className = state;
    assert.equal(p.style(p.header).top, "var(--lf-safe-top)");
    assert.equal(p.style(p.chips).position, "fixed");
    assert.equal(p.style(p.chips).top, "calc(48px + var(--lf-safe-top))", "Headerhöhe plus genau ein Safe-Area-Inset");
    assert.equal(p.style(p.app).paddingTop, p.style(p.chips).top, "Seitenfluss und fixed Filter teilen denselben Ursprung");
    assert.equal(p.style(p.holder).marginBottom, "62px", "YouTubes reservierte Filterhöhe bleibt erhalten");
  }
  const chipRules = [...p.doc.querySelector("#langform-viewport-layout").sheet.cssRules]
    .filter(rule => rule.selectorText && rule.selectorText.includes("ytm-feed-filter-chip-bar-renderer"));
  assert.equal(chipRules.length, 3);
  for (const rule of chipRules) assert.equal(rule.style.getPropertyPriority("top"), "important", "später geladene normale Website-Regeln dürfen den Inset nicht überfahren");
  assert.equal(p.doc.querySelectorAll("#langform-viewport-layout").length, 1);
});

test("Scrollende Filter behalten static/in/out einschließlich persistent sichtbarer Out-Leiste", t => {
  const p = chipPage(t);
  p.chips.className = "filter-chip-bar-static";
  assert.equal(p.style(p.chips).position, "relative");
  assert.equal(p.style(p.chips).top, "0px", "relative Filter erhalten das Inset bereits durch den Seitenfluss");
  p.chips.className = "filter-chip-bar-in";
  assert.equal(p.style(p.chips).top, "calc(48px + var(--lf-safe-top))");
  p.header.className = "sticky-player out";
  p.chips.className = "filter-chip-bar-out";
  assert.equal(p.style(p.header).top, "var(--lf-safe-top)", "Feedheader mit Logo und Suche bleibt beim Scrollen erreichbar");
  assert.equal(p.style(p.chips).position, "fixed");
  assert.equal(p.style(p.chips).top, "calc(48px + var(--lf-safe-top))", "persistente Feedfilter bleiben unter dem festen Header");
  p.holder.classList.remove("persistent-header");
  assert.equal(p.style(p.chips).top, "-60px", "nicht persistente Out-Leiste darf YouTube vollständig wegscrollen");
  p.header.className = "sticky-player in";
  p.chips.className = "filter-chip-bar-in";
  assert.equal(p.style(p.header).top, "var(--lf-safe-top)");
  assert.equal(p.style(p.chips).top, "calc(48px + var(--lf-safe-top))");
});

test("Hashtag- und nicht sticky Filter behalten YouTubes relativen Seitenfluss", t => {
  const p = chipPage(t);
  p.grid.classList.add("is-hashtag");
  assert.equal(p.style(p.chips).position, "relative");
  assert.equal(p.style(p.chips).top, "0px");
  p.grid.classList.remove("is-hashtag"); p.holder.className = "";
  p.chips.style.position = "relative"; p.chips.style.top = "0px";
  assert.equal(p.style(p.chips).position, "relative");
  assert.equal(p.style(p.chips).top, "0px", "gewöhnliche Filter erhalten keine fixed-Geometrie");
});

test("Header im Player und Fullscreen erhalten keine doppelte Safe-Area-Geometrie", t => {
  const p = chipPage(t);
  p.app.classList.add("header-in-player"); p.player.classList.add("header-in-player");
  assert.equal(p.style(p.app).paddingTop, "var(--lf-safe-top)");
  assert.equal(p.style(p.player).top, "var(--lf-safe-top)");
  assert.equal(p.style(p.chips).top, "calc(48px + var(--lf-safe-top))", "fixed Filter bleiben unabhängig vom Player im Header-Koordinatenraum");
  p.doc.documentElement.setAttribute("data-langform-fullscreen", "");
  assert.equal(p.style(p.app).paddingTop, "0px");
  assert.equal(p.style(p.player).top, "0px");
  assert.equal(p.style(p.header).top, "0px");
  assert.equal(p.style(p.chips).top, "48px", "native Inline-Inset-Regeln gelten im Fullscreen nicht");
  p.chips.className = "filter-chip-bar-out";
  assert.equal(p.style(p.chips).top, "0px", "auch persistente Scrollzustände behalten im Fullscreen YouTubes Geometrie");
  p.doc.documentElement.removeAttribute("data-langform-fullscreen");
  assert.equal(p.style(p.chips).top, "calc(48px + var(--lf-safe-top))");
  p.chips.className = "filter-chip-bar-static";
  assert.equal(p.style(p.chips).position, "relative");
  assert.equal(p.style(p.chips).top, "0px");
});

test("Mobile Suchvorschläge beginnen unter dem eingerückten Suchfeld statt darüber", t => {
  const p=page(t,undefined,undefined,'.ytSearchboxComponentMweb .ytSearchboxComponentSuggestionsContainer {position:fixed;top:48px;max-height:calc(100svh - 48px)}');
  p.doc.querySelector('ytm-app').insertAdjacentHTML('beforeend','<yt-searchbox class="ytSearchboxComponentMweb"><div class="ytSearchboxComponentSuggestionsContainer"></div></yt-searchbox>');
  const panel=p.doc.querySelector('.ytSearchboxComponentSuggestionsContainer');
  assert.equal(p.win.getComputedStyle(panel).top,'calc(48px + var(--lf-safe-top))');
  assert.equal(p.win.getComputedStyle(panel).maxHeight,'calc(100svh - 48px - var(--lf-safe-top))');
  p.doc.documentElement.setAttribute('data-langform-fullscreen','');
  assert.equal(p.win.getComputedStyle(panel).top,'48px','fullscreen retains original website coordinates');
});

test("Aktueller View-Model-Suchkopf erhält dasselbe einzelne Safe-Area-Inset",t=>{
  const p=page(t,undefined,undefined,'.ytTopBarViewModelHost {position:fixed;top:0}');
  p.doc.querySelector('ytm-app').insertAdjacentHTML('beforeend','<div class="ytTopBarViewModelHost" data-mode="searching"></div>');
  const header=p.doc.querySelector('.ytTopBarViewModelHost');
  assert.equal(p.win.getComputedStyle(header).top,'var(--lf-safe-top)');
  header.classList.add('out');assert.equal(p.win.getComputedStyle(header).top,'var(--lf-safe-top)','feed search remains available while scrolling');
});

test("Desktop-Suchvorschläge erhalten kein zusätzliches mobiles Inset",t=>{
  const p=page(t,undefined,undefined,'.ytSearchboxComponentDesktop .ytSearchboxComponentSuggestionsContainer {position:absolute;top:44px}');
  p.doc.querySelector('ytm-app').insertAdjacentHTML('beforeend','<yt-searchbox class="ytSearchboxComponentDesktop"><div class="ytSearchboxComponentSuggestionsContainer"></div></yt-searchbox>');
  assert.equal(p.win.getComputedStyle(p.doc.querySelector('.ytSearchboxComponentSuggestionsContainer')).top,'44px');
});

test("Native Viewport erhält vorhandene Skalierung und Tokens und ersetzt nur viewport-fit", async t => {
  const p = page(t, "width=device-width, initial-scale=1.25,maximum-scale=5, user-scalable=yes, Viewport-Fit = contain, interactive-widget=resizes-content");
  await p.flush();
  assert.deepEqual(tokens(p.meta()), ["width=device-width", "initial-scale=1.25", "maximum-scale=5", "user-scalable=yes", "interactive-widget=resizes-content", "viewport-fit=cover"]);
  assert.equal(p.doc.documentElement.hasAttribute("data-langform-edge-to-edge"), true);
  assert.equal(p.doc.querySelectorAll("#langform-viewport-layout").length, 1);
  p.win.eval(source); await p.flush();
  assert.equal(p.doc.querySelectorAll("#langform-viewport-layout").length, 1);
  assert.equal(tokens(p.meta()).filter(value => /^viewport-fit\s*=/i.test(value)).length, 1);
});

test("Website-Content-Schreibzugriffe behalten neue Tokens und werden wieder edge-to-edge", async t => {
  const p = page(t); await p.flush();
  p.meta().content = "width=480,initial-scale=0.8,user-scalable=no,viewport-fit=auto";
  await p.flush();
  assert.deepEqual(tokens(p.meta()), ["width=480", "initial-scale=0.8", "user-scalable=no", "viewport-fit=cover"]);
});

test("BFCache-Seitenrückkehr beobachtet auch die unveränderte Meta-Node erneut", async t => {
  const p = page(t); await p.flush();
  const retained = p.meta();
  p.event("pagehide"); retained.content = "width=device-width,viewport-fit=contain";
  await p.flush();
  assert.equal(retained.content, "width=device-width,viewport-fit=contain", "abgelegte Seite wird nicht weiter beobachtet");
  p.event("pageshow"); await p.flush();
  assert.equal(p.meta(), retained);
  assert.deepEqual(tokens(retained), ["width=device-width", "viewport-fit=cover"]);
  retained.content = "width=device-width,initial-scale=2,viewport-fit=auto";
  await p.flush();
  assert.deepEqual(tokens(retained), ["width=device-width", "initial-scale=2", "viewport-fit=cover"]);
});

test("Hydration darf die Meta-Node ersetzen; neue Geometrie-Tokens werden erhalten", async t => {
  const p = page(t); await p.flush();
  const former = p.meta(), replacement = p.doc.createElement("meta");
  replacement.name = "viewport"; replacement.content = "width=420,initial-scale=0.9,viewport-fit=contain";
  former.replaceWith(replacement); await p.flush();
  assert.equal(p.meta(), replacement);
  assert.deepEqual(tokens(replacement), ["width=420", "initial-scale=0.9", "viewport-fit=cover"]);
  replacement.content = "width=430,viewport-fit=auto"; await p.flush();
  assert.deepEqual(tokens(replacement), ["width=430", "viewport-fit=cover"]);
  former.content = "width=999,viewport-fit=auto"; await p.flush();
  assert.equal(former.content, "width=999,viewport-fit=auto", "die abgelöste Node bleibt unbeobachtet");
});

test("Feed-/Kommentar-Mutationen lösen keine erneute Viewport-Konfiguration aus", async t => {
  const p = page(t); await p.flush();
  const original = p.doc.documentElement.setAttribute;
  let configurations = 0;
  p.doc.documentElement.setAttribute = function (name, value) {
    if (name === "data-langform-edge-to-edge") configurations++;
    return original.call(this, name, value);
  };
  for (const lifecycle of [false, true]) {
    if (lifecycle) { p.event("pagehide"); p.event("pageshow"); await p.flush(); }
    configurations = 0;
    p.doc.body.insertAdjacentHTML("beforeend", Array.from({ length: 100 }, (_, i) => '<ytm-comment-renderer>Kommentar ' + i + '</ytm-comment-renderer>').join(""));
    await p.flush();
    assert.equal(configurations, 0, "nur Head-/Meta-Änderungen gehören zur Viewport-Überwachung");
  }
});

test("Fehlendes Meta wird beim Dokumentstart angelegt und erhält sinnvolle Standardwerte", async t => {
  const p = page(t); p.meta().remove();
  p.doc.dispatchEvent(new p.win.Event("DOMContentLoaded")); await p.flush();
  assert.ok(p.meta());
  assert.deepEqual(tokens(p.meta()), ["width=device-width", "initial-scale=1", "viewport-fit=cover"]);
});

test("Layout bleibt auf native YouTube-WebViews begrenzt", t => {
  const p = page(t, "width=600,viewport-fit=contain", "example.com");
  assert.equal(p.doc.documentElement.hasAttribute("data-langform-edge-to-edge"), false);
  assert.equal(p.doc.querySelector("#langform-viewport-layout"), null);
  assert.equal(p.meta().content, "width=600,viewport-fit=contain");
  const native = fs.readFileSync(path.join(app, "YouTubeWebView.swift"), "utf8");
  assert.match(native, /static let scriptNames = \[[^\]]*"ViewportLayout"/);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../extension/manifest.json"), "utf8"));
  assert.equal(JSON.stringify(manifest).includes("ViewportLayout"), false, "Safari-Erweiterung injiziert das native Layout nicht");
});

test("Stage-Bootstrap und native Updates halten den Safe-Area-Wert unabhängig vom transformierten WK-Viewport", t => {
  const dom = new JSDOM('<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body></body></html>', {
    url:"https://m.youtube.com/watch?v=abcdefghijk", runScripts:"outside-only",
  });
  t.after(() => dom.window.close());
  const win = dom.window, root = win.document.documentElement;
  win.__langformStageInsets = {top:62, right:0, bottom:34, left:0, nativeMini:false};
  win.eval(source);
  assert.equal(root.style.getPropertyValue('--lf-native-safe-top'), '62px', 'document-start state precedes rendering');
  assert.match(win.document.querySelector('#langform-viewport-layout').textContent,
    /--lf-safe-top:var\(--lf-native-safe-top,env\(safe-area-inset-top,0px\)\)/);
  assert.equal(win.__langformSetStageInsets({top:62, right:0, bottom:34, left:0, nativeMini:true}), true);
  assert.equal(root.style.getPropertyValue('--lf-native-safe-top'), '62px', 'mini changes no stage inset');
  assert.equal(root.hasAttribute('data-langform-mini-video'), true);
  for (const bad of [{top:NaN,right:0,bottom:0,left:0}, {top:-1,right:0,bottom:0,left:0},
    {top:0,right:0,bottom:0,left:0,nativeMini:'true'}, {top:0}]) {
    assert.equal(win.__langformSetStageInsets(bad), false);
    assert.equal(root.style.getPropertyValue('--lf-native-safe-top'), '62px', 'invalid data cannot overwrite the trusted stage');
  }
  win.__langformSetStageInsets({top:0,right:59,bottom:21,left:59,nativeMini:false});
  assert.equal(root.style.getPropertyValue('--lf-native-safe-top'), '0px', 'actual stage rotation may change the inset');
  assert.equal(root.hasAttribute('data-langform-mini-video'), false);
  win.dispatchEvent(new win.Event('pagehide')); win.dispatchEvent(new win.Event('pageshow'));
  assert.equal(root.style.getPropertyValue('--lf-native-safe-top'), '0px', 'BFCache keeps the current native stage state');
});

test("Mini besitzt nur native Controls; YouTube-Controls kehren beim Expand/Fullscreen zurück und das Video bleibt sichtbar", t => {
  const p = page(t);
  p.doc.body.innerHTML = '<div id="movie_player"><div class="html5-video-container"><video></video></div><div id="player-control-overlay"><div class="player-controls-content"><div class="player-controls-middle"></div><div class="player-controls-bottom"></div></div></div><div class="ytp-chrome-top"></div><div class="ytp-chrome-bottom"></div><div class="ytp-gradient-top"></div><button class="ytp-large-play-button"></button><div class="caption-window">Captions</div></div><button id="native-controls">Native controls</button>';
  const state = {top:62,right:0,bottom:34,left:0,nativeMini:true};
  const controls = [...p.doc.querySelectorAll('#player-control-overlay,.player-controls-content,.player-controls-middle,.player-controls-bottom,.ytp-chrome-top,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-large-play-button')];
  for (const mini of [true, false, true]) {
    p.win.__langformSetStageInsets({...state,nativeMini:mini});
    for (const control of controls) {
      assert.equal(p.win.getComputedStyle(control).visibility, mini ? 'hidden' : 'visible');
      assert.equal(p.win.getComputedStyle(control).pointerEvents, mini ? 'none' : 'auto');
    }
    for (const media of p.doc.querySelectorAll('video,.html5-video-container,.caption-window,#native-controls')) {
      assert.equal(p.win.getComputedStyle(media).visibility, 'visible', 'only known embedded control chrome changes');
    }
  }
  p.doc.documentElement.setAttribute('data-langform-fullscreen','');
  for (const control of controls) assert.equal(p.win.getComputedStyle(control).visibility, 'visible', 'fullscreen owns its controls even if a previous mini message is still in flight');
  p.win.__langformSetStageInsets({...state,nativeMini:false});
  p.doc.documentElement.removeAttribute('data-langform-fullscreen');
  for (const control of controls) assert.equal(p.win.getComputedStyle(control).visibility, 'visible', 'expanded/new document state restores website controls');
});

// Real scrolled Watch DOM observed on 2026-10-11: the 402×48 chip cloud
// overlaps the original video (y110..336) at y274.125. Only the containing
// sticky branch is positioned in this fixture; the observed cloud is static.
// JSDOM checks computed CSS, retained geometry declarations and compositing
// opacity. It does not perform browser painting, scrolling or hit-testing.
function watchChipPage(t) {
  const p = page(t, undefined, undefined, `
ytm-watch,ytm-related-chip-cloud-renderer,ytm-chip-cloud-renderer {display:block}
ytm-chip-cloud-renderer {opacity:1;visibility:visible;pointer-events:auto}
.watch-chip-position {position:fixed;top:274.125px;left:0;width:402px;background:white}
`);
  p.doc.body.innerHTML = '<ytm-watch><div class="player-container"><div id="movie_player"><div class="html5-video-container"><video></video></div><div class="ytp-caption-window-container"><div class="caption-window">Untertitel</div></div></div></div><ytm-single-column-watch-next-results-renderer><ytm-item-section-renderer><ytm-related-chip-cloud-renderer class="watch-chip-position"><ytm-chip-cloud-renderer id="watch-chips" style="width:402px;height:48px;transform:translateX(0px);--author-value:retained"><button style="visibility:visible!important;opacity:1!important">Alle</button><button>Von Blender</button><button>Big Buck Bunny</button></ytm-chip-cloud-renderer></ytm-related-chip-cloud-renderer></ytm-item-section-renderer></ytm-single-column-watch-next-results-renderer></ytm-watch><ytm-rich-grid-renderer><ytm-related-chip-cloud-renderer><ytm-chip-cloud-renderer id="feed-chip-cloud">Feed chips</ytm-chip-cloud-renderer></ytm-related-chip-cloud-renderer><ytm-feed-filter-chip-bar-renderer>Feed filters</ytm-feed-filter-chip-bar-renderer></ytm-rich-grid-renderer><ytm-mobile-topbar-renderer>Header</ytm-mobile-topbar-renderer>';
  return Object.assign(p, {
    chips:p.doc.querySelector('#watch-chips'),
    style:node=>p.win.getComputedStyle(node),
    mini:value=>p.win.__langformSetStageInsets({top:62,right:0,bottom:34,left:0,nativeMini:value}),
  });
}

function compositedOpacity(p, node) {
  let result = 1;
  for (let current=node;current;current=current.parentElement) {
    const value=p.style(current).opacity;
    result*=value===''?1:Number(value);
  }
  return result;
}

test("Watch-Chips verdecken im Mini auch mit ausdrücklich sichtbarem Kind kein Videobild", t => {
  const p=watchChipPage(t), child=p.chips.firstElementChild;
  const beforeStyle=p.chips.getAttribute('style'), beforeChildStyle=child.getAttribute('style');
  const geometry=()=>[p.style(p.chips).display,p.style(p.chips).position,p.style(p.chips).width,p.style(p.chips).height,p.style(p.chips).transform,p.style(p.chips.parentElement).top];
  const beforeGeometry=geometry();
  assert.equal(compositedOpacity(p,child),1,'the visible scrolled bar reproduces the prior overlap');
  p.mini(true);
  assert.equal(compositedOpacity(p,child),0,'parent opacity prevents a visible descendant from painting over the video');
  assert.equal(p.style(p.chips).visibility,'hidden');
  assert.equal(p.style(p.chips).pointerEvents,'none');
  assert.equal(compositedOpacity(p,p.chips.parentElement),0,'the white related-branch background is hidden too');
  assert.equal(p.style(p.chips.parentElement).pointerEvents,'none');
  assert.equal(p.style(p.chips.parentElement).backgroundColor,'rgb(255, 255, 255)','the authored background is retained');
  assert.equal(p.style(child).visibility,'visible','the author visible override is retained rather than rewritten');
  assert.deepEqual(geometry(),beforeGeometry,'hiding chrome keeps reserved layout and its authored position');
  assert.equal(p.chips.getAttribute('style'),beforeStyle);
  assert.equal(child.getAttribute('style'),beforeChildStyle);
  for (const node of p.doc.querySelectorAll('video,.html5-video-container,.ytp-caption-window-container,.caption-window,#feed-chip-cloud,ytm-feed-filter-chip-bar-renderer,ytm-mobile-topbar-renderer')) {
    assert.equal(compositedOpacity(p,node),1,'only the known Watch chip cloud is hidden');
    assert.equal(p.style(node).visibility,'visible');
  }
});

test("Watch-Chips erhalten beim Expand und trotz alter Mini-Nachricht im Fullscreen ihre Originaldarstellung", t => {
  const p=watchChipPage(t), initial=()=>[p.style(p.chips).opacity,p.style(p.chips).visibility,p.style(p.chips).pointerEvents];
  const before=initial(), authorStyle=p.chips.getAttribute('style');
  for (let cycle=0;cycle<2;cycle++) {
    p.mini(true); assert.equal(compositedOpacity(p,p.chips),0);
    p.mini(false); assert.deepEqual(initial(),before);
  }
  p.mini(true);
  p.doc.documentElement.setAttribute('data-langform-fullscreen','');
  assert.deepEqual(initial(),before,'fullscreen owns branch visibility while stale mini state is still present');
  p.mini(false); p.doc.documentElement.removeAttribute('data-langform-fullscreen');
  assert.deepEqual(initial(),before,'returning expanded restores normal website chrome');
  assert.equal(p.chips.getAttribute('style'),authorStyle);
});

test("Watch-Chips aus späterer Hydration werden im Mini ohne DOM-Observer und bei Expand sofort zurückgegeben", async t => {
  const p=watchChipPage(t); p.mini(true);
  const replacement=p.chips.cloneNode(true); replacement.id='replacement-watch-chips';
  p.chips.replaceWith(replacement); await p.flush();
  assert.equal(compositedOpacity(p,replacement.firstElementChild),0,'the CSS applies to the actual newly hydrated cloud');
  assert.equal(p.style(replacement).pointerEvents,'none');
  p.mini(false);
  assert.equal(compositedOpacity(p,replacement.firstElementChild),1);
  assert.equal(p.style(replacement).visibility,'visible');
  assert.equal(p.style(replacement).pointerEvents,'auto');
});

test("Watch-Chips schützen auch eine später im Related-Branch eingefügte Medienebene", async t => {
  const p=watchChipPage(t); p.mini(true);
  assert.equal(compositedOpacity(p,p.chips),0);
  const video=p.doc.createElement('video'); p.chips.parentElement.appendChild(video); await p.flush();
  assert.equal(compositedOpacity(p,video),1,'a media sibling must not inherit a hidden related branch');
  assert.equal(compositedOpacity(p,p.chips),1,'the entire protected branch is released without an observer');
  assert.equal(p.style(p.chips.parentElement).visibility,'visible');
  video.remove(); await p.flush();
  assert.equal(compositedOpacity(p,p.chips),0,'the known chrome-only branch is eligible again');
  p.mini(false); assert.equal(compositedOpacity(p,p.chips),1);
});

test("Watch-Chips außerhalb des bekannten Related-Branches und normale Watchinhalte bleiben sichtbar", t => {
  const p=watchChipPage(t), watch=p.doc.querySelector('ytm-watch');
  watch.insertAdjacentHTML('beforeend','<ytm-chip-cloud-renderer id="unrelated-watch-chips">Andere Chips</ytm-chip-cloud-renderer><div class="watch-title">Titel</div><ytm-comment-section-renderer>Kommentar</ytm-comment-section-renderer><div id="native-control-fixture">Native Control</div>');
  p.mini(true);
  for (const node of watch.querySelectorAll('#unrelated-watch-chips,.watch-title,ytm-comment-section-renderer,#native-control-fixture')) {
    assert.equal(compositedOpacity(p,node),1);
    assert.equal(p.style(node).visibility,'visible');
    assert.equal(p.style(node).pointerEvents,'auto');
  }
});

for (const protectedContent of ['<video></video>','<audio></audio>','<div class="html5-video-container"></div>','<div class="ytp-caption-window-container"></div>','<div class="caption-window"></div>']) {
  test("Watch-Chips mit geschützter Medien-/Captionebene werden niemals mit ausgeblendet: "+protectedContent, t => {
    const p=watchChipPage(t); p.chips.insertAdjacentHTML('beforeend',protectedContent);
    const authorStyle=p.chips.getAttribute('style'); p.mini(true);
    assert.equal(compositedOpacity(p,p.chips),1,'a protected descendant excludes this entire chip cloud');
    assert.equal(p.style(p.chips).visibility,'visible');
    assert.equal(p.style(p.chips).pointerEvents,'auto');
    assert.equal(compositedOpacity(p,p.chips.lastElementChild),1);
    assert.equal(p.chips.getAttribute('style'),authorStyle);
  });
}

// Actual 2026-10-12 paint probe: the outer mobile renderer is fixed at
// (0,62,402,48); its HEADER.mobile-topbar-header is relative/z3 and changes
// from transparent to rgb15 while scrolling. JSDOM retains the CSS inheritance
// token; real computed pixels/rects are checked independently in Simulator I.
function safeTopPage(t, {header=true}={}) {
  const p=page(t,undefined,undefined,`
ytm-mobile-topbar-renderer {position:fixed;top:0;width:402px;height:48px;z-index:4;transform:none}
header.mobile-topbar-header {position:relative;height:48px;z-index:3;transform:none;background-color:transparent}
html.watch-scroll header.mobile-topbar-header {background-color:rgb(15,15,15)}
header.mobile-topbar-header::before {content:'AUTHOR';background-color:red}
`);
  p.win.history.replaceState({},'', '/watch?v=aqz-KE-bpKQ&ra=m');
  p.doc.body.innerHTML='<ytm-app><ytm-mobile-topbar-renderer class="sticky-player">'+(header?'<header class="mobile-topbar-header cairo-settings-topbar"><button>Headeraktion</button></header>':'')+'</ytm-mobile-topbar-renderer><ytm-watch><div class="player-container"><div id="movie_player"><div class="html5-video-container"><video style="width:402px;height:226px"></video><div class="caption-window">Untertitel</div></div></div></div></ytm-watch></ytm-app>';
  const timers=new Map();let serial=0;
  p.win.setTimeout=(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;};
  p.win.clearTimeout=id=>timers.delete(id);
  return Object.assign(p,{
    header:()=>p.doc.querySelector('header.mobile-topbar-header'),
    renderer:()=>p.doc.querySelector('ytm-mobile-topbar-renderer'),
    cover:()=>p.doc.querySelector('#langform-safe-top-cover'),
    style:node=>p.win.getComputedStyle(node),timers,
    stage:(patch={})=>p.win.__langformSetStageInsets({top:62,right:0,bottom:34,left:0,nativeMini:false,...patch}),
  });
}
function inheritedBackground(p,node){
  const value=p.style(node).backgroundColor;
  return value==='inherit'?inheritedBackground(p,node.parentElement):value;
}

test('SafeTop ergänzt ausschließlich eine nichtinteraktive Watch-Headerfläche ohne Elterngeometrie oder Authorpseudo zu ändern',async t=>{
  const p=safeTopPage(t),header=p.header(),renderer=p.renderer(),video=p.doc.querySelector('video');
  const before=[header.getAttribute('style'),renderer.getAttribute('style'),video.getAttribute('style')];
  p.stage();await p.flush();const cover=p.cover();assert.ok(cover);
  assert.equal(cover.parentElement,header);assert.equal(cover.getAttribute('aria-hidden'),'true');assert.equal(cover.textContent,'');
  const css=p.style(cover);assert.equal(css.position,'fixed');assert.equal(css.top,'0px');assert.equal(css.left,'0px');
  assert.equal(css.width,'100%');assert.equal(css.height,'var(--lf-safe-top)');assert.equal(css.pointerEvents,'none');
  assert.equal(css.backgroundColor,'inherit');
  assert.equal(p.style(header).height,'48px');assert.equal(p.style(header).position,'relative');
  assert.equal(p.style(renderer).top,'var(--lf-safe-top)');
  assert.deepEqual([header.getAttribute('style'),renderer.getAttribute('style'),video.getAttribute('style')],before);
  assert.ok([...p.doc.styleSheets[0].cssRules].some(r=>r.selectorText==='header.mobile-topbar-header::before'&&r.style.content==="'AUTHOR'"),'the real author pseudo is untouched');
  let contacts=0;header.querySelector('button').addEventListener('click',()=>contacts++);header.querySelector('button').click();assert.equal(contacts,1);
});

test('SafeTop erbt initiale Transparenz sowie spätere Scroll-/Light-/Dark-/Authorfarbe ohne Farbpolling',async t=>{
  const p=safeTopPage(t);p.stage();await p.flush();const cover=p.cover();assert.ok(cover);
  assert.equal(inheritedBackground(p,cover),'rgba(0, 0, 0, 0)');
  p.doc.documentElement.classList.add('watch-scroll');await p.flush();
  assert.equal(p.cover(),cover);assert.equal(inheritedBackground(p,cover),'rgb(15, 15, 15)');
  for(const color of ['rgb(255, 255, 255)','rgb(20, 20, 20)','rgba(20, 30, 40, 0.4)','transparent']){
    p.header().style.backgroundColor=color;await p.flush();assert.equal(p.cover(),cover);
    assert.equal(inheritedBackground(p,cover),p.style(p.header()).backgroundColor,'exact author inheritance; no invented opaque fallback');
  }
  assert.equal(p.timers.size,0,'connected header needs no discovery timer or colour polling');
});

test('SafeTop gibt Mini/Fullscreen/Nullinset frei und kehrt beim Expand/Inline einmal zurück',async t=>{
  const p=safeTopPage(t);p.stage();await p.flush();assert.ok(p.cover());
  p.stage({nativeMini:true});await p.flush();assert.equal(p.cover(),null);
  p.stage();await p.flush();assert.ok(p.cover());
  p.doc.documentElement.setAttribute('data-langform-fullscreen','');await p.flush();assert.equal(p.cover(),null);
  p.doc.documentElement.removeAttribute('data-langform-fullscreen');await p.flush();assert.ok(p.cover());
  p.stage({top:0});await p.flush();assert.equal(p.cover(),null);
  p.stage();await p.flush();assert.equal(p.doc.querySelectorAll('#langform-safe-top-cover').length,1);
});

test('SafeTop entfernt alte Watchbindung bei Navigation und aktiviert keine Feed-/Suche-/Shorts-/falscheID',async t=>{
  const p=safeTopPage(t);p.stage();await p.flush();assert.ok(p.cover());
  p.event('yt-navigate-start');await p.flush();assert.equal(p.cover(),null);
  for(const route of ['/','/results?search_query=Video','/shorts/aqz-KE-bpKQ','/watch?v=bad']){
    p.win.history.replaceState({},'',route);p.event('yt-navigate-finish');await p.flush();assert.equal(p.cover(),null);
    assert.equal(p.timers.size,0,'inactive route does not discover headers');
  }
  p.win.history.replaceState({},'', '/watch?v=aqz-KE-bpKQ');p.event('popstate');await p.flush();assert.ok(p.cover());
});

test('SafeTop bindet hydrierte Ersatzheader ohne alten Span oder neue Geometrie an',async t=>{
  const p=safeTopPage(t);p.stage();await p.flush();const oldHeader=p.header(),oldCover=p.cover();assert.ok(oldCover);
  const next=oldHeader.cloneNode(false);next.innerHTML='<button>Neuer Header</button>';oldHeader.replaceWith(next);await p.flush();
  assert.ok(p.cover());assert.notEqual(p.cover(),oldCover);assert.equal(p.cover().parentElement,next);assert.equal(oldHeader.querySelector('#langform-safe-top-cover'),null);
  p.cover().remove();await p.flush();assert.equal(p.doc.querySelectorAll('#langform-safe-top-cover').length,1,'author hydration can remove and rebuild only our own cover');
});

test('SafeTop bewahrt vorhandene ID, transformierte Eigentümer und Medien/Captionebenen',async t=>{
  const p=safeTopPage(t);p.stage();await p.flush();assert.ok(p.cover());
  for(const property of ['transform','filter','perspective']){
    p.renderer().style[property]=property==='transform'?'translateY(1px)':property==='filter'?'blur(0px)':'10px';await p.flush();assert.equal(p.cover(),null);
    p.renderer().style[property]='none';await p.flush();assert.ok(p.cover());
  }
  for(const content of ['<video></video>','<audio></audio>','<div class="html5-video-container"></div>','<div class="caption-window"></div>']){
    p.header().insertAdjacentHTML('beforeend',content);await p.flush();assert.equal(p.cover(),null);
    p.header().lastElementChild.remove();await p.flush();assert.ok(p.cover());
  }
  p.event('yt-navigate-start');await p.flush();const author=p.doc.createElement('span');author.id='langform-safe-top-cover';author.textContent='AUTHOR ID';p.header().appendChild(author);
  p.event('yt-navigate-finish');await p.flush();assert.equal(p.cover(),author);assert.equal(author.textContent,'AUTHOR ID');assert.equal(author.hasAttribute('data-langform-safe-top-cover'),false);
});

test('SafeTop akzeptiert nur eine bekannte sichtbare Headerfläche und bewahrt ihre normalen Scrollzustände',async t=>{
  const p=safeTopPage(t,{header:false});p.renderer().innerHTML='<header class="unknown-header">Autorheader</header>';
  p.stage();await p.flush();assert.equal(p.cover(),null,'unknown header variants remain untouched');
  p.renderer().insertAdjacentHTML('beforeend','<header class="mobile-topbar-header"><button>Bekannt</button></header>');
  await p.flush();assert.ok(p.cover());const header=p.header(),renderer=p.renderer();
  const duplicate=header.cloneNode(false);renderer.appendChild(duplicate);await p.flush();assert.equal(p.cover(),null,'ambiguous paint owners are not guessed');
  duplicate.remove();await p.flush();assert.ok(p.cover());
  header.style.display='none';await p.flush();assert.equal(p.cover(),null);
  header.style.removeProperty('display');await p.flush();assert.ok(p.cover());
  for(const state of ['out','in']){
    renderer.className=state;await p.flush();assert.ok(p.cover());
    assert.equal(p.style(p.cover()).top,'0px');assert.equal(p.style(header).height,'48px');
  }
  assert.equal(p.timers.size,0,'known hydrated owner ends bounded discovery');
});

test('SafeTop unterbricht Discovery nach zehn Sekunden und gibt BFCache/Teardown sauber frei',async t=>{
  const p=safeTopPage(t,{header:false});p.stage();await p.flush();
  const pending=[...p.timers.entries()];assert.equal(pending.length,1);assert.equal(pending[0][1].delay,10000);
  p.timers.delete(pending[0][0]);pending[0][1].fn();await p.flush();assert.equal(p.timers.size,0);
  p.renderer().innerHTML='<header class="mobile-topbar-header"></header>';await p.flush();assert.equal(p.cover(),null,'expired discovery does not keep scanning arbitrary content');
  p.event('yt-navigate-finish');await p.flush();assert.ok(p.cover());
  p.event('pagehide');await p.flush();assert.equal(p.cover(),null);assert.equal(p.timers.size,0);
  p.header().insertAdjacentHTML('beforeend','<span>Während Cache</span>');await p.flush();assert.equal(p.cover(),null);
  p.event('pageshow');await p.flush();assert.equal(p.doc.querySelectorAll('#langform-safe-top-cover').length,1);
  p.event('pageshow');await p.flush();assert.equal(p.doc.querySelectorAll('#langform-safe-top-cover').length,1);
});

function shippingFullscreenExitCSS(p){
  const source=fs.readFileSync(path.join(app,'FullscreenMotion.js'),'utf8');
  const css=source.split('style.textContent = `')[1].split('#langform-fullscreen-ui {')[0];
  const sheet=p.doc.createElement('style');sheet.textContent=css;p.doc.head.appendChild(sheet);
}
async function pendingSafeTopExit(p,{reveal=false}={}){
  shippingFullscreenExitCSS(p);p.stage();await p.flush();assert.ok(p.cover());
  p.doc.documentElement.setAttribute('data-langform-fullscreen','');await p.flush();assert.equal(p.cover(),null);
  p.renderer().setAttribute('data-langform-fullscreen-exit-context','');
  p.doc.documentElement.removeAttribute('data-langform-fullscreen');await p.flush();
  assert.equal(p.style(p.header()).visibility,'hidden');assert.equal(p.cover(),null);
  let revealing=reveal;
  if(reveal){
    const read=p.win.getComputedStyle.bind(p.win);
    // JSDOM has no WAAPI. Model only the browser's computed opacity while the
    // shipping 140ms reveal runs; completion does not mutate any DOM attribute.
    p.win.getComputedStyle=(node,...args)=>{
      const css=read(node,...args);
      return node===p.renderer()?new Proxy(css,{get(object,key){
        if(key==='opacity'&&revealing)return '0';
        const value=Reflect.get(object,key,object);return typeof value==='function'?value.bind(object):value;
      }}):css;
    };
  }
  p.renderer().removeAttribute('data-langform-fullscreen-exit-context');
  if(reveal)p.event('player-fullscreen-change');
  await p.flush();return ()=>{revealing=false;};
}
function takeSafeTopRearm(p){
  const pending=[...p.timers.entries()];assert.equal(pending.length,1,'one bounded post-reveal recheck');
  assert.equal(pending[0][1].delay,200);
  return {fire(){p.timers.delete(pending[0][0]);pending[0][1].fn();},fn:pending[0][1].fn};
}

test('SafeTop kehrt nach echter Shipping-Exitcontext-Attributfreigabe ohne fremde DOMmutation zurück',async t=>{
  const p=safeTopPage(t);await pendingSafeTopExit(p);
  assert.equal(p.style(p.header()).visibility,'visible');assert.ok(p.cover(),'visible header requires its cover after exit context removal');
  assert.equal(p.cover().parentElement,p.header());assert.equal(p.timers.size,0,'visible owner needs no delayed retry');
});

test('SafeTop wartet bei Shipping-Fullscreen-Reveal einmal auf die Opacityfreigabe und erzeugt keine Pollschleife',async t=>{
  const p=safeTopPage(t);const finish=await pendingSafeTopExit(p,{reveal:true});
  assert.equal(p.cover(),null,'opacity-zero owner remains guarded');
  const retry=takeSafeTopRearm(p);finish();retry.fire();await p.flush();assert.ok(p.cover());
  assert.equal(p.style(p.cover()).top,'0px');assert.equal(p.style(p.cover()).pointerEvents,'none');
  assert.equal(p.doc.querySelectorAll('#langform-safe-top-cover').length,1);assert.equal(p.timers.size,0);
});

test('SafeTop verwirft alte Reveal-Callbacks bei Navigation, neuem Fullscreen, Mini, Nullinset und pagehide',async t=>{
  for(const stop of ['navigation','fullscreen','mini','nullinset','pagehide']){
    const p=safeTopPage(t);const finish=await pendingSafeTopExit(p,{reveal:true});const retry=takeSafeTopRearm(p);
    if(stop==='navigation')p.event('yt-navigate-start');
    if(stop==='fullscreen')p.doc.documentElement.setAttribute('data-langform-fullscreen','');
    if(stop==='mini')p.stage({nativeMini:true});
    if(stop==='nullinset')p.stage({top:0});
    if(stop==='pagehide')p.event('pagehide');
    await p.flush();assert.equal(p.timers.size,0,stop+' clears bounded retry');finish();retry.fn();await p.flush();
    assert.equal(p.cover(),null,stop+' does not let a queued old callback recreate the cover');
  }
});

test('SafeTop-Revealretry wahrt aktuelle Author-Opacity und Captionguards ohne weitere Versuche',async t=>{
  for(const protectedOwner of ['author-hidden','caption']){
    const p=safeTopPage(t);const finish=await pendingSafeTopExit(p,{reveal:true});const retry=takeSafeTopRearm(p);
    if(protectedOwner==='author-hidden')p.renderer().style.opacity='0';
    else p.header().insertAdjacentHTML('beforeend','<div class="ytp-caption-window-container">Authorcaption</div>');
    await p.flush();finish();retry.fire();await p.flush();
    assert.equal(p.cover(),null,protectedOwner+' still refuses a cover after the known reveal');
    assert.equal(p.timers.size,0,'one recheck ends; no guard relaxation or polling');
    if(protectedOwner==='author-hidden')p.renderer().style.removeProperty('opacity');
    else p.header().lastElementChild.remove();
    await p.flush();assert.ok(p.cover(),'ordinary author mutation can later admit the genuinely visible clean header');
  }
});

function headerSearchPage(t,modern=false) {
 const p=page(t,undefined,undefined,`
 ytm-mobile-topbar-renderer,.ytTopBarViewModelHost{display:flex;position:fixed;top:0;height:48px}
 header.mobile-topbar-header,.mobile-topbar-header-content,.ytTopBarViewModelTrailingButtons{display:flex;height:48px}
 button{color:#0f0f0f} .mobile-topbar-title{color:#0f0f0f}
 `);
 p.doc.body.innerHTML=modern?'<ytm-app><div class="ytTopBarViewModelHost"><span class="mobile-topbar-title">NASA</span><div class="ytTopBarViewModelTrailingButtons"><button id="profile">Profil</button><button id="more">Mehr</button></div></div></ytm-app>':'<ytm-app><ytm-mobile-topbar-renderer><header class="mobile-topbar-header"><span class="mobile-topbar-title">NASA</span><div class="mobile-topbar-header-content"><button id="profile">Profil</button><button id="more">Mehr</button></div></header></ytm-mobile-topbar-renderer></ytm-app>';
 p.win.HTMLElement.prototype.getBoundingClientRect=function(){return {x:0,y:59,width:this.hidden?0:120,height:this.hidden?0:48,top:59,bottom:107,left:0,right:120}};
 const posts=[],frames=new Map();let serial=0;
 const nativeTimer=p.win.setTimeout.bind(p.win),nativeCancel=p.win.clearTimeout.bind(p.win);
 p.win.setTimeout=(cb,delay)=>{if(delay===0){frames.set(++serial,cb);return serial}return nativeTimer(cb,delay)};p.win.clearTimeout=id=>{if(!frames.delete(id))nativeCancel(id)};
 p.win.webkit={messageHandlers:{langformOpenWatch:{postMessage(){}},langformNativeSearch:{postMessage(body){posts.push(body)}}}};
 p.win.__langformFeedActive=true;
 const paint=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(cb=>cb())};
 p.win.__langformSetStageInsets({top:59,left:0,right:0,bottom:34,nativeMini:false});
 return Object.assign(p,{posts,paint,frames,button:()=>p.doc.querySelector('#langform-feed-search'),header:()=>p.doc.querySelector(modern?'.ytTopBarViewModelHost':'.mobile-topbar-header')});
}
for(const modern of [false,true]) {
 test('Feste Headerlupe erhält eigenen 44px Flexplatz ohne Profil/Mehr zu überdecken, modern='+modern,async t=>{
  const p=headerSearchPage(t,modern);await p.flush();p.paint();const button=p.button();assert.ok(button);
  assert.equal(button.getAttribute('aria-label'),'In YouTube suchen');assert.equal(p.doc.querySelectorAll('#langform-feed-search').length,1);
  const slot=button.parentElement;assert.equal(slot.children[0].id,'profile');assert.equal(slot.children[1].id,'more');assert.equal(slot.children[2],button);
  assert.equal(p.win.getComputedStyle(button).width,'44px');assert.equal(p.win.getComputedStyle(button).height,'44px');assert.equal(p.win.getComputedStyle(button).flex,'0 0 44px');
  button.click();assert.deepEqual(JSON.parse(JSON.stringify(p.posts)),[{action:'open',href:p.win.location.href}]);
  p.win.__langformSetStageInsets({top:59,left:0,right:0,bottom:34,nativeMini:true});await p.flush();p.paint();assert.equal(p.button(),button,'visible Mini feed retains header search');
  p.doc.documentElement.setAttribute('data-langform-fullscreen','');await p.flush();assert.equal(p.button(),null);
  button.click();assert.equal(p.posts.length,1,'detached fullscreen control cannot reopen native search');
  p.doc.documentElement.removeAttribute('data-langform-fullscreen');await p.flush();p.paint();assert.ok(p.button());
 });
}
test('Hydrierte Original-Lupe ersetzt genau die eigene Lupe; verborgenes Duplikat ersetzt sie nicht',async t=>{
 const p=headerSearchPage(t);const original=p.doc.createElement('button');original.className='topbar-button-search-button';original.hidden=true;p.header().appendChild(original);
 await p.flush();p.paint();assert.ok(p.button());original.hidden=false;await p.flush();p.paint();assert.equal(p.button(),null);
 original.remove();await p.flush();p.paint();assert.ok(p.button());assert.equal(p.doc.querySelectorAll('#langform-feed-search').length,1);
});
test('Headerlupe gibt inaktive Feeds/Navigation/BFCache und fehlende Appbrücke frei',async t=>{
 const p=headerSearchPage(t);const stale=p.button();p.win.__langformFeedActive=false;p.event('langform-feed-visibility');assert.equal(p.button(),null);stale.click();assert.equal(p.posts.length,0);
 p.win.__langformFeedActive=true;p.event('langform-feed-visibility');assert.ok(p.button());p.event('yt-navigate-start');assert.equal(p.button(),null);
 p.win.history.replaceState({},'','/watch?v=abcdefghijk');p.event('yt-navigate-finish');await p.flush();assert.equal(p.button(),null);
 p.win.history.replaceState({},'','/');p.event('yt-navigate-finish');await p.flush();assert.ok(p.button());p.event('pagehide');assert.equal(p.button(),null);p.event('pageshow');await p.flush();assert.ok(p.button());
 delete p.win.webkit.messageHandlers.langformNativeSearch;p.event('langform-feed-visibility');assert.equal(p.button(),null);
});
test('Headerkontrast bleibt auf bekannte Feedheader begrenzt und behält die rote SVG-Markenfarbe',t=>{
 const p=headerSearchPage(t);p.header().insertAdjacentHTML('afterbegin','<c3-icon class="mobile-topbar-logo" style="color:rgb(255,0,51)"><svg><path fill="#ff0033"></path></svg></c3-icon>');
 const logo=p.doc.querySelector('.mobile-topbar-logo');assert.equal(p.win.getComputedStyle(logo).color,'rgb(255, 0, 51)');assert.equal(logo.querySelector('path').getAttribute('fill'),'#ff0033');
 assert.equal(p.win.getComputedStyle(p.doc.querySelector('#profile')).color,'rgb(255, 255, 255)');
 assert.equal(p.win.getComputedStyle(p.doc.querySelector('.mobile-topbar-title')).color,'rgb(255, 255, 255)');
 const outside=p.doc.createElement('button');outside.textContent='Feedaktion';p.doc.body.appendChild(outside);assert.equal(p.win.getComputedStyle(outside).color,'rgb(15, 15, 15)');
});

test('native Watch collapse has a reserved logo slot without hiding feed navigation or player content', t => {
  const p=page(t,undefined,undefined,'ytm-mobile-topbar-renderer{display:block;position:fixed} .mobile-topbar-logo{display:block;visibility:visible} a{display:block;width:117px;height:48px}');
  p.doc.body.innerHTML='<ytm-mobile-topbar-renderer><header class="mobile-topbar-header"><a id="brand" href="/"><c3-icon class="mobile-topbar-logo full-logo"></c3-icon></a><button id="search">Suchen</button></header></ytm-mobile-topbar-renderer><video></video><div class="caption-window">Untertitel</div>';
  p.win.webkit={messageHandlers:{langformPlayer:{postMessage(){}}}};
  p.win.history.replaceState({},'', '/watch?v=aqz-KE-bpKQ');
  p.win.__langformSetStageInsets({top:59,right:0,bottom:34,left:0});
  const logo=p.doc.querySelector('.mobile-topbar-logo'),brand=p.doc.querySelector('#brand');
  assert.equal(p.win.getComputedStyle(logo).visibility,'hidden','native chevron cannot paint over the wordmark');
  assert.equal(p.win.getComputedStyle(brand).visibility,'hidden','no invisible underlying Home link in the reserved native slot');
  assert.equal(p.win.getComputedStyle(brand).width,'117px','right-side original controls keep their layout');
  for(const item of p.doc.querySelectorAll('#search,video,.caption-window')) assert.notEqual(p.win.getComputedStyle(item).visibility,'hidden');
  p.doc.documentElement.setAttribute('data-langform-fullscreen','');
  assert.equal(p.win.getComputedStyle(logo).visibility,'visible','fullscreen owns its header independently');
  p.doc.documentElement.removeAttribute('data-langform-fullscreen');
  p.win.history.replaceState({},'','/feed/subscriptions');p.event('yt-navigate-finish');
  assert.equal(p.win.getComputedStyle(logo).visibility,'visible','feed Premium/YouTube logo remains intact');
  p.win.history.replaceState({},'','/watch?v=aqz-KE-bpKQ');delete p.win.webkit.messageHandlers.langformPlayer;p.event('yt-navigate-finish');
  assert.equal(p.win.getComputedStyle(logo).visibility,'visible','ordinary website without native player keeps its logo');
});
