export type FishSpeaker = { name: string; modelId: string; description?: string };

/**
 * Single source of truth for mapping Fish Audio voice model ids → speaker names.
 *
 * Keep this list in sync with the frontend UI expectations.
 */
export const FISH_SPEAKERS: FishSpeaker[] = [
  { name: "Alan Watts", modelId: "21bcb45116b44157820dbffb1927e185" },
  { name: "Novelist", modelId: "8d797adca9af48ca9e8a1c7284db1d6c" },
  { name: "Emily", modelId: "a325095a7cc049cebf39b1de9464fc73" },
  { name: "Fairy", modelId: "c1ad4031b437493aaf2393d8f768b9a7" },
  { name: "Brit Monk", modelId: "9f2792501813486399fbc827c733d3f0" },
  { name: "Deep Soothing", modelId: "daffce3e2eb74bb59c0701f469d83177" },
  { name: "Dina", modelId: "b2e60b7079c3400d96f168a132336837" },
];

/** Temporarily hidden from voice pickers (audio artifacts). Names still resolve. */
export const HIDDEN_FISH_SPEAKER_MODEL_IDS = new Set<string>([
  "8d797adca9af48ca9e8a1c7284db1d6c",
]);

export function fishSpeakersForPicker(): FishSpeaker[] {
  return FISH_SPEAKERS.filter((s) => !HIDDEN_FISH_SPEAKER_MODEL_IDS.has(s.modelId));
}

export function speakerNameForModelId(
  modelId: string | null | undefined,
): string | null {
  if (!modelId) return null;
  const found = FISH_SPEAKERS.find((s) => s.modelId === modelId);
  return found?.name ?? null;
}

