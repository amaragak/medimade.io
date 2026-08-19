export const JOURNAL_MOODS = [
  { id: "calm", label: "Calm" },
  { id: "good", label: "Good" },
  { id: "mixed", label: "Mixed" },
  { id: "low", label: "Low" },
  { id: "heavy", label: "Heavy" },
] as const;

export type JournalMoodId = (typeof JOURNAL_MOODS)[number]["id"];

export function isJournalMoodId(x: unknown): x is JournalMoodId {
  return JOURNAL_MOODS.some((m) => m.id === x);
}

export function journalMoodLabel(id: string | undefined): string | null {
  return JOURNAL_MOODS.find((m) => m.id === id)?.label ?? null;
}
