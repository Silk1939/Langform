const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/FeedMotion.js"), "utf8");

function card(id, attributes = "") {
  return `<ytm-rich-item-renderer id="${id}" ${attributes}><ytm-video-with-context-renderer><a href="/watch?v=abcdefghijk" style="display:block"><img src="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"></a><h3>Video ${id}</h3></ytm-video-with-context-renderer></ytm-rich-item-renderer>`;
}
function setup(t, markup = "", options = {}) {
  const dom = new JSDOM(`<body>${markup}</body>`, {
    url: options.url || "https://m.youtube.com/", runScripts: "outside-only", pretendToBeVisual: true,
  });
  const win = dom.window, doc = win.document;
  const animations = [], frames = new Map(), subscriptions = [], errors = [];
  const rects = new WeakMap(), poses = new WeakMap();
  let serial = 0, geometryReads = 0, matches = 0, documentQueries = 0, now = 0;
  t.after(() => { win.dispatchEvent(new win.Event("pagehide")); dom.window.close(); });
  t.after(() => assert.deepEqual(errors, []));
  win.addEventListener("error", event => { errors.push(event.message); event.preventDefault(); });
  win.webkit = { messageHandlers: options.browser ? {} : {
    langformOpenWatch: { postMessage() {} }, ...(options.player ? { langformPlayer: {} } : {}),
  } };
  win.__langformFeedActive = options.active !== false;
  win.__langformHasOpenOverlay = () => !!options.overlay;
  const preference = { matches: !!options.reduced, addEventListener(_, fn) { this.changed = fn; } };
  win.matchMedia = () => preference;
  win.CSS = { supports: () => !options.unsupported };
  win.requestAnimationFrame = fn => { const id = ++serial; frames.set(id, fn); return id; };
  win.cancelAnimationFrame = id => frames.delete(id);
  win.performance.now = () => now;
  Object.defineProperty(win, "innerWidth", { value: 390 });
  Object.defineProperty(win, "innerHeight", { value: 844 });
  if (options.pointer) win.PointerEvent = win.MouseEvent;
  const Observer = win.MutationObserver;
  win.MutationObserver = class extends Observer {
    observe(node, settings) { subscriptions.push({ node, settings }); super.observe(node, settings); }
  };
  const getStyle = win.getComputedStyle.bind(win);
  win.getComputedStyle = node => {
    const style = getStyle(node);
    return new Proxy(style, { get(target, key) { return key === "scale" && poses.has(node) ? poses.get(node) : target[key]; } });
  };
  const elementMatches = win.Element.prototype.matches;
  win.Element.prototype.matches = function (...args) { matches++; return elementMatches.apply(this, args); };
  const query = doc.querySelectorAll.bind(doc);
  doc.querySelectorAll = (...args) => { documentQueries++; return query(...args); };
  win.Element.prototype.getBoundingClientRect = function () {
    geometryReads++;
    return rects.get(this) || { top: 80, bottom: 340, left: 0, right: 390, width: 390, height: 260 };
  };
  if (!options.noAnimation) win.Element.prototype.animate = function (keyframes, settings) {
    const animation = { node: this, keyframes: JSON.parse(JSON.stringify(keyframes)), settings, cancelled: false,
      cancel() { this.cancelled = true; poses.delete(this.node); }, finish() { if (this.onfinish) this.onfinish(); } };
    animations.push(animation);
    return animation;
  };
  win.eval(source);
  return { win, doc, animations, frames, subscriptions, preference,
    get(id) { return doc.getElementById(id); },
    reveals() { return animations.filter(a => /^YTM-(RICH-ITEM|VIDEO-WITH-CONTEXT|VIDEO|COMPACT-VIDEO|GRID-VIDEO)-RENDERER$/.test(a.node.tagName)); },
    async flush() {
      for (let i = 0; i < 4; i++) await Promise.resolve();
      const batch = [...frames];
      frames.clear();
      for (const [, fn] of batch) fn(now);
      for (let i = 0; i < 4; i++) await Promise.resolve();
    },
    event(name) { win.dispatchEvent(new win.Event(name)); },
    visibility(active) { win.__langformFeedActive = active; this.event("langform-feed-visibility"); },
    reduce(value) { preference.matches = value; preference.changed?.(); },
    rect(id, value) { rects.set(this.get(id), value); },
    pose(id, value) { poses.set(this.get(id), value); },
    advance(value) { now += value; },
    reads() { return { geometryReads, matches, documentQueries }; },
    touch(id, name = "touchstart", values = {}) {
      const event = new win.Event(name, { bubbles: true, cancelable: true });
      const point = { identifier: 1, clientX: 40, clientY: 40, ...values };
      event.touches = name === "touchend" ? [] : [point]; event.changedTouches = [point];
      this.get(id).dispatchEvent(event);
      return event;
    },
    pointer(id, name = "pointerdown", values = {}) {
      const event = new win.Event(name, { bubbles: true, cancelable: true });
      Object.assign(event, { isPrimary: true, button: 0, pointerId: 3, clientX: 40, clientY: 40, ...values });
      this.get(id).dispatchEvent(event);
      return event;
    },
  };
}

