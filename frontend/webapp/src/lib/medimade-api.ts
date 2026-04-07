export type MedimadeChatTurn = { role: "user" | "assistant"; content: string };

export function getMedimadeApiBase(): string | null {
  const u = process.env.NEXT_PUBLIC_MEDIMADE_API_URL;
  if (!u || typeof u !== "string") return null;
  const t = u.trim();
  if (!t) return null;
  return t.endsWith("/") ? t.slice(0, -1) : t;
}

/** Full URL of the streaming chat Lambda (Function URL), not API Gateway /chat. */
export function getMedimadeChatUrl(): string | null {
  const u = process.env.NEXT_PUBLIC_MEDIMADE_CHAT_URL;
  if (!u || typeof u !== "string") return null;
  const t = u.trim();
  return t || null;
}

/**
 * Public base URL for files in the media bucket (same host as library MP3s), no trailing slash.
 * Set from CDK output `MediaCloudFrontDomain` as `https://<domain>`.
 * Used for background preview when the list API does not include `baseUrl`.
 */
export function getMedimadeMediaBaseUrl(): string | null {
  const u = process.env.NEXT_PUBLIC_MEDIMADE_MEDIA_BASE_URL;
  if (!u || typeof u !== "string") return null;
  const t = u.trim().replace(/\/$/, "");
  return t || null;
}

async function streamChatRequest(
  body: Record<string, unknown>,
  onDelta: (chunk: string) => void,
  emptyMessage: string,
): Promise<string> {
  const url = getMedimadeChatUrl();
  if (!url) {
    throw new Error("NEXT_PUBLIC_MEDIMADE_CHAT_URL is not set");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const ct = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    let msg = res.statusText;
    try {
      if (ct.includes("application/json")) {
        const j = (await res.json()) as { error?: string; detail?: string };
        msg = j.detail ?? j.error ?? msg;
      } else {
        msg = (await res.text()).slice(0, 500) || msg;
      }
    } catch {
      /* keep msg */
    }
    throw new Error(msg);
  }

  if (!ct.includes("text/event-stream")) {
    const t = await res.text();
    throw new Error(
      t.slice(0, 200) || "Expected text/event-stream from chat endpoint",
    );
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const dec = new TextDecoder();
  let carry = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += dec.decode(value, { stream: true });
    let sep: number;
    while ((sep = carry.indexOf("\n\n")) !== -1) {
      const block = carry.slice(0, sep);
      carry = carry.slice(sep + 2);
      for (const line of block.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const raw = line.replace(/^data:\s*/, "").trim();
        if (!raw) continue;
        let data: { d?: string; done?: boolean; error?: string };
        try {
          data = JSON.parse(raw) as { d?: string; done?: boolean; error?: string };
        } catch {
          continue;
        }
        if (data.error) {
          throw new Error(data.error);
        }
        if (typeof data.d === "string" && data.d.length > 0) {
          full += data.d;
          onDelta(data.d);
        }
      }
    }
  }

  if (!full.trim()) {
    throw new Error(emptyMessage);
  }

  return full;
}

/**
 * Streams Claude tokens from Anthropic via our Lambda (SSE). Calls onDelta for each chunk.
 */
export async function streamMedimadeChat(
  params: {
    meditationStyle: string;
    messages: MedimadeChatTurn[];
  },
  onDelta: (chunk: string) => void,
): Promise<string> {
  return streamChatRequest(
    {
      mode: "chat",
      meditationStyle: params.meditationStyle,
      messages: params.messages,
    },
    onDelta,
    "Empty reply from guide",
  );
}

/**
 * Streams a ~5-minute guided meditation script from Claude using full chat transcript + style hint.
 */
export async function streamMeditationScript(
  params: {
    meditationStyle: string | null;
    transcript: string;
  },
  onDelta: (chunk: string) => void,
): Promise<string> {
  return streamChatRequest(
    {
      mode: "generate_script",
      meditationStyle: params.meditationStyle ?? "",
      transcript: params.transcript,
    },
    onDelta,
    "Empty script from model",
  );
}

export type GenerateMeditationAudioResponse = {
  audioUrl: string;
  scriptTextUsed: string;
  audioKey: string;
};

export type MeditationAudioJobStatus = {
  jobId: string;
  status: "pending" | "running" | "completed" | "failed" | string;
  audioUrl?: string;
  scriptTextUsed?: string;
  audioKey?: string;
  title?: string;
  description?: string;
  error?: string;
};

export type BackgroundAudioItem = {
  key: string;
  name: string;
  size: number | null;
};

export type BackgroundAudioByCategory = {
  baseUrl?: string;
  nature: BackgroundAudioItem[];
  music: BackgroundAudioItem[];
  drums: BackgroundAudioItem[];
};

export type FishSpeaker = {
  name: string;
  modelId: string;
};

