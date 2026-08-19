"use client";

import { useMemo, useState } from "react";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { SearchInput } from "@/components/search-input";
import { journalMoodLabel, isJournalMoodId, JOURNAL_MOOD_PILL } from "@/lib/journal-moods";
import {
  deriveEntryTitle,
  isGratitudeEntry,
  journalEntryHasMeaningfulContent,
  localDateKeyFromIso,
  stripHtmlToText,
  type JournalEntry,
  type JournalFolder,
} from "@/lib/journal-storage";

function htmlToParagraphs(html: string): string[] {
  const parts = html
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/<\/(?:p|div|h[1-6]|li)>/gi)
    .map((s) =>
      s
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  return parts;
}

function dateParts(iso: string): { month: string; day: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { month: "—", day: "" };
  return {
    month: d.toLocaleString("en-US", { month: "short" }).toUpperCase(),
    day: String(d.getDate()),
  };
}

function MoodOrTagPill({
  label,
  moodId,
}: {
  label: string;
  moodId?: string;
}) {
  const palette = isJournalMoodId(moodId) ? JOURNAL_MOOD_PILL[moodId] : null;
  return (
    <span
      className={`shrink-0 rounded-[10px] px-2 py-[2px] text-[11px] font-medium ${
        palette ? "" : "text-muted"
      }`}
      style={{
        backgroundColor: palette?.background ?? "#F3F1EA",
        ...(palette ? { color: palette.color } : {}),
      }}
    >
      {label}
    </span>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12.5l4.2 4.2L19 7.5" />
    </svg>
  );
}

export function journalEntriesForReflectPicker(
  entries: JournalEntry[],
): JournalEntry[] {
  return entries
    .filter((e) => !isGratitudeEntry(e))
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
}

type SortOrder = "newest" | "oldest";

type Props = {
  entries: JournalEntry[];
  folders: JournalFolder[];
  listReady: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  guidance: string;
  onGuidanceChange: (value: string) => void;
};