test("Feed entrance moves only visible cards together in reading order, and never hides content awaiting discovery", async t => {
  const s = setup(t, card("second") + card("first") + card("below"));
  s.rect("first", { top: 90, bottom: 340, left: 0, right: 390, width: 390, height: 250 });
  s.rect("second", { top: 380, bottom: 630, left: 0, right: 390, width: 390, height: 250 });
  s.rect("below", { top: 900, bottom: 1150, left: 0, right: 390, width: 390, height: 250 });
  assert.equal(s.get("first").getAttribute("style"), null);
  assert.equal(s.animations.length, 0);
  await s.flush();
  assert.deepEqual(s.reveals().map(a => a.node.id), ["first", "second"]);
  assert.ok(s.reveals().every(a => !a.settings.delay), "cards settle together without a cascade");
  assert.ok(s.reveals().every(a => a.settings.duration === 220 && a.settings.fill === "backwards"));
  assert.ok(s.animations.every(a => a.keyframes[0].opacity === undefined || a.keyframes[0].opacity >= .84));
  assert.ok(s.animations.every(a => Object.keys(a.keyframes[0]).every(key => ["translate", "opacity", "scale"].includes(key))));
  s.animations.forEach(a => a.finish());
  assert.ok(s.animations.every(a => a.cancelled));
  assert.equal(s.get("first").getAttribute("style"), null);
  assert.equal(s.frames.size, 0);
  assert.equal(s.reads().documentQueries, 0);
});

test("Metadata hydration and navigation to retained nodes never replay entrances", async t => {
  const s = setup(t, card("one"));
  await s.flush();
  s.animations[0].finish();
  const before = s.reads();
  for (let i = 0; i < 100; i++) s.get("one").querySelector("h3").appendChild(s.doc.createTextNode("."));
  await s.flush();
  assert.deepEqual(s.reads(), before);
  assert.equal(s.reveals().length, 1);
  s.event("state-navigatestart"); s.event("state-navigateend"); await s.flush();
  assert.equal(s.reveals().length, 1);
});

test("An empty renderer animates once when its real watch link arrives", async t => {
  const s = setup(t, '<ytm-video-renderer id="skeleton"></ytm-video-renderer>');
  await s.flush();
  assert.equal(s.animations.length, 0);
  s.get("skeleton").innerHTML = '<a href="/watch?v=abcdefghijk">Result</a>';
  await s.flush();
  assert.equal(s.animations.length, 1);
  assert.equal(s.animations[0].node.id, "skeleton");
});

