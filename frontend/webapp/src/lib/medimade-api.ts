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

function sessionTokenForBody(): string | undefined {
  return getMedimadeSessionJwt() ?? undefined;
}

function meditationAudioJobStatusUrl(base: string, jobId: string): string {
  const token = sessionTokenForBody();
  const qs = token ? `?sessionToken=${encodeURIComponent(token)}` : "";
  return `${base}/meditation/audio/jobs/${encodeURIComponent(jobId)}${qs}`;
}

function meditationAudioAuthFailureMessage(
  status: number,
  apiError?: string | null,
): string | null {
  if (status !== 401) return null;
  return apiError?.trim() || "Could not authorize this request. Try Generate again.";
}

function medimadeJsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", ...medimadeApiAuthHeaders() };
}

const MIX_LISTENER_STORAGE_KEY = "medimade.mix-listener-id";
const MIX_LISTENER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stable anonymous id so guest mix overrides persist in the listener mix table. */
export function getOrCreateMixListenerId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(MIX_LISTENER_STORAGE_KEY)?.trim() ?? "";
    if (MIX_LISTENER_ID_RE.test(existing)) return existing.toLowerCase();
    const id = crypto.randomUUID();
    window.localStorage.setItem(MIX_LISTENER_STORAGE_KEY, id);
    return id;
  } catch {
    return "";
  }
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
 * Without a session JWT, returns all journal entries from the table (dev mode).
 * With a session JWT, returns the signed-in user's journal.
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

export type JournalWeeklyReflection = {
  ownerId: string;
  weekKey: string;
  weekStart: string;
  weekEnd: string;
  letterMarkdown: string;
  meta: {
    generatedAt: string;
    model: string;
    journalEntryCount: number;
    meditationChatCount: number;
    usage?: { input_tokens: number; output_tokens: number } | null;
  };
};

