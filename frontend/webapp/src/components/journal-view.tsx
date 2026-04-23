"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JournalInsightsView } from "@/components/journal-insights-view";
import { scheduleJournalInsightsRefreshAfterLeavingEditor } from "@/components/journal-insights-autorefresh";
import { JournalRichEditor } from "@/components/journal-rich-editor";
import {
  fetchJournalStoreRemote,
  getMedimadeApiBase,
  getMedimadeSessionJwt,
  putJournalStoreRemote,
} from "@/lib/medimade-api";
import {
  JOURNAL_MEDITATION_PAYLOAD_KEY,
  armJournalMeditationHandoffJson,
  formatJournalEntryDate,
  groupJournalEntriesForSidebar,
  journalEntryPlainForHandoff,
  loadJournalStore,
  newJournalEntry,
  saveJournalStore,
  stripHtmlToText,
  type JournalEntry,
  type JournalMeditationPayloadV1,
  type JournalStoreV2,
} from "@/lib/journal-storage";

const RECENT_ENTRIES_FOR_MODAL = 25;

function entryPreview(html: string): string {
  const t = stripHtmlToText(html);
  if (!t) return "Empty entry";
  return t.length > 72 ? `${t.slice(0, 69)}…` : t;
}

function sidebarEntryTitle(title: string): string {
  const t = title.trim();
  return t || "Untitled entry";
}

function maxEntryUpdatedAt(entries: JournalEntry[]): number {
  if (!entries.length) return 0;
  return Math.max(...entries.map((e) => new Date(e.updatedAt).getTime()), 0);
}

/** Prefer cloud copy when it is newer, or when local is a single empty stub and cloud has data. */
function shouldPreferRemoteJournal(
  remote: JournalStoreV2,
  localEntries: JournalEntry[],
): boolean {
  if (!remote.entries?.length) return false;
  const remoteMax = maxEntryUpdatedAt(remote.entries);
  const localMax = maxEntryUpdatedAt(localEntries);
  if (remoteMax > localMax) return true;
  if (localEntries.length === 1) {
    const e = localEntries[0];
    if (e.title.trim()) return false;
    const plain = stripHtmlToText(e.contentHtml).trim();
    if (plain.length === 0 && remote.entries.length > 0) return true;
  }
  return false;
}