test("A large mutation batch has a fixed discovery budget and at most three active card animations", async t => {
  const s = setup(t);
  await s.flush();
  const root = s.doc.createElement("section");
  root.innerHTML = Array.from({ length: 1000 }, (_, i) => card("v" + i)).join("");
  s.doc.body.appendChild(root);
  await s.flush();
  assert.equal(s.reveals().length, 3);
  assert.equal(s.animations.length, 3);
  assert.ok(s.reads().geometryReads <= 8);
  assert.ok(s.reads().matches < 100);
  assert.equal(s.reads().documentQueries, 0);
  assert.equal(s.frames.size, 0, "no persistent RAF loop for unseen tail");
});

test("A native-covered feed does no discovery work and cancels decoration immediately", async t => {
  const s = setup(t, card("one"), { active: false });
  await s.flush();
  assert.equal(s.frames.size, 0);
  assert.equal(s.subscriptions.length, 0);
  assert.equal(s.reads().geometryReads, 0);
  s.visibility(true); await s.flush();
  assert.equal(s.reveals().length, 1);
  s.visibility(false);
  assert.ok(s.animations[0].cancelled);
  const before = s.reads();
  s.doc.body.insertAdjacentHTML("beforeend", card("two"));
  await s.flush();
  assert.deepEqual(s.reads(), before);
  s.visibility(true); await s.flush();
  assert.deepEqual(s.reveals().map(a => a.node.id), ["one", "two"]);
});

test("Scrolling settles existing cards and appended results remain stationary during momentum", async t => {
  const s = setup(t, card("one"));
  await s.flush();
  s.event("scroll");
  assert.ok(s.animations[0].cancelled);
  s.doc.body.insertAdjacentHTML("beforeend", card("two"));
  await s.flush();
  assert.equal(s.reveals().length, 1);
  s.advance(200);
  s.doc.body.insertAdjacentHTML("beforeend", card("three"));
  await s.flush();
  assert.deepEqual(s.reveals().map(a => a.node.id), ["one", "three"]);
});

test("Search and filter controls react without intercepting gestures or clicks", async t => {
  const s = setup(t, '<ytm-chip-cloud-chip-renderer id="chip"><button id="button">Podcasts</button></ytm-chip-cloud-chip-renderer>');
  await s.flush();
  let clickCount = 0;
  s.get("button").addEventListener("click", () => clickCount++);
  const down = s.touch("button");
  assert.equal(down.defaultPrevented, false);
  assert.equal(s.animations[0].node.id, "chip");
  assert.deepEqual(s.animations[0].keyframes, [{ scale: "1" }, { scale: ".98" }]);
  s.pose("chip", ".972");
  const up = s.touch("button", "touchend");
  assert.equal(up.defaultPrevented, false);
  assert.ok(s.animations[0].cancelled);
  assert.deepEqual(s.animations[1].keyframes, [{ scale: ".972" }, { scale: "1" }]);
  s.get("button").click();
  assert.equal(clickCount, 1);
  s.animations[1].finish();
  assert.ok(s.animations[1].cancelled);
});

test("Control presses cancel on drag, cancellation, and native feed suspension", async t => {
  const s = setup(t, '<ytm-searchbox><button id="search">Suchen</button></ytm-searchbox>', { pointer: true });
  await s.flush();
  s.pointer("search");
  s.pointer("search", "pointermove", { clientX: 49 });
  assert.ok(s.animations[0].cancelled);
  s.pointer("search", "pointerup");
  assert.equal(s.animations.length, 1);
  s.pointer("search"); s.pointer("search", "pointercancel");
  assert.ok(s.animations[1].cancelled);
  s.pointer("search"); s.visibility(false);
  assert.ok(s.animations[2].cancelled);
});

test("A second press continues the displayed pose while original transforms remain untouched", async t => {
  const s = setup(t, '<ytm-searchbox><button id="search" style="transform:translateX(2px)">Suchen</button></ytm-searchbox>');
  await s.flush();
  s.touch("search"); s.touch("search", "touchend");
  s.pose("search", ".982");
  s.touch("search");
  assert.equal(s.animations[2].keyframes[0].scale, ".982");
  assert.equal(s.get("search").style.transform, "translateX(2px)");
});

