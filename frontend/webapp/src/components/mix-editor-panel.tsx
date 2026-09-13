"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DrumsLockedWrap } from "@/components/drums-locked-wrap";
import { SegmentedPillTabs } from "@/components/segmented-pill-tabs";
import { SoundFolderSelect } from "@/components/sound-folder-select";
import { SoundscapePicker } from "@/components/soundscape-picker";
import { SOUNDSCAPE_ELEMENT_VOLUME } from "@/lib/bed-volume";
import { playWithLeadBuffer } from "@/lib/audio-lead-buffer";
import {
  backgroundAudioStreamingKey,
  getMedimadeMediaBaseUrl,
  type BackgroundAudioItem,
} from "@/lib/medimade-api";
import { isMelodicMusicKey } from "@/lib/sound-taxonomy";
import type { BedVolumeChannel } from "@/components/library-player-provider";

/** Mixer gain persisted for a soundscape; live playback uses its own volume. */
export const SOUNDSCAPE_MIX_GAIN = 100;

export type MixEditorValues = {
  natureKey: string;
  musicKey: string;
  drumsKey: string;
  noiseKey: string;
  natureGain: number;
  musicGain: number;
  drumsGain: number;
  noiseGain: number;
};

export const DEFAULT_MIX_EDITOR_VALUES: MixEditorValues = {
  natureKey: "",
  musicKey: "",
  drumsKey: "",
  noiseKey: "",
  natureGain: 25,
  musicGain: 50,
  drumsGain: 40,
  noiseGain: 10,
};

export function mixWithGain(
  mix: MixEditorValues,
  channel: BedVolumeChannel,
  gain: number,
): MixEditorValues {
  if (channel === "music") return { ...mix, musicGain: gain };
  if (channel === "nature") return { ...mix, natureGain: gain };
  if (channel === "drums") return { ...mix, drumsGain: gain };
  return { ...mix, noiseGain: gain };
}

