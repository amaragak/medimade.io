"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import * as Switch from "@radix-ui/react-switch";
import type { BackgroundAudioItem } from "@/lib/medimade-api";
import type { SoundCategoryId } from "@/lib/sound-taxonomy";
import { SoundFolderSelect } from "@/components/sound-folder-select";
import { FactoryIcon } from "@/components/factory-icons";
import type { MixerFactoryPreset } from "@/lib/mixer-factory-presets";
import type { MixerPreset } from "@/lib/mixer-preset-storage";

export type MixerLayout = "column" | "row";

const ROW_LABEL =
  "w-[3.75rem] shrink-0 text-xs font-semibold uppercase tracking-wide text-muted";
const ROW_SEP =
  "relative border-b border-border/70 py-3 last:border-b-0 has-[[aria-expanded=true]]:z-20";

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

function MixerPlayPauseIcon({
  playing,
  size = 22,
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
        className="mx-auto flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full accent-fill-gradient text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <MixerPlayPauseIcon playing={playing} />
      </button>
    </div>
  );
}

function MixerRowPlayButton({
  playing,
  onTogglePreview,
  playDisabled,
  playAriaLabel,
}: {
  playing: boolean;
  onTogglePreview: () => void;
  playDisabled?: boolean;
  playAriaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onTogglePreview}
      disabled={playDisabled}
      aria-label={playAriaLabel}
      className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full accent-fill-gradient text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <MixerPlayPauseIcon playing={playing} size={14} />
    </button>
  );
}

