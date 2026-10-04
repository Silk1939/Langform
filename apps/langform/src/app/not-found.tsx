import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 py-10">
      <h1 className="font-heading text-4xl">Diese Seite gibt es nicht</h1>
      <p className="leading-relaxed text-muted-foreground">
        Der Link führt weder zu einem langen Video noch zu einem Kanal.
      </p>
      <Button render={<Link href="/" />} className="w-fit">
        Zur Übersicht
      </Button>
    </div>
  );
}
