/**
 * Script Lab V2 experimental generation path — structure then personalization.
 * Does not modify generateScriptLabScript (V1).
 */
import { parseAnthropicMessageUsage } from "./anthropic-pricing";
import { verifyScriptLabBeats } from "./script-lab-beat-verification";
import {
  buildTagRepeatabilityMap,
  extractBeatsFromAnthropicMessage,
  findDuplicateBeatTypeWarnings,
  scriptLabBeatsToolDefinition,
  tagNameToBeatType,
  type ScriptLabBeat,
  type ScriptLabBeatDuplicateWarning,
} from "./script-lab-beats";
import { normalizePauseBand, SCRIPT_PAUSE_BANDS, type ScriptPauseBand } from "./script-pause-bands";
import {
  selectSegmentVariant,
  type SegmentTagMeta,
  type SegmentVariantCandidate,
} from "./script-segment-variant-select";
import {
  CONNECTIVE_SEGMENT_TAGS,
  effectiveSegmentRepeatability,
  normalizeScriptSegmentTag,
  typesMatchMeditationType,
  type ScriptLengthTier,
  type ScriptSegmentRepeatability,
} from "./script-segment-tags";
import type { SegmentTagForPrompt } from "./script-segment-tag-metrics";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export type SkeletonBeat =
  | {
      kind: "tag";
      tag: string;
      tier: ScriptLengthTier;
      direction?: "up" | "down" | "neutral";
    }
  | { kind: "pause"; band: ScriptPauseBand }
  | {
      kind: "focus_anchor";
      region: string;
      depth: "light" | "medium" | "deep";
    };

export type ScriptLabV2Meta = {
  passOneSkeleton: SkeletonBeat[];
  passOneRendered: ScriptLabBeat[];
  removedTags: string[];
  focusAnchorBeats: number;
};

const OPENING_TAGS = ["SETTLE_OPENER", "BREATH_OPENER"] as const;
const CLOSING_TAGS = [
  "CLOSE_DEEPEN_BREATH",
  "CLOSE_SENSORY_RETURN",
  "CLOSE_EYES_OPEN",
  "CLOSE_SENDOFF",
] as const;

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

export function defaultFocusAnchorDepth(
  targetMinutes: number,
): "light" | "medium" | "deep" {
  if (targetMinutes <= 2) return "light";
  if (targetMinutes <= 5) return "medium";
  return "deep";
}

/** Soft heuristic: transcript suggests a named linger region. */
export function transcriptImpliesFocusRegion(transcript: string): boolean {
  return /\b(lower back|upper back|jaw|shoulders?|neck|hips?|spine|feet|toes|crown|chest|belly|anxiety|tension|tight)\b/i.test(
    transcript,
  );
}

