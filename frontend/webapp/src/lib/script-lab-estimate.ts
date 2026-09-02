import { FIXED_SPEECH_PREVIEW_SPEED } from "@/lib/speaker-sample-speed";
import {
  buildScriptLabContextTags,
} from "@/lib/script-constraint-tags";
import {
  SCRIPT_SEGMENT_TAG_RE,
  stripScriptSegmentTags,
  type ScriptLengthTier,
} from "@/lib/script-segment-tags";
import { sumPauseSecondsFromScript } from "@/lib/meditation-analytics";
import {
  customProseWithoutPauses,
  customTextFromBeats,
  pauseSecondsFromBeats,
  utf8ByteLength,
  type ScriptLabBeat,
} from "@/lib/script-lab-beats";
import {
  selectSegmentVariant,
  type SegmentTagMeta,
} from "@/lib/script-segment-variant-select";
import {
  buildSegmentTagMetricsIndex,
  budgetMetricsForTagAtTarget,
  estimateTagBeatSpeechSeconds,
} from "@/lib/script-segment-tag-metrics";
import { countWords } from "@/lib/script-text-metrics";

const DEFAULT_WPM = 140;

export type ScriptLabVariantAudio = {
  modelId: string;
  durationSeconds: number;
};

export type ScriptLabVariant = {
  variantId: string;
  text: string;
  lengthTier?: ScriptLengthTier | null;
  requiredConstraints?: string[];
  excludedConstraints?: string[];
  audio?: ScriptLabVariantAudio[];
};

export type ScriptLabTagMeta = SegmentTagMeta;

function buildMetricsIndexForEstimate(params: {
  variantsByTag: Record<string, ScriptLabVariant[]>;
  tagMetaByName?: Record<string, ScriptLabTagMeta>;
}) {
  const tagNames = new Set([
    ...Object.keys(params.variantsByTag),
    ...Object.keys(params.tagMetaByName ?? {}),
  ]);
  const tags = [...tagNames].map((name) => ({
    name,
    lengthTiered: params.tagMetaByName?.[name]?.lengthTiered ?? false,
  }));
  return buildSegmentTagMetricsIndex({
    tags,
    variantsByTag: params.variantsByTag,
  });
}

function speechSpeedForEstimate(): number {
  return FIXED_SPEECH_PREVIEW_SPEED;
}

function selectVariantForBeatTag(
  tag: string,
  params: {
    targetMinutes: number;
    meditationType?: string | null;
    contextTags?: string[];
    variantsByTag: Record<string, ScriptLabVariant[]>;
    tagMetaByName?: Record<string, ScriptLabTagMeta>;
    picksByTag?: Record<string, string>;
  },
  usedByTag: Map<string, string[]>,
): ScriptLabVariant | null {
  const alreadyUsed = usedByTag.get(tag) ?? [];
  const preferredId = params.picksByTag?.[tag];
  const preferredAlreadyUsed =
    preferredId != null && alreadyUsed.includes(preferredId);

  const picked = selectSegmentVariant({
    variants: params.variantsByTag[tag] ?? [],
    tagMeta: params.tagMetaByName?.[tag],
    tagName: tag,
    targetMinutes: params.targetMinutes,
    meditationType: params.meditationType ?? null,
    contextTags: params.contextTags ?? [],
    alreadyUsedVariantIds: alreadyUsed,
    preferredVariantId: preferredAlreadyUsed ? null : preferredId,
    random: false,
  });
  if (!picked) return null;
  usedByTag.set(tag, [...alreadyUsed, picked.variantId]);
  return picked;
}

export function pickRandomEligibleVariant(
  variants: ScriptLabVariant[],
  tagMeta: ScriptLabTagMeta | undefined,
  targetMinutes: number,
  meditationType?: string | null,
  contextTags?: string[],
): ScriptLabVariant | null {
  return selectSegmentVariant({
    variants,
    tagMeta,
    targetMinutes,
    meditationType,
    contextTags,
  });
}

