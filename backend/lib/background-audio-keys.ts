export const BG_AUDIO_PREFIX = "background-audio/";
export const BG_AUDIO_RAW_PREFIX = "background-audio-raw/";
export const BG_AUDIO_ORIGINAL_PREFIX = "background-audio-original/";

export const BG_AUDIO_CATEGORIES = [
  "music",
  "compositions",
  "ambience",
  "drums",
  "noise",
] as const;
export type BgAudioCategory = (typeof BG_AUDIO_CATEGORIES)[number];

/** Legacy S3 folder / catalog value `nature` maps to ambience. */
const FOLDER_TO_CATEGORY: Record<string, BgAudioCategory> = {
  music: "music",
  compositions: "compositions",
  ambience: "ambience",
  nature: "ambience",
  drums: "drums",
  noise: "noise",
};
export function isBgAudioCategory(v: string): v is BgAudioCategory {
  return (BG_AUDIO_CATEGORIES as readonly string[]).includes(v);
}

export function normalizeBgAudioCategory(v: string): BgAudioCategory | null {
  return FOLDER_TO_CATEGORY[v.trim().toLowerCase()] ?? null;
}

export function categoryFromFolderSegment(seg: string): BgAudioCategory | null {
  return FOLDER_TO_CATEGORY[seg.trim().toLowerCase()] ?? null;
}

export function isAudioKey(key: string): boolean {
  const k = key.toLowerCase();
  return k.endsWith(".mp3") || k.endsWith(".wav");
}

export function spliceFilenameId(pathOrName: string): string {
  const leaf = pathOrName.split(/[/\\]/).pop()?.trim() ?? "";
  const noExt = leaf.replace(/\.(mp3|wav)$/i, "");
  return noExt
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

export function leafNameFromKey(key: string): string {
  const leaf = key.split("/").pop() ?? key;
  const dot = leaf.lastIndexOf(".");
  return (dot > 0 ? leaf.slice(0, dot) : leaf) || leaf;
}

export function audioStemKey(key: string): string {
  return key.replace(/\.(mp3|wav)$/i, "");
}

/** Any audio object under background-audio/ (category folder optional). */
export function parseAnyBgAudioKey(key: string): {
  key: string;
  name: string;
  rel: string;
  folderCategory: BgAudioCategory | null;
} | null {
  if (!key || key.endsWith("/")) return null;
  if (!isAudioKey(key)) return null;
  if (!key.startsWith(BG_AUDIO_PREFIX)) return null;
  const rel = key.slice(BG_AUDIO_PREFIX.length);
  if (!rel || rel.endsWith("/")) return null;
  const firstSlash = rel.indexOf("/");
  const first = firstSlash > 0 ? rel.slice(0, firstSlash) : "";
  return {
    key,
    name: leafNameFromKey(key),
    rel,
    folderCategory: first ? categoryFromFolderSegment(first) : null,
  };
}

export function parseBgAudioKey(key: string): {
  key: string;
  name: string;
  category: BgAudioCategory;
  relAfterCategory: string;
} | null {
  const any = parseAnyBgAudioKey(key);
  if (!any?.folderCategory) return null;
  const firstSlash = any.rel.indexOf("/");
  const rest = firstSlash > 0 ? any.rel.slice(firstSlash + 1) : "";
  if (!rest) return null;
  return {
    key: any.key,
    name: any.name,
    category: any.folderCategory,
    relAfterCategory: rest,
  };
}

export type ListedBgItem = {
  key: string;
  name: string;
  size: number | null;
  wavKey?: string;
  subcategory?: string;
};

export function mergeByNamePreferMp3(
  items: { key: string; name: string; size: number | null }[],
): ListedBgItem[] {
  return mergeByStemPreferMp3(items);
}

/** Pair MP3/WAV siblings that share the same path stem (not just filename). */
export function mergeByStemPreferMp3(
  items: { key: string; name?: string; size: number | null }[],
): ListedBgItem[] {
  const byStem = new Map<
    string,
    { mp3?: (typeof items)[number]; wav?: (typeof items)[number] }
  >();
  for (const item of items) {
    const lower = item.key.toLowerCase();
    const rec = byStem.get(audioStemKey(item.key)) ?? {};
    if (lower.endsWith(".mp3")) rec.mp3 = item;
    else if (lower.endsWith(".wav")) rec.wav = item;
    byStem.set(audioStemKey(item.key), rec);
  }
  const out: ListedBgItem[] = [];
  for (const [stem, rec] of byStem) {
    const name =
      rec.mp3?.name?.trim() ||
      rec.wav?.name?.trim() ||
      leafNameFromKey(stem);
    if (rec.mp3) {
      out.push({
        key: rec.mp3.key,
        name,
        size: rec.mp3.size,
        ...(rec.wav ? { wavKey: rec.wav.key } : {}),
      });
    } else if (rec.wav) {
      out.push({ key: rec.wav.key, name, size: rec.wav.size });
    }
  }
  return out;
}

export function sanitizeSoundFilename(filename: string): string | null {
  const leaf = filename.split(/[/\\]/).pop()?.trim() ?? "";
  if (!leaf) return null;
  const lower = leaf.toLowerCase();
  if (!lower.endsWith(".mp3") && !lower.endsWith(".wav")) return null;
  const dot = leaf.lastIndexOf(".");
  const ext = leaf.slice(dot).toLowerCase();
  const base = leaf.slice(0, dot).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  const cleaned = base.replace(/^[-.]+|[-.]+$/g, "");
  if (!cleaned) return null;
  return `${cleaned}${ext}`;
}

/** Keep Splice pack folders; reject `..` segments. */
export function sanitizeRelativeAudioPath(rel: string): string | null {
  const parts = rel
    .split(/[/\\]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.some((p) => p === "." || p === "..")) return null;
  const leaf = sanitizeSoundFilename(parts[parts.length - 1]!);
  if (!leaf) return null;
  const dirs = parts.slice(0, -1).map((d) =>
    d
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, ""),
  );
  const cleanDirs = dirs.filter(Boolean);
  return [...cleanDirs, leaf].join("/");
}

