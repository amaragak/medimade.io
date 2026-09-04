import LibraryView from "@/components/library-view";
import { Suspense } from "react";

export const metadata = {
  title: "Programs",
};

export default function MeditateLibraryProgramsPage() {
  return (
    <Suspense fallback={<div className="p-6" />}>
      <LibraryView initialTab="programs" initialItems={null} />
    </Suspense>
  );
}