export async function fetchJournalWeeklyReflectionRemote(): Promise<{
  reflection: JournalWeeklyReflection | null;
  weekKey: string;
  weekStart: string;
  weekEnd: string;
  empty?: boolean;
}> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/journal/weekly-reflection`, {
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
  const reflection =
    data.reflection && typeof data.reflection === "object"
      ? (data.reflection as JournalWeeklyReflection)
      : null;
  return {
    reflection,
    weekKey: typeof data.weekKey === "string" ? data.weekKey : "",
    weekStart: typeof data.weekStart === "string" ? data.weekStart : "",
    weekEnd: typeof data.weekEnd === "string" ? data.weekEnd : "",
    empty: data.empty === true,
  };
}

export async function runJournalWeeklyReflectionRemote(opts?: {
  regenerate?: boolean;
}): Promise<{
  reflection: JournalWeeklyReflection | null;
  weekKey: string;
  weekStart: string;
  weekEnd: string;
  empty?: boolean;
}> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/journal/weekly-reflection`, {
    method: "POST",
    headers: medimadeJsonHeaders(),
    body: JSON.stringify({
      ...(opts?.regenerate ? { regenerate: true } : {}),
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
  const reflection =
    data.reflection && typeof data.reflection === "object"
      ? (data.reflection as JournalWeeklyReflection)
      : null;
  return {
    reflection,
    weekKey: typeof data.weekKey === "string" ? data.weekKey : "",
    weekStart: typeof data.weekStart === "string" ? data.weekStart : "",
    weekEnd: typeof data.weekEnd === "string" ? data.weekEnd : "",
    empty: data.empty === true,
  };
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
  subcategory?: string;
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

export type OrpheusSpeaker = {
  id: string;
  name: string;
  description?: string;
};

export type TtsProvider = "fish" | "orpheus";

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
  return (data.speakers ?? []).filter(
    (s) => s.modelId !== "8d797adca9af48ca9e8a1c7284db1d6c",
  );
}

export async function listOrpheusSpeakers(): Promise<OrpheusSpeaker[]> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/orpheus/speakers`);
  const data = (await res.json()) as {
    voices?: OrpheusSpeaker[];
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    const msg = data.detail ?? data.error ?? res.statusText;
    throw new Error(msg);
  }
  return data.voices ?? [];
}

const ORPHEUS_PREVIEW_LINE =
  "Take a slow breath in, and let it go.";

/** Live Orpheus preview via `POST /orpheus/tts` (WAV blob). */
export async function fetchOrpheusSpeechPreview(params: {
  voice: string;
  speed?: number;
  input?: string;
}): Promise<Blob> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/orpheus/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: params.input ?? ORPHEUS_PREVIEW_LINE,
      voice: params.voice,
      response_format: "wav",
      ...(typeof params.speed === "number" && Number.isFinite(params.speed)
        ? { speed: params.speed }
        : {}),
    }),
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = (await res.json()) as { error?: string; detail?: string };
      msg = data.detail ?? data.error ?? msg;
    } catch {
      /* binary or empty */
    }
    throw new Error(msg);
  }
  return res.blob();
}

/** Calls backend Lambda to generate script (if needed), synthesize with Fish, store in S3, and return CloudFront URL. */
export async function generateMeditationAudio(params: {
  meditationStyle: string | null;
  transcript: string;
  scriptText?: string | null;
  reference_id: string;
  ttsProvider?: TtsProvider;
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
    ...(params.ttsProvider ? { ttsProvider: params.ttsProvider } : {}),
    ...(params.voiceFxPreset ? { voiceFxPreset: params.voiceFxPreset } : {}),
    ...(speed === undefined ? {} : { speed }),
    ...(backgroundSoundKey === undefined ? {} : { backgroundSoundKey }),
    ...(backgroundNatureKey ? { backgroundNatureKey } : {}),
    ...(backgroundMusicKey ? { backgroundMusicKey } : {}),
    ...(backgroundDrumsKey ? { backgroundDrumsKey } : {}),
    ...(backgroundNoiseKey ? { backgroundNoiseKey } : {}),
    ...(sessionTokenForBody() ? { sessionToken: sessionTokenForBody() } : {}),
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
    const authMsg = meditationAudioAuthFailureMessage(
      createRes.status,
      createData.detail ?? createData.error,
    );
    throw new Error(
      authMsg ??
        (createData.detail ??
          createData.error ??
          createRes.statusText ??
          "Audio job creation failed"),
    );
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

    const statusRes = await fetch(meditationAudioJobStatusUrl(base, jobId), {
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
  ttsProvider?: TtsProvider;
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
    ...(params.ttsProvider ? { ttsProvider: params.ttsProvider } : {}),
    meditationTargetMinutes,
    ...(params.journalMode === true ? { journalMode: true } : {}),
    ...(params.voiceFxPreset ? { voiceFxPreset: params.voiceFxPreset } : {}),
    ...(sessionTokenForBody() ? { sessionToken: sessionTokenForBody() } : {}),
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

  let createData: { jobId?: string; error?: string; detail?: string } = {};
  try {
    createData = (await createRes.json()) as typeof createData;
  } catch {
    throw new Error(
      meditationAudioAuthFailureMessage(createRes.status, null) ??
        `Audio job creation failed (${createRes.status || "network error"})`,
    );
  }

  if (!createRes.ok || !createData.jobId) {
    const authMsg = meditationAudioAuthFailureMessage(
      createRes.status,
      createData.detail ?? createData.error,
    );
    throw new Error(
      authMsg ??
        (createData.detail ??
          createData.error ??
          createRes.statusText ??
          "Audio job creation failed"),
    );
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

  const res = await fetch(meditationAudioJobStatusUrl(base, id), {
    headers: medimadeApiAuthHeaders(),
  });
  const data = (await res.json()) as MeditationAudioJobStatus;
  if (!res.ok) {
    throw new Error(
      meditationAudioAuthFailureMessage(res.status, data.error) ??
        (data.error ?? res.statusText ?? "Audio job status failed"),
    );
  }
  return { ...data, jobId: data.jobId ?? id };
}

export type AdminSoundCategory = "music" | "ambience" | "drums" | "noise";

export type AdminSoundItem = {
  key: string;
  wavKey?: string;
  name: string;
  size: number | null;
  packPath?: string | null;
  folderCategory: AdminSoundCategory | null;
  category: AdminSoundCategory;
  subcategory: string;
  suggestedCategory: AdminSoundCategory | null;
  suggestedSubcategory: string | null;
  suggestedName: string | null;
  tags: string[];
  enabled: boolean;
  status: "in_use" | "pending" | "unused" | "categorised";
  notes: string;
  originalKey?: string;
  trimStartSec: number;
  trimEndSec: number | null;
  inCatalog: boolean;
  ready: boolean;
  hasRaw?: boolean;
  importedAt: string | null;
  updatedAt: string | null;
};

export type AdminSoundsList = {
  baseUrl?: string;
  categories: AdminSoundCategory[];
  counts: {
    total: number;
    inUse: number;
    pending: number;
    unused: number;
    categorised: number;
    inCatalog: number;
  };
  items: AdminSoundItem[];
};

export async function listAdminSounds(): Promise<AdminSoundsList> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/admin/sounds`, { headers: medimadeApiAuthHeaders() });
  const data = (await res.json()) as AdminSoundsList & { error?: string; detail?: string };
  if (!res.ok) {
    throw new Error(data.detail ?? data.error ?? res.statusText);
  }
  return {
    baseUrl: data.baseUrl,
    categories: data.categories ?? ["music", "ambience", "drums", "noise"],
    counts: {
      total: data.counts?.total ?? 0,
      inUse: data.counts?.inUse ?? 0,
      pending: data.counts?.pending ?? 0,
      unused: data.counts?.unused ?? 0,
      categorised: data.counts?.categorised ?? 0,
      inCatalog: data.counts?.inCatalog ?? 0,
    },
    items: (data.items ?? []).map((it) => {
      const rawCat = String(it.category ?? "");
      const rawFolder = it.folderCategory ? String(it.folderCategory) : null;
      const rawSuggested = it.suggestedCategory ? String(it.suggestedCategory) : null;
      return {
        ...it,
        category: (rawCat === "nature" ? "ambience" : it.category) as AdminSoundCategory,
        folderCategory: (rawFolder === "nature" ? "ambience" : it.folderCategory) as
          | AdminSoundCategory
          | null,
        suggestedCategory: (rawSuggested === "nature" ? "ambience" : it.suggestedCategory) as
          | AdminSoundCategory
          | null,
        status: it.status ?? (it.enabled ? "in_use" : "unused"),
        suggestedName: it.suggestedName ?? null,
        importedAt: it.importedAt ?? it.updatedAt ?? null,
      };
    }),
  };
}

