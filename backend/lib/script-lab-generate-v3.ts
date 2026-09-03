/**
 * Script Lab V3 — custom prose → pause split → personalize classify →
 * vector NN → substitute/promote review → assemble beats.
 * Standalone; does not modify V1/V2 or verification.
 */
import { parseAnthropicMessageUsage } from "./anthropic-pricing";
import { GENDER_NEUTRAL_SCRIPT_RULES } from "./meditation-script-generate-prompt";
import {
  mergeUsageBreakdown,
  SCRIPT_LAB_HAIKU_MODEL,
  SCRIPT_LAB_SONNET_MODEL,
  type ScriptLabUsageBreakdownEntry,
} from "./script-lab-models";
import {
  findDuplicateBeatTypeWarnings,
  tagNameToBeatType,
  type ScriptLabBeat,
  type ScriptLabBeatDuplicateWarning,
} from "./script-lab-beats";
import {
  normalizePauseBand,
  SCRIPT_PAUSE_MARKER_RE,
  SCRIPT_PAUSE_PROMPT_RULES,
  type ScriptPauseBand,
} from "./script-pause-bands";
import { searchVariantCatalog } from "./script-embed-client";
import {
  inferLengthTierFromWordCount,
  putScriptSegmentVariant,
  type ScriptSegmentVariantRow,
} from "./script-segment-library";
import {
  listEligibleSegmentVariants,
  type SegmentTagMeta,
  type SegmentVariantCandidate,
} from "./script-segment-variant-select";
import {
  normalizeScriptSegmentTag,
  type ScriptSegmentRepeatability,
} from "./script-segment-tags";
import { appendScriptLabV3NoMatchLogs } from "./script-lab-v3-no-match-log";
import { scriptPauseBudgetGuidanceAppendix } from "./script-lab-shared-prompt-rules";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/** Substitution candidates go to LLM review at this cosine similarity. */
export const V3_SUBSTITUTION_THRESHOLD = 0.9;
/** Promotion band: below substitution, at/above this. */
export const V3_PROMOTION_THRESHOLD = 0.7;

export type V3Chunk = {
  index: number;
  text: string;
  pauseAfter: ScriptPauseBand | null;
};

export type V3ChunkClass = "personalized" | "generic" | "uncertain";

export type V3Match = {
  variantId: string;
  tag: string;
  text: string;
  score: number;
  source?: string;
  approved?: boolean;
};

type V3DecisionReasoning = { reasoning?: string };

export type V3ChunkDecision =
  | ({
      chunkIndex: number;
      decision: "substitute";
      variantId: string;
      tag: string;
      score: number;
    } & V3DecisionReasoning)
  | ({ chunkIndex: number; decision: "keep_custom" } & V3DecisionReasoning)
  | ({
      chunkIndex: number;
      decision: "promote";
      targetTag: string;
      score: number;
    } & V3DecisionReasoning)
  | ({ chunkIndex: number; decision: "discard" } & V3DecisionReasoning)
  | ({ chunkIndex: number; decision: "personalized" } & V3DecisionReasoning)
  | ({
      chunkIndex: number;
      decision: "no_match";
      topMatchTag?: string;
      topMatchScore?: number;
    } & V3DecisionReasoning);

export type V3PromotionDetail = {
  targetTag: string;
  reasoning?: string;
  existingVariantTexts: string[];
};

export type ScriptLabV3Meta = {
  pass1RawScript: string;
  chunks: V3Chunk[];
  classifications: Record<number, V3ChunkClass>;
  topMatchesByChunk: Record<number, V3Match[]>;
  decisions: V3ChunkDecision[];
  promotionDetailByChunk: Record<number, V3PromotionDetail>;
  beatsAfterSubstitution: ScriptLabBeat[];
  promotedVariantIds: string[];
  noMatchCount: number;
  substitutionCount: number;
  thresholds: { substitution: number; promotion: number };
};

function mergeUsage(
  ...parts: Array<{ input_tokens: number; output_tokens: number } | null | undefined>
): { input_tokens: number; output_tokens: number } | null {
  let any = false;
  let input = 0;
  let output = 0;
  for (const p of parts) {
    if (!p) continue;
    any = true;
    input += p.input_tokens;
    output += p.output_tokens;
  }
  return any ? { input_tokens: input, output_tokens: output } : null;
}

