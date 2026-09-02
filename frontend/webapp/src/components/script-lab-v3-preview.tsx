"use client";

import { useMemo, useState } from "react";
import {
  ScriptLabBeatsPreview,
  type BeatsVerificationView,
} from "@/components/script-lab-beats-preview";
import type { ScriptLabBeat } from "@/lib/script-lab-beats";

export type V3PreviewView = "raw" | "classification" | "substitution" | "verification";

export type ScriptLabV3Match = {
  variantId: string;
  tag: string;
  text: string;
  score: number;
};

export type ScriptLabV3ChunkDecision = {
  chunkIndex: number;
  decision: string;
  variantId?: string;
  tag?: string;
  targetTag?: string;
  score?: number;
  topMatchTag?: string;
  topMatchScore?: number;
  reasoning?: string;
};

export type ScriptLabV3PromotionDetail = {
  targetTag: string;
  reasoning?: string;
  existingVariantTexts: string[];
};

export type ScriptLabV3Meta = {
  pass1RawScript?: string;
  chunks?: Array<{ index: number; text: string; pauseAfter: string | null }>;
  classifications?: Record<number, "personalized" | "generic" | "uncertain">;
  topMatchesByChunk?: Record<number, ScriptLabV3Match[]>;
  decisions?: ScriptLabV3ChunkDecision[];
  promotionDetailByChunk?: Record<number, ScriptLabV3PromotionDetail>;
  beatsAfterSubstitution?: ScriptLabBeat[];
  promotedVariantIds?: string[];
  noMatchCount?: number;
  substitutionCount?: number;
  thresholds?: { substitution: number; promotion: number };
};

export type V3SubstitutionStats = {
  matched: number;
  keptCustom: number;
  promoted: number;
  discarded: number;
};

export function computeV3SubstitutionStats(
  decisions: ScriptLabV3ChunkDecision[],
): V3SubstitutionStats {
  let matched = 0;
  let keptCustom = 0;
  let promoted = 0;
  let discarded = 0;
  for (const d of decisions) {
    switch (d.decision) {
      case "substitute":
        matched += 1;
        break;
      case "promote":
        promoted += 1;
        break;
      case "discard":
        discarded += 1;
        break;
      default:
        keptCustom += 1;
        break;
    }
  }
  return { matched, keptCustom, promoted, discarded };
}

const V3_PREVIEW_OPTIONS: Array<{ id: V3PreviewView; label: string }> = [
  { id: "raw", label: "Raw generation" },
  { id: "classification", label: "After classification" },
  { id: "substitution", label: "After substitution" },
  { id: "verification", label: "After verification" },
];

