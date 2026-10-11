import { describe, expect, it } from "vitest";
import { translateUploadedLabel } from "@/lib/format";
import {
  mapInvidiousChannel,
  mapSuggestions,
  mapInvidiousList,
  mapInvidiousVideo,
  mapOEmbed,
  mapPipedChannel,
  mapPipedList,
  mapPipedStreams,
  mapYoutubeChannel,
  mapYoutubeVideos,
  mapYoutubeWatch,
  parseIsoDuration,
} from "@/lib/map";

const CHANNEL = `UC${"b".repeat(22)}`;
const LONG_ID = "abcdefghijk";
const SHORT_ID = "shortvideox";
const HASH_ID = "hashvideoxx";
const TYPE_ID = "typevideoxx";

describe("Zeitangaben aus den Quellen", () => {
  it("übersetzt englische Relative-Angaben ins Deutsche", () => {
    expect(translateUploadedLabel("2 days ago")).toBe("vor 2 Tagen");
    expect(translateUploadedLabel("1 hour ago")).toBe("vor 1 Stunde");
    expect(translateUploadedLabel("Streamed 3 hours ago")).toBe("Live, vor 3 Stunden");
    expect(translateUploadedLabel("Premiered 1 day ago")).toBe("Premiere, vor 1 Tag");
  });
});

describe("Invidious wird zum UI-Modell", () => {
  const payload = [
    {
      type: "video",
      title: "Die lange Nacht",
      videoId: LONG_ID,
      author: "Beispielkanal",
      authorId: CHANNEL,
      authorUrl: `/channel/${CHANNEL}`,
      lengthSeconds: 3720,
      viewCount: 1200,
      published: 1_700_000_000,
      publishedText: "2 days ago",
      description: "Mehr als eine Stunde.",
    },
    {
      type: "video",
      title: "Zu kurz",
      videoId: "aaaabbbbccc",
      author: "Beispielkanal",
      authorId: CHANNEL,
      lengthSeconds: 45,
    },
    {
      type: "video",
      title: "Spaß #Shorts",
      videoId: HASH_ID,
      author: "Beispielkanal",
      authorId: CHANNEL,
      lengthSeconds: 180,
    },
    {
      type: "shortVideo",
      title: "Regal",
      videoId: TYPE_ID,
      author: "Beispielkanal",
      authorId: CHANNEL,
      lengthSeconds: 90,
    },
    { type: "playlist", title: "Liste", playlistId: "PL123" },
  ];

  it("behält nur das lange Video und übernimmt die Felder", () => {
    const videos = mapInvidiousList(payload);
    expect(videos.map((video) => video.id)).toEqual([LONG_ID]);
    expect(videos[0]).toMatchObject({
      title: "Die lange Nacht",
      channelName: "Beispielkanal",
      channelId: CHANNEL,
      durationSeconds: 3720,
      viewCount: 1200,
      publishedAt: 1_700_000_000,
      publishedText: "vor 2 Tagen",
      description: "Mehr als eine Stunde.",
    });
  });

  it("mappt die Videoseite samt verwandter langer Videos und verwirft Streams nicht, weil keine da sind", () => {
    const details = mapInvidiousVideo({
      type: "video",
      title: "Die lange Nacht",
      videoId: LONG_ID,
      author: "Beispielkanal",
      authorId: CHANNEL,
      lengthSeconds: 3720,
      description: "Beschreibung",
      recommendedVideos: [
        payload[0],
        {
          type: "video",
          title: "Die zweite Nacht",
          videoId: "bbbcccdddee",
          author: "Beispielkanal",
          authorId: CHANNEL,
          lengthSeconds: 900,
          publishedText: "1 week ago",
        },
        payload[2],
      ],
    });
    expect(details.blocked).toBe(false);
    expect(details.video.id).toBe(LONG_ID);
    expect(details.related.map((video) => video.id)).toEqual(["bbbcccdddee"]);
    expect(details.related[0]?.publishedText).toBe("vor 1 Woche");
    expect(JSON.stringify(details)).not.toContain("googlevideo");
  });

  it("markiert ein kurzes Hauptvideo, ohne es abzuspielen vorzubereiten", () => {
    const details = mapInvidiousVideo({
      type: "shortVideo",
      title: "Hüpfer",
      videoId: SHORT_ID,
      author: "Beispielkanal",
      authorId: CHANNEL,
      lengthSeconds: 20,
      recommendedVideos: [payload[0]],
    });
    expect(details.blocked).toBe(true);
    expect(details.video.id).toBe(SHORT_ID);
    expect(details.related.map((video) => video.id)).toEqual([LONG_ID]);
  });

  it("liest den Kanalnamen", () => {
    expect(
      mapInvidiousChannel(
        { author: "Beispielkanal", authorId: CHANNEL, subCount: 2500, description: "Über uns" },
        CHANNEL,
      ),
    ).toEqual({
      id: CHANNEL,
      name: "Beispielkanal",
      description: "Über uns",
      subscriberCount: 2500,
    });
  });
});

