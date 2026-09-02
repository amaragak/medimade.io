import {
  eligibleLengthTiers,
  lengthTierSelectionWeights,
  type ScriptLengthTier,
} from "./script-segment-tags";
import {
  averageTextMetrics,
  speechSecondsFromWordCount,
  textContentMetrics,
  type TextContentMetrics,
} from "./script-text-metrics";
import type { ScriptSegmentScope } from "./script-segment-tags";
import type { FleetScriptWordTargets } from "./script-duration-planning-prompt";

export type SegmentTagTierAverage = {
  tier: import("./script-segment-tags").ScriptLengthTier | "all";
  avgWordCount: number;
  avgSyllableCount: number;
  variantCount: number;
};

export type SegmentTagForPrompt = {
  name: string;
  scope: ScriptSegmentScope;
  types: string[];
  description?: string;
  repeatability?: import("./script-segment-tags").ScriptSegmentRepeatability;
  sampleVariants: string[];
  tierAverages: SegmentTagTierAverage[];
};

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
  scope: SegmentTagForPrompt["scope"];
  types: string[];
  lengthTiered: boolean;
  description?: string;
  repeatability?: SegmentTagForPrompt["repeatability"];
};

export function computeTierAveragesForVariants(
  variants: VariantLike[],
  lengthTiered: boolean,
): {
  byTier: Partial<Record<ScriptLengthTier, SegmentTierAverageMetrics>>;
  allTiers?: SegmentTierAverageMetrics;
} {
  if (variants.length === 0) {
    return { byTier: {} };
  }

  if (!lengthTiered) {
    const samples = variants.map((v) => textContentMetrics(v.text));
    const avg = averageTextMetrics(samples);
    if (!avg) return { byTier: {} };
    return {
      byTier: {},
      allTiers: {
        tier: "all",
        variantCount: variants.length,
        ...avg,
      },
    };
  }

  const byTier: Partial<Record<ScriptLengthTier, SegmentTierAverageMetrics>> = {};
  for (const tier of ["short", "medium", "long"] as ScriptLengthTier[]) {
    const tierVariants = variants.filter((v) => v.lengthTier === tier);
    if (tierVariants.length === 0) continue;
    const samples = tierVariants.map((v) => textContentMetrics(v.text));
    const avg = averageTextMetrics(samples);
    if (!avg) continue;
    byTier[tier] = {
      tier,
      variantCount: tierVariants.length,
      ...avg,
    };
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
    out[tag.name] = {
      lengthTiered: tag.lengthTiered,
      byTier,
      allTiers,
    };
  }
  return out;
}

/** Weighted average across eligible tiers at target duration (matches length-tier selection bias). */
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
  /** When set and > 0, treated as ground truth for a rendered pick. */
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

export function buildSegmentTagsForGenerationPrompt(params: {
  tags: TagMetaLike[];
  variantsByTag: Record<string, VariantLike[]>;
}): SegmentTagForPrompt[] {
  const index = buildSegmentTagMetricsIndex(params);
  return params.tags.map((t) => {
    const entry = index[t.name];
    const tierAverages: SegmentTagForPrompt["tierAverages"] = [];

    if (entry?.allTiers) {
      tierAverages.push({
        tier: "all",
        avgWordCount: entry.allTiers.wordCount,
        avgSyllableCount: entry.allTiers.syllableCount,
        variantCount: entry.allTiers.variantCount,
      });
    } else if (entry) {
      for (const tier of ["short", "medium", "long"] as ScriptLengthTier[]) {
        const m = entry.byTier[tier];
        if (!m) continue;
        tierAverages.push({
          tier,
          avgWordCount: m.wordCount,
          avgSyllableCount: m.syllableCount,
          variantCount: m.variantCount,
        });
      }
    }

    const variants = params.variantsByTag[t.name] ?? [];
    return {
      name: t.name,
      scope: t.scope,
      types: t.types,
      description: t.description?.trim() || undefined,
      repeatability: t.repeatability,
      sampleVariants: variants.slice(0, 2).map((v) => v.text),
      tierAverages,
    };
  });
}

function formatTierMetricsLine(
  m: SegmentTagForPrompt["tierAverages"][number],
): string {
  if (m.tier === "all") {
    return `all variants (~${m.avgWordCount} words, ~${m.avgSyllableCount} syllables; n=${m.variantCount})`;
  }
  return `${m.tier}: ~${m.avgWordCount} words, ~${m.avgSyllableCount} syllables (n=${m.variantCount})`;
}

export function formatSegmentTagMetricsForPrompt(
  tag: Pick<SegmentTagForPrompt, "name" | "tierAverages">,
): string | null {
  if (!tag.tierAverages.length) return null;
  return `  Avg length: ${tag.tierAverages.map(formatTierMetricsLine).join("; ")}`;
}

export function scriptLabSegmentDurationBudgetAppendix(params: {
  targetMinutes: number;
  speechSpeed: number;
  wordTargets: FleetScriptWordTargets;
}): string {
  const { targetMinutes, speechSpeed, wordTargets } = params;
  const wpm = wordTargets.impliedWpmActive;
  const Tsec = wordTargets.stemSeconds;
  const typicalPause = wordTargets.pauseSeconds;

  return [
    "",
    "### Structured beats — duration budgeting (segment tags + custom text)",
    "Your `beats[]` output must fit the same voice-stem budget as a free-form script. **Tag beats consume speaking time** once filled from the library — they are not free.",
    "",
    "**Total spoken words (planning estimate):**",
    "`spoken_words_total = Σ words in each custom beat's text + Σ avgWordCount for each library tag beat`",
    "",
    "For each `{ custom: false, tag: \"TAG_NAME\" }` beat, add that tag's **average word count** from the library listing above:",
    "- Length-tiered tags: use the tier row that matches how long that moment should be at this target duration (eligible tiers at "
      + `**${targetMinutes}** min: **${eligibleLengthTiers(targetMinutes).join(" / ")}** — 2 min short only; 5 min short or medium; 10 min medium; 20 min long).`,
    "- Non-tiered tags: use the **all variants** average.",
    "",
    "For each `{ custom: true, text: \"…\" }` beat, count the words in `text` directly (ignore `[[PAUSE …]]` markers inside custom text — those add silence separately).",
    "",
    "**Stem seconds (same formula as free-form scripts):**",
    "`stem_seconds ≈ pause_seconds_total + (spoken_words_total × 60 ÷ (wpm_active × Fish_speed))`",
    "",
    `For this job: **wpm_active ≈ ${wpm}**, **Fish_speed ≈ ${speechSpeed}**, target stem **~${Tsec} s** (~${targetMinutes} min), typical pause share **~${(wordTargets.pauseShare * 100).toFixed(0)}%** (~${typicalPause} s in pause beats/markers).`,
    `Center spoken-word budget **~${wordTargets.center}** words (band ${wordTargets.min}–${wordTargets.max}) **including** all tag-beat averages you plan to use — not custom text alone.`,
    "",
    "When adding many library tag beats, increase tag-beat count in your mental budget or trim custom prose so the sum still lands near the target.",
  ].join("\n");
}
