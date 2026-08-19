export const JOURNAL_MOODS = [
  { id: "calm", label: "Calm" },
  { id: "good", label: "Good" },
  { id: "mixed", label: "Mixed" },
  { id: "low", label: "Low" },
  { id: "heavy", label: "Heavy" },
] as const;

export type JournalMoodId = (typeof JOURNAL_MOODS)[number]["id"];

/** Soft pill colors for mood chips. No other surface had a per-mood palette yet. */
export const JOURNAL_MOOD_PILL: Record<
  JournalMoodId,
  { background: string; color: string }
> = {
  calm: { background: "#E4E7E3", color: "#3D5148" },
  good: { background: "#E8F0E0", color: "#4A6B3A" },
  mixed: { background: "#FBEAEA", color: "#A65252" },
  low: { background: "#F0EBE2", color: "#8A7860" },
  heavy: { background: "#EFEBF3", color: "#7A5D8F" },
};

export function isJournalMoodId(x: unknown): x is JournalMoodId {
  return JOURNAL_MOODS.some((m) => m.id === x);
}

export function journalMoodLabel(id: string | undefined): string | null {
  return JOURNAL_MOODS.find((m) => m.id === id)?.label ?? null;
}
