"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LibraryMeditationItem,
  listLibraryMeditations,
  patchMeditationFavourite,
  patchMeditationRating,
} from "@/lib/medimade-api";
import { ChatMarkdown } from "@/components/chat-markdown";

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
}: {
  filled: boolean;
  className?: string;
}) {
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

type ActiveTrack = { url: string; title: string; s3Key: string };

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

function LibraryAudioStrip({
  track,
  onDismiss,
}: {
  track: ActiveTrack | null;
  onDismiss: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const seekingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!track) return;
    setCurrent(0);
    setDuration(0);
    setPlaying(false);
    seekingRef.current = false;
    const el = audioRef.current;
    if (!el) return;
    el.load();
    void el.play().catch(() => {
      setPlaying(false);
    });
  }, [track?.s3Key, track?.url]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !track) return;

    const onTime = () => {
      if (!seekingRef.current) setCurrent(el.currentTime);
    };
    const syncDuration = () => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);

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
  }, [track]);

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

export default function LibraryView() {
  const [items, setItems] = useState<LibraryMeditationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSk, setExpandedSk] = useState<string | null>(null);
  const [ratingBusy, setRatingBusy] = useState<string | null>(null);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [favouriteBusySk, setFavouriteBusySk] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [nowPlaying, setNowPlaying] = useState<ActiveTrack | null>(null);

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

  const visibleItems = useMemo(() => {
    const catalogued = sortedItems.filter((x) => x.catalogued);
    return favouritesOnly ? catalogued.filter((x) => x.favourite) : catalogued;
  }, [sortedItems, favouritesOnly]);

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
    void load();
  }, [load]);

  async function setRating(item: LibraryMeditationItem, rating: number | null) {
    if (!item.sk) return;
    setRatingBusy(item.sk);
    try {
      await patchMeditationRating(item.sk, rating);
      setItems((prev) =>
        prev.map((x) =>
          x.sk === item.sk ? { ...x, rating } : x,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save rating");
    } finally {
      setRatingBusy(null);
    }
  }

  async function setFavourite(
    item: LibraryMeditationItem,
    favourite: boolean,
  ) {
    if (!item.sk) return;
    setFavouriteBusySk(item.sk);
    try {
      await patchMeditationFavourite(item.sk, favourite);
      setItems((prev) =>
        prev.map((x) =>
          x.sk === item.sk ? { ...x, favourite } : x,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save favourite");
    } finally {
      setFavouriteBusySk(null);
    }
  }

  function renderItem(m: LibraryMeditationItem) {
    const open = m.sk != null && expandedSk === m.sk;
    const styleLine = m.meditationStyle || m.meditationType || "—";
    const lengthLine = formatDuration(m.durationSeconds);

    const stars = (
      <div className="flex items-center gap-0.5">
        <span className="mr-1 hidden text-xs text-muted sm:inline">Rate</span>
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
                : "text-muted/40 hover:text-gold/80"
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
        className={`flex h-9 w-9 items-center justify-center rounded-full border bg-background/50 ${
          m.favourite
            ? "border-accent/40 text-accent hover:border-accent/60"
            : "border-border text-muted hover:border-accent/40 hover:text-accent"
        } ${favouriteDisabled ? "cursor-not-allowed opacity-50 hover:text-muted" : ""}`}
      >
        <IconHeart filled={m.favourite} />
      </button>
    );

    const actions = (
      <div className="flex flex-shrink-0 flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            setNowPlaying({
              url: m.audioUrl,
              title: m.title,
              s3Key: m.s3Key,
            })
          }
          className="rounded-xl bg-accent/90 px-4 py-2 text-center text-sm font-medium text-white dark:text-deep"
        >
          Play
        </button>
        {m.scriptText ? (
          <button
            type="button"
            onClick={() =>
              setExpandedSk((v) =>
                v === m.sk ? null : (m.sk ?? null),
              )
            }
            className="rounded-xl border border-border px-3 py-2 text-sm text-muted hover:border-accent/40"
          >
            {open ? "Hide script" : "Script"}
          </button>
        ) : null}
      </div>
    );

    const scriptBlock =
      open && m.scriptText ? (
        <div className="max-h-64 overflow-y-auto rounded-xl border border-border bg-background/80 p-3">
          <ChatMarkdown
            text={m.scriptText}
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
          className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-5 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-accent">
              {styleLine}
            </p>
            {favouriteBtn}
          </div>
          <div className="mt-2 flex items-start gap-3">
            <h2 className="font-display text-lg font-medium leading-snug">
              {m.title}
            </h2>
            <span className="mt-1.5 shrink-0 tabular-nums text-xs font-semibold text-muted">
              {lengthLine}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">{m.description ?? "—"}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>{formatWhen(m.createdAt)}</span>
          </div>
          <div className="mt-4">{stars}</div>
          <div className="mt-4 flex flex-wrap gap-2">{actions}</div>
          {scriptBlock ? <div className="mt-4">{scriptBlock}</div> : null}
        </li>
      );
    }

    return (
      <li
        key={m.s3Key}
        className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm"
      >
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
              {favouriteBtn}
            </div>
            <p className="mt-1 text-sm text-muted">{m.description ?? "—"}</p>
            <p className="mt-2 text-xs text-muted">
              {formatWhen(m.createdAt)}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:flex-col lg:items-end xl:flex-row xl:items-center">
            {stars}
            {actions}
          </div>
        </div>
        {scriptBlock ? <div className="mt-4 border-t border-border pt-4">{scriptBlock}</div> : null}
      </li>
    );
  }

  return (
    <>
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
            <p className="mt-2 w-full min-w-0 text-muted">
              Meditations stored in your media bucket, with metadata from each
              generation. Rate sessions and open the script when you need the text.
            </p>
          </div>
          <div className="mt-4 flex w-full items-center justify-between gap-3 sm:col-span-2 sm:row-start-2">
            <div className="flex items-center gap-3">
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
              <select
                value={sortBy}
                aria-label="Sort library"
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground hover:border-accent/40"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="title">Title (A-Z)</option>
              </select>
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

      {loading ? (
        <p className="mt-10 text-sm text-muted">Loading…</p>
      ) : visibleItems.length === 0 ? (
        <p className="mt-10 w-full min-w-0 text-sm text-muted">
          {favouritesOnly
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
          {visibleItems.map((m) => renderItem(m))}
        </ul>
      )}
    </div>
    <LibraryAudioStrip
      track={nowPlaying}
      onDismiss={() => setNowPlaying(null)}
    />
    </>
  );
}
