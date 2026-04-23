"use client";

import { useSearchParams } from "next/navigation";
import { CreateWorkspace } from "@/components/create-workspace";

export function CreateWorkspaceRoute() {
  const sp = useSearchParams();
  return (
    <CreateWorkspace
      initialDraftSk={sp.get("draftSk")}
      seedJournalContext={sp.get("fromJournal") === "1"}
    />
  );
}