test("Existing thumbnail/tab motion, editable fields, disabled controls, and overlays remain owned by their original handlers", async t => {
  const markup = card("one") + '<ytm-pivot-bar-item-renderer><button id="tab">Home</button></ytm-pivot-bar-item-renderer>' +
    '<ytm-searchbox><input id="input"><button id="disabled" disabled>Search</button></ytm-searchbox>' +
    '<ytm-engagement-panel><ytm-searchbox><button id="inside">Reply</button></ytm-searchbox></ytm-engagement-panel>';
  const s = setup(t, markup);
  await s.flush();
  s.animations[0].finish();
  for (const id of ["one", "tab", "input", "disabled", "inside"]) s.touch(id);
  assert.equal(s.reveals().length, 1);
});

test("Touching a feed card settles entrance before native source geometry can be measured", async t => {
  const s = setup(t, card("one"));
  await s.flush();
  let cancelledAtClick = false;
  s.get("one").addEventListener("click", () => { cancelledAtClick = s.animations[0].cancelled; });
  s.touch("one"); s.get("one").click();
  assert.ok(cancelledAtClick);
});

test("Reduce Motion cancels all effects, disconnects discovery, and keeps navigation usable", async t => {
  const s = setup(t, card("one") + '<ytm-searchbox><button id="search">Suchen</button></ytm-searchbox>');
  await s.flush();
  s.touch("search"); s.reduce(true);
  assert.ok(s.animations.every(a => a.cancelled));
  const before = s.reads();
  s.doc.body.insertAdjacentHTML("beforeend", card("two"));
  s.touch("search"); await s.flush();
  assert.deepEqual(s.reads(), before);
  assert.equal(s.frames.size, 0);
  s.touch("search", "touchend");
  s.reduce(false); await s.flush();
  assert.equal(s.reveals().at(-1).node.id, "two");
});

test("Page lifecycle and SPA navigation cancel pending frames and recover on the next active surface", async t => {
  const s = setup(t, card("one"));
  s.event("pagehide");
  assert.equal(s.frames.size, 0);
  await s.flush();
  assert.equal(s.animations.length, 0);
  s.event("pageshow"); await s.flush();
  assert.equal(s.reveals().length, 1);
  s.event("yt-navigate-start");
  assert.ok(s.animations[0].cancelled);
  s.doc.body.innerHTML = card("result");
  await s.flush();
  assert.equal(s.reveals().length, 1);
  s.event("yt-navigate-finish"); await s.flush();
  assert.equal(s.reveals().at(-1).node.id, "result");
});

test("Removed card animations release detached nodes", async t => {
  const s = setup(t, card("one"));
  await s.flush();
  s.get("one").remove();
  await s.flush();
  assert.ok(s.animations[0].cancelled);
});

test("Hidden, transparent, independently translated, Shorts-only, and offscreen cards are never moved", async t => {
  const s = setup(t, card("hidden", "hidden") + card("transparent", 'style="opacity:0"') +
    card("translated", 'style="translate:2px 0px"') + '<ytm-rich-item-renderer id="short"><a href="/shorts/abcdefghijk">Short</a></ytm-rich-item-renderer>');
  await s.flush();
  assert.equal(s.animations.length, 0);
});

for (const options of [{ browser: true }, { player: true }, { url: "https://example.com/" }, { unsupported: true }, { reduced: true }, { noAnimation: true }]) {
  test("Unsupported or ineligible surfaces keep content visible: " + JSON.stringify(options), async t => {
    const s = setup(t, card("one"), options);
    await s.flush();
    assert.equal(s.animations.length, 0);
    assert.equal(s.get("one").getAttribute("style"), null);
    assert.equal(s.get("one").hidden, false);
    assert.equal(s.frames.size, 0);
  });
}


