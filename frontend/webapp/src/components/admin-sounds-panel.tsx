"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SoundTrimWaveform } from "@/components/sound-trim-waveform";
import {
  type AdminSoundCategory,
  type AdminSoundItem,
  createAdminSoundUploads,
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
  subcategoryOptions,
} from "@/lib/sound-taxonomy";

type UseFilter = "all" | "in" | "pending" | "skip" | "categorised";

function mixerEnabled(status: AdminSoundItem["status"]): boolean {
  return status === "categorised";
}

function statusMatchesFilter(status: AdminSoundItem["status"], filter: UseFilter): boolean {
  if (filter === "skip") return status === "unused";
  if (filter === "in") return status === "in_use";
  if (filter === "pending") return status === "pending";
  if (filter === "categorised") return status === "categorised";
  return status === "in_use" || status === "pending";
}

function isStatusReviewFilter(filter: UseFilter): boolean {
  return filter === "pending" || filter === "in";
}

type ImportRowStatus = "queued" | "preparing" | "uploading" | "done" | "skipped" | "failed" | "aborted";

type ImportRow = { path: string; status: ImportRowStatus; detail?: string };

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
  if (status === "preparing") return "text-gold";
  if (status === "done") return "text-success";
  if (status === "failed") return "text-danger";
  if (status === "aborted") return "text-gold";
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

