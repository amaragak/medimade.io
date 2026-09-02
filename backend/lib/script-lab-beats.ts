import { normalizePauseBand, SCRIPT_PAUSE_BANDS } from "./script-pause-bands";
import { normalizeScriptSegmentTag } from "./script-segment-tags";

export type ScriptLabBeat = {
  beatType: string;
  custom: boolean;
  tag?: string;
  text?: string;
  pauseBand?: string;
};

export type ScriptLabBeatDuplicateWarning = {
  beatType: string;
  instances: Array<{
    index: number;
    custom: boolean;
    tag?: string;
    text?: string;
  }>;
};

const BEAT_TYPE_EXEMPT_FROM_DUPLICATE_CHECK = new Set(["content", "pause"]);

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

export function findDuplicateBeatTypeWarnings(
  beats: ScriptLabBeat[],
): ScriptLabBeatDuplicateWarning[] {
  const byType = new Map<string, ScriptLabBeatDuplicateWarning["instances"]>();
  beats.forEach((beat, index) => {
    if (BEAT_TYPE_EXEMPT_FROM_DUPLICATE_CHECK.has(beat.beatType)) return;
    const list = byType.get(beat.beatType) ?? [];
    list.push({
      index,
      custom: beat.custom,
      ...(beat.tag ? { tag: beat.tag } : {}),
      ...(beat.text ? { text: beat.text } : {}),
    });
    byType.set(beat.beatType, list);
  });

  const warnings: ScriptLabBeatDuplicateWarning[] = [];
  for (const [beatType, instances] of byType) {
    if (instances.length > 1) {
      warnings.push({ beatType, instances });
    }
  }
  warnings.sort((a, b) => a.beatType.localeCompare(b.beatType));
  return warnings;
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
