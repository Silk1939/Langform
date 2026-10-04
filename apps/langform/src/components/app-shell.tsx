"use client";

import { Clock, House, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Mark } from "@/components/mark";
import { officialEmbedSrc, VIDEO_ID } from "@/lib/ids";
import { playbackHasStarted, playerMode, playerStateFromMessage, type PlayerMode } from "@/lib/player-mode";
import { rememberWatch } from "@/lib/recent";
import { cn } from "cn";

export type Playable = {
  id: string;
  title: string;
  channelName: string;
  channelId: string;
};

type ShellApi = {
  openVideo: (video: Playable, options?: { gesture?: boolean }) => void;
  closeVideo: () => void;
  nowPlaying: Playable | null;
  scrollerRef: RefObject<HTMLDivElement | null>;
};

const ShellContext = createContext<ShellApi | null>(null);

export function useAppShell(): ShellApi {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("Die Hülle fehlt.");
  return shell;
}

const TABS = [
  { href: "/", label: "Start", icon: House },
  { href: "/suche", label: "Suche", icon: Search },
  { href: "/verlauf", label: "Verlauf", icon: Clock },
] as const;

function tabActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href;
}

function watchId(path: string): string | null {
  return path.match(/^\/schauen\/([A-Za-z0-9_-]{11})$/)?.[1] ?? null;
}

function placeholder(id: string): Playable {
  return { id, title: "Langes Video", channelName: "", channelId: "" };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [seenPath, setSeenPath] = useState(pathname);
  const [active, setActive] = useState<Playable | null>(() => {
    const id = watchId(pathname);
    return id ? placeholder(id) : null;
  });
  const [started, setStarted] = useState(false);
  const [forceFull, setForceFull] = useState(false);

  if (seenPath !== pathname) {
    setSeenPath(pathname);
    const id = watchId(pathname);
    if (id && active?.id !== id) {
      setActive(placeholder(id));
      setStarted(false);
      setForceFull(true);
    } else if (id && active?.id === id) {
      setForceFull(false);
    } else if (!id && active && !started) {
      setActive(null);
      setForceFull(false);
    } else if (!id) {
      setForceFull(false);
    }
  }

  const closeVideo = useCallback(() => {
    setActive(null);
    setStarted(false);
    setForceFull(false);
  }, []);

  const openVideo = useCallback((video: Playable, options?: { gesture?: boolean }) => {
    if (!VIDEO_ID.test(video.id)) return;
    const frame = frameRef.current;
    const current = frame?.src.match(/\/embed\/([A-Za-z0-9_-]{11})/)?.[1];
    if (frame && current !== video.id) {
      frame.src = officialEmbedSrc(video.id, window.location.origin, true);
      if (!options?.gesture) setStarted(false);
    }
    if (options?.gesture) setStarted(true);
    const title = video.title.trim() || "Langes Video";
    if (frame) frame.title = title;
    setActive({ ...video, title });
    setForceFull(true);
    if (title !== "Langes Video") {
      rememberWatch({
        id: video.id,
        title,
        channelName: video.channelName,
        channelId: video.channelId,
      });
    }
  }, []);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (!frame.src || frame.src === window.location.href) frame.src = "about:blank";
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (!active) {
      if (frame.src.includes("youtube.com/embed/")) {
        frame.contentWindow?.postMessage(
          JSON.stringify({
            event: "command",
            func: "stopVideo",
            args: [],
            id: "langform",
            channel: "widget",
          }),
          "https://www.youtube.com",
        );
        frame.src = "about:blank";
      }
      return;
    }
    const current = frame.src.match(/\/embed\/([A-Za-z0-9_-]{11})/)?.[1];
    if (current !== active.id) frame.src = officialEmbedSrc(active.id, window.location.origin, true);
    frame.title = active.title;
  }, [active]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const subscribe = () => {
      if (!frame.src.includes("youtube.com/embed/")) return;
      frame.contentWindow?.postMessage(
        JSON.stringify({ event: "listening", id: "langform", channel: "widget" }),
        "https://www.youtube.com",
      );
      frame.contentWindow?.postMessage(
        JSON.stringify({
          event: "command",
          func: "addEventListener",
          args: ["onStateChange"],
          id: "langform",
          channel: "widget",
        }),
        "https://www.youtube.com",
      );
    };
    frame.addEventListener("load", subscribe);
    return () => frame.removeEventListener("load", subscribe);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== "https://www.youtube.com") return;
      if (event.source !== frameRef.current?.contentWindow) return;
      let data: unknown = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data) as unknown;
        } catch {
          return;
        }
      }
      if (playbackHasStarted(playerStateFromMessage(data))) setStarted(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  const mode: PlayerMode = playerMode(pathname, active?.id ?? null, started, forceFull);
  const shell: ShellApi = { openVideo, closeVideo, nowPlaying: active, scrollerRef };

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-dvh min-h-0">
        <aside className="hidden w-60 shrink-0 flex-col gap-1 border-r border-border bg-card/40 px-3 py-4 md:flex">
          <Link href="/" scroll={false} className="mb-6 flex items-center gap-2.5 px-2 text-primary">
            <Mark className="h-7 w-12" />
            <span className="font-heading text-3xl leading-none tracking-tight text-foreground">Langform</span>
          </Link>
          <nav aria-label="Bereiche" className="flex flex-col gap-1">
            {TABS.map((tab) => (
              <TabLink key={tab.href} {...tab} active={tabActive(pathname, tab.href)} wide />
            ))}
          </nav>
          <p className="mt-auto px-2 pt-6 text-xs leading-relaxed text-muted-foreground">
            Nur lange Videos. Wiedergabe im offiziellen Player. Kein Konto.
          </p>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-4 md:hidden">
            <Mark className="h-6 w-10 text-primary" />
            <span className="font-heading text-2xl leading-none tracking-tight">Langform</span>
          </header>
          <PlayerSlot mode={mode} active={active} frameRef={frameRef} closeVideo={closeVideo} />
          <div
            ref={scrollerRef}
            id="inhalt"
            className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-[calc(4.75rem+env(safe-area-inset-bottom))] md:pb-8"
          >
            <div className="mx-auto w-full max-w-3xl px-4 py-4 md:px-6">{children}</div>
          </div>
        </div>
      </div>
      <nav
        aria-label="Bereiche"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex">
          {TABS.map((tab) => (
            <TabLink key={tab.href} {...tab} active={tabActive(pathname, tab.href)} />
          ))}
        </div>
      </nav>
    </ShellContext.Provider>
  );
}