function fileRelativePath(f: File): string {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath?.trim();
  return rel || f.name;
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
  const [activePlayKey, setActivePlayKey] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const [reviewPlaySeq, setReviewPlaySeq] = useState(0);
  const [analysingTitles, setAnalysingTitles] = useState(false);
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
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const el = fileRef.current;
    if (!el) return;
    el.setAttribute("webkitdirectory", "");
    el.setAttribute("directory", "");
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const data = await listAdminSounds();
    setBaseUrl(data.baseUrl);
    setItems(data.items);
    setCounts({
      total: data.counts.total,
      inUse: data.counts.inUse,
      pending: data.counts.pending,
      unused: data.counts.unused,
      categorised: data.counts.categorised ?? 0,
      inCatalog: data.counts.inCatalog ?? data.items.filter((i) => i.inCatalog).length,
    });
  }, []);

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

  const subcategories = useMemo(() => {
    if (catFilter === "all") {
      return SOUND_CATEGORIES.flatMap((c) =>
        subcategoryOptions(c).map((o) => ({ id: o.id, label: `${categoryLabel(c)} · ${o.label}` })),
      );
    }
    return subcategoryOptions(catFilter).map((o) => ({ id: o.id, label: o.label }));
  }, [catFilter]);

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
      if (to === "in_use") next.inUse += 1;
      else if (to === "pending") next.pending += 1;
      else if (to === "unused") next.unused += 1;
      else if (to === "categorised") next.categorised += 1;
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
    }, 520);
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
        if (item.status !== status) bumpStatusCounts(status, item.status);
        setItems((list) => list.map((p) => (p.key === item.key ? item : p)));
      });
    },
    [],
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
        if (item.status !== status) bumpStatusCounts(status, item.status);
        setItems((list) => list.map((p) => (p.key === item.key ? item : p)));
      });
    },
    [],
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
      const t = e.target;
      if (t instanceof HTMLElement) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
      }
      e.preventDefault();
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
          subcategory: current.subcategory,
        });
        return;
      }
      const nextIdx = Math.min(pool.length - 1, Math.max(0, idx + step));
      const next = pool[nextIdx];
      if (!next || next.key === current.key) return;
      setReviewKey(next.key);
      setReviewPlaySeq((n) => n + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyItemStatus, applyCategorise, advanceApprovedReview]);

  async function onImportFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
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
      const list = [...files].filter((f) => /\.(mp3|wav)$/i.test(f.name));
      if (list.length === 0) throw new Error("That folder has no .mp3 or .wav files");
      const byPath = new Map(list.map((f) => [fileRelativePath(f), f]));
      const rows: ImportRow[] = list.map((f) => ({
        path: fileRelativePath(f),
        status: "queued",
      }));
      setImportRows(rows);
      const patchRow = (path: string, next: Partial<ImportRow>) => {
        setImportRows((prev) => prev.map((r) => (r.path === path ? { ...r, ...next } : r)));
      };
      const failed: string[] = [];
      const uploadedPaths: string[] = [];
      let ok = 0;
      let skippedCount = 0;
      const chunkSize = 8;
      const total = list.length;
      for (let i = 0; i < list.length; i += chunkSize) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        const slice = list.slice(i, i + chunkSize);
        for (const f of slice) patchRow(fileRelativePath(f), { status: "preparing", detail: undefined });
        setImportNote(`Preparing ${i + 1}–${Math.min(i + chunkSize, total)} of ${total}`);
        const { uploads, skippedCount: skipped, skipped: skippedPaths } = await createAdminSoundUploads({
          files: slice.map((f) => ({
            relativePath: fileRelativePath(f),
            contentType:
              f.type || (f.name.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg"),
            size: f.size,
          })),
          signal,
        });
        skippedCount += skipped;
        for (const path of skippedPaths) {
          patchRow(path, { status: "skipped" });
        }
        const wanted = new Set(slice.map((f) => fileRelativePath(f)));
        const returned = new Set([...uploads.map((u) => u.relativePath), ...skippedPaths]);
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
              await uploadAdminSoundToS3(u, file, signal);
              ok += 1;
              uploadedPaths.push(u.relativePath);
              patchRow(u.relativePath, { status: "done" });
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
      if (skippedCount > 0) {
        parts.push(`${skippedCount} already uploaded (same Splice filename on S3)`);
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
      subcategory: editPopup.subcategory,
    });
    setEditPopup(null);
    advanceApprovedReview(pool, item.key);
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-5">
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
      </div>

      <section className="mt-6 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold">Import</h2>
        <p className="mt-1 text-xs text-muted">
          Choose a Splice pack folder. Large WAVs upload in 8 MB parts with retries. Keep this tab
          open until the counter finishes. Re-import the same folder to retry anything still
          missing. New files stay pending until you mark them Uncategorised.
          Only Categorised sounds appear in the mixer.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-60 dark:text-deep"
          >
            {importing ? "Uploading… keep this tab open" : "Import folder"}
          </button>
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
            onChange={(e) => void onImportFiles(e.target.files)}
          />
        </div>
        {importNote ? <p className="mt-2 text-xs text-muted">{importNote}</p> : null}
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
              <span className="text-gold">
                {importRows.filter((r) => r.status === "aborted").length} stopped
              </span>
              <span>{importRows.filter((r) => r.status === "queued").length} queued</span>
            </div>
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
                    {importStatusLabel(row.status)}
                    {row.detail ? ` · ${row.detail}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input
          className="min-w-[12rem] flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm"
          placeholder="Search name, pack path"
          value={q}
          onChange={(e) => setQ(e.target.value)}
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
          <option value="all">Uncategorised & pending</option>
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
            onLocal={(next) =>
              setItems((list) => list.map((p) => (p.key === it.key || p.key === next.key ? next : p)))
            }
            onStatusDelta={bumpStatusCounts}
            onBeginFadeOut={beginFadeOut}
            onCancelFadeOut={cancelFadeOut}
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
                      subcategory: coerceSoundSubcategory(category, p.subcategory),
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
            {subcategoryOptions(editPopup.category).length > 0 ? (
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
                className="rounded-xl bg-accent px-3 py-2 text-sm font-medium text-on-accent dark:text-deep"
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
}: {
  item: AdminSoundItem;
  baseUrl?: string;
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
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fadeDim, setFadeDim] = useState(false);
  const [nameDraft, setNameDraft] = useState(item.name);
  const cardRef = useRef<HTMLLIElement | null>(null);

  startRef.current = startSec;
  endRef.current = endSec;

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

  useEffect(() => {
    if (!reviewSelected) return;
    cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [reviewSelected]);

  useEffect(() => {
    if (!reviewAutoPlaySeq) return;
    const el = audioRef.current;
    if (!el) return;
    onReviewSelect();
    onPlayKeyChange(item.key);
    el.currentTime = startRef.current;
    void el.play().catch((e) => {
      setErr(e instanceof Error ? e.message : "Could not play");
    });
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

  function playFromTrimStart() {
    const el = audioRef.current;
    if (!el) return;
    onReviewSelect();
    onPlayKeyChange(item.key);
    el.currentTime = startRef.current;
    void el.play().catch((e) => {
      setErr(e instanceof Error ? e.message : "Could not play");
    });
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
    void el.play().catch((e) => {
      setErr(e instanceof Error ? e.message : "Could not play");
    });
  }

  function onAudioTime(el: HTMLAudioElement) {
    const start = startRef.current;
    const end = loopEnd();
    const limit = end ?? (Number.isFinite(el.duration) ? el.duration : null);
    setCurrentTime(el.currentTime);
    if (limit != null && el.currentTime >= limit - 0.04) {
      el.currentTime = start;
      if (el.paused) void el.play();
    }
  }

  async function applyTrim() {
    const start = startSec;
    const end = endSec;
    if (!Number.isFinite(start) || start < 0) {
      setErr("Start must be 0 or greater");
      return;
    }
    setErr(null);
    setBusy("trim");
    try {
      await trimAdminSound({ key: item.key, startSec: start, endSec: end });
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
          {useFilter === "categorised" || (useFilter === "in" && reviewMode) ? (
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
          {subcategoryOptions(item.category).length > 0 ? (
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
                  : value === "unused"
                    ? selected
                      ? "bg-danger text-on-accent dark:bg-danger dark:text-on-accent"
                      : "text-danger hover:bg-danger-soft dark:text-danger dark:hover:bg-danger-soft"
                    : selected
                      ? "bg-muted text-on-accent dark:bg-muted dark:text-deep"
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
              className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-accent text-on-accent disabled:opacity-40 dark:text-deep"
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
              el.currentTime = sec;
            }}
          />
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-xs text-muted">
          {item.hasRaw
            ? "Waiting for normalized audio…"
            : "Audio never reached S3. Re-import this pack folder to finish the upload."}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <button
          type="button"
          className="rounded-xl border border-border px-3 py-1.5 text-sm hover:bg-background disabled:opacity-60"
          onClick={() => void applyTrim()}
          disabled={!item.ready || busy !== null}
        >
          {busy === "trim" ? "Trimming…" : "Apply trim"}
        </button>
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
