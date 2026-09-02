import { normalizePauseBand, SCRIPT_PAUSE_BANDS } from "./script-pause-bands";
import {
  CONNECTIVE_SEGMENT_TAGS,
  inferDefaultSegmentRepeatability,
  normalizeScriptSegmentTag,
  type ScriptSegmentRepeatability,
} from "./script-segment-tags";

export type ScriptLabBeat = {
  beatType: string;
  custom: boolean;
  tag?: string;
  text?: string;
  pauseBand?: string;
};

export type ScriptLabBeatDuplicateWarning = {
  beatType: string;
  /** Set when the warning is for a repeated singular library tag. */
  tag?: string;
  reason: "tag" | "beatType";
  instances: Array<{
    index: number;
    custom: boolean;
    tag?: string;
    text?: string;
  }>;
};

const EXEMPT_BEAT_TYPES = new Set(["content", "pause"]);

export function tagNameToBeatType(tagName: string): string {
  return normalizeScriptSegmentTag(tagName).toLowerCase();
}

export function normalizeBeatType(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

const CONNECTIVE_BEAT_TYPES = new Set(
  [...CONNECTIVE_SEGMENT_TAGS].map((t) => normalizeBeatType(t)),
);

export function buildTagRepeatabilityMap(
  tags: Array<{ name: string; repeatability?: ScriptSegmentRepeatability }>,
): Record<string, ScriptSegmentRepeatability> {
  const out: Record<string, ScriptSegmentRepeatability> = {};
  for (const t of tags) {
    const name = normalizeScriptSegmentTag(t.name);
    out[name] = t.repeatability ?? inferDefaultSegmentRepeatability(name);
  }
  return out;
}

function repeatabilityForBeat(
  beat: ScriptLabBeat,
  tagRepeatabilityByName?: Record<string, ScriptSegmentRepeatability>,
): ScriptSegmentRepeatability | "exempt" {
  if (EXEMPT_BEAT_TYPES.has(beat.beatType)) return "exempt";
  if (!beat.custom && beat.tag) {
    const tag = normalizeScriptSegmentTag(beat.tag);
    return tagRepeatabilityByName?.[tag] ?? inferDefaultSegmentRepeatability(tag);
  }
  const bt = normalizeBeatType(beat.beatType);
  if (CONNECTIVE_BEAT_TYPES.has(bt)) return "connective";
  return "singular";
}

export function findDuplicateBeatTypeWarnings(
  beats: ScriptLabBeat[],
  tagRepeatabilityByName?: Record<string, ScriptSegmentRepeatability>,
): ScriptLabBeatDuplicateWarning[] {
  const warnings: ScriptLabBeatDuplicateWarning[] = [];

  const byTag = new Map<string, ScriptLabBeatDuplicateWarning["instances"]>();
  beats.forEach((beat, index) => {
    if (beat.custom || !beat.tag) return;
    const tag = normalizeScriptSegmentTag(beat.tag);
    if (repeatabilityForBeat(beat, tagRepeatabilityByName) !== "singular") return;
    const list = byTag.get(tag) ?? [];
    list.push({ index, custom: beat.custom, tag });
    byTag.set(tag, list);
  });

  for (const [tag, instances] of byTag) {
    if (instances.length > 1) {
      warnings.push({
        beatType: normalizeBeatType(tag),
        tag,
        reason: "tag",
        instances,
      });
    }
  }

  const byBeatType = new Map<string, ScriptLabBeatDuplicateWarning["instances"]>();
  beats.forEach((beat, index) => {
    if (repeatabilityForBeat(beat, tagRepeatabilityByName) !== "singular") return;
    const list = byBeatType.get(beat.beatType) ?? [];
    list.push({
      index,
      custom: beat.custom,
      ...(beat.tag ? { tag: beat.tag } : {}),
      ...(beat.text ? { text: beat.text } : {}),
    });
    byBeatType.set(beat.beatType, list);
  });

  for (const [beatType, instances] of byBeatType) {
    if (instances.length <= 1) continue;
    const tagIndices = new Set(
      warnings.filter((w) => w.reason === "tag").flatMap((w) => w.instances.map((x) => x.index)),
    );
    if (instances.every((inst) => tagIndices.has(inst.index))) continue;
    warnings.push({ beatType, reason: "beatType", instances });
  }

  warnings.sort((a, b) => (a.tag ?? a.beatType).localeCompare(b.tag ?? b.beatType));
  return warnings;
}

export function duplicateBeatTypeIndexSet(
  beats: ScriptLabBeat[],
  tagRepeatabilityByName?: Record<string, ScriptSegmentRepeatability>,
): Set<number> {
  const dupes = new Set<number>();
  for (const w of findDuplicateBeatTypeWarnings(beats, tagRepeatabilityByName)) {
    for (const inst of w.instances) dupes.add(inst.index);
  }
  return dupes;
}

export function scriptLabBeatsToolDefinition(): {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
} {
  return {
    name: "submit_meditation_script_beats",
    description:
      "Return the complete guided meditation as an ordered list of typed beats. Do not output free-form prose outside this tool.",
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
              beatType: {
                type: "string",
                description:
                  "Functional category, e.g. settle_opener, breath_transition, close_sendoff, content, pause.",
              },
              custom: {
                type: "boolean",
                description:
                  "false = library segment (tag required); true = model-written text (text required). Not used for pause beats.",
              },
              tag: {
                type: "string",
                description: "Library segment tag when custom is false, e.g. SETTLE_OPENER.",
              },
              text: {
                type: "string",
                description:
                  "Spoken words when custom is true; may include inline [[PAUSE band]] markers.",
              },
              pauseBand: {
                type: "string",
                enum: [...SCRIPT_PAUSE_BANDS],
                description: "Required when beatType is pause — standalone structural silence.",
              },
            },
            required: ["beatType", "custom"],
          },
        },
      },
      required: ["beats"],
    },
  };
}

