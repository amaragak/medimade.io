import type { BgAudioCategory } from "./background-audio-keys";

export type SoundSubcategoryOption = { id: string; label: string };

/** Constrained mixer tags. Empty = category has no subcategory. */
export const SOUND_SUBCATEGORIES: Record<
  BgAudioCategory,
  readonly SoundSubcategoryOption[]
> = {
  music: [
    { id: "pads-drones", label: "Synth Pads" },
    { id: "instruments", label: "Instrument Drones" },
    { id: "melodic", label: "Melodic" },
    { id: "voices", label: "Voices" },
  ],
  ambience: [
    { id: "nature", label: "Nature" },
    { id: "spaces", label: "Spaces" },
  ],
  drums: [
    { id: "lo-fi-beats", label: "Lo-fi beats" },
    { id: "shamanic", label: "Shamanic" },
    { id: "other", label: "Other" },
  ],
  noise: [],
};

export const SOUND_CATEGORY_LABELS: Record<BgAudioCategory, string> = {
  music: "Music",
  ambience: "Ambience",
  drums: "Drums",
  noise: "Noise",
};

const MUSIC_SUB_ALIASES: Record<string, string> = {
  pad: "pads-drones",
  pads: "pads-drones",
  drone: "pads-drones",
  drones: "pads-drones",
  "pads-and-drones": "pads-drones",
  atmosphere: "pads-drones",
  ambient: "pads-drones",
  instrument: "instruments",
  piano: "instruments",
  guitar: "instruments",
  strings: "instruments",
  keys: "instruments",
  bells: "instruments",
  melody: "melodic",
  lead: "melodic",
  lofi: "melodic",
  cinematic: "melodic",
  voice: "voices",
  voices: "voices",
  vocal: "voices",
  vocals: "voices",
  choir: "voices",
  chant: "voices",
};

const AMBIENCE_SUB_ALIASES: Record<string, string> = {
  rain: "nature",
  ocean: "nature",
  birds: "nature",
  forest: "nature",
  wind: "nature",
  water: "nature",
  beach: "nature",
  weather: "nature",
  wildlife: "nature",
  fire: "nature",
  other: "spaces",
  space: "spaces",
  city: "spaces",
  cafe: "spaces",
  room: "spaces",
  interior: "spaces",
  urban: "spaces",
  crowd: "spaces",
  atmosphere: "spaces",
  ambient: "spaces",
};

const DRUMS_SUB_ALIASES: Record<string, string> = {
  lofi: "lo-fi-beats",
  "lo-fi": "lo-fi-beats",
  "lofi-beats": "lo-fi-beats",
  "lo-fi-beat": "lo-fi-beats",
  beat: "lo-fi-beats",
  beats: "lo-fi-beats",
  hiphop: "lo-fi-beats",
  "hip-hop": "lo-fi-beats",
  shaman: "shamanic",
  ritual: "shamanic",
  frame: "shamanic",
  taiko: "shamanic",
  kick: "other",
  percussion: "other",
  hat: "other",
};

export function subcategoryOptions(category: BgAudioCategory): readonly SoundSubcategoryOption[] {
  return SOUND_SUBCATEGORIES[category] ?? [];
}

export function defaultSubcategory(category: BgAudioCategory): string {
  return subcategoryOptions(category)[0]?.id ?? "";
}

export function subcategoryLabel(category: BgAudioCategory, id: string): string {
  return subcategoryOptions(category).find((o) => o.id === id)?.label ?? id;
}

export function coerceSoundSubcategory(category: BgAudioCategory, raw: unknown): string {
  const allowed = subcategoryOptions(category);
  if (allowed.length === 0) return "";
  const slug = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (allowed.some((o) => o.id === slug)) return slug;
  const aliases =
    category === "music"
      ? MUSIC_SUB_ALIASES
      : category === "ambience"
        ? AMBIENCE_SUB_ALIASES
        : category === "drums"
          ? DRUMS_SUB_ALIASES
          : {};
  const mapped = aliases[slug];
  if (mapped && allowed.some((o) => o.id === mapped)) return mapped;
  return allowed[0]!.id;
}

/** Guess subcategory from a legacy S3 path / filename when catalog has none. */
export function inferSoundSubcategory(category: BgAudioCategory, path: string): string {
  const blob = path.toLowerCase().replace(/[_/]+/g, " ");
  if (category === "music") {
    if (/\b(voice|vocal|choir|chant|mantra)\b/.test(blob)) return "voices";
    if (/\b(piano|guitar|string|bell|harp|flute|kalimba|singing bowl|crystal bowl)\b/.test(blob)) {
      return "instruments";
    }
    if (/\b(melod|lead|lofi|lo-fi|cinematic)\b/.test(blob)) return "melodic";
    if (/\b(pad|drone|atmos)\b/.test(blob)) return "pads-drones";
    return "pads-drones";
  }
  if (category === "ambience") {
    if (/\b(cafe|city|room|crowd|interior|urban|temple|street)\b/.test(blob)) return "spaces";
    return "nature";
  }
  if (category === "drums") {
    if (/\b(shaman|ritual|taiko|tribal|frame)\b/.test(blob)) return "shamanic";
    if (/\b(lofi|lo-fi|hip hop|hiphop|beat)\b/.test(blob)) return "lo-fi-beats";
    return "other";
  }
  return "";
}