export function ScriptLabV3PreviewToggle({
  view,
  onChange,
}: {
  view: V3PreviewView;
  onChange: (view: V3PreviewView) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <div className="inline-flex max-w-full flex-wrap rounded-full border border-border bg-background p-0.5 text-xs">
        {V3_PREVIEW_OPTIONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`cursor-pointer rounded-full px-2.5 py-1 font-medium ${
              view === id
                ? "bg-accent-soft text-accent-link"
                : "text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CollapsibleSection({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-lg border border-border/70 bg-background/50"
    >
      <summary className="cursor-pointer px-2.5 py-1.5 text-[11px] font-medium text-muted hover:text-foreground">
        {label}
      </summary>
      <div className="border-t border-border/60 px-2.5 py-2 text-xs">{children}</div>
    </details>
  );
}

function ClassificationChunkRow({
  chunk,
  classification,
}: {
  chunk: { index: number; text: string; pauseAfter: string | null };
  classification: "personalized" | "generic" | "uncertain";
}) {
  const style =
    classification === "personalized"
      ? "border-emerald-500/50 bg-emerald-500/10"
      : classification === "uncertain"
        ? "border-amber-500/50 bg-amber-500/10"
        : "border-stone-400/40 bg-stone-500/5";

  const label =
    classification === "personalized"
      ? "Personalized"
      : classification === "uncertain"
        ? "Uncertain"
        : "Generic";

  return (
    <li className={`rounded-lg border px-3 py-2 ${style}`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-muted">#{chunk.index}</span>
        <span className="rounded-full border border-border/60 bg-background/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
          {label}
        </span>
        {classification === "uncertain" ? (
          <span
            className="text-[10px] font-medium text-amber-800 dark:text-amber-200"
            title="Classifier uncertain — review recommended."
          >
            ⚠ Classifier uncertain — review recommended.
          </span>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{chunk.text}</p>
      {chunk.pauseAfter ? (
        <p className="mt-1 font-mono text-[10px] text-muted">[[PAUSE {chunk.pauseAfter}]]</p>
      ) : null}
    </li>
  );
}

function SubstitutionChunkRow({
  chunk,
  decision,
  classification,
  matches,
  promotionDetail,
  thresholds,
  variantText,
}: {
  chunk: { index: number; text: string; pauseAfter: string | null };
  decision: ScriptLabV3ChunkDecision | undefined;
  classification: "personalized" | "generic" | "uncertain";
  matches: ScriptLabV3Match[];
  promotionDetail?: ScriptLabV3PromotionDetail;
  thresholds: { substitution: number; promotion: number };
  variantText?: string;
}) {
  const dec = decision?.decision ?? "keep_custom";
  const top = matches[0];
  const alts = matches.slice(0, 5);
  const searchTop10 = matches.slice(0, 10);

  if (dec === "substitute") {
    const tag = decision?.tag ?? top?.tag ?? "—";
    const score = decision?.score ?? top?.score;
    const text = variantText ?? top?.text ?? "—";
    return (
      <li className="rounded-lg border border-violet-400/40 bg-violet-500/5 px-3 py-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] text-muted">#{chunk.index}</span>
          <span className="font-mono text-xs font-semibold uppercase text-accent-link">{tag}</span>
          {typeof score === "number" ? (
            <span className="text-[10px] text-muted">Match: {score.toFixed(2)}</span>
          ) : null}
        </div>
        <p className="whitespace-pre-wrap text-xs text-foreground">{text}</p>
        <CollapsibleSection label="Original text">
          <p className="whitespace-pre-wrap text-muted">{chunk.text}</p>
        </CollapsibleSection>
        {alts.length > 0 ? (
          <CollapsibleSection label="Alternatives considered">
            <ol className="space-y-1.5">
              {alts.map((m, i) => (
                <li key={m.variantId} className="text-[11px]">
                  <span className="font-mono text-accent-link">{m.tag}</span>
                  <span className="text-muted"> · {m.score.toFixed(3)}</span>
                  <p className="mt-0.5 line-clamp-2 text-muted">{m.text}</p>
                </li>
              ))}
            </ol>
          </CollapsibleSection>
        ) : null}
        {decision?.reasoning ? (
          <p className="text-[11px] text-muted">Review: {decision.reasoning}</p>
        ) : null}
      </li>
    );
  }

  if (dec === "promote") {
    const targetTag = decision?.targetTag ?? promotionDetail?.targetTag ?? top?.tag ?? "—";
    return (
      <li className="rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] text-muted">#{chunk.index}</span>
          <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:text-amber-100">
            Sent for review → {targetTag}
          </span>
        </div>
        <p className="whitespace-pre-wrap text-xs text-foreground">{chunk.text}</p>
        {promotionDetail?.reasoning ?? decision?.reasoning ? (
          <p className="text-[11px] text-muted">
            {promotionDetail?.reasoning ?? decision?.reasoning}
          </p>
        ) : null}
        {promotionDetail?.existingVariantTexts.length ? (
          <CollapsibleSection label="Existing variants compared on target tag">
            <ul className="list-disc space-y-1 pl-4 text-[11px] text-muted">
              {promotionDetail.existingVariantTexts.map((t, i) => (
                <li key={i} className="whitespace-pre-wrap">
                  {t}
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        ) : null}
        {searchTop10.length > 0 ? (
          <CollapsibleSection label="Top 10 similarity search results (LLM context)">
            <ol className="space-y-1">
              {searchTop10.map((m) => (
                <li key={m.variantId} className="text-[11px]">
                  <span className="font-mono">{m.tag}</span> · {m.score.toFixed(3)}
                </li>
              ))}
            </ol>
          </CollapsibleSection>
        ) : null}
      </li>
    );
  }

  // keep_custom, no_match, personalized, discard, default
  const rejectedTag = decision?.topMatchTag ?? top?.tag;
  const rejectedScore = decision?.topMatchScore ?? top?.score;
  const showRejected =
    dec !== "personalized" &&
    classification !== "personalized" &&
    rejectedTag &&
    typeof rejectedScore === "number";

  return (
    <li className="rounded-lg border border-sky-400/30 bg-sky-500/5 px-3 py-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-muted">#{chunk.index}</span>
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium">
          Custom
        </span>
        {dec === "discard" ? (
          <span className="text-[10px] text-muted">Discarded from library</span>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-xs text-foreground">{chunk.text}</p>
      {showRejected ? (
        <p className="text-[10px] text-muted">
          Best match: {rejectedTag} {rejectedScore.toFixed(2)} — below threshold (
          {thresholds.substitution.toFixed(2)})
        </p>
      ) : null}
      {searchTop10.length > 0 && classification !== "personalized" ? (
        <CollapsibleSection label="Top 10 similarity search results">
          <ol className="space-y-1">
            {searchTop10.map((m) => (
              <li key={m.variantId} className="text-[11px]">
                <span className="font-mono">{m.tag}</span> · {m.score.toFixed(3)}
              </li>
            ))}
          </ol>
        </CollapsibleSection>
      ) : null}
    </li>
  );
}

export function ScriptLabV3PromoteBanner({
  promotedCount,
  onOpenPendingReview,
}: {
  promotedCount: number;
  onOpenPendingReview: () => void;
}) {
  if (promotedCount <= 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
      <span>
        {promotedCount} chunk{promotedCount === 1 ? "" : "s"} sent for review
      </span>
      <button
        type="button"
        onClick={onOpenPendingReview}
        className="cursor-pointer font-semibold text-accent-link underline hover:no-underline"
      >
        Open pending review
      </button>
    </div>
  );
}

export function ScriptLabV3SubstitutionStatsLine({
  stats,
}: {
  stats: V3SubstitutionStats;
}) {
  return (
    <p className="mt-1 text-[11px] text-muted">
      Substitution:{" "}
      <span className="font-medium text-foreground">{stats.matched} matched</span>
      {" · "}
      {stats.keptCustom} kept custom
      {" · "}
      {stats.promoted} promoted for review
      {" · "}
      {stats.discarded} discarded
    </p>
  );
}

export function ScriptLabV3PreviewContent({
  view,
  v3Meta,
  verificationBeats,
  tagRepeatabilityByName,
  correctedBeatIndices,
}: {
  view: V3PreviewView;
  v3Meta: ScriptLabV3Meta;
  verificationBeats: ScriptLabBeat[];
  tagRepeatabilityByName?: Record<string, import("@/lib/script-segment-tags").ScriptSegmentRepeatability>;
  correctedBeatIndices?: Set<number>;
}) {
  const chunks = v3Meta.chunks ?? [];
  const classifications = v3Meta.classifications ?? {};
  const decisions = v3Meta.decisions ?? [];
  const topMatches = v3Meta.topMatchesByChunk ?? {};
  const promotionDetailByChunk = v3Meta.promotionDetailByChunk ?? {};
  const thresholds = v3Meta.thresholds ?? { substitution: 0.9, promotion: 0.7 };
  const beatsAfterSubstitution = v3Meta.beatsAfterSubstitution ?? verificationBeats;

  const decisionByIndex = useMemo(
    () => new Map(decisions.map((d) => [d.chunkIndex, d])),
    [decisions],
  );

  const variantTextByChunk = useMemo(() => {
    const out = new Map<number, string>();
    for (const d of decisions) {
      if (d.decision !== "substitute" || !d.variantId) continue;
      const m = (topMatches[d.chunkIndex] ?? []).find((x) => x.variantId === d.variantId);
      if (m?.text) out.set(d.chunkIndex, m.text);
    }
    return out;
  }, [decisions, topMatches]);

  if (view === "raw") {
    const raw = v3Meta.pass1RawScript?.trim();
    return raw ? (
      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{raw}</pre>
    ) : (
      <p className="text-muted">No raw script captured.</p>
    );
  }

  if (view === "classification") {
    return (
      <ol className="space-y-2">
        {chunks.map((chunk) => (
          <ClassificationChunkRow
            key={chunk.index}
            chunk={chunk}
            classification={classifications[chunk.index] ?? "generic"}
          />
        ))}
      </ol>
    );
  }

  if (view === "substitution") {
    return (
      <ol className="space-y-3">
        {chunks.map((chunk) => (
          <SubstitutionChunkRow
            key={chunk.index}
            chunk={chunk}
            decision={decisionByIndex.get(chunk.index)}
            classification={classifications[chunk.index] ?? "generic"}
            matches={topMatches[chunk.index] ?? []}
            promotionDetail={promotionDetailByChunk[chunk.index]}
            thresholds={thresholds}
            variantText={variantTextByChunk.get(chunk.index)}
          />
        ))}
      </ol>
    );
  }

  return (
    <ScriptLabBeatsPreview
      beats={verificationBeats}
      tagRepeatabilityByName={tagRepeatabilityByName}
      correctedBeatIndices={correctedBeatIndices}
    />
  );
}

/** Map V3 stats label for duration line when viewing substitution-assembled beats. */
export function v3StatsViewLabel(view: V3PreviewView): string | null {
  switch (view) {
    case "raw":
      return "Raw generation";
    case "classification":
      return "After classification";
    case "substitution":
      return "After substitution";
    case "verification":
      return "After verification";
    default:
      return null;
  }
}

/** Re-export for V1/V2 — unchanged. */
export type { BeatsVerificationView };