export function mixWithKey(
  mix: MixEditorValues,
  channel: BedVolumeChannel,
  key: string,
): MixEditorValues {
  if (channel === "music") return { ...mix, musicKey: key };
  if (channel === "nature") return { ...mix, natureKey: key };
  if (channel === "drums") return { ...mix, drumsKey: key };
  return { ...mix, noiseKey: key };
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

const MixVerticalFader = memo(
  function MixVerticalFader({
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
        <span ref={labelRef} className="tabular-nums text-xs text-muted">
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
  },
  (a, b) =>
    a.label === b.label &&
    a.disabled === b.disabled &&
    a.initialGain === b.initialGain,
);

export function MixEditorPanel({
  title,
  editorKey,
  anchorEl,
  natureItems,
  musicItems,
  drumsItems,
  noiseItems,
  compositionItems,
  error,
  initialMix,
  resetMix,
  onLiveVolume,
  onPreview,
  onPersist,
  onClose,
  closeRef,
  placement = "above-end",
  showReset = true,
  disableLocalPreview = false,
  stripPlayingMusicKey = null,
  repositionToken = 0,
  bottomInsetPx = 0,
}: {
  title: string;
  /** Remount / reposition key (e.g. meditation sk). */
  editorKey: string;
  anchorEl: HTMLElement | null;
  natureItems: BackgroundAudioItem[];
  musicItems: BackgroundAudioItem[];
  drumsItems: BackgroundAudioItem[];
  noiseItems: BackgroundAudioItem[];
  compositionItems: BackgroundAudioItem[];
  error: string | null;
  initialMix: MixEditorValues;
  resetMix: MixEditorValues;
  onLiveVolume: (channel: BedVolumeChannel, gain: number) => void;
  onPreview: (mix: MixEditorValues) => void;
  onPersist: (mix: MixEditorValues) => void | Promise<void>;
  onClose: () => void;
  closeRef: { current: (() => void) | null };
  /** Library: above-end. Focus Sounds (top-right): below-end. */
  placement?: "above-end" | "below-start" | "above-start" | "below-end";
  /** Library keeps reset-to-original; Focus can hide it. */
  showReset?: boolean;
  /** When true, soundscape clicks preview via onPreview only (no in-panel audio). */
  disableLocalPreview?: boolean;
  /** Focus strip: which music/soundscape key is currently playing (for picker chrome). */
  stripPlayingMusicKey?: string | null;
  /** Change when the anchor moves (e.g. audio strip lift) so the panel re-places. */
  repositionToken?: number;
  /** Reserve space at the viewport bottom (e.g. audio strip height). */
  bottomInsetPx?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [natureKey, setNatureKey] = useState(() => initialMix.natureKey);
  const [musicKey, setMusicKey] = useState(() => initialMix.musicKey);
  const [drumsKey, setDrumsKey] = useState(() => initialMix.drumsKey);
  const [noiseKey, setNoiseKey] = useState(() => initialMix.noiseKey);
  const [natureGain, setNatureGain] = useState(() => initialMix.natureGain);
  const [musicGain, setMusicGain] = useState(() => initialMix.musicGain);
  const [drumsGain, setDrumsGain] = useState(() => initialMix.drumsGain);
  const [noiseGain, setNoiseGain] = useState(() => initialMix.noiseGain);
  const mixRef = useRef<MixEditorValues>({
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

  function previewNow(next: MixEditorValues) {
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
  /** Catalog key for the current soundscape (storage key may differ by extension). */
  const soundscapeValueKey = soundscapeSelected
    ? (compositionItems.find(
        (c) =>
          backgroundAudioStreamingKey(c.key) ===
          backgroundAudioStreamingKey(musicKey),
      )?.key ?? musicKey)
    : "";
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
    const next: MixEditorValues = {
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
      const bottomLimit =
        window.innerHeight - 8 - Math.max(0, bottomInsetPx);
      let left: number;
      let top: number;
      if (placement === "below-start") {
        left = a.left;
        top = a.bottom + gap;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        if (top + h > bottomLimit) {
          top = Math.max(8, bottomLimit - h);
        }
      } else if (placement === "below-end") {
        left = a.right - w;
        top = a.bottom + gap;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        if (top + h > bottomLimit) {
          top = Math.max(8, bottomLimit - h);
        }
      } else if (placement === "above-start") {
        left = a.left;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        // Prefer directly above the anchor; never flip under it into the player.
        top = a.top - h - gap;
        if (top + h > bottomLimit) {
          top = bottomLimit - h;
        }
        if (top < 8) top = 8;
      } else {
        left = a.right - w;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        top = a.top - h - gap;
        if (top < 8) top = a.bottom + gap;
        if (top + h > bottomLimit) {
          top = Math.max(8, bottomLimit - h);
        }
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
  }, [anchorEl, editorKey, placement, repositionToken, bottomInsetPx]);

  const panelMaxHeight =
    typeof window !== "undefined"
      ? Math.max(160, window.innerHeight - 16 - Math.max(0, bottomInsetPx))
      : undefined;

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
      className="fixed z-[80] w-[28rem] overflow-y-auto overflow-x-visible rounded-xl border border-border bg-card p-4 text-sm text-foreground shadow-xl transition-[top] duration-150 ease-out"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        maxHeight: panelMaxHeight,
      }}
    >
      {(title.trim() || showReset) ? (
        <div className="flex items-start justify-between gap-2">
          {title.trim() ? (
            <p className="min-w-0 truncate text-sm font-semibold text-foreground">
              {title}
            </p>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          {showReset ? (
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
          ) : null}
        </div>
      ) : null}
      <div className="mt-3">
        <SegmentedPillTabs
          aria-label="Sound bed"
          value={bedTab}
          onChange={(id) => {
            // Leaving a soundscape frees the music slot for a mixer sample.
            if (id === "mixer" && soundscapeSelected) {
              const next = mixWithKey(mixRef.current, "music", "");
              setMusicKey("");
              mixRef.current = next;
              previewNow(next);
            }
            setBedTab(id);
          }}
          options={[
            { id: "soundscape" as const, label: "Soundscape" },
            { id: "mixer" as const, label: "Build your own" },
          ]}
        />
      </div>
      {bedTab === "soundscape" ? (
        <div className="mt-3 max-h-72 overflow-y-auto pr-1">
          <SoundscapePicker
            variant="create"
            compact
            items={compositionItems}
            value={soundscapeValueKey}
            onChange={chooseSoundscape}
            previewUrl={soundscapePreviewUrl}
            playingKey={
              disableLocalPreview ? stripPlayingMusicKey : previewKey
            }
            requirePreviewUrl={!disableLocalPreview}
            onTogglePreview={(key) => {
              if (disableLocalPreview) {
                // Always sync playback — a saved selection can look selected
                // without the strip having started yet.
                if (
                  backgroundAudioStreamingKey(musicKey) !==
                  backgroundAudioStreamingKey(key)
                ) {
                  chooseSoundscape(key);
                } else {
                  previewNow(mixRef.current);
                }
                return;
              }
              toggleSoundscapePreview(key);
            }}
          />
          {disableLocalPreview ? null : (
            <audio
              ref={previewRef}
              className="hidden"
              playsInline
              onEnded={() => setPreviewKey(null)}
            />
          )}
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
                    mixRef.current = mixWithGain(
                      mixRef.current,
                      row.channel,
                      gain,
                    );
                    onLiveVolume(row.channel, gain);
                  }}
                  onCommit={(gain) => {
                    const next = mixWithGain(
                      mixRef.current,
                      row.channel,
                      gain,
                    );
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
                    const next = mixWithKey(
                      mixRef.current,
                      row.channel,
                      value,
                    );
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