/** Pedalboard preset for light delay + reverb (sound mixer / speaker previews). */
export const VOICE_FX_PRESET_MEDITATION_MIXER = "mixer";

export type VoiceFxApiResponse = {
  format: string;
  sampleRate: number;
  channels: number;
  audioBase64: string;
  preset?: string;
  inputFormat?: string;
};

/**
 * POST /audio/voice-fx — MP3/WAV in (base64), WAV out. Used for custom flows; speaker previews use pre-built `-fx.wav` on the CDN when available.
 */
export async function applyVoiceFx(params: {
  audioBase64: string;
  preset?: string;
  inputFormat?: "mp3" | "wav" | "auto";
}): Promise<VoiceFxApiResponse> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/audio/voice-fx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64: params.audioBase64,
      preset: params.preset ?? VOICE_FX_PRESET_MEDITATION_MIXER,
      inputFormat: params.inputFormat ?? "auto",
    }),
  });
  const data = (await res.json()) as VoiceFxApiResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? res.statusText);
  }
  return data;
}

export async function listFishSpeakers(): Promise<FishSpeaker[]> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/fish/speakers`);
  const data = (await res.json()) as {
    speakers?: FishSpeaker[];
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    const msg = data.detail ?? data.error ?? res.statusText;
    throw new Error(msg);
  }
  return data.speakers ?? [];
}

/** Calls backend Lambda to generate script (if needed), synthesize with Fish, store in S3, and return CloudFront URL. */
export async function generateMeditationAudio(params: {
  meditationStyle: string | null;
  transcript: string;
  scriptText?: string | null;
  reference_id: string;
  speed?: number;
  /** If set, applies voice FX (Pedalboard) after loudness normalization. */
  voiceFxPreset?: string | null;
  /** @deprecated use layered background keys + gains */
  backgroundSoundKey?: string | null;
  backgroundNatureKey?: string | null;
  backgroundMusicKey?: string | null;
  backgroundDrumsKey?: string | null;
  backgroundNatureGain?: number;
  backgroundMusicGain?: number;
  backgroundDrumsGain?: number;
}): Promise<GenerateMeditationAudioResponse> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");

  const speed =
    typeof params.speed === "number" && Number.isFinite(params.speed)
      ? params.speed
      : undefined;
  const backgroundSoundKey =
    typeof params.backgroundSoundKey === "string" &&
    params.backgroundSoundKey.trim().length > 0
      ? params.backgroundSoundKey.trim()
      : undefined;

  const trimBg = (v: string | null | undefined) =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;

  const backgroundNatureKey = trimBg(params.backgroundNatureKey ?? null);
  const backgroundMusicKey = trimBg(params.backgroundMusicKey ?? null);
  const backgroundDrumsKey = trimBg(params.backgroundDrumsKey ?? null);

  const jobBody: Record<string, unknown> = {
    meditationStyle: params.meditationStyle ?? "",
    transcript: params.transcript,
    scriptText: params.scriptText ?? "",
    reference_id: params.reference_id,
    ...(params.voiceFxPreset ? { voiceFxPreset: params.voiceFxPreset } : {}),
    ...(speed === undefined ? {} : { speed }),
    ...(backgroundSoundKey === undefined ? {} : { backgroundSoundKey }),
    ...(backgroundNatureKey ? { backgroundNatureKey } : {}),
    ...(backgroundMusicKey ? { backgroundMusicKey } : {}),
    ...(backgroundDrumsKey ? { backgroundDrumsKey } : {}),
  };

  if (typeof params.backgroundNatureGain === "number") {
    jobBody.backgroundNatureGain = params.backgroundNatureGain;
  }
  if (typeof params.backgroundMusicGain === "number") {
    jobBody.backgroundMusicGain = params.backgroundMusicGain;
  }
  if (typeof params.backgroundDrumsGain === "number") {
    jobBody.backgroundDrumsGain = params.backgroundDrumsGain;
  }

  const createRes = await fetch(`${base}/meditation/audio/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jobBody),
  });

  const createData = (await createRes.json()) as {
    jobId?: string;
    error?: string;
    detail?: string;
  };

  if (!createRes.ok || !createData.jobId) {
    const msg =
      createData.detail ??
      createData.error ??
      createRes.statusText ??
      "Audio job creation failed";
    throw new Error(msg);
  }

  const jobId = createData.jobId;

  // Poll job status until completion or failure.
  const start = Date.now();
  const timeoutMs = 10 * 60 * 1000; // 10 minutes
  let delayMs = 1500;

  while (true) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Audio generation timed out");
    }

    const statusRes = await fetch(`${base}/meditation/audio/jobs/${jobId}`);
    const statusData = (await statusRes.json()) as {
      status?: string;
      audioUrl?: string;
      scriptTextUsed?: string;
      audioKey?: string;
      error?: string;
    };

    if (!statusRes.ok) {
      const msg =
        statusData.error ?? statusRes.statusText ?? "Audio job status failed";
      throw new Error(msg);
    }

    if (statusData.status === "completed") {
      if (!statusData.audioUrl || !statusData.scriptTextUsed || !statusData.audioKey) {
        throw new Error("Audio job completed with incomplete data");
      }
      return {
        audioUrl: statusData.audioUrl,
        scriptTextUsed: statusData.scriptTextUsed,
        audioKey: statusData.audioKey,
      };
    }

    if (statusData.status === "failed") {
      throw new Error(statusData.error ?? "Audio generation failed");
    }

    await new Promise((r) => setTimeout(r, delayMs));
    delayMs = Math.min(5000, delayMs + 500);
  }
}

