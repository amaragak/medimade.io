export const metadata = {
  title: "Program",
};

export default async function MeditateLibraryProgramPage({
  params,
}: {
  params: Promise<{ programSlug: string }>;
}) {
  // Params validate the route exists; LibraryView in the layout reads the slug
  // from the pathname so the shell stays mounted across list ↔ detail.
  await params;
  return null;
}