function localPromotionContext(chunks: V3Chunk[], chunkIndex: number): string {
  const window = chunks.filter((c) => Math.abs(c.index - chunkIndex) <= 1);
  return window
    .map((c) => {
      const mark = c.index === chunkIndex ? "» " : "";
      const pause = c.pauseAfter ? ` [[PAUSE ${c.pauseAfter}]]` : "";
      return `${mark}${c.text}${pause}`;
    })
    .join("\n");
}

function promotionNeighborsFromMatches(
  matches: V3Match[],
  limit = 5,
): Array<{ tag: string; text: string; score: number }> {
  return matches.slice(0, limit).map((m) => ({
    tag: m.tag,
    text: m.text.slice(0, 500),
    score: m.score,
  }));
}

async function callAnthropic(params: {
  apiKey: string;
  model: string;
  system: string;
  userContent: string;
  maxTokens?: number;
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  toolChoice?: { type: "tool"; name: string };
}): Promise<{ text: string; toolInput: Record<string, unknown> | null; usage: ReturnType<typeof parseAnthropicMessageUsage> }> {
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxTokens ?? 8192,
    system: params.system,
    messages: [{ role: "user", content: params.userContent }],
  };
  if (params.tools?.length && params.toolChoice) {
    body.tools = params.tools;
    body.tool_choice = params.toolChoice;
  }

  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const responseText = await upstream.text();
  if (!upstream.ok) {
    throw new Error(`Anthropic V3 call failed: ${responseText.slice(0, 2000)}`);
  }
  let parsed: { content?: unknown };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error("Invalid response from Anthropic (V3)");
  }
  const usage = parseAnthropicMessageUsage(responseText);
  let text = "";
  let toolInput: Record<string, unknown> | null = null;
  const content = Array.isArray(parsed.content) ? parsed.content : [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") text += b.text;
    if (b.type === "tool_use" && b.input && typeof b.input === "object") {
      toolInput = b.input as Record<string, unknown>;
    }
  }
  return { text: text.trim(), toolInput, usage };
}

/** Pass 2 — split on [[PAUSE …]] (existing pipeline boundary). */
export function splitScriptOnPauseMarkers(script: string): V3Chunk[] {
  const chunks: V3Chunk[] = [];
  if (!script.trim()) return chunks;
  const re = new RegExp(SCRIPT_PAUSE_MARKER_RE.source, SCRIPT_PAUSE_MARKER_RE.flags);
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(script)) !== null) {
    const raw = script.slice(lastIndex, match.index);
    const text = raw.trim();
    const band = normalizePauseBand(match[1] ?? "");
    if (text) {
      chunks.push({ index: index++, text, pauseAfter: band });
    } else if (band && chunks.length > 0) {
      const prev = chunks[chunks.length - 1]!;
      // Prefer the later band if consecutive pauses
      prev.pauseAfter = band;
    }
    lastIndex = match.index + match[0].length;
  }

  const tail = script.slice(lastIndex).trim();
  if (tail) {
    chunks.push({ index: index++, text: tail, pauseAfter: null });
  }
  return chunks;
}

function classificationTool() {
  return {
    name: "classify_chunks",
    description: "Classify each script chunk as personalized or generic.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["classifications"],
      properties: {
        classifications: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["chunkIndex", "label"],
            properties: {
              chunkIndex: { type: "integer" },
              label: {
                type: "string",
                enum: ["personalized", "generic", "uncertain"],
              },
              confidence: { type: "string", enum: ["high", "low"] },
            },
          },
        },
      },
    },
  };
}

function reviewTool() {
  return {
    name: "review_chunk_decisions",
    description: "Decide substitute, keep_custom, promote, or discard per chunk.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["decisions"],
      properties: {
        decisions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["chunkIndex", "decision"],
            properties: {
              chunkIndex: { type: "integer" },
              decision: {
                type: "string",
                enum: ["substitute", "keep_custom", "promote", "discard"],
              },
              variantId: { type: "string" },
              targetTag: { type: "string" },
              reasoning: { type: "string" },
            },
          },
        },
      },
    },
  };
}

