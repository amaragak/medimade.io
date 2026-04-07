import { Suspense } from "react";
import { CreateWorkspaceRoute } from "./create-workspace-route";

export const metadata = {
  title: "Create",
};

export default function CreatePage() {
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
    </div>
  );
}
