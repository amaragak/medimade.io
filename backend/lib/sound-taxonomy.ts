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

export const SOUND_CATEGORY_LABELS: Record<BgAudioCategory, string> = {
  music: "Music",
  compositions: "Compositions",
  ambience: "Ambience",
  drums: "Drums",
  noise: "Noise",
};

/**
 * Sanskrit names stand alone; the English ones need "chakra" nearby, since
 * root, heart and crown all turn up in ordinary track titles.
 */
const CHAKRA_PATTERN =
  /\bchakra|muladhara|svadhisthana|manipura|anahata|vishuddha|ajna|sahasrara\b/;

/** Brainwave bands, low to high, for reading a frequency out of a filename. */
const BINAURAL_BANDS: ReadonlyArray<{ label: string; minHz: number; maxHz: number }> = [
  { label: "Delta", minHz: 0, maxHz: 4 },
  { label: "Theta", minHz: 4, maxHz: 8 },
  { label: "Alpha", minHz: 8, maxHz: 13 },
  { label: "Beta", minHz: 13, maxHz: 30 },
  { label: "Gamma", minHz: 30, maxHz: 100 },
];

/** Above this a number is a carrier tone, not an entrainment rate. */
const MAX_ENTRAINMENT_HZ = 100;

type HzMention = { text: string; low: number; high: number };

/** Every frequency written as Hz, in order. `100-120hz` stays one mention. */
function hzMentions(path: string): HzMention[] {
  const blob = path.toLowerCase().replace(/[_/]+/g, " ");
  const pattern =
    /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*hz\b|(\d+(?:\.\d+)?)\s*hz\b/g;
  const out: HzMention[] = [];
  for (const m of blob.matchAll(pattern)) {
    if (m[1] && m[2]) {
      const low = Number(m[1]);
      const high = Number(m[2]);
      if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
      out.push({ text: `${low}-${high}Hz`, low: Math.min(low, high), high: Math.max(low, high) });
      continue;
    }
    const value = Number(m[3]);
    if (!Number.isFinite(value) || value <= 0) continue;
    out.push({ text: `${value}Hz`, low: value, high: value });
  }
  return out;
}

function bandForHz(value: number): (typeof BINAURAL_BANDS)[number] | null {
  if (value <= 0 || value > MAX_ENTRAINMENT_HZ) return null;
  return BINAURAL_BANDS.find((b) => value < b.maxHz) ?? null;
}

/**
 * Band a filename implies, by name or by a frequency in it — `7.83hz` is Theta.
 * Null when nothing in the name suggests entrainment content.
 */
export function binauralBandFromPath(path: string): string | null {
  const named = path
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .match(/\b(delta|theta|alpha|beta|gamma)\b/);
  if (named) {
    const word = named[1]!;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  const mentions = hzMentions(path);
  // Files often pair a carrier with the beat rate ("65hz 11hz"). The beat is
  // the lower one, and it is the only part that names a band.
  const rates = mentions
    .map((m) => m.low)
    .filter((v) => v > 0 && v <= 30)
    .sort((a, b) => a - b);
  if (rates.length > 0) return bandForHz(rates[0]!)?.label ?? null;
  // Otherwise the pair may be the two carriers, one per ear, whose difference
  // is the beat: 129 Hz against 141 Hz is a 12 Hz alpha beat.
  const pair = carrierPair(mentions);
  return pair ? (bandForHz(pair.beat)?.label ?? null) : null;
}

/** Two single tones whose difference is a plausible entrainment rate. */
function carrierPair(
  mentions: HzMention[],
  band?: (typeof BINAURAL_BANDS)[number] | null,
): { text: string; beat: number } | null {
  const singles = mentions.filter((m) => m.low === m.high);
  let best: { text: string; beat: number } | null = null;
  for (let i = 0; i < singles.length; i += 1) {
    for (let j = i + 1; j < singles.length; j += 1) {
      const a = singles[i]!.low;
      const b = singles[j]!.low;
      const beat = Math.abs(a - b);
      if (beat <= 0 || beat > 30) continue;
      if (band && !(beat >= band.minHz && beat < band.maxHz)) continue;
      const candidate = { text: `${Math.min(a, b)}-${Math.max(a, b)}Hz`, beat };
      if (!best || candidate.beat < best.beat) best = candidate;
      if (band) return candidate;
    }
  }
  return best;
}

/**
 * The frequency worth putting in the title.
 *
 * A frequency inside the band is the beat rate itself and stands alone —
 * `65hz-11hz-alpha` is an 11 Hz beat on a 65 Hz carrier. When every frequency
 * sits outside the band they are the two carriers, one per ear, and it is their
 * difference that makes the beat, so the pair is shown as a range:
 * `129Hz` and `141Hz` under Alpha becomes `129-141Hz`.
 */
export function binauralFrequencyLabel(path: string, band: string | null): string | null {
  const mentions = hzMentions(path);
  if (mentions.length === 0) return null;
  const range = band ? BINAURAL_BANDS.find((b) => b.label === band) ?? null : null;
  if (range) {
    const inBand = mentions.find((m) => m.high >= range.minHz && m.low < range.maxHz);
    if (inBand) return inBand.text;
    const pair = carrierPair(mentions, range);
    if (pair) return pair.text;
  }
  const carriers = carrierPair(mentions);
  if (carriers) return carriers.text;
  const entrainment = mentions.find((m) => m.low <= 30);
  return (entrainment ?? mentions[0]!).text;
}

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
  alpha: "binaural",
  beta: "binaural",
  theta: "binaural",
  delta: "binaural",
  gamma: "binaural",
  isochronic: "binaural",
  entrainment: "binaural",
  solfeggio: "binaural",
  hz: "binaural",
  chakra: "chakras",
  root: "chakras",
  sacral: "chakras",
  "solar-plexus": "chakras",
  heart: "chakras",
  throat: "chakras",
  "third-eye": "chakras",
  crown: "chakras",
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

/**
 * Categories whose sub-folders are named per import — compositions are grouped
 * by the pack they came from, which we cannot know ahead of time.
 */
const FREEFORM_SUBCATEGORY_CATEGORIES: readonly BgAudioCategory[] = ["compositions"];

export function hasFreeformSubcategories(category: BgAudioCategory): boolean {
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

export function subcategoryLabel(category: BgAudioCategory, id: string): string {
  const known = subcategoryOptions(category).find((o) => o.id === id);
  if (known) return known.label;
  return hasFreeformSubcategories(category) ? prettySubcategoryLabel(id) : id;
}

export function coerceSoundSubcategory(category: BgAudioCategory, raw: unknown): string {
  const slug = soundSubcategorySlug(raw);
  if (hasFreeformSubcategories(category)) return slug;
  const allowed = subcategoryOptions(category);
  if (allowed.length === 0) return "";
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
    // Ahead of binaural: chakra beds are often named with a solfeggio frequency.
    if (CHAKRA_PATTERN.test(blob)) return "chakras";
    if (/\b(binaural|isochronic|entrainment|solfeggio)\b/.test(blob)) return "binaural";
    if (binauralBandFromPath(path)) return "binaural";
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
