"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { isMelodicMusicKey } from "@/lib/sound-taxonomy";
import {
  backgroundAudioPlaybackKey,
  backgroundAudioStreamingKey,
  getMedimadeMediaBaseUrl,
  type BackgroundAudioItem,
  type LibraryMeditationItem,
} from "@/lib/medimade-api";
import {
  releaseGaplessBed,
  setGaplessBedVolume,
  syncGaplessBed,
} from "@/lib/gapless-bed-loop";
import {
  bedElementVolume,
  BED_VOICE_INTRO_SECONDS,
  SOUNDSCAPE_ELEMENT_VOLUME,
} from "@/lib/bed-volume";

export type LibraryActiveTrack = {
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

export type BedVolumeChannel = "nature" | "music" | "drums" | "noise";

export type LibraryBedVolumeApi = {
  setBedVolume: (channel: BedVolumeChannel, gain: number) => void;
};

export function mediaFileUrl(base: string, key: string): string {
  const b = base.replace(/\/$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${b}/${path}`;
}

export function trackFromLibraryItem(
  m: LibraryMeditationItem,
): LibraryActiveTrack {
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

export function liveMixTrack(
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
): LibraryActiveTrack {
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


/** A soundscape rides the music slot alone; that is how it is recognised later. */
function isSoundscapeKey(
  compositions: BackgroundAudioItem[],
  key: string | null | undefined,
): boolean {
  const k = backgroundAudioStreamingKey(key ?? "");
  if (!k) return false;
  return compositions.some((c) => backgroundAudioStreamingKey(c.key) === k);
}

export function LibraryAudioStrip({
  track,
  musicItems,
  compositionItems,
  onDismiss,
  playbackToggleNonce,
  elevated = false,
  bedVolumeApiRef,
  onPlayingChange,
  onPlaybackTimeChange,
  onHeightChange,
}: {
  track: LibraryActiveTrack | null;
  musicItems: BackgroundAudioItem[];
  compositionItems: BackgroundAudioItem[];
  onDismiss: () => void;
  playbackToggleNonce: number;
  elevated?: boolean;
  bedVolumeApiRef?: MutableRefObject<LibraryBedVolumeApi | null>;
  onPlayingChange?: (s3Key: string, playing: boolean) => void;
  onPlaybackTimeChange?: (s3Key: string, timeSeconds: number) => void;
  onHeightChange?: (heightPx: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
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
  const soundscapeActive =
    track?.liveMix === true && isSoundscapeKey(compositionItems, track.musicKey);
  const soundscapeActiveRef = useRef(soundscapeActive);
  soundscapeActiveRef.current = soundscapeActive;

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
        setGaplessBedVolume(
          el,
          soundscapeActiveRef.current && channel === "music"
            ? SOUNDSCAPE_ELEMENT_VOLUME
            : bedElementVolume(gain),
        );
      },
    };
    return () => {
      bedVolumeApiRef.current = null;
    };
  }, [bedVolumeApiRef]);

  useEffect(() => {
    const beds = [natureRef, musicRef, drumsRef, noiseRef];
    return () => {
      for (const ref of beds) releaseGaplessBed(ref.current);
    };
  }, []);

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
    const soundscape = soundscapeActive;
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
      const volume =
        soundscape && bed.channel === "music"
          ? SOUNDSCAPE_ELEMENT_VOLUME
          : bedElementVolume(liveBedGainsRef.current[bed.channel]);
      if (!mediaBase || !bed.key.trim()) {
        syncGaplessBed(el, { url: null, volume, playing: false });
        continue;
      }
      syncGaplessBed(el, {
        url: mediaFileUrl(mediaBase, backgroundAudioPlaybackKey(bed.key)),
        fallbackUrl: mediaFileUrl(mediaBase, backgroundAudioStreamingKey(bed.key)),
        volume,
        playing,
      });
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
    soundscapeActive,
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
      onDismiss();
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
  }, [track, onPlayingChange, onDismiss, reportTime]);

  useLayoutEffect(() => {
    if (!track) {
      onHeightChange?.(0);
      return;
    }
    const el = rootRef.current;
    if (!el || !onHeightChange) return;
    const report = () => onHeightChange(el.getBoundingClientRect().height);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [track, onHeightChange]);

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
      ref={rootRef}
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
      {/* Looping is scheduled by syncGaplessBed, so these must not set `loop`. */}
      <audio ref={natureRef} className="hidden" playsInline />
      <audio ref={musicRef} className="hidden" playsInline />
      <audio ref={drumsRef} className="hidden" playsInline />
      <audio ref={noiseRef} className="hidden" playsInline />

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
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full accent-fill-gradient text-on-accent"
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
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                {track.title}
              </p>
              <button
                type="button"
                onClick={() => {
                  pausePlayback();
                  onDismiss();
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-accent-soft/40 hover:text-foreground sm:hidden"
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

        <div className="hidden shrink-0 items-center justify-end gap-2 sm:flex">
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

