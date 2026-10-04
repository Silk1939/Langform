import { describe, expect, it } from "vitest";
import { firstUseful, MetadataError } from "@/lib/failover";

describe("Ausweichkette", () => {
  it("nimmt die erste brauchbare Quelle", async () => {
    const value = await firstUseful(
      [
        {
          name: "kaputt",
          load: async () => {
            throw new Error("weg");
          },
        },
        { name: "leer", load: async () => [] as string[] },
        { name: "gut", load: async () => ["lang"] },
      ],
      (items) => items.length > 0,
    );
    expect(value).toEqual(["lang"]);
  });

  it("gibt bei echter Leere die leere Liste zurück", async () => {
    const value = await firstUseful(
      [
        { name: "a", load: async () => [] as string[] },
        { name: "b", load: async () => [] as string[] },
      ],
      (items) => items.length > 0,
      { empty: [] },
    );
    expect(value).toEqual([]);
  });

  it("wirft, wenn jede Quelle scheitert", async () => {
    await expect(
      firstUseful(
        [
          {
            name: "a",
            load: async () => {
              throw new Error("nein");
            },
          },
          {
            name: "b",
            load: async () => {
              throw new Error("auch nicht");
            },
          },
        ],
        () => true,
      ),
    ).rejects.toBeInstanceOf(MetadataError);
  });

  it("bricht übrige Quellen ab, sobald eine passt", async () => {
    let aborted = false;
    const value = await firstUseful(
      [
        { name: "schnell", load: async () => "ok" },
        {
          name: "langsam",
          load: (signal) =>
            new Promise<string>((resolve, reject) => {
              signal.addEventListener("abort", () => {
                aborted = true;
                reject(new Error("abgebrochen"));
              });
              setTimeout(() => resolve("spät"), 40);
            }),
        },
      ],
      (item) => item === "ok",
    );
    expect(value).toBe("ok");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(aborted).toBe(true);
  });
});
