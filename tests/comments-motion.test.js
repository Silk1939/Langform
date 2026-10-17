const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const app = path.join(__dirname, "../ios/Langform/Langform");
const links = fs.readFileSync(path.join(app, "WebViewLinks.js"), "utf8");
const motion = fs.readFileSync(path.join(app, "CommentsMotion.js"), "utf8");

// Structure and close wrapper from the mobile site's g8NBcb renderer. Its
// comment-item-section continuationUrl and ZN0EBb header identify comments;
// the identically shaped playlist/description panels must remain untouched.
const comments = `<ytm-engagement-panel-section-list-renderer class="comment-item-section">
  <div class="engagement-panel-section-list-background draggable at-top">
    <div class="engagement-panel-container" style="height:100%;transform:translateY(0px)">
      <div class="engagement-panel-section-list-header-wrapper">
        <div class="engagement-panel-section-list-header">
          <h2 class="engagement-panel-section-list-header-title">Kommentare</h2>
          <ytm-button-renderer class="engagement-panel-section-list-header-button close-button"><button aria-label="Schließen"><span>×</span></button></ytm-button-renderer>
        </div>
      </div>
      <div class="engagement-panel-content-wrapper"><ytm-comments-header-renderer></ytm-comments-header-renderer><button id="reply">Antworten</button></div>
    </div>
  </div>
</ytm-engagement-panel-section-list-renderer>`;
// Ebb, the mobile app's visible fallback while g8NBcb loads on first open.
const skeleton = `<div class="engagement-panel-section-list-background draggable">
  <div class="engagement-panel-container"><div class="engagement-panel-section-list-header-wrapper">
    <div class="engagement-panel-drag-line"></div><div class="engagement-panel-section-list-header">
      <h2 class="engagement-panel-section-list-header-title-ghost-card">&nbsp;</h2>
    </div></div><div class="engagement-panel-content-wrapper"><div class="spinner"></div></div>
  </div></div>`;

function dragEvent(env, target, name, x, y, options = {}) {
  // Ordinary fixture contacts are deliberate slow pulls. CPU scheduling is
  // not gesture time; explicit Fling/readback tests retain their own clocks.
  const { elapsedMs = name === 'pointermove' ? 200 : /up|cancel$/.test(name) ? 50 : 0, ...eventOptions } = options;
  env.advance(elapsedMs);
  const event = new env.win.Event(name, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: options.id || 31, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y, ...eventOptions });
  target.dispatchEvent(event);
  return event;
}

function setup(t, options = {}) {
  const dom = new JSDOM('<div id="movie_player"><video></video></div><button id="open">Kommentare</button><panel-container></panel-container>', {
    url: options.url || "https://m.youtube.com/watch?v=abcdefghijk", runScripts: "outside-only",
  });
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document;
  let fixtureTime = 1000;
  Object.defineProperty(win.performance, 'now', { configurable: true, value: () => fixtureTime });
  const errors = [];
  win.addEventListener("error", event => { errors.push(event.message); event.preventDefault(); });
  t.after(() => assert.deepEqual(errors, [], "kein abgefangener Fehler in Original- oder Dekorationshandlern"));
  win.visualViewport = new win.EventTarget();
  const animations = [], messages = [], timers = new Map(), subscriptions = [];
  let serial = 0, styleReads = 0, geometryReads = 0, queries = 0;
  const poses = new WeakMap(), geometry = new WeakMap();
  const preference = { matches: !!options.reduced, addEventListener(name, fn) { this.changed = fn; } };
  win.matchMedia = () => preference;
  win.CSS = { supports: () => options.noTranslate !== true };
  win.setTimeout = (fn, delay) => { const id = ++serial; timers.set(id, { fn, delay }); return id; };
  win.clearTimeout = id => timers.delete(id);
  const Observer = win.MutationObserver;
  win.MutationObserver = class extends Observer {
    observe(node, settings) { subscriptions.push({ node, settings }); super.observe(node, settings); }
  };
  const getStyle = win.getComputedStyle.bind(win);
  win.getComputedStyle = node => {
    styleReads++;
    const style = getStyle(node), pose = poses.get(node);
    return pose === undefined ? style : new Proxy(style, { get(target, key) { return key === "translate" ? pose : target[key]; } });
  };
  const query = win.Element.prototype.querySelector;
  win.Element.prototype.querySelector = function (selector) { queries++; return query.call(this, selector); };
  Object.defineProperty(win, "innerHeight", { value: 844, writable: true });
  win.Element.prototype.getBoundingClientRect = function () {
    geometryReads++;
    assert.ok(this.classList.contains("engagement-panel-container"), "nur die bewegte Kommentarfläche braucht eine einmalige Messung");
    return geometry.get(this) || { x: 0, y: 220, left: 0, top: 220, right: 390, bottom: 844, width: 390, height: 624 };
  };
  if (!options.noAnimation) win.Element.prototype.animate = function (frames, settings) {
    if (options.onAnimate) options.onAnimate(this);
    const animation = { node: this, frames: JSON.parse(JSON.stringify(frames)), settings, cancelled: false, onfinish: null,
      currentTime: 0, playbackRate: 1, rates: [], playState: "running",
      effect: { getTiming() { return settings; } },
      updatePlaybackRate(rate) { this.playbackRate = rate; this.rates.push(rate); },
      cancel() { this.cancelled = true; this.playState = "idle"; },
      finish() { this.currentTime = settings.duration; this.playState = "finished"; if (this.onfinish) this.onfinish(); } };
    animations.push(animation);
    return animation;
  };
  win.webkit = { messageHandlers: {
    langformOverlayState: { postMessage(value) { messages.push(JSON.parse(JSON.stringify(value))); } },
    ...(options.feed ? { langformOpenWatch: { postMessage() {} } } : { langformPlayer: { postMessage() {} } }),
  } };
  win.eval(links);
  win.eval(motion);
  return { win, doc, animations, messages, timers, subscriptions, preference,
    advance(milliseconds) { assert.ok(Number.isFinite(milliseconds) && milliseconds >= 0); fixtureTime += milliseconds; },
    reads: () => ({ styleReads, geometryReads, queries }),
    pose(node, value) { poses.set(node, value); },
    rect(node, value) { geometry.set(node, value); },
    touch(node, name = "touchstart") {
      const event = new win.Event(name, { bubbles: true, cancelable: true });
      event.touches = [{ identifier: 1, clientX: 100, clientY: 400 }];
      node.dispatchEvent(event);
      return event;
    },
    async flush() { for (let i = 0; i < 4; i++) await Promise.resolve(); },
    mount(markup = comments) {
      const node = doc.createElement("ytm-engagement-panel");
      node.innerHTML = markup;
      doc.querySelector("panel-container").appendChild(node);
      return node;
    },
    push(markup = comments, panelIdentifier = "comment-item-section") {
      win.dispatchEvent(new win.CustomEvent("engagement-panel-push", { detail: {
        identifier: panelIdentifier,
        wF: { engagementPanelSectionListRenderer: { panelIdentifier: panelIdentifier } },
      } }));
      return this.mount(markup);
    },
    expireDiscovery() {
      for (const [id, timer] of timers) if (timer.delay === 2000) { timers.delete(id); timer.fn(); }
    },
    expireCloseGuard() {
      for (const [id, timer] of timers) if (timer.delay === 500) { timers.delete(id); timer.fn(); }
    },
  };
}

test("reale Kommentarfläche erhält genau einen Eintritt; Medien und YouTube-Dragstyle bleiben unverändert", async t => {
  const env = setup(t);
  const panel = env.mount();
  const inner = panel.querySelector(".engagement-panel-container");
  const before = inner.getAttribute("style");
  await env.flush();
  assert.equal(env.animations.length, 1);
  const animation = env.animations[0];
  assert.equal(animation.node, inner);
  assert.equal(animation.settings.duration, 300);
  assert.deepEqual(animation.frames.map(frame => Object.keys(frame)), [["translate"], ["translate"]]);
  assert.equal(env.win.__langformHasOpenOverlay(), true);
  animation.finish();
  assert.equal(animation.cancelled, true, "keine dauerhafte compositor fill-Schicht");
  assert.equal(panel.getAttribute("style"), null);
  assert.equal(inner.getAttribute("style"), before);
  assert.equal(env.doc.querySelectorAll("video").length, 1);
});

test("erstes Öffnen animiert die echte YouTube-Shell sofort und Hydration setzt weder Opazität noch Bewegung zurück", async t => {
  const env = setup(t), panel = env.push(skeleton); await env.flush();
  assert.equal(env.animations.length, 1, "Eintritt beginnt mit der sichtbaren Shell, ohne auf das Lazy-Modul zu warten");
  const entrance = env.animations[0];
  assert.equal(entrance.node, panel.querySelector(".engagement-panel-container"));
  entrance.currentTime = 190;
  panel.innerHTML = comments; await env.flush();
  assert.equal(env.animations.length, 2, "der Ersatzknoten übernimmt einen neuen Effekt auf derselben Timeline");
  assert.equal(entrance.cancelled, true);
  const replacement = env.animations[1];
  assert.equal(replacement.node, panel.querySelector(".engagement-panel-container"));
  assert.equal(replacement.currentTime, 190, "nur die verbleibenden 110ms weiterlaufen");
  assert.equal(replacement.settings.duration, 300);
  replacement.finish();
  let closes = 0; panel.querySelector("button").addEventListener("click", () => { closes++; panel.remove(); });
  panel.querySelector("button").click(); env.animations.at(-1).finish(); await env.flush();
  assert.equal(closes, 1);
});

test('aktueller öffentlicher NF-Push animiert die Lazy-Shell vor Hydration und erhält die gemeinsame Timeline', async t => {
  const env=setup(t);
  env.win.dispatchEvent(new env.win.CustomEvent('engagement-panel-push',{detail:{identifier:'engagement-panel-comments-section',NF:{engagementPanelSectionListRenderer:{panelIdentifier:'engagement-panel-comments-section'}}}}));
  const panel=env.mount(skeleton);await env.flush();assert.equal(env.animations.length,1,'NF-Intent muss vor dem ersten Shellframe bekannt sein');
  const entrance=env.animations[0];assert.equal(entrance.frames[0].translate,'0px 626px');entrance.currentTime=150;
  panel.innerHTML=comments;await env.flush();assert.equal(env.animations.length,2);assert.equal(env.animations[1].currentTime,150);
  env.animations[1].finish();assert.equal(panel.querySelector('.engagement-panel-container').style.translate,'');
});

