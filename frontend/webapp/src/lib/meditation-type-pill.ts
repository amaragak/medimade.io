/**
 * Per-type library / create pill colours (light-mode style updates).
 * Keys are lowercase labels; "Movement meditation" maps to Movement.
 */

export type MeditationTypePillColors = { bg: string; fg: string };

const DEFAULT_PILL: MeditationTypePillColors = {
  bg: "rgba(180,140,80,0.12)",
  fg: "#7A5010",
};

const PILLS: Record<string, MeditationTypePillColors> = {
  "body scan": { bg: "rgba(184,100,26,0.10)", fg: "#8A4A0F" },
  visualization: { bg: "rgba(26,107,184,0.10)", fg: "#0F4C8A" },
  "breath-led": { bg: "rgba(26,140,107,0.10)", fg: "#0F6B50" },
  manifestation: { bg: "rgba(131,50,184,0.10)", fg: "#5C1F8A" },
  "affirmation loop": { bg: "rgba(131,50,184,0.10)", fg: "#5C1F8A" },
  story: { bg: "rgba(180,140,80,0.12)", fg: "#7A5010" },
  reflection: { bg: "rgba(26,107,184,0.10)", fg: "#0F4C8A" },
  sleep: { bg: "rgba(50,80,150,0.10)", fg: "#1F3A8A" },
  "loving-kindness": { bg: "rgba(184,60,100,0.10)", fg: "#8A1F4A" },
  "anxiety relief": { bg: "rgba(26,140,107,0.10)", fg: "#0F6B50" },
  movement: { bg: "rgba(184,100,26,0.10)", fg: "#8A4A0F" },
  "movement meditation": { bg: "rgba(184,100,26,0.10)", fg: "#8A4A0F" },
  "open awareness": { bg: "rgba(26,107,184,0.10)", fg: "#0F4C8A" },
};

/** Resolve pill colours for a meditation type / category label. */
export function meditationTypePillColors(
  label: string | null | undefined,
): MeditationTypePillColors {
  const raw = (label ?? "").trim();
  if (!raw || raw === "—") return DEFAULT_PILL;
  // Compound library labels ("Type · Style") — colour by the type segment.
  const primary = raw.split("·")[0]?.trim() ?? raw;
  const key = primary.toLowerCase();
  return PILLS[key] ?? DEFAULT_PILL;
}

/** Shared class for colour-coded type pills (colours via inline style). */
export const MEDITATION_TYPE_PILL_CLASS =
  "inline-block rounded-[10px] px-[9px] py-[3px] text-[10px] font-medium uppercase tracking-[0.06em]";
