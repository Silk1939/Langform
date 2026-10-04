"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useAppShell } from "@/components/app-shell";
import { Thumbnail } from "@/components/thumbnail";
import { formatPublished } from "@/lib/format";
import { emptySnapshot, historySnapshot, parseHistory, subscribeHistory, useOnClient } from "@/lib/recent";

export function HistoryView() {
  const { openVideo } = useAppShell();
  const onClient = useOnClient();
  const raw = useSyncExternalStore(subscribeHistory, historySnapshot, emptySnapshot);
  const items = onClient ? parseHistory(raw) : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-4xl">Verlauf</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Zuletzt angesehen, nur auf diesem Gerät. Ein Tipp setzt das Video fort.
        </p>
      </header>
      {items === null ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <p className="sr-only">Verlauf wird gelesen.</p>
          <div className="h-16 animate-pulse rounded-xl bg-muted" />
          <div className="h-16 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">Noch nichts angesehen. Was du startest, bleibt hier liegen.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/schauen/${item.id}`}
                scroll={false}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  openVideo(item, { gesture: true });
                }}
                className="flex min-h-16 touch-manipulation items-center gap-3 active:opacity-80"
              >
                <span className="w-36 shrink-0 overflow-hidden rounded-lg bg-muted">
                  <Thumbnail id={item.id} />
                </span>
                <span className="min-w-0">
                  <span className="line-clamp-2 block text-base leading-snug font-medium">{item.title}</span>
                  <span className="mt-1 block truncate text-sm text-muted-foreground">
                    {[item.channelName, formatPublished(item.watchedAt / 1000)].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
