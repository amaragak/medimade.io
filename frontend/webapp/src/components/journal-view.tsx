"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JournalInsightsView } from "@/components/journal-insights-view";
import { scheduleJournalInsightsRefreshAfterLeavingEditor } from "@/components/journal-insights-autorefresh";
import {
  clearJournalRemoteSessionCache,
  markJournalStorePulledThisSession,
  wasJournalStorePulledThisSession,
} from "@/lib/journal-remote-cache";
import { JournalRichEditor } from "@/components/journal-rich-editor";
import { JournalGratitudeEditor } from "@/components/journal-gratitude-editor";
import { JournalEntryMeta } from "@/components/journal-entry-meta";
import {
  IconSettingsCog,
  JournalSettingsDialog,
} from "@/components/journal-settings-dialog";
import { JournalImportDialog } from "@/components/journal-import-dialog";
import {
  mergeImportedEntries,
  previewRowsToEntries,
  type JournalImportPreviewRow,
} from "@/lib/journal-import";
import { SearchInput } from "@/components/search-input";
import { Calendar, ChevronLeft, Folder, Import } from "lucide-react";
import { JournalLockGate } from "@/components/journal-lock-gate";
import {
  fetchJournalStoreRemote,
  getMedimadeApiBase,
  getMedimadeSessionJwt,
  putJournalStoreRemote,
  runJournalInsightsRemote,
} from "@/lib/medimade-api";
import {
  emptyGratitudeLines,
  entriesForCloudPut,
  ensureGuestDemoJournalSeeded,
  findGratitudeEntryForLocalDate,
  formatJournalEntryDate,
  gratitudeLinesToHtml,
  groupJournalEntriesForSidebar,
  isDemoJournalEntry,
  isDemoOnlyStore,
  isGratitudeEntry,
  journalWritingStreakDays,
  loadJournalStoreRaw,
  localDateKey,
  localDateKeyFromIso,
  mergeRemoteJournalKeepingLocalOnly,
  newGratitudeJournalEntry,
  newJournalEntry,
  newJournalFolder,
  saveJournalStore,
  stripHtmlToText,
  withoutDemoJournalEntries,
  type JournalEntry,
  type JournalFolder,
  type JournalGratitudeLines,
  type JournalStoreV2,
} from "@/lib/journal-storage";

type JournalMainTab = "journal" | "gratitude";
type JournalSection = JournalMainTab | "insights";

const JOURNAL_SECTION_HREF = {
  journal: "/journal/my",
  gratitude: "/journal/my/gratitudes",
  insights: "/journal/my/insights",
} as const;

function journalSectionFromPath(pathname: string): JournalSection {
  if (
    pathname === "/journal/my/insights" ||
    pathname.startsWith("/journal/my/insights/")
  ) {
    return "insights";
  }
  if (
    pathname === "/journal/my/gratitudes" ||
    pathname.startsWith("/journal/my/gratitudes/")
  ) {
    return "gratitude";
  }
  return "journal";
}

/** Entry id from `/journal/:entryId` (not gratitudes/insights). */
function journalEntryIdFromPath(pathname: string): string | null {
  if (
    pathname === "/journal/my" ||
    pathname === "/journal/my/" ||
    pathname.startsWith("/journal/my/gratitudes") ||
    pathname.startsWith("/journal/my/insights")
  ) {
    return null;
  }
  const m = /^\/journal\/my\/([^/]+)\/?$/.exec(pathname);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** Entry id from `/journal/my/gratitudes/:entryId`. */
function gratitudeEntryIdFromPath(pathname: string): string | null {
  const m = /^\/journal\/my\/gratitudes\/([^/]+)\/?$/.exec(pathname);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function JournalSettingsIconButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label="Journal settings"
      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-border bg-background text-muted transition-colors hover:border-accent/40 hover:text-foreground"
    >
      <IconSettingsCog />
    </button>
  );
}

function IconEntryMore({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  );
}

const FOLDER_ALL = "";

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

function JumpToDayPopover({
  jumpDate,
  onPick,
  onClear,
}: {
  jumpDate: string;
  onPick: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div
      className="absolute left-0 z-30 mt-1 w-52 rounded-xl border border-border bg-card p-2 shadow-lg"
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
        onChange={(ev) => onPick(ev.target.value)}
        className="mt-2 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent/50"
      />
      {jumpDate ? (
        <button
          type="button"
          className="mt-1.5 cursor-pointer text-xs font-medium text-accent-link underline-offset-2 hover:underline"
          onClick={onClear}
        >
          Clear date
        </button>
      ) : null}
    </div>
  );
}

