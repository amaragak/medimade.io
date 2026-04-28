"use client";

import { useParams } from "next/navigation";
import { PlanGoalWorkspace } from "@/components/plan/plan-goal-workspace";

export default function PlanGoalPage() {
  const params = useParams();
  const raw = params?.id;
  const id = typeof raw === "string" ? decodeURIComponent(raw) : "";

  if (!id) {
    return (
      <div className="mesh-hero px-4 py-16 text-muted">
        Missing dream link.
      </div>
    );
  }

  return <PlanGoalWorkspace dreamId={id} />;
}
