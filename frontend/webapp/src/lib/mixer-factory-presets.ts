import type { MixerPresetMix } from "@/lib/mixer-preset-storage";

export type FactoryChannel = {
  source: string | null;
  volume: number;
};

export type MixerFactoryPreset = {
  id: string;
  name: string;
  description: string;
  icon: string;
  icon_bg: string;
  icon_color: string;
  channels: {
    music: FactoryChannel;
    ambience: FactoryChannel;
    drums: FactoryChannel;
    noise: FactoryChannel;
  };
};

/**
 * Design stubs only — live factory mixes come from admin Sound mixes (DynamoDB).
 */
export const MIXER_FACTORY_PRESETS: MixerFactoryPreset[] = [
  {
    id: "factory-rain-and-low-pad",
    name: "Rain and low pad",
    description: "Ambience, soft music",
    icon: "cloud-rain",
    icon_bg: "#E4EEF4",
    icon_color: "#3D5A73",
    channels: {
      music: { source: null, volume: 20 },
      ambience: { source: null, volume: 40 },
      drums: { source: null, volume: 0 },
      noise: { source: null, volume: 0 },
    },
  },
  {
    id: "factory-deep-silence",
    name: "Deep silence",
    description: "Near-silent noise floor",
    icon: "moon",
    icon_bg: "#EFEBF3",
    icon_color: "#7A5D8F",
    channels: {
      music: { source: null, volume: 0 },
      ambience: { source: null, volume: 0 },
      drums: { source: null, volume: 0 },
      noise: { source: null, volume: 8 },
    },
  },
  {
    id: "factory-heartbeat-drone",
    name: "Heartbeat drone",
    description: "Drums, low ambience",
    icon: "heartbeat",
    icon_bg: "#FBEAEA",
    icon_color: "#A65252",
    channels: {
      music: { source: null, volume: 0 },
      ambience: { source: null, volume: 18 },
      drums: { source: null, volume: 35 },
      noise: { source: null, volume: 0 },
    },
  },
  {
    id: "factory-forest-air",
    name: "Forest air",
    description: "Ambience, light noise",
    icon: "trees",
    icon_bg: "#E8F0E0",
    icon_color: "#4A6B3A",
    channels: {
      music: { source: null, volume: 0 },
      ambience: { source: null, volume: 38 },
      drums: { source: null, volume: 0 },
      noise: { source: null, volume: 12 },
    },
  },
];

export function factoryPresetToMix(p: MixerFactoryPreset): MixerPresetMix {
  return {
    musicKey: p.channels.music.source?.trim() || "",
    natureKey: p.channels.ambience.source?.trim() || "",
    drumsKey: p.channels.drums.source?.trim() || "",
    noiseKey: p.channels.noise.source?.trim() || "",
    musicGain: p.channels.music.volume,
    natureGain: p.channels.ambience.volume,
    drumsGain: p.channels.drums.volume,
    noiseGain: p.channels.noise.volume,
  };
}

export function mixToFactoryChannels(mix: MixerPresetMix): MixerFactoryPreset["channels"] {
  return {
    music: { source: mix.musicKey.trim() || null, volume: mix.musicGain },
    ambience: { source: mix.natureKey.trim() || null, volume: mix.natureGain },
    drums: { source: mix.drumsKey.trim() || null, volume: mix.drumsGain },
    noise: { source: mix.noiseKey.trim() || null, volume: mix.noiseGain },
  };
}

export const FACTORY_ICON_OPTIONS = [
  { id: "cloud-rain", label: "Rain" },
  { id: "cloud-storm", label: "Storm" },
  { id: "cloud-fog", label: "Fog" },
  { id: "cloud", label: "Cloud" },
  { id: "wind", label: "Wind" },
  { id: "waves", label: "Waves" },
  { id: "droplet", label: "Water" },
  { id: "ripple", label: "Ripple" },
  { id: "mist", label: "Mist" },
  { id: "snowflake", label: "Snow" },
  { id: "flame", label: "Fire" },
  { id: "campfire", label: "Campfire" },
  { id: "moon", label: "Moon" },
  { id: "moon-stars", label: "Night" },
  { id: "sun", label: "Sun" },
  { id: "sunrise", label: "Dawn" },
  { id: "sunset", label: "Dusk" },
  { id: "stars", label: "Stars" },
  { id: "sparkles", label: "Sparkles" },
  { id: "trees", label: "Forest" },
  { id: "leaf", label: "Leaves" },
  { id: "mountain", label: "Mountain" },
  { id: "flower", label: "Garden" },
  { id: "heartbeat", label: "Heartbeat" },
  { id: "music", label: "Music" },
  { id: "headphones", label: "Headphones" },
  { id: "wave-sine", label: "Tone" },
  { id: "om", label: "Om" },
  { id: "yoga", label: "Stillness" },
] as const;

export const FACTORY_COLOR_PRESETS = [
  { icon_bg: "#E4EEF4", icon_color: "#3D5A73" },
  { icon_bg: "#EFEBF3", icon_color: "#7A5D8F" },
  { icon_bg: "#FBEAEA", icon_color: "#A65252" },
  { icon_bg: "#E8F0E0", icon_color: "#4A6B3A" },
  { icon_bg: "#F8EAD4", icon_color: "#B8703A" },
] as const;

export function emptyFactoryPreset(name?: string): MixerFactoryPreset {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `factory_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    name: name?.trim() || "Untitled mix",
    description: "",
    icon: "cloud-rain",
    icon_bg: "#E4EEF4",
    icon_color: "#3D5A73",
    channels: {
      music: { source: null, volume: 25 },
      ambience: { source: null, volume: 25 },
      drums: { source: null, volume: 25 },
      noise: { source: null, volume: 25 },
    },
  };
}

export function normalizeFactoryPreset(raw: unknown): MixerFactoryPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  const ch =
    o.channels && typeof o.channels === "object"
      ? (o.channels as Record<string, unknown>)
      : {};
  const channel = (c: unknown, fallback: number): FactoryChannel => {
    if (!c || typeof c !== "object") return { source: null, volume: fallback };
    const x = c as Record<string, unknown>;
    const src = typeof x.source === "string" ? x.source.trim() : "";
    const vol =
      typeof x.volume === "number" && Number.isFinite(x.volume) ? x.volume : fallback;
    return {
      source: src || null,
      volume: Math.min(100, Math.max(0, vol)),
    };
  };
  return {
    id: o.id.trim(),
    name:
      typeof o.name === "string" && o.name.trim()
        ? o.name.trim().slice(0, 80)
        : "Untitled mix",
    description:
      typeof o.description === "string" ? o.description.trim().slice(0, 160) : "",
    icon: typeof o.icon === "string" && o.icon.trim() ? o.icon.trim() : "cloud-rain",
    icon_bg:
      typeof o.icon_bg === "string" && o.icon_bg.trim() ? o.icon_bg.trim() : "#E4EEF4",
    icon_color:
      typeof o.icon_color === "string" && o.icon_color.trim()
        ? o.icon_color.trim()
        : "#3D5A73",
    channels: {
      music: channel(ch.music, 25),
      ambience: channel(ch.ambience, 25),
      drums: channel(ch.drums, 25),
      noise: channel(ch.noise, 25),
    },
  };
}

export function factoryPresetEquals(a: MixerFactoryPreset, b: MixerFactoryPreset): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.description === b.description &&
    a.icon === b.icon &&
    a.icon_bg === b.icon_bg &&
    a.icon_color === b.icon_color &&
    JSON.stringify(a.channels) === JSON.stringify(b.channels)
  );
}