function formatV2Catalog(params: {
  segmentTags: SegmentTagForPrompt[];
  variantsByTag: Record<string, SegmentVariantCandidate[]>;
  meditationType: string | null;
}): string {
  const lines: string[] = [
    "### Segment catalog",
    "Use only tags listed here. Respect Repeatability and Description.",
    "",
  ];
  const sorted = [...params.segmentTags].sort((a, b) => {
    const aPref = typesMatchMeditationType(a.types, params.meditationType) ? 0 : 1;
    const bPref = typesMatchMeditationType(b.types, params.meditationType) ? 0 : 1;
    if (aPref !== bPref) return aPref - bPref;
    return a.name.localeCompare(b.name);
  });
  for (const t of sorted) {
    const rep =
      t.repeatability ??
      effectiveSegmentRepeatability({ tag: t.name, repeatability: null });
    const variants = params.variantsByTag[t.name] ?? [];
    const dirs = [
      ...new Set(
        variants
          .map((v) => (typeof v.direction === "string" ? v.direction.trim().toLowerCase() : ""))
          .filter((d) => d === "up" || d === "down" || d === "neutral"),
      ),
    ];
    const tiers = [
      ...new Set(
        variants
          .map((v) => v.lengthTier)
          .filter((x): x is ScriptLengthTier => x === "short" || x === "medium" || x === "long"),
      ),
    ];
    lines.push(`### ${t.name}`);
    lines.push(
      t.scope === "general"
        ? "Scope: general"
        : `Scope: types — ${t.types.join(", ") || "(none)"}`,
    );
    lines.push(`Repeatability: ${rep}`);
    if (t.description?.trim()) lines.push(`Description: ${t.description.trim()}`);
    if (tiers.length) lines.push(`Available length tiers: ${tiers.join(", ")}`);
    if (dirs.length) lines.push(`Available directions: ${dirs.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function scriptLabSkeletonToolDefinition(): {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
} {
  return {
    name: "submit_meditation_skeleton",
    description:
      "Return the structural beat skeleton only — tag slots, pauses, and optional focus_anchor. No custom prose.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        beats: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: {
                type: "string",
                enum: ["tag", "pause", "focus_anchor"],
              },
              tag: {
                type: "string",
                description: "Library tag name when kind=tag",
              },
              tier: {
                type: "string",
                enum: ["short", "medium", "long"],
                description: "Length tier when kind=tag",
              },
              direction: {
                type: "string",
                enum: ["up", "down", "neutral"],
                description: "Variant direction when kind=tag and tag has directional variants",
              },
              band: {
                type: "string",
                enum: [...SCRIPT_PAUSE_BANDS],
                description: "Pause band when kind=pause",
              },
              region: {
                type: "string",
                description: "Focus region label when kind=focus_anchor",
              },
              depth: {
                type: "string",
                enum: ["light", "medium", "deep"],
                description: "Focus depth when kind=focus_anchor",
              },
            },
            required: ["kind"],
          },
        },
      },
      required: ["beats"],
    },
  };
}

function normalizeSkeletonBeat(raw: unknown, index: number): SkeletonBeat {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Skeleton beat ${index + 1} is not an object`);
  }
  const o = raw as Record<string, unknown>;
  const kind = String(o.kind ?? "").trim();
  if (kind === "pause") {
    const band =
      normalizePauseBand(typeof o.band === "string" ? o.band : "") ?? "medium";
    return { kind: "pause", band };
  }
  if (kind === "focus_anchor") {
    const region =
      typeof o.region === "string" && o.region.trim() ? o.region.trim() : "focus";
    const depthRaw = typeof o.depth === "string" ? o.depth.trim() : "medium";
    const depth =
      depthRaw === "light" || depthRaw === "medium" || depthRaw === "deep"
        ? depthRaw
        : "medium";
    return { kind: "focus_anchor", region, depth };
  }
  if (kind === "tag") {
    const tag = normalizeScriptSegmentTag(String(o.tag ?? ""));
    if (!tag) throw new Error(`Skeleton beat ${index + 1} tag missing`);
    const tierRaw = typeof o.tier === "string" ? o.tier.trim() : "medium";
    const tier: ScriptLengthTier =
      tierRaw === "short" || tierRaw === "medium" || tierRaw === "long"
        ? tierRaw
        : "medium";
    const dirRaw = typeof o.direction === "string" ? o.direction.trim().toLowerCase() : "";
    const direction =
      dirRaw === "up" || dirRaw === "down" || dirRaw === "neutral" ? dirRaw : undefined;
    return direction
      ? { kind: "tag", tag, tier, direction }
      : { kind: "tag", tag, tier };
  }
  throw new Error(`Skeleton beat ${index + 1} has invalid kind "${kind}"`);
}

export function parseSkeletonFromToolInput(input: unknown): SkeletonBeat[] {
  if (!input || typeof input !== "object") {
    throw new Error("Skeleton tool input must be an object with beats[]");
  }
  const beatsRaw = (input as { beats?: unknown }).beats;
  if (!Array.isArray(beatsRaw) || beatsRaw.length === 0) {
    throw new Error("beats[] must be a non-empty array");
  }
  return beatsRaw.map((b, i) => normalizeSkeletonBeat(b, i));
}

function extractSkeletonFromAnthropicMessage(content: unknown): SkeletonBeat[] {
  if (!Array.isArray(content)) {
    throw new Error("Anthropic response content missing");
  }
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; name?: string; input?: unknown };
    if (b.type === "tool_use" && b.name === "submit_meditation_skeleton") {
      return parseSkeletonFromToolInput(b.input);
    }
  }
  throw new Error("No submit_meditation_skeleton tool_use in response");
}

function isTagBeat(
  b: SkeletonBeat,
  tag: string,
): b is Extract<SkeletonBeat, { kind: "tag" }> {
  return b.kind === "tag" && b.tag === tag;
}

function isPause(b: SkeletonBeat): boolean {
  return b.kind === "pause";
}

