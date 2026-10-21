import "server-only";

import { firstUseful } from "@/lib/failover";
import { createAsyncCache } from "@/lib/async-cache";
import { CHANNEL_ID, VIDEO_ID, channelIdFromUrl } from "@/lib/ids";
import {
  mapInvidiousChannel,
  mapInvidiousList,
  mapInvidiousLookup,
  mapInvidiousVideo,
  mapOEmbed,
  mapPipedChannel,
  mapPipedList,
  mapPipedLookup,
  mapPipedStreams,
  mapYoutubeChannel,
  mapYoutubeVideos,
  mapSuggestions,
  mapYoutubeWatch,
  orderByIds,
  searchIds,
} from "@/lib/map";
import { isShort } from "@/lib/shorts";
import type { ChannelInfo, Video, WatchDetails } from "@/lib/types";

export const INVIDIOUS_INSTANCES = [
  "https://invidious.f5.si",
  "https://inv.nadeko.net",
  "https://invidious.tiekoetter.com",
];

export const PIPED_INSTANCES = [
  "https://api.piped.private.coffee",
  "https://pipedapi.ducks.party",
  "https://pipedapi.kavin.rocks",
];

const TIMEOUT_MS = 7000;
const CACHE_MS = 3 * 60 * 1000;
const cache = createAsyncCache(CACHE_MS, 200);

type Source<T> = {
  name: string;
  load: (signal: AbortSignal) => Promise<T>;
};

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    signal,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Accept-Language": "de",
      "User-Agent": "Langform/1.0",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Keine JSON-Antwort");
  }
}

function withTimeout(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  if (!parent) return timeout;
  return AbortSignal.any([parent, timeout]);
}

async function memo<T>(key: string, load: () => Promise<T>, fresh = false): Promise<T> {
  return cache.load(key, load, fresh);
}

function invidiousSources<T>(
  path: string,
  map: (payload: unknown) => T,
): Source<T>[] {
  return INVIDIOUS_INSTANCES.map((base) => ({
    name: `invidious ${base}`,
    load: async (signal) => map(await getJson(`${base}${path}`, withTimeout(signal))),
  }));
}

function pipedSources<T>(path: string, map: (payload: unknown) => T): Source<T>[] {
  return PIPED_INSTANCES.map((base) => ({
    name: `piped ${base}`,
    load: async (signal) => map(await getJson(`${base}${path}`, withTimeout(signal))),
  }));
}

function youtubeKey(): string | null {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  return key ? key : null;
}

async function youtubeGet(path: string, params: Record<string, string>, signal: AbortSignal): Promise<unknown> {
  const key = youtubeKey();
  if (!key) throw new Error("kein Schlüssel");
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set("key", key);
  return getJson(url.toString(), withTimeout(signal));
}

async function youtubeVideos(ids: string[], signal: AbortSignal): Promise<Video[]> {
  if (ids.length === 0) return [];
  const payload = await youtubeGet(
    "videos",
    {
      part: "snippet,contentDetails,statistics",
      id: ids.slice(0, 24).join(","),
      maxResults: "24",
    },
    signal,
  );
  return orderByIds(mapYoutubeVideos(payload), ids);
}

async function tryYoutube<T>(load: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  if (!youtubeKey()) return null;
  try {
    return await load(AbortSignal.timeout(TIMEOUT_MS));
  } catch {
    return null;
  }
}

export async function loadHome(options?: { fresh?: boolean }): Promise<Video[]> {
  return memo("home", async () => {
    const fromYoutube = await tryYoutube((signal) =>
      youtubeGet(
        "videos",
        {
          part: "snippet,contentDetails,statistics",
          chart: "mostPopular",
          regionCode: "DE",
          maxResults: "24",
        },
        signal,
      ).then(mapYoutubeVideos),
    );
    if (fromYoutube && fromYoutube.length > 0) return fromYoutube.slice(0, 24);

    try {
      const videos = await firstUseful(
        [
          ...invidiousSources("/api/v1/trending?type=Default&region=DE", mapInvidiousList),
          ...pipedSources("/trending?region=DE", mapPipedList),
        ],
        (videos) => videos.length > 0,
      );
      return videos.slice(0, 24);
    } catch {
      const videos = await firstUseful(
        invidiousSources("/api/v1/popular", mapInvidiousList),
        (videos) => videos.length > 0,
      );
      return videos.slice(0, 24);
    }
  }, options?.fresh === true);
}

