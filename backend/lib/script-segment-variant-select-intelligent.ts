import { parseAnthropicMessageUsage } from "./anthropic-pricing";
import { normalizePauseBand } from "./script-pause-bands";
import type { ScriptLabBeat } from "./script-lab-beats";
import {
  createSegmentVariantPickerForBeats,
  inferBodyTourDirectionFromBeats,
  listSelectableSegmentVariants,
  type SegmentTagMeta,
  type SegmentVariantCandidate,
} from "./script-segment-variant-select";
import { normalizeScriptSegmentTag } from "./script-segment-tags";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const VARIANT_TEXT_PROMPT_MAX = 420;

export type IntelligentVariantSelection = {
  picksByBeatIndex: Record<number, string>;
  picksByTag: Record<string, string>;
  modelPicksByBeatIndex: Record<number, string>;
  fallbackBeatIndices: number[];
  usage: { input_tokens: number; output_tokens: number } | null;
};

type TagBeatSlot = {
  beatIndex: number;
  tag: string;
  options: SegmentVariantCandidate[];
};

function truncateForPrompt(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= VARIANT_TEXT_PROMPT_MAX) return t;
  return `${t.slice(0, VARIANT_TEXT_PROMPT_MAX - 1).trim()}…`;
}

function isTagBeat(beat: ScriptLabBeat): boolean {
  return !beat.custom && beat.beatType !== "pause" && !!beat.tag?.trim();
}

function coercePauseBand(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  return normalizePauseBand(raw) ?? raw.trim().toLowerCase();
}

/** Build per-tag-beat eligible option lists (same filters as random fill). */
export function buildEligibleOptionsByTagBeat(params: {
  beats: ReadonlyArray<ScriptLabBeat>;
  variantsByTag: Record<string, SegmentVariantCandidate[]>;
  tagMetaByName?: Record<string, SegmentTagMeta>;
  targetMinutes: number;
  meditationType?: string | null;
  contextTags?: string[];
}): TagBeatSlot[] {
  const tourDirection = inferBodyTourDirectionFromBeats(params.beats);
  const slots: TagBeatSlot[] = [];

  for (let beatIndex = 0; beatIndex < params.beats.length; beatIndex++) {
    const beat = params.beats[beatIndex]!;
    if (!isTagBeat(beat)) continue;
    const tag = normalizeScriptSegmentTag(beat.tag!);
    const options = listSelectableSegmentVariants({
      variants: params.variantsByTag[tag] ?? params.variantsByTag[beat.tag!] ?? [],
      tagMeta: params.tagMetaByName?.[tag] ?? params.tagMetaByName?.[beat.tag!],
      tagName: tag,
      beatType: beat.beatType,
      targetMinutes: params.targetMinutes,
      meditationType: params.meditationType,
      contextTags: params.contextTags,
      tourDirection,
    });
    slots.push({ beatIndex, tag, options });
  }

  return slots;
}

function formatBeatListForPrompt(
  beats: ReadonlyArray<ScriptLabBeat>,
  slotsByIndex: Map<number, TagBeatSlot>,
): string {
  const lines: string[] = [];
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i]!;
    if (beat.beatType === "pause") {
      lines.push(`[${i}] PAUSE ${beat.pauseBand ?? "medium"}`);
      continue;
    }
    if (beat.custom) {
      const text = (beat.text ?? "").replace(/\s+/g, " ").trim() || "(empty custom)";
      lines.push(`[${i}] CUSTOM: ${text}`);
      continue;
    }
    const slot = slotsByIndex.get(i);
    if (!slot) {
      lines.push(`[${i}] TAG ${beat.tag ?? "?"} (no eligible variants)`);
      continue;
    }
    lines.push(`[${i}] TAG ${slot.tag} — choose one variantId:`);
    for (const opt of slot.options) {
      lines.push(`  - ${opt.variantId}: "${truncateForPrompt(opt.text)}"`);
    }
  }
  return lines.join("\n");
}

function variantSelectToolDefinition() {
  return {
    name: "submit_segment_variant_selections",
    description:
      "Select the best library variant for each tag beat index. Keys are beat indices as strings.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        selections: {
          type: "object",
          description:
            "Flat map of tag beat index (string) → selected variantId. Include every tag beat listed in the prompt that has options.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["selections"],
    },
  };
}

function extractSelectionsMap(content: unknown): Record<string, string> {
  if (!Array.isArray(content)) return {};
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; name?: string; input?: unknown };
    if (b.type !== "tool_use") continue;
    if (b.name !== "submit_segment_variant_selections") continue;
    const input = b.input;
    if (!input || typeof input !== "object") continue;
    const selections = (input as { selections?: unknown }).selections;
    if (!selections || typeof selections !== "object" || Array.isArray(selections)) {
      // Also accept array form { beatIndex, variantId }[]
      if (Array.isArray(selections)) {
        const out: Record<string, string> = {};
        for (const row of selections) {
          if (!row || typeof row !== "object") continue;
          const beatIndex = (row as { beatIndex?: unknown }).beatIndex;
          const variantId = (row as { variantId?: unknown }).variantId;
          if (
            (typeof beatIndex === "number" || typeof beatIndex === "string") &&
            typeof variantId === "string" &&
            variantId.trim()
          ) {
            out[String(beatIndex)] = variantId.trim();
          }
        }
        return out;
      }
      continue;
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(selections as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[String(k)] = v.trim();
    }
    return out;
  }
  return {};
}

