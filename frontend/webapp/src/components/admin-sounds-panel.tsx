"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SoundTrimWaveform } from "@/components/sound-trim-waveform";
import {
  type AdminSoundCategory,
  type AdminSoundItem,
  createAdminSoundUploads,
  uploadAdminSoundToS3,
  suggestAdminSoundCategories,
  getMedimadeMediaBaseUrl,
  listAdminSounds,
  patchAdminSound,
  trimAdminSound,
} from "@/lib/medimade-api";

const CATEGORIES: AdminSoundCategory[] = ["nature", "music", "drums", "noise"];

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
    inCatalog: 0,
  });
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState<"all" | AdminSoundCategory>("all");
  const [useFilter, setUseFilter] = useState<"all" | "in" | "pending" | "skip">("all");
  const [subFilter, setSubFilter] = useState("");
  const [sortBy, setSortBy] = useState<"imported-desc" | "imported-asc" | "name">("imported-desc");
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [activePlayKey, setActivePlayKey] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

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
    const s = new Set<string>();
    for (const it of items) {
      const sub = (it.subcategory || it.suggestedSubcategory || "").trim();
      if (sub) s.add(sub);
    }
    return [...s].sort();
  }, [items]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const sub = subFilter.trim().toLowerCase();
    const filtered = items.filter((it) => {
      if (catFilter !== "all" && it.category !== catFilter) return false;
      if (useFilter === "in" && it.status !== "in_use") return false;
      if (useFilter === "pending" && it.status !== "pending") return false;
      if (useFilter === "skip" && it.status !== "unused") return false;
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
  }, [items, q, catFilter, useFilter, subFilter, sortBy]);

  async function onImportFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setImporting(true);
    setImportNote(null);
    setError(null);
    try {
      const list = [...files].filter((f) => /\.(mp3|wav)$/i.test(f.name));
      if (list.length === 0) throw new Error("That folder has no .mp3 or .wav files");
      const byPath = new Map(list.map((f) => [fileRelativePath(f), f]));
      const failed: string[] = [];
      const uploadedPaths: string[] = [];
      let ok = 0;
      let skippedCount = 0;
      const chunkSize = 8;
      const total = list.length;
      for (let i = 0; i < list.length; i += chunkSize) {
        const slice = list.slice(i, i + chunkSize);
        setImportNote(`Preparing ${i + 1}–${Math.min(i + chunkSize, total)} of ${total}…`);
        const { uploads, skippedCount: skipped } = await createAdminSoundUploads({
          files: slice.map((f) => ({
            relativePath: fileRelativePath(f),
            contentType:
              f.type || (f.name.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg"),
            size: f.size,
          })),
        });
        skippedCount += skipped;
        let cursor = 0;
        const workers = Array.from({ length: Math.min(2, uploads.length) }, async () => {
          while (cursor < uploads.length) {
            const u = uploads[cursor++];
            if (!u) break;
            const file = byPath.get(u.relativePath) ?? byPath.get(u.filename);
            if (!file) {
              failed.push(u.relativePath);
              continue;
            }
            setImportNote(`Uploading ${ok + failed.length + 1} of ${total}… ${u.relativePath}`);
            try {
              await uploadAdminSoundToS3(u, file);
              ok += 1;
              uploadedPaths.push(u.relativePath);
            } catch (e) {
              failed.push(
                `${u.relativePath} (${e instanceof Error ? e.message : "network error"})`,
              );
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
      setImportNote(
        `${parts.join(". ")}. Keep this tab open until uploading finishes. Re-import the same folder to retry any missing files.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Listed</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{counts.total}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">In use</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{counts.inUse}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Pending</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{counts.pending}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Not using</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{counts.unused}</div>
        </div>
      </div>

      <section className="mt-6 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold">Import</h2>
        <p className="mt-1 text-xs text-muted">
          Choose a Splice pack folder. Large WAVs upload in 8 MB parts with retries. Keep this tab
          open until the counter finishes. Re-import the same folder to retry anything still
          missing. New files stay pending until you mark them In use.
        </p>
        <div className="mt-3">
          <button
            type="button"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:text-deep"
          >
            {importing ? "Uploading… keep this tab open" : "Import folder"}
          </button>
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
          onChange={(e) => setCatFilter(e.target.value as "all" | AdminSoundCategory)}
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
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
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm"
          value={useFilter}
          onChange={(e) => setUseFilter(e.target.value as "all" | "in" | "pending" | "skip")}
        >
          <option value="all">All review states</option>
          <option value="in">In use</option>
          <option value="pending">Pending</option>
          <option value="skip">Not using</option>
        </select>
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
            activePlayKey={activePlayKey}
            onPlayKeyChange={setActivePlayKey}
            onChanged={() => void load()}
            onLocal={(next) =>
              setItems((prev) => prev.map((p) => (p.key === it.key || p.key === next.key ? next : p)))
            }
          />
        ))}
      </ul>
      {!loading && visible.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No sounds match these filters.</p>
      ) : null}
    </div>
  );
}

function SoundRow({
  item,
  baseUrl,
  activePlayKey,
  onPlayKeyChange,
  onChanged,
  onLocal,
}: {
  item: AdminSoundItem;
  baseUrl?: string;
  activePlayKey: string | null;
  onPlayKeyChange: (key: string | null | ((current: string | null) => string | null)) => void;
  onChanged: () => void;
  onLocal: (next: AdminSoundItem) => void;
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

  startRef.current = startSec;
  endRef.current = endSec;

  useEffect(() => {
    if (activePlayKey === item.key) return;
    const el = audioRef.current;
    if (el && !el.paused) el.pause();
  }, [activePlayKey, item.key]);

  const playKey = streamingPlayKey(item.originalKey || item.key);
  const src = item.ready ? mediaUrl(baseUrl, playKey, item.updatedAt) : "";
  const waveformSrc = src;
  const suggestion =
    item.suggestedCategory || item.suggestedSubcategory
      ? `${item.suggestedCategory ?? "music"}${item.suggestedSubcategory ? ` / ${item.suggestedSubcategory}` : ""}`
      : null;

  async function savePatch(partial: Partial<AdminSoundItem>) {
    setErr(null);
    setBusy("save");
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
      else onLocal({ ...item, ...partial, key: res.key });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  function loopEnd(): number | null {
    return endRef.current;
  }

  function playFromTrimStart() {
    const el = audioRef.current;
    if (!el) return;
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
    <li className="relative rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">{item.name}</div>
          <div className="mt-0.5 font-mono text-[11px] text-muted">{item.packPath || item.key}</div>
          <div className="mt-1 text-xs text-muted">
            {formatSize(item.size)}
            {formatImportedAt(item.importedAt) ? ` · ${formatImportedAt(item.importedAt)}` : ""}
            {item.inCatalog ? "" : " · S3 only"}
            {item.ready ? "" : " · processing…"}
            {item.originalKey ? " · original archived for re-trim" : ""}
          </div>
          {suggestion ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>
                Suggested: <span className="text-foreground">{suggestion}</span>
              </span>
              <button
                type="button"
                disabled={busy !== null}
                className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-background"
                onClick={() =>
                  void savePatch({
                    category: item.suggestedCategory ?? item.category,
                    subcategory: item.suggestedSubcategory ?? item.subcategory,
                  })
                }
              >
                Apply suggestion
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-xl border border-border bg-background px-2 py-1.5 text-sm"
            value={item.category}
            disabled={busy !== null}
            onChange={(e) => void savePatch({ category: e.target.value as AdminSoundCategory })}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {item.subcategory ? (
            <span className="rounded-full border border-border px-2 py-1 text-xs text-muted">
              {item.subcategory}
            </span>
          ) : null}
          <div className="flex rounded-full border border-border p-0.5 text-xs">
            {(
              [
                ["pending", "Pending"],
                ["in_use", "In use"],
                ["unused", "Not using"],
              ] as const
            ).map(([value, label]) => {
              const selected = item.status === value;
              const tone =
                value === "in_use"
                  ? selected
                    ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-white"
                    : "text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                  : value === "unused"
                    ? selected
                      ? "bg-red-600 text-white dark:bg-red-500 dark:text-white"
                      : "text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                    : selected
                      ? "bg-stone-600 text-white dark:bg-stone-400 dark:text-deep"
                      : "text-muted hover:bg-background";
              return (
                <button
                  key={value}
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void savePatch({ status: value, enabled: value === "in_use" })
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
              className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-accent text-white disabled:opacity-40 dark:text-deep"
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
