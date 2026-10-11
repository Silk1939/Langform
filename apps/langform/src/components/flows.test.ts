// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelView } from "@/components/channel-view";
import { SearchView } from "@/components/search-view";
import { WatchView } from "@/components/watch-view";
import { HomeFeed } from "@/components/home-feed";
import { fetchJson } from "@/lib/browser";

const context = vi.hoisted(() => ({
  initialQuery: "",
  openVideo: vi.fn(),
  closeVideo: vi.fn(),
  scrollerRef: { current: null },
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams({ q: context.initialQuery }) }));
vi.mock("@/lib/browser", () => ({ fetchJson: vi.fn() }));
vi.mock("@/components/app-shell", () => ({ useAppShell: () => ({ ...context, nowPlaying: null }) }));
vi.mock("@/components/feed", () => ({
  Feed: ({ videos }: { videos: { title: string }[] }) => createElement("div", { "data-feed": true }, videos.map(v => v.title).join(",")),
  FeedSkeleton: () => createElement("div", { "aria-busy": true }, "Laden"),
}));
vi.mock("@/components/ui/button", () => ({ Button: (props: object) => createElement("button", props) }));
vi.mock("@/components/ui/input", () => ({ Input: (props: object) => createElement("input", props) }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  context.initialQuery = "";
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

describe("Aktualisieren der Startseite", () => {
  it("startet bei wiederholtem Tippen nur eine Aktualisierung", async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({ videos: [video("abcdefghijk", "Doku")] })
      .mockImplementation(() => new Promise(() => {}));
    await act(async () => root.render(createElement(HomeFeed)));
    await act(async () => host.querySelector("button")!.click());
    await act(async () => host.querySelector("button")!.click());
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(host.querySelector("button")!.disabled).toBe(true);
  });

  it("bricht eine Aktualisierung beim Verlassen der Startseite ab", async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({ videos: [video("abcdefghijk", "Doku")] })
      .mockImplementation(() => new Promise(() => {}));
    await act(async () => root.render(createElement(HomeFeed)));
    await act(async () => host.querySelector("button")!.click());
    const signal = vi.mocked(fetchJson).mock.calls.at(-1)?.[1];
    await act(async () => root.render(null));
    expect(signal?.aborted).toBe(true);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const video = (id: string, title: string) => ({ id, title, channelName: "Arte", channelId: "", description: "", durationSeconds: 600, publishedAt: null, publishedText: "", viewCount: null });
const details = (id: string, title: string) => ({ video: video(id, title), blocked: false, related: [video("zyxwvutsrqp", "Ähnlich")] });

describe("Kanal- und Videoanfragen", () => {
  it("zeigt den Kanal nach einem erfolgreichen Wiederholungsversuch", async () => {
    vi.mocked(fetchJson).mockRejectedValueOnce(new Error("Kurz offline")).mockResolvedValueOnce({ channel: { name: "Arte", subscriberCount: 1 }, videos: [] });
    await act(async () => root.render(createElement(ChannelView, { id: `UC${"b".repeat(22)}` })));
    expect(host.textContent).toContain("Kurz offline");
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).toContain("Arte");
    expect(host.textContent).not.toContain("Kurz offline");
  });

  it("zeigt bei einem Video-Wechsel keine alten Details als neues Video", async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(details("abcdefghijk", "Erstes Video")).mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => root.render(createElement(WatchView, { id: "abcdefghijk" })));
    expect(host.textContent).toContain("Erstes Video");
    await act(async () => root.render(createElement(WatchView, { id: "lmnopqrstuv" })));
    expect(host.textContent).not.toContain("Erstes Video");
  });

  it("öffnet das Video, während optionale Vorschläge noch laden", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(fetchJson).mockResolvedValueOnce({ ...details("abcdefghijk", "Doku"), related: [] })
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await act(async () => root.render(createElement(WatchView, { id: "abcdefghijk" })));
    expect(host.textContent).toContain("Doku");
    expect(context.openVideo).toHaveBeenCalledWith(expect.objectContaining({ title: "Doku" }));
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () => resolve(details("abcdefghijk", "Doku")));
    expect(host.textContent).toContain("Ähnlich");
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

describe("Suche bei schneller Eingabe", () => {
  it("übernimmt einen neuen URL-Suchbegriff und bricht die vorherige Anfrage ab", async () => {
    context.initialQuery = "Weltall";
    vi.mocked(fetchJson).mockImplementation((url) => url.includes("Natur")
      ? Promise.resolve({ videos: [video("abcdefghijk", "Naturfilm")] })
      : new Promise(() => {}));
    await act(async () => root.render(createElement(SearchView)));
    const previousSignal = vi.mocked(fetchJson).mock.calls.find(([url]) => url === "/api/search?q=Weltall")?.[1];
    context.initialQuery = "Natur";
    await act(async () => root.render(createElement(SearchView)));
    expect(host.querySelector("input")!.value).toBe("Natur");
    expect(previousSignal?.aborted).toBe(true);
    expect(host.textContent).toContain("Naturfilm");
  });

  it("verwirft alte Eingabe-Timer beim Wechsel des URL-Suchbegriffs", async () => {
    vi.useFakeTimers();
    context.initialQuery = "Weltall";
    vi.mocked(fetchJson).mockImplementation(async (url) => url.startsWith("/api/suggest") ? { suggestions: [] } : { videos: [] });
    await act(async () => root.render(createElement(SearchView)));
    const input = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Alter Entwurf");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    context.initialQuery = "Natur";
    await act(async () => root.render(createElement(SearchView)));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    const searches = vi.mocked(fetchJson).mock.calls.filter(([url]) => url.startsWith("/api/search"));
    expect(searches.at(-1)?.[0]).toBe("/api/search?q=Natur");
    expect(host.querySelector("input")!.value).toBe("Natur");
  });

  it("lässt einen gewählten Vorschlag nicht vom alten Eingabe-Timer überschreiben", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchJson).mockImplementation(async (url) => url.startsWith("/api/suggest") ? { suggestions: ["Doku Natur"] } : { videos: [] });
    await act(async () => root.render(createElement(SearchView)));
    const input = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Doku");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    expect(host.textContent).toContain("Doku Natur");
    await act(async () => host.querySelector("button")!.click());
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    const searches = vi.mocked(fetchJson).mock.calls.filter(([url]) => url.startsWith("/api/search"));
    expect(searches.at(-1)?.[0]).toBe("/api/search?q=Doku%20Natur");
  });

  it("zeigt bei einem neuen Suchbegriff wieder einen Ladezustand nach vorherigem Fehler", async () => {
    vi.useFakeTimers();
    context.initialQuery = "kaputt";
    vi.mocked(fetchJson).mockImplementation((url) => url.startsWith("/api/suggest") ? Promise.resolve({ suggestions: [] }) : url.includes("kaputt") ? Promise.reject(new Error("Kurz offline")) : new Promise(() => {}));
    await act(async () => root.render(createElement(SearchView)));
    expect(host.textContent).toContain("Kurz offline");
    const input = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Natur");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(240); });
    expect(host.textContent).not.toContain("Kurz offline");
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
