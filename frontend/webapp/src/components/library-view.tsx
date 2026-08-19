"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as Switch from "@radix-ui/react-switch";
import { SearchInput } from "@/components/search-input";
import { DrumsLockedWrap } from "@/components/drums-locked-wrap";
import { SoundFolderSelect } from "@/components/sound-folder-select";
import { isMelodicMusicKey } from "@/lib/sound-taxonomy";
import {
  type LibraryMeditationItem,
  libraryMeditationCategoryLabel,
  listLibraryMeditations,
  getMeditationAudioJobStatus,
  getMedimadeMediaBaseUrl,
  listBackgroundAudio,
  patchMeditationFavourite,
  patchMeditationArchived,
  patchMeditationPublic,
  patchMeditationBackgroundMix,
  patchMeditationRating,
  backgroundAudioStreamingKey,
  type BackgroundAudioItem,
} from "@/lib/medimade-api";
import { ChatMarkdown } from "@/components/chat-markdown";
import { useMobileOrTouchChrome } from "@/hooks/use-mobile-or-touch-chrome";
import {
  estimateFishBillableUtf8Bytes,
  fishCostUsdFromBillableBytes,
  formatFishCostUsd,
} from "@/lib/meditation-analytics";
import { communityLibraryAsItems, itemMatchesLibraryCategory } from "@/lib/community-library";
import { CommunityCategoryGrid } from "@/components/community-category-grid";
import { bedElementVolume, BED_VOICE_INTRO_SECONDS } from "@/lib/bed-volume";

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return "—";
  }
  const m = Math.floor(seconds / 60);
  const s = Math.max(0, Math.floor(seconds % 60));
  return `${m}m ${s}s`;
}

function isLocalDevHost(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function fishCostTooltipText(m: LibraryMeditationItem): string | null {
  const est = estimateFishBillableUtf8Bytes({
    scriptUtf8Bytes: m.scriptUtf8Bytes,
    scriptText: m.scriptText,
    title: m.title,
    scriptTruncated: m.scriptTruncated,
  });
  if (!est) return "Fish Audio S2.1 Pro: cost unknown (no script bytes)";
  const usd = fishCostUsdFromBillableBytes(est.bytes);
  const approx = est.approximate ? " ≈" : "";
  return `Fish Audio S2.1 Pro${approx}\n${formatFishCostUsd(usd)} · ${est.bytes.toLocaleString()} UTF-8 bytes\n$15 / million UTF-8 bytes`;
}

function FishCostDevTooltip({ text }: { text: string }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full right-0 z-40 mb-2 hidden max-w-[16.5rem] rounded-lg border border-border bg-background px-2.5 py-1.5 text-left text-[11px] font-medium leading-snug text-foreground shadow-md whitespace-pre-line group-hover:block"
    >
      {text}
    </div>
  );
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

const MS_DAY = 86_400_000;

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function libraryListDateMarker(
  iso: string | null,
  now = new Date(),
): { id: string; label: string } {
  if (!iso) return { id: "unknown", label: "Unknown date" };
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return { id: "unknown", label: "Unknown date" };

  const today = startOfLocalDay(now);
  const day = startOfLocalDay(dt);
  const daysAgo = Math.round((today - day) / MS_DAY);

  if (daysAgo === 0) return { id: "today", label: "Today" };
  if (daysAgo === 1) return { id: "yesterday", label: "Yesterday" };

  const sameYear = dt.getFullYear() === now.getFullYear();
  const sameMonth = sameYear && dt.getMonth() === now.getMonth();
  const prevMonth =
    now.getMonth() === 0
      ? dt.getFullYear() === now.getFullYear() - 1 && dt.getMonth() === 11
      : dt.getFullYear() === now.getFullYear() &&
        dt.getMonth() === now.getMonth() - 1;

  if (daysAgo >= 2 && daysAgo < 7) {
    return {
      id: `day-${day}`,
      label: dt.toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
    };
  }

  if (sameMonth) {
    return {
      id: `day-${day}`,
      label: dt.toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
      }),
    };
  }

  if (prevMonth) return { id: "last-month", label: "Last month" };

  const monthKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  return {
    id: `month-${monthKey}`,
    label: dt.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    }),
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

function mixValuesFromItem(
  m: LibraryMeditationItem,
  source: "current" | "created" | "publisher",
): LibraryMixValues {
  const key = (preferred: string | null | undefined, fallback: string | null | undefined) =>
    backgroundAudioStreamingKey((preferred ?? fallback ?? "").trim());
  const gain = (
    preferred: number | null | undefined,
    fallback: number | null | undefined,
    def: number,
  ) =>
    typeof preferred === "number" && Number.isFinite(preferred)
      ? preferred
      : typeof fallback === "number" && Number.isFinite(fallback)
        ? fallback
        : def;
  if (source === "created") {
    return {
      natureKey: key(m.createdBackgroundNatureKey, m.backgroundNatureKey),
      musicKey: key(m.createdBackgroundMusicKey, m.backgroundMusicKey),
      drumsKey: key(m.createdBackgroundDrumsKey, m.backgroundDrumsKey),
      noiseKey: key(m.createdBackgroundNoiseKey, m.backgroundNoiseKey),
      natureGain: gain(m.createdBackgroundNatureGain, m.backgroundNatureGain, 25),
      musicGain: gain(m.createdBackgroundMusicGain, m.backgroundMusicGain, 50),
      drumsGain: gain(m.createdBackgroundDrumsGain, m.backgroundDrumsGain, 40),
      noiseGain: gain(m.createdBackgroundNoiseGain, m.backgroundNoiseGain, 10),
    };
  }
  if (source === "publisher") {
    return {
      natureKey: key(m.publisherBackgroundNatureKey, m.backgroundNatureKey),
      musicKey: key(m.publisherBackgroundMusicKey, m.backgroundMusicKey),
      drumsKey: key(m.publisherBackgroundDrumsKey, m.backgroundDrumsKey),
      noiseKey: key(m.publisherBackgroundNoiseKey, m.backgroundNoiseKey),
      natureGain: gain(
        m.publisherBackgroundNatureGain,
        m.backgroundNatureGain,
        25,
      ),
      musicGain: gain(m.publisherBackgroundMusicGain, m.backgroundMusicGain, 50),
      drumsGain: gain(m.publisherBackgroundDrumsGain, m.backgroundDrumsGain, 40),
      noiseGain: gain(m.publisherBackgroundNoiseGain, m.backgroundNoiseGain, 10),
    };
  }
  return {
    natureKey: key(m.backgroundNatureKey, ""),
    musicKey: key(m.backgroundMusicKey, ""),
    drumsKey: key(m.backgroundDrumsKey, ""),
    noiseKey: key(m.backgroundNoiseKey, ""),
    natureGain: gain(m.backgroundNatureGain, null, 25),
    musicGain: gain(m.backgroundMusicGain, null, 50),
    drumsGain: gain(m.backgroundDrumsGain, null, 40),
    noiseGain: gain(m.backgroundNoiseGain, null, 10),
  };
}