test("Hydration übernimmt den endlichen Timeline-Ursprung samt Tempo statt eines veralteten Sampling-Ticks", async t => {
  for (const startTime of [0, 1200]) {
    const env = setup(t), panel = env.push(skeleton); await env.flush();
    const entrance = env.animations[0];
    entrance.startTime = startTime;
    entrance.currentTime = 190; // Last rendering tick; document timeline keeps advancing.
    entrance.playbackRate = 2;
    const staleFinish = entrance.onfinish;
    panel.innerHTML = comments; await env.flush();
    const replacement = env.animations[1];
    assert.equal(entrance.cancelled, true);
    assert.equal(replacement.startTime, startTime, "auch Ursprung 0 ist eine gültige Timeline-Zeit");
    assert.equal(replacement.playbackRate, 2);
    const documentTimeAtNextFrame = startTime + 110;
    assert.equal((documentTimeAtNextFrame - replacement.startTime) * replacement.playbackRate, 220,
      "der nächste Frame folgt der fortlaufenden Zeit statt zurück auf den alten 190ms-Tick zu springen");
    assert.equal(replacement.rates.length, 0, "kein zusätzlicher asynchroner Tempoabgleich nach dem übernommenen Ursprung");
    staleFinish();
    assert.equal(replacement.cancelled, false);
  }
});

test("sehr spät geladene Kommentare blenden eine bereits sichtbare Shell nicht nochmals aus", async t => {
  const env = setup(t), panel = env.push(skeleton); await env.flush();
  assert.equal(env.animations.length, 1);
  env.animations[0].finish(); env.expireDiscovery();
  panel.innerHTML = comments; await env.flush();
  assert.equal(env.animations.length, 1);
  assert.equal(panel.getAttribute("style"), null);
  assert.equal(env.win.__langformHasOpenOverlay(), true);
});

test("ein Rendererwechsel innerhalb eines sichtbaren Panels erhält die laufende Eintrittsbewegung", async t => {
  const env = setup(t), panel = env.mount(); await env.flush();
  const entrance = env.animations[0];
  entrance.currentTime = 250;
  panel.innerHTML = comments; await env.flush();
  assert.equal(env.animations.length, 2, "der neue Renderer übernimmt die vorhandene Bewegung");
  assert.equal(entrance.cancelled, true);
  assert.equal(env.animations[1].currentTime, 250);
});

test("der Push wird vor YouTubes Mount-Handler erkannt und gestapelte Paneltypen bleiben getrennt", async t => {
  const env = setup(t);
  env.win.addEventListener("engagement-panel-push", () => env.mount(skeleton));
  for (const id of ["playlist", "comment-item-section"]) env.win.dispatchEvent(new env.win.CustomEvent("engagement-panel-push", { detail: {
    identifier: id, wF: { engagementPanelSectionListRenderer: { panelIdentifier: id } },
  } }));
  await env.flush();
  const panels = env.doc.querySelectorAll("ytm-engagement-panel");
  assert.equal(env.animations.length, 1);
  assert.equal(env.animations[0].node, panels[1].querySelector(".engagement-panel-container"), "nur der zweite Push gehört zur Kommentar-Shell");
  panels[0].innerHTML = comments.replace('class="comment-item-section"', 'class="playlist"').replace('<ytm-comments-header-renderer></ytm-comments-header-renderer>', '');
  panels[1].innerHTML = comments; await env.flush();
  assert.equal(env.animations.length, 2);
  assert.equal(env.animations[1].node, panels[1].querySelector(".engagement-panel-container"));
});

test("vor Mount abgebrochene Pushs übertragen die Kommentarintention nicht auf ein anderes Panel", async t => {
  for (const cancellation of ["engagement-panel-pop", "state-navigatestart", "yt-navigate-start"]) {
    const env = setup(t);
    env.win.dispatchEvent(new env.win.CustomEvent("engagement-panel-push", { detail: {
      identifier: "comment-item-section", wF: { engagementPanelSectionListRenderer: { panelIdentifier: "comment-item-section" } },
    } }));
    env.win.dispatchEvent(new env.win.CustomEvent(cancellation, { detail: { identifier: "comment-item-section" } }));
    env.mount(skeleton); await env.flush();
    assert.equal(env.animations.length, 0, cancellation + " verwirft den ungemounteten Kommentar-Push");
  }
});

test("ein schneller Pop entfernt nur die oberste noch unerkannte Push-Intention", async t => {
  const env = setup(t), first = env.push(skeleton), second = env.push(skeleton);
  env.win.dispatchEvent(new env.win.CustomEvent("engagement-panel-pop", { detail: { identifier: "comment-item-section" } }));
  second.remove(); await env.flush();
  assert.equal(env.animations.length, 1, "gleiche Identifier in zwei Pushs dürfen den verbleibenden ersten Eintritt nicht verlieren");
  assert.equal(env.animations[0].node, first.querySelector(".engagement-panel-container"));
});

test("ein Pop für ein unteres Panel verändert die noch offenen Pushs nicht", async t => {
  const env = setup(t), first = env.push(skeleton), second = env.push(skeleton, "playlist");
  env.win.dispatchEvent(new env.win.CustomEvent("engagement-panel-pop", { detail: { identifier: "comment-item-section" } }));
  await env.flush();
  assert.equal(env.animations.length, 1);
  assert.equal(env.animations[0].node, first.querySelector(".engagement-panel-container"));
  assert.equal(second.isConnected, true);
});

test("Berührung während des ersten Skeleton-Eintritts bleibt unmittelbar und Hydration startet ihn nicht erneut", async t => {
  const env = setup(t), panel = env.push(skeleton); await env.flush();
  const inner = panel.querySelector(".engagement-panel-container");
  const entrance = env.animations[0]; entrance.currentTime = 175;
  inner.style.transform = "translateY(37px)";
  let touches = 0; inner.addEventListener("touchstart", () => touches++);
  const touch = env.touch(inner);
  assert.equal(touches, 1);
  assert.equal(touch.defaultPrevented, false);
  assert.equal(entrance.cancelled, false, "Berührung darf die laufende Position nicht zum Endzustand springen lassen");
  assert.equal(entrance.playbackRate, 2);
  assert.equal(entrance.currentTime, 175);
  assert.equal(inner.style.transform, "translateY(37px)", "die Originalgeste behält ihren eigenen Dragzustand");
  panel.innerHTML = comments; await env.flush();
  assert.equal(env.animations.length, 2, "Hydration überträgt den Effekt auf die neue Fläche");
  assert.equal(env.animations[1].currentTime, 175);
  assert.equal(env.animations[1].playbackRate, 2, "beschleunigte Restzeit bleibt erhalten");
});

test("ein tatsächlich verstecktes Skeleton erhält bei erneutem Öffnen einen neuen Eintritt", async t => {
  const env = setup(t);let now=1000;Object.defineProperty(env.win.performance,"now",{configurable:true,value:()=>now});const panel = env.push(skeleton); await env.flush();
  const oldFinish = env.animations[0].onfinish;
  now=1500;panel.hidden = true; await env.flush(); panel.hidden = false; await env.flush(); oldFinish();
  assert.equal(env.animations.length, 2);
  assert.equal(env.animations[0].cancelled, true);
  assert.equal(env.animations[1].cancelled, false);
  now=1580;panel.innerHTML = comments; await env.flush();
  assert.equal(env.animations.length, 3, "Hydration überträgt nur den laufenden neuen Eintritt");
  assert.equal(env.animations[2].currentTime,80,"nur80ms seit dem neuen Eintritt, nicht die alte500ms-Pause");
});

test("Reduce Motion und fehlende WAAPI gelten bereits für die kalte Kommentar-Shell", async t => {
  for (const options of [{ reduced: true }, { noAnimation: true }, { noTranslate: true }]) {
    const env = setup(t, options), panel = env.push(skeleton); await env.flush();
    panel.innerHTML = comments; await env.flush();
    let closes = 0; panel.querySelector("button").addEventListener("click", () => closes++);
    panel.querySelector("button").click();
    assert.equal(closes, 1);
    assert.equal(env.animations.length, 0);
    assert.equal(panel.getAttribute("style"), null);
  }
});

test("Viewport und Reduce-Motion-Wechsel während der kalten Shell bleiben auch nach Hydration sofort übergeben", async t => {
  for (const mode of ["viewport", "reduce"]) {
    const env = setup(t), panel = env.push(skeleton); await env.flush();
    const staleFinish = env.animations[0].onfinish;
    if (mode === "viewport") env.win.visualViewport.dispatchEvent(new env.win.Event("resize"));
    else { env.preference.matches = true; env.preference.changed(); }
    assert.equal(env.animations[0].cancelled, true);
    panel.innerHTML = comments; await env.flush(); staleFinish();
    assert.equal(env.animations.length, 1, "Hydration darf die abgegebene Bewegung nicht wieder übernehmen");
    assert.equal(panel.getAttribute("style"), null);
    assert.equal(env.win.__langformHasOpenOverlay(), true);
  }
});

test("X animiert 180ms und löst den bestehenden Schließknopf genau einmal aus", async t => {
  const env = setup(t), panel = env.mount();
  await env.flush(); env.animations[0].finish();
  const button = panel.querySelector(".close-button button");
  let closes = 0;
  button.addEventListener("click", () => { closes++; panel.remove(); });
  button.querySelector("span").click();
  button.click();
  assert.equal(closes, 0);
  assert.equal(env.animations.length, 2, "Doppeltipp startet keinen zweiten Abschluss");
  assert.equal(env.animations[1].settings.duration, 180);
  assert.equal(env.win.__langformHasOpenOverlay(), true, "native Playergeste bleibt bis zum echten Entfernen gesperrt");
  env.animations[1].finish(); await env.flush();
  assert.equal(closes, 1);
  assert.equal(env.win.__langformHasOpenOverlay(), false);
  assert.equal(env.animations[1].cancelled, true);
});