export function estimateScriptLabDurationSeconds(params: {
  rawScript: string;
  targetMinutes: number;
  modelId: string;
  meditationType?: string | null;
  contextTags?: string[];
  variantsByTag: Record<string, ScriptLabVariant[]>;
  tagMetaByName?: Record<string, ScriptLabTagMeta>;
  picksByTag?: Record<string, string>;
}): {
  totalSeconds: number;
  pauseSeconds: number;
  segmentSeconds: number;
  customSpeechSeconds: number;
  customWordCount: number;
  segmentWordCount: number;
  totalSpokenWordCount: number;
} {
  const pauseSeconds = sumPauseSecondsFromScript(params.rawScript);
  const contextTags = params.contextTags ?? [];
  const metricsIndex = buildMetricsIndexForEstimate(params);
  const speechSpeed = speechSpeedForEstimate();
  let segmentSeconds = 0;
  let segmentWordCount = 0;
  const usedByTag = new Map<string, string[]>();
  const tagRe = new RegExp(SCRIPT_SEGMENT_TAG_RE.source, "g");

  for (const m of params.rawScript.matchAll(tagRe)) {
    const tag = m[1];
    if (!tag) continue;
    const variant = selectVariantForBeatTag(
      tag,
      {
        targetMinutes: params.targetMinutes,
        meditationType: params.meditationType ?? null,
        contextTags,
        variantsByTag: params.variantsByTag,
        tagMetaByName: params.tagMetaByName,
        picksByTag: params.picksByTag,
      },
      usedByTag,
    );
    const audio = variant?.audio?.find((a) => a.modelId === params.modelId);
    segmentSeconds += estimateTagBeatSpeechSeconds({
      tag,
      targetMinutes: params.targetMinutes,
      metricsIndex,
      speechSpeed,
      wpmActive: DEFAULT_WPM,
      audioDurationSeconds: audio?.durationSeconds,
    });
    const tierBudget = budgetMetricsForTagAtTarget(
      tag,
      params.targetMinutes,
      metricsIndex,
    );
    if (tierBudget) segmentWordCount += tierBudget.wordCount;
  }

  const customText = stripScriptSegmentTags(params.rawScript);
  const customWordCount = countWords(customText);
  const customSpeechSeconds = estimateWordsDurationSeconds(customWordCount);

  return {
    totalSeconds: pauseSeconds + segmentSeconds + customSpeechSeconds,
    pauseSeconds,
    segmentSeconds,
    customSpeechSeconds,
    customWordCount,
    segmentWordCount,
    totalSpokenWordCount: customWordCount + segmentWordCount,
  };
}

export function estimateScriptLabBeatsDurationSeconds(params: {
  beats: ScriptLabBeat[];
  targetMinutes: number;
  modelId: string;
  meditationType?: string | null;
  contextTags?: string[];
  variantsByTag: Record<string, ScriptLabVariant[]>;
  tagMetaByName?: Record<string, ScriptLabTagMeta>;
  picksByTag?: Record<string, string>;
}): {
  totalSeconds: number;
  pauseSeconds: number;
  segmentSeconds: number;
  customSpeechSeconds: number;
  customWordCount: number;
  segmentWordCount: number;
  totalSpokenWordCount: number;
} {
  const pauseSeconds = pauseSecondsFromBeats(params.beats);
  const contextTags = params.contextTags ?? [];
  const metricsIndex = buildMetricsIndexForEstimate(params);
  const speechSpeed = speechSpeedForEstimate();
  let segmentSeconds = 0;
  let segmentWordCount = 0;
  const usedByTag = new Map<string, string[]>();

  for (const beat of params.beats) {
    if (beat.beatType === "pause" || beat.custom || !beat.tag) continue;

    const variant = selectVariantForBeatTag(
      beat.tag,
      {
        targetMinutes: params.targetMinutes,
        meditationType: params.meditationType ?? null,
        contextTags,
        variantsByTag: params.variantsByTag,
        tagMetaByName: params.tagMetaByName,
        picksByTag: params.picksByTag,
      },
      usedByTag,
    );
    const audio = variant?.audio?.find((a) => a.modelId === params.modelId);
    segmentSeconds += estimateTagBeatSpeechSeconds({
      tag: beat.tag,
      targetMinutes: params.targetMinutes,
      metricsIndex,
      speechSpeed,
      wpmActive: DEFAULT_WPM,
      audioDurationSeconds: audio?.durationSeconds,
    });
    const tierBudget = budgetMetricsForTagAtTarget(
      beat.tag,
      params.targetMinutes,
      metricsIndex,
    );
    if (tierBudget) segmentWordCount += tierBudget.wordCount;
  }

  const customPlain = customTextFromBeats(params.beats);
  const customWordCount = countWords(customPlain);
  const customSpeechSeconds = estimateWordsDurationSeconds(customWordCount);

  return {
    totalSeconds: pauseSeconds + segmentSeconds + customSpeechSeconds,
    pauseSeconds,
    segmentSeconds,
    customSpeechSeconds,
    customWordCount,
    segmentWordCount,
    totalSpokenWordCount: customWordCount + segmentWordCount,
  };
}

