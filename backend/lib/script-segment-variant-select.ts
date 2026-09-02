import { variantEligibleForRequest } from "./script-constraint-tags";
import {
  lengthTierSelectionWeights,
  segmentTagPrefersLengthTierBias,
  variantEligibleForTargetLength,
  type ScriptLengthTier,
  type ScriptSegmentScope,
} from "./script-segment-tags";

export type SegmentVariantCandidate = {
  variantId: string;
  text: string;
  lengthTier?: ScriptLengthTier | null;
  requiredConstraints?: string[];
  excludedConstraints?: string[];
};

export type SegmentTagMeta = {
  lengthTiered: boolean;
  scope: ScriptSegmentScope;
  types: string[];
};

export function listEligibleSegmentVariants(
  variants: SegmentVariantCandidate[],
  tagMeta: SegmentTagMeta | undefined,
  targetMinutes: number,
  meditationType: string | null | undefined,
  contextTags: string[],
): SegmentVariantCandidate[] {
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

/**
 * Pick one eligible segment variant, preferring ids not in `alreadyUsedVariantIds`
 * when alternatives exist. Falls back to reuse when the pool is exhausted.
 */
function pickWeightedRandom<T>(items: T[], weightOf: (item: T) => number): T {
  const weights = items.map(weightOf);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)]!;
  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

function pickFromVariantPool(
  pool: SegmentVariantCandidate[],
  options: {
    random: boolean;
    targetMinutes: number;
    applyLengthBias: boolean;
  },
): SegmentVariantCandidate | null {
  if (pool.length === 0) return null;

  const { random, targetMinutes, applyLengthBias } = options;
  if (!applyLengthBias) {
    if (random) return pool[Math.floor(Math.random() * pool.length)]!;
    return [...pool].sort((a, b) => a.variantId.localeCompare(b.variantId))[0]!;
  }

  const tierWeights = lengthTierSelectionWeights(targetMinutes);
  const weightFor = (v: SegmentVariantCandidate) =>
    tierWeights[v.lengthTier ?? "medium"] ?? 0;

  if (random) {
    return pickWeightedRandom(pool, weightFor);
  }

  const maxWeight = Math.max(...pool.map(weightFor));
  const best = pool.filter((v) => weightFor(v) === maxWeight);
  return [...best].sort((a, b) => a.variantId.localeCompare(b.variantId))[0]!;
}

export function selectSegmentVariant(params: {
  variants: SegmentVariantCandidate[];
  tagMeta?: SegmentTagMeta;
  tagName?: string;
  beatType?: string | null;
  targetMinutes: number;
  meditationType?: string | null;
  contextTags?: string[];
  alreadyUsedVariantIds?: readonly string[];
  preferredVariantId?: string | null;
  /** When false, picks are stable (for duration/byte estimates). Default true. */
  random?: boolean;
}): SegmentVariantCandidate | null {
  const random = params.random !== false;
  const eligible = listEligibleSegmentVariants(
    params.variants,
    params.tagMeta,
    params.targetMinutes,
    params.meditationType ?? null,
    params.contextTags ?? [],
  );
  if (eligible.length === 0) return null;

  const preferredId = params.preferredVariantId?.trim();
  if (preferredId) {
    const preferred = eligible.find((v) => v.variantId === preferredId);
    if (preferred) return preferred;
  }

  const used = new Set(params.alreadyUsedVariantIds ?? []);
  const unused = eligible.filter((v) => !used.has(v.variantId));
  const pool = unused.length > 0 ? unused : eligible;

  const applyLengthBias =
    (params.tagMeta?.lengthTiered ?? false) &&
    segmentTagPrefersLengthTierBias(params.tagName ?? "", params.beatType);

  return pickFromVariantPool(pool, {
    random,
    targetMinutes: params.targetMinutes,
    applyLengthBias,
  });
}

export type SegmentBeatRef = {
  beatType: string;
  custom: boolean;
  tag?: string;
};

/** Stateful picker for one script fill — tracks used variant ids per tag. */
export function createSegmentVariantPickerForBeats(params: {
  beats: ReadonlyArray<SegmentBeatRef>;
  variantsByTag: Record<string, SegmentVariantCandidate[]>;
  tagMetaByName?: Record<string, SegmentTagMeta>;
  targetMinutes: number;
  meditationType?: string | null;
  contextTags?: string[];
  preferredVariantIdByTag?: Record<string, string>;
}): {
  pickVariantText: (tag: string, beatIndex: number) => string | null;
  picksByBeatIndex: Record<number, string>;
  picksByTag: Record<string, string>;
} {
  const usedByTag = new Map<string, string[]>();
  const picksByBeatIndex: Record<number, string> = {};
  const picksByTag: Record<string, string> = {};

  function pickVariantText(tag: string, beatIndex: number): string | null {
    const beat = params.beats[beatIndex];
    if (!beat || beat.custom || beat.beatType === "pause" || beat.tag !== tag) {
      return null;
    }

    const alreadyUsed = usedByTag.get(tag) ?? [];
    const preferredId = params.preferredVariantIdByTag?.[tag];
    const preferredAlreadyUsed =
      preferredId != null && alreadyUsed.includes(preferredId);

    const picked = selectSegmentVariant({
      variants: params.variantsByTag[tag] ?? [],
      tagMeta: params.tagMetaByName?.[tag],
      tagName: tag,
      beatType: beat.beatType,
      targetMinutes: params.targetMinutes,
      meditationType: params.meditationType,
      contextTags: params.contextTags,
      alreadyUsedVariantIds: alreadyUsed,
      preferredVariantId: preferredAlreadyUsed ? null : preferredId,
    });
    if (!picked) return null;

    usedByTag.set(tag, [...alreadyUsed, picked.variantId]);
    picksByBeatIndex[beatIndex] = picked.variantId;
    picksByTag[tag] = picked.variantId;
    return picked.text;
  }

  return { pickVariantText, picksByBeatIndex, picksByTag };
}
