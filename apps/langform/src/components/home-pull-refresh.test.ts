// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeFeed } from "@/components/home-feed";

const context = vi.hoisted(() => ({ scrollerRef: { current: null as HTMLDivElement | null } }));
vi.mock("@/components/app-shell", () => ({ useAppShell: () => context }));
vi.mock("@/components/feed", () => ({
  Feed: () => null,
  FeedSkeleton: () => createElement("div", { "aria-busy": true }, "Laden"),
}));
vi.mock("@/components/ui/button", () => ({ Button: (props: object) => createElement("button", props) }));

let root: Root, host: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetcher = vi.fn(async () => Response.json({ videos: [] }));
  vi.stubGlobal("fetch", fetcher);
  host = document.createElement("div"); document.body.append(host);
  context.scrollerRef.current = host;
  root = createRoot(host);
  await act(async () => root.render(createElement(HomeFeed)));
  expect(fetcher).toHaveBeenCalledTimes(1);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  context.scrollerRef.current = null;
  vi.unstubAllGlobals();
});

async function touch(type: string, points: [number, number][] = []) {
  const event = new TouchEvent(type, {
    bubbles: true, cancelable: true,
    touches: points.map(([identifier, clientY]) => ({
      identifier, target: host, clientY, clientX: 30,
      pageY: clientY, pageX: 30, screenY: clientY, screenX: 30,
      radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
    })),
  });
  await act(async () => { host.dispatchEvent(event); });
  return event;
}
const noPull = () => expect(host.textContent).not.toMatch(/Loslassen zum Aktualisieren|Ziehen zum Aktualisieren/);

describe("Pull-to-refresh besitzt genau einen abgeschlossenen Kontakt", () => {
  it("aktualisiert nach einem vollständigen Einfingerzug genau einmal", async () => {
    await touch("touchstart", [[1, 10]]);
    const move = await touch("touchmove", [[1, 100]]);
    expect(move.defaultPrevented).toBe(true);
    expect(host.textContent).toContain("Loslassen zum Aktualisieren");
    await touch("touchend");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe("/api/home?fresh=1");
    noPull();
    await touch("touchend");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("bricht einen begonnenen Zug beim zweiten Finger ab und erlaubt erst einen neuen vollständigen Zug", async () => {
    await touch("touchstart", [[1, 10]]);
    await touch("touchstart", [[1, 10], [2, 40]]);
    const move = await touch("touchmove", [[1, 110], [2, 140]]);
    expect(move.defaultPrevented).toBe(false);
    noPull();
    await touch("touchend", [[1, 110]]);
    await touch("touchmove", [[1, 200]]);
    await touch("touchend");
    expect(fetcher).toHaveBeenCalledTimes(1);
    noPull();
    await touch("touchstart", [[3, 10]]);
    await touch("touchmove", [[3, 100]]);
    await touch("touchend");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("entfernt eine bereits sichtbare Loslassen-Anzeige sofort bei einem weiteren Finger", async () => {
    await touch("touchstart", [[1, 10]]);
    await touch("touchmove", [[1, 100]]);
    expect(host.textContent).toContain("Loslassen zum Aktualisieren");
    await touch("touchstart", [[1, 100], [2, 120]]);
    noPull();
    await touch("touchend");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("erkennt Mehrfingerbewegung auch ohne einen zusätzlichen touchstart am Feed", async () => {
    await touch("touchstart", [[1, 10]]);
    const move = await touch("touchmove", [[1, 100], [2, 120]]);
    expect(move.defaultPrevented).toBe(false);
    noPull();
    await touch("touchend");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("startet bei verbleibendem Kontakt am touchend keine Aktualisierung", async () => {
    await touch("touchstart", [[1, 10]]);
    await touch("touchmove", [[1, 100]]);
    await touch("touchend", [[2, 120]]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    noPull();
    await touch("touchend");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("behält den vorhandenen touchcancel-Abbruch ohne Aktualisierung", async () => {
    await touch("touchstart", [[1, 10]]);
    await touch("touchmove", [[1, 100]]);
    await touch("touchcancel");
    noPull();
    await touch("touchend");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
