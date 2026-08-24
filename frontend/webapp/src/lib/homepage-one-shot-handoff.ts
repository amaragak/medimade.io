import {
  backgroundAudioStreamingKey,
  createMeditationAudioJob,
  getMeditationAudioJobStatus,
  listBackgroundAudio,
  listFishSpeakers,
  VOICE_FX_PRESET_MEDITATION_MIXER,
  type BackgroundAudioItem,
  type FishSpeaker,
} from "@/lib/medimade-api";
import { FISH_SPEAKERS, fishSpeakersForPicker } from "@/lib/fish-speakers";
import { factoryPresetToMix } from "@/lib/mixer-factory-presets";
import type { MixerPresetMix } from "@/lib/mixer-preset-storage";
import {
  appendPendingLibraryGeneration,
  type PendingLibraryGeneration,
} from "@/lib/pending-library-generations";
import { FIXED_SPEECH_PREVIEW_SPEED } from "@/lib/speaker-sample-speed";

/** Keep in sync with create-workspace `confirmOneShotPrompt`. */
export function packageOneShotPrompt(prompt: string): string {
  return (
    "Please write a complete guided meditation script from this one-shot request. " +
    "Use a calm, warm tone suitable for spoken guidance. Interpret the request generously — " +
    "do not ask clarifying questions.\n\n" +
    `Request:\n${prompt.trim()}`
  );
}

function pickRandom<T>(items: readonly T[]): T | null {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

function emptyMix(): MixerPresetMix {
  return {
    musicKey: "",
    natureKey: "",
    drumsKey: "",
    noiseKey: "",
    musicGain: 50,
    natureGain: 25,
    drumsGain: 10,
    noiseGain: 40,
  };
}

function streamKey(item: BackgroundAudioItem | undefined): string {
  const key = item?.key?.trim();
  if (!key) return "";
  return backgroundAudioStreamingKey(key);
}

export async function loadHomepageFishSpeakers(): Promise<FishSpeaker[]> {
  try {
    const live = await listFishSpeakers();
    const pool = fishSpeakersForPicker(live);
    if (pool.length) return pool;
  } catch {
    /* bundled fallback */
  }
  return fishSpeakersForPicker(
    FISH_SPEAKERS.map((s) => ({ name: s.name, modelId: s.modelId })),
  );
}

async function pickRandomSoundBed(): Promise<MixerPresetMix> {
  try {
    const beds = await listBackgroundAudio();
    const factories = (beds.factoryMixes ?? []).filter((p) => Boolean(p?.id));
    const factory = pickRandom(factories);
    if (factory) return factoryPresetToMix(factory);

    const mix = emptyMix();
    const nature = pickRandom(beds.nature);
    const music = pickRandom(beds.music);
    if (nature) {
      mix.natureKey = streamKey(nature);
      mix.natureGain = 35;
    }
    if (music) {
      mix.musicKey = streamKey(music);
      mix.musicGain = 28;
    }
    return mix;
  } catch {
    return emptyMix();
  }
}

async function waitForLibraryMeta(jobId: string): Promise<{
  title: string;
  description: string;
}> {
  const deadlineMs = 5 * 60_000;
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    let st: Awaited<ReturnType<typeof getMeditationAudioJobStatus>>;
    try {
      st = await getMeditationAudioJobStatus(jobId);
    } catch {
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }
    if (st.status === "failed") {
      throw new Error(st.error ?? "Generation failed");
    }
    const scriptOk = (st.scriptTextUsed ?? "").trim().length > 0;
    const title = (st.title ?? "").trim();
    const description = (st.description ?? "").trim();
    if (scriptOk && title && description) {
      return { title, description };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    "Timed out waiting for your meditation. Open Library to check if it finished.",
  );
}

export type HomepageOneShotResult = {
  libraryHref: string;
  jobId: string;
};

/**
 * Creates a one-shot meditation from the homepage: random factory sound bed,
 * chosen (or random) Fish speaker, waits for library metadata, then returns
 * the Library focus URL. Skips the create/mix UI.
 */
export async function startHomepageOneShotGeneration(opts: {
  prompt: string;
  /** When set, use this speaker; otherwise pick at random. */
  speakerModelId?: string | null;
}): Promise<HomepageOneShotResult> {
  const trimmed = opts.prompt.trim();
  if (!trimmed) throw new Error("Enter a prompt for your meditation.");

  const speakers = await loadHomepageFishSpeakers();
  const requested = opts.speakerModelId?.trim() || "";
  const speaker =
    (requested
      ? speakers.find((s) => s.modelId === requested)
      : null) ??
    pickRandom(speakers) ??
    null;
  const speakerModelId = speaker?.modelId?.trim() || "";
  if (!speakerModelId) {
    throw new Error("No speaker available. Try again in a moment.");
  }

  const mix = await pickRandomSoundBed();
  const packaged = packageOneShotPrompt(trimmed);
  const transcript = `User: ${packaged}`;

  const { jobId } = await createMeditationAudioJob({
    meditationStyle: "General",
    journalMode: true,
    meditationTargetMinutes: 5,
    transcript,
    scriptText: "",
    reference_id: speakerModelId,
    ttsProvider: "fish",
    speed: FIXED_SPEECH_PREVIEW_SPEED,
    voiceFxPreset: VOICE_FX_PRESET_MEDITATION_MIXER,
    ...(mix.natureKey
      ? {
          backgroundNatureKey: backgroundAudioStreamingKey(mix.natureKey),
          backgroundNatureGain: mix.natureGain,
        }
      : {}),
    ...(mix.musicKey
      ? {
          backgroundMusicKey: backgroundAudioStreamingKey(mix.musicKey),
          backgroundMusicGain: mix.musicGain,
        }
      : {}),
    ...(mix.drumsKey
      ? {
          backgroundDrumsKey: backgroundAudioStreamingKey(mix.drumsKey),
          backgroundDrumsGain: mix.drumsGain,
        }
      : {}),
    ...(mix.noiseKey
      ? {
          backgroundNoiseKey: backgroundAudioStreamingKey(mix.noiseKey),
          backgroundNoiseGain: mix.noiseGain,
        }
      : {}),
  });

  const meta = await waitForLibraryMeta(jobId);

  const pending: PendingLibraryGeneration = {
    jobId,
    createdAt: new Date().toISOString(),
    title: meta.title,
    description: meta.description,
    meditationStyle: "General",
    speakerName: speaker?.name ?? null,
    speakerModelId,
  };
  appendPendingLibraryGeneration(pending);

  return {
    jobId,
    libraryHref: `/meditate/library?focus=${encodeURIComponent(`pending:${jobId}`)}`,
  };
}
