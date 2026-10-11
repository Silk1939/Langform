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

function setup(t, options = {}) {
  const dom = new JSDOM('<div id="movie_player"><video></video></div><button id="open">Kommentare</button><panel-container></panel-container>', {
    url: options.url || "https://m.youtube.com/watch?v=abcdefghijk", runScripts: "outside-only",
  });
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document;
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
  const env = setup(t), panel = env.push(skeleton); await env.flush();
  const oldFinish = env.animations[0].onfinish;
  panel.hidden = true; await env.flush(); panel.hidden = false; await env.flush(); oldFinish();
  assert.equal(env.animations.length, 2);
  assert.equal(env.animations[0].cancelled, true);
  assert.equal(env.animations[1].cancelled, false);
  panel.innerHTML = comments; await env.flush();
  assert.equal(env.animations.length, 3, "Hydration überträgt nur den laufenden neuen Eintritt");
  assert.equal(env.animations[2].currentTime, env.animations[1].currentTime);
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
      .find(rule => rule.selectorText === "ytm-engagement-panel .engagement-panel-section-list-background.at-top[" + marker + "]");
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
  const selector = "ytm-engagement-panel .engagement-panel-section-list-background.at-top[data-langform-comments-moving]";
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
