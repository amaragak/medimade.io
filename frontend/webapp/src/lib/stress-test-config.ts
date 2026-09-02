/** Fixed target duration for all stress-test runs (minutes). */
export const STRESS_TEST_TARGET_MINUTES = 20;

/** Max in-flight script generations during a batch run. */
export const STRESS_TEST_CONCURRENCY_LIMIT = 6;

/** Claude Sonnet pricing is applied via claude-pricing.ts (USD). */
export const STRESS_TEST_USD_TO_GBP = 0.79;

/** Fish Audio estimated rate — custom TTS only (USD per character). */
export const STRESS_TEST_FISH_AUDIO_USD_PER_CHARACTER = 0.000015;

/** Max saved stress-test runs in browser localStorage. */
export const STRESS_TEST_MAX_SAVED_RUNS = 5;

export const STRESS_TEST_STORAGE_KEY = "medimade-stress-test-runs";

export const STRESS_TEST_PATHS = ["v1", "v2", "v3"] as const;
export type StressTestPath = (typeof STRESS_TEST_PATHS)[number];

export const STRESS_TEST_PATH_LABELS: Record<StressTestPath, string> = {
  v1: "V1",
  v2: "V2",
  v3: "V3",
};
