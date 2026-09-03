import {
  buildPreviewContextTags,
  estimateScriptLabBeatsDurationSeconds,
  estimateScriptLabBeatsTextUtf8Bytes,
  type ScriptLabTagMeta,
  type ScriptLabVariant,
} from "@/lib/script-lab-estimate";
import {
  customTextFromBeats,
  renderBeatsToScript,
  type ScriptLabBeat,
  type ScriptLabBeatDuplicateWarning,
} from "@/lib/script-lab-beats";
import { createSegmentVariantPickerForBeats } from "@/lib/script-segment-variant-select";
import { STRESS_TEST_TARGET_MINUTES } from "@/lib/stress-test-config";
import {
  buildLlmCostBreakdownGbp,
  buildScriptLabCostSummary,
  characterCountsFromBeats,
  ttsCostGbpFromCharacterCount,
  totalEstCostGbp,
  type LlmCostBreakdownGbp,
  type ScriptLabCostSummary,
  type ScriptLabUsageBreakdownEntry,
  type TokenUsage,
} from "@/lib/script-lab-cost";
import type { ScriptLabV3Meta } from "@/components/script-lab-v3-preview";
import { computeV3SubstitutionStats } from "@/components/script-lab-v3-preview";

export type StressTestSubstitutionBreakdown = {
  matched: number;
  keptCustom: number;
  promoted: number;
  discarded: number;
};

function characterCounts(params: {
  beats: ScriptLabBeat[];
  picksByTag: Record<string, string>;
  variantsByTag: Record<string, ScriptLabVariant[]>;
  tagMetaByName: Record<string, ScriptLabTagMeta>;
  meditationType: string;
  contextTags: string[];
}): { customCharCount: number; segmentCharCount: number } {
  return characterCountsFromBeats({
    ...params,
    targetMinutes: STRESS_TEST_TARGET_MINUTES,
  });
}

export type StressTestRunStats = {
  estDurationMs: number;
  targetDurationMs: number;
  pauseMs: number;
  segmentMs: number;
  customWordCount: number;
  customPct: number | null;
  segmentsUsed: number;
  promosCount: number;
  warningsCount: number;
  llmCostGBP: LlmCostBreakdownGbp;
  costSummary: ScriptLabCostSummary | null;
  totalUsage: TokenUsage;
  estTtsCostGBP: number;
  estCacheSavingGBP: number;
  totalEstCostGBP: number;
  substitutionBreakdown?: StressTestSubstitutionBreakdown;
  customCharCount: number;
  segmentCharCount: number;
};

function beatsNeedIntelligentFill(beats: ScriptLabBeat[]): boolean {
  return beats.some(
    (b) =>
      !b.custom &&
      b.beatType !== "pause" &&
      Boolean(b.tag?.trim()) &&
      !b.text?.trim(),
  );
}

function countSegmentBeats(beats: ScriptLabBeat[]): number {
  return beats.filter((b) => !b.custom && b.beatType !== "pause" && b.tag).length;
}

export function applyFillPicksToBeats(params: {
  beats: ScriptLabBeat[];
  picksByBeatIndex: Record<number, string>;
  picksByTag: Record<string, string>;
  variantsByTag: Record<string, ScriptLabVariant[]>;
  tagMetaByName: Record<string, ScriptLabTagMeta>;
  meditationType: string;
  contextTags: string[];
}): { beats: ScriptLabBeat[]; picksByTag: Record<string, string> } {
  const preferredByBeat: Record<number, string> = { ...params.picksByBeatIndex };
  const picker = createSegmentVariantPickerForBeats({
    beats: params.beats,
    variantsByTag: params.variantsByTag,
    tagMetaByName: params.tagMetaByName,
    targetMinutes: STRESS_TEST_TARGET_MINUTES,
    meditationType: params.meditationType,
    contextTags: params.contextTags,
    preferredVariantIdByBeatIndex: preferredByBeat,
    preferredVariantIdByTag: params.picksByTag,
    random: false,
  });

  const picksByTag =
    Object.keys(params.picksByTag).length > 0
      ? params.picksByTag
      : picker.picksByTag;

  const filled = params.beats.map((beat, index) => {
    if (beat.custom || beat.beatType === "pause" || !beat.tag || beat.text?.trim()) {
      return beat;
    }
    const text = picker.pickVariantText(beat.tag, index);
    return text ? { ...beat, text } : beat;
  });

  return { beats: filled, picksByTag };
}