function assembleBeats(params: {
  chunks: V3Chunk[];
  classifications: Record<number, V3ChunkClass>;
  decisions: V3ChunkDecision[];
  variantById: Map<string, { tag: string; text: string }>;
}): ScriptLabBeat[] {
  const decisionByIndex = new Map(params.decisions.map((d) => [d.chunkIndex, d]));
  type Piece =
    | { kind: "custom"; text: string }
    | { kind: "tag"; tag: string; variantId: string; text: string }
    | { kind: "pause"; band: ScriptPauseBand };

  const pieces: Piece[] = [];
  for (const chunk of params.chunks) {
    const cls = params.classifications[chunk.index] ?? "generic";
    const dec = decisionByIndex.get(chunk.index);
    let piece: Piece;

    if (cls === "personalized") {
      piece = { kind: "custom", text: chunk.text };
    } else if (dec?.decision === "substitute") {
      const v = params.variantById.get(dec.variantId);
      piece = {
        kind: "tag",
        tag: dec.tag,
        variantId: dec.variantId,
        text: v?.text ?? chunk.text,
      };
    } else {
      piece = { kind: "custom", text: chunk.text };
    }
    pieces.push(piece);
    if (chunk.pauseAfter) {
      pieces.push({ kind: "pause", band: chunk.pauseAfter });
    }
  }

  // Merge adjacent custom pieces
  const merged: Piece[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (p.kind === "custom" && last?.kind === "custom") {
      last.text = `${last.text} ${p.text}`.replace(/\s+/g, " ").trim();
    } else {
      merged.push(p);
    }
  }

  const beats: ScriptLabBeat[] = [];
  for (const p of merged) {
    if (p.kind === "pause") {
      beats.push({ beatType: "pause", custom: false, pauseBand: p.band });
    } else if (p.kind === "tag") {
      beats.push({
        beatType: tagNameToBeatType(p.tag),
        custom: false,
        tag: normalizeScriptSegmentTag(p.tag),
        text: p.text,
      });
    } else {
      beats.push({ beatType: "content", custom: true, text: p.text });
    }
  }
  return beats;
}

function reviewSystemPrompt(): string {
  return [
    "You review meditation script chunks against library segment variants.",
    "For substitution candidates: decide substitute:variantId or keep_custom.",
    "Only substitute when the match captures essentially the same meaning.",
    "A 0.94 match is almost always substitutable; 0.70 rarely is.",
    "Never substitute a chunk that carries emotional or narrative specificity even if listed as generic.",
    "For promotion candidates: decide promote:TAG_NAME or discard.",
    "Promote only if the chunk adds a meaningfully different instruction, sensory angle, or framing vs existing variants.",
    "Different wording of the same instruction → discard. Genuinely new content → promote.",
    "Include a brief reasoning string for promote, discard, and borderline keep_custom decisions.",
  ].join("\n");
}

function parseReviewDecisions(params: {
  toolInput: Record<string, unknown> | null;
  topMatchesByChunk: Record<number, V3Match[]>;
  usedVariantIds: Set<string>;
  promotionDetailByChunk: Record<number, V3PromotionDetail>;
  variantsByTag: Record<string, Array<SegmentVariantCandidate & Record<string, unknown>>>;
}): V3ChunkDecision[] {
  const reviewDecisions: V3ChunkDecision[] = [];
  const parseReasoning = (r: Record<string, unknown>): string | undefined => {
    const s = typeof r.reasoning === "string" ? r.reasoning.trim() : "";
    return s || undefined;
  };
  const arr = Array.isArray(params.toolInput?.decisions) ? params.toolInput!.decisions : [];
  for (const row of arr) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const chunkIndex = typeof r.chunkIndex === "number" ? r.chunkIndex : -1;
    if (chunkIndex < 0) continue;
    const decision = String(r.decision ?? "");
    const reasoning = parseReasoning(r);
    if (decision === "substitute") {
      const variantId = String(r.variantId ?? "").trim();
      const matches = params.topMatchesByChunk[chunkIndex] ?? [];
      const hit = matches.find((m) => m.variantId === variantId) ?? matches[0];
      if (hit && !params.usedVariantIds.has(hit.variantId)) {
        params.usedVariantIds.add(hit.variantId);
        reviewDecisions.push({
          chunkIndex,
          decision: "substitute",
          variantId: hit.variantId,
          tag: hit.tag,
          score: hit.score,
          reasoning,
        });
      } else {
        reviewDecisions.push({ chunkIndex, decision: "keep_custom", reasoning });
      }
    } else if (decision === "promote") {
      const matches = params.topMatchesByChunk[chunkIndex] ?? [];
      const targetTag = normalizeScriptSegmentTag(
        String(r.targetTag ?? matches[0]?.tag ?? ""),
      );
      const score = matches[0]?.score ?? 0;
      if (targetTag) {
        const existingVariantTexts = (params.variantsByTag[targetTag] ?? [])
          .filter((v) => v.approved !== false)
          .map((v) => v.text);
        params.promotionDetailByChunk[chunkIndex] = {
          targetTag,
          reasoning,
          existingVariantTexts,
        };
        reviewDecisions.push({
          chunkIndex,
          decision: "promote",
          targetTag,
          score,
          reasoning,
        });
      } else {
        reviewDecisions.push({ chunkIndex, decision: "discard", reasoning });
      }
    } else if (decision === "discard") {
      reviewDecisions.push({ chunkIndex, decision: "discard", reasoning });
    } else {
      reviewDecisions.push({ chunkIndex, decision: "keep_custom", reasoning });
    }
  }
  return reviewDecisions;
}

