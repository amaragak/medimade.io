import {
  CLAUDE_SONNET_45_MODEL_ID,
  parseAnthropicMessageUsage,
} from "./anthropic-pricing";
import { normalizePauseBand } from "./script-pause-bands";
import {
  tagNameToBeatType,
  type ScriptLabBeat,
} from "./script-lab-beats";
import { normalizeScriptSegmentTag } from "./script-segment-tags";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export type GeneralTagVariantEntry = {
  variantId: string;
  text: string;
};

export type GeneralTagVariantCatalog = {
  name: string;
  variants: GeneralTagVariantEntry[];
};

export type VerificationSentence = {
  globalIndex: number;
  beatIndex: number;
  sentenceIndexInBeat: number;
  beatType: string;
  prose: string;
  trailingPauseBands: string[];
};

export type SentenceVerdictKind = "keep_custom" | "convert_tag" | "no_match";

export type SentenceVerdict = {
  sentenceIndex: number;
  verdict: SentenceVerdictKind;
  matchedTag?: string;
  matchedVariantId?: string;
  confidence?: "high" | "medium" | "low";
};

const PAUSE_MARKER_RE = /\[\[PAUSE\s+([^\]]+)\]\]/gi;

/** Full variant library for verification — no truncation. */
export function prepareGeneralTagsForVerification(
  tags: GeneralTagVariantCatalog[],
): GeneralTagVariantCatalog[] {
  return tags.map((t) => ({
    name: normalizeScriptSegmentTag(t.name),
    variants: t.variants.map((v, i) => ({
      variantId: v.variantId?.trim() || `${t.name}#${i}`,
      text: v.text.replace(/\s+/g, " ").trim(),
    })),
  }));
}

/** @deprecated Use prepareGeneralTagsForVerification — kept for imports that referenced the old name. */
export function compactGeneralTagsForVerification(
  tags: GeneralTagVariantCatalog[],
): GeneralTagVariantCatalog[] {
  return prepareGeneralTagsForVerification(tags);
}

export function splitCustomBeatTextIntoSentences(text: string): Array<{
  prose: string;
  trailingPauseBands: string[];
}> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  type Piece =
    | { kind: "text"; value: string }
    | { kind: "pause"; band: string };

  const pieces: Piece[] = [];
  let last = 0;
  const re = new RegExp(PAUSE_MARKER_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed)) !== null) {
    if (match.index > last) {
      pieces.push({ kind: "text", value: trimmed.slice(last, match.index) });
    }
    pieces.push({ kind: "pause", band: match[1]!.trim() });
    last = match.index + match[0].length;
  }
  if (last < trimmed.length) {
    pieces.push({ kind: "text", value: trimmed.slice(last) });
  }

  const result: Array<{ prose: string; trailingPauseBands: string[] }> = [];
  let leadingPauses: string[] = [];

  const pushPauseBand = (raw: string) => {
    const normalized = normalizePauseBand(raw);
    result[result.length - 1]!.trailingPauseBands.push(normalized ?? raw.trim());
  };

  for (const piece of pieces) {
    if (piece.kind === "pause") {
      if (result.length > 0) {
        pushPauseBand(piece.band);
      } else {
        const normalized = normalizePauseBand(piece.band);
        leadingPauses.push(normalized ?? piece.band.trim());
      }
      continue;
    }

    const chunk = piece.value.trim();
    if (!chunk) continue;

    const sentenceParts = chunk
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (sentenceParts.length === 0) continue;

    for (let i = 0; i < sentenceParts.length; i++) {
      const trailingPauses: string[] =
        i === 0 ? [...leadingPauses] : [];
      if (i === 0) leadingPauses = [];
      result.push({ prose: sentenceParts[i]!, trailingPauseBands: trailingPauses });
    }
  }

  return result.filter((s) => s.prose.length > 0 || s.trailingPauseBands.length > 0);
}

export function buildVerificationSentenceList(
  beats: ScriptLabBeat[],
): VerificationSentence[] {
  const out: VerificationSentence[] = [];
  let globalIndex = 0;

  beats.forEach((beat, beatIndex) => {
    if (!beat.custom || !beat.text?.trim()) return;

    const parts = splitCustomBeatTextIntoSentences(beat.text);
    parts.forEach((part, sentenceIndexInBeat) => {
      out.push({
        globalIndex,
        beatIndex,
        sentenceIndexInBeat,
        beatType: beat.beatType,
        prose: part.prose,
        trailingPauseBands: part.trailingPauseBands,
      });
      globalIndex += 1;
    });
  });

  return out;
}

