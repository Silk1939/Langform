const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

require("../extension/src/early.js");
require("../extension/src/logic.js");
require("../extension/src/hide.js");
require("../extension/src/controller.js");
require("../extension/src/summary.js");

const ns = globalThis.ShortsAusblenden;

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

function loadDom(name, url) {
  return new JSDOM(fixture(name), { url: url || "https://www.youtube.com/" });
}

function marked(el) {
  return !!(el && el.getAttribute(ns.hide.MARK) === "1");
}

function createStorage(enabled) {
  const data = { enabled: enabled };
  const listeners = [];
  return {
    local: {
      get(_key, cb) {
        setTimeout(function () {
          cb({ enabled: data.enabled });
        }, 0);
      },
    },
    onChanged: {
      addListener(fn) {
        listeners.push(fn);
      },
    },
    setEnabled(value) {
      const oldValue = data.enabled;
      data.enabled = value;
      listeners.forEach(function (fn) {
        fn({ enabled: { oldValue: oldValue, newValue: value } }, "local");
      });
    },
  };
}

function boot(options) {
  const dom = new JSDOM(options.html || "<!DOCTYPE html><html><body></body></html>", {
    url: options.url || "https://www.youtube.com/",
  });
  const win = dom.window;
  win.ShortsAusblenden = ns;
  if (options.flag === "0" || options.flag === "1") {
    win.localStorage.setItem(ns.logic.STORAGE_FLAG, options.flag);
  }
  const redirects = [];
  const reloads = [];
  const storage = createStorage(options.enabled !== false);
  ns.controller.start(win, storage, {
    redirect(url) {
      redirects.push(url);
    },
    reload() {
      reloads.push(win.location.href);
    },
  });
  return { dom: dom, win: win, redirects: redirects, reloads: reloads, storage: storage };
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

module.exports = {
  ns: ns,
  fixture: fixture,
  loadDom: loadDom,
  marked: marked,
  boot: boot,
  delay: delay,
};
