/** Client mirror of backend/lib/script-segment-tag-metrics.ts */
import {
  eligibleLengthTiers,
  lengthTierSelectionWeights,
  type ScriptLengthTier,
} from "@/lib/script-segment-tags";
import {
  averageTextMetrics,
  countWords,
  speechSecondsFromWordCount,
  textContentMetrics,
  type TextContentMetrics,
} from "@/lib/script-text-metrics";

export type SegmentTierAverageMetrics = TextContentMetrics & {
  tier: ScriptLengthTier | "all";
  variantCount: number;
};

export type SegmentTagMetricsIndex = Record<
  string,
  {
    lengthTiered: boolean;
    byTier: Partial<Record<ScriptLengthTier, SegmentTierAverageMetrics>>;
    allTiers?: SegmentTierAverageMetrics;
  }
>;

type VariantLike = {
  text: string;
  lengthTier?: ScriptLengthTier | null;
};

type TagMetaLike = {
  name: string;
  lengthTiered: boolean;
};

export function computeTierAveragesForVariants(
  variants: VariantLike[],
  lengthTiered: boolean,
): {
  byTier: Partial<Record<ScriptLengthTier, SegmentTierAverageMetrics>>;
  allTiers?: SegmentTierAverageMetrics;
} {
  if (variants.length === 0) return { byTier: {} };

  if (!lengthTiered) {
    const samples = variants.map((v) => textContentMetrics(v.text));
    const avg = averageTextMetrics(samples);
    if (!avg) return { byTier: {} };
    return {
      byTier: {},
      allTiers: { tier: "all", variantCount: variants.length, ...avg },
    };
  }

  const byTier: Partial<Record<ScriptLengthTier, SegmentTierAverageMetrics>> = {};
  for (const tier of ["short", "medium", "long"] as ScriptLengthTier[]) {
    const tierVariants = variants.filter((v) => v.lengthTier === tier);
    if (tierVariants.length === 0) continue;
    const avg = averageTextMetrics(tierVariants.map((v) => textContentMetrics(v.text)));
    if (!avg) continue;
    byTier[tier] = { tier, variantCount: tierVariants.length, ...avg };
  }
  return { byTier };
}

export function buildSegmentTagMetricsIndex(params: {
  tags: TagMetaLike[];
  variantsByTag: Record<string, VariantLike[]>;
}): SegmentTagMetricsIndex {
  const out: SegmentTagMetricsIndex = {};
  for (const tag of params.tags) {
    const variants = params.variantsByTag[tag.name] ?? [];
    const { byTier, allTiers } = computeTierAveragesForVariants(
      variants,
      tag.lengthTiered,
    );
    out[tag.name] = { lengthTiered: tag.lengthTiered, byTier, allTiers };
  }
  return out;
}

export function budgetMetricsForTagAtTarget(
  tagName: string,
  targetMinutes: number,
  index: SegmentTagMetricsIndex,
): TextContentMetrics | null {
  const entry = index[tagName];
  if (!entry) return null;

  if (!entry.lengthTiered) {
    const all = entry.allTiers;
    return all
      ? { wordCount: all.wordCount, syllableCount: all.syllableCount }
      : null;
  }

  const eligible = eligibleLengthTiers(targetMinutes);
  const weights = lengthTierSelectionWeights(targetMinutes);
  let wordSum = 0;
  let syllableSum = 0;
  let weightSum = 0;

  for (const tier of eligible) {
    const m = entry.byTier[tier];
    if (!m || m.variantCount <= 0) continue;
    const w = weights[tier] ?? 0;
    if (w <= 0) continue;
    wordSum += m.wordCount * w;
    syllableSum += m.syllableCount * w;
    weightSum += w;
  }

  if (weightSum <= 0) {
    const fallback = entry.byTier.medium ?? entry.byTier.long ?? entry.byTier.short;
    return fallback
      ? { wordCount: fallback.wordCount, syllableCount: fallback.syllableCount }
      : null;
  }

  return {
    wordCount: Math.round((wordSum / weightSum) * 10) / 10,
    syllableCount: Math.round((syllableSum / weightSum) * 10) / 10,
  };
}

export function estimateTagBeatSpeechSeconds(params: {
  tag: string;
  targetMinutes: number;
  metricsIndex: SegmentTagMetricsIndex;
  speechSpeed: number;
  wpmActive?: number;
  audioDurationSeconds?: number | null;
}): number {
  if (params.audioDurationSeconds != null && params.audioDurationSeconds > 0) {
    return params.audioDurationSeconds;
  }
  const budget = budgetMetricsForTagAtTarget(
    params.tag,
    params.targetMinutes,
    params.metricsIndex,
  );
  if (!budget) return 0;
  return speechSecondsFromWordCount(
    budget.wordCount,
    params.speechSpeed,
    params.wpmActive,
  );
}

export function estimateBeatsBudgetWordCount(params: {
  beats: Array<{
    beatType: string;
    custom: boolean;
    tag?: string;
    text?: string;
    pauseBand?: string;
  }>;
  targetMinutes: number;
  metricsIndex: SegmentTagMetricsIndex;
}): {
  customWordCount: number;
  segmentWordCount: number;
  totalSpokenWordCount: number;
} {
  let customWordCount = 0;
  let segmentWordCount = 0;

  for (const beat of params.beats) {
    if (beat.beatType === "pause") continue;
    if (beat.custom && beat.text?.trim()) {
      customWordCount += countWordsInCustomBeat(beat.text);
      continue;
    }
    if (!beat.custom && beat.tag) {
      const m = budgetMetricsForTagAtTarget(
        beat.tag,
        params.targetMinutes,
        params.metricsIndex,
      );
      if (m) segmentWordCount += m.wordCount;
    }
  }

  return {
    customWordCount,
    segmentWordCount,
    totalSpokenWordCount: customWordCount + segmentWordCount,
  };
}

function countWordsInCustomBeat(text: string): number {
  const prose = text.replace(/\[\[PAUSE\s+[^\]]+\]\]/gi, " ");
  return countWords(prose);
}