export function validateSkeleton(params: {
  skeleton: SkeletonBeat[];
  tagRepeatabilityByName: Record<string, ScriptSegmentRepeatability>;
  requireFocusAnchor: boolean;
}): { ok: true } | { ok: false; errors: string[] } {
  const { skeleton } = params;
  const errors: string[] = [];

  const openingOk =
    skeleton.length >= 4 &&
    isTagBeat(skeleton[0]!, OPENING_TAGS[0]) &&
    isPause(skeleton[1]!) &&
    isTagBeat(skeleton[2]!, OPENING_TAGS[1]) &&
    isPause(skeleton[3]!);
  if (!openingOk) {
    errors.push(
      `Opening must be ${OPENING_TAGS[0]} → pause → ${OPENING_TAGS[1]} → pause (exact first four beats).`,
    );
  }

  const closingStart = skeleton.length - 7;
  const closingOk =
    closingStart >= 4 &&
    isTagBeat(skeleton[closingStart]!, CLOSING_TAGS[0]) &&
    isPause(skeleton[closingStart + 1]!) &&
    isTagBeat(skeleton[closingStart + 2]!, CLOSING_TAGS[1]) &&
    isPause(skeleton[closingStart + 3]!) &&
    isTagBeat(skeleton[closingStart + 4]!, CLOSING_TAGS[2]) &&
    isPause(skeleton[closingStart + 5]!) &&
    isTagBeat(skeleton[closingStart + 6]!, CLOSING_TAGS[3]);
  if (!closingOk) {
    errors.push(
      "Closing must end with CLOSE_DEEPEN_BREATH → pause → CLOSE_SENSORY_RETURN → pause → CLOSE_EYES_OPEN → pause → CLOSE_SENDOFF (exact last seven beats).",
    );
  }

  const seenSingular = new Set<string>();
  skeleton.forEach((b, i) => {
    if (b.kind !== "tag") return;
    const rep =
      params.tagRepeatabilityByName[b.tag] ??
      effectiveSegmentRepeatability({ tag: b.tag, repeatability: null });
    if (rep !== "singular") return;
    if (seenSingular.has(b.tag)) {
      errors.push(`Singular tag ${b.tag} appears more than once (beat ${i + 1}).`);
    }
    seenSingular.add(b.tag);
  });

  if (closingOk) {
    for (let i = closingStart; i < skeleton.length; i++) {
      const b = skeleton[i]!;
      if (b.kind !== "tag") continue;
      if (CONNECTIVE_SEGMENT_TAGS.has(b.tag)) {
        errors.push(
          `Connective tag ${b.tag} must not appear in the closing phase (beat ${i + 1}).`,
        );
      }
      if (!(CLOSING_TAGS as readonly string[]).includes(b.tag)) {
        errors.push(
          `Closing phase may only use ${CLOSING_TAGS.join(", ")} (found ${b.tag} at beat ${i + 1}).`,
        );
      }
    }
  }

  if (params.requireFocusAnchor) {
    const hasFocus = skeleton.some((b) => b.kind === "focus_anchor");
    if (!hasFocus) {
      errors.push(
        "Transcript implies a focus region — skeleton must include a focus_anchor beat in the core.",
      );
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

export function renderSkeletonToBeats(params: {
  skeleton: SkeletonBeat[];
  variantsByTag: Record<string, SegmentVariantCandidate[]>;
  tagMetaByName: Record<string, SegmentTagMeta>;
  targetMinutes: number;
  meditationType: string | null;
  contextTags: string[];
}): ScriptLabBeat[] {
  const usedByTag = new Map<string, string[]>();
  const out: ScriptLabBeat[] = [];

  for (const slot of params.skeleton) {
    if (slot.kind === "pause") {
      out.push({ beatType: "pause", custom: false, pauseBand: slot.band });
      continue;
    }
    if (slot.kind === "focus_anchor") {
      out.push({
        beatType: "focus_anchor",
        custom: true,
        text: `[[FOCUS_ANCHOR region="${slot.region}" depth="${slot.depth}"]]`,
      });
      continue;
    }

    const alreadyUsed = usedByTag.get(slot.tag) ?? [];
    const picked = selectSegmentVariant({
      variants: params.variantsByTag[slot.tag] ?? [],
      tagMeta: params.tagMetaByName[slot.tag],
      tagName: slot.tag,
      beatType: tagNameToBeatType(slot.tag),
      targetMinutes: params.targetMinutes,
      meditationType: params.meditationType,
      contextTags: params.contextTags,
      preferredLengthTier: slot.tier,
      preferredDirection: slot.direction ?? null,
      alreadyUsedVariantIds: alreadyUsed,
      random: true,
    });
    if (picked) {
      usedByTag.set(slot.tag, [...alreadyUsed, picked.variantId]);
      out.push({
        beatType: tagNameToBeatType(slot.tag),
        custom: false,
        tag: slot.tag,
        text: picked.text,
      });
    } else {
      out.push({
        beatType: tagNameToBeatType(slot.tag),
        custom: false,
        tag: slot.tag,
        text: `[[SEG:${slot.tag}]]`,
      });
    }
  }
  return out;
}

function formatRenderedSkeletonForPass2(beats: ScriptLabBeat[]): string {
  return beats
    .map((b, i) => {
      if (b.beatType === "pause") {
        return `${i}: [PAUSE ${b.pauseBand ?? "medium"}]`;
      }
      if (b.beatType === "focus_anchor" || b.text?.includes("[[FOCUS_ANCHOR")) {
        return `${i}: ${b.text ?? "[FOCUS_ANCHOR]"}`;
      }
      if (!b.custom && b.tag) {
        return `${i}: [TAG ${b.tag}] ${b.text ?? ""}`.trim();
      }
      return `${i}: [CUSTOM ${b.beatType}] ${b.text ?? ""}`.trim();
    })
    .join("\n");
}

function buildPassOnePrompt(params: {
  transcript: string;
  meditationStyle: string;
  journalMode: boolean;
  targetMinutes: number;
  catalog: string;
  requireFocusAnchor: boolean;
  defaultFocusDepth: "light" | "medium" | "deep";
}): { system: string; userContent: string } {
  const style = params.journalMode
    ? "Infer style from the journal conversation."
    : `Meditation type / style: ${params.meditationStyle}.`;
  return {
    system: [
      "You are building ONLY the structural skeleton for a guided meditation (Script Lab V2 pass 1).",
      "Do not write spoken custom prose. Output tag slots, pause slots, and at most one focus_anchor.",
      "Infer structure from meditation type and user input — body scan tour, breathing sequence, visualization arc, etc. Do not invent type-specific hardcodes beyond the opening/closing constraints.",
    ].join(" "),
    userContent: [
      style,
      `Target duration: ${params.targetMinutes} minutes.`,
      "",
      "### Hard constraints (must obey)",
      "Opening — exact first four beats:",
      "SETTLE_OPENER (tag) → pause → BREATH_OPENER (tag) → pause",
      "",
      "Closing — exact last seven beats:",
      "CLOSE_DEEPEN_BREATH → pause → CLOSE_SENSORY_RETURN → pause → CLOSE_EYES_OPEN → pause → CLOSE_SENDOFF",
      "",
      "Core — everything between opening and closing. You decide freely from type/input.",
      "Singular tags: at most once. Connective tags: only in the core, never in closing.",
      params.requireFocusAnchor
        ? `Include exactly one focus_anchor in the core for the user's linger region. Default depth for this duration: ${params.defaultFocusDepth} (2m=light, 5m=medium, 10/20m=deep) unless the conversation clearly needs otherwise.`
        : "Include a focus_anchor in the core only if the user named a specific linger region.",
      "For each tag slot set tier (short|medium|long). Set direction (up|down|neutral) only when the catalog lists Available directions for that tag — match the travel already implied by the user's request / tour order.",
      "",
      params.catalog,
      "",
      "### Creator conversation",
      params.transcript.trim() || "(empty)",
      "",
      "Call submit_meditation_skeleton with the ordered beats array.",
    ].join("\n"),
  };
}

function buildPassTwoPrompt(params: {
  transcript: string;
  renderedSkeleton: ScriptLabBeat[];
  focusDepth: "light" | "medium" | "deep" | null;
}): { system: string; userContent: string } {
  const depth = params.focusDepth ?? "medium";
  return {
    system: [
      "You are completing a meditation script (Script Lab V2 pass 2).",
      "The structural skeleton below is already built and validated — segment texts are rendered.",
      "Personalization always wins.",
    ].join(" "),
    userContent: [
      "### Creator conversation",
      params.transcript.trim() || "(empty)",
      "",
      "### Rendered skeleton (variant texts in place)",
      formatRenderedSkeletonForPass2(params.renderedSkeleton),
      "",
      "### Your job",
      `1. FILL the focus_anchor with personalized content — the emotional heart. Write about **${depth}** depth of content for this user's situation. You may expand around surrounding segments or replace them with custom content if personalization warrants it.`,
      "2. ADD custom beats between segments for bridging, transition, or personalized texture. Flow naturally from rendered text before/after.",
      "3. REVIEW for flow. If a rendered segment is redundant with adjacent custom content, clashes, or breaks flow — remove it (omit from output).",
      "4. Do not add library segment tags that were not in the skeleton — only remove or keep existing tag beats.",
      "5. Do not change the opening or closing phase structure (same tags and pause pattern).",
      "6. Personalization always wins — if custom makes a segment redundant, remove the segment. Never keep both.",
      "",
      "Return the complete script via submit_meditation_script_beats.",
      "For library tags you keep: `{ custom: false, tag: \"TAG\", beatType: \"...\" }` (no text field).",
      "For custom prose: `{ custom: true, text: \"...\", beatType: \"content\" }` (or a fitting beatType).",
      "For pauses: `{ beatType: \"pause\", pauseBand: \"medium\" }` etc.",
      "Do not leave [[FOCUS_ANCHOR ...]] markers in the final output.",
    ].join("\n"),
  };
}

async function callAnthropicTool(params: {
  apiKey: string;
  model: string;
  system: string;
  userContent: string;
  tool: { name: string; description: string; input_schema: Record<string, unknown> };
  maxTokens?: number;
}): Promise<{ content: unknown; usage: { input_tokens: number; output_tokens: number } | null; raw: string }> {
  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens ?? 8192,
      system: params.system,
      tools: [params.tool],
      tool_choice: { type: "tool", name: params.tool.name },
      messages: [{ role: "user", content: params.userContent }],
    }),
  });
  const responseText = await upstream.text();
  if (!upstream.ok) {
    throw new Error(`Anthropic V2 call failed: ${responseText.slice(0, 2000)}`);
  }
  let parsed: { content?: unknown };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error("Invalid JSON from Anthropic (V2)");
  }
  return {
    content: parsed.content,
    usage: parseAnthropicMessageUsage(responseText),
    raw: responseText,
  };
}

