export const SOUND_CATEGORIES = [
  "music",
  "compositions",
  "ambience",
  "drums",
  "noise",
] as const;
export type SoundCategoryId = (typeof SOUND_CATEGORIES)[number];

export type SoundSubcategoryOption = { id: string; label: string };

export const SOUND_SUBCATEGORIES: Record<SoundCategoryId, readonly SoundSubcategoryOption[]> = {
  music: [
    { id: "pads-drones", label: "Synth Pads" },
    { id: "instruments", label: "Instrument Drones" },
    { id: "melodic", label: "Melodic" },
    { id: "voices", label: "Voices" },
    { id: "binaural", label: "Binaural" },
    { id: "chakras", label: "Chakras" },
  ],
  /** Full-length pieces, picked whole — no sub-folders to sort them into. */
  compositions: [],
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
  compositions: "Compositions",
  ambience: "Ambience",
  drums: "Drums",
  noise: "Noise",
};

/**
 * Folders a fader shows, including categories folded into it. Compositions have
 * no fader of their own; they appear as one folder at the end of music.
 */
const CHANNEL_EXTRA_FOLDERS: Partial<Record<SoundCategoryId, readonly SoundSubcategoryOption[]>> = {
  music: [{ id: "compositions", label: "Compositions" }],
};

export function channelSubcategoryOptions(
  category: SoundCategoryId,
): readonly SoundSubcategoryOption[] {
  const extra = CHANNEL_EXTRA_FOLDERS[category];
  return extra ? [...SOUND_SUBCATEGORIES[category], ...extra] : SOUND_SUBCATEGORIES[category];
}

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

/**
 * Categories whose sub-folders are named per import — compositions are grouped
 * by the pack they came from, which we cannot know ahead of time.
 */
const FREEFORM_SUBCATEGORY_CATEGORIES: readonly SoundCategoryId[] = ["compositions"];

export function hasFreeformSubcategories(category: SoundCategoryId): boolean {
  return FREEFORM_SUBCATEGORY_CATEGORIES.includes(category);
}

export function soundSubcategorySlug(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function prettySubcategoryLabel(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Binaural files are named with their band up front — "(Alpha 8Hz) Nordic
 * Sunrise" — which admins rely on but listeners don't need. Stripped at render
 * time only: the stored name keeps the band for filtering and admin review.
 */
const BRAINWAVE_BAND_PREFIX = /^\(\s*(?:delta|theta|alpha|beta|gamma)\b[^)]*\)\s*/i;

export function soundDisplayName(name: string): string {
  return name.replace(BRAINWAVE_BAND_PREFIX, "").trim() || name.trim();
}

export function subcategoryLabel(category: SoundCategoryId, id: string): string {
  const known = channelSubcategoryOptions(category).find((o) => o.id === id);
  return known?.label ?? prettySubcategoryLabel(id) ?? "";
}

export function categoryLabel(category: SoundCategoryId): string {
  return SOUND_CATEGORY_LABELS[category];
}

export function coerceSoundSubcategory(category: SoundCategoryId, raw: unknown): string {
  const slug = soundSubcategorySlug(raw);
  if (hasFreeformSubcategories(category)) return slug;
  const allowed = subcategoryOptions(category);
  if (allowed.length === 0) return "";
  if (allowed.some((o) => o.id === slug)) return slug;
  return allowed[0]!.id;
}

export function inferSoundSubcategory(category: SoundCategoryId, path: string): string {
  const blob = path.toLowerCase().replace(/[_/]+/g, " ");
  if (category === "music") {
    if (/\bchakra|muladhara|svadhisthana|manipura|anahata|vishuddha|ajna|sahasrara\b/.test(blob)) {
      return "chakras";
    }
    if (/\b(binaural|isochronic|entrainment|solfeggio)\b/.test(blob)) return "binaural";
    if (/\b(delta|theta|alpha|beta|gamma)\b/.test(blob)) return "binaural";
    if (/\b\d+(\.\d+)?\s*hz\b/.test(blob)) return "binaural";
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
