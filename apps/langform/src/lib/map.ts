import { translateUploadedLabel } from "@/lib/format";
import { CHANNEL_ID, VIDEO_ID, channelIdFromUrl, videoIdFromUrl } from "@/lib/ids";
import { isShort } from "@/lib/shorts";
import type { ChannelInfo, Video, WatchDetails } from "@/lib/types";

const RELATED_LIMIT = 12;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function unixSeconds(value: unknown): number | null {
  const raw = numberValue(value);
  if (raw == null || raw <= 0) return null;
  if (raw > 1e12) return Math.floor(raw / 1000);
  if (raw > 1e9) return Math.floor(raw);
  return null;
}

function payloadError(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record || !("error" in record)) return null;
  if (typeof record.error === "string" && record.error.trim()) return record.error.trim();
  const nested = asRecord(record.error);
  const message = text(nested?.message);
  return message || null;
}

function blankVideo(partial: Partial<Video> & Pick<Video, "id" | "title">): Video {
  return {
    channelName: "",
    channelId: "",
    durationSeconds: null,
    viewCount: null,
    publishedAt: null,
    publishedText: "",
    description: "",
    ...partial,
  };
}

export function parseIsoDuration(iso: string): number | null {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(iso.trim());
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function listFrom(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) throw new Error("Unerwartete Antwort");
  const error = payloadError(payload);
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  if (error) throw new Error(error.slice(0, 160));
  throw new Error("Unerwartete Antwort");
}

function invidiousVideo(item: unknown, keepShort: boolean): Video | null {
  const record = asRecord(item);
  if (!record) return null;
  const type = text(record.type).toLowerCase();
  if (type && type !== "video" && type !== "shortvideo" && type !== "livestream") return null;
  const id = text(record.videoId);
  if (!VIDEO_ID.test(id)) return null;
  const title = text(record.title) || "Ohne Titel";
  const durationSeconds = numberValue(record.lengthSeconds);
  const url = type === "shortvideo" ? `/shorts/${id}` : `/watch?v=${id}`;
  const blocked = isShort({
    title,
    url,
    durationSeconds,
    type,
    isShort: record.isShort === true,
  });
  if (blocked && !keepShort) return null;
  const channelId = text(record.authorId);
  return blankVideo({
    id,
    title,
    channelName: text(record.author),
    channelId: CHANNEL_ID.test(channelId) ? channelId : "",
    durationSeconds,
    viewCount: numberValue(record.viewCount),
    publishedAt: unixSeconds(record.published),
    publishedText: translateUploadedLabel(text(record.publishedText)),
    description: text(record.description),
  });
}

export function mapInvidiousList(payload: unknown): Video[] {
  return listFrom(payload, ["videos", "recommendedVideos"]).flatMap((item) => {
    const video = invidiousVideo(item, false);
    return video ? [video] : [];
  });
}

export function mapInvidiousVideo(payload: unknown): WatchDetails {
  const error = payloadError(payload);
  const record = asRecord(payload);
  if (!record) throw new Error(error?.slice(0, 160) || "Unerwartete Invidious-Antwort");
  if (error && !text(record.title) && !text(record.videoId)) throw new Error(error.slice(0, 160));
  const video = invidiousVideo(record, true);
  if (!video) throw new Error("Keine Video-Angaben");
  const type = text(record.type);
  const related = mapInvidiousList(record.recommendedVideos ?? []).filter((item) => item.id !== video.id);
  return {
    video,
    related: related.slice(0, RELATED_LIMIT),
    blocked: isShort({
      title: video.title,
      url: type.toLowerCase() === "shortvideo" ? `/shorts/${video.id}` : `/watch?v=${video.id}`,
      durationSeconds: video.durationSeconds,
      type,
      isShort: record.isShort === true,
    }),
  };
}

export function mapInvidiousChannel(payload: unknown, fallbackId: string): ChannelInfo {
  const error = payloadError(payload);
  const record = asRecord(payload);
  if (!record) throw new Error(error?.slice(0, 160) || "Unerwartete Kanal-Antwort");
  if (error && !text(record.author) && !text(record.authorId)) throw new Error(error.slice(0, 160));
  const id = text(record.authorId) || fallbackId;
  return {
    id: CHANNEL_ID.test(id) ? id : fallbackId,
    name: text(record.author) || "Kanal",
    description: text(record.description),
    subscriberCount: numberValue(record.subCount),
  };
}

export function mapChannelSearchId(payload: unknown, authorName: string): string {
  const wanted = authorName.trim().toLowerCase();
  const items = listFrom(payload, ["items"]);
  const records = items.map(asRecord).filter((item): item is Record<string, unknown> => item != null);
  const named = records.filter((item) => {
    const name = text(item.author) || text(item.name) || text(item.uploaderName);
    return wanted !== "" && name.toLowerCase() === wanted;
  });
  const pool = named.length > 0 ? named : records.length === 1 ? records : [];
  for (const item of pool) {
    const id =
      channelIdFromUrl(text(item.authorUrl) || text(item.url) || text(item.uploaderUrl)) ||
      text(item.authorId);
    if (CHANNEL_ID.test(id)) return id;
  }
  return "";
}

