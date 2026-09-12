export const JOURNAL_MOODS = [
  { id: "calm", label: "Calm" },
  { id: "good", label: "Good" },
  { id: "mixed", label: "Mixed" },
  { id: "low", label: "Low" },
  { id: "heavy", label: "Heavy" },
] as const;

export type JournalMoodId = (typeof JOURNAL_MOODS)[number]["id"];

/** Mood indicator dots (list + connections row). */
export const JOURNAL_MOOD_DOT: Record<JournalMoodId, string> = {
  calm: "#7AC4A0",
  good: "#9CB87A",
  mixed: "#C4B87A",
  low: "#B09070",
  heavy: "#A07080",
};

/** Soft pill fill/text used on reflect picker and legacy chips. */
export const JOURNAL_MOOD_PILL: Record<
  JournalMoodId,
  { background: string; color: string }
> = {
  calm: { background: "rgba(122,196,160,0.18)", color: "#3A8060" },
  good: { background: "rgba(156,184,122,0.18)", color: "#4A6B3A" },
  mixed: { background: "rgba(196,184,122,0.18)", color: "#7A7040" },
  low: { background: "rgba(176,144,112,0.18)", color: "#8A7860" },
  heavy: { background: "rgba(160,112,128,0.18)", color: "#6E4A58" },
};

/** Selected mood pill chrome for the journal editor header. */
export const JOURNAL_MOOD_PILL_SELECTED: Record<
  JournalMoodId,
  { background: string; border: string; color: string }
> = {
  calm: {
    background: "rgba(122,196,160,0.18)",
    border: "rgba(122,196,160,0.5)",
    color: "#3A8060",
  },
  good: {
    background: "rgba(156,184,122,0.18)",
    border: "rgba(156,184,122,0.5)",
    color: "#4A6B3A",
  },
  mixed: {
    background: "rgba(196,184,122,0.18)",
    border: "rgba(196,184,122,0.5)",
    color: "#7A7040",
  },
  low: {
    background: "rgba(176,144,112,0.18)",
    border: "rgba(176,144,112,0.5)",
    color: "#8A7860",
  },
  heavy: {
    background: "rgba(160,112,128,0.18)",
    border: "rgba(160,112,128,0.5)",
    color: "#6E4A58",
  },
};

export const JOURNAL_MOOD_PILL_IDLE_BORDER = "rgba(180,140,80,0.25)";

export function isJournalMoodId(x: unknown): x is JournalMoodId {
  return JOURNAL_MOODS.some((m) => m.id === x);
}

export function journalMoodLabel(id: string | undefined): string | null {
  return JOURNAL_MOODS.find((m) => m.id === id)?.label ?? null;
}

export function journalMoodDotColor(id: string | undefined): string | null {
  return isJournalMoodId(id) ? JOURNAL_MOOD_DOT[id] : null;
}
