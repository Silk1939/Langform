"use client";

import { useEffect, useState } from "react";
import { Feed, FeedSkeleton } from "@/components/feed";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/browser";
import { formatSubscribers } from "@/lib/format";
import type { ChannelInfo, Video } from "@/lib/types";

export function ChannelView({ id }: { id: string }) {
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<{ channel: ChannelInfo; videos: Video[] }>(`/api/channel/${id}`, controller.signal)
      .then((body) => {
        setChannel(body.channel);
        setVideos(body.videos);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Der Kanal ist gerade nicht zu erreichen.");
      });
    return () => controller.abort();
  }, [id, attempt]);

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-4xl">Kanal</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button type="button" className="h-11 w-fit px-4" onClick={() => setAttempt((value) => value + 1)}>
          Erneut laden
        </Button>
      </div>
    );
  }

  if (!channel || !videos) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-10 w-1/2 animate-pulse rounded-md bg-muted" />
        <FeedSkeleton />
      </div>
    );
  }

  const subs = formatSubscribers(channel.subscriberCount);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2 border-b border-border pb-4">
        <p className="text-xs tracking-[0.22em] text-primary uppercase">Kanal</p>
        <h1 className="font-heading text-4xl leading-tight">{channel.name}</h1>
        {subs ? <p className="text-sm text-muted-foreground">{subs}</p> : null}
        {channel.description ? (
          <p className="line-clamp-4 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {channel.description}
          </p>
        ) : null}
      </header>
      {videos.length === 0 ? (
        <p className="text-muted-foreground">Auf diesem Kanal liegt gerade nichts, das länger als eine Minute ist.</p>
      ) : (
        <Feed videos={videos} />
      )}
    </div>
  );
}
