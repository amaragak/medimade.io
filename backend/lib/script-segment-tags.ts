/** Placeholder the script writer inserts; rendered from the segment library. */
import { formatSegmentTagMetricsForPrompt } from "./script-segment-tag-metrics";

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

export type ScriptSegmentRepeatability = "connective" | "singular";

/**
 * Seed / fallback connective tags when a segment document has no explicit
 * `repeatability` field. Prefer library-stored repeatability via
 * {@link effectiveSegmentRepeatability} / {@link isConnectiveSegmentTag} so
 * imports stay authoritative; keep this set aligned with connective tags in
 * the segment library.
 */
export const CONNECTIVE_SEGMENT_TAGS = new Set<string>([
  "BREATH_TRANSITION",
  "BREATH_GATHER",
  "BREATH_SENSORY_NOTICE",
  "BREATH_WITNESS",
  "PACE_REASSURANCE",
  "PRE_PAUSE_BRIDGE",
  "POST_PAUSE_CONTINUE",
  "WANDERING_ACK",
  "SOFT_AFFIRMATION",
  "BODY_RELAX",
  "BODY_SOFTEN_CUE",
  "SENSORY_EXPAND",
  "EMOTIONAL_NOTICE",
  "DETAIL_FOCUS",
  "LINGER",
  "ARRIVE",
  "IMAGE_SOFTEN",
  "REENTRY_BRIDGE",
  "MANIFESTATION_REALITY_BRIDGE",
  "MANIFESTATION_WORTHINESS",
  "MANIFESTATION_RESISTANCE",
  "MANIFESTATION_GRATITUDE",
  "AFFIRMATION_REPEAT_CUE",
  "AFFIRMATION_COMPLEXITY",
  "AFFIRMATION_EMBODIMENT",
]);
export type ScriptLengthTier = "short" | "medium" | "long";

