export class MetadataError extends Error {
  readonly causes: string[];

  constructor(causes: string[]) {
    super("Die Filmdaten sind gerade nicht erreichbar.");
    this.name = "MetadataError";
    this.causes = causes;
  }
}

type Loader<T> = {
  name: string;
  load: (signal: AbortSignal) => Promise<T>;
};

export function firstUseful<T>(
  loaders: Array<Loader<T>>,
  accept: (value: T) => boolean,
  options?: { empty?: T },
): Promise<T> {
  if (loaders.length === 0) {
    return Promise.reject(new MetadataError(["keine Quelle"]));
  }

  const controller = new AbortController();
  const causes: string[] = [];
  let pending = loaders.length;
  let settled = false;
  let sawValue = false;

  return new Promise((resolve, reject) => {
    const finish = () => {
      pending -= 1;
      if (pending === 0 && !settled) {
        settled = true;
        if (sawValue && options && "empty" in options) resolve(options.empty as T);
        else reject(new MetadataError(causes));
      }
    };

    for (const loader of loaders) {
      Promise.resolve()
        .then(() => loader.load(controller.signal))
        .then((value) => {
          if (settled) return;
          if (accept(value)) {
            settled = true;
            controller.abort();
            resolve(value);
            return;
          }
          sawValue = true;
          causes.push(`${loader.name}: leer`);
          finish();
        })
        .catch((error: unknown) => {
          if (settled) return;
          const message = error instanceof Error ? error.message : "Fehler";
          causes.push(`${loader.name}: ${message}`);
          finish();
        });
    }
  });
}
