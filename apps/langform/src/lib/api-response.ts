import type { ChannelInfo, Video, WatchDetails } from "@/lib/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOptionalNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isVideo(value: unknown): value is Video {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.channelName === "string"
    && typeof value.channelId === "string"
    && typeof value.description === "string"
    && typeof value.publishedText === "string"
    && isOptionalNumber(value.durationSeconds)
    && isOptionalNumber(value.viewCount)
    && isOptionalNumber(value.publishedAt);
}

function isVideoArray(value: unknown): value is Video[] {
  return Array.isArray(value) && value.every(isVideo);
}

export function isVideoList(body: unknown): body is { videos: Video[] } {
  return isRecord(body) && isVideoArray(body.videos);
}

export function isChannelDetails(body: unknown): body is { channel: ChannelInfo; videos: Video[] } {
  if (!isRecord(body) || !isVideoArray(body.videos) || !isRecord(body.channel)) return false;
  const channel = body.channel;
  return typeof channel.id === "string"
    && typeof channel.name === "string"
    && typeof channel.description === "string"
    && isOptionalNumber(channel.subscriberCount);
}

export function isWatchDetails(body: unknown, expectedId?: string): body is WatchDetails {
  return isRecord(body) && isVideo(body.video) && isVideoArray(body.related) && typeof body.blocked === "boolean"
    && (expectedId === undefined || body.video.id === expectedId);
}

export function isSuggestions(body: unknown): body is { suggestions: string[] } {
  return isRecord(body) && Array.isArray(body.suggestions) && body.suggestions.every((item) => typeof item === "string");
}
