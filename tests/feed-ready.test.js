const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const source = fs.readFileSync(path.join(__dirname, "../ios/Langform/Langform/FeedMotion.js"), "utf8");

const video = '<ytm-rich-item-renderer id="content"><a href="/watch?v=abcdefghijk"><img id="thumbnail" src="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg">A real video</a></ytm-rich-item-renderer>';
function setup(t, markup = "", options = {}) {
  const dom = new JSDOM(markup, { url: options.url || "https://m.youtube.com/", runScripts: "outside-only", pretendToBeVisual: true });
  const win = dom.window, doc = win.document, posts = [], frames = new Map(), reads = [], rects = new WeakMap(), imageStates = new WeakMap();
  let serial = 0, hidden = !!options.hidden;
  Object.defineProperty(doc, "hidden", { get: () => hidden });
  win.__langformFeedActive = false;
  win.webkit = { messageHandlers: { langformFeedReady: { postMessage(body) { posts.push(JSON.parse(JSON.stringify(body))); } } } };
  // No animation APIs or open-watch bridge: readiness is a content signal and
  // must work under Reduce Motion and on an inactive retained feed.
  win.requestAnimationFrame = callback => { const id = ++serial; frames.set(id, callback); return id; };
  win.cancelAnimationFrame = id => frames.delete(id);
  win.Element.prototype.getBoundingClientRect = function () {
    reads.push(this);
    return rects.get(this) || { left: 0, top: 100, right: 390, bottom: 340, width: 390, height: 240 };
  };
  for (const [property, fallback] of [["complete", true], ["naturalWidth", 390], ["naturalHeight", 220]]) {
    Object.defineProperty(win.HTMLImageElement.prototype, property, { get() { return imageStates.get(this)?.[property] ?? fallback; } });
  }
  t.after(() => { win.dispatchEvent(new win.Event("pagehide")); dom.window.close(); });
  win.eval(source);
  return { win, doc, posts, frames, reads,
    rect(id, value) { rects.set(doc.getElementById(id), value); },
    image(id, value) { imageStates.set(doc.getElementById(id), value); },
    async frame() {
      for (let i = 0; i < 4; i++) await Promise.resolve();
      const batch = [...frames.values()]; frames.clear();
      batch.forEach(callback => callback());
      for (let i = 0; i < 4; i++) await Promise.resolve();
    },
    async paint() { for (let i = 0; i < 4; i++) await this.frame(); },
    event(name) { win.dispatchEvent(new win.Event(name)); },
    hidden(value) { hidden = value; doc.dispatchEvent(new win.Event("visibilitychange")); },
  };
}

test("Refresh cover release waits for a real renderer and two paint opportunities", async t => {
  const s = setup(t, video);
  await s.frame();
  assert.equal(s.posts.length, 0);
  await s.frame();
  assert.equal(s.posts.length, 0, "the first compositor opportunity still holds the snapshot");
  await s.frame();
  assert.deepEqual(s.posts, [{ href: "https://m.youtube.com/", documentToken: s.win.__langformFeedDocumentToken }]);
  assert.equal(s.win.__langformFeedDocumentToken, String(s.win.performance.timeOrigin));
  const before = s.reads.length;
  s.doc.body.insertAdjacentHTML("beforeend", video); await s.paint();
  s.event("langform-feed-visibility"); await s.paint();
  assert.equal(s.posts.length, 1);
  assert.equal(s.reads.length, before, "successful readiness disconnects observation");
  assert.equal(s.frames.size, 0);
});

test("Blank pages, spinners, pagination and Shorts alone never release the refresh cover", async t => {
  const s = setup(t, '<ytm-loading-renderer>Loading</ytm-loading-renderer><ytm-continuation-item-renderer>More</ytm-continuation-item-renderer><ytm-rich-item-renderer><a href="/shorts/abcdefghijk">Shorts</a></ytm-rich-item-renderer><ytm-message-renderer></ytm-message-renderer>');
  await s.paint();
  assert.equal(s.posts.length, 0);
  assert.equal(s.reads.length, 0);
  s.doc.body.insertAdjacentHTML("beforeend", video);
  await s.paint();
  assert.equal(s.posts.length, 1, "arrival of playable feed content releases it");
});

test("Metadata hydration turns an existing skeleton into ready content", async t => {
  const s = setup(t, '<ytm-video-with-context-renderer id="content"></ytm-video-with-context-renderer>');
  await s.paint();
  assert.equal(s.posts.length, 0);
  s.doc.getElementById("content").innerHTML = '<a href="/watch?v=abcdefghijk"><img src="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg">A real video</a>';
  await s.paint();
  assert.equal(s.posts.length, 1);
});

