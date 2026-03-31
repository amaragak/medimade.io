"use client";

import { useEffect, useMemo, useState } from "react";
import { getMedimadeApiBase } from "@/lib/medimade-api";

type AnalyticsItem = {
  scriptUtf8Bytes?: number;
  durationSeconds?: number | null;
  s3Key?: string;
  createdAt?: string;
};

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

export default function AnalyticsPage() {
  const [items, setItems] = useState<AnalyticsItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const dollarsPer15mBytes = 1 / 15_000_000;

  useEffect(() => {
    const base = getMedimadeApiBase();
    if (!base) {
      setError("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`${base}/analytics/meditations?limit=500`)
      .then(async (r) => {
        const j = (await r.json()) as { items?: AnalyticsItem[]; error?: string; detail?: string };
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

  const points = useMemo(() => {
    return items
      .map((it) => {
        const x = typeof it.scriptUtf8Bytes === "number" ? it.scriptUtf8Bytes : NaN;
        const y = typeof it.durationSeconds === "number" ? it.durationSeconds : NaN;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y, raw: it };
      })
      .filter(Boolean) as Array<{ x: number; y: number; raw: AnalyticsItem }>;
  }, [items]);

  const { m, b } = useMemo(() => linearRegression(points), [points]);

  const costStats = useMemo(() => {
    if (points.length === 0) return null;
    const totalBytes = points.reduce((acc, p) => acc + p.x, 0);
    const totalSeconds = points.reduce((acc, p) => acc + p.y, 0);
    if (totalSeconds <= 0) return null;
    const totalCost = totalBytes * dollarsPer15mBytes;
    const totalMinutes = totalSeconds / 60;
    const avgCostPerMinute = totalCost / totalMinutes;
    return { totalBytes, totalSeconds, totalCost, avgCostPerMinute };
  }, [points, dollarsPer15mBytes]);

  const chart = useMemo(() => {
    const w = 900;
    const h = 420;
    const pad = 36;
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;

    if (points.length === 0) {
      return { w, h, pad, dots: [], line: null as null | { x1: number; y1: number; x2: number; y2: number } };
    }

    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
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

    const dots = points.map((p) => ({
      cx: sx(p.x),
      cy: sy(p.y),
      x: p.x,
      y: p.y,
      label: p.raw.s3Key ?? "",
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

    return { w, h, pad, dots, line };
  }, [points, m, b]);

  if (process.env.NODE_ENV === "production") {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <p className="text-sm text-muted">Analytics is only available in dev.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-medium tracking-tight">
          Analytics (dev)
        </h1>
        <p className="mt-1 text-sm text-muted">
          Scatter: meditation duration (seconds) vs script UTF-8 bytes. Line is least-squares fit.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground">
          {error}
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">Meditations</div>
          <div className="text-xs text-muted">
            {loading ? "Loading…" : `${points.length} points`}
          </div>
        </div>

        {costStats ? (
          <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-border bg-background px-3 py-2 text-xs">
            <span className="font-semibold text-foreground">
              Avg cost/min: ${costStats.avgCostPerMinute.toFixed(6)}
            </span>
            <span className="text-muted">
              (${costStats.totalCost.toFixed(4)} total over{" "}
              {(costStats.totalSeconds / 60).toFixed(1)} min,{" "}
              {Math.round(costStats.totalBytes).toLocaleString()} bytes)
            </span>
          </div>
        ) : null}

        <div className="w-full overflow-x-auto">
          <svg
            width={chart.w}
            height={chart.h}
            viewBox={`0 0 ${chart.w} ${chart.h}`}
            className="block"
          >
            <rect x={0} y={0} width={chart.w} height={chart.h} fill="transparent" />
            <rect
              x={chart.pad}
              y={chart.pad}
              width={chart.w - chart.pad * 2}
              height={chart.h - chart.pad * 2}
              fill="transparent"
              stroke="rgba(120,120,120,0.35)"
            />

            {chart.line ? (
              <line
                x1={chart.line.x1}
                y1={chart.line.y1}
                x2={chart.line.x2}
                y2={chart.line.y2}
                stroke="rgba(212,175,55,0.9)"
                strokeWidth={2}
              />
            ) : null}

            {chart.dots.map((d, idx) => (
              <circle
                key={idx}
                cx={d.cx}
                cy={d.cy}
                r={4}
                fill="rgba(255,255,255,0.9)"
                stroke="rgba(0,0,0,0.35)"
              >
                <title>
                  {`${d.y.toFixed(1)}s • ${d.x} bytes • $${(d.x * dollarsPer15mBytes).toFixed(6)}${d.label ? ` • ${d.label}` : ""}`}
                </title>
              </circle>
            ))}

            <text x={chart.pad} y={chart.h - 10} fontSize={12} fill="rgba(160,160,160,0.95)">
              script UTF-8 bytes →
            </text>
            <text x={10} y={chart.pad - 10} fontSize={12} fill="rgba(160,160,160,0.95)">
              duration (s) ↑
            </text>
          </svg>
        </div>

        <div className="mt-3 text-xs text-muted">
          Fit: duration ≈ {m.toFixed(6)} * bytes + {b.toFixed(3)}
        </div>
      </div>
    </div>
  );
}

