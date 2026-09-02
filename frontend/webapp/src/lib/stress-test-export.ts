import JSZip from "jszip";
import type { MeditationStyleLabel } from "@/lib/meditation-style-intake";
import type { StressTestPath } from "@/lib/stress-test-config";
import type { StressTestRunResult } from "@/lib/stress-test-runner";
import type { SavedStressTestRun } from "@/lib/stress-test-storage";

type AggregatedRow = {
  type: string;
  path: StressTestPath;
  runs: number;
  avgCustomPct: number | null;
  avgEstDurationMs: number;
  avgSegs: number;
  promos: number;
  warnings: number;
  avgLlmGbp: number;
  avgTtsGbp: number;
  avgSavingGbp: number;
  avgTotalGbp: number;
};

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function aggregateRuns(runs: StressTestRunResult[]): {
  byTypePath: AggregatedRow[];
  byPath: AggregatedRow[];
} {
  const completed = runs.filter((r) => r.status === "completed" && r.stats);
  const byKey = new Map<string, StressTestRunResult[]>();

  for (const run of completed) {
    const key = `${run.type}::${run.path}`;
    const list = byKey.get(key) ?? [];
    list.push(run);
    byKey.set(key, list);
  }

  const byTypePath: AggregatedRow[] = [...byKey.entries()]
    .map(([key, group]) => {
      const [type, path] = key.split("::") as [string, StressTestPath];
      const stats = group.map((r) => r.stats!);
      return {
        type,
        path,
        runs: group.length,
        avgCustomPct: average(
          stats
            .map((s) => s.customPct)
            .filter((v): v is number => v != null),
        ) || null,
        avgEstDurationMs: average(stats.map((s) => s.estDurationMs)),
        avgSegs: average(stats.map((s) => s.segmentsUsed)),
        promos: stats.reduce((n, s) => n + s.promosCount, 0),
        warnings: stats.reduce((n, s) => n + s.warningsCount, 0),
        avgLlmGbp: average(stats.map((s) => s.llmCostGBP.total)),
        avgTtsGbp: average(stats.map((s) => s.estTtsCostGBP)),
        avgSavingGbp: average(stats.map((s) => s.estCacheSavingGBP)),
        avgTotalGbp: average(stats.map((s) => s.totalEstCostGBP)),
      };
    })
    .sort((a, b) => a.type.localeCompare(b.type) || a.path.localeCompare(b.path));

  const byPathMap = new Map<StressTestPath, StressTestRunResult[]>();
  for (const run of completed) {
    const list = byPathMap.get(run.path) ?? [];
    list.push(run);
    byPathMap.set(run.path, list);
  }

  const byPath: AggregatedRow[] = [...byPathMap.entries()].map(([path, group]) => {
    const stats = group.map((r) => r.stats!);
    return {
      type: "All types",
      path,
      runs: group.length,
      avgCustomPct: average(
        stats.map((s) => s.customPct).filter((v): v is number => v != null),
      ) || null,
      avgEstDurationMs: average(stats.map((s) => s.estDurationMs)),
      avgSegs: average(stats.map((s) => s.segmentsUsed)),
      promos: stats.reduce((n, s) => n + s.promosCount, 0),
      warnings: stats.reduce((n, s) => n + s.warningsCount, 0),
      avgLlmGbp: average(stats.map((s) => s.llmCostGBP.total)),
      avgTtsGbp: average(stats.map((s) => s.estTtsCostGBP)),
      avgSavingGbp: average(stats.map((s) => s.estCacheSavingGBP)),
      avgTotalGbp: average(stats.map((s) => s.totalEstCostGBP)),
    };
  });

  return { byTypePath, byPath };
}

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildStatsCsv(runs: StressTestRunResult[]): string {
  const header =
    "type,path,run,estDurationMs,targetDurationMs,customPct,segCount,llmCostGBP,estTtsCostGBP,estCacheSavingGBP,totalEstCostGBP,promosCount,warningsCount,error";
  const rows = runs.map((run) => {
    const s = run.stats;
    return [
      run.type,
      run.path,
      run.runIndex,
      s?.estDurationMs ?? "",
      s?.targetDurationMs ?? "",
      s?.customPct != null ? s.customPct.toFixed(1) : "",
      s?.segmentsUsed ?? "",
      s?.llmCostGBP.total.toFixed(4) ?? "",
      s?.estTtsCostGBP.toFixed(4) ?? "",
      s?.estCacheSavingGBP.toFixed(4) ?? "",
      s?.totalEstCostGBP.toFixed(4) ?? "",
      s?.promosCount ?? "",
      s?.warningsCount ?? "",
      run.error ?? "",
    ]
      .map(csvEscape)
      .join(",");
  });
  return [header, ...rows].join("\n");
}

export async function exportStressTestZip(saved: SavedStressTestRun): Promise<void> {
  const aggregated = aggregateRuns(saved.runs);
  const payload = {
    config: {
      ...saved.config,
      timestamp: saved.timestamp,
    },
    runs: saved.runs.map((run) => ({
      type: run.type,
      path: run.path,
      runIndex: run.runIndex,
      status: run.status,
      stats: run.stats ?? null,
      totalUsage: run.stats?.totalUsage ?? null,
      costSummary: run.stats?.costSummary ?? null,
      beatList: run.beats ?? [],
      renderedText: run.renderedText ?? "",
      substitutionDecisions: run.v3Meta?.decisions ?? undefined,
      v3Meta: run.v3Meta ?? undefined,
      warnings: run.beatWarnings ?? [],
      error: run.error,
    })),
    aggregated,
  };

  const zip = new JSZip();
  zip.file("results.json", JSON.stringify(payload, null, 2));
  zip.file("stats.csv", buildStatsCsv(saved.runs));

  const stamp = saved.timestamp.replace(/[:.]/g, "-").slice(0, 16);
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stress-test-${stamp}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { aggregateRuns, type AggregatedRow };
