"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconCalendar,
  IconChevronDown,
  IconChevronUp,
} from "@tabler/icons-react";
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
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [mobileDateOpen, setMobileDateOpen] = useState(false);
  const dateMenuRef = useRef<HTMLDivElement | null>(null);

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

  const mobileFilterActive = Boolean(folderId) || sortOrder !== "newest";

  useEffect(() => {
    if (!mobileDateOpen) return;
    function onDoc(e: MouseEvent) {
      if (!dateMenuRef.current?.contains(e.target as Node)) {
        setMobileDateOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileDateOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileDateOpen]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const mobileIconChrome =
    "flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[9px] border border-foreground/12 bg-foreground/[0.06] text-foreground";
  const mobileSearchChrome =
    "h-9 rounded-[9px] border border-foreground/12 bg-foreground/[0.06] py-0 pl-9 pr-3 text-sm leading-9 placeholder:text-muted";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-2">
      {/* Desktop/tablet: separate controls (unchanged) */}
      <div className="hidden flex-wrap items-center gap-2 sm:flex">
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

      {/* Mobile: search + filter + calendar on one row */}
      <div className="flex items-center gap-2 sm:hidden">
        <SearchInput
          className="min-w-0 flex-1"
          inputClassName={mobileSearchChrome}
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search your journal"
          aria-label="Search your journal"
        />
        <button
          type="button"
          onClick={() => {
            setMobileDateOpen(false);
            setMobileFilterOpen(true);
          }}
          aria-label="Folder and sort filters"
          aria-haspopup="dialog"
          aria-expanded={mobileFilterOpen}
          className={`relative ${mobileIconChrome} ${
            mobileFilterActive ? "border-accent/40 bg-accent-soft/40" : ""
          }`}
        >
          <IconAdjustmentsHorizontal size={20} stroke={1.75} aria-hidden />
          {mobileFilterActive ? (
            <span
              className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-card bg-accent"
              aria-hidden
            />
          ) : null}
        </button>
        <div ref={dateMenuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => {
              setMobileFilterOpen(false);
              setMobileDateOpen((v) => !v);
            }}
            aria-label="Jump to a specific day"
            aria-haspopup="dialog"
            aria-expanded={mobileDateOpen}
            className={`${mobileIconChrome} ${
              jumpDate ? "border-accent/40 bg-accent-soft/40" : ""
            }`}
          >
            <IconCalendar size={20} stroke={1.75} aria-hidden />
          </button>
          {mobileDateOpen ? (
            <div
              className="absolute right-0 z-30 mt-1 w-52 rounded-xl border border-border bg-card p-2 shadow-lg"
              role="dialog"
              aria-label="Jump to a day"
            >
              <p className="text-sm font-medium text-foreground">Jump to a day</p>
              <p className="mt-0.5 text-xs text-muted">
                Pick a date to see the entry from that day.
              </p>
              <input
                type="date"
                value={jumpDate}
                onChange={(ev) => {
                  setJumpDate(ev.target.value);
                  if (ev.target.value) setMobileDateOpen(false);
                }}
                className="mt-2 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent/50"
              />
              {jumpDate ? (
                <button
                  type="button"
                  className="mt-1.5 cursor-pointer text-xs font-medium text-accent-link underline-offset-2 hover:underline"
                  onClick={() => {
                    setJumpDate("");
                    setMobileDateOpen(false);
                  }}
                >
                  Clear date
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
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
                  <div className="flex items-center gap-1 px-2 py-2 sm:gap-3 sm:px-3 sm:py-2.5">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-1 py-0.5 text-left"
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
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center text-muted sm:h-auto sm:w-auto">
                        {expanded ? (
                          <IconChevronUp size={18} aria-hidden />
                        ) : (
                          <IconChevronDown size={18} aria-hidden />
                        )}
                      </span>
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
                      className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center"
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-md ${
                          selected
                            ? "bg-[#33465C] text-white"
                            : "border-[1.5px] border-border bg-transparent text-transparent"
                        }`}
                      >
                        <IconCheck />
                      </span>
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

      {mobileFilterOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-overlay/45 p-4 backdrop-blur-[2px] sm:hidden"
          role="presentation"
          onClick={() => setMobileFilterOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="journal-reflect-mobile-filter-title"
            className="max-h-[min(85vh,32rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                id="journal-reflect-mobile-filter-title"
                className="font-display text-lg font-medium text-foreground"
              >
                Sort & filter
              </h2>
              <button
                type="button"
                onClick={() => setMobileFilterOpen(false)}
                className="cursor-pointer rounded-lg px-2 py-1 text-sm text-muted hover:bg-accent-soft/50 hover:text-foreground"
              >
                Done
              </button>
            </div>
            <section className="mt-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Folder
              </h3>
              <div
                className="mt-2 flex flex-col gap-1"
                role="listbox"
                aria-label="Filter by folder"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={!folderId}
                  onClick={() => setFolderId("")}
                  className={`w-full cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${
                    !folderId
                      ? "bg-selected/15 text-foreground"
                      : "text-muted hover:bg-accent-soft/40 hover:text-foreground"
                  }`}
                >
                  All entries
                </button>
                {folders.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="option"
                    aria-selected={folderId === f.id}
                    onClick={() => setFolderId(f.id)}
                    className={`w-full cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${
                      folderId === f.id
                        ? "bg-selected/15 text-foreground"
                        : "text-muted hover:bg-accent-soft/40 hover:text-foreground"
                    }`}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </section>
            <section className="mt-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Sort
              </h3>
              <div
                className="mt-2 flex flex-col gap-1"
                role="listbox"
                aria-label="Sort entries"
              >
                {(
                  [
                    { value: "newest" as const, label: "Newest" },
                    { value: "oldest" as const, label: "Oldest" },
                  ] as const
                ).map((it) => {
                  const selected = sortOrder === it.value;
                  return (
                    <button
                      key={it.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => setSortOrder(it.value)}
                      className={`w-full cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${
                        selected
                          ? "bg-selected/15 text-foreground"
                          : "text-muted hover:bg-accent-soft/40 hover:text-foreground"
                      }`}
                    >
                      {it.label}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
