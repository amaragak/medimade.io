"use client";

import { useState } from "react";
import {
  JOURNAL_MOODS,
  JOURNAL_MOOD_PILL_IDLE_BORDER,
  JOURNAL_MOOD_PILL_SELECTED,
  isJournalMoodId,
  type JournalMoodId,
} from "@/lib/journal-moods";

type Props = {
  mood?: string;
  tags?: string[];
  onMoodChange: (mood: string | undefined) => void;
  onTagsChange: (tags: string[]) => void;
  /** Header = labeled mood; inline = pills only for the connections row; tags-only keeps tag editing. */
  variant?: "footer" | "header" | "inline" | "tags";
};

function cleanTag(raw: string): string {
  return raw.trim().replace(/^#/, "").slice(0, 32);
}

function MoodPills({
  mood,
  onMoodChange,
  label,
}: {
  mood?: string;
  onMoodChange: (mood: string | undefined) => void;
  label?: string;
}) {
  return (
    <div className={label ? undefined : "inline-flex min-w-0"}>
      {label ? (
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {label}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Mood">
        {JOURNAL_MOODS.map((m) => {
          const on = mood === m.id;
          const selected = isJournalMoodId(m.id)
            ? JOURNAL_MOOD_PILL_SELECTED[m.id as JournalMoodId]
            : null;
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={on}
              onClick={() => onMoodChange(on ? undefined : m.id)}
              className="cursor-pointer rounded-[14px] border px-2.5 py-[3px] text-[12px] font-medium transition-colors"
              style={
                on && selected
                  ? {
                      background: selected.background,
                      borderColor: selected.border,
                      color: selected.color,
                    }
                  : {
                      background: "transparent",
                      borderColor: JOURNAL_MOOD_PILL_IDLE_BORDER,
                      color: "var(--muted)",
                    }
              }
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TagsRow({
  tags,
  onTagsChange,
}: {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
}) {
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
    <div className="flex flex-wrap items-center gap-1.5">
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
  );
}

export function JournalEntryMeta({
  mood,
  tags = [],
  onMoodChange,
  onTagsChange,
  variant = "footer",
}: Props) {
  if (variant === "header") {
    return <MoodPills mood={mood} onMoodChange={onMoodChange} label="Mood" />;
  }

  if (variant === "inline") {
    return <MoodPills mood={mood} onMoodChange={onMoodChange} />;
  }

  if (variant === "tags") {
    return <TagsRow tags={tags} onTagsChange={onTagsChange} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <MoodPills
        mood={mood}
        onMoodChange={onMoodChange}
        label="How does this feel"
      />
      <TagsRow tags={tags} onTagsChange={onTagsChange} />
    </div>
  );
}
