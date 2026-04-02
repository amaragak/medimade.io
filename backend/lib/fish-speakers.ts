export type FishSpeaker = { name: string; modelId: string };

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
];

export function speakerNameForModelId(
  modelId: string | null | undefined,
): string | null {
  if (!modelId) return null;
  const found = FISH_SPEAKERS.find((s) => s.modelId === modelId);
  return found?.name ?? null;
}

