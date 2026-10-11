export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const UNREADABLE_RESPONSE = "Die Antwort konnte nicht gelesen werden. Bitte erneut laden.";

export async function fetchJson<T>(url: string, signal?: AbortSignal, validate?: (body: unknown) => body is T): Promise<T> {
  if (signal?.aborted) throw signal.reason;
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  // Allow the server's sequential source fallbacks, but bound the entire
  // browser request, including a stalled body, so manual retry stays reachable.
  const timer = setTimeout(() => controller.abort(new ApiError(
    "Die Anfrage dauert zu lange. Bitte erneut laden.",
  )), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (response.ok) throw new ApiError(UNREADABLE_RESPONSE);
    }
    if (controller.signal.aborted) throw controller.signal.reason;
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : "Die Angaben sind gerade nicht zu erreichen.";
      throw new ApiError(message);
    }
    if (validate && !validate(body)) throw new ApiError(UNREADABLE_RESPONSE);
    return body as T;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
