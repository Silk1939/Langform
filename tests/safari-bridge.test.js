const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const pageSource = fs.readFileSync(path.join(__dirname, "../extension/src/page-captions.js"), "utf8");

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
