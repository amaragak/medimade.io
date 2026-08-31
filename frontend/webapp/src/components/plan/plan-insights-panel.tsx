"use client";

/**
 * Sticky marginal "Insights" annotation for a life-area detail page.
 * Synthesis is manual-refresh only — never updates on save, blur, or typing.
 */

import { useCallback, useRef, useState } from "react";
import { IconRefresh } from "@tabler/icons-react";
import type { DrvTimelineEntry, PlanDream } from "@/lib/plan-dreams";

/**
 * PROTOTYPE MOCK — short cross-section observations.
 * Replace with real generation that reads main answers, running thoughts,
 * and recurring resistance. Keep 1–2 lines; never auto-regenerate.
 */
const MOCK_SYNTHESIS = [
  "The dream keeps circling quieter mornings, while resistance names the phone-first habit — and the vision lands on stillness before the day begins.",
  "Across dream, resistance, and vision there's the same pull: reclaim the start of the day without fixing everything else first.",
  "What repeats isn't the goal itself — it's protecting a small morning window from the noise that rushes in.",
];

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

type Props = {
  dream: PlanDream;
};

export function PlanInsightsPanel({ dream }: Props) {
  const mockIndexRef = useRef(0);
  const [text, setText] = useState(MOCK_SYNTHESIS[0]!);
  const [fingerprintAtRefresh, setFingerprintAtRefresh] = useState(() =>
    insightsContentFingerprint(dream),
  );

  const currentFingerprint = insightsContentFingerprint(dream);
  const isStale = currentFingerprint !== fingerprintAtRefresh;

  const refresh = useCallback(() => {
    // Manual only — bump mock index so refresh is visibly intentional.
    mockIndexRef.current =
      (mockIndexRef.current + 1) % MOCK_SYNTHESIS.length;
    setText(MOCK_SYNTHESIS[mockIndexRef.current]!);
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
