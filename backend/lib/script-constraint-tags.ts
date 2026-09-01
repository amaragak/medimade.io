/** Generic constraint tags for variant eligibility (posture, eyes, movement, etc.). */

import { segmentEligibleForType } from "./script-segment-tags";

export const DEFAULT_SEATED_CONSTRAINT = "seated_or_lying";
export const STANDING_CONSTRAINT = "standing";

/** Types where standing is plausible when the user signals it — not auto-added. */
export const STANDING_PLAUSIBLE_MEDITATION_TYPES = new Set(
  ["movement meditation"].map((t) => t.toLowerCase()),
);

const STANDING_SIGNAL_RE =
  /\b(standing|stand up|on your feet|upright|while standing|if you're standing)\b/i;

export function normalizeConstraintTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

export function isValidConstraintTag(tag: string): boolean {
  const n = normalizeConstraintTag(tag);
  return n.length >= 2 && /^[a-z][a-z0-9_]*$/.test(n);
}

export function constraintTagInContext(tag: string, contextTags: string[]): boolean {
  const n = normalizeConstraintTag(tag);
  if (!n) return false;
  return contextTags.some((c) => normalizeConstraintTag(c) === n);
}

export function coerceConstraintTagList(raw: unknown): string[] {
  const parts = Array.isArray(raw)
    ? raw.map((x) => (typeof x === "string" ? x : ""))
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const out: string[] = [];
  for (const part of parts) {
    const n = normalizeConstraintTag(part);
    if (!n || !isValidConstraintTag(n)) continue;
    if (out.some((x) => x === n)) continue;
    out.push(n);
    if (out.length >= 24) break;
  }
  return out;
}

/** Detect explicit standing signals in free-text user input. */
export function userTextSignalsStanding(text: string): boolean {
  return STANDING_SIGNAL_RE.test(text.trim());
}

/**
 * Assemble flat context tags for variant eligibility.
 * Default posture is seated/lying; standing is added only when user input signals it.
 */
export function buildScriptLabContextTags(params: {
  meditationType?: string | null;
  /** Mood, chat, prompt, journal — scanned for standing signals. */
  userText?: string;
  extraContextTags?: string[];
}): string[] {
  const tags = new Set<string>();
  tags.add(DEFAULT_SEATED_CONSTRAINT);

  const userText = params.userText ?? "";
  if (userTextSignalsStanding(userText)) {
    tags.add(STANDING_CONSTRAINT);
  }

  for (const extra of params.extraContextTags ?? []) {
    const n = normalizeConstraintTag(extra);
    if (n && isValidConstraintTag(n)) tags.add(n);
  }

  return [...tags].sort();
}

/** Variant-level constraint filter after tag-level scope. */
export function variantEligibleForContext(params: {
  requiredConstraints: string[];
  excludedConstraints: string[];
  contextTags: string[];
}): boolean {
  const required = coerceConstraintTagList(params.requiredConstraints);
  const excluded = coerceConstraintTagList(params.excludedConstraints);
  const context = coerceConstraintTagList(params.contextTags);

  for (const req of required) {
    if (!constraintTagInContext(req, context)) return false;
  }
  for (const ex of excluded) {
    if (constraintTagInContext(ex, context)) return false;
  }
  return true;
}

export function variantEligibleForRequest(params: {
  tagScope: "general" | "types";
  tagTypes: string[];
  meditationType: string | null | undefined;
  requiredConstraints: string[];
  excludedConstraints: string[];
  contextTags: string[];
}): boolean {
  if (!segmentEligibleForType(params.tagScope, params.tagTypes, params.meditationType)) {
    return false;
  }
  return variantEligibleForContext({
    requiredConstraints: params.requiredConstraints,
    excludedConstraints: params.excludedConstraints,
    contextTags: params.contextTags,
  });
}
