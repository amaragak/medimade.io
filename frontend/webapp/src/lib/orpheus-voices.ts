/** Display names for Orpheus voice ids (keep in sync with backend `ORPHEUS_VOICES`). */
export const ORPHEUS_VOICES = [
  { id: "tara", name: "Tara", description: "Warm, conversational female" },
  { id: "leah", name: "Leah", description: "Clear, friendly female" },
  { id: "jess", name: "Jess", description: "Expressive female" },
  { id: "mia", name: "Mia", description: "Soft, gentle female" },
  { id: "zoe", name: "Zoe", description: "Bright female" },
  { id: "leo", name: "Leo", description: "Calm male" },
  { id: "dan", name: "Dan", description: "Grounded male" },
  { id: "zac", name: "Zac", description: "Deep male" },
] as const;

export type OrpheusVoiceId = (typeof ORPHEUS_VOICES)[number]["id"];

export type TtsProvider = "fish" | "orpheus";

export const DEFAULT_ORPHEUS_VOICE_ID: OrpheusVoiceId = "tara";

export function orpheusVoiceNameForId(
  voiceId: string | null | undefined,
): string | null {
  if (!voiceId) return null;
  const found = ORPHEUS_VOICES.find((v) => v.id === voiceId);
  return found?.name ?? null;
}
