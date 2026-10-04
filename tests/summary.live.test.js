const test = require("node:test");
const assert = require("node:assert/strict");
const summary = require("../extension/src/summary.js");

const VIDEO_ID = "dQw4w9WgXcQ";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
const SOCS =
  "SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI4LjA3X3AxGgJkZSACGgYIgJS_rwY";

function parseObject(html, key) {
  const token = '"' + key + '":';
  const at = html.indexOf(token);
  if (at < 0) return null;
  const start = html.indexOf("{", at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html.charAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(start, i + 1));
    }
  }
  return null;
}

function cookieHeader(response) {
  const list = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const pairs = list.map(function (item) {
    return String(item).split(";")[0];
  });
  if (!pairs.some(function (item) { return item.indexOf("SOCS=") === 0; })) pairs.push(SOCS);
  return pairs.join("; ");
}

test("öffentliches Video liefert Untertitel über den WEB-Player", { timeout: 30000 }, async function () {
  const page = await fetch("https://www.youtube.com/?hl=de", {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "de-DE,de;q=0.9",
      Cookie: SOCS,
    },
  });
  assert.equal(page.status, 200);
  const html = await page.text();
  const cookies = cookieHeader(page);
  const ytcfg = {
    INNERTUBE_API_KEY: JSON.parse('"' + html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)[1] + '"'),
    INNERTUBE_CONTEXT: parseObject(html, "INNERTUBE_CONTEXT"),
    STS: Number(html.match(/"STS":(\d+)/)[1]),
  };
  assert.equal(ytcfg.INNERTUBE_CONTEXT.client.clientName, "WEB");
  assert.ok(ytcfg.STS > 0);
  const calls = [];
  let captionBody = "";
  const result = await summary.loadSummary(VIDEO_ID, {
    pageUrl: "https://www.youtube.com/",
    ytcfg: ytcfg,
    fetchText(url, init) {
      const href = String(url);
      calls.push(href);
      assert.equal(href.includes("googlevideo"), false);
      const headers = Object.assign(
        {
          "User-Agent": UA,
          "Accept-Language": "de-DE,de;q=0.9",
          Origin: "https://www.youtube.com",
          Referer: "https://www.youtube.com/",
          Cookie: cookies,
        },
        (init && init.headers) || {}
      );
      return fetch(href, {
        method: (init && init.method) || "GET",
        headers: headers,
        body: init && init.body,
      }).then(function (response) {
        if (!response.ok) throw new Error(String(response.status));
        return response.text();
      }).then(function (text) {
        if (href.includes("/api/timedtext") && text.trim()) captionBody = text;
        return text;
      });
    },
  });
  assert.ok(calls.some(function (url) { return url.includes("/youtubei/v1/player"); }));
  assert.ok(calls.some(function (url) { return url.includes("/api/timedtext"); }));
  assert.equal(calls.some(function (url) { return url.includes("/watch?"); }), false);
  assert.ok(captionBody.length > 40);
  assert.equal(result.message, summary.UNAVAILABLE);
  assert.equal(result.summary, undefined);
  assert.equal(String(result.message).includes("Liebe"), false);
  assert.equal(captionBody.includes(result.message), false);
});

test("Watch-Seite: null ist kein Player, die signierte Spur hat Text", { timeout: 30000 }, async function () {
  assert.equal(summary.extractPlayer("var ytInitialPlayerResponse = null;", VIDEO_ID), null);
  const response = await fetch("https://www.youtube.com/watch?v=" + VIDEO_ID + "&hl=de", {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "de-DE,de;q=0.9",
      Cookie: SOCS,
    },
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  const cookies = cookieHeader(response);
  const player = summary.extractPlayer(html, VIDEO_ID);
  assert.equal(player.videoDetails.videoId, VIDEO_ID);
  const tracks = player.captions.playerCaptionsTracklistRenderer.captionTracks;
  assert.ok(tracks.length > 0);
  const ytcfg = {
    INNERTUBE_API_KEY: JSON.parse('"' + html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)[1] + '"'),
    INNERTUBE_CONTEXT: parseObject(html, "INNERTUBE_CONTEXT"),
    STS: Number(html.match(/"STS":(\d+)/)[1]),
  };
  const calls = [];
  let captionBody = "";
  const result = await summary.loadSummary(VIDEO_ID, {
    watchPage: true,
    player: player,
    ytcfg: ytcfg,
    pageUrl: "https://www.youtube.com/watch?v=" + VIDEO_ID,
    fetchText(url, init) {
      const href = String(url);
      calls.push(href);
      assert.equal(href.includes("googlevideo"), false);
      assert.equal(href.includes("/watch"), false);
      assert.match(href, /\/api\/timedtext|\/youtubei\/v1\/player/);
      const headers = Object.assign(
        {
          "User-Agent": UA,
          "Accept-Language": "de-DE,de;q=0.9",
          Origin: "https://www.youtube.com",
          Referer: "https://www.youtube.com/watch?v=" + VIDEO_ID,
          Cookie: cookies,
        },
        (init && init.headers) || {}
      );
      return fetch(href, {
        method: (init && init.method) || "GET",
        headers: headers,
        body: init && init.body,
      }).then(function (captionResponse) {
        if (!captionResponse.ok) throw new Error(String(captionResponse.status));
        return captionResponse.text();
      }).then(function (text) {
        if (href.includes("/api/timedtext") && text.trim()) captionBody = text;
        return text;
      });
    },
  });
  assert.ok(calls.some(function (url) { return url.includes("/api/timedtext"); }));
  assert.ok(calls.some(function (url) { return url.includes("/youtubei/v1/player"); }));
  assert.ok(captionBody.length > 40);
  assert.ok(summary.textFromCaptions(captionBody).length > 20);
  assert.equal(result.message, summary.UNAVAILABLE);
  assert.notEqual(result.message, summary.EMPTY_CAPTIONS);
  assert.equal(String(result.message).includes("Liebe"), false);
});
