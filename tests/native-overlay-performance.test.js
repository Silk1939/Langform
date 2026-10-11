const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/WebViewLinks.js"), "utf8");

async function retainedPanels(t, count = 8) {
  const panels = Array.from({ length: count }, (_, i) => `<ytm-engagement-panel id="panel-${i}"><div>Panel ${i}</div></ytm-engagement-panel>`).join("");
  const dom = new JSDOM(`<main><div id="wrapper"><panel-container>${panels}</panel-container></div></main>`, {
    url: "https://m.youtube.com/watch?v=abcdefghijk", runScripts: "outside-only",
  });
  t.after(() => { dom.window.dispatchEvent(new dom.window.Event("pagehide")); dom.window.close(); });
  const win = dom.window, doc = win.document, timers = new Map(), posts = [], styleReads = new Map();
  let serial = 0, documentSearches = 0;
  win.setTimeout = (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; };
  win.clearTimeout = id => timers.delete(id);
  win.webkit = { messageHandlers: { langformOverlayState: { postMessage(body) { posts.push(body.open); } } } };
  const getStyle = win.getComputedStyle.bind(win);
  win.getComputedStyle = node => { styleReads.set(node, (styleReads.get(node) || 0) + 1); return getStyle(node); };
  win.eval(source);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  for (const [id, timer] of timers) { timers.delete(id); timer.callback(); }
  const query = doc.querySelectorAll.bind(doc);
  doc.querySelectorAll = selector => { documentSearches++; return query(selector); };
  styleReads.clear();
  return { win, doc, posts, timers, styleReads, flush,
    searches: () => documentSearches,
    reads: () => Array.from(styleReads.values()).reduce((sum, value) => sum + value, 0),
  };
}

test("gemeinsame Sheet-Vorfahren werden pro Mutationsturn nur einmal gelesen statt pro Panel-Beobachter", async t => {
  const env = await retainedPanels(t);
  const wrapper = env.doc.getElementById("wrapper");
  const reports = env.posts.length;
  // Every retained panel observes this ancestor. YouTube updates wrapper/body
  // classes during player controls and sheet motion, even while most panels
  // have been retained for reuse. Count work rather than mock elapsed time.
  wrapper.className = "controls-visible";
  env.doc.body.className = "player-controls-visible";
  await env.flush();
  assert.equal(env.posts.length, reports, "unchanged visibility does not send another native message");
  assert.equal(env.searches(), 0, "known panels never require another document scan");
  t.diagnostic(`8 retained panels, shared wrapper/body mutation: ${env.reads()} computed-style reads`);
  assert.ok(env.reads() <= 13, `8 panels + 5 shared ancestors need at most 13 style reads, received ${env.reads()}`);
  for (const reads of env.styleReads.values()) assert.equal(reads, 1, "one style snapshot per visited node in this mutation turn");
  assert.equal(env.timers.size, 0, "visibility batching adds no frame or timer delay");

  env.styleReads.clear();
  wrapper.style.display = "none";
  await env.flush();
  assert.equal(env.posts.at(-1), false, "retained hidden wrappers release native gestures");
  assert.ok(env.reads() <= 10, `hidden shared wrapper needs at most 10 style reads, received ${env.reads()}`);
  env.styleReads.clear();
  wrapper.style.display = "";
  await env.flush();
  assert.equal(env.posts.at(-1), true, "a later mutation invalidates every visibility snapshot");
  assert.ok(env.reads() <= 13);
});

test("gebündelte Sheet-Änderungen bewahren unabhängige Sperren und werden bei Pagehide verworfen", async t => {
  const env = await retainedPanels(t);
  const wrapper = env.doc.getElementById("wrapper");
  env.win.__langformSetOverlayState("discovery", true);
  wrapper.hidden = true;
  await env.flush();
  assert.equal(env.posts.at(-1), true, "hiding all YouTube sheets cannot release an independent menu");
  env.win.__langformSetOverlayState("discovery", false);
  assert.equal(env.posts.at(-1), false);
  wrapper.hidden = false;
  // Mutation observers run first; their queued visibility pass must still be
  // cancellable when the retained WebView leaves before that microtask runs.
  await Promise.resolve();
  env.win.dispatchEvent(new env.win.Event("pagehide"));
  const reports = env.posts.length;
  env.styleReads.clear();
  await env.flush();
  assert.equal(env.posts.length, reports);
  assert.equal(env.reads(), 0, "a hidden document performs no pending visibility pass");
  env.win.dispatchEvent(new env.win.Event("pageshow"));
  assert.equal(env.posts.at(-1), true, "restoration inspects current panels immediately");
});
