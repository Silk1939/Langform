// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchView } from "@/components/search-view";
import { readQueries } from "@/lib/recent";
import type { Video } from "@/lib/types";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams({ q: "Weltall" }) }));
vi.mock("@/components/feed", () => ({
  Feed: ({ videos, onOpen }: { videos: Video[]; onOpen?: (video: Video) => void }) => createElement("div", { "data-feed": true },
    videos.map((video) => createElement("button", { key: video.id, "data-video": video.id, onClick: () => onOpen?.(video) }, video.title))),
  FeedSkeleton: () => createElement("div", { "aria-busy": true }, "Laden"),
}));
vi.mock("@/components/ui/button", () => ({ Button: (props: object) => createElement("button", props) }));
vi.mock("@/components/ui/input", () => ({ Input: (props: object) => createElement("input", props) }));

const video = (id: string, title: string): Video => ({ id, title, channelName: "Arte", channelId: "", description: "", durationSeconds: 600, viewCount: null, publishedAt: null, publishedText: "" });
const oldVideo = video("abcdefghijk", "Weltallfilm");
const newVideo = video("lmnopqrstuv", "Naturfilm");
const response = (videos: Video[]) => new Response(JSON.stringify({ videos }));
let root: Root, host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

async function type(value: string) {
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Ergebnisse gehören zum angeforderten Suchbegriff", () => {
  it("entfernt alte Treffer während der neuen Anfrage und zeigt anschließend die passenden Treffer", async () => {
    let finish!: (value: Response) => void;
    const fetch = vi.fn((url: string) => url.startsWith("/api/suggest")
      ? Promise.resolve(new Response(JSON.stringify({ suggestions: [] })))
      : url.endsWith("Weltall") ? Promise.resolve(response([oldVideo])) : new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(createElement(SearchView)));
    expect(host.textContent).toContain("Weltallfilm");
    await type("Natur");
    await act(async () => { await vi.advanceTimersByTimeAsync(240); });
    expect(host.querySelector('[data-video="abcdefghijk"]')).toBeNull();
    expect(host.textContent).not.toContain("Weltallfilm");
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () => finish(response([newVideo])));
    expect(host.textContent).toContain("Naturfilm");
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("zeigt nach fehlgeschlagener neuer Suche nur deren Fehler und erreicht per Retry die neuen Treffer", async () => {
    let attempts = 0;
    const fetch = vi.fn(async (url: string) => {
      if (url.startsWith("/api/suggest")) return new Response(JSON.stringify({ suggestions: [] }));
      if (url.endsWith("Weltall")) return response([oldVideo]);
      attempts += 1;
      return attempts === 1 ? new Response(JSON.stringify({ error: "Kurz offline" }), { status: 503 }) : response([newVideo]);
    });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(createElement(SearchView)));
    await type("Natur");
    await act(async () => { await vi.advanceTimersByTimeAsync(240); });
    expect(host.textContent).toContain("Kurz offline");
    expect(host.querySelector("[data-video]")).toBeNull();
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(attempts).toBe(1);
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).toContain("Naturfilm");
    expect(host.textContent).not.toContain("Weltallfilm");
    expect(host.textContent).not.toContain("Kurz offline");
    expect(attempts).toBe(2);
  });

  it("ignoriert die verspätete Antwort einer bereits abgebrochenen alten Suche", async () => {
    let finishOld!: (value: Response) => void;
    let oldSignal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => {
      if (url.startsWith("/api/suggest")) return Promise.resolve(new Response(JSON.stringify({ suggestions: [] })));
      if (url.endsWith("Weltall")) {
        oldSignal = options.signal as AbortSignal;
        return new Promise<Response>((resolve) => { finishOld = resolve; });
      }
      return Promise.resolve(response([newVideo]));
    }));
    await act(async () => root.render(createElement(SearchView)));
    await type("Natur");
    await act(async () => { await vi.advanceTimersByTimeAsync(240); });
    expect(oldSignal.aborted).toBe(true);
    expect(host.textContent).toContain("Naturfilm");
    await act(async () => finishOld(response([oldVideo])));
    expect(host.textContent).toContain("Naturfilm");
    expect(host.textContent).not.toContain("Weltallfilm");
  });

  it("merkt beim Öffnen eines Treffers während der Eingabefrist dessen echten Suchbegriff", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response([oldVideo])));
    await act(async () => root.render(createElement(SearchView)));
    await type("Natur");
    // Vor Ablauf der Eingabefrist sind die bisherigen Treffer noch gültig.
    await act(async () => host.querySelector<HTMLButtonElement>("[data-video]")!.click());
    expect(readQueries()).toEqual(["Weltall"]);
  });

  it("entfernt einen alten Suchfehler sofort beim Leeren des Felds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Kurz offline" }), { status: 503 })));
    await act(async () => root.render(createElement(SearchView)));
    expect(host.textContent).toContain("Kurz offline");
    await type("");
    expect(host.textContent).toContain("Letzte Suchen");
    expect(host.textContent).not.toContain("Kurz offline");
    expect(host.querySelector("button")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(240); });
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