export async function patchAdminSound(body: {
  key: string;
  enabled?: boolean;
  status?: "in_use" | "pending" | "unused" | "categorised";
  category?: AdminSoundCategory;
  subcategory?: string;
  tags?: string[];
  name?: string;
  notes?: string;
}): Promise<{ key: string }> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/admin/sounds`, {
    method: "PATCH",
    headers: medimadeJsonHeaders(),
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { key?: string; error?: string; detail?: string };
  if (!res.ok) {
    throw new Error(data.detail ?? data.error ?? res.statusText);
  }
  return { key: data.key ?? body.key };
}

export async function createAdminSoundUploads(params: {
  files: Array<{ relativePath: string; contentType: string; size: number }>;
  signal?: AbortSignal;
}): Promise<{
  uploads: AdminSoundUpload[];
  skippedCount: number;
  skipped: string[];
}> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/admin/sounds`, {
    method: "POST",
    headers: medimadeJsonHeaders(),
    body: JSON.stringify({ files: params.files }),
    signal: params.signal,
  });
  const data = (await res.json()) as {
    uploads?: AdminSoundUpload[];
    skippedCount?: number;
    skipped?: string[];
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(data.detail ?? data.error ?? res.statusText);
  }
  return {
    uploads: data.uploads ?? [],
    skippedCount: data.skippedCount ?? data.skipped?.length ?? 0,
    skipped: data.skipped ?? [],
  };
}

