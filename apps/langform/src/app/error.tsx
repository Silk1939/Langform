"use client";

import { Button } from "@/components/ui/button";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 py-10">
      <p className="text-xs tracking-[0.22em] text-primary uppercase">Unterbrechung</p>
      <h1 className="font-heading text-4xl">Die Liste ist gerade nicht zu erreichen</h1>
      <p className="leading-relaxed text-muted-foreground">
        Die öffentlichen Quellen antworten nicht. Es wird nichts gespeichert und kein Konto verlangt.
      </p>
      <Button type="button" onClick={() => reset()} className="h-11 w-fit px-4">
        Erneut laden
      </Button>
    </div>
  );
}
