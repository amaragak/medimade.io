"use client";

import { formatJournalEntryDate, localDateKey, localDateKeyFromIso } from "@/lib/journal-storage";
import type { JournalGratitudeLines } from "@/lib/journal-storage";

const PROMPTS = ["First", "Second", "Third"] as const;

type Props = {
  createdAt: string;
  lines: JournalGratitudeLines;
  onChange: (lines: JournalGratitudeLines) => void;
};

export function JournalGratitudeEditor({ createdAt, lines, onChange }: Props) {
  const isToday = localDateKeyFromIso(createdAt) === localDateKey();
  const dateLabel = formatJournalEntryDate(createdAt);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="shrink-0 border-b border-border px-5 py-4 sm:px-6">
        <h2 className="font-display text-xl font-medium tracking-tight text-foreground sm:text-2xl">
          {isToday ? "Today" : dateLabel}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {isToday
            ? "Three things you’re grateful for today."
            : `Three things you were grateful for on ${dateLabel}.`}
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
        {PROMPTS.map((label, i) => (
          <label key={label} className="block">
            <span className="text-sm font-semibold text-foreground">
              {label}
            </span>
            <textarea
              value={lines[i]}
              onChange={(e) => {
                const next: JournalGratitudeLines = [lines[0], lines[1], lines[2]];
                next[i] = e.target.value;
                onChange(next);
              }}
              rows={2}
              placeholder="I’m grateful for…"
              className="mt-2 w-full resize-y rounded-2xl border border-border bg-background px-4 py-3 text-sm leading-relaxed text-foreground outline-none ring-accent/30 placeholder:text-muted/70 focus:ring-2 sm:text-base"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
