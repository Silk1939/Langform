const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const pageSource = fs.readFileSync(path.join(__dirname, "../extension/src/page-captions.js"), "utf8");
const adblockSource = fs.readFileSync(path.join(__dirname, "../extension/src/page-adblock.js"), "utf8");

function makeWindow() {
  return new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://www.youtube.com/",
    runScripts: "outside-only",
  }).window;
}

test("Safari MAIN mit browser.runtime ohne Extension-ID installiert die Untertitelbrücke", async function (t) {
  const win = makeWindow();
  t.after(function () { win.close(); });
  // Safari exposes browser.runtime in MAIN too, but only the isolated
  // extension world has runtime.id and sendNativeMessage.
  win.browser = { runtime: {} };
  win.eval(pageSource);
  assert.equal(win.__langformPageCaptions, true);

  const response = new Promise(function (resolve, reject) {
    const timer = win.setTimeout(function () { reject(new Error("Untertitelbrücke antwortet nicht")); }, 1000);
    win.addEventListener("message", function onMessage(event) {
      const data = event.data;
      if (!data || data.source !== "langform-page-res" || data.id !== "safari-main-ping") return;
      win.clearTimeout(timer);
      win.removeEventListener("message", onMessage);
      resolve(data.payload);
    });
  });
  win.postMessage({ source: "langform-page-req", id: "safari-main-ping", op: "ping" }, "*");
  assert.equal((await response).ok, true);
});

test("früher Werbefilter erhält den tatsächlichen Transkript-Brückenpfad und Untertiteltext", async function (t) {
  const win = makeWindow(); t.after(() => win.close());
  win.browser = { runtime: {} };
  win.Response = class CaptionResponse extends Response {};
  const captionURL = 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=de';
  const text = '<transcript><text start="0" dur="3">Original &amp; vollständig</text></transcript>';
  const calls = [];
  win.fetch = async function (url, init) { calls.push({ url, init }); return new win.Response(text, { status: 200 }); };
  win.eval(adblockSource);
  win.ytInitialPlayerResponse = {
    adSlots: [{ adSlotRenderer: {} }], playerAds: [], adPlacements: [],
    videoDetails: { videoId: 'abcdefghijk' },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: captionURL, languageCode: 'de', kind: 'asr' }] } }
  };
  win.eval(pageSource);
  function request(id, body) {
    return new Promise((resolve, reject) => {
      const timer = win.setTimeout(() => reject(new Error('Brücke antwortet nicht')), 1000);
      const handler = event => {
        if (event.data?.source !== 'langform-page-res' || event.data.id !== id) return;
        win.removeEventListener('message', handler); win.clearTimeout(timer); resolve(event.data.payload);
      };
      win.addEventListener('message', handler);
      win.postMessage({ source: 'langform-page-req', id, ...body }, '*');
    });
  }
  const context = await request('adfilter-context', { op: 'context', videoId: 'abcdefghijk', watch: false });
  assert.equal(context.player.captions.playerCaptionsTracklistRenderer.captionTracks[0].baseUrl, captionURL);
  assert.equal('adSlots' in win.ytInitialPlayerResponse, false);
  const result = await request('adfilter-caption-fetch', { op: 'fetch', url: captionURL });
  assert.equal(result.text, text); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, captionURL); assert.equal(calls[0].init.credentials, 'include');
});

for (const binding of ["browser", "chrome"]) {
  test("Isolierte " + binding + "-Welt mit Extension-ID installiert keine Seitenbrücke", function (t) {
    const win = makeWindow();
    t.after(function () { win.close(); });
    win[binding] = { runtime: { id: "de.ipekkaya.shorts-ausblenden", sendNativeMessage() {} } };
    win.eval(pageSource);
    assert.equal(win.__langformPageCaptions, undefined);
    assert.equal(win.__langformChapters, undefined);
  });
}
