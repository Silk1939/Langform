import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WatchView } from "@/components/watch-view";
import { VIDEO_ID } from "@/lib/ids";

export const metadata: Metadata = {
  title: "Ansehen",
};

export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!VIDEO_ID.test(id)) notFound();
  return <WatchView key={id} id={id} />;
}
