"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ScriptLabBeatsPreview,
} from "@/components/script-lab-beats-preview";
import {
  ScriptLabV3PreviewContent,
  ScriptLabV3SubstitutionStatsLine,
} from "@/components/script-lab-v3-preview";
import { ScriptLabCostStatsPanel } from "@/components/script-lab-cost-stats-panel";
import { intakeQuestionsForStyle } from "@/lib/meditation-style-intake";
import type { MeditationStyleLabel } from "@/lib/meditation-style-intake";
import type { StyleQuestionAnswers } from "@/lib/meditation-style-intake";
import { listAdminScriptLab, type ScriptLabState } from "@/lib/medimade-api";
import {
  findDuplicateBeatTypeWarnings,
  formatBeatWarning,
} from "@/lib/script-lab-beats";
import {
  formatDurationClock,
} from "@/lib/script-lab-estimate";
import { formatGbp } from "@/lib/script-lab-cost";
import {
  STRESS_TEST_PATHS,
  STRESS_TEST_PATH_LABELS,
  STRESS_TEST_TARGET_MINUTES,
  type StressTestPath,
} from "@/lib/stress-test-config";
import { aggregateRuns, exportStressTestZip, type AggregatedRow } from "@/lib/stress-test-export";
import {
  emptyCustomInputsForType,
  resolveStressTestAnswers,
  STRESS_TEST_FIXED_INPUTS,
  STRESS_TEST_MEDITATION_TYPES,
} from "@/lib/stress-test-inputs";
import {
  isV3StressTestAvailable,
  runStressTestBatch,
  type StressTestBatchProgress,
  type StressTestRunResult,
  type StressTestRunStatus,
} from "@/lib/stress-test-runner";
import {
  createSavedStressTestRun,
  loadSavedStressTestRuns,
  saveStressTestRun,
  type SavedStressTestRun,
} from "@/lib/stress-test-storage";

const inputClassName =
  "mt-1 block w-full border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800";

function statusDot(status: StressTestRunStatus): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-red-500";
    case "running":
      return "bg-sky-500 animate-pulse";
    case "cancelled":
      return "bg-stone-400";
    case "not_implemented":
      return "bg-amber-400";
    default:
      return "bg-stone-300";
  }
}

function RunStatsBar({ run }: { run: StressTestRunResult }) {
  const stats = run.stats;
  if (!stats) return null;
  const durationSec = stats.estDurationMs / 1000;
  const pauseSec = stats.pauseMs / 1000;
  const segmentSec = stats.segmentMs / 1000;

  return (
    <div className="space-y-1 text-xs text-muted">
      <p>
        Est. duration:{" "}
        <span className="font-semibold text-foreground">
          {formatDurationClock(durationSec)}
        </span>{" "}
        (target: {STRESS_TEST_TARGET_MINUTES} min) — pauses{" "}
        {formatDurationClock(pauseSec)}, segments {formatDurationClock(segmentSec)}, custom ~{" "}
        {stats.customWordCount} words —{" "}
        {stats.customPct != null ? `${stats.customPct.toFixed(0)}% custom` : "—"}
      </p>
      {run.path === "v3" && stats.substitutionBreakdown ? (
        <ScriptLabV3SubstitutionStatsLine stats={stats.substitutionBreakdown} />
      ) : null}
      <p>
        LLM: {formatGbp(stats.llmCostGBP.total)} (
        {stats.llmCostGBP.fill > 0
          ? `generation ${formatGbp(stats.llmCostGBP.generation)} · fill ${formatGbp(stats.llmCostGBP.fill)}`
          : `generation ${formatGbp(stats.llmCostGBP.generation)}`}
        ) · Est. TTS (all text):{" "}
        {stats.costSummary
          ? formatGbp(stats.costSummary.fishAllGbp)
          : formatGbp(stats.estTtsCostGBP)}{" "}
        · Est. cache saving: {formatGbp(stats.estCacheSavingGBP)}
      </p>
      {stats.costSummary ? <ScriptLabCostStatsPanel summary={stats.costSummary} compact /> : null}
    </div>
  );
}

