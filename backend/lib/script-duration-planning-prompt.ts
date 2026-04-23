const DEFAULT_IMPLIED_WPM_ACTIVE = 140;
/**
 * Fraction of voice stem assumed to be explicit `[[PAUSE …]]` when
 * `MEDITATION_MEDIAN_PAUSE_SHARE` is not set (tune from analytics median pause / stem).
 */
const DEFAULT_ASSUMED_PAUSE_SHARE = 0.33;
const DEFAULT_WORD_BAND_FRACTION = 0.12;

function parsePositiveFloat(s: string | undefined, fallback: number): number {
  if (!s?.trim()) return fallback;
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Optional 0–1 pause share from fleet analytics (median pause seconds / voice stem seconds). */
function parsePauseShareFromEnv(s: string | undefined): number | null {
  if (!s?.trim()) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0 || n > 0.95) return null;
  return n;
}

function effectivePauseShare(): number {
  const fromEnv = parsePauseShareFromEnv(process.env.MEDITATION_MEDIAN_PAUSE_SHARE);
  if (fromEnv != null) return clamp(fromEnv, 0.08, 0.75);
  return DEFAULT_ASSUMED_PAUSE_SHARE;
}

function wordBandFraction(): number {
  const raw = process.env.MEDITATION_SCRIPT_WORD_BAND?.trim();
  if (!raw) return DEFAULT_WORD_BAND_FRACTION;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0.05 || n > 0.35) return DEFAULT_WORD_BAND_FRACTION;
  return n;
}

function normalizeSpeechSpeed(s: number | undefined): number {
  if (typeof s !== "number" || !Number.isFinite(s) || s <= 0) return 1;
  return clamp(s, 0.25, 2.5);
}

export type FleetScriptWordTargets = {
  min: number;
  max: number;
  center: number;
  stemSeconds: number;
  pauseSeconds: number;
  pauseShare: number;
  impliedWpmActive: number;
  speechSpeed: number;
};

/**
 * Spoken-word band for the script prompt from fleet-shaped heuristics:
 * stem ≈ pause_seconds + active_speech_seconds, with active ≈ (spoken_words × 60) / (wpm × speed).
 *
 * - `MEDITATION_IMPLIED_WPM_ACTIVE`: median “words per active speech minute” from analytics.
 * - `MEDITATION_MEDIAN_PAUSE_SHARE`: median (sum pauses / stem) from analytics; if unset, 0.33.
 * - `MEDITATION_SCRIPT_WORD_BAND`: half-width fraction around center (default 0.12 → ±12%).
 */
export function getFleetScriptWordTargets(params: {
  targetMinutes: number;
  speechSpeed: number;
}): FleetScriptWordTargets {
  const speechSpeed = normalizeSpeechSpeed(params.speechSpeed);
  const targetMinutes =
    typeof params.targetMinutes === "number" &&
    Number.isFinite(params.targetMinutes) &&
    params.targetMinutes > 0
      ? params.targetMinutes
      : 5;

  const impliedWpmActive = parsePositiveFloat(
    process.env.MEDITATION_IMPLIED_WPM_ACTIVE,
    DEFAULT_IMPLIED_WPM_ACTIVE,
  );
  const pauseShare = effectivePauseShare();
  const band = wordBandFraction();

  const stemSeconds = Math.round(targetMinutes * 60);
  const pauseSeconds = Math.round(stemSeconds * pauseShare);
  const activeSeconds = Math.max(0, stemSeconds - pauseSeconds);

  const center = Math.round(
    (activeSeconds / 60) * impliedWpmActive * speechSpeed,
  );
  const min = Math.max(40, Math.round(center * (1 - band)));
  const max = Math.max(min + 1, Math.round(center * (1 + band)));

  return {
    min,
    max,
    center,
    stemSeconds,
    pauseSeconds,
    pauseShare,
    impliedWpmActive,
    speechSpeed,
  };
}

/**
 * Appended to script-generation user prompts so the model balances explicit pauses vs spoken length
 * for a target voice-stem duration (Fish output before background beds).
 *
 * - Set `MEDITATION_IMPLIED_WPM_ACTIVE` to the analytics “median words per active speech minute”.
 * - Optionally set `MEDITATION_MEDIAN_PAUSE_SHARE` (0–1) from analytics.
 */
export function scriptDurationPlanningAppendix(
  targetMinutes: number,
  opts?: { speechSpeed?: number },
): string {
  const speechSpeed = normalizeSpeechSpeed(opts?.speechSpeed);
  const wpm = parsePositiveFloat(
    process.env.MEDITATION_IMPLIED_WPM_ACTIVE,
    DEFAULT_IMPLIED_WPM_ACTIVE,
  );
  const pauseShare = effectivePauseShare();
  const Tsec = Math.round(targetMinutes * 60);
  const typicalPause = Math.round(Tsec * pauseShare);
  const wordAtTypicalPause = Math.round(
    ((Tsec - typicalPause) * wpm * speechSpeed) / 60,
  );

  const lines = [
    "",
    "### Voice stem length (pauses + speaking time)",
    "The Fish **voice stem** (narration before background beds) lasts roughly:",
    "**sum of all `[[PAUSE …]]` seconds** plus **time spent speaking the words**.",
    "Pause markers are silent on the clock; only spoken words consume “active” time at your typical Fish pace.",
    "",
    `For about **${targetMinutes}** minute(s) of stem (~**${Tsec}** s total), plan pauses and spoken length so they land near that budget together.`,
    "",
    "**Thumb rule (seconds, rough):**",
    "`stem_seconds ≈ pause_seconds_total + (spoken_words × 60 ÷ (wpm_active × Fish_speed))`",
    "",
    `Use **wpm_active ≈ ${wpm}** (env \`MEDITATION_IMPLIED_WPM_ACTIVE\`) and **Fish_speed ≈ ${speechSpeed}** for this job.`,
    `At pause share **~${(pauseShare * 100).toFixed(0)}%** of stem (~**${typicalPause}** s in markers), one consistent point estimate is **~${wordAtTypicalPause}** spoken words (align the script’s word band with that trade-off).`,
    "If you add more explicit silence, trim spoken words; if you use fewer or shorter pauses, you need more words (or accept a shorter stem).",
    "",
    "Treat this as pacing guidance; content and technique still come first.",
  ];

  return lines.join("\n");
}