function normalizeIncomingBeat(raw: unknown, index: number): ScriptLabBeat {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Beat ${index + 1} is not an object`);
  }
  const o = raw as Record<string, unknown>;
  const beatType = normalizeBeatType(String(o.beatType ?? ""));
  if (!beatType) throw new Error(`Beat ${index + 1} missing beatType`);

  if (beatType === "pause") {
    const pauseBandRaw = typeof o.pauseBand === "string" ? o.pauseBand : "";
    const pauseBand = normalizePauseBand(pauseBandRaw);
    if (!pauseBand) {
      throw new Error(`Beat ${index + 1} (pause) needs a valid pauseBand`);
    }
    return { beatType: "pause", custom: false, pauseBand };
  }

  const custom = o.custom === true;
  const tag =
    typeof o.tag === "string" && o.tag.trim()
      ? normalizeScriptSegmentTag(o.tag)
      : undefined;
  const text = typeof o.text === "string" ? o.text.trim() : undefined;

  if (custom) {
    if (!text) throw new Error(`Beat ${index + 1} (${beatType}) custom=true requires text`);
    if (tag) throw new Error(`Beat ${index + 1} (${beatType}) custom=true must not include tag`);
    return { beatType, custom: true, text };
  }

  if (!tag) throw new Error(`Beat ${index + 1} (${beatType}) custom=false requires tag`);
  if (text) throw new Error(`Beat ${index + 1} (${beatType}) custom=false must not include text`);
  return { beatType, custom: false, tag };
}

export function parseScriptLabBeatsFromToolInput(input: unknown): ScriptLabBeat[] {
  if (!input || typeof input !== "object") {
    throw new Error("Tool input must be an object with beats[]");
  }
  const beatsRaw = (input as { beats?: unknown }).beats;
  if (!Array.isArray(beatsRaw) || beatsRaw.length === 0) {
    throw new Error("beats[] must be a non-empty array");
  }
  return beatsRaw.map((b, i) => normalizeIncomingBeat(b, i));
}

export function extractBeatsFromAnthropicMessage(content: unknown): ScriptLabBeat[] {
  if (!Array.isArray(content)) {
    throw new Error("Anthropic response missing content blocks");
  }
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "tool_use" &&
      (block as { name?: string }).name === "submit_meditation_script_beats"
    ) {
      return parseScriptLabBeatsFromToolInput((block as { input?: unknown }).input);
    }
  }
  throw new Error("Model did not return submit_meditation_script_beats tool output");
}