function sentenceDisplayText(s: VerificationSentence): string {
  const pauseSuffix = s.trailingPauseBands
    .map((b) => `[[PAUSE ${b}]]`)
    .join(" ");
  return pauseSuffix ? `${s.prose} ${pauseSuffix}`.trim() : s.prose;
}

function scriptLabSentenceVerificationToolDefinition(sentenceCount: number): {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
} {
  return {
    name: "submit_sentence_verification_verdicts",
    description:
      "Return exactly one verdict per numbered custom-beat sentence index (0 through N-1). Judge semantic fit to library tags — not verbatim wording.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        sentenceVerdicts: {
          type: "array",
          minItems: sentenceCount,
          maxItems: sentenceCount,
          description: `Exactly ${sentenceCount} verdict objects, one per sentence index.`,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              sentenceIndex: {
                type: "integer",
                minimum: 0,
                maximum: Math.max(0, sentenceCount - 1),
              },
              verdict: {
                type: "string",
                enum: ["keep_custom", "convert_tag", "no_match"],
                description:
                  "convert_tag when the sentence is generic and serves the same semantic function as a catalog tag (any variant under that tag).",
              },
              matchedTag: {
                type: "string",
                description: "Required for convert_tag — tag name whose purpose matches semantically.",
              },
              matchedVariantId: {
                type: "string",
                description:
                  "For convert_tag: id of the catalog variant that best exemplifies the same meaning (need not be word-for-word).",
              },
              confidence: {
                type: "string",
                enum: ["high", "medium", "low"],
              },
            },
            required: ["sentenceIndex", "verdict", "confidence"],
          },
        },
      },
      required: ["sentenceVerdicts"],
    },
  };
}

