/**
 * Named pause bands in generated scripts (`[[PAUSE medium]]`).
 * Seconds live only here so we can retune render without changing scripts.
 *
 * Legacy `[[PAUSE 3s]]` still parses for old library rows.
 */
export const SCRIPT_PAUSE_BANDS = [
  "extra-short",
  "short",
  "medium",
  "long",
  "extra-long",
] as const;

export type ScriptPauseBand = (typeof SCRIPT_PAUSE_BANDS)[number];

/** Seconds of silence per band before `PAUSE_RENDER_SCALE`. */
export const SCRIPT_PAUSE_BAND_SECONDS: Record<ScriptPauseBand, number> = {
  "extra-short": 1.5,
  short: 2.5,
  medium: 4,
  long: 7,
  "extra-long": 12,
};

export const TITLE_PAUSE_MARKER = "[[PAUSE medium]]";

const BAND_ALIASES: Record<string, ScriptPauseBand> = {
  xs: "extra-short",
  "extra short": "extra-short",
  "extra-short": "extra-short",
  extrashort: "extra-short",
  short: "short",
  s: "short",
  medium: "medium",
  med: "medium",
  m: "medium",
  typical: "medium",
  long: "long",
  l: "long",
  "extra long": "extra-long",
  "extra-long": "extra-long",
  extralong: "extra-long",
  xl: "extra-long",
  xlong: "extra-long",
};

export const SCRIPT_PAUSE_MARKER_RE = /\[\[PAUSE\s+([^\]]+)\]\]/gi;

export function normalizePauseBand(raw: string): ScriptPauseBand | null {
  const key = raw.trim().toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ");
  return BAND_ALIASES[key] ?? null;
}

export function secondsForPauseSpec(
  raw: string,
  bands?: Record<ScriptPauseBand, number>,
): number {
  const map = bands ?? SCRIPT_PAUSE_BAND_SECONDS;
  const band = normalizePauseBand(raw);
  if (band) return map[band];
  const n = parseFloat(raw.trim().replace(/s$/i, ""));
  if (Number.isFinite(n) && n > 0) return n;
  return 0;
}

export function sumPauseMarkerSeconds(
  script: string,
  bands?: Record<ScriptPauseBand, number>,
): number {
  if (!script) return 0;
  const re = new RegExp(SCRIPT_PAUSE_MARKER_RE.source, SCRIPT_PAUSE_MARKER_RE.flags);
  let total = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script)) !== null) {
    total += secondsForPauseSpec(m[1] ?? "", bands);
  }
  return total;
}

export function stripPauseMarkers(script: string): string {
  if (!script) return "";
  return script
    .replace(new RegExp(SCRIPT_PAUSE_MARKER_RE.source, SCRIPT_PAUSE_MARKER_RE.flags), " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ScriptSegment = {
  text: string;
  pauseSeconds: number;
};

export function parseScriptIntoSegments(
  script: string,
  bands?: Record<ScriptPauseBand, number>,
): ScriptSegment[] {
  const segments: ScriptSegment[] = [];
  if (!script) return segments;
  const re = new RegExp(SCRIPT_PAUSE_MARKER_RE.source, SCRIPT_PAUSE_MARKER_RE.flags);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(script)) !== null) {
    const raw = script.slice(lastIndex, match.index);
    const text = raw.trim();
    const pause = secondsForPauseSpec(match[1] ?? "", bands);
    if (text) {
      segments.push({
        text,
        pauseSeconds: pause > 0 ? pause : 0,
      });
    } else if (pause > 0 && segments.length > 0) {
      segments[segments.length - 1]!.pauseSeconds += pause;
    }
    lastIndex = match.index + match[0].length;
  }

  const tail = script.slice(lastIndex).trim();
  if (tail) {
    segments.push({ text: tail, pauseSeconds: 0 });
  }

  return segments;
}

/** Prompt block: scripts use named bands only, never seconds. */
export const SCRIPT_PAUSE_PROMPT_RULES = [
  "Use **liberal** natural pauses with inline markers `[[PAUSE short]]`, `[[PAUSE medium]]`, `[[PAUSE long]]`, or `[[PAUSE extra long]]` only — **never** write seconds (no `3s`, `6s`, `1.5s`, etc.). Optional `[[PAUSE extra short]]` for a very brief bridge.",
  "Include them **often**—after most sentences or sense-units, at **every** meaningful transition (arrival → practice, shifts in technique or imagery, closing), and wherever a human guide would breathe or let a phrase land—not only at rare dramatic beats.",
  "Place **every** pause **intelligently**: each gap must fit the moment—what was just said, the emotional or somatic weight, the transition, and what comes next. Pauses are not filler; avoid random, uniform, or excessive markers that would break rhythm or feel mechanical.",
  "Choose the **band** by context: **short** when momentum matters; **medium** as the typical gap between lines; **long** after heavier invitations, imagery, or emotional lines; **extra long** when the listener is practising **on their own** with no imminent next cue (slow body scan, open visualization, resting in silence, counting several breaths alone). Default toward more frequent silence than a dense script—still never gratuitous.",
  "**Guided breath cycles (important):** when you sequence step-by-step breath cues the guide delivers in order—e.g. breathe in … then breathe out; inhale … exhale; hold … release—the pause **between those paired steps** must be **short** or **extra short** only. That gap is just long enough to finish that one phase before the next line; it is **not** self-paced practice. Never use **medium**, **long**, or **extra long** after “breathe in” (or similar) if the next section is “breathe out” (or the matching exhale/release). Use **long** / **extra long** only when the listener has real open time before the guide speaks again.",
  "When the listener truly follows in their own time—with no next instruction arriving soon—prefer **extra long** (sometimes several markers in a row when one sustained silence fits); never rush the next line while they are meant to be practising alone, and never stack extra-long silence where the script does not call for it.",
  "Place pause markers on their own or immediately after a sentence, never splitting words.",
].join("\n");