export async function loadSuggestions(query: string): Promise<string[]> {
  const q = query.trim().slice(0, 80);
  if (!q) return [];
  return memo(`suggest:${q.toLowerCase()}`, async () => {
    const encoded = encodeURIComponent(q);
    return firstUseful(
      [
        ...invidiousSources(`/api/v1/search/suggestions?q=${encoded}`, mapSuggestions),
        ...pipedSources(`/suggestions?query=${encoded}`, mapSuggestions),
      ],
      (items) => items.length > 0,
      { empty: [] as string[] },
    );
  });
}

export async function loadSearch(query: string): Promise<Video[]> {
  const q = query.trim().slice(0, 200);
  if (!q) return [];
  return memo(`search:${q.toLowerCase()}`, async () => {
    const fromYoutube = await tryYoutube(async (signal) => {
      const found = await youtubeGet(
        "search",
        {
          part: "snippet",
          type: "video",
          maxResults: "20",
          q,
          regionCode: "DE",
          relevanceLanguage: "de",
        },
        signal,
      );
      return youtubeVideos(searchIds(found), signal);
    });
    if (fromYoutube) return fromYoutube.slice(0, 24);

    const encoded = encodeURIComponent(q);
    const videos = await firstUseful(
      [
        ...invidiousSources(`/api/v1/search?q=${encoded}&type=video&region=DE`, mapInvidiousList),
        ...pipedSources(`/search?q=${encoded}&filter=videos`, mapPipedList),
      ],
      (videos) => videos.length > 0,
      { empty: [] as Video[] },
    );
    return videos.slice(0, 24);
  });
}

export async function loadChannel(channelId: string): Promise<{ channel: ChannelInfo; videos: Video[] }> {
  if (!CHANNEL_ID.test(channelId)) throw new Error("Unbekannter Kanal");
  return memo(`channel:${channelId}`, async () => {
    const fromYoutube = await tryYoutube(async (signal) => {
      const [channelPayload, searchPayload] = await Promise.all([
        youtubeGet("channels", { part: "snippet,statistics", id: channelId }, signal),
        youtubeGet(
          "search",
          {
            part: "snippet",
            channelId,
            type: "video",
            order: "date",
            maxResults: "20",
          },
          signal,
        ),
      ]);
      const channel = mapYoutubeChannel(channelPayload, channelId);
      if (channel.id !== channelId) throw new Error("Falsche Kanal-ID");
      const videos = await youtubeVideos(searchIds(searchPayload), signal);
      return { channel, videos };
    });
    if (fromYoutube) return fromYoutube;

    return firstUseful(
      [
        ...INVIDIOUS_INSTANCES.map((base) => ({
          name: `invidious ${base}`,
          load: async (signal: AbortSignal) => {
            const [info, list] = await Promise.all([
              getJson(`${base}/api/v1/channels/${channelId}`, withTimeout(signal)),
              getJson(`${base}/api/v1/channels/${channelId}/videos?sort_by=newest`, withTimeout(signal)),
            ]);
            return {
              channel: mapInvidiousChannel(info, channelId),
              videos: mapInvidiousList(list).slice(0, 24),
            };
          },
        })),
        ...PIPED_INSTANCES.map((base) => ({
          name: `piped ${base}`,
          load: async (signal: AbortSignal) => {
            const payload = await getJson(`${base}/channel/${channelId}`, withTimeout(signal));
            const mapped = mapPipedChannel(payload, channelId);
            return { channel: mapped.channel, videos: mapped.videos.slice(0, 24) };
          },
        })),
      ],
      (value) => value.channel.id === channelId && (value.channel.name !== "Kanal" || value.videos.length > 0),
    );
  });
}

function titleQuery(title: string): string {
  return title
    .split(/\s+/)
    .filter((word) => /[A-Za-z0-9ÄÖÜäöüß]/.test(word))
    .slice(0, 5)
    .join(" ");
}