test("Berührung beschleunigt den Rest ohne Sprung; Scrollen und Nachladen starten keine Arbeit neu", async t => {
  const env = setup(t), panel = env.mount();
  await env.flush(); env.expireDiscovery();
  let originalTouches = 0;
  const content = panel.querySelector(".engagement-panel-content-wrapper");
  content.addEventListener("touchstart", () => originalTouches++);
  const event = env.touch(content);
  assert.equal(event.defaultPrevented, false);
  assert.equal(originalTouches, 1);
  assert.equal(env.animations[0].cancelled, false);
  assert.equal(env.animations[0].playbackRate, 2);
  const before = env.reads();
  for (let i = 0; i < 50; i++) {
    content.dispatchEvent(new env.win.Event("scroll", { bubbles: true }));
    content.appendChild(env.doc.createElement("ytm-comment-thread-renderer"));
  }
  await env.flush();
  assert.deepEqual(env.reads(), before);
  assert.equal(env.animations.length, 1);
  assert.equal(env.timers.size, 0);
  assert.equal(env.subscriptions.filter(s => s.node === panel).at(-1).settings.subtree, undefined);
});

test("Tastatur-/Viewportwechsel übergibt einen laufenden Eintritt ohne Scroll-, Fokus- oder Medienänderung", async t => {
  for (const [target, name] of [["viewport", "resize"], ["window", "resize"], ["window", "orientationchange"]]) {
    const env = setup(t), panel = env.mount(); await env.flush();
    const content = panel.querySelector(".engagement-panel-content-wrapper");
    content.scrollTop = 321;
    const input = env.doc.createElement("textarea"); content.appendChild(input); input.focus();
    const video = env.doc.querySelector("video");
    video.play = video.pause = () => assert.fail("Viewportbewegung darf Wiedergabe nicht verändern");
    const inner = panel.querySelector(".engagement-panel-container"), style = inner.getAttribute("style");
    const before = env.reads(), staleFinish = env.animations[0].onfinish;
    const event = new env.win.Event(name, { cancelable: true });
    (target === "viewport" ? env.win.visualViewport : env.win).dispatchEvent(event);
    assert.equal(env.animations[0].cancelled, true, name + " beendet die konkurrierende Dekoration");
    staleFinish();
    assert.equal(event.defaultPrevented, false);
    assert.equal(content.scrollTop, 321);
    assert.equal(env.doc.activeElement, input);
    assert.equal(inner.getAttribute("style"), style);
    assert.equal(panel.getAttribute("style"), null);
    assert.equal(env.win.__langformHasOpenOverlay(), true);
    assert.deepEqual(env.reads(), before, "Übergabe braucht keine Layoutmessung oder DOM-Suche");
  }
});

test("Tastaturwechsel während X schließt genau einmal, auch bei mehrfachen Resize-Ereignissen", async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  let closes = 0;
  panel.querySelector("button").addEventListener("click", () => { closes++; panel.hidden = true; });
  panel.querySelector("button").click();
  const exit = env.animations[1], staleFinish = exit.onfinish;
  env.win.visualViewport.dispatchEvent(new env.win.Event("resize"));
  env.win.dispatchEvent(new env.win.Event("resize"));
  env.win.dispatchEvent(new env.win.Event("orientationchange"));
  assert.equal(closes, 1, "Viewportwechsel beendet X sofort, nicht erst ein verspätetes onfinish");
  assert.equal(exit.cancelled, true);
  staleFinish(); await env.flush();
  assert.equal(closes, 1);
  assert.equal(exit.cancelled, true);
  assert.equal(env.win.__langformHasOpenOverlay(), false);
  assert.equal(env.animations.length, 2, "kein zweiter Ein- oder Austritt beim Keyboardwechsel");
});

test("Viewportwechsel im ruhenden Kommentarblatt verursacht keine Animations- oder Scanarbeit", async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish(); env.expireDiscovery();
  const content = panel.querySelector(".engagement-panel-content-wrapper"); content.scrollTop = 175;
  const before = env.reads();
  for (let i = 0; i < 30; i++) env.win.visualViewport.dispatchEvent(new env.win.Event("resize"));
  assert.deepEqual(env.reads(), before);
  assert.equal(env.animations.length, 1);
  assert.equal(content.scrollTop, 175);
  assert.equal(env.timers.size, 0);
});

test("verzögertes Comments-Modul wird am sichtbaren Panel erkannt, ohne es über continuationUrl neu einzublenden", async t => {
  const env = setup(t), panel = env.mount('<div class="engagement-panel-section-list-background"><div class="spinner"></div></div>');
  await env.flush();
  assert.equal(env.animations.length, 0);
  panel.innerHTML = comments.replace('class="comment-item-section"', '').replace('<ytm-comments-header-renderer></ytm-comments-header-renderer>', '');
  panel.firstElementChild.continuationUrl = "/watch_comment?action_get_comments=1";
  await env.flush();
  assert.equal(env.animations.length, 0, "eine ohne Push bereits sichtbare Shell darf nicht nachträglich von opacity 0 starten");
  assert.equal(env.subscriptions.filter(s => s.node === panel).at(-1).settings.subtree, undefined);
  let closes = 0; panel.querySelector("button").addEventListener("click", () => closes++);
  panel.querySelector("button").click(); env.animations[0].finish();
  assert.equal(closes, 1, "Erkennung erhält die X-Bewegung trotz ausgelassenem verspätetem Eintritt");
});

test("ein leerer Kommentar-Push wartet auf die erste echte Fläche auch bei später tiefer Hydration", async t => {
  const env = setup(t), panel = env.push('<div class="shell"><div class="loader"></div></div>');
  await env.flush();
  assert.equal(env.animations.length, 0, "ohne reale Kommentarfläche wird weder äußerer Container noch Spinner animiert");
  for (const [id, timer] of env.timers) { env.timers.delete(id); timer.fn(); }
  assert.equal(env.timers.size, 0, "kein Timer beendet die Erkennung auf langsamen Verbindungen");
  panel.querySelector(".loader").innerHTML = comments;
  await env.flush();
  assert.equal(env.animations.length, 1);
  assert.equal(env.subscriptions.filter(s => s.node === panel).at(-1).settings.subtree, undefined);
});

test("ähnliche Beschreibungs-, Playlist- und generische Menüs werden nicht animiert oder verzögert", async t => {
  const env = setup(t);
  const panel = env.mount(comments.replace('class="comment-item-section"', 'class="playlist"').replace('<ytm-comments-header-renderer></ytm-comments-header-renderer>', ''));
  await env.flush();
  let clicks = 0;
  panel.querySelector("button").addEventListener("click", () => clicks++);
  panel.querySelector("button").click();
  assert.equal(clicks, 1);
  assert.equal(env.animations.length, 0);
  panel.remove(); await env.flush();
  assert.equal(env.animations.length, 0);
});

test("entferntes oder neu geöffnetes Panel kann keinen alten Abschluss auslösen", async t => {
  const env = setup(t), first = env.mount();
  await env.flush(); env.animations[0].finish();
  let closes = 0;
  const button = first.querySelector("button"); button.addEventListener("click", () => closes++);
  button.click();
  const staleFinish = env.animations[1].onfinish;
  first.remove(); await env.flush();
  const second = env.mount(); await env.flush();
  staleFinish();
  assert.equal(closes, 0);
  assert.equal(second.isConnected, true);
  assert.equal(env.animations[1].cancelled, true);
  assert.equal(env.animations.at(-1).node, second.querySelector(".engagement-panel-container"));
});

test("Navigation während des Schließens verwirft die verspätete Aktion", async t => {
  const env = setup(t), panel = env.mount();
  await env.flush(); env.animations[0].finish();
  let clicks = 0; panel.querySelector("button").addEventListener("click", () => clicks++);
  panel.querySelector("button").click();
  const staleFinish = env.animations[1].onfinish;
  env.win.dispatchEvent(new env.win.Event("state-navigatestart"));
  staleFinish();
  assert.equal(clicks, 0);
  assert.equal(env.animations[1].cancelled, true);
});

test("Reduce Motion und fehlende Animation-API erhalten den sofortigen Originalklick", async t => {
  for (const options of [{ reduced: true }, { noAnimation: true }, { noTranslate: true }]) {
    const env = setup(t, options), panel = env.mount();
    await env.flush();
    let clicks = 0; panel.querySelector("button").addEventListener("click", () => clicks++);
    panel.querySelector("button").click();
    assert.equal(clicks, 1);
    assert.equal(env.animations.length, 0);
  }
});

test("Reduce Motion während des Schließens führt den beabsichtigten Originalklick aus", async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  let closes = 0; panel.querySelector("button").addEventListener("click", () => { closes++; panel.remove(); });
  panel.querySelector("button").click();
  const staleFinish = env.animations[1].onfinish;
  env.preference.matches = true; env.preference.changed(); await env.flush();
  staleFinish();
  assert.equal(closes, 1);
  assert.equal(env.animations[1].cancelled, true);
  assert.equal(env.win.__langformHasOpenOverlay(), false);
});

test("synchrones Verstecken und Wiederöffnen desselben Panels verwirft den alten Close", async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  let closes = 0; panel.querySelector("button").addEventListener("click", () => closes++);
  panel.querySelector("button").click(); const staleFinish = env.animations[1].onfinish;
  panel.hidden = true; panel.hidden = false; await env.flush(); staleFinish();
  assert.equal(closes, 0);
  assert.equal(env.animations.length, 3);
  assert.equal(env.animations.at(-1).settings.duration, 300);
});

test("ein während Close ersetzter Renderer bleibt anschließend bedienbar", async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  let oldCloses = 0; panel.querySelector("button").addEventListener("click", () => oldCloses++);
  panel.querySelector("button").click(); const staleFinish = env.animations[1].onfinish;
  panel.innerHTML = comments; await env.flush(); staleFinish();
  assert.equal(oldCloses, 0);
  env.animations.at(-1).finish();
  let closes = 0; panel.querySelector("button").addEventListener("click", () => closes++);
  panel.querySelector("button").click(); env.animations.at(-1).finish();
  assert.equal(closes, 1);
});