test("Queued entrances yield while the finger is already touching the feed", async t => {
  const s = setup(t, card("one"), { pointer: true });
  s.pointer("one");
  await s.flush();
  assert.equal(s.animations.length, 0);
  s.doc.body.insertAdjacentHTML("beforeend", card("two"));
  await s.flush();
  assert.equal(s.animations.length, 0);
  s.pointer("one", "pointerup");
  s.doc.body.insertAdjacentHTML("beforeend", card("three"));
  await s.flush();
  assert.equal(s.reveals().length, 1);
  assert.equal(s.animations[0].node.id, "three");
});


test("Cards keep thumbnail and title aligned on one short animation without changing DOM or image press properties", async t => {
  const s = setup(t, card("one"));
  const original = s.get("one").outerHTML;
  await s.flush();
  assert.equal(s.animations.length, 1);
  const outer = s.animations[0];
  assert.equal(outer.node, s.get("one"));
  assert.equal(outer.keyframes[0].translate, "0px 8px");
  assert.ok(outer.keyframes.every(frame => frame.scale === undefined), "no thumbnail overshoot or aspect changes");
  assert.equal(s.get("one").outerHTML, original);
  s.touch("one");
  assert.ok(s.animations.every(a => a.cancelled), "finger settles every composited part together");
});

test("Search results stay in place and fade as one surface without delayed title or thumbnail tracks", async t => {
  const s = setup(t, card("result"), { url: "https://m.youtube.com/results?search_query=podcast" });
  await s.flush();
  assert.equal(s.animations.length, 1);
  assert.deepEqual(s.animations[0].keyframes, [{ translate: "0px 0px", opacity: .94 }, { translate: "0px 0px", opacity: 1 }]);
  assert.equal(s.animations[0].settings.duration, 160);
  assert.equal(s.get("result").style.opacity, "");
});

const searchMarkup = '<ytm-searchbox><form><div class="searchbox-input-wrapper" id="shell"><input type="search" name="search_query" id="query"></div></form></ytm-searchbox><button id="elsewhere">Other</button>';

test("Search focus fades a neutral decorative edge while the input stays stationary during typing", async t => {
  const s = setup(t, searchMarkup);
  await s.flush();
  s.get("query").focus();
  assert.equal(s.doc.activeElement, s.get("query"));
  assert.equal(s.animations.length, 1);
  assert.equal(s.animations[0].node, s.get("langform-search-focus-halo"));
  assert.equal(s.animations[0].settings.duration, 160);
  assert.ok(s.animations[0].keyframes.every(frame => frame.scale === undefined && frame.translate === undefined), "no focus lift or bounce");
  assert.ok(!!s.get("langform-search-focus-halo"));
  s.get("query").value = "Ein langer Gedanke";
  s.get("query").dispatchEvent(new s.win.Event("input", { bubbles: true }));
  await s.flush();
  assert.equal(s.animations.length, 1);
  s.animations[0].finish();
  assert.ok(s.animations[0].cancelled);
  assert.ok(!!s.get("langform-search-focus-halo"));
  assert.equal(s.get("query").value, "Ein langer Gedanke");
  s.get("elsewhere").focus();
  assert.equal(!!s.get("langform-search-focus-halo"), false);
  assert.equal(s.get("shell").getAttribute("style"), null);
});

test("Native cover, Reduce Motion and keyboard resize settle search lift without losing input focus", async t => {
  const s = setup(t, searchMarkup);
  await s.flush();
  s.get("query").focus();
  s.event("resize");
  assert.ok(s.animations[0].cancelled);
  assert.equal(s.doc.activeElement, s.get("query"));
  assert.equal(s.get("langform-search-focus-halo"), null);
  s.visibility(false);
  assert.equal(!!s.get("langform-search-focus-halo"), false);
  s.get("elsewhere").focus();s.visibility(true);s.reduce(true);s.get("query").focus();
  assert.equal(s.animations.length, 1);
  assert.equal(!!s.get("langform-search-focus-halo"), false);
});