export function buildVerificationPrompt(params: {
  transcript: string;
  sentences: VerificationSentence[];
  generalTags: GeneralTagVariantCatalog[];
}): { system: string; userContent: string } {
  const tagCatalog = params.generalTags
    .map((t) => {
      const lines = [`### ${t.name} (beatType: ${tagNameToBeatType(t.name)})`];
      for (const v of t.variants) {
        lines.push(`- [${v.variantId}] "${v.text}"`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  const sentencesJson = JSON.stringify(
    params.sentences.map((s) => ({
      sentenceIndex: s.globalIndex,
      sourceBeatIndex: s.beatIndex,
      sentenceIndexInBeat: s.sentenceIndexInBeat,
      beatType: s.beatType,
      text: sentenceDisplayText(s),
    })),
    null,
    2,
  );

  return {
    system: [
      "You are a conservative sentence-level coverage reviewer for medimade.io Script Lab.",
      "You judge pre-split numbered sentences only — you do NOT rewrite or assemble beats.",
      "Personalization always wins: if a sentence references this user's specific situation, words, or journal details, verdict MUST be keep_custom.",
      "Personalization test: does this sentence reference anything specific to this user's actual input? If yes → keep_custom. If no — it would read identically for any user — it may be convert_tag when it serves the same semantic function as a library tag.",
      "Tag matching is SEMANTIC, not verbatim. Do NOT require the sentence to quote or closely paraphrase a variant's exact wording. Ask: would this line be interchangeable with a variant under that tag for any user? Same pacing cue, breath transition, body-scan invitation, reassurance, etc.",
      "convert_tag requires confidence high, a matchedTag, and matchedVariantId pointing to the catalog variant that best represents the same meaning (pick the closest semantic fit among that tag's variants).",
      "When uncertain about personalization → keep_custom. When generic but no tag's purpose fits semantically → no_match. When generic and a tag clearly covers the same function → convert_tag with confidence high, even if wording differs substantially — do not use medium/low merely because the sentence is not a near-quote of a variant.",
      "Repeated convert_tag to the same tag across multiple sentences is expected and correct — do NOT skip a later sentence because you already converted an earlier one to the same tag.",
      "This pass is independent of primary-generation beatType de-duplication rules; multiple tag beats with the same beatType are valid here.",
      "Return exactly one verdict per sentenceIndex via submit_sentence_verification_verdicts — no omissions.",
    ].join(" "),
    userContent: [
      "### Creator conversation (personalization check)",
      params.transcript.trim() || "(No transcript.)",
      "",
      "### Numbered custom-beat sentences (pre-split in code — judge each independently)",
      sentencesJson,
      "",
      "### Tag library (all scopes) — ALL variant texts with ids",
      "Use variants as examples of each tag's semantic function — matching is by purpose, not exact text.",
      tagCatalog || "(No tags in library.)",
      "",
      "### Verdict rules",
      "- keep_custom: personalized or must stay bespoke",
      "- convert_tag: zero personalization AND the sentence serves the same semantic function as a tag (pick matchedTag + the variantId whose meaning is closest — wording may differ greatly)",
      "- no_match: generic but no tag's purpose applies semantically — stays in custom text",
      "",
      "### Semantic match examples (wording need NOT match variants)",
      "- Personalized: \"Now bring your full awareness to your lower back.\" → keep_custom",
      "- \"There is nowhere to rush, nowhere to be except right now.\" → convert_tag PACE_REASSURANCE (same pacing/no-rush function as \"There's nowhere else you need to be right now.\")",
      "- \"Don't try to change it yet—just notice it.\" → convert_tag PACE_REASSURANCE (same gentle pacing / non-striving cue as \"There's no rush here.\")",
      "- \"Simply observe with curiosity.\" → convert_tag PACE_REASSURANCE or BODY_SCAN cue tag if one fits semantically",
      "- \"And as you exhale, let yourself arrive fully here.\" → convert_tag BREATH_TRANSITION (arriving-on-the-breath function; pick closest variant even if exhale wording differs)",
      "- Generic but unique: \"Imagine a warm golden light pooling at the base of your spine.\" → no_match (no tag covers this imagery)",
      "",
      "Return exactly one verdict for every sentenceIndex listed above.",
    ].join("\n"),
  };
}

function parseSentenceVerdictsFromToolInput(
  input: unknown,
  expectedCount: number,
): SentenceVerdict[] {
  if (!input || typeof input !== "object") {
    throw new Error("Verification tool input must be an object");
  }
  const raw = (input as { sentenceVerdicts?: unknown }).sentenceVerdicts;
  if (!Array.isArray(raw)) {
    throw new Error("sentenceVerdicts must be an array");
  }

  const byIndex = new Map<number, SentenceVerdict>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const sentenceIndex = o.sentenceIndex;
    if (typeof sentenceIndex !== "number" || !Number.isInteger(sentenceIndex)) continue;
    if (sentenceIndex < 0 || sentenceIndex >= expectedCount) continue;

    const verdictRaw = o.verdict;
    const verdict: SentenceVerdictKind =
      verdictRaw === "convert_tag" || verdictRaw === "no_match"
        ? verdictRaw
        : "keep_custom";

    const confidence =
      o.confidence === "high" || o.confidence === "medium" || o.confidence === "low"
        ? o.confidence
        : "low";

    byIndex.set(sentenceIndex, {
      sentenceIndex,
      verdict,
      ...(typeof o.matchedTag === "string" && o.matchedTag.trim()
        ? { matchedTag: normalizeScriptSegmentTag(o.matchedTag) }
        : {}),
      ...(typeof o.matchedVariantId === "string" && o.matchedVariantId.trim()
        ? { matchedVariantId: o.matchedVariantId.trim() }
        : {}),
      confidence,
    });
  }

  return [...byIndex.values()].sort((a, b) => a.sentenceIndex - b.sentenceIndex);
}

function extractSentenceVerdictsFromAnthropicMessage(
  content: unknown,
  expectedCount: number,
): SentenceVerdict[] {
  if (!Array.isArray(content)) {
    throw new Error("Verification response missing content blocks");
  }
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "tool_use" &&
      (block as { name?: string }).name === "submit_sentence_verification_verdicts"
    ) {
      return parseSentenceVerdictsFromToolInput(
        (block as { input?: unknown }).input,
        expectedCount,
      );
    }
  }
  throw new Error("Model did not return submit_sentence_verification_verdicts tool output");
}

function missingSentenceIndices(
  verdicts: SentenceVerdict[],
  expectedCount: number,
): number[] {
  const seen = new Set(verdicts.map((v) => v.sentenceIndex));
  const missing: number[] = [];
  for (let i = 0; i < expectedCount; i++) {
    if (!seen.has(i)) missing.push(i);
  }
  return missing;
}

function defaultKeepCustomVerdicts(indices: number[]): SentenceVerdict[] {
  return indices.map((sentenceIndex) => ({
    sentenceIndex,
    verdict: "keep_custom" as const,
    confidence: "low" as const,
  }));
}

function tagCatalogHasTag(catalog: GeneralTagVariantCatalog[], tag: string): boolean {
  return catalog.some((t) => t.name === tag);
}

function resolveVariantIdForTag(
  catalog: GeneralTagVariantCatalog[],
  tag: string,
  variantId: string | undefined,
): string | null {
  const row = catalog.find((t) => t.name === tag);
  if (!row || row.variants.length === 0) return null;
  if (variantId && row.variants.some((v) => v.variantId === variantId)) {
    return variantId;
  }
  return row.variants[0]!.variantId;
}

function effectiveVerdict(
  v: SentenceVerdict,
  catalog: GeneralTagVariantCatalog[],
): SentenceVerdictKind {
  if (v.verdict !== "convert_tag") return v.verdict;
  if (v.confidence !== "high") return "no_match";
  if (!v.matchedTag || !tagCatalogHasTag(catalog, v.matchedTag)) return "no_match";
  if (!resolveVariantIdForTag(catalog, v.matchedTag, v.matchedVariantId)) {
    return "no_match";
  }
  return "convert_tag";
}

/** Non-pause beats to look back when blocking near-duplicate tag conversions. */
export const VERIFICATION_TAG_PROXIMITY_WINDOW = 4;

function recentTagRolesInWindow(
  assembled: ScriptLabBeat[],
  windowNonPauseBeats: number,
): { tags: Set<string>; beatTypes: Set<string> } {
  const tags = new Set<string>();
  const beatTypes = new Set<string>();
  let seen = 0;
  for (let i = assembled.length - 1; i >= 0 && seen < windowNonPauseBeats; i--) {
    const beat = assembled[i]!;
    if (beat.beatType === "pause") continue;
    seen += 1;
    if (!beat.custom && beat.tag) {
      tags.add(beat.tag);
      beatTypes.add(beat.beatType);
    }
  }
  return { tags, beatTypes };
}

/** True when converting to matchedTag would stack the same tag/role too close to a recent one. */
export function proximityBlocksTagConversion(
  assembledSoFar: ScriptLabBeat[],
  matchedTag: string,
  windowNonPauseBeats = VERIFICATION_TAG_PROXIMITY_WINDOW,
): boolean {
  const role = tagNameToBeatType(matchedTag);
  const recent = recentTagRolesInWindow(assembledSoFar, windowNonPauseBeats);
  return recent.tags.has(matchedTag) || recent.beatTypes.has(role);
}

/** Non-pause beats before/after to scan for conflicting body-region topical anchors. */
export const VERIFICATION_TOPICAL_WINDOW = 4;

type BodyRegion =
  | "face_jaw"
  | "neck_shoulders"
  | "spine_back"
  | "lower_back"
  | "hips_belly_chest"
  | "lower_body"
  | "crown"
  | "whole_body";

function bodyRegionsForTag(tag: string): Set<BodyRegion> {
  const u = tag.toUpperCase();
  if (u.includes("FACE_JAW")) return new Set(["face_jaw"]);
  if (u.includes("NECK_SHOULDERS")) return new Set(["neck_shoulders"]);
  if (u.includes("SPINE_BACK")) return new Set(["spine_back"]);
  if (u.includes("HIPS_BELLY_CHEST")) return new Set(["hips_belly_chest"]);
  if (u.includes("LOWER_BODY")) return new Set(["lower_body"]);
  if (u.includes("CROWN")) return new Set(["crown"]);
  if (u.includes("FULL_INTEGRATION")) return new Set(["whole_body"]);
  return new Set();
}

function bodyRegionsForText(text: string): Set<BodyRegion> {
  const t = text.toLowerCase();
  const regions = new Set<BodyRegion>();
  if (/\b(jaw|unclench|forehead|face|cheek|mouth|temple)\b/.test(t)) {
    regions.add("face_jaw");
  }
  if (/\b(neck|shoulder)\b/.test(t)) regions.add("neck_shoulders");
  if (/\b(lower back|lumbar|tailbone|sacrum|small of your back)\b/.test(t)) {
    regions.add("lower_back");
  } else if (/\b(spine|upper back|mid back|back of your neck|length of your back)\b/.test(t)) {
    regions.add("spine_back");
  }
  if (/\b(hip|belly|chest|rib|abdomen|torso)\b/.test(t)) {
    regions.add("hips_belly_chest");
  }
  if (/\b(leg|thigh|knee|ankle|foot|feet|toes|calf|calves)\b/.test(t)) {
    regions.add("lower_body");
  }
  if (/\b(crown|top of your head|scalp|skull)\b/.test(t)) regions.add("crown");
  if (/\b(whole body|entire body|head to toe|all at once|complete body|integrated whole)\b/.test(t)) {
    regions.add("whole_body");
  }
  return regions;
}

function bodyRegionsForBeat(beat: ScriptLabBeat): Set<BodyRegion> {
  if (beat.beatType === "pause") return new Set();
  if (!beat.custom && beat.tag) return bodyRegionsForTag(beat.tag);
  if (beat.text?.trim()) return bodyRegionsForText(beat.text);
  return new Set();
}

function collectNearbyBodyRegions(params: {
  assembled: ScriptLabBeat[];
  beatsBefore: ScriptLabBeat[];
  beatIndex: number;
  beatSentences: VerificationSentence[];
  sentenceIdxInBeat: number;
  pendingCustomText: string[];
  windowNonPauseBeats: number;
}): Set<BodyRegion> {
  const regions = new Set<BodyRegion>();
  let seen = 0;

  for (const text of params.pendingCustomText) {
    for (const r of bodyRegionsForText(text)) regions.add(r);
  }

  for (let i = params.assembled.length - 1; i >= 0 && seen < params.windowNonPauseBeats; i--) {
    const beat = params.assembled[i]!;
    if (beat.beatType === "pause") continue;
    for (const r of bodyRegionsForBeat(beat)) regions.add(r);
    seen += 1;
  }

  seen = 0;
  for (
    let si = params.sentenceIdxInBeat + 1;
    si < params.beatSentences.length && seen < params.windowNonPauseBeats;
    si++
  ) {
    for (const r of bodyRegionsForText(params.beatSentences[si]!.prose)) regions.add(r);
    seen += 1;
  }

  for (
    let bi = params.beatIndex + 1;
    bi < params.beatsBefore.length && seen < params.windowNonPauseBeats;
    bi++
  ) {
    const beat = params.beatsBefore[bi]!;
    if (beat.beatType === "pause") continue;
    for (const r of bodyRegionsForBeat(beat)) regions.add(r);
    seen += 1;
  }

  return regions;
}

/** True when matchedTag's body region clearly conflicts with nearby beats' topical anchors. */
export function topicalCoherenceBlocksTagConversion(params: {
  matchedTag: string;
  assembled: ScriptLabBeat[];
  beatsBefore: ScriptLabBeat[];
  beatIndex: number;
  beatSentences: VerificationSentence[];
  sentenceIdxInBeat: number;
  pendingCustomText: string[];
  windowNonPauseBeats?: number;
}): boolean {
  const tagRegions = bodyRegionsForTag(params.matchedTag);
  if (tagRegions.size === 0) return false;

  const tagSpecific = [...tagRegions].filter((r) => r !== "whole_body");
  if (tagSpecific.length === 0) return false;

  const nearby = collectNearbyBodyRegions({
    ...params,
    windowNonPauseBeats:
      params.windowNonPauseBeats ?? VERIFICATION_TOPICAL_WINDOW,
  });
  const contextSpecific = [...nearby].filter((r) => r !== "whole_body");
  if (contextSpecific.length === 0) return false;

  for (const region of tagSpecific) {
    if (contextSpecific.includes(region)) return false;
  }

  return true;
}

function customSentenceText(s: VerificationSentence): string {
  const pauseSuffix = s.trailingPauseBands
    .map((b) => `[[PAUSE ${b}]]`)
    .join(" ");
  return pauseSuffix ? `${s.prose} ${pauseSuffix}`.trim() : s.prose;
}

export function assembleBeatsFromSentenceVerdicts(params: {
  beatsBefore: ScriptLabBeat[];
  sentences: VerificationSentence[];
  verdicts: SentenceVerdict[];
  generalTags: GeneralTagVariantCatalog[];
}): ScriptLabBeat[] {
  const verdictByIndex = new Map<number, SentenceVerdict>();
  for (const v of params.verdicts) {
    verdictByIndex.set(v.sentenceIndex, v);
  }

  const sentencesByBeat = new Map<number, VerificationSentence[]>();
  for (const s of params.sentences) {
    const list = sentencesByBeat.get(s.beatIndex) ?? [];
    list.push(s);
    sentencesByBeat.set(s.beatIndex, list);
  }

  const out: ScriptLabBeat[] = [];

  params.beatsBefore.forEach((beat, beatIndex) => {
    if (!beat.custom || !beat.text?.trim()) {
      out.push(beat);
      return;
    }

    const beatSentences = sentencesByBeat.get(beatIndex) ?? [];
    if (beatSentences.length === 0) {
      out.push(beat);
      return;
    }

    let customBuffer: string[] = [];
    const beatType = beat.beatType;

    const flushCustom = () => {
      if (customBuffer.length === 0) return;
      out.push({
        beatType,
        custom: true,
        text: customBuffer.join(" ").trim(),
      });
      customBuffer = [];
    };

    for (const s of beatSentences) {
      const rawVerdict = verdictByIndex.get(s.globalIndex) ?? {
        sentenceIndex: s.globalIndex,
        verdict: "keep_custom" as const,
        confidence: "low" as const,
      };
      const kind = effectiveVerdict(rawVerdict, params.generalTags);
      const sentenceIdxInBeat = beatSentences.indexOf(s);

      if (kind === "convert_tag" && rawVerdict.matchedTag) {
        const gateParams = {
          matchedTag: rawVerdict.matchedTag,
          assembled: out,
          beatsBefore: params.beatsBefore,
          beatIndex,
          beatSentences,
          sentenceIdxInBeat,
          pendingCustomText: customBuffer,
        };
        if (
          proximityBlocksTagConversion(out, rawVerdict.matchedTag) ||
          topicalCoherenceBlocksTagConversion(gateParams)
        ) {
          customBuffer.push(customSentenceText(s));
          continue;
        }
        flushCustom();
        out.push({
          beatType: tagNameToBeatType(rawVerdict.matchedTag),
          custom: false,
          tag: rawVerdict.matchedTag,
        });
        for (const band of s.trailingPauseBands) {
          out.push({ beatType: "pause", custom: false, pauseBand: band });
        }
      } else {
        customBuffer.push(customSentenceText(s));
      }
    }

    flushCustom();
  });

  return out;
}

export function beatsEqual(a: ScriptLabBeat, b: ScriptLabBeat): boolean {
  if (a.beatType !== b.beatType) return false;
  if (a.custom !== b.custom) return false;
  if ((a.tag ?? "") !== (b.tag ?? "")) return false;
  if ((a.text ?? "").trim() !== (b.text ?? "").trim()) return false;
  if ((a.pauseBand ?? "") !== (b.pauseBand ?? "")) return false;
  return true;
}

/** Indices of after beats that differ from every beat in the before list. */
export function computeVerificationNewBeatIndices(
  before: ScriptLabBeat[],
  after: ScriptLabBeat[],
): number[] {
  const newIndices = new Set<number>();
  after.forEach((beat, i) => {
    const hasExactMatch = before.some((b) => beatsEqual(b, beat));
    if (!hasExactMatch) newIndices.add(i);
  });
  return [...newIndices].sort((a, b) => a - b);
}

function mergeUsage(
  a: { input_tokens: number; output_tokens: number } | null,
  b: { input_tokens: number; output_tokens: number } | null,
): { input_tokens: number; output_tokens: number } | null {
  if (!a && !b) return null;
  return {
    input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0),
    output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0),
  };
}