function tagsInBeats(beats: ScriptLabBeat[]): string[] {
  return beats
    .filter((b) => !b.custom && !!b.tag)
    .map((b) => normalizeScriptSegmentTag(b.tag!));
}

function computeRemovedTags(
  rendered: ScriptLabBeat[],
  afterPass2: ScriptLabBeat[],
): string[] {
  const before = new Set(tagsInBeats(rendered));
  const after = new Set(tagsInBeats(afterPass2));
  return [...before].filter((t) => !after.has(t)).sort();
}

function countFocusAnchorBeats(beats: ScriptLabBeat[]): number {
  // Custom content beats in the core that are not pauses — proxy for focus fill depth.
  let inCore = false;
  let count = 0;
  for (const b of beats) {
    if (!b.custom && b.tag === "BREATH_OPENER") {
      inCore = true;
      continue;
    }
    if (!b.custom && b.tag === "CLOSE_DEEPEN_BREATH") break;
    if (!inCore) continue;
    if (b.custom && b.beatType !== "pause" && b.text?.trim()) count += 1;
  }
  return count;
}

function stripVariantTextFromTagBeats(beats: ScriptLabBeat[]): ScriptLabBeat[] {
  return beats.map((b) => {
    if (b.custom || b.beatType === "pause") return b;
    if (b.tag) {
      return { beatType: b.beatType, custom: false, tag: b.tag };
    }
    return b;
  });
}

