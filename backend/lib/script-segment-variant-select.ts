import { variantEligibleForRequest } from "./script-constraint-tags";
import {
  lengthTierSelectionWeights,
  normalizeScriptSegmentTag,
  segmentTagPrefersLengthTierBias,
  variantEligibleForTargetLength,
  type ScriptLengthTier,
  type ScriptSegmentScope,
} from "./script-segment-tags";

export type SegmentVariantCandidate = {
  variantId: string;
  text: string;
  lengthTier?: ScriptLengthTier | null;
  /** Imported variant field: "up" | "down" | "neutral". */
  direction?: string | null;
  requiredConstraints?: string[];
  excludedConstraints?: string[];
};

export type SegmentTagMeta = {
  lengthTiered: boolean;
  scope: ScriptSegmentScope;
  types: string[];
};

export type ScriptBodyTourDirection = "up" | "down";

/** Anatomical top→bottom rank for BODY_SCAN region tags. */
const BODY_SCAN_ANATOMY_ORDER: Record<string, number> = {
  BODY_SCAN_CROWN: 0,
  BODY_SCAN_FACE_JAW: 1,
  BODY_SCAN_NECK_SHOULDERS: 2,
  BODY_SCAN_SPINE_BACK: 3,
  BODY_SCAN_HIPS_BELLY_CHEST: 4,
  BODY_SCAN_LOWER_BODY: 5,
};

export function normalizeVariantDirection(
  raw: string | null | undefined,
): "up" | "down" | "neutral" | null {
  if (raw == null) return null;
  const d = raw.trim().toLowerCase();
  if (d === "up" || d === "down" || d === "neutral") return d;
  return null;
}

/** True when any variant carries a non-empty direction field. */
export function variantsHaveDirectionMetadata(
  variants: ReadonlyArray<SegmentVariantCandidate>,
): boolean {
  return variants.some((v) => normalizeVariantDirection(v.direction) != null);
}

/**
 * Infer body-tour travel from BODY_SCAN tag order.
 * Crown→feet ⇒ down; feet→crown ⇒ up; unclear ⇒ null.
 */
export function inferBodyTourDirectionFromBeats(
  beats: ReadonlyArray<{ tag?: string; custom?: boolean; beatType?: string }>,
): ScriptBodyTourDirection | null {
  const ranks: number[] = [];
  for (const beat of beats) {
    if (beat.custom || beat.beatType === "pause") continue;
    const tag = normalizeScriptSegmentTag(beat.tag ?? "");
    const rank = BODY_SCAN_ANATOMY_ORDER[tag];
    if (rank == null) continue;
    ranks.push(rank);
  }
  if (ranks.length < 2) return null;
  let delta = 0;
  for (let i = 1; i < ranks.length; i++) {
    delta += ranks[i]! - ranks[i - 1]!;
  }
  if (delta > 0) return "down";
  if (delta < 0) return "up";
  return null;
}

/**
 * When tour direction is known and variants have direction metadata:
 * keep matching + neutral; drop the opposite. If that empties the pool, keep original.
 */
export function filterVariantsByDirection(
  variants: SegmentVariantCandidate[],
  tourDirection: ScriptBodyTourDirection | null | undefined,
): SegmentVariantCandidate[] {
  if (!tourDirection || !variantsHaveDirectionMetadata(variants)) {
    return variants;
  }
  const filtered = variants.filter((v) => {
    const d = normalizeVariantDirection(v.direction);
    if (d == null || d === "neutral") return true;
    return d === tourDirection;
  });
  return filtered.length > 0 ? filtered : variants;
}

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
  /** Known body-tour travel; filters directional variants when present. */
  tourDirection?: ScriptBodyTourDirection | null;
  alreadyUsedVariantIds?: readonly string[];
  preferredVariantId?: string | null;
  /** When false, picks are stable (for duration/byte estimates). Default true. */
  random?: boolean;
}): SegmentVariantCandidate | null {
  const random = params.random !== false;
  const directionFiltered = filterVariantsByDirection(
    params.variants,
    params.tourDirection,
  );
  const eligible = listEligibleSegmentVariants(
    directionFiltered,
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
  /** When false, picks are stable (for duration/byte estimates). Default true. */
  random?: boolean;
}): {
  pickVariantText: (tag: string, beatIndex: number) => string | null;
  picksByBeatIndex: Record<number, string>;
  picksByTag: Record<string, string>;
  tourDirection: ScriptBodyTourDirection | null;
} {
  const usedByTag = new Map<string, string[]>();
  const picksByBeatIndex: Record<number, string> = {};
  const picksByTag: Record<string, string> = {};
  const tourDirection = inferBodyTourDirectionFromBeats(params.beats);

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
      tourDirection,
      alreadyUsedVariantIds: alreadyUsed,
      preferredVariantId: preferredAlreadyUsed ? null : preferredId,
      random: params.random,
    });
    if (!picked) return null;

    usedByTag.set(tag, [...alreadyUsed, picked.variantId]);
    picksByBeatIndex[beatIndex] = picked.variantId;
    picksByTag[tag] = picked.variantId;
    return picked.text;
  }

  return { pickVariantText, picksByBeatIndex, picksByTag, tourDirection };
}
