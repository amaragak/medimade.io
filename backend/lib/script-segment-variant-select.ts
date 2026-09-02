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

/**
 * After eligibility filters: prefer unheard variants, else least-recently-used
 * (furthest toward the end of recentVariantIds, which is most-recent-first).
 */
export function applyCrossSessionRecencyPreference(
  pool: SegmentVariantCandidate[],
  recentVariantIds: readonly string[],
): SegmentVariantCandidate[] {
  if (pool.length === 0 || recentVariantIds.length === 0) return pool;

  const recentSet = new Set(recentVariantIds);
  const unheard = pool.filter((v) => !recentSet.has(v.variantId));
  if (unheard.length > 0) return unheard;

  let oldestIndex = -1;
  for (const v of pool) {
    const idx = recentVariantIds.indexOf(v.variantId);
    if (idx > oldestIndex) oldestIndex = idx;
  }
  if (oldestIndex < 0) return pool;

  const lru = pool.filter((v) => recentVariantIds.indexOf(v.variantId) === oldestIndex);
  return lru.length > 0 ? lru : pool;
}

/** Sort options for intelligent selection prompts (unheard first, then LRU). */
export function sortVariantsByCrossSessionRecency(
  variants: SegmentVariantCandidate[],
  recentVariantIds: readonly string[],
): SegmentVariantCandidate[] {
  if (recentVariantIds.length === 0) return variants;
  const recentSet = new Set(recentVariantIds);
  return [...variants].sort((a, b) => {
    const aRecent = recentSet.has(a.variantId);
    const bRecent = recentSet.has(b.variantId);
    if (aRecent !== bRecent) return aRecent ? 1 : -1;
    if (!aRecent) return 0;
    return recentVariantIds.indexOf(b.variantId) - recentVariantIds.indexOf(a.variantId);
  });
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

/** Eligible pool after tier/direction/constraint filters (+ unused preference). */
export function listSelectableSegmentVariants(params: {
  variants: SegmentVariantCandidate[];
  tagMeta?: SegmentTagMeta;
  tagName?: string;
  beatType?: string | null;
  targetMinutes: number;
  meditationType?: string | null;
  contextTags?: string[];
  tourDirection?: ScriptBodyTourDirection | null;
  preferredLengthTier?: ScriptLengthTier | null;
  preferredDirection?: "up" | "down" | "neutral" | null;
  alreadyUsedVariantIds?: readonly string[];
}): SegmentVariantCandidate[] {
  let poolIn = params.variants;

  if (params.preferredLengthTier) {
    const tiered = poolIn.filter(
      (v) => (v.lengthTier ?? null) === params.preferredLengthTier,
    );
    if (tiered.length > 0) poolIn = tiered;
  }

  if (params.preferredDirection === "up" || params.preferredDirection === "down") {
    poolIn = filterVariantsByDirection(poolIn, params.preferredDirection);
  } else if (params.preferredDirection === "neutral") {
    const neutrals = poolIn.filter((v) => {
      const d = normalizeVariantDirection(v.direction);
      return d == null || d === "neutral";
    });
    if (neutrals.length > 0) poolIn = neutrals;
  } else {
    poolIn = filterVariantsByDirection(poolIn, params.tourDirection);
  }

  const eligible = listEligibleSegmentVariants(
    poolIn,
    params.tagMeta,
    params.targetMinutes,
    params.meditationType ?? null,
    params.contextTags ?? [],
  );
  if (eligible.length === 0) return [];

  const used = new Set(params.alreadyUsedVariantIds ?? []);
  const unused = eligible.filter((v) => !used.has(v.variantId));
  return unused.length > 0 ? unused : eligible;
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
  /** Hard preference: keep only this length tier when variants carry lengthTier. */
  preferredLengthTier?: ScriptLengthTier | null;
  /** Hard preference: keep matching direction (plus neutral); falls back if empty. */
  preferredDirection?: "up" | "down" | "neutral" | null;
  alreadyUsedVariantIds?: readonly string[];
  /** Cross-session Script Lab recency (most recent first). */
  recentVariantIds?: readonly string[];
  preferredVariantId?: string | null;
  /** When false, picks are stable (for duration/byte estimates). Default true. */
  random?: boolean;
}): SegmentVariantCandidate | null {
  const random = params.random !== false;
  const recentVariantIds = params.recentVariantIds ?? [];

  const preferredId = params.preferredVariantId?.trim();
  if (preferredId) {
    const eligibleAll = listSelectableSegmentVariants({
      ...params,
      alreadyUsedVariantIds: [],
    });
    const preferred = eligibleAll.find((v) => v.variantId === preferredId);
    if (preferred) {
      const used = new Set(params.alreadyUsedVariantIds ?? []);
      if (!used.has(preferred.variantId)) {
        const unheardPreferred = applyCrossSessionRecencyPreference(
          eligibleAll.filter((v) => !used.has(v.variantId)),
          recentVariantIds,
        );
        const preferredIsStale =
          recentVariantIds.length > 0 &&
          recentVariantIds.includes(preferred.variantId) &&
          unheardPreferred.some((v) => v.variantId !== preferred.variantId);
        if (!preferredIsStale) return preferred;
      }
    }
  }

  const pool = listSelectableSegmentVariants(params);
  if (pool.length === 0) return null;

  const pickPool = applyCrossSessionRecencyPreference(pool, recentVariantIds);

  const applyLengthBias =
    !params.preferredLengthTier &&
    (params.tagMeta?.lengthTiered ?? false) &&
    segmentTagPrefersLengthTierBias(params.tagName ?? "", params.beatType);

  return pickFromVariantPool(pickPool, {
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
  recentVariantIds?: readonly string[];
  preferredVariantIdByTag?: Record<string, string>;
  /** Per-beat preferred variant (wins over by-tag when set). */
  preferredVariantIdByBeatIndex?: Record<number, string>;
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
    const preferredId =
      params.preferredVariantIdByBeatIndex?.[beatIndex] ??
      params.preferredVariantIdByTag?.[tag];

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
      recentVariantIds: params.recentVariantIds,
      preferredVariantId: preferredId,
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
