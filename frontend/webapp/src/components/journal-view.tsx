"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JournalInsightsView } from "@/components/journal-insights-view";
import { scheduleJournalInsightsRefreshAfterLeavingEditor } from "@/components/journal-insights-autorefresh";
import { JournalRichEditor } from "@/components/journal-rich-editor";
import { JournalGratitudeEditor } from "@/components/journal-gratitude-editor";
import {
  fetchJournalStoreRemote,
  getMedimadeApiBase,
  getMedimadeSessionJwt,
  putJournalStoreRemote,
} from "@/lib/medimade-api";
import {
  emptyGratitudeLines,
  findGratitudeEntryForLocalDate,
  formatJournalEntryDate,
  gratitudeLinesToHtml,
  groupJournalEntriesForSidebar,
  isGratitudeEntry,
  loadJournalStore,
  localDateKey,
  newGratitudeJournalEntry,
  newJournalEntry,
  saveJournalStore,
  shouldPreferRemoteJournalStore,
  stripHtmlToText,
  type JournalEntry,
  type JournalGratitudeLines,
  type JournalStoreV2,
} from "@/lib/journal-storage";

type JournalMainTab = "journal" | "gratitude";

function entryPreview(entry: JournalEntry): string {
  if (isGratitudeEntry(entry)) {
    const t = (entry.gratitude ?? [])
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" · ");
    if (!t) return "No gratitudes yet";
    return t.length > 72 ? `${t.slice(0, 69)}…` : t;
  }
  const t = stripHtmlToText(entry.contentHtml);
  if (!t) return "Empty entry";
  return t.length > 72 ? `${t.slice(0, 69)}…` : t;
}

function sidebarEntryTitle(title: string): string {
  const t = title.trim();
  return t || "Untitled entry";
}

function activeIdForJournalTab(
  entries: JournalEntry[],
  preferred: string | null,
): string | null {
  const preferredEntry = preferred
    ? entries.find((e) => e.id === preferred)
    : undefined;
  if (preferredEntry && !isGratitudeEntry(preferredEntry)) return preferredEntry.id;
  return entries.find((e) => !isGratitudeEntry(e))?.id ?? preferred;
}