test("neu gestapelte Panels werden lokal erkannt und halten die Overlay-Sperre korrekt", async t => {
  const env = setup(t), first = env.mount();
  await env.flush(); env.expireDiscovery();
  first.setAttribute("aria-hidden", "true");
  const second = env.mount(); await env.flush();
  assert.equal(env.animations.at(-1).node, second.querySelector(".engagement-panel-container"));
  assert.equal(env.win.__langformHasOpenOverlay(), true);
  second.remove(); first.removeAttribute("aria-hidden"); await env.flush();
  assert.equal(env.animations.at(-1).node, first.querySelector(".engagement-panel-container"));
  assert.equal(env.win.__langformHasOpenOverlay(), true);
  first.remove(); await env.flush();
  assert.equal(env.win.__langformHasOpenOverlay(), false);
});

test("Pagehide räumt Bewegungen auf und der Feed installiert keine Kommentar-Dekoration", async t => {
  const env = setup(t), panel = env.mount(); await env.flush();
  env.win.dispatchEvent(new env.win.Event("pagehide"));
  assert.equal(env.animations[0].cancelled, true);
  assert.equal(env.timers.size, 0);
  assert.equal(env.win.__langformHasOpenOverlay(), false);
  const feed = setup(t, { feed: true }); feed.mount(); await feed.flush();
  assert.equal(feed.win.__langformCommentsMotion, undefined);
  assert.equal(feed.animations.length, 0);
  assert.equal(panel.isConnected, true, "Lifecycle-Observer entfernen kein YouTube-DOM");
});

test("nur die solide Fläche fährt vollständig ins Bild; äußerer Container und fester Scrim bleiben stabil", async t => {
  const env = setup(t);
  const panel = env.mount(comments.replace('class="engagement-panel-section-list-background draggable at-top"',
    'class="engagement-panel-section-list-background draggable at-top" style="position:fixed;inset:0;background:rgba(0,0,0,.5)"'));
  const surface = panel.querySelector(".engagement-panel-container");
  const scrim = panel.querySelector(".engagement-panel-section-list-background");
  surface.style.transform = "translateY(37px)";
  const scrimStyle = scrim.getAttribute("style"), surfaceStyle = surface.getAttribute("style");
  await env.flush();
  assert.equal(env.animations[0].node, surface);
  assert.deepEqual(env.animations[0].frames, [{ translate: "0px 626px" }, { translate: "0px 0px" }]);
  assert.equal(env.reads().geometryReads, 1, "genau eine begrenzte Messung an der Eintrittsgrenze");
  env.animations[0].finish();
  panel.querySelector("button").click();
  assert.ok(env.animations.every(animation => animation.node === surface));
  assert.ok(env.animations.every(animation => animation.frames.every(frame => Object.keys(frame).join() === "translate")),
    "kein Fade von Kommentartext oder Scrim und kein Überschreiben des YouTube-Transforms");
  assert.equal(panel.getAttribute("style"), null);
  assert.equal(scrim.getAttribute("style"), scrimStyle);
  assert.equal(surface.getAttribute("style"), surfaceStyle);
});

test("X während des Eintritts fährt von der sichtbaren Position weiter bis außerhalb des Viewports", async t => {
  const env = setup(t), panel = env.mount(); await env.flush();
  const entrance = env.animations[0], surface = entrance.node;
  entrance.currentTime = 130;
  const staleFinish = entrance.onfinish;
  env.pose(surface, "0px 180px");
  env.rect(surface, { x: 0, y: 400, left: 0, top: 400, right: 390, bottom: 1024, width: 390, height: 624 });
  let closes = 0; panel.querySelector("button").addEventListener("click", () => closes++);
  panel.querySelector("button").click();
  const exit = env.animations[1];
  assert.deepEqual(exit.frames, [{ translate: "0px 180px" }, { translate: "0px 626px" }]);
  assert.equal(exit.settings.duration, 180);
  assert.equal(exit.settings.easing, "cubic-bezier(0.4, 0, 1, 1)");
  assert.equal(entrance.cancelled, true);
  staleFinish();
  assert.equal(exit.cancelled, false);
  assert.equal(closes, 0);
  exit.finish();
  assert.equal(closes, 1);
});

test("asynchrones YouTube-Schließen hält den unsichtbaren Endframe ohne Rücksprung und ohne doppeltes X", async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  let closes = 0;
  const button = panel.querySelector("button");
  button.addEventListener("click", () => { closes++; env.win.setTimeout(() => panel.remove(), 50); });
  button.click();
  const exit = env.animations[1];
  exit.finish(); button.click(); exit.finish();
  assert.equal(closes, 1);
  assert.equal(panel.isConnected, true);
  assert.equal(exit.cancelled, false, "Fill bleibt bis zur echten asynchronen DOM-Entfernung erhalten");
  assert.equal(env.win.__langformHasOpenOverlay(), true);
  for (const [id, timer] of env.timers) if (timer.delay === 50) { env.timers.delete(id); timer.fn(); }
  await env.flush();
  assert.equal(exit.cancelled, true);
  assert.equal(env.win.__langformHasOpenOverlay(), false);
  assert.equal([...env.timers.values()].filter(timer => timer.delay === 500).length, 0);
});

test("ein wirkungsloser Original-Close stellt die Fläche nach 500ms wieder her und bleibt bedienbar", async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  let closes = 0; const button = panel.querySelector("button");
  button.addEventListener("click", () => closes++);
  button.click(); env.animations[1].finish(); button.click();
  assert.equal(closes, 1);
  assert.equal(env.animations.length, 2);
  assert.equal([...env.timers.values()].filter(timer => timer.delay === 500).length, 1);
  env.expireCloseGuard();
  assert.equal(env.animations[1].cancelled, true);
  assert.equal(panel.isConnected, true);
  assert.equal(env.win.__langformHasOpenOverlay(), true, "Sicherheitsrückkehr erfindet keinen entfernten YouTube-Dialog");
  button.click(); env.animations[2].finish();
  assert.equal(closes, 2, "ein erneuter bewusster X-Klick bleibt möglich");
});

test("ein bereits eingereihter Sicherheits-Timer darf ein wieder geöffnetes Panel nicht stoppen", async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  panel.querySelector("button").click(); env.animations[1].finish();
  const staleGuard = [...env.timers.values()].find(timer => timer.delay === 500).fn;
  panel.hidden = true; panel.hidden = false; await env.flush();
  const reopening = env.animations[2];
  staleGuard();
  assert.equal(reopening.cancelled, false);
  assert.equal(env.win.__langformHasOpenOverlay(), true);
});

test("Viewport oder Reduce Motion räumen auch den gehaltenen Close-Endframe ohne zweiten Originalklick auf", async t => {
  for (const mode of ["viewport", "reduce"]) {
    const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
    let closes = 0; panel.querySelector("button").addEventListener("click", () => closes++);
    panel.querySelector("button").click(); const exit = env.animations[1]; exit.finish();
    if (mode === "viewport") env.win.visualViewport.dispatchEvent(new env.win.Event("resize"));
    else { env.preference.matches = true; env.preference.changed(); }
    exit.finish(); env.expireCloseGuard();
    assert.equal(exit.cancelled, true);
    assert.equal(closes, 1);
    assert.equal([...env.timers.values()].filter(timer => timer.delay === 500).length, 0);
  }
});

test("Pointerdown beschleunigt die Restbewegung ohne Style- oder Geometriemessung und ohne Sprung", async t => {
  const env = setup(t), panel = env.mount(); await env.flush();
  const entrance = env.animations[0]; entrance.currentTime = 90;
  const before = env.reads();
  const event = env.touch(entrance.node, "pointerdown");
  assert.equal(event.defaultPrevented, false);
  assert.equal(entrance.cancelled, false);
  assert.equal(entrance.currentTime, 90);
  assert.equal(entrance.playbackRate, 2);
  assert.deepEqual(env.reads(), before);
  env.touch(entrance.node, "touchstart");
  env.touch(entrance.node, "pointerdown");
  assert.deepEqual(entrance.rates, [2], "pointer/touch-Doppelzustellung plant keinen zweiten Tempoabgleich");
  assert.deepEqual(env.reads(), before);
});

test("Pointer und Touch beschleunigen denselben Effekt auch bei ausstehendem WebKit-Tempoabgleich nur einmal", async t => {
  const env=setup(t), panel=env.mount(); await env.flush();
  const entrance=env.animations[0];
  entrance.updatePlaybackRate=function(rate) { this.rates.push(rate); };
  env.touch(entrance.node,"pointerdown");env.touch(entrance.node,"touchstart");
  assert.equal(entrance.playbackRate,1,"der Timeline-Abgleich steht noch aus");
  assert.deepEqual(entrance.rates,[2]);
  entrance.finish();panel.hidden=true;await env.flush();panel.hidden=false;await env.flush();
  const next=env.animations[1];env.touch(next.node,"pointerdown");
  assert.deepEqual(next.rates,[2],"ein neuer Eintritt darf wieder beschleunigen");
});

