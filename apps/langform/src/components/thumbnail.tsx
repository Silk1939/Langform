"use client";

import Image from "next/image";
import { useState } from "react";
import { thumbnailUrl } from "@/lib/ids";

export function Thumbnail({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div className="aspect-video w-full bg-muted" />;
  }
  return (
    <span className="relative block aspect-video w-full">
      <Image
        src={thumbnailUrl(id)}
        alt=""
        fill
        sizes="(min-width: 1280px) 22rem, (min-width: 640px) 46vw, 100vw"
        className="object-cover"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
