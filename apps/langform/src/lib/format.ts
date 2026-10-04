const UNITS: Record<string, [string, string]> = {
  second: ["Sekunde", "Sekunden"],
  minute: ["Minute", "Minuten"],
  hour: ["Stunde", "Stunden"],
  day: ["Tag", "Tagen"],
  week: ["Woche", "Wochen"],
  month: ["Monat", "Monaten"],
  year: ["Jahr", "Jahren"],
};

export function translateUploadedLabel(text: string): string {
  const trimmed = text.trim();
  let rest = trimmed;
  let prefix = "";
  const lead = /^(streamed|premiered)\s+/i.exec(trimmed);
  if (lead) {
    prefix = lead[1].toLowerCase() === "premiered" ? "Premiere, " : "Live, ";
    rest = trimmed.slice(lead[0].length);
  }
  const match = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.exec(rest);
  if (!match) return trimmed;
  const count = Number(match[1]);
  const [one, many] = UNITS[match[2].toLowerCase()];
  return `${prefix}vor ${count} ${count === 1 ? one : many}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

export function formatPublished(unixSeconds: number, nowMs = Date.now()): string {
  const deltaSeconds = Math.round(unixSeconds - nowMs / 1000);
  const format = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
  const abs = Math.abs(deltaSeconds);
  if (abs < 60) return format.format(deltaSeconds, "second");
  if (abs < 3600) return format.format(Math.round(deltaSeconds / 60), "minute");
  if (abs < 86400) return format.format(Math.round(deltaSeconds / 3600), "hour");
  if (abs < 86400 * 30) return format.format(Math.round(deltaSeconds / 86400), "day");
  if (abs < 86400 * 365) return format.format(Math.round(deltaSeconds / (86400 * 30)), "month");
  return format.format(Math.round(deltaSeconds / (86400 * 365)), "year");
}

export function formatViews(count: number | null): string {
  if (count == null || !Number.isFinite(count) || count < 0) return "";
  if (count === 1) return "1 Aufruf";
  const compact = count >= 10_000;
  const formatted = new Intl.NumberFormat("de-DE", {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(count);
  return `${formatted} Aufrufe`;
}

export function formatSubscribers(count: number | null): string {
  if (count == null || !Number.isFinite(count) || count <= 0) return "";
  const formatted = new Intl.NumberFormat("de-DE", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(count);
  return `${formatted} Abos`;
}

export function publishedLabel(publishedAt: number | null, publishedText: string, nowMs = Date.now()): string {
  if (publishedAt && publishedAt > 0) return formatPublished(publishedAt, nowMs);
  return publishedText;
}
