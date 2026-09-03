/**
 * Script Lab V2 experimental generation path — structure then personalization.
 * Does not modify generateScriptLabScript (V1).
 */
import { parseAnthropicMessageUsage } from "./anthropic-pricing";
import { verifyScriptLabBeats } from "./script-lab-beat-verification";
import {
  mergeUsageBreakdown,
  SCRIPT_LAB_SONNET_MODEL,
  type ScriptLabUsageBreakdownEntry,
} from "./script-lab-models";
import {
  buildTagRepeatabilityMap,
  collapseSameConnectiveSeparatedOnlyByPauses,
  dropDuplicateSingularTagBeats,
  extractBeatsFromAnthropicMessage,
  findDuplicateBeatTypeWarnings,
  scriptLabBeatsToolDefinition,
  tagNameToBeatType,
  type ScriptLabBeat,
  type ScriptLabBeatDuplicateWarning,
} from "./script-lab-beats";
import { normalizePauseBand, SCRIPT_PAUSE_BANDS, SCRIPT_PAUSE_PROMPT_RULES, type ScriptPauseBand } from "./script-pause-bands";
import {
  scriptLabSharedRulesForV2Pass1,
  scriptLabSharedRulesForV2Pass2,
  isSleepMeditationType,
  WAKING_CLOSE_TAGS,
  SLEEP_CLOSING_TAGS,
  SLEEP_CONNECTIVE_TAGS,
} from "./script-lab-shared-prompt-rules";
import {
  selectSegmentVariant,
  type SegmentTagMeta,
  type SegmentVariantCandidate,
} from "./script-segment-variant-select";
import {
  isConnectiveSegmentTag,
  effectiveSegmentRepeatability,
  normalizeScriptSegmentTag,
  repeatabilityPromptLine,
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
    lines.push(`Repeatability: ${repeatabilityPromptLine(rep)}`);
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
  meditationType?: string | null;
}): { ok: true } | { ok: false; errors: string[] } {
  const { skeleton } = params;
  const errors: string[] = [];
  const sleepType = isSleepMeditationType(params.meditationType);

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

  if (sleepType) {
    skeleton.forEach((b, i) => {
      if (b.kind !== "tag") return;
      if ((WAKING_CLOSE_TAGS as readonly string[]).includes(b.tag)) {
        errors.push(
          `Sleep scripts must not use ${b.tag} (beat ${i + 1}) — use SLEEP_THRESHOLD and SLEEP_CLOSE instead.`,
        );
      }
    });

    const closingStart = skeleton.length - 3;
    const closingPause = skeleton[closingStart + 1];
    const sleepClosingOk =
      skeleton.length >= 7 &&
      isTagBeat(skeleton[closingStart]!, SLEEP_CLOSING_TAGS[0]) &&
      closingPause?.kind === "pause" &&
      closingPause.band === "extra-long" &&
      isTagBeat(skeleton[closingStart + 2]!, SLEEP_CLOSING_TAGS[1]);
    if (!sleepClosingOk) {
      errors.push(
        "Sleep closing must end with SLEEP_THRESHOLD → pause extra-long → SLEEP_CLOSE (exact last three beats; SLEEP_CLOSE is the final beat).",
      );
    }

    if (sleepClosingOk) {
      for (let i = closingStart; i < skeleton.length; i++) {
        const b = skeleton[i]!;
        if (b.kind !== "tag") continue;
        if (!(SLEEP_CLOSING_TAGS as readonly string[]).includes(b.tag)) {
          errors.push(
            `Sleep closing may only use ${SLEEP_CLOSING_TAGS.join(", ")} (found ${b.tag} at beat ${i + 1}).`,
          );
        }
      }
      for (let i = 0; i < closingStart; i++) {
        const b = skeleton[i]!;
        if (b.kind !== "tag") continue;
        if (b.tag === SLEEP_CLOSING_TAGS[0] || b.tag === SLEEP_CLOSING_TAGS[1]) {
          errors.push(
            `${b.tag} must appear only in the closing sequence (found at beat ${i + 1}).`,
          );
        }
      }
    }
  } else {
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

    if (closingOk) {
      for (let i = closingStart; i < skeleton.length; i++) {
        const b = skeleton[i]!;
        if (b.kind !== "tag") continue;
        if (isConnectiveSegmentTag(b.tag, params.tagRepeatabilityByName[b.tag])) {
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

  if (sleepType) {
    const closingStart = skeleton.length - 3;
    if (skeleton.length >= 7) {
      for (let i = closingStart; i < skeleton.length; i++) {
        const b = skeleton[i]!;
        if (b.kind !== "tag") continue;
        if ((SLEEP_CONNECTIVE_TAGS as readonly string[]).includes(b.tag)) {
          errors.push(
            `Connective sleep tag ${b.tag} must not appear in the closing phase (beat ${i + 1}).`,
          );
        }
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
  recentVariantIds?: readonly string[];
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

    const tag = normalizeScriptSegmentTag(slot.tag);
    const alreadyUsed = usedByTag.get(tag) ?? [];
    const picked = pickVariantForV2TagSlot({
      tag,
      variantsByTag: params.variantsByTag,
      tagMetaByName: params.tagMetaByName,
      beatType: tagNameToBeatType(tag),
      targetMinutes: params.targetMinutes,
      meditationType: params.meditationType,
      contextTags: params.contextTags,
      recentVariantIds: params.recentVariantIds,
      preferredLengthTier: slot.tier,
      preferredDirection: slot.direction ?? null,
      alreadyUsedVariantIds: alreadyUsed,
    });
    if (picked) {
      usedByTag.set(tag, [...alreadyUsed, picked.variantId]);
      out.push({
        beatType: tagNameToBeatType(tag),
        custom: false,
        tag,
        text: picked.text,
      });
    } else {
      // No library variants at all — keep tag without locked text (filled later if possible).
      out.push({
        beatType: tagNameToBeatType(tag),
        custom: false,
        tag,
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
  additionalContext?: string;
}): { system: string; userContent: string } {
  const style = params.journalMode
    ? "Infer style from the journal conversation."
    : `Meditation type / style: ${params.meditationStyle}.`;
  const additional = params.additionalContext?.trim() ?? "";
  return {
    system: [
      "You are building ONLY the structural skeleton for a guided meditation (Script Lab V2 pass 1).",
      "Do not write spoken custom prose. Output tag slots, pause slots, and at most one focus_anchor.",
      "Infer structure from meditation type and user input — body scan tour, breathing sequence, visualization arc, etc. Do not invent type-specific hardcodes beyond the opening/closing constraints.",
    ].join(" "),
    userContent: [
      style,
      `Target duration: ${params.targetMinutes} minutes.`,
      ...(additional
        ? [
            "",
            "### Additional context (user free-text — plan structure around this)",
            additional,
            "Leave room in the core (and opening adjacency) for Pass 2 to weave this distinctive detail into spoken custom beats.",
          ]
        : []),
      "",
      "### Hard constraints (must obey)",
      "Opening — exact first four beats:",
      "SETTLE_OPENER (tag) → pause → BREATH_OPENER (tag) → pause",
      "",
      ...(isSleepMeditationType(params.journalMode ? null : params.meditationStyle)
        ? [
            "Closing — exact last three beats (Sleep type):",
            "SLEEP_THRESHOLD (tag) → pause extra-long → SLEEP_CLOSE (tag — final beat; nothing after)",
            "",
            "Sleep scripts must never use CLOSE_DEEPEN_BREATH, CLOSE_SENSORY_RETURN, CLOSE_EYES_OPEN, or CLOSE_SENDOFF.",
            "Place SLEEP_PERMISSION_DRIFT, SLEEP_HEAVINESS, SLEEP_RELEASE_CUE, and SLEEP_THOUGHT_DISSOLVE in the core deepening section only — not in the closing sequence.",
          ]
        : [
            "Closing — exact last seven beats:",
            "CLOSE_DEEPEN_BREATH → pause → CLOSE_SENSORY_RETURN → pause → CLOSE_EYES_OPEN → pause → CLOSE_SENDOFF",
          ]),
      "",
      "Core — everything between opening and closing. You decide freely from type/input.",
      "Singular tags: at most once. Connective tags: only in the core, never in closing.",
      isSleepMeditationType(params.journalMode ? null : params.meditationStyle)
        ? "Sleep connective tags (SLEEP_PERMISSION_DRIFT, SLEEP_HEAVINESS, SLEEP_RELEASE_CUE, SLEEP_THOUGHT_DISSOLVE) deepen the core — never in the closing three beats."
        : "",
      params.requireFocusAnchor
        ? `Include exactly one focus_anchor in the core for the user's linger region. Default depth for this duration: ${params.defaultFocusDepth} (2m=light, 5m=medium, 10/20m=deep) unless the conversation clearly needs otherwise.`
        : "Include a focus_anchor in the core only if the user named a specific linger region.",
      "For each tag slot set tier (short|medium|long). Set direction (up|down|neutral) only when the catalog lists Available directions for that tag — match the travel already implied by the user's request / tour order.",
      "",
      SCRIPT_PAUSE_PROMPT_RULES,
      scriptLabSharedRulesForV2Pass1(
        params.targetMinutes,
        params.journalMode ? null : params.meditationStyle,
      ),
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

/** Pull the style-intake "Anything else?" user reply from a packaged transcript. */
export function extractAdditionalContextFromTranscript(transcript: string): string {
  const marker = /Anything else you would like to add\?/i;
  const match = marker.exec(transcript);
  if (!match || match.index == null) return "";
  const after = transcript.slice(match.index + match[0].length);
  const userMatch = /\n\s*User:\s*([\s\S]*?)(?=\n\s*(?:Guide|User):|$)/i.exec(after);
  return (userMatch?.[1] ?? "").trim();
}

function buildPassTwoPrompt(params: {
  transcript: string;
  meditationStyle: string;
  journalMode: boolean;
  renderedSkeleton: ScriptLabBeat[];
  focusDepth: "light" | "medium" | "deep" | null;
  additionalContext?: string;
}): { system: string; userContent: string } {
  const depth = params.focusDepth ?? "medium";
  const additional =
    params.additionalContext?.trim() ||
    extractAdditionalContextFromTranscript(params.transcript);
  const styleLine = params.journalMode
    ? "Meditation type / style: infer from the conversation (journal / free-form)."
    : `Meditation type / style: ${params.meditationStyle}.`;

  const personalizationLead: string[] = [
    "### Personalization signal ranking (read carefully)",
    "All of the following carry **equal weight**. Free-text additional context is **not** optional decoration and is **not** secondary to structured fields (breath type, current state, pace preference, etc.).",
    styleLine,
    "Structured intake answers (breath preference, current state, pace, etc.) — use them.",
  ];
  if (additional) {
    personalizationLead.push(
      "",
      "### Additional context (user free-text — most distinctive personalization signal)",
      additional,
      "",
      "If this free-text describes a physical situation, emotional state, place, posture, or specific context, it should be the **most distinctive element** of the script — not an afterthought slotted into an otherwise generic breath-led (or type-default) script.",
      "",
      "**Required personalization touchpoints (at least three, each earned and specific):**",
      "1. **Opening acknowledgment** — acknowledge their concrete situation (not a generic settle with one noun swapped in).",
      "2. **Mid-script callback** — return to that detail as a lived breath/anchor/metaphor or sensory reference that fits the practice.",
      "3. **Closing reference** — a brief, specific closing nod to the same situation or image.",
      "Each touchpoint should feel written for this person. Avoid generic lines with a single detail pasted in.",
    );
  } else {
    personalizationLead.push(
      "",
      "No separate free-text additional-context field was provided — personalize from the structured answers and conversation. Still write for this specific person, not a generic user of the meditation type.",
      "",
      "**Required personalization touchpoints (at least three, each earned and specific):**",
      "1. Opening acknowledgment of their stated situation/state",
      "2. Mid-script callback to a distinctive detail from intake",
      "3. Closing reference that echoes that same thread",
    );
  }

  return {
    system: [
      "You are completing a meditation script (Script Lab V2 pass 2).",
      "The rendered skeleton is only the structural foundation — generic library segments are the floor, not the ceiling.",
      "Your job is to make this script feel written for this specific person, not for a generic user of this meditation type.",
      "Personalized custom beats are what make the script worth generating fresh.",
      "Free-text additional context (when present) is equal weight to structured fields and must drive distinctive personalization — never treat it as secondary.",
    ].join(" "),
    userContent: [
      ...personalizationLead,
      "",
      "### Creator conversation (full intake — structured answers + context)",
      params.transcript.trim() || "(empty)",
      "",
      "### Rendered skeleton (variant texts in place)",
      "This is structure + locked library wording. Do not stop at polishing around it — elevate with specific custom beats.",
      formatRenderedSkeletonForPass2(params.renderedSkeleton),
      "",
      "### Your job",
      `1. FILL the focus_anchor with personalized content — the emotional heart. Write about **${depth}** depth of content for this user's situation. You may expand around surrounding segments or replace them with custom content if personalization warrants it.`,
      "2. ADD custom beats between segments for bridging, transition, and personalized texture. Deliver the **three required personalization touchpoints** above (opening, mid-script, closing).",
      ...(additional
        ? [
            "2b. The free-text **Additional context** must be the most distinctive through-line of those touchpoints (e.g. sitting on a cactus → open with that seat, mid-script use it as breath/anchor metaphor, close with a specific nod).",
          ]
        : []),
      "3. REVIEW for flow. If a rendered segment is redundant with adjacent custom content, clashes, or breaks flow — remove it (omit from output).",
      "4. Do not add library segment tags that were not in the skeleton — only remove or keep existing tag beats.",
      "5. Do not change the opening or closing phase structure (same tags and pause pattern).",
      "6. Personalization always wins — if custom makes a segment redundant, remove the segment. Never keep both.",
      "7. A script that could belong to any user of this meditation type is a failed Pass 2 — rewrite custom beats until it could only belong to this intake.",
      "",
      scriptLabSharedRulesForV2Pass2(
        params.journalMode ? null : params.meditationStyle,
      ),
      "",
      "Return the complete script via submit_meditation_script_beats.",
      "For library tags you keep: `{ tag: \"TAG\", text: \"…\" }` — copy the **exact** variant text from the rendered skeleton for that tag. Do not rewrite, paraphrase, or omit the locked variant wording. Omit `beatType` and `custom`; both are derived from the tag.",
      "For custom prose: `{ beatType: \"content\", text: \"...\" }` (or a fitting beatType).",
      "For pauses: `{ pauseBand: \"medium\" }` etc.",
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
    if (!b.custom && b.tag === "SLEEP_THRESHOLD") break;
    if (!inCore) continue;
    if (b.custom && b.beatType !== "pause" && b.text?.trim()) count += 1;
  }
  return count;
}

/**
 * Resolve variants for a tag from the live library map (normalized key lookup).
 * Not a hardcoded allowlist — any tag present in variantsByTag is selectable.
 */
export function resolveLibraryVariantsForTag(
  variantsByTag: Record<string, SegmentVariantCandidate[]>,
  tag: string,
): SegmentVariantCandidate[] {
  const normalized = normalizeScriptSegmentTag(tag);
  const direct = variantsByTag[normalized] ?? variantsByTag[tag];
  if (direct && direct.length > 0) return direct;
  for (const [key, variants] of Object.entries(variantsByTag)) {
    if (normalizeScriptSegmentTag(key) === normalized && variants.length > 0) {
      return variants;
    }
  }
  return [];
}

function resolveTagMeta(
  tagMetaByName: Record<string, SegmentTagMeta>,
  tag: string,
): SegmentTagMeta | undefined {
  const normalized = normalizeScriptSegmentTag(tag);
  return tagMetaByName[normalized] ?? tagMetaByName[tag];
}

function isSegPlaceholderText(text: string | undefined | null): boolean {
  if (!text?.trim()) return false;
  return /^\[\[SEG:[^\]]+\]\]$/i.test(text.trim());
}

/**
 * Pick a library variant for a V2 skeleton/tag slot.
 * Uses the full live library for that tag; falls back when preferred tier/direction
 * or eligibility filters empty the pool so we never invent a static tag allowlist.
 */
export function pickVariantForV2TagSlot(params: {
  tag: string;
  variantsByTag: Record<string, SegmentVariantCandidate[]>;
  tagMetaByName: Record<string, SegmentTagMeta>;
  beatType?: string | null;
  targetMinutes: number;
  meditationType: string | null;
  contextTags: string[];
  recentVariantIds?: readonly string[];
  preferredLengthTier?: ScriptLengthTier | null;
  preferredDirection?: "up" | "down" | "neutral" | null;
  alreadyUsedVariantIds?: readonly string[];
}): SegmentVariantCandidate | null {
  const tag = normalizeScriptSegmentTag(params.tag);
  const variants = resolveLibraryVariantsForTag(params.variantsByTag, tag);
  if (variants.length === 0) return null;

  const tagMeta = resolveTagMeta(params.tagMetaByName, tag);
  const alreadyUsed = params.alreadyUsedVariantIds ?? [];

  const withPrefs = selectSegmentVariant({
    variants,
    tagMeta,
    tagName: tag,
    beatType: params.beatType,
    targetMinutes: params.targetMinutes,
    meditationType: params.meditationType,
    contextTags: params.contextTags,
    recentVariantIds: params.recentVariantIds,
    preferredLengthTier: params.preferredLengthTier,
    preferredDirection: params.preferredDirection,
    alreadyUsedVariantIds: alreadyUsed,
    random: true,
  });
  if (withPrefs?.text?.trim()) return withPrefs;

  const withoutPrefs = selectSegmentVariant({
    variants,
    tagMeta,
    tagName: tag,
    beatType: params.beatType,
    targetMinutes: params.targetMinutes,
    meditationType: params.meditationType,
    contextTags: params.contextTags,
    recentVariantIds: params.recentVariantIds,
    alreadyUsedVariantIds: alreadyUsed,
    random: true,
  });
  if (withoutPrefs?.text?.trim()) return withoutPrefs;

  // Last resort: any library variant for this tag (ignore eligibility).
  const used = new Set(alreadyUsed);
  const withText = variants.filter((v) => v.text?.trim());
  const unused = withText.filter((v) => !used.has(v.variantId));
  const pool = unused.length > 0 ? unused : withText;
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/**
 * Re-attach Pass-1 rendered variant text onto kept library tag beats.
 * Pass 2 may omit text; we never re-roll variants after personalization when
 * Pass 1 already locked real wording (not [[SEG:…]] placeholders).
 */
export function restoreRenderedVariantText(
  beats: ScriptLabBeat[],
  renderedSkeleton: ScriptLabBeat[],
): ScriptLabBeat[] {
  const textsByTag = new Map<string, string[]>();
  for (const b of renderedSkeleton) {
    if (b.custom || b.beatType === "pause" || !b.tag) continue;
    const text = b.text?.trim();
    if (!text || isSegPlaceholderText(text)) continue;
    const tag = normalizeScriptSegmentTag(b.tag);
    const list = textsByTag.get(tag) ?? [];
    list.push(text);
    textsByTag.set(tag, list);
  }
  const nextIndex = new Map<string, number>();

  return beats.map((b) => {
    if (b.custom || b.beatType === "pause" || !b.tag) return b;
    const tag = normalizeScriptSegmentTag(b.tag);
    const queue = textsByTag.get(tag) ?? [];
    const i = nextIndex.get(tag) ?? 0;
    nextIndex.set(tag, i + 1);
    const fromRender = queue[i];
    if (fromRender) {
      return { ...b, custom: false, tag, text: fromRender };
    }
    if (b.text?.trim() && !isSegPlaceholderText(b.text)) {
      return { ...b, custom: false, tag, text: b.text.trim() };
    }
    return { beatType: b.beatType, custom: false, tag };
  });
}

/**
 * Ensure every library tag beat has real variant text from the live library.
 * Covers tags whose preferred-tier pick failed, verification-added tags, etc.
 */
export function fillMissingTagVariantTexts(params: {
  beats: ScriptLabBeat[];
  variantsByTag: Record<string, SegmentVariantCandidate[]>;
  tagMetaByName: Record<string, SegmentTagMeta>;
  targetMinutes: number;
  meditationType: string | null;
  contextTags: string[];
  recentVariantIds?: readonly string[];
}): ScriptLabBeat[] {
  const usedByTag = new Map<string, string[]>();

  for (const b of params.beats) {
    if (b.custom || b.beatType === "pause" || !b.tag) continue;
    if (!b.text?.trim() || isSegPlaceholderText(b.text)) continue;
    const tag = normalizeScriptSegmentTag(b.tag);
    const variants = resolveLibraryVariantsForTag(params.variantsByTag, tag);
    const match = variants.find((v) => v.text.trim() === b.text!.trim());
    if (match) {
      usedByTag.set(tag, [...(usedByTag.get(tag) ?? []), match.variantId]);
    }
  }

  return params.beats.map((b) => {
    if (b.custom || b.beatType === "pause" || !b.tag) return b;
    const tag = normalizeScriptSegmentTag(b.tag);
    if (b.text?.trim() && !isSegPlaceholderText(b.text)) {
      return { ...b, custom: false, tag, text: b.text.trim() };
    }
    const alreadyUsed = usedByTag.get(tag) ?? [];
    const picked = pickVariantForV2TagSlot({
      tag,
      variantsByTag: params.variantsByTag,
      tagMetaByName: params.tagMetaByName,
      beatType: b.beatType,
      targetMinutes: params.targetMinutes,
      meditationType: params.meditationType,
      contextTags: params.contextTags,
      recentVariantIds: params.recentVariantIds,
      alreadyUsedVariantIds: alreadyUsed,
    });
    if (!picked) {
      return { beatType: b.beatType, custom: false, tag };
    }
    usedByTag.set(tag, [...alreadyUsed, picked.variantId]);
    return {
      beatType: b.beatType,
      custom: false,
      tag,
      text: picked.text,
    };
  });
}

export async function generateScriptLabScriptV2(params: {
  apiKey: string;
  /** @deprecated Display-only; pass 1/2 always use SCRIPT_LAB_SONNET_MODEL. */
  model?: string;
  transcript: string;
  meditationStyle: string;
  journalMode: boolean;
  targetMinutes: number;
  speechSpeed: number;
  /** Explicit "Anything else?" free-text; falls back to transcript extraction. */
  additionalContext?: string;
  segmentTags: SegmentTagForPrompt[];
  variantsByTag: Record<string, SegmentVariantCandidate[]>;
  tagMetaByName: Record<string, SegmentTagMeta & { repeatability?: ScriptSegmentRepeatability }>;
  generalTagVariants: Array<{
    name: string;
    repeatability?: ScriptSegmentRepeatability;
    description?: string;
    scope?: "general" | "types";
    types?: string[];
    variants: Array<{
      variantId: string;
      text: string;
      direction?: string | null;
      requiredConstraints?: string[];
      excludedConstraints?: string[];
    }>;
  }>;
  contextTags?: string[];
  recentVariantIds?: readonly string[];
}): Promise<{
  beats: ScriptLabBeat[];
  beatsBeforeVerification: ScriptLabBeat[];
  verificationNewBeatIndices: number[];
  verificationCorrectionsApplied: boolean;
  beatWarnings: ScriptLabBeatDuplicateWarning[];
  usage: { input_tokens: number; output_tokens: number } | null;
  usageBreakdown: ScriptLabUsageBreakdownEntry[];
  /** First Pass 1 call only (before retry / pass 2 / verification). */
  firstPassUsage: { input_tokens: number; output_tokens: number } | null;
  v2Meta: ScriptLabV2Meta;
}> {
  const meditationType = params.journalMode ? null : params.meditationStyle;
  const contextTags = params.contextTags ?? [];
  const recentVariantIds = params.recentVariantIds ?? [];
  const fillParams = {
    variantsByTag: params.variantsByTag,
    tagMetaByName: params.tagMetaByName,
    targetMinutes: params.targetMinutes,
    meditationType,
    contextTags,
    recentVariantIds,
  };
  const additionalContext =
    params.additionalContext?.trim() ||
    extractAdditionalContextFromTranscript(params.transcript);
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
    additionalContext,
  });
  const skeletonTool = scriptLabSkeletonToolDefinition();

  let pass1 = await callAnthropicTool({
    apiKey: params.apiKey,
    model: SCRIPT_LAB_SONNET_MODEL,
    system: pass1Prompt.system,
    userContent: pass1Prompt.userContent,
    tool: skeletonTool,
  });
  const firstPassUsage = pass1.usage;
  let skeleton = extractSkeletonFromAnthropicMessage(pass1.content);
  let validation = validateSkeleton({
    skeleton,
    tagRepeatabilityByName,
    requireFocusAnchor: requireFocus,
    meditationType: params.journalMode ? null : params.meditationStyle,
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
      model: SCRIPT_LAB_SONNET_MODEL,
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
      meditationType: params.journalMode ? null : params.meditationStyle,
    });
    if (!validation.ok) {
      throw new Error(
        `V2 skeleton validation failed after retry:\n${validation.errors.join("\n")}`,
      );
    }
  }

  const passOneRenderedRaw = renderSkeletonToBeats({
    skeleton,
    ...fillParams,
  });
  const passOneRendered = fillMissingTagVariantTexts({
    beats: passOneRenderedRaw,
    ...fillParams,
  });

  const focusSlot = skeleton.find((b) => b.kind === "focus_anchor");
  const pass2Prompt = buildPassTwoPrompt({
    transcript: params.transcript,
    meditationStyle: params.meditationStyle,
    journalMode: params.journalMode,
    renderedSkeleton: passOneRendered,
    focusDepth: focusSlot?.kind === "focus_anchor" ? focusSlot.depth : null,
    additionalContext,
  });
  const pass2 = await callAnthropicTool({
    apiKey: params.apiKey,
    model: SCRIPT_LAB_SONNET_MODEL,
    system: pass2Prompt.system,
    userContent: pass2Prompt.userContent,
    tool: scriptLabBeatsToolDefinition(),
  });
  const pass2Beats = extractBeatsFromAnthropicMessage(pass2.content);
  const filledBeforeVerify = fillMissingTagVariantTexts({
    beats: restoreRenderedVariantText(pass2Beats, passOneRendered),
    ...fillParams,
  });
  const { beats: beatsBeforeVerification } = dropDuplicateSingularTagBeats(
    filledBeforeVerify,
    tagRepeatabilityByName,
  );

  const verified = await verifyScriptLabBeats({
    apiKey: params.apiKey,
    transcript: params.transcript,
    beatsBefore: beatsBeforeVerification,
    generalTags: params.generalTagVariants,
    meditationType,
    contextTags,
    verificationStage: "v2_verification",
  });

  const beats = collapseSameConnectiveSeparatedOnlyByPauses(
    fillMissingTagVariantTexts({
      beats: restoreRenderedVariantText(verified.beats, passOneRendered),
      ...fillParams,
    }),
    tagRepeatabilityByName,
  );
  const beatsBeforeVerificationOut = collapseSameConnectiveSeparatedOnlyByPauses(
    fillMissingTagVariantTexts({
      beats: restoreRenderedVariantText(
        verified.beatsBeforeVerification,
        passOneRendered,
      ),
      ...fillParams,
    }),
    tagRepeatabilityByName,
  );
  const beatWarnings = findDuplicateBeatTypeWarnings(
    beats,
    tagRepeatabilityByName,
  );

  const removedTags = computeRemovedTags(passOneRendered, beats);
  const focusAnchorBeats = countFocusAnchorBeats(beats);

  const usageBreakdown = mergeUsageBreakdown(
    pass1.usage
      ? [
          {
            stage: "v2_pass1_skeleton",
            model: SCRIPT_LAB_SONNET_MODEL,
            usage: pass1.usage,
          },
        ]
      : undefined,
    pass1RetryUsage
      ? [
          {
            stage: "v2_pass1_skeleton",
            model: SCRIPT_LAB_SONNET_MODEL,
            usage: pass1RetryUsage,
          },
        ]
      : undefined,
    pass2.usage
      ? [
          {
            stage: "v2_pass2_personalization",
            model: SCRIPT_LAB_SONNET_MODEL,
            usage: pass2.usage,
          },
        ]
      : undefined,
    verified.usageBreakdown,
  );

  return {
    beats,
    beatsBeforeVerification: beatsBeforeVerificationOut,
    verificationNewBeatIndices: verified.newBeatIndices,
    verificationCorrectionsApplied: verified.correctionsApplied,
    beatWarnings,
    usage: mergeUsage(pass1.usage, pass1RetryUsage, pass2.usage, verified.usage),
    usageBreakdown,
    firstPassUsage,
    v2Meta: {
      passOneSkeleton: skeleton,
      passOneRendered,
      removedTags,
      focusAnchorBeats,
    },
  };
}
