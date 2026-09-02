/** Client mirror of backend/lib/script-segment-tags.ts */
export const SCRIPT_SEGMENT_TAG_RE = /\[\[SEG:([A-Z][A-Z0-9_]*)\]\]/g;

export type ScriptSegmentScope = "general" | "types";

export type ScriptSegmentRepeatability = "connective" | "singular";

/** Tags expected to repeat for pacing/transitions — not subject to singular duplicate rules. */
export const CONNECTIVE_SEGMENT_TAGS = new Set<string>([
  "BREATH_TRANSITION",
  "PACE_REASSURANCE",
  "PRE_PAUSE_BRIDGE",
  "POST_PAUSE_CONTINUE",
  "WANDERING_ACK",
  "SOFT_AFFIRMATION",
  "BODY_RELAX",
  "BODY_SOFTEN_CUE",
]);

export type ScriptLengthTier = "short" | "medium" | "long";

export function eligibleLengthTiers(targetMinutes: number): ScriptLengthTier[] {
  if (targetMinutes <= 2) return ["short"];
  if (targetMinutes <= 5) return ["short", "medium"];
  return ["short", "medium", "long"];
}

export function variantEligibleForTargetLength(params: {
  lengthTiered: boolean;
  lengthTier: ScriptLengthTier | null | undefined;
  targetMinutes: number;
}): boolean {
  if (!params.lengthTiered) return true;
  const tier = params.lengthTier;
  if (!tier) return false;
  return eligibleLengthTiers(params.targetMinutes).includes(tier);
}

/**
 * Relative selection weights per length tier for a target script duration.
 * Eligibility is unchanged — this only affects preference within the eligible set.
 */
export function lengthTierSelectionWeights(
  targetMinutes: number,
): Record<ScriptLengthTier, number> {
  if (targetMinutes <= 2) return { short: 1, medium: 0, long: 0 };
  if (targetMinutes <= 5) return { short: 1, medium: 3, long: 0 };
  return { short: 1, medium: 3, long: 4 };
}

/** Body-region segments where depth should scale with script length (not pacing/transition tags). */
export function segmentTagPrefersLengthTierBias(
  tagName: string,
  beatType?: string | null,
): boolean {
  const tag = normalizeScriptSegmentTag(tagName);
  if (tag.startsWith("BODY_SCAN_")) return true;
  const bt = (beatType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
  return bt.startsWith("body_scan_");
}

/** Default repeatability when not stored on the segment document. */
export function inferDefaultSegmentRepeatability(tagName: string): ScriptSegmentRepeatability {
  const tag = normalizeScriptSegmentTag(tagName);
  if (CONNECTIVE_SEGMENT_TAGS.has(tag)) return "connective";
  if (tag.startsWith("BODY_SCAN_") || tag.startsWith("CLOSE_") || tag === "SETTLE_OPENER") {
    return "singular";
  }
  return "singular";
}

export function effectiveSegmentRepeatability(params: {
  tag: string;
  repeatability: ScriptSegmentRepeatability | null | undefined;
}): ScriptSegmentRepeatability {
  if (params.repeatability === "connective" || params.repeatability === "singular") {
    return params.repeatability;
  }
  return inferDefaultSegmentRepeatability(params.tag);
}

export function coerceSegmentRepeatability(
  raw: unknown,
  tagName: string,
): ScriptSegmentRepeatability {
  if (raw === "connective" || raw === "singular") return raw;
  return inferDefaultSegmentRepeatability(tagName);
}

export function repeatabilityLabel(repeatability: ScriptSegmentRepeatability): string {
  return repeatability === "connective" ? "connective" : "singular";
}

export function normalizeMeditationTypeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function typesMatchMeditationType(
  types: string[],
  meditationType: string | null | undefined,
): boolean {
  const t = normalizeMeditationTypeKey(meditationType ?? "");
  if (!t || t === "general") return false;
  return types.some((x) => normalizeMeditationTypeKey(x) === t);
}

/** @deprecated types[] no longer gates eligibility — always true. Use typesMatchMeditationType for soft preference only. */
export function segmentEligibleForType(
  _scope: ScriptSegmentScope,
  _types: string[],
  _meditationType: string | null | undefined,
): boolean {
  return true;
}

export function normalizeScriptSegmentTag(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

export function listScriptSegmentTagsInText(script: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of script.matchAll(SCRIPT_SEGMENT_TAG_RE)) {
    const tag = m[1];
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

export function renderScriptWithSegmentVariants(
  script: string,
  pickVariant: (tag: string) => string | null,
): string {
  return script.replace(SCRIPT_SEGMENT_TAG_RE, (_full, tag: string) => {
    const text = pickVariant(tag);
    return text?.trim() ? text.trim() : _full;
  });
}

export type ScriptSegmentTagToken = { type: "text"; value: string } | { type: "tag"; name: string };

/** Split raw script into plain text runs and segment tag tokens. */
export function tokenizeScriptSegmentTags(script: string): ScriptSegmentTagToken[] {
  const out: ScriptSegmentTagToken[] = [];
  let last = 0;
  const re = new RegExp(SCRIPT_SEGMENT_TAG_RE.source, "g");
  for (const m of script.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: "text", value: script.slice(last, idx) });
    out.push({ type: "tag", name: m[1] });
    last = idx + m[0].length;
  }
  if (last < script.length) out.push({ type: "text", value: script.slice(last) });
  return out;
}

export function stripScriptSegmentTags(script: string): string {
  return script.replace(SCRIPT_SEGMENT_TAG_RE, " ").replace(/\s+/g, " ").trim();
}
