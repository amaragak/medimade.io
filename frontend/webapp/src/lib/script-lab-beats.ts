/** Client mirror of backend/lib/script-lab-beats.ts */

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
  return `Duplicate beatType "${w.beatType}" — ${lines.join(" · ")}`;
}

const BEAT_TYPE_EXEMPT_FROM_DUPLICATE_CHECK = new Set(["content", "pause"]);

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

/** Beat indices whose functional beatType appears more than once (excluding content/pause). */
export function duplicateBeatTypeIndexSet(beats: ScriptLabBeat[]): Set<number> {
  const byType = new Map<string, number[]>();
  beats.forEach((beat, index) => {
    if (BEAT_TYPE_EXEMPT_FROM_DUPLICATE_CHECK.has(beat.beatType)) return;
    const list = byType.get(beat.beatType) ?? [];
    list.push(index);
    byType.set(beat.beatType, list);
  });
  const dupes = new Set<number>();
  for (const indices of byType.values()) {
    if (indices.length > 1) {
      for (const i of indices) dupes.add(i);
    }
  }
  return dupes;
}