test("Text-only hydration of an existing empty/error message releases the cover after useful paint", async t => {
  for (const tag of ["ytm-message-renderer", "ytm-error-message-renderer"]) {
    const s = setup(t, '<' + tag + ' id="message"></' + tag + '><ytm-loading-renderer id="loading"></ytm-loading-renderer>');
    const messageText = s.doc.createTextNode("");
    const loadingText = s.doc.createTextNode("");
    s.doc.getElementById("message").append(messageText);
    s.doc.getElementById("loading").append(loadingText);
    await s.paint();
    loadingText.data = "Still loading";
    messageText.data = "   ";
    await s.paint();
    assert.equal(s.posts.length, 0, "loading text and a whitespace-only message cannot announce readiness");
    messageText.data = "No videos found";
    await s.frame(); await s.frame();
    assert.equal(s.posts.length, 0, "text hydration still waits for two compositor opportunities");
    await s.frame();
    assert.equal(s.posts.length, 1);
    messageText.data = "No new videos found";
    await s.paint();
    assert.equal(s.posts.length, 1, "later text changes do not replay readiness");
  }
});

for (const attributes of ['hidden', 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"', 'style="opacity:0"']) {
  test("Hidden parent content keeps the refresh cover: " + attributes, async t => {
    const s = setup(t, '<section id="parent" ' + attributes + '>' + video + '</section>');
    await s.paint();
    assert.equal(s.posts.length, 0);
    const parent = s.doc.getElementById("parent");
    parent.removeAttribute("hidden"); parent.removeAttribute("aria-hidden"); parent.removeAttribute("style");
    await s.paint();
    assert.equal(s.posts.length, 1);
  });
}

test("Removing a candidate before its useful paint does not announce a blank feed", async t => {
  const s = setup(t, video);
  await s.frame(); await s.frame();
  s.doc.getElementById("content").remove();
  await s.paint();
  assert.equal(s.posts.length, 0);
  s.doc.body.insertAdjacentHTML("beforeend", video);
  await s.paint();
  assert.equal(s.posts.length, 1);
});

test("Navigation and pagehide invalidate old paint callbacks", async t => {
  const s = setup(t, video);
  await s.frame(); await s.frame();
  s.event("yt-navigate-start");
  await s.paint();
  assert.equal(s.posts.length, 0);
  s.win.history.replaceState({}, "", "/feed/subscriptions");
  s.doc.body.innerHTML = video;
  s.event("yt-navigate-finish"); await s.frame();
  s.event("pagehide"); await s.paint();
  assert.equal(s.posts.length, 0);
  s.event("pageshow"); await s.paint();
  assert.equal(s.posts.length, 1);
  assert.equal(s.posts[0].href, "https://m.youtube.com/feed/subscriptions");
});

test("Channel search results and an explicit empty/error feed count as useful rendered content", async t => {
  for (const markup of ['<ytm-channel-renderer><a href="/@channel">A channel</a></ytm-channel-renderer>', '<ytm-message-renderer>No videos</ytm-message-renderer>', '<ytm-error-message-renderer>Could not load this feed</ytm-error-message-renderer>']) {
    const s = setup(t, markup, { url: "https://m.youtube.com/results?search_query=podcast" });
    await s.paint();
    assert.equal(s.posts.length, 1);
  }
});

test("Background documents and watch pages wait or skip readiness", async t => {
  const s = setup(t, video, { hidden: true });
  await s.paint(); assert.equal(s.posts.length, 0);
  s.hidden(false); await s.paint(); assert.equal(s.posts.length, 1);
  const watch = setup(t, video, { url: "https://m.youtube.com/watch?v=abcdefghijk" });
  await watch.paint(); assert.equal(watch.posts.length, 0);
  assert.equal(watch.frames.size, 0);
});

for (const host of ["www.youtube.com", "youtube.com"]) {
  test("Desktop host refresh readiness accepts actual rows and lockups: " + host, async t => {
    for (const markup of ['<ytd-video-renderer><a href="/watch?v=abcdefghijk"><img src="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg">A real video</a></ytd-video-renderer>', '<yt-lockup-view-model><a href="https://' + host + '/watch?v=abcdefghijk"><img src="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg">A real video</a></yt-lockup-view-model>', '<ytd-message-renderer>No videos found</ytd-message-renderer>']) {
      const s = setup(t, markup, { url: "https://" + host + "/" });
      await s.paint();
      assert.equal(s.posts.length, 1);
      assert.equal(s.posts[0].href, "https://" + host + "/");
    }
    const blank = setup(t, '<ytd-continuation-item-renderer>More</ytd-continuation-item-renderer>', { url: "https://" + host + "/" });
    await blank.paint();
    assert.equal(blank.posts.length, 0, "the desktop sentinel alone cannot release the cover");
  });
}

test("Unrelated hosts cannot announce native feed readiness", async t => {
  const s = setup(t, video, { url: "https://example.com/" });
  await s.paint();
  assert.equal(s.posts.length, 0);
  assert.equal(s.frames.size, 0);
});


test("A visible hydrated video waits for its thumbnail load or explicit failure without polling unrelated images", async t => {
  const s = setup(t, video + '<img id="unrelated" src="https://example.com/elsewhere.jpg">');
  s.image("thumbnail", { complete: false, naturalWidth: 0, naturalHeight: 0 });
  await s.paint();
  assert.equal(s.posts.length, 0);
  const before = s.reads.length;
  s.doc.getElementById("unrelated").dispatchEvent(new s.win.Event("load"));
  await s.paint();
  assert.equal(s.reads.length, before, "unrelated image events do not scan the document");
  assert.equal(s.frames.size, 0, "a pending image does not leave a polling frame loop");
  s.image("thumbnail", { complete: true, naturalWidth: 390, naturalHeight: 220 });
  s.doc.getElementById("thumbnail").dispatchEvent(new s.win.Event("load"));
  await s.paint();
  assert.equal(s.posts.length, 1);

  const failed = setup(t, video);
  failed.image("thumbnail", { complete: true, naturalWidth: 0, naturalHeight: 0 });
  await failed.paint();
  assert.equal(failed.posts.length, 0);
  failed.doc.getElementById("thumbnail").dispatchEvent(new failed.win.Event("error"));
  await failed.paint();
  assert.equal(failed.posts.length, 1, "an explicit thumbnail failure leaves a usable row instead of holding stale content forever");
});

test("Thumbnail decode completion and two stable viewport frames precede readiness", async t => {
  const s = setup(t, video);
  let decoded;
  s.doc.getElementById("thumbnail").decode = () => new Promise(resolve => { decoded = resolve; });
  await s.paint();
  assert.equal(s.posts.length, 0, "resource completion alone does not prove a painted bitmap");
  decoded(); await s.frame();
  s.rect("content", { left: 0, top: 104, right: 390, bottom: 344, width: 390, height: 240 });
  await s.frame();
  s.rect("content", { left: 0, top: 106, right: 390, bottom: 346, width: 390, height: 240 });
  await s.frame();
  assert.equal(s.posts.length, 0, "layout changes reset the rest-frame count");
  await s.frame();
  assert.equal(s.posts.length, 0);
  await s.frame();
  assert.equal(s.posts.length, 1);
});

test("A channel metadata link alone cannot make a video skeleton ready", async t => {
  const s = setup(t, '<ytm-rich-item-renderer><a href="/@channel">A channel</a></ytm-rich-item-renderer>');
  await s.paint();
  assert.equal(s.posts.length, 0);
});

test("An image outside the viewport does not delay an otherwise useful visible row", async t => {
  const s = setup(t, video);
  s.image("thumbnail", { complete: false, naturalWidth: 0, naturalHeight: 0 });
  s.rect("thumbnail", { left: 0, top: -300, right: 390, bottom: -80, width: 390, height: 220 });
  await s.paint();
  assert.equal(s.posts.length, 1);
});

test("An aborted old decode cannot release a newly loading thumbnail whose currentSrc is still stale", async t => {
  const s = setup(t, video);
  const image = s.doc.getElementById("thumbnail");
  const oldSource = image.getAttribute("src");
  let rejectOld;
  Object.defineProperty(image, "currentSrc", { get: () => oldSource });
  image.decode = () => new Promise((_, reject) => { rejectOld = reject; });
  await s.paint();
  image.setAttribute("src", "https://i.ytimg.com/vi/another1234/hqdefault.jpg");
  s.image("thumbnail", { complete: false, naturalWidth: 0, naturalHeight: 0 });
  rejectOld(new Error("old request replaced"));
  await s.paint();
  assert.equal(s.posts.length, 0);
  assert.equal(s.frames.size, 0, "the replacement waits for its own load/error event");
});