export function JournalReflectPicker({
  entries,
  folders,
  listReady,
  selectedId,
  onSelect,
  guidance,
  onGuidanceChange,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [folderId, setFolderId] = useState("");
  const [jumpDate, setJumpDate] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const next = journalEntriesForReflectPicker(entries).filter((e) => {
      if (jumpDate && localDateKeyFromIso(e.createdAt) !== jumpDate) {
        return false;
      }
      if (folderId && e.folderId !== folderId) {
        return false;
      }
      if (!q) return true;
      const hay = [
        e.title,
        stripHtmlToText(e.contentHtml),
        e.mood ?? "",
        ...(e.tags ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    next.sort((a, b) => {
      const da = new Date(a.updatedAt).getTime();
      const db = new Date(b.updatedAt).getTime();
      return sortOrder === "oldest" ? da - db : db - da;
    });
    return next;
  }, [entries, folderId, jumpDate, searchQuery, sortOrder]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="journal-reflect-folder">
          Folder
        </label>
        <select
          id="journal-reflect-folder"
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          className="cursor-pointer rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50"
        >
          <option value="">All entries</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="journal-reflect-date">
          Jump to a day
        </label>
        <input
          id="journal-reflect-date"
          type="date"
          value={jumpDate}
          onChange={(e) => setJumpDate(e.target.value)}
          className="cursor-pointer rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50"
        />
        <label className="sr-only" htmlFor="journal-reflect-sort">
          Sort order
        </label>
        <select
          id="journal-reflect-sort"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as SortOrder)}
          className="cursor-pointer rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
        <SearchInput
          className="ml-auto w-full sm:w-60"
          inputClassName="py-2"
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search your journal"
          aria-label="Search your journal"
        />
      </div>
      <ul className="space-y-2">
        {!listReady ? (
          <li className="text-sm text-muted">Loading entries…</li>
        ) : filtered.length === 0 ? (
          <li className="text-sm text-muted">
            {searchQuery.trim()
              ? "No entries match."
              : jumpDate
                ? "No entry on this day."
                : folderId
                  ? "This folder is empty."
                  : "No journal entries yet."}
          </li>
        ) : (
          filtered.map((e) => {
            const title = e.title.trim() || deriveEntryTitle(e.contentHtml);
            const empty = !journalEntryHasMeaningfulContent(e);
            const preview = stripHtmlToText(e.contentHtml).trim();
            const selected = selectedId === e.id;
            const expanded = expandedIds.has(e.id);
            const { month, day } = dateParts(e.createdAt);
            const moodLabel = journalMoodLabel(e.mood);
            const tags = e.tags ?? [];
            const paragraphs = htmlToParagraphs(e.contentHtml);
            return (
              <li key={e.id} className={empty ? "opacity-70" : undefined}>
                <div
                  className={`overflow-hidden rounded-xl bg-card ${
                    selected
                      ? "border-2 border-[#D9A24F]"
                      : "border border-border"
                  }`}
                >
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                      onClick={() => toggleExpand(e.id)}
                      aria-expanded={expanded}
                    >
                      <span
                        className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg ${
                          selected ? "bg-[#FBF6EA]" : "bg-[#F3F1EA]"
                        }`}
                        aria-hidden
                      >
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted">
                          {month}
                        </span>
                        <span className="text-sm font-bold leading-none text-foreground">
                          {day}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate text-[15px] font-bold text-foreground">
                            {title}
                          </span>
                          {moodLabel ? (
                            <MoodOrTagPill
                              label={moodLabel}
                              moodId={e.mood}
                            />
                          ) : null}
                          {tags.map((tag) => (
                            <MoodOrTagPill key={tag} label={tag} />
                          ))}
                        </span>
                        <span className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-sm text-muted">
                          {empty ? (
                            <span className="italic">Empty entry</span>
                          ) : (
                            preview
                          )}
                        </span>
                      </span>
                      {expanded ? (
                        <IconChevronUp
                          size={18}
                          className="shrink-0 text-muted"
                          aria-hidden
                        />
                      ) : (
                        <IconChevronDown
                          size={18}
                          className="shrink-0 text-muted"
                          aria-hidden
                        />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={
                        selected ? "Deselect this entry" : "Select this entry"
                      }
                      aria-pressed={selected}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onSelect(e.id);
                      }}
                      className={`flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md ${
                        selected
                          ? "bg-[#33465C] text-white"
                          : "border-[1.5px] border-border bg-transparent text-transparent"
                      }`}
                    >
                      <IconCheck />
                    </button>
                  </div>
                  {expanded ? (
                    <div className="max-h-[168px] overflow-y-auto border-t border-[#EEDFC0] bg-[#FEFCF7] py-3 pl-20 pr-3 text-[13px] leading-[1.7] text-foreground">
                      {empty ? (
                        <p className="italic text-muted">Empty entry</p>
                      ) : paragraphs.length ? (
                        paragraphs.map((p, i) => (
                          <p key={i} className={i > 0 ? "mt-2" : undefined}>
                            {p}
                          </p>
                        ))
                      ) : (
                        <p>{preview}</p>
                      )}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })
        )}
      </ul>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Optional
        </p>
        <p className="mt-1 text-[15px] font-bold text-foreground">
          Anything to guide how this gets used?
        </p>
        <p className="mt-1 text-[13px] text-muted">
          e.g. focus on the calm after, not the upset itself — or leave this
          blank and let the guide decide.
        </p>
        <textarea
          value={guidance}
          onChange={(e) => onGuidanceChange(e.target.value)}
          placeholder="Optional note for the guide…"
          rows={3}
          className="mt-2 min-h-[70px] w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none ring-accent/30 placeholder:text-muted/70 focus:ring-2"
        />
      </div>
    </div>
  );
}