export function computeStressTestRunStats(params: {
  beats: ScriptLabBeat[];
  picksByTag: Record<string, string>;
  beatWarnings: ScriptLabBeatDuplicateWarning[];
  v3Meta?: ScriptLabV3Meta | null;
  voiceModelId: string;
  meditationType: string;
  contextTags: string[];
  variantsByTag: Record<string, ScriptLabVariant[]>;
  tagMetaByName: Record<string, ScriptLabTagMeta>;
  generationUsage: TokenUsage | null;
  fillUsage?: TokenUsage | null;
  usageBreakdown?: ScriptLabUsageBreakdownEntry[];
  firstPassUsage?: TokenUsage | null;
  finalScriptText?: string;
}): StressTestRunStats {
  const duration = estimateScriptLabBeatsDurationSeconds({
    beats: params.beats,
    targetMinutes: STRESS_TEST_TARGET_MINUTES,
    modelId: params.voiceModelId,
    meditationType: params.meditationType,
    contextTags: params.contextTags,
    variantsByTag: params.variantsByTag,
    tagMetaByName: params.tagMetaByName,
    picksByTag: params.picksByTag,
  });

  const textStats = estimateScriptLabBeatsTextUtf8Bytes({
    beats: params.beats,
    targetMinutes: STRESS_TEST_TARGET_MINUTES,
    meditationType: params.meditationType,
    contextTags: params.contextTags,
    variantsByTag: params.variantsByTag,
    tagMetaByName: params.tagMetaByName,
    picksByTag: params.picksByTag,
  });

  const { customCharCount, segmentCharCount } = characterCounts({
    beats: params.beats,
    picksByTag: params.picksByTag,
    variantsByTag: params.variantsByTag,
    tagMetaByName: params.tagMetaByName,
    meditationType: params.meditationType,
    contextTags: params.contextTags,
  });

  const llmCostGBP = buildLlmCostBreakdownGbp({
    generationUsage: params.generationUsage,
    fillUsage: params.fillUsage,
    usageBreakdown: params.usageBreakdown,
  });

  const generationLabel =
    params.v3Meta != null
      ? "Generation (pass 1 + classification + substitution)"
      : "Generation (incl. verification)";

  const costSummary = buildScriptLabCostSummary({
    generationUsage: params.generationUsage,
    fillUsage: params.fillUsage,
    usageBreakdown: params.usageBreakdown,
    firstPassUsage: params.firstPassUsage,
    finalScriptText:
      params.finalScriptText ??
      renderStressTestScript({
        beats: params.beats,
        picksByTag: params.picksByTag,
        variantsByTag: params.variantsByTag,
        tagMetaByName: params.tagMetaByName,
        meditationType: params.meditationType,
        contextTags: params.contextTags,
      }),
    generationLabel,
    fishCustomChars: customCharCount,
    fishSegmentChars: segmentCharCount,
  });

  const estTtsCostGBP = ttsCostGbpFromCharacterCount(customCharCount);
  const estCacheSavingGBP = ttsCostGbpFromCharacterCount(segmentCharCount);

  const substitutionBreakdown = params.v3Meta?.decisions?.length
    ? computeV3SubstitutionStats(params.v3Meta.decisions)
    : undefined;

  return {
    estDurationMs: Math.round(duration.totalSeconds * 1000),
    targetDurationMs: STRESS_TEST_TARGET_MINUTES * 60 * 1000,
    pauseMs: Math.round(duration.pauseSeconds * 1000),
    segmentMs: Math.round(duration.segmentSeconds * 1000),
    customWordCount: duration.customWordCount,
    customPct: textStats.customRatio != null ? textStats.customRatio * 100 : null,
    segmentsUsed: countSegmentBeats(params.beats),
    promosCount: params.v3Meta?.promotedVariantIds?.length ?? 0,
    warningsCount: params.beatWarnings.length,
    llmCostGBP,
    costSummary,
    totalUsage: costSummary?.totalUsage ?? { input_tokens: 0, output_tokens: 0 },
    estTtsCostGBP,
    estCacheSavingGBP,
    totalEstCostGBP: totalEstCostGbp({
      llmTotal: llmCostGBP.total,
      estTtsCost: estTtsCostGBP,
    }),
    substitutionBreakdown,
    customCharCount,
    segmentCharCount,
  };
}

export function renderStressTestScript(params: {
  beats: ScriptLabBeat[];
  picksByTag: Record<string, string>;
  variantsByTag: Record<string, ScriptLabVariant[]>;
  tagMetaByName: Record<string, ScriptLabTagMeta>;
  meditationType: string;
  contextTags: string[];
}): string {
  const picker = createSegmentVariantPickerForBeats({
    beats: params.beats,
    variantsByTag: params.variantsByTag,
    tagMetaByName: params.tagMetaByName,
    targetMinutes: STRESS_TEST_TARGET_MINUTES,
    meditationType: params.meditationType,
    contextTags: params.contextTags,
    preferredVariantIdByTag: params.picksByTag,
    random: false,
  });
  return renderBeatsToScript(params.beats, picker.pickVariantText);
}

export function buildPreviewContextForType(
  meditationType: string,
  userText: string,
): string[] {
  return buildPreviewContextTags({
    flow: "by-type",
    meditationStyle: meditationType,
    userTextSample: userText,
  });
}

export { beatsNeedIntelligentFill, countSegmentBeats, customTextFromBeats };
