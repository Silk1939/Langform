import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const A = `UC${"a".repeat(22)}`, B = `UC${"b".repeat(22)}`;
type Source = "invidious" | "piped" | "youtube";

beforeEach(() => { vi.resetModules(); vi.stubEnv("YOUTUBE_API_KEY", ""); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function channelSource(source: Source, id: () => string | undefined) {
  if (source === "youtube") vi.stubEnv("YOUTUBE_API_KEY", "test-only-key");
  const fetcher = vi.fn((url: string) => {
    if (source === "youtube" && url.includes("googleapis.com/youtube/v3/channels?")) {
      return Promise.resolve(Response.json({ items: [{ id: id(), snippet: { title: "Kanalquelle" } }] }));
    }
    if (source === "youtube" && url.includes("googleapis.com/youtube/v3/search?")) {
      return Promise.resolve(Response.json({ items: [] }));
    }
    if (source === "invidious" && url.includes("invidious.f5.si/api/v1/channels/")) {
      return Promise.resolve(Response.json(url.includes("/videos?") ? [] : { authorId: id(), author: "Kanalquelle" }));
    }
    if (source === "piped" && url.includes("api.piped.private.coffee/channel/")) {
      return Promise.resolve(Response.json({ id: id(), name: "Kanalquelle", relatedStreams: [] }));
    }
    return Promise.reject(new Error("Quelle offline"));
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("Kanalidentität vor Quellenakzeptanz und Cache", () => {
  it.each<Source>(["invidious", "piped", "youtube"])(
    "verwirft %s-Daten für B unter A und hält einen neuen passenden Abruf offen",
    async (source) => {
      let returnedId = B;
      const fetcher = channelSource(source, () => returnedId);
      const { loadChannel } = await import("@/lib/metadata");
      await expect(loadChannel(A)).rejects.toThrow("Die Filmdaten sind gerade nicht erreichbar");
      const callsBeforeRetry = fetcher.mock.calls.length;
      returnedId = A;
      expect(await loadChannel(A)).toMatchObject({ channel: { id: A, name: "Kanalquelle" } });
      expect(fetcher.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
      const callsAfterRetry = fetcher.mock.calls.length;
      expect(await loadChannel(A)).toMatchObject({ channel: { id: A } });
      expect(fetcher).toHaveBeenCalledTimes(callsAfterRetry);
    },
  );

  it.each<Source>(["invidious", "piped", "youtube"])(
    "erhält den bisherigen angefragten ID-Fallback bei fehlender %s-ID",
    async (source) => {
      channelSource(source, () => undefined);
      const { loadChannel } = await import("@/lib/metadata");
      expect(await loadChannel(A)).toMatchObject({ channel: { id: A, name: "Kanalquelle" } });
    },
  );

  it("lässt eine schnelle fremde Quelle die langsamere passende Kanalantwort nicht verdrängen", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/videos?")) return Promise.resolve(Response.json([]));
      if (url.includes("invidious.f5.si/api/v1/channels/")) return Promise.resolve(Response.json({ authorId: B, author: "Fremder Kanal" }));
      if (url.includes("inv.nadeko.net/api/v1/channels/")) return new Promise<Response>((resolve) => { finish = resolve; });
      return Promise.reject(new Error("Quelle offline"));
    }));
    const { loadChannel } = await import("@/lib/metadata");
    const request = loadChannel(A);
    await new Promise((resolve) => setTimeout(resolve, 0));
    finish(Response.json({ authorId: A, author: "Passender Kanal" }));
    expect(await request).toMatchObject({ channel: { id: A, name: "Passender Kanal" } });
  });
});