async function withRelated(details: WatchDetails): Promise<WatchDetails> {
  if (details.blocked || (details.related.length > 0 && details.video.channelName)) return details;
  const query = titleQuery(details.video.title);
  if (query.length < 3) return details;
  let found: Video[] = [];
  try {
    found = await loadSearch(query);
  } catch {
    return details;
  }
  const matched = found.find((item) => item.id === details.video.id);
  const related =
    details.related.length > 0 ? details.related : found.filter((item) => item.id !== details.video.id).slice(0, 12);
  return {
    ...details,
    related,
    video: {
      ...details.video,
      title: details.video.title || matched?.title || "",
      channelName: details.video.channelName || matched?.channelName || "",
      channelId: details.video.channelId || matched?.channelId || "",
      durationSeconds: details.video.durationSeconds ?? matched?.durationSeconds ?? null,
      viewCount: details.video.viewCount ?? matched?.viewCount ?? null,
      publishedAt: details.video.publishedAt ?? matched?.publishedAt ?? null,
      publishedText: details.video.publishedText || matched?.publishedText || "",
      description: details.video.description || matched?.description || "",
    },
  };
}

async function composedWatch(id: string, signal: AbortSignal): Promise<WatchDetails> {
  const oembed = mapOEmbed(
    await getJson(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`,
      withTimeout(signal),
    ),
  );
  if (!oembed) throw new Error("Keine Video-Angaben");
  const video: Video = {
    id,
    title: oembed.title,
    channelName: oembed.authorName,
    channelId: channelIdFromUrl(oembed.authorUrl) || "",
    durationSeconds: null,
    viewCount: null,
    publishedAt: null,
    publishedText: "",
    description: "",
  };
  return {
    video,
    related: [],
    blocked: isShort({
      title: video.title,
      durationSeconds: video.durationSeconds,
      url: `/watch?v=${id}`,
    }),
  };
}

export async function loadWatch(id: string): Promise<WatchDetails> {
  if (!VIDEO_ID.test(id)) throw new Error("Unbekanntes Video");
  return memo(`watch:${id}`, async () => {
    const fromYoutube = await tryYoutube(async (signal) => {
      const videoPayload = await youtubeGet(
        "videos",
        { part: "snippet,contentDetails,statistics", id },
        signal,
      );
      const details = mapYoutubeWatch(videoPayload, { items: [] });
      if (details.video.id !== id) throw new Error("Falsche Video-ID");
      return details;
    });
    const matches = (value: WatchDetails) => value.video.id === id && value.video.title.length > 0;
    const classified = (value: WatchDetails) => value.blocked || (
      typeof value.video.durationSeconds === "number"
      && Number.isFinite(value.video.durationSeconds)
      && value.video.durationSeconds >= 0
    );
    if (fromYoutube && classified(fromYoutube)) return fromYoutube;

    // Start every bounded source together. An answer without Short signals or
    // duration stays available as a fallback, but cannot cancel classification.
    let fallback: WatchDetails | null = fromYoutube;
    const sources: Source<WatchDetails>[] = [
      ...invidiousSources(`/api/v1/videos/${id}?region=DE`, mapInvidiousVideo),
      ...pipedSources(`/streams/${id}`, (payload) => mapPipedStreams(payload, id)),
      ...pipedSources(`/search?q=${encodeURIComponent(id)}&filter=videos`, (payload) => mapPipedLookup(payload, id)),
      ...invidiousSources(`/api/v1/search?q=${encodeURIComponent(id)}&type=video&region=DE`, (payload) => mapInvidiousLookup(payload, id)),
      { name: "oembed", load: (signal) => composedWatch(id, signal) },
    ];
    try {
      return await firstUseful(
        sources.map((source) => ({
          name: source.name,
          load: async (signal) => {
            const value = await source.load(signal);
            if (matches(value) && !classified(value) && !fallback) fallback = value;
            return value;
          },
        })),
        (value) => matches(value) && classified(value),
      );
    } catch (error) {
      // Preserve the existing unknown-duration policy once all evidence sources
      // finish or reach their seven-second deadline. Failed results are not cached.
      if (fallback) return fallback;
      throw error;
    }
  });
}

export async function loadWatchWithRelated(id: string): Promise<WatchDetails> {
  if (!VIDEO_ID.test(id)) throw new Error("Unbekanntes Video");
  return memo(`watch-related:${id}`, async () => withRelated(await loadWatch(id)));
}
