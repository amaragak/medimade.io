/** Placeholder the script writer inserts; rendered from the segment library. */
export const SCRIPT_SEGMENT_TAG_RE = /\[\[SEG:([A-Z][A-Z0-9_]*)\]\]/g;

export function normalizeScriptSegmentTag(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

export function isValidScriptSegmentTag(tag: string): boolean {
  const n = normalizeScriptSegmentTag(tag);
  return n.length >= 2 && /^[A-Z][A-Z0-9_]*$/.test(n);
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

export type ScriptSegmentScope = "general" | "types";

export type ScriptLengthTier = "short" | "medium" | "long";

/** Eligible variant length tiers for a target meditation length. */
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

/** Normalize meditation type labels for comparison (case, space, underscore insensitive). */
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

/** Replace each [[SEG:TAG]] with a randomly chosen variant text. */
export function renderScriptWithSegmentVariants(
  script: string,
  pickVariant: (tag: string) => string | null,
): string {
  return script.replace(SCRIPT_SEGMENT_TAG_RE, (_full, tag: string) => {
    const text = pickVariant(tag);
    return text?.trim() ? text.trim() : _full;
  });
}

export function scriptSegmentLibraryPromptBlock(params: {
  tags: Array<{
    name: string;
    scope: ScriptSegmentScope;
    types: string[];
    sampleVariants: string[];
  }>;
  meditationType?: string | null;
  /** When true, describe tags for structured beat output (custom: false) instead of [[SEG:…]] markers. */
  structuredBeats?: boolean;
}): string {
  const structuredBeats = params.structuredBeats === true;
  const meditationType = params.meditationType;
  const sortedTags = [...params.tags].sort((a, b) => {
    const aPref = typesMatchMeditationType(a.types, meditationType) ? 0 : 1;
    const bPref = typesMatchMeditationType(b.types, meditationType) ? 0 : 1;
    if (aPref !== bPref) return aPref - bPref;
    if (a.scope !== b.scope) return a.scope === "general" ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  if (sortedTags.length === 0) {
    return [
      "### Reusable script segments",
      structuredBeats
        ? "No reusable segments in the library yet. Fulfill functional beats with custom: true narration (and standalone pause beats where needed)."
        : "No reusable segments in the library yet. Write the full script yourself, using [[PAUSE …]] bands for silence.",
    ].join("\n");
  }

  const lines = structuredBeats
    ? [
        "### Reusable script segments (library)",
        "**Personalization wins by default.** These rules are not about maximizing tag usage — they catch genuinely generic custom text with no personalization signal. Test: does the text reference anything specific to this user's input (their situation, words, journal details)? If yes, keep it custom — do not replace or split it even if it resembles a tag. If no — it would read identically for any user — it may belong in a tag.",
        "Fulfill a beat with `{ custom: false, tag: \"TAG_NAME\", beatType: \"…\" }`. Match beatType to the tag's functional role (e.g. SETTLE_OPENER → settle_opener).",
        "Before writing `custom: true` generic wording, scan **every tag below** — not only tags with an obvious topical link to the current moment. A body-scan passage may match BREATH_TRANSITION, BODY_RELAX, or PACE_REASSURANCE even when the requested style differs. Tags labeled with meditation types are **preferred** when that type matches — they are still available for any script.",
        "When custom prose embeds a generic aside (reassurance, pacing, transition language) with no personalization of its own, split that aside into its own tag beat; leave the personalized remainder as custom content. Do not over-fragment — never split phrases referencing this user's input, or load-bearing lines that would not make sense standalone.",
        "One blended custom beat is fine when personalization and a functional role belong together (e.g. settle_opener weaving \"sitting under a tree\" into settling language) — as long as you do not also add a second beat of that same beatType later.",
        "Never duplicate the same functional beatType (except content and pause). Do not fulfill one beatType with both custom and tag.",
        "",
        "Eligible tags for this run (all library tags — type labels are preference hints, not restrictions):",
      ]
    : [
        "### Reusable script segments (library)",
        "You may insert reusable lines from our library instead of rewriting them. Use the exact placeholder syntax `[[SEG:TAG_NAME]]` on its own line or inline where that line belongs — do not invent tag names.",
        "Mix placeholders with your own custom narration between them. Do not force every tag into every script; pick what fits the conversation and technique.",
        "",
        "Eligible tags for this run (all library tags — type labels are preference hints, not restrictions):",
      ];

  for (const t of sortedTags) {
    const typeMatch = typesMatchMeditationType(t.types, meditationType);
    const scopeLabel =
      t.scope === "general"
        ? "General"
        : typeMatch
          ? `Preferred for: ${t.types.join(", ")}`
          : t.types.length > 0
            ? `Types: ${t.types.join(", ")} (available for any meditation)`
            : "Types (none set)";
    lines.push(`- **${t.name}** (${scopeLabel})`);
    if (t.sampleVariants.length > 0) {
      lines.push(
        `  Example variant: "${t.sampleVariants[0].slice(0, 120)}${t.sampleVariants[0].length > 120 ? "…" : ""}"`,
      );
    }
  }

  return lines.join("\n");
}