test("Bewegung begrenzt den Autofokus-Scrollwrapper vor dem ersten Frame und gibt ihn bei jedem Ende wieder frei", async t => {
  const marker = "data-langform-comments-moving";
  for (const ending of ["finish", "hidden", "disconnect", "navigation", "viewport", "reduce", "pagehide"]) {
    const env = setup(t, { onAnimate(surface) {
      assert.equal(surface.closest(".engagement-panel-section-list-background").hasAttribute(marker), true,
        "Clip muss vor dem ersten WAAPI-Frame und möglichem YouTube-Autofokus aktiv sein");
    } });
    const panel = env.mount(), wrapper = panel.querySelector(".engagement-panel-section-list-background");
    wrapper.setAttribute("data-youtube-layout", "retain");
    wrapper.setAttribute("style", "background:rgb(1,2,3);--yt-native:keep");
    const attributes = Array.from(wrapper.attributes, attr => [attr.name, attr.value]);
    const content = panel.querySelector(".engagement-panel-content-wrapper"); content.scrollTop = 321;
    await env.flush();
    assert.equal(wrapper.hasAttribute(marker), true);
    assert.equal(panel.hasAttribute(marker), false);
    assert.equal(content.hasAttribute(marker), false, "die eigentliche Kommentarliste bleibt scrollbar");
    const clipRule = Array.from(env.doc.styleSheets).flatMap(sheet => Array.from(sheet.cssRules))
      .find(rule => rule.selectorText === "ytm-engagement-panel .engagement-panel-section-list-background.at-top[" + marker + "]:not([data-langform-comments-interactive])");
    assert.ok(clipRule, "nur der eigene bewegte Wrapper erhält die temporäre Regel");
    assert.equal(clipRule.style.getPropertyValue("overflow"), "clip");
    assert.equal(clipRule.style.getPropertyPriority("overflow"), "important");
    const animation = env.animations[0], staleFinish = animation.onfinish;
    if (ending === "finish") animation.finish();
    else if (ending === "hidden") panel.hidden = true;
    else if (ending === "disconnect") panel.remove();
    else if (ending === "navigation") env.win.dispatchEvent(new env.win.Event("state-navigatestart"));
    else if (ending === "viewport") env.win.visualViewport.dispatchEvent(new env.win.Event("resize"));
    else if (ending === "reduce") { env.preference.matches = true; env.preference.changed(); }
    else env.win.dispatchEvent(new env.win.Event("pagehide"));
    await env.flush(); staleFinish();
    assert.equal(wrapper.hasAttribute(marker), false, ending + " entfernt die temporäre Scrollbegrenzung");
    assert.equal(animation.cancelled, true);
    assert.deepEqual(Array.from(wrapper.attributes, attr => [attr.name, attr.value]), attributes,
      ending + " erhält alle fremden Attribute und Inline-Styles");
    assert.equal(content.scrollTop, 321);
  }
});

test("Hydration überträgt die Scrollbegrenzung auf den neuen Wrapper ohne alte Marker zurückzulassen", async t => {
  const marker = "data-langform-comments-moving";
  const env = setup(t), panel = env.push(skeleton); await env.flush();
  const oldWrapper = panel.querySelector(".engagement-panel-section-list-background");
  const entrance = env.animations[0], staleFinish = entrance.onfinish;
  entrance.currentTime = 190;
  panel.innerHTML = comments; await env.flush();
  const newWrapper = panel.querySelector(".engagement-panel-section-list-background");
  assert.notEqual(newWrapper, oldWrapper);
  assert.equal(oldWrapper.hasAttribute(marker), false, "auch der abgetrennte Skeleton-Wrapper wird aufgeräumt");
  assert.equal(newWrapper.hasAttribute(marker), true);
  assert.equal(env.animations[1].currentTime, 190);
  staleFinish();
  assert.equal(newWrapper.hasAttribute(marker), true, "alter Abschluss kann neue Begrenzung nicht entfernen");
  env.animations[1].finish();
  assert.equal(newWrapper.hasAttribute(marker), false);
});

test("Scrollbegrenzung bleibt am gehaltenen Close-Endframe und endet bei DOM-Abbau oder Sicherheitsrückkehr", async t => {
  const marker = "data-langform-comments-moving";
  for (const ending of ["disconnect", "hidden", "fallback"]) {
    const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
    const wrapper = panel.querySelector(".engagement-panel-section-list-background");
    assert.equal(wrapper.hasAttribute(marker), false);
    panel.querySelector("button").click();
    assert.equal(wrapper.hasAttribute(marker), true);
    env.animations[1].finish();
    assert.equal(wrapper.hasAttribute(marker), true, "asynchroner Original-Close darf keinen Autofokus-Rücksprung erzeugen");
    if (ending === "disconnect") panel.remove();
    else if (ending === "hidden") panel.hidden = true;
    else env.expireCloseGuard();
    await env.flush();
    assert.equal(wrapper.hasAttribute(marker), false, ending + " stellt den ursprünglichen Wrapper wieder her");
  }
});

test("Reduce Motion und fehlende Animationsunterstützung verändern den Scrollwrapper nicht", async t => {
  for (const options of [{ reduced: true }, { noAnimation: true }, { noTranslate: true }]) {
    const env = setup(t, options), panel = env.mount(); await env.flush();
    panel.querySelector("button").click();
    assert.equal(panel.querySelector("[data-langform-comments-moving]"), null);
    assert.equal(env.animations.length, 0);
  }
});

test("YouTubes native Aufwärtsgeste verlässt den at-top-Clip ohne ihren Scrollweg zu blockieren", async t => {
  const env = setup(t), panel = env.mount(); await env.flush();
  const wrapper = panel.querySelector(".engagement-panel-section-list-background");
  const selector = "ytm-engagement-panel .engagement-panel-section-list-background.at-top[data-langform-comments-moving]:not([data-langform-comments-interactive])";
  assert.equal(wrapper.matches(selector), true);
  wrapper.classList.remove("at-top");
  assert.equal(wrapper.matches(selector), false, "native Dragposition außerhalb at-top hat keine Clip-Regel");
  assert.equal(wrapper.hasAttribute("data-langform-comments-moving"), true, "laufende Dekoration braucht keinen Eingriff in die native Klasse");
  env.animations[0].finish();
  assert.equal(wrapper.hasAttribute("data-langform-comments-moving"), false);
  assert.equal(wrapper.classList.contains("at-top"), false, "Abschluss überschreibt YouTubes Dragzustand nicht");
});

test("bereits gescrollter YouTube-Wrapper behält seine Position und schließt sofort ohne Clip oder neue Bewegung", async t => {
  for (const scrollDuringEntry of [false, true]) {
    const env = setup(t), panel = env.mount();
    const wrapper = panel.querySelector(".engagement-panel-section-list-background");
    if (scrollDuringEntry) await env.flush();
    wrapper.scrollTop = 87;
    await env.flush();
    assert.equal(wrapper.scrollTop, 87);
    assert.equal(env.animations.length, scrollDuringEntry ? 1 : 0,
      "vorhandener Wrapper-Scroll beim Öffnen überspringt die Dekoration vollständig");
    const entrance = env.animations[0], staleFinish = entrance && entrance.onfinish;
    let closes = 0;
    panel.querySelector("button").addEventListener("click", () => {
      closes++;
      assert.equal(wrapper.scrollTop, 87, "Original-Close erhält die native Position unverändert");
    });
    panel.querySelector("button").click();
    assert.equal(closes, 1, "Originalklick läuft synchron ohne Exit-Wartezeit");
    assert.equal(env.animations.length, scrollDuringEntry ? 1 : 0, "kein neuer Close-Effekt auf einem gescrollten Wrapper");
    assert.equal(wrapper.hasAttribute("data-langform-comments-moving"), false);
    if (entrance) {
      assert.equal(entrance.cancelled, true, "laufende Dekoration endet vor dem nativen Close");
      staleFinish();
    }
    env.expireCloseGuard();
    assert.equal(closes, 1);
    assert.equal(wrapper.scrollTop, 87);
  }
});

test("ungültige Schließgeometrie lässt den Originalklick einmal unverändert durch statt ihn synchron neu auszulösen", async t => {
  for (const rect of [
    { top: 220, height: 0 },
    { top: Number.NaN, height: 624 },
  ]) {
    const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
    const surface = panel.querySelector(".engagement-panel-container");
    env.rect(surface, rect);
    let closes = 0;
    panel.querySelector("button").addEventListener("click", event => {
      closes++;
      assert.equal(event.defaultPrevented, false);
    });
    panel.querySelector("button").click();
    assert.equal(closes, 1);
    assert.equal(env.animations.length, 1, "ohne nutzbare Geometrie entsteht kein Exit-Effekt");
    assert.equal(panel.querySelector("[data-langform-comments-moving]"), null);
    assert.equal([...env.timers.values()].filter(timer => timer.delay === 500).length, 0);
  }
});

test('Kommentarheader zeigt einen eigenen nicht fokussierbaren Ziehbalken', async t => {
  const env = setup(t), panel = env.mount(); await env.flush();
  const handle = panel.querySelector('[data-langform-comments-handle]');
  assert.ok(handle); assert.equal(handle.getAttribute('aria-hidden'), 'true');
  assert.equal(handle.hasAttribute('tabindex'), false);
  assert.equal(handle.closest('.engagement-panel-section-list-header-wrapper') !== null, true);
  assert.equal(panel.querySelectorAll('[data-langform-comments-handle]').length, 1);
});

test('Headerdrag folgt dem Finger und federt mit physikalischen Keyframes von der erreichten Pose zurück', async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  const header = panel.querySelector('.engagement-panel-section-list-header-title'), surface = panel.querySelector('.engagement-panel-container');
  const originalTransform = surface.style.transform;
  dragEvent(env, header, 'pointerdown', 130, 300);
  const move = dragEvent(env, header, 'pointermove', 132, 354);
  assert.equal(move.defaultPrevented, true); assert.equal(surface.style.translate, '0px 54px');
  dragEvent(env, header, 'pointerup', 132, 354);
  const settle = env.animations.at(-1);
  assert.ok(settle.frames.length > 12, 'Spring wird aus Position und Geschwindigkeit berechnet');
  assert.equal(settle.settings.easing, 'linear'); assert.equal(settle.frames[0].translate, '0px 54px');
  assert.equal(settle.frames.at(-1).translate, '0px 0px');
  settle.finish(); assert.equal(surface.style.translate, ''); assert.equal(surface.style.transform, originalTransform);
});

