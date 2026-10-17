import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
beforeEach(() => { vi.resetModules(); vi.stubEnv("YOUTUBE_API_KEY", ""); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("oEmbed ersetzt keine verfügbare Kurzvideo-Prüfung", () => {
  it.each([
    { duration: 30, short: false, blocked: true },
    { duration: 600, short: false, blocked: false },
    { duration: 180, short: true, blocked: true },
  ])("wartet auf vollständige Daten vor dem oEmbed-Fallback: %j", async ({ duration, short, blocked }) => {
    const fetcher = vi.fn((url: string, options: RequestInit) => {
      if (url.includes("/oembed?")) return Promise.resolve(Response.json({ title: "Film ohne Hashtag", author_name: "Autor" }));
      if (url.includes("invidious.f5.si/api/v1/videos/")) return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(Response.json({ videoId: "abcdefghijk", title: "Film ohne Hashtag", lengthSeconds: duration, isShort: short })), 20);
        options.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(options.signal!.reason); }, { once: true });
      });
      return Promise.reject(new Error("Quelle offline"));
    });
    vi.stubGlobal("fetch", fetcher);
    const { loadWatch } = await import("@/lib/metadata");
    expect(await loadWatch("abcdefghijk")).toMatchObject({ video: { durationSeconds: duration }, blocked });
    const calls = fetcher.mock.calls.length;
    expect(await loadWatch("abcdefghijk")).toMatchObject({ video: { durationSeconds: duration }, blocked });
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });

  it("behält unbekannte Laufzeit als Fallback, wenn keine Quelle sie ergänzen kann", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/oembed?")) return Promise.resolve(Response.json({ title: "Film ohne Laufzeit", author_name: "Autor" }));
      return Promise.reject(new Error("Quelle offline"));
    }));
    const { loadWatch } = await import("@/lib/metadata");
    expect(await loadWatch("abcdefghijk")).toMatchObject({ video: { durationSeconds: null }, blocked: false });
  });

  it("beendet nach brauchbaren Detaildaten die übrigen Detailanfragen", async () => {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn((url: string, options: RequestInit) => {
      if (url.includes("invidious.f5.si/api/v1/videos/")) return Promise.resolve(Response.json({ videoId: "abcdefghijk", title: "Lange Doku", lengthSeconds: 600 }));
      return new Promise<Response>((_, reject) => {
        signals.push(options.signal!);
        options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const { loadWatch } = await import("@/lib/metadata");
    expect(await loadWatch("abcdefghijk")).toMatchObject({ blocked: false });
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("erreicht nach abgelaufenen Detailfristen weiterhin den oEmbed-Fallback", async () => {
    const deadlines: AbortController[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      expect(milliseconds).toBe(7000);
      const controller = new AbortController();
      deadlines.push(controller);
      return controller.signal;
    });
    vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => {
      if (url.includes("/oembed?")) return Promise.resolve(Response.json({ title: "Fallbackfilm", author_name: "Autor" }));
      return new Promise<Response>((_, reject) => options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true }));
    }));
    const { loadWatch } = await import("@/lib/metadata");
    const request = loadWatch("abcdefghijk");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const detailDeadlines = deadlines.slice();
    expect(detailDeadlines).toHaveLength(13);
    for (const controller of detailDeadlines) controller.abort(new DOMException("Timeout", "TimeoutError"));
    expect(await request).toMatchObject({ video: { title: "Fallbackfilm", durationSeconds: null }, blocked: false });
  });
});

it.each([
  { source: "invidious-search", duration: 30, isShort: false },
  { source: "piped-search", duration: 30, isShort: false },
  { source: "piped-search", duration: 180, isShort: true },
  { source: "unknown-detail", duration: 30, isShort: false },
  { source: "negative-detail", duration: 30, isShort: false },
  { source: "unknown-lookup", duration: 30, isShort: false },
  { source: "youtube-unknown", duration: 30, isShort: false },
])("bewahrt verfügbare Klassifikation trotz schneller unvollständiger Daten: %j", async ({ source, duration, isShort }) => {
  if (source === "youtube-unknown") vi.stubEnv("YOUTUBE_API_KEY", "test-only-key");
  vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => {
    if (url.includes("/oembed?")) return Promise.resolve(Response.json({ title: "Film", author_name: "Autor" }));
    if (source === "youtube-unknown" && url.includes("googleapis.com/youtube/v3/videos")) return Promise.resolve(Response.json({ items: [{ id: "abcdefghijk", snippet: { title: "Film" } }] }));
    if (source === "negative-detail" && url.includes("invidious.f5.si/api/v1/videos/")) return Promise.resolve(Response.json({ videoId: "abcdefghijk", title: "Film", lengthSeconds: -1 }));
    if (source === "unknown-detail" && url.includes("invidious.f5.si/api/v1/videos/")) return Promise.resolve(Response.json({ videoId: "abcdefghijk", title: "Film" }));
    if (source === "unknown-lookup" && url.includes("invidious.f5.si/api/v1/search?")) return Promise.resolve(Response.json([{ videoId: "abcdefghijk", title: "Film" }]));
    const chosen = (source === "unknown-detail" || source === "negative-detail") ? url.includes("inv.nadeko.net/api/v1/videos/")
      : source === "invidious-search" ? url.includes("invidious.f5.si/api/v1/search?")
      : url.includes("api.piped.private.coffee/search?");
    if (chosen) return new Promise<Response>((resolve, reject) => {
      const payload = (source === "unknown-detail" || source === "negative-detail") ? { videoId: "abcdefghijk", title: "Film", lengthSeconds: duration, isShort }
        : source === "invidious-search" ? [{ videoId: "abcdefghijk", title: "Film", lengthSeconds: duration, isShort }]
        : { items: [{ url: "/watch?v=abcdefghijk", title: "Film", duration, isShort }] };
      const timer = setTimeout(() => resolve(Response.json(payload)), 20);
      options.signal!.addEventListener("abort", () => { clearTimeout(timer); reject(options.signal!.reason); }, { once: true });
    });
    return Promise.reject(new Error("Quelle offline"));
  }));
  const { loadWatch } = await import("@/lib/metadata");
  expect(await loadWatch("abcdefghijk")).toMatchObject({ video: { id: "abcdefghijk", durationSeconds: duration }, blocked: true });
});
