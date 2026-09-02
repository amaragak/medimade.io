"use client";

import { useMemo, useState } from "react";
import {
  duplicateBeatTypeIndexSet,
  type ScriptLabBeat,
} from "@/lib/script-lab-beats";

const TEXT_PREVIEW_CHARS = 160;

type BeatSource = "segment" | "custom" | "pause";

function beatSource(beat: ScriptLabBeat): BeatSource {
  if (beat.beatType === "pause") return "pause";
  return beat.custom ? "custom" : "segment";
}

const SOURCE_BADGE: Record<
  BeatSource,
  { label: string; className: string }
> = {
  segment: {
    label: "Segment",
    className:
      "border-violet-400/50 bg-violet-500/10 text-violet-800 dark:text-violet-200",
  },
  custom: {
    label: "Custom",
    className:
      "border-sky-400/50 bg-sky-500/10 text-sky-800 dark:text-sky-200",
  },
  pause: {
    label: "Pause",
    className:
      "border-stone-400/50 bg-stone-500/10 text-stone-700 dark:text-stone-300",
  },
};

function BeatContentPreview({ beat }: { beat: ScriptLabBeat }) {
  const [expanded, setExpanded] = useState(false);
  const source = beatSource(beat);

  if (source === "pause") {
    return (
      <span className="font-mono text-xs text-muted">
        pauseBand: <span className="text-foreground">{beat.pauseBand ?? "—"}</span>
      </span>
    );
  }

  if (source === "segment") {
    return (
      <span className="font-mono text-xs font-semibold uppercase tracking-wide text-accent-link">
        {beat.tag ?? "—"}
      </span>
    );
  }

  const text = beat.text ?? "";
  if (!text) return <span className="text-xs text-muted">—</span>;

  const needsTruncate = text.length > TEXT_PREVIEW_CHARS;
  const shown =
    expanded || !needsTruncate
      ? text
      : `${text.slice(0, TEXT_PREVIEW_CHARS).trim()}…`;

  return (
    <div className="min-w-0">
      <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{shown}</p>
      {needsTruncate ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 cursor-pointer text-[11px] font-medium text-accent-link hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

function rowClassName(isDuplicate: boolean, isCorrected: boolean): string {
  if (isDuplicate) {
    return "border-amber-500/60 bg-amber-500/10";
  }
  if (isCorrected) {
    return "border-emerald-500/60 bg-emerald-500/10";
  }
  return "border-border/80 bg-background";
}

export function ScriptLabBeatsPreview({
  beats,
  correctedBeatIndices,
}: {
  beats: ScriptLabBeat[];
  correctedBeatIndices?: Set<number>;
}) {
  const duplicateIndices = useMemo(() => duplicateBeatTypeIndexSet(beats), [beats]);

  return (
    <ol className="space-y-2">
      {beats.map((beat, index) => {
        const source = beatSource(beat);
        const badge = SOURCE_BADGE[source];
        const isDuplicate = duplicateIndices.has(index);
        const isCorrected = correctedBeatIndices?.has(index) ?? false;

        return (
          <li
            key={`beat-${index}`}
            className={`flex gap-3 rounded-lg border px-3 py-2 ${rowClassName(isDuplicate, isCorrected)}`}
          >
            <span className="w-5 shrink-0 pt-0.5 text-right text-[11px] tabular-nums text-muted">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex rounded-full border border-border bg-muted/30 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground">
                  {beat.beatType}
                </span>
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.className}`}
                >
                  {badge.label}
                </span>
                {isDuplicate ? (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    Duplicate
                  </span>
                ) : null}
                {isCorrected ? (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                    Corrected
                  </span>
                ) : null}
              </div>
              <BeatContentPreview beat={beat} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export type BeatsVerificationView = "after" | "before";

export function ScriptLabBeatsVerificationToggle({
  view,
  onChange,
  correctionsApplied,
}: {
  view: BeatsVerificationView;
  onChange: (view: BeatsVerificationView) => void;
  correctionsApplied: boolean;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-full border border-border bg-background p-0.5 text-xs">
        {(
          [
            { id: "after" as const, label: "After verification" },
            { id: "before" as const, label: "Before verification" },
          ] as const
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`cursor-pointer rounded-full px-3 py-1 font-medium ${
              view === id
                ? "bg-accent-soft text-accent-link"
                : "text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {correctionsApplied ? (
        <span className="text-[11px] text-muted">
          Green rows = beats added by verification (split or conversion)
        </span>
      ) : null}
    </div>
  );
}