describe("Piped wird zum UI-Modell", () => {
  it.each([{}, { title: "   " }, { message: "Upstream offline" }])("verwirft Videodaten ohne Titel statt eine erfolgreiche Ersatzantwort zu erfinden: %j", (payload) => {
    expect(() => mapPipedStreams(payload, LONG_ID)).toThrow("Keine Video-Angaben");
  });

  const longItem = {
    url: `/watch?v=${LONG_ID}`,
    type: "stream",
    title: "Langer Vortrag",
    uploaderName: "Hörsaal",
    uploaderUrl: `/channel/${CHANNEL}`,
    duration: 5400,
    views: 99,
    uploaded: 1_700_000_000_000,
    uploadedDate: "3 weeks ago",
    shortDescription: "Mitgeschrieben.",
    isShort: false,
  };

  it("filtert Shorts-Pfade und isShort aus der Liste", () => {
    const videos = mapPipedList({
      items: [
        longItem,
        {
          url: `/shorts/${SHORT_ID}`,
          type: "stream",
          title: "Hop",
          duration: 80,
          uploaderName: "Hörsaal",
          uploaderUrl: `/channel/${CHANNEL}`,
          isShort: true,
        },
        { type: "channel", name: "Hörsaal", url: `/channel/${CHANNEL}` },
      ],
    });
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      id: LONG_ID,
      channelId: CHANNEL,
      channelName: "Hörsaal",
      durationSeconds: 5400,
      viewCount: 99,
      publishedAt: 1_700_000_000,
      publishedText: "vor 3 Wochen",
      description: "Mitgeschrieben.",
    });
  });

  it("übernimmt bei der Videoseite nur Metadaten, keine Stream-Adressen", () => {
    const details = mapPipedStreams(
      {
        title: "Langer Vortrag",
        description: "Volltext",
        uploadDate: "3 weeks ago",
        uploader: "Hörsaal",
        uploaderUrl: `/channel/${CHANNEL}`,
        duration: 5400,
        views: 99,
        hls: "https://example.googlevideo.com/hls",
        dash: "https://example.googlevideo.com/dash",
        videoStreams: [{ url: "https://example.googlevideo.com/videoplayback?id=secret" }],
        audioStreams: [{ url: "https://example.googlevideo.com/audio" }],
        relatedStreams: [
          longItem,
          {
            url: "/watch?v=cccdddeeeff",
            type: "stream",
            title: "Noch ein Vortrag",
            uploaderName: "Hörsaal",
            uploaderUrl: `/channel/${CHANNEL}`,
            duration: 700,
            uploadedDate: "5 days ago",
          },
          {
            url: `/shorts/${SHORT_ID}`,
            type: "stream",
            title: "Hop #shorts",
            duration: 15,
            isShort: true,
          },
        ],
      },
      LONG_ID,
    );
    expect(details.blocked).toBe(false);
    expect(details.video).toMatchObject({
      id: LONG_ID,
      title: "Langer Vortrag",
      description: "Volltext",
      channelName: "Hörsaal",
    });
    expect(details.related.map((video) => video.id)).toEqual(["cccdddeeeff"]);
    expect(details.related[0]?.publishedText).toBe("vor 5 Tagen");
    const dumped = JSON.stringify(details);
    expect(dumped).not.toContain("googlevideo");
    expect(dumped).not.toContain("videoplayback");
    expect(dumped).not.toContain(SHORT_ID);
  });

  it("liest Kanal und lange Videos gemeinsam", () => {
    const mapped = mapPipedChannel(
      {
        id: CHANNEL,
        name: "Hörsaal",
        description: "Vorlesungen",
        subscriberCount: 10,
        relatedStreams: [longItem],
      },
      CHANNEL,
    );
    expect(mapped.channel.name).toBe("Hörsaal");
    expect(mapped.videos.map((video) => video.id)).toEqual([LONG_ID]);
  });
});