export function JournalView() {
  const [signedIn, setSignedIn] = useState(() => Boolean(getMedimadeSessionJwt()));
  const [hydrated, setHydrated] = useState(false);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [journalTab, setJournalTab] = useState<JournalMainTab>("journal");
  const [gratitudeDraft, setGratitudeDraft] = useState<JournalGratitudeLines>(
    emptyGratitudeLines(),
  );
  const prevInsightsOpenRef = useRef(false);
  /** After first journal GET attempt (or skip if no API URL); avoids PUT before pull completes. */
  const [remoteJournalChecked, setRemoteJournalChecked] = useState(false);
  const entriesRef = useRef<JournalEntry[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const latestHtmlRef = useRef("<p></p>");
  const latestTitleRef = useRef("");
  const latestGratitudeRef = useRef<JournalGratitudeLines>(emptyGratitudeLines());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipCloudPushRef = useRef(false);

  entriesRef.current = entries;
  activeIdRef.current = activeEntryId;

  useEffect(() => {
    const on = () => setSignedIn(Boolean(getMedimadeSessionJwt()));
    window.addEventListener("medimade-session-changed", on);
    return () => window.removeEventListener("medimade-session-changed", on);
  }, []);

  useEffect(() => {
    if (prevInsightsOpenRef.current && !insightsOpen) {
      scheduleJournalInsightsRefreshAfterLeavingEditor();
    }
    prevInsightsOpenRef.current = insightsOpen;
  }, [insightsOpen]);

  const persist = useCallback((nextEntries: JournalEntry[], nextActive: string | null) => {
    saveJournalStore({
      version: 2,
      activeEntryId: nextActive,
      entries: nextEntries,
    });
  }, []);

  useEffect(() => {
    const store = loadJournalStore();
    const nextActive = activeIdForJournalTab(
      store.entries,
      store.activeEntryId,
    );
    setEntries(store.entries);
    setActiveEntryId(nextActive);
    const active = store.entries.find((e) => e.id === nextActive);
    latestHtmlRef.current = active?.contentHtml ?? "<p></p>";
    latestTitleRef.current = active?.title ?? "";
    latestGratitudeRef.current = active?.gratitude ?? emptyGratitudeLines();
    setGratitudeDraft(latestGratitudeRef.current);
    setHydrated(true);
  }, [signedIn]);

  /** Pull cloud journal when API is configured and cloud copy is newer (or local is empty stub). */
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const base = getMedimadeApiBase();
    if (!base) {
      setRemoteJournalChecked(true);
      return;
    }
    void (async () => {
      try {
        const remote = await fetchJournalStoreRemote();
        if (cancelled || !remote) return;
        const localEntries = entriesRef.current;
        if (!shouldPreferRemoteJournalStore(remote, localEntries)) return;
        skipCloudPushRef.current = true;
        const preferred =
          remote.activeEntryId &&
          remote.entries.some((e) => e.id === remote.activeEntryId)
            ? remote.activeEntryId
            : remote.entries[0]?.id ?? null;
        const nextActive = activeIdForJournalTab(remote.entries, preferred);
        entriesRef.current = remote.entries;
        setEntries(remote.entries);
        setActiveEntryId(nextActive);
        const nextEntry = remote.entries.find((e) => e.id === nextActive);
        latestHtmlRef.current = nextEntry?.contentHtml ?? "<p></p>";
        latestTitleRef.current = nextEntry?.title ?? "";
        latestGratitudeRef.current = nextEntry?.gratitude ?? emptyGratitudeLines();
        setGratitudeDraft(latestGratitudeRef.current);
        persist(remote.entries, nextActive);
      } catch {
        /* offline or not deployed yet */
      } finally {
        if (!cancelled) setRemoteJournalChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, persist]);

  const cloudPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Debounced `PUT /journal/store` (server writes per-entry DynamoDB rows) when API URL is set. */
  useEffect(() => {
    if (!signedIn) return;
    if (!hydrated || !remoteJournalChecked) return;
    if (skipCloudPushRef.current) {
      skipCloudPushRef.current = false;
      return;
    }
    const base = getMedimadeApiBase();
    if (!base) return;
    if (!getMedimadeSessionJwt()) return;
    if (cloudPushTimerRef.current) clearTimeout(cloudPushTimerRef.current);
    cloudPushTimerRef.current = setTimeout(() => {
      cloudPushTimerRef.current = null;
      const store: JournalStoreV2 = {
        version: 2,
        activeEntryId,
        entries,
      };
      void putJournalStoreRemote(store).catch(() => {
        /* offline or quota */
      });
    }, 1200);
    return () => {
      if (cloudPushTimerRef.current) {
        clearTimeout(cloudPushTimerRef.current);
        cloudPushTimerRef.current = null;
      }
    };
  }, [signedIn, hydrated, remoteJournalChecked, entries, activeEntryId]);

  const flushSaveSync = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const id = activeIdRef.current;
    if (!id) return;
    const html = latestHtmlRef.current;
    const title = latestTitleRef.current;
    const gratitude = latestGratitudeRef.current;
    const prev = entriesRef.current;
    const next = prev.map((e) =>
      e.id === id
        ? {
            ...e,
            contentHtml: html,
            title,
            updatedAt: new Date().toISOString(),
            ...(isGratitudeEntry(e) ? { kind: "gratitude" as const, gratitude } : {}),
          }
        : e,
    );
    entriesRef.current = next;
    setEntries(next);
    persist(next, id);
  }, [persist]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const id = activeIdRef.current;
      if (!id) return;
      const html = latestHtmlRef.current;
      const title = latestTitleRef.current;
      const gratitude = latestGratitudeRef.current;
      setEntries((prev) => {
        const next = prev.map((e) =>
          e.id === id
            ? {
                ...e,
                contentHtml: html,
                title,
                updatedAt: new Date().toISOString(),
                ...(isGratitudeEntry(e)
                  ? { kind: "gratitude" as const, gratitude }
                  : {}),
              }
            : e,
        );
        entriesRef.current = next;
        persist(next, id);
        return next;
      });
    }, 450);
  }, [persist]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const id = activeIdRef.current;
      if (!id) return;
      const html = latestHtmlRef.current;
      const title = latestTitleRef.current;
      const gratitude = latestGratitudeRef.current;
      const next = entriesRef.current.map((e) =>
        e.id === id
          ? {
              ...e,
              contentHtml: html,
              title,
              updatedAt: new Date().toISOString(),
              ...(isGratitudeEntry(e)
                ? { kind: "gratitude" as const, gratitude }
                : {}),
            }
          : e,
      );
      saveJournalStore({
        version: 2,
        activeEntryId: id,
        entries: next,
      });
    };
  }, []);

  const activeEntry = useMemo(
    () => entries.find((e) => e.id === activeEntryId) ?? null,
    [entries, activeEntryId],
  );

  const tabEntries = useMemo(
    () =>
      journalTab === "gratitude"
        ? entries.filter(isGratitudeEntry)
        : entries.filter((e) => !isGratitudeEntry(e)),
    [entries, journalTab],
  );

  const sidebarGroups = useMemo(
    () => groupJournalEntriesForSidebar(tabEntries),
    [tabEntries],
  );

  const selectEntry = useCallback(
    (nextId: string) => {
      flushSaveSync();
      setActiveEntryId(nextId);
      const next = entriesRef.current.find((e) => e.id === nextId);
      latestHtmlRef.current = next?.contentHtml ?? "<p></p>";
      latestTitleRef.current = next?.title ?? "";
      latestGratitudeRef.current = next?.gratitude ?? emptyGratitudeLines();
      setGratitudeDraft(latestGratitudeRef.current);
    },
    [flushSaveSync],
  );

  const createEntry = useCallback(() => {
    flushSaveSync();
    const e = newJournalEntry();
    setEntries((prev) => {
      const next = [e, ...prev];
      entriesRef.current = next;
      persist(next, e.id);
      return next;
    });
    setActiveEntryId(e.id);
    latestHtmlRef.current = e.contentHtml;
    latestTitleRef.current = e.title;
    latestGratitudeRef.current = emptyGratitudeLines();
    setGratitudeDraft(latestGratitudeRef.current);
  }, [flushSaveSync, persist]);

  const openTodayGratitude = useCallback(() => {
    flushSaveSync();
    const todayKey = localDateKey();
    const existing = findGratitudeEntryForLocalDate(
      entriesRef.current,
      todayKey,
    );
    if (existing) {
      setActiveEntryId(existing.id);
      latestHtmlRef.current = existing.contentHtml;
      latestTitleRef.current = existing.title;
      latestGratitudeRef.current = existing.gratitude ?? emptyGratitudeLines();
      setGratitudeDraft(latestGratitudeRef.current);
      return;
    }
    const e = newGratitudeJournalEntry();
    setEntries((prev) => {
      const next = [e, ...prev];
      entriesRef.current = next;
      persist(next, e.id);
      return next;
    });
    setActiveEntryId(e.id);
    latestHtmlRef.current = e.contentHtml;
    latestTitleRef.current = e.title;
    latestGratitudeRef.current = e.gratitude ?? emptyGratitudeLines();
    setGratitudeDraft(latestGratitudeRef.current);
  }, [flushSaveSync, persist]);

  const switchJournalTab = useCallback(
    (tab: JournalMainTab) => {
      if (tab === journalTab) return;
      flushSaveSync();
      setInsightsOpen(false);
      setJournalTab(tab);
      if (tab === "gratitude") {
        openTodayGratitude();
        return;
      }
      const free = entriesRef.current.find((e) => !isGratitudeEntry(e));
      if (free) {
        setActiveEntryId(free.id);
        latestHtmlRef.current = free.contentHtml;
        latestTitleRef.current = free.title;
        latestGratitudeRef.current = emptyGratitudeLines();
        setGratitudeDraft(latestGratitudeRef.current);
        return;
      }
      createEntry();
    },
    [createEntry, flushSaveSync, journalTab, openTodayGratitude],
  );

  useEffect(() => {
    if (!hydrated) return;
    if (journalTab !== "journal") return;
    const active = entriesRef.current.find((e) => e.id === activeIdRef.current);
    if (!active || !isGratitudeEntry(active)) return;
    const free = entriesRef.current.find((e) => !isGratitudeEntry(e));
    if (!free) return;
    setActiveEntryId(free.id);
    latestHtmlRef.current = free.contentHtml;
    latestTitleRef.current = free.title;
    latestGratitudeRef.current = emptyGratitudeLines();
    setGratitudeDraft(latestGratitudeRef.current);
    persist(entriesRef.current, free.id);
  }, [hydrated, journalTab, entries, persist]);

  const onGratitudeChange = useCallback(
    (lines: JournalGratitudeLines) => {
      setGratitudeDraft(lines);
      latestGratitudeRef.current = lines;
      latestHtmlRef.current = gratitudeLinesToHtml(lines);
      scheduleSave();
    },
    [scheduleSave],
  );

  const initialHtmlForEditor = activeEntry?.contentHtml ?? "<p></p>";
  const initialTitleForEditor = activeEntry?.title ?? "";
  const showGratitudeEditor =
    journalTab === "gratitude" && !insightsOpen && hydrated && Boolean(activeEntry);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6">
      <div className="mb-6 shrink-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <h1 className="font-display text-3xl font-medium tracking-tight">
            Journal
          </h1>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setInsightsOpen((v) => !v)}
              aria-pressed={insightsOpen}
              className={`cursor-pointer rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                insightsOpen
                  ? "border-accent/50 bg-accent-soft text-foreground"
                  : "border-border bg-background text-foreground hover:border-accent/40"
              }`}
            >
              {insightsOpen ? "Journal" : "Insights"}
            </button>
          </div>
        </div>
        <div className="mt-4 min-w-0 w-full">
          <div
            className="inline-flex max-w-full flex-wrap rounded-xl border border-border bg-background p-1"
            role="tablist"
            aria-label="Journal section"
          >
            <button
              type="button"
              role="tab"
              aria-selected={journalTab === "journal"}
              onClick={() => switchJournalTab("journal")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                journalTab === "journal"
                  ? "bg-accent text-on-accent dark:text-deep"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Journal
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={journalTab === "gratitude"}
              onClick={() => switchJournalTab("gratitude")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                journalTab === "gratitude"
                  ? "bg-accent text-on-accent dark:text-deep"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Gratitudes
            </button>
          </div>
        </div>
        <p className="mt-2 text-muted">
          {journalTab === "gratitude" ? (
            <>
              One page a day, three things you’re grateful for. Past days stay in
              the list.{" "}
              {!signedIn ? (
                <>Sign in to enable cloud sync. </>
              ) : null}
            </>
          ) : (
            <>
              Rich notes and voice clips. With Medimade API configured, the journal
              syncs to cloud storage for this browser; otherwise it stays on this
              device only.{" "}
              {!signedIn ? (
                <>
                  Sign in to enable cloud sync and personalised topic insights.
                </>
              ) : null}{" "}
              To build a meditation from your entries, open{" "}
              <Link
                href="/meditate/create"
                className="cursor-pointer font-medium text-accent underline-offset-2 hover:underline"
              >
                Create
              </Link>{" "}
              and choose “Reflect on a journal entry”. Open{" "}
              <span className="font-medium text-foreground">Insights</span> for rolling
              themes from your entries.
            </>
          )}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row lg:gap-8">
        <aside className="flex max-h-48 shrink-0 flex-col gap-3 overflow-hidden border-b border-border pb-4 lg:max-h-none lg:w-64 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
          {journalTab === "journal" ? (
            <button
              type="button"
              onClick={createEntry}
              className="cursor-pointer rounded-xl border border-border bg-background px-3 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:border-accent/40"
            >
              + New entry
            </button>
          ) : (
            <p className="text-sm font-semibold text-foreground">Past days</p>
          )}
          <nav
            className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 [scrollbar-gutter:stable]"
            aria-label={
              journalTab === "gratitude" ? "Past gratitudes" : "Past entries"
            }
          >
            {!hydrated ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : sidebarGroups.length === 0 ? (
              <p className="text-sm text-muted">
                {journalTab === "gratitude"
                  ? "No gratitudes yet."
                  : "No entries yet."}
              </p>
            ) : (
              sidebarGroups.map((group) => (
                <div key={group.id}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    {group.label}
                  </h2>
                  <ul className="space-y-2">
                    {group.entries.map((e) => {
                      const isActive = e.id === activeEntryId;
                      const metaMuted = isActive
                        ? "text-on-accent/80 dark:text-deep/75"
                        : "text-muted";
                      return (
                        <li key={e.id}>
                          <button
                            type="button"
                            onClick={() => selectEntry(e.id)}
                            className={`w-full cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-colors ${
                              isActive
                                ? "border-accent/60 bg-accent text-on-accent shadow-sm dark:text-deep"
                                : "border-border bg-background text-foreground hover:border-accent/40"
                            }`}
                          >
                            <span className="line-clamp-2 text-sm font-semibold">
                              {sidebarEntryTitle(e.title)}
                            </span>
                            <span
                              className={`mt-0.5 line-clamp-2 text-xs ${
                                isActive
                                  ? "text-on-accent/85 dark:text-deep/80"
                                  : "text-muted"
                              }`}
                            >
                              {entryPreview(e)}
                            </span>
                            <div
                              className={`mt-2 border-t pt-2 text-[10px] leading-snug ${isActive ? "border-white/25 dark:border-deep/25" : "border-border"} ${metaMuted}`}
                            >
                              Created{" "}
                              <time dateTime={e.createdAt}>
                                {formatJournalEntryDate(e.createdAt)}
                              </time>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </nav>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {insightsOpen ? (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
              <JournalInsightsView />
            </div>
          ) : showGratitudeEditor && activeEntry ? (
            <>
              <JournalGratitudeEditor
                createdAt={activeEntry.createdAt}
                lines={gratitudeDraft}
                onChange={onGratitudeChange}
              />
              <p className="mt-3 text-sm text-muted">
                Autosaves in this browser. Come back tomorrow for a fresh page;
                today’s three stay here.
              </p>
            </>
          ) : hydrated &&
            activeEntryId &&
            activeEntry &&
            !isGratitudeEntry(activeEntry) ? (
            <>
              <JournalRichEditor
                entryId={activeEntryId}
                initialHtml={initialHtmlForEditor}
                initialTitle={initialTitleForEditor}
                createdAt={activeEntry.createdAt}
                transcribeApiBase={getMedimadeApiBase()}
                onHtmlChange={(html) => {
                  latestHtmlRef.current = html;
                  scheduleSave();
                }}
                onTitleChange={(title) => {
                  latestTitleRef.current = title;
                  scheduleSave();
                }}
              />
              <p className="mt-3 text-sm text-muted">
                Autosaves in this browser. Record places a clip where your cursor is
                (on the next line if not at the start of a line). Text from the recording
                is added automatically when the API URL and OpenAI secret are configured.
                Toolbar: headings, lists, emphasis.
              </p>
            </>
          ) : (
            <div className="min-h-[12rem] rounded-2xl border border-border bg-card shadow-sm" />
          )}
        </section>
      </div>
    </div>
  );
}
