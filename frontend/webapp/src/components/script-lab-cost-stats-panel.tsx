"use client";

import type { ScriptLabCostSummary } from "@/lib/script-lab-cost";
import {
  formatGbp,
  formatTokenUsage,
  formatUsd,
  SCRIPT_CHARS_PER_TOKEN_ESTIMATE,
} from "@/lib/script-lab-cost";

function formatDelta(deltaUsd: number, deltaPct: number): string {
  const cheaper = deltaUsd < 0;
  const absUsd = Math.abs(deltaUsd);
  const absPct = Math.abs(deltaPct);
  if (cheaper) {
    return `${formatUsd(absUsd)} / ${absPct.toFixed(0)}% cheaper than single-shot`;
  }
  if (deltaUsd > 0) {
    return `${formatUsd(absUsd)} / ${absPct.toFixed(0)}% more expensive than single-shot`;
  }
  return "same as single-shot";
}

export function ScriptLabCostStatsPanel({
  summary,
  compact = false,
}: {
  summary: ScriptLabCostSummary | null;
  compact?: boolean;
}) {
  if (!summary) return null;

  if (compact) {
    const sim = summary.simulatedBaseline;
    return (
      <p className="text-xs text-muted">
        Optimised LLM: {formatTokenUsage(summary.totalUsage)} — Sonnet{" "}
        {formatUsd(summary.totalSonnetUsd)}
        {sim ? (
          <>
            {" "}
            · Simulated single-shot: {formatTokenUsage(sim.usage)} — Sonnet{" "}
            {formatUsd(sim.sonnet.usd)}
            {summary.sonnetDeltaUsd != null && summary.sonnetDeltaPct != null
              ? ` (${formatDelta(summary.sonnetDeltaUsd, summary.sonnetDeltaPct)})`
              : null}
          </>
        ) : null}{" "}
        · Est. Fish TTS (all text) {formatUsd(summary.fishAllUsd)} (
        {summary.fishAllChars.toLocaleString()} chars)
      </p>
    );
  }

  const sim = summary.simulatedBaseline;

  return (
    <div className="mt-2 space-y-1 rounded-lg border border-border bg-background/60 px-3 py-2 text-xs text-muted">
      <p className="font-medium text-foreground">LLM usage &amp; cost</p>
      {summary.stages.map((stage) => (
        <p key={stage.stage.id}>
          <span className="font-medium text-foreground">{stage.stage.label}:</span>{" "}
          {formatTokenUsage(stage.stage.usage)} — Sonnet {formatUsd(stage.sonnet.usd)} /{" "}
          {formatGbp(stage.sonnet.gbp)} · Haiku {formatUsd(stage.haiku.usd)} /{" "}
          {formatGbp(stage.haiku.gbp)}
        </p>
      ))}
      <p>
        <span className="font-medium text-foreground">Optimised LLM total:</span>{" "}
        {formatTokenUsage(summary.totalUsage)} — Sonnet {formatUsd(summary.totalSonnetUsd)} /{" "}
        {formatGbp(summary.totalSonnetGbp)} · Haiku {formatUsd(summary.totalHaikuUsd)} /{" "}
        {formatGbp(summary.totalHaikuGbp)}
      </p>
      {sim ? (
        <>
          <p>
            <span className="font-medium text-foreground">Simulated single-shot LLM:</span>{" "}
            {formatTokenUsage(sim.usage)} — Sonnet {formatUsd(sim.sonnet.usd)} /{" "}
            {formatGbp(sim.sonnet.gbp)} · Haiku {formatUsd(sim.haiku.usd)} /{" "}
            {formatGbp(sim.haiku.gbp)}
          </p>
          <p className="text-[11px]">
            First-pass input ({sim.firstPassInputTokens.toLocaleString()} tok) + output estimated
            from final script ({sim.estimatedOutputTokens.toLocaleString()} tok ≈{" "}
            {Math.round(
              sim.estimatedOutputTokens * SCRIPT_CHARS_PER_TOKEN_ESTIMATE,
            ).toLocaleString()}{" "}
            chars ÷ {SCRIPT_CHARS_PER_TOKEN_ESTIMATE})
            {summary.sonnetDeltaUsd != null && summary.sonnetDeltaPct != null ? (
              <>
                {" "}
                —{" "}
                <span className="font-medium text-foreground">
                  {formatDelta(summary.sonnetDeltaUsd, summary.sonnetDeltaPct)}
                </span>
              </>
            ) : null}
          </p>
        </>
      ) : null}
      <p>
        <span className="font-medium text-foreground">Est. Fish TTS</span> (all text):{" "}
        {summary.fishAllChars.toLocaleString()} chars — {formatUsd(summary.fishAllUsd)} /{" "}
        {formatGbp(summary.fishAllGbp)}
        {summary.fishAllChars > 0 ? (
          <>
            {" "}
            · custom {summary.fishCustomChars.toLocaleString()} ({formatUsd(summary.fishCustomUsd)}) ·
            segments {summary.fishSegmentChars.toLocaleString()} ({formatUsd(summary.fishSegmentUsd)})
          </>
        ) : null}
      </p>
      {summary.fishSegmentChars > 0 ? (
        <p>
          <span className="font-medium text-foreground">Est. cache saving</span> (segment text):{" "}
          {summary.fishSegmentChars.toLocaleString()} chars — {formatUsd(summary.fishSegmentUsd)} /{" "}
          {formatGbp(summary.fishSegmentGbp)}
        </p>
      ) : null}
    </div>
  );
}
