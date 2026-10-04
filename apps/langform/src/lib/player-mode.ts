export type PlayerMode = "full" | "mini" | "off";

export function playerMode(path: string, activeId: string | null, started: boolean, forceFull: boolean): PlayerMode {
  if (!activeId) return "off";
  if (forceFull || path === `/schauen/${activeId}`) return "full";
  if (started) return "mini";
  return "off";
}

export function playerStateFromMessage(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.event === "onStateChange" && typeof record.info === "number") return record.info;
  if (record.event === "infoDelivery") {
    const info = record.info;
    if (info && typeof info === "object" && typeof (info as { playerState?: unknown }).playerState === "number") {
      return (info as { playerState: number }).playerState;
    }
  }
  return null;
}

export function playbackHasStarted(state: number | null): boolean {
  return state === 1 || state === 3;
}
