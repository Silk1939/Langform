"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Feed, FeedSkeleton } from "@/components/feed";
import { useAppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/browser";
import { isWatchDetails } from "@/lib/api-response";
import { formatViews, publishedLabel } from "@/lib/format";
import { CHANNEL_ID } from "@/lib/ids";
import type { WatchDetails } from "@/lib/types";

export function WatchView({ id }: { id: string }) {
  const { openVideo, closeVideo, nowPlaying } = useAppShell();
  const seeded = nowPlaying?.id === id && nowPlaying.title !== "Langes Video" ? nowPlaying : null;
  const [result, setResult] = useState<{ id: string; details: WatchDetails } | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [relatedState, setRelatedState] = useState<{ id: string; status: "loading" | "error" | "done" } | null>(null);
  const details = result?.id === id ? result.details : null;
  const error = failure?.id === id ? failure.message : "";

  useEffect(() => {
    const controller = new AbortController();
    const matchesWatch = (body: unknown): body is WatchDetails => isWatchDetails(body, id);
    void fetchJson(`/api/watch/${id}`, controller.signal, matchesWatch)
      .then((body) => {
        if (controller.signal.aborted) return;
        setResult({ id, details: body });
        setFailure(null);
        if (body.blocked) closeVideo(id);
        else {
          openVideo({
            id: body.video.id,
            title: body.video.title,
            channelName: body.video.channelName,
            channelId: body.video.channelId,
          });
          if (body.related.length === 0 || !body.video.channelName) {
            setRelatedState({ id, status: "loading" });
            void fetchJson(`/api/watch/${id}?related=1`, controller.signal, matchesWatch)
              .then((enriched) => {
                if (controller.signal.aborted) return;
                setResult({ id, details: enriched });
                setRelatedState({ id, status: "done" });
                if (enriched.blocked) closeVideo(id);
              })
              .catch(() => {
                if (!controller.signal.aborted) setRelatedState({ id, status: "error" });
              });
          }
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setFailure({ id, message: cause instanceof Error ? cause.message : "Die Angaben sind gerade nicht zu erreichen." });
      });
    return () => controller.abort();
  }, [id, attempt, openVideo, closeVideo]);

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
      {error ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button type="button" className="h-11 w-fit px-4" onClick={() => {
            setFailure(null);
            setAttempt((value) => value + 1);
          }}>Erneut laden</Button>
        </div>
      ) : null}
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
        {details && details.related.length === 0 && relatedState?.id === id && relatedState.status === "loading" ? <FeedSkeleton /> : null}
        {details && details.related.length === 0 && !(relatedState?.id === id && relatedState.status === "loading") ? (
          <p className="text-sm text-muted-foreground">
            {relatedState?.id === id && relatedState.status === "error"
              ? "Die Vorschläge sind gerade nicht zu erreichen."
              : "Dazu liegen gerade keine langen Vorschläge vor."}
          </p>
        ) : null}
      </section>
    </div>
  );
}
