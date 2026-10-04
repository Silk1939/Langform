import { describe, expect, it } from "vitest";
import { officialEmbedSrc } from "@/lib/ids";
import { playbackHasStarted, playerMode, playerStateFromMessage } from "@/lib/player-mode";
import { nextQueries, parseHistory } from "@/lib/recent";

const ID = "abcdefghijk";

describe("Player bleibt beim Wechsel da", () => {
  it("zeigt das Video groß auf der Seite und klein, sobald die Wiedergabe läuft", () => {
    expect(playerMode("/", null, false, false)).toBe("off");
    expect(playerMode(`/schauen/${ID}`, ID, false, false)).toBe("full");
    expect(playerMode("/", ID, true, false)).toBe("mini");
    expect(playerMode("/suche", ID, false, false)).toBe("off");
    expect(playerMode("/", ID, false, true)).toBe("full");
  });

  it("erkennt den Start über die Meldungen des offiziellen Players", () => {
    expect(playerStateFromMessage({ event: "onStateChange", info: 1 })).toBe(1);
    expect(playerStateFromMessage({ event: "infoDelivery", info: { playerState: 3 } })).toBe(3);
    expect(playerStateFromMessage({ event: "infoDelivery", info: { videoUrl: "https://example.googlevideo.com/x" } })).toBeNull();
    expect(playbackHasStarted(1)).toBe(true);
    expect(playbackHasStarted(3)).toBe(true);
    expect(playbackHasStarted(2)).toBe(false);
    expect(playbackHasStarted(null)).toBe(false);
  });
});

describe("Offizielle Einbettung", () => {
  it("bleibt auf youtube.com/embed und hängt keine Stream-Adresse an", () => {
    const src = officialEmbedSrc(ID, "http://127.0.0.1:43123", true);
    expect(src.startsWith(`https://www.youtube.com/embed/${ID}?`)).toBe(true);
    expect(src).toContain("autoplay=1");
    expect(src).toContain("enablejsapi=1");
    expect(src).not.toContain("googlevideo");
    expect(() => officialEmbedSrc("kurz", "http://127.0.0.1:43123", false)).toThrow();
  });
});

describe("Verlauf", () => {
  it("behält Einträge, auch wenn die Kanal-ID kein Kanalformat hat", () => {
    const items = parseHistory(
      JSON.stringify([
        {
          id: ID,
          title: "Langer Vortrag",
          channelName: "Atelier",
          channelId: "kein-kanal",
          watchedAt: 1_700_000_000_000,
        },
      ]),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Langer Vortrag");
  });
});

describe("Letzte Suchen", () => {
  it("setzt den neuen Begriff nach vorn und verwirft Wiederholungen", () => {
    expect(nextQueries(["arte", "doku"], "  Doku ")).toEqual(["Doku", "arte"]);
    expect(nextQueries(["a", "b", "c", "d", "e", "f", "g", "h"], "neu")).toEqual([
      "neu",
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
    ]);
  });
});