/** Eligible variant length tiers for a target meditation length. */
export function eligibleLengthTiers(targetMinutes: number): ScriptLengthTier[] {
  if (targetMinutes <= 2) return ["short"];
  if (targetMinutes <= 5) return ["short", "medium"];
  if (targetMinutes <= 10) return ["medium"];
  return ["long"];
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
  if (targetMinutes <= 10) return { short: 0, medium: 1, long: 0 };
  return { short: 0, medium: 0, long: 1 };
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

/** Stored repeatability when set; otherwise inferred default for generation/verification. */
export function effectiveSegmentRepeatability(params: {
  tag: string;
  repeatability: ScriptSegmentRepeatability | null | undefined;
}): ScriptSegmentRepeatability {
  if (params.repeatability === "connective" || params.repeatability === "singular") {
    return params.repeatability;
  }
  return inferDefaultSegmentRepeatability(params.tag);
}

/**
 * Prefer library-stored repeatability when provided; otherwise fall back to
 * {@link CONNECTIVE_SEGMENT_TAGS} / singular defaults. Use this (or
 * {@link effectiveSegmentRepeatability}) instead of checking the hardcoded set
 * alone so imports that mark new tags connective stay authoritative.
 */
export function isConnectiveSegmentTag(
  tagName: string,
  libraryRepeatability?: ScriptSegmentRepeatability | null,
): boolean {
  return (
    effectiveSegmentRepeatability({
      tag: tagName,
      repeatability: libraryRepeatability,
    }) === "connective"
  );
}

export function coerceSegmentRepeatability(
  raw: unknown,
  tagName: string,
): ScriptSegmentRepeatability {
  if (raw === "connective" || raw === "singular") return raw;
  return inferDefaultSegmentRepeatability(tagName);
}

export function coerceStoredSegmentRepeatability(
  raw: unknown,
): ScriptSegmentRepeatability | null {
  if (raw === "connective" || raw === "singular") return raw;
  return null;
}

export function repeatabilityLabel(repeatability: ScriptSegmentRepeatability): string {
  return repeatability === "connective" ? "connective" : "singular";
}

export function repeatabilityPromptLine(
  repeatability: ScriptSegmentRepeatability,
): string {
  return repeatability === "connective"
    ? "connective — may repeat, but never with only pauses between two consecutive instances of the same tag; separate uses with a substantive custom beat or a different tag"
    : "singular — use at most once per script";
}

/** Opening / closing / body-tour phase hints for generation prompt ordering rules. */
export function segmentTagPhaseHint(tagName: string): "opening" | "body_tour" | "closing" | null {
  const tag = normalizeScriptSegmentTag(tagName);
  if (tag === "SETTLE_OPENER" || tag === "BREATH_OPENER") return "opening";
  if (tag.startsWith("CLOSE_")) return "closing";
  if (tag.startsWith("BODY_SCAN_")) return "body_tour";
  return null;
}

export function scriptSegmentSelectionRulesBlock(params?: {
  /** When provided, list connective tags from the live catalog rather than a static example list. */
  connectiveTagNames?: string[];
}): string {
  const fromLibrary = (params?.connectiveTagNames ?? [])
    .map((t) => normalizeScriptSegmentTag(t))
    .filter(Boolean);
  const unique = [...new Set(fromLibrary.length ? fromLibrary : [...CONNECTIVE_SEGMENT_TAGS])].sort();
  const examples =
    unique.length <= 12
      ? unique.join(", ")
      : `${unique.slice(0, 10).join(", ")}, … (${unique.length} connective tags)`;
  return [
    "### Segment library — selection rules",
    "",
    "**Repeatability**",
    "- **Singular tags:** select and use **at most once** per script, regardless of how many variants exist. If the same subject area needs coverage again (e.g. a closing callback to a personalized body region), write that second mention as **custom text**, not a second use of the same tag.",
    `- **Connective tags** (${examples}): may repeat, but **never** with only pauses between two consecutive instances of the **same** tag. At least one **substantive custom beat** or a **different tag** must separate any two uses of the same connective tag. Pauses do not count as separation.`,
    "",
    "**Description / boundaries**",
    "- Before selecting a tag, read its **Description** in the catalog below.",
    "- If the description states a skip or defer condition (e.g. BODY_SCAN_SPINE_BACK when personalized focus is already a specific back sub-region), **do not select that tag** when the condition applies — prefer the more specific tag or custom personalized text instead.",
    "- Do not infer boundaries from variant wording alone; the Description field is authoritative.",
    "",
    "**Phase / ordering**",
    "- **Opening / settling only:** SETTLE_OPENER, BREATH_OPENER — never mid-script or in closing.",
    "- **Body tour only:** BODY_SCAN_* tags — only within the body-tour section, **after** an explicit custom beat that introduces the body tour (e.g. inviting attention to move through the body). Never in settling or closing.",
    "- **Closing only:** CLOSE_DEEPEN_BREATH, CLOSE_SENSORY_RETURN, CLOSE_EYES_OPEN, CLOSE_SENDOFF — only in the closing section, never mid-script.",
    "",
    "**Directional BODY_SCAN variants**",
    "- Some BODY_SCAN_* variants include a `direction` field: **up**, **down**, or **neutral**.",
    "- Do **not** invent or force a tour direction. Direction follows the practice already implied by the creator conversation / script (e.g. feet→head vs crown→feet).",
    "- At fill time, tour direction is **inferred from the BODY_SCAN tag order in the script**; random variant selection is then filtered to matching `direction` (plus **neutral**). Opposite-direction variants are excluded when direction is known.",
  ].join("\n");
}

function formatStructuredTagCatalogEntry(params: {
  tag: {
    name: string;
    scope: ScriptSegmentScope;
    types: string[];
    description?: string;
    repeatability?: ScriptSegmentRepeatability;
    sampleVariants: string[];
    tierAverages?: Array<{
      tier: ScriptLengthTier | "all";
      avgWordCount: number;
      avgSyllableCount: number;
      variantCount: number;
    }>;
  };
  meditationType?: string | null;
}): string[] {
  const { tag: t, meditationType } = params;
  const rep = t.repeatability ?? inferDefaultSegmentRepeatability(t.name);
  const typeMatch = typesMatchMeditationType(t.types, meditationType);
  const scopeLine =
    t.scope === "general"
      ? "Scope: general (any meditation type)"
      : typeMatch
        ? `Scope: type-restricted — preferred for ${t.types.join(", ")}`
        : t.types.length > 0
          ? `Scope: type-restricted — ${t.types.join(", ")} (still available when appropriate)`
          : "Scope: type-restricted";
  const phase = segmentTagPhaseHint(t.name);
  const phaseLine = phase
    ? `Phase: ${phase === "opening" ? "opening / settling only" : phase === "closing" ? "closing section only" : "body-tour section only (after tour intro)"}`
    : null;

  const lines = [`### ${t.name}`, scopeLine];
  if (phaseLine) lines.push(phaseLine);
  lines.push(`Repeatability: ${repeatabilityPromptLine(rep)}`);
  const desc = t.description?.trim();
  if (desc) {
    lines.push(`Description: ${desc}`);
  }
  if (t.sampleVariants.length > 0) {
    const variantPreviews = t.sampleVariants.slice(0, 2).map((v) => {
      const preview = v.trim().slice(0, 100);
      return `"${preview}${v.length > 100 ? "…" : ""}"`;
    });
    lines.push(`Variants: ${variantPreviews.join(" / ")}`);
  }
  const metricsLine = formatSegmentTagMetricsForPrompt({
    name: t.name,
    tierAverages: t.tierAverages ?? [],
  });
  if (metricsLine) lines.push(metricsLine.trim());
  lines.push("");
  return lines;
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
    description?: string;
    repeatability?: ScriptSegmentRepeatability;
    sampleVariants: string[];
    tierAverages?: Array<{
      tier: ScriptLengthTier | "all";
      avgWordCount: number;
      avgSyllableCount: number;
      variantCount: number;
    }>;
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

  const connectiveFromLibrary = sortedTags
    .filter(
      (t) =>
        effectiveSegmentRepeatability({
          tag: t.name,
          repeatability: t.repeatability,
        }) === "connective",
    )
    .map((t) => t.name);

  const lines = structuredBeats
    ? [
        "### Reusable script segments (library)",
        "**Personalization wins by default.** Keep text custom when it references this user's specific input. Only use library tags for wording that would read identically for any user.",
        "Fulfill a beat with `{ custom: false, tag: \"TAG_NAME\", beatType: \"…\" }`. Match beatType to the tag's functional role (e.g. SETTLE_OPENER → settle_opener).",
        "Before writing `custom: true` generic wording, scan **every tag in the catalog below** — not only tags with an obvious topical link.",
        "When custom prose embeds a generic aside with no personalization, split that aside into its own tag beat; keep personalized remainder custom. Do not over-fragment personalized lines.",
        "",
        scriptSegmentSelectionRulesBlock({
          connectiveTagNames: connectiveFromLibrary,
        }),
        "",
        "### Segment tag catalog",
        "",
      ]
    : [
        "### Reusable script segments (library)",
        "You may insert reusable lines from our library instead of rewriting them. Use the exact placeholder syntax `[[SEG:TAG_NAME]]` on its own line or inline where that line belongs — do not invent tag names.",
        "Mix placeholders with your own custom narration between them. Do not force every tag into every script; pick what fits the conversation and technique.",
        "",
        "Eligible tags for this run (all library tags — type labels are preference hints, not restrictions):",
      ];

  if (structuredBeats) {
    for (const t of sortedTags) {
      lines.push(...formatStructuredTagCatalogEntry({ tag: t, meditationType }));
    }
    if (lines[lines.length - 1] === "") lines.pop();
  } else {
    for (const t of sortedTags) {
      const typeMatch = typesMatchMeditationType(t.types, meditationType);
      const rep =
        t.repeatability ?? inferDefaultSegmentRepeatability(t.name);
      const repHint =
        rep === "connective"
          ? "connective — may repeat with content/different-tag between same-tag uses"
          : "singular — at most once";
      const scopeLabel =
        t.scope === "general"
          ? "General"
          : typeMatch
            ? `Preferred for: ${t.types.join(", ")}`
            : t.types.length > 0
              ? `Types: ${t.types.join(", ")} (available for any meditation)`
              : "Types (none set)";
      lines.push(`- **${t.name}** (${scopeLabel}; ${repHint})`);
      const desc = t.description?.trim();
      if (desc) {
        lines.push(`  Description / boundaries: ${desc}`);
      }
      const metricsLine = formatSegmentTagMetricsForPrompt({
        name: t.name,
        tierAverages: t.tierAverages ?? [],
      });
      if (metricsLine) lines.push(metricsLine);
      if (t.sampleVariants.length > 0) {
        lines.push(
          `  Example variant: "${t.sampleVariants[0].slice(0, 120)}${t.sampleVariants[0].length > 120 ? "…" : ""}"`,
        );
      }
    }
  }

  return lines.join("\n");
}