export async function generateScriptLabScriptV2(params: {
  apiKey: string;
  model: string;
  transcript: string;
  meditationStyle: string;
  journalMode: boolean;
  targetMinutes: number;
  speechSpeed: number;
  segmentTags: SegmentTagForPrompt[];
  variantsByTag: Record<string, SegmentVariantCandidate[]>;
  tagMetaByName: Record<string, SegmentTagMeta & { repeatability?: ScriptSegmentRepeatability }>;
  generalTagVariants: Array<{
    name: string;
    repeatability?: ScriptSegmentRepeatability;
    variants: Array<{ variantId: string; text: string; direction?: string | null }>;
  }>;
  contextTags?: string[];
}): Promise<{
  beats: ScriptLabBeat[];
  beatsBeforeVerification: ScriptLabBeat[];
  verificationNewBeatIndices: number[];
  verificationCorrectionsApplied: boolean;
  beatWarnings: ScriptLabBeatDuplicateWarning[];
  usage: { input_tokens: number; output_tokens: number } | null;
  v2Meta: ScriptLabV2Meta;
}> {
  const meditationType = params.journalMode ? null : params.meditationStyle;
  const contextTags = params.contextTags ?? [];
  const tagRepeatabilityByName = buildTagRepeatabilityMap(
    Object.entries(params.tagMetaByName).map(([name, meta]) => ({
      name,
      repeatability: meta.repeatability,
    })),
  );
  const requireFocus = transcriptImpliesFocusRegion(params.transcript);
  const defaultDepth = defaultFocusAnchorDepth(params.targetMinutes);
  const catalog = formatV2Catalog({
    segmentTags: params.segmentTags,
    variantsByTag: params.variantsByTag,
    meditationType,
  });

  const pass1Prompt = buildPassOnePrompt({
    transcript: params.transcript,
    meditationStyle: params.meditationStyle,
    journalMode: params.journalMode,
    targetMinutes: params.targetMinutes,
    catalog,
    requireFocusAnchor: requireFocus,
    defaultFocusDepth: defaultDepth,
  });
  const skeletonTool = scriptLabSkeletonToolDefinition();

  let pass1 = await callAnthropicTool({
    apiKey: params.apiKey,
    model: params.model,
    system: pass1Prompt.system,
    userContent: pass1Prompt.userContent,
    tool: skeletonTool,
  });
  let skeleton = extractSkeletonFromAnthropicMessage(pass1.content);
  let validation = validateSkeleton({
    skeleton,
    tagRepeatabilityByName,
    requireFocusAnchor: requireFocus,
  });

  let pass1RetryUsage: { input_tokens: number; output_tokens: number } | null = null;
  if (!validation.ok) {
    const retryPrompt = {
      system: pass1Prompt.system,
      userContent: [
        pass1Prompt.userContent,
        "",
        "### Validation errors from your previous skeleton — fix and resubmit",
        ...validation.errors.map((e) => `- ${e}`),
      ].join("\n"),
    };
    pass1 = await callAnthropicTool({
      apiKey: params.apiKey,
      model: params.model,
      system: retryPrompt.system,
      userContent: retryPrompt.userContent,
      tool: skeletonTool,
    });
    pass1RetryUsage = pass1.usage;
    skeleton = extractSkeletonFromAnthropicMessage(pass1.content);
    validation = validateSkeleton({
      skeleton,
      tagRepeatabilityByName,
      requireFocusAnchor: requireFocus,
    });
    if (!validation.ok) {
      throw new Error(
        `V2 skeleton validation failed after retry:\n${validation.errors.join("\n")}`,
      );
    }
  }

  const passOneRendered = renderSkeletonToBeats({
    skeleton,
    variantsByTag: params.variantsByTag,
    tagMetaByName: params.tagMetaByName,
    targetMinutes: params.targetMinutes,
    meditationType,
    contextTags,
  });

  const focusSlot = skeleton.find((b) => b.kind === "focus_anchor");
  const pass2Prompt = buildPassTwoPrompt({
    transcript: params.transcript,
    renderedSkeleton: passOneRendered,
    focusDepth: focusSlot?.kind === "focus_anchor" ? focusSlot.depth : null,
  });
  const pass2 = await callAnthropicTool({
    apiKey: params.apiKey,
    model: params.model,
    system: pass2Prompt.system,
    userContent: pass2Prompt.userContent,
    tool: scriptLabBeatsToolDefinition(),
  });
  const pass2Beats = extractBeatsFromAnthropicMessage(pass2.content);
  const beatsBeforeVerification = stripVariantTextFromTagBeats(pass2Beats);

  const verified = await verifyScriptLabBeats({
    apiKey: params.apiKey,
    model: params.model,
    transcript: params.transcript,
    beatsBefore: beatsBeforeVerification,
    generalTags: params.generalTagVariants,
  });

  const beatWarnings = findDuplicateBeatTypeWarnings(
    verified.beats,
    tagRepeatabilityByName,
  );

  const removedTags = computeRemovedTags(passOneRendered, verified.beats);
  const focusAnchorBeats = countFocusAnchorBeats(verified.beats);

  return {
    beats: verified.beats,
    beatsBeforeVerification: verified.beatsBeforeVerification,
    verificationNewBeatIndices: verified.newBeatIndices,
    verificationCorrectionsApplied: verified.correctionsApplied,
    beatWarnings,
    usage: mergeUsage(pass1.usage, pass1RetryUsage, pass2.usage, verified.usage),
    v2Meta: {
      passOneSkeleton: skeleton,
      passOneRendered,
      removedTags,
      focusAnchorBeats,
    },
  };
}
