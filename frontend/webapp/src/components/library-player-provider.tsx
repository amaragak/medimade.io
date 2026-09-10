"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  listBackgroundAudio,
  postDashboardPlayEvent,
  type BackgroundAudioItem,
  type LibraryMeditationItem,
} from "@/lib/medimade-api";
import {
  localDateKey,
  recordLocalPlayProgress60,
  recordLocalPlayStarted,
} from "@/lib/daily-habits";
import {
  LibraryAudioStrip,
  liveMixTrack,
  trackFromLibraryItem,
  type LibraryActiveTrack,
  type LibraryBedVolumeApi,
  type BedVolumeChannel,
} from "@/components/library-audio-strip";

export type { LibraryActiveTrack, LibraryBedVolumeApi, BedVolumeChannel };
export { trackFromLibraryItem, liveMixTrack };

type LibraryPlayerContextValue = {
  nowPlaying: LibraryActiveTrack | null;
  playingS3Key: string | null;
  playerStripHeightPx: number;
  bedVolumeApiRef: React.MutableRefObject<LibraryBedVolumeApi | null>;
  playItem: (item: LibraryMeditationItem) => void;
  playTrack: (track: LibraryActiveTrack) => void;
  toggleCurrent: () => void;
  dismiss: () => void;
  patchNowPlaying: (
    updater: (prev: LibraryActiveTrack) => LibraryActiveTrack | null,
  ) => void;
  setPlaybackTimeListener: (
    fn: ((s3Key: string, timeSeconds: number) => void) | null,
  ) => void;
};

const LibraryPlayerContext = createContext<LibraryPlayerContextValue | null>(
  null,
);

const PLAY_PROGRESS_SECONDS = 60;

function meditationIdFromTrack(track: LibraryActiveTrack): string {
  return (track.s3Key || track.title || "unknown").slice(0, 200);
}

export function LibraryPlayerProvider({ children }: { children: ReactNode }) {
  const [nowPlaying, setNowPlaying] = useState<LibraryActiveTrack | null>(null);
  const [playingS3Key, setPlayingS3Key] = useState<string | null>(null);
  const [playbackToggleNonce, setPlaybackToggleNonce] = useState(0);
  const [playerStripHeightPx, setPlayerStripHeightPx] = useState(0);
  const [mixMusic, setMixMusic] = useState<BackgroundAudioItem[]>([]);
  const [mixCompositions, setMixCompositions] = useState<BackgroundAudioItem[]>(
    [],
  );
  const bedVolumeApiRef = useRef<LibraryBedVolumeApi | null>(null);
  const timeListenerRef = useRef<
    ((s3Key: string, timeSeconds: number) => void) | null
  >(null);
  const playingS3KeyRef = useRef<string | null>(null);
  playingS3KeyRef.current = playingS3Key;
  const nowPlayingRef = useRef<LibraryActiveTrack | null>(null);
  nowPlayingRef.current = nowPlaying;
  const listenAccumRef = useRef(0);
  const progressLoggedRef = useRef(false);
  const startedLoggedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listBackgroundAudio()
      .then((data) => {
        if (cancelled) return;
        setMixMusic(data.music ?? []);
        setMixCompositions(data.compositions ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setMixMusic([]);
        setMixCompositions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reset listen accumulator when the active track changes.
  useEffect(() => {
    listenAccumRef.current = 0;
    progressLoggedRef.current = false;
    startedLoggedKeyRef.current = null;
  }, [nowPlaying?.s3Key]);

  // Log play_started when the user actually starts listening.
  useEffect(() => {
    const track = nowPlayingRef.current;
    if (!playingS3Key || !track || track.s3Key !== playingS3Key) return;
    if (startedLoggedKeyRef.current === playingS3Key) return;
    startedLoggedKeyRef.current = playingS3Key;
    const meditationId = meditationIdFromTrack(track);
    const at = new Date().toISOString();
    const dateKey = localDateKey();
    recordLocalPlayStarted({ meditationId, at, dateKey });
    void postDashboardPlayEvent({
      type: "play_started",
      meditationId,
      at,
      dateKey,
    });
  }, [playingS3Key]);

  // Accumulate wall-clock listen time while audio is actually playing.
  useEffect(() => {
    if (!playingS3Key || !nowPlayingRef.current) return;
    const tick = window.setInterval(() => {
      const track = nowPlayingRef.current;
      if (!track || playingS3KeyRef.current !== track.s3Key) return;
      listenAccumRef.current += 1;
      if (
        listenAccumRef.current >= PLAY_PROGRESS_SECONDS &&
        !progressLoggedRef.current
      ) {
        progressLoggedRef.current = true;
        const meditationId = meditationIdFromTrack(track);
        const at = new Date().toISOString();
        const dateKey = localDateKey();
        recordLocalPlayProgress60({ meditationId, at, dateKey });
        void postDashboardPlayEvent({
          type: "play_progress",
          meditationId,
          at,
          seconds: PLAY_PROGRESS_SECONDS,
          dateKey,
        });
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, [playingS3Key]);

  const dismiss = useCallback(() => {
    setNowPlaying(null);
    setPlayingS3Key(null);
  }, []);

  const playTrack = useCallback((track: LibraryActiveTrack) => {
    setNowPlaying(track);
  }, []);

  const playItem = useCallback((item: LibraryMeditationItem) => {
    setNowPlaying(trackFromLibraryItem(item));
  }, []);

  const toggleCurrent = useCallback(() => {
    setPlaybackToggleNonce((n) => n + 1);
  }, []);

  const patchNowPlaying = useCallback(
    (updater: (prev: LibraryActiveTrack) => LibraryActiveTrack | null) => {
      setNowPlaying((prev) => (prev ? updater(prev) : prev));
    },
    [],
  );

  const setPlaybackTimeListener = useCallback(
    (fn: ((s3Key: string, timeSeconds: number) => void) | null) => {
      timeListenerRef.current = fn;
    },
    [],
  );

  const value = useMemo<LibraryPlayerContextValue>(
    () => ({
      nowPlaying,
      playingS3Key,
      playerStripHeightPx,
      bedVolumeApiRef,
      playItem,
      playTrack,
      toggleCurrent,
      dismiss,
      patchNowPlaying,
      setPlaybackTimeListener,
    }),
    [
      nowPlaying,
      playingS3Key,
      playerStripHeightPx,
      playItem,
      playTrack,
      toggleCurrent,
      dismiss,
      patchNowPlaying,
      setPlaybackTimeListener,
    ],
  );

  return (
    <LibraryPlayerContext.Provider value={value}>
      {children}
      <LibraryAudioStrip
        key={nowPlaying?.s3Key ?? "none"}
        track={nowPlaying}
        musicItems={mixMusic}
        compositionItems={mixCompositions}
        onDismiss={dismiss}
        playbackToggleNonce={playbackToggleNonce}
        bedVolumeApiRef={bedVolumeApiRef}
        onHeightChange={setPlayerStripHeightPx}
        onPlayingChange={(s3Key, playing) =>
          setPlayingS3Key(playing ? s3Key : null)
        }
        onPlaybackTimeChange={(s3Key, timeSeconds) => {
          if (playingS3KeyRef.current !== s3Key) return;
          timeListenerRef.current?.(s3Key, timeSeconds);
        }}
      />
    </LibraryPlayerContext.Provider>
  );
}

export function useLibraryPlayer(): LibraryPlayerContextValue {
  const ctx = useContext(LibraryPlayerContext);
  if (!ctx) {
    throw new Error("useLibraryPlayer must be used within LibraryPlayerProvider");
  }
  return ctx;
}
