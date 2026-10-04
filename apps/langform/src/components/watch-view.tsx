"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Feed, FeedSkeleton } from "@/components/feed";
import { useAppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/browser";
import { formatViews, publishedLabel } from "@/lib/format";
import { CHANNEL_ID } from "@/lib/ids";
import type { WatchDetails } from "@/lib/types";

export function WatchView({ id }: { id: string }) {
  const { openVideo, closeVideo, nowPlaying } = useAppShell();
  const seeded = nowPlaying?.id === id && nowPlaying.title !== "Langes Video" ? nowPlaying : null;
  const [details, setDetails] = useState<WatchDetails | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<WatchDetails>(`/api/watch/${id}`, controller.signal)
      .then((body) => {
        if (controller.signal.aborted) return;
        setDetails(body);
        if (body.blocked) closeVideo();
        else {
          openVideo({
            id: body.video.id,
            title: body.video.title,
            channelName: body.video.channelName,
            channelId: body.video.channelId,
          });
        }
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Die Angaben sind gerade nicht zu erreichen.");
      });
    return () => controller.abort();
  }, [id, openVideo, closeVideo]);

  if (details?.blocked) {
    return (
      <div className="flex flex-col gap-4 py-6">
        <p className="text-xs tracking-[0.22em] text-primary uppercase">Kurzvideo</p>
        <h1 className="font-heading text-4xl">Das ist ein Kurzvideo</h1>
        <p className="leading-relaxed text-muted-foreground">
          Langform spielt keine Kurzvideos ab.
          {details.video.title ? ` „${details.video.title}“ bleibt draußen.` : ""}
        </p>
        <Button render={<Link href="/" scroll={false} />} className="h-11 w-fit px-4">
          Zur Übersicht
        </Button>
      </div>
    );
  }

  const video = details?.video;
  const title = video?.title || seeded?.title || "";
  const channelName = video?.channelName || seeded?.channelName || "";
  const channelId = video?.channelId || seeded?.channelId || "";
  const when = video ? publishedLabel(video.publishedAt, video.publishedText) : "";
  const views = video ? formatViews(video.viewCount) : "";
  const meta = [views, when].filter(Boolean).join(" · ");
  const channelHref = CHANNEL_ID.test(channelId) ? `/kanal/${channelId}` : null;

  return (
    <div className="flex flex-col gap-5">
      {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
      <h1 className="font-heading text-3xl leading-tight text-balance md:text-4xl">
        {title || "Langes Video"}
      </h1>
      {title ? (
        <div className="flex flex-col gap-1 text-sm">
          {channelHref ? (
            <Link href={channelHref} scroll={false} className="inline-flex min-h-11 w-fit items-center text-primary">
              {channelName || "Zum Kanal"}
            </Link>
          ) : channelName ? (
            <p>{channelName}</p>
          ) : null}
          {meta ? <p className="text-muted-foreground">{meta}</p> : null}
        </div>
      ) : !error ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <div className="h-8 w-2/3 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-1/3 animate-pulse rounded-md bg-muted" />
        </div>
      ) : null}
      {video?.description ? (
        <details className="rounded-xl bg-card p-4 ring-1 ring-foreground/10" open={video.description.length < 280}>
          <summary className="min-h-11 cursor-pointer text-sm font-medium">Beschreibung</summary>
          <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{video.description}</p>
        </details>
      ) : null}
      <section className="flex flex-col gap-3" aria-labelledby="aehnlich-heading">
        <h2 id="aehnlich-heading" className="font-heading text-2xl">
          Ähnliche lange Videos
        </h2>
        {!details && !error ? <FeedSkeleton /> : null}
        {details && details.related.length > 0 ? <Feed videos={details.related} /> : null}
        {details && details.related.length === 0 ? (
          <p className="text-sm text-muted-foreground">Dazu liegen gerade keine langen Vorschläge vor.</p>
        ) : null}
      </section>
    </div>
  );
}
