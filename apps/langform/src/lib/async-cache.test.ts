import { afterEach, describe, expect, it, vi } from "vitest";
import { createAsyncCache } from "@/lib/async-cache";

afterEach(() => vi.useRealTimers());

describe("Metadaten-Cache", () => {
  it("teilt gleichzeitig laufende Anfragen statt Quellen mehrfach abzufragen", async () => {
    const cache = createAsyncCache(180_000, 200);
    let resolve!: (value: string[]) => void;
    const load = vi.fn(() => new Promise<string[]>((done) => { resolve = done; }));
    const first = cache.load("home", load);
    const second = cache.load("home", load);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    resolve(["Doku"]);
    expect(await first).toEqual(["Doku"]);
    expect(await second).toEqual(["Doku"]);
  });

  it("merkt fehlgeschlagene Anfragen nicht und ermöglicht ein erneutes Laden", async () => {
    const cache = createAsyncCache(180_000, 200);
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(["Doku"]);
    await expect(cache.load("home", load)).rejects.toThrow("offline");
    expect(await cache.load("home", load)).toEqual(["Doku"]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("liefert frische Cachewerte, erneuert abgelaufene und unterstützt Aktualisieren", async () => {
    vi.useFakeTimers();
    const cache = createAsyncCache(1000, 200);
    const load = vi.fn().mockResolvedValueOnce("a").mockResolvedValueOnce("b").mockResolvedValueOnce("c");
    expect(await cache.load("home", load)).toBe("a");
    expect(await cache.load("home", load)).toBe("a");
    expect(await cache.load("home", load, true)).toBe("b");
    await vi.advanceTimersByTimeAsync(1001);
    expect(await cache.load("home", load)).toBe("c");
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("begrenzt gespeicherte Suchbegriffe und bewahrt zuletzt benutzte Einträge", async () => {
    const cache = createAsyncCache(180_000, 2);
    const load = vi.fn((value: string) => Promise.resolve(value));
    await cache.load("a", () => load("a"));
    await cache.load("b", () => load("b"));
    await cache.load("a", () => load("a"));
    await cache.load("c", () => load("c"));
    await cache.load("a", () => load("a"));
    expect(load).toHaveBeenCalledTimes(3);
    await cache.load("b", () => load("b"));
    expect(load).toHaveBeenCalledTimes(4);
  });
});
