// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelView } from "@/components/channel-view";
import { HomeFeed } from "@/components/home-feed";
import { SearchView } from "@/components/search-view";
import { WatchView } from "@/components/watch-view";

const context = vi.hoisted(() => ({ openVideo: vi.fn(), closeVideo: vi.fn(), scrollerRef: { current: null } }));
vi.mock("@/components/app-shell", () => ({ useAppShell: () => ({ ...context, nowPlaying: null }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams({ q: "Natur" }) }));
vi.mock("@/components/ui/input", () => ({ Input: (props: object) => createElement("input", props) }));
const video = { id: "abcdefghijk", title: "Naturfilm", channelName: "Arte", channelId: "", description: "", durationSeconds: 600, viewCount: null, publishedAt: null, publishedText: "" };
const channel = { id: `UC${"b".repeat(22)}`, name: "Arte", description: "", subscriberCount: null };

vi.mock("@/components/feed", () => ({
  Feed: ({ videos }: { videos: { title: string }[] }) => createElement("div", null, videos.map((video) => video.title).join(",")),
  FeedSkeleton: () => createElement("div", { "aria-busy": true }, "Laden"),
}));
vi.mock("@/components/ui/button", () => ({ Button: (props: object) => createElement("button", props) }));

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("Erreichbares Wiederholen nach Verbindungsstillstand", () => {
  it("behält nach einem ungültigen Refresh den Feed und lädt erst nach manuellem Wiederholen neu", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ videos: [video] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ videos: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ videos: [{ ...video, title: "Neuer Film" }] })));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(createElement(HomeFeed)));
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).toContain("Naturfilm");
    expect(host.textContent).toContain("Die Antwort konnte nicht gelesen werden");
    const retry = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Erneut laden")!;
    expect(retry.disabled).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => retry.click());
    expect(host.textContent).toContain("Neuer Film");
    expect(host.textContent).not.toContain("Naturfilm");
    expect(host.textContent).not.toContain("Die Antwort konnte nicht gelesen werden");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("zeigt Wiederholen für ungültige Suchergebnisse und ignoriert fehlerhafte optionale Vorschläge", async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(
      url.startsWith("/api/suggest") ? { suggestions: [null] } : { videos: "keine Liste" },
    )));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(createElement(SearchView)));
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(host.textContent).toContain("Die Antwort konnte nicht gelesen werden");
    expect(host.querySelector('[aria-label="Vorschläge"]')).toBeNull();
    fetch.mockImplementation(async () => new Response(JSON.stringify({ videos: [video] })));
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).toContain("Naturfilm");
    expect(host.textContent).not.toContain("Die Antwort konnte nicht gelesen werden");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("öffnet aus unvollständigen Videodetails keinen Player und erreicht nach Wiederholen die gültigen Details", async () => {
    const details = { video, blocked: false, related: [video] };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ video, blocked: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify(details)));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(createElement(WatchView, { id: video.id })));
    expect(context.openVideo).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(host.textContent).toContain("Die Antwort konnte nicht gelesen werden");
    await act(async () => host.querySelector("button")!.click());
    expect(context.openVideo).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Naturfilm");
    expect(host.textContent).not.toContain("Die Antwort konnte nicht gelesen werden");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("behält gültige Videodetails, wenn optionale verwandte Videos ungültig antworten", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ video, blocked: false, related: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ video: null, related: [], blocked: false })));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(createElement(WatchView, { id: video.id })));
    expect(context.openVideo).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Naturfilm");
    expect(host.textContent).toContain("Die Vorschläge sind gerade nicht zu erreichen.");
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(host.textContent).not.toContain("Die Antwort konnte nicht gelesen werden");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    {},
    { channel: { name: "Arte" }, videos: [] },
    { channel: { id: "kanal", name: "Arte", description: "", subscriberCount: null }, videos: null },
    { channel: { id: "kanal", name: "Arte", description: "", subscriberCount: null }, videos: [null] },
  ])("zeigt bei einer unvollständigen Kanalantwort Wiederholen statt einer dauerhaften Ladehülle: %j", async (body) => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(body)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ channel, videos: [] })));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(createElement(ChannelView, { id: `UC${"b".repeat(22)}` })));
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(host.textContent).toContain("Die Antwort konnte nicht gelesen werden. Bitte erneut laden.");
    expect(host.querySelector("button")?.textContent).toBe("Erneut laden");
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).toContain("Arte");
    expect(host.textContent).not.toContain("Die Antwort konnte nicht gelesen werden");
    expect(host.querySelector("button")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("zeigt nach dem Timeout Wiederholen und lädt erst nach dessen Betätigung erfolgreich", async () => {
    let signal!: AbortSignal;
    const fetch = vi.fn().mockImplementationOnce((_, options) => {
      signal = options.signal;
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }).mockResolvedValueOnce(new Response(JSON.stringify({ channel: channel, videos: [] })));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(createElement(ChannelView, { id: `UC${"b".repeat(22)}` })));
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(signal.aborted).toBe(true);
    expect(host.textContent).toContain("zu lange");
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(host.querySelector("button")?.textContent).toBe("Erneut laden");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).toContain("Arte");
    expect(host.textContent).not.toContain("zu lange");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("beendet beim Kanalwechsel die alte Anfrage, ohne deren Fehler auf dem neuen Kanal anzuzeigen", async () => {
    let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce((_, options) => {
      signal = options.signal;
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }).mockResolvedValueOnce(new Response(JSON.stringify({ channel: { ...channel, id: `UC${"c".repeat(22)}`, name: "Neuer Kanal" }, videos: [] }))));
    await act(async () => root.render(createElement(ChannelView, { id: `UC${"b".repeat(22)}` })));
    await act(async () => root.render(createElement(ChannelView, { id: `UC${"c".repeat(22)}` })));
    expect(signal.aborted).toBe(true);
    expect(host.textContent).toContain("Neuer Kanal");
    expect(host.textContent).not.toContain("zu lange");
    expect(host.querySelector("button")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