test('dieselbe kurze Fixturebewegung unterscheidet langsamen Zug, schnellen Flick und gehaltenes Loslassen über explizite Kontaktzeit', async t => {
  for (const [moveMs, releaseMs, dismiss] of [[200, 50, false], [20, 1, true], [20, 150, false]]) {
    const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
    const header = panel.querySelector('h2'); let closes = 0;
    panel.querySelector('button').addEventListener('click', () => { closes++; panel.remove(); });
    dragEvent(env, header, 'pointerdown', 130, 300);
    dragEvent(env, header, 'pointermove', 130, 354, { elapsedMs: moveMs });
    dragEvent(env, header, 'pointerup', 130, 354, { elapsedMs: releaseMs });
    env.animations.at(-1).finish(); await env.flush();
    assert.equal(closes, dismiss ? 1 : 0, `${moveMs}ms Zug, ${releaseMs}ms Hold`);
    assert.equal(panel.isConnected, !dismiss);
  }
});

test('langer Headerdrag schließt durch den originalen X genau einmal und hält den Overlay-Schutz bis zur Entfernung', async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  const header = panel.querySelector('.engagement-panel-section-list-header-title');
  let closes = 0; panel.querySelector('button').addEventListener('click', () => { closes++; panel.remove(); });
  dragEvent(env, header, 'pointerdown', 130, 300); dragEvent(env, header, 'pointermove', 130, 570); dragEvent(env, header, 'pointerup', 130, 570);
  assert.equal(closes, 0); assert.equal(env.win.__langformHasOpenOverlay(), true);
  const finish = env.animations.at(-1).onfinish; env.animations.at(-1).finish(); finish(); await env.flush();
  assert.equal(closes, 1); assert.equal(env.win.__langformHasOpenOverlay(), false);
});

test('Hochziehen erweitert dieselbe Kommentarfläche und zieht ihre Unterkante bis zum Viewportrand mit', async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  const header = panel.querySelector('.engagement-panel-section-list-header-title'), surface = panel.querySelector('.engagement-panel-container');
  dragEvent(env, header, 'pointerdown', 130, 320); dragEvent(env, header, 'pointermove', 130, 160); dragEvent(env, header, 'pointerup', 130, 160);
  const spring = env.animations.at(-1); spring.finish();
  assert.equal(surface.style.translate, '0px -208px'); assert.equal(surface.style.height, '832px');
  assert.equal(panel.isConnected, true); assert.equal(env.doc.querySelectorAll('video').length, 1);
});

test('gescrollte Kommentare, horizontale Bewegung und Kommentar-Controls behalten ihre Originalereignisse', async t => {
  for (const scenario of ['scrolled', 'horizontal', 'button', 'input']) {
    const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
    let target = panel.querySelector('.engagement-panel-content-wrapper');
    if (scenario === 'scrolled') target.scrollTop = 100;
    if (scenario === 'button') target = panel.querySelector('#reply');
    if (scenario === 'input') { const input = env.doc.createElement('textarea'); target.appendChild(input); target = input; }
    let moves = 0; target.addEventListener('pointermove', () => moves++);
    dragEvent(env, target, 'pointerdown', 100, 400);
    const event = dragEvent(env, target, 'pointermove', scenario === 'horizontal' ? 180 : 100, scenario === 'horizontal' ? 402 : 580);
    dragEvent(env, target, 'pointerup', 180, 580);
    assert.equal(event.defaultPrevented, false, scenario); assert.equal(moves, 1, scenario); assert.equal(env.animations.length, 1, scenario);
  }
});

test('Liste am oberen Rand kann abwärts schließen, aufwärts bleibt sie bei YouTubes echtem Listenscroll', async t => {
  for (const downward of [false, true]) {
    const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
    const body = panel.querySelector('.engagement-panel-content-wrapper');
    dragEvent(env, body, 'pointerdown', 100, 400);
    const move = dragEvent(env, body, 'pointermove', 100, downward ? 610 : 330);
    assert.equal(move.defaultPrevented, downward);
    dragEvent(env, body, 'pointerup', 100, downward ? 610 : 330);
    assert.equal(env.animations.length, downward ? 2 : 1);
  }
});

test('Multitouch, Abbruch, Navigation und Keyboardresize räumen eigene Dragstyles ohne Medien-/Fokusaktionen auf', async t => {
  for (const ending of ['pointercancel', 'second-pointer', 'navigation', 'resize', 'hidden', 'removed']) {
    const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
    const header = panel.querySelector('.engagement-panel-section-list-header-title'), surface = panel.querySelector('.engagement-panel-container'), style = surface.style.cssText;
    let closes = 0; panel.querySelector('button').addEventListener('click', () => closes++);
    const video = env.doc.querySelector('video'); video.play = video.pause = () => assert.fail('Drag darf das Medium nicht verändern');
    dragEvent(env, header, 'pointerdown', 100, 300); dragEvent(env, header, 'pointermove', 100, 380);
    if (ending === 'pointercancel') { dragEvent(env, header, 'pointercancel', 100, 380); env.animations.at(-1).finish(); }
    else if (ending === 'second-pointer') { dragEvent(env, header, 'pointerdown', 180, 380, { id: 32, isPrimary: false }); env.animations.at(-1).finish(); }
    else if (ending === 'navigation') env.win.dispatchEvent(new env.win.Event('yt-navigate-start'));
    else if (ending === 'resize') env.win.visualViewport.dispatchEvent(new env.win.Event('resize'));
    else if (ending === 'hidden') { panel.hidden = true; await env.flush(); }
    else { panel.remove(); await env.flush(); }
    assert.equal(surface.style.cssText, style, ending); assert.equal(closes, 0, ending);
  }
});

test('Reduce Motion erhält Dragbedienung mit sofortigem Snap und ohne neue Animation', async t => {
  const env = setup(t, { reduced: true }), panel = env.mount(); await env.flush();
  const header = panel.querySelector('.engagement-panel-section-list-header-title'), surface = panel.querySelector('.engagement-panel-container');
  let now = 1000; Object.defineProperty(env.win.performance, 'now', { configurable: true, value: () => now });
  dragEvent(env, header, 'pointerdown', 100, 300);
  now += 500; dragEvent(env, header, 'pointermove', 100, 350); // 50 px / .5 s = 100 px/s, a deliberate slow drag.
  now += 20; dragEvent(env, header, 'pointerup', 100, 350);
  assert.equal(env.animations.length, 0); assert.equal(surface.style.translate, '');
});

test('Reduce Motion erhält auch einen bewusst schnellen Fling ohne Animation und führt den Originaldismiss einmal aus', async t => {
  const env = setup(t, { reduced: true }), panel = env.mount(); await env.flush();
  const header = panel.querySelector('.engagement-panel-section-list-header-title');
  let now = 1000, closes = 0; Object.defineProperty(env.win.performance, 'now', { configurable: true, value: () => now });
  panel.querySelector('button').addEventListener('click', () => { closes++; panel.remove(); });
  dragEvent(env, header, 'pointerdown', 100, 300);
  now += 20; dragEvent(env, header, 'pointermove', 100, 350); // Same 50 px at 2500 px/s intentionally dismisses.
  now += 1; dragEvent(env, header, 'pointerup', 100, 350); await env.flush();
  assert.equal(env.animations.length, 0); assert.equal(closes, 1); assert.equal(panel.isConnected, false);
});

test('YouTubes fokussierter Schließenbutton sperrt Drag nicht; ein aktives Texteingabefeld erhält seine Tastatur', async t => {
  for (const inputFocused of [false, true]) {
    const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
    const header = panel.querySelector('.engagement-panel-section-list-header-title');
    let input = panel.querySelector('button');
    if (inputFocused) { input = env.doc.createElement('textarea'); panel.querySelector('.engagement-panel-content-wrapper').appendChild(input); }
    input.focus(); dragEvent(env, header, 'pointerdown', 100, 300);
    const move = dragEvent(env, header, 'pointermove', 100, 360);
    assert.equal(move.defaultPrevented, !inputFocused);
    assert.equal(env.doc.activeElement, input, 'kein blur/focus in der Dragsteuerung');
  }
});

test('Griff während laufender Feder übernimmt die sichtbare Pose; ein alter Callback kann sie nicht zurücksetzen', async t => {
  const env = setup(t);let now=1000;Object.defineProperty(env.win.performance,'now',{configurable:true,value:()=>now});
  const panel = env.mount(); await env.flush(); env.animations[0].finish();
  const header = panel.querySelector('.engagement-panel-section-list-header-title'), surface = panel.querySelector('.engagement-panel-container');
  // Explicit slow pull: host scheduling must not turn this return spring into a dismiss flick.
  dragEvent(env, header, 'pointerdown', 100, 300);now=1200;dragEvent(env, header, 'pointermove', 100, 360);now=1250;dragEvent(env, header, 'pointerup', 100, 360);
  const spring = env.animations.at(-1), oldFinish = spring.onfinish;assert.equal(spring.frames.at(-1).translate,'0px 0px','specified slow pull returns to rest before regrab');env.pose(surface, '0px 28px');
  now=1300;dragEvent(env, header, 'pointerdown', 100, 320);now=1350;dragEvent(env, header, 'pointermove', 100, 350);
  assert.equal(spring.cancelled, true); assert.equal(surface.style.translate, '0px 58px');
  oldFinish(); assert.equal(surface.style.translate, '0px 58px');
});

test('ein wirkungsloser originaler Dismiss zeigt nach dem Schutzzeitraum wieder das ursprüngliche Blatt', async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  const header = panel.querySelector('.engagement-panel-section-list-header-title'), surface = panel.querySelector('.engagement-panel-container'), original = surface.style.cssText;
  let closes = 0; panel.querySelector('button').addEventListener('click', () => closes++);
  dragEvent(env, header, 'pointerdown', 100, 300); dragEvent(env, header, 'pointermove', 100, 580); dragEvent(env, header, 'pointerup', 100, 580);
  env.animations.at(-1).finish(); assert.equal(closes, 1); env.expireCloseGuard();
  assert.equal(surface.style.cssText, original); assert.equal(panel.isConnected, true); assert.equal(env.win.__langformHasOpenOverlay(), true);
  assert.equal(panel.querySelector('[data-langform-comments-interactive]'), null);
});