export function stemKeysFromRelativePath(relativePath: string): {
  rawKey: string;
  mp3Key: string;
  wavKey: string;
  opusKey: string;
  name: string;
  rel: string;
} | null {
  const rel = sanitizeRelativeAudioPath(relativePath);
  if (!rel) return null;
  const lower = rel.toLowerCase();
  const stem = lower.endsWith(".mp3") || lower.endsWith(".wav") ? rel.slice(0, -4) : rel;
  return {
    rawKey: `${BG_AUDIO_RAW_PREFIX}${rel}`,
    mp3Key: `${BG_AUDIO_PREFIX}${stem}.mp3`,
    wavKey: `${BG_AUDIO_PREFIX}${stem}.wav`,
    opusKey: `${BG_AUDIO_PREFIX}${stem}.opus`,
    name: leafNameFromKey(stem),
    rel,
  };
}

export function stemKeysForCategory(
  category: BgAudioCategory,
  filename: string,
): {
  rawKey: string;
  mp3Key: string;
  wavKey: string;
  opusKey: string;
  name: string;
} | null {
  return stemKeysFromRelativePath(`${category}/${filename}`);
}

export function originalKeyForPublicKey(publicKey: string): string {
  if (publicKey.startsWith(BG_AUDIO_PREFIX)) {
    return BG_AUDIO_ORIGINAL_PREFIX + publicKey.slice(BG_AUDIO_PREFIX.length);
  }
  return BG_AUDIO_ORIGINAL_PREFIX + publicKey;
}

export function siblingWavKey(key: string): string | null {
  if (!key.toLowerCase().endsWith(".mp3")) return null;
  return `${key.slice(0, -4)}.wav`;
}

export function siblingMp3Key(key: string): string | null {
  if (!key.toLowerCase().endsWith(".wav")) return null;
  return `${key.slice(0, -4)}.mp3`;
}

/**
 * Gapless streaming sibling. Not returned by listings — the catalog stays keyed
 * on the MP3 so `.opus` never shows up as a separate sound.
 */
export function siblingOpusKey(key: string): string | null {
  const lower = key.toLowerCase();
  if (!lower.endsWith(".mp3") && !lower.endsWith(".wav")) return null;
  return `${key.slice(0, -4)}.opus`;
}

export function publicKeysForCategoryMove(
  fromKey: string,
  toCategory: BgAudioCategory,
): {
  fromMp3: string;
  fromWav: string;
  fromOpus: string;
  toMp3: string;
  toWav: string;
  toOpus: string;
} | null {
  const any = parseAnyBgAudioKey(fromKey);
  if (!any) return null;
  const fromMp3 = any.key.toLowerCase().endsWith(".wav")
    ? `${any.key.slice(0, -4)}.mp3`
    : any.key;
  const fromWav = `${fromMp3.slice(0, -4)}.wav`;
  const fromOpus = `${fromMp3.slice(0, -4)}.opus`;
  let rest = any.rel.replace(/\.(mp3|wav)$/i, "");
  const slash = rest.indexOf("/");
  if (slash > 0 && categoryFromFolderSegment(rest.slice(0, slash))) {
    rest = rest.slice(slash + 1);
  }
  if (!rest) return null;
  const toMp3 = `${BG_AUDIO_PREFIX}${toCategory}/${rest}.mp3`;
  const toWav = `${BG_AUDIO_PREFIX}${toCategory}/${rest}.wav`;
  const toOpus = `${BG_AUDIO_PREFIX}${toCategory}/${rest}.opus`;
  return { fromMp3, fromWav, fromOpus, toMp3, toWav, toOpus };
}
