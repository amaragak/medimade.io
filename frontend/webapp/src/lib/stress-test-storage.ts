import type { MeditationStyleLabel } from "@/lib/meditation-style-intake";
import type { StyleQuestionAnswers } from "@/lib/meditation-style-intake";
import {
  STRESS_TEST_MAX_SAVED_RUNS,
  STRESS_TEST_STORAGE_KEY,
  STRESS_TEST_TARGET_MINUTES,
  type StressTestPath,
} from "@/lib/stress-test-config";
import type { StressTestRunResult } from "@/lib/stress-test-runner";

export type SavedStressTestRun = {
  id: string;
  timestamp: string;
  label: string;
  config: {
    types: MeditationStyleLabel[];
    paths: StressTestPath[];
    runsPerType: number;
    duration: number;
    voiceModelId: string;
    useFixedInputs: boolean;
    customInputsByType?: Partial<Record<MeditationStyleLabel, StyleQuestionAnswers>>;
  };
  runs: StressTestRunResult[];
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadSavedStressTestRuns(): SavedStressTestRun[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STRESS_TEST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedStressTestRun[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStressTestRun(entry: SavedStressTestRun): SavedStressTestRun[] {
  if (!canUseStorage()) return [entry];
  const existing = loadSavedStressTestRuns().filter((r) => r.id !== entry.id);
  const next = [entry, ...existing].slice(0, STRESS_TEST_MAX_SAVED_RUNS);
  window.localStorage.setItem(STRESS_TEST_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function formatStressTestRunLabel(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return timestamp;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function createSavedStressTestRun(params: {
  config: SavedStressTestRun["config"];
  runs: StressTestRunResult[];
}): SavedStressTestRun {
  const timestamp = new Date().toISOString();
  return {
    id: timestamp,
    timestamp,
    label: formatStressTestRunLabel(timestamp),
    config: {
      ...params.config,
      duration: STRESS_TEST_TARGET_MINUTES,
    },
    runs: params.runs,
  };
}
