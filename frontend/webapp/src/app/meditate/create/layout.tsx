import type { ReactNode } from "react";
import { Suspense } from "react";
import { CreateWorkspaceRoute } from "@/app/create/create-workspace-route";

export const metadata = {
  title: "Meditate",
};

export default function MeditateCreateLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted">
            Loading…
          </div>
        }
      >
        <CreateWorkspaceRoute />
      </Suspense>
      {children}
    </div>
  );
}
