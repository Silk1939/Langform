import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedSkeleton } from "@/components/feed";
import { SearchView } from "@/components/search-view";

export const metadata: Metadata = {
  title: "Suche",
};

export default function SearchPage() {
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <SearchView />
    </Suspense>
  );
}
