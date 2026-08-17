export const SOUND_CATEGORIES = ["music", "ambience", "drums", "noise"] as const;
export type SoundCategoryId = (typeof SOUND_CATEGORIES)[number];

export type SoundSubcategoryOption = { id: string; label: string };

export const SOUND_SUBCATEGORIES: Record<SoundCategoryId, readonly SoundSubcategoryOption[]> = {
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

export const SOUND_CATEGORY_LABELS: Record<SoundCategoryId, string> = {
  music: "Music",
  ambience: "Ambience",
  drums: "Drums",
  noise: "Noise",
};

export function normalizeSoundCategory(v: string): SoundCategoryId | null {
  const key = v.trim().toLowerCase();
  if (key === "nature") return "ambience";
  if ((SOUND_CATEGORIES as readonly string[]).includes(key)) return key as SoundCategoryId;
  return null;
}

export function subcategoryOptions(category: SoundCategoryId): readonly SoundSubcategoryOption[] {
  return SOUND_SUBCATEGORIES[category] ?? [];
}

export function defaultSubcategory(category: SoundCategoryId): string {
  return subcategoryOptions(category)[0]?.id ?? "";
}

export function subcategoryLabel(category: SoundCategoryId, id: string): string {
  return subcategoryOptions(category).find((o) => o.id === id)?.label ?? id;
}

export function categoryLabel(category: SoundCategoryId): string {
  return SOUND_CATEGORY_LABELS[category];
}

export function coerceSoundSubcategory(category: SoundCategoryId, raw: unknown): string {
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
  return allowed[0]!.id;
}

export function inferSoundSubcategory(category: SoundCategoryId, path: string): string {
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

export const DRUMS_LOCKED_FOR_MELODIC_HINT =
  "Drums stay off with melodic tracks so the beat doesn’t clash with the melody’s tempo.";

export function isMelodicMusicKey(
  items: Array<{ key: string; subcategory?: string }>,
  key: string,
): boolean {
  const k = key.trim();
  if (!k) return false;
  const stem = k.replace(/\.(mp3|wav)$/i, "");
  const item = items.find((s) => s.key === k || s.key.replace(/\.(mp3|wav)$/i, "") === stem);
  if (!item) return false;
  const sub = item.subcategory || inferSoundSubcategory("music", item.key);
  return sub === "melodic";
}
