import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("YOUTUBE_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Anfragen für Startseite und Videodaten", () => {
  it("verwirft eine schnelle falsche Invidious-ID und wartet auf die passende Videoquelle", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("invidious.f5.si/api/v1/videos/")) return Promise.resolve(Response.json({ videoId: "lmnopqrstuv", title: "Falsches Video", lengthSeconds: 600 }));
      if (url.includes("inv.nadeko.net/api/v1/videos/")) return new Promise<Response>((resolve) => { finish = resolve; });
      return Promise.reject(new Error("Quelle offline"));
    }));
    const { loadWatch } = await import("@/lib/metadata");
    const request = loadWatch("abcdefghijk");
    await new Promise((resolve) => setTimeout(resolve, 0));
    finish(Response.json({ videoId: "abcdefghijk", title: "Passende Doku", lengthSeconds: 600 }));
    expect(await request).toMatchObject({ video: { id: "abcdefghijk", title: "Passende Doku" } });
  });

  it("cached keine fremde Video-ID unter der angeforderten ID und ermöglicht erneuten Abruf", async () => {
    const fetcher = vi.fn((url: string) => url.includes("/api/v1/videos/")
      ? Promise.resolve(Response.json({ videoId: "lmnopqrstuv", title: "Falsches Video", lengthSeconds: 600 }))
      : Promise.reject(new Error("Quelle offline")));
    vi.stubGlobal("fetch", fetcher);
    const { loadWatch } = await import("@/lib/metadata");
    await expect(loadWatch("abcdefghijk")).rejects.toThrow("Die Filmdaten sind gerade nicht erreichbar");
    const previousCalls = fetcher.mock.calls.length;
    fetcher.mockImplementation((url: string) => url.includes("/api/v1/videos/")
      ? Promise.resolve(Response.json({ videoId: "abcdefghijk", title: "Passende Doku", lengthSeconds: 600 }))
      : Promise.reject(new Error("Quelle offline")));
    expect(await loadWatch("abcdefghijk")).toMatchObject({ video: { id: "abcdefghijk" } });
    expect(fetcher.mock.calls.length).toBeGreaterThan(previousCalls);
  });

  it("verwirft auch die falsche Video-ID einer YouTube-Antwort vor dem Cache", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-only-key");
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("googleapis.com/youtube/v3/videos")) return Promise.resolve(Response.json({ items: [{ id: "lmnopqrstuv", snippet: { title: "Falsches Video" }, contentDetails: { duration: "PT10M" } }] }));
      if (url.includes("/api/v1/videos/")) return Promise.resolve(Response.json({ videoId: "abcdefghijk", title: "Passende Doku", lengthSeconds: 600 }));
      return Promise.reject(new Error("Quelle offline"));
    }));
    const { loadWatch } = await import("@/lib/metadata");
    expect(await loadWatch("abcdefghijk")).toMatchObject({ video: { id: "abcdefghijk", title: "Passende Doku" } });
  });

  it("lässt eine schnelle leere Piped-Antwort brauchbare Videodaten nicht verdrängen", async () => {
    const pending: ((response: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/streams/")) return Promise.resolve(Response.json({}));
      if (url.includes("/api/v1/videos/")) return new Promise<Response>((resolve) => pending.push(resolve));
      return Promise.reject(new Error("Quelle offline"));
    }));
    const { loadWatch } = await import("@/lib/metadata");
    const request = loadWatch("abcdefghijk");
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const resolve of pending) resolve(Response.json({ videoId: "abcdefghijk", title: "Lange Doku", lengthSeconds: 600 }));
    expect(await request).toMatchObject({ video: { title: "Lange Doku", durationSeconds: 600 } });
  });

  it("fragt bei zwei gleichzeitigen Starts jede öffentliche Quelle nur einmal ab", async () => {
    const pending: ((response: Response) => void)[] = [];
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
    vi.stubGlobal("fetch", fetcher);
    const { loadHome } = await import("@/lib/metadata");
    const first = loadHome();
    const second = loadHome();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher).toHaveBeenCalledTimes(6);
    for (const resolve of pending) resolve(Response.json([{ videoId: "abcdefghijk", title: "Doku", lengthSeconds: 600 }]));
    expect(await first).toHaveLength(1);
    expect(await second).toHaveLength(1);
  });

  it("liefert Hauptmetadaten ohne eine langsame optionale Suche nach ähnlichen Videos abzuwarten", async () => {
    const fetcher = vi.fn((url: string) => {
      if (url.includes("/oembed")) return Promise.resolve(Response.json({ title: "Lange Doku", author_name: "Arte" }));
      if (url.includes("/search?")) return new Promise<Response>(() => {});
      return Promise.reject(new Error("Quelle offline"));
    });
    vi.stubGlobal("fetch", fetcher);
    const { loadWatch } = await import("@/lib/metadata");
    vi.useFakeTimers();
    let result: Awaited<ReturnType<typeof loadWatch>> | null = null;
    void loadWatch("abcdefghijk").then((details) => { result = details; });
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toMatchObject({ video: { title: "Lange Doku" } });
  });
});
