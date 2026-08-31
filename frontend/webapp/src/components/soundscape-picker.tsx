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
  /** Single column and tighter cards, for the narrow library mix flyout. */
  compact?: boolean;
};

function PlayPauseIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden>
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden>
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
function useDurations(items: BackgroundAudioItem[], previewUrl: (key: string) => string | null) {
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
}: SoundscapePickerProps) {
  const durations = useDurations(items, previewUrl);
  const sorted = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );

  if (loading) {
    return <p className="px-1 py-6 text-sm text-muted">Loading soundscapes…</p>;
  }
  if (sorted.length === 0) {
    return (
      <p className="px-1 py-6 text-sm text-muted">
        No soundscapes yet. Use Build your own to mix your own bed.
      </p>
    );
  }

  return (
    <div>
      {/* items-start keeps each card at its content height rather than
          stretching it to the tallest card in the grid. */}
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
          const pack = item.subcategory ? prettySubcategoryLabel(item.subcategory) : "";
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
                    {/* Two lines are reserved on every card so titles that wrap
                        don't make the grid ragged. A one-line title is centred
                        in that space so it sits level with the play button. */}
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
          Longer than your meditation? It fades out naturally when the narration ends.
        </p>
      )}
    </div>
  );
}
