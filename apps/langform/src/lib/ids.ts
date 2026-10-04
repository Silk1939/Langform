export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

export function videoIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match =
    url.match(/\/shorts\/([A-Za-z0-9_-]{11})/) ??
    url.match(/[?&]v=([A-Za-z0-9_-]{11})/) ??
    url.match(/\/embed\/([A-Za-z0-9_-]{11})/) ??
    url.match(/\/watch\/([A-Za-z0-9_-]{11})/);
  if (match) return match[1];
  return VIDEO_ID.test(url) ? url : null;
}

export function channelIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (match) return match[1];
  return CHANNEL_ID.test(url) ? url : null;
}

export function thumbnailUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export function embedUrl(id: string): string {
  return `https://www.youtube.com/embed/${id}`;
}

export function officialEmbedSrc(id: string, origin: string, autoplay: boolean): string {
  if (!VIDEO_ID.test(id)) throw new Error("Unbekanntes Video");
  const url = new URL(embedUrl(id));
  url.searchParams.set("playsinline", "1");
  url.searchParams.set("rel", "0");
  url.searchParams.set("enablejsapi", "1");
  if (autoplay) url.searchParams.set("autoplay", "1");
  if (origin) url.searchParams.set("origin", origin);
  return url.toString();
}
