"use client";

import { useEffect, useRef, useState } from "react";
import * as Switch from "@radix-ui/react-switch";

type Voice = {
  modelId: string;
  name: string;
  description?: string;
  goodFor?: string[];
  gender?: "male" | "female";
};

type VoiceCardRowProps = {
  voices: Voice[];
  value: string;
  onChange: (modelId: string) => void;
  /** Null while the media base URL is unknown, which disables previews. */
  previewUrl: (modelId: string) => string | null;
  disabled?: boolean;
  /**
   * FX is a single Pedalboard preset applied to the rendered narration, not a
   * per-voice capability, so one control governs whichever voice is selected.
   */
  fxOn: boolean;
  onFxChange: (on: boolean) => void;
  fxDisabled?: boolean;
  /** Bump to stop a running preview from outside, e.g. when generation starts. */
  stopNonce?: number;
};

function PlayPauseIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor" aria-hidden>
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

export function VoiceCardRow({
  voices,
  value,
  onChange,
  previewUrl,
  disabled,
  fxOn,
  onFxChange,
  fxDisabled,
  stopNonce = 0,
}: VoiceCardRowProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  useEffect(
    () => () => {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.removeAttribute("src");
      }
    },
    [],
  );

  // Flipping FX changes which sample every card plays, so a running preview is
  // stale; `stopNonce` is the caller silencing it for the same reason.
  useEffect(() => {
    audioRef.current?.pause();
    setPreviewingId(null);
  }, [fxOn, stopNonce]);

  async function togglePreview(modelId: string) {
    const el = audioRef.current;
    const url = previewUrl(modelId);
    if (!el || !url) return;
    if (previewingId === modelId && !el.paused) {
      el.pause();
      setPreviewingId(null);
      return;
    }
    if (el.src !== url) {
      el.src = url;
      el.load();
    }
    try {
      await el.play();
      setPreviewingId(modelId);
    } catch {
      setPreviewingId(null);
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-medium tracking-tight text-foreground">
          Voice
        </h2>
        <div
          className="flex shrink-0 items-center gap-2"
          title={
            fxOn
              ? "Preview uses mixer FX (WAV on CDN)."
              : "Preview uses loudness-normalized MP3 on CDN."
          }
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            FX
          </span>
          <Switch.Root
            checked={fxOn}
            onCheckedChange={(v) => onFxChange(Boolean(v))}
            disabled={fxDisabled}
            aria-label={fxOn ? "Turn voice FX off" : "Turn voice FX on"}
            className="relative h-4 w-8 cursor-pointer rounded-full border border-border bg-muted/30 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Switch.Thumb className="block h-3 w-3 translate-x-[2px] rounded-full bg-surface shadow transition-transform will-change-transform data-[state=checked]:translate-x-[18px]" />
          </Switch.Root>
        </div>
      </div>

      {/* One row, so the cards stretch to a shared height — the tallest
          description sets it, and the bottom edge stays level. */}
      <div className="flex items-stretch gap-3 overflow-x-auto pb-1">
        {voices.map((voice) => {
          const selected = voice.modelId === value;
          const playing = previewingId === voice.modelId;
          // Gender leads the pills when set; "not specified" simply has none.
          const tags = [...(voice.gender ? [voice.gender] : []), ...(voice.goodFor ?? [])];
          return (
            <div
              key={voice.modelId}
              className={`flex w-[196px] min-w-[196px] max-w-[196px] shrink-0 grow-0 flex-col gap-1.5 rounded-2xl bg-card p-3.5 shadow-sm transition-colors ${
                selected
                  ? "border-2 border-accent"
                  : "border border-border hover:border-accent/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={disabled || !previewUrl(voice.modelId)}
                  onClick={() => void togglePreview(voice.modelId)}
                  aria-label={
                    playing ? `Pause ${voice.name} sample` : `Play ${voice.name} sample`
                  }
                  className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-accent-link transition-colors hover:bg-accent-soft/40 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <PlayPauseIcon playing={playing} />
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(voice.modelId)}
                  aria-pressed={selected}
                  className="min-w-0 flex-1 cursor-pointer truncate text-left font-display text-[15px] font-medium leading-tight text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {voice.name}
                </button>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(voice.modelId)}
                aria-pressed={selected}
                className="cursor-pointer text-left disabled:cursor-not-allowed disabled:opacity-60"
              >
                    {/* Two lines are reserved whatever the description length,
                        so the tag pills sit level across the row. */}
                    <span className="block min-h-[2.75em] text-xs leading-snug text-muted">
                      {voice.description?.trim() ?? ""}
                    </span>
                {tags.length > 0 ? (
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-accent/30 bg-accent-soft/50 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-accent-link"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
            </div>
          );
        })}
      </div>
      {/* Samples are short, so they loop until the card is toggled off. */}
      <audio ref={audioRef} className="hidden" playsInline loop />
    </section>
  );
}
