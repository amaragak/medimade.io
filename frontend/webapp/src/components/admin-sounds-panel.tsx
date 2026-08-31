"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchInput } from "@/components/search-input";
import { SoundTrimWaveform } from "@/components/sound-trim-waveform";
import { playWithLeadBuffer } from "@/lib/audio-lead-buffer";
import {
  type AdminSoundCategory,
  type AdminSoundItem,
  type AdminSoundProcessingStage,
  createAdminSoundUploads,
  reprocessAdminSound,
  uploadAdminSoundToS3,
  suggestAdminSoundCategories,
  analyseAdminSoundTitles,
  getMedimadeMediaBaseUrl,
  listAdminSounds,
  patchAdminSound,
  trimAdminSound,
} from "@/lib/medimade-api";
import {
  SOUND_CATEGORIES,
  categoryLabel,
  coerceSoundSubcategory,
  hasFreeformSubcategories,
  prettySubcategoryLabel,
  soundSubcategorySlug,
  subcategoryOptions,
} from "@/lib/sound-taxonomy";

type UseFilter =
  | "every"
  | "all"
  | "in"
  | "pending"
  | "skip"
  | "categorised"
  | "loop_verified";

function mixerEnabled(status: AdminSoundItem["status"]): boolean {
  return status === "categorised" || status === "loop_verified";
}

function statusMatchesFilter(status: AdminSoundItem["status"], filter: UseFilter): boolean {
  if (filter === "every") return true;
  if (filter === "skip") return status === "unused";
  if (filter === "in") return status === "in_use";
  if (filter === "pending") return status === "pending";
  if (filter === "categorised") return status === "categorised";
  if (filter === "loop_verified") return status === "loop_verified";
  return status === "in_use" || status === "pending";
}

function isStatusReviewFilter(filter: UseFilter): boolean {
  return filter === "pending" || filter === "in";
}

/** How long a local edit outranks whatever a refresh returns. */
const PENDING_EDIT_TTL_MS = 30000;

type ImportRowStatus = "queued" | "preparing" | "uploading" | "done" | "skipped" | "failed" | "aborted";

type ImportRow = {
  path: string;
  status: ImportRowStatus;
  detail?: string;
  size: number;
  loaded: number;
};

function importStatusLabel(status: ImportRowStatus): string {
  if (status === "queued") return "Queued";
  if (status === "preparing") return "Preparing";
  if (status === "uploading") return "Uploading";
  if (status === "done") return "Uploaded";
  if (status === "skipped") return "Already on S3";
  if (status === "aborted") return "Stopped";
  return "Failed";
}

function importStatusClass(status: ImportRowStatus): string {
  if (status === "uploading") return "text-info";
  if (status === "preparing") return "text-accent-link";
  if (status === "done") return "text-success";
  if (status === "failed") return "text-danger";
  if (status === "aborted") return "text-accent-link";
  return "text-muted";
}