export type AdminSoundUpload = {
  filename: string;
  relativePath: string;
  url?: string;
  multipart?: { uploadId: string; partSize: number; urls: string[] };
  rawKey: string;
  key: string;
  wavKey: string;
  contentType: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function putS3WithRetry(url: string, body: Blob, signal?: AbortSignal): Promise<Response> {
  let lastStatus = 0;
  let lastDetail = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const res = await fetch(url, { method: "PUT", body, cache: "no-store", signal });
      if (res.ok) return res;
      lastStatus = res.status;
      lastDetail = await res.text().catch(() => "");
      const retryable = res.status === 403 || res.status === 408 || res.status === 429 || res.status >= 500;
      if (!retryable) break;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      lastStatus = 0;
      lastDetail = e instanceof Error ? e.message : "network error";
    }
    await sleep(500 * 2 ** attempt);
  }
  throw new Error(
    lastStatus
      ? `${lastStatus}${lastDetail ? `: ${lastDetail.slice(0, 120)}` : ""}`
      : lastDetail || "upload failed",
  );
}

async function completeAdminSoundMultipart(body: {
  rawKey: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}): Promise<void> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/admin/sounds`, {
    method: "POST",
    headers: medimadeJsonHeaders(),
    body: JSON.stringify({ completeMultipart: body }),
  });
  const data = (await res.json()) as { error?: string; detail?: string };
  if (!res.ok) throw new Error(data.detail ?? data.error ?? res.statusText);
}

async function abortAdminSoundMultipart(rawKey: string, uploadId: string): Promise<void> {
  const base = getMedimadeApiBase();
  if (!base) return;
  await fetch(`${base}/admin/sounds`, {
    method: "POST",
    headers: medimadeJsonHeaders(),
    body: JSON.stringify({ abortMultipart: { rawKey, uploadId } }),
  }).catch(() => undefined);
}

export async function analyseAdminSoundTitles(keys: string[]): Promise<number> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  let updated = 0;
  for (let i = 0; i < keys.length; i += 40) {
    const slice = keys.slice(i, i + 40);
    const res = await fetch(`${base}/admin/sounds`, {
      method: "POST",
      headers: medimadeJsonHeaders(),
      body: JSON.stringify({ analyseTitles: { keys: slice } }),
    });
    const data = (await res.json()) as { updated?: number; error?: string; detail?: string };
    if (!res.ok) throw new Error(data.detail ?? data.error ?? res.statusText);
    updated += data.updated ?? 0;
  }
  return updated;
}

export async function suggestAdminSoundCategories(paths: string[]): Promise<number> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  let updated = 0;
  for (let i = 0; i < paths.length; i += 40) {
    const slice = paths.slice(i, i + 40);
    const res = await fetch(`${base}/admin/sounds`, {
      method: "POST",
      headers: medimadeJsonHeaders(),
      body: JSON.stringify({ suggest: { paths: slice } }),
    });
    const data = (await res.json()) as { updated?: number; error?: string; detail?: string };
    if (!res.ok) throw new Error(data.detail ?? data.error ?? res.statusText);
    updated += data.updated ?? 0;
  }
  return updated;
}

export async function uploadAdminSoundToS3(
  u: AdminSoundUpload,
  file: File,
  signal?: AbortSignal,
): Promise<void> {
  if (u.multipart?.urls?.length) {
    const etags: Array<{ partNumber: number; etag: string }> = [];
    try {
      const partSize = u.multipart.partSize;
      for (let i = 0; i < u.multipart.urls.length; i++) {
        const url = u.multipart.urls[i];
        if (!url) throw new Error("missing part URL");
        const blob = file.slice(i * partSize, Math.min((i + 1) * partSize, file.size));
        const res = await putS3WithRetry(url, blob, signal);
        const etag = res.headers.get("ETag") || res.headers.get("etag");
        if (!etag) throw new Error("S3 part missing ETag");
        etags.push({ partNumber: i + 1, etag });
      }
      await completeAdminSoundMultipart({
        rawKey: u.rawKey,
        uploadId: u.multipart.uploadId,
        parts: etags,
      });
    } catch (e) {
      await abortAdminSoundMultipart(u.rawKey, u.multipart.uploadId);
      throw e;
    }
    return;
  }
  if (!u.url) throw new Error("missing upload url");
  await putS3WithRetry(u.url, file, signal);
}

export async function trimAdminSound(body: {
  key: string;
  startSec: number;
  endSec: number | null;
}): Promise<void> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/admin/sounds/trim`, {
    method: "POST",
    headers: medimadeJsonHeaders(),
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { error?: string; detail?: string };
  if (!res.ok) {
    throw new Error(data.detail ?? data.error ?? res.statusText);
  }
}

