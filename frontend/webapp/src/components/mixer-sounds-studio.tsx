"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MixerChannel, MixerVoiceChannel } from "@/components/mixer-channel";
import { DrumsLockedWrap } from "@/components/drums-locked-wrap";
import { FactoryIconSelect } from "@/components/factory-icons";
import { FactoryPresetRow } from "@/components/factory-preset-row";
import { isMelodicMusicKey } from "@/lib/sound-taxonomy";
import { applyBedElementVolume } from "@/lib/bed-volume";
import {
  backgroundAudioStreamingKey,
  deleteAdminFactoryMix,
  getMedimadeMediaBaseUrl,
  listAdminFactoryMixes,
  listBackgroundAudio,
  listFishSpeakers,
  saveAdminFactoryMix,
  type BackgroundAudioItem,
  type FishSpeaker,
} from "@/lib/medimade-api";
import {
  FACTORY_COLOR_PRESETS,
  emptyFactoryPreset,
  factoryPresetEquals,
  factoryPresetToMix,
  mixToFactoryChannels,
  type MixerFactoryPreset,
} from "@/lib/mixer-factory-presets";
import {
  emptyMixerMix,
  loadMixerPresetStore,
  mixEquals,
  mixerPresetToMix,
  newMixerPreset,
  saveMixerPresetStore,
  type MixerPreset,
  type MixerPresetMix,
} from "@/lib/mixer-preset-storage";
import {
  FIXED_SPEECH_PREVIEW_SPEED,
  speakerPreviewLoudFxSampleKey,
  speakerPreviewLoudSampleKey,
} from "@/lib/speaker-sample-speed";

type BedTrack = "nature" | "music" | "drums" | "noise";

function playingFromMix(
  mix: MixerPresetMix,
  musicItems: BackgroundAudioItem[],
): Record<BedTrack, boolean> {
  const drumsLocked = isMelodicMusicKey(musicItems, mix.musicKey);
  return {
    nature: Boolean(mix.natureKey.trim()),
    music: Boolean(mix.musicKey.trim()),
    drums: Boolean(mix.drumsKey.trim()) && !drumsLocked,
    noise: Boolean(mix.noiseKey.trim()),
  };
}

function mediaFileUrl(base: string, key: string): string {
  const b = base.replace(/\/+$/, "");
  const k = key.replace(/^\/+/, "");
  return `${b}/${k}`;
}

function FactoryPresetListSkeleton() {
  return (
    <ul className="space-y-2" aria-busy="true" aria-label="Loading factory presets">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="h-[3.75rem] animate-pulse rounded-[10px] border-[0.5px] border-border bg-muted/25"
        />
      ))}
    </ul>
  );
}