test("A thumbnail link containing title text is never separately scaled", async t => {
  const s = setup(t, '<ytm-video-renderer id="one"><a href="/watch?v=abcdefghijk"><img><h3>Headline</h3></a></ytm-video-renderer>');
  await s.flush();
  assert.equal(s.animations.length, 1);
  assert.ok(s.animations.every(a => a.node.tagName !== "A"));
});


test("Inline thumbnail anchors are not promoted or mistaken for a visible scale effect", async t => {
  const s = setup(t, '<ytm-video-renderer id="one"><a style="display:inline" href="/watch?v=abcdefghijk"><img></a><h3>Headline</h3></ytm-video-renderer>');
  await s.flush();
  assert.equal(s.animations.length, 1);
  assert.ok(s.animations.every(a => a.node.tagName !== "A" && a.node.tagName !== "IMG"));
  assert.equal(s.get("one").querySelector("a").style.display, "inline");
});


test("Focused search never animates the input shell or alters hit testing, and input events settle only its decorative halo", async t => {
  const s = setup(t, searchMarkup, { pointer: true });
  await s.flush();
  const original = s.get("shell").outerHTML;
  s.get("query").focus();
  const halo = s.get("langform-search-focus-halo");
  assert.equal(halo.style.pointerEvents, "none");
  assert.equal(halo.getAttribute("aria-hidden"), "true");
  assert.equal(s.get("shell").outerHTML, original);
  assert.ok(s.animations.every(a => a.node === halo));
  const down = s.pointer("query");
  assert.ok(s.animations[0].cancelled);
  assert.equal(down.defaultPrevented, false);
  s.get("elsewhere").focus();s.get("query").focus();
  const input = new s.win.Event("beforeinput", { bubbles: true, cancelable: true });
  s.get("query").dispatchEvent(input);
  assert.ok(s.animations[1].cancelled);
  assert.equal(input.defaultPrevented, false);
  assert.equal(s.doc.activeElement, s.get("query"));
  assert.equal(s.get("shell").outerHTML, original);
});


test("Removing a focused search shell releases its halo even without a blur event", async t => {
  const s = setup(t, searchMarkup);
  await s.flush();
  s.get("query").focus();
  assert.ok(s.get("langform-search-focus-halo"));
  s.get("shell").remove();
  await s.flush();
  assert.equal(s.get("langform-search-focus-halo"), null);
  assert.ok(s.animations.every(a => a.cancelled));
});

test("Offscreen hydration has a hard eight-measurement budget even when no visible candidates are found", async t => {
  const s = setup(t);
  await s.flush();
  const root = s.doc.createElement("section");
  root.innerHTML = Array.from({ length: 100 }, (_, i) => card("below" + i)).join("");
  s.doc.body.appendChild(root);
  for (let i = 0; i < 100; i++) s.rect("below" + i, { top: 5000 + i * 300, bottom: 5260 + i * 300, left: 0, right: 390, width: 390, height: 260 });
  const before = s.reads().geometryReads;
  await s.flush();
  const reads = s.reads().geometryReads - before;
  t.diagnostic("offscreen hydration geometry reads: " + reads);
  assert.ok(reads <= 8, "offscreen cards consume the same bounded layout-read budget as visible ones");
  assert.equal(s.animations.length, 0);
});

test("A full entrance group does not measure another hydration batch that cannot animate", async t => {
  const s = setup(t, card("one") + card("two") + card("three"));
  await s.flush();
  assert.equal(s.reveals().length, 3);
  const before = s.reads().geometryReads;
  const root = s.doc.createElement("section");
  root.innerHTML = Array.from({ length: 40 }, (_, i) => card("pending" + i)).join("");
  s.doc.body.appendChild(root);
  await s.flush();
  const reads = s.reads().geometryReads - before;
  t.diagnostic("saturated entrance group geometry reads: " + reads);
  assert.equal(reads, 0);
  assert.equal(s.reveals().length, 3);
});

