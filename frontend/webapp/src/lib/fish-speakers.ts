/** Display names → Fish Audio `reference_id` (voice model ids). */
export const FISH_SPEAKERS = [
  {
    name: "Alan Watts",
    modelId: "21bcb45116b44157820dbffb1927e185",
  },
  {
    name: "Novelist",
    modelId: "8d797adca9af48ca9e8a1c7284db1d6c",
  },
  {
    name: "Emily",
    modelId: "a325095a7cc049cebf39b1de9464fc73",
  },
] as const;

export type FishSpeakerModelId = (typeof FISH_SPEAKERS)[number]["modelId"];