function RunCard({
  run,
  tagRepeatabilityByName,
}: {
  run: StressTestRunResult;
  tagRepeatabilityByName: Record<string, import("@/lib/script-segment-tags").ScriptSegmentRepeatability>;
}) {
  const [expanded, setExpanded] = useState(false);
  const stats = run.stats;

  const headline = stats
    ? `${formatDurationClock(stats.estDurationMs / 1000)} · ${stats.customPct != null ? `${Math.round(stats.customPct)}% custom` : "—"} · ${stats.segmentsUsed} segs · ${stats.totalUsage.input_tokens.toLocaleString()}+${stats.totalUsage.output_tokens.toLocaleString()} tok · LLM ${formatGbp(stats.llmCostGBP.total)} · TTS(all) ~${stats.costSummary ? formatGbp(stats.costSummary.fishAllGbp) : formatGbp(stats.estTtsCostGBP)}`
    : run.error ?? run.status;

  if (run.status === "not_implemented") {
    return (
      <div className="rounded-lg border border-amber-400/40 bg-amber-500/5 px-3 py-2 text-sm text-muted">
        Run {run.runIndex} — {STRESS_TEST_PATH_LABELS[run.path]}: Not yet implemented (embeddings
        required)
      </div>
    );
  }

  if (run.status === "failed") {
    return (
      <div className="rounded-lg border border-red-400/40 bg-red-500/5 px-3 py-2 text-sm">
        <span className="font-medium text-red-800 dark:text-red-200">
          Run {run.runIndex} — {STRESS_TEST_PATH_LABELS[run.path]}
        </span>
        <p className="mt-1 text-xs text-muted">{run.error ?? "Failed"}</p>
      </div>
    );
  }

  if (run.status !== "completed" || !run.beats) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted">
        <span className={`inline-block h-2 w-2 rounded-full ${statusDot(run.status)}`} />
        Run {run.runIndex} — {STRESS_TEST_PATH_LABELS[run.path]} ({run.status})
      </div>
    );
  }

  const warnings =
    run.beatWarnings ??
    findDuplicateBeatTypeWarnings(run.beats, tagRepeatabilityByName);

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-background/60"
      >
        <span className="font-medium">
          Run {run.runIndex} — {STRESS_TEST_PATH_LABELS[run.path]}
        </span>
        <span className="text-xs text-muted">{headline}</span>
        <span className="text-xs text-muted">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded ? (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <RunStatsBar run={run} />
          {warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs">
              <p className="font-medium text-amber-900 dark:text-amber-100">
                Duplicate singular segment detected
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
                {warnings.map((w, i) => (
                  <li key={i}>{formatBeatWarning(w)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <p className="text-xs font-medium text-foreground">Rendered script</p>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-xs leading-relaxed">
              {run.renderedText ?? ""}
            </pre>
          </div>
          <div>
            <p className="text-xs font-medium text-foreground">Beats (after verification)</p>
            <ScriptLabBeatsPreview
              beats={run.beats}
              tagRepeatabilityByName={tagRepeatabilityByName}
              correctedBeatIndices={new Set()}
            />
          </div>
          {run.path === "v3" && run.v3Meta ? (
            <div>
              <p className="text-xs font-medium text-foreground">V3 substitution decisions</p>
              <ScriptLabV3PreviewContent
                view="substitution"
                v3Meta={run.v3Meta}
                verificationBeats={run.beats}
                tagRepeatabilityByName={tagRepeatabilityByName}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type SortKey = keyof AggregatedRow;

function SummaryTable({ rows }: { rows: AggregatedRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("type");
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return sortAsc ? av - bv : bv - av;
      }
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [rows, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  const cols: Array<{ key: SortKey; label: string; fmt?: (r: AggregatedRow) => string }> = [
    { key: "type", label: "Type" },
    { key: "path", label: "Path" },
    { key: "runs", label: "Runs" },
    {
      key: "avgCustomPct",
      label: "Avg % custom",
      fmt: (r) => (r.avgCustomPct != null ? `${r.avgCustomPct.toFixed(0)}%` : "—"),
    },
    {
      key: "avgEstDurationMs",
      label: "Avg est dur",
      fmt: (r) => formatDurationClock(r.avgEstDurationMs / 1000),
    },
    { key: "avgSegs", label: "Avg segs", fmt: (r) => r.avgSegs.toFixed(1) },
    { key: "promos", label: "Promos" },
    { key: "warnings", label: "Warnings" },
    { key: "avgLlmGbp", label: "Avg LLM £", fmt: (r) => formatGbp(r.avgLlmGbp) },
    { key: "avgTtsGbp", label: "Avg TTS £", fmt: (r) => formatGbp(r.avgTtsGbp) },
    { key: "avgSavingGbp", label: "Avg saving £", fmt: (r) => formatGbp(r.avgSavingGbp) },
    { key: "avgTotalGbp", label: "Avg total £", fmt: (r) => formatGbp(r.avgTotalGbp) },
  ];

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-background/80 text-muted">
          <tr>
            {cols.map((c) => (
              <th key={c.key} className="cursor-pointer px-2 py-2 font-medium" onClick={() => toggleSort(c.key)}>
                {c.label}
                {sortKey === c.key ? (sortAsc ? " ↑" : " ↓") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={`${row.type}-${row.path}`} className="border-t border-border">
              {cols.map((c) => (
                <td key={c.key} className="px-2 py-1.5">
                  {c.fmt ? c.fmt(row) : String(row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CostChart({ byPath }: { byPath: AggregatedRow[] }) {
  if (byPath.length === 0) return null;
  const maxTotal = Math.max(...byPath.map((r) => r.avgLlmGbp + r.avgTtsGbp), 0.001);

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm font-medium">Avg cost split by path (LLM vs TTS)</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {byPath.map((row) => {
          const llmPct = (row.avgLlmGbp / maxTotal) * 100;
          const ttsPct = (row.avgTtsGbp / maxTotal) * 100;
          return (
            <div key={row.path} className="rounded-lg border border-border p-3">
              <p className="text-xs font-medium">{STRESS_TEST_PATH_LABELS[row.path]}</p>
              <div className="mt-2 flex h-24 items-end gap-1">
                <div
                  className="flex-1 rounded-t bg-violet-500/80"
                  style={{ height: `${Math.max(llmPct, 4)}%` }}
                  title={`LLM ${formatGbp(row.avgLlmGbp)}`}
                />
                <div
                  className="flex-1 rounded-t bg-sky-500/80"
                  style={{ height: `${Math.max(ttsPct, 4)}%` }}
                  title={`TTS ${formatGbp(row.avgTtsGbp)}`}
                />
              </div>
              <p className="mt-2 text-[11px] text-muted">
                LLM {formatGbp(row.avgLlmGbp)} · TTS {formatGbp(row.avgTtsGbp)} · Total{" "}
                {formatGbp(row.avgTotalGbp)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AdminStressTestPanel() {
  const [library, setLibrary] = useState<ScriptLabState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<MeditationStyleLabel>>(
    () => new Set(STRESS_TEST_MEDITATION_TYPES),
  );
  const [selectedPaths, setSelectedPaths] = useState<Set<StressTestPath>>(
    () => new Set(STRESS_TEST_PATHS),
  );
  const [runsPerType, setRunsPerType] = useState(3);
  const [voiceModelId, setVoiceModelId] = useState("");
  const [useFixedInputs, setUseFixedInputs] = useState(true);
  const [customInputsByType, setCustomInputsByType] = useState<
    Partial<Record<MeditationStyleLabel, StyleQuestionAnswers>>
  >({});
  const [configOpen, setConfigOpen] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<StressTestBatchProgress | null>(null);
  const [runs, setRuns] = useState<StressTestRunResult[]>([]);
  const [savedRuns, setSavedRuns] = useState<SavedStressTestRun[]>([]);
  const [selectedSavedId, setSelectedSavedId] = useState<string>("");
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSavedRuns(loadSavedStressTestRuns());
    void listAdminScriptLab()
      .then((data) => {
        setLibrary(data);
        if (data.speakers[0]?.modelId) {
          setVoiceModelId(data.speakers[0].modelId);
        }
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load library"));
  }, []);

  const tagRepeatabilityByName = useMemo(() => {
    const map: Record<string, import("@/lib/script-segment-tags").ScriptSegmentRepeatability> = {};
    for (const tag of library?.tags ?? []) {
      map[tag.name] = tag.repeatability ?? "singular";
    }
    return map;
  }, [library?.tags]);

  const runsByType = useMemo(() => {
    const map = new Map<string, StressTestRunResult[]>();
    for (const run of runs) {
      const list = map.get(run.type) ?? [];
      list.push(run);
      map.set(run.type, list);
    }
    return map;
  }, [runs]);

  const aggregated = useMemo(() => aggregateRuns(runs), [runs]);

  const currentSaved = useMemo((): SavedStressTestRun | null => {
    if (runs.length === 0) return null;
    return createSavedStressTestRun({
      config: {
        types: [...selectedTypes],
        paths: [...selectedPaths],
        runsPerType,
        duration: STRESS_TEST_TARGET_MINUTES,
        voiceModelId,
        useFixedInputs,
        customInputsByType: useFixedInputs ? undefined : customInputsByType,
      },
      runs,
    });
  }, [
    runs,
    selectedTypes,
    selectedPaths,
    runsPerType,
    voiceModelId,
    useFixedInputs,
    customInputsByType,
  ]);

  const getAnswersForType = useCallback(
    (type: MeditationStyleLabel) =>
      resolveStressTestAnswers(type, useFixedInputs, customInputsByType),
    [useFixedInputs, customInputsByType],
  );

  async function handleRun() {
    if (!library || !voiceModelId) return;
    if (selectedTypes.size === 0 || selectedPaths.size === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    const initialRuns: StressTestRunResult[] = [];
    for (const type of selectedTypes) {
      for (const path of selectedPaths) {
        for (let runIndex = 1; runIndex <= runsPerType; runIndex += 1) {
          initialRuns.push({
            id: `${type}:${path}:${runIndex}`,
            type,
            path,
            runIndex,
            status: "pending",
          });
        }
      }
    }
    setRuns(initialRuns);
    setProgress(null);

    const results = await runStressTestBatch({
      config: {
        types: [...selectedTypes],
        paths: [...selectedPaths],
        runsPerType,
        voiceModelId,
        useFixedInputs,
        customInputsByType,
      },
      library,
      speakers: library.speakers,
      embeddingStats: library.embeddingStats,
      signal: controller.signal,
      getAnswersForType,
      onRunUpdate: (run) => {
        setRuns((prev) => prev.map((r) => (r.id === run.id ? run : r)));
      },
      onProgress: setProgress,
    });

    setRuns(results);
    setRunning(false);

    const saved = createSavedStressTestRun({
      config: {
        types: [...selectedTypes],
        paths: [...selectedPaths],
        runsPerType,
        duration: STRESS_TEST_TARGET_MINUTES,
        voiceModelId,
        useFixedInputs,
        customInputsByType: useFixedInputs ? undefined : customInputsByType,
      },
      runs: results,
    });
    setSavedRuns(saveStressTestRun(saved));
    setSelectedSavedId(saved.id);
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  function handleExport() {
    if (!currentSaved) return;
    void exportStressTestZip(currentSaved);
  }

  function loadSaved(id: string) {
    const saved = savedRuns.find((r) => r.id === id);
    if (!saved) return;
    setSelectedSavedId(id);
    setRuns(saved.runs);
    setSelectedTypes(new Set(saved.config.types));
    setSelectedPaths(new Set(saved.config.paths));
    setRunsPerType(saved.config.runsPerType);
    setVoiceModelId(saved.config.voiceModelId);
    setUseFixedInputs(saved.config.useFixedInputs);
    if (saved.config.customInputsByType) {
      setCustomInputsByType(saved.config.customInputsByType);
    }
  }

  const v3Available = isV3StressTestAvailable(library?.embeddingStats);
  const totalPlanned =
    selectedTypes.size * selectedPaths.size * Math.max(1, runsPerType);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-medium tracking-tight">Stress Test</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Batch-generate scripts across meditation types and generation paths for side-by-side
            comparison. Duration fixed at {STRESS_TEST_TARGET_MINUTES} minutes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {savedRuns.length > 0 ? (
            <select
              className="rounded border border-border bg-background px-2 py-1.5 text-sm"
              value={selectedSavedId}
              onChange={(e) => loadSaved(e.target.value)}
            >
              <option value="">Previous runs…</option>
              {savedRuns.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            disabled={!currentSaved}
            onClick={handleExport}
            className="rounded-full border border-border px-4 py-1.5 text-sm hover:bg-card disabled:opacity-50"
          >
            Export
          </button>
          {running ? (
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-full border border-red-400/50 px-4 py-1.5 text-sm text-red-700 hover:bg-red-500/10 dark:text-red-300"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              disabled={!library || !voiceModelId || loadError != null}
              onClick={() => void handleRun()}
              className="rounded-full bg-selected px-4 py-1.5 text-sm font-medium text-on-selected disabled:opacity-50"
            >
              Run
            </button>
          )}
        </div>
      </div>

      {loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
      ) : null}

      <section className="rounded-xl border border-border bg-card">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
          onClick={() => setConfigOpen((v) => !v)}
        >
          Configuration
          <span className="text-muted">{configOpen ? "▾" : "▸"}</span>
        </button>
        {configOpen ? (
          <div className="space-y-4 border-t border-border px-4 py-4 text-sm">
            <div>
              <p className="font-medium">Types to include</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {STRESS_TEST_MEDITATION_TYPES.map((type) => (
                  <label key={type} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={selectedTypes.has(type)}
                      onChange={(e) => {
                        setSelectedTypes((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(type);
                          else next.delete(type);
                          return next;
                        });
                      }}
                    />
                    {type}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="font-medium">Paths to include</p>
              <div className="mt-2 flex flex-wrap gap-4">
                {STRESS_TEST_PATHS.map((path) => (
                  <label key={path} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={selectedPaths.has(path)}
                      onChange={(e) => {
                        setSelectedPaths((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(path);
                          else next.delete(path);
                          return next;
                        });
                      }}
                    />
                    {STRESS_TEST_PATH_LABELS[path]}
                    {path === "v3" && !v3Available ? (
                      <span className="text-amber-600 dark:text-amber-400">(no embeddings)</span>
                    ) : null}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block text-xs">
                Runs per type per path
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={runsPerType}
                  onChange={(e) => setRunsPerType(Math.max(1, Number(e.target.value) || 1))}
                  className={inputClassName}
                />
              </label>
              <label className="block text-xs">
                Duration
                <input
                  type="text"
                  readOnly
                  value={`${STRESS_TEST_TARGET_MINUTES} min (fixed)`}
                  className={inputClassName}
                />
              </label>
              <label className="block text-xs">
                Voice (preview durations)
                <select
                  value={voiceModelId}
                  onChange={(e) => setVoiceModelId(e.target.value)}
                  className={inputClassName}
                >
                  {(library?.speakers ?? []).map((s) => (
                    <option key={s.modelId} value={s.modelId}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={useFixedInputs}
                onChange={(e) => setUseFixedInputs(e.target.checked)}
              />
              Use fixed test inputs per type
            </label>

            {!useFixedInputs ? (
              <div className="space-y-4">
                {STRESS_TEST_MEDITATION_TYPES.filter((t) => selectedTypes.has(t)).map((type) => {
                  const questions = intakeQuestionsForStyle(type);
                  const answers =
                    customInputsByType[type] ?? emptyCustomInputsForType(type);
                  return (
                    <div key={type} className="rounded-lg border border-border p-3">
                      <p className="text-xs font-medium">{type}</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {questions.map((q, i) => (
                          <label key={i} className="block text-[11px] text-muted">
                            {q}
                            <input
                              type="text"
                              value={answers[i] ?? ""}
                              onChange={(e) => {
                                const next = [...answers] as StyleQuestionAnswers;
                                next[i] = e.target.value;
                                setCustomInputsByType((prev) => ({ ...prev, [type]: next }));
                              }}
                              className={inputClassName}
                            />
                          </label>
                        ))}
                        <label className="block text-[11px] text-muted sm:col-span-2">
                          Anything else?
                          <input
                            type="text"
                            value={answers[3] ?? ""}
                            onChange={(e) => {
                              const next = [...answers] as StyleQuestionAnswers;
                              next[3] = e.target.value;
                              setCustomInputsByType((prev) => ({ ...prev, [type]: next }));
                            }}
                            className={inputClassName}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer font-medium text-foreground">
                  Preview fixed inputs
                </summary>
                <ul className="mt-2 space-y-1 pl-4">
                  {STRESS_TEST_MEDITATION_TYPES.map((type) => (
                    <li key={type}>
                      <span className="font-medium text-foreground">{type}:</span>{" "}
                      {STRESS_TEST_FIXED_INPUTS[type].filter(Boolean).join(" · ")}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ) : null}
      </section>

      {running || progress ? (
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <p>
            Generating {progress?.total ?? totalPlanned} scripts…{" "}
            <span className="text-muted">
              {progress?.completed ?? 0} done · {progress?.failed ?? 0} failed ·{" "}
              {progress?.inFlight ?? 0} in flight
            </span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {runs.map((run) => (
              <span
                key={run.id}
                title={`${run.type} ${run.path} #${run.runIndex}`}
                className={`h-2 w-2 rounded-full ${statusDot(run.status)}`}
              />
            ))}
          </div>
        </div>
      ) : null}

      {runs.length > 0 ? (
        <div className="space-y-6">
          {[...selectedTypes].map((type) => {
            const typeRuns = runsByType.get(type) ?? [];
            const collapsed = collapsedTypes.has(type);
            return (
              <section key={type} className="rounded-xl border border-border bg-card">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                  onClick={() =>
                    setCollapsedTypes((prev) => {
                      const next = new Set(prev);
                      if (next.has(type)) next.delete(type);
                      else next.add(type);
                      return next;
                    })
                  }
                >
                  <h3 className="font-display text-lg font-medium">{type}</h3>
                  <span className="text-sm text-muted">{collapsed ? "▸" : "▾"}</span>
                </button>
                {!collapsed ? (
                  <div className="grid gap-4 border-t border-border px-4 py-4 lg:grid-cols-3">
                    {STRESS_TEST_PATHS.filter((p) => selectedPaths.has(p)).map((path) => (
                      <div key={path} className="space-y-2">
                        <p className="text-sm font-medium">{STRESS_TEST_PATH_LABELS[path]}</p>
                        {typeRuns
                          .filter((r) => r.path === path)
                          .sort((a, b) => a.runIndex - b.runIndex)
                          .map((run) => (
                            <RunCard
                              key={run.id}
                              run={run}
                              tagRepeatabilityByName={tagRepeatabilityByName}
                            />
                          ))}
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-lg font-medium">Overall stats</h3>
              <button
                type="button"
                disabled={!currentSaved}
                onClick={handleExport}
                className="rounded-full border border-border px-3 py-1 text-xs hover:bg-card disabled:opacity-50"
              >
                Export
              </button>
            </div>
            <SummaryTable rows={aggregated.byTypePath} />
            {aggregated.byPath.length > 0 ? (
              <>
                <p className="mt-4 text-xs font-medium text-muted">Summary by path</p>
                <SummaryTable rows={aggregated.byPath} />
                <CostChart byPath={aggregated.byPath} />
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