function mediaUrl(baseUrl: string | undefined, key: string, bust?: string | null): string {
  const root = (baseUrl ?? getMedimadeMediaBaseUrl() ?? "").replace(/\/$/, "");
  const path = key.replace(/^\//, "");
  const url = root ? `${root}/${path}` : `/${path}`;
  if (!bust) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(bust)}`;
}

function streamingPlayKey(key: string): string {
  const k = key.trim();
  if (k.toLowerCase().endsWith(".wav")) return `${k.slice(0, -4)}.mp3`;
  return k;
}

function formatSize(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatImportedAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M8 5.14v13.72L19 12 8 5.14z" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  );
}

function IconReplay() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 .49-4" />
    </svg>
  );
}

/** How much of the tail to hear before the loop point. */
const LOOP_TEST_LEAD_SEC = 2;

/** Opacity transition plus a little slack, after which the row leaves the list. */
const FADE_OUT_MS = 520;

function IconLoop() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function fileRelativePath(f: File): string {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath?.trim();
  return rel || f.name;
}

/** A file plus the path it should keep on S3, which a drop event has to supply. */
type PickedFile = { file: File; path: string };

function pickedFromList(files: FileList | null): PickedFile[] {
  return [...(files ?? [])].map((file) => ({ file, path: fileRelativePath(file) }));
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

/** Dropped folders arrive as directory entries, so walk them for the files inside. */
async function pickedFromDataTransfer(dt: DataTransfer): Promise<PickedFile[]> {
  const roots = [...dt.items]
    .map((it) => (it.kind === "file" ? it.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);
  if (roots.length === 0) return pickedFromList(dt.files);

  const out: PickedFile[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await entryFile(entry as FileSystemFileEntry);
      out.push({ file, path: `${prefix}${file.name}` });
      return;
    }
    if (!entry.isDirectory) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries hands back at most 100 at a time and signals the end with [].
    for (;;) {
      const batch = await readEntries(reader);
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
    }
  };
  for (const root of roots) await walk(root, "");
  return out;
}

export function AdminSoundsPanel() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [baseUrl, setBaseUrl] = useState<string | undefined>();
  const [items, setItems] = useState<AdminSoundItem[]>([]);
  const [counts, setCounts] = useState({
    total: 0,
    inUse: 0,
    pending: 0,
    unused: 0,
    categorised: 0,
    loopVerified: 0,
    inCatalog: 0,
  });
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState<"all" | AdminSoundCategory>("all");
  const [useFilter, setUseFilter] = useState<UseFilter>("in");
  const [subFilter, setSubFilter] = useState("");
  const [sortBy, setSortBy] = useState<"imported-desc" | "imported-asc" | "name">("imported-desc");
  const [fadingKeys, setFadingKeys] = useState<Set<string>>(() => new Set());
  const fadeTimers = useRef<Map<string, number>>(new Map());
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importProgress, setImportProgress] = useState({ loaded: 0, total: 0 });
  const importLoadedRef = useRef<Map<string, number>>(new Map());
  const progressTimerRef = useRef<number | null>(null);
  const [importCategory, setImportCategory] = useState<"" | AdminSoundCategory>("");
  const [importSubcategory, setImportSubcategory] = useState("");
  const [activePlayKey, setActivePlayKey] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const [reviewPlaySeq, setReviewPlaySeq] = useState(0);
  const [analysingTitles, setAnalysingTitles] = useState(false);
  const [reprocessing, setReprocessing] = useState<{ done: number; total: number } | null>(null);
  const [reprocessNote, setReprocessNote] = useState<string | null>(null);
  const [editPopup, setEditPopup] = useState<{
    key: string;
    name: string;
    category: AdminSoundCategory;
    subcategory: string;
  } | null>(null);
  const editNameRef = useRef<HTMLInputElement | null>(null);
  const editPopupRef = useRef(editPopup);
  editPopupRef.current = editPopup;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const filePickRef = useRef<HTMLInputElement | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const el = fileRef.current;
    if (!el) return;
    el.setAttribute("webkitdirectory", "");
    el.setAttribute("directory", "");
  }, []);

  /**
   * A refresh landing right after a status change can return the pre-write row
   * and make the card reappear in the old tab. Local edits win for a short
   * window so a poll cannot undo what was just clicked.
   */
  const pendingEditsRef = useRef<Map<string, { item: AdminSoundItem; at: number }>>(
    new Map(),
  );

  const recordLocalEdit = useCallback((next: AdminSoundItem) => {
    pendingEditsRef.current.set(next.key, { item: next, at: Date.now() });
  }, []);

  const applyPendingEdits = useCallback((incoming: AdminSoundItem[]) => {
    const pending = pendingEditsRef.current;
    if (pending.size === 0) return incoming;
    const now = Date.now();
    for (const [key, entry] of pending) {
      if (now - entry.at > PENDING_EDIT_TTL_MS) pending.delete(key);
    }
    if (pending.size === 0) return incoming;
    return incoming.map((row) => {
      const entry = pending.get(row.key);
      if (!entry) return row;
      // Server has caught up; drop the override so later edits are not masked.
      if (row.status === entry.item.status && row.category === entry.item.category) {
        pending.delete(row.key);
        return row;
      }
      return { ...row, ...entry.item };
    });
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const data = await listAdminSounds();
    setBaseUrl(data.baseUrl);
    setItems(applyPendingEdits(data.items));
    setCounts({
      total: data.counts.total,
      inUse: data.counts.inUse,
      pending: data.counts.pending,
      unused: data.counts.unused,
      categorised: data.counts.categorised ?? 0,
      loopVerified: data.counts.loopVerified ?? 0,
      inCatalog: data.counts.inCatalog ?? data.items.filter((i) => i.inCatalog).length,
    });
  }, [applyPendingEdits]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load sounds");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    const waitingNorm = items.some((i) => !i.ready && i.hasRaw);
    if (!waitingNorm) return;
    const t = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(t);
  }, [items, load]);

  /** Pack folders in use for a category whose folders are named at import time. */
  const freeformSubcategories = useCallback(
    (category: AdminSoundCategory) =>
      [
        ...new Set(
          items
            .filter((it) => it.category === category && it.subcategory)
            .map((it) => it.subcategory as string),
        ),
      ].sort(),
    [items],
  );

  const importSubcategoryChoices = useMemo(
    () =>
      importCategory && hasFreeformSubcategories(importCategory)
        ? freeformSubcategories(importCategory)
        : [],
    [importCategory, freeformSubcategories],
  );

  const subcategories = useMemo(() => {
    const optionsFor = (c: AdminSoundCategory) =>
      hasFreeformSubcategories(c)
        ? freeformSubcategories(c).map((id) => ({ id, label: prettySubcategoryLabel(id) }))
        : subcategoryOptions(c).map((o) => ({ id: o.id, label: o.label }));
    if (catFilter === "all") {
      return SOUND_CATEGORIES.flatMap((c) =>
        optionsFor(c).map((o) => ({ id: o.id, label: `${categoryLabel(c)} · ${o.label}` })),
      );
    }
    return optionsFor(catFilter);
  }, [catFilter, freeformSubcategories]);

  /** Uploads sitting in S3 with no playable output — the ones worth retrying. */
  const stuckCount = useMemo(
    () => items.filter((i) => !i.ready && i.hasRaw).length,
    [items],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const sub = subFilter.trim().toLowerCase();
    const filtered = items.filter((it) => {
      if (catFilter !== "all" && it.category !== catFilter) return false;
      if (fadingKeys.has(it.key)) {
        /* keep on screen while fading out of the active list */
      } else if (!statusMatchesFilter(it.status, useFilter)) {
        return false;
      }
      if (sub) {
        const a = (it.subcategory || "").toLowerCase();
        const b = (it.suggestedSubcategory || "").toLowerCase();
        if (a !== sub && b !== sub) return false;
      }
      if (!needle) return true;
      const hay = `${it.name} ${it.key} ${it.packPath ?? ""} ${it.subcategory} ${it.suggestedSubcategory ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
    const stamp = (it: AdminSoundItem) => {
      const t = Date.parse(it.importedAt || it.updatedAt || "");
      return Number.isFinite(t) ? t : 0;
    };
    return filtered.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      const diff = stamp(a) - stamp(b);
      if (sortBy === "imported-asc") return diff || a.name.localeCompare(b.name);
      return -diff || a.name.localeCompare(b.name);
    });
  }, [items, q, catFilter, useFilter, subFilter, sortBy, fadingKeys]);

  function bumpStatusCounts(from: AdminSoundItem["status"], to: AdminSoundItem["status"]) {
    if (from === to) return;
    setCounts((c) => {
      const next = { ...c };
      if (from === "in_use") next.inUse -= 1;
      else if (from === "pending") next.pending -= 1;
      else if (from === "unused") next.unused -= 1;
      else if (from === "categorised") next.categorised -= 1;
      else if (from === "loop_verified") next.loopVerified -= 1;
      if (to === "in_use") next.inUse += 1;
      else if (to === "pending") next.pending += 1;
      else if (to === "unused") next.unused += 1;
      else if (to === "categorised") next.categorised += 1;
      else if (to === "loop_verified") next.loopVerified += 1;
      return next;
    });
  }

  function beginFadeOut(key: string) {
    const existing = fadeTimers.current.get(key);
    if (existing) window.clearTimeout(existing);
    setFadingKeys((prev) => new Set(prev).add(key));
    const t = window.setTimeout(() => {
      fadeTimers.current.delete(key);
      setFadingKeys((prev) => {
        const n = new Set(prev);
        n.delete(key);
        return n;
      });
    }, FADE_OUT_MS);
    fadeTimers.current.set(key, t);
  }

  function cancelFadeOut(key: string) {
    const existing = fadeTimers.current.get(key);
    if (existing) window.clearTimeout(existing);
    fadeTimers.current.delete(key);
    setFadingKeys((prev) => {
      const n = new Set(prev);
      n.delete(key);
      return n;
    });
  }

  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const reviewModeRef = useRef(reviewMode);
  reviewModeRef.current = reviewMode;
  const reviewKeyRef = useRef(reviewKey);
  reviewKeyRef.current = reviewKey;
  const useFilterRef = useRef(useFilter);
  useFilterRef.current = useFilter;

  const applyItemStatus = useCallback(
    (item: AdminSoundItem, status: AdminSoundItem["status"]) => {
      const next: AdminSoundItem = { ...item, status, enabled: mixerEnabled(status) };
      if (item.status !== status) bumpStatusCounts(item.status, status);
      recordLocalEdit(next);
      setItems((list) => list.map((p) => (p.key === item.key ? next : p)));
      if (!statusMatchesFilter(status, useFilterRef.current)) beginFadeOut(item.key);
      else cancelFadeOut(item.key);
      void patchAdminSound({
        key: item.key,
        status,
        category: item.category,
        subcategory: item.subcategory,
        name: item.name,
        notes: item.notes,
      }).catch(() => {
        cancelFadeOut(item.key);
        pendingEditsRef.current.delete(item.key);
        if (item.status !== status) bumpStatusCounts(status, item.status);
        setItems((list) => list.map((p) => (p.key === item.key ? item : p)));
      });
    },
    [recordLocalEdit],
  );

  const applyCategorise = useCallback(
    (
      item: AdminSoundItem,
      fields: { name: string; category: AdminSoundCategory; subcategory: string },
    ) => {
      const status = "categorised" as const;
      const next: AdminSoundItem = {
        ...item,
        ...fields,
        name: fields.name.trim() || item.name,
        status,
        enabled: mixerEnabled(status),
      };
      if (item.status !== status) bumpStatusCounts(item.status, status);
      recordLocalEdit(next);
      setItems((list) => list.map((p) => (p.key === item.key ? next : p)));
      if (!statusMatchesFilter(status, useFilterRef.current)) beginFadeOut(item.key);
      else cancelFadeOut(item.key);
      void patchAdminSound({
        key: item.key,
        status,
        category: next.category,
        subcategory: next.subcategory,
        name: next.name,
        notes: item.notes,
      }).catch(() => {
        cancelFadeOut(item.key);
        pendingEditsRef.current.delete(item.key);
        if (item.status !== status) bumpStatusCounts(status, item.status);
        setItems((list) => list.map((p) => (p.key === item.key ? item : p)));
      });
    },
    [recordLocalEdit],
  );

  const advanceApprovedReview = useCallback((pool: AdminSoundItem[], currentKey: string) => {
    const idx = pool.findIndex((i) => i.key === currentKey);
    const next = idx >= 0 ? pool[idx + 1] ?? null : pool[0] ?? null;
    if (next && next.key !== currentKey) {
      setReviewKey(next.key);
      setReviewPlaySeq((n) => n + 1);
    } else {
      setReviewKey(null);
    }
  }, []);

  useEffect(() => {
    if (!editPopup) return;
    const t = window.setTimeout(() => editNameRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [editPopup]);

  useEffect(() => {
    if (!isStatusReviewFilter(useFilter)) {
      setReviewMode(false);
      setReviewKey(null);
      setEditPopup(null);
    }
  }, [useFilter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editPopupRef.current) return;
      if (!reviewModeRef.current || !isStatusReviewFilter(useFilterRef.current)) return;
      if (!e.metaKey && !e.ctrlKey) return;
      const filter = useFilterRef.current;
      const pendingDecide =
        filter === "pending" && (e.key === "ArrowLeft" || e.key === "ArrowRight")
          ? e.key === "ArrowLeft"
            ? "unused"
            : "in_use"
          : null;
      const approvedLeft = filter === "in" && e.key === "ArrowLeft";
      const approvedRight = filter === "in" && e.key === "ArrowRight";
      const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : pendingDecide ? 1 : 0;
      if (!pendingDecide && !approvedLeft && !approvedRight && step === 0) return;
      e.preventDefault();

      function act() {
        const pool = visibleRef.current.filter((i) =>
          filter === "pending" ? i.status === "pending" : i.status === "in_use",
        );
        if (pool.length === 0) return;
        const currentKey = reviewKeyRef.current;
        const current = pool.find((i) => i.key === currentKey) ?? pool[0];
        if (!current) return;
        const idx = pool.findIndex((i) => i.key === current.key);
        if (pendingDecide) {
          const next = pool[idx + 1] ?? null;
          applyItemStatus(current, pendingDecide);
          if (next) {
            setReviewKey(next.key);
            setReviewPlaySeq((n) => n + 1);
          } else {
            setReviewKey(null);
          }
          return;
        }
        if (approvedRight) {
          applyCategorise(current, {
            name: current.name,
            category: current.category,
            subcategory: current.subcategory,
          });
          advanceApprovedReview(pool, current.key);
          return;
        }
        if (approvedLeft) {
          setReviewKey(current.key);
          setEditPopup({
            key: current.key,
            name: current.name,
            category: current.category,
            subcategory: hasFreeformSubcategories(current.category)
              ? prettySubcategoryLabel(current.subcategory)
              : current.subcategory,
          });
          return;
        }
        const nextIdx = Math.min(pool.length - 1, Math.max(0, idx + step));
        const next = pool[nextIdx];
        if (!next || next.key === current.key) return;
        setReviewKey(next.key);
        setReviewPlaySeq((n) => n + 1);
      }

      // Shortcuts stay live while renaming. Blur first so the title's save on
      // blur runs, and let it render before the shortcut reads the row back —
      // otherwise approving would write the old name.
      const t = e.target;
      const editing =
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);
      if (editing) {
        (t as HTMLElement).blur();
        window.requestAnimationFrame(act);
        return;
      }
      act();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyItemStatus, applyCategorise, advanceApprovedReview]);

  useEffect(
    () => () => {
      if (progressTimerRef.current != null) window.clearInterval(progressTimerRef.current);
    },
    [],
  );

  async function onImportFiles(picked: PickedFile[]) {
    if (picked.length === 0) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const signal = ac.signal;
    setImporting(true);
    setImportNote(null);
    setError(null);
    const markLeftovers = (detail: string) => {
      setImportRows((prev) =>
        prev.map((r) =>
          r.status === "queued" || r.status === "preparing" || r.status === "uploading"
            ? { ...r, status: "aborted" as const, detail }
            : r,
        ),
      );
    };
    try {
      const list = picked.filter((p) => /\.(mp3|wav)$/i.test(p.file.name));
      if (list.length === 0) throw new Error("Nothing to import: no .mp3 or .wav files in that pick");
      const byPath = new Map(list.map((p) => [p.path, p.file]));
      const rows: ImportRow[] = list.map((p) => ({
        path: p.path,
        status: "queued",
        size: p.file.size,
        loaded: 0,
      }));
      setImportRows(rows);
      const patchRow = (path: string, next: Partial<ImportRow>) => {
        setImportRows((prev) => prev.map((r) => (r.path === path ? { ...r, ...next } : r)));
      };
      // Progress lands far too often to drive React directly, so it is buffered
      // in a ref and flushed on a timer.
      importLoadedRef.current = new Map();
      setImportProgress({ loaded: 0, total: list.reduce((sum, p) => sum + p.file.size, 0) });
      const flushProgress = () => {
        const sent = importLoadedRef.current;
        let sum = 0;
        for (const v of sent.values()) sum += v;
        setImportProgress((p) => (p.loaded === sum ? p : { ...p, loaded: sum }));
        setImportRows((prev) =>
          prev.map((r) => {
            const loaded = sent.get(r.path);
            return loaded == null || loaded === r.loaded ? r : { ...r, loaded };
          }),
        );
      };
      progressTimerRef.current = window.setInterval(flushProgress, 300);
      const failed: string[] = [];
      const uploadedPaths: string[] = [];
      let ok = 0;
      let skippedCount = 0;
      let reprocessedCount = 0;
      const chunkSize = 8;
      const total = list.length;
      for (let i = 0; i < list.length; i += chunkSize) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        const slice = list.slice(i, i + chunkSize);
        for (const p of slice) patchRow(p.path, { status: "preparing", detail: undefined });
        setImportNote(`Preparing ${i + 1}–${Math.min(i + chunkSize, total)} of ${total}`);
        const {
          uploads,
          skippedCount: skipped,
          skipped: skippedPaths,
          reprocessedCount: requeued,
          reprocessed: requeuedPaths,
        } = await createAdminSoundUploads({
          files: slice.map((p) => ({
            relativePath: p.path,
            contentType:
              p.file.type ||
              (p.file.name.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg"),
            size: p.file.size,
          })),
          ...(importCategory ? { category: importCategory } : {}),
          ...(importCategory && importSubcategory.trim()
            ? { subcategory: soundSubcategorySlug(importSubcategory) }
            : {}),
          signal,
        });
        skippedCount += skipped;
        reprocessedCount += requeued;
        for (const path of skippedPaths) {
          patchRow(path, { status: "skipped" });
        }
        for (const path of requeuedPaths) {
          patchRow(path, { status: "skipped", detail: "already in S3 — reprocessing" });
        }
        const wanted = new Set(slice.map((p) => p.path));
        const returned = new Set([
          ...uploads.map((u) => u.relativePath),
          ...skippedPaths,
          ...requeuedPaths,
        ]);
        for (const path of wanted) {
          if (!returned.has(path)) patchRow(path, { status: "failed", detail: "Not accepted for upload" });
        }
        let cursor = 0;
        const workers = Array.from({ length: Math.min(4, uploads.length) }, async () => {
          while (cursor < uploads.length) {
            if (signal.aborted) throw new DOMException("Aborted", "AbortError");
            const u = uploads[cursor++];
            if (!u) break;
            const file = byPath.get(u.relativePath) ?? byPath.get(u.filename);
            if (!file) {
              failed.push(u.relativePath);
              patchRow(u.relativePath, { status: "failed", detail: "File missing from folder pick" });
              continue;
            }
            patchRow(u.relativePath, { status: "uploading", detail: undefined });
            try {
              await uploadAdminSoundToS3(u, file, signal, (loaded) => {
                importLoadedRef.current.set(u.relativePath, Math.min(loaded, file.size));
              });
              importLoadedRef.current.set(u.relativePath, file.size);
              ok += 1;
              uploadedPaths.push(u.relativePath);
              patchRow(u.relativePath, { status: "done", loaded: file.size });
            } catch (e) {
              if (e instanceof DOMException && e.name === "AbortError") throw e;
              const detail = e instanceof Error ? e.message : "network error";
              failed.push(`${u.relativePath} (${detail})`);
              patchRow(u.relativePath, { status: "failed", detail });
            }
          }
        });
        await Promise.all(workers);
      }
      const parts = [`${ok} file(s) uploaded for normalize`];
      if (reprocessedCount > 0) {
        parts.push(`${reprocessedCount} already in S3 — reprocessing those instead`);
      }
      if (skippedCount > 0) {
        parts.push(`${skippedCount} already done (same Splice filename on S3)`);
      }
      if (failed.length > 0) {
        parts.push(`${failed.length} failed`);
        setError(`Upload failed for ${failed.slice(0, 8).join("; ")}${failed.length > 8 ? "…" : ""}`);
      }
      if (uploadedPaths.length > 0) {
        setImportNote(`${parts.join(". ")}. Classifying uploaded sounds…`);
        try {
          await suggestAdminSoundCategories(uploadedPaths);
        } catch (e) {
          parts.push(
            `category suggest failed (${e instanceof Error ? e.message : "error"})`,
          );
        }
      }
      setImportNote(parts.join(". "));
      await load();
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      markLeftovers(aborted ? "Stopped" : e instanceof Error ? e.message : "Import failed");
      setImportNote(aborted ? "Import stopped. File statuses below are kept." : null);
      if (!aborted) setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      if (progressTimerRef.current != null) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      const sent = importLoadedRef.current;
      let sum = 0;
      for (const v of sent.values()) sum += v;
      setImportProgress((p) => ({ ...p, loaded: sum }));
      setImportRows((prev) =>
        prev.map((r) => {
          const loaded = sent.get(r.path);
          return loaded == null ? r : { ...r, loaded };
        }),
      );
      setImporting(false);
      abortRef.current = null;
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onAnalyseTitles() {
    const keys = items.filter((i) => i.status === "in_use").map((i) => i.key);
    if (keys.length === 0) {
      setError("No uncategorised sounds to analyse.");
      return;
    }
    setAnalysingTitles(true);
    setError(null);
    try {
      const updated = await analyseAdminSoundTitles(keys);
      await load();
      if (updated === 0) setError("No suggestions returned. Try again in a moment.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not analyse titles");
    } finally {
      setAnalysingTitles(false);
    }
  }

  /**
   * Re-triggers normalization for every upload whose raw file is in S3 but has
   * no playable output. Runs a few at a time so one click cannot swamp the
   * encoder fleet.
   */
  async function onReprocessStuck() {
    const stuck = items.filter((i) => !i.ready && i.hasRaw);
    if (stuck.length === 0) {
      setError("Nothing to reprocess — every raw upload already has audio.");
      return;
    }
    setReprocessing({ done: 0, total: stuck.length });
    setError(null);
    let failed = 0;
    try {
      for (let i = 0; i < stuck.length; i += 4) {
        const batch = stuck.slice(i, i + 4);
        await Promise.all(
          batch.map(async (item) => {
            try {
              await reprocessAdminSound(item.key);
            } catch {
              failed += 1;
            }
          }),
        );
        setReprocessing({ done: Math.min(i + batch.length, stuck.length), total: stuck.length });
      }
      const queued = stuck.length - failed;
      await load();
      if (failed > 0) setError(`${failed} of ${stuck.length} could not be queued.`);
      // Normalizing an hour-long composition takes minutes, so the count will
      // not drop on the next refresh; say so instead of looking like a no-op.
      setReprocessNote(
        queued > 0
          ? `Queued ${queued} for normalizing. Each file takes a few minutes — this list refreshes itself.`
          : null,
      );
    } finally {
      setReprocessing(null);
    }
  }

  function submitEditPopup() {
    if (!editPopup) return;
    const item = items.find((i) => i.key === editPopup.key);
    if (!item) {
      setEditPopup(null);
      return;
    }
    const pool = visible.filter((i) => i.status === "in_use");
    applyCategorise(item, {
      name: editPopup.name,
      category: editPopup.category,
      subcategory: hasFreeformSubcategories(editPopup.category)
        ? soundSubcategorySlug(editPopup.subcategory)
        : editPopup.subcategory,
    });
    setEditPopup(null);
    advanceApprovedReview(pool, item.key);
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Listed</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{counts.total}</div>
        </div>
        <button
          type="button"
          onClick={() => setUseFilter("skip")}
          aria-pressed={useFilter === "skip"}
          className={`rounded-2xl border p-4 text-left transition-shadow ${
            useFilter === "skip"
              ? "border-danger ring-2 ring-danger/40"
              : "border-danger/40 hover:border-danger/60"
          } bg-danger-soft dark:border-danger/40 dark:bg-danger-soft`}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-danger">
            Not using
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-danger">
            {counts.unused}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setUseFilter("pending")}
          aria-pressed={useFilter === "pending"}
          className={`rounded-2xl border p-4 text-left transition-shadow ${
            useFilter === "pending"
              ? "border-muted ring-2 ring-muted/50"
              : "border-border hover:border-muted"
          } bg-background dark:border-border dark:bg-background/50`}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Pending
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {counts.pending}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setUseFilter("in")}
          aria-pressed={useFilter === "in"}
          className={`rounded-2xl border p-4 text-left transition-shadow ${
            useFilter === "in"
              ? "border-success ring-2 ring-success/50"
              : "border-success/40 hover:border-success/70"
          } bg-success/10 dark:border-success/40 dark:bg-success/15`}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-success">
            Uncategorised
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-success">
            {counts.inUse}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setUseFilter("categorised")}
          aria-pressed={useFilter === "categorised"}
          className={`rounded-2xl border p-4 text-left transition-shadow ${
            useFilter === "categorised"
              ? "border-info ring-2 ring-info/50"
              : "border-info/40 hover:border-info/70"
          } bg-info/10 dark:border-info/40 dark:bg-info/15`}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-info">
            Categorised
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-info">
            {counts.categorised}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setUseFilter("loop_verified")}
          aria-pressed={useFilter === "loop_verified"}
          className={`rounded-2xl border p-4 text-left transition-shadow ${
            useFilter === "loop_verified"
              ? "border-accent ring-2 ring-accent/50"
              : "border-accent/40 hover:border-accent/70"
          } bg-accent-soft/40 dark:border-accent/40 dark:bg-accent-soft/20`}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-accent-link">
            Loop verified
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-accent-link">
            {counts.loopVerified}
          </div>
        </button>
      </div>

      <section
        className={`mt-6 rounded-2xl border bg-card p-4 transition-colors sm:p-5 ${
          dropActive ? "border-accent ring-2 ring-accent/40" : "border-border"
        }`}
        onDragOver={(e) => {
          if (importing) return;
          e.preventDefault();
          setDropActive(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDropActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDropActive(false);
          if (importing) return;
          void pickedFromDataTransfer(e.dataTransfer).then((picked) => onImportFiles(picked));
        }}
      >
        <h2 className="text-sm font-semibold">Import</h2>
        <p className="mt-1 text-xs text-muted">
          Drop folders or files anywhere on this panel, or use the buttons to pick a whole pack
          folder or individual files. Large WAVs upload in 8 MB parts with retries. Keep this tab
          open until the counter finishes. Re-import the same folder to retry anything still
          missing. New files stay pending until you mark them Uncategorised.
          Categorised and Loop verified sounds appear in the mixer; Loop verified just marks the
          ones whose loop seam you have checked.
        </p>
        <p className="mt-2 text-xs text-muted">
          Set the category before you pick or drop: it applies to everything in that import and
          stops the classifier from filing them somewhere else.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            Category
            <select
              value={importCategory}
              disabled={importing}
              onChange={(e) => {
                setImportCategory(e.target.value as "" | AdminSoundCategory);
                setImportSubcategory("");
              }}
              className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground"
            >
              <option value="">Auto (classify)</option>
              {SOUND_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
          </label>
          {importCategory && hasFreeformSubcategories(importCategory) ? (
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              Folder (pack name)
              <input
                value={importSubcategory}
                disabled={importing}
                list="import-subcategories"
                placeholder="e.g. Deep Rest Vol 1"
                onChange={(e) => setImportSubcategory(e.target.value)}
                className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground"
              />
              <datalist id="import-subcategories">
                {importSubcategoryChoices.map((s) => (
                  <option key={s} value={prettySubcategoryLabel(s)} />
                ))}
              </datalist>
            </label>
          ) : importCategory && subcategoryOptions(importCategory).length > 0 ? (
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              Subcategory
              <select
                value={importSubcategory}
                disabled={importing}
                onChange={(e) => setImportSubcategory(e.target.value)}
                className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground"
              >
                <option value="">Auto</option>
                {subcategoryOptions(importCategory).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
            className="rounded-xl accent-fill-gradient px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-60"
          >
            {importing ? "Uploading… keep this tab open" : "Import folder"}
          </button>
          {!importing ? (
            <button
              type="button"
              onClick={() => filePickRef.current?.click()}
              className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-background"
            >
              Import files
            </button>
          ) : null}
          {!importing && stuckCount > 0 ? (
            <button
              type="button"
              disabled={reprocessing !== null || loading}
              onClick={() => void onReprocessStuck()}
              title="Re-runs normalization for uploads whose raw file is already in S3"
              className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-background disabled:opacity-60"
            >
              {reprocessing
                ? `Reprocessing ${reprocessing.done}/${reprocessing.total}…`
                : `Reprocess ${stuckCount} unprocessed`}
            </button>
          ) : null}
          {importing ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-background"
            >
              Stop
            </button>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="audio/mpeg,audio/wav,.mp3,.wav"
            multiple
            className="hidden"
            onChange={(e) => void onImportFiles(pickedFromList(e.target.files))}
          />
          <input
            ref={filePickRef}
            type="file"
            accept="audio/mpeg,audio/wav,.mp3,.wav"
            multiple
            className="hidden"
            onChange={(e) => {
              void onImportFiles(pickedFromList(e.target.files));
              e.target.value = "";
            }}
          />
        </div>
        {importNote ? <p className="mt-2 text-xs text-muted">{importNote}</p> : null}
        {reprocessNote ? <p className="mt-2 text-xs text-muted">{reprocessNote}</p> : null}
        {importRows.length > 0 ? (
          <div className="mt-4">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
              <span>{importRows.length} files</span>
              <span className="text-info">
                {importRows.filter((r) => r.status === "uploading").length} uploading
              </span>
              <span className="text-success">
                {importRows.filter((r) => r.status === "done").length} uploaded
              </span>
              <span>{importRows.filter((r) => r.status === "skipped").length} skipped</span>
              <span className="text-danger">
                {importRows.filter((r) => r.status === "failed").length} failed
              </span>
              <span className="text-accent-link">
                {importRows.filter((r) => r.status === "aborted").length} stopped
              </span>
              <span>{importRows.filter((r) => r.status === "queued").length} queued</span>
            </div>
            {importProgress.total > 0 ? (
              <div className="mt-2">
                <div className="flex justify-between text-[11px] text-muted">
                  <span>
                    {formatSize(importProgress.loaded)} / {formatSize(importProgress.total)} sent
                  </span>
                  <span className="tabular-nums">
                    {Math.round((importProgress.loaded / importProgress.total) * 100)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full accent-fill-gradient transition-[width] duration-300"
                    style={{
                      width: `${Math.min(100, (importProgress.loaded / importProgress.total) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}
            <ul className="mt-2 max-h-80 overflow-auto rounded-xl border border-border bg-background">
              {importRows.map((row) => (
                <li
                  key={row.path}
                  className="flex items-start justify-between gap-3 border-b border-border px-3 py-1.5 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 break-all font-mono text-[11px] text-foreground">
                    {row.path}
                  </span>
                  <span className={`shrink-0 text-[11px] font-medium ${importStatusClass(row.status)}`}>
                    {row.status === "uploading"
                      ? `${formatSize(row.loaded)} / ${formatSize(row.size)}`
                      : importStatusLabel(row.status)}
                    {row.detail ? ` · ${row.detail}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-[12rem] flex-1"
          inputClassName="bg-card py-2"
          value={q}
          onChange={setQ}
          placeholder="Search name, pack path"
        />
        <select
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm"
          value={catFilter}
          onChange={(e) => {
            setCatFilter(e.target.value as "all" | AdminSoundCategory);
            setSubFilter("");
          }}
        >
          <option value="all">All categories</option>
          {SOUND_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
        <select
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm"
          value={subFilter}
          onChange={(e) => setSubFilter(e.target.value)}
        >
          <option value="">All subcategories</option>
          {subcategories.map((t) => (
            <option key={`${t.id}-${t.label}`} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm"
          value={useFilter}
          onChange={(e) => setUseFilter(e.target.value as UseFilter)}
        >
          <option value="skip">Not using</option>
          <option value="pending">Pending</option>
          <option value="in">Uncategorised</option>
          <option value="categorised">Categorised</option>
          <option value="loop_verified">Loop verified</option>
          <option value="all">Uncategorised & pending</option>
          <option value="every">All states</option>
        </select>
        {isStatusReviewFilter(useFilter) ? (
          <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm">
            <span className="text-foreground">Review mode</span>
            <button
              type="button"
              role="switch"
              aria-checked={reviewMode}
              onClick={() => setReviewMode((v) => !v)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                reviewMode ? "bg-accent" : "bg-border"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 block h-5 w-5 rounded-full bg-surface shadow transition-transform ${
                  reviewMode ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            {reviewMode ? (
              <span className="hidden text-[11px] text-muted sm:inline">
                {useFilter === "pending"
                  ? "⌘← not using · ⌘→ uncategorised · ⌘↑↓ skip"
                  : "⌘← edit · ⌘→ categorise · ⌘↑↓ skip"}
              </span>
            ) : null}
          </label>
        ) : null}
        {useFilter === "in" && reviewMode ? (
          <button
            type="button"
            disabled={analysingTitles || loading}
            onClick={() => void onAnalyseTitles()}
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm hover:bg-background disabled:opacity-60"
          >
            {analysingTitles ? "Analysing titles…" : "Analyse titles"}
          </button>
        ) : null}
        <select
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm"
          value={sortBy}
          onChange={(e) =>
            setSortBy(e.target.value as "imported-desc" | "imported-asc" | "name")
          }
        >
          <option value="imported-desc">Newest import</option>
          <option value="imported-asc">Oldest import</option>
          <option value="name">Name</option>
        </select>
        <button
          type="button"
          className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-card"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-border bg-card px-4 py-3 text-sm">{error}</div>
      ) : null}
      {loading ? <p className="mt-4 text-sm text-muted">Loading…</p> : null}

      <ul className="mt-4 space-y-3">
        {visible.map((it) => (
          <SoundRow
            key={it.key}
            item={it}
            baseUrl={baseUrl}
            fading={fadingKeys.has(it.key)}
            useFilter={useFilter}
            reviewMode={reviewMode}
            reviewSelected={reviewMode && reviewKey === it.key}
            reviewAutoPlaySeq={reviewMode && reviewKey === it.key ? reviewPlaySeq : 0}
            onReviewSelect={() => setReviewKey(it.key)}
            activePlayKey={activePlayKey}
            onPlayKeyChange={setActivePlayKey}
            onChanged={() => void load()}
            onLocal={(next) => {
              recordLocalEdit(next);
              setItems((list) =>
                list.map((p) => (p.key === it.key || p.key === next.key ? next : p)),
              );
            }}
            onStatusDelta={bumpStatusCounts}
            onBeginFadeOut={beginFadeOut}
            onCancelFadeOut={cancelFadeOut}
            subcategoryChoices={freeformSubcategories(it.category)}
          />
        ))}
      </ul>
      {!loading && visible.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No sounds match these filters.</p>
      ) : null}
      {editPopup ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-suggestion-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setEditPopup(null);
          }}
        >
          <form
            className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl"
            onSubmit={(e) => {
              e.preventDefault();
              submitEditPopup();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setEditPopup(null);
              }
            }}
          >
            <h2 id="edit-suggestion-title" className="font-display text-lg font-medium">
              Edit suggestion
            </h2>
            <label className="mt-4 block">
              <span className="text-sm font-medium text-foreground">Suggested name</span>
              <input
                ref={editNameRef}
                value={editPopup.name}
                onChange={(e) =>
                  setEditPopup((p) => (p ? { ...p, name: e.target.value } : p))
                }
                className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-accent/30 focus:ring-2"
              />
            </label>
            <label className="mt-3 block">
              <span className="text-sm font-medium text-foreground">Category</span>
              <select
                value={editPopup.category}
                onChange={(e) =>
                  setEditPopup((p) => {
                    if (!p) return p;
                    const category = e.target.value as AdminSoundCategory;
                    return {
                      ...p,
                      category,
                      subcategory: hasFreeformSubcategories(category)
                        ? p.subcategory
                        : coerceSoundSubcategory(category, p.subcategory),
                    };
                  })
                }
                className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-accent/30 focus:ring-2"
              >
                {SOUND_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            {hasFreeformSubcategories(editPopup.category) ? (
              <label className="mt-3 block">
                <span className="text-sm font-medium text-foreground">Folder (pack name)</span>
                <input
                  value={editPopup.subcategory}
                  list="edit-subcategories"
                  placeholder="e.g. Deep Rest Vol 1"
                  onChange={(e) =>
                    setEditPopup((p) => (p ? { ...p, subcategory: e.target.value } : p))
                  }
                  className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-accent/30 focus:ring-2"
                />
                <datalist id="edit-subcategories">
                  {freeformSubcategories(editPopup.category).map((s) => (
                    <option key={s} value={prettySubcategoryLabel(s)} />
                  ))}
                </datalist>
              </label>
            ) : subcategoryOptions(editPopup.category).length > 0 ? (
              <label className="mt-3 block">
                <span className="text-sm font-medium text-foreground">Subcategory</span>
                <select
                  value={editPopup.subcategory}
                  onChange={(e) =>
                    setEditPopup((p) => (p ? { ...p, subcategory: e.target.value } : p))
                  }
                  className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-accent/30 focus:ring-2"
                >
                  {subcategoryOptions(editPopup.category).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <p className="mt-3 text-xs text-muted">Enter to save as categorised. Esc to cancel.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditPopup(null)}
                className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl accent-fill-gradient px-3 py-2 text-sm font-medium text-on-accent"
              >
                Save & categorise
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

const STAGE_LABELS: Record<AdminSoundProcessingStage, string> = {
  uploading: "Uploading to S3",
  downloading: "Fetching raw file",
  normalizing: "Loudness normalizing",
  encoding: "Encoding MP3 / Opus",
  storing: "Writing normalized files",
  done: "Finished",
  failed: "Failed",
};

/** A stage that hasn't advanced in this long is a crashed worker, not slow work. */
const STALE_STAGE_MS = 20 * 60 * 1000;

function ageLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/**
 * Explains exactly where an unplayable sound got stuck: mid-upload, mid-encode,
 * or failed with the underlying ffmpeg/S3 error.
 */
function ProcessingStatus({
  item,
  busy,
  onRetry,
}: {
  item: AdminSoundItem;
  busy: boolean;
  onRetry: () => void | Promise<void>;
}) {
  const proc = item.processing ?? null;
  const pending = item.pendingUpload ?? null;
  const stale =
    proc != null &&
    proc.stage !== "failed" &&
    proc.stage !== "done" &&
    Date.now() - new Date(proc.updatedAt).getTime() > STALE_STAGE_MS;

  let headline: string;
  let tone = "text-muted";
  if (pending) {
    const mb = Math.round(pending.uploadedBytes / 1048576);
    headline = `Upload never finished — ${pending.partCount} parts (${mb} MB) sent, then the browser stopped. Re-import this file.`;
    tone = "text-amber-600";
  } else if (proc?.stage === "failed") {
    headline = "Processing failed.";
    tone = "text-red-600";
  } else if (stale && proc) {
    headline = `Stalled during "${STAGE_LABELS[proc.stage]}" — the worker died without reporting. Retry processing.`;
    tone = "text-red-600";
  } else if (proc && item.hasRaw) {
    headline = `${STAGE_LABELS[proc.stage]}…`;
  } else if (item.hasRaw) {
    headline = "Raw file is in S3, waiting for the normalizer to pick it up…";
  } else {
    headline = "Audio never reached S3. Re-import this pack folder to finish the upload.";
    tone = "text-amber-600";
  }

  return (
    <div className="mt-3 space-y-1.5 text-xs">
      <p className={tone}>{headline}</p>
      {proc?.detail || proc?.updatedAt ? (
        <p className="text-muted">
          {[proc?.detail, ageLabel(proc?.updatedAt)].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {pending?.initiatedAt ? (
        <p className="text-muted">Started {ageLabel(pending.initiatedAt)}</p>
      ) : null}
      {proc?.error ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-2 font-mono text-[11px] text-muted">
          {proc.error}
        </pre>
      ) : null}
      {item.hasRaw ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onRetry()}
          className="rounded-xl border border-border px-2.5 py-1 text-xs font-medium hover:bg-background disabled:opacity-50"
        >
          Retry processing
        </button>
      ) : null}
    </div>
  );
}

function SoundRow({
  item,
  baseUrl,
  fading,
  useFilter,
  reviewMode,
  reviewSelected,
  reviewAutoPlaySeq,
  onReviewSelect,
  activePlayKey,
  onPlayKeyChange,
  onChanged,
  onLocal,
  onStatusDelta,
  onBeginFadeOut,
  onCancelFadeOut,
  subcategoryChoices,
}: {
  item: AdminSoundItem;
  baseUrl?: string;
  /** Pack folders already in use, for categories with admin-named folders. */
  subcategoryChoices: string[];
  fading: boolean;
  useFilter: UseFilter;
  reviewMode: boolean;
  reviewSelected: boolean;
  reviewAutoPlaySeq: number;
  onReviewSelect: () => void;
  activePlayKey: string | null;
  onPlayKeyChange: (key: string | null | ((current: string | null) => string | null)) => void;
  onChanged: () => void;
  onLocal: (next: AdminSoundItem) => void;
  onStatusDelta: (from: AdminSoundItem["status"], to: AdminSoundItem["status"]) => void;
  onBeginFadeOut: (key: string) => void;
  onCancelFadeOut: (key: string) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startRef = useRef(item.trimStartSec ?? 0);
  const endRef = useRef<number | null>(item.trimEndSec ?? null);
  const [startSec, setStartSec] = useState(item.trimStartSec ?? 0);
  const [endSec, setEndSec] = useState<number | null>(item.trimEndSec ?? null);
  const [fadeInSec, setFadeInSec] = useState(item.fadeInSec ?? 0);
  const [fadeOutSec, setFadeOutSec] = useState(item.fadeOutSec ?? 0);
  const fadeInRef = useRef(fadeInSec);
  const fadeOutRef = useRef(fadeOutSec);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fadeDim, setFadeDim] = useState(false);
  const [nameDraft, setNameDraft] = useState(item.name);
  const cardRef = useRef<HTMLLIElement | null>(null);
  const seekGuardRef = useRef(0);

  startRef.current = startSec;
  endRef.current = endSec;
  fadeInRef.current = fadeInSec;
  fadeOutRef.current = fadeOutSec;

  useEffect(() => {
    setNameDraft(item.name);
  }, [item.key, item.name]);

  useEffect(() => {
    if (!fading) {
      setFadeDim(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => setFadeDim(true));
    return () => window.cancelAnimationFrame(frame);
  }, [fading]);

  useEffect(() => {
    if (activePlayKey === item.key) return;
    const el = audioRef.current;
    if (el && !el.paused) el.pause();
  }, [activePlayKey, item.key]);

  // Per-frame rather than on timeupdate: timeupdate only fires a few times a
  // second, too coarse for a clean loop point or a smooth fade.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const el = audioRef.current;
      if (el) {
        const limit = loopEnd() ?? (Number.isFinite(el.duration) ? el.duration : null);
        if (
          limit != null &&
          el.currentTime >= limit - 0.02 &&
          performance.now() >= seekGuardRef.current
        ) {
          seekTo(el, startRef.current);
        }
        el.volume = simulatedGain(el.currentTime, limit);
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      const el = audioRef.current;
      if (el) el.volume = 1;
    };
  }, [playing]);

  useEffect(() => {
    if (!reviewSelected) return;
    const card = cardRef.current;
    if (!card) return;
    function align(behavior: ScrollBehavior) {
      if (!card) return;
      // The site header is sticky and sized by its content, so measure it
      // rather than assume a height — otherwise the title lands underneath it.
      const header = document.querySelector(".site-header");
      const headerHeight = header?.getBoundingClientRect().height ?? 0;
      card.style.scrollMarginTop = `${Math.round(headerHeight) + 12}px`;
      card.scrollIntoView({ block: "start", behavior });
    }
    align("smooth");
    // The row just reviewed is still on screen fading out. Once it is dropped
    // the list collapses and this card slides up by its height, so the first
    // scroll always overshoots — settle it again after the row is gone.
    const t = window.setTimeout(() => align("auto"), FADE_OUT_MS + 80);
    return () => window.clearTimeout(t);
  }, [reviewSelected]);

  useEffect(() => {
    if (!reviewAutoPlaySeq) return;
    const el = audioRef.current;
    if (!el) return;
    onReviewSelect();
    onPlayKeyChange(item.key);
    playFromTrimStart();
  }, [reviewAutoPlaySeq]);

  const playKey = streamingPlayKey(item.originalKey || item.key);
  const src = item.ready ? mediaUrl(baseUrl, playKey, item.updatedAt) : "";
  const waveformSrc = src;

  async function savePatch(partial: Partial<AdminSoundItem>) {
    setErr(null);
    const next: AdminSoundItem = {
      ...item,
      ...partial,
      enabled: mixerEnabled(partial.status ?? item.status),
    };
    if (next.status !== item.status) onStatusDelta(item.status, next.status);
    onLocal(next);
    if (partial.status && partial.status !== item.status) {
      if (!statusMatchesFilter(partial.status, useFilter)) {
        audioRef.current?.pause();
        onBeginFadeOut(item.key);
      } else {
        onCancelFadeOut(item.key);
      }
    }
    try {
      const res = await patchAdminSound({
        key: item.key,
        status: partial.status ?? item.status,
        category: (partial.category ?? item.category) as AdminSoundCategory,
        subcategory: partial.subcategory ?? item.subcategory,
        name: partial.name ?? item.name,
        notes: partial.notes ?? item.notes,
      });
      if (res.key !== item.key) onChanged();
    } catch (e) {
      onCancelFadeOut(item.key);
      if (next.status !== item.status) onStatusDelta(next.status, item.status);
      onLocal(item);
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  function loopEnd(): number | null {
    return endRef.current;
  }

  /**
   * Preview the fades without touching the file: gain is derived from the
   * playhead each frame, matching ffmpeg's qsin curve so what you hear here is
   * what "Apply trim" will bake in.
   */
  function simulatedGain(t: number, limit: number | null): number {
    const start = startRef.current;
    const fadeIn = fadeInRef.current;
    const fadeOut = fadeOutRef.current;
    let g = 1;
    if (fadeIn > 0 && t < start + fadeIn) g = Math.min(g, (t - start) / fadeIn);
    if (fadeOut > 0 && limit != null && t > limit - fadeOut) {
      g = Math.min(g, (limit - t) / fadeOut);
    }
    if (!Number.isFinite(g)) return 1;
    return Math.sin(Math.max(0, Math.min(1, g)) * (Math.PI / 2));
  }

  /** Seeking or restarting cancels an in-flight play(); that is not a failure. */
  function startPlayback(el: HTMLAudioElement) {
    void playWithLeadBuffer(el).catch((e) => {
      setErr(e instanceof Error ? e.message : "Could not play");
    });
  }

  /** Jump without the loop check mistaking a stale timeupdate for the seam. */
  function seekTo(el: HTMLAudioElement, sec: number) {
    seekGuardRef.current = performance.now() + 250;
    el.currentTime = sec;
  }

  function playFromTrimStart() {
    const el = audioRef.current;
    if (!el) return;
    onReviewSelect();
    onPlayKeyChange(item.key);
    seekTo(el, startRef.current);
    startPlayback(el);
  }

  /** Drop in just before the loop point so the seam is the next thing you hear. */
  function playLoopSeam() {
    const el = audioRef.current;
    if (!el) return;
    const limit = loopEnd() ?? (Number.isFinite(el.duration) ? el.duration : null);
    if (limit == null) return;
    onReviewSelect();
    onPlayKeyChange(item.key);
    // Start inside the fade-out when it is longer than the lead, otherwise the
    // seam would be auditioned without the fade that shapes it.
    const lead = Math.max(LOOP_TEST_LEAD_SEC, fadeOutRef.current);
    seekTo(el, Math.max(startRef.current, limit - lead));
    startPlayback(el);
  }

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    onReviewSelect();
    onPlayKeyChange(item.key);
    const start = startRef.current;
    const end = loopEnd();
    const t = el.currentTime;
    if (t < start - 0.05 || (end != null && t >= end - 0.04)) {
      playFromTrimStart();
      return;
    }
    startPlayback(el);
  }

  function onAudioTime(el: HTMLAudioElement) {
    setCurrentTime(el.currentTime);
  }

  async function applyTrim() {
    const start = startSec;
    const end = endSec;
    if (!Number.isFinite(start) || start < 0) {
      setErr("Start must be 0 or greater");
      return;
    }
    const clip = (end ?? duration ?? 0) - start;
    if (clip > 0 && (fadeInSec > clip / 4 || fadeOutSec > clip / 4)) {
      setErr("Each fade must be under a quarter of the trimmed length");
      return;
    }
    setErr(null);
    setBusy("trim");
    try {
      await trimAdminSound({
        key: item.key,
        startSec: start,
        endSec: end,
        fadeInSec,
        fadeOutSec,
      });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Trim failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li
      ref={cardRef}
      className={`relative rounded-2xl border border-border bg-card p-4 transition-opacity duration-500 ${
        fading && fadeDim ? "pointer-events-none opacity-0" : "opacity-100"
      } ${reviewSelected ? "ring-2 ring-accent ring-offset-2 ring-offset-background" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {useFilter === "categorised" ||
          useFilter === "loop_verified" ||
          (useFilter === "in" && reviewMode) ? (
            <input
              value={nameDraft}
              disabled={busy !== null}
              aria-label="Title"
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                const name = nameDraft.trim() || item.name;
                setNameDraft(name);
                if (name !== item.name) void savePatch({ name });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              className="w-full rounded-xl border border-border bg-background px-2.5 py-1.5 font-medium outline-none ring-accent/30 focus:ring-2"
            />
          ) : (
            <div className="font-medium">{item.name}</div>
          )}
          <div className="mt-0.5 break-all font-mono text-[11px] text-muted">{item.packPath || item.key}</div>
          <div className="mt-1 text-xs text-muted">
            {formatSize(item.size)}
            {formatImportedAt(item.importedAt) ? ` · ${formatImportedAt(item.importedAt)}` : ""}
            {item.inCatalog ? "" : " · S3 only"}
            {item.ready ? "" : " · processing…"}
            {item.originalKey ? " · original archived for re-trim" : ""}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <select
            className="rounded-xl border border-border bg-background px-2 py-1.5 text-sm"
            value={item.category}
            disabled={busy !== null}
            onChange={(e) => {
              const category = e.target.value as AdminSoundCategory;
              void savePatch({
                category,
                subcategory: coerceSoundSubcategory(category, item.subcategory),
              });
            }}
          >
            {SOUND_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
          {hasFreeformSubcategories(item.category) ? (
            <>
              <input
                className="w-44 rounded-xl border border-border bg-background px-2 py-1.5 text-sm"
                defaultValue={prettySubcategoryLabel(item.subcategory ?? "")}
                key={item.subcategory ?? ""}
                list={`sub-choices-${item.category}`}
                placeholder="Pack folder"
                disabled={busy !== null}
                onBlur={(e) => {
                  const next = soundSubcategorySlug(e.target.value);
                  if (next !== (item.subcategory ?? "")) void savePatch({ subcategory: next });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              <datalist id={`sub-choices-${item.category}`}>
                {subcategoryChoices.map((s) => (
                  <option key={s} value={prettySubcategoryLabel(s)} />
                ))}
              </datalist>
            </>
          ) : subcategoryOptions(item.category).length > 0 ? (
            <select
              className="rounded-xl border border-border bg-background px-2 py-1.5 text-sm"
              value={coerceSoundSubcategory(item.category, item.subcategory)}
              disabled={busy !== null}
              onChange={(e) => void savePatch({ subcategory: e.target.value })}
            >
              {subcategoryOptions(item.category).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : null}
          <div className="flex rounded-full border border-border p-0.5 text-xs">
            {(
              [
                ["unused", "Not using"],
                ["pending", "Pending"],
                ["in_use", "Uncategorised"],
                ["categorised", "Categorised"],
                ["loop_verified", "Loop verified"],
              ] as const
            ).map(([value, label]) => {
              const selected = item.status === value;
              const tone =
                value === "in_use"
                  ? selected
                    ? "bg-success text-on-accent dark:bg-success dark:text-on-accent"
                    : "text-success hover:bg-success/10 dark:text-success dark:hover:bg-success/15"
                  : value === "categorised"
                    ? selected
                      ? "bg-info text-on-accent dark:bg-info dark:text-on-accent"
                      : "text-info hover:bg-info/10 dark:text-info dark:hover:bg-info/15"
                    : value === "loop_verified"
                      ? selected
                        ? "bg-accent text-on-accent dark:bg-accent dark:text-on-accent"
                        : "text-accent-link hover:bg-accent-soft/50 dark:text-accent-link dark:hover:bg-accent-soft/30"
                  : value === "unused"
                    ? selected
                      ? "bg-danger text-on-accent dark:bg-danger dark:text-on-accent"
                      : "text-danger hover:bg-danger-soft dark:text-danger dark:hover:bg-danger-soft"
                    : selected
                      ? "bg-muted text-on-accent dark:bg-muted"
                      : "text-muted hover:bg-background";
              return (
                <button
                  key={value}
                  type="button"
                  disabled={busy === "trim"}
                  onClick={() =>
                    void savePatch({ status: value, enabled: mixerEnabled(value) })
                  }
                  className={`rounded-full px-2.5 py-1 font-medium ${tone}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {src ? (
        <>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              aria-label={playing ? "Pause" : "Play from trim start"}
              disabled={!item.ready}
              onClick={togglePlay}
              className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full accent-fill-gradient text-on-accent disabled:opacity-40"
            >
              {playing ? <IconPause /> : <IconPlay />}
            </button>
            <button
              type="button"
              aria-label="Replay from trim start"
              disabled={!item.ready}
              onClick={playFromTrimStart}
              className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-border text-foreground hover:bg-background disabled:opacity-40"
            >
              <IconReplay />
            </button>
            <button
              type="button"
              aria-label="Test loop"
              title={`Play the last ${LOOP_TEST_LEAD_SEC}s, then loop back to the trim start`}
              disabled={!item.ready || duration == null}
              onClick={playLoopSeam}
              className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 text-sm text-foreground hover:bg-background disabled:opacity-40"
            >
              <IconLoop />
              Test loop
            </button>
          </div>
          <audio
            ref={audioRef}
            className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
            preload="metadata"
            src={src}
            onPlay={() => {
              setPlaying(true);
              onPlayKeyChange(item.key);
            }}
            onPause={() => {
              setPlaying(false);
              onPlayKeyChange((current) => (current === item.key ? null : current));
            }}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onTimeUpdate={(e) => onAudioTime(e.currentTarget)}
            onEnded={() => playFromTrimStart()}
            onError={() =>
              setErr("Could not play this file. It may still be processing, or the MP3 is missing.")
            }
          />
          {waveformSrc ? (
          <SoundTrimWaveform
            src={waveformSrc}
            startSec={startSec}
            endSec={endSec}
            duration={duration}
            currentTime={currentTime}
            onChange={(s, e) => {
              setStartSec(s);
              setEndSec(e);
            }}
            onSeek={(sec) => {
              const el = audioRef.current;
              if (!el) return;
              seekTo(el, sec);
            }}
          />
          ) : null}
        </>
      ) : (
        <ProcessingStatus
          item={item}
          busy={busy !== null}
          onRetry={async () => {
            setBusy("reprocess");
            setErr(null);
            try {
              await reprocessAdminSound(item.key);
              onChanged();
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Reprocess failed");
            } finally {
              setBusy(null);
            }
          }}
        />
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-muted">
          Fade in (s)
          <input
            type="number"
            min={0}
            step={0.1}
            value={fadeInSec}
            disabled={!item.ready || busy !== null}
            onChange={(e) => setFadeInSec(Math.max(0, Number(e.target.value) || 0))}
            className="w-24 rounded-xl border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none ring-accent/30 focus:ring-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-muted">
          Fade out (s)
          <input
            type="number"
            min={0}
            step={0.1}
            value={fadeOutSec}
            disabled={!item.ready || busy !== null}
            onChange={(e) => setFadeOutSec(Math.max(0, Number(e.target.value) || 0))}
            className="w-24 rounded-xl border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none ring-accent/30 focus:ring-2"
          />
        </label>
        <button
          type="button"
          className="rounded-xl border border-border px-3 py-1.5 text-sm hover:bg-background disabled:opacity-60"
          onClick={() => void applyTrim()}
          disabled={!item.ready || busy !== null}
        >
          {busy === "trim" ? "Trimming…" : "Apply trim"}
        </button>
        <span className="pb-1.5 text-[11px] text-muted">
          Trim and fades are previewed live; nothing is written until you apply.
        </span>
      </div>
      {duration != null ? (
        <p className="mt-1 text-[11px] text-muted">
          {item.originalKey
            ? "Waveform is the archived original, so you can re-cut."
            : "First apply archives the original, then writes the trimmed mixer file."}
        </p>
      ) : null}
      {err ? <p className="mt-2 text-xs text-foreground">{err}</p> : null}
    </li>
  );
}
