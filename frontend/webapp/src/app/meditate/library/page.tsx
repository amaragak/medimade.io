import LibraryView from "@/components/library-view";
import { Suspense } from "react";

export const metadata = {
  title: "Library",
};

export default async function MeditateLibraryPage() {
  const initialItems = null as null | unknown[];
  return (
    <Suspense fallback={<div className="p-6" />}>
      <LibraryView initialItems={initialItems as any} />
    </Suspense>
  );
}

