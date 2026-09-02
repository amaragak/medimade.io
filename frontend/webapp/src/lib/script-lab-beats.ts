/** Client mirror of backend/lib/script-lab-beats.ts */

import {
  CONNECTIVE_SEGMENT_TAGS,
  inferDefaultSegmentRepeatability,
  normalizeScriptSegmentTag,
  type ScriptSegmentRepeatability,
} from "@/lib/script-segment-tags";

export type ScriptLabBeat = {
  beatType: string;
  custom: boolean;
  tag?: string;
  text?: string;
  pauseBand?: string;
};

export type ScriptLabBeatDuplicateWarning = {
  beatType: string;
  tag?: string;
  reason: "tag" | "beatType";
  instances: Array<{
    index: number;
    custom: boolean;
    tag?: string;
    text?: string;
  }>;
};

const PAUSE_MARKER_RE = /\[\[PAUSE\s+([^\]]+)\]\]/gi;

export type ScriptBeatPreviewToken =
  | { type: "text"; value: string }
  | { type: "tag"; name: string }
  | { type: "pause"; band: string };

export function tokenizeCustomBeatText(text: string): Array<
  { type: "text"; value: string } | { type: "pause"; band: string }
> {
  const out: Array<{ type: "text"; value: string } | { type: "pause"; band: string }> = [];
  let last = 0;
  const re = new RegExp(PAUSE_MARKER_RE.source, "gi");
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: "text", value: text.slice(last, idx) });
    out.push({ type: "pause", band: (m[1] ?? "").trim() });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

export function flattenBeatsToPreviewTokens(beats: ScriptLabBeat[]): ScriptBeatPreviewToken[] {
  const out: ScriptBeatPreviewToken[] = [];
  beats.forEach((beat, i) => {
    if (i > 0 && beat.beatType !== "pause") {
      out.push({ type: "text", value: "\n\n" });
    }
    if (beat.beatType === "pause" && beat.pauseBand) {
      out.push({ type: "pause", band: beat.pauseBand });
      return;
    }
    if (!beat.custom && beat.tag) {
      out.push({ type: "tag", name: beat.tag });
      return;
    }
    if (beat.custom && beat.text) {
      for (const tok of tokenizeCustomBeatText(beat.text)) {
        if (tok.type === "text" && tok.value) out.push(tok);
        else if (tok.type === "pause") out.push(tok);
      }
    }
  });
  return out;
}

/** Plain text for tags preview / clipboard (tag names, custom prose, pause markers). */
export function flattenBeatsToCopyText(beats: ScriptLabBeat[]): string {
  return flattenBeatsToPreviewTokens(beats)
    .map((tok) => {
      if (tok.type === "tag") return tok.name;
      if (tok.type === "pause") return `[[PAUSE ${tok.band}]]`;
      return tok.value;
    })
    .join("");
}

export function renderBeatsToScript(
  beats: ScriptLabBeat[],
  pickVariant: (tag: string, beatIndex: number) => string | null,
): string {
  const parts: string[] = [];
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i]!;
    if (beat.beatType === "pause" && beat.pauseBand) {
      parts.push(`[[PAUSE ${beat.pauseBand}]]`);
      continue;
    }
    if (!beat.custom && beat.tag) {
      if (beat.text?.trim()) {
        parts.push(beat.text.trim());
        continue;
      }
      const text = pickVariant(beat.tag, i);
      parts.push(text?.trim() ? text.trim() : `[[SEG:${beat.tag}]]`);
      continue;
    }
    if (beat.custom && beat.text) {
      parts.push(beat.text);
    }
  }
  return parts.join("\n\n");
}

export function collectSegmentTagsFromBeats(beats: ScriptLabBeat[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const beat of beats) {
    if (!beat.custom && beat.tag && !seen.has(beat.tag)) {
      seen.add(beat.tag);
      out.push(beat.tag);
    }
  }
  return out;
}

export function customTextFromBeats(beats: ScriptLabBeat[]): string {
  return beats
    .filter((b) => b.custom && b.text?.trim())
    .map((b) => b.text!.replace(PAUSE_MARKER_RE, " "))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Spoken words only — inline [[PAUSE …]] markers removed. */
export function customProseWithoutPauses(text: string): string {
  return text.replace(PAUSE_MARKER_RE, "").trim();
}

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function pauseSecondsFromBeats(beats: ScriptLabBeat[]): number {
  const PAUSE_BAND_SECONDS: Record<string, number> = {
    "extra-short": 1.5,
    short: 2.5,
    medium: 4,
    long: 7,
    "extra-long": 12,
  };
  let total = 0;
  for (const beat of beats) {
    if (beat.beatType === "pause" && beat.pauseBand) {
      total += PAUSE_BAND_SECONDS[beat.pauseBand] ?? 0;
      continue;
    }
    if (beat.custom && beat.text) {
      for (const m of beat.text.matchAll(PAUSE_MARKER_RE)) {
        const band = (m[1] ?? "").trim().toLowerCase();
        total += PAUSE_BAND_SECONDS[band] ?? 0;
      }
    }
  }
  return total;
}

export function formatBeatWarning(w: ScriptLabBeatDuplicateWarning): string {
  const lines = w.instances.map((inst) => {
    const prefix = `Beat #${inst.index + 1}`;
    if (inst.custom) {
      const text = inst.text ?? "";
      const preview =
        text.length > 120 ? `${text.slice(0, 120).trim()}…` : text.trim();
      return `${prefix} (custom): "${preview}"`;
    }
    return `${prefix} (tag): ${inst.tag ?? "?"}`;
  });
  if (w.reason === "tag" && w.tag) {
    return `Duplicate singular tag "${w.tag}" — ${lines.join(" · ")}`;
  }
  return `Duplicate singular beatType "${w.beatType}" — ${lines.join(" · ")}`;
}

const EXEMPT_BEAT_TYPES = new Set(["content", "pause"]);

function normalizeBeatType(raw: string): string {
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
