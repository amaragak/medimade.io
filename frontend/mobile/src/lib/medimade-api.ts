import Constants from "expo-constants";

export type MedimadeChatTurn = { role: "user" | "assistant"; content: string };

type MedimadeExtra = {
  medimadeApiUrl?: string;
  medimadeChatUrl?: string;
  medimadeMediaBaseUrl?: string;
};

function medimadeExtra(): MedimadeExtra {
  return (Constants.expoConfig?.extra ?? {}) as MedimadeExtra;
}

function firstNonEmpty(
  ...vals: (string | null | undefined)[]
): string | null {
  for (const v of vals) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t) return t;
  }
  return null;
}

const URL_SETUP_HINT =
  "Add them to frontend/mobile/.env (copy from .env.example; same values as webapp but EXPO_PUBLIC_* names). Restart Expo after editing .env.";

export function getMedimadeApiBase(): string | null {
  const u = firstNonEmpty(
    process.env.EXPO_PUBLIC_MEDIMADE_API_URL,
    medimadeExtra().medimadeApiUrl,
  );
  if (!u) return null;
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

export function getMedimadeChatUrl(): string | null {
  return firstNonEmpty(
    process.env.EXPO_PUBLIC_MEDIMADE_CHAT_URL,
    medimadeExtra().medimadeChatUrl,
  );
}

export function getMedimadeMediaBaseUrl(): string | null {
  const u = firstNonEmpty(
    process.env.EXPO_PUBLIC_MEDIMADE_MEDIA_BASE_URL,
    medimadeExtra().medimadeMediaBaseUrl,
  );
  if (!u) return null;
  return u.replace(/\/$/, "");
}

export function requireMedimadeApiBase(): string {
  const base = getMedimadeApiBase();
  if (!base) {
    throw new Error(
      `EXPO_PUBLIC_MEDIMADE_API_URL is not set. ${URL_SETUP_HINT}`,
    );
  }
  return base;
}

export type JournalTranscribeResult = {
  text: string;
  storage?: { audioKey: string; metaKey: string };
};

/** `POST /journal/transcribe` — OpenAI Whisper (secret `medimade/OPENAI_API_KEY`). */
export async function transcribeJournalAudio(params: {
  audioBase64: string;
  mimeType?: string;
}): Promise<JournalTranscribeResult> {
  const base = requireMedimadeApiBase();
  const res = await fetch(`${base}/journal/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64: params.audioBase64,
      mimeType: params.mimeType,
    }),
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const msg =
      (typeof data.detail === "string" && data.detail) ||
      (typeof data.error === "string" && data.error) ||
      res.statusText;
    throw new Error(msg);
  }
  const text = typeof data.text === "string" ? data.text : "";
  const storage = data.storage as JournalTranscribeResult["storage"] | undefined;
  return { text, storage };
}

/** Prefer CDN MP3 for previews and mixer jobs (`background-audio/…` beds). */
export function backgroundAudioStreamingKey(key: string): string {
  const k = key.trim();
  if (!k) return k;
  const lower = k.toLowerCase();
  if (!lower.startsWith("background-audio/") || !lower.endsWith(".wav")) return k;
  return `${k.slice(0, -4)}.mp3`;
}

export type BackgroundAudioItem = {
  key: string;
  name: string;
  size: number | null;
  wavKey?: string;
};

export type BackgroundAudioByCategory = {
  baseUrl?: string;
  nature: BackgroundAudioItem[];
  music: BackgroundAudioItem[];
  drums: BackgroundAudioItem[];
  noise: BackgroundAudioItem[];
};

export type FishSpeaker = {
  name: string;
  modelId: string;
};

export const VOICE_FX_PRESET_MEDITATION_MIXER = "mixer";

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

export const MEDITATION_DRAFT_STATE_VERSION = 1 as const;

export type MeditationDraftMessage = {
  role: "assistant" | "user";
  text: string;
  variant?: "chat" | "script";
  muted?: boolean;
  kind?: "divider";
};

export type MeditationDraftStateV1 = {
  v: typeof MEDITATION_DRAFT_STATE_VERSION;
  phase: "style" | "feeling" | "claude";
  journalMode?: boolean;
  meditationStyle: string | null;
  messages: MeditationDraftMessage[];
  claudeThread: MedimadeChatTurn[];
  input: string;
  speechSpeed: number;
  speakerModelId: string;
  speakerFxPreviewOn?: boolean;
  backgroundNatureKey: string;
  backgroundMusicKey: string;
  backgroundNoiseKey: string;
  backgroundNatureGain: number;
  backgroundMusicGain: number;
  backgroundNoiseGain: number;
  mobileCreateStep: "chat" | "audio";
  lastUsedScript: string | null;
};

async function streamChatRequest(
  body: Record<string, unknown>,
  onDelta: (chunk: string) => void,
  emptyMessage: string,
): Promise<string> {
  const url = getMedimadeChatUrl();
  if (!url) {
    throw new Error(
      `EXPO_PUBLIC_MEDIMADE_CHAT_URL is not set. ${URL_SETUP_HINT}`,
    );
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

export type MeditationTargetMinutes = 2 | 5 | 10;

export async function streamMedimadeChat(
  params: {
    meditationStyle: string;
    messages: MedimadeChatTurn[];
    journalMode?: boolean;
    meditationTargetMinutes?: MeditationTargetMinutes;
  },
  onDelta: (chunk: string) => void,
): Promise<string> {
  return streamChatRequest(
    {
      mode: "chat",
      meditationStyle: params.meditationStyle,
      messages: params.messages,
      ...(params.journalMode === true ? { journalMode: true } : {}),
      ...(params.meditationTargetMinutes === 2 ||
      params.meditationTargetMinutes === 5 ||
      params.meditationTargetMinutes === 10
        ? { meditationTargetMinutes: params.meditationTargetMinutes }
        : {}),
    },
    onDelta,
    "Empty reply from guide",
  );
}

export async function streamMeditationScript(
  params: {
    meditationStyle: string | null;
    transcript: string;
    journalMode?: boolean;
    meditationTargetMinutes?: MeditationTargetMinutes;
    speechSpeed?: number;
  },
  onDelta: (chunk: string) => void,
): Promise<string> {
  return streamChatRequest(
    {
      mode: "generate_script",
      meditationStyle: params.meditationStyle ?? "",
      transcript: params.transcript,
      ...(params.journalMode === true ? { journalMode: true } : {}),
      ...(params.meditationTargetMinutes === 2 ||
      params.meditationTargetMinutes === 5 ||
      params.meditationTargetMinutes === 10
        ? { meditationTargetMinutes: params.meditationTargetMinutes }
        : {}),
      ...(typeof params.speechSpeed === "number" &&
      Number.isFinite(params.speechSpeed)
        ? { speechSpeed: params.speechSpeed }
        : {}),
    },
    onDelta,
    "Empty script from model",
  );
}

export async function listFishSpeakers(): Promise<FishSpeaker[]> {
  const base = requireMedimadeApiBase();
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

export async function listBackgroundAudio(): Promise<BackgroundAudioByCategory> {
  const base = requireMedimadeApiBase();
  const res = await fetch(`${base}/media/background-audio`);
  const data = (await res.json()) as {
    baseUrl?: string;
    nature?: BackgroundAudioItem[];
    music?: BackgroundAudioItem[];
    drums?: BackgroundAudioItem[];
    noise?: BackgroundAudioItem[];
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
    noise: data.noise ?? [],
  };
}

export async function createMeditationAudioJob(params: {
  meditationStyle: string | null;
  journalMode?: boolean;
  meditationTargetMinutes?: MeditationTargetMinutes;
  transcript: string;
  scriptText?: string | null;
  reference_id: string;
  speed?: number;
  voiceFxPreset?: string | null;
  backgroundSoundKey?: string | null;
  backgroundNatureKey?: string | null;
  backgroundMusicKey?: string | null;
  backgroundDrumsKey?: string | null;
  backgroundNoiseKey?: string | null;
  backgroundNatureGain?: number;
  backgroundMusicGain?: number;
  backgroundDrumsGain?: number;
  backgroundNoiseGain?: number;
}): Promise<{ jobId: string }> {
  const base = requireMedimadeApiBase();

  const speed =
    typeof params.speed === "number" && Number.isFinite(params.speed)
      ? params.speed
      : undefined;
  const trimBg = (v: string | null | undefined) =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;

  const backgroundNatureKey = trimBg(params.backgroundNatureKey ?? null);
  const backgroundMusicKey = trimBg(params.backgroundMusicKey ?? null);
  const backgroundDrumsKey = trimBg(params.backgroundDrumsKey ?? null);
  const backgroundNoiseKey = trimBg(params.backgroundNoiseKey ?? null);
  const backgroundSoundKey = trimBg(params.backgroundSoundKey ?? null);

  const meditationTargetMinutes: MeditationTargetMinutes =
    params.meditationTargetMinutes === 2 ||
    params.meditationTargetMinutes === 5 ||
    params.meditationTargetMinutes === 10
      ? params.meditationTargetMinutes
      : 5;

  const jobBody: Record<string, unknown> = {
    meditationStyle: params.meditationStyle ?? "",
    transcript: params.transcript,
    scriptText: params.scriptText ?? "",
    reference_id: params.reference_id,
    meditationTargetMinutes,
    ...(params.journalMode === true ? { journalMode: true } : {}),
    ...(params.voiceFxPreset ? { voiceFxPreset: params.voiceFxPreset } : {}),
    ...(speed === undefined ? {} : { speed }),
    ...(backgroundSoundKey ? { backgroundSoundKey } : {}),
    ...(backgroundNatureKey ? { backgroundNatureKey } : {}),
    ...(backgroundMusicKey ? { backgroundMusicKey } : {}),
    ...(backgroundDrumsKey ? { backgroundDrumsKey } : {}),
    ...(backgroundNoiseKey ? { backgroundNoiseKey } : {}),
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
  if (typeof params.backgroundNoiseGain === "number") {
    jobBody.backgroundNoiseGain = params.backgroundNoiseGain;
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
  const base = requireMedimadeApiBase();
  const id = jobId.trim();
  if (!id) throw new Error("jobId is required");

  const res = await fetch(`${base}/meditation/audio/jobs/${encodeURIComponent(id)}`);
  const data = (await res.json()) as MeditationAudioJobStatus;
  if (!res.ok) {
    throw new Error(data.error ?? res.statusText ?? "Audio job status failed");
  }
  return { ...data, jobId: data.jobId ?? id };
}

export async function saveMeditationDraft(params: {
  sk?: string | null;
  title?: string;
  meditationStyle: string | null;
  draftState: MeditationDraftStateV1;
}): Promise<{ sk: string; id: string; createdAt: string; title: string }> {
  const base = requireMedimadeApiBase();
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
  const base = requireMedimadeApiBase();
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
  archived?: boolean;
  catalogued: boolean;
  mp3Bytes: number | null;
  isDraft?: boolean;
};

export function libraryMeditationCategoryLabel(m: {
  meditationType: string | null;
  meditationStyle: string | null;
}): string {
  const type = m.meditationType?.trim() ?? "";
  const rawStyle = m.meditationStyle?.trim() ?? "";
  const styleOk =
    rawStyle && rawStyle.toLowerCase() !== "general" ? rawStyle : "";
  if (type && styleOk) return `${type} · ${styleOk}`;
  if (type) return type;
  if (styleOk) return styleOk;
  return "—";
}

export async function listLibraryMeditations(): Promise<LibraryMeditationItem[]> {
  const base = requireMedimadeApiBase();
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
  const base = requireMedimadeApiBase();
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
  const base = requireMedimadeApiBase();
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
  const base = requireMedimadeApiBase();
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
