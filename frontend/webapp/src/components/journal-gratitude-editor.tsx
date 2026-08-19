"use client";

import { IconHeart, IconSparkles, IconSun } from "@tabler/icons-react";
import { formatJournalEntryDate, localDateKey, localDateKeyFromIso } from "@/lib/journal-storage";
import type { JournalGratitudeLines } from "@/lib/journal-storage";
import type { ReactNode } from "react";

const FIELDS = [
  {
    Icon: IconSun,
    ariaLabel: "First thing you’re grateful for",
  },
  {
    Icon: IconHeart,
    ariaLabel: "Second thing you’re grateful for",
  },
  {
    Icon: IconSparkles,
    ariaLabel: "Third thing you’re grateful for",
  },
] as const;

type Props = {
  createdAt: string;
  lines: JournalGratitudeLines;
  onChange: (lines: JournalGratitudeLines) => void;
  children?: ReactNode;
};

export function JournalGratitudeEditor({ createdAt, lines, onChange, children }: Props) {
  const isToday = localDateKeyFromIso(createdAt) === localDateKey();
  const dateLabel = formatJournalEntryDate(createdAt);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#EEDFC0] bg-[#FBF6EA] shadow-sm">
      <div className="shrink-0 border-b border-[#EEDFC0] px-5 py-4 sm:px-6">
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
        {FIELDS.map(({ Icon, ariaLabel }, i) => (
          <div key={ariaLabel} className="flex items-start gap-3">
            <span
              className="mt-2.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent"
              aria-hidden
            >
              <Icon size={16} stroke={1.75} />
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
              aria-label={ariaLabel}
              className="min-w-0 flex-1 resize-y rounded-2xl border border-[#EEDFC0] bg-white px-4 py-3 text-sm leading-relaxed text-foreground outline-none ring-accent/30 placeholder:text-muted/70 focus:ring-2 sm:text-base"
            />
          </div>
        ))}
      </div>
      {children ? (
        <div className="shrink-0 border-t border-[#EEDFC0] px-5 py-3 sm:px-6">
          {children}
        </div>
      ) : null}
    </div>
  );
}