export function JournalView() {
  const [signedIn, setSignedIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [folders, setFolders] = useState<JournalFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState(FOLDER_ALL);
  const [namingFolder, setNamingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [sidebarMenu, setSidebarMenu] = useState<
    null | "folder" | "date" | "filters"
  >(null);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [mobileEntryMenuOpen, setMobileEntryMenuOpen] = useState(false);
  const pathname = usePathname() || "/journal/my";
  const router = useRouter();
  const section = journalSectionFromPath(pathname);
  const routeEntryId = journalEntryIdFromPath(pathname);
  const routeGratitudeId = gratitudeEntryIdFromPath(pathname);
  /** Mobile journal: editor is its own full-screen route (`/journal/:id`). */
  const mobileJournalEditor =
    section === "journal" && Boolean(routeEntryId);
  /** Mobile gratitudes: compose is `/journal/my/gratitudes/:id`. */
  const mobileGratitudeCompose =
    section === "gratitude" && Boolean(routeGratitudeId);
  /** Mobile insights: letter detail is `/journal/my/insights/:weekKey`. */
  const mobileInsightsLetter =
    section === "insights" &&
    Boolean(/^\/journal\/insights\/[^/]+\/?$/.test(pathname));
  const mobileComposeChrome =
    mobileJournalEditor || mobileGratitudeCompose || mobileInsightsLetter;
  const insightsOpen = section === "insights";
  const [insightsMounted, setInsightsMounted] = useState(insightsOpen);
  const [listTab, setListTab] = useState<JournalMainTab>(() =>
    section === "gratitude" ? "gratitude" : "journal",
  );
  const journalTab: JournalMainTab =
    section === "gratitude"
      ? "gratitude"
      : section === "journal"
        ? "journal"
        : listTab;
  const [gratitudeDraft, setGratitudeDraft] = useState<JournalGratitudeLines>(
    emptyGratitudeLines(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [jumpDate, setJumpDate] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importBatchId, setImportBatchId] = useState<string | null>(null);
  const prevSectionRef = useRef<JournalSection | null>(null);
  /** After first journal GET attempt (or skip if no API URL); avoids PUT before pull completes. */
  const [remoteJournalChecked, setRemoteJournalChecked] = useState(false);
  const entriesRef = useRef<JournalEntry[]>([]);
  const foldersRef = useRef<JournalFolder[]>([]);
  const folderMenuRef = useRef<HTMLDivElement | null>(null);
  const dateMenuRef = useRef<HTMLDivElement | null>(null);
  const filtersMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileEntryMenuRef = useRef<HTMLDivElement | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const latestHtmlRef = useRef("<p></p>");
  const latestTitleRef = useRef("");
  const latestGratitudeRef = useRef<JournalGratitudeLines>(emptyGratitudeLines());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipCloudPushRef = useRef(false);

  entriesRef.current = entries;
  foldersRef.current = folders;
  activeIdRef.current = activeEntryId;

  useEffect(() => {
    if (section === "journal" || section === "gratitude") {
      setListTab(section);
    }
    if (section === "insights") {
      setInsightsMounted(true);
    }
  }, [section]);

  useEffect(() => {
    const sync = () => {
      const next = Boolean(getMedimadeSessionJwt());
      setSignedIn((prev) => {
        if (prev !== next) {
          clearJournalRemoteSessionCache();
          setRemoteJournalChecked(false);
          setHydrated(false);
        }
        return next;
      });
      setAuthReady(true);
    };
    void import("@/lib/auth-session").then((m) =>
      m.ensureMedimadeSession().finally(sync),
    );
    window.addEventListener("medimade-session-changed", sync);
    return () => window.removeEventListener("medimade-session-changed", sync);
  }, []);

  useEffect(() => {
    if (prevSectionRef.current === "insights" && section !== "insights") {
      scheduleJournalInsightsRefreshAfterLeavingEditor();
    }
    prevSectionRef.current = section;
  }, [section]);

  useEffect(() => {
    if (!sidebarMenu) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (
        folderMenuRef.current?.contains(t) ||
        dateMenuRef.current?.contains(t) ||
        filtersMenuRef.current?.contains(t)
      ) {
        return;
      }
      setSidebarMenu(null);
      setNamingFolder(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSidebarMenu(null);
        setNamingFolder(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [sidebarMenu]);

  useEffect(() => {
    if (!mobileEntryMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!mobileEntryMenuRef.current?.contains(e.target as Node)) {
        setMobileEntryMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileEntryMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileEntryMenuOpen]);

  useEffect(() => {
    setMobileEntryMenuOpen(false);
  }, [routeEntryId, routeGratitudeId]);

  const persist = useCallback(
    (
      nextEntries: JournalEntry[],
      nextActive: string | null,
      nextFolders?: JournalFolder[],
    ) => {
      const foldersNext = nextFolders ?? foldersRef.current;
      saveJournalStore({
        version: 2,
        activeEntryId: nextActive,
        entries: nextEntries,
        ...(foldersNext.length ? { folders: foldersNext } : {}),
      });
    },
    [],
  );

  useEffect(() => {
    if (!authReady) return;
    // Guests: demo samples on device. Signed-in: localStorage is only a cache —
    // strip demos and wait for GET /journal/store (cloud is source of truth).
    const store = signedIn
      ? withoutDemoJournalEntries(loadJournalStoreRaw())
      : ensureGuestDemoJournalSeeded();
    const nextActive = activeIdForJournalTab(
      store.entries,
      store.activeEntryId,
    );
    setEntries(store.entries);
    setFolders(store.folders ?? []);
    foldersRef.current = store.folders ?? [];
    setActiveEntryId(nextActive);
    const active = store.entries.find((e) => e.id === nextActive);
    latestHtmlRef.current = active?.contentHtml ?? "<p></p>";
    latestTitleRef.current = active?.title ?? "";
    latestGratitudeRef.current = active?.gratitude ?? emptyGratitudeLines();
    setGratitudeDraft(latestGratitudeRef.current);
    setHydrated(true);
    if (signedIn) {
      // Don't allow a previous guest "checked" skip to fire an empty PUT.
      setRemoteJournalChecked(false);
    }
  }, [authReady, signedIn]);

  /** Pull cloud journal when signed in (guests stay on local demo / device pages). */
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const base = getMedimadeApiBase();
    if (!signedIn || !base) {
      setRemoteJournalChecked(true);
      return;
    }
    if (wasJournalStorePulledThisSession()) {
      setRemoteJournalChecked(true);
      return;
    }
    void (async () => {
      try {
        const remote = await fetchJournalStoreRemote();
        if (cancelled) return;
        const localEntries = entriesRef.current;
        const localIsDemoOnly =
          localEntries.length === 0 || isDemoOnlyStore({
            version: 2,
            activeEntryId: null,
            entries: localEntries,
          });

        if (!remote?.entries?.length) {
          // Empty cloud account: start a blank personal page (never keep demos).
          if (localIsDemoOnly || localEntries.some(isDemoJournalEntry)) {
            const blank = newJournalEntry();
            skipCloudPushRef.current = true;
            entriesRef.current = [blank];
            setEntries([blank]);
            setFolders([]);
            foldersRef.current = [];
            setActiveEntryId(blank.id);
            latestHtmlRef.current = blank.contentHtml;
            latestTitleRef.current = blank.title;
            latestGratitudeRef.current = emptyGratitudeLines();
            setGratitudeDraft(latestGratitudeRef.current);
            persist([blank], blank.id, []);
          } else {
            // Cache already has personal rows with empty remote — keep showing
            // them and let the push effect upload (first sync of this device).
            skipCloudPushRef.current = false;
          }
          return;
        }

        // Cloud wins: replace device cache (including any leftover demos).
        skipCloudPushRef.current = true;
        const merged = mergeRemoteJournalKeepingLocalOnly(
          remote,
          localEntries,
        );
        const preferred =
          merged.activeEntryId &&
          merged.entries.some((e) => e.id === merged.activeEntryId)
            ? merged.activeEntryId
            : merged.entries[0]?.id ?? null;
        const nextActive = activeIdForJournalTab(merged.entries, preferred);
        entriesRef.current = merged.entries;
        setEntries(merged.entries);
        setFolders(merged.folders ?? []);
        foldersRef.current = merged.folders ?? [];
        setActiveEntryId(nextActive);
        const nextEntry = merged.entries.find((e) => e.id === nextActive);
        latestHtmlRef.current = nextEntry?.contentHtml ?? "<p></p>";
        latestTitleRef.current = nextEntry?.title ?? "";
        latestGratitudeRef.current =
          nextEntry?.gratitude ?? emptyGratitudeLines();
        setGratitudeDraft(latestGratitudeRef.current);
        persist(merged.entries, nextActive, merged.folders ?? []);
      } catch {
        /* offline — keep non-demo local cache if any */
        const cleaned = withoutDemoJournalEntries({
          version: 2,
          activeEntryId: activeIdRef.current,
          entries: entriesRef.current,
          ...(foldersRef.current.length
            ? { folders: foldersRef.current }
            : {}),
        });
        if (cleaned.entries.length !== entriesRef.current.length) {
          skipCloudPushRef.current = true;
          entriesRef.current = cleaned.entries;
          setEntries(cleaned.entries);
          setActiveEntryId(cleaned.activeEntryId);
          persist(cleaned.entries, cleaned.activeEntryId, foldersRef.current);
        }
      } finally {
        if (!cancelled) {
          markJournalStorePulledThisSession();
          setRemoteJournalChecked(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, persist, signedIn]);

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
    const cloudEntries = entriesForCloudPut(entries);
    // Never push an empty body while demos are still on screen (would wipe cloud).
    if (
      cloudEntries.length === 0 &&
      entries.some(isDemoJournalEntry)
    ) {
      return;
    }
    if (cloudPushTimerRef.current) clearTimeout(cloudPushTimerRef.current);
    cloudPushTimerRef.current = setTimeout(() => {
      cloudPushTimerRef.current = null;
      const store: JournalStoreV2 = {
        version: 2,
        activeEntryId: cloudEntries.some((e) => e.id === activeEntryId)
          ? activeEntryId
          : (cloudEntries[0]?.id ?? null),
        entries: cloudEntries,
        ...(folders.length ? { folders } : {}),
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
  }, [signedIn, hydrated, remoteJournalChecked, entries, activeEntryId, folders]);

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
        ...(foldersRef.current.length ? { folders: foldersRef.current } : {}),
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

  const filteredTabEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tabEntries.filter((e) => {
      if (jumpDate && localDateKeyFromIso(e.createdAt) !== jumpDate) {
        return false;
      }
      if (importBatchId && e.importBatchId !== importBatchId) {
        return false;
      }
      if (
        journalTab === "journal" &&
        selectedFolderId &&
        e.folderId !== selectedFolderId
      ) {
        return false;
      }
      if (!q) return true;
      const hay = [
        e.title,
        stripHtmlToText(e.contentHtml),
        ...(e.tags ?? []),
        e.mood ?? "",
        ...(e.gratitude ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [tabEntries, searchQuery, jumpDate, importBatchId, journalTab, selectedFolderId]);

  const sidebarGroups = useMemo(
    () => groupJournalEntriesForSidebar(filteredTabEntries),
    [filteredTabEntries],
  );

  const streakDays = useMemo(
    () => journalWritingStreakDays(entries),
    [entries],
  );

  const folderFilterLabel =
    folders.find((f) => f.id === selectedFolderId)?.name ?? "All entries";

  const patchActive = useCallback(
    (partial: Partial<JournalEntry>) => {
      const id = activeIdRef.current;
      if (!id) return;
      setEntries((prev) => {
        const next = prev.map((e) =>
          e.id === id
            ? { ...e, ...partial, updatedAt: new Date().toISOString() }
            : e,
        );
        entriesRef.current = next;
        persist(next, id);
        return next;
      });
    },
    [persist],
  );

  const deleteActive = useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    if (!window.confirm("Delete this entry from this device?")) return;
    const remaining = entriesRef.current.filter((e) => e.id !== id);
    let nextEntries = remaining;
    let nextId = remaining.find((e) =>
      journalTab === "gratitude" ? isGratitudeEntry(e) : !isGratitudeEntry(e),
    )?.id ?? remaining[0]?.id ?? null;
    if (!nextId) {
      const stub =
        journalTab === "gratitude" ? newGratitudeJournalEntry() : newJournalEntry();
      nextEntries = [stub, ...remaining];
      nextId = stub.id;
    }
    entriesRef.current = nextEntries;
    setEntries(nextEntries);
    setActiveEntryId(nextId);
    const next = nextEntries.find((e) => e.id === nextId);
    latestHtmlRef.current = next?.contentHtml ?? "<p></p>";
    latestTitleRef.current = next?.title ?? "";
    latestGratitudeRef.current = next?.gratitude ?? emptyGratitudeLines();
    setGratitudeDraft(latestGratitudeRef.current);
    persist(nextEntries, nextId);
    setMobileEntryMenuOpen(false);
    if (journalTab === "journal" && journalEntryIdFromPath(pathname)) {
      router.push(JOURNAL_SECTION_HREF.journal);
    } else if (
      journalTab === "gratitude" &&
      gratitudeEntryIdFromPath(pathname)
    ) {
      router.push(JOURNAL_SECTION_HREF.gratitude);
    }
  }, [journalTab, persist, pathname, router]);

  const applyEntrySelection = useCallback(
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

  const selectEntry = useCallback(
    (nextId: string) => {
      applyEntrySelection(nextId);
      const entry = entriesRef.current.find((e) => e.id === nextId);
      if (!entry) return;
      if (journalTab === "journal") {
        if (isGratitudeEntry(entry)) return;
        if (journalEntryIdFromPath(pathname) === nextId) return;
        router.push(`/journal/my/${encodeURIComponent(nextId)}`);
        return;
      }
      if (journalTab === "gratitude") {
        if (!isGratitudeEntry(entry)) return;
        if (gratitudeEntryIdFromPath(pathname) === nextId) return;
        router.push(
          `/journal/my/gratitudes/${encodeURIComponent(nextId)}`,
        );
      }
    },
    [applyEntrySelection, journalTab, pathname, router],
  );

  /** Deep-link / browser back: sync active entry from `/journal/:id`. */
  useEffect(() => {
    if (!hydrated || section !== "journal") return;
    if (!routeEntryId) return;
    const found = entriesRef.current.find(
      (e) => e.id === routeEntryId && !isGratitudeEntry(e),
    );
    if (!found) {
      router.replace(JOURNAL_SECTION_HREF.journal);
      return;
    }
    if (activeIdRef.current !== routeEntryId) {
      applyEntrySelection(routeEntryId);
    }
  }, [hydrated, section, routeEntryId, entries, applyEntrySelection, router]);

  /** Deep-link / browser back: sync from `/journal/my/gratitudes/:id`. */
  useEffect(() => {
    if (!hydrated || section !== "gratitude") return;
    if (!routeGratitudeId) return;
    const found = entriesRef.current.find(
      (e) => e.id === routeGratitudeId && isGratitudeEntry(e),
    );
    if (!found) {
      router.replace(JOURNAL_SECTION_HREF.gratitude);
      return;
    }
    if (activeIdRef.current !== routeGratitudeId) {
      applyEntrySelection(routeGratitudeId);
    }
  }, [
    hydrated,
    section,
    routeGratitudeId,
    entries,
    applyEntrySelection,
    router,
  ]);

  const openJournalList = useCallback(() => {
    flushSaveSync();
    setMobileEntryMenuOpen(false);
    router.push(JOURNAL_SECTION_HREF.journal);
  }, [flushSaveSync, router]);

  const openGratitudesList = useCallback(() => {
    flushSaveSync();
    setMobileEntryMenuOpen(false);
    router.push(JOURNAL_SECTION_HREF.gratitude);
  }, [flushSaveSync, router]);

  const moveActiveToFolder = useCallback(
    (folderId: string) => {
      setMobileEntryMenuOpen(false);
      if (folderId) {
        patchActive({ folderId });
      } else {
        patchActive({ folderId: undefined });
      }
    },
    [patchActive],
  );

  const applyJumpDate = useCallback(
    (value: string) => {
      setJumpDate(value);
      if (value) setSidebarMenu(null);
      if (!value) return;
      const match = tabEntries.find((e) => {
        if (localDateKeyFromIso(e.createdAt) !== value) return false;
        if (
          journalTab === "journal" &&
          selectedFolderId &&
          e.folderId !== selectedFolderId
        ) {
          return false;
        }
        return true;
      });
      if (match) selectEntry(match.id);
    },
    [journalTab, selectEntry, selectedFolderId, tabEntries],
  );

  const clearJumpDate = useCallback(() => {
    setJumpDate("");
    setSidebarMenu(null);
  }, []);

  const createEntry = useCallback(() => {
    flushSaveSync();
    const e = newJournalEntry(
      selectedFolderId ? { folderId: selectedFolderId } : undefined,
    );
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
    router.push(`/journal/my/${encodeURIComponent(e.id)}`);
  }, [flushSaveSync, persist, selectedFolderId, router]);

  const commitImport = useCallback(
    (rows: JournalImportPreviewRow[], batchId: string) => {
      flushSaveSync();
      const imported = previewRowsToEntries(rows, batchId).map((e) =>
        selectedFolderId ? { ...e, folderId: selectedFolderId } : e,
      );
      if (!imported.length) return;
      const next = mergeImportedEntries(entriesRef.current, imported);
      entriesRef.current = next;
      setEntries(next);
      const first = imported[0];
      setActiveEntryId(first.id);
      latestHtmlRef.current = first.contentHtml;
      latestTitleRef.current = first.title;
      latestGratitudeRef.current = emptyGratitudeLines();
      setGratitudeDraft(emptyGratitudeLines());
      persist(next, first.id);
      setImportBatchId(batchId);
      setImportOpen(false);
      router.push(`/journal/my/${encodeURIComponent(first.id)}`);
      if (getMedimadeSessionJwt()) {
        void runJournalInsightsRemote().catch(() => {
          /* insights can catch up later */
        });
      }
    },
    [flushSaveSync, persist, selectedFolderId, router],
  );

  const addNamedFolder = useCallback(() => {
    const folder = newJournalFolder(newFolderName);
    if (!folder) return;
    const nextFolders = [...foldersRef.current, folder];
    foldersRef.current = nextFolders;
    setFolders(nextFolders);
    setSelectedFolderId(folder.id);
    setNamingFolder(false);
    setNewFolderName("");
    persist(entriesRef.current, activeIdRef.current, nextFolders);
    setSidebarMenu(null);
  }, [newFolderName, persist]);

  const onFolderSelect = useCallback(
    (value: string) => {
      setNamingFolder(false);
      setSelectedFolderId(value);
      setSidebarMenu(null);
      if (!value) return;
      const inFolder = entriesRef.current.filter(
        (e) => !isGratitudeEntry(e) && e.folderId === value,
      );
      const current = activeIdRef.current;
      if (current && inFolder.some((e) => e.id === current)) return;
      if (!inFolder[0]) return;
      // On the mobile list route, keep the list visible; only sync selection.
      if (section === "journal" && !journalEntryIdFromPath(pathname)) {
        applyEntrySelection(inFolder[0].id);
        return;
      }
      selectEntry(inFolder[0].id);
    },
    [applyEntrySelection, pathname, section, selectEntry],
  );

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
      return existing.id;
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
    return e.id;
  }, [flushSaveSync, persist]);

  const openTodayGratitudeCompose = useCallback(() => {
    const id = openTodayGratitude();
    if (!id) return;
    if (gratitudeEntryIdFromPath(pathname) === id) return;
    router.push(`/journal/my/gratitudes/${encodeURIComponent(id)}`);
  }, [openTodayGratitude, pathname, router]);

  const activateJournalList = useCallback(() => {
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
  }, [createEntry]);

  const prevListSectionRef = useRef<JournalMainTab | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (section !== "journal" && section !== "gratitude") return;
    const prev = prevListSectionRef.current;
    prevListSectionRef.current = section;
    if (prev === null) {
      if (section === "gratitude" && !gratitudeEntryIdFromPath(pathname)) {
        openTodayGratitude();
      }
      return;
    }
    if (prev === section) return;
    if (section === "gratitude") {
      if (!gratitudeEntryIdFromPath(pathname)) openTodayGratitude();
      return;
    }
    activateJournalList();
  }, [hydrated, section, pathname, openTodayGratitude, activateJournalList]);

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
    <JournalLockGate>
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden px-4 pt-2 pb-6 sm:px-6 sm:py-6">
      <div
        className={`mb-6 shrink-0 ${mobileComposeChrome ? "max-sm:hidden" : ""}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="font-display text-3xl font-medium tracking-tight">
            Journal
          </h1>
          <div
            className="inline-flex max-w-full flex-wrap rounded-xl border border-border bg-background p-1"
            role="tablist"
            aria-label="Journal section"
          >
            <Link
              href={JOURNAL_SECTION_HREF.journal}
              role="tab"
              aria-selected={section === "journal"}
              onClick={() => flushSaveSync()}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                section === "journal"
                  ? "bg-selected text-on-selected"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Journal
            </Link>
            <Link
              href={JOURNAL_SECTION_HREF.gratitude}
              role="tab"
              aria-selected={section === "gratitude"}
              onClick={() => flushSaveSync()}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                section === "gratitude"
                  ? "bg-selected text-on-selected"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Gratitudes
            </Link>
            <Link
              href={JOURNAL_SECTION_HREF.insights}
              role="tab"
              aria-selected={section === "insights"}
              onClick={() => flushSaveSync()}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                section === "insights"
                  ? "bg-selected text-on-selected"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Insights
            </Link>
          </div>
        </div>
        {streakDays > 0 ? (
          <p className="mt-2 text-sm text-foreground/80">
            {streakDays === 1
              ? "You wrote yesterday or today — come back when it feels right."
              : `${streakDays} days in a row with a page. Gentle streak, not a score.`}
          </p>
        ) : null}
        {importBatchId ? (
          <p className="mt-2 text-sm text-muted">
            Showing just-imported pages.{" "}
            <button
              type="button"
              className="cursor-pointer font-medium text-accent-link underline-offset-2 hover:underline"
              onClick={() => setImportBatchId(null)}
            >
              Show all
            </button>
          </p>
        ) : null}
      </div>

      {mobileJournalEditor ? (
        <div className="mb-3 flex shrink-0 items-center justify-between gap-2 sm:hidden">
          <button
            type="button"
            onClick={openJournalList}
            className="inline-flex cursor-pointer items-center gap-0.5 text-sm font-semibold text-accent-link"
            aria-label="Back to Journal list"
          >
            <ChevronLeft aria-hidden className="size-5" strokeWidth={2} />
            Journal
          </button>
          <div ref={mobileEntryMenuRef} className="relative">
            <button
              type="button"
              aria-label="Entry actions"
              aria-haspopup="menu"
              aria-expanded={mobileEntryMenuOpen}
              onClick={() => setMobileEntryMenuOpen((v) => !v)}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-accent-soft/50 hover:text-foreground"
            >
              <IconEntryMore />
            </button>
            {mobileEntryMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-30 mt-1 min-w-[11rem] rounded-xl border border-border bg-card py-1 shadow-lg"
              >
                {folders.length > 0 ? (
                  <>
                    <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Move to folder
                    </p>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => moveActiveToFolder("")}
                      className={`block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-accent-soft/30 ${
                        !activeEntry?.folderId
                          ? "font-semibold text-foreground"
                          : "text-muted"
                      }`}
                    >
                      No folder
                    </button>
                    {folders.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        role="menuitem"
                        onClick={() => moveActiveToFolder(f.id)}
                        className={`block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-accent-soft/30 ${
                          activeEntry?.folderId === f.id
                            ? "font-semibold text-foreground"
                            : "text-muted"
                        }`}
                      >
                        {f.name}
                      </button>
                    ))}
                    <div className="my-1 border-t border-border" />
                  </>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMobileEntryMenuOpen(false);
                    deleteActive();
                  }}
                  className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft/40"
                >
                  Delete entry
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {mobileGratitudeCompose ? (
        <div className="mb-3 flex shrink-0 items-center justify-between gap-2 sm:hidden">
          <button
            type="button"
            onClick={openGratitudesList}
            className="inline-flex cursor-pointer items-center gap-0.5 text-sm font-semibold text-accent-link"
            aria-label="Back to Gratitudes list"
          >
            <ChevronLeft aria-hidden className="size-5" strokeWidth={2} />
            Gratitudes
          </button>
          <div ref={mobileEntryMenuRef} className="relative">
            <button
              type="button"
              aria-label="Day actions"
              aria-haspopup="menu"
              aria-expanded={mobileEntryMenuOpen}
              onClick={() => setMobileEntryMenuOpen((v) => !v)}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-accent-soft/50 hover:text-foreground"
            >
              <IconEntryMore />
            </button>
            {mobileEntryMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-30 mt-1 min-w-[9rem] rounded-xl border border-border bg-card py-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMobileEntryMenuOpen(false);
                    deleteActive();
                  }}
                  className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft/40"
                >
                  Delete day
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {insightsMounted ? (
        <div
          className={
            insightsOpen
              ? "flex min-h-0 flex-1 flex-col"
              : "hidden"
          }
          aria-hidden={!insightsOpen}
        >
          <JournalInsightsView />
        </div>
      ) : null}
      {!insightsOpen ? (
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden lg:flex-row lg:gap-4">
        <aside
          className={`flex shrink-0 flex-col gap-3 overflow-visible border-b border-border pb-4 lg:max-h-none lg:w-64 lg:border-b-0 lg:pb-0 ${
            journalTab === "journal" || journalTab === "gratitude"
              ? "max-h-[22rem] max-sm:max-h-none max-sm:min-h-0 max-sm:flex-1 max-sm:border-b-0 max-sm:pb-0 sm:max-h-[22rem] lg:max-h-none"
              : "max-h-[22rem]"
          } ${mobileComposeChrome ? "max-sm:hidden" : ""}`}
        >
          {journalTab === "journal" ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={createEntry}
                className="cursor-pointer rounded-xl accent-fill-gradient px-3 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
              >
                + New entry
              </button>
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1">
                  <SearchInput
                    className="w-full"
                    inputClassName="py-2"
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search entries"
                  />
                </div>
                {/* Mobile: folder + date in one control */}
                <div ref={filtersMenuRef} className="relative shrink-0 sm:hidden">
                  <button
                    type="button"
                    aria-label="Folder and date filters"
                    aria-haspopup="menu"
                    aria-expanded={sidebarMenu === "filters"}
                    onClick={() => {
                      setSidebarMenu((m) =>
                        m === "filters" ? null : "filters",
                      );
                      setNamingFolder(false);
                    }}
                    className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border transition-colors ${
                      selectedFolderId || jumpDate
                        ? "border-accent/40 bg-accent-soft/40 text-foreground"
                        : "border-border bg-background text-muted hover:border-accent/40 hover:text-foreground"
                    }`}
                  >
                    <Folder aria-hidden className="size-4" strokeWidth={2} />
                  </button>
                  {sidebarMenu === "filters" ? (
                    <div
                      role="menu"
                      className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-border bg-card py-1 shadow-lg"
                    >
                      <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Folder
                      </p>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => onFolderSelect(FOLDER_ALL)}
                        className={`block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-accent-soft/30 ${
                          !selectedFolderId
                            ? "font-semibold text-foreground"
                            : "text-muted"
                        }`}
                      >
                        All entries
                      </button>
                      {folders.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          role="menuitem"
                          onClick={() => onFolderSelect(f.id)}
                          className={`block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-accent-soft/30 ${
                            selectedFolderId === f.id
                              ? "font-semibold text-foreground"
                              : "text-muted"
                          }`}
                        >
                          {f.name}
                        </button>
                      ))}
                      <div className="border-t border-border px-2 py-1.5">
                        {namingFolder ? (
                          <div className="flex gap-1.5">
                            <input
                              type="text"
                              value={newFolderName}
                              onChange={(e) => setNewFolderName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  addNamedFolder();
                                }
                              }}
                              placeholder="Folder name"
                              autoFocus
                              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent/50"
                            />
                            <button
                              type="button"
                              onClick={addNamedFolder}
                              disabled={!newFolderName.trim()}
                              className="cursor-pointer rounded-lg accent-fill-gradient px-2 py-1 text-xs font-semibold text-on-accent disabled:opacity-50"
                            >
                              Add
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setNamingFolder(true);
                              setNewFolderName("");
                            }}
                            className="block w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-sm text-muted hover:bg-accent-soft/30 hover:text-foreground"
                          >
                            + New folder
                          </button>
                        )}
                      </div>
                      <div className="border-t border-border px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                          Jump to day
                        </p>
                        <input
                          type="date"
                          value={jumpDate}
                          onChange={(ev) => applyJumpDate(ev.target.value)}
                          className="mt-1.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent/50"
                        />
                        {jumpDate ? (
                          <button
                            type="button"
                            className="mt-1.5 cursor-pointer text-xs font-medium text-accent-link underline-offset-2 hover:underline"
                            onClick={clearJumpDate}
                          >
                            Clear date
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
                {/* sm+: separate folder + date + settings */}
                <div className="hidden items-center gap-1.5 sm:flex">
                <div ref={folderMenuRef} className="relative shrink-0">
                  <button
                    type="button"
                    aria-label="Filter by folder"
                    aria-haspopup="menu"
                    aria-expanded={sidebarMenu === "folder"}
                    onClick={() => {
                      setSidebarMenu((m) => (m === "folder" ? null : "folder"));
                      setNamingFolder(false);
                    }}
                    className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border transition-colors ${
                      selectedFolderId
                        ? "border-accent/40 bg-accent-soft/40 text-foreground"
                        : "border-border bg-background text-muted hover:border-accent/40 hover:text-foreground"
                    }`}
                  >
                    <Folder aria-hidden className="size-4" strokeWidth={2} />
                  </button>
                  {sidebarMenu === "folder" ? (
                    <div
                      role="menu"
                      className="absolute left-0 z-30 mt-1 w-52 rounded-xl border border-border bg-card py-1 shadow-lg"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => onFolderSelect(FOLDER_ALL)}
                        className={`block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-accent-soft/30 ${
                          !selectedFolderId
                            ? "font-semibold text-foreground"
                            : "text-muted"
                        }`}
                      >
                        All entries
                      </button>
                      {folders.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          role="menuitem"
                          onClick={() => onFolderSelect(f.id)}
                          className={`block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-accent-soft/30 ${
                            selectedFolderId === f.id
                              ? "font-semibold text-foreground"
                              : "text-muted"
                          }`}
                        >
                          {f.name}
                        </button>
                      ))}
                      <div className="border-t border-border px-2 py-1.5">
                        {namingFolder ? (
                          <div className="flex gap-1.5">
                            <input
                              type="text"
                              value={newFolderName}
                              onChange={(e) => setNewFolderName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  addNamedFolder();
                                }
                              }}
                              placeholder="Folder name"
                              autoFocus
                              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent/50"
                            />
                            <button
                              type="button"
                              onClick={addNamedFolder}
                              disabled={!newFolderName.trim()}
                              className="cursor-pointer rounded-lg accent-fill-gradient px-2 py-1 text-xs font-semibold text-on-accent disabled:opacity-50"
                            >
                              Add
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setNamingFolder(true);
                              setNewFolderName("");
                            }}
                            className="block w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-sm text-muted hover:bg-accent-soft/30 hover:text-foreground"
                          >
                            + New folder
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div ref={dateMenuRef} className="relative shrink-0">
                  <button
                    type="button"
                    title="Jump to a specific day."
                    aria-label="Jump to a specific day."
                    aria-haspopup="dialog"
                    aria-expanded={sidebarMenu === "date"}
                    onClick={() =>
                      setSidebarMenu((m) => (m === "date" ? null : "date"))
                    }
                    className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border transition-colors ${
                      jumpDate
                        ? "border-accent/40 bg-accent-soft/40 text-foreground"
                        : "border-border bg-background text-muted hover:border-accent/40 hover:text-foreground"
                    }`}
                  >
                    <Calendar aria-hidden className="size-4" strokeWidth={2} />
                  </button>
                  {sidebarMenu === "date" ? (
                    <JumpToDayPopover
                      jumpDate={jumpDate}
                      onPick={applyJumpDate}
                      onClear={clearJumpDate}
                    />
                  ) : null}
                </div>
                <JournalSettingsIconButton onClick={() => setSettingsOpen(true)} />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-xs text-muted">
                  {folderFilterLabel}
                  {jumpDate
                    ? ` · ${formatJournalEntryDate(`${jumpDate}T12:00:00`)}`
                    : ""}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="sm:hidden">
                    <JournalSettingsIconButton
                      onClick={() => setSettingsOpen(true)}
                    />
                  </span>
                  <button
                    type="button"
                    onClick={() => setImportOpen(true)}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs font-medium text-accent-link underline-offset-2 hover:underline"
                  >
                    <Import aria-hidden className="size-3.5" strokeWidth={2} />
                    Import
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={openTodayGratitudeCompose}
                className="cursor-pointer rounded-xl accent-fill-gradient px-3 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
              >
                + Add a gratitude for today
              </button>
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1">
                  <SearchInput
                    className="w-full"
                    inputClassName="py-2"
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search entries"
                  />
                </div>
                {/* Mobile: date + settings consolidated row companion */}
                <div ref={filtersMenuRef} className="relative shrink-0 sm:hidden">
                  <button
                    type="button"
                    aria-label="Jump to a specific day"
                    aria-haspopup="dialog"
                    aria-expanded={sidebarMenu === "filters"}
                    onClick={() =>
                      setSidebarMenu((m) =>
                        m === "filters" ? null : "filters",
                      )
                    }
                    className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border transition-colors ${
                      jumpDate
                        ? "border-accent/40 bg-accent-soft/40 text-foreground"
                        : "border-border bg-background text-muted hover:border-accent/40 hover:text-foreground"
                    }`}
                  >
                    <Calendar aria-hidden className="size-4" strokeWidth={2} />
                  </button>
                  {sidebarMenu === "filters" ? (
                    <div
                      className="absolute right-0 z-30 mt-1 w-52 rounded-xl border border-border bg-card p-2 shadow-lg"
                      role="dialog"
                      aria-label="Jump to a day"
                    >
                      <p className="text-sm font-medium text-foreground">
                        Jump to a day
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        Pick a date to see the entry from that day.
                      </p>
                      <input
                        type="date"
                        value={jumpDate}
                        onChange={(ev) => applyJumpDate(ev.target.value)}
                        className="mt-2 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent/50"
                      />
                      {jumpDate ? (
                        <button
                          type="button"
                          className="mt-1.5 cursor-pointer text-xs font-medium text-accent-link underline-offset-2 hover:underline"
                          onClick={clearJumpDate}
                        >
                          Clear date
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <span className="sm:hidden">
                  <JournalSettingsIconButton
                    onClick={() => setSettingsOpen(true)}
                  />
                </span>
              </div>
              <p className="text-sm font-semibold text-foreground">Past days</p>
              <div className="hidden items-center gap-1.5 sm:flex">
                <div ref={dateMenuRef} className="relative shrink-0">
                  <button
                    type="button"
                    title="Jump to a specific day."
                    aria-label="Jump to a specific day."
                    aria-haspopup="dialog"
                    aria-expanded={sidebarMenu === "date"}
                    onClick={() =>
                      setSidebarMenu((m) => (m === "date" ? null : "date"))
                    }
                    className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border transition-colors ${
                      jumpDate
                        ? "border-accent/40 bg-accent-soft/40 text-foreground"
                        : "border-border bg-background text-muted hover:border-accent/40 hover:text-foreground"
                    }`}
                  >
                    <Calendar aria-hidden className="size-4" strokeWidth={2} />
                  </button>
                  {sidebarMenu === "date" ? (
                    <JumpToDayPopover
                      jumpDate={jumpDate}
                      onPick={applyJumpDate}
                      onClear={clearJumpDate}
                    />
                  ) : null}
                </div>
                <JournalSettingsIconButton onClick={() => setSettingsOpen(true)} />
              </div>
            </>
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
                {jumpDate && !searchQuery.trim()
                  ? "No entry on this day."
                  : searchQuery.trim() || jumpDate
                    ? "No entries match."
                    : journalTab === "gratitude"
                    ? "No gratitudes yet."
                    : selectedFolderId
                      ? "This folder is empty."
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
                        ? "text-faint"
                        : "text-muted";
                      return (
                        <li key={e.id}>
                          <button
                            type="button"
                            onClick={() => selectEntry(e.id)}
                            className={`w-full cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-colors ${
                              isActive
                                ? "border-border border-l-[3px] border-l-accent bg-card text-foreground shadow-sm"
                                : "border-border bg-background text-foreground hover:border-accent/40"
                            }`}
                          >
                            <span className="line-clamp-2 text-sm font-semibold">
                              {sidebarEntryTitle(e.title)}
                            </span>
                            <span className="mt-0.5 line-clamp-2 text-xs text-muted">
                              {entryPreview(e)}
                            </span>
                            <div
                              className={`mt-2 border-t pt-2 text-[10px] leading-snug ${isActive ? "border-border-subtle" : "border-border"} ${metaMuted}`}
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

        <section
          className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
            (journalTab === "journal" && !mobileJournalEditor) ||
            (journalTab === "gratitude" && !mobileGratitudeCompose)
              ? "max-sm:hidden"
              : ""
          }`}
        >
          {jumpDate && filteredTabEntries.length === 0 ? (
            <div className="flex min-h-[12rem] flex-1 items-center rounded-2xl border border-border bg-card p-6 shadow-sm">
              <p className="text-sm text-muted">No entry on this day.</p>
            </div>
          ) : showGratitudeEditor && activeEntry ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
              <JournalGratitudeEditor
                createdAt={activeEntry.createdAt}
                lines={gratitudeDraft}
                onChange={onGratitudeChange}
              >
                <JournalEntryMeta
                  mood={activeEntry.mood}
                  tags={activeEntry.tags}
                  onMoodChange={(mood) => patchActive({ mood })}
                  onTagsChange={(tags) => patchActive({ tags })}
                />
              </JournalGratitudeEditor>
              <div
                className={`shrink-0 flex-wrap items-center gap-3 ${
                  mobileGratitudeCompose ? "hidden sm:flex" : "flex"
                }`}
              >
                <p className="text-sm text-muted">
                  Autosaves in this browser. Come back tomorrow for a fresh page;
                  today’s three stay here.
                </p>
                <button
                  type="button"
                  onClick={deleteActive}
                  className="cursor-pointer text-xs font-medium text-muted underline-offset-2 hover:text-danger hover:underline"
                >
                  Delete day
                </button>
              </div>
            </div>
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
                entryMenuClassName={
                  mobileJournalEditor ? "max-sm:hidden" : undefined
                }
                onHtmlChange={(html) => {
                  latestHtmlRef.current = html;
                  scheduleSave();
                }}
                onTitleChange={(title) => {
                  latestTitleRef.current = title;
                  scheduleSave();
                }}
                onDelete={deleteActive}
              >
                <JournalEntryMeta
                  mood={activeEntry.mood}
                  tags={activeEntry.tags}
                  onMoodChange={(mood) => patchActive({ mood })}
                  onTagsChange={(tags) => patchActive({ tags })}
                />
              </JournalRichEditor>
            </>
          ) : (
            <div className="min-h-[12rem] rounded-2xl border border-border bg-card shadow-sm" />
          )}
        </section>
      </div>
      ) : null}
    </div>
    <JournalSettingsDialog
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      entries={entries}
      store={{
        version: 2,
        activeEntryId,
        entries,
        ...(folders.length ? { folders } : {}),
      }}
    />
    <JournalImportDialog
      open={importOpen}
      existing={entries}
      onClose={() => setImportOpen(false)}
      onCommit={commitImport}
    />
    </JournalLockGate>
  );
}
