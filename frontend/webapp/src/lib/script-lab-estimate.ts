import { FIXED_SPEECH_PREVIEW_SPEED } from "@/lib/speaker-sample-speed";
import {
  buildScriptLabContextTags,
  variantEligibleForRequest,
} from "@/lib/script-constraint-tags";
import {
  listScriptSegmentTagsInText,
  stripScriptSegmentTags,
  variantEligibleForTargetLength,
  type ScriptLengthTier,
  type ScriptSegmentScope,
} from "@/lib/script-segment-tags";
import { sumPauseSecondsFromScript } from "@/lib/meditation-analytics";

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

export type ScriptLabTagMeta = {
  lengthTiered: boolean;
  scope: ScriptSegmentScope;
  types: string[];
};

function eligibleVariants(
  variants: ScriptLabVariant[],
  tagMeta: ScriptLabTagMeta | undefined,
  targetMinutes: number,
  meditationType: string | null | undefined,
  contextTags: string[],
): ScriptLabVariant[] {
  const lengthTiered = tagMeta?.lengthTiered ?? false;
  return variants.filter((v) => {
    if (
      !variantEligibleForTargetLength({
        lengthTiered,
        lengthTier: v.lengthTier,
        targetMinutes,
      })
    ) {
      return false;
    }
    if (!tagMeta) return true;
    return variantEligibleForRequest({
      tagScope: tagMeta.scope,
      tagTypes: tagMeta.types,
      meditationType,
      requiredConstraints: v.requiredConstraints ?? [],
      excludedConstraints: v.excludedConstraints ?? [],
      contextTags,
    });
  });
}

export function pickRandomEligibleVariant(
  variants: ScriptLabVariant[],
  tagMeta: ScriptLabTagMeta | undefined,
  targetMinutes: number,
  meditationType?: string | null,
  contextTags?: string[],
): ScriptLabVariant | null {
  const pool = eligibleVariants(
    variants,
    tagMeta,
    targetMinutes,
    meditationType ?? null,
    contextTags ?? [],
  );
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)]!;
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
} {
  const pauseSeconds = sumPauseSecondsFromScript(params.rawScript);
  const tags = listScriptSegmentTagsInText(params.rawScript);
  const contextTags = params.contextTags ?? [];
  let segmentSeconds = 0;

  for (const tag of tags) {
    const allVariants = params.variantsByTag[tag] ?? [];
    const tagMeta = params.tagMetaByName?.[tag];
    const eligible = eligibleVariants(
      allVariants,
      tagMeta,
      params.targetMinutes,
      params.meditationType ?? null,
      contextTags,
    );
    if (eligible.length === 0) continue;

    const pickId = params.picksByTag?.[tag];
    const variant =
      eligible.find((v) => v.variantId === pickId) ??
      eligible[Math.floor(Math.random() * eligible.length)]!;
    const audio = variant.audio?.find((a) => a.modelId === params.modelId);
    if (audio && audio.durationSeconds > 0) {
      segmentSeconds += audio.durationSeconds;
    } else {
      segmentSeconds += estimateWordsDurationSeconds(variant.text.split(/\s+/).length);
    }
  }

  const customText = stripScriptSegmentTags(params.rawScript);
  const customWordCount = customText.split(/\s+/).filter(Boolean).length;
  const customSpeechSeconds = estimateWordsDurationSeconds(customWordCount);

  return {
    totalSeconds: pauseSeconds + segmentSeconds + customSpeechSeconds,
    pauseSeconds,
    segmentSeconds,
    customSpeechSeconds,
    customWordCount,
  };
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
  moodFocus: string;
  chatText: string;
  singlePrompt: string;
}): string[] {
  const meditationType = resolvedPreviewMeditationType({
    flow: params.flow,
    meditationStyle: params.meditationStyle,
  });
  const userText = [params.moodFocus, params.chatText, params.singlePrompt]
    .filter(Boolean)
    .join("\n");
  return buildScriptLabContextTags({ meditationType, userText });
}
