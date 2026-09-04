"use client";

import {
  liveMixTrack,
  useLibraryPlayer,
  type BedVolumeChannel,
} from "@/components/library-player-provider";
import { SOUNDSCAPE_ELEMENT_VOLUME } from "@/lib/bed-volume";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IconAdjustmentsHorizontal, IconPlus } from "@tabler/icons-react";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as Switch from "@radix-ui/react-switch";
import { SearchInput } from "@/components/search-input";
import { DrumsLockedWrap } from "@/components/drums-locked-wrap";
import { SoundFolderSelect } from "@/components/sound-folder-select";
import { isMelodicMusicKey } from "@/lib/sound-taxonomy";
import {
  type LibraryMeditationItem,
  type LibraryProgram,
  type LibraryProgramDay,
  libraryMeditationCategoryLabel,
  listLibraryMeditations,
  listLibraryPrograms,
  getMeditationAudioJobStatus,
  getMedimadeMediaBaseUrl,
  listBackgroundAudio,
  patchMeditationFavourite,
  patchMeditationArchived,
  patchMeditationPublic,
  patchMeditationBackgroundMix,
  patchMeditationRating,
  backgroundAudioPlaybackKey,
  backgroundAudioStreamingKey,
  type BackgroundAudioItem,
} from "@/lib/medimade-api";
import { ChatMarkdown } from "@/components/chat-markdown";
import { useMobileOrTouchChrome } from "@/hooks/use-mobile-or-touch-chrome";
import {
  estimateFishBillableUtf8Bytes,
  fishCostUsdFromBillableBytes,
  fishTtsModelLabel,
  fishUsdPerMillionForModel,
  formatFishCostUsd,
  generationTimingsFlyoverLines,
  stripPauseMarkers,
} from "@/lib/meditation-analytics";
import {
  CLAUDE_HAIKU_45_MODEL_ID,
  CLAUDE_MODEL_RATES,
  claudeModelLabel,
  claudeRatesPerMillion,
  claudeUsdFromTokens,
} from "@/lib/claude-pricing";
import { communityLibraryAsItems, itemMatchesLibraryCategory } from "@/lib/community-library";
import {
  loadPendingGenerations,
  savePendingGenerations,
  PENDING_LIBRARY_GENERATIONS_CHANGED_EVENT,
  PENDING_LIBRARY_GENERATIONS_LS_KEY,
  type PendingLibraryGeneration,
} from "@/lib/pending-library-generations";
import { CommunityCategoryGrid } from "@/components/community-category-grid";
import { SoundscapePicker } from "@/components/soundscape-picker";
import { playWithLeadBuffer } from "@/lib/audio-lead-buffer";

/** Mixer gain persisted for a soundscape; live playback uses its own volume. */
const SOUNDSCAPE_MIX_GAIN = 50;

function formatAudioClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

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

