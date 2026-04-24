import type { JournalStoreV2 } from "./journal-storage";
import { getMedimadeSessionJwt, setMedimadeSession } from "./auth-session";

export {
  clearMedimadeSession,
  getMedimadeSessionDisplayName,
  getMedimadeSessionEmail,
  getMedimadeSessionJwt,
  setMedimadeSession,
} from "./auth-session";

/** `Authorization: Bearer …` when a session JWT is stored (e.g. after magic-link verify). */
export function medimadeApiAuthHeaders(): Record<string, string> {
  const t = getMedimadeSessionJwt();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function medimadeJsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", ...medimadeApiAuthHeaders() };
}

export type MedimadeChatTurn = { role: "user" | "assistant"; content: string };

export function getMedimadeApiBase(): string | null {
  const u = process.env.NEXT_PUBLIC_MEDIMADE_API_URL;
  if (!u || typeof u !== "string") return null;
  const t = u.trim();
  if (!t) return null;
  return t.endsWith("/") ? t.slice(0, -1) : t;
}

/** Sends a one-time sign-in link to the given email (no auth required). */
export async function requestMedimadeMagicLink(email: string): Promise<void> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) throw new Error("Email is required");
  const res = await fetch(`${base}/auth/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: trimmed }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(data.detail ?? data.error ?? res.statusText);
  }
}

export type MedimadeMagicLinkVerifyResult = {
  token: string;
  userId: string;
  email: string;
  needsProfileName: boolean;
  displayName: string | null;
};

/** One in-flight (or settled) verify per magic token so React Strict Mode does not burn the token twice. */
const magicVerifyByToken = new Map<string, Promise<MedimadeMagicLinkVerifyResult>>();

/**
 * Exchanges a magic-link token for a session JWT. Does not write localStorage;
 * callers should call `setMedimadeSession` after any required name step.
 */
export async function verifyMedimadeMagicLink(
  token: string,
): Promise<MedimadeMagicLinkVerifyResult> {
  const t = token.trim();
  if (!t) throw new Error("Token is required");
  const existing = magicVerifyByToken.get(t);
  if (existing) return existing;

  const p = verifyMedimadeMagicLinkUncached(t);
  magicVerifyByToken.set(t, p);
  void p.catch(() => {
    magicVerifyByToken.delete(t);
  });
  return p;
}

async function verifyMedimadeMagicLinkUncached(
  t: string,
): Promise<MedimadeMagicLinkVerifyResult> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/auth/magic-link/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: t }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    userId?: string;
    email?: string;
    needsProfileName?: unknown;
    displayName?: unknown;
    error?: string;
    detail?: string;
  };
  if (!res.ok || typeof data.token !== "string" || !data.token.trim()) {
    throw new Error(data.detail ?? data.error ?? res.statusText ?? "Verification failed");
  }
  const displayName =
    typeof data.displayName === "string" && data.displayName.trim()
      ? data.displayName.trim()
      : null;
  const needsProfileName =
    typeof data.needsProfileName === "boolean"
      ? data.needsProfileName
      : !displayName;
  return {
    token: data.token.trim(),
    userId: typeof data.userId === "string" ? data.userId : "",
    email: typeof data.email === "string" ? data.email : "",
    needsProfileName,
    displayName,
  };
}

/** Saves display name for the signed-in user and returns a fresh session JWT. */
export async function saveMedimadeProfileDisplayName(
  displayName: string,
): Promise<{ token: string; displayName: string }> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/auth/profile/display-name`, {
    method: "POST",
    headers: medimadeJsonHeaders(),
    body: JSON.stringify({ displayName: displayName.trim() }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    displayName?: string;
    error?: string;
    detail?: string;
  };
  if (
    !res.ok ||
    typeof data.token !== "string" ||
    !data.token.trim() ||
    typeof data.displayName !== "string" ||
    !data.displayName.trim()
  ) {
    throw new Error(data.detail ?? data.error ?? res.statusText ?? "Could not save name");
  }
  return { token: data.token.trim(), displayName: data.displayName.trim() };
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

export type JournalTranscribeResult = {
  text: string;
  storage?: { audioKey: string; metaKey: string };
};

export type JournalVoiceUploadResult = {
  key: string;
  url: string;
};

export type JournalInsightsTopicId =
  | "overview"
  | "emotions"
  | "stress"
  | "health"
  | "relationships"
  | "identity"
  | "worldview"
  | "work"
  | "projects"
  | "ideas"
  | "values"
  | "habits"
  | "decisions"
  | "growth";

export type JournalInsights = {
  ownerId: string;
  topics: Array<{
    topicId: JournalInsightsTopicId;
    summaryMarkdown: string;
    updatedAt: string;
  }>;
  meta: {
    lastRunAt: string;
    lastProcessedMaxUpdatedAt: string | null;
    model: string;
    usage?: { input_tokens: number; output_tokens: number } | null;
  };
};

/**
 * Sends recorded audio (base64) to `POST /journal/transcribe` (OpenAI Whisper).
 * Requires `NEXT_PUBLIC_MEDIMADE_API_URL` and AWS secret `medimade/OPENAI_API_KEY`.
 */
export async function transcribeJournalAudio(params: {
  audioBase64: string;
  mimeType?: string;
}): Promise<JournalTranscribeResult> {
  const base = getMedimadeApiBase();
  if (!base) {
    throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  }
  const res = await fetch(`${base}/journal/transcribe`, {
    method: "POST",
    headers: medimadeJsonHeaders(),
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

/**
 * Loads journal from `GET /journal/store` (DynamoDB-backed; same JSON shape as before).
 * Requires a session JWT (`Authorization`); returns null if nothing saved yet.
 */
export async function fetchJournalStoreRemote(): Promise<JournalStoreV2 | null> {
  const base = getMedimadeApiBase();
  if (!base) {
    throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  }
  const res = await fetch(`${base}/journal/store`, { headers: medimadeApiAuthHeaders() });
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
  const store = data.store;
  if (store == null) return null;
  if (typeof store !== "object") return null;
  return store as JournalStoreV2;
}

/**
 * Saves full journal store to `PUT /journal/store` (DynamoDB per entry; use `uploadJournalVoice` for large audio).
 */
export async function putJournalStoreRemote(store: JournalStoreV2): Promise<void> {
  const base = getMedimadeApiBase();
  if (!base) {
    throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  }
  const res = await fetch(`${base}/journal/store`, {
    method: "PUT",
    headers: medimadeJsonHeaders(),
    body: JSON.stringify({ store }),
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
}

/**
 * Uploads recorded audio to `POST /journal/voice` and returns a CloudFront URL for embedding in HTML.
 */
export async function uploadJournalVoice(params: {
  audioBase64: string;
  mimeType?: string;
}): Promise<JournalVoiceUploadResult> {
  const base = getMedimadeApiBase();
  if (!base) {
    throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  }
  const res = await fetch(`${base}/journal/voice`, {
    method: "POST",
    headers: medimadeJsonHeaders(),
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
  const key = typeof data.key === "string" ? data.key : "";
  const url = typeof data.url === "string" ? data.url : "";
  if (!key || !url) {
    throw new Error("Upload response missing key or url");
  }
  return { key, url };
}

/**
 * Loads saved rolling journal insights from `GET /journal/insights` (DynamoDB).
 */
export async function fetchJournalInsightsRemote(): Promise<JournalInsights | null> {
  const base = getMedimadeApiBase();
  if (!base) {
    throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  }
  const res = await fetch(`${base}/journal/insights`, {
    headers: medimadeApiAuthHeaders(),
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
  const insights = data.insights;
  if (!insights || typeof insights !== "object") return null;
  return insights as JournalInsights;
}

/**
 * Runs Claude to refresh rolling journal insights from entry deltas (`POST /journal/insights`).
 */
export async function runJournalInsightsRemote(opts?: {
  mode?: "update" | "regenerate";
}): Promise<JournalInsights> {
  const base = getMedimadeApiBase();
  if (!base) {
    throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  }
  const res = await fetch(`${base}/journal/insights`, {
    method: "POST",
    headers: medimadeJsonHeaders(),
    body: JSON.stringify({
      ...(opts?.mode ? { mode: opts.mode } : {}),
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
  const insights = data.insights;
  if (!insights || typeof insights !== "object") {
    throw new Error("Insights response missing insights object");
  }
  return insights as JournalInsights;
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
    /** When true, style is a journal placeholder — do not lock coach/script to a preset technique. */
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

/**
 * Streams a ~5-minute guided meditation script from Claude using full chat transcript + style hint.
 */
export async function streamMeditationScript(
  params: {
    meditationStyle: string | null;
    transcript: string;
    journalMode?: boolean;
    meditationTargetMinutes?: MeditationTargetMinutes;
    /** Fish playback speed (1 = default); should match create job `speed` for consistent word targets. */
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
  /** Normalized WAV sibling for pro-tier / high-quality download when present. */
  wavKey?: string;
};

/** Prefer CDN MP3 for previews and mixer jobs (`background-audio/…` beds). */
export function backgroundAudioStreamingKey(key: string): string {
  const k = key.trim();
  if (!k) return k;
  const lower = k.toLowerCase();
  if (!lower.startsWith("background-audio/") || !lower.endsWith(".wav")) return k;
  return `${k.slice(0, -4)}.mp3`;
}

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
  backgroundNoiseKey?: string | null;
  backgroundNatureGain?: number;
  backgroundMusicGain?: number;
  backgroundDrumsGain?: number;
  backgroundNoiseGain?: number;
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
  const backgroundNoiseKey = trimBg(params.backgroundNoiseKey ?? null);

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
    headers: medimadeJsonHeaders(),
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

    const statusRes = await fetch(`${base}/meditation/audio/jobs/${jobId}`, {
      headers: medimadeApiAuthHeaders(),
    });
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
  /** When true, library metadata must infer preset `meditationType` from chat + script (journal flow). */
  journalMode?: boolean;
  /** Guided length for worker script generation when `scriptText` is empty. */
  meditationTargetMinutes?: MeditationTargetMinutes;
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
  backgroundNoiseKey?: string | null;
  backgroundNatureGain?: number;
  backgroundMusicGain?: number;
  backgroundDrumsGain?: number;
  backgroundNoiseGain?: number;
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
  const backgroundNoiseKey = trimBg(params.backgroundNoiseKey ?? null);

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
    ...(backgroundSoundKey === undefined ? {} : { backgroundSoundKey }),
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
    headers: medimadeJsonHeaders(),
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

  const res = await fetch(`${base}/meditation/audio/jobs/${encodeURIComponent(id)}`, {
    headers: medimadeApiAuthHeaders(),
  });
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
    noise?: BackgroundAudioItem[];
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
    noise: data.noise ?? [],
  };
}

/**
 * Library badge line: preset `meditationType` first; omit placeholder style "General"
 * so journal-mode rows show the inferred category (e.g. Breath-led), not "General".
 */
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

/** Creator-selected guided length (coach + script targets). */
export type MeditationTargetMinutes = 2 | 5 | 10;

export type MeditationDraftStateV1 = {
  v: typeof MEDITATION_DRAFT_STATE_VERSION;
  phase: "style" | "feeling" | "claude";
  journalMode?: boolean;
  meditationStyle: string | null;
  messages: Array<{
    role: "assistant" | "user";
    text: string;
    variant?: "chat" | "script";
    /** Journal → Create: expandable entry cards in the user bubble */
    journalSegments?: Array<{
      entryId: string;
      title: string;
      bodyPlain: string;
      createdAt?: string;
    }>;
  }>;
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
  meditationTargetMinutes?: MeditationTargetMinutes;
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
    headers: medimadeJsonHeaders(),
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
  const res = await fetch(`${base}/library/meditations/draft?${q.toString()}`, {
    headers: medimadeApiAuthHeaders(),
  });
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
  const res = await fetch(`${base}/library/meditations`, { headers: medimadeApiAuthHeaders() });
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
    headers: medimadeJsonHeaders(),
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
    headers: medimadeJsonHeaders(),
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
    headers: medimadeJsonHeaders(),
    body: JSON.stringify({ sk, archived }),
  });
  const data = (await res.json()) as { error?: string; detail?: string };
  if (!res.ok) {
    const msg = data.detail ?? data.error ?? res.statusText;
    throw new Error(msg);
  }
}