function pipedVideo(item: unknown, keepShort = false): Video | null {
  const record = asRecord(item);
  if (!record) return null;
  const type = text(record.type).toLowerCase();
  if (type && type !== "stream" && type !== "video" && type !== "shortvideo") return null;
  const url = text(record.url);
  const id = videoIdFromUrl(url) || text(record.videoId);
  if (!VIDEO_ID.test(id)) return null;
  const title = text(record.title) || "Ohne Titel";
  const durationSeconds = numberValue(record.duration);
  if (
    !keepShort && isShort({
      title,
      url: url || `/watch?v=${id}`,
      durationSeconds,
      type,
      isShort: record.isShort === true,
    })
  ) {
    return null;
  }
  const channelId = channelIdFromUrl(text(record.uploaderUrl)) || "";
  const publishedAt = unixSeconds(record.uploaded);
  return blankVideo({
    id,
    title,
    channelName: text(record.uploaderName) || text(record.uploader),
    channelId,
    durationSeconds,
    viewCount: numberValue(record.views),
    publishedAt,
    publishedText: translateUploadedLabel(text(record.uploadedDate)),
    description: text(record.shortDescription) || text(record.description),
  });
}

export function mapPipedList(payload: unknown): Video[] {
  return listFrom(payload, ["items", "relatedStreams"]).flatMap((item) => {
    const video = pipedVideo(item);
    return video ? [video] : [];
  });
}

export function mapPipedStreams(payload: unknown, videoId: string): WatchDetails {
  const error = payloadError(payload);
  const record = asRecord(payload);
  if (!record) throw new Error(error?.slice(0, 160) || "Unerwartete Piped-Antwort");
  if (error && !text(record.title)) throw new Error(error.slice(0, 160));
  if (!VIDEO_ID.test(videoId)) throw new Error("Keine Video-ID");
  const durationSeconds = numberValue(record.duration);
  const title = text(record.title);
  if (!title) throw new Error("Keine Video-Angaben");
  const video = blankVideo({
    id: videoId,
    title,
    channelName: text(record.uploader),
    channelId: channelIdFromUrl(text(record.uploaderUrl)) || "",
    durationSeconds,
    viewCount: numberValue(record.views),
    publishedAt: unixSeconds(record.uploaded ?? record.uploadDate),
    publishedText: translateUploadedLabel(text(record.uploadDate) || text(record.uploadedDate)),
    description: text(record.description),
  });
  const related = mapPipedList(record.relatedStreams ?? []).filter((item) => item.id !== videoId);
  return {
    video,
    related: related.slice(0, RELATED_LIMIT),
    blocked: isShort({
      title,
      url: `/watch?v=${videoId}`,
      durationSeconds,
      isShort: record.isShort === true,
    }),
  };
}

// Lookup results must retain the selected video's Short signals while related
// cards continue through the ordinary filtered list mappers.
export function mapInvidiousLookup(payload: unknown, videoId: string): WatchDetails {
  const items = listFrom(payload, ["videos", "recommendedVideos"]);
  const item = items.map(asRecord).find((record) => record && text(record.videoId) === videoId);
  if (!item) throw new Error("Keine Video-Angaben");
  return mapInvidiousVideo({ ...item, recommendedVideos: items });
}

export function mapPipedLookup(payload: unknown, videoId: string): WatchDetails {
  const items = listFrom(payload, ["items", "relatedStreams"]);
  for (const item of items) {
    const record = asRecord(item);
    const video = pipedVideo(item, true);
    if (!record || !video || video.id !== videoId) continue;
    return {
      video,
      related: mapPipedList(items).filter((entry) => entry.id !== videoId).slice(0, RELATED_LIMIT),
      blocked: isShort({
        title: video.title,
        url: text(record.url),
        durationSeconds: video.durationSeconds,
        type: text(record.type),
        isShort: record.isShort === true,
      }),
    };
  }
  throw new Error("Keine Video-Angaben");
}

export function mapPipedChannel(payload: unknown, fallbackId: string): { channel: ChannelInfo; videos: Video[] } {
  const error = payloadError(payload);
  const record = asRecord(payload);
  if (!record) throw new Error(error?.slice(0, 160) || "Unerwartete Kanal-Antwort");
  if (error && !text(record.name)) throw new Error(error.slice(0, 160));
  const id = channelIdFromUrl(text(record.id)) || text(record.id) || fallbackId;
  return {
    channel: {
      id: CHANNEL_ID.test(id) ? id : fallbackId,
      name: text(record.name) || "Kanal",
      description: text(record.description),
      subscriberCount: numberValue(record.subscriberCount),
    },
    videos: mapPipedList(record.relatedStreams ?? []),
  };
}

