"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getMedimadeApiBase,
  getMedimadeSessionJwt,
  medimadeApiAuthHeaders,
} from "@/lib/medimade-api";
import {
  type EnrichedMeditationAnalytics,
  type MeditationAnalyticsRow,
  FISH_USD_PER_UTF8_BYTE,
  buildScriptDurationPlanningBlurb,
  computeVoiceStemDurationInsights,
  enrichMeditationAnalytics,
  fishCostUsdFromBillableBytes,
  spokenWordBudgetForStemSeconds,
} from "@/lib/meditation-analytics";
import { speakerNameForModelId } from "@/lib/fish-speakers";
import {
  CLAUDE_HAIKU_45_USD_PER_INPUT_TOKEN,
  CLAUDE_HAIKU_45_USD_PER_OUTPUT_TOKEN,
} from "@/lib/claude-pricing";

function linearRegression(points: Array<{ x: number; y: number }>): {
  m: number;
  b: number;
} {
  const n = points.length;
  if (n < 2) return { m: 0, b: 0 };
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXX += p.x * p.x;
    sumXY += p.x * p.y;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { m: 0, b: sumY / n };
  const m = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - m * sumX) / n;
  return { m, b };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function median(nums: number[]): number | null {
  const a = nums.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

function speakerColor(ref: string): string {
  let h = 0;
  for (let i = 0; i < ref.length; i += 1) h = (h * 31 + ref.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 55% 52%)`;
}

function buildScatterSvg(params: {
  points: Array<{ x: number; y: number; ref: string; title?: string }>;
  xLabel: string;
  yLabel: string;
  w?: number;
  h?: number;
}): {
  w: number;
  h: number;
  pad: number;
  dots: Array<{
    cx: number;
    cy: number;
    x: number;
    y: number;
    fill: string;
    title: string;
  }>;
  line: { x1: number; y1: number; x2: number; y2: number } | null;
  m: number;
  b: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
} {
  const w = params.w ?? 900;
  const h = params.h ?? 420;
  const pad = 44;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  if (params.points.length === 0) {
    return {
      w,
      h,
      pad,
      dots: [],
      line: null,
      m: 0,
      b: 0,
      x0: 0,
      x1: 1,
      y0: 0,
      y1: 1,
    };
  }

  const { m, b } = linearRegression(params.points);
  const xs = params.points.map((p) => p.x);
  const ys = params.points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const x0 = minX === maxX ? minX - 1 : minX;
  const x1 = minX === maxX ? maxX + 1 : maxX;
  const y0 = minY === maxY ? minY - 1 : minY;
  const y1 = minY === maxY ? maxY + 1 : maxY;

  const sx = (x: number) => pad + ((x - x0) / (x1 - x0)) * innerW;
  const sy = (y: number) => pad + (1 - (y - y0) / (y1 - y0)) * innerH;

  const dots = params.points.map((p) => ({
    cx: sx(p.x),
    cy: sy(p.y),
    x: p.x,
    y: p.y,
    fill: speakerColor(p.ref),
    title: `${p.title ?? "Meditation"}\n${params.yLabel.replace(/\n/g, " ")}: ${p.y.toFixed(2)}\n${params.xLabel.replace(/\n/g, " ")}: ${p.x.toFixed(3)}`,
  }));

  const fitX1 = x0;
  const fitY1 = m * fitX1 + b;
  const fitX2 = x1;
  const fitY2 = m * fitX2 + b;

  const line = {
    x1: sx(fitX1),
    y1: sy(clamp(fitY1, y0, y1)),
    x2: sx(fitX2),
    y2: sy(clamp(fitY2, y0, y1)),
  };

  return {
    w,
    h,
    pad,
    dots,
    line,
    m,
    b,
    x0,
    x1,
    y0,
    y1,
  };
}

export default function AnalyticsPage() {
  const [items, setItems] = useState<MeditationAnalyticsRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [planningBlurbCopied, setPlanningBlurbCopied] = useState(false);

  useEffect(() => {
    const base = getMedimadeApiBase();
    if (!base) {
      setError("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
      return;
    }
    if (!getMedimadeSessionJwt()) {
      setError("Sign in to load analytics for your account.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`${base}/analytics/meditations?limit=800`, { headers: medimadeApiAuthHeaders() })
      .then(async (r) => {
        const j = (await r.json()) as {
          items?: MeditationAnalyticsRow[];
          error?: string;
          detail?: string;
        };
        if (!r.ok) throw new Error(j.detail ?? j.error ?? r.statusText);
        return j.items ?? [];
      })
      .then((it) => {
        if (cancelled) return;
        setItems(it);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load analytics");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enriched = useMemo(() => {
    const out: EnrichedMeditationAnalytics[] = [];
    for (const it of items) {
      const e = enrichMeditationAnalytics(it);
      if (e) out.push(e);
    }
    return out;
  }, [items]);

  const approxCount = useMemo(
    () => enriched.filter((e) => e.statsApproximate).length,
    [enriched],
  );

  const costTotals = useMemo(() => {
    if (enriched.length === 0) return null;
    const totalCost = enriched.reduce((a, e) => a + e.fishCostUsd, 0);
    const totalBytes = enriched.reduce((a, e) => a + e.billableUtf8Bytes, 0);
    const totalVoiceMin = enriched.reduce(
      (a, e) => a + (e.voiceStemSeconds ?? 0) / 60,
      0,
    );
    const avgCostPerGen = totalCost / enriched.length;
    const avgCostPerVoiceMinute =
      totalVoiceMin > 0 ? totalCost / totalVoiceMin : null;
    /** Voice-stem minutes per day for projection (Fish-only). */
    const projectionSessionVoiceMinutesPerDay = 10;
    /** Calendar month length for headline projection. */
    const projectionDaysPerMonth = 30;
    const monthlyProjectedFishUsd =
      avgCostPerVoiceMinute != null && Number.isFinite(avgCostPerVoiceMinute)
        ? avgCostPerVoiceMinute *
          projectionSessionVoiceMinutesPerDay *
          projectionDaysPerMonth
        : null;

    const totalClaudeWorkerUsd = enriched.reduce((a, e) => a + e.claudeWorkerUsd, 0);
    const totalClaudeChatEstUsd = enriched.reduce((a, e) => a + e.claudeChatEstUsd, 0);
    const totalClaudeCombinedUsd = enriched.reduce((a, e) => a + e.claudeCombinedUsd, 0);
    const rowsWithChatEst = enriched.filter((e) => e.claudeHasChatEstimate).length;
    const avgClaudeCombinedPerGen = totalClaudeCombinedUsd / enriched.length;
    /** One new meditation (same cost mix as fleet) every day — Fish + Claude (see methodology). */
    const monthlyProjectedOneCreatePerDayUsd =
      (avgCostPerGen + avgClaudeCombinedPerGen) * projectionDaysPerMonth;

    const speechSpeeds = enriched
      .map((e) => e.raw.speechSpeed)
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    const avgSpeechSpeed =
      speechSpeeds.length > 0
        ? speechSpeeds.reduce((a, b) => a + b, 0) / speechSpeeds.length
        : null;

    /** Seconds of explicit `[[PAUSE …]]` per minute of voice-stem audio (same clock as Fish cost). */
    const pauseSecondsPerVoiceStemMinute = enriched
      .map((e) => {
        const vs = e.voiceStemSeconds;
        if (vs == null || vs <= 0) return null;
        return (e.pauseSecondsTotal / vs) * 60;
      })
      .filter((x): x is number => x != null && Number.isFinite(x));
    const avgPauseSecondsPerVoiceStemMinute =
      pauseSecondsPerVoiceStemMinute.length > 0
        ? pauseSecondsPerVoiceStemMinute.reduce((a, b) => a + b, 0) /
          pauseSecondsPerVoiceStemMinute.length
        : null;

    return {
      totalCost,
      totalBytes,
      totalVoiceMin,
      avgCostPerGen,
      avgCostPerVoiceMinute,
      monthlyProjectedFishUsd,
      projectionSessionVoiceMinutesPerDay,
      projectionDaysPerMonth,
      n: enriched.length,
      totalClaudeWorkerUsd,
      totalClaudeChatEstUsd,
      totalClaudeCombinedUsd,
      avgClaudeCombinedPerGen,
      rowsWithChatEst,
      monthlyProjectedOneCreatePerDayUsd,
      avgSpeechSpeed,
      speechSpeedRowCount: speechSpeeds.length,
      avgPauseSecondsPerVoiceStemMinute,
    };
  }, [enriched]);

  const bySpeaker = useMemo(() => {
    type Agg = {
      count: number;
      totalBytes: number;
      totalCost: number;
      totalVoiceMin: number;
    };
    const map = new Map<string, Agg>();
    for (const e of enriched) {
      const ref = (e.raw.referenceId as string | undefined)?.trim() || "(unknown)";
      const cur = map.get(ref) ?? {
        count: 0,
        totalBytes: 0,
        totalCost: 0,
        totalVoiceMin: 0,
      };
      cur.count += 1;
      cur.totalBytes += e.billableUtf8Bytes;
      cur.totalCost += e.fishCostUsd;
      cur.totalVoiceMin += (e.voiceStemSeconds ?? 0) / 60;
      map.set(ref, cur);
    }
    return [...map.entries()].sort((a, b) => {
      const nameA = speakerNameForModelId(a[0]) ?? a[0];
      const nameB = speakerNameForModelId(b[0]) ?? b[0];
      return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
    });
  }, [enriched]);

  const bySpeed = useMemo(() => {
    type Agg = {
      count: number;
      totalBytes: number;
      totalCost: number;
      totalVoiceMin: number;
    };
    const map = new Map<string, Agg>();
    for (const e of enriched) {
      const sp =
        typeof e.raw.speechSpeed === "number" && Number.isFinite(e.raw.speechSpeed)
          ? String(e.raw.speechSpeed)
          : "?";
      const cur = map.get(sp) ?? {
        count: 0,
        totalBytes: 0,
        totalCost: 0,
        totalVoiceMin: 0,
      };
      cur.count += 1;
      cur.totalBytes += e.billableUtf8Bytes;
      cur.totalCost += e.fishCostUsd;
      cur.totalVoiceMin += (e.voiceStemSeconds ?? 0) / 60;
      map.set(sp, cur);
    }
    return [...map.entries()].sort((a, b) => {
      const unk = (k: string) => k === "?";
      if (unk(a[0]) && !unk(b[0])) return 1;
      if (!unk(a[0]) && unk(b[0])) return -1;
      if (unk(a[0]) && unk(b[0])) return 0;
      return parseFloat(a[0]) - parseFloat(b[0]);
    });
  }, [enriched]);

  const densityStats = useMemo(() => {
    const wpm = enriched
      .map((e) => e.wordsPerActiveSpeechMinute)
      .filter((x): x is number => x != null && Number.isFinite(x));
    const bpm = enriched
      .map((e) => e.bytesPerActiveSpeechMinute)
      .filter((x): x is number => x != null && Number.isFinite(x));
    return {
      medianWpm: median(wpm),
      medianUtf8BytesPerActiveMin: median(bpm),
    };
  }, [enriched]);

  const chartDurationVsBillable = useMemo(() => {
    return buildScatterSvg({
      points: enriched.map((e) => ({
        x: e.billableUtf8Bytes,
        y: e.voiceStemSeconds ?? 0,
        ref: (e.raw.referenceId as string | undefined)?.trim() || "",
        title: (e.raw.title as string | undefined) || undefined,
      })),
      xLabel: "Fish billable UTF-8 bytes (full TTS script)",
      yLabel: "Voice stem duration (s)",
    });
  }, [enriched]);

  const chartWordsVsActiveMinutes = useMemo(() => {
    return buildScatterSvg({
      points: enriched.map((e) => ({
        x: e.activeSpeechMinutes ?? 0,
        y: e.spokenWordCount,
        ref: (e.raw.referenceId as string | undefined)?.trim() || "",
        title: (e.raw.title as string | undefined) || undefined,
      })),
      xLabel:
        "Active speech (min)\n= voice stem − sum([[PAUSE …]])\n(pre-background track)",
      yLabel: "Spoken words\n(pause markers stripped)",
    });
  }, [enriched]);

  const durationInsights = useMemo(
    () => computeVoiceStemDurationInsights(enriched),
    [enriched],
  );

  const tenMinStemWordBudgets = useMemo(() => {
    const w = durationInsights.medianWordsPerActiveSpeechMinute;
    if (w == null || w <= 0) return null;
    return [120, 180, 240].map((pauseS) => ({
      pauseS,
      words: spokenWordBudgetForStemSeconds(600, pauseS, w),
    }));
  }, [durationInsights]);

  if (process.env.NODE_ENV === "production") {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <p className="text-sm text-muted">Analytics is only available in dev.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-medium tracking-tight">
          Analytics (dev)
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
          Fish S2 estimate uses{" "}
          <span className="font-medium text-foreground">
            ${(FISH_USD_PER_UTF8_BYTE * 1_000_000).toFixed(0)} / million UTF-8 bytes
          </span>{" "}
          of the exact script sent to TTS (title + pauses + body). Voice stem duration is the
          speech MP3 length before nature/music beds. Rows missing duration or billable bytes are
          skipped.
          {approxCount > 0 ? (
            <>
              {" "}
              <span className="text-foreground/90">
                {approxCount} row(s) infer pause/spoken stats from stored{" "}
                <code className="text-xs">scriptText</code> only (truncated vs full TTS string —
                use newer generations for precise density).
              </span>
            </>
          ) : null}
        </p>
        <div className="mt-4 max-w-3xl rounded-xl border border-border bg-background/80 px-4 py-3 text-xs leading-relaxed text-muted">
          <p className="font-semibold text-foreground">Claude (Anthropic Messages API)</p>
          <p className="mt-1">
            Billing is per <strong className="text-foreground/90">token</strong>: separate rates
            for model input (system + all messages on each HTTP request) and for model output
            (completion). This app uses{" "}
            <code className="text-[11px] text-foreground/90">claude-haiku-4-5</code> for coach chat
            (streamed) and for server-side script + metadata. List prices shown here:{" "}
            <span className="tabular-nums">
              ${(CLAUDE_HAIKU_45_USD_PER_INPUT_TOKEN * 1_000_000).toFixed(2)}
            </span>{" "}
            / MTok input,{" "}
            <span className="tabular-nums">
              ${(CLAUDE_HAIKU_45_USD_PER_OUTPUT_TOKEN * 1_000_000).toFixed(2)}
            </span>{" "}
            / MTok output — verify on Anthropic’s pricing page.
          </p>
          <p className="mt-2">
            <strong className="text-foreground/90">Worker (measured):</strong> input/output
            tokens parsed from non-streaming <code className="text-[11px]">/v1/messages</code>{" "}
            responses for script generation (when the worker generates the script) and for
            library JSON metadata.
          </p>
          <p className="mt-2">
            <strong className="text-foreground/90">Coach chat (estimated):</strong> each user
            turn’s <strong>input</strong> tokens are counted with Anthropic’s free{" "}
            <code className="text-[11px]">/v1/messages/count_tokens</code> using the same system
            prompt as production chat and the message prefix up to that turn.{" "}
            <strong>Output</strong> tokens are not logged client-side; we approximate assistant
            text as ~4 characters per token. Chat streamed from the browser in the same session is{" "}
            <strong>not</strong> double-counted on the worker. If the user generates the script in
            the browser, those script tokens are <strong>not</strong> included in “worker” totals
            (only metadata runs server-side).
          </p>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground">
          {error}
        </div>
      ) : null}

      {costTotals ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Generations
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {costTotals.n}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Est. Fish cost (all)
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              ${costTotals.totalCost.toFixed(4)}
            </div>
            <div className="mt-1 text-xs text-muted">
              {Math.round(costTotals.totalBytes).toLocaleString()} billable UTF-8 bytes
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Avg cost / generation
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              ${costTotals.avgCostPerGen.toFixed(5)}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Avg cost / voice minute
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {costTotals.avgCostPerVoiceMinute != null
                ? `$${costTotals.avgCostPerVoiceMinute.toFixed(5)}`
                : "—"}
            </div>
            <div className="mt-1 text-xs text-muted">
              {(costTotals.totalVoiceMin).toFixed(1)} min voice stem total
            </div>
          </div>
        </div>
      ) : null}

      {costTotals ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Avg Fish TTS speed
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {costTotals.avgSpeechSpeed != null
                ? costTotals.avgSpeechSpeed.toFixed(2)
                : "—"}
            </div>
            <div className="mt-1 text-xs text-muted">
              {costTotals.avgSpeechSpeed != null ? (
                <>
                  <code className="text-[11px]">speechSpeed</code> on{" "}
                  {costTotals.speechSpeedRowCount}/{costTotals.n} row(s) (Fish playback parameter)
                </>
              ) : (
                "No numeric speechSpeed on these rows (older analytics or missing field)."
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Avg pause / voice minute
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              {costTotals.avgPauseSecondsPerVoiceStemMinute != null
                ? `${costTotals.avgPauseSecondsPerVoiceStemMinute.toFixed(2)} s`
                : "—"}
            </div>
            <div className="mt-1 text-xs text-muted">
              Sum of <code className="text-[11px]">[[PAUSE …]]</code> seconds ÷ voice-stem minutes
              (pre-beds); same duration basis as Fish cost above.
            </div>
          </div>
        </div>
      ) : null}

      {costTotals ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Claude Haiku (worker, measured)
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              ${costTotals.totalClaudeWorkerUsd.toFixed(4)}
            </div>
            <div className="mt-1 text-xs text-muted">Script + metadata API responses</div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Claude Haiku (coach chat, est.)
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              ${costTotals.totalClaudeChatEstUsd.toFixed(4)}
            </div>
            <div className="mt-1 text-xs text-muted">
              count_tokens + ~4 chars/out tok · {costTotals.rowsWithChatEst}/{costTotals.n} rows
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:col-span-2 lg:col-span-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Claude combined (this table)
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
              ${costTotals.totalClaudeCombinedUsd.toFixed(4)}
            </div>
            <div className="mt-1 text-xs text-muted">
              Avg ${costTotals.avgClaudeCombinedPerGen.toFixed(5)} / generation (worker + est.
              chat)
            </div>
          </div>
        </div>
      ) : null}

      {costTotals?.monthlyProjectedFishUsd != null ? (
        <div className="mb-6 rounded-2xl border border-accent/35 bg-accent-soft/25 px-4 py-4 shadow-sm sm:px-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Projected Fish cost (monthly)
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            ${costTotals.monthlyProjectedFishUsd.toFixed(2)}
            <span className="ml-2 text-base font-normal text-muted">/ month</span>
          </div>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted">
            Assumes{" "}
            <strong className="text-foreground/90">
              {costTotals.projectionSessionVoiceMinutesPerDay} minutes of voice stem
            </strong>{" "}
            (Fish TTS only) every day for{" "}
            <strong className="text-foreground/90">
              {costTotals.projectionDaysPerMonth} days
            </strong>
            . Uses your fleet average{" "}
            <span className="tabular-nums">
              ${costTotals.avgCostPerVoiceMinute?.toFixed(5)}/voice min
            </span>{" "}
            from {costTotals.n} meditation(s) above — not a Fish quote. Excludes Claude,
            beds/music, storage, and CDN.
          </p>
        </div>
      ) : costTotals && costTotals.n > 0 ? (
        <div className="mb-6 rounded-2xl border border-border bg-card px-4 py-3 text-xs text-muted">
          Add analytics rows with voice stem duration to estimate monthly Fish projection
          (needs positive total voice minutes).
        </div>
      ) : null}

      {costTotals ? (
        <div className="mb-6 rounded-2xl border border-border bg-card px-4 py-4 shadow-sm sm:px-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Projected Fish + Claude (monthly)
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            ${costTotals.monthlyProjectedOneCreatePerDayUsd.toFixed(2)}
            <span className="ml-2 text-base font-normal text-muted">/ month</span>
          </div>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted">
            Assumes <strong className="text-foreground/90">one completed meditation</strong>{" "}
            (same Fish + Claude cost mix as the averages above){" "}
            <strong className="text-foreground/90">each day</strong> for{" "}
            {costTotals.projectionDaysPerMonth} days:{" "}
            <span className="tabular-nums">
              {costTotals.projectionDaysPerMonth} × (${costTotals.avgCostPerGen.toFixed(5)} Fish + $
              {costTotals.avgClaudeCombinedPerGen.toFixed(5)} Claude)
            </span>
            . Claude includes measured worker calls plus estimated coach chat; not an Anthropic
            invoice.
          </p>
        </div>
      ) : null}

      <div className="mb-6 overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">
          By speaker
        </div>
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-background/80 text-muted">
            <tr>
              <th className="px-4 py-2 font-semibold">Speaker name</th>
              <th className="px-4 py-2 font-semibold">
                <code className="text-[11px]">referenceId</code>
              </th>
              <th className="px-4 py-2 font-semibold">N</th>
              <th className="px-4 py-2 font-semibold">Billable bytes</th>
              <th className="px-4 py-2 font-semibold">Est. $</th>
              <th className="px-4 py-2 font-semibold">$/gen</th>
              <th className="px-4 py-2 font-semibold">$/voice min</th>
            </tr>
          </thead>
          <tbody>
            {bySpeaker.map(([ref, a]) => (
              <tr key={ref} className="border-t border-border/80">
                <td className="max-w-[160px] truncate px-4 py-2 text-foreground">
                  {speakerNameForModelId(ref) ??
                    (ref === "(unknown)" ? "(unknown)" : "Unlisted")}
                </td>
                <td className="max-w-[220px] truncate px-4 py-2 font-mono text-[11px] text-foreground">
                  {ref}
                </td>
                <td className="px-4 py-2 tabular-nums">{a.count}</td>
                <td className="px-4 py-2 tabular-nums">
                  {Math.round(a.totalBytes).toLocaleString()}
                </td>
                <td className="px-4 py-2 tabular-nums">${a.totalCost.toFixed(4)}</td>
                <td className="px-4 py-2 tabular-nums">
                  ${(a.totalCost / a.count).toFixed(5)}
                </td>
                <td className="px-4 py-2 tabular-nums">
                  {a.totalVoiceMin > 0
                    ? `$${(a.totalCost / a.totalVoiceMin).toFixed(5)}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mb-8 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Planning voice stem length (script vs pauses)
          </h2>
          {durationInsights.n > 0 &&
          durationInsights.medianWordsPerActiveSpeechMinute != null &&
          durationInsights.medianWordsPerActiveSpeechMinute > 0 ? (
            <button
              type="button"
              className="shrink-0 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40"
              onClick={async () => {
                const text = buildScriptDurationPlanningBlurb(durationInsights, {
                  targetStemMinutes: 10,
                });
                try {
                  await navigator.clipboard.writeText(text);
                  setPlanningBlurbCopied(true);
                  window.setTimeout(() => setPlanningBlurbCopied(false), 2000);
                } catch {
                  setPlanningBlurbCopied(false);
                }
              }}
            >
              {planningBlurbCopied ? "Copied" : "Copy 10‑min planning blurb"}
            </button>
          ) : null}
        </div>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted">
          The <strong className="text-foreground/90">voice stem</strong> is Fish output before
          nature/music beds. It is not the same as “wall clock with beds on.” Think of it as two
          buckets: <strong className="text-foreground/90">explicit silence</strong> from{" "}
          <code className="text-[10px]">[[PAUSE …]]</code> markers, plus{" "}
          <strong className="text-foreground/90">time spent speaking</strong> the words you send to
          TTS. For a target stem length, those two trade off: more pause seconds means fewer spoken
          words at your typical pace (and the opposite).
        </p>
        {durationInsights.n > 0 &&
        durationInsights.medianWordsPerActiveSpeechMinute != null &&
        durationInsights.medianWordsPerActiveSpeechMinute > 0 ? (
          <>
            <div className="mt-4 rounded-xl border border-border bg-background/80 px-3 py-3 text-xs leading-relaxed">
              <div className="font-semibold text-foreground">One relationship to remember</div>
              <p className="mt-2 text-muted">
                Total stem (seconds) ≈{" "}
                <span className="text-foreground/90">sum of pause markers</span> +{" "}
                <span className="text-foreground/90">time for spoken words</span>. We infer your
                fleet’s typical “talking speed” as{" "}
                <strong className="tabular-nums text-foreground">
                  {durationInsights.medianWordsPerActiveSpeechMinute.toFixed(1)}
                </strong>{" "}
                words per minute of <em>non-pause</em> clock (median across this table).
              </p>
              <div className="mt-2 rounded-lg border border-border/80 bg-card px-2.5 py-2 font-mono text-[11px] text-foreground/95">
                stem_s ≈ pause_s + (spoken_words × 60 ÷ wpm_active)
              </div>
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold text-foreground">
                If the voice stem should land near 10 minutes (~600 s)
              </div>
              <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-muted">
                “How many pauses?” is really “how many <em>seconds</em> of explicit silence in total?”
                — one long <code className="text-[10px]">[[PAUSE 30s]]</code> counts the same as many
                short gaps that add to 30s. Below: spoken-word budgets for three pause totals at your
                median <code className="text-[10px]">wpm_active</code>.
              </p>
              <div className="mt-2 overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[360px] text-left text-xs">
                  <thead className="bg-background/80 text-muted">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Pause budget (sum of markers)</th>
                      <th className="px-3 py-2 font-semibold">≈ Spoken words (600 s stem)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tenMinStemWordBudgets ?? []).map(({ pauseS, words }) => (
                      <tr key={pauseS} className="border-t border-border/80">
                        <td className="px-3 py-2 tabular-nums text-foreground">
                          ~{pauseS} s (~{Math.round(pauseS / 60)} min silence)
                        </td>
                        <td className="px-3 py-2 tabular-nums text-foreground">
                          ~{words.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {durationInsights.medianVoiceStemSeconds != null &&
            durationInsights.medianPauseSeconds != null &&
            durationInsights.medianPauseShareOfStem != null &&
            durationInsights.medianSpokenWordCount != null ? (
              <div className="mt-4 rounded-xl border border-border px-3 py-3 text-xs leading-relaxed">
                <div className="font-semibold text-foreground">What your table looks like (median)</div>
                <p className="mt-2 text-muted">
                  One typical completed stem in this sample: about{" "}
                  <strong className="tabular-nums text-foreground">
                    {(durationInsights.medianVoiceStemSeconds / 60).toFixed(1)} min
                  </strong>{" "}
                  of stem,{" "}
                  <strong className="tabular-nums text-foreground">
                    {Math.round(durationInsights.medianPauseSeconds)} s
                  </strong>{" "}
                  in explicit pauses (
                  <strong className="tabular-nums text-foreground">
                    {(durationInsights.medianPauseShareOfStem * 100).toFixed(0)}%
                  </strong>{" "}
                  of stem),{" "}
                  <strong className="tabular-nums text-foreground">
                    {Math.round(durationInsights.medianSpokenWordCount)}
                  </strong>{" "}
                  spoken words. Active (non-pause) share median:{" "}
                  {durationInsights.medianActiveShareOfStem != null ? (
                    <strong className="tabular-nums text-foreground">
                      {(durationInsights.medianActiveShareOfStem * 100).toFixed(0)}%
                    </strong>
                  ) : (
                    "—"
                  )}{" "}
                  of stem.
                </p>
              </div>
            ) : null}

            <p className="mt-3 max-w-3xl text-[11px] leading-relaxed text-muted">
              The worker derives the script’s <strong className="text-foreground/90">word-count band</strong>{" "}
              from the same heuristics (plus Fish <code className="text-[10px]">speed</code> from the
              job). Tune{" "}
              <code className="text-[10px]">MEDITATION_IMPLIED_WPM_ACTIVE</code>,{" "}
              <code className="text-[10px]">MEDITATION_MEDIAN_PAUSE_SHARE</code>, and optional{" "}
              <code className="text-[10px]">MEDITATION_SCRIPT_WORD_BAND</code> (± fraction around the
              center, default 0.12) to match this panel.
            </p>

            <details className="mt-4 rounded-xl border border-border bg-background/40 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-semibold text-foreground">
                Advanced: regression fit and planner error
              </summary>
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                Notation: <strong className="text-foreground/90">T</strong> voice-stem seconds,{" "}
                <strong className="text-foreground/90">P</strong> sum of{" "}
                <code className="text-[10px]">[[PAUSE …]]</code>,{" "}
                <strong className="text-foreground/90">W</strong> spoken words,{" "}
                <strong className="text-foreground/90">B</strong> spoken UTF-8 bytes,{" "}
                <strong className="text-foreground/90">A</strong> ≈{" "}
                <code className="text-[10px]">max(ε, T − P)</code>. Planner: T̂ ≈ P + 60·W/R̂_w;
                bytes variant with B/R̂_b.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg border border-border px-3 py-2">
                  <div className="font-semibold text-muted">Rows used</div>
                  <div className="mt-1 tabular-nums text-foreground">{durationInsights.n}</div>
                </div>
                <div className="rounded-lg border border-border px-3 py-2">
                  <div className="font-semibold text-muted">Median R̂_w (words / active min)</div>
                  <div className="mt-1 tabular-nums text-foreground">
                    {durationInsights.medianWordsPerActiveSpeechMinute.toFixed(1)}
                  </div>
                  <div className="mt-1 text-[10px] text-muted">
                    MAE vs planner:{" "}
                    {durationInsights.maeWordPlannerSeconds != null
                      ? `${durationInsights.maeWordPlannerSeconds.toFixed(1)} s`
                      : "—"}
                    {durationInsights.mapeWordPlannerPct != null ? (
                      <span> (mean abs {durationInsights.mapeWordPlannerPct.toFixed(1)}% of T)</span>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-lg border border-border px-3 py-2 sm:col-span-2 lg:col-span-1">
                  <div className="font-semibold text-muted">Median R̂_b (UTF-8 bytes / active min)</div>
                  <div className="mt-1 tabular-nums text-foreground">
                    {durationInsights.medianUtf8BytesPerActiveSpeechMinute != null
                      ? Math.round(
                          durationInsights.medianUtf8BytesPerActiveSpeechMinute,
                        ).toLocaleString()
                      : "—"}
                  </div>
                  <div className="mt-1 text-[10px] text-muted">
                    MAE vs planner:{" "}
                    {durationInsights.maeBytePlannerSeconds != null
                      ? `${durationInsights.maeBytePlannerSeconds.toFixed(1)} s`
                      : "—"}
                    {durationInsights.mapeBytePlannerPct != null ? (
                      <span> (mean abs {durationInsights.mapeBytePlannerPct.toFixed(1)}% of T)</span>
                    ) : null}
                  </div>
                </div>
              </div>
              {durationInsights.olsPauseWords ? (
                <div className="mt-3 rounded-lg border border-accent/25 bg-accent-soft/15 px-3 py-3 text-[11px] leading-relaxed">
                  <div className="font-semibold text-foreground">
                    Fleet OLS (seconds): T ≈ β₀ + β₁·P + β₂·W
                  </div>
                  <div className="mt-2 font-mono text-[10px] tabular-nums text-foreground/95">
                    β₀ = {durationInsights.olsPauseWords.beta0.toFixed(2)}, β₁ ={" "}
                    {durationInsights.olsPauseWords.beta1.toFixed(4)}, β₂ ={" "}
                    {durationInsights.olsPauseWords.beta2.toFixed(4)}
                  </div>
                  <div className="mt-2 text-muted">
                    MAE {durationInsights.olsPauseWords.maeSeconds.toFixed(1)} s
                    {durationInsights.olsPauseWords.mapePct != null ? (
                      <span> · mean abs {durationInsights.olsPauseWords.mapePct.toFixed(1)}% of T</span>
                    ) : null}
                    {durationInsights.olsPauseWords.r2 != null ? (
                      <span> · R² = {durationInsights.olsPauseWords.r2.toFixed(3)}</span>
                    ) : null}
                  </div>
                </div>
              ) : durationInsights.n >= 5 ? (
                <p className="mt-3 text-[11px] text-muted">
                  OLS could not be fit (collinear or singular matrix). Try more varied pauses/word
                  counts.
                </p>
              ) : null}
              <div className="mt-3 text-[11px] leading-relaxed text-muted">
                Fish <code className="text-[10px]">speechSpeed</code>{" "}
                {durationInsights.speechSpeedVaries ? "varies" : "is constant or missing"} in this
                sample.
                {durationInsights.pearsonSpeechSpeedVsWpm != null ? (
                  <span className="ml-1">
                    Pearson r (speed vs implied WPM) ={" "}
                    <span className="tabular-nums text-foreground/90">
                      {durationInsights.pearsonSpeechSpeedVsWpm.toFixed(3)}
                    </span>
                    .
                  </span>
                ) : (
                  <span className="ml-1">Not enough paired speed + WPM rows for correlation.</span>
                )}
              </div>
            </details>
          </>
        ) : (
          <p className="mt-3 text-xs text-muted">
            Need at least one meditation with spoken words, pauses, and voice stem duration to show
            planning numbers.
          </p>
        )}
      </div>

      <div className="mb-8 overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">
          By Fish <code className="text-xs">speed</code>
        </div>
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="bg-background/80 text-muted">
            <tr>
              <th className="px-4 py-2 font-semibold">Speed</th>
              <th className="px-4 py-2 font-semibold">N</th>
              <th className="px-4 py-2 font-semibold">$/gen</th>
              <th className="px-4 py-2 font-semibold">$/voice min</th>
            </tr>
          </thead>
          <tbody>
            {bySpeed.map(([sp, a]) => (
              <tr key={sp} className="border-t border-border/80">
                <td className="px-4 py-2 tabular-nums text-foreground">{sp}</td>
                <td className="px-4 py-2 tabular-nums">{a.count}</td>
                <td className="px-4 py-2 tabular-nums">
                  ${(a.totalCost / a.count).toFixed(5)}
                </td>
                <td className="px-4 py-2 tabular-nums">
                  {a.totalVoiceMin > 0
                    ? `$${(a.totalCost / a.totalVoiceMin).toFixed(5)}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mb-8 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">Voice stem vs billable script size</div>
          <div className="text-xs text-muted">
            {loading ? "Loading…" : `${enriched.length} points`}
          </div>
        </div>
        <p className="mb-3 text-xs text-muted">
          Least-squares line: duration ≈ {chartDurationVsBillable.m.toFixed(6)} × bytes +{" "}
          {chartDurationVsBillable.b.toFixed(2)}. Tooltip shows est. Fish $ for that row (
          {`bytes × ${FISH_USD_PER_UTF8_BYTE.toExponential(3)}`}).
        </p>
        <div className="w-full overflow-x-auto">
          <svg
            width={chartDurationVsBillable.w}
            height={chartDurationVsBillable.h}
            viewBox={`0 0 ${chartDurationVsBillable.w} ${chartDurationVsBillable.h}`}
            className="block"
          >
            <rect x={0} y={0} width={chartDurationVsBillable.w} height={chartDurationVsBillable.h} fill="transparent" />
            <rect
              x={chartDurationVsBillable.pad}
              y={chartDurationVsBillable.pad}
              width={chartDurationVsBillable.w - chartDurationVsBillable.pad * 2}
              height={chartDurationVsBillable.h - chartDurationVsBillable.pad * 2}
              fill="transparent"
              stroke="rgba(120,120,120,0.35)"
            />
            {chartDurationVsBillable.line ? (
              <line
                x1={chartDurationVsBillable.line.x1}
                y1={chartDurationVsBillable.line.y1}
                x2={chartDurationVsBillable.line.x2}
                y2={chartDurationVsBillable.line.y2}
                stroke="rgba(212,175,55,0.95)"
                strokeWidth={2}
              />
            ) : null}
            {chartDurationVsBillable.dots.map((d, idx) => (
              <circle key={idx} cx={d.cx} cy={d.cy} r={4.5} fill={d.fill} stroke="rgba(0,0,0,0.25)">
                <title>
                  {`${d.title}\n${d.y.toFixed(1)}s voice • ${Math.round(d.x)} bytes billable • $${fishCostUsdFromBillableBytes(d.x).toFixed(5)} Fish est.`}
                </title>
              </circle>
            ))}
            <text
              x={chartDurationVsBillable.pad}
              y={chartDurationVsBillable.h - 8}
              fontSize={11}
              fill="rgba(160,160,160,0.95)"
            >
              Billable UTF-8 bytes (Fish input) →
            </text>
            <text x={10} y={chartDurationVsBillable.pad - 8} fontSize={11} fill="rgba(160,160,160,0.95)">
              Voice stem (s) ↑
            </text>
          </svg>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">
            Spoken words vs active speech time (pause length removed from clock)
          </div>
          <div className="text-xs text-muted">{enriched.length} points</div>
        </div>
        <p className="mb-2 text-xs leading-relaxed text-muted">
          X = <strong>active speech minutes</strong> = (voice stem seconds − sum of explicit{" "}
          <code className="text-[10px]">[[PAUSE …]]</code> seconds) / 60. Y = word count after
          stripping pause markers from the same script used for Fish. Slope ≈ words per active
          minute for planning target script length.
        </p>
        {densityStats.medianWpm != null ? (
          <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-border bg-background px-3 py-2 text-xs">
            <span>
              <span className="text-muted">Median words / active speech min:</span>{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {densityStats.medianWpm.toFixed(1)}
              </span>
            </span>
            {densityStats.medianUtf8BytesPerActiveMin != null ? (
              <span>
                <span className="text-muted">Median UTF-8 bytes / active speech min:</span>{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {Math.round(densityStats.medianUtf8BytesPerActiveMin).toLocaleString()}
                </span>
              </span>
            ) : null}
          </div>
        ) : null}
        <p className="mb-3 text-xs text-muted">
          Fit: words ≈ {chartWordsVsActiveMinutes.m.toFixed(2)} × activeMin +{" "}
          {chartWordsVsActiveMinutes.b.toFixed(1)}
        </p>
        <div className="w-full overflow-x-auto">
          <svg
            width={chartWordsVsActiveMinutes.w}
            height={chartWordsVsActiveMinutes.h}
            viewBox={`0 0 ${chartWordsVsActiveMinutes.w} ${chartWordsVsActiveMinutes.h}`}
            className="block"
          >
            <rect x={0} y={0} width={chartWordsVsActiveMinutes.w} height={chartWordsVsActiveMinutes.h} fill="transparent" />
            <rect
              x={chartWordsVsActiveMinutes.pad}
              y={chartWordsVsActiveMinutes.pad}
              width={chartWordsVsActiveMinutes.w - chartWordsVsActiveMinutes.pad * 2}
              height={chartWordsVsActiveMinutes.h - chartWordsVsActiveMinutes.pad * 2}
              fill="transparent"
              stroke="rgba(120,120,120,0.35)"
            />
            {chartWordsVsActiveMinutes.line ? (
              <line
                x1={chartWordsVsActiveMinutes.line.x1}
                y1={chartWordsVsActiveMinutes.line.y1}
                x2={chartWordsVsActiveMinutes.line.x2}
                y2={chartWordsVsActiveMinutes.line.y2}
                stroke="rgba(120,160,220,0.95)"
                strokeWidth={2}
              />
            ) : null}
            {chartWordsVsActiveMinutes.dots.map((d, idx) => (
              <circle key={idx} cx={d.cx} cy={d.cy} r={4.5} fill={d.fill} stroke="rgba(0,0,0,0.25)">
                <title>{d.title}</title>
              </circle>
            ))}
            <text
              x={chartWordsVsActiveMinutes.pad}
              y={chartWordsVsActiveMinutes.h - 8}
              fontSize={11}
              fill="rgba(160,160,160,0.95)"
            >
              Active speech minutes →
            </text>
            <text x={10} y={chartWordsVsActiveMinutes.pad - 8} fontSize={11} fill="rgba(160,160,160,0.95)">
              Spoken words ↑
            </text>
          </svg>
        </div>
      </div>
    </div>
  );
}