function formatGenerationElapsed(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM.toString().padStart(2, "0")}m`;
}

function formatUsd(usd: number): string {
  if (usd <= 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

/**
 * Script-generation spend, so Haiku and Sonnet runs can be compared side by
 * side in the library. Worker tokens are measured; coach chat is an estimate.
 */
function claudeCostFlyover(m: LibraryMeditationItem): {
  lines: string[];
  totalUsd: number;
} {
  const model = m.claudeModel ?? null;
  const wi = m.claudeHaiku45WorkerInputTokens;
  const wo = m.claudeHaiku45WorkerOutputTokens;
  const ci = m.claudeHaiku45ChatEstInputTokens;
  const co = m.claudeHaiku45ChatEstOutputTokens;
  const hasWorker = typeof wi === "number" && typeof wo === "number";
  const hasChat = typeof ci === "number" && typeof co === "number";
  if (!hasWorker && !hasChat) {
    return {
      lines: [`Claude · ${claudeModelLabel(model)}: no usage recorded`],
      totalUsd: 0,
    };
  }
  const rates = claudeRatesPerMillion(model);
  const workerUsd = hasWorker ? claudeUsdFromTokens(model, wi, wo) : 0;
  const chatUsd = hasChat ? claudeUsdFromTokens(model, ci, co) : 0;
  const inTokens = (hasWorker ? wi : 0) + (hasChat ? ci : 0);
  const outTokens = (hasWorker ? wo : 0) + (hasChat ? co : 0);
  const totalUsd = workerUsd + chatUsd;

  const lines = [`Claude · ${claudeModelLabel(model)}`];
  if (hasWorker) {
    lines.push(
      `Script + metadata: ${wi.toLocaleString()} in / ${wo.toLocaleString()} out · ${formatUsd(workerUsd)}`,
    );
  }
  if (hasChat) {
    lines.push(
      `Coach chat ≈ ${ci.toLocaleString()} in / ${co.toLocaleString()} out · ${formatUsd(chatUsd)}`,
    );
  }
  lines.push(
    `Tokens: ${inTokens.toLocaleString()} in / ${outTokens.toLocaleString()} out`,
    `Rate: $${rates.input} in / $${rates.output} out per MTok`,
    `This run ≈ ${formatUsd(totalUsd)}`,
  );

  // Same tokens priced against the other models, to compare Haiku vs Sonnet.
  // Rows written before the model was recorded are priced as Haiku.
  const pricedAs = model ?? CLAUDE_HAIKU_45_MODEL_ID;
  for (const [id, rate] of Object.entries(CLAUDE_MODEL_RATES)) {
    if (id === pricedAs) continue;
    const alt = claudeUsdFromTokens(id, inTokens, outTokens);
    const delta = totalUsd > 0 ? alt / totalUsd : 0;
    const factor = delta > 0 ? ` (${delta.toFixed(2)}×)` : "";
    lines.push(
      `If ${rate.label}: ${formatUsd(alt)}${factor} · $${rate.usdPerInputToken * 1_000_000} / $${
        rate.usdPerOutputToken * 1_000_000
      } per MTok`,
    );
  }

  return { lines, totalUsd };
}

function fishCostTooltipText(m: LibraryMeditationItem): string | null {
  const model = m.fishTtsModel ?? null;
  const est = estimateFishBillableUtf8Bytes({
    scriptUtf8Bytes: m.scriptUtf8Bytes,
    scriptText: m.scriptText,
    title: m.title,
    scriptTruncated: m.scriptTruncated,
  });
  const perMillion = fishUsdPerMillionForModel(model);
  const lines: string[] = [];
  lines.push(`Length: ${formatDuration(m.durationSeconds)}`);
  let fishUsd = 0;
  if (est) {
    fishUsd = fishCostUsdFromBillableBytes(est.bytes, model);
    const approx = est.approximate ? " ≈" : "";
    lines.push(
      `Fish Audio · ${fishTtsModelLabel(model)}${approx}`,
      `${formatFishCostUsd(fishUsd)} · ${est.bytes.toLocaleString()} UTF-8 bytes`,
      `$${perMillion} / million UTF-8 bytes`,
    );
  } else {
    lines.push(
      `Fish Audio · ${fishTtsModelLabel(model)}: cost unknown (no script bytes)`,
    );
  }
  const claude = claudeCostFlyover(m);
  lines.push("", ...claude.lines);
  if (est || claude.totalUsd > 0) {
    lines.push("", `Total ≈ ${formatUsd(fishUsd + claude.totalUsd)} (voice + Claude)`);
  }
  lines.push("");
  const elapsed = formatGenerationElapsed(m.generationElapsedMs);
  if (elapsed) {
    lines.push(`Generate → library: ${elapsed}`);
  }
  const timingLines = generationTimingsFlyoverLines(m.generationTimings);
  if (timingLines.length > 0) {
    lines.push("", ...timingLines);
  }
  return lines.join("\n");
}

function FishCostDevTooltip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    // Outer box includes pb-2 as a hover bridge into the card so the mouse can
    // reach Copy without dropping group-hover (mb-2 alone left a dead gap).
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full right-0 z-40 hidden max-w-[21rem] pb-2 group-hover:pointer-events-auto group-hover:block group-focus-within:pointer-events-auto group-focus-within:block"
    >
      <div className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-left text-[11px] font-medium leading-snug text-foreground shadow-md">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 max-h-52 flex-1 overflow-y-auto whitespace-pre-line">{text}</p>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void copyAll();
            }}
            className="shrink-0 cursor-pointer rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted transition-colors hover:border-accent/50 hover:text-foreground"
            aria-label="Copy flyover text"
            title="Copy all"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
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
type LibraryMainTab = "meditations" | "programs" | "community";
type LibraryPathTab = "creations" | "programs" | "community";

const LIBRARY_MAIN_TABS: {
  id: LibraryMainTab;
  path: LibraryPathTab;
  label: string;
  shortLabel: string;
}[] = [
  { id: "meditations", path: "creations", label: "My Creations", shortLabel: "Creations" },
  { id: "programs", path: "programs", label: "Programs", shortLabel: "Programs" },
  { id: "community", path: "community", label: "Community", shortLabel: "Community" },
];

function libraryTabFromPath(tab: string | null | undefined): LibraryMainTab {
  if (tab === "programs") return "programs";
  if (tab === "community") return "community";
  return "meditations";
}

function libraryPathForTab(tab: LibraryMainTab): LibraryPathTab {
  return LIBRARY_MAIN_TABS.find((t) => t.id === tab)?.path ?? "creations";
}

/** URL-safe slug from a program title (e.g. "Chakra Cleanse" → "chakra-cleanse"). */
function slugifyProgramTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "program";
}

function programUrlSlug(
  program: { id: string; title: string },
  all: { id: string; title: string }[],
): string {
  const base = slugifyProgramTitle(program.title);
  const collisions = all.filter((p) => slugifyProgramTitle(p.title) === base);
  if (collisions.length <= 1) return base;
  return `${base}-${program.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}`;
}

function findLibraryProgramByPathKey(
  programs: LibraryProgram[],
  key: string,
): LibraryProgram | null {
  const k = key.trim().toLowerCase();
  if (!k) return null;
  const byId = programs.find((p) => p.id.toLowerCase() === k);
  if (byId) return byId;
  const bySlug = programs.find((p) => programUrlSlug(p, programs) === k);
  if (bySlug) return bySlug;
  return (
    programs.find((p) => slugifyProgramTitle(p.title) === k) ?? null
  );
}

function libraryPathSegments(pathname: string | null | undefined): {
  tab: string | null;
  programSlug: string | null;
} {
  const parts = (pathname ?? "").split("/").filter(Boolean);
  const i = parts.indexOf("library");
  if (i < 0) return { tab: null, programSlug: null };
  const tab = parts[i + 1] ?? null;
  const programSlug =
    tab === "programs" && parts[i + 2] ? parts[i + 2]! : null;
  return { tab, programSlug };
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


function mediaFileUrl(base: string, key: string): string {
  const b = base.replace(/\/$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${b}/${path}`;
}