function parseModelPicks(
  raw: Record<string, string>,
  slots: TagBeatSlot[],
): Record<number, string> {
  const validByIndex = new Map(
    slots.map((s) => [s.beatIndex, new Set(s.options.map((o) => o.variantId))]),
  );
  const out: Record<number, string> = {};
  for (const [key, variantId] of Object.entries(raw)) {
    const beatIndex = Number(key);
    if (!Number.isInteger(beatIndex)) continue;
    const allowed = validByIndex.get(beatIndex);
    if (!allowed?.has(variantId)) continue;
    out[beatIndex] = variantId;
  }
  return out;
}

/**
 * Context-aware variant fill: one Sonnet call picks a variant per tag beat
 * from pre-filtered eligible options; invalid/missing picks fall back to random.
 */
export async function selectSegmentVariantsIntelligently(params: {
  apiKey: string;
  model: string;
  beats: ScriptLabBeat[];
  transcript: string;
  variantsByTag: Record<string, SegmentVariantCandidate[]>;
  tagMetaByName?: Record<string, SegmentTagMeta>;
  targetMinutes: number;
  meditationType?: string | null;
  contextTags?: string[];
}): Promise<IntelligentVariantSelection> {
  const slots = buildEligibleOptionsByTagBeat(params).filter((s) => s.options.length > 0);
  const slotsByIndex = new Map(slots.map((s) => [s.beatIndex, s]));

  let modelPicksByBeatIndex: Record<number, string> = {};
  let usage: { input_tokens: number; output_tokens: number } | null = null;

  if (slots.length > 0) {
    const tool = variantSelectToolDefinition();
    const system = [
      "You select meditation script segment variants for Script Lab fill.",
      "For each TAG beat, pick exactly one variantId from that beat's listed options.",
      "",
      "Selection criteria (in order):",
      "1. Avoid semantic overlap with immediately adjacent CUSTOM beats (within 2 non-pause beats in either direction).",
      "2. Avoid repeating phrasing, sentence openings, or imagery already present in nearby custom text.",
      "3. Prefer a variant that reads naturally as a continuation of what precedes it and a lead-in to what follows.",
      "4. Among equally good fits, prefer variants not already chosen for the same tag earlier in this script (no-repeat tiebreaker).",
      "",
      "Do not invent variantIds. Only use ids listed under each TAG beat.",
      "Return selections via the tool as a flat map: { \"<beatIndex>\": \"<variantId>\", ... } covering every TAG beat that has options.",
    ].join("\n");

    const userContent = [
      "## Personalization transcript (context only)",
      params.transcript.trim() || "(empty)",
      "",
      "## Beat list",
      "Pauses are spacing only — ignore them when counting adjacent non-pause beats.",
      formatBeatListForPrompt(params.beats, slotsByIndex),
    ].join("\n");

    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: 4096,
        temperature: 0.4,
        system,
        tools: [
          {
            name: tool.name,
            description: tool.description,
            input_schema: tool.input_schema,
          },
        ],
        tool_choice: { type: "tool", name: tool.name },
        messages: [{ role: "user", content: userContent }],
      }),
    });

    const responseText = await upstream.text();
    if (!upstream.ok) {
      throw new Error(
        `Anthropic intelligent variant select failed: ${responseText.slice(0, 2000)}`,
      );
    }

    let parsed: { content?: unknown };
    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw new Error("Invalid JSON from Anthropic (intelligent variant select)");
    }

    usage = parseAnthropicMessageUsage(responseText);
    modelPicksByBeatIndex = parseModelPicks(extractSelectionsMap(parsed.content), slots);
  }

  const picker = createSegmentVariantPickerForBeats({
    beats: params.beats,
    variantsByTag: params.variantsByTag,
    tagMetaByName: params.tagMetaByName,
    targetMinutes: params.targetMinutes,
    meditationType: params.meditationType,
    contextTags: params.contextTags,
    preferredVariantIdByBeatIndex: modelPicksByBeatIndex,
    random: true,
  });

  const fallbackBeatIndices: number[] = [];
  for (let i = 0; i < params.beats.length; i++) {
    const beat = params.beats[i]!;
    if (!isTagBeat(beat)) continue;
    const tag = normalizeScriptSegmentTag(beat.tag!);
    const modelPick = modelPicksByBeatIndex[i];
    const text = picker.pickVariantText(tag, i);
    if (!text) continue;
    const chosen = picker.picksByBeatIndex[i];
    if (!modelPick || chosen !== modelPick) {
      fallbackBeatIndices.push(i);
    }
  }

  return {
    picksByBeatIndex: picker.picksByBeatIndex,
    picksByTag: picker.picksByTag,
    modelPicksByBeatIndex,
    fallbackBeatIndices,
    usage,
  };
}

export function coerceScriptLabBeats(raw: unknown): ScriptLabBeat[] {
  if (!Array.isArray(raw)) return [];
  const out: ScriptLabBeat[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const beatType =
      typeof o.beatType === "string" && o.beatType.trim()
        ? o.beatType.trim()
        : "content";
    const custom = o.custom === true;
    const beat: ScriptLabBeat = { beatType, custom };
    if (typeof o.tag === "string" && o.tag.trim()) {
      beat.tag = normalizeScriptSegmentTag(o.tag);
    }
    if (typeof o.text === "string") beat.text = o.text;
    const pauseBand = coercePauseBand(o.pauseBand ?? o.band);
    if (pauseBand) beat.pauseBand = pauseBand;
    out.push(beat);
  }
  return out;
}
