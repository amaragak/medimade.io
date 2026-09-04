import LibraryView from "@/components/library-view";
import { Suspense } from "react";

export const metadata = {
  title: "Program",
};

export default async function MeditateLibraryProgramPage({
  params,
}: {
  params: Promise<{ programSlug: string }>;
}) {
  const { programSlug } = await params;
  const slug = decodeURIComponent(programSlug || "").trim();

  return (
    <Suspense fallback={<div className="p-6" />}>
      <LibraryView
        initialTab="programs"
        initialProgramSlug={slug || null}
        initialItems={null}
      />
    </Suspense>
  );
}