export type AdminVoiceSpeaker = {
  name: string;
  modelId: string;
  hidden: boolean;
  sort: number;
  hasSample?: boolean;
  sampleUrl?: string | null;
};

export type AdminPauseBands = {
  "extra-short": number;
  short: number;
  medium: number;
  long: number;
  "extra-long": number;
};

export type AdminVoiceState = {
  baseUrl?: string;
  speakers: AdminVoiceSpeaker[];
  pauses: AdminPauseBands;
};

export async function listAdminVoice(): Promise<AdminVoiceState> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/admin/voice`, { headers: medimadeApiAuthHeaders() });
  const data = (await res.json()) as AdminVoiceState & { error?: string; detail?: string };
  if (!res.ok) {
    throw new Error(data.detail ?? data.error ?? res.statusText);
  }
  return {
    baseUrl: data.baseUrl,
    speakers: data.speakers ?? [],
    pauses: data.pauses,
  };
}

export async function patchAdminVoice(body: {
  pauses?: Partial<AdminPauseBands>;
  speaker?: { name: string; modelId: string; hidden?: boolean; sort?: number };
}): Promise<{ pauses?: AdminPauseBands; speaker?: AdminVoiceSpeaker }> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/admin/voice`, {
    method: "PATCH",
    headers: medimadeJsonHeaders(),
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    pauses?: AdminPauseBands;
    speaker?: AdminVoiceSpeaker;
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(data.detail ?? data.error ?? res.statusText);
  }
  return data;
}

export async function deleteAdminVoiceSpeaker(modelId: string): Promise<void> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/admin/voice`, {
    method: "POST",
    headers: medimadeJsonHeaders(),
    body: JSON.stringify({ action: "delete", modelId }),
  });
  const data = (await res.json()) as { error?: string; detail?: string };
  if (!res.ok) {
    throw new Error(data.detail ?? data.error ?? res.statusText);
  }
}

export async function generateAdminVoiceSample(
  modelId: string,
): Promise<{ sampleUrl?: string | null }> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/admin/voice`, {
    method: "POST",
    headers: medimadeJsonHeaders(),
    body: JSON.stringify({ action: "sample", modelId }),
  });
  const data = (await res.json()) as {
    sampleUrl?: string | null;
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(data.detail ?? data.error ?? res.statusText);
  }
  return data;
}

