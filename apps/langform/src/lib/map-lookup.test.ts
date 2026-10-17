import { describe, expect, it } from "vitest";
import { mapInvidiousList, mapInvidiousLookup, mapPipedList, mapPipedLookup } from "@/lib/map";

const id = "abcdefghijk";
const otherId = "lmnopqrstuv";

describe("Gezielte Videosuche erhält Kurzvideo-Signale", () => {
  it.each([
    { lengthSeconds: 30 },
    { lengthSeconds: 180, isShort: true },
    { lengthSeconds: 180, type: "shortVideo" },
  ])("Invidious sperrt nur das gewählte Video und filtert verwandte Karten: %j", (signals) => {
    const items = [{ videoId: id, title: "Kurzfilm", ...signals }, { videoId: otherId, title: "Langfilm", lengthSeconds: 600 }];
    expect(mapInvidiousLookup(items, id)).toMatchObject({ video: { id }, blocked: true, related: [{ id: otherId }] });
    expect(mapInvidiousList(items).map((video) => video.id)).toEqual([otherId]);
  });

  it.each([
    { url: `/watch?v=${id}`, duration: 30 },
    { url: `/watch?v=${id}`, duration: 180, isShort: true },
    { url: `/watch?v=${id}`, duration: 180, type: "shortVideo" },
    { url: `/shorts/${id}`, duration: 180 },
  ])("Piped sperrt nur das gewählte Video und filtert verwandte Karten: %j", (signals) => {
    const items = [{ title: "Kurzfilm", ...signals }, { url: `/watch?v=${otherId}`, title: "Langfilm", duration: 600 }];
    expect(mapPipedLookup({ items }, id)).toMatchObject({ video: { id }, blocked: true, related: [{ id: otherId }] });
    expect(mapPipedList({ items }).map((video) => video.id)).toEqual([otherId]);
  });

  it("übernimmt bei beiden Quellen keine fremde Ziel-ID", () => {
    expect(() => mapInvidiousLookup([{ videoId: otherId, title: "Fremd", lengthSeconds: 600 }], id)).toThrow("Keine Video-Angaben");
    expect(() => mapPipedLookup([{ url: `/watch?v=${otherId}`, title: "Fremd", duration: 600 }], id)).toThrow("Keine Video-Angaben");
  });
});