export function mapOEmbed(payload: unknown): { title: string; authorName: string; authorUrl: string } | null {
  const record = asRecord(payload);
  if (!record) return null;
  const title = text(record.title);
  if (!title) return null;
  return {
    title,
    authorName: text(record.author_name),
    authorUrl: text(record.author_url),
  };
}

function youtubeId(item: Record<string, unknown>): string {
  if (typeof item.id === "string") return item.id;
  const id = asRecord(item.id);
  return text(id?.videoId);
}

function youtubeItemToVideo(item: unknown): Video | null {
  const record = asRecord(item);
  if (!record) return null;
  const id = youtubeId(record);
  if (!VIDEO_ID.test(id)) return null;
  const snippet = asRecord(record.snippet);
  const details = asRecord(record.contentDetails);
  const stats = asRecord(record.statistics);
  const title = text(snippet?.title) || "Ohne Titel";
  const iso = text(details?.duration);
  const durationSeconds = iso ? parseIsoDuration(iso) : null;
  const channelId = text(snippet?.channelId);
  const publishedAt = text(snippet?.publishedAt);
  const parsed = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  return blankVideo({
    id,
    title,
    channelName: text(snippet?.channelTitle),
    channelId: CHANNEL_ID.test(channelId) ? channelId : "",
    durationSeconds,
    viewCount: numberValue(stats?.viewCount),
    publishedAt: Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null,
    publishedText: "",
    description: text(snippet?.description),
  });
}

export function mapYoutubeVideos(payload: unknown): Video[] {
  const error = payloadError(payload);
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.items)) {
    throw new Error(error?.slice(0, 160) || "Unerwartete YouTube-Antwort");
  }
  return record.items.flatMap((item) => {
    const video = youtubeItemToVideo(item);
    if (!video) return [];
    if (isShort({ title: video.title, durationSeconds: video.durationSeconds, url: `/watch?v=${video.id}` })) {
      return [];
    }
    return [video];
  });
}

export function orderByIds(videos: Video[], ids: string[]): Video[] {
  const byId = new Map(videos.map((video) => [video.id, video]));
  return ids.flatMap((id) => {
    const video = byId.get(id);
    return video ? [video] : [];
  });
}

export function mapYoutubeWatch(videoPayload: unknown, relatedPayload: unknown): WatchDetails {
  const error = payloadError(videoPayload);
  const record = asRecord(videoPayload);
  const first = Array.isArray(record?.items) ? record.items[0] : null;
  const video = first ? youtubeItemToVideo(first) : null;
  if (!video) throw new Error(error?.slice(0, 160) || "Keine Video-Angaben");
  const related = mapYoutubeVideos(relatedPayload).filter((item) => item.id !== video.id);
  return {
    video,
    related: related.slice(0, RELATED_LIMIT),
    blocked: isShort({
      title: video.title,
      durationSeconds: video.durationSeconds,
      url: `/watch?v=${video.id}`,
    }),
  };
}

export function mapYoutubeChannel(payload: unknown, fallbackId: string): ChannelInfo {
  const error = payloadError(payload);
  const record = asRecord(payload);
  const first = Array.isArray(record?.items) ? asRecord(record.items[0]) : null;
  if (!first) throw new Error(error?.slice(0, 160) || "Unerwartete Kanal-Antwort");
  const snippet = asRecord(first.snippet);
  const stats = asRecord(first.statistics);
  const id = text(first.id) || fallbackId;
  return {
    id: CHANNEL_ID.test(id) ? id : fallbackId,
    name: text(snippet?.title) || "Kanal",
    description: text(snippet?.description),
    subscriberCount: numberValue(stats?.subscriberCount),
  };
}

export function firstYoutubeTitle(payload: unknown): string {
  const record = asRecord(payload);
  const first = Array.isArray(record?.items) ? asRecord(record.items[0]) : null;
  return text(asRecord(first?.snippet)?.title);
}

export function mapSuggestions(payload: unknown): string[] {
  if (Array.isArray(payload)) return uniqueStrings(payload);
  const record = asRecord(payload);
  if (!record) throw new Error("Unerwartete Antwort");
  const error = payloadError(payload);
  const list = record.suggestions ?? record.items;
  if (!Array.isArray(list)) {
    throw new Error(error?.slice(0, 160) || "Unerwartete Antwort");
  }
  return uniqueStrings(list);
}

function uniqueStrings(list: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const value = item.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length === 8) break;
  }
  return result;
}

export function searchIds(payload: unknown): string[] {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.items)) return [];
  return record.items.flatMap((item) => {
    const row = asRecord(item);
    if (!row) return [];
    const id = youtubeId(row);
    return VIDEO_ID.test(id) ? [id] : [];
  });
}
