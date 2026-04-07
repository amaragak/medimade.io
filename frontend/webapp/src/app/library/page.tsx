import LibraryView from "@/components/library-view";
import { Suspense } from "react";

export const metadata = {
  title: "Library",
};

export default async function LibraryPage() {
  const base = process.env.NEXT_PUBLIC_MEDIMADE_API_URL?.trim() || "";
  let initialItems = null as null | unknown[];
  if (base) {
    try {
      const res = await fetch(`${base}/library/meditations`, { cache: "no-store" });
      const data = (await res.json()) as { items?: unknown[] };
      if (res.ok && Array.isArray(data.items)) {
        initialItems = data.items;
      }
    } catch {
      // If SSR fetch fails, the client will load as usual.
    }
  }
  return (
    <Suspense fallback={<div className="p-6" />}>
      <LibraryView initialItems={initialItems as any} />
    </Suspense>
  );
}
