"use client";

import Link from "next/link";
import { Thumbnail } from "@/components/thumbnail";
import { useAppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, publishedLabel } from "@/lib/format";
import { CHANNEL_ID } from "@/lib/ids";
import type { Video } from "@/lib/types";

export function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-7" aria-busy="true" aria-live="polite">
      <p className="sr-only">Lange Videos werden geladen.</p>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex flex-col gap-3">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function Feed({ videos, onOpen }: { videos: Video[]; onOpen?: (video: Video) => void }) {
  const { openVideo } = useAppShell();

  return (
    <ul className="flex flex-col gap-7">
      {videos.map((video) => {
        const when = publishedLabel(video.publishedAt, video.publishedText);
        const channelHref = CHANNEL_ID.test(video.channelId) ? `/kanal/${video.channelId}` : null;
        return (
          <li key={video.id}>
            <article>
              <Link
                href={`/schauen/${video.id}`}
                scroll={false}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  onOpen?.(video);
                  openVideo(video, { gesture: true });
                }}
                className="block touch-manipulation text-left active:opacity-80"
              >
                <span className="relative block overflow-hidden rounded-xl bg-muted">
                  <Thumbnail id={video.id} />
                  {video.durationSeconds != null && video.durationSeconds >= 60 ? (
                    <span className="absolute right-2 bottom-2 rounded bg-background/85 px-1.5 py-0.5 text-xs font-medium text-primary tabular-nums">
                      {formatDuration(video.durationSeconds)}
                    </span>
                  ) : video.durationSeconds != null && video.durationSeconds < 0 ? (
                    <span className="absolute right-2 bottom-2 rounded bg-background/85 px-1.5 py-0.5 text-xs font-medium text-primary">
                      Live
                    </span>
                  ) : null}
                </span>
                <span className="mt-2 block text-base leading-snug font-medium">{video.title}</span>
              </Link>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {channelHref ? (
                  <Link href={channelHref} scroll={false} className="inline-flex min-h-11 items-center text-primary">
                    {video.channelName || "Kanal"}
                  </Link>
                ) : (
                  <span>{video.channelName}</span>
                )}
                {when ? <span>{when}</span> : null}
              </p>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
