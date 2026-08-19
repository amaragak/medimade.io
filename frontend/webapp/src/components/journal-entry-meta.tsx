"use client";

import { useState } from "react";
import { JOURNAL_MOODS } from "@/lib/journal-moods";

type Props = {
  mood?: string;
  tags?: string[];
  onMoodChange: (mood: string | undefined) => void;
  onTagsChange: (tags: string[]) => void;
};

function cleanTag(raw: string): string {
  return raw.trim().replace(/^#/, "").slice(0, 32);
}

export function JournalEntryMeta({
  mood,
  tags = [],
  onMoodChange,
  onTagsChange,
}: Props) {
  const [draft, setDraft] = useState("");

  const addTag = () => {
    const t = cleanTag(draft);
    if (!t) {
      setDraft("");
      return;
    }
    const next = [...new Set([...tags, t])].slice(0, 16);
    onTagsChange(next);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          How does this feel
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Mood">
            {JOURNAL_MOODS.map((m) => {
              const on = mood === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onMoodChange(on ? undefined : m.id)}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    on
                      ? "border-selected/40 bg-selected text-on-selected"
                      : "border-border bg-background text-muted hover:border-accent/40 hover:text-foreground"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card pl-2.5 pr-1 py-0.5 text-xs font-medium text-foreground"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => onTagsChange(tags.filter((x) => x !== tag))}
                className="cursor-pointer rounded-full px-1 text-muted hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            aria-label="Add a tag"
            placeholder="Add a tag"
            className="w-36 rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground outline-none placeholder:text-muted/70 focus:border-accent/50"
          />
        </div>
      </div>
    </div>
  );
}