/** Uncontrolled fader: live audio via onLiveGainChange; React state via onGainChange on commit. */
function MixerGainFader({
  label,
  initialGain,
  onLiveGainChange,
  onGainChange,
  disabled,
  orientation,
}: {
  label: string;
  initialGain: number;
  onLiveGainChange?: (gain: number) => void;
  onGainChange: (gain: number) => void;
  disabled?: boolean;
  orientation: "vertical" | "horizontal";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const gainRef = useRef(initialGain);
  const liveRef = useRef(onLiveGainChange);
  const commitRef = useRef(onGainChange);
  const draggingRef = useRef(false);

  liveRef.current = onLiveGainChange;
  commitRef.current = onGainChange;

  useEffect(() => {
    if (draggingRef.current) return;
    gainRef.current = initialGain;
    const el = inputRef.current;
    if (el) {
      el.value = String(initialGain);
      el.style.background =
        orientation === "horizontal"
          ? `linear-gradient(to right, var(--accent) ${initialGain}%, var(--border) ${initialGain}%)`
          : `linear-gradient(to top, var(--accent) ${initialGain}%, var(--border) ${initialGain}%)`;
    }
    if (labelRef.current) labelRef.current.textContent = `${initialGain}%`;
  }, [initialGain, orientation]);

  function onInput(e: FormEvent<HTMLInputElement>) {
    draggingRef.current = true;
    const v = Number(e.currentTarget.value);
    if (!Number.isFinite(v)) return;
    gainRef.current = v;
    if (labelRef.current) labelRef.current.textContent = `${v}%`;
    e.currentTarget.style.background =
      orientation === "horizontal"
        ? `linear-gradient(to right, var(--accent) ${v}%, var(--border) ${v}%)`
        : `linear-gradient(to top, var(--accent) ${v}%, var(--border) ${v}%)`;
    liveRef.current?.(v);
  }

  function commit() {
    draggingRef.current = false;
    const v = gainRef.current;
    liveRef.current?.(v);
    commitRef.current(v);
  }

  if (orientation === "horizontal") {
    return (
      <>
        <div className="mixer-fader-h-well min-w-0 flex-1">
          <input
            ref={inputRef}
            aria-label={`${label} level`}
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
            className="mixer-fader-h disabled:opacity-40"
            style={{
              background: `linear-gradient(to right, var(--accent) ${initialGain}%, var(--border) ${initialGain}%)`,
            }}
          />
        </div>
        <span
          ref={labelRef}
          className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted"
        >
          {initialGain}%
        </span>
      </>
    );
  }

  return (
    <>
      <span
        ref={labelRef}
        className="h-4 shrink-0 text-[11px] tabular-nums text-muted"
      >
        {initialGain}%
      </span>
      <div className="mixer-fader-well">
        <input
          ref={inputRef}
          aria-label={`${label} level`}
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
          className="mixer-fader disabled:opacity-40"
          style={{
            background: `linear-gradient(to top, var(--accent) ${initialGain}%, var(--border) ${initialGain}%)`,
          }}
        />
      </div>
    </>
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
  onLiveGainChange,
  disabled,
  faderDisabled,
  playing,
  onTogglePreview,
  playDisabled,
  playAriaLabel,
  layout = "column",
}: {
  label: string;
  category: SoundCategoryId;
  items: BackgroundAudioItem[];
  value: string;
  onChange: (key: string) => void;
  gain: number;
  onGainChange: (gain: number) => void;
  /** Immediate audio volume while dragging — avoid setState here. */
  onLiveGainChange?: (gain: number) => void;
  disabled?: boolean;
  faderDisabled?: boolean;
  playing: boolean;
  onTogglePreview: () => void;
  playDisabled?: boolean;
  playAriaLabel: string;
  layout?: MixerLayout;
}) {
  const active = Boolean(value);
  const picker = (
    <SoundFolderSelect
      category={category}
      items={items}
      value={value}
      onChange={onChange}
      disabled={disabled}
      compact
    />
  );

  if (layout === "row") {
    return (
      <div className={ROW_SEP}>
        <div className="flex min-w-0 items-center gap-2">
          <span className={`${ROW_LABEL} ${!active ? "opacity-40" : ""}`}>
            {label}
          </span>
          <div
            className={`min-w-0 flex-1 ${
              !active ? "[&_button[aria-haspopup=listbox]]:opacity-40" : ""
            }`}
          >
            {picker}
          </div>
        </div>
        {active ? (
          <div className="mt-2 flex min-w-0 items-center gap-2">
            <span className="w-[3.75rem] shrink-0" aria-hidden />
            <MixerGainFader
              label={label}
              initialGain={gain}
              onLiveGainChange={onLiveGainChange}
              onGainChange={onGainChange}
              disabled={faderDisabled}
              orientation="horizontal"
            />
            <MixerRowPlayButton
              playing={playing}
              onTogglePreview={onTogglePreview}
              playDisabled={playDisabled}
              playAriaLabel={playAriaLabel}
            />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <MixerStrip
      label={label}
      picker={picker}
      meter={
        <MixerGainFader
          label={label}
          initialGain={gain}
          onLiveGainChange={onLiveGainChange}
          onGainChange={onGainChange}
          disabled={faderDisabled}
          orientation="vertical"
        />
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
  showDisc = false,
  layout = "column",
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
  showDisc?: boolean;
  layout?: MixerLayout;
}) {
  const description = voices
    .find((s) => s.modelId === value)
    ?.description?.trim();

  const fxControl = (
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
        aria-label={fxOn ? "Turn speaker FX off" : "Turn speaker FX on"}
        className="relative h-4 w-8 cursor-pointer rounded-full border border-border bg-muted/30 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Switch.Thumb className="block h-3 w-3 translate-x-[2px] rounded-full bg-surface shadow transition-transform will-change-transform data-[state=checked]:translate-x-[18px]" />
      </Switch.Root>
    </div>
  );

  if (layout === "row") {
    return (
      <div className={ROW_SEP}>
        <div className="flex min-w-0 items-center gap-2">
          <span className={ROW_LABEL}>Voice</span>
          <MixerSpeakerSelect
            voices={voices}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
          {fxControl}
          <MixerRowPlayButton
            playing={playing}
            onTogglePreview={onTogglePreview}
            playDisabled={playDisabled}
            playAriaLabel={
              playing ? "Pause speaker sample" : "Play speaker sample"
            }
          />
        </div>
        {description ? (
          <p className="mt-1.5 pl-[4.25rem] text-sm leading-snug text-muted">
            {description}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <MixerStrip
      label="Voice"
      picker={
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <MixerSpeakerSelect
              voices={voices}
              value={value}
              onChange={onChange}
              disabled={disabled}
            />
            {fxControl}
          </div>
          {!showDisc && description ? (
            <p className="px-0.5 text-center text-sm leading-snug text-muted">
              {description}
            </p>
          ) : null}
        </div>
      }
      meter={
        showDisc ? (
          <div className="relative flex min-h-[7rem] w-full flex-1 items-center justify-center">
            {description ? (
              <p className="absolute inset-x-0 top-0 z-10 text-sm leading-snug text-muted">
                {description}
              </p>
            ) : null}
            <MixerVoiceIcon />
          </div>
        ) : (
          <div className="min-h-0 w-full flex-1" />
        )
      }
      playing={playing}
      onTogglePreview={onTogglePreview}
      playDisabled={playDisabled}
      playAriaLabel={playing ? "Pause speaker sample" : "Play speaker sample"}
    />
  );
}

function mixOptionKey(kind: "factory" | "user", id: string) {
  return `${kind}:${id}`;
}

export function MixerPresetChannel({
  factoryPresets,
  userPresets,
  selectedKey,
  onSelect,
  onSaveNew,
  disabled,
  loading,
  showSave = false,
  modified = false,
  defaultSaveName = "Untitled mix",
  layout = "column",
}: {
  factoryPresets: MixerFactoryPreset[];
  userPresets: MixerPreset[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onSaveNew: (name: string) => void;
  disabled?: boolean;
  loading?: boolean;
  showSave?: boolean;
  modified?: boolean;
  defaultSaveName?: string;
  layout?: MixerLayout;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const selectedFactory = factoryPresets.find(
    (p) => mixOptionKey("factory", p.id) === selectedKey,
  );
  const selectedUser = userPresets.find(
    (p) => mixOptionKey("user", p.id) === selectedKey,
  );
  const label = selectedFactory?.name || selectedUser?.name || "None";
  const triggerLabel =
    modified && label !== "None" ? `${label} (edited)` : label;

  useEffect(() => {
    if (showSave) {
      setSaveName((cur) => (cur.trim() ? cur : defaultSaveName));
      return;
    }
    setSaveName("");
  }, [showSave, defaultSaveName]);

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

  function pick(key: string) {
    onSelect(key);
    setOpen(false);
  }

  const dropdown = (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        disabled={disabled || loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Sound mix preset"
        title={triggerLabel}
        onClick={() => {
          if (disabled || loading) return;
          setOpen((v) => !v);
        }}
        className={`flex w-full min-w-0 items-center gap-2 rounded-xl border border-border bg-surface text-left disabled:opacity-50 ${
          layout === "row" ? "px-2 py-1.5 text-sm" : "px-2 py-2 text-base"
        }`}
      >
        {selectedFactory ? (
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{
              backgroundColor: selectedFactory.icon_bg,
              color: selectedFactory.icon_color,
            }}
            aria-hidden
          >
            <FactoryIcon id={selectedFactory.icon} size={18} />
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">
          {loading ? "Loading…" : triggerLabel}
        </span>
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 shrink-0 text-muted transition-transform ${
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
          className={`absolute top-full z-[90] mt-1 max-h-64 min-w-[13rem] overflow-auto rounded-xl border border-border bg-card py-1 shadow-xl ${
            layout === "row"
              ? "left-0 right-0"
              : "left-1/2 -translate-x-1/2"
          }`}
          role="listbox"
        >
          <button
            type="button"
            className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-background ${
              !selectedKey ? "font-medium text-foreground" : "text-muted"
            }`}
            onClick={() => pick("")}
          >
            None
          </button>
          <p className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Factory
          </p>
          {factoryPresets.length === 0 ? (
            <p className="px-3 py-1.5 text-sm text-muted">None yet</p>
          ) : (
            factoryPresets.map((p) => {
              const key = mixOptionKey("factory", p.id);
              return (
                <button
                  key={key}
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-background ${
                    key === selectedKey
                      ? "font-medium text-foreground"
                      : "text-muted"
                  }`}
                  onClick={() => pick(key)}
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                    style={{
                      backgroundColor: p.icon_bg,
                      color: p.icon_color,
                    }}
                    aria-hidden
                  >
                    <FactoryIcon id={p.icon} size={14} />
                  </span>
                  <span className="min-w-0 truncate">{p.name}</span>
                </button>
              );
            })
          )}
          <p className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Your mixes
          </p>
          {userPresets.length === 0 ? (
            <p className="px-3 py-1.5 text-sm text-muted">None saved</p>
          ) : (
            userPresets.map((p) => {
              const key = mixOptionKey("user", p.id);
              return (
                <button
                  key={key}
                  type="button"
                  className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-background ${
                    key === selectedKey
                      ? "font-medium text-foreground"
                      : "text-muted"
                  }`}
                  onClick={() => pick(key)}
                >
                  {p.name}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );

  const saveBlock = showSave ? (
    <div
      className={`flex gap-1.5 ${
        layout === "row"
          ? "mt-2 flex-row items-center pl-[4.25rem]"
          : "h-full min-h-0 flex-col justify-end"
      }`}
    >
      <label className="sr-only" htmlFor="mixer-save-preset-name">
        New mix name
      </label>
      <input
        id="mixer-save-preset-name"
        type="text"
        value={saveName}
        onChange={(e) => setSaveName(e.target.value)}
        disabled={disabled}
        placeholder="Save as…"
        className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted disabled:opacity-50"
      />
      <button
        type="button"
        disabled={disabled || !saveName.trim()}
        onClick={() => {
          const name = saveName.trim();
          if (!name) return;
          onSaveNew(name);
          setSaveName("");
        }}
        className="shrink-0 cursor-pointer rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Save as new
      </button>
    </div>
  ) : null;

  if (layout === "row") {
    return (
      <div className={ROW_SEP}>
        <div className="flex min-w-0 items-center gap-2">
          <span className={ROW_LABEL}>Preset</span>
          {dropdown}
        </div>
        {saveBlock}
      </div>
    );
  }

  return (
    <div className="flex w-full min-h-0 flex-col items-stretch gap-2.5 rounded-2xl border border-border bg-background px-2 py-3">
      <span className="shrink-0 text-center text-sm font-semibold uppercase tracking-wide text-muted">
        Preset
      </span>
      {dropdown}
      <div className="min-h-0 flex-1">{saveBlock}</div>
    </div>
  );
}