/** Creates an async meditation audio job and returns the job id (does not poll). */
export async function createMeditationAudioJob(params: {
  meditationStyle: string | null;
  transcript: string;
  scriptText?: string | null;
  reference_id: string;
  speed?: number;
  /** If set, applies voice FX (Pedalboard) after loudness normalization. */
  voiceFxPreset?: string | null;
  /** @deprecated use layered background keys + gains */
  backgroundSoundKey?: string | null;
  backgroundNatureKey?: string | null;
  backgroundMusicKey?: string | null;
  backgroundDrumsKey?: string | null;
  backgroundNatureGain?: number;
  backgroundMusicGain?: number;
  backgroundDrumsGain?: number;
}): Promise<{ jobId: string }> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");

  const speed =
    typeof params.speed === "number" && Number.isFinite(params.speed)
      ? params.speed
      : undefined;
  const backgroundSoundKey =
    typeof params.backgroundSoundKey === "string" &&
    params.backgroundSoundKey.trim().length > 0
      ? params.backgroundSoundKey.trim()
      : undefined;

  const trimBg = (v: string | null | undefined) =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;

  const backgroundNatureKey = trimBg(params.backgroundNatureKey ?? null);
  const backgroundMusicKey = trimBg(params.backgroundMusicKey ?? null);
  const backgroundDrumsKey = trimBg(params.backgroundDrumsKey ?? null);

  const jobBody: Record<string, unknown> = {
    meditationStyle: params.meditationStyle ?? "",
    transcript: params.transcript,
    scriptText: params.scriptText ?? "",
    reference_id: params.reference_id,
    ...(params.voiceFxPreset ? { voiceFxPreset: params.voiceFxPreset } : {}),
    ...(speed === undefined ? {} : { speed }),
    ...(backgroundSoundKey === undefined ? {} : { backgroundSoundKey }),
    ...(backgroundNatureKey ? { backgroundNatureKey } : {}),
    ...(backgroundMusicKey ? { backgroundMusicKey } : {}),
    ...(backgroundDrumsKey ? { backgroundDrumsKey } : {}),
  };

  if (typeof params.backgroundNatureGain === "number") {
    jobBody.backgroundNatureGain = params.backgroundNatureGain;
  }
  if (typeof params.backgroundMusicGain === "number") {
    jobBody.backgroundMusicGain = params.backgroundMusicGain;
  }
  if (typeof params.backgroundDrumsGain === "number") {
    jobBody.backgroundDrumsGain = params.backgroundDrumsGain;
  }

  const createRes = await fetch(`${base}/meditation/audio/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jobBody),
  });

  const createData = (await createRes.json()) as {
    jobId?: string;
    error?: string;
    detail?: string;
  };

  if (!createRes.ok || !createData.jobId) {
    const msg =
      createData.detail ??
      createData.error ??
      createRes.statusText ??
      "Audio job creation failed";
    throw new Error(msg);
  }

  return { jobId: createData.jobId };
}

export async function getMeditationAudioJobStatus(
  jobId: string,
): Promise<MeditationAudioJobStatus> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const id = jobId.trim();
  if (!id) throw new Error("jobId is required");

  const res = await fetch(`${base}/meditation/audio/jobs/${encodeURIComponent(id)}`);
  const data = (await res.json()) as MeditationAudioJobStatus;
  if (!res.ok) {
    throw new Error(data.error ?? res.statusText ?? "Audio job status failed");
  }
  return { ...data, jobId: data.jobId ?? id };
}

export async function listBackgroundAudio(): Promise<BackgroundAudioByCategory> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/media/background-audio`);
  const data = (await res.json()) as {
    baseUrl?: string;
    nature?: BackgroundAudioItem[];
    music?: BackgroundAudioItem[];
    drums?: BackgroundAudioItem[];
    items?: BackgroundAudioItem[];
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    const msg = data.detail ?? data.error ?? res.statusText;
    throw new Error(msg);
  }
  return {
    baseUrl: data.baseUrl,
    nature: data.nature ?? [],
    music: data.music ?? [],
    drums: data.drums ?? [],
  };
}

