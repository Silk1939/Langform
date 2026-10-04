import { useSyncExternalStore } from "react";
import { VIDEO_ID } from "@/lib/ids";

const KEY = "langform.recent";
const MAX = 16;

export type RecentWatch = {
  id: string;
  title: string;
  channelName: string;
  channelId: string;
  watchedAt: number;
};

function isRecent(value: unknown): value is RecentWatch {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    VIDEO_ID.test(record.id) &&
    typeof record.title === "string" &&
    record.title.trim().length > 0 &&
    typeof record.channelName === "string" &&
    typeof record.channelId === "string" &&
    record.channelId.length <= 64 &&
    typeof record.watchedAt === "number"
  );
}

export function readRecent(): RecentWatch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecent).slice(0, MAX);
  } catch {
    return [];
  }
}

const QUERY_KEY = "langform.queries";
const QUERY_MAX = 8;

export function nextQueries(existing: string[], query: string, max = QUERY_MAX): string[] {
  const trimmed = query.trim();
  if (!trimmed) return existing.slice(0, max);
  return [trimmed, ...existing.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, max);
}

export function readQueries(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUERY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, QUERY_MAX);
  } catch {
    return [];
  }
}

export function rememberQuery(query: string): string[] {
  if (typeof window === "undefined") return [];
  const items = nextQueries(readQueries(), query);
  window.localStorage.setItem(QUERY_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("langform-queries"));
  return items;
}

function subscribe(name: string, onChange: () => void) {
  const notify = () => onChange();
  window.addEventListener(name, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(name, notify);
    window.removeEventListener("storage", notify);
  };
}

export function subscribeHistory(onChange: () => void) {
  return subscribe("langform-history", onChange);
}

export function subscribeQueries(onChange: () => void) {
  return subscribe("langform-queries", onChange);
}

export function historySnapshot(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(KEY) ?? "";
}

export function queriesSnapshot(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(QUERY_KEY) ?? "";
}

function subscribeNoop() {
  return () => {};
}

export function useOnClient(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

export function emptySnapshot(): string {
  return "";
}

export function parseQueries(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, QUERY_MAX);
  } catch {
    return [];
  }
}

export function parseHistory(raw: string): RecentWatch[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecent).slice(0, MAX);
  } catch {
    return [];
  }
}

export function rememberWatch(entry: Omit<RecentWatch, "watchedAt">): void {
  if (typeof window === "undefined") return;
  if (!VIDEO_ID.test(entry.id) || !entry.title.trim()) return;
  const next: RecentWatch = { ...entry, title: entry.title.trim(), watchedAt: Date.now() };
  const items = [next, ...readRecent().filter((item) => item.id !== entry.id)].slice(0, MAX);
  window.localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("langform-history"));
}
