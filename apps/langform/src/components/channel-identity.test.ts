// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelView } from "@/components/channel-view";

vi.mock("@/components/feed", () => ({
  Feed: ({ videos }: { videos: { title: string }[] }) => createElement("div", null, videos.map((video) => video.title).join(",")),
  FeedSkeleton: () => createElement("div", { "aria-busy": true }, "Laden"),
}));
vi.mock("@/components/ui/button", () => ({ Button: (props: object) => createElement("button", props) }));

const A = `UC${"a".repeat(22)}`, B = `UC${"b".repeat(22)}`;
const response = (id: string, name: string) => ({ channel: { id, name, description: "", subscriberCount: null }, videos: [] });
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("Kanalantwort gehört zur aktiven Kanalroute", () => {
  it("zeigt eine fremde Kanalantwort als erneut versuchbaren Fehler und übernimmt erst die passende Antwort", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(response(B, "Fremder Kanal")))
      .mockResolvedValueOnce(Response.json(response(A, "Passender Kanal")));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(createElement(ChannelView, { id: A })));
    expect(host.textContent).not.toContain("Fremder Kanal");
    expect(host.textContent).toContain("Die Antwort konnte nicht gelesen werden");
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    const retry = host.querySelector("button")!;
    expect(retry.textContent).toBe("Erneut laden");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => retry.click());
    expect(host.textContent).toContain("Passender Kanal");
    expect(host.textContent).not.toContain("Die Antwort konnte nicht gelesen werden");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("ignoriert eine alte Kanalantwort nach dem Wechsel zu einem anderen passenden Kanal", async () => {
    let finish!: (response: Response) => void;
    let previousSignal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce((_url: string, options: RequestInit) => {
      previousSignal = options.signal!;
      return new Promise<Response>((resolve) => { finish = resolve; });
    }).mockResolvedValueOnce(Response.json(response(B, "Aktueller Kanal"))));
    await act(async () => root.render(createElement(ChannelView, { id: A })));
    await act(async () => root.render(createElement(ChannelView, { id: B })));
    expect(previousSignal.aborted).toBe(true);
    await act(async () => finish(Response.json(response(A, "Alter Kanal"))));
    expect(host.textContent).toContain("Aktueller Kanal");
    expect(host.textContent).not.toContain("Alter Kanal");
    expect(host.querySelector("button")).toBeNull();
  });
});
