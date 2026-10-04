import { describe, expect, it } from "vitest";
import { isLongVideo, isShort } from "@/lib/shorts";

const CHANNEL = `UC${"a".repeat(22)}`;

describe("Shorts-Filter", () => {
  it("erkennt den Pfad /shorts/", () => {
    expect(isShort({ url: "/shorts/abcdefghijk", durationSeconds: 120 })).toBe(true);
    expect(isShort({ url: "https://example.test/shorts/abcdefghijk", title: "Lang genug" })).toBe(true);
    expect(isShort({ url: "/shorts" })).toBe(true);
    expect(isShort({ url: "/shorts?feature=share" })).toBe(true);
  });

  it("lässt gewöhnliche Watch-Pfade stehen", () => {
    expect(isShort({ url: `/watch?v=abcdefghijk`, title: "Vortrag", durationSeconds: 600 })).toBe(false);
    expect(isShort({ url: `/channel/${CHANNEL}` })).toBe(false);
  });

  it("erkennt den Hashtag #shorts in der Überschrift", () => {
    expect(isShort({ title: "Abend #shorts", durationSeconds: 180 })).toBe(true);
    expect(isShort({ title: "#Shorts", durationSeconds: 90 })).toBe(true);
    expect(isShort({ title: "ohne das wort shorts im hashtag", durationSeconds: 90 })).toBe(false);
    expect(isShort({ title: "Shorts bleiben ein Wort", durationSeconds: 240 })).toBe(false);
  });

  it("verwirft alles unter 60 Sekunden und behält ab 60", () => {
    expect(isShort({ durationSeconds: 0 })).toBe(true);
    expect(isShort({ durationSeconds: 59 })).toBe(true);
    expect(isShort({ durationSeconds: 59.9 })).toBe(true);
    expect(isShort({ durationSeconds: 60, title: "Gerade eine Minute" })).toBe(false);
    expect(isShort({ durationSeconds: 3600 })).toBe(false);
  });

  it("behandelt unbekannte oder negative Dauer nicht als Short", () => {
    expect(isShort({ title: "Live", durationSeconds: null })).toBe(false);
    expect(isShort({ title: "Live", durationSeconds: -1 })).toBe(false);
    expect(isShort({})).toBe(false);
  });

  it("erkennt Short-Markierungen aus den Schnittstellen", () => {
    expect(isShort({ type: "shortVideo", durationSeconds: 80 })).toBe(true);
    expect(isShort({ type: "shorts", title: "Regal" })).toBe(true);
    expect(isShort({ isShort: true, durationSeconds: 400 })).toBe(true);
    expect(isShort({ type: "video", durationSeconds: 400 })).toBe(false);
    expect(isLongVideo({ type: "video", durationSeconds: 400, title: "Dokumentation" })).toBe(true);
  });
});