test('iOS-Pointer und Touch desselben Fingers schließen nur einmal und Touchmove übernimmt die Scrollentscheidung', async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  const header = panel.querySelector('.engagement-panel-section-list-header-title');
  let closes = 0; panel.querySelector('button').addEventListener('click', () => { closes++; panel.remove(); });
  function touch(type, y) { const event = new env.win.Event(type, { bubbles: true, cancelable: true }); const point = { identifier: 71, clientX: 100, clientY: y }; event.touches = type === 'touchend' ? [] : [point]; event.changedTouches = [point]; header.dispatchEvent(event); return event; }
  dragEvent(env, header, 'pointerdown', 100, 300); touch('touchstart', 300);
  dragEvent(env, header, 'pointermove', 100, 580); assert.equal(touch('touchmove', 580).defaultPrevented, true);
  dragEvent(env, header, 'pointerup', 100, 580); assert.equal(env.animations.length, 1); touch('touchend', 580);
  assert.equal(env.animations.length, 2); env.animations.at(-1).finish(); await env.flush(); assert.equal(closes, 1);
});

test('Tastatur-/AX-X bleibt unmittelbar nach einem Drag erreichbar; reine Nichtprimarypointer beginnen keine neue Geste', async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  const header = panel.querySelector('.engagement-panel-section-list-header-title');
  dragEvent(env, header, 'pointerdown', 100, 300, { isPrimary: false });
  const ignored = dragEvent(env, header, 'pointermove', 100, 500, { isPrimary: false }); assert.equal(ignored.defaultPrevented, false);
  dragEvent(env, header, 'pointerdown', 100, 300); dragEvent(env, header, 'pointermove', 100, 350); dragEvent(env, header, 'pointerup', 100, 350); env.animations.at(-1).finish();
  let closes = 0; panel.querySelector('button').addEventListener('click', () => { closes++; panel.remove(); });
  panel.querySelector('button').click(); env.animations.at(-1).finish(); await env.flush(); assert.equal(closes, 1);
});

test('echte native Hintergrundsichtbarkeit beendet Drag auch bei für Playback maskiertem document.hidden', async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  const header = panel.querySelector('.engagement-panel-section-list-header-title'), surface = panel.querySelector('.engagement-panel-container'), original = surface.style.cssText;
  Object.defineProperty(env.doc, 'hidden', { configurable: true, value: false });
  env.win.__langformRealVisibility = { inactive() { return true; } };
  dragEvent(env, header, 'pointerdown', 100, 300); dragEvent(env, header, 'pointermove', 100, 370);
  env.doc.dispatchEvent(new env.win.Event('langform-real-visibilitychange'));
  assert.equal(surface.style.cssText, original); assert.equal(panel.hasAttribute('data-langform-comments-dragging'), false);
});

test('aktueller mweb-Renderer hebt seinen zusätzlichen Clip nur während eigener Expansion auf und stellt ihn wieder her', async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  const header = panel.querySelector('.engagement-panel-section-list-header-title'), renderer = panel.querySelector('ytm-engagement-panel-section-list-renderer');
  renderer.style.overflowY = 'auto';
  dragEvent(env, header, 'pointerdown', 100, 320); dragEvent(env, header, 'pointermove', 100, 160); dragEvent(env, header, 'pointerup', 100, 160); env.animations.at(-1).finish();
  assert.equal(renderer.hasAttribute('data-langform-comments-interactive'), true);
  const rule = Array.from(env.doc.styleSheets).flatMap(sheet => Array.from(sheet.cssRules)).find(rule => rule.selectorText === 'ytm-engagement-panel ytm-engagement-panel-section-list-renderer[data-langform-comments-interactive]');
  assert.equal(rule.style.getPropertyValue('overflow'), 'visible'); assert.equal(rule.style.getPropertyPriority('overflow'), 'important');
  env.win.visualViewport.dispatchEvent(new env.win.Event('resize'));
  assert.equal(renderer.hasAttribute('data-langform-comments-interactive'), false); assert.equal(renderer.style.overflowY, 'auto');
});

test('expandierter Kommentarhandle bleibt unter dem gemeldeten nativen Safe-Area-Top statt unter der Uhrzeit', async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  env.win.__langformStageInsets = { top: 59 };
  const header = panel.querySelector('.engagement-panel-section-list-header-title'), surface = panel.querySelector('.engagement-panel-container');
  dragEvent(env, header, 'pointerdown', 100, 320); dragEvent(env, header, 'pointermove', 100, 120); dragEvent(env, header, 'pointerup', 100, 120); env.animations.at(-1).finish();
  assert.equal(surface.style.translate, '0px -149px'); assert.equal(surface.style.height, '773px');
});

test('schnelle Aufwärtsfeder deckt die Bildschirmunterkante auch während ihres Überschwingens vollständig ab', async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  env.win.__langformStageInsets = { top: 59 };
  const header = panel.querySelector('h2'), surface = panel.querySelector('.engagement-panel-container');
  let now = 1000; Object.defineProperty(env.win.performance, 'now', { configurable: true, value: () => now });
  dragEvent(env, header, 'pointerdown', 100, 330);
  now += 40; dragEvent(env, header, 'pointermove', 100, 250);
  now += 16; dragEvent(env, header, 'pointermove', 100, 190);
  dragEvent(env, header, 'pointerup', 100, 190);
  const spring = env.animations.at(-1), height = parseFloat(surface.style.height);
  const offsets = spring.frames.map(frame => parseFloat(frame.translate.split(' ')[1]));
  assert.ok(Math.min(...offsets) < -149, 'Test enthält echtes physikalisches Überschwingen');
  assert.ok(offsets.every(offset => 220 + offset + height >= 844 - .01), 'kein sichtbarer Spalt während irgendeines Springframes');
  spring.finish(); assert.equal(surface.style.height, '773px');
});

test('Endkoordinate eines zusammengefassten Touch-Endes bestimmt Dismiss und letzte sichtbare Pose', async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  const header = panel.querySelector('h2');
  let now = 1000, closes = 0; Object.defineProperty(env.win.performance, 'now', { configurable: true, value: () => now });
  panel.querySelector('button').addEventListener('click', () => { closes++; panel.remove(); });
  dragEvent(env, header, 'pointerdown', 100, 300);
  now += 200; dragEvent(env, header, 'pointermove', 100, 320);
  now += 120; dragEvent(env, header, 'pointerup', 100, 580);
  const spring = env.animations.at(-1);
  assert.equal(spring.frames[0].translate, '0px 280px', 'Release startet an der tatsächlichen Endpose');
  spring.finish(); await env.flush(); assert.equal(closes, 1);
});

test('der letzte Releasepunkt kann einen begonnenen Dismiss durch eine Gegenbewegung abbrechen', async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  const header = panel.querySelector('h2');
  let now = 1000, closes = 0; Object.defineProperty(env.win.performance, 'now', { configurable: true, value: () => now });
  panel.querySelector('button').addEventListener('click', () => closes++);
  dragEvent(env, header, 'pointerdown', 100, 300);
  now += 300; dragEvent(env, header, 'pointermove', 100, 580);
  now += 200; dragEvent(env, header, 'pointerup', 100, 310);
  const spring = env.animations.at(-1);
  assert.equal(spring.frames[0].translate, '0px 10px');
  spring.finish(); assert.equal(closes, 0); assert.equal(panel.isConnected, true);
});

test('schneller Richtungswechsel beim Loslassen verwendet nicht die alte entgegengesetzte Geschwindigkeit', async t => {
  const env = setup(t), panel = env.mount(); await env.flush(); env.animations[0].finish();
  const header = panel.querySelector('h2');
  let now = 1000, closes = 0; Object.defineProperty(env.win.performance, 'now', { configurable: true, value: () => now });
  panel.querySelector('button').addEventListener('click', () => closes++);
  dragEvent(env, header, 'pointerdown', 100, 300);
  now += 80; dragEvent(env, header, 'pointermove', 100, 420);
  now += 4; dragEvent(env, header, 'pointerup', 100, 380);
  const spring = env.animations.at(-1);
  assert.notEqual(spring.frames.at(-1).translate, '0px 626px', 'Rückbewegung darf nicht mit der alten Abwärtsgeschwindigkeit schließen');
  spring.finish(); assert.equal(closes, 0);
});

test('eigene Expansion bleibt während der Feder unclipped, während normale Entrances ihren Fokusscroll-Clip behalten', async t => {
  const env = setup(t), panel = env.mount(); await env.flush();
  const header = panel.querySelector('h2'), background = panel.querySelector('.engagement-panel-section-list-background');
  const matchingClips = () => Array.from(env.doc.styleSheets).flatMap(sheet => Array.from(sheet.cssRules))
    .filter(rule => rule.style.getPropertyValue('overflow') === 'clip' && background.matches(rule.selectorText));
  assert.equal(matchingClips().length, 1, 'Originalentrance schützt weiterhin vor Autofokus-Scroll');
  env.animations[0].finish();
  dragEvent(env, header, 'pointerdown', 100, 320); dragEvent(env, header, 'pointermove', 100, 160); dragEvent(env, header, 'pointerup', 100, 160);
  assert.equal(background.hasAttribute('data-langform-comments-moving'), true);
  assert.equal(background.hasAttribute('data-langform-comments-interactive'), true);
  assert.equal(matchingClips().length, 0, 'Header oberhalb der alten Box bleibt während der Feder sichtbar und erreichbar');
  env.animations.at(-1).finish(); env.win.dispatchEvent(new env.win.Event('resize'));
  assert.equal(background.hasAttribute('data-langform-comments-interactive'), false);
});