test("Keyboard or accessibility focus immediately settles a moving video link and all its parts", async t => {
  const s = setup(t, card("one"));
  await s.flush();
  const link = s.get("one").querySelector("a");
  let clicks = 0;
  link.addEventListener("click", event => { event.preventDefault(); clicks++; });
  link.focus();
  t.diagnostic("active effects after keyboard focus: " + s.animations.filter(a => !a.cancelled).length);
  assert.equal(s.doc.activeElement, link);
  assert.ok(s.animations.every(a => a.cancelled), "the focused target must stop moving without waiting for a pointerdown");
  link.click();
  assert.equal(clicks, 1);
});

test("A link focused before queued discovery remains at rest while sibling cards can enter", async t => {
  const s = setup(t, card("focused") + card("sibling"));
  const link = s.get("focused").querySelector("a");
  link.focus();
  await s.flush();
  assert.equal(s.doc.activeElement, link);
  assert.deepEqual(s.reveals().map(a => a.node.id), ["sibling"]);
});

test("Budget-skipped offscreen cards stay visible and usable after scrolling with no follow-up frame loop", async t => {
  const s = setup(t);
  await s.flush();
  const root = s.doc.createElement("section");
  root.innerHTML = Array.from({ length: 100 }, (_, i) => card("off" + i)).join("");
  s.doc.body.appendChild(root);
  for (let i = 0; i < 100; i++) s.rect("off" + i, { top: 5000 + i * 300, bottom: 5260 + i * 300, left: 0, right: 390, width: 390, height: 260 });
  const target = s.get("off30"), markup = target.outerHTML;
  await s.flush();
  const reads = s.reads().geometryReads;
  s.rect("off30", { top: 100, bottom: 360, left: 0, right: 390, width: 390, height: 260 });
  s.event("scroll");s.advance(500);
  for (let i = 0; i < 10; i++) await s.flush();
  assert.equal(s.frames.size, 0);
  assert.equal(s.reads().geometryReads, reads, "scrolling never schedules reveal geometry reads");
  assert.equal(s.animations.length, 0);
  assert.equal(target.outerHTML, markup, "no reveal CSS can strand budget-skipped content in an invisible state");
  assert.equal(target.hidden, false);
  const link = target.querySelector("a");let opened = 0;
  link.addEventListener("click", event => { opened++;event.preventDefault(); });
  link.focus();link.click();
  assert.equal(s.doc.activeElement, link);
  assert.equal(opened, 1);
});

for (const field of ['<input name="search_query" id="modern-query">', '<textarea name="search_query" id="modern-query"></textarea>']) {
  test("Current YouTube search preserves suggestions, query and submit behavior: " + field, async t => {
    const markup = '<yt-searchbox><div class="ytSearchboxComponentInputBox" id="modern-shell"><form action="/results" id="modern-form">' + field + '<button type="submit" id="modern-submit">Search</button></form></div><div role="listbox" id="suggestions">Suggestion</div></yt-searchbox>';
    const s = setup(t, markup);
    await s.flush();
    const original = s.get("modern-shell").outerHTML;
    let submissions = 0;
    s.get("modern-form").addEventListener("submit", event => { submissions++; event.preventDefault(); });
    s.get("modern-query").value = "Lange Gespräche";
    s.get("modern-query").focus();
    const halo = s.get("langform-search-focus-halo");
    assert.ok(halo, "both current input and multiline search get the same focus feedback");
    assert.equal(halo.style.pointerEvents, "none");
    assert.equal(halo.style.boxShadow, "");
    assert.ok(s.animations.every(animation => animation.keyframes.every(frame => !frame.translate && !frame.scale)));
    s.get("modern-submit").click();
    assert.equal(submissions, 1);
    assert.equal(s.get("modern-query").value, "Lange Gespräche");
    assert.equal(s.get("suggestions").textContent, "Suggestion");
    assert.equal(s.get("modern-shell").outerHTML, original);
  });
}
