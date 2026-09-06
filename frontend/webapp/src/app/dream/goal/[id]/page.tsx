"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { PlanGoalWorkspace } from "@/components/plan/plan-goal-workspace";

function IdeateGoalPageInner() {
  const params = useParams();
  const raw = params?.id;
  const id = typeof raw === "string" ? decodeURIComponent(raw) : "";

  if (!id) {
    return (
      <div className="px-4 py-16 text-muted">
        Missing dream link.
      </div>
    );
  }

  return <PlanGoalWorkspace dreamId={id} />;
}

export default function IdeateGoalPage() {
  return (
    <Suspense
      fallback={
        <div className="px-4 py-16 text-sm text-muted">Loading…</div>
      }
    >
      <IdeateGoalPageInner />
    </Suspense>
  );
}
