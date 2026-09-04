import { Suspense, type ReactNode } from "react";
import LibraryView from "@/components/library-view";

/**
 * Keep a single LibraryView mounted across creations / programs / community and
 * program detail URLs so list ↔ detail navigation does not remount and flash
 * empty / Loading states.
 */
export default function MeditateLibraryLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <Suspense fallback={null}>
        <LibraryView />
      </Suspense>
      {children}
    </>
  );
}
