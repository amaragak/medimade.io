import { notFound } from "next/navigation";

export const metadata = {
  title: "Library",
};

const LIBRARY_TABS = ["creations", "programs", "community"] as const;
export type LibraryPathTab = (typeof LIBRARY_TABS)[number];

function isLibraryPathTab(v: string): v is LibraryPathTab {
  return (LIBRARY_TABS as readonly string[]).includes(v);
}

export default async function MeditateLibraryTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  if (!isLibraryPathTab(tab)) notFound();
  return null;
}
