"use client";

import { useEffect, useRef, useState } from "react";
import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import {
  formatHomepageDuration,
  HOMEPAGE_LISTEN_SAMPLES,
  type HomepageListenSample,
} from "@/lib/homepage-listen-samples";
import {
  getHomepageActiveAudioId,
  setHomepageActiveAudioId,
  subscribeHomepageActiveAudio,
} from "@/lib/homepage-audio-bus";

export function HomeListenSection() {
  return (
    <section className="w-full bg-[#161D28] px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center font-display text-3xl font-medium tracking-tight text-[#F4F0E8] sm:text-4xl">
          Judge the sound yourself.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-base text-[#A8B0BC] sm:text-lg">
          Three real generated sessions. No sign-up to listen.
        </p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-3 sm:gap-5">
          {HOMEPAGE_LISTEN_SAMPLES.map((sample) => (
            <li key={sample.id}>
              <HomeListenCard sample={sample} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Featured hero sample — same card UI as the Listen section. */
export function HomeHeroListenCard({
  sample = HOMEPAGE_LISTEN_SAMPLES[0]!,
}: {
  sample?: HomepageListenSample;
}) {
  return (
    <div className="mx-auto w-full max-w-[480px]">
      <HomeListenCard sample={sample} />
    </div>
  );
}

export function HomeListenCard({ sample }: { sample: HomepageListenSample }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(sample.durationSeconds);

  useEffect(() => {
    const sync = (activeId: string | null) => {
      if (activeId === sample.id) return;
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.currentTime = 0;
      }
      setPlaying(false);
      setProgress(0);
    };
    sync(getHomepageActiveAudioId());
    return subscribeHomepageActiveAudio(sync);
  }, [sample.id]);

  async function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      setHomepageActiveAudioId(null);
      return;
    }
    setHomepageActiveAudioId(sample.id);
    try {
      await el.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      setHomepageActiveAudioId(null);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.05] p-5 text-left">
      <audio
        ref={audioRef}
        src={sample.audioUrl}
        preload="metadata"
        onLoadedMetadata={() => {
          const el = audioRef.current;
          if (el && Number.isFinite(el.duration) && el.duration > 0) {
            setDuration(el.duration);
          }
        }}
        onTimeUpdate={() => {
          const el = audioRef.current;
          if (!el || !el.duration) return;
          setProgress(el.currentTime / el.duration);
        }}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
          setHomepageActiveAudioId(null);
        }}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => void togglePlay()}
          aria-label={
            playing ? `Pause ${sample.title}` : `Play ${sample.title}`
          }
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#D9A24F] text-[#3D2E10] transition-opacity hover:opacity-90"
        >
          {playing ? (
            <IconPlayerPause size={20} stroke={2.25} aria-hidden />
          ) : (
            <IconPlayerPlay
              size={20}
              stroke={2.25}
              className="translate-x-px"
              aria-hidden
            />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-medium leading-snug text-[#F4F0E8]">
            {sample.title}
          </p>
          <p className="mt-1 text-sm text-[#A8B0BC]">
            {sample.category} · {formatHomepageDuration(duration)}
          </p>
        </div>
      </div>
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[#D9A24F] transition-[width] duration-150"
          style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
        />
      </div>
    </div>
  );
}
