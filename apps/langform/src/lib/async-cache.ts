export function createAsyncCache(ttlMs: number, maxEntries: number) {
  const values = new Map<string, { at: number; value: unknown }>();
  const pending = new Map<string, Promise<unknown>>();

  function load<T>(key: string, loader: () => Promise<T>, fresh = false): Promise<T> {
    const hit = values.get(key);
    if (!fresh && hit && Date.now() - hit.at < ttlMs) {
      values.delete(key);
      values.set(key, hit);
      return Promise.resolve(hit.value as T);
    }
    const running = pending.get(key);
    if (running) return running as Promise<T>;

    const request = Promise.resolve().then(loader).then((value) => {
      const now = Date.now();
      for (const [cachedKey, cached] of values) {
        if (now - cached.at >= ttlMs) values.delete(cachedKey);
      }
      values.delete(key);
      values.set(key, { at: now, value });
      while (values.size > maxEntries) {
        values.delete(values.keys().next().value!);
      }
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  return { load };
}