export async function listBackgroundAudio(): Promise<BackgroundAudioByCategory> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/media/background-audio`);
  const data = (await res.json()) as {
    baseUrl?: string;
    nature?: BackgroundAudioItem[];
    ambience?: BackgroundAudioItem[];
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
    nature: data.ambience ?? data.nature ?? [],
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
  if (type && styleOk) {
    if (type.toLowerCase() === styleOk.toLowerCase()) return type;
    return `${type} · ${styleOk}`;
  }
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
  /** UTF-8 bytes actually sent to TTS (Fish billable input), when stored. */
  scriptUtf8Bytes?: number | null;
  rating: number | null;
  favourite: boolean;
  archived: boolean;
  isPublic?: boolean;
  catalogued: boolean;
  mp3Bytes: number | null;
  /** Saved create-flow draft (not shown in main library list). */
  isDraft: boolean;
  /** Speech-only stem; backgrounds are mixed in the Library player. */
  liveMix?: boolean;
  backgroundNatureKey?: string | null;
  backgroundMusicKey?: string | null;
  backgroundDrumsKey?: string | null;
  backgroundNoiseKey?: string | null;
  backgroundNatureGain?: number | null;
  backgroundMusicGain?: number | null;
  backgroundDrumsGain?: number | null;
  backgroundNoiseGain?: number | null;
  createdBackgroundNatureKey?: string | null;
  createdBackgroundMusicKey?: string | null;
  createdBackgroundDrumsKey?: string | null;
  createdBackgroundNoiseKey?: string | null;
  createdBackgroundNatureGain?: number | null;
  createdBackgroundMusicGain?: number | null;
  createdBackgroundDrumsGain?: number | null;
  createdBackgroundNoiseGain?: number | null;
  publisherBackgroundNatureKey?: string | null;
  publisherBackgroundMusicKey?: string | null;
  publisherBackgroundDrumsKey?: string | null;
  publisherBackgroundNoiseKey?: string | null;
  publisherBackgroundNatureGain?: number | null;
  publisherBackgroundMusicGain?: number | null;
  publisherBackgroundDrumsGain?: number | null;
  publisherBackgroundNoiseGain?: number | null;
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
  ttsProvider?: TtsProvider;
  orpheusVoiceId?: string;
  speakerFxPreviewOn?: boolean;
  backgroundNatureKey: string;
  backgroundMusicKey: string;
  backgroundDrumsKey?: string;
  backgroundNoiseKey: string;
  backgroundNatureGain: number;
  backgroundMusicGain: number;
  backgroundDrumsGain?: number;
  backgroundNoiseGain: number;
  mobileCreateStep: "chat" | "audio";
  lastUsedScript: string | null;
  meditationTargetMinutes?: MeditationTargetMinutes;
  /** Style-path intake: 3 targeted answers + optional "anything else". */
  styleQuestionAnswers?: string[];
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
export async function listLibraryMeditations(opts?: {
  community?: boolean;
}): Promise<LibraryMeditationItem[]> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const qs = opts?.community
    ? (() => {
        const p = new URLSearchParams({ community: "1" });
        if (!getMedimadeSessionJwt()) {
          const listenerId = getOrCreateMixListenerId();
          if (listenerId) p.set("listenerId", listenerId);
        }
        return `?${p.toString()}`;
      })()
    : "";
  const res = await fetch(`${base}/library/meditations${qs}`, {
    headers: medimadeApiAuthHeaders(),
  });
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

export async function patchMeditationBackgroundMix(
  sk: string,
  mix: {
    backgroundNatureKey: string;
    backgroundMusicKey: string;
    backgroundDrumsKey: string;
    backgroundNoiseKey: string;
    backgroundNatureGain: number;
    backgroundMusicGain: number;
    backgroundDrumsGain: number;
    backgroundNoiseGain: number;
  },
  opts?: { community?: boolean; s3Key?: string },
): Promise<void> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const listenerId = getOrCreateMixListenerId();
  const res = await fetch(`${base}/library/meditations/mix`, {
    method: "PATCH",
    headers: medimadeJsonHeaders(),
    body: JSON.stringify({
      sk,
      ...mix,
      ...(opts?.community ? { community: true, s3Key: opts.s3Key ?? "" } : {}),
      ...(listenerId ? { listenerId } : {}),
      ...(sessionTokenForBody() ? { sessionToken: sessionTokenForBody() } : {}),
    }),
  });
  const data = (await res.json()) as { error?: string; detail?: string };
  if (!res.ok) {
    const msg = data.detail ?? data.error ?? res.statusText;
    throw new Error(msg);
  }
}

export async function patchMeditationPublic(
  sk: string,
  isPublic: boolean,
): Promise<void> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("NEXT_PUBLIC_MEDIMADE_API_URL is not set");
  const res = await fetch(`${base}/library/meditations/public`, {
    method: "PATCH",
    headers: medimadeJsonHeaders(),
    body: JSON.stringify({
      sk,
      isPublic,
      ...(sessionTokenForBody() ? { sessionToken: sessionTokenForBody() } : {}),
    }),
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