describe("YouTube Data API wird zum UI-Modell", () => {
  it("rechnet ISO-Dauern um", () => {
    expect(parseIsoDuration("PT1H30M")).toBe(5400);
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("PT2M")).toBe(120);
    expect(parseIsoDuration("keine")).toBeNull();
  });

  it("verwirft Shorts nach Dauer und Hashtag", () => {
    const videos = mapYoutubeVideos({
      items: [
        {
          id: LONG_ID,
          snippet: {
            title: "Langer Vortrag",
            description: "Text",
            channelId: CHANNEL,
            channelTitle: "Hörsaal",
            publishedAt: "2023-11-14T22:13:20.000Z",
          },
          contentDetails: { duration: "PT1H30M" },
          statistics: { viewCount: "1500" },
        },
        {
          id: "shortshort1",
          snippet: {
            title: "Mini",
            description: "",
            channelId: CHANNEL,
            channelTitle: "Hörsaal",
            publishedAt: "2023-11-14T22:13:20.000Z",
          },
          contentDetails: { duration: "PT45S" },
          statistics: { viewCount: "3" },
        },
        {
          id: "hashhashhas",
          snippet: {
            title: "Trend #shorts",
            description: "",
            channelId: CHANNEL,
            channelTitle: "Hörsaal",
            publishedAt: "2023-11-14T22:13:20.000Z",
          },
          contentDetails: { duration: "PT5M" },
          statistics: { viewCount: "9" },
        },
      ],
    });
    expect(videos.map((video) => video.id)).toEqual([LONG_ID]);
    expect(videos[0]).toMatchObject({
      title: "Langer Vortrag",
      channelId: CHANNEL,
      channelName: "Hörsaal",
      durationSeconds: 5400,
      viewCount: 1500,
      description: "Text",
      publishedAt: Math.floor(Date.parse("2023-11-14T22:13:20.000Z") / 1000),
    });
  });

  it("markiert ein kurzes Hauptvideo und lässt verwandte lange Videos übrig", () => {
    const details = mapYoutubeWatch(
      {
        items: [
          {
            id: "shortshort1",
            snippet: {
              title: "Mini",
              channelId: CHANNEL,
              channelTitle: "Hörsaal",
              description: "",
              publishedAt: "2024-01-01T00:00:00.000Z",
            },
            contentDetails: { duration: "PT20S" },
            statistics: { viewCount: "1" },
          },
        ],
      },
      {
        items: [
          {
            id: LONG_ID,
            snippet: {
              title: "Langer Vortrag",
              channelId: CHANNEL,
              channelTitle: "Hörsaal",
              description: "",
              publishedAt: "2024-01-01T00:00:00.000Z",
            },
            contentDetails: { duration: "PT10M" },
            statistics: { viewCount: "4" },
          },
        ],
      },
    );
    expect(details.blocked).toBe(true);
    expect(details.related.map((video) => video.id)).toEqual([LONG_ID]);
  });

  it("liest den Kanal", () => {
    expect(
      mapYoutubeChannel(
        {
          items: [
            {
              id: CHANNEL,
              snippet: { title: "Hörsaal", description: "Raum 3" },
              statistics: { subscriberCount: "80" },
            },
          ],
        },
        CHANNEL,
      ),
    ).toMatchObject({ id: CHANNEL, name: "Hörsaal", subscriberCount: 80, description: "Raum 3" });
  });
});

describe("Suchvorschläge", () => {
  it("liest Invidious- und Piped-Listen und kürzt auf acht", () => {
    expect(mapSuggestions({ suggestions: ["  Doku ", "doku", "Arte", ""] })).toEqual(["Doku", "Arte"]);
    expect(mapSuggestions(["eins", "zwei", "eins"])).toEqual(["eins", "zwei"]);
    expect(mapSuggestions({ suggestions: Array.from({ length: 12 }, (_, index) => `tipp ${index}`) })).toHaveLength(8);
  });

  it("wirft bei einer Fehlerantwort, damit die nächste Quelle drankommt", () => {
    expect(() => mapSuggestions({ error: "weg" })).toThrow(/weg/);
  });
});

describe("oEmbed bleibt bei Titel und Kanal", () => {
  it("ignoriert das mitgelieferte Iframe", () => {
    const mapped = mapOEmbed({
      title: "Die lange Nacht",
      author_name: "Beispielkanal",
      author_url: `https://www.youtube.com/channel/${CHANNEL}`,
      html: '<iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe>',
      thumbnail_url: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
    });
    expect(mapped).toEqual({
      title: "Die lange Nacht",
      authorName: "Beispielkanal",
      authorUrl: `https://www.youtube.com/channel/${CHANNEL}`,
    });
  });
});
