import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Audio } from "expo-av";
import { backgroundAudioStreamingKey } from "../lib/medimade-api";
import {
  speakerPreviewLoudFxSampleKey,
  speakerPreviewLoudSampleKey,
} from "../lib/speaker-sample-speed";

const SPEAKER_SAMPLE_GAP_MS = 3000;

export type SoloTrack = "speaker" | "nature" | "music" | "noise";

function mediaFileUrl(base: string, key: string): string {
  const b = base.replace(/\/$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${b}/${path}`;
}

export type CreateAudioPreviewParams = {
  mediaBaseUrl: string | null;
  speakerModelId: string;
  speechSpeed: number;
  speakerFxPreviewOn: boolean;
  backgroundNatureKey: string;
  backgroundMusicKey: string;
  backgroundNoiseKey: string;
  backgroundNatureGain: number;
  backgroundMusicGain: number;
  backgroundNoiseGain: number;
};

export function useCreateAudioPreview(p: CreateAudioPreviewParams) {
  const [playing, setPlaying] = useState<Record<SoloTrack, boolean>>({
    speaker: false,
    nature: false,
    music: false,
    noise: false,
  });
  const [playAllActive, setPlayAllActive] = useState(false);

  const speakerSoundRef = useRef<Audio.Sound | null>(null);
  const natureSoundRef = useRef<Audio.Sound | null>(null);
  const musicSoundRef = useRef<Audio.Sound | null>(null);
  const noiseSoundRef = useRef<Audio.Sound | null>(null);

  const lastSpeakerUriRef = useRef("");
  const natureUriRef = useRef("");
  const musicUriRef = useRef("");
  const noiseUriRef = useRef("");
  const lastBgKeysRef = useRef({ nature: "", music: "", noise: "" });

  const speakerRepeatWantedRef = useRef(false);
  const speakerGapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const playingRef = useRef(playing);
  playingRef.current = playing;

  function clearSpeakerGap() {
    if (speakerGapTimeoutRef.current != null) {
      clearTimeout(speakerGapTimeoutRef.current);
      speakerGapTimeoutRef.current = null;
    }
  }

  const stopTrack = useCallback(async (track: SoloTrack) => {
    setPlayAllActive(false);
    if (track === "speaker") {
      clearSpeakerGap();
      speakerRepeatWantedRef.current = false;
      lastSpeakerUriRef.current = "";
      const s = speakerSoundRef.current;
      speakerSoundRef.current = null;
      if (s) {
        try {
          await s.unloadAsync();
        } catch {
          /* */
        }
      }
    } else if (track === "nature") {
      natureUriRef.current = "";
      lastBgKeysRef.current.nature = "";
      const s = natureSoundRef.current;
      natureSoundRef.current = null;
      if (s) {
        try {
          await s.unloadAsync();
        } catch {
          /* */
        }
      }
    } else if (track === "music") {
      musicUriRef.current = "";
      lastBgKeysRef.current.music = "";
      const s = musicSoundRef.current;
      musicSoundRef.current = null;
      if (s) {
        try {
          await s.unloadAsync();
        } catch {
          /* */
        }
      }
    } else {
      noiseUriRef.current = "";
      lastBgKeysRef.current.noise = "";
      const s = noiseSoundRef.current;
      noiseSoundRef.current = null;
      if (s) {
        try {
          await s.unloadAsync();
        } catch {
          /* */
        }
      }
    }
    setPlaying((prev) => ({ ...prev, [track]: false }));
  }, []);

  const pauseAllPreviews = useCallback(async () => {
    clearSpeakerGap();
    speakerRepeatWantedRef.current = false;
    setPlayAllActive(false);
    for (const ref of [
      speakerSoundRef,
      natureSoundRef,
      musicSoundRef,
      noiseSoundRef,
    ] as const) {
      const s = ref.current;
      if (!s) continue;
      try {
        const st = await s.getStatusAsync();
        if (st.isLoaded && st.isPlaying) await s.pauseAsync();
      } catch {
        /* */
      }
    }
    setPlaying({
      speaker: false,
      nature: false,
      music: false,
      noise: false,
    });
  }, []);

  const stopAllAudioPreview = useCallback(async () => {
    await pauseAllPreviews();
    lastSpeakerUriRef.current = "";
    natureUriRef.current = "";
    musicUriRef.current = "";
    noiseUriRef.current = "";
    lastBgKeysRef.current = { nature: "", music: "", noise: "" };
    const unload = async (r: MutableRefObject<Audio.Sound | null>) => {
      const s = r.current;
      r.current = null;
      if (s) {
        try {
          await s.unloadAsync();
        } catch {
          /* */
        }
      }
    };
    await unload(speakerSoundRef);
    await unload(natureSoundRef);
    await unload(musicSoundRef);
    await unload(noiseSoundRef);
  }, [pauseAllPreviews]);

  useEffect(() => {
    void Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    });
  }, []);

  useEffect(() => {
    return () => {
      clearSpeakerGap();
      void stopAllAudioPreview();
    };
  }, [stopAllAudioPreview]);

  // Speaker: load / hot-swap URI; respect play state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!p.mediaBaseUrl || !p.speakerModelId) {
        clearSpeakerGap();
        speakerRepeatWantedRef.current = false;
        lastSpeakerUriRef.current = "";
        const s = speakerSoundRef.current;
        speakerSoundRef.current = null;
        if (s) {
          try {
            await s.unloadAsync();
          } catch {
            /* */
          }
        }
        if (!cancelled && playingRef.current.speaker) {
          setPlaying((prev) => ({ ...prev, speaker: false }));
        }
        return;
      }
      const sampleKey = p.speakerFxPreviewOn
        ? speakerPreviewLoudFxSampleKey(p.speakerModelId, p.speechSpeed)
        : speakerPreviewLoudSampleKey(p.speakerModelId, p.speechSpeed);
      const uri = mediaFileUrl(p.mediaBaseUrl, sampleKey);
      const wantPlay = playingRef.current.speaker;

      const existing = speakerSoundRef.current;
      if (existing && lastSpeakerUriRef.current === uri) {
        const st = await existing.getStatusAsync();
        if (!st.isLoaded || cancelled) return;
        if (wantPlay) {
          speakerRepeatWantedRef.current = true;
          if (!st.isPlaying) {
            await existing.playAsync().catch(() => {
              void stopTrack("speaker");
            });
          }
        } else {
          speakerRepeatWantedRef.current = false;
          clearSpeakerGap();
          if (st.isPlaying) await existing.pauseAsync();
        }
        return;
      }

      if (existing) {
        try {
          await existing.unloadAsync();
        } catch {
          /* */
        }
        speakerSoundRef.current = null;
      }
      if (cancelled) return;

      lastSpeakerUriRef.current = uri;
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: false, volume: 1, isLooping: false },
        );
        if (cancelled) {
          await sound.unloadAsync();
          return;
        }
        speakerSoundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((st) => {
          if (!st.isLoaded || !st.didJustFinish) return;
          if (!speakerRepeatWantedRef.current) return;
          clearSpeakerGap();
          speakerGapTimeoutRef.current = setTimeout(() => {
            speakerGapTimeoutRef.current = null;
            if (!speakerRepeatWantedRef.current) return;
            void sound.replayAsync().catch(() => {});
          }, SPEAKER_SAMPLE_GAP_MS);
        });
        if (wantPlay) {
          speakerRepeatWantedRef.current = true;
          await sound.playAsync().catch(() => {
            void stopTrack("speaker");
          });
        }
      } catch {
        lastSpeakerUriRef.current = "";
        speakerSoundRef.current = null;
        if (!cancelled) {
          setPlaying((prev) => ({ ...prev, speaker: false }));
        }
      }
    })();
    return () => {
      cancelled = true;
      clearSpeakerGap();
    };
  }, [
    p.mediaBaseUrl,
    p.speakerModelId,
    p.speechSpeed,
    p.speakerFxPreviewOn,
    playing.speaker,
    stopTrack,
  ]);

  // Background beds: loop + volume; auto-play on key change (match web).
  useEffect(() => {
    let cancelled = false;

    async function syncBed(
      track: Exclude<SoloTrack, "speaker">,
      ref: MutableRefObject<Audio.Sound | null>,
      uriStore: MutableRefObject<string>,
      key: string,
      gain: number,
    ) {
      const base = p.mediaBaseUrl;
      if (!base || !key.trim()) {
        uriStore.current = "";
        lastBgKeysRef.current[track] = "";
        const s = ref.current;
        ref.current = null;
        if (s) {
          try {
            await s.unloadAsync();
          } catch {
            /* */
          }
        }
        if (playingRef.current[track]) {
          setPlaying((prev) => ({ ...prev, [track]: false }));
        }
        return;
      }

      const uri = mediaFileUrl(base, backgroundAudioStreamingKey(key));
      const vol = Math.min(1, Math.max(0, gain / 100));
      const keyChanged = lastBgKeysRef.current[track] !== key;
      lastBgKeysRef.current[track] = key;
      const wantPlay = keyChanged || playingRef.current[track];

      if (ref.current && uriStore.current === uri) {
        const st = await ref.current.getStatusAsync();
        if (!st.isLoaded || cancelled) return;
        await ref.current.setVolumeAsync(vol);
        if (wantPlay) {
          if (!st.isPlaying) {
            await ref.current.playAsync().catch(() => {
              setPlaying((prev) => ({ ...prev, [track]: false }));
            });
          }
        } else if (st.isPlaying) {
          await ref.current.pauseAsync();
        }
        return;
      }

      if (ref.current) {
        try {
          await ref.current.unloadAsync();
        } catch {
          /* */
        }
        ref.current = null;
      }
      if (cancelled) return;

      uriStore.current = uri;
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          {
            shouldPlay: wantPlay,
            volume: vol,
            isLooping: true,
          },
        );
        if (cancelled) {
          await sound.unloadAsync();
          return;
        }
        ref.current = sound;
        if (wantPlay) {
          setPlaying((prev) => ({ ...prev, [track]: true }));
        }
      } catch {
        uriStore.current = "";
        ref.current = null;
        setPlaying((prev) => ({ ...prev, [track]: false }));
      }
    }

    void (async () => {
      await syncBed(
        "nature",
        natureSoundRef,
        natureUriRef,
        p.backgroundNatureKey,
        p.backgroundNatureGain,
      );
      if (cancelled) return;
      await syncBed(
        "music",
        musicSoundRef,
        musicUriRef,
        p.backgroundMusicKey,
        p.backgroundMusicGain,
      );
      if (cancelled) return;
      await syncBed(
        "noise",
        noiseSoundRef,
        noiseUriRef,
        p.backgroundNoiseKey,
        p.backgroundNoiseGain,
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [
    p.mediaBaseUrl,
    p.backgroundNatureKey,
    p.backgroundMusicKey,
    p.backgroundNoiseKey,
    p.backgroundNatureGain,
    p.backgroundMusicGain,
    p.backgroundNoiseGain,
    playing.nature,
    playing.music,
    playing.noise,
  ]);

  const anyTrackPlaying =
    playing.speaker || playing.nature || playing.music || playing.noise;

  const togglePlayAll = useCallback(async () => {
    if (!p.mediaBaseUrl) return;
    if (anyTrackPlaying || playAllActive) {
      await pauseAllPreviews();
      return;
    }
    await pauseAllPreviews();

    const parts: Promise<unknown>[] = [];
    if (p.speakerModelId && speakerSoundRef.current) {
      const st = await speakerSoundRef.current.getStatusAsync();
      if (st.isLoaded) {
        speakerRepeatWantedRef.current = true;
        parts.push(speakerSoundRef.current.playAsync());
      }
    } else {
      speakerRepeatWantedRef.current = false;
    }
    for (const [ref, key] of [
      [natureSoundRef, p.backgroundNatureKey],
      [musicSoundRef, p.backgroundMusicKey],
      [noiseSoundRef, p.backgroundNoiseKey],
    ] as const) {
      if (!key.trim()) continue;
      const s = ref.current;
      if (!s) continue;
      const st = await s.getStatusAsync();
      if (st.isLoaded) parts.push(s.playAsync());
    }

    if (parts.length === 0) return;

    setPlayAllActive(true);
    setPlaying({
      speaker: Boolean(p.speakerModelId && speakerSoundRef.current),
      nature: Boolean(p.backgroundNatureKey.trim() && natureSoundRef.current),
      music: Boolean(p.backgroundMusicKey.trim() && musicSoundRef.current),
      noise: Boolean(p.backgroundNoiseKey.trim() && noiseSoundRef.current),
    });

    try {
      await Promise.all(parts);
    } catch {
      await pauseAllPreviews();
    }
  }, [
    p.mediaBaseUrl,
    p.speakerModelId,
    p.backgroundNatureKey,
    p.backgroundMusicKey,
    p.backgroundNoiseKey,
    anyTrackPlaying,
    playAllActive,
    pauseAllPreviews,
  ]);

  const toggleRowPreview = useCallback(
    async (track: SoloTrack) => {
      if (track === "speaker" && (!p.mediaBaseUrl || !p.speakerModelId)) {
        return;
      }
      if (track === "nature" && !p.backgroundNatureKey.trim()) return;
      if (track === "music" && !p.backgroundMusicKey.trim()) return;
      if (track === "noise" && !p.backgroundNoiseKey.trim()) return;

      const sound =
        track === "speaker"
          ? speakerSoundRef.current
          : track === "nature"
            ? natureSoundRef.current
            : track === "music"
              ? musicSoundRef.current
              : noiseSoundRef.current;

      if (!sound) return;

      try {
        setPlayAllActive(false);
        if (track === "speaker") {
          clearSpeakerGap();
        }

        const st = await sound.getStatusAsync();
        if (!st.isLoaded) return;

        if (st.isPlaying) {
          await sound.pauseAsync();
          if (track === "speaker") {
            speakerRepeatWantedRef.current = false;
            clearSpeakerGap();
          }
          setPlaying((prev) => ({ ...prev, [track]: false }));
          return;
        }

        if (track === "speaker") {
          speakerRepeatWantedRef.current = true;
        }
        await sound.playAsync();
        setPlaying((prev) => ({ ...prev, [track]: true }));
      } catch {
        if (track === "speaker") {
          speakerRepeatWantedRef.current = false;
          clearSpeakerGap();
        }
        setPlaying((prev) => ({ ...prev, [track]: false }));
      }
    },
    [
      p.mediaBaseUrl,
      p.speakerModelId,
      p.backgroundNatureKey,
      p.backgroundMusicKey,
      p.backgroundNoiseKey,
    ],
  );

  return {
    playing,
    playAllActive,
    anyTrackPlaying,
    togglePlayAll,
    toggleRowPreview,
    stopAllAudioPreview,
    pauseAllPreviews,
  };
}
