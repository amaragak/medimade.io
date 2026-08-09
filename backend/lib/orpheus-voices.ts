export type OrpheusVoice = {
  /** Orpheus voice id sent to RunPod / OpenAI speech API. */
  id: string;
  name: string;
  description?: string;
};

/** Built-in Orpheus-FastAPI voices (nexslerdev/orpheus-fastapi-tts). */
export const ORPHEUS_VOICES: OrpheusVoice[] = [
  { id: "tara", name: "Tara", description: "Warm, conversational female" },
  { id: "leah", name: "Leah", description: "Clear, friendly female" },
  { id: "jess", name: "Jess", description: "Expressive female" },
  { id: "mia", name: "Mia", description: "Soft, gentle female" },
  { id: "zoe", name: "Zoe", description: "Bright female" },
  { id: "leo", name: "Leo", description: "Calm male" },
  { id: "dan", name: "Dan", description: "Grounded male" },
  { id: "zac", name: "Zac", description: "Deep male" },
];

export const DEFAULT_ORPHEUS_VOICE_ID = "tara";

export function normalizeOrpheusVoiceId(
  raw: string | null | undefined,
): string | null {
  if (!raw || typeof raw !== "string") return null;
  const id = raw.trim().toLowerCase();
  if (!id) return null;
  return ORPHEUS_VOICES.some((v) => v.id === id) ? id : null;
}

export function orpheusVoiceNameForId(
  voiceId: string | null | undefined,
): string | null {
  const id = normalizeOrpheusVoiceId(voiceId);
  if (!id) return null;
  return ORPHEUS_VOICES.find((v) => v.id === id)?.name ?? null;
}

export type TtsProvider = "fish" | "orpheus";

export function normalizeTtsProvider(raw: unknown): TtsProvider {
  return raw === "orpheus" ? "orpheus" : "fish";
}