function IconMixReset({ className }: { className?: string }) {
  return (
    <svg
      className={className}
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
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function IconMixer({ className }: { className?: string }) {
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
      <path d="M4 21V10M4 6V3M12 21v-7M12 8V3M20 21v-5M20 10V3" />
      <circle cx="4" cy="8" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="10" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="20" cy="12" r="2.2" fill="currentColor" stroke="none" />
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
type LibraryMainTab = "meditations" | "community";

type ActiveTrack = {
  url: string;
  title: string;
  s3Key: string;
  liveMix?: boolean;
  natureKey?: string;
  musicKey?: string;
  drumsKey?: string;
  noiseKey?: string;
  natureGain?: number;
  musicGain?: number;
  drumsGain?: number;
  noiseGain?: number;
};

function mediaFileUrl(base: string, key: string): string {
  const b = base.replace(/\/$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${b}/${path}`;
}

function trackFromLibraryItem(m: LibraryMeditationItem): ActiveTrack {
  return {
    url: m.audioUrl,
    title: m.title,
    s3Key: m.s3Key,
    liveMix: m.liveMix === true,
    natureKey: m.backgroundNatureKey ?? "",
    musicKey: m.backgroundMusicKey ?? "",
    drumsKey: m.backgroundDrumsKey ?? "",
    noiseKey: m.backgroundNoiseKey ?? "",
    natureGain: m.backgroundNatureGain ?? 25,
    musicGain: m.backgroundMusicGain ?? 50,
    drumsGain: m.backgroundDrumsGain ?? 40,
    noiseGain: m.backgroundNoiseGain ?? 10,
  };
}

function liveMixTrack(
  m: Pick<LibraryMeditationItem, "audioUrl" | "title" | "s3Key">,
  mix: {
    natureKey: string;
    musicKey: string;
    drumsKey: string;
    noiseKey: string;
    natureGain: number;
    musicGain: number;
    drumsGain: number;
    noiseGain: number;
  },
): ActiveTrack {
  return {
    url: m.audioUrl,
    title: m.title,
    s3Key: m.s3Key,
    liveMix: true,
    natureKey: backgroundAudioStreamingKey(mix.natureKey),
    musicKey: backgroundAudioStreamingKey(mix.musicKey),
    drumsKey: backgroundAudioStreamingKey(mix.drumsKey),
    noiseKey: backgroundAudioStreamingKey(mix.noiseKey),
    natureGain: mix.natureGain,
    musicGain: mix.musicGain,
    drumsGain: mix.drumsGain,
    noiseGain: mix.noiseGain,
  };
}

type LibraryMixValues = {
  natureKey: string;
  musicKey: string;
  drumsKey: string;
  noiseKey: string;
  natureGain: number;
  musicGain: number;
  drumsGain: number;
  noiseGain: number;
};

type BedVolumeChannel = "nature" | "music" | "drums" | "noise";

function mixWithGain(
  mix: LibraryMixValues,
  channel: BedVolumeChannel,
  gain: number,
): LibraryMixValues {
  if (channel === "music") return { ...mix, musicGain: gain };
  if (channel === "nature") return { ...mix, natureGain: gain };
  if (channel === "drums") return { ...mix, drumsGain: gain };
  return { ...mix, noiseGain: gain };
}

function mixWithKey(
  mix: LibraryMixValues,
  channel: BedVolumeChannel,
  key: string,
): LibraryMixValues {
  if (channel === "music") return { ...mix, musicKey: key };
  if (channel === "nature") return { ...mix, natureKey: key };
  if (channel === "drums") return { ...mix, drumsKey: key };
  return { ...mix, noiseKey: key };
}

type LocalMixOverlay = {
  liveMix: true;
  backgroundNatureKey: string | null;
  backgroundMusicKey: string | null;
  backgroundDrumsKey: string | null;
  backgroundNoiseKey: string | null;
  backgroundNatureGain: number;
  backgroundMusicGain: number;
  backgroundDrumsGain: number;
  backgroundNoiseGain: number;
};

function localMixOverlayFromValues(mix: LibraryMixValues): LocalMixOverlay {
  const natureKey = backgroundAudioStreamingKey(mix.natureKey.trim());
  const musicKey = backgroundAudioStreamingKey(mix.musicKey.trim());
  const drumsKey = backgroundAudioStreamingKey(mix.drumsKey.trim());
  const noiseKey = backgroundAudioStreamingKey(mix.noiseKey.trim());
  return {
    liveMix: true,
    backgroundNatureKey: natureKey || null,
    backgroundMusicKey: musicKey || null,
    backgroundDrumsKey: drumsKey || null,
    backgroundNoiseKey: noiseKey || null,
    backgroundNatureGain: mix.natureGain,
    backgroundMusicGain: mix.musicGain,
    backgroundDrumsGain: mix.drumsGain,
    backgroundNoiseGain: mix.noiseGain,
  };
}

function applyLocalMixOverlay(
  list: LibraryMeditationItem[],
  overlays: Map<string, LocalMixOverlay>,
): LibraryMeditationItem[] {
  if (overlays.size === 0) return list;
  return list.map((item) => {
    const overlay =
      (item.sk ? overlays.get(item.sk) : undefined) ?? overlays.get(item.s3Key);
    return overlay ? { ...item, ...overlay } : item;
  });
}

type LibraryBedVolumeApi = {
  setBedVolume: (channel: BedVolumeChannel, gain: number) => void;
};

const MixVerticalFader = memo(function MixVerticalFader({
  label,
  disabled,
  initialGain,
  onLiveChange,
  onCommit,
}: {
  label: string;
  disabled: boolean;
  initialGain: number;
  onLiveChange: (gain: number) => void;
  onCommit: (gain: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const gainRef = useRef(initialGain);
  const liveChangeRef = useRef(onLiveChange);
  const commitRef = useRef(onCommit);
  const draggingRef = useRef(false);

  liveChangeRef.current = onLiveChange;
  commitRef.current = onCommit;

  useEffect(() => {
    if (draggingRef.current) return;
    gainRef.current = initialGain;
    const el = inputRef.current;
    if (el) el.value = String(initialGain);
    if (labelRef.current) labelRef.current.textContent = `${initialGain}%`;
  }, [initialGain]);

  function onInput(e: React.FormEvent<HTMLInputElement>) {
    draggingRef.current = true;
    const v = Number(e.currentTarget.value);
    if (!Number.isFinite(v)) return;
    gainRef.current = v;
    if (labelRef.current) labelRef.current.textContent = `${v}%`;
    liveChangeRef.current(v);
  }

  function commit() {
    draggingRef.current = false;
    liveChangeRef.current(gainRef.current);
    commitRef.current(gainRef.current);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      <span
        ref={labelRef}
        className="tabular-nums text-xs text-muted"
      >
        {initialGain}%
      </span>
      <div className="flex h-36 w-10 items-center justify-center">
        <input
          ref={inputRef}
          type="range"
          min={0}
          max={100}
          defaultValue={initialGain}
          disabled={disabled}
          onInput={onInput}
          onPointerDown={() => {
            draggingRef.current = true;
          }}
          onPointerUp={commit}
          onMouseUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
          className="h-10 w-36 origin-center -rotate-90 cursor-pointer accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`${label} level`}
          aria-orientation="vertical"
        />
      </div>
    </div>
  );
}, (a, b) =>
  a.label === b.label &&
  a.disabled === b.disabled &&
  a.initialGain === b.initialGain);

function LibraryMixEditorModal({
  item,
  anchorEl,
  natureItems,
  musicItems,
  drumsItems,
  noiseItems,
  error,
  resetMix,
  onLiveVolume,
  onPreview,
  onPersist,
  onClose,
  closeRef,
}: {
  item: LibraryMeditationItem;
  anchorEl: HTMLElement | null;
  natureItems: BackgroundAudioItem[];
  musicItems: BackgroundAudioItem[];
  drumsItems: BackgroundAudioItem[];
  noiseItems: BackgroundAudioItem[];
  error: string | null;
  resetMix: LibraryMixValues;
  onLiveVolume: (channel: BedVolumeChannel, gain: number) => void;
  onPreview: (mix: LibraryMixValues) => void;
  onPersist: (mix: LibraryMixValues) => void | Promise<void>;
  onClose: () => void;
  closeRef: { current: (() => void) | null };
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [natureKey, setNatureKey] = useState(
    () => backgroundAudioStreamingKey(item.backgroundNatureKey ?? ""),
  );
  const [musicKey, setMusicKey] = useState(
    () => backgroundAudioStreamingKey(item.backgroundMusicKey ?? ""),
  );
  const [drumsKey, setDrumsKey] = useState(
    () => backgroundAudioStreamingKey(item.backgroundDrumsKey ?? ""),
  );
  const [noiseKey, setNoiseKey] = useState(
    () => backgroundAudioStreamingKey(item.backgroundNoiseKey ?? ""),
  );
  const [natureGain, setNatureGain] = useState(item.backgroundNatureGain ?? 25);
  const [musicGain, setMusicGain] = useState(item.backgroundMusicGain ?? 50);
  const [drumsGain, setDrumsGain] = useState(item.backgroundDrumsGain ?? 40);
  const [noiseGain, setNoiseGain] = useState(item.backgroundNoiseGain ?? 10);
  const mixRef = useRef<LibraryMixValues>({
    natureKey,
    musicKey,
    drumsKey,
    noiseKey,
    natureGain,
    musicGain,
    drumsGain,
    noiseGain,
  });

  mixRef.current = {
    natureKey,
    musicKey,
    drumsKey,
    noiseKey,
    natureGain,
    musicGain,
    drumsGain,
    noiseGain,
  };

  function previewNow(next: LibraryMixValues) {
    onPreview(next);
  }

  function applyResetMix() {
    const next = resetMix;
    setNatureKey(next.natureKey);
    setMusicKey(next.musicKey);
    setDrumsKey(next.drumsKey);
    setNoiseKey(next.noiseKey);
    setNatureGain(next.natureGain);
    setMusicGain(next.musicGain);
    setDrumsGain(next.drumsGain);
    setNoiseGain(next.noiseGain);
    mixRef.current = next;
    previewNow(next);
    void Promise.resolve(onPersist(next)).catch(() => {});
  }

  const closeAndSave = useCallback(() => {
    const mix = mixRef.current;
    void Promise.resolve(onPersist(mix)).catch(() => {});
    onClose();
  }, [onClose, onPersist]);

  closeRef.current = closeAndSave;

  const drumsLockedForMelodic = isMelodicMusicKey(musicItems, musicKey);

  useLayoutEffect(() => {
    function place() {
      const panel = panelRef.current;
      const anchor = anchorEl;
      if (!panel || !anchor) return;
      const a = anchor.getBoundingClientRect();
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      const gap = 8;
      let left = a.right - w;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      let top = a.top - h - gap;
      if (top < 8) top = a.bottom + gap;
      if (top + h > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - h - 8);
      }
      setPos({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorEl, item.sk]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t)) return;
      if (anchorEl?.contains(t)) return;
      closeAndSave();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeAndSave();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorEl, closeAndSave]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Background mix"
      className="fixed z-[80] w-[28rem] overflow-visible rounded-xl border border-border bg-card p-4 text-sm text-foreground shadow-xl"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-foreground">
          {item.title}
        </p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            applyResetMix();
          }}
          className="shrink-0 cursor-pointer rounded-md p-1 text-muted hover:bg-accent-soft/50 hover:text-foreground"
          aria-label="Reset mix to original"
          title="Reset mix to original"
        >
          <IconMixReset />
        </button>
      </div>
      <div className="mt-3 flex items-end justify-center gap-3">
        {(
          [
            {
              label: "Music",
              key: musicKey,
              setKey: setMusicKey,
              gain: musicGain,
              setGain: setMusicGain,
              items: musicItems,
              category: "music" as const,
              channel: "music" as const,
            },
            {
              label: "Ambience",
              key: natureKey,
              setKey: setNatureKey,
              gain: natureGain,
              setGain: setNatureGain,
              items: natureItems,
              category: "ambience" as const,
              channel: "nature" as const,
            },
            {
              label: "Drums",
              key: drumsKey,
              setKey: setDrumsKey,
              gain: drumsGain,
              setGain: setDrumsGain,
              items: drumsItems,
              category: "drums" as const,
              channel: "drums" as const,
            },
            {
              label: "Noise",
              key: noiseKey,
              setKey: setNoiseKey,
              gain: noiseGain,
              setGain: setNoiseGain,
              items: noiseItems,
              category: "noise" as const,
              channel: "noise" as const,
            },
          ] as const
        ).map((row) => {
          const drumsLocked = row.channel === "drums" && drumsLockedForMelodic;
          return (
          <DrumsLockedWrap
            key={row.label}
            locked={drumsLocked}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
          >
            <MixVerticalFader
              label={row.label}
              disabled={!row.key || drumsLocked}
              initialGain={row.gain}
              onLiveChange={(gain) => {
                mixRef.current = mixWithGain(mixRef.current, row.channel, gain);
                onLiveVolume(row.channel, gain);
              }}
              onCommit={(gain) => {
                const next = mixWithGain(mixRef.current, row.channel, gain);
                row.setGain(gain);
                mixRef.current = next;
                previewNow(next);
              }}
            />
            <SoundFolderSelect
              category={row.category}
              items={row.items}
              value={row.key}
              compact
              disabled={drumsLocked}
              onChange={(value) => {
                row.setKey(value);
                const next = mixWithKey(mixRef.current, row.channel, value);
                mixRef.current = next;
                previewNow(next);
              }}
            />
          </DrumsLockedWrap>
          );
        })}
      </div>
      {error ? (
        <p className="mt-2 text-xs text-danger">{error}</p>
      ) : null}
    </div>
  );
}

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

function librarySearchTokens(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

function libraryRowSearchHaystack(m: LibraryRow): string {
  if (isPendingRow(m)) {
    return [m.title, m.description, m.meditationStyle]
      .filter((x): x is string => Boolean(x && x.trim()))
      .join(" ")
      .toLowerCase();
  }
  return [
    m.title,
    m.description,
    m.meditationType,
    m.meditationStyle,
    libraryMeditationCategoryLabel(m),
  ]
    .filter((x): x is string => Boolean(x && x.trim() && x !== "—"))
    .join(" ")
    .toLowerCase();
}

function libraryRowMatchesSearch(m: LibraryRow, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = libraryRowSearchHaystack(m);
  return tokens.every((t) => hay.includes(t));
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
  // Remove library script-only pause markers: `[[PAUSE medium]]`, etc.
  return text.replace(/\[\[PAUSE\s+[^\]]+\]\]/g, "");
}

function LibraryAudioStrip({
  track,
  musicItems,
  onDismiss,
  playbackToggleNonce,
  elevated = false,
  bedVolumeApiRef,
  onPlayingChange,
  onPlaybackTimeChange,
}: {
  track: ActiveTrack | null;
  musicItems: BackgroundAudioItem[];
  onDismiss: () => void;
  playbackToggleNonce: number;
  elevated?: boolean;
  bedVolumeApiRef?: { current: LibraryBedVolumeApi | null };
  onPlayingChange?: (s3Key: string, playing: boolean) => void;
  onPlaybackTimeChange?: (s3Key: string, timeSeconds: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const natureRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const drumsRef = useRef<HTMLAudioElement>(null);
  const noiseRef = useRef<HTMLAudioElement>(null);
  const seekingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const lastToggleNonceRef = useRef(playbackToggleNonce);
  const lastReportedTimeRef = useRef<number>(-Infinity);
  const voiceIntroTimerRef = useRef<number | null>(null);
  const liveBedGainsRef = useRef({
    nature: track?.natureGain ?? 0,
    music: track?.musicGain ?? 0,
    drums: track?.drumsGain ?? 0,
    noise: track?.noiseGain ?? 0,
  });
  const mediaBase = getMedimadeMediaBaseUrl();

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

  function trackHasLiveBeds(): boolean {
    if (!track?.liveMix) return false;
    if ((track.natureKey ?? "").trim()) return true;
    if ((track.musicKey ?? "").trim()) return true;
    if ((track.noiseKey ?? "").trim()) return true;
    const drums = (track.drumsKey ?? "").trim();
    if (!drums) return false;
    return !isMelodicMusicKey(musicItems, track.musicKey ?? "");
  }

  function clearVoiceIntro() {
    if (voiceIntroTimerRef.current != null) {
      window.clearTimeout(voiceIntroTimerRef.current);
      voiceIntroTimerRef.current = null;
    }
  }

  function shouldDelayVoice(atSeconds: number): boolean {
    return trackHasLiveBeds() && atSeconds < 0.08;
  }

  function startOrResumePlayback() {
    const el = audioRef.current;
    if (!el || !track) return;
    clearVoiceIntro();
    if (shouldDelayVoice(el.currentTime)) {
      setPlaying(true);
      onPlayingChange?.(track.s3Key, true);
      voiceIntroTimerRef.current = window.setTimeout(() => {
        voiceIntroTimerRef.current = null;
        void el.play().catch(() => {});
      }, BED_VOICE_INTRO_SECONDS * 1000);
      return;
    }
    void el.play().catch(() => {});
  }

  function pausePlayback() {
    clearVoiceIntro();
    audioRef.current?.pause();
    if (track) onPlayingChange?.(track.s3Key, false);
    setPlaying(false);
  }

  function togglePlayback() {
    const el = audioRef.current;
    if (!el) return;
    if (playing || voiceIntroTimerRef.current != null) pausePlayback();
    else startOrResumePlayback();
  }

  useEffect(() => {
    liveBedGainsRef.current = {
      nature: track?.natureGain ?? 0,
      music: track?.musicGain ?? 0,
      drums: track?.drumsGain ?? 0,
      noise: track?.noiseGain ?? 0,
    };
  }, [track?.natureGain, track?.musicGain, track?.drumsGain, track?.noiseGain]);

  useEffect(() => {
    if (!bedVolumeApiRef) return;
    bedVolumeApiRef.current = {
      setBedVolume(channel, gain) {
        liveBedGainsRef.current[channel] = gain;
        const el =
          channel === "nature"
            ? natureRef.current
            : channel === "music"
              ? musicRef.current
              : channel === "drums"
                ? drumsRef.current
                : noiseRef.current;
        if (el) el.volume = bedElementVolume(gain);
      },
    };
    return () => {
      bedVolumeApiRef.current = null;
    };
  }, [bedVolumeApiRef]);

  useEffect(() => {
    if (!track) return;
    seekingRef.current = false;
    lastReportedTimeRef.current = -Infinity;
    const el = audioRef.current;
    if (!el) return;
    el.load();
    startOrResumePlayback();
    return () => {
      clearVoiceIntro();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart when the stem changes
  }, [track?.s3Key, track?.url]);

  useEffect(() => {
    const beds: Array<{
      channel: BedVolumeChannel;
      el: HTMLAudioElement | null;
      key: string;
    }> = [
      {
        channel: "nature",
        el: natureRef.current,
        key: track?.liveMix ? track.natureKey ?? "" : "",
      },
      {
        channel: "music",
        el: musicRef.current,
        key: track?.liveMix ? track.musicKey ?? "" : "",
      },
      {
        channel: "drums",
        el: drumsRef.current,
        key: track?.liveMix
          ? isMelodicMusicKey(musicItems, track.musicKey ?? "")
            ? ""
            : track.drumsKey ?? ""
          : "",
      },
      {
        channel: "noise",
        el: noiseRef.current,
        key: track?.liveMix ? track.noiseKey ?? "" : "",
      },
    ];
    for (const bed of beds) {
      const el = bed.el;
      if (!el) continue;
      el.loop = true;
      el.volume = bedElementVolume(liveBedGainsRef.current[bed.channel]);
      if (!mediaBase || !bed.key.trim()) {
        el.pause();
        if (el.getAttribute("src")) {
          el.removeAttribute("src");
          el.load();
        }
        continue;
      }
      const next = mediaFileUrl(mediaBase, backgroundAudioStreamingKey(bed.key));
      if (el.src !== next) {
        el.src = next;
        el.load();
      }
      if (playing) void el.play().catch(() => {});
      else el.pause();
    }
  }, [
    track?.liveMix,
    track?.natureKey,
    track?.musicKey,
    track?.drumsKey,
    track?.noiseKey,
    track?.natureGain,
    track?.musicGain,
    track?.drumsGain,
    track?.noiseGain,
    playing,
    mediaBase,
    musicItems,
  ]);

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
    if (!playing && voiceIntroTimerRef.current == null) return;
    clearVoiceIntro();
    if (shouldDelayVoice(next)) {
      el.pause();
      startOrResumePlayback();
    } else if (el.paused) {
      void el.play().catch(() => {});
    }
  }

  return (
    <div
      className={`fixed inset-x-0 bottom-0 border-t border-border bg-card/95 px-3 py-3 shadow-[0_-8px_24px_color-mix(in_srgb,var(--overlay)_8%,transparent)] backdrop-blur-md dark:bg-card/98 dark:shadow-[0_-8px_24px_color-mix(in_srgb,var(--overlay)_35%,transparent)] sm:px-4 ${
        elevated ? "z-[70]" : "z-50"
      }`}
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
      <audio ref={natureRef} className="hidden" loop playsInline />
      <audio ref={musicRef} className="hidden" loop playsInline />
      <audio ref={drumsRef} className="hidden" loop playsInline />
      <audio ref={noiseRef} className="hidden" loop playsInline />

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
                onClick={() => togglePlayback()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent"
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
                  if (!el || !Number.isFinite(v)) return;
                  el.currentTime = v;
                  setCurrent(v);
                  reportTime(v);
                  if (!playing && voiceIntroTimerRef.current == null) return;
                  clearVoiceIntro();
                  if (shouldDelayVoice(v)) {
                    el.pause();
                    startOrResumePlayback();
                  } else if (el.paused) {
                    void el.play().catch(() => {});
                  }
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
              pausePlayback();
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
  const [communityRemote, setCommunityRemote] = useState<
    LibraryMeditationItem[]
  >([]);
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
  const [mixEditor, setMixEditor] = useState<LibraryMeditationItem | null>(null);
  const mixEditorRef = useRef<LibraryMeditationItem | null>(null);
  mixEditorRef.current = mixEditor;
  const localMixByKeyRef = useRef(new Map<string, LocalMixOverlay>());
  const [mixError, setMixError] = useState<string | null>(null);
  const [mixAnchorEl, setMixAnchorEl] = useState<HTMLElement | null>(null);
  const mixCloseRef = useRef<(() => void) | null>(null);
  const [mixNature, setMixNature] = useState<BackgroundAudioItem[]>([]);
  const [mixMusic, setMixMusic] = useState<BackgroundAudioItem[]>([]);
  const [mixDrums, setMixDrums] = useState<BackgroundAudioItem[]>([]);
  const [mixNoise, setMixNoise] = useState<BackgroundAudioItem[]>([]);
  const bedVolumeApiRef = useRef<LibraryBedVolumeApi | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [searchQuery, setSearchQuery] = useState("");
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
  const [showFishCostTooltip, setShowFishCostTooltip] = useState(false);

  const itemElsRef = useRef<Map<string, HTMLLIElement>>(new Map());
  const focusHandledRef = useRef(false);

  // Keep a stable ref for throttled `timeupdate` callbacks.
  playingS3KeyRef.current = playingS3Key;

  useEffect(() => {
    setShowFishCostTooltip(isLocalDevHost());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listBackgroundAudio()
      .then((data) => {
        if (cancelled) return;
        setMixNature(data.nature ?? []);
        setMixMusic(data.music ?? []);
        setMixDrums(data.drums ?? []);
        setMixNoise(data.noise ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setMixNature([]);
        setMixMusic([]);
        setMixDrums([]);
        setMixNoise([]);
      });
    return () => {
      cancelled = true;
    };
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

  const communityItems = useMemo(() => {
    const byKey = new Map<string, LibraryMeditationItem>();
    for (const x of communityRemote) {
      if (x.s3Key) byKey.set(x.s3Key, x);
    }
    for (const x of communityLibraryAsItems()) {
      if (x.s3Key && !byKey.has(x.s3Key)) byKey.set(x.s3Key, x);
    }
    return [...byKey.values()];
  }, [communityRemote]);

  const sortedCommunityItems = useMemo(() => {
    const next = [...communityItems];
    if (sortBy === "title") {
      next.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    } else if (sortBy === "oldest") {
      next.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
    } else {
      next.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    }
    return next;
  }, [communityItems, sortBy]);

  const libraryRows: LibraryRow[] = useMemo(() => {
    if (libraryTab === "community") return sortedCommunityItems;
    return [...pendingRows, ...sortedItems];
  }, [libraryTab, pendingRows, sortedItems, sortedCommunityItems]);

  const visibleItems: LibraryRow[] = useMemo(() => {
    const tokens = librarySearchTokens(searchQuery);
    if (libraryTab === "community") {
      const list =
        categoryFilter === "all"
          ? sortedCommunityItems
          : sortedCommunityItems.filter((x) =>
              itemMatchesLibraryCategory(x, categoryFilter),
            );
      return list.filter((x) => libraryRowMatchesSearch(x, tokens));
    }
    const base = sortedItems.filter(
      (x) => x.catalogued && x.archived !== true && x.isDraft !== true,
    );
    const afterFav = favouritesOnly ? base.filter((x) => x.favourite) : base;
    const afterCat =
      categoryFilter === "all"
        ? afterFav
        : afterFav.filter(
            (x) => libraryMeditationCategoryLabel(x) === categoryFilter,
          );
    return [...pendingRows, ...afterCat].filter((x) =>
      libraryRowMatchesSearch(x, tokens),
    );
  }, [
    sortedItems,
    sortedCommunityItems,
    favouritesOnly,
    categoryFilter,
    libraryTab,
    pendingRows,
    searchQuery,
  ]);

  useEffect(() => {
    // When the user changes filters/sort/tabs, reset pagination so they don't land mid-list.
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, favouritesOnly, categoryFilter, libraryTab, searchQuery]);

  useEffect(() => {
    setCategoryFilter("all");
    setFavouritesOnly(false);
  }, [libraryTab]);

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
    const base =
      libraryTab === "community"
        ? sortedCommunityItems
        : sortedItems.filter((x) => x.catalogued);
    const afterFav =
      libraryTab === "community" || !favouritesOnly
        ? base
        : base.filter((x) => x.favourite);
    const counts: Record<string, number> = {};
    for (const x of afterFav) {
      const key = libraryMeditationCategoryLabel(x);
      if (!key || key === "—") continue;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  }, [sortedItems, sortedCommunityItems, favouritesOnly, libraryTab]);

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
      const [list, community] = await Promise.all([
        listLibraryMeditations(),
        listLibraryMeditations({ community: true }),
      ]);
      setItems(applyLocalMixOverlay(list, localMixByKeyRef.current));
      setCommunityRemote(applyLocalMixOverlay(community, localMixByKeyRef.current));
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
    const on = () => void load();
    window.addEventListener("medimade-session-changed", on);
    return () => window.removeEventListener("medimade-session-changed", on);
  }, [load]);

  useEffect(() => {
    setPending(loadPendingGenerations());
  }, []);

  function removePendingJob(jobId: string) {
    const id = jobId.trim();
    if (!id) return;
    const current = loadPendingGenerations();
    const next = current.filter((p) => p.jobId !== id);
    savePendingGenerations(next);
    setPending(next);
  }

  // Keep local pending generations in sync + poll status.
  useEffect(() => {
    if (pending.length === 0) return;

    let cancelled = false;
    const STALE_PENDING_MS = 1000 * 60 * 60 * 12; // 12h
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
          const createdMs = Date.parse(p.createdAt ?? "");
          const stale =
            Number.isFinite(createdMs) &&
            Date.now() - createdMs > STALE_PENDING_MS;
          if (stale) {
            changed = true;
            next.push({
              ...nextP,
              status: "failed",
              error:
                "This has been generating for a long time. Please try again from Create.",
            });
            continue;
          }
          next.push({
            ...nextP,
            status: st.status === "running" ? "running" : "pending",
          });
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

    // Ensure we show the meditations tab for a generated audio key.
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
        setNowPlaying(trackFromLibraryItem(found));
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
    setNowPlaying(trackFromLibraryItem(found));
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

  async function setPublic(item: LibraryMeditationItem, isPublic: boolean) {
    if (!item.sk) return;
    const sk = item.sk;
    const prev = item.isPublic === true;
    const nextItem = { ...item, isPublic };
    setItems((prevItems) =>
      prevItems.map((x) => (x.sk === sk ? { ...x, isPublic } : x)),
    );
    setCommunityRemote((prevList) => {
      if (isPublic) {
        if (prevList.some((x) => x.sk === sk || x.s3Key === item.s3Key)) {
          return prevList.map((x) =>
            x.sk === sk || x.s3Key === item.s3Key ? { ...x, isPublic } : x,
          );
        }
        return [nextItem, ...prevList];
      }
      return prevList.filter((x) => x.sk !== sk && x.s3Key !== item.s3Key);
    });
    try {
      await patchMeditationPublic(sk, isPublic);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update public");
      setItems((prevItems) =>
        prevItems.map((x) => (x.sk === sk ? { ...x, isPublic: prev } : x)),
      );
      setCommunityRemote((prevList) => {
        if (prev) {
          if (prevList.some((x) => x.sk === sk || x.s3Key === item.s3Key)) {
            return prevList.map((x) =>
              x.sk === sk || x.s3Key === item.s3Key
                ? { ...x, isPublic: true }
                : x,
            );
          }
          return [{ ...item, isPublic: true }, ...prevList];
        }
        return prevList.filter((x) => x.sk !== sk && x.s3Key !== item.s3Key);
      });
    }
  }

  function openMixEditor(m: LibraryMeditationItem) {
    if (!m.sk || m.liveMix !== true) return;
    setMixEditor(m);
    setMixError(null);
    const natureKey = backgroundAudioStreamingKey(m.backgroundNatureKey ?? "");
    const musicKey = backgroundAudioStreamingKey(m.backgroundMusicKey ?? "");
    const drumsKey = backgroundAudioStreamingKey(m.backgroundDrumsKey ?? "");
    const noiseKey = backgroundAudioStreamingKey(m.backgroundNoiseKey ?? "");
    const natureGain = m.backgroundNatureGain ?? 25;
    const musicGain = m.backgroundMusicGain ?? 50;
    const drumsGain = m.backgroundDrumsGain ?? 40;
    const noiseGain = m.backgroundNoiseGain ?? 10;
    setNowPlaying((p) => {
      if (!p || p.s3Key !== m.s3Key) return p;
      return liveMixTrack(m, {
        natureKey,
        musicKey,
        drumsKey,
        noiseKey,
        natureGain,
        musicGain,
        drumsGain,
        noiseGain,
      });
    });
  }

  function applyMixPreview(mix: LibraryMixValues) {
    const item = mixEditor;
    if (!item) return;
    setNowPlaying((p) => {
      if (!p || p.s3Key !== item.s3Key) return p;
      return {
        ...p,
        ...liveMixTrack(item, mix),
      };
    });
  }

  async function persistMix(mix: LibraryMixValues) {
    const item = mixEditorRef.current;
    if (!item?.sk) return;
    const sk = item.sk;
    const overlay = localMixOverlayFromValues(mix);
    localMixByKeyRef.current.set(sk, overlay);
    localMixByKeyRef.current.set(item.s3Key, overlay);
    if (libraryTab === "community") {
      setCommunityRemote((prev) =>
        prev.map((x) =>
          x.sk === sk || x.s3Key === item.s3Key ? { ...x, ...overlay } : x,
        ),
      );
    } else {
      setItems((prev) =>
        prev.map((x) => (x.sk === sk ? { ...x, ...overlay } : x)),
      );
    }
    setMixEditor((cur) => (cur?.sk === sk ? { ...cur, ...overlay } : cur));
    setNowPlaying((p) =>
      p && p.s3Key === item.s3Key
        ? liveMixTrack(item, {
            natureKey: overlay.backgroundNatureKey ?? "",
            musicKey: overlay.backgroundMusicKey ?? "",
            drumsKey: overlay.backgroundDrumsKey ?? "",
            noiseKey: overlay.backgroundNoiseKey ?? "",
            natureGain: overlay.backgroundNatureGain,
            musicGain: overlay.backgroundMusicGain,
            drumsGain: overlay.backgroundDrumsGain,
            noiseGain: overlay.backgroundNoiseGain,
          })
        : p,
    );
    setMixError(null);
    try {
      await patchMeditationBackgroundMix(
        sk,
        {
          backgroundNatureKey: overlay.backgroundNatureKey ?? "",
          backgroundMusicKey: overlay.backgroundMusicKey ?? "",
          backgroundDrumsKey: overlay.backgroundDrumsKey ?? "",
          backgroundNoiseKey: overlay.backgroundNoiseKey ?? "",
          backgroundNatureGain: overlay.backgroundNatureGain,
          backgroundMusicGain: overlay.backgroundMusicGain,
          backgroundDrumsGain: overlay.backgroundDrumsGain,
          backgroundNoiseGain: overlay.backgroundNoiseGain,
        },
        libraryTab === "community"
          ? { community: true, s3Key: item.s3Key }
          : undefined,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save mix";
      setMixError(msg);
      setError(msg);
      throw e;
    }
  }

  function closeMixEditor() {
    setMixEditor(null);
    setMixAnchorEl(null);
    setMixError(null);
  }
  function renderItem(m: LibraryRow) {
    if (isPendingRow(m)) {
      const isFailed = m.status === "failed";
      const spinner = (
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
      );
      const failIcon = (
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      );
      return (
        <li
          key={m.pendingKey}
          ref={(el) => {
            if (el) itemElsRef.current.set(m.pendingKey, el);
            else itemElsRef.current.delete(m.pendingKey);
          }}
          className={`relative min-w-0 overflow-hidden rounded-2xl border p-4 shadow-sm ${
            isFailed
              ? "border-danger/35 bg-danger/5"
              : "border-accent/35 bg-accent-soft/20"
          }`}
        >
          {!isFailed ? (
            <>
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
            </>
          ) : null}
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-medium leading-snug">
                {m.title}
              </h2>
              <p className="mt-1 text-sm text-muted">{m.description ?? "—"}</p>
              {isFailed ? (
                <p className="mt-2 text-sm text-danger">
                  {m.error ?? "Generation failed."}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-muted">
                {formatWhen(m.createdAt)}
                {m.speakerName ? ` · ${m.speakerName}` : ""}
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-full ${
                  isFailed
                    ? "bg-danger/10 text-danger"
                    : "bg-selected/10 text-selected"
                }`}
                aria-label={isFailed ? "Generation failed" : "Generating"}
                title={isFailed ? "Generation failed" : "Generating"}
              >
                {isFailed ? failIcon : spinner}
              </div>
              <button
                type="button"
                onClick={() => removePendingJob(m.jobId)}
                className="cursor-pointer rounded-full border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-accent/35 hover:bg-accent-soft/20"
              >
                Remove
              </button>
            </div>
          </div>
        </li>
      );
    }
    // From here, `m` is a real library item.
    if (m.isDraft === true) {
      const href =
        m.sk != null
          ? `/meditate/create?draftSk=${encodeURIComponent(m.sk)}`
          : "/meditate/create";
      const continueBtn = (
        <Link
          href={href}
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent shadow-sm transition-opacity hover:opacity-90"
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
              <span className="inline-block rounded-full border border-border bg-accent-soft/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-link">
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
    const styleLine = libraryMeditationCategoryLabel(m);
    const lengthLine = formatDuration(m.durationSeconds);
    const fishCostText = showFishCostTooltip ? fishCostTooltipText(m) : null;

    const isCommunity = libraryTab === "community";
    const stars = isCommunity ? null : (
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
                ? "text-accent"
                : "text-star-idle"
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
    const favouriteBtn = isCommunity ? null : (
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
          m.favourite ? "text-selected" : "text-muted"
        } ${
          favouriteDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        }`}
      >
        <IconHeart filled={m.favourite} strokeWidth={2.5} />
      </button>
    );

    const canEditMix = m.liveMix === true && Boolean(m.sk) && !m.isDraft;
    const mixerBtn = canEditMix ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (mixEditor?.sk === m.sk) {
            mixCloseRef.current?.();
            return;
          }
          setMixAnchorEl(e.currentTarget);
          openMixEditor(m);
        }}
        aria-expanded={mixEditor?.sk === m.sk}
        aria-label="Edit background mix"
        className={`self-center items-center justify-center p-1 text-muted transition-opacity ${
          alwaysShowRowChrome || mixEditor?.sk === m.sk
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
        } cursor-pointer`}
      >
        <IconMixer />
      </button>
    ) : null;

    const archiveDisabled =
      !m.sk || archiveBusySk === m.sk || ratingBusy === m.sk || favouriteBusySk === m.sk;
    const publicDisabled = !m.sk;
    const rowChrome =
      alwaysShowRowChrome
        ? "opacity-100 pointer-events-auto"
        : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto";
    const publicBtn =
      libraryTab !== "community" && m.sk && !m.isDraft ? (
        <div
          className={`flex items-center gap-2 transition-opacity ${rowChrome} ${
            publicDisabled ? "cursor-not-allowed opacity-50" : ""
          }`}
          title={
            m.isPublic === true
              ? "Public — in Community Library"
              : "Make public in Community Library"
          }
        >
          <span
            className={`text-[11px] font-medium tracking-wide ${
              m.isPublic === true ? "text-accent-link" : "text-muted"
            }`}
          >
            Public
          </span>
          <Switch.Root
            checked={m.isPublic === true}
            onCheckedChange={(v) => void setPublic(m, Boolean(v))}
            disabled={publicDisabled}
            aria-label={
              m.isPublic ? "Remove from community library" : "Make public"
            }
            className="relative h-5 w-9 shrink-0 rounded-full border border-border bg-muted/40 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed"
          >
            <Switch.Thumb className="block h-4 w-4 translate-x-[2px] rounded-full bg-surface shadow-sm transition-transform will-change-transform data-[state=checked]:translate-x-[16px]" />
          </Switch.Root>
        </div>
      ) : null;
    const archiveBtn = isCommunity ? null : (
      <button
        type="button"
        onClick={() => {
          if (!m.sk) return;
          setArchiveConfirm({ sk: m.sk, title: m.title });
        }}
        disabled={archiveDisabled}
        aria-label="Archive meditation"
        className={`rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-muted transition-opacity transition-colors hover:border-accent/40 hover:text-foreground ${rowChrome} ${
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
          } items-center font-bold text-accent-link hover:text-accent-link/80 cursor-pointer`}
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
              className="self-center flex h-11 w-11 items-center justify-center rounded-full bg-accent/90 text-on-accent cursor-pointer"
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
                : setNowPlaying(trackFromLibraryItem(m))
            }
            className={
              alwaysShowRowChrome
                ? "flex self-center h-11 w-11 items-center justify-center rounded-full bg-accent/90 text-on-accent cursor-pointer opacity-100 pointer-events-auto transition-opacity"
                : "flex self-center h-11 w-11 items-center justify-center rounded-full bg-accent/90 text-on-accent cursor-pointer opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto"
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
          className={`group relative flex min-w-0 flex-col overflow-visible rounded-2xl border bg-card p-5 shadow-sm ${
            isPlaying
              ? "border-accent"
              : "border-border hover:border-accent/80 transition-colors"
          }`}
        >
          {fishCostText ? <FishCostDevTooltip text={fishCostText} /> : null}
          {isPlaying ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-accent border-accent-pulse"
            />
          ) : null}
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-accent-link">
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
            {publicBtn || archiveBtn ? (
            <span className="shrink-0 flex items-center gap-3">
              {publicBtn}
              {archiveBtn}
            </span>
            ) : null}
          </div>
          {scriptBlock ? <div className="mt-4">{scriptBlock}</div> : null}
          <div className="mt-auto flex items-center justify-between gap-3 translate-y-2">
            <div>{stars}</div>
            <div className="flex items-center gap-2">
              {actions}
              {mixerBtn}
              {favouriteBtn}
            </div>
          </div>
        </li>
      );
    }

    return (
      <li
        key={m.s3Key}
        className={`group relative min-w-0 overflow-visible rounded-2xl border bg-card p-4 shadow-sm ${
          isPlaying
            ? "border-accent"
            : "border-border hover:border-accent/80 transition-colors"
        }`}
      >
        {fishCostText ? <FishCostDevTooltip text={fishCostText} /> : null}
        {isPlaying ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-accent border-accent-pulse"
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
                <span className="rounded-full bg-accent-soft/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-link">
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
              {mixerBtn}
              {favouriteBtn}
            </div>
          </div>
        </div>
        <div className="mt-2 flex w-full items-center gap-3 text-xs text-muted">
          <span className="min-w-0 flex-1">
            {formatWhen(m.createdAt)}
            {m.speakerName ? ` · ${m.speakerName}` : ""}
          </span>
          {publicBtn || archiveBtn ? (
            <span className="shrink-0 flex items-center gap-3">
              {publicBtn}
              {archiveBtn}
            </span>
          ) : null}
        </div>
        {scriptBlock ? <div className="mt-4 border-t border-border pt-4">{scriptBlock}</div> : null}
      </li>
    );
  }

  const sortDropdown = (
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
                            selected ? "bg-selected/10 cursor-default" : "hover:bg-selected/10 bg-transparent"
                          }`}
                        >
                          {it.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
  );

  const layoutToggle = (
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
                    ? "bg-selected text-on-selected"
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
                    ? "bg-selected text-on-selected"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <IconGrid />
              </button>
            </div>
  );

  const searchInput = (
            <SearchInput
              className="min-w-[10rem] flex-1"
              inputClassName="py-2 placeholder:text-muted"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search title, description, type"
              aria-label="Search library"
            />
  );

  return (
    <>
    <div
      className={`mx-auto w-full max-w-6xl min-w-0 px-4 py-10 sm:px-6 [scrollbar-gutter:stable] ${
        nowPlaying ? "pb-32 sm:pb-28" : ""
      }`}
    >
      <header className="w-full min-w-0">
        <div className="grid w-full min-w-0 gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
          <div className="flex min-w-0 w-full items-center justify-between gap-3 sm:col-span-2">
            <h1 className="shrink-0 font-display text-3xl font-medium tracking-tight">
              Library
            </h1>
            <Link
              href="/meditate/create"
              className="shrink-0 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent"
            >
              Create new
            </Link>
          </div>
          <div className="min-w-0 w-full">
            <div
              className="inline-flex max-w-full flex-wrap rounded-xl border border-border bg-background p-1"
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
                    ? "bg-selected text-on-selected"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Meditations
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={libraryTab === "community"}
                onClick={() => setLibraryTab("community")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  libraryTab === "community"
                    ? "bg-selected text-on-selected"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Community Library
              </button>
            </div>
            <p className="mt-2 w-full min-w-0 text-muted">
              {libraryTab === "community"
                ? "Popular meditations from the community. Play any session; more will appear here over time."
                : "Your generated meditations, saved with details from each session. Rate them, and open the script whenever you need the text."}
            </p>
          </div>
          {libraryTab !== "community" ? (
          <div className="flex w-full flex-wrap items-center gap-3 sm:col-span-2">
            <div className="flex shrink-0 items-center gap-3">
              {libraryTab === "meditations" ? (
              <button
                type="button"
                onClick={() => setFavouritesOnly((v) => !v)}
                aria-pressed={favouritesOnly}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${
                  favouritesOnly
                    ? "border-selected/60 bg-selected text-on-selected"
                    : "border-border bg-background text-foreground hover:border-accent/40"
                }`}
              >
                <IconHeart filled={favouritesOnly} />
                <span className="hidden sm:inline">Favourites</span>
              </button>
              ) : null}
              {sortDropdown}
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
                          className={`w-full cursor-pointer px-3 py-2 text-left text-sm font-semibold text-foreground dark:text-foreground ${
                            selected ? "bg-selected/10 cursor-default" : "hover:bg-selected/10 bg-transparent"
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
            {searchInput}
            <div className="shrink-0">{layoutToggle}</div>
          </div>
          ) : null}
        </div>
      </header>

      {libraryTab === "community" ? (
        <>
          <CommunityCategoryGrid
            selected={categoryFilter}
            onSelect={setCategoryFilter}
          />
          <div className="mt-8 flex w-full flex-wrap items-center gap-3">
            <div className="shrink-0">{sortDropdown}</div>
            {searchInput}
            <div className="shrink-0">{layoutToggle}</div>
          </div>
        </>
      ) : null}

      {error ? (
        <p className="mt-6 w-full min-w-0 rounded-xl border border-border bg-card px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {libraryTab !== "community" &&
      loading &&
      pagedVisibleItems.length === 0 ? (
        <p className="mt-10 text-sm text-muted">Loading…</p>
      ) : pagedVisibleItems.length === 0 ? (
        <p className={`${libraryTab === "community" ? "mt-4" : "mt-10"} w-full min-w-0 text-sm text-muted`}>
          {searchQuery.trim() ? (
            "No meditations match your search."
          ) : libraryTab === "community" ? (
            categoryFilter === "all"
              ? "No community meditations yet. Popular sessions will show up here."
              : `No community meditations in ${categoryFilter} yet.`
          ) : favouritesOnly ? (
            "No favourite meditations yet."
          ) : (
            "No meditation audio yet. Generate one from Create — it will appear here after upload."
          )}
        </p>
      ) : (
        <ul
          className={
            viewMode === "grid"
              ? `${libraryTab === "community" ? "mt-4" : "mt-10"} grid w-full min-w-0 max-w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3`
              : `${libraryTab === "community" ? "mt-4" : "mt-10"} flex w-full min-w-0 max-w-full flex-col gap-3`
          }
        >
          {pagedVisibleItems.map((m, i) => {
            const rowKey = isPendingRow(m) ? m.pendingKey : m.sk || m.s3Key;
            const showDateMarkers = sortBy === "newest" || sortBy === "oldest";
            const marker = showDateMarkers
              ? libraryListDateMarker(m.createdAt)
              : null;
            const prev = i > 0 ? pagedVisibleItems[i - 1] : null;
            const prevMarker =
              prev && showDateMarkers
                ? libraryListDateMarker(prev.createdAt)
                : null;
            const insertMarker = Boolean(marker && marker.id !== prevMarker?.id);
            return (
              <Fragment key={rowKey}>
                {insertMarker && marker ? (
                  <li
                    className={`col-span-full list-none ${
                      i === 0 ? "" : "pt-2"
                    }`}
                  >
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {marker.label}
                    </h2>
                  </li>
                ) : null}
                {renderItem(m)}
              </Fragment>
            );
          })}
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
      musicItems={mixMusic}
      onDismiss={() => setNowPlaying(null)}
        playbackToggleNonce={playbackToggleNonce}
        bedVolumeApiRef={bedVolumeApiRef}
        onPlayingChange={(s3Key, playing) =>
          setPlayingS3Key(playing ? s3Key : null)
        }
        onPlaybackTimeChange={(s3Key, timeSeconds) => {
          if (mixEditor) return;
          if (playingS3KeyRef.current !== s3Key) return;
          setPlayingTimeSeconds(timeSeconds);
        }}
    />

    {mixEditor ? (
      <LibraryMixEditorModal
        item={mixEditor}
        anchorEl={mixAnchorEl}
        natureItems={mixNature}
        musicItems={mixMusic}
        drumsItems={mixDrums}
        noiseItems={mixNoise}
        error={mixError}
        resetMix={mixValuesFromItem(
          mixEditor,
          libraryTab === "community" ? "publisher" : "created",
        )}
        onLiveVolume={(channel, gain) => {
          if (nowPlaying?.s3Key !== mixEditor.s3Key) return;
          bedVolumeApiRef.current?.setBedVolume(channel, gain);
        }}
        onPreview={applyMixPreview}
        onPersist={persistMix}
        onClose={closeMixEditor}
        closeRef={mixCloseRef}
      />
    ) : null}

    {archiveConfirm ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 p-4">
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
              className="cursor-pointer rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
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
