// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { historySnapshot, queriesSnapshot, rememberQuery, rememberWatch } from "@/lib/recent";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("Verlauf mit eingeschränktem Browserspeicher", () => {
  it("liefert leere Snapshots, wenn Safari das Lesen verweigert", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Speicher blockiert", "SecurityError");
    });
    expect(historySnapshot()).toBe("");
    expect(queriesSnapshot()).toBe("");
  });

  it("blockiert die Suche und Videowiedergabe nicht bei vollem Speicher", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Speicher voll", "QuotaExceededError");
    });
    expect(() => rememberQuery("Doku")).not.toThrow();
    expect(() => rememberWatch({ id: "abcdefghijk", title: "Doku", channelName: "Arte", channelId: "" })).not.toThrow();
  });
});