export async function generateScriptLabScriptV3(params: {
  apiKey: string;
  /** @deprecated Display-only; stages use SCRIPT_LAB_*_MODEL constants. */
  model?: string;
  transcript: string;
  meditationStyle: string;
  journalMode: boolean;
  targetMinutes: number;
  speechSpeed: number;
  additionalContext?: string;
  contextTags: string[];
  variantsByTag: Record<
    string,
    Array<
      SegmentVariantCandidate & {
        embedding?: number[];
        source?: string;
        approved?: boolean;
      }
    >
  >;
  tagMetaByName: Record<string, SegmentTagMeta & { repeatability?: ScriptSegmentRepeatability }>;
  tagRepeatabilityByName?: Record<string, ScriptSegmentRepeatability>;
}): Promise<{
  beats: ScriptLabBeat[];
  beatsBeforeVerification: ScriptLabBeat[];
  verificationNewBeatIndices: number[];
  verificationCorrectionsApplied: boolean;
  beatWarnings: ScriptLabBeatDuplicateWarning[];
  usage: { input_tokens: number; output_tokens: number } | null;
  usageBreakdown: ScriptLabUsageBreakdownEntry[];
  /** Pass 1 prose call only — for single-shot cost simulation. */
  firstPassUsage: { input_tokens: number; output_tokens: number } | null;
  v3Meta: ScriptLabV3Meta;
}> {
  const usageBreakdown: ScriptLabUsageBreakdownEntry[] = [];
  const meditationType = params.journalMode ? null : params.meditationStyle;
  const constraintNote =
    params.contextTags.length > 0
      ? `Constraint / context tags: ${params.contextTags.join(", ")}`
      : "No extra constraint tags.";

  // --- Pass 1: custom continuous prose ---
  const pass1 = await callAnthropic({
    apiKey: params.apiKey,
    model: SCRIPT_LAB_SONNET_MODEL,
    system: [
      "You write excellent guided meditation scripts as continuous spoken prose.",
      "Do not use segment tags, beat schemas, JSON, markdown headings, or tool calls.",
      "Personalize naturally from the user's transcript and context.",
      GENDER_NEUTRAL_SCRIPT_RULES,
      SCRIPT_PAUSE_PROMPT_RULES,
      "Output only the spoken script with [[PAUSE …]] markers — nothing else.",
    ].join("\n"),
    userContent: [
      `Meditation type: ${params.journalMode ? "Journal / open" : params.meditationStyle}`,
      `Target duration: ~${params.targetMinutes} minutes (speech speed ${params.speechSpeed}).`,
      constraintNote,
      params.additionalContext?.trim()
        ? `Additional context (must surface): ${params.additionalContext.trim()}`
        : "",
      scriptPauseBudgetGuidanceAppendix(params.targetMinutes, { meditationType }),
      "",
      "User transcript / brief:",
      params.transcript,
      "",
      "Write the best possible meditation script for this user as continuous prose with pause markers only.",
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 8192,
  });

  const rawScript = pass1.text;
  if (!rawScript) throw new Error("V3 Pass 1 returned empty script");
  if (pass1.usage) {
    usageBreakdown.push({
      stage: "v3_pass1_generation",
      model: SCRIPT_LAB_SONNET_MODEL,
      usage: pass1.usage,
    });
  }

  // --- Pass 2: split ---
  const chunks = splitScriptOnPauseMarkers(rawScript);
  if (chunks.length === 0) throw new Error("V3 Pass 2 produced no chunks");

  // --- Pass 3: personalization classification ---
  const chunkList = chunks
    .map((c) => `[${c.index}] ${c.text}`)
    .join("\n\n");
  const pass3 = await callAnthropic({
    apiKey: params.apiKey,
    model: SCRIPT_LAB_HAIKU_MODEL,
    system:
      "Classify each script chunk. personalized = references anything specific to this user's input. generic = would read identically for any user in any meditation of this type. uncertain = borderline (mixed generic framing with user-specific detail, or genuinely unclear). Use uncertain sparingly.",
    userContent: [
      "User transcript:",
      params.transcript,
      "",
      "Chunks:",
      chunkList,
      "",
      "Classify every chunkIndex.",
    ].join("\n"),
    tools: [classificationTool()],
    toolChoice: { type: "tool", name: "classify_chunks" },
  });
  if (pass3.usage) {
    usageBreakdown.push({
      stage: "v3_pass3_classify",
      model: SCRIPT_LAB_HAIKU_MODEL,
      usage: pass3.usage,
    });
  }

  const classifications: Record<number, V3ChunkClass> = {};
  const classArr = Array.isArray(pass3.toolInput?.classifications)
    ? pass3.toolInput!.classifications
    : [];
  for (const row of classArr) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const idx = typeof r.chunkIndex === "number" ? r.chunkIndex : -1;
    const rawLabel = String(r.label ?? "");
    const label: V3ChunkClass =
      rawLabel === "personalized"
        ? "personalized"
        : rawLabel === "uncertain"
          ? "uncertain"
          : "generic";
    if (idx >= 0) {
      classifications[idx] =
        r.confidence === "low" && label === "generic" ? "uncertain" : label;
    }
  }
  for (const c of chunks) {
    if (!classifications[c.index]) classifications[c.index] = "generic";
  }

  // --- Pass 4: NN search for generic + uncertain chunks (substitution candidates) ---
  const genericChunks = chunks.filter(
    (c) =>
      classifications[c.index] === "generic" || classifications[c.index] === "uncertain",
  );
  const catalog: Array<{
    id: string;
    tag: string;
    text: string;
    embedding: number[];
    lengthTier?: string | null;
    direction?: string | null;
    source?: string;
    approved?: boolean;
    requiredConstraints?: string[];
    excludedConstraints?: string[];
  }> = [];

  for (const [tag, variants] of Object.entries(params.variantsByTag)) {
    const meta = params.tagMetaByName[tag];
    for (const v of variants) {
      if (!Array.isArray(v.embedding) || v.embedding.length === 0) continue;
      catalog.push({
        id: v.variantId,
        tag,
        text: v.text,
        embedding: v.embedding,
        lengthTier: v.lengthTier,
        direction: v.direction,
        source: v.source,
        approved: v.approved,
        requiredConstraints: v.requiredConstraints,
        excludedConstraints: v.excludedConstraints,
      });
    }
  }

  const searchResults =
    genericChunks.length > 0 && catalog.length > 0
      ? await searchVariantCatalog({
          queries: genericChunks.map((c) => c.text),
          catalog,
          topK: 25,
        })
      : [];

  const usedVariantIds = new Set<string>();
  const topMatchesByChunk: Record<number, V3Match[]> = {};
  const chunkEmbeddings = new Map<number, number[]>();

  for (let i = 0; i < genericChunks.length; i++) {
    const chunk = genericChunks[i]!;
    const result = searchResults[i];
    if (result?.embedding?.length) chunkEmbeddings.set(chunk.index, result.embedding);
    const metaFiltered: V3Match[] = [];
    for (const m of result?.matches ?? []) {
      if (!m.id || !m.tag) continue;
      if (usedVariantIds.has(m.id)) continue;
      const tagMeta = params.tagMetaByName[m.tag];
      const pool = listEligibleSegmentVariants(
        [
          {
            variantId: m.id,
            text: m.text,
            lengthTier:
              m.lengthTier === "short" || m.lengthTier === "medium" || m.lengthTier === "long"
                ? m.lengthTier
                : null,
            direction: m.direction,
            requiredConstraints:
              catalog.find((c) => c.id === m.id)?.requiredConstraints ?? [],
            excludedConstraints:
              catalog.find((c) => c.id === m.id)?.excludedConstraints ?? [],
          },
        ],
        tagMeta,
        params.targetMinutes,
        meditationType,
        params.contextTags,
      );
      if (pool.length === 0) continue;
      metaFiltered.push({
        variantId: m.id,
        tag: m.tag,
        text: m.text,
        score: m.score,
        source: m.source,
        approved: m.approved,
      });
      if (metaFiltered.length >= 10) break;
    }
    topMatchesByChunk[chunk.index] = metaFiltered;
  }

  // --- Pass 5: substitution + promotion review ---
  const subBlocks: string[] = [];
  const promoBlocks: string[] = [];
  const noMatchDecisions: V3ChunkDecision[] = [];

  for (const chunk of genericChunks) {
    const matches = topMatchesByChunk[chunk.index] ?? [];
    const top = matches[0];
    const topScore = top?.score ?? 0;
    if (topScore >= V3_SUBSTITUTION_THRESHOLD) {
      subBlocks.push(
        [
          `Chunk [${chunk.index}]: "${chunk.text}"`,
          "Top matches:",
          ...matches.map(
            (m, i) =>
              `  ${i + 1}. ${m.tag} id=${m.variantId} (similarity: ${m.score.toFixed(3)}): "${m.text}"`,
          ),
        ].join("\n"),
      );
    } else if (topScore >= V3_PROMOTION_THRESHOLD && top) {
      const existingOnTag = (params.variantsByTag[top.tag] ?? [])
        .filter((v) => v.approved !== false)
        .map((v) => `- "${v.text}"`)
        .join("\n");
      promoBlocks.push(
        [
          `Chunk [${chunk.index}]: "${chunk.text}"`,
          `Closest tag: ${top.tag} (similarity: ${topScore.toFixed(3)})`,
          "Existing variants on this tag:",
          existingOnTag || "(none)",
        ].join("\n"),
      );
    } else {
      noMatchDecisions.push({
        chunkIndex: chunk.index,
        decision: "no_match",
        topMatchTag: top?.tag,
        topMatchScore: top?.score,
      });
    }
  }

  for (const c of chunks) {
    if (classifications[c.index] === "personalized") {
      noMatchDecisions.push({ chunkIndex: c.index, decision: "personalized" });
    }
  }

  let reviewDecisions: V3ChunkDecision[] = [];
  const promotionDetailByChunk: Record<number, V3PromotionDetail> = {};
  let pass5Usage: ReturnType<typeof parseAnthropicMessageUsage> = null;

  if (subBlocks.length > 0 || promoBlocks.length > 0) {
    const reviewTasks: Array<{
      stage: "v3_pass5_substitution_review" | "v3_pass5_promotion_review";
      model: string;
      userContent: string;
    }> = [];

    if (subBlocks.length > 0) {
      reviewTasks.push({
        stage: "v3_pass5_substitution_review",
        model: SCRIPT_LAB_HAIKU_MODEL,
        userContent: [
          `## Substitution candidates (≥ ${V3_SUBSTITUTION_THRESHOLD})`,
          "",
          subBlocks.join("\n\n"),
          "",
          "Return a decision for every listed chunkIndex.",
        ].join("\n"),
      });
    }
    if (promoBlocks.length > 0) {
      reviewTasks.push({
        stage: "v3_pass5_promotion_review",
        model: SCRIPT_LAB_SONNET_MODEL,
        userContent: [
          `## Promotion candidates (${V3_PROMOTION_THRESHOLD}–${V3_SUBSTITUTION_THRESHOLD})`,
          "",
          promoBlocks.join("\n\n"),
          "",
          "Return a decision for every listed chunkIndex.",
        ].join("\n"),
      });
    }

    const reviewResults = await Promise.all(
      reviewTasks.map(async (task) => {
        const result = await callAnthropic({
          apiKey: params.apiKey,
          model: task.model,
          system: reviewSystemPrompt(),
          userContent: task.userContent,
          tools: [reviewTool()],
          toolChoice: { type: "tool", name: "review_chunk_decisions" },
        });
        return { ...task, ...result };
      }),
    );

    for (const result of reviewResults) {
      pass5Usage = mergeUsage(pass5Usage, result.usage);
      if (result.usage) {
        usageBreakdown.push({
          stage: result.stage,
          model: result.model,
          usage: result.usage,
        });
      }
      reviewDecisions.push(
        ...parseReviewDecisions({
          toolInput: result.toolInput,
          topMatchesByChunk,
          usedVariantIds,
          promotionDetailByChunk,
          variantsByTag: params.variantsByTag,
        }),
      );
    }
  }

  const decisions: V3ChunkDecision[] = [...reviewDecisions, ...noMatchDecisions];
  // Ensure every chunk has a decision
  for (const c of chunks) {
    if (!decisions.some((d) => d.chunkIndex === c.index)) {
      decisions.push({ chunkIndex: c.index, decision: "keep_custom" });
    }
  }

  // --- Pass 5b: auto-promotion ---
  const promotedVariantIds: string[] = [];
  for (const d of decisions) {
    if (d.decision !== "promote") continue;
    const chunk = chunks.find((c) => c.index === d.chunkIndex);
    if (!chunk) continue;
    const embedding = chunkEmbeddings.get(d.chunkIndex);
    const matches = topMatchesByChunk[d.chunkIndex] ?? [];
    const nearest = matches[0];
    const neighbors = promotionNeighborsFromMatches(matches);
    const lengthTiered = params.tagMetaByName[d.targetTag]?.lengthTiered === true;
    try {
      const row = await putScriptSegmentVariant({
        tagName: d.targetTag,
        text: chunk.text,
        lengthTier: lengthTiered ? inferLengthTierFromWordCount(chunk.text) : null,
        requiredConstraints: [],
        excludedConstraints: [],
        source: "auto",
        approved: false,
        embedding,
        skipEmbed: Boolean(embedding?.length),
        promotionSimilarity: nearest?.score ?? d.score,
        promotionNearestTag: nearest?.tag ?? d.targetTag,
        promotionNearestText: nearest?.text ?? null,
        promotionContext: localPromotionContext(chunks, d.chunkIndex),
        promotionNeighbors: neighbors.length > 0 ? neighbors : null,
      });
      promotedVariantIds.push(row.variantId);
      if (!embedding?.length) {
        // fire-and-forget embed already scheduled inside put when skipEmbed false
      }
    } catch (err) {
      console.error("V3 auto-promote failed", d.targetTag, err);
    }
  }

  // --- No-match logging ---
  const noMatchRows = decisions.filter((d) => d.decision === "no_match");
  if (noMatchRows.length > 0) {
    await appendScriptLabV3NoMatchLogs(
      noMatchRows.map((d) => {
        const chunk = chunks.find((c) => c.index === d.chunkIndex);
        return {
          text: chunk?.text ?? "",
          meditationType: meditationType ?? "journal",
          targetDuration: params.targetMinutes,
          topMatchTag: d.topMatchTag ?? null,
          topMatchScore: d.topMatchScore ?? null,
        };
      }),
    ).catch((err) => console.error("V3 no-match log", err));
  }

  const variantById = new Map<string, { tag: string; text: string }>();
  for (const [tag, variants] of Object.entries(params.variantsByTag)) {
    for (const v of variants) {
      variantById.set(v.variantId, { tag, text: v.text });
    }
  }

  const beatsAfterSubstitution = assembleBeats({
    chunks,
    classifications,
    decisions,
    variantById,
  });

  const beats = beatsAfterSubstitution;

  const beatWarnings = findDuplicateBeatTypeWarnings(
    beats,
    params.tagRepeatabilityByName,
  );

  const substitutionCount = decisions.filter((d) => d.decision === "substitute").length;

  return {
    beats,
    beatsBeforeVerification: beatsAfterSubstitution,
    verificationNewBeatIndices: [],
    verificationCorrectionsApplied: false,
    beatWarnings,
    usage: mergeUsage(pass1.usage, pass3.usage, pass5Usage),
    usageBreakdown,
    firstPassUsage: pass1.usage,
    v3Meta: {
      pass1RawScript: rawScript,
      chunks,
      classifications,
      topMatchesByChunk,
      decisions,
      promotionDetailByChunk,
      beatsAfterSubstitution,
      promotedVariantIds,
      noMatchCount: noMatchRows.length,
      substitutionCount,
      thresholds: {
        substitution: V3_SUBSTITUTION_THRESHOLD,
        promotion: V3_PROMOTION_THRESHOLD,
      },
    },
  };
}

export type { ScriptSegmentVariantRow };
