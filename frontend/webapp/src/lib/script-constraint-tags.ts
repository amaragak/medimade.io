/** Client mirror of backend/lib/script-constraint-tags.ts */

import type { ScriptSegmentScope } from "@/lib/script-segment-tags";

export const DEFAULT_SEATED_CONSTRAINT = "seated_or_lying";
export const STANDING_CONSTRAINT = "standing";

const UPRIGHT_MOVEMENT_SIGNAL_RE =
  /\b(standing|stand up|on your feet|upright|while standing|if you're standing|walking|walk(?:ing)?|running|run(?:ning)?|jogging|jog(?:ging)?|pacing|on the move|while you walk|while you run|take a walk|go for a run|office movement)\b/i;

const SEATED_OR_FLOOR_SIGNAL_RE =
  /\b(sitting|seated|sit(?:ting)? down|lying(?: down)?|lie(?: down)?|on the floor|floor-based|yoga on the floor|seated stretching|on your back|supine|prone|on the ground|on a mat|mat work)\b/i;

function normalizeMeditationTypeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

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

export function isMovementMeditationType(
  meditationType: string | null | undefined,
): boolean {
  if (!meditationType?.trim()) return false;
  return normalizeMeditationTypeKey(meditationType) === "movement meditation";
}

export function userTextSignalsStanding(text: string): boolean {
  return UPRIGHT_MOVEMENT_SIGNAL_RE.test(text.trim());
}

export function userTextSignalsSeatedOrFloor(text: string): boolean {
  return SEATED_OR_FLOOR_SIGNAL_RE.test(text.trim());
}

export function buildScriptLabContextTags(params: {
  meditationType?: string | null;
  userText?: string;
  extraContextTags?: string[];
}): string[] {
  const tags = new Set<string>();
  const userText = params.userText ?? "";

  if (isMovementMeditationType(params.meditationType)) {
    if (userTextSignalsSeatedOrFloor(userText)) {
      tags.add(DEFAULT_SEATED_CONSTRAINT);
    } else {
      tags.add(STANDING_CONSTRAINT);
    }
  } else {
    tags.add(DEFAULT_SEATED_CONSTRAINT);
    if (userTextSignalsStanding(userText)) {
      tags.add(STANDING_CONSTRAINT);
    }
  }

  for (const extra of params.extraContextTags ?? []) {
    const n = normalizeConstraintTag(extra);
    if (n && isValidConstraintTag(n)) tags.add(n);
  }

  return [...tags].sort();
}

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

/** Variant-level constraint filter. Tag types[] does not gate eligibility — only soft preference at pick time. */
export function variantEligibleForRequest(params: {
  tagScope: ScriptSegmentScope;
  tagTypes: string[];
  meditationType: string | null | undefined;
  requiredConstraints: string[];
  excludedConstraints: string[];
  contextTags: string[];
}): boolean {
  void params.tagScope;
  void params.tagTypes;
  void params.meditationType;
  return variantEligibleForContext({
    requiredConstraints: params.requiredConstraints,
    excludedConstraints: params.excludedConstraints,
    contextTags: params.contextTags,
  });
}
