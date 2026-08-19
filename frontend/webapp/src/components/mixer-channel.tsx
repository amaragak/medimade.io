"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Switch from "@radix-ui/react-switch";
import type { BackgroundAudioItem } from "@/lib/medimade-api";
import type { SoundCategoryId } from "@/lib/sound-taxonomy";
import { SoundFolderSelect } from "@/components/sound-folder-select";

function MixerVoiceIcon() {
  return (
    <div className="mixer-voice-disc flex h-24 w-24 items-center justify-center rounded-full text-on-accent">
      <svg
        viewBox="0 0 24 24"
        className="h-14 w-14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <line x1="4" y1="12" x2="4" y2="12" strokeWidth="2.2" />
        <line x1="7" y1="9" x2="7" y2="15" />
        <line x1="10" y1="6" x2="10" y2="18" />
        <line x1="13" y1="4" x2="13" y2="20" />
        <line x1="16" y1="7" x2="16" y2="17" />
        <line x1="19" y1="10" x2="19" y2="14" />
      </svg>
    </div>
  );
}

function MixerPlayPauseIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="currentColor"
      aria-hidden
    >
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

function MixerStrip({
  label,
  picker,
  meter,
  playing,
  onTogglePreview,
  playDisabled,
  playAriaLabel,
}: {
  label: string;
  picker: ReactNode;
  meter: ReactNode;
  playing: boolean;
  onTogglePreview: () => void;
  playDisabled?: boolean;
  playAriaLabel: string;
}) {
  return (
    <div className="flex h-full min-w-[5.75rem] w-full flex-1 flex-col items-stretch gap-2.5 rounded-2xl border border-border bg-background px-2 py-3">
      <span className="shrink-0 text-center text-sm font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      <div className="shrink-0">{picker}</div>
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1">
        {meter}
      </div>
      <button
        type="button"
        onClick={onTogglePreview}
        disabled={playDisabled}
        aria-label={playAriaLabel}
        className="mx-auto flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <MixerPlayPauseIcon playing={playing} />
      </button>
    </div>
  );
}

export function MixerChannel({
  label,
  category,
  items,
  value,
  onChange,
  gain,
  onGainChange,
  disabled,
  faderDisabled,
  playing,
  onTogglePreview,
  playDisabled,
  playAriaLabel,
}: {
  label: string;
  category: SoundCategoryId;
  items: BackgroundAudioItem[];
  value: string;
  onChange: (key: string) => void;
  gain: number;
  onGainChange: (gain: number) => void;
  disabled?: boolean;
  faderDisabled?: boolean;
  playing: boolean;
  onTogglePreview: () => void;
  playDisabled?: boolean;
  playAriaLabel: string;
}) {
  return (
    <MixerStrip
      label={label}
      picker={
        <SoundFolderSelect
          category={category}
          items={items}
          value={value}
          onChange={onChange}
          disabled={disabled}
          compact
        />
      }
      meter={
        <>
          <span className="h-4 shrink-0 text-[11px] tabular-nums text-muted">
            {gain}%
          </span>
          <div className="mixer-fader-well">
            <input
              aria-label={`${label} level`}
              type="range"
              min={0}
              max={100}
              value={gain}
              onChange={(e) => onGainChange(Number(e.target.value))}
              disabled={faderDisabled}
              className="mixer-fader disabled:opacity-40"
              style={{
                background: `linear-gradient(to top, var(--accent) ${gain}%, var(--border) ${gain}%)`,
              }}
            />
          </div>
        </>
      }
      playing={playing}
      onTogglePreview={onTogglePreview}
      playDisabled={playDisabled}
      playAriaLabel={playAriaLabel}
    />
  );
}

function MixerSpeakerSelect({
  voices,
  value,
  onChange,
  disabled,
}: {
  voices: Array<{ modelId: string; name: string }>;
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const selected = voices.find((s) => s.modelId === value);
  const label = selected?.name || "Voice";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null;
      if (!t || rootRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Voice"
        title={label}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        className="flex w-full min-w-0 items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-left text-sm disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <svg
          viewBox="0 0 24 24"
          className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div
          className="absolute left-1/2 top-full z-[90] mt-1 max-h-64 min-w-[13rem] -translate-x-1/2 overflow-auto rounded-xl border border-border bg-card py-1 shadow-xl"
          role="listbox"
        >
          {voices.map((s) => (
            <button
              key={s.modelId}
              type="button"
              className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-background ${
                s.modelId === value ? "font-medium text-foreground" : "text-muted"
              }`}
              onClick={() => {
                onChange(s.modelId);
                setOpen(false);
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MixerVoiceChannel({
  voices,
  value,
  onChange,
  disabled,
  fxOn,
  onFxChange,
  fxDisabled,
  playing,
  onTogglePreview,
  playDisabled,
}: {
  voices: Array<{ modelId: string; name: string; description?: string }>;
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  fxOn: boolean;
  onFxChange: (on: boolean) => void;
  fxDisabled?: boolean;
  playing: boolean;
  onTogglePreview: () => void;
  playDisabled?: boolean;
}) {
  const description = voices
    .find((s) => s.modelId === value)
    ?.description?.trim();
  return (
    <MixerStrip
      label="Voice"
      picker={
        <div className="flex min-w-0 items-center gap-1.5">
          <MixerSpeakerSelect
            voices={voices}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
          <div
            className="flex shrink-0 flex-col items-center gap-0.5"
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
              aria-label={
                fxOn ? "Turn speaker FX off" : "Turn speaker FX on"
              }
              className="relative h-4 w-8 cursor-pointer rounded-full border border-border bg-muted/30 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Switch.Thumb className="block h-3 w-3 translate-x-[2px] rounded-full bg-surface shadow transition-transform will-change-transform data-[state=checked]:translate-x-[18px]" />
            </Switch.Root>
          </div>
        </div>
      }
      meter={
        <div className="relative flex min-h-[7rem] w-full flex-1 items-center justify-center">
          {description ? (
            <p className="absolute inset-x-0 top-0 z-10 text-sm leading-snug text-muted">
              {description}
            </p>
          ) : null}
          <MixerVoiceIcon />
        </div>
      }
      playing={playing}
      onTogglePreview={onTogglePreview}
      playDisabled={playDisabled}
      playAriaLabel={playing ? "Pause speaker sample" : "Play speaker sample"}
    />
  );
}
