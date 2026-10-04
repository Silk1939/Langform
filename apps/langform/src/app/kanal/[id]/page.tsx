import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChannelView } from "@/components/channel-view";
import { CHANNEL_ID } from "@/lib/ids";

export const metadata: Metadata = {
  title: "Kanal",
};

export default async function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!CHANNEL_ID.test(id)) notFound();
  return <ChannelView key={id} id={id} />;
}