export function MixerSoundsStudio({
  variant = "user",
  initialFactoryPresets = null,
}: {
  variant?: "user" | "admin";
  initialFactoryPresets?: MixerFactoryPreset[] | null;
}) {
  const isAdmin = variant === "admin";
  const [hydrated, setHydrated] = useState(false);
  const [presets, setPresets] = useState<MixerPreset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mix, setMix] = useState<MixerPresetMix>(emptyMixerMix);
  const [nameDraft, setNameDraft] = useState("Untitled mix");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [iconDraft, setIconDraft] = useState("cloud-rain");
  const [iconBgDraft, setIconBgDraft] = useState("#E4EEF4");
  const [iconColorDraft, setIconColorDraft] = useState("#3D5A73");
  const [factoryPresets, setFactoryPresets] = useState<MixerFactoryPreset[]>(
    () => initialFactoryPresets ?? [],
  );
  const [factoryPresetsLoading, setFactoryPresetsLoading] = useState(
    () => initialFactoryPresets == null,
  );
  const [loadedFactoryId, setLoadedFactoryId] = useState<string | null>(null);
  const [factoryPreviewId, setFactoryPreviewId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [backgroundNature, setBackgroundNature] = useState<BackgroundAudioItem[]>(
    [],
  );
  const [backgroundMusic, setBackgroundMusic] = useState<BackgroundAudioItem[]>(
    [],
  );
  const [backgroundDrums, setBackgroundDrums] = useState<BackgroundAudioItem[]>(
    [],
  );
  const [backgroundNoise, setBackgroundNoise] = useState<BackgroundAudioItem[]>(
    [],
  );
  const [mediaBaseUrl, setMediaBaseUrl] = useState<string | null>(null);
  const [fishSpeakers, setFishSpeakers] = useState<FishSpeaker[]>([]);
  const [speakerModelId, setSpeakerModelId] = useState("");
  const [speakerFxPreviewOn, setSpeakerFxPreviewOn] = useState(true);
  const [speakerPlaying, setSpeakerPlaying] = useState(false);

  const [playing, setPlaying] = useState<Record<BedTrack, boolean>>({
    nature: false,
    music: false,
    drums: false,
    noise: false,
  });
  const [playAllActive, setPlayAllActive] = useState(false);

  const previewNatureRef = useRef<HTMLAudioElement | null>(null);
  const previewMusicRef = useRef<HTMLAudioElement | null>(null);
  const previewDrumsRef = useRef<HTMLAudioElement | null>(null);
  const previewNoiseRef = useRef<HTMLAudioElement | null>(null);
  const speakerSampleRef = useRef<HTMLAudioElement | null>(null);
  const factoryNatureRef = useRef<HTMLAudioElement | null>(null);
  const factoryMusicRef = useRef<HTMLAudioElement | null>(null);
  const factoryDrumsRef = useRef<HTMLAudioElement | null>(null);
  const factoryNoiseRef = useRef<HTMLAudioElement | null>(null);
  const lastBgKeysRef = useRef<Record<BedTrack, string>>({
    nature: "",
    music: "",
    drums: "",
    noise: "",
  });

  const drumsLockedForMelodic = isMelodicMusicKey(
    backgroundMusic,
    mix.musicKey,
  );
  const drumsPreviewKey = drumsLockedForMelodic ? "" : mix.drumsKey;

  const activePreset = useMemo(
    () => presets.find((p) => p.id === activeId) ?? null,
    [presets, activeId],
  );

  const loadedFactory = useMemo(
    () => factoryPresets.find((p) => p.id === loadedFactoryId) ?? null,
    [factoryPresets, loadedFactoryId],
  );

  const editorFactory: MixerFactoryPreset = useMemo(
    () => ({
      id: loadedFactoryId || "",
      name: nameDraft.trim() || "Untitled mix",
      description: descriptionDraft.trim(),
      icon: iconDraft,
      icon_bg: iconBgDraft,
      icon_color: iconColorDraft,
      channels: mixToFactoryChannels(mix),
    }),
    [
      loadedFactoryId,
      nameDraft,
      descriptionDraft,
      iconDraft,
      iconBgDraft,
      iconColorDraft,
      mix,
    ],
  );

  const dirty = useMemo(() => {
    if (isAdmin) {
      if (!loadedFactory) return true;
      return !factoryPresetEquals(loadedFactory, {
        ...editorFactory,
        id: loadedFactory.id,
      });
    }
    if (!activePreset) return true;
    if (nameDraft.trim() !== activePreset.name) return true;
    return !mixEquals(mix, activePreset);
  }, [isAdmin, loadedFactory, editorFactory, activePreset, mix, nameDraft]);

  useEffect(() => {
    if (isAdmin) {
      setHydrated(true);
      return;
    }
    const store = loadMixerPresetStore();
    setPresets(store.presets);
    setActiveId(store.activeId);
    const cur =
      store.presets.find((p) => p.id === store.activeId) ?? store.presets[0];
    if (cur) {
      setMix(mixerPresetToMix(cur));
      setNameDraft(cur.name);
    }
    setHydrated(true);
  }, [isAdmin]);

  useEffect(() => {
    if (!hydrated || isAdmin) return;
    saveMixerPresetStore({
      version: 1,
      activeId,
      presets,
    });
  }, [hydrated, isAdmin, activeId, presets]);

  useEffect(() => {
    let cancelled = false;
    const envMediaBase = getMedimadeMediaBaseUrl();
    void (async () => {
      try {
        const data = await listBackgroundAudio();
        if (cancelled) return;
        setBackgroundNature(data.nature);
        setBackgroundMusic(data.music);
        setBackgroundDrums(data.drums);
        setBackgroundNoise(data.noise);
        const fromApi = data.baseUrl?.trim();
        setMediaBaseUrl(fromApi || envMediaBase || null);
        if (isAdmin) {
          try {
            const speakers = await listFishSpeakers();
            if (cancelled) return;
            setFishSpeakers(speakers);
            setSpeakerModelId((cur) => cur || speakers[0]?.modelId || "");
          } catch {
            if (!cancelled) setFishSpeakers([]);
          }
        }
        if (!isAdmin) {
          setFactoryPresets(data.factoryMixes ?? []);
        }
      } catch {
        if (cancelled) return;
        setBackgroundNature([]);
        setBackgroundMusic([]);
        setBackgroundDrums([]);
        setBackgroundNoise([]);
        setMediaBaseUrl(envMediaBase || null);
        if (!isAdmin && initialFactoryPresets == null) {
          setFactoryPresets([]);
        }
      } finally {
        if (!cancelled && !isAdmin) setFactoryPresetsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, initialFactoryPresets]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setFactoryPresetsLoading(true);
    void (async () => {
      try {
        const mixes = await listAdminFactoryMixes();
        if (cancelled) return;
        setFactoryPresets(mixes);
      } catch {
        if (!cancelled) setFactoryPresets([]);
      } finally {
        if (!cancelled) setFactoryPresetsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  function stopTrack(track: BedTrack) {
    setPlayAllActive(false);
    if (track === "nature") previewNatureRef.current?.pause();
    if (track === "music") previewMusicRef.current?.pause();
    if (track === "drums") previewDrumsRef.current?.pause();
    if (track === "noise") previewNoiseRef.current?.pause();
    setPlaying((p) => ({ ...p, [track]: false }));
  }

  function stopAll() {
    previewNatureRef.current?.pause();
    previewMusicRef.current?.pause();
    previewDrumsRef.current?.pause();
    previewNoiseRef.current?.pause();
    speakerSampleRef.current?.pause();
    setPlayAllActive(false);
    setSpeakerPlaying(false);
    setPlaying({ nature: false, music: false, drums: false, noise: false });
  }

  function stopFactoryPreview() {
    factoryNatureRef.current?.pause();
    factoryMusicRef.current?.pause();
    factoryDrumsRef.current?.pause();
    factoryNoiseRef.current?.pause();
    setFactoryPreviewId(null);
  }

  function loadMixIntoEditor(opts: {
    name: string;
    mix: MixerPresetMix;
    savedId: string | null;
    factoryId?: string | null;
    factoryMeta?: Pick<
      MixerFactoryPreset,
      "description" | "icon" | "icon_bg" | "icon_color"
    >;
  }) {
    stopFactoryPreview();
    speakerSampleRef.current?.pause();
    setSpeakerPlaying(false);
    setNameDraft(opts.name);
    setMix(opts.mix);
    setActiveId(opts.savedId);
    setLoadedFactoryId(opts.factoryId ?? null);
    setDescriptionDraft(opts.factoryMeta?.description ?? "");
    setIconDraft(opts.factoryMeta?.icon ?? "cloud-rain");
    setIconBgDraft(opts.factoryMeta?.icon_bg ?? "#E4EEF4");
    setIconColorDraft(opts.factoryMeta?.icon_color ?? "#3D5A73");
    setSaveError(null);
    const nextPlaying = playingFromMix(opts.mix, backgroundMusic);
    setPlaying(nextPlaying);
    setPlayAllActive(
      nextPlaying.nature ||
        nextPlaying.music ||
        nextPlaying.drums ||
        nextPlaying.noise,
    );
  }

  useEffect(() => {
    if (!drumsLockedForMelodic) return;
    previewDrumsRef.current?.pause();
    setPlaying((p) => (p.drums ? { ...p, drums: false } : p));
  }, [drumsLockedForMelodic]);

  useEffect(() => {
    const base = mediaBaseUrl;
    const sync = async (
      el: HTMLAudioElement | null,
      key: string,
      gain: number,
      track: BedTrack,
    ) => {
      if (!el) return;
      el.loop = true;
      if (base && key) {
        const next = mediaFileUrl(base, backgroundAudioStreamingKey(key));
        const prevKey = lastBgKeysRef.current[track];
        const keyChanged = prevKey !== key;
        if (el.src !== next) {
          el.src = next;
          void el.load();
        }
        // Mixer 100% → 0.5 playback. Re-apply after load(); load() resets volume to 1.
        applyBedElementVolume(el, gain);
        el.onloadeddata = () => applyBedElementVolume(el, gain);
        if (keyChanged || playing[track]) {
          try {
            await el.play();
            setPlaying((p) => ({ ...p, [track]: true }));
          } catch {
            stopTrack(track);
          }
        }
        lastBgKeysRef.current[track] = key;
      } else {
        el.removeAttribute("src");
        el.load();
        if (playing[track]) stopTrack(track);
        lastBgKeysRef.current[track] = "";
      }
    };
    void sync(previewNatureRef.current, mix.natureKey, mix.natureGain, "nature");
    void sync(previewMusicRef.current, mix.musicKey, mix.musicGain, "music");
    void sync(previewDrumsRef.current, drumsPreviewKey, mix.drumsGain, "drums");
    void sync(previewNoiseRef.current, mix.noiseKey, mix.noiseGain, "noise");
  }, [
    mediaBaseUrl,
    mix.natureKey,
    mix.musicKey,
    drumsPreviewKey,
    mix.noiseKey,
    mix.natureGain,
    mix.musicGain,
    mix.drumsGain,
    mix.noiseGain,
    playing.nature,
    playing.music,
    playing.drums,
    playing.noise,
  ]);

  useEffect(() => {
    return () => {
      [
        previewNatureRef,
        previewMusicRef,
        previewDrumsRef,
        previewNoiseRef,
        speakerSampleRef,
        factoryNatureRef,
        factoryMusicRef,
        factoryDrumsRef,
        factoryNoiseRef,
      ].forEach((r) => {
        const el = r.current;
        if (!el) return;
        el.pause();
        el.removeAttribute("src");
      });
    };
  }, []);

  useEffect(() => {
    const el = speakerSampleRef.current;
    if (!el || !isAdmin) return;
    el.loop = true;
    el.volume = 1;
    if (mediaBaseUrl && speakerModelId) {
      const key = speakerFxPreviewOn
        ? speakerPreviewLoudFxSampleKey(
            speakerModelId,
            FIXED_SPEECH_PREVIEW_SPEED,
          )
        : speakerPreviewLoudSampleKey(
            speakerModelId,
            FIXED_SPEECH_PREVIEW_SPEED,
          );
      const next = mediaFileUrl(mediaBaseUrl, key);
      if (el.src !== next) {
        el.src = next;
        void el.load();
      }
      if (speakerPlaying) {
        void el.play().catch(() => setSpeakerPlaying(false));
      }
    } else {
      el.removeAttribute("src");
      el.load();
      if (speakerPlaying) setSpeakerPlaying(false);
    }
  }, [
    isAdmin,
    mediaBaseUrl,
    speakerModelId,
    speakerFxPreviewOn,
    speakerPlaying,
  ]);

  const anyTrackPlaying =
    playing.nature ||
    playing.music ||
    playing.drums ||
    playing.noise ||
    speakerPlaying;

  async function togglePlayAll() {
    if (!mediaBaseUrl) return;
    stopFactoryPreview();
    if (anyTrackPlaying || playAllActive) {
      stopAll();
      return;
    }
    stopAll();
    const parts: Promise<void>[] = [];
    if (mix.natureKey && previewNatureRef.current?.src) {
      applyBedElementVolume(previewNatureRef.current, mix.natureGain);
      parts.push(previewNatureRef.current.play());
    }
    if (mix.musicKey && previewMusicRef.current?.src) {
      applyBedElementVolume(previewMusicRef.current, mix.musicGain);
      parts.push(previewMusicRef.current.play());
    }
    if (drumsPreviewKey && previewDrumsRef.current?.src) {
      applyBedElementVolume(previewDrumsRef.current, mix.drumsGain);
      parts.push(previewDrumsRef.current.play());
    }
    if (mix.noiseKey && previewNoiseRef.current?.src) {
      applyBedElementVolume(previewNoiseRef.current, mix.noiseGain);
      parts.push(previewNoiseRef.current.play());
    }
    if (isAdmin && speakerModelId && speakerSampleRef.current?.src) {
      parts.push(speakerSampleRef.current.play());
    }
    setPlayAllActive(true);
    setSpeakerPlaying(
      Boolean(isAdmin && speakerModelId && speakerSampleRef.current?.src),
    );
    setPlaying({
      nature: Boolean(mix.natureKey && previewNatureRef.current?.src),
      music: Boolean(mix.musicKey && previewMusicRef.current?.src),
      drums: Boolean(drumsPreviewKey && previewDrumsRef.current?.src),
      noise: Boolean(mix.noiseKey && previewNoiseRef.current?.src),
    });
    await Promise.all(parts.map((p) => p.catch(() => undefined)));
  }

  async function toggleSpeakerPreview() {
    if (!isAdmin || !mediaBaseUrl || !speakerModelId) return;
    stopFactoryPreview();
    const el = speakerSampleRef.current;
    if (!el) return;
    if (speakerPlaying) {
      el.pause();
      setSpeakerPlaying(false);
      setPlayAllActive(false);
      return;
    }
    if (!el.src) return;
    try {
      setPlayAllActive(false);
      await el.play();
      setSpeakerPlaying(true);
    } catch {
      setSpeakerPlaying(false);
    }
  }

  async function toggleRowPreview(track: BedTrack) {
    stopFactoryPreview();
    if (track === "nature" && !mix.natureKey) return;
    if (track === "music" && !mix.musicKey) return;
    if (track === "drums" && (!mix.drumsKey || drumsLockedForMelodic)) return;
    if (track === "noise" && !mix.noiseKey) return;
    if (playing[track]) {
      stopTrack(track);
      return;
    }
    const el =
      track === "nature"
        ? previewNatureRef.current
        : track === "music"
          ? previewMusicRef.current
          : track === "drums"
            ? previewDrumsRef.current
            : previewNoiseRef.current;
    if (!el?.src) return;
    const gain =
      track === "nature"
        ? mix.natureGain
        : track === "music"
          ? mix.musicGain
          : track === "drums"
            ? mix.drumsGain
            : mix.noiseGain;
    try {
      applyBedElementVolume(el, gain);
      await el.play();
      setPlaying((p) => ({ ...p, [track]: true }));
    } catch {
      stopTrack(track);
    }
  }

  function applyPreset(p: MixerPreset) {
    loadMixIntoEditor({
      name: p.name,
      mix: mixerPresetToMix(p),
      savedId: p.id,
    });
  }

  function applyFactoryPreset(p: MixerFactoryPreset) {
    loadMixIntoEditor({
      name: p.name,
      mix: factoryPresetToMix(p),
      savedId: isAdmin ? p.id : null,
      factoryId: p.id,
      factoryMeta: {
        description: p.description,
        icon: p.icon,
        icon_bg: p.icon_bg,
        icon_color: p.icon_color,
      },
    });
  }

  async function toggleFactoryPreview(p: MixerFactoryPreset) {
    if (factoryPreviewId === p.id) {
      stopFactoryPreview();
      return;
    }
    if (!mediaBaseUrl) return;
    stopAll();
    const nextMix = factoryPresetToMix(p);
    const beds: Array<{
      el: HTMLAudioElement | null;
      key: string;
      gain: number;
    }> = [
      {
        el: factoryNatureRef.current,
        key: nextMix.natureKey,
        gain: nextMix.natureGain,
      },
      {
        el: factoryMusicRef.current,
        key: nextMix.musicKey,
        gain: nextMix.musicGain,
      },
      {
        el: factoryDrumsRef.current,
        key: nextMix.drumsKey,
        gain: nextMix.drumsGain,
      },
      {
        el: factoryNoiseRef.current,
        key: nextMix.noiseKey,
        gain: nextMix.noiseGain,
      },
    ];
    const parts: Promise<void>[] = [];
    for (const bed of beds) {
      const el = bed.el;
      if (!el) continue;
      el.loop = true;
      if (bed.key) {
        const next = mediaFileUrl(
          mediaBaseUrl,
          backgroundAudioStreamingKey(bed.key),
        );
        if (el.src !== next) {
          el.src = next;
          void el.load();
        }
        applyBedElementVolume(el, bed.gain);
        el.onloadeddata = () => applyBedElementVolume(el, bed.gain);
        parts.push(el.play().catch(() => undefined));
      } else {
        el.pause();
        el.removeAttribute("src");
        el.load();
      }
    }
    if (parts.length === 0) return;
    setFactoryPreviewId(p.id);
    await Promise.all(parts);
  }

  function createNew() {
    stopFactoryPreview();
    stopAll();
    setSaveError(null);
    if (isAdmin) {
      const p = emptyFactoryPreset();
      setFactoryPresets((prev) => [p, ...prev]);
      loadMixIntoEditor({
        name: p.name,
        mix: factoryPresetToMix(p),
        savedId: p.id,
        factoryId: p.id,
        factoryMeta: {
          description: p.description,
          icon: p.icon,
          icon_bg: p.icon_bg,
          icon_color: p.icon_color,
        },
      });
      return;
    }
    const p = newMixerPreset();
    setPresets((prev) => [p, ...prev]);
    setActiveId(p.id);
    setLoadedFactoryId(null);
    setNameDraft(p.name);
    setMix(emptyMixerMix());
  }

  async function saveCurrent() {
    const name = nameDraft.trim() || "Untitled mix";
    setNameDraft(name);
    if (isAdmin) {
      setSaving(true);
      setSaveError(null);
      try {
        const payload: MixerFactoryPreset = {
          ...editorFactory,
          id: loadedFactoryId || editorFactory.id || emptyFactoryPreset().id,
          name,
        };
        const saved = await saveAdminFactoryMix(payload);
        setFactoryPresets((prev) => {
          const withoutDraft = prev.filter(
            (p) => p.id !== payload.id && p.id !== saved.id,
          );
          return [saved, ...withoutDraft];
        });
        setLoadedFactoryId(saved.id);
        setActiveId(saved.id);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Could not save mix");
      } finally {
        setSaving(false);
      }
      return;
    }
    const now = new Date().toISOString();
    if (!activeId) {
      const p: MixerPreset = {
        ...newMixerPreset(name),
        ...mix,
        name,
        updatedAt: now,
      };
      setPresets((prev) => [p, ...prev]);
      setActiveId(p.id);
      setLoadedFactoryId(null);
      return;
    }
    setPresets((prev) =>
      prev.map((p) =>
        p.id === activeId
          ? { ...p, ...mix, name, updatedAt: now }
          : p,
      ),
    );
    setLoadedFactoryId(null);
  }

  async function deleteCurrentFactory() {
    if (!isAdmin || !loadedFactoryId) return;
    if (!window.confirm("Remove this factory mix?")) return;
    setSaveError(null);
    try {
      try {
        await deleteAdminFactoryMix(loadedFactoryId);
      } catch {
        /* Draft mixes are local-only until Save. */
      }
      setFactoryPresets((prev) => prev.filter((p) => p.id !== loadedFactoryId));
      setLoadedFactoryId(null);
      setActiveId(null);
      setNameDraft("Untitled mix");
      setDescriptionDraft("");
      setMix(emptyMixerMix());
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not delete mix");
    }
  }

  function patchMix(partial: Partial<MixerPresetMix>) {
    const next = { ...mix, ...partial };
    setMix(next);
    const drumsLocked = isMelodicMusicKey(backgroundMusic, next.musicKey);
    setPlaying((p) => {
      const live = { ...p };
      if (partial.musicKey !== undefined) {
        live.music = Boolean(partial.musicKey.trim());
      }
      if (partial.natureKey !== undefined) {
        live.nature = Boolean(partial.natureKey.trim());
      }
      if (partial.drumsKey !== undefined) {
        live.drums = Boolean(partial.drumsKey.trim()) && !drumsLocked;
      }
      if (partial.noiseKey !== undefined) {
        live.noise = Boolean(partial.noiseKey.trim());
      }
      if (drumsLocked) live.drums = false;
      return live;
    });
  }

  return (
    <div
      className={
        isAdmin
          ? "flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
          : "mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6"
      }
    >
      <audio ref={previewNatureRef} className="hidden" playsInline />
      <audio ref={previewMusicRef} className="hidden" playsInline />
      <audio ref={previewDrumsRef} className="hidden" playsInline />
      <audio ref={previewNoiseRef} className="hidden" playsInline />
      {isAdmin ? (
        <audio ref={speakerSampleRef} className="hidden" playsInline />
      ) : null}
      <audio ref={factoryNatureRef} className="hidden" playsInline />
      <audio ref={factoryMusicRef} className="hidden" playsInline />
      <audio ref={factoryDrumsRef} className="hidden" playsInline />
      <audio ref={factoryNoiseRef} className="hidden" playsInline />

      <div
        className={`flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 ${
          isAdmin ? "mb-3" : "mb-6"
        }`}
      >
        {isAdmin ? (
          <p className="text-sm text-muted">
            Factory presets shown on the Sounds page. Save publishes to everyone.
          </p>
        ) : (
          <h1 className="font-display text-3xl font-medium tracking-tight">
            Sounds
          </h1>
        )}
        <button
          type="button"
          onClick={createNew}
          className="cursor-pointer rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold text-on-accent shadow-sm transition-opacity hover:opacity-90"
        >
          + New mix
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row lg:gap-4">
        <aside
          className={`flex shrink-0 flex-col gap-2 overflow-hidden border-b border-border pb-4 lg:w-72 lg:border-b-0 lg:pb-0 ${
            isAdmin
              ? "max-h-[11rem] min-h-0 lg:max-h-none lg:h-full"
              : "max-h-[28rem] overflow-visible lg:max-h-none"
          }`}
        >
          <nav
            className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 [scrollbar-gutter:stable]"
            aria-label={
              isAdmin ? "Factory presets" : "Factory presets and saved mixes"
            }
          >
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Factory presets
              </h2>
              {factoryPresetsLoading ? (
                <FactoryPresetListSkeleton />
              ) : factoryPresets.length === 0 ? (
                <p className="text-sm text-muted">
                  {isAdmin
                    ? "No factory mixes yet. Start with + New mix, then Save."
                    : "No factory mixes yet."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {factoryPresets.map((p) => (
                    <li key={p.id}>
                      <FactoryPresetRow
                        preset={p}
                        loaded={p.id === loadedFactoryId}
                        previewing={p.id === factoryPreviewId}
                        onLoad={() => applyFactoryPreset(p)}
                        onPreview={() => void toggleFactoryPreview(p)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {isAdmin ? null : (
              <div className="border-t-[0.5px] border-solid border-border pt-4">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Your mixes
              </h2>
              {!hydrated ? (
                <p className="text-sm text-muted">Loading…</p>
              ) : presets.length === 0 ? (
                <p className="text-sm text-muted">
                  Nothing saved yet — start from a preset above, or build your
                  own with + New mix.
                </p>
              ) : (
                <ul className="space-y-2">
                  {presets.map((p) => {
                    const isActive = p.id === activeId;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => applyPreset(p)}
                          className={`w-full cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-colors ${
                            isActive
                              ? "border-border border-l-[3px] border-l-accent bg-card text-foreground shadow-sm"
                              : "border-border bg-background text-foreground hover:border-accent/40"
                          }`}
                        >
                          <span className="line-clamp-2 text-sm font-semibold">
                            {p.name}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              </div>
            )}
          </nav>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <label className="sr-only" htmlFor="mixer-preset-name">
                Mix name
              </label>
              <input
                id="mixer-preset-name"
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Name this mix"
                className="min-w-0 flex-1 border-0 bg-transparent font-display text-xl font-medium tracking-tight text-foreground outline-none placeholder:text-muted/45"
              />
              <button
                type="button"
                onClick={() => void togglePlayAll()}
                disabled={!mediaBaseUrl}
                className="inline-flex cursor-pointer items-center rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {anyTrackPlaying || playAllActive ? "Pause all" : "Play all"}
              </button>
              <button
                type="button"
                onClick={() => void saveCurrent()}
                disabled={!dirty || saving}
                className="cursor-pointer rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-on-accent shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              {isAdmin && loadedFactoryId ? (
                <button
                  type="button"
                  onClick={() => void deleteCurrentFactory()}
                  className="cursor-pointer rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold text-muted shadow-sm transition-colors hover:border-accent/40 hover:text-foreground"
                >
                  Delete
                </button>
              ) : null}
            </div>
            {isAdmin ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
                <label className="sr-only" htmlFor="factory-mix-description">
                  Description
                </label>
                <input
                  id="factory-mix-description"
                  type="text"
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  placeholder="Short description"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted"
                />
                <label className="sr-only" htmlFor="factory-mix-icon">
                  Icon
                </label>
                <FactoryIconSelect
                  value={iconDraft}
                  onChange={setIconDraft}
                  iconBg={iconBgDraft}
                  iconColor={iconColorDraft}
                />
                <div className="flex items-center gap-1.5" aria-label="Icon color">
                  {FACTORY_COLOR_PRESETS.map((c) => {
                    const selected =
                      c.icon_bg === iconBgDraft && c.icon_color === iconColorDraft;
                    return (
                      <button
                        key={c.icon_bg}
                        type="button"
                        title="Preset color"
                        onClick={() => {
                          setIconBgDraft(c.icon_bg);
                          setIconColorDraft(c.icon_color);
                        }}
                        className={`h-7 w-7 rounded-lg border ${
                          selected ? "border-accent" : "border-border"
                        }`}
                        style={{ backgroundColor: c.icon_bg }}
                      />
                    );
                  })}
                </div>
                {saveError ? (
                  <p className="w-full text-sm text-danger">{saveError}</p>
                ) : null}
              </div>
            ) : null}
            <div className="flex min-h-0 flex-1 items-stretch gap-2 overflow-x-auto p-4">
              {isAdmin ? (
                <MixerVoiceChannel
                  voices={fishSpeakers}
                  value={speakerModelId}
                  onChange={setSpeakerModelId}
                  fxOn={speakerFxPreviewOn}
                  onFxChange={setSpeakerFxPreviewOn}
                  fxDisabled={!mediaBaseUrl || !speakerModelId}
                  playing={speakerPlaying}
                  onTogglePreview={() => void toggleSpeakerPreview()}
                  playDisabled={!mediaBaseUrl || !speakerModelId}
                  showDisc={false}
                />
              ) : null}
              <MixerChannel
                label="Music"
                category="music"
                items={backgroundMusic}
                value={mix.musicKey}
                onChange={(key) => patchMix({ musicKey: key })}
                gain={mix.musicGain}
                onGainChange={(gain) => patchMix({ musicGain: gain })}
                faderDisabled={!mix.musicKey}
                playing={playing.music}
                onTogglePreview={() => void toggleRowPreview("music")}
                playDisabled={!mix.musicKey}
                playAriaLabel={playing.music ? "Pause music" : "Play music"}
              />
              <MixerChannel
                label="Ambience"
                category="ambience"
                items={backgroundNature}
                value={mix.natureKey}
                onChange={(key) => patchMix({ natureKey: key })}
                gain={mix.natureGain}
                onGainChange={(gain) => patchMix({ natureGain: gain })}
                faderDisabled={!mix.natureKey}
                playing={playing.nature}
                onTogglePreview={() => void toggleRowPreview("nature")}
                playDisabled={!mix.natureKey}
                playAriaLabel={
                  playing.nature ? "Pause ambience" : "Play ambience"
                }
              />
              <DrumsLockedWrap
                locked={drumsLockedForMelodic}
                className="flex h-full min-w-[5.75rem] flex-1 items-stretch"
              >
                <MixerChannel
                  label="Drums"
                  category="drums"
                  items={backgroundDrums}
                  value={mix.drumsKey}
                  onChange={(key) => patchMix({ drumsKey: key })}
                  gain={mix.drumsGain}
                  onGainChange={(gain) => patchMix({ drumsGain: gain })}
                  disabled={drumsLockedForMelodic}
                  faderDisabled={drumsLockedForMelodic || !mix.drumsKey}
                  playing={playing.drums}
                  onTogglePreview={() => void toggleRowPreview("drums")}
                  playDisabled={drumsLockedForMelodic || !mix.drumsKey}
                  playAriaLabel={playing.drums ? "Pause drums" : "Play drums"}
                />
              </DrumsLockedWrap>
              <MixerChannel
                label="Noise"
                category="noise"
                items={backgroundNoise}
                value={mix.noiseKey}
                onChange={(key) => patchMix({ noiseKey: key })}
                gain={mix.noiseGain}
                onGainChange={(gain) => patchMix({ noiseGain: gain })}
                faderDisabled={!mix.noiseKey}
                playing={playing.noise}
                onTogglePreview={() => void toggleRowPreview("noise")}
                playDisabled={!mix.noiseKey}
                playAriaLabel={playing.noise ? "Pause noise" : "Play noise"}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