test('ein früher dokumentweiter Headergriff verhindert konkurrierende Original-Window-/Document-Recognizer', async t => {
  const env = setup(t); let originalStarts=0, ownsOriginal=false, surface;
  // Site listeners are installed after document-start scripts but before the
  // lazy comment sheet mounts. This is the real ordering the old node-level
  // capture route failed to protect.
  for (const root of [env.win,env.doc]) for (const name of ['pointerdown','touchstart']) root.addEventListener(name,()=>{originalStarts++;ownsOriginal=true;},true);
  env.win.addEventListener('pointermove',()=>{if(ownsOriginal)surface.style.transform='translateY(336.333px)';},true);
  const panel=env.mount();await env.flush();env.animations[0].finish();surface=panel.querySelector('.engagement-panel-container');
  const header=panel.querySelector('h2');
  let now=1000;Object.defineProperty(env.win.performance,'now',{configurable:true,value:()=>now});
  dragEvent(env,header,'pointerdown',100,328);now+=500;dragEvent(env,header,'pointermove',100,363);now+=150;dragEvent(env,header,'pointerup',100,363);env.animations.at(-1).finish();
  assert.equal(originalStarts,0,'Originalheader kann keinen parallelen Drag beginnen');
  assert.equal(surface.style.transform,'translateY(0px)');assert.equal(surface.style.translate,'');
});

test('frühe Windowroute bewahrt Original-Controls und gescrollte Liste und entfernt abgelöste Panels', async t => {
  const env=setup(t);let originalStarts=0;env.win.addEventListener('pointerdown',()=>originalStarts++,true);
  const panel=env.mount();await env.flush();env.animations[0].finish();
  dragEvent(env,panel.querySelector('#reply'),'pointerdown',100,400);dragEvent(env,panel.querySelector('#reply'),'pointerup',100,400);
  const body=panel.querySelector('.engagement-panel-content-wrapper');body.scrollTop=100;
  dragEvent(env,body,'pointerdown',100,400);dragEvent(env,body,'pointermove',100,450);dragEvent(env,body,'pointerup',100,450);
  assert.equal(originalStarts,2);assert.equal(body.scrollTop,100);
  panel.remove();await env.flush();env.doc.body.append(panel);
  dragEvent(env,panel.querySelector('h2'),'pointerdown',100,300);
  assert.equal(originalStarts,3,'entferntes/noch nicht rediscovered Panel bleibt beim Originalpfad');
});

test('iOS Headerkontakt schirmt kleine Moves und beide Pointer-/Touch-Streams bis zum jeweiligen Ende ab', async t => {
  for (const ending of ['pointer-first','touch-first','cancel']) {
    const env=setup(t), leaked=[];let surface;
    for(const name of ['pointermove','touchmove','pointerup','touchend','pointercancel','touchcancel']) env.win.addEventListener(name,e=>{leaked.push(e.type);surface.style.transform='translateY(336.333px)';},true);
    const panel=env.mount();await env.flush();env.animations[0].finish();surface=panel.querySelector('.engagement-panel-container');const header=panel.querySelector('h2');
    function touch(type,y){const e=new env.win.Event(type,{bubbles:true,cancelable:true});const p={identifier:71,clientX:100,clientY:y};e.touches=/end|cancel/.test(type)?[]:[p];e.changedTouches=[p];header.dispatchEvent(e);}
    let now=1000;Object.defineProperty(env.win.performance,'now',{configurable:true,value:()=>now});
    dragEvent(env,header,'pointerdown',100,328);touch('touchstart',328);
    now+=30;dragEvent(env,header,'pointermove',100,331);touch('touchmove',331);
    now+=200;dragEvent(env,header,'pointermove',100,363);touch('touchmove',363);now+=150;
    if(ending==='touch-first'){touch('touchend',363);dragEvent(env,header,'pointerup',100,363);}
    else if(ending==='cancel'){dragEvent(env,header,'pointercancel',100,363);touch('touchcancel',363);}
    else{dragEvent(env,header,'pointerup',100,363);touch('touchend',363);}
    assert.deepEqual(leaked,[],ending+' darf den Originalmove nicht ohne eigenen Originalstart reaktivieren');
    env.animations.at(-1).finish();assert.equal(surface.style.translate,'');assert.equal(surface.style.transform,'translateY(0px)');
    dragEvent(env,env.doc.body,'pointermove',100,400);assert.equal(leaked.length,1,'abgeschlossener Kontakt sperrt keinen späteren Fremdkontakt');
  }
});

test('Kontaktschutz beginnt im Listenbody erst nach Claim und gibt fremde IDs sowie Resize frei', async t => {
  const env=setup(t), panel=env.mount();await env.flush();env.animations[0].finish();const body=panel.querySelector('.engagement-panel-content-wrapper'),header=panel.querySelector('h2');let forwarded=0;
  env.win.addEventListener('pointermove',()=>forwarded++,true);
  function touch(type,y){const e=new env.win.Event(type,{bubbles:true,cancelable:true});const p={identifier:71,clientX:100,clientY:y};e.touches=type==='touchend'?[]:[p];e.changedTouches=[p];body.dispatchEvent(e);}
  dragEvent(env,body,'pointerdown',100,400);touch('touchstart',400);
  dragEvent(env,body,'pointermove',100,403);touch('touchmove',403);assert.equal(forwarded,1,'native Liste behält unbeanspruchten Kontakt');
  touch('touchmove',435);dragEvent(env,body,'pointermove',100,435);assert.equal(forwarded,1,'nach Bodyclaim sind auch Begleitpointer geschützt');
  dragEvent(env,body,'pointerup',100,435);touch('touchend',435);env.animations.at(-1).finish();
  dragEvent(env,header,'pointerdown',100,300);dragEvent(env,header,'pointermove',100,304,{id:99});assert.equal(forwarded,2,'fremde Kontakt-ID wird nicht blockiert');
  env.win.dispatchEvent(new env.win.Event('resize'));dragEvent(env,header,'pointermove',100,305);assert.equal(forwarded,3,'Viewportwechsel räumt Kontaktbesitz auf');
});

test('originaler breiter Kommentarbutton erlaubt Bodydrag, sein kurzer Tap und echte innere Aktionen bleiben original', async t => {
  for(const targetKind of ['details','text','reaction','link','input','reply']) {
    const env=setup(t), panel=env.mount();await env.flush();env.animations[0].finish();
    const body=panel.querySelector('.engagement-panel-content-wrapper'), comment=env.doc.createElement('ytm-comment-renderer');
    comment.innerHTML='<button class="YtmCommentRendererContent"><span class="YtmCommentRendererText">Kommentartext</span><div class="YtmCommentRendererDetails"></div><a href="#channel">Kanal</a><input></button><button data-langform-comment-reaction="like">Like</button><button class="reply">Antworten</button>';body.append(comment);
    const target=comment.querySelector({details:'.YtmCommentRendererDetails',text:'.YtmCommentRendererText',reaction:'[data-langform-comment-reaction]',link:'a',input:'input',reply:'.reply'}[targetKind]);
    let clicks=0;target.addEventListener('click',()=>clicks++);
    dragEvent(env,target,'pointerdown',100,400);dragEvent(env,target,'pointerup',100,400);target.click();assert.equal(clicks,1,'kurzer Originaltap '+targetKind);
    let closes=0;panel.querySelector('.close-button button').addEventListener('click',()=>closes++);
    dragEvent(env,target,'pointerdown',100,400);const move=dragEvent(env,target,'pointermove',100,680);dragEvent(env,target,'pointerup',100,680);
    const owns=['details','text'].includes(targetKind);assert.equal(move.defaultPrevented,owns,targetKind);
    if(owns){env.animations.at(-1).finish();assert.equal(closes,1);}
    else assert.equal(closes,0);
  }
});

test('WebKit detached shell with zero time and null start retains elapsed entrance and accepted2x clock',async t=>{
  for(const accelerate of [false,true]) {
    const env=setup(t);let now=1000;Object.defineProperty(env.win.performance,'now',{configurable:true,value:()=>now});
    const panel=env.push(skeleton);await env.flush();const old=env.animations[0];old.startTime=null;
    if(accelerate){now=1040;env.touch(panel.querySelector('.engagement-panel-content-wrapper'));}
    now=1068;old.currentTime=0;panel.innerHTML=comments;await env.flush();
    assert.equal(env.animations[1].currentTime,accelerate?96:68,'detaching must not restart the already visible shell');
    assert.equal(env.animations[1].playbackRate,accelerate?2:1);
  }
});
test('detached expired entrance clamps to finish and explicit paused zero retains its chosen playhead',async t=>{
  for(const paused of [false,true]){
    const env=setup(t);let now=1000;Object.defineProperty(env.win.performance,'now',{configurable:true,value:()=>now});const panel=env.push(skeleton);await env.flush();
    const old=env.animations[0];old.startTime=null;old.currentTime=0;if(paused)old.playState='paused';now=1600;panel.innerHTML=comments;await env.flush();
    assert.equal(env.animations[1].currentTime,paused?0:300);
  }
});

test('accepted2x remains accepted across detach even while WebKit playbackRate readback still reports1',async t=>{
  const env=setup(t);let now=1000;Object.defineProperty(env.win.performance,'now',{configurable:true,value:()=>now});const panel=env.push(skeleton);await env.flush();const old=env.animations[0];old.startTime=null;old.updatePlaybackRate=rate=>old.rates.push(rate);
  now=1040;env.touch(panel.querySelector('.engagement-panel-content-wrapper'));assert.equal(old.playbackRate,1);now=1068;panel.innerHTML=comments;await env.flush();assert.equal(env.animations[1].currentTime,96);assert.equal(env.animations[1].playbackRate,2);
});

test('pending2x rebases a finite old1x timeline without doubling the time before acceleration',async t=>{
  const env=setup(t);let now=1000;Object.defineProperty(env.win.performance,'now',{configurable:true,value:()=>now});const panel=env.push(skeleton);await env.flush();const old=env.animations[0];old.startTime=5000;old.updatePlaybackRate=rate=>old.rates.push(rate);
  now=1040;old.currentTime=40;env.touch(panel.querySelector('.engagement-panel-content-wrapper'));now=1068;old.currentTime=68;panel.innerHTML=comments;await env.flush();const replacement=env.animations[1];assert.equal(replacement.currentTime,96);assert.equal(replacement.startTime,undefined);assert.equal(replacement.playbackRate,2);
  replacement.playbackRate=1;replacement.updatePlaybackRate=rate=>replacement.rates.push(rate);const count=replacement.rates.length;env.touch(panel.querySelector('.engagement-panel-content-wrapper'));assert.equal(replacement.rates.length,count,'replacement remembers the already accepted pending2x request');
});
