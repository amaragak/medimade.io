"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import {
  IconArrowRight,
  IconChevronDown,
  IconLoader2,
  IconPlayerPause,
  IconPlayerPlay,
} from "@tabler/icons-react";
import {
  getMedimadeMediaBaseUrl,
  listBackgroundAudio,
  type FishSpeaker,
} from "@/lib/medimade-api";
import {
  loadHomepageFishSpeakers,
  startHomepageOneShotGeneration,
} from "@/lib/homepage-one-shot-handoff";
import {
  FIXED_SPEECH_PREVIEW_SPEED,
  speakerPreviewLoudSampleKey,
} from "@/lib/speaker-sample-speed";

function mediaFileUrl(base: string, key: string): string {
  const b = base.replace(/\/$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${b}/${path}`;
}

function HomeHeroSpeakerPicker({
  speakers,
  value,
  onChange,
  disabled,
  mediaBaseUrl,
}: {
  speakers: FishSpeaker[];
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  mediaBaseUrl: string | null;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [open, setOpen] = useState(false);
  const [playingModelId, setPlayingModelId] = useState<string | null>(null);

  const selected = speakers.find((s) => s.modelId === value);
  const label = selected?.name || "Voice…";

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

  useEffect(() => {
    return () => {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.removeAttribute("src");
      }
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      const el = audioRef.current;
      if (el) {
        el.pause();
        setPlayingModelId(null);
      }
    }
  }, [disabled]);

  function stopSample() {
    const el = audioRef.current;
    if (el) el.pause();
    setPlayingModelId(null);
  }

  async function toggleSample(modelId: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!mediaBaseUrl || !modelId) return;

    const el = audioRef.current;
    if (!el) return;

    if (playingModelId === modelId && !el.paused) {
      el.pause();
      setPlayingModelId(null);
      return;
    }

    const next = mediaFileUrl(
      mediaBaseUrl,
      speakerPreviewLoudSampleKey(modelId, FIXED_SPEECH_PREVIEW_SPEED),
    );
    if (el.src !== next) {
      el.src = next;
      void el.load();
    }
    try {
      await el.play();
      setPlayingModelId(modelId);
    } catch {
      setPlayingModelId(null);
    }
  }

  function selectSpeaker(modelId: string) {
    onChange(modelId);
    setOpen(false);
    if (playingModelId && playingModelId !== modelId) stopSample();
  }

  const canPlay = Boolean(mediaBaseUrl);
  const triggerPlaying = playingModelId === value && Boolean(value);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <audio
        ref={audioRef}
        className="hidden"
        playsInline
        onEnded={() => setPlayingModelId(null)}
      />
      <div
        className={`flex max-w-[12.5rem] items-center gap-0.5 rounded-full bg-marketing-menu-hover py-1 pl-1 pr-2 sm:max-w-[14rem] ${
          disabled ? "opacity-60" : ""
        }`}
      >
        <button
          type="button"
          disabled={disabled || !canPlay || !value}
          aria-label={
            triggerPlaying ? `Pause ${label} sample` : `Play ${label} sample`
          }
          title={
            triggerPlaying ? `Pause ${label} sample` : `Play ${label} sample`
          }
          onClick={(e) => {
            if (!value) return;
            void toggleSample(value, e);
          }}
          className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-marketing-ink transition-[background-color] duration-150 ease-out hover:bg-marketing-menu-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {triggerPlaying ? (
            <IconPlayerPause size={15} stroke={2.25} aria-hidden />
          ) : (
            <IconPlayerPlay size={15} stroke={2.25} aria-hidden />
          )}
        </button>
        <button
          type="button"
          disabled={disabled || speakers.length === 0}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="Choose a voice"
          id="home-hero-speaker"
          onClick={() => {
            if (disabled || speakers.length === 0) return;
            setOpen((v) => !v);
          }}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 py-1 pr-0.5 text-left text-sm text-marketing-ink outline-none disabled:cursor-not-allowed"
        >
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <IconChevronDown
            size={14}
            stroke={2.25}
            aria-hidden
            className={`shrink-0 opacity-70 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>

      {open ? (
        <div
          className="absolute left-0 top-full z-[90] mt-1.5 max-h-64 min-w-[14rem] overflow-auto rounded-2xl border border-marketing-menu-border bg-marketing-menu-bg py-1 shadow-[0_12px_32px_rgb(30_37_48_/_0.14)] dark:shadow-none"
          role="listbox"
          aria-labelledby="home-hero-speaker"
        >
          {speakers.map((s) => {
            const isSelected = s.modelId === value;
            const isPlaying = playingModelId === s.modelId;
            return (
              <div
                key={s.modelId}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                onClick={() => selectSpeaker(s.modelId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectSpeaker(s.modelId);
                  }
                }}
                className={`flex cursor-pointer items-center gap-0.5 px-1.5 py-1 text-sm hover:bg-marketing-menu-hover ${
                  isSelected
                    ? "font-medium text-marketing-ink"
                    : "text-marketing-menu-muted"
                }`}
              >
                <button
                  type="button"
                  disabled={!canPlay}
                  aria-label={
                    isPlaying
                      ? `Pause ${s.name} sample`
                      : `Play ${s.name} sample`
                  }
                  title={
                    isPlaying
                      ? `Pause ${s.name} sample`
                      : `Play ${s.name} sample`
                  }
                  onClick={(e) => void toggleSample(s.modelId, e)}
                  className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-marketing-ink transition-[background-color] duration-150 ease-out hover:bg-marketing-menu-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isPlaying ? (
                    <IconPlayerPause size={15} stroke={2.25} aria-hidden />
                  ) : (
                    <IconPlayerPlay size={15} stroke={2.25} aria-hidden />
                  )}
                </button>
                <span className="min-w-0 flex-1 truncate pr-2">{s.name}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Hero one-shot: generate on the homepage (random factory bed + chosen/random
 * speaker), then open Library when metadata is ready.
 */
export function HomeHeroOneShotPrompt({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [speakers, setSpeakers] = useState<FishSpeaker[]>([]);
  const [speakerModelId, setSpeakerModelId] = useState("");
  const [mediaBaseUrl, setMediaBaseUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [list, beds] = await Promise.all([
          loadHomepageFishSpeakers(),
          listBackgroundAudio().catch(() => null),
        ]);
        if (cancelled) return;
        setSpeakers(list);
        setSpeakerModelId((current) => {
          if (current && list.some((s) => s.modelId === current)) return current;
          const pick = list[Math.floor(Math.random() * list.length)];
          return pick?.modelId ?? "";
        });
        const fromApi = beds?.baseUrl?.trim();
        setMediaBaseUrl(fromApi || getMedimadeMediaBaseUrl() || null);
      } catch {
        if (!cancelled) {
          setMediaBaseUrl(getMedimadeMediaBaseUrl() || null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { libraryHref } = await startHomepageOneShotGeneration({
        prompt: trimmed,
        speakerModelId: speakerModelId || null,
      });
      router.push(libraryHref);
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof Error ? err.message : "Could not create your meditation.",
      );
    }
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className={`mx-auto w-full max-w-3xl ${className}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-2">
        <div className="home-hero-one-shot-shell flex min-w-0 flex-1 items-stretch gap-2 rounded-full border bg-marketing-input-shell-bg p-1.5">
          <label className="sr-only" htmlFor="home-hero-one-shot">
            Describe the meditation you want
          </label>
          <input
            id="home-hero-one-shot"
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
            placeholder="e.g. I can’t sleep — racing thoughts about work tomorrow"
            className="min-w-0 flex-1 bg-transparent px-4 py-2.5 text-left text-sm text-marketing-ink outline-none placeholder:text-marketing-placeholder disabled:opacity-60 sm:text-base"
            autoComplete="off"
          />
          <HomeHeroSpeakerPicker
            speakers={speakers}
            value={speakerModelId}
            onChange={setSpeakerModelId}
            disabled={busy}
            mediaBaseUrl={mediaBaseUrl}
          />
          <button
            type="submit"
            disabled={busy || prompt.trim().length === 0}
            aria-label={busy ? "Creating meditation" : "Create meditation"}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full accent-fill-gradient px-4 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 sm:px-5"
          >
            {busy ? (
              <>
                <IconLoader2 size={18} className="animate-spin" aria-hidden />
                <span className="hidden sm:inline">Creating…</span>
              </>
            ) : (
              <>
                <span className="hidden sm:inline">Create</span>
                <IconArrowRight size={18} stroke={2.25} aria-hidden />
              </>
            )}
          </button>
        </div>
      </div>
      {error ? (
        <p className="mt-2 text-center text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-center text-xs text-marketing-body sm:text-sm">
          {busy
            ? "Writing and generating your meditation — this can take a minute."
            : "Say how you feel and what you need — we’ll turn it into a guided meditation."}
        </p>
      )}
    </form>
  );
}
