export type ShortSignal = {
  title?: string | null;
  url?: string | null;
  durationSeconds?: number | null;
  type?: string | null;
  isShort?: boolean | null;
};

const SHORT_TYPES = new Set(["shortvideo", "shorts", "short"]);

export function isShort(signal: ShortSignal): boolean {
  if (signal.isShort === true) return true;
  const type = signal.type?.trim().toLowerCase();
  if (type && SHORT_TYPES.has(type)) return true;
  if (signal.url && /\/shorts(?:\/|$|\?)/i.test(signal.url)) return true;
  if (signal.title && /#shorts\b/i.test(signal.title)) return true;
  const duration = signal.durationSeconds;
  if (
    typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration >= 0 &&
    duration < 60
  ) {
    return true;
  }
  return false;
}

export function isLongVideo(signal: ShortSignal): boolean {
  return !isShort(signal);
}
