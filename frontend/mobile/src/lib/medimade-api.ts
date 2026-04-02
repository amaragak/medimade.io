export type MedimadeChatTurn = { role: "user" | "assistant"; content: string };

export function getMedimadeApiBase(): string | null {
  const u = process.env.EXPO_PUBLIC_MEDIMADE_API_URL;
  if (!u || typeof u !== "string") return null;
  const t = u.trim();
  if (!t) return null;
  return t.endsWith("/") ? t.slice(0, -1) : t;
}

export function getMedimadeChatUrl(): string | null {
  const u = process.env.EXPO_PUBLIC_MEDIMADE_CHAT_URL;
  if (!u || typeof u !== "string") return null;
  const t = u.trim();
  return t || null;
}

async function streamChatRequest(
  body: Record<string, unknown>,
  onDelta: (chunk: string) => void,
  emptyMessage: string,
): Promise<string> {
  const url = getMedimadeChatUrl();
  if (!url) {
    throw new Error("EXPO_PUBLIC_MEDIMADE_CHAT_URL is not set");
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

export async function generateMeditationAudio(params: {
  meditationStyle: string | null;
  transcript: string;
  scriptText?: string | null;
  reference_id: string;
}): Promise<GenerateMeditationAudioResponse> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("EXPO_PUBLIC_MEDIMADE_API_URL is not set");

  const res = await fetch(`${base}/meditation/audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      meditationStyle: params.meditationStyle ?? "",
      transcript: params.transcript,
      scriptText: params.scriptText ?? "",
      reference_id: params.reference_id,
    }),
  });

  const data = (await res.json()) as Partial<GenerateMeditationAudioResponse> & {
    error?: string;
    detail?: string;
  };

  if (!res.ok) {
    const msg =
      data.detail ?? data.error ?? res.statusText ?? "Audio generation failed";
    throw new Error(msg);
  }

  if (!data.audioUrl || !data.scriptTextUsed || !data.audioKey) {
    throw new Error("Malformed response from audio generation endpoint");
  }

  return data as GenerateMeditationAudioResponse;
}

export type LibraryMeditationItem = {
  id: string | null;
  sk: string | null;
  s3Key: string;
  audioUrl: string;
  title: string;
  meditationType: string | null;
  meditationStyle: string | null;
  description: string | null;
  createdAt: string | null;
  durationSeconds: number | null;
  scriptText: string | null;
  scriptTruncated: boolean;
  rating: number | null;
  favourite: boolean;
  catalogued: boolean;
  mp3Bytes: number | null;
};

export async function listLibraryMeditations(): Promise<LibraryMeditationItem[]> {
  const base = getMedimadeApiBase();
  if (!base) throw new Error("EXPO_PUBLIC_MEDIMADE_API_URL is not set");
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
  if (!base) throw new Error("EXPO_PUBLIC_MEDIMADE_API_URL is not set");
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
  if (!base) throw new Error("EXPO_PUBLIC_MEDIMADE_API_URL is not set");
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