export function JournalView() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(() => Boolean(getMedimadeSessionJwt()));
  const [hydrated, setHydrated] = useState(false);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const prevInsightsOpenRef = useRef(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(
    () => new Set(),
  );
  /** After first journal GET attempt (or skip if no API URL); avoids PUT before pull completes. */
  const [remoteJournalChecked, setRemoteJournalChecked] = useState(false);
  const entriesRef = useRef<JournalEntry[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const latestHtmlRef = useRef("<p></p>");
  const latestTitleRef = useRef("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generateModalOpenedRef = useRef(false);
  const skipCloudPushRef = useRef(false);

  entriesRef.current = entries;
  activeIdRef.current = activeEntryId;

  useEffect(() => {
    const on = () => setSignedIn(Boolean(getMedimadeSessionJwt()));
    window.addEventListener("medimade-session-changed", on);
    return () => window.removeEventListener("medimade-session-changed", on);
  }, []);

  useEffect(() => {
    if (!signedIn) setInsightsOpen(false);
  }, [signedIn]);

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
    if (!signedIn) {
      setHydrated(true);
      return;
    }
    const store = loadJournalStore();
    setEntries(store.entries);
    setActiveEntryId(store.activeEntryId);
    const active = store.entries.find((e) => e.id === store.activeEntryId);
    latestHtmlRef.current = active?.contentHtml ?? "<p></p>";
    latestTitleRef.current = active?.title ?? "";
    setHydrated(true);
  }, [signedIn]);

  /** Pull cloud journal when API is configured and cloud copy is newer (or local is empty stub). */
  useEffect(() => {
    if (!signedIn) {
      setRemoteJournalChecked(true);
      return;
    }
    if (!hydrated) return;
    let cancelled = false;
    const base = getMedimadeApiBase();
    if (!base) {
      setRemoteJournalChecked(true);
      return;
    }
    if (!getMedimadeSessionJwt()) {
      setRemoteJournalChecked(true);
      return;
    }
    void (async () => {
      try {
        const remote = await fetchJournalStoreRemote();
        if (cancelled || !remote) return;
        const localEntries = entriesRef.current;
        if (!shouldPreferRemoteJournal(remote, localEntries)) return;
        skipCloudPushRef.current = true;
        const nextActive =
          remote.activeEntryId &&
          remote.entries.some((e) => e.id === remote.activeEntryId)
            ? remote.activeEntryId
            : remote.entries[0]?.id ?? null;
        entriesRef.current = remote.entries;
        setEntries(remote.entries);
        setActiveEntryId(nextActive);
        const nextEntry = remote.entries.find((e) => e.id === nextActive);
        latestHtmlRef.current = nextEntry?.contentHtml ?? "<p></p>";
        latestTitleRef.current = nextEntry?.title ?? "";
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
  }, [signedIn, hydrated, persist]);

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
    const prev = entriesRef.current;
    const next = prev.map((e) =>
      e.id === id
        ? {
            ...e,
            contentHtml: html,
            title,
            updatedAt: new Date().toISOString(),
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
      setEntries((prev) => {
        const next = prev.map((e) =>
          e.id === id
            ? {
                ...e,
                contentHtml: html,
                title,
                updatedAt: new Date().toISOString(),
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
      const next = entriesRef.current.map((e) =>
        e.id === id
          ? {
              ...e,
              contentHtml: html,
              title,
              updatedAt: new Date().toISOString(),
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

  const sidebarGroups = useMemo(
    () => groupJournalEntriesForSidebar(entries),
    [entries],
  );

  const recentEntriesForModal = useMemo(() => {
    return [...entries]
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .slice(0, RECENT_ENTRIES_FOR_MODAL);
  }, [entries]);

  useEffect(() => {
    if (!generateModalOpen) {
      generateModalOpenedRef.current = false;
      return;
    }
    if (generateModalOpenedRef.current) return;
    generateModalOpenedRef.current = true;
    const next = new Set<string>();
    for (
      let i = 0;
      i < Math.min(3, recentEntriesForModal.length);
      i += 1
    ) {
      next.add(recentEntriesForModal[i].id);
    }
    setSelectedEntryIds(next);
  }, [generateModalOpen, recentEntriesForModal]);

  useEffect(() => {
    if (!generateModalOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setGenerateModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [generateModalOpen]);

  const toggleEntrySelected = useCallback((id: string) => {
    setSelectedEntryIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const handleGenerateContinue = useCallback(() => {
    flushSaveSync();
    const ordered = recentEntriesForModal.filter((e) =>
      selectedEntryIds.has(e.id),
    );
    if (!ordered.length) return;

    const segments = ordered.map((e) => ({
      entryId: e.id,
      title: sidebarEntryTitle(e.title),
      bodyPlain: journalEntryPlainForHandoff(e.contentHtml),
      createdAt: e.createdAt,
    }));

    const payload: JournalMeditationPayloadV1 = {
      v: 1,
      at: new Date().toISOString(),
      segments,
    };

    const json = JSON.stringify(payload);
    try {
      sessionStorage.setItem(JOURNAL_MEDITATION_PAYLOAD_KEY, json);
    } catch {
      /* ignore */
    }
    armJournalMeditationHandoffJson(json);
    setGenerateModalOpen(false);
    router.push("/meditate/create?fromJournal=1");
  }, [
    flushSaveSync,
    recentEntriesForModal,
    selectedEntryIds,
    router,
  ]);

  const selectEntry = useCallback(
    (nextId: string) => {
      flushSaveSync();
      setActiveEntryId(nextId);
      const next = entriesRef.current.find((e) => e.id === nextId);
      latestHtmlRef.current = next?.contentHtml ?? "<p></p>";
      latestTitleRef.current = next?.title ?? "";
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
  }, [flushSaveSync, persist]);

  const initialHtmlForEditor = activeEntry?.contentHtml ?? "<p></p>";
  const initialTitleForEditor = activeEntry?.title ?? "";

  if (!signedIn) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10 sm:px-6">
        <h1 className="font-display text-3xl font-medium tracking-tight">Journal</h1>
        <p className="mt-2 text-muted">
          Sign in to view and edit your journal. Entries are stored per account and
          can’t be accessed by other users.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 dark:text-deep"
          >
            Sign in
          </Link>
          <Link
            href="/"
            className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-accent/40"
          >
            Back
          </Link>
        </div>
      </div>
    );
  }

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
              className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                insightsOpen
                  ? "border-accent/50 bg-accent-soft text-foreground"
                  : "border-border bg-background text-foreground hover:border-accent/40"
              }`}
            >
              {insightsOpen ? "Journal" : "Insights"}
            </button>
            <button
              type="button"
              onClick={() => setGenerateModalOpen(true)}
              disabled={!hydrated || entries.length === 0 || insightsOpen}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40 dark:text-deep"
            >
              Generate meditation
            </button>
          </div>
        </div>
        <p className="mt-2 text-muted">
          Rich notes and voice clips. With Medimade API configured, the journal
          syncs to cloud storage for this browser; otherwise it stays on this
          device only. You can turn entries into guided meditations from here.
          Open <span className="font-medium text-foreground">Insights</span> for
          rolling themes from your entries.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row lg:gap-8">
        <aside className="flex max-h-48 shrink-0 flex-col gap-3 overflow-hidden border-b border-border pb-4 lg:max-h-none lg:w-64 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
          <button
            type="button"
            onClick={createEntry}
            className="rounded-xl border border-border bg-background px-3 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:border-accent/40"
          >
            + New entry
          </button>
          <nav
            className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 [scrollbar-gutter:stable]"
            aria-label="Past entries"
          >
            {!hydrated ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : sidebarGroups.length === 0 ? (
              <p className="text-sm text-muted">No entries yet.</p>
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
                        ? "text-white/80 dark:text-deep/75"
                        : "text-muted";
                      return (
                        <li key={e.id}>
                          <button
                            type="button"
                            onClick={() => selectEntry(e.id)}
                            className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                              isActive
                                ? "border-accent/60 bg-accent text-white shadow-sm dark:text-deep"
                                : "border-border bg-background text-foreground hover:border-accent/40"
                            }`}
                          >
                            <span className="line-clamp-2 text-sm font-semibold">
                              {sidebarEntryTitle(e.title)}
                            </span>
                            <span
                              className={`mt-0.5 line-clamp-2 text-xs ${
                                isActive
                                  ? "text-white/85 dark:text-deep/80"
                                  : "text-muted"
                              }`}
                            >
                              {entryPreview(e.contentHtml)}
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
          ) : hydrated && activeEntryId && activeEntry ? (
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

      {generateModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
          role="presentation"
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-deep/40 dark:bg-black/50"
            onClick={() => setGenerateModalOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="journal-generate-title"
            className="relative z-10 flex max-h-[min(90dvh,36rem)] w-full max-w-lg flex-col rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-2xl"
          >
            <div className="border-b border-border px-5 py-4">
              <h2
                id="journal-generate-title"
                className="font-display text-lg font-medium tracking-tight text-foreground"
              >
                Generate a meditation
              </h2>
              <p className="mt-1 text-sm text-muted">
                Choose recent journal entries to bring into Create. Your text is
                copied into the chat as a starting message you can edit before
                sending.
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Recent entries (newest first)
              </p>
              <ul className="mt-2 space-y-2">
                {recentEntriesForModal.map((e) => {
                  const checked = selectedEntryIds.has(e.id);
                  return (
                    <li key={e.id}>
                      <label className="flex cursor-pointer gap-3 rounded-xl border border-border bg-background px-3 py-2.5 transition-colors hover:border-accent/35 focus-within:ring-2 focus-within:ring-accent/30">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleEntrySelected(e.id)}
                          className="mt-0.5 size-4 shrink-0 rounded border-border text-accent focus:ring-accent/40"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-foreground">
                            {sidebarEntryTitle(e.title)}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted">
                            Created {formatJournalEntryDate(e.createdAt)}
                          </span>
                          <span className="mt-1 line-clamp-2 text-xs text-muted">
                            {entryPreview(e.contentHtml)}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4">
              <button
                type="button"
                onClick={() => setGenerateModalOpen(false)}
                className="rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-accent/40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={selectedEntryIds.size === 0}
                onClick={handleGenerateContinue}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40 dark:text-deep"
              >
                Continue to Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
