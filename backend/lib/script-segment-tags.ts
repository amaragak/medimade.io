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
}): string {
  const eligible = params.tags.filter((t) =>
    segmentEligibleForType(t.scope, t.types, params.meditationType),
  );
  if (eligible.length === 0) {
    return [
      "### Reusable script segments",
      "No reusable segments are eligible for this meditation type. Write the full script yourself, using [[PAUSE …]] bands for silence.",
    ].join("\n");
  }

  const lines = [
    "### Reusable script segments (library)",
    "You may insert reusable lines from our library instead of rewriting them. Use the exact placeholder syntax `[[SEG:TAG_NAME]]` on its own line or inline where that line belongs — do not invent tag names.",
    "Mix placeholders with your own custom narration between them. Do not force every tag into every script; pick what fits the conversation and technique.",
    "",
    "Eligible tags for this run:",
  ];

  for (const t of eligible) {
    const scopeLabel =
      t.scope === "general"
        ? "General"
        : `Types: ${t.types.join(", ")}`;
    lines.push(`- **${t.name}** (${scopeLabel})`);
    if (t.sampleVariants.length > 0) {
      lines.push(
        `  Example variant: "${t.sampleVariants[0].slice(0, 120)}${t.sampleVariants[0].length > 120 ? "…" : ""}"`,
      );
    }
  }

  return lines.join("\n");
}
