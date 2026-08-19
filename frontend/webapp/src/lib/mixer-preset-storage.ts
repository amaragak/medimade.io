export type MixerPresetMix = {
  musicKey: string;
  natureKey: string;
  drumsKey: string;
  noiseKey: string;
  musicGain: number;
  natureGain: number;
  drumsGain: number;
  noiseGain: number;
};

export type MixerPreset = MixerPresetMix & {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type MixerPresetStoreV1 = {
  version: 1;
  activeId: string | null;
  presets: MixerPreset[];
};

const STORE_KEY = "mm_mixer_presets_v1";
const DEFAULT_GAIN = 25;

export function emptyMixerMix(): MixerPresetMix {
  return {
    musicKey: "",
    natureKey: "",
    drumsKey: "",
    noiseKey: "",
    musicGain: DEFAULT_GAIN,
    natureGain: DEFAULT_GAIN,
    drumsGain: DEFAULT_GAIN,
    noiseGain: DEFAULT_GAIN,
  };
}

function clampGain(n: unknown): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : DEFAULT_GAIN;
  return Math.min(100, Math.max(0, x));
}

function newId(): string {
  const now = new Date().toISOString();
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `mix_${now}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizePreset(raw: unknown): MixerPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  const name =
    typeof o.name === "string" && o.name.trim()
      ? o.name.trim().slice(0, 80)
      : "Untitled mix";
  const createdAt =
    typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString();
  const updatedAt =
    typeof o.updatedAt === "string" ? o.updatedAt : createdAt;
  return {
    id: o.id,
    name,
    createdAt,
    updatedAt,
    musicKey: typeof o.musicKey === "string" ? o.musicKey : "",
    natureKey: typeof o.natureKey === "string" ? o.natureKey : "",
    drumsKey: typeof o.drumsKey === "string" ? o.drumsKey : "",
    noiseKey: typeof o.noiseKey === "string" ? o.noiseKey : "",
    musicGain: clampGain(o.musicGain),
    natureGain: clampGain(o.natureGain),
    drumsGain: clampGain(o.drumsGain),
    noiseGain: clampGain(o.noiseGain),
  };
}

export function loadMixerPresetStore(): MixerPresetStoreV1 {
  if (typeof window === "undefined") {
    return { version: 1, activeId: null, presets: [] };
  }
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return { version: 1, activeId: null, presets: [] };
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") {
      return { version: 1, activeId: null, presets: [] };
    }
    const o = data as Record<string, unknown>;
    const presets = Array.isArray(o.presets)
      ? o.presets.map(normalizePreset).filter((x): x is MixerPreset => Boolean(x))
      : [];
    const activeId =
      typeof o.activeId === "string" && presets.some((p) => p.id === o.activeId)
        ? o.activeId
        : presets[0]?.id ?? null;
    return { version: 1, activeId, presets };
  } catch {
    return { version: 1, activeId: null, presets: [] };
  }
}

export function saveMixerPresetStore(store: MixerPresetStoreV1): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

export function newMixerPreset(name?: string): MixerPreset {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name: name?.trim() || "Untitled mix",
    createdAt: now,
    updatedAt: now,
    ...emptyMixerMix(),
  };
}

export function mixerPresetToMix(p: MixerPreset): MixerPresetMix {
  return {
    musicKey: p.musicKey,
    natureKey: p.natureKey,
    drumsKey: p.drumsKey,
    noiseKey: p.noiseKey,
    musicGain: p.musicGain,
    natureGain: p.natureGain,
    drumsGain: p.drumsGain,
    noiseGain: p.noiseGain,
  };
}

export function mixEquals(a: MixerPresetMix, b: MixerPresetMix): boolean {
  return (
    a.musicKey === b.musicKey &&
    a.natureKey === b.natureKey &&
    a.drumsKey === b.drumsKey &&
    a.noiseKey === b.noiseKey &&
    a.musicGain === b.musicGain &&
    a.natureGain === b.natureGain &&
    a.drumsGain === b.drumsGain &&
    a.noiseGain === b.noiseGain
  );
}
