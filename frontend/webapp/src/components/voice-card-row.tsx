"use client";

import { useEffect, useRef, useState } from "react";
import { applySpeechElementVolume } from "@/lib/bed-volume";

const LAST_VOICE_STORAGE_KEY = "mm_last_fish_voice_v1";
/** Pause between preview sample repeats (matches create-flow speaker bed). */
const PREVIEW_REPEAT_GAP_MS = 3000;

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
  /** Bump to stop a running preview from outside, e.g. when generation starts. */
  stopNonce?: number;
};

function readLastVoiceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_VOICE_STORAGE_KEY)?.trim();
    return raw || null;
  } catch {
    return null;
  }
}

function writeLastVoiceId(modelId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_VOICE_STORAGE_KEY, modelId);
  } catch {
    /* ignore */
  }
}

function PlayPauseIcon({
  playing,
  size = 14,
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

export function VoiceCardRow({
  voices,
  value,
  onChange,
  previewUrl,
  disabled,
  stopNonce = 0,
}: VoiceCardRowProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const gapTimeoutRef = useRef<number | null>(null);
  const repeatWantedRef = useRef(false);
  const previewingIdRef = useRef<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const hydratedRef = useRef(false);

  function clearGapSchedule() {
    if (gapTimeoutRef.current !== null) {
      window.clearTimeout(gapTimeoutRef.current);
      gapTimeoutRef.current = null;
    }
  }

  function stopPreview() {
    clearGapSchedule();
    repeatWantedRef.current = false;
    previewingIdRef.current = null;
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    setPreviewingId(null);
  }

  useEffect(() => {
    if (hydratedRef.current || voices.length === 0) return;
    hydratedRef.current = true;
    const last = readLastVoiceId();
    const hasHistory = Boolean(
      last && voices.some((v) => v.modelId === last),
    );
    setExpanded(!hasHistory);
    if (hasHistory && last && last !== value) {
      onChange(last);
    } else if (!value || !voices.some((v) => v.modelId === value)) {
      onChange(voices[0]!.modelId);
    }
    // Only on first voices load — parent may also set a default.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot hydrate
  }, [voices]);

  useEffect(
    () => () => {
      clearGapSchedule();
      repeatWantedRef.current = false;
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.removeAttribute("src");
      }
    },
    [],
  );

  useEffect(() => {
    stopPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stop on external nonce only
  }, [stopNonce]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onEnded = () => {
      if (!repeatWantedRef.current || !previewingIdRef.current) return;
      clearGapSchedule();
      // Keep playing UI during the gap between sample repeats.
      gapTimeoutRef.current = window.setTimeout(() => {
        gapTimeoutRef.current = null;
        if (!repeatWantedRef.current) return;
        const a = audioRef.current;
        if (!a?.src) return;
        applySpeechElementVolume(a);
        void a.play().catch(() => {
          stopPreview();
        });
      }, PREVIEW_REPEAT_GAP_MS);
    };
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("ended", onEnded);
      clearGapSchedule();
    };
  }, []);

  async function startPreview(modelId: string) {
    const el = audioRef.current;
    const url = previewUrl(modelId);
    if (!el || !url) return;
    clearGapSchedule();
    repeatWantedRef.current = true;
    previewingIdRef.current = modelId;
    setPreviewingId(modelId);
    if (el.src !== url) {
      el.src = url;
      el.load();
    } else {
      el.currentTime = 0;
    }
    // load() resets volume — keep narration at full scale.
    applySpeechElementVolume(el);
    try {
      await el.play();
      applySpeechElementVolume(el);
    } catch {
      stopPreview();
    }
  }

  /** Select the voice and play (or pause if already previewing this one). */
  function activateVoice(modelId: string) {
    if (disabled) return;
    writeLastVoiceId(modelId);
    if (modelId !== value) onChange(modelId);
    if (previewingIdRef.current === modelId) {
      stopPreview();
      return;
    }
    void startPreview(modelId);
  }

  const labelClass =
    "w-12 shrink-0 text-xs font-semibold uppercase tracking-[0.12em] text-foreground";

  return (
    <section className="mb-7 border-b border-border pb-7">
      {expanded ? (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className={labelClass}>Voice</span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="cursor-pointer text-xs text-muted transition-colors hover:text-foreground"
            >
              Collapse ↑
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {voices.map((voice) => {
              const selected = voice.modelId === value;
              const playing = previewingId === voice.modelId;
              const tags = [
                ...(voice.gender ? [voice.gender] : []),
                ...(voice.goodFor ?? []),
              ];
              const canPreview = Boolean(previewUrl(voice.modelId));
              return (
                <button
                  key={voice.modelId}
                  type="button"
                  disabled={disabled || !canPreview}
                  aria-pressed={selected}
                  aria-label={
                    playing
                      ? `Pause ${voice.name} sample`
                      : `Select and play ${voice.name}`
                  }
                  onClick={() => activateVoice(voice.modelId)}
                  className={`cursor-pointer rounded-[6px] border-2 p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    selected
                      ? "border-accent bg-card"
                      : "border-border bg-card hover:border-accent/40"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
                        selected
                          ? "bg-accent-button text-on-accent"
                          : "bg-accent/20 text-accent-link"
                      }`}
                      aria-hidden
                    >
                      <PlayPauseIcon playing={playing} size={12} />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-display text-[15px] font-normal text-foreground">
                      {voice.name}
                    </span>
                  </div>
                  <p className="mt-2 min-h-[2.25em] text-xs leading-[1.5] text-muted">
                    {voice.description?.trim() ?? ""}
                  </p>
                  {tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-[8px] bg-accent-soft/50 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-accent-link"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-3">
          <span className={labelClass}>Voice</span>
          <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-x-auto py-0.5">
            {voices.map((voice) => {
              const selected = voice.modelId === value;
              const playing = previewingId === voice.modelId;
              const canPreview = Boolean(previewUrl(voice.modelId));
              return (
                <button
                  key={voice.modelId}
                  type="button"
                  disabled={disabled || !canPreview}
                  aria-pressed={selected}
                  aria-label={
                    playing
                      ? `Pause ${voice.name} sample`
                      : `Select and play ${voice.name}`
                  }
                  onClick={() => activateVoice(voice.modelId)}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-full border-2 px-3.5 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    selected
                      ? "border-accent bg-card"
                      : "border-border bg-card"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors ${
                      selected
                        ? "bg-accent-button text-on-accent"
                        : "bg-accent/20 text-accent-link"
                    }`}
                    aria-hidden
                  >
                    <PlayPauseIcon playing={playing} size={10} />
                  </span>
                  <span
                    className={`text-sm leading-none ${
                      selected ? "font-medium" : "font-normal"
                    } text-foreground`}
                  >
                    {voice.name}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="ml-auto shrink-0 cursor-pointer text-xs text-muted transition-colors hover:text-foreground"
          >
            Details ↓
          </button>
        </div>
      )}
      <audio ref={audioRef} className="hidden" playsInline />
    </section>
  );
}
