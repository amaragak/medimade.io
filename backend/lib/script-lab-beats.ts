import { normalizePauseBand, SCRIPT_PAUSE_BANDS } from "./script-pause-bands";
import {
  CONNECTIVE_SEGMENT_TAGS,
  effectiveSegmentRepeatability,
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

/** Drop later duplicate singular tag beats — keep first instance (generation pre-verify pass). */
export function dropDuplicateSingularTagBeats(
  beats: ScriptLabBeat[],
  tagRepeatabilityByName?: Record<string, ScriptSegmentRepeatability>,
): {
  beats: ScriptLabBeat[];
  dropped: Array<{ index: number; tag: string }>;
} {
  const seen = new Set<string>();
  const dropped: Array<{ index: number; tag: string }> = [];
  const out: ScriptLabBeat[] = [];

  beats.forEach((beat, index) => {
    if (beat.custom || !beat.tag) {
      out.push(beat);
      return;
    }
    const tag = normalizeScriptSegmentTag(beat.tag);
    const rep =
      tagRepeatabilityByName?.[tag] ?? inferDefaultSegmentRepeatability(tag);
    if (rep !== "singular") {
      out.push(beat);
      return;
    }
    if (seen.has(tag)) {
      dropped.push({ index, tag });
      console.warn(
        `[script-lab] Dropping duplicate singular tag beat: ${tag} at index ${index}`,
      );
      return;
    }
    seen.add(tag);
    out.push(beat);
  });

  return { beats: out, dropped };
}

export function scriptLabBeatsToolDefinition(): {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
} {
  return {
    name: "submit_meditation_script_beats",
    description:
      "Return the complete guided meditation as an ordered list of typed beats. Do not output free-form prose outside this tool. Emit the minimal fields for each beat: library beat = {tag}, custom beat = {beatType, text}, pause beat = {pauseBand}.",
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
              tag: {
                type: "string",
                description:
                  "Library segment beat, e.g. SETTLE_OPENER. When set, this is the ONLY field needed — omit beatType and custom, they are derived from the tag name.",
              },
              text: {
                type: "string",
                description:
                  "Custom beat: the spoken words (may include inline [[PAUSE band]] markers). Pair with beatType. Do not set alongside tag.",
              },
              beatType: {
                type: "string",
                description:
                  "Functional category for custom beats only, e.g. content, settle_opener. Omit on tag and pause beats.",
              },
              pauseBand: {
                type: "string",
                enum: [...SCRIPT_PAUSE_BANDS],
                description:
                  "Standalone silence beat. When set alone, this is the ONLY field needed — omit beatType and custom. One of: extra-short, short, medium, long, extra-long.",
              },
              custom: {
                type: "boolean",
                description:
                  "Optional and normally omitted — inferred from tag/text. Only set it to disambiguate.",
              },
            },
            required: [],
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
  const rawBeatType = normalizeBeatType(String(o.beatType ?? ""));
  const tag =
    typeof o.tag === "string" && o.tag.trim()
      ? normalizeScriptSegmentTag(o.tag)
      : undefined;
  const text = typeof o.text === "string" ? o.text.trim() : undefined;
  const pauseBandRaw =
    typeof o.pauseBand === "string"
      ? o.pauseBand
      : typeof o.band === "string"
        ? o.band
        : "";

  if (rawBeatType === "pause" || (!tag && !text && pauseBandRaw)) {
    const pauseBand = normalizePauseBand(pauseBandRaw) ?? "medium";
    return { beatType: "pause", custom: false, pauseBand };
  }

  // beatType is a pure function of the tag name, so the model omits it on
  // library beats; accept an explicit one for backwards compatibility.
  if (tag) {
    if (o.custom === true) {
      throw new Error(`Beat ${index + 1} (${tag}) custom=true must not include tag`);
    }
    const beatType = rawBeatType || tagNameToBeatType(tag);
    // Optional locked variant text (V2 keeps Pass-1 picks on tag beats).
    return text
      ? { beatType, custom: false, tag, text }
      : { beatType, custom: false, tag };
  }

  if (!text) {
    throw new Error(
      `Beat ${index + 1}${rawBeatType ? ` (${rawBeatType})` : ""} needs a tag (library beat), text (custom beat), or pauseBand (pause beat)`,
    );
  }
  if (!rawBeatType) throw new Error(`Beat ${index + 1} (custom) missing beatType`);
  return { beatType: rawBeatType, custom: true, text };
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

/**
 * Drop a connective tag beat when the previous non-pause beat is the same
 * connective tag (pauses between do not count as separation). Keeps the first
 * instance. Enforces the same invariant as scriptLabConnectiveTagSpacingRules.
 */
export function collapseSameConnectiveSeparatedOnlyByPauses(
  beats: ScriptLabBeat[],
  tagRepeatabilityByName?: Record<string, ScriptSegmentRepeatability>,
): ScriptLabBeat[] {
  const out: ScriptLabBeat[] = [];
  let lastConnectiveTag: string | null = null;

  for (const beat of beats) {
    if (beat.beatType === "pause") {
      out.push(beat);
      continue;
    }
    if (!beat.custom && beat.tag) {
      const tag = normalizeScriptSegmentTag(beat.tag);
      const rep =
        tagRepeatabilityByName?.[tag] ??
        effectiveSegmentRepeatability({ tag, repeatability: null });
      if (rep === "connective") {
        if (lastConnectiveTag === tag) {
          continue;
        }
        lastConnectiveTag = tag;
        out.push({ ...beat, tag });
        continue;
      }
    }
    lastConnectiveTag = null;
    out.push(beat);
  }

  // Drop trailing/leading pause runs created by removals (keep single pause gaps).
  const cleaned: ScriptLabBeat[] = [];
  for (const beat of out) {
    if (
      beat.beatType === "pause" &&
      cleaned.length > 0 &&
      cleaned[cleaned.length - 1]!.beatType === "pause"
    ) {
      cleaned[cleaned.length - 1] = beat;
      continue;
    }
    cleaned.push(beat);
  }
  while (cleaned.length > 0 && cleaned[0]!.beatType === "pause") cleaned.shift();
  while (cleaned.length > 0 && cleaned[cleaned.length - 1]!.beatType === "pause") {
    cleaned.pop();
  }
  return cleaned;
}
