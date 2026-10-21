"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { Feed, FeedSkeleton } from "@/components/feed";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/browser";
import { isSuggestions, isVideoList } from "@/lib/api-response";
import { emptySnapshot, parseQueries, queriesSnapshot, rememberQuery, subscribeQueries, useOnClient } from "@/lib/recent";
import type { Video } from "@/lib/types";

export function SearchView() {
  const params = useSearchParams();
  const initial = params.get("q") ?? "";
  return <SearchResults key={initial} initial={initial} />;
}

function SearchResults({ initial }: { initial: string }) {
  const onClient = useOnClient();
  const recentRaw = useSyncExternalStore(subscribeQueries, queriesSnapshot, emptySnapshot);
  const recent = onClient ? parseQueries(recentRaw) : [];
  const [draft, setDraft] = useState(initial);
  const [query, setQuery] = useState(initial.trim());
  const [suggestions, setSuggestions] = useState<{ query: string; items: string[] } | null>(null);
  const [result, setResult] = useState<{ query: string; videos: Video[] } | null>(null);
  const [failure, setFailure] = useState<{ query: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [openSuggestions, setOpenSuggestions] = useState(false);
  const debounceRef = useRef(0);
  const searchActive = Boolean(draft.trim() && query);
  const error = searchActive && failure?.query === query ? failure.message : "";

  useEffect(() => () => window.clearTimeout(debounceRef.current), []);

  useEffect(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchJson(`/api/suggest?q=${encodeURIComponent(trimmed)}`, controller.signal, isSuggestions)
        .then((body) => {
          if (controller.signal.aborted) return;
          setSuggestions({ query: trimmed, items: body.suggestions.filter((item) => item.toLowerCase() !== trimmed.toLowerCase()) });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSuggestions(null);
        });
    }, 160);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft]);

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    void fetchJson(`/api/search?q=${encodeURIComponent(query)}`, controller.signal, isVideoList)
      .then((body) => {
        if (controller.signal.aborted) return;
        setResult({ query, videos: body.videos });
        setFailure(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setFailure({ query, message: cause instanceof Error ? cause.message : "Die Suche ist gerade nicht zu erreichen." });
      });
    return () => controller.abort();
  }, [query, attempt]);

  function schedule(next: string) {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => setQuery(next.trim()), 240);
  }

  function choose(next: string) {
    window.clearTimeout(debounceRef.current);
    const trimmed = next.trim();
    setDraft(trimmed);
    setQuery(trimmed);
    setOpenSuggestions(false);
    setSuggestions(null);
    setFailure(null);
    if (trimmed === query && failure?.query === query) setAttempt((value) => value + 1);
    if (trimmed) rememberQuery(trimmed);
  }

  const shownSuggestions = suggestions?.query === draft.trim() ? suggestions.items : [];
  const videos = searchActive && result?.query === query ? result.videos : null;
  const waiting = searchActive && result?.query !== query && !error;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-4xl">Suche</h1>
      <form
        role="search"
        className="sticky top-0 z-10 -mx-4 bg-background/95 px-4 py-2 backdrop-blur md:mx-0 md:px-0"
        onSubmit={(event) => {
          event.preventDefault();
          choose(draft);
        }}
      >
        <label htmlFor="langform-q" className="sr-only">
          Lange Videos suchen
        </label>
        <Input
          id="langform-q"
          value={draft}
          onChange={(event) => {
            const value = event.target.value;
            setDraft(value);
            if (!value.trim()) setSuggestions(null);
            setOpenSuggestions(true);
            schedule(value);
          }}
          onFocus={() => setOpenSuggestions(true)}
          placeholder="Titel oder Thema"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          className="h-12 bg-card px-3 text-base"
        />
        {openSuggestions && shownSuggestions.length > 0 ? (
          <ul aria-label="Vorschläge" className="mt-2 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            {shownSuggestions.map((item) => (
              <li key={item}>
                <button
                  type="button"
                  className="min-h-12 w-full touch-manipulation px-3 text-left text-base hover:bg-muted"
                  onClick={() => choose(item)}
                >
                  {item}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </form>

      {onClient && !draft.trim() ? (
        <section aria-labelledby="letzte-suchen" className="flex flex-col gap-2">
          <h2 id="letzte-suchen" className="font-heading text-2xl">
            Letzte Suchen
          </h2>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch nichts gesucht auf diesem Gerät.</p>
          ) : (
            <ul className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
              {recent.map((item) => (
                <li key={item}>
                  <button
                    type="button"
                    className="min-h-12 w-full touch-manipulation px-3 text-left hover:bg-muted"
                    onClick={() => choose(item)}
                  >
                    {item}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {error ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button type="button" className="h-11 w-fit px-4" onClick={() => {
            setFailure(null);
            setAttempt((value) => value + 1);
          }}>Erneut laden</Button>
        </div>
      ) : null}
      {waiting ? <FeedSkeleton /> : null}
      {draft.trim() && query && videos && result?.query === query && videos.length === 0 ? (
        <p className="text-muted-foreground">Nichts Langes zu „{query}“.</p>
      ) : null}
      {videos && videos.length > 0 ? (
        <Feed
          videos={videos}
          onOpen={() => {
            rememberQuery(query);
          }}
        />
      ) : null}
    </div>
  );
}
