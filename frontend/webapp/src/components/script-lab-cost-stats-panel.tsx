"use client";

import type { ScriptLabCostSummary } from "@/lib/script-lab-cost";
import {
  costLineForBreakdownEntry,
  formatGbp,
  formatTokenUsage,
  formatUsd,
  SCRIPT_CHARS_PER_TOKEN_ESTIMATE,
  scriptLabStageDisplayLabel,
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

function formatPriced(
  usd: number,
  gbp: number,
  modelLabel: string,
): string {
  return `${modelLabel} ${formatUsd(usd)} / ${formatGbp(gbp)}`;
}

export function ScriptLabCostStatsPanel({
  summary,
  compact = false,
}: {
  summary: ScriptLabCostSummary | null;
  compact?: boolean;
}) {
  if (!summary) return null;

  const actualLabel = summary.totalActual.modelLabel;

  if (compact) {
    const sim = summary.simulatedBaseline;
    return (
      <p className="text-xs text-muted">
        Optimised LLM: {formatTokenUsage(summary.totalUsage)} — {actualLabel}{" "}
        {formatUsd(summary.totalActualUsd)}
        {sim ? (
          <>
            {" "}
            · Simulated single-shot: {formatTokenUsage(sim.usage)} —{" "}
            {sim.sonnet.modelLabel} {formatUsd(sim.sonnet.usd)}
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
      {summary.usageBreakdown.length > 0 ? (
        <div className="space-y-0.5">
          {summary.usageBreakdown.map((entry, i) => {
            const line = costLineForBreakdownEntry(entry);
            return (
              <p key={`${entry.stage}-${entry.model}-${i}`}>
                <span className="font-medium text-foreground">
                  {scriptLabStageDisplayLabel(entry.stage)}:
                </span>{" "}
                {formatTokenUsage(entry.usage)} —{" "}
                {formatPriced(line.usd, line.gbp, line.modelLabel)}
              </p>
            );
          })}
        </div>
      ) : (
        summary.stages.map((stage) => (
          <p key={stage.stage.id}>
            <span className="font-medium text-foreground">{stage.stage.label}:</span>{" "}
            {formatTokenUsage(stage.stage.usage)}
            {stage.stage.actual ? (
              <>
                {" "}
                —{" "}
                {formatPriced(
                  stage.stage.actual.usd,
                  stage.stage.actual.gbp,
                  stage.stage.actual.modelLabel,
                )}
              </>
            ) : (
              <>
                {" "}
                — {formatPriced(stage.sonnet.usd, stage.sonnet.gbp, stage.sonnet.modelLabel)}
              </>
            )}
          </p>
        ))
      )}
      <p>
        <span className="font-medium text-foreground">Optimised LLM total:</span>{" "}
        {formatTokenUsage(summary.totalUsage)} —{" "}
        {formatPriced(
          summary.totalActualUsd,
          summary.totalActualGbp,
          actualLabel,
        )}
      </p>
      {sim ? (
        <>
          <p>
            <span className="font-medium text-foreground">Simulated single-shot LLM:</span>{" "}
            {formatTokenUsage(sim.usage)} —{" "}
            {formatPriced(sim.sonnet.usd, sim.sonnet.gbp, sim.sonnet.modelLabel)}
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
