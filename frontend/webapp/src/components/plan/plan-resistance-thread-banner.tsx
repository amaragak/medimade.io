"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { writePlanCreateHandoff } from "@/lib/plan-create-handoff";
import type { ResistanceTheme } from "@/lib/plan-resistance-threads";

type Props = {
  theme: ResistanceTheme;
  projectId?: string;
  projectTitle?: string;
};

export function PlanResistanceThreadBanner({
  theme,
  projectId,
  projectTitle,
}: Props) {
  const router = useRouter();

  function sitWithIt() {
    writePlanCreateHandoff({
      v: 2,
      goalTitle: projectTitle?.trim() || "Something I'm sitting with",
      visionText: theme.sampleText || `Sitting with: ${theme.label}`,
      obstacleText: theme.sampleText || `A recurring feeling: ${theme.label}`,
      project: {
        dreamText: "",
        resistanceText: theme.sampleText || theme.label,
        visionText: "",
      },
      activeResistanceThemes: [
        {
          category: theme.category,
          sampleText: theme.sampleText,
          level: theme.level,
          occurrences: theme.occurrences,
        },
      ],
    });
    router.push("/meditate/create/from-chat?fromDream=1");
  }

  return (
    <div className="rounded-2xl border border-accent/20 bg-accent-soft/12 px-5 py-4">
      <p className="font-hand text-base italic leading-relaxed text-foreground/90">
        This feeling — {theme.label} — keeps showing up. Want to sit with that in
        today&apos;s meditation?
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => sitWithIt()}
          className="cursor-pointer rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:border-accent/40"
        >
          Open in create
        </button>
        {projectId ? (
          <Link
            href={`/dream/goal/${encodeURIComponent(projectId)}`}
            className="rounded-full px-4 py-2 text-sm text-muted hover:text-foreground"
          >
            View project
          </Link>
        ) : null}
      </div>
    </div>
  );
}
