"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BackgroundAudioItem } from "@/lib/medimade-api";
import { prettySubcategoryLabel, soundDisplayName } from "@/lib/sound-taxonomy";

type SoundscapePickerProps = {
  items: BackgroundAudioItem[];
  value: string;
  onChange: (key: string) => void;
  /** Null while the media base URL is unknown, which disables previews. */
  previewUrl: (key: string) => string | null;
  playingKey: string | null;
  onTogglePreview: (key: string) => void;
  disabled?: boolean;
  loading?: boolean;
  /** Single column layout (e.g. library / Focus mix flyout). */
  compact?: boolean;
  /** Create › Audio soundscape chrome (category pills + warm cards). */
  variant?: "default" | "create";
  /**
   * When false, cards stay clickable even if `previewUrl` is null
   * (e.g. Focus plays via the app strip instead of in-panel preview).
   */
  requirePreviewUrl?: boolean;
};

function PlayPauseIcon({
  playing,
  size = 18,
}: {
  playing: boolean;
  size?: number;
}) {
  return playing ? (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
    >
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Durations are not in the catalog, so each card asks the CDN for metadata once
 * and the answers are shared across re-renders.
 */
function useDurations(
  items: BackgroundAudioItem[],
  previewUrl: (key: string) => string | null,
) {
  const [durations, setDurations] = useState<Record<string, number>>({});
  const askedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const probes: HTMLAudioElement[] = [];
    for (const item of items) {
      if (askedRef.current.has(item.key)) continue;
      const url = previewUrl(item.key);
      if (!url) continue;
      askedRef.current.add(item.key);
      const probe = new Audio();
      probe.preload = "metadata";
      probe.src = url;
      probe.addEventListener("loadedmetadata", () => {
        if (!Number.isFinite(probe.duration)) return;
        setDurations((prev) => ({ ...prev, [item.key]: probe.duration }));
      });
      probes.push(probe);
    }
    return () => {
      for (const p of probes) p.removeAttribute("src");
    };
  }, [items, previewUrl]);

  return durations;
}