/** A soundscape rides the music slot alone; that is how it is recognised later. */
function isSoundscapeKey(
  compositions: BackgroundAudioItem[],
  key: string | null | undefined,
): boolean {
  const k = backgroundAudioStreamingKey(key ?? "");
  if (!k) return false;
  return compositions.some((c) => backgroundAudioStreamingKey(c.key) === k);
}

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
  compositionItems,
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
  compositionItems: BackgroundAudioItem[];
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
  const soundscapeSelected = isSoundscapeKey(compositionItems, musicKey);
  const [bedTab, setBedTab] = useState<"soundscape" | "mixer">(
    soundscapeSelected ? "soundscape" : "mixer",
  );
  const mediaBase = getMedimadeMediaBaseUrl();
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  useEffect(
    () => () => {
      const el = previewRef.current;
      if (el) {
        el.pause();
        el.removeAttribute("src");
      }
    },
    [],
  );

  function soundscapePreviewUrl(key: string): string | null {
    if (!mediaBase || !key.trim()) return null;
    return mediaFileUrl(mediaBase, backgroundAudioStreamingKey(key));
  }

  function toggleSoundscapePreview(key: string) {
    const el = previewRef.current;
    const url = soundscapePreviewUrl(key);
    if (!el || !url) return;
    if (previewKey === key && !el.paused) {
      el.pause();
      setPreviewKey(null);
      return;
    }
    if (el.src !== url) {
      el.src = url;
      el.load();
    }
    // load() resets volume, so this has to be set after it.
    el.volume = SOUNDSCAPE_ELEMENT_VOLUME;
    setPreviewKey(key);
    void playWithLeadBuffer(el).catch(() => setPreviewKey(null));
  }

  /** A soundscape is the whole bed, so picking one clears the mixer channels. */
  function chooseSoundscape(key: string) {
    const next: LibraryMixValues = {
      natureKey: "",
      musicKey: key,
      drumsKey: "",
      noiseKey: "",
      natureGain,
      musicGain: SOUNDSCAPE_MIX_GAIN,
      drumsGain,
      noiseGain,
    };
    setNatureKey("");
    setMusicKey(key);
    setDrumsKey("");
    setNoiseKey("");
    setMusicGain(SOUNDSCAPE_MIX_GAIN);
    mixRef.current = next;
    previewNow(next);
  }

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
      <div className="mt-3 inline-flex rounded-full border border-border bg-background p-0.5 text-xs">
        {([
          { id: "soundscape" as const, label: "Soundscape" },
          { id: "mixer" as const, label: "Build your own" },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              // Leaving a soundscape frees the music slot for a mixer sample.
              if (t.id === "mixer" && soundscapeSelected) {
                const next = mixWithKey(mixRef.current, "music", "");
                setMusicKey("");
                mixRef.current = next;
                previewNow(next);
              }
              setBedTab(t.id);
            }}
            aria-pressed={bedTab === t.id}
            className={`cursor-pointer rounded-full px-3 py-1 font-medium transition-colors ${
              bedTab === t.id
                ? "bg-accent-soft text-accent-link"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {bedTab === "soundscape" ? (
        <div className="mt-3 max-h-72 overflow-y-auto pr-1">
          <SoundscapePicker
            compact
            items={compositionItems}
            value={soundscapeSelected ? musicKey : ""}
            onChange={chooseSoundscape}
            previewUrl={soundscapePreviewUrl}
            playingKey={previewKey}
            onTogglePreview={toggleSoundscapePreview}
          />
          <audio
            ref={previewRef}
            className="hidden"
            playsInline
            onEnded={() => setPreviewKey(null)}
          />
        </div>
      ) : (
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
      )}
      {error ? (
        <p className="mt-2 text-xs text-danger">{error}</p>
      ) : null}
    </div>
  );
}

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

function isCataloguedLibraryItem(m: LibraryMeditationItem): boolean {
  return m.catalogued === true && m.isDraft !== true;
}

function findCataloguedLibraryItem(
  list: LibraryMeditationItem[],
  audioKey: string,
): LibraryMeditationItem | undefined {
  const key = audioKey.trim();
  if (!key) return undefined;
  return list.find((x) => x.s3Key === key && isCataloguedLibraryItem(x));
}

function isPendingRow(x: LibraryRow): x is PendingLibraryMeditationItem {
  return (x as PendingLibraryMeditationItem).kind === "pending";
}

function programDayLibraryTitle(day: {
  title: string;
  dayNumber: number;
}): string {
  return (
    day.title
      .replace(/^(?:Day|Lesson|Class)\s+\d+\s*[·:.-]?\s*/i, "")
      .trim() ||
    day.title.trim() ||
    `Lesson ${day.dayNumber}`
  );
}

/** Map a program class onto the shared library card shape so we reuse renderItem. */
function libraryItemFromProgramDay(
  day: LibraryProgramDay,
  program: LibraryProgram,
): LibraryMeditationItem {
  const musicKey = day.backgroundMusicKey.trim();
  return {
    id: `program-day:${program.id}:${day.id}`,
    sk: null,
    s3Key: day.audioKey,
    audioUrl: day.audioUrl,
    title: programDayLibraryTitle(day),
    meditationType: program.title,
    meditationStyle: null,
    speakerModelId: null,
    speakerName: null,
    description: day.description.trim() || null,
    createdAt: null,
    durationSeconds:
      day.durationSeconds != null &&
      Number.isFinite(day.durationSeconds) &&
      day.durationSeconds > 0
        ? day.durationSeconds
        : null,
    scriptText: null,
    scriptTruncated: false,
    rating: null,
    favourite: false,
    archived: false,
    catalogued: true,
    mp3Bytes: null,
    isDraft: false,
    liveMix: Boolean(musicKey),
    backgroundMusicKey: musicKey || null,
    backgroundMusicGain: musicKey ? SOUNDSCAPE_MIX_GAIN : null,
    backgroundNatureKey: "",
    backgroundDrumsKey: "",
    backgroundNoiseKey: "",
    backgroundNatureGain: 0,
    backgroundDrumsGain: 0,
    backgroundNoiseGain: 0,
  };
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

/** Survive soft navigations that remount LibraryView (cache only; layout is primary). */
let programsMemoryCache: LibraryProgram[] | null = null;

export default function LibraryView({
  initialItems = null,
}: {
  initialItems?: LibraryMeditationItem[] | null;
}) {
  const alwaysShowRowChrome = useMobileOrTouchChrome();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pathSegs = libraryPathSegments(pathname);
  const programDurationProbeTriedRef = useRef(new Set<string>());
  const {
    nowPlaying,
    playingS3Key,
    bedVolumeApiRef,
    playItem,
    toggleCurrent,
    patchNowPlaying,
    setPlaybackTimeListener,
  } = useLibraryPlayer();
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
  /** Mobile-only: which library cards show full details (multiple allowed). */
  const [mobileCardOpen, setMobileCardOpen] = useState<Record<string, boolean>>(
    {},
  );
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const mobileSearchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!mobileFilterOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileFilterOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileFilterOpen]);
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
  const [mixCompositions, setMixCompositions] = useState<BackgroundAudioItem[]>(
    [],
  );
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [libraryTab, setLibraryTab] = useState<LibraryMainTab>(() =>
    libraryTabFromPath(pathSegs.tab),
  );
  const [programs, setPrograms] = useState<LibraryProgram[]>(
    () => programsMemoryCache ?? [],
  );
  const [programsLoading, setProgramsLoading] = useState(
    () =>
      libraryTabFromPath(pathSegs.tab) === "programs" &&
      programsMemoryCache === null,
  );
  const [programsReady, setProgramsReady] = useState(
    () => programsMemoryCache !== null,
  );
  const [programsError, setProgramsError] = useState<string | null>(null);
  const [exploringProgramId, setExploringProgramId] = useState<string | null>(
    () => {
      const slug = pathSegs.programSlug;
      if (!slug || !programsMemoryCache?.length) return null;
      return findLibraryProgramByPathKey(programsMemoryCache, slug)?.id ?? null;
    },
  );
  const [programPathKey, setProgramPathKey] = useState<string | null>(
    () => pathSegs.programSlug,
  );
  const PAGE_SIZE = 24;

  function goToLibraryTab(
    tab: LibraryMainTab,
    opts?: { replace?: boolean; keepQuery?: boolean },
  ) {
    const path = `/meditate/library/${libraryPathForTab(tab)}`;
    const qs = opts?.keepQuery ? searchParams.toString() : "";
    const href = qs ? `${path}?${qs}` : path;
    setLibraryTab(tab);
    setExploringProgramId(null);
    setProgramPathKey(null);
    if (opts?.replace) router.replace(href);
    else router.push(href);
  }

  function openProgram(program: LibraryProgram) {
    const slug = programUrlSlug(program, programs);
    setExploringProgramId(program.id);
    setProgramPathKey(slug);
    router.push(`/meditate/library/programs/${encodeURIComponent(slug)}`);
  }

  function closeProgram() {
    setExploringProgramId(null);
    setProgramPathKey(null);
    router.push("/meditate/library/programs");
  }

  useEffect(() => {
    const { tab, programSlug } = libraryPathSegments(pathname);
    if (tab === "creations" || tab === "programs" || tab === "community") {
      const next = libraryTabFromPath(tab);
      setLibraryTab((cur) => (cur === next ? cur : next));
    }
    if (tab === "programs") {
      setProgramPathKey((cur) => (cur === programSlug ? cur : programSlug));
      if (!programSlug) setExploringProgramId(null);
    } else {
      setProgramPathKey(null);
      setExploringProgramId(null);
    }
  }, [pathname]);
  const [page, setPage] = useState(1);
  const [playingTimeSeconds, setPlayingTimeSeconds] = useState(0);
  const [pendingAutoplay, setPendingAutoplay] = useState<{
    jobId: string;
    audioKey: string;
  } | null>(null);
  const [showFishCostTooltip, setShowFishCostTooltip] = useState(false);

  const itemElsRef = useRef<Map<string, HTMLLIElement>>(new Map());
  const focusHandledRef = useRef(false);
  const shareIdHandledRef = useRef(false);
  const [shareCopiedId, setShareCopiedId] = useState<string | null>(null);

  useEffect(() => {
    setPlaybackTimeListener((_s3Key, timeSeconds) => {
      setPlayingTimeSeconds(timeSeconds);
    });
    return () => setPlaybackTimeListener(null);
  }, [setPlaybackTimeListener]);

  useEffect(() => {
    if (!playingS3Key) setPlayingTimeSeconds(0);
  }, [playingS3Key]);

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
        setMixCompositions(data.compositions ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setMixNature([]);
        setMixMusic([]);
        setMixDrums([]);
        setMixNoise([]);
        setMixCompositions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (libraryTab !== "programs") return;
    let cancelled = false;
    const hadCache = programsMemoryCache !== null;
    if (!hadCache) setProgramsLoading(true);
    setProgramsError(null);
    void listLibraryPrograms()
      .then((list) => {
        if (cancelled) return;
        programsMemoryCache = list;
        setPrograms(list);
        setProgramsReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        if (!hadCache) {
          setPrograms([]);
          setProgramsReady(true);
        }
        setProgramsError(
          e instanceof Error ? e.message : "Could not load programs",
        );
      })
      .finally(() => {
        if (!cancelled) setProgramsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [libraryTab]);

  /** Older program days lack stored duration — probe the MP3 once for the card label. */
  useEffect(() => {
    if (libraryTab !== "programs" || programs.length === 0) return;
    let cancelled = false;
    const missing: { programId: string; dayId: string; url: string }[] = [];
    for (const p of programs) {
      for (const d of p.days) {
        const id = `${p.id}:${d.id}`;
        if (programDurationProbeTriedRef.current.has(id)) continue;
        if (
          d.durationSeconds != null &&
          Number.isFinite(d.durationSeconds) &&
          d.durationSeconds > 0
        ) {
          programDurationProbeTriedRef.current.add(id);
          continue;
        }
        const url = d.audioUrl?.trim();
        if (!url) {
          programDurationProbeTriedRef.current.add(id);
          continue;
        }
        missing.push({ programId: p.id, dayId: d.id, url });
      }
    }
    if (missing.length === 0) return;

    for (const m of missing) {
      programDurationProbeTriedRef.current.add(`${m.programId}:${m.dayId}`);
    }

    void (async () => {
      const measured = new Map<string, number>();
      await Promise.all(
        missing.map(
          ({ programId, dayId, url }) =>
            new Promise<void>((resolve) => {
              const a = new Audio();
              a.preload = "metadata";
              const finish = (sec: number | null) => {
                a.removeAttribute("src");
                try {
                  a.load();
                } catch {
                  // ignore
                }
                if (sec != null && sec > 0) {
                  measured.set(`${programId}:${dayId}`, sec);
                }
                resolve();
              };
              a.onloadedmetadata = () => {
                const d = a.duration;
                finish(
                  typeof d === "number" && Number.isFinite(d) && d > 0
                    ? d
                    : null,
                );
              };
              a.onerror = () => finish(null);
              a.src = url;
            }),
        ),
      );
      if (cancelled || measured.size === 0) return;
      setPrograms((prev) => {
        const next = prev.map((p) => ({
          ...p,
          days: p.days.map((d) => {
            const sec = measured.get(`${p.id}:${d.id}`);
            return sec != null ? { ...d, durationSeconds: sec } : d;
          }),
        }));
        programsMemoryCache = next;
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [libraryTab, programs]);

  useEffect(() => {
    if (!programPathKey) {
      setExploringProgramId(null);
      return;
    }
    if (programs.length === 0) return;
    const found = findLibraryProgramByPathKey(programs, programPathKey);
    setExploringProgramId(found?.id ?? null);
  }, [programPathKey, programs]);

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
    if (libraryTab === "programs") return [];
    return [...pendingRows, ...sortedItems];
  }, [libraryTab, pendingRows, sortedItems, sortedCommunityItems]);

  const visibleItems: LibraryRow[] = useMemo(() => {
    const tokens = librarySearchTokens(searchQuery);
    if (libraryTab === "programs") return [];
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
    setExploringProgramId(null);
    if (libraryTab === "programs") setViewMode("list");
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
    const syncPendingFromStorage = () => {
      setPending(loadPendingGenerations());
    };
    syncPendingFromStorage();
    const onStorage = (e: StorageEvent) => {
      if (e.key === PENDING_LIBRARY_GENERATIONS_LS_KEY || e.key === null) {
        syncPendingFromStorage();
      }
    };
    const onCustom = () => syncPendingFromStorage();
    const onVisible = () => {
      if (document.visibilityState === "visible") syncPendingFromStorage();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(PENDING_LIBRARY_GENERATIONS_CHANGED_EVENT, onCustom);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        PENDING_LIBRARY_GENERATIONS_CHANGED_EVENT,
        onCustom,
      );
      document.removeEventListener("visibilitychange", onVisible);
    };
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
            const audioKey = (st.audioKey ?? "").trim();
            if (!audioKey) {
              continue;
            }
            let catalogued = findCataloguedLibraryItem(items, audioKey);
            if (!catalogued) {
              try {
                const list = await listLibraryMeditations();
                const merged = applyLocalMixOverlay(
                  list,
                  localMixByKeyRef.current,
                );
                setItems(merged);
                catalogued = findCataloguedLibraryItem(merged, audioKey);
              } catch {
                // keep pending; slow poll will retry
              }
            }
            if (catalogued) {
              setPendingAutoplay({ jobId: p.jobId, audioKey });
              continue;
            }
            next.push({ ...nextP, status: "running" });
            continue;
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

    // Ensure we show the creations tab for a generated audio key.
    goToLibraryTab("meditations", { replace: true, keepQuery: true });

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
        playItem(found);
      }
    }
  }, [loading, visibleItems, searchParams]);

  // Deep link: /meditate/library?id=<id> → Community tab, scroll to item, autoplay.
  useEffect(() => {
    if (loading) return;
    const id = searchParams.get("id")?.trim() || "";
    if (!id) return;

    if (libraryTab !== "community") {
      goToLibraryTab("community", { replace: true, keepQuery: true });
      return;
    }
    if (categoryFilter !== "all") {
      setCategoryFilter("all");
      return;
    }
    if (searchQuery.trim()) {
      setSearchQuery("");
      return;
    }
    if (shareIdHandledRef.current) return;

    const found = communityItems.find((x) => x.id === id);
    if (!found) return;

    shareIdHandledRef.current = true;
    const scrollAndPlay = () => {
      const el = itemElsRef.current.get(found.s3Key);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      playItem(found);
    };
    // Allow the community list to paint after filter/tab switches.
    requestAnimationFrame(() => {
      requestAnimationFrame(scrollAndPlay);
    });
  }, [
    loading,
    searchParams,
    libraryTab,
    categoryFilter,
    searchQuery,
    communityItems,
  ]);


  // If we were focused on a pending card, auto-switch focus to the real item and autoplay once it appears.
  useEffect(() => {
    if (!pendingAutoplay) return;
    const found = findCataloguedLibraryItem(items, pendingAutoplay.audioKey);
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
    playItem(found);
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
    patchNowPlaying((p) => {
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
    patchNowPlaying((p) => {
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
    patchNowPlaying((p) =>
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
          className="inline-flex shrink-0 items-center justify-center rounded-full accent-fill-gradient px-4 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
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
    const isProgramShelf = libraryTab === "programs";
    const hideOwnerActions = isCommunity || isProgramShelf;
    const stars = isCommunity ? null : (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            disabled={!m.sk || ratingBusy === m.sk || isProgramShelf}
            onClick={() =>
              void setRating(m, m.rating === star ? null : star)
            }
            className={`rounded px-0.5 text-base leading-none sm:text-lg ${
              m.rating != null && star <= m.rating
                ? "text-accent"
                : "text-star-idle"
            } ${!m.sk || isProgramShelf ? "cursor-not-allowed opacity-40" : ""}`}
            title={
              isProgramShelf
                ? "Ratings aren’t available on program classes"
                : m.sk
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
    const favouriteBtn = hideOwnerActions ? null : (
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
      !hideOwnerActions && m.sk && !m.isDraft ? (
        <div
          className={`flex items-center gap-2 transition-opacity ${rowChrome} ${
            publicDisabled ? "cursor-not-allowed opacity-50" : ""
          }`}
          title={
            m.isPublic === true
              ? "Public — in Community"
              : "Make public in Community"
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
    const archiveBtn = hideOwnerActions ? null : (
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

    const shareId = m.id?.trim() || "";
    const canShare =
      Boolean(shareId) &&
      !isProgramShelf &&
      (isCommunity || m.isPublic === true);
    const shareBtn = canShare ? (
      <button
        type="button"
        onClick={() => {
          const url = `https://consciously.live/meditate/library/community?id=${encodeURIComponent(shareId)}`;
          void (async () => {
            try {
              await navigator.clipboard.writeText(url);
              setShareCopiedId(shareId);
              window.setTimeout(() => {
                setShareCopiedId((cur) => (cur === shareId ? null : cur));
              }, 2000);
            } catch {
              window.prompt("Copy this link:", url);
            }
          })();
        }}
        aria-label="Copy share link"
        className={`rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-muted transition-opacity transition-colors hover:border-accent/40 hover:text-foreground ${
          isCommunity ? "" : rowChrome
        } cursor-pointer`}
        title={
          shareCopiedId === shareId
            ? "Link copied"
            : "Copy link to this meditation"
        }
      >
        {shareCopiedId === shareId ? "Copied!" : "Share"}
      </button>
    ) : null;

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

    const cardKey = m.s3Key;
    const mobileOpen = Boolean(mobileCardOpen[cardKey]);
    function toggleMobileCard() {
      setMobileCardOpen((prev) => ({
        ...prev,
        [cardKey]: !prev[cardKey],
      }));
    }

    const playControl = isPlaying ? (
      <div className="flex items-center gap-2">
        <span className="tabular-nums text-xs font-semibold text-muted sm:inline">
          {formatAudioClock(playingTimeSeconds)}
        </span>
        <button
          type="button"
          onClick={() => toggleCurrent()}
          className="flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full accent-fill-gradient text-on-accent sm:h-11 sm:w-11"
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
            ? toggleCurrent()
            : playItem(m)
        }
        className={
          alwaysShowRowChrome
            ? "flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full accent-fill-gradient text-on-accent opacity-100 pointer-events-auto transition-opacity sm:h-11 sm:w-11"
            : "flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full accent-fill-gradient text-on-accent opacity-100 pointer-events-auto transition-opacity sm:h-11 sm:w-11 sm:opacity-0 sm:pointer-events-none sm:group-hover:opacity-100 sm:group-hover:pointer-events-auto"
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
    );

    const actions = (
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
        {playControl}
      </div>
    );

    const mobileFavouriteBtn = hideOwnerActions ? null : (
      <button
        type="button"
        onClick={() => void setFavourite(m, !m.favourite)}
        disabled={favouriteDisabled}
        aria-label={m.favourite ? "Unfavourite meditation" : "Favourite meditation"}
        className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-border bg-background transition-colors ${
          m.favourite ? "text-selected border-selected/40" : "text-muted"
        } ${
          favouriteDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        }`}
      >
        <IconHeart filled={m.favourite} strokeWidth={2.5} />
      </button>
    );

    const mobileMixerBtn = canEditMix ? (
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
        className="flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-muted"
      >
        <IconMixer />
      </button>
    ) : null;

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

    const mobileCardBody = (
      <div className="sm:hidden">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 flex-1 font-display text-lg font-medium leading-snug">
            {m.title}
          </h2>
          <span className="mt-1.5 shrink-0 tabular-nums text-xs font-semibold text-muted">
            {lengthLine}
          </span>
        </div>
        <span className="mt-2 inline-block rounded-full bg-accent-soft/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-link">
          {styleLine}
        </span>
        <p className="mt-2 line-clamp-2 text-sm text-muted">
          {m.description ?? "—"}
        </p>
        <div className="mt-3 flex items-center gap-2">
          {playControl}
          {mobileOpen ? mobileMixerBtn : null}
          {mobileFavouriteBtn}
          {!mobileOpen ? (
            <button
              type="button"
              onClick={toggleMobileCard}
              className="ml-auto cursor-pointer text-sm font-semibold text-accent-link"
              aria-expanded={false}
            >
              More ⌄
            </button>
          ) : (
            <span className="ml-auto" aria-hidden />
          )}
        </div>
        {mobileOpen ? (
          <div className="mt-3 space-y-3">
            {m.scriptText && m.sk != null ? (
              <button
                type="button"
                onClick={() =>
                  setExpandedSk((v) => (v === m.sk ? null : (m.sk ?? null)))
                }
                className="cursor-pointer font-bold text-accent-link hover:text-accent-link/80"
                style={{ lineHeight: "1.35" }}
              >
                {open ? "Hide script" : "Show script"}
              </button>
            ) : null}
            {scriptBlock}
            {stars}
            <p className="text-xs text-muted">
              {formatWhen(m.createdAt)}
              {m.speakerName ? ` · ${m.speakerName}` : ""}
            </p>
            {publicBtn || archiveBtn || shareBtn ? (
              <div className="flex items-center gap-3 border-t border-border/70 pt-3 [&_*]:!opacity-100 [&_*]:!pointer-events-auto">
                {publicBtn}
                {shareBtn}
                {archiveBtn}
              </div>
            ) : null}
            <button
              type="button"
              onClick={toggleMobileCard}
              className="w-full cursor-pointer text-right text-sm font-semibold text-accent-link"
              aria-expanded={true}
            >
              Show less ⌃
            </button>
          </div>
        ) : null}
      </div>
    );

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
          {mobileCardBody}
          <div className="hidden min-w-0 flex-1 flex-col sm:flex">
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
            {publicBtn || archiveBtn || shareBtn ? (
            <span className="shrink-0 flex items-center gap-3">
              {publicBtn}
              {shareBtn}
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
        {mobileCardBody}
        <div className="hidden sm:block">
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
          {publicBtn || archiveBtn || shareBtn ? (
            <span className="shrink-0 flex items-center gap-3">
              {publicBtn}
              {shareBtn}
              {archiveBtn}
            </span>
          ) : null}
        </div>
        {scriptBlock ? <div className="mt-4 border-t border-border pt-4">{scriptBlock}</div> : null}
        </div>
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
                  className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground/80 hover:border-accent/40"
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
                    className="absolute left-0 z-20 mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-lg"
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
              className="hidden rounded-xl border border-border bg-card p-1 sm:inline-flex"
              role="group"
              aria-label="Library layout"
            >
              <button
                type="button"
                onClick={() => setViewMode("list")}
                aria-pressed={viewMode === "list"}
                className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium ${
                  viewMode === "list"
                    ? "bg-nav-active text-nav-foreground"
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
                    ? "bg-nav-active text-nav-foreground"
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
              inputClassName="bg-card py-2 placeholder:text-muted"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search title, description, type"
              aria-label="Search library"
            />
  );

  const mobileToolbarChrome =
    "h-[38px] rounded-[9px] border border-border bg-card";
  const mobileFilterActive =
    sortBy !== "newest" || categoryFilter !== "all";

  const mobileSearchFilterRow = (
    <div className="flex items-center gap-2 sm:hidden">
      <SearchInput
        className="min-w-0 flex-1"
        inputRef={mobileSearchRef}
        inputClassName={`${mobileToolbarChrome} py-0 pl-9 pr-3 text-sm leading-[38px] placeholder:text-muted`}
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search"
        aria-label="Search library"
      />
      <button
        type="button"
        onClick={() => setMobileFilterOpen(true)}
        aria-label="Sort and filter"
        aria-haspopup="dialog"
        aria-expanded={mobileFilterOpen}
        className={`relative flex w-[38px] shrink-0 cursor-pointer items-center justify-center text-foreground ${mobileToolbarChrome}`}
      >
        <IconAdjustmentsHorizontal size={20} stroke={1.75} aria-hidden />
        {mobileFilterActive ? (
          <span
            className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-card bg-accent"
            aria-hidden
          />
        ) : null}
      </button>
      {libraryTab === "meditations" ? (
        <button
          type="button"
          onClick={() => setFavouritesOnly((v) => !v)}
          aria-pressed={favouritesOnly}
          aria-label={
            favouritesOnly ? "Show all meditations" : "Show favourites only"
          }
          className={`flex w-[38px] shrink-0 cursor-pointer items-center justify-center ${mobileToolbarChrome} ${
            favouritesOnly
              ? "border-selected/50 bg-selected/15 text-selected"
              : "text-foreground"
          }`}
        >
          <IconHeart filled={favouritesOnly} />
        </button>
      ) : null}
    </div>
  );

  return (
    <>
    <div
      className="mx-auto w-full max-w-6xl min-w-0 px-4 pt-3 pb-10 sm:px-6 sm:py-10 [scrollbar-gutter:stable]"
    >
      <header className="w-full min-w-0">
        <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <h1 className="shrink-0 font-display text-3xl font-medium tracking-tight">
            Library
          </h1>
          {/* Tablet+ : tabs + create text (unchanged) */}
          <div className="hidden min-w-0 flex-wrap items-center justify-end gap-2 sm:flex">
            <div
              className="inline-flex max-w-full flex-wrap rounded-xl border border-border bg-card p-1"
              role="tablist"
              aria-label="Library section"
            >
              {LIBRARY_MAIN_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={libraryTab === tab.id}
                  onClick={() => goToLibraryTab(tab.id)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                    libraryTab === tab.id
                      ? "bg-nav-active text-nav-foreground"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <Link
              href="/meditate/create"
              className="shrink-0 cursor-pointer rounded-xl accent-fill-gradient px-3 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
            >
              + Create new
            </Link>
          </div>
        </div>
        {/* Mobile: compact tabs + icon create on one row */}
        <div className="mt-3 flex items-center gap-2 sm:hidden">
          <div
            className="inline-flex min-w-0 flex-1 rounded-xl border border-border bg-card p-0.5"
            role="tablist"
            aria-label="Library section"
          >
              {LIBRARY_MAIN_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={libraryTab === tab.id}
                  onClick={() => goToLibraryTab(tab.id)}
                  className={`min-w-0 flex-1 rounded-lg px-1.5 py-1.5 text-[12px] font-semibold transition-colors sm:text-[13px] ${
                    libraryTab === tab.id
                      ? "bg-nav-active text-nav-foreground"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {tab.shortLabel}
                </button>
              ))}
          </div>
          <Link
            href="/meditate/create"
            aria-label="Create new meditation"
            className="flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-xl accent-fill-gradient text-on-accent transition-opacity hover:opacity-90"
          >
            <IconPlus size={22} stroke={2.25} aria-hidden />
          </Link>
        </div>
        {libraryTab === "meditations" ? (
          <>
            <div className="mt-3 sm:hidden">{mobileSearchFilterRow}</div>
            <div className="mt-4 hidden w-full flex-wrap items-center gap-3 sm:flex">
            <div className="flex shrink-0 items-center gap-3">
              {libraryTab === "meditations" ? (
              <button
                type="button"
                onClick={() => setFavouritesOnly((v) => !v)}
                aria-pressed={favouritesOnly}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${
                  favouritesOnly
                    ? "border-selected/60 bg-selected text-on-selected"
                    : "border-border bg-card text-foreground hover:border-accent/40"
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
                  className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:border-accent/40"
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
                    className="absolute left-0 z-20 mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-lg"
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
          </>
        ) : null}
      </header>

      {libraryTab === "community" ? (
        <>
          <CommunityCategoryGrid
            selected={categoryFilter}
            onSelect={setCategoryFilter}
          />
          <div
            className="sm:hidden"
            style={{ height: 11, minHeight: 11, width: "100%" }}
            aria-hidden
          />
          {mobileSearchFilterRow}
          <div className="mt-8 hidden w-full flex-wrap items-center gap-3 sm:flex">
            <div className="shrink-0">{sortDropdown}</div>
            {searchInput}
            <div className="shrink-0">{layoutToggle}</div>
          </div>
        </>
      ) : null}

      {libraryTab === "programs" ? (
        programsError && programs.length === 0 && programsReady ? (
          <p className="mt-6 w-full min-w-0 rounded-xl border border-border bg-card px-4 py-3 text-sm text-danger">
            {programsError}
          </p>
        ) : programsLoading && programs.length === 0 ? (
          <p className="mt-10 text-sm text-muted">Loading programs…</p>
        ) : programsReady && programs.length === 0 ? (
          <div className="mt-10 w-full min-w-0 rounded-2xl border border-border bg-card px-5 py-10 text-center sm:px-10">
            <h2 className="font-display text-xl font-medium tracking-tight">
              Programs
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
              Curated programs will show up here once published from Admin →
              Programs.
            </p>
          </div>
        ) : (() => {
          const exploring = exploringProgramId
            ? programs.find((p) => p.id === exploringProgramId)
            : null;
          if (
            programPathKey &&
            programsReady &&
            !programsLoading &&
            !exploring
          ) {
            return (
              <div className="mt-10 w-full min-w-0 rounded-2xl border border-border bg-card px-5 py-10 text-center sm:px-10">
                <h2 className="font-display text-xl font-medium tracking-tight">
                  Program not found
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
                  This course isn&apos;t on the shelf (or the link is outdated).
                </p>
                <button
                  type="button"
                  onClick={closeProgram}
                  className="mt-5 cursor-pointer rounded-full accent-fill-gradient px-4 py-2 text-sm font-semibold text-on-accent"
                >
                  All programs
                </button>
              </div>
            );
          }
          if (programPathKey && !exploring) {
            return (
              <p className="mt-10 text-sm text-muted">Loading programs…</p>
            );
          }
          if (exploring) {
            return (
              <div className="mt-8 w-full min-w-0">
                <button
                  type="button"
                  onClick={closeProgram}
                  className="mb-4 inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-muted hover:text-foreground"
                >
                  <span aria-hidden>←</span> All programs
                </button>
                <header className="mb-6">
                  <h2 className="font-display text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
                    {exploring.title}
                  </h2>
                  {exploring.description ? (
                    <p className="mt-2 w-full text-sm leading-relaxed text-muted sm:text-base">
                      {exploring.description}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-muted">
                    {exploring.days.length} lesson
                    {exploring.days.length === 1 ? "" : "s"}
                  </p>
                </header>
                {exploring.days.length === 0 ? (
                  <p className="text-sm text-muted">No lessons ready yet.</p>
                ) : (
                  <ul className="mt-2 flex w-full min-w-0 max-w-full flex-col gap-3">
                    {exploring.days.map((day) =>
                      renderItem(libraryItemFromProgramDay(day, exploring)),
                    )}
                  </ul>
                )}
              </div>
            );
          }
          return (
            <ul className="mt-10 flex w-full min-w-0 max-w-full flex-col gap-4">
              {programs.map((program) => {
                const lessonCount = program.days.length;
                return (
                  <li
                    key={program.id}
                    className="flex w-full min-w-0 gap-4 rounded-2xl border border-border bg-card p-4 sm:gap-5 sm:p-5"
                  >
                    <div
                      className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-background sm:h-28 sm:w-28"
                      aria-hidden
                    >
                      <svg
                        viewBox="0 0 48 48"
                        className="h-10 w-10 text-muted/50"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <rect x="8" y="12" width="32" height="24" rx="3" />
                        <circle cx="18" cy="22" r="3" />
                        <path d="M8 30l8-6 6 4 10-8 8 6" />
                      </svg>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <h2 className="font-display text-xl font-medium tracking-tight text-foreground sm:text-2xl">
                        {program.title}
                      </h2>
                      {program.description ? (
                        <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted">
                          {program.description}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-sm text-muted">
                          {lessonCount} lesson{lessonCount === 1 ? "" : "s"}
                          {lessonCount === 0 ? " · audio coming soon" : ""}
                        </p>
                      )}
                      <div className="mt-auto flex flex-wrap items-center gap-3 pt-3">
                        {program.description ? (
                          <span className="text-xs text-muted">
                            {lessonCount} lesson
                            {lessonCount === 1 ? "" : "s"}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => openProgram(program)}
                          className="cursor-pointer rounded-full accent-fill-gradient px-4 py-2 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
                        >
                          Explore course
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          );
        })()
      ) : error ? (
        <p className="mt-6 w-full min-w-0 rounded-xl border border-border bg-card px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {libraryTab !== "programs" &&
      libraryTab === "meditations" &&
      loading &&
      pagedVisibleItems.length === 0 ? (
        <p className="mt-10 text-sm text-muted">Loading…</p>
      ) : libraryTab !== "programs" && pagedVisibleItems.length === 0 ? (
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
      ) : libraryTab !== "programs" ? (
        <ul
          className={
            viewMode === "grid"
              ? `${libraryTab === "community" ? "mt-4" : "mt-10"} flex w-full min-w-0 max-w-full flex-col gap-3 sm:grid sm:grid-cols-2 sm:gap-4 lg:grid-cols-3`
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
      ) : null}

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

    {mobileFilterOpen ? (
      <div
        className="fixed inset-0 z-[60] flex items-end justify-center bg-overlay/45 p-4 backdrop-blur-[2px] sm:hidden"
        role="presentation"
        onClick={() => setMobileFilterOpen(false)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="library-mobile-filter-title"
          className="max-h-[min(85vh,32rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <h2
              id="library-mobile-filter-title"
              className="font-display text-lg font-medium text-foreground"
            >
              Sort & filter
            </h2>
            <button
              type="button"
              onClick={() => setMobileFilterOpen(false)}
              className="cursor-pointer rounded-lg px-2 py-1 text-sm text-muted hover:bg-accent-soft/50 hover:text-foreground"
            >
              Done
            </button>
          </div>
          <section className="mt-5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Sort
            </h3>
            <div className="mt-2 flex flex-col gap-1" role="listbox" aria-label="Sort library">
              {sortItems.map((it) => {
                const selected = sortBy === it.value;
                return (
                  <button
                    key={it.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => setSortBy(it.value)}
                    className={`w-full cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${
                      selected
                        ? "bg-selected/15 text-foreground"
                        : "text-muted hover:bg-accent-soft/40 hover:text-foreground"
                    }`}
                  >
                    {it.label}
                  </button>
                );
              })}
            </div>
          </section>
          <section className="mt-5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Category
            </h3>
            <div
              className="mt-2 flex flex-col gap-1"
              role="listbox"
              aria-label="Filter category"
            >
              {categoryItems.map((it) => {
                const selected = categoryFilter === it.value;
                return (
                  <button
                    key={it.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => setCategoryFilter(it.value)}
                    className={`w-full cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${
                      selected
                        ? "bg-selected/15 text-foreground"
                        : "text-muted hover:bg-accent-soft/40 hover:text-foreground"
                    }`}
                  >
                    {it.label}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    ) : null}

    {mixEditor ? (
      <LibraryMixEditorModal
        item={mixEditor}
        anchorEl={mixAnchorEl}
        natureItems={mixNature}
        musicItems={mixMusic}
        drumsItems={mixDrums}
        noiseItems={mixNoise}
        compositionItems={mixCompositions}
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
              className="cursor-pointer rounded-lg accent-fill-gradient px-3 py-2 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
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