function TabLink({
  href,
  label,
  icon: Icon,
  active,
  wide = false,
}: {
  href: string;
  label: string;
  icon: typeof House;
  active: boolean;
  wide?: boolean;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex touch-manipulation items-center justify-center gap-2 text-sm font-medium",
        wide ? "min-h-12 justify-start rounded-xl px-3" : "min-h-14 flex-1 flex-col gap-1 text-xs",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon aria-hidden="true" className="size-6" />
      {label}
    </Link>
  );
}

function PlayerSlot({
  mode,
  active,
  frameRef,
  closeVideo,
}: {
  mode: PlayerMode;
  active: Playable | null;
  frameRef: RefObject<HTMLIFrameElement | null>;
  closeVideo: () => void;
}) {
  return (
    <div
      className={cn(
        mode === "full" && "mx-auto w-full max-w-3xl shrink-0",
        mode === "mini" &&
          "fixed right-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 w-56 overflow-hidden rounded-xl bg-card shadow-2xl ring-1 ring-primary/30 md:right-6 md:bottom-6",
        mode === "off" && "sr-only",
      )}
    >
      <div className="relative aspect-video bg-black">
        <iframe
          ref={frameRef}
          className="absolute inset-0 h-full w-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          title={active?.title ?? "Video"}
        />
        {mode === "mini" && active ? (
          <Link
            href={`/schauen/${active.id}`}
            scroll={false}
            className="absolute inset-0 z-10"
            aria-label={`${active.title}, weiter ansehen`}
          />
        ) : null}
        {mode === "mini" ? (
          <button
            type="button"
            onClick={closeVideo}
            className="absolute top-1 right-1 z-20 flex size-11 touch-manipulation items-center justify-center rounded-full bg-background/85 text-foreground"
            aria-label="Wiedergabe beenden"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        ) : null}
      </div>
      {mode === "mini" && active ? (
        <Link href={`/schauen/${active.id}`} scroll={false} className="block min-h-12 px-3 py-2">
          <span className="line-clamp-2 text-sm leading-snug">{active.title}</span>
          {active.channelName ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{active.channelName}</span>
          ) : null}
        </Link>
      ) : null}
    </div>
  );
}