async function fetchSentenceVerdicts(params: {
  apiKey: string;
  model: string;
  system: string;
  userContent: string;
  sentenceCount: number;
  timeoutMs: number;
}): Promise<{
  verdicts: SentenceVerdict[];
  usage: { input_tokens: number; output_tokens: number } | null;
}> {
  const tool = scriptLabSentenceVerificationToolDefinition(params.sentenceCount);

  const maxTokens = Math.min(16384, Math.max(4096, 256 + params.sentenceCount * 96));

  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: maxTokens,
      temperature: 0,
      system: params.system,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: params.userContent }],
    }),
    signal: AbortSignal.timeout(params.timeoutMs),
  });

  const responseText = await upstream.text();
  if (!upstream.ok) {
    throw new Error(`Verification call failed: ${responseText.slice(0, 500)}`);
  }

  let parsed: { content?: unknown };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error("Invalid JSON from verification call");
  }

  const verdicts = extractSentenceVerdictsFromAnthropicMessage(
    parsed.content,
    params.sentenceCount,
  );

  return {
    verdicts,
    usage: parseAnthropicMessageUsage(responseText),
  };
}

export async function verifyScriptLabBeats(params: {
  apiKey: string;
  model?: string;
  transcript: string;
  beatsBefore: ScriptLabBeat[];
  generalTags: GeneralTagVariantCatalog[];
  timeoutMs?: number;
}): Promise<{
  beats: ScriptLabBeat[];
  beatsBeforeVerification: ScriptLabBeat[];
  newBeatIndices: number[];
  correctionsApplied: boolean;
  sentenceVerdicts: SentenceVerdict[];
  usage: { input_tokens: number; output_tokens: number } | null;
}> {
  const beatsBeforeVerification = params.beatsBefore;
  const generalTags = prepareGeneralTagsForVerification(params.generalTags);

  const hasCustom = params.beatsBefore.some((b) => b.custom && b.text?.trim());
  if (!hasCustom || generalTags.length === 0) {
    return {
      beats: beatsBeforeVerification,
      beatsBeforeVerification,
      newBeatIndices: [],
      correctionsApplied: false,
      sentenceVerdicts: [],
      usage: null,
    };
  }

  const sentences = buildVerificationSentenceList(params.beatsBefore);
  if (sentences.length === 0) {
    return {
      beats: beatsBeforeVerification,
      beatsBeforeVerification,
      newBeatIndices: [],
      correctionsApplied: false,
      sentenceVerdicts: [],
      usage: null,
    };
  }

  const { system, userContent } = buildVerificationPrompt({
    transcript: params.transcript,
    sentences,
    generalTags,
  });

  const model = params.model ?? CLAUDE_SONNET_45_MODEL_ID;
  const timeoutMs = params.timeoutMs ?? 45_000;

  try {
    let usage: { input_tokens: number; output_tokens: number } | null = null;
    let verdicts: SentenceVerdict[] = [];

    const first = await fetchSentenceVerdicts({
      apiKey: params.apiKey,
      model,
      system,
      userContent,
      sentenceCount: sentences.length,
      timeoutMs,
    });
    verdicts = first.verdicts;
    usage = first.usage;

    let missing = missingSentenceIndices(verdicts, sentences.length);
    if (missing.length > 0) {
      console.warn(
        "Beat verification missing sentence indices, retrying:",
        missing.join(", "),
      );
      try {
        const retry = await fetchSentenceVerdicts({
          apiKey: params.apiKey,
          model,
          system,
          userContent: [
            userContent,
            "",
            "### Retry — complete missing verdicts",
            `Prior response omitted sentenceIndex: ${missing.join(", ")}.`,
            `Return submit_sentence_verification_verdicts with exactly ${sentences.length} entries covering indices 0–${sentences.length - 1}.`,
          ].join("\n"),
          sentenceCount: sentences.length,
          timeoutMs,
        });
        const merged = new Map<number, SentenceVerdict>();
        for (const v of verdicts) merged.set(v.sentenceIndex, v);
        for (const v of retry.verdicts) merged.set(v.sentenceIndex, v);
        verdicts = [...merged.values()].sort((a, b) => a.sentenceIndex - b.sentenceIndex);
        usage = mergeUsage(usage, retry.usage);
      } catch (retryErr) {
        console.warn("Beat verification retry failed:", retryErr);
      }

      missing = missingSentenceIndices(verdicts, sentences.length);
      if (missing.length > 0) {
        verdicts = [
          ...verdicts,
          ...defaultKeepCustomVerdicts(missing),
        ].sort((a, b) => a.sentenceIndex - b.sentenceIndex);
      }
    }

    const beats = assembleBeatsFromSentenceVerdicts({
      beatsBefore: params.beatsBefore,
      sentences,
      verdicts,
      generalTags,
    });

    const newBeatIndices = computeVerificationNewBeatIndices(
      beatsBeforeVerification,
      beats,
    );
    const correctionsApplied = newBeatIndices.length > 0;

    return {
      beats,
      beatsBeforeVerification,
      newBeatIndices,
      correctionsApplied,
      sentenceVerdicts: verdicts,
      usage,
    };
  } catch (err) {
    console.warn("Beat verification error:", err);
    return {
      beats: beatsBeforeVerification,
      beatsBeforeVerification,
      newBeatIndices: [],
      correctionsApplied: false,
      sentenceVerdicts: [],
      usage: null,
    };
  }
}