export type LibraryMeditationItem = {
  id: string | null;
  sk: string | null;
  s3Key: string;
  audioUrl: string;
  title: string;
  meditationType: string | null;
  meditationStyle: string | null;
  speakerModelId: string | null;
  speakerName: string | null;
  description: string | null;
  createdAt: string | null;
  durationSeconds: number | null;
  scriptText: string | null;
  scriptTruncated: boolean;
  rating: number | null;
  favourite: boolean;
  archived: boolean;
  catalogued: boolean;
  mp3Bytes: number | null;
  /** Saved create-flow draft (not shown in main library list). */
  isDraft: boolean;
};

export const MEDITATION_DRAFT_STATE_VERSION = 1 as const;

export type MeditationDraftStateV1 = {
  v: typeof MEDITATION_DRAFT_STATE_VERSION;
  phase: "style" | "feeling" | "claude";
  meditationStyle: string | null;
  messages: Array<{
    role: "assistant" | "user";
    text: string;
    variant?: "chat" | "script";
  }>;
  claudeThread: MedimadeChatTurn[];
  input: string;
  speechSpeed: number;
  speakerModelId: string;
  backgroundNatureKey: string;
  backgroundMusicKey: string;
  backgroundDrumsKey: string;
  backgroundNatureGain: number;
  backgroundMusicGain: number;
  backgroundDrumsGain: number;
  mobileCreateStep: "chat" | "audio";
  lastUsedScript: string | null;
};

export async function saveMeditationDraft(params: {
  sk?: string | null;
  title?: string;
  meditationStyle: string | null;
  draftState: MeditationDraftStateV1;
}): Promise<{ sk: string; id: string; createdAt: string; title: string }> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/library/meditations/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sk: params.sk?.trim() || undefined,
      title: params.title,
      meditationStyle: params.meditationStyle,
      draftState: params.draftState,
    }),
  });
  const data = (await res.json()) as {
    sk?: string;
    id?: string;
    createdAt?: string;
    title?: string;
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    const msg = data.detail ?? data.error ?? res.statusText;
    throw new Error(msg);
  }
  if (!data.sk || !data.id || !data.createdAt || !data.title) {
    throw new Error("Save draft returned incomplete data");
  }
  return {
    sk: data.sk,
    id: data.id,
    createdAt: data.createdAt,
    title: data.title,
  };
}

export async function getMeditationDraft(sk: string): Promise<{
  sk: string;
  id: string;
  createdAt: string | null;
  title: string | null;
  meditationStyle: string | null;
  draftState: unknown;
}> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const q = new URLSearchParams({ sk });
  const res = await fetch(`${base}/library/meditations/draft?${q.toString()}`);
  const data = (await res.json()) as {
    sk?: string;
    id?: string;
    createdAt?: string | null;
    title?: string | null;
    meditationStyle?: string | null;
    draftState?: unknown;
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    const msg = data.detail ?? data.error ?? res.statusText;
    throw new Error(msg);
  }
  if (!data.sk || !data.id) {
    throw new Error("Load draft returned incomplete data");
  }
  return {
    sk: data.sk,
    id: data.id,
    createdAt: data.createdAt ?? null,
    title: data.title ?? null,
    meditationStyle: data.meditationStyle ?? null,
    draftState: data.draftState,
  };
}

/** Lists `meditations/*.mp3` in the media bucket merged with DynamoDB library metadata. */
export async function listLibraryMeditations(): Promise<LibraryMeditationItem[]> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/library/meditations`);
  const data = (await res.json()) as {
    items?: LibraryMeditationItem[];
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    const msg = data.detail ?? data.error ?? res.statusText;
    throw new Error(msg);
  }
  return data.items ?? [];
}

export async function patchMeditationRating(
  sk: string,
  rating: number | null,
): Promise<void> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/library/meditations/rating`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sk, rating }),
  });
  const data = (await res.json()) as { error?: string; detail?: string };
  if (!res.ok) {
    const msg = data.detail ?? data.error ?? res.statusText;
    throw new Error(msg);
  }
}

export async function patchMeditationFavourite(
  sk: string,
  favourite: boolean,
): Promise<void> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/library/meditations/favourite`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sk, favourite }),
  });
  const data = (await res.json()) as { error?: string; detail?: string };
  if (!res.ok) {
    const msg = data.detail ?? data.error ?? res.statusText;
    throw new Error(msg);
  }
}

export async function patchMeditationArchived(
  sk: string,
  archived: boolean,
): Promise<void> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/library/meditations/archive`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sk, archived }),
  });
  const data = (await res.json()) as { error?: string; detail?: string };
  if (!res.ok) {
    const msg = data.detail ?? data.error ?? res.statusText;
    throw new Error(msg);
  }
}
