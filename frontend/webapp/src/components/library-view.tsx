"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LibraryMeditationItem,
  listLibraryMeditations,
  getMeditationAudioJobStatus,
  patchMeditationFavourite,
  patchMeditationArchived,
  patchMeditationRating,
} from "@/lib/medimade-api";
import { ChatMarkdown } from "@/components/chat-markdown";
import { useMobileOrTouchChrome } from "@/hooks/use-mobile-or-touch-chrome";

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return "—";
  }
  const m = Math.floor(seconds / 60);
  const s = Math.max(0, Math.floor(seconds % 60));
  return `${m}m ${s}s`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const t = hex.trim().replace(/^#/, "");
  if (![3, 6].includes(t.length)) return null;
  const full = t.length === 3 ? t.split("").map((c) => `${c}${c}`).join("") : t;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return null;
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

function IconList({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function IconGrid({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function IconHeart({
  filled,
  className,
  strokeWidth = 2,
}: {
  filled: boolean;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path
        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"
        fill={filled ? "currentColor" : "none"}
      />
    </svg>
  );
}

type ViewMode = "list" | "grid";
type SortBy = "newest" | "oldest" | "title";
type LibraryMainTab = "meditations" | "drafts";

type ActiveTrack = { url: string; title: string; s3Key: string };

type PendingLibraryGeneration = {
  jobId: string;
  createdAt: string;
  title: string;
  description: string | null;
  meditationStyle: string | null;
  speakerName: string | null;
  speakerModelId: string | null;
  status?: "pending" | "running" | "failed";
  error?: string | null;
};

type PendingLibraryMeditationItem = {
  kind: "pending";
  pendingKey: string; // pending:<jobId>
  jobId: string;
  title: string;
  description: string | null;
  createdAt: string;
  meditationStyle: string | null;
  speakerName: string | null;
  speakerModelId: string | null;
  status: "pending" | "running" | "failed";
  error: string | null;
};

type LibraryRow = LibraryMeditationItem | PendingLibraryMeditationItem;

const PENDING_LIBRARY_GENERATIONS_LS_KEY = "mm_pending_library_generations_v1";

function isPendingRow(x: LibraryRow): x is PendingLibraryMeditationItem {
  return (x as PendingLibraryMeditationItem).kind === "pending";
}

function loadPendingGenerations(): PendingLibraryGeneration[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PENDING_LIBRARY_GENERATIONS_LS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter((x): x is PendingLibraryGeneration => {
      if (!x || typeof x !== "object") return false;
      const o = x as Record<string, unknown>;
      return (
        typeof o.jobId === "string" &&
        typeof o.createdAt === "string" &&
        typeof o.title === "string"
      );
    });
  } catch {
    return [];
  }
}

function savePendingGenerations(next: PendingLibraryGeneration[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PENDING_LIBRARY_GENERATIONS_LS_KEY,
      JSON.stringify(next.slice(0, 20)),
    );
  } catch {
    // ignore
  }
}

function formatAudioClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function downloadBasename(title: string): string {
  const t = title.trim() || "meditation";
  const safe = t.replace(/[^\w\- .]+/g, "_").replace(/\s+/g, " ").trim();
  return `${safe.slice(0, 80)}.mp3`;
}

function stripPauseMarkers(text: string): string {
  // Remove library script-only pause markers: `[[PAUSE xs]]`
  return text.replace(/\[\[PAUSE\s+[^\]]+\]\]/g, "");
}

function LibraryAudioStrip({
  track,
  onDismiss,
  playbackToggleNonce,
  onPlayingChange,
  onPlaybackTimeChange,
}: {
  track: ActiveTrack | null;
  onDismiss: () => void;
  playbackToggleNonce: number;
  onPlayingChange?: (s3Key: string, playing: boolean) => void;
  onPlaybackTimeChange?: (s3Key: string, timeSeconds: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const seekingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const lastToggleNonceRef = useRef(playbackToggleNonce);
  const lastReportedTimeRef = useRef<number>(-Infinity);

  const reportTime = useCallback(
    (t: number) => {
      if (!track) return;
      if (!onPlaybackTimeChange) return;
      // Throttle so we don't re-render the whole library on every `timeupdate`.
      if (Math.abs(t - lastReportedTimeRef.current) < 0.25) return;
      lastReportedTimeRef.current = t;
      onPlaybackTimeChange(track.s3Key, t);
    },
    [track, onPlaybackTimeChange],
  );

  function togglePlayback() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  useEffect(() => {
    if (!track) return;
    seekingRef.current = false;
    lastReportedTimeRef.current = -Infinity;
    const el = audioRef.current;
    if (!el) return;
    el.load();
    void el.play().catch(() => {
      // If autoplay fails, keep initial local state and let the card UI fall back to "Play".
    });
  }, [track]);

  useEffect(() => {
    if (!track) return;
    if (playbackToggleNonce === lastToggleNonceRef.current) return;
    lastToggleNonceRef.current = playbackToggleNonce;
    togglePlayback();
  }, [playbackToggleNonce, track]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !track) return;

    const onTime = () => {
      if (!seekingRef.current) {
        const t = el.currentTime;
        setCurrent(t);
        reportTime(t);
      }
    };
    const syncDuration = () => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };
    const onPlay = () => {
      setPlaying(true);
      onPlayingChange?.(track.s3Key, true);
    };
    const onPause = () => {
      setPlaying(false);
      onPlayingChange?.(track.s3Key, false);
    };
    const onEnded = () => {
      setPlaying(false);
      onPlayingChange?.(track.s3Key, false);
    };

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("durationchange", syncDuration);
    el.addEventListener("loadedmetadata", syncDuration);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);

    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("durationchange", syncDuration);
      el.removeEventListener("loadedmetadata", syncDuration);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, [track, onPlayingChange, reportTime]);

  if (!track) return null;

  const max = Math.max(duration, 0.0001);

  function skipSeconds(delta: number) {
    const el = audioRef.current;
    if (!el) return;
    const end =
      Number.isFinite(el.duration) && el.duration > 0
        ? el.duration
        : Number.isFinite(duration) && duration > 0
          ? duration
          : max;
    const next = Math.min(end, Math.max(0, el.currentTime + delta));
    el.currentTime = next;
    setCurrent(next);
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 px-3 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur-md dark:bg-card/98 dark:shadow-[0_-8px_24px_rgba(0,0,0,0.35)] sm:px-4"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      role="region"
      aria-label="Now playing"
    >
      <audio
        key={track.s3Key}
        ref={audioRef}
        src={track.url}
        preload="metadata"
        className="hidden"
      />

      <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => skipSeconds(-10)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground hover:border-accent/40 sm:h-11 sm:w-11"
              aria-label="Back 10 seconds"
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="currentColor"
                aria-hidden
              >
                <path d="M11 18V6l-8.5 6L11 18zm11 0V6l-8.5 6L22 18z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                const el = audioRef.current;
                if (!el) return;
                if (el.paused) void el.play();
                else el.pause();
              }}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white dark:text-deep"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
                  <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7L8 5z" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => skipSeconds(10)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground hover:border-accent/40 sm:h-11 sm:w-11"
              aria-label="Forward 10 seconds"
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="currentColor"
                aria-hidden
              >
                <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
              </svg>
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {track.title}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="w-10 shrink-0 tabular-nums text-xs text-muted">
                {formatAudioClock(current)}
              </span>
              <input
                type="range"
                className="h-1.5 w-full min-w-0 flex-1 cursor-pointer accent-accent"
                min={0}
                max={max}
                step={0.05}
                value={Math.min(current, max)}
                aria-label="Seek"
                onMouseDown={() => {
                  seekingRef.current = true;
                }}
                onMouseUp={() => {
                  seekingRef.current = false;
                }}
                onMouseLeave={() => {
                  seekingRef.current = false;
                }}
                onTouchStart={() => {
                  seekingRef.current = true;
                }}
                onTouchEnd={() => {
                  seekingRef.current = false;
                }}
                onChange={(e) => {
                  const el = audioRef.current;
                  const v = Number(e.target.value);
                  if (el) el.currentTime = v;
                  setCurrent(v);
                  reportTime(v);
                }}
              />
              <span className="w-10 shrink-0 text-right tabular-nums text-xs text-muted">
                {formatAudioClock(duration)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 sm:justify-start">
          <a
            href={track.url}
            download={downloadBasename(track.title)}
            className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground hover:border-accent/40"
            aria-label="Download audio"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 3v12" />
              <path d="M7 10l5 5 5-5" />
              <path d="M21 21H3" />
            </svg>
          </a>
          <button
            type="button"
            onClick={() => {
              audioRef.current?.pause();
              onDismiss();
            }}
            className="rounded-xl border border-border px-3 py-2.5 text-sm text-muted hover:border-accent/40"
            aria-label="Close player"
          >
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
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LibraryView({
  initialItems = null,
}: {
  initialItems?: LibraryMeditationItem[] | null;
}) {
  const alwaysShowRowChrome = useMobileOrTouchChrome();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<LibraryMeditationItem[]>(
    Array.isArray(initialItems) ? initialItems : [],
  );
  // IMPORTANT: keep initial render consistent between SSR and client hydration.
  // Pending generations are stored in localStorage (client-only), so we load them after mount.
  const [pending, setPending] = useState<PendingLibraryGeneration[]>([]);
  const [loading, setLoading] = useState(!Array.isArray(initialItems));
  const [error, setError] = useState<string | null>(null);
  const [expandedSk, setExpandedSk] = useState<string | null>(null);
  const [ratingBusy, setRatingBusy] = useState<string | null>(null);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [favouriteBusySk, setFavouriteBusySk] = useState<string | null>(null);
  const [archiveBusySk, setArchiveBusySk] = useState<string | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<{
    sk: string;
    title: string;
  } | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [libraryTab, setLibraryTab] = useState<LibraryMainTab>("meditations");
  const PAGE_SIZE = 24;
  const [page, setPage] = useState(1);
  const [nowPlaying, setNowPlaying] = useState<ActiveTrack | null>(null);
  const [playingS3Key, setPlayingS3Key] = useState<string | null>(null);
  const [playingTimeSeconds, setPlayingTimeSeconds] = useState(0);
  const playingS3KeyRef = useRef<string | null>(null);
  const [playbackToggleNonce, setPlaybackToggleNonce] = useState(0);
  const [pendingAutoplay, setPendingAutoplay] = useState<{
    jobId: string;
    audioKey: string;
  } | null>(null);
  const [accentRgb, setAccentRgb] = useState<{
    r: number;
    g: number;
    b: number;
  } | null>(null);

  const indeterminateStyle = (
    <style>{`
      @keyframes mmIndeterminateBar {
        0% { transform: translateX(-40%); }
        50% { transform: translateX(120%); }
        100% { transform: translateX(320%); }
      }
    `}</style>
  );

  const itemElsRef = useRef<Map<string, HTMLLIElement>>(new Map());
  const focusHandledRef = useRef(false);

  // Keep a stable ref for throttled `timeupdate` callbacks.
  playingS3KeyRef.current = playingS3Key;

  useEffect(() => {
    const readAccent = () => {
      if (typeof window === "undefined") return;
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--accent")
        .trim();
      const rgb = hexToRgb(raw);
      if (rgb) setAccentRgb(rgb);
    };

    readAccent();
    if (typeof window === "undefined") return;

    // If the user toggles dark mode, `--accent` swaps values.
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mql) return;
    mql.addEventListener?.("change", readAccent);
    return () => mql.removeEventListener?.("change", readAccent);
  }, []);

  const sortedItems = useMemo(() => {
    const next = [...items];
    if (sortBy === "title") {
      next.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    } else if (sortBy === "oldest") {
      next.sort(
        (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
      );
    } else {
      // "newest"
      next.sort(
        (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
      );
    }
    return next;
  }, [items, sortBy]);

  const pendingRows: PendingLibraryMeditationItem[] = useMemo(() => {
    const next = [...pending];
    next.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return next.map((p) => ({
      kind: "pending",
      pendingKey: `pending:${p.jobId}`,
      jobId: p.jobId,
      title: p.title,
      description: p.description ?? null,
      createdAt: p.createdAt,
      meditationStyle: p.meditationStyle ?? null,
      speakerName: p.speakerName ?? null,
      speakerModelId: p.speakerModelId ?? null,
      status: p.status ?? "pending",
      error: p.error ?? null,
    }));
  }, [pending]);

  const libraryRows: LibraryRow[] = useMemo(() => {
    // Only show pending generations in the main meditations tab.
    if (libraryTab !== "meditations") return sortedItems;
    return [...pendingRows, ...sortedItems];
  }, [libraryTab, pendingRows, sortedItems]);

  const visibleItems: LibraryRow[] = useMemo(() => {
    if (libraryTab === "drafts") {
      return sortedItems.filter((x) => x.isDraft === true);
    }
    const base = sortedItems.filter((x) => x.catalogued && x.archived !== true);
    const afterFav = favouritesOnly ? base.filter((x) => x.favourite) : base;
    const afterCat =
      categoryFilter === "all"
        ? afterFav
        : afterFav.filter(
            (x) => (x.meditationStyle || x.meditationType || "—") === categoryFilter,
          );
    // Always surface pending generations at the top of the meditations tab.
    return [...pendingRows, ...afterCat];
  }, [sortedItems, favouritesOnly, categoryFilter, libraryTab, pendingRows]);

  useEffect(() => {
    // When the user changes filters/sort/tabs, reset pagination so they don't land mid-list.
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, favouritesOnly, categoryFilter, libraryTab]);

  const nonPendingVisibleItems = useMemo(() => {
    return visibleItems.filter((x) => !isPendingRow(x));
  }, [visibleItems]);

  const totalPages = useMemo(() => {
    const count = Math.max(0, nonPendingVisibleItems.length);
    return Math.max(1, Math.ceil(count / PAGE_SIZE));
  }, [nonPendingVisibleItems.length]);

  useEffect(() => {
    // If results shrink (filtering, archiving) clamp the current page.
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  const pagedVisibleItems: LibraryRow[] = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    if (libraryTab !== "meditations") {
      return visibleItems.slice(start, end);
    }
    const pendingTop = visibleItems.filter((x) => isPendingRow(x));
    return [...pendingTop, ...nonPendingVisibleItems.slice(start, end)];
  }, [libraryTab, visibleItems, nonPendingVisibleItems, page]);

  const pagination = useMemo(() => {
    if (totalPages <= 1) return null;
    const current = Math.min(Math.max(1, page), totalPages);
    const windowSize = 5;
    let start = Math.max(1, current - Math.floor(windowSize / 2));
    let end = Math.min(totalPages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);
    const pages: number[] = [];
    for (let p = start; p <= end; p++) pages.push(p);
    return { current, pages, totalPages };
  }, [page, totalPages]);

  const skipScrollOnFirstPageEffect = useRef(true);
  useEffect(() => {
    if (skipScrollOnFirstPageEffect.current) {
      skipScrollOnFirstPageEffect.current = false;
      return;
    }
    // App layout scrolls inside <main>, not the window.
    document.querySelector("main")?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [page]);

  const categoryOptions = useMemo(() => {
    const base = sortedItems.filter((x) => x.catalogued);
    const afterFav = favouritesOnly ? base.filter((x) => x.favourite) : base;
    const counts: Record<string, number> = {};
    for (const x of afterFav) {
      const key = x.meditationStyle || x.meditationType || "—";
      if (!key || key === "—") continue;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  }, [sortedItems, favouritesOnly]);

  const categoryItems = useMemo(() => {
    const allLabel = "All Categories";
    return [
      { value: "all", label: allLabel },
      ...categoryOptions.map(([cat, count]) => ({
        value: cat,
        label: cat,
      })),
    ];
  }, [categoryOptions]);

  const selectedCategoryLabel = useMemo(() => {
    return categoryItems.find((x) => x.value === categoryFilter)?.label ?? categoryItems[0]?.label ?? "";
  }, [categoryItems, categoryFilter]);

  const longestCategoryLabel = useMemo(() => {
    return categoryItems.reduce<string>((acc, cur) => (cur.label.length > acc.length ? cur.label : acc), selectedCategoryLabel);
  }, [categoryItems, selectedCategoryLabel]);

  const categoryDropdownRef = useRef<HTMLDivElement | null>(null);
  const categoryButtonRef = useRef<HTMLButtonElement | null>(null);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [categoryButtonWidthPx, setCategoryButtonWidthPx] = useState<number | null>(null);
  const [categoryMenuWidthPx, setCategoryMenuWidthPx] = useState<number | null>(null);

  useEffect(() => {
    const btn = categoryButtonRef.current;
    if (!btn) return;

    if (!selectedCategoryLabel || !longestCategoryLabel) return;

    const styles = window.getComputedStyle(btn);
    const paddingLeft = parseFloat(styles.paddingLeft) || 0;
    const paddingRight = parseFloat(styles.paddingRight) || 0;
    const borderLeft = parseFloat(styles.borderLeftWidth) || 0;
    const borderRight = parseFloat(styles.borderRightWidth) || 0;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const font = `${styles.fontStyle} ${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
    ctx.font = font;

    const selectedW = ctx.measureText(selectedCategoryLabel).width;
    const longestW = ctx.measureText(longestCategoryLabel).width;

    const caretBuffer = 26; // space for the chevron icon + gap
    const buttonW = Math.ceil(
      selectedW + paddingLeft + paddingRight + borderLeft + borderRight + caretBuffer,
    );
    const menuW = Math.ceil(longestW + paddingLeft + paddingRight + borderLeft + borderRight);

    setCategoryButtonWidthPx(buttonW);
    setCategoryMenuWidthPx(Math.max(menuW, buttonW));
  }, [selectedCategoryLabel, longestCategoryLabel]);

  useEffect(() => {
    if (!categoryDropdownOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = categoryDropdownRef.current;
      if (!root) return;
      if (!root.contains(e.target as Node)) setCategoryDropdownOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [categoryDropdownOpen]);

  const sortItems = useMemo(() => {
    return [
      { value: "newest" as SortBy, label: "Newest" },
      { value: "oldest" as SortBy, label: "Oldest" },
      { value: "title" as SortBy, label: "Title (A-Z)" },
    ];
  }, []);

  const selectedSortLabel = useMemo(() => {
    return sortItems.find((x) => x.value === sortBy)?.label ?? "";
  }, [sortItems, sortBy]);

  const longestSortLabel = useMemo(() => {
    return sortItems.reduce<string>((acc, cur) => (cur.label.length > acc.length ? cur.label : acc), selectedSortLabel);
  }, [sortItems, selectedSortLabel]);

  const sortDropdownRef = useRef<HTMLDivElement | null>(null);
  const sortButtonRef = useRef<HTMLButtonElement | null>(null);
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [sortButtonWidthPx, setSortButtonWidthPx] = useState<number | null>(null);
  const [sortMenuWidthPx, setSortMenuWidthPx] = useState<number | null>(null);

  useEffect(() => {
    const btn = sortButtonRef.current;
    if (!btn) return;
    if (!selectedSortLabel || !longestSortLabel) return;

    const styles = window.getComputedStyle(btn);
    const paddingLeft = parseFloat(styles.paddingLeft) || 0;
    const paddingRight = parseFloat(styles.paddingRight) || 0;
    const borderLeft = parseFloat(styles.borderLeftWidth) || 0;
    const borderRight = parseFloat(styles.borderRightWidth) || 0;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const font = `${styles.fontStyle} ${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
    ctx.font = font;

    const selectedW = ctx.measureText(selectedSortLabel).width;
    const longestW = ctx.measureText(longestSortLabel).width;

    const caretBuffer = 26;
    const buttonW = Math.ceil(
      selectedW + paddingLeft + paddingRight + borderLeft + borderRight + caretBuffer,
    );
    const menuW = Math.ceil(longestW + paddingLeft + paddingRight + borderLeft + borderRight);

    setSortButtonWidthPx(buttonW);
    setSortMenuWidthPx(Math.max(menuW, buttonW));
  }, [selectedSortLabel, longestSortLabel]);

  useEffect(() => {
    if (!sortDropdownOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = sortDropdownRef.current;
      if (!root) return;
      if (!root.contains(e.target as Node)) setSortDropdownOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [sortDropdownOpen]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listLibraryMeditations();
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load library");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // If we already have SSR-prefetched items, avoid flashing a loading state;
    // still refresh in the background so the list stays current.
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPending(loadPendingGenerations());
  }, []);

  // Keep local pending generations in sync + poll status.
  useEffect(() => {
    if (pending.length === 0) return;

    let cancelled = false;
    const tick = async (opts: { refreshLibraryOnChange: boolean }) => {
      if (cancelled) return;
      const current = loadPendingGenerations();
      if (current.length === 0) {
        setPending([]);
        return;
      }
      let changed = false;
      const next: PendingLibraryGeneration[] = [];
      for (const p of current) {
        try {
          const st = await getMeditationAudioJobStatus(p.jobId);
          const nextTitle = (st.title ?? "").trim();
          const nextDesc = (st.description ?? "").trim();
          const nextP: PendingLibraryGeneration =
            nextTitle || nextDesc ? { ...p } : p;
          if (nextTitle && nextTitle !== p.title) {
            changed = true;
            nextP.title = nextTitle;
          }
          if (nextDesc && nextDesc !== (p.description ?? "")) {
            changed = true;
            nextP.description = nextDesc;
          }
          if (st.status === "completed") {
            changed = true;
            if (st.audioKey) {
              setPendingAutoplay({ jobId: p.jobId, audioKey: st.audioKey });
            }
            continue; // drop from pending; the real item will appear via list refresh
          }
          if (st.status === "failed") {
            changed = true;
            next.push({ ...nextP, status: "failed", error: st.error ?? "Generation failed" });
            continue;
          }
          next.push({ ...nextP, status: st.status === "running" ? "running" : "pending" });
        } catch (e) {
          // Network errors shouldn't kill the placeholder; keep it.
          next.push(p);
        }
      }
      if (!cancelled) {
        if (changed) {
          savePendingGenerations(next);
          setPending(next);
          if (opts.refreshLibraryOnChange) {
            void load();
          }
        } else {
          setPending(next);
        }
      }
    };

    // Two-speed polling:
    // - fast: update title/description ASAP (script/meta finish well before audio)
    // - slow: refresh library list to pick up completed audio rows
    const needMeta = () =>
      loadPendingGenerations().some((p) => {
        const t = (p.title ?? "").trim().toLowerCase();
        const looksFallback = t === "generating meditation…" || t === "generating meditation...";
        return looksFallback || !(p.description ?? "").trim();
      });

    void tick({ refreshLibraryOnChange: false });
    const fastId = window.setInterval(() => {
      if (!needMeta()) return;
      void tick({ refreshLibraryOnChange: false });
    }, 1200);

    const slowId = window.setInterval(() => {
      void tick({ refreshLibraryOnChange: true });
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(fastId);
      window.clearInterval(slowId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.length, load]);

  // If navigated from Create → "View in Library", auto-scroll and start playing.
  useEffect(() => {
    if (loading) return;
    if (focusHandledRef.current) return;
    const focus = searchParams.get("focus")?.trim() || "";
    if (!focus) return;
    focusHandledRef.current = true;

    // Ensure we show the meditations tab (not drafts) for a generated audio key.
    setLibraryTab("meditations");

    const found = visibleItems.find((x) => {
      if (isPendingRow(x)) return x.pendingKey === focus;
      return x.s3Key === focus;
    });
    if (!found) return;

    // Scroll to the card.
    const key = isPendingRow(found) ? found.pendingKey : found.s3Key;
    const el = itemElsRef.current.get(key);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // Start playing in the strip (autoplay is already attempted in LibraryAudioStrip).
    const play = searchParams.get("play");
    if (play === "1") {
      if (!isPendingRow(found)) {
        setNowPlaying({ url: found.audioUrl, title: found.title, s3Key: found.s3Key });
      }
    }
  }, [loading, visibleItems, searchParams]);

  const nowKey = nowPlaying?.s3Key ?? null;
  useEffect(() => {
    if (!nowKey) setPlayingS3Key(null);
  }, [nowKey]);

  // If we were focused on a pending card, auto-switch focus to the real item and autoplay once it appears.
  useEffect(() => {
    if (!pendingAutoplay) return;
    const found = items.find((x) => x.s3Key === pendingAutoplay.audioKey);
    if (!found) return;

    // Update URL so refresh/share lands on the actual item.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("focus", found.s3Key);
      url.searchParams.set("play", "1");
      window.history.replaceState({}, "", url.toString());
    } catch {
      // ignore
    }

    // Scroll + autoplay.
    const el = itemElsRef.current.get(found.s3Key);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setNowPlaying({ url: found.audioUrl, title: found.title, s3Key: found.s3Key });
    setPendingAutoplay(null);
    // allow focus effect to run again on updated query if needed
    focusHandledRef.current = true;
  }, [pendingAutoplay, items]);

  async function setRating(item: LibraryMeditationItem, rating: number | null) {
    if (!item.sk) return;
    const sk = item.sk;
    const prevRating = item.rating;
    setRatingBusy(item.sk);
    try {
      // Optimistic UI update so the stars flip immediately.
      setItems((prev) =>
        prev.map((x) => (x.sk === sk ? { ...x, rating } : x)),
      );
      await patchMeditationRating(item.sk, rating);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save rating");
      // Roll back on failure.
      setItems((prev) =>
        prev.map((x) => (x.sk === sk ? { ...x, rating: prevRating } : x)),
      );
    } finally {
      setRatingBusy(null);
    }
  }

  async function setFavourite(
    item: LibraryMeditationItem,
    favourite: boolean,
  ) {
    if (!item.sk) return;
    const sk = item.sk;
    const prevFavourite = item.favourite;
    setFavouriteBusySk(sk);
    // Optimistic UI update so the heart flips immediately.
    setItems((prev) =>
      prev.map((x) => (x.sk === sk ? { ...x, favourite } : x)),
    );
    try {
      await patchMeditationFavourite(sk, favourite);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save favourite");
      // Roll back on failure.
      setItems((prev) =>
        prev.map((x) =>
          x.sk === sk ? { ...x, favourite: prevFavourite } : x,
        ),
      );
    } finally {
      setFavouriteBusySk(null);
    }
  }

  async function setArchived(item: LibraryMeditationItem, archived: boolean) {
    if (!item.sk) return;
    const sk = item.sk;
    const prevArchived = item.archived;
    setArchiveBusySk(sk);
    // Optimistic UI update; archived items drop out of the visible list.
    setItems((prev) => prev.map((x) => (x.sk === sk ? { ...x, archived } : x)));
    try {
      await patchMeditationArchived(sk, archived);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not archive meditation");
      setItems((prev) =>
        prev.map((x) => (x.sk === sk ? { ...x, archived: prevArchived } : x)),
      );
    } finally {
      setArchiveBusySk(null);
    }
  }

  function renderItem(m: LibraryRow) {
    if (isPendingRow(m)) {
      return (
        <li
          key={m.pendingKey}
          ref={(el) => {
            if (el) itemElsRef.current.set(m.pendingKey, el);
            else itemElsRef.current.delete(m.pendingKey);
          }}
          className="relative min-w-0 overflow-hidden rounded-2xl border border-accent/35 bg-accent-soft/20 p-4 shadow-sm"
        >
          {/* Indeterminate linear progress (MUI-like) */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 h-1 w-full bg-accent/10"
          >
            <div
              className="h-full w-1/3 bg-accent/60"
              style={{
                animation: "mmIndeterminateBar 1.4s ease-in-out infinite",
              }}
            />
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 animate-pulse bg-accent-soft/30"
          />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-medium leading-snug">
                {m.title}
              </h2>
              <p className="mt-1 text-sm text-muted">{m.description ?? "—"}</p>
              <p className="mt-2 text-xs text-muted">
                {formatWhen(m.createdAt)}
                {m.speakerName ? ` · ${m.speakerName}` : ""}
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/15 text-accent"
                aria-label="Generating"
                title="Generating"
              >
                <svg
                  className="h-5 w-5 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden
                >
                  <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                </svg>
              </div>
            </div>
          </div>
        </li>
      );
    }
    // From here, `m` is a real library item.
    if (m.isDraft === true) {
      const href =
        m.sk != null
          ? `/create?draftSk=${encodeURIComponent(m.sk)}`
          : "/create";
      const continueBtn = (
        <Link
          href={href}
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 dark:text-deep"
        >
          Continue
        </Link>
      );
      if (viewMode === "grid") {
        return (
          <li
            key={m.s3Key}
            className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Draft
            </p>
            <h2 className="font-display mt-2 text-lg font-medium leading-snug">
              {m.title}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {m.meditationStyle?.trim() ? m.meditationStyle : "—"}
            </p>
            <p className="mt-3 text-xs text-muted">
              {formatWhen(m.createdAt)}
            </p>
            <div className="mt-auto pt-4">{continueBtn}</div>
          </li>
        );
      }
      return (
        <li
          key={m.s3Key}
          ref={(el) => {
            if (el) itemElsRef.current.set(m.s3Key, el);
            else itemElsRef.current.delete(m.s3Key);
          }}
          className="group relative min-w-0 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <span className="inline-block rounded-full border border-border bg-accent-soft/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                Draft
              </span>
              <h2 className="font-display mt-2 text-lg font-medium leading-snug">
                {m.title}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {m.meditationStyle?.trim()
                  ? m.meditationStyle
                  : "Style not set yet"}
              </p>
              <p className="mt-2 text-xs text-muted">
                Saved {formatWhen(m.createdAt)}
              </p>
            </div>
            {continueBtn}
          </div>
        </li>
      );
    }

    const open = m.sk != null && expandedSk === m.sk;
    const isSelected = nowPlaying?.s3Key === m.s3Key;
    const isPlaying = playingS3Key === m.s3Key;
    const styleLine = m.meditationStyle || m.meditationType || "—";
    const lengthLine = formatDuration(m.durationSeconds);

    const stars = (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            disabled={!m.sk || ratingBusy === m.sk}
            onClick={() =>
              void setRating(m, m.rating === star ? null : star)
            }
            className={`rounded px-0.5 text-base leading-none sm:text-lg ${
              m.rating != null && star <= m.rating
                ? "text-gold"
                : "text-gold opacity-40"
            } ${!m.sk ? "cursor-not-allowed opacity-40" : ""}`}
            title={
              m.sk
                ? undefined
                : "Ratings need a catalogued row (generated after metadata deploy)"
            }
          >
            ★
          </button>
        ))}
      </div>
    );

    const favouriteDisabled = !m.sk || favouriteBusySk === m.sk;
    const favouriteBtn = (
      <button
        type="button"
        onClick={() => void setFavourite(m, !m.favourite)}
        disabled={favouriteDisabled}
        aria-label={m.favourite ? "Unfavourite meditation" : "Favourite meditation"}
        className={`self-center items-center justify-center p-1 transition-opacity transition-colors ${
          m.favourite || alwaysShowRowChrome
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
        } ${
          "text-accent"
        } ${
          favouriteDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        }`}
      >
        <IconHeart filled={m.favourite} strokeWidth={2.5} />
      </button>
    );

    const archiveDisabled =
      !m.sk || archiveBusySk === m.sk || ratingBusy === m.sk || favouriteBusySk === m.sk;
    const archiveBtn = (
      <button
        type="button"
        onClick={() => {
          if (!m.sk) return;
          setArchiveConfirm({ sk: m.sk, title: m.title });
        }}
        disabled={archiveDisabled}
        aria-label="Archive meditation"
        className={`cursor-pointer text-xs font-semibold transition-opacity transition-colors ${
          alwaysShowRowChrome
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
        } ${
          "text-muted hover:text-foreground"
        } ${
          archiveDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        }`}
        title="Archive"
      >
        Archive
      </button>
    );

    const scriptToggleBtn =
      m.scriptText && m.sk != null ? (
        <button
          type="button"
          onClick={() =>
            setExpandedSk((v) => (v === m.sk ? null : (m.sk ?? null)))
          }
          className={`ml-2 ${
            open
              ? "inline-flex"
              : alwaysShowRowChrome
                ? "inline-flex"
                : "hidden group-hover:inline-flex"
          } items-center font-bold text-accent hover:text-accent/80 cursor-pointer`}
          style={{ lineHeight: "1.35" }}
        >
          {open ? "hide script" : "show script"}
        </button>
      ) : null;

    const actions = (
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
        {isPlaying ? (
          <div className="flex items-center gap-2">
            <span className="tabular-nums text-xs font-semibold text-muted">
              {formatAudioClock(playingTimeSeconds)}
            </span>
            <button
              type="button"
              onClick={() => setPlaybackToggleNonce((v) => v + 1)}
              className="self-center flex h-11 w-11 items-center justify-center rounded-full bg-accent/90 text-white dark:text-deep cursor-pointer"
              aria-label="Pause"
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="currentColor"
                aria-hidden
              >
                <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() =>
              isSelected
                ? setPlaybackToggleNonce((v) => v + 1)
                : setNowPlaying({
                    url: m.audioUrl,
                    title: m.title,
                    s3Key: m.s3Key,
                  })
            }
            className={
              alwaysShowRowChrome
                ? "flex self-center h-11 w-11 items-center justify-center rounded-full bg-accent/90 text-white dark:text-deep cursor-pointer opacity-100 pointer-events-auto transition-opacity"
                : "flex self-center h-11 w-11 items-center justify-center rounded-full bg-accent/90 text-white dark:text-deep cursor-pointer opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto"
            }
            aria-label="Play"
          >
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="currentColor"
              aria-hidden
            >
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
          </button>
        )}
      </div>
    );

    const scriptBlock =
      open && m.scriptText ? (
        <div className="max-h-64 overflow-y-auto rounded-xl border border-border bg-background/80 p-3">
          <ChatMarkdown
            text={stripPauseMarkers(m.scriptText)}
            className="font-serif text-[13px] leading-relaxed text-foreground/95"
          />
          {m.scriptTruncated ? (
            <p className="mt-2 text-xs text-muted">
              Script was truncated for storage.
            </p>
          ) : null}
        </div>
      ) : null;

    if (viewMode === "grid") {
      return (
        <li
          key={m.s3Key}
          ref={(el) => {
            if (el) itemElsRef.current.set(m.s3Key, el);
            else itemElsRef.current.delete(m.s3Key);
          }}
          className={`group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card p-5 shadow-sm ${
            isPlaying
              ? "border-accent"
              : "border-border hover:border-accent/80 transition-colors"
          }`}
        >
          {isPlaying ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-accent"
              style={
                accentRgb
                  ? {
                      animation: "borderAccentColorPulse 1.2s ease-in-out 0s 2",
                      borderColor: `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},0.35)`,
                    }
                  : undefined
              }
            />
          ) : null}
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-accent">
              {styleLine}
            </p>
          </div>
          <div className="mt-2 flex items-start gap-3">
            <h2 className="font-display text-lg font-medium leading-snug">
              {m.title}
            </h2>
            <span className="mt-1.5 shrink-0 tabular-nums text-xs font-semibold text-muted">
              {lengthLine}
            </span>
          </div>
          <div className="mt-1 text-sm text-muted">
            {m.description ?? "—"}
            {scriptToggleBtn}
          </div>
          <div className="mt-3 flex w-full items-center gap-3 text-xs text-muted">
            <span className="min-w-0 flex-1">
              {formatWhen(m.createdAt)}
              {m.speakerName ? ` · ${m.speakerName}` : ""}
            </span>
            <span className="shrink-0">{archiveBtn}</span>
          </div>
          {scriptBlock ? <div className="mt-4">{scriptBlock}</div> : null}
          <div className="mt-auto flex items-center justify-between gap-3 translate-y-2">
            <div>{stars}</div>
            <div className="flex items-center gap-2">
              {actions}
              {favouriteBtn}
            </div>
          </div>
        </li>
      );
    }

    return (
      <li
        key={m.s3Key}
        className={`group relative min-w-0 overflow-hidden rounded-2xl border bg-card p-4 shadow-sm ${
          isPlaying
            ? "border-accent"
            : "border-border hover:border-accent/80 transition-colors"
        }`}
      >
        {isPlaying ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-accent"
            style={
              accentRgb
                ? {
                    animation: "borderAccentColorPulse 1.2s ease-in-out 0s 2",
                    borderColor: `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},0.35)`,
                  }
                : undefined
            }
          />
        ) : null}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2 gap-y-1">
                <div className="flex items-start gap-3">
                  <h2 className="min-w-0 font-display text-lg font-medium leading-snug">
                    {m.title}
                  </h2>
                  <span className="mt-1.5 shrink-0 tabular-nums text-xs font-semibold text-muted">
                    {lengthLine}
                  </span>
                </div>
                <span className="rounded-full bg-accent-soft/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                  {styleLine}
                </span>
              </div>
            </div>
            <div className="mt-1 text-sm text-muted">
              {m.description ?? "—"}
              {scriptToggleBtn}
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:flex-col lg:items-end xl:flex-col xl:items-end">
            {stars}
            <div className="flex items-center gap-2 lg:self-end">
              {actions}
              {favouriteBtn}
            </div>
          </div>
        </div>
        <div className="mt-2 flex w-full items-center gap-3 text-xs text-muted">
          <span className="min-w-0 flex-1">
            {formatWhen(m.createdAt)}
            {m.speakerName ? ` · ${m.speakerName}` : ""}
          </span>
          <span className="shrink-0">{archiveBtn}</span>
        </div>
        {scriptBlock ? <div className="mt-4 border-t border-border pt-4">{scriptBlock}</div> : null}
      </li>
    );
  }

  return (
    <>
      {indeterminateStyle}
      {accentRgb ? (
        <style>
          {`@keyframes borderAccentColorPulse {
            0% { border-color: rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.35); }
            50% { border-color: rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 1); }
            100% { border-color: rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 1); }
          }`}
        </style>
      ) : null}
    <div
      className={`mx-auto w-full max-w-6xl min-w-0 px-4 py-10 sm:px-6 [scrollbar-gutter:stable] ${
        nowPlaying ? "pb-32 sm:pb-28" : ""
      }`}
    >
      <header className="w-full min-w-0">
        <div className="grid w-full min-w-0 gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
          <div className="min-w-0 w-full">
            <h1 className="font-display text-3xl font-medium tracking-tight">
              Library
            </h1>
            <div
              className="mt-4 inline-flex rounded-xl border border-border bg-background p-1"
              role="tablist"
              aria-label="Library section"
            >
              <button
                type="button"
                role="tab"
                aria-selected={libraryTab === "meditations"}
                onClick={() => setLibraryTab("meditations")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  libraryTab === "meditations"
                    ? "bg-accent text-white dark:text-deep"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Meditations
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={libraryTab === "drafts"}
                onClick={() => setLibraryTab("drafts")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  libraryTab === "drafts"
                    ? "bg-accent text-white dark:text-deep"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Drafts
              </button>
            </div>
            <p className="mt-2 w-full min-w-0 text-muted">
              {libraryTab === "drafts"
                ? "Work in progress from Create. Open a draft to keep editing; it stays here until you generate audio."
                : "Your generated meditations, saved with details from each session. Rate them, and open the script whenever you need the text."}
            </p>
          </div>
          <div className="mt-4 flex w-full items-center justify-between gap-3 sm:col-span-2 sm:row-start-2">
            <div className="flex items-center gap-3">
              {libraryTab === "meditations" ? (
              <button
                type="button"
                onClick={() => setFavouritesOnly((v) => !v)}
                aria-pressed={favouritesOnly}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${
                  favouritesOnly
                    ? "border-accent/60 bg-accent text-white dark:text-deep"
                    : "border-border bg-background text-foreground hover:border-accent/40"
                }`}
              >
                <IconHeart filled={favouritesOnly} />
                <span className="hidden sm:inline">Favourites</span>
              </button>
              ) : null}
              <div ref={sortDropdownRef} className="relative shrink-0">
                <button
                  type="button"
                  ref={sortButtonRef}
                  aria-haspopup="listbox"
                  aria-expanded={sortDropdownOpen}
                  onClick={() => setSortDropdownOpen((v) => !v)}
                  className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground/80 hover:border-accent/40"
                  style={
                    sortButtonWidthPx
                      ? { width: `${sortButtonWidthPx}px` }
                      : undefined
                  }
                >
                  <span className="min-w-0 flex-1 whitespace-nowrap overflow-hidden text-ellipsis">
                    {selectedSortLabel}
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {sortDropdownOpen ? (
                  <div
                    role="listbox"
                    aria-label="Sort library"
                    className="absolute left-0 z-20 mt-2 overflow-hidden rounded-xl border border-border bg-background shadow-lg"
                    style={
                      sortMenuWidthPx
                        ? { width: `${sortMenuWidthPx}px` }
                        : undefined
                    }
                  >
                    {sortItems.map((it) => {
                      const selected = sortBy === it.value;
                      return (
                        <button
                          key={it.value}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            setSortBy(it.value);
                            setSortDropdownOpen(false);
                          }}
                          className={`w-full cursor-pointer px-3 py-2 text-left text-sm font-semibold text-foreground/80 dark:text-foreground/80 ${
                            selected ? "bg-accent/15 cursor-default" : "hover:bg-accent/15 bg-transparent"
                          }`}
                        >
                          {it.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              {libraryTab === "meditations" ? (
              <div ref={categoryDropdownRef} className="relative shrink-0">
                <button
                  type="button"
                  ref={categoryButtonRef}
                  aria-haspopup="listbox"
                  aria-expanded={categoryDropdownOpen}
                  onClick={() => setCategoryDropdownOpen((v) => !v)}
                  className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground hover:border-accent/40"
                  style={
                    categoryButtonWidthPx
                      ? { width: `${categoryButtonWidthPx}px` }
                      : undefined
                  }
                >
                  <span className="min-w-0 flex-1 whitespace-nowrap overflow-hidden text-ellipsis">
                    {selectedCategoryLabel}
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {categoryDropdownOpen ? (
                  <div
                    role="listbox"
                    aria-label="Filter category"
                    className="absolute left-0 z-20 mt-2 overflow-hidden rounded-xl border border-border bg-background shadow-lg"
                    style={
                      categoryMenuWidthPx
                        ? { width: `${categoryMenuWidthPx}px` }
                        : undefined
                    }
                  >
                    {categoryItems.map((it) => {
                      const selected = categoryFilter === it.value;
                      return (
                        <button
                          key={it.value}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            setCategoryFilter(it.value);
                            setCategoryDropdownOpen(false);
                          }}
                          className={`w-full cursor-pointer px-3 py-2 text-left text-sm font-semibold text-black dark:text-foreground ${
                            selected ? "bg-accent/15 cursor-default" : "hover:bg-accent/15 bg-transparent"
                          }`}
                        >
                          {it.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              ) : null}
            </div>
            <div
              className="inline-flex rounded-xl border border-border bg-card p-1"
              role="group"
              aria-label="Library layout"
            >
              <button
                type="button"
                onClick={() => setViewMode("list")}
                aria-pressed={viewMode === "list"}
                className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium ${
                  viewMode === "list"
                    ? "bg-accent text-white dark:text-deep"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <IconList />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                aria-pressed={viewMode === "grid"}
                className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium ${
                  viewMode === "grid"
                    ? "bg-accent text-white dark:text-deep"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <IconGrid />
              </button>
            </div>
          </div>
          <Link
            href="/create"
            className="shrink-0 self-start rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white dark:text-deep sm:mt-0 sm:col-start-2 sm:row-start-1"
          >
            Create new
          </Link>
        </div>
      </header>

      {error ? (
        <p className="mt-6 w-full min-w-0 rounded-xl border border-border bg-card px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {loading && pagedVisibleItems.length === 0 ? (
        <p className="mt-10 text-sm text-muted">Loading…</p>
      ) : pagedVisibleItems.length === 0 ? (
        <p className="mt-10 w-full min-w-0 text-sm text-muted">
          {libraryTab === "drafts"
            ? "No drafts yet. On Create, use Save draft (audio step) to store your session; drafts only show here."
            : favouritesOnly
              ? "No favourite meditations yet."
              : "No meditation audio yet. Generate one from Create — it will appear here after upload."}
        </p>
      ) : (
        <ul
          className={
            viewMode === "grid"
              ? "mt-10 grid w-full min-w-0 max-w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              : "mt-10 flex w-full min-w-0 max-w-full flex-col gap-3"
          }
        >
          {pagedVisibleItems.map((m) => renderItem(m))}
        </ul>
      )}

      {pagination ? (
        <div className="mt-8 flex w-full flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={pagination.current <= 1}
            className="cursor-pointer rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-accent/40 hover:bg-accent-soft/20 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Previous page"
          >
            ←
          </button>

          {pagination.pages[0] && pagination.pages[0] > 1 ? (
            <>
              <button
                type="button"
                onClick={() => setPage(1)}
                className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-semibold shadow-sm transition-colors ${
                  pagination.current === 1
                    ? "border-accent bg-accent-soft/30 text-foreground"
                    : "border-border bg-card text-foreground hover:border-accent/40 hover:bg-accent-soft/20"
                }`}
                aria-label="Page 1"
              >
                1
              </button>
              <span className="px-1 text-sm text-muted">…</span>
            </>
          ) : null}

          {pagination.pages.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-semibold shadow-sm transition-colors ${
                pagination.current === p
                  ? "border-accent bg-accent-soft/30 text-foreground"
                  : "border-border bg-card text-foreground hover:border-accent/40 hover:bg-accent-soft/20"
              }`}
              aria-label={`Page ${p}`}
              aria-current={pagination.current === p ? "page" : undefined}
            >
              {p}
            </button>
          ))}

          {pagination.pages[pagination.pages.length - 1] &&
          pagination.pages[pagination.pages.length - 1] < pagination.totalPages ? (
            <>
              <span className="px-1 text-sm text-muted">…</span>
              <button
                type="button"
                onClick={() => setPage(pagination.totalPages)}
                className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-semibold shadow-sm transition-colors ${
                  pagination.current === pagination.totalPages
                    ? "border-accent bg-accent-soft/30 text-foreground"
                    : "border-border bg-card text-foreground hover:border-accent/40 hover:bg-accent-soft/20"
                }`}
                aria-label={`Page ${pagination.totalPages}`}
              >
                {pagination.totalPages}
              </button>
            </>
          ) : null}

          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            disabled={pagination.current >= pagination.totalPages}
            className="cursor-pointer rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-accent/40 hover:bg-accent-soft/20 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Next page"
          >
            →
          </button>
        </div>
      ) : null}
    </div>
    <LibraryAudioStrip
        key={nowPlaying?.s3Key ?? "none"}
      track={nowPlaying}
      onDismiss={() => setNowPlaying(null)}
        playbackToggleNonce={playbackToggleNonce}
        onPlayingChange={(s3Key, playing) =>
          setPlayingS3Key(playing ? s3Key : null)
        }
        onPlaybackTimeChange={(s3Key, timeSeconds) => {
          if (playingS3KeyRef.current !== s3Key) return;
          setPlayingTimeSeconds(timeSeconds);
        }}
    />

    {archiveConfirm ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 text-sm text-foreground shadow-xl">
          <div className="text-base font-semibold">
            Archive meditation?
          </div>
          <div className="mt-2 text-sm text-muted">
            This will hide it from your Library list.
          </div>
          <div className="mt-2 text-sm text-muted">
            <span className="font-semibold text-foreground">“{archiveConfirm.title}”</span>
          </div>

          <div className="mt-4 flex justify-between gap-2">
            <button
              type="button"
              onClick={() => setArchiveConfirm(null)}
              className="cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold hover:border-accent/40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const sk = archiveConfirm.sk;
                const item = items.find((x) => x.sk === sk);
                setArchiveConfirm(null);
                if (item) void setArchived(item, true);
              }}
              className="cursor-pointer rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 dark:text-deep"
            >
              Archive
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
