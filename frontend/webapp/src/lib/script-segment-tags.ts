/** Client mirror of backend/lib/script-segment-tags.ts */
export const SCRIPT_SEGMENT_TAG_RE = /\[\[SEG:([A-Z][A-Z0-9_]*)\]\]/g;

export type ScriptSegmentScope = "general" | "types";

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

export function segmentEligibleForType(
  scope: ScriptSegmentScope,
  types: string[],
  meditationType: string | null | undefined,
): boolean {
  if (scope === "general") return true;
  const t = (meditationType ?? "").trim().toLowerCase();
  if (!t || t === "general") return false;
  return types.some((x) => x.trim().toLowerCase() === t);
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
