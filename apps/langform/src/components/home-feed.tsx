"use client";

import { useEffect, useRef, useState } from "react";
import { Feed, FeedSkeleton } from "@/components/feed";
import { Button } from "@/components/ui/button";
import { useAppShell } from "@/components/app-shell";
import { fetchJson } from "@/lib/browser";
import type { Video } from "@/lib/types";

export function HomeFeed() {
  const { scrollerRef } = useAppShell();
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [pull, setPull] = useState(0);
  const refreshRef = useRef<(fresh: boolean) => void>(() => {});

  const load = (fresh: boolean) => {
    void fetchJson<{ videos: Video[] }>(fresh ? "/api/home?fresh=1" : "/api/home")
      .then((body) => {
        setVideos(body.videos);
        setError("");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Die Liste ist gerade nicht zu erreichen.");
      })
      .finally(() => setRefreshing(false));
  };

  useEffect(() => {
    refreshRef.current = load;
  });

  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<{ videos: Video[] }>("/api/home", controller.signal)
      .then((body) => {
        setVideos(body.videos);
        setError("");
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Die Liste ist gerade nicht zu erreichen.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let startY = 0;
    let armed = false;
    let distance = 0;

    const onStart = (event: TouchEvent) => {
      if (el.scrollTop > 2) return;
      armed = true;
      startY = event.touches[0]?.clientY ?? 0;
      distance = 0;
    };
    const onMove = (event: TouchEvent) => {
      if (!armed) return;
      if (el.scrollTop > 2) {
        armed = false;
        distance = 0;
        setPull(0);
        return;
      }
      const y = event.touches[0]?.clientY ?? startY;
      distance = Math.max(0, y - startY);
      if (distance > 8) event.preventDefault();
      setPull(Math.min(distance, 128));
    };
    const onEnd = () => {
      if (armed && distance > 72) {
        setRefreshing(true);
        refreshRef.current(true);
      }
      armed = false;
      distance = 0;
      setPull(0);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
  }, [scrollerRef]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-[0.22em] text-primary uppercase">Programm</p>
          <h1 className="font-heading text-4xl leading-tight">Was gerade lang läuft</h1>
        </div>
        <Button
          type="button"
          variant="outline"
          className="hidden h-11 px-3 md:inline-flex"
          onClick={() => {
            setRefreshing(true);
            load(true);
          }}
        >
          Aktualisieren
        </Button>
      </header>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Aktuelle Videos ab einer Minute. Kurzvideos bleiben draußen.
      </p>
      {pull > 0 ? (
        <div className="overflow-hidden text-center text-sm text-primary" style={{ height: pull }}>
          <span className="inline-flex h-8 items-center">
            {pull > 72 ? "Loslassen zum Aktualisieren" : "Ziehen zum Aktualisieren"}
          </span>
        </div>
      ) : null}
      {refreshing && videos ? <p className="text-sm text-primary">Aktualisiere die Liste …</p> : null}
      {error ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button
            type="button"
            className="h-11 w-fit px-4"
            onClick={() => {
              setRefreshing(true);
              load(true);
            }}
          >
            Erneut laden
          </Button>
        </div>
      ) : null}
      {videos === null && !error ? <FeedSkeleton /> : null}
      {videos && videos.length === 0 && !error ? (
        <p className="text-muted-foreground">Gerade liegt nichts Langes in der Liste.</p>
      ) : null}
      {videos && videos.length > 0 ? <Feed videos={videos} /> : null}
    </div>
  );
}