export function SoundscapePicker({
  items,
  value,
  onChange,
  previewUrl,
  playingKey,
  onTogglePreview,
  disabled,
  loading,
  compact,
  variant = "default",
  requirePreviewUrl = true,
}: SoundscapePickerProps) {
  const durations = useDurations(items, previewUrl);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const isCreate = variant === "create";

  const categories = useMemo(() => {
    const ids = new Set<string>();
    for (const item of items) {
      if (item.subcategory) ids.add(item.subcategory);
    }
    return [...ids].sort((a, b) =>
      prettySubcategoryLabel(a).localeCompare(prettySubcategoryLabel(b)),
    );
  }, [items]);

  const sorted = useMemo(() => {
    const list = [...items].sort((a, b) => a.name.localeCompare(b.name));
    if (!isCreate || categoryFilter === "all") return list;
    return list.filter((item) => item.subcategory === categoryFilter);
  }, [items, isCreate, categoryFilter]);

  if (loading) {
    return <p className="px-1 py-6 text-sm text-muted">Loading soundscapes…</p>;
  }
  if (items.length === 0) {
    return (
      <p className="px-1 py-6 text-sm text-muted">
        No soundscapes yet. Use Build your own to mix your own bed.
      </p>
    );
  }

  if (isCreate) {
    return (
      <div>
        {categories.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={categoryFilter === "all"}
              onClick={() => setCategoryFilter("all")}
              className={`cursor-pointer rounded-[20px] border-2 px-3 py-1.5 text-sm transition-colors ${
                categoryFilter === "all"
                  ? "border-accent bg-accent-soft/40 text-foreground"
                  : "border-border bg-card text-foreground hover:border-accent/40"
              }`}
            >
              All
            </button>
            {categories.map((id) => {
              const active = categoryFilter === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCategoryFilter(id)}
                  className={`cursor-pointer rounded-[20px] border-2 px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "border-accent bg-accent-soft/40 text-foreground"
                      : "border-border bg-card text-foreground hover:border-accent/40"
                  }`}
                >
                  {prettySubcategoryLabel(id)}
                </button>
              );
            })}
          </div>
        ) : null}
        {sorted.length === 0 ? (
          <p className="px-1 py-6 text-sm text-muted">
            No soundscapes in this category.
          </p>
        ) : (
          <ul
            className={
              compact
                ? "grid grid-cols-1 items-start gap-2"
                : "grid grid-cols-1 items-start gap-2 sm:grid-cols-2 lg:grid-cols-3"
            }
          >
            {sorted.map((item) => {
              const selected = item.key === value;
              const playing = playingKey === item.key;
              const title = soundDisplayName(item.name);
              const pack = item.subcategory
                ? prettySubcategoryLabel(item.subcategory)
                : "";
              const canPreview = Boolean(previewUrl(item.key));
              const canSelect = !requirePreviewUrl || canPreview;
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    disabled={disabled || !canSelect}
                    aria-pressed={selected}
                    aria-label={
                      playing
                        ? `Pause and keep ${title} selected`
                        : `Select and play ${title}`
                    }
                    onClick={() => {
                      if (value !== item.key) onChange(item.key);
                      onTogglePreview(item.key);
                    }}
                    className={`flex w-full items-center gap-3 rounded-[6px] border-2 px-4 py-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      selected
                        ? "border-accent bg-card"
                        : "border-border bg-card hover:border-accent/40"
                    }`}
                  >
                    <span
                      className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full transition-colors ${
                        selected
                          ? "bg-accent-button text-on-accent"
                          : "bg-accent/20 text-accent-link"
                      }`}
                      aria-hidden
                    >
                      <PlayPauseIcon playing={playing} size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-[15px] font-normal text-foreground">
                        {title}
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                        {pack ? (
                          <span className="rounded-[8px] bg-accent-soft/50 px-1.5 py-0.5 text-accent-link">
                            {pack}
                          </span>
                        ) : (
                          <span />
                        )}
                        <span className="shrink-0 tabular-nums">
                          {formatDuration(durations[item.key] ?? null)}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className={`mt-3 px-1 text-xs text-muted ${compact ? "hidden" : ""}`}>
          Longer than your meditation? It fades out naturally when the narration
          ends.
        </p>
      </div>
    );
  }

  return (
    <div>
      <ul
        className={
          compact
            ? "grid grid-cols-1 items-start gap-2"
            : "grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {sorted.map((item) => {
          const selected = item.key === value;
          const playing = playingKey === item.key;
          const title = soundDisplayName(item.name);
          const pack = item.subcategory
            ? prettySubcategoryLabel(item.subcategory)
            : "";
          return (
            <li key={item.key}>
              <div
                className={`flex flex-col gap-2 rounded-2xl bg-card shadow-sm transition-colors ${
                  compact ? "p-2.5" : "p-4"
                } ${
                  selected
                    ? "border-2 border-accent"
                    : "border border-border hover:border-accent/50"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    disabled={disabled || !previewUrl(item.key)}
                    onClick={() => onTogglePreview(item.key)}
                    aria-label={playing ? `Pause ${title}` : `Play ${title}`}
                    className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-accent-link transition-colors hover:bg-accent-soft/40 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <PlayPauseIcon playing={playing} />
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(selected ? "" : item.key)}
                    aria-pressed={selected}
                    className="flex min-h-[2.6em] min-w-0 flex-1 cursor-pointer items-center text-left disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="line-clamp-2 font-display text-[15px] font-medium leading-[1.3] text-foreground">
                      {title}
                    </span>
                  </button>
                </div>
                <div className="flex items-baseline justify-between gap-2 text-xs text-muted">
                  <span className="min-w-0 truncate">{pack}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatDuration(durations[item.key] ?? null)}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {compact ? null : (
        <p className="mt-3 px-1 text-xs text-muted">
          Longer than your meditation? It fades out naturally when the narration
          ends.
        </p>
      )}
    </div>
  );
}
