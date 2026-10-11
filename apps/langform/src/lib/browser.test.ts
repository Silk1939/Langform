import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchJson } from "@/lib/browser";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function stalled(signal: AbortSignal) {
  return new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

describe("Browser-Anfragen bei hängender Verbindung", () => {
  it.each(["<html>Proxyfehler</html>", "", '{"videos":'])(
    "weist eine erfolgreiche Antwort mit unlesbarem JSON verständlich zurück: %s",
    async (body) => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
      await expect(fetchJson("/api/home")).rejects.toThrow("Die Antwort konnte nicht gelesen werden. Bitte erneut laden.");
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("behält bei einer HTTP-Fehlerseite ohne JSON die allgemeine API-Fehlermeldung", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Offline</html>", { status: 502 })));
    await expect(fetchJson("/api/home")).rejects.toThrow("Die Angaben sind gerade nicht zu erreichen.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("beendet eine hängende Anfrage, ohne den Aufrufer abzubrechen oder selbst erneut anzufragen", async () => {
    const parent = new AbortController();
    let child!: AbortSignal;
    const fetch = vi.fn((_, options) => { child = options.signal; return stalled(child); });
    vi.stubGlobal("fetch", fetch);
    const request = fetchJson("/api/home", parent.signal);
    const rejection = expect(request).rejects.toBeInstanceOf(ApiError);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(child.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(child.aborted).toBe(true);
    await rejection;
    expect(child.reason.message).toContain("zu lange");
    expect(parent.signal.aborted).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("begrenzt auch einen hängenden Antwortkörper nach empfangenen Headern", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_, options) => ({ ok: true, json: () => stalled(options.signal) })));
    const parent = new AbortController();
    const request = fetchJson("/api/search?q=Doku", parent.signal);
    const rejection = expect(request).rejects.toBeInstanceOf(ApiError);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(vi.getTimerCount()).toBe(0);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("erhält den Abbruchgrund beim Verlassen der Ansicht und entfernt seinen Listener", async () => {
    const parent = new AbortController();
    const removed = vi.spyOn(parent.signal, "removeEventListener");
    let child!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_, options) => { child = options.signal; return stalled(child); }));
    const request = fetchJson("/api/home", parent.signal);
    const reason = new DOMException("Navigation", "AbortError");
    const rejection = expect(request).rejects.toBe(reason);
    parent.abort(reason);
    await rejection;
    expect(child.reason).toBe(reason);
    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sendet für eine bereits abgebrochene Ansicht keine Anfrage", async () => {
    const parent = new AbortController(); parent.abort();
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(fetchJson("/api/home", parent.signal)).rejects.toBe(parent.signal.reason);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("räumt nach einer erfolgreichen Antwort Timer und Abbruchlistener auf", async () => {
    const parent = new AbortController();
    const removed = vi.spyOn(parent.signal, "removeEventListener");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ videos: [] }))));
    await expect(fetchJson("/api/home", parent.signal)).resolves.toEqual({ videos: [] });
    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("erhält die eigentliche API-Fehlermeldung und räumt auch dabei auf", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Kurz offline" }), { status: 503 })));
    await expect(fetchJson("/api/home")).rejects.toThrow("Kurz offline");
    expect(vi.getTimerCount()).toBe(0);
  });
});