function pickSegmentVariantForTag(
  tag: string,
  params: {
    targetMinutes: number;
    meditationType?: string | null;
    contextTags?: string[];
    variantsByTag: Record<string, ScriptLabVariant[]>;
    tagMetaByName?: Record<string, ScriptLabTagMeta>;
    picksByTag?: Record<string, string>;
  },
  usedByTag: Map<string, string[]>,
): ScriptLabVariant | null {
  return selectVariantForBeatTag(tag, params, usedByTag);
}

export function estimateScriptLabBeatsTextUtf8Bytes(params: {
  beats: ScriptLabBeat[];
  targetMinutes: number;
  meditationType?: string | null;
  contextTags?: string[];
  variantsByTag: Record<string, ScriptLabVariant[]>;
  tagMetaByName?: Record<string, ScriptLabTagMeta>;
  picksByTag?: Record<string, string>;
}): {
  customUtf8Bytes: number;
  totalUtf8Bytes: number;
  customRatio: number | null;
} {
  let customUtf8Bytes = 0;
  let totalUtf8Bytes = 0;
  const usedByTag = new Map<string, string[]>();

  for (const beat of params.beats) {
    if (beat.beatType === "pause") continue;

    if (beat.custom && beat.text?.trim()) {
      const prose = customProseWithoutPauses(beat.text);
      if (!prose) continue;
      const bytes = utf8ByteLength(prose);
      customUtf8Bytes += bytes;
      totalUtf8Bytes += bytes;
      continue;
    }

    if (!beat.custom && beat.tag) {
      const variant = pickSegmentVariantForTag(beat.tag, params, usedByTag);
      const prose = variant?.text.trim() ?? "";
      if (prose) totalUtf8Bytes += utf8ByteLength(prose);
    }
  }

  return {
    customUtf8Bytes,
    totalUtf8Bytes,
    customRatio:
      totalUtf8Bytes > 0 ? customUtf8Bytes / totalUtf8Bytes : null,
  };
}

export function formatUtf8ByteCount(bytes: number): string {
  return `${bytes.toLocaleString()} B`;
}

export function formatCustomTextRatio(ratio: number | null): string {
  if (ratio == null) return "—";
  return `${(ratio * 100).toFixed(1)}% custom`;
}

function estimateWordsDurationSeconds(wordCount: number): number {
  const wpm = DEFAULT_WPM * FIXED_SPEECH_PREVIEW_SPEED;
  if (wordCount <= 0 || wpm <= 0) return 0;
  return (wordCount / wpm) * 60;
}

export function formatDurationClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return `${m}m ${r}s`;
}

export function scopeLabel(
  scope: "general" | "types",
  types: string[],
): string {
  if (scope === "general") return "General";
  return types.length > 0 ? types.join(", ") : "Types (none set)";
}

export function lengthTierLabel(tier: ScriptLengthTier | null | undefined): string {
  if (tier === "short") return "Short";
  if (tier === "medium") return "Medium";
  if (tier === "long") return "Long";
  return "—";
}

export function resolvedPreviewMeditationType(params: {
  flow: "by-type" | "guide-chat" | "journal" | "single-prompt";
  meditationStyle: string;
}): string | null {
  if (params.flow === "by-type") return params.meditationStyle.trim() || null;
  return null;
}

export function buildPreviewContextTags(params: {
  flow: "by-type" | "guide-chat" | "journal" | "single-prompt";
  meditationStyle: string;
  userTextSample: string;
}): string[] {
  const meditationType = resolvedPreviewMeditationType({
    flow: params.flow,
    meditationStyle: params.meditationStyle,
  });
  return buildScriptLabContextTags({
    meditationType,
    userText: params.userTextSample.trim(),
  });
}
