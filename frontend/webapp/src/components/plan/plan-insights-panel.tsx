"use client";

/**
 * Sticky marginal "Insights" annotation for a life-area detail page.
 * Synthesis is manual-refresh only — never updates on save, blur, or typing.
 */

import { useCallback, useRef, useState } from "react";
import { IconRefresh } from "@tabler/icons-react";
import {
  DEMO_IDEATE_INSIGHTS,
  isDemoIdeateDream,
} from "@/lib/ideate-demo-seed";
import type { DrvTimelineEntry, PlanDream } from "@/lib/plan-dreams";

function entriesFingerprint(entries: DrvTimelineEntry[] | undefined): string {
  return (entries ?? [])
    .map((e) => `${e.id}:${e.text}`)
    .join("|");
}

/** Content that should mark Insights as stale when it changes. */
export function insightsContentFingerprint(dream: PlanDream): string {
  return [
    dream.dreamText,
    dream.obstacleText,
    dream.visionText,
    dream.looseNotes ?? "",
    entriesFingerprint(dream.dreamEntries),
    entriesFingerprint(dream.obstacleEntries),
    entriesFingerprint(dream.visionEntries),
  ].join("\n---\n");
}

function insightsForDream(dream: PlanDream): string[] {
  if (isDemoIdeateDream(dream) && DEMO_IDEATE_INSIGHTS[dream.id]?.length) {
    return DEMO_IDEATE_INSIGHTS[dream.id]!;
  }
  const hasWriting = [dream.dreamText, dream.obstacleText, dream.visionText]
    .some((t) => t.trim().length > 20);
  if (!hasWriting) {
    return [
      "Add a few lines to dream, resistance, or vision — then refresh for a short reflection.",
    ];
  }
  return [
    "Your words are here. Refresh later for a fuller synthesis — for now, notice what repeats across the three sections.",
  ];
}

type Props = {
  dream: PlanDream;
};

export function PlanInsightsPanel({ dream }: Props) {
  const linesRef = useRef(insightsForDream(dream));
  const mockIndexRef = useRef(0);
  const [text, setText] = useState(() => linesRef.current[0]!);
  const [fingerprintAtRefresh, setFingerprintAtRefresh] = useState(() =>
    insightsContentFingerprint(dream),
  );

  const currentFingerprint = insightsContentFingerprint(dream);
  const isStale = currentFingerprint !== fingerprintAtRefresh;

  const refresh = useCallback(() => {
    const lines = insightsForDream(dream);
    linesRef.current = lines;
    mockIndexRef.current = (mockIndexRef.current + 1) % lines.length;
    setText(lines[mockIndexRef.current]!);
    setFingerprintAtRefresh(insightsContentFingerprint(dream));
  }, [dream]);

  return (
    <aside aria-label="Insights" className="select-none">
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 font-display text-xl font-medium text-[#1E2530] dark:text-foreground">
          Insights
          {isStale ? (
            <span
              className="inline-block size-1.5 shrink-0 rounded-full bg-[#B8703A]/70"
              title="Edited since last refresh"
              aria-hidden
            />
          ) : null}
        </h2>
        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh insights"
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border bg-background text-muted transition-colors hover:border-accent/40 hover:text-foreground"
        >
          <IconRefresh className="size-[18px]" stroke={1.75} aria-hidden />
        </button>
      </div>
      {isStale ? (
        <p className="mt-1 text-[10px] leading-snug text-[#B8A98A]/80">
          Edited since last refresh
        </p>
      ) : null}
      <p className="mt-2.5 font-display text-[14px] italic leading-relaxed text-[#8A8272]">
        {text}
      </p>
    </aside>
  );
}
