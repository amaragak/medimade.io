import { claudeHaiku45UsdFromTokens } from "./claude-pricing";

/**
 * Fish Audio S2 billing (UTF-8 input to TTS), for analytics / margin estimates.
 * @see https://docs.fish.audio — priced per million UTF-8 bytes of script.
 */
export const FISH_USD_PER_UTF8_BYTE = 15 / 1_000_000;

const PAUSE_RE = /\[\[PAUSE\s+([0-9]+(?:\.[0-9])?)s?\]\]/gi;

export function sumPauseSecondsFromScript(script: string): number {
  if (!script) return 0;
  const re = new RegExp(PAUSE_RE.source, PAUSE_RE.flags);
  let total = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script)) !== null) {
    const p = parseFloat(m[1] ?? "0");
    if (Number.isFinite(p) && p > 0) total += p;
  }
  return total;
}

export function stripPauseMarkers(script: string): string {
  if (!script) return "";
  return script
    .replace(/\[\[PAUSE\s+([0-9]+(?:\.[0-9])?)s?\]\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

export function countWordsSpoken(plain: string): number {
  const t = plain.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

export function fishCostUsdFromBillableBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return bytes * FISH_USD_PER_UTF8_BYTE;
}

export type MeditationAnalyticsRow = {
  scriptUtf8Bytes?: number;
  durationSeconds?: number | null;
  pauseSecondsTotal?: number;
  spokenUtf8Bytes?: number;
  spokenWordCount?: number;
  speechSpeed?: number;
  referenceId?: string;
  s3Key?: string;
  createdAt?: string;
  title?: string;
  scriptText?: string;
  /** Measured from `/v1/messages` JSON: script generation (if server-side) + library metadata. */
  claudeHaiku45WorkerInputTokens?: number;
  claudeHaiku45WorkerOutputTokens?: number;
  /** Estimated coach chat: input via Anthropic `count_tokens`, output ~chars/4 per assistant turn. */
  claudeHaiku45ChatEstInputTokens?: number;
  claudeHaiku45ChatEstOutputTokens?: number;
  claudeModel?: string;
  [key: string]: unknown;
};

export function claudeUsdBreakdownFromRow(row: MeditationAnalyticsRow): {
  workerUsd: number;
  chatEstUsd: number;
  combinedUsd: number;
  hasChatEstimate: boolean;
} {
  const wi = row.claudeHaiku45WorkerInputTokens;
  const wo = row.claudeHaiku45WorkerOutputTokens;
  const workerUsd =
    typeof wi === "number" &&
    typeof wo === "number" &&
    Number.isFinite(wi) &&
    Number.isFinite(wo)
      ? claudeHaiku45UsdFromTokens(wi, wo)
      : 0;
  const ci = row.claudeHaiku45ChatEstInputTokens;
  const co = row.claudeHaiku45ChatEstOutputTokens;
  const hasChatEstimate =
    typeof ci === "number" &&
    typeof co === "number" &&
    Number.isFinite(ci) &&
    Number.isFinite(co);
  const chatEstUsd = hasChatEstimate ? claudeHaiku45UsdFromTokens(ci, co) : 0;
  return {
    workerUsd,
    chatEstUsd,
    combinedUsd: workerUsd + chatEstUsd,
    hasChatEstimate,
  };
}

export type EnrichedMeditationAnalytics = {
  raw: MeditationAnalyticsRow;
  billableUtf8Bytes: number;
  fishCostUsd: number;
  pauseSecondsTotal: number;
  spokenPlain: string;
  spokenUtf8Bytes: number;
  spokenWordCount: number;
  /** Voice stem duration (pre-background beds), seconds. */
  voiceStemSeconds: number | null;
  /** `max(0, voiceStemSeconds - pauseSecondsTotal)` — time not covered by explicit pause markers. */
  activeSpeechSeconds: number | null;
  activeSpeechMinutes: number | null;
  /** Words per minute of active speech time (pause markers subtracted from duration only). */
  wordsPerActiveSpeechMinute: number | null;
  /** UTF-8 bytes of spoken plain text per minute of active speech time. */
  bytesPerActiveSpeechMinute: number | null;
  /** Heuristic: legacy row if pause/spoken fields were inferred from truncated `scriptText`. */
  statsApproximate: boolean;
  claudeWorkerUsd: number;
  claudeChatEstUsd: number;
  claudeCombinedUsd: number;
  claudeHasChatEstimate: boolean;
};

export function enrichMeditationAnalytics(
  row: MeditationAnalyticsRow,
): EnrichedMeditationAnalytics | null {
  const billable =
    typeof row.scriptUtf8Bytes === "number" && Number.isFinite(row.scriptUtf8Bytes)
      ? row.scriptUtf8Bytes
      : NaN;
  const voiceStemSeconds =
    typeof row.durationSeconds === "number" && Number.isFinite(row.durationSeconds)
      ? row.durationSeconds
      : null;
  if (!Number.isFinite(billable) || billable <= 0 || voiceStemSeconds == null || voiceStemSeconds <= 0) {
    return null;
  }

  let statsApproximate = false;
  let pauseSecondsTotal =
    typeof row.pauseSecondsTotal === "number" && Number.isFinite(row.pauseSecondsTotal)
      ? row.pauseSecondsTotal
      : NaN;
  let spokenUtf8Bytes =
    typeof row.spokenUtf8Bytes === "number" && Number.isFinite(row.spokenUtf8Bytes)
      ? row.spokenUtf8Bytes
      : NaN;
  let spokenWordCount =
    typeof row.spokenWordCount === "number" && Number.isFinite(row.spokenWordCount)
      ? row.spokenWordCount
      : NaN;

  const scriptText = typeof row.scriptText === "string" ? row.scriptText : "";
  if (
    !Number.isFinite(pauseSecondsTotal) ||
    !Number.isFinite(spokenUtf8Bytes) ||
    !Number.isFinite(spokenWordCount)
  ) {
    statsApproximate = true;
    const plain = stripPauseMarkers(scriptText);
    pauseSecondsTotal = sumPauseSecondsFromScript(scriptText);
    spokenUtf8Bytes = utf8ByteLength(plain);
    spokenWordCount = countWordsSpoken(plain);
  }

  const activeSpeechSeconds = Math.max(
    0.05,
    voiceStemSeconds - pauseSecondsTotal,
  );
  const activeSpeechMinutes = activeSpeechSeconds / 60;
  const wordsPerActiveSpeechMinute = spokenWordCount / activeSpeechMinutes;
  const bytesPerActiveSpeechMinute = spokenUtf8Bytes / activeSpeechMinutes;
  const spokenPlain = statsApproximate
    ? stripPauseMarkers(scriptText)
    : "";

  const {
    workerUsd: claudeWorkerUsd,
    chatEstUsd: claudeChatEstUsd,
    combinedUsd: claudeCombinedUsd,
    hasChatEstimate: claudeHasChatEstimate,
  } = claudeUsdBreakdownFromRow(row);

  return {
    raw: row,
    billableUtf8Bytes: billable,
    fishCostUsd: fishCostUsdFromBillableBytes(billable),
    pauseSecondsTotal,
    spokenPlain,
    spokenUtf8Bytes,
    spokenWordCount,
    voiceStemSeconds,
    activeSpeechSeconds,
    activeSpeechMinutes,
    wordsPerActiveSpeechMinute,
    bytesPerActiveSpeechMinute,
    statsApproximate,
    claudeWorkerUsd,
    claudeChatEstUsd,
    claudeCombinedUsd,
    claudeHasChatEstimate,
  };
}

/** Solve A x = b for square A (Gaussian elimination + back substitution). */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  if (n === 0 || b.length !== n) return null;
  const aug = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(aug[r]![col]!) > Math.abs(aug[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(aug[pivot]![col]!) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = aug[col]!;
      aug[col] = aug[pivot]!;
      aug[pivot] = tmp;
    }
    for (let r = col + 1; r < n; r += 1) {
      const f = aug[r]![col]! / aug[col]![col]!;
      for (let c = col; c <= n; c += 1) {
        aug[r]![c]! -= f * aug[col]![c]!;
      }
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = aug[i]![n]!;
    for (let c = i + 1; c < n; c += 1) {
      sum -= aug[i]![c]! * x[c]!;
    }
    const d = aug[i]![i]!;
    if (Math.abs(d) < 1e-12) return null;
    x[i] = sum / d;
  }
  return x;
}

function mean(nums: number[]): number | null {
  const a = nums.filter((v) => Number.isFinite(v));
  if (a.length === 0) return null;
  return a.reduce((s, v) => s + v, 0) / a.length;
}

function medianSorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += xs[i]!;
    sumY += ys[i]!;
  }
  const mx = sumX / n;
  const my = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const d = Math.sqrt(denX) * Math.sqrt(denY);
  if (d < 1e-12) return null;
  return num / d;
}

export type VoiceStemDurationInsights = {
  n: number;
  /** Median voice stem length (seconds) across usable rows. */
  medianVoiceStemSeconds: number | null;
  /** Median sum of explicit [[PAUSE …]] seconds. */
  medianPauseSeconds: number | null;
  /** Median spoken word count (pause markers stripped). */
  medianSpokenWordCount: number | null;
  /** Median fraction of stem in explicit pauses: median of min(1, P/T) per row. */
  medianPauseShareOfStem: number | null;
  /** Median fraction of stem in active (non-pause) clock: median of A/T per row. */
  medianActiveShareOfStem: number | null;
  /** Median implied words per minute during active speech (Fish output, pause markers excluded from clock). */
  medianWordsPerActiveSpeechMinute: number | null;
  /** Median implied UTF-8 bytes per minute of active speech. */
  medianUtf8BytesPerActiveSpeechMinute: number | null;
  /** Mean absolute error (seconds) of planner T̂ = P + 60·W/R̂_w. */
  maeWordPlannerSeconds: number | null;
  /** Mean absolute percentage error of word planner (0–100). */
  mapeWordPlannerPct: number | null;
  /** Same using bytes: T̂ = P + 60·B/R̂_b. */
  maeBytePlannerSeconds: number | null;
  mapeBytePlannerPct: number | null;
  /** OLS on this fleet: T ≈ β₀ + β₁·P + β₂·W (seconds). Null if too few rows or singular. */
  olsPauseWords:
    | {
        beta0: number;
        beta1: number;
        beta2: number;
        maeSeconds: number;
        mapePct: number | null;
        r2: number | null;
      }
    | null;
  /** True when more than one distinct Fish speechSpeed appears in rows that have it. */
  speechSpeedVaries: boolean;
  /** Pearson r between Fish speechSpeed and implied WPM (paired rows); null if not enough data. */
  pearsonSpeechSpeedVsWpm: number | null;
};

/**
 * Rough spoken-word budget for a target voice-stem length, given total explicit pause seconds
 * and a fleet median “words per minute of active (non-pause) clock” from analytics.
 */
export function spokenWordBudgetForStemSeconds(
  voiceStemSeconds: number,
  pauseSecondsTotal: number,
  medianWordsPerActiveSpeechMinute: number,
): number {
  if (
    !Number.isFinite(voiceStemSeconds) ||
    voiceStemSeconds <= 0 ||
    !Number.isFinite(medianWordsPerActiveSpeechMinute) ||
    medianWordsPerActiveSpeechMinute <= 0
  ) {
    return 0;
  }
  const P = Math.max(0, pauseSecondsTotal);
  const active = Math.max(0, voiceStemSeconds - P);
  return Math.round((active * medianWordsPerActiveSpeechMinute) / 60);
}

/**
 * Plain-language blurb for humans or extra pre-prompt text: pause vs word trade-off for a target stem.
 */
export function buildScriptDurationPlanningBlurb(
  insights: VoiceStemDurationInsights,
  options: { targetStemMinutes?: number } = {},
): string {
  const targetStemMinutes = options.targetStemMinutes ?? 10;
  const T = Math.round(targetStemMinutes * 60);
  const wpm = insights.medianWordsPerActiveSpeechMinute;
  if (insights.n <= 0 || wpm == null || wpm <= 0) {
    return [
      "### Voice stem planning",
      "",
      "Voice stem length is approximately: **sum of [[PAUSE …]] seconds** plus **time Fish spends speaking the words**.",
      "Add more pause time and you need fewer words for the same stem length (and the opposite).",
      "This table does not yet have enough rows to infer a median speaking pace from your fleet.",
    ].join("\n");
  }

  const pauseScenariosSec = [120, 180, 240];
  const scenarioLines = pauseScenariosSec.map((P) => {
    const words = spokenWordBudgetForStemSeconds(T, P, wpm);
    const pm = Math.round(P / 60);
    return `- **~${P} s** (~${pm} min) in explicit pauses → aim **~${words}** spoken words for a **~${targetStemMinutes} min** stem (**~${T} s**).`;
  });

  const lines: string[] = [
    "### Voice stem planning (from medimade.io analytics)",
    "",
    "**Voice stem** = Fish narration before background beds. Its length is roughly:",
    "**pause markers summed** + **spoken words at your typical active pace**.",
    "",
    "**Formula (seconds, rough):**",
    "`stem_seconds ≈ pause_seconds_total + (spoken_words × 60 ÷ wpm_active)`",
    "",
    `This table’s median implied **wpm_active** is **~${wpm.toFixed(1)}** (words per minute of non-pause clock).`,
    "",
    `**Examples for ~${targetStemMinutes} min stem (~${T} s):**`,
    ...scenarioLines,
    "",
  ];

  if (
    insights.medianPauseSeconds != null &&
    insights.medianVoiceStemSeconds != null &&
    insights.medianPauseShareOfStem != null
  ) {
    const mp = Math.round(insights.medianPauseSeconds);
    const ms = Math.round(insights.medianVoiceStemSeconds);
    const mw =
      insights.medianSpokenWordCount != null
        ? Math.round(insights.medianSpokenWordCount)
        : null;
    lines.push(
      `**Fleet median (this table):** ~**${(ms / 60).toFixed(1)}** min stem, **~${mp} s** in explicit pauses (**~${(insights.medianPauseShareOfStem * 100).toFixed(0)}%** of stem), **~${mw ?? "—"}** spoken words.`,
    );
    lines.push("");
  }

  lines.push(
    "Pauses and words trade off: for a fixed stem budget, every extra second in `[[PAUSE …]]` is one less second of talking at your typical pace.",
  );

  return lines.join("\n");
}

/**
 * Derives how voice-stem length T (seconds) relates to explicit pauses P, spoken words W /
 * UTF-8 bytes B of spoken text, and implied pacing (WPM on “active speech” time).
 *
 * Definitions match analytics: active speech seconds A = max(ε, T − P); implied WPM = W / (A/60).
 */
export function computeVoiceStemDurationInsights(
  rows: EnrichedMeditationAnalytics[],
): VoiceStemDurationInsights {
  const usable = rows.filter(
    (e) =>
      e.voiceStemSeconds != null &&
      e.voiceStemSeconds > 0 &&
      e.spokenWordCount > 0 &&
      e.activeSpeechSeconds != null &&
      e.activeSpeechSeconds > 0 &&
      e.wordsPerActiveSpeechMinute != null &&
      Number.isFinite(e.wordsPerActiveSpeechMinute) &&
      e.bytesPerActiveSpeechMinute != null &&
      Number.isFinite(e.bytesPerActiveSpeechMinute) &&
      e.spokenUtf8Bytes > 0,
  );

  const n = usable.length;
  const wpms = usable
    .map((e) => e.wordsPerActiveSpeechMinute!)
    .filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b);
  const bpms = usable
    .map((e) => e.bytesPerActiveSpeechMinute!)
    .filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b);

  const medianWordsPerActiveSpeechMinute = medianSorted(wpms);
  const medianUtf8BytesPerActiveSpeechMinute = medianSorted(bpms);

  const pauseSecsSorted = usable
    .map((e) => e.pauseSecondsTotal)
    .filter((x) => Number.isFinite(x) && x >= 0)
    .sort((a, b) => a - b);
  const stemSecsSorted = usable
    .map((e) => e.voiceStemSeconds!)
    .filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b);
  const wordCountsSorted = usable
    .map((e) => e.spokenWordCount)
    .filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b);
  const pauseShareSorted = usable
    .map((e) => {
      const T = e.voiceStemSeconds!;
      if (!Number.isFinite(T) || T <= 0) return NaN;
      return Math.min(1, e.pauseSecondsTotal / T);
    })
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);
  const activeShareSorted = usable
    .map((e) => {
      const T = e.voiceStemSeconds!;
      const A = e.activeSpeechSeconds!;
      if (!Number.isFinite(T) || T <= 0 || !Number.isFinite(A)) return NaN;
      return A / T;
    })
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);

  const medianPauseSeconds = medianSorted(pauseSecsSorted);
  const medianVoiceStemSeconds = medianSorted(stemSecsSorted);
  const medianSpokenWordCount = medianSorted(wordCountsSorted);
  const medianPauseShareOfStem = medianSorted(pauseShareSorted);
  const medianActiveShareOfStem = medianSorted(activeShareSorted);

  let maeWordPlannerSeconds: number | null = null;
  let mapeWordPlannerPct: number | null = null;
  if (medianWordsPerActiveSpeechMinute != null && medianWordsPerActiveSpeechMinute > 0 && n > 0) {
    const Rw = medianWordsPerActiveSpeechMinute;
    const errAbs: number[] = [];
    const errPct: number[] = [];
    for (const e of usable) {
      const T = e.voiceStemSeconds!;
      const P = e.pauseSecondsTotal;
      const W = e.spokenWordCount;
      const tHat = P + (60 * W) / Rw;
      errAbs.push(Math.abs(T - tHat));
      if (T > 0) errPct.push((Math.abs(T - tHat) / T) * 100);
    }
    maeWordPlannerSeconds = mean(errAbs);
    mapeWordPlannerPct = errPct.length ? mean(errPct) : null;
  }

  let maeBytePlannerSeconds: number | null = null;
  let mapeBytePlannerPct: number | null = null;
  if (medianUtf8BytesPerActiveSpeechMinute != null && medianUtf8BytesPerActiveSpeechMinute > 0 && n > 0) {
    const Rb = medianUtf8BytesPerActiveSpeechMinute;
    const errAbs: number[] = [];
    const errPct: number[] = [];
    for (const e of usable) {
      const T = e.voiceStemSeconds!;
      const P = e.pauseSecondsTotal;
      const B = e.spokenUtf8Bytes;
      const tHat = P + (60 * B) / Rb;
      errAbs.push(Math.abs(T - tHat));
      if (T > 0) errPct.push((Math.abs(T - tHat) / T) * 100);
    }
    maeBytePlannerSeconds = mean(errAbs);
    mapeBytePlannerPct = errPct.length ? mean(errPct) : null;
  }

  let olsPauseWords: VoiceStemDurationInsights["olsPauseWords"] = null;
  if (n >= 5) {
    const y: number[] = [];
    const X: number[][] = [];
    for (const e of usable) {
      y.push(e.voiceStemSeconds!);
      X.push([1, e.pauseSecondsTotal, e.spokenWordCount]);
    }
    const k = 3;
    const XtX: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
    const Xty = Array(k).fill(0);
    for (let i = 0; i < k; i += 1) {
      for (let j = 0; j < k; j += 1) {
        let s = 0;
        for (const row of X) {
          s += row[i]! * row[j]!;
        }
        XtX[i]![j] = s;
      }
      let sy = 0;
      for (let r = 0; r < n; r += 1) {
        sy += X[r]![i]! * y[r]!;
      }
      Xty[i] = sy;
    }
    const beta = solveLinearSystem(XtX, Xty);
    if (beta && beta.length === 3) {
      const [beta0, beta1, beta2] = beta;
      const fitted = y.map((_, r) => beta0! + beta1! * X[r]![1]! + beta2! * X[r]![2]!);
      const maeSeconds = mean(y.map((yi, r) => Math.abs(yi - fitted[r]!))) ?? 0;
      const mapeList = y.map((yi, r) =>
        yi > 0 ? (Math.abs(yi - fitted[r]!) / yi) * 100 : NaN,
      ).filter((x) => Number.isFinite(x));
      const mapePct = mapeList.length ? mean(mapeList) : null;
      const yMean = mean(y);
      let ssTot = 0;
      let ssRes = 0;
      if (yMean != null) {
        for (let r = 0; r < n; r += 1) {
          ssTot += (y[r]! - yMean) ** 2;
          ssRes += (y[r]! - fitted[r]!) ** 2;
        }
      }
      const r2 = ssTot > 1e-9 ? 1 - ssRes / ssTot : null;
      olsPauseWords = {
        beta0: beta0!,
        beta1: beta1!,
        beta2: beta2!,
        maeSeconds,
        mapePct,
        r2: r2 != null && Number.isFinite(r2) ? r2 : null,
      };
    }
  }

  const speedVals = usable
    .map((e) => e.raw.speechSpeed)
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const uniqSpeed = new Set(speedVals);
  const speechSpeedVaries = uniqSpeed.size > 1;

  let pearsonSpeechSpeedVsWpm: number | null = null;
  const sx: number[] = [];
  const sy: number[] = [];
  for (const e of usable) {
    const sp = e.raw.speechSpeed;
    const wpm = e.wordsPerActiveSpeechMinute;
    if (typeof sp === "number" && Number.isFinite(sp) && wpm != null && Number.isFinite(wpm)) {
      sx.push(sp);
      sy.push(wpm);
    }
  }
  if (sx.length >= 3) {
    pearsonSpeechSpeedVsWpm = pearsonCorrelation(sx, sy);
  }

  return {
    n,
    medianVoiceStemSeconds,
    medianPauseSeconds,
    medianSpokenWordCount,
    medianPauseShareOfStem,
    medianActiveShareOfStem,
    medianWordsPerActiveSpeechMinute,
    medianUtf8BytesPerActiveSpeechMinute,
    maeWordPlannerSeconds,
    mapeWordPlannerPct,
    maeBytePlannerSeconds,
    mapeBytePlannerPct,
    olsPauseWords,
    speechSpeedVaries,
    pearsonSpeechSpeedVsWpm,
  };
}
