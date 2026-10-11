// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, useAppShell } from "@/components/app-shell";
import { WatchView } from "@/components/watch-view";
import { readRecent } from "@/lib/recent";
import type { WatchDetails } from "@/lib/types";

const route = vi.hoisted(() => ({ pathname: "/schauen/abcdefghijk" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("next/link", () => ({ default: ({ children, scroll, ...props }: { children?: React.ReactNode; scroll?: boolean }) => {
  void scroll;
  return createElement("a", props, children);
} }));
vi.mock("@/components/mark", () => ({ Mark: () => null }));
vi.mock("@/components/feed", () => ({
  Feed: ({ videos }: { videos: { title: string }[] }) => createElement("div", null, videos.map((video) => video.title).join(",")),
  FeedSkeleton: () => createElement("div", { "aria-busy": true }, "Laden"),
}));
vi.mock("@/components/ui/button", () => ({ Button: ({ render, ...props }: { render?: unknown }) => {
  void render;
  return createElement("button", props);
} }));

const A = "abcdefghijk", B = "lmnopqrstuv";
const details = (id = A, title = "Lange Doku", blocked = false): WatchDetails => ({
  video: { id, title, channelName: "Arte", channelId: "", description: "", durationSeconds: blocked ? 30 : 600, viewCount: null, publishedAt: null, publishedText: "" },
  blocked,
  related: [{ id: "zyxwvutsrqp", title: "Ähnliche Doku", channelName: "Arte", channelId: "", description: "", durationSeconds: 600, viewCount: null, publishedAt: null, publishedText: "" }],
});
function Controls() {
  const { openVideo } = useAppShell();
  return createElement("button", { "data-open-checked": true, onClick: () => openVideo(details().video, { gesture: true }) }, "Geprüftes Feedvideo");
}
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  route.pathname = `/schauen/${A}`;
  window.localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function renderWatch(id?: string) {
  await act(async () => root.render(createElement(AppShell, null, createElement(Controls), id ? createElement(WatchView, { id }) : null)));
}
function pendingRequest(_url: string, options: RequestInit) {
  const signal = options.signal!;
  return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
}
const frame = () => host.querySelector("iframe")!;

describe("Player erst nach Videoentscheidung und mit passender Identität", () => {
  it("lädt aus einer Direktlink-ID vor der Metadatenantwort keinen Embed", async () => {
    vi.stubGlobal("fetch", vi.fn(pendingRequest));
    await renderWatch(A);
    expect(frame().src).toBe("about:blank");
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(readRecent()).toEqual([]);
  });

  it("bleibt nach Direktlink-Timeout gesperrt und öffnet das Langvideo erst nach manuellem Retry", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementationOnce(pendingRequest).mockResolvedValueOnce(Response.json(details()));
    vi.stubGlobal("fetch", fetcher);
    await renderWatch(A);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(frame().src).toBe("about:blank");
    expect(host.textContent).toContain("zu lange");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const retry = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Erneut laden")!;
    await act(async () => retry.click());
    expect(frame().src).toContain(`/embed/${A}?`);
    expect(host.textContent).toContain("Lange Doku");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1].signal.aborted).toBe(false);
  });

  it("lädt auch vor einer Kurzvideo-Antwort keinen Embed und speichert keinen Verlauf", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    await renderWatch(A);
    expect(frame().src).toBe("about:blank");
    await act(async () => finish(Response.json(details(A, "Kurzvideo", true))));
    expect(frame().src).toBe("about:blank");
    expect(host.textContent).toContain("Das ist ein Kurzvideo");
    expect(readRecent()).toEqual([]);
  });

  it("behält denselben geprüften Feedplayer bei fehlgeschlagenen Metadaten", async () => {
    route.pathname = "/";
    await renderWatch();
    await act(async () => host.querySelector<HTMLButtonElement>("[data-open-checked]")!.click());
    const existingFrame = frame(), existingSrc = existingFrame.src;
    expect(existingSrc).toContain(`/embed/${A}?`);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Metadaten offline")));
    route.pathname = `/schauen/${A}`;
    await renderWatch(A);
    expect(frame()).toBe(existingFrame);
    expect(frame().src).toBe(existingSrc);
    expect(host.textContent).toContain("Metadaten offline");
    expect(host.textContent).toContain("Lange Doku");
  });

  it("stoppt das laufende Langvideo A nicht wegen einer blockierten neuen Direktlink-ID B", async () => {
    route.pathname = "/";
    await renderWatch();
    await act(async () => host.querySelector<HTMLButtonElement>("[data-open-checked]")!.click());
    const existingSrc = frame().src;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(details(B, "Kurzvideo B", true))));
    route.pathname = `/schauen/${B}`;
    await renderWatch(B);
    expect(host.textContent).toContain("Das ist ein Kurzvideo");
    expect(frame().src).toBe(existingSrc);
    expect(host.querySelector('[aria-label="Wiedergabe beenden"]')).not.toBeNull();
  });

  it("verwirft Hauptdetails für B unter Route A und öffnet A nach einem passenden Retry", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(details(B, "Falsches Video"))).mockResolvedValueOnce(Response.json(details()));
    vi.stubGlobal("fetch", fetcher);
    await renderWatch(A);
    expect(host.textContent).not.toContain("Falsches Video");
    expect(host.textContent).toContain("Die Antwort konnte nicht gelesen werden");
    expect(frame().src).toBe("about:blank");
    const retry = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Erneut laden")!;
    await act(async () => retry.click());
    expect(frame().src).toContain(`/embed/${A}?`);
    expect(readRecent().map((entry) => entry.id)).toEqual([A]);
  });

  it("behält gültige A-Details und dessen Player bei einer optionalen Antwort für B", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ ...details(), related: [] }))
      .mockResolvedValueOnce(Response.json(details(B, "Falsche Anreicherung"))));
    await renderWatch(A);
    expect(host.textContent).toContain("Lange Doku");
    expect(host.textContent).not.toContain("Falsche Anreicherung");
    expect(host.textContent).toContain("Die Vorschläge sind gerade nicht zu erreichen.");
    expect(frame().src).toContain(`/embed/${A}?`);
  });
});
